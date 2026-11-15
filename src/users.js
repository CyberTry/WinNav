'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');

const config = require('./config');
const logger = require('./logger');
const { E } = require('./errors');

const SCRYPT_KEYLEN = 64;
let users = [];
let writeChain = Promise.resolve();

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
}

function makeSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function verifyPassword(password, user) {
  const computed = Buffer.from(hashPassword(password, user.salt), 'hex');
  const stored = Buffer.from(user.passwordHash, 'hex');
  if (computed.length !== stored.length) return false;
  return crypto.timingSafeEqual(computed, stored);
}

/** 未找到账号时也做一次等价计算，避免通过响应时间枚举用户名 */
const DUMMY_SALT = makeSalt();
function burnTime(password) {
  crypto.scryptSync(String(password || ''), DUMMY_SALT, SCRYPT_KEYLEN);
}

function defaultUser(username, password) {
  const salt = makeSalt();
  const now = Date.now();
  return {
    id: 'u_admin',
    username,
    role: 'admin',
    salt,
    passwordHash: hashPassword(password, salt),
    mustChangePassword: password === '123456',
    tokenVersion: 1,
    createdAt: now,
    updatedAt: now
  };
}

function validateUserList(input) {
  if (!input || !Array.isArray(input.users) || input.users.length === 0) {
    throw new Error('users.json 缺少 users 数组');
  }
  for (const user of input.users) {
    if (typeof user.username !== 'string' || !user.username) throw new Error('账号缺少 username');
    if (typeof user.passwordHash !== 'string' || typeof user.salt !== 'string') throw new Error('账号缺少口令哈希');
  }
}

async function atomicWrite(payload) {
  await fsp.mkdir(config.dataDir, { recursive: true });
  const file = config.paths.users;
  const tmp = file + '.tmp';
  const text = JSON.stringify(payload, null, 2) + '\n';
  const handle = await fsp.open(tmp, 'w');
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fsp.copyFile(file, config.paths.usersBackup);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  await fsp.rename(tmp, file);
}

async function init() {
  await fsp.mkdir(config.dataDir, { recursive: true });
  const file = config.paths.users;

  if (fs.existsSync(file) && !config.admin.reset) {
    try {
      const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
      validateUserList(parsed);
      users = parsed.users;
      return;
    } catch (err) {
      logger.warn('users.json 读取失败，尝试备份', { error: err.message });
      try {
        const backup = JSON.parse(await fsp.readFile(config.paths.usersBackup, 'utf8'));
        validateUserList(backup);
        users = backup.users;
        logger.warn('已从 users.json.bak 恢复账号库');
        return;
      } catch (backupErr) {
        logger.error('账号库损坏且无可用备份，将重建默认账号', { error: backupErr.message });
      }
    }
  }

  const fresh = {
    version: 1,
    users: [defaultUser(config.admin.username, config.admin.password)]
  };
  users = fresh.users;
  await atomicWrite(fresh);
  logger.warn('已创建默认管理员账号', { username: config.admin.username, password: config.admin.password });
  if (config.admin.reset) logger.warn('RESET_ADMIN=1：管理员账号已重置为默认凭据');
}

function list() {
  return users.map((u) => ({
    id: u.id,
    username: u.username,
    role: u.role,
    mustChangePassword: Boolean(u.mustChangePassword),
    createdAt: u.createdAt,
    updatedAt: u.updatedAt
  }));
}

function findByUsername(username) {
  const needle = String(username || '').toLowerCase();
  return users.find((u) => u.username.toLowerCase() === needle) || null;
}

function findById(id) {
  return users.find((u) => u.id === id) || null;
}

function verify(username, password) {
  const user = findByUsername(username);
  if (!user) {
    burnTime(password);
    return null;
  }
  if (!verifyPassword(String(password || ''), user)) return null;
  return user;
}

function persist() {
  const run = () => atomicWrite({ version: 1, users });
  const next = writeChain.then(run, run);
  writeChain = next.catch(() => {});
  return next;
}

async function changeCredentials(userId, patch) {
  const user = findById(userId);
  if (!user) throw E.unauthorized('账号不存在，请重新登录');

  if (!patch.currentPassword || !verifyPassword(String(patch.currentPassword), user)) {
    throw E.invalid('当前口令不正确');
  }

  const nextUsername = patch.newUsername === undefined ? user.username : String(patch.newUsername).trim();
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(nextUsername)) {
    throw E.invalid('用户名需为 3~32 位字母、数字、下划线或连字符');
  }

  const clash = users.find((u) => u.id !== userId && u.username.toLowerCase() === nextUsername.toLowerCase());
  if (clash) throw E.conflict('用户名已被使用');

  let nextPassword = null;
  if (patch.newPassword !== undefined && patch.newPassword !== '') {
    const password = String(patch.newPassword);
    if (password.length < 6 || password.length > 64) throw E.invalid('新口令长度需为 6~64 位');
    if (verifyPassword(password, user)) throw E.invalid('新口令不能与当前口令相同');
    nextPassword = password;
  }

  if (nextUsername === user.username && !nextPassword) {
    throw E.invalid('用户名与口令均未变化');
  }

  user.username = nextUsername;
  if (nextPassword) {
    user.salt = makeSalt();
    user.passwordHash = hashPassword(nextPassword, user.salt);
    user.mustChangePassword = nextPassword === config.admin.password;
  }
  user.tokenVersion += 1;
  user.updatedAt = Date.now();

  await persist();
  logger.info('管理员凭据已更新', { username: user.username });
  return publicUser(user);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    mustChangePassword: Boolean(user.mustChangePassword),
    tokenVersion: user.tokenVersion
  };
}

function getTokenVersion(userId) {
  const user = findById(userId);
  return user ? user.tokenVersion : null;
}

module.exports = {
  init,
  list,
  findByUsername,
  findById,
  verify,
  changeCredentials,
  publicUser,
  getTokenVersion
};
