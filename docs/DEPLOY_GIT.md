# 从 GitHub 仓库直接部署

Cloudflare 可以直连 GitHub 仓库，推送即部署，不需要本地跑 wrangler。前后端各配一次。

适合这两种情况：换台机器不想再装环境；想让每次 push 自动上线。

---

## 开始之前

Cloudflare 构建时读的是**仓库里的文件**，所以你本地的 `site.config.json` 改了但没推上去，
线上不会生效。先确认这两件事：

```bash
node tools/configure.mjs --check    # 没有占位残留
git status                          # 工作区干净
git push
```

另外，KV、D1、R2 这些资源得先建好，ID 填进 `worker/wrangler.toml` 并提交。
Workers Builds 部署时会照这个文件去绑定，资源不存在会直接失败。

```bash
cd worker
npx wrangler kv namespace create DB
npx wrangler kv namespace create DB --preview
npx wrangler d1 create marytopens
npx wrangler r2 bucket create marytopens-media    # 可选
```

D1 的表结构要手动建一次，语句在 [KV_SCHEMA.md](KV_SCHEMA.md)。

---

## 后端：Workers Builds

### 1. 连接仓库

Dashboard → **Workers & Pages** → **Create** → **Workers** → **Connect to Git**，
授权 GitHub 并选中你的仓库。

### 2. 填构建配置

| 字段 | 值 |
| --- | --- |
| Production branch | `main` |
| Root directory | `worker` |
| Build command | `npm install` |
| Deploy command | `npx wrangler deploy` |

Root directory 是关键 —— `wrangler.toml` 和 `package.json` 都在 `worker/` 下。
`.node-version` 已放在同一层，构建环境会照它取 Node 20。

### 3. 加环境变量和密钥

**Settings → Variables and Secrets**，把 `worker/.dev.vars.example` 里列的那些补上。

加密项（JWT_SECRET、SUPER_ADMIN_PASSWORD、各类 OAuth Secret、MAIL_API_TOKEN、
ENCRYPTION_SECRET、GITHUB_REGISTRY_TOKEN）选 **Secret** 类型，别选 Text。

非加密项（SITE_NAME、FRONTEND_ORIGIN、API_ORIGIN、ALLOWED_ORIGINS、SUPER_ADMIN_EMAIL 等）
`wrangler.toml` 里已经有一份，不重复配也行。

⚠ `JWT_SECRET` 不配的话，所有接口都会返回 500 并提示 `NO_JWT_SECRET`。

### 4. 首次部署

点 **Deploy**。完成后 Worker 会拿到 `marytopens-api.<你的账号>.workers.dev` 地址，
先用它验证：

```bash
curl https://marytopens-api.<你的账号>.workers.dev/api/health
```

想换成自己的域名，取消 `worker/wrangler.toml` 里 `routes` 那段的注释，
把域名改成自己的，推上去会自动重新部署。

---

## 前端：Pages

### 1. 连接仓库

**Workers & Pages** → **Create** → **Pages** → **Connect to Git**，选同一个仓库。

### 2. 填构建设置

| 字段 | 值 |
| --- | --- |
| Production branch | `main` |
| Framework preset | `None` |
| Build command | 留空 |
| Build output directory | `pages` |

前端没有构建步骤，源文件就是产物，所以构建命令留空、直接发布 `pages/` 目录。
Root directory 不用填。

### 3. 首次部署

部署完会得到 `marytopens.<你的账号>.pages.dev`。

到 Worker 的 `ALLOWED_ORIGINS` 里把这个域名加上，否则浏览器跨域请求会被拦。
改完推一次代码，或者到 Dashboard 手动改。

---

## 让前端连上后端

前端默认从 `site.config.json` 的 `apiOrigin` 取值。改完跑配置器并推送：

```bash
node tools/configure.mjs
git add -A && git commit -m "chore: 指向线上 API" && git push
```

两个平台都会自动重新部署。

嫌每次改域名都要跑脚本的话，也可以在 Pages 的 HTML 里塞一条
`<meta name="mo-api" content="https://api.your-site.com">` 覆盖默认值 —— `api.js` 会优先读它。

---

## 之后的日常

配好之后，`git push` 就是部署：后端走 Workers Builds，前端走 Pages，各自独立。
两个平台的构建日志都在各自项目的 **Deployments** 页里。

要回滚就到 Deployments 里选一个旧版本重新发布，不用改代码。

---

## 容易踩的几个坑

**部署成功但接口 500。** 八成是 `JWT_SECRET` 没配，看 Workers 的实时日志确认。

**前端能打开但登录不了。** `ALLOWED_ORIGINS` 里少了 Pages 的域名。注意
`https://xxx.pages.dev` 和自定义域要分别列，逗号分隔，不要带空格。

**首次请求报 D1 错误。** 表没建。按 [KV_SCHEMA.md](KV_SCHEMA.md) 建一遍。

**改了 `site.config.json` 但线上没变。** 大概率是忘了 `git push`，或者 `configure.mjs`
没跑 —— Cloudflare 只看仓库里的内容。

**想用自定义域但访问不了。** `workers_dev = true` 时 Worker 同时挂在 workers.dev 上，
自定义域需要单独配 `routes` 或到 Settings → Domains & Routes 添加，两者不冲突。

**密钥写进了 `wrangler.toml`。** 这个文件在仓库里，写进去等于公开。一律走
Dashboard 的 Secret 或 `npx wrangler secret put`。

---

## 和本地部署的关系

两种方式可以并存，互不干扰。`docs/DEPLOY.md` 里的本地 wrangler 部署、以及那套
不依赖 wrangler 的 REST 脚本，在装了 TUN 代理的机器上更可靠。

但要注意：两边同时推会互相覆盖。选定一种作为日常方式就行。
