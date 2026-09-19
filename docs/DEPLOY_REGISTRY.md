# 部署登记（Deploy Registry）

一个可选的、默认关闭的小模块。作用是让「谁部署了这个项目、部署在哪个域名」这件事有个安静的留痕方式，方便部署者自己归档，也方便上游知道项目被用在哪些地方。

**不含任何用户数据采集，不上报访问量、不采集 IP、不读取业务库。**
上报内容只有一个实例自述：站点名、站点域名、API 域名、版本号、部署时间。

---

## 三个通道

三个通道互相独立，可以在 `site.config.json` / `worker/wrangler.toml` 里分别开关。

### 通道 1 · 部署端离线留档（默认可用，不出网）

执行配置器时会生成一份 `deploy-info.json`：

```bash
node tools/configure.mjs
```

产出示例：

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

纯本地生成，不发任何网络请求。想让仓库里留下部署记录，`git add deploy-info.json && git commit` 即可。
（如果你不希望这份文件进版本库，把它加进 `.gitignore`。）

### 通道 2 · 公开接口 `GET /api/deploy-info`

在 `wrangler.toml` 的 `[vars]` 中开启：

```toml
DEPLOY_REGISTRY_ENABLED = "true"    # 总开关，不开则接口一律返回 404
DEPLOY_REGISTRY_PUBLIC  = "false"   # false = 只回探活级信息；true = 回完整自述
```

| `PUBLIC` | 返回内容 |
| --- | --- |
| `false` | `siteName` / `version` / `registryEnabled` / `registeredAt` |
| `true` | 追加 `siteOrigin` / `apiOrigin` / `instanceId` / `registered` / `issue` |

不暴露任何用户数据、统计数字或配置内容。总开关关闭时，该路径与不存在的路由表现完全一致（404 + `NO_ROUTE`）。

### 通道 3 · 静默登记（默认关闭）

向一个你指定的 GitHub 仓库提交一条登记 Issue，每个实例最多一条，之后每天只更新最后一次可见时间（不会刷屏）。

```toml
DEPLOY_REGISTRY_ENABLED = "true"
DEPLOY_REGISTRY_ISSUE   = "true"
DEPLOY_REGISTRY_REPO    = "yourname/marytopens"   # 登记仓库
# GITHUB_REGISTRY_TOKEN 不要写在这里！用 secret 注入：
#   npx wrangler secret put GITHUB_REGISTRY_TOKEN
```

Token 需要目标仓库的 **Issues: Read and write** 权限（Fine-grained token 即可，权限给到最小）。

触发时机：

- 部署后第一次请求（`fetch` 中的后台任务，不阻塞响应）
- 之后每天 04:00 UTC 的定时任务里检查一次

同一实例用 `instanceId`（由域名与站点名派生）去重，KV 键 `sys:deploy-registry` 记录状态。
整个流程失败一律静默忽略，不会影响站点任何功能，日志里只有一行 `[registry]` 提示。

---

## 隐私与关闭方式

- 三个开关全部默认为 `false` / 空。**全新部署默认不做任何上报。**
- 通道 3 是唯一会出网的通道，需要你自己准备 Token 才会生效。
- 想彻底移除这套机制：删掉 `worker/src/index.js` 里的「20.5 部署登记」小节、`fetch` 中的触发片段、`scheduled` 中的 `registryRegister` 调用，以及 `wrangler.toml` 里的 `DEPLOY_REGISTRY_*` 变量。

---

## 清理已登记的实例

如果某个实例已经登记但你想撤掉：

1. 把该站 `DEPLOY_REGISTRY_ISSUE` 设为 `false`（停止后续心跳）
2. 删除该站的 KV 键：`sys:deploy-registry`
3. 到登记仓库手动关闭对应的那条 Issue
