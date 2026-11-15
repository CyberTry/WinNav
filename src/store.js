'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const config = require('./config');
const logger = require('./logger');
const { E } = require('./errors');
const { normalizeUrl } = require('./url');

let data = null;
let writeChain = Promise.resolve();

function newId(prefix) {
  return prefix + crypto.randomBytes(6).toString('hex');
}

function defaultData() {
  return {
    version: 1,
    settings: {
      siteTitle: config.defaults.siteTitle,
      theme: 'dark',
      probe: Object.assign({}, config.defaults.probe)
    },
    groups: [
      { id: 'g_default', name: '默认分组', order: 0, accent: '#7c5cff' }
    ],
    services: []
  };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 校验并修正数据结构；返回错误信息数组（空数组表示通过） */
function validateShape(input) {
  const problems = [];
  if (!isObject(input)) return ['数据根节点必须是对象'];
  if (input.version !== 1) problems.push('version 必须为 1');
  if (!Array.isArray(input.groups)) problems.push('groups 必须是数组');
  if (!Array.isArray(input.services)) problems.push('services 必须是数组');
  if (problems.length) return problems;
  if (input.groups.length === 0) problems.push('至少需要保留一个分组');

  const groupIds = new Set();
  input.groups.forEach((g, i) => {
    if (!isObject(g)) { problems.push('groups[' + i + '] 必须是对象'); return; }
    if (typeof g.id !== 'string' || !g.id) problems.push('groups[' + i + '].id 缺失');
    else if (groupIds.has(g.id)) problems.push('分组 id 重复：' + g.id);
    else groupIds.add(g.id);
    if (typeof g.name !== 'string' || !g.name.trim()) problems.push('groups[' + i + '].name 缺失');
  });

  input.services.forEach((s, i) => {
    if (!isObject(s)) { problems.push('services[' + i + '] 必须是对象'); return; }
    if (typeof s.id !== 'string' || !s.id) problems.push('services[' + i + '].id 缺失');
    if (typeof s.name !== 'string' || !s.name.trim()) problems.push('services[' + i + '].name 缺失');
    if (typeof s.url !== 'string' || !s.url) problems.push('services[' + i + '].url 缺失');
    if (!groupIds.has(s.groupId)) problems.push('services[' + i + '] 引用了不存在的分组：' + s.groupId);
  });

  return problems;
}

function normalizeOrders(target) {
  const groups = target.groups.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  groups.forEach((g, i) => { g.order = i; });
  target.groups = groups;

  for (const group of target.groups) {
    const list = target.services.filter((s) => s.groupId === group.id)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    list.forEach((s, i) => { s.order = i; });
  }
  const sorted = [];
  for (const group of target.groups) {
    sorted.push(...target.services.filter((s) => s.groupId === group.id)
      .sort((a, b) => (a.order || 0) - (b.order || 0)));
  }
  const orphans = target.services.filter((s) => !target.groups.some((g) => g.id === s.groupId));
  target.services = sorted.concat(orphans);
}

function fillDefaults(target) {
  if (!isObject(target.settings)) target.settings = {};
  const settings = target.settings;
  if (typeof settings.siteTitle !== 'string' || !settings.siteTitle) settings.siteTitle = config.defaults.siteTitle;
  if (typeof settings.theme !== 'string') settings.theme = 'dark';
  settings.probe = Object.assign({}, config.defaults.probe, isObject(settings.probe) ? settings.probe : {});

  target.groups.forEach((g, i) => {
    if (typeof g.accent !== 'string' || !g.accent) g.accent = ['#7c5cff', '#25d0ff', '#34e0a1', '#ff4fd8', '#ffc857', '#ff9a4d'][i % 6];
    if (!Number.isInteger(g.order)) g.order = i;
  });
  target.services.forEach((s, i) => {
    if (typeof s.description !== 'string') s.description = '';
    if (typeof s.icon !== 'string') s.icon = '';
    if (typeof s.enabled !== 'boolean') s.enabled = true;
    if (!Number.isInteger(s.order)) s.order = i;
    if (!isObject(s.probe)) s.probe = { mode: 'inherit', timeoutMs: null };
  });
  normalizeOrders(target);
  return target;
}

async function readJson(file) {
  const text = await fsp.readFile(file, 'utf8');
  return JSON.parse(text);
}

/** 原子写：临时文件 + fsync + 备份 + rename */
async function atomicWrite(file, backupFile, payload) {
  const dir = path.dirname(file);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = file + '.tmp';
  const text = JSON.stringify(payload, null, 2) + '\n';

  const handle = await fsp.open(tmp, 'w');
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await fsp.copyFile(file, backupFile);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  await fsp.rename(tmp, file);
}

async function init() {
  await fsp.mkdir(config.dataDir, { recursive: true });

  let loaded = null;
  let primaryError = null;

  if (fs.existsSync(config.paths.nav)) {
    try {
      const parsed = await readJson(config.paths.nav);
      const problems = validateShape(parsed);
      if (problems.length) throw new Error(problems.join('；'));
      loaded = fillDefaults(parsed);
    } catch (err) {
      primaryError = err;
      logger.warn('nav.json 读取失败，尝试从备份恢复', { error: err.message });
    }
  }

  if (!loaded && fs.existsSync(config.paths.navBackup)) {
    try {
      const parsed = await readJson(config.paths.navBackup);
      const problems = validateShape(parsed);
      if (problems.length) throw new Error(problems.join('；'));
      loaded = fillDefaults(parsed);
      logger.warn('已从 nav.json.bak 恢复配置');
    } catch (err) {
      logger.error('备份文件同样无法读取', { error: err.message });
    }
  }

  if (!loaded) {
    if (primaryError) {
      throw new Error('配置文件损坏且无可用备份：' + primaryError.message);
    }
    loaded = defaultData();
    logger.info('未找到配置文件，已创建默认配置');
    await atomicWrite(config.paths.nav, config.paths.navBackup, loaded);
  }

  data = loaded;
  return snapshot();
}

function snapshot() {
  if (!data) throw E.internal('存储尚未初始化');
  return JSON.parse(JSON.stringify(data));
}

function settings() {
  return snapshot().settings;
}

/**
 * 串行修改：mutator 拿到的是一份深拷贝，成功返回后才会落盘。
 * 抛错时不改动内存数据。
 */
function mutate(mutator) {
  const run = async () => {
    const draft = snapshot();
    const result = mutator(draft);
    fillDefaults(draft);
    await atomicWrite(config.paths.nav, config.paths.navBackup, draft);
    data = draft;
    return result;
  };
  const next = writeChain.then(run, run);
  writeChain = next.catch(() => {});
  return next;
}

/* ================= 分组 ================= */

function listGroups() {
  return snapshot().groups;
}

async function createGroup(input) {
  const name = String(input.name || '').trim();
  if (!name) throw E.invalid('请填写分组名称');
  if (name.length > 40) throw E.invalid('分组名称不能超过 40 个字符');
  return mutate((draft) => {
    if (draft.groups.some((g) => g.name === name)) throw E.conflict('已存在同名分组');
    const group = {
      id: newId('g_'),
      name,
      order: draft.groups.length,
      accent: String(input.accent || '').trim() || undefined
    };
    draft.groups.push(group);
    return group;
  });
}

async function updateGroup(id, patch) {
  return mutate((draft) => {
    const group = draft.groups.find((g) => g.id === id);
    if (!group) throw E.notFound('分组不存在');
    if (patch.name !== undefined) {
      const name = String(patch.name).trim();
      if (!name) throw E.invalid('分组名称不能为空');
      if (draft.groups.some((g) => g.id !== id && g.name === name)) throw E.conflict('已存在同名分组');
      group.name = name;
    }
    if (patch.accent !== undefined) group.accent = String(patch.accent).trim() || group.accent;
    if (Number.isInteger(patch.order)) group.order = patch.order;
    return group;
  });
}

async function deleteGroup(id) {
  return mutate((draft) => {
    const index = draft.groups.findIndex((g) => g.id === id);
    if (index === -1) throw E.notFound('分组不存在');
    const used = draft.services.filter((s) => s.groupId === id);
    if (used.length) throw E.conflict('请先移动或删除该分组下的 ' + used.length + ' 个服务');
    if (draft.groups.length === 1) throw E.conflict('至少需要保留一个分组');
    const [removed] = draft.groups.splice(index, 1);
    return removed;
  });
}

async function reorderGroups(ids) {
  if (!Array.isArray(ids)) throw E.invalid('ids 必须是数组');
  return mutate((draft) => {
    const known = new Set(draft.groups.map((g) => g.id));
    const cleaned = ids.filter((id) => known.has(id));
    const rest = draft.groups.map((g) => g.id).filter((id) => !cleaned.includes(id));
    const order = cleaned.concat(rest);
    draft.groups = order.map((id, index) => {
      const group = draft.groups.find((g) => g.id === id);
      group.order = index;
      return group;
    });
    return order;
  });
}

/* ================= 服务 ================= */

function listServices() {
  return snapshot().services;
}

function sanitizeServiceInput(input, draft, existingId) {
  const name = String(input.name ?? '').trim();
  if (!name) throw E.invalid('请填写服务名称');
  if (name.length > config.limits.maxNameLength) throw E.invalid('服务名称过长');
  if (input.description !== undefined && String(input.description).length > config.limits.maxDescriptionLength) {
    throw E.invalid('描述过长');
  }
  if (input.icon !== undefined && String(input.icon).length > config.limits.maxIconLength) {
    throw E.invalid('图标地址过长');
  }
  if (input.groupId !== undefined && !draft.groups.some((g) => g.id === input.groupId)) {
    throw E.invalid('分组不存在');
  }
  return {
    name,
    description: input.description === undefined ? '' : String(input.description).trim(),
    groupId: input.groupId,
    url: input.url === undefined ? undefined : normalizeUrl(input.url),
    icon: input.icon === undefined ? '' : String(input.icon).trim(),
    enabled: input.enabled === undefined ? true : Boolean(input.enabled),
    order: Number.isInteger(input.order) ? input.order : undefined
  };
}

async function createService(input) {
  return mutate((draft) => {
    const clean = sanitizeServiceInput(input, draft);
    if (!clean.groupId) throw E.invalid('请选择所属分组');
    if (!clean.url) throw E.invalid('请填写访问地址');
    const siblings = draft.services.filter((s) => s.groupId === clean.groupId);
    const service = {
      id: newId('s_'),
      groupId: clean.groupId,
      name: clean.name,
      description: clean.description,
      url: clean.url,
      icon: clean.icon,
      order: clean.order === undefined ? siblings.length : clean.order,
      enabled: clean.enabled,
      probe: { mode: 'inherit', timeoutMs: null }
    };
    draft.services.push(service);
    return service;
  });
}

async function updateService(id, patch) {
  return mutate((draft) => {
    const service = draft.services.find((s) => s.id === id);
    if (!service) throw E.notFound('服务不存在');
    const clean = sanitizeServiceInput({
      name: patch.name === undefined ? service.name : patch.name,
      description: patch.description === undefined ? service.description : patch.description,
      groupId: patch.groupId === undefined ? service.groupId : patch.groupId,
      url: patch.url === undefined ? service.url : patch.url,
      icon: patch.icon === undefined ? service.icon : patch.icon,
      enabled: patch.enabled === undefined ? service.enabled : patch.enabled,
      order: patch.order === undefined ? service.order : patch.order
    }, draft, id);

    service.name = clean.name;
    service.description = clean.description;
    service.groupId = clean.groupId || service.groupId;
    service.url = clean.url || service.url;
    service.icon = clean.icon;
    service.enabled = clean.enabled;
    if (clean.order !== undefined) service.order = clean.order;
    if (patch.probe && typeof patch.probe === 'object') {
      service.probe = {
        mode: ['inherit', 'tcp', 'http', 'icmp'].includes(patch.probe.mode) ? patch.probe.mode : 'inherit',
        timeoutMs: Number.isInteger(patch.probe.timeoutMs) ? patch.probe.timeoutMs : null
      };
    }
    return service;
  });
}

async function deleteService(id) {
  return mutate((draft) => {
    const index = draft.services.findIndex((s) => s.id === id);
    if (index === -1) throw E.notFound('服务不存在');
    const [removed] = draft.services.splice(index, 1);
    return removed;
  });
}

async function reorderServices(groupId, ids) {
  if (!Array.isArray(ids)) throw E.invalid('ids 必须是数组');
  return mutate((draft) => {
    if (groupId && !draft.groups.some((g) => g.id === groupId)) throw E.notFound('分组不存在');
    const inGroup = draft.services.filter((s) => s.groupId === groupId);
    const known = new Set(inGroup.map((s) => s.id));
    const cleaned = ids.filter((id) => known.has(id));
    const rest = inGroup.map((s) => s.id).filter((id) => !cleaned.includes(id));
    const order = cleaned.concat(rest);
    order.forEach((id, index) => {
      const service = draft.services.find((s) => s.id === id);
      if (service) service.order = index;
    });
    return order;
  });
}

async function updateSettings(patch) {
  return mutate((draft) => {
    if (patch.siteTitle !== undefined) {
      const title = String(patch.siteTitle).trim();
      if (!title) throw E.invalid('站点标题不能为空');
      draft.settings.siteTitle = title.slice(0, 60);
    }
    if (patch.theme !== undefined) draft.settings.theme = String(patch.theme);
    if (patch.probe && typeof patch.probe === 'object') {
      const probe = draft.settings.probe;
      if (Number.isInteger(patch.probe.timeoutMs)) probe.timeoutMs = Math.min(30000, Math.max(200, patch.probe.timeoutMs));
      if (Number.isInteger(patch.probe.concurrency)) probe.concurrency = Math.min(64, Math.max(1, patch.probe.concurrency));
      if (Number.isInteger(patch.probe.cacheTtlMs)) probe.cacheTtlMs = Math.max(0, patch.probe.cacheTtlMs);
      if (Number.isInteger(patch.probe.intervalSec)) probe.intervalSec = Math.max(0, patch.probe.intervalSec);
      if (typeof patch.probe.httpCheck === 'boolean') probe.httpCheck = patch.probe.httpCheck;
      if (['tcp', 'http', 'icmp'].includes(patch.probe.mode)) probe.mode = patch.probe.mode;
    }
    return draft.settings;
  });
}

/** 导入：整体替换（保留 id 合法性校验） */
async function replaceAll(payload) {
  const problems = validateShape(payload);
  if (problems.length) throw E.invalid('配置格式不正确：' + problems.join('；'));
  const next = fillDefaults(JSON.parse(JSON.stringify(payload)));
  return mutate((draft) => {
    draft.settings = next.settings;
    draft.groups = next.groups;
    draft.services = next.services;
    return draft;
  }).then(() => snapshot());
}

module.exports = {
  init,
  snapshot,
  settings,
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  reorderGroups,
  listServices,
  createService,
  updateService,
  deleteService,
  reorderServices,
  updateSettings,
  replaceAll
};
