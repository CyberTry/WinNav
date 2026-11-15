'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.logLevel] || LEVELS.info;

let stream = null;
let currentDay = '';
let streamBroken = false;

function todayLocal() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}

function ensureStream() {
  if (streamBroken) return null;
  try {
    fs.mkdirSync(config.paths.logs, { recursive: true });
    const day = todayLocal();
    if (day !== currentDay || !stream) {
      if (stream) stream.end();
      currentDay = day;
      stream = fs.createWriteStream(path.join(config.paths.logs, 'app-' + day + '.log'), { flags: 'a' });
      stream.on('error', () => { streamBroken = true; });
    }
    return stream;
  } catch {
    streamBroken = true;
    return null;
  }
}

function serializeMeta(meta) {
  if (!meta) return '';
  try {
    return ' ' + JSON.stringify(meta);
  } catch {
    return ' [meta 无法序列化]';
  }
}

function write(level, message, meta) {
  if ((LEVELS[level] || 0) < threshold) return;
  const line = new Date().toISOString() + ' ' + level.toUpperCase().padEnd(5) + ' ' + message + serializeMeta(meta);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  const s = ensureStream();
  if (s) s.write(line + '\n');
}

module.exports = {
  debug: (msg, meta) => write('debug', msg, meta),
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
  flush() {
    if (stream) stream.end();
  }
};
