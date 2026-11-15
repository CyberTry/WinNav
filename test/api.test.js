'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 必须在 require 业务模块之前设置数据目录
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'winnav-api-'));
process.env.DATA_DIR = tmp;
process.env.LOG_LEVEL = 'error';
process.env.ADMIN_PASSWORD = '';

const store = require('../src/store');
const users = require('../src/users');
const { createApp } = require('../src/app');

let server;
let base;
let cookie = '';

async function call(method, url, body) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  for (const c of res.headers.getSetCookie()) {
    const pair = c.split(';')[0];
    if (pair.startsWith('sid=')) cookie = pair === 'sid=' ? '' : pair;
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 可能不是 JSON */ }
  return { status: res.status, json, text, headers: res.headers };
}

test.before(async () => {
  await store.init();
  await users.init();
  const app = createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  cookie = '';
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

test('GET /api/health 返回 ok', async () => {
  const r = await call('GET', '/api/health');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.data.status, 'ok');
});

test('GET /api/state 匿名为普通用户', async () => {
  const r = await call('GET', '/api/state');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.data.viewer.authenticated, false);
  assert.ok(Array.isArray(r.json.data.groups));
  assert.ok(Array.isArray(r.json.data.services));
});

test('匿名写接口返回 401', async () => {
  const groupId = (await call('GET', '/api/state')).json.data.groups[0].id;
  for (const [method, url, body] of [
    ['POST', '/api/services', { name: 'x', groupId, url: '127.0.0.1:1' }],
    ['POST', '/api/groups', { name: 'x' }],
    ['PATCH', '/api/account', { currentPassword: '123456' }],
    ['GET', '/api/export', undefined]
  ]) {
    const r = await call(method, url, body);
    assert.strictEqual(r.status, 401, method + ' ' + url);
  }
});

test('登录成功并下发 HttpOnly Cookie', async () => {
  const r = await call('POST', '/api/login', { username: 'admin', password: '123456' });
  assert.strictEqual(r.status, 200);
  assert.ok(cookie.startsWith('sid='));
  const setCookie = r.headers.getSetCookie().join(';');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
});

test('登录后可创建服务并归一化地址', async () => {
  const groupId = (await call('GET', '/api/state')).json.data.groups[0].id;
  const r = await call('POST', '/api/services', {
    name: '测试服务', description: 'desc', groupId, url: '127.0.0.1:8080'
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.data.url, 'http://127.0.0.1:8080/');
  assert.strictEqual(r.json.data.enabled, true);
});

test('非法输入被拒绝', async () => {
  const groupId = (await call('GET', '/api/state')).json.data.groups[0].id;
  const cases = [
    { name: '', groupId, url: '1.1.1.1' },
    { name: 'a', groupId, url: 'ftp://x.y' },
    { name: 'a', groupId: 'g_missing', url: '1.1.1.1' }
  ];
  for (const body of cases) {
    const r = await call('POST', '/api/services', body);
    assert.strictEqual(r.status, 400, JSON.stringify(body));
  }
});

test('刷新后探测结果包含在线服务', async () => {
  await call('POST', '/api/state/refresh');
  let data;
  for (let i = 0; i < 40; i++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    data = (await call('GET', '/api/status')).json.data;
    if (!data.refreshing) break;
  }
  assert.strictEqual(data.refreshing, false);
  const statuses = Object.values(data.statuses);
  assert.ok(statuses.length >= 1);
  assert.ok(statuses.every((s) => ['online', 'offline'].includes(s.state)));
});

test('SSE 推送 refresh:start / status / refresh:done', async () => {
  const events = [];
  const controller = new AbortController();
  const reading = fetch(base + '/api/events', { signal: controller.signal })
    .then(async (res) => {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop();
        for (const part of parts) {
          const m = /event: (.+)/.exec(part);
          if (m) events.push(m[1].trim());
        }
        if (events.includes('refresh:done')) break;
      }
    })
    .catch(() => {});

  await new Promise((resolve) => setTimeout(resolve, 300));
  await call('POST', '/api/state/refresh');
  await reading;
  controller.abort();

  assert.ok(events.includes('refresh:start'), String(events));
  assert.ok(events.includes('status'), String(events));
  assert.ok(events.includes('refresh:done'), String(events));
});

test('修改凭据后旧口令失效', async () => {
  const r = await call('PATCH', '/api/account', {
    currentPassword: '123456', newUsername: 'ops', newPassword: 'n3w-Passw0rd'
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.data.username, 'ops');

  cookie = '';
  const oldLogin = await call('POST', '/api/login', { username: 'admin', password: '123456' });
  assert.strictEqual(oldLogin.status, 401);

  const newLogin = await call('POST', '/api/login', { username: 'ops', password: 'n3w-Passw0rd' });
  assert.strictEqual(newLogin.status, 200);
});

test('账号库不存明文口令', () => {
  const raw = fs.readFileSync(path.join(tmp, 'users.json'), 'utf8');
  assert.ok(!raw.includes('n3w-Passw0rd'));
  assert.ok(!raw.includes('"123456"'));
});
