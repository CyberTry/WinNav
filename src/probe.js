'use strict';

const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns').promises;
const { execFile } = require('node:child_process');

const logger = require('./logger');
const { parseTarget } = require('./url');

const cache = new Map();   // serviceId -> status
const inflight = new Map(); // serviceId -> Promise<status>

function elapsedMs(startNs) {
  return Number(process.hrtime.bigint() - startNs) / 1e6;
}

function round(ms) {
  return ms < 1 ? 0 : Math.round(ms);
}

/** TCP 连接探测：连接成功即在线，耗时即握手延迟 */
function tcpProbe(target, timeoutMs) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    let settled = false;
    const socket = new net.Socket();
    socket.setNoDelay(true);

    const finish = (ok, error) => {
      if (settled) return;
      settled = true;
      const latency = round(elapsedMs(started));
      socket.destroy();
      resolve({ ok, latencyMs: ok ? latency : null, error: ok ? null : error });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false, 'ETIMEDOUT'));
    socket.once('error', (err) => finish(false, err.code || 'ECONNERROR'));
    try {
      socket.connect(target.port, target.host);
    } catch (err) {
      finish(false, err.code || 'ECONNERROR');
    }
  });
}

/** HTTP 探测：收到任意状态码即在线，延迟为请求总耗时 */
function httpProbe(target, timeoutMs) {
  return new Promise((resolve) => {
    const lib = target.scheme === 'https' ? https : http;
    const started = process.hrtime.bigint();
    let settled = false;

    const finish = (ok, extra) => {
      if (settled) return;
      settled = true;
      const latency = round(elapsedMs(started));
      resolve(Object.assign({ ok, latencyMs: ok ? latency : null, error: ok ? null : null }, extra));
    };

    let req;
    try {
      req = lib.request({
        protocol: target.scheme + ':',
        host: target.host,
        port: target.port,
        path: target.path || '/',
        method: 'HEAD',
        headers: { 'User-Agent': 'WinNav/0.2 (+probe)', Accept: '*/*' },
        timeout: timeoutMs,
        rejectUnauthorized: false,
        servername: net.isIP(target.host) ? undefined : target.host
      }, (res) => {
        res.resume();
        finish(true, { httpStatus: res.statusCode });
      });
    } catch (err) {
      finish(false, { error: err.code || 'EREQUEST' });
      return;
    }

    req.on('timeout', () => {
      finish(false, { error: 'ETIMEDOUT' });
      req.destroy();
    });
    req.on('error', (err) => finish(false, { error: err.code || 'ECONNERROR' }));
    req.end();
  });
}

/** ICMP：调用系统 ping，需要主机名可解析，忽略端口 */
function icmpProbe(target, timeoutMs) {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const args = isWindows
      ? ['-n', '1', '-w', String(timeoutMs), target.host]
      : ['-c', '1', '-W', String(Math.ceil(timeoutMs / 1000)), target.host];
    const started = process.hrtime.bigint();
    execFile('ping', args, { timeout: timeoutMs + 1500, windowsHide: true }, (err, stdout, stderr) => {
      const text = String(stdout || '') + String(stderr || '');
      const latency = round(elapsedMs(started));
      if (err) {
        resolve({ ok: false, latencyMs: null, error: 'EICMPFAIL' });
        return;
      }
      const zh = text.match(/(?:时间|時間)[=<]?\s*(\d+)\s*ms/i);
      const en = text.match(/time[=<]?\s*(\d+(?:\.\d+)?)\s*ms/i);
      const lt1 = /[<＜]\s*1\s*ms/i.test(text);
      if (zh || en) {
        resolve({ ok: true, latencyMs: parseInt((zh || en)[1], 10), error: null });
      } else if (lt1) {
        resolve({ ok: true, latencyMs: 0, error: null });
      } else if (/TTL=/i.test(text) || /ttl=/i.test(text)) {
        resolve({ ok: true, latencyMs: latency, error: null });
      } else {
        resolve({ ok: false, latencyMs: null, error: 'EICMPFAIL' });
      }
    });
  });
}

async function resolveDns(target) {
  if (net.isIP(target.host)) return null;
  try {
    await dns.lookup(target.host);
    return null;
  } catch (err) {
    return err.code === 'ENOTFOUND' ? 'ENOTFOUND' : (err.code || 'EDNS');
  }
}

/**
 * 探测单个服务，返回状态快照。
 * mode: inherit（跟随全局设置）| tcp | http | icmp
 */
async function probeService(service, settings) {
  const probeCfg = (settings && settings.probe) || {};
  const timeoutMs = (service.probe && Number.isInteger(service.probe.timeoutMs))
    ? service.probe.timeoutMs
    : (probeCfg.timeoutMs || 2500);
  const mode = (service.probe && service.probe.mode && service.probe.mode !== 'inherit')
    ? service.probe.mode
    : (probeCfg.mode || 'tcp');

  const base = { checkedAt: Date.now(), method: mode, httpStatus: null };

  let target;
  try {
    target = parseTarget(service.url);
  } catch (err) {
    return Object.assign(base, { state: 'offline', latencyMs: null, error: 'EBADURL' });
  }

  const dnsError = await resolveDns(target);
  if (dnsError) {
    return Object.assign(base, { state: 'offline', latencyMs: null, error: dnsError });
  }

  if (mode === 'icmp') {
    const result = await icmpProbe(target, timeoutMs);
    return Object.assign(base, {
      state: result.ok ? 'online' : 'offline',
      latencyMs: result.latencyMs,
      error: result.error
    });
  }

  if (mode === 'http') {
    const result = await httpProbe(target, timeoutMs);
    return Object.assign(base, {
      state: result.ok ? 'online' : 'offline',
      latencyMs: result.latencyMs,
      error: result.error || null,
      httpStatus: result.httpStatus || null
    });
  }

  // 默认 tcp：TCP 成功后可选追加 HTTP 探测作为附加信息
  const tcp = await tcpProbe(target, timeoutMs);
  if (!tcp.ok) {
    return Object.assign(base, { state: 'offline', latencyMs: null, error: tcp.error });
  }
  let httpStatus = null;
  let note = null;
  if (probeCfg.httpCheck !== false && (target.scheme === 'http' || target.scheme === 'https')) {
    const httpResult = await httpProbe(target, Math.max(timeoutMs, 3000));
    if (httpResult.ok) httpStatus = httpResult.httpStatus;
    else note = 'HTTP 无响应';
  }
  return Object.assign(base, {
    state: 'online',
    latencyMs: tcp.latencyMs,
    error: null,
    httpStatus,
    note
  });
}

/** 单服务探测（带 in-flight 去重与缓存） */
function probeCached(service, settings, force) {
  const ttl = (settings && settings.probe && settings.probe.cacheTtlMs) || 0;
  const cached = cache.get(service.id);
  if (!force && cached && ttl > 0 && Date.now() - cached.checkedAt < ttl) {
    return Promise.resolve(cached);
  }
  if (inflight.has(service.id)) return inflight.get(service.id);

  const task = probeService(service, settings)
    .then((status) => {
      cache.set(service.id, status);
      return status;
    })
    .catch((err) => {
      logger.error('探测异常', { id: service.id, error: err.message });
      const status = { state: 'offline', latencyMs: null, error: 'EINTERNAL', checkedAt: Date.now(), method: 'tcp' };
      cache.set(service.id, status);
      return status;
    })
    .finally(() => {
      inflight.delete(service.id);
    });

  inflight.set(service.id, task);
  return task;
}

/** 简单并发池 */
async function runPool(items, concurrency, worker) {
  const queue = items.slice();
  const limit = Math.max(1, Math.min(concurrency || 8, queue.length || 1));
  const runners = [];
  for (let i = 0; i < limit; i++) {
    runners.push((async () => {
      while (queue.length) {
        const item = queue.shift();
        await worker(item);
      }
    })());
  }
  await Promise.all(runners);
}

function getStatuses() {
  const out = {};
  for (const [id, status] of cache) out[id] = status;
  return out;
}

function dropService(id) {
  cache.delete(id);
  inflight.delete(id);
}

function dropMissing(validIds) {
  const keep = new Set(validIds);
  for (const id of cache.keys()) if (!keep.has(id)) cache.delete(id);
}

function summarize(services, statuses) {
  let online = 0;
  let offline = 0;
  let unknown = 0;
  for (const service of services) {
    if (service.enabled === false) continue;
    const st = statuses[service.id];
    if (!st || st.state === 'unknown') unknown++;
    else if (st.state === 'online') online++;
    else offline++;
  }
  return { total: services.filter((s) => s.enabled !== false).length, online, offline, unknown };
}

module.exports = {
  probeService,
  probeCached,
  runPool,
  getStatuses,
  dropService,
  dropMissing,
  summarize,
  cacheSize: () => cache.size
};
