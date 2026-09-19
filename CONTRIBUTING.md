# 贡献指南

感谢愿意花时间。这个项目结构简单（无构建、无框架），改起来门槛不高。

## 开发环境

- Node.js 20+（用于工具脚本与 wrangler）
- 一个 Cloudflare 账号（部署与联调需要）
- 可选：Python 3（只有多语言提取脚本 `tools/i18n-*.py` 用得到）

```bash
git clone <repo-url>
cd MarytOpens
node tools/configure.mjs          # 生成你自己的配置
cd worker && npm install
```

本地起后端：`cd worker && npx wrangler dev --local`，前端直接起个静态服务器指向 `pages/`。

## 提交前请自检

```bash
node tools/configure.mjs --check   # 确认没有遗留占位域名
node tools/check-inline.js pages   # 前端内联脚本语法
node --check worker/src/index.js   # 后端语法
```

改动前端页面时，`check-inline.js` 是必跑项 —— 页面里的内联脚本出错不会在浏览器控制台之外暴露，很容易静默失效。

## 代码约定

- **不引入构建链**。前端保持「源文件即产物」，不要引入打包器、转译器或 npm 运行时依赖。
- **不引入公共 CDN**。字体、图标、样式一律自托管在 `pages/assets/` 下。
- **后端保持单文件**。`worker/src/index.js` 是刻意设计成单文件的，便于复制部署与审计，请不要拆分。
- **密钥不落盘**。任何密钥都走 `wrangler secret` 或 `.dev.vars`（已 gitignore），不要写进 `wrangler.toml`。
- **样式用现有变量**。主题色、间距、圆角都在 `pages/assets/css/main.css` 的 CSS 变量里，不要硬编码颜色，否则深色模式会坏。

## 提交信息

```
<类型>: <简短描述>

类型：feat / fix / docs / refactor / perf / chore
示例：fix: 私信发送前校验渲染函数存在性
```

一个提交做一件事，不要混合无关改动。

## Pull Request

- 描述清楚「改了什么 / 为什么改 / 怎么验证的」
- 涉及 UI 的改动请附前后截图
- 涉及后端接口的改动请说明兼容性影响
- 不要顺手重排文件、改缩进或格式化无关代码，会让 review 变难

## 新增权限位或角色

权限系统的改动影响面大，请一并更新 `docs/PERMISSIONS.md`，并在 PR 里说明判定逻辑的变更点。

## 不要提交的东西

`_backup/`、任何 `.json` 形式的数据库导出、`.secrets`、`.dev.vars`、`node_modules/`。
`deploy-info.json` 是可以提交的（它只有一个域名和版本号），但你想忽略也完全合理 —— 在 `.gitignore` 里取消注释即可。
