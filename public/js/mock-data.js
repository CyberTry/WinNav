/* ==========================================================
   WinNav · 静态预览示例数据
   真实运行时由 GET /api/state 覆盖；此文件仅在无法访问后端时使用。
   ========================================================== */
window.WINNAV_MOCK = {
  settings: {
    siteTitle: 'WinNav',
    theme: 'dark',
    probe: { mode: 'tcp', timeoutMs: 2500, concurrency: 8, cacheTtlMs: 30000 }
  },
  groups: [
    { id: 'g_home', name: '家庭服务', order: 0, accent: '#7c5cff' },
    { id: 'g_ops',  name: '运维工具', order: 1, accent: '#25d0ff' },
    { id: 'g_dev',  name: '开发与办公', order: 2, accent: '#34e0a1' }
  ],
  services: [
    { id: 's_jellyfin', groupId: 'g_home', name: 'Jellyfin', description: '影音服务器',
      url: 'http://192.168.1.20:8096', icon: '🎬', order: 0, enabled: true,
      mockState: 'online', mockLatency: 12 },

    { id: 's_nas', groupId: 'g_home', name: 'NAS 面板', description: '存储与备份',
      url: 'http://192.168.1.10:5000', icon: '🗄️', order: 1, enabled: true,
      mockState: 'online', mockLatency: 3 },

    { id: 's_router', groupId: 'g_home', name: '路由器', description: '主网关',
      url: 'http://192.168.1.1', icon: '🌐', order: 2, enabled: true,
      mockState: 'online', mockLatency: 0 },

    { id: 's_hass', groupId: 'g_home', name: 'Home Assistant', description: '智能家居中枢',
      url: 'http://192.168.1.30:8123', icon: '🏠', order: 3, enabled: true,
      mockState: 'online', mockLatency: 28 },

    { id: 's_immich', groupId: 'g_home', name: 'Immich', description: '照片备份服务',
      url: 'http://192.168.1.10:2283', icon: '🖼️', order: 4, enabled: true,
      mockState: 'offline', mockLatency: null, mockError: '连接超时 2500 ms' },

    { id: 's_grafana', groupId: 'g_ops', name: 'Grafana', description: '监控可视化面板',
      url: 'http://192.168.1.40:3000', icon: '📊', order: 0, enabled: true,
      mockState: 'online', mockLatency: 8 },

    { id: 's_portainer', groupId: 'g_ops', name: 'Portainer', description: '容器管理',
      url: 'https://192.168.1.40:9443', icon: '🐳', order: 1, enabled: true,
      mockState: 'offline', mockLatency: null, mockError: 'ECONNREFUSED 拒绝连接' },

    { id: 's_proxmox', groupId: 'g_ops', name: 'Proxmox VE', description: '虚拟化平台',
      url: 'https://192.168.1.50:8006', icon: '🖥️', order: 2, enabled: true,
      mockState: 'online', mockLatency: 45 },

    { id: 's_uptime', groupId: 'g_ops', name: 'Uptime Kuma', description: '可用性监控',
      url: 'http://192.168.1.40:3001', icon: '📈', order: 3, enabled: true,
      mockState: 'online', mockLatency: 6 },

    { id: 's_gitlab', groupId: 'g_dev', name: 'GitLab', description: '代码托管',
      url: 'http://git.lan', icon: '🦊', order: 0, enabled: true,
      mockState: 'online', mockLatency: 15 },

    { id: 's_wiki', groupId: 'g_dev', name: '内部 Wiki', description: '知识库与文档',
      url: 'http://wiki.lan', icon: '📚', order: 1, enabled: true,
      mockState: 'online', mockLatency: 22 },

    { id: 's_ticket', groupId: 'g_dev', name: '工单系统', description: '内部流程与审批',
      url: 'http://ticket.lan', icon: '🎫', order: 2, enabled: true,
      mockState: 'offline', mockLatency: null, mockError: 'ENOTFOUND DNS 解析失败' }
  ],
  viewer: { authenticated: false }
};
