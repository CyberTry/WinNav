'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const favicon = require('../src/favicon');
const { findIconLinks } = favicon;

const FAVICON_BYTES = Buffer.from([
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x10, 0x10, 0x00, 0x00, 0x01, 0x00, 0x20, 0x00,
  0x04, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  0xAA, 0xBB, 0xCC, 0xDD
]);

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('findIconLinks 解析 rel=icon 并按尺寸排序', () => {
  const html = [
    '<html><head>',
    '<link rel="icon" href="/favicon-32.png" sizes="32x32">',
    '<link rel="shortcut icon" href="https://cdn.example.com/big.png" sizes="192x192">',
    '<link rel="apple-touch-icon" href="/apple.png">',
    '<link rel="stylesheet" href="/style.css">',
    '</head><body></body></html>'
  ].join('');

  const links = findIconLinks(html, 'http://lan.local/');
  assert.ok(links.length >= 2, JSON.stringify(links));
  assert.strictEqual(links[0], 'https://cdn.example.com/big.png');
  assert.ok(links.includes('http://lan.local/favicon-32.png'));
  assert.ok(!links.some((l) => l.endsWith('.css')));
});

test('findIconLinks 忽略 data: 与非法协议', () => {
  const html = '<link rel="icon" href="data:image/png;base64,AAAA"><link rel="icon" href="javascript:alert(1)">';
  assert.deepStrictEqual(findIconLinks(html, 'http://x.local/'), []);
});

test('findIconLinks 解析相对路径与无尺寸标注', () => {
  const html = '<link rel="icon" href="./assets/ico.png">';
  const links = findIconLinks(html, 'http://x.local/app/page');
  assert.deepStrictEqual(links, ['http://x.local/app/assets/ico.png']);
});

/* ================= 端到端：真实抓取 favicon ================= */

test('从目标站点抓取 <link rel="icon"> 并返回图片', async () => {
  const server = await startServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><head><link rel="icon" href="/static/logo.png" sizes="64x64"></head></html>');
      return;
    }
    if (req.url === '/static/logo.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(FAVICON_BYTES);
      return;
    }
    res.writeHead(404).end();
  });
  const port = server.address().port;
  try {
    const result = await favicon.getForService({ id: 'e2e-' + Date.now(), url: 'http://127.0.0.1:' + port + '/' });
    assert.ok(result, '应抓取到图标');
    assert.strictEqual(result.contentType, 'image/png');
    assert.deepStrictEqual([...result.buffer], [...FAVICON_BYTES]);
    assert.match(result.etag, /^"[0-9a-f]{24}"$/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('没有 <link rel="icon"> 时回退到 /favicon.ico', async () => {
  const server = await startServer((req, res) => {
    if (req.url === '/favicon.ico') {
      res.writeHead(200, { 'Content-Type': 'image/x-icon' });
      res.end(FAVICON_BYTES);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><head><title>no icon link</title></head></html>');
  });
  const port = server.address().port;
  try {
    const result = await favicon.getForService({ id: 'fallback-' + Date.now(), url: 'http://127.0.0.1:' + port + '/' });
    assert.ok(result, '应回退到 /favicon.ico');
    assert.strictEqual(result.contentType, 'image/x-icon');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('目标站点没有图标时返回 null', async () => {
  const server = await startServer((req, res) => {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('nope');
  });
  const port = server.address().port;
  try {
    const result = await favicon.getForService({ id: 'none-' + Date.now(), url: 'http://127.0.0.1:' + port + '/' });
    assert.strictEqual(result, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('非图片响应被拒绝', async () => {
  const server = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('I am not an image');
  });
  const port = server.address().port;
  try {
    const result = await favicon.getForService({ id: 'text-' + Date.now(), url: 'http://127.0.0.1:' + port + '/' });
    assert.strictEqual(result, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('缓存命中：多次调用只请求一次目标站点', async () => {
  let hits = 0;
  const server = await startServer((req, res) => {
    if (req.url === '/favicon.ico') {
      hits++;
      res.writeHead(200, { 'Content-Type': 'image/x-icon' });
      res.end(FAVICON_BYTES);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html></html>');
  });
  const port = server.address().port;
  const service = { id: 'cache-' + Date.now(), url: 'http://127.0.0.1:' + port + '/' };
  try {
    await favicon.getForService(service);
    await favicon.getForService(service);
    await favicon.getForService(service);
    assert.strictEqual(hits, 1, '应只抓取一次，实际 ' + hits);
  } finally {
    favicon.drop(service.id);
    await new Promise((resolve) => server.close(resolve));
  }
});

test('跟随 302 重定向获取图标', async () => {
  const server = await startServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(302, { Location: '/home' });
      res.end();
      return;
    }
    if (req.url === '/home') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><head><link rel="icon" href="/i.png"></head></html>');
      return;
    }
    if (req.url === '/i.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(FAVICON_BYTES);
      return;
    }
    res.writeHead(404).end();
  });
  const port = server.address().port;
  try {
    const result = await favicon.getForService({ id: 'redir-' + Date.now(), url: 'http://127.0.0.1:' + port + '/' });
    assert.ok(result, '应跟随重定向后拿到图标');
    assert.strictEqual(result.contentType, 'image/png');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
