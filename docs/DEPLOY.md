# MarytOpens · 部署与运维教程

本教程带你把一个完整的 MarytOpens 实例部署到 Cloudflare：后端 Worker（API）+ 前端 Pages（站点）。
全程**不依赖任何第三方公共 CDN**——所有静态资源自托管在 Cloudflare Pages。

---

## 0. 架构一览

```
浏览器 ──https://natrois.top──▶ Cloudflare Pages (静态前端 pages/)
        ──https://api.natrois.top/api/*──▶ Worker (worker/src/index.js)
                                          ├─ KV 绑定  DB   （用户/文章/角色/索引/日志）
                                          └─ R2 绑定  MEDIA（头像/配图）
```

- **API 域名**（固定）：`https://api.natrois.top`
- **前端域名**（固定）：`https://natrois.top`
- 需要 `natrois.top` 已托管在**同一个 Cloudflare 账号**（用于自定义域与 DNS）。

---

## 1. 准备

| 项目 | 说明 |
| --- | --- |
| Cloudflare 账号 | 免费版即可（KV / R2 / Pages / Workers 均含免费额度） |
| `natrois.top` 域名 | 已添加到 Cloudflare，NS 指向 Cloudflare |
| Node.js ≥ 18 | 本地运行 `wrangler` 与机器人 |
| `wrangler` | `npm i -g wrangler` 并 `wrangler login` |

---

## 2. 后端 Worker 部署

### 2.1 创建存储绑定

```bash
cd worker

# KV 命名空间（生产 + 预览）
wrangler kv namespace create DB
wrangler kv namespace create DB --preview
# 记下返回的 id / preview_id，填入 wrangler.toml 的 [[kv_namespaces]]

# R2 桶
wrangler r2 bucket create marytopens-media
```

### 2.2 填入 wrangler.toml

打开 `worker/wrangler.toml`：

1. 把 `[[kv_namespaces]]` 的 `id` / `preview_id` 替换为上一步拿到的真实值。
2. `[vars]` 中补全非敏感配置：
   - `TURNSTILE_SITE_KEY`、`GITHUB_CLIENT_ID`、`DISCORD_CLIENT_ID`（公开密钥）
   - `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_USERNAME`（首启超级管理员）
   - `MAIL_PROVIDER` / `MAIL_API_URL` / `MAIL_FROM`（见 §8）

### 2.3 注入敏感 Secret（切勿提交到仓库）

```bash
wrangler secret put JWT_SECRET            # openssl rand -hex 32
wrangler secret put SUPER_ADMIN_PASSWORD  # 强密码
wrangler secret put TURNSTILE_SECRET
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put DISCORD_CLIENT_SECRET
wrangler secret put MAIL_API_TOKEN
wrangler secret put CF_OAUTH_CLIENT_SECRET   # 用户绑定自己 CF 账号的 OAuth 应用密钥
wrangler secret put ENCRYPTION_SECRET        # 用户令牌 AES-GCM 加密密钥（建议独立于 JWT_SECRET）
wrangler secret put CF_API_TOKEN
wrangler secret put CF_ACCOUNT_ID
wrangler secret put CF_ZONE_ID
wrangler secret put BOT_MASTER_TOKEN     # 可选，机器人主令牌
```

> 本地开发可用 `worker/.dev.vars`（已被 `.gitignore` 忽略）替代 secret。

### 2.4 部署

```bash
wrangler deploy
```

部署成功后，Worker 已绑定到自定义域 `api.natrois.top`（见 `wrangler.toml` 的 `routes`）。
验证：`curl https://api.natrois.top/api/meta` 应返回站点元信息 JSON。

---

## 3. 前端 Pages 部署

前端代码全部在 `pages/` 目录（含 `assets/`）。

### 3.1 方式 A：控制台拖拽上传（最快）

1. Cloudflare 控制台 → **Workers & Pages → Create → Pages → 直接上传**。
2. 项目名称：`marytopens-frontend`。
3. 上传 `pages/` 整个目录为构建输出。
4. 部署后进入 **自定义域**，绑定 `natrois.top`（与 `api.natrois.top` 同域但根路径）。

### 3.2 方式 B：Git 连接（推荐，便于持续部署）

1. 把仓库推到 GitHub/GitLab。
2. Pages → 连接仓库，构建配置：
   - **构建命令**：留空（纯静态，无需构建）
   - **构建输出目录**：`pages`
3. 绑定自定义域 `natrois.top`。

> 前端通过 `meta[name="mo-api"]` 或默认 `https://api.natrois.top` 找到后端；生产环境无需改动。本地联调时可在 HTML `<head>` 加 `<meta name="mo-api" content="http://127.0.0.1:8787">`。

---

## 4. DNS 与 HTTPS

在 Cloudflare **DNS** 中为两个自定义域确认记录存在（Pages / Workers 路由通常会自动创建）：

- `natrois.top` → Pages
- `api.natrois.top` → Worker

确保两者 **SSL/TLS 模式 = Full (Strict)**，并开启 **Always Use HTTPS**。

---

## 5. 超级管理员首次登录

1. 打开 `https://natrois.top`，进入登录/注册。
2. 使用 `wrangler secret` 中设置的 `SUPER_ADMIN_EMAIL` + `SUPER_ADMIN_PASSWORD` 登录（首次启动自动创建该账号并授予 `site.admin`）。
3. 登录后访问 `https://natrois.top/admin_dashboard.html` 进入管理后台，按需配置站点标题、导航、关于页、身份组等。

> 若忘记超级管理员密码：用 `wrangler secret put SUPER_ADMIN_PASSWORD` 重设，或直接在 KV 中删除 `user:${id}` 让其重建。

---

## 6. 第三方集成（可选）

### 6.1 Cloudflare Turnstile（人机验证）
- 在 https://dash.cloudflare.com/turnstile 创建站点，拿到 Site Key 与 Secret。
- Site Key 填 `wrangler.toml` 的 `TURNSTILE_SITE_KEY`；Secret 用 `wrangler secret put TURNSTILE_SECRET`。
- 开关：`TURNSTILE_ENABLED`、`turnstileOnLogin`、`turnstileOnRegister`、`turnstileOnPost`。

### 6.2 GitHub / Discord OAuth
- 在对应开发者后台创建 OAuth App，回调地址填 `https://api.natrois.top/api/oauth/<provider>/callback`。
- Client ID 填 `wrangler.toml`；Client Secret 用 `wrangler secret put`。
- 开关：`allowGithubLogin` / `allowDiscordLogin`（后台可随时切换）。

### 6.3 Cloud Mail / 发信
见 §8。

---

## 7. 机器人（Discord 桥接）

将频道消息 / 指令同步到平台。完整接口与配置见 **`bot/BOT_API.md`**：

```bash
cd bot
cp .env.example .env      # 填入 DISCORD_TOKEN / MO_BOT_TOKEN / DISCORD_GUILD_ID
npm install
npm start
```

机器人令牌在**管理后台 → 机器人**面板创建（授予 `post.create` / `post.delete.any` 等 scope）。

---

## 8. Cloud Mail（自建邮局）配置

`MAIL_PROVIDER` 可选值：`cloudmail` | `resend` | `mailchannels` | `console`。

### 8.1 cloudmail（默认，走自建 `/api/send`）
```
MAIL_PROVIDER = "cloudmail"
MAIL_API_URL  = "https://mail.natrois.top/api/send"
MAIL_FROM     = "MarytOpens <no-reply@natrois.top>"
MAIL_API_TOKEN = "<邮局 API Token>"   # wrangler secret put
```

### 8.2 resend / mailchannels
- `resend`：`MAIL_API_URL` 留默认或填 Resend 的 send 端点，`MAIL_API_TOKEN` 用 Resend Key。
- `mailchannels`：无需 `MAIL_API_URL`，仅需 `MAIL_API_TOKEN` 与已验证的发信域名。
- `console`：仅打印日志，不真正发信（本地调试用）。

> 验证码邮件（注册 / 找回密码 / 改绑邮箱）依赖发信配置；若发信不可用，可临时用 `console` 模式在 Worker 日志中查看验证码。

---

## 9. 用户绑定自己的 Cloudflare 账号（个人文件存储）

登录用户进入「我的文件」页，可绑定**自己的** Cloudflare 账号。绑定后系统自动在该用户账户下创建：

- 一个 **KV 命名空间**（文件二进制 + 元数据）
- 一个 **D1 数据库**（可查询的文件索引）

文件由此存于用户自有 Cloudflare，分享链接形如 `/f/<ownerUserId>/<fileId>`，可设置**预览码**让他人凭码访问。未绑定用户的数据仅存浏览器本地（`localStorage`），并有丢失风险提示。

### 9.1 准备工作（超管在 Cloudflare 侧创建 OAuth 应用）

1. 打开 `https://dash.cloudflare.com/profile/oauth2-applications` → 新建应用。
2. **回调地址（Redirect URI）**填：`https://api.natrois.top/api/cf/bind/callback`
3. **作用域（Scopes）**勾选 / 填入：`account:read`、`workers_kv_storage:edit`、`d1:edit`。
4. 记下 **Client ID** 与 **Client Secret**。

### 9.2 注入环境变量

```bash
# wrangler.toml 的 [vars] 中（公开）：
CF_OAUTH_CLIENT_ID = "你的_Client_ID"

# 敏感（secret）：
wrangler secret put CF_OAUTH_CLIENT_SECRET   # 上面的 Client Secret
wrangler secret put ENCRYPTION_SECRET        # 用户令牌 AES-GCM 加密密钥，openssl rand -hex 32
```

- `ENCRYPTION_SECRET` 用于加密存储用户 OAuth 令牌；不设置时回退到 `JWT_SECRET`，但**强烈建议独立设置**。
- 单文件上限 `CF_FILE_MAX_BYTES`（默认 25MB）、文件数量上限 `CF_FILE_QUOTA`（默认 200）可在 `[vars]` 覆盖。

### 9.3 用户侧使用

1. 登录 → 「我的文件」→ 点击「绑定」→ 在 Cloudflare 授权页同意。
2. 授权后自动回跳，状态变为「已绑定」，此时可上传任意类型文件。
3. 上传时可填「预览码」与「有效期」；列表中点复制得到分享链接，点钥匙图标设置/取消预览码。
4. 公开分享页 `/f/<owner>/<id>` 受预览码保护时展示输入_gate_；下载走 `/raw`。

> 解绑仅清除本站记录，用户在 Cloudflare 侧的 KV / D1 资源保留（可在 Cloudflare 控制台手动删除）。

---

## 10. 落地页社交图标与下载入口（超管后台配置）

在后台「站点设置 → 外部链接」中填写：

- **Discord URL** / **GitHub URL**：落地页（未登录主页）与全站页脚会显示对应图标，点击跳转到你设定的目标地址。
- **Telegram URL**：落地页与页脚显示 Telegram 图标；保存后系统自动解析该频道 / 群组 / 个人主页的头像与名称，并将图标替换为解析到的头像。
- **下载页 URL（本网站下载）**（默认 `https://natrois.top/downloads/files`）：落地页显示「本网站下载」按钮。该地址应指向独立部署的 Desktop / Android APK 下载站（属于另一个 Workers + Pages 项目，**本仓库不包含客户端源码**，写完客户端后再启用）。
- **GitHub 下载 URL**：落地页显示「前往 GitHub 下载」按钮，指向 Release / 仓库。

> 客户端应用（Desktop / Android APK）是另一个新任务（新 Workers + Pages 项目），本轮仅预留双下载入口，应用源码后续单独编写。

在「站点设置」中还有两块公示内容：

- **贡献者公示**：列出贡献者（名称 / 主页链接 / 角色 / 备注）。当链接指向本网站用户主页、GitHub 或 QQ 时，前台「关于我们」会自动捕获头像与用户名。
- **官方公告**：发布社区公告，出现在全站搜索的「官方公告」分类与社区公告区，可置顶。
- **封禁公示**：账号与 IP 封禁会自动公示在「关于我们」页与 `/bans.html`，仅显示用户名、头像打码、邮箱前 3 后 5 掩码。

**语言自动识别**：用户首次进入网站会弹窗提示当前探测到的语言，可在弹窗内直接选择，也可在「用户和系统设置 → 界面语言」中修改；系统支持 9 种语言。



---

## 9. 环境变量速查

| 变量 | 类型 | 说明 |
| --- | --- | --- |
| `SITE_NAME` | vars | 站点名 |
| `FRONTEND_ORIGIN` | vars | 前端域名（用于回跳 / 拼接文章链接） |
| `API_ORIGIN` | vars | 后端域名 |
| `ALLOWED_ORIGINS` | vars | CORS 允许的源（逗号分隔） |
| `MEDIA_PUBLIC_BASE` | vars | R2 公开访问基址（默认 `https://api.natrois.top/files`） |
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_USERNAME` | vars | 首启管理员 |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_ENABLED` | vars | Turnstile 公开配置 |
| `GITHUB_CLIENT_ID` / `DISCORD_CLIENT_ID` | vars | OAuth 公开 ID |
| `MAIL_PROVIDER` / `MAIL_API_URL` / `MAIL_FROM` | vars | 发信配置 |
| `JWT_TTL_SECONDS` / `LOG_TTL_SECONDS` / `RATE_LIMIT_WINDOW` / `RATE_LIMIT_MAX` | vars | 运行参数 |
| `JWT_SECRET` | secret | JWT 签名密钥（≥32 字节随机） |
| `SUPER_ADMIN_PASSWORD` | secret | 首启管理员密码 |
| `TURNSTILE_SECRET` | secret | Turnstile 服务端密钥 |
| `GITHUB_CLIENT_SECRET` / `DISCORD_CLIENT_SECRET` | secret | OAuth Secret |
| `MAIL_API_TOKEN` | secret | 发信 Token |
| `CF_API_TOKEN` / `CF_ACCOUNT_ID` / `CF_ZONE_ID` | secret | Cloudflare API 面板用 |
| `BOT_MASTER_TOKEN` | secret | 机器人主令牌（可选） |

---

## 10. 冒烟测试

```bash
# 1) 后端元信息
curl -s https://api.natrois.top/api/meta | head

# 2) 前端可达
curl -sI https://natrois.top/ | head -1

# 3) 注册 → 收验证码（console 模式下看 worker 日志）
wrangler tail --format pretty

# 4) 机器人自检（若已部署）
# 在 Discord 私聊机器人 /whoami
```

---

## 11. 升级与回滚

- **后端**：`wrangler deploy` 会保留历史版本，可在控制台 **Workers → Settings → Versions** 回滚。
- **前端**：Pages 每次部署都有预览 URL 与生产版本，可在 **Pages → Deployments** 回滚。
- **配置**：站点配置存于 KV `cfg:site`，改坏可在 KV 中导出备份后还原。

---

## 12. 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `cors` 报错 | `ALLOWED_ORIGINS` 未包含前端域 | 补全并重新部署 |
| 上传头像 404 | R2 未创建 / `MEDIA` 绑定缺失 | 检查 `wrangler.toml` 的 `[[r2_buckets]]` |
| 收不到验证码 | 发信未配置 | 先 `console` 模式看日志 |
| 机器人 403 | 令牌 scope 不足 | 后台补授对应 scope |
| 登录后空白 | `SUPER_ADMIN` 未初始化 / KV 未绑定 | 确认 `DB` 绑定与 secret 已设 |
| 自定义域不生效 | DNS / SSL 未就绪 | 确认 Full (Strict) 与 Always HTTPS |
