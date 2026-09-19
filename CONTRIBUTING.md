# 贡献指南

这个项目结构简单，没有构建步骤也没有框架，改动门槛不高。

## 开发环境

需要 Node.js 20+ 和一个 Cloudflare 账号。只有 `tools/i18n-*.py` 这几个脚本用到 Python 3。

```bash
git clone <repo-url>
cd MarytOpens
node tools/configure.mjs
cd worker && npm install
```

本地起后端用 `cd worker && npx wrangler dev --local`。前端不需要构建，起个静态服务器指向
`pages/` 就行。

## 提交前自检

```bash
node tools/configure.mjs --check   # 有没有遗留的占位域名
node tools/check-inline.js pages   # 前端内联脚本语法
node tools/check-app-helpers.js pages
node --check worker/src/index.js   # 后端语法
```

改动前端页面时，`check-inline.js` 和 `check-app-helpers.js` 都要跑。页面里的内联脚本出错
通常只体现在浏览器控制台，线上看起来就是"点了没反应"，跳过这两步很容易漏掉。

## 代码约定

前端不引入构建链，源文件就是产物，不要加打包器或转译器。字体、图标、样式一律自托管在
`pages/assets/` 下，不要引公共 CDN。

`worker/src/index.js` 刻意保持单文件，方便复制部署和通读审计，请不要拆分成多个模块。

密钥走 `wrangler secret` 或 `.dev.vars`（已 gitignore），不要写进 `wrangler.toml`。

颜色、间距、圆角都在 `pages/assets/css/main.css` 的 CSS 变量里，别硬编码颜色，否则深色模式会坏。

## 提交信息

```
<类型>: <简短描述>

类型：feat / fix / docs / refactor / perf / chore
```

一个提交做一件事，无关改动分开提。

## Pull Request

描述里写清楚改了什么、为什么改、怎么验证的。UI 改动附前后截图，后端接口改动说明兼容性影响。

不要顺手重排文件、改缩进或格式化与改动无关的代码，那会让 review 变难。

## 改权限系统

权限相关改动影响面大，请一并更新 `docs/PERMISSIONS.md`，并在 PR 里说明判定逻辑变了哪里。

## 支持的边界

项目由维护者业余时间维护，不提供技术支持。Issue 不一定有回应，PR 也不一定合并。
动手之前请先确认能接受这一点。

改动比较大的话（新增子系统、动权限模型、改存储结构），建议先开个 Issue 聊一下思路，
免得做完发现方向不对。讨论成本比返工低。

## 不要提交的东西

`_backup/`、任何数据库导出的 `.json`、`.secrets`、`.dev.vars`、`node_modules/`。

`deploy-info.json` 可以提交，它只含域名和版本号。不想让它进版本库的话，在 `.gitignore`
里取消那行注释即可。
