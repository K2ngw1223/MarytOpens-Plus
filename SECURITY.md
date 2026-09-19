# 安全政策

## 报告漏洞

**请不要开公开 Issue。** 用私下渠道报告：

- 仓库的 **Security → Report a vulnerability**（GitHub 私密上报，推荐）
- 或邮件联系维护者（见仓库主页的联系方式）

请提供：

- 受影响的版本或提交
- 复现步骤（能最小化最好）
- 影响评估（能做什么：读数据 / 提权 / 拒绝服务 …）

会在确认后尽快回复，并在修复发布后致谢（如果你愿意署名）。

## 部署者需要注意的几件事

这个项目是「自托管模板」，安全性很大一部分取决于部署时的配置。以下几项做错了会出问题：

### 密钥

- `JWT_SECRET`、`ENCRYPTION_SECRET` 必须是各自独立的强随机值（`openssl rand -hex 32`）。
- **不要复用** `JWT_SECRET` 作为 `ENCRYPTION_SECRET` —— 前者用于签名、后者用于加密用户绑定的 OAuth 令牌，复用会扩大泄露面。
- 所有密钥走 `wrangler secret put`，不要写进 `wrangler.toml` 或任何会进版本库的文件。

### 初始管理员

部署后**立即**登录并修改超级管理员密码。默认用户名 `root` 是公开可见的，密码强度是唯一的防线。

### CORS / 来源白名单

`ALLOWED_ORIGINS` 只填你自己的域名。写 `*` 或塞入不相关域名会让 CSRF 防护失效。
配置器会自动填好你自己的域名 + 本地开发地址，通常不需要手改。

### D1 表结构

Worker 不会自动建表。上线前按 `docs/KV_SCHEMA.md` 手动建好，否则首次请求会报错。

### 备份

`worker/scripts/backup-d1.mjs` 可以导出 D1。**导出的 JSON 含全站用户数据，绝不要提交到任何仓库。**

### 部署登记模块

`DEPLOY_REGISTRY_*` 三项默认关闭。开启通道 3 需要一个 GitHub Token，请用
**Fine-grained token** 且只授予目标仓库的 `Issues: Read and write`，通过 secret 注入。
不要用有全仓库权限的经典 token。

## 不在范围内

- 依赖（Cloudflare 平台本身）的漏洞，请报给对应上游
- 需要物理接触或已被攻陷的设备才能触发的场景
- 社交工程
- 部署者自己配置错误导致的问题（例如把 `JWT_SECRET` 公开了）
