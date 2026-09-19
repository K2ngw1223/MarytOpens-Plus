#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task #67 — i18n coverage merge.
Reads tools/i18n-src.txt (zh, 848 lines, authoritative order) and the first
299 lines of tools/i18n-en.txt (phrases 1-299, already translated), appends
the REST translations (phrases 300-848) defined below, then injects stable
`auto:NNN` keys into DICT['zh-CN'] / DICT['en'] / DICT['zh-TW'].
zh-TW is produced from zh-CN via OpenCC s2twp (falls back to simplified if
opencc is unavailable).
"""
import json
import io
import sys
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tools', 'i18n-src.txt')
EN_EXISTING = os.path.join(ROOT, 'tools', 'i18n-en.txt')
I18N_JS = os.path.join(ROOT, 'pages', 'assets', 'js', 'i18n.js')

# --- English for phrases 300..848 (src order; index 0 == src line 300) -----
REST = [
"Resolution",  # 300 处理结论
"Copy number",  # 301 复制号码
"Copy failed",  # 302 复制失败
"Copy failed, please select the text manually",  # 303 复制失败，请手动选择文本
"Appearance / Theme",  # 304 外观 / 主题
"External link",  # 305 外部链接
"At most 2 changes within N days; old links expire after a change",  # 306 天内最多修改 2 次，修改后旧链接失效
"Failed",  # 307 失败
"Avatar URL",  # 308 头像地址
"Plan",  # 309 套餐
"If you have bot management permission, you can create a Bot Token in the admin panel and use it",  # 310 如果你拥有机器人管理权限，可在管理后台创建 Bot Token 并调用
"Threat blocking",  # 311 威胁拦截
"Character count",  # 312 字数
"Bytes",  # 313 字节
"Save draft",  # 314 存草稿
"Secure transfer",  # 315 安全传输
"Done: success",  # 316 完成：成功
"Client download page URL",  # 317 客户端下载页 URL
"Password & login session management",  # 318 密码与登录会话管理
"The password is SHA-256 pre-hashed in the browser before transmission; the server stores only the PBKDF2 derived value",  # 319 密码在浏览器内先做 SHA-256 预哈希后再传输，服务端只保存 PBKDF2 派生值
"Client-side SHA-256 pre-hash + server-side PBKDF2; plaintext is never stored or transmitted",  # 320 密码客户端 SHA-256 预哈希 + 服务端 PBKDF2，永不明文落库或传输
"Password updated; other devices have been signed out",  # 321 密码已更新，其他设备已下线
"Password has been reset, please sign in again",  # 322 密码已重置，请重新登录
"Passwords are never sent in plaintext",  # 323 密码永不明文传输
"The other user's username or user ID",  # 324 对方的用户名或用户 ID
"Object",  # 325 对象
"Export a copy of your public profile and settings",  # 326 导出你在本站的公开资料与设置副本
"Export my data",  # 327 导出我的数据
"Navigation",  # 328 导航
"Ban IP",  # 329 封禁 IP
"Ban, mute, rename, assign roles and force sign-out",  # 330 封禁、禁言、改名、分配身份组与强制下线
"Ban their IP",  # 331 封禁其 IP
"Ban duration",  # 332 封禁时长
"Ban user",  # 333 封禁用户
"Ban account",  # 334 封禁账号
"Cover",  # 335 封面
"Ban, scan users",  # 336 封，扫描用户
"Ban, skip",  # 337 封，跳过
"Will broadcast to all users with a verified email, email push enabled and not banned, up to 500 per batch",  # 338 将向所有已验证邮箱、未关闭邮件推送、未被封禁的用户群发，单次最多 500 人
"Will be sent to the selected",  # 339 将向选中的
"Will clean up",  # 340 将清理
"Will purge all cache across the entire Zone, which may cause brief origin load",  # 341 将清空整个 Zone 的全部缓存，可能造成短时回源压力
"Subheading",  # 342 小标题
"Not configured yet",  # 343 尚未配置
"Display name",  # 344 展示名
"The name shown to others",  # 345 展示给其他人的名字
"Left sidebar",  # 346 左侧边栏
"As of",  # 347 已于
"Proxied",  # 348 已代理
"Saved locally",  # 349 已保存到本地
"Created",  # 350 已创建
"Board deleted",  # 351 已删除版块
"Published",  # 352 已发布
"Published posts and comments will show as \"Deleted user\"",  # 353 已发布的文章与评论会显示为「已注销用户」
"Sent",  # 354 已发送
"Sent, thank you for your feedback!",  # 355 已发送，感谢反馈！
"Verified on Resend",  # 356 已在 Resend 验证
"Copied to clipboard",  # 357 已复制到剪贴板
"Already applied to",  # 358 已对
"IP banned",  # 359 已封禁 IP
"Force signed out",  # 360 已强制下线
"Local draft restored",  # 361 已恢复本地草稿
"Renamed",  # 362 已改名
"Report status updated",  # 363 已更新举报状态
"Marked email as verified",  # 364 已标记为邮箱已验证
"Account deleted",  # 365 已注销
"Deleted / removed",  # 366 已注销/已删除
"Already rendered, skip duplicate",  # 367 已渲染，避免重复
"Export file generated",  # 368 已生成导出文件
"Muted",  # 369 已禁言
"Asked the user to verify their email",  # 370 已要求该用户验证邮箱
"Unbanned",  # 371 已解封
"Ban lifted",  # 372 已解除封禁
"Unmuted",  # 373 已解除禁言
"Selected",  # 374 已选
"0 selected",  # 375 已选 0 项
"Configured",  # 376 已配置
"Comments locked",  # 377 已锁评
"Rejected",  # 378 已驳回
"Verified",  # 379 已验证
"Development mode",  # 380 开发模式
"On",  # 381 开启
"After enabling, users can see \"Contact Us\" in the navigation menu",  # 382 开启后，用户可在导航菜单中看到「联系我们」
"Open registration",  # 383 开放注册
"Quote",  # 384 引用
"Strongly recommended to prevent bulk registration",  # 385 强烈建议开启，防止批量注册
"Permissions in this scope only take effect within this area",  # 386 当前作用域的权限仅在该区域内生效
"Currently offline",  # 387 当前处于离线状态
"Current time preview",  # 388 当前时间预览
"Currently active",  # 389 当前生效
"Current session",  # 390 当前登录
"The queue is empty under the current filter",  # 391 当前筛选条件下队列是空的
"Current role scope",  # 392 当前身份组作用域
"Current email",  # 393 当前邮箱
"Current page",  # 394 当前页
"Current channel object",  # 395 当前频道对象
"Pending verification",  # 396 待验证
"Must be",  # 397 必须是
"You must verify your email before continuing. Confirm?",  # 398 必须验证邮箱后才能继续使用。确认？
"Quick",  # 399 快捷
"Master switch",  # 400 总开关
"Total count",  # 401 总数
"Restore default",  # 402 恢复默认
"Say something…",  # 403 想说的话…
"Thanks to everyone who contributed to this project",  # 404 感谢以下为项目做出贡献的人
"What I'm working on",  # 405 我在做的东西
"I am",  # 406 我是
"I'm the site owner",  # 407 我是站长
"Everyone",  # 408 所有人
"All bot endpoints use a request header",  # 409 所有机器人接口通过请求头
"All devices signed out immediately and cannot sign in again",  # 410 所有设备立即下线，且无法再次登录
"Visible to all visitors",  # 411 所有访客均可阅读
"Open QQ",  # 412 打开 QQ
"Open link",  # 413 打开链接
"Run cleanup",  # 414 执行清理
"Skill tags",  # 415 技能标签
"Launch QQ to add friend / group",  # 416 拉起 QQ 加好友 / 加群
"Drag to reposition; slider to resize",  # 417 拖动调整位置，滑块调整缩放
"Members of this group will immediately lose the corresponding permissions",  # 418 拥有该组的成员会立即失去对应权限
"Link to the user's profile",  # 419 指向用户主页的链接
"Specify URL",  # 420 指定 URL
"Filter by IP",  # 421 按 IP 过滤
"Organise the community by topic: boards",  # 422 按主题组织社区：版块
"Filter by tag",  # 423 按标签筛选
"Filter by path",  # 424 按路径过滤
"Button text",  # 425 按钮文字
"Try a different filter, or wait for new requests",  # 426 换个过滤条件，或等待新的请求进来
"Authorization scope",  # 427 授权范围
"Sorted again on this page after the server response",  # 428 排序在服务端拉取后于本页二次排序
"Sort weight",  # 429 排序权重
"Explore",  # 430 探索
"Integrated with Cloud Mail for sign-up, password recovery and email change verification",  # 431 接入 Cloud Mail，注册、找回密码、换绑邮箱全流程验证
"Integration notes",  # 432 接入说明
"API",  # 433 接口
"Control what others can see",  # 434 控制他人能看到什么
"Control who can see it",  # 435 控制可见人群
"Control in-app notifications and email pushes",  # 436 控制站内通知与邮件推送
"Description",  # 437 描述
"Mention alerts",  # 438 提及提醒
"Note: you can only grant permissions you already own and that belong to \"scope-level",  # 439 提示：你只能授予自己已拥有、且属于「作用域级
"Insert image",  # 440 插入图片
"Search conversations",  # 441 搜索会话
"Search members",  # 442 搜索成员
"Search tips",  # 443 搜索技巧
"Search post titles, summaries or tags…",  # 444 搜索文章标题、摘要或标签…
"Search this page",  # 445 搜索本页
"Search title / tags",  # 446 搜索标题 / 标签
"Search boards",  # 447 搜索版块
"Search username / email / ID",  # 448 搜索用户名 / 邮箱 / ID
"Summary",  # 449 摘要
"Operator",  # 450 操作人
"Reason for action",  # 451 操作原因
"Performed by",  # 452 操作者
"Recipient",  # 453 收件人
"Recipient, subject and body cannot be empty",  # 454 收件人、主题、正文都不能为空
"Received a new direct message",  # 455 收到新的站内私信
"Saved posts are kept here for you to revisit anytime",  # 456 收藏的文章会保存在这里，随时回看
"Favorites stats",  # 457 收藏统计
"Data",  # 458 数据
"Data export",  # 459 数据导出
"Text color",  # 460 文字色
"Please back up your posts and comments on their own pages",  # 461 文章与评论请在对应页面自行备份
"Post info",  # 462 文章信息
"Italic",  # 463 斜体
"Add DNS record",  # 464 新增 DNS 记录
"Add IP ban",  # 465 新增 IP 封禁
"Add entry",  # 466 新增入口
"Add ban",  # 467 新增封禁
"Add record",  # 468 新增记录
"New display name",  # 469 新的昵称
"New window",  # 470 新窗口
"New email address",  # 471 新邮箱地址
"No content",  # 472 无内容
"Bulleted list",  # 473 无序列表
"Access denied",  # 474 无权访问
"Could not fetch the third-party account profile, please retry",  # 475 无法获取第三方账号资料，请重试
"shown when",  # 476 时展示
"Whether to redirect to",  # 477 是否跳转到
"Display name",  # 478 显示名称
"Show floating button",  # 479 显示浮动按钮
"No theme description yet",  # 480 暂无主题说明
"No conversations yet",  # 481 暂无会话
"No announcements yet; click the top-right to publish",  # 482 暂无公告，点击右上角发布
"No audit records yet",  # 483 暂无审核记录
"No contributors yet; click the top-right to add",  # 484 暂无贡献者，点击右上角添加
"No links yet; click the top-right to add",  # 485 暂无链接，点击右上角添加
"No projects yet; click the top-right to add",  # 486 暂无项目，点击右上角添加
"Cards invert in dark theme to stay readable",  # 487 暗色主题下卡片反色，保持可读
"Lost if you change device or clear cache",  # 488 更换设备/清缓存将丢失
"Update",  # 489 更新
"Update site config",  # 490 更新站点配置
"Up to 12 links",  # 491 最多 12 条链接
"Up to 12 links, shown as icons on your profile",  # 492 最多 12 条，会以图标形式展示在你的个人主页
"Up to 8 tags",  # 493 最多 8 个标签
"Most viewed",  # 494 最多浏览
"Most liked",  # 495 最多点赞
"Most commented",  # 496 最多评论
"Newest",  # 497 最新发布
"Last login",  # 498 最近登录
"Recent request logs, filterable by IP and path",  # 499 最近的请求记录，可按 IP 与路径过滤
"Someone in a post or comment",  # 500 有人在文章或评论中
"Someone commented on your post or replied to you",  # 501 有人评论了你的文章或回复了你
"Someone liked your post or comment",  # 502 有人赞了你的文章或评论
"Numbered list",  # 503 有序列表
"Valid period",  # 504 有效期
"A new user followed you",  # 505 有新用户关注了你
"You have unsaved changes, leave anyway?",  # 506 有未保存的修改，确定离开？
"Provider",  # 507 服务商
"Server / invite URL",  # 508 服务器 / 邀请 URL
"Server time",  # 509 服务器时间
"No permissions granted",  # 510 未授予任何权限
"Authorization token not received, please retry",  # 511 未收到授权令牌，请重试
"Hidden from signed-out visitors",  # 512 未登录访客不可见
"Signed-out visitors see the profile page first",  # 513 未登录访客先看个人页
"Unknown",  # 514 未知
"Unknown user",  # 515 未知用户
"Not bound",  # 516 未绑定
"If unbound, stored only on this device",  # 517 未绑定则仅保存在本机
"When unbound, only files under 3MB are recommended locally",  # 518 未绑定时仅建议小于 3MB 的小文件存于本地
"Unread",  # 519 未读
"Resend rejects sending from unverified domains",  # 520 未验证的域名 Resend 会拒绝发送
"Local fallback is only for files under 3MB; bind Cloudflare for larger files",  # 521 本地兜底仅建议小于 3MB 的文件，大文件请先绑定 Cloudflare
"Local fallback is for small files only",  # 522 本地兜底仅建议小文件
"Local storage is full; some files may not have been saved",  # 523 本地存储空间不足，部分文件可能未被保存
"No reports to handle in this board right now",  # 524 本版块当前没有需要处理的举报
"This site",  # 525 本站
"Bots & developers",  # 526 机器人与开发者
"Bot token",  # 527 机器人令牌
"Bot name",  # 528 机器人名称
"Bot integration",  # 529 机器人接入
"Only the super admin can assign permissions",  # 530 权限仅超级管理员可分配
"Only the super admin can assign permissions",  # 531 权限只有超级管理员可以分配
"Tag categories",  # 532 标签种类
"Mark as processing",  # 533 标记处理中
"Title must be at least 2 characters",  # 534 标题至少 2 个字符
"Detected time zone",  # 535 检测到的时区
"Search all site posts and handle violating content",  # 536 检索全站文章，处理违规内容
"Welcome to",  # 537 欢迎来到
"Completing third-party sign-in…",  # 538 正在完成第三方登录…
"Trying to launch QQ; if there's no response, copy the number to add manually",  # 539 正在尝试拉起 QQ，若未响应请复制号码手动添加
"Body cannot be empty",  # 540 正文不能为空
"One per line; leave blank to clear all",  # 541 每行一个，留空则清空全部
"Permanently delete this board",  # 542 永久删除该版块
"Didn't receive it?",  # 543 没收到？
"No DNS records",  # 544 没有 DNS 记录
"No reports",  # 545 没有举报
"No report records",  # 546 没有举报记录
"No matching members",  # 547 没有匹配的成员
"No matching posts",  # 548 没有匹配的文章
"No matching users",  # 549 没有匹配的用户
"No log records",  # 550 没有日志记录
"No banned IPs",  # 551 没有被封禁的 IP
"Governance",  # 552 治理
"Registration & security",  # 553 注册与安全
"Registered successfully, entering the community…",  # 554 注册成功，正在进入社区…
"Sign-up requires an email code",  # 555 注册需邮箱验证码
"After deletion all data will be anonymised and cannot be recovered",  # 556 注销后所有数据将被匿名化，且无法恢复
"Active authors",  # 557 活跃作者
"Traffic",  # 558 流量
"Add contributor",  # 559 添加贡献者
"Add project",  # 560 添加项目
"Click \"Add entry\" to add your first navigation button",  # 561 点击「新增入口」添加第一个导航按钮
"When \"Contact Us\" is clicked, it tries to launch QQ to add friend / group. You can also fill in a qm.qq.com group link",  # 562 点击「联系我们」时，将尝试拉起 QQ 加好友 / 加群。也可直接填 qm.qq.com 加群链接
"When \"Contact Us\" is clicked, the user is asked whether to open the link",  # 563 点击「联系我们」时，将询问用户是否打开该链接
"Click the button below to load",  # 564 点击下方按钮加载
"Click the button below to try launching the QQ client",  # 565 点击下方按钮尝试拉起 QQ 客户端
"Click the author's name to see all their posts",  # 566 点击作者名可查看其全部文章
"Click or drag to upload a Favicon",  # 567 点击或拖拽上传 Favicon
"Click or drag to upload a Logo",  # 568 点击或拖拽上传 Logo
"Click or drag to upload an avatar",  # 569 点击或拖拽上传头像
"Click or drag to upload a cover",  # 570 点击或拖拽上传封面
"Click or drag to upload a background image",  # 571 点击或拖拽上传背景图
"Click to open the invite / group link",  # 572 点击打开邀请 / 加群链接
"Click to ask whether to redirect",  # 573 点击询问是否跳转
"Like alerts",  # 574 点赞提醒
"Popular tags",  # 575 热门标签
"Moderators can manage all channels in this board",  # 576 版主可管理本版块全部频道
"Boards & channels",  # 577 版块与频道
"Board nickname",  # 578 版块内昵称
"Board name, icon, banner and visibility settings",  # 579 版块名称、图标、横幅与可见性设置
"Board deleted",  # 580 版块已删除
"Board updated",  # 581 版块已更新
"Board details",  # 582 版块详情
"Version",  # 583 版本
"Standalone Bot Token & API for Discord integration, auto-moderation and auto-sync",  # 584 独立 Bot Token 与 API，Discord 社区联动、自动审核、自动同步
"Unique visitors",  # 585 独立访客
"Generating new VAPID keys will invalidate all subscribed devices. Continue?",  # 586 生成新的 VAPID 密钥会导致所有已订阅设备失效，是否继续？
"Used to send sign-up / login / password-reset codes. Takes effect immediately after saving, no code or redeploy needed. Resend recommended",  # 587 用于发送注册 / 登录 / 重置密码验证码。填写并保存后立即生效，无需改代码或重新部署。推荐 Resend
"Used to sync Discord messages into the community",  # 588 用于把 Discord 消息同步到社区
"User ID",  # 589 用户 ID
"User dropdown menu",  # 590 用户下拉菜单
"User profile link",  # 591 用户主页链接
"User-side entry",  # 592 用户侧入口
"Username doesn't match, cancelled",  # 593 用户名不匹配，已取消
"Username must be 2-20 letters, digits, underscores, hyphens or Chinese characters",  # 594 用户名需为 2-20 位字母、数字、下划线、连字符或中文
"Users submit feedback to the mailbox below",  # 595 用户填写反馈，发到下方邮箱
"User actions ·",  # 596 用户操作 ·
"Usage notes",  # 597 用途说明
"Injected by app.js: unified redirect to sign-in",  # 598 由 app.js 注入：统一跳登录
"Injected by app.js: prompt a dialog when blocked by \"email verification required\"",  # 599 由 app.js 注入：被「要求验证邮箱」拦截时唤起弹窗
"Leave blank to use a gradient background",  # 600 留空使用渐变背景
"Leave blank to hide the \"Download from this site\" entry. This points to a separately deployed client download site",  # 601 留空则不显示「本网站下载」入口。该地址指向独立部署的客户端下载站
"Leave blank to hide the announcement bar",  # 602 留空则不显示公告条
"Leave blank to use the Worker env var DISCORD",  # 603 留空则使用 Worker 环境变量 DISCORD
"Leave blank to use the Worker env var GITHUB",  # 604 留空则使用 Worker 环境变量 GITHUB
"Leave blank to remove the preview code",  # 605 留空则取消预览码
"Leave blank to auto-extract the first 200 characters",  # 606 留空则自动截取正文前 200 字
"Login credentials",  # 607 登录凭证
"Sign-in error, please retry",  # 608 登录出错，请重试
"Login name; you can change your display name in settings after signing up",  # 609 登录名，注册后可在设置中修改昵称
"After signing in you can enter the community, publish posts, join channels, or message me directly",  # 610 登录后即可进入社区、发布文章、加入频道，或直接给我发私信
"Sign in to comment ·",  # 611 登录后可参与评论 ·
"Sign-in failed",  # 612 登录失败
"Signed in, entering…",  # 613 登录成功，正在进入…
"Login history",  # 614 登录记录
"Sign-in page background",  # 615 登录页背景图
"'s sending domain",  # 616 的发件域名
"'s roles, effective only within this scope",  # 617 的身份组，仅在该范围内生效
"Table of contents",  # 618 目录
"Target ID",  # 619 目标 ID
"Show the community directly",  # 620 直接展示社区
"Type a keyword to match titles and summaries",  # 621 直接输入关键词匹配标题与摘要
"Confirm change",  # 622 确定更换
"Confirm unbind",  # 623 确定解绑
"Confirm unbind? Storage in your Cloudflare account is kept, but this site's share records are cleared",  # 624 确定解绑？你 Cloudflare 账户中的存储资源将保留，但本站的分享记录会清除
"Sign out of the current session?",  # 625 确定退出当前登录吗？
"Confirm deletion of \"",  # 626 确认删除《
"Confirm deletion of role \"",  # 627 确认删除身份组「
"Confirm new password",  # 628 确认新密码
"Confirm to continue?",  # 629 确认继续？
"Confirm broadcast",  # 630 确认群发
"Confirm unban",  # 631 确认解封
"Social links",  # 632 社交链接
"Community home — posts, channels and discussion",  # 633 社区主页 —— 文章、频道与讨论
"Community announcements",  # 634 社区公告
"Community guidelines",  # 635 社区守则
"Community data",  # 636 社区数据
"Community home",  # 637 社区首页
"Mute, rename and role operations can be scoped to a channel or group",  # 638 禁言、改名、身份组等操作可限定在某个频道或群组内生效
"Mute minutes",  # 639 禁言分钟数
"Muted until",  # 640 禁言至
"Direct message alerts",  # 641 私信提醒
"Private post",  # 642 私密文章
"Private post · end-to-end secure transfer",  # 643 私密文章 · 端到端安全传输
"Private posts are visible only to the author and super admin",  # 644 私密文章仅作者与超级管理员可见
"Private channel",  # 645 私密频道
"Remove",  # 646 移除
"Remind me later",  # 647 稍后再说
"Nothing here yet",  # 648 空空如也
"In-app notification summary",  # 649 站内通知摘要
"The site \"Contact Us\" button is configured here by the super admin. Button location: the \"Theme\" menu at the top-right of the navigation bar",  # 650 站点「联系我们」按钮的内容由超级管理员在此配置。按钮位置：导航栏右上角「主题」菜单内
"Site announcements, moderation results and penalty notices",  # 651 站点公告、审核结果、处罚通知
"Registration is closed",  # 652 站点已关闭注册
"Registration is currently closed; please contact an administrator",  # 653 站点当前已关闭注册，请联系管理员
"Site title",  # 654 站点标题
"Core site metrics and the last 7 days of visits",  # 655 站点核心指标与近 7 日访问趋势
"Site governance",  # 656 站点治理
"The site admin hasn't filled in the \"About us\" page",  # 657 站点管理员尚未填写「关于我们」页面
"The site owner hasn't configured social links",  # 658 站长尚未配置社交链接
"Top announcement",  # 659 站顶公告
"Third-party sign-in failed: authorization denied or token exchange error, please retry or use account & password",  # 660 第三方登录失败：授权被拒绝或令牌换取出错，请重试或用账号密码登录
"Third-party sign-in is not configured correctly",  # 661 第三方登录未正确配置
"Third-party sign-in state validation failed, please retry",  # 662 第三方登录状态校验失败，请重试
"Manage",  # 663 管理
"The admin requires email verification before you can continue. This window cannot be closed; please complete verification as instructed",  # 664 管理员要求你验证邮箱后才能继续使用本站。此窗口无法关闭，请按步骤完成验证
"Manage friends, requests and permissions",  # 665 管理好友、申请与权限
"posts ·",  # 666 篇 ·
"Filter tags precisely",  # 667 精确过滤标签
"Featured",  # 668 精选
"Featured projects",  # 669 精选项目
"System & announcements",  # 670 系统与公告
"System preset",  # 671 系统预设
"Cumulative",  # 672 累计
"Organization / repository URL",  # 673 组织 / 仓库 URL
"Fine-grained permission system",  # 674 细粒度权限体系
"Fine-grained permissions with scope isolation",  # 675 细粒度权限体系与作用域隔离
"After binding Cloudflare, the per-file limit is about 25MB",  # 676 绑定 Cloudflare 后单文件上限约 25MB
"After binding Cloudflare, files live in your own account",  # 677 绑定 Cloudflare 后，文件存于你自己的账户
"Bound scope",  # 678 绑定作用域
"After binding you can sign in with Discord in one click and receive bot integration notifications",  # 679 绑定后可使用 Discord 一键登录，并接收机器人联动通知
"After binding you can sign in with GitHub in one click",  # 680 绑定后可使用 GitHub 一键登录
"After binding you can sign in with third-party accounts in one click",  # 681 绑定后可用第三方账号一键登录
"After binding, the system auto-creates a KV namespace and D1 database under your Cloudflare account; files live in your own account",  # 682 绑定后系统会在你的 Cloudflare 账户下自动创建 KV 命名空间与 D1 数据库，文件存于你自己的账户
"Cache hit",  # 683 缓存命中
"Cache purge",  # 684 缓存清理
"Cache purge command submitted",  # 685 缓存清理指令已提交
"Edit board",  # 686 编辑版块
"Edit board ·",  # 687 编辑版块 ·
"Edit role",  # 688 编辑身份组
"Missing post ID",  # 689 缺少文章 ID
"Missing board parameter",  # 690 缺少版块参数
"Website link",  # 691 网站链接
"Broadcast complete",  # 692 群发完成
"Group feed is coming soon; for now you can interact via the member list",  # 693 群组动态功能即将上线，现在可以先在成员列表中互动
"Contact channel not configured yet",  # 694 联系渠道暂未配置
"Background blur",  # 695 背景模糊度
"Background color",  # 696 背景色
"Auto",  # 697 自动
"Auto language",  # 698 自动多语言
"Auto-detect",  # 699 自动识别
"Custom top bar, sidebar, footer and home-page entries",  # 700 自定义顶栏、侧栏、页脚与首页的自定义入口
"Self-hosted mail",  # 701 自建邮局
"Self-hosted mail API URL",  # 702 自建邮局 API 地址
"If it's not in your inbox, check the spam folder",  # 703 若收件箱没有，请检查垃圾邮件
"If the email is registered, the code is sent immediately",  # 704 若该邮箱已注册，验证码会立即发出
"Scope",  # 705 范围
"Draft saved",  # 706 草稿已保存
"Likes received",  # 707 获赞
"Landing page / footer icons and download entry",  # 708 落地页 / 页脚图标与下载入口
"Landing page \"Download on GitHub\" button target",  # 709 落地页「前往 GitHub 下载」按钮目标
"Inline code",  # 710 行内代码
"Table",  # 711 表格
"Banned IPs cannot access any API",  # 712 被封禁的 IP 将无法访问任何 API
"Crop avatar",  # 713 裁剪头像
"Role / contribution",  # 714 角色/贡献
"Unban IP",  # 715 解封 IP
"Unban user",  # 716 解封用户
"Lift ban",  # 717 解除封禁
"Record",  # 718 记录
"Record created",  # 719 记录已创建
"Comment cannot be empty",  # 720 评论内容不能为空
"Comment alerts",  # 721 评论提醒
"Detects browser language and 12/24-hour format, matches the UI automatically, and can also be switched manually",  # 722 识别浏览器语言与 12/24 小时制，自动匹配界面，也可手动切换
"This plan does not provide Analytics data",  # 723 该套餐不提供 Analytics 数据
"This action cannot be undone",  # 724 该操作不可撤销
"This text is shown in the site-wide footer; edit with care",  # 725 该文本会展示在全站页脚，修改需谨慎
"Comments are locked on this post",  # 726 该文章已锁定评论
"All of this user's sessions will be invalidated immediately",  # 727 该用户将立即失效所有登录态
"This third-party account is already bound to another user",  # 728 该第三方账号已绑定到其他用户
"This account has been banned",  # 729 该账号已被封禁
"Voice",  # 730 语音
"Enter the management panel from the board list",  # 731 请从版块列表进入管理面板
"Please select a user first",  # 732 请先勾选用户
"Please agree to the community rules first",  # 733 请先同意社区规则
"Please also check the spam folder",  # 734 请同时检查垃圾箱
"Please fill in the new email and the code",  # 735 请填写新邮箱与验证码
"Please enter a valid email",  # 736 请填写有效的邮箱
"Please check your network and retry",  # 737 请检查网络后重试
"Total requests",  # 738 请求总数
"Passed via request header when calling",  # 739 请求时通过请求头传递
"Request timed out, please check your network",  # 740 请求超时，请检查网络
"Leave your email and feedback; we'll reply as soon as we can",  # 741 请留下你的邮箱与反馈，我们会尽快回复
"Please wait, validating authorization credentials",  # 742 请稍候，正在校验授权凭证
"Please contact an administrator",  # 743 请联系管理员
"Please select at least one visible role",  # 744 请至少选择一个可见身份组
"Please enter",  # 745 请输入
"Please enter an IP",  # 746 请输入 IP
"Please enter the email to receive the test message",  # 747 请输入接收测试邮件的邮箱
"Please enter a valid email",  # 748 请输入有效邮箱
"Please enter the bot name",  # 749 请输入机器人名称
"Please enter a title…",  # 750 请输入标题…
"Please enter the email code",  # 751 请输入邮箱验证码
"Please choose a file",  # 752 请选择文件
"Please verify your email",  # 753 请验证你的邮箱
"Adjust roles",  # 754 调整身份组
"Call count",  # 755 调用次数
"Contributor credits",  # 756 贡献者公示
"Account info",  # 757 账号信息
"Account deleted",  # 758 账号已注销
"Account status",  # 759 账号状态
"Likes ·",  # 760 赞 ·
"Super admin",  # 761 超管
"Super admin / moderator / co-moderator / channel owner / channel admin, 30+ permission bits, scope isolation",  # 762 超管 / 版主 / 副版主 / 频道主 / 频道管理员，30+ 权限位，作用域隔离
"Super admins can view access logs, ban IPs, rate-limit and mute members",  # 763 超管可查看访问日志、封禁 IP、限流防刷、禁言成员
"Super administrator",  # 764 超级管理员
"who, when, to whom, what",  # 765 超级管理员操作留痕：谁、在何时、对谁、做了什么
"Follow region",  # 766 跟随地区
"Redirect URL",  # 767 跳转网址
"Skip",  # 768 跳过
"Role updated",  # 769 身份组已更新
"Please credit the source and author when reposting",  # 770 转载请注明来源与作者
"Input",  # 771 输入
"Input doesn't match, cancelled",  # 772 输入不匹配，已取消
"Enter your username",  # 773 输入你的用户名
"Enter the board name \"",  # 774 输入版块名称「
"Abuse and harassment",  # 775 辱骂骚扰
"Edge nodes",  # 776 边缘节点
"Edge deployment",  # 777 边缘部署
"Edge deployment · global acceleration",  # 778 边缘部署 · 全球加速
"Runtime",  # 779 运行时
"Traffic in the last 24 hours",  # 780 近 24 小时流量
"Page views in the last 7 days",  # 781 近 7 日页面访问量
"No one is following you yet",  # 782 还没有人关注你
"No boards yet",  # 783 还没有任何版块
"No conversations yet; go say hi to friends in the community",  # 784 还没有会话，去看看社区里的朋友吧
"No about content yet",  # 785 还没有关于内容
"No favorites yet",  # 786 还没有收藏
"No bots yet",  # 787 还没有机器人
"No tags yet",  # 788 还没有标签
"No messages yet; say hello",  # 789 还没有消息，打个招呼吧
"No links added yet",  # 790 还没有添加任何链接
"No custom entries yet",  # 791 还没有自定义入口
"No channels yet. Channels have their own role scope, ideal for splitting a board into self-governing discussion areas",  # 792 还没有频道。频道拥有独立的身份组作用域，适合把版块拆成多个自治讨论区
"This info shows on your profile and everywhere you post",  # 793 这些信息会展示在你的个人主页与所有发言处
"This user has no public posts yet",  # 794 这位用户还没有公开文章
"This will email every verified user site-wide; the action cannot be undone",  # 795 这将向全站所有已验证邮箱的用户群发邮件，操作不可撤销
"This is a system preset role; you can adjust permissions but not delete it",  # 796 这是系统预设身份组，可以调整权限但不可删除
"This post has access restrictions",  # 797 这篇文章设置了访问限制
"Here you'll see alerts for comments, likes, follows and system messages",  # 798 这里会显示评论、点赞、关注、系统消息等提醒
"Violating content can be reported by clicking the report button",  # 799 违规内容可点击举报处理
"Notifications, direct messages, likes and favorites — all included",  # 800 通知、私信、点赞收藏全都有
"Contact the site owner via QQ",  # 801 通过 QQ 与站长联系
"Email submitted for sending",  # 802 邮件已提交发送
"Email push",  # 803 邮件推送
"Mail service",  # 804 邮件服务
"Email code",  # 805 邮件验证码
"Email, avatar, bio and linked accounts are cleared; the username is kept as a placeholder so links don't break",  # 806 邮箱、头像、简介、关联链接会被清空，用户名保留占位以免链接失效
"Email, account identifier and login history",  # 807 邮箱、账号标识与登录记录
"Email changed",  # 808 邮箱已更换
"Email verified, thank you for your cooperation",  # 809 邮箱验证成功，感谢配合
"Reload",  # 810 重新加载
"Resend",  # 811 重新发送
"After reset, other devices are signed out automatically",  # 812 重置后其它设备将自动下线
"Important notices are also sent to your email",  # 813 重要通知同时发送到你的邮箱
"Auth, base URL is",  # 814 鉴权，基址为
"Link",  # 815 链接
"Lock",  # 816 锁定
"Reads ·",  # 817 阅 ·
"Extra message",  # 818 附加消息
"Integration",  # 819 集成
"You must verify your sending domain on Resend first",  # 820 需先在 Resend 验证你的发件域名
"Requires CF configured in the Worker",  # 821 需在 Worker 中配置 CF
"Permission required",  # 822 需要权限
"Requires GITHUB configured",  # 823 需配置 GITHUB
"Non-super-admins can only grant scope-level permissions they already own",  # 824 非超管只能授予自己已拥有的作用域级
"Panel unavailable",  # 825 面板不可用
"Footer",  # 826 页脚
"Footer copyright text",  # 827 页脚版权文本
"Footer copyright text cannot be empty",  # 828 页脚版权文本不能为空
"Top navigation bar",  # 829 顶部导航栏
"Project name",  # 830 项目名
"Project showcase",  # 831 项目展示
"Fall back to site-wide when the preset scope doesn't exist",  # 832 预设作用域不存在时回退全站
"Channel / group / profile URL",  # 833 频道 / 群组 / 个人主页 URL
"Channels live inside boards: board moderators govern the whole board and all channels; channel owners self-manage their channel; permissions cascade down",  # 834 频道建立在版块内：版主统管版块及全部频道，频道主自治本频道，权限逐级继承
"Channels hang under boards and have their own scope and roles",  # 835 频道挂在版块下，拥有独立作用域与身份组
"Channels hang under boards: choosing \"Board / Channel\" publishes to that channel",  # 836 频道挂在版块下：选择「版块 / 频道」即发布到该频道
"Channel count",  # 837 频道数量
"Layered channel-based community governance",  # 838 频道的分层社区治理
"Channels, with board moderators in charge and permissions cascading down",  # 839 频道，版主统管版块，权限逐级继承
"The home page inline script loads config via the global Site object",  # 840 首页内联脚本通过全局 Site 加载配置
"Reject report",  # 841 驳回举报
"Verify",  # 842 验证
"Verification code",  # 843 验证码
"The code is sent to the new email above and is valid for 10 minutes",  # 844 验证码会发送到上方填写的新邮箱，10 分钟内有效
"Code sent, please check your email",  # 845 验证码已发送，请查收邮箱
"Code is wrong or expired",  # 846 验证码错误或已过期
"Verify the channel is reachable",  # 847 验证通道是否通
"Default theme",  # 848 默认主题
]

def main():
    with io.open(SRC, encoding='utf-8') as f:
        zh = [l.rstrip('\n') for l in f]
    zh = [l for l in zh if l.strip() != '']
    assert len(zh) == 848, "src count = %d (expected 848)" % len(zh)

    with io.open(EN_EXISTING, encoding='utf-8') as f:
        exist = [l.rstrip('\n') for l in f]
    exist = [l for l in exist if l.strip() != '']
    # existing covers phrases 1..len(exist); take the first 299 (== src 1..299)
    head = exist[:299]
    assert len(head) == 299, "existing head = %d (expected 299)" % len(head)

    assert len(REST) == 549, "REST count = %d (expected 549)" % len(REST)
    en = head + REST
    assert len(en) == 848, "en total = %d (expected 848)" % len(en)

    # zh-TW via OpenCC (fallback: simplified)
    tw = []
    try:
        from opencc import OpenCC
        cc = OpenCC('s2twp')
        for v in zh:
            tw.append(cc.convert(v))
    except Exception as e:
        sys.stderr.write("opencc unavailable (%s); using simplified for zh-TW\n" % e)
        tw = list(zh)
    assert len(tw) == 848

    # Build three auto objects
    def build_obj(values):
        lines = []
        for i, v in enumerate(values):
            key = "auto:%03d" % (i + 1)
            js = json.dumps(v, ensure_ascii=False)
            lines.append("    '%s': %s" % (key, js))
        return "{\n" + ",\n".join(lines) + "\n  }"

    obj_zh = build_obj(zh)
    obj_en = build_obj(en)
    obj_tw = build_obj(tw)

    block = (
        "  /* ===== Task #67 auto-generated i18n coverage (848 phrases) =====\n"
        "   * Keys auto:001..auto:848 map frozen Chinese source phrases to\n"
        "   * translations. The reverse map in reverseMap() picks these up\n"
        "   * automatically, so applyAuto() translates hardcoded Chinese text.\n"
        "   * Generated by tools/i18n_merge.py — do not edit by hand. */\n"
        "  (function () {\n"
        "    const AUTO_ZH = " + obj_zh + ";\n"
        "    const AUTO_EN = " + obj_en + ";\n"
        "    const AUTO_TW = " + obj_tw + ";\n"
        "    Object.assign(DICT['zh-CN'], AUTO_ZH);\n"
        "    Object.assign(DICT['en'], AUTO_EN);\n"
        "    Object.assign(DICT['zh-TW'], AUTO_TW);\n"
        "  })();\n"
    )

    with io.open(I18N_JS, encoding='utf-8') as f:
        src_js = f.read()

    anchor = "  /* --------------------------- 语言/时间格式协商 -------------------------- */"
    if anchor not in src_js:
        raise SystemExit("anchor not found in i18n.js")
    if "Task #67 auto-generated" in src_js:
        # remove previously injected block to make this idempotent
        import re
        src_js = re.sub(r"  /\* ===== Task #67 auto-generated.*?  \}\)\(\);\n", "", src_js, flags=re.S)
    src_js = src_js.replace(anchor, block + "\n" + anchor, 1)

    # Expose applyAuto on I18N and add a live MutationObserver for dynamic modals
    export_line = "    t, apply, setLocale, setTimeFormat, timeAgo, formatDate, formatNumber,"
    if "applyAuto" not in export_line:
        new_export = "    t, apply, applyAuto, setLocale, setTimeFormat, timeAgo, formatDate, formatNumber,"
        src_js = src_js.replace(export_line, new_export, 1)

    observer = (
        "\n"
        "  /* 动态注入内容（toast / modal）的实时自动翻译 */\n"
        "  let _moTimer = null;\n"
        "  function _scheduleAuto() {\n"
        "    if (state.locale === 'zh-CN') return;\n"
        "    if (_moTimer) return;\n"
        "    _moTimer = setTimeout(function () {\n"
        "      _moTimer = null;\n"
        "      try { applyAuto(document); } catch (e) {}\n"
        "    }, 80);\n"
        "  }\n"
        "  if (typeof MutationObserver !== 'undefined') {\n"
        "    try {\n"
        "      const _mo = new MutationObserver(function (muts) {\n"
        "        for (const m of muts) { if (m.addedNodes && m.addedNodes.length) { _scheduleAuto(); break; } }\n"
        "      });\n"
        "      _mo.observe(document.documentElement, { childList: true, subtree: true });\n"
        "    } catch (e) {}\n"
        "  }\n"
    )
    if "_scheduleAuto" not in src_js:
        src_js = src_js.replace("  global.I18N = {", observer + "\n  global.I18N = {", 1)

    with io.open(I18N_JS, 'w', encoding='utf-8') as f:
        f.write(src_js)

    sys.stderr.write("OK: injected 848 auto keys (zh/en/tw) + live observer into i18n.js\n")

if __name__ == '__main__':
    main()
