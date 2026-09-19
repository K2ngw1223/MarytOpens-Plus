/* ==========================================================================
 * MarytOpens · feed.js
 * 文章卡片 / 列表渲染 / 游标分页 / 点赞收藏交互（home、explore、profile、favorites 共用）
 * 依赖：app.js（App.*）、api.js（API.*）、i18n.js（I18N.*）
 * 全局对象：window.Feed
 * ========================================================================== */
(function (global) {
  'use strict';

  const { esc, icon, avatar, markdown, reactionsHTML, openEmojiPicker } = App;
  const T = (k, v) => (global.I18N ? I18N.t(k, v) : k);

  /* ------------------------- 可见性徽标 ------------------------- */

  const VIS_META = {
    public:   { cls: 'vis-public',   i18n: 'post.vis.public',   icon: 'globe' },
    members:  { cls: 'vis-unlisted', i18n: 'post.vis.unlisted', icon: 'users' },
    private:  { cls: 'vis-private',  i18n: 'post.vis.private',  icon: 'lock' },
    roles:    { cls: 'vis-role',     i18n: 'post.vis.role',     icon: 'shield' },
    draft:    { cls: 'vis-draft',    i18n: 'post.vis.draft',    icon: 'edit' },
  };

  function visibilityChip(p) {
    const key = p.status === 'draft' ? 'draft' : p.visibility;
    const m = VIS_META[key];
    if (!m || key === 'public') return '';
    return '<span class="visibility-chip ' + m.cls + '">' + icon(m.icon) +
      '<span data-i18n="' + m.i18n + '">' + T(m.i18n) + '</span></span>';
  }

  /* --------------------------- 卡片模板 --------------------------- */

  /**
   * 渲染一张文章卡片
   * @param {object} p postCard 结构
   * @param {object} [opts] { compact:bool, showAuthor:bool }
   */
  function cardHTML(p, opts) {
    opts = opts || {};
    const a = p.author || { displayName: '已注销用户', username: 'ghost', avatar: '' };
    const href = '/post.html?id=' + encodeURIComponent(p.id);
    const c = p.counts || {};

    const tags = (p.tags || []).slice(0, 4).map((t) =>
      '<a class="tag" href="/explore.html?q=' + encodeURIComponent(t) + '">#' + esc(t) + '</a>').join('');

    const flags =
      (p.pinned ? '<span class="badge badge-accent">' + icon('pin') + ' 置顶</span>' : '') +
      (p.featured ? '<span class="badge badge-warn">' + icon('star') + ' 精选</span>' : '') +
      (p.locked ? '<span class="badge">' + icon('lock') + '</span>' : '') +
      visibilityChip(p);

    return '<article class="card card-hover post-card" data-post="' + esc(p.id) + '">' +
      '<div class="pc-main">' +
        (flags ? '<div class="chip-row mb-2">' + flags + '</div>' : '') +
        '<h3 class="pc-title"><a href="' + href + '">' + esc(p.title) + '</a></h3>' +
        (opts.compact ? '' : '<p class="pc-excerpt clamp-2">' + esc(p.excerpt || '') + '</p>') +
        '<div class="pc-meta">' +
          (opts.showAuthor === false ? '' :
            '<a class="author" href="/profile.html?u=' + encodeURIComponent(a.username) + '">' +
            avatar(a, 'xs', { official: !!a.official }) + esc(a.displayName) + '</a>' +
            App.identityHTML(a)) +
          '<span data-time="' + p.createdAt + '" data-time-style="ago">' +
            (global.I18N ? I18N.timeAgo(p.createdAt) : '') + '</span>' +
          (p.board ? '<span class="chip">' + esc(p.board) + '</span>' : '') +
          '<span class="spacer"></span>' +
          '<span class="pc-stats">' +
            '<span title="' + T('post.views') + '">' + icon('eye') + (c.views || 0) + '</span>' +
            '<button class="act-btn' + (p.liked ? ' active' : '') + '" data-act="like" title="' + T('post.like') + '">' +
              icon('heart') + '<b>' + (c.likes || 0) + '</b></button>' +
            '<a class="act-btn" href="' + href + '#comments" title="' + T('post.comments') + '">' +
              icon('message') + (c.comments || 0) + '</a>' +
            '<button class="act-btn' + (p.favorited ? ' active' : '') + '" data-act="fav" title="' + T('post.favorite') + '">' +
              icon('star') + '<b>' + (c.favorites || 0) + '</b></button>' +
            '<button class="act-btn" data-act="react" title="添加反应">' + icon('smile') + '</button>' +
          '</span>' +
        '</div>' +
        (reactionsHTML ? reactionsHTML(p.reactions, 'post', p.id) : '') +
        (tags ? '<div class="pc-tags">' + tags + '</div>' : '') +
      '</div>' +
      (p.cover ? '<img class="pc-cover" loading="lazy" src="' + esc(API.fileURL(p.cover)) + '" alt="">' : '') +
    '</article>';
  }

  /** 绑定卡片内的点赞 / 收藏按钮（事件委托，容器级绑定一次即可） */
  function bindActions(container) {
    if (!container || container.__feedBound) return;
    container.__feedBound = true;
    container.addEventListener('click', async (e) => {
      const chip = e.target.closest('.reaction-chip');
      if (chip) {
        e.preventDefault();
        if (!App.Session.isLoggedIn) { App.Session.require(); return; }
        const card = chip.closest('[data-post]');
        const id = card ? card.dataset.post : chip.dataset.tid;
        await App.toggleReaction(chip.dataset.tt, id, chip.dataset.emoji, chip);
        return;
      }
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      e.preventDefault();
      const card = btn.closest('[data-post]');
      if (!card) return;
      if (!App.Session.isLoggedIn) { App.Session.require(); return; }
      const id = card.dataset.post;
      const act = btn.dataset.act;
      if (act === 'react') {
        App.openEmojiPicker((emoji) => App.toggleReaction('post', id, emoji, null));
        return;
      }
      btn.disabled = true;
      try {
        const d = act === 'like' ? await API.Posts.like(id) : await API.Posts.favorite(id);
        const on = act === 'like' ? d.liked : d.favorited;
        const n = act === 'like' ? d.likes : d.favorites;
        btn.classList.toggle('active', !!on);
        const b = btn.querySelector('b');
        if (b) b.textContent = n;
      } catch (err) { App.toastError(err); }
      btn.disabled = false;
    });
  }

  /* --------------------------- 列表控制器 --------------------------- */

  /**
   * 创建一个带游标分页的文章列表
   * @param {object} o
   *   mount      挂载容器（.post-list）
   *   moreMount  “加载更多”按钮容器
   *   params()   返回请求参数对象
   *   fetcher    可选，自定义请求函数 (params)=>Promise<{items,cursor}>
   *   onEmpty()  可选，自定义空状态 HTML
   *   showAuthor 是否显示作者
   */
  function createList(o) {
    const state = { cursor: null, loading: false, done: false, items: [] };

    function renderMore() {
      if (!o.moreMount) return;
      if (state.done || !state.cursor) {
        o.moreMount.innerHTML = state.items.length
          ? '<div class="text-center muted small" style="padding:16px" data-i18n="common.noMore">' + T('common.noMore') + '</div>' : '';
        return;
      }
      o.moreMount.innerHTML = '<button class="btn btn-outline btn-block" id="feedMoreBtn" data-i18n="common.loadMore">' +
        T('common.loadMore') + '</button>';
      o.moreMount.querySelector('#feedMoreBtn').onclick = () => load(false);
    }

    async function load(reset) {
      if (state.loading) return;
      state.loading = true;
      if (reset) {
        state.cursor = null; state.done = false; state.items = [];
        o.mount.innerHTML = App.skeletonList(4);
      }
      try {
        const params = Object.assign({}, o.params ? o.params() : {}, state.cursor ? { cursor: state.cursor } : {});
        const d = o.fetcher ? await o.fetcher(params) : await API.Posts.list(params);
        const items = d.items || [];
        state.items = reset ? items : state.items.concat(items);
        state.cursor = d.cursor || null;
        state.done = !d.cursor;

        if (!state.items.length) {
          o.mount.innerHTML = o.onEmpty ? o.onEmpty()
            : App.emptyState(T('post.empty'), T('post.emptyDesc'), 'file',
              App.Session.isLoggedIn ? '<a class="btn btn-primary" href="/editor.html">' + T('post.write') + '</a>' : '');
        } else {
          o.mount.innerHTML = state.items
            .map((p) => cardHTML(p, { showAuthor: o.showAuthor !== false })).join('');
        }
        bindActions(o.mount);
        if (global.I18N) I18N.apply(o.mount);
      } catch (e) {
        o.mount.innerHTML = App.emptyState(T('common.failed'), e.message, 'alert',
          '<button class="btn btn-outline" id="feedRetry">' + T('common.retry') + '</button>');
        const r = o.mount.querySelector('#feedRetry');
        if (r) r.onclick = () => load(true);
      }
      state.loading = false;
      renderMore();
    }

    /** 滚动到底自动加载 */
    function autoLoad() {
      const io = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && !state.loading && state.cursor) load(false);
      }, { rootMargin: '400px' });
      if (o.moreMount) io.observe(o.moreMount);
      return io;
    }

    return { load, state, autoLoad, renderMore };
  }

  /* --------------------------- 版块卡片 --------------------------- */

  /**
   * 渲染版块卡片（版块是顶层社区单元，频道挂在版块内）
   * @param {object} b 版块对象
   * @param {object} [opts] { joined:bool, footer:string }
   */
  function boardCardHTML(b, opts) {
    opts = opts || {};
    const href = '/channels.html?id=' + encodeURIComponent(b.id);
    const banner = b.banner
      ? ' style="background-image:url(' + esc(API.fileURL(b.banner)) + ')"' : '';
    const iconHtml = b.avatar
      ? '<img src="' + esc(API.fileURL(b.avatar)) + '" class="ch-avatar" alt="">'
      : esc(b.icon || '📁');
    const officialTag = b.officialBadge
      ? '<span class="ch-official-tag" title="官方认证版块">✓ 官方</span>' : '';
    return '<div class="card channel-card' + (b.officialBadge ? ' channel-official' : '') + '" data-bd="' + esc(b.id) + '">' +
      '<div class="ch-banner"' + banner + '><div class="ch-icon">' + iconHtml + '</div></div>' +
      '<div class="ch-body">' +
        '<h4 class="ch-name"><a href="' + href + '">' + esc(b.name) + '</a>' + officialTag + '</h4>' +
        '<p class="ch-desc clamp-2">' + esc(b.description || T('bd.noDesc')) + '</p>' +
        '<div class="ch-meta">' +
          '<span>' + icon('users') + (b.memberCount || 0) + '</span>' +
          '<span>' + icon('layers') + (b.channelCount || 0) + ' ' + T('ch.title') + '</span>' +
          '<span>' + (b.visibility === 'private' ? icon('lock') + T('bd.privateShort') : icon('globe') + T('bd.publicShort')) + '</span>' +
          (b.isOwner ? '<span class="badge badge-accent">' + T('bd.owner') + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="ch-foot">' +
        '<a class="btn btn-soft btn-sm grow" href="' + href + '">' + T('ch.enter') + '</a>' +
        (opts.footer !== undefined ? opts.footer
          : '<button class="btn btn-outline btn-sm grow" data-join="' + esc(b.id) + '">' +
            T(opts.joined ? 'ch.leave' : 'ch.join') + '</button>') +
        (b.canManage ? '<a class="btn btn-ghost btn-sm" href="/channel_manage.html?id=' +
          encodeURIComponent(b.id) + '" title="' + T('bd.manage') + '">' + icon('settings') + '</a>' : '') +
      '</div></div>';
  }

  global.Feed = { cardHTML, bindActions, createList, visibilityChip, VIS_META, boardCardHTML };
})(window);
