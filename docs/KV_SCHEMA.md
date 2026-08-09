# MarytOpens · 存储结构手册（KV / R2）

MarytOpens 后端运行在 Cloudflare Workers 上，持久化依赖两类存储：

| 绑定名 | 类型 | 用途 |
| --- | --- | --- |
| `DB` | **KV**（`wrangler.toml` 中 `binding = "DB"`） | 所有结构化数据、索引、计数器、日志 |
| `MEDIA` | **R2**（`wrangler.toml` 中 `binding = "MEDIA"`，桶名 `marytopens-media`） | 用户头像 / 横幅 / 文章配图等二进制文件 |

> KV 最终一致（边缘同步通常 < 60s）。本系统所有写后读均发生在同一请求内、或使用索引键，已规避一致性窗口问题。

---

## 1. KV 键命名规范

统一约定：**`前缀:参数1:参数2`**，小写，层级用 `:` 分隔。下列 `DB.` 即 `env.DB`。

### 1.1 配置与站点

| 键 | 类型 | 值 | TTL |
| --- | --- | --- | --- |
| `cfg:site` | JSON | 站点配置（见 `DEFAULT_SITE_CONFIG`：`siteTitle` / `personal` / `about` / `footerText` / `navLinks` / `announcement` / `seo` / 各类开关） | 无 |

### 1.2 用户与身份

| 键 | 类型 | 值 | TTL |
| --- | --- | --- | --- |
| `user:${id}` | JSON | 用户对象（`username` / `email` / `displayName` / `avatar` / `passwordHash` / `roles` / `oauth` / `banned` / `mutedUntil` …） | 无 |
| `ix:email:${sha256(email)}` | 字符串 | `userId`（邮箱 → 用户索引） | 无 |
| `ix:uname:${username.toLowerCase()}` | 字符串 | `userId`（用户名 → 用户索引） | 无 |
| `ix:oauth:${provider}:${pid}` | 字符串 | `userId`（`github`/`discord` 联合登录索引） | 无 |

> 用户主键 `id` 形如 `user_xxx`（由 `uid('u')` 生成）。

### 1.3 角色 / 成员（作用域权限）

采用 Discord 式「作用域 + 角色 + 成员」模型。作用域键由 `scopeKeyOf(scope)` 归一（如 `global`、频道/群组 id）。

| 键 | 类型 | 值 | TTL |
| --- | --- | --- | --- |
| `role:${scope}:${roleId}` | JSON | 角色定义（`name` / `color` / `permissions[]` / `scope` / `position`） | 无 |
| `member:${scope}:${userId}` | JSON | 成员记录（`roles[]` / `joinedAt`），KV metadata `{ u: userId }` 便于列表查询 | 无 |

### 1.4 文章与索引

| 键 | 类型 | 值 | TTL |
| --- | --- | --- | --- |
| `post:${id}` | JSON | 文章对象（`title` / `content` / `tags[]` / `board` / `scope` / `visibility` / `authorId` / `counts` / `status` / `createdAt` …） | 无 |
| `ixp:all:${sid}` | 字符串 | `postId`（全站时间线，按 `sid`=可排序 id 排序） | 无 |
| `ixp:user:${uid}:${sid}` | 字符串 | `postId`（某作者文章） | 无 |
| `ixp:board:${board}:${sid}` | 字符串 | `postId`（某板块文章） | 无 |
| `ixp:scope:${scope}:${sid}` | 字符串 | `postId`（某作用域文章） | 无 |

> `sid` 由 `sortableId()` 生成（时间可排序），列表查询用 `DB.list({ prefix })` 再按 `sid` 倒序。

### 1.5 关系（点赞 / 收藏 / 关注 / 会话）

均为索引键，存在即表示「成立」：

| 键 | 含义 |
| --- | --- |
| `like:${postId}:${userId}` | 用户点赞了某文章 |
| `fav:${userId}:${postId}` | 用户收藏了某文章 |
| `fol:${userId}:${targetId}` | 用户关注了某用户 |
| `ix:${user.id}:${threadId}` | 私信会话索引 |

### 1.6 通知计数

| 键 | 含义 |
| --- | --- |
| `notifcnt:${userId}` | 该用户未读通知数（字符串计数） |

### 1.7 验证码 / 令牌

| 键 | 类型 | 值 | TTL |
| --- | --- | --- | --- |
| `vcode:${purpose}:${email}` | JSON | `{ code, expiresAt, tries }`（`purpose` ∈ `register`/`reset`/`changeEmail`） | 600s |
| `bot:${id}` | JSON | 机器人记录（`name` / `tokenHash` / `scopes[]` / `boundScope` / `ownerId` / `enabled` / `calls`） | 无 |
| `botix:${sha256(token)}` | 字符串 | `botId`（令牌 → 机器人索引，供 `authenticateBot` 查询） | 无 |
| `rl:${key}` | 字符串 | 限流计数（`up:${uid}` / `auth:${ip}` 等） | 窗口秒数（默认 60） |

### 1.8 统计与系统

| 键 | 类型 | 值 | TTL |
| --- | --- | --- | --- |
| `stat:pv:${YYYY-MM-DD}` | 字符串 | 当日 PV 计数 | 400 天 |
| `stat:total:${bucket}` | 字符串 | 累计计数（`users` / `posts` / `comments` 等） | 无 |
| `log:${sortableId}` | JSON | 访问日志（`t`/`ip`/`ua`/`method`/`path`/`status`/`ms`/`uid`） | `LOG_TTL_SECONDS`（默认 30 天） |
| `sys:*` | 混合 | 系统标志（如超级管理员是否已初始化） | 无 |

### 1.8 用户 Cloudflare 绑定（个人文件存储）

登录用户可在「我的文件」页绑定**自己的** Cloudflare 账号（OAuth2 + PKCE）。绑定成功后，后端会自动在该用户账户下创建：

- 一个 **KV 命名空间**（存放文件二进制 `file:${id}` 与元数据 `m:${id}`）
- 一个 **D1 数据库**（建表 `files`，作为可查询索引；元数据同时以 `m:${id}` 存于 KV，读取走 KV）

本站仅保存绑定元信息与**经 AES-GCM 加密的**用户 OAuth 令牌（密钥取自 `ENCRYPTION_SECRET`，回退 `JWT_SECRET`），调用用户资源时再解密，令牌**不下发前端**。

| 键 | 类型 | 值 | TTL |
| --- | --- | --- | --- |
| `cf:bind:${userId}` | JSON | `{ accountId, accountName, kvId, d1Id, d1Name, kvTitle, tokenEnc, boundAt, owner }`（`tokenEnc` 为加密后的令牌） | 无 |

公开分享路由：

- `GET /f/${ownerUserId}/${fileId}` → 分享落地页（设了预览码则展示输入_gate_）
- `GET /f/${ownerUserId}/${fileId}/raw` → 以用户的 KV 中 `file:${fileId}` 直接流式返回（预览码不符返回 403）

> 未绑定用户：文件仅以 base64 存于浏览器 `localStorage`（`mo_local_files`），无法生成分享链接，并有丢失风险提示。

### 1.9 全局搜索索引与封禁公示

- **文件搜索索引**（`pubfile:${ownerUserId}:${fileId}`）：用户在「我的文件」点击分享后写入本站 KV，供 `/api/search?type=file` 聚合检索；删除文件时同步清除。仅在用户自有 Cloudflare 中存储，本站不持有文件内容。
- **封禁公示**：账号封禁读取 `user:*` 中 `flags.banned=true` 的记录；IP 封禁读取 `ban:ip:*`（`ip.ban` 权限管理）。公开接口 `/api/bans` 仅返回掩码数据（用户名、打码头像、邮箱前 3 后 5 掩码、掩码 IP）。
- **贡献者 / 官方公告**：分别存于站点配置 `contributors[]` 与 `announcements[]`，超管在后台「站点设置」编辑；贡献者主页链接若指向本网站 / GitHub / QQ，前台自动捕获头像与用户名。

---

## 2. R2 对象存储（MEDIA）

用于所有二进制文件。键格式固定：

```
${kind}/${uid}/${fileId}.${ext}
```

| kind | 含义 | 单文件上限 | 允许类型 |
| --- | --- | --- | --- |
| `avatar` | 用户头像 | 2 MB | png / jpeg / webp / gif / svg |
| `banner` | 用户横幅 | 8 MB | 同上 |
| `image` | 文章 / 通用配图 | 8 MB | 同上 |

- `fileId`：`uid()` 随机串；`ext` 由 MIME 映射（`ALLOWED_IMAGE`）。
- 上传路由：`POST /api/upload/:kind`（需登录），支持 `multipart/form-data` 或裸 body。
- 公开访问基址：`${MEDIA_PUBLIC_BASE}`（默认 `https://api.natrois.top/files`），由后端拼接为完整 URL 存入用户/文章字段。
- 缓存策略：`public, max-age=31536000, immutable`。

> 所有前端静态资源（HTML / CSS / JS / 图片 / 字体）均自托管在 Cloudflare Pages，**不经过** 任何公共 CDN；R2 仅用于用户生成内容。

---

## 3. 备份与运维建议

- **KV 无原生备份**：建议定期导出关键键（`cfg:site`、`user:*`、`post:*`、`role:*`、`member:*`）。可用 `wrangler kv key list --binding DB` 列出，再逐键 `wrangler kv key get`。
- **R2 备份**：`wrangler r2 object get` / `put` 配合 `rclone` 或定时脚本同步到另一桶。
- **删除即永久**：KV `delete`、R2 `delete` 不可恢复，操作前先导出。
- **日志清理**：由 cron（`0 4 * * *`）自动执行，过期验证码 / 限流键 / 日志按 TTL 回收，无需人工干预。
