'use strict';

const express = require('express');
const store = require('../store');
const status = require('../status');
const probe = require('../probe');
const hub = require('../hub');
const { requireAdmin } = require('../auth');
const { asyncHandler } = require('../errors');

const router = express.Router();

router.get('/state', (req, res) => {
  res.json({ ok: true, data: status.publicState(req.viewer) });
});

router.post('/state/refresh', (req, res) => {
  const result = status.refreshAll({ force: true });
  res.json({ ok: true, data: { refreshing: true, coalesced: result.coalesced } });
});

router.get('/status', (req, res) => {
  const snapshot = store.snapshot();
  res.json({
    ok: true,
    data: {
      statuses: probe.getStatuses(),
      refreshing: status.isRefreshing(),
      summary: status.getSummary(),
      total: snapshot.services.filter((s) => s.enabled !== false).length
    }
  });
});

router.patch('/settings', requireAdmin, asyncHandler(async (req, res) => {
  const settings = await store.updateSettings(req.body || {});
  status.startScheduler();
  hub.broadcast('config:changed', { scope: 'settings' });
  res.json({ ok: true, data: settings });
}));

module.exports = router;
