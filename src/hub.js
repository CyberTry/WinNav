'use strict';

const logger = require('./logger');

const clients = new Set();

function addClient(res) {
  const client = { res, alive: true };
  clients.add(client);
  return client;
}

function removeClient(client) {
  clients.delete(client);
}

function send(client, event, payload) {
  try {
    client.res.write('event: ' + event + '\n');
    client.res.write('data: ' + JSON.stringify(payload) + '\n\n');
  } catch (err) {
    logger.debug('SSE 写入失败，移除客户端', { error: err.message });
    clients.delete(client);
  }
}

function broadcast(event, payload) {
  for (const client of clients) send(client, event, payload);
}

function closeAll() {
  for (const client of clients) {
    try {
      client.res.end();
    } catch { /* 忽略 */ }
  }
  clients.clear();
}

module.exports = {
  addClient,
  removeClient,
  send,
  broadcast,
  closeAll,
  count: () => clients.size
};
