'use strict';

const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const http = require('node:http');

const { normalizeUrl, parseTarget, displayUrl } = require('../src/url');
const probe = require('../src/probe');

async function withTcpServer(fn) {
  const server = net.createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    return await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function withHttpServer(statusCode, fn) {
  const server = http.createServer((req, res) => {
    res.writeHead(statusCode, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    return await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function settings(overrides) {
  return {
    probe: Object.assign({ mode: 'tcp', timeoutMs: 1200, concurrency: 4, cacheTtlMs: 0, httpCheck: false }, overrides)
  };
}

test('normalizeUrl 补全协议并校验', () => {
  assert.strictEqual(normalizeUrl('192.168.1.20:8096'), 'http://192.168.1.20:8096/');
  assert.strictEqual(normalizeUrl('nas.local'), 'http://nas.local/');
  assert.strictEqual(normalizeUrl('https://panel.example.com'), 'https://panel.example.com/');
  assert.strictEqual(normalizeUrl('http://[fe80::1]:8080'), 'http://[fe80::1]:8080/');
  assert.throws(() => normalizeUrl('ftp://a.b'), /http/);
  assert.throws(() => normalizeUrl(''), /访问地址/);
});

test('parseTarget 推导端口与主机', () => {
  assert.deepStrictEqual(
    (({ host, port, scheme }) => ({ host, port, scheme }))(parseTarget('http://192.168.1.20:8096')),
    { host: '192.168.1.20', port: 8096, scheme: 'http' }
  );
  assert.strictEqual(parseTarget('https://panel.example.com').port, 443);
  assert.strictEqual(parseTarget('http://nas.local').port, 80);
});

test('displayUrl 去掉协议与尾斜杠', () => {
  assert.strictEqual(displayUrl('http://192.168.1.20:8096/'), '192.168.1.20:8096');
  assert.strictEqual(displayUrl('https://panel.example.com/'), 'panel.example.com');
});

test('TCP 探测：开放端口判定在线并给出延迟', async () => {
  await withTcpServer(async (port) => {
    const status = await probe.probeService({ id: 'a', url: 'http://127.0.0.1:' + port, probe: {} }, settings());
    assert.strictEqual(status.state, 'online');
    assert.strictEqual(typeof status.latencyMs, 'number');
    assert.strictEqual(status.error, null);
  });
});

test('TCP 探测：关闭端口判定离线', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));

  const status = await probe.probeService({ id: 'b', url: 'http://127.0.0.1:' + port, probe: {} }, settings({ timeoutMs: 500 }));
  assert.strictEqual(status.state, 'offline');
  assert.strictEqual(status.latencyMs, null);
  assert.ok(status.error);
});

test('TCP 探测：超时判定离线', async () => {
  const server = net.createServer(() => { /* 保持连接不响应 */ });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const status = await probe.probeService(
      { id: 'c', url: 'http://10.255.255.1:' + port, probe: {} },
      settings({ timeoutMs: 400 })
    );
    assert.strictEqual(status.state, 'offline');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('HTTP 探测：收到 204 也判定在线', async () => {
  await withHttpServer(204, async (port) => {
    const status = await probe.probeService(
      { id: 'd', url: 'http://127.0.0.1:' + port, probe: { mode: 'http' } },
      settings({ mode: 'http' })
    );
    assert.strictEqual(status.state, 'online');
    assert.strictEqual(status.httpStatus, 204);
  });
});

test('HTTP 探测：500 仍判定在线（服务可达）', async () => {
  await withHttpServer(500, async (port) => {
    const status = await probe.probeService(
      { id: 'e', url: 'http://127.0.0.1:' + port, probe: { mode: 'http' } },
      settings({ mode: 'http' })
    );
    assert.strictEqual(status.state, 'online');
    assert.strictEqual(status.httpStatus, 500);
  });
});

test('TCP 模式追加 HTTP 检查', async () => {
  await withHttpServer(200, async (port) => {
    const status = await probe.probeService(
      { id: 'f', url: 'http://127.0.0.1:' + port, probe: {} },
      settings({ httpCheck: true })
    );
    assert.strictEqual(status.state, 'online');
    assert.strictEqual(status.httpStatus, 200);
  });
});

test('DNS 失败判定离线并给出错误码', async () => {
  const status = await probe.probeService(
    { id: 'g', url: 'http://this-host-should-not-exist.invalid', probe: {} },
    settings({ timeoutMs: 800 })
  );
  assert.strictEqual(status.state, 'offline');
  assert.strictEqual(status.error, 'ENOTFOUND');
});

test('并发池限制同时执行数量', async () => {
  let active = 0;
  let peak = 0;
  const items = Array.from({ length: 20 }, (_, i) => i);
  await probe.runPool(items, 5, async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active--;
  });
  assert.ok(peak <= 5, '峰值并发 ' + peak);
  assert.ok(peak >= 2, '并发未生效');
});

test('缓存命中时不重复探测', async () => {
  let calls = 0;
  const server = net.createServer((socket) => { calls++; socket.end(); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const service = { id: 'cached-' + Date.now(), url: 'http://127.0.0.1:' + port, probe: {} };
    const cfg = settings({ cacheTtlMs: 10000 });
    await probe.probeCached(service, cfg, false);
    await probe.probeCached(service, cfg, false);
    await probe.probeCached(service, cfg, false);
    assert.strictEqual(calls, 1, '应只建立一次连接，实际 ' + calls);
    probe.dropService(service.id);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
