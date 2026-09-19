/* ==========================================================================
 * MarytOpens · app.js
 * 全站通用运行时：主题 / Toast / Modal / 骨架 / Markdown / Turnstile /
 * 站点配置注入 / 权限判定 / 工具函数
 * 全局对象：window.App
 * ========================================================================== */
(function (global) {
  'use strict';

  const App = {};
  const LS_THEME = 'mo_theme';
  let EMOJI_MAP = {};        // 外部/自定义表情：name -> url
  let EMOJI_ALLOW = true;    // 站点是否允许外部表情

  /* ============================ 1. DOM 工具 ============================== */

  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'dataset') { for (const d in v) node.dataset[d] = v[d]; }
        else node.setAttribute(k, v === true ? '' : v);
      }
    }
    if (children != null) {
      (Array.isArray(children) ? children : [children]).forEach((c) => {
        if (c == null || c === false) return;
        node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
      });
    }
    return node;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function debounce(fn, wait) {
    let tm; return function () { const a = arguments, c = this; clearTimeout(tm); tm = setTimeout(() => fn.apply(c, a), wait || 300); };
  }

  function throttle(fn, wait) {
    let last = 0, tm;
    return function () {
      const a = arguments, c = this, now = Date.now();
      if (now - last >= (wait || 200)) { last = now; fn.apply(c, a); }
      else { clearTimeout(tm); tm = setTimeout(() => { last = Date.now(); fn.apply(c, a); }, wait - (now - last)); }
    };
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const ta = el('textarea', { style: { position: 'fixed', opacity: '0' } });
      ta.value = text; document.body.appendChild(ta); ta.select();
      let okc = false; try { okc = document.execCommand('copy'); } catch (e2) { /* ignore */ }
      document.body.removeChild(ta); return okc;
    }
  }

  /* ============================ 2. 图标库 ================================ */

  const ICONS = {
    home:'<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    compass:'<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    hash:'<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
    bell:'<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    mail:'<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    user:'<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    users:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.35.44.62.79.74H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>',
    edit:'<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',
    trash:'<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
    heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21.2l7.7-7.8 1.1-1a5.5 5.5 0 0 0 0-7.8"/>',
    star:'<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
    message:'<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5"/>',
    eye:'<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7"/><circle cx="12" cy="12" r="3"/>',
    eyeOff:'<path d="M17.9 17.9A10.1 10.1 0 0 1 12 19c-6.4 0-10-7-10-7a18 18 0 0 1 5.1-5.9m3.2-1A10.1 10.1 0 0 1 12 5c6.4 0 10 7 10 7a18 18 0 0 1-2.2 3.2M1 1l22 22M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    x:'<path d="M18 6 6 18M6 6l12 12"/>',
    check:'<path d="m20 6-11 11-5-5"/>',
    menu:'<path d="M3 12h18M3 6h18M3 18h18"/>',
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8"/>',
    monitor:'<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18"/>',
    logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    login:'<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
    flag:'<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
    pin:'<path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z"/>',
    lock:'<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    unlock:'<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
    upload:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M12 3v12m-4-4 4 4 4-4"/>',
    image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    link:'<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    external:'<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    copy:'<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    github:'<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9a3.4 3.4 0 0 0-1-2.6c3.1-.3 6.4-1.5 6.4-7A5.4 5.4 0 0 0 20 4.8 5 5 0 0 0 19.9 1S18.7.6 16 2.5a13.4 13.4 0 0 0-7 0C6.3.6 5.1 1 5.1 1A5 5 0 0 0 5 4.8a5.4 5.4 0 0 0-1.4 3.8c0 5.5 3.3 6.7 6.4 7A3.4 3.4 0 0 0 9 18.1V22"/>',
    discord:'<path d="M18.9 5.6A16.6 16.6 0 0 0 14.8 4.3l-.2.4a15.4 15.4 0 0 1 3.7 1.2 13.9 13.9 0 0 0-12.6 0 15.4 15.4 0 0 1 3.7-1.2l-.2-.4a16.6 16.6 0 0 0-4.1 1.3C2.4 9.4 1.7 13 2 16.6a16.7 16.7 0 0 0 5.1 2.6l1-1.7a10.9 10.9 0 0 1-1.7-.8l.4-.3a11.9 11.9 0 0 0 10.4 0l.4.3a10.9 10.9 0 0 1-1.7.8l1 1.7a16.7 16.7 0 0 0 5.1-2.6c.4-4.2-.7-7.8-3.1-11M9 14.3c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2m6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2"/>',
    alert:'<path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    checkCircle:'<circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/>',
    xCircle:'<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
    chevronDown:'<path d="m6 9 6 6 6-6"/>',
    chevronLeft:'<path d="m15 18-6-6 6-6"/>',
    chevronRight:'<path d="m9 18 6-6-6-6"/>',
    arrowLeft:'<path d="M19 12H5M12 19l-7-7 7-7"/>',
    arrowRight:'<path d="M5 12h14M12 5l7 7-7 7"/>',
    file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    folder:'<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    activity:'<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    barChart:'<path d="M18 20V10M12 20V4M6 20v-6"/>',
    server:'<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
    cloud:'<path d="M18 10h-1.3A7 7 0 1 0 4 16h14a4 4 0 0 0 0-8"/>',
    bot:'<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M12 8V4M8 2h8"/><circle cx="8.5" cy="14" r="1"/><circle cx="15.5" cy="14" r="1"/>',
    code:'<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
    zap:'<path d="M13 2 3 14h8l-1 8 10-12h-8z"/>',
    layers:'<path d="m12 2 9 5-9 5-9-5zM3 12l9 5 9-5M3 17l9 5 9-5"/>',
    key:'<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.8 12.2 8-8 2.2 2.2-1.5 1.5 1.5 1.5-2.5 2.5-1.5-1.5-2.5 2.5z"/>',
    telegram:'<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/>',
    ban:'<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
    volumeX:'<path d="M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6"/>',
    send:'<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
    filter:'<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',
    refresh:'<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    save:'<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
    inbox:'<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.4 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.4-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.8 1.1"/>',
    at:'<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.9 7.9"/>',
    userPlus:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
    userCheck:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m17 11 2 2 4-4"/>',
    megaphone:'<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M18 8a4 4 0 0 1 0 8"/><path d="M21 9a7 7 0 0 1 0 6"/>',
    more:'<circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/>',
    dice:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.3" fill="currentColor"/>',
    coin:'<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h3.2a2 2 0 0 1 0 4H9.5M9.5 13.5h3.5"/>',
    shuffle:'<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
    food:'<path d="M5 3v8a2 2 0 0 0 4 0V3M7 11v10M16 3c-1.5 0-2.5 2-2.5 5s1 4 2.5 4 2.5-1 2.5-4-1-5-2.5-5zM16 16v5"/>',
    palette:'<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2 0-1.5 1-2 2.5-2H19a3 3 0 0 0 3-3c0-5-4-11-10-11z"/>',
    markdown:'<rect x="3" y="6" width="18" height="12" rx="2"/><path d="m7 15 3-3 3 3M17 9v6M14.5 12 17 9l2.5 3"/>',
    wrench:'<path d="M14.7 6.3a4 4 0 0 0 5 5l-2.6 2.6a2 2 0 0 1-2.8 0l-3.4-3.4a2 2 0 0 1 0-2.8L9.7 4.3a4 4 0 0 0 5 2zM5 19l5-5"/>',
    poll:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/><path d="M4 20h16"/>',
    chat:'<path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.3A8 8 0 1 1 21 12z"/>',
  };

  function icon(name, cls) {
    const p = ICONS[name] || ICONS.info;
    return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  }

  function iconEl(name, cls) {
    const w = el('span'); w.innerHTML = icon(name, cls); return w.firstChild;
  }

  /* ============================ 3. 主题系统 ============================== */

  const Theme = {
    get pref() { return localStorage.getItem(LS_THEME) || 'auto'; },
    get effective() { return document.documentElement.getAttribute('data-theme') || 'light'; },
    resolve(pref) {
      if (pref === 'light' || pref === 'dark') return pref;
      return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    },
    set(pref, silent) {
      const p = ['auto', 'light', 'dark'].includes(pref) ? pref : 'auto';
      if (p === 'auto') localStorage.removeItem(LS_THEME); else localStorage.setItem(LS_THEME, p);
      const eff = Theme.resolve(p);
      document.documentElement.setAttribute('data-theme', eff);
      const m = document.querySelector('meta[name="theme-color"]');
      if (m) m.content = eff === 'dark' ? '#0c0f16' : '#ffffff';
      document.dispatchEvent(new CustomEvent('theme:change', { detail: { pref: p, effective: eff } }));
      if (!silent && global.API && API.token()) API.Users.updateProfile({ theme: p }).catch(() => {});
    },
    toggle() { Theme.set(Theme.effective === 'dark' ? 'light' : 'dark'); },
    init(defaultPref) {
      const pref = localStorage.getItem(LS_THEME) || defaultPref || 'auto';
      document.documentElement.setAttribute('data-theme', Theme.resolve(pref));
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (Theme.pref === 'auto') Theme.set('auto', true);
      });
    },
  };

  /* ============================ 4. Toast ================================= */

  let toastWrap = null;

  function toast(msg, type, opts) {
    opts = opts || {};
    if (!toastWrap) { toastWrap = el('div', { class: 'toast-wrap' }); document.body.appendChild(toastWrap); }
    const iconName = { success: 'checkCircle', error: 'xCircle', warn: 'alert', info: 'info' }[type] || 'info';
    const node = el('div', { class: 'toast ' + (type || 'info') });
    node.innerHTML =
      icon(iconName, 't-icon') +
      '<div class="t-body">' +
        (opts.title ? '<div class="t-title">' + esc(opts.title) + '</div>' : '') +
        '<div class="' + (opts.title ? 't-desc' : '') + '">' + esc(msg) + '</div>' +
      '</div>';
    const close = el('button', { class: 't-close', 'aria-label': 'close', html: '&times;' });
    close.onclick = () => dismiss();
    node.appendChild(close);
    toastWrap.appendChild(node);
    let tm = setTimeout(dismiss, opts.duration || 3600);
    function dismiss() {
      clearTimeout(tm);
      node.classList.add('out');
      setTimeout(() => node.remove(), 220);
    }
    return dismiss;
  }
  toast.success = (m, o) => toast(m, 'success', o);
  toast.error   = (m, o) => toast(m, 'error', o);
  toast.warn    = (m, o) => toast(m, 'warn', o);
  toast.info    = (m, o) => toast(m, 'info', o);

  /** 统一错误提示 */
  function toastError(e) {
    const msg = (e && e.message) || (global.I18N ? I18N.t('common.failed') : '操作失败');
    toast(msg, 'error');
    return msg;
  }

  /* ============================ 4.5 顶部推送 Toast ============================
   * 顶部出现的通知横幅：无关闭按钮、自动消失（默认 5s）、上划/拖拽隐藏。
   * 供 Web Push 收到消息时调用，也可用于站内重要提示。                                     */
  let pushToastWrap = null;
  function pushToast(msg, opts) {
    opts = opts || {};
    if (!pushToastWrap) { pushToastWrap = el('div', { class: 'push-toast-wrap' }); document.body.appendChild(pushToastWrap); }
    const node = el('div', { class: 'push-toast ' + (opts.type || 'info') + (opts.onClick ? ' clickable' : '') });
    node.innerHTML =
      (opts.icon ? icon(opts.icon, 'pt-icon') : '<span class="pt-icon">' + icon('bell') + '</span>') +
      '<div class="pt-body">' +
        (opts.title ? '<div class="pt-title">' + esc(opts.title) + '</div>' : '') +
        '<div class="pt-desc">' + esc(msg || '') + '</div>' +
      '</div>' +
      (opts.image ? '<img class="pt-img" src="' + esc(opts.image) + '" alt="">' : '');
    let dismissed = false;
    function dismiss() {
      if (dismissed) return; dismissed = true;
      clearTimeout(tm);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      node.classList.add('out');
      setTimeout(() => node.remove(), 280);
    }
    let startY = 0, dy = 0, dragging = false;
    function onDown(e) { dragging = true; startY = e.touches ? e.touches[0].clientY : e.clientY; node.classList.add('dragging'); }
    function onMove(e) { if (!dragging) return; const y = e.touches ? e.touches[0].clientY : e.clientY; dy = y - startY; if (dy < 0) { node.style.transform = 'translateY(' + dy + 'px)'; node.style.opacity = String(Math.max(0, 1 + dy / 140)); } }
    function onUp() { if (!dragging) return; dragging = false; node.classList.remove('dragging'); if (dy < -60) dismiss(); else { node.style.transform = ''; node.style.opacity = ''; } }
    node.addEventListener('touchstart', onDown, { passive: true });
    node.addEventListener('touchmove', onMove, { passive: true });
    node.addEventListener('touchend', onUp);
    node.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    if (opts.onClick) node.onclick = () => { opts.onClick(); dismiss(); };
    const tm = setTimeout(dismiss, opts.duration || 5000);
    pushToastWrap.appendChild(node);
    requestAnimationFrame(() => node.classList.add('in'));
    return dismiss;
  }
  App.pushToast = pushToast;

  /* 监听 Service Worker 推送，展示顶部 Toast */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      const d = e.data || {};
      if (d.type === 'mo-push' && d.payload) {
        const p = d.payload;
        const iconMap = { message: 'mail', friend: 'user-plus', reply: 'message-square', mention: 'at-sign', like: 'heart', follow: 'user-check', group: 'users', system: 'bell', submission: 'edit-3', support: 'life-buoy', letter: 'mail', oauth: 'key' };
        pushToast(p.body || '', {
          type: (p.type && p.type !== 'system') ? 'accent' : 'info',
          title: (p.title && p.title !== 'MarytOpens') ? p.title : null,
          icon: iconMap[p.type] || 'bell',
          onClick: p.link ? () => { location.href = p.link; } : null,
          duration: 5000,
        });
      }
    });
  }

  /* ============================ 5. Modal ================================= */

  function modal(opts) {
    opts = opts || {};
    const back = el('div', { class: 'modal-backdrop' });
    const box = el('div', { class: 'modal ' + (opts.size ? 'modal-' + opts.size : '') });

    const head = el('div', { class: 'modal-head' }, [
      el('h3', { text: opts.title || '' }),
      el('button', { class: 'icon-btn', 'aria-label': 'close', html: icon('x'), onClick: () => close() }),
    ]);
    const bodyNode = el('div', { class: 'modal-body' });
    if (typeof opts.body === 'string') bodyNode.innerHTML = opts.body;
    else if (opts.body) bodyNode.appendChild(opts.body);

    box.appendChild(head);
    box.appendChild(bodyNode);

    let footNode = null;
    if (opts.footer !== false) {
      footNode = el('div', { class: 'modal-foot' });
      if (opts.footer) {
        if (typeof opts.footer === 'string') footNode.innerHTML = opts.footer;
        else footNode.appendChild(opts.footer);
      } else {
        const T = global.I18N ? I18N.t.bind(I18N) : (k) => k;
        const cancelBtn = el('button', { class: 'btn', text: opts.cancelText || T('common.cancel'), onClick: () => close(false) });
        const okBtn = el('button', {
          class: 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary'),
          text: opts.okText || T('common.confirm'),
          onClick: async () => {
            if (opts.onOk) {
              okBtn.classList.add('is-loading');
              try { const r = await opts.onOk(bodyNode, close); if (r !== false) close(true); }
              catch (e) { toastError(e); }
              finally { okBtn.classList.remove('is-loading'); }
            } else close(true);
          },
        });
        if (opts.hideCancel !== true) footNode.appendChild(cancelBtn);
        footNode.appendChild(okBtn);
      }
      box.appendChild(footNode);
    }

    back.appendChild(box);
    document.body.appendChild(back);
    document.body.classList.add('no-scroll');
    requestAnimationFrame(() => back.classList.add('open'));

    function onKey(e) { if (e.key === 'Escape') close(false); }
    document.addEventListener('keydown', onKey);
    back.addEventListener('mousedown', (e) => { if (e.target === back && opts.backdropClose !== false) close(false); });

    let closed = false;
    function close(result) {
      if (closed) return; closed = true;
      document.removeEventListener('keydown', onKey);
      back.classList.remove('open');
      document.body.classList.remove('no-scroll');
      setTimeout(() => back.remove(), 220);
      if (opts.onClose) opts.onClose(result);
    }

    if (global.I18N) I18N.apply(box);
    setTimeout(() => { const f = box.querySelector('input,textarea,select'); if (f) f.focus(); }, 120);
    return { root: back, box, body: bodyNode, foot: footNode, close };
  }

  function confirmDialog(message, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      modal({
        title: opts.title || (global.I18N ? I18N.t('common.confirm') : '确认'),
        body: '<p style="margin:0;line-height:1.7">' + esc(message) + '</p>',
        okText: opts.okText, cancelText: opts.cancelText, danger: opts.danger,
        onClose: (r) => resolve(!!r),
      });
    });
  }

  function promptDialog(label, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const input = el(opts.multiline ? 'textarea' : 'input', {
        class: opts.multiline ? 'textarea' : 'input',
        value: opts.value || '', placeholder: opts.placeholder || '', maxlength: opts.maxlength || 500,
      });
      const wrap = el('div', { class: 'field' }, [el('label', { class: 'label', text: label }), input]);
      if (opts.hint) wrap.appendChild(el('div', { class: 'hint', text: opts.hint }));
      modal({
        title: opts.title || label, body: wrap, okText: opts.okText, danger: opts.danger,
        onOk: () => { if (opts.required && !input.value.trim()) { input.classList.add('is-error'); return false; } },
        onClose: (r) => resolve(r ? input.value.trim() : null),
      });
    });
  }

  /* ============================ 6. Markdown ============================== */

  /**
   * 轻量 Markdown 渲染器（零依赖、无外部资源）。
   * 支持：标题、粗斜体、删除线、行内代码、围栏代码、引用、有序/无序列表、
   *      任务列表、链接、图片、表格、分割线、自动链接、换行。
   * 所有 HTML 先转义，杜绝 XSS。
   */
  function markdown(src) {
    if (!src) return '';
    let s = String(src).replace(/\r\n/g, '\n');

    // 抽出围栏代码，避免被后续规则破坏
    const blocks = [];
    s = s.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g, (m, lang, code) => {
      blocks.push('<pre><code class="lang-' + esc(lang) + '">' + esc(code.replace(/\n$/, '')) + '</code></pre>');
      return '\u0000B' + (blocks.length - 1) + '\u0000';
    });

    s = esc(s);

    // 行内代码
    const inlines = [];
    s = s.replace(/`([^`\n]+)`/g, (m, c) => { inlines.push('<code>' + c + '</code>'); return '\u0000I' + (inlines.length - 1) + '\u0000'; });

    // 表格
    s = s.replace(/(^\|.+\|\n\|[ :\-|]+\|\n(?:\|.*\|\n?)*)/gm, (tbl) => {
      const rows = tbl.trim().split('\n');
      const head = rows[0].split('|').slice(1, -1).map((c) => c.trim());
      const aligns = rows[1].split('|').slice(1, -1).map((c) => {
        const t = c.trim();
        if (t.startsWith(':') && t.endsWith(':')) return 'center';
        if (t.endsWith(':')) return 'right'; return 'left';
      });
      let out = '<table><thead><tr>' + head.map((h, i) => '<th style="text-align:' + aligns[i] + '">' + h + '</th>').join('') + '</tr></thead><tbody>';
      for (let i = 2; i < rows.length; i++) {
        const cells = rows[i].split('|').slice(1, -1);
        if (!cells.length) continue;
        out += '<tr>' + cells.map((c, j) => '<td style="text-align:' + (aligns[j] || 'left') + '">' + c.trim() + '</td>').join('') + '</tr>';
      }
      return out + '</tbody></table>\n';
    });

    // 标题 / 分割线 / 引用
    s = s.replace(/^###### (.*)$/gm, '<h6>$1</h6>')
         .replace(/^##### (.*)$/gm, '<h5>$1</h5>')
         .replace(/^#### (.*)$/gm, '<h4>$1</h4>')
         .replace(/^### (.*)$/gm, '<h3>$1</h3>')
         .replace(/^## (.*)$/gm, '<h2>$1</h2>')
         .replace(/^# (.*)$/gm, '<h1>$1</h1>')
         .replace(/^(?:-{3,}|\*{3,}|_{3,})$/gm, '<hr>')
         .replace(/^&gt; ?(.*)$/gm, '<blockquote>$1</blockquote>')
         .replace(/<\/blockquote>\n<blockquote>/g, '<br>');

    // 列表（含任务列表）
    s = s.replace(/(^(?:[-*+] .*(?:\n|$))+)/gm, (m) => {
      const items = m.trim().split('\n').map((l) => {
        let c = l.replace(/^[-*+] /, '');
        c = c.replace(/^\[( |x|X)\] /, (mm, chk) =>
          '<input type="checkbox" disabled ' + (chk.toLowerCase() === 'x' ? 'checked' : '') + '> ');
        return '<li>' + c + '</li>';
      }).join('');
      return '<ul>' + items + '</ul>\n';
    });
    s = s.replace(/(^(?:\d+\. .*(?:\n|$))+)/gm, (m) => {
      const items = m.trim().split('\n').map((l) => '<li>' + l.replace(/^\d+\. /, '') + '</li>').join('');
      return '<ol>' + items + '</ol>\n';
    });

    // 图片 / 链接 / 强调
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
        (m, alt, u, ti) => '<img src="' + safeURL(u) + '" alt="' + alt + '"' + (ti ? ' title="' + ti + '"' : '') + ' loading="lazy">')
      .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
        (m, txt, u, ti) => '<a href="' + safeURL(u) + '"' + (ti ? ' title="' + ti + '"' : '') + ' target="_blank" rel="noopener noreferrer">' + txt + '</a>')
      .replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
      .replace(/==([^=\n]+)==/g, '<mark>$1</mark>');

    // 外部/自定义表情：:name: → <img>（仅当站点允许且 name 已注册）
    if (EMOJI_ALLOW && Object.keys(EMOJI_MAP).length) {
      s = s.replace(/(^|\s):([a-zA-Z0-9_\u4e00-\u9fa5-]{1,32}):/g, (m, pre, name) => {
        const url = EMOJI_MAP[name];
        if (!url) return m;
        return pre + '<img class="mo-emoji" src="' + esc(url) + '" alt=":' + name + ':" title=":' + name + ':" loading="lazy">';
      });
    }

    // 裸链接自动识别
    s = s.replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+)/g,
      (m, pre, u) => pre + '<a href="' + safeURL(u) + '" target="_blank" rel="noopener noreferrer">' + u + '</a>');

    // 段落化
    s = s.split(/\n{2,}/).map((chunk) => {
      const c = chunk.trim();
      if (!c) return '';
      if (/^<(h\d|ul|ol|pre|blockquote|table|hr|img|div)/i.test(c)) return c;
      if (/^\u0000B\d+\u0000$/.test(c)) return c;
      return '<p>' + c.replace(/\n/g, '<br>') + '</p>';
    }).join('\n');

    // 还原占位
    s = s.replace(/\u0000I(\d+)\u0000/g, (m, i) => inlines[+i]);
    s = s.replace(/\u0000B(\d+)\u0000/g, (m, i) => blocks[+i]);
    return s;
  }

  function safeURL(u) {
    const s = String(u || '').trim();
    if (/^(javascript|data|vbscript):/i.test(s.replace(/\s/g, ''))) return '#';
    return esc(s);
  }

  function excerptOf(md, n) {
    const plain = String(md || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[#>*_~`|-]/g, ' ')
      .replace(/\s+/g, ' ').trim();
    return plain.length > (n || 140) ? plain.slice(0, n || 140) + '…' : plain;
  }

  /* ============================ 7. Turnstile ============================= */

  const Turnstile = {
    siteKey: '', loaded: false, _widgets: {},

    load() {
      if (this.loaded || !this.siteKey) return Promise.resolve(this.loaded);
      return new Promise((resolve) => {
        if (document.getElementById('cf-turnstile-sdk')) { this.loaded = true; return resolve(true); }
        const s = el('script', {
          id: 'cf-turnstile-sdk',
          src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
          async: true, defer: true,
        });
        s.onload = () => { this.loaded = true; resolve(true); };
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
      });
    },

    /** 在容器内渲染验证组件，返回 token 获取函数 */
    async render(container, action) {
      const node = typeof container === 'string' ? $(container) : container;
      if (!node) return () => '';
      if (!this.siteKey) { node.style.display = 'none'; return () => ''; }
      node.style.display = '';
      const okLoad = await this.load();
      if (!okLoad || !global.turnstile) return () => '';
      let tokenVal = '';
      const id = global.turnstile.render(node, {
        sitekey: this.siteKey,
        action: action || 'default',
        theme: Theme.effective === 'dark' ? 'dark' : 'light',
        language: (global.I18N ? I18N.locale : 'auto').toLowerCase(),
        callback: (tk) => { tokenVal = tk; },
        'expired-callback': () => { tokenVal = ''; },
        'error-callback': () => { tokenVal = ''; },
      });
      this._widgets[action || 'default'] = id;
      return () => tokenVal;
    },

    reset(action) {
      const id = this._widgets[action || 'default'];
      if (id && global.turnstile) { try { global.turnstile.reset(id); } catch (e) { /* ignore */ } }
    },
  };

  /* ============================ 8. 会话与站点状态 ======================== */

  const Session = {
    user: null,          // publicUser
    permissions: [],     // 全局作用域权限
    isSuperAdmin: false,
    isOfficial: false,
    roleTags: [],
    unread: { notifications: 0, dm: 0 },
    ready: false,
    _p: null,

    get isLoggedIn() { return !!this.user; },

    /** 拉取当前会话；失败视为未登录 */
    load(force) {
      if (this._p && !force) return this._p;
      this._p = (async () => {
        if (!API.token()) { this.ready = true; return null; }
        try {
          const d = await API.Auth.me();
          this.user = d.user || null;
          this.permissions = d.permissions || [];
          this.isSuperAdmin = !!d.isSuperAdmin;
          this.isOfficial = !!d.isOfficial;
          this.roleTags = d.roleTags || [];
          this.unread = d.unread || { notifications: 0, dm: 0 };
          if (this.user) {
            API.setCachedUser(this.user);
            if (this.user.theme) Theme.set(this.user.theme, true);
            if (this.user.locale && global.I18N && I18N.auto) I18N.setLocale(this.user.locale, { persistRemote: false });
          }
        } catch (e) {
          this.user = null; API.clearSession();
        }
        this.ready = true;
        document.dispatchEvent(new CustomEvent('session:ready', { detail: { user: this.user } }));
        // 强制邮箱验证：在线用户即时弹窗
        try { checkForceVerify(); } catch (e) { /* 不阻塞会话加载 */ }
        return this.user;
      })();
      return this._p;
    },

    can(perm, scope) {
      if (this.isSuperAdmin) return true;
      if (!this.permissions) return false;
      if (this.permissions.includes('site.admin')) return true;
      if (!scope || scope === 'global') return this.permissions.includes(perm);
      // 非全局作用域需向服务端确认，这里仅做乐观提示
      return this.permissions.includes(perm);
    },

    /** 要求已登录，否则跳登录页 */
    require(redirect) {
      if (this.isLoggedIn) return true;
      const back = redirect || (location.pathname + location.search);
      location.href = '/login.html?redirect=' + encodeURIComponent(back);
      return false;
    },

    async logout() {
      await API.Auth.logout();
      this.user = null; this.permissions = []; this.isSuperAdmin = false;
      location.href = '/index.html';
    },
  };

  /* ==========================================================================
   * 强制邮箱验证：超管在后台「要求验证」后，未验证邮箱的在线用户立即弹窗，
   * 离线用户下次访问时弹窗；窗口不可关闭，必须完成验证（或联系管理员）。
   * 不针对访客（访客由 visitorGate 另行处理）。
   * ====================================================================== */
  let _forceVerifyEl = null;
  let _forceVerifyActive = false;

  function showForceVerifyModal() {
    if (_forceVerifyActive) return;
    if (!Session.user || !Session.user.email || Session.user.emailVerified) return;
    _forceVerifyActive = true;

    const T = (k, fb) => (global.I18N ? I18N.t(k) : (fb || k));
    const msgOf = (e) => (e && (e.message || (e.error && e.error.message))) || (typeof e === 'string' ? e : '操作失败');
    const email = Session.user.email;
    const back = el('div', { class: 'modal-backdrop force-verify-back', style: 'z-index:200' });
    const box = el('div', { class: 'modal modal-md' });
    box.innerHTML =
      '<div class="modal-head"><h3>' + icon('mail') + ' <span>请验证你的邮箱</span></h3></div>' +
      '<div class="modal-body">' +
        '<p class="muted">管理员要求你验证邮箱后才能继续使用本站。此窗口无法关闭，请按步骤完成验证。</p>' +
        '<div class="kv-list mb-3"><div class="kv-row"><span class="kv-k">邮箱</span><span class="kv-v mono">' + esc(email) + '</span></div></div>' +
        '<div id="fvStep1">' +
          '<button class="btn btn-primary btn-block" id="fvSend">' + icon('send') + ' <span>发送验证码到邮箱</span></button>' +
          '<p class="hint mt-2">若收件箱没有，请检查垃圾邮件；验证码 10 分钟内有效。</p>' +
        '</div>' +
        '<div id="fvStep2" hidden>' +
          '<div class="field"><label class="label">验证码</label>' +
            '<div class="input-group"><input class="input" id="fvCode" inputmode="numeric" maxlength="8" placeholder="6 位验证码" autocomplete="one-time-code">' +
            '<button class="btn" id="fvVerify">验证</button></div></div>' +
          '<p class="hint mt-2">没收到？<a href="#" id="fvResend">重新发送</a></p>' +
        '</div>' +
        '<div id="fvErr" class="alert alert-danger" hidden></div>' +
      '</div>';
    back.appendChild(box);
    document.body.appendChild(back);
    document.body.classList.add('no-scroll');
    requestAnimationFrame(() => back.classList.add('open'));

    // 不可关闭：拦截 ESC 与背景点击
    const onKey = (e) => { if (e.key === 'Escape') e.preventDefault(); };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('mousedown', (e) => { if (e.target === back) e.preventDefault(); });

    const errBox = () => box.querySelector('#fvErr');
    const showErr = (msg) => { const e = errBox(); if (e) { e.textContent = msg; e.hidden = false; } };
    const hideErr = () => { const e = errBox(); if (e) e.hidden = true; };

    const send = async () => {
      hideErr();
      const btn = box.querySelector('#fvSend');
      busy(btn, true);
      try {
        const d = await API.Auth.sendCode(email, 'verify');
        if (d.delivered === false) {
          showErr('验证码发送失败：' + (d.error || '邮件服务未正确配置，请联系管理员') + '。你也可以联系管理员手动标记验证。');
        } else {
          box.querySelector('#fvStep1').hidden = true;
          box.querySelector('#fvStep2').hidden = false;
          box.querySelector('#fvCode').focus();
        }
      } catch (e) { showErr(msgOf(e) || '发送失败，请稍后重试'); }
      finally { busy(btn, false); }
    };

    const verify = async () => {
      hideErr();
      const code = box.querySelector('#fvCode').value.trim();
      if (!code) { showErr('请输入验证码'); return; }
      const btn = box.querySelector('#fvVerify');
      busy(btn, true);
      try {
        await API.Auth.verifyEmail(code);
        // 验证成功：解锁
        document.removeEventListener('keydown', onKey, true);
        back.classList.remove('open');
        document.body.classList.remove('no-scroll');
        setTimeout(() => back.remove(), 220);
        _forceVerifyActive = false;
        _forceVerifyEl = null;
        toast.success('邮箱验证成功，感谢配合');
        await Session.load(true);          // 刷新会话状态
      } catch (e) { showErr(msgOf(e) || '验证码错误或已过期'); }
      finally { busy(btn, false); }
    };

    box.querySelector('#fvSend').addEventListener('click', send);
    box.querySelector('#fvResend').addEventListener('click', (e) => { e.preventDefault(); send(); });
    box.querySelector('#fvVerify').addEventListener('click', verify);
    box.querySelector('#fvCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') verify(); });

    _forceVerifyEl = back;
  }

  /** 会话加载后判断是否应弹出强制验证窗口（在线用户即时触发）。 */
  function checkForceVerify() {
    if (_forceVerifyActive) return;
    if (Session.user && Session.user.forceVerify && !Session.user.emailVerified) showForceVerifyModal();
  }

  /** 每 30s 轮询一次，捕捉超管「要求验证」时用户仍在线的场景。 */
  let _fvTimer = null;
  function startForceVerifyPoller() {
    if (_fvTimer) return;
    _fvTimer = setInterval(async () => {
      if (_forceVerifyActive || !Session.isLoggedIn) return;
      if (document.hidden) return;              // 后台页签不轮询，省请求与后端配额
      try {
        const d = await API.Auth.me();
        if (d && d.user && d.user.forceVerify && !d.user.emailVerified) {
          Session.user = d.user;
          showForceVerifyModal();
        }
      } catch (e) { /* 忽略瞬时错误 */ }
    }, 30000);
  }

  /* ==========================================================================
   * 访客闸门：未登录访客访问达阈值次数后，提示登录 / 注册（不针对已登录用户）。
   * ====================================================================== */
  function visitorGate() {
    let fired = false;
    const run = () => {
      if (fired) return; fired = true;
      if (Session.isLoggedIn) return;                       // 已登录用户绝不弹登录提示
      if (sessionStorage.getItem('mo_visit_dismiss')) return;
      let n = 0;
      try { n = parseInt(localStorage.getItem('mo_visit_count') || '0', 10) || 0; } catch (e) {}
      n += 1;
      try { localStorage.setItem('mo_visit_count', String(n)); } catch (e) {}
      const THRESHOLD = 5;
      if (n < THRESHOLD) return;

      const back = el('div', { class: 'modal-backdrop' });
      const box = el('div', { class: 'modal modal-sm' });
      box.innerHTML =
        '<div class="modal-head"><h3>' + icon('user') + ' <span>欢迎来到 ' + esc((global.Site && Site.cfg && Site.cfg.siteTitle) || '本站') + '</span></h3></div>' +
        '<div class="modal-body"><p class="muted">你已浏览多页内容，注册或登录后可发布内容、互动与收藏。现在要登录或创建账号吗？</p></div>' +
        '<div class="modal-foot">' +
          '<button class="btn" id="vgLater">稍后再说</button>' +
          '<a class="btn btn-primary" href="/register.html">创建账号</a>' +
          '<a class="btn btn-soft" href="/login.html">登录</a>' +
        '</div>';
      back.appendChild(box);
      document.body.appendChild(back);
      requestAnimationFrame(() => back.classList.add('open'));
      box.querySelector('#vgLater').addEventListener('click', () => {
        sessionStorage.setItem('mo_visit_dismiss', '1');
        back.classList.remove('open'); setTimeout(() => back.remove(), 220);
      });
    };

    // 会话可能尚未加载完成：此刻 isLoggedIn 仍为 false，直接判定会误伤已登录用户。
    // 先等会话就绪再判定；并以 2.5s 兜底，避免会话加载失败时永远不提示（仅对真实访客生效）。
    if (Session.user) { run(); }
    else {
      document.addEventListener('session:ready', run, { once: true });
      setTimeout(run, 2500);
    }
  }

  const Site = {
    cfg: null,
    async load(force) {
      const m = await API.meta(force);
      this.cfg = m.site || {};
      this.meta = m;
      Turnstile.siteKey = m.turnstileSiteKey || '';
      if (this.cfg.accent) applyAccent(this.cfg.accent);
      // 超管自定义主题（CSS 变量）
      if (this.cfg.theme) applyTheme(this.cfg.theme);
      // 外部/自定义表情
      EMOJI_ALLOW = this.cfg.allowExternalEmoji !== false;
      EMOJI_MAP = {};
      (this.cfg.emojis || []).forEach((e) => { if (e && e.name) EMOJI_MAP[e.name] = e.url; });
      initTips(this.cfg);
      if (this.cfg.siteTitle) {
        const base = document.title.includes('·') ? document.title.split('·')[0].trim() : document.title;
        document.title = base && base !== this.cfg.siteTitle ? base + ' · ' + this.cfg.siteTitle : this.cfg.siteTitle;
      }
      if (this.cfg.favicon) {
        let link = $('link[rel="icon"]');
        if (!link) { link = el('link', { rel: 'icon' }); document.head.appendChild(link); }
        link.href = API.fileURL(this.cfg.favicon);
      }
      try { document.dispatchEvent(new CustomEvent('site:ready')); } catch (e) { /* 通知补渲染 */ }
      return this.cfg;
    },
  };

  /** 应用超管自定义主题到 CSS 变量 */
  function applyTheme(theme) {
    if (!theme) return;
    const root = document.documentElement.style;
    if (theme.primary) { root.setProperty('--primary', theme.primary); root.setProperty('--accent', theme.primary); root.setProperty('--accent-rgb', hexRgb(theme.primary)); }
    if (theme.accent) root.setProperty('--accent', theme.accent);
    if (theme.bg) root.setProperty('--bg', theme.bg);
    if (theme.text) root.setProperty('--text', theme.text);
    if (theme.radius) root.setProperty('--radius', theme.radius + 'px');
    if (theme.font) root.setProperty('--font', theme.font);
  }
  function hexRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim());
    if (!m) return '109,40,217';
    return parseInt(m[1], 16) + ', ' + parseInt(m[2], 16) + ', ' + parseInt(m[3], 16);
  }

  /** 轮播超管配置的小贴士（tips），插入 main 顶部，会话内可关闭 */
  function initTips(cfg) {
    const tips = (cfg && cfg.tips) || [];
    const list = tips.filter((t) => t && (t.text || '').trim());
    if (!list.length) return;
    const main = document.querySelector('main');
    if (!main) return;
    const old = main.querySelector('.site-tip');
    if (old) old.remove();
    let idx = 0, timer = null;
    const wrap = el('div', { class: 'site-tip' });
    wrap.innerHTML =
      '<span class="tip-ic">💡</span>' +
      '<span class="tip-text"></span>' +
      '<span class="tip-dot">' + list.map((_, i) => '<i class="' + (i === 0 ? 'on' : '') + '"></i>').join('') + '</span>' +
      '<button class="icon-btn tip-close" title="关闭">' + icon('x') + '</button>';
    main.insertBefore(wrap, main.firstChild);
    const textEl = wrap.querySelector('.tip-text');
    const dotEls = wrap.querySelectorAll('.tip-dot i');
    const paint = () => { if (textEl) textEl.textContent = list[idx].text; dotEls.forEach((d, i) => d.classList.toggle('on', i === idx)); };
    paint();
    if (list.length > 1) timer = setInterval(() => { idx = (idx + 1) % list.length; paint(); }, 9000);
    wrap.querySelector('.tip-close').addEventListener('click', () => { if (timer) clearInterval(timer); wrap.remove(); });
  }

  function applyAccent(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim());
    if (!m) return;
    const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    const root = document.documentElement.style;
    root.setProperty('--accent', '#' + m[1] + m[2] + m[3]);
    root.setProperty('--accent-rgb', r + ', ' + g + ', ' + b);
    root.setProperty('--accent-hover', shade('#' + m[1] + m[2] + m[3], -14));
    root.setProperty('--accent-soft', 'rgba(' + r + ',' + g + ',' + b + ',.12)');
    root.setProperty('--accent-ring', 'rgba(' + r + ',' + g + ',' + b + ',.35)');
  }

  function shade(hex, pct) {
    const n = parseInt(hex.slice(1), 16);
    const amt = Math.round(2.55 * pct);
    const R = Math.min(255, Math.max(0, (n >> 16) + amt));
    const G = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amt));
    const B = Math.min(255, Math.max(0, (n & 0xff) + amt));
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
  }

  /* ============================ 9. 渲染小组件 ============================ */

  const PALETTE = ['#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899', '#8b5cf6'];

  /* 头像框样式白名单：必须与后端 FRAME_CLASSES 一致，渲染时强制校验，杜绝任意 CSS 注入 */
  const FRAME_CLASSES = ['frame-gold', 'frame-neon', 'frame-rose', 'frame-emerald', 'frame-galaxy'];
  /* 名片装扮 / 消息气泡皮肤白名单：同样必须与后端保持一致 */
  const CARD_CLASSES = ['card-aurora', 'card-sakura', 'card-ocean', 'card-carbon', 'card-sunset'];
  const BUBBLE_CLASSES = ['bubble-neon', 'bubble-glass', 'bubble-ink', 'bubble-candy', 'bubble-forest'];
  const safeCls = (cls, list) => (cls && list.indexOf(cls) >= 0 ? cls : '');

  function colorOf(seed) {
    let h = 0; const s = String(seed || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  /** 头像：有图用图，无图用首字母色块；可选超级管理员金边/官方蓝底/会员头像框 */
  function avatar(user, size, opts) {
    opts = opts || {};
    const sizeCls = size ? 'avatar-' + size : '';
    const cls = 'avatar ' + sizeCls + (opts.class ? ' ' + opts.class : '');
    const name = (user && (user.displayName || user.username)) || '?';
    const src = user && user.avatar ? API.fileURL(user.avatar) : '';
    const inner = src
      ? '<img class="' + cls + '" src="' + esc(src) + '" alt="' + esc(name) + '" loading="lazy" ' +
        'onerror="this.outerHTML=App.avatarFallback(' + JSON.stringify(esc(name)).replace(/"/g, '&quot;') + ',\'' + esc(cls) + '\')">'
      : avatarFallback(name, cls);

    let core = inner;
    const super_ = opts.super || (user && (user.isSuperAdmin || user.__isSuper));
    if (super_) {
      const wrapCls = 'avatar-wrap super' + (size === 'lg' || size === 'xl' || size === '2xl' ? ' official-lg' : size === 'sm' || size === 'xs' ? ' official-sm' : '');
      core = '<span class="' + wrapCls + '" title="' + esc(T('role.superBadge', '官方管理员')) + '">' + inner +
        '<span class="avatar-super-badge">★</span></span>';
    } else if (opts.official) {
      const wrapCls = 'avatar-wrap official' + (size === 'lg' || size === 'xl' || size === '2xl' ? ' official-lg' : size === 'sm' || size === 'xs' ? ' official-sm' : '');
      core = '<span class="' + wrapCls + '">' + inner + '</span>';
    }

    // 头像框（可购买装备的虚拟装扮，圈住整个头像 + 角标）
    const frameCls = (user && user.avatarFrame) || '';
    if (frameCls && FRAME_CLASSES.indexOf(frameCls) >= 0) {
      core = '<span class="avatar-frame ' + esc(frameCls) + '">' + core + '</span>';
    }
    return core;
  }

  function avatarFallback(name, cls) {
    const ch = String(name || '?').trim().charAt(0).toUpperCase();
    return '<span class="' + (cls || 'avatar') + '" style="background:' + colorOf(name) + '">' + esc(ch) + '</span>';
  }

  function roleTagsHTML(tags) {
    if (!tags || !tags.length) return '';
    return tags.slice(0, 3).map((r) => {
      const color = r.color || '#64748b';
      const icon = r.icon ? (r.icon.startsWith('http') || r.icon.startsWith('/')
        ? '<img class="rt-icon" src="' + esc(r.icon) + '" alt="">'
        : '<span class="rt-icon">' + esc(r.icon) + '</span>') : '';
      const official = r.official ? ' is-official' : '';
      // 官方账号用 CSS 预设蓝底；其余身份组用自身颜色生成淡色底，确保清晰可见、风格统一
      const style = official ? '' : (' style="color:' + esc(color) + ';background:' + esc(color) + '22;border-color:' + esc(color) + '55"');
      // 身份组名按当前语言展示：系统身份组带 key，用 i18n 翻译；自定义身份组无 key 则原样显示
      const rname = r.key ? (global.I18N ? I18N.t('role.' + r.key, r.name) : r.name) : r.name;
      return '<span class="role-tag' + official + '"' + style + ' title="' + esc(rname) + '">' + icon + esc(rname) + '</span>';
    }).join('');
  }

  /** 渲染反应条（Discord 式）：emoji + 计数，已点亮的加 .reacted */
  function reactionsHTML(reactions, targetType, targetId) {
    if (!reactions || !reactions.length) return '';
    const items = reactions.map((r) =>
      '<button type="button" class="reaction-chip' + (r.reacted ? ' reacted' : '') + '" data-emoji="' + esc(r.emoji) + '" data-tt="' + esc(targetType) + '" data-tid="' + esc(targetId) + '">' +
      emojiImg(r.emoji) + '<span class="rc-count">' + r.count + '</span></button>').join('');
    return '<div class="reaction-bar">' + items + '</div>';
  }

  /** 表情 icon：外部表情用 <img>，否则直接显示字符 */
  function emojiImg(emoji) {
    if (EMOJI_MAP && EMOJI_MAP[emoji]) return '<img class="mo-emoji" src="' + esc(EMOJI_MAP[emoji]) + '" alt=":' + esc(emoji) + ':">';
    // 形如 :name: 的自定义表情串
    const m = /^:([a-zA-Z0-9_\u4e00-\u9fa5-]+):$/.exec(emoji);
    if (m && EMOJI_MAP[m[1]]) return '<img class="mo-emoji" src="' + esc(EMOJI_MAP[m[1]]) + '" alt="' + esc(emoji) + '">';
    return '<span class="emoji-char">' + esc(emoji) + '</span>';
  }

  /** 切换一个反应，并就地刷新反应条（帖子 / 频道消息通用） */
  async function toggleReaction(targetType, id, emoji, chipEl) {
    try {
      const d = await API.Reactions.toggle(targetType, id, emoji);
      const root = chipEl ? (chipEl.closest('[data-post],[data-msg]')) : null;
      if (!root) return;
      let bar = root.querySelector('.reaction-bar');
      const html = reactionsHTML(d.reactions, targetType, id);
      if (bar) {
        if (html) bar.outerHTML = html; else bar.remove();
      } else if (html) {
        const tags = root.querySelector('.pc-tags');
        if (tags) tags.insertAdjacentHTML('beforebegin', html);
        else root.insertAdjacentHTML('beforeend', html);
      }
    } catch (err) { toastError(err); }
  }

  /** 打开表情选择器；onPick(emoji) 在选中后回调。withCustom=false 时不显示自定义表情。 */
  function openEmojiPicker(onPick, withCustom) {
    const common = ['👍', '❤️', '😂', '🎉', '🔥', '👀', '🙏', '💯', '😮', '😢', '🤔', '👏', '✅', '⚡', '🌟', '🚀', '💡', '🐱', '🍕', '☕'];
    const custom = (withCustom !== false && App.Site && App.Site.cfg && App.Site.cfg.emojis) ? App.Site.cfg.emojis : [];
    const grid = '<div class="emoji-grid">' + common.map((e) =>
      '<button type="button" class="emoji-cell" data-emoji="' + esc(e) + '">' + esc(e) + '</button>').join('') + '</div>';
    const cgrid = custom.length ? '<div class="emoji-section-title">自定义表情</div><div class="emoji-grid">' + custom.map((e) =>
      '<button type="button" class="emoji-cell" data-emoji=":' + esc(e.name) + ':" title=":' + esc(e.name) + ':">' +
      '<img class="mo-emoji" src="' + esc(e.url) + '" alt=":' + esc(e.name) + ':"></button>').join('') + '</div>' : '';
    const m = modal({
      title: '选择表情', size: 'sm', footer: false,
      body: '<div class="emoji-picker">' + grid + cgrid + '</div>',
    });
    $$('.emoji-cell', m.body).forEach((b) => b.addEventListener('click', async () => {
      m.close();
      try { await onPick(b.dataset.emoji); } catch (e) { toastError(e); }
    }));
    return m;
  }

  /** 渲染用户获得的认证/荣誉徽章 */
  function badgesHTML(badges) {
    if (!badges || !badges.length) return '';
    return '<span class="badge-list">' + badges.slice(0, 6).map((b) =>
      '<span class="badge-pill" style="background:' + esc(b.color || '#6366f1') + '">' +
      '<span class="bp-icon">' + esc(b.icon || '★') + '</span>' + esc(b.name) + '</span>').join('') + '</span>';
  }

  /** 渲染当前佩戴的称号（显示在昵称旁）。title 为后端 publicUser.title 结构 */
  function titleHTML(title) {
    if (!title || !title.name) return '';
    const color = title.color || '#6366f1';
    // 颜色只落在 style 的 color/background/border 上，且经过 esc，不存在注入面
    return '<span class="user-title' + (title.rare ? ' is-rare' : '') + '"' +
      ' style="color:' + esc(color) + ';background:' + esc(color) + '1f;border-color:' + esc(color) + '55"' +
      ' title="' + esc(title.desc || title.name) + '">' +
      (title.icon ? '<span class="ut-icon">' + esc(title.icon) + '</span>' : '') + esc(title.name) + '</span>';
  }

  /** 渲染等级徽章。
   *  - 传入 user 且含 customLevel（超管指定的专属等级）时，展示其 Markdown 等级名（安全内联渲染）；
   *  - 否则展示由经验推导的 Lv.N，等级越高配色越"热"。 */
  function levelBadgeHTML(arg) {
    const user = (arg && typeof arg === 'object') ? arg : null;
    const cl = user && user.customLevel;
    if (cl && (cl.level || cl.name)) {
      const color = /^#[0-9a-fA-F]{6}$/.test(cl.color || '') ? cl.color : '#7c3aed';
      const name = cl.name ? markdownInline(cl.name) : ('Lv.' + (parseInt(cl.level, 10) || 0));
      return '<span class="level-badge custom" style="color:' + esc(color) +
        ';background:' + esc(color) + '22;border-color:' + esc(color) + '66"' +
        ' title="' + esc(cl.name ? cl.name : ('Lv.' + cl.level)) + '">' + name + '</span>';
    }
    const n = parseInt(user ? user.level : arg, 10) || 0;
    if (n < 1) return '';
    const tier = n >= 20 ? 'lv-t4' : n >= 10 ? 'lv-t3' : n >= 5 ? 'lv-t2' : 'lv-t1';
    return '<span class="level-badge ' + tier + '" title="' + esc(T('economy.level', '等级') + ' ' + n) + '">Lv.' + n + '</span>';
  }

  /** 安全内联 Markdown 渲染（仅行内：加粗/斜体/删除线/代码/链接/标记/外部表情）。
   *  专用于等级名等用户可控文本：先整体转义再套规则，杜绝裸 HTML 与 javascript:/data: 注入。
   *  刻意禁用标题/列表/表格/引用/图片等块级元素，保证徽章内联不破版。 */
  function markdownInline(src) {
    if (!src) return '';
    let s = String(src).replace(/\r\n/g, '\n');
    s = esc(s);
    const inlines = [];
    s = s.replace(/`([^`\n]+)`/g, (m, c) => { inlines.push('<code>' + c + '</code>'); return '\u0000I' + (inlines.length - 1) + '\u0000'; });
    s = s
      .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, '') // 禁用图片
      .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
        (m, txt, u, ti) => '<a href="' + safeURL(u) + '"' + (ti ? ' title="' + ti + '"' : '') + ' target="_blank" rel="noopener noreferrer">' + txt + '</a>')
      .replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
      .replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
    if (EMOJI_ALLOW && Object.keys(EMOJI_MAP).length) {
      s = s.replace(/(^|\s):([a-zA-Z0-9_\u4e00-\u9fa5-]{1,32}):/g, (m, pre, name) => {
        const url = EMOJI_MAP[name];
        if (!url) return m;
        return pre + '<img class="mo-emoji" src="' + esc(url) + '" alt=":' + name + ':" title=":' + name + ':" loading="lazy">';
      });
    }
    s = s.replace(/\u0000I(\d+)\u0000/g, (m, i) => inlines[+i]);
    return s;
  }

  /** 昵称右侧的完整身份串：称号 + 等级（用于列表/卡片，避免各页面重复拼装） */
  function identityHTML(user, opts) {
    if (!user) return '';
    const o = opts || {};
    let s = '';
    if (o.title !== false) s += titleHTML(user.title);
    if (o.level !== false) s += levelBadgeHTML(user);
    return s;
  }

  /** 名片装扮类名（个人主页卡片背景），非白名单一律忽略 */
  const cardCls = (user) => safeCls(user && user.cardStyle, CARD_CLASSES);
  /** 消息气泡皮肤类名（聊天 / 私信） */
  const bubbleCls = (user) => safeCls(user && user.bubbleStyle, BUBBLE_CLASSES);

  function emptyState(title, desc, iconName, actionHTML) {
    return '<div class="empty">' + icon(iconName || 'inbox') +
      '<h4>' + esc(title || '') + '</h4>' +
      (desc ? '<p>' + esc(desc) + '</p>' : '') +
      (actionHTML ? '<div class="mt-4">' + actionHTML + '</div>' : '') + '</div>';
  }

  function skeletonList(n, h) {
    let s = '';
    for (let i = 0; i < (n || 3); i++) s += '<div class="skeleton sk-card" style="height:' + (h || 96) + 'px"></div>';
    return s;
  }

  function loadingBlock() { return '<div class="loading-center"><div class="spinner spinner-lg"></div></div>'; }

  /** 通用无限滚动/加载更多控制器 */
  function pager(opts) {
    const state = { cursor: null, loading: false, done: false, items: [] };
    async function next() {
      if (state.loading || state.done) return;
      state.loading = true;
      try {
        const d = await opts.fetch(state.cursor);
        const items = (d && d.items) || [];
        state.items = state.items.concat(items);
        state.cursor = d ? d.cursor : null;
        if (!state.cursor || !items.length) state.done = true;
        opts.render(items, state);
      } catch (e) { toastError(e); state.done = true; }
      finally { state.loading = false; if (opts.after) opts.after(state); }
    }
    function reset() { state.cursor = null; state.done = false; state.items = []; }
    return { state, next, reset };
  }

  /* ============================ 10. 表单助手 ============================= */

  function serializeForm(form) {
    const o = {};
    new FormData(form).forEach((v, k) => {
      if (o[k] !== undefined) { if (!Array.isArray(o[k])) o[k] = [o[k]]; o[k].push(v); }
      else o[k] = v;
    });
    form.querySelectorAll('input[type=checkbox]').forEach((c) => { if (!c.name) return; if (!c.checked && o[c.name] === undefined) o[c.name] = false; else if (c.checked) o[c.name] = true; });
    return o;
  }

  function busy(btn, on) {
    if (!btn) return;
    btn.classList.toggle('is-loading', !!on);
    btn.disabled = !!on;
  }

  function passwordStrength(p) {
    const s = String(p || '');
    let score = 0;
    if (s.length >= 8) score++;
    if (s.length >= 12) score++;
    if (/[a-z]/.test(s) && /[A-Z]/.test(s)) score++;
    if (/\d/.test(s) && /[^\w\s]/.test(s)) score++;
    return Math.min(4, score);
  }

  /** 绑定「发送验证码」倒计时按钮 */
  function bindCodeButton(btn, getEmail, purpose) {
    let ticking = 0;
    btn.addEventListener('click', async () => {
      const email = (getEmail() || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { toast.warn('请输入有效的邮箱地址'); return; }
      busy(btn, true);
      try {
        const r = await API.Auth.sendCode(email, purpose || 'register');
        // register / bind 会带回 delivered；若投递失败，明确告知原因（如 Resend from 域名未验证）
        if (r && r.delivered === false) {
          toast.error('验证码发送失败：' + (r.error ? String(r.error).slice(0, 220) : '邮件服务未正确配置，请联系管理员'));
          busy(btn, false);
          return;
        }
        toast.success('验证码已发送，请查收邮箱（含垃圾箱）');
        ticking = 60;
        const base = btn.textContent;
        const tm = setInterval(() => {
          ticking--;
          btn.textContent = global.I18N ? I18N.t('auth.resend', { s: ticking }) : ticking + 's';
          if (ticking <= 0) { clearInterval(tm); btn.textContent = base; btn.disabled = false; }
        }, 1000);
        btn.disabled = true;
        btn.classList.remove('is-loading');
      } catch (e) { toastError(e); busy(btn, false); }
    });
  }

  /* ============================ 11. 上传与裁剪 =========================== */

  const ACCEPT_IMG = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
  const MAX_IMG = 5 * 1024 * 1024;

  function validateImage(file) {
    if (!file) return '请选择文件';
    if (!ACCEPT_IMG.includes(file.type)) return '仅支持 PNG / JPEG / WebP / GIF / SVG 格式';
    if (file.size > MAX_IMG) return '图片不能超过 5MB';
    return null;
  }

  /** 头像裁剪弹窗：正方形裁剪 + 缩放拖拽 + 输出 WebP
   *  opts.kind：上传用的 kind（默认 'avatar'；官方账号用 'image' 以免覆盖超管自己的头像且绕开 2MB 头像上限） */
  function cropAvatar(file, onDone, opts) {
    const err = validateImage(file);
    if (err) { toast.error(err); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const SIZE = 320;
      const cvs = el('canvas', { width: SIZE, height: SIZE });
      const stage = el('div', { class: 'crop-stage' }, [cvs, el('div', { class: 'crop-mask' })]);
      const range = el('input', { type: 'range', min: '100', max: '320', value: '100', class: 'input', style: { padding: '0', height: '32px' } });
      const wrap = el('div', {}, [
        stage,
        el('div', { class: 'hint text-center mt-2', text: '拖动调整位置，滑块调整缩放' }),
        el('div', { class: 'mt-3' }, [range]),
      ]);

      const base = Math.max(SIZE / img.width, SIZE / img.height);
      let scale = base, ox = 0, oy = 0;
      range.value = String(Math.round(base * 100));
      range.min = String(Math.round(base * 100));
      range.max = String(Math.round(base * 300));

      const ctx = cvs.getContext('2d');
      function draw() {
        ctx.clearRect(0, 0, SIZE, SIZE);
        ctx.fillStyle = '#0b0d12'; ctx.fillRect(0, 0, SIZE, SIZE);
        const w = img.width * scale, h = img.height * scale;
        ox = Math.min(0, Math.max(SIZE - w, ox));
        oy = Math.min(0, Math.max(SIZE - h, oy));
        ctx.drawImage(img, ox, oy, w, h);
      }
      draw();

      range.oninput = () => { const old = scale; scale = Number(range.value) / 100; ox -= (img.width * (scale - old)) / 2; oy -= (img.height * (scale - old)) / 2; draw(); };

      let dragging = false, lx = 0, ly = 0;
      const down = (e) => { dragging = true; const p = e.touches ? e.touches[0] : e; lx = p.clientX; ly = p.clientY; };
      const move = (e) => { if (!dragging) return; e.preventDefault(); const p = e.touches ? e.touches[0] : e; ox += p.clientX - lx; oy += p.clientY - ly; lx = p.clientX; ly = p.clientY; draw(); };
      const up = () => { dragging = false; };
      stage.addEventListener('mousedown', down); stage.addEventListener('touchstart', down, { passive: true });
      window.addEventListener('mousemove', move); window.addEventListener('touchmove', move, { passive: false });
      window.addEventListener('mouseup', up); window.addEventListener('touchend', up);

      modal({
        title: '裁剪头像', body: wrap, okText: '上传',
        onOk: async () => {
          const blob = await new Promise((r) => cvs.toBlob(r, 'image/webp', 0.92));
          const f = new File([blob], 'avatar.webp', { type: 'image/webp' });
          const d = await API.upload((opts && opts.kind) || 'avatar', f);
          onDone(d.url || (d.data && d.data.url));
        },
        onClose: () => {
          URL.revokeObjectURL(url);
          window.removeEventListener('mousemove', move); window.removeEventListener('touchmove', move);
          window.removeEventListener('mouseup', up); window.removeEventListener('touchend', up);
        },
      });
    };
    img.onerror = () => toast.error('图片读取失败');
    img.src = url;
  }

  /** 简易上传区（拖拽 + 点击） */
  function uploadZone(node, kind, onDone, opts) {
    opts = opts || {};
    const input = el('input', { type: 'file', accept: opts.accept || 'image/*', style: { display: 'none' } });
    node.appendChild(input);
    node.addEventListener('click', () => input.click());
    node.addEventListener('dragover', (e) => { e.preventDefault(); node.classList.add('dragover'); });
    node.addEventListener('dragleave', () => node.classList.remove('dragover'));
    node.addEventListener('drop', (e) => { e.preventDefault(); node.classList.remove('dragover'); if (e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]); });
    input.addEventListener('change', () => { if (input.files[0]) handle(input.files[0]); input.value = ''; });
    async function handle(f) {
      const err = validateImage(f);
      if (err) { toast.error(err); return; }
      const tip = el('div', { class: 'progress mt-2' }, [el('div', { class: 'bar', style: { width: '0%' } })]);
      node.appendChild(tip);
      try {
        const d = await API.upload(kind, f, (p) => { tip.firstChild.style.width = p + '%'; });
        onDone(d.url || (d.data && d.data.url), d);
        toast.success('上传成功');
      } catch (e) { toastError(e); }
      finally { tip.remove(); }
    }
    return input;
  }

  /* ============================ 12. 举报弹窗 ============================= */

  function reportDialog(targetType, targetId) {
    const T = global.I18N ? I18N.t.bind(I18N) : (k) => k;
    const reasons = ['spam', 'abuse', 'illegal', 'porn', 'other'];
    const sel = el('select', { class: 'select', name: 'reason' },
      reasons.map((r) => el('option', { value: r, text: T('report.reason.' + r) })));
    const detail = el('textarea', { class: 'textarea', placeholder: T('report.detail'), maxlength: 800 });
    const body = el('div', {}, [
      el('div', { class: 'field' }, [el('label', { class: 'label', text: T('report.reason') }), sel]),
      el('div', { class: 'field' }, [el('label', { class: 'label', text: T('report.detail') + ' (' + T('common.optional') + ')' }), detail]),
    ]);
    modal({
      title: T('report.title'), body, okText: T('report.submit'), danger: true,
      onOk: async () => {
        await API.Reports.create({ targetType, targetId, reason: sel.value, detail: detail.value.trim() });
        toast.success(T('report.success'));
      },
    });
  }

  /* ==========================================================================
   * 12.9 在线人数 / 在线状态（Presence）
   * ------------------------------------------------------------------------
   * 服务端的在线态是纯内存实现（不写 KV），所以这里可以安全地定时轮询。
   * 轮询只在页面可见时进行，切到后台标签页会自动暂停，避免无谓请求。
   * ========================================================================== */

  const STATUS_META = {
    online:    { color: '#22c55e', i18n: 'status.online' },
    away:      { color: '#f59e0b', i18n: 'status.away' },
    busy:      { color: '#ef4444', i18n: 'status.busy' },
    invisible: { color: '#94a3b8', i18n: 'status.invisible' },
    offline:   { color: '#94a3b8', i18n: 'status.offline' },
  };

  const Presence = {
    data: { online: 0, members: 0, guests: 0 },
    _timer: null,
    INTERVAL: 60000,

    /** 当前用户自己的状态（未登录时为 offline） */
    get mine() {
      const u = Session.user;
      if (!u) return 'offline';
      return API.Presence.STATUSES.includes(u.status) ? u.status : 'online';
    },

    async refresh() {
      try {
        const d = await API.Presence.get();
        this.data = { online: d.online || 0, members: d.members || 0, guests: d.guests || 0 };
        this.render();
        document.dispatchEvent(new CustomEvent('presence:update', { detail: this.data }));
      } catch (e) { /* 在线人数拿不到不影响任何功能 */ }
    },

    start() {
      if (this._timer) return;
      this.refresh();
      this._timer = setInterval(() => {
        if (document.visibilityState === 'visible') this.refresh();
      }, this.INTERVAL);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.refresh();
      });
    },

    /** 把在线人数刷进导航栏的小胶囊 */
    render() {
      const n = $('#navOnline');
      if (!n) return;
      const T = global.I18N ? I18N.t.bind(I18N) : (k) => k;
      const num = global.I18N ? I18N.formatNumber(this.data.online) : this.data.online;
      n.innerHTML = '<i class="online-dot"></i><b>' + num + '</b>';
      n.title = T('presence.tip')
        .replace('{members}', this.data.members)
        .replace('{guests}', this.data.guests);
    },

    /** 修改自己的状态（在线/离开/忙碌/隐身 + 自定义文案） */
    async setStatus(status, statusText) {
      const d = await API.Presence.setStatus(status, statusText);
      if (Session.user) {
        Session.user.status = d.status;
        Session.user.statusText = d.statusText;
        API.setCachedUser(Session.user);
      }
      this.refresh();
      return d;
    },
  };

  /** 在线成员列表弹窗（隐身用户不会出现在这里） */
  async function openOnlineModal() {
    const T = global.I18N ? I18N.t.bind(I18N) : (k) => k;
    const body = el('div');
    body.innerHTML = '<div class="skeleton" style="height:120px"></div>';
    modal({ title: T('presence.title'), body, okText: T('common.close'), hideCancel: true });
    try {
      const d = await API.Presence.get(50);
      const fmt = (n) => (global.I18N ? I18N.formatNumber(n) : n);
      const list = (d.users || []).map((u) =>
        '<a class="presence-row" href="/profile.html?u=' + encodeURIComponent(u.username) + '">' +
          '<span class="avatar-wrap">' + avatar(u, 'sm') + statusDot(u.status) + '</span>' +
          '<span style="min-width:0;display:block">' +
            '<span class="bold truncate" style="display:block">' + esc(u.displayName || u.username) +
              (u.official ? ' <span class="badge badge-accent">✓</span>' : '') + '</span>' +
            '<span class="xsmall muted truncate" style="display:block">' +
              esc(u.statusText || T((STATUS_META[u.status] || STATUS_META.online).i18n)) + '</span>' +
          '</span>' +
        '</a>').join('');
      body.innerHTML =
        '<div class="presence-sum">' +
          '<div><b>' + fmt(d.online || 0) + '</b><span class="xsmall muted">' + esc(T('presence.total')) + '</span></div>' +
          '<div><b>' + fmt(d.members || 0) + '</b><span class="xsmall muted">' + esc(T('presence.members')) + '</span></div>' +
          '<div><b>' + fmt(d.guests || 0) + '</b><span class="xsmall muted">' + esc(T('presence.guests')) + '</span></div>' +
        '</div>' +
        (list ? '<div class="presence-list mt-3">' + list + '</div>'
              : '<div class="muted small mt-3">' + esc(T('presence.empty')) + '</div>') +
        '<div class="xsmall muted mt-3">' + esc(T('presence.note')) + '</div>';
    } catch (e) {
      body.innerHTML = '<div class="muted small">' + esc(T('common.loadFailed')) + '</div>';
    }
  }

  /** 状态圆点（可挂在头像右下角） */
  function statusDot(status, cls) {
    const meta = STATUS_META[status] || STATUS_META.offline;
    return '<i class="status-dot ' + (cls || '') + '" style="background:' + meta.color + '"' +
      ' data-status="' + esc(status || 'offline') + '"></i>';
  }

  /** 在线状态设置弹窗 */
  function openStatusModal() {
    const T = global.I18N ? I18N.t.bind(I18N) : (k) => k;
    const u = Session.user;
    if (!u) return;
    const cur = Presence.mine;
    const wrap = el('div');
    wrap.innerHTML =
      '<div class="status-picker">' +
      API.Presence.STATUSES.map((s) =>
        '<label class="status-opt' + (s === cur ? ' active' : '') + '">' +
          '<input type="radio" name="mo-status" value="' + s + '"' + (s === cur ? ' checked' : '') + '>' +
          '<i class="status-dot" style="background:' + STATUS_META[s].color + '"></i>' +
          '<span>' + esc(T(STATUS_META[s].i18n)) + '</span>' +
          '<em class="xsmall muted">' + esc(T('status.' + s + '.desc')) + '</em>' +
        '</label>').join('') +
      '</div>' +
      '<div class="field mt-3">' +
        '<label class="label">' + esc(T('status.custom')) + '</label>' +
        '<input class="input" id="moStatusText" maxlength="40" placeholder="' + esc(T('status.custom.ph')) + '">' +
        '<div class="xsmall muted mt-1">' + esc(T('status.custom.hint')) + '</div>' +
      '</div>';
    const input = wrap.querySelector('#moStatusText');
    input.value = u.statusText || '';
    wrap.querySelectorAll('.status-opt').forEach((lb) => {
      lb.addEventListener('click', () => {
        wrap.querySelectorAll('.status-opt').forEach((x) => x.classList.remove('active'));
        lb.classList.add('active');
      });
    });
    modal({
      title: T('status.title'), body: wrap, okText: T('common.save'),
      onOk: async () => {
        const sel = wrap.querySelector('input[name="mo-status"]:checked');
        await Presence.setStatus(sel ? sel.value : 'online', input.value.trim());
        toast.success(T('common.saved'));
        renderNavbar();
      },
    });
  }

  /* ============================ 13. 导航栏渲染 =========================== */

  const NAV_ITEMS = [
    { key: 'home',     href: '/home.html',     i18n: 'nav.home',     icon: 'home' },
    { key: 'explore',  href: '/explore.html',  i18n: 'nav.explore',  icon: 'compass' },
    { key: 'search',   href: '/search.html',   i18n: 'search.title', icon: 'search' },
    { key: 'channels', href: '/channels.html', i18n: 'nav.channels', icon: 'hash' },
  ];

  /* 常驻链接：渲染在 nav-links 横向滚动容器之外，永不因空间不足被裁掉/遮挡。
     官方公告是用户高频入口，历史上因排在 nav-links 末尾而被溢出裁切，故固定在此常驻。 */
  const PINNED_NAV = [
    { key: 'announcements', href: '/announcements.html', i18n: 'nav.announcements', icon: 'megaphone' },
  ];

  /* 顶部「更多」折叠菜单：便于后期继续添加功能/按钮而不撑爆导航栏。
     注意：渲染时该按钮始终位于 nav-links 之外，保证不被横向滚动裁掉。 */
  const EXTRA_NAV = [
    { key: 'favorites',   href: '/favorites.html',      i18n: 'nav.favorites',     icon: 'star' },
    { key: 'download',    href: '/files/download',       i18n: 'nav.filedownload', icon: 'download' },
    { key: 'gateway',     href: '/gateway.html',         i18n: 'nav.gateway',      icon: 'server' },
    { key: 'governance',  href: '/governance.html',      i18n: 'gov.title',        icon: 'users' },
    { key: 'about',       href: '/about.html',          i18n: 'nav.about',        icon: 'info' },
    { key: 'profile',     href: '/profile.html',         i18n: 'nav.profile',      icon: 'user' },
    { key: 'settings',    href: '/user_settings.html',   i18n: 'nav.settings',     icon: 'settings' },
    { key: 'help',        href: '/about.html',           i18n: 'nav.help',         icon: 'info' },
    { key: 'feedback',    href: '/feedback_center.html', i18n: 'nav.feedback',     icon: 'message' },
    { key: 'surveys',     href: '/surveys.html',         i18n: 'nav.surveys',      icon: 'poll' },
    { key: 'tools',       href: '/tools.html',           i18n: 'nav.tools',        icon: 'wrench' },
    { key: 'letters',     href: '/letters.html',         i18n: 'nav.letters',      icon: 'mail' },
    { key: 'submissions', href: '/submissions.html',     i18n: 'nav.submissions',  icon: 'edit-3' },
    { key: 'support',     href: '/support.html',         i18n: 'nav.support',      icon: 'life-buoy' },
    { key: 'codespace',   href: '/codespace.html',       i18n: 'nav.codespace',    icon: 'terminal' },
    { key: 'oauth',       href: '/oauth_apps.html',      i18n: 'nav.developer',    icon: 'code' },
    { key: 'economy',     href: '/economy.html',         i18n: 'nav.economy',      icon: 'coins' },
    { key: 'designs',     href: '/designs.html',         i18n: 'nav.designs',      icon: 'star' },
    { key: 'exgroups',    href: '/exgroups.html',        i18n: 'exg.title',        icon: 'users' },
    { key: 'groups',      href: '/groups.html',          i18n: 'group.title',      icon: 'users' },
    { key: 'files',       href: '/files.html',           i18n: 'nav.files',        icon: 'cloud' },
  ];

  /* 移动端抽屉（.sidebar）里补齐但主导航未直接展示的入口，保证手机也能访问全部版块 */
  const SIDEBAR_MORE = [
    { href: '/exgroups.html',      i18n: 'exg.title',          icon: 'users' },
    { href: '/groups.html',        i18n: 'group.title',        icon: 'users' },
    { href: '/files.html',         i18n: 'nav.files',          icon: 'cloud' },
    { href: '/announcements.html', i18n: 'nav.announcements',  icon: 'megaphone' },
    { href: '/gateway.html',       i18n: 'nav.gateway',        icon: 'server' },
    { href: '/governance.html',    i18n: 'gov.title',          icon: 'users' },
    { href: '/files/download',     i18n: 'nav.filedownload',   icon: 'download' },
    { href: '/about.html',         i18n: 'nav.about',          icon: 'info' },
    { href: '/economy.html',       i18n: 'nav.economy',        icon: 'coins' },
    { href: '/designs.html',       i18n: 'nav.designs',        icon: 'star' },
    { href: '/letters.html',       i18n: 'nav.letters',        icon: 'mail' },
    { href: '/submissions.html',   i18n: 'nav.submissions',     icon: 'edit-3' },
    { href: '/support.html',       i18n: 'nav.support',        icon: 'life-buoy' },
    { href: '/codespace.html',     i18n: 'nav.codespace',      icon: 'terminal' },
    { href: '/oauth_apps.html',    i18n: 'nav.developer',      icon: 'code' },
  ];

  let _navCurrent = '';

  /** 渲染顶部导航到 #navbar；current 用于高亮 */
  function renderNavbar(current) {
    if (current !== undefined) _navCurrent = current;
    else current = _navCurrent;
    const mount = $('#navbar');
    if (!mount) return;
    const T = global.I18N ? I18N.t.bind(I18N) : (k) => k;
    const cfg = (Site.cfg || {});
    const u = Session.user;

    const custom = (cfg.navLinks || []).filter((l) => l.position === 'nav' || !l.position);
    const links = NAV_ITEMS.map((n) =>
      '<a class="nav-link' + (n.cta ? ' nav-cta' : '') + (current === n.key ? ' active' : '') + '" href="' + n.href + '">' +
      icon(n.icon) + '<span data-i18n="' + n.i18n + '">' + T(n.i18n) + '</span></a>').join('') +
      custom.map((l) =>
      '<a class="nav-link" href="' + esc(l.url) + '"' + (l.target === '_blank' ? ' target="_blank" rel="noopener"' : '') + '>' +
      (l.icon ? icon(l.icon) : '') + '<span>' + esc(l.label) + '</span></a>').join('');

    // 「更多」折叠按钮：始终位于 nav-links 之外，避免被其横向滚动裁掉（之前网关/更多按钮「消失」的根因）
    const moreMenu =
      '<div class="dropdown nav-more">' +
        '<button class="nav-link nav-more-btn" type="button" aria-label="' + T('nav.more') + '">' + icon('more') + '<span data-i18n="nav.more">' + T('nav.more') + '</span></button>' +
        '<div class="dropdown-menu dropdown-menu-end">' +
          EXTRA_NAV.map((n) => '<a class="dropdown-item" href="' + n.href + '"' + (n.action ? ' data-nav-action="' + n.action + '"' : '') + '>' + icon(n.icon) + '<span data-i18n="' + n.i18n + '">' + T(n.i18n) + '</span></a>').join('') +
        '</div>' +
      '</div>';

    // 常驻链接（如官方公告）：渲染在 nav-links 之外，永不因横向滚动被裁切/遮挡
    const pinned = PINNED_NAV.map((n) =>
      '<a class="nav-link' + (current === n.key ? ' active' : '') + '" href="' + n.href + '">' +
      icon(n.icon) + '<span data-i18n="' + n.i18n + '">' + T(n.i18n) + '</span></a>').join('');

    const brandImg = cfg.logo
      ? '<img src="' + esc(API.fileURL(cfg.logo)) + '" alt="">'
      : '<svg viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="8" fill="url(#mo-g)"/><path d="M9 22V10l7 8 7-8v12" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><defs><linearGradient id="mo-g" x1="0" y1="0" x2="32" y2="32"><stop stop-color="#6366f1"/><stop offset="1" stop-color="#0ea5e9"/></linearGradient></defs></svg>';

    const guestActions =
      '<a class="btn btn-ghost btn-sm" href="/login.html" data-i18n="nav.login">' + T('nav.login') + '</a>' +
      '<a class="btn btn-primary btn-sm" href="/register.html" data-i18n="nav.register">' + T('nav.register') + '</a>';

    const userActions = u ? (
      '<a class="icon-btn" href="/editor.html" title="' + T('nav.write') + '" data-i18n-title="nav.write">' + icon('edit') + '</a>' +
      '<a class="icon-btn" href="/messages.html" title="' + T('nav.messages') + '" data-i18n-title="nav.messages">' + icon('mail') +
        (Session.unread.dm ? '<span class="dot">' + (Session.unread.dm > 99 ? '99+' : Session.unread.dm) + '</span>' : '') + '</a>' +
      '<a class="icon-btn" href="/notifications.html" title="' + T('nav.notifications') + '" data-i18n-title="nav.notifications">' + icon('bell') +
        (Session.unread.notifications ? '<span class="dot">' + (Session.unread.notifications > 99 ? '99+' : Session.unread.notifications) + '</span>' : '') + '</a>'
    ) : '';

    mount.className = 'navbar';
    mount.innerHTML =
      '<div class="container">' +
        '<button class="icon-btn menu-toggle" id="navMenuBtn" aria-label="' + T('nav.menu') + '">' + icon('menu') + '</button>' +
        '<a class="brand" href="' + (u ? '/home.html' : '/index.html') + '">' + brandImg +
          '<span>' + esc(cfg.siteTitle || 'MarytOpens') + '</span></a>' +
        '<nav class="nav-links">' + links + '</nav>' +
        '<div class="nav-pinned">' + pinned + '</div>' + moreMenu +
        '<div class="nav-search">' + icon('search') +
          '<input class="input" id="navSearch" type="search" placeholder="' + T('nav.search') + '" data-i18n-ph="nav.search" aria-label="search">' +
        '</div>' +
        '<div class="nav-actions">' +
          // 当前在线人数（登录用户 + 访客），点一下可查看在线成员
          '<button class="online-pill" id="navOnline" type="button" aria-label="online">' +
            '<i class="online-dot"></i><b>—</b></button>' +
          userActions +
          '<div class="dropdown" id="ddTheme">' +
            '<button class="icon-btn" aria-label="theme">' + icon(Theme.effective === 'dark' ? 'moon' : 'sun') + '</button>' +
            '<div class="dropdown-menu">' +
              '<div class="dropdown-head" data-i18n="settings.theme">' + T('settings.theme') + '</div>' +
              '<button class="dropdown-item" data-theme-set="auto">' + icon('monitor') + '<span data-i18n="settings.theme.auto">' + T('settings.theme.auto') + '</span></button>' +
              '<button class="dropdown-item" data-theme-set="light">' + icon('sun') + '<span data-i18n="settings.theme.light">' + T('settings.theme.light') + '</span></button>' +
              '<button class="dropdown-item" data-theme-set="dark">' + icon('moon') + '<span data-i18n="settings.theme.dark">' + T('settings.theme.dark') + '</span></button>' +
              '<div class="dropdown-sep"></div>' +
              (Site.cfg && Site.cfg.contact && Site.cfg.contact.enabled
                ? '<button class="dropdown-item" data-contact-open>' + icon('mail') + '<span>联系我们</span></button>'
                : '') +
            '</div>' +
          '</div>' +
          '<div class="dropdown" id="ddLang">' +
            '<button class="icon-btn" aria-label="language">' + icon('globe') + '</button>' +
            '<div class="dropdown-menu">' +
              '<div class="dropdown-head" data-i18n="settings.language">' + T('settings.language') + '</div>' +
              '<button class="dropdown-item" data-locale-set="auto">' + icon('monitor') + '<span>Auto</span></button>' +
              I18N.SUPPORTED.map((l) =>
                '<button class="dropdown-item' + (I18N.locale === l && !I18N.auto ? ' active' : '') + '" data-locale-set="' + l + '">' +
                '<span style="width:16px;text-align:center">' + I18N.LOCALE_META[l].flag + '</span>' +
                '<span>' + I18N.LOCALE_META[l].name + '</span></button>').join('') +
            '</div>' +
          '</div>' +
          (u ? userMenuHTML(u, T) : guestActions) +
        '</div>' +
      '</div>';

    bindNavbar(current);
  }

  function userMenuHTML(u, T) {
    const admin = Session.isSuperAdmin || Session.can('site.config') || Session.can('site.logs');
    const st = Presence.mine;
    const stMeta = STATUS_META[st] || STATUS_META.online;
    return '<div class="dropdown" id="ddUser">' +
      '<button class="icon-btn avatar-wrap" style="width:auto;padding:0 4px" aria-label="account">' +
        '<span class="avatar-stack">' + avatar(u, 'sm', { official: !!u.official, super: !!u.isSuperAdmin }) + statusDot(st) + '</span>' +
        '<span class="nav-role-badges" id="navRoleBadges" title="' + esc(T('role.all', '全部身份组')) + '">' + roleTagsHTML(Session.roleTags) + '</span>' +
        (function () { const ex = (Session.roleTags || []).slice(3); return ex.length ? '<button class="role-more" id="roleMoreBtn" type="button" aria-label="more roles">+' + ex.length + '</button>' : ''; })() +
        '</button>' +
      '<div class="dropdown-menu">' +
        '<div class="dropdown-user">' + avatar(u, 'lg', { official: !!u.official, super: !!u.isSuperAdmin }) +
          '<div style="min-width:0"><div class="bold truncate">' + esc(u.displayName || u.username) + '</div>' +
          '<div class="xsmall muted truncate">@' + esc(u.username) + '</div>' +
          '<div class="mt-2">' + roleTagsHTML(Session.roleTags) + '</div></div>' +
        '</div>' +
        // 在线状态：显示当前状态 + 自定义文案，点击进入设置
        '<button class="dropdown-item" id="btnStatus">' +
          '<i class="status-dot" style="background:' + stMeta.color + ';position:static;flex:none"></i>' +
          '<span class="truncate">' + esc(u.statusText || T(stMeta.i18n)) + '</span>' +
          '<span class="xsmall muted" style="margin-left:auto">' + esc(T('status.change')) + '</span>' +
        '</button>' +
        '<div class="dropdown-sep"></div>' +
        '<a class="dropdown-item" href="/profile.html?u=' + encodeURIComponent(u.username) + '">' + icon('user') + '<span data-i18n="nav.profile">' + T('nav.profile') + '</span></a>' +
        '<a class="dropdown-item" href="/profile.html?u=' + encodeURIComponent(u.username) + '&tab=posts">' + icon('file') + '<span data-i18n="nav.myposts">' + T('nav.myposts') + '</span></a>' +
        '<a class="dropdown-item" href="/favorites.html">' + icon('star') + '<span data-i18n="nav.favorites">' + T('nav.favorites') + '</span></a>' +
        '<a class="dropdown-item" href="/friends.html">' + icon('users') + '<span data-i18n="friend.title">' + T('friend.title') + '</span></a>' +
        '<a class="dropdown-item" href="/user_settings.html">' + icon('settings') + '<span data-i18n="nav.settings">' + T('nav.settings') + '</span></a>' +
        (admin ? '<div class="dropdown-sep"></div><a class="dropdown-item" href="/admin_dashboard.html">' + icon('shield') + '<span data-i18n="nav.admin">' + T('nav.admin') + '</span></a>' : '') +
        '<div class="dropdown-sep"></div>' +
        '<button class="dropdown-item danger" id="btnLogout">' + icon('logout') + '<span data-i18n="nav.logout">' + T('nav.logout') + '</span></button>' +
      '</div></div>';
  }

  function bindNavbar(current) {
    // 下拉开合
    $$('.dropdown > button').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const d = b.parentElement;
        const wasOpen = d.classList.contains('open');
        $$('.dropdown.open').forEach((x) => x.classList.remove('open'));
        d.classList.toggle('open', !wasOpen);
      });
    });
    document.addEventListener('click', () => $$('.dropdown.open').forEach((d) => d.classList.remove('open')));

    $$('[data-theme-set]').forEach((b) => b.addEventListener('click', () => {
      Theme.set(b.dataset.themeSet);
      const btn = $('#ddTheme > button');
      if (btn) btn.innerHTML = icon(Theme.effective === 'dark' ? 'moon' : 'sun');
    }));

    // 联系我们（后台启用时可见）
    $$('[data-contact-open]').forEach((b) => b.addEventListener('click', () => {
      openContactModal();
    }));

    // 「更多」菜单中的「意见反馈」→ 打开反馈弹窗（含官方主页/私信/邮件指引）
    $$('[data-nav-action="contact"]').forEach((b) => b.addEventListener('click', (e) => {
      e.preventDefault();
      openContactModal();
    }));
    $$('[data-nav-action="feedback"]').forEach((b) => b.addEventListener('click', (e) => {
      e.preventDefault();
      openFeedbackModal();
    }));

    $$('[data-locale-set]').forEach((b) => b.addEventListener('click', () => {
      I18N.setLocale(b.dataset.localeSet);
      setTimeout(() => renderNavbar(current), 30);
    }));

    const lo = $('#btnLogout');
    if (lo) lo.addEventListener('click', async () => {
      if (await confirmDialog(I18N.t('nav.logout') + '?', { danger: true })) Session.logout();
    });

    // 在线状态设置
    const stBtn = $('#btnStatus');
    if (stBtn) stBtn.addEventListener('click', (e) => { e.stopPropagation(); openStatusModal(); });

    // 在线人数胶囊 → 在线成员列表
    const onlineBtn = $('#navOnline');
    if (onlineBtn) onlineBtn.addEventListener('click', () => openOnlineModal());
    Presence.render();

    // 身份组：横向滚轮滚动 + 「更多」浮层
    const roleWrap = $('#navRoleBadges');
    if (roleWrap) {
      roleWrap.addEventListener('wheel', (e) => {
        if (roleWrap.scrollWidth > roleWrap.clientWidth + 1) {
          const d = e.deltaY || e.deltaX;
          if (d !== 0) { roleWrap.scrollLeft += d; e.preventDefault(); }
        }
      }, { passive: false });
    }
    const roleMore = $('#roleMoreBtn');
    if (roleMore) roleMore.addEventListener('click', (e) => {
      e.stopPropagation();
      const pop = $('#roleMorePop');
      if (pop) { pop.remove(); return; }
      const p = document.createElement('div');
      p.id = 'roleMorePop';
      p.className = 'role-more-pop';
      p.innerHTML = (Session.roleTags || []).map((r) => {
        const color = r.color || '#64748b';
        const style = r.official ? '' : (' style="color:' + esc(color) + ';background:' + esc(color) + '22;border-color:' + esc(color) + '55"');
        return '<span class="role-tag' + (r.official ? ' is-official' : '') + '"' + style + '>' + esc(r.name) + '</span>';
      }).join('');
      const rect = roleMore.getBoundingClientRect();
      p.style.top = (rect.bottom + 8) + 'px';
      p.style.left = Math.max(8, rect.left - 150) + 'px';
      document.body.appendChild(p);
      setTimeout(() => document.addEventListener('click', () => { const x = $('#roleMorePop'); if (x) x.remove(); }, { once: true }), 0);
    });

    const mb = $('#navMenuBtn');
    if (mb) mb.addEventListener('click', () => toggleSidebar());

    const s = $('#navSearch');
    if (s) s.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && s.value.trim()) location.href = '/explore.html?q=' + encodeURIComponent(s.value.trim());
    });
  }

  function toggleSidebar(force) {
    const sb = $('.sidebar') || $('.admin-side');
    if (!sb) return;
    const open = force !== undefined ? force : !sb.classList.contains('open');
    sb.classList.toggle('open', open);
    let bd = $('#drawerBackdrop');
    if (!bd) {
      bd = el('div', { class: 'drawer-backdrop', id: 'drawerBackdrop', onClick: () => toggleSidebar(false) });
      document.body.appendChild(bd);
    }
    bd.classList.toggle('open', open);
    document.body.classList.toggle('no-scroll', open);
  }

  /* ============================ 14. 底部功能栏 =========================== */

  function renderTabbar(current) {
    const mount = $('#tabbar');
    if (!mount) return;
    const T = global.I18N ? I18N.t.bind(I18N) : (k) => k;
    const items = Session.isLoggedIn ? [
      { key: 'home', href: '/home.html', icon: 'home', i18n: 'nav.home' },
      { key: 'explore', href: '/explore.html', icon: 'compass', i18n: 'nav.explore' },
      { key: 'announcements', href: '/announcements.html', icon: 'megaphone', i18n: 'nav.announcements' },
      { key: 'editor', href: '/editor.html', icon: 'plus', i18n: 'nav.write' },
      { key: 'messages', href: '/messages.html', icon: 'mail', i18n: 'nav.messages', dot: Session.unread.dm },
      { key: 'me', href: '/user_settings.html', icon: 'user', i18n: 'settings.title' },
    ] : [
      { key: 'index', href: '/index.html', icon: 'home', i18n: 'nav.home' },
      { key: 'about', href: '/about.html', icon: 'info', i18n: 'nav.about' },
      { key: 'login', href: '/login.html', icon: 'login', i18n: 'nav.login' },
    ];
    mount.className = 'tabbar';
    mount.innerHTML = '<div class="tabbar-inner">' + items.map((it) =>
      '<a href="' + it.href + '" class="' + (current === it.key ? 'active' : '') + '">' +
      icon(it.icon) + (it.dot ? '<span class="dot">' + (it.dot > 99 ? '99+' : it.dot) + '</span>' : '') +
      '<span data-i18n="' + it.i18n + '">' + T(it.i18n) + '</span></a>').join('') + '</div>';
    document.body.classList.add('has-tabbar');
  }

  /* ============================ 15. 页脚渲染 ============================= */

  const FOOTER_LEGAL =
    'MarytOpens | MarytTeam © 2026 | Built for modern community governance, local models, and developer workflows.\n\n' +
    'Designed for fast collaboration, review workflows, and next-gen local gateway integration.';

  function renderFooter() {
    let mount = $('#footer');
    if (!mount) {
      // 部分页面未放置页脚容器，自动补建一个，保证全站都有页脚
      mount = document.createElement('footer');
      mount.id = 'footer';
      document.body.appendChild(mount);
    }
    const T = global.I18N ? I18N.t.bind(I18N) : (k) => k;
    const cfg = Site.cfg || {};
    const custom = (cfg.navLinks || []).filter((l) => l.position === 'footer');

    mount.className = 'footer';
    mount.innerHTML =
      '<div class="container">' +
        '<div class="footer-grid">' +
          '<div class="footer-brand">' +
            '<a class="brand" href="/index.html">' +
              '<svg viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="8" fill="url(#fo-g)"/><path d="M9 22V10l7 8 7-8v12" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><defs><linearGradient id="fo-g" x1="0" y1="0" x2="32" y2="32"><stop stop-color="#6366f1"/><stop offset="1" stop-color="#0ea5e9"/></linearGradient></defs></svg>' +
              '<span>' + esc(cfg.siteTitle || 'MarytOpens') + '</span></a>' +
            '<p>' + esc(cfg.siteSubtitle || 'Modern community governance on the edge.') + '</p>' +
          '</div>' +
          '<div><h5>' + T('nav.community') + '</h5><div class="footer-links">' +
            '<a href="/home.html">' + T('nav.home') + '</a>' +
            '<a href="/explore.html">' + T('nav.explore') + '</a>' +
            '<a href="/channels.html">' + T('nav.channels') + '</a>' +
            '<a href="/groups.html">' + T('group.title') + '</a>' +
            '<a href="/editor.html">' + T('nav.write') + '</a>' +
          '</div></div>' +
          '<div><h5>' + T('settings.account') + '</h5><div class="footer-links">' +
            '<a href="/login.html">' + T('nav.login') + '</a>' +
            '<a href="/register.html">' + T('nav.register') + '</a>' +
            '<a href="/user_settings.html">' + T('nav.settings') + '</a>' +
            '<a href="/notifications.html">' + T('nav.notifications') + '</a>' +
          '</div></div>' +
          '<div><h5>' + T('nav.about') + '</h5><div class="footer-links">' +
            '<a href="/about.html">' + T('about.title') + '</a>' +
            '<a href="/index.html">' + T('landing.about') + '</a>' +
            custom.map((l) => '<a href="' + esc(l.url) + '"' + (l.target === '_blank' ? ' target="_blank" rel="noopener"' : '') + '>' + esc(l.label) + '</a>').join('') +
          '</div></div>' +
        '</div>' +
        '<div class="footer-bottom footer-align-' + (cfg.footerAlign || 'left') + '">' +
          '<div class="footer-legal">' + esc(cfg.footerText || FOOTER_LEGAL) +
            (cfg.contact && cfg.contact.enabled ? ' · <a href="#" class="footer-link" data-contact-open>' + esc(T('nav.contact', '联系我们')) + '</a>' : '') +
            ' · <a href="/changelog.html" class="footer-link">' + esc(T('nav.changelog', '更新日志')) + '</a>' +
          '</div>' +
          '<div class="footer-social">' +
            (cfg.links && cfg.links.github
              ? '<a class="icon-btn" href="' + esc(App.safeURL(cfg.links.github)) + '" target="_blank" rel="noopener" aria-label="GitHub">' + icon('github') + '</a>'
              : '<a class="icon-btn" href="https://github.com" target="_blank" rel="noopener" aria-label="GitHub">' + icon('github') + '</a>') +
            (cfg.links && cfg.links.discord
              ? '<a class="icon-btn dc-link" href="' + esc(App.safeURL(cfg.links.discord)) + '" target="_blank" rel="noopener" aria-label="Discord">' +
                (cfg.links.discordAvatar ? '<img class="brand-avatar" src="' + esc(App.dcAvatarURL(cfg.links.discordAvatar)) + '" alt="Discord" onerror="this.style.display=\'none\'">' : '') +
                icon('discord') + '</a>'
              : '<a class="icon-btn" href="https://discord.com" target="_blank" rel="noopener" aria-label="Discord">' + icon('discord') + '</a>') +
            (cfg.links && cfg.links.telegram
              ? (cfg.links.telegramAvatar
                  ? '<a class="icon-btn" href="' + esc(App.safeURL(cfg.links.telegram)) + '" target="_blank" rel="noopener" aria-label="Telegram"><img src="' + esc(App.tgAvatarURL(cfg.links.telegramAvatar)) + '" style="width:18px;height:18px;border-radius:50%;object-fit:cover" alt="Telegram" onerror="this.style.display=\'none\'"></a>'
                  : '<a class="icon-btn" href="' + esc(App.safeURL(cfg.links.telegram)) + '" target="_blank" rel="noopener" aria-label="Telegram">' + icon('telegram') + '</a>')
              : '') +
            (cfg.links && cfg.links.download
              ? '<a class="icon-btn" href="' + esc(App.safeURL(cfg.links.download)) + '" target="_blank" rel="noopener" aria-label="Download" title="' + T('nav.download') + '">' + icon('download') + '</a>'
              : '') +
          '</div>' +
        '</div>' +
        '<div class="footer-watermark" contenteditable="false">Power by MarytOpens</div>' +
      '</div>';
  }

  /* ============================ 16. 页面引导 ============================= */

  /** 顶部加载进度条 + 启动遮罩（Cloudflare 风格轨道加载器） */
  function showBootLoader() {
    if (document.getElementById('moProgress')) return;
    const p = document.createElement('div');
    p.id = 'moProgress';
    document.body.appendChild(p);
    requestAnimationFrame(() => { p.style.width = '72%'; });
    const b = document.createElement('div');
    b.id = 'moBoot';
    b.innerHTML =
      '<div class="mo-loader" aria-label="loading">' +
        '<div class="mo-loader-orbit orbit-1"></div>' +
        '<div class="mo-loader-orbit orbit-2"></div>' +
        '<div class="mo-loader-core"></div>' +
        '<div class="mo-loader-text">MarytOpens</div>' +
      '</div>' +
      '<div class="mo-boot-tip" id="moBootTip"></div>';
    document.body.appendChild(b);
  }
  function hideBootLoader() {
    clearInterval(_bootTipTimer); _bootTipTimer = null;
    const p = document.getElementById('moProgress');
    if (p) { p.style.width = '100%'; setTimeout(() => p.remove(), 350); }
    const b = document.getElementById('moBoot');
    if (b) { b.classList.add('hide'); setTimeout(() => b.remove(), 500); }
  }

  /* 多语言默认加载小贴士：后台未配置时由系统随机生成（写代码 / 文章 / Markdown 建议） */
  const DEFAULT_BOOT_TIPS = {
    'zh-CN': [
      '💡 用 Markdown 写文章时，用 `## 标题` 组织章节，读者更容易跟随思路。',
      '💡 代码块加上语言标识（如 ```js），页面会自动高亮语法。',
      '💡 长文章先列提纲再展开，比边写边想更高效。',
      '💡 善用引用块（> 文字）标注来源或引用，提升可信度。',
      '💡 提交代码前先本地跑一遍，能省下大量来回沟通成本。',
      '💡 把复杂函数拆小，每个函数只做一件事，后期维护会轻松很多。',
    ],
    'zh-TW': [
      '💡 用 Markdown 寫文章時，用 `## 標題` 組織章節，讀者更易跟隨思路。',
      '💡 程式碼區塊加上語言標識（如 ```js），頁面會自動突顯語法。',
      '💡 長文章先列提綱再展開，比邊寫邊想更高效。',
      '💡 善用引用區塊（> 文字）標註來源或引用，提升可信度。',
      '💡 提交程式碼前先本地跑一遍，能省下大量來回溝通成本。',
      '💡 把複雜函式拆小，每個函式只做一件事，後期維護會輕鬆很多。',
    ],
    'en': [
      '💡 When writing in Markdown, use `## Headings` to structure sections so readers can follow easily.',
      '💡 Add a language tag to code blocks (e.g. ```js) and the page will auto-highlight syntax.',
      '💡 Outline long articles before writing — it is far more efficient than improvising.',
      '💡 Use blockquotes (> text) to cite sources; it builds credibility.',
      '💡 Run your code locally before submitting to save rounds of back-and-forth review.',
      '💡 Keep functions small and single-purpose; future maintenance becomes much easier.',
    ],
    'ja': [
      '💡 Markdown で書くときは `## 見出し` で章を分けると読みやすくなります。',
      '💡 コードブロックに言語を指定（例: ```js）するとシンタックスハイライトされます。',
      '💡 長文はまず構成を決めてから書くと効率的です。',
      '💡 引用（> テキスト）で出典を示すと信頼性が高まります。',
      '💡 コードを提出する前にローカルで実行しておくとレビューの手間が減ります。',
      '💡 関数は小さく一つの役割に絞ると保守が楽になります。',
    ],
    'ko': [
      '💡 Markdown 으로 쓸 때 `## 제목` 으로 섹션을 나누면 읽기 쉬워집니다.',
      '💡 코드 블록에 언어를 지정(예: ```js)하면 구문 강조가 됩니다.',
      '💡 긴 글은 먼저 개요를 잡고 쓰는 게 훨씬 효율적입니다.',
      '💡 인용(> 텍스트)으로 출처를 표시하면 신뢰도가 올라갑니다.',
      '💡 코드를 제출하기 전 로컬에서 한 번 실행하면 리뷰 왕래가 줄어듭니다.',
      '💡 함수는 작게 한 가지 역할만 하도록 나누면 유지보수가 쉬워집니다.',
    ],
    'ru': [
      '💡 В Markdown используйте `## Заголовки` для структуры — так текст легче читать.',
      '💡 Укажите язык в блоке кода (например ```js), и подсветка синтаксиса появится автоматически.',
      '💡 Сначала набросайте план длинной статьи, а потом пишите — это эффективнее.',
      '💡 Цитируйте источники через (> текст), чтобы повысить доверие.',
      '💡 Запускайте код локально перед отправкой — сэкономите много итераций ревью.',
      '💡 Делайте функции маленькими и с одной задачей — поддерживать их проще.',
    ],
    'de': [
      '💡 In Markdown strukturierst du mit `## Überschriften` — dann lässt sich der Text leichter lesen.',
      '💡 Gib Codeblöcken eine Sprache an (z. B. ```js), dann wird die Syntax automatisch hervorgehoben.',
      '💡 Lange Artikel zuerst gliedern, dann schreiben — das ist effizienter.',
      '💡 Zitate (> Text) zeigen Quellen und erhöhen die Glaubwürdigkeit.',
      '💡 Führe Code lokal aus, bevor du ihn abgibst — das spart Review-Runden.',
      '💡 Halte Funktionen klein und auf eine Aufgabe fokussiert — pflegeleichter.',
    ],
    'fr': [
      '💡 En Markdown, structurez avec `## Titres` pour que le texte soit plus lisible.',
      '💡 Indiquez le langage d\'un bloc de code (ex. ```js) et la coloration syntaxique apparaît.',
      '💡 Esquissez le plan d\'un long article avant d\'écrire — c\'est plus efficace.',
      '💡 Citez vos sources avec (> texte) pour renforcer la crédibilité.',
      '💡 Exécutez le code en local avant de le soumettre — vous éviterez des allers-retours.',
      '💡 Gardez les fonctions courtes et à une seule responsabilité — plus facile à maintenir.',
    ],
    'es': [
      '💡 En Markdown, usa `## Encabezados` para estructurar — el texto será más legible.',
      '💡 Indica el lenguaje en bloques de código (ej. ```js) y resaltará la sintaxis solo.',
      '💡 Esboza un esquema antes de redactar artículos largos: es más eficiente.',
      '💡 Cita fuentes con (> texto) para ganar credibilidad.',
      '💡 Ejecuta el código en local antes de enviarlo — ahorrarás varias rondas de revisión.',
      '💡 Mantén funciones pequeñas y con una sola responsabilidad — más fácil de mantener.',
    ],
  };

  function defaultBootTips() {
    const loc = (global.I18N && I18N.locale) || 'zh-CN';
    return DEFAULT_BOOT_TIPS[loc] || DEFAULT_BOOT_TIPS['en'];
  }

  let _bootTipTimer = null;
  function setBootTip(text) {
    const e = document.getElementById('moBootTip');
    if (e) e.textContent = text || '';
  }
  /** 在加载层展示随机小贴士：getTips 可返回配置的小贴士数组，为空则用系统多语言默认 */
  function startBootTips(getTips) {
    const pick = () => {
      let list = (typeof getTips === 'function' ? getTips() : getTips) || [];
      if (!Array.isArray(list) || !list.length) list = defaultBootTips();
      const t = list[Math.floor(Math.random() * list.length)];
      setBootTip(typeof t === 'string' ? t : (t && t.text) || '');
    };
    pick();
    clearInterval(_bootTipTimer);
    _bootTipTimer = setInterval(pick, 4500);
  }

  /**
   * 每个页面统一入口：
   *   App.boot({ nav:'home', requireAuth:true, onReady(){} })
   */
  /** 给 promise 套一个超时：超时则 resolve(undefined) 而非一直挂起，避免任何一步把整页卡在加载动画 */
  function withTimeout(p, ms) {
    return new Promise((resolve) => {
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; resolve(undefined); } }, ms);
      Promise.resolve(p).then(
        (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } },
        () => { if (!done) { done = true; clearTimeout(t); resolve(undefined); } }
      );
    });
  }

  /** 渲染顶部公告条（幂等：先移除旧条）；站点配置就绪或用户关闭后再决定是否显示 */
  function renderAnnouncementBar() {
    const old = document.querySelector('.announcement-bar');
    if (old) old.remove();
    if (!Site.cfg || !Site.cfg.announcement || sessionStorage.getItem('mo_ann_hide')) return;
    const bar = el('div', { class: 'announcement-bar' });
    bar.innerHTML = esc(Site.cfg.announcement) +
      ' <button class="icon-btn" style="width:20px;height:20px;color:#fff;vertical-align:middle" aria-label="close">' + icon('x') + '</button>';
    bar.querySelector('button').onclick = () => { sessionStorage.setItem('mo_ann_hide', '1'); bar.remove(); };
    document.body.insertBefore(bar, document.body.firstChild);
  }

  async function boot(opts) {
    opts = opts || {};
    showBootLoader();
    // 加载层随机小贴士（后台可配置；未配置则用系统多语言默认）
    if (opts.bootTips) startBootTips(opts.bootTips);
    // 硬性兜底：无论发生什么异常或卡顿，最多 10 秒后强制收起加载层，绝不卡死
    let hidden = false;
    const hide = () => { if (hidden) return; hidden = true; clearTimeout(safety); hideBootLoader(); };
    const safety = setTimeout(hide, 10000);

    Theme.init();
    // 进入社区后做一次 DNS / IP 泄露自检（仅提示，不修改任何系统设置）
    runDNSLeakCheck().catch(() => {});
    API.onUnauthorized = () => {
      if (opts.requireAuth) location.href = '/login.html?redirect=' + encodeURIComponent(location.pathname + location.search);
    };
    // 写操作被「要求验证邮箱」拦截时，立即唤起强制验证弹窗
    API.onEmailVerifyRequired = () => { try { checkForceVerify(); } catch (e) { /* ignore */ } };

    // 分享查看页特例：独立渲染并直接收起
    if (location.pathname.startsWith('/f/')) {
      try { await withTimeout(renderShareView(), 8000); } catch (e) { console.error('[boot] share view error', e); }
      hide();
      return;
    }

    const needAuthGate = !!(opts.requireAuth || opts.requirePerm);
    // 站点配置 + 会话并行加载，各自限时、失败不致命；普通页不在此等待，先出界面
    withTimeout(Site.load(), 8000).catch(() => {});
    const sessionP = withTimeout(Session.load(), 10000).catch(() => {});
    if (needAuthGate) await sessionP;

    renderContactFab();   // 后台开启「联系我们」后，全站（含首页）显示浮动按钮
    Theme.init(Site.cfg && Site.cfg.themeDefault);
    // 启动强制验证轮询（捕捉超管「要求验证」时用户仍在线的场景）
    try { startForceVerifyPoller(); } catch (e) { /* 不阻塞 */ }

    // 初始化 Web Push（仅登录用户）；首次进入时柔和询问一次
    try { Push.init(); } catch (e) { /* 不阻塞 */ }
    if (Session.isLoggedIn) { try { Push.maybePromptOnce(); } catch (e) { /* 不阻塞 */ } }

    if (opts.requireAuth && !Session.isLoggedIn) {
      hide(); location.href = '/login.html?redirect=' + encodeURIComponent(location.pathname + location.search); return;
    }
    if (opts.requirePerm && !Session.can(opts.requirePerm)) {
      document.body.innerHTML = '<div class="container" style="padding:80px 20px">' +
        emptyState(I18N.t('common.forbidden'), '需要权限：' + opts.requirePerm, 'lock',
          '<a class="btn btn-primary" href="/home.html">' + I18N.t('nav.home') + '</a>') + '</div>';
      hide(); return;
    }
    // 访客闸门：未登录访客访问若干次后提示登录 / 注册（仅公开页触发）
    try { visitorGate(); } catch (e) { /* 不阻塞 */ }

    // 渲染框架（任意一步异常都不应让加载层卡死）
    try {
      renderNavbar(opts.nav);
      renderTabbar(opts.nav);
      renderFooter();
      renderSidebarNav();
    } catch (e) { console.error('[boot] render chrome error', e); }

    // 在线人数轮询（服务端纯内存实现，不消耗 KV 配额）
    try { Presence.start(); } catch (e) { /* 不阻塞 */ }
    try { renderAnnouncementBar(); } catch (e) { /* 不阻塞 */ }

    if (global.I18N) I18N.apply();
    document.addEventListener('i18n:change', () => { try { renderNavbar(opts.nav); renderTabbar(opts.nav); renderFooter(); I18N.apply(); } catch (e) {} });
    // 会话/站点就绪后补渲染（普通页不阻塞等待，状态到达后再刷新导航与公告）
    document.addEventListener('session:ready', () => { try { renderNavbar(opts.nav); renderTabbar(opts.nav); renderFooter(); } catch (e) {} });
    document.addEventListener('site:ready', () => { try { Theme.init(Site.cfg && Site.cfg.themeDefault); renderAnnouncementBar(); renderContactFab(); } catch (e) {} });

    // 关键：框架已就位，立即收起加载层，不再等 onReady 的网络请求
    hide();

    // onReady 在后台执行，异常不致命；加载层已经收起，绝不会被它卡住
    if (opts.onReady) {
      Promise.resolve().then(async () => {
        try { await opts.onReady(); }
        catch (e) { console.error('[boot] onReady error', e); }
      });
    }
    document.body.classList.add('booted');
  }

  /* ============================ 16.5 Web Push / 后台常驻 =================== */

  const Push = {
    _reg: null,
    _publicKey: '',
    _api: '',
    supported: 'serviceWorker' in navigator && 'PushManager' in window,

    init() {
      this._api = API.BASE || 'https://api.example.com';
      if (!this.supported) return;
      this._listenSwMessages();
      // 站点配置加载后尝试取 VAPID 公钥；如未生成则不影响功能
      this._fetchConfig();
    },

    async ready() {
      if (!this.supported) return null;
      if (this._reg) return this._reg;
      this._reg = await navigator.serviceWorker.ready;
      return this._reg;
    },

    async _fetchConfig() {
      try {
        const cfg = await API.Push.config();
        if (cfg && cfg.ok && cfg.enabled && cfg.publicKey) {
          this._publicKey = cfg.publicKey;
          await this.syncSwConfig();
        }
      } catch (e) { /* 静默 */ }
    },

    async syncSwConfig() {
      const reg = await this.ready();
      if (!reg || !reg.active) return;
      const payload = {
        type: 'mo-config',
        api: this._api,
        token: API.token() || '',
        locale: (global.I18N ? I18N.locale : 'zh-CN'),
        background: Session.user && Session.user.pushBackground,
      };
      if (this._publicKey) payload.publicKey = this._publicKey;
      reg.active.postMessage(payload);
    },

    _listenSwMessages() {
      if (!('serviceWorker' in navigator)) return;
      navigator.serviceWorker.addEventListener('message', (e) => {
        const d = e.data || {};
        if (d.type === 'mo-push') {
          try { Session.refreshUnread(); } catch { /* ignore */ }
        }
      });
    },

    /** 询问是否开启推送；若用户同意则订阅设备 */
    async request({ background = false } = {}) {
      if (!this.supported) return { ok: false, reason: 'unsupported' };
      const reg = await this.ready();
      if (!reg) return { ok: false, reason: 'no-sw' };
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return { ok: false, reason: 'denied' };
      if (!this._publicKey) await this._fetchConfig();
      if (!this._publicKey) return { ok: false, reason: 'no-vapid' };

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this._urlB64ToUint8Array(this._publicKey),
      });
      const result = await API.Push.subscribe({ subscription: sub.toJSON(), background: !!background });
      if (result && result.ok) {
        Session.user = Session.user || {};
        Session.user.pushEnabled = true;
        Session.user.pushBackground = !!background;
        await this.syncSwConfig();
        await API.Push.setPrefs({ background: !!background });
      }
      return { ok: true, sub: sub.toJSON(), result };
    },

    async unsubscribe({ all = false } = {}) {
      try {
        if (!this.supported) return { ok: true };
        const reg = await this.ready();
        if (reg) {
          const sub = await reg.pushManager.getSubscription();
          if (sub) await sub.unsubscribe();
        }
        await API.Push.unsubscribe({ all });
        if (Session.user) { Session.user.pushEnabled = false; Session.user.pushBackground = false; }
        await this.syncSwConfig();
        return { ok: true };
      } catch (e) { return { ok: false, error: e }; }
    },

    async requestBackground() {
      if (!this.supported) return { ok: false, reason: 'unsupported' };
      const reg = await this.ready();
      if (!reg || !reg.periodicSync) return { ok: false, reason: 'no-periodic-sync' };
      try {
        await reg.periodicSync.register('mo-digest', { minInterval: 15 * 60 * 1000 });
        if (Session.user) Session.user.pushBackground = true;
        await API.Push.setPrefs({ background: true });
        await this.syncSwConfig();
        return { ok: true };
      } catch (e) { return { ok: false, reason: String(e && e.message) }; }
    },

    /** 柔和地弹出一次授权引导（避免每次刷新都打扰） */
    async maybePromptOnce() {
      if (!Session.isLoggedIn) return;
      const key = 'mo_push_prompt_' + (Session.user && Session.user.id || 'guest');
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
      if (Notification.permission === 'default') {
        const ok = await confirmDialog(I18N.t('push.permissionAsk', { site: (Site.cfg && Site.cfg.siteTitle) || 'MarytOpens' }), { okText: I18N.t('common.confirm') });
        if (ok) await this.request();
      }
    },

    _urlB64ToUint8Array(base64String) {
      const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
      const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
      const raw = atob(base64);
      const out = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      return out;
    },
  };

  /* ============================ 17. 导出 ================================= */

  /* 通用「官方委员」管理弹窗。
   * client 需提供 5 个方法：
   *   list()            -> {items:[{userId,merit,honor,role,addedAt}]}
   *   add(data)         -> {items}   data={userId,merit,honor,role}
   *   update(uid,data)  -> {items}
   *   remove(uid)       -> {items}
   *   setChairman(uid)  -> {items}
   */
  async function openCommitteeManager(client) {
    const T = (k) => I18N.t(k);
    const nameCache = {};
    async function nameOf(uid) {
      if (nameCache[uid]) return nameCache[uid];
      try { const d = await API.Users.detail(uid); const u = (d && d.user) || d; nameCache[uid] = (u && (u.displayName || u.username)) || uid; }
      catch (e) { nameCache[uid] = uid; }
      return nameCache[uid];
    }
    async function refresh(box) {
      box.innerHTML = App.skeletonList(2, 40);
      let items = [];
      try { const d = await client.list(); items = d.items || []; }
      catch (e) { App.toastError(e); box.innerHTML = ''; return; }
      if (!items.length) { box.innerHTML = '<p class="muted small">' + T('committee.empty') + '</p>'; return; }
      const rows = await Promise.all(items.map(async (c) => {
        const nm = await nameOf(c.userId);
        const chair = c.role === 'chairman';
        return '<div class="row-between" style="gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">' +
          '<div style="min-width:0"><b>' + esc(nm) + '</b>' +
            (c.honor ? '<div class="xsmall muted">' + esc(c.honor) + '</div>' : '') +
            '<div class="xsmall muted">业绩/功勋：' + (c.merit || 0) + '</div></div>' +
          '<div class="row" style="gap:6px">' +
            (chair ? '<span class="badge badge-accent">' + T('committee.chairman') + '</span>' :
              '<button class="btn btn-sm btn-ghost" data-chair="' + esc(c.userId) + '">' + T('committee.makeChair') + '</button>') +
            '<button class="btn btn-sm btn-ghost" data-edit="' + esc(c.userId) + '">' + T('common.edit') + '</button>' +
            '<button class="btn btn-sm btn-ghost" data-del="' + esc(c.userId) + '">' + T('common.delete') + '</button>' +
          '</div></div>';
      }));
      box.innerHTML = rows.join('');
      box.querySelectorAll('[data-chair]').forEach((b) => b.onclick = async () => {
        try { await client.setChairman(b.dataset.chair); App.toast.success(T('common.success')); await refresh(box); }
        catch (e) { App.toastError(e); }
      });
      box.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
        if (!(await App.confirmDialog(T('committee.confirmRemove'), { danger: true }))) return;
        try { await client.remove(b.dataset.del); App.toast.success(T('common.success')); await refresh(box); }
        catch (e) { App.toastError(e); }
      });
      box.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => editMember(b.dataset.edit, box));
    }
    function formHTML(c) {
      c = c || {};
      return '<div class="field"><label class="label">' + T('committee.user') + '</label>' +
        '<input class="input" id="cmUid" value="' + esc(c.userId || '') + '"' + (c.userId ? ' disabled' : '') + ' placeholder="' + T('committee.userPh') + '"></div>' +
        '<div class="row" style="gap:12px">' +
          '<div class="field grow"><label class="label">' + T('committee.merit') + '</label><input class="input" id="cmMerit" type="number" value="' + (c.merit || 0) + '"></div>' +
          '<div class="field" style="flex:0 0 140px"><label class="label">' + T('committee.role') + '</label><select class="select" id="cmRole">' +
            '<option value="member">' + T('committee.member') + '</option><option value="chairman"' + (c.role === 'chairman' ? ' selected' : '') + '>' + T('committee.chairman') + '</option></select></div>' +
        '</div>' +
        '<div class="field"><label class="label">' + T('committee.honor') + '</label><textarea class="textarea" id="cmHonor" rows="2" maxlength="200">' + esc(c.honor || '') + '</textarea></div>';
    }
    async function addMember(box) {
      const body = App.el('div'); body.innerHTML = formHTML(null);
      App.modal({ title: T('committee.add'), body, okText: T('common.add'), size: 'md', onOk: async () => {
        const raw = body.querySelector('#cmUid').value.trim();
        if (!raw) { App.toast.warn(T('committee.userRequired')); return false; }
        let uid = raw;
        try { const d = await API.Users.detail(raw); const u = (d && d.user) || d; if (u && u.id) uid = u.id; } catch (e) {}
        try {
          await client.add({ userId: uid, merit: Number(body.querySelector('#cmMerit').value) || 0, honor: body.querySelector('#cmHonor').value.trim(), role: body.querySelector('#cmRole').value });
          App.toast.success(T('common.success')); await refresh(box);
        } catch (e) { App.toastError(e); return false; }
        return true;
      }});
    }
    async function editMember(uid, box) {
      let cur = null;
      try { const d = await client.list(); cur = (d.items || []).find((x) => x.userId === uid); } catch (e) {}
      const body = App.el('div'); body.innerHTML = formHTML(cur || { userId: uid });
      App.modal({ title: T('committee.edit'), body, okText: T('common.save'), size: 'md', onOk: async () => {
        try {
          await client.update(uid, { merit: Number(body.querySelector('#cmMerit').value) || 0, honor: body.querySelector('#cmHonor').value.trim(), role: body.querySelector('#cmRole').value });
          App.toast.success(T('common.success')); await refresh(box);
        } catch (e) { App.toastError(e); return false; }
        return true;
      }});
    }
    const box = App.el('div'); box.innerHTML = App.skeletonList(2, 40);
    const addBtn = App.el('button', { class: 'btn btn-primary btn-sm', text: T('committee.add') });
    const container = App.el('div');
    container.appendChild(addBtn);
    container.appendChild(box);
    addBtn.onclick = () => addMember(box);
    App.modal({ title: T('committee.title'), body: container, footer: false, size: 'md' });
    await refresh(box);
  }
  App.openCommitteeManager = openCommitteeManager;

  // 优先使用上传的自定义图标（iconUrl），否则回退到 emoji 图标。
  // style 仅用于 emoji 场景（图片用 class 控制尺寸）。
  App.iconImage = function (url, emoji, style) {
    if (url) return '<img class="icon-img" src="' + esc(API.fileURL(url)) + '" alt=""' + (style ? ' style="' + style + '"' : '') + '>';
    return '<span' + (style ? ' style="' + style + '"' : '') + '>' + esc(emoji || '📁') + '</span>';
  };

  /* 移动端抽屉（.sidebar）补齐主导航未直接展示的入口，保证手机也能访问全部版块 */
  function renderSidebarNav() {
    const T = I18N ? I18N.t.bind(I18N) : (k) => k;
    $$('.sidebar').forEach((sb) => {
      if (sb.querySelector('#sideMore')) return;
      const host = el('div', { class: 'side-group', id: 'sideMore' });
      host.innerHTML =
        '<div class="section-title">' + esc(T('nav.more', '更多')) + '</div>' +
        SIDEBAR_MORE.map((n) =>
          '<a class="side-item" href="' + n.href + '"><span class="ic">' + icon(n.icon) + '</span><span data-i18n="' + n.i18n + '">' + esc(T(n.i18n)) + '</span></a>'
        ).join('');
      sb.appendChild(host);
    });
  }
  App.renderSidebarNav = renderSidebarNav;

  function offRow(iconUrl, iconTxt, name, sub, href) {
    return '<a class="row" style="gap:12px;padding:10px 0;border-bottom:1px solid var(--border);min-width:0"' +
      (href ? ' href="' + esc(href) + '"' : '') + '>' +
      '<div style="font-size:30px;line-height:1">' + App.iconImage(iconUrl, iconTxt || '📁', 'font-size:30px') + '</div>' +
      '<div style="flex:1;min-width:0"><b class="truncate">' + esc(name) + '</b>' +
        (sub ? '<div class="xsmall muted truncate">' + esc(sub) + '</div>' : '') + '</div>' +
      '<span class="badge badge-ok">' + esc(I18N ? I18N.t('official.badge', '官方') : '官方') + '</span></a>';
  }

  /** 渲染「官方栏」：合并官方公告/文章 + 官方版块/频道/群组。
   *  mount 为元素或 id；opts.announcements=false 可只渲染官方版块部分。 */
  async function renderOfficialColumn(mount, opts) {
    opts = opts || {};
    const box = typeof mount === 'string' ? document.getElementById(mount) : mount;
    if (!box) return;
    const T = I18N ? I18N.t.bind(I18N) : (k, d) => d || k;
    box.innerHTML = '<div class="skeleton sk-line w60"></div>';
    try {
      const [annRes, off] = await Promise.all([
        opts.announcements === false ? Promise.resolve({ items: [] })
          : API.Announcements.list({ limit: opts.announceLimit || 5 }).catch(() => ({ items: [] })),
        API.OfficialItems.list().catch(() => ({ boards: [], channels: [], groups: [] })),
      ]);
      const list = (annRes && annRes.items) || [];
      let html = '';
      if (opts.announcements !== false && list.length) {
        html += '<div class="card card-pad"><div class="card-head"><h3 class="mb-0">' + esc(T('ann.title', '官方公告')) + '</h3>' +
          '<a class="btn btn-ghost btn-sm" href="/announcements.html">' + esc(T('nav.more', '更多')) + '</a></div><div class="card-body">';
        html += list.map((a) => {
          const pinned = a.pinned ? '<span class="badge badge-accent">' + icon('pin') + ' ' + esc(T('ann.pin', '置顶')) + '</span>' : '';
          const official = a.official ? '<span class="badge badge-ok">' + esc(T('ann.official', '官方')) + '</span>' : '';
          const metaParts = [];
          if (a.authorName) metaParts.push(a.authorName);
          if (a.createdAt) { try { metaParts.push(new Date(a.createdAt).toLocaleString()); } catch (e) {} }
          const meta = metaParts.join(' · ');
          const href = a.kind === 'post' ? ('/post.html?id=' + encodeURIComponent(a.id)) : '';
          return '<div class="card card-pad' + (href ? ' clickable' : '') + '"' +
            (href ? ' style="cursor:pointer" onclick="location.href=\'' + href + '\'"' : '') + '>' +
            '<div class="row-between wrap mb-2" style="gap:8px">' +
              '<h3 style="margin:0;font-size:var(--fs-lg)">' + esc(a.title || T('ann.untitled', '无标题')) + '</h3>' +
              '<div class="row" style="gap:6px">' + (a.kind === 'post' ? '<span class="badge badge-soft">文章</span>' : '') + pinned + official + '</div>' +
            '</div>' +
            '<div class="prose small">' + (App.markdown ? App.markdown(a.body || '') : esc(a.body || '')) + '</div>' +
            (meta ? '<div class="small muted2 mt-2">' + esc(meta) + '</div>' : '') +
          '</div>';
        }).join('');
        html += '</div></div>';
      }
      const boards = (off && off.boards) || [], channels = (off && off.channels) || [], groups = (off && off.groups) || [];
      if (boards.length || channels.length || groups.length) {
        html += '<div class="card card-pad"><div class="card-head"><h3 class="mb-0">' + esc(T('official.colTitle', '官方版块 / 频道 / 群组')) + '</h3></div><div class="card-body">';
        if (boards.length) { html += '<div class="section-title">版块</div>' + boards.map((b) => offRow(b.iconUrl, b.icon, b.name, b.description, '/channels.html?id=' + encodeURIComponent(b.id))).join(''); }
        if (channels.length) {
          html += '<div class="section-title mt-4">频道</div>' + channels.map((c) => {
            const href = '/channels.html?id=' + encodeURIComponent(c.boardId || '') + (c.boardId ? '&channel=' + encodeURIComponent(c.id) : '');
            return offRow(c.iconUrl, c.icon, c.name, c.topic, href);
          }).join('');
        }
        if (groups.length) { html += '<div class="section-title mt-4">群组</div>' + groups.map((g) => offRow(g.iconUrl, g.icon, g.name, g.description, '/groups.html')).join(''); }
        html += '</div></div>';
      }
      box.innerHTML = html || '<div class="muted text-center">' + esc(T('official.empty', '暂无官方内容')) + '</div>';
      if (window.I18N && I18N.apply) I18N.apply(box);
    } catch (e) {
      box.innerHTML = '<div class="muted text-center">' + esc(T('official.empty', '暂无官方内容')) + '</div>';
    }
  }
  App.renderOfficialColumn = renderOfficialColumn;

  Object.assign(App, {
    $, $$, el, esc, icon, iconEl, ICONS, debounce, throttle, copy,
    Theme, toast, toastError, modal, confirmDialog, promptDialog,
    markdown, markdownInline, excerptOf, safeURL, Turnstile,
    Session, Site, applyAccent, colorOf,
    canAnnounce: () => !!(Session.user && (Session.user.official || Session.isSuperAdmin)),
    avatar, avatarFallback, roleTagsHTML, badgesHTML, emptyState, skeletonList, loadingBlock, pager,
    titleHTML, levelBadgeHTML, identityHTML, cardCls, bubbleCls,
    FRAME_CLASSES, CARD_CLASSES, BUBBLE_CLASSES,
    reactionsHTML, emojiImg, openEmojiPicker, applyTheme, toggleReaction,
    serializeForm, busy, passwordStrength, bindCodeButton,
    validateImage, cropAvatar, uploadZone, reportDialog,
    renderNavbar, renderTabbar, renderFooter, toggleSidebar, boot, Push,
    Presence, STATUS_META, statusDot, openStatusModal, openOnlineModal,
    FOOTER_LEGAL, NAV_ITEMS, renderSidebarNav, renderOfficialColumn,
    openContactModal, openFeedbackModal, tgAvatarURL, dcAvatarURL, contentGate, runDNSLeakCheck, detectLeak,
  });

  // 供首页内联脚本（index.html 不走 App.boot）调用
  App.renderShareView = renderShareView;
  App.renderContactFab = renderContactFab;

  global.Site = Site;   // 首页内联脚本通过全局 Site 加载配置
  App.Site = Site;      // 供 App.Site.cfg.* 读取（联系我们 / 意见反馈 / 自定义表情）
  global.App = App;

  // 全局委托：联系我们入口（页脚等任意位置）
  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-contact-open]');
    if (el) { e.preventDefault(); if (typeof openContactModal === 'function') openContactModal(); }
  });

  /**
   * Telegram 头像 URL 处理：
   *  - 若已是 Telegram 官方 CDN 头像（telesco.pe / cdn-telegram.org / telegram.org），
   *    该 CDN 允许浏览器跨域直连热链（Access-Control-Allow-Origin: *），
   *    直接返回原 URL，绕开 api 域的 Bot Fight Mode 挑战与代理白名单限制。
   *  - 其它域（如 og:image 落在非官方 CDN）才走 Worker 代理。
   */
  const T = (k, d) => (window.I18N ? window.I18N.t(k, d) : (d || k));

  function tgAvatarURL(raw) {
    if (!raw) return '';
    if (/^https:\/\/(?:[a-z0-9-]+\.)*(?:telesco\.pe|cdn-telegram\.org|telegram\.org)\//i.test(raw)) return raw;
    if (/^https?:\/\//.test(raw)) return API.BASE + '/api/telegram/avatar?u=' + encodeURIComponent(raw);
    return raw;
  }

  /**
   * Discord 头像 URL：Discord CDN（cdn.discordapp.com / media.discordapp.net）允许浏览器直连热链，
   * 直接返回原 URL；其它情况也照原样返回（调用方回退到 Discord 图标）。
   */
  function dcAvatarURL(raw) {
    if (!raw) return '';
    return raw;
  }

  /* ------------------ 敏感 / 剧透 内容霸屏提醒 ------------------ */
  // opts: { kind:'sensitive'|'spoiler', title, desc, id, onContinue, onLeave }
  function contentGate(opts) {
    opts = opts || {};
    const id = 'gate:' + (opts.id || opts.kind || 'x');
    if (sessionStorage.getItem(id)) { if (opts.onContinue) opts.onContinue(); return; }
    const isSpoiler = opts.kind === 'spoiler';
    const overlay = document.createElement('div');
    overlay.className = 'content-gate' + (isSpoiler ? ' is-spoiler' : '');
    overlay.innerHTML =
      '<div class="cg-card">' +
        '<div class="cg-icon">' + icon(isSpoiler ? 'eye-off' : 'alert-triangle') + '</div>' +
        '<h3 class="cg-title">' + esc(opts.title || (isSpoiler ? T('gate.spoilerTitle', '剧透内容提醒') : T('gate.sensitiveTitle', '敏感内容提醒'))) + '</h3>' +
        '<p class="cg-desc">' + esc(opts.desc || (isSpoiler
          ? T('gate.spoilerDesc', '该区域可能包含剧透内容，确认要继续查看吗？')
          : T('gate.sensitiveDesc', '该区域可能包含敏感内容，确认要继续查看吗？'))) + '</p>' +
        '<div class="cg-actions">' +
          '<button class="btn btn-danger" id="cgContinue">' + esc(T('gate.continue', '继续')) + '</button>' +
          '<span class="cg-leave" id="cgLeave">' + esc(T('gate.leave', '离开')) + '</span>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    overlay.querySelector('#cgContinue').addEventListener('click', () => {
      sessionStorage.setItem(id, '1');
      overlay.remove();
      document.body.style.overflow = '';
      if (opts.onContinue) opts.onContinue();
    });
    overlay.querySelector('#cgLeave').addEventListener('click', () => {
      if (opts.onLeave) opts.onLeave();
      else location.href = '/';
    });
  }

  /* ------------------ DNS / IP 泄露检测与修复引导 ------------------ */
  function detectLeak() {
    return new Promise((resolve) => {
      const ips = new Set();
      try {
        const RTCPc = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
        if (!RTCPc) return resolve({ leak: false, ips: [] });
        const pc = new RTCPc({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        pc.createDataChannel('');
        pc.onicecandidate = (e) => {
          if (!e.candidate) return;
          const m = (e.candidate.candidate || '').match(/([0-9]{1,3}(\.[0-9]{1,3}){3})/);
          if (m) ips.add(m[1]);
        };
        pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => {});
        setTimeout(() => { try { pc.close(); } catch (e) {} resolve({ leak: ips.size > 0, ips: [...ips] }); }, 1200);
      } catch (e) { resolve({ leak: false, ips: [] }); }
    });
  }

  async function runDNSLeakCheck(force) {
    if (!force && sessionStorage.getItem('dns_leak_checked')) return;
    sessionStorage.setItem('dns_leak_checked', '1');
    const { leak, ips } = await detectLeak();
    if (leak) showDNSModal(ips);
  }

  function showDNSModal(ips) {
    const body =
      '<p>' + esc(T('dns.desc', '我们检测到你的网络可能正在泄露本地 IP 地址（WebRTC 泄露），这会让你的真实位置暴露。')) + '</p>' +
      (ips && ips.length ? '<div class="dns-ips">' + ips.map((i) => '<code>' + esc(i) + '</code>').join(' ') + '</div>' : '') +
      '<p class="muted small">' + esc(T('dns.fixNote', '点击下方按钮可下载一个修复工具，由你自行在电脑/浏览器上运行来关闭 WebRTC 泄露、改用公共 DNS。我们不会也无法远程修改你的系统设置。')) + '</p>';
    App.modal({
      title: icon('shield') + ' ' + T('dns.title', '检测到可能的网络泄露'),
      body,
      okText: T('dns.fix', '下载修复工具'),
      cancelText: T('dns.later', '稍后再说'),
      onOk: () => { downloadDNSTool(); return true; },
    });
  }

  function downloadDNSTool() {
    const ua = navigator.platform || navigator.userAgent || '';
    const isWin = /Win/i.test(ua);
    const isMac = /Mac/i.test(ua);
    let name, content;
    if (isWin) {
      name = 'fix-dns-leak.ps1';
      content = [
        '# 以管理员身份在 PowerShell 运行：设置公共 DNS 并刷新缓存',
        '$adapters = Get-NetAdapter | Where-Object { $_.Status -eq "Up" }',
        'foreach ($a in $adapters) {',
        '  Set-DnsClientServerAddress -InterfaceIndex $a.InterfaceIndex -ServerAddresses ("1.1.1.1","8.8.8.8") -ErrorAction SilentlyContinue',
        '}',
        'ipconfig /flushdns',
        'Write-Host "DNS 已更新为 1.1.1.1 / 8.8.8.8，并刷新了 DNS 缓存。"',
        'Write-Host "如需彻底关闭 WebRTC 泄露，请安装 uBlock Origin 等扩展，或使用 Firefox 并将 media.peerconnection.enabled 设为 false。"',
      ].join('\r\n');
    } else if (isMac) {
      name = 'fix-dns-leak.sh';
      content = [
        '# 在终端以 sudo 运行：设置公共 DNS 并刷新缓存',
        'sudo networksetup -setdnsservers Wi-Fi 1.1.1.1 8.8.8.8',
        'sudo dscacheutil -flushcache',
        'sudo killall -HUP mDNSResponder',
        'echo "DNS 已更新为 1.1.1.1 / 8.8.8.8，并刷新了 DNS 缓存。"',
        'echo "如需彻底关闭 WebRTC 泄露，请安装 uBlock Origin 等扩展，或使用 Firefox 并将 media.peerconnection.enabled 设为 false。"',
      ].join('\n');
    } else {
      name = 'fix-dns-leak.sh';
      content = [
        '# 在终端以 sudo 运行（systemd-resolved）：',
        'sudo sed -i "s/#DNS=/DNS=1.1.1.1 8.8.8.8/" /etc/systemd/resolved.conf 2>/dev/null',
        'sudo systemctl restart systemd-resolved 2>/dev/null',
        'sudo resolvectl dns "$(ip route | grep default | awk \'{print $5}\')" 1.1.1.1 8.8.8.8 2>/dev/null',
        'echo "DNS 已尝试更新为 1.1.1.1 / 8.8.8.8。"',
        'echo "如需彻底关闭 WebRTC 泄露，请安装 uBlock Origin 等扩展，或使用 Firefox 并将 media.peerconnection.enabled 设为 false。"',
      ].join('\n');
    }
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast.success(T('dns.downloaded', '修复工具已下载，请按文件内说明自行运行。'));
  }

/* ==========================================================================
 * 联系我们（用户侧入口）：由后台 contact 配置驱动，按类型差异化处理
 *   - email：拉起用户邮箱（优先已登录账号邮箱）并发送反馈邮件给超管邮箱
 *   - url  ：询问是否跳转
 *   - qq   ：尝试拉起 QQ 加好友 / 加群
 * ========================================================================== */
async function openContactModal() {
  const c = (App.Site && App.Site.cfg && App.Site.cfg.contact) || {};
  if (!c.enabled || !c.value) { toast('联系渠道暂未配置'); return; }

  // URL 类型：直接询问是否跳转
  if (c.type === 'url') {
    const ok = await confirmDialog('是否跳转到：\n' + c.value + '？', { okText: '前往', title: '联系我们' });
    if (ok) window.open(c.value, '_blank', 'noopener');
    return;
  }

  const body = el('div', {});
  const m = modal({ title: '联系我们', body, footer: false });

  if (c.type === 'email') {
    const prefill = (App.Session && App.Session.user && App.Session.user.email) ? App.Session.user.email : '';
    body.innerHTML =
      '<p class="muted">请留下你的邮箱与反馈，我们会尽快回复。</p>' +
      '<div class="field"><label class="label">你的邮箱</label>' +
      '<input class="input" id="ctEmail" type="email" placeholder="you@example.com" value="' + esc(prefill) + '"></div>' +
      '<div class="field"><label class="label">反馈内容</label>' +
      '<textarea class="textarea" id="ctMsg" rows="5" placeholder="想说的话…"></textarea></div>' +
      (c.note ? '<p class="hint">' + esc(c.note) + '</p>' : '');
    const row = el('div', { class: 'row', style: 'gap:8px;margin-top:12px;justify-content:flex-end' });
    const sendBtn = el('button', { class: 'btn btn-primary', text: '发送' });
    const closeBtn = el('button', { class: 'btn', text: '取消' });
    row.appendChild(closeBtn); row.appendChild(sendBtn);
    body.appendChild(row);
    closeBtn.onclick = () => m.close();
    sendBtn.onclick = async () => {
      const email = body.querySelector('#ctEmail').value.trim();
      const msg = body.querySelector('#ctMsg').value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('请填写有效的邮箱'); return; }
      if (msg.length < 5) { toast('反馈内容至少 5 个字符'); return; }
      sendBtn.disabled = true; sendBtn.classList.add('is-loading');
      try {
        await API.post('/api/contact/feedback', { email, message: msg });
        toast.success('已发送，感谢反馈！');
        m.close();
      } catch (e) { toastError(e); }
      finally { sendBtn.disabled = false; sendBtn.classList.remove('is-loading'); }
    };
    return;
  }

  // QQ 类型：拉起 QQ 加好友 / 加群
  const val = c.value;
  const isUrl = /^https?:\/\//i.test(val);
  body.innerHTML =
    '<p class="muted">通过 QQ 与站长联系' + (isUrl ? '（点击打开邀请 / 加群链接）' : '（点击下方按钮尝试拉起 QQ 客户端）') + '。</p>' +
    '<div class="kv-list mb-3"><div class="kv-row"><span class="kv-k">QQ / 群</span><span class="kv-v mono">' + esc(val) + '</span></div></div>' +
    (c.note ? '<p class="hint">' + esc(c.note) + '</p>' : '');
  const row = el('div', { class: 'row', style: 'gap:8px;margin-top:12px;justify-content:flex-end' });
  const openBtn = el('button', { class: 'btn btn-primary', text: isUrl ? '打开链接' : '打开 QQ' });
  const copyBtn = el('button', { class: 'btn', text: '复制号码' });
  const closeBtn = el('button', { class: 'btn', text: '关闭' });
  row.appendChild(closeBtn); row.appendChild(copyBtn); row.appendChild(openBtn);
  body.appendChild(row);
  closeBtn.onclick = () => m.close();
  copyBtn.onclick = async () => { try { await App.copy(val); toast.success('已复制'); } catch (e) { toast('复制失败'); } };
  openBtn.onclick = () => {
    if (isUrl) { window.open(val, '_blank', 'noopener'); m.close(); return; }
    try {
      // 通过隐藏 iframe 拉起 QQ 协议，避免整页跳转
      const ifr = el('iframe', { style: 'display:none' });
      ifr.src = 'tencent://message/?uin=' + encodeURIComponent(val);
      document.body.appendChild(ifr);
      setTimeout(() => ifr.remove(), 3000);
    } catch (e) { /* ignore */ }
    toast('正在尝试拉起 QQ，若未响应请复制号码手动添加');
  };
}

// 全站浮动「联系我们」按钮：后台开启 contact.enabled 后，首页及所有页面均显示
function renderContactFab() {
  const c = (App.Site && App.Site.cfg && App.Site.cfg.contact) || {};
  const exist = document.getElementById('moContactFab');
  if (!c.enabled) { if (exist) exist.remove(); return; }
  if (exist) return; // 已渲染，避免重复
  const fab = document.createElement('button');
  fab.id = 'moContactFab';
  fab.className = 'mo-contact-fab';
  fab.setAttribute('aria-label', '联系我们');
  fab.innerHTML = icon('mail') + '<span>联系我们</span>';
  fab.addEventListener('click', () => { try { openContactModal(); } catch (e) { /* ignore */ } });
  document.body.appendChild(fab);
}

// 主域 SPA 直接访问 /f/owner/id 时就地渲染分享查看页（复用后端 /api/share JSON 接口）
async function renderShareView() {
  /* 走 API.BASE：可随主入口被 BFM 挑战时自动切到备用通道 */
  const API_BASE = (global.API && API.BASE)
    || (document.querySelector('meta[name="mo-api"]') || {}).content
    || 'https://api.example.com';
  const parts = location.pathname.split('/').filter(Boolean);
  const owner = parts[1], id = parts[2];
  if (!owner || !id) { document.body.innerHTML = '<div class="container" style="padding:80px 20px;text-align:center">分享链接格式不正确</div>'; return; }
  const code = new URLSearchParams(location.search).get('code') || '';
  document.body.className = '';
  document.body.style.cssText = 'background:linear-gradient(135deg,#0f172a,#1e1b4b);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'width:100%;max-width:520px';
  wrap.innerHTML = '<div class="card" style="padding:28px;color:#1a1d24;background:#fff;border-radius:18px"><div style="text-align:center;padding:20px 0;color:#64748b">正在加载文件信息…</div></div>';
  document.body.innerHTML = '';
  document.body.appendChild(wrap);
  try {
    const res = await fetch(API_BASE + '/api/share/' + encodeURIComponent(owner) + '/' + encodeURIComponent(id) + (code ? '?code=' + encodeURIComponent(code) : ''), { headers: { 'X-Requested-With': 'fetch' } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      if (res.status === 410) return showShareError(wrap, '链接已过期');
      return showShareError(wrap, data.message || '文件不存在或链接无效');
    }
    if (data.requiresCode && !code) return showShareCodeBox(wrap, owner, id);
    showShareFile(wrap, data, owner, id, API_BASE);
  } catch (e) {
    showShareError(wrap, '加载失败：' + (e.message || e));
  }
}

function showShareFile(wrap, data, owner, id, API_BASE) {
  const m = data.meta || {};
  const size = (m.size == null) ? '' : (m.size < 1048576 ? (m.size / 1024).toFixed(1) + ' KB' : (m.size / 1048576).toFixed(2) + ' MB');
  const dlUrl = data.downloadUrl || (API_BASE + '/f/' + encodeURIComponent(owner) + '/' + encodeURIComponent(id) + '/raw');
  const fname = m.name || '未命名文件';
  wrap.innerHTML =
    '<div class="card" style="padding:28px;color:#1a1d24;background:#fff;border-radius:18px">' +
      '<div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">' +
        '<div style="width:54px;height:54px;border-radius:14px;background:var(--accent, #6366f1)1a;color:var(--accent, #6366f1);display:flex;align-items:center;justify-content:center;font-size:26px">📄</div>' +
        '<div><div style="font-weight:700;font-size:17px;word-break:break-all">' + esc(fname) + '</div>' +
        '<div style="color:#64748b;font-size:13px">' + (size ? size + ' · ' : '') + esc(m.mime || '') + '</div></div>' +
      '</div>' +
      '<button id="shareDl" class="btn btn-primary btn-lg btn-block">下载 / 打开文件</button>' +
      '<p style="color:#94a3b8;font-size:12px;text-align:center;margin-top:14px">文件由上传者自有 Cloudflare 存储提供</p>' +
      '<a class="btn btn-ghost btn-block" href="/" style="margin-top:8px">← 返回首页</a>' +
    '</div>';
  const dlBtn = wrap.querySelector('#shareDl');
  if (dlBtn) dlBtn.onclick = () => blobDownload(dlBtn, dlUrl, fname);
}

// 通过 fetch 取回 blob 本地触发下载，避免地址栏暴露 api 子域
async function blobDownload(btn, url, name) {
  const old = btn.textContent; btn.disabled = true; btn.textContent = '正在准备…';
  try {
    const res = await fetch(url, { headers: { 'X-Requested-With': 'fetch' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = obj; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(obj), 60000);
  } catch (e) {
    window.open(url, '_blank', 'noopener');
  } finally { btn.disabled = false; btn.textContent = old; }
}

function showShareCodeBox(wrap, owner, id) {
  wrap.innerHTML =
    '<div class="card" style="padding:28px;color:#1a1d24;background:#fff;border-radius:18px;text-align:center">' +
      '<div style="font-size:40px">🔒</div><h2 style="margin:14px 0 6px">该文件受预览码保护</h2>' +
      '<p style="color:#64748b;margin:0 0 18px">请输入分享者提供的预览码后查看。</p>' +
      '<form id="shareCodeForm" style="text-align:center"><input class="input" name="code" placeholder="预览码" autocomplete="off" style="text-align:center">' +
      '<button class="btn btn-primary btn-block" style="margin-top:12px" type="submit">查看文件</button></form>' +
    '</div>';
  wrap.querySelector('#shareCodeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const c = wrap.querySelector('[name=code]').value.trim();
    if (c) location.href = '/f/' + encodeURIComponent(owner) + '/' + encodeURIComponent(id) + '?code=' + encodeURIComponent(c);
  });
}

function showShareError(wrap, msg) {
  wrap.innerHTML = '<div class="card" style="padding:28px;color:#1a1d24;background:#fff;border-radius:18px;text-align:center">' +
    '<div style="color:#ef4444;padding:20px 0">' + esc(msg) + '</div>' +
    '<a class="btn btn-ghost btn-block" href="/">← 返回首页</a></div>';
}

/* 意见反馈弹窗：
   - 正文为超管在后台编写的 Markdown；
   - 询问用户选择：私信官方账号 / 前往社区意见反馈中心 / 用邮箱发信给超管设置的反馈邮箱。 */
function openFeedbackModal() {
  const cfg = (App.Site && App.Site.cfg && App.Site.cfg.feedback) || {};
  const md = (cfg.markdown || '').trim();
  const email = (cfg.email || '').trim();
  const official = (cfg.officialUsername || '').trim();
  const siteTitle = (App.Site && App.Site.cfg && App.Site.cfg.siteTitle) || 'MarytOpens';
  const T = global.I18N ? I18N.t.bind(I18N) : (k) => k;

  const body = el('div', { class: 'feedback-modal' });
  let html = '';
  if (md) html += '<div class="feedback-md mb-3">' + App.markdown(md) + '</div>';
  else html += '<p class="muted">' + esc(T('feedback.default')) + '</p>';

  html += '<p class="muted">' + esc(T('feedback.choose')) + '</p><div class="feedback-opts">';
  const opts = [];
  if (official) {
    opts.push('<a class="btn btn-block btn-primary" href="/user.html?u=' + encodeURIComponent(official) + '">' + icon('user') + ' ' + esc(T('feedback.officialHome')) + '</a>');
    opts.push('<a class="btn btn-block btn-soft" href="/messages.html?to=' + encodeURIComponent(official) + '">' + icon('message') + ' ' + esc(T('feedback.dmOfficial')) + '</a>');
  }
  opts.push('<a class="btn btn-block btn-ghost" href="/feedback_center.html">' + icon('chat') + ' ' + esc(T('feedback.center')) + '</a>');
  if (email) opts.push('<button type="button" class="btn btn-block btn-ghost" id="fbMailBtn">' + icon('mail') + ' ' + esc(T('feedback.email')) + '</button>');
  html += opts.join('') + '</div>';
  body.innerHTML = html;

  modal({ title: T('feedback.title'), body, footer: false });

  const mailBtn = body.querySelector('#fbMailBtn');
  if (mailBtn) mailBtn.addEventListener('click', () => feedbackSendMail(email, siteTitle));
}

/* 用浏览器/系统已记录的邮箱发信给反馈邮箱（最佳努力：移动端可用 Contact Picker） */
async function feedbackSendMail(email, siteTitle) {
  let fromEmail = '';
  try {
    if (navigator.contacts && navigator.contacts.select) {
      const res = await navigator.contacts.select(['emails'], { multiple: false });
      if (res && res[0] && res[0].emails && res[0].emails[0]) fromEmail = res[0].emails[0];
    }
  } catch (e) { /* 用户拒绝或不可用，忽略 */ }
  if (!fromEmail && App.Session.user && App.Session.user.email) fromEmail = App.Session.user.email;
  const subject = encodeURIComponent('【' + siteTitle + ' 反馈】');
  const bodyText = encodeURIComponent(
    (fromEmail ? '（发送自我的邮箱 ' + fromEmail + '，请直接回复我）\n\n' : '\n\n') +
    '我想反馈：\n'
  );
  window.location.href = 'mailto:' + email + '?subject=' + subject + '&body=' + bodyText;
}

/* ⚠ 主 IIFE 的闭合必须留在这里：上面这批「联系我们 / 分享页 / 反馈弹窗」函数
      依赖 IIFE 内的私有工具（icon / el / esc / modal / toast / global），
      一旦把闭合括号提前，boot() 会抛 `icon is not defined` 导致全站白屏。 */
})(window);

/* ==========================================================================
   主题模块：自定义配色（仅用户端生效，localStorage 记忆）
   ========================================================================== */
(function () {
  const KEY_COLORS = 'mo_colors';
  const root = document.documentElement;

  function hexToRgb(hex) {
    hex = (hex || '').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length !== 6) return null;
    const n = parseInt(hex, 16);
    if (isNaN(n)) return null;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
  }
  function shade(hex, amt) {
    const c = hexToRgb(hex); if (!c) return hex;
    const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
    return rgbToHex(c[0] + (t - c[0]) * p, c[1] + (t - c[1]) * p, c[2] + (t - c[2]) * p);
  }
  function toHex(v, fb) { return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test((v || '').trim()) ? v.trim() : fb; }
  function currentVar(name, fb) { return toHex(getComputedStyle(root).getPropertyValue(name), fb); }

  function applyColors(c) {
    if (!c) return;
    if (c.accent) {
      const rgb = hexToRgb(c.accent);
      root.style.setProperty('--accent', c.accent);
      if (rgb) {
        root.style.setProperty('--accent-rgb', rgb.join(', '));
        root.style.setProperty('--accent-hover', shade(c.accent, -0.12));
        root.style.setProperty('--accent-soft', 'rgba(' + rgb.join(', ') + ', .12)');
        root.style.setProperty('--accent-ring', 'rgba(' + rgb.join(', ') + ', .35)');
      }
    }
    if (c.bg) { root.style.setProperty('--bg', c.bg); root.style.setProperty('--bg-alt', shade(c.bg, 0.06)); }
    if (c.text) root.style.setProperty('--text', c.text);
  }

  function safeParse(s) { try { return JSON.parse(s || 'null'); } catch (e) { return null; } }

  function load() {
    const colors = safeParse(localStorage.getItem(KEY_COLORS));
    if (colors) applyColors(colors);
    return { colors };
  }

  function build() {
    const state = load();
    const fab = document.createElement('button');
    fab.className = 'mo-theme-fab';
    fab.textContent = '◐';
    fab.title = '主题 / 外观';
    fab.setAttribute('aria-label', '主题设置');
    const panel = document.createElement('div');
    panel.className = 'mo-theme-panel';
    panel.hidden = true;
    const dA = currentVar('--accent', '#6366f1');
    const dB = currentVar('--bg', '#0c0f16');
    const dT = currentVar('--text', '#c8f7c5');
    panel.innerHTML =
      '<h4>外观 / 主题</h4>' +
      '<div class="mo-theme-row"><label>主色</label><input type="color" id="moAccent" value="' + dA + '"></div>' +
      '<div class="mo-theme-row"><label>背景色</label><input type="color" id="moBg" value="' + dB + '"></div>' +
      '<div class="mo-theme-row"><label>文字色</label><input type="color" id="moText" value="' + dT + '"></div>' +
      '<div class="mo-theme-actions"><button class="btn btn-ghost" id="moReset" type="button">恢复默认</button></div>';
    document.body.appendChild(fab);
    document.body.appendChild(panel);

    const accent = panel.querySelector('#moAccent');
    const bg = panel.querySelector('#moBg');
    const text = panel.querySelector('#moText');

    fab.addEventListener('click', () => { panel.hidden = !panel.hidden; });

    const COLOR_VARS = ['--accent', '--accent-rgb', '--accent-hover', '--accent-soft', '--accent-ring', '--bg', '--bg-alt', '--text'];
    function clearInlineColors() { COLOR_VARS.forEach((v) => root.style.removeProperty(v)); }

    // 取色器 = 用户显式自定义，才写入内联变量并持久化
    [accent, bg, text].forEach((inp) => inp.addEventListener('input', () => {
      const colors = { accent: accent.value, bg: bg.value, text: text.value };
      applyColors(colors);
      localStorage.setItem(KEY_COLORS, JSON.stringify(colors));
    }));

    panel.querySelector('#moReset').addEventListener('click', () => {
      localStorage.removeItem(KEY_COLORS);
      clearInlineColors();
      accent.value = dA; bg.value = dB; text.value = dT;
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
