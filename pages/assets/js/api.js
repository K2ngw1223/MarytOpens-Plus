/* ==========================================================================
 * MarytOpens · api.js
 * 统一 API 客户端：JWT 管理 / 密码客户端预哈希 / 错误归一 / 上传 / 站点元信息缓存
 * 全局对象：window.API
 * ========================================================================== */
(function (global) {
  'use strict';

  /* API 基址：可通过 <meta name="mo-api" content="..."> 覆盖，便于本地联调 */
  const META_API = document.querySelector('meta[name="mo-api"]');
  const API_BASE = (META_API && META_API.content)
    || (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
        ? 'http://127.0.0.1:8787'
        : 'https://api.natrois.top');

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

  async function request(method, path, body, opts) {
    opts = opts || {};
    const url = path.startsWith('http') ? path : API_BASE + path;
    const headers = Object.assign({ 'Accept': 'application/json' }, opts.headers || {});

    const tk = token();
    if (tk && !opts.noAuth) headers['Authorization'] = 'Bearer ' + tk;

    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined && body !== null) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 30000);

    let res;
    try {
      res = await fetch(url, {
        method, headers, body: payload,
        credentials: 'include',
        signal: opts.signal || ctrl.signal,
        mode: 'cors',
        cache: 'no-store',
      });
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new ApiError(0, 'TIMEOUT', '请求超时，请检查网络');
      throw new ApiError(0, 'NETWORK', (global.I18N ? I18N.t('common.networkError') : '网络异常，请稍后重试'));
    }
    clearTimeout(timer);

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
      throw err;
    }
    return data;
  }

  const get  = (p, o) => request('GET', p, null, o);
  const post = (p, b, o) => request('POST', p, b, o);
  const put  = (p, b, o) => request('PUT', p, b, o);
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
    sendCode: (email, purpose) => post('/api/auth/send-code', { email, purpose }, { noAuth: true }),
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
    comment: (id, data) => post('/api/posts/' + id + '/comments', data),
    deleteComment: (pid, cid) => del('/api/posts/' + pid + '/comments/' + cid),
  };

  const Users = {
    detail: (id) => get('/api/users/' + id),
    follow: (id) => post('/api/users/' + id + '/follow', {}),
    following: (params) => get('/api/me/following' + qs(params)),
    updateProfile: (data) => put('/api/me/profile', data),
    changeEmail: (email, code) => post('/api/me/email/change', { email, code }),
    deleteAccount: (confirm) => del('/api/me', { confirm }),
  };

  const DM = {
    threads: () => get('/api/dm/threads'),
    history: (userId, params) => get('/api/dm/' + userId + qs(params)),
    send: (userId, text) => post('/api/dm/' + userId, { text }),
  };

  const Notify = {
    list: (params) => get('/api/notifications' + qs(params)),
    read: (id) => post('/api/notifications/read', id ? { id } : { all: true }),
    readAll: () => post('/api/notifications/read', { all: true }),
    remove: (id) => del('/api/notifications/' + id),
  };

  const Channels = {
    list: (params) => get('/api/channels' + qs(params)),
    detail: (id) => get('/api/channels/' + id),
    create: (data) => post('/api/channels', data),
    update: (id, data) => put('/api/channels/' + id, data),
    remove: (id) => del('/api/channels/' + id),
    join: (id) => post('/api/channels/' + id + '/join', {}),
    members: (id, params) => get('/api/channels/' + id + '/members' + qs(params)),
    createGroup: (id, data) => post('/api/channels/' + id + '/groups', data),
    updateGroup: (cid, gid, data) => put('/api/channels/' + cid + '/groups/' + gid, data),
    removeGroup: (cid, gid) => del('/api/channels/' + cid + '/groups/' + gid),
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

  const Admin = {
    overview: () => get('/api/admin/overview'),
    getConfig: () => get('/api/admin/config'),
    saveConfig: (data) => put('/api/admin/config', data),
    users: (params) => get('/api/admin/users' + qs(params)),
    userAction: (id, data) => post('/api/admin/users/' + id + '/action', data),
    ipBans: () => get('/api/admin/ip-bans'),
    banIP: (data) => post('/api/admin/ip-bans', data),
    unbanIP: (ip) => del('/api/admin/ip-bans/' + encodeURIComponent(ip)),
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

  global.API = {
    BASE: API_BASE, ApiError,
    request, get, post, put, del, qs,
    token, setToken, cachedUser, setCachedUser, clearSession, decodeToken, isExpired,
    hashPassword, sha256Hex, meta, upload, uploadCf, fileURL,
    Auth, Posts, Users, DM, Notify, Channels, Roles, Reports, Admin, Storage,
    set onUnauthorized(fn) { onUnauthorized = fn; },
  };
})(window);
