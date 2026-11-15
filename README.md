# WinNav 服务导航站 · 需求与设计文档

> 版本：v0.2（设计稿）　状态：待评审
> 变更：v0.2 新增管理员 / 普通用户双视图、默认账号 `admin / 123456`、账号自助改用户名与口令
> 运行平台：Windows 10 / 11 / Server 2019+（x64）
> 技术栈：Node.js 20 LTS+ / JavaScript / Express 5 / 原生前端（无构建步骤）

---

## 1. 项目概述

WinNav 是一个可自托管的「服务导航站」服务端软件，运行在 Windows 上。使用者把家庭或公司内网的各种服务（NAS、媒体服务器、运维面板、路由器、内部系统等）登记成卡片，按分组展示；服务端负责探测每个目标是否可达，并在网页上用绿色 / 红色状态点和毫秒级延迟呈现。

**核心价值**

- 一个入口看全所有服务，不用再记 IP、端口和域名。
- **打开页面即自动刷新一次状态**：绿色可达、红色不可达，并显示本次探测延迟。
- 纯自托管、离线可用、依赖极少，适合内网与家用服务器。

**设计原则**

1. 单机单进程，一条命令启动，可注册为 Windows 服务常驻。
2. 依赖尽可能少，数据用本地 JSON 文件持久化，不要求安装数据库。
3. 探测逻辑放在服务端（浏览器无法直接 ping 目标端口），前端只负责展示。
4. 后端异常或断网时，页面仍能展示已缓存的配置与上次状态。

---

## 2. 术语

| 术语 | 含义 |
| --- | --- |
| 服务卡片（Service） | 一条导航记录，包含图标、名称、描述、访问地址、所属分组 |
| 分组（Group） | 卡片的分类容器，如「家庭服务」「运维工具」 |
| 探测（Probe） | 服务端对目标地址发起的一次可达性与延迟测量 |
| 延迟（Latency） | 从发起连接到建立连接（或收到 HTTP 响应）所耗时间，单位 ms |
| 状态快照（Status） | 某服务最近一次探测结果：在线 / 离线 / 未知 + 延迟 + 探测时间 |
| 管理员（Admin） | 唯一拥有编辑权限的账号，默认用户名 `admin`、默认口令 `123456` |
| 普通用户（Guest） | 未登录的访客，可浏览首页与实时状态，不能修改任何配置 |
| 会话（Session） | 管理员登录后由服务端签发的 `sid`，存放于 HttpOnly Cookie |

---

## 3. 用户与使用场景

**目标用户**：具备基本电脑操作能力的个人或小团队，自建 NAS / 家庭服务器 / 内网服务。

**典型场景**

1. 普通用户打开 `http://win-nas:8080`，**无需登录**即可看到全部卡片；页面 500 ms 内出现骨架，1~3 s 内状态与延迟逐个刷新完成。
2. 普通用户点击卡片即可跳转目标服务；首页不出现任何编辑按钮。
3. 管理员点击右上角「管理」，用默认的 `admin / 123456` 登录，新增服务时填写 `192.168.1.20:8096`（不带协议），系统自动补全为 `http://192.168.1.20:8096`。
4. 某服务临时维护，卡片变红并显示「—」，悬停可看到失败原因与上次在线时间。
5. 管理员在「账号设置」里把用户名改为 `ops`、口令改为新的强口令，保存后旧口令立即失效，下次用新凭据登录。

**不在本期范围**

- 多管理员账号、按人分配权限、开放注册（本期固定一个管理员，普通用户匿名）。
- 公网暴露、反向代理自动配置、HTTPS 证书签发。
- 服务内容聚合（iframe 嵌入、单点登录）。

---

## 4. 功能需求

### 4.1 服务卡片导航（FR-01）

| 编号 | 需求 | 优先级 |
| --- | --- | --- |
| FR-01-1 | 首页按分组纵向排列，每组显示标题、卡片数量、组内在线统计（如 5/6 在线） | P0 |
| FR-01-2 | 卡片展示：图标、名称、描述、访问地址（过长截断）、状态点、延迟 | P0 |
| FR-01-3 | 点击卡片在新标签页打开访问地址 | P0 |
| FR-01-4 | 访问地址支持 `IP:端口`、`域名:端口`、完整 URL（http / https）三种输入形式 | P0 |
| FR-01-5 | 地址未写协议时自动补全 `http://`；未写端口时使用协议默认端口（80 / 443） | P0 |
| FR-01-6 | 图标支持：图片 URL、`/icons/` 下的本地文件、emoji；未设置时显示名称首字母彩色占位块 | P1 |
| FR-01-7 | 顶部搜索框按名称 / 描述 / 地址即时过滤，`/` 键聚焦 | P1 |
| FR-01-8 | 分组可折叠，折叠状态本地记住 | P2 |
| FR-01-9 | 卡片支持拖拽排序，分组支持上下移动 | P2 |
| FR-01-10 | 响应式布局：桌面 4~6 列、平板 2~3 列、手机 1 列 | P1 |

### 4.2 在线状态检测（FR-02）

| 编号 | 需求 | 优先级 |
| --- | --- | --- |
| FR-02-1 | 服务端对每个启用中的服务执行探测，得出在线 / 离线结论 | P0 |
| FR-02-2 | 在线显示绿色圆点，离线显示红色圆点，未探测 / 探测中显示灰色脉冲动画 | P0 |
| FR-02-3 | **用户每次打开或刷新网页时自动触发一次全量刷新**（`POST /api/state/refresh`），无需手动操作 | P0 |
| FR-02-4 | 卡片显示本次探测延迟，格式 `32 ms`；小于 1 ms 显示 `<1 ms`；失败显示 `—` | P0 |
| FR-02-5 | 刷新过程逐卡片推送（SSE），不阻塞页面渲染，也不等全部完成才显示 | P0 |
| FR-02-6 | 多标签页 / 多用户同时刷新时，服务端合并为同一次探测（in-flight 去重），避免流量放大 | P0 |
| FR-02-7 | 探测超时默认 2500 ms，超时判定离线；连续失败仅记录，不自动停用服务 | P0 |
| FR-02-8 | 探测并发默认 8，队列化执行，避免瞬时大量连接 | P0 |
| FR-02-9 | 提供手动「刷新状态」按钮，行为与页面加载一致 | P1 |
| FR-02-10 | 离线原因可查看：超时 / 拒绝连接 / DNS 解析失败 / HTTP 无响应 | P1 |
| FR-02-11 | 探测结果缓存 30 s，页面加载时先展示缓存，同时后台刷新 | P1 |
| FR-02-12 | 可选后台定时探测（默认关闭），便于配合大屏 / 监控展示 | P2 |

### 4.3 配置管理（仅管理员，FR-03）

| 编号 | 需求 | 优先级 |
| --- | --- | --- |
| FR-03-1 | 独立 `/admin` 页面，管理员使用「用户名 + 口令」登录（HttpOnly Cookie 会话） | P0 |
| FR-03-2 | 分组增删改、排序 | P0 |
| FR-03-3 | 服务增删改、排序、启用 / 停用、跨分组移动 | P0 |
| FR-03-4 | 表单即时校验：名称必填、地址可解析、组必选，错误就地提示 | P0 |
| FR-03-5 | 管理页提供「测试连接」按钮，立即返回该地址的探测结果 | P1 |
| FR-03-6 | 保存后首页无需重启即生效（SSE 推送 `config:changed`） | P0 |
| FR-03-7 | 配置导出 / 导入（JSON），便于迁移与备份 | P2 |
| FR-03-8 | 可配置站点标题与主题（自动 / 浅色 / 深色） | P2 |
| FR-03-9 | 普通用户首页不显示任何编辑入口（新增 / 编辑 / 删除 / 排序按钮均隐藏） | P0 |
| FR-03-10 | 权限以服务端为准：所有写接口必须先校验会话与角色，前端隐藏仅作体验优化 | P0 |

### 4.4 运维能力（FR-04）

| 编号 | 需求 | 优先级 |
| --- | --- | --- |
| FR-04-1 | 可注册为 Windows 服务（或计划任务），开机自启、崩溃自恢复 | P0 |
| FR-04-2 | 端口、监听地址、数据目录、管理员初始口令可用环境变量覆盖 | P0 |
| FR-04-3 | 访问日志与错误日志写入文件，按天滚动 | P1 |
| FR-04-4 | 提供 `/api/health` 健康检查 | P1 |
| FR-04-5 | 优雅退出：关闭 HTTP 监听与存活连接后再结束进程 | P1 |

### 4.5 账号与权限（FR-05）

| 编号 | 需求 | 优先级 |
| --- | --- | --- |
| FR-05-1 | 系统内置唯一管理员账号，**默认用户名 `admin`、默认口令 `123456`** | P0 |
| FR-05-2 | 首次启动（无 `users.json`）时自动创建该默认账号，口令以加盐哈希存储，不落明文 | P0 |
| FR-05-3 | 管理员登录后可修改用户名（3~32 位，字母 / 数字 / `_` / `-`，全局唯一） | P0 |
| FR-05-4 | 管理员登录后可修改口令（6~64 位），修改时必须校验当前口令 | P0 |
| FR-05-5 | 修改凭据成功后旧凭据立即失效，并注销该账号的其他会话（保留当前会话） | P0 |
| FR-05-6 | 普通用户无需登录即可访问首页、卡片列表、实时状态与 SSE | P0 |
| FR-05-7 | 普通用户访问 `/admin` 时只看到登录框；调用任何写接口返回 401 | P0 |
| FR-05-8 | 登录失败统一提示「用户名或口令错误」，不暴露账号是否存在 | P0 |
| FR-05-9 | 登录限速：同一 IP 5 次失败 / 分钟；连续 10 次失败锁定 10 分钟 | P0 |
| FR-05-10 | 提供「重置管理员口令」应急方案（环境变量开关，重置为默认口令并标记需修改） | P1 |

**权限矩阵**

| 能力 | 普通用户（未登录） | 管理员（已登录） |
| --- | --- | --- |
| 浏览首页 / 卡片 / 分组 | 允许 | 允许 |
| 触发状态刷新、订阅 SSE | 允许 | 允许 |
| 测试连接、导入导出 | 拒绝 | 允许 |
| 新增 / 编辑 / 删除服务与分组 | 拒绝 | 允许 |
| 修改用户名 / 口令 | 拒绝 | 允许 |
| 访问 `/admin` 页面 | 仅登录框 | 完整管理台 |

---

## 5. 非功能需求

| 类别 | 指标 |
| --- | --- |
| 性能 | 首页 HTML+CSS+JS 经 gzip 后 < 60 KB；100 个服务、并发 8 时全部探测在 5 s 内完成 |
| 容量 | 支持 ≥ 500 个服务、≥ 50 个分组；JSON 数据文件 < 5 MB |
| 资源 | 空载内存 < 100 MB；探测期间 CPU 峰值 < 30%（4 核） |
| 兼容 | Node.js ≥ 20；Chrome / Edge / Firefox 最近两个大版本；不支持 IE |
| 可用性 | 单个探测失败不影响页面与 API；配置文件损坏时自动回退到备份文件 |
| 数据安全 | 写入采用「临时文件 + 原子重命名」，写入前保留备份；口令只存 scrypt 哈希 |
| 登录性能 | 单次登录口令校验（scrypt）< 150 ms；10 个并发登录不阻塞状态探测 |
| 可维护性 | 模块职责清晰，探测引擎可脱离 HTTP 层独立单元测试 |
| 可移植 | 不依赖原生编译模块，Windows 上 `npm install` 无需 Python / VS Build Tools |

---

## 6. 页面与交互设计

### 6.1 首页 `/`

```text
+------------------------------------------------------------------+
|  WinNav              [ 搜索服务...        ]      [刷新] [登录]   |
+------------------------------------------------------------------+
|  家庭服务  · 5/6 在线                                            |
|  +--------------+  +--------------+  +--------------+            |
|  | Jellyfin     |  | NAS 面板     |  | 路由器       |            |
|  | 影音服务器   |  | 存储与备份   |  | 192.168.1.1  |            |
|  | ● 12 ms      |  | ● 3 ms       |  | ● <1 ms      |            |
|  +--------------+  +--------------+  +--------------+            |
|  运维工具  · 1/2 在线                                            |
|  +--------------+  +--------------+                              |
|  | Grafana      |  | Portainer    |                              |
|  | ● 8 ms       |  | ● 超时       |                              |
|  +--------------+  +--------------+                              |
+------------------------------------------------------------------+
```

**加载时序（关键）**

1. `GET /` 返回页面骨架（静态资源带版本号，可长缓存）。
2. `GET /api/state` 返回配置 + 缓存状态，立即渲染卡片（可能先显示上次结果）。
3. 页面建立 `EventSource('/api/events')`，并调用 `POST /api/state/refresh`。
4. 服务端逐个探测，每完成一个就通过 SSE 推送 `status` 事件，卡片就地更新（状态点由灰变绿 / 红，延迟数字淡入）。
5. 全部完成后推送 `refresh:done`，刷新按钮恢复可用，并更新组内统计。
6. SSE 不可用时降级为每 1 s 轮询 `GET /api/status`，直至 `refreshing=false`。

**交互细节**

- 卡片悬停上浮 2 px，显示完整地址与「最近检测 HH:mm:ss」。
- 状态点带提示：在线 / 离线（超时 2500 ms）/ 未知。
- 刷新按钮点击后 3 s 内防重复点击。
- 搜索无结果时显示空状态提示。
- **普通用户视图**：卡片只作为链接，无编辑 / 删除 / 拖拽手柄；右上角只有「刷新」与「登录」。
- **管理员已登录视图**：右上角显示「刷新」「管理」「退出（admin）」，卡片出现编辑入口与拖拽手柄；会话过期后自动退回普通用户视图并提示重新登录。

### 6.2 管理页 `/admin`

- 未登录 → 用户名 + 口令登录框（限速：5 次失败 / 分钟 / IP）；页面上标注默认凭据 `admin / 123456` 并提示尽快修改。
- 登录后左侧分组列表、右侧卡片表格；编辑表单以对话框打开。
- 字段：名称（必填）、描述、地址（必填）、图标、分组、排序、启用开关。
- 表格自带实时状态列与「测试连接」按钮。
- 保存后首页通过 SSE 自动刷新，无需手动刷新浏览器。

### 6.3 账号设置 `/admin#account`

```text
+----------------------------------------------------+
|  账号设置                                          |
|                                                    |
|  用户名   [ ops                ]                   |
|  当前口令 [ ****************   ]                   |
|  新口令   [                    ]  强度: 中          |
|  确认口令 [                    ]                   |
|                                                    |
|        [ 保存修改 ]        [ 退出登录 ]            |
+----------------------------------------------------+
```

- 三项必填：当前口令用于二次确认身份。
- 前端即时校验：用户名格式与长度、新口令长度 ≥ 6、两次输入一致。
- 保存成功后提示「凭据已更新，其他设备需要重新登录」，并刷新会话。
- 若初始化后仍为默认口令，管理页顶部常驻黄色提醒条「当前使用默认口令，请立即修改」。

---

## 7. 技术方案

### 7.1 架构

```text
浏览器 ──HTTP──▶ Express 应用 ──▶ JSON Store（data/nav.json）
   ▲                 │              └─▶ 账号库（data/users.json，scrypt 哈希）
   │                 ├─ 鉴权中间件（session Cookie + 角色判定）
   └──SSE────────────┤
                     └─▶ Probe Engine（TCP / HTTP 探测、并发队列、结果缓存）
                            └─▶ 目标服务（IP:Port / 域名:Port）
```

- 读接口全部匿名开放；写接口统一经过 `requireAdmin` 中间件。
- 前端仅根据当前会话渲染按钮，真正的权限判定永远在服务端。

- 单进程 Node.js，HTTP 服务与静态资源同源，无跨域问题。
- 探测引擎与 HTTP 层解耦：`probe(service) -> Status`，可独立单测。
- 状态只存内存（重启后首次访问重新探测），配置持久化到磁盘。

### 7.2 依赖选型

| 用途 | 选型 | 理由 |
| --- | --- | --- |
| HTTP 框架 | `express` 5.x | 生态成熟、路由简单 |
| 配置存储 | 自研 JSON Store（`fs.promises` + 原子写） | 零原生依赖，便于手工编辑与备份 |
| 探测 | Node 内置 `net` / `http` / `https` / `dns.promises` | 无需第三方库，延迟测量精确 |
| ICMP（可选） | 调用系统 `ping.exe`（`child_process`） | 避免 raw socket 需要的管理员权限 |
| 日志 | `pino` + 自研按天滚动写入 | 结构化、开销低 |
| 口令校验 | Node 内置 `crypto.scrypt` + `timingSafeEqual` + `randomBytes` 盐 | 不引入 bcrypt 等原生模块 |
| 会话 | 内存 Map + `randomBytes(32)` 会话 id，HttpOnly Cookie | 重启即失效，符合单机定位 |
| 前端 | 原生 HTML / CSS / ES Module | 无构建、离线可维护、体积小 |
| 测试 | `node:test` + `supertest` | 内置测试器，零额外框架 |

### 7.3 目录结构

```text
WinNav/
├─ package.json
├─ README.md                 # 本文档
├─ .env.example              # PORT / HOST / ADMIN_PASSWORD / DATA_DIR
├─ src/
│  ├─ server.js              # 入口：读取配置、启动 HTTP、优雅退出
│  ├─ app.js                 # Express 装配：中间件、路由、静态资源
│  ├─ config.js              # 环境变量与默认值
│  ├─ store.js               # JSON 读写、原子保存、备份、schema 校验
│  ├─ users.js               # 账号库：默认 admin/123456、口令哈希、凭据修改
│  ├─ auth.js                # 会话签发、requireAdmin 中间件、登录限速
│  ├─ probe.js               # 地址解析、TCP/HTTP/ICMP 探测、并发队列、缓存
│  ├─ routes/
│  │  ├─ state.js            # GET /api/state, POST /api/state/refresh
│  │  ├─ events.js           # GET /api/events（SSE）
│  │  ├─ services.js         # 服务 CRUD 与排序（写：管理员）
│  │  ├─ groups.js           # 分组 CRUD 与排序（写：管理员）
│  │  ├─ account.js          # 登录 / 登出 / 当前账号 / 改用户名 / 改口令
│  │  └─ admin.js            # 测试连接 / 导入导出
│  └─ utils/                 # 校验、错误类型、日志
├─ public/
│  ├─ index.html
│  ├─ admin.html
│  ├─ css/style.css
│  ├─ js/app.js  js/admin.js  js/api.js
│  └─ icons/                 # 本地图标
├─ data/
│  ├─ nav.json               # 运行时生成
│  ├─ nav.json.bak
│  ├─ users.json             # 账号库（含 scrypt 哈希与盐）
│  ├─ users.json.bak
│  └─ logs/
├─ scripts/
│  ├─ install-service.ps1
│  └─ uninstall-service.ps1
└─ test/
   ├─ probe.test.js
   ├─ auth.test.js
   └─ api.test.js
```

---

## 8. 数据模型

### 8.1 `data/nav.json`

```json
{
  "version": 1,
  "settings": {
    "siteTitle": "WinNav",
    "theme": "auto",
    "probe": {
      "mode": "tcp",
      "timeoutMs": 2500,
      "concurrency": 8,
      "cacheTtlMs": 30000,
      "httpCheck": true,
      "intervalSec": 0
    }
  },
  "groups": [
    { "id": "g_home", "name": "家庭服务", "order": 0 }
  ],
  "services": [
    {
      "id": "s_jellyfin",
      "groupId": "g_home",
      "name": "Jellyfin",
      "description": "影音服务器",
      "url": "http://192.168.1.20:8096",
      "icon": "/icons/jellyfin.png",
      "order": 0,
      "enabled": true,
      "probe": { "mode": "inherit", "timeoutMs": null }
    }
  ]
}
```

**字段约束**

| 字段 | 规则 |
| --- | --- |
| `id` | 前缀（`s_` / `g_`）+ 12 位随机串，创建后不可变 |
| `url` | 必填；允许省略协议；解析后仅允许 `http` / `https`；拒绝 `file:` 等其他协议 |
| `icon` | 允许 http(s) URL、以 `/icons/` 开头的本地路径、emoji，最长 500 字符 |
| `order` | 非负整数，同组内唯一；保存时归一化为 0..n-1 |
| `enabled` | false 时首页置灰显示且不参与探测 |
| `probe.mode` | `inherit` / `tcp` / `http` / `icmp` |

### 8.2 内存状态结构

```js
{
  serviceId: {
    state: "online" | "offline" | "unknown",
    latencyMs: 12,            // 整数；失败为 null
    checkedAt: 1763200000000, // 毫秒时间戳
    method: "tcp",            // tcp | http | icmp
    httpStatus: 200,          // 可选
    error: null               // "ETIMEDOUT" | "ECONNREFUSED" | "ENOTFOUND" ...
  }
}
```

> 状态快照中的 `role` 不存在——角色只与请求会话相关，不下发给匿名接口。

### 8.3 `data/users.json`

```json
{
  "version": 1,
  "users": [
    {
      "id": "u_admin",
      "username": "admin",
      "role": "admin",
      "passwordHash": "<scrypt 输出，hex>",
      "salt": "<randomBytes(16)，hex>",
      "mustChangePassword": true,
      "createdAt": 1763200000000,
      "updatedAt": 1763200000000,
      "tokenVersion": 1
    }
  ]
}
```

**字段约束**

| 字段 | 规则 |
| --- | --- |
| `username` | 3~32 位，仅 `A-Za-z0-9_-`，不区分大小写地全局唯一；默认 `admin` |
| `role` | 本期固定 `admin`，为后续扩展保留 |
| `passwordHash` | `scrypt(password, salt, 64)` 的 hex，**绝不存明文** |
| `salt` | 16 字节随机值 hex，与哈希一同保存 |
| `mustChangePassword` | 初始为 `true`；首次成功修改口令后置 `false`，用于前端常驻提醒 |
| `tokenVersion` | 修改凭据时自增，用于让旧会话立即失效 |

**默认账号初始化**

- 启动时若 `users.json` 不存在，则创建 `admin / 123456`，`mustChangePassword = true`，并在控制台与日志打印一次提醒。
- 若 `ADMIN_PASSWORD` 环境变量已设置，则用该值代替 `123456` 作为初始口令（仅首次初始化生效，不覆盖已有账号）。
- **首次登录后强制引导**：进入 `/admin` 立即弹出「修改口令」提示，可选择跳过但顶部提醒条常驻，直至修改。

---

## 9. API 设计

统一响应：`{ ok: true, data } | { ok: false, error: { code, message } }`。

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/health` | 无 | `{ status, uptime, version, services }` |
| GET | `/api/state` | 无 | 配置 + 全部缓存状态 + `viewer: { authenticated, username?, mustChangePassword }` |
| POST | `/api/state/refresh` | 无 | 触发全量刷新；重入返回 `{ coalesced: true }` |
| GET | `/api/status` | 无 | 仅状态快照 + `refreshing` 标志（轮询降级用） |
| GET | `/api/events` | 无 | SSE：`status` / `refresh:start` / `refresh:done` / `config:changed` / `ping`（25 s 心跳） |
| POST | `/api/login` | — | `{ username, password }` → 设置 `sid` HttpOnly Cookie；失败 401 |
| POST | `/api/logout` | 管理员 | 清除当前会话 |
| GET | `/api/account` | 管理员 | 当前用户名、角色、`mustChangePassword` |
| PATCH | `/api/account` | 管理员 | `{ currentPassword, newUsername?, newPassword? }`，改凭据 |
| GET | `/api/groups` | 无 | 分组列表 |
| POST | `/api/groups` | 管理员 | 创建分组 |
| PATCH | `/api/groups/:id` | 管理员 | 重命名等更新 |
| DELETE | `/api/groups/:id` | 管理员 | 删除分组（需指定卡片去向：`moveTo` 或 `cascade`） |
| PUT | `/api/groups/order` | 管理员 | `{ ids: [...] }` |
| GET | `/api/services` | 无 | 服务列表 |
| POST | `/api/services` | 管理员 | 创建服务 |
| PATCH | `/api/services/:id` | 管理员 | 更新服务 |
| DELETE | `/api/services/:id` | 管理员 | 删除服务 |
| PUT | `/api/services/order` | 管理员 | `{ groupId, ids: [...] }` |
| POST | `/api/probe/test` | 管理员 | `{ url }` → 单次探测结果，限速 10 次 / 分钟 |
| GET | `/api/export` | 管理员 | 下载配置 JSON |
| POST | `/api/import` | 管理员 | 上传并校验后整体覆盖 |

> 鉴权列含义：「无」= 匿名可访问；「管理员」= 必须携带有效会话，否则 401。所有写接口在进入业务逻辑前先过 `requireAdmin`。

**登录 / 改凭据示例**

```text
POST /api/login
{ "username": "admin", "password": "123456" }
→ 200 Set-Cookie: sid=...; HttpOnly; SameSite=Strict; Path=/
→ { "ok": true, "data": { "username": "admin", "mustChangePassword": true } }

POST /api/login（口令错误）
→ 401 { "ok": false, "error": { "code": "INVALID_CREDENTIALS", "message": "用户名或口令错误" } }

PATCH /api/account      （需登录）
{ "currentPassword": "123456", "newUsername": "ops", "newPassword": "n3w-Passw0rd" }
→ 200 { "ok": true, "data": { "username": "ops", "mustChangePassword": false } }
→ 服务端 tokenVersion++，该账号其他会话立即失效
```

**SSE 示例**

```text
event: status
data: {"id":"s_jellyfin","state":"online","latencyMs":12,"checkedAt":1763200000000,"method":"tcp"}

event: refresh:done
data: {"total":8,"online":7,"offline":1,"durationMs":1240}
```

---

## 10. 在线检测设计（核心）

### 10.1 地址解析

```text
输入 "192.168.1.20:8096"          → scheme=http,  host=192.168.1.20,     port=8096
输入 "nas.local"                   → scheme=http,  host=nas.local,        port=80
输入 "https://panel.example.com"   → scheme=https, host=panel.example.com, port=443
输入 "http://[fe80::1]:8080"       → scheme=http,  host=fe80::1,          port=8080
```

- 无协议时按 `http` 处理；IPv6 字面量需方括号。
- 非法端口（0、> 65535）直接返回校验错误，不入库。
- 保存时把归一化后的地址写回 `url` 字段，展示与探测使用同一份结果。

### 10.2 探测算法（默认 `tcp` 模式）

1. 使用 `net.connect({ host, port })` 建立 TCP 连接，连接成功即判定**在线**，耗时即 **TCP 握手延迟**。
2. 连接失败、DNS 失败或超过 `timeoutMs`（默认 2500 ms）判定**离线**，记录错误码。
3. 若 `httpCheck = true` 且协议为 http / https，在 TCP 成功后追加一次 `HEAD` 请求（超时 3000 ms）：
   - 收到任意 HTTP 状态码（含 401 / 403 / 500）→ 仍判在线，记录 `httpStatus` 作为附加信息；
   - 网络层失败但 TCP 曾成功 → 保持在线，附注「HTTP 无响应」。
4. 每个探测独立计时，使用 `process.hrtime.bigint()`，结果四舍五入为整数毫秒。

**为什么以 TCP 而不是 ICMP 为主**

- 需求是「IP + 端口」可达性，ICMP 只能证明主机存活，无法证明端口上的服务可用。
- 内网设备常禁用 ICMP；TCP 探测更贴近用户真实访问体验。
- 纯 Node 实现 ICMP 需要 raw socket（Windows 下需管理员），因此 ICMP 仅作可选模式，调用系统 `ping.exe` 并解析输出。

**`http` 模式**：直接发起 GET / HEAD，以「收到响应（任意状态码）」为在线，延迟为请求总耗时。

**`icmp` 模式**：执行 `ping -n 1 -w <timeout> <host>`，解析 `时间=xxms` / `time<1ms`；该模式忽略端口，适用于只关心主机存活的场景。

### 10.3 并发、去重与缓存

```js
// 伪代码
const inflight = new Map();   // serviceId -> Promise<Status>
const cache = new Map();      // serviceId -> Status
let refreshPromise = null;

async function refreshAll() {
  if (refreshPromise) return { coalesced: true };
  const targets = services.filter(s => s.enabled);
  sse.broadcast("refresh:start", { total: targets.length });
  refreshPromise = runPool(targets, concurrency, async (svc) => {
    const st = await probeOnce(svc);
    cache.set(svc.id, st);
    sse.broadcast("status", st);        // 完成一个推一个
  }).finally(() => {
    refreshPromise = null;
    sse.broadcast("refresh:done", summarize(cache, targets));
  });
  return { coalesced: false };
}
```

- **入口去重**：`refreshAll` 执行期间新的刷新请求直接返回 `coalesced`，不重复探测。
- **单服务去重**：同一服务的并发探测复用同一 Promise。
- **缓存策略**：`cacheTtlMs`（默认 30 s）内的结果可直接用于首屏；页面加载触发的刷新可跳过 `checkedAt` 小于 10 s 的服务（可配置为强制全量）。
- **失败不重试**：一次刷新内每个服务只探测一次，避免离线设备拖慢整体；下次访问自然重试。
- **可选定时探测**：`intervalSec > 0` 时服务端定时轮询（默认 0，关闭），用于大屏场景。

### 10.4 状态判定与展示

| 状态 | 条件 | 展示 |
| --- | --- | --- |
| online | 探测成功 | 绿点 + 延迟（如 `12 ms`） |
| offline | 超时 / 拒绝连接 / DNS 失败 | 红点 + `—`，悬停显示原因与上次在线时间 |
| unknown | 尚未探测或服务已停用 | 灰点 + `—` |

- 延迟可选分档着色：< 50 ms 绿、50~200 ms 黄、> 200 ms 橙；仅作辅助提示，不影响在线结论。

### 10.5 安全与限速

- 只允许探测**已保存**的服务地址，禁止通过查询参数探测任意 URL（防止被当作内网端口扫描器）。
- `/api/probe/test` 仅管理员可用，限速且超时更短（1500 ms）。
- 探测仅发起 TCP 连接与 HEAD 请求，不发送请求体，不携带 Cookie。

---

## 11. 存储设计

- 启动时若 `data/nav.json` 不存在，写入内置默认配置（一个「默认分组」）。
- 读取时做 schema 校验（版本号、字段类型、引用完整性）；失败则尝试 `nav.json.bak`，仍失败则拒绝启动并输出明确日志（避免静默清空数据）。
- 保存流程：序列化 → 写 `nav.json.tmp` → `fsync` → 现有文件复制为 `.bak` → `rename` 覆盖。
- 所有写操作串行化（内部 Promise 队列），防止并发写损坏文件。
- 配置变更后向所有 SSE 连接广播 `config:changed`，其他打开的页面自动重新拉取。


---

## 12. Windows 部署与运行

### 12.1 环境要求

- Windows 10 / 11 / Server 2019+（x64）
- Node.js 20 LTS 或 22 LTS（安装包自带 npm）
- 一个空闲 TCP 端口（默认 8080）

### 12.2 开发 / 直接运行

```powershell
cd E:\path\to\WinNav
npm install
Copy-Item .env.example .env        # 按需修改 PORT / ADMIN_PASSWORD
npm start                           # http://127.0.0.1:8080
```

`.env.example`

```ini
PORT=8080
HOST=0.0.0.0
# 仅首次初始化 users.json 时生效；不填则使用默认口令 123456
ADMIN_PASSWORD=
DATA_DIR=./data
LOG_LEVEL=info
```

首次启动会在控制台打印：

```text
[WinNav] 已创建默认管理员：admin / 123456
[WinNav] 请登录 http://127.0.0.1:8080/admin 后立即修改口令
```

### 12.3 注册为 Windows 服务（推荐 NSSM）

```powershell
# scripts/install-service.ps1，需以管理员身份运行
$node = (Get-Command node).Source
$app  = "E:\path\to\WinNav\src\server.js"
$root = "E:\path\to\WinNav"

nssm install WinNav $node $app
nssm set WinNav AppDirectory $root
nssm set WinNav AppEnvironmentExtra "PORT=8080" "DATA_DIR=$root\data"
nssm set WinNav AppStdout "$root\data\logs\service.out.log"
nssm set WinNav AppStderr "$root\data\logs\service.err.log"
nssm set WinNav AppRotateFiles 1
nssm set WinNav AppExit Default Restart
nssm set WinNav Start SERVICE_AUTO_START
nssm start WinNav
```

- 备选方案：`node-windows`（npm 包，用脚本生成服务）、任务计划程序「开机启动 + 失败重启」。
- 卸载：`nssm stop WinNav; nssm remove WinNav confirm`。
- 如需局域网访问，放行防火墙端口：
  `New-NetFirewallRule -DisplayName "WinNav" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow`

### 12.4 访问地址

- 本机：`http://127.0.0.1:8080`
- 局域网：`http://<本机IP>:8080`，管理页 `/admin`

### 12.5 升级与备份

- 升级：停止服务 → 替换代码 → `npm ci --omit=dev` → 启动；`data/` 目录不受影响。
- 备份：定期复制 `data/nav.json`，或使用管理页的导出功能。

---

## 13. 账号、鉴权与安全设计

### 13.1 账号模型

- 本期只有**一个内置管理员账号**：默认 `admin / 123456`，首次启动自动写入 `data/users.json`。
- **普通用户不是账号**：任何未携带有效会话的访客都视为普通用户，可直接浏览，无需登录、无需注册。
- 角色判定只有两条规则：`session exists && session.role === "admin"` → 管理员；否则 → 普通用户。
- 账号信息只有用户名与口令，无邮箱、无头像、无找回流程（内网自托管场景）。

### 13.2 登录流程

1. 前端提交 `{ username, password }`（HTTPS 缺失时仍走同源 POST，不放在 URL 里）。
2. 服务端按用户名（大小写不敏感）查找账号：
   - 未找到：仍执行一次等价的 scrypt 计算（使用固定假盐），避免通过响应时间枚举账号。
   - 找到：`scrypt(password, salt, 64)` 与 `passwordHash` 用 `timingSafeEqual` 比较。
3. 失败：返回统一 401 `INVALID_CREDENTIALS`，累计该 IP 的失败次数。
4. 成功：生成 `sid = randomBytes(32).toString("base64url")`，写入内存会话表 `{ sid → { userId, role, tokenVersion, createdAt, lastSeenAt, ip } }`，并下发 Cookie：
   ```text
   Set-Cookie: sid=<...>; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200
   ```
5. 前端拿到成功后跳转 `/admin`；若 `mustChangePassword=true` 则先弹出修改口令对话框。

### 13.3 会话与凭据变更

- 会话只存内存（重启后全部失效，需要重新登录），默认有效期 12 h，每次请求刷新 `lastSeenAt`，超过 12 h 未活动即失效。
- 会话校验时同时比对 `tokenVersion`：与账号库不一致 → 视为失效（用于凭据修改后踢掉其他设备）。
- **修改用户名或口令**（`PATCH /api/account`）要求：
  1. 携带 `currentPassword` 并通过校验；
  2. 新用户名通过格式与唯一性校验（不能与其他账号重名）；
  3. 新口令长度 6~64，且不得与当前口令相同；
  4. 变更成功后 `tokenVersion++`、`mustChangePassword=false`、写盘并清理该账号的其他会话，**保留当前会话**。
- 忘记口令的应急方案：停止服务后删除 `data/users.json`（或设置 `RESET_ADMIN=1` 启动一次），重启即恢复默认 `admin / 123456`，首登后须立即修改。该操作只影响账号，不影响 `nav.json` 中的卡片配置。

### 13.4 服务端权限校验

- 中间件顺序：`cookieParser` → `attachViewer`（解析会话，匿名不报错） → `requireAdmin`（仅挂在写接口上）。
- 写接口清单：`POST/PATCH/DELETE /api/groups*`、`POST/PATCH/DELETE /api/services*`、`PUT /*order`、`POST /api/probe/test`、`GET /api/export`、`POST /api/import`、`PATCH /api/account`、`POST /api/logout`。
- 未通过校验一律返回：
  ```json
  { "ok": false, "error": { "code": "UNAUTHORIZED", "message": "需要管理员登录" } }
  ```
- 前端隐藏按钮只是体验层：直接 `curl` 调用写接口同样会被拦截（验收用例覆盖）。
- `GET /api/state` 返回的 `viewer` 字段只用于渲染按钮，不含任何凭据信息。

### 13.5 安全措施

| 项 | 措施 |
| --- | --- |
| 口令存储 | `scrypt` + 每账号 16 字节随机盐，仅存哈希；日志与 API 响应绝不回传哈希 |
| 默认口令 | 首次登录即提醒修改，未修改前管理页常驻黄色警告条 |
| Cookie | HttpOnly + SameSite=Strict + Path=/；不设 `Secure`（内网 HTTP 场景），公网部署时由反向代理加 TLS 后再开启 |
| 会话固定 | 登录成功即重新生成 `sid`，不复用登录前的任何标识 |
| 登录限速 | 5 次失败 / 分钟 / IP，连续失败 10 次锁定 10 分钟并返回 `TOO_MANY_ATTEMPTS` |
| 输入校验 | 协议白名单、长度上限、字段类型校验；前端一律用 `textContent` 渲染用户数据，禁止拼接 `innerHTML` |
| XSS | 图标仅允许 http(s) 与本地路径，拒绝 `javascript:`、`data:` |
| CSRF | 写接口校验 `Origin` 与 Host 同源；Cookie SameSite=Strict |
| SSRF | 仅探测已保存地址；测试接口限管理员；探测不返回响应体 |
| 路径穿越 | 静态资源仅暴露 `public/`；图标路径规范化后必须位于 `public/icons/` 内 |
| 监听地址 | 默认 `0.0.0.0` 便于内网访问；可设 `HOST=127.0.0.1` 仅本机可访问 |
| 权限最小化 | 匿名只读；写接口全部要求管理员会话，避免「隐藏按钮」式伪权限 |
| 依赖安全 | 锁定 `package-lock.json`，定期执行 `npm audit` |

> 本工具定位为内网自托管，默认不提供 HTTPS。若需公网访问，应置于反向代理（IIS / Caddy / Nginx）之后并启用 TLS。

---

## 14. 日志与可观测性

- 访问日志：方法、路径、状态码、耗时、来源 IP（不记录请求体与口令）。
- 安全日志：登录成功 / 失败、触发限速、登出、凭据修改，均记录用户名与 IP（不记录口令）。
- 探测日志（debug 级）：服务 id、目标地址、结果、耗时、错误码。
- 文件日志：`data/logs/app-YYYY-MM-DD.log`，保留 14 天，单文件上限 20 MB。
- 控制台同时输出，便于前台调试。
- `/api/health` 返回运行时长、版本、服务数量、上次刷新耗时（不含账号信息）。

---

## 15. 验收标准

1. 在干净的 Windows 机器上按 12.2 步骤操作，3 分钟内完成启动并看到首页。
2. 新增「`127.0.0.1:8080`」与「`http://不存在的域名`」两条记录，刷新页面后分别显示绿点 `<1 ms` 与红点 `—`。
3. 在 100 个服务的配置下刷新页面：500 ms 内出现可交互骨架，5 s 内所有卡片完成状态更新。
4. 同时打开 5 个标签页刷新，服务端对每个目标只发起 1 次探测（日志可验证）。
5. 目标服务停止后，下一次页面刷新在 `timeoutMs` 内变红；服务恢复后下一次刷新变绿。
6. 删除 `nav.json` 后启动能自动生成默认配置；写入损坏 JSON 时能从 `.bak` 恢复并在日志中告警。
7. 全新安装后直接访问首页（不登录）可看到全部卡片与实时状态，且页面上不存在任何编辑按钮。
8. 用默认 `admin / 123456` 能登录并进入管理台；用错误口令 5 次 / 分钟后被限流，第 6 次返回 `TOO_MANY_ATTEMPTS`。
9. 未登录 `curl -X POST /api/services` 返回 401，前端按钮隐藏与否都不影响服务端拦截。
10. 管理员把用户名改为 `ops`、口令改为 `n3w-Passw0rd` 后：旧口令登录失败，新凭据登录成功；另一浏览器中的旧会话被踢出。
11. `data/users.json` 中只有哈希与盐，搜索不到 `123456` 明文。
12. 删除 `data/users.json` 重启后，可用 `admin / 123456` 再次登录，卡片配置保持不变。
13. 注册为 Windows 服务后重启系统能自动启动，且依赖安装过程无需编译工具。
14. 断网时首页仍能显示卡片与上次状态，控制台无未捕获异常。

---

## 16. 里程碑

| 阶段 | 内容 | 产出 |
| --- | --- | --- |
| M1（P0） | 数据存储、探测引擎、首页渲染、页面加载自动刷新、SSE 推送 | 可用的只读导航站 |
| M2（P0 / P1） | 账号库、登录会话、管理员鉴权中间件、CRUD、排序、测试连接、日志 | 可自助维护 |
| M3（P1 / P2） | 账号设置（改用户名 / 口令）、搜索、折叠、主题、导入导出、定时探测、服务化脚本 | 可交付版本 v1.0 |
| M4（可选） | 单元测试、国际化、大屏模式 | 长期维护 |

**建议实现顺序**：`store.js` → `users.js`（默认账号 + 哈希）→ `auth.js`（会话与 `requireAdmin`）→ `probe.js`（含单测）→ `/api/state` + SSE → 首页（匿名视图）→ 登录页 → 管理页 → 账号设置 → 服务化脚本。

---

## 17. 风险与待确认项

| 风险 / 问题 | 影响 | 建议 |
| --- | --- | --- |
| 目标服务要求特定 Host 头或需登录才响应 | TCP 探测仍判在线（符合预期）；HTTP 模式可能误判 | 默认 tcp 模式，HTTP 结果仅作附加信息 |
| 大量离线设备拖慢刷新 | 首屏状态更新延迟 | 并发 8 + 单次不重试 + 逐条 SSE 推送 |
| 多网卡 / VPN 环境下 DNS 解析差异 | 域名偶发解析失败 | 记录错误码；后续可增加 hosts 映射配置 |
| 管理口令泄露导致内网探测面扩大 | 端口扫描风险 | 仅探测已保存地址、管理接口限速、默认内网监听 |
| 默认口令 `123456` 未修改即投入使用 | 任何人可编辑卡片 | 首登提醒 + 常驻警告条 + 文档默认要求首登必改 |
| 内网 HTTP 明文传输口令 | 同网段可嗅探 | 建议仅内网使用；需公网时置于 TLS 反向代理之后 |
| 图标外链失效或加载慢 | 卡片视觉不完整 | 图片 `onerror` 回退首字母占位，图标可本地化 |
| 是否需要移动端 / 大屏专用布局 | 影响前端工作量 | 本期用响应式覆盖，大屏可后续加 `?mode=wall` |

**待确认**

1. 普通用户是否需要口令保护（如访客码）？（当前设计：完全匿名可浏览）
2. 是否需要第二个只读/只编辑的账号角色？（当前设计：仅一个管理员）
3. 默认用户名 `admin` / 口令 `123456` 是否作为出厂值保留？是否需要强制首次登录必须改口令？
4. 是否需要大屏轮播 / 自动翻页展示？
5. 是否需要历史在线率与探测间隔统计？（会引入 SQLite 等时序存储）
6. 默认端口 8080 是否与现有服务冲突？

---


