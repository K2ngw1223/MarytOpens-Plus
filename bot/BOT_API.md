# MarytOpens Discord 机器人 · 接口与配置手册

本机器人是一个独立的 Node.js 进程，通过 **MarytOpens 机器人 API**（`/api/bot/*`）与站点后端交互，
并把 Discord 社群里的人工指令 / 频道消息转换为平台操作（发布文章、推送通知、内容审核、同步 Feed）。

- 后端 Worker：`worker/src/index.js`
- 机器人源码：`bot/src/`
- 配置示例：`bot/config.json` + `bot/.env.example`
- 权限映射：`bot/src/permissions.json`

---

## 1. 鉴权模型

所有 `/api/bot/*` 请求必须携带请求头：

```
X-Bot-Token: <你的机器人令牌>
```

令牌由 **站点管理后台 → 机器人** 面板创建（仅在此一次性展示）。后端据此解析出：

| 字段 | 含义 |
| --- | --- |
| `id` | 机器人 ID |
| `name` | 机器人名称 |
| `scopes` | 被授予的作用域级权限（如 `post.create`、`post.delete.any`） |
| `boundScope` | 绑定的作用域（`global` 或某个频道/群组作用域） |
| `ownerId` | 创建者用户 ID |
| `master` | 是否主令牌（配置了 `BOT_MASTER_TOKEN` 时，`X-Bot-Token` 与之相等即为超级令牌，拥有 `ALL_PERMS`） |

> 普通令牌的权限受 `scopes` 限制；只有拥有对应 `scopes` 的令牌才能调用受保护接口，否则返回 `403`。

CORS 已允许 `X-Bot-Token` 头（见 Worker `Access-Control-Allow-Headers`）。

---

## 2. 接口列表

基础地址：`https://api.natrois.top`（本地联调用 `http://127.0.0.1:8787`）

所有请求/响应均为 `application/json`（除特别说明）。错误响应形如：

```json
{ "ok": false, "code": "FORBIDDEN", "message": "机器人缺少 post.create 权限" }
```

### 2.1 `GET /api/bot/whoami`

查询当前令牌对应的机器人身份，用于自检。

**响应**

```json
{
  "bot": {
    "id": "bot_xxx",
    "name": "Discord Bridge",
    "scopes": ["post.create", "post.delete.any", "notify"],
    "boundScope": "global",
    "calls": 42
  }
}
```

### 2.2 `POST /api/bot/posts`  —— 发布文章

**所需权限**：`post.create`（主令牌免校验）

**请求体**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `authorId` | string | 是 | 文章作者用户 ID（必须系统中存在） |
| `title` | string | 是 | 标题，≤200 字符 |
| `content` | string | 是 | 正文（Markdown） |
| `tags` | string[] | 否 | 标签，≤8 个 |
| `board` | string | 否 | 板块，默认 `general` |
| `scope` | string | 否 | 作用域，默认取令牌 `boundScope`，再默认 `global` |

**响应**

```json
{
  "post": {
    "id": "p_xxx",
    "title": "Hello",
    "url": "https://natrois.top/post.html?id=p_xxx"
  }
}
```

### 2.3 `POST /api/bot/notify` —— 推送通知

**所需权限**：任意有效令牌（无需特定 scope）

**请求体**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `userId` | string | 是 | 目标用户 ID |
| `title` | string | 是 | 标题，≤100 字符 |
| `body` | string | 否 | 正文，≤400 字符 |
| `link` | string | 否 | 点击跳转链接 |

**响应**

```json
{ "notified": "user_xxx" }
```

### 2.4 `POST /api/bot/moderate` —— 审核操作

**所需权限**：`post.delete.any`（主令牌免校验）

**请求体**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `postId` | string | 是 | 文章 ID |
| `action` | `'delete'` \| `'lock'` \| `'pin'` | 是 | 操作类型 |
| `reason` | string | 否 | 原因，≤200 字符 |

- `delete`：将文章 `status` 置为 `deleted`（软删除）
- `lock`：锁定评论（`locked=true`）
- `pin`：置顶（`pinned=true`）

**响应**

```json
{ "moderated": "p_xxx", "action": "delete" }
```

### 2.5 `GET /api/bot/feed` —— 拉取公开文章

**所需权限**：任意有效令牌

**查询参数**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `since` | number | 仅返回 `createdAt` 大于该毫秒时间戳的文章（用于增量拉取） |
| `limit` | number | 数量 1-100，默认 20 |

**响应**

```json
{
  "items": [
    {
      "id": "p_xxx",
      "title": "标题",
      "excerpt": "摘要",
      "authorId": "user_xxx",
      "board": "general",
      "createdAt": 1700000000000,
      "url": "https://natrois.top/post.html?id=p_xxx"
    }
  ],
  "serverTime": 1700000000000
}
```

---

## 3. Discord 机器人部署

### 3.1 前置条件

- Node.js ≥ 18（使用全局 `fetch`）
- 一个 Discord 应用 / Bot（https://discord.com/developers/applications）
- 平台后台已创建的机器人令牌（`MO_BOT_TOKEN`），并授予 `post.create` 与 `post.delete.any`

### 3.2 步骤

```bash
cd bot
cp .env.example .env          # 填入 DISCORD_TOKEN / MO_BOT_TOKEN / DISCORD_GUILD_ID
npm install                   # 安装 discord.js + dotenv
npm start                     # 启动
```

`config.json` 中填入非敏感的 Discord 频道 / 服务器 ID；敏感令牌只放 `.env`。

### 3.3 斜杠命令

机器人启动并连上 Discord 后，会自动把命令注册到你配置的 `guildId`（便于即时生效）。命令：

| 命令 | 权限（Discord 角色，见 permissions.json） | 说明 |
| --- | --- | --- |
| `/publish` | `post.create` | 发布文章，支持 `title` / `content` / `tags` / `board` / `author` |
| `/notify` | `notify` | 向指定用户推送站内通知 |
| `/moderate` | `post.delete.any` | 删除 / 锁定 / 置顶文章 |
| `/feed` | 任意成员 | 列出最新公开文章 |
| `/whoami` | 任意成员 | 查看机器人绑定的平台身份 |

### 3.4 频道镜像（可选）

在 `config.json` 设置：

```json
{ "discord": { "mirrorChannel": true, "publishChannelId": "频道ID" } }
```

之后该频道内任何非机器人消息都会被自动同步为一篇 MarytOpens 文章（作者取 `permissions.json` 中 `post.create.defaultAuthorId`），并受每用户频控约束。

---

## 4. 权限映射文件（permissions.json）

该文件**不控制平台侧 scope**（那由后台授予），而是控制「哪些 Discord 角色可以触发哪些 Discord 命令」——一道本地前置闸门，避免无关成员滥用机器人。

```json
{
  "version": 1,
  "description": "Discord 角色 → 操作权限映射",
  "mappings": {
    "post.create":      { "discordRoles": ["Admin", "版主", "Bot Commander"], "defaultAuthorId": "user_xxx" },
    "post.delete.any":  { "discordRoles": ["Admin", "版主"] },
    "notify":           { "discordRoles": ["Admin", "版主", "Bot Commander"] }
  },
  "defaultBoard": "general",
  "rateLimit": { "publishPerUser": 10, "windowMs": 60000 }
}
```

- `mappings.<perm>.discordRoles`：拥有其中任一角色的成员可触发对应命令。
- `mappings.post.create.defaultAuthorId`：未显式传 `author` 参数时，文章默认作者。
- `rateLimit`：每用户发布频控（镜像通道与 `/publish` 共用）。

修改后重启机器人即可生效。

---

## 5. 故障排查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| `无效的机器人令牌` | `MO_BOT_TOKEN` 错误或已删除 | 后台重新创建并更新 `.env` |
| `机器人缺少 post.create 权限` | 令牌未授予该 scope | 后台给机器人补授 `post.create` |
| 命令不显示 | 未配置 `guildId` 或注册失败 | 检查 `guildId` 与 Bot Token，看启动日志 |
| `指定的作者不存在` | `defaultAuthorId` 错误或 `author` 参数无效 | 填入系统中真实存在的用户 ID |
| 镜像无反应 | `mirrorChannel` 未开或频道 ID 不匹配 | 核对 `config.json` |

---

## 6. 与平台权限系统的关系

平台采用**作用域权限模型**（详见仓库根 `PERMISSIONS.md`）。机器人令牌本身是一类「服务账号」，其能力由后台授予的 `scopes` 决定；`permissions.json` 只是在 Discord 侧做了一层社群治理映射。两者正交：**平台 scope 决定「能不能做」，Discord 角色映射决定「谁来下令」**。
