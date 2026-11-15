/* ==========================================================
   WinNav · 前端主脚本（静态页面版）
   - 优先读取 GET /api/state 与 SSE /api/events
   - 后端不可用时自动降级为内置示例数据（静态预览模式）
   - 权限：仅 viewer.authenticated 为真时渲染管理入口
   ========================================================== */
(function () {
  'use strict';

  var API = {
    state: '/api/state',
    refresh: '/api/state/refresh',
    status: '/api/status',
    events: '/api/events',
    favicon: '/api/favicon/'
  };

  var state = {
    groups: [],
    services: [],
    statuses: new Map(),
    viewer: { authenticated: false },
    query: '',
    collapsed: new Set(loadCollapsed()),
    refreshing: false,
    online: false,
    source: null,
    es: null
  };

  var els = {
    groups: document.getElementById('groups'),
    empty: document.getElementById('empty'),
    search: document.getElementById('search'),
    refreshBtn: document.getElementById('refreshBtn'),
    authSlot: document.getElementById('authSlot'),
    dataMode: document.getElementById('dataMode'),
    stOnline: document.getElementById('st-online'),
    stOffline: document.getElementById('st-offline'),
    stUnknown: document.getElementById('st-unknown'),
    stTotal: document.getElementById('st-total')
  };

  var GROUP_ACCENTS = ['#7c5cff', '#25d0ff', '#34e0a1', '#ff4fd8', '#ffc857', '#ff9a4d'];
  var ICON_GEAR = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.9 4.7a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.3 8.9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z"/></svg>';
  var ICON_POWER = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v9"/><path d="M6.2 6.2a8 8 0 1 0 11.6 0"/></svg>';
  var CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

  /* ================= 工具 ================= */
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function fmtTime(ts) {
    var d = new Date(ts);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }
  function accentOf(index) { return GROUP_ACCENTS[index % GROUP_ACCENTS.length]; }

  // 使用相对路径：既支持 file:// 直接打开，也支持任意静态服务器托管
  // 服务端只需同时提供 /admin 与 /admin.html 两个入口即可
  function adminHref() { return './admin.html'; }

  function normalizeUrl(raw) {
    var value = String(raw || '').trim();
    if (!value) return { href: '', display: '' };
    var href = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : 'http://' + value;
    var display = value.replace(/^https?:\/\//i, '');
    return { href: href, display: display };
  }

  function statusOf(id) {
    return state.statuses.get(id) || { state: 'unknown' };
  }

  function loadCollapsed() {
    try { return JSON.parse(localStorage.getItem('winnav.collapsed') || '[]'); }
    catch (e) { return []; }
  }
  function saveCollapsed() {
    try { localStorage.setItem('winnav.collapsed', JSON.stringify(Array.from(state.collapsed))); }
    catch (e) { /* 隐私模式下忽略 */ }
  }

  function api(path, options) {
    var opts = options || {};
    return fetch(path, {
      method: opts.method || 'GET',
      headers: Object.assign({ Accept: 'application/json' }, opts.body ? { 'Content-Type': 'application/json' } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
      signal: opts.signal
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

  /* ================= 数据加载 ================= */
  function applyDataset(dataset, sourceLabel) {
    state.groups = (dataset.groups || []).slice();
    state.services = (dataset.services || []).slice();
    state.viewer = dataset.viewer || { authenticated: false };
    state.source = sourceLabel;

    if (dataset.settings && dataset.settings.siteTitle) {
      document.title = dataset.settings.siteTitle + ' · 服务导航';
    }
    if (dataset.statuses) {
      Object.keys(dataset.statuses).forEach(function (id) {
        state.statuses.set(id, dataset.statuses[id]);
      });
    }

    state.groups.forEach(function (group, index) {
      if (!group.accent) group.accent = accentOf(index);
    });
    state.services.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });

    els.dataMode.textContent = sourceLabel === 'api' ? '实时数据' : '静态预览（示例数据）';
    renderAuthSlot();
  }

  function loadInitial() {
    return api(API.state).then(function (data) {
      state.online = true;
      applyDataset(data, 'api');
      connectEvents();
      return true;
    }).catch(function () {
      state.online = false;
      applyDataset(window.WINNAV_MOCK || { groups: [], services: [] }, 'mock');
      return false;
    });
  }

  /* ================= 权限相关的顶栏 ================= */
  function renderAuthSlot() {
    var slot = els.authSlot;
    slot.replaceChildren();

    if (state.viewer && state.viewer.authenticated) {
      var manage = el('a', 'btn accent');
      manage.href = adminHref();
      manage.innerHTML = ICON_GEAR;
      manage.appendChild(el('span', null, '管理台'));
      slot.appendChild(manage);

      var logout = el('button', 'btn sm');
      logout.type = 'button';
      logout.id = 'logoutBtn';
      logout.title = '退出登录';
      logout.innerHTML = ICON_POWER;
      logout.appendChild(el('span', null, state.viewer.username || '退出'));
      logout.addEventListener('click', function () {
        logout.disabled = true;
        if (!state.online) { window.location.reload(); return; }
        api('/api/logout', { method: 'POST' }).catch(function () { /* 忽略 */ }).then(function () {
          window.location.reload();
        });
      });
      slot.appendChild(logout);
      return;
    }

    var login = el('a', 'btn primary');
    login.href = adminHref();
    login.title = '管理员登录后可编辑卡片';
    login.innerHTML = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10.5" width="16" height="9.5" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>';
    login.appendChild(el('span', null, '登录'));
    slot.appendChild(login);
  }

  /* ================= 卡片 ================= */
  // 未设置图标时：在线模式由服务端代理抓取 favicon，预览模式直接猜 origin/favicon.ico
  function faviconSrc(svc) {
    if (state.online) return API.favicon + encodeURIComponent(svc.id);
    var url = normalizeUrl(svc.url);
    if (!url.href) return '';
    try {
      return new URL(url.href).origin + '/favicon.ico';
    } catch (e) {
      return '';
    }
  }

  function iconNode(svc) {
    var box = el('div', 'icon');
    var icon = svc.icon || '';
    var fallback = function () {
      box.replaceChildren(document.createTextNode(svc.name.slice(0, 1).toUpperCase()));
    };

    if (/^https?:\/\//i.test(icon) || icon.indexOf('/icons/') === 0) {
      var img = document.createElement('img');
      img.src = icon;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', fallback);
      box.appendChild(img);
      return box;
    }

    if (!icon.trim()) {
      var src = faviconSrc(svc);
      if (src) {
        box.classList.add('auto-icon');
        var favImg = document.createElement('img');
        favImg.src = src;
        favImg.alt = '';
        favImg.loading = 'lazy';
        favImg.referrerPolicy = 'no-referrer';
        favImg.addEventListener('error', fallback);
        box.appendChild(favImg);
        return box;
      }
    }

    box.textContent = icon || svc.name.slice(0, 1).toUpperCase();
    return box;
  }

  function cardEl(svc, group) {
    var url = normalizeUrl(svc.url);
    var card = el('a', 'card');
    card.href = url.href || '#';
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.dataset.id = svc.id;
    card.style.setProperty('--accent', group.accent);
    if (svc.enabled === false) card.classList.add('disabled');

    var top = el('div', 'card-top');
    var meta = el('div', 'meta');
    meta.appendChild(el('div', 'name', svc.name));
    meta.appendChild(el('div', 'desc', svc.description || ''));
    top.append(iconNode(svc), meta);

    var urls = el('div', 'url', url.display || '—');
    urls.title = url.href;

    var foot = el('div', 'card-foot');
    var status = el('span', 'status');
    status.append(el('i', 'dot unknown'), el('span', 'lat', '—'));
    var checked = el('span', 'checked', '等待探测…');
    foot.append(status, checked);

    card.append(top, urls, foot);
    return card;
  }

  /* ================= 渲染 ================= */
  function render() {
    var q = state.query.trim().toLowerCase();
    els.groups.replaceChildren();
    var visible = 0;

    state.groups.forEach(function (group) {
      var items = state.services.filter(function (svc) {
        if (svc.groupId !== group.id) return false;
        if (!q) return true;
        var url = normalizeUrl(svc.url);
        return (svc.name + ' ' + (svc.description || '') + ' ' + url.display + ' ' + url.href)
          .toLowerCase().indexOf(q) !== -1;
      });
      if (!items.length) return;
      visible += items.length;

      var section = el('section', 'group');
      section.dataset.group = group.id;
      section.style.setProperty('--accent', group.accent);
      if (state.collapsed.has(group.id)) section.classList.add('collapsed');

      var head = el('div', 'group-head');
      head.appendChild(el('span', 'gdot'));
      head.appendChild(el('h2', null, group.name));

      var count = el('span', 'count', '');
      count.dataset.countFor = group.id;
      head.appendChild(count);

      var btn = el('button', 'collapse-btn');
      btn.type = 'button';
      btn.setAttribute('aria-label', '折叠或展开 ' + group.name);
      btn.innerHTML = CHEVRON;
      head.appendChild(btn);
      section.appendChild(head);

      var grid = el('div', 'grid');
      items.forEach(function (svc) { grid.appendChild(cardEl(svc, group)); });
      section.appendChild(grid);
      els.groups.appendChild(section);
    });

    els.empty.hidden = visible !== 0;
    state.services.forEach(paintStatus);
    refreshStats();
  }

  function paintStatus(svc) {
    var card = els.groups.querySelector('.card[data-id="' + svc.id + '"]');
    if (!card) return;
    var st = statusOf(svc.id);
    var dot = card.querySelector('.dot');
    var lat = card.querySelector('.lat');
    var checked = card.querySelector('.checked');
    if (!dot || !lat || !checked) return;

    if (svc.enabled === false) {
      dot.className = 'dot';
      lat.textContent = '已停用';
      lat.className = 'lat';
      checked.textContent = '未参与探测';
      card.dataset.state = 'disabled';
      return;
    }

    dot.className = 'dot ' + st.state;
    card.dataset.state = st.state;

    if (st.state === 'online') {
      var v = typeof st.latencyMs === 'number' ? st.latencyMs : 0;
      lat.textContent = v < 1 ? '<1 ms' : v + ' ms';
      lat.className = 'lat ' + (v < 50 ? 'fast' : v <= 200 ? 'mid' : 'slow');
      card.title = svc.name + ' · 在线 · ' + lat.textContent;
    } else if (st.state === 'offline') {
      lat.textContent = '—';
      lat.className = 'lat';
      card.title = svc.name + ' · 离线' + (st.error ? ' · ' + st.error : '');
    } else {
      lat.textContent = '—';
      lat.className = 'lat';
      card.title = svc.name + ' · 探测中';
    }

    checked.textContent = st.checkedAt ? '最近检测 ' + fmtTime(st.checkedAt) : '等待探测…';
  }

  function refreshStats() {
    var online = 0, offline = 0, unknown = 0, active = 0;
    state.services.forEach(function (svc) {
      if (svc.enabled === false) return;
      active++;
      var st = statusOf(svc.id).state;
      if (st === 'online') online++;
      else if (st === 'offline') offline++;
      else unknown++;
    });
    els.stOnline.textContent = String(online);
    els.stOffline.textContent = String(offline);
    els.stUnknown.textContent = String(unknown);
    els.stTotal.textContent = String(active);

    state.groups.forEach(function (group) {
      var node = els.groups.querySelector('[data-count-for="' + group.id + '"]');
      if (!node) return;
      var list = state.services.filter(function (s) { return s.groupId === group.id && s.enabled !== false; });
      var on = list.filter(function (s) { return statusOf(s.id).state === 'online'; }).length;
      node.textContent = on + '/' + list.length + ' 在线';
    });
  }

  /* ================= 状态刷新 ================= */
  function markAllUnknown() {
    state.services.forEach(function (svc) {
      if (svc.enabled === false) return;
      state.statuses.set(svc.id, { state: 'unknown' });
    });
    state.services.forEach(paintStatus);
    refreshStats();
  }

  function setBusy(busy) {
    state.refreshing = busy;
    els.refreshBtn.classList.toggle('loading', busy);
    els.refreshBtn.disabled = busy;
  }

  function refreshAll() {
    if (state.refreshing) return;
    setBusy(true);
    markAllUnknown();

    if (!state.online) {
      simulateRefresh();
      return;
    }

    api(API.refresh, { method: 'POST' }).then(function () {
      // 兜底：SSE 尚未连上或事件丢失时，2.5 s 后改走轮询
      setTimeout(function () { if (state.refreshing) pollStatus(0); }, 2500);
    }).catch(function () {
      simulateRefresh();
    });
  }

  // SSE 不可用时轮询兜底：最多 10 s，收敛后自动停止
  function pollStatus(attempt) {
    if (attempt > 12 || !state.refreshing) { setBusy(false); return; }
    api(API.status).then(function (payload) {
      if (payload && payload.statuses) {
        Object.keys(payload.statuses).forEach(function (id) {
          applyStatusUpdate(Object.assign({ id: id }, payload.statuses[id]));
        });
      }
      if (payload && payload.refreshing === false) { setBusy(false); return; }
      setTimeout(function () { pollStatus(attempt + 1); }, 800);
    }).catch(function () { setBusy(false); });
  }

  function simulateRefresh() {
    var pending = state.services.filter(function (s) { return s.enabled !== false; });
    if (!pending.length) { setBusy(false); return; }
    var remain = pending.length;

    pending.forEach(function (svc) {
      var delay = 160 + Math.random() * 880;
      setTimeout(function () {
        if (svc.mockState) {
          state.statuses.set(svc.id, {
            state: svc.mockState,
            latencyMs: svc.mockState === 'online' ? svc.mockLatency : null,
            error: svc.mockState === 'offline' ? (svc.mockError || null) : null,
            checkedAt: Date.now()
          });
        }
        paintStatus(svc);
        refreshStats();
        if (--remain === 0) setBusy(false);
      }, delay);
    });
  }

  function applyStatusUpdate(payload) {
    if (!payload || !payload.id) return;
    state.statuses.set(payload.id, payload);
    var svc = state.services.find(function (s) { return s.id === payload.id; });
    if (svc) paintStatus(svc);
    refreshStats();
  }

  /* ================= SSE ================= */
  function connectEvents() {
    if (typeof window.EventSource !== 'function') return;
    try {
      var es = new EventSource(API.events);
      state.es = es;

      es.addEventListener('status', function (e) {
        try { applyStatusUpdate(JSON.parse(e.data)); } catch (err) { /* 忽略坏帧 */ }
      });
      es.addEventListener('refresh:start', function () {
        setBusy(true);
        markAllUnknown();
      });
      es.addEventListener('refresh:done', function () { setBusy(false); });
      es.addEventListener('config:changed', function () {
        api(API.state).then(function (data) { applyDataset(data, 'api'); render(); }).catch(function () {});
      });
      es.addEventListener('error', function () {
        // 浏览器会自动重连；此处不关闭连接
      });
    } catch (err) { /* 忽略 */ }
  }

  /* ================= 事件绑定 ================= */
  els.search.addEventListener('input', function (e) {
    state.query = e.target.value;
    render();
  });

  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (e.key === '/' && !typing) {
      e.preventDefault();
      els.search.focus();
      els.search.select();
    } else if (e.key === 'Escape' && document.activeElement === els.search) {
      els.search.value = '';
      state.query = '';
      render();
      els.search.blur();
    }
  });

  els.groups.addEventListener('click', function (e) {
    var btn = e.target.closest('.collapse-btn');
    if (!btn) return;
    var section = btn.closest('.group');
    var id = section.dataset.group;
    section.classList.toggle('collapsed');
    if (section.classList.contains('collapsed')) state.collapsed.add(id);
    else state.collapsed.delete(id);
    saveCollapsed();
  });

  // 卡片光斑跟随（rAF 节流）
  var glowRaf = null, glowCard = null, glowPos = null;
  els.groups.addEventListener('pointermove', function (e) {
    var card = e.target.closest('.card');
    if (!card) return;
    glowCard = card;
    glowPos = { x: e.clientX, y: e.clientY };
    if (glowRaf) return;
    glowRaf = requestAnimationFrame(function () {
      glowRaf = null;
      if (!glowCard || !glowPos) return;
      var rect = glowCard.getBoundingClientRect();
      glowCard.style.setProperty('--mx', (glowPos.x - rect.left) + 'px');
      glowCard.style.setProperty('--my', (glowPos.y - rect.top) + 'px');
    });
  }, { passive: true });

  els.refreshBtn.addEventListener('click', refreshAll);

  /* ================= 启动 ================= */
  function renderSkeleton() {
    els.groups.replaceChildren();
    for (var i = 0; i < 2; i++) {
      var section = el('section', 'group');
      section.appendChild(el('div', 'sk-head'));
      var grid = el('div', 'grid');
      for (var j = 0; j < 3; j++) grid.appendChild(el('div', 'skeleton'));
      section.appendChild(grid);
      els.groups.appendChild(section);
    }
  }

  renderSkeleton();

  loadInitial().then(function () {
    document.body.classList.add('booting');
    render();
    setTimeout(function () { document.body.classList.remove('booting'); }, 900);
    refreshAll();          // 打开页面即自动刷新一次全部状态
  });

  // 页面重新可见时若上次探测已超过 30 s，静默刷新一次
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (state.refreshing) return;
    var last = 0;
    state.statuses.forEach(function (st) { if (st.checkedAt > last) last = st.checkedAt; });
    if (Date.now() - last > 30000) refreshAll();
  });
})();
