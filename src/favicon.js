'use strict';

const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');

const logger = require('./logger');
const { parseTarget } = require('./url');

const OK_TTL = 6 * 60 * 60 * 1000;   // 成功缓存 6 小时
const FAIL_TTL = 10 * 60 * 1000;     // 失败缓存 10 分钟，避免反复打目标站点
const MAX_BYTES = 512 * 1024;        // 单张图标上限 512 KB
const MAX_HTML_BYTES = 256 * 1024;   // 解析页面时的 HTML 上限
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT = 4000;

const cache = new Map();    // serviceId -> { ok, buffer, contentType, etag, fetchedAt }
const inflight = new Map(); // serviceId -> Promise

const IMAGE_TYPE = /^image\//i;

/** 带超时、重定向上限与体积上限的 GET，返回 Buffer（不自动解压，请求时要求 identity） */
function fetchBuffer(target, path, timeoutMs, limit) {
  return new Promise((resolve) => {
    const lib = target.scheme === 'https' ? https : http;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let req;
    try {
      req = lib.request({
        protocol: target.scheme + ':',
        host: target.host,
        port: target.port,
        path: path || '/',
        method: 'GET',
        headers: {
          'User-Agent': 'WinNav/0.2 (+favicon)',
          Accept: 'image/*,text/html;q=0.8,*/*;q=0.5',
          'Accept-Encoding': 'identity'
        },
        timeout: timeoutMs,
        rejectUnauthorized: false
      }, (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;

        if (status >= 300 && status < 400 && location && target.redirects < MAX_REDIRECTS) {
          res.resume();
          const next = new URL(location, target.scheme + '://' + target.hostHeader);
          return resolve({
            redirect: {
              scheme: next.protocol.replace(':', ''),
              host: next.hostname.replace(/^\[|\]$/g, ''),
              port: next.port ? Number.parseInt(next.port, 10) : (next.protocol === 'https:' ? 443 : 80),
              hostHeader: next.host,
              path: (next.pathname || '/') + (next.search || ''),
              redirects: target.redirects + 1
            }
          });
        }

        const chunks = [];
        let total = 0;
        let aborted = false;
        res.on('data', (chunk) => {
          total += chunk.length;
          if (total > limit) {
            aborted = true;
            req.destroy();
            res.destroy();
            finish({ status, headers: res.headers, body: null, tooLarge: true });
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (aborted) return;
          finish({ status, headers: res.headers, body: Buffer.concat(chunks) });
        });
        res.on('error', () => finish({ error: 'ERESPONSE' }));
      });
    } catch (err) {
      finish({ error: err.code || 'EREQUEST' });
      return;
    }

    req.setTimeout(timeoutMs, () => {
      finish({ error: 'ETIMEDOUT' });
      req.destroy();
    });
    req.on('error', (err) => finish({ error: err.code || 'ECONNERROR' }));
    req.end();
  });
}

/** 递归跟随重定向 */
async function fetchFollowing(target, path, limit) {
  let current = Object.assign({ redirects: 0 }, target);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const result = await fetchBuffer(current, path, FETCH_TIMEOUT, limit);
    if (result.redirect) {
      current = Object.assign({ redirects: result.redirects }, result.redirect);
      path = result.redirect.path;
      continue;
    }
    return result;
  }
  return { error: 'ETOOMANYREDIRECTS' };
}

/** 从 HTML 中提取候选图标地址，按优先级排序 */
function findIconLinks(html, baseUrl) {
  const found = [];
  const linkRe = /<link\b[^>]*>/gi;
  let match;
  while ((match = linkRe.exec(html)) !== null) {
    const tag = match[0];
    const relMatch = /\brel\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (!relMatch) continue;
    const rel = String(relMatch[2] || relMatch[3] || relMatch[4] || '').toLowerCase();
    if (!rel.split(/\s+/).some((token) => token === 'icon' || token === 'shortcut' || token === 'apple-touch-icon' || token === 'apple-touch-icon-precomposed')) {
      if (!/icon/.test(rel)) continue;
    }

    const hrefMatch = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (!hrefMatch) continue;
    const href = String(hrefMatch[2] || hrefMatch[3] || hrefMatch[4] || '').trim();
    if (!href || href.startsWith('data:')) continue;

    let absolute;
    try {
      absolute = new URL(href, baseUrl).href;
    } catch {
      continue;
    }
    if (!/^https?:/i.test(absolute)) continue;

    const sizesMatch = /\bsizes\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
    const sizes = sizesMatch ? (sizesMatch[2] || sizesMatch[3] || '') : '';
    let score = 0;
    if (/^\d+x\d+$/i.test(sizes)) {
      const [w, h] = sizes.toLowerCase().split('x').map(Number);
      score = Math.min(w, h) || 0;
    }
    if (/apple-touch-icon/i.test(rel)) score = Math.max(score, 180);
    if (/mask-icon/i.test(rel) || /\.svg($|\?)/i.test(absolute)) score -= 10;

    if (!found.some((item) => item.url === absolute)) found.push({ url: absolute, score });
  }
  found.sort((a, b) => b.score - a.score);
  return found.map((item) => item.url);
}

function splitAbsolute(href) {
  const parsed = new URL(href);
  return {
    scheme: parsed.protocol.replace(':', ''),
    host: parsed.hostname.replace(/^\[|\]$/g, ''),
    port: parsed.port ? Number.parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80),
    hostHeader: parsed.host,
    path: (parsed.pathname || '/') + (parsed.search || ''),
    redirects: 0
  };
}

async function download(url) {
  const target = splitAbsolute(url);
  const result = await fetchFollowing(target, target.path, MAX_BYTES);
  if (!result || !result.body || result.body.length === 0) return null;
  const type = String((result.headers && result.headers['content-type']) || '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPE.test(type)) return null;
  return { buffer: result.body, contentType: type };
}

/** 真正去目标站点取图标：先解析页面 <link rel="icon">，再退回 /favicon.ico */
async function fetchFavicon(service) {
  const pageTarget = parseTarget(service.url);
  const baseUrl = pageTarget.scheme + '://' + pageTarget.hostHeader + '/';

  const page = await fetchFollowing(pageTarget, pageTarget.path || '/', MAX_HTML_BYTES);
  const candidates = [];
  if (page && page.body && /text\/html/i.test(String(page.headers['content-type'] || ''))) {
    const html = page.body.toString('utf8');
    candidates.push(...findIconLinks(html, service.url));
  }
  candidates.push(baseUrl + 'favicon.ico');

  for (const candidate of candidates) {
    try {
      const icon = await download(candidate);
      if (icon) return icon;
    } catch (err) {
      logger.debug('候选图标下载失败', { url: candidate, error: err.message });
    }
  }
  return null;
}

/**
 * 获取服务图标（带内存缓存与 in-flight 去重）。
 * 返回 { buffer, contentType, etag } 或 null。
 */
function getForService(service) {
  const cached = cache.get(service.id);
  if (cached) {
    const ttl = cached.ok ? OK_TTL : FAIL_TTL;
    if (Date.now() - cached.fetchedAt < ttl) {
      return Promise.resolve(cached.ok ? cached : null);
    }
  }
  if (inflight.has(service.id)) return inflight.get(service.id);

  const task = fetchFavicon(service)
    .then((icon) => {
      if (!icon) {
        cache.set(service.id, { ok: false, fetchedAt: Date.now() });
        return null;
      }
      const etag = '"' + crypto.createHash('sha1').update(icon.buffer).digest('hex').slice(0, 24) + '"';
      const entry = {
        ok: true,
        buffer: icon.buffer,
        contentType: icon.contentType,
        etag,
        fetchedAt: Date.now()
      };
      cache.set(service.id, entry);
      return entry;
    })
    .catch((err) => {
      logger.debug('favicon 获取失败', { id: service.id, error: err.message });
      cache.set(service.id, { ok: false, fetchedAt: Date.now() });
      return null;
    })
    .finally(() => { inflight.delete(service.id); });

  inflight.set(service.id, task);
  return task;
}

function drop(id) {
  cache.delete(id);
  inflight.delete(id);
}

function dropMissing(validIds) {
  const keep = new Set(validIds);
  for (const id of cache.keys()) if (!keep.has(id)) cache.delete(id);
}

module.exports = {
  getForService,
  drop,
  dropMissing,
  cacheSize: () => cache.size,
  findIconLinks
};
