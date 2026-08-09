/**
 * ============================================================================
 *  MarytOpens · Cloudflare Worker 后端总入口
 *  ------------------------------------------------------------------------
 *  Runtime : Cloudflare Workers (ES Module)
 *  Storage : KV (binding: DB) + R2 (binding: MEDIA)
 *  Domain  : https://api.natrois.top
 *  Front   : https://natrois.top
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
  // —— 结构治理 ——
  'channel.create':    { scope: 'G', label: '创建频道' },
  'channel.manage':    { scope: 'S', label: '管理频道（改名/图标/权限）' },
  'group.create':      { scope: 'S', label: '在频道内创建群组' },
  'group.manage':      { scope: 'S', label: '管理群组' },
  'board.manage':      { scope: 'S', label: '管理板块' },
  'role.manage':       { scope: 'S', label: '在本作用域创建/编辑身份组' },
  'invite.create':     { scope: 'S', label: '生成邀请' },
  // —— 交互 ——
  'dm.send':           { scope: 'G', label: '发送私信' },
  'react.use':         { scope: 'G', label: '点赞/收藏/关注' },
};

const ALL_PERMS = Object.keys(PERMISSIONS);

/** 预设身份组模板（创建作用域时自动落地） */
const ROLE_TEMPLATES = {
  super_admin: { name: '超级管理员', color: '#ef4444', priority: 1000, perms: ['site.admin'] },
  admin: {
    name: '站点管理员', color: '#f97316', priority: 900,
    perms: ['site.config','site.logs','site.mail','user.ban','user.mute','user.rename','user.role',
            'user.viewprivate','ip.ban','post.delete.any','post.edit.any','post.pin','post.lock',
            'comment.delete.any','report.handle','channel.create','channel.manage','role.manage',
            'post.create','comment.create','dm.send','react.use'],
  },
  channel_owner: {
    name: '频道主', color: '#8b5cf6', priority: 700,
    perms: ['channel.manage','group.create','group.manage','role.manage','user.mute','user.rename',
            'user.role','post.delete.any','post.edit.any','post.pin','post.lock','comment.delete.any',
            'report.handle','invite.create','post.create','comment.create','dm.send','react.use'],
  },
  channel_admin: {
    name: '频道管理员', color: '#6366f1', priority: 650,
    perms: ['group.manage','user.mute','post.delete.any','post.pin','post.lock','comment.delete.any',
            'report.handle','invite.create','post.create','comment.create','dm.send','react.use'],
  },
  group_owner: {
    name: '群主', color: '#0ea5e9', priority: 600,
    perms: ['group.manage','role.manage','user.mute','user.role','post.delete.any','post.pin',
            'comment.delete.any','invite.create','post.create','comment.create','dm.send','react.use'],
  },
  group_admin: {
    name: '群管理员', color: '#14b8a6', priority: 550,
    perms: ['user.mute','post.delete.any','comment.delete.any','invite.create',
            'post.create','comment.create','dm.send','react.use'],
  },
  board_moderator: {
    name: '版主', color: '#22c55e', priority: 500,
    perms: ['board.manage','user.mute','post.delete.any','post.edit.any','post.pin','post.lock',
            'comment.delete.any','report.handle','post.create','comment.create','dm.send','react.use'],
  },
  board_worker: {
    name: '板块工作者', color: '#84cc16', priority: 400,
    perms: ['post.pin','comment.delete.any','report.handle','post.create','comment.create','dm.send','react.use'],
  },
  member:  { name: '成员', color: '#64748b', priority: 100, perms: ['post.create','comment.create','dm.send','react.use'] },
  muted:   { name: '被禁言', color: '#94a3b8', priority: 50,  perms: [] },
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
  footerText: 'MarytOpens | MarytTeam © 2026 | Built for modern community governance, local models, and developer workflows.\n\nDesigned for fast collaboration, review workflows, and next-gen local gateway integration.',
  navLinks: [],                       // [{id,label,url,position,icon,target,visibleTo}]
  announcement: '',
  links: {                            // 超管在后台设定的外部入口（落地页/页脚使用）
    discord: '',                     // Discord 社区邀请/服务器 URL
    github: '',                      // GitHub 组织/仓库 URL
    telegram: '',                    // Telegram 频道/群组/个人主页 URL（自动解析头像）
    telegramAvatar: '',              // 自动解析得到的 Telegram 头像（留空则用图标）
    telegramTitle: '',               // 自动解析得到的 Telegram 名称
    download: 'https://natrois.top/downloads/files', // 客户端下载页 URL（Desktop / Android APK）
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

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const list = allowedOriginList(env);
  const ok = list.includes(origin);
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

async function rateLimit(env, key, max, windowSec) {
  const bucket = `rl:${key}:${Math.floor(nowSec() / windowSec)}`;
  const cur = parseInt((await env.DB.get(bucket)) || '0', 10);
  if (cur >= max) return false;
  await env.DB.put(bucket, String(cur + 1), { expirationTtl: Math.max(60, windowSec * 2) });
  return true;
}

async function guardRate(env, key, max, windowSec, msg = '操作过于频繁，请稍后再试') {
  if (!(await rateLimit(env, key, max, windowSec))) toomany(msg);
}

/* ------------------------------ 访问日志 --------------------------------- */

async function writeAccessLog(env, request, ctx, status, ms) {
  try {
    const m = clientMeta(request);
    const url = new URL(request.url);
    const rec = {
      t: nowMs(), ip: m.ip, ua: m.ua, country: m.country, city: m.city, colo: m.colo,
      method: request.method, path: url.pathname, status, ms,
      uid: ctx?.user?.id || null, uname: ctx?.user?.username || null,
    };
    const ttl = parseInt(env.LOG_TTL_SECONDS || '2592000', 10);
    await env.DB.put(`log:${sortableId()}`, JSON.stringify(rec), {
      expirationTtl: ttl,
      metadata: { t: rec.t, ip: rec.ip, path: rec.path, status, uid: rec.uid },
    });
    // 日活统计计数
    const day = new Date().toISOString().slice(0, 10);
    const ck = `stat:pv:${day}`;
    const pv = parseInt((await env.DB.get(ck)) || '0', 10) + 1;
    await env.DB.put(ck, String(pv), { expirationTtl: 86400 * 400 });
  } catch (_) { /* 日志失败不影响主流程 */ }
}

/* ========================================================================== *
 * 2. 加密：密码哈希 / HMAC / JWT
 * ========================================================================== *
 *  传输安全说明（对应需求「不要明文传密码」）：
 *  ┌ 前端：password → SHA-256(password + ':' + MARYT_CLIENT_PEPPER) → 十六进制
 *  │        只把这串 64 位 hex（clientHash）通过 HTTPS 发给后端。
 *  └ 后端：PBKDF2-HMAC-SHA256(clientHash, randomSalt, 210000 次) 后入库。
 *  即：网络上不存在明文口令，数据库里也不存在可逆口令。
 * ========================================================================== */

const PBKDF2_ITER = 210000;

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
 *   ch:<channelId>                   频道
 *   grp:<channelId>:<groupId>        群组
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
function publicUser(u, viewer = null, extra = {}) {
  if (!u) return null;
  const self = viewer && viewer.id === u.id;
  const isAdmin = viewer && viewer.__isSuper;
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName || u.username,
    avatar: u.avatar || '',
    banner: u.banner || '',
    bio: u.bio || '',
    links: u.links || [],
    stats: u.stats || {},
    roleTags: extra.roleTags || [],
    createdAt: u.createdAt,
    banned: !!u.flags?.banned,
    mutedUntil: u.flags?.mutedUntil || 0,
    ...(self || isAdmin ? {
      email: u.email, emailVerified: !!u.emailVerified,
      locale: u.locale, theme: u.theme, timeFormat: u.timeFormat,
      oauth: { github: !!u.oauth?.github, discord: !!u.oauth?.discord },
      notifySettings: u.notifySettings || {},
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
    links: [],
    roles: { global: ['role_member'] },
    flags: { banned: false, bannedReason: '', bannedUntil: 0, bannedAt: 0, mutedUntil: 0 },
    oauth: {},
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

/** 为某作用域落地预设身份组 */
async function seedRoles(env, scope, templates) {
  const out = [];
  for (const key of templates) {
    const t = ROLE_TEMPLATES[key];
    if (!t) continue;
    const id = `role_${key}`;
    const exist = await getRole(env, scope, id);
    if (exist) { out.push(exist); continue; }
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

/** 作用域链：'group:ch1:g2' → ['group:ch1:g2','channel:ch1','global'] */
function scopeChain(scope) {
  const s = scopeKeyOf(scope);
  if (!s || s === 'global') return ['global'];
  const parts = s.split(':');
  const chain = [s];
  if (parts[0] === 'group' && parts.length >= 3) chain.push(`channel:${parts[1]}`);
  if (parts[0] === 'board' && parts.length >= 3) chain.push(`channel:${parts[1]}`);
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
      for (const p of role.perms || []) perms.add(p);
    }
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
  for (const sc of scopeChain(scope)) {
    const ids = new Set(user.roles?.[sc] || []);
    const mem = sc === 'global' ? null : await getMember(env, sc, user.id);
    for (const r of mem?.roles || []) ids.add(r);
    for (const rid of ids) {
      const role = await getRole(env, sc, rid);
      if (role && role.hoist !== false) tags.push({ id: role.id, name: role.name, color: role.color, scope: sc });
    }
  }
  return tags.slice(0, 6);
}

/* ========================================================================== *
 * 5. 外部服务：Turnstile / Cloud Mail / OAuth / Cloudflare API
 * ========================================================================== */

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
    if (provider === 'console' || (!token && provider !== 'mailchannels')) {
      console.log('[MAIL:console]', to, subject, payloadText?.slice(0, 200));
      return { ok: true, provider: 'console' };
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
};

async function oauthExchange(env, provider, code, redirectUri) {
  const cfg = OAUTH[provider];
  const body = new URLSearchParams({
    client_id: env[cfg.idKey], client_secret: env[cfg.secretKey],
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
  const tsSiteKey = tsEnabled ? (ts.siteKey || env.TURNSTILE_SITE_KEY || '') : '';
  return ok({
    version: VERSION,
    locale: negotiateLocale(request),
    supportedLocales: SUPPORTED_LOCALES,
    turnstileSiteKey: tsSiteKey,
    turnstile: {
      enabled: tsEnabled && !!tsSiteKey,
      login: cfg.turnstileOnLogin, register: cfg.turnstileOnRegister, post: cfg.turnstileOnPost,
    },
    oauth: {
      github: cfg.allowGithubLogin && !!env.GITHUB_CLIENT_ID,
      discord: cfg.allowDiscordLogin && !!env.DISCORD_CLIENT_ID,
    },
    mail: {
      provider: (cfg.mail && cfg.mail.provider) || env.MAIL_PROVIDER || 'console',
      configured: ((cfg.mail && cfg.mail.provider) || env.MAIL_PROVIDER || 'console') === 'mailchannels'
        ? true
        : !!( (cfg.mail && cfg.mail.apiToken) || env.MAIL_API_TOKEN ),
      from: (cfg.mail && cfg.mail.from) || env.MAIL_FROM || '',
    },
    site: pick(cfg, ['siteTitle','siteSubtitle','favicon','logo','landingMode','loginBackground',
      'loginBackgroundBlur','themeDefault','accent','registerOpen','footerText','navLinks',
      'announcement','links','personal','about','contributors','announcements','seo']),
    stats: {
      users: await readStat(env, 'users'),
      posts: await readStat(env, 'posts'),
      comments: await readStat(env, 'comments'),
      channels: await readStat(env, 'channels'),
    },
    serverTime: nowMs(),
  }, ctx);
});

router.get('/api/health', async (ctx) => ok({ status: 'healthy', version: VERSION, time: nowMs() }, ctx));

router.get('/api/permissions/catalog', async (ctx) => ok({
  permissions: Object.entries(PERMISSIONS).map(([k, v]) => ({ key: k, ...v })),
  templates: Object.entries(ROLE_TEMPLATES).map(([k, v]) => ({ key: k, ...v })),
}, ctx));

/* ========================================================================== *
 * 9. 认证：注册 / 登录 / 验证码 / OAuth
 * ========================================================================== */

const USERNAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5-]{2,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function createSession(env, user, request, ctx) {
  const ttl = parseInt(env.JWT_TTL_SECONDS || '604800', 10);
  const token = await signJWT({ sub: user.id, ver: user.tokenVersion || 1, u: user.username }, env.JWT_SECRET, ttl);
  user.lastLoginAt = nowMs();
  user.lastIP = clientIP(request);
  await saveUser(env, user);
  const headers = { 'Set-Cookie': sessionCookie(token, env, ttl) };
  return { token, ttl, headers };
}

router.post('/api/auth/send-code', async (ctx) => {
  const { env, request, body } = ctx;
  const email = String(body.email || '').trim().toLowerCase();
  const purpose = ['register', 'reset', 'bind', 'login'].includes(body.purpose) ? body.purpose : 'register';
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
  return ok({ sent: true, provider: res.provider, delivered: res.ok }, ctx);
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
  await bumpStat(env, 'users');

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
    permissions: perms,
    roleTags: await roleTagsOf(env, user, 'global'),
    unread: await unreadCount(env, user.id),
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
  if (!env[cfg.idKey]) bad(`未配置 ${cfg.idKey}`);

  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') === 'bind' ? 'bind' : 'login';
  const next = url.searchParams.get('next') || '/home.html';
  const state = await signBlob(env, { p: provider, mode, next, uid: ctx.user?.id || null, n: uid() }, 900);
  const redirectUri = `${env.API_ORIGIN}/api/oauth/${provider}/callback`;

  const auth = new URL(cfg.authorize);
  auth.searchParams.set('client_id', env[cfg.idKey]);
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
  const accessToken = await oauthExchange(env, provider, code, redirectUri);
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
    await bumpStat(env, 'users');
  }
  user.oauth = { ...(user.oauth || {}), [provider]: { id: p.pid, username: p.username, url: p.profileUrl } };
  if (!user.avatar && p.avatar) user.avatar = p.avatar;
  await saveUser(env, user);
  await env.DB.put(oauthKey(provider, p.pid), user.id);

  if (user.flags?.banned) return Response.redirect(`${env.FRONTEND_ORIGIN}/login.html?error=banned`, 302);

  const s = await createSession(env, user, request, ctx);
  const target = new URL(state.next?.startsWith('/') ? env.FRONTEND_ORIGIN + state.next : `${env.FRONTEND_ORIGIN}/home.html`);
  target.searchParams.set('token', s.token);            // 跨站点无法共享 Cookie 时的兜底
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
  // 创建 KV 命名空间需要 Workers KV Storage:Edit，建库需要 D1:Edit
  scope: 'account:read workers_kv_storage:edit d1:edit',
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
  if (!env.CF_OAUTH_CLIENT_ID) return Response.redirect(`${env.FRONTEND_ORIGIN}/files.html?cf=no_config`, 302);
  const verifier = b64urlEncode(crypto.getRandomValues(new Uint8Array(48))).replace(/=+$/, '');
  const state = await signBlob(env, { uid: user.id, v: verifier }, 900);
  const redirectUri = `${env.API_ORIGIN}/api/cf/bind/callback`;
  const auth = new URL(CF_OAUTH.authorize);
  auth.searchParams.set('client_id', env.CF_OAUTH_CLIENT_ID);
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

  let tok = null;
  try {
    const r = await fetch(CF_OAUTH.token, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code,
        client_id: env.CF_OAUTH_CLIENT_ID, client_secret: env.CF_OAUTH_CLIENT_SECRET || '',
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

/* ========================================================================== *
 * 11. 通知系统
 * ========================================================================== */

async function pushNotification(env, userId, { type, title, body, link = '', actor = null, refId = '' }) {
  if (!userId) return;
  const id = sortableId();
  const rec = { id, type, title, body: String(body || '').slice(0, 500), link, actor, refId, read: false, createdAt: nowMs() };
  await KV.putJSON(env, `notif:${userId}:${id}`, rec, {
    expirationTtl: 86400 * 180,
    metadata: { t: rec.createdAt, type, read: false },
  });
  const k = `notifcnt:${userId}`;
  await env.DB.put(k, String(parseInt((await env.DB.get(k)) || '0', 10) + 1));
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
  return {
    id: p.id, slug: p.slug, title: p.title,
    excerpt: p.excerpt || String(p.content || '').replace(/[#*`>\-\[\]!]/g, '').slice(0, 160),
    cover: p.cover || '', tags: p.tags || [], board: p.board || '', scope: p.scope || 'global',
    visibility: p.visibility, pinned: !!p.pinned, featured: !!p.featured, locked: !!p.locked,
    status: p.status, createdAt: p.createdAt, updatedAt: p.updatedAt,
    counts: p.counts || { views: 0, likes: 0, comments: 0, favorites: 0 },
    author: author ? { id: author.id, username: author.username, displayName: author.displayName, avatar: author.avatar } : null,
    liked: viewer ? !!(await env.DB.get(`like:${p.id}:${viewer.id}`)) : false,
    favorited: viewer ? !!(await env.DB.get(`fav:${viewer.id}:${p.id}`)) : false,
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

  let prefix = 'ixp:all:';
  if (mine) { if (!user) unauth(); prefix = `ixp:user:${user.id}:`; }
  else if (authorId) prefix = `ixp:user:${authorId}:`;
  else if (board) prefix = `ixp:board:${board}:`;
  else if (scope) prefix = `ixp:scope:${scopeKeyOf(scope)}:`;

  // 搜索或过滤时多抓一些再筛
  const fetchN = q ? Math.min(300, limit * 8) : limit * 3;
  const { keys, cursor, list_complete } = await KV.list(env, prefix, fetchN, url.searchParams.get('cursor'));
  const ids = keys.map((k) => k.name.split(':').pop());
  const posts = (await KV.many(env, ids.map((i) => `post:${i}`))).filter(Boolean);

  const out = [];
  for (const p of posts) {
    if (p.status === 'deleted') continue;
    if (q && !(`${p.title} ${p.excerpt} ${(p.tags || []).join(' ')}`.toLowerCase().includes(q))) continue;
    if (!(await canViewPost(env, p, user))) continue;
    out.push(await postCard(env, p, user));
    if (out.length >= limit) break;
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
  const ids = keys.map((k) => k.name.split(':').pop());
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
  let html;
  try {
    const res = await fetch(u.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarytOpensBot/1.0)' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch { return null; }
  if (!html) return null;
  const meta = (prop) => {
    const a = html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'));
    if (a) return a[1];
    const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i'));
    return b ? b[1] : null;
  };
  const titleTag = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
  return {
    avatar: meta('og:image') || meta('twitter:image') || '',
    title: meta('og:title') || titleTag || '',
    url: u.toString(),
  };
}

router.get('/api/telegram/resolve', async (ctx) => {
  const { env, url } = ctx;
  const target = url.searchParams.get('url') || '';
  if (!target) return ok({ avatar: '', title: '' }, ctx);
  const r = await resolveTelegram(env, target);
  return ok({ avatar: r?.avatar || '', title: r?.title || '', url: r?.url || target }, ctx);
});

router.get('/api/posts/:id', async (ctx) => {
  const { env, user, params } = ctx;
  const p = await KV.getJSON(env, `post:${params.id}`);
  if (!p) notfound('文章不存在');
  if (!(await canViewPost(env, p, user))) forbid('你没有权限查看这篇文章');

  p.counts = p.counts || { views: 0, likes: 0, comments: 0, favorites: 0 };
  p.counts.views = (p.counts.views || 0) + 1;
  ctx.waitUntil(KV.putJSON(env, `post:${p.id}`, p));

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
    },
  }, ctx);
});

router.post('/api/posts', async (ctx) => {
  const { env, user, body, request } = ctx;
  if (!user) unauth();
  const scope = scopeKeyOf(body.scope || 'global');
  await requirePerm(env, user, 'post.create', scope);
  if (await isMuted(env, user, scope)) forbid('你当前处于禁言状态，无法发布内容');
  await guardRate(env, `post:${user.id}`, 10, 600, '发帖过于频繁，请稍后再试');
  const cfg = await getSiteConfig(env);
  if (cfg.turnstileOnPost) await guardTurnstile(env, request, body.turnstileToken, 'post');

  const title = String(body.title || '').trim().slice(0, 200);
  if (title.length < 2) bad('标题至少 2 个字符');
  const visibility = VISIBILITIES.includes(body.visibility) ? body.visibility : 'public';
  const id = uid('p');
  const sid = sortableId();
  const content = sanitizeContent(body.content || '');
  const post = {
    id, sid, slug: slugify(title),
    title, content, format: body.format === 'html' ? 'html' : 'markdown',
    excerpt: String(body.excerpt || content.replace(/[#*`>\-\[\]!]/g, '')).slice(0, 200),
    cover: String(body.cover || '').slice(0, 500),
    tags: (Array.isArray(body.tags) ? body.tags : []).slice(0, 8).map((t) => String(t).slice(0, 24)),
    board: String(body.board || 'general').slice(0, 40),
    scope, visibility,
    visibleRoles: Array.isArray(body.visibleRoles) ? body.visibleRoles.slice(0, 20) : [],
    authorId: user.id, status: body.status === 'draft' ? 'draft' : 'published',
    kind: body.kind === 'article' ? 'article' : 'post',
    pinned: false, featured: false, locked: false,
    counts: { views: 0, likes: 0, comments: 0, favorites: 0 },
    createdAt: nowMs(), updatedAt: nowMs(),
  };
  await KV.putJSON(env, `post:${id}`, post);
  await env.DB.put(`ixp:all:${sid}`, id, { metadata: { t: post.createdAt, a: user.id, v: visibility } });
  await env.DB.put(`ixp:user:${user.id}:${sid}`, id);
  await env.DB.put(`ixp:board:${post.board}:${sid}`, id);
  await env.DB.put(`ixp:scope:${scope}:${sid}`, id);
  user.stats = user.stats || {};
  user.stats.posts = (user.stats.posts || 0) + 1;
  await saveUser(env, user);
  await bumpStat(env, 'posts');

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

  return ok({ post: await postCard(env, post, user) }, ctx);
});

router.put('/api/posts/:id', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const p = await KV.getJSON(env, `post:${params.id}`);
  if (!p) notfound('文章不存在');
  const mine = p.authorId === user.id;
  if (!mine) await requirePerm(env, user, 'post.edit.any', p.scope || 'global');

  if (body.title !== undefined) { p.title = String(body.title).slice(0, 200); p.slug = slugify(p.title); }
  if (body.content !== undefined) p.content = sanitizeContent(body.content);
  if (body.excerpt !== undefined) p.excerpt = String(body.excerpt).slice(0, 200);
  if (body.cover !== undefined) p.cover = String(body.cover).slice(0, 500);
  if (body.tags !== undefined) p.tags = (body.tags || []).slice(0, 8).map((t) => String(t).slice(0, 24));
  if (body.visibility && VISIBILITIES.includes(body.visibility)) p.visibility = body.visibility;
  if (body.visibleRoles !== undefined) p.visibleRoles = (body.visibleRoles || []).slice(0, 20);
  if (body.pinned !== undefined && await hasPerm(env, user, 'post.pin', p.scope)) p.pinned = !!body.pinned;
  if (body.featured !== undefined && await hasPerm(env, user, 'post.pin', p.scope)) p.featured = !!body.featured;
  if (body.locked !== undefined && await hasPerm(env, user, 'post.lock', p.scope)) p.locked = !!body.locked;
  if (body.status !== undefined && mine && ['draft', 'published'].includes(body.status)) p.status = body.status;
  p.updatedAt = nowMs();
  await KV.putJSON(env, `post:${p.id}`, p);
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
    ]);
  } else {
    p.status = 'deleted'; p.deletedBy = user.id; p.deletedAt = nowMs();
    await KV.putJSON(env, `post:${p.id}`, p);
    await pushNotification(env, p.authorId, {
      type: 'moderation', title: '你的文章已被移除', body: `《${p.title}》被管理员移除`, refId: p.id });
  }
  await bumpStat(env, 'posts', -1);
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
  const items = [];
  for (const c of raw) {
    if (c.status === 'deleted') { items.push({ ...c, content: '（该评论已被删除）', author: null }); continue; }
    const a = await getUser(env, c.authorId);
    items.push({
      ...c,
      author: a ? { id: a.id, username: a.username, displayName: a.displayName, avatar: a.avatar,
                    roleTags: await roleTagsOf(env, a, p.scope || 'global') } : null,
      canDelete: !!user && (user.id === c.authorId || await hasPerm(env, user, 'comment.delete.any', p.scope || 'global')),
    });
  }
  items.sort((a, b) => a.createdAt - b.createdAt);
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
    likes: 0, status: 'published', createdAt: nowMs(),
  };
  await KV.putJSON(env, `cmt:${p.id}:${id}`, c);
  p.counts = p.counts || {};
  p.counts.comments = (p.counts.comments || 0) + 1;
  await KV.putJSON(env, `post:${p.id}`, p);
  user.stats.comments = (user.stats.comments || 0) + 1;
  await saveUser(env, user);
  await bumpStat(env, 'comments');

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
  return ok({ comment: { ...c, author: { id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar } } }, ctx);
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
  await saveUser(env, user);
  return ok({ user: publicUser(user, user) }, ctx);
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
    const rec = await KV.getJSON(env, k.name);
    if (!rec) continue;
    const peer = await getUser(env, rec.peerId);
    items.push({
      threadId: rec.threadId, unread: rec.unread || 0, lastAt: rec.lastAt, lastText: rec.lastText || '',
      peer: peer ? { id: peer.id, username: peer.username, displayName: peer.displayName, avatar: peer.avatar } : null,
    });
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
  const items = (await KV.many(env, keys.map((k) => k.name))).sort((a, b) => a.createdAt - b.createdAt);
  const ix = await KV.getJSON(env, `dmix:${user.id}:${tid}`);
  if (ix?.unread) await KV.putJSON(env, `dmix:${user.id}:${tid}`, { ...ix, unread: 0 });
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

  await KV.putJSON(env, `dmix:${user.id}:${tid}`, { threadId: tid, peerId: peer.id, unread: 0, lastAt: msg.createdAt, lastText: content.slice(0, 60) });
  const peerIx = await KV.getJSON(env, `dmix:${peer.id}:${tid}`);
  await KV.putJSON(env, `dmix:${peer.id}:${tid}`, {
    threadId: tid, peerId: user.id, unread: (peerIx?.unread || 0) + 1, lastAt: msg.createdAt, lastText: content.slice(0, 60) });

  if (peer.notifySettings?.dm !== false) {
    await pushNotification(env, peer.id, {
      type: 'dm', title: `${user.displayName} 给你发了私信`, body: content.slice(0, 60),
      link: `/messages.html?peer=${user.id}`, actor: { id: user.id, name: user.displayName, avatar: user.avatar } });
  }
  return ok({ message: msg }, ctx);
});

/* ========================================================================== *
 * 15. 频道 / 群组 / 板块（Discord 式结构）
 * ========================================================================== */

router.get('/api/channels', async (ctx) => {
  const { env, user } = ctx;
  const { keys } = await KV.list(env, 'ch:', 200);
  const chs = await KV.many(env, keys.map((k) => k.name));
  const items = [];
  for (const c of chs) {
    if (c.visibility === 'private' && user && !(await getMember(env, `channel:${c.id}`, user.id)) && !(await isSuperAdmin(env, user))) continue;
    if (c.visibility === 'private' && !user) continue;
    items.push({ ...c, isOwner: !!user && c.ownerId === user.id,
      canManage: !!user && await hasPerm(env, user, 'channel.manage', `channel:${c.id}`) });
  }
  items.sort((a, b) => (b.order || 0) - (a.order || 0) || a.createdAt - b.createdAt);
  return ok({ items }, ctx);
});

router.post('/api/channels', async (ctx) => {
  const { env, user, body } = ctx;
  if (!user) unauth();
  await requirePerm(env, user, 'channel.create');
  const name = String(body.name || '').trim().slice(0, 40);
  if (name.length < 2) bad('频道名至少 2 个字符');
  const id = uid('c');
  const ch = {
    id, name, slug: slugify(name), icon: String(body.icon || '💬').slice(0, 8),
    description: String(body.description || '').slice(0, 300),
    banner: '', visibility: body.visibility === 'private' ? 'private' : 'public',
    ownerId: user.id, order: 0, memberCount: 1,
    boards: [{ id: 'general', name: '综合讨论', icon: '💡' }],
    createdAt: nowMs(),
  };
  await KV.putJSON(env, `ch:${id}`, ch);
  const scope = `channel:${id}`;
  await seedRoles(env, scope, ['channel_owner','channel_admin','board_moderator','board_worker','group_owner','group_admin','member','muted']);
  await saveMember(env, scope, user.id, { roles: ['role_channel_owner'] });
  await bumpStat(env, 'channels');
  return ok({ channel: ch }, ctx);
});

router.get('/api/channels/:id', async (ctx) => {
  const { env, user, params } = ctx;
  const ch = await KV.getJSON(env, `ch:${params.id}`);
  if (!ch) notfound('频道不存在');
  const scope = `channel:${ch.id}`;
  const { keys } = await KV.list(env, `grp:${ch.id}:`, 200);
  const groups = await KV.many(env, keys.map((k) => k.name));
  const member = user ? await getMember(env, scope, user.id) : null;
  return ok({
    channel: ch,
    groups: groups.sort((a, b) => (a.order || 0) - (b.order || 0)),
    boards: ch.boards || [],
    member,
    roles: await listRoles(env, scope),
    perms: user ? [...(await collectPerms(env, user, scope))] : [],
    canManage: !!user && await hasPerm(env, user, 'channel.manage', scope),
  }, ctx);
});

router.put('/api/channels/:id', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const ch = await KV.getJSON(env, `ch:${params.id}`);
  if (!ch) notfound('频道不存在');
  await requirePerm(env, user, 'channel.manage', `channel:${ch.id}`);
  for (const k of ['name','description','icon','banner','visibility']) {
    if (body[k] !== undefined) ch[k] = String(body[k]).slice(0, 500);
  }
  if (Array.isArray(body.boards)) {
    ch.boards = body.boards.slice(0, 30).map((b) => ({
      id: slugify(b.id || b.name), name: String(b.name || '').slice(0, 40),
      icon: String(b.icon || '📁').slice(0, 8), desc: String(b.desc || '').slice(0, 200) }));
  }
  if (body.order !== undefined) ch.order = Number(body.order) || 0;
  await KV.putJSON(env, `ch:${ch.id}`, ch);
  return ok({ channel: ch }, ctx);
});

router.delete('/api/channels/:id', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const ch = await KV.getJSON(env, `ch:${params.id}`);
  if (!ch) notfound('频道不存在');
  if (ch.ownerId !== user.id) await requirePerm(env, user, 'site.admin');
  await KV.del(env, `ch:${ch.id}`);
  await bumpStat(env, 'channels', -1);
  return ok({ deleted: ch.id }, ctx);
});

router.post('/api/channels/:id/join', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const ch = await KV.getJSON(env, `ch:${params.id}`);
  if (!ch) notfound('频道不存在');
  const scope = `channel:${ch.id}`;
  if (await getMember(env, scope, user.id)) return ok({ joined: true, already: true }, ctx);
  await saveMember(env, scope, user.id, { roles: ['role_member'] });
  ch.memberCount = (ch.memberCount || 0) + 1;
  await KV.putJSON(env, `ch:${ch.id}`, ch);
  return ok({ joined: true }, ctx);
});

router.get('/api/channels/:id/members', async (ctx) => {
  const { env, user, params, url } = ctx;
  const scope = `channel:${params.id}`;
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

/* -------------------------------- 群组 ----------------------------------- */

router.post('/api/channels/:id/groups', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const ch = await KV.getJSON(env, `ch:${params.id}`);
  if (!ch) notfound('频道不存在');
  await requirePerm(env, user, 'group.create', `channel:${ch.id}`);
  const gid = uid('g');
  const g = {
    id: gid, channelId: ch.id, name: String(body.name || '新群组').slice(0, 40),
    type: ['text','voice','forum','announcement'].includes(body.type) ? body.type : 'text',
    icon: String(body.icon || '#').slice(0, 8), topic: String(body.topic || '').slice(0, 300),
    ownerId: user.id, order: Number(body.order) || 0,
    private: !!body.private, memberCount: 1, createdAt: nowMs(),
  };
  await KV.putJSON(env, `grp:${ch.id}:${gid}`, g);
  const scope = `group:${ch.id}:${gid}`;
  await seedRoles(env, scope, ['group_owner','group_admin','member','muted']);
  await saveMember(env, scope, user.id, { roles: ['role_group_owner'] });
  return ok({ group: g }, ctx);
});

router.put('/api/channels/:cid/groups/:gid', async (ctx) => {
  const { env, user, params, body } = ctx;
  if (!user) unauth();
  const key = `grp:${params.cid}:${params.gid}`;
  const g = await KV.getJSON(env, key);
  if (!g) notfound('群组不存在');
  const scope = `group:${params.cid}:${params.gid}`;
  if (!(await hasPerm(env, user, 'group.manage', scope)) && !(await hasPerm(env, user, 'channel.manage', `channel:${params.cid}`)))
    forbid('无权管理该群组');
  for (const k of ['name','topic','icon','type']) if (body[k] !== undefined) g[k] = String(body[k]).slice(0, 300);
  if (body.order !== undefined) g.order = Number(body.order) || 0;
  if (body.private !== undefined) g.private = !!body.private;
  await KV.putJSON(env, key, g);
  return ok({ group: g }, ctx);
});

router.delete('/api/channels/:cid/groups/:gid', async (ctx) => {
  const { env, user, params } = ctx;
  if (!user) unauth();
  const scope = `group:${params.cid}:${params.gid}`;
  if (!(await hasPerm(env, user, 'group.manage', scope)) && !(await hasPerm(env, user, 'channel.manage', `channel:${params.cid}`)))
    forbid('无权删除该群组');
  await KV.del(env, `grp:${params.cid}:${params.gid}`);
  return ok({ deleted: params.gid }, ctx);
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
  return ok({ userId: target.id, scope, roles: roleIds }, ctx);
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
  await bumpStat(env, 'reports');
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
  return ok({
    totals: {
      users: await readStat(env, 'users'),
      posts: await readStat(env, 'posts'),
      comments: await readStat(env, 'comments'),
      channels: await readStat(env, 'channels'),
      reports: await readStat(env, 'reports'),
      openReports,
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
  const { env, body } = ctx;
  await requireAdmin(ctx, 'site.config');
  const cur = await getSiteConfig(env);
  const allowed = ['siteTitle','siteSubtitle','favicon','logo','landingMode','loginBackground','loginBackgroundBlur',
    'themeDefault','accent','registerOpen','requireEmailVerify','turnstileOnLogin','turnstileOnRegister',
    'turnstileOnPost','allowGithubLogin','allowDiscordLogin','footerText','navLinks','announcement','links',
    'personal','about','contributors','announcements','seo'];
  const next = { ...cur };
  for (const k of allowed) if (body[k] !== undefined) next[k] = body[k];
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
      provider: String(body.mail.provider || curMail.provider || 'resend').toLowerCase(),
      from: String(body.mail.from || curMail.from || 'MarytOpens <no-reply@natrois.top>').trim(),
      apiUrl: String(body.mail.apiUrl || curMail.apiUrl || '').trim(),
      apiToken: body.mail.apiToken ? String(body.mail.apiToken) : (curMail.apiToken || ''),
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
  return ok({ config: next }, ctx);
});

router.get('/api/admin/users', async (ctx) => {
  const { env, user, url } = ctx;
  await requireAdmin(ctx, 'user.ban');
  const q = (url.searchParams.get('q') || '').toLowerCase();
  const { keys, cursor, list_complete } = await KV.list(env, 'user:', clamp(url.searchParams.get('limit') || 50, 1, 200), url.searchParams.get('cursor'));
  const raw = await KV.many(env, keys.map((k) => k.name));
  user.__isSuper = await isSuperAdmin(env, user);
  const items = [];
  for (const u of raw) {
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
    default: bad('未知操作');
  }
  await saveUser(env, target);
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
  return ok({ ban: rec }, ctx);
});

router.delete('/api/admin/ip-bans/:ip', async (ctx) => {
  await requireAdmin(ctx, 'ip.ban');
  await KV.del(ctx.env, `ban:ip:${ctx.params.ip}`);
  return ok({ unbanned: ctx.params.ip }, ctx);
});

/* ------------------------------ 访问日志 ---------------------------------- */

router.get('/api/admin/logs', async (ctx) => {
  const { env, url } = ctx;
  await requireAdmin(ctx, 'site.logs');
  const limit = clamp(url.searchParams.get('limit') || 100, 1, 500);
  const ipFilter = url.searchParams.get('ip') || '';
  const pathFilter = url.searchParams.get('path') || '';
  const { keys, cursor, list_complete } = await KV.list(env, 'log:', limit, url.searchParams.get('cursor'));
  let items = keys.map((k) => k.metadata).filter(Boolean);
  if (!items.length) items = await KV.many(env, keys.map((k) => k.name));
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
  const posts = (await KV.many(env, keys.map((k) => `post:${k.name.split(':').pop()}`)))
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
  const flag = await env.DB.get('sys:bootstrap');
  await seedRoles(env, 'global', Object.keys(ROLE_TEMPLATES));

  const email = String(env.SUPER_ADMIN_EMAIL || '').toLowerCase().trim();
  const username = String(env.SUPER_ADMIN_USERNAME || 'root').trim();
  const pwd = env.SUPER_ADMIN_PASSWORD;

  if (email && pwd) {
    let admin = await findUserByEmail(env, email);
    if (!admin) admin = await findUserByUsername(env, username);
    // 环境变量里的密码是明文 → 服务端自行做一次「客户端预哈希」再 PBKDF2，保持算法一致
    const clientHash = await sha256Hex(`${pwd}:MARYT_CLIENT_PEPPER`);
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
      await bumpStat(env, 'users');
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
  if (!flag) await env.DB.put('sys:bootstrap', JSON.stringify({ at: nowMs(), version: VERSION }));
  BOOTSTRAPPED = true;
}

/* ========================================================================== *
 * 21. 主入口
 * ========================================================================== */

export default {
  async fetch(request, env, execCtx) {
    const started = Date.now();
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

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
      await bootstrap(env);

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

      // —— CSRF：跨站写操作要求 Origin 在白名单内 ——
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !ctx.bot) {
        const origin = request.headers.get('Origin');
        const list = allowedOriginList(env);
        if (origin && list.length && !list.includes(origin)) {
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
    execCtx.waitUntil((async () => {
      const day = new Date().toISOString().slice(0, 10);
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
      console.log('[cron] daily maintenance done', day, 'unbanned:', unbanned);
    })());
  },
};
