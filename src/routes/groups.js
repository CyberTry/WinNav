'use strict';

const express = require('express');
const store = require('../store');
const hub = require('../hub');
const { requireAdmin } = require('../auth');
const { asyncHandler } = require('../errors');

const router = express.Router();
const asyncHandlerWrap = asyncHandler;

function notify() {
  hub.broadcast('config:changed', { scope: 'groups' });
}

router.get('/groups', (req, res) => {
  res.json({ ok: true, data: store.listGroups() });
});

router.post('/groups', requireAdmin, asyncHandlerWrap(async (req, res) => {
  const group = await store.createGroup(req.body || {});
  notify();
  res.status(201).json({ ok: true, data: group });
}));

router.patch('/groups/:id', requireAdmin, asyncHandlerWrap(async (req, res) => {
  const group = await store.updateGroup(req.params.id, req.body || {});
  notify();
  res.json({ ok: true, data: group });
}));

router.delete('/groups/:id', requireAdmin, asyncHandlerWrap(async (req, res) => {
  const group = await store.deleteGroup(req.params.id);
  notify();
  res.json({ ok: true, data: { id: group.id } });
}));

router.put('/groups/order', requireAdmin, asyncHandlerWrap(async (req, res) => {
  const ids = await store.reorderGroups((req.body || {}).ids);
  notify();
  res.json({ ok: true, data: { ids } });
}));

module.exports = router;
