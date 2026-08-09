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
         .replace(/^\s*([-*_])\s*\1\s*\1[\s\S]*?$/gm, '<hr>')
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

  const Site = {
    cfg: null,
    async load(force) {
      const m = await API.meta(force);
      this.cfg = m.site || {};
      this.meta = m;
      Turnstile.siteKey = m.turnstileSiteKey || '';
      if (this.cfg.accent) applyAccent(this.cfg.accent);
      if (this.cfg.siteTitle) {
        const base = document.title.includes('·') ? document.title.split('·')[0].trim() : document.title;
        document.title = base && base !== this.cfg.siteTitle ? base + ' · ' + this.cfg.siteTitle : this.cfg.siteTitle;
      }
      if (this.cfg.favicon) {
        let link = $('link[rel="icon"]');
        if (!link) { link = el('link', { rel: 'icon' }); document.head.appendChild(link); }
        link.href = API.fileURL(this.cfg.favicon);
      }
      return this.cfg;
    },
  };

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

  function colorOf(seed) {
    let h = 0; const s = String(seed || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  /** 头像：有图用图，无图用首字母色块 */
  function avatar(user, size, opts) {
    opts = opts || {};
    const cls = 'avatar ' + (size ? 'avatar-' + size : '') + (opts.class ? ' ' + opts.class : '');
    const name = (user && (user.displayName || user.username)) || '?';
    const src = user && user.avatar ? API.fileURL(user.avatar) : '';
    if (src) {
      return '<img class="' + cls + '" src="' + esc(src) + '" alt="' + esc(name) + '" loading="lazy" ' +
        'onerror="this.outerHTML=App.avatarFallback(' + JSON.stringify(esc(name)).replace(/"/g, '&quot;') + ',\'' + esc(cls) + '\')">';
    }
    return avatarFallback(name, cls);
  }

  function avatarFallback(name, cls) {
    const ch = String(name || '?').trim().charAt(0).toUpperCase();
    return '<span class="' + (cls || 'avatar') + '" style="background:' + colorOf(name) + '">' + esc(ch) + '</span>';
  }

  function roleTagsHTML(tags) {
    if (!tags || !tags.length) return '';
    return tags.slice(0, 3).map((r) =>
      '<span class="role-tag" style="color:' + esc(r.color || '#64748b') + '">' + esc(r.name) + '</span>').join('');
  }

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
        await API.Auth.sendCode(email, purpose || 'register');
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

  const ACCEPT_IMG = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  const MAX_IMG = 5 * 1024 * 1024;

  function validateImage(file) {
    if (!file) return '请选择文件';
    if (!ACCEPT_IMG.includes(file.type)) return '仅支持 PNG / JPEG / WebP / GIF 格式';
    if (file.size > MAX_IMG) return '图片不能超过 5MB';
    return null;
  }

  /** 头像裁剪弹窗：正方形裁剪 + 缩放拖拽 + 输出 WebP */
  function cropAvatar(file, onDone) {
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
          const d = await API.upload('avatar', f);
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

  /* ============================ 13. 导航栏渲染 =========================== */

  const NAV_ITEMS = [
    { key: 'home',     href: '/home.html',          i18n: 'nav.home',     icon: 'home' },
    { key: 'explore',  href: '/explore.html',       i18n: 'nav.explore',  icon: 'compass' },
    { key: 'search',   href: '/search.html',        i18n: 'search.title', icon: 'search' },
    { key: 'channels', href: '/channels.html',      i18n: 'nav.channels', icon: 'hash' },
    { key: 'files',    href: '/files.html',         i18n: 'nav.files',    icon: 'cloud' },
    { key: 'about',    href: '/about.html',         i18n: 'nav.about',    icon: 'info' },
  ];

  /** 渲染顶部导航到 #navbar；current 用于高亮 */
  function renderNavbar(current) {
    const mount = $('#navbar');
    if (!mount) return;
    const T = global.I18N ? I18N.t.bind(I18N) : (k) => k;
    const cfg = (Site.cfg || {});
    const u = Session.user;

    const custom = (cfg.navLinks || []).filter((l) => l.position === 'nav' || !l.position);
    const links = NAV_ITEMS.map((n) =>
      '<a class="nav-link' + (current === n.key ? ' active' : '') + '" href="' + n.href + '">' +
      icon(n.icon) + '<span data-i18n="' + n.i18n + '">' + T(n.i18n) + '</span></a>').join('') +
      custom.map((l) =>
      '<a class="nav-link" href="' + esc(l.url) + '"' + (l.target === '_blank' ? ' target="_blank" rel="noopener"' : '') + '>' +
      (l.icon ? icon(l.icon) : '') + '<span>' + esc(l.label) + '</span></a>').join('');

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
        '<div class="nav-search">' + icon('search') +
          '<input class="input" id="navSearch" type="search" placeholder="' + T('nav.search') + '" data-i18n-ph="nav.search" aria-label="search">' +
        '</div>' +
        '<div class="nav-actions">' +
          userActions +
          '<div class="dropdown" id="ddTheme">' +
            '<button class="icon-btn" aria-label="theme">' + icon(Theme.effective === 'dark' ? 'moon' : 'sun') + '</button>' +
            '<div class="dropdown-menu">' +
              '<div class="dropdown-head" data-i18n="settings.theme">' + T('settings.theme') + '</div>' +
              '<button class="dropdown-item" data-theme-set="auto">' + icon('monitor') + '<span data-i18n="settings.theme.auto">' + T('settings.theme.auto') + '</span></button>' +
              '<button class="dropdown-item" data-theme-set="light">' + icon('sun') + '<span data-i18n="settings.theme.light">' + T('settings.theme.light') + '</span></button>' +
              '<button class="dropdown-item" data-theme-set="dark">' + icon('moon') + '<span data-i18n="settings.theme.dark">' + T('settings.theme.dark') + '</span></button>' +
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
    return '<div class="dropdown" id="ddUser">' +
      '<button class="icon-btn" style="width:auto;padding:0 4px" aria-label="account">' + avatar(u, 'sm') + '</button>' +
      '<div class="dropdown-menu">' +
        '<div class="dropdown-user">' + avatar(u, 'lg') +
          '<div style="min-width:0"><div class="bold truncate">' + esc(u.displayName || u.username) + '</div>' +
          '<div class="xsmall muted truncate">@' + esc(u.username) + '</div>' +
          '<div class="mt-2">' + roleTagsHTML(Session.roleTags) + '</div></div>' +
        '</div>' +
        '<a class="dropdown-item" href="/profile.html?u=' + encodeURIComponent(u.username) + '">' + icon('user') + '<span data-i18n="nav.profile">' + T('nav.profile') + '</span></a>' +
        '<a class="dropdown-item" href="/profile.html?u=' + encodeURIComponent(u.username) + '&tab=posts">' + icon('file') + '<span data-i18n="nav.myposts">' + T('nav.myposts') + '</span></a>' +
        '<a class="dropdown-item" href="/favorites.html">' + icon('star') + '<span data-i18n="nav.favorites">' + T('nav.favorites') + '</span></a>' +
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

    $$('[data-locale-set]').forEach((b) => b.addEventListener('click', () => {
      I18N.setLocale(b.dataset.localeSet);
      setTimeout(() => renderNavbar(current), 30);
    }));

    const lo = $('#btnLogout');
    if (lo) lo.addEventListener('click', async () => {
      if (await confirmDialog(I18N.t('nav.logout') + '?', { danger: true })) Session.logout();
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
    const mount = $('#footer');
    if (!mount) return;
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
        '<div class="footer-bottom">' +
          '<div class="footer-legal">' + esc(cfg.footerText || FOOTER_LEGAL) + '</div>' +
          '<div class="footer-social">' +
            (cfg.links && cfg.links.github
              ? '<a class="icon-btn" href="' + esc(App.safeURL(cfg.links.github)) + '" target="_blank" rel="noopener" aria-label="GitHub">' + icon('github') + '</a>'
              : '<a class="icon-btn" href="https://github.com" target="_blank" rel="noopener" aria-label="GitHub">' + icon('github') + '</a>') +
            (cfg.links && cfg.links.discord
              ? '<a class="icon-btn" href="' + esc(App.safeURL(cfg.links.discord)) + '" target="_blank" rel="noopener" aria-label="Discord">' + icon('discord') + '</a>'
              : '<a class="icon-btn" href="https://discord.com" target="_blank" rel="noopener" aria-label="Discord">' + icon('discord') + '</a>') +
            (cfg.links && cfg.links.telegram
              ? (cfg.links.telegramAvatar
                  ? '<a class="icon-btn" href="' + esc(App.safeURL(cfg.links.telegram)) + '" target="_blank" rel="noopener" aria-label="Telegram"><img src="' + esc(cfg.links.telegramAvatar) + '" style="width:18px;height:18px;border-radius:50%;object-fit:cover" alt="Telegram"></a>'
                  : '<a class="icon-btn" href="' + esc(App.safeURL(cfg.links.telegram)) + '" target="_blank" rel="noopener" aria-label="Telegram">' + icon('telegram') + '</a>')
              : '') +
            (cfg.links && cfg.links.download
              ? '<a class="icon-btn" href="' + esc(App.safeURL(cfg.links.download)) + '" target="_blank" rel="noopener" aria-label="Download" title="' + T('nav.download') + '">' + icon('download') + '</a>'
              : '') +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* ============================ 16. 页面引导 ============================= */

  /**
   * 每个页面统一入口：
   *   App.boot({ nav:'home', requireAuth:true, onReady(){} })
   */
  async function boot(opts) {
    opts = opts || {};
    Theme.init();
    API.onUnauthorized = () => {
      if (opts.requireAuth) location.href = '/login.html?redirect=' + encodeURIComponent(location.pathname + location.search);
    };

    try { await Site.load(); } catch (e) { /* 站点配置失败不阻塞 */ }
    Theme.init(Site.cfg && Site.cfg.themeDefault);
    await Session.load();

    if (opts.requireAuth && !Session.isLoggedIn) {
      location.href = '/login.html?redirect=' + encodeURIComponent(location.pathname + location.search);
      return;
    }
    if (opts.requirePerm && !Session.can(opts.requirePerm)) {
      document.body.innerHTML = '<div class="container" style="padding:80px 20px">' +
        emptyState(I18N.t('common.forbidden'), '需要权限：' + opts.requirePerm, 'lock',
          '<a class="btn btn-primary" href="/home.html">' + I18N.t('nav.home') + '</a>') + '</div>';
      return;
    }

    renderNavbar(opts.nav);
    renderTabbar(opts.nav);
    renderFooter();

    // 公告条
    if (Site.cfg && Site.cfg.announcement && !sessionStorage.getItem('mo_ann_hide')) {
      const bar = el('div', { class: 'announcement-bar' });
      bar.innerHTML = esc(Site.cfg.announcement) +
        ' <button class="icon-btn" style="width:20px;height:20px;color:#fff;vertical-align:middle" aria-label="close">' + icon('x') + '</button>';
      bar.querySelector('button').onclick = () => { sessionStorage.setItem('mo_ann_hide', '1'); bar.remove(); };
      document.body.insertBefore(bar, document.body.firstChild);
    }

    if (global.I18N) I18N.apply();
    document.addEventListener('i18n:change', () => { renderNavbar(opts.nav); renderTabbar(opts.nav); renderFooter(); });

    if (opts.onReady) await opts.onReady();
    document.body.classList.add('booted');
  }

  /* ============================ 17. 导出 ================================= */

  Object.assign(App, {
    $, $$, el, esc, icon, iconEl, ICONS, debounce, throttle, copy,
    Theme, toast, toastError, modal, confirmDialog, promptDialog,
    markdown, excerptOf, safeURL, Turnstile,
    Session, Site, applyAccent, colorOf,
    avatar, avatarFallback, roleTagsHTML, emptyState, skeletonList, loadingBlock, pager,
    serializeForm, busy, passwordStrength, bindCodeButton,
    validateImage, cropAvatar, uploadZone, reportDialog,
    renderNavbar, renderTabbar, renderFooter, toggleSidebar, boot,
    FOOTER_LEGAL, NAV_ITEMS,
  });

  global.App = App;
})(window);
