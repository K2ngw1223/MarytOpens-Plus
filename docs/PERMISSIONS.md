# MarytOpens · 权限系统手册

MarytOpens 采用 **作用域（Scope）+ 权限位（Perm）+ 身份组（Role）+ 成员（Member）** 的
Discord 式权限模型。本文档是权限的权威说明，供后台管理员、身份组设计者、机器人接入者参考。

---

## 1. 核心概念

| 概念 | 说明 |
| --- | --- |
| **权限位 Perm** | 最小授权单位，如 `post.create`、`user.ban`。完整清单见 §3。 |
| **作用域 Scope** | 权限生效的边界。`global`（全站）或 `channel:<id>` / `group:<id>` 等。站点级权限（`scope:'G'`）只能在 `global` 授予；作用域级权限（`scope:'S'`）可在任意作用域授予。 |
| **身份组 Role** | 一组权限位的命名集合，挂在某个作用域下（`role:${scope}:${roleId}`）。 |
| **成员 Member** | 用户在某作用域下的记录（`member:${scope}:${userId}`），含其拥有的 `roles[]`。 |
| **优先级 Priority** | 身份组之间用于裁决（如禁言/改名时取高优先级方）。 |

### 权限判定（hasPerm）

当用户对某个 scope 的操作发起请求时，后端按以下顺序判定：

1. 用户是 `site.admin`（拥有 `site.admin`）→ 直接通过（超级管理员）。
2. 在目标 scope 的 member 记录里，收集其所有 role 的权限位。
3. 命中精确 perm（如 `post.delete.any`）→ 通过。
4. 命中通配（如 `post.*`）→ 通过。
5. 否则 `403 缺少权限：<label>`。

> 用户的会话在 `Session.can(perm, scope)` 中复刻同一逻辑，前端据此显示/隐藏按钮（`App.Session.can`）。

---

## 2. 预设身份组模板（ROLE_TEMPLATES）

新建作用域（频道/群组）时，系统会自动落地以下身份组：

| 模板 key | 名称 | 颜色 | 优先级 | 定位 |
| --- | --- | --- | --- | --- |
| `super_admin` | 超级管理员 | `#ef4444` | 1000 | 拥有 `site.admin`，一切权限 |
| `admin` | 站点管理员 | `#f97316` | 900 | 全站治理（配置/日志/邮件/封禁/审核/频道） |
| `channel_owner` | 频道主 | `#8b5cf6` | 700 | 频道及其下属群组的全面管理 |
| `channel_admin` | 频道管理员 | `#6366f1` | 650 | 频道内内容治理 |
| `group_owner` | 群主 | `#0ea5e9` | 600 | 群组管理 + 角色管理 |
| `group_admin` | 群管理员 | `#14b8a6` | 550 | 群组内容治理 |
| `board_moderator` | 版主 | `#22c55e` | 500 | 板块管理 + 审核 |
| `board_worker` | 板块工作者 | `#84cc16` | 400 | 轻量协助（置顶/删评/处理举报） |
| `member` | 成员 | `#64748b` | 100 | 普通成员（发帖/评论/私信/互动） |
| `muted` | 被禁言 | `#94a3b8` | 50 | 无权限（仅占位，禁言语义由 `mutedUntil` 控制） |
| `guest` | 访客 | `#cbd5e1` | 0 | 无权限 |

---

## 3. 权限位完整清单（PERMISSIONS）

> `scope` 列：`G` = 仅全局；`S` = 可作用于任意作用域。

### 站点级（G）
| 权限 | 标签 | 说明 |
| --- | --- | --- |
| `site.admin` | 超级管理员（拥有一切权限） | 绕过所有判定 |
| `site.config` | 修改站点配置 | 标题/图标/背景/导航/开关 |
| `site.logs` | 查看访问日志与统计 | 后台「日志」面板 |
| `site.cloudflare` | 调用 Cloudflare API 面板 | 清缓存/看分析/管 DNS |
| `site.mail` | 邮件收发与模板管理 | 单发/广播 |
| `site.bot` | 机器人接入与令牌管理 | 创建/吊销机器人令牌 |
| `ip.ban` | 查看与封禁 IP | 后台「IP 封禁」 |

### 用户治理（S）
| 权限 | 标签 |
| --- | --- |
| `user.ban` | 封禁账号 |
| `user.mute` | 禁言成员 |
| `user.rename` | 强制更改昵称 |
| `user.role` | 分配身份组 |
| `user.viewprivate` | 查看私密文章 |

### 内容治理（S）
| 权限 | 标签 |
| --- | --- |
| `post.create` | 发布文章 |
| `post.edit.any` | 编辑他人文章 |
| `post.delete.any` | 删除他人文章 |
| `post.pin` | 置顶/加精 |
| `post.lock` | 锁定评论 |
| `comment.create` | 发表评论 |
| `comment.delete.any` | 删除他人评论 |
| `report.handle` | 处理举报 |

### 结构治理（S / G）
| 权限 | scope | 标签 |
| --- | --- | --- |
| `channel.create` | G | 创建频道 |
| `channel.manage` | S | 管理频道（改名/图标/权限） |
| `group.create` | S | 在频道内创建群组 |
| `group.manage` | S | 管理群组 |
| `board.manage` | S | 管理板块 |
| `role.manage` | S | 在本作用域创建/编辑身份组 |
| `invite.create` | S | 生成邀请 |

### 交互（G）
| 权限 | 标签 |
| --- | --- |
| `dm.send` | 发送私信 |
| `react.use` | 点赞/收藏/关注 |

---

## 4. 典型权限速查

| 想让用户能…… | 授予 |
| --- | --- |
| 管全站一切 | `site.admin` |
| 配站、看日志、发邮件、封 IP、管机器人 | `admin` 模板 |
| 管某个频道及下属群组 | `channel_owner` / `channel_admin` |
| 管某个群组 | `group_owner` / `group_admin` |
| 只负责某板块审核 | `board_moderator` / `board_worker` |
| 普通发帖互动 | `member` |
| 临时禁言某人 | 对其 `muted` 角色 + `mutedUntil` 时间戳 |

---

## 5. 机器人（服务账号）的权限

机器人使用 **X-Bot-Token** 鉴权（见 `bot/BOT_API.md`）。其能力来自后台创建令牌时授予的 `scopes`，
与上面人类权限位**同一套枚举**。常用组合：

| 机器人用途 | 需授予的 scope |
| --- | --- |
| Discord 镜像发帖 | `post.create` |
| 自动审核（删帖/锁帖） | `post.delete.any` |
| 推送通知 | 任意有效令牌（无需特定 scope） |

机器人令牌本身一旦创建，其 `scopes` 即固定；若需变更，请吊销旧令牌、创建新令牌。

---

## 6. 管理后台中的权限门禁

后台面板（`admin_dashboard.html`）的左侧导航按当前管理员 `Session.can(perm)` 动态裁剪：
无权限的面板会从侧栏与内容区同时移除（`gatePanes`）。各面板所需权限：

| 面板 | 所需权限 |
| --- | --- |
| 概览 / 用户 / 文章 / 频道 / 角色 / 举报 / 站点 / 导航 / IP 封禁 / 日志 / 邮件 / 机器人 / Cloudflare | 对应 `site.*` 或 `site.admin` |
| 全部 | `site.admin` 可解锁所有面板 |

> 非超级管理员但拥有某 `site.*` 权限者，仅能看到其有权限的面板。
