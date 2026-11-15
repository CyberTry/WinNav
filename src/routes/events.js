'use strict';

const express = require('express');
const hub = require('../hub');

const router = express.Router();

router.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(': connected\n\n');

  const client = hub.addClient(res);
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping ' + Date.now() + '\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);
  heartbeat.unref();

  req.on('close', () => {
    clearInterval(heartbeat);
    hub.removeClient(client);
    try { res.end(); } catch { /* 忽略 */ }
  });
});

module.exports = router;
