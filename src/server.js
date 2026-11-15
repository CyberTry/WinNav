'use strict';

const http = require('node:http');
const config = require('./config');
const logger = require('./logger');
const store = require('./store');
const users = require('./users');
const status = require('./status');
const hub = require('./hub');
const { createApp } = require('./app');

async function main() {
  await store.init();
  await users.init();

  const app = createApp();
  const server = http.createServer(app);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error('端口已被占用', { port: config.port });
    } else {
      logger.error('HTTP 服务异常', { error: err.message });
    }
    process.exitCode = 1;
  });

  await new Promise((resolve) => server.listen(config.port, config.host, resolve));

  logger.info('WinNav 已启动', {
    url: 'http://' + (config.host === '0.0.0.0' ? '127.0.0.1' : config.host) + ':' + config.port,
    dataDir: config.dataDir,
    node: process.version
  });

  const admin = require('./users').findByUsername(config.admin.username);
  if (admin && admin.mustChangePassword) {
    logger.warn('管理员仍在使用默认口令，请登录 /admin 后立即修改', { username: admin.username });
  }

  status.startScheduler();

  const shutdown = (signal) => {
    logger.info('收到退出信号，正在关闭', { signal });
    status.stopScheduler();
    hub.closeAll();
    server.close(() => {
      logger.flush();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.error('未捕获异常', { error: err.message, stack: err.stack });
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('未处理的 Promise 拒绝', { reason: String(reason) });
  });
}

main().catch((err) => {
  logger.error('启动失败', { error: err.message, stack: err.stack });
  process.exit(1);
});
