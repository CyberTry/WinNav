'use strict';

const express = require('express');
const store = require('../store');
const favicon = require('../favicon');
const { E } = require('../errors');

const router = express.Router();

/**
 * GET /api/favicon/:id
 * 未设置图标时，由服务端代理抓取目标站点的 favicon 并回传图片。
 * 只允许已保存的服务，避免被当作任意 URL 代理。
 */
router.get('/favicon/:id', async (req, res, next) => {
  const service = store.listServices().find((s) => s.id === req.params.id);
  if (!service) return next(E.notFound('服务不存在'));
  if (service.icon) return next(E.notFound('该服务已有自定义图标'));

  try {
    const icon = await favicon.getForService(service);
    if (!icon) {
      res.setHeader('Cache-Control', 'public, max-age=300');
      return next(E.notFound('未能获取该站点的图标'));
    }

    if (req.headers['if-none-match'] === icon.etag) {
      res.status(304).end();
      return;
    }

    res.setHeader('Content-Type', icon.contentType);
    res.setHeader('Content-Length', String(icon.buffer.length));
    res.setHeader('ETag', icon.etag);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(icon.buffer);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
