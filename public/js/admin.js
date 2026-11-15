/* ==========================================================
   WinNav · 管理台脚本
   - API 模式：/api/login、/api/services、/api/groups、/api/account
   - 预览模式：后端不可用时用 localStorage 模拟，方便静态页面演示
   ========================================================== */
(function () {
  'use strict';

  var API = {
    state: '/api/state',
    login: '/api/login',
    logout: '/api/logout',
    account: '/api/account',
    services: '/api/services',
    groups: '/api/groups',
    probeTest: '/api/probe/test',
    refresh: '/api/state/refresh'
  };

  var PREVIEW_KEY = 'winnav.preview.data';
  var SESSION_KEY = 'winnav.preview.session';

  var MODE = 'api';
  var data = { groups: [], services: [], settings: {} };
  var viewer = { authenticated: false, username: null, mustChangePassword: false };
  var statuses = new Map();
  var editingSvc = null;
  var editingGrp = null;

  var ACCENTS = ['#7c5cff', '#25d0ff', '#34e0a1', '#ff4fd8', '#ffc857', '#ff9a4d'];
  var ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4.5 12.5 5 5 10-11"/></svg>';
  var ICON_BAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/></svg>';

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function pad2(n) { return String(n).padStart(2, '0'); }

  /* ================= 基础请求 ================= */
  function api(path, options) {
    var opts = options || {};
    return fetch(path, {
      method: opts.method || 'GET',
      headers: Object.assign({ Accept: 'application/json' }, opts.body ? { 'Content-Type': 'application/json' } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin'
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (json) {
        if (!res.ok || !json || json.ok === false) {
          var err = new Error((json && json.error && json.error.message) || ('请求失败 ' + res.status));
          err.code = json && json.error && json.error.code;
          err.status = res.status;
          throw err;
        }
        return json.data;
      });
    });
  }

  /* ================= Toast ================= */
  function toast(message, kind) {
    var box = el('div', 'toast ' + (kind || 'ok'));
    box.innerHTML = kind === 'bad' ? ICON_BAD : ICON_OK;
    box.appendChild(el('span', null, message));
    $('toasts').appendChild(box);
    setTimeout(function () {
      box.classList.add('out');
      setTimeout(function () { box.remove(); }, 280);
    }, 2800);
  }

  /* ================= 表单错误 ================= */
  function showError(nodeId, textId, message) {
    var box = $(nodeId);
    if (!box) return;
    if (!message) { box.classList.remove('show'); return; }
    $(textId).textContent = message;
    box.classList.add('show');
  }
  function setBusy(btn, busy) {
    if (!btn) return;
    btn.disabled = busy;
    btn.classList.toggle('loading', busy);
  }

  /* ================= 预览模式存储 ================= */
  function seedPreview() {
    var mock = window.WINNAV_MOCK || { groups: [], services: [] };
    var seeded = {
      settings: mock.settings || {},
      groups: (mock.groups || []).map(function (g) { return Object.assign({}, g); }),
      services: (mock.services || []).map(function (s) {
        return {
          id: s.id, groupId: s.groupId, name: s.name, description: s.description,
          url: s.url, icon: s.icon, order: s.order, enabled: s.enabled !== false
        };
      }),
      account: { username: 'admin', password: '123456' }
    };
    writePreview(seeded);
    return seeded;
  }
  function readPreview() {
    try {
      var raw = localStorage.getItem(PREVIEW_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.groups && parsed.services) return parsed;
      }
    } catch (e) { /* 忽略 */ }
    return seedPreview();
  }
  function writePreview(next) {
    try { localStorage.setItem(PREVIEW_KEY, JSON.stringify(next)); } catch (e) { /* 忽略 */ }
  }
  function previewAccount() {
    var p = readPreview();
    if (!p.account) p.account = { username: 'admin', password: '123456' };
    return p.account;
  }
  function previewSession() {
    try { return sessionStorage.getItem(SESSION_KEY) === '1'; } catch (e) { return false; }
  }
  function setPreviewSession(on) {
    try {
      if (on) sessionStorage.setItem(SESSION_KEY, '1');
      else sessionStorage.removeItem(SESSION_KEY);
    } catch (e) { /* 忽略 */ }
  }

  /* ================= 数据装配 ================= */
  function normalizeUrl(raw) {
    var value = String(raw || '').trim();
    if (!value) return { href: '', display: '' };
    var href = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : 'http://' + value;
    return { href: href, display: value.replace(/^https?:\/\//i, '') };
  }

  function applyState(payload) {
    data.groups = payload.groups || [];
    data.services = payload.services || [];
    data.settings = payload.settings || {};
    if (payload.statuses) {
      statuses = new Map();
      Object.keys(payload.statuses).forEach(function (id) { statuses.set(id, payload.statuses[id]); });
    }
    data.groups.forEach(function (g, i) { if (!g.accent) g.accent = ACCENTS[i % ACCENTS.length]; });
    data.services.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  }

  function markMode() {
    if (MODE === 'api') {
      $('modeBanner').classList.remove('show');
      $('gateMode').textContent = '已连接服务端';
      return;
    }
    $('modeBanner').classList.add('show');
    $('modeBannerText').textContent = '静态预览模式：数据保存在浏览器 localStorage，不会写入服务器。';
    $('gateMode').textContent = '静态预览模式 · 默认 admin / 123456';
  }

  /* ================= 登录 / 登出 ================= */
  function showGate(message) {
    $('gate').hidden = false;
    $('shell').hidden = true;
    $('whoBadge').hidden = true;
    $('logoutBtn').hidden = true;
    if (message) showError('loginError', 'loginErrorText', message);
    var user = $('loginUser');
    if (!user.value) user.value = 'admin';
    setTimeout(function () { $('loginPass').focus(); }, 80);
  }

  function enterShell() {
    $('gate').hidden = true;
    $('shell').hidden = false;
    var name = viewer.username || 'admin';
    $('whoName').textContent = name;
    $('whoAvatar').textContent = name.slice(0, 1).toUpperCase();
    $('whoBadge').hidden = false;
    $('logoutBtn').hidden = false;
    $('accUser').value = name;
    $('pwdBanner').classList.toggle('show', Boolean(viewer.mustChangePassword));
    renderServices();
    renderGroups();
    fillGroupSelect();
  }

  function doLogin(username, password) {
    if (MODE === 'api') {
      return api(API.login, { method: 'POST', body: { username: username, password: password } })
        .then(function (res) {
          viewer = {
            authenticated: true,
            username: res.username || username,
            mustChangePassword: Boolean(res.mustChangePassword)
          };
          return api(API.state);
        })
        .then(function (payload) {
          applyState(payload);
          if (payload.viewer) viewer.mustChangePassword = Boolean(payload.viewer.mustChangePassword);
          enterShell();
          toast('登录成功，欢迎回来 ' + viewer.username);
        });
    }

    var account = previewAccount();
    if (String(account.username).toLowerCase() !== String(username).toLowerCase() || account.password !== password) {
      return Promise.reject(new Error('用户名或口令错误'));
    }
    viewer = {
      authenticated: true,
      username: account.username,
      mustChangePassword: account.password === '123456'
    };
    setPreviewSession(true);
    applyState(readPreview());
    enterShell();
    toast('登录成功（预览模式）');
    return Promise.resolve();
  }

  function doLogout() {
    var done = function () {
      viewer = { authenticated: false, username: null, mustChangePassword: false };
      setPreviewSession(false);
      showGate();
      toast('已退出登录');
    };
    if (MODE === 'api') {
      api(API.logout, { method: 'POST' }).then(done).catch(done);
    } else {
      done();
    }
  }

  /* ================= 服务表格 ================= */
  function iconMini(svc) {
    var box = el('div', 'mini');
    var icon = svc.icon || '';
    var fallback = function () {
      box.replaceChildren(document.createTextNode(svc.name.slice(0, 1).toUpperCase()));
    };

    if (/^https?:\/\//i.test(icon) || icon.indexOf('/icons/') === 0) {
      var img = document.createElement('img');
      img.src = icon;
      img.alt = '';
      img.addEventListener('error', fallback);
      box.appendChild(img);
      return box;
    }

    if (!icon.trim()) {
      var src = '';
      if (MODE === 'api') {
        src = '/api/favicon/' + encodeURIComponent(svc.id);
      } else {
        var url = normalizeUrl(svc.url);
        try { if (url.href) src = new URL(url.href).origin + '/favicon.ico'; } catch (e) { src = ''; }
      }
      if (src) {
        box.classList.add('auto-icon');
        var fav = document.createElement('img');
        fav.src = src;
        fav.alt = '';
        fav.loading = 'lazy';
        fav.referrerPolicy = 'no-referrer';
        fav.addEventListener('error', fallback);
        box.appendChild(fav);
        return box;
      }
    }

    box.textContent = icon || svc.name.slice(0, 1).toUpperCase();
    return box;
  }

  function stateOf(id) {
    if (statuses.has(id)) return statuses.get(id);
    return null;
  }

  function renderServices() {
    var body = $('svcBody');
    body.replaceChildren();
    $('tabSvcCount').textContent = String(data.services.length);
    $('svcEmpty').hidden = data.services.length !== 0;

    var on = data.services.filter(function (s) { return s.enabled !== false; }).length;
    $('svcSummary').textContent = data.services.length + ' 个服务 · ' + on + ' 个参与探测';

    data.services.forEach(function (svc) {
      var group = data.groups.find(function (g) { return g.id === svc.groupId; });
      var accent = group ? group.accent : ACCENTS[0];
      var tr = el('tr');
      if (svc.enabled === false) tr.classList.add('disabled-row');

      var tdOrder = el('td');
      var idx = el('span', 'mono', String((svc.order || 0) + 1));
      idx.style.maxWidth = '24px';
      idx.style.color = '#6f7899';
      tdOrder.appendChild(idx);

      var tdName = el('td');
      var cell = el('div', 'cell-name');
      var mini = iconMini(svc);
      mini.style.boxShadow = '0 8px 20px -14px ' + accent;
      var txt = el('div', 'txt');
      txt.appendChild(el('div', 't', svc.name));
      txt.appendChild(el('div', 'd', svc.description || '—'));
      cell.append(mini, txt);
      tdName.appendChild(cell);

      var tdUrl = el('td');
      var url = normalizeUrl(svc.url);
      var urlNode = el('span', 'mono', url.display || '—');
      urlNode.title = url.href;
      tdUrl.appendChild(urlNode);

      var tdState = el('td');
      var st = stateOf(svc.id);
      var pill = el('span', 'pill-state');
      if (svc.enabled === false) {
        pill.className = 'pill-state';
        pill.textContent = '已停用';
      } else if (!st || st.state === 'unknown') {
        pill.className = 'pill-state wait';
        pill.textContent = '未探测';
      } else if (st.state === 'online') {
        pill.className = 'pill-state on';
        pill.textContent = '在线' + (typeof st.latencyMs === 'number' ? ' · ' + (st.latencyMs < 1 ? '<1' : st.latencyMs) + ' ms' : '');
      } else {
        pill.className = 'pill-state off';
        pill.textContent = '离线';
        if (st.error) pill.title = st.error;
      }
      tdState.appendChild(pill);

      var tdEnable = el('td');
      var sw = el('label', 'switch');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = svc.enabled !== false;
      cb.setAttribute('aria-label', '启用 ' + svc.name);
      cb.addEventListener('change', function () {
        cb.disabled = true;
        saveService(svc.id, { enabled: cb.checked }, true).catch(function () { cb.checked = !cb.checked; })
          .then(function () { cb.disabled = false; });
      });
      sw.append(cb, el('span', 'track'));
      tdEnable.appendChild(sw);

      var tdAct = el('td');
      var actions = el('div', 'row-actions');
      var edit = el('button', 'btn sm', '编辑');
      edit.type = 'button';
      edit.addEventListener('click', function () { openSvcDialog(svc); });
      var del = el('button', 'btn sm danger', '删除');
      del.type = 'button';
      del.addEventListener('click', function () { removeService(svc); });
      actions.append(edit, del);
      tdAct.appendChild(actions);

      tr.append(tdOrder, tdName, tdUrl, tdState, tdEnable, tdAct);
      body.appendChild(tr);
    });
  }

  /* ================= 分组列表 ================= */
  function renderGroups() {
    var list = $('groupList');
    list.replaceChildren();
    $('tabGrpCount').textContent = String(data.groups.length);
    $('grpEmpty').hidden = data.groups.length !== 0;

    data.groups.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); })
      .forEach(function (group) {
        var count = data.services.filter(function (s) { return s.groupId === group.id; }).length;
        var item = el('div', 'group-item');
        item.style.setProperty('--accent', group.accent);

        var dot = el('span', 'gdot');
        var swatch = el('span', 'color-swatch');
        swatch.style.background = group.accent;
        var info = el('span');
        info.appendChild(el('span', 'gname', group.name));
        info.appendChild(document.createTextNode(' '));
        info.appendChild(el('span', 'gcount', count + ' 个服务'));

        var spacer = el('span', 'spacer');
        var edit = el('button', 'btn sm', '重命名');
        edit.type = 'button';
        edit.addEventListener('click', function () { openGrpDialog(group); });
        var del = el('button', 'btn sm danger', '删除');
        del.type = 'button';
        del.disabled = count > 0;
        if (count > 0) del.title = '请先移动或删除该分组下的服务';
        del.addEventListener('click', function () { removeGroup(group, count); });

        item.append(dot, swatch, info, spacer, edit, del);
        list.appendChild(item);
      });
  }

  function fillGroupSelect(selected) {
    var select = $('svcGroup');
    select.replaceChildren();
    data.groups.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); })
      .forEach(function (g) {
        var opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = g.name;
        select.appendChild(opt);
      });
    if (selected) select.value = selected;
  }

  /* ================= 增删改 ================= */
  function nextId(prefix, list) {
    var n = 1;
    while (list.some(function (x) { return x.id === prefix + n; })) n++;
    return prefix + n;
  }

  function persistPreview(mutator) {
    var p = readPreview();
    mutator(p);
    writePreview(p);
    applyState(p);
  }

  function createService(payload) {
    if (MODE === 'api') {
      return api(API.services, { method: 'POST', body: payload }).then(function (res) {
        return reloadState().then(function () { return res; });
      });
    }
    var created = Object.assign({ id: nextId('s_new', data.services) }, payload);
    persistPreview(function (p) { p.services.push(created); });
    return Promise.resolve(created);
  }

  function saveService(id, patch, silent) {
    if (MODE === 'api') {
      return api(API.services + '/' + encodeURIComponent(id), { method: 'PATCH', body: patch }).then(function (res) {
        if (silent) {
          data.services = data.services.map(function (s) { return s.id === id ? Object.assign({}, s, patch) : s; });
          renderServices();
          renderGroups();
          return res;
        }
        return reloadState().then(function () { return res; });
      });
    }
    persistPreview(function (p) {
      p.services = p.services.map(function (s) { return s.id === id ? Object.assign({}, s, patch) : s; });
    });
    renderServices();
    renderGroups();
    return Promise.resolve();
  }

  function removeService(svc) {
    if (!window.confirm('确定删除「' + svc.name + '」吗？此操作不可撤销。')) return;
    var done = function () {
      statuses.delete(svc.id);
      renderServices();
      renderGroups();
      toast('已删除 ' + svc.name);
    };
    if (MODE === 'api') {
      api(API.services + '/' + encodeURIComponent(svc.id), { method: 'DELETE' })
        .then(function () { return reloadState(); })
        .then(done)
        .catch(function (err) { toast(err.message, 'bad'); });
    } else {
      persistPreview(function (p) {
        p.services = p.services.filter(function (s) { return s.id !== svc.id; });
      });
      done();
    }
  }

  function createGroup(payload) {
    if (MODE === 'api') {
      return api(API.groups, { method: 'POST', body: payload }).then(function (res) {
        return reloadState().then(function () { return res; });
      });
    }
    var created = Object.assign({ id: nextId('g_new', data.groups) }, payload);
    persistPreview(function (p) { p.groups.push(created); });
    return Promise.resolve(created);
  }

  function saveGroup(id, patch) {
    if (MODE === 'api') {
      return api(API.groups + '/' + encodeURIComponent(id), { method: 'PATCH', body: patch }).then(function (res) {
        return reloadState().then(function () { return res; });
      });
    }
    persistPreview(function (p) {
      p.groups = p.groups.map(function (g) { return g.id === id ? Object.assign({}, g, patch) : g; });
    });
    renderServices();
    renderGroups();
    fillGroupSelect();
    return Promise.resolve();
  }

  function removeGroup(group, count) {
    if (count > 0) { toast('请先移动或删除该分组下的服务', 'bad'); return; }
    if (!window.confirm('确定删除分组「' + group.name + '」吗？')) return;
    var done = function () { renderGroups(); fillGroupSelect(); toast('已删除分组 ' + group.name); };
    if (MODE === 'api') {
      api(API.groups + '/' + encodeURIComponent(group.id), { method: 'DELETE' })
        .then(function () { return reloadState(); })
        .then(done)
        .catch(function (err) { toast(err.message, 'bad'); });
    } else {
      persistPreview(function (p) { p.groups = p.groups.filter(function (g) { return g.id !== group.id; }); });
      done();
    }
  }

  function reloadState() {
    if (MODE !== 'api') return Promise.resolve();
    return api(API.state).then(function (payload) {
      applyState(payload);
      renderServices();
      renderGroups();
      fillGroupSelect();
    }).catch(function () { /* 忽略刷新失败 */ });
  }

  /* ================= 对话框 ================= */
  function openModal(id) {
    $(id).classList.add('show');
    document.body.style.overflow = 'hidden';
  }
  function closeModal(id) {
    $(id).classList.remove('show');
    document.body.style.overflow = '';
  }
  function closeAllModals() {
    Array.prototype.forEach.call(document.querySelectorAll('.modal.show'), function (m) {
      m.classList.remove('show');
    });
    document.body.style.overflow = '';
  }

  function openSvcDialog(svc) {
    if (!svc && data.groups.length === 0) {
      toast('请先在「分组管理」里创建至少一个分组', 'bad');
      switchTab('groups');
      return;
    }
    editingSvc = svc || null;
    showError('svcError', 'svcErrorText', '');
    $('probeOut').className = 'probe-out';
    $('probeOut').textContent = '';
    fillGroupSelect(svc ? svc.groupId : (data.groups[0] && data.groups[0].id));

    if (svc) {
      $('svcModalTitle').textContent = '编辑服务';
      $('svcName').value = svc.name || '';
      $('svcDesc').value = svc.description || '';
      $('svcUrl').value = svc.url || '';
      $('svcIcon').value = svc.icon || '';
      $('svcOrder').value = String(svc.order || 0);
      $('svcEnabled').checked = svc.enabled !== false;
    } else {
      $('svcModalTitle').textContent = '新增服务';
      $('svcName').value = '';
      $('svcDesc').value = '';
      $('svcUrl').value = '';
      $('svcIcon').value = '';
      $('svcOrder').value = String(data.services.length);
      $('svcEnabled').checked = true;
    }
    openModal('svcModal');
    setTimeout(function () { $('svcName').focus(); }, 60);
  }

  function openGrpDialog(group) {
    editingGrp = group || null;
    showError('grpError', 'grpErrorText', '');
    if (group) {
      $('grpModalTitle').textContent = '编辑分组';
      $('grpName').value = group.name || '';
      $('grpAccent').value = group.accent || ACCENTS[0];
    } else {
      $('grpModalTitle').textContent = '新增分组';
      $('grpName').value = '';
      $('grpAccent').value = ACCENTS[data.groups.length % ACCENTS.length];
    }
    openModal('grpModal');
    setTimeout(function () { $('grpName').focus(); }, 60);
  }

  function validateUrl(raw) {
    var value = String(raw || '').trim();
    if (!value) return '请填写访问地址';
    var href = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : 'http://' + value;
    var parsed;
    try { parsed = new URL(href); } catch (e) { return '地址格式无法解析，请检查 IP / 域名与端口'; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '仅支持 http 与 https 协议';
    if (!parsed.hostname) return '地址缺少主机名';
    return '';
  }

  /* ================= 表单提交 ================= */
  function submitService(e) {
    e.preventDefault();
    var name = $('svcName').value.trim();
    var groupId = $('svcGroup').value;
    var rawUrl = $('svcUrl').value.trim();
    var urlError = validateUrl(rawUrl);

    if (!name) { showError('svcError', 'svcErrorText', '请填写服务名称'); return; }
    if (!groupId) { showError('svcError', 'svcErrorText', '请选择所属分组'); return; }
    if (urlError) { showError('svcError', 'svcErrorText', urlError); return; }

    var normalized = normalizeUrl(rawUrl).href;
    var payload = {
      name: name,
      description: $('svcDesc').value.trim(),
      groupId: groupId,
      url: normalized,
      icon: $('svcIcon').value.trim(),
      order: Math.max(0, parseInt($('svcOrder').value, 10) || 0),
      enabled: $('svcEnabled').checked
    };

    var btn = $('svcSaveBtn');
    setBusy(btn, true);
    showError('svcError', 'svcErrorText', '');

    var task = editingSvc ? saveService(editingSvc.id, payload) : createService(payload);

    task.then(function () {
      closeModal('svcModal');
      toast(editingSvc ? '已保存修改' : '已新增 ' + name);
      renderServices();
      renderGroups();
    }).catch(function (err) {
      if (err.status === 401) { closeAllModals(); showGate('登录已过期，请重新登录'); return; }
      showError('svcError', 'svcErrorText', err.message);
    }).then(function () { setBusy(btn, false); });
  }

  function submitGroup(e) {
    e.preventDefault();
    var name = $('grpName').value.trim();
    if (!name) { showError('grpError', 'grpErrorText', '请填写分组名称'); return; }

    var payload = {
      name: name,
      accent: $('grpAccent').value.trim() || ACCENTS[0]
    };
    if (!editingGrp) payload.order = data.groups.length;

    var btn = $('grpSaveBtn');
    setBusy(btn, true);
    showError('grpError', 'grpErrorText', '');

    var task = editingGrp ? saveGroup(editingGrp.id, payload) : createGroup(payload);
    task.then(function () {
      closeModal('grpModal');
      toast(editingGrp ? '分组已更新' : '已新增分组 ' + name);
    }).then(function () {
      renderGroups();
      renderServices();
      fillGroupSelect();
    }).catch(function (err) {
      if (err.status === 401) { closeAllModals(); showGate('登录已过期，请重新登录'); return; }
      showError('grpError', 'grpErrorText', err.message);
    }).then(function () { setBusy(btn, false); });
  }

  function submitAccount(e) {
    e.preventDefault();
    var username = $('accUser').value.trim();
    var current = $('accCurrent').value;
    var next = $('accNew').value;
    var confirm = $('accNew2').value;

    if (!/^[A-Za-z0-9_-]{3,32}$/.test(username)) {
      showError('accError', 'accErrorText', '用户名需为 3~32 位字母、数字、下划线或连字符');
      return;
    }
    if (!current) { showError('accError', 'accErrorText', '请填写当前口令以确认身份'); return; }
    if (next) {
      if (next.length < 6 || next.length > 64) { showError('accError', 'accErrorText', '新口令长度需为 6~64 位'); return; }
      if (next !== confirm) { showError('accError', 'accErrorText', '两次输入的新口令不一致'); return; }
    }

    var btn = $('accSaveBtn');
    setBusy(btn, true);
    showError('accError', 'accErrorText', '');

    var finish = function (name, password) {
      viewer.username = name;
      viewer.mustChangePassword = password ? password === '123456' : viewer.mustChangePassword;
      $('whoName').textContent = name;
      $('whoAvatar').textContent = name.slice(0, 1).toUpperCase();
      $('pwdBanner').classList.toggle('show', Boolean(viewer.mustChangePassword));
      $('accCurrent').value = '';
      $('accNew').value = '';
      $('accNew2').value = '';
      toast('账号信息已更新');
    };

    if (MODE === 'api') {
      var body = { currentPassword: current };
      if (username !== (viewer.username || '')) body.newUsername = username;
      if (next) body.newPassword = next;
      api(API.account, { method: 'PATCH', body: body })
        .then(function (res) {
          finish(res.username || username, null);
          if (res.mustChangePassword !== undefined) viewer.mustChangePassword = Boolean(res.mustChangePassword);
        })
        .catch(function (err) {
          if (err.status === 401) { showGate('登录已过期，请重新登录'); return; }
          showError('accError', 'accErrorText', err.message);
        })
        .then(function () { setBusy(btn, false); });
      return;
    }

    var account = previewAccount();
    if (account.password !== current) {
      showError('accError', 'accErrorText', '当前口令不正确');
      setBusy(btn, false);
      return;
    }
    persistPreview(function (p) {
      p.account = { username: username, password: next || account.password };
    });
    finish(username, next || account.password);
    setBusy(btn, false);
  }

  /* ================= 测试连接 ================= */
  function testConnection() {
    var raw = $('svcUrl').value.trim();
    var err = validateUrl(raw);
    var out = $('probeOut');
    if (err) {
      showError('svcError', 'svcErrorText', err);
      return;
    }
    showError('svcError', 'svcErrorText', '');
    var btn = $('probeBtn');
    setBusy(btn, true);
    out.className = 'probe-out show';
    out.textContent = '探测中…';

    var render = function (ok, text) {
      out.className = 'probe-out show ' + (ok ? 'ok' : 'bad');
      out.innerHTML = ok ? ICON_OK : ICON_BAD;
      out.appendChild(el('span', null, text));
    };

    if (MODE === 'api') {
      api(API.probeTest, { method: 'POST', body: { url: normalizeUrl(raw).href } })
        .then(function (res) {
          if (res.state === 'online') {
            var v = typeof res.latencyMs === 'number' ? res.latencyMs : 0;
            render(true, '在线 · ' + (v < 1 ? '<1 ms' : v + ' ms'));
          } else {
            render(false, '不可达 · ' + (res.error || '探测失败'));
          }
        })
        .catch(function (e) { render(false, e.message); })
        .then(function () { setBusy(btn, false); });
      return;
    }

    setTimeout(function () {
      var mock = (window.WINNAV_MOCK.services || []).find(function (s) {
        return normalizeUrl(s.url).href === normalizeUrl(raw).href;
      });
      if (mock && mock.mockState === 'offline') {
        render(false, '不可达 · ' + (mock.mockError || '连接超时 2500 ms'));
      } else {
        var latency = mock && typeof mock.mockLatency === 'number' ? mock.mockLatency : Math.floor(Math.random() * 30) + 1;
        render(true, '在线 · ' + (latency < 1 ? '<1 ms' : latency + ' ms') + '（预览模式模拟）');
      }
      setBusy(btn, false);
    }, 700);
  }

  function refreshAllStatuses() {
    var btn = $('testAllBtn');
    setBusy(btn, true);
    if (MODE === 'api') {
      api(API.refresh, { method: 'POST' })
        .then(function () { return reloadState(); })
        .catch(function () {})
        .then(function () { setBusy(btn, false); });
      return;
    }
    data.services.forEach(function (svc) {
      if (svc.enabled === false) return;
      var mock = (window.WINNAV_MOCK.services || []).find(function (s) { return s.id === svc.id; });
      statuses.set(svc.id, mock ? {
        state: mock.mockState,
        latencyMs: mock.mockState === 'online' ? mock.mockLatency : null,
        error: mock.mockState === 'offline' ? (mock.mockError || null) : null,
        checkedAt: Date.now()
      } : { state: 'online', latencyMs: Math.floor(Math.random() * 40) + 1, checkedAt: Date.now() });
    });
    renderServices();
    setBusy(btn, false);
    toast('状态已刷新（预览模式模拟）');
  }

  /* ================= 标签切换 ================= */
  function switchTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      tab.classList.toggle('active', tab.dataset.tab === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-panel]'), function (panel) {
      panel.hidden = panel.dataset.panel !== name;
    });
  }

  /* ================= 事件绑定 ================= */
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var username = $('loginUser').value.trim();
    var password = $('loginPass').value;
    if (!username || !password) {
      showError('loginError', 'loginErrorText', '请输入用户名与口令');
      return;
    }
    var btn = $('loginBtn');
    setBusy(btn, true);
    showError('loginError', 'loginErrorText', '');
    doLogin(username, password)
      .then(function () { $('loginPass').value = ''; })
      .catch(function (err) {
        showError('loginError', 'loginErrorText', err.code === 'TOO_MANY_ATTEMPTS'
          ? '尝试次数过多，请 10 分钟后再试'
          : '用户名或口令错误');
        $('loginPass').value = '';
        $('loginPass').focus();
      })
      .then(function () { setBusy(btn, false); });
  });

  $('logoutBtn').addEventListener('click', doLogout);
  $('bannerChangeBtn').addEventListener('click', function () {
    switchTab('account');
    $('accCurrent').focus();
  });

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
    tab.addEventListener('click', function () { switchTab(tab.dataset.tab); });
  });

  $('addSvcBtn').addEventListener('click', function () { openSvcDialog(null); });
  $('addGrpBtn').addEventListener('click', function () { openGrpDialog(null); });
  $('svcForm').addEventListener('submit', submitService);
  $('grpForm').addEventListener('submit', submitGroup);
  $('accountForm').addEventListener('submit', submitAccount);
  $('probeBtn').addEventListener('click', testConnection);
  $('testAllBtn').addEventListener('click', refreshAllStatuses);

  $('accResetBtn').addEventListener('click', function () {
    $('accUser').value = viewer.username || 'admin';
    $('accCurrent').value = '';
    $('accNew').value = '';
    $('accNew2').value = '';
    showError('accError', 'accErrorText', '');
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (btn) {
    btn.addEventListener('click', function () { closeModal(btn.dataset.close); });
  });

  Array.prototype.forEach.call(document.querySelectorAll('.modal'), function (modal) {
    modal.addEventListener('mousedown', function (e) {
      if (e.target === modal) closeModal(modal.id);
    });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAllModals();
  });

  /* ================= 启动 ================= */
  function boot() {
    api(API.state).then(function (payload) {
      MODE = 'api';
      applyState(payload);
      viewer = {
        authenticated: Boolean(payload.viewer && payload.viewer.authenticated),
        username: payload.viewer && payload.viewer.username,
        mustChangePassword: Boolean(payload.viewer && payload.viewer.mustChangePassword)
      };
      markMode();
      if (viewer.authenticated) {
        enterShell();
        api(API.state).then(function (fresh) {
          applyState(fresh);
          renderServices();
          renderGroups();
        }).catch(function () {});
      } else {
        showGate();
      }
    }).catch(function () {
      MODE = 'demo';
      var preview = readPreview();
      applyState(preview);
      markMode();
      if (previewSession()) {
        viewer = {
          authenticated: true,
          username: previewAccount().username,
          mustChangePassword: previewAccount().password === '123456'
        };
        enterShell();
      } else {
        showGate();
      }
    });
  }

  boot();
})();
