/* ==========================================================================
 * MarytOpens · api.js
 * 统一 API 客户端：JWT 管理 / 密码客户端预哈希 / 错误归一 / 上传 / 站点元信息缓存
 * 全局对象：window.API
 * ========================================================================== */
(function (global) {
  'use strict';

  /* API 基址：可通过 <meta name="mo-api" content="..."> 覆盖，便于本地联调 */
  const META_API = document.querySelector('meta[name="mo-api"]');
  const IS_LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const API_PRIMARY = (META_API && META_API.content)
    || (IS_LOCAL ? 'http://127.0.0.1:8787' : 'https://api.example.com');

  /**
   * 备用 API 入口（已弃用，恒为空）。
   *
   * 旧方案：站点 zone 开「Bot Fight Mode」时边缘会下发挑战页，挑战响应不带 CORS 头，
   * 浏览器跨域 fetch 直接失败 → 表现为「登录不了、什么功能都用不了」。当时用 workers.dev
   * 作兜底通道（不受本 zone BFM 管辖）。
   *
   * 现方案：本账号 workers.dev 子域路由已被禁用（API 返回 10405），旧兜底地址恒为 404；
   * 且旧逻辑会把失效的兜底地址写进 sessionStorage，导致一次挑战后就【永久】连不上后端。
   * 已改为：主入口 api.example.com 通过 WAF Skip 规则豁免 Bot Fight Mode（bic/waf），
   * 浏览器不再被挑战，故移除兜底通道、每次都从主入口开始，杜绝死锁。
   */
  const API_FALLBACK = '';
  const LS_API_BASE = 'mo_api_base';

  /** 当前生效基址：每次都从主入口开始，避免旧版把失效兜底地址锁进 sessionStorage 导致死连不上 */
  let API_BASE = API_PRIMARY;

  /* 兜底通道已移除（见 API_FALLBACK 注释）；保留占位以免历史调用报错 */

  const LS_TOKEN = 'mo_token';
  const LS_USER = 'mo_user';
  const SS_META = 'mo_meta';

  /* ------------------------------ 加密工具 ------------------------------- */

  /**
   * 密码永不明文离开浏览器：先做 SHA-256(password + ':' + salt) 预哈希，
   * 服务端再对该哈希做 PBKDF2 二次派生落库。
   * 盐使用固定域名常量，保证同一密码在不同站点得到不同摘要。
   */
  const PWD_SALT = 'MarytOpens::v1';

  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function hashPassword(pwd) {
    return sha256Hex(String(pwd) + ':' + PWD_SALT);
  }

  /* ------------------------------ 令牌管理 ------------------------------- */

  function token() { return localStorage.getItem(LS_TOKEN) || ''; }
  function setToken(v) { v ? localStorage.setItem(LS_TOKEN, v) : localStorage.removeItem(LS_TOKEN); }

  function cachedUser() {
    try { return JSON.parse(localStorage.getItem(LS_USER) || 'null'); } catch (e) { return null; }
  }
  function setCachedUser(u) {
    u ? localStorage.setItem(LS_USER, JSON.stringify(u)) : localStorage.removeItem(LS_USER);
  }

  function clearSession() { setToken(''); setCachedUser(null); }

  /** JWT 载荷解码（仅用于本地过期预判，不作安全依据） */
  function decodeToken(tk) {
    try {
      const p = (tk || token()).split('.')[1];
      if (!p) return null;
      const s = p.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((p.length + 3) % 4);
      return JSON.parse(decodeURIComponent(escape(atob(s))));
    } catch (e) { return null; }
  }

  function isExpired() {
    const p = decodeToken();
    return !p || (p.exp && p.exp * 1000 < Date.now());
  }

  /* ------------------------------ 错误类型 ------------------------------- */

  class ApiError extends Error {
    constructor(status, code, message, data) {
      super(message || 'Request failed');
      this.name = 'ApiError';
      this.status = status; this.code = code || 'ERROR'; this.data = data || null;
    }
    get isAuth() { return this.status === 401; }
    get isForbidden() { return this.status === 403; }
    get isNotFound() { return this.status === 404; }
    get isRate() { return this.status === 429; }
  }

  /* ------------------------------ 核心请求 ------------------------------- */

  let onUnauthorized = null;   // 由 app.js 注入：统一跳登录
  let onEmailVerifyRequired = null;  // 由 app.js 注入：被「要求验证邮箱」拦截时唤起弹窗

  async function request(method, path, body, opts) {
    opts = opts || {};
    const absolute = path.startsWith('http');
    const headers = Object.assign({ 'Accept': 'application/json' }, opts.headers || {});

    const tk = token();
    if (tk && !opts.noAuth) headers['Authorization'] = 'Bearer ' + tk;

    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined && body !== null) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    /* 候选入口：绝对地址原样请求；否则只走主入口（已豁免 BFM，无需兜底切换） */
    const bases = absolute ? [null] : [API_BASE];

    let res = null;
    for (let i = 0; i < bases.length; i++) {
      const target = absolute ? path : bases[i] + path;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeout || 30000);
      try {
        res = await fetch(target, {
          method, headers, body: payload,
          credentials: 'include',
          signal: opts.signal || ctrl.signal,
          mode: 'cors',
          cache: 'no-store',
        });
      } catch (e) {
        clearTimeout(timer);
        if (e.name === 'AbortError') throw new ApiError(0, 'TIMEOUT', '请求超时，请检查网络');
        /* 主入口已豁免 BFM；若仍网络/CORS 失败，多为真实断网，直接报错而非切死兜底 */
        throw new ApiError(0, 'NETWORK', (global.I18N ? I18N.t('common.networkError') : '网络异常，请稍后重试'));
      }
      clearTimeout(timer);
      /* 仍能读到 403 + Cf-Mitigated 说明 BFM 意外生效，给出明确提示而非静默失败 */
      if (res.status === 403 && res.headers.get('cf-mitigated')) {
        throw new ApiError(403, 'BOT_CHALLENGE', '请求被 Cloudflare 人机验证拦截，请刷新页面或联系管理员');
      }
      break;
    }

    const ct = res.headers.get('content-type') || '';
    let data = null;
    if (ct.includes('application/json')) { try { data = await res.json(); } catch (e) { data = null; } }
    else if (opts.raw) return res;
    else { try { data = { ok: res.ok, text: await res.text() }; } catch (e) { data = null; } }

    if (!res.ok || (data && data.ok === false)) {
      const code = (data && (data.code || (data.error && data.error.code))) || 'ERROR';
      const msg = (data && (data.message || data.error && data.error.message)) || res.statusText || '请求失败';
      const err = new ApiError(res.status, code, msg, data);
      if (res.status === 401 && !opts.noAuthRedirect) {
        clearSession();
        if (typeof onUnauthorized === 'function') onUnauthorized(err);
      }
      if (res.status === 403 && code === 'EMAIL_VERIFY_REQUIRED' && typeof onEmailVerifyRequired === 'function') {
        onEmailVerifyRequired(err);
      }
      throw err;
    }
    return data;
  }

  const get  = (p, o) => request('GET', p, null, o);
  const post = (p, b, o) => request('POST', p, b, o);
  const put  = (p, b, o) => request('PUT', p, b, o);
  const patch= (p, b, o) => request('PATCH', p, b, o);
  const del  = (p, b, o) => request('DELETE', p, b, o);

  function qs(obj) {
    const p = new URLSearchParams();
    for (const k in obj) {
      const v = obj[k];
      if (v !== undefined && v !== null && v !== '') p.set(k, v);
    }
    const s = p.toString();
    return s ? '?' + s : '';
  }

  /* ------------------------------ 站点元信息 ------------------------------ */

  let metaCache = null;

  async function meta(force) {
    if (metaCache && !force) return metaCache;
    if (!force) {
      try {
        const raw = sessionStorage.getItem(SS_META);
        if (raw) {
          const c = JSON.parse(raw);
          if (c && Date.now() - c._t < 120000) { metaCache = c.d; return metaCache; }
        }
      } catch (e) { /* ignore */ }
    }
    const d = await get('/api/meta', { noAuth: true });
    metaCache = d;
    try { sessionStorage.setItem(SS_META, JSON.stringify({ _t: Date.now(), d })); } catch (e) { /* ignore */ }
    return d;
  }

  /* ------------------------------ 领域方法 ------------------------------- */

  const Auth = {
    async register(payload) {
      const passwordHash = await hashPassword(payload.password);
      const d = await post('/api/auth/register', {
        username: payload.username, email: payload.email, code: payload.code,
        passwordHash, turnstileToken: payload.turnstileToken,
        locale: global.I18N ? I18N.locale : undefined,
      }, { noAuth: true });
      if (d.token) { setToken(d.token); setCachedUser(d.user); }
      return d;
    },
    async login(payload) {
      const passwordHash = await hashPassword(payload.password);
      const d = await post('/api/auth/login', {
        identifier: payload.identifier, passwordHash, turnstileToken: payload.turnstileToken,
      }, { noAuth: true, noAuthRedirect: true });
      if (d.token) { setToken(d.token); setCachedUser(d.user); }
      return d;
    },
    async logout() {
      try { await post('/api/auth/logout', {}); } catch (e) { /* ignore */ }
      clearSession();
      try { sessionStorage.clear(); } catch (e) { /* ignore */ }
    },
    me: () => get('/api/auth/me', { noAuthRedirect: true }),
    setAvatarFrame: (frameId) => patch('/api/me/avatar-frame', { frameId }),
    sendCode: (email, purpose) => post('/api/auth/send-code', { email, purpose }, { noAuth: true }),
    verifyEmail: (code) => post('/api/auth/verify-email', { code }),
    async changePassword(oldPwd, newPwd) {
      const d = await post('/api/auth/password/change', {
        oldPasswordHash: await hashPassword(oldPwd),
        newPasswordHash: await hashPassword(newPwd),
      });
      if (d.token) setToken(d.token);
      return d;
    },
    async resetPassword(email, code, newPwd) {
      return post('/api/auth/password/reset', {
        email, code, newPasswordHash: await hashPassword(newPwd),
      }, { noAuth: true });
    },
    /**
     * 跳转到第三方授权页。
     * @param {string} provider  github | discord
     * @param {string|object} opts  站内回跳「路径」（必须以 / 开头），或 { next, mode }
     *        mode='bind' 表示在已登录状态下绑定而非登录。
     * 注意：服务端 /api/oauth/:provider/start 读取的是 next（相对路径），
     *      最终会重定向到 FRONTEND_ORIGIN + next 并附带 ?token=
     */
    oauthStart(provider, opts) {
      const o = typeof opts === 'string' ? { next: opts } : (opts || {});
      let next = o.next || '/oauth_callback.html';
      // 兼容传入完整 URL 的旧调用：只取 path + query
      if (/^https?:\/\//i.test(next)) { try { const u = new URL(next); next = u.pathname + u.search; } catch (e) { next = '/home.html'; } }
      if (!next.startsWith('/')) next = '/' + next;
      location.href = API_BASE + '/api/oauth/' + provider + '/start' + qs({ next, mode: o.mode });
    },
    unbind: (provider) => post('/api/oauth/' + provider + '/unbind', {}),
  };

  const Posts = {
    list: (params) => get('/api/posts' + qs(params)),
    detail: (id) => get('/api/posts/' + id),
    create: (data) => post('/api/posts', data),
    update: (id, data) => put('/api/posts/' + id, data),
    remove: (id) => del('/api/posts/' + id),
    like: (id) => post('/api/posts/' + id + '/like', {}),
    favorite: (id) => post('/api/posts/' + id + '/favorite', {}),
    favorites: (params) => get('/api/me/favorites' + qs(params)),
    comments: (id, params) => get('/api/posts/' + id + '/comments' + qs(params)),
    setOfficial: (id, official) => post('/api/posts/' + id + '/official', { official }),
    setAnnounce: (id, announce, pinned) => post('/api/posts/' + id + '/announce', { announce, pinned }),
    comment: (id, data) => post('/api/posts/' + id + '/comments', data),
    deleteComment: (pid, cid) => del('/api/posts/' + pid + '/comments/' + cid),
    updateComment: (pid, cid, data) => put('/api/posts/' + pid + '/comments/' + cid, data),
  };

  const Exgroups = {
    list: (params) => get('/api/exgroups' + qs(params)),
    detail: (id) => get('/api/exgroups/' + id),
    create: (data) => post('/api/exgroups', data),
    join: (id, data) => post('/api/exgroups/' + id + '/join', data || {}),
    update: (id, data) => put('/api/exgroups/' + id, data),
  };

  const Users = {
    detail: (id) => get('/api/users/' + id),
    follow: (id) => post('/api/users/' + id + '/follow', {}),
    following: (params) => get('/api/me/following' + qs(params)),
    updateProfile: (data) => put('/api/me/profile', data),
    changeEmail: (email, code) => post('/api/me/email/change', { email, code }),
    deleteAccount: (confirm) => del('/api/me', { confirm }),
    // 超管为指定用户设置/重置专属（Markdown）等级
    setCustomLevel: (id, data) => put('/api/admin/users/' + id + '/level', data),
    // 按用户名 / id 查找用户（公共视图，含 level / customLevel）
    lookup: (q) => get('/api/users/lookup?username=' + encodeURIComponent(q || '')),
    // 桌面插件上报「正在玩」
    setPlaying: (data) => put('/api/me/playing', data),
    // 自定义域名连接：start / verify / auto / remove
    domainConnection: (data) => post('/api/me/domain-connection', data),
  };

  /* 在线人数 / 在线状态：服务端为纯内存实现，可放心轮询（不消耗 KV 配额） */
  const Presence = {
    STATUSES: ['online', 'away', 'busy', 'invisible'],
    get: (limit) => get('/api/presence' + qs({ limit: limit || undefined }), { noAuth: !token() }),
    setStatus: (status, statusText) => put('/api/me/status', { status, statusText: statusText || '' }),
  };

  /* 经济系统：MO值 / Meow值（等级） / 签到 / 商城 / 券包 / 订单 */
  const Economy = {
    me: () => get('/api/economy/me'),
    checkin: () => post('/api/economy/checkin', {}),
    calendar: (month) => get('/api/economy/checkin/calendar' + qs({ month: month || undefined })),
    makeup: (date) => post('/api/economy/checkin/makeup', { date }),
    checkinConfig: () => get('/api/admin/checkin/config'),
    saveCheckinConfig: (conf) => put('/api/admin/checkin/config', conf),
    shop: () => get('/api/shop'),
    mine: () => get('/api/shop/mine'),
    orders: (params) => get('/api/shop/orders' + qs(params)),
    buy: (itemId) => post('/api/shop/buy', { itemId }),
    levels: () => get('/api/levels'),
    saveLevelPerks: (data) => put('/api/admin/levels/perks', data),
    /* 商城后台（超管）：整表读写 */
    shopAdmin: () => get('/api/shop/admin'),
    saveShopAdmin: (items) => put('/api/shop/admin', { items }),
    /* 装扮目录（超管）：样式类白名单 + 已上架装扮商品 */
    decorCatalog: () => get('/api/admin/decor/catalog'),
  };

  /* 称号：目录 / 我的持有 / 佩戴 / 颁发与撤销 */
  const Titles = {
    catalog: () => get('/api/titles/catalog'),
    mine: () => get('/api/me/titles'),
    equip: (titleId) => patch('/api/me/title', { titleId: titleId || '' }),
    saveCatalog: (items) => put('/api/admin/titles/catalog', { items }),
    grant: (userId, title, durationDays) => put('/api/admin/titles/grant', { userId, title, durationDays: durationDays || 0 }),
    revoke: (userId, titleId) => put('/api/admin/titles/revoke', { userId, titleId }),
  };

  /* 装扮：名片背景 / 消息气泡皮肤（头像框见 Auth.setAvatarFrame） */
  const Decor = {
    mine: () => get('/api/me/decor'),
    equipCard: (cardId) => patch('/api/me/decor', { cardId: cardId || '' }),
    equipBubble: (bubbleId) => patch('/api/me/decor', { bubbleId: bubbleId || '' }),
  };

  /* 赠礼与赞赏 */
  const Gifts = {
    catalog: () => get('/api/gifts/catalog'),
    saveCatalog: (data) => put('/api/admin/gifts/catalog', data),
    send: (data) => post('/api/gifts/send', data),
    wall: (userKey, params) => get('/api/users/' + encodeURIComponent(userKey) + '/gifts' + qs(params)),
    board: (limit) => get('/api/gifts/board' + qs({ limit: limit || undefined })),
    tip: (data) => post('/api/tips/send', data),
    postTips: (postId) => get('/api/posts/' + postId + '/tips'),
  };

  /* 社区设计征集：公开投稿 / 浏览 / 投票 + 管理层审核与采纳 */
  const Designs = {
    campaigns: () => get('/api/designs/campaigns'),
    saveCampaigns: (items) => put('/api/admin/designs/campaigns', { items }),
    list: (params) => get('/api/designs' + qs(params)),
    detail: (id) => get('/api/designs/' + encodeURIComponent(id)),
    create: (data) => post('/api/designs', data),
    vote: (id) => post('/api/designs/' + encodeURIComponent(id) + '/vote', {}),
    withdraw: (id) => post('/api/designs/' + encodeURIComponent(id) + '/withdraw', {}),
    remove: (id) => del('/api/designs/' + encodeURIComponent(id)),
    review: (id, data) => post('/api/admin/designs/' + encodeURIComponent(id) + '/review', data),
    adopt: (id, data) => post('/api/admin/designs/' + encodeURIComponent(id) + '/adopt', data || {}),
    hall: () => get('/api/designs/hall/adopted'),
  };

  const DM = {
    threads: () => get('/api/dm/threads'),
    history: (userId, params) => get('/api/dm/' + userId + qs(params)),
    send: (userId, text) => post('/api/dm/' + userId, { content: text }),
  };

  const Notify = {
    list: (params) => get('/api/notifications' + qs(params)),
    read: (id) => post('/api/notifications/read', id ? { id } : { all: true }),
    readAll: () => post('/api/notifications/read', { all: true }),
    remove: (id) => del('/api/notifications/' + id),
  };

  /* 版块（顶层社区单元，版主治理）；频道挂在版块下（频道主治理，权级低于版主） */
  const Boards = {
    list: (params) => get('/api/boards' + qs(params)),
    detail: (id) => get('/api/boards/' + id),
    create: (data) => post('/api/boards', data),
    update: (id, data) => put('/api/boards/' + id, data),
    remove: (id) => del('/api/boards/' + id),
    join: (id) => post('/api/boards/' + id + '/join', {}),
    members: (id, params) => get('/api/boards/' + id + '/members' + qs(params)),
    createChannel: (id, data) => post('/api/boards/' + id + '/channels', data),
    updateChannel: (bid, cid, data) => put('/api/boards/' + bid + '/channels/' + cid, data),
    removeChannel: (bid, cid) => del('/api/boards/' + bid + '/channels/' + cid),
    committee: (id) => get('/api/boards/' + id + '/committee'),
    addCommittee: (id, data) => post('/api/boards/' + id + '/committee', data),
    updateCommittee: (id, uid, data) => put('/api/boards/' + id + '/committee/' + uid, data),
    removeCommittee: (id, uid) => del('/api/boards/' + id + '/committee/' + uid),
    setChairman: (id, uid) => post('/api/boards/' + id + '/committee/' + uid + '/chairman', {}),
  };

  const Roles = {
    catalog: () => get('/api/permissions/catalog', { noAuth: true }),
    list: (scope) => get('/api/roles' + qs({ scope })),
    create: (data) => post('/api/roles', data),
    update: (id, data) => put('/api/roles/' + id, data),
    remove: (id, scope) => del('/api/roles/' + id + qs({ scope })),
    assign: (data) => post('/api/roles/assign', data),
  };

  const Reports = {
    create: (data) => post('/api/reports', data),
    list: (params) => get('/api/reports' + qs(params)),
    resolve: (id, data) => post('/api/reports/' + id + '/resolve', data),
  };

  /* 群组：与频道关联但独立存在的讨论/协作空间 */
  const Groups = {
    list: (params) => get('/api/groups' + qs(params)),
    mine: () => get('/api/groups?mine=1'),
    detail: (id) => get('/api/groups/' + id),
    create: (data) => post('/api/groups', data),
    update: (id, data) => put('/api/groups/' + id, data),
    remove: (id) => del('/api/groups/' + id),
    join: (id) => post('/api/groups/' + id + '/join', {}),
    leave: (id) => post('/api/groups/' + id + '/leave', {}),
    members: (id, params) => get('/api/groups/' + id + '/members' + qs(params)),
    committee: (id) => get('/api/groups/' + id + '/committee'),
    addCommittee: (id, data) => post('/api/groups/' + id + '/committee', data),
    updateCommittee: (id, uid, data) => put('/api/groups/' + id + '/committee/' + uid, data),
    removeCommittee: (id, uid) => del('/api/groups/' + id + '/committee/' + uid),
    setChairman: (id, uid) => post('/api/groups/' + id + '/committee/' + uid + '/chairman', {}),
  };

  /* 好友：申请、双向关系、备注与权限 */
  const Friends = {
    list: (params) => get('/api/friends' + qs(params)),
    requests: (type) => get('/api/friends/requests' + qs({ type })),
    request: (data) => post('/api/friends/request', data),
    accept: (id) => post('/api/friends/requests/' + id + '/accept', {}),
    reject: (id) => post('/api/friends/requests/' + id + '/reject', {}),
    blockRequest: (id) => post('/api/friends/requests/' + id + '/block', {}),
    remove: (id) => del('/api/friends/' + id),
    update: (id, data) => put('/api/friends/' + id, data),
  };

  /* Web Push：订阅、偏好与测试 */
  const Push = {
    config: () => get('/api/push/config'),
    state: () => get('/api/push/state'),
    subscribe: (data) => post('/api/push/subscribe', data),
    unsubscribe: (data) => post('/api/push/unsubscribe', data || {}),
    setPrefs: (data) => put('/api/push/prefs', data),
    test: () => post('/api/push/test', {}),
  };

  const Admin = {
    overview: () => get('/api/admin/overview'),
    getConfig: () => get('/api/admin/config'),
    saveConfig: (data) => put('/api/admin/config', data),
    users: (params) => get('/api/admin/users' + qs(params)),
    userAction: (id, data) => post('/api/admin/users/' + id + '/action', data),
    ipBans: () => get('/api/admin/ip-bans'),
    banIP: (data) => post('/api/admin/ip-bans', data),
    unbanIP: (ip) => del('/api/admin/ip-bans/' + encodeURIComponent(ip)),
    bans: () => get('/api/bans'),
    logs: (params) => get('/api/admin/logs' + qs(params)),
    cfStatus: () => get('/api/admin/cloudflare/status'),
    cfPurge: (data) => post('/api/admin/cloudflare/purge', data || {}),
    cfAnalytics: (params) => get('/api/admin/cloudflare/analytics' + qs(params)),
    cfDns: (data) => post('/api/admin/cloudflare/dns', data),
    sendMail: (data) => post('/api/admin/mail/send', data),
    broadcast: (data) => post('/api/admin/mail/broadcast', data),
    bots: () => get('/api/admin/bots'),
    createBot: (data) => post('/api/admin/bots', data),
    removeBot: (id) => del('/api/admin/bots/' + id),
  };

  /* ------------------------ 用户绑定 Cloudflare 文件存储 ------------------- */

  const Storage = {
    /** 跳转到 Cloudflare OAuth 绑定页（服务端 302） */
    bindStart() { location.href = API_BASE + '/api/cf/bind/start'; },
    status: () => get('/api/cf/bind/status'),
    unbind: () => post('/api/cf/bind/unbind', {}),
    files: () => get('/api/cf/files'),
    setShare: (id, previewCode) => post('/api/cf/files/' + id + '/share', { previewCode }),
    remove: (id) => post('/api/cf/files/' + id + '/delete', {}),
  };

  /** 带进度的上传到「用户自有 Cloudflare」（XHR） */
  function uploadCf(file, meta, onProgress) {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append('file', file, file.name || 'file');
      fd.append('name', meta.name || file.name || 'file');
      if (meta.previewCode) fd.append('previewCode', meta.previewCode);
      if (meta.expiresAt) fd.append('expiresAt', String(meta.expiresAt));
      const xhr = new XMLHttpRequest();
      xhr.open('POST', API_BASE + '/api/cf/upload', true);
      xhr.withCredentials = true;
      const tk = token();
      if (tk) xhr.setRequestHeader('Authorization', 'Bearer ' + tk);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round(e.loaded / e.total * 100));
      };
      xhr.onload = () => {
        let d = null;
        try { d = JSON.parse(xhr.responseText); } catch (e) { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300 && d && d.ok !== false) resolve(d);
        else reject(new ApiError(xhr.status, (d && d.code) || 'UPLOAD_FAILED', (d && d.message) || '上传失败'));
      };
      xhr.onerror = () => reject(new ApiError(0, 'NETWORK', '上传失败，请检查网络'));
      xhr.send(fd);
    });
  }

  /* ------------------------------ 文件上传 ------------------------------- */

  /** 带进度的上传（XHR，fetch 无原生上传进度） */
  function upload(kind, file, onProgress) {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append('file', file, file.name || (kind + '.png'));
      const xhr = new XMLHttpRequest();
      xhr.open('POST', API_BASE + '/api/upload/' + kind, true);
      xhr.withCredentials = true;
      const tk = token();
      if (tk) xhr.setRequestHeader('Authorization', 'Bearer ' + tk);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round(e.loaded / e.total * 100));
      };
      xhr.onload = () => {
        let d = null;
        try { d = JSON.parse(xhr.responseText); } catch (e) { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300 && d && d.ok !== false) resolve(d);
        else reject(new ApiError(xhr.status, (d && d.code) || 'UPLOAD_FAILED', (d && d.message) || '上传失败'));
      };
      xhr.onerror = () => reject(new ApiError(0, 'NETWORK', '上传失败，请检查网络'));
      xhr.send(fd);
    });
  }

  /** 把相对文件路径补成完整 URL */
  function fileURL(p) {
    if (!p) return '';
    if (/^(https?:)?\/\//.test(p) || p.startsWith('data:')) return p;
    if (p.startsWith('/files/')) return API_BASE + p;
    return p;
  }

  /* ------------------------------ 官方公告 / 网关工具 ------------------------------ */
  const Announcements = {
    list: (params) => get('/api/announcements' + (params ? '?' + qs(params) : '')),
    create: (data) => post('/api/admin/announcements', data),
    remove: (id) => del('/api/admin/announcements/' + id),
  };
  const OfficialItems = {
    list: () => get('/api/official'),
  };
  const Gateway = {
    config: () => get('/api/gateway/config'),
    save: (data) => put('/api/gateway/config', data),
    ipCheck: () => get('/api/gateway/ip-check'),
    routerDevices: () => post('/api/gateway/router/devices'),
    disableDevice: (id) => post('/api/gateway/router/device/disable', { id }),
    deployOpenClaw: (payload) => post('/api/gateway/openclaw/deploy', { payload }),
  };

  /* ------------------------------ 问卷 / 调研 ------------------------------ */
  const Survey = {
    list: (params) => get('/api/surveys' + (params ? '?' + qs(params) : '')),
    get: (id) => get('/api/surveys/' + id),
    create: (data) => post('/api/surveys', data),
    respond: (id, data) => post('/api/surveys/' + id + '/respond', data),
    results: (id) => get('/api/surveys/' + id + '/results'),
    close: (id) => post('/api/surveys/' + id + '/close'),
    remove: (id) => del('/api/surveys/' + id),
  };

  /* ------------------------------ 社区意见反馈 ------------------------------ */
  const Feedback = {
    submit: (data) => post('/api/feedback', data),
    list: () => get('/api/admin/feedback'),
  };

  /* ------------------------------ Telegram 解析 ------------------------------ */
  const Telegram = {
    resolve: (url) => get('/api/telegram/resolve?url=' + encodeURIComponent(url)),
  };

  /* ------------------------------ Discord 解析 ------------------------------ */
  const Discord = {
    resolve: (url) => get('/api/discord/resolve?url=' + encodeURIComponent(url)),
  };

  /* ------------------------ 频道内群聊消息 ------------------------ */
  const Channels = {
    messages: (bid, cid, params) => get(`/api/boards/${bid}/channels/${cid}/messages` + qs(params)),
    send: (bid, cid, data) => post(`/api/boards/${bid}/channels/${cid}/messages`, data),
    deleteMessage: (bid, cid, mid) => del(`/api/boards/${bid}/channels/${cid}/messages/${mid}`),
    pinMessage: (bid, cid, mid, pinned) => patch(`/api/boards/${bid}/channels/${cid}/messages/${mid}`, { pinned }),
    committee: (bid, cid) => get(`/api/boards/${bid}/channels/${cid}/committee`),
    addCommittee: (bid, cid, data) => post(`/api/boards/${bid}/channels/${cid}/committee`, data),
    updateCommittee: (bid, cid, uid, data) => put(`/api/boards/${bid}/channels/${cid}/committee/${uid}`, data),
    removeCommittee: (bid, cid, uid) => del(`/api/boards/${bid}/channels/${cid}/committee/${uid}`),
    setChairman: (bid, cid, uid) => post(`/api/boards/${bid}/channels/${cid}/committee/${uid}/chairman`, {}),
  };

  /* ------------------------ 用户代表选举 ------------------------ */
  const Elections = {
    list: (params) => get('/api/elections' + qs(params)),
    detail: (id) => get('/api/elections/' + id),
    create: (data) => post('/api/elections', data),
    nominate: (id, data) => post(`/api/elections/${id}/nominate`, data),
    vote: (id, data) => post(`/api/elections/${id}/vote`, data),
    close: (id) => post(`/api/elections/${id}/close`, {}),
    remove: (id) => del(`/api/elections/${id}`),
  };

  /* ------------------------ 风纪委员会 + 申诉 ------------------------ */
  const Discipline = {
    list: (params) => get('/api/discipline/cases' + qs(params)),
    create: (data) => post('/api/discipline/cases', data),
    confirm: (id) => post(`/api/discipline/cases/${id}/confirm`, {}),
    reject: (id) => post(`/api/discipline/cases/${id}/reject`, {}),
    appeal: (id, data) => post(`/api/discipline/cases/${id}/appeal`, data),
    resolveAppeal: (id, data) => post(`/api/discipline/cases/${id}/appeal/resolve`, data),
  };

  /* ------------------------ 认证 / 荣誉体系 ------------------------ */
  const Honors = {
    catalog: () => get('/api/honors/catalog'),
    saveCatalog: (items) => put('/api/admin/honors/catalog', { items }),
    grant: (data) => put('/api/admin/honors/grant', data),
    revoke: (data) => put('/api/admin/honors/revoke', data),
  };

  /* ------------------------ 官方账号 API 密钥 + 发布 ------------------------ */
  const Official = {
    keys: () => get('/api/admin/official/keys'),
    saveKeys: (items) => put('/api/admin/official/keys', { items }),
    publish: (data) => post('/api/admin/official/publish', data),
    /* 官方账号本体配置（超管） */
    account: () => get('/api/admin/official/account'),
    /**
     * 保存官方账号。密码有两种给法（永不明文上传）：
     *   · data.password  → 本地先做与登录一致的预哈希，转成 passwordHash 上传
     *   · data.resetPassword=true → 由服务端随机生成，明文只在响应里回显一次
     */
    async saveAccount(data) {
      const payload = { ...data };
      if (payload.password) {
        payload.passwordHash = await hashPassword(payload.password);
        delete payload.password;
      }
      return put('/api/admin/official/account', payload);
    },
  };

  const GovAdmin = {
    disciplineMembers: () => get('/api/admin/discipline/members'),
    setDisciplineMember: (data) => put('/api/admin/discipline/members', data),
  };

  /* ------------------------ 表情 / 反应 / 区域身份 ------------------------ */
  const Emojis = {
    list: () => get('/api/emojis', { noAuth: true }),
    save: (items, allowExternalEmoji) => put('/api/admin/emojis', { items, allowExternalEmoji }),
  };

  const Reactions = {
    toggle: (targetType, targetId, emoji) => post('/api/react', { targetType, targetId, emoji }),
  };

  const Members = {
    get: (scope) => get('/api/members/' + encodeURIComponent(scope)),
    update: (scope, data) => patch('/api/members/' + encodeURIComponent(scope), data),
  };

  const CustomRoles = {
    list: (scope) => get('/api/admin/roles' + qs({ scope })),
    create: (data) => post('/api/admin/roles', data),
    update: (id, data) => put('/api/admin/roles/' + id, data),
    remove: (id, scope) => del('/api/admin/roles/' + id + qs({ scope })),
    setMyIcon: (roleId, icon) => patch('/api/me/role-icons', { roleId, icon }),
  };

  /* ------------------------ 投稿 / 客服 / 站内信 / Codespace / 工具 / OAuth ------------------------ */
  const Submissions = {
    create: (data) => post('/api/submissions', data),
    list: (params) => get('/api/submissions' + qs(params || {})),
    get: (id) => get('/api/submissions/' + encodeURIComponent(id)),
    review: (id, data) => post('/api/admin/submissions/' + encodeURIComponent(id) + '/review', data),
    withdraw: (id) => post('/api/submissions/' + encodeURIComponent(id) + '/withdraw', {}),
    remove: (id) => del('/api/submissions/' + encodeURIComponent(id)),
  };

  const Tickets = {
    create: (data) => post('/api/tickets', data),
    list: (params) => get('/api/tickets' + qs(params || {})),
    get: (id) => get('/api/tickets/' + encodeURIComponent(id)),
    reply: (id, data) => post('/api/admin/tickets/' + encodeURIComponent(id) + '/reply', data),
    setStatus: (id, data) => post('/api/admin/tickets/' + encodeURIComponent(id) + '/status', data),
    config: () => get('/api/support/config'),
    saveConfig: (data) => put('/api/support/config', data),
  };

  const Letters = {
    send: (data) => post('/api/letters', data),
    list: (params) => get('/api/letters' + qs(params || {})),
    unread: () => get('/api/letters/unread'),
    get: (id) => get('/api/letters/' + encodeURIComponent(id)),
    star: (id) => post('/api/letters/' + encodeURIComponent(id) + '/star', {}),
    remove: (id) => del('/api/letters/' + encodeURIComponent(id)),
    broadcast: (data) => post('/api/admin/letters/broadcast', data),
  };

  const Codespaces = {
    create: (data) => post('/api/codespaces', data),
    list: (params) => get('/api/codespaces' + qs(params || {})),
    get: (id) => get('/api/codespaces/' + encodeURIComponent(id)),
    update: (id, data) => put('/api/codespaces/' + encodeURIComponent(id), data),
    remove: (id) => del('/api/codespaces/' + encodeURIComponent(id)),
  };

  const Tools = {
    list: () => get('/api/tools'),
    save: (data) => put('/api/admin/tools', data),
  };

  const OAuthApps = {
    list: () => get('/api/oauth/apps'),
    get: (id) => get('/api/oauth/apps/' + encodeURIComponent(id)),
    create: (data) => post('/api/oauth/apps', data),
    update: (id, data) => put('/api/oauth/apps/' + encodeURIComponent(id), data),
    rotateSecret: (id) => post('/api/oauth/apps/' + encodeURIComponent(id) + '/secret', {}),
    remove: (id) => del('/api/oauth/apps/' + encodeURIComponent(id)),
    authorizeInfo: (params) => get('/api/oauth/authorize/info' + qs(params || {})),
    authorize: (data) => post('/api/oauth/authorize', data),
    grants: () => get('/api/oauth/grants'),
    revokeGrant: (clientId) => del('/api/oauth/grants/' + encodeURIComponent(clientId)),
  };

  global.API = {
    /* 动态读取：故障切换后 app.js/Push 等处取到的始终是当前生效入口 */
    get BASE() { return API_BASE; },
    PRIMARY: API_PRIMARY,
    FALLBACK: API_FALLBACK,
    ApiError,
    request, get, post, put, patch, del, qs,
    token, setToken, cachedUser, setCachedUser, clearSession, decodeToken, isExpired,
    hashPassword, sha256Hex, meta, upload, uploadCf, fileURL,
    Auth, Posts, Users, DM, Notify, Boards, Groups, Friends, Roles, Reports, Push, Admin, Storage, Announcements, Gateway, OfficialItems,
    Channels, Elections, Discipline, Honors, Official, GovAdmin, Presence, Economy,
    Titles, Decor, Gifts, Designs,
    Emojis, Reactions, Members, CustomRoles, Survey, Feedback, Telegram, Discord, Exgroups,
    Submissions, Tickets, Letters, Codespaces, Tools, OAuthApps,
    set onUnauthorized(fn) { onUnauthorized = fn; },
    set onEmailVerifyRequired(fn) { onEmailVerifyRequired = fn; },
  };
})(window);
