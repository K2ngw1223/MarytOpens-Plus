/* ==========================================================================
 * MarytOpens · i18n.js
 * 自动语言协商（浏览器语言 + 时间格式探测）+ 手动切换 + 相对时间本地化
 * 全局对象：window.I18N
 * ========================================================================== */
(function (global) {
  'use strict';

  const SUPPORTED = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'ru', 'de', 'fr', 'es'];

  const LOCALE_META = {
    'zh-CN': { name: '简体中文', flag: '🇨🇳', dir: 'ltr' },
    'zh-TW': { name: '繁體中文', flag: '🇭🇰', dir: 'ltr' },
    'en':    { name: 'English',  flag: '🇺🇸', dir: 'ltr' },
    'ja':    { name: '日本語',    flag: '🇯🇵', dir: 'ltr' },
    'ko':    { name: '한국어',    flag: '🇰🇷', dir: 'ltr' },
    'ru':    { name: 'Русский',  flag: '🇷🇺', dir: 'ltr' },
    'de':    { name: 'Deutsch',  flag: '🇩🇪', dir: 'ltr' },
    'fr':    { name: 'Français', flag: '🇫🇷', dir: 'ltr' },
    'es':    { name: 'Español',  flag: '🇪🇸', dir: 'ltr' },
  };

  /* ------------------------------ 词条字典 ------------------------------- */
  const DICT = {};

  DICT['zh-CN'] = {
    'app.name': 'MarytOpens',
    'nav.home': '首页', 'nav.community': '社区', 'nav.channels': '频道', 'nav.explore': '发现',
    'nav.messages': '私信', 'nav.notifications': '通知', 'nav.about': '关于我们', 'nav.search': '搜索文章、用户、频道…',
    'nav.write': '写文章', 'nav.admin': '管理后台', 'nav.settings': '设置', 'nav.profile': '我的主页',
    'nav.login': '登录', 'nav.register': '注册', 'nav.logout': '退出登录', 'nav.menu': '菜单',
    'nav.favorites': '我的收藏', 'nav.myposts': '我的文章', 'nav.drafts': '草稿箱',

    'auth.login.title': '欢迎回来', 'auth.login.sub': '登录后进入社区主界面',
    'auth.register.title': '创建账号', 'auth.register.sub': '加入 MarytOpens 社区',
    'auth.identifier': '用户名或邮箱', 'auth.username': '用户名', 'auth.email': '邮箱地址',
    'auth.password': '密码', 'auth.password2': '确认密码', 'auth.code': '邮箱验证码',
    'auth.sendCode': '发送验证码', 'auth.resend': '{s} 秒后重发',
    'auth.remember': '记住我', 'auth.forgot': '忘记密码？', 'auth.submit.login': '登录',
    'auth.submit.register': '注册账号', 'auth.or': '或使用以下方式',
    'auth.github': '使用 GitHub 登录', 'auth.discord': '使用 Discord 登录',
    'auth.noAccount': '还没有账号？', 'auth.hasAccount': '已有账号？',
    'auth.agree': '注册即表示同意社区规则与隐私政策',
    'auth.reset.title': '重置密码', 'auth.reset.sub': '通过邮箱验证码设置新密码',
    'auth.newPassword': '新密码', 'auth.oldPassword': '当前密码',
    'auth.verifyHuman': '请完成人机验证', 'auth.backLogin': '返回登录',
    'auth.pwdWeak': '密码强度：弱', 'auth.pwdMid': '密码强度：中', 'auth.pwdStrong': '密码强度：强',
    'auth.pwdRule': '至少 8 位，建议包含大小写字母与数字',
    'auth.mismatch': '两次输入的密码不一致',

    'post.publish': '发布', 'post.save': '保存', 'post.saveDraft': '存为草稿', 'post.edit': '编辑',
    'post.delete': '删除', 'post.title': '标题', 'post.content': '正文内容',
    'post.titlePh': '给你的文章起个标题…', 'post.contentPh': '支持 Markdown 语法，尽情书写…',
    'post.tags': '标签', 'post.tagsPh': '回车添加标签', 'post.cover': '封面图',
    'post.visibility': '可见性', 'post.scope': '发布到',
    'post.vis.public': '公开', 'post.vis.unlisted': '不公开列出', 'post.vis.private': '私密（仅自己与超管）',
    'post.vis.role': '指定身份组可见', 'post.vis.draft': '草稿',
    'post.visHint.private': '任何人不可见，仅你本人与超级管理员可查看',
    'post.like': '点赞', 'post.favorite': '收藏', 'post.share': '分享', 'post.report': '举报',
    'post.pin': '置顶', 'post.unpin': '取消置顶', 'post.lock': '锁定评论', 'post.unlock': '解锁评论',
    'post.views': '浏览', 'post.comments': '评论', 'post.readMore': '阅读全文',
    'post.deleteConfirm': '确定删除这篇文章吗？此操作不可撤销。',
    'post.empty': '还没有任何文章', 'post.emptyDesc': '成为第一个在这里发布内容的人吧。',
    'post.preview': '预览', 'post.write': '编写', 'post.markdown': 'Markdown 已启用',

    'comment.title': '评论', 'comment.placeholder': '写下你的评论…', 'comment.submit': '发表评论',
    'comment.reply': '回复', 'comment.delete': '删除', 'comment.empty': '暂无评论，来说两句吧',
    'comment.locked': '该文章评论已被锁定',

    'dm.title': '私信', 'dm.new': '新建会话', 'dm.placeholder': '输入消息，Enter 发送，Shift+Enter 换行',
    'dm.empty': '还没有会话', 'dm.emptyDesc': '在用户主页点击「发私信」开始聊天。', 'dm.send': '发送',
    'dm.selectThread': '选择一个会话开始聊天', 'dm.back': '返回列表',

    'notif.title': '通知', 'notif.markAll': '全部标记为已读', 'notif.empty': '暂无通知',
    'notif.type.like': '赞了你的文章', 'notif.type.comment': '评论了你的文章',
    'notif.type.follow': '关注了你', 'notif.type.dm': '给你发了私信',
    'notif.type.system': '系统通知', 'notif.type.report': '举报处理结果', 'notif.type.mention': '提到了你',

    'ch.title': '频道', 'ch.create': '创建频道', 'ch.join': '加入', 'ch.joined': '已加入',
    'ch.leave': '退出频道', 'ch.manage': '管理频道', 'ch.members': '成员', 'ch.groups': '群组',
    'ch.name': '频道名称', 'ch.desc': '频道简介', 'ch.icon': '频道图标', 'ch.banner': '频道横幅',
    'ch.newGroup': '创建群组', 'ch.groupName': '群组名称', 'ch.empty': '还没有频道',
    'ch.emptyDesc': '创建第一个频道，开始组织你的社区。', 'ch.public': '公开频道', 'ch.private': '私密频道',
    'ch.enter': '进入', 'ch.boards': '板块', 'ch.overview': '频道总览', 'ch.structure': '结构管理',

    'role.title': '身份组', 'role.create': '创建身份组', 'role.name': '身份组名称',
    'role.color': '颜色', 'role.priority': '优先级', 'role.perms': '权限',
    'role.assign': '分配身份组', 'role.scope': '作用域', 'role.deleteConfirm': '删除该身份组？成员将失去对应权限。',
    'role.scopeHint': '本面板中的身份组仅在当前区域内生效',

    'user.profile': '个人主页', 'user.posts': '文章', 'user.followers': '粉丝', 'user.following': '关注',
    'user.follow': '关注', 'user.unfollow': '取消关注', 'user.sendDm': '发私信',
    'user.joined': '加入于', 'user.links': '关联账号', 'user.bio': '个人简介',
    'user.displayName': '昵称', 'user.avatar': '头像', 'user.banner': '主页横幅',

    'settings.title': '用户设置', 'settings.account': '账号', 'settings.profile': '资料',
    'settings.security': '安全', 'settings.appearance': '外观', 'settings.notify': '通知',
    'settings.connections': '第三方关联', 'settings.privacy': '隐私', 'settings.danger': '危险区域',
    'settings.changePwd': '修改密码', 'settings.changeEmail': '更换邮箱',
    'settings.theme': '主题', 'settings.theme.auto': '跟随系统', 'settings.theme.light': '浅色',
    'settings.theme.dark': '深色', 'settings.language': '界面语言', 'settings.timeFormat': '时间格式',
    'settings.tf.auto': '自动（跟随地区）', 'settings.tf.12': '12 小时制', 'settings.tf.24': '24 小时制',
    'settings.deleteAccount': '注销账号', 'settings.deleteWarn': '注销后所有数据将被匿名化，且无法恢复。',
    'settings.saved': '设置已保存', 'settings.bind': '绑定', 'settings.unbind': '解绑', 'settings.bound': '已绑定',

    'admin.title': '管理后台', 'admin.overview': '总览', 'admin.users': '用户管理',
    'admin.posts': '内容管理', 'admin.channels': '频道管理', 'admin.roles': '权限组',
    'admin.reports': '举报处理', 'admin.ipbans': 'IP 封禁', 'admin.logs': '访问日志',
    'admin.site': '站点设置', 'admin.mail': '邮件系统', 'admin.bots': '机器人', 'admin.cloudflare': 'Cloudflare',
    'admin.nav': '导航与按钮', 'admin.landing': '首页模式', 'admin.appearance': '外观与品牌',
    'admin.ban': '封禁', 'admin.unban': '解封', 'admin.mute': '禁言', 'admin.unmute': '解除禁言',
    'admin.rename': '更改昵称', 'admin.resolve': '处理', 'admin.reject': '驳回',
    'admin.totalUsers': '注册用户', 'admin.totalPosts': '文章总数', 'admin.totalComments': '评论总数',
    'admin.pendingReports': '待处理举报', 'admin.onlineToday': '今日活跃', 'admin.requests': '今日请求',

    'report.title': '举报内容', 'report.reason': '举报原因', 'report.detail': '补充说明',
    'report.submit': '提交举报', 'report.success': '举报已提交，管理员会尽快处理',
    'report.reason.spam': '垃圾广告', 'report.reason.abuse': '辱骂攻击', 'report.reason.illegal': '违法违规',
    'report.reason.porn': '色情低俗', 'report.reason.other': '其他',

    'common.confirm': '确定', 'common.cancel': '取消', 'common.save': '保存', 'common.close': '关闭',
    'common.delete': '删除', 'common.edit': '编辑', 'common.search': '搜索', 'common.loading': '加载中…',
    'common.create': '创建',
    'common.loadMore': '加载更多', 'common.noMore': '没有更多了', 'common.retry': '重试',
    'common.copy': '复制', 'common.copied': '已复制', 'common.upload': '上传', 'common.back': '返回',
    'common.next': '下一步', 'common.prev': '上一步', 'common.all': '全部', 'common.none': '无',
    'common.yes': '是', 'common.no': '否', 'common.optional': '选填', 'common.required': '必填',
    'common.success': '操作成功', 'common.failed': '操作失败', 'common.networkError': '网络异常，请稍后重试',
    'common.unauthorized': '请先登录', 'common.forbidden': '你没有权限执行此操作',
    'common.notfound': '内容不存在或已被删除', 'common.reset': '重置', 'common.apply': '应用',
    'common.enable': '启用', 'common.disable': '禁用', 'common.enabled': '已启用', 'common.disabled': '已禁用',

    'time.justNow': '刚刚', 'time.minutesAgo': '{n} 分钟前', 'time.hoursAgo': '{n} 小时前',
    'time.daysAgo': '{n} 天前', 'time.monthsAgo': '{n} 个月前', 'time.yearsAgo': '{n} 年前',

    'landing.enter': '进入社区', 'landing.loginFirst': '登录后进入社区',
    'landing.about': '关于我', 'landing.projects': '项目', 'landing.skills': '技能', 'landing.contact': '联系',
    'about.title': '关于我们', 'about.links': '站点导航',
    'nav.files': '我的文件', 'nav.download': '下载客户端',
    'landing.joinDiscord': '加入 Discord', 'landing.starGithub': 'GitHub 仓库',
    'files.pageSub': '绑定 Cloudflare 后，文件存于你自己的账户；未绑定则仅保存在本机。',
    'files.upload': '上传文件', 'files.drop': '点击或拖拽文件到此处', 'files.dropHint': '支持任意类型文件',
    'files.previewCode': '预览码（可选）', 'files.codePlaceholder': '设置后他人需凭码访问',
    'files.expire': '有效期（天）', 'files.expirePh': '0 表示永久', 'files.limit': '绑定 Cloudflare 后单文件上限约 25MB；未绑定时仅建议小于 3MB 的小文件存于本地。',
    'files.bound': '已绑定 Cloudflare 账号', 'files.bindTitle': '绑定 Cloudflare 账号',
    'files.bindDesc': '绑定后系统会在你的 Cloudflare 账户下自动创建 KV 命名空间与 D1 数据库，文件存于你自己的账户。',
    'files.bind': '绑定', 'files.unbind': '解绑', 'files.unbindConfirm': '确定解绑？你 Cloudflare 账户中的存储资源将保留，但本站的分享记录会清除。',
    'files.unbound': '已解绑', 'files.empty': '还没有文件', 'files.coded': '预览码', 'files.share': '分享/预览码',
    'files.shareTitle': '分享设置', 'files.savedLocal': '已保存到本地（更换设备/清缓存将丢失）',
    'files.localBig': '本地兜底仅建议小于 3MB 的文件，大文件请先绑定 Cloudflare。',
    'files.localWarn': '你尚未绑定 Cloudflare 账号，文件仅保存在本机浏览器，更换设备或清除缓存可能丢失。绑定后可生成分享链接并永久存储。',
    'files.delConfirm': '确定删除该文件？', 'files.uploaded': '上传成功', 'files.deleted': '已删除',

    'lang.promptTitle': '选择你的语言', 'lang.promptDesc': '我们检测到你可能偏好以下语言，也可以随时在「设置」中更改。',
    'lang.detected': '检测到', 'lang.confirm': '使用此语言', 'lang.keepAuto': '保持自动',

    'search.title': '搜索', 'search.placeholder': '搜索用户、文件、帖子、文章、官方公告…',
    'search.all': '全部', 'search.users': '用户', 'search.files': '文件', 'search.posts': '帖子',
    'search.articles': '文章', 'search.announcements': '官方公告', 'search.results': '搜索结果',
    'search.noResult': '没有找到相关内容', 'search.tip': '输入关键词开始搜索', 'search.user': '用户',
    'search.file': '文件', 'search.post': '帖子', 'search.article': '文章', 'search.announcement': '官方公告',

    'download.site': '本网站下载', 'download.github': '前往 GitHub 下载',
    'social.telegram': 'Telegram', 'social.discord': 'Discord', 'social.github': 'GitHub',

    'about.contributors': '贡献者', 'about.contributorsDesc': '感谢以下为项目做出贡献的人。',
    'about.bans': '封禁公示', 'about.bansDesc': '为维护社区秩序，以下账号或 IP 已被封禁。',
    'about.announcements': '官方公告',

    'bans.title': '封禁公示', 'bans.userBan': '账号封禁', 'bans.ipBan': 'IP 封禁',
    'bans.empty': '目前没有封禁记录', 'bans.reason': '原因', 'bans.until': '解封时间',
    'bans.permanent': '永久', 'bans.count': '共 {n} 条公示',

    'ann.title': '官方公告', 'ann.empty': '暂无公告', 'ann.pinned': '置顶',
  };

  DICT['en'] = {
    'app.name': 'MarytOpens',
    'nav.home': 'Home', 'nav.community': 'Community', 'nav.channels': 'Channels', 'nav.explore': 'Explore',
    'nav.messages': 'Messages', 'nav.notifications': 'Notifications', 'nav.about': 'About', 'nav.search': 'Search posts, users, channels…',
    'nav.write': 'Write', 'nav.admin': 'Admin', 'nav.settings': 'Settings', 'nav.profile': 'My Profile',
    'nav.login': 'Sign in', 'nav.register': 'Sign up', 'nav.logout': 'Sign out', 'nav.menu': 'Menu',
    'nav.favorites': 'Favorites', 'nav.myposts': 'My Posts', 'nav.drafts': 'Drafts',

    'auth.login.title': 'Welcome back', 'auth.login.sub': 'Sign in to enter the community',
    'auth.register.title': 'Create account', 'auth.register.sub': 'Join the MarytOpens community',
    'auth.identifier': 'Username or email', 'auth.username': 'Username', 'auth.email': 'Email address',
    'auth.password': 'Password', 'auth.password2': 'Confirm password', 'auth.code': 'Verification code',
    'auth.sendCode': 'Send code', 'auth.resend': 'Resend in {s}s',
    'auth.remember': 'Remember me', 'auth.forgot': 'Forgot password?', 'auth.submit.login': 'Sign in',
    'auth.submit.register': 'Create account', 'auth.or': 'Or continue with',
    'auth.github': 'Continue with GitHub', 'auth.discord': 'Continue with Discord',
    'auth.noAccount': "Don't have an account?", 'auth.hasAccount': 'Already registered?',
    'auth.agree': 'By signing up you agree to our community rules and privacy policy',
    'auth.reset.title': 'Reset password', 'auth.reset.sub': 'Set a new password with an email code',
    'auth.newPassword': 'New password', 'auth.oldPassword': 'Current password',
    'auth.verifyHuman': 'Please complete the human verification', 'auth.backLogin': 'Back to sign in',
    'auth.pwdWeak': 'Strength: weak', 'auth.pwdMid': 'Strength: medium', 'auth.pwdStrong': 'Strength: strong',
    'auth.pwdRule': 'At least 8 characters, mix letters and numbers',
    'auth.mismatch': 'Passwords do not match',

    'post.publish': 'Publish', 'post.save': 'Save', 'post.saveDraft': 'Save draft', 'post.edit': 'Edit',
    'post.delete': 'Delete', 'post.title': 'Title', 'post.content': 'Content',
    'post.titlePh': 'Give your post a title…', 'post.contentPh': 'Markdown supported. Start writing…',
    'post.tags': 'Tags', 'post.tagsPh': 'Press Enter to add', 'post.cover': 'Cover image',
    'post.visibility': 'Visibility', 'post.scope': 'Publish to',
    'post.vis.public': 'Public', 'post.vis.unlisted': 'Unlisted', 'post.vis.private': 'Private (you + super admin)',
    'post.vis.role': 'Role restricted', 'post.vis.draft': 'Draft',
    'post.visHint.private': 'Hidden from everyone; only you and the super admin can read it',
    'post.like': 'Like', 'post.favorite': 'Favorite', 'post.share': 'Share', 'post.report': 'Report',
    'post.pin': 'Pin', 'post.unpin': 'Unpin', 'post.lock': 'Lock comments', 'post.unlock': 'Unlock comments',
    'post.views': 'views', 'post.comments': 'comments', 'post.readMore': 'Read more',
    'post.deleteConfirm': 'Delete this post? This cannot be undone.',
    'post.empty': 'No posts yet', 'post.emptyDesc': 'Be the first to publish something here.',
    'post.preview': 'Preview', 'post.write': 'Write', 'post.markdown': 'Markdown enabled',

    'comment.title': 'Comments', 'comment.placeholder': 'Write a comment…', 'comment.submit': 'Post comment',
    'comment.reply': 'Reply', 'comment.delete': 'Delete', 'comment.empty': 'No comments yet — say something',
    'comment.locked': 'Comments are locked for this post',

    'dm.title': 'Messages', 'dm.new': 'New conversation', 'dm.placeholder': 'Type a message. Enter to send, Shift+Enter for newline',
    'dm.empty': 'No conversations', 'dm.emptyDesc': 'Open a profile and click "Message" to start.', 'dm.send': 'Send',
    'dm.selectThread': 'Select a conversation to start', 'dm.back': 'Back',

    'notif.title': 'Notifications', 'notif.markAll': 'Mark all as read', 'notif.empty': 'No notifications',
    'notif.type.like': 'liked your post', 'notif.type.comment': 'commented on your post',
    'notif.type.follow': 'started following you', 'notif.type.dm': 'sent you a message',
    'notif.type.system': 'System', 'notif.type.report': 'Report update', 'notif.type.mention': 'mentioned you',

    'ch.title': 'Channels', 'ch.create': 'Create channel', 'ch.join': 'Join', 'ch.joined': 'Joined',
    'ch.leave': 'Leave', 'ch.manage': 'Manage channel', 'ch.members': 'Members', 'ch.groups': 'Groups',
    'ch.name': 'Channel name', 'ch.desc': 'Description', 'ch.icon': 'Icon', 'ch.banner': 'Banner',
    'ch.newGroup': 'Create group', 'ch.groupName': 'Group name', 'ch.empty': 'No channels yet',
    'ch.emptyDesc': 'Create your first channel to organise the community.', 'ch.public': 'Public', 'ch.private': 'Private',
    'ch.enter': 'Open', 'ch.boards': 'Boards', 'ch.overview': 'Overview', 'ch.structure': 'Structure',

    'role.title': 'Roles', 'role.create': 'Create role', 'role.name': 'Role name',
    'role.color': 'Color', 'role.priority': 'Priority', 'role.perms': 'Permissions',
    'role.assign': 'Assign role', 'role.scope': 'Scope', 'role.deleteConfirm': 'Delete this role? Members lose its permissions.',
    'role.scopeHint': 'Roles here only apply inside this area',

    'user.profile': 'Profile', 'user.posts': 'Posts', 'user.followers': 'Followers', 'user.following': 'Following',
    'user.follow': 'Follow', 'user.unfollow': 'Unfollow', 'user.sendDm': 'Message',
    'user.joined': 'Joined', 'user.links': 'Linked accounts', 'user.bio': 'Bio',
    'user.displayName': 'Display name', 'user.avatar': 'Avatar', 'user.banner': 'Banner',

    'settings.title': 'Settings', 'settings.account': 'Account', 'settings.profile': 'Profile',
    'settings.security': 'Security', 'settings.appearance': 'Appearance', 'settings.notify': 'Notifications',
    'settings.connections': 'Connections', 'settings.privacy': 'Privacy', 'settings.danger': 'Danger zone',
    'settings.changePwd': 'Change password', 'settings.changeEmail': 'Change email',
    'settings.theme': 'Theme', 'settings.theme.auto': 'System', 'settings.theme.light': 'Light',
    'settings.theme.dark': 'Dark', 'settings.language': 'Language', 'settings.timeFormat': 'Time format',
    'settings.tf.auto': 'Auto (by locale)', 'settings.tf.12': '12-hour', 'settings.tf.24': '24-hour',
    'settings.deleteAccount': 'Delete account', 'settings.deleteWarn': 'All data will be anonymised and cannot be recovered.',
    'settings.saved': 'Settings saved', 'settings.bind': 'Connect', 'settings.unbind': 'Disconnect', 'settings.bound': 'Connected',

    'admin.title': 'Admin console', 'admin.overview': 'Overview', 'admin.users': 'Users',
    'admin.posts': 'Content', 'admin.channels': 'Channels', 'admin.roles': 'Roles',
    'admin.reports': 'Reports', 'admin.ipbans': 'IP bans', 'admin.logs': 'Access logs',
    'admin.site': 'Site settings', 'admin.mail': 'Mail', 'admin.bots': 'Bots', 'admin.cloudflare': 'Cloudflare',
    'admin.nav': 'Navigation', 'admin.landing': 'Landing mode', 'admin.appearance': 'Branding',
    'admin.ban': 'Ban', 'admin.unban': 'Unban', 'admin.mute': 'Mute', 'admin.unmute': 'Unmute',
    'admin.rename': 'Rename', 'admin.resolve': 'Resolve', 'admin.reject': 'Reject',
    'admin.totalUsers': 'Users', 'admin.totalPosts': 'Posts', 'admin.totalComments': 'Comments',
    'admin.pendingReports': 'Pending reports', 'admin.onlineToday': 'Active today', 'admin.requests': 'Requests today',

    'report.title': 'Report content', 'report.reason': 'Reason', 'report.detail': 'Details',
    'report.submit': 'Submit report', 'report.success': 'Report submitted, moderators will review it',
    'report.reason.spam': 'Spam', 'report.reason.abuse': 'Harassment', 'report.reason.illegal': 'Illegal content',
    'report.reason.porn': 'Adult content', 'report.reason.other': 'Other',

    'common.confirm': 'Confirm', 'common.cancel': 'Cancel', 'common.save': 'Save', 'common.close': 'Close',
    'common.delete': 'Delete', 'common.edit': 'Edit', 'common.search': 'Search', 'common.loading': 'Loading…',
    'common.create': 'Create',
    'common.loadMore': 'Load more', 'common.noMore': 'No more items', 'common.retry': 'Retry',
    'common.copy': 'Copy', 'common.copied': 'Copied', 'common.upload': 'Upload', 'common.back': 'Back',
    'common.next': 'Next', 'common.prev': 'Previous', 'common.all': 'All', 'common.none': 'None',
    'common.yes': 'Yes', 'common.no': 'No', 'common.optional': 'optional', 'common.required': 'required',
    'common.success': 'Done', 'common.failed': 'Failed', 'common.networkError': 'Network error, please retry',
    'common.unauthorized': 'Please sign in first', 'common.forbidden': 'You do not have permission',
    'common.notfound': 'Not found or removed', 'common.reset': 'Reset', 'common.apply': 'Apply',
    'common.enable': 'Enable', 'common.disable': 'Disable', 'common.enabled': 'Enabled', 'common.disabled': 'Disabled',

    'time.justNow': 'just now', 'time.minutesAgo': '{n}m ago', 'time.hoursAgo': '{n}h ago',
    'time.daysAgo': '{n}d ago', 'time.monthsAgo': '{n}mo ago', 'time.yearsAgo': '{n}y ago',

    'landing.enter': 'Enter community', 'landing.loginFirst': 'Sign in to enter',
    'landing.about': 'About me', 'landing.projects': 'Projects', 'landing.skills': 'Skills', 'landing.contact': 'Contact',
    'about.title': 'About us', 'about.links': 'Site navigation',
    'nav.files': 'My Files', 'nav.download': 'Download app',
    'landing.joinDiscord': 'Join Discord', 'landing.starGithub': 'GitHub Repo',
    'files.pageSub': 'After binding Cloudflare, files live in your own account; otherwise they stay on this device.',
    'files.upload': 'Upload', 'files.drop': 'Click or drop a file here', 'files.dropHint': 'Any file type',
    'files.previewCode': 'Preview code (optional)', 'files.codePlaceholder': 'Others need this code to view',
    'files.expire': 'Expires in (days)', 'files.expirePh': '0 = never', 'files.limit': 'After binding Cloudflare, single file limit is ~25MB; unbound keeps only small (<3MB) files locally.',
    'files.bound': 'Cloudflare account bound', 'files.bindTitle': 'Bind Cloudflare account',
    'files.bindDesc': 'Binding auto-creates a KV namespace and a D1 database in your Cloudflare account; your files live there.',
    'files.bind': 'Bind', 'files.unbind': 'Unbind', 'files.unbindConfirm': 'Unbind? Storage in your Cloudflare account is kept, but share records here are cleared.',
    'files.unbound': 'Unbound', 'files.empty': 'No files yet', 'files.coded': 'Protected', 'files.share': 'Share / code',
    'files.shareTitle': 'Share settings', 'files.savedLocal': 'Saved locally (lost if device/cache changes)',
    'files.localBig': 'Local fallback is for <3MB files only; bind Cloudflare for larger files.',
    'files.localWarn': 'You have not bound Cloudflare. Files live only in this browser and may be lost on device/cache change. Bind to share and keep them.',
    'files.delConfirm': 'Delete this file?', 'files.uploaded': 'Uploaded', 'files.deleted': 'Deleted',

    'lang.promptTitle': 'Choose your language', 'lang.promptDesc': 'We detected a language you might prefer. You can change it anytime in Settings.',
    'lang.detected': 'Detected', 'lang.confirm': 'Use this language', 'lang.keepAuto': 'Keep auto',

    'search.title': 'Search', 'search.placeholder': 'Search users, files, posts, articles, announcements…',
    'search.all': 'All', 'search.users': 'Users', 'search.files': 'Files', 'search.posts': 'Posts',
    'search.articles': 'Articles', 'search.announcements': 'Announcements', 'search.results': 'Search results',
    'search.noResult': 'No results found', 'search.tip': 'Type a keyword to start', 'search.user': 'User',
    'search.file': 'File', 'search.post': 'Post', 'search.article': 'Article', 'search.announcement': 'Announcement',

    'download.site': 'Download from this site', 'download.github': 'Download on GitHub',
    'social.telegram': 'Telegram', 'social.discord': 'Discord', 'social.github': 'GitHub',

    'about.contributors': 'Contributors', 'about.contributorsDesc': 'Thanks to everyone who contributed to this project.',
    'about.bans': 'Ban notices', 'about.bansDesc': 'The following accounts or IPs have been banned to keep the community safe.',
    'about.announcements': 'Announcements',

    'bans.title': 'Ban notices', 'bans.userBan': 'Account ban', 'bans.ipBan': 'IP ban',
    'bans.empty': 'No bans at the moment', 'bans.reason': 'Reason', 'bans.until': 'Unbanned at',
    'bans.permanent': 'Permanent', 'bans.count': '{n} notices',

    'ann.title': 'Announcements', 'ann.empty': 'No announcements yet', 'ann.pinned': 'Pinned',
  };

  /* 繁体中文：基于简体做关键覆盖 */
  DICT['zh-TW'] = Object.assign({}, DICT['zh-CN'], {
    'nav.home': '首頁', 'nav.community': '社群', 'nav.channels': '頻道', 'nav.explore': '探索',
    'nav.messages': '私訊', 'nav.notifications': '通知', 'nav.about': '關於我們',
    'nav.search': '搜尋文章、使用者、頻道…', 'nav.write': '寫文章', 'nav.admin': '管理後臺',
    'nav.settings': '設定', 'nav.profile': '我的主頁', 'nav.login': '登入', 'nav.register': '註冊',
    'nav.logout': '登出', 'nav.favorites': '我的收藏', 'nav.myposts': '我的文章', 'nav.drafts': '草稿匣',
    'auth.login.title': '歡迎回來', 'auth.login.sub': '登入後進入社群主介面',
    'auth.register.title': '建立帳號', 'auth.register.sub': '加入 MarytOpens 社群',
    'auth.identifier': '使用者名稱或電子郵件', 'auth.username': '使用者名稱', 'auth.email': '電子郵件',
    'auth.password': '密碼', 'auth.password2': '確認密碼', 'auth.code': '郵件驗證碼',
    'auth.sendCode': '發送驗證碼', 'auth.submit.login': '登入', 'auth.submit.register': '註冊帳號',
    'auth.github': '使用 GitHub 登入', 'auth.discord': '使用 Discord 登入',
    'auth.verifyHuman': '請完成人機驗證', 'auth.mismatch': '兩次輸入的密碼不一致',
    'post.publish': '發佈', 'post.saveDraft': '存為草稿', 'post.content': '內文',
    'post.vis.private': '私密（僅自己與超管）', 'post.visibility': '可見性',
    'comment.title': '評論', 'comment.submit': '發表評論', 'comment.empty': '尚無評論，來說兩句吧',
    'dm.title': '私訊', 'notif.title': '通知', 'ch.title': '頻道', 'role.title': '身份組',
    'settings.title': '使用者設定', 'settings.language': '介面語言', 'settings.theme': '佈景主題',
    'admin.title': '管理後臺', 'common.confirm': '確定', 'common.cancel': '取消', 'common.save': '儲存',
    'common.loading': '載入中…', 'common.loadMore': '載入更多', 'common.networkError': '網路異常，請稍後重試',
    'time.justNow': '剛剛', 'time.minutesAgo': '{n} 分鐘前', 'time.hoursAgo': '{n} 小時前',
    'time.daysAgo': '{n} 天前', 'landing.enter': '進入社群', 'about.title': '關於我們',
  });

  DICT['ja'] = Object.assign({}, DICT['en'], {
    'nav.home': 'ホーム', 'nav.community': 'コミュニティ', 'nav.channels': 'チャンネル',
    'nav.messages': 'メッセージ', 'nav.notifications': '通知', 'nav.about': '私たちについて',
    'nav.search': '投稿・ユーザー・チャンネルを検索…', 'nav.write': '投稿する', 'nav.admin': '管理画面',
    'nav.settings': '設定', 'nav.profile': 'マイページ', 'nav.login': 'ログイン', 'nav.register': '登録',
    'nav.logout': 'ログアウト', 'nav.favorites': 'お気に入り', 'nav.myposts': '自分の投稿',
    'auth.login.title': 'おかえりなさい', 'auth.login.sub': 'ログインしてコミュニティへ',
    'auth.register.title': 'アカウント作成', 'auth.identifier': 'ユーザー名またはメール',
    'auth.password': 'パスワード', 'auth.code': '認証コード', 'auth.sendCode': 'コードを送信',
    'auth.submit.login': 'ログイン', 'auth.submit.register': '登録する', 'auth.or': 'または',
    'auth.verifyHuman': '人間確認を完了してください',
    'post.publish': '公開', 'post.title': 'タイトル', 'post.content': '本文',
    'post.like': 'いいね', 'post.favorite': 'ブックマーク', 'post.report': '報告',
    'comment.title': 'コメント', 'comment.submit': 'コメントする',
    'dm.title': 'メッセージ', 'notif.title': '通知', 'ch.title': 'チャンネル', 'role.title': 'ロール',
    'settings.title': '設定', 'settings.language': '言語', 'settings.theme': 'テーマ',
    'admin.title': '管理コンソール',
    'common.confirm': '確定', 'common.cancel': 'キャンセル', 'common.save': '保存',
    'common.loading': '読み込み中…', 'common.loadMore': 'もっと見る',
    'time.justNow': 'たった今', 'time.minutesAgo': '{n}分前', 'time.hoursAgo': '{n}時間前', 'time.daysAgo': '{n}日前',
    'landing.enter': 'コミュニティへ',
  });

  DICT['ko'] = Object.assign({}, DICT['en'], {
    'nav.home': '홈', 'nav.community': '커뮤니티', 'nav.channels': '채널', 'nav.messages': '메시지',
    'nav.notifications': '알림', 'nav.about': '소개', 'nav.write': '글쓰기', 'nav.admin': '관리자',
    'nav.settings': '설정', 'nav.profile': '내 프로필', 'nav.login': '로그인', 'nav.register': '회원가입',
    'nav.logout': '로그아웃', 'auth.login.title': '다시 오신 것을 환영합니다',
    'auth.password': '비밀번호', 'auth.code': '인증 코드', 'auth.submit.login': '로그인',
    'post.publish': '게시', 'post.title': '제목', 'post.content': '본문', 'comment.title': '댓글',
    'settings.title': '설정', 'settings.language': '언어', 'settings.theme': '테마',
    'common.confirm': '확인', 'common.cancel': '취소', 'common.save': '저장', 'common.loading': '불러오는 중…',
    'time.justNow': '방금', 'time.minutesAgo': '{n}분 전', 'time.hoursAgo': '{n}시간 전', 'time.daysAgo': '{n}일 전',
  });

  DICT['ru'] = Object.assign({}, DICT['en'], {
    'nav.home': 'Главная', 'nav.community': 'Сообщество', 'nav.channels': 'Каналы',
    'nav.messages': 'Сообщения', 'nav.notifications': 'Уведомления', 'nav.about': 'О нас',
    'nav.write': 'Написать', 'nav.admin': 'Админка', 'nav.settings': 'Настройки',
    'nav.login': 'Войти', 'nav.register': 'Регистрация', 'nav.logout': 'Выйти',
    'auth.login.title': 'С возвращением', 'auth.password': 'Пароль', 'auth.code': 'Код подтверждения',
    'auth.submit.login': 'Войти', 'post.publish': 'Опубликовать', 'post.title': 'Заголовок',
    'comment.title': 'Комментарии', 'settings.title': 'Настройки', 'settings.language': 'Язык',
    'settings.theme': 'Тема', 'common.confirm': 'ОК', 'common.cancel': 'Отмена', 'common.save': 'Сохранить',
    'common.loading': 'Загрузка…', 'time.justNow': 'только что', 'time.minutesAgo': '{n} мин назад',
    'time.hoursAgo': '{n} ч назад', 'time.daysAgo': '{n} дн назад',
  });

  DICT['de'] = Object.assign({}, DICT['en'], {
    'nav.home': 'Start', 'nav.community': 'Community', 'nav.channels': 'Kanäle',
    'nav.messages': 'Nachrichten', 'nav.notifications': 'Benachrichtigungen', 'nav.about': 'Über uns',
    'nav.write': 'Schreiben', 'nav.admin': 'Verwaltung', 'nav.settings': 'Einstellungen',
    'nav.login': 'Anmelden', 'nav.register': 'Registrieren', 'nav.logout': 'Abmelden',
    'auth.login.title': 'Willkommen zurück', 'auth.password': 'Passwort', 'auth.code': 'Bestätigungscode',
    'auth.submit.login': 'Anmelden', 'post.publish': 'Veröffentlichen', 'post.title': 'Titel',
    'comment.title': 'Kommentare', 'settings.title': 'Einstellungen', 'settings.language': 'Sprache',
    'settings.theme': 'Design', 'common.confirm': 'Bestätigen', 'common.cancel': 'Abbrechen',
    'common.save': 'Speichern', 'common.loading': 'Wird geladen…',
    'time.justNow': 'gerade eben', 'time.minutesAgo': 'vor {n} Min.', 'time.hoursAgo': 'vor {n} Std.', 'time.daysAgo': 'vor {n} T.',
  });

  DICT['fr'] = Object.assign({}, DICT['en'], {
    'nav.home': 'Accueil', 'nav.community': 'Communauté', 'nav.channels': 'Salons',
    'nav.messages': 'Messages', 'nav.notifications': 'Notifications', 'nav.about': 'À propos',
    'nav.write': 'Écrire', 'nav.admin': 'Administration', 'nav.settings': 'Paramètres',
    'nav.login': 'Connexion', 'nav.register': "S'inscrire", 'nav.logout': 'Déconnexion',
    'auth.login.title': 'Bon retour', 'auth.password': 'Mot de passe', 'auth.code': 'Code de vérification',
    'auth.submit.login': 'Se connecter', 'post.publish': 'Publier', 'post.title': 'Titre',
    'comment.title': 'Commentaires', 'settings.title': 'Paramètres', 'settings.language': 'Langue',
    'settings.theme': 'Thème', 'common.confirm': 'Confirmer', 'common.cancel': 'Annuler',
    'common.save': 'Enregistrer', 'common.loading': 'Chargement…',
    'time.justNow': "à l'instant", 'time.minutesAgo': 'il y a {n} min', 'time.hoursAgo': 'il y a {n} h', 'time.daysAgo': 'il y a {n} j',
  });

  DICT['es'] = Object.assign({}, DICT['en'], {
    'nav.home': 'Inicio', 'nav.community': 'Comunidad', 'nav.channels': 'Canales',
    'nav.messages': 'Mensajes', 'nav.notifications': 'Notificaciones', 'nav.about': 'Acerca de',
    'nav.write': 'Escribir', 'nav.admin': 'Administración', 'nav.settings': 'Ajustes',
    'nav.login': 'Iniciar sesión', 'nav.register': 'Registrarse', 'nav.logout': 'Cerrar sesión',
    'auth.login.title': 'Bienvenido de nuevo', 'auth.password': 'Contraseña', 'auth.code': 'Código de verificación',
    'auth.submit.login': 'Iniciar sesión', 'post.publish': 'Publicar', 'post.title': 'Título',
    'comment.title': 'Comentarios', 'settings.title': 'Ajustes', 'settings.language': 'Idioma',
    'settings.theme': 'Tema', 'common.confirm': 'Confirmar', 'common.cancel': 'Cancelar',
    'common.save': 'Guardar', 'common.loading': 'Cargando…',
    'time.justNow': 'ahora mismo', 'time.minutesAgo': 'hace {n} min', 'time.hoursAgo': 'hace {n} h', 'time.daysAgo': 'hace {n} d',
  });

  /* --------------------------- 语言/时间格式协商 -------------------------- */

  /** 归一化任意语言标记到受支持列表 */
  function normalize(tag) {
    if (!tag) return null;
    const t = String(tag).replace('_', '-');
    if (SUPPORTED.includes(t)) return t;
    const low = t.toLowerCase();
    // 中文细分：繁体地区 → zh-TW
    if (low.startsWith('zh')) {
      if (/hant|tw|hk|mo/.test(low)) return 'zh-TW';
      return 'zh-CN';
    }
    const base = low.split('-')[0];
    const hit = SUPPORTED.find((s) => s.toLowerCase().split('-')[0] === base);
    return hit || null;
  }

  /** 探测浏览器语言偏好列表 */
  function detectFromBrowser() {
    const list = (navigator.languages && navigator.languages.length)
      ? navigator.languages : [navigator.language || navigator.userLanguage || 'en'];
    for (const l of list) { const n = normalize(l); if (n) return n; }
    return null;
  }

  /** 探测系统时间格式：12 / 24 小时制 */
  function detectHourCycle() {
    try {
      const opt = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions();
      if (opt.hourCycle) return (opt.hourCycle === 'h11' || opt.hourCycle === 'h12') ? 12 : 24;
      if (typeof opt.hour12 === 'boolean') return opt.hour12 ? 12 : 24;
    } catch (e) { /* ignore */ }
    try {
      const s = new Date(2020, 0, 1, 13, 0).toLocaleTimeString();
      return /am|pm|上午|下午|오전|오후/i.test(s) ? 12 : 24;
    } catch (e) { return 24; }
  }

  function detectTimeZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; }
  }

  /* ------------------------------ 状态与 API ------------------------------ */

  const LS_LOCALE = 'mo_locale';
  const LS_TF = 'mo_timeformat';   // auto | 12 | 24

  const state = {
    locale: 'en',
    auto: true,
    hourCycle: 24,
    timeZone: 'UTC',
    timeFormatPref: 'auto',
  };

  function resolveLocale() {
    const saved = localStorage.getItem(LS_LOCALE);
    if (saved && SUPPORTED.includes(saved)) { state.locale = saved; state.auto = false; return; }
    state.locale = detectFromBrowser() || 'en';
    state.auto = true;
  }

  function resolveTimeFormat() {
    const saved = localStorage.getItem(LS_TF);
    state.timeFormatPref = (saved === '12' || saved === '24') ? saved : 'auto';
    state.hourCycle = state.timeFormatPref === 'auto' ? detectHourCycle() : Number(state.timeFormatPref);
    state.timeZone = detectTimeZone();
  }

  function t(key, vars) {
    const d = DICT[state.locale] || DICT.en;
    let s = d[key];
    if (s === undefined) s = (DICT.en[key] !== undefined ? DICT.en[key] : key);
    if (vars) for (const k in vars) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
    return s;
  }

  /** 绝对时间格式化，遵循用户 12/24 制偏好 */
  function formatDate(ts, style) {
    if (!ts) return '';
    const d = new Date(Number(ts));
    const h12 = state.hourCycle === 12;
    const base = { hour12: h12 };
    let opt;
    if (style === 'date') opt = { year: 'numeric', month: 'short', day: 'numeric' };
    else if (style === 'time') opt = { hour: '2-digit', minute: '2-digit', ...base };
    else if (style === 'full') opt = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', ...base };
    else opt = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', ...base };
    try { return new Intl.DateTimeFormat(state.locale, opt).format(d); }
    catch (e) { return d.toLocaleString(); }
  }

  /** 相对时间：7 天内相对，超过则绝对 */
  function timeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - Number(ts);
    if (diff < 0) return formatDate(ts, 'date');
    const s = Math.floor(diff / 1000);
    if (s < 60) return t('time.justNow');
    const m = Math.floor(s / 60); if (m < 60) return t('time.minutesAgo', { n: m });
    const h = Math.floor(m / 60); if (h < 24) return t('time.hoursAgo', { n: h });
    const dd = Math.floor(h / 24); if (dd < 7) return t('time.daysAgo', { n: dd });
    return formatDate(ts, 'date');
  }

  function formatNumber(n) {
    const v = Number(n) || 0;
    try { return new Intl.NumberFormat(state.locale, { notation: v >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(v); }
    catch (e) { return String(v); }
  }

  /** 扫描 DOM 应用翻译：data-i18n / data-i18n-attr / data-time */
  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const txt = t(key);
      if (el.hasAttribute('data-i18n-html')) el.innerHTML = txt; else el.textContent = txt;
    });
    scope.querySelectorAll('[data-i18n-ph]').forEach((el) => el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))));
    scope.querySelectorAll('[data-i18n-title]').forEach((el) => el.setAttribute('title', t(el.getAttribute('data-i18n-title'))));
    scope.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))));
    scope.querySelectorAll('[data-time]').forEach((el) => {
      const ts = Number(el.getAttribute('data-time'));
      if (!ts) return;
      el.textContent = el.getAttribute('data-time-style') === 'abs' ? formatDate(ts) : timeAgo(ts);
      el.setAttribute('title', formatDate(ts, 'full'));
    });
    document.documentElement.lang = state.locale;
    document.documentElement.dir = (LOCALE_META[state.locale] || {}).dir || 'ltr';
  }

  function setLocale(loc, opts) {
    if (loc === 'auto') { localStorage.removeItem(LS_LOCALE); resolveLocale(); }
    else if (SUPPORTED.includes(loc)) { state.locale = loc; state.auto = false; localStorage.setItem(LS_LOCALE, loc); }
    apply();
    document.dispatchEvent(new CustomEvent('i18n:change', { detail: { locale: state.locale } }));
    if (!opts || opts.persistRemote !== false) {
      if (global.API && global.API.token && global.API.token()) {
        global.API.put('/api/me/profile', { locale: state.locale }).catch(() => {});
      }
    }
  }

  function setTimeFormat(v) {
    state.timeFormatPref = (v === '12' || v === '24') ? v : 'auto';
    if (state.timeFormatPref === 'auto') localStorage.removeItem(LS_TF);
    else localStorage.setItem(LS_TF, state.timeFormatPref);
    state.hourCycle = state.timeFormatPref === 'auto' ? detectHourCycle() : Number(state.timeFormatPref);
    apply();
  }

  resolveLocale();
  resolveTimeFormat();

  global.I18N = {
    SUPPORTED, LOCALE_META, DICT,
    get locale() { return state.locale; },
    get auto() { return state.auto; },
    get hourCycle() { return state.hourCycle; },
    get timeZone() { return state.timeZone; },
    get timeFormatPref() { return state.timeFormatPref; },
    t, apply, setLocale, setTimeFormat, timeAgo, formatDate, formatNumber,
    detectHourCycle, detectTimeZone, normalize,
  };
  global.t = t;

  /* ----------------------- 首次访问语言选择弹窗 -------------------------- */

  const LS_LANG_PROMPTED = 'mo_lang_prompted';

  function ensureLangPromptStyles() {
    if (document.getElementById('mo-lang-prompt-style')) return;
    const s = document.createElement('style');
    s.id = 'mo-lang-prompt-style';
    s.textContent = `
      #moLangPrompt{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;
        background:rgba(15,23,42,.55);backdrop-filter:blur(4px);font-family:var(--font-sans,system-ui,sans-serif)}
      #moLangPrompt .lp-card{background:var(--surface,#fff);color:var(--text,#111827);width:min(440px,92vw);
        border-radius:18px;padding:26px 24px;box-shadow:0 24px 60px rgba(0,0,0,.28);text-align:center}
      #moLangPrompt .lp-title{font-size:20px;font-weight:700;margin:0 0 6px}
      #moLangPrompt .lp-desc{font-size:13px;opacity:.7;margin:0 0 18px;line-height:1.5}
      #moLangPrompt .lp-detected{display:inline-block;font-size:12px;opacity:.6;margin-bottom:12px}
      #moLangPrompt .lp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px}
      #moLangPrompt .lp-opt{border:1px solid var(--border,#e5e7eb);background:var(--surface-2,#f8fafc);
        border-radius:12px;padding:10px 6px;cursor:pointer;font-size:13px;transition:.15s;display:flex;
        flex-direction:column;align-items:center;gap:4px}
      #moLangPrompt .lp-opt:hover{border-color:var(--accent,#6366f1);transform:translateY(-1px)}
      #moLangPrompt .lp-opt.active{border-color:var(--accent,#6366f1);background:var(--accent-soft,#eef2ff);font-weight:600}
      #moLangPrompt .lp-flag{font-size:20px}
      #moLangPrompt .lp-keep{font-size:13px;color:var(--accent,#6366f1);cursor:pointer;text-decoration:underline}
      html[data-theme="dark"] #moLangPrompt .lp-card{box-shadow:0 24px 60px rgba(0,0,0,.6)}
    `;
    document.head.appendChild(s);
  }

  function renderLangPrompt() {
    ensureLangPromptStyles();
    const detected = state.locale;
    const overlay = document.createElement('div');
    overlay.id = 'moLangPrompt';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const opts = SUPPORTED.map((loc) => {
      const m = LOCALE_META[loc] || { name: loc, flag: '🌐' };
      const active = loc === detected ? ' active' : '';
      return `<div class="lp-opt${active}" data-loc="${loc}">
        <span class="lp-flag">${m.flag || '🌐'}</span><span>${m.name}</span></div>`;
    }).join('');

    overlay.innerHTML = `
      <div class="lp-card">
        <h2 class="lp-title">${t('lang.promptTitle')}</h2>
        <p class="lp-desc">${t('lang.promptDesc')}</p>
        <div class="lp-detected">${t('lang.detected')}: ${LOCALE_META[detected]?.name || detected}</div>
        <div class="lp-grid">${opts}</div>
        <span class="lp-keep" data-keep="1">${t('lang.keepAuto')}</span>
      </div>`;

    overlay.addEventListener('click', (e) => {
      const opt = e.target.closest('.lp-opt');
      const keep = e.target.closest('[data-keep]');
      if (opt) {
        const loc = opt.getAttribute('data-loc');
        try { localStorage.setItem(LS_LANG_PROMPTED, '1'); } catch (e2) {}
        setLocale(loc);
        overlay.remove();
      } else if (keep) {
        try { localStorage.setItem(LS_LANG_PROMPTED, '1'); } catch (e2) {}
        overlay.remove();
      } else if (e.target === overlay) {
        try { localStorage.setItem(LS_LANG_PROMPTED, '1'); } catch (e2) {}
        overlay.remove();
      }
    });

    document.body.appendChild(overlay);
  }

  function maybeShowLanguagePrompt() {
    let prompted = false;
    try { prompted = localStorage.getItem(LS_LANG_PROMPTED) === '1'; } catch (e) {}
    if (prompted) return;
    // 仅在尚未手动设定语言（即当前为自动探测）时提示
    if (!state.auto) return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderLangPrompt, { once: true });
    } else {
      renderLangPrompt();
    }
  }

  global.I18N.maybeShowLanguagePrompt = maybeShowLanguagePrompt;

  document.addEventListener('DOMContentLoaded', () => { apply(); maybeShowLanguagePrompt(); });
})(window);
