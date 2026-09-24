/**
 * ============================================================================
 *  MarytOpens · Cloudflare Worker 后端总入口
 *  ------------------------------------------------------------------------
 *  Runtime : Cloudflare Workers (ES Module)
 *  Storage : KV (binding: DB) + R2 (binding: MEDIA)
 *  Domain  : https://api.example.com
 *  Front   : https://example.com
 *
 *  模块清单
 *   0. 常量 / 权限位定义
 *   1. 通用工具（响应、CORS、限流、日志、ID、时间）
 *   2. 加密（PBKDF2 密码、HMAC、JWT 签发校验、AES 传输封装）
 *   3. KV 数据访问层（用户、索引、帖子、评论、频道、角色…）
 *   4. 权限引擎（作用域 + 权限位 + 角色继承）
 *   5. 外部服务（Turnstile、Cloud Mail、GitHub/Discord OAuth、Cloudflare API）
 *   6. 路由表与中间件
 *   7. 业务处理器：Auth / Site / Post / Comment / Channel / Role / DM /
 *      Notification / Report / Admin / Bot / Upload
 *   8. 定时任务 scheduled()
 * ============================================================================
 */

/* ========================================================================== *
 * 0. 常量与权限位定义
 * ========================================================================== */

const VERSION = '1.0.0';

/** 超级管理员引导建号时，对明文口令做「客户端预哈希」所用的盐。
 *  必须与前端 pages/assets/js/api.js 里的 PWD_SALT 完全一致，
 *  否则引导创建的账号会因「盐不一致」永远登录失败（密码错误）。 */
const SUPER_ADMIN_PEPPER = 'MarytOpens::v1';

/** 全部权限位。scope 说明：G=仅全局，S=可作用于任意作用域 */
const PERMISSIONS = {
  // —— 站点级 ——
  'site.admin':        { scope: 'G', label: '超级管理员（拥有一切权限）' },
  'site.config':       { scope: 'G', label: '修改站点配置（标题/图标/背景/导航）' },
  'site.logs':         { scope: 'G', label: '查看访问日志与统计' },
  'site.cloudflare':   { scope: 'G', label: '调用 Cloudflare API 面板' },
  'site.mail':         { scope: 'G', label: '邮件收发与模板管理' },
  'site.bot':          { scope: 'G', label: '机器人接入与令牌管理' },
  // —— 用户治理 ——
  'user.ban':          { scope: 'S', label: '封禁账号' },
  'user.mute':         { scope: 'S', label: '禁言成员' },
  'user.rename':       { scope: 'S', label: '强制更改昵称' },
  'user.role':         { scope: 'S', label: '分配身份组' },
  'user.viewprivate':  { scope: 'S', label: '查看私密文章' },
  'user.report':       { scope: 'S', label: '提交举报与提名' },
  'discipline.review': { scope: 'S', label: '风纪审查与提案制裁' },
  'ip.ban':            { scope: 'G', label: '查看与封禁 IP' },
  // —— 内容治理 ——
  'post.create':       { scope: 'S', label: '发布文章' },
  'post.edit.any':     { scope: 'S', label: '编辑他人文章' },
  'post.delete.any':   { scope: 'S', label: '删除他人文章' },
  'post.pin':          { scope: 'S', label: '置顶/加精' },
  'post.lock':         { scope: 'S', label: '锁定评论' },
  'comment.create':    { scope: 'S', label: '发表评论' },
  'comment.delete.any':{ scope: 'S', label: '删除他人评论' },
  'report.handle':     { scope: 'S', label: '处理举报' },
  // —— 结构治理（层级：版块 ⊃ 频道，版主 > 频道主） ——
  'board.create':      { scope: 'G', label: '创建版块' },
  'board.manage':      { scope: 'S', label: '管理版块（改名/图标/频道/权限）' },
  'channel.create':    { scope: 'S', label: '在版块内创建频道' },
  'channel.manage':    { scope: 'S', label: '管理频道（改名/图标/权限）' },
  'role.manage':       { scope: 'S', label: '在本作用域创建/编辑身份组' },
  'invite.create':     { scope: 'S', label: '生成邀请' },
  // —— 交互 ——
  'dm.send':           { scope: 'G', label: '发送私信' },
  'react.use':         { scope: 'G', label: '点赞/收藏/关注' },
  // —— 经济与商城（MO 值 / Meow 值）——
  'economy.mint':      { scope: 'G', label: '发放 MO 积分（货币）' },
  'economy.shop.manage':{ scope: 'G', label: '管理积分商城（上架/下架商品）' },
  'economy.gift':      { scope: 'S', label: '向其他用户赠礼（道具/积分）' },
  'economy.tip':       { scope: 'S', label: '赞赏 / 打赏内容（MO 兑换）' },
  'economy.accelerate':{ scope: 'G', label: '发放加速券（Meow 值加速）' },
  // —— 外观与站点定制 ——
  'appearance.theme':  { scope: 'G', label: '修改站点主题配色' },
  'appearance.nav':    { scope: 'G', label: '编辑导航栏与身份组展示' },
  'appearance.footer': { scope: 'G', label: '编辑页脚版权文案（支持 Markdown）' },
  'appearance.badge':  { scope: 'S', label: '颁发徽章 / 称号 / 头像框' },
  // —— 内容治理细化 ——
  'post.featured':     { scope: 'S', label: '设置文章精选' },
  'comment.featured':  { scope: 'S', label: '设置评论精选' },
  'content.hide':      { scope: 'S', label: '隐藏 / 折叠内容' },
  'content.audit':     { scope: 'S', label: '进入审核队列处理' },
  // —— 问卷 / 调研 ——
  'survey.create':     { scope: 'S', label: '发布问卷 / 调研' },
  'survey.manage':     { scope: 'G', label: '管理全站问卷' },
  'survey.viewall':    { scope: 'G', label: '查看全部问卷结果' },
  // —— 身份组与作用域 ——
  'role.assign.scope': { scope: 'S', label: '按作用域分配身份组' },
  'user.title':        { scope: 'S', label: '为用户设置称号' },
  // —— 群组 / 交流组 ——
  'group.create':      { scope: 'S', label: '创建交流组' },
  'group.manage':      { scope: 'S', label: '管理交流组' },
  // —— 存储 / 文件 ——
  'storage.admin':     { scope: 'G', label: '管理全站文件存储' },
  'file.viewall':      { scope: 'G', label: '查看任意用户文件' },
  // —— 社区活动 ——
  'activity.create':   { scope: 'G', label: '发起社区活动' },
  'activity.manage':   { scope: 'G', label: '管理社区活动' },
  // —— 防御系统 ——
  'defense.manage':    { scope: 'G', label: '配置网站防御与跳转策略' },
  'audit.view':        { scope: 'G', label: '查看操作审计日志' },
  // —— 网关 / 小工具 ——
  'gateway.manage':    { scope: 'G', label: '管理本地网关与小工具' },
};

const ALL_PERMS = Object.keys(PERMISSIONS);

/** 预设身份组模板（创建作用域时自动落地） */
const ROLE_TEMPLATES = {
  super_admin: { name: '超级管理员', color: '#ef4444', priority: 1000, perms: ['site.admin'] },
  admin: {
    name: '站点管理员', color: '#f97316', priority: 900,
    perms: ['site.config','site.logs','site.mail','user.ban','user.mute','user.rename','user.role',
            'user.viewprivate','ip.ban','post.delete.any','post.edit.any','post.pin','post.lock',
            'comment.delete.any','report.handle','board.create','board.manage','channel.create','channel.manage','role.manage',
            'post.create','comment.create','dm.send','react.use'],
  },
  // 版块级（顶层社区单元）：版主统管整个版块及其下所有频道
  board_owner: {
    name: '版主', color: '#22c55e', priority: 800,
    perms: ['board.manage','channel.create','channel.manage','role.manage','user.mute','user.rename',
            'user.role','post.delete.any','post.edit.any','post.pin','post.lock','comment.delete.any',
            'report.handle','invite.create','post.create','comment.create','dm.send','react.use'],
  },
  board_admin: {
    name: '副版主', color: '#84cc16', priority: 650,
    perms: ['channel.create','channel.manage','user.mute','post.delete.any','post.pin','post.lock',
            'comment.delete.any','report.handle','invite.create','post.create','comment.create','dm.send','react.use'],
  },
  // 频道级（版块内的讨论单元）：频道主只管理自己的频道，权级低于版主
  channel_owner: {
    name: '频道主', color: '#8b5cf6', priority: 700,
    perms: ['channel.manage','role.manage','user.mute','user.rename','user.role','post.delete.any',
            'post.edit.any','post.pin','post.lock','comment.delete.any','report.handle','invite.create',
            'post.create','comment.create','dm.send','react.use'],
  },
  channel_admin: {
    name: '频道管理员', color: '#6366f1', priority: 550,
    perms: ['user.mute','post.delete.any','post.pin','post.lock','comment.delete.any',
            'report.handle','invite.create','post.create','comment.create','dm.send','react.use'],
  },
  member:  { name: '成员', color: '#64748b', priority: 100, perms: ['post.create','comment.create','dm.send','react.use','economy.gift','economy.tip'] },
  muted:   { name: '被禁言', color: '#94a3b8', priority: 50,  perms: [] },
  // 治理层（由选举产生，权级介于普通成员与管理层之间）
  representative: {
    name: '用户代表', color: '#0ea5e9', priority: 400,
    perms: ['user.report','report.handle','post.create','comment.create','dm.send','react.use'],
  },
  discipline: {
    name: '风纪委员', color: '#e11d48', priority: 450,
    perms: ['discipline.review','report.handle','user.report','user.mute','post.delete.any','comment.delete.any','post.create','comment.create','dm.send','react.use'],
  },
  guest:   { name: '访客', color: '#cbd5e1', priority: 0,   perms: [] },
};

/** 站点默认配置：可被超级管理员在后台完全覆盖 */
const DEFAULT_SITE_CONFIG = {
  siteTitle: 'MarytOpens',
  siteSubtitle: 'Modern community governance',
  favicon: '/assets/img/favicon.svg',
  logo: '/assets/img/logo.svg',
  landingMode: 'personal',            // personal | community —— 首次进入展示哪个首页
  loginBackground: '',                // 登录页背景图 URL（留空用渐变）
  loginBackgroundBlur: 6,
  themeDefault: 'auto',               // auto | light | dark
  accent: '#6366f1',
  // 超管可定制的站点主题（前端 boot 时映射为 CSS 变量）
  theme: { primary: '#6d28d9', accent: '#6366f1', bg: '', text: '', radius: 12, font: '' },
  // 外部/自定义表情：[{id,name,url,creator,createdAt}]，内容里用 :name: 引用
  emojis: [],
  // 全站小贴士（加载/页脚轮播）：[{text,icon}]
  tips: [],
  // 版块/频道/群组默认允许的互动开关（false 表示关闭，缺省为开启）
  allowExternalEmoji: true,           // 是否允许在内容中使用外部/自定义表情
  registerOpen: true,
  requireEmailVerify: true,
  turnstileOnLogin: true,
  turnstileOnRegister: true,
  turnstileOnPost: false,
  // Turnstile 人机验证密钥（可由超级管理员在后台设置，覆盖下方 Worker 环境变量）
  turnstile: {
    enabled: false,            // 总开关：是否启用 Turnstile
    siteKey: '',               // 公开 Site Key（前端渲染组件用，会通过 /api/meta 下发）
    secret: '',                // 服务端 Secret（仅后端校验使用，绝不下发给前端）
  },
  allowGithubLogin: true,
  allowDiscordLogin: true,
  // OAuth 凭证：可由超管在后台设置，覆盖下方 Worker 环境变量（clientSecret 仅后端使用，绝不下发前端）
  oauth: {
    github: { clientId: '', clientSecret: '' },
    discord: { clientId: '', clientSecret: '' },
  },
  footerText: 'MarytOpens | MarytTeam © 2026 | Built for modern community governance, local models, and developer workflows.\n\nDesigned for fast collaboration, review workflows, and next-gen local gateway integration.',
  navLinks: [],                       // [{id,label,url,position,icon,target,visibleTo}]
  announcement: '',
  links: {                            // 超管在后台设定的外部入口（落地页/页脚使用）
    discord: '',                     // Discord 社区邀请/服务器 URL
    github: '',                      // GitHub 组织/仓库 URL
    telegram: '',                    // Telegram 频道/群组/个人主页 URL（自动解析头像）
    telegramAvatar: '',              // 自动解析得到的 Telegram 头像（留空则用图标）
    telegramTitle: '',               // 自动解析得到的 Telegram 名称
    download: 'https://app.example.com/downloads/files', // 客户端下载页 URL（Desktop / Android APK）
    githubDownload: '',              // 前往 GitHub 下载（Release / 仓库）URL
  },
  personal: {
    displayName: 'Maryt',
    tagline: 'Building MarytOpens — community, governance, local models.',
    avatar: '',
    bio: '欢迎来到我的个人主页。点击右上角登录后即可进入社区。',
    skills: ['Cloudflare Workers', 'Edge Computing', 'Community Governance', 'Local LLM'],
    socials: [],                      // [{label,url,icon}]
    projects: [],                     // [{name,desc,url}]
  },
  about: '# 关于我们\n\nMarytOpens 是一个基于 Cloudflare 边缘网络构建的现代社区治理平台。',
  contributors: [],                  // 公示贡献者：[{name, url, role, note}]；指向用户主页的链接会自动捕获头像与用户名
  announcements: [],                 // 官方公告（社区公告）：[{id,title,body,createdAt,pinned}]
  seo: { description: 'MarytOpens community platform', keywords: 'community,cloudflare,blog' },
  // 联系我们：超级管理员在后台配置，前端「联系我们」按钮按类型差异化处理
  contact: {
    enabled: false,                 // 是否启用「联系我们」按钮
    type: 'email',                  // email | url | qq
    value: '',                      // email 类型=接收反馈的邮箱；url 类型=跳转网址；qq 类型=QQ号/群号/加群链接
    note: '',                       // 展示给用户的补充说明（可选）
  },
};

/** 支持的界面语言（前端也内置同名字典） */
const SUPPORTED_LOCALES = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'ru', 'de', 'fr', 'es'];

/* ========================================================================== *
 * 1. 通用工具
 * ========================================================================== */

const te = new TextEncoder();
const td = new TextDecoder();

const nowSec = () => Math.floor(Date.now() / 1000);
const nowMs = () => Date.now();

function uid(prefix = '') {
  const b = crypto.getRandomValues(new Uint8Array(16));
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return prefix ? `${prefix}_${hex}` : hex;
}

/** 单调递增 ID：时间戳(36) + 随机，用于 KV 前缀排序（倒序拼接便于取最新） */
function sortableId() {
  const inv = (9999999999999 - nowMs()).toString().padStart(13, '0');
  return `${inv}${uid().slice(0, 8)}`;
}

function b64urlEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 富文本 / Markdown 入库前的净化：剥离脚本、事件属性、危险协议 */
function sanitizeContent(raw = '', maxLen = 200000) {
  let s = String(raw).slice(0, maxLen);
  s = s.replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, '');
  s = s.replace(/<\s*iframe[\s\S]*?<\s*\/\s*iframe\s*>/gi, '');
  s = s.replace(/<\s*(object|embed|link|meta|base)[^>]*>/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/javascript\s*:/gi, 'blocked:');
  s = s.replace(/data\s*:\s*text\/html/gi, 'blocked:');
  return s;
}

function slugify(s = '') {
  return String(s).toLowerCase().trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '').slice(0, 80) || 'untitled';
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, Number(n) || 0)); }

function pick(obj, keys) {
  const o = {};
  for (const k of keys) if (obj[k] !== undefined) o[k] = obj[k];
  return o;
}

/* ---------------------------- CORS 与响应 -------------------------------- */

function allowedOriginList(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** 提取根域名（支持 .co.uk 等二级 ccTLD 的粗略处理） */
function rootDomain(hostname) {
  const parts = String(hostname || '').toLowerCase().split('.');
  if (parts.length <= 2) return parts.join('.');
  return parts.slice(-2).join('.');
}

/** 判断 origin 是否同源或同根域 / Pages 预览域 */
function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  const list = allowedOriginList(env);
  if (list.includes(origin)) return true;
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    // 本地开发
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost')) return true;
    // 同根域下的任意子域（如 www / miku / api 等）
    const apiRoot = rootDomain(env.API_HOST || 'api.example.com');
    if (rootDomain(host) === apiRoot) return true;
    // Pages 预览域
    if (host === 'marytopens.pages.dev' || host.endsWith('.marytopens.pages.dev')) return true;
  } catch (e) { /* ignore */ }
  return false;
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const list = allowedOriginList(env);
  const ok = isAllowedOrigin(origin, env);
  const h = {
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Bot-Token,X-Requested-With,X-Client-Locale,X-CSRF-Token',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (ok) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Credentials'] = 'true';
  } else if (list.length) {
    h['Access-Control-Allow-Origin'] = list[0];
    h['Access-Control-Allow-Credentials'] = 'true';
  }
  return h;
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

function json(data, init = {}, ctx = null) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...(ctx?.cors || {}),
    ...(init.headers || {}),
  };
  return new Response(JSON.stringify(data), { status: init.status || 200, headers });
}

function ok(data = {}, ctx = null) { return json({ ok: true, ...data }, {}, ctx); }

function fail(status, code, message, ctx = null, extra = {}) {
  return json({ ok: false, error: { code, message, ...extra } }, { status }, ctx);
}

class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message); this.status = status; this.code = code; this.extra = extra;
  }
}
const bad     = (m, c = 'BAD_REQUEST')  => { throw new HttpError(400, c, m); };
const unauth  = (m = '请先登录')          => { throw new HttpError(401, 'UNAUTHORIZED', m); };
const forbid  = (m = '权限不足')          => { throw new HttpError(403, 'FORBIDDEN', m); };
const notfound= (m = '资源不存在')        => { throw new HttpError(404, 'NOT_FOUND', m); };
const conflict= (m = '资源冲突')          => { throw new HttpError(409, 'CONFLICT', m); };
const toomany = (m = '操作过于频繁')      => { throw new HttpError(429, 'RATE_LIMITED', m); };

/* ------------------------------ 客户端信息 ------------------------------- */

function clientIP(request) {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0].trim()
    || '0.0.0.0';
}

function clientMeta(request) {
  const cf = request.cf || {};
  return {
    ip: clientIP(request),
    ua: (request.headers.get('User-Agent') || '').slice(0, 300),
    country: cf.country || 'XX',
    city: cf.city || '',
    asn: cf.asn || 0,
    colo: cf.colo || '',
  };
}

/** 依据 Accept-Language 猜测界面语言（前端也会独立判断一次） */
function negotiateLocale(request) {
  const hdr = request.headers.get('X-Client-Locale') || request.headers.get('Accept-Language') || '';
  const items = hdr.split(',').map((p) => {
    const [tag, q] = p.trim().split(';q=');
    return { tag: tag.trim(), q: q ? parseFloat(q) : 1 };
  }).sort((a, b) => b.q - a.q);
  for (const { tag } of items) {
    if (!tag) continue;
    if (SUPPORTED_LOCALES.includes(tag)) return tag;
    const base = tag.split('-')[0];
    const hit = SUPPORTED_LOCALES.find((l) => l.split('-')[0] === base);
    if (hit) return hit;
  }
  return 'en';
}

/* ------------------------------- 限流 ------------------------------------ */

/**
 * 限流：isolate 内存滑动窗口，零 KV 开销。
 *
 * 为什么不落 KV：Workers KV 免费版每天只有 1000 次写入。若每个请求都写一次限流计数，
 * 几百次正常访问就会把当天配额烧光，之后连注册/发帖都会 500；更糟的是攻击者只要狂刷请求
 * 就能主动写爆配额——限流器本身反而变成 DoS 放大器。
 * 代价：多 isolate 之间计数不共享（同一 colo 通常复用同一 isolate），对本站规模完全够用。
 */
const RL_MEM = new Map();          // key -> { n, reset }
let RL_SWEEP_AT = 0;

function rateLimitMem(key, max, windowSec) {
  const now = Date.now();
  if (now - RL_SWEEP_AT > 60000) { // 定期清理过期桶，避免内存无限增长
    RL_SWEEP_AT = now;
    for (const [k, v] of RL_MEM) if (v.reset <= now) RL_MEM.delete(k);
  }
  let b = RL_MEM.get(key);
  if (!b || b.reset <= now) { b = { n: 0, reset: now + Math.max(1, windowSec) * 1000 }; RL_MEM.set(key, b); }
  if (b.n >= max) return false;
  b.n++;
  return true;
}

// eslint-disable-next-line no-unused-vars
async function rateLimit(env, key, max, windowSec) {
  return rateLimitMem(key, max, windowSec);
}

async function guardRate(env, key, max, windowSec, msg = '操作过于频繁，请稍后再试') {
  if (!(await rateLimit(env, key, max, windowSec))) toomany(msg);
}

/* ------------------------------ 访问日志 --------------------------------- */

/**
 * 访问日志同样受 KV 写配额约束（原实现每个请求写 2 次：一条 log + 一次 PV 计数）。
 * 现改为：日志先攒在内存里，攒满 LOG_BATCH_MAX 条或超过 LOG_FLUSH_MS 才批量落一条 KV；
 * PV 计数一并在 flush 时累加写回。高频轮询接口直接不记日志（只计 PV）。
 * 落盘格式为「数组（批）」，读取端会自动展开，历史的单条对象格式仍然兼容。
 * 取舍：isolate 被回收时可能丢掉尚未 flush 的少量日志——对访问日志而言可以接受。
 */
const LOG_BUF = [];
const LOG_BATCH_MAX = 40;
const LOG_FLUSH_MS = 120000;
let LOG_LAST_FLUSH = Date.now();
let PV_PENDING = 0;
/** 待累加的全站计数（热路径用，避免每次都读写 KV） */
const STAT_PENDING = new Map();
/** 这些高频/轮询接口不写访问日志，否则会淹没日志并烧穿配额 */
const LOG_SKIP_RE = [
  /\/messages$/,               // 频道群聊轮询
  /^\/api\/notifications/,     // 通知轮询
  /^\/api\/auth\/me$/,         // 前端 30s 心跳
  /^\/api\/health$/,
  /^\/api\/meta$/,
  /^\/api\/presence$/,          // 在线人数轮询
];

/** 热路径计数：只累加在内存，随日志批量落盘 */
function bumpStatLazy(key, delta = 1) {
  STAT_PENDING.set(key, (STAT_PENDING.get(key) || 0) + delta);
}

async function flushAccessLog(env) {
  const batch = LOG_BUF.splice(0, LOG_BUF.length);
  const pv = PV_PENDING; PV_PENDING = 0;
  const stats = [...STAT_PENDING.entries()]; STAT_PENDING.clear();
  LOG_LAST_FLUSH = Date.now();
  try {
    if (batch.length) {
      const ttl = parseInt(env.LOG_TTL_SECONDS || '2592000', 10);
      await env.DB.put(`log:${sortableId()}`, JSON.stringify(batch), {
        expirationTtl: ttl,
        metadata: { batch: batch.length, t: batch[batch.length - 1].t },
      });
    }
    if (pv > 0) {
      const day = new Date().toISOString().slice(0, 10);
      const ck = `stat:pv:${day}`;
      const cur = parseInt((await env.DB.get(ck)) || '0', 10) + pv;
      await env.DB.put(ck, String(cur), { expirationTtl: 86400 * 400 });
    }
    for (const [k, d] of stats) if (d) await bumpStat(env, k, d);
  } catch (_) { /* 日志失败不影响主流程 */ }
}

async function writeAccessLog(env, request, ctx, status, ms) {
  try {
    const url = new URL(request.url);
    PV_PENDING++;
    const off = String(env.ACCESS_LOG || 'on').toLowerCase() === 'off';
    if (!off && !LOG_SKIP_RE.some((re) => re.test(url.pathname))) {
      const m = clientMeta(request);
      LOG_BUF.push({
        t: nowMs(), ip: m.ip, ua: m.ua, country: m.country, city: m.city, colo: m.colo,
        method: request.method, path: url.pathname, status, ms,
        uid: ctx?.user?.id || null, uname: ctx?.user?.username || null,
      });
    }
    const stale = Date.now() - LOG_LAST_FLUSH >= LOG_FLUSH_MS;
    if (LOG_BUF.length >= LOG_BATCH_MAX || PV_PENDING >= 200
        || (stale && (LOG_BUF.length || PV_PENDING >= 10 || STAT_PENDING.size))) {
      await flushAccessLog(env);
    }
  } catch (_) { /* 日志失败不影响主流程 */ }
}

/* ========================================================================== *
 * 2. 加密：密码哈希 / HMAC / JWT
 * ========================================================================== *
 *  传输安全说明（对应需求「不要明文传密码」）：
 *  ┌ 前端：password → SHA-256(password + ':' + PWD_SALT) → 十六进制  (PWD_SALT='MarytOpens::v1')
 *  │        只把这串 64 位 hex（clientHash）通过 HTTPS 发给后端。
 *  └ 后端：PBKDF2-HMAC-SHA256(clientHash, randomSalt, 100000 次) 后入库。
 *     bootstrap 超管时，后端用 SUPER_ADMIN_PEPPER（='MarytOpens::v1'，与前端 PWD_SALT 一致）做同样的预哈希。
 *  即：网络上不存在明文口令，数据库里也不存在可逆口令。
 * ========================================================================== */

const PBKDF2_ITER = 100000;

async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', te.encode(text));
  return toHex(d);
}

async function hashPassword(clientHash) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', te.encode(clientHash), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' }, key, 256);
  return `pbkdf2$${PBKDF2_ITER}$${b64urlEncode(salt)}$${b64urlEncode(bits)}`;
}

async function verifyPassword(clientHash, stored) {
  try {
    const [scheme, iterStr, saltB64, hashB64] = String(stored || '').split('$');
    if (scheme !== 'pbkdf2') return false;
    const salt = b64urlDecode(saltB64);
    const key = await crypto.subtle.importKey('raw', te.encode(clientHash), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: parseInt(iterStr, 10), hash: 'SHA-256' }, key, 256);
    return timingSafeEqual(b64urlEncode(bits), hashB64);
  } catch { return false; }
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signJWT(payload, secret, ttl) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, iat: nowSec(), exp: nowSec() + ttl, jti: uid() };
  const data = `${b64urlEncode(te.encode(JSON.stringify(header)))}.${b64urlEncode(te.encode(JSON.stringify(body)))}`;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), te.encode(data));
  return `${data}.${b64urlEncode(sig)}`;
}

async function verifyJWT(token, secret) {
  try {
    const [h, p, s] = String(token || '').split('.');
    if (!h || !p || !s) return null;
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlDecode(s), te.encode(`${h}.${p}`));
    if (!valid) return null;
    const payload = JSON.parse(td.decode(b64urlDecode(p)));
    if (payload.exp && payload.exp < nowSec()) return null;
    return payload;
  } catch { return null; }
}

/** 生成一次性签名（用于 OAuth state、邀请链接、下载直链等） */
async function signBlob(env, obj, ttl = 600) {
  const body = b64urlEncode(te.encode(JSON.stringify({ ...obj, exp: nowSec() + ttl })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env.JWT_SECRET), te.encode(body));
  return `${body}.${b64urlEncode(sig)}`;
}

async function readBlob(env, blob) {
  const [body, sig] = String(blob || '').split('.');
  if (!body || !sig) return null;
  const okSig = await crypto.subtle.verify('HMAC', await hmacKey(env.JWT_SECRET), b64urlDecode(sig), te.encode(body));
  if (!okSig) return null;
  const obj = JSON.parse(td.decode(b64urlDecode(body)));
  if (obj.exp && obj.exp < nowSec()) return null;
  return obj;
}

/* ------------------------- 字段级加密（AES-GCM） ------------------------- *
 * 用于加密存储用户绑定 Cloudflare 后拿到的 OAuth 令牌，密钥取自
 * 环境变量 ENCRYPTION_SECRET（未设置时回退到 JWT_SECRET）。令牌仅在
 * 后端代用户调用其 Cloudflare API 时使用，绝不下发到前端。            */
async function aeadKey(env) {
  const sec = String(env.ENCRYPTION_SECRET || env.JWT_SECRET || 'dev-only-secret');
  return crypto.subtle.importKey('raw', te.encode(sec), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
async function encryptText(env, plain) {
  const key = await aeadKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(String(plain)));
  return b64urlEncode(iv) + '.' + b64urlEncode(new Uint8Array(ct));
}
async function decryptText(env, packed) {
  try {
    const [ivb, ctb] = String(packed || '').split('.');
    if (!ivb || !ctb) return null;
    const key = await aeadKey(env);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64urlDecode(ivb) }, key, b64urlDecode(ctb));
    return td.decode(pt);
  } catch { return null; }
}

/* --------------------------------------------------------------------------
 * PawCrypt —— MarytOpens 自研对称加密（用户口令 PBKDF2 派生密钥 + AES-256-GCM）
 *   用于端到端加密（E2EE）内容：密文落库 / 传输，密钥仅由用户掌握（经 MeowSync 本地
 *   代理托管），服务端只持有密文——即便对用户自己而言，没有正确口令 / 设备密钥也解不开。
 * MeowLink —— 自研密文传输信封（协议名符合站点主题）：
 *   meowlink:<v>.<base64url(json({proto,alg,kdf,iter,salt,iv,ct}))>
 * ------------------------------------------------------------------------ */
const PAWCRYPT_ITER = 100000;   // Cloudflare Workers Web Crypto 对 PBKDF2 迭代数的硬上限（非文档说的 1e6）

async function pawcryptDeriveKey(passphrase, salt) {
  const baseKey = await crypto.subtle.importKey('raw', te.encode(String(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PAWCRYPT_ITER, hash: 'SHA-256' },
    baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** 加密：返回 MeowLink 信封字符串（前端亦可同源实现，做到真正的端到端） */
async function pawcryptEncrypt(passphrase, plaintext) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await pawcryptDeriveKey(passphrase, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(String(plaintext))));
  const env = {
    v: 1, proto: 'MeowLink', alg: 'PawCrypt-AES256-GCM', kdf: 'PBKDF2-SHA256',
    iter: PAWCRYPT_ITER, salt: b64urlEncode(salt), iv: b64urlEncode(iv), ct: b64urlEncode(ct),
  };
  return 'meowlink:' + b64urlEncode(te.encode(JSON.stringify(env)));
}

/** 解密：接受 MeowLink 信封；失败（口令错误 / 损坏）返回 null */
async function pawcryptDecrypt(passphrase, packed) {
  try {
    const s = String(packed || '');
    if (!s.startsWith('meowlink:')) return null;
    const env = JSON.parse(td.decode(b64urlDecode(s.slice('meowlink:'.length))));
    if (!env || env.proto !== 'MeowLink' || !env.salt || !env.iv || !env.ct) return null;
    const key = await pawcryptDeriveKey(passphrase, b64urlDecode(env.salt));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64urlDecode(env.iv) }, key, b64urlDecode(env.ct));
    return td.decode(pt);
  } catch { return null; }
}

/** MeowSync 本地代理协议锚点：前端经 localhost 与用户本机 MeowSync 守护进程协商设备密钥，
 *   实现「用户本地加密存储与传输」。本文件只定义协议常量；真实握手见 #215 可下载程序。 */
const MEOWSYNC_PROTOCOL = 'MeowSync/1';


/** S256 PKCE：code_verifier → code_challenge */
async function pkceChallenge(verifier) {
  const d = await crypto.subtle.digest('SHA-256', te.encode(verifier));
  return b64urlEncode(new Uint8Array(d)).replace(/=+$/, '');
}

/* ========================================================================== *
 * 3. KV 数据访问层
 * ========================================================================== *
 *  Key 约定（详见 docs/KV_SCHEMA.md）
 *   user:<id>                        用户主体
 *   ix:email:<sha1email>             → userId
 *   ix:uname:<lower>                 → userId
 *   ix:oauth:<provider>:<pid>        → userId
 *   post:<postId>                    文章主体
 *   ixp:all:<sortableId>             → postId  （全站时间线）
 *   ixp:board:<board>:<sortableId>   → postId
 *   ixp:user:<uid>:<sortableId>      → postId
 *   cmt:<postId>:<sortableId>        评论
 *   ch:<boardId>:<channelId>       频道（挂在版块下）
 *   bd:<boardId>                   版块
 *   role:<scope>:<roleId>            身份组
 *   member:<scope>:<userId>          作用域成员（含角色、禁言到期）
 *   dm:<threadId>:<sortableId>       私信
 *   dmix:<userId>:<threadId>         会话索引
 *   notif:<userId>:<sortableId>      通知
 *   rep:<reportId>                   举报
 *   like:<postId>:<userId>           点赞
 *   fav:<userId>:<postId>            收藏
 *   fol:<followerId>:<targetId>      关注
 *   ban:ip:<ip>                      IP 封禁
 *   cfg:site                         站点配置
 *   vcode:<purpose>:<email>          邮件验证码
 *   bot:<botId>                      机器人
 * ========================================================================== */

const KV = {
  async getJSON(env, key, fallback = null) {
    const v = await env.DB.get(key, 'json');
    return v === null || v === undefined ? fallback : v;
  },
  async putJSON(env, key, value, opts = {}) {
    return env.DB.put(key, JSON.stringify(value), opts);
  },
  async del(env, key) { return env.DB.delete(key); },
  async list(env, prefix, limit = 50, cursor = null) {
    return env.DB.list({ prefix, limit: clamp(limit, 1, 1000), cursor: cursor || undefined });
  },
  /** 批量取值（KV 无 mget，用并发） */
  async many(env, keys) {
    const rs = await Promise.all(keys.map((k) => env.DB.get(k, 'json')));
    return rs.filter(Boolean);
  },
};

// ixp:* 索引键的值是 post id（纯字符串，并非 JSON），KV.many(json) 会解析失败返回 null。
// 这里用文本读取把索引键解析回真实的 post id。修复「文章数量在但文章不见了」的 bug。
async function indexPostIds(env, keys) {
  const rs = await Promise.all(keys.map((k) => env.DB.get(k.name)));
  return rs.filter((v) => typeof v === 'string' && v.length > 0);
}

/**
 * KV 兼容模拟层（#104）：把整站 KV 读写重定向到 D1（kv_store 表），
 * 仅 `file:` 前缀的二进制键（头像/图片）继续走真实 KV（二进制安全）。
 * 这样无需改动任何业务调用点（KV 助手 / env.DB.get|put|delete|list|getWithMetadata）。
 * 调用方在 fetch / scheduled 入口把 env.DB 包成该对象即可。
 */
function makeKV(kv, d1) {
  const isFile = (k) => typeof k === 'string' && k.startsWith('file:');
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const nowSec = () => Math.floor(Date.now() / 1000);
  /**
   * 前缀的字典序上界：把最后一个可自增的码元 +1，得到「紧随该前缀之后的最小字符串」。
   * 于是 `key LIKE 'p%'` 可以改写成 `key >= p AND key < 上界`，
   * 既走得上主键索引，也避开 LIKE 的两个坑：
   *   1) 前缀里的 _ / % 需转义，转义后模式串变长；
   *   2) D1 的 SQLite 对 LIKE 模式长度有上限，长前缀会直接报
   *      「LIKE or GLOB pattern too complex」（私信会话键 dm:<uid>__<uid>: 就是这么炸的）。
   */
  const prefixUpperBound = (p) => {
    const s = String(p || '');
    for (let i = s.length - 1; i >= 0; i--) {
      const c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) continue;   // 代理对高字节不能单独自增
      if (c < 0xffff) return s.slice(0, i) + String.fromCharCode(c + 1);
    }
    return null;                                  // 前缀全为 0xffff，退化为仅下界
  };
  return {
    __moKVShim: true,
    async get(key, type = 'text') {
      if (isFile(key)) return kv.get(key, type);
      const row = await d1.prepare('SELECT value, metadata, expires FROM kv_store WHERE key = ?').bind(key).first();
      if (!row) return null;
      if (row.expires && row.expires <= nowSec()) return null; // 已过期（KV 边缘自动清理的等价语义）
      if (type === 'json') { try { return JSON.parse(row.value); } catch { return null; } }
      if (type === 'arrayBuffer' || type === 'blob' || type === 'stream') return enc.encode(row.value).buffer;
      return row.value;
    },
    async put(key, value, opts = {}) {
      if (isFile(key)) return kv.put(key, value, opts);
      let str;
      if (value instanceof ArrayBuffer || (value && value.constructor && value.constructor.name === 'ArrayBuffer')) {
        str = dec.decode(value);
      } else if (typeof value === 'object' && value !== null) {
        str = JSON.stringify(value);
      } else {
        str = String(value);
      }
      let expires = null;
      if (opts) {
        if (opts.expirationTtl) expires = nowSec() + opts.expirationTtl;
        else if (opts.expiration) expires = opts.expiration;
      }
      const metadata = opts && opts.metadata ? JSON.stringify(opts.metadata) : null;
      await d1.prepare(
        `INSERT INTO kv_store (key, value, expires, metadata)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires=excluded.expires, metadata=excluded.metadata`
      ).bind(key, str, expires, metadata).run();
      return undefined;
    },
    async delete(key) {
      if (isFile(key)) return kv.delete(key);
      await d1.prepare('DELETE FROM kv_store WHERE key = ?').bind(key).run();
      return undefined;
    },
    async list({ prefix = '', limit = 50, cursor = null } = {}) {
      if (isFile(prefix)) return kv.list({ prefix, limit, cursor });
      const L = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 1000);
      const start = cursor ? (parseInt(cursor, 10) || 0) : 0;
      const upper = prefixUpperBound(prefix);
      const rows = upper
        ? await d1.prepare(
            `SELECT key, metadata, expires FROM kv_store
             WHERE key >= ? AND key < ? AND (expires IS NULL OR expires > ?)
             ORDER BY key LIMIT ? OFFSET ?`
          ).bind(prefix, upper, nowSec(), L + 1, start).all()
        : await d1.prepare(
            `SELECT key, metadata, expires FROM kv_store
             WHERE key >= ? AND (expires IS NULL OR expires > ?)
             ORDER BY key LIMIT ? OFFSET ?`
          ).bind(prefix, nowSec(), L + 1, start).all();
      const items = rows.results || [];
      const hasMore = items.length > L;
      const page = hasMore ? items.slice(0, L) : items;
      const keys = page.map((r) => ({
        name: r.key,
        metadata: r.metadata ? JSON.parse(r.metadata) : null,
        expiration: r.expires || undefined,
      }));
      return { keys, list_complete: !hasMore, cursor: hasMore ? String(start + L) : null };
    },
    async getWithMetadata(key, opts = {}) {
      if (isFile(key)) return kv.getWithMetadata(key, opts);
      const row = await d1.prepare('SELECT value, metadata, expires FROM kv_store WHERE key = ?').bind(key).first();
      if (!row) return { value: null, metadata: null };
      if (row.expires && row.expires <= nowSec()) return { value: null, metadata: null };
      const type = opts && opts.type;
      let value = row.value;
      if (type === 'arrayBuffer' || type === 'blob') value = enc.encode(row.value).buffer;
      else if (type === 'json') { try { value = JSON.parse(row.value); } catch { value = null; } }
      return { value, metadata: row.metadata ? JSON.parse(row.metadata) : null };
    },
  };
}

async function emailKey(email) { return `ix:email:${await sha256Hex(String(email).toLowerCase().trim())}`; }
const unameKey = (u) => `ix:uname:${String(u).toLowerCase().trim()}`;
const oauthKey = (p, id) => `ix:oauth:${p}:${id}`;

/* ------------------------------- 站点配置 -------------------------------- */

async function getSiteConfig(env) {
  const saved = await KV.getJSON(env, 'cfg:site', null);
  if (!saved) return structuredClone(DEFAULT_SITE_CONFIG);
  return { ...structuredClone(DEFAULT_SITE_CONFIG), ...saved,
    personal: { ...DEFAULT_SITE_CONFIG.personal, ...(saved.personal || {}) },
    seo: { ...DEFAULT_SITE_CONFIG.seo, ...(saved.seo || {}) } };
}

async function saveSiteConfig(env, cfg) { await KV.putJSON(env, 'cfg:site', cfg); return cfg; }

/* --------------------------------- 用户 ---------------------------------- */

/**
 * 用户对象结构
 * {
 *   id, username, displayName, email, emailVerified, password,
 *   avatar, banner, bio, locale, timeFormat, theme,
 *   links: [{platform,label,url}],
 *   roles: { 'global': ['role_xxx'], 'channel:abc': ['role_yyy'] },
 *   flags: { banned, bannedReason, bannedUntil, mutedUntil, shadow },
 *   oauth: { github:{id,login}, discord:{id,username} },
 *   stats: { posts, comments, likes, followers, following },
 *   createdAt, lastLoginAt, lastIP, tokenVersion
 * }
 */
async function getUser(env, id) { return KV.getJSON(env, `user:${id}`); }

async function saveUser(env, u) { await KV.putJSON(env, `user:${u.id}`, u); return u; }

/**
 * 审核日志：记录「谁(actor) 在何时 做了什么(action) 作用于谁/什么(target)」。
 * 以 `audit:<倒序时间戳>:<id>` 为键写入 KV，便于按前缀列出最新记录。
 * 写入失败不影响主流程（仅打日志）。
 */
async function writeAudit(env, actor, action, target, detail) {
  try {
    const ts = nowMs();
    const id = uid('a');
    const key = `audit:${String(9999999999999 - ts).padStart(13, '0')}:${id}`;
    const rec = {
      id, ts,
      actorId: actor?.id || 'system',
      actorName: actor?.displayName || actor?.username || 'system',
      actorIsSuper: !!(actor && (actor.__isSuper || actor.isSuperAdmin)),
      action: String(action || ''),
      target: target ? String(target) : '',
      detail: detail ? String(detail).slice(0, 500) : '',
    };
    await KV.putJSON(env, key, rec);
    return rec;
  } catch (e) { console.error('[audit] write failed', e); }
}


async function findUserByEmail(env, email) {
  const id = await env.DB.get(await emailKey(email));
  return id ? getUser(env, id) : null;
}
async function findUserByUsername(env, username) {
  const id = await env.DB.get(unameKey(username));
  return id ? getUser(env, id) : null;
}
async function findUserByOAuth(env, provider, pid) {
  const id = await env.DB.get(oauthKey(provider, pid));
  return id ? getUser(env, id) : null;
}

/** 对外暴露的公开用户视图（绝不外泄 password / email / IP） */
/**
 * 把用户保存的 connections 列表规整为对外公开形态。
 * domain 类型含私有校验 token，仅本人/超管可见；其余人只看 verified/autoAdded 状态。
 */
function publicConnections(conns, isSelf, isAdmin) {
  if (!Array.isArray(conns)) return [];
  return conns.map((c) => {
    if (!c || typeof c !== 'object') return null;
    const base = {
      type: c.type === 'domain' ? 'domain' : 'link',
      label: String(c.label || '').slice(0, 40),
      url: /^https?:\/\//i.test(c.url || '') ? String(c.url).slice(0, 500) : '',
    };
    if (base.type === 'link') {
      base.platform = LINK_PLATFORMS.includes(String(c.platform)) ? String(c.platform) : 'website';
      return base;
    }
    // domain 类型
    base.domain = String(c.domain || '').slice(0, 120);
    base.note = String(c.note || '').slice(0, 120);
    base.verified = !!c.verified;
    base.autoAdded = !!c.autoAdded;
    if (isSelf || isAdmin) {
      base.token = String(c.token || '').slice(0, 120);
      base.status = c.status || (base.verified ? 'verified' : 'pending');
    }
    return base;
  }).filter(Boolean);
}

function publicUser(u, viewer = null, extra = {}) {
  if (!u) return null;
  const self = viewer && viewer.id === u.id;
  const isAdmin = viewer && viewer.__isSuper;
  // 在线态取自内存 Presence（零 KV）；隐身用户对外一律呈现为离线，但自己/超管可见真实值
  const pr = presenceOf(u.id);
  const rawStatus = USER_STATUSES.includes(u.status) ? u.status : 'online';
  return {
    online: self ? true : pr.online,
    status: (self || isAdmin) ? rawStatus : pr.status,
    statusText: (self || isAdmin || pr.online) ? String(u.statusText || '').slice(0, 40) : '',
    id: u.id,
    username: u.username,
    displayName: u.displayName || u.username,
    avatar: u.avatar || '',
    banner: u.banner || '',
    bio: u.bio || '',
    links: u.links || [],
    // 新版主页扩展字段
    playingNow: u.playingNow && !u.playingNow.hidden ? {
      app: String(u.playingNow.app || '').slice(0, 64),
      name: String(u.playingNow.name || u.playingNow.app || '').slice(0, 40),
      icon: /^https?:\/\//i.test(u.playingNow.icon || '') ? String(u.playingNow.icon).slice(0, 500)
           : (typeof u.playingNow.icon === 'string' && u.playingNow.icon.startsWith('/') ? u.playingNow.icon.slice(0, 200) : ''),
      level: Number.isFinite(+u.playingNow.level) ? Math.max(0, Math.min(9999, +u.playingNow.level)) : null,
      uid: u.playingNow.uid ? String(u.playingNow.uid).slice(0, 40) : '',
      playtimeMin: Number.isFinite(+u.playingNow.playtimeMin) ? Math.max(0, Math.min(100000000, Math.floor(+u.playingNow.playtimeMin))) : null,
      sessionStart: Number.isFinite(+u.playingNow.sessionStart) ? +u.playingNow.sessionStart : null,
      updatedAt: Number.isFinite(+u.playingNow.updatedAt) ? +u.playingNow.updatedAt : null,
    } : null,
    wishlist: Array.isArray(u.wishlist) ? u.wishlist.slice(0, 60).map((w) => ({
      id: String(w.id || uid('w')).slice(0, 32),
      title: String(w.title || '').slice(0, 80),
      url: /^https?:\/\//i.test(w.url || '') ? String(w.url).slice(0, 500) : '',
      cover: /^https?:\/\//i.test(w.cover || '') ? String(w.cover).slice(0, 500) : '',
      note: String(w.note || '').slice(0, 200),
      addedAt: Number.isFinite(+w.addedAt) ? +w.addedAt : nowMs(),
    })) : [],
    gameCards: Array.isArray(u.gameCards) ? u.gameCards.slice(0, 60).map((g) => ({
      id: String(g.id || uid('g')).slice(0, 32),
      title: String(g.title || '').slice(0, 80),
      cover: /^https?:\/\//i.test(g.cover || '') ? String(g.cover).slice(0, 500) : '',
      note: String(g.note || '').slice(0, 200),
      links: Array.isArray(g.links) ? g.links.slice(0, 6).map((l) => ({
        label: String(l.label || '').slice(0, 40),
        url: /^https?:\/\//i.test(l.url || '') ? String(l.url).slice(0, 300) : '',
      })).filter((l) => l.url) : [],
    })) : [],
    connections: publicConnections(u.connections, self, isAdmin),
    stats: u.stats || {},
    roleTags: extra.roleTags || [],
    official: !!u.official,
    isSuperAdmin: !!(u.roles?.global || []).includes('role_super_admin'),
    avatarFrame: u.avatarFrame || '',
    avatarFrames: Array.isArray(u.avatarFrames) ? u.avatarFrames : [],
    badges: Array.isArray(u.badges) ? u.badges : [],
    // 称号 / 等级 / 装扮：公开可见（昵称旁展示），非白名单样式一律丢弃
    title: equippedTitleOf(u),
    level: levelFromMeow(u.economy?.meow).level,
    customLevel: u.customLevel || null,            // 超管指定的专属（Markdown）等级，覆盖数值等级展示
    cardStyle: CARD_CLASSES.includes(u.cardStyle) ? u.cardStyle : '',
    bubbleStyle: BUBBLE_CLASSES.includes(u.bubbleStyle) ? u.bubbleStyle : '',
    giftStats: u.giftStats || { count: 0, mo: 0 },
    createdAt: u.createdAt,
    banned: !!u.flags?.banned,
    mutedUntil: u.flags?.mutedUntil || 0,
    ...(self || isAdmin ? {
      email: u.email, emailVerified: !!u.emailVerified,
      forceVerify: !!u.flags?.forceVerify,
      locale: u.locale, theme: u.theme, timeFormat: u.timeFormat,
      oauth: { github: !!u.oauth?.github, discord: !!u.oauth?.discord },
      notifySettings: u.notifySettings || {},
      // 仅本人/超管可见「持有清单」，用于装扮切换界面
      titles: (Array.isArray(u.titles) ? u.titles : []).filter((t) => !t.expiresAt || t.expiresAt > nowMs()),
      cardStyles: Array.isArray(u.cardStyles) ? u.cardStyles : [],
      bubbleStyles: Array.isArray(u.bubbleStyles) ? u.bubbleStyles : [],
    } : {}),
    ...(isAdmin ? { lastIP: u.lastIP, lastLoginAt: u.lastLoginAt, rolesRaw: u.roles } : {}),
  };
}

function newUserSkeleton({ id, username, email }) {
  return {
    id, username,
    displayName: username,
    email: email || '',
    emailVerified: false,
    password: '',
    avatar: '', banner: '', bio: '',
    locale: '', timeFormat: 'auto', theme: 'auto',
    status: 'online', statusText: '',
    links: [],
    // ---- 新版个人主页（Discord 式）扩展字段 ----
    playingNow: null,                 // 桌面插件写入的「正在玩」：{app,name,icon,level,uid,playtimeMin,sessionStart,hidden}
    wishlist: [],                     // 愿望单：[{id,title,url,cover,note,addedAt}]
    gameCards: [],                    // 游戏卡片：[{id,title,cover,links:[{label,url}],note}]
    connections: [],                  // 富连接展示：[{type:'link'|'domain', ..., (domain) token/verified/autoAdded}]
    roles: { global: ['role_member'] },
    flags: { banned: false, bannedReason: '', bannedUntil: 0, bannedAt: 0, mutedUntil: 0 },
    oauth: {},
    permGrants: [],                 // 超级管理员按作用域单独授予的权限 [{perm, scope}]
    economy: { mo: 0, meow: 0, checkin: { last: 0, streak: 0, count: 0, days: [] } }, // 货币 MO值 / 等级 Meow值 / 签到
    vouchers: [],                   // 持有券：加速券 / 经验加成券 / 装扮券 / 补签卡 等
    // ---- 装扮与身份外观（均为「持有列表 + 当前佩戴」双字段，样式类名走白名单） ----
    titles: [], title: '',          // 称号：可同时持有多个，只佩戴一个（显示在昵称旁）
    cardStyles: [], cardStyle: '',  // 名片装扮（个人主页卡片背景）
    bubbleStyles: [], bubbleStyle: '', // 消息气泡皮肤（聊天/私信）
    giftsReceived: [],              // 收到的礼物墙（倒序，最多保留 100 条）
    giftStats: { count: 0, mo: 0 }, // 累计收礼数量 / 累计收礼折算 MO
    purchases: [],                  // 商城购买记录（同时用于限购判定）
    stats: { posts: 0, comments: 0, likes: 0, followers: 0, following: 0 },
    notifySettings: { like: true, comment: true, follow: true, dm: true, mail: true },
    createdAt: nowMs(), lastLoginAt: 0, lastIP: '', tokenVersion: 1,
  };
}

/* ------------------------------ 身份组 / 成员 ----------------------------- */

const scopeKeyOf = (scope) => String(scope || 'global').replace(/[^\w:.-]/g, '');

async function getRole(env, scope, roleId) { return KV.getJSON(env, `role:${scopeKeyOf(scope)}:${roleId}`); }

async function listRoles(env, scope) {
  const pre = `role:${scopeKeyOf(scope)}:`;
  const { keys } = await KV.list(env, pre, 200);
  const roles = await KV.many(env, keys.map((k) => k.name));
  return roles.sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

async function saveRole(env, role) {
  await KV.putJSON(env, `role:${scopeKeyOf(role.scope)}:${role.id}`, role);
  return role;
}

/** 为某作用域落地预设身份组（同名系统身份组会同步到最新模板定义） */
async function seedRoles(env, scope, templates) {
  const out = [];
  for (const key of templates) {
    const t = ROLE_TEMPLATES[key];
    if (!t) continue;
    const id = `role_${key}`;
    const exist = await getRole(env, scope, id);
    if (exist) {
      // 系统模板升级（如层级调整、权限增删）：同名系统身份组自动刷新定义
      if (exist.system && (exist.name !== t.name || exist.priority !== t.priority
          || JSON.stringify(exist.perms || []) !== JSON.stringify(t.perms))) {
        out.push(await saveRole(env, { ...exist, name: t.name, color: t.color, priority: t.priority, perms: [...t.perms] }));
      } else out.push(exist);
      continue;
    }
    out.push(await saveRole(env, {
      id, scope: scopeKeyOf(scope), key, name: t.name, color: t.color,
      priority: t.priority, perms: [...t.perms], system: true,
      hoist: true, mentionable: true, createdAt: nowMs(),
    }));
  }
  return out;
}

async function getMember(env, scope, userId) {
  return KV.getJSON(env, `member:${scopeKeyOf(scope)}:${userId}`);
}

/** 区域内显示身份（仅该区域可见的昵称/头像），不改用户主页。父作用域继承（频道→版块）。 */
async function areaIdentity(env, scope, userId) {
  for (const sc of scopeChain(scope)) {
    if (sc === 'global') break;
    const m = await getMember(env, sc, userId);
    if (m && (m.nickname || m.avatar)) return { nickname: m.nickname || '', avatar: m.avatar || '', bio: m.bio || '', banner: m.banner || '' };
  }
  return null;
}

async function saveMember(env, scope, userId, data) {
  const rec = { userId, scope: scopeKeyOf(scope), joinedAt: nowMs(), roles: [], mutedUntil: 0, nickname: '', ...data };
  await KV.putJSON(env, `member:${scopeKeyOf(scope)}:${userId}`, rec, { metadata: { u: userId } });
  return rec;
}

/* ========================================================================== *
 * 4. 权限引擎
 * ========================================================================== *
 *  解析顺序：
 *   1) 用户 flags.banned → 一切拒绝（除只读接口由上层拦截）
 *   2) 全局角色包含 site.admin → 全通过
 *   3) 收集 全局角色权限 ∪ 目标作用域角色权限 ∪ 父作用域权限（频道 → 群/板块继承）
 *   4) 命中 perm 或 命中通配（如 'post.*'）即通过
 * ========================================================================== */

/** 作用域链：'channel:bd1:c2' → ['channel:bd1:c2','board:bd1','global']
 *  层级：版块(board) ⊃ 频道(channel)。版主的权限沿链向下覆盖频道，频道主仅管本频道。 */
function scopeChain(scope) {
  const s = scopeKeyOf(scope);
  if (!s || s === 'global') return ['global'];
  const parts = s.split(':');
  const chain = [s];
  if (parts[0] === 'channel' && parts.length >= 3) chain.push(`board:${parts[1]}`);
  chain.push('global');
  return [...new Set(chain)];
}

async function collectPerms(env, user, scope) {
  if (!user) return new Set();
  const perms = new Set();
  const chain = scopeChain(scope);
  for (const sc of chain) {
    const ids = new Set([...(user.roles?.[sc] || [])]);
    const mem = sc === 'global' ? null : await getMember(env, sc, user.id);
    for (const r of mem?.roles || []) ids.add(r);
    if (sc !== 'global' && !mem && !(user.roles?.[sc]?.length)) continue;
    for (const rid of ids) {
      const role = await getRole(env, sc, rid);
      if (!role) continue;
      // 角色级「按作用域授权」：若某权限被限制到特定 scope，则只在该 scope 链内生效
      const scoped = role.permScopes || {};
      for (const p of role.perms || []) {
        const allow = scoped[p];
        if (!allow || !allow.length) { perms.add(p); continue; }
        if (allow.includes(sc) || allow.some((a) => chain.includes(a))) perms.add(p);
      }
    }
  }
  // 用户级「按作用域授权」：超级管理员可为单个用户单独授予某权限，并限定到某个作用域
  for (const g of user.permGrants || []) {
    if (!g || !g.perm) continue;
    if (g.scope === 'global' || !g.scope || chain.includes(g.scope)) perms.add(g.perm);
  }
  return perms;
}

async function isSuperAdmin(env, user) {
  if (!user) return false;
  if (user.__isSuper !== undefined) return user.__isSuper;
  const ids = user.roles?.global || [];
  if (ids.includes('role_super_admin')) { user.__isSuper = true; return true; }
  const perms = await collectPerms(env, user, 'global');
  user.__isSuper = perms.has('site.admin');
  return user.__isSuper;
}

async function hasPerm(env, user, perm, scope = 'global') {
  if (!user) return false;
  if (user.flags?.banned) return false;
  if (await isSuperAdmin(env, user)) return true;
  const perms = await collectPerms(env, user, scope);
  if (perms.has(perm)) return true;
  const group = perm.split('.')[0];
  return perms.has(`${group}.*`) || perms.has('*');
}

async function requirePerm(env, user, perm, scope = 'global') {
  if (!(await hasPerm(env, user, perm, scope))) forbid(`缺少权限：${PERMISSIONS[perm]?.label || perm}（作用域 ${scope}）`);
}

async function isMuted(env, user, scope = 'global') {
  if (!user) return true;
  if ((user.flags?.mutedUntil || 0) > nowMs()) return true;
  if (scope !== 'global') {
    const m = await getMember(env, scope, user.id);
    if ((m?.mutedUntil || 0) > nowMs()) return true;
  }
  return false;
}

/** 取用户在某作用域内可展示的身份组标签 */
async function roleTagsOf(env, user, scope = 'global') {
  const tags = [];
  if (user && user.official) {
    tags.push({ id: 'role:official', key: 'official', name: '官方认证', color: '#2563eb', scope: 'global', official: true });
  }
  // 内置「官方」身份组：超级管理员 / 站点管理员自动拥有，且不可被卸下或赋予
  // （由角色判定，不写入 user.roles，因此任何角色/委员管理界面都无法移除或授予）
  if (user && (user.roles?.global || []).some((r) => r === 'role_super_admin' || r === 'role_admin')) {
    tags.push({ id: 'role:staff', key: 'staff', name: '官方', color: '#7c3aed', scope: 'global', builtin: true, locked: true });
  }
  for (const sc of scopeChain(scope)) {
    const ids = new Set(user.roles?.[sc] || []);
    const mem = sc === 'global' ? null : await getMember(env, sc, user.id);
    for (const r of mem?.roles || []) ids.add(r);
    for (const rid of ids) {
      const role = await getRole(env, sc, rid);
      if (role && role.hoist !== false) {
        // 用户自己上传的图标仅自己生效；否则用身份组图标
        const override = user?.roleIconOverrides?.[role.id];
        tags.push({ id: role.id, key: role.key || '', name: role.name, color: role.color, scope: sc, icon: override || role.icon || '' });
      }
    }
  }
  return tags.slice(0, 6);
}

/* ========================================================================== *
 * 5. 外部服务：Turnstile / Cloud Mail / OAuth / Cloudflare API
 * ========================================================================== */

/** 判断某个配置项是否被「真正配置」过。
 *  wrangler.toml 里的公开变量出厂时是中文占位符（如 "在此填入_GITHUB_CLIENT_ID"），
 *  它们是非空字符串，用 !!v 判断会误判为已配置，导致前端渲染出用假 Site Key 的
 *  Turnstile 组件或点了就报错的 OAuth 按钮，进而卡住登录/注册流程。 */
function isConfigured(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return false;
  return !/在此填入|填入你的|^your[_-]|^<.+>$|^x{3,}$|_SITEKEY$|^0x4AAAAAAA_/i.test(s);
}

/** Cloudflare Turnstile 人机验证
 *  密钥优先取后台配置 cfg.turnstile（由超级管理员在后台设置），缺失时回退到 Worker 环境变量。 */
async function verifyTurnstile(env, token, ip, cfg) {
  const ts = (cfg && cfg.turnstile) || {};
  const enabled = ts.enabled === true || String(env.TURNSTILE_ENABLED) === 'true';
  const secret = ts.secret || env.TURNSTILE_SECRET || '';
  if (!enabled) return { success: true, skipped: true };
  if (!secret) return { success: true, skipped: true, reason: 'no-secret' };
  if (!token) return { success: false, reason: 'missing-token' };
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const d = await r.json();
    return { success: !!d.success, codes: d['error-codes'] || [] };
  } catch (e) {
    return { success: false, reason: 'network', detail: String(e) };
  }
}

async function guardTurnstile(env, request, token, feature) {
  const cfg = await getSiteConfig(env);
  const need = { login: cfg.turnstileOnLogin, register: cfg.turnstileOnRegister, post: cfg.turnstileOnPost }[feature];
  if (need === false) return;
  const r = await verifyTurnstile(env, token, clientIP(request), cfg);
  if (!r.success) bad('人机验证未通过，请重试', 'TURNSTILE_FAILED');
}

/* -------------------------------- 邮件发送 -------------------------------- */

function mailTemplate(cfg, { title, body, code, locale = 'zh-CN' }) {
  const accent = cfg.accent || '#6366f1';
  const codeBlock = code ? `
    <div style="margin:28px 0;text-align:center">
      <div style="display:inline-block;font-size:34px;letter-spacing:10px;font-weight:700;
                  color:${accent};background:#f1f5f9;border-radius:14px;padding:16px 28px;
                  font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(code)}</div>
      <p style="color:#64748b;font-size:13px;margin-top:12px">
        ${locale.startsWith('zh') ? '验证码 10 分钟内有效，请勿转发他人。' : 'Valid for 10 minutes. Do not share.'}
      </p>
    </div>` : '';
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;padding:32px 16px;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'PingFang SC','Microsoft YaHei',sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:18px;overflow:hidden;
                box-shadow:0 10px 40px rgba(15,23,42,.08);border:1px solid #e2e8f0">
      <div style="background:linear-gradient(135deg,${accent},#8b5cf6);padding:26px 30px">
        <div style="color:#fff;font-size:19px;font-weight:700;letter-spacing:.4px">${escapeHtml(cfg.siteTitle)}</div>
        <div style="color:rgba(255,255,255,.82);font-size:12px;margin-top:4px">${escapeHtml(cfg.siteSubtitle || '')}</div>
      </div>
      <div style="padding:30px">
        <h1 style="margin:0 0 14px;font-size:19px;color:#0f172a">${escapeHtml(title)}</h1>
        <div style="color:#475569;font-size:14px;line-height:1.75">${body}</div>
        ${codeBlock}
        <p style="color:#94a3b8;font-size:12px;margin-top:26px;border-top:1px solid #f1f5f9;padding-top:16px">
          此邮件由系统自动发送，请勿直接回复。<br/>MarytOpens | MarytTeam © 2026
        </p>
      </div>
    </div></body></html>`;
}

/**
 * 多后端发信适配器
 *  - cloudmail    : 自建 cloud-mail（POST JSON + Bearer）
 *  - resend       : api.resend.com
 *  - mailchannels : Workers 免费通道
 *  - console      : 只打日志（本地调试）
 */
// 邮件设置来源优先级：后台站点配置 cfg.mail > Worker 环境变量（env）
// 这样站长可在「后台管理 → 邮件服务」里直接填 Resend API Key，无需改 wrangler.toml
async function sendMail(env, { to, subject, html, text }, cfg) {
  const m = (cfg && cfg.mail) || {};
  const provider = (m.provider || env.MAIL_PROVIDER || 'console').toLowerCase();
  const from = m.from || env.MAIL_FROM || 'MarytOpens <no-reply@localhost>';
  const token = m.apiToken || env.MAIL_API_TOKEN || '';
  const apiUrl = m.apiUrl || env.MAIL_API_URL || '';
  const payloadText = text || html?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  try {
    if (provider === 'console') {
      console.log('[MAIL:console]', to, subject, payloadText?.slice(0, 200));
      return { ok: true, provider: 'console' };
    }
    if (!token && provider !== 'mailchannels') {
      return { ok: false, provider, error: '邮件服务未配置 API Token：请在后台「邮件服务」中填写 Resend API Key（re_ 开头）' };
    }
    if (provider === 'cloudmail') {
      const r = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ from, to, subject, html, text: payloadText }),
      });
      const body = await r.text();
      return { ok: r.ok, provider, status: r.status, body: body.slice(0, 400) };
    }
    if (provider === 'resend') {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ from, to: [to], subject, html }),
      });
      return { ok: r.ok, provider, status: r.status, body: (await r.text()).slice(0, 400) };
    }
    if (provider === 'mailchannels') {
      const mm = /<(.+)>/.exec(from);
      const addr = mm ? mm[1] : from;
      const r = await fetch('https://api.mailchannels.net/tx/v1/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: addr, name: env.SITE_NAME || 'MarytOpens' },
          subject, content: [{ type: 'text/html', value: html }],
        }),
      });
      return { ok: r.ok, provider, status: r.status, body: (await r.text()).slice(0, 400) };
    }
    return { ok: false, provider, error: 'unknown provider' };
  } catch (e) {
    console.error('[MAIL:error]', String(e));
    return { ok: false, provider, error: String(e) };
  }
}

async function issueEmailCode(env, email, purpose) {
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
  await KV.putJSON(env, `vcode:${purpose}:${String(email).toLowerCase()}`,
    { code, tries: 0, createdAt: nowMs() }, { expirationTtl: 600 });
  return code;
}

async function consumeEmailCode(env, email, purpose, code) {
  const key = `vcode:${purpose}:${String(email).toLowerCase()}`;
  const rec = await KV.getJSON(env, key);
  if (!rec) return false;
  if (rec.tries >= 5) { await KV.del(env, key); return false; }
  if (!timingSafeEqual(String(rec.code), String(code || ''))) {
    await KV.putJSON(env, key, { ...rec, tries: rec.tries + 1 }, { expirationTtl: 600 });
    return false;
  }
  await KV.del(env, key);
  return true;
}

/* --------------------------------- OAuth --------------------------------- */

const OAUTH = {
  github: {
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    idKey: 'GITHUB_CLIENT_ID', secretKey: 'GITHUB_CLIENT_SECRET',
    async profile(accessToken) {
      const h = { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'MarytOpens', Accept: 'application/vnd.github+json' };
      const u = await (await fetch('https://api.github.com/user', { headers: h })).json();
      let email = u.email;
      if (!email) {
        const list = await (await fetch('https://api.github.com/user/emails', { headers: h })).json();
        email = Array.isArray(list) ? (list.find((e) => e.primary && e.verified) || list[0])?.email : null;
      }
      return { pid: String(u.id), username: u.login, displayName: u.name || u.login,
               avatar: u.avatar_url, email, profileUrl: u.html_url };
    },
  },
  discord: {
    authorize: 'https://discord.com/api/oauth2/authorize',
    token: 'https://discord.com/api/oauth2/token',
    scope: 'identify email',
    idKey: 'DISCORD_CLIENT_ID', secretKey: 'DISCORD_CLIENT_SECRET',
    async profile(accessToken) {
      const u = await (await fetch('https://discord.com/api/users/@me',
        { headers: { Authorization: `Bearer ${accessToken}` } })).json();
      const avatar = u.avatar
        ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=256`
        : `https://cdn.discordapp.com/embed/avatars/${(Number(u.discriminator || 0) % 5)}.png`;
      return { pid: String(u.id), username: u.username, displayName: u.global_name || u.username,
               avatar, email: u.email, profileUrl: `https://discord.com/users/${u.id}` };
    },
  },
  // Cloudflare 绑定（数据主权）：用户用自有 CF 账号授权，系统在其账号下建 KV+D1
  cloudflare: {
    authorize: 'https://dash.cloudflare.com/oauth2/auth',
    token: 'https://dash.cloudflare.com/oauth2/token',
    scope: 'account:read workers_kv_storage:edit d1:edit zone:read dns_records:edit',
    idKey: 'CF_OAUTH_CLIENT_ID', secretKey: 'CF_OAUTH_CLIENT_SECRET',
  },
};

/** 取 OAuth 有效凭证：后台设置的优先，未设置时回落到 Worker 环境变量 */
async function oauthCreds(env, provider) {
  const cfg = OAUTH[provider];
  if (!cfg) return { clientId: '', clientSecret: '' };
  const site = await getSiteConfig(env);
  const saved = (site.oauth && site.oauth[provider]) || {};
  return {
    clientId: (saved.clientId && isConfigured(saved.clientId)) ? saved.clientId : (env[cfg.idKey] || ''),
    clientSecret: (saved.clientSecret && String(saved.clientSecret).trim()) ? saved.clientSecret : (env[cfg.secretKey] || ''),
  };
}

async function oauthExchange(env, provider, code, redirectUri) {
  const cfg = OAUTH[provider];
  const creds = await oauthCreds(env, provider);
  const body = new URLSearchParams({
    client_id: creds.clientId, client_secret: creds.clientSecret,
    code, grant_type: 'authorization_code', redirect_uri: redirectUri,
  });
  const r = await fetch(cfg.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  const d = await r.json();
  if (!d.access_token) bad(`OAuth 换取令牌失败：${d.error_description || d.error || 'unknown'}`, 'OAUTH_FAILED');
  return d.access_token;
}

/* ---------------------------- Cloudflare API ------------------------------ */

async function cfApi(env, path, init = {}) {
  if (!env.CF_API_TOKEN) bad('未配置 CF_API_TOKEN', 'CF_NOT_CONFIGURED');
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  return r.json();
}

/* ========================================================================== *
 * 6. 中间件：鉴权、IP 封禁、上下文
 * ========================================================================== */

function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function sessionCookie(token, env, maxAge) {
  const attrs = [
    `mo_session=${encodeURIComponent(token)}`,
    'Path=/', 'HttpOnly', 'Secure', 'SameSite=None',
    `Max-Age=${maxAge}`,
  ];
  return attrs.join('; ');
}

async function authenticate(request, env) {
  const bearer = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const token = bearer || readCookie(request, 'mo_session');
  if (!token) return null;
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload?.sub) return null;
  const user = await getUser(env, payload.sub);
  if (!user) return null;
  if ((user.tokenVersion || 1) !== (payload.ver || 1)) return null;   // 强制下线
  user.__token = token;
  return user;
}

async function checkIPBan(env, ip) {
  const rec = await KV.getJSON(env, `ban:ip:${ip}`);
  if (!rec) return null;
  if (rec.until && rec.until < nowMs()) { await KV.del(env, `ban:ip:${ip}`); return null; }
  return rec;
}

/* ========================================================================== *
 * 7. 路由器
 * ========================================================================== */

class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:[A-Za-z_]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; })
      .replace(/\*/g, '(.*)') + '$');
    this.routes.push({ method, re, keys, handler });
    return this;
  }
  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  patch(p, h) { return this.add('PATCH', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(pathname);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      if (!r.keys.length && m[1] !== undefined) params.wild = m[1];
      return { handler: r.handler, params };
    }
    return null;
  }
}

const router = new Router();

async function readBody(request) {
  const ct = request.headers.get('Content-Type') || '';
  if (ct.includes('application/json')) { try { return await request.json(); } catch { return {}; } }
  if (ct.includes('form')) { const f = await request.formData(); return Object.fromEntries(f.entries()); }
  return {};
}

/* ========================================================================== *
 * 8. 业务路由 —— 元信息 & 站点配置
 * ========================================================================== */

router.get('/api/meta', async (ctx) => {
  const { env, request } = ctx;
  const cfg = await getSiteConfig(env);
  const ts = cfg.turnstile || {};
  const tsEnabled = ts.enabled === true || String(env.TURNSTILE_ENABLED) === 'true';
  // 只认「真正配置过」的 Site Key，占位符一律视为未配置，避免前端渲染出无法通过的人机验证
  const tsKeyRaw = isConfigured(ts.siteKey) ? ts.siteKey
    : (isConfigured(env.TURNSTILE_SITE_KEY) ? env.TURNSTILE_SITE_KEY : '');
  const tsSiteKey = tsEnabled ? tsKeyRaw : '';
  return ok({
    version: VERSION,
    locale: negotiateLocale(request),
    supportedLocales: SUPPORTED_LOCALES,
    turnstileSiteKey: tsSiteKey,
    turnstile: {
      enabled: tsEnabled && !!tsSiteKey,
      login: cfg.turnstileOnLogin, register: cfg.turnstileOnRegister, post: cfg.turnstileOnPost,
    },
    e2ee: {
      enabled: true,
      proto: 'MeowLink',
      cipher: 'PawCrypt',
      meowsync: MEOWSYNC_PROTOCOL,
      note: '端到端加密（PawCrypt）+ 阅后即焚；密钥仅由用户掌握，服务端只存密文',
    },
    oauth: {
      github: cfg.allowGithubLogin && isConfigured((await oauthCreds(env, 'github')).clientId),
      discord: cfg.allowDiscordLogin && isConfigured((await oauthCreds(env, 'discord')).clientId),
    },
    mail: {
      provider: (cfg.mail && cfg.mail.provider) || env.MAIL_PROVIDER || 'console',
      configured: ((cfg.mail && cfg.mail.provider) || env.MAIL_PROVIDER || 'console') === 'mailchannels'
        ? true
        : !!( (cfg.mail && cfg.mail.apiToken) || env.MAIL_API_TOKEN ),
      from: (cfg.mail && cfg.mail.from) || env.MAIL_FROM || '',
    },
    site: await (async () => {
      const s = pick(cfg, ['siteTitle','siteSubtitle','favicon','logo','landingMode','loginBackground',
        'loginBackgroundBlur','themeDefault','accent','theme','emojis','tips','allowExternalEmoji',
        'registerOpen','footerText','footerAlign','navLinks',
        'announcement','links','personal','about','contributors','announcements','seo','feedback','contact']);
      // 仅当配置了「意见反馈」弹窗时才解析官方账号用户名（用于弹窗跳转其主页），避免无谓读取
      if (cfg.feedback && (cfg.feedback.markdown || cfg.feedback.email)) {
        try { const oa = await getOfficialAccount(env); if (oa) s.officialUsername = oa.username; } catch (e) { /* ignore */ }
      }
      return s;
    })(),
    stats: {
      users: await readStat(env, 'users'),
      posts: await readStat(env, 'posts'),
      comments: await readStat(env, 'comments'),
      ...(await countCommunity(env)),
      ...presenceStats(),   // online / members / guests：纯内存，不消耗 KV
    },
    serverTime: nowMs(),
  }, ctx);
});

router.get('/api/health', async (ctx) => ok({ status: 'healthy', version: VERSION, time: nowMs() }, ctx));

/* ------------------------------ MeowChat 零知识中继端点 ------------------------------ */
router.post('/api/mc/:roomId', async (ctx) => {
  const { env } = ctx;
  if (!env.DB1) return fail(503, 'NO_D1', '本站未启用 D1，无法提供 MeowChat 中继', ctx);
  const { roomId } = ctx.params;
  const body = await ctx.request.json().catch(() => null);
  if (!body || typeof body !== 'object') return fail(400, 'BAD_BODY', '请求体必须是 JSON', ctx);
  if (body.proto !== 'MeowChat/1' || !body.seq || !body.salt || !body.iv || !body.ct || !body.pub || !body.sig) {
    return fail(400, 'BAD_ENVELOPE', '信封字段不完整', ctx);
  }
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(roomId)) return fail(400, 'BAD_ROOM', '房间号格式错误', ctx);
  const id = 'mc_' + Array.from(crypto.getRandomValues(new Uint8Array(12))).map((b) => b.toString(36).padStart(2, '0')).join('');
  const seq = Math.max(0, parseInt(body.seq, 10) || 0);
  const now = Date.now();
  try {
    await env.DB1.prepare('INSERT INTO meowchat_messages (id, room_id, seq, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, roomId, seq, JSON.stringify(body), now).run();
  } catch (e) {
    return fail(500, 'STORE_FAILED', '消息存储失败', ctx);
  }
  return ok({ ok: true, id, ts: now }, ctx);
});

router.get('/api/mc/:roomId', async (ctx) => {
  const { env } = ctx;
  if (!env.DB1) return fail(503, 'NO_D1', '本站未启用 D1', ctx);
  const { roomId } = ctx.params;
  const since = Math.max(0, parseInt(ctx.url.searchParams.get('since') || '0', 10));
  const limit = Math.min(Math.max(parseInt(ctx.url.searchParams.get('limit') || '100', 10), 1), 200);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(roomId)) return fail(400, 'BAD_ROOM', '房间号格式错误', ctx);
  try {
    const rows = await env.DB1.prepare('SELECT seq, payload FROM meowchat_messages WHERE room_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?')
      .bind(roomId, since, limit).all();
    const items = ((rows && rows.results) || []).map((r) => ({ ...(JSON.parse(r.payload)), seq: r.seq }));
    const cursor = items.reduce((m, i) => Math.max(m, i.seq || 0), since);
    return ok({ items, cursor }, ctx);
  } catch (e) {
    return fail(500, 'FETCH_FAILED', '读取消息失败', ctx);
  }
});

router.get('/api/permissions/catalog', async (ctx) => ok({
  permissions: Object.entries(PERMISSIONS).map(([k, v]) => ({ key: k, ...v })),
  templates: Object.entries(ROLE_TEMPLATES).map(([k, v]) => ({ key: k, ...v })),
}, ctx));

/* ========================================================================== *
 * 9. 认证：注册 / 登录 / 验证码 / OAuth
 * ========================================================================== */

const USERNAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5-]{2,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// 登录写失败后进入冷却，避免在 KV 写配额耗尽时每次登录都尝试写并继续消耗配额（死循环）
let LAST_LOGIN_SAVE_FAIL_AT = 0;
async function createSession(env, user, request, ctx) {
  const ttl = parseInt(env.JWT_TTL_SECONDS || '604800', 10);
  const token = await signJWT({ sub: user.id, ver: user.tokenVersion || 1, u: user.username }, env.JWT_SECRET, ttl);
  // 最佳努力更新登录信息：Cloudflare 免费版 KV 有「每日 1000 次写」硬配额，
  // 写失败（配额耗尽/抖动）绝不允许拖垮登录——吞掉异常即可，lastLoginAt 只是非关键字段。
  try {
    const now = nowMs();
    // 写失败后冷却 10 分钟：KV 写即便失败也照样计入当日配额，若不冷却会陷入
    // 「每次登录都消耗 1 次写配额却仍 500」的死循环，直到配额彻底耗尽。
    if (now - LAST_LOGIN_SAVE_FAIL_AT > 10 * 60 * 1000) {
      // 节流：距上次成功更新不足 60s 就跳过，进一步压低登录对写配额的消耗
      if (!user.lastLoginAt || now - user.lastLoginAt > 60000) {
        user.lastLoginAt = now;
        user.lastIP = clientIP(request);
        await saveUser(env, user);
      }
    }
  } catch (e) {
    LAST_LOGIN_SAVE_FAIL_AT = nowMs();
    console.error('[createSession] 更新登录信息失败（非致命）：', e?.message || e);
  }
  const headers = { 'Set-Cookie': sessionCookie(token, env, ttl) };
  return { token, ttl, headers };
}

router.post('/api/auth/send-code', async (ctx) => {
  const { env, request, body } = ctx;
  const email = String(body.email || '').trim().toLowerCase();
  const purpose = ['register', 'reset', 'bind', 'login', 'verify'].includes(body.purpose) ? body.purpose : 'register';
  if (!EMAIL_RE.test(email)) bad('邮箱格式不正确');
  await guardRate(env, `code:${clientIP(request)}`, 5, 600, '验证码请求过于频繁，请 10 分钟后再试');
  await guardRate(env, `code:mail:${email}`, 3, 600, '该邮箱验证码请求过于频繁');

  const exists = await findUserByEmail(env, email);
  if (purpose === 'register' && exists) conflict('该邮箱已被注册');
  if ((purpose === 'reset' || purpose === 'login') && !exists) {
    return ok({ sent: true }, ctx);  // 防枚举：统一返回成功
  }

  const cfg = await getSiteConfig(env);
  const code = await issueEmailCode(env, email, purpose);
  const titleMap = { register: '注册验证码', reset: '重置密码验证码', bind: '绑定邮箱验证码', login: '登录验证码' };
  const res = await sendMail(env, {
    to: email,
    subject: `【${cfg.siteTitle}】${titleMap[purpose]}：${code}`,
    html: mailTemplate(cfg, {
      title: titleMap[purpose],
      body: `你好，你正在 <b>${escapeHtml(cfg.siteTitle)}</b> 进行「${titleMap[purpose]}」操作。请在页面中输入下方验证码完成验证。若非本人操作请忽略本邮件。`,
      code,
    }),
  }, cfg);
  // register / bind / verify 不涉及账号枚举风险，可如实反馈投递结果；
  // reset / login 出于防枚举考虑，统一只回 sent:true（不暴露 delivered）
  const detail = res.ok ? undefined : (res.body || res.error || '发送失败');
  if (purpose === 'register' || purpose === 'bind' || purpose === 'verify') {
    return ok({ sent: true, delivered: res.ok, provider: res.provider, error: detail }, ctx);
  }
  return ok({ sent: true }, ctx);
});

// 已登录用户凭验证码自助验证邮箱（含超管「要求验证」场景）：验证成功后解锁
router.post('/api/auth/verify-email', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (!user.email) bad('账号未绑定邮箱，无法验证');
  const code = String(body.code || '').trim();
  if (!await consumeEmailCode(env, user.email, 'verify', code)) bad('验证码错误或已过期', 'CODE_INVALID');
  user.emailVerified = true;
  user.flags = { ...(user.flags || {}), forceVerify: false };
  await saveUser(env, user);
  return ok({ emailVerified: true, forceVerify: false }, ctx);
});

// 管理员发测试邮件（验证后台填写的邮件配置是否可用）
router.post('/api/admin/test-mail', async (ctx) => {
  await requireAdmin(ctx, 'site.config');
  const { env, body } = ctx;
  const email = String(body.to || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) bad('请输入有效的测试收件邮箱');
  const cfg = await getSiteConfig(env);
  const res = await sendMail(env, {
    to: email,
    subject: `【${cfg.siteTitle}】邮件发送测试`,
    html: mailTemplate(cfg, {
      title: '邮件发送测试',
      body: '这是一封来自 <b>' + escapeHtml(cfg.siteTitle) + '</b> 的测试邮件。如果你收到了它，说明后台的邮件服务配置已生效 ✅',
      code: '',
    }),
  }, cfg);
  return ok({ sent: res.ok, provider: res.provider, status: res.status, detail: res.body }, ctx);
});

router.post('/api/auth/register', async (ctx) => {
  const { env, request, body } = ctx;
  const cfg = await getSiteConfig(env);
  if (!cfg.registerOpen) forbid('站点当前已关闭注册');
  await guardRate(env, `reg:${clientIP(request)}`, 5, 3600, '注册过于频繁');
  await guardTurnstile(env, request, body.turnstileToken, 'register');

  const username = String(body.username || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const clientHash = String(body.passwordHash || '');

  if (!USERNAME_RE.test(username)) bad('用户名需为 2-20 位字母、数字、下划线、连字符或中文');
  if (!EMAIL_RE.test(email)) bad('邮箱格式不正确');
  if (!/^[a-f0-9]{64}$/.test(clientHash)) bad('密码传输格式无效（客户端需先做 SHA-256 预哈希）');
  if (await findUserByUsername(env, username)) conflict('用户名已被占用');
  if (await findUserByEmail(env, email)) conflict('邮箱已被注册');
  if (cfg.requireEmailVerify && !(await consumeEmailCode(env, email, 'register', body.code)))
    bad('邮箱验证码错误或已过期', 'CODE_INVALID');

  const id = uid('u');
  const u = newUserSkeleton({ id, username, email });
  u.password = await hashPassword(clientHash);
  u.emailVerified = !!cfg.requireEmailVerify;
  u.locale = body.locale || negotiateLocale(request);

  await saveUser(env, u);
  await env.DB.put(unameKey(username), id);
  await env.DB.put(await emailKey(email), id);
  await saveMember(env, 'global', id, { roles: ['role_member'] });
  bumpStatLazy('users');

  const s = await createSession(env, u, request, ctx);
  await pushNotification(env, id, { type: 'system', title: '欢迎加入', body: `欢迎来到 ${cfg.siteTitle}！完善资料后即可发布第一篇文章。` });
  return json({ ok: true, token: s.token, user: publicUser(u, u) }, { headers: s.headers }, ctx);
});

router.post('/api/auth/login', async (ctx) => {
  const { env, request, body } = ctx;
  const ip = clientIP(request);
  await guardRate(env, `login:${ip}`, 15, 300, '登录尝试过于频繁，请 5 分钟后再试');
  await guardTurnstile(env, request, body.turnstileToken, 'login');

  const identifier = String(body.identifier || '').trim();
  const clientHash = String(body.passwordHash || '');
  if (!identifier || !clientHash) bad('请填写账号与密码');
  await guardRate(env, `login:id:${identifier.toLowerCase()}`, 10, 300, '该账号登录尝试过于频繁');

  const user = identifier.includes('@')
    ? await findUserByEmail(env, identifier)
    : await findUserByUsername(env, identifier);

  const okPwd = user ? await verifyPassword(clientHash, user.password) : false;
  if (!user || !okPwd) {
    await new Promise((r) => setTimeout(r, 220));           // 抹平时间差
    throw new HttpError(401, 'BAD_CREDENTIALS', '账号或密码错误');
  }
  if (user.flags?.banned) {
    const until = user.flags.bannedUntil;
    throw new HttpError(403, 'ACCOUNT_BANNED',
      `账号已被封禁${until ? `，解封时间 ${new Date(until).toISOString()}` : '（永久）'}${user.flags.bannedReason ? `：${user.flags.bannedReason}` : ''}`);
  }
  const s = await createSession(env, user, request, ctx);
  return json({ ok: true, token: s.token, user: publicUser(user, user) }, { headers: s.headers }, ctx);
});

router.post('/api/auth/logout', async (ctx) => {
  return json({ ok: true }, { headers: { 'Set-Cookie': 'mo_session=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0' } }, ctx);
});

router.get('/api/auth/me', async (ctx) => {
  const { env, user } = ctx;
  if (!user) return ok({ user: null }, ctx);
  const perms = [...(await collectPerms(env, user, 'global'))];
  return ok({
    user: publicUser(user, user),
    isSuperAdmin: await isSuperAdmin(env, user),
    isOfficial: !!(user && user.official),
    permissions: perms,
    roleTags: await roleTagsOf(env, user, 'global'),
    unread: await unreadCount(env, user.id),
    economy: economyView(user),
  }, ctx);
});

router.post('/api/auth/password/change', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  const oldHash = String(body.oldPasswordHash || '');
  const newHash = String(body.newPasswordHash || '');
  if (!/^[a-f0-9]{64}$/.test(newHash)) bad('新密码格式无效');
  if (user.password && !(await verifyPassword(oldHash, user.password))) bad('原密码不正确');
  user.password = await hashPassword(newHash);
  user.tokenVersion = (user.tokenVersion || 1) + 1;         // 其它设备下线
  await saveUser(env, user);
  const s = await createSession(env, user, ctx.request, ctx);
  return json({ ok: true, token: s.token }, { headers: s.headers }, ctx);
});

router.post('/api/auth/password/reset', async (ctx) => {
  const { env, body } = ctx;
  const email = String(body.email || '').toLowerCase().trim();
  const newHash = String(body.newPasswordHash || '');
  if (!/^[a-f0-9]{64}$/.test(newHash)) bad('新密码格式无效');
  if (!(await consumeEmailCode(env, email, 'reset', body.code))) bad('验证码错误或已过期');
  const u = await findUserByEmail(env, email);
  if (!u) notfound('用户不存在');
  u.password = await hashPassword(newHash);
  u.tokenVersion = (u.tokenVersion || 1) + 1;
  await saveUser(env, u);
  return ok({ reset: true }, ctx);
});

/* --------------------------- OAuth：GitHub / Discord ---------------------- */

router.get('/api/oauth/:provider/start', async (ctx) => {
  const { env, request, params } = ctx;
  const provider = params.provider;
  const cfg = OAUTH[provider];
  if (!cfg) notfound('不支持的 OAuth 提供方');
  const site = await getSiteConfig(env);
  if (provider === 'github' && !site.allowGithubLogin) forbid('站点已关闭 GitHub 登录');
  if (provider === 'discord' && !site.allowDiscordLogin) forbid('站点已关闭 Discord 登录');
  const creds = await oauthCreds(env, provider);
  if (!isConfigured(creds.clientId)) return Response.redirect(`${env.FRONTEND_ORIGIN}/login.html?error=oauth_not_configured&p=${provider}`, 302);

  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') === 'bind' ? 'bind' : 'login';
  const next = url.searchParams.get('next') || '/home.html';
  const desktopPort = url.searchParams.get('desktopPort');
  const state = await signBlob(env, { p: provider, mode, next, uid: ctx.user?.id || null, n: uid(), desktopPort: desktopPort ? Number(desktopPort) : null }, 900);
  const redirectUri = `${env.API_ORIGIN}/api/oauth/${provider}/callback`;

  const auth = new URL(cfg.authorize);
  auth.searchParams.set('client_id', creds.clientId);
  auth.searchParams.set('redirect_uri', redirectUri);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', cfg.scope);
  auth.searchParams.set('state', state);
  if (provider === 'discord') auth.searchParams.set('prompt', 'consent');
  return Response.redirect(auth.toString(), 302);
});

router.get('/api/oauth/:provider/callback', async (ctx) => {
  const { env, request, params } = ctx;
  const provider = params.provider;
  const cfg = OAUTH[provider];
  if (!cfg) notfound('不支持的 OAuth 提供方');
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = await readBlob(env, url.searchParams.get('state'));
  if (!code || !state || state.p !== provider) {
    return Response.redirect(`${env.FRONTEND_ORIGIN}/login.html?error=oauth_state`, 302);
  }

  const redirectUri = `${env.API_ORIGIN}/api/oauth/${provider}/callback`;
  let accessToken;
  try {
    accessToken = await oauthExchange(env, provider, code, redirectUri);
  } catch (e) {
    return Response.redirect(`${env.FRONTEND_ORIGIN}/login.html?error=oauth_failed&p=${provider}`, 302);
  }
  const p = await cfg.profile(accessToken);
  if (!p?.pid) return Response.redirect(`${env.FRONTEND_ORIGIN}/login.html?error=oauth_profile`, 302);

  // 绑定模式
  if (state.mode === 'bind' && state.uid) {
    const me = await getUser(env, state.uid);
    if (me) {
      const occupied = await findUserByOAuth(env, provider, p.pid);
      if (occupied && occupied.id !== me.id) {
        return Response.redirect(`${env.FRONTEND_ORIGIN}/user_settings.html?error=oauth_occupied`, 302);
      }
      me.oauth = { ...(me.oauth || {}), [provider]: { id: p.pid, username: p.username, url: p.profileUrl } };
      me.links = [...(me.links || []).filter((l) => l.platform !== provider),
                  { platform: provider, label: p.username, url: p.profileUrl }];
      await saveUser(env, me);
      await env.DB.put(oauthKey(provider, p.pid), me.id);
      return Response.redirect(`${env.FRONTEND_ORIGIN}/user_settings.html?bound=${provider}`, 302);
    }
  }

  // 登录 / 注册
  let user = await findUserByOAuth(env, provider, p.pid);
  if (!user && p.email) user = await findUserByEmail(env, p.email);
  if (!user) {
    const site = await getSiteConfig(env);
    if (!site.registerOpen) return Response.redirect(`${env.FRONTEND_ORIGIN}/login.html?error=register_closed`, 302);
    let username = slugify(p.username || `${provider}user`).replace(/-/g, '_').slice(0, 16) || `${provider}_user`;
    if (await findUserByUsername(env, username)) username = `${username}_${uid().slice(0, 4)}`;
    const id = uid('u');
    user = newUserSkeleton({ id, username, email: p.email || '' });
    user.displayName = p.displayName || username;
    user.avatar = p.avatar || '';
    user.emailVerified = !!p.email;
    user.locale = negotiateLocale(request);
    user.links = [{ platform: provider, label: p.username, url: p.profileUrl }];
    await saveUser(env, user);
    await env.DB.put(unameKey(username), id);
    if (p.email) await env.DB.put(await emailKey(p.email), id);
    await saveMember(env, 'global', id, { roles: ['role_member'] });
    bumpStatLazy('users');
  }
  user.oauth = { ...(user.oauth || {}), [provider]: { id: p.pid, username: p.username, url: p.profileUrl } };
  if (!user.avatar && p.avatar) user.avatar = p.avatar;
  await saveUser(env, user);
  await env.DB.put(oauthKey(provider, p.pid), user.id);

  if (user.flags?.banned) return Response.redirect(`${env.FRONTEND_ORIGIN}/login.html?error=banned`, 302);

  const s = await createSession(env, user, request, ctx);
  // 桌面端 OAuth：若起始时带了 desktopPort，则把令牌重定向回本机 loopback，由桌面客户端捕获。
  let target;
  if (state.desktopPort) {
    target = new URL(`http://127.0.0.1:${state.desktopPort}/`);
  } else {
    target = new URL(state.next?.startsWith('/') ? env.FRONTEND_ORIGIN + state.next : `${env.FRONTEND_ORIGIN}/home.html`);
  }
  target.searchParams.set('token', s.token);            // 跨站点无法共享 Cookie 时的兜底
  target.searchParams.set('uid', user.id);
  return new Response(null, { status: 302, headers: { Location: target.toString(), 'Set-Cookie': s.headers['Set-Cookie'] } });
});

router.post('/api/oauth/:provider/unbind', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const provider = params.provider;
  const pid = user.oauth?.[provider]?.id;
  if (!pid) bad('未绑定该平台');
  if (!user.password && Object.keys(user.oauth || {}).length <= 1) bad('解绑后将无法登录，请先设置密码');
  delete user.oauth[provider];
  user.links = (user.links || []).filter((l) => l.platform !== provider);
  await saveUser(env, user);
  await KV.del(env, oauthKey(provider, pid));
  return ok({ unbound: provider }, ctx);
});

/* ========================================================================== *
 * 9b. 用户绑定 Cloudflare 账号 + 个人文件存储
 * --------------------------------------------------------------------------
 *  登录用户可绑定自己的 Cloudflare 账号（OAuth2 + PKCE）。绑定成功后系统
 *  自动在该用户账户下创建：
 *    - 一个 KV 命名空间（存放文件二进制 + 元数据）
 *    - 一个 D1 数据库（存放可查询的文件索引）
 *  文件默认存于用户自有 Cloudflare，分享链接形如 /f/<ownerUid>/<fileId>，
 *  可设置「预览码」让其他人凭码浏览/下载。未绑定用户的数据仅存本地。
 * ========================================================================== */

const CF_OAUTH = {
  authorize: 'https://dash.cloudflare.com/oauth2/auth',
  token: 'https://dash.cloudflare.com/oauth2/token',
  // 创建 KV 命名空间需要 Workers KV Storage:Edit，建库需要 D1:Edit；自定义域名自动添加 DNS 记录需要 zone:read dns_records:edit
  scope: 'account:read workers_kv_storage:edit d1:edit zone:read dns_records:edit',
};
const CF_API = 'https://api.cloudflare.com/client/v4';

/** 以用户（已解密的）OAuth 令牌代其调用 Cloudflare API */
async function cfFetch(env, bind, method, path, { body, headers = {} } = {}) {
  const token = await decryptText(env, bind.tokenEnc);
  if (!token) throw new HttpError(500, 'TOKEN_DECRYPT_FAILED', '无法解密用户令牌');
  return fetch(`${CF_API}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...headers },
    body,
  });
}
async function cfKvPut(env, bind, key, value, contentType) {
  const res = await cfFetch(env, bind, 'PUT',
    `accounts/${bind.accountId}/storage/kv/namespaces/${bind.kvId}/values/${encodeURIComponent(key)}`,
    { body: value, headers: { 'Content-Type': contentType || 'application/octet-stream' } });
  return res.ok;
}
async function cfKvGet(env, bind, key) {
  const res = await cfFetch(env, bind, 'GET',
    `accounts/${bind.accountId}/storage/kv/namespaces/${bind.kvId}/values/${encodeURIComponent(key)}`);
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res;
}
async function cfKvGetJson(env, bind, key) {
  const res = await cfKvGet(env, bind, key);
  if (!res) return null;
  try { return await res.json(); } catch { return null; }
}
async function cfKvKeys(env, bind, prefix) {
  const res = await cfFetch(env, bind, 'GET',
    `accounts/${bind.accountId}/storage/kv/namespaces/${bind.kvId}/keys?prefix=${encodeURIComponent(prefix)}&limit=100`);
  if (!res.ok) return [];
  const d = await res.json().catch(() => ({ result: [] }));
  return (d.result || []).map((x) => x.name);
}
async function cfKvDel(env, bind, key) {
  await cfFetch(env, bind, 'DELETE',
    `accounts/${bind.accountId}/storage/kv/namespaces/${bind.kvId}/values/${encodeURIComponent(key)}`).catch(() => {});
}
async function cfD1(env, bind, sql, bindings) {
  if (!bind.d1Id) return null;
  const res = await cfFetch(env, bind, 'POST',
    `accounts/${bind.accountId}/d1/database/${bind.d1Id}/query`,
    { json: true, body: JSON.stringify(bindings ? { sql, bindings } : { sql }) });
  if (!res.ok) return null;
  const d = await res.json().catch(() => ({}));
  return d.result && d.result[0] && d.result[0].results;
}

/* ----------------------------- 绑定流程 --------------------------------- */

router.get('/api/cf/bind/start', async (ctx) => {
  const { env, user } = ctx;
  if (!user) return Response.redirect(`${env.FRONTEND_ORIGIN}/login.html?redirect=${encodeURIComponent('/files.html')}`, 302);
  const cfCreds = await oauthCreds(env, 'cloudflare');
  if (!isConfigured(cfCreds.clientId) || !isConfigured(cfCreds.clientSecret)) return Response.redirect(`${env.FRONTEND_ORIGIN}/files.html?cf=no_config`, 302);
  const verifier = b64urlEncode(crypto.getRandomValues(new Uint8Array(48))).replace(/=+$/, '');
  const state = await signBlob(env, { uid: user.id, v: verifier }, 900);
  const redirectUri = `${env.API_ORIGIN}/api/cf/bind/callback`;
  const auth = new URL(CF_OAUTH.authorize);
  auth.searchParams.set('client_id', cfCreds.clientId);
  auth.searchParams.set('redirect_uri', redirectUri);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', CF_OAUTH.scope);
  auth.searchParams.set('state', state);
  auth.searchParams.set('code_challenge', await pkceChallenge(verifier));
  auth.searchParams.set('code_challenge_method', 'S256');
  return Response.redirect(auth.toString(), 302);
});

router.get('/api/cf/bind/callback', async (ctx) => {
  const { env, request } = ctx;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = await readBlob(env, url.searchParams.get('state'));
  const fail = (r) => Response.redirect(`${env.FRONTEND_ORIGIN}/files.html?cf=${r}`, 302);
  if (!code || !state || !state.uid) return fail('state');

  const cfCreds = await oauthCreds(env, 'cloudflare');
  let tok = null;
  try {
    const r = await fetch(CF_OAUTH.token, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code,
        client_id: cfCreds.clientId, client_secret: cfCreds.clientSecret || '',
        redirect_uri: `${env.API_ORIGIN}/api/cf/bind/callback`, code_verifier: state.v,
      }),
    });
    const d = await r.json();
    tok = d.access_token;
  } catch (e) { return fail('token'); }
  if (!tok) return fail('token');

  const ar = await fetch(`${CF_API}/accounts?per_page=1`, { headers: { Authorization: `Bearer ${tok}` } });
  const ad = await ar.json().catch(() => ({}));
  const account = ad.result && ad.result[0];
  if (!account) return fail('account');

  const uidSuffix = state.uid.replace(/[^a-z0-9]/gi, '');
  const kvTitle = `marytopens-files-${uidSuffix}`;
  const kvr = await fetch(`${CF_API}/accounts/${account.id}/storage/kv/namespaces`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: kvTitle }),
  });
  const kvd = await kvr.json().catch(() => ({}));
  const kvId = kvd.result && kvd.result.id;
  if (!kvId) return fail('kv');

  let d1Id = null;
  const d1Name = `marytopens_files_${uidSuffix}`;
  try {
    const d1r = await fetch(`${CF_API}/accounts/${account.id}/d1/database`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: d1Name }),
    });
    const d1d = await d1r.json().catch(() => ({}));
    d1Id = d1d.result && d1d.result.uuid;
    if (d1Id) {
      await cfFetch({ tokenEnc: await encryptText(env, tok), accountId: account.id, kvId, d1Id }, 'POST',
        `accounts/${account.id}/d1/database/${d1Id}/query`,
        { json: true, body: JSON.stringify({ sql: 'CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, name TEXT, mime TEXT, size INTEGER, owner TEXT, preview_code TEXT, created_at INTEGER, expires_at INTEGER)' }) });
    }
  } catch (e) { /* D1 可选，建库失败不影响 KV 文件存储 */ }

  const rec = {
    accountId: account.id, accountName: account.name, kvId, d1Id, d1Name, kvTitle,
    tokenEnc: await encryptText(env, tok), boundAt: nowMs(), owner: state.uid,
  };
  await KV.putJSON(env, `cf:bind:${state.uid}`, rec);
  return Response.redirect(`${env.FRONTEND_ORIGIN}/files.html?cf=success`, 302);
});

router.get('/api/cf/bind/status', async (ctx) => {
  const { env, user } = ctx;
  if (!user) unauth();
  const b = await KV.getJSON(env, `cf:bind:${user.id}`, null);
  if (!b) return ok({ bound: false }, ctx);
  return ok({ bound: true, accountName: b.accountName, accountId: b.accountId, kvId: b.kvId, d1Id: b.d1Id, createdAt: b.boundAt }, ctx);
});

router.post('/api/cf/bind/unbind', async (ctx) => {
  const { env, user } = ctx;
  if (!user) unauth();
  await KV.del(env, `cf:bind:${user.id}`);
  return ok({ unbound: true }, ctx);
});

/* ----------------------------- 文件存储 --------------------------------- */

router.post('/api/cf/upload', async (ctx) => {
  const { env, user, request } = ctx;
  if (!user) unauth();
  const b = await KV.getJSON(env, `cf:bind:${user.id}`, null);
  if (!b) forbid('请先绑定 Cloudflare 账号');
  const form = await request.formData();
  const file = form.get('file');
  if (!file || !file.size) bad('未收到文件');
  const maxBytes = parseInt(env.CF_FILE_MAX_BYTES || '26214400', 10);
  if (file.size > maxBytes) bad(`文件超过单文件上限（${Math.round(maxBytes / 1048576)}MB）`);
  const quota = parseInt(env.CF_FILE_QUOTA || '200', 10);
  const keys = await cfKvKeys(env, b, 'm:');
  if (keys.length >= quota) bad('已达到文件数量上限，请先清理');

  const name = String(form.get('name') || file.name || 'file').slice(0, 200);
  const previewCode = String(form.get('previewCode') || '').slice(0, 64);
  const expiresAt = parseInt(form.get('expiresAt') || '0', 10) || 0;
  const fileId = uid('f');
  const bytes = new Uint8Array(await file.arrayBuffer());
  await cfKvPut(env, b, `file:${fileId}`, bytes, file.type || 'application/octet-stream');
  const meta = {
    id: fileId, name, mime: file.type || 'application/octet-stream', size: file.size,
    owner: user.id, previewCode, createdAt: nowMs(), expiresAt,
  };
  await cfKvPut(env, b, `m:${fileId}`, JSON.stringify(meta), 'application/json');
  if (b.d1Id) {
    try { await cfD1(env, b, 'INSERT INTO files (id,name,mime,size,owner,preview_code,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)',
      [fileId, name, meta.mime, meta.size, user.id, previewCode, meta.createdAt, expiresAt]); } catch (e) { /* 可选镜像 */ }
  }
  return ok({ fileId, shareUrl: `/f/${user.id}/${fileId}` }, ctx);
});

router.get('/api/cf/files', async (ctx) => {
  const { env, user } = ctx;
  if (!user) unauth();
  const b = await KV.getJSON(env, `cf:bind:${user.id}`, null);
  if (!b) return ok({ bound: false, files: [] }, ctx);
  const keys = await cfKvKeys(env, b, 'm:');
  const files = (await Promise.all(keys.map((k) => cfKvGetJson(env, b, k))))
    .filter(Boolean).sort((a, c) => c.createdAt - a.createdAt)
    .map((m) => ({ ...m, previewCode: m.previewCode ? '••••' : '' }));
  return ok({ bound: true, files }, ctx);
});

router.post('/api/cf/files/:id/share', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const b = await KV.getJSON(env, `cf:bind:${user.id}`, null);
  if (!b) forbid('未绑定 Cloudflare 账号');
  const meta = await cfKvGetJson(env, b, `m:${params.id}`);
  if (!meta || meta.owner !== user.id) bad('文件不存在');
  const code = String(body.previewCode || '').slice(0, 64);
  meta.previewCode = code;
  await cfKvPut(env, b, `m:${params.id}`, JSON.stringify(meta), 'application/json');
  if (b.d1Id) { try { await cfD1(env, b, 'UPDATE files SET preview_code=? WHERE id=?', [code, params.id]); } catch (e) {} }
  // 写入公共搜索索引（本仓库 KV），供全局文件搜索使用
  await KV.putJSON(env, `pubfile:${user.id}:${params.id}`, {
    id: params.id, name: meta.name, mime: meta.mime, size: meta.size,
    owner: user.id, protected: !!code, createdAt: meta.createdAt || nowMs(),
    shareUrl: `/f/${user.id}/${params.id}`,
  });
  return ok({ previewCode: code ? '••••' : '' }, ctx);
});

router.post('/api/cf/files/:id/delete', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const b = await KV.getJSON(env, `cf:bind:${user.id}`, null);
  if (!b) forbid('未绑定 Cloudflare 账号');
  const meta = await cfKvGetJson(env, b, `m:${params.id}`);
  if (!meta || meta.owner !== user.id) bad('文件不存在');
  await cfKvDel(env, b, `file:${params.id}`);
  await cfKvDel(env, b, `m:${params.id}`);
  if (b.d1Id) { try { await cfD1(env, b, 'DELETE FROM files WHERE id=?', [params.id]); } catch (e) {} }
  await KV.del(env, `pubfile:${user.id}:${params.id}`);
  return ok({ deleted: params.id }, ctx);
});

/* --------------------------- 公开分享页 -------------------------------- */

function cfSharePage(meta, owner, id, code, gated) {
  const accent = '#6366f1';
  const name = escapeHtml(meta.name);
  const size = (meta.size / 1048576).toFixed(2) + ' MB';
  const inner = gated
    ? `<div class="card" style="max-width:420px;margin:0 auto;text-align:center">
         <div style="font-size:40px;color:${accent}">🔒</div>
         <h2 style="margin:14px 0 6px">该文件受预览码保护</h2>
         <p style="color:#64748b;margin:0 0 20px">请输入分享者提供的预览码后查看。</p>
         <form method="get" class="field">
           <input class="input" name="code" placeholder="预览码" autocomplete="off" style="text-align:center">
           <button class="btn btn-primary btn-block" style="margin-top:12px">查看文件</button>
         </form>
       </div>`
    : `<div class="card" style="max-width:520px;margin:0 auto">
         <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">
           <div style="width:54px;height:54px;border-radius:14px;background:${accent}1a;color:${accent};display:flex;align-items:center;justify-content:center;font-size:26px">📄</div>
           <div>
             <div style="font-weight:700;font-size:17px">${name}</div>
             <div style="color:#64748b;font-size:13px">${size} · ${escapeHtml(meta.mime)}</div>
           </div>
         </div>
         <a class="btn btn-primary btn-lg btn-block" href="/f/${owner}/${id}/raw${code ? '?code=' + encodeURIComponent(code) : ''}">下载 / 打开文件</a>
         <p style="color:#94a3b8;font-size:12px;text-align:center;margin-top:14px">文件由上传者自有 Cloudflare 存储提供</p>
       </div>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${name} · MarytOpens</title>
    <link rel="icon" href="/assets/img/favicon.svg">
    <link rel="stylesheet" href="/assets/css/main.css"></head>
    <body style="background:linear-gradient(135deg,#0f172a,#1e1b4b);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px">
      <div style="width:100%">${inner}</div>
    </body></html>`;
}

router.get('/f/:owner/:id', async (ctx) => {
  const { env, request, params } = ctx;
  const b = await KV.getJSON(env, `cf:bind:${params.owner}`, null);
  if (!b) return notfound('分享链接无效');
  const meta = await cfKvGetJson(env, b, `m:${params.id}`);
  if (!meta) return notfound('文件不存在或已删除');
  if (meta.expiresAt && meta.expiresAt < nowMs()) return new Response('链接已过期', { status: 410 });
  const code = new URL(request.url).searchParams.get('code') || '';
  if (meta.previewCode && meta.previewCode !== code) {
    return new Response(cfSharePage(meta, params.owner, params.id, code, true),
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  return new Response(cfSharePage(meta, params.owner, params.id, code, false),
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
});

router.get('/f/:owner/:id/raw', async (ctx) => {
  const { env, request, params } = ctx;
  const b = await KV.getJSON(env, `cf:bind:${params.owner}`, null);
  if (!b) return notfound('分享链接无效');
  const meta = await cfKvGetJson(env, b, `m:${params.id}`);
  if (!meta) return notfound('文件不存在或已删除');
  if (meta.expiresAt && meta.expiresAt < nowMs()) return new Response('链接已过期', { status: 410 });
  const code = new URL(request.url).searchParams.get('code') || '';
  if (meta.previewCode && meta.previewCode !== code) {
    return json({ ok: false, code_required: true, message: '需要预览码' }, { status: 403 }, ctx);
  }
  const res = await cfKvGet(env, b, `file:${params.id}`);
  if (!res) return notfound('文件数据缺失');
  const h = new Headers();
  h.set('Content-Type', meta.mime || 'application/octet-stream');
  h.set('Content-Disposition', `attachment; filename="${encodeURIComponent(meta.name)}"`);
  h.set('Cache-Control', 'public, max-age=300');
  h.set('X-Content-Type-Options', 'nosniff');
  return new Response(res.body, { headers: h });
});

// 供前端（主域 Pages 静态分享查看页 f.html）客户端拉取分享元数据，返回 JSON
router.get('/api/share/:owner/:id', async (ctx) => {
  const { env, params, url } = ctx;
  const b = await KV.getJSON(env, `cf:bind:${params.owner}`, null);
  if (!b) return json({ ok: false, message: '分享链接无效' }, { status: 404 }, ctx);
  const meta = await cfKvGetJson(env, b, `m:${params.id}`);
  if (!meta) return json({ ok: false, message: '文件不存在或已删除' }, { status: 404 }, ctx);
  if (meta.expiresAt && meta.expiresAt < nowMs()) return json({ ok: false, expired: true, message: '链接已过期' }, { status: 410 }, ctx);
  const code = url.searchParams.get('code') || '';
  const gated = !!(meta.previewCode && meta.previewCode !== code);
  const base = 'https://' + new URL(ctx.request.url).host;
  return ok({
    ok: true,
    requiresCode: gated,
    meta: { name: meta.name, size: meta.size, mime: meta.mime },
    owner: params.owner,
    downloadUrl: `${base}/f/${params.owner}/${params.id}/raw${code ? '?code=' + encodeURIComponent(code) : ''}`,
    viewUrl: `${base}/f/${params.owner}/${params.id}${code ? '?code=' + encodeURIComponent(code) : ''}`,
  }, ctx);
});

/* ========================================================================== *
 * 10. 统计小工具
 * ========================================================================== */

async function bumpStat(env, key, delta = 1) {
  const k = `stat:total:${key}`;
  const v = parseInt((await env.DB.get(k)) || '0', 10) + delta;
  await env.DB.put(k, String(Math.max(0, v)));
  return v;
}
async function readStat(env, key) { return parseInt((await env.DB.get(`stat:total:${key}`)) || '0', 10); }

// 社区数据（版块/频道/群组）实时计数，每 Worker 实例缓存 5 分钟，避免高频 list 吃配额
let COMM_COUNT_CACHE = { boards: 0, channels: 0, groups: 0, at: 0 };
async function countCommunity(env) {
  const now = nowMs();
  if (now - COMM_COUNT_CACHE.at < 5 * 60 * 1000) return COMM_COUNT_CACHE;
  const [bRes, cRes, gRes] = await Promise.all([
    KV.list(env, 'bd:', 1000),
    KV.list(env, 'ch:', 1000),
    KV.list(env, 'group:', 1000),
  ]);
  COMM_COUNT_CACHE = {
    boards: bRes.keys.length,
    channels: cRes.keys.length,
    groups: gRes.keys.length,
    at: now,
  };
  return { boards: COMM_COUNT_CACHE.boards, channels: COMM_COUNT_CACHE.channels, groups: COMM_COUNT_CACHE.groups };
}

/* ========================================================================== *
 * 10.5 在线状态 / 在线人数（Presence）
 * ========================================================================== *
 *  设计原则：**零 KV 读写**。Cloudflare 免费版 KV 每天只有 1000 次写，
 *  在线心跳属于最高频写入场景，一旦落 KV 必然瞬间烧穿配额。
 *  因此在线态完全存在 Worker isolate 的内存里：
 *    · 任何一次带身份的请求都会刷新该用户的「最后活跃时间」（免费，无 IO）
 *    · 超过 PRESENCE_TTL 未活跃即视为离线，读取时惰性清理
 *    · 访客按 IP 计数（同样只在内存里，不落盘、不持久化）
 *  代价：isolate 回收或多 colo 并存时计数是「近似值」而非全局精确值。
 *  对社区展示型的「当前在线人数」而言完全够用，且永远不会拖垮配额。
 *
 *  用户可自定义状态：online（在线）/ away（离开）/ busy（忙碌）/ invisible（隐身）
 *  外加一句自定义状态文案 statusText（≤40 字）。二者存在用户记录里，
 *  只有用户**手动改动**时才写一次 KV（低频，安全）。
 */

const USER_STATUSES = ['online', 'away', 'busy', 'invisible'];
const PRESENCE_TTL = 5 * 60 * 1000;     // 5 分钟无请求即判定离线
const PRESENCE_MAX = 5000;              // 内存保护上限
const PRESENCE = new Map();             // uid -> { at, since, status, text, name, username, avatar, official }
const GUESTS = new Map();               // ip -> lastAt（仅内存，用于访客在线数）
let PRESENCE_LAST_PRUNE = 0;

function normalizeStatus(s) { return USER_STATUSES.includes(s) ? s : 'online'; }

function prunePresence(now = nowMs(), force = false) {
  if (!force && now - PRESENCE_LAST_PRUNE < 30000) return;
  PRESENCE_LAST_PRUNE = now;
  for (const [k, v] of PRESENCE) if (now - v.at > PRESENCE_TTL) PRESENCE.delete(k);
  for (const [k, t] of GUESTS) if (now - t > PRESENCE_TTL) GUESTS.delete(k);
  // 极端情况下（被刷）直接丢掉最旧的一半，保证内存有界
  if (PRESENCE.size > PRESENCE_MAX) {
    const sorted = [...PRESENCE.entries()].sort((a, b) => a[1].at - b[1].at);
    for (let i = 0; i < sorted.length - PRESENCE_MAX / 2; i++) PRESENCE.delete(sorted[i][0]);
  }
  if (GUESTS.size > PRESENCE_MAX) GUESTS.clear();
}

/** 刷新某用户的在线时间戳（每个带身份的请求都会调用，必须零 IO） */
function touchPresence(user) {
  if (!user || !user.id) return;
  const now = nowMs();
  const prev = PRESENCE.get(user.id);
  PRESENCE.set(user.id, {
    at: now,
    since: prev?.since || now,
    status: normalizeStatus(user.status),
    text: String(user.statusText || '').slice(0, 40),
    name: user.displayName || user.username,
    username: user.username,
    avatar: user.avatar || '',
    official: !!user.official,
  });
  prunePresence(now);
}

function touchGuest(ip) {
  if (!ip) return;
  GUESTS.set(ip, nowMs());
  prunePresence();
}

/** 某用户对外可见的在线态（隐身对外一律显示离线） */
function presenceOf(userId) {
  const p = PRESENCE.get(userId);
  if (!p || nowMs() - p.at > PRESENCE_TTL) return { online: false, status: 'offline', text: '' };
  if (p.status === 'invisible') return { online: false, status: 'offline', text: '' };
  return { online: true, status: p.status, text: p.text || '' };
}

/** 在线人数汇总：members = 登录用户（不含隐身），guests = 访客 */
function presenceStats() {
  prunePresence(nowMs(), true);
  let members = 0;
  for (const p of PRESENCE.values()) if (p.status !== 'invisible') members++;
  const guests = GUESTS.size;
  return { online: members + guests, members, guests };
}

/* ========================================================================== *
 * 11. 通知系统
 * ========================================================================== */

/** 当前请求的 ExecutionContext（供非路由函数做 waitUntil 后台任务） */
let CURRENT_EXEC_CTX = null;

async function pushNotification(env, userId, { type, title, body, link = '', actor = null, refId = '' }) {
  if (!userId) return;
  try {
    const id = sortableId();
    const rec = { id, type, title, body: String(body || '').slice(0, 500), link, actor, refId, read: false, createdAt: nowMs() };
    await KV.putJSON(env, `notif:${userId}:${id}`, rec, {
      expirationTtl: 86400 * 180,
      metadata: { t: rec.createdAt, type, read: false },
    });
    const k = `notifcnt:${userId}`;
    const unread = parseInt((await env.DB.get(k)) || '0', 10) + 1;
    await env.DB.put(k, String(unread));
    // 同步向已订阅设备投递浏览器推送（后台执行，不阻塞主请求）
    const task = deliverWebPush(env, userId, {
      type, title: title || 'MarytOpens', body: rec.body, link, tag: `mo-${type}`,
      actor: actor ? { id: actor.id || actor, name: actor.displayName || actor.username || '' } : null,
      unread, ts: rec.createdAt, notifId: id,
    });
    if (CURRENT_EXEC_CTX && typeof CURRENT_EXEC_CTX.waitUntil === 'function') CURRENT_EXEC_CTX.waitUntil(task);
    else await task.catch(() => {});
  } catch (e) {
    // 通知投递失败不应阻塞主请求（私信/聊天发送）
    console.error('pushNotification failed:', e);
  }
}

async function unreadCount(env, userId) {
  return parseInt((await env.DB.get(`notifcnt:${userId}`)) || '0', 10);
}

router.get('/api/notifications', async (ctx) => {
  const { env, user, url } = ctx;
  if (!user) unauth();
  const limit = clamp(url.searchParams.get('limit') || 30, 1, 100);
  const { keys, cursor, list_complete } = await KV.list(env, `notif:${user.id}:`, limit, url.searchParams.get('cursor'));
  const items = await KV.many(env, keys.map((k) => k.name));
  return ok({ items, cursor: list_complete ? null : cursor, unread: await unreadCount(env, user.id) }, ctx);
});

router.post('/api/notifications/read', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (body.all) {
    const { keys } = await KV.list(env, `notif:${user.id}:`, 500);
    await Promise.all(keys.map(async (k) => {
      const n = await KV.getJSON(env, k.name);
      if (n && !n.read) await KV.putJSON(env, k.name, { ...n, read: true }, { expirationTtl: 86400 * 180 });
    }));
    await env.DB.put(`notifcnt:${user.id}`, '0');
    return ok({ read: 'all' }, ctx);
  }
  const id = String(body.id || '');
  const key = `notif:${user.id}:${id}`;
  const n = await KV.getJSON(env, key);
  if (!n) notfound('通知不存在');
  if (!n.read) {
    await KV.putJSON(env, key, { ...n, read: true }, { expirationTtl: 86400 * 180 });
    const c = Math.max(0, (await unreadCount(env, user.id)) - 1);
    await env.DB.put(`notifcnt:${user.id}`, String(c));
  }
  return ok({ read: id }, ctx);
});

router.delete('/api/notifications/:id', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  await KV.del(env, `notif:${user.id}:${params.id}`);
  return ok({ deleted: params.id }, ctx);
});

/* ========================================================================== *
 * 11.5 Web Push 浏览器推送 & 后台常驻
 * --------------------------------------------------------------------------
 * KV 键：
 *   cfg:vapid              VAPID 密钥对 { publicKey, privateKey, subject }
 *   pushsub:<uid>:<hash>   订阅端点 { id,userId,endpoint,keys{p256dh,auth},ua,background,... }
 *   pushpref:<uid>         推送偏好 { enabled, background, types{...} }
 *
 * 实现依据：
 *   VAPID  —— RFC 8292（ES256 JWT + Authorization: vapid t=..., k=...）
 *   负载加密 —— RFC 8291 / RFC 8188（aes128gcm，ECDH P-256 + HKDF-SHA256）
 * 全部使用 Workers 内建 WebCrypto，无外部依赖。
 * ========================================================================== */

const PUSH_TYPES = ['message', 'friend', 'reply', 'mention', 'like', 'follow', 'group', 'system',
  'letter', 'submission', 'support', 'codespace', 'oauth', 'newpost'];

const PUSH_DEFAULT_PREF = {
  enabled: true,
  background: false,
  types: {
    message: true, friend: true, reply: true, mention: true, like: false, follow: true, group: true, system: true,
    // 来信 / 投稿 / 客服 / 开发环境 / 授权：默认开启，用户可在「消息与推送设置」中逐项关闭
    letter: true, submission: true, support: true, codespace: false, oauth: true, newpost: true,
  },
};

function normalizePushPref(p) {
  const base = structuredClone(PUSH_DEFAULT_PREF);
  if (!p || typeof p !== 'object') return base;
  const types = { ...base.types };
  if (p.types && typeof p.types === 'object') {
    for (const t of PUSH_TYPES) if (p.types[t] !== undefined) types[t] = p.types[t] === true || p.types[t] === 'true';
  }
  return { enabled: p.enabled !== false, background: p.background === true || p.background === 'true', types };
}

async function getVapid(env) {
  const v = await KV.getJSON(env, 'cfg:vapid', null);
  if (v && v.publicKey && v.privateKey) return v;
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    return {
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
      subject: env.VAPID_SUBJECT || 'mailto:admin@example.com',
    };
  }
  return null;
}

/** 生成 VAPID（P-256）密钥对：公钥 = 65 字节未压缩点，私钥 = JWK 的 d */
async function generateVapidKeys(subject) {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pubRaw = await crypto.subtle.exportKey('raw', kp.publicKey);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return { publicKey: b64urlEncode(pubRaw), privateKey: jwk.d, subject: subject || 'mailto:admin@example.com', createdAt: nowMs() };
}

async function importVapidPrivate(privateD, publicKeyB64) {
  const pub = b64urlDecode(publicKeyB64); // 0x04 || X(32) || Y(32)
  const jwk = {
    kty: 'EC', crv: 'P-256', d: privateD,
    x: b64urlEncode(pub.slice(1, 33)),
    y: b64urlEncode(pub.slice(33, 65)),
    ext: true, key_ops: ['sign'],
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function vapidAuthHeader(endpoint, vapid) {
  const aud = new URL(endpoint).origin;
  const head = b64urlEncode(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64urlEncode(te.encode(JSON.stringify({
    aud, exp: nowSec() + 12 * 3600, sub: vapid.subject || 'mailto:admin@example.com',
  })));
  const input = `${head}.${payload}`;
  const key = await importVapidPrivate(vapid.privateKey, vapid.publicKey);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(input));
  return `vapid t=${input}.${b64urlEncode(sig)}, k=${vapid.publicKey}`;
}

function concatBytes(...arrs) {
  let n = 0; for (const a of arrs) n += a.length;
  const out = new Uint8Array(n);
  let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

async function hmacSha256(keyBytes, data) {
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/** RFC 8291：把明文加密为 aes128gcm 单记录消息体 */
async function encryptPushPayload(plaintext, p256dhB64, authB64) {
  const uaPublic = b64urlDecode(p256dhB64);
  const authSecret = b64urlDecode(authB64);

  const localKp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', localKp.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, localKp.privateKey, 256));

  const prkKey = await hmacSha256(authSecret, ecdh);
  const keyInfo = concatBytes(te.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1]));
  const ikm = await hmacSha256(prkKey, keyInfo);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmacSha256(salt, ikm);
  const cek = (await hmacSha256(prk, concatBytes(te.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmacSha256(prk, concatBytes(te.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const plain = concatBytes(te.encode(plaintext), new Uint8Array([2])); // 记录分隔符
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plain));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concatBytes(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

async function sendWebPush(env, sub, payloadObj, { ttl = 86400, urgency = 'normal' } = {}) {
  const vapid = await getVapid(env);
  if (!vapid) return { ok: false, status: 0, reason: 'no-vapid' };
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return { ok: false, status: 0, reason: 'bad-sub' };
  const body = await encryptPushPayload(JSON.stringify(payloadObj), sub.keys.p256dh, sub.keys.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthHeader(sub.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: urgency,
    },
    body,
  });
  return { ok: res.ok, status: res.status };
}

/** 向某用户的所有设备投递推送；自动清理失效端点 */
async function deliverWebPush(env, userId, payload) {
  try {
    const pref = normalizePushPref(await KV.getJSON(env, `pushpref:${userId}`, null));
    if (!pref.enabled) return;
    if (payload.type && pref.types[payload.type] === false) return;
    const { keys } = await KV.list(env, `pushsub:${userId}:`, 20);
    if (!keys.length) return;
    const subs = await KV.many(env, keys.map((k) => k.name));
    await Promise.all(subs.map(async (s) => {
      const key = `pushsub:${userId}:${s.id}`;
      let r;
      try { r = await sendWebPush(env, s, payload); } catch { r = { ok: false, status: 0 }; }
      if (r.ok) { await KV.putJSON(env, key, { ...s, lastOkAt: nowMs(), fails: 0 }); return; }
      if (r.status === 404 || r.status === 410) { await KV.del(env, key); return; }
      const fails = (s.fails || 0) + 1;
      if (fails >= 6) await KV.del(env, key);
      else await KV.putJSON(env, key, { ...s, fails, lastErrAt: nowMs(), lastErrStatus: r.status });
    }));
  } catch (e) { console.error('webpush deliver:', e && e.message); }
}

router.get('/api/push/config', async (ctx) => {
  const v = await getVapid(ctx.env);
  return ok({ enabled: !!v, publicKey: v ? v.publicKey : '' }, ctx);
});

router.get('/api/push/state', async (ctx) => {
  const { env, user } = ctx;
  if (!user) unauth();
  const v = await getVapid(env);
  const { keys } = await KV.list(env, `pushsub:${user.id}:`, 20);
  const subs = await KV.many(env, keys.map((k) => k.name));
  return ok({
    enabled: !!v,
    publicKey: v ? v.publicKey : '',
    prefs: normalizePushPref(await KV.getJSON(env, `pushpref:${user.id}`, null)),
    devices: subs.map((s) => ({
      id: s.id, ua: s.ua || '', background: !!s.background,
      createdAt: s.createdAt, lastOkAt: s.lastOkAt || 0,
      endpointHost: (() => { try { return new URL(s.endpoint).host; } catch { return ''; } })(),
    })),
  }, ctx);
});

router.post('/api/push/subscribe', async (ctx) => {
  const { env, user, body, request } = ctx;
  if (!user) unauth();
  const sub = body.subscription || body;
  const endpoint = String(sub.endpoint || '');
  const p256dh = String(sub.keys?.p256dh || '');
  const auth = String(sub.keys?.auth || '');
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) bad('订阅信息不完整');
  const id = (await sha256Hex(endpoint)).slice(0, 24);
  const key = `pushsub:${user.id}:${id}`;
  const prev = await KV.getJSON(env, key, null);
  const rec = {
    id, userId: user.id, endpoint, keys: { p256dh, auth },
    ua: String(body.ua || request.headers.get('User-Agent') || '').slice(0, 200),
    background: body.background === true,
    createdAt: prev?.createdAt || nowMs(), updatedAt: nowMs(), fails: 0,
  };
  await KV.putJSON(env, key, rec);
  // 首次订阅时落一份默认偏好
  if (!(await KV.getJSON(env, `pushpref:${user.id}`, null))) {
    await KV.putJSON(env, `pushpref:${user.id}`, { ...structuredClone(PUSH_DEFAULT_PREF), background: rec.background });
  }
  return ok({ id, device: { id, ua: rec.ua, background: rec.background } }, ctx);
});

router.post('/api/push/unsubscribe', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (body.all) {
    const { keys } = await KV.list(env, `pushsub:${user.id}:`, 50);
    await Promise.all(keys.map((k) => KV.del(env, k.name)));
    return ok({ removed: keys.length }, ctx);
  }
  const id = body.id ? String(body.id) : (body.endpoint ? (await sha256Hex(String(body.endpoint))).slice(0, 24) : '');
  if (!id) bad('缺少订阅标识');
  await KV.del(env, `pushsub:${user.id}:${id}`);
  return ok({ removed: 1, id }, ctx);
});

router.put('/api/push/prefs', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  const next = normalizePushPref({ ...normalizePushPref(await KV.getJSON(env, `pushpref:${user.id}`, null)), ...body });
  await KV.putJSON(env, `pushpref:${user.id}`, next);
  // 后台常驻开关同步到该用户所有设备记录
  if (body.background !== undefined) {
    const { keys } = await KV.list(env, `pushsub:${user.id}:`, 20);
    const subs = await KV.many(env, keys.map((k) => k.name));
    await Promise.all(subs.map((s) => KV.putJSON(env, `pushsub:${user.id}:${s.id}`, { ...s, background: next.background })));
  }
  return ok({ prefs: next }, ctx);
});

router.post('/api/push/test', async (ctx) => {
  const { env, user } = ctx;
  if (!user) unauth();
  const v = await getVapid(env);
  if (!v) bad('站点尚未配置推送密钥（VAPID），请联系管理员');
  const { keys } = await KV.list(env, `pushsub:${user.id}:`, 20);
  if (!keys.length) bad('当前账号没有已订阅的设备');
  const subs = await KV.many(env, keys.map((k) => k.name));
  const results = [];
  for (const s of subs) {
    let r;
    try {
      r = await sendWebPush(env, s, {
        type: 'system', title: 'MarytOpens', body: '这是一条测试推送，说明推送通道已正常工作。',
        link: '/notifications.html', tag: 'mo-test', ts: nowMs(),
      });
    } catch (e) { r = { ok: false, status: 0, error: String(e && e.message) }; }
    if (!r.ok && (r.status === 404 || r.status === 410)) await KV.del(env, `pushsub:${user.id}:${s.id}`);
    results.push({ id: s.id, ok: r.ok, status: r.status });
  }
  return ok({ sent: results.filter((r) => r.ok).length, total: results.length, results }, ctx);
});

/** 后台常驻（periodicSync）轮询用：返回未读摘要，尽量轻量 */
router.get('/api/push/digest', async (ctx) => {
  const { env, user } = ctx;
  if (!user) unauth();
  const unread = await unreadCount(env, user.id);
  let latest = null;
  if (unread > 0) {
    const { keys } = await KV.list(env, `notif:${user.id}:`, 1);
    if (keys.length) {
      const n = await KV.getJSON(env, keys[0].name);
      if (n) latest = { id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, createdAt: n.createdAt };
    }
  }
  return ok({ unread, latest, ts: nowMs() }, ctx);
});

router.post('/api/admin/push/vapid', async (ctx) => {
  const { env, user, body } = ctx;
  await requireAdmin(ctx, 'site.config');
  const cur = await KV.getJSON(env, 'cfg:vapid', null);
  if (cur && !body.force) return ok({ publicKey: cur.publicKey, subject: cur.subject, existed: true }, ctx);
  const v = await generateVapidKeys(String(body.subject || '').trim() || 'mailto:admin@example.com');
  await KV.putJSON(env, 'cfg:vapid', v);
  if (cur && body.force) {
    // 轮换密钥后旧订阅全部失效，清理之
    let cursor = null, removed = 0;
    do {
      const r = await KV.list(env, 'pushsub:', 1000, cursor);
      await Promise.all(r.keys.map((k) => KV.del(env, k.name)));
      removed += r.keys.length;
      cursor = r.list_complete ? null : r.cursor;
    } while (cursor);
    await writeAudit(env, user, 'push.vapid.rotate', 'site', { removed });
  } else {
    await writeAudit(env, user, 'push.vapid.create', 'site', { subject: v.subject });
  }
  return ok({ publicKey: v.publicKey, subject: v.subject, existed: false }, ctx);
});

router.get('/api/admin/push/stats', async (ctx) => {
  const { env } = ctx;
  await requireAdmin(ctx, 'site.config');
  let cursor = null, total = 0, background = 0;
  do {
    const r = await KV.list(env, 'pushsub:', 1000, cursor);
    total += r.keys.length;
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  const v = await getVapid(env);
  return ok({ configured: !!v, publicKey: v ? v.publicKey : '', subject: v ? v.subject : '', devices: total, background }, ctx);
});

/* ========================================================================== *
 * 12. 文章系统（含私密文章权限）
 * ========================================================================== *
 *  visibility:
 *    public   —— 所有人可见
 *    members  —— 登录用户可见
 *    private  —— 仅作者 + 超级管理员可见（需求明确：任何人不可见，超管可见）
 *    roles    —— 仅指定身份组可见（visibleRoles: [{scope,roleId}]）
 * ========================================================================== */

const VISIBILITIES = ['public', 'members', 'private', 'roles'];

async function canViewPost(env, post, viewer) {
  if (post.status === 'deleted') return !!(viewer && await isSuperAdmin(env, viewer));
  if (viewer && viewer.id === post.authorId) return true;
  if (viewer && await isSuperAdmin(env, viewer)) return true;
  // 草稿：仅作者与超级管理员（上面两条已放行）
  if (post.status === 'draft') return false;
  switch (post.visibility) {
    case 'public':  return true;
    case 'members': return !!viewer;
    case 'private': return false;
    case 'roles': {
      if (!viewer) return false;
      if (await hasPerm(env, viewer, 'user.viewprivate', post.scope || 'global')) return true;
      for (const r of post.visibleRoles || []) {
        const own = new Set(viewer.roles?.[r.scope] || []);
        const mem = await getMember(env, r.scope, viewer.id);
        for (const x of mem?.roles || []) own.add(x);
        if (own.has(r.roleId)) return true;
      }
      return false;
    }
    default: return false;
  }
}

async function postCard(env, p, viewer) {
  const author = await getUser(env, p.authorId);
  const encrypted = !!p.encrypted;
  return {
    id: p.id, slug: p.slug, title: p.title,
    excerpt: encrypted ? (p.excerpt || '🔒 加密内容') : (p.excerpt || String(p.content || '').replace(/[#*`>\-\[\]!]/g, '').slice(0, 160)),
    cover: p.cover || '', tags: p.tags || [], board: p.board || '', scope: p.scope || 'global',
    visibility: p.visibility, pinned: !!p.pinned, featured: !!p.featured, locked: !!p.locked,
    official: !!p.official, isAnnouncement: !!p.isAnnouncement,
    encrypted, enc: encrypted ? (p.enc || '') : '',
    burnAfterRead: !!p.burnAfterRead, burnViewsLeft: p.burnViewsLeft || 0,
    status: p.status, createdAt: p.createdAt, updatedAt: p.updatedAt,
    counts: p.counts || { views: 0, likes: 0, comments: 0, favorites: 0 },
    author: author ? { id: author.id, username: author.username, displayName: author.displayName, avatar: author.avatar, official: !!author.official, level: levelFromMeow(author.economy?.meow).level, customLevel: author.customLevel || null } : null,
    liked: viewer ? !!(await env.DB.get(`like:${p.id}:${viewer.id}`)) : false,
    favorited: viewer ? !!(await env.DB.get(`fav:${viewer.id}:${p.id}`)) : false,
    reactions: viewer ? await getReactionSummary(env, `post:${p.id}`, viewer.id) : [],
  };
}

router.get('/api/posts', async (ctx) => {
  const { env, user, url } = ctx;
  const limit = clamp(url.searchParams.get('limit') || 15, 1, 50);
  const board = url.searchParams.get('board') || '';
  const authorId = url.searchParams.get('author') || '';
  const scope = url.searchParams.get('scope') || '';
  const q = (url.searchParams.get('q') || '').toLowerCase().trim();
  const mine = url.searchParams.get('mine') === '1';
  const featuredOnly = url.searchParams.get('featured') === '1';
  const groupId = url.searchParams.get('groupId') || '';

  let prefix = 'ixp:all:';
  if (groupId) prefix = `ixg:group:${groupId}:`;
  else if (mine) { if (!user) unauth(); prefix = `ixp:user:${user.id}:`; }
  else if (authorId) prefix = `ixp:user:${authorId}:`;
  else if (board) prefix = `ixp:board:${board}:`;
  else if (scope) prefix = `ixp:scope:${scopeKeyOf(scope)}:`;

  // 搜索或过滤时多抓一些再筛
  const fetchN = q ? Math.min(300, limit * 8) : limit * 3;
  const { keys, cursor, list_complete } = await KV.list(env, prefix, fetchN, url.searchParams.get('cursor'));
  const ids = await indexPostIds(env, keys);
  const posts = (await KV.many(env, ids.map((i) => `post:${i}`))).filter(Boolean);

  const out = [];
  for (const p of posts) {
    try {
      if (p.status === 'deleted') continue;
      if (featuredOnly && !p.featured) continue;
      if (q && !(`${p.title} ${p.excerpt} ${(p.tags || []).join(' ')}`.toLowerCase().includes(q))) continue;
      if (!(await canViewPost(env, p, user))) continue;
      out.push(await postCard(env, p, user));
      if (out.length >= limit) break;
    } catch (e) {
      // 单条记录损坏不应拖垮整个列表：跳过并记日志
      console.error('[posts] skip bad record', p && p.id, e?.message || e);
    }
  }
  out.sort((a, b) => (b.pinned - a.pinned) || (b.createdAt - a.createdAt));
  return ok({ items: out, cursor: list_complete ? null : cursor }, ctx);
});

/* --------------------------- 全局搜索 -------------------------------- */

async function searchUsers(env, q, limit, cursor) {
  const { keys, cursor: cur, list_complete } = await KV.list(env, 'user:', limit * 6, cursor);
  const out = [];
  for (const k of keys) {
    const u = await KV.getJSON(env, k.name);
    if (!u || u.flags?.deleted) continue;
    const hay = `${u.username} ${u.displayName || ''} ${u.email || ''}`.toLowerCase();
    if (!hay.includes(q)) continue;
    out.push({ kind: 'user', user: publicUser(u, null) });
    if (out.length >= limit) break;
  }
  return { items: out, cursor: list_complete ? null : cur };
}

async function searchPosts(env, user, q, kind, limit, cursor) {
  const prefix = 'ixp:all:';
  const fetchN = q ? Math.min(400, limit * 10) : limit * 3;
  const { keys, cursor: cur, list_complete } = await KV.list(env, prefix, fetchN, cursor);
  const ids = await indexPostIds(env, keys);
  const posts = (await KV.many(env, ids.map((i) => `post:${i}`))).filter(Boolean);
  const out = [];
  for (const p of posts) {
    if (p.status === 'deleted') continue;
    if (kind === 'article' && p.kind !== 'article') continue;
    if (kind === 'post' && p.kind === 'article') continue;
    if (q && !`${p.title} ${p.excerpt} ${(p.tags || []).join(' ')}`.toLowerCase().includes(q)) continue;
    if (!(await canViewPost(env, p, user))) continue;
    out.push({ kind, post: await postCard(env, p, user) });
    if (out.length >= limit) break;
  }
  out.sort((a, b) => (b.post.pinned - a.post.pinned) || (b.post.createdAt - a.post.createdAt));
  return { items: out, cursor: list_complete ? null : cur };
}

async function searchFiles(env, q, limit, cursor) {
  const { keys, cursor: cur, list_complete } = await KV.list(env, 'pubfile:', limit * 6, cursor);
  const out = [];
  for (const k of keys) {
    let rec; try { rec = JSON.parse(k.value || (await env.DB.get(k.name)) || 'null'); } catch (e) { rec = null; }
    if (!rec) continue;
    if (q && !(rec.name || '').toLowerCase().includes(q)) continue;
    out.push({ kind: 'file', file: rec });
    if (out.length >= limit) break;
  }
  return { items: out, cursor: list_complete ? null : cur };
}

async function searchAnnouncements(env, q, limit) {
  const cfg = await getSiteConfig(env);
  const list = (cfg.announcements || []).filter((a) =>
    !q || `${a.title} ${a.body || ''}`.toLowerCase().includes(q));
  const out = list.slice(0, limit).map((a) => ({ kind: 'announcement', announcement: a }));
  return { items: out, cursor: null };
}

router.get('/api/search', async (ctx) => {
  const { env, user, url } = ctx;
  const q = (url.searchParams.get('q') || '').toLowerCase().trim();
  const type = url.searchParams.get('type') || 'all';
  const limit = clamp(url.searchParams.get('limit') || 12, 1, 50);
  const cursor = url.searchParams.get('cursor') || '';
  if (!q) return ok({ q, type, items: [], cursor: null, empty: true }, ctx);

  const results = [];
  let nextCursor = null;

  if (type === 'all' || type === 'user') {
    const r = await searchUsers(env, q, type === 'all' ? 5 : limit, type === 'all' ? '' : cursor);
    results.push(...r.items); if (type !== 'all') nextCursor = r.cursor;
  }
  if (type === 'all' || type === 'post') {
    const r = await searchPosts(env, user, q, 'post', type === 'all' ? 8 : limit, type === 'all' ? '' : cursor);
    results.push(...r.items); if (type !== 'all') nextCursor = r.cursor;
  }
  if (type === 'all' || type === 'article') {
    const r = await searchPosts(env, user, q, 'article', type === 'all' ? 8 : limit, type === 'all' ? '' : cursor);
    results.push(...r.items); if (type !== 'all') nextCursor = r.cursor;
  }
  if (type === 'all' || type === 'file') {
    const r = await searchFiles(env, q, type === 'all' ? 5 : limit, type === 'all' ? '' : cursor);
    results.push(...r.items); if (type !== 'all') nextCursor = r.cursor;
  }
  if (type === 'all' || type === 'announcement') {
    const r = await searchAnnouncements(env, q, type === 'all' ? 5 : limit);
    results.push(...r.items); if (type !== 'all') nextCursor = r.cursor;
  }
  return ok({ q, type, items: results, cursor: nextCursor }, ctx);
});

/* --------------------------- 公共封禁公示 -------------------------------- */

function maskEmail(e) {
  if (!e) return '';
  e = String(e);
  if (e.length <= 8) return '***';
  return e.slice(0, 3) + '*'.repeat(Math.max(3, e.length - 8)) + e.slice(-5);
}
function maskIP(ip) {
  if (!ip) return '';
  ip = String(ip);
  if (ip.includes('.')) return ip.split('.').map((p, i) => (i < 2 ? p : '*')).join('.');
  if (ip.includes(':')) return ip.split(':').map((p, i) => (i < 2 ? p : '*')).join(':');
  return ip.slice(0, 3) + '***';
}

async function loadBans(env) {
  const { keys } = await KV.list(env, 'user:', 300);
  const users = await KV.many(env, keys.map((k) => k.name));
  const userBans = users
    .filter((u) => u && u.flags && u.flags.banned)
    .map((u) => ({
      username: u.username,
      displayName: u.displayName || u.username,
      maskedAvatar: true,
      emailMasked: maskEmail(u.email),
      reason: u.flags.bannedReason || '',
      until: u.flags.bannedUntil || 0,
      bannedAt: u.flags.bannedAt || 0,
    }));
  const ipRecs = await KV.many(env, (await KV.list(env, 'ban:ip:', 300)).keys.map((k) => k.name));
  const ipBans = ipRecs
    .filter(Boolean)
    .map((r) => ({
      ipMasked: maskIP(r.ip),
      reason: r.reason || '',
      until: r.until || 0,
      createdAt: r.createdAt || 0,
    }));
  return { userBans, ipBans };
}

router.get('/api/bans', async (ctx) => {
  const { env } = ctx;
  const bans = await loadBans(env);
  return ok({ ...bans, count: bans.userBans.length + bans.ipBans.length }, ctx);
});

/* --------------------------- 用户 / Telegram 解析 ------------------------- */

router.get('/api/users/lookup', async (ctx) => {
  const { env, url } = ctx;
  const q = (url.searchParams.get('username') || url.searchParams.get('q') || '').trim();
  const id = url.searchParams.get('id') || '';
  let u = null;
  if (id) u = await getUser(env, id);
  else if (q) u = await findUserByUsername(env, q);
  if (!u || u.flags?.deleted) return ok({ user: null }, ctx);
  return ok({ user: publicUser(u, null, { roleTags: await roleTagsOf(env, u, 'global') }) }, ctx);
});

async function resolveTelegram(env, raw) {
  let u; try { u = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  // 提取 handle：t.me/username、t.me/s/username、t.me/c/...、@username 形式
  const m = u.pathname.match(/^\/(?:s\/)?([A-Za-z0-9_]{3,})\/?$/);
  const handle = m ? m[1] : '';
  const candidates = [];
  if (handle) candidates.push('https://t.me/s/' + handle); // 频道公开预览页（带 og:image 头像）
  if (handle) candidates.push('https://t.me/' + handle);   // 群组 / 加入页（部分带 og:image）
  candidates.push(u.toString());
  for (const c of candidates) {
    let html, cUrl;
    try { cUrl = new URL(c); } catch { continue; }
    try {
      const res = await fetch(c, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarytOpensBot/1.0)', 'Referer': 'https://t.me/' },
        redirect: 'follow',
      });
      if (!res.ok) continue;
      html = await res.text();
    } catch { continue; }
    if (!html) continue;
    const meta = (prop) => {
      const a = html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'));
      if (a) return a[1];
      const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i'));
      return b ? b[1] : null;
    };
    const abs = (s) => { try { return new URL(s, cUrl).toString(); } catch { return s; } };
    // 优先 og:image / twitter:image（相对地址补全为绝对地址）
    let avatar = meta('og:image') || meta('twitter:image') || '';
    if (avatar) avatar = abs(avatar);
    // 兜底：Telegram 页面结构里的头像 <img class="tgme_page_photo_image" src="...">
    if (!avatar) {
      const img =
        html.match(/<img[^>]+class=["'][^"']*tgme_page_photo_image[^"']*["'][^>]+src=["']([^"']+)["']/i) ||
        html.match(/<img[^>]+src=["']([^"']+)["'][^>]+class=["'][^"']*tgme_page_photo_image[^"']*["']/i);
      if (img) avatar = abs(img[1]);
    }
    const titleTag = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
    const title = meta('og:title') || titleTag || (handle ? '@' + handle : '');
    if (avatar || title) return { avatar, title, url: u.toString() };
  }
  return null;
}

router.get('/api/telegram/resolve', async (ctx) => {
  const { env, url } = ctx;
  const target = url.searchParams.get('url') || '';
  if (!target) return ok({ avatar: '', title: '' }, ctx);
  const r = await resolveTelegram(env, target);
  return ok({ avatar: r?.avatar || '', title: r?.title || '', url: r?.url || target }, ctx);
});

/* Telegram 头像代理：t.me 的头像多在 Telegram CDN 上且有防盗链，
   直接 <img src> 会加载失败。这里由 Worker 代取并流式返回，绕过防盗链与 CORS。 */
router.get('/api/telegram/avatar', async (ctx) => {
  const { url } = ctx;
  const u = url.searchParams.get('u');
  if (!u) return fail(400, 'BAD', 'missing u', ctx);
  let parsed; try { parsed = new URL(u); } catch { return fail(400, 'BAD', 'bad url', ctx); }
  const allowed = ['t.me', 'telegram.org', 'cdn-telegram.org', 'telesco.pe'];
  const okHost = allowed.some((h) => parsed.hostname === h || parsed.hostname.endsWith('.' + h));
  if (!okHost) return fail(403, 'FORBIDDEN', 'host not allowed', ctx);
  try {
    const res = await fetch(parsed.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarytOpensBot/1.0)', 'Referer': 'https://t.me/' },
    });
    if (!res.ok) return fail(502, 'UPSTREAM', 'fetch failed', ctx);
    const buf = await res.arrayBuffer();
    const ct = res.headers.get('content-type') || 'image/jpeg';
    return new Response(buf, {
      headers: {
        'content-type': ct,
        'cache-control': 'public, max-age=86400',
        'access-control-allow-origin': '*',
      },
    });
  } catch { return fail(502, 'UPSTREAM', 'fetch failed', ctx); }
});

/* --------------------------- Discord 解析 ------------------------- */
// 解析 Discord 服务器图标 / 个人主页头像。
//  - 邀请链接 discord.gg/<code> 或 discord.com/invite/<code>：调用 Discord API 取 guild icon
//  - 直接 CDN 链接 cdn.discordapp.com / media.discordapp.net：原样返回（浏览器可直连热链）
async function resolveDiscord(env, raw) {
  let u; try { u = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase();
  if (host.endsWith('cdn.discordapp.com') || host.endsWith('media.discordapp.net')) {
    return { avatar: u.toString(), title: '', url: u.toString() };
  }
  let code = '';
  if (host === 'discord.gg' || host.endsWith('.discord.gg')) code = u.pathname.replace(/^\/+/, '').replace(/\/$/, '');
  else if (u.pathname.startsWith('/invite/')) code = u.pathname.split('/invite/')[1].replace(/^\/+/, '').replace(/\/$/, '');
  if (!code) return null;
  try {
    const res = await fetch('https://discord.com/api/v9/invites/' + encodeURIComponent(code) + '?with_counts=true', {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    });
    if (!res.ok) return null;
    const j = await res.json();
    const g = j.guild;
    if (!g || !g.id) return null;
    let avatar = '';
    if (g.icon) {
      const ext = g.icon.startsWith('a_') ? '.gif' : '.png';
      avatar = 'https://cdn.discordapp.com/icons/' + g.id + '/' + g.icon + ext;
    }
    return { avatar, title: g.name || '', url: 'https://discord.gg/' + code };
  } catch { return null; }
}

router.get('/api/discord/resolve', async (ctx) => {
  const { env, url } = ctx;
  const target = url.searchParams.get('url') || '';
  if (!target) return ok({ avatar: '', title: '' }, ctx);
  const r = await resolveDiscord(env, target);
  return ok({ avatar: r?.avatar || '', title: r?.title || '', url: r?.url || target }, ctx);
});

/* --------------------------- 更新日志 ------------------------- */
function defaultChangelog() {
  return [
    { version: 'v1.0 · 地基阶段', date: '2026-08', body:
      '## 经济系统上线（地基）\n- 引入 **MO值**（积分，可消费）与 **Meow值**（等级经验，累积）。\n- 新增每日签到：连续签到叠加奖励。\n- 新增积分商城：可兑换加速券、经验加成券、徽章等。\n- 新增「经济中心」页面（`/economy.html`）。' },
    { version: '加密与隐私', date: '2026-08', body:
      '## 端到端加密与阅后即焚\n- 发布文章可启用 **MeowLink / PawCrypt** 端到端加密，密钥仅由发布者掌握。\n- 支持「阅后即焚」：限定查看次数后内容自动销毁。' },
    { version: '权限与作用域', date: '2026-08', body:
      '## 权限深化\n- 更细的权限目录（经济、外观、内容、问卷、身份组等）。\n- 超级管理员可按权限 / 身份组 / 用户设置**作用区域（scope）**。' },
  ];
}

router.get('/api/changelog', async (ctx) => {
  let list = await KV.getJSON(ctx.env, 'cfg:changelog', []);
  if (!Array.isArray(list) || !list.length) { list = defaultChangelog(); await KV.putJSON(ctx.env, 'cfg:changelog', list); }
  return ok({ items: list }, ctx);
});
router.put('/api/changelog', async (ctx) => {
  if (!ctx.user || !(await isSuperAdmin(ctx.env, ctx.user))) return fail(403, 'FORBIDDEN', 'super admin only', ctx);
  const body = await readBody(ctx.req);
  const items = Array.isArray(body.items) ? body.items : [];
  await KV.putJSON(ctx.env, 'cfg:changelog', items);
  return ok({ ok: true }, ctx);
});

/* ==========================================================================
 * 交流组（Exchange Group，贴吧式：任何用户可创建 / 加入，官方可标记精选或公示违规）
 *   注意：与版块自带的 groupKey 群组互不干扰，此处使用独立前缀 exg: / ixexg:
 * ========================================================================== */
function exgKey(id) { return `exg:${id}`; }
function exgMemKey(g, u) { return `exgmem:${g}:${u}`; }
async function exgGet(env, id) { return KV.getJSON(env, exgKey(id)); }
async function exgPut(env, g) { await KV.putJSON(env, exgKey(g.id), g); }
async function exgCard(env, g, user, isMember) {
  const owner = await getUser(env, g.ownerId);
  return {
    id: g.id, name: g.name, description: g.description || '', icon: g.icon || '', banner: g.banner || '',
    category: g.category || '', visibility: g.visibility || 'public', about: g.about || '',
    ownerId: g.ownerId, ownerName: owner ? owner.displayName : '',
    memberCount: g.memberCount || 0, postCount: g.postCount || 0,
    featured: !!g.featured, violated: !!g.violated, createdAt: g.createdAt,
    isMember: !!isMember,
    isOwner: !!user && user.id === g.ownerId,
    canManage: !!user && (user.id === g.ownerId || await canPublishAnnouncement(env, user) || await hasPerm(env, user, 'post.pin', 'global')),
  };
}

router.get('/api/exgroups', async (ctx) => {
  const { env, user, url } = ctx;
  const limit = clamp(url.searchParams.get('limit') || 20, 1, 50);
  const featuredOnly = url.searchParams.get('featured') === '1';
  const mine = url.searchParams.get('mine') === '1';
  const q = (url.searchParams.get('q') || '').toLowerCase().trim();
  let prefix = 'ixexg:all:';
  if (mine) { if (!user) unauth(); prefix = `ixexg:user:${user.id}:`; }
  else if (featuredOnly) prefix = 'ixexg:featured:';
  const { keys, cursor, list_complete } = await KV.list(env, prefix, limit * 3, url.searchParams.get('cursor'));
  const ids = keys.map((k) => k.name.split(':').slice(-1)[0]);
  const groups = (await KV.many(env, ids.map((i) => exgKey(i)))).filter(Boolean);
  const out = [];
  for (const g of groups) {
    if (g.status === 'deleted') continue;
    if (q && !`${g.name} ${g.description || ''}`.toLowerCase().includes(q)) continue;
    const isMember = user ? !!(await KV.getJSON(env, exgMemKey(g.id, user.id))) : false;
    out.push(await exgCard(env, g, user, isMember));
    if (out.length >= limit) break;
  }
  out.sort((a, b) => (Number(!!b.featured) - Number(!!a.featured)) || ((b.memberCount || 0) - (a.memberCount || 0)) || (b.createdAt - a.createdAt));
  return ok({ items: out, cursor: list_complete ? null : cursor }, ctx);
});

router.post('/api/exgroups', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  await requirePerm(env, user, 'post.create', 'global');
  const name = String(body.name || '').trim().slice(0, 40);
  if (name.length < 2) bad('组名至少 2 个字符');
  const id = uid('g');
  const g = {
    id, name,
    description: String(body.description || '').slice(0, 500),
    icon: String(body.icon || '').slice(0, 500),
    banner: String(body.banner || '').slice(0, 500),
    category: String(body.category || '其他').slice(0, 20),
    visibility: body.visibility === 'private' ? 'private' : 'public',
    about: String(body.about || '').slice(0, 2000),
    ownerId: user.id, memberCount: 1, postCount: 0,
    featured: false, violated: false, status: 'active', createdAt: nowMs(),
  };
  await exgPut(env, g);
  await env.DB.put(`ixexg:all:${g.createdAt}:${g.id}`, g.id);
  await env.DB.put(`ixexg:user:${user.id}:${g.createdAt}:${g.id}`, g.id);
  await KV.putJSON(env, exgMemKey(g.id, user.id), { joinedAt: nowMs(), role: 'owner' });
  return ok({ group: await exgCard(env, g, user, true) }, ctx);
});

router.get('/api/exgroups/:id', async (ctx) => {
  const { env, user, params } = ctx;
  const g = await exgGet(env, params.id);
  if (!g || g.status === 'deleted') notfound('交流组不存在');
  const isMember = user ? !!(await KV.getJSON(env, exgMemKey(g.id, user.id))) : false;
  return ok({ group: await exgCard(env, g, user, isMember) }, ctx);
});

router.post('/api/exgroups/:id/join', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const g = await exgGet(env, params.id);
  if (!g || g.status === 'deleted') notfound('交流组不存在');
  const key = exgMemKey(g.id, user.id);
  const isMember = !!(await KV.getJSON(env, key));
  const leave = !!body.leave;
  if (leave && isMember) {
    await KV.del(env, key);
    g.memberCount = Math.max(0, (g.memberCount || 0) - 1);
    await exgPut(env, g);
    await KV.del(env, `ixexg:user:${user.id}:${g.createdAt}:${g.id}`);
  } else if (!leave && !isMember) {
    await KV.putJSON(env, key, { joinedAt: nowMs(), role: 'member' });
    g.memberCount = (g.memberCount || 0) + 1;
    await exgPut(env, g);
    await env.DB.put(`ixexg:user:${user.id}:${g.createdAt}:${g.id}`, g.id);
  }
  const nowMember = !!(await KV.getJSON(env, key));
  return ok({ isMember: nowMember, memberCount: g.memberCount || 0 }, ctx);
});

router.put('/api/exgroups/:id', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const g = await exgGet(env, params.id);
  if (!g || g.status === 'deleted') notfound('交流组不存在');
  const isOwner = user.id === g.ownerId;
  const isOfficial = await canPublishAnnouncement(env, user);
  const canPin = await hasPerm(env, user, 'post.pin', 'global');
  if (!isOwner && !isOfficial && !canPin) forbid('无权管理该交流组');

  if (isOwner) {
    if (body.name !== undefined) g.name = String(body.name).slice(0, 40);
    if (body.description !== undefined) g.description = String(body.description).slice(0, 500);
    if (body.icon !== undefined) g.icon = String(body.icon).slice(0, 500);
    if (body.banner !== undefined) g.banner = String(body.banner).slice(0, 500);
    if (body.category !== undefined) g.category = String(body.category).slice(0, 20);
    if (body.about !== undefined) g.about = String(body.about).slice(0, 2000);
    if (body.visibility !== undefined) g.visibility = body.visibility === 'private' ? 'private' : 'public';
  }
  // 官方 / 管理员可标记精选、公示违规、下架
  if (body.featured !== undefined && (isOfficial || canPin)) {
    const was = !!g.featured; g.featured = !!body.featured;
    if (g.featured && !was) await env.DB.put(`ixexg:featured:${g.createdAt}:${g.id}`, g.id);
    if (!g.featured && was) await KV.del(env, `ixexg:featured:${g.createdAt}:${g.id}`);
  }
  if (body.violated !== undefined && (isOfficial || canPin)) g.violated = !!body.violated;
  if (body.status !== undefined && (isOfficial || canPin) && ['active', 'deleted'].includes(body.status)) {
    g.status = body.status;
    if (body.status === 'deleted') {
      await KV.del(env, exgKey(g.id));
      await KV.del(env, `ixexg:all:${g.createdAt}:${g.id}`);
    }
  }
  if (g.status !== 'deleted') await exgPut(env, g);
  const isMember = !!(await KV.getJSON(env, exgMemKey(g.id, user.id)));
  return ok({ group: await exgCard(env, g, user, isMember) }, ctx);
});


/* ==========================================================================
 * 21.x 问卷 / 调研系统（管理层可发，用户可答）
 *   管理层 = 超级管理员 / 站点管理员 / 官方账号
 * ========================================================================== */
async function canManageSurveys(env, user) {
  if (!user) return false;
  if (await isSuperAdmin(env, user)) return true;
  if (user.official) return true;
  if ((user.roles?.global || []).some((r) => r === 'role_admin')) return true;
  return false;
}
const SURVEY_IDX = 'survey:idx';
async function surveyListIdx(env) { return (await KV.getJSON(env, SURVEY_IDX, [])) || []; }
async function surveySaveIdx(env, arr) { await KV.putJSON(env, SURVEY_IDX, arr); }

router.get('/api/surveys', async (ctx) => {
  const { env, user, url } = ctx;
  const scope = scopeKeyOf(url.searchParams.get('scope') || 'global');
  const status = url.searchParams.get('status') || 'open';
  const mgmt = await canManageSurveys(env, user);
  let list = (await surveyListIdx(env)).filter((s) => s.scope === scope);
  if (!mgmt) list = list.filter((s) => (s.status || 'open') === 'open');
  else if (status !== 'all') list = list.filter((s) => (s.status || 'open') === status);
  list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const out = await Promise.all(list.slice(0, 100).map(async (meta) => {
    const s = await KV.getJSON(env, 'survey:' + meta.id, null);
    if (!s) return null;
    const item = {
      id: s.id, title: s.title, description: s.description || '', status: s.status || 'open',
      scope: s.scope, createdAt: s.createdAt, closesAt: s.closesAt || null,
      questionCount: (s.questions || []).length, responseCount: s.responseCount || 0,
      authorName: s.authorName || '',
    };
    if (user) {
      const mine = await KV.getJSON(env, 'survey:resp:' + s.id + ':' + user.id, null);
      item.answered = !!mine;
    }
    return item;
  }));
  return ok({ surveys: out.filter(Boolean), canManage: mgmt }, ctx);
});

router.get('/api/surveys/:id', async (ctx) => {
  const { env, user, params } = ctx;
  const s = await KV.getJSON(env, 'survey:' + params.id, null);
  if (!s) notfound('问卷不存在');
  const d = {
    id: s.id, title: s.title, description: s.description || '', status: s.status || 'open',
    scope: s.scope, createdAt: s.createdAt, closesAt: s.closesAt || null,
    questions: s.questions || [], responseCount: s.responseCount || 0, authorName: s.authorName || '',
    canManage: await canManageSurveys(env, user),
  };
  if (user) {
    const mine = await KV.getJSON(env, 'survey:resp:' + s.id + ':' + user.id, null);
    d.myResponse = mine ? mine.answers : null;
    d.answered = !!mine;
  }
  return ok({ survey: d }, ctx);
});

router.post('/api/surveys', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (!await canManageSurveys(env, user)) forbid('仅超级管理员、站点管理员或官方账号可发布问卷');
  const scope = scopeKeyOf(body.scope || 'global');
  const title = String(body.title || '').trim();
  if (title.length < 2) bad('问卷标题至少 2 个字符');
  const questions = Array.isArray(body.questions) ? body.questions : [];
  if (!questions.length) bad('至少需要 1 道题');
  const clean = questions.slice(0, 30).map((q, i) => {
    const type = ['single', 'multiple', 'text'].includes(q.type) ? q.type : 'single';
    const opts = (type === 'text') ? [] : (Array.isArray(q.options) ? q.options.map((o) => String(o).slice(0, 80)).filter(Boolean).slice(0, 20) : []);
    return { id: 'q' + (i + 1), type, title: String(q.title || '').slice(0, 200), required: !!q.required, options: opts };
  }).filter((q) => q.title && q.title.trim());
  if (!clean.length) bad('没有有效的题目');
  const id = uid('s');
  const survey = {
    id, title, description: String(body.description || '').slice(0, 2000), scope,
    status: 'open', questions: clean, createdAt: nowMs(),
    closesAt: body.closesAt ? Number(body.closesAt) : null,
    authorId: user.id, authorName: user.displayName || user.username, responseCount: 0,
  };
  await KV.putJSON(env, 'survey:' + id, survey);
  const idx = await surveyListIdx(env);
  idx.push({ id, scope, status: 'open', title, createdAt: survey.createdAt });
  await surveySaveIdx(env, idx);
  return ok({ survey }, ctx);
});

router.post('/api/surveys/:id/respond', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const s = await KV.getJSON(env, 'survey:' + params.id, null);
  if (!s) notfound('问卷不存在');
  if ((s.status || 'open') !== 'open') bad('该问卷已关闭');
  if (s.closesAt && nowMs() > s.closesAt) bad('该问卷已截止');
  await guardRate(env, 'survey:' + s.id + ':' + user.id, 1, 60, '提交过于频繁');
  const ans = Array.isArray(body.answers) ? body.answers : [];
  const map = {};
  for (const q of (s.questions || [])) {
    const a = ans.find((x) => x && x.qid === q.id);
    const empty = a == null || (Array.isArray(a.value) ? a.value.length === 0 : !(a.value || '').toString().trim());
    if (q.required && empty) bad('请完成必答题：' + q.title);
    if (q.type === 'multiple') {
      const v = Array.isArray(a?.value) ? a.value : [];
      map[q.id] = v.filter((x) => q.options.includes(x)).slice(0, q.options.length);
    } else if (q.type === 'single') {
      map[q.id] = q.options.includes(a?.value) ? a.value : null;
    } else {
      map[q.id] = String(a?.value || '').slice(0, 2000);
    }
  }
  const prev = await KV.getJSON(env, 'survey:resp:' + s.id + ':' + user.id, null);
  const isNew = !prev;
  await KV.putJSON(env, 'survey:resp:' + s.id + ':' + user.id, {
    answers: map, createdAt: nowMs(), user: { id: user.id, name: user.displayName || user.username },
  });
  if (isNew) {
    s.responseCount = (s.responseCount || 0) + 1;
    await KV.putJSON(env, 'survey:' + s.id, s);
    const ridx = (await KV.getJSON(env, 'survey:resp:idx:' + s.id, [])) || [];
    if (!ridx.find((x) => x.userId === user.id)) { ridx.push({ userId: user.id, createdAt: nowMs() }); await KV.putJSON(env, 'survey:resp:idx:' + s.id, ridx.slice(-500)); }
  }
  return ok({ ok: true, responseCount: s.responseCount }, ctx);
});

router.get('/api/surveys/:id/results', async (ctx) => {
  const { env, user, params } = ctx;
  const s = await KV.getJSON(env, 'survey:' + params.id, null);
  if (!s) notfound('问卷不存在');
  if (!(await canManageSurveys(env, user))) forbid('仅发布者或管理层可查看统计');
  const idx = (await KV.getJSON(env, 'survey:resp:idx:' + s.id, [])) || [];
  const responses = [];
  for (const r of idx.slice(-200)) {
    const rec = await KV.getJSON(env, 'survey:resp:' + s.id + ':' + r.userId, null);
    if (rec) responses.push(rec);
  }
  return ok({ survey: { id: s.id, title: s.title, questions: s.questions }, responses, responseCount: s.responseCount || 0 }, ctx);
});

router.post('/api/surveys/:id/close', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const s = await KV.getJSON(env, 'survey:' + params.id, null);
  if (!s) notfound('问卷不存在');
  if (!(await canManageSurveys(env, user))) forbid('仅发布者或管理层可管理');
  s.status = 'closed';
  await KV.putJSON(env, 'survey:' + s.id, s);
  const idx = await surveyListIdx(env);
  const it = idx.find((x) => x.id === s.id); if (it) it.status = 'closed';
  await surveySaveIdx(env, idx);
  return ok({ ok: true }, ctx);
});

router.delete('/api/surveys/:id', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const s = await KV.getJSON(env, 'survey:' + params.id, null);
  if (!s) notfound('问卷不存在');
  if (!(await canManageSurveys(env, user))) forbid('仅发布者或管理层可管理');
  await KV.putJSON(env, 'survey:' + s.id, null);
  const idx = await surveyListIdx(env);
  await surveySaveIdx(env, idx.filter((x) => x.id !== s.id));
  return ok({ ok: true }, ctx);
});

/* ------------------------- 社区意见反馈（用户提交） ------------------------- */
router.post('/api/feedback', async (ctx) => {
  const { env, user, body, request } = ctx;
  if (await isMuted(env, user, 'global')) forbid('你当前处于禁言状态，无法提交反馈');
  const rlKey = 'fb:' + (user ? user.id : (request.headers.get('cf-connecting-ip') || 'anon'));
  await guardRate(env, rlKey, 5, 600, '提交过于频繁，请稍后再试');
  const type = ['bug', 'suggest', 'other'].includes(body.type) ? body.type : 'other';
  const message = String(body.message || '').trim();
  if (message.length < 2) bad('反馈内容至少 2 个字符');
  const id = uid('fb');
  const rec = {
    id, type, message: message.slice(0, 4000), contact: String(body.contact || '').slice(0, 200),
    anonymous: !user, user: user ? { id: user.id, name: user.displayName || user.username, username: user.username } : null,
    createdAt: nowMs(), status: 'new',
  };
  await KV.putJSON(env, 'feedback:' + id, rec);
  const fidx = (await KV.getJSON(env, 'feedback:idx', [])) || [];
  fidx.push(id); await KV.putJSON(env, 'feedback:idx', fidx.slice(-500));
  // 若超管设置了反馈邮箱且已配置邮件服务，则自动转发一封通知邮件
  try {
    const cfg = await getSiteConfig(env);
    const to = cfg && cfg.feedback && cfg.feedback.email ? cfg.feedback.email.trim() : '';
    if (to && cfg && cfg.mail) {
      const who = rec.user ? (rec.user.name + ' (@' + rec.user.username + ')') : '匿名用户';
      await sendMail(env, {
        to,
        subject: '[MarytOpens 反馈] ' + (type === 'bug' ? '问题反馈' : type === 'suggest' ? '功能建议' : '其他反馈'),
        text: '类型：' + type + '\n来自：' + who + '\n联系方式：' + (rec.contact || '未留') + '\n\n' + message,
      }, cfg);
    }
  } catch (e) { /* 邮件失败不影响存储 */ }
  return ok({ ok: true, id }, ctx);
});

router.get('/api/admin/feedback', async (ctx) => {
  const { env, user } = ctx;
  if (!user) unauth();
  if (!await canManageSurveys(env, user)) forbid('仅管理层可查看');
  const idx = (await KV.getJSON(env, 'feedback:idx', [])) || [];
  const list = [];
  for (const id of idx.slice(-50).reverse()) {
    const r = await KV.getJSON(env, 'feedback:' + id, null);
    if (r) list.push(r);
  }
  return ok({ feedback: list }, ctx);
});

/** 硬删除文章：清除正文与全部索引（阅后即焚 / 彻底删除复用） */
async function purgePost(env, p) {
  await KV.del(env, `post:${p.id}`);
  await Promise.all([
    KV.del(env, `ixp:all:${p.sid}`), KV.del(env, `ixp:user:${p.authorId}:${p.sid}`),
    KV.del(env, `ixp:board:${p.board}:${p.sid}`), KV.del(env, `ixp:scope:${p.scope}:${p.sid}`),
    ...(p.groupId ? [KV.del(env, `ixg:group:${p.groupId}:${p.sid}`)] : []),
  ]);
  // 连带删除评论
  try {
    const { keys } = await KV.list(env, `cmt:${p.id}:`, 200);
    await Promise.all(keys.map((k) => KV.del(env, k.name)));
  } catch (_) { /* ignore */ }
  bumpStatLazy('posts', -1);
}

router.get('/api/posts/:id', async (ctx) => {
  const { env, user, params } = ctx;
  const p = await KV.getJSON(env, `post:${params.id}`);
  if (!p) notfound('文章不存在');
  if (!(await canViewPost(env, p, user))) forbid('你没有权限查看这篇文章');

  // 阅后即焚：非作者查看时消耗一次剩余次数，耗尽后立即销毁（作者可一直预览）
  let burnConsumed = false;
  if (p.burnAfterRead && (p.burnViewsLeft || 0) > 0 && user && user.id !== p.authorId) {
    p.burnViewsLeft = (p.burnViewsLeft || 1) - 1;
    if (p.burnViewsLeft <= 0) {
      burnConsumed = true;
      ctx.waitUntil(purgePost(env, p));
    } else {
      ctx.waitUntil(KV.putJSON(env, `post:${p.id}`, p));
    }
  }

  p.counts = p.counts || { views: 0, likes: 0, comments: 0, favorites: 0 };
  p.counts.views = (p.counts.views || 0) + 1;
  if (!burnConsumed) ctx.waitUntil(KV.putJSON(env, `post:${p.id}`, p));

  const author = await getUser(env, p.authorId);
  return ok({
    post: {
      ...p,
      author: author ? publicUser(author, user, { roleTags: await roleTagsOf(env, author, p.scope || 'global') }) : null,
      liked: user ? !!(await env.DB.get(`like:${p.id}:${user.id}`)) : false,
      favorited: user ? !!(await env.DB.get(`fav:${user.id}:${p.id}`)) : false,
      canEdit: !!user && (user.id === p.authorId || await hasPerm(env, user, 'post.edit.any', p.scope || 'global')),
      canDelete: !!user && (user.id === p.authorId || await hasPerm(env, user, 'post.delete.any', p.scope || 'global')),
      canModerate: !!user && await hasPerm(env, user, 'post.pin', p.scope || 'global'),
      canManageComments: !!user && (user.id === p.authorId || await hasPerm(env, user, 'post.pin', p.scope || 'global')),
      burnConsumed: !!burnConsumed,
    },
  }, ctx);
});

router.post('/api/posts', async (ctx) => {
  const { env, user, body, request } = ctx;
  if (!user) unauth();
  const scope = scopeKeyOf(body.scope || 'global');
  await requirePerm(env, user, 'post.create', scope);
  if (await isMuted(env, user, scope)) forbid('你当前处于禁言状态，无法发布内容');
  // 加速券：持有有效期内的加速券即免除发帖冷却（一次性券会在此消耗）
  const accel = activeVoucher(user, 'accelerate');
  if (!accel) await guardRate(env, `post:${user.id}`, 10, 600, '发帖过于频繁，请稍后再试');
  else consumeVoucherInline(user, 'accelerate');
  const canOfficial = await canPublishAnnouncement(env, user);
  const cfg = await getSiteConfig(env);
  if (cfg.turnstileOnPost) await guardTurnstile(env, request, body.turnstileToken, 'post');

  const title = String(body.title || '').trim().slice(0, 200);
  if (title.length < 2) bad('标题至少 2 个字符');
  const visibility = VISIBILITIES.includes(body.visibility) ? body.visibility : 'public';
  const id = uid('p');
  const sid = sortableId();
  const encrypted = !!body.encrypted && typeof body.enc === 'string' && body.enc.startsWith('meowlink:');
  const content = encrypted ? '' : sanitizeContent(body.content || '');
  // 阅后即焚：仅发布者可一直预览；他人查看耗尽剩余次数即销毁
  const burnAfterRead = !!body.burnAfterRead;
  const burnViews = clamp(Number(body.burnViews) || (body.burnAfterRead ? 1 : 0), 0, 100);
  const post = {
    id, sid, slug: slugify(title),
    title, content, format: body.format === 'html' ? 'html' : 'markdown',
    excerpt: String(body.excerpt || (encrypted ? '🔒 加密内容' : content.replace(/[#*`>\-\[\]!]/g, ''))).slice(0, 200),
    cover: String(body.cover || '').slice(0, 500),
    tags: (Array.isArray(body.tags) ? body.tags : []).slice(0, 8).map((t) => String(t).slice(0, 24)),
    board: String(body.board || 'general').slice(0, 40),
    groupId: body.groupId ? String(body.groupId).slice(0, 40) : '',
    scope, visibility,
    visibleRoles: Array.isArray(body.visibleRoles) ? body.visibleRoles.slice(0, 20) : [],
    authorId: user.id, status: body.status === 'draft' ? 'draft' : 'published',
    kind: body.kind === 'article' ? 'article' : 'post',
    official: canOfficial && !!body.official,
    isAnnouncement: canOfficial && !!body.announce,
    encrypted, enc: encrypted ? String(body.enc).slice(0, 20000) : '',
    burnAfterRead: !!burnAfterRead, burnViews, burnViewsLeft: burnViews,
    pinned: false, featured: false, locked: false,
    counts: { views: 0, likes: 0, comments: 0, favorites: 0 },
    createdAt: nowMs(), updatedAt: nowMs(),
  };
  await KV.putJSON(env, `post:${id}`, post);
  await env.DB.put(`ixp:all:${sid}`, id, { metadata: { t: post.createdAt, a: user.id, v: visibility } });
  await env.DB.put(`ixp:user:${user.id}:${sid}`, id);
  await env.DB.put(`ixp:board:${post.board}:${sid}`, id);
  await env.DB.put(`ixp:scope:${scope}:${sid}`, id);
  if (post.groupId) {
    await env.DB.put(`ixg:group:${post.groupId}:${sid}`, id);
    const g = await exgGet(env, post.groupId);
    if (g && g.status !== 'deleted') { g.postCount = (g.postCount || 0) + 1; await exgPut(env, g); }
  }
  user.stats = user.stats || {};
  user.stats.posts = (user.stats.posts || 0) + 1;
  // 行为奖励：发帖自动发放 MO / Meow（数值后台可配，经验加成券生效时翻倍）
  const reward = await awardActionInline(env, user, 'post');
  await saveUser(env, user);
  bumpStatLazy('posts');

  // 推送给关注者
  ctx.waitUntil((async () => {
    if (visibility !== 'public' || post.status !== 'published') return;
    const { keys } = await KV.list(env, `folr:${user.id}:`, 200);
    for (const k of keys) {
      const fid = k.name.split(':').pop();
      await pushNotification(env, fid, {
        type: 'newpost', title: `${user.displayName} 发布了新文章`, body: title,
        link: `/post.html?id=${id}`, actor: { id: user.id, name: user.displayName, avatar: user.avatar }, refId: id,
      });
    }
  })());

  return ok({ post: await postCard(env, post, user), reward, economy: economyView(user) }, ctx);
});

router.put('/api/posts/:id', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const p = await KV.getJSON(env, `post:${params.id}`);
  if (!p) notfound('文章不存在');
  const mine = p.authorId === user.id;
  if (!mine) await requirePerm(env, user, 'post.edit.any', p.scope || 'global');
  const canOfficial = await canPublishAnnouncement(env, user);

  if (body.title !== undefined) { p.title = String(body.title).slice(0, 200); p.slug = slugify(p.title); }
  if (body.content !== undefined) p.content = sanitizeContent(body.content);
  // 端到端加密 / 阅后即焚（编辑时也可切换）
  if (body.encrypted !== undefined || body.enc !== undefined) {
    if (body.encrypted && typeof body.enc === 'string' && body.enc.startsWith('meowlink:')) {
      p.encrypted = true; p.enc = String(body.enc).slice(0, 20000); p.content = '';
    } else if (body.encrypted === false) {
      p.encrypted = false; p.enc = '';
      if (body.content !== undefined) p.content = sanitizeContent(body.content);
    }
  }
  if (body.burnAfterRead !== undefined) {
    p.burnAfterRead = !!body.burnAfterRead;
    if (p.burnAfterRead) {
      const v = clamp(Number(body.burnViews) || (p.burnViewsLeft || 1), 0, 100);
      p.burnViews = v; if (p.burnViewsLeft == null || p.burnViewsLeft === 0) p.burnViewsLeft = v;
    } else { p.burnViews = 0; p.burnViewsLeft = 0; }
  }
  if (body.excerpt !== undefined) p.excerpt = String(body.excerpt).slice(0, 200);
  if (body.cover !== undefined) p.cover = String(body.cover).slice(0, 500);
  if (body.tags !== undefined) p.tags = (body.tags || []).slice(0, 8).map((t) => String(t).slice(0, 24));
  if (body.visibility && VISIBILITIES.includes(body.visibility)) p.visibility = body.visibility;
  if (body.visibleRoles !== undefined) p.visibleRoles = (body.visibleRoles || []).slice(0, 20);
  if (body.pinned !== undefined && (mine || await hasPerm(env, user, 'post.pin', p.scope))) p.pinned = !!body.pinned;
  if (body.featured !== undefined && await hasPerm(env, user, 'post.pin', p.scope)) p.featured = !!body.featured;
  if (body.locked !== undefined && await hasPerm(env, user, 'post.lock', p.scope)) p.locked = !!body.locked;
  // 官方账号 / 超级管理员可把文章标记为官方发布或官方公告（公告允许置顶）
  if (body.official !== undefined && canOfficial) p.official = !!body.official;
  if (body.announce !== undefined && canOfficial) {
    p.isAnnouncement = !!body.announce;
    if (p.isAnnouncement && body.pinned !== undefined) p.pinned = !!body.pinned;
  }
  if (body.status !== undefined && mine && ['draft', 'published'].includes(body.status)) p.status = body.status;
  p.updatedAt = nowMs();
  await KV.putJSON(env, `post:${p.id}`, p);
  return ok({ post: await postCard(env, p, user) }, ctx);
});

// 标记为「官方发布」（仅官方账号 / 超级管理员）
router.post('/api/posts/:id/official', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  if (!await canPublishAnnouncement(env, user)) forbid('仅超级管理员或官方账号可标记为官方发布');
  const p = await KV.getJSON(env, `post:${params.id}`);
  if (!p) notfound('文章不存在');
  p.official = !!body.official;
  p.updatedAt = nowMs();
  await KV.putJSON(env, `post:${p.id}`, p);
  await writeAudit(env, user, 'post.official', `${p.title} -> ${p.official}`);
  return ok({ post: await postCard(env, p, user) }, ctx);
});

// 标记为「官方公告」（仅官方账号 / 超级管理员），可同时置顶，并在官方公告页展示
router.post('/api/posts/:id/announce', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  if (!await canPublishAnnouncement(env, user)) forbid('仅超级管理员或官方账号可发布官方公告');
  const p = await KV.getJSON(env, `post:${params.id}`);
  if (!p) notfound('文章不存在');
  p.isAnnouncement = !!body.announce;
  if (p.isAnnouncement && body.pinned !== undefined) p.pinned = !!body.pinned;
  p.updatedAt = nowMs();
  await KV.putJSON(env, `post:${p.id}`, p);
  await writeAudit(env, user, 'post.announce', `${p.title} -> ${p.isAnnouncement}`);
  return ok({ post: await postCard(env, p, user) }, ctx);
});

router.delete('/api/posts/:id', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const p = await KV.getJSON(env, `post:${params.id}`);
  if (!p) notfound('文章不存在');
  const mine = p.authorId === user.id;
  if (!mine) await requirePerm(env, user, 'post.delete.any', p.scope || 'global');

  const hard = mine || await isSuperAdmin(env, user);
  if (hard) {
    await KV.del(env, `post:${p.id}`);
    await Promise.all([
      KV.del(env, `ixp:all:${p.sid}`), KV.del(env, `ixp:user:${p.authorId}:${p.sid}`),
      KV.del(env, `ixp:board:${p.board}:${p.sid}`), KV.del(env, `ixp:scope:${p.scope}:${p.sid}`),
      ...(p.groupId ? [KV.del(env, `ixg:group:${p.groupId}:${p.sid}`)] : []),
    ]);
  } else {
    p.status = 'deleted'; p.deletedBy = user.id; p.deletedAt = nowMs();
    await KV.putJSON(env, `post:${p.id}`, p);
    await pushNotification(env, p.authorId, {
      type: 'moderation', title: '你的文章已被移除', body: `《${p.title}》被管理员移除`, refId: p.id });
  }
  bumpStatLazy('posts', -1);
  return ok({ deleted: p.id, hard }, ctx);
});

/* --------------------------- 点赞 / 收藏 / 关注 ---------------------------- */

router.post('/api/posts/:id/like', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  await requirePerm(env, user, 'react.use');
  const p = await KV.getJSON(env, `post:${params.id}`);
  if (!p) notfound('文章不存在');
  if (!(await canViewPost(env, p, user))) forbid();
  const key = `like:${p.id}:${user.id}`;
  const exist = await env.DB.get(key);
  p.counts = p.counts || {};
  if (exist) {
    await KV.del(env, key);
    p.counts.likes = Math.max(0, (p.counts.likes || 0) - 1);
  } else {
    await env.DB.put(key, String(nowMs()));
    p.counts.likes = (p.counts.likes || 0) + 1;
    if (p.authorId !== user.id) {
      await pushNotification(env, p.authorId, {
        type: 'like', title: `${user.displayName} 赞了你的文章`, body: p.title,
        link: `/post.html?id=${p.id}`, actor: { id: user.id, name: user.displayName, avatar: user.avatar }, refId: p.id });
    }
  }
  await KV.putJSON(env, `post:${p.id}`, p);
  return ok({ liked: !exist, likes: p.counts.likes }, ctx);
});

router.post('/api/posts/:id/favorite', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const p = await KV.getJSON(env, `post:${params.id}`);
  if (!p) notfound('文章不存在');
  if (!(await canViewPost(env, p, user))) forbid();
  const key = `fav:${user.id}:${p.id}`;
  const exist = await env.DB.get(key);
  p.counts = p.counts || {};
  if (exist) { await KV.del(env, key); p.counts.favorites = Math.max(0, (p.counts.favorites || 0) - 1); }
  else { await env.DB.put(key, String(nowMs()), { metadata: { t: nowMs() } }); p.counts.favorites = (p.counts.favorites || 0) + 1; }
  await KV.putJSON(env, `post:${p.id}`, p);
  return ok({ favorited: !exist, favorites: p.counts.favorites }, ctx);
});

router.get('/api/me/favorites', async (ctx) => {
  const { env, user } = ctx;
  if (!user) unauth();
  const { keys } = await KV.list(env, `fav:${user.id}:`, 100);
  const posts = (await KV.many(env, keys.map((k) => `post:${k.name.split(':').pop()}`))).filter(Boolean);
  const items = [];
  for (const p of posts) if (await canViewPost(env, p, user)) items.push(await postCard(env, p, user));
  return ok({ items }, ctx);
});

router.post('/api/users/:id/follow', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  if (user.id === params.id) bad('不能关注自己');
  const target = await getUser(env, params.id);
  if (!target) notfound('用户不存在');
  const key = `fol:${user.id}:${target.id}`;
  const rev = `folr:${target.id}:${user.id}`;
  const exist = await env.DB.get(key);
  if (exist) {
    await Promise.all([KV.del(env, key), KV.del(env, rev)]);
    user.stats.following = Math.max(0, (user.stats.following || 0) - 1);
    target.stats.followers = Math.max(0, (target.stats.followers || 0) - 1);
  } else {
    await Promise.all([env.DB.put(key, String(nowMs())), env.DB.put(rev, String(nowMs()))]);
    user.stats.following = (user.stats.following || 0) + 1;
    target.stats.followers = (target.stats.followers || 0) + 1;
    await pushNotification(env, target.id, {
      type: 'follow', title: `${user.displayName} 关注了你`, body: '',
      link: `/profile.html?id=${user.id}`, actor: { id: user.id, name: user.displayName, avatar: user.avatar } });
  }
  await Promise.all([saveUser(env, user), saveUser(env, target)]);
  return ok({ following: !exist, followers: target.stats.followers }, ctx);
});

/** 我关注的人（返回 id 列表 + 简要资料，供"关注"信息流筛选） */
router.get('/api/me/following', async (ctx) => {
  const { env, user, url } = ctx;
  if (!user) unauth();
  const rev = url.searchParams.get('type') === 'followers';
  const prefix = rev ? `folr:${user.id}:` : `fol:${user.id}:`;
  const { keys } = await KV.list(env, prefix, clamp(url.searchParams.get('limit') || 200, 1, 500));
  const ids = keys.map((k) => k.name.split(':').pop());
  const users = [];
  for (const id of ids.slice(0, 60)) {
    const u = await getUser(env, id);
    if (u) users.push({ id: u.id, username: u.username, displayName: u.displayName, avatar: u.avatar, bio: u.bio || '' });
  }
  return ok({ ids, users, total: ids.length }, ctx);
});

/* ============================== 评论系统 ================================== */

router.get('/api/posts/:id/comments', async (ctx) => {
  const { env, user, params, url } = ctx;
  const p = await KV.getJSON(env, `post:${params.id}`);
  if (!p) notfound('文章不存在');
  if (!(await canViewPost(env, p, user))) forbid();
  const { keys, cursor, list_complete } = await KV.list(env, `cmt:${p.id}:`, clamp(url.searchParams.get('limit') || 50, 1, 100), url.searchParams.get('cursor'));
  const raw = await KV.many(env, keys.map((k) => k.name));
  const canManageCmt = !!user && (user.id === p.authorId || await hasPerm(env, user, 'post.pin', p.scope || 'global'));
  const items = [];
  for (const c of raw) {
    if (c.status === 'deleted') { items.push({ ...c, content: '（该评论已被删除）', author: null, pinned: !!c.pinned, featured: !!c.featured }); continue; }
    const a = await getUser(env, c.authorId);
    items.push({
      ...c,
      pinned: !!c.pinned, featured: !!c.featured,
      author: a ? { id: a.id, username: a.username, displayName: a.displayName, avatar: a.avatar,
                    roleTags: await roleTagsOf(env, a, p.scope || 'global') } : null,
      canDelete: !!user && (user.id === c.authorId || await hasPerm(env, user, 'comment.delete.any', p.scope || 'global')),
      canPin: canManageCmt, canFeature: canManageCmt,
    });
  }
  // 置顶评论优先，其次精选评论，其余按时间正序
  items.sort((a, b) => (Number(!!b.pinned) - Number(!!a.pinned)) || (Number(!!b.featured) - Number(!!a.featured)) || (a.createdAt - b.createdAt));
  return ok({ items, cursor: list_complete ? null : cursor, locked: !!p.locked }, ctx);
});

router.post('/api/posts/:id/comments', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const p = await KV.getJSON(env, `post:${params.id}`);
  if (!p) notfound('文章不存在');
  if (p.locked) forbid('该文章已锁定评论');
  if (!(await canViewPost(env, p, user))) forbid();
  await requirePerm(env, user, 'comment.create', p.scope || 'global');
  if (await isMuted(env, user, p.scope || 'global')) forbid('你当前处于禁言状态');
  await guardRate(env, `cmt:${user.id}`, 20, 300, '评论过于频繁');

  const content = sanitizeContent(String(body.content || '').trim(), 5000);
  if (content.length < 1) bad('评论内容不能为空');
  const id = sortableId();
  const c = {
    id, postId: p.id, authorId: user.id, content,
    replyTo: body.replyTo ? String(body.replyTo) : '',
    replyToName: body.replyToName ? String(body.replyToName).slice(0, 40) : '',
    likes: 0, status: 'published', pinned: false, featured: false, createdAt: nowMs(),
  };
  await KV.putJSON(env, `cmt:${p.id}:${id}`, c);
  p.counts = p.counts || {};
  p.counts.comments = (p.counts.comments || 0) + 1;
  await KV.putJSON(env, `post:${p.id}`, p);
  user.stats.comments = (user.stats.comments || 0) + 1;
  // 行为奖励：评论自动发放 MO / Meow
  const cReward = await awardActionInline(env, user, 'comment');
  await saveUser(env, user);
  bumpStatLazy('comments');

  if (p.authorId !== user.id) {
    await pushNotification(env, p.authorId, {
      type: 'comment', title: `${user.displayName} 评论了你的文章`, body: content.slice(0, 80),
      link: `/post.html?id=${p.id}#c-${id}`, actor: { id: user.id, name: user.displayName, avatar: user.avatar }, refId: p.id });
  }
  if (c.replyTo) {
    const parent = await KV.getJSON(env, `cmt:${p.id}:${c.replyTo}`);
    if (parent && parent.authorId !== user.id) {
      await pushNotification(env, parent.authorId, {
        type: 'reply', title: `${user.displayName} 回复了你`, body: content.slice(0, 80),
        link: `/post.html?id=${p.id}#c-${id}`, actor: { id: user.id, name: user.displayName, avatar: user.avatar }, refId: p.id });
    }
  }
  return ok({
    comment: { ...c, author: { id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar, official: !!user.official, level: levelFromMeow(user.economy?.meow).level, customLevel: user.customLevel || null } },
    reward: cReward, economy: economyView(user),
  }, ctx);
});

router.delete('/api/posts/:pid/comments/:cid', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const key = `cmt:${params.pid}:${params.cid}`;
  const c = await KV.getJSON(env, key);
  if (!c) notfound('评论不存在');
  const p = await KV.getJSON(env, `post:${params.pid}`);
  if (c.authorId !== user.id) await requirePerm(env, user, 'comment.delete.any', p?.scope || 'global');
  if (c.authorId === user.id) await KV.del(env, key);
  else { c.status = 'deleted'; c.deletedBy = user.id; await KV.putJSON(env, key, c); }
  if (p) { p.counts.comments = Math.max(0, (p.counts.comments || 0) - 1); await KV.putJSON(env, `post:${p.id}`, p); }
  return ok({ deleted: params.cid }, ctx);
});

// 置顶 / 加精评论（文章作者或拥有 post.pin 权限的管理员可操作）
router.put('/api/posts/:pid/comments/:cid', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const p = await KV.getJSON(env, `post:${params.pid}`);
  if (!p) notfound('文章不存在');
  const key = `cmt:${params.pid}:${params.cid}`;
  const c = await KV.getJSON(env, key);
  if (!c) notfound('评论不存在');
  const isOwner = p.authorId === user.id;
  const canManage = isOwner || await hasPerm(env, user, 'post.pin', p.scope || 'global');
  if (!canManage) forbid('只有文章作者或管理员可以置顶 / 加精评论');
  if (body.pinned !== undefined) c.pinned = !!body.pinned;
  if (body.featured !== undefined) c.featured = !!body.featured;
  c.updatedAt = nowMs();
  await KV.putJSON(env, key, c);
  return ok({ comment: c }, ctx);
});

/* ========================================================================== *
 * 13. 用户资料与设置
 * ========================================================================== */

const LINK_PLATFORMS = ['github','discord','twitter','x','telegram','bilibili','zhihu','weibo','youtube',
                        'mastodon','steam','email','website','blog','qq','wechat','linkedin','instagram'];

router.get('/api/users/:id', async (ctx) => {
  const { env, user, params } = ctx;
  let target = await getUser(env, params.id);
  if (!target) target = await findUserByUsername(env, params.id);
  if (!target) notfound('用户不存在');
  const following = user ? !!(await env.DB.get(`fol:${user.id}:${target.id}`)) : false;
  return ok({
    user: publicUser(target, user, { roleTags: await roleTagsOf(env, target, 'global') }),
    following,
    isSelf: !!user && user.id === target.id,
  }, ctx);
});

router.put('/api/me/profile', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (body.username !== undefined && body.username !== user.username) {
    const nu = String(body.username).trim();
    if (!USERNAME_RE.test(nu)) bad('用户名需为 2-20 位字母、数字、下划线、连字符或中文');
    if (await findUserByUsername(env, nu)) conflict('用户名已被占用');
    await guardRate(env, `rename:${user.id}`, 2, 86400 * 7, '用户名 7 天内最多修改 2 次');
    await KV.del(env, unameKey(user.username));
    await env.DB.put(unameKey(nu), user.id);
    user.username = nu;
  }
  if (body.displayName !== undefined) user.displayName = String(body.displayName).trim().slice(0, 40) || user.username;
  if (body.bio !== undefined) user.bio = sanitizeContent(String(body.bio).slice(0, 500));
  if (body.avatar !== undefined) user.avatar = String(body.avatar).slice(0, 500);
  if (body.banner !== undefined) user.banner = String(body.banner).slice(0, 500);
  if (body.locale !== undefined && SUPPORTED_LOCALES.includes(body.locale)) user.locale = body.locale;
  if (body.theme !== undefined && ['auto','light','dark'].includes(body.theme)) user.theme = body.theme;
  if (body.timeFormat !== undefined && ['auto','12h','24h'].includes(body.timeFormat)) user.timeFormat = body.timeFormat;
  if (body.notifySettings !== undefined) user.notifySettings = { ...(user.notifySettings || {}), ...body.notifySettings };
  if (Array.isArray(body.links)) {
    user.links = body.links.slice(0, 12).map((l) => ({
      platform: LINK_PLATFORMS.includes(String(l.platform)) ? String(l.platform) : 'website',
      label: String(l.label || '').slice(0, 40),
      url: /^https?:\/\//i.test(l.url || '') ? String(l.url).slice(0, 300) : '',
    })).filter((l) => l.url);
  }

  /* ---- 新版主页扩展字段：愿望单 / 游戏卡片 / 富连接 ---- */
  if (Array.isArray(body.wishlist)) {
    user.wishlist = body.wishlist.slice(0, 60).map((w) => ({
      id: String(w.id || uid('w')).slice(0, 32),
      title: String(w.title || '').slice(0, 80),
      url: /^https?:\/\//i.test(w.url || '') ? String(w.url).slice(0, 500) : '',
      cover: /^https?:\/\//i.test(w.cover || '') ? String(w.cover).slice(0, 500) : '',
      note: String(w.note || '').slice(0, 200),
      addedAt: Number.isFinite(+w.addedAt) ? +w.addedAt : nowMs(),
    })).filter((w) => w.title);
  }
  if (Array.isArray(body.gameCards)) {
    user.gameCards = body.gameCards.slice(0, 60).map((g) => ({
      id: String(g.id || uid('g')).slice(0, 32),
      title: String(g.title || '').slice(0, 80),
      cover: /^https?:\/\//i.test(g.cover || '') ? String(g.cover).slice(0, 500) : '',
      note: String(g.note || '').slice(0, 200),
      links: Array.isArray(g.links) ? g.links.slice(0, 6).map((l) => ({
        label: String(l.label || '').slice(0, 40),
        url: /^https?:\/\//i.test(l.url || '') ? String(l.url).slice(0, 300) : '',
      })).filter((l) => l.url) : [],
    })).filter((g) => g.title);
  }
  if (Array.isArray(body.connections)) {
    user.connections = body.connections.slice(0, 30).map((c) => {
      if (!c || c.type === 'domain') {
        const domain = String((c && c.domain) || '').trim().toLowerCase();
        if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain) || domain.length > 120) return null;
        return {
          type: 'domain', domain,
          note: String((c && c.note) || '').slice(0, 120),
          token: String((c && c.token) || '').slice(0, 120),
          verified: !!(c && c.verified),
          autoAdded: !!(c && c.autoAdded),
          status: (c && c.status) || ((c && c.verified) ? 'verified' : 'pending'),
        };
      }
      const url = /^https?:\/\//i.test(c.url || '') ? String(c.url).slice(0, 500) : '';
      if (!url) return null;
      return {
        type: 'link',
        platform: LINK_PLATFORMS.includes(String(c.platform)) ? String(c.platform) : 'website',
        label: String(c.label || '').slice(0, 40),
        url,
      };
    }).filter(Boolean);
  }
  await saveUser(env, user);
  touchPresence(user);
  return ok({ user: publicUser(user, user) }, ctx);
});

/* ----------------- 个人主页扩展：正在玩（桌面插件）/ 自定义域名连接 ----------------- */

/** 通过 Cloudflare DoH 查询 TXT 记录，用于验证用户自定义域名的归属 */
async function dnsTxtLookup(name) {
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, {
      headers: { Accept: 'application/dns-json' },
    });
    if (!r.ok) return [];
    const d = await r.json().catch(() => ({}));
    return Array.isArray(d.Answer) ? d.Answer.map((a) => String(a.data || '')).filter(Boolean) : [];
  } catch (e) { return []; }
}

/** 在用户绑定的 Cloudflare 账号下自动添加一条 TXT 记录，用于域名归属验证（失败返回原因） */
async function cfAutoAddDnsRecord(env, userId, domain, txt) {
  const bind = await KV.getJSON(env, `cf:bind:${userId}`);
  if (!bind || !bind.tokenEnc) return { ok: false, reason: 'no_bind' };
  try {
    const zr = await cfFetch(env, bind, 'GET', 'zones?per_page=50');
    const zd = await zr.json().catch(() => ({}));
    const zones = Array.isArray(zd.result) ? zd.result : [];
    // 选取 name 是 domain 后缀、且最长（最具体）的 zone
    let zone = null;
    for (const z of zones) {
      const zn = String(z.name || '').toLowerCase();
      if (domain === zn || domain.endsWith('.' + zn)) {
        if (!zone || zn.length > zone.name.length) zone = z;
      }
    }
    if (!zone) return { ok: false, reason: 'no_zone' };
    const ar = await cfFetch(env, bind, 'POST', `zones/${zone.id}/dns_records`, {
      json: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'TXT', name: `_maryt.${domain}`, content: txt, ttl: 60 }),
    });
    const ad = await ar.json().catch(() => ({}));
    if (!ar.ok || !ad.success) return { ok: false, reason: ad.errors?.[0]?.message || 'cf_error' };
    return { ok: true };
  } catch (e) { return { ok: false, reason: 'cf_exception' }; }
}

/** 在用户绑定的 Cloudflare 账号下删除自动添加的 TXT 记录 */
async function cfAutoRemoveDnsRecord(env, userId, domain) {
  const bind = await KV.getJSON(env, `cf:bind:${userId}`);
  if (!bind || !bind.tokenEnc) return;
  try {
    const zr = await cfFetch(env, bind, 'GET', `zones?name=${encodeURIComponent(domain)}&per_page=5`);
    const zd = await zr.json().catch(() => ({}));
    const zone = (Array.isArray(zd.result) ? zd.result : [])[0];
    if (!zone) return;
    const lr = await cfFetch(env, bind, 'GET', `zones/${zone.id}/dns_records?name=${encodeURIComponent(`_maryt.${domain}`)}&type=TXT`);
    const ld = await lr.json().catch(() => ({}));
    const rec = (Array.isArray(ld.result) ? ld.result : [])[0];
    if (rec) await cfFetch(env, bind, 'DELETE', `zones/${zone.id}/dns_records/${rec.id}`);
  } catch (e) { /* 忽略删除失败 */ }
}

/* 桌面端（⑤ C# WPF）上报「正在玩」：仅本人可写，token 即本人 JWT */
router.put('/api/me/playing', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (body.clear || !body.app) { user.playingNow = null; await saveUser(env, user); return ok({ playingNow: null }, ctx); }
  const app = String(body.app || '').trim().slice(0, 64);
  if (!app) { user.playingNow = null; await saveUser(env, user); return ok({ playingNow: null }, ctx); }
  user.playingNow = {
    app,
    name: String(body.name || app).trim().slice(0, 40),
    icon: /^https?:\/\//i.test(body.icon || '') ? String(body.icon).slice(0, 500)
         : (typeof body.icon === 'string' && body.icon.startsWith('/') ? body.icon.slice(0, 200) : ''),
    level: Number.isFinite(+body.level) ? Math.max(0, Math.min(9999, Math.floor(+body.level))) : null,
    uid: body.uid ? String(body.uid).slice(0, 40) : '',
    playtimeMin: Number.isFinite(+body.playtimeMin) ? Math.max(0, Math.min(100000000, Math.floor(+body.playtimeMin))) : null,
    sessionStart: Number.isFinite(+body.sessionStart) ? +body.sessionStart : nowMs(),
    hidden: !!body.hidden,
    updatedAt: nowMs(),
  };
  await saveUser(env, user);
  touchPresence(user);
  return ok({ playingNow: user.playingNow }, ctx);
});

/* 自定义域名连接：生成校验 token / DNS 校验 / 自动添加 / 移除 */
router.post('/api/me/domain-connection', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  const action = String(body.action || '');
  const domain = String(body.domain || '').trim().toLowerCase();
  const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
  if (!DOMAIN_RE.test(domain) || domain.length > 120) bad('域名格式不正确');

  user.connections = Array.isArray(user.connections) ? user.connections : [];
  if (action === 'start') {
    let entry = user.connections.find((c) => c.type === 'domain' && c.domain === domain);
    if (!entry) {
      entry = { type: 'domain', domain, note: '', token: '', verified: false, autoAdded: false, status: 'pending' };
      user.connections.push(entry);
    }
    if (!entry.token) entry.token = 'maryt-' + b64urlEncode(crypto.getRandomValues(new Uint8Array(18))).replace(/=+$/, '').toLowerCase();
    entry.verified = false; entry.status = 'pending';
    await saveUser(env, user);
    return ok({
      domain, token: entry.token,
      record: `TXT  _maryt.${domain} = ${entry.token}`,
      instructions: `请在你域名 ${domain} 的 DNS 中添加一条 TXT 记录：名称 _maryt.${domain}，内容 ${entry.token}。添加后点击「验证」。`,
    }, ctx);
  }

  if (action === 'verify' || action === 'auto') {
    const entry = user.connections.find((c) => c.type === 'domain' && c.domain === domain);
    if (!entry) bad('请先发起域名连接（start）');
    if (action === 'auto') {
      const r = await cfAutoAddDnsRecord(env, user.id, domain, entry.token);
      if (r.ok) {
        entry.verified = true; entry.autoAdded = true; entry.status = 'verified';
        await saveUser(env, user);
        return ok({ verified: true, autoAdded: true, domain }, ctx);
      }
      // 自动添加失败 → 回退手动说明
      return ok({
        verified: false, autoAdded: false, manual: true, domain, token: entry.token,
        record: `TXT  _maryt.${domain} = ${entry.token}`,
        reason: r.reason || 'unknown',
        instructions: `未能自动添加 DNS 记录（${r.reason || '未知原因'}）。请手动在 ${domain} 添加 TXT 记录：名称 _maryt.${domain}，内容 ${entry.token}，然后点击「验证」。`,
      }, ctx);
    }
    // verify
    const txts = await dnsTxtLookup(`_maryt.${domain}`);
    const hit = txts.some((t) => t.replace(/"/g, '').trim() === entry.token);
    if (hit) { entry.verified = true; entry.status = 'verified'; await saveUser(env, user); return ok({ verified: true, domain }, ctx); }
    return ok({ verified: false, domain, token: entry.token,
      record: `TXT  _maryt.${domain} = ${entry.token}`,
      instructions: `尚未检测到 TXT 记录。请确认已在 ${domain} 添加：名称 _maryt.${domain}，内容 ${entry.token}（DNS 生效可能需要几分钟）。` }, ctx);
  }

  if (action === 'remove') {
    const idx = user.connections.findIndex((c) => c.type === 'domain' && c.domain === domain);
    if (idx >= 0) {
      const [removed] = user.connections.splice(idx, 1);
      if (removed && removed.autoAdded) await cfAutoRemoveDnsRecord(env, user.id, domain).catch(() => {});
    }
    await saveUser(env, user);
    return ok({ removed: true, domain }, ctx);
  }

  bad('未知操作');
});

/* ------------------------------ 在线状态接口 ------------------------------ */

/**
 * 当前在线情况（公开）。纯内存计算，不产生任何 KV 读写，可放心高频轮询。
 * ?limit=n 返回最近活跃的在线用户列表（隐身用户不出现）。
 */
/* ==========================================================================
 * 经济系统（地基）· 货币 MO值（积分，可消费）/ 等级 Meow值（经验，累积）
 *   加速券：用户持有的券，可于特定场景抵扣冷却、经验加成、解锁装扮等。
 * ========================================================================== */
const VOUCHER_KINDS = {
  accelerate: { label: '加速券', desc: '减少发布/操作冷却，立即生效' },
  boost:      { label: '经验加成券', desc: '有效期内获得 Meow 经验翻倍' },
  cosmetic:   { label: '装扮券', desc: '用于解锁头像框/名片装扮' },
  makeup:     { label: '补签卡', desc: '补签一个漏签的日期，保住连签天数' },
};

/** 由累积 Meow 经验推导等级（平滑曲线：level n 需要 n*n*50 经验） */
function levelFromMeow(meow) {
  const m = Math.max(0, Number(meow) || 0);
  let level = 1;
  while (m >= level * level * 50) level++;
  const need = level * level * 50;
  const prev = (level - 1) * (level - 1) * 50;
  const into = m - prev;
  const span = Math.max(1, need - prev);
  return { level, need, into, span, pct: Math.min(100, Math.round(into / span * 100)) };
}

function economyView(u) {
  const e = u.economy || { mo: 0, meow: 0, checkin: { last: 0, streak: 0, count: 0, days: [] } };
  const lv = levelFromMeow(e.meow);
  const t = nowMs();
  // 经济特权：超级管理员与官方账号默认拥有无限 MO、商城全部道具与一切经济权益
  const superAdmin = !!(u.roles?.global || []).includes('role_super_admin');
  const official = !!u.official;
  const moUnlimited = superAdmin || official;
  return {
    mo: e.mo || 0,
    meow: e.meow || 0,
    level: lv.level,
    levelNeed: lv.need,
    levelInto: lv.into,
    levelPct: lv.pct,
    moUnlimited,                                   // 前端据此显示「∞」而非具体数值
    customLevel: u.customLevel || null,            // 超管在后台指定的专属（Markdown）等级
    checkin: e.checkin || { last: 0, streak: 0, count: 0, days: [] },
    vouchers: (Array.isArray(u.vouchers) ? u.vouchers : []).filter((v) => !v.expiresAt || v.expiresAt > t),
    // 装扮与称号：持有清单 + 当前佩戴，供经济中心直接渲染
    title: equippedTitleOf(u),
    titles: (Array.isArray(u.titles) ? u.titles : []).filter((x) => !x.expiresAt || x.expiresAt > t),
    avatarFrame: u.avatarFrame || '',
    avatarFrames: Array.isArray(u.avatarFrames) ? u.avatarFrames : [],
    cardStyle: u.cardStyle || '', cardStyles: Array.isArray(u.cardStyles) ? u.cardStyles : [],
    bubbleStyle: u.bubbleStyle || '', bubbleStyles: Array.isArray(u.bubbleStyles) ? u.bubbleStyles : [],
    giftStats: u.giftStats || { count: 0, mo: 0 },
  };
}

async function grantEconomy(env, userId, { mo = 0, meow = 0 } = {}) {
  if (!mo && !meow) return null;
  const u = await getUser(env, userId);
  if (!u) return null;
  u.economy = u.economy || { mo: 0, meow: 0, checkin: { last: 0, streak: 0, count: 0 } };
  u.economy.mo = (u.economy.mo || 0) + Math.max(0, Math.floor(mo));
  u.economy.meow = (u.economy.meow || 0) + Math.max(0, Math.floor(meow));
  await saveUser(env, u);
  return u;
}

/* 头像框：样式类名白名单，购买/装备时校验，杜绝任意 CSS 注入 */
const FRAME_CLASSES = ['frame-gold', 'frame-neon', 'frame-rose', 'frame-emerald', 'frame-galaxy'];
/* 名片装扮（个人主页卡片背景）与消息气泡皮肤：同样只允许白名单类名 */
const CARD_CLASSES = ['card-aurora', 'card-sakura', 'card-ocean', 'card-carbon', 'card-sunset'];
const BUBBLE_CLASSES = ['bubble-neon', 'bubble-glass', 'bubble-ink', 'bubble-candy', 'bubble-forest'];

/* ---------------------------- 券：查询与消耗 ---------------------------- *
 * 约定：带 expiresAt 的券按「有效期」生效，期内反复生效且不消耗；
 *       不带 expiresAt 的券为一次性券，使用即扣除（uses > 1 时按次递减）。
 * 全部为内存内改动，由调用方统一 saveUser，避免额外的 KV 写。
 */
function activeVoucher(user, kind) {
  const t = nowMs();
  return (Array.isArray(user.vouchers) ? user.vouchers : [])
    .find((v) => v.kind === kind && (!v.expiresAt || v.expiresAt > t)) || null;
}
function consumeVoucherInline(user, kind) {
  const list = Array.isArray(user.vouchers) ? user.vouchers : [];
  const t = nowMs();
  const i = list.findIndex((v) => v.kind === kind && (!v.expiresAt || v.expiresAt > t));
  if (i < 0) return null;
  const v = list[i];
  if (v.expiresAt) return v;                       // 期限券：不消耗
  if (v.uses && v.uses > 1) { v.uses -= 1; return v; }
  list.splice(i, 1);
  user.vouchers = list;
  return v;
}

/* ============================== 称号系统 ============================== *
 * 用户可同时持有多个称号，但只能佩戴一个（显示在昵称旁）。
 * 来源：商城购买（kind=title）/ 管理层颁发 / 活动发放。可设过期时间。
 */
function defaultTitleCatalog() {
  return [
    { id: 't_newcomer', name: '初来喵到', color: '#22c55e', icon: '🌱', desc: '刚加入社区的新朋友' },
    { id: 't_poster',   name: '笔耕不辍', color: '#3b82f6', icon: '✒️', desc: '热爱写作的创作者' },
    { id: 't_helper',   name: '热心助人', color: '#f59e0b', icon: '🤝', desc: '乐于帮助他人' },
    { id: 't_night',    name: '深夜冲浪', color: '#8b5cf6', icon: '🌙', desc: '夜里最活跃的那批人' },
    { id: 't_legend',   name: '传说之喵', color: '#e11d48', icon: '👑', desc: '稀有称号', rare: true },
  ];
}
async function getTitleCatalog(env) {
  const cfg = await getSiteConfig(env);
  const list = Array.isArray(cfg.titleCatalog) ? cfg.titleCatalog : [];
  return list.length ? list : defaultTitleCatalog();
}
function normalizeTitle(t, extra = {}) {
  return {
    id: String(t?.id || '').trim().slice(0, 40) || 'title_' + uid('t'),
    name: String(t?.name || '').trim().slice(0, 20),
    color: String(t?.color || '#6366f1').slice(0, 20),
    icon: String(t?.icon || '').slice(0, 4),
    desc: String(t?.desc || '').slice(0, 120),
    rare: !!t?.rare,
    ...extra,
  };
}
/** 当前佩戴的称号（已过期或未持有一律返回 null） */
function equippedTitleOf(u) {
  if (!u || !u.title) return null;
  const t = (Array.isArray(u.titles) ? u.titles : []).find((x) => x.id === u.title);
  if (!t) return null;
  if (t.expiresAt && t.expiresAt <= nowMs()) return null;
  return { id: t.id, name: t.name, color: t.color || '#6366f1', icon: t.icon || '', rare: !!t.rare };
}
/** 把称号写进用户持有列表（同 id 覆盖），未佩戴任何称号时自动佩戴新获得的 */
function grantTitleInline(user, title) {
  const list = (Array.isArray(user.titles) ? user.titles : []).filter((x) => x.id !== title.id);
  list.push(title);
  user.titles = list;
  if (!equippedTitleOf(user)) user.title = title.id;
  return list;
}

/* ============================== 签到配置 ============================== */
function defaultCheckinConfig() {
  return {
    baseMo: 5, baseMeow: 10,
    streakStepMo: 2, streakStepMeow: 1, streakCapDays: 7,
    makeupMo: 2, makeupMeow: 4,
    milestones: [
      { days: 7,   mo: 30,  meow: 50,   note: '连签 7 天' },
      { days: 30,  mo: 150, meow: 300,  note: '连签 30 天' },
      { days: 100, mo: 600, meow: 1200, note: '连签 100 天' },
    ],
  };
}
async function getCheckinConfig(env) {
  const cfg = await getSiteConfig(env);
  const c = cfg.checkinConfig && typeof cfg.checkinConfig === 'object' ? cfg.checkinConfig : {};
  return { ...defaultCheckinConfig(), ...c };
}
const dayNum = (ms) => Math.floor(ms / 86400000);
/** day 序号 → 'YYYY-MM-DD'（UTC 基准，与 dayNum 口径一致） */
function dayToDate(d) { return new Date(d * 86400000).toISOString().slice(0, 10); }
function dateToDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isFinite(t) ? dayNum(t) : null;
}
/** 签到记录里最近 N 天的 day 序号数组（去重升序，最多保留 200 条） */
function checkinDays(c) {
  const a = Array.isArray(c?.days) ? c.days.filter((x) => Number.isFinite(x)) : [];
  return [...new Set(a)].sort((x, y) => x - y).slice(-200);
}
/** 由已签日期集合重算连签天数（截至 endDay，含当天） */
function recalcStreak(days, endDay) {
  const set = new Set(days);
  let n = 0;
  for (let d = endDay; set.has(d); d--) n++;
  return n;
}

/* ============================== 等级特权表 ============================== */
function defaultLevelPerks() {
  return [
    { level: 1,  label: '新芽',   desc: '发帖、评论、点赞、私信' },
    { level: 3,  label: '常客',   desc: '解锁自定义签名与名片装扮位' },
    { level: 5,  label: '熟客',   desc: '发帖冷却缩短，可上传更大附件' },
    { level: 10, label: '老手',   desc: '解锁消息气泡皮肤位、赠礼折扣' },
    { level: 20, label: '大佬',   desc: '专属稀有称号购买资格' },
  ];
}
async function getLevelPerks(env) {
  const cfg = await getSiteConfig(env);
  const list = Array.isArray(cfg.levelPerks) ? cfg.levelPerks : [];
  return list.length ? list : defaultLevelPerks();
}

/* ==================== 行为奖励（发帖/评论自动发放经验） ==================== */
function defaultActionRewards() {
  return {
    post:    { mo: 3, meow: 8 },
    comment: { mo: 1, meow: 3 },
    gift:    { mo: 0, meow: 2 },   // 每赠出一个礼物给赠礼方的经验
  };
}
async function getActionRewards(env) {
  const cfg = await getSiteConfig(env);
  const r = cfg.actionRewards && typeof cfg.actionRewards === 'object' ? cfg.actionRewards : {};
  return { ...defaultActionRewards(), ...r };
}
/**
 * 就地给用户发放行为奖励（不落盘，由调用方 saveUser 一并写入）。
 * 持有「经验加成券」时 Meow 翻倍：期限券期内一直生效，一次性券用掉即扣。
 */
async function awardActionInline(env, user, action) {
  const rewards = await getActionRewards(env);
  const rw = rewards[action];
  if (!rw) return null;
  let mo = Math.max(0, Math.floor(Number(rw.mo) || 0));
  let meow = Math.max(0, Math.floor(Number(rw.meow) || 0));
  if (!mo && !meow) return null;
  const boosted = !!consumeVoucherInline(user, 'boost');
  if (boosted) meow *= 2;
  user.economy = user.economy || { mo: 0, meow: 0, checkin: { last: 0, streak: 0, count: 0, days: [] } };
  user.economy.mo = (user.economy.mo || 0) + mo;
  user.economy.meow = (user.economy.meow || 0) + meow;
  return { mo, meow, boosted };
}

/* ============================== 礼物 / 赞赏 ============================== */
function defaultGiftCatalog() {
  return [
    { id: 'g_cookie', name: '小饼干', icon: '🍪', price: 10,  desc: '一点点心意' },
    { id: 'g_coffee', name: '咖啡',   icon: '☕', price: 30,  desc: '提神醒脑，继续加油' },
    { id: 'g_cake',   name: '蛋糕',   icon: '🍰', price: 66,  desc: '甜甜的祝福' },
    { id: 'g_rocket', name: '火箭',   icon: '🚀', price: 188, desc: '带你一飞冲天' },
    { id: 'g_crown',  name: '皇冠',   icon: '👑', price: 520, desc: '至高敬意' },
  ];
}
async function getGiftConfig(env) {
  const cfg = await getSiteConfig(env);
  const list = Array.isArray(cfg.giftCatalog) && cfg.giftCatalog.length ? cfg.giftCatalog : defaultGiftCatalog();
  return {
    catalog: list,
    // 收礼方实际到账比例（其余部分视为「平台流通损耗」，防止刷分套利）
    giftRate: Number.isFinite(+cfg.giftReceiveRate) ? clamp(+cfg.giftReceiveRate, 0, 1) : 0.7,
    tipRate:  Number.isFinite(+cfg.tipReceiveRate)  ? clamp(+cfg.tipReceiveRate, 0, 1)  : 0.9,
    tipMax:   Number.isFinite(+cfg.tipMax) ? clamp(+cfg.tipMax, 1, 100000) : 2000,
  };
}
/**
 * 赠礼 / 赞赏默认对所有「能正常发言的成员」开放；
 * economy.gift / economy.tip 权限位用于治理侧精细控制（显式授予即生效），
 * 未显式配置时回落到 comment.create —— 封禁与禁言一律拒绝。
 */
async function canEconomyAct(env, user, perm, scope = 'global') {
  if (!user || user.flags?.banned) return false;
  if (await isMuted(env, user, scope)) return false;
  // 官方账号默认拥有全部经济权益（赠礼 / 赞赏等）
  if (user.official) return true;
  if (await hasPerm(env, user, perm, scope)) return true;
  return await hasPerm(env, user, 'comment.create', scope);
}
/** 收礼榜：单条 KV 聚合表，收礼时增量更新，避免全表扫描 */
async function bumpGiftBoard(env, target, count, mo) {
  try {
    const board = await KV.getJSON(env, 'stat:giftboard', []);
    const list = Array.isArray(board) ? board : [];
    let row = list.find((x) => x.userId === target.id);
    if (!row) { row = { userId: target.id, username: target.username, count: 0, mo: 0 }; list.push(row); }
    row.username = target.username;
    row.displayName = target.displayName || target.username;
    row.avatar = target.avatar || '';
    row.count += count;
    row.mo += mo;
    list.sort((a, b) => (b.mo || 0) - (a.mo || 0) || (b.count || 0) - (a.count || 0));
    await KV.putJSON(env, 'stat:giftboard', list.slice(0, 50));
  } catch (e) { console.error('[gift] board bump failed', e); }
}

/* 商城分类：前端按此顺序分栏展示，未知分类归入 other */
const SHOP_CATEGORIES = [
  { id: 'voucher', name: '功能券' },
  { id: 'title',   name: '称号' },
  { id: 'frame',   name: '头像框' },
  { id: 'card',    name: '名片装扮' },
  { id: 'bubble',  name: '消息皮肤' },
  { id: 'badge',   name: '徽章' },
  { id: 'other',   name: '其它' },
];

function defaultShop() {
  const t = nowMs();
  const base = { active: true, stock: -1, sold: 0, createdAt: t, limitPerUser: 0, startAt: 0, endAt: 0, discountPrice: 0, levelMin: 0 };
  return [
    // ---- 功能券 ----
    { id: 'v_accel_1d', name: '加速券（1天）', desc: '免除发布冷却限制', price: 50, kind: 'voucher', category: 'voucher', sort: 10, grant: { voucherKind: 'accelerate', label: '加速券', durationDays: 1, meta: { scope: 'post_cooldown' } }, ...base },
    { id: 'v_boost_1d', name: '经验加成券（1天）', desc: '有效期内获得 Meow 经验翻倍', price: 80, kind: 'voucher', category: 'voucher', sort: 20, grant: { voucherKind: 'boost', label: '经验加成券', durationDays: 1 }, ...base },
    { id: 'v_makeup', name: '补签卡', desc: '补签一个漏签日期，保住连签天数', price: 60, kind: 'voucher', category: 'voucher', sort: 30, grant: { voucherKind: 'makeup', label: '补签卡' }, ...base },
    // ---- 称号（佩戴后显示在昵称旁）----
    { id: 't_poster', name: '称号·笔耕不辍', desc: '佩戴后显示在昵称旁', price: 120, kind: 'title', category: 'title', sort: 10, grant: { titleId: 't_poster', titleName: '笔耕不辍', titleColor: '#3b82f6', titleIcon: '✒️' }, ...base },
    { id: 't_helper', name: '称号·热心助人', desc: '佩戴后显示在昵称旁', price: 120, kind: 'title', category: 'title', sort: 20, grant: { titleId: 't_helper', titleName: '热心助人', titleColor: '#f59e0b', titleIcon: '🤝' }, ...base },
    { id: 't_night', name: '称号·深夜冲浪', desc: '夜猫子限定气质', price: 160, kind: 'title', category: 'title', sort: 30, grant: { titleId: 't_night', titleName: '深夜冲浪', titleColor: '#8b5cf6', titleIcon: '🌙' }, ...base },
    { id: 't_legend', name: '称号·传说之喵', desc: '稀有称号，需 20 级', price: 1000, kind: 'title', category: 'title', sort: 40, grant: { titleId: 't_legend', titleName: '传说之喵', titleColor: '#e11d48', titleIcon: '👑', rare: true }, ...base, levelMin: 20 },
    // ---- 徽章 ----
    { id: 'b_newbie', name: '萌新徽章', desc: '解锁「萌新」身份徽章', price: 30, kind: 'badge', category: 'badge', sort: 10, grant: { badgeId: 'badge_newbie', badgeName: '萌新' }, ...base },
    // ---- 头像框（可购买、可装备的虚拟装扮）----
    { id: 'f_gold', name: '黄金头像框', desc: '尊贵的金色光环', price: 200, kind: 'frame', category: 'frame', sort: 10, grant: { frameId: 'f_gold', frameName: '黄金', frameCls: 'frame-gold' }, ...base },
    { id: 'f_neon', name: '霓虹头像框', desc: '赛博朋克青紫光效', price: 150, kind: 'frame', category: 'frame', sort: 20, grant: { frameId: 'f_neon', frameName: '霓虹', frameCls: 'frame-neon' }, ...base },
    { id: 'f_rose', name: '玫瑰头像框', desc: '浪漫的玫红渐变', price: 150, kind: 'frame', category: 'frame', sort: 30, grant: { frameId: 'f_rose', frameName: '玫瑰', frameCls: 'frame-rose' }, ...base },
    { id: 'f_emerald', name: '翡翠头像框', desc: '清新的翠绿光环', price: 150, kind: 'frame', category: 'frame', sort: 40, grant: { frameId: 'f_emerald', frameName: '翡翠', frameCls: 'frame-emerald' }, ...base },
    { id: 'f_galaxy', name: '星河头像框', desc: '流动的星河光环', price: 300, kind: 'frame', category: 'frame', sort: 50, grant: { frameId: 'f_galaxy', frameName: '星河', frameCls: 'frame-galaxy' }, ...base },
    // ---- 名片装扮（个人主页卡片背景）----
    { id: 'c_aurora', name: '极光名片', desc: '青紫极光渐变背景', price: 180, kind: 'card', category: 'card', sort: 10, grant: { cardId: 'c_aurora', cardName: '极光', cardCls: 'card-aurora' }, ...base },
    { id: 'c_sakura', name: '樱花名片', desc: '柔和粉樱渐变背景', price: 180, kind: 'card', category: 'card', sort: 20, grant: { cardId: 'c_sakura', cardName: '樱花', cardCls: 'card-sakura' }, ...base },
    { id: 'c_ocean', name: '深海名片', desc: '沉静蓝调渐变背景', price: 180, kind: 'card', category: 'card', sort: 30, grant: { cardId: 'c_ocean', cardName: '深海', cardCls: 'card-ocean' }, ...base },
    { id: 'c_carbon', name: '碳纤名片', desc: '低调的碳纤维纹理', price: 220, kind: 'card', category: 'card', sort: 40, grant: { cardId: 'c_carbon', cardName: '碳纤', cardCls: 'card-carbon' }, ...base },
    { id: 'c_sunset', name: '日落名片', desc: '橙粉夕阳渐变背景', price: 220, kind: 'card', category: 'card', sort: 50, grant: { cardId: 'c_sunset', cardName: '日落', cardCls: 'card-sunset' }, ...base },
    // ---- 消息气泡皮肤（聊天 / 私信）----
    { id: 'bb_neon', name: '霓虹气泡', desc: '聊天气泡霓虹描边', price: 140, kind: 'bubble', category: 'bubble', sort: 10, grant: { bubbleId: 'bb_neon', bubbleName: '霓虹', bubbleCls: 'bubble-neon' }, ...base },
    { id: 'bb_glass', name: '毛玻璃气泡', desc: '半透明磨砂质感', price: 140, kind: 'bubble', category: 'bubble', sort: 20, grant: { bubbleId: 'bb_glass', bubbleName: '毛玻璃', bubbleCls: 'bubble-glass' }, ...base },
    { id: 'bb_ink', name: '水墨气泡', desc: '素雅的水墨风', price: 140, kind: 'bubble', category: 'bubble', sort: 30, grant: { bubbleId: 'bb_ink', bubbleName: '水墨', bubbleCls: 'bubble-ink' }, ...base },
    { id: 'bb_candy', name: '糖果气泡', desc: '活泼的糖果配色', price: 160, kind: 'bubble', category: 'bubble', sort: 40, grant: { bubbleId: 'bb_candy', bubbleName: '糖果', bubbleCls: 'bubble-candy' }, ...base },
    { id: 'bb_forest', name: '森林气泡', desc: '清新的森绿配色', price: 160, kind: 'bubble', category: 'bubble', sort: 50, grant: { bubbleId: 'bb_forest', bubbleName: '森林', bubbleCls: 'bubble-forest' }, ...base },
  ];
}

/* 商品实际售价（折扣价有效时取折扣价） */
function shopItemPrice(it) {
  const d = Number(it.discountPrice) || 0;
  const p = Math.max(0, Math.floor(Number(it.price) || 0));
  return (d > 0 && d < p) ? Math.floor(d) : p;
}
/* 是否处于可售时间窗内 */
function shopItemOnSale(it, t = nowMs()) {
  if (it.active === false) return false;
  if (it.startAt && t < it.startAt) return false;
  if (it.endAt && t > it.endAt) return false;
  return true;
}
/* 某用户已购次数（用于限购） */
function boughtCount(user, itemId) {
  return (Array.isArray(user.purchases) ? user.purchases : []).filter((o) => o.itemId === itemId).length;
}

/* 我的经济概览（需登录） */
router.get('/api/economy/me', async (ctx) => {
  const { user } = ctx;
  if (!user) unauth();
  return ok({ economy: economyView(user) }, ctx);
});

/* 每日签到：连续签到叠加奖励，每日一次；奖励曲线与里程碑由后台配置 */
router.post('/api/economy/checkin', async (ctx) => {
  const { env, user } = ctx;
  if (!user) unauth();
  const cfg = await getCheckinConfig(env);
  const e = user.economy = user.economy || { mo: 0, meow: 0, checkin: { last: 0, streak: 0, count: 0, days: [] } };
  e.checkin = e.checkin || { last: 0, streak: 0, count: 0, days: [] };
  const day = dayNum(nowMs());
  const days = checkinDays(e.checkin);
  if (days.includes(day) || dayNum(e.checkin.last || 0) === day) {
    return fail(400, 'ALREADY', '今天已经签到过了', ctx);
  }
  days.push(day);
  e.checkin.days = days.slice(-200);
  e.checkin.last = nowMs();
  e.checkin.count = (e.checkin.count || 0) + 1;
  e.checkin.streak = recalcStreak(e.checkin.days, day);

  const capped = Math.min(e.checkin.streak, Math.max(1, cfg.streakCapDays));
  let mo = Math.max(0, cfg.baseMo + (capped - 1) * cfg.streakStepMo);
  let meow = Math.max(0, cfg.baseMeow + (capped - 1) * cfg.streakStepMeow);
  // 里程碑：连签天数刚好命中时一次性额外奖励
  const hit = (cfg.milestones || []).find((m) => Number(m.days) === e.checkin.streak);
  if (hit) { mo += Math.max(0, Math.floor(Number(hit.mo) || 0)); meow += Math.max(0, Math.floor(Number(hit.meow) || 0)); }
  // 经验加成券：期限内 Meow 翻倍
  const boosted = !!consumeVoucherInline(user, 'boost');
  if (boosted) meow *= 2;

  e.mo = (e.mo || 0) + mo;
  e.meow = (e.meow || 0) + meow;
  await saveUser(env, user);
  return ok({
    mo, meow, boosted, streak: e.checkin.streak, count: e.checkin.count,
    milestone: hit ? { days: hit.days, note: hit.note || '', mo: hit.mo, meow: hit.meow } : null,
    economy: economyView(user),
  }, ctx);
});

/* 签到日历：返回指定月份（YYYY-MM，缺省当月）的签到状态 + 里程碑进度 */
router.get('/api/economy/checkin/calendar', async (ctx) => {
  const { env, user, url } = ctx;
  if (!user) unauth();
  const cfg = await getCheckinConfig(env);
  const c = user.economy?.checkin || { last: 0, streak: 0, count: 0, days: [] };
  const set = new Set(checkinDays(c));
  const mParam = String(url.searchParams.get('month') || '').trim();
  const m = /^(\d{4})-(\d{2})$/.exec(mParam);
  const now = new Date();
  const y = m ? +m[1] : now.getUTCFullYear();
  const mo = m ? +m[2] : now.getUTCMonth() + 1;
  const first = dateToDay(`${y}-${String(mo).padStart(2, '0')}-01`);
  if (first == null) bad('月份格式应为 YYYY-MM');
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const today = dayNum(nowMs());
  const list = [];
  for (let i = 0; i < daysInMonth; i++) {
    const d = first + i;
    list.push({ date: dayToDate(d), day: i + 1, checked: set.has(d), future: d > today, today: d === today });
  }
  // 兼容历史数据：只有 last 没有 days 时，至少把最后一次签到日标出来
  if (!set.size && c.last) {
    const ld = dayNum(c.last);
    const row = list.find((x) => x.date === dayToDate(ld));
    if (row) row.checked = true;
  }
  return ok({
    month: `${y}-${String(mo).padStart(2, '0')}`,
    days: list,
    streak: c.streak || 0, count: c.count || 0,
    checkedToday: set.has(today) || dayNum(c.last || 0) === today,
    makeupLeft: (user.vouchers || []).filter((v) => v.kind === 'makeup' && (!v.expiresAt || v.expiresAt > nowMs())).length,
    config: { milestones: cfg.milestones || [], baseMo: cfg.baseMo, baseMeow: cfg.baseMeow, streakCapDays: cfg.streakCapDays },
  }, ctx);
});

/* 补签：消耗一张补签卡，补回某个漏签日期（仅限最近 30 天内、且非未来） */
router.post('/api/economy/checkin/makeup', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  const cfg = await getCheckinConfig(env);
  const target = dateToDay(String(body.date || ''));
  if (target == null) bad('日期格式应为 YYYY-MM-DD');
  const today = dayNum(nowMs());
  if (target > today) bad('不能补签未来的日期');
  if (today - target > 30) bad('只能补签最近 30 天内的日期');
  const e = user.economy = user.economy || { mo: 0, meow: 0, checkin: { last: 0, streak: 0, count: 0, days: [] } };
  e.checkin = e.checkin || { last: 0, streak: 0, count: 0, days: [] };
  const days = checkinDays(e.checkin);
  if (days.includes(target)) return fail(400, 'ALREADY', '该日期已经签过了', ctx);
  if (!consumeVoucherInline(user, 'makeup')) return fail(400, 'NO_CARD', '没有可用的补签卡，先去商城购买', ctx);
  days.push(target);
  e.checkin.days = [...new Set(days)].sort((a, b) => a - b).slice(-200);
  e.checkin.count = (e.checkin.count || 0) + 1;
  e.checkin.streak = recalcStreak(e.checkin.days, Math.max(today, dayNum(e.checkin.last || 0)));
  const mo = Math.max(0, Math.floor(cfg.makeupMo));
  const meow = Math.max(0, Math.floor(cfg.makeupMeow));
  e.mo = (e.mo || 0) + mo;
  e.meow = (e.meow || 0) + meow;
  await saveUser(env, user);
  return ok({ date: dayToDate(target), mo, meow, streak: e.checkin.streak, economy: economyView(user) }, ctx);
});

/* 签到规则配置（读：登录可见；写：仅超管） */
router.get('/api/admin/checkin/config', async (ctx) => {
  const { env, user } = ctx;
  if (!user) unauth();
  return ok({ config: await getCheckinConfig(env) }, ctx);
});
router.put('/api/admin/checkin/config', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (!await isSuperAdmin(env, user)) forbid('仅超级管理员可配置签到规则');
  const d = defaultCheckinConfig();
  const num = (v, dv, min, max) => (Number.isFinite(+v) ? clamp(Math.floor(+v), min, max) : dv);
  const conf = {
    baseMo: num(body.baseMo, d.baseMo, 0, 10000),
    baseMeow: num(body.baseMeow, d.baseMeow, 0, 10000),
    streakStepMo: num(body.streakStepMo, d.streakStepMo, 0, 1000),
    streakStepMeow: num(body.streakStepMeow, d.streakStepMeow, 0, 1000),
    streakCapDays: num(body.streakCapDays, d.streakCapDays, 1, 365),
    makeupMo: num(body.makeupMo, d.makeupMo, 0, 10000),
    makeupMeow: num(body.makeupMeow, d.makeupMeow, 0, 10000),
    milestones: (Array.isArray(body.milestones) ? body.milestones : d.milestones).slice(0, 20).map((m) => ({
      days: num(m.days, 7, 1, 3650),
      mo: num(m.mo, 0, 0, 100000),
      meow: num(m.meow, 0, 0, 100000),
      note: String(m.note || '').slice(0, 60),
    })).filter((m) => m.days),
  };
  const cfg = await getSiteConfig(env);
  cfg.checkinConfig = conf;
  await saveSiteConfig(env, cfg);
  await writeAudit(env, user, 'checkin.config', '', JSON.stringify(conf).slice(0, 200));
  return ok({ config: conf }, ctx);
});

/* 商城：公开可见在售商品 */
router.get('/api/shop', async (ctx) => {
  const { env } = ctx;
  let items = await KV.getJSON(env, 'cfg:shop', []);
  if (!Array.isArray(items) || !items.length) { items = defaultShop(); await KV.putJSON(env, 'cfg:shop', items); }
  else {
    // 合并默认商品中缺失的项（如后续新增的头像框），避免旧商户库缺货
    const have = new Set(items.map((x) => x.id));
    let changed = false;
    for (const d of defaultShop()) {
      if (!have.has(d.id)) { items.push(d); changed = true; }
    }
    if (changed) await KV.putJSON(env, 'cfg:shop', items);
  }
  const t = nowMs();
  const me = ctx.user || null;
  const privileged = !!(me && ((me.roles?.global || []).includes('role_super_admin') || me.official));
  const myLevel = me ? levelFromMeow(me.economy?.meow).level : 0;
  const list = items
    .filter((x) => x.active !== false)
    .map((x) => {
      const price = shopItemPrice(x);
      const onSale = shopItemOnSale(x, t);
      const limit = Math.max(0, Math.floor(Number(x.limitPerUser) || 0));
      const mine = me ? boughtCount(me, x.id) : 0;
      const levelMin = Math.max(0, Math.floor(Number(x.levelMin) || 0));
      const levelLocked = !privileged && !!(levelMin && me && myLevel < levelMin);
      const limitReached = !privileged && !!(limit && mine >= limit);
      return {
        id: x.id, name: x.name, desc: x.desc, kind: x.kind,
        category: SHOP_CATEGORIES.some((c) => c.id === x.category) ? x.category : (SHOP_CATEGORIES.some((c) => c.id === x.kind) ? x.kind : 'other'),
        price, originPrice: Math.max(0, Math.floor(Number(x.price) || 0)),
        discounted: price < Math.max(0, Math.floor(Number(x.price) || 0)),
        grant: x.grant, stock: x.stock, sold: x.sold, sort: Number(x.sort) || 0,
        startAt: x.startAt || 0, endAt: x.endAt || 0, onSale,
        limitPerUser: limit, myBought: mine,
        limitReached, levelMin, levelLocked,
        // 特权账号（超管 / 官方）默认拥有全部道具，前端据此显示「已拥有（特权）」
        granted: privileged,
      };
    })
    .sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.price - b.price);
  return ok({ items: list, categories: SHOP_CATEGORIES, level: myLevel, moUnlimited: privileged }, ctx);
});

/* 我的购买记录（订单） */
router.get('/api/shop/orders', async (ctx) => {
  const { user, url } = ctx;
  if (!user) unauth();
  const limit = clamp(parseInt(url.searchParams.get('limit') || '50', 10), 1, 200);
  const orders = (Array.isArray(user.purchases) ? user.purchases : [])
    .slice()
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, limit);
  const spent = (user.purchases || []).reduce((s, o) => s + (Number(o.price) || 0), 0);
  return ok({ orders, total: (user.purchases || []).length, spent }, ctx);
});

/* 我的券包（需登录） */
router.get('/api/shop/mine', async (ctx) => {
  const { user } = ctx;
  if (!user) unauth();
  const vouchers = (user.vouchers || []).filter((v) => !v.expiresAt || v.expiresAt > nowMs());
  return ok({ vouchers }, ctx);
});

/* 购买商品（需登录，扣 MO值） */
router.post('/api/shop/buy', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  const itemId = String(body.itemId || '');
  const items = await KV.getJSON(env, 'cfg:shop', []);
  const item = items.find((x) => x.id === itemId);
  if (!item || item.active === false) return fail(404, 'NO_ITEM', '商品不存在或已下架', ctx);
  if (!shopItemOnSale(item)) return fail(400, 'NOT_ON_SALE', '该商品当前不在可购买时间内', ctx);
  if (item.stock != null && item.stock >= 0 && (item.sold || 0) >= item.stock) return fail(400, 'SOLD_OUT', '已售罄', ctx);
  // 特权账号（超管 / 官方）默认拥有全部道具：免限购 / 免等级门槛 / 免 MO 扣费
  const privileged = !!(user && ((user.roles?.global || []).includes('role_super_admin') || user.official));
  // 限购：按用户历史购买记录判定
  const limit = Math.max(0, Math.floor(Number(item.limitPerUser) || 0));
  if (!privileged && limit && boughtCount(user, item.id) >= limit) return fail(400, 'LIMIT', `该商品每人限购 ${limit} 件`, ctx);
  // 等级门槛
  const levelMin = Math.max(0, Math.floor(Number(item.levelMin) || 0));
  const myLevel = levelFromMeow(user.economy?.meow).level;
  if (!privileged && levelMin && myLevel < levelMin) return fail(400, 'LEVEL', `需要 Lv.${levelMin} 才能购买（当前 Lv.${myLevel}）`, ctx);
  const price = shopItemPrice(item);
  const e = user.economy = user.economy || { mo: 0, meow: 0, checkin: { last: 0, streak: 0, count: 0, days: [] } };
  if (!privileged) {
    if ((e.mo || 0) < price) return fail(400, 'NO_MO', 'MO值不足', ctx);
    e.mo -= price;
  }
  user.vouchers = user.vouchers || [];
  const g = item.grant || {};
  if (item.kind === 'voucher') {
    user.vouchers.push({
      id: uid(), kind: g.voucherKind || 'accelerate',
      label: g.label || (VOUCHER_KINDS[g.voucherKind] && VOUCHER_KINDS[g.voucherKind].label) || '券',
      issuedAt: nowMs(),
      expiresAt: g.durationDays ? nowMs() + g.durationDays * 86400000 : 0,
      meta: g.meta || {},
    });
  } else if (item.kind === 'badge') {
    user.badges = user.badges || [];
    if (!user.badges.find((b) => b.id === g.badgeId)) user.badges.push({ id: g.badgeId, name: g.badgeName || item.name, awardedAt: nowMs() });
  } else if (item.kind === 'role') {
    const sc = g.scope || 'global';
    user.roles = user.roles || {};
    user.roles[sc] = user.roles[sc] || [];
    if (!user.roles[sc].includes(g.roleId)) user.roles[sc].push(g.roleId);
  } else if (item.kind === 'frame') {
    if (!g.frameCls || FRAME_CLASSES.indexOf(g.frameCls) < 0) return fail(400, 'BAD_FRAME', '非法的头像框样式', ctx);
    user.avatarFrames = user.avatarFrames || [];
    if (!user.avatarFrames.find((f) => f.id === g.frameId)) {
      user.avatarFrames.push({ id: g.frameId, name: g.frameName || item.name, cls: g.frameCls });
    }
    user.avatarFrame = g.frameCls;
  } else if (item.kind === 'title') {
    // 称号：写入持有列表；若当前未佩戴任何有效称号则自动佩戴
    const title = normalizeTitle({
      id: g.titleId || item.id, name: g.titleName || item.name,
      color: g.titleColor, icon: g.titleIcon, desc: item.desc, rare: g.rare,
    }, { source: 'shop', grantedAt: nowMs(), ...(g.durationDays ? { expiresAt: nowMs() + g.durationDays * 86400000 } : {}) });
    if (!title.name) return fail(400, 'BAD_TITLE', '称号名称缺失', ctx);
    grantTitleInline(user, title);
  } else if (item.kind === 'card') {
    if (!g.cardCls || CARD_CLASSES.indexOf(g.cardCls) < 0) return fail(400, 'BAD_CARD', '非法的名片样式', ctx);
    user.cardStyles = user.cardStyles || [];
    if (!user.cardStyles.find((f) => f.id === g.cardId)) {
      user.cardStyles.push({ id: g.cardId, name: g.cardName || item.name, cls: g.cardCls });
    }
    user.cardStyle = g.cardCls;
  } else if (item.kind === 'bubble') {
    if (!g.bubbleCls || BUBBLE_CLASSES.indexOf(g.bubbleCls) < 0) return fail(400, 'BAD_BUBBLE', '非法的消息皮肤样式', ctx);
    user.bubbleStyles = user.bubbleStyles || [];
    if (!user.bubbleStyles.find((f) => f.id === g.bubbleId)) {
      user.bubbleStyles.push({ id: g.bubbleId, name: g.bubbleName || item.name, cls: g.bubbleCls });
    }
    user.bubbleStyle = g.bubbleCls;
  } else {
    return fail(400, 'BAD_KIND', '不支持的商品类型', ctx);
  }
  item.sold = (item.sold || 0) + 1;
  // 订单记录（同时作为限购依据），最多保留最近 300 条
  user.purchases = Array.isArray(user.purchases) ? user.purchases : [];
  const order = { id: uid('o'), itemId: item.id, name: item.name, kind: item.kind, price, at: nowMs() };
  user.purchases.push(order);
  if (user.purchases.length > 300) user.purchases = user.purchases.slice(-300);
  await saveUser(env, user);
  await KV.putJSON(env, 'cfg:shop', items);
  return ok({
    economy: economyView(user), vouchers: user.vouchers, order,
    item: { id: item.id, name: item.name, kind: item.kind, price },
  }, ctx);
});

/* 商城后台管理（仅超管） */
router.get('/api/shop/admin', async (ctx) => {
  const { env, user } = ctx;
  if (!user || !(await isSuperAdmin(env, user))) return fail(403, 'FORBIDDEN', 'super admin only', ctx);
  const items = await KV.getJSON(env, 'cfg:shop', []);
  return ok({ items: Array.isArray(items) ? items : [] }, ctx);
});
router.put('/api/shop/admin', async (ctx) => {
  const { env, user } = ctx;
  if (!user || !(await isSuperAdmin(env, user))) return fail(403, 'FORBIDDEN', 'super admin only', ctx);
  const body = await readBody(ctx.req);
  const raw = Array.isArray(body.items) ? body.items : [];
  const num = (v, dv = 0) => (Number.isFinite(+v) ? Math.floor(+v) : dv);
  // 规范化：补全分类/限购/时间窗/折扣等新字段，避免脏数据击穿购买逻辑
  const items = raw.slice(0, 200).map((x) => ({
    ...x,
    id: String(x.id || '').trim().slice(0, 60) || uid('it'),
    name: String(x.name || '').slice(0, 60),
    desc: String(x.desc || '').slice(0, 200),
    kind: String(x.kind || 'other').slice(0, 20),
    category: SHOP_CATEGORIES.some((c) => c.id === x.category) ? x.category
      : (SHOP_CATEGORIES.some((c) => c.id === x.kind) ? x.kind : 'other'),
    price: Math.max(0, num(x.price)),
    discountPrice: Math.max(0, num(x.discountPrice)),
    limitPerUser: Math.max(0, num(x.limitPerUser)),
    levelMin: Math.max(0, num(x.levelMin)),
    startAt: Math.max(0, num(x.startAt)),
    endAt: Math.max(0, num(x.endAt)),
    sort: num(x.sort),
    stock: x.stock == null ? -1 : num(x.stock, -1),
    sold: Math.max(0, num(x.sold)),
    active: x.active !== false,
    grant: x.grant && typeof x.grant === 'object' ? x.grant : {},
  })).filter((x) => x.name);
  await KV.putJSON(env, 'cfg:shop', items);
  await writeAudit(env, user, 'shop.admin', '', `${items.length} items`);
  return ok({ ok: true, items }, ctx);
});

/* ==========================================================================
 * 称号系统：目录（公开）/ 佩戴（本人）/ 颁发与撤销（管理层）
 * ========================================================================== */

router.get('/api/titles/catalog', async (ctx) => {
  return ok({ items: await getTitleCatalog(ctx.env) }, ctx);
});

router.put('/api/admin/titles/catalog', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (!await isSuperAdmin(env, user)) forbid('仅超级管理员可管理称号目录');
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 100)
    .map((t) => normalizeTitle(t)).filter((t) => t.name);
  const cfg = await getSiteConfig(env);
  cfg.titleCatalog = items;
  await saveSiteConfig(env, cfg);
  await writeAudit(env, user, 'titles.catalog', '', `${items.length} titles`);
  return ok({ items }, ctx);
});

/* 我持有的称号 + 当前佩戴 */
router.get('/api/me/titles', async (ctx) => {
  const { user } = ctx;
  if (!user) unauth();
  const t = nowMs();
  return ok({
    titles: (Array.isArray(user.titles) ? user.titles : []).filter((x) => !x.expiresAt || x.expiresAt > t),
    equipped: equippedTitleOf(user),
  }, ctx);
});

/* 佩戴 / 卸下称号（titleId 为空表示卸下） */
router.patch('/api/me/title', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  const titleId = String(body.titleId || '');
  if (!titleId) {
    user.title = '';
    await saveUser(env, user);
    return ok({ title: null, titles: user.titles || [] }, ctx);
  }
  const owned = (user.titles || []).find((x) => x.id === titleId);
  if (!owned) return fail(404, 'NO_TITLE', '你还没有这个称号', ctx);
  if (owned.expiresAt && owned.expiresAt <= nowMs()) return fail(400, 'EXPIRED', '该称号已过期', ctx);
  user.title = titleId;
  await saveUser(env, user);
  return ok({ title: equippedTitleOf(user), titles: user.titles || [] }, ctx);
});

/* 颁发称号：超管，或持有 user.title / appearance.badge 权限者 */
router.put('/api/admin/titles/grant', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  const isSA = await isSuperAdmin(env, user);
  if (!isSA && !(await hasPerm(env, user, 'user.title')) && !(await hasPerm(env, user, 'appearance.badge'))) {
    forbid('缺少颁发称号的权限');
  }
  const target = await getUser(env, String(body.userId || ''));
  if (!target) notfound('用户不存在');
  if (target.protected && !isSA) forbid('该用户受保护，仅超级管理员可操作');
  const days = Math.max(0, Math.floor(Number(body.durationDays) || 0));
  const title = normalizeTitle(body.title || {}, {
    source: 'grant', grantedBy: user.id, grantedAt: nowMs(),
    ...(days ? { expiresAt: nowMs() + days * 86400000 } : {}),
  });
  if (!title.name) bad('称号名称不能为空');
  grantTitleInline(target, title);
  await saveUser(env, target);
  await writeAudit(env, user, 'titles.grant', target.username, title.name);
  await pushNotification(env, target.id, {
    type: 'honor', title: '你获得了新称号',
    body: `${title.icon || ''}${title.name}`.trim() + (days ? `（${days} 天有效）` : ''),
    link: '/economy.html',
  });
  return ok({ titles: target.titles, equipped: equippedTitleOf(target) }, ctx);
});

/* 撤销称号（仅超管） */
router.put('/api/admin/titles/revoke', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (!await isSuperAdmin(env, user)) forbid('仅超级管理员可撤销称号');
  const target = await getUser(env, String(body.userId || ''));
  if (!target) notfound('用户不存在');
  const titleId = String(body.titleId || '');
  target.titles = (Array.isArray(target.titles) ? target.titles : []).filter((x) => x.id !== titleId);
  if (target.title === titleId) target.title = '';
  await saveUser(env, target);
  await writeAudit(env, user, 'titles.revoke', target.username, titleId);
  return ok({ titles: target.titles }, ctx);
});

/* ==========================================================================
 * 装扮系统：名片背景 / 消息气泡皮肤（头像框见 PATCH /api/me/avatar-frame）
 * ========================================================================== */

router.get('/api/me/decor', async (ctx) => {
  const { user } = ctx;
  if (!user) unauth();
  return ok({
    cardStyle: user.cardStyle || '', cardStyles: user.cardStyles || [],
    bubbleStyle: user.bubbleStyle || '', bubbleStyles: user.bubbleStyles || [],
    avatarFrame: user.avatarFrame || '', avatarFrames: user.avatarFrames || [],
    catalog: { cards: CARD_CLASSES, bubbles: BUBBLE_CLASSES, frames: FRAME_CLASSES },
  }, ctx);
});

/* 装备 / 卸下名片或气泡皮肤（传空串卸下；必须是已拥有且在白名单内的样式） */
router.patch('/api/me/decor', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  let touched = false;
  if (body.cardId !== undefined) {
    const id = String(body.cardId || '');
    if (!id) { user.cardStyle = ''; touched = true; } else {
      const owned = (user.cardStyles || []).find((f) => f.id === id);
      if (!owned) return fail(404, 'NO_CARD', '你还没有这个名片装扮', ctx);
      if (CARD_CLASSES.indexOf(owned.cls) < 0) return fail(400, 'BAD_CARD', '非法的名片样式', ctx);
      user.cardStyle = owned.cls; touched = true;
    }
  }
  if (body.bubbleId !== undefined) {
    const id = String(body.bubbleId || '');
    if (!id) { user.bubbleStyle = ''; touched = true; } else {
      const owned = (user.bubbleStyles || []).find((f) => f.id === id);
      if (!owned) return fail(404, 'NO_BUBBLE', '你还没有这个消息皮肤', ctx);
      if (BUBBLE_CLASSES.indexOf(owned.cls) < 0) return fail(400, 'BAD_BUBBLE', '非法的消息皮肤样式', ctx);
      user.bubbleStyle = owned.cls; touched = true;
    }
  }
  if (!touched) bad('未指定要装备的装扮');
  await saveUser(env, user);
  return ok({
    cardStyle: user.cardStyle || '', bubbleStyle: user.bubbleStyle || '',
    cardStyles: user.cardStyles || [], bubbleStyles: user.bubbleStyles || [],
  }, ctx);
});

/**
 * 装扮目录（超管）：返回可用样式类白名单 + 当前已上架的装扮商品。
 * 注意：样式类白名单是代码级常量，**不开放后台编辑** —— 它直接对应 main.css 里
 * 的类名，一旦允许后台写入任意字符串就等于开放 CSS 注入。要加新样式，
 * 必须同时改 main.css 和 FRAME/CARD/BUBBLE_CLASSES。后台能做的是「用哪个类
 * 上架成什么商品、卖多少钱」。
 */
router.get('/api/admin/decor/catalog', async (ctx) => {
  const { env, user } = ctx;
  if (!user) unauth();
  if (!await isSuperAdmin(env, user)) forbid('仅超级管理员可管理装扮目录');
  const raw = await KV.getJSON(env, 'cfg:shop', []);
  const items = (Array.isArray(raw) && raw.length ? raw : defaultShop())
    .filter((x) => ['frame', 'card', 'bubble'].includes(x.kind));
  return ok({
    palette: { frames: FRAME_CLASSES, cards: CARD_CLASSES, bubbles: BUBBLE_CLASSES },
    items,
  }, ctx);
});

/* ==========================================================================
 * 等级系统：等级曲线 + 特权表 + 行为奖励配置
 * ========================================================================== */

router.get('/api/levels', async (ctx) => {
  const { env, user } = ctx;
  const perks = await getLevelPerks(env);
  const rewards = await getActionRewards(env);
  // 前 30 级所需累计经验，供前端画曲线/表格
  const curve = [];
  for (let l = 1; l <= 30; l++) curve.push({ level: l, need: l * l * 50 });
  return ok({
    curve, perks, rewards,
    me: user ? { ...levelFromMeow(user.economy?.meow), meow: user.economy?.meow || 0 } : null,
  }, ctx);
});

router.put('/api/admin/levels/perks', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (!await isSuperAdmin(env, user)) forbid('仅超级管理员可配置等级特权');
  const perks = (Array.isArray(body.perks) ? body.perks : []).slice(0, 100).map((p) => ({
    level: clamp(Math.floor(Number(p.level) || 1), 1, 999),
    label: String(p.label || '').slice(0, 30),
    desc: String(p.desc || '').slice(0, 200),
  })).filter((p) => p.label || p.desc).sort((a, b) => a.level - b.level);
  const cfg = await getSiteConfig(env);
  cfg.levelPerks = perks;
  if (body.rewards && typeof body.rewards === 'object') {
    const clean = {};
    for (const [k, v] of Object.entries(body.rewards)) {
      if (!/^[a-zA-Z_]{1,20}$/.test(k)) continue;
      clean[k] = {
        mo: clamp(Math.floor(Number(v?.mo) || 0), 0, 10000),
        meow: clamp(Math.floor(Number(v?.meow) || 0), 0, 10000),
      };
    }
    cfg.actionRewards = { ...defaultActionRewards(), ...clean };
  }
  await saveSiteConfig(env, cfg);
  await writeAudit(env, user, 'levels.perks', '', `${perks.length} perks`);
  return ok({ perks, rewards: await getActionRewards(env) }, ctx);
});

/* 自定义等级（专属）：超级管理员为任意用户指定覆盖式等级 + Markdown 等级名。
 * 用于超管 / 官方账号的专属身份标识；等级名支持 Markdown（前端走安全内联渲染，禁 XSS）。
 * 传 reset:true 清除自定义等级，回落到 Meow 经验推导。 */
router.put('/api/admin/users/:id/level', async (ctx) => {
  const { env, user, body, params } = ctx;
  if (!user) unauth();
  if (!await isSuperAdmin(env, user)) forbid('仅超级管理员可设置自定义等级');
  const target = await getUser(env, String(params.id || ''));
  if (!target) notfound('用户不存在');
  if (body && body.reset) {
    delete target.customLevel;
  } else {
    const level = clamp(Math.floor(Number(body?.level) || 1), 1, 9999);
    const name = String(body?.name || '').slice(0, 60);
    const color = /^\#[0-9a-fA-F]{6}$/.test(String(body?.color || '')) ? body.color : '#7c3aed';
    if (!level && !name) return fail(400, 'BAD_LEVEL', '等级与名称不能全空', ctx);
    target.customLevel = { level, name, color, markdown: true };
  }
  await saveUser(env, target);
  await writeAudit(env, user, 'user.customLevel', target.id,
    target.customLevel ? `Lv.${target.customLevel.level} "${target.customLevel.name}"` : 'reset');
  return ok({ user: publicUser(target, user, {}), customLevel: target.customLevel || null }, ctx);
});

/* ==========================================================================
 * 赠礼与赞赏：礼物目录 / 赠送 / 礼物墙 / 收礼榜 / 内容赞赏
 * ========================================================================== */

router.get('/api/gifts/catalog', async (ctx) => {
  const g = await getGiftConfig(ctx.env);
  return ok({ items: g.catalog, giftRate: g.giftRate, tipRate: g.tipRate, tipMax: g.tipMax }, ctx);
});

router.put('/api/admin/gifts/catalog', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (!await isSuperAdmin(env, user)) forbid('仅超级管理员可管理礼物目录');
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 60).map((g) => ({
    id: String(g.id || '').trim().slice(0, 40) || 'gift_' + uid('g'),
    name: String(g.name || '').trim().slice(0, 20),
    icon: String(g.icon || '🎁').slice(0, 4),
    price: clamp(Math.floor(Number(g.price) || 0), 1, 100000),
    desc: String(g.desc || '').slice(0, 120),
  })).filter((g) => g.name);
  const cfg = await getSiteConfig(env);
  cfg.giftCatalog = items;
  if (body.giftReceiveRate !== undefined) cfg.giftReceiveRate = clamp(Number(body.giftReceiveRate) || 0, 0, 1);
  if (body.tipReceiveRate !== undefined) cfg.tipReceiveRate = clamp(Number(body.tipReceiveRate) || 0, 0, 1);
  if (body.tipMax !== undefined) cfg.tipMax = clamp(Math.floor(Number(body.tipMax) || 0), 1, 100000);
  await saveSiteConfig(env, cfg);
  await writeAudit(env, user, 'gifts.catalog', '', `${items.length} gifts`);
  return ok({ items }, ctx);
});

/* 赠礼：扣赠礼方 MO，按比例到账收礼方，并写入对方礼物墙 */
router.post('/api/gifts/send', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (!await canEconomyAct(env, user, 'economy.gift')) forbid('当前状态不可赠礼');
  await guardRate(env, `gift:${user.id}`, 30, 600, '赠礼过于频繁，请稍后再试');
  const conf = await getGiftConfig(env);
  const gift = conf.catalog.find((g) => g.id === String(body.giftId || ''));
  if (!gift) return fail(404, 'NO_GIFT', '礼物不存在', ctx);
  const count = clamp(Math.floor(Number(body.count) || 1), 1, 99);
  let target = null;
  if (body.userId) target = await getUser(env, String(body.userId));
  else if (body.username) target = await findUserByUsername(env, String(body.username));
  if (!target) notfound('收礼用户不存在');
  if (target.id === user.id) bad('不能给自己赠礼');
  if (target.flags?.banned) bad('该用户已被封禁，无法收礼');

  const cost = Math.floor(gift.price * count);
  const e = user.economy = user.economy || { mo: 0, meow: 0, checkin: { last: 0, streak: 0, count: 0, days: [] } };
  if ((e.mo || 0) < cost) return fail(400, 'NO_MO', `MO值不足，需要 ${cost}`, ctx);
  e.mo -= cost;
  const message = sanitizeContent(String(body.message || '').trim(), 200);
  // 赠礼方也拿一点经验（配置项 gift）
  const award = await awardActionInline(env, user, 'gift');
  await saveUser(env, user);

  const gain = Math.floor(cost * conf.giftRate);
  const te = target.economy = target.economy || { mo: 0, meow: 0, checkin: { last: 0, streak: 0, count: 0, days: [] } };
  te.mo = (te.mo || 0) + gain;
  te.meow = (te.meow || 0) + count * 2;
  target.giftsReceived = Array.isArray(target.giftsReceived) ? target.giftsReceived : [];
  target.giftsReceived.unshift({
    id: uid('gf'), giftId: gift.id, name: gift.name, icon: gift.icon, count,
    mo: gain, message,
    from: { id: user.id, username: user.username, displayName: user.displayName || user.username, avatar: user.avatar || '' },
    at: nowMs(),
  });
  if (target.giftsReceived.length > 100) target.giftsReceived = target.giftsReceived.slice(0, 100);
  target.giftStats = target.giftStats || { count: 0, mo: 0 };
  target.giftStats.count += count;
  target.giftStats.mo += gain;
  await saveUser(env, target);
  ctx.waitUntil(bumpGiftBoard(env, target, count, gain));
  await pushNotification(env, target.id, {
    type: 'gift', title: `${user.displayName || user.username} 送了你 ${gift.icon}${gift.name} ×${count}`,
    body: message || `你获得了 ${gain} MO`, link: '/economy.html',
    actor: { id: user.id, name: user.displayName || user.username, avatar: user.avatar || '' },
  });
  return ok({
    gift: { id: gift.id, name: gift.name, icon: gift.icon }, count, cost, gain,
    award, economy: economyView(user),
  }, ctx);
});

/* 某用户的礼物墙（公开） */
router.get('/api/users/:username/gifts', async (ctx) => {
  const { env, params, url } = ctx;
  const key = String(params.username || '');
  // 与 /api/users/:id 保持一致：既接受用户 ID 也接受用户名
  let target = await getUser(env, key);
  if (!target) target = await findUserByUsername(env, key);
  if (!target) notfound('用户不存在');
  const limit = clamp(parseInt(url.searchParams.get('limit') || '30', 10), 1, 100);
  const list = (Array.isArray(target.giftsReceived) ? target.giftsReceived : []).slice(0, limit);
  // 按礼物种类聚合，前端可直接画「礼物墙」
  const agg = {};
  for (const g of (target.giftsReceived || [])) {
    const k = g.giftId || g.name;
    agg[k] = agg[k] || { giftId: g.giftId, name: g.name, icon: g.icon, count: 0 };
    agg[k].count += g.count || 1;
  }
  return ok({
    gifts: list,
    wall: Object.values(agg).sort((a, b) => b.count - a.count),
    stats: target.giftStats || { count: 0, mo: 0 },
  }, ctx);
});

/* 收礼榜（公开，取聚合表） */
router.get('/api/gifts/board', async (ctx) => {
  const { env, url } = ctx;
  const limit = clamp(parseInt(url.searchParams.get('limit') || '20', 10), 1, 50);
  const board = await KV.getJSON(env, 'stat:giftboard', []);
  return ok({ items: (Array.isArray(board) ? board : []).slice(0, limit) }, ctx);
});

/* 赞赏（打赏）文章或评论：MO 直接转给作者，按比例到账 */
router.post('/api/tips/send', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (!await canEconomyAct(env, user, 'economy.tip')) forbid('当前状态不可赞赏');
  await guardRate(env, `tip:${user.id}`, 30, 600, '赞赏过于频繁，请稍后再试');
  const conf = await getGiftConfig(env);
  const amount = clamp(Math.floor(Number(body.amount) || 0), 1, conf.tipMax);
  if (!amount) bad('赞赏金额至少为 1 MO');
  const targetType = body.targetType === 'comment' ? 'comment' : 'post';
  const postId = String(body.postId || body.targetId || '');
  const p = await KV.getJSON(env, `post:${postId}`);
  if (!p) notfound('内容不存在');
  let authorId = p.authorId;
  let ckey = '';
  if (targetType === 'comment') {
    ckey = `cmt:${postId}:${String(body.targetId || '')}`;
    const c = await KV.getJSON(env, ckey);
    if (!c) notfound('评论不存在');
    authorId = c.authorId;
  }
  if (authorId === user.id) bad('不能赞赏自己的内容');
  const author = await getUser(env, authorId);
  if (!author) notfound('作者不存在');

  const e = user.economy = user.economy || { mo: 0, meow: 0, checkin: { last: 0, streak: 0, count: 0, days: [] } };
  if ((e.mo || 0) < amount) return fail(400, 'NO_MO', `MO值不足，需要 ${amount}`, ctx);
  e.mo -= amount;
  await saveUser(env, user);

  const gain = Math.floor(amount * conf.tipRate);
  const ae = author.economy = author.economy || { mo: 0, meow: 0, checkin: { last: 0, streak: 0, count: 0, days: [] } };
  ae.mo = (ae.mo || 0) + gain;
  ae.meow = (ae.meow || 0) + Math.max(1, Math.floor(amount / 10));
  await saveUser(env, author);

  // 在文章上累计赞赏数据（评论赞赏也归到所属文章，方便展示「本文共获赞赏 N MO」）
  p.tips = p.tips || { count: 0, mo: 0, recent: [] };
  p.tips.count += 1;
  p.tips.mo += amount;
  p.tips.recent = [{
    id: uid('tp'), targetType, targetId: String(body.targetId || postId), amount,
    message: sanitizeContent(String(body.message || '').trim(), 200),
    from: { id: user.id, username: user.username, displayName: user.displayName || user.username, avatar: user.avatar || '' },
    at: nowMs(),
  }, ...(Array.isArray(p.tips.recent) ? p.tips.recent : [])].slice(0, 30);
  await KV.putJSON(env, `post:${postId}`, p);

  await pushNotification(env, author.id, {
    type: 'tip', title: `${user.displayName || user.username} 赞赏了你 ${amount} MO`,
    body: `你收到 ${gain} MO`, link: `/post.html?id=${postId}`,
    actor: { id: user.id, name: user.displayName || user.username, avatar: user.avatar || '' }, refId: postId,
  });
  return ok({ amount, gain, tips: { count: p.tips.count, mo: p.tips.mo }, economy: economyView(user) }, ctx);
});

/* 某文章的赞赏记录（公开） */
router.get('/api/posts/:id/tips', async (ctx) => {
  const { env, params } = ctx;
  const p = await KV.getJSON(env, `post:${params.id}`);
  if (!p) notfound('文章不存在');
  const t = p.tips || { count: 0, mo: 0, recent: [] };
  return ok({ count: t.count || 0, mo: t.mo || 0, recent: Array.isArray(t.recent) ? t.recent : [] }, ctx);
});

router.get('/api/presence', async (ctx) => {
  const { url } = ctx;
  const limit = clamp(parseInt(url.searchParams.get('limit') || '0', 10), 0, 100);
  const stats = presenceStats();
  const users = limit
    ? [...PRESENCE.entries()]
      .filter(([, p]) => p.status !== 'invisible' && nowMs() - p.at <= PRESENCE_TTL)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, limit)
      .map(([id, p]) => ({
        id, username: p.username, displayName: p.name, avatar: p.avatar,
        official: p.official, status: p.status, statusText: p.text, lastSeen: p.at,
      }))
    : [];
  return ok({ ...stats, users, ttl: PRESENCE_TTL, serverTime: nowMs() }, ctx);
});

/**
 * 设置自己的在线状态（在线/离开/忙碌/隐身 + 自定义文案）。
 * 只有真正发生变化时才写一次 KV；写失败也不影响本次会话内的在线态展示。
 */
router.put('/api/me/status', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  const status = normalizeStatus(body.status);
  const text = sanitizeContent(String(body.statusText ?? body.text ?? '').slice(0, 40)).trim();
  const changed = normalizeStatus(user.status) !== status || String(user.statusText || '') !== text;
  user.status = status;
  user.statusText = text;
  touchPresence(user);              // 立即生效（内存），不依赖 KV 是否写成功
  let persisted = true;
  if (changed) {
    try { await saveUser(env, user); }
    catch (e) { persisted = false; console.error('[status] 持久化失败（非致命）：', e?.message || e); }
  }
  return ok({ status, statusText: text, persisted, presence: presenceStats() }, ctx);
});

router.post('/api/me/email/change', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  const email = String(body.email || '').toLowerCase().trim();
  if (!EMAIL_RE.test(email)) bad('邮箱格式不正确');
  if (!(await consumeEmailCode(env, email, 'bind', body.code))) bad('验证码错误或已过期');
  const occupied = await findUserByEmail(env, email);
  if (occupied && occupied.id !== user.id) conflict('该邮箱已被其他账号使用');
  if (user.email) await KV.del(env, await emailKey(user.email));
  user.email = email; user.emailVerified = true;
  await saveUser(env, user);
  await env.DB.put(await emailKey(email), user.id);
  return ok({ email }, ctx);
});

router.delete('/api/me', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (String(body.confirm) !== user.username) bad('请输入用户名以确认注销');
  user.flags = { ...(user.flags || {}), banned: true, bannedReason: 'self-deleted' };
  user.email = ''; user.password = ''; user.tokenVersion = (user.tokenVersion || 1) + 1;
  user.displayName = '已注销用户'; user.bio = ''; user.avatar = ''; user.links = [];
  await saveUser(env, user);
  return ok({ deleted: true }, ctx);
});

/* ========================================================================== *
 * 14. 站内私信
 * ========================================================================== */

const threadIdOf = (a, b) => [a, b].sort().join('__');

router.get('/api/dm/threads', async (ctx) => {
  const { env, user } = ctx;
  if (!user) unauth();
  const { keys } = await KV.list(env, `dmix:${user.id}:`, 100);
  const items = [];
  for (const k of keys) {
    try {
      const rec = await KV.getJSON(env, k.name);
      if (!rec || !rec.peerId) continue;
      const peer = await getUser(env, rec.peerId);
      items.push({
        threadId: rec.threadId, unread: rec.unread || 0, lastAt: rec.lastAt, lastText: rec.lastText || '',
        peer: peer ? { id: peer.id, username: peer.username, displayName: peer.displayName, avatar: peer.avatar } : null,
      });
    } catch (e) { console.error('[dm/threads] key', k.name, e); }
  }
  items.sort((a, b) => b.lastAt - a.lastAt);
  return ok({ items }, ctx);
});

router.get('/api/dm/:userId', async (ctx) => {
  const { env, user, params, url } = ctx;
  if (!user) unauth();
  const peer = await getUser(env, params.userId);
  if (!peer) notfound('用户不存在');
  const tid = threadIdOf(user.id, peer.id);
  const { keys, cursor, list_complete } = await KV.list(env, `dm:${tid}:`, clamp(url.searchParams.get('limit') || 50, 1, 100), url.searchParams.get('cursor'));
  const items = (await KV.many(env, keys.map((k) => k.name))).filter(Boolean).sort((a, b) => a.createdAt - b.createdAt);
  try {
    const ix = await KV.getJSON(env, `dmix:${user.id}:${tid}`);
    if (ix?.unread) await KV.putJSON(env, `dmix:${user.id}:${tid}`, { ...ix, unread: 0 });
  } catch (e) { console.error('[dm/history] reset unread failed', e); }
  return ok({
    items, cursor: list_complete ? null : cursor,
    peer: { id: peer.id, username: peer.username, displayName: peer.displayName, avatar: peer.avatar },
  }, ctx);
});

router.post('/api/dm/:userId', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  await requirePerm(env, user, 'dm.send');
  if (await isMuted(env, user)) forbid('你当前处于禁言状态');
  await guardRate(env, `dm:${user.id}`, 30, 300, '私信发送过于频繁');
  const peer = await getUser(env, params.userId);
  if (!peer) notfound('用户不存在');
  if (peer.id === user.id) bad('不能给自己发私信');

  const content = sanitizeContent(String(body.content || '').trim(), 4000);
  if (!content) bad('内容不能为空');
  const tid = threadIdOf(user.id, peer.id);
  const id = sortableId();
  const msg = { id, threadId: tid, from: user.id, to: peer.id, content, createdAt: nowMs() };
  await KV.putJSON(env, `dm:${tid}:${id}`, msg, { expirationTtl: 86400 * 365 });

  try {
    await KV.putJSON(env, `dmix:${user.id}:${tid}`, { threadId: tid, peerId: peer.id, unread: 0, lastAt: msg.createdAt, lastText: content.slice(0, 60) });
    const peerIx = await KV.getJSON(env, `dmix:${peer.id}:${tid}`);
    await KV.putJSON(env, `dmix:${peer.id}:${tid}`, {
      threadId: tid, peerId: user.id, unread: (peerIx?.unread || 0) + 1, lastAt: msg.createdAt, lastText: content.slice(0, 60) });
  } catch (e) { console.error('[dm/send] index write failed', e); }

  if (peer.notifySettings?.dm !== false) {
    await pushNotification(env, peer.id, {
      type: 'dm', title: `${user.displayName} 给你发了私信`, body: content.slice(0, 60),
      link: `/messages.html?peer=${user.id}`, actor: { id: user.id, name: user.displayName, avatar: user.avatar } });
  }
  return ok({ message: msg }, ctx);
});

/* ========================================================================== *
 * 15. 版块 / 频道（层级：版块 ⊃ 频道，版主 > 频道主）
 * ========================================================================== *
 *  bd:<boardId>                      版块主体
 *  ch:<boardId>:<channelId>          频道主体（挂在版块下）
 *  作用域：board:<bid> / channel:<bid>:<cid>（权限沿 scopeChain 向下继承）
 * ========================================================================== */

router.get('/api/boards', async (ctx) => {
  const { env, user } = ctx;
  const { keys } = await KV.list(env, 'bd:', 200);
  const boards = await KV.many(env, keys.map((k) => k.name));
  const items = [];
  for (const b of boards) {
    if (!b || !b.id) continue;
    if (b.visibility === 'private') {
      if (!user) continue;
      if (!(await getMember(env, `board:${b.id}`, user.id)) && !(await isSuperAdmin(env, user))) continue;
    }
    const chKeys = await KV.list(env, `ch:${b.id}:`, 100);
    items.push({ ...b, channelCount: chKeys.keys.length,
      isOwner: !!user && b.ownerId === user.id,
      canManage: !!user && await hasPerm(env, user, 'board.manage', `board:${b.id}`) });
  }
  items.sort((a, b) => (b.order || 0) - (a.order || 0) || a.createdAt - b.createdAt);
  return ok({ items }, ctx);
});

router.post('/api/boards', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  await requirePerm(env, user, 'board.create');
  const name = String(body.name || '').trim().slice(0, 40);
  if (name.length < 2) bad('版块名至少 2 个字符');
  const id = uid('b');
  const bd = {
    id, name, slug: slugify(name), icon: String(body.icon || '📁').slice(0, 8),
    avatar: String(body.avatar || '').slice(0, 500),
    iconUrl: String(body.iconUrl || '').slice(0, 500),
    description: String(body.description || '').slice(0, 300),
    banner: '', visibility: body.visibility === 'private' ? 'private' : 'public',
    officialBadge: body.officialBadge === true || body.officialBadge === 'true',
    official: false, committee: [],
    ownerId: user.id, order: 0, memberCount: 1,
    welcomeEnabled: body.welcomeEnabled === true || body.welcomeEnabled === 'true',
    welcomeChannelId: String(body.welcomeChannelId || '').slice(0, 40),
    welcomeMessage: String(body.welcomeMessage || '欢迎加入 ${user}！').slice(0, 500),
    welcomeImage: String(body.welcomeImage || '').slice(0, 500),
    onboarding: String(body.onboarding || '').slice(0, 2000),
    botEnabled: body.botEnabled === false ? false : true,
    allowReactions: body.allowReactions === false ? false : true,
    bannedUsers: [], blacklist: [],
    createdAt: nowMs(),
  };
  await KV.putJSON(env, `bd:${id}`, bd);
  const scope = `board:${id}`;
  await seedRoles(env, scope, ['board_owner','board_admin','member','muted']);
  await saveMember(env, scope, user.id, { roles: ['role_board_owner'] });
  // 默认附带一个综合频道，创建后即可直接发文
  const cid = uid('c');
  await KV.putJSON(env, `ch:${id}:${cid}`, {
    id: cid, boardId: id, name: '综合讨论', icon: '💬', topic: '', type: 'text',
    private: false, ownerId: user.id, order: 0, memberCount: 1, createdAt: nowMs(),
  });
  await seedRoles(env, `channel:${id}:${cid}`, ['channel_owner','channel_admin','member','muted']);
  // 社区数据里的版块/频道/群组数改为实时 list 计数（countCommunity），不再用 stat，省 KV 写
  await writeAudit(env, user, 'board.create', `${bd.name} (${bd.id})`, '');
  return ok({ board: bd }, ctx);
});

router.get('/api/boards/:id', async (ctx) => {
  const { env, user, params } = ctx;
  const bd = await KV.getJSON(env, `bd:${params.id}`);
  if (!bd) notfound('版块不存在');
  const scope = `board:${bd.id}`;
  const { keys } = await KV.list(env, `ch:${bd.id}:`, 200);
  const channels = (await KV.many(env, keys.map((k) => k.name))).filter(Boolean)
    .sort((a, b) => (a.order || 0) - (b.order || 0) || a.createdAt - b.createdAt);
  const member = user ? await getMember(env, scope, user.id) : null;
  return ok({
    board: bd,
    channels,
    member,
    roles: await listRoles(env, scope),
    perms: user ? [...(await collectPerms(env, user, scope))] : [],
    canManage: !!user && await hasPerm(env, user, 'board.manage', scope),
  }, ctx);
});

router.put('/api/boards/:id', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const bd = await KV.getJSON(env, `bd:${params.id}`);
  if (!bd) notfound('版块不存在');
  await requirePerm(env, user, 'board.manage', `board:${bd.id}`);
  const canOfficial = await canPublishAnnouncement(env, user);
  for (const k of ['name','description','icon','banner','visibility','avatar','welcomeChannelId','welcomeMessage','welcomeImage','onboarding','iconUrl']) {
    if (body[k] !== undefined) bd[k] = String(body[k]).slice(0, 2000);
  }
  if (body.order !== undefined) bd.order = Number(body.order) || 0;
  if (body.officialBadge !== undefined) bd.officialBadge = body.officialBadge === true || body.officialBadge === 'true';
  if (body.official !== undefined && canOfficial) bd.official = !!body.official;
  if (body.welcomeEnabled !== undefined) bd.welcomeEnabled = body.welcomeEnabled === true || body.welcomeEnabled === 'true';
  if (body.botEnabled !== undefined) bd.botEnabled = body.botEnabled === true || body.botEnabled === 'true';
  if (body.allowReactions !== undefined) bd.allowReactions = body.allowReactions === true || body.allowReactions === 'true';
  await KV.putJSON(env, `bd:${bd.id}`, bd);
  await writeAudit(env, user, 'board.update', `${bd.name} (${bd.id})`, '');
  return ok({ board: bd }, ctx);
});

router.delete('/api/boards/:id', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const bd = await KV.getJSON(env, `bd:${params.id}`);
  if (!bd) notfound('版块不存在');
  if (bd.ownerId !== user.id) await requirePerm(env, user, 'site.admin');
  // 级联删除版块下的全部频道
  const { keys } = await KV.list(env, `ch:${bd.id}:`, 500);
  await Promise.all(keys.map((k) => KV.del(env, k.name)));
  await KV.del(env, `bd:${bd.id}`);
  // 社区数据改为 countCommunity 实时计数，不再维护 stat
  await writeAudit(env, user, 'board.delete', `${bd.name} (${bd.id})`, '');
  return ok({ deleted: bd.id }, ctx);
});

router.post('/api/boards/:id/join', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const bd = await KV.getJSON(env, `bd:${params.id}`);
  if (!bd) notfound('版块不存在');
  const scope = `board:${bd.id}`;
  if ((bd.blacklist || []).includes(user.id)) forbid('你已被该版块列入黑名单，无法加入');
  if (await getMember(env, scope, user.id)) return ok({ joined: true, already: true }, ctx);
  await saveMember(env, scope, user.id, { roles: ['role_member'] });
  bd.memberCount = (bd.memberCount || 0) + 1;
  await KV.putJSON(env, `bd:${bd.id}`, bd);
  // 欢迎机器人：在指定欢迎频道发送欢迎语 + 图
  if (bd.welcomeEnabled && bd.welcomeChannelId && bd.welcomeChannelId !== 'none') {
    const msg = String(bd.welcomeMessage || '欢迎加入 ${user}！').replace(/\$\{user\}/g, '@' + (user.displayName || user.username));
    let full = '👋 ' + msg;
    if (bd.welcomeImage) full += '\n' + bd.welcomeImage;
    await postBotMessage(env, bd.id, bd.welcomeChannelId, full).catch(() => {});
  }
  return ok({ joined: true }, ctx);
});

router.get('/api/boards/:id/members', async (ctx) => {
  const { env, user, params, url } = ctx;
  const scope = `board:${params.id}`;
  const { keys, cursor, list_complete } = await KV.list(env, `member:${scope}:`, clamp(url.searchParams.get('limit') || 50, 1, 200), url.searchParams.get('cursor'));
  const members = await KV.many(env, keys.map((k) => k.name));
  const items = [];
  for (const m of members) {
    const u = await getUser(env, m.userId);
    if (!u) continue;
    items.push({
      ...publicUser(u, user), nickname: m.nickname || '', roles: m.roles || [],
      mutedUntil: m.mutedUntil || 0, joinedAt: m.joinedAt,
      roleTags: await roleTagsOf(env, u, scope),
    });
  }
  return ok({ items, cursor: list_complete ? null : cursor }, ctx);
});

/* ------------------------- 频道（挂在版块下） --------------------------- */

router.post('/api/boards/:id/channels', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const bd = await KV.getJSON(env, `bd:${params.id}`);
  if (!bd) notfound('版块不存在');
  await requirePerm(env, user, 'channel.create', `board:${bd.id}`);
  const name = String(body.name || '').trim().slice(0, 40);
  if (!name) bad('请输入频道名称');
  const cid = uid('c');
  const canOfficial = await canPublishAnnouncement(env, user);
  const ch = {
    id: cid, boardId: bd.id, name,
    type: ['text','voice','forum','announcement'].includes(body.type) ? body.type : 'text',
    icon: String(body.icon || '#').slice(0, 8), avatar: String(body.avatar || '').slice(0, 500),
    iconUrl: String(body.iconUrl || '').slice(0, 500),
    topic: String(body.topic || '').slice(0, 300),
    ownerId: user.id, order: Number(body.order) || 0,
    private: !!body.private, memberCount: 1, createdAt: nowMs(),
    official: canOfficial && !!body.official, committee: [],
  };
  await KV.putJSON(env, `ch:${bd.id}:${cid}`, ch);
  const scope = `channel:${bd.id}:${cid}`;
  await seedRoles(env, scope, ['channel_owner','channel_admin','member','muted']);
  await saveMember(env, scope, user.id, { roles: ['role_channel_owner'] });
  return ok({ channel: ch }, ctx);
});

router.put('/api/boards/:bid/channels/:cid', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const key = `ch:${params.bid}:${params.cid}`;
  const ch = await KV.getJSON(env, key);
  if (!ch) notfound('频道不存在');
  // 频道主（频道作用域）与版主（版块作用域，权限沿链继承）均可管理
  await requirePerm(env, user, 'channel.manage', `channel:${params.bid}:${params.cid}`);
  const canOfficial = await canPublishAnnouncement(env, user);
  for (const k of ['name','topic','icon','avatar','type','iconUrl']) if (body[k] !== undefined) ch[k] = String(body[k]).slice(0, 500);
  if (body.order !== undefined) ch.order = Number(body.order) || 0;
  if (body.private !== undefined) ch.private = !!body.private;
  if (body.allowReactions !== undefined) ch.allowReactions = body.allowReactions === true || body.allowReactions === 'true';
  if (body.official !== undefined && canOfficial) ch.official = !!body.official;
  await KV.putJSON(env, key, ch);
  return ok({ channel: ch }, ctx);
});

router.delete('/api/boards/:bid/channels/:cid', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const key = `ch:${params.bid}:${params.cid}`;
  const ch = await KV.getJSON(env, key);
  if (!ch) notfound('频道不存在');
  await requirePerm(env, user, 'channel.manage', `channel:${params.bid}:${params.cid}`);
  await KV.del(env, key);
  await KV.del(env, `chlog:${params.bid}:${params.cid}`);   // 一并清掉群聊记录
  CH_CACHE.delete(`chlog:${params.bid}:${params.cid}`);
  return ok({ deleted: params.cid }, ctx);
});

/* ------------------------- 群组（与频道关联，但独立存在） ------------------ */

function groupKey(id) { return `group:${id}`; }
function gmemberKey(gid, uid) { return `gmember:${gid}:${uid}`; }
function channelGroupsPrefix(boardId, channelId) { return `chg:${boardId}:${channelId}:`; }

async function requireGroupMember(env, user, group) {
  if (!user) unauth();
  const m = await KV.getJSON(env, gmemberKey(group.id, user.id));
  if (!m) bad('你还不是该群组成员', 'NOT_MEMBER');
  return m;
}

async function requireGroupAdmin(env, user, group) {
  if (!user) unauth();
  if (group.ownerId === user.id) return true;
  const m = await KV.getJSON(env, gmemberKey(group.id, user.id));
  if (m && (m.role === 'owner' || m.role === 'admin')) return true;
  // 频道/版块管理员也拥有管理权限
  if (await hasPerm(env, user, 'channel.manage', `channel:${group.boardId}:${group.channelId}`)) return true;
  forbid('需要群主或管理员权限');
}

async function enrichGroup(env, g, viewerId) {
  const owner = await getUser(env, g.ownerId);
  const ch = await KV.getJSON(env, `ch:${g.boardId}:${g.channelId}`);
  const bd = await KV.getJSON(env, `bd:${g.boardId}`);
  let membership = null;
  if (viewerId) membership = await KV.getJSON(env, gmemberKey(g.id, viewerId));
  return {
    ...g,
    owner: owner ? publicUser(owner, null) : null,
    channel: ch ? { id: ch.id, name: ch.name, icon: ch.icon } : null,
    board: bd ? { id: bd.id, name: bd.name, icon: bd.icon } : null,
    isMember: !!membership,
    isAdmin: !!membership && (membership.role === 'owner' || membership.role === 'admin'),
  };
}

router.get('/api/groups', async (ctx) => {
  const { env, user, url } = ctx;
  const boardId = url.searchParams.get('boardId');
  const channelId = url.searchParams.get('channelId');
  const mine = url.searchParams.get('mine') === '1';
  let keys = [];
  if (channelId && boardId) {
    const prefix = channelGroupsPrefix(boardId, channelId);
    const res = await KV.list(env, prefix, 200);
    keys = res.keys;
  } else if (mine && user) {
    // 列出我加入的群组：扫描所有 gmember:{gid}:{uid}
    const res = await KV.list(env, `gmember:`, 500);
    const myKeys = res.keys.filter((k) => k.name.endsWith(`:${user.id}`));
    const groupIds = myKeys.map((k) => k.name.split(':')[1]).filter(Boolean);
    const groups = (await KV.many(env, groupIds.map((id) => groupKey(id)))).filter(Boolean);
    const items = await Promise.all(groups.map((g) => enrichGroup(env, g, user.id)));
    return ok({ items }, ctx);
  } else {
    const res = await KV.list(env, 'group:', 200);
    keys = res.keys;
  }
  const groups = (await KV.many(env, keys.map((k) => k.name))).filter(Boolean);
  const items = await Promise.all(groups.map((g) => enrichGroup(env, g, user && user.id)));
  items.sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0) || b.createdAt - a.createdAt);
  return ok({ items }, ctx);
});

router.get('/api/groups/:id', async (ctx) => {
  const { env, user, params } = ctx;
  const g = await KV.getJSON(env, groupKey(params.id));
  if (!g) notfound('群组不存在');
  return ok({ group: await enrichGroup(env, g, user && user.id) }, ctx);
});

router.post('/api/groups', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  const boardId = String(body.boardId || '');
  const channelId = String(body.channelId || '');
  if (!boardId || !channelId) bad('请选择关联的频道');
  const ch = await KV.getJSON(env, `ch:${boardId}:${channelId}`);
  if (!ch) notfound('关联频道不存在');
  // 必须是该频道成员（或拥有频道管理权限）
  const chMember = await getMember(env, `channel:${boardId}:${channelId}`, user.id);
  if (!chMember && !(await hasPerm(env, user, 'channel.manage', `channel:${boardId}:${channelId}`))) {
    bad('需要先加入该频道才能创建关联群组');
  }
  const name = String(body.name || '').trim().slice(0, 40);
  if (name.length < 2) bad('群组名至少 2 个字符');
  const id = uid('g');
  const g = {
    id, name,
    description: String(body.description || '').slice(0, 300),
    icon: String(body.icon || '👥').slice(0, 8),
    avatar: String(body.avatar || '').slice(0, 500),
    iconUrl: String(body.iconUrl || '').slice(0, 500),
    boardId, channelId,
    ownerId: user.id,
    visibility: body.visibility === 'private' ? 'private' : 'public',
    officialBadge: body.officialBadge === true || body.officialBadge === 'true',
    official: false, committee: [],
    allowReactions: body.allowReactions === false ? false : true,
    welcomeEnabled: body.welcomeEnabled === true || body.welcomeEnabled === 'true',
    welcomeMessage: String(body.welcomeMessage || '欢迎加入 ${user}！').slice(0, 500),
    onboarding: String(body.onboarding || '').slice(0, 2000),
    memberCount: 1,
    createdAt: nowMs(), updatedAt: nowMs(),
  };
  await KV.putJSON(env, groupKey(id), g);
  await KV.putJSON(env, gmemberKey(id, user.id), { userId: user.id, groupId: id, role: 'owner', joinedAt: nowMs() });
  await KV.putJSON(env, channelGroupsPrefix(boardId, channelId) + id, { groupId: id, createdAt: nowMs() });
  await writeAudit(env, user, 'group.create', `${g.name} (${g.id})`, `channel=${channelId}`);
  return ok({ group: await enrichGroup(env, g, user.id) }, ctx);
});

router.put('/api/groups/:id', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const g = await KV.getJSON(env, groupKey(params.id));
  if (!g) notfound('群组不存在');
  await requireGroupAdmin(env, user, g);
  const canOfficial = await canPublishAnnouncement(env, user);
  for (const k of ['name','description','icon','avatar','iconUrl']) {
    if (body[k] !== undefined) g[k] = String(body[k]).slice(0, k === 'description' ? 300 : 500);
  }
  if (body.visibility !== undefined) g.visibility = body.visibility === 'private' ? 'private' : 'public';
  if (body.officialBadge !== undefined) g.officialBadge = body.officialBadge === true || body.officialBadge === 'true';
  if (body.official !== undefined && canOfficial) g.official = !!body.official;
  if (body.allowReactions !== undefined) g.allowReactions = body.allowReactions === true || body.allowReactions === 'true';
  if (body.welcomeEnabled !== undefined) g.welcomeEnabled = body.welcomeEnabled === true || body.welcomeEnabled === 'true';
  if (body.welcomeMessage !== undefined) g.welcomeMessage = String(body.welcomeMessage).slice(0, 500);
  if (body.onboarding !== undefined) g.onboarding = String(body.onboarding).slice(0, 2000);
  g.updatedAt = nowMs();
  await KV.putJSON(env, groupKey(g.id), g);
  await writeAudit(env, user, 'group.update', `${g.name} (${g.id})`, '');
  return ok({ group: await enrichGroup(env, g, user.id) }, ctx);
});

router.delete('/api/groups/:id', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const g = await KV.getJSON(env, groupKey(params.id));
  if (!g) notfound('群组不存在');
  await requireGroupAdmin(env, user, g);
  // 级联删除成员
  const { keys } = await KV.list(env, `gmember:${g.id}:`, 500);
  await Promise.all(keys.map((k) => KV.del(env, k.name)));
  await KV.del(env, channelGroupsPrefix(g.boardId, g.channelId) + g.id);
  await KV.del(env, groupKey(g.id));
  await writeAudit(env, user, 'group.delete', `${g.name} (${g.id})`, '');
  return ok({ deleted: g.id }, ctx);
});

router.post('/api/groups/:id/join', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const g = await KV.getJSON(env, groupKey(params.id));
  if (!g) notfound('群组不存在');
  if (g.visibility === 'private') forbid('该群组为私密群组，需要邀请才能加入');
  const key = gmemberKey(g.id, user.id);
  if (await KV.getJSON(env, key)) return ok({ joined: true, already: true }, ctx);
  await KV.putJSON(env, key, { userId: user.id, groupId: g.id, role: 'member', joinedAt: nowMs() });
  g.memberCount = (g.memberCount || 0) + 1;
  await KV.putJSON(env, groupKey(g.id), g);
  return ok({ joined: true }, ctx);
});

router.post('/api/groups/:id/leave', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const g = await KV.getJSON(env, groupKey(params.id));
  if (!g) notfound('群组不存在');
  if (g.ownerId === user.id) bad('群主不能退出群组，请转让或删除');
  const key = gmemberKey(g.id, user.id);
  const m = await KV.getJSON(env, key);
  if (!m) return ok({ left: false, already: true }, ctx);
  await KV.del(env, key);
  g.memberCount = Math.max(0, (g.memberCount || 1) - 1);
  await KV.putJSON(env, groupKey(g.id), g);
  return ok({ left: true }, ctx);
});

router.get('/api/groups/:id/members', async (ctx) => {
  const { env, user, params, url } = ctx;
  const g = await KV.getJSON(env, groupKey(params.id));
  if (!g) notfound('群组不存在');
  if (g.visibility === 'private') await requireGroupMember(env, user, g);
  const { keys, cursor, list_complete } = await KV.list(env, `gmember:${g.id}:`, clamp(url.searchParams.get('limit') || 50, 1, 200), url.searchParams.get('cursor'));
  const members = await KV.many(env, keys.map((k) => k.name));
  const items = [];
  for (const m of members) {
    const u = await getUser(env, m.userId);
    if (!u) continue;
    items.push({ ...publicUser(u, user), role: m.role || 'member', joinedAt: m.joinedAt });
  }
  return ok({ items, cursor: list_complete ? null : cursor }, ctx);
});

/* ------------------------- 好友系统（申请 + 双向关系 + 权限） ---------------- */

function friendKey(a, b) { return a < b ? `friend:${a}:${b}` : `friend:${b}:${a}`; }
function friendRequestKey(id) { return `freq:${id}`; }

async function areFriends(env, a, b) {
  if (a === b) return false;
  return !!(await KV.getJSON(env, friendKey(a, b)));
}

async function enrichFriend(env, rec, viewerId) {
  const uid = rec.userA === viewerId ? rec.userB : rec.userA;
  const u = await getUser(env, uid);
  if (!u) return null;
  return { ...publicUser(u, viewerId), note: rec.note || '', permissions: rec.permissions || {}, since: rec.since };
}

router.get('/api/friends', async (ctx) => {
  const { env, user, url } = ctx;
  if (!user) unauth();
  const { keys, cursor, list_complete } = await KV.list(env, `friend:${user.id}:`, clamp(url.searchParams.get('limit') || 50, 1, 200), url.searchParams.get('cursor'));
  const recs = await KV.many(env, keys.map((k) => k.name));
  const items = (await Promise.all(recs.map((r) => enrichFriend(env, r, user.id)))).filter(Boolean);
  return ok({ items, cursor: list_complete ? null : cursor }, ctx);
});

router.get('/api/friends/requests', async (ctx) => {
  const { env, user, url } = ctx;
  if (!user) unauth();
  const type = url.searchParams.get('type') || 'incoming'; // incoming | outgoing
  const prefix = type === 'outgoing' ? `freq:out:${user.id}:` : `freq:in:${user.id}:`;
  const { keys } = await KV.list(env, prefix, 100);
  const reqs = await KV.many(env, keys.map((k) => k.name));
  const items = [];
  for (const r of reqs) {
    const otherId = type === 'outgoing' ? r.toId : r.fromId;
    const u = await getUser(env, otherId);
    if (!u) continue;
    items.push({ ...r, user: publicUser(u, user) });
  }
  return ok({ items }, ctx);
});

router.post('/api/friends/request', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  const toId = String(body.toId || '');
  if (!toId || toId === user.id) bad('无效的目标用户');
  const target = await getUser(env, toId);
  if (!target) notfound('用户不存在');
  if (await areFriends(env, user.id, toId)) bad('你们已经是好友');
  if (await KV.getJSON(env, `block:${toId}:${user.id}`)) bad('对方已屏蔽你，无法发送好友申请');
  // 幂等：若已有待处理申请，返回已有
  const { keys } = await KV.list(env, `freq:in:${toId}:`, 50);
  const existing = (await KV.many(env, keys.map((k) => k.name))).find((r) => r.fromId === user.id && r.status === 'pending');
  if (existing) return ok({ request: existing, already: true }, ctx);
  const id = uid('fr');
  const req = {
    id, fromId: user.id, toId,
    message: String(body.message || '').slice(0, 200),
    status: 'pending', createdAt: nowMs(), updatedAt: nowMs(),
  };
  await KV.putJSON(env, friendRequestKey(id), req);
  await KV.putJSON(env, `freq:in:${toId}:${id}`, req);
  await KV.putJSON(env, `freq:out:${user.id}:${id}`, req);
  await pushNotification(env, toId, {
    type: 'friend_request', title: '新的好友申请',
    body: `${user.displayName || user.username} 请求添加你为好友`,
    actor: { id: user.id, name: user.displayName || user.username },
  });
  return ok({ request: req }, ctx);
});

router.post('/api/friends/requests/:id/accept', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const req = await KV.getJSON(env, friendRequestKey(params.id));
  if (!req || req.toId !== user.id) notfound('申请不存在');
  if (req.status !== 'pending') bad('该申请已处理');
  req.status = 'accepted'; req.updatedAt = nowMs();
  await KV.putJSON(env, friendRequestKey(req.id), req);
  await KV.putJSON(env, `freq:in:${user.id}:${req.id}`, req);
  await KV.putJSON(env, `freq:out:${req.fromId}:${req.id}`, req);
  const since = nowMs();
  const recA = { userA: req.fromId, userB: req.toId, note: '', permissions: { viewProfile: true, viewPosts: true, viewFriends: false }, since };
  await KV.putJSON(env, friendKey(req.fromId, req.toId), recA);
  await KV.putJSON(env, `friend:${req.fromId}:${req.toId}`, recA);
  await KV.putJSON(env, `friend:${req.toId}:${req.fromId}`, recA);
  await pushNotification(env, req.fromId, {
    type: 'friend_accept', title: '好友申请已通过',
    body: `${user.displayName || user.username} 已同意你的好友申请`,
    actor: { id: user.id, name: user.displayName || user.username },
  });
  return ok({ friendship: recA }, ctx);
});

router.post('/api/friends/requests/:id/reject', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const req = await KV.getJSON(env, friendRequestKey(params.id));
  if (!req || req.toId !== user.id) notfound('申请不存在');
  req.status = 'rejected'; req.updatedAt = nowMs();
  await KV.putJSON(env, friendRequestKey(req.id), req);
  await KV.putJSON(env, `freq:in:${user.id}:${req.id}`, req);
  await KV.putJSON(env, `freq:out:${req.fromId}:${req.id}`, req);
  return ok({ request: req }, ctx);
});

router.post('/api/friends/requests/:id/block', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const req = await KV.getJSON(env, friendRequestKey(params.id));
  if (!req || req.toId !== user.id) notfound('申请不存在');
  req.status = 'blocked'; req.updatedAt = nowMs();
  await KV.putJSON(env, friendRequestKey(req.id), req);
  await KV.putJSON(env, `freq:in:${user.id}:${req.id}`, req);
  await KV.putJSON(env, `freq:out:${req.fromId}:${req.id}`, req);
  // 拉黑请求者：阻止其再次向你发送好友申请
  await KV.putJSON(env, `block:${user.id}:${req.fromId}`, { at: nowMs(), by: user.id });
  return ok({ request: req }, ctx);
});

router.delete('/api/friends/:id', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const friendId = params.id;
  const rec = await KV.getJSON(env, friendKey(user.id, friendId));
  if (!rec) notfound('好友关系不存在');
  await KV.del(env, friendKey(user.id, friendId));
  await KV.del(env, `friend:${user.id}:${friendId}`);
  await KV.del(env, `friend:${friendId}:${user.id}`);
  return ok({ deleted: friendId }, ctx);
});

router.put('/api/friends/:id', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const friendId = params.id;
  let rec = await KV.getJSON(env, friendKey(user.id, friendId));
  if (!rec) notfound('好友关系不存在');
  if (body.note !== undefined) rec.note = String(body.note || '').slice(0, 50);
  if (body.permissions && typeof body.permissions === 'object') {
    const allowed = ['viewProfile', 'viewPosts', 'viewFriends', 'viewOnline'];
    const next = {};
    for (const k of allowed) next[k] = body.permissions[k] === true;
    rec.permissions = next;
  }
  await KV.putJSON(env, friendKey(user.id, friendId), rec);
  await KV.putJSON(env, `friend:${user.id}:${friendId}`, rec);
  // 对对方也做对称记录（简单起见用同一份记录覆盖）
  await KV.putJSON(env, `friend:${friendId}:${user.id}`, rec);
  return ok({ friendship: rec }, ctx);
});

/* ------------------------- 作用域身份组管理（OWNER 面板） ------------------ */

router.get('/api/roles', async (ctx) => {
  const { env, user, url } = ctx;
  const scope = scopeKeyOf(url.searchParams.get('scope') || 'global');
  const roles = await listRoles(env, scope);
  return ok({
    scope, roles,
    catalog: Object.entries(PERMISSIONS)
      .filter(([, v]) => scope === 'global' || v.scope === 'S')
      .map(([k, v]) => ({ key: k, ...v })),
    canManage: !!user && await hasPerm(env, user, 'role.manage', scope),
  }, ctx);
});

router.post('/api/roles', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  const scope = scopeKeyOf(body.scope || 'global');
  await requirePerm(env, user, 'role.manage', scope);
  const superAdmin = await isSuperAdmin(env, user);
  // 非超管不得在自己作用域外授予权限，也不得授予自己没有的权限
  const mine = await collectPerms(env, user, scope);
  const perms = (Array.isArray(body.perms) ? body.perms : []).filter((p) => ALL_PERMS.includes(p))
    .filter((p) => superAdmin || (mine.has(p) && PERMISSIONS[p].scope === 'S'));
  const id = body.id && String(body.id).startsWith('role_') ? String(body.id) : `role_${uid().slice(0, 10)}`;
  const role = {
    id, scope, key: 'custom',
    name: String(body.name || '新身份组').slice(0, 30),
    color: /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#64748b',
    priority: clamp(body.priority ?? 200, 0, superAdmin ? 999 : 690),
    perms, system: false, hoist: body.hoist !== false, mentionable: body.mentionable !== false,
    createdAt: nowMs(), createdBy: user.id,
  };
  await saveRole(env, role);
  await writeAudit(env, user, 'role.create', `${role.name} (${role.id})`, `scope=${scope}`);
  return ok({ role }, ctx);
});

router.put('/api/roles/:id', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const scope = scopeKeyOf(body.scope || 'global');
  await requirePerm(env, user, 'role.manage', scope);
  const role = await getRole(env, scope, params.id);
  if (!role) notfound('身份组不存在');
  const superAdmin = await isSuperAdmin(env, user);
  if (role.id === 'role_super_admin' && !superAdmin) forbid('无权修改超级管理员组');
  const mine = await collectPerms(env, user, scope);
  if (body.name !== undefined) role.name = String(body.name).slice(0, 30);
  if (body.color !== undefined && /^#[0-9a-fA-F]{6}$/.test(body.color)) role.color = body.color;
  if (body.priority !== undefined) role.priority = clamp(body.priority, 0, superAdmin ? 999 : 690);
  if (body.hoist !== undefined) role.hoist = !!body.hoist;
  if (Array.isArray(body.perms)) {
    role.perms = body.perms.filter((p) => ALL_PERMS.includes(p))
      .filter((p) => superAdmin || (mine.has(p) && PERMISSIONS[p].scope === 'S'));
  }
  await saveRole(env, role);
  await writeAudit(env, user, 'role.update', `${role.name} (${role.id})`, `scope=${scope}`);
  return ok({ role }, ctx);
});

router.delete('/api/roles/:id', async (ctx) => {
  const { env, user, params, url } = ctx;
  if (!user) unauth();
  const scope = scopeKeyOf(url.searchParams.get('scope') || 'global');
  await requirePerm(env, user, 'role.manage', scope);
  const role = await getRole(env, scope, params.id);
  if (!role) notfound('身份组不存在');
  if (role.system) bad('系统预设身份组不可删除');
  await KV.del(env, `role:${scope}:${params.id}`);
  await writeAudit(env, user, 'role.delete', `${role.name} (${role.id})`, `scope=${scope}`);
  return ok({ deleted: params.id }, ctx);
});

router.post('/api/roles/assign', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  const scope = scopeKeyOf(body.scope || 'global');
  await requirePerm(env, user, 'user.role', scope);
  const target = await getUser(env, body.userId);
  if (!target) notfound('用户不存在');
  const roleIds = (Array.isArray(body.roles) ? body.roles : []).slice(0, 20);
  const superAdmin = await isSuperAdmin(env, user);
  if (!superAdmin && roleIds.includes('role_super_admin')) forbid('无权授予超级管理员');
  // 校验角色确实存在于该作用域
  for (const rid of roleIds) if (!(await getRole(env, scope, rid))) bad(`身份组 ${rid} 不存在于作用域 ${scope}`);

  if (scope === 'global') {
    target.roles = { ...(target.roles || {}), global: roleIds };
    await saveUser(env, target);
  } else {
    const m = (await getMember(env, scope, target.id)) || {};
    await saveMember(env, scope, target.id, { ...m, roles: roleIds });
  }
  await pushNotification(env, target.id, {
    type: 'role', title: '你的身份组已更新', body: `作用域：${scope}`, actor: { id: user.id, name: user.displayName } });
  await writeAudit(env, user, 'role.assign', `${target.username} (${target.id})`, `scope=${scope} roles=${roleIds.join(',')}`);
  return ok({ userId: target.id, scope, roles: roleIds }, ctx);
});

/* --------------------------------------------------------------------------
 * 15.9 超级管理员「按作用域授权」
 *   可为 权限 / 权限组(角色) / 用户 单独指定某个作用域（global / board:* / channel:* / group:* / user:*）。
 *   权限清单见 PERMISSIONS；作用域链见 scopeChain()。
 * ------------------------------------------------------------------------ */
const SCOPE_TYPES = ['global', 'board', 'channel', 'group', 'user'];

router.get('/api/admin/perm-catalog', async (ctx) => {
  const { env, user } = ctx;
  if (!user) unauth();
  if (!(await isSuperAdmin(env, user))) forbid('仅超级管理员可查看权限目录');
  return ok({
    permissions: Object.entries(PERMISSIONS).map(([k, v]) => ({ key: k, ...v })),
    scopeTypes: SCOPE_TYPES,
    hint: 'scope 形如 global / board:<id> / channel:<id> / group:<id> / user:<id>',
  }, ctx);
});

router.post('/api/admin/perm-grant', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (!(await isSuperAdmin(env, user))) forbid('仅超级管理员可授权');
  const perm = String(body.perm || '');
  if (!PERMISSIONS[perm]) bad('未知权限：' + perm);
  const scope = scopeKeyOf(body.scope || 'global');
  const target = String(body.target || '');
  if (target !== 'user' && target !== 'role') bad('target 必须是 user 或 role');

  if (target === 'user') {
    const uidv = String(body.id || '');
    const tu = await getUser(env, uidv);
    if (!tu) notfound('用户不存在');
    tu.permGrants = Array.isArray(tu.permGrants) ? tu.permGrants : [];
    if (!tu.permGrants.some((g) => g.perm === perm && (g.scope || 'global') === scope)) {
      tu.permGrants.push({ perm, scope });
    }
    await saveUser(env, tu);
    await writeAudit(env, user, 'perm.grant.user', `${tu.username} (${tu.id})`, `${perm}@${scope}`);
    return ok({ userId: tu.id, permGrants: tu.permGrants }, ctx);
  }
  // role：把权限限制到指定作用域（permScopes）
  const role = await getRole(env, scopeKeyOf(body.roleScope || 'global'), String(body.id || ''));
  if (!role) notfound('身份组不存在');
  if (role.id === 'role_super_admin') forbid('超级管理员组不可被限定作用域');
  role.permScopes = role.permScopes || {};
  role.permScopes[perm] = [...new Set([...(role.permScopes[perm] || []), scope])];
  if (!role.perms.includes(perm)) role.perms.push(perm);
  await saveRole(env, role);
  await writeAudit(env, user, 'perm.grant.role', `${role.name} (${role.id})`, `${perm}@${scope}`);
  return ok({ roleId: role.id, permScopes: role.permScopes }, ctx);
});

router.post('/api/admin/perm-revoke', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (!(await isSuperAdmin(env, user))) forbid('仅超级管理员可撤销授权');
  const perm = String(body.perm || '');
  if (!PERMISSIONS[perm]) bad('未知权限：' + perm);
  const scope = scopeKeyOf(body.scope || 'global');
  const target = String(body.target || '');

  if (target === 'user') {
    const tu = await getUser(env, String(body.id || ''));
    if (!tu) notfound('用户不存在');
    tu.permGrants = (tu.permGrants || []).filter((g) => !(g.perm === perm && (g.scope || 'global') === scope));
    await saveUser(env, tu);
    await writeAudit(env, user, 'perm.revoke.user', `${tu.username} (${tu.id})`, `${perm}@${scope}`);
    return ok({ userId: tu.id, permGrants: tu.permGrants }, ctx);
  }
  const role = await getRole(env, scopeKeyOf(body.roleScope || 'global'), String(body.id || ''));
  if (!role) notfound('身份组不存在');
  if (role.permScopes && role.permScopes[perm]) {
    role.permScopes[perm] = role.permScopes[perm].filter((s) => s !== scope);
    if (!role.permScopes[perm].length) delete role.permScopes[perm];
    await saveRole(env, role);
  }
  await writeAudit(env, user, 'perm.revoke.role', `${role.name} (${role.id})`, `${perm}@${scope}`);
  return ok({ roleId: role.id, permScopes: role.permScopes || {} }, ctx);
});

/* ========================================================================== *
 * 16. 举报
 * ========================================================================== */

router.post('/api/reports', async (ctx) => {
  const { env, user, body, request } = ctx;
  if (!user) unauth();
  await guardRate(env, `report:${user.id}`, 10, 3600, '举报过于频繁');
  const id = sortableId();
  const rep = {
    id, reporterId: user.id,
    targetType: ['post','comment','user','message'].includes(body.targetType) ? body.targetType : 'post',
    targetId: String(body.targetId || '').slice(0, 100),
    scope: scopeKeyOf(body.scope || 'global'),
    reason: String(body.reason || 'other').slice(0, 40),
    detail: sanitizeContent(String(body.detail || '').slice(0, 1000)),
    status: 'open', handledBy: '', handledAt: 0, resolution: '',
    ip: clientIP(request), createdAt: nowMs(),
  };
  await KV.putJSON(env, `rep:${id}`, rep, { metadata: { s: 'open', t: rep.createdAt } });
  bumpStatLazy('reports');
  return ok({ report: { id, status: 'open' } }, ctx);
});

router.get('/api/reports', async (ctx) => {
  const { env, user, url } = ctx;
  if (!user) unauth();
  const scope = scopeKeyOf(url.searchParams.get('scope') || 'global');
  await requirePerm(env, user, 'report.handle', scope);
  const status = url.searchParams.get('status') || '';
  const { keys, cursor, list_complete } = await KV.list(env, 'rep:', clamp(url.searchParams.get('limit') || 50, 1, 200), url.searchParams.get('cursor'));
  const raw = await KV.many(env, keys.map((k) => k.name));
  const items = [];
  for (const r of raw) {
    if (status && r.status !== status) continue;
    if (scope !== 'global' && r.scope !== scope) continue;
    const reporter = await getUser(env, r.reporterId);
    items.push({ ...r, reporter: reporter ? { id: reporter.id, username: reporter.username, displayName: reporter.displayName } : null });
  }
  return ok({ items, cursor: list_complete ? null : cursor }, ctx);
});

router.post('/api/reports/:id/resolve', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const r = await KV.getJSON(env, `rep:${params.id}`);
  if (!r) notfound('举报不存在');
  await requirePerm(env, user, 'report.handle', r.scope || 'global');
  r.status = ['resolved','rejected','processing'].includes(body.status) ? body.status : 'resolved';
  r.handledBy = user.id; r.handledAt = nowMs();
  r.resolution = String(body.resolution || '').slice(0, 500);
  await KV.putJSON(env, `rep:${r.id}`, r);
  await pushNotification(env, r.reporterId, {
    type: 'report', title: '你的举报已被处理', body: `处理结果：${r.status}${r.resolution ? ' · ' + r.resolution : ''}` });
  return ok({ report: r }, ctx);
});

/* ========================================================================== *
 * 17. 超级管理员总后台
 * ========================================================================== */

async function requireAdmin(ctx, perm = 'site.config') {
  const { env, user } = ctx;
  if (!user) unauth();
  await requirePerm(env, user, perm, 'global');
}

router.get('/api/admin/overview', async (ctx) => {
  const { env } = ctx;
  await requireAdmin(ctx, 'site.logs');
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    days.push({ date: d, pv: parseInt((await env.DB.get(`stat:pv:${d}`)) || '0', 10) });
  }
  const openReports = (await KV.list(env, 'rep:', 200)).keys.length;
  const comm = await countCommunity(env);
  return ok({
    totals: {
      users: await readStat(env, 'users'),
      posts: await readStat(env, 'posts'),
      comments: await readStat(env, 'comments'),
      reports: await readStat(env, 'reports'),
      openReports,
      ...comm,
      ...presenceStats(),
    },
    pv7d: days,
    version: VERSION,
    runtime: { colo: ctx.request.cf?.colo || '', time: nowMs() },
  }, ctx);
});

router.get('/api/admin/config', async (ctx) => {
  await requireAdmin(ctx, 'site.config');
  return ok({ config: await getSiteConfig(ctx.env) }, ctx);
});

router.put('/api/admin/config', async (ctx) => {
  const { env, user, body } = ctx;
  await requireAdmin(ctx, 'site.config');
  const cur = await getSiteConfig(env);
  const allowed = ['siteTitle','siteSubtitle','favicon','logo','landingMode','loginBackground','loginBackgroundBlur',
    'themeDefault','accent','tips','allowExternalEmoji','registerOpen','requireEmailVerify','turnstileOnLogin','turnstileOnRegister',
    'turnstileOnPost','allowGithubLogin','allowDiscordLogin','footerText','footerAlign','navLinks','announcement','links',
    'personal','about','contributors','announcements','seo','oauth','contact','feedback'];
  const next = { ...cur };
  for (const k of allowed) if (body[k] !== undefined) next[k] = body[k];
  // 主题：合并保留未提交的字段
  if (body.theme && typeof body.theme === 'object') {
    const curT = (cur.theme && typeof cur.theme === 'object') ? cur.theme : {};
    next.theme = {
      primary: String(body.theme.primary || curT.primary || '#6d28d9').slice(0, 20),
      accent: String(body.theme.accent || curT.accent || '#6366f1').slice(0, 20),
      bg: String(body.theme.bg ?? curT.bg ?? '').slice(0, 20),
      text: String(body.theme.text ?? curT.text ?? '').slice(0, 20),
      radius: Number(body.theme.radius ?? curT.radius ?? 12) || 12,
      font: String(body.theme.font ?? curT.font ?? '').slice(0, 120),
    };
  }
  // 小贴士：数组清洗
  if (Array.isArray(body.tips)) {
    next.tips = body.tips.slice(0, 40).map((t) => (typeof t === 'string'
      ? { text: t.slice(0, 200), icon: '💡' }
      : { text: String(t.text || '').slice(0, 200), icon: String(t.icon || '💡').slice(0, 8) })).filter((t) => t.text);
  }
  // links 需合并而非整体替换，保留已解析的 telegram 头像/标题等字段
  if (body.links && typeof body.links === 'object') next.links = { ...cur.links, ...body.links };
  // turnstile 密钥与开关：合并而非整体替换；secret 留空时保留已存储值（避免重复保存时清空）
  if (body.turnstile && typeof body.turnstile === 'object') {
    const curTs = (cur.turnstile && typeof cur.turnstile === 'object') ? cur.turnstile : {};
    next.turnstile = {
      enabled: body.turnstile.enabled === true || body.turnstile.enabled === 'true',
      siteKey: String(body.turnstile.siteKey || '').trim(),
      secret: body.turnstile.secret ? String(body.turnstile.secret) : (curTs.secret || ''),
    };
  }
  // 邮件服务配置：合并而非整体替换；apiToken 留空时保留已存储值（反复保存不会清空密钥）
  if (body.mail && typeof body.mail === 'object') {
    const curMail = (cur.mail && typeof cur.mail === 'object') ? cur.mail : {};
    next.mail = {
      provider: String(body.mail.provider || curMail.provider || 'resend').toLowerCase().trim(),
      from: String(body.mail.from || curMail.from || 'MarytOpens <no-reply@example.com>').trim(),
      apiUrl: String(body.mail.apiUrl || curMail.apiUrl || '').trim(),
      apiToken: body.mail.apiToken ? String(body.mail.apiToken).trim() : (curMail.apiToken || ''),
    };
  }
  // OAuth 凭证：合并而非整体替换；clientSecret 留空时保留已存储值（反复保存不会清空密钥）
  if (body.oauth && typeof body.oauth === 'object') {
    const curO = (cur.oauth && typeof cur.oauth === 'object') ? cur.oauth : { github: {}, discord: {} };
    const src = (p) => (body.oauth[p] && typeof body.oauth[p] === 'object') ? body.oauth[p] : {};
    const curP = (p) => (curO[p] && typeof curO[p] === 'object') ? curO[p] : {};
    next.oauth = {
      github: {
        clientId: String(src('github').clientId || '').trim(),
        clientSecret: src('github').clientSecret ? String(src('github').clientSecret) : (curP('github').clientSecret || ''),
      },
      discord: {
        clientId: String(src('discord').clientId || '').trim(),
        clientSecret: src('discord').clientSecret ? String(src('discord').clientSecret) : (curP('discord').clientSecret || ''),
      },
    };
  }
  // 联系我们配置：合并而非整体替换；空 value 保留原值
  if (body.contact && typeof body.contact === 'object') {
    const curC = (cur.contact && typeof cur.contact === 'object') ? cur.contact : { enabled: false, type: 'email', value: '', note: '' };
    const t = String(body.contact.type || curC.type || 'email');
    next.contact = {
      enabled: body.contact.enabled === true || body.contact.enabled === 'true',
      type: ['email', 'url', 'qq'].includes(t) ? t : 'email',
      value: body.contact.value ? String(body.contact.value).trim() : (curC.value || ''),
      note: body.contact.note ? String(body.contact.note).slice(0, 200) : (curC.note || ''),
    };
  }
  // 意见反馈弹窗配置：合并而非整体替换；markdown 支持超管编写，email 用于提示用户发信
  if (body.feedback && typeof body.feedback === 'object') {
    const curF = (cur.feedback && typeof cur.feedback === 'object') ? cur.feedback : { markdown: '', email: '', officialUsername: '' };
    next.feedback = {
      markdown: body.feedback.markdown !== undefined ? String(body.feedback.markdown).slice(0, 4000) : (curF.markdown || ''),
      email: body.feedback.email ? String(body.feedback.email).trim().slice(0, 120) : (curF.email || ''),
      officialUsername: body.feedback.officialUsername ? String(body.feedback.officialUsername).trim().slice(0, 40) : (curF.officialUsername || ''),
    };
  }
  if (Array.isArray(next.navLinks)) {
    next.navLinks = next.navLinks.slice(0, 30).map((l) => ({
      id: l.id || uid('nav'),
      label: String(l.label || '').slice(0, 30),
      url: String(l.url || '').slice(0, 500),
      icon: String(l.icon || '🔗').slice(0, 8),
      position: ['header','sidebar','footer','landing','user-menu'].includes(l.position) ? l.position : 'header',
      target: l.target === '_self' ? '_self' : '_blank',
      visibleTo: ['all','guest','member','admin'].includes(l.visibleTo) ? l.visibleTo : 'all',
      order: Number(l.order) || 0,
    }));
  }
  // 若超管设置了 Telegram 链接，自动解析头像与标题
  if (next.links && body.links && typeof body.links.telegram === 'string') {
    const tg = body.links.telegram.trim();
    if (tg && tg !== (cur.links?.telegram || '')) {
      try {
        const r = await resolveTelegram(env, tg);
        if (r) { next.links.telegramAvatar = r.avatar || ''; next.links.telegramTitle = r.title || ''; }
      } catch { /* 解析失败不影响保存 */ }
    } else if (!tg) {
      next.links.telegramAvatar = ''; next.links.telegramTitle = '';
    }
  }
  await saveSiteConfig(env, next);
  await writeAudit(env, user, 'config.update', 'site', '更新站点配置');
  return ok({ config: next }, ctx);
});

router.post('/api/admin/users/batch-create', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (!await isSuperAdmin(env, user)) forbid('仅超级管理员可批量创建账号');

  const raw = Array.isArray(body.accounts) ? body.accounts : [];
  if (!raw.length) bad('请提供至少一个账号');
  if (raw.length > 200) bad('单次最多创建 200 个账号');

  // 角色：可选，限定为已知系统身份组（默认成员）
  const KNOWN = new Set(['role_super_admin','role_admin','role_board_owner','role_board_admin',
    'role_channel_owner','role_channel_admin','role_member','role_muted','role_representative']);
  let roleId = 'role_member';
  const rv = String(body.role || '').trim();
  if (rv) roleId = rv.startsWith('role_') ? rv : 'role_' + rv;
  if (!KNOWN.has(roleId)) roleId = 'role_member';

  const created = [], skipped = [], errors = [];
  for (const a of raw) {
    const username = String(a?.username || '').trim();
    const password = String(a?.password || '').trim();
    const email = String(a?.email || '').trim().toLowerCase();
    if (!username) { skipped.push({ username: '', reason: '用户名为空' }); continue; }
    if (!USERNAME_RE.test(username)) { skipped.push({ username, reason: '用户名格式不正确（2-20 位字母、数字、下划线、连字符或中文）' }); continue; }
    if (password.length < 6) { skipped.push({ username, reason: '密码至少 6 位' }); continue; }
    if (email && !EMAIL_RE.test(email)) { skipped.push({ username, reason: '邮箱格式不正确' }); continue; }
    if (await findUserByUsername(env, username)) { skipped.push({ username, reason: '用户名已被占用' }); continue; }
    if (email && await findUserByEmail(env, email)) { skipped.push({ username, reason: '邮箱已被占用' }); continue; }
    try {
      const id = uid('u');
      const u = newUserSkeleton({ id, username, email: email || '' });
      u.displayName = username.slice(0, 40);
      u.emailVerified = true;            // 管理员创建，免邮箱验证，创建即可用
      const clientHash = await sha256Hex(`${password}:${SUPER_ADMIN_PEPPER}`);
      u.password = await hashPassword(clientHash);
      const roles = ['role_member', roleId].filter((r, i, arr) => arr.indexOf(r) === i);
      u.roles = { global: roles };
      await saveUser(env, u);
      await env.DB.put(unameKey(username), id);
      if (email) await env.DB.put(await emailKey(email), id);
      await saveMember(env, 'global', id, { roles });
      bumpStatLazy('users');
      created.push({ username, email: email || null, role: roleId });
    } catch (e) {
      errors.push({ username, reason: '创建失败：' + (e?.message || '未知错误') });
    }
  }
  await writeAudit(env, user, 'user.batch_create', 'user', `批量创建账号 ${created.length} 个（跳过 ${skipped.length}）`);
  return ok({ created: created.length, skipped, errors, createdList: created }, ctx);
});

router.get('/api/admin/users', async (ctx) => {
  const { env, user, url } = ctx;
  await requireAdmin(ctx, 'user.ban');
  const q = (url.searchParams.get('q') || '').toLowerCase();
  const { keys, cursor, list_complete } = await KV.list(env, 'user:', clamp(url.searchParams.get('limit') || 50, 1, 200), url.searchParams.get('cursor'));
  // 去重键名 + 去重用户，防止极端情况下同一账号被重复列出
  const uniqKeys = [...new Set(keys.map((k) => k.name))];
  const raw = await KV.many(env, uniqKeys);
  user.__isSuper = await isSuperAdmin(env, user);
  const items = [];
  const seenIds = new Set();
  for (const u of raw) {
    if (!u || seenIds.has(u.id)) continue;
    seenIds.add(u.id);
    if (q && !`${u.username} ${u.displayName} ${u.email} ${u.id}`.toLowerCase().includes(q)) continue;
    items.push({ ...publicUser(u, user), roleTags: await roleTagsOf(env, u, 'global') });
  }
  return ok({ items, cursor: list_complete ? null : cursor }, ctx);
});

router.post('/api/admin/users/:id/action', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const scope = scopeKeyOf(body.scope || 'global');
  const target = await getUser(env, params.id);
  if (!target) notfound('用户不存在');
  if (target.protected) forbid('该账号受保护，不可被操作');
  if (await isSuperAdmin(env, target) && !(await isSuperAdmin(env, user))) forbid('无法操作超级管理员');
  const action = String(body.action || '');
  target.flags = target.flags || {};

  switch (action) {
    case 'ban': {
      await requirePerm(env, user, 'user.ban', scope);
      target.flags.banned = true;
      target.flags.bannedReason = String(body.reason || '').slice(0, 200);
      target.flags.bannedUntil = body.days ? nowMs() + Number(body.days) * 86400000 : 0;
      target.flags.bannedAt = nowMs();
      target.tokenVersion = (target.tokenVersion || 1) + 1;
      break;
    }
    case 'unban': {
      await requirePerm(env, user, 'user.ban', scope);
      target.flags.banned = false; target.flags.bannedReason = ''; target.flags.bannedUntil = 0;
      break;
    }
    case 'mute': {
      await requirePerm(env, user, 'user.mute', scope);
      const until = nowMs() + clamp(body.minutes || 60, 1, 60 * 24 * 365) * 60000;
      if (scope === 'global') target.flags.mutedUntil = until;
      else {
        const m = (await getMember(env, scope, target.id)) || {};
        await saveMember(env, scope, target.id, { ...m, mutedUntil: until });
      }
      await pushNotification(env, target.id, { type: 'moderation', title: '你已被禁言',
        body: `作用域 ${scope}，解除时间 ${new Date(until).toLocaleString()}${body.reason ? ' · ' + body.reason : ''}` });
      break;
    }
    case 'unmute': {
      await requirePerm(env, user, 'user.mute', scope);
      if (scope === 'global') target.flags.mutedUntil = 0;
      else {
        const m = (await getMember(env, scope, target.id)) || {};
        await saveMember(env, scope, target.id, { ...m, mutedUntil: 0 });
      }
      break;
    }
    case 'rename': {
      await requirePerm(env, user, 'user.rename', scope);
      const nn = String(body.displayName || '').trim().slice(0, 40);
      if (!nn) bad('昵称不能为空');
      if (scope === 'global') target.displayName = nn;
      else {
        const m = (await getMember(env, scope, target.id)) || {};
        await saveMember(env, scope, target.id, { ...m, nickname: nn });
      }
      await pushNotification(env, target.id, { type: 'moderation', title: '你的昵称已被管理员更改', body: nn });
      break;
    }
    case 'forceLogout': {
      await requirePerm(env, user, 'user.ban', scope);
      target.tokenVersion = (target.tokenVersion || 1) + 1;
      break;
    }
    case 'verifyEmail': {
      await requirePerm(env, user, 'site.admin');
      target.emailVerified = true;
      break;
    }
    case 'forceVerify': {
      await requirePerm(env, user, 'site.admin');
      if (!target.email) bad('该用户尚未绑定邮箱，无法要求验证');
      target.flags = { ...(target.flags || {}), forceVerify: true };
      await pushNotification(env, target.id, {
        type: 'verify_email',
        title: '请验证你的邮箱',
        body: '管理员要求你验证邮箱后方可继续使用。请前往「设置 → 邮箱」完成验证。',
        link: '/user_settings.html',
      });
      break;
    }
    default: bad('未知操作');
  }
  await saveUser(env, target);
  await writeAudit(env, user, 'user.' + action, `${target.username} (${target.id})`, `scope=${(body.scope || 'global')}`);
  return ok({ user: publicUser(target, { ...user, __isSuper: true }), action }, ctx);
});

/* ------------------------------- IP 治理 ---------------------------------- */

router.get('/api/admin/ip-bans', async (ctx) => {
  const { env } = ctx;
  await requireAdmin(ctx, 'ip.ban');
  const { keys } = await KV.list(env, 'ban:ip:', 300);
  const items = await KV.many(env, keys.map((k) => k.name));
  return ok({ items }, ctx);
});

router.post('/api/admin/ip-bans', async (ctx) => {
  const { env, user, body } = ctx;
  await requireAdmin(ctx, 'ip.ban');
  const ip = String(body.ip || '').trim();
  if (!ip) bad('IP 不能为空');
  const rec = {
    ip, reason: String(body.reason || '').slice(0, 200),
    until: body.days ? nowMs() + Number(body.days) * 86400000 : 0,
    by: user.id, byName: user.displayName, createdAt: nowMs(),
  };
  await KV.putJSON(env, `ban:ip:${ip}`, rec);
  await writeAudit(env, user, 'ip.ban', ip, `reason=${rec.reason}`);
  return ok({ ban: rec }, ctx);
});

router.delete('/api/admin/ip-bans/:ip', async (ctx) => {
  await requireAdmin(ctx, 'ip.ban');
  await KV.del(ctx.env, `ban:ip:${ctx.params.ip}`);
  await writeAudit(env, ctx.user, 'ip.unban', ctx.params.ip, '');
  return ok({ unbanned: ctx.params.ip }, ctx);
});

/* ------------------------------ 审核日志 ---------------------------------- */

router.get('/api/admin/audit', async (ctx) => {
  const { env, url } = ctx;
  // 仅超级管理员可查看审核日志
  const isSuper = ctx.user && await isSuperAdmin(env, ctx.user);
  if (!isSuper) forbid('仅超级管理员可查看审核日志');
  const limit = clamp(url.searchParams.get('limit') || 100, 1, 500);
  const { keys, cursor, list_complete } = await KV.list(env, 'audit:', limit, url.searchParams.get('cursor'));
  let items = keys.map((k) => k.metadata).filter(Boolean);
  if (!items.length) items = (await KV.many(env, keys.map((k) => k.name))).filter(Boolean);
  // metadata 可能为空，按键名倒序（新→旧）确保顺序
  items.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return ok({ items: items.slice(0, limit), cursor: list_complete ? null : cursor }, ctx);
});

/* ------------------------------ 联系我们（反馈发信） ----------------------- */

router.post('/api/contact/feedback', async (ctx) => {
  const { env, user, body } = ctx;
  const cfg = await getSiteConfig(env);
  const c = (cfg.contact && typeof cfg.contact === 'object') ? cfg.contact : {};
  if (!c.enabled || c.type !== 'email' || !c.value) bad('当前未启用邮箱反馈渠道', 'CONTACT_DISABLED');
  const fromEmail = String(body.email || (user && user.email) || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fromEmail)) bad('请填写有效的邮箱地址', 'BAD_EMAIL');
  const message = String(body.message || '').trim();
  if (message.length < 5) bad('反馈内容至少 5 个字符', 'BAD_MESSAGE');
  // 防刷：单 IP 60s 内最多 3 次
  await guardRate(env, `contact:${clientIP(ctx.request)}`, 3, 60, '反馈过于频繁，请稍后再试');
  const subject = `[联系我们] 来自 ${fromEmail} 的反馈`;
  const who = user ? `${user.displayName || user.username} (${user.username}, ${user.id})` : '未登录访客';
  const html = '<div style="font-family:system-ui,sans-serif;max-width:640px;margin:auto">'
    + `<h3>新的联系反馈</h3><p><b>提交者：</b>${escapeHtml(who)}</p>`
    + `<p><b>邮箱：</b>${escapeHtml(fromEmail)}</p>`
    + `<p><b>内容：</b></p><div style="white-space:pre-wrap;border-left:3px solid #6366f1;padding:8px 12px;background:#f6f7fb">${escapeHtml(message)}</div>`
    + '</div>';
  const r = await sendMail(env, { to: c.value, subject, html, text: message }, cfg);
  if (!r.ok) return fail(502, 'MAIL_FAILED', '反馈邮件发送失败：' + (r.error || r.body || r.provider), ctx);
  return ok({ sent: true }, ctx);
});

/* ------------------------------ 访问日志 ---------------------------------- */

router.get('/api/admin/logs', async (ctx) => {
  const { env, url } = ctx;
  await requireAdmin(ctx, 'site.logs');
  // 一个 key 现在可能是「一批」日志（数组），因此按 key 数量分页，再展开成记录
  const limit = clamp(url.searchParams.get('limit') || 40, 1, 200);
  const ipFilter = url.searchParams.get('ip') || '';
  const pathFilter = url.searchParams.get('path') || '';
  const { keys, cursor, list_complete } = await KV.list(env, 'log:', limit, url.searchParams.get('cursor'));
  const vals = await KV.many(env, keys.map((k) => k.name));
  let items = [];
  for (const v of vals) {
    if (Array.isArray(v)) items.push(...v);
    else if (v && typeof v === 'object') items.push(v);   // 兼容旧的单条格式
  }
  items.sort((a, b) => (b.t || 0) - (a.t || 0));
  if (ipFilter) items = items.filter((i) => String(i.ip || '').includes(ipFilter));
  if (pathFilter) items = items.filter((i) => String(i.path || '').includes(pathFilter));
  return ok({ items, cursor: list_complete ? null : cursor }, ctx);
});

/* --------------------------- Cloudflare API 面板 --------------------------- */

router.get('/api/admin/cloudflare/status', async (ctx) => {
  const { env } = ctx;
  await requireAdmin(ctx, 'site.cloudflare');
  const zone = env.CF_ZONE_ID ? await cfApi(env, `/zones/${env.CF_ZONE_ID}`) : null;
  return ok({
    configured: !!env.CF_API_TOKEN,
    accountId: env.CF_ACCOUNT_ID || '',
    zone: zone?.result ? pick(zone.result, ['id','name','status','plan','name_servers','development_mode']) : null,
  }, ctx);
});

router.post('/api/admin/cloudflare/purge', async (ctx) => {
  const { env, body } = ctx;
  await requireAdmin(ctx, 'site.cloudflare');
  const payload = body.files?.length ? { files: body.files.slice(0, 30) } : { purge_everything: true };
  const r = await cfApi(env, `/zones/${env.CF_ZONE_ID}/purge_cache`, { method: 'POST', body: JSON.stringify(payload) });
  return ok({ result: r }, ctx);
});

router.get('/api/admin/cloudflare/analytics', async (ctx) => {
  const { env } = ctx;
  await requireAdmin(ctx, 'site.cloudflare');
  const r = await cfApi(env, `/zones/${env.CF_ZONE_ID}/analytics/dashboard?since=-1440&until=0`);
  return ok({ analytics: r?.result?.totals || null }, ctx);
});

router.post('/api/admin/cloudflare/dns', async (ctx) => {
  const { env, body } = ctx;
  await requireAdmin(ctx, 'site.cloudflare');
  if (body.action === 'list') {
    const r = await cfApi(env, `/zones/${env.CF_ZONE_ID}/dns_records?per_page=100`);
    return ok({ records: (r?.result || []).map((x) => pick(x, ['id','type','name','content','proxied','ttl'])) }, ctx);
  }
  if (body.action === 'create') {
    const r = await cfApi(env, `/zones/${env.CF_ZONE_ID}/dns_records`, {
      method: 'POST',
      body: JSON.stringify(pick(body, ['type','name','content','proxied','ttl'])),
    });
    return ok({ result: r }, ctx);
  }
  bad('未知 DNS 操作');
});

/* -------------------------------- 邮件管理 -------------------------------- */

router.post('/api/admin/mail/send', async (ctx) => {
  const { env, body } = ctx;
  await requireAdmin(ctx, 'site.mail');
  const cfg = await getSiteConfig(env);
  const to = String(body.to || '').trim();
  if (!EMAIL_RE.test(to)) bad('收件邮箱格式不正确');
  const res = await sendMail(env, {
    to, subject: String(body.subject || `来自 ${cfg.siteTitle} 的邮件`).slice(0, 200),
    html: body.raw ? String(body.html || '')
                   : mailTemplate(cfg, { title: String(body.subject || '站点通知'), body: sanitizeContent(body.html || body.text || '') }),
  });
  return ok({ result: res }, ctx);
});

router.post('/api/admin/mail/broadcast', async (ctx) => {
  const { env, body } = ctx;
  await requireAdmin(ctx, 'site.mail');
  const cfg = await getSiteConfig(env);
  const { keys } = await KV.list(env, 'user:', 500);
  const users = await KV.many(env, keys.map((k) => k.name));
  let sent = 0, skipped = 0;
  for (const u of users) {
    if (!u.email || !u.emailVerified || u.notifySettings?.mail === false || u.flags?.banned) { skipped++; continue; }
    const r = await sendMail(env, {
      to: u.email, subject: String(body.subject || cfg.siteTitle).slice(0, 200),
      html: mailTemplate(cfg, { title: String(body.subject || '站点公告'), body: sanitizeContent(body.html || '') }),
    });
    if (r.ok) sent++; else skipped++;
    if (body.alsoNotify !== false) {
      await pushNotification(env, u.id, { type: 'system', title: String(body.subject || '站点公告'), body: String(body.text || '').slice(0, 200) });
    }
  }
  return ok({ sent, skipped, total: users.length }, ctx);
});

/* ========================================================================== *
 * 18. 机器人接入
 * ========================================================================== */

router.get('/api/admin/bots', async (ctx) => {
  const { env } = ctx;
  await requireAdmin(ctx, 'site.bot');
  const { keys } = await KV.list(env, 'bot:', 100);
  const items = (await KV.many(env, keys.map((k) => k.name))).map((b) => ({ ...b, token: undefined, tokenHint: `${b.tokenHint || ''}` }));
  return ok({ items }, ctx);
});

router.post('/api/admin/bots', async (ctx) => {
  const { env, user, body } = ctx;
  await requireAdmin(ctx, 'site.bot');
  const id = uid('bot');
  const token = `mo_bot_${uid()}${uid().slice(0, 8)}`;
  const bot = {
    id, name: String(body.name || '未命名机器人').slice(0, 40),
    description: String(body.description || '').slice(0, 200),
    scopes: (Array.isArray(body.scopes) ? body.scopes : ['post.create']).filter((p) => ALL_PERMS.includes(p)),
    boundScope: scopeKeyOf(body.boundScope || 'global'),
    ownerId: user.id, tokenHash: await sha256Hex(token), tokenHint: token.slice(0, 14) + '…',
    enabled: true, calls: 0, createdAt: nowMs(),
  };
  await KV.putJSON(env, `bot:${id}`, bot);
  await env.DB.put(`botix:${await sha256Hex(token)}`, id);
  return ok({ bot: { ...bot, tokenHash: undefined }, token }, ctx);   // token 只返回一次
});

router.delete('/api/admin/bots/:id', async (ctx) => {
  const { env, params } = ctx;
  await requireAdmin(ctx, 'site.bot');
  const bot = await KV.getJSON(env, `bot:${params.id}`);
  if (bot?.tokenHash) await KV.del(env, `botix:${bot.tokenHash}`);
  await KV.del(env, `bot:${params.id}`);
  return ok({ deleted: params.id }, ctx);
});

async function authenticateBot(request, env) {
  const token = request.headers.get('X-Bot-Token') || '';
  if (!token) return null;
  if (env.BOT_MASTER_TOKEN && timingSafeEqual(token, env.BOT_MASTER_TOKEN)) {
    return { id: 'bot_master', name: 'Master Bot', scopes: ALL_PERMS, boundScope: 'global', master: true };
  }
  const id = await env.DB.get(`botix:${await sha256Hex(token)}`);
  if (!id) return null;
  const bot = await KV.getJSON(env, `bot:${id}`);
  if (!bot?.enabled) return null;
  bot.calls = (bot.calls || 0) + 1;
  await KV.putJSON(env, `bot:${id}`, bot);
  return bot;
}

router.get('/api/bot/whoami', async (ctx) => {
  if (!ctx.bot) unauth('无效的机器人令牌');
  return ok({ bot: pick(ctx.bot, ['id','name','scopes','boundScope','calls']) }, ctx);
});

router.post('/api/bot/posts', async (ctx) => {
  const { env, bot, body } = ctx;
  if (!bot) unauth('无效的机器人令牌');
  if (!bot.master && !bot.scopes.includes('post.create')) forbid('机器人缺少 post.create 权限');
  const authorId = body.authorId || bot.ownerId;
  const author = await getUser(env, authorId);
  if (!author) bad('指定的作者不存在');
  const id = uid('p');
  const sid = sortableId();
  const scope = scopeKeyOf(body.scope || bot.boundScope || 'global');
  const post = {
    id, sid, slug: slugify(body.title || 'bot-post'),
    title: String(body.title || '').slice(0, 200), content: sanitizeContent(body.content || ''),
    format: 'markdown', excerpt: String(body.content || '').slice(0, 200), cover: '',
    tags: (body.tags || []).slice(0, 8), board: String(body.board || 'general'),
    scope, visibility: 'public', visibleRoles: [],
    authorId, botId: bot.id, status: 'published',
    pinned: false, featured: false, locked: false,
    counts: { views: 0, likes: 0, comments: 0, favorites: 0 },
    createdAt: nowMs(), updatedAt: nowMs(),
  };
  await KV.putJSON(env, `post:${id}`, post);
  await env.DB.put(`ixp:all:${sid}`, id);
  await env.DB.put(`ixp:user:${authorId}:${sid}`, id);
  await env.DB.put(`ixp:board:${post.board}:${sid}`, id);
  await env.DB.put(`ixp:scope:${scope}:${sid}`, id);
  return ok({ post: { id, title: post.title, url: `${env.FRONTEND_ORIGIN}/post.html?id=${id}` } }, ctx);
});

router.post('/api/bot/notify', async (ctx) => {
  const { env, bot, body } = ctx;
  if (!bot) unauth('无效的机器人令牌');
  await pushNotification(env, String(body.userId), {
    type: 'bot', title: String(body.title || '机器人通知').slice(0, 100),
    body: String(body.body || '').slice(0, 400), link: String(body.link || ''),
    actor: { id: bot.id, name: bot.name },
  });
  return ok({ notified: body.userId }, ctx);
});

router.post('/api/bot/moderate', async (ctx) => {
  const { env, bot, body } = ctx;
  if (!bot) unauth('无效的机器人令牌');
  if (!bot.master && !bot.scopes.includes('post.delete.any')) forbid('机器人缺少审核权限');
  const p = await KV.getJSON(env, `post:${body.postId}`);
  if (!p) notfound('文章不存在');
  if (body.action === 'delete') { p.status = 'deleted'; p.deletedBy = bot.id; }
  if (body.action === 'lock') p.locked = true;
  if (body.action === 'pin') p.pinned = true;
  p.moderation = { by: bot.id, reason: String(body.reason || '').slice(0, 200), at: nowMs() };
  await KV.putJSON(env, `post:${p.id}`, p);
  return ok({ moderated: p.id, action: body.action }, ctx);
});

router.get('/api/bot/feed', async (ctx) => {
  const { env, bot, url } = ctx;
  if (!bot) unauth('无效的机器人令牌');
  const since = parseInt(url.searchParams.get('since') || '0', 10);
  const { keys } = await KV.list(env, 'ixp:all:', clamp(url.searchParams.get('limit') || 20, 1, 100));
  const ids = await indexPostIds(env, keys);
  const posts = (await KV.many(env, ids.map((i) => `post:${i}`)))
    .filter((p) => p && p.status !== 'deleted' && p.visibility === 'public' && p.createdAt > since)
    .map((p) => ({ id: p.id, title: p.title, excerpt: p.excerpt, authorId: p.authorId, board: p.board,
                   createdAt: p.createdAt, url: `${env.FRONTEND_ORIGIN}/post.html?id=${p.id}` }));
  return ok({ items: posts, serverTime: nowMs() }, ctx);
});

/* ========================================================================== *
 * 19. R2 头像 / 图片上传
 * ========================================================================== */

const ALLOWED_IMAGE = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
const MAX_AVATAR = 2 * 1024 * 1024;
const MAX_IMAGE = 8 * 1024 * 1024;

async function handleUpload(ctx, kind) {
  const { env, user, request } = ctx;
  if (!user) unauth();
  await guardRate(env, `up:${user.id}`, 20, 600, '上传过于频繁');
  const ct = request.headers.get('Content-Type') || '';
  let file, mime;
  if (ct.includes('multipart/form-data')) {
    const form = await request.formData();
    file = form.get('file');
    if (!file || typeof file === 'string') bad('缺少文件');
    mime = file.type;
  } else {
    mime = ct.split(';')[0];
    file = await request.blob();
  }
  const ext = ALLOWED_IMAGE[mime];
  if (!ext) bad(`不支持的文件类型：${mime}。仅支持 PNG / JPEG / WebP / GIF / SVG`);
  const buf = await file.arrayBuffer();
  const limit = kind === 'avatar' ? MAX_AVATAR : MAX_IMAGE;
  if (buf.byteLength > limit) bad(`文件过大，上限 ${(limit / 1024 / 1024).toFixed(0)} MB`);

  const key = `${kind}/${user.id}/${uid()}.${ext}`;
  let url;
  if (env.MEDIA) {
    // 已绑定 R2 时优先用 R2
    await env.MEDIA.put(key, buf, {
      httpMetadata: { contentType: mime, cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: { uid: user.id, kind, t: String(nowMs()) },
    });
    url = `${env.MEDIA_PUBLIC_BASE || `${env.API_ORIGIN}/files`}/${key}`;
  } else {
    // 未绑定 R2（如仅使用 KV 的账号）时回退到 KV 存储；KV 单值上限 25MB，满足头像/图片需求
    await env.DB.put('file:' + key, buf, {
      metadata: { ct: mime, uid: user.id, kind, t: String(nowMs()) },
      expirationTtl: 86400 * 365,
    });
    url = `${env.API_ORIGIN}/files/${key}`;
  }
  if (kind === 'avatar') { user.avatar = url; await saveUser(env, user); }
  if (kind === 'banner') { user.banner = url; await saveUser(env, user); }
  return ok({ url, key, size: buf.byteLength, mime, storage: env.MEDIA ? 'r2' : 'kv' }, ctx);
}

router.post('/api/upload/avatar', (ctx) => handleUpload(ctx, 'avatar'));
router.post('/api/upload/banner', (ctx) => handleUpload(ctx, 'banner'));
router.post('/api/upload/image',  (ctx) => handleUpload(ctx, 'image'));

// 文件下载入口页：支持粘贴 /f/ 分享链接，或填写 owner+id 跳转下载
router.get('/files/download', async (ctx) => {
  const sp = new URL(ctx.request.url).searchParams;
  const link = sp.get('link');
  if (link) {
    try {
      const u = new URL(link);
      if (u.pathname.startsWith('/f/')) return Response.redirect(link, 302);
    } catch (e) { /* 无效链接，落到页面 */ }
  }
  const page = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>文件下载 · MarytOpens</title>
<style>
  :root{--bg:#0c0f16;--card:#131826;--text:#e6e9f2;--muted:#9aa3b8;--accent:#6366f1;--border:#222a3d}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;padding:20px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:28px;max-width:440px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.4)}
  h1{margin:0 0 6px;font-size:20px}
  p.sub{margin:0 0 20px;color:var(--muted);font-size:13px;line-height:1.6}
  label{display:block;font-size:13px;margin:12px 0 6px;color:var(--muted)}
  input{width:100%;padding:10px 12px;border-radius:9px;border:1px solid var(--border);background:#0e1320;color:var(--text);font-size:14px}
  input:focus{outline:none;border-color:var(--accent)}
  .row{display:flex;gap:10px}
  .row>*{flex:1}
  button{margin-top:18px;width:100%;padding:11px;border:none;border-radius:9px;background:var(--accent);color:#fff;font-size:15px;cursor:pointer}
  button:hover{filter:brightness(1.08)}
  .err{color:#ff6b6b;font-size:12px;margin-top:10px;min-height:14px}
</style>
</head>
<body>
  <div class="card">
    <h1>文件下载</h1>
    <p class="sub">输入分享链接，或填写「拥有者 / 文件 ID」即可前往下载。需要提取码时在对应框填写。</p>
    <label>分享链接（可整段粘贴）</label>
    <input id="link" placeholder="https://example.com/f/owner/fileId">
    <label>拥有者（owner）</label>
    <input id="owner" placeholder="例如 u_abc123">
    <div class="row">
      <div><label>文件 ID</label><input id="id" placeholder="例如 f_xyz"></div>
      <div><label>提取码</label><input id="code" placeholder="可选"></div>
    </div>
    <button id="go">前往下载</button>
    <div class="err" id="err"></div>
  </div>
  <script>
    var q = new URLSearchParams(location.search);
    var lp = q.get('link'); if (lp) document.getElementById('link').value = lp;
    function go(){
      var err = document.getElementById('err'); err.textContent='';
      var link = document.getElementById('link').value.trim();
      if(link){
        try{ var u = new URL(link); if(u.pathname.indexOf('/f/')===0){ location.href = link; return; } }catch(e){}
        err.textContent='链接格式不正确（应以 /f/ 开头）'; return;
      }
      var owner=document.getElementById('owner').value.trim();
      var id=document.getElementById('id').value.trim();
      if(!owner||!id){ err.textContent='请填写链接，或同时填写拥有者与文件 ID'; return; }
      var code=document.getElementById('code').value.trim();
      location.href='/f/'+encodeURIComponent(owner)+'/'+encodeURIComponent(id)+(code?'?code='+encodeURIComponent(code):'');
    }
    document.getElementById('go').onclick=go;
    document.getElementById('link').addEventListener('keydown',function(e){ if(e.key==='Enter') go(); });
  </script>
</body>
</html>`;
  return new Response(page, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
});

router.get('/files/*', async (ctx) => {
  const { env, request } = ctx;
  const key = new URL(request.url).pathname.replace(/^\/files\//, '');
  let body, ct, etag;
  if (env.MEDIA) {
    const obj = await env.MEDIA.get(key);
    if (!obj) notfound('文件不存在');
    body = obj.body; ct = obj.httpMetadata?.contentType; etag = obj.httpEtag;
  } else {
    const obj = await env.DB.getWithMetadata('file:' + key, { type: 'arrayBuffer' });
    if (!obj || !obj.value) notfound('文件不存在');
    body = obj.value; ct = (obj.metadata && obj.metadata.ct) || 'application/octet-stream';
  }
  const h = new Headers();
  if (etag) h.set('etag', etag);
  h.set('Content-Type', ct || 'application/octet-stream');
  h.set('Cache-Control', 'public, max-age=31536000, immutable');
  h.set('X-Content-Type-Options', 'nosniff');
  return new Response(body, { headers: h });
});

/* ========================================================================== *
 * 20. 引导：首次运行创建超级管理员与全局身份组
 * ========================================================================== */

let BOOTSTRAPPED = false;

async function bootstrap(env) {
  if (BOOTSTRAPPED) return;
  // 新功能表（oauth_*/submissions/tickets）幂等建表；每冷启动跑一次，D1 表本身持久化
  try { await ensureFeatureSchema(env); } catch (e) { console.error('[bootstrap] schema 初始化失败：', e?.message || e); }
  const flagRaw = await env.DB.get('sys:bootstrap');
  let flag = null;
  try { flag = flagRaw ? JSON.parse(flagRaw) : null; } catch (_) { flag = null; }
  // 已按当前版本初始化过 → 直接跳过。冷启动（新 isolate）时不再重复跑
  // seedRoles / 账号补种，省下十几次 KV 读和潜在的写，配额友好。
  // 每次部署 VERSION 变化会自动重跑一次，保证模板升级仍会生效。
  if (flag && flag.version === VERSION) { BOOTSTRAPPED = true; return; }
  await seedRoles(env, 'global', Object.keys(ROLE_TEMPLATES));
  // 清理已从模板中移除的系统身份组（如层级调整前的 group_owner / board_moderator 等）
  for (const r of await listRoles(env, 'global')) {
    if (r.system && r.key && !ROLE_TEMPLATES[r.key]) await KV.del(env, `role:global:${r.id}`);
  }

  const email = String(env.SUPER_ADMIN_EMAIL || '').toLowerCase().trim();
  const username = String(env.SUPER_ADMIN_USERNAME || 'root').trim();
  const pwd = env.SUPER_ADMIN_PASSWORD;

  if (email && pwd) {
    let admin = await findUserByEmail(env, email);
    if (!admin) admin = await findUserByUsername(env, username);
    // 环境变量里的密码是明文 → 服务端自行做一次「客户端预哈希」再 PBKDF2，保持算法一致
    // 注意：这里用的 PEPPER 必须与前端 pages/assets/js/api.js 里的 PWD_SALT 完全一致，
    // 否则 bootstrap 创建的账号会因盐不匹配而永远登录失败。
    const clientHash = await sha256Hex(`${pwd}:${SUPER_ADMIN_PEPPER}`);
    if (!admin) {
      const id = uid('u');
      admin = newUserSkeleton({ id, username, email });
      admin.displayName = username;
      admin.emailVerified = true;
      admin.password = await hashPassword(clientHash);
      admin.roles = { global: ['role_super_admin', 'role_admin', 'role_member'] };
      await saveUser(env, admin);
      await env.DB.put(unameKey(username), id);
      await env.DB.put(await emailKey(email), id);
      await saveMember(env, 'global', id, { roles: ['role_super_admin'] });
      bumpStatLazy('users');
      console.log('[bootstrap] super admin created:', username, email);
    } else {
      // 保证环境变量指定的账号始终拥有超管身份（防止误操作丢权限）
      const roles = new Set(admin.roles?.global || []);
      if (!roles.has('role_super_admin')) {
        roles.add('role_super_admin');
        admin.roles = { ...(admin.roles || {}), global: [...roles] };
        await saveUser(env, admin);
      }
    }
  }

  // —— 官方入驻账号（MarytOpens 官方）——
  // 由环境变量提供账号 + 密码（明文）；无需邮件验证；不可删除/封禁/禁言；仅超级管理员可管理。
  const oEmail = String(env.OFFICIAL_ACCOUNT_EMAIL || '').toLowerCase().trim();
  const oUser = String(env.OFFICIAL_ACCOUNT_USERNAME || 'marytopens').trim();
  const oPwd = env.OFFICIAL_ACCOUNT_PASSWORD;
  if (oEmail && oPwd) {   // 首次部署由环境变量播种；之后可在后台「官方账号」面板里改

    let official = await findUserByEmail(env, oEmail);
    if (!official) official = await findUserByUsername(env, oUser);
    // 与超管一致：环境变量明文密码先做客户端预哈希再 PBKDF2（PEPPER 必须 = SUPER_ADMIN_PEPPER）
    const oClientHash = await sha256Hex(`${oPwd}:${SUPER_ADMIN_PEPPER}`);
    if (!official) {
      const oid = uid('u');
      official = newUserSkeleton({ id: oid, username: oUser, email: oEmail });
      official.displayName = 'MarytOpens 官方';
      official.emailVerified = true;
      official.official = true;
      official.protected = true;            // 不可删除 / 封禁 / 禁言
      official.password = await hashPassword(oClientHash);
      official.roles = { global: ['role_member'] };
      official.badges = [{ id: 'official', name: '官方认证', color: '#2563eb', icon: '✓', official: true }];
      await saveUser(env, official);
      await env.DB.put(unameKey(oUser), oid);
      await env.DB.put(await emailKey(oEmail), oid);
      await saveMember(env, 'global', oid, { roles: ['role_member'] });
      await env.DB.put('sys:official_uid', oid);
      bumpStatLazy('users');
      console.log('[bootstrap] official account created:', oUser, oEmail);
    } else if (!official.official || !official.protected) {
      // 只有确实缺失标识时才写：否则每次冷启动都白白消耗一次 KV 写配额
      official.official = true;
      official.protected = true;
      await saveUser(env, official);
      await env.DB.put('sys:official_uid', official.id);
    }
  }

  if (!flag) await env.DB.put('sys:bootstrap', JSON.stringify({ at: nowMs(), version: VERSION }));
  BOOTSTRAPPED = true;
}

/* ========================================================================== *
 * 20.5 官方公告 + 用户本地网关工具（Task #79 / #76）
 * ========================================================================== */

// 注意：必须是同步函数。之前写成 async 时，`!isOfficialAccount(u)` 恒为 false
// （Promise 永远是真值），导致官方密钥等接口的权限判断整体失效；
// 同时 `official: isOfficialAccount(user)` 也会被序列化成 {}。
function isOfficialAccount(u) { return !!(u && u.official); }
async function canPublishAnnouncement(env, u) {
  if (!u) return false;
  if (await isSuperAdmin(env, u)) return true;
  return isOfficialAccount(u);
}

/* ---------------- 官方公告 ---------------- */
router.get('/api/announcements', async (ctx) => {
  const { env, url } = ctx;
  const limit = clamp(parseInt(url.searchParams.get('limit') || '20', 10), 1, 100);
  const { keys } = await KV.list(env, 'ann:', 200);
  const annItems = (await KV.many(env, keys.map((k) => k.name))).filter(Boolean)
    .map((a) => ({ kind: 'announcement', id: a.id, title: a.title, body: a.body, pinned: !!a.pinned, official: !!a.official, createdAt: a.createdAt, authorId: a.authorId, authorName: a.authorName }));
  // 合并被标记为「官方公告」的文章 / 帖子
  const { keys: pkeys } = await KV.list(env, 'ixp:all:', 400);
  const pids = await indexPostIds(env, pkeys);
  const posts = (await KV.many(env, pids.map((i) => `post:${i}`))).filter(Boolean)
    .filter((p) => p && p.isAnnouncement && p.status !== 'deleted')
    .map((p) => ({ kind: 'post', id: p.id, title: p.title, body: p.excerpt || String(p.content || '').slice(0, 400), pinned: !!p.pinned, official: true, createdAt: p.createdAt, authorId: p.authorId, authorName: (p.authorDisplayName || '') }));
  // 补齐文章作者名
  for (const it of posts) {
    if (!it.authorName && it.authorId) { const u = await getUser(env, it.authorId); it.authorName = u ? (u.displayName || u.username) : ''; }
  }
  let items = annItems.concat(posts);
  items.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.createdAt || 0) - (a.createdAt || 0));
  items = items.slice(0, limit);
  return ok({ items, cursor: null }, ctx);
});

router.post('/api/admin/announcements', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (!await canPublishAnnouncement(env, user)) forbid('仅超级管理员或官方账号可发布公告');
  const title = String(body.title || '').trim();
  const text = String(body.body || body.text || '').trim();
  if (!title || !text) bad('标题与正文均不能为空');
  const id = 'ann_' + sortableId();
  const ann = {
    id, title, body: text,
    pinned: !!body.pinned,
    createdAt: nowMs(),
    authorId: user.id,
    authorName: user.displayName || user.username,
    official: isOfficialAccount(user),
  };
  await KV.putJSON(env, `ann:${id}`, ann);
  await writeAudit(env, user, 'announce.create', title);
  return ok({ announcement: ann }, ctx);
});

router.delete('/api/admin/announcements/:id', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  if (!await canPublishAnnouncement(env, user)) forbid('仅超级管理员或官方账号可管理公告');
  const key = `ann:${params.id}`;
  const ann = await KV.getJSON(env, key);
  if (!ann) notfound('公告不存在');
  await KV.del(env, key);
  await writeAudit(env, user, 'announce.delete', params.id);
  return ok({ ok: true }, ctx);
});

/* ------------------------- 官方委员（委员 / 委员长） ------------------------- */
// 适用于 版块(board) / 频道(channel) / 群组(group)。仅官方账号或超级管理员可管理。
// committee: [{ userId, merit(业绩/功勋,数值), honor(荣誉,文本), role:'member'|'chairman', addedAt }]
function committeeList(target) {
  const list = (target.committee || []).slice();
  list.sort((a, b) => (b.role === 'chairman' ? 1 : 0) - (a.role === 'chairman' ? 1 : 0) || (b.merit || 0) - (a.merit || 0));
  return list;
}
async function committeeEnforce(env, user) {
  if (!await canPublishAnnouncement(env, user)) forbid('仅超级管理员或官方账号可管理官方委员');
}
function registerCommitteeRoutes(spec) {
  const base = spec.base;
  router.get(base + '/committee', async (ctx) => {
    const t = await spec.getCtx(ctx); if (!t.rec) notfound(t.err);
    return ok({ items: committeeList(t.rec) }, ctx);
  });
  router.post(base + '/committee', async (ctx) => {
    const { env, user, body } = ctx;
    const t = await spec.getCtx(ctx); if (!t.rec) notfound(t.err);
    await committeeEnforce(env, user);
    const uid2 = String(body.userId || body.uid || '').trim();
    if (!uid2) bad('请指定用户');
    const u = await getUser(env, uid2); if (!u) notfound('用户不存在');
    t.rec.committee = t.rec.committee || [];
    let entry = t.rec.committee.find((c) => c.userId === uid2);
    if (!entry) { entry = { userId: uid2, addedAt: nowMs() }; t.rec.committee.push(entry); }
    if (body.merit != null) entry.merit = Number(body.merit) || 0;
    if (body.honor !== undefined) entry.honor = String(body.honor).slice(0, 200);
    const role = body.role === 'chairman' ? 'chairman' : 'member';
    if (role === 'chairman') for (const c of t.rec.committee) if (c.userId !== uid2) c.role = 'member';
    entry.role = role;
    await t.save(env, t.rec);
    return ok({ entry, items: committeeList(t.rec) }, ctx);
  });
  router.put(base + '/committee/:uid', async (ctx) => {
    const { env, user, params, body } = ctx;
    const t = await spec.getCtx(ctx); if (!t.rec) notfound(t.err);
    await committeeEnforce(env, user);
    const entry = (t.rec.committee || []).find((c) => c.userId === params.uid);
    if (!entry) notfound('委员不存在');
    if (body.merit != null) entry.merit = Number(body.merit) || 0;
    if (body.honor !== undefined) entry.honor = String(body.honor).slice(0, 200);
    if (body.role === 'chairman') { for (const c of t.rec.committee) if (c.userId !== params.uid) c.role = 'member'; entry.role = 'chairman'; }
    else if (body.role) entry.role = 'member';
    await t.save(env, t.rec);
    return ok({ entry, items: committeeList(t.rec) }, ctx);
  });
  router.delete(base + '/committee/:uid', async (ctx) => {
    const { env, user, params } = ctx;
    const t = await spec.getCtx(ctx); if (!t.rec) notfound(t.err);
    await committeeEnforce(env, user);
    t.rec.committee = (t.rec.committee || []).filter((c) => c.userId !== params.uid);
    await t.save(env, t.rec);
    return ok({ ok: true, items: committeeList(t.rec) }, ctx);
  });
  router.post(base + '/committee/:uid/chairman', async (ctx) => {
    const { env, user, params } = ctx;
    const t = await spec.getCtx(ctx); if (!t.rec) notfound(t.err);
    await committeeEnforce(env, user);
    const entry = (t.rec.committee || []).find((c) => c.userId === params.uid);
    if (!entry) notfound('委员不存在');
    for (const c of t.rec.committee) c.role = (c.userId === params.uid) ? 'chairman' : 'member';
    await t.save(env, t.rec);
    return ok({ entry, items: committeeList(t.rec) }, ctx);
  });
}
registerCommitteeRoutes({
  base: '/api/boards/:id',
  getCtx: async (ctx) => {
    const rec = await KV.getJSON(ctx.env, `bd:${ctx.params.id}`);
    return { rec, save: (e, r) => KV.putJSON(e, `bd:${ctx.params.id}`, r), err: '版块不存在' };
  },
});
registerCommitteeRoutes({
  base: '/api/boards/:bid/channels/:cid',
  getCtx: async (ctx) => {
    const rec = await KV.getJSON(ctx.env, `ch:${ctx.params.bid}:${ctx.params.cid}`);
    return { rec, save: (e, r) => KV.putJSON(e, `ch:${ctx.params.bid}:${ctx.params.cid}`, r), err: '频道不存在' };
  },
});
registerCommitteeRoutes({
  base: '/api/groups/:id',
  getCtx: async (ctx) => {
    const rec = await KV.getJSON(ctx.env, groupKey(ctx.params.id));
    return { rec, save: (e, r) => KV.putJSON(e, groupKey(ctx.params.id), r), err: '群组不存在' };
  },
});

/* 官方栏：汇总所有被标记为「官方」的版块 / 频道 / 群组 */
router.get('/api/official', async (ctx) => {
  const { env } = ctx;
  const { keys: bk } = await KV.list(env, 'bd:', 300);
  const boards = (await KV.many(env, bk.map((k) => k.name))).filter((b) => b && b.official);
  const { keys: ck } = await KV.list(env, 'ch:', 1000);
  const channels = (await KV.many(env, ck.map((k) => k.name))).filter((c) => c && c.official);
  const { keys: gk } = await KV.list(env, 'group:', 300);
  const groups = (await KV.many(env, gk.map((k) => k.name))).filter((g) => g && g.official);
  return ok({ boards, channels, groups }, ctx);
});

/* ---------------- 用户本地网关工具 ---------------- */
// 用户自存配置（路由器 / OpenClaw 接入点），仅本人可读写，令牌不出后端。
const gwKey = (uidv) => `gw:${uidv}`;

router.get('/api/gateway/config', async (ctx) => {
  const { env, user } = ctx;
  if (!user) unauth();
  const cfg = await KV.getJSON(env, gwKey(user.id), {});
  return ok({
    router: { base: cfg.router?.base || '', hasToken: !!(cfg.router?.token) },
    openclaw: { base: cfg.openclaw?.base || '', hasToken: !!(cfg.openclaw?.token) },
  }, ctx);
});

router.put('/api/gateway/config', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  const prev = await KV.getJSON(env, gwKey(user.id), {});
  const cfg = {
    router: {
      base: body.router?.base !== undefined ? String(body.router.base || '').trim() : (prev.router?.base || ''),
      token: body.router?.token !== undefined ? String(body.router.token || '').trim() : (prev.router?.token || ''),
    },
    openclaw: {
      base: body.openclaw?.base !== undefined ? String(body.openclaw.base || '').trim() : (prev.openclaw?.base || ''),
      token: body.openclaw?.token !== undefined ? String(body.openclaw.token || '').trim() : (prev.openclaw?.token || ''),
    },
  };
  if (cfg.router.base && !/^https?:\/\//i.test(cfg.router.base)) bad('路由器地址须以 http(s):// 开头');
  if (cfg.openclaw.base && !/^https?:\/\//i.test(cfg.openclaw.base)) bad('OpenClaw 地址须以 http(s):// 开头');
  await KV.putJSON(env, gwKey(user.id), cfg);
  return ok({ ok: true }, ctx);
});

// 代理：列出家庭网络设备（GET {router.base}/devices，带 Bearer token）
router.post('/api/gateway/router/devices', async (ctx) => {
  const { env, user } = ctx;
  if (!user) unauth();
  const cfg = await KV.getJSON(env, gwKey(user.id), {});
  if (!cfg.router?.base) bad('请先在网关设置中填写路由器地址');
  let r;
  try {
    r = await fetch(cfg.router.base.replace(/\/$/, '') + '/devices', {
      headers: cfg.router.token ? { Authorization: 'Bearer ' + cfg.router.token } : {},
    });
  } catch (e) { return fail(502, 'gw_router', '无法连接路由器：' + e.message, ctx); }
  if (!r.ok) return fail(r.status, 'gw_router', '路由器返回 ' + r.status, ctx);
  const data = await r.json().catch(() => ({}));
  return ok({ devices: Array.isArray(data) ? data : (data.devices || []) }, ctx);
});

// 代理：禁用某设备（POST {router.base}/devices/{id}/disable）
router.post('/api/gateway/router/device/disable', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  const cfg = await KV.getJSON(env, gwKey(user.id), {});
  if (!cfg.router?.base) bad('请先配置路由器');
  const id = String(body.id || '').trim();
  if (!id) bad('缺少设备 id');
  let r;
  try {
    r = await fetch(cfg.router.base.replace(/\/$/, '') + '/devices/' + encodeURIComponent(id) + '/disable', {
      method: 'POST',
      headers: cfg.router.token ? { Authorization: 'Bearer ' + cfg.router.token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
    });
  } catch (e) { return fail(502, 'gw_router', '禁用设备失败：' + e.message, ctx); }
  if (!r.ok) return fail(r.status, 'gw_router', '路由器返回 ' + r.status, ctx);
  await writeAudit(env, user, 'gw.device.disable', id);
  return ok({ ok: true }, ctx);
});

// 代理：部署到 OpenClaw（POST {openclaw.base}/deploy，带 Bearer token）
router.post('/api/gateway/openclaw/deploy', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  const cfg = await KV.getJSON(env, gwKey(user.id), {});
  if (!cfg.openclaw?.base) bad('请先配置 OpenClaw 地址');
  let r;
  try {
    r = await fetch(cfg.openclaw.base.replace(/\/$/, '') + '/deploy', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, cfg.openclaw.token ? { Authorization: 'Bearer ' + cfg.openclaw.token } : {}),
      body: JSON.stringify(body.payload || {}),
    });
  } catch (e) { return fail(502, 'gw_openclaw', '部署请求失败：' + e.message, ctx); }
  if (!r.ok) return fail(r.status, 'gw_openclaw', 'OpenClaw 返回 ' + r.status, ctx);
  const data = await r.json().catch(() => ({}));
  await writeAudit(env, user, 'gw.openclaw.deploy', JSON.stringify(body.payload || {}).slice(0, 200));
  return ok({ ok: true, result: data }, ctx);
});

// IP 纯度检查：检测出口 IP 是否在常见 DNSBL 黑名单（通过 Cloudflare DoH 查询），并附带地理 / ISP 信息
router.get('/api/gateway/ip-check', async (ctx) => {
  const { request } = ctx;
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('cf-connecting-ip') || '';
  if (!ip) return ok({ ip: '', error: '无法获取客户端 IP' }, ctx);
  const rev = ip.split('.').reverse().join('.');
  const zones = ['zen.spamhaus.org', 'bl.spamcop.net', 'dnsbl.dronebl.org'];
  const lists = [];
  await Promise.all(zones.map(async (z) => {
    try {
      const u = 'https://1.1.1.1/dns-query?name=' + encodeURIComponent(rev + '.' + z) + '&type=A';
      const r = await fetch(u, { headers: { Accept: 'application/dns-json' } });
      const j = await r.json().catch(() => ({}));
      const answers = j.Answer || [];
      if (answers.length) lists.push({ zone: z, hits: answers.map((a) => a.data) });
    } catch (e) { /* 单区失败忽略 */ }
  }));
  let geo = {};
  try {
    const g = await fetch('https://ip-api.com/json/' + ip + '?fields=status,country,regionName,city,isp,org,as,proxy,hosting');
    geo = await g.json().catch(() => ({}));
  } catch (e) { geo = {}; }
  const listed = lists.length > 0;
  return ok({
    ip, listed, lists,
    country: geo.country || '', region: geo.regionName || '', city: geo.city || '',
    isp: geo.isp || '', org: geo.org || '', asn: String(geo.as || '').replace(/^AS/, ''),
    proxy: !!geo.proxy, hosting: !!geo.hosting,
    risk: listed ? 'suspicious' : (geo.hosting || geo.proxy ? 'caution' : 'clean'),
  }, ctx);
});

/* ========================================================================== *
 * 20.6 频道内群聊消息（Task #1-1）
 * ========================================================================== */

async function ensureGovernanceRoles(env) {
  await seedRoles(env, 'global', ['representative', 'discipline']);
}

async function chCanView(env, user, board, ch) {
  const uid = user && user.id ? String(user.id) : '';
  if (board.visibility === 'private' && !(await getMember(env, `board:${board.id}`, uid))) return false;
  if (ch.private && !(await getMember(env, `board:${board.id}`, uid))) return false;
  return true;
}

/* --------------------------------------------------------------------------
 * 存储结构说明（重要）
 * 群聊最早的实现是「一条消息一个 KV key」+ 每次拉取做 KV.list。
 * 但 KV 免费版每天只有 1000 次 list、1000 次写入，前端每 5 秒轮询一次就会在
 * 一个多小时内把 list 配额耗尽，整站随即 500。
 * 现改为「一个频道一个 key」：chlog:<bid>:<cid> 里存最近 CHLOG_MAX 条消息的数组。
 *   · 拉取 = 1 次 KV 读（读配额 100k/天，充裕），且有 isolate 内 3 秒缓存吸收轮询；
 *   · 发送/删除 = 1 次 KV 写；
 *   · 作者信息在写入时就冗余存好，避免拉取时按作者数量放大读次数。
 * ------------------------------------------------------------------------ */
const CHLOG_MAX = 200;                       // 每个频道保留的最近消息条数
const CH_CACHE = new Map();                  // key -> { at, data }
const CH_CACHE_TTL = 3000;
const RT_CACHE = new Map();                  // userId -> { at, tags } 身份标签缓存
const RT_CACHE_TTL = 300000;

const chLogKey = (bid, cid) => `chlog:${bid}:${cid}`;

async function readChLog(env, bid, cid, { fresh = false } = {}) {
  const key = chLogKey(bid, cid);
  const hit = CH_CACHE.get(key);
  if (!fresh && hit && Date.now() - hit.at < CH_CACHE_TTL) return hit.data;
  const data = (await KV.getJSON(env, key, null)) || { items: [] };
  if (!Array.isArray(data.items)) data.items = [];
  CH_CACHE.set(key, { at: Date.now(), data });
  return data;
}

async function writeChLog(env, bid, cid, data) {
  data.items = data.items.slice(-CHLOG_MAX);
  CH_CACHE.set(chLogKey(bid, cid), { at: Date.now(), data });
  await KV.putJSON(env, chLogKey(bid, cid), data);
}

/** 身份标签按用户缓存 5 分钟，避免一屏消息触发几十次用户读取 */
async function roleTagsCached(env, userId) {
  const hit = RT_CACHE.get(userId);
  if (hit && Date.now() - hit.at < RT_CACHE_TTL) return hit.tags;
  const u = await getUser(env, userId);
  const tags = u ? await roleTagsOf(env, u, 'global') : [];
  RT_CACHE.set(userId, { at: Date.now(), tags });
  return tags;
}

router.get('/api/boards/:bid/channels/:cid/messages', async (ctx) => {
  const { env, user, params, url } = ctx;
  const board = await KV.getJSON(env, `bd:${params.bid}`);
  if (!board) notfound('版块不存在');
  const ch = await KV.getJSON(env, `ch:${params.bid}:${params.cid}`);
  if (!ch) notfound('频道不存在');
  if (!user) unauth();
  if (!(await chCanView(env, user, board, ch))) forbid('无权查看该频道消息');
  const limit = clamp(url.searchParams.get('limit') || 50, 1, 100);
  const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;

  const log = await readChLog(env, params.bid, params.cid);
  let msgs = log.items.slice(-limit);
  if (since) msgs = msgs.filter((m) => (m.createdAt || 0) > since);   // 增量拉取

  const tagCache = new Map();
  // 区域身份：同一批消息里同一作者只查一次 member 记录
  const idCache = new Map();
  const scopeKey = `channel:${params.bid}:${params.cid}`;
  const out = [];
  for (const m of msgs) {
    const auid = m.authorId;
    if (!tagCache.has(auid)) {
      try { tagCache.set(auid, m.bot ? [] : await roleTagsCached(env, auid)); }
      catch (e) { tagCache.set(auid, []); console.error('[ch/msg] roleTags failed', auid, e); }
    }
    if (!idCache.has(auid)) {
      try { idCache.set(auid, m.bot ? null : await areaIdentity(env, scopeKey, auid)); }
      catch (e) { idCache.set(auid, null); console.error('[ch/msg] areaIdentity failed', auid, e); }
    }
    const ident = idCache.get(auid);
    let rx = [];
    try { rx = await getReactionSummary(env, `ch:${params.bid}:${params.cid}:${m.id}`, user.id); }
    catch (e) { console.error('[ch/msg] reactions failed', m.id, e); }
    out.push({
      id: m.id, text: m.text, createdAt: m.createdAt, replyTo: m.replyTo || null,
      bot: !!m.bot, system: !!m.system,
      reactions: rx,
      author: {
        id: auid,
        username: m.authorName || '未知',
        displayName: (ident && ident.nickname) || m.authorDisplay || m.authorName || '未知用户',
        avatar: (ident && ident.avatar) || m.authorAvatar || '',
        roleTags: tagCache.get(auid),
        official: !!m.authorOfficial,
        bot: !!m.bot,
      },
    });
  }
  return ok({
    items: out, cursor: null, now: nowMs(),
    allowReactions: ch.allowReactions !== false,
  }, ctx);
});

router.post('/api/boards/:bid/channels/:cid/messages', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const board = await KV.getJSON(env, `bd:${params.bid}`);
  if (!board) notfound('版块不存在');
  const ch = await KV.getJSON(env, `ch:${params.bid}:${params.cid}`);
  if (!ch) notfound('频道不存在');
  if (await isMuted(env, user, `board:${params.bid}`)) forbid('你已被本版块禁言，无法发送消息');
  if (await isMuted(env, user, `channel:${params.bid}:${params.cid}`)) forbid('你已被本频道禁言');
  if (!(await chCanView(env, user, board, ch))) forbid('无权在该频道发言');
  if (ch.type && ch.type !== 'text' && ch.type !== 'announcement') bad('该频道类型不支持群聊');
  const text = String(body.text || '').trim().slice(0, 2000);
  if (!text) bad('消息内容不能为空');
  // 区域禁封名单
  if ((board.bannedUsers || []).includes(user.id)) forbid('你已被本版块封禁');
  if ((board.blacklist || []).includes(user.id)) forbid('你已被本版块列入黑名单');
  // 机器人命令优先处理（/ 开头）
  if (text.startsWith('/')) {
    const handled = await handleBotCommand(env, params.bid, params.cid, user, text);
    if (handled) return ok({ message: null, botHandled: true }, ctx);
  }
  let ident = null;
  try { ident = await areaIdentity(env, `channel:${params.bid}:${params.cid}`, user.id); }
  catch (e) { console.error('[ch/send] areaIdentity failed', e); }
  const id = uid('m');
  const msg = {
    id, authorId: user.id,
    authorName: user.username,
    authorDisplay: (ident && ident.nickname) || user.displayName || user.username,
    authorAvatar: (ident && ident.avatar) || user.avatar || '',
    authorOfficial: !!user.official,
    text, replyTo: body.replyTo ? String(body.replyTo).slice(0, 40) : null, createdAt: nowMs(),
  };
  const log = await readChLog(env, params.bid, params.cid, { fresh: true });
  log.items.push(msg);
  await writeChLog(env, params.bid, params.cid, log);   // 整个频道 1 次写
  bumpStatLazy('chmsgs');                                // 计数攒批，不即时写 KV
  let roleTags = [];
  try { roleTags = await roleTagsCached(env, user.id); } catch (e) { console.error('[ch/send] roleTags failed', e); }
  return ok({
    message: {
      ...msg, boardId: params.bid, channelId: params.cid,
      author: {
        id: user.id, username: user.username, displayName: (ident && ident.nickname) || user.displayName || user.username,
        avatar: (ident && ident.avatar) || user.avatar, roleTags, official: !!user.official,
      },
    },
  }, ctx);
});

router.delete('/api/boards/:bid/channels/:cid/messages/:mid', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const log = await readChLog(env, params.bid, params.cid, { fresh: true });
  const m = log.items.find((x) => x.id === params.mid);
  if (!m) notfound('消息不存在');
  const byModerator = m.authorId !== user.id;
  if (byModerator) {
    await requirePerm(env, user, 'channel.manage', `channel:${params.bid}:${params.cid}`);
  }
  log.items = log.items.filter((x) => x.id !== params.mid);
  await writeChLog(env, params.bid, params.cid, log);
  // 只有管理员删他人消息才记审计，自己删自己的不记（省写配额）
  if (byModerator) await writeAudit(env, user, 'ch.msg.delete', `${params.bid}/${params.cid}/${params.mid}`, '');
  return ok({ ok: true }, ctx);
});

/* 置顶 / 取消置顶频道消息（仅频道管理者 / 版主 / 超管） */
router.patch('/api/boards/:bid/channels/:cid/messages/:mid', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const board = await KV.getJSON(env, `bd:${params.bid}`);
  if (!board) notfound('版块不存在');
  const ch = await KV.getJSON(env, `ch:${params.bid}:${params.cid}`);
  if (!ch) notfound('频道不存在');
  const canPin = (await hasPerm(env, user, 'channel.manage', `channel:${params.bid}:${params.cid}`))
    || (await hasPerm(env, user, 'board.manage', `board:${params.bid}`));
  if (!canPin) forbid('无权置顶消息');
  const log = await readChLog(env, params.bid, params.cid, { fresh: true });
  const m = log.items.find((x) => x.id === params.mid);
  if (!m) notfound('消息不存在');
  m.pinned = !!body.pinned;
  m.pinnedBy = m.pinned ? user.id : '';
  m.pinnedAt = m.pinned ? nowMs() : 0;
  await writeChLog(env, params.bid, params.cid, log);
  await writeAudit(env, user, 'ch.msg.pin', `${params.bid}/${params.cid}/${params.mid} pinned=${m.pinned}`, '');
  return ok({ id: m.id, pinned: m.pinned }, ctx);
});

/* ========================================================================== *
 * 20.6 消息反应（Discord 式）/ 外部表情 / 区域身份 / 欢迎机器人
 * ========================================================================== */

/* --------------------------- 反应（reactions） ---------------------------- */
const RX_CACHE = new Map();               // reactions key -> { at, obj }
const RX_CACHE_TTL = 60000;

async function getReactionMap(env, key) {
  const ck = `reactions:${key}`;
  const hit = RX_CACHE.get(ck);
  if (hit && Date.now() - hit.at < RX_CACHE_TTL) return hit.obj;
  const obj = (await KV.getJSON(env, ck, null)) || {};
  RX_CACHE.set(ck, { at: Date.now(), obj });
  return obj;
}
async function getReactionSummary(env, key, viewerId) {
  const obj = await getReactionMap(env, key);
  return Object.keys(obj).map((e) => ({ emoji: e, count: obj[e].length, reacted: viewerId ? obj[e].includes(viewerId) : false }));
}
async function toggleReaction(env, key, userId, emoji) {
  const ck = `reactions:${key}`;
  const obj = await getReactionMap(env, key);
  const arr = obj[emoji] || [];
  const i = arr.indexOf(userId);
  let added = false;
  if (i >= 0) arr.splice(i, 1); else { arr.push(userId); added = true; }
  if (arr.length) obj[emoji] = arr; else delete obj[emoji];
  RX_CACHE.set(ck, { at: Date.now(), obj });
  if (Object.keys(obj).length) await KV.putJSON(env, ck, obj);
  else await KV.del(env, ck);
  return added;
}

router.post('/api/react', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  const targetType = String(body.targetType || '').trim();
  const targetId = String(body.targetId || '').trim();
  const emoji = String(body.emoji || '').trim();
  if (!['post', 'comment', 'channel'].includes(targetType)) bad('无效的表态对象');
  if (!targetId) bad('缺少对象 ID');
  if (!emoji) bad('缺少表情');
  if (emoji.length > 12) bad('表情过长');
  await requirePerm(env, user, 'react.use');

  let scope = 'global';
  if (targetType === 'channel') {
    const [bid, cid, mid] = targetId.split(':');
    const ch = await KV.getJSON(env, `ch:${bid}:${cid}`);
    if (!ch) notfound('频道不存在');
    scope = `channel:${bid}:${cid}`;
    if (ch.allowReactions === false && !(await hasPerm(env, user, 'channel.manage', scope))) forbid('本频道已关闭表态功能');
  } else if (targetType === 'post') {
    const p = await KV.getJSON(env, `post:${targetId}`);
    if (!p) notfound('帖子不存在');
    if (p.board) {
      const bd = await KV.getJSON(env, `bd:${p.board}`);
      scope = `board:${p.board}`;
      if (bd && bd.allowReactions === false && !(await hasPerm(env, user, 'board.manage', scope))) forbid('本版块已关闭表态功能');
    }
  }
  const key = targetType === 'channel' ? `ch:${targetId}` : `${targetType}:${targetId}`;
  const added = await toggleReaction(env, key, user.id, emoji);
  const summary = await getReactionSummary(env, key, user.id);
  return ok({ reactions: summary, added }, ctx);
});

/* --------------------------- 外部 / 自定义表情 ---------------------------- */
router.get('/api/emojis', async (ctx) => {
  const { env } = ctx;
  const cfg = await getSiteConfig(env);
  const items = Array.isArray(cfg.emojis) ? cfg.emojis : [];
  return ok({ items, allowExternalEmoji: cfg.allowExternalEmoji !== false }, ctx);
});

router.put('/api/admin/emojis', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  await requirePerm(env, user, 'site.config');
  const items = Array.isArray(body.items) ? body.items : [];
  const cleaned = items.slice(0, 200).map((e) => ({
    id: String(e.id || '').trim().slice(0, 40) || 'emo_' + uid('e'),
    name: String(e.name || '').trim().slice(0, 32).replace(/:/g, ''),
    url: String(e.url || '').trim().slice(0, 500),
    creator: String(e.creator || user.username).slice(0, 40),
    createdAt: e.createdAt || nowMs(),
  })).filter((e) => e.name && e.url && /^https?:\/\//i.test(e.url));
  const cfg = await getSiteConfig(env);
  cfg.emojis = cleaned;
  if (body.allowExternalEmoji !== undefined) cfg.allowExternalEmoji = !!body.allowExternalEmoji;
  await saveSiteConfig(env, cfg);
  await writeAudit(env, user, 'emoji.update', '', `共 ${cleaned.length} 个`);
  return ok({ items: cleaned }, ctx);
});

/* --------------------------- 区域级身份（仅区域内可见） ------------------- */
// member 记录扩展：nickname / avatar / bio / banner。用户主页仍显示原始资料。
router.get('/api/members/:scope', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const scope = scopeKeyOf(decodeURIComponent(params.scope));
  const m = await getMember(env, scope, user.id);
  return ok({ member: m || { userId: user.id, scope, nickname: '', avatar: '', bio: '', banner: '' } }, ctx);
});

router.patch('/api/members/:scope', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const scope = scopeKeyOf(decodeURIComponent(params.scope));
  if (scope === 'global') bad('不能在全局作用域设置区域身份');
  // 必须真的是该区域成员（或管理者）
  const existing = await getMember(env, scope, user.id);
  const isManager = await hasPerm(env, user, scope.startsWith('channel') ? 'channel.manage' : 'board.manage', scope);
  if (!existing && !isManager) forbid('你不是该区域成员');
  const data = {
    nickname: String(body.nickname || existing?.nickname || '').slice(0, 30),
    avatar: String(body.avatar || existing?.avatar || '').slice(0, 500),
    bio: String(body.bio || existing?.bio || '').slice(0, 200),
    banner: String(body.banner || existing?.banner || '').slice(0, 500),
  };
  const rec = await saveMember(env, scope, user.id, { ...existing, ...data });
  return ok({ member: rec }, ctx);
});

/* --------------------------- 自定义身份组（图标） ------------------------- */
// 管理者/超管创建的身份组：icon 对全员生效；普通用户上传的 icon 仅自己生效（roleIconOverrides）。
router.get('/api/admin/roles', async (ctx) => {
  const { env, user } = ctx;
  if (!user) unauth();
  const scope = scopeKeyOf(String(ctx.url.searchParams.get('scope') || 'global'));
  await requirePerm(env, user, 'role.manage', scope);
  const { keys } = await KV.list(env, `role:${scope}:`, 200);
  const roles = (await KV.many(env, keys.map((k) => k.name))).filter(Boolean)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  return ok({ roles }, ctx);
});

router.post('/api/admin/roles', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  const scope = scopeKeyOf(String(body.scope || 'global'));
  await requirePerm(env, user, 'role.manage', scope);
  let id = String(body.id || '').trim();
  if (!id) id = 'role_' + uid('r');
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(id)) bad('身份组 ID 只能含字母数字下划线，2-40 位');
  const exist = await getRole(env, scope, id);
  if (exist) bad('该身份组 ID 已存在');
  const role = {
    id, scope, name: String(body.name || id).slice(0, 30),
    color: String(body.color || '#64748b').slice(0, 20),
    icon: String(body.icon || '').slice(0, 500),
    priority: Number(body.priority) || 300,
    perms: Array.isArray(body.perms) ? body.perms.slice(0, 30) : [],
    hoist: body.hoist !== false, mentionable: body.mentionable !== false,
    system: false, createdBy: user.id, createdAt: nowMs(),
  };
  await saveRole(env, role);
  await writeAudit(env, user, 'role.create', `${scope}/${id}`, role.name);
  return ok({ role }, ctx);
});

router.put('/api/admin/roles/:id', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const scope = scopeKeyOf(String(body.scope || 'global'));
  await requirePerm(env, user, 'role.manage', scope);
  const role = await getRole(env, scope, params.id);
  if (!role) notfound('身份组不存在');
  if (role.system) bad('系统身份组不可修改');
  role.name = String(body.name || role.name).slice(0, 30);
  if (body.color !== undefined) role.color = String(body.color).slice(0, 20);
  if (body.icon !== undefined) role.icon = String(body.icon).slice(0, 500);   // 管理者/超管改 → 对全组生效
  if (body.priority !== undefined) role.priority = Number(body.priority) || role.priority;
  if (Array.isArray(body.perms)) role.perms = body.perms.slice(0, 30);
  await saveRole(env, role);
  await writeAudit(env, user, 'role.update', `${scope}/${params.id}`, role.name);
  return ok({ role }, ctx);
});

router.delete('/api/admin/roles/:id', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const scope = scopeKeyOf(String(body.scope || 'global'));
  await requirePerm(env, user, 'role.manage', scope);
  const role = await getRole(env, scope, params.id);
  if (!role) notfound('身份组不存在');
  if (role.system) bad('系统身份组不可删除');
  await KV.del(env, `role:${scope}:${params.id}`);
  await writeAudit(env, user, 'role.delete', `${scope}/${params.id}`, role.name);
  return ok({ ok: true }, ctx);
});

// 普通用户为自己的身份组设置「仅自己可见」的图标覆盖
router.patch('/api/me/role-icons', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  const overrides = (user.roleIconOverrides && typeof user.roleIconOverrides === 'object') ? { ...user.roleIconOverrides } : {};
  if (body.icon !== undefined) {
    const rid = String(body.roleId || '').trim();
    if (!rid) bad('缺少身份组 ID');
    if (body.icon) overrides[rid] = String(body.icon).slice(0, 500);
    else delete overrides[rid];
  }
  user.roleIconOverrides = overrides;
  await saveUser(env, user);
  return ok({ roleIconOverrides: overrides }, ctx);
});

/* 装备 / 卸下头像框（仅本人，且必须是已拥有的框，样式须为白名单内） */
router.patch('/api/me/avatar-frame', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  const frameId = String(body.frameId || '');
  if (!frameId) {
    user.avatarFrame = '';
    await saveUser(env, user);
    return ok({ avatarFrame: '', avatarFrames: user.avatarFrames || [] }, ctx);
  }
  const owned = (user.avatarFrames || []).find((f) => f.id === frameId);
  if (!owned) return fail(404, 'NO_FRAME', '你还没有这个头像框', ctx);
  if (FRAME_CLASSES.indexOf(owned.cls) < 0) return fail(400, 'BAD_FRAME', '非法的头像框样式', ctx);
  user.avatarFrame = owned.cls;
  await saveUser(env, user);
  return ok({ avatarFrame: user.avatarFrame, avatarFrames: user.avatarFrames || [] }, ctx);
});

/* --------------------------- 官方认证身份组 ------------------------------- */
// 不可被赋予，仅官方账号拥有。在 roleTagsOf 中注入（见下方覆盖）。

/* --------------------------- 欢迎机器人 / 内置命令 ------------------------ */
async function reportToDiscipline(env, bid, target, reporter, reason) {
  const id = sortableId();
  const rep = {
    id, reporterId: reporter.id,
    targetType: 'user', targetId: target.id,
    scope: `board:${bid}`,
    reason: 'discipline', detail: String(reason || '').slice(0, 1000),
    status: 'open', handledBy: '', handledAt: 0, resolution: '',
    ip: '', createdAt: nowMs(),
  };
  await KV.putJSON(env, `rep:${id}`, rep, { metadata: { s: 'open', t: rep.createdAt } });
  bumpStatLazy('reports');
  return rep;
}

const BOT_AUTHOR = () => ({ id: '__marytbot', username: 'MarytBot', displayName: 'MarytBot', avatar: '', official: true, bot: true });

async function postBotMessage(env, bid, cid, text) {
  const ch = await KV.getJSON(env, `ch:${bid}:${cid}`);
  if (!ch) return null;
  const id = uid('m');
  const msg = {
    id, authorId: '__marytbot', bot: true,
    authorName: 'MarytBot', authorDisplay: 'MarytBot', authorAvatar: '', authorOfficial: true,
    text, createdAt: nowMs(), system: true,
  };
  const log = await readChLog(env, bid, cid, { fresh: true });
  log.items.push(msg);
  await writeChLog(env, bid, cid, log);
  return msg;
}

// 解析 @用户名 或 mention
function parseMention(text) {
  const m = String(text || '').match(/@([A-Za-z0-9_\u4e00-\u9fa5-]{2,20})/);
  return m ? m[1] : null;
}
async function resolveByUsername(env, name) {
  const { keys } = await KV.list(env, 'user:', 300);
  for (const k of keys) {
    const u = await KV.getJSON(env, k.name);
    if (u && !u.flags?.deleted && (u.username === name || u.displayName === name)) return u;
  }
  return null;
}

// 处理频道内以 / 开头的机器人命令（由消息发送处调用）
async function handleBotCommand(env, bid, cid, user, text) {
  const parts = String(text || '').trim().split(/\s+/);
  const cmd = (parts[0] || '').toLowerCase();
  if (!cmd.startsWith('/')) return false;
  const board = await KV.getJSON(env, `bd:${bid}`);
  if (!board || board.botEnabled === false) return false;     // 区域未开启机器人 → 不当作命令
  const isManager = await hasPerm(env, user, 'channel.manage', `channel:${bid}:${cid}`)
    || await hasPerm(env, user, 'board.manage', `board:${bid}`);
  let out = '';
  switch (cmd) {
    case '/help':
      out = '🤖 MarytBot 可用命令：/help /welcome /kick @用户 /mute @用户 [分钟] /ban @用户 /blacklist @用户 /report @用户 原因';
      break;
    case '/welcome':
      if (!isManager) { out = '⚠️ 仅版主/频道主可设置欢迎语。'; break; }
      board.welcomeMessage = parts.slice(1).join(' ').slice(0, 500);
      await KV.putJSON(env, `bd:${bid}`, board);
      out = '✅ 已更新本版块欢迎语。';
      break;
    case '/kick': case '/ban': case '/blacklist': case '/mute': case '/report': {
      const targetName = parseMention(text);
      if (!targetName) { out = '⚠️ 用法：' + cmd + ' @用户名'; break; }
      const target = await resolveByUsername(env, targetName);
      if (!target) { out = '⚠️ 找不到用户 @' + targetName; break; }
      if (target.id === user.id) { out = '⚠️ 不能对自己执行该操作。'; break; }
      if (cmd === '/report') {
        const reason = parts.slice(2).join(' ') || '违规';
        await reportToDiscipline(env, bid, target, user, reason);
        out = '📨 已上报风纪委员会：@' + targetName + '（' + reason + '）';
        break;
      }
      if (!isManager) { out = '⚠️ 仅版主/频道主可执行 ' + cmd; break; }
      board.bannedUsers = board.bannedUsers || [];
      board.blacklist = board.blacklist || [];
      if (cmd === '/kick') {
        await KV.del(env, `member:board:${bid}:${target.id}`);
        out = '👢 已将 @' + targetName + ' 移出版块。';
      } else if (cmd === '/mute') {
        const mins = parseInt(parts[2] || '10', 10) || 10;
        const m = await getMember(env, `board:${bid}`, target.id) || { userId: target.id, scope: `board:${bid}`, roles: [] };
        m.mutedUntil = nowMs() + mins * 60000;
        await saveMember(env, `board:${bid}`, target.id, m);
        out = '🔇 已禁言 @' + targetName + ' ' + mins + ' 分钟（本版块内）。';
      } else if (cmd === '/ban') {
        if (!board.bannedUsers.includes(target.id)) board.bannedUsers.push(target.id);
        await KV.putJSON(env, `bd:${bid}`, board);
        out = '⛔ 已封禁 @' + targetName + '（本版块内）。';
      } else if (cmd === '/blacklist') {
        if (!board.blacklist.includes(target.id)) board.blacklist.push(target.id);
        await KV.putJSON(env, `bd:${bid}`, board);
        out = '🚫 已将 @' + targetName + ' 加入黑名单（禁止再次加入）。';
      }
      break;
    }
    default:
      return false;     // 未知命令，按普通消息处理
  }
  if (out) {
    await postBotMessage(env, bid, cid, out);
    return true;
  }
  return false;
}

/* ========================================================================== *
 * 20.7 认证 / 荣誉体系 + 官方账号 API 密钥（Task #2）
 * ========================================================================== */

async function getBadgeCatalog(env) {
  const cfg = await getSiteConfig(env);
  return Array.isArray(cfg.badgeCatalog) ? cfg.badgeCatalog : [];
}

router.get('/api/honors/catalog', async (ctx) => {
  const { env } = ctx;
  return ok({ items: await getBadgeCatalog(env) }, ctx);
});

router.put('/api/admin/honors/catalog', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (!await isSuperAdmin(env, user)) forbid('仅超级管理员可管理荣誉目录');
  const items = Array.isArray(body.items) ? body.items : [];
  const cleaned = items.slice(0, 60).map((b) => ({
    id: String(b.id || '').trim().slice(0, 40) || 'badge_' + uid('b'),
    name: String(b.name || '').trim().slice(0, 30),
    color: String(b.color || '#6366f1').slice(0, 20),
    icon: String(b.icon || '★').slice(0, 4),
    desc: String(b.desc || '').slice(0, 120),
    officialCert: !!b.officialCert,
  })).filter((b) => b.name);
  const cfg = await getSiteConfig(env);
  cfg.badgeCatalog = cleaned;
  await saveSiteConfig(env, cfg);
  await writeAudit(env, user, 'honors.catalog', '', JSON.stringify(cleaned).slice(0, 200));
  return ok({ items: cleaned }, ctx);
});

async function grantBadgeToUser(env, target, badge) {
  const badges = Array.isArray(target.badges) ? target.badges.filter((b) => b.id !== badge.id) : [];
  badges.push(badge);
  target.badges = badges;
  await saveUser(env, target);
  return badges;
}
async function revokeBadgeFromUser(env, target, badgeId) {
  const badges = (Array.isArray(target.badges) ? target.badges : []).filter((b) => b.id !== badgeId);
  target.badges = badges;
  await saveUser(env, target);
  return badges;
}

router.put('/api/admin/honors/grant', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  const isSA = await isSuperAdmin(env, user);
  const isOA = isOfficialAccount(user);
  if (!isSA && !isOA) forbid('仅超级管理员或官方账号可颁发认证/荣誉');
  const target = await getUser(env, String(body.userId || ''));
  if (!target) notfound('用户不存在');
  if (target.protected && !isSA) forbid('该用户受保护，仅超级管理员可操作');
  const badge = {
    id: String(body.badge?.id || '').trim().slice(0, 40) || 'badge_' + uid('b'),
    name: String(body.badge?.name || '').trim().slice(0, 30),
    color: String(body.badge?.color || '#6366f1').slice(0, 20),
    icon: String(body.badge?.icon || '★').slice(0, 4),
    desc: String(body.badge?.desc || '').slice(0, 120),
    officialCert: !!body.badge?.officialCert,
    grantedBy: user.id, grantedAt: nowMs(),
  };
  if (!badge.name) bad('徽章名称不能为空');
  // 官方账号只能颁发 certified 类徽章；其余需超管
  if (!isSA && !badge.officialCert) forbid('官方账号仅可颁发官方认证类徽章');
  const badges = await grantBadgeToUser(env, target, badge);
  await writeAudit(env, user, 'honors.grant', target.username, badge.name);
  await pushNotification(env, target.id, { type: 'honor', title: '你获得了一项新荣誉', body: `${badge.name}：${badge.desc || ''}`.trim(), link: '/profile.html?u=' + encodeURIComponent(target.username) });
  return ok({ badges }, ctx);
});

router.put('/api/admin/honors/revoke', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (!await isSuperAdmin(env, user)) forbid('仅超级管理员可撤销荣誉');
  const target = await getUser(env, String(body.userId || ''));
  if (!target) notfound('用户不存在');
  const badges = await revokeBadgeFromUser(env, target, String(body.badgeId || ''));
  await writeAudit(env, user, 'honors.revoke', target.username, String(body.badgeId || ''));
  return ok({ badges }, ctx);
});

/* ---------------- 官方账号：后台配置（创建 / 改名 / 重置密码） ---------------- *
 * 官方账号原本只能靠 OFFICIAL_ACCOUNT_* 环境变量播种，改起来必须重新部署。
 * 这里给超级管理员一个后台面板：可以直接创建官方账号、改用户名/邮箱/昵称/头像/简介，
 * 以及重置登录密码。
 * 密码约定（与全站一致，网络上不出现明文）：
 *   · 管理员手动指定密码 → 前端先做 SHA-256(pwd + ':MarytOpens::v1') 再上传 passwordHash，
 *     服务端只做 PBKDF2 入库，绝不回显。
 *   · 选择「随机生成」→ 由服务端生成随机口令，入库后**仅此一次**在响应里返回明文，
 *     供管理员抄走；之后再也查不到。
 */

/** 定位官方账号：优先 KV 指针，其次环境变量指定的用户名 / 邮箱 */
async function getOfficialAccount(env) {
  const pid = await env.DB.get('sys:official_uid');
  if (pid) {
    const u = await getUser(env, pid);
    if (u) return u;
  }
  const oUser = String(env.OFFICIAL_ACCOUNT_USERNAME || 'marytopens').trim();
  let u = oUser ? await findUserByUsername(env, oUser) : null;
  if (!u) {
    const oEmail = String(env.OFFICIAL_ACCOUNT_EMAIL || '').toLowerCase().trim();
    if (oEmail) u = await findUserByEmail(env, oEmail);
  }
  return u && u.official ? u : null;
}

/** 生成便于人工转录的随机口令（去掉易混淆字符） */
function randomPassword(len = 16) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const buf = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (let i = 0; i < len; i++) s += abc[buf[i] % abc.length];
  return s;
}

router.get('/api/admin/official/account', async (ctx) => {
  const { env, user } = ctx;
  if (!user) unauth();
  if (!await isSuperAdmin(env, user)) forbid('仅超级管理员可查看官方账号配置');
  const o = await getOfficialAccount(env);
  return ok({
    exists: !!o,
    account: o ? {
      id: o.id, username: o.username, email: o.email || '',
      displayName: o.displayName || o.username, avatar: o.avatar || '', bio: o.bio || '',
      official: !!o.official, protected: !!o.protected,
      createdAt: o.createdAt, lastLoginAt: o.lastLoginAt || 0,
      badges: Array.isArray(o.badges) ? o.badges : [],
    } : null,
    // 提示前端：环境变量是否已经播种过（只回布尔，不回值）
    seededByEnv: !!(env.OFFICIAL_ACCOUNT_EMAIL && env.OFFICIAL_ACCOUNT_PASSWORD),
    defaults: { username: String(env.OFFICIAL_ACCOUNT_USERNAME || 'marytopens').trim() },
  }, ctx);
});

router.put('/api/admin/official/account', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (!await isSuperAdmin(env, user)) forbid('仅超级管理员可配置官方账号');

  let o = await getOfficialAccount(env);
  const created = !o;
  let plainPassword = '';   // 仅在「随机生成」时才有值，且只返回一次

  const wantName = String(body.username || '').trim();
  const wantEmail = String(body.email || '').toLowerCase().trim();

  if (created) {
    const username = wantName || String(env.OFFICIAL_ACCOUNT_USERNAME || 'marytopens').trim();
    if (!USERNAME_RE.test(username)) bad('用户名需为 2-20 位字母、数字、下划线、连字符或中文');
    if (await findUserByUsername(env, username)) conflict('用户名已被占用');
    if (wantEmail && !EMAIL_RE.test(wantEmail)) bad('邮箱格式不正确');
    if (wantEmail) {
      const dup = await findUserByEmail(env, wantEmail);
      if (dup) conflict('该邮箱已被其他账号使用');
    }
    // 密码：优先用管理员给的预哈希；否则随机生成一个并回显一次
    let clientHash = String(body.passwordHash || '').trim();
    if (!/^[0-9a-f]{64}$/i.test(clientHash)) {
      plainPassword = randomPassword(16);
      clientHash = await sha256Hex(`${plainPassword}:${SUPER_ADMIN_PEPPER}`);
    }
    const oid = uid('u');
    o = newUserSkeleton({ id: oid, username, email: wantEmail });
    o.displayName = String(body.displayName || 'MarytOpens 官方').slice(0, 40);
    o.emailVerified = true;
    o.official = true;
    o.protected = true;
    o.password = await hashPassword(clientHash);
    o.roles = { global: ['role_member'] };
    o.badges = [{ id: 'official', name: '官方认证', color: '#2563eb', icon: '✓', official: true }];
    if (body.avatar !== undefined) o.avatar = String(body.avatar).slice(0, 500);
    if (body.bio !== undefined) o.bio = sanitizeContent(String(body.bio).slice(0, 500));
    await saveUser(env, o);
    await env.DB.put(unameKey(username), oid);
    if (wantEmail) await env.DB.put(await emailKey(wantEmail), oid);
    await saveMember(env, 'global', oid, { roles: ['role_member'] });
    await env.DB.put('sys:official_uid', oid);
    bumpStatLazy('users');
  } else {
    if (wantName && wantName !== o.username) {
      if (!USERNAME_RE.test(wantName)) bad('用户名需为 2-20 位字母、数字、下划线、连字符或中文');
      if (await findUserByUsername(env, wantName)) conflict('用户名已被占用');
      await KV.del(env, unameKey(o.username));
      await env.DB.put(unameKey(wantName), o.id);
      o.username = wantName;
    }
    if (wantEmail && wantEmail !== (o.email || '')) {
      if (!EMAIL_RE.test(wantEmail)) bad('邮箱格式不正确');
      const dup = await findUserByEmail(env, wantEmail);
      if (dup && dup.id !== o.id) conflict('该邮箱已被其他账号使用');
      if (o.email) await KV.del(env, await emailKey(o.email));
      await env.DB.put(await emailKey(wantEmail), o.id);
      o.email = wantEmail;
      o.emailVerified = true;
    }
    if (body.displayName !== undefined) o.displayName = String(body.displayName).slice(0, 40) || o.username;
    if (body.avatar !== undefined) o.avatar = String(body.avatar).slice(0, 500);
    if (body.bio !== undefined) o.bio = sanitizeContent(String(body.bio).slice(0, 500));
    // 重置密码：resetPassword=true 走随机生成；或直接给 passwordHash
    const givenHash = String(body.passwordHash || '').trim();
    if (/^[0-9a-f]{64}$/i.test(givenHash)) {
      o.password = await hashPassword(givenHash);
      o.tokenVersion = (o.tokenVersion || 1) + 1;    // 踢掉旧登录态
    } else if (body.resetPassword) {
      plainPassword = randomPassword(16);
      o.password = await hashPassword(await sha256Hex(`${plainPassword}:${SUPER_ADMIN_PEPPER}`));
      o.tokenVersion = (o.tokenVersion || 1) + 1;
    }
    o.official = true;
    o.protected = true;
    await saveUser(env, o);
    await env.DB.put('sys:official_uid', o.id);
  }

  await writeAudit(env, user, created ? 'official.account.create' : 'official.account.update', o.username,
    plainPassword ? '（含密码重置）' : '');

  return ok({
    created,
    account: {
      id: o.id, username: o.username, email: o.email || '',
      displayName: o.displayName, avatar: o.avatar || '', bio: o.bio || '',
      official: true, protected: true, createdAt: o.createdAt,
    },
    // 明文口令只在本次响应出现，之后无法再获取
    initialPassword: plainPassword || '',
  }, ctx);
});

/* ---------------- 官方账号：接入第三方 AI 产品 API 密钥 + 发布官方消息 ---------------- */

router.get('/api/admin/official/keys', async (ctx) => {
  const { env, user } = ctx;
  if (!user) unauth();
  if (!await isSuperAdmin(env, user) && !isOfficialAccount(user)) forbid('无权限');
  const cfg = await getSiteConfig(env);
  const keys = (cfg.officialKeys || []).map((k) => ({
    id: k.id, name: k.name, product: k.product, endpoint: k.endpoint,
    enabled: !!k.enabled, hasKey: !!k.apiKey, keyMask: k.apiKey ? '••••' + String(k.apiKey).slice(-4) : '',
  }));
  return ok({ items: keys }, ctx);
});

router.put('/api/admin/official/keys', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (!await isSuperAdmin(env, user)) forbid('仅超级管理员可配置官方接入密钥');
  const items = Array.isArray(body.items) ? body.items : [];
  const cleaned = items.slice(0, 20).map((k) => ({
    id: String(k.id || '').trim().slice(0, 40) || 'ok_' + uid('k'),
    name: String(k.name || '').trim().slice(0, 40),
    product: String(k.product || '').trim().slice(0, 40),
    endpoint: String(k.endpoint || '').slice(0, 400),
    apiKey: String(k.apiKey || '').slice(0, 500),
    enabled: !!k.enabled,
  })).filter((k) => k.name);
  const cfg = await getSiteConfig(env);
  cfg.officialKeys = cleaned;
  await saveSiteConfig(env, cfg);
  await writeAudit(env, user, 'official.keys', '', JSON.stringify(cleaned.map((k) => ({ ...k, apiKey: '***' }))).slice(0, 200));
  return ok({ items: cleaned.map((k) => ({ ...k, apiKey: undefined, hasKey: !!k.apiKey, keyMask: k.apiKey ? '••••' + k.apiKey.slice(-4) : '' })) }, ctx);
});

router.post('/api/admin/official/publish', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (!await canPublishAnnouncement(env, user)) forbid('仅超级管理员或官方账号可发布官方消息');
  const title = String(body.title || '').trim();
  const text = String(body.body || body.text || '').trim();
  if (!title || !text) bad('标题与正文均不能为空');
  const id = 'ann_' + sortableId();
  const ann = {
    id, title, body: text, pinned: !!body.pinned,
    createdAt: nowMs(), authorId: user.id,
    authorName: user.displayName || user.username, official: isOfficialAccount(user),
  };
  await KV.putJSON(env, `ann:${id}`, ann);
  await writeAudit(env, user, 'official.publish', title, '');
  // 若指定了已配置的外部 AI 产品密钥，则向其端点做一次 best-effort 广播
  let external = null;
  if (body.keyId) {
    const cfg = await getSiteConfig(env);
    const k = (cfg.officialKeys || []).find((x) => x.id === body.keyId && x.enabled && x.apiKey && x.endpoint);
    if (k) {
      try {
        const r = await fetch(k.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k.apiKey },
          body: JSON.stringify({ product: k.product, title, body: text, pinned: !!body.pinned, source: 'MarytOpens' }),
        });
        external = { ok: r.ok, status: r.status };
      } catch (e) { external = { ok: false, error: String(e.message || e).slice(0, 120) }; }
    }
  }
  return ok({ announcement: ann, external }, ctx);
});

/* ========================================================================== *
 * 20.8 用户代表选举（Task #3-1）
 * ========================================================================== */

router.post('/api/elections', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  await ensureGovernanceRoles(env);
  if (!await isSuperAdmin(env, user)) forbid('仅超级管理员可发起选举');
  const title = String(body.title || '').trim();
  if (!title) bad('选举标题不能为空');
  const id = 'el_' + sortableId();
  const el = {
    id, title, description: String(body.description || '').slice(0, 1000),
    scope: String(body.scope || 'global').slice(0, 40),
    status: 'open', maxWinners: clamp(body.maxWinners || 3, 1, 20),
    candidates: [], votes: {}, createdAt: nowMs(),
    endsAt: body.endsAt ? Number(body.endsAt) : 0, createdBy: user.id,
    results: [],
  };
  await KV.putJSON(env, `election:${id}`, el);
  await writeAudit(env, user, 'election.create', title, '');
  return ok({ election: el }, ctx);
});

router.get('/api/elections', async (ctx) => {
  const { env, user, url } = ctx;
  const status = url.searchParams.get('status') || '';
  const { keys, list_complete, cursor } = await KV.list(env, 'election:', 100, url.searchParams.get('cursor'));
  let items = (await KV.many(env, keys.map((k) => k.name))).filter(Boolean);
  if (status) items = items.filter((e) => e.status === status);
  items.sort((a, b) => b.createdAt - a.createdAt);
  const out = items.map((e) => ({
    id: e.id, title: e.title, description: e.description, scope: e.scope,
    status: e.status, maxWinners: e.maxWinners, createdAt: e.createdAt, endsAt: e.endsAt,
    candidateCount: e.candidates.length, voteCount: Object.keys(e.votes || {}).length,
    candidates: e.candidates.slice(0, 50),
    myVote: user ? (e.votes && e.votes[user.id]) || null : null,
    results: e.status === 'closed' ? e.results : null,
  }));
  return ok({ items: out, cursor: list_complete ? null : cursor }, ctx);
});

async function electionDetail(env, e, user) {
  const cand = [];
  for (const cid of (e.candidates || [])) {
    const u = await getUser(env, cid);
    if (!u) continue;
    cand.push({ id: u.id, username: u.username, displayName: u.displayName || u.username, avatar: u.avatar, roleTags: await roleTagsOf(env, u, 'global'), official: !!u.official });
  }
  const tally = {};
  for (const v of Object.values(e.votes || {})) tally[v] = (tally[v] || 0) + 1;
  cand.forEach((c) => { c.votes = tally[c.id] || 0; });
  return {
    id: e.id, title: e.title, description: e.description, scope: e.scope,
    status: e.status, maxWinners: e.maxWinners, createdAt: e.createdAt, endsAt: e.endsAt,
    candidates: cand, totalVotes: Object.keys(e.votes || {}).length,
    myVote: user ? (e.votes && e.votes[user.id]) || null : null,
    results: e.status === 'closed' ? e.results : null,
  };
}

router.get('/api/elections/:id', async (ctx) => {
  const { env, user, params } = ctx;
  const e = await KV.getJSON(env, `election:${params.id}`);
  if (!e) notfound('选举不存在');
  return ok({ election: await electionDetail(env, e, user) }, ctx);
});

router.post('/api/elections/:id/nominate', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const e = await KV.getJSON(env, `election:${params.id}`);
  if (!e) notfound('选举不存在');
  if (e.status !== 'open') bad('选举已结束，无法提名');
  const uid2 = String(body.userId || user.id);
  if (uid2 !== user.id && !(await isSuperAdmin(env, user))) forbid('仅可提名自己或（超管）指定他人');
  const cand = await getUser(env, uid2);
  if (!cand) notfound('被提名人不存在');
  if (cand.flags?.banned) bad('被封禁用户不可参选');
  if (!e.candidates.includes(cand.id)) { e.candidates.push(cand.id); await KV.putJSON(env, `election:${params.id}`, e); }
  return ok({ election: await electionDetail(env, e, user) }, ctx);
});

router.post('/api/elections/:id/vote', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const e = await KV.getJSON(env, `election:${params.id}`);
  if (!e) notfound('选举不存在');
  if (e.status !== 'open') bad('选举已结束，无法投票');
  if (e.endsAt && e.endsAt < nowMs()) bad('选举已过期');
  const cid = String(body.candidateId || '');
  if (!e.candidates.includes(cid)) bad('候选人不存在于本次选举');
  e.votes = e.votes || {};
  e.votes[user.id] = cid;
  await KV.putJSON(env, `election:${params.id}`, e);
  return ok({ election: await electionDetail(env, e, user) }, ctx);
});

async function addGlobalRole(u, roleId) {
  const g = new Set(u.roles?.global || ['role_member']);
  g.add('role_member'); g.add(roleId);
  u.roles = { ...(u.roles || {}), global: [...g] };
}
async function removeGlobalRole(u, roleId) {
  const g = (u.roles?.global || []).filter((r) => r !== roleId);
  if (!g.includes('role_member')) g.push('role_member');
  u.roles = { ...(u.roles || {}), global: g };
}

router.post('/api/elections/:id/close', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  if (!await isSuperAdmin(env, user)) forbid('仅超级管理员可结算选举');
  const e = await KV.getJSON(env, `election:${params.id}`);
  if (!e) notfound('选举不存在');
  if (e.status === 'closed') bad('选举已结算');
  const tally = {};
  for (const v of Object.values(e.votes || {})) tally[v] = (tally[v] || 0) + 1;
  const ranked = Object.entries(tally).map(([cid, n]) => ({ cid, n })).sort((a, b) => b.n - a.n);
  const winners = ranked.slice(0, e.maxWinners).filter((w) => w.n > 0);
  for (const w of winners) {
    const u = await getUser(env, w.cid);
    if (!u) continue;
    addGlobalRole(u, 'role_representative');
    await saveUser(env, u);
    await saveMember(env, 'global', u.id, { roles: [...new Set([...(u.roles.global)])] });
    await pushNotification(env, u.id, { type: 'election', title: '恭喜当选用户代表', body: `你在「${e.title}」选举中当选，获得用户代表身份。`, link: '/governance.html' });
  }
  e.status = 'closed';
  e.results = winners;
  await KV.putJSON(env, `election:${params.id}`, e);
  await writeAudit(env, user, 'election.close', e.title, JSON.stringify(winners));
  return ok({ election: await electionDetail(env, e, user) }, ctx);
});

router.delete('/api/elections/:id', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  if (!await isSuperAdmin(env, user)) forbid('仅超级管理员可删除选举');
  await KV.del(env, `election:${params.id}`);
  return ok({ ok: true }, ctx);
});

/* ========================================================================== *
 * 20.9 风纪委员会 + 申诉（Task #3-2）
 * ========================================================================== */

const SHORT_MUTE_MAX = 24 * 3600 * 1000; // 24h 内的短禁言无需确认

async function applySanction(env, s, actor) {
  // s: { type, targetType, targetId, durationMs, reason }
  if (s.type === 'warn') {
    if (s.targetType === 'user') {
      const u = await getUser(env, s.targetId);
      if (u) await pushNotification(env, u.id, { type: 'moderation', title: '警告通知', body: '你收到一条社区警告：' + (s.reason || ''), link: '/governance.html' });
    }
    return { applied: true, type: 'warn' };
  }
  if (s.type === 'mute') {
    const until = nowMs() + (s.durationMs || SHORT_MUTE_MAX);
    const u = await getUser(env, s.targetId);
    if (u) {
      u.flags = u.flags || {};
      u.flags.mutedUntil = until;
      await saveUser(env, u);
      await pushNotification(env, u.id, { type: 'moderation', title: '你已被禁言', body: `禁言至 ${new Date(until).toLocaleString()}` + (s.reason ? '：' + s.reason : ''), link: '/governance.html' });
    }
    return { applied: true, type: 'mute', until };
  }
  if (s.type === 'ban') {
    const u = await getUser(env, s.targetId);
    if (u && !u.protected) {
      u.flags = u.flags || {};
      u.flags.banned = true; u.flags.bannedReason = s.reason || '违规'; u.flags.bannedAt = nowMs();
      u.flags.bannedUntil = s.durationMs ? nowMs() + s.durationMs : 0;
      await saveUser(env, u);
      await pushNotification(env, u.id, { type: 'moderation', title: '你的账号已被封禁', body: s.reason || '违反社区规范', link: '/governance.html' });
      return { applied: true, type: 'ban' };
    }
    return { applied: false, type: 'ban', skipped: u ? 'protected' : 'notfound' };
  }
  if (s.type === 'delete') {
    if (s.targetType === 'post') {
      const p = await KV.getJSON(env, `post:${s.targetId}`);
      if (p) { p.status = 'deleted'; p.deletedBy = actor?.id || ''; await KV.putJSON(env, `post:${s.targetId}`, p); return { applied: true, type: 'delete' }; }
    } else if (s.targetType === 'comment') {
      const c = await KV.getJSON(env, `comment:${s.targetId}`);
      if (c) { c.deleted = true; c.deletedBy = actor?.id || ''; await KV.putJSON(env, `comment:${s.targetId}`, c); return { applied: true, type: 'delete' }; }
    }
    return { applied: false, type: 'delete' };
  }
  return { applied: false };
}

async function revertSanction(env, s) {
  if (s.type === 'mute') {
    const u = await getUser(env, s.targetId);
    if (u) { u.flags = u.flags || {}; u.flags.mutedUntil = 0; await saveUser(env, u); }
  } else if (s.type === 'ban') {
    const u = await getUser(env, s.targetId);
    if (u) { u.flags = u.flags || {}; u.flags.banned = false; u.flags.bannedUntil = 0; u.flags.bannedReason = ''; await saveUser(env, u); }
  } else if (s.type === 'delete') {
    if (s.targetType === 'post') {
      const p = await KV.getJSON(env, `post:${s.targetId}`);
      if (p) { p.status = p.status === 'deleted' ? 'published' : p.status; delete p.deletedBy; await KV.putJSON(env, `post:${s.targetId}`, p); }
    } else if (s.targetType === 'comment') {
      const c = await KV.getJSON(env, `comment:${s.targetId}`);
      if (c) { c.deleted = false; delete c.deletedBy; await KV.putJSON(env, `comment:${s.targetId}`, c); }
    }
  }
}

function canConfirmDiscipline(env, user) {
  if (!user) return false;
  return isSuperAdmin(env, user).then((sa) => sa || hasPerm(env, user, 'site.admin') || isOfficialAccount(user));
}

router.post('/api/discipline/cases', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  const targetType = ['post', 'comment', 'user'].includes(body.targetType) ? body.targetType : 'post';
  const targetId = String(body.targetId || '');
  if (!targetId) bad('请指定处理对象');
  const reason = String(body.reason || '').trim().slice(0, 500);
  if (!reason) bad('请填写原因');
  const sType = ['warn', 'mute', 'ban', 'delete'].includes(body.proposedSanction?.type) ? body.proposedSanction.type : 'warn';
  const durationMs = sType === 'mute' || sType === 'ban' ? clamp(Number(body.proposedSanction?.durationMs) || 0, 0, 365 * 86400000) : 0;
  const sanction = { type: sType, targetType, targetId, durationMs, reason: reason };
  // 短禁言与警告：立即生效，无需确认；其余需站长/超管/官方账号确认
  const needsConfirm = !(sType === 'warn' || (sType === 'mute' && durationMs <= SHORT_MUTE_MAX));
  const id = 'dc_' + sortableId();
  const c = {
    id, reporterId: user.id, targetType, targetId, reason,
    proposedSanction: sanction, status: needsConfirm ? 'pending' : 'confirmed',
    applied: !needsConfirm, appliedAt: needsConfirm ? 0 : nowMs(),
    createdAt: nowMs(), confirmedBy: needsConfirm ? '' : user.id,
    rejected: false, appeal: null, log: [{ at: nowMs(), by: user.id, action: needsConfirm ? 'open' : 'auto-applied' }],
  };
  await KV.putJSON(env, `discipline:${id}`, c);
  if (!needsConfirm) await applySanction(env, sanction, user);
  await writeAudit(env, user, 'discipline.open', targetType + ':' + targetId, reason.slice(0, 120));
  return ok({ case: c }, ctx);
});

router.get('/api/discipline/cases', async (ctx) => {
  const { env, user, url } = ctx;
  if (!user) unauth();
  const status = url.searchParams.get('status') || '';
  const queue = url.searchParams.get('queue') === '1';
  const mine = url.searchParams.get('mine') === '1';
  const { keys, list_complete, cursor } = await KV.list(env, 'discipline:', 100, url.searchParams.get('cursor'));
  let items = (await KV.many(env, keys.map((k) => k.name))).filter(Boolean);
  if (status) items = items.filter((c) => c.status === status);
  if (queue) items = items.filter((c) => c.status === 'pending');
  if (mine) items = items.filter((c) => c.reporterId === user.id);
  items.sort((a, b) => b.createdAt - a.createdAt);
  const out = [];
  for (const c of items) {
    const reporter = await getUser(env, c.reporterId);
    let target = null;
    if (c.targetType === 'user') { const u = await getUser(env, c.targetId); if (u) target = { type: 'user', id: u.id, name: u.displayName || u.username }; }
    else if (c.targetType === 'post') { const p = await KV.getJSON(env, `post:${c.targetId}`); if (p) target = { type: 'post', id: p.id, name: p.title || '(无标题)' }; }
    else if (c.targetType === 'comment') { const cm = await KV.getJSON(env, `comment:${c.targetId}`); if (cm) target = { type: 'comment', id: cm.id, name: (cm.text || '').slice(0, 40) }; }
    out.push({
      id: c.id, targetType: c.targetType, target, reason: c.reason,
      proposedSanction: c.proposedSanction, status: c.status, applied: !!c.applied,
      createdAt: c.createdAt, reporter: reporter ? { id: reporter.id, name: reporter.displayName || reporter.username } : null,
      appeal: c.appeal,
    });
  }
  return ok({ items: out, cursor: list_complete ? null : cursor }, ctx);
});

router.post('/api/discipline/cases/:id/confirm', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  if (!(await canConfirmDiscipline(env, user))) forbid('仅站长/超级管理员/官方账号可确认制裁');
  const c = await KV.getJSON(env, `discipline:${params.id}`);
  if (!c) notfound('案件不存在');
  if (c.status === 'confirmed') bad('该案件已生效');
  if (c.status === 'rejected') bad('该案件已被驳回');
  const r = await applySanction(env, c.proposedSanction, user);
  c.status = 'confirmed'; c.applied = r.applied !== false; c.appliedAt = nowMs(); c.confirmedBy = user.id;
  c.log.push({ at: nowMs(), by: user.id, action: 'confirm' });
  await KV.putJSON(env, `discipline:${params.id}`, c);
  await writeAudit(env, user, 'discipline.confirm', c.targetType + ':' + c.targetId, '');
  return ok({ case: c }, ctx);
});

router.post('/api/discipline/cases/:id/reject', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  if (!(await canConfirmDiscipline(env, user))) forbid('仅站长/超级管理员/官方账号可驳回');
  const c = await KV.getJSON(env, `discipline:${params.id}`);
  if (!c) notfound('案件不存在');
  c.status = 'rejected'; c.rejected = true;
  c.log.push({ at: nowMs(), by: user.id, action: 'reject' });
  await KV.putJSON(env, `discipline:${params.id}`, c);
  await writeAudit(env, user, 'discipline.reject', c.targetType + ':' + c.targetId, '');
  return ok({ case: c }, ctx);
});

router.post('/api/discipline/cases/:id/appeal', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const c = await KV.getJSON(env, `discipline:${params.id}`);
  if (!c) notfound('案件不存在');
  if (c.status !== 'confirmed' && c.status !== 'pending') bad('当前状态不可申诉');
  // 仅被处理对象本人或举报人可申诉
  const isTarget = c.targetType === 'user' && c.targetId === user.id;
  const isReporter = c.reporterId === user.id;
  if (!isTarget && !isReporter) forbid('仅被处理人或举报人可发起申诉');
  const reason = String(body.reason || '').trim().slice(0, 500);
  if (!reason) bad('请填写申诉理由');
  c.status = 'appealed';
  c.appeal = { reason, by: user.id, at: nowMs(), resolution: null };
  c.log.push({ at: nowMs(), by: user.id, action: 'appeal' });
  await KV.putJSON(env, `discipline:${params.id}`, c);
  return ok({ case: c }, ctx);
});

router.post('/api/discipline/cases/:id/appeal/resolve', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  if (!(await canConfirmDiscipline(env, user))) forbid('仅站长/超级管理员/官方账号可裁定申诉');
  const c = await KV.getJSON(env, `discipline:${params.id}`);
  if (!c) notfound('案件不存在');
  if (c.status !== 'appealed' || !c.appeal) bad('没有待裁定的申诉');
  const uphold = body.uphold !== false;
  c.appeal.resolution = uphold ? 'upheld' : 'overturned';
  c.status = uphold ? 'confirmed' : 'closed';
  if (!uphold && c.applied) { await revertSanction(env, c.proposedSanction); c.applied = false; }
  c.log.push({ at: nowMs(), by: user.id, action: uphold ? 'appeal-upheld' : 'appeal-overturned' });
  await KV.putJSON(env, `discipline:${params.id}`, c);
  await writeAudit(env, user, 'discipline.appeal.resolve', c.targetType + ':' + c.targetId, uphold ? 'upheld' : 'overturned');
  return ok({ case: c }, ctx);
});

/* ---------------- 风纪委员会成员管理（由管理层从用户代表中任命） ---------------- */

router.get('/api/admin/discipline/members', async (ctx) => {
  const { env, user } = ctx;
  if (!user) unauth();
  if (!await canConfirmDiscipline(env, user)) forbid('无权限');
  const { keys } = await KV.list(env, 'user:', 500);
  const items = [];
  for (const k of keys) {
    const u = await KV.getJSON(env, k.name);
    if (!u || u.flags?.deleted) continue;
    if ((u.roles?.global || []).includes('role_discipline')) {
      items.push({ id: u.id, username: u.username, displayName: u.displayName || u.username, avatar: u.avatar, badges: u.badges || [] });
    }
  }
  return ok({ items }, ctx);
});

router.put('/api/admin/discipline/members', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (!await isSuperAdmin(env, user)) forbid('仅超级管理员可任免风纪委员');
  await ensureGovernanceRoles(env);
  const target = await getUser(env, String(body.userId || ''));
  if (!target) notfound('用户不存在');
  const action = body.action === 'remove' ? 'remove' : 'add';
  if (action === 'add') {
    if (!(target.roles?.global || []).includes('role_representative')) addGlobalRole(target, 'role_representative');
    addGlobalRole(target, 'role_discipline');
  } else {
    removeGlobalRole(target, 'role_discipline');
  }
  await saveUser(env, target);
  await saveMember(env, 'global', target.id, { roles: [...new Set([...(target.roles.global)])] });
  await pushNotification(env, target.id, { type: 'system', title: action === 'add' ? '你被任命为风纪委员' : '你已被免去风纪委员职务', body: '', link: '/governance.html' });
  await writeAudit(env, user, 'discipline.member.' + action, target.username, '');
  return ok({ user: { id: target.id, roles: target.roles } }, ctx);
});

/* ========================================================================== *
 * 20.5 投稿 / 客服中心 / 站内信 / Codespace / 技术工具（全部 D1 真表）
 * -------------------------------------------------------------------------- *
 * 数据表（env.DB1）：submissions / tickets / ticket_messages / letters /
 *                    codespaces / site_meta（替代原 KV 键）
 * 说明：本站统一用 D1 关系表存储，不再使用 KV 语义（JSON blob + 扫描索引键）。
 * ========================================================================== */

const SUB_STATUS = ['pending', 'approved', 'rejected', 'withdrawn'];
const SUB_CATEGORIES = ['article', 'news', 'tutorial', 'opinion', 'art', 'other'];

/** 谁可以审稿：超管 / 官方账号 / 站点管理员 / 拥有内容审核权 */
async function canReviewSubmission(env, user) {
  if (!user) return false;
  if (await isSuperAdmin(env, user)) return true;
  if (user.official) return true;
  if ((user.roles?.global || []).includes('role_admin')) return true;
  return hasPerm(env, user, 'content.audit', 'global');
}

/** 客服坐席：与审稿同级，另允许「用户代表」参与客服 */
async function canHandleTicket(env, user) {
  if (!user) return false;
  if (await canReviewSubmission(env, user)) return true;
  return (user.roles?.global || []).includes('role_representative');
}


/* ========================================================================== *
 * 20.5 / 20.6 投稿 · 客服工单 · OAuth 提供方（本站作为身份提供者）
 * -------------------------------------------------------------------------- *
 * 全部走 env.DB1 真表（#234）：kv_store 单表 LIKE 扫描不适合这类结构化数据，
 * 且会消耗 KV 写配额。数据模型：
 *   oauth_apps / oauth_codes / oauth_tokens / oauth_grants  —— OAuth IdP
 *   submissions                                          —— 用户投稿（待审核）
 *   tickets                                             —— 客服工单
 * 注：OAuth 定位是「别人接入我们的 API」——第三方站点用本站账号登录，
 *     本站是身份提供方（IdP），不是去登录别家。
 * ========================================================================== */

async function ensureFeatureSchema(env) {
  if (!env.DB1) return;
  const sqls = [
    `CREATE TABLE IF NOT EXISTS oauth_apps (id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, name TEXT NOT NULL, description TEXT, homepage TEXT, logo TEXT, redirect_uris TEXT NOT NULL, scopes TEXT NOT NULL, owner_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, stats TEXT)`,
    `CREATE TABLE IF NOT EXISTS oauth_codes (code_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, user_id TEXT NOT NULL, scopes TEXT NOT NULL, redirect_uri TEXT, challenge TEXT, method TEXT, ver INTEGER, exp INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS oauth_tokens (token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, client_id TEXT NOT NULL, user_id TEXT NOT NULL, scopes TEXT NOT NULL, ver INTEGER, exp INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS oauth_grants (user_id TEXT NOT NULL, client_id TEXT NOT NULL, name TEXT, logo TEXT, scopes TEXT NOT NULL, created_at INTEGER NOT NULL, last_used INTEGER NOT NULL, PRIMARY KEY (user_id, client_id))`,
    `CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, author_id TEXT, author_name TEXT, title TEXT, content TEXT, summary TEXT DEFAULT '', category TEXT DEFAULT 'article', tags TEXT DEFAULT '[]', cover TEXT DEFAULT '', status TEXT DEFAULT 'pending', created_at INTEGER, updated_at INTEGER, reviewer_id TEXT, note TEXT, post_id TEXT DEFAULT '', anonymous INTEGER DEFAULT 0, word_count INTEGER DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, user_id TEXT, user_name TEXT, email TEXT, subject TEXT, body TEXT, status TEXT DEFAULT 'open', priority TEXT DEFAULT 'normal', category TEXT DEFAULT 'other', contact TEXT DEFAULT '', created_at INTEGER, updated_at INTEGER, assignee_id TEXT, last_reply_at INTEGER, message_count INTEGER DEFAULT 0, unread_for_user INTEGER DEFAULT 0, unread_for_staff INTEGER DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS ticket_messages (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, from_role TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, body TEXT NOT NULL, internal INTEGER DEFAULT 0, created_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS ix_ticket_msgs ON ticket_messages(ticket_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS letters (id TEXT PRIMARY KEY, sid TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, system INTEGER DEFAULT 0, starred INTEGER DEFAULT 0, read INTEGER DEFAULT 0, reply_to TEXT DEFAULT '', deleted_for_sender INTEGER DEFAULT 0, deleted_for_recipient INTEGER DEFAULT 0, created_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS ix_letters_to ON letters(to_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS ix_letters_from ON letters(from_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS codespaces (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT DEFAULT '', language TEXT DEFAULT 'javascript', code TEXT NOT NULL, public INTEGER DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS ix_codespaces_owner ON codespaces(owner_id, updated_at)`,
    `CREATE TABLE IF NOT EXISTS site_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS meowchat_messages (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, seq INTEGER NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS ix_meowchat_room_seq ON meowchat_messages(room_id, seq)`,
    `CREATE TABLE IF NOT EXISTS designs (id TEXT PRIMARY KEY, author_id TEXT, author_name TEXT, campaign_id TEXT DEFAULT '', kind TEXT DEFAULT 'title', name TEXT, summary TEXT DEFAULT '', spec TEXT DEFAULT '{}', image TEXT DEFAULT '', status TEXT DEFAULT 'pending', votes INTEGER DEFAULT 0, anonymous INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER, reviewer_id TEXT DEFAULT '', note TEXT DEFAULT '', adopted_id TEXT DEFAULT '', rewarded INTEGER DEFAULT 0)`,
    `CREATE INDEX IF NOT EXISTS ix_designs_status ON designs(status, votes)`,
    `CREATE INDEX IF NOT EXISTS ix_designs_author ON designs(author_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS design_votes (design_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (design_id, user_id))`,
    `CREATE INDEX IF NOT EXISTS ix_design_votes_user ON design_votes(user_id, created_at)`,
  ];
  for (const s of sqls) { try { await env.DB1.prepare(s).run(); } catch (e) { console.error('[schema]', e?.message || e); } }
  // 兼容已存在的旧表：补齐可能缺失的列（失败即说明已存在，忽略）
  const alters = [
    `ALTER TABLE submissions ADD COLUMN summary TEXT DEFAULT ''`,
    `ALTER TABLE submissions ADD COLUMN tags TEXT DEFAULT '[]'`,
    `ALTER TABLE submissions ADD COLUMN cover TEXT DEFAULT ''`,
    `ALTER TABLE submissions ADD COLUMN anonymous INTEGER DEFAULT 0`,
    `ALTER TABLE submissions ADD COLUMN word_count INTEGER DEFAULT 0`,
    `ALTER TABLE submissions ADD COLUMN post_id TEXT DEFAULT ''`,
    `ALTER TABLE tickets ADD COLUMN category TEXT DEFAULT 'other'`,
    `ALTER TABLE tickets ADD COLUMN contact TEXT DEFAULT ''`,
    `ALTER TABLE tickets ADD COLUMN last_reply_at INTEGER`,
    `ALTER TABLE tickets ADD COLUMN message_count INTEGER DEFAULT 0`,
    `ALTER TABLE tickets ADD COLUMN unread_for_user INTEGER DEFAULT 0`,
    `ALTER TABLE tickets ADD COLUMN unread_for_staff INTEGER DEFAULT 0`,
  ];
  for (const a of alters) { try { await env.DB1.prepare(a).run(); } catch (_) {} }
}
const jsonOr = (def, s) => { try { const v = JSON.parse(s); return v ?? def; } catch { return def; } };
function oauthSafeUrl(u) { try { const x = new URL(String(u || '')); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; } catch { return ''; } }

/* 站点配置（统一存入 D1 site_meta，替代 KV cfg:* 散落键） */
async function getMeta(env, k, def = null) {
  if (!env.DB1) return def;
  const r = await env.DB1.prepare('SELECT v FROM site_meta WHERE k = ?').bind(k).first();
  if (!r) return def;
  try { return JSON.parse(r.v); } catch { return r.v; }
}
async function setMeta(env, k, v) {
  if (!env.DB1) return;
  const s = JSON.stringify(v);
  await env.DB1.prepare('INSERT INTO site_meta (k, v, updated_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at')
    .bind(k, s, nowMs()).run();
}

/* ------------------------------ 20.5 投稿（D1 真表） ------------------------------ */

async function subCardD1(env, r, viewer) {
  const author = (!r.author_id) ? null : await getUser(env, r.author_id);
  const mine = !!viewer && viewer.id === r.author_id;
  const canSeeContact = !!viewer && (mine || (await canReviewSubmission(env, viewer)));
  return {
    id: r.id, title: r.title, summary: r.summary || '', category: r.category, tags: jsonOr([], r.tags),
    cover: r.cover || '', status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
    anonymous: !!r.anonymous, wordCount: r.word_count || 0,
    reviewNote: r.note || '', reviewedAt: r.reviewed_at || 0, postId: r.post_id || '',
    author: author ? { id: author.id, username: author.username, displayName: author.displayName, avatar: author.avatar || '' } : null,
    mine,
    contact: canSeeContact ? (r.contact || '') : undefined,
  };
}

router.post('/api/submissions', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (await isMuted(env, user, 'global')) forbid('你当前处于禁言状态，无法投稿');
  await guardRate(env, `sub:${user.id}`, 5, 3600, '投稿过于频繁，请稍后再试');
  const title = String(body.title || '').trim().slice(0, 200);
  if (title.length < 2) bad('标题至少 2 个字符');
  const content = sanitizeContent(body.content || '', 120000);
  if (content.trim().length < 20) bad('正文至少 20 个字符');
  const id = uid('sub'); const now = nowMs();
  const rec = {
    id, author_id: user.id, author_name: user.displayName || user.username,
    title, content,
    summary: String(body.summary || content.replace(/[#*`>\-\[\]!]/g, '')).trim().slice(0, 200),
    category: SUB_CATEGORIES.includes(body.category) ? body.category : 'article',
    tags: JSON.stringify((Array.isArray(body.tags) ? body.tags : []).slice(0, 8).map((t) => String(t).slice(0, 24))),
    cover: String(body.cover || '').slice(0, 500),
    contact: String(body.contact || '').slice(0, 200),
    anonymous: body.anonymous === true ? 1 : 0,
    word_count: content.replace(/\s+/g, '').length,
    status: 'pending', note: '', reviewer_id: '', post_id: '',
    created_at: now, updated_at: now,
  };
  const cols = Object.keys(rec).join(',');
  const placeholders = Object.keys(rec).map(() => '?').join(',');
  await env.DB1.prepare(`INSERT INTO submissions (${cols}) VALUES (${placeholders})`).bind(...Object.values(rec)).run();
  await writeAudit(env, user, 'submission.create', id, title);
  ctx.waitUntil((async () => {
    try {
      const targets = new Set();
      const oa = await getOfficialAccount(env);
      if (oa) targets.add(oa.id);
      const sa = await getMeta(env, 'superadmin', null);
      if (sa && sa.id) targets.add(sa.id);
      for (const t of targets) {
        if (t === user.id) continue;
        await pushNotification(env, t, { type: 'submission', title: '收到新的投稿', body: title, link: `/submissions.html?id=${id}`, refId: id, actor: rec.anonymous ? null : { id: user.id, name: user.displayName, avatar: user.avatar } });
      }
    } catch (_) {}
  })());
  return ok({ id, status: 'pending' }, ctx);
});

router.get('/api/submissions', async (ctx) => {
  const { env, user, url } = ctx;
  if (!user) unauth();
  const reviewer = await canReviewSubmission(env, user);
  const mine = url.searchParams.get('mine') === '1';
  const limit = clamp(parseInt(url.searchParams.get('limit') || '30', 10), 1, 100);
  const status = url.searchParams.get('status') || '';
  let rows;
  if (mine && !reviewer) {
    rows = (SUB_STATUS.includes(status))
      ? (await env.DB1.prepare('SELECT * FROM submissions WHERE author_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?').bind(user.id, status, limit).all()).results || []
      : (await env.DB1.prepare('SELECT * FROM submissions WHERE author_id = ? ORDER BY created_at DESC LIMIT ?').bind(user.id, limit).all()).results || [];
  } else {
    if (!reviewer) forbid('仅审稿人可查看全部投稿');
    rows = (SUB_STATUS.includes(status))
      ? (await env.DB1.prepare('SELECT * FROM submissions WHERE status = ? ORDER BY created_at DESC LIMIT ?').bind(status, limit).all()).results || []
      : (await env.DB1.prepare('SELECT * FROM submissions ORDER BY created_at DESC LIMIT ?').bind(limit).all()).results || [];
  }
  // subCardD1 是 async：必须 await 展开，否则 JSON 序列化出一堆空对象
  return ok({ items: await Promise.all(rows.map((r) => subCardD1(env, r, user))), canReview: reviewer }, ctx);
});

router.get('/api/submissions/:id', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const r = await env.DB1.prepare('SELECT * FROM submissions WHERE id = ?').bind(params.id).first();
  if (!r) notfound('投稿不存在');
  const reviewer = await canReviewSubmission(env, user);
  if (r.author_id !== user.id && !reviewer) forbid('无权查看该投稿');
  return ok({ submission: { ...(await subCardD1(env, r, user)), content: r.content }, canReview: reviewer }, ctx);
});

router.post('/api/admin/submissions/:id/review', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  if (!(await canReviewSubmission(env, user))) forbid('仅审稿人可处理投稿');
  const r = await env.DB1.prepare('SELECT * FROM submissions WHERE id = ?').bind(params.id).first();
  if (!r) notfound('投稿不存在');
  if (r.status !== 'pending') conflict('该投稿已被处理');
  const decision = String(body.decision || '');
  if (decision !== 'approve' && decision !== 'reject') bad('decision 必须是 approve 或 reject');
  const note = String(body.note || '').slice(0, 500);
  const now = nowMs();
  let postId = '';
  if (decision === 'approve') {
    const author = await getUser(env, r.author_id);
    if (!author) bad('投稿人账号已不存在');
    const pid = uid('p'); const psid = sortableId();
    const post = {
      id: pid, sid: psid, slug: slugify(r.title),
      title: r.title, content: r.content, format: 'markdown',
      excerpt: String(r.summary || '').slice(0, 200),
      cover: r.cover || '',
      tags: [...jsonOr([], r.tags), '投稿'].slice(0, 8),
      board: String(body.board || 'general').slice(0, 40),
      groupId: '', scope: 'global',
      visibility: 'public', visibleRoles: [],
      authorId: author.id, status: 'published',
      kind: 'article',
      official: !!body.official && (await canPublishAnnouncement(env, user)),
      isAnnouncement: false,
      encrypted: false, enc: '',
      burnAfterRead: false, burnViews: 0, burnViewsLeft: 0,
      pinned: false, featured: !!body.featured, locked: false,
      fromSubmission: r.id,
      counts: { views: 0, likes: 0, comments: 0, favorites: 0 },
      createdAt: now, updatedAt: now,
    };
    await KV.putJSON(env, `post:${pid}`, post);
    await env.DB.put(`ixp:all:${psid}`, pid, { metadata: { t: post.createdAt, a: author.id, v: 'public' } });
    await env.DB.put(`ixp:user:${author.id}:${psid}`, pid);
    await env.DB.put(`ixp:board:${post.board}:${psid}`, pid);
    await env.DB.put(`ixp:scope:global:${psid}`, pid);
    author.stats = author.stats || {};
    author.stats.posts = (author.stats.posts || 0) + 1;
    await saveUser(env, author);
    bumpStatLazy('posts');
    postId = pid;
  }
  await env.DB1.prepare('UPDATE submissions SET status = ?, note = ?, reviewer_id = ?, post_id = ?, updated_at = ? WHERE id = ?')
    .bind(decision === 'approve' ? 'approved' : 'rejected', note, user.id, postId, now, params.id).run();
  await writeAudit(env, user, 'submission.review', params.id, `${decision}:${note}`);
  if (r.author_id) { try { await pushNotification(env, r.author_id, { type: 'submission', title: decision === 'approve' ? '你的投稿已通过' : '你的投稿未通过', body: r.title + (note ? `（${note}）` : ''), link: postId ? `/post.html?id=${postId}` : `/submissions.html?id=${r.id}`, refId: r.id }); } catch (_) {} }
  return ok({ id: params.id, status: decision === 'approve' ? 'approved' : 'rejected', postId }, ctx);
});

router.post('/api/submissions/:id/withdraw', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const r = await env.DB1.prepare('SELECT * FROM submissions WHERE id = ?').bind(params.id).first();
  if (!r) notfound('投稿不存在');
  if (r.author_id !== user.id) forbid('只能撤回自己的投稿');
  if (r.status !== 'pending') bad('该投稿已处理，无法撤回');
  await env.DB1.prepare("UPDATE submissions SET status = 'withdrawn', updated_at = ? WHERE id = ?").bind(nowMs(), params.id).run();
  return ok({ id: params.id, status: 'withdrawn' }, ctx);
});

router.delete('/api/submissions/:id', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const r = await env.DB1.prepare('SELECT * FROM submissions WHERE id = ?').bind(params.id).first();
  if (!r) notfound('投稿不存在');
  const reviewer = await canReviewSubmission(env, user);
  if (r.author_id !== user.id && !reviewer) forbid('无权删除该投稿');
  await env.DB1.prepare('DELETE FROM submissions WHERE id = ?').bind(params.id).run();
  return ok({ deleted: params.id }, ctx);
});

/* ==========================================================================
 * 20.6 社区设计征集（D1 真表）
 * --------------------------------------------------------------------------
 * 面向全社区的公开征集：任何未被禁言的成员都能提交装扮设计（称号 / 头像框 /
 * 名片 / 气泡 / 礼物 / 表情），社区公开投票，超管审核通过后进入公示与投票，
 * 最终「采纳」写入官方目录并给设计者署名 + 发放 MO/经验/特约设计师称号。
 *
 * 安全约束（重要）：装扮类样式只能引用 FRAME/CARD/BUBBLE_CLASSES 白名单里的
 * class，颜色只接受 #RGB/#RRGGBB。绝不把投稿里的字符串当 CSS 用，否则任何
 * 成员都能通过投稿注入样式 —— 这是公开征集最容易踩的洞。
 * ========================================================================== */

const DESIGN_KINDS = ['title', 'frame', 'card', 'bubble', 'gift', 'emoji', 'other'];
const DESIGN_STATUS = ['pending', 'approved', 'rejected', 'adopted', 'withdrawn'];
/* 采纳后授予的「特约设计师」称号 */
const DESIGNER_TITLE = { id: 't_designer', name: '特约设计师', color: '#ec4899', icon: '🎨', desc: '作品被官方采纳的设计者', rare: true };

function defaultDesignCampaigns() {
  return [{
    id: 'dc_open',
    title: '常设征集 · 喵星装扮共创',
    desc: '欢迎提交称号、头像框、名片、气泡、礼物、表情的创意设计。通过初审即进入社区公开投票，被采纳的作品会署名上线，并获得 MO、经验与「特约设计师」称号。',
    kinds: ['title', 'frame', 'card', 'bubble', 'gift', 'emoji'],
    startAt: 0, endAt: 0, active: true,
    rewardMo: 20, rewardMeow: 30,     // 初审通过即发（每份设计仅一次）
    adoptMo: 500, adoptMeow: 800,     // 被采纳的额外奖励
    adoptTitle: true,                 // 采纳后是否颁发「特约设计师」称号
    maxPerUser: 10,                   // 每人在本次征集下的投稿上限（0 = 不限）
  }];
}
async function getDesignCampaigns(env) {
  const list = await getMeta(env, 'designCampaigns', null);
  return Array.isArray(list) && list.length ? list : defaultDesignCampaigns();
}
function campaignOpen(c, t = nowMs()) {
  if (!c || c.active === false) return false;
  if (c.startAt && t < c.startAt) return false;
  if (c.endAt && t > c.endAt) return false;
  return true;
}
function normalizeCampaign(c) {
  const num = (v, dv = 0) => (Number.isFinite(+v) ? Math.floor(+v) : dv);
  return {
    id: String(c?.id || '').trim().slice(0, 40) || uid('dc'),
    title: String(c?.title || '').trim().slice(0, 60),
    desc: String(c?.desc || '').slice(0, 600),
    kinds: (Array.isArray(c?.kinds) ? c.kinds : []).filter((k) => DESIGN_KINDS.includes(k)),
    startAt: Math.max(0, num(c?.startAt)),
    endAt: Math.max(0, num(c?.endAt)),
    active: c?.active !== false,
    rewardMo: clamp(num(c?.rewardMo), 0, 100000),
    rewardMeow: clamp(num(c?.rewardMeow), 0, 100000),
    adoptMo: clamp(num(c?.adoptMo), 0, 1000000),
    adoptMeow: clamp(num(c?.adoptMeow), 0, 1000000),
    adoptTitle: c?.adoptTitle !== false,
    maxPerUser: clamp(num(c?.maxPerUser), 0, 1000),
  };
}

/** 装扮类样式必须落在白名单内；不在白名单的一律视为「概念稿」（只有文字 + 参考图） */
function designSafeCls(kind, cls) {
  const s = String(cls || '');
  if (!s) return '';
  if (kind === 'frame') return FRAME_CLASSES.includes(s) ? s : '';
  if (kind === 'card') return CARD_CLASSES.includes(s) ? s : '';
  if (kind === 'bubble') return BUBBLE_CLASSES.includes(s) ? s : '';
  return '';
}
/** 颜色只允许 #RGB / #RRGGBB —— 拒绝 url()/expression()/var() 之类的注入载荷 */
function safeHexColor(v, dv = '#6366f1') {
  const s = String(v || '').trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s) ? s : dv;
}
/** 参考图：只接受站内相对路径或 https 外链 */
function safeImageUrl(v) {
  const s = String(v || '').trim().slice(0, 500);
  if (!s) return '';
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  try { const u = new URL(s); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; }
}
function designSpecOf(kind, raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    color: safeHexColor(o.color),
    color2: safeHexColor(o.color2, ''),
    icon: String(o.icon || '').slice(0, 4),
    cls: designSafeCls(kind, o.cls),
    price: clamp(Math.floor(Number(o.price) || 0), 0, 100000),
    rare: !!o.rare,
    note: String(o.note || '').slice(0, 300),
  };
}
async function designCardD1(env, r, viewer, votedSet = null) {
  const anon = !!r.anonymous;
  const author = (!anon && r.author_id) ? await getUser(env, r.author_id) : null;
  const canSeeReview = !!viewer && (viewer.id === r.author_id || (await canReviewSubmission(env, viewer)));
  return {
    id: r.id, kind: r.kind, name: r.name, summary: r.summary || '',
    spec: jsonOr({}, r.spec), image: r.image || '',
    status: r.status, votes: r.votes || 0,
    campaignId: r.campaign_id || '', anonymous: anon,
    createdAt: r.created_at, updatedAt: r.updated_at,
    adoptedId: r.adopted_id || '',
    reviewNote: canSeeReview ? (r.note || '') : undefined,
    author: author ? { id: author.id, username: author.username, displayName: author.displayName || author.username, avatar: author.avatar || '' } : null,
    authorName: anon ? '匿名设计师' : (r.author_name || ''),
    mine: !!viewer && viewer.id === r.author_id,
    voted: votedSet ? votedSet.has(r.id) : false,
  };
}
/** 我给哪些设计投过票（一次查询，避免 N+1） */
async function designVotedSet(env, userId, ids) {
  if (!userId || !ids.length) return new Set();
  const qs = ids.map(() => '?').join(',');
  const rows = (await env.DB1.prepare(`SELECT design_id FROM design_votes WHERE user_id = ? AND design_id IN (${qs})`)
    .bind(userId, ...ids).all()).results || [];
  return new Set(rows.map((r) => r.design_id));
}
/** 发放经济奖励（就地改用户对象，调用方负责 saveUser） */
function addEconomyInline(user, mo, meow) {
  const e = user.economy = user.economy || { mo: 0, meow: 0, checkin: { last: 0, streak: 0, count: 0, days: [] } };
  if (mo) e.mo = (e.mo || 0) + mo;
  if (meow) e.meow = (e.meow || 0) + meow;
  return e;
}

/* -------------------------- 征集活动：公开读 / 超管写 -------------------------- */

router.get('/api/designs/campaigns', async (ctx) => {
  const t = nowMs();
  const list = await getDesignCampaigns(ctx.env);
  return ok({
    items: list.map((c) => ({ ...c, open: campaignOpen(c, t) })),
    kinds: DESIGN_KINDS,
    palette: { frames: FRAME_CLASSES, cards: CARD_CLASSES, bubbles: BUBBLE_CLASSES },
  }, ctx);
});

router.put('/api/admin/designs/campaigns', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (!await isSuperAdmin(env, user)) forbid('仅超级管理员可配置征集活动');
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 30)
    .map(normalizeCampaign).filter((c) => c.title);
  await setMeta(env, 'designCampaigns', items);
  await writeAudit(env, user, 'designs.campaigns', '', `${items.length} campaigns`);
  return ok({ items }, ctx);
});

/* -------------------------- 投稿 / 浏览 / 投票 -------------------------- */

router.post('/api/designs', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (!env.DB1) return fail(503, 'NO_DB', '数据库未就绪', ctx);
  if (user.flags?.banned) forbid('账号已被封禁');
  if (await isMuted(env, user, 'global')) forbid('你当前处于禁言状态，无法投稿设计');
  await guardRate(env, `design:${user.id}`, 10, 3600, '投稿过于频繁，请稍后再试');

  const campaigns = await getDesignCampaigns(env);
  const campaignId = String(body.campaignId || '') || (campaigns.find((c) => campaignOpen(c))?.id || '');
  const camp = campaigns.find((c) => c.id === campaignId);
  if (!camp) return fail(404, 'NO_CAMPAIGN', '征集活动不存在', ctx);
  if (!campaignOpen(camp)) return fail(400, 'CLOSED', '该征集活动已结束或未开始', ctx);

  const kind = DESIGN_KINDS.includes(body.kind) ? body.kind : 'title';
  if (camp.kinds.length && !camp.kinds.includes(kind)) bad('该征集不接受此类型的设计');
  const name = String(body.name || '').trim().slice(0, 30);
  if (name.length < 2) bad('设计名称至少 2 个字符');
  const summary = sanitizeContent(String(body.summary || '').trim(), 1000);
  if (summary.length < 10) bad('设计说明至少 10 个字符');

  if (camp.maxPerUser) {
    const c = await env.DB1.prepare("SELECT COUNT(*) AS n FROM designs WHERE author_id = ? AND campaign_id = ? AND status != 'withdrawn'")
      .bind(user.id, camp.id).first();
    if ((c?.n || 0) >= camp.maxPerUser) return fail(400, 'TOO_MANY', `本次征集每人最多提交 ${camp.maxPerUser} 份设计`, ctx);
  }

  const id = uid('dz'); const now = nowMs();
  const rec = {
    id, author_id: user.id, author_name: user.displayName || user.username,
    campaign_id: camp.id, kind, name, summary,
    spec: JSON.stringify(designSpecOf(kind, body.spec)),
    image: safeImageUrl(body.image),
    status: 'pending', votes: 0,
    anonymous: body.anonymous === true ? 1 : 0,
    created_at: now, updated_at: now,
    reviewer_id: '', note: '', adopted_id: '', rewarded: 0,
  };
  const cols = Object.keys(rec).join(',');
  const ph = Object.keys(rec).map(() => '?').join(',');
  await env.DB1.prepare(`INSERT INTO designs (${cols}) VALUES (${ph})`).bind(...Object.values(rec)).run();
  await writeAudit(env, user, 'design.create', id, `${kind}:${name}`);
  ctx.waitUntil((async () => {
    try {
      const sa = await getMeta(env, 'superadmin', null);
      if (sa?.id && sa.id !== user.id) {
        await pushNotification(env, sa.id, {
          type: 'design', title: '收到新的设计投稿', body: `${name}（${kind}）`,
          link: `/designs.html?id=${id}`, refId: id,
        });
      }
    } catch (_) {}
  })());
  return ok({ id, status: 'pending' }, ctx);
});

/**
 * 列表：默认只公开 approved + adopted（公示与投票池）。
 * mine=1 看自己的全部；status=pending 需审核权限。
 * sort=votes|new
 */
router.get('/api/designs', async (ctx) => {
  const { env, user, url } = ctx;
  if (!env.DB1) return ok({ items: [], canReview: false }, ctx);
  const reviewer = user ? await canReviewSubmission(env, user) : false;
  const limit = clamp(parseInt(url.searchParams.get('limit') || '40', 10), 1, 100);
  const kind = DESIGN_KINDS.includes(url.searchParams.get('kind')) ? url.searchParams.get('kind') : '';
  const campaignId = String(url.searchParams.get('campaignId') || '').slice(0, 40);
  const mine = url.searchParams.get('mine') === '1';
  const status = url.searchParams.get('status') || '';
  const sort = url.searchParams.get('sort') === 'new' ? 'created_at DESC' : 'votes DESC, created_at DESC';

  const where = []; const args = [];
  if (mine) {
    if (!user) unauth();
    where.push('author_id = ?'); args.push(user.id);
    if (DESIGN_STATUS.includes(status)) { where.push('status = ?'); args.push(status); }
  } else if (DESIGN_STATUS.includes(status)) {
    // pending / rejected / withdrawn 属于审核视图，公开只放 approved / adopted
    if (!reviewer && !['approved', 'adopted'].includes(status)) forbid('仅审核人可查看该状态的设计');
    where.push('status = ?'); args.push(status);
  } else {
    where.push("status IN ('approved','adopted')");
  }
  if (kind) { where.push('kind = ?'); args.push(kind); }
  if (campaignId) { where.push('campaign_id = ?'); args.push(campaignId); }

  const sql = `SELECT * FROM designs${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY ${sort} LIMIT ?`;
  const rows = (await env.DB1.prepare(sql).bind(...args, limit).all()).results || [];
  const voted = await designVotedSet(env, user?.id, rows.map((r) => r.id));
  const pending = reviewer
    ? ((await env.DB1.prepare("SELECT COUNT(*) AS n FROM designs WHERE status = 'pending'").first())?.n || 0)
    : 0;
  return ok({
    items: await Promise.all(rows.map((r) => designCardD1(env, r, user, voted))),
    canReview: reviewer, pendingCount: pending,
  }, ctx);
});

router.get('/api/designs/:id', async (ctx) => {
  const { env, user, params } = ctx;
  if (!env.DB1) notfound('设计不存在');
  const r = await env.DB1.prepare('SELECT * FROM designs WHERE id = ?').bind(params.id).first();
  if (!r) notfound('设计不存在');
  const reviewer = user ? await canReviewSubmission(env, user) : false;
  if (!['approved', 'adopted'].includes(r.status) && r.author_id !== user?.id && !reviewer) {
    forbid('该设计尚未公示');
  }
  const voted = await designVotedSet(env, user?.id, [r.id]);
  return ok({ design: await designCardD1(env, r, user, voted), canReview: reviewer }, ctx);
});

/* 投票（一人一票，重复调用即取消） */
router.post('/api/designs/:id/vote', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  if (user.flags?.banned) forbid('账号已被封禁');
  await guardRate(env, `dvote:${user.id}`, 120, 3600, '投票过于频繁，请稍后再试');
  const r = await env.DB1.prepare('SELECT * FROM designs WHERE id = ?').bind(params.id).first();
  if (!r) notfound('设计不存在');
  if (!['approved', 'adopted'].includes(r.status)) bad('该设计尚未进入公开投票');
  const had = await env.DB1.prepare('SELECT 1 FROM design_votes WHERE design_id = ? AND user_id = ?')
    .bind(r.id, user.id).first();
  if (had) {
    await env.DB1.prepare('DELETE FROM design_votes WHERE design_id = ? AND user_id = ?').bind(r.id, user.id).run();
    await env.DB1.prepare('UPDATE designs SET votes = MAX(0, votes - 1), updated_at = ? WHERE id = ?').bind(nowMs(), r.id).run();
    return ok({ id: r.id, voted: false, votes: Math.max(0, (r.votes || 0) - 1) }, ctx);
  }
  await env.DB1.prepare('INSERT INTO design_votes (design_id, user_id, created_at) VALUES (?, ?, ?)')
    .bind(r.id, user.id, nowMs()).run();
  await env.DB1.prepare('UPDATE designs SET votes = votes + 1, updated_at = ? WHERE id = ?').bind(nowMs(), r.id).run();
  return ok({ id: r.id, voted: true, votes: (r.votes || 0) + 1 }, ctx);
});

router.post('/api/designs/:id/withdraw', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const r = await env.DB1.prepare('SELECT * FROM designs WHERE id = ?').bind(params.id).first();
  if (!r) notfound('设计不存在');
  if (r.author_id !== user.id) forbid('只能撤回自己的设计');
  if (r.status === 'adopted') bad('已被采纳的设计无法撤回');
  await env.DB1.prepare("UPDATE designs SET status = 'withdrawn', updated_at = ? WHERE id = ?").bind(nowMs(), params.id).run();
  return ok({ id: params.id, status: 'withdrawn' }, ctx);
});

router.delete('/api/designs/:id', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const r = await env.DB1.prepare('SELECT * FROM designs WHERE id = ?').bind(params.id).first();
  if (!r) notfound('设计不存在');
  const reviewer = await canReviewSubmission(env, user);
  if (r.author_id !== user.id && !reviewer) forbid('无权删除该设计');
  await env.DB1.prepare('DELETE FROM designs WHERE id = ?').bind(params.id).run();
  await env.DB1.prepare('DELETE FROM design_votes WHERE design_id = ?').bind(params.id).run();
  return ok({ deleted: params.id }, ctx);
});

/* -------------------------- 审核 / 采纳（管理层） -------------------------- */

/* 初审：approve → 进入公开投票池并发放投稿奖励；reject → 打回 */
router.post('/api/admin/designs/:id/review', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  if (!await canReviewSubmission(env, user)) forbid('仅审核人可处理设计投稿');
  const r = await env.DB1.prepare('SELECT * FROM designs WHERE id = ?').bind(params.id).first();
  if (!r) notfound('设计不存在');
  if (r.status === 'adopted') conflict('该设计已被采纳');
  const decision = String(body.decision || '');
  if (!['approve', 'reject'].includes(decision)) bad('decision 必须是 approve 或 reject');
  const note = String(body.note || '').slice(0, 500);
  const now = nowMs();
  const status = decision === 'approve' ? 'approved' : 'rejected';

  let reward = null;
  if (decision === 'approve' && !r.rewarded) {
    const camp = (await getDesignCampaigns(env)).find((c) => c.id === r.campaign_id);
    const mo = Math.max(0, Math.floor(camp?.rewardMo || 0));
    const meow = Math.max(0, Math.floor(camp?.rewardMeow || 0));
    if ((mo || meow) && r.author_id) {
      const author = await getUser(env, r.author_id);
      if (author) { addEconomyInline(author, mo, meow); await saveUser(env, author); reward = { mo, meow }; }
    }
  }
  await env.DB1.prepare('UPDATE designs SET status = ?, note = ?, reviewer_id = ?, rewarded = ?, updated_at = ? WHERE id = ?')
    .bind(status, note, user.id, reward ? 1 : (r.rewarded || 0), now, params.id).run();
  await writeAudit(env, user, 'design.review', params.id, `${decision}:${note}`);
  if (r.author_id) {
    try {
      await pushNotification(env, r.author_id, {
        type: 'design',
        title: decision === 'approve' ? '你的设计已进入公开投票' : '你的设计未通过初审',
        body: r.name + (note ? `（${note}）` : '') + (reward ? `　+${reward.mo} MO / +${reward.meow} Meow` : ''),
        link: `/designs.html?id=${r.id}`, refId: r.id,
      });
    } catch (_) {}
  }
  return ok({ id: params.id, status, reward }, ctx);
});

/**
 * 采纳：把社区设计写进官方目录，并给设计者署名 + 奖励。
 *  - title  → 追加进称号目录（cfg.titleCatalog），可选同步上架商城
 *  - gift   → 追加进礼物目录（cfg.giftCatalog）
 *  - frame/card/bubble → 上架商城，grant 指向白名单 class（body.cls 可覆盖）
 *  - emoji/other → 仅登记为已采纳（走各自的表情/其它流程）
 */
router.post('/api/admin/designs/:id/adopt', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  if (!await isSuperAdmin(env, user)) forbid('仅超级管理员可采纳设计');
  const r = await env.DB1.prepare('SELECT * FROM designs WHERE id = ?').bind(params.id).first();
  if (!r) notfound('设计不存在');
  if (r.status === 'adopted') conflict('该设计已被采纳');

  const spec = jsonOr({}, r.spec);
  const credit = r.anonymous ? '匿名设计师' : (r.author_name || '');
  const price = clamp(Math.floor(Number(body.price ?? spec.price) || 0), 0, 100000);
  const now = nowMs();
  let adoptedId = '';
  let shopItem = null;

  if (r.kind === 'title') {
    const cfg = await getSiteConfig(env);
    const list = Array.isArray(cfg.titleCatalog) && cfg.titleCatalog.length ? cfg.titleCatalog : defaultTitleCatalog();
    const t = normalizeTitle({
      id: String(body.targetId || '').trim() || 'tc_' + r.id,
      name: r.name, color: spec.color, icon: spec.icon,
      desc: (r.summary || '').slice(0, 100),
      rare: !!spec.rare,
    }, { designerId: r.anonymous ? '' : (r.author_id || ''), designerName: credit, fromDesign: r.id });
    cfg.titleCatalog = [...list.filter((x) => x.id !== t.id), t].slice(0, 100);
    await saveSiteConfig(env, cfg);
    adoptedId = t.id;
    if (price > 0) shopItem = { kind: 'title', category: 'title', grant: { titleId: t.id, titleName: t.name, titleColor: t.color, titleIcon: t.icon, rare: t.rare } };
  } else if (r.kind === 'gift') {
    const cfg = await getSiteConfig(env);
    const list = Array.isArray(cfg.giftCatalog) && cfg.giftCatalog.length ? cfg.giftCatalog : defaultGiftCatalog();
    const g = {
      id: String(body.targetId || '').trim() || 'gc_' + r.id,
      name: r.name, icon: spec.icon || '🎁',
      price: clamp(price || 10, 1, 100000),
      desc: (r.summary || '').slice(0, 100),
      designerId: r.anonymous ? '' : (r.author_id || ''), designerName: credit, fromDesign: r.id,
    };
    cfg.giftCatalog = [...list.filter((x) => x.id !== g.id), g].slice(0, 60);
    await saveSiteConfig(env, cfg);
    adoptedId = g.id;
  } else if (['frame', 'card', 'bubble'].includes(r.kind)) {
    // 装扮类必须映射到白名单 class：优先取采纳时指定的，其次取投稿里的
    const cls = designSafeCls(r.kind, body.cls || spec.cls);
    if (!cls) bad(`请指定合法的${r.kind}样式类（须在白名单内）`);
    const idKey = { frame: 'frameId', card: 'cardId', bubble: 'bubbleId' }[r.kind];
    const nameKey = { frame: 'frameName', card: 'cardName', bubble: 'bubbleName' }[r.kind];
    const clsKey = { frame: 'frameCls', card: 'cardCls', bubble: 'bubbleCls' }[r.kind];
    adoptedId = String(body.targetId || '').trim() || 'dc_' + r.id;
    shopItem = {
      kind: r.kind, category: r.kind,
      grant: { [idKey]: adoptedId, [nameKey]: r.name, [clsKey]: cls },
    };
  } else {
    adoptedId = 'design_' + r.id;
  }

  /* 需要上架的，写入商城（沿用 cfg:shop 结构，字段与 /api/shop/admin 规范一致） */
  if (shopItem) {
    const items = await KV.getJSON(env, 'cfg:shop', []);
    const list = Array.isArray(items) && items.length ? items : defaultShop();
    const it = {
      id: 'sd_' + r.id, name: r.name,
      desc: ((r.summary || '').slice(0, 120) + (credit ? `　设计：${credit}` : '')).slice(0, 200),
      price: price || 100, discountPrice: 0,
      active: true, stock: -1, sold: 0, createdAt: now,
      limitPerUser: 0, startAt: 0, endAt: 0,
      levelMin: clamp(Math.floor(Number(body.levelMin) || 0), 0, 999),
      sort: 900,
      designerId: r.anonymous ? '' : (r.author_id || ''), designerName: credit, fromDesign: r.id,
      ...shopItem,
    };
    await KV.putJSON(env, 'cfg:shop', [...list.filter((x) => x.id !== it.id), it].slice(0, 200));
  }

  /* 设计者奖励：MO / 经验 / 特约设计师称号 */
  const camp = (await getDesignCampaigns(env)).find((c) => c.id === r.campaign_id);
  let reward = null;
  if (r.author_id) {
    const author = await getUser(env, r.author_id);
    if (author) {
      const mo = Math.max(0, Math.floor(body.rewardMo ?? camp?.adoptMo ?? 0));
      const meow = Math.max(0, Math.floor(body.rewardMeow ?? camp?.adoptMeow ?? 0));
      if (mo || meow) addEconomyInline(author, mo, meow);
      let titled = false;
      if (camp?.adoptTitle !== false) {
        grantTitleInline(author, normalizeTitle(DESIGNER_TITLE, { source: 'design', grantedAt: now, fromDesign: r.id }));
        titled = true;
      }
      author.stats = author.stats || {};
      author.stats.designsAdopted = (author.stats.designsAdopted || 0) + 1;
      await saveUser(env, author);
      reward = { mo, meow, title: titled };
    }
  }

  await env.DB1.prepare("UPDATE designs SET status = 'adopted', adopted_id = ?, reviewer_id = ?, note = ?, updated_at = ? WHERE id = ?")
    .bind(adoptedId, user.id, String(body.note || '').slice(0, 500), now, params.id).run();
  await writeAudit(env, user, 'design.adopt', params.id, `${r.kind}:${adoptedId}`);
  if (r.author_id) {
    try {
      await pushNotification(env, r.author_id, {
        type: 'honor', title: '🎉 你的设计被官方采纳了',
        body: `${r.name}　已上线` + (reward ? `　+${reward.mo} MO / +${reward.meow} Meow` + (reward.title ? ' / 特约设计师称号' : '') : ''),
        link: `/designs.html?id=${r.id}`, refId: r.id,
      });
    } catch (_) {}
  }
  return ok({ id: params.id, status: 'adopted', adoptedId, reward, listed: !!shopItem }, ctx);
});

/* 采纳名人堂：已上线的社区设计（公开） */
router.get('/api/designs/hall/adopted', async (ctx) => {
  const { env, user } = ctx;
  if (!env.DB1) return ok({ items: [] }, ctx);
  const rows = (await env.DB1.prepare("SELECT * FROM designs WHERE status = 'adopted' ORDER BY updated_at DESC LIMIT 60").all()).results || [];
  return ok({ items: await Promise.all(rows.map((r) => designCardD1(env, r, user))) }, ctx);
});

/* ------------------------------ 20.5 客服工单（D1 真表） ------------------------------ */

const TKT_STATUS = ['open', 'pending', 'resolved', 'closed'];
const TKT_CATEGORIES = ['account', 'payment', 'content', 'abuse', 'technical', 'other'];
const TKT_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

const DEFAULT_SUPPORT_CONFIG = {
  hours: '每日 10:00 - 22:00（UTC+8）',
  sla: '通常 24 小时内首次响应',
  notice: '',
  faq: [
    { q: '如何修改用户名或邮箱？', a: '进入「设置 → 账号」即可修改邮箱；用户名修改需在「设置 → 资料」中操作，受频率限制。' },
    { q: '忘记密码怎么办？', a: '在登录页点击「忘记密码」，通过邮箱验证码重置即可。' },
    { q: '投稿多久会被审核？', a: '投稿会进入审稿队列，通常 1-3 个工作日内给出结果，结果会通过站内通知与来信告知。' },
    { q: '如何申诉封禁或禁言？', a: '在客服中心提交「举报/滥用」类工单，或前往治理中心提交申诉，风纪委员会会复核。' },
  ],
};

async function getSupportConfig(env) {
  const saved = await getMeta(env, 'support', null);
  if (!saved) return structuredClone(DEFAULT_SUPPORT_CONFIG);
  return { ...structuredClone(DEFAULT_SUPPORT_CONFIG), ...saved };
}

function tktCardD1(t, viewer, staff) {
  return {
    id: t.id, subject: t.subject, category: t.category, priority: t.priority, status: t.status,
    createdAt: t.created_at, updatedAt: t.updated_at, lastReplyAt: t.last_reply_at || t.created_at,
    messageCount: t.message_count || 0, unreadForUser: !!t.unread_for_user, unreadForStaff: !!t.unread_for_staff,
    assigneeId: staff ? (t.assignee_id || '') : undefined,
    user: staff ? { id: t.user_id, name: t.user_name, email: t.email } : undefined,
    mine: !!viewer && viewer.id === t.user_id,
  };
}

router.get('/api/support/config', async (ctx) => ok({ config: await getSupportConfig(ctx.env) }, ctx));
router.put('/api/support/config', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (!(await canReviewSubmission(env, user))) forbid('仅管理层可修改客服配置');
  const cur = await getSupportConfig(env);
  const next = {
    hours: String(body.hours ?? cur.hours).slice(0, 200),
    sla: String(body.sla ?? cur.sla).slice(0, 200),
    notice: String(body.notice ?? cur.notice).slice(0, 1000),
    faq: (Array.isArray(body.faq) ? body.faq : cur.faq).slice(0, 50).map((f) => ({ q: String(f.q || '').slice(0, 200), a: String(f.a || '').slice(0, 2000) })).filter((f) => f.q),
  };
  await setMeta(env, 'support', next);
  await writeAudit(env, user, 'support.config.save', 'support', '');
  return ok({ config: next }, ctx);
});

router.post('/api/tickets', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  await guardRate(env, `tkt:${user.id}`, 5, 1800, '提交过于频繁，请稍后再试');
  const subject = String(body.subject || '').trim().slice(0, 200);
  if (subject.length < 2) bad('主题至少 2 个字符');
  const message = sanitizeContent(body.message || '', 8000);
  if (message.trim().length < 5) bad('请描述清楚你的问题（至少 5 个字符）');
  const id = uid('tkt'); const now = nowMs();
  await env.DB1.prepare('INSERT INTO tickets (id,user_id,user_name,email,subject,body,status,priority,category,contact,created_at,updated_at,assignee_id,last_reply_at,message_count,unread_for_user,unread_for_staff) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, user.id, user.displayName || user.username, user.email || '', subject, message, 'open', TKT_PRIORITIES.includes(body.priority) ? body.priority : 'normal', TKT_CATEGORIES.includes(body.category) ? body.category : 'other', String(body.contact || '').slice(0, 200), now, now, '', now, 1, 0, 1).run();
  await env.DB1.prepare('INSERT INTO ticket_messages (id,ticket_id,from_role,user_id,name,body,internal,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(uid('m'), id, 'user', user.id, user.displayName || user.username, message, 0, now).run();
  await writeAudit(env, user, 'ticket.create', id, subject);
  ctx.waitUntil((async () => {
    try {
      const oa = await getOfficialAccount(env);
      if (oa && oa.id !== user.id) await pushNotification(env, oa.id, { type: 'support', title: '新的客服工单', body: subject, link: `/support.html?id=${id}`, refId: id, actor: { id: user.id, name: user.displayName, avatar: user.avatar } });
    } catch (_) {}
  })());
  return ok({ id, status: 'open' }, ctx);
});

router.get('/api/tickets', async (ctx) => {
  const { env, user, url } = ctx;
  if (!user) unauth();
  const staff = await canHandleTicket(env, user);
  const mine = url.searchParams.get('mine') === '1' || !staff;
  const status = url.searchParams.get('status') || '';
  const limit = clamp(parseInt(url.searchParams.get('limit') || '30', 10), 1, 100);
  let rows;
  if (mine) {
    rows = (TKT_STATUS.includes(status))
      ? (await env.DB1.prepare('SELECT * FROM tickets WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?').bind(user.id, status, limit).all()).results || []
      : (await env.DB1.prepare('SELECT * FROM tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').bind(user.id, limit).all()).results || [];
  } else {
    rows = (TKT_STATUS.includes(status))
      ? (await env.DB1.prepare('SELECT * FROM tickets WHERE status = ? ORDER BY created_at DESC LIMIT ?').bind(status, limit).all()).results || []
      : (await env.DB1.prepare('SELECT * FROM tickets ORDER BY created_at DESC LIMIT ?').bind(limit).all()).results || [];
  }
  return ok({ items: rows.map((t) => tktCardD1(t, user, staff && !mine)), isStaff: staff }, ctx);
});

router.get('/api/tickets/:id', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const t = await env.DB1.prepare('SELECT * FROM tickets WHERE id = ?').bind(params.id).first();
  if (!t) notfound('工单不存在');
  const staff = await canHandleTicket(env, user);
  if (t.user_id !== user.id && !staff) forbid('无权查看该工单');
  const msgs = (await env.DB1.prepare('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC').bind(params.id).all()).results || [];
  let dirty = false;
  if (t.user_id === user.id && t.unread_for_user) { t.unread_for_user = 0; dirty = true; }
  else if (staff && t.unread_for_staff) { t.unread_for_staff = 0; dirty = true; }
  if (dirty) await env.DB1.prepare('UPDATE tickets SET unread_for_user = 0, unread_for_staff = 0 WHERE id = ?').bind(params.id).run();
  return ok({
    ticket: { ...tktCardD1(t, user, staff), contact: t.contact, body: t.body, messages: msgs.filter((m) => staff || !m.internal).map((m) => ({ id: m.id, from: m.from_role, userId: m.user_id, name: m.name, body: m.body, internal: !!m.internal, createdAt: m.created_at })) },
    isStaff: staff,
  }, ctx);
});

router.post('/api/admin/tickets/:id/reply', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const t = await env.DB1.prepare('SELECT * FROM tickets WHERE id = ?').bind(params.id).first();
  if (!t) notfound('工单不存在');
  const staff = await canHandleTicket(env, user);
  const isOwner = t.user_id === user.id;
  if (!isOwner && !staff) forbid('无权回复该工单');
  if (t.status === 'closed') conflict('工单已关闭，无法回复');
  const text = sanitizeContent(body.message || '', 8000);
  if (text.trim().length < 1) bad('回复内容不能为空');
  const internal = !!body.internal && staff && !isOwner;
  const now = nowMs();
  await env.DB1.prepare('INSERT INTO ticket_messages (id,ticket_id,from_role,user_id,name,body,internal,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(uid('m'), t.id, isOwner ? 'user' : 'staff', user.id, user.displayName || user.username, text, internal ? 1 : 0, now).run();
  let status = t.status;
  if (isOwner) { if (t.status === 'resolved') status = 'open'; }
  else if (!internal) { if (t.status === 'open') status = 'pending'; }
  if (staff && !isOwner && !t.assignee_id) t.assignee_id = user.id;
  await env.DB1.prepare('UPDATE tickets SET status = ?, assignee_id = ?, last_reply_at = ?, updated_at = ?, message_count = (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = ?), unread_for_user = CASE WHEN ? THEN 1 ELSE unread_for_user END, unread_for_staff = CASE WHEN ? THEN 1 ELSE unread_for_staff END WHERE id = ?')
    .bind(status, t.assignee_id || '', now, now, t.id, isOwner ? 1 : 0, (!isOwner && !internal) ? 1 : 0, t.id).run();
  if (!internal) {
    const target = isOwner ? null : t.user_id;
    if (target && target !== user.id) {
      await pushNotification(env, target, { type: 'support', title: '客服回复了你的工单', body: t.subject, link: `/support.html?id=${t.id}`, refId: t.id, actor: { id: user.id, name: user.displayName, avatar: user.avatar } });
    } else if (isOwner) {
      try { const oa = await getOfficialAccount(env); if (oa && oa.id !== user.id) await pushNotification(env, oa.id, { type: 'support', title: '用户追问了工单', body: t.subject, link: `/support.html?id=${t.id}`, refId: t.id }); } catch (_) {}
    }
  }
  await writeAudit(env, user, 'ticket.reply', t.id, '');
  return ok({ id: t.id, status }, ctx);
});

router.post('/api/admin/tickets/:id/status', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const t = await env.DB1.prepare('SELECT * FROM tickets WHERE id = ?').bind(params.id).first();
  if (!t) notfound('工单不存在');
  const staff = await canHandleTicket(env, user);
  const isOwner = t.user_id === user.id;
  const next = TKT_STATUS.includes(body.status) ? body.status : '';
  if (!next) bad('状态不合法');
  if (!staff && !(isOwner && next === 'closed')) forbid('无权变更工单状态');
  const now = nowMs();
  let nu = t.unread_for_user, ns = t.unread_for_staff;
  if (!isOwner && (next === 'resolved' || next === 'closed')) nu = 1;
  let assignee = t.assignee_id;
  if (staff && body.assigneeId !== undefined) assignee = String(body.assigneeId || '').slice(0, 64);
  await env.DB1.prepare('UPDATE tickets SET status = ?, assignee_id = ?, updated_at = ?, unread_for_user = ?, unread_for_staff = ? WHERE id = ?')
    .bind(next, assignee, now, nu, ns, params.id).run();
  if (!isOwner) await pushNotification(env, t.user_id, { type: 'support', title: next === 'resolved' ? '你的工单已被标记为已解决' : next === 'closed' ? '你的工单已关闭' : '你的工单状态已更新', body: t.subject, link: `/support.html?id=${t.id}`, refId: t.id });
  return ok({ id: t.id, status: next }, ctx);
});

/* ------------------------------ 20.5 站内信（D1 真表） ------------------------------ */

async function letterCardD1(env, l, viewer) {
  const peerId = l.from_id === viewer.id ? l.to_id : l.from_id;
  const other = peerId ? await getUser(env, peerId) : null;
  const brief = other
    ? { id: other.id, username: other.username, displayName: other.displayName, avatar: other.avatar || '', official: !!other.official }
    : { id: '', username: '', displayName: l.system ? '系统' : '未知用户', avatar: '', official: !!l.system };
  return {
    id: l.id, subject: l.subject, excerpt: String(l.body || '').replace(/\s+/g, ' ').slice(0, 120),
    read: !!l.read, starred: !!l.starred, system: !!l.system,
    createdAt: l.created_at, outgoing: l.from_id === viewer.id,
    peer: brief, replyTo: l.reply_to || '',
  };
}

async function sendLetterD1(env, { fromUser, toId, subject, body, system = false, replyTo = '' }) {
  const id = uid('lt'); const sid = sortableId(); const now = nowMs();
  await env.DB1.prepare('INSERT INTO letters (id,sid,from_id,to_id,subject,body,system,starred,read,reply_to,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, sid, fromUser ? fromUser.id : '', toId, String(subject || '（无主题）').slice(0, 200), sanitizeContent(body || '', 20000), system ? 1 : 0, 0, 0, String(replyTo || '').slice(0, 64), now).run();
  if (toId) { try { await pushNotification(env, toId, { type: 'letter', title: fromUser ? `${fromUser.displayName || fromUser.username} 给你来信` : '你收到一封系统来信', body: subject, link: `/letters.html?id=${id}`, refId: id, actor: fromUser ? { id: fromUser.id, name: fromUser.displayName, avatar: fromUser.avatar } : null }); } catch (_) {} }
  return id;
}

router.post('/api/letters', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (await isMuted(env, user, 'global')) forbid('你当前处于禁言状态，无法发信');
  await guardRate(env, `lt:${user.id}`, 20, 3600, '发信过于频繁，请稍后再试');
  const to = String(body.to || '').trim();
  if (!to) bad('请填写收件人');
  let target = await findUserByUsername(env, to);
  if (!target) target = await getUser(env, to);
  if (!target) notfound('收件人不存在');
  if (target.id === user.id) bad('不能给自己发信');
  const subject = String(body.subject || '').trim().slice(0, 200);
  if (!subject) bad('请填写主题');
  const text = String(body.body || '').trim();
  if (!text) bad('信件内容不能为空');
  const id = await sendLetterD1(env, { fromUser: user, toId: target.id, subject, body: text, replyTo: String(body.replyTo || '').slice(0, 64) });
  return ok({ id }, ctx);
});

router.get('/api/letters', async (ctx) => {
  const { env, user, url } = ctx;
  if (!user) unauth();
  const box = url.searchParams.get('box') === 'out' ? 'out' : 'in';
  const limit = clamp(parseInt(url.searchParams.get('limit') || '30', 10), 1, 100);
  const cursor = parseInt(url.searchParams.get('cursor') || '0', 10);
  const base = box === 'out'
    ? 'FROM letters WHERE from_id = ? AND deleted_for_sender = 0'
    : 'FROM letters WHERE to_id = ? AND deleted_for_recipient = 0';
  const rows = (await env.DB1.prepare(`SELECT * ${base} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(user.id, limit, cursor).all()).results || [];
  const total = (await env.DB1.prepare(`SELECT COUNT(*) c ${base}`).bind(user.id).first())?.c || 0;
  const unread = (await env.DB1.prepare('SELECT COUNT(*) c FROM letters WHERE to_id = ? AND read = 0 AND deleted_for_recipient = 0').bind(user.id).first())?.c || 0;
  return ok({ items: rows.map((l) => letterCardD1(env, l, user)), box, unread, cursor: cursor + rows.length, hasMore: cursor + rows.length < total }, ctx);
});

router.get('/api/letters/unread', async (ctx) => {
  const { env, user } = ctx;
  if (!user) unauth();
  const c = (await env.DB1.prepare('SELECT COUNT(*) c FROM letters WHERE to_id = ? AND read = 0 AND deleted_for_recipient = 0').bind(user.id).first())?.c || 0;
  return ok({ unread: c }, ctx);
});

router.get('/api/letters/:id', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const l = await env.DB1.prepare('SELECT * FROM letters WHERE id = ?').bind(params.id).first();
  if (!l) notfound('信件不存在');
  if (l.to_id !== user.id && l.from_id !== user.id) forbid('无权查看该信件');
  if (l.to_id === user.id && !l.read) await env.DB1.prepare('UPDATE letters SET read = 1 WHERE id = ?').bind(params.id).run();
  return ok({ letter: { ...(await letterCardD1(env, l, user)), body: l.body } }, ctx);
});

router.post('/api/letters/:id/star', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const l = await env.DB1.prepare('SELECT * FROM letters WHERE id = ?').bind(params.id).first();
  if (!l) notfound('信件不存在');
  if (l.to_id !== user.id && l.from_id !== user.id) forbid('无权操作该信件');
  const starred = l.starred ? 0 : 1;
  await env.DB1.prepare('UPDATE letters SET starred = ? WHERE id = ?').bind(starred, params.id).run();
  return ok({ starred: !!starred }, ctx);
});

router.delete('/api/letters/:id', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const l = await env.DB1.prepare('SELECT * FROM letters WHERE id = ?').bind(params.id).first();
  if (!l) notfound('信件不存在');
  if (l.to_id !== user.id && l.from_id !== user.id) forbid('无权删除该信件');
  let ds = l.deleted_for_sender, dr = l.deleted_for_recipient;
  if (l.from_id === user.id) ds = 1; else dr = 1;
  if (ds && dr) await env.DB1.prepare('DELETE FROM letters WHERE id = ?').bind(params.id).run();
  else await env.DB1.prepare('UPDATE letters SET deleted_for_sender = ?, deleted_for_recipient = ? WHERE id = ?').bind(ds, dr, params.id).run();
  return ok({ deleted: params.id }, ctx);
});

router.post('/api/admin/letters/broadcast', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (!(await isSuperAdmin(env, user))) forbid('仅超级管理员可群发来信');
  const subject = String(body.subject || '').trim().slice(0, 200);
  const text = String(body.body || '').trim();
  if (!subject || !text) bad('主题与内容不能为空');
  const targets = Array.isArray(body.userIds) ? body.userIds.slice(0, 200) : [];
  let ids = targets;
  if (!ids.length) {
    const { keys } = await KV.list(env, 'user:', 500);
    ids = keys.map((k) => k.name.slice(5)).filter(Boolean);
  }
  let sent = 0;
  for (const tid of ids) {
    if (tid === user.id) continue;
    try { await sendLetterD1(env, { fromUser: user, toId: tid, subject, body: text, system: true }); sent++; } catch (_) {}
  }
  await writeAudit(env, user, 'letter.broadcast', String(sent), subject);
  return ok({ sent, total: ids.length }, ctx);
});

/* ------------------------------ 20.5 Codespace / Runtime（D1 真表） ------------------------------ */

router.post('/api/codespaces', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  const name = String(body.name || '').trim().slice(0, 80);
  if (!name) bad('请填写空间名称');
  const code = String(body.code || '').slice(0, 200000);
  if (!code) bad('代码不能为空');
  const id = uid('cs'); const now = nowMs();
  await env.DB1.prepare('INSERT INTO codespaces (id,owner_id,name,description,language,code,public,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(id, user.id, name, String(body.description || '').slice(0, 500), String(body.language || 'javascript').slice(0, 40), code, body.public === true ? 1 : 0, now, now).run();
  return ok({ id }, ctx);
});

router.get('/api/codespaces', async (ctx) => {
  const { env, user, url } = ctx;
  if (!user) unauth();
  const pub = url.searchParams.get('public') === '1';
  const limit = clamp(parseInt(url.searchParams.get('limit') || '30', 10), 1, 100);
  const rows = pub
    ? (await env.DB1.prepare('SELECT id,owner_id,name,description,language,public,created_at,updated_at FROM codespaces WHERE public = 1 ORDER BY updated_at DESC LIMIT ?').bind(limit).all()).results || []
    : (await env.DB1.prepare('SELECT id,owner_id,name,description,language,public,created_at,updated_at FROM codespaces WHERE owner_id = ? ORDER BY updated_at DESC LIMIT ?').bind(user.id, limit).all()).results || [];
  return ok({ items: rows.map((r) => ({ id: r.id, name: r.name, description: r.description, language: r.language, public: !!r.public, ownerId: r.owner_id, createdAt: r.created_at, updatedAt: r.updated_at })) }, ctx);
});

router.get('/api/codespaces/:id', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const r = await env.DB1.prepare('SELECT * FROM codespaces WHERE id = ?').bind(params.id).first();
  if (!r) notfound('空间不存在');
  if (r.owner_id !== user.id && !r.public) forbid('无权查看该空间');
  return ok({ space: { id: r.id, ownerId: r.owner_id, name: r.name, description: r.description, language: r.language, public: !!r.public, code: r.code, createdAt: r.created_at, updatedAt: r.updated_at } }, ctx);
});

router.put('/api/codespaces/:id', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const r = await env.DB1.prepare('SELECT * FROM codespaces WHERE id = ?').bind(params.id).first();
  if (!r) notfound('空间不存在');
  if (r.owner_id !== user.id) forbid('只能编辑自己的空间');
  const name = String(body.name || r.name).trim().slice(0, 80) || r.name;
  const pub = body.public === true ? 1 : (body.public === false ? 0 : r.public);
  await env.DB1.prepare('UPDATE codespaces SET name = ?, description = ?, language = ?, code = ?, public = ?, updated_at = ? WHERE id = ?')
    .bind(name, String(body.description ?? r.description).slice(0, 500), String(body.language || r.language).slice(0, 40), String(body.code ?? r.code).slice(0, 200000), pub, nowMs(), params.id).run();
  return ok({ id: params.id }, ctx);
});

router.delete('/api/codespaces/:id', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const r = await env.DB1.prepare('SELECT * FROM codespaces WHERE id = ?').bind(params.id).first();
  if (!r) notfound('空间不存在');
  if (r.owner_id !== user.id) forbid('只能删除自己的空间');
  await env.DB1.prepare('DELETE FROM codespaces WHERE id = ?').bind(params.id).run();
  return ok({ deleted: params.id }, ctx);
});

/* ------------------------------ 20.5 技术工具（站点工具目录，D1） ------------------------------ */

const DEFAULT_TOOLS = [
  { id: 'gateway', name: '本地网关', desc: 'IP 纯度检测、设备禁用、OpenClaw 等本地小工具', url: '/gateway.html', icon: '🛰️', public: true },
  { id: 'crypto', name: '端到端加密工具', desc: '基于 MeowLink / PawCrypt 的本地离线加解密', url: '/tools.html#crypto', icon: '🔐', public: true },
  { id: 'changelog', name: '更新日志', desc: '站点功能与协议演进记录', url: '/changelog.html', icon: '📝', public: true },
];

router.get('/api/tools', async (ctx) => {
  const { env } = ctx;
  const custom = await getMeta(env, 'tools', null);
  const list = Array.isArray(custom) ? custom : DEFAULT_TOOLS;
  return ok({ tools: list }, ctx);
});

router.put('/api/admin/tools', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (!(await isSuperAdmin(env, user))) forbid('仅超级管理员可配置工具目录');
  const list = Array.isArray(body.tools) ? body.tools.slice(0, 50).map((t) => ({ id: String(t.id || '').slice(0, 40), name: String(t.name || '').slice(0, 80), desc: String(t.desc || '').slice(0, 200), url: String(t.url || '').slice(0, 500), icon: String(t.icon || '🔧').slice(0, 8), public: !!t.public })) : DEFAULT_TOOLS;
  await setMeta(env, 'tools', list);
  await writeAudit(env, user, 'tools.save', 'tools', '');
  return ok({ tools: list }, ctx);
});

/* ------------------------------ 20.6 OAuth 提供方（IdP, D1） ------------------------------ */
const OAUTH_SCOPES = {
  profile: { zh: '读取你的公开资料（用户名、昵称、头像）', en: 'Read your public profile (username, display name, avatar)', always: true },
  email: { zh: '读取你的邮箱地址', en: 'Read your email address' },
  'posts:read': { zh: '读取你的文章列表（含仅自己可见）', en: 'Read your posts, including private ones' },
  'posts:write': { zh: '代表你发布或修改文章', en: 'Create and edit posts on your behalf' },
  'files:read': { zh: '读取你的网盘文件列表', en: 'Read your file library' },
  'letters:send': { zh: '代表你发送站内信', en: 'Send letters on your behalf' },
  bind: { zh: '把该应用与你的账号绑定，下次可一键登录', en: 'Link this app to your account for one-click sign-in' },
};
const OAUTH_CODE_TTL = 600;
const OAUTH_TOKEN_TTL = 7200;
const OAUTH_REFRESH_TTL = 2592000;

function oauthNormScopes(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[\s,]+/);
  const out = [];
  for (const s of raw) {
    const k = String(s || '').trim();
    if (!k) continue;
    if (k === 'openid') { if (!out.includes('profile')) out.push('profile'); continue; }
    if (OAUTH_SCOPES[k] && !out.includes(k)) out.push(k);
  }
  if (!out.includes('profile')) out.unshift('profile');
  return out;
}
function oauthValidRedirect(u) {
  try { const x = new URL(u); if (x.protocol === 'https:') return true; if (x.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(x.hostname)) return true; return false; } catch { return false; }
}
function oauthNormRedirects(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[\r\n,]+/);
  const out = [];
  for (const s of raw) {
    const u = String(s || '').trim();
    if (!u) continue;
    if (!oauthValidRedirect(u)) bad(`回调地址不合法（需 https，或 http://localhost）：${u}`);
    if (!out.includes(u)) out.push(u);
    if (out.length >= 10) break;
  }
  if (!out.length) bad('至少需要一个回调地址');
  return out;
}
function oauthRedirectAllowed(app, uri) {
  if (!uri) return (app.redirectUris || [])[0] || '';
  return (app.redirectUris || []).includes(uri) ? uri : '';
}
function oauthAppCard(app, { secret = '', owner = null } = {}) {
  return {
    clientId: app.id, name: app.name, description: app.description || '',
    homepage: app.homepage || '', logo: app.logo || '',
    redirectUris: app.redirectUris || [], scopes: app.scopes || ['profile'],
    status: app.status || 'active', createdAt: app.createdAt, updatedAt: app.updatedAt || app.createdAt,
    stats: app.stats || { authorized: 0, tokens: 0 },
    ownerId: app.ownerId,
    owner: owner ? { id: owner.id, username: owner.username, displayName: owner.displayName } : null,
    ...(secret ? { clientSecret: secret } : {}),
  };
}
function rowToOAuthApp(r) {
  if (!r) return null;
  return {
    id: r.id, secretHash: r.secret_hash, name: r.name, description: r.description || '',
    homepage: r.homepage || '', logo: r.logo || '',
    redirectUris: jsonOr([], r.redirect_uris), scopes: jsonOr([], r.scopes),
    ownerId: r.owner_id, status: r.status || 'active',
    createdAt: r.created_at, updatedAt: r.updated_at || r.created_at,
    stats: jsonOr({ authorized: 0, tokens: 0 }, r.stats),
  };
}
async function getOAuthApp(env, clientId) {
  if (!clientId) return null;
  const r = await env.DB1.prepare('SELECT * FROM oauth_apps WHERE id = ?').bind(String(clientId).slice(0, 80)).first();
  return rowToOAuthApp(r);
}
async function resolveOAuthToken(request, env) {
  const raw = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!raw || !raw.startsWith('mo_at_')) return null;
  const rec = await env.DB1.prepare('SELECT * FROM oauth_tokens WHERE token_hash = ? AND kind = ?').bind(await sha256Hex(raw), 'access').first();
  if (!rec) return null;
  if (rec.exp && rec.exp < nowSec()) return null;
  const user = await getUser(env, rec.user_id);
  if (!user) return null;
  if ((user.tokenVersion || 1) !== (rec.ver || 1)) return null;
  return { rec: { userId: rec.user_id, scopes: jsonOr([], rec.scopes), clientId: rec.client_id, ver: rec.ver }, user };
}

/* 应用管理 */
router.get('/api/oauth/apps', async (ctx) => {
  const { env, user, url } = ctx;
  if (!user) unauth();
  const all = url.searchParams.get('all') === '1' && await isSuperAdmin(env, user);
  const rows = all
    ? (await env.DB1.prepare('SELECT * FROM oauth_apps ORDER BY created_at DESC').all()).results || []
    : (await env.DB1.prepare('SELECT * FROM oauth_apps WHERE owner_id = ? ORDER BY created_at DESC').bind(user.id).all()).results || [];
  const out = [];
  for (const r of rows) { const app = rowToOAuthApp(r); const owner = all ? await getUser(env, app.ownerId) : null; out.push(oauthAppCard(app, { owner })); }
  return ok({ apps: out, scopes: OAUTH_SCOPES }, ctx);
});
router.post('/api/oauth/apps', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  if (!user.emailVerified && !(await isSuperAdmin(env, user))) forbid('请先验证邮箱后再创建 OAuth 应用');
  await guardRate(env, `oapp:${user.id}`, 10, 3600, '创建应用过于频繁');
  const cnt = (await env.DB1.prepare('SELECT count(*) c FROM oauth_apps WHERE owner_id = ?').bind(user.id).first())?.c || 0;
  const limit = (await isSuperAdmin(env, user)) ? 50 : 10;
  if (cnt >= limit) bad(`每个账号最多创建 ${limit} 个 OAuth 应用`);
  const name = String(body.name || '').trim().slice(0, 60);
  if (name.length < 2) bad('应用名称至少 2 个字符');
  const redirectUris = oauthNormRedirects(body.redirectUris);
  const scopes = oauthNormScopes(body.scopes);
  const clientId = `mo_${uid().slice(0, 24)}`;
  const secret = `mos_${uid()}${uid().slice(0, 8)}`;
  const app = {
    id: clientId, secretHash: await sha256Hex(secret), name,
    description: String(body.description || '').trim().slice(0, 300),
    homepage: oauthSafeUrl(body.homepage), logo: oauthSafeUrl(body.logo),
    redirectUris, scopes, ownerId: user.id, status: 'active',
    createdAt: nowMs(), updatedAt: nowMs(), stats: { authorized: 0, tokens: 0 },
  };
  await env.DB1.prepare('INSERT INTO oauth_apps (id,secret_hash,name,description,homepage,logo,redirect_uris,scopes,owner_id,status,created_at,updated_at,stats) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(clientId, app.secretHash, name, app.description, app.homepage, app.logo, JSON.stringify(redirectUris), JSON.stringify(scopes), user.id, 'active', app.createdAt, app.updatedAt, JSON.stringify(app.stats)).run();
  await writeAudit(env, user, 'oauth.app.create', clientId, name);
  return ok({ app: oauthAppCard(app, { secret }) }, ctx);
});
router.get('/api/oauth/apps/:id', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const app = await getOAuthApp(env, params.id);
  if (!app) notfound('应用不存在');
  if (app.ownerId !== user.id && !(await isSuperAdmin(env, user))) forbid();
  return ok({ app: oauthAppCard(app), scopes: OAUTH_SCOPES }, ctx);
});
router.put('/api/oauth/apps/:id', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const app = await getOAuthApp(env, params.id);
  if (!app) notfound('应用不存在');
  if (app.ownerId !== user.id && !(await isSuperAdmin(env, user))) forbid();
  if (body.name !== undefined) { const n = String(body.name).trim().slice(0, 60); if (n.length < 2) bad('应用名称至少 2 个字符'); app.name = n; }
  if (body.description !== undefined) app.description = String(body.description).trim().slice(0, 300);
  if (body.homepage !== undefined) app.homepage = oauthSafeUrl(body.homepage);
  if (body.logo !== undefined) app.logo = oauthSafeUrl(body.logo);
  if (body.redirectUris !== undefined) app.redirectUris = oauthNormRedirects(body.redirectUris);
  if (body.scopes !== undefined) app.scopes = oauthNormScopes(body.scopes);
  if (body.status !== undefined && (await isSuperAdmin(env, user))) app.status = body.status === 'suspended' ? 'suspended' : 'active';
  app.updatedAt = nowMs();
  await env.DB1.prepare('UPDATE oauth_apps SET name=?,description=?,homepage=?,logo=?,redirect_uris=?,scopes=?,status=?,updated_at=? WHERE id=?')
    .bind(app.name, app.description, app.homepage, app.logo, JSON.stringify(app.redirectUris), JSON.stringify(app.scopes), app.status, app.updatedAt, app.id).run();
  await writeAudit(env, user, 'oauth.app.update', app.id, app.name);
  return ok({ app: oauthAppCard(app) }, ctx);
});
router.post('/api/oauth/apps/:id/secret', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const app = await getOAuthApp(env, params.id);
  if (!app) notfound('应用不存在');
  if (app.ownerId !== user.id && !(await isSuperAdmin(env, user))) forbid();
  const secret = `mos_${uid()}${uid().slice(0, 8)}`;
  app.secretHash = await sha256Hex(secret);
  app.updatedAt = nowMs();
  await env.DB1.prepare('UPDATE oauth_apps SET secret_hash=?, updated_at=? WHERE id=?').bind(app.secretHash, app.updatedAt, app.id).run();
  await writeAudit(env, user, 'oauth.app.secret', app.id, '');
  return ok({ clientSecret: secret }, ctx);
});
router.delete('/api/oauth/apps/:id', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const app = await getOAuthApp(env, params.id);
  if (!app) notfound('应用不存在');
  if (app.ownerId !== user.id && !(await isSuperAdmin(env, user))) forbid();
  await env.DB1.prepare('DELETE FROM oauth_apps WHERE id = ?').bind(app.id).run();
  await env.DB1.prepare('DELETE FROM oauth_grants WHERE client_id = ?').bind(app.id).run();
  await env.DB1.prepare('DELETE FROM oauth_codes WHERE client_id = ?').bind(app.id).run();
  await env.DB1.prepare('DELETE FROM oauth_tokens WHERE client_id = ?').bind(app.id).run();
  await writeAudit(env, user, 'oauth.app.delete', app.id, app.name);
  return ok({ deleted: true }, ctx);
});

/* 授权页信息 + 确认 */
router.get('/api/oauth/authorize/info', async (ctx) => {
  const { env, user, url } = ctx;
  const clientId = url.searchParams.get('client_id') || '';
  const app = await getOAuthApp(env, clientId);
  if (!app) bad('client_id 无效');
  if (app.status !== 'active') forbid('该应用已被停用');
  const redirectUri = oauthRedirectAllowed(app, url.searchParams.get('redirect_uri') || '');
  if (!redirectUri) bad('redirect_uri 未在应用中登记');
  const want = oauthNormScopes(url.searchParams.get('scope') || app.scopes);
  const invalid = want.filter((s) => !(app.scopes || []).includes(s));
  if (invalid.length) bad(`应用未申请这些权限：${invalid.join(', ')}`);
  const owner = await getUser(env, app.ownerId);
  const grant = user ? await env.DB1.prepare('SELECT * FROM oauth_grants WHERE user_id = ? AND client_id = ?').bind(user.id, app.id).first() : null;
  return ok({
    app: { clientId: app.id, name: app.name, description: app.description, homepage: app.homepage, logo: app.logo, owner: owner ? { username: owner.username, displayName: owner.displayName, official: !!owner.official } : null, createdAt: app.createdAt },
    redirectUri,
    scopes: want.map((k) => ({ key: k, zh: OAUTH_SCOPES[k].zh, en: OAUTH_SCOPES[k].en, always: !!OAUTH_SCOPES[k].always })),
    granted: !!grant, grantedScopes: grant ? jsonOr([], grant.scopes) : [],
    loggedIn: !!user,
    me: user ? { id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar || '' } : null,
  }, ctx);
});
router.post('/api/oauth/authorize', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  const app = await getOAuthApp(env, body.client_id || body.clientId);
  if (!app) bad('client_id 无效');
  if (app.status !== 'active') forbid('该应用已被停用');
  const redirectUri = oauthRedirectAllowed(app, body.redirect_uri || body.redirectUri || '');
  if (!redirectUri) bad('redirect_uri 未在应用中登记');
  const state = String(body.state || '').slice(0, 512);
  const sep = redirectUri.includes('?') ? '&' : '?';
  if (body.approve === false || body.approve === 'false') {
    const q = new URLSearchParams({ error: 'access_denied', error_description: 'user denied' });
    if (state) q.set('state', state);
    return ok({ redirect: `${redirectUri}${sep}${q}`, approved: false }, ctx);
  }
  const scopes = oauthNormScopes(body.scope || body.scopes || app.scopes);
  const invalid = scopes.filter((s) => !(app.scopes || []).includes(s));
  if (invalid.length) bad(`应用未申请这些权限：${invalid.join(', ')}`);
  const method = String(body.code_challenge_method || '').toUpperCase();
  if (method && method !== 'S256' && method !== 'PLAIN') bad('仅支持 S256 的 PKCE');
  const code = `moc_${uid()}${uid().slice(0, 8)}`;
  await env.DB1.prepare('INSERT INTO oauth_codes (code_hash,client_id,user_id,scopes,redirect_uri,challenge,method,ver,exp,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(await sha256Hex(code), app.id, user.id, JSON.stringify(scopes), redirectUri, String(body.code_challenge || '').slice(0, 200), method || '', user.tokenVersion || 1, nowSec() + OAUTH_CODE_TTL, nowMs()).run();
  const grantRec = await env.DB1.prepare('SELECT * FROM oauth_grants WHERE user_id = ? AND client_id = ?').bind(user.id, app.id).first();
  if (grantRec) await env.DB1.prepare('UPDATE oauth_grants SET scopes=?, last_used=? WHERE user_id=? AND client_id=?').bind(JSON.stringify(scopes), nowMs(), user.id, app.id).run();
  else await env.DB1.prepare('INSERT INTO oauth_grants (user_id,client_id,name,logo,scopes,created_at,last_used) VALUES (?,?,?,?,?,?,?)').bind(user.id, app.id, app.name, app.logo || '', JSON.stringify(scopes), nowMs(), nowMs()).run();
  await env.DB1.prepare('UPDATE oauth_apps SET stats=? WHERE id=?').bind(JSON.stringify({ ...app.stats, authorized: (app.stats.authorized || 0) + 1 }), app.id).run();
  const q = new URLSearchParams({ code });
  if (state) q.set('state', state);
  await pushNotification(env, user.id, { type: 'oauth', title: '授权成功', body: `你已授权「${app.name}」访问你的账号`, link: '/user_settings.html#connections', refId: app.id });
  return ok({ redirect: `${redirectUri}${sep}${q}`, approved: true, code }, ctx);
});

/* 令牌端点 */
router.post('/api/oauth/token', async (ctx) => {
  const { env, body, request } = ctx;
  const basic = (request.headers.get('Authorization') || '').match(/^Basic\s+(.+)$/i);
  let cid = String(body.client_id || '').trim();
  let csec = String(body.client_secret || '').trim();
  if (basic) { try { const [a, b] = atob(basic[1]).split(':'); cid = cid || decodeURIComponent(a || ''); csec = csec || decodeURIComponent(b || ''); } catch { /* ignore */ } }
  const app = await getOAuthApp(env, cid);
  if (!app) return json({ error: 'invalid_client' }, { status: 401 }, ctx);
  if (app.status !== 'active') return json({ error: 'invalid_client', error_description: 'suspended' }, { status: 401 }, ctx);
  const grantType = String(body.grant_type || 'authorization_code');
  const issue = async (userId, scopes, ver) => {
    const at = `mo_at_${uid()}${uid()}`;
    const rt = `mo_rt_${uid()}${uid()}`;
    await env.DB1.prepare('INSERT INTO oauth_tokens (token_hash,kind,client_id,user_id,scopes,ver,exp,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(await sha256Hex(at), 'access', app.id, userId, JSON.stringify(scopes), ver, nowSec() + OAUTH_TOKEN_TTL, nowMs()).run();
    await env.DB1.prepare('INSERT INTO oauth_tokens (token_hash,kind,client_id,user_id,scopes,ver,exp,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(await sha256Hex(rt), 'refresh', app.id, userId, JSON.stringify(scopes), ver, nowSec() + OAUTH_REFRESH_TTL, nowMs()).run();
    await env.DB1.prepare('UPDATE oauth_apps SET stats=? WHERE id=?').bind(JSON.stringify({ ...app.stats, tokens: (app.stats.tokens || 0) + 1 }), app.id).run();
    return json({ access_token: at, token_type: 'Bearer', expires_in: OAUTH_TOKEN_TTL, refresh_token: rt, scope: scopes.join(' ') }, {}, ctx);
  };
  if (grantType === 'authorization_code') {
    const code = String(body.code || '');
    if (!code) return json({ error: 'invalid_request', error_description: 'code required' }, { status: 400 }, ctx);
    const rec = await env.DB1.prepare('SELECT * FROM oauth_codes WHERE code_hash = ?').bind(await sha256Hex(code)).first();
    if (!rec || rec.exp < nowSec()) return json({ error: 'invalid_grant' }, { status: 400 }, ctx);
    await env.DB1.prepare('DELETE FROM oauth_codes WHERE code_hash = ?').bind(await sha256Hex(code)).run();
    if (rec.client_id !== app.id) return json({ error: 'invalid_grant' }, { status: 400 }, ctx);
    const ru = String(body.redirect_uri || '');
    if (ru && ru !== rec.redirect_uri) return json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, { status: 400 }, ctx);
    if (rec.challenge) {
      const verifier = String(body.code_verifier || '');
      if (!verifier) return json({ error: 'invalid_request', error_description: 'code_verifier required' }, { status: 400 }, ctx);
      const calc = rec.method === 'S256' ? b64urlEncode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))) : verifier;
      if (calc !== rec.challenge) return json({ error: 'invalid_grant', error_description: 'PKCE failed' }, { status: 400 }, ctx);
    } else if (!csec || (await sha256Hex(csec)) !== app.secretHash) {
      return json({ error: 'invalid_client', error_description: 'client_secret required' }, { status: 401 }, ctx);
    }
    return issue(rec.user_id, jsonOr([], rec.scopes), rec.ver);
  }
  if (grantType === 'refresh_token') {
    const rt = String(body.refresh_token || '');
    const rec = await env.DB1.prepare('SELECT * FROM oauth_tokens WHERE token_hash = ? AND kind = ?').bind(await sha256Hex(rt), 'refresh').first();
    if (!rec || rec.exp < nowSec() || rec.client_id !== app.id) return json({ error: 'invalid_grant' }, { status: 400 }, ctx);
    if (!csec || (await sha256Hex(csec)) !== app.secretHash) return json({ error: 'invalid_client' }, { status: 401 }, ctx);
    const u = await getUser(env, rec.user_id);
    if (!u || (u.tokenVersion || 1) !== (rec.ver || 1)) return json({ error: 'invalid_grant' }, { status: 400 }, ctx);
    await env.DB1.prepare('DELETE FROM oauth_tokens WHERE token_hash = ?').bind(await sha256Hex(rt)).run();
    return issue(rec.user_id, jsonOr([], rec.scopes), rec.ver);
  }
  return json({ error: 'unsupported_grant_type' }, { status: 400 }, ctx);
});
router.post('/api/oauth/revoke', async (ctx) => {
  const { env, body } = ctx;
  const t = String(body.token || '');
  if (!t) bad('token 必填');
  await env.DB1.prepare('DELETE FROM oauth_tokens WHERE token_hash = ?').bind(await sha256Hex(t)).run();
  return ok({ revoked: true }, ctx);
});
router.get('/api/oauth/userinfo', async (ctx) => {
  const { env, request } = ctx;
  const res = await resolveOAuthToken(request, env);
  if (!res) return json({ error: 'invalid_token' }, { status: 401 }, ctx);
  const { rec, user } = res;
  const out = {
    sub: user.id, id: user.id, username: user.username, name: user.displayName || user.username,
    picture: user.avatar || '', bio: user.bio || '', createdAt: user.createdAt, official: !!user.official,
    profile: `${env.SITE_ORIGIN || ''}/profile.html?u=${encodeURIComponent(user.username)}`, scope: rec.scopes.join(' '),
  };
  if (rec.scopes.includes('email')) { out.email = user.email || ''; out.email_verified = !!user.emailVerified; }
  const g = await env.DB1.prepare('SELECT * FROM oauth_grants WHERE user_id = ? AND client_id = ?').bind(user.id, rec.clientId).first();
  if (g) await env.DB1.prepare('UPDATE oauth_grants SET last_used=? WHERE user_id=? AND client_id=?').bind(nowMs(), user.id, rec.clientId).run();
  return ok(out, ctx);
});
router.get('/api/oauth/.well-known', async (ctx) => {
  const api = ctx.env.API_ORIGIN || `${ctx.url.origin}`;
  const site = ctx.env.SITE_ORIGIN || api;
  return ok({
    issuer: site, authorization_endpoint: `${site}/authorize.html`, token_endpoint: `${api}/api/oauth/token`,
    userinfo_endpoint: `${api}/api/oauth/userinfo`, revocation_endpoint: `${api}/api/oauth/revoke`,
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'], scopes_supported: Object.keys(OAUTH_SCOPES),
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
  }, ctx);
});
router.get('/api/oauth/grants', async (ctx) => {
  const { env, user } = ctx;
  if (!user) unauth();
  const rows = (await env.DB1.prepare('SELECT * FROM oauth_grants WHERE user_id = ? ORDER BY last_used DESC').bind(user.id).all()).results || [];
  const list = [];
  for (const g of rows) {
    const app = await getOAuthApp(env, g.client_id);
    const gs = jsonOr([], g.scopes);
    list.push({ clientId: g.client_id, name: app?.name || g.name, logo: app?.logo || g.logo || '', homepage: app?.homepage || '', scopes: gs, createdAt: g.created_at, lastUsed: g.last_used, scopeInfo: gs.map((s) => ({ key: s, zh: OAUTH_SCOPES[s]?.zh || s, en: OAUTH_SCOPES[s]?.en || s })) });
  }
  return ok({ grants: list }, ctx);
});
router.delete('/api/oauth/grants/:clientId', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  await env.DB1.prepare('DELETE FROM oauth_grants WHERE user_id = ? AND client_id = ?').bind(user.id, params.clientId).run();
  const tk = (await env.DB1.prepare('SELECT token_hash FROM oauth_tokens WHERE user_id = ? AND client_id = ?').bind(user.id, params.clientId).all()).results || [];
  let killed = 0;
  for (const t of tk) { await env.DB1.prepare('DELETE FROM oauth_tokens WHERE token_hash = ?').bind(t.token_hash).run(); killed++; }
  await writeAudit(env, user, 'oauth.grant.revoke', params.clientId, String(killed));
  return ok({ revoked: true, tokens: killed }, ctx);
});

/* ========================================================================== *
 * 20.5 部署登记（可选 · 默认全关）
 *
 * 开关在 wrangler.toml 的 DEPLOY_REGISTRY_*，说明见 docs/DEPLOY_REGISTRY.md。
 * 三个通道互相独立：配置器生成本地留档、GET /api/deploy-info 公开接口、
 * cron 与首请求向登记仓库提 Issue。关掉时接口 404，也不产生任何出网请求。
 * ========================================================================== */

const REGISTRY_KEY = 'sys:deploy-registry';
let _registryDay = '';   // isolate 内当天是否已处理，避免每个请求都读 KV

function registryConfig(env) {
  return {
    enabled: String(env.DEPLOY_REGISTRY_ENABLED || '') === 'true',
    isPublic: String(env.DEPLOY_REGISTRY_PUBLIC || '') === 'true',
    issue: String(env.DEPLOY_REGISTRY_ISSUE || '') === 'true',
    repo: String(env.DEPLOY_REGISTRY_REPO || '').trim(),
    token: String(env.GITHUB_REGISTRY_TOKEN || '').trim(),
  };
}

async function registryState(env) {
  try { return (await KV.getJSON(env, REGISTRY_KEY)) || {}; } catch { return {}; }
}

async function registrySave(env, patch) {
  const next = { ...(await registryState(env)), ...patch };
  try { await KV.putJSON(env, REGISTRY_KEY, next, { expirationTtl: 86400 * 400 }); } catch { /* ignore */ }
  return next;
}

/** 本站自述信息：只读 env，不含任何用户数据 */
function registrySelf(env) {
  return {
    siteName: String(env.SITE_NAME || 'MarytOpens'),
    siteOrigin: String(env.FRONTEND_ORIGIN || '').replace(/\/+$/, ''),
    apiOrigin: String(env.API_ORIGIN || '').replace(/\/+$/, ''),
    version: VERSION,
  };
}

async function registryInstanceId(env, state) {
  if (state.instanceId) return state.instanceId;
  const self = registrySelf(env);
  const h = await sha256Hex(`${self.siteOrigin}|${self.apiOrigin}|${self.siteName}`);
  return h.slice(0, 16);
}

/* —— 通道 2：公开部署信息接口 —— */
router.get('/api/deploy-info', async (ctx) => {
  const { env } = ctx;
  const cfg = registryConfig(env);
  if (!cfg.enabled) return fail(404, 'NO_ROUTE', '接口不存在：GET /api/deploy-info', ctx);
  const state = await registryState(env);
  const self = registrySelf(env);
  const base = {
    siteName: self.siteName,
    version: self.version,
    registryEnabled: true,
    registeredAt: state.registeredAt || 0,
  };
  // 非公开模式只回探活级信息，不暴露域名与实例标识
  if (!cfg.isPublic) return ok(base, ctx);
  return ok({
    ...base,
    siteOrigin: self.siteOrigin,
    apiOrigin: self.apiOrigin,
    instanceId: await registryInstanceId(env, state),
    registered: !!state.registeredAt,
    issue: state.issueUrl || '',
  }, ctx);
});

/* —— 通道 3：静默登记，失败忽略 —— */
async function registryRegister(env) {
  const cfg = registryConfig(env);
  if (!cfg.enabled || !cfg.issue || !cfg.repo || !cfg.token) return;

  const day = new Date().toISOString().slice(0, 10);
  if (_registryDay === day) return;
  _registryDay = day;

  const state = await registryState(env);
  if (state.lastPing === day) return;

  const self = registrySelf(env);
  const instanceId = await registryInstanceId(env, state);

  try {
    if (!state.issueNumber) {
      const title = `[deploy] ${self.siteName} · ${self.apiOrigin || self.siteOrigin || 'unknown'}`;
      const body = [
        'MarytOpens 实例部署登记（由 Worker 自动提交，不含用户数据）',
        '',
        '| 字段 | 值 |',
        '| --- | --- |',
        `| 站点名 | ${self.siteName} |`,
        `| 前端 | ${self.siteOrigin || '-'} |`,
        `| API | ${self.apiOrigin || '-'} |`,
        `| 实例 | \`${instanceId}\` |`,
        `| 版本 | v${self.version} |`,
        `| 首次登记 | ${new Date().toISOString()} |`,
        '',
        '<sub>如不想被登记，把 DEPLOY_REGISTRY_ISSUE 设为 false 即可。</sub>',
      ].join('\n');
      const res = await fetch(`https://api.github.com/repos/${cfg.repo}/issues`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfg.token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'marytopens-registry',
        },
        body: JSON.stringify({ title, body }),
      });
      if (res.ok) {
        const j = await res.json().catch(() => ({}));
        await registrySave(env, {
          instanceId,
          issueNumber: j.number || 0,
          issueUrl: j.html_url || '',
          registeredAt: nowMs(),
        });
      } else {
        console.log('[registry] 登记被拒绝：', res.status);
      }
    }
    await registrySave(env, { lastPing: day, lastSeenAt: nowMs(), instanceId });
  } catch (e) {
    console.log('[registry] 登记失败（已忽略）：', e?.message || e);
  }
}

/* —— 通道 4：把登记仓库里的 Issue 聚合成「谁在用」列表 —— */

const INSTANCES_KEY = 'sys:instances-cache';
const INSTANCES_TTL = 10 * 60 * 1000;   // 10 分钟，别把 GitHub 的匿名配额打满

/** 从登记 Issue 里抽出站点信息。标题形如 `[deploy] 站点名 · api域名` */
function parseRegistryIssue(issue) {
  const title = String(issue.title || '');
  const m = title.match(/^\[deploy\]\s*(.+?)\s*·\s*(.+)$/);
  const body = String(issue.body || '');
  const pick = (label) => {
    const mm = body.match(new RegExp('\\|\\s*' + label + '\\s*\\|\\s*([^|]+?)\\s*\\|'));
    return mm ? mm[1].trim() : '';
  };
  return {
    siteName: m ? m[1] : (pick('站点名') || '未命名站点'),
    apiOrigin: m ? m[2] : pick('API'),
    siteOrigin: pick('前端'),
    instanceId: pick('实例').replace(/`/g, ''),
    version: pick('版本').replace(/^v/, ''),
    registeredAt: pick('首次登记'),
    lastSeenAt: issue.updated_at || issue.created_at || '',
    issueUrl: issue.html_url || '',
  };
}

router.get('/api/instances', async (ctx) => {
  const { env } = ctx;
  const cfg = registryConfig(env);
  if (!cfg.repo) return fail(503, 'REGISTRY_OFF', '本站没有配置登记仓库', ctx);

  const cached = await KV.getJSON(env, INSTANCES_KEY).catch(() => null);
  if (cached?.at && Date.now() - cached.at < INSTANCES_TTL) {
    return ok({ ...cached.data, cached: true });
  }

  let list;
  try {
    const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'marytopens-registry' };
    if (cfg.token) headers['Authorization'] = `Bearer ${cfg.token}`;
    const res = await fetch(
      `https://api.github.com/repos/${cfg.repo}/issues?state=all&per_page=100&sort=updated`,
      { headers });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const arr = await res.json();
    list = (Array.isArray(arr) ? arr : [])
      .filter((i) => !i.pull_request && /^\[deploy\]/.test(String(i.title || '')))
      .map(parseRegistryIssue);
  } catch (e) {
    console.log('[instances] 拉取登记失败：', e?.message || e);
    // 有旧缓存就先用旧的；没有则返回空列表 + 提示，而不是让前端报错
    if (cached?.data) return ok({ ...cached.data, cached: true, stale: true });
    return ok({
      count: 0,
      repo: cfg.repo,
      repoUrl: `https://github.com/${cfg.repo}`,
      updatedAt: nowMs(),
      degraded: true,
      message: '暂时读不到登记仓库（多为 GitHub 接口限流）。配置 GITHUB_REGISTRY_TOKEN 可大幅提高限额。',
      instances: [],
    });
  }

  const data = {
    count: list.length,
    repo: cfg.repo,
    repoUrl: `https://github.com/${cfg.repo}`,
    updatedAt: nowMs(),
    instances: list,
  };
  try {
    await KV.putJSON(env, INSTANCES_KEY, { at: Date.now(), data }, { expirationTtl: 3600 });
  } catch { /* 缓存写失败不影响返回 */ }
  return ok(data);
});


/* ========================================================================== *
 * 21. 主入口
 * ========================================================================== */

export default {
  async fetch(request, env, execCtx) {
    const started = Date.now();
    CURRENT_EXEC_CTX = execCtx;   // 供 pushNotification 等非路由函数发起后台任务
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    // —— D1 KV 模拟层（#104）：把整站 KV 读写重定向到 D1，file: 二进制键仍走真实 KV ——
    if (env.DB1 && !env.DB.__moKVShim) env.DB = makeKV(env.DB, env.DB1);

    // —— 预检 ——
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, ...SECURITY_HEADERS } });
    }

    const ctx = {
      request, env, url, cors, execCtx,
      waitUntil: (p) => execCtx.waitUntil(p),
      user: null, bot: null, params: {}, body: {},
      locale: negotiateLocale(request),
    };

    try {
      if (!env.JWT_SECRET) {
        return fail(500, 'NO_JWT_SECRET', '服务端未配置 JWT_SECRET，请执行 wrangler secret put JWT_SECRET', ctx);
      }
      // bootstrap 里有 KV 写（补种系统身份组等）。若当天 KV 写配额耗尽或 KV 抖动，
      // 绝不能让它把每一个接口都拖成 500——降级继续，下次请求再重试。
      try { await bootstrap(env); }
      catch (e) { console.error('[bootstrap] 初始化失败，降级继续：', e?.message || e); }

      // 部署登记（可选）：isolate 内当天最多跑一次
      if (String(env.DEPLOY_REGISTRY_ENABLED || '') === 'true') {
        execCtx.waitUntil(registryRegister(env).catch(() => {}));
      }

      // —— 全局限流 ——
      const ip = clientIP(request);
      const rlMax = parseInt(env.RATE_LIMIT_MAX || '120', 10);
      const rlWin = parseInt(env.RATE_LIMIT_WINDOW || '60', 10);
      if (!(await rateLimit(env, `glb:${ip}`, rlMax, rlWin))) {
        return fail(429, 'RATE_LIMITED', '请求过于频繁，请稍后再试', ctx);
      }

      // —— IP 封禁（放行只读的 meta / health，便于前端展示封禁提示） ——
      const banExempt = ['/api/meta', '/api/health'].includes(url.pathname);
      if (!banExempt) {
        const ban = await checkIPBan(env, ip);
        if (ban) {
          return fail(403, 'IP_BANNED', `你的 IP 已被封禁${ban.reason ? '：' + ban.reason : ''}`, ctx,
            { until: ban.until || 0 });
        }
      }

      // —— 身份识别 ——
      if (request.headers.get('X-Bot-Token')) ctx.bot = await authenticateBot(request, env);
      else ctx.user = await authenticate(request, env);

      // —— 在线态刷新（纯内存，零 KV）：登录用户按 uid，访客按 IP ——
      if (ctx.user) touchPresence(ctx.user);
      else if (!ctx.bot && url.pathname !== '/api/health') touchGuest(ip);

      // —— 强制邮箱验证守卫：被超管「要求验证」但尚未验证的用户，仅允许只读与验证相关请求 ——
      if (ctx.user && ctx.user.flags?.forceVerify && !ctx.user.emailVerified) {
        const isRead = ['GET', 'HEAD', 'OPTIONS'].includes(request.method);
        const p = url.pathname;
        const isVerifyPath =
          p === '/api/auth/verify-email' ||
          p === '/api/auth/send-code' ||
          p === '/api/auth/me' ||
          p === '/api/auth/logout' ||
          p === '/api/auth/refresh' ||
          p.startsWith('/api/meta');
        if (!isRead && !isVerifyPath) {
          return fail(403, 'EMAIL_VERIFY_REQUIRED', '管理员要求你先完成邮箱验证后再继续操作。', ctx);
        }
      }

      // —— CSRF：跨站写操作要求 Origin 在白名单内（支持同根域子域自动放行） ——
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !ctx.bot) {
        const origin = request.headers.get('Origin');
        if (origin && !isAllowedOrigin(origin, env)) {
          return fail(403, 'BAD_ORIGIN', '请求来源不被允许', ctx);
        }
      }

      // —— 路由分发 ——
      const matched = router.match(request.method, url.pathname);
      if (!matched) {
        if (url.pathname === '/' || url.pathname === '') {
          return json({ ok: true, service: 'MarytOpens API', version: VERSION, docs: '/api/meta' }, {}, ctx);
        }
        return fail(404, 'NO_ROUTE', `接口不存在：${request.method} ${url.pathname}`, ctx);
      }
      ctx.params = matched.params;
      if (!['GET', 'HEAD'].includes(request.method) && !url.pathname.startsWith('/api/upload/')) {
        ctx.body = await readBody(request);
      }

      const res = await matched.handler(ctx);
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
      execCtx.waitUntil(writeAccessLog(env, request, ctx, out.status, Date.now() - started));
      return out;

    } catch (e) {
      if (e instanceof HttpError) {
        execCtx.waitUntil(writeAccessLog(env, request, ctx, e.status, Date.now() - started));
        return fail(e.status, e.code, e.message, ctx, e.extra);
      }
      console.error('[UNCAUGHT]', url.pathname, e?.stack || String(e));
      execCtx.waitUntil(writeAccessLog(env, request, ctx, 500, Date.now() - started));
      return fail(500, 'INTERNAL', '服务器内部错误，请稍后再试', ctx,
        { detail: String(e?.message || e).slice(0, 200) });
    }
  },

  /* ---------------------------- 定时任务 ---------------------------------- */
  async scheduled(event, env, execCtx) {
    if (env.DB1 && !env.DB.__moKVShim) env.DB = makeKV(env.DB, env.DB1);
    execCtx.waitUntil((async () => {
      const day = new Date().toISOString().slice(0, 10);
      // 0) 把内存里尚未落盘的访问日志/计数刷掉
      await flushAccessLog(env);
      // 0.5) 部署登记心跳（未开启则直接返回）
      await registryRegister(env).catch(() => {});
      // 1) 自动解除到期封禁
      const { keys: banKeys } = await KV.list(env, 'ban:ip:', 500);
      for (const k of banKeys) {
        const b = await KV.getJSON(env, k.name);
        if (b?.until && b.until < nowMs()) await KV.del(env, k.name);
      }
      // 2) 自动解除到期账号封禁
      const { keys: userKeys } = await KV.list(env, 'user:', 500);
      let unbanned = 0;
      for (const k of userKeys) {
        const u = await KV.getJSON(env, k.name);
        if (u?.flags?.banned && u.flags.bannedUntil && u.flags.bannedUntil < nowMs()) {
          u.flags.banned = false; u.flags.bannedUntil = 0; u.flags.bannedReason = '';
          await saveUser(env, u); unbanned++;
        }
      }
      // 3) 站点日快照
      await KV.putJSON(env, `snap:${day}`, {
        date: day,
        users: await readStat(env, 'users'),
        posts: await readStat(env, 'posts'),
        comments: await readStat(env, 'comments'),
        pv: parseInt((await env.DB.get(`stat:pv:${day}`)) || '0', 10),
        unbanned,
      }, { expirationTtl: 86400 * 400 });
      // 4) 清理 D1 中已过期的 KV 模拟键（自管过期，KV 原本是边缘自动清理）
      if (env.DB1) {
        try { await env.DB1.prepare('DELETE FROM kv_store WHERE expires IS NOT NULL AND expires < ?').bind(Math.floor(Date.now() / 1000)).run(); }
        catch (_) { /* 清理失败不影响主流程 */ }
        // 5) 清理 7 天前的 MeowChat 中继密文（中继只是邮筒，不长期保存）
        try { await env.DB1.prepare('DELETE FROM meowchat_messages WHERE created_at < ?').bind(nowMs() - 7 * 24 * 60 * 60 * 1000).run(); }
        catch (_) {}
      }
      console.log('[cron] daily maintenance done', day, 'unbanned:', unbanned);
    })());
  },
};
