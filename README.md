# MarytOpens

> 一个跑在 Cloudflare 边缘网络上的社区治理平台 —— 个人博客 + 社区论坛 + Discord 式频道/群组治理。
> 零构建、零公共 CDN、全自托管。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

- 后端：Cloudflare Workers（单文件 ES Module）+ KV/D1 + R2
- 前端：原生 HTML / CSS / JS，22 个页面，9 种语言，深色/浅色主题
- 依赖：无框架、无打包器、无公共 CDN

---

## ✨ 特性

- **现代社区后端**：Cloudflare Worker + KV + D1 + R2，边缘运行，低延迟。
- **完整用户体系**：注册 / 登录（邮箱验证码 + Cloudflare Turnstile + GitHub / Discord OAuth）、客户端 SHA-256 预哈希 + 服务端 PBKDF2 派生。
- **作用域权限模型**：超级管理员、频道主、群主、版主等 Discord 式角色 / 频道 / 群组治理，见 [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md)。
- **内容生态**：Markdown 文章（公开 / 会员 / 私密 / 指定身份组 / 草稿）、评论、点赞、收藏、关注、私信、通知、举报。
- **治理工具**：IP 封禁、禁言、强制改名、站点配置、发信服务。
- **用户文件存储**：登录后绑定自己的 Cloudflare 账号，系统自动创建 KV + D1，文件存于用户自有账户；支持分享链接、预览码与公开下载。
- **美观响应式 UI**：9 种语言、自动时间格式、主题跟随系统、自托管静态资源。
- **全站搜索**：可按 用户 / 文件 / 帖子 / 文章 / 官方公告 分类筛选。
- **端到端加密私信**：PawCrypt 协议 + 阅后即焚，密钥仅由用户掌握，服务端只存密文。

---

## 📁 项目结构

```
MarytOpens/
├── site.config.json          # 集中配置：域名 / 站点名 / 邮箱（改这里）
├── deploy-info.json          # 部署留档，由配置器生成
├── worker/                   # 后端 Worker
│   ├── src/index.js          # 单文件后端（路由 / 鉴权 / 权限 / 存储）
│   ├── wrangler.toml         # 绑定与部署配置
│   ├── .dev.vars.example     # 本地密钥样例
│   ├── scripts/              # 部署 / 备份脚本（不依赖 wrangler，走 curl）
│   └── package.json
├── pages/                    # 前端（Cloudflare Pages 静态站点）
│   ├── index.html …          # 22 个页面
│   └── assets/{css,img,js}
├── tools/                    # 配置器与开发期校验工具
│   ├── configure.mjs         # 集中配置应用器（部署前必跑）
│   ├── check-inline.js       # 内联脚本语法校验
│   └── i18n-*.py             # 多语言提取与合并
└── docs/                     # 文档
    ├── DEPLOY.md             # 部署与运维教程
    ├── DEPLOY_REGISTRY.md    # 部署登记模块说明
    ├── PERMISSIONS.md        # 权限系统手册
    └── KV_SCHEMA.md          # 存储结构手册
```

---

## 🚀 快速开始

### 0. 配置你自己的域名

整个项目不含任何硬编码域名，全部集中在 `site.config.json`：

```json
{
  "siteName": "MarytOpens",
  "siteOrigin": "https://your-site.com",
  "apiOrigin": "https://api.your-site.com",
  "supportEmail": "admin@your-site.com",
  "repoUrl": "https://github.com/you/marytopens"
}
```

改完执行：

```bash
node tools/configure.mjs
```

它会把这几个值同步到前端页面、`worker/wrangler.toml`、文档中，并生成 `deploy-info.json`。
脚本可重复执行；`node tools/configure.mjs --check` 可校验是否还有占位值未替换（适合接 CI）。

### 1. 创建 Cloudflare 资源

```bash
cd worker
npx wrangler kv namespace create DB
npx wrangler kv namespace create DB --preview
npx wrangler d1 create marytopens
npx wrangler r2 bucket create marytopens-media   # 可选
```

把返回的 ID 填回 `worker/wrangler.toml`，并建好 D1 表结构（见 [`docs/KV_SCHEMA.md`](docs/KV_SCHEMA.md)）。

### 2. 注入密钥

```bash
cp .dev.vars.example .dev.vars    # 本地开发
npx wrangler secret put JWT_SECRET
npx wrangler secret put SUPER_ADMIN_PASSWORD
# 其余按需：TURNSTILE_SECRET / GITHUB_CLIENT_SECRET / ENCRYPTION_SECRET / MAIL_API_TOKEN …
```

完整清单见 `worker/.dev.vars.example`。

### 3. 部署

```bash
cd worker
npx wrangler deploy                        # 后端
npx wrangler pages deploy ../pages --project-name marytopens   # 前端
```

本机若因 TUN / 代理导致 node 直连 `api.cloudflare.com` 失败，可改用不依赖 wrangler 的纯 REST 部署：

```bash
CLOUDFLARE_API_TOKEN=xxx CF_ACCOUNT_ID=xxx npm run deploy:api:all
```

完整步骤与排错见 [`docs/DEPLOY.md`](docs/DEPLOY.md)。

---

## 🔐 权限模型速览

权限 = **作用域 (Scope) + 权限位 (Perm) + 身份组 (Role) + 成员 (Member)**。

| 角色 | 权限级别 |
| --- | --- |
| 超级管理员 `site.admin` | 一切权限 |
| 站点管理员 `admin` | 全站治理 |
| 频道主 `channel_owner` | 频道及下属群组 |
| 群主 / 版主 … | 对应作用域治理 |
| 成员 `member` | 发帖 / 评论 / 互动 |

完整权限位清单与判定逻辑见 [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md)。

---

## 🗄️ 存储

- **KV（绑定 `DB`）**：用户、文章、角色、成员、索引、计数器、访问日志。键规范见 [`docs/KV_SCHEMA.md`](docs/KV_SCHEMA.md)。
- **D1（绑定 `DB1`）**：主存储。运行时通过 KV 兼容层把 `env.DB` 的读写路由到 D1。
- **R2（绑定 `MEDIA`，可选）**：头像 / 横幅 / 配图，键格式 `${kind}/${uid}/${fileId}.${ext}`。未绑定时自动回退 KV。

---

## 🛠️ 技术栈

| 层 | 技术 |
| --- | --- |
| 后端 | Cloudflare Workers (ES Module)、KV、D1、R2、Hono 风格路由 |
| 鉴权 | JWT（HMAC-SHA256）、PBKDF2 密码派生、Turnstile、OAuth2 |
| 前端 | 原生 HTML / CSS / JS（零构建、零公共 CDN）、9 语言 i18n |

---

## 🧪 开发

```bash
# 前端内联脚本语法校验（改前端后先跑）
node tools/check-inline.js pages

# 检查页面是否裸调用了未解构的 App 成员（静默失败的常见根因）
node tools/check-app-helpers.js pages

# 配置完整性校验（CI 友好，有占位残留则退出码 1）
node tools/configure.mjs --check

# 后端语法
node --check worker/src/index.js

# 本地起 Worker
cd worker && npx wrangler dev --local
```

---

## 📚 文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/DEPLOY.md](docs/DEPLOY.md) | 从零部署到 Cloudflare 的完整教程与排错 |
| [docs/DEPLOY_REGISTRY.md](docs/DEPLOY_REGISTRY.md) | 可选的部署登记模块（默认关闭） |
| [docs/PERMISSIONS.md](docs/PERMISSIONS.md) | 权限位清单、身份组模板、判定逻辑 |
| [docs/KV_SCHEMA.md](docs/KV_SCHEMA.md) | KV / D1 / R2 键规范与运维备份 |

---

## 🤝 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请走 [SECURITY.md](SECURITY.md) 的私下渠道，不要开公开 Issue。

---

## 📄 许可

[MIT](LICENSE)。请遵守当地法律法规与 Cloudflare 服务条款。
