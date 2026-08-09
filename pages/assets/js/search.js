/* ==========================================================================
 * MarytOpens · search.js
 * 全局搜索：用户 / 文件 / 帖子 / 文章 / 官方公告（可筛选）
 * 依赖：App($, el, icon, esc, debounce, avatar, toast), API, I18N
 * ========================================================================== */
(function () {
  'use strict';
  const { $, el, icon, esc, debounce, avatar } = App;
  const T = (k, v) => (global.I18N ? I18N.t(k, v) : k);

  const TYPES = [
    { key: 'all',           i18n: 'search.all' },
    { key: 'user',          i18n: 'search.users' },
    { key: 'file',          i18n: 'search.files' },
    { key: 'post',          i18n: 'search.posts' },
    { key: 'article',       i18n: 'search.articles' },
    { key: 'announcement',  i18n: 'search.announcements' },
  ];

  let curType = 'all';
  let loading = false;

  function fmtSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }

  function userCard(u) {
    const av = avatar ? avatar(u, 44) : (u.avatar ? `<img src="${esc(u.avatar)}" class="avatar" style="width:44px;height:44px">` : '<div class="avatar" style="width:44px;height:44px"></div>');
    const initial = esc((u.displayName || u.username || '?').slice(0, 1));
    const avHtml = u.avatar
      ? `<img src="${esc(u.avatar)}" class="avatar" style="width:44px;height:44px" alt="">`
      : `<div class="avatar" style="width:44px;height:44px;display:flex;align-items:center;justify-content:center;font-weight:700">${initial}</div>`;
    return `<a class="search-row" href="/user.html?u=${encodeURIComponent(u.username)}">
      ${avHtml}
      <div class="sr-body">
        <div class="sr-title">${esc(u.displayName || u.username)}</div>
        <div class="sr-sub muted">@${esc(u.username)}</div>
      </div>
      <span class="tag">${T('search.user')}</span>
    </a>`;
  }

  function fileCard(f) {
    const lock = f.protected ? icon('lock') : '';
    return `<a class="search-row" href="${esc(f.shareUrl || ('/f/' + f.owner + '/' + f.id))}">
      <div class="avatar" style="width:44px;height:44px;display:flex;align-items:center;justify-content:center">${icon('file')}</div>
      <div class="sr-body">
        <div class="sr-title">${esc(f.name || 'file')} ${lock}</div>
        <div class="sr-sub muted">${fmtSize(f.size)}</div>
      </div>
      <span class="tag">${T('search.file')}</span>
    </a>`;
  }

  function postCard(p) {
    const ex = esc((p.excerpt || '').slice(0, 140));
    return `<a class="search-row" href="/post.html?id=${encodeURIComponent(p.id)}">
      <div class="avatar" style="width:44px;height:44px;display:flex;align-items:center;justify-content:center">${icon('edit')}</div>
      <div class="sr-body">
        <div class="sr-title">${esc(p.title || 'Untitled')}</div>
        <div class="sr-sub muted">${ex}${ex.length >= 140 ? '…' : ''}</div>
      </div>
      <span class="tag">${T(p.kind === 'article' ? 'search.article' : 'search.post')}</span>
    </a>`;
  }

  function announcementCard(a) {
    const body = esc((a.body || '').slice(0, 140));
    return `<div class="search-row">
      <div class="avatar" style="width:44px;height:44px;display:flex;align-items:center;justify-content:center">${icon('info')}</div>
      <div class="sr-body">
        <div class="sr-title">${esc(a.title || 'Announcement')}</div>
        <div class="sr-sub muted">${body}${body.length >= 140 ? '…' : ''}</div>
      </div>
      <span class="tag">${T('search.announcement')}</span>
    </div>`;
  }

  function renderItem(it) {
    switch (it.kind) {
      case 'user': return userCard(it.user);
      case 'file': return fileCard(it.file);
      case 'post': return postCard(it.post);
      case 'article': return postCard(it.post);
      case 'announcement': return announcementCard(it.announcement);
      default: return '';
    }
  }

  async function runSearch() {
    const q = ($('#searchInput').value || '').trim();
    const box = $('#searchResults');
    if (!q) { box.innerHTML = `<div class="empty-state">${icon('search')}<p>${T('search.tip')}</p></div>`; return; }
    if (loading) return;
    loading = true;
    box.innerHTML = `<div class="loading-block"><span class="spinner"></span> ${T('common.loading')}</div>`;
    try {
      const data = await API.get('/api/search?q=' + encodeURIComponent(q) + '&type=' + curType + '&limit=20');
      const items = (data && data.items) || [];
      if (!items.length) {
        box.innerHTML = `<div class="empty-state">${icon('search')}<p>${T('search.noResult')}</p></div>`;
      } else {
        box.innerHTML = items.map(renderItem).join('');
        I18N.apply(box);
      }
    } catch (e) {
      box.innerHTML = `<div class="empty-state">${icon('alert')}<p>${T('common.networkError')}</p></div>`;
    } finally {
      loading = false;
    }
  }

  function renderChips() {
    const wrap = $('#searchChips');
    wrap.innerHTML = TYPES.map((t) =>
      `<button class="chip${t.key === curType ? ' active' : ''}" data-type="${t.key}">${T(t.i18n)}</button>`).join('');
    wrap.querySelectorAll('.chip').forEach((b) => {
      b.onclick = () => {
        curType = b.getAttribute('data-type');
        wrap.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === b));
        runSearch();
      };
    });
  }

  function init() {
    const input = $('#searchInput');
    if (!input) return;
    renderChips();
    input.addEventListener('input', debounce(runSearch, 280));

    const params = new URLSearchParams(location.search);
    const q0 = params.get('q') || '';
    const t0 = params.get('type') || 'all';
    if (TYPES.some((t) => t.key === t0)) curType = t0;
    if (q0) { input.value = q0; }
    I18N.apply();
    if (q0) runSearch();
  }

  global.SearchUI = { init };
})();
