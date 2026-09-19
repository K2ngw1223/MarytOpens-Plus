# 部署登记

一个可选模块，默认关闭。作用是记录"谁把这个项目部署到了哪里"，方便部署者自己归档。

不上报访问量，不采集 IP，不读业务库。上报的内容只有一个实例自述：站点名、站点域名、
API 域名、版本号、部署时间。

三个通道相互独立，分别开关。

## 通道 1：部署端留档

跑配置器时会生成 `deploy-info.json`：

```bash
node tools/configure.mjs
```

```json
{
  "siteName": "MarytOpens",
  "siteOrigin": "https://your-site.com",
  "apiOrigin": "https://api.your-site.com",
  "supportEmail": "admin@your-site.com",
  "instanceId": "8148ed7cebccbb29",
  "generator": "marytopens-oss",
  "configuredAt": "2026-09-19T04:59:34.151Z"
}
```

纯本地生成，不发网络请求。想让仓库里留下记录，把它提交上去就行。不想让它进版本库，
加进 `.gitignore`。

## 通道 2：公开接口

在 `wrangler.toml` 的 `[vars]` 里开：

```toml
DEPLOY_REGISTRY_ENABLED = "true"    # 总开关，不开的话接口返回 404
DEPLOY_REGISTRY_PUBLIC  = "false"   # false 只回探活信息，true 回完整自述
```

`PUBLIC` 为 `false` 时返回站点名、版本号、开关状态和登记时间。设为 `true` 才会带上
前端域名、API 域名和实例标识。不管哪种模式，都不包含用户数据、统计数据或任何配置内容。

总开关关闭时，这个路径的表现和不存在路由完全一致。

## 通道 3：静默登记

向指定仓库提一条登记 Issue。每个实例最多一条，之后每天只更新最后可见时间。

```toml
DEPLOY_REGISTRY_ENABLED = "true"
DEPLOY_REGISTRY_ISSUE   = "true"
DEPLOY_REGISTRY_REPO    = "yourname/marytopens"
# GITHUB_REGISTRY_TOKEN 用 secret 注入，不要写进这个文件：
#   npx wrangler secret put GITHUB_REGISTRY_TOKEN
```

Token 需要目标仓库的 Issues 读写权限。建议用 Fine-grained token，权限只给到这一项。

触发时机有两个：部署后的第一次请求，以及之后每天 UTC 04:00 的定时任务。
判定重复用的是 `instanceId`（由域名和站点名派生），状态存在 KV 的
`sys:deploy-registry` 键里。

整个过程失败会被忽略，不影响站点功能，日志里只有一行 `[registry]` 提示。

## 关闭与移除

三个开关默认都是关的，新部署不做任何上报。通道 3 是唯一会出网的通道，需要自己准备
Token 才会生效。

想彻底删掉这套东西：移除 `worker/src/index.js` 里的「部署登记」小节、`fetch` 里的触发
片段、`scheduled` 里的 `registryRegister` 调用，以及 `wrangler.toml` 里的
`DEPLOY_REGISTRY_*` 变量。

## 清理已登记的实例

把该站点的 `DEPLOY_REGISTRY_ISSUE` 设为 `false` 停掉心跳，删掉 KV 键
`sys:deploy-registry`，最后到登记仓库手动关掉对应的 Issue。
