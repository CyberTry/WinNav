'use strict';

const express = require('express');
const auth = require('../auth');
const users = require('../users');
const store = require('../store');
const status = require('../status');
const { E, asyncHandler } = require('../errors');
const { normalizeUrl } = require('../url');
const hub = require('../hub');

const router = express.Router();

router.post('/login', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password) throw E.invalid('请输入用户名与口令');

  const user = auth.login(req, res, username, password);
  res.json({
    ok: true,
    data: {
      username: user.username,
      role: user.role,
      mustChangePassword: user.mustChangePassword
    }
  });
}));

router.post('/logout', (req, res) => {
  auth.logout(req, res);
  res.json({ ok: true, data: { loggedOut: true } });
});

router.get('/account', auth.requireAdmin, (req, res) => {
  res.json({
    ok: true,
    data: {
      username: req.viewer.username,
      role: req.viewer.role,
      mustChangePassword: req.viewer.mustChangePassword
    }
  });
});

router.patch('/account', auth.requireAdmin, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const updated = await users.changeCredentials(req.viewer.id, {
    currentPassword: body.currentPassword,
    newUsername: body.newUsername,
    newPassword: body.newPassword
  });

  auth.logoutOthers(req.viewer.id, req.viewer.sid);

  res.json({
    ok: true,
    data: {
      username: updated.username,
      role: updated.role,
      mustChangePassword: updated.mustChangePassword
    }
  });
}));

router.post('/probe/test', auth.requireAdmin, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const raw = String(body.url || '').trim();
  if (!raw) throw E.invalid('请填写访问地址');
  auth.consumeProbeQuota(auth.clientIp(req));

  const url = normalizeUrl(raw);
  const result = await status.probeOne(url);
  res.json({ ok: true, data: result });
}));

router.get('/export', auth.requireAdmin, (req, res) => {
  const snapshot = store.snapshot();
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="winnav-config-' + stamp + '.json"');
  res.send(JSON.stringify(snapshot, null, 2));
});

router.post('/import', auth.requireAdmin, asyncHandler(async (req, res) => {
  const payload = req.body || {};
  const next = await store.replaceAll(payload);
  hub.broadcast('config:changed', { scope: 'import' });
  res.json({ ok: true, data: { groups: next.groups.length, services: next.services.length } });
}));

module.exports = router;
