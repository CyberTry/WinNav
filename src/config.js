'use strict';

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

/** 读取 .env（KEY=VALUE），不覆盖已存在的环境变量 */
function loadEnvFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(rootDir, '.env'));

function toInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const dataDir = path.resolve(rootDir, process.env.DATA_DIR || 'data');

const config = {
  rootDir,
  port: toInt(process.env.PORT, 8080),
  host: process.env.HOST || '0.0.0.0',
  dataDir,
  publicDir: path.join(rootDir, 'public'),
  logLevel: (process.env.LOG_LEVEL || 'info').toLowerCase(),
  sessionTtlMs: toInt(process.env.SESSION_TTL_MS, 12 * 60 * 60 * 1000),
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || '123456',
    reset: process.env.RESET_ADMIN === '1'
  },
  defaults: {
    siteTitle: 'WinNav',
    probe: {
      mode: 'tcp',
      timeoutMs: 2500,
      concurrency: 8,
      cacheTtlMs: 30000,
      httpCheck: true,
      intervalSec: 0
    }
  },
  limits: {
    loginFailuresPerMinute: 5,
    loginLockMs: 10 * 60 * 1000,
    loginLockAfter: 10,
    probeTestPerMinute: 10,
    maxNameLength: 60,
    maxDescriptionLength: 200,
    maxIconLength: 500
  }
};

config.paths = {
  nav: path.join(dataDir, 'nav.json'),
  navBackup: path.join(dataDir, 'nav.json.bak'),
  users: path.join(dataDir, 'users.json'),
  usersBackup: path.join(dataDir, 'users.json.bak'),
  logs: path.join(dataDir, 'logs')
};

module.exports = config;
