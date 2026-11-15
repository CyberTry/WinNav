'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// 使用独立数据目录，避免污染真实 data/
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'winnav-auth-'));
process.env.DATA_DIR = tmp;
process.env.ADMIN_PASSWORD = '';
process.env.LOG_LEVEL = 'error';

const users = require('../src/users');
const { normalizeUrl } = require('../src/url');

test.before(async () => {
  await users.init();
});

test.after(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

test('初始化后存在默认管理员 admin', () => {
  const admin = users.findByUsername('admin');
  assert.ok(admin, '应创建默认管理员');
  assert.strictEqual(admin.role, 'admin');
  assert.strictEqual(admin.mustChangePassword, true);
});

test('口令以哈希保存，不含明文', () => {
  const raw = fs.readFileSync(path.join(tmp, 'users.json'), 'utf8');
  assert.ok(!raw.includes('"123456"'), '不应出现明文口令');
  assert.ok(raw.includes('passwordHash'));
  assert.ok(raw.includes('salt'));
});

test('口令校验：正确通过、错误拒绝', () => {
  assert.ok(users.verify('admin', '123456'));
  assert.strictEqual(users.verify('admin', 'wrong'), null);
  assert.strictEqual(users.verify('nobody', '123456'), null);
});

test('用户名大小写不敏感', () => {
  assert.ok(users.verify('ADMIN', '123456'));
});

test('修改用户名与口令，旧凭据失效', async () => {
  const admin = users.findByUsername('admin');
  const updated = await users.changeCredentials(admin.id, {
    currentPassword: '123456',
    newUsername: 'ops',
    newPassword: 'n3w-Passw0rd'
  });
  assert.strictEqual(updated.username, 'ops');
  assert.strictEqual(updated.mustChangePassword, false);
  assert.strictEqual(users.verify('admin', '123456'), null);
  assert.ok(users.verify('ops', 'n3w-Passw0rd'));
});

test('修改时校验当前口令', async () => {
  const user = users.findByUsername('ops');
  await assert.rejects(
    () => users.changeCredentials(user.id, { currentPassword: 'bad', newPassword: 'abcdefg' }),
    /当前口令不正确/
  );
});

test('新口令长度限制', async () => {
  const user = users.findByUsername('ops');
  await assert.rejects(
    () => users.changeCredentials(user.id, { currentPassword: 'n3w-Passw0rd', newPassword: '123' }),
    /6~64/
  );
});

test('新口令不得与当前相同', async () => {
  const user = users.findByUsername('ops');
  await assert.rejects(
    () => users.changeCredentials(user.id, { currentPassword: 'n3w-Passw0rd', newPassword: 'n3w-Passw0rd' }),
    /不能与当前口令相同/
  );
});

test('用户名格式校验', async () => {
  const user = users.findByUsername('ops');
  await assert.rejects(
    () => users.changeCredentials(user.id, { currentPassword: 'n3w-Passw0rd', newUsername: 'a' }),
    /3~32/
  );
  await assert.rejects(
    () => users.changeCredentials(user.id, { currentPassword: 'n3w-Passw0rd', newUsername: 'bad name!' }),
    /3~32/
  );
});

test('修改凭据后 tokenVersion 自增（用于让旧会话失效）', async () => {
  const before = users.findByUsername('ops').tokenVersion;
  await users.changeCredentials(users.findByUsername('ops').id, {
    currentPassword: 'n3w-Passw0rd',
    newPassword: 'another-pass'
  });
  const after = users.findByUsername('ops').tokenVersion;
  assert.strictEqual(after, before + 1);
});

test('normalizeUrl 拒绝危险协议', () => {
  assert.throws(() => normalizeUrl('file:///c:/windows'), /http/);
  assert.throws(() => normalizeUrl('javascript:alert(1)'), /http|无法解析/);
});
