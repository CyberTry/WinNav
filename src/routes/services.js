'use strict';

const express = require('express');
const store = require('../store');
const hub = require('../hub');
const probe = require('../probe');
const favicon = require('../favicon');
const { requireAdmin } = require('../auth');
const { asyncHandler } = require('../errors');

const router = express.Router();

function notify() {
  hub.broadcast('config:changed', { scope: 'services' });
}

router.get('/services', (req, res) => {
  res.json({ ok: true, data: store.listServices() });
});

router.post('/services', requireAdmin, asyncHandler(async (req, res) => {
  const service = await store.createService(req.body || {});
  notify();
  res.status(201).json({ ok: true, data: service });
}));

router.patch('/services/:id', requireAdmin, asyncHandler(async (req, res) => {
  const service = await store.updateService(req.params.id, req.body || {});
  // 地址或图标变化时丢弃缓存，下次请求重新抓取
  favicon.drop(service.id);
  notify();
  res.json({ ok: true, data: service });
}));

router.delete('/services/:id', requireAdmin, asyncHandler(async (req, res) => {
  const service = await store.deleteService(req.params.id);
  probe.dropService(service.id);
  favicon.drop(service.id);
  notify();
  res.json({ ok: true, data: { id: service.id } });
}));

router.put('/services/order', requireAdmin, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const ids = await store.reorderServices(body.groupId, body.ids);
  notify();
  res.json({ ok: true, data: { ids } });
}));

module.exports = router;
