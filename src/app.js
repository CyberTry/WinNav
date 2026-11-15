'use strict';

const path = require('node:path');
const express = require('express');

const config = require('./config');
const logger = require('./logger');
const auth = require('./auth');
const store = require('./store');
const status = require('./status');
const hub = require('./hub');
const { AppError } = require('./errors');

const stateRoutes = require('./routes/state');
const eventRoutes = require('./routes/events');
const groupRoutes = require('./routes/groups');
const serviceRoutes = require('./routes/services');
const faviconRoutes = require('./routes/favicon');
const accountRoutes = require('./routes/account');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.use(express.json({ limit: '1mb' }));

  // 访问日志
  app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      logger.debug('HTTP', {
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        ms: Math.round(ms),
        ip: auth.clientIp(req)
      });
    });
    next();
  });

  // CSRF：写接口要求同源 Origin
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const origin = req.headers.origin;
    if (!origin) return next();
    try {
      const originHost = new URL(origin).host;
      if (originHost !== req.headers.host) {
        return next(new AppError('CSRF_BLOCKED', '跨站请求已被拒绝', 403));
      }
    } catch {
      return next(new AppError('CSRF_BLOCKED', '来源无法识别', 403));
    }
    next();
  });

  app.use(auth.attachViewer);

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      data: {
        status: 'ok',
        uptimeSec: Math.round(process.uptime()),
        version: require('../package.json').version,
        services: store.listServices().length,
        groups: store.listGroups().length,
        sseClients: hub.count(),
        refreshing: status.isRefreshing(),
        lastRefresh: status.getSummary(),
        sessions: auth.sessionCount()
      }
    });
  });

  app.use('/api', stateRoutes);
  app.use('/api', eventRoutes);
  app.use('/api', groupRoutes);
  app.use('/api', serviceRoutes);
  app.use('/api', faviconRoutes);
  app.use('/api', accountRoutes);

  app.use('/api', (req, res) => {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: '接口不存在：' + req.method + ' ' + req.originalUrl } });
  });

  // 静态资源
  app.use(express.static(config.publicDir, {
    index: 'index.html',
    maxAge: 0,
    etag: true,
    extensions: ['html']
  }));

  app.get('/admin', (req, res) => res.sendFile(path.join(config.publicDir, 'admin.html')));
  app.get('/', (req, res) => res.sendFile(path.join(config.publicDir, 'index.html')));

  app.use((req, res) => {
    res.status(404).send('404 Not Found');
  });

  // 统一错误处理
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err instanceof AppError ? err.status : 500;
    if (status >= 500) logger.error('请求处理失败', { path: req.originalUrl, error: err.message, stack: err.stack });
    else logger.debug('请求被拒绝', { path: req.originalUrl, code: err.code, message: err.message });
    res.status(status).json({
      ok: false,
      error: {
        code: err.code || 'INTERNAL_ERROR',
        message: status >= 500 ? '服务器内部错误' : (err.message || '请求失败')
      }
    });
  });

  return app;
}

module.exports = { createApp };
