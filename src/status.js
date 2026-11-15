'use strict';

const config = require('./config');
const logger = require('./logger');
const store = require('./store');
const probe = require('./probe');
const hub = require('./hub');

let refreshing = null;
let timer = null;
let lastSummary = null;

function enabledServices() {
  return store.listServices().filter((s) => s.enabled !== false);
}

function publicState(viewer) {
  const snapshot = store.snapshot();
  const statuses = probe.getStatuses();
  return {
    settings: snapshot.settings,
    groups: snapshot.groups,
    services: snapshot.services,
    statuses,
    refreshing: Boolean(refreshing),
    summary: lastSummary,
    viewer: viewer
      ? { authenticated: true, username: viewer.username, role: viewer.role, mustChangePassword: viewer.mustChangePassword }
      : { authenticated: false }
  };
}

/**
 * 全量刷新：进行中再次调用直接合并（不重复探测）。
 * 每完成一个服务就通过 SSE 推送 status 事件。
 */
function refreshAll(options) {
  const opts = options || {};
  if (refreshing) return { coalesced: true, promise: refreshing };

  const settings = store.settings();
  const services = enabledServices();
  const startedAt = Date.now();
  const concurrency = (settings.probe && settings.probe.concurrency) || 8;

  hub.broadcast('refresh:start', { total: services.length });

  const promise = probe.runPool(services, concurrency, async (service) => {
    const status = await probe.probeCached(service, settings, Boolean(opts.force));
    hub.broadcast('status', Object.assign({ id: service.id }, status));
  }).then(() => {
    const statuses = probe.getStatuses();
    lastSummary = Object.assign(probe.summarize(services, statuses), {
      durationMs: Date.now() - startedAt,
      finishedAt: Date.now()
    });
    hub.broadcast('refresh:done', lastSummary);
    logger.debug('状态刷新完成', lastSummary);
    return lastSummary;
  }).catch((err) => {
    logger.error('状态刷新失败', { error: err.message });
    throw err;
  }).finally(() => {
    refreshing = null;
    dropOrphans();
  });

  refreshing = promise;
  return { coalesced: false, promise };
}

function dropOrphans() {
  probe.dropMissing(store.listServices().map((s) => s.id));
}

function probeOne(url) {
  return probe.probeService({ id: 'probe_test', url: url, probe: { mode: 'inherit', timeoutMs: 1500 } }, store.settings());
}

/** 可选后台定时探测（settings.probe.intervalSec > 0 时启用） */
function startScheduler() {
  stopScheduler();
  const settings = store.settings();
  const seconds = (settings.probe && settings.probe.intervalSec) || 0;
  if (seconds <= 0) return;
  timer = setInterval(() => {
    if (!refreshing) refreshAll().promise.catch(() => {});
  }, Math.max(10, seconds) * 1000);
  timer.unref();
  logger.info('已启用定时探测', { intervalSec: seconds });
}

function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

function isRefreshing() {
  return Boolean(refreshing);
}

module.exports = {
  refreshAll,
  probeOne,
  publicState,
  startScheduler,
  stopScheduler,
  isRefreshing,
  getSummary: () => lastSummary
};
