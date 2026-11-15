'use strict';

const crypto = require('node:crypto');
const config = require('./config');
const logger = require('./logger');
const users = require('./users');
const { AppError, E } = require('./errors');

const COOKIE_NAME = 'sid';
const sessions = new Map();      // sid -> { userId, role, tokenVersion, createdAt, lastSeenAt, ip }
const loginAttempts = new Map(); // ip -> { count, firstAt, lockedUntil }
const probeHits = new Map();     // ip -> { count, firstAt }

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

function setCookie(res, sid) {
  const maxAge = Math.floor(config.sessionTtlMs / 1000);
  const value = [
    COOKIE_NAME + '=' + sid,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=' + maxAge
  ].join('; ');
  res.append('Set-Cookie', value);
}

function clearCookie(res) {
  res.append('Set-Cookie', COOKIE_NAME + '=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
}

function purgeExpired() {
  const now = Date.now();
  for (const [sid, session] of sessions) {
    if (now - session.lastSeenAt > config.sessionTtlMs) sessions.delete(sid);
  }
}

setInterval(() => {
  purgeExpired();
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (entry.lockedUntil && entry.lockedUntil > now) continue;
    if (now - entry.firstAt > 60 * 1000) loginAttempts.delete(ip);
  }
  for (const [ip, entry] of probeHits) {
    if (now - entry.firstAt > 60 * 1000) probeHits.delete(ip);
  }
}, 60 * 1000).unref();

function createSession(user, req, res) {
  const sid = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  sessions.set(sid, {
    userId: user.id,
    role: user.role,
    tokenVersion: user.tokenVersion,
    createdAt: now,
    lastSeenAt: now,
    ip: clientIp(req)
  });
  setCookie(res, sid);
  return sid;
}

function resolveViewer(req) {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies[COOKIE_NAME];
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  if (Date.now() - session.lastSeenAt > config.sessionTtlMs) {
    sessions.delete(sid);
    return null;
  }
  const version = users.getTokenVersion(session.userId);
  if (version === null || version !== session.tokenVersion) {
    sessions.delete(sid);
    return null;
  }
  const user = users.findById(session.userId);
  if (!user) {
    sessions.delete(sid);
    return null;
  }
  session.lastSeenAt = Date.now();
  return Object.assign(users.publicUser(user), { sid });
}

/** 给所有请求挂上 viewer（匿名时为 null），不报错 */
function attachViewer(req, res, next) {
  req.viewer = resolveViewer(req);
  next();
}

function requireAdmin(req, res, next) {
  if (!req.viewer || req.viewer.role !== 'admin') {
    return next(E.unauthorized('需要管理员登录'));
  }
  next();
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry) return;
  if (entry.lockedUntil && entry.lockedUntil > now) {
    const seconds = Math.ceil((entry.lockedUntil - now) / 1000);
    throw new AppError('TOO_MANY_ATTEMPTS', '尝试次数过多，请 ' + seconds + ' 秒后再试', 429);
  }
  // 每分钟窗口内的失败次数上限（默认 5 次）
  if (now - entry.firstAt <= 60 * 1000 && entry.count >= config.limits.loginFailuresPerMinute) {
    const seconds = Math.ceil((60 * 1000 - (now - entry.firstAt)) / 1000) || 1;
    throw new AppError('TOO_MANY_ATTEMPTS', '尝试次数过多，请 ' + seconds + ' 秒后再试', 429);
  }
}

function recordFailure(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, firstAt: now, lockedUntil: 0 };
  if (now - entry.firstAt > 60 * 1000) {
    entry.count = 0;
    entry.firstAt = now;
  }
  entry.count += 1;
  if (entry.count >= config.limits.loginLockAfter) {
    entry.lockedUntil = now + config.limits.loginLockMs;
    logger.warn('登录失败次数过多，已锁定该 IP', { ip, count: entry.count });
  }
  loginAttempts.set(ip, entry);
}

function recordSuccess(ip) {
  loginAttempts.delete(ip);
}

function login(req, res, username, password) {
  const ip = clientIp(req);
  checkRateLimit(ip);

  const user = users.verify(username, password);
  if (!user) {
    recordFailure(ip);
    logger.warn('登录失败', { ip, username: String(username || '').slice(0, 32) });
    throw E.invalidCredentials();
  }

  recordSuccess(ip);
  for (const [sid, session] of sessions) {
    if (session.userId === user.id) sessions.delete(sid);
  }
  createSession(user, req, res);
  logger.info('登录成功', { ip, username: user.username });
  return users.publicUser(user);
}

function logout(req, res) {
  if (req.viewer && req.viewer.sid) sessions.delete(req.viewer.sid);
  clearCookie(res);
  logger.info('登出', { username: req.viewer ? req.viewer.username : null });
}

function logoutOthers(userId, keepSid) {
  for (const [sid, session] of sessions) {
    if (session.userId === userId && sid !== keepSid) sessions.delete(sid);
  }
}

/** 登录 / 测试连接限速（滑动 1 分钟窗口） */
function consumeProbeQuota(ip) {
  const now = Date.now();
  const entry = probeHits.get(ip) || { count: 0, firstAt: now };
  if (now - entry.firstAt > 60 * 1000) {
    entry.count = 0;
    entry.firstAt = now;
  }
  entry.count += 1;
  probeHits.set(ip, entry);
  if (entry.count > config.limits.probeTestPerMinute) {
    throw new AppError('TOO_MANY_REQUESTS', '测试连接过于频繁，请稍后再试', 429);
  }
}

module.exports = {
  COOKIE_NAME,
  attachViewer,
  requireAdmin,
  login,
  logout,
  logoutOthers,
  clientIp,
  consumeProbeQuota,
  sessionCount: () => sessions.size
};
