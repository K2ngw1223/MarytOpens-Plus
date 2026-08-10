# MarytOpens
该项目与项目创建者的网站部署可能存在差异，使用前请复刻到自己的仓库进行源码改动，以适配自己的需求，不可直接部署，请提前建立API域名，您可以选择使用路径而不是子域名，使用前请仔细阅读，遇到问题自己解决或是询问AI，开源项目不提供其他技术支持与更新服务！

> 一个基于 Cloudflare 边缘网络构建的现代社区治理平台 —— 个人博客 + 社区论坛 + Discord 式频道/群组治理，零公共 CDN 依赖，全自托管。

- **API 域名**：`https://api.example.top`
- **前端域名**：`https://example.top`

---

## ✨ 特性

- **现代社区后端**：Cloudflare Worker + KV + R2，边缘运行，低延迟。
- **完整用户体系**：注册 / 登录（邮箱验证码 + Cloudflare Turnstile + GitHub / Discord OAuth）、客户端 SHA-256 预哈希 + 服务端 PBKDF2 派生。
- **作用域权限模型**：超级管理员、频道主、群主、版主等 Discord 式角色 / 频道 / 群组治理（详见 [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md)）。
- **内容生态**：Markdown 文章（公开 / 会员 / 私密 / 指定身份组 / 草稿）、评论、点赞、收藏、关注、私信、通知、举报。
- **治理工具**：IP 封禁、禁言、强制改名、站点配置、Cloud Mail 发信、机器人 API。
- **Discord 机器人**：把频道消息 / 指令桥接到平台（发布 / 通知 / 审核 / 同步），见 [`bot/BOT_API.md`](bot/BOT_API.md)。
- **美观响应式 UI**：9 种语言、自动时间格式、深色 / 浅色主题（跟随系统，可手动切换）、自托管静态资源（无任何公共 CDN）。
- **用户文件存储（绑定自己的 Cloudflare）**：登录后绑定个人 Cloudflare 账号，系统自动创建 KV 命名空间 + D1 数据库，文件存于用户自有账户；支持分享链接、预览码与公开下载。未绑定用户数据存浏览器本地并有丢失提示。
- **落地页社交入口**：超管在后台配置 Discord / GitHub / Telegram 目标 URL 与客户端下载页（本网站下载 + GitHub 下载两个入口），未登录主页与全站页脚显示对应图标与下载入口；Telegram 链接保存后自动解析头像与名称替换图标。
- **全站搜索**：可按 用户 / 文件 / 帖子 / 文章 / 官方公告 分类筛选（`/search.html`）。
- **关于页公示**：超管可编辑「关于我们」，并公示贡献者（指向用户主页的链接自动捕获头像与用户名，支持本网站 / GitHub / QQ）与账号、IP 封禁公示（仅显示用户名、头像打码、邮箱前 3 后 5 掩码）。
- **语言自动识别**：进入网站自动探测浏览器语言，首次访问弹窗提示当前语言，可在弹窗内或「用户和系统设置」中随时切换；支持 9 种语言。
- **首访体验**：个人主页落地页 → 登录后进入真实社区首页。

---

## 📁 项目结构

```
MarytOpens/
├── worker/                 # 后端 Worker
│   ├── src/index.js        # 单文件后端（路由 / 鉴权 / 权限 / 存储）
│   ├── wrangler.toml       # 绑定与部署配置
│   ├── .dev.vars.example   # 本地密钥样例
│   └── package.json
├── pages/                  # 前端（Cloudflare Pages 静态站点）
│   ├── index.html …        # 22 个页面（首页/社区/文章/后台/设置/我的文件…）
│   └── assets/
│       ├── css/main.css
│       ├── img/            # favicon.svg / logo.svg（自托管）
│       └── js/             # api.js / app.js / i18n.js / feed.js / channel_manage.js / admin.js / storage.js
├── bot/                    # Discord 社区机器人（独立 Node 进程）
│   ├── src/                # 入口 + 命令 + 平台 API 客户端 + 权限映射
│   ├── BOT_API.md          # 机器人接口与配置手册
│   └── package.json
├── tools/                  # 开发期校验工具（check-inline.js）
└── docs/                   # 文档
    ├── DEPLOY.md           # 部署与运维教程
    ├── PERMISSIONS.md      # 权限系统手册
    └── KV_SCHEMA.md        # 存储结构（KV / R2）手册
```

---

## 🚀 快速开始

### 后端

```bash
cd worker
wrangler kv namespace create DB
wrangler r2 bucket create marytopens-media
# 填入 wrangler.toml 的 KV id / R2，并用 wrangler secret put 注入敏感变量
wrangler deploy
```

### 前端

将 `pages/` 目录作为构建输出上传到 **Cloudflare Pages**（无需构建命令），绑定自定义域 `example.top`。
完整步骤见 [`docs/DEPLOY.md`](docs/DEPLOY.md)。

### Discord 机器人

```bash
cd bot
cp .env.example .env
npm install
npm start
```
详见 [`bot/BOT_API.md`](bot/BOT_API.md)。

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
- **R2（绑定 `MEDIA`，桶 `marytopens-media`）**：用户头像 / 横幅 / 配图，键格式 `${kind}/${uid}/${fileId}.${ext}`。

---

## 🛠️ 技术栈

| 层 | 技术 |
| --- | --- |
| 后端 | Cloudflare Workers (ES Module)、KV、R2、Hono 风格路由 |
| 鉴权 | JWT（HMAC-SHA256）、PBKDF2 密码派生、Turnstile、OAuth2 |
| 前端 | 原生 HTML / CSS / JS（零构建、零公共 CDN）、9 语言 i18n |
| 机器人 | Node.js + discord.js v14、平台 Bot API（`X-Bot-Token`） |

---

## 📚 文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/DEPLOY.md](docs/DEPLOY.md) | 从零部署到 Cloudflare 的完整教程与排错 |
| [docs/PERMISSIONS.md](docs/PERMISSIONS.md) | 权限位清单、身份组模板、判定逻辑 |
| [docs/KV_SCHEMA.md](docs/KV_SCHEMA.md) | KV / R2 键规范与运维备份 |
| [bot/BOT_API.md](bot/BOT_API.md) | Discord 机器人接口、配置、权限映射 |

---

## 📄 许可

本项目用于演示与个人部署。请遵守当地法律法规与 Cloudflare 服务条款。
