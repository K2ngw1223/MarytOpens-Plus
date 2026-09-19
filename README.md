# MarytOpens

[中文](README.md) | [English](README.en.md)

跑在 Cloudflare Workers 上的社区平台。可以当个人博客用，也能开论坛、建频道和群组。

前端是原生 HTML/CSS/JS，没有构建步骤，不依赖任何公共 CDN。后端是一个 Worker 单文件，
数据存在 KV、D1 和 R2 里。

```
https://your-site.com      → Cloudflare Pages（pages/ 静态前端）
https://api.your-site.com  → Worker（worker/src/index.js）
```

## 功能

**账号**

注册和登录支持邮箱验证码、Cloudflare Turnstile 人机验证，以及 GitHub / Discord 第三方登录。
密码在浏览器里先做一次 SHA-256，服务端再走 PBKDF2 派生后入库，明文不出浏览器。

**权限**

Discord 那套东西：作用域、权限位、身份组、成员四层组合。超级管理员、频道主、群主、版主、
普通成员各有各的边界。这一块逻辑比较多，单独写在 [docs/PERMISSIONS.md](docs/PERMISSIONS.md)。

**内容**

Markdown 写作，文章可以设为公开、会员可见、私密、指定身份组或草稿。评论、点赞、收藏、
关注、私信、通知、举报都有。私信用 PawCrypt 做端到端加密，密钥只在用户手里，服务端存的是密文，
可以设阅后即焚。

**治理**

封 IP、禁言、强制改名、改站点配置、发信。站内自带访问日志和统计。

**用户文件**

登录后可以绑定自己的 Cloudflare 账号，系统在对方账户下建 KV 和 D1 存文件。文件分享有链接、
预览码和公开下载三种方式。没绑定的用户，文件存在浏览器本地，会提示有丢失风险。

**界面**

9 种语言，进站自动识别浏览器语言并弹窗确认。深浅主题跟随系统，也能手动切。
静态资源全部自托管。

## 项目结构

```
MarytOpens/
├── site.config.json          集中配置，改这里
├── deploy-info.json          部署留档，配置器生成
├── worker/
│   ├── src/index.js          后端，单文件
│   ├── wrangler.toml         绑定与部署配置
│   ├── .dev.vars.example     本地密钥样例
│   ├── scripts/              部署和备份脚本
│   └── package.json
├── pages/                    前端，44 个 HTML 页面
│   └── assets/{css,img,js}
├── tools/
│   ├── configure.mjs         配置应用器，部署前跑一次
│   ├── check-inline.js       内联脚本语法检查
│   ├── check-app-helpers.js  页面调用的 App 成员检查
│   └── i18n-*.py             多语言提取与合并
└── docs/
    ├── DEPLOY.md             部署与排错
    ├── DEPLOY_REGISTRY.md    部署登记模块
    ├── PERMISSIONS.md        权限系统
    └── KV_SCHEMA.md          存储结构
```

## 部署

### 1. 填配置

域名没有硬编码在代码里，都在 `site.config.json`：

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

它把这些值同步到前端页面、`worker/wrangler.toml` 和文档里，同时生成 `deploy-info.json`。
可以反复执行。`node tools/configure.mjs --check` 用来检查有没有漏改的占位值，
适合放进 CI。

### 2. 建 Cloudflare 资源

```bash
cd worker
npx wrangler kv namespace create DB
npx wrangler kv namespace create DB --preview
npx wrangler d1 create marytopens
npx wrangler r2 bucket create marytopens-media    # 可选
```

把返回的 ID 填回 `worker/wrangler.toml`。D1 的表结构要手动建，Worker 不会自动建表，
语句在 [docs/KV_SCHEMA.md](docs/KV_SCHEMA.md)。

### 3. 注入密钥

```bash
cp .dev.vars.example .dev.vars          # 本地开发用
npx wrangler secret put JWT_SECRET
npx wrangler secret put SUPER_ADMIN_PASSWORD
```

其余的（Turnstile、OAuth、发信、加密密钥）按需加，完整清单在 `worker/.dev.vars.example`。

### 4. 部署

```bash
cd worker
npx wrangler deploy                                            # 后端
npx wrangler pages deploy ../pages --project-name marytopens   # 前端
```

本机装了 TUN 模式代理时，Node 可能连不上 `api.cloudflare.com`（DNS 返回 fake-ip，
TLS 握手被重置），wrangler 会失败而 curl 正常。这种机器上用纯 REST 脚本部署：

```bash
CLOUDFLARE_API_TOKEN=xxx CF_ACCOUNT_ID=xxx npm run deploy:api:all
```

其他情况和排错见 [docs/DEPLOY.md](docs/DEPLOY.md)。

## 存储

| 绑定 | 用途 |
| --- | --- |
| `DB1`（D1） | 主存储。运行时通过一层 KV 兼容层，把 `env.DB` 的读写路由到 D1 |
| `DB`（KV） | `file:` 前缀的二进制回退。没绑 R2 时文件也走这里 |
| `MEDIA`（R2，可选） | 头像、横幅、配图。键格式 `${kind}/${uid}/${fileId}.${ext}` |

键的命名规范见 [docs/KV_SCHEMA.md](docs/KV_SCHEMA.md)。

## 开发

```bash
node tools/check-inline.js pages        # 页面内联脚本语法
node tools/check-app-helpers.js pages   # 页面是否裸调用了没解构的 App 成员
node tools/configure.mjs --check        # 配置完整性
node --check worker/src/index.js        # 后端语法

cd worker && npx wrangler dev --local   # 本地起后端
```

改前端之后建议把前两个都跑一遍。页面里的内联脚本出错通常只在浏览器控制台可见，
线上表现是"点了没反应"，很容易漏掉。

## 支持范围

这是个人开源项目，按原样提供，不承诺技术支持。

具体一点：不提供部署协助和代部署，不接运维，不保证 Issue 的响应时间，也不接定制开发。
部署过程中卡住了，先翻 [docs/DEPLOY.md](docs/DEPLOY.md) 和已有的 Issue，大概率有人踩过。

Bug 报告和功能建议欢迎提 Issue，但采纳与否、什么时候做，取决于维护者有没有时间。

## 参与

见 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题不要开公开 Issue，走 [SECURITY.md](SECURITY.md) 里的渠道。

## 许可

[MIT](LICENSE)。使用前请确认符合当地法律法规和 Cloudflare 的服务条款。
