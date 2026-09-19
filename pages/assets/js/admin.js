/* ==========================================================================
 * MarytOpens · admin.js
 * 超级管理员总后台：总览 / 用户 / 内容 / 频道 / 权限组 / 举报 /
 *                  站点设置 / 导航 / IP 封禁 / 日志 / 邮件 / 机器人 / Cloudflare
 * 依赖：i18n.js、api.js、app.js
 * ========================================================================== */
(function (global) {
  'use strict';

  const { $, $$, el, esc, icon, toast, toastError, modal, confirmDialog, promptDialog, busy } = App;

  const T = (k, fallback) => {
    const v = global.I18N ? I18N.t(k) : k;
    return (v === k && fallback) ? fallback : v;
  };
  const fmt = (ts, style) => (ts
    ? (global.I18N ? I18N.formatDate(ts, style || 'full') : new Date(ts).toLocaleString())
    : '—');
  const num = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString());

  /* ============================ 全局状态 ================================= */

  const state = {
    loaded: {},
    users: { items: [], cursor: null, q: '' },
    posts: { items: [], cursor: null, q: '' },
    logs: { items: [], cursor: null },
    roles: { scope: 'global', data: null, active: null },
    cfg: null,
    navLinks: [],
    projects: [],
    socials: [],
    officialExists: false,
    discordAvatar: '',
  };

  /* ============================ 通用片段 ================================= */

  function kvRows(pairs) {
    return pairs.map((p) =>
      '<div class="kv-row"><div class="kv-k">' + esc(p[0]) + '</div>' +
      '<div class="kv-v' + (p[2] ? ' mono' : '') + '">' + (p[3] ? p[1] : esc(p[1])) + '</div></div>'
    ).join('');
  }

  function statCard(label, value, delta) {
    return '<div class="card card-pad stat-card">' +
      '<div class="sc-label">' + esc(label) + '</div>' +
      '<div class="sc-value">' + esc(num(value)) + '</div>' +
      (delta ? '<div class="sc-delta">' + esc(delta) + '</div>' : '') + '</div>';
  }

  function tableMessage(tbody, cols, html) {
    tbody.innerHTML = '<tr><td colspan="' + cols + '" style="padding:28px 0">' + html + '</td></tr>';
  }

  function skeletonRows(tbody, cols, rows) {
    let s = '';
    for (let i = 0; i < (rows || 5); i++) {
      s += '<tr>';
      for (let c = 0; c < cols; c++) s += '<td><div class="skeleton" style="height:14px;border-radius:5px"></div></td>';
      s += '</tr>';
    }
    tbody.innerHTML = s;
  }

  /** 危险操作确认（带二次输入） */
  async function confirmTyped(message, keyword) {
    const v = await promptDialog('请输入 “' + keyword + '” 以确认', {
      title: T('common.confirm', '确认'), hint: message, danger: true, required: true,
    });
    if (v === null) return false;
    if (v !== keyword) { toast.warn('输入不匹配，已取消'); return false; }
    return true;
  }

  /* ========================================================================
   * 1. 面板路由与权限门禁
   * ==================================================================== */

  const LOADERS = {
    overview: loadOverview,
    users: () => loadUsers(true),
    posts: () => loadPosts(true),
    channels: loadChannels,
    roles: () => loadRoles(true),
    reports: loadReports,
    site: () => { loadSiteConfig(); loadPushStats(); },
    nav: loadNav,
    ipbans: loadIpBans,
    logs: () => loadLogs(true),
    audit: loadAudit,
    mail: () => {},
    bots: loadBots,
    cloudflare: loadCloudflare,
    official: loadOfficial,
    bans: loadBansPanel,
  };

  /** 依据当前用户权限裁剪侧栏，返回第一个可用面板名 */
  function gatePanes() {
    let first = '';
    $$('#adminSide .side-item[data-pane]').forEach((b) => {
      const perm = b.dataset.perm;
      if (perm && !App.Session.can(perm)) {
        b.remove();
        const sec = $('#pane-' + b.dataset.pane);
        if (sec) sec.remove();
        return;
      }
      if (b.dataset.super === '1' && !App.Session.isSuperAdmin) {
        b.remove();
        const sec = $('#pane-' + b.dataset.pane);
        if (sec) sec.remove();
        return;
      }
      if (!first) first = b.dataset.pane;
    });
    $$('#adminSide .side-group').forEach((g) => { if (!g.querySelector('.side-item')) g.remove(); });
    return first;
  }

  function showPane(name) {
    const btn = $('#adminSide .side-item[data-pane="' + name + '"]');
    if (!btn) return false;
    $$('#adminSide .side-item[data-pane]').forEach((b) => b.classList.toggle('active', b === btn));
    $$('.admin-main .tab-panel').forEach((s) => s.classList.toggle('active', s.id === 'pane-' + name));
    try { history.replaceState(null, '', location.pathname + '?tab=' + name); } catch (e) { /* ignore */ }
    if (!state.loaded[name] && LOADERS[name]) {
      state.loaded[name] = true;
      Promise.resolve().then(LOADERS[name]).catch((e) => { state.loaded[name] = false; toastError(e); });
    }
    if (global.innerWidth <= 900) global.scrollTo({ top: 0, behavior: 'smooth' });
    return true;
  }

  function bindPanes(firstPane) {
    $$('#adminSide .side-item[data-pane]').forEach((b) => {
      b.addEventListener('click', () => showPane(b.dataset.pane));
    });
    const want = new URLSearchParams(location.search).get('tab');
    if (!showPane(want || firstPane)) showPane(firstPane);
  }

  /* ========================================================================
   * 2. 总览
   * ==================================================================== */

  async function loadOverview() {
    const mount = $('#ovStats');
    mount.innerHTML = '<div class="skeleton" style="height:92px"></div>'.repeat(4);
    const d = await API.Admin.overview();
    const t = d.totals || {};

    mount.innerHTML =
      statCard(T('admin.totalUsers', '注册用户'), t.users) +
      statCard(T('admin.totalPosts', '文章总数'), t.posts) +
      statCard(T('admin.totalComments', '评论总数'), t.comments) +
      statCard(T('admin.pendingReports', '待处理举报'), t.openReports, '累计 ' + num(t.reports)) +
      statCard(T('board.title', '版块'), t.boards) +
      statCard(T('ch.title', '频道'), t.channels) +
      statCard(T('group.title', '群组'), t.groups);

    const pv = d.pv7d || [];
    $('#ovPvTotal').textContent = '合计 ' + num(pv.reduce((a, b) => a + (b.pv || 0), 0)) + ' PV';
    renderBarChart($('#ovChart'), pv);

    $('#ovRuntime').innerHTML = kvRows([
      ['Worker 版本', d.version || '—', true],
      ['边缘节点 (colo)', (d.runtime && d.runtime.colo) || '未知', true],
      ['服务器时间', fmt(d.runtime && d.runtime.time)],
      ['API 基址', API.BASE, true],
      ['当前登录', (App.Session.user && App.Session.user.username) || '—'],
      ['超级管理员', App.Session.isSuperAdmin ? '是' : '否'],
    ]);
  }

  function renderBarChart(mount, data) {
    if (!data.length) { mount.innerHTML = '<p class="muted small mb-0">暂无数据</p>'; return; }
    const max = Math.max(1, ...data.map((d) => d.pv || 0));
    mount.innerHTML = '<div style="display:flex;align-items:flex-end;gap:10px;height:180px">' +
      data.map((d) => {
        const h = Math.max(2, Math.round((d.pv || 0) / max * 100));
        return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%">' +
          '<span class="small muted mono">' + esc(num(d.pv)) + '</span>' +
          '<div style="flex:1;display:flex;align-items:flex-end;width:100%">' +
            '<div title="' + esc(d.date + ' · ' + d.pv + ' PV') + '" style="width:100%;height:' + h + '%;' +
              'border-radius:6px 6px 0 0;background:linear-gradient(180deg,var(--accent),var(--accent-soft))"></div>' +
          '</div>' +
          '<span class="small muted mono">' + esc(String(d.date).slice(5)) + '</span>' +
        '</div>';
      }).join('') + '</div>';
  }

  /* ========================================================================
   * 3. 用户管理
   * ==================================================================== */

  async function loadUsers(reset) {
    const tb = $('#usRows');
    // 防重入：并发调用（如面板进入与搜索防抖同时触发）会导致同一批数据被 concat 两次
    if (state.users.loading) return;
    state.users.loading = true;
    try {
      if (reset) { state.users.items = []; state.users.cursor = null; skeletonRows(tb, 6); }
      const d = await API.Admin.users({ q: state.users.q, limit: 50, cursor: state.users.cursor });
      // 按 id 去重：无论后端游标是否异常，同一账号绝不重复出现
      const seen = new Set(state.users.items.map((x) => x.id));
      state.users.items = state.users.items.concat((d.items || []).filter((x) => x && !seen.has(x.id)));
      state.users.cursor = d.cursor || null;
      renderUsers();
    } finally { state.users.loading = false; }
  }

  function userStatusBadges(u) {
    const f = u.flags || {};
    const out = [];
    if (f.banned) out.push('<span class="badge badge-danger">已封禁</span>');
    if (f.mutedUntil && f.mutedUntil > Date.now()) out.push('<span class="badge badge-warn">禁言中</span>');
    if (f.forceVerify) out.push('<span class="badge badge-warn">待验证</span>');
    if (!u.emailVerified) out.push('<span class="badge">未验证</span>');
    if (!out.length) out.push('<span class="badge badge-ok">正常</span>');
    return out.join(' ');
  }

  // 用户多选（用于批量「要求验证邮箱」）
  const _selUsers = new Set();
  function syncBulkBar() {
    const bar = $('#usBulkBar'); if (!bar) return;
    bar.hidden = _selUsers.size === 0;
    const c = $('#usBulkCount'); if (c) c.textContent = '已选 ' + _selUsers.size + ' 项';
    const all = $('#usCheckAll');
    if (all) all.checked = state.users.items.length > 0 && state.users.items.every((u) => _selUsers.has(u.id));
  }

  function renderUsers() {
    const tb = $('#usRows');
    const list = state.users.items;
    if (!list.length) {
      tableMessage(tb, 6, App.emptyState('没有匹配的用户', '换个关键词试试', 'users'));
      $('#btnMoreUsers').hidden = true;
      return;
    }
    tb.innerHTML = list.map((u) =>
      '<tr data-uid="' + esc(u.id) + '">' +
        '<td class="col-chk"><input type="checkbox" class="usChk" data-uid="' + esc(u.id) + '"' + (_selUsers.has(u.id) ? ' checked' : '') + '></td>' +
        '<td><div class="row" style="gap:10px;align-items:center">' +
          App.avatar(u, 'sm') +
          '<div style="min-width:0">' +
            '<div style="font-weight:620">' + esc(u.displayName || u.username) + '</div>' +
            App.identityHTML(u) +
            '<div class="small muted mono">@' + esc(u.username) + '</div>' +
          '</div></div></td>' +
        '<td><span class="mono small">' + esc(u.email || '—') + '</span></td>' +
        '<td>' + (App.roleTagsHTML(u.roleTags) || '<span class="muted small">—</span>') + '</td>' +
        '<td><span class="small muted">' + esc(fmt(u.createdAt, 'date')) + '</span></td>' +
        '<td>' + userStatusBadges(u) + '</td>' +
        '<td class="td-actions">' +
          '<button class="btn btn-sm btn-soft" data-act="manage">管理</button>' +
          '<a class="btn btn-sm btn-ghost" href="/profile.html?id=' + encodeURIComponent(u.id) + '" target="_blank">主页</a>' +
        '</td>' +
      '</tr>').join('');

    tb.querySelectorAll('[data-act="manage"]').forEach((b) => {
      b.onclick = () => {
        const id = b.closest('tr').dataset.uid;
        userDialog(list.find((x) => x.id === id));
      };
    });
    tb.querySelectorAll('.usChk').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) _selUsers.add(cb.dataset.uid); else _selUsers.delete(cb.dataset.uid);
        syncBulkBar();
      });
    });

    const more = $('#btnMoreUsers');
    more.hidden = !state.users.cursor;
    more.onclick = async () => {
      busy(more, true);
      try { await loadUsers(false); } catch (e) { toastError(e); } finally { busy(more, false); }
    };
  }

  function userDialog(u) {
    if (!u) return;
    const banned = !!(u.flags && u.flags.banned);
    const muted = !!(u.flags && u.flags.mutedUntil && u.flags.mutedUntil > Date.now());
    const body = el('div');

    body.innerHTML =
      '<div class="row mb-4" style="gap:12px;align-items:center">' +
        App.avatar(u, 'lg') +
        '<div><div style="font-weight:680;font-size:16px">' + esc(u.displayName || u.username) + '</div>' +
        '<div class="small muted mono">@' + esc(u.username) + ' · ' + esc(u.id) + '</div></div>' +
      '</div>' +
      '<div class="kv-list mb-4">' + kvRows([
        ['邮箱', u.email || '—', true],
        ['注册时间', fmt(u.createdAt)],
        ['最近登录', fmt(u.lastLoginAt)],
        ['最近 IP', u.lastIP || '—', true],
        ['状态', userStatusBadges(u), false, true],
      ]) + '</div>' +
      '<div class="field"><label class="label">作用域</label>' +
        '<input class="input input-sm mono" id="uaScope" value="global" placeholder="global / board:BID / channel:BID:CID">' +
        '<div class="hint">禁言、改名、身份组等操作可限定在某个频道或群组内生效</div></div>' +
      '<div class="field"><label class="label">操作原因（可选，会记录并通知）</label>' +
        '<input class="input input-sm" id="uaReason" maxlength="200"></div>' +
      '<div class="chip-row" id="uaActions">' +
        (App.Session.can('user.ban')
          ? (banned ? '<button class="btn btn-sm btn-soft" data-a="unban">解除封禁</button>'
                    : '<button class="btn btn-sm btn-danger" data-a="ban">封禁账号</button>')
          : '') +
        (App.Session.can('user.mute')
          ? (muted ? '<button class="btn btn-sm btn-soft" data-a="unmute">解除禁言</button>'
                   : '<button class="btn btn-sm btn-outline" data-a="mute">禁言</button>')
          : '') +
        (App.Session.can('user.rename') ? '<button class="btn btn-sm btn-outline" data-a="rename">强制改名</button>' : '') +
        (App.Session.can('user.role') ? '<button class="btn btn-sm btn-outline" data-a="roles">分配身份组</button>' : '') +
        (App.Session.can('user.ban') ? '<button class="btn btn-sm btn-ghost" data-a="forceLogout">强制下线</button>' : '') +
        (App.Session.isSuperAdmin && !u.emailVerified
          ? '<button class="btn btn-sm btn-ghost" data-a="verifyEmail">标记邮箱已验证</button>' : '') +
        (App.Session.isSuperAdmin && !u.emailVerified
          ? '<button class="btn btn-sm btn-warn" data-a="forceVerify">要求验证邮箱</button>' : '') +
        (App.Session.can('ip.ban') && u.lastIP ? '<button class="btn btn-sm btn-ghost" data-a="banip">封禁其 IP</button>' : '') +
      '</div>';

    const m = modal({ title: '用户操作 · ' + (u.displayName || u.username), body, size: 'lg', footer: false });

    body.querySelectorAll('#uaActions [data-a]').forEach((btn) => {
      btn.onclick = async () => {
        const a = btn.dataset.a;
        const scope = ($('#uaScope', body).value || 'global').trim();
        const reason = $('#uaReason', body).value.trim();
        try {
          if (a === 'banip') {
            await API.Admin.banIP({ ip: u.lastIP, reason: reason || '关联账号违规' });
            toast.success('已封禁 IP ' + u.lastIP);
            state.loaded.ipbans = false;
            m.close(); return;
          }
          if (a === 'roles') { m.close(); assignRolesDialog(u, scope); return; }

          let extra = {};
          if (a === 'ban') {
            if (!(await confirmDialog('确认封禁 ' + (u.displayName || u.username) + '？该用户将立即失效所有登录态。', { danger: true }))) return;
            const days = await promptDialog('封禁天数（留空为永久）', { title: '封禁时长', placeholder: '例如 7' });
            extra.days = days ? Number(days) : 0;
          }
          if (a === 'mute') {
            const mins = await promptDialog('禁言分钟数', { title: '禁言时长', value: '60', required: true });
            if (mins === null) return;
            extra.minutes = Number(mins) || 60;
          }
          if (a === 'rename') {
            const nn = await promptDialog('新的昵称', { title: '强制改名', value: u.displayName || '', required: true, maxlength: 40 });
            if (nn === null) return;
            extra.displayName = nn;
          }
          busy(btn, true);
          const d = await API.Admin.userAction(u.id, { action: a, scope, reason, ...extra });
          const okMsg = { forceVerify: '已要求该用户验证邮箱', verifyEmail: '已标记为邮箱已验证', ban: '已封禁', unban: '已解除封禁', mute: '已禁言', unmute: '已解除禁言', rename: '已改名', forceLogout: '已强制下线' }[a] || ('操作成功：' + a);
          toast.success(okMsg);
          // 局部刷新列表数据
          const idx = state.users.items.findIndex((x) => x.id === u.id);
          if (idx >= 0 && d.user) state.users.items[idx] = { ...state.users.items[idx], ...d.user };
          renderUsers();
          m.close();
        } catch (e) { toastError(e); } finally { busy(btn, false); }
      };
    });
  }

  async function assignRolesDialog(u, scope) {
    let data;
    try { data = await API.Roles.list(scope || 'global'); } catch (e) { toastError(e); return; }
    const roles = (data.roles || []).slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
    const owned = (u.rolesRaw && u.rolesRaw[scope === 'global' ? 'global' : scope]) || [];
    const body = el('div');
    body.innerHTML =
      '<p class="small muted">作用域：<code class="mono">' + esc(scope) + '</code></p>' +
      '<div class="perm-grid" id="arList">' +
        roles.map((r) => {
          const on = owned.includes(r.id);
          return '<label class="perm-item' + (on ? ' checked' : '') + '" data-rid="' + esc(r.id) + '">' +
            '<input type="checkbox" class="check"' + (on ? ' checked' : '') + '>' +
            '<span><span class="pi-label" style="color:' + esc(r.color || '#64748b') + '">' + esc(r.name) + '</span><br>' +
            '<span class="pi-key">' + esc(r.id) + ' · 优先级 ' + (r.priority || 0) + '</span></span></label>';
        }).join('') +
      '</div>';
    body.querySelectorAll('.perm-item').forEach((it) => {
      const cb = it.querySelector('input');
      cb.addEventListener('change', () => it.classList.toggle('checked', cb.checked));
    });
    modal({
      title: '分配身份组 · ' + (u.displayName || u.username), body, size: 'lg',
      okText: T('common.save', '保存'),
      onOk: async () => {
        const picked = Array.from(body.querySelectorAll('.perm-item'))
          .filter((it) => it.querySelector('input').checked).map((it) => it.dataset.rid);
        await API.Roles.assign({ userId: u.id, scope: scope || 'global', roles: picked });
        toast.success('身份组已更新');
        state.loaded.users = false;
        state.users.items = []; state.users.cursor = null;
        await loadUsers(true);
        state.loaded.users = true;
      },
    });
  }

  /* ========================================================================
   * 4. 内容管理
   * ==================================================================== */

  async function loadPosts(reset) {
    const tb = $('#poRows');
    if (state.posts.loading) return;
    state.posts.loading = true;
    try {
      if (reset) { state.posts.items = []; state.posts.cursor = null; skeletonRows(tb, 6); }
      const d = await API.Posts.list({ q: state.posts.q, limit: 30, cursor: state.posts.cursor });
      const seen = new Set(state.posts.items.map((x) => x.id));
      state.posts.items = state.posts.items.concat((d.items || []).filter((x) => x && !seen.has(x.id)));
      state.posts.cursor = d.cursor || null;
      renderPosts();
    } finally { state.posts.loading = false; }
  }

  const VIS_LABEL = { public: '公开', members: '仅会员', private: '私密', roles: '指定身份组', draft: '草稿' };

  function renderPosts() {
    const tb = $('#poRows');
    const list = state.posts.items;
    if (!list.length) {
      tableMessage(tb, 6, App.emptyState('没有匹配的文章', '换个关键词试试', 'file'));
      $('#btnMorePosts').hidden = true;
      return;
    }
    tb.innerHTML = list.map((p) => {
      const c = p.counts || {};
      const vis = p.status === 'draft' ? 'draft' : p.visibility;
      return '<tr data-pid="' + esc(p.id) + '">' +
        '<td><a href="/post.html?id=' + encodeURIComponent(p.id) + '" target="_blank" style="font-weight:600">' +
          esc(p.title || '（无标题）') + '</a>' +
          (p.pinned ? ' <span class="badge badge-accent">置顶</span>' : '') +
          (p.locked ? ' <span class="badge">锁定</span>' : '') + '</td>' +
        '<td><span class="small">' + esc((p.author && (p.author.displayName || p.author.username)) || '—') + '</span></td>' +
        '<td><span class="badge">' + esc(VIS_LABEL[vis] || vis || '—') + '</span></td>' +
        '<td><span class="small muted mono">' + (c.views || 0) + ' 阅 · ' + (c.likes || 0) + ' 赞 · ' + (c.comments || 0) + ' 评</span></td>' +
        '<td><span class="small muted">' + esc(fmt(p.createdAt, 'date')) + '</span></td>' +
        '<td class="td-actions">' +
          '<a class="btn btn-sm btn-ghost" href="/editor.html?id=' + encodeURIComponent(p.id) + '" target="_blank">编辑</a>' +
          '<button class="btn btn-sm btn-danger" data-act="del">删除</button>' +
        '</td></tr>';
    }).join('');

    tb.querySelectorAll('[data-act="del"]').forEach((b) => {
      b.onclick = async () => {
        const tr = b.closest('tr');
        const p = list.find((x) => x.id === tr.dataset.pid);
        if (!(await confirmDialog('确认删除《' + (p.title || '无标题') + '》？该操作不可撤销。', { danger: true }))) return;
        busy(b, true);
        try {
          await API.Posts.remove(p.id);
          state.posts.items = state.posts.items.filter((x) => x.id !== p.id);
          toast.success('已删除');
          renderPosts();
        } catch (e) { toastError(e); } finally { busy(b, false); }
      };
    });

    const more = $('#btnMorePosts');
    more.hidden = !state.posts.cursor;
    more.onclick = async () => {
      busy(more, true);
      try { await loadPosts(false); } catch (e) { toastError(e); } finally { busy(more, false); }
    };
  }

  /* ========================================================================
   * 5. 版块管理
   * ==================================================================== */

  async function loadChannels() {
    const tb = $('#chRows');
    skeletonRows(tb, 5);
    const d = await API.Boards.list();
    const list = d.items || [];
    if (!list.length) {
      tableMessage(tb, 5, App.emptyState('还没有任何版块', '创建第一个版块开始社区治理', 'hash',
        '<a class="btn btn-primary" href="/channels.html">前往创建</a>'));
      return;
    }
    tb.innerHTML = list.map((b) => {
      const iconHtml = b.avatar
        ? '<img src="' + esc(API.fileURL(b.avatar)) + '" style="width:32px;height:32px;border-radius:8px;object-fit:cover;flex:none" alt="">'
        : '<span style="font-size:18px;flex:none">' + esc(b.icon || '📁') + '</span>';
      const officialTag = b.officialBadge ? '<span class="badge badge-accent xsmall" style="margin-left:6px">官方</span>' : '';
      return '<tr>' +
        '<td><div class="row" style="gap:8px;align-items:center">' + iconHtml +
          '<div><div style="font-weight:620">' + esc(b.name) + officialTag + '</div>' +
          '<div class="small muted mono">' + esc(b.id) + '</div></div></div></td>' +
        '<td><span class="badge ' + (b.visibility === 'private' ? 'badge-warn' : 'badge-ok') + '">' +
          (b.visibility === 'private' ? '私密' : '公开') + '</span></td>' +
        '<td><span class="small muted">' + (b.channelCount || 0) + ' 个频道</span></td>' +
        '<td><span class="small mono">' + num(b.memberCount || 0) + '</span></td>' +
        '<td class="td-actions">' +
          '<button class="btn btn-sm btn-soft" data-act="edit" data-id="' + esc(b.id) + '">编辑</button>' +
          '<a class="btn btn-sm btn-ghost" href="/channel_manage.html?id=' + encodeURIComponent(b.id) + '">频道</a>' +
          '<button class="btn btn-sm btn-danger" data-act="del" data-id="' + esc(b.id) + '">删除</button>' +
        '</td></tr>';
    }).join('');

    tb.querySelectorAll('[data-act="edit"]').forEach((b) => b.onclick = () => {
      const bd = list.find((x) => x.id === b.dataset.id);
      openBoardEditor(bd || { id: b.dataset.id });
    });
    tb.querySelectorAll('[data-act="del"]').forEach((b) => b.onclick = async () => {
      const id = b.dataset.id;
      if (!(await confirmDialog('删除版块 ' + id + '？其下所有频道将一并删除，且不可恢复。', { danger: true }))) return;
      busy(b, true);
      try { await API.Boards.remove(id); toast.success('已删除版块'); loadChannels(); }
      catch (e) { toastError(e); } finally { busy(b, false); }
    });
  }

  /** 版块创建 / 编辑弹窗（在后台内完成，无需跳转到别的页面） */
  function openBoardEditor(board) {
    const isEdit = !!(board && board.id);
    const body = el('div');
    body.innerHTML =
      '<div class="field"><label class="label">版块名称</label>' +
        '<input class="input" id="bdName" maxlength="40" value="' + esc(isEdit ? (board.name || '') : '') + '" placeholder="例如：综合讨论区"></div>' +
      '<div class="row" style="gap:12px;align-items:flex-end">' +
        '<div class="field" style="flex:none"><label class="label">图标 Emoji</label>' +
          '<input class="input" id="bdIcon" maxlength="4" style="width:72px;text-align:center;font-size:18px" value="' + esc(isEdit ? (board.icon || '📁') : '📁') + '"></div>' +
        '<div class="field" style="flex:1"><label class="label">头像</label>' +
          '<div class="upload-zone small" id="bdAvatarZone">' + (isEdit && board.avatar ? '<span>已上传，点击替换</span>' : '<span>点击或拖拽上传头像</span>') + '</div>' +
          '<input type="hidden" id="bdAvatar" value="' + esc(isEdit ? (board.avatar || '') : '') + '"></div>' +
      '</div>' +
      '<div class="row" style="gap:12px">' +
        '<div class="field" style="flex:1"><label class="label">可见性</label>' +
          '<select class="input" id="bdVis">' +
            '<option value="public"' + (isEdit && board.visibility !== 'private' ? ' selected' : '') + '>公开</option>' +
            '<option value="private"' + (isEdit && board.visibility === 'private' ? ' selected' : '') + '>私密</option>' +
          '</select></div>' +
        '<div class="field" style="flex:1"><label class="label checkbox"><input type="checkbox" id="bdOfficial"' + (isEdit && board.officialBadge ? ' checked' : '') + '> 官方认证版块</label></div>' +
      '</div>' +
      '<div class="field"><label class="label">简介</label>' +
        '<textarea class="textarea" id="bdDesc" rows="3" maxlength="300" placeholder="一句话介绍这个版块">' + esc(isEdit ? (board.description || '') : '') + '</textarea></div>';

    App.uploadZone($('#bdAvatarZone', body), 'avatar', (url) => {
      $('#bdAvatar', body).value = url;
      $('#bdAvatarZone', body).innerHTML = '<span>已上传 ' + url.slice(-12) + '</span>';
    }, { accept: 'image/*' });

    modal({
      title: isEdit ? ('编辑版块 · ' + (board.name || board.id)) : '创建版块',
      body, size: 'md',
      okText: isEdit ? '保存' : '创建',
      async onOk() {
        const payload = {
          name: $('#bdName', body).value.trim(),
          icon: $('#bdIcon', body).value.trim() || '📁',
          avatar: $('#bdAvatar', body).value.trim(),
          visibility: $('#bdVis', body).value,
          officialBadge: $('#bdOfficial', body).checked,
          description: $('#bdDesc', body).value.trim(),
        };
        if (payload.name.length < 2) { toast.warn('版块名至少 2 个字符'); return false; }
        if (isEdit) await API.Boards.update(board.id, payload);
        else await API.Boards.create(payload);
        toast.success(isEdit ? '版块已更新' : '版块已创建');
        loadChannels();
        return true;
      },
    });
  }

  /* ========================================================================
   * 6. 权限组
   * ==================================================================== */

  async function loadRoles(reset) {
    if (reset) state.roles.scope = ($('#roScope').value || 'global').trim();
    $('#roList').innerHTML = '<div class="skeleton" style="height:32px"></div>'.repeat(4);
    state.roles.data = await API.Roles.list(state.roles.scope);
    $('#roScopeHint').textContent = state.roles.scope === 'global'
      ? '全局作用域身份组，决定用户在站点范围内的能力'
      : '作用域 ' + state.roles.scope + ' 的身份组，仅在该范围内生效';
    if (state.roles.active) {
      state.roles.active = (state.roles.data.roles || []).find((r) => r.id === state.roles.active.id) || null;
    }
    renderRoleList();
    renderRoleDetail();
    renderCustomRoles();
  }

  function customRoleScope() { return ($('#roScope').value || 'global').trim(); }

  /* 自定义身份组（带图标）：管理者/超管创建，图标对全组生效 */
  async function renderCustomRoles() {
    const box = $('#customRoleList');
    if (!box) return;
    const scope = customRoleScope();
    try {
      const d = await API.CustomRoles.list(scope);
      const roles = d.roles || [];
      box.innerHTML = roles.length ? roles.map((r) =>
        '<div class="role-row" style="cursor:pointer" data-crole="' + esc(r.id) + '">' +
          (r.icon ? '<img class="rt-icon" src="' + esc(r.icon) + '" alt="">' : '<span class="rr-color" style="background:' + esc(r.color || '#64748b') + '"></span>') +
          '<span class="rr-name">' + esc(r.name) + '</span>' +
          '<span class="rr-meta">' + (r.perms || []).length + ' 权限</span>' +
          '<span class="spacer"></span>' +
          '<button class="icon-btn" data-crole-del="' + esc(r.id) + '" title="删除">' + icon('trash') + '</button>' +
        '</div>').join('')
        : '<p class="muted small mb-0">该作用域暂无自定义身份组。</p>';
      box.querySelectorAll('[data-crole]').forEach((n) => n.onclick = (e) => {
        if (e.target.closest('[data-crole-del]')) return;
        const role = roles.find((x) => x.id === n.dataset.crole);
        if (role) openCustomRoleDialog(role);
      });
      box.querySelectorAll('[data-crole-del]').forEach((b) => b.onclick = async (e) => {
        e.stopPropagation();
        if (!(await App.confirmDialog('确定删除该身份组？', { danger: true }))) return;
        try { await API.CustomRoles.remove(b.dataset.croleDel, scope); toast.success(T('common.success')); renderCustomRoles(); }
        catch (err) { toastError(err); }
      });
    } catch (e) { box.innerHTML = '<p class="error-text small">' + esc(e.message) + '</p>'; }
  }

  function openCustomRoleDialog(role) {
    const scope = customRoleScope();
    const isEdit = !!role;
    const body = App.el('div');
    let iconUrl = (role && role.icon) || '';
    body.innerHTML =
      '<input type="hidden" id="crId" value="' + esc(isEdit ? role.id : '') + '">' +
      '<div class="row" style="gap:12px">' +
        '<div class="field" style="flex:0 0 96px"><label class="label">颜色</label>' +
          '<input class="color-input" id="crColor" value="' + esc((role && role.color) || '#6366f1') + '"></div>' +
        '<div class="field grow"><label class="label">名称</label>' +
          '<input class="input" id="crName" maxlength="30" value="' + esc((role && role.name) || '') + '" placeholder="身份组名称"></div>' +
      '</div>' +
      '<div class="field"><label class="label">图标（上传图片，对全组生效）</label>' +
        '<div class="avatar-edit">' + (iconUrl ? '<img id="crIconImg" src="' + esc(iconUrl) + '">' : '<div class="avatar avatar-lg" id="crIconImg">🏷️</div>') +
        '<div><div class="upload-zone" id="crIconZone"><p>上传图标</p></div></div></div></div>' +
      '<div class="field"><label class="label">优先级（数字越大越靠前）</label>' +
        '<input class="input" id="crPriority" type="number" min="0" max="999" value="' + ((role && role.priority) || 300) + '"></div>';
    App.modal({
      title: isEdit ? '编辑身份组' : '创建身份组', body, okText: T('common.save'),
      onOk: async () => {
        const name = body.querySelector('#crName').value.trim();
        if (name.length < 2) { toast.warn('名称至少 2 个字符'); return false; }
        const payload = {
          scope,
          name,
          color: body.querySelector('#crColor').value,
          icon: iconUrl,
          priority: Number(body.querySelector('#crPriority').value) || 300,
        };
        if (isEdit) { await API.CustomRoles.update(role.id, payload); }
        else { payload.id = 'role_' + (Date.now().toString(36)); await API.CustomRoles.create(payload); }
        toast.success(T('common.success'));
        renderCustomRoles();
      },
    });
    App.uploadZone(body.querySelector('#crIconZone'), 'image', (url) => {
      iconUrl = url;
      const img = body.querySelector('#crIconImg');
      if (img) img.outerHTML = '<img id="crIconImg" src="' + esc(url) + '">';
    });
  }

  /* 普通用户为自己的身份组设置仅自己可见的图标 */
  function openMyRoleIcons() {
    const u = App.Session.user;
    if (!u) { App.Session.require(); return; }
    const roles = [];
    const map = (u.roles && typeof u.roles === 'object') ? u.roles : {};
    Object.keys(map).forEach((sc) => (map[sc] || []).forEach((id) => roles.push({ scope: sc, id })));
    const overrides = (u.roleIconOverrides && typeof u.roleIconOverrides === 'object') ? u.roleIconOverrides : {};
    if (!roles.length) { toast.info('你当前没有任何身份组'); return; }
    const urls = {};
    const placeholder = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    const body = App.el('div');
    body.innerHTML = roles.map((r) =>
      '<div class="field"><label class="label">' + esc(r.scope) + ' · ' + esc(r.id) + '</label>' +
        '<div class="avatar-edit"><img id="miImg_' + esc(r.id) + '" src="' + (overrides[r.id] ? esc(API.fileURL(overrides[r.id])) : placeholder) + '" style="width:40px;height:40px;border-radius:8px;object-fit:cover">' +
        '<div><div class="upload-zone" id="miZone_' + esc(r.id) + '" style="flex:1"><p>上传我的图标</p></div></div></div></div>'
    ).join('');
    App.modal({
      title: '我的身份组图标（仅自己可见）', body, okText: T('common.save'),
      onOk: async () => {
        for (const r of roles) {
          await API.CustomRoles.setMyIcon(r.id, urls[r.id] || '');
        }
        toast.success(T('common.success'));
        try { if (App.Session.refresh) await App.Session.refresh(); } catch (e) {}
      },
    });
    roles.forEach((r) => {
      App.uploadZone(body.querySelector('#miZone_' + r.id), 'image', (key) => {
        urls[r.id] = key;
        const img = body.querySelector('#miImg_' + CSS.escape(r.id));
        if (img) img.src = API.fileURL(key);
      });
    });
  }

  /* 小贴士管理 */
  function openTipsDialog() {
    const tips = (state.tips || []).slice();
    const body = App.el('div');
    function paint() {
      body.innerHTML = '<div style="display:flex;flex-direction:column;gap:8px">' + tips.map((t, i) =>
        '<div class="row" style="gap:8px;align-items:center">' +
          '<input class="input grow" data-tip="' + i + '" value="' + esc(t.text || '') + '" maxlength="120" placeholder="小贴士内容">' +
          '<button class="icon-btn" data-tipdel="' + i + '" title="删除">' + icon('trash') + '</button>' +
        '</div>').join('') + '</div>' +
        '<button class="btn btn-sm btn-soft mt-2" id="tipAdd">+ 添加小贴士</button>';
      body.querySelectorAll('[data-tip]').forEach((inp) => inp.oninput = () => { tips[inp.dataset.tip] = { text: inp.value, icon: '💡' }; });
      body.querySelectorAll('[data-tipdel]').forEach((b) => b.onclick = () => { tips.splice(Number(b.dataset.tipdel), 1); paint(); });
      const add = body.querySelector('#tipAdd'); if (add) add.onclick = () => { tips.push({ text: '', icon: '💡' }); paint(); };
    }
    paint();
    App.modal({
      title: '小贴士管理', body, okText: T('common.save'),
      onOk: async () => {
        const cleaned = tips.filter((t) => (t.text || '').trim()).map((t) => ({ text: t.text.trim(), icon: t.icon || '💡' }));
        state.tips = cleaned;
        await API.Admin.saveConfig({ tips: cleaned });
        if (App.Site && App.Site.cfg) App.Site.cfg.tips = cleaned;
        toast.success(T('common.success'));
      },
    });
  }

  /* 外部表情管理 */
  async function openEmojiManager() {
    const d = await API.Emojis.list();
    const emojis = (d.items || []).slice();
    const body = App.el('div');
    function paint() {
      body.innerHTML = '<div class="emoji-admin-list">' + emojis.map((e, i) =>
        '<div class="emoji-admin-item">' +
          '<img src="' + esc(e.url) + '" alt="">' +
          '<div style="flex:1;min-width:0">' +
            '<div class="ea-name">:' + esc(e.name) + ':</div>' +
            '<div class="ea-url">' + esc(e.url) + '</div>' +
          '</div>' +
          '<button class="icon-btn" data-emojidel="' + i + '" title="删除">' + icon('trash') + '</button>' +
        '</div>').join('') + '</div>' +
        '<div class="card card-pad mt-3">' +
          '<div class="section-title">新增表情</div>' +
          '<div class="row" style="gap:8px"><input class="input" id="emoName" placeholder="名称（字母数字下划线）" maxlength="32"><input class="input grow" id="emoUrl" placeholder="图片 URL（https://）"></div>' +
          '<button class="btn btn-sm btn-primary mt-2" id="emoAdd">添加</button>' +
        '</div>';
      body.querySelectorAll('[data-emojidel]').forEach((b) => b.onclick = () => { emojis.splice(Number(b.dataset.emojidel), 1); paint(); });
      const add = body.querySelector('#emoAdd'); if (add) add.onclick = () => {
        const name = body.querySelector('#emoName').value.trim();
        const url = body.querySelector('#emoUrl').value.trim();
        if (!/^[a-zA-Z0-9_]{1,32}$/.test(name)) { toast.warn('名称仅含字母数字下划线'); return; }
        if (!/^https?:\/\//i.test(url)) { toast.warn('请输入合法的 https 图片地址'); return; }
        emojis.push({ id: 'emo_' + Date.now().toString(36) + '_' + name, name, url, creator: (App.Session.user && App.Session.user.username) || '', createdAt: Date.now() });
        paint();
      };
    }
    paint();
    App.modal({
      title: '外部表情管理', body, okText: T('common.save'),
      onOk: async () => {
        await API.Emojis.save(emojis, d.allowExternalEmoji);
        if (App.Site && App.Site.cfg) { App.Site.cfg.emojis = emojis; App.Site.cfg.allowExternalEmoji = d.allowExternalEmoji; }
        toast.success(T('common.success'));
      },
    });
  }

  function renderRoleList() {
    const roles = (state.roles.data.roles || []).slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
    const cur = state.roles.active;
    $('#roList').innerHTML = roles.map((r) =>
      '<button class="side-item' + (cur && cur.id === r.id ? ' active' : '') + '" data-role="' + esc(r.id) + '">' +
        '<span style="width:9px;height:9px;border-radius:50%;flex:none;background:' + esc(r.color || '#64748b') + '"></span>' +
        '<span class="truncate">' + esc(r.name) + '</span>' +
        '<span class="count">' + ((r.perms || []).length) + '</span></button>').join('') ||
      '<p class="muted small mb-0">该作用域暂无身份组</p>';

    $$('#roList [data-role]').forEach((b) => {
      b.onclick = () => {
        state.roles.active = roles.find((r) => r.id === b.dataset.role) || null;
        renderRoleList(); renderRoleDetail();
      };
    });
  }

  function renderRoleDetail() {
    const r = state.roles.active;
    const box = $('#roDetail');
    if (!r) { box.innerHTML = '<p class="muted small mb-0">从左侧选择一个身份组开始编辑。</p>'; return; }

    const catalog = state.roles.data.catalog || [];
    const canManage = !!state.roles.data.canManage;
    const locked = r.id === 'role_super_admin' && !App.Session.isSuperAdmin;

    box.innerHTML =
      '<div class="row-between mb-4" style="gap:10px;flex-wrap:wrap">' +
        '<div class="row" style="gap:10px;align-items:center">' +
          '<input class="color-input" type="color" id="rdColor" value="' + esc(r.color || '#64748b') + '"' + (canManage && !locked ? '' : ' disabled') + '>' +
          '<input class="input input-sm" id="rdName" value="' + esc(r.name) + '" maxlength="30" style="max-width:200px"' + (canManage && !locked ? '' : ' disabled') + '>' +
          '<input class="input input-sm mono" id="rdPriority" type="number" min="0" max="999" value="' + (r.priority || 0) + '" style="max-width:96px"' + (canManage && !locked ? '' : ' disabled') + '>' +
        '</div>' +
        '<div class="row" style="gap:8px">' +
          (canManage && !locked ? '<button class="btn btn-sm btn-ghost" id="rdAll">全选</button>' +
            '<button class="btn btn-sm btn-ghost" id="rdNone">清空</button>' +
            '<button class="btn btn-sm btn-primary" id="rdSave">' + T('common.save', '保存') + '</button>' : '') +
          (canManage && !r.system ? '<button class="btn btn-sm btn-danger" id="rdDel">' + T('common.delete', '删除') + '</button>' : '') +
        '</div>' +
      '</div>' +
      (r.system ? '<p class="hint mb-4">这是系统预设身份组，可以调整权限但不可删除。</p>' : '') +
      '<div class="perm-grid" id="rdPerms">' +
        catalog.map((p) => {
          const on = (r.perms || []).includes(p.key);
          return '<label class="perm-item' + (on ? ' checked' : '') + (locked ? ' locked' : '') + '" data-pk="' + esc(p.key) + '">' +
            '<input type="checkbox" class="check"' + (on ? ' checked' : '') + (canManage && !locked ? '' : ' disabled') + '>' +
            '<span><span class="pi-label">' + esc(p.label) + '</span><br>' +
            '<span class="pi-key">' + esc(p.key) + ' · ' + (p.scope === 'G' ? '站点级' : '作用域级') + '</span></span></label>';
        }).join('') +
      '</div>' +
      '<p class="hint mt-4">站点级(G)权限只有超级管理员可以分配；非超管只能授予自己已拥有的作用域级(S)权限。</p>';

    box.querySelectorAll('.perm-item').forEach((it) => {
      const cb = it.querySelector('input');
      cb.addEventListener('change', () => it.classList.toggle('checked', cb.checked));
    });
    const all = $('#rdAll', box), none = $('#rdNone', box);
    if (all) all.onclick = () => box.querySelectorAll('.perm-item').forEach((it) => {
      const cb = it.querySelector('input'); if (cb.disabled) return; cb.checked = true; it.classList.add('checked');
    });
    if (none) none.onclick = () => box.querySelectorAll('.perm-item').forEach((it) => {
      const cb = it.querySelector('input'); if (cb.disabled) return; cb.checked = false; it.classList.remove('checked');
    });

    const save = $('#rdSave', box);
    if (save) save.onclick = async () => {
      busy(save, true);
      try {
        const perms = Array.from(box.querySelectorAll('.perm-item'))
          .filter((it) => it.querySelector('input').checked).map((it) => it.dataset.pk);
        await API.Roles.update(r.id, {
          scope: state.roles.scope,
          name: $('#rdName', box).value.trim(),
          color: $('#rdColor', box).value,
          priority: Number($('#rdPriority', box).value) || 0,
          perms,
        });
        toast.success(T('settings.saved', '已保存'));
        await loadRoles(false);
      } catch (e) { toastError(e); } finally { busy(save, false); }
    };

    const del = $('#rdDel', box);
    if (del) del.onclick = async () => {
      if (!(await confirmDialog('确认删除身份组「' + r.name + '」？拥有该组的成员会立即失去对应权限。', { danger: true }))) return;
      try {
        await API.Roles.remove(r.id, state.roles.scope);
        state.roles.active = null;
        toast.success(T('common.success', '操作成功'));
        await loadRoles(false);
      } catch (e) { toastError(e); }
    };
  }

  function newRoleDialog() {
    const body = el('div');
    body.innerHTML =
      '<div class="row" style="gap:12px">' +
        '<div class="field" style="flex:0 0 70px"><label class="label">颜色</label>' +
          '<input class="color-input" type="color" id="nrColor" value="#6366f1"></div>' +
        '<div class="field grow"><label class="label">身份组名称</label>' +
          '<input class="input" id="nrName" maxlength="30" placeholder="例如：内容审核"></div>' +
        '<div class="field" style="flex:0 0 110px"><label class="label">优先级</label>' +
          '<input class="input mono" id="nrPriority" type="number" min="0" max="999" value="200"></div>' +
      '</div>' +
      '<p class="hint">作用域：<code class="mono">' + esc(state.roles.scope) + '</code>。创建后可在右侧勾选具体权限。</p>';
    modal({
      title: '创建身份组', body, okText: T('common.create', '创建'),
      onOk: async () => {
        const name = $('#nrName', body).value.trim();
        if (!name) { toast.warn('请输入身份组名称'); return false; }
        const d = await API.Roles.create({
          scope: state.roles.scope, name,
          color: $('#nrColor', body).value,
          priority: Number($('#nrPriority', body).value) || 200,
          perms: [],
        });
        toast.success(T('common.success', '创建成功'));
        state.roles.active = d.role;
        await loadRoles(false);
      },
    });
  }

  /* ========================================================================
   * 7. 举报处理
   * ==================================================================== */

  const REPORT_REASON = { spam: '垃圾信息', abuse: '辱骂骚扰', illegal: '违法违规', porn: '色情低俗', other: '其他' };
  const REPORT_TARGET = { post: '文章', comment: '评论', user: '用户', message: '私信' };

  async function loadReports() {
    const mount = $('#rpList');
    mount.innerHTML = App.skeletonList(3, 110);
    const status = $('#rpStatus').value;
    const d = await API.Reports.list({ scope: 'global', status, limit: 100 });
    const list = d.items || [];
    if (!list.length) {
      mount.innerHTML = App.emptyState('没有举报记录', '当前筛选条件下队列是空的', 'flag');
      return;
    }
    mount.innerHTML = list.map((r) => {
      const link = r.targetType === 'post' ? '/post.html?id=' + encodeURIComponent(r.targetId)
        : r.targetType === 'user' ? '/profile.html?id=' + encodeURIComponent(r.targetId) : '';
      return '<div class="card card-pad" data-rid="' + esc(r.id) + '">' +
        '<div class="row-between" style="gap:10px;flex-wrap:wrap">' +
          '<div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">' +
            '<span class="badge badge-info">' + esc(REPORT_TARGET[r.targetType] || r.targetType) + '</span>' +
            '<span class="badge badge-warn">' + esc(REPORT_REASON[r.reason] || r.reason) + '</span>' +
            '<span class="badge' + (r.status === 'open' ? ' badge-danger' : '') + '">' + esc(r.status) + '</span>' +
            '<span class="small muted">' + esc(fmt(r.createdAt)) + '</span>' +
          '</div>' +
          '<div class="row" style="gap:6px">' +
            (link ? '<a class="btn btn-sm btn-ghost" href="' + link + '" target="_blank">查看目标</a>' : '') +
            (r.status === 'open' || r.status === 'processing'
              ? '<button class="btn btn-sm btn-soft" data-a="processing">标记处理中</button>' +
                '<button class="btn btn-sm btn-primary" data-a="resolved">处理完成</button>' +
                '<button class="btn btn-sm btn-ghost" data-a="rejected">驳回</button>' : '') +
          '</div>' +
        '</div>' +
        (r.detail ? '<p class="small mt-2 mb-0">' + esc(r.detail) + '</p>' : '') +
        '<div class="small muted mt-2">举报人：' +
          esc((r.reporter && (r.reporter.displayName || r.reporter.username)) || '已注销') +
          ' · 目标 ID <code class="mono">' + esc(r.targetId) + '</code>' +
          ' · 作用域 <code class="mono">' + esc(r.scope) + '</code>' +
          (r.resolution ? ' · 处理结论：' + esc(r.resolution) : '') +
        '</div>' +
      '</div>';
    }).join('');

    mount.querySelectorAll('[data-a]').forEach((b) => {
      b.onclick = async () => {
        const id = b.closest('[data-rid]').dataset.rid;
        const status = b.dataset.a;
        let resolution = '';
        if (status !== 'processing') {
          resolution = await promptDialog('处理说明（会通知举报人）', {
            title: status === 'resolved' ? '处理完成' : '驳回举报', placeholder: '例如：已删除违规内容并禁言 24 小时',
          });
          if (resolution === null) return;
        }
        busy(b, true);
        try {
          await API.Reports.resolve(id, { status, resolution });
          toast.success('已更新举报状态');
          await loadReports();
        } catch (e) { toastError(e); } finally { busy(b, false); }
      };
    });
  }
  /* ========================================================================
   * 8. 站点设置
   * ==================================================================== */

  const SITE_SWITCHES = [
    ['registerOpen', '开放注册', '关闭后仅管理员可创建账号'],
    ['requireEmailVerify', '注册需邮箱验证码', '关闭后可直接注册，安全性降低'],
    ['turnstileOnLogin', '登录启用 Turnstile', '在上方 Turnstile 设置中填入 Site Key / Secret 后生效'],
    ['turnstileOnRegister', '注册启用 Turnstile', '强烈建议开启，防止批量注册'],
    ['turnstileOnPost', '发文启用 Turnstile', '发文频率高的社区可关闭'],
    ['allowGithubLogin', '允许 GitHub 登录', '需配置 GITHUB_CLIENT_ID / SECRET'],
    ['allowDiscordLogin', '允许 Discord 登录', '需配置 DISCORD_CLIENT_ID / SECRET'],
  ];

  async function loadSiteConfig() {
    const d = await API.Admin.getConfig();
    state.cfg = d.config || {};
    const c = state.cfg;

    $('#stTitle').value = c.siteTitle || '';
    $('#stSubtitle').value = c.siteSubtitle || '';
    $('#stLogo').value = c.logo || '';
    $('#stFavicon').value = c.favicon || '';
    $('#stAccent').value = /^#[0-9a-fA-F]{6}$/.test(c.accent || '') ? c.accent : '#6366f1';
    $('#stAccentHex').value = $('#stAccent').value;
    $('#stTheme').value = c.themeDefault || 'auto';
    $('#stRadius').value = (c.theme && c.theme.radius != null) ? c.theme.radius : 12;
    $('#stFont').value = (c.theme && c.theme.font) || '';
    $('#stAllowEmoji').checked = c.allowExternalEmoji !== false;
    state.tips = Array.isArray(c.tips) ? c.tips : [];
    state.emojis = Array.isArray(c.emojis) ? c.emojis : [];
    $('#stLanding').value = c.landingMode || 'personal';
    $('#stLoginBg').value = c.loginBackground || '';
    $('#stLoginBlur').value = c.loginBackgroundBlur == null ? 6 : c.loginBackgroundBlur;
    $('#stAnnouncement').value = c.announcement || '';
    $('#stFooter').value = c.footerText || App.FOOTER_LEGAL || '';
    $('#stFooterAlign').value = c.footerAlign || 'left';
    $('#stAbout').value = c.about || '';
    $('#stSeoDesc').value = (c.seo && c.seo.description) || '';
    $('#stSeoKw').value = (c.seo && c.seo.keywords) || '';
    const links = c.links || {};
    $('#stDiscord').value = links.discord || '';
    state.discordAvatar = links.discordAvatar || '';
    $('#stGithub').value = links.github || '';
    $('#stTelegram').value = links.telegram || '';
    $('#stDownload').value = links.download || '';
    $('#stGithubDownload').value = links.githubDownload || '';

    // Turnstile 密钥设置（出于安全，Secret 不回显，仅展示已配置状态）
    const ts = c.turnstile || {};
    $('#tsEnabled').checked = ts.enabled === true;
    $('#tsSiteKey').value = ts.siteKey || '';
    $('#tsSecret').value = '';
    const tsState = $('#tsSecretState');
    if (tsState) tsState.textContent = (ts.siteKey ? '已配置 Site Key' : '未配置 Site Key') + (ts.secret ? '；Secret 已保存' : '；Secret 未保存');

    // 邮件服务配置（出于安全，API Token 不回显，仅展示已配置状态）
    const mail = c.mail || {};
    $('#mailProvider').value = mail.provider || 'resend';
    $('#mailFrom').value = mail.from || '';
    $('#mailApiUrl').value = mail.apiUrl || '';
    $('#mailApiToken').value = '';
    const mailState = $('#mailTokenState');
    if (mailState) mailState.textContent = mail.apiToken ? 'API Key 已保存' : 'API Key 未保存';

    // OAuth 凭证（出于安全，Secret 不回显，仅展示已配置状态）
    const oa = c.oauth || {};
    const ghOa = oa.github || {}, dcOa = oa.discord || {}, cfOa = oa.cloudflare || {};
    $('#oauthGithubId').value = ghOa.clientId || '';
    $('#oauthGithubSecret').value = '';
    $('#oauthDiscordId').value = dcOa.clientId || '';
    $('#oauthDiscordSecret').value = '';
    $('#oauthCfId').value = cfOa.clientId || '';
    $('#oauthCfSecret').value = '';
    const oaState = $('#oauthState');
    if (oaState) {
      oaState.textContent = 'GitHub：' + (ghOa.clientId ? 'ID 已填' : '未填（用环境变量）') + (ghOa.clientSecret ? ' / Secret 已保存' : ' / Secret 未保存')
        + '　|　Discord：' + (dcOa.clientId ? 'ID 已填' : '未填（用环境变量）') + (dcOa.clientSecret ? ' / Secret 已保存' : ' / Secret 未保存')
        + '　|　Cloudflare：' + (cfOa.clientId ? 'ID 已填' : '未填（用环境变量）') + (cfOa.clientSecret ? ' / Secret 已保存' : ' / Secret 未保存');
    }

    // 联系我们配置
    const ct = (c.contact && typeof c.contact === 'object') ? c.contact : {};
    $('#contactEnabled').checked = ct.enabled === true;
    $('#contactType').value = ct.type || 'email';
    $('#contactValue').value = ct.value || '';
    $('#contactNote').value = ct.note || '';
    const ctTypeSel = $('#contactType');
    if (ctTypeSel) {
      const syncContactLabels = () => {
        const t = ctTypeSel.value;
        const lbl = $('#contactValueLabel'), hint = $('#contactValueHint'), val = $('#contactValue');
        if (t === 'email') { lbl.textContent = '接收反馈的邮箱'; hint.textContent = '用户提交反馈时，邮件将发送到此邮箱（需已配置邮件服务）。'; val.placeholder = 'admin@example.com'; }
        else if (t === 'url') { lbl.textContent = '跳转网址'; hint.textContent = '点击「联系我们」时，将询问用户是否打开该链接。'; val.placeholder = 'https://...'; }
        else { lbl.textContent = 'QQ 号 / QQ 群号 / 加群链接'; hint.textContent = '点击「联系我们」时，将尝试拉起 QQ 加好友 / 加群。也可直接填 qm.qq.com 加群链接。'; val.placeholder = '123456789'; }
      };
      ctTypeSel.onchange = syncContactLabels;
      syncContactLabels();
    }

    // 意见反馈弹窗配置（正文支持 markdown，由超管编写；email 用于提示用户发信）
    const fb = (c.feedback && typeof c.feedback === 'object') ? c.feedback : {};
    if ($('#fbMarkdown')) $('#fbMarkdown').value = fb.markdown || '';
    if ($('#fbEmail')) $('#fbEmail').value = fb.email || '';
    if ($('#fbOfficialUsername')) $('#fbOfficialUsername').value = fb.officialUsername || '';
    const fbPreview = $('#fbPreview');
    if (fbPreview) fbPreview.innerHTML = fb.markdown ? App.markdown(fb.markdown) : '<span class="muted">（预览）</span>';
    const fbMd = $('#fbMarkdown');
    if (fbMd) fbMd.oninput = () => { if (fbPreview) fbPreview.innerHTML = App.markdown(fbMd.value) || '<span class="muted">（预览）</span>'; };
    const fbViewList = $('#fbViewList');
    if (fbViewList) fbViewList.onclick = () => viewFeedbackList();

    function toggleMailApiUrl() {
      const f = $('#mailApiUrlField');
      if (f) f.style.display = ($('#mailProvider').value === 'cloudmail') ? '' : 'none';
    }
    $('#mailProvider').onchange = toggleMailApiUrl;
    toggleMailApiUrl();
    const mailTestBtn = $('#mailTestBtn');
    if (mailTestBtn) mailTestBtn.onclick = async () => {
      const to = prompt('请输入接收测试邮件的邮箱：');
      if (!to) return;
      const st = $('#mailTestState'); st.textContent = '发送中…'; st.style.color = '';
      try {
        const d = await API.post('/api/admin/test-mail', { to });
        const ok = !!(d && d.ok);
        st.textContent = ok ? ('✅ 已发送（' + (d.provider || '') + '）') : ('❌ 失败：' + ((d && (d.detail || d.msg)) || '未知错误'));
        st.style.color = ok ? 'var(--accent)' : '#ef4444';
      } catch (e) { st.textContent = '❌ 请求失败：' + ((e && e.message) || e); st.style.color = '#ef4444'; }
    };

    state.contributors = (c.contributors || []).slice();
    state.announcements = (c.announcements || []).slice();
    renderContributors();
    renderAnnouncements();

    const p = c.personal || {};
    $('#pnName').value = p.displayName || '';
    $('#pnTagline').value = p.tagline || '';
    $('#pnAvatar').value = p.avatar || '';
    $('#pnBio').value = p.bio || '';
    $('#pnSkills').value = (p.skills || []).join(', ');
    state.projects = (p.projects || []).slice();
    state.socials = (p.socials || []).slice();
    renderProjects();
    renderSocials();

    $('#stSwitches').innerHTML = SITE_SWITCHES.map(([k, title, desc]) =>
      '<label class="switch-row">' +
        '<span><span class="sr-title">' + esc(title) + '</span>' +
        '<span class="sr-desc" style="display:block">' + esc(desc) + '</span></span>' +
        '<span class="switch"><input type="checkbox" data-cfg="' + k + '"' + (c[k] ? ' checked' : '') + '>' +
        '<span class="track"></span></span></label>').join('');

    previewTelegramFromConfig(links);
    previewDiscordFromConfig(links);
    const stEl = $('#stTelegram');
    if (stEl) { stEl.oninput = App.debounce(previewTelegramLive, 600); stEl.onblur = previewTelegramLive; }
    const sdEl = $('#stDiscord');
    if (sdEl) { sdEl.oninput = App.debounce(previewDiscordLive, 600); sdEl.onblur = previewDiscordLive; }
    const pc = $('#btnPreviewContact'); if (pc) pc.onclick = previewContact;
    const sc = $('#btnSaveChangelog'); if (sc) sc.onclick = () => saveChangelog(sc);
    const pcg = $('#btnPreviewChangelog'); if (pcg) pcg.onclick = previewChangelog;
    loadChangelog();
  }

  /* Telegram 头像实时预览：保存前即可看到「识别」到的头像与名称 */
  function previewTelegramFromConfig(links) {
    const el = $('#stTelegramPreview');
    if (!el) return;
    const avatar = (links && links.telegramAvatar) || '';
    const title = (links && links.telegramTitle) || '';
    if (!avatar && !title) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'flex';
    el.innerHTML = tgPreviewHTML(avatar, title, '当前已解析的头像');
  }
  async function previewTelegramLive() {
    const el = $('#stTelegramPreview');
    const input = $('#stTelegram');
    if (!el || !input) return;
    const url = input.value.trim();
    if (!url) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'flex';
    el.innerHTML = '<span class="muted small">识别中…</span>';
    try {
      const d = await API.Telegram.resolve(url);
      const avatar = (d && d.avatar) || '';
      const title = (d && d.title) || '';
      if (!avatar && !title) {
        el.innerHTML = '<span class="muted small">未识别到头像/名称（频道需为公开；个人主页无法公开获取头像）</span>';
        return;
      }
      el.innerHTML = tgPreviewHTML(avatar, title, '保存后将以该头像替换落地页 / 页脚图标');
    } catch (e) {
      el.innerHTML = '<span class="muted small">识别失败：' + esc((e && e.message) || e) + '</span>';
    }
  }
  function tgPreviewHTML(avatar, title, sub) {
    const ava = avatar
      ? '<img class="tg-preview-ava" src="' + esc(App.tgAvatarURL(avatar)) + '" alt="" onerror="this.style.display=\'none\'">'
      : '<span class="tg-preview-ava tg-preview-ava--ico">' + icon('telegram') + '</span>';
    return ava + '<span class="tg-preview-text"><b>' + esc(title || 'Telegram') + '</b><span class="small muted">' + esc(sub) + '</span></span>';
  }

  /* Discord 头像实时预览（与 Telegram 同构） */
  function previewDiscordFromConfig(links) {
    const el = $('#stDiscordPreview');
    if (!el) return;
    const avatar = (links && links.discordAvatar) || '';
    const title = (links && links.discordTitle) || '';
    if (!avatar && !title) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'flex';
    el.innerHTML = dcPreviewHTML(avatar, title, '当前已解析的服务器图标');
  }
  async function previewDiscordLive() {
    const el = $('#stDiscordPreview');
    const input = $('#stDiscord');
    if (!el || !input) return;
    const url = input.value.trim();
    if (!url) { state.discordAvatar = ''; el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'flex';
    el.innerHTML = '<span class="muted small">识别中…</span>';
    try {
      const d = await API.Discord.resolve(url);
      const avatar = (d && d.avatar) || '';
      const title = (d && d.title) || '';
      state.discordAvatar = avatar;
      if (!avatar && !title) {
        el.innerHTML = '<span class="muted small">未识别到服务器图标（邀请链接需有效且服务器公开）</span>';
        return;
      }
      el.innerHTML = dcPreviewHTML(avatar, title, '保存后将以该图标替换落地页 / 页脚 Discord 图标');
    } catch (e) {
      el.innerHTML = '<span class="muted small">识别失败：' + esc((e && e.message) || e) + '</span>';
    }
  }
  function dcPreviewHTML(avatar, title, sub) {
    const ava = avatar
      ? '<img class="tg-preview-ava" src="' + esc(avatar) + '" alt="" onerror="this.style.display=\'none\'">'
      : '<span class="tg-preview-ava tg-preview-ava--ico">' + icon('discord') + '</span>';
    return ava + '<span class="tg-preview-text"><b>' + esc(title || 'Discord') + '</b><span class="small muted">' + esc(sub) + '</span></span>';
  }

  /* 更新日志：文本 ↔ 结构化 */
  function parseChangelog(text) {
    const blocks = (text || '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    return blocks.map((b) => {
      const lines = b.split('\n');
      const head = lines.shift() || '';
      const m = head.match(/^(.*?)\s*[·•\-]\s*(.*)$/) || head.match(/^(.*?)\s+(20\d{2}[-\/]\d{1,2}[-\/]\d{1,2}.*)$/);
      let version = '', date = '', rest = head;
      if (m) { version = (m[1] || '').trim(); date = (m[2] || '').trim(); rest = ''; }
      const body = (rest ? rest + '\n' : '') + lines.join('\n');
      return { version, date, body: body.trim() };
    }).filter((x) => x.version || x.date || x.body);
  }
  function changelogToText(items) {
    return (items || []).map((it) => {
      const head = (it.version || '') + (it.date ? ' · ' + it.date : '');
      return (head ? head + '\n' : '') + (it.body || '');
    }).join('\n\n');
  }
  async function loadChangelog() {
    try {
      const d = await API.get('/api/changelog');
      const items = (d && d.items) || [];
      const ed = $('#clEditor'); if (ed) ed.value = changelogToText(items);
    } catch (e) { /* ignore */ }
  }
  async function saveChangelog(btn) {
    const ed = $('#clEditor'); if (!ed) return;
    const items = parseChangelog(ed.value);
    if (btn) App.busy(btn, true);
    try {
      await API.put('/api/changelog', { items });
      toast.success('更新日志已保存');
    } catch (e) { toastError(e); }
    finally { if (btn) App.busy(btn, false); }
  }
  function previewChangelog() {
    const ed = $('#clEditor'); const pv = $('#clPreview');
    if (!ed || !pv) return;
    const items = parseChangelog(ed.value);
    pv.style.display = items.length ? 'block' : 'none';
    pv.innerHTML = items.map((it) =>
      '<div class="cl-item"><div class="cl-head"><b>' + esc(it.version || '更新') + '</b>' +
      (it.date ? ' <span class="muted small">' + esc(it.date) + '</span>' : '') + '</div>' +
      '<div class="cl-body">' + App.markdown(it.body || '') + '</div></div>').join('');
  }

  /* 联系我们：预览 */
  function previewContact() {
    const fn = (window.App && App.openContactModal) || window.openContactModal;
    if (typeof fn === 'function') fn();
  }

  function renderProjects() {
    $('#pnProjects').innerHTML = state.projects.map((pr, i) =>
      '<div class="row" style="gap:8px;flex-wrap:wrap" data-i="' + i + '">' +
        '<input class="input input-sm" data-f="name" value="' + esc(pr.name || '') + '" placeholder="项目名" style="flex:0 0 160px">' +
        '<input class="input input-sm grow" data-f="desc" value="' + esc(pr.desc || '') + '" placeholder="一句话描述" style="min-width:180px">' +
        '<input class="input input-sm grow" data-f="url" value="' + esc(pr.url || '') + '" placeholder="https://" style="min-width:160px">' +
        '<button class="btn btn-sm btn-ghost" data-del="' + i + '">' + icon('trash') + '</button>' +
      '</div>').join('') || '<p class="muted small mb-0">暂无项目，点击右上角添加。</p>';

    $$('#pnProjects [data-del]').forEach((b) => b.onclick = () => {
      state.projects.splice(Number(b.dataset.del), 1); renderProjects();
    });
    $$('#pnProjects [data-i]').forEach((row) => {
      const i = Number(row.dataset.i);
      row.querySelectorAll('[data-f]').forEach((inp) => {
        inp.oninput = () => { state.projects[i][inp.dataset.f] = inp.value; };
      });
    });
  }

  function renderSocials() {
    $('#pnSocials').innerHTML = state.socials.map((s, i) =>
      '<div class="row" style="gap:8px;flex-wrap:wrap" data-i="' + i + '">' +
        '<input class="input input-sm" data-f="icon" value="' + esc(s.icon || '🔗') + '" maxlength="4" style="flex:0 0 64px;text-align:center">' +
        '<input class="input input-sm" data-f="label" value="' + esc(s.label || '') + '" placeholder="名称" style="flex:0 0 140px">' +
        '<input class="input input-sm grow" data-f="url" value="' + esc(s.url || '') + '" placeholder="https://" style="min-width:200px">' +
        '<button class="btn btn-sm btn-ghost" data-del="' + i + '">' + icon('trash') + '</button>' +
      '</div>').join('') || '<p class="muted small mb-0">暂无链接，点击右上角添加。</p>';

    $$('#pnSocials [data-del]').forEach((b) => b.onclick = () => {
      state.socials.splice(Number(b.dataset.del), 1); renderSocials();
    });
    $$('#pnSocials [data-i]').forEach((row) => {
      const i = Number(row.dataset.i);
      row.querySelectorAll('[data-f]').forEach((inp) => {
        inp.oninput = () => { state.socials[i][inp.dataset.f] = inp.value; };
      });
    });
  }

  function renderContributors() {
    $('#contribEditor').innerHTML = state.contributors.map((c, i) =>
      '<div class="row" style="gap:8px;flex-wrap:wrap" data-i="' + i + '">' +
        '<input class="input input-sm" data-f="name" value="' + esc(c.name || '') + '" placeholder="名称" style="flex:0 0 150px">' +
        '<input class="input input-sm grow" data-f="url" value="' + esc(c.url || '') + '" placeholder="用户主页链接（本网站/GitHub/QQ）" style="min-width:200px">' +
        '<input class="input input-sm" data-f="role" value="' + esc(c.role || '') + '" placeholder="角色/贡献" style="flex:0 0 150px">' +
        '<input class="input input-sm grow" data-f="note" value="' + esc(c.note || '') + '" placeholder="备注（可选）" style="min-width:160px">' +
        '<button class="btn btn-sm btn-ghost" data-del="' + i + '">' + icon('trash') + '</button>' +
      '</div>').join('') || '<p class="muted small mb-0">暂无贡献者，点击右上角添加。</p>';

    $$('#contribEditor [data-del]').forEach((b) => b.onclick = () => {
      state.contributors.splice(Number(b.dataset.del), 1); renderContributors();
    });
    $$('#contribEditor [data-i]').forEach((row) => {
      const i = Number(row.dataset.i);
      row.querySelectorAll('[data-f]').forEach((inp) => {
        inp.oninput = () => { state.contributors[i][inp.dataset.f] = inp.value; };
      });
    });
  }

  function renderAnnouncements() {
    $('#annEditor').innerHTML = state.announcements.map((a, i) =>
      '<div class="card card-pad" data-i="' + i + '" style="border:1px solid var(--border)">' +
        '<div class="row-between mb-2"><label class="label mb-0">公告 #' + (i + 1) + '</label>' +
          '<div class="row" style="gap:6px"><label class="switch-row" style="margin:0"><span class="sr-title small">置顶</span>' +
          '<span class="switch"><input type="checkbox" data-f="pinned"' + (a.pinned ? ' checked' : '') + '><span class="track"></span></span></label>' +
          '<button class="btn btn-sm btn-ghost" data-del="' + i + '">' + icon('trash') + '</button></div></div>' +
        '<input class="input input-sm mb-2" data-f="title" value="' + esc(a.title || '') + '" placeholder="公告标题">' +
        '<textarea class="textarea input-sm mb-0" data-f="body" rows="3" placeholder="公告内容">' + esc(a.body || '') + '</textarea>' +
      '</div>').join('') || '<p class="muted small mb-0">暂无公告，点击右上角发布。</p>';

    $$('#annEditor [data-del]').forEach((b) => b.onclick = () => {
      state.announcements.splice(Number(b.dataset.del), 1); renderAnnouncements();
    });
    $$('#annEditor [data-i]').forEach((card) => {
      const i = Number(card.dataset.i);
      card.querySelectorAll('[data-f]').forEach((inp) => {
        inp.oninput = () => { state.announcements[i][inp.dataset.f] = (inp.type === 'checkbox' ? inp.checked : inp.value); };
        if (inp.type === 'checkbox') inp.onchange = inp.oninput;
      });
    });
  }

  async function saveSiteConfig(btn) {
    const payload = {
      siteTitle: $('#stTitle').value.trim(),
      siteSubtitle: $('#stSubtitle').value.trim(),
      logo: $('#stLogo').value.trim(),
      favicon: $('#stFavicon').value.trim(),
      accent: $('#stAccent').value,
      themeDefault: $('#stTheme').value,
      landingMode: $('#stLanding').value,
      loginBackground: $('#stLoginBg').value.trim(),
      loginBackgroundBlur: Number($('#stLoginBlur').value) || 0,
      announcement: $('#stAnnouncement').value.trim(),
      footerText: $('#stFooter').value,
      footerAlign: $('#stFooterAlign').value || 'left',
      about: $('#stAbout').value,
      seo: { description: $('#stSeoDesc').value.trim(), keywords: $('#stSeoKw').value.trim() },
      links: {
        discord: $('#stDiscord').value.trim(),
        discordAvatar: state.discordAvatar || '',
        github: $('#stGithub').value.trim(),
        telegram: $('#stTelegram').value.trim(),
        download: $('#stDownload').value.trim(),
        githubDownload: $('#stGithubDownload').value.trim(),
      },
      contributors: state.contributors.filter((x) => x.name || x.url),
      announcements: state.announcements.filter((x) => x.title || x.body),
      turnstile: {
        enabled: $('#tsEnabled').checked,
        siteKey: $('#tsSiteKey').value.trim(),
        secret: $('#tsSecret').value,
      },
      mail: {
        provider: $('#mailProvider').value,
        from: $('#mailFrom').value.trim(),
        apiUrl: $('#mailApiUrl').value.trim(),
        apiToken: $('#mailApiToken').value,
      },
      oauth: {
        github: {
          clientId: $('#oauthGithubId').value.trim(),
          clientSecret: $('#oauthGithubSecret').value,
        },
        discord: {
          clientId: $('#oauthDiscordId').value.trim(),
          clientSecret: $('#oauthDiscordSecret').value,
        },
        cloudflare: {
          clientId: $('#oauthCfId').value.trim(),
          clientSecret: $('#oauthCfSecret').value,
        },
      },
      personal: {
        displayName: $('#pnName').value.trim(),
        tagline: $('#pnTagline').value.trim(),
        avatar: $('#pnAvatar').value.trim(),
        bio: $('#pnBio').value.trim(),
        skills: $('#pnSkills').value.split(',').map((s) => s.trim()).filter(Boolean),
        projects: state.projects.filter((p) => p.name),
        socials: state.socials.filter((s) => s.label || s.url),
      },
      contact: {
        enabled: $('#contactEnabled').checked,
        type: $('#contactType').value,
        value: $('#contactValue').value.trim(),
        note: $('#contactNote').value.trim(),
      },
      feedback: {
        markdown: ($('#fbMarkdown') ? $('#fbMarkdown').value : '') || '',
        email: ($('#fbEmail') ? $('#fbEmail').value : '').trim(),
        officialUsername: ($('#fbOfficialUsername') ? $('#fbOfficialUsername').value : '').trim(),
      },
      theme: {
        primary: $('#stAccent').value,
        accent: $('#stAccent').value,
        radius: Number($('#stRadius').value) || 12,
        font: $('#stFont').value.trim(),
      },
      allowExternalEmoji: $('#stAllowEmoji').checked,
      tips: state.tips || [],
    };
    $$('#stSwitches [data-cfg]').forEach((inp) => { payload[inp.dataset.cfg] = inp.checked; });

    if (!payload.footerText.trim()) {
      toast.warn('页脚版权文本不能为空');
      return;
    }
    busy(btn, true);
    try {
      const d = await API.Admin.saveConfig(payload);
      state.cfg = d.config;
      try { sessionStorage.removeItem('mo_meta'); } catch (e) { /* ignore */ }
      await App.Site.load(true);
      App.renderFooter();
      toast.success(T('settings.saved', '已保存'));
    } catch (e) { toastError(e); } finally { busy(btn, false); }
  }

  /* 查看用户提交的反馈（管理层） */
  async function viewFeedbackList() {
    const body = App.el('div');
    body.innerHTML = '<p class="muted small">加载中…</p>';
    App.modal({ title: '收到的反馈', body, footer: false, size: 'lg' });
    try {
      const d = await API.Feedback.list();
      const list = d.feedback || [];
      if (!list.length) { body.innerHTML = '<p class="muted">暂无反馈。</p>'; return; }
      body.innerHTML = list.map((r) => {
        const who = r.anonymous ? '匿名' : (r.user ? esc(r.user.name + ' (@' + r.user.username + ')') : '匿名');
        const type = { bug: '问题', suggest: '建议', other: '其他' }[r.type] || r.type;
        return '<div class="fb-item">' +
          '<div class="fb-head"><span class="badge badge-soft">' + esc(type) + '</span>' +
          '<span class="small muted">' + who + ' · ' + esc(I18N.formatDate(r.createdAt, 'full')) + '</span>' +
          (r.contact ? '<span class="small muted"> · 联系方式：' + esc(r.contact) + '</span>' : '') + '</div>' +
          '<div class="fb-msg">' + esc(r.message) + '</div></div>';
      }).join('');
    } catch (e) {
      body.innerHTML = '<p class="muted">加载失败：' + esc(e.message || e) + '</p>';
    }
  }

  /* ========================================================================
   * 8.5 审核日志（仅超级管理员）
   * ======================================================================== */

  async function loadAudit() {
    const box = $('#auditBox');
    if (!App.Session.isSuperAdmin) {
      if (box) box.innerHTML = '<p class="muted">仅超级管理员可查看审核日志。</p>';
      return;
    }
    if (box) box.innerHTML = '<p class="muted small mb-0">加载中…</p>';
    let cursor = null;
    try {
      const rows = [];
      for (let i = 0; i < 2; i++) {
        const d = await API.get('/api/admin/audit' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
        const items = (d && d.items) || [];
        rows.push(...items);
        cursor = d && d.cursor;
        if (!cursor || items.length === 0) break;
      }
      if (!rows.length) { if (box) box.innerHTML = '<p class="muted small mb-0">暂无审核记录。</p>'; return; }
      const ACTIONS = {
        'user.ban': '封禁用户', 'user.unban': '解封用户', 'user.mute': '禁言', 'user.unmute': '解除禁言',
        'user.rename': '强制改名', 'user.verifyEmail': '标记邮箱已验证', 'user.forceVerify': '要求验证邮箱',
        'user.forceLogout': '强制下线', 'user.roles': '调整身份组', 'config.update': '更新站点配置',
        'board.create': '创建版块', 'board.update': '编辑版块', 'board.delete': '删除版块',
        'role.create': '创建身份组', 'role.update': '编辑身份组', 'role.delete': '删除身份组',
        'role.assign': '分配身份组', 'ip.ban': '封禁 IP', 'ip.unban': '解封 IP',
      };
      const escAttr = (s) => esc(String(s || ''));
      box.innerHTML = '<div class="table-wrap"><table class="table"><thead><tr>'
        + '<th>时间</th><th>操作者</th><th>动作</th><th>对象</th><th>备注</th></tr></thead><tbody>'
        + rows.map((r) => '<tr>'
          + '<td class="mono small">' + fmt(r.ts) + '</td>'
          + '<td>' + escAttr(r.actorName) + (r.actorIsSuper ? ' <span class="badge badge-ok">超管</span>' : '') + '</td>'
          + '<td>' + (ACTIONS[r.action] || escAttr(r.action)) + '</td>'
          + '<td class="mono small">' + escAttr(r.target) + '</td>'
          + '<td class="muted small">' + escAttr(r.detail) + '</td>'
        + '</tr>').join('')
        + '</tbody></table></div>';
    } catch (e) {
      if (box) box.innerHTML = '<p class="muted">加载失败：' + esc(e && e.message ? e.message : String(e)) + '</p>';
    }
  }

  /* ========================================================================
   * 9. 导航与自定义按钮
   * ==================================================================== */

  const NAV_POSITIONS = [
    ['header', '顶部导航栏'], ['sidebar', '左侧边栏'], ['footer', '页脚'],
    ['landing', '个人主页'], ['user-menu', '用户下拉菜单'],
  ];
  const NAV_VISIBLE = [['all', '所有人'], ['guest', '仅未登录'], ['member', '仅登录用户'], ['admin', '仅管理员']];

  async function loadPushStats() {
    try {
      const d = await API.request('GET', API.BASE + '/api/admin/push/stats');
      if (!d || !d.ok) return;
      $('#vapidDevices').textContent = (d.devices || 0);
      $('#vapidPublic').value = d.publicKey || '';
      const st = $('#vapidState');
      if (d.configured) { st.textContent = T('push.admin.vapidExists'); st.style.color = 'var(--success)'; }
    } catch (e) { /* ignore */ }
  }

  async function loadNav() {
    if (!state.cfg) {
      const d = await API.Admin.getConfig();
      state.cfg = d.config || {};
    }
    state.navLinks = (state.cfg.navLinks || []).slice();
    renderNav();
  }

  function renderNav() {
    const box = $('#navEditor');
    if (!state.navLinks.length) {
      box.innerHTML = App.emptyState('还没有自定义入口', '点击「新增入口」添加第一个导航按钮', 'link');
      return;
    }
    box.innerHTML = state.navLinks.map((l, i) =>
      '<div class="row" style="gap:8px;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid var(--border)" data-i="' + i + '">' +
        '<input class="input input-sm" data-f="icon" value="' + esc(l.icon || '🔗') + '" maxlength="4" style="flex:0 0 60px;text-align:center">' +
        '<input class="input input-sm" data-f="label" value="' + esc(l.label || '') + '" placeholder="按钮文字" style="flex:0 0 130px">' +
        '<input class="input input-sm grow" data-f="url" value="' + esc(l.url || '') + '" placeholder="/path 或 https://" style="min-width:180px">' +
        '<select class="select input-sm" data-f="position" style="flex:0 0 130px">' +
          NAV_POSITIONS.map(([v, t]) => '<option value="' + v + '"' + (l.position === v ? ' selected' : '') + '>' + t + '</option>').join('') +
        '</select>' +
        '<select class="select input-sm" data-f="visibleTo" style="flex:0 0 120px">' +
          NAV_VISIBLE.map(([v, t]) => '<option value="' + v + '"' + (l.visibleTo === v ? ' selected' : '') + '>' + t + '</option>').join('') +
        '</select>' +
        '<select class="select input-sm" data-f="target" style="flex:0 0 100px">' +
          '<option value="_self"' + (l.target === '_self' ? ' selected' : '') + '>当前页</option>' +
          '<option value="_blank"' + (l.target !== '_self' ? ' selected' : '') + '>新窗口</option>' +
        '</select>' +
        '<input class="input input-sm mono" data-f="order" type="number" value="' + (l.order || 0) + '" style="flex:0 0 76px" title="排序">' +
        '<button class="btn btn-sm btn-ghost" data-del="' + i + '">' + icon('trash') + '</button>' +
      '</div>').join('');

    $$('#navEditor [data-del]').forEach((b) => b.onclick = () => {
      state.navLinks.splice(Number(b.dataset.del), 1); renderNav();
    });
    $$('#navEditor [data-i]').forEach((row) => {
      const i = Number(row.dataset.i);
      row.querySelectorAll('[data-f]').forEach((inp) => {
        const ev = inp.tagName === 'SELECT' ? 'change' : 'input';
        inp.addEventListener(ev, () => {
          state.navLinks[i][inp.dataset.f] = inp.dataset.f === 'order' ? Number(inp.value) || 0 : inp.value;
        });
      });
    });
  }

  async function saveNav(btn) {
    busy(btn, true);
    try {
      const links = state.navLinks.filter((l) => (l.label || '').trim() && (l.url || '').trim());
      const d = await API.Admin.saveConfig({ navLinks: links });
      state.cfg = d.config;
      state.navLinks = (d.config.navLinks || []).slice();
      try { sessionStorage.removeItem('mo_meta'); } catch (e) { /* ignore */ }
      await App.Site.load(true);
      App.renderNavbar('admin');
      App.renderFooter();
      renderNav();
      toast.success(T('settings.saved', '已保存'));
    } catch (e) { toastError(e); } finally { busy(btn, false); }
  }

  /* ========================================================================
   * 10. IP 封禁
   * ==================================================================== */

  async function loadIpBans() {
    const tb = $('#ipRows');
    skeletonRows(tb, 5, 3);
    const d = await API.Admin.ipBans();
    const list = d.items || [];
    if (!list.length) {
      tableMessage(tb, 5, App.emptyState('没有被封禁的 IP', '一切正常', 'shield'));
      return;
    }
    tb.innerHTML = list.map((b) =>
      '<tr data-ip="' + esc(b.ip) + '">' +
        '<td><code class="mono">' + esc(b.ip) + '</code></td>' +
        '<td><span class="small">' + esc(b.reason || '—') + '</span></td>' +
        '<td><span class="small muted">' + (b.until ? esc(fmt(b.until)) : '永久') + '</span></td>' +
        '<td><span class="small muted">' + esc(b.byName || b.by || '—') + '</span></td>' +
        '<td class="td-actions"><button class="btn btn-sm btn-soft" data-act="unban">解封</button></td>' +
      '</tr>').join('');

    tb.querySelectorAll('[data-act="unban"]').forEach((b) => {
      b.onclick = async () => {
        const ip = b.closest('tr').dataset.ip;
        if (!(await confirmDialog('确认解封 ' + ip + '？'))) return;
        busy(b, true);
        try { await API.Admin.unbanIP(ip); toast.success('已解封'); await loadIpBans(); }
        catch (e) { toastError(e); } finally { busy(b, false); }
      };
    });
  }

  function ipBanDialog() {
    const body = el('div');
    body.innerHTML =
      '<div class="field"><label class="label">IP 地址</label>' +
        '<input class="input mono" id="ibIp" placeholder="1.2.3.4 或 2001:db8::1"></div>' +
      '<div class="field"><label class="label">封禁原因</label>' +
        '<input class="input" id="ibReason" maxlength="200" placeholder="例如：批量注册"></div>' +
      '<div class="field"><label class="label">封禁天数（留空为永久）</label>' +
        '<input class="input mono" id="ibDays" type="number" min="1" placeholder="7"></div>';
    modal({
      title: '新增 IP 封禁', body, danger: true, okText: '确认封禁',
      onOk: async () => {
        const ip = $('#ibIp', body).value.trim();
        if (!ip) { toast.warn('请输入 IP'); return false; }
        await API.Admin.banIP({ ip, reason: $('#ibReason', body).value.trim(), days: Number($('#ibDays', body).value) || 0 });
        toast.success('已封禁 ' + ip);
        await loadIpBans();
      },
    });
  }

  /* ========================================================================
   * 11. 访问日志
   * ==================================================================== */

  async function loadLogs(reset) {
    const box = $('#logBox');
    if (state.logs.loading) return;
    state.logs.loading = true;
    try {
      if (reset) { state.logs.items = []; state.logs.cursor = null; box.innerHTML = App.skeletonList(1, 240); }
      const d = await API.Admin.logs({
        limit: 200, cursor: state.logs.cursor,
        ip: $('#lgIp').value.trim(), path: $('#lgPath').value.trim(),
      });
      state.logs.items = state.logs.items.concat(d.items || []);
      state.logs.cursor = d.cursor || null;
      renderLogs();
    } finally { state.logs.loading = false; }
  }

  function renderLogs() {
    const box = $('#logBox');
    const list = state.logs.items;
    if (!list.length) {
      box.innerHTML = App.emptyState('没有日志记录', '换个过滤条件，或等待新的请求进来', 'activity');
      $('#btnMoreLogs').hidden = true;
      return;
    }
    box.innerHTML = list.map((l) => {
      const st = Number(l.status) || 0;
      return '<div class="log-line">' +
        '<span class="lg-time">' + esc(fmt(l.t, 'time')) + '</span>' +
        '<span class="lg-method">' + esc(l.method || 'GET') + '</span>' +
        '<span class="lg-status s' + String(st).charAt(0) + '">' + (st || '—') + '</span>' +
        '<span class="lg-path" title="' + esc(l.path || '') + '">' + esc(l.path || '') + '</span>' +
        '<span class="lg-time">' + esc(l.ip || '') + '</span>' +
        (l.ms != null ? '<span class="lg-time">' + l.ms + 'ms</span>' : '') +
        (l.uname ? '<span class="lg-time">@' + esc(l.uname) + '</span>' : '') +
      '</div>';
    }).join('');

    const more = $('#btnMoreLogs');
    more.hidden = !state.logs.cursor;
    more.onclick = async () => {
      busy(more, true);
      try { await loadLogs(false); } catch (e) { toastError(e); } finally { busy(more, false); }
    };
  }

  /* ========================================================================
   * 12. 邮件系统
   * ==================================================================== */

  async function sendSingleMail(btn) {
    const to = $('#mlTo').value.trim();
    const subject = $('#mlSubject').value.trim();
    const html = $('#mlBody').value;
    if (!to || !subject || !html.trim()) { toast.warn('收件人、主题、正文都不能为空'); return; }
    busy(btn, true);
    try {
      await API.Admin.sendMail({ to, subject, html, raw: $('#mlRaw').checked });
      toast.success('邮件已提交发送');
      $('#mlBody').value = '';
    } catch (e) { toastError(e); } finally { busy(btn, false); }
  }

  async function broadcastMail(btn) {
    const subject = $('#bcSubject').value.trim();
    const html = $('#bcBody').value;
    if (!subject || !html.trim()) { toast.warn('主题与正文不能为空'); return; }
    if (!(await confirmTyped('这将向全站所有已验证邮箱的用户群发邮件，操作不可撤销。', 'BROADCAST'))) return;
    busy(btn, true);
    $('#bcResult').textContent = '发送中，请勿关闭页面…';
    try {
      const d = await API.Admin.broadcast({
        subject, html, text: $('#bcText').value.trim(), alsoNotify: $('#bcNotify').checked,
      });
      $('#bcResult').textContent = '完成：成功 ' + num(d.sent) + ' 封，跳过 ' + num(d.skipped) + ' 封，扫描用户 ' + num(d.total) + ' 人。';
      toast.success('群发完成');
    } catch (e) {
      $('#bcResult').textContent = '发送失败：' + (e.message || '未知错误');
      toastError(e);
    } finally { busy(btn, false); }
  }

  /* ========================================================================
   * 13. 机器人
   * ==================================================================== */

  let permCatalog = null;
  async function getPermCatalog() {
    if (!permCatalog) permCatalog = (await API.Roles.catalog()).permissions || [];
    return permCatalog;
  }

  async function loadBots() {
    $('#botBase').textContent = API.BASE + '/api/bot';
    $('#botCurl').textContent = 'curl -H "X-Bot-Token: <TOKEN>" ' + API.BASE + '/api/bot/me';
    $('#btnCopyCurl').innerHTML = icon('copy') || icon('file');

    const tb = $('#botRows');
    skeletonRows(tb, 6, 3);
    const d = await API.Admin.bots();
    const list = d.items || [];
    if (!list.length) {
      tableMessage(tb, 6, App.emptyState('还没有机器人', '创建一个令牌，让 Discord 机器人接入社区', 'bot'));
      return;
    }
    tb.innerHTML = list.map((b) =>
      '<tr data-bid="' + esc(b.id) + '">' +
        '<td><div style="font-weight:620">' + esc(b.name) + '</div>' +
          (b.description ? '<div class="small muted">' + esc(b.description) + '</div>' : '') + '</td>' +
        '<td><code class="mono small">' + esc(b.tokenHint || '—') + '</code></td>' +
        '<td><span class="small muted">' + ((b.scopes || []).length) + ' 项权限</span></td>' +
        '<td><code class="mono small">' + esc(b.boundScope || 'global') + '</code></td>' +
        '<td><span class="mono small">' + num(b.calls || 0) + '</span></td>' +
        '<td class="td-actions">' +
          '<button class="btn btn-sm btn-ghost" data-act="perms">权限</button>' +
          '<button class="btn btn-sm btn-danger" data-act="del">删除</button>' +
        '</td></tr>').join('');

    tb.querySelectorAll('[data-act="del"]').forEach((b) => {
      b.onclick = async () => {
        const id = b.closest('tr').dataset.bid;
        if (!(await confirmDialog('删除后该令牌立即失效，确认继续？', { danger: true }))) return;
        busy(b, true);
        try { await API.Admin.removeBot(id); toast.success('已删除'); await loadBots(); }
        catch (e) { toastError(e); } finally { busy(b, false); }
      };
    });
    tb.querySelectorAll('[data-act="perms"]').forEach((b) => {
      b.onclick = () => {
        const bot = list.find((x) => x.id === b.closest('tr').dataset.bid);
        modal({
          title: bot.name + ' 的权限', footer: false, size: 'lg',
          body: '<div class="chip-row">' + ((bot.scopes || []).map((s) =>
            '<span class="chip mono">' + esc(s) + '</span>').join('') || '<span class="muted small">未授予任何权限</span>') + '</div>',
        });
      };
    });
  }

  async function newBotDialog() {
    const catalog = await getPermCatalog();
    const body = el('div');
    body.innerHTML =
      '<div class="row" style="gap:12px;flex-wrap:wrap">' +
        '<div class="field grow" style="min-width:180px"><label class="label">机器人名称</label>' +
          '<input class="input" id="nbName" maxlength="40" placeholder="Discord Bridge"></div>' +
        '<div class="field grow" style="min-width:180px"><label class="label">绑定作用域</label>' +
          '<input class="input mono" id="nbScope" value="global" placeholder="global / channel:ID"></div>' +
      '</div>' +
      '<div class="field"><label class="label">用途说明</label>' +
        '<input class="input" id="nbDesc" maxlength="200" placeholder="用于把 Discord 消息同步到社区"></div>' +
      '<div class="row-between mb-2"><label class="label mb-0">授权范围</label>' +
        '<button class="btn btn-sm btn-ghost" id="nbNone" type="button">清空</button></div>' +
      '<div class="perm-grid" id="nbPerms" style="max-height:300px;overflow:auto">' +
        catalog.map((p) => {
          const on = ['post.create', 'comment.create'].includes(p.key);
          return '<label class="perm-item' + (on ? ' checked' : '') + '" data-pk="' + esc(p.key) + '">' +
            '<input type="checkbox" class="check"' + (on ? ' checked' : '') + '>' +
            '<span><span class="pi-label">' + esc(p.label) + '</span><br>' +
            '<span class="pi-key">' + esc(p.key) + '</span></span></label>';
        }).join('') +
      '</div>';

    body.querySelectorAll('.perm-item').forEach((it) => {
      const cb = it.querySelector('input');
      cb.addEventListener('change', () => it.classList.toggle('checked', cb.checked));
    });
    $('#nbNone', body).onclick = () => body.querySelectorAll('.perm-item').forEach((it) => {
      it.querySelector('input').checked = false; it.classList.remove('checked');
    });

    modal({
      title: '创建机器人', body, size: 'lg', okText: T('common.create', '创建'),
      onOk: async () => {
        const name = $('#nbName', body).value.trim();
        if (!name) { toast.warn('请输入机器人名称'); return false; }
        const scopes = Array.from(body.querySelectorAll('.perm-item'))
          .filter((it) => it.querySelector('input').checked).map((it) => it.dataset.pk);
        const d = await API.Admin.createBot({
          name, description: $('#nbDesc', body).value.trim(),
          boundScope: $('#nbScope', body).value.trim() || 'global', scopes,
        });
        await loadBots();
        showBotToken(d.token);
      },
    });
  }

  function showBotToken(token) {
    const body = el('div');
    body.innerHTML =
      '<div class="banner-tip" style="background:var(--warn-soft);color:var(--warn)">' + icon('alert') +
        '<span>令牌只显示这一次，请立即复制并妥善保存。丢失后只能删除重建。</span></div>' +
      '<div class="copy-box mt-4"><code id="btkVal">' + esc(token) + '</code>' +
        '<button class="icon-btn" id="btkCopy" aria-label="copy">' + icon('copy') + '</button></div>' +
      '<p class="hint mt-2">请求时通过请求头传递：<code class="mono">X-Bot-Token: ' + esc(token.slice(0, 14)) + '…</code></p>';
    modal({ title: '机器人令牌', body, footer: false, size: 'lg' });
    $('#btkCopy', body).onclick = async () => {
      if (await App.copy(token)) toast.success('已复制到剪贴板');
      else toast.warn('复制失败，请手动选择文本');
    };
  }

  /* ========================================================================
   * 14. Cloudflare 面板
   * ==================================================================== */

  async function loadCloudflare() {
    const box = $('#cfStatus');
    box.innerHTML = '<p class="muted small mb-0">加载中…</p>';
    try {
      const d = await API.Admin.cfStatus();
      if (!d.configured) {
        box.innerHTML = '<div class="banner-tip" style="background:var(--warn-soft);color:var(--warn)">' + icon('alert') +
          '<span>Worker 尚未配置 <code class="mono">CF_API_TOKEN</code>，Cloudflare 面板不可用。</span></div>';
        return;
      }
      const z = d.zone;
      box.innerHTML = kvRows([
        ['API Token', '已配置'],
        ['Account ID', d.accountId || '—', true],
        ['Zone 名称', (z && z.name) || '—'],
        ['Zone ID', (z && z.id) || '—', true],
        ['状态', (z && z.status) || '—'],
        ['套餐', (z && z.plan && z.plan.name) || '—'],
        ['开发模式', z && z.development_mode > 0 ? '开启（剩余 ' + z.development_mode + ' 秒）' : '关闭'],
        ['Name Servers', ((z && z.name_servers) || []).join(', ') || '—', true],
      ]);
    } catch (e) {
      box.innerHTML = '<p class="small" style="color:var(--danger);margin:0">' + esc(e.message || '加载失败') + '</p>';
    }
  }

  /* ========================================================================
   * 14b. 官方账号配置（超管）
   * ==================================================================== */

  async function loadOfficial() {
    const info = $('#officialInfoBox');
    const badge = $('#officialStateBadge');
    if (!App.Session.isSuperAdmin) {
      info.innerHTML = '<p class="small" style="color:var(--danger);margin:0">仅超级管理员可访问此面板。</p>';
      return;
    }
    try {
      const d = await API.Official.account();
      state.officialExists = !!d.exists;
      if (d.exists && d.account) {
        const a = d.account;
        badge.innerHTML = '<span class="badge badge-accent">已创建</span>';
        info.innerHTML = kvRows([
          ['显示名称', esc(a.displayName || a.username || '')],
          ['Email', esc(a.email || '')],
          ['创建时间', fmt(a.createdAt)],
          ['最后登录', fmt(a.lastLoginAt)],
          ['徽章', (a.badges && a.badges.length) ? esc(a.badges.map((b) => b.name).join(', ')) : '—'],
          ['受保护', a.protected ? '是（不可封禁/删除）' : '否'],
          ['来源', d.seededByEnv ? '环境变量播种' : '后台创建'],
        ]);
        $('#ofUsername').value = a.username || '';
        $('#ofEmail').value = a.email || '';
        $('#ofDisplayName').value = a.displayName || '';
        $('#ofAvatar').value = a.avatar || '';
        $('#ofBio').value = a.bio || '';
        renderOfficialAvatarPreview(a.avatar);
      } else {
        badge.innerHTML = '<span class="badge">未创建</span>';
        const def = d.defaults && d.defaults.username
          ? ' 默认用户名：<code class="mono">' + esc(d.defaults.username) + '</code>'
          : '';
        info.innerHTML = '<div class="banner-tip" style="background:var(--accent-soft);color:var(--accent)">' + icon('info') +
          '<span>' + T('admin.official.none') + '。' + def + '</span></div>';
        $('#ofUsername').value = (d.defaults && d.defaults.username) || '';
        $('#ofEmail').value = '';
        $('#ofDisplayName').value = '';
        $('#ofAvatar').value = '';
        $('#ofBio').value = '';
        renderOfficialAvatarPreview('');
      }
      $('#ofPassword').value = '';
      initOfficialAvatarUpload();
    } catch (e) {
      info.innerHTML = '<p class="small" style="color:var(--danger);margin:0">' + esc(e.message || '加载失败') + '</p>';
    }
  }

  function renderOfficialAvatarPreview(url) {
    const box = $('#ofAvatarPreview');
    if (!box) return;
    if (url) {
      box.innerHTML = App.avatar({ avatar: url, displayName: 'Official' }, 'sm', { official: true });
    } else {
      box.innerHTML = '<span class="avatar avatar-sm" style="background:var(--surface-3);color:var(--text-3)">?</span>';
    }
  }

  function initOfficialAvatarUpload() {
    const zone = $('#ofAvatarUpload');
    if (!zone || zone.dataset.bound) return;
    zone.dataset.bound = '1';
    // 走裁剪流程：输出 320×320 WebP（远小于 2MB 头像上限），且用 image kind 上传，
    // 既不会触发「文件过大」失败，也不会覆盖超管自己的头像。
    const onPicked = (f) => App.cropAvatar(f, async (url) => {
      $('#ofAvatar').value = url;
      renderOfficialAvatarPreview(url);
      // 官方账号已存在时，上传后立即持久化头像，避免「传了但没点保存」的困惑
      if (state.officialExists) {
        try { await API.Official.saveAccount({ avatar: url }); toast.success(T('admin.official.avatarSaved') || '头像已更新'); }
        catch (e) { toastError(e); }
      }
    }, { kind: 'image' });
    const input = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    zone.appendChild(input);
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('dragover'); if (e.dataTransfer.files[0]) onPicked(e.dataTransfer.files[0]); });
    input.addEventListener('change', () => { if (input.files[0]) onPicked(input.files[0]); input.value = ''; });
  }

  function showInitialPassword(pwd) {
    const body = el('div');
    body.innerHTML =
      '<p class="muted mb-2">' + T('admin.official.pwdOnce') + '</p>' +
      '<div class="input mono" style="font-size:18px;letter-spacing:1px;user-select:all;text-align:center;background:var(--surface-3);padding:12px;border-radius:8px">' + esc(pwd) + '</div>' +
      '<p class="small muted2 mt-2">请立即复制保存。出于安全考虑，该密码不会再次显示；忘记可在本面板重新生成。</p>';
    modal({ title: T('admin.official.account'), body, size: 'sm', footer: false });
  }

  async function saveOfficial(btn) {
    const username = $('#ofUsername').value.trim();
    const email = $('#ofEmail').value.trim();
    if (!username) { toast.warn('用户名不能为空'); return; }
    if (!email) { toast.warn('邮箱不能为空'); return; }
    const payload = {
      username, email,
      displayName: $('#ofDisplayName').value.trim(),
      avatar: $('#ofAvatar').value.trim(),
      bio: $('#ofBio').value.trim(),
    };
    const password = $('#ofPassword').value;
    if (password) payload.password = password;
    busy(btn, true);
    try {
      const res = await API.Official.saveAccount(payload);
      state.officialExists = true;
      const ip = res && res.initialPassword;
      if (ip) showInitialPassword(ip); else toast.success(T('common.saved'));
      await loadOfficial();
    } catch (e) { toastError(e); }
    finally { busy(btn, false); }
  }

  async function resetOfficialPassword() {
    if (!(await confirmDialog('将为官方账号生成新的随机密码，旧密码立即失效。继续？', { danger: true }))) return;
    busy($('#btnResetOfficialPwd'), true);
    try {
      const res = await API.Official.saveAccount({ resetPassword: true });
      const ip = res && res.initialPassword;
      if (ip) showInitialPassword(ip); else toast.success(T('common.saved'));
      await loadOfficial();
    } catch (e) { toastError(e); }
    finally { busy($('#btnResetOfficialPwd'), false); }
  }

  async function cfPurge(btn) {
    const files = $('#cfFiles').value.split('\n').map((s) => s.trim()).filter(Boolean);
    const msg = files.length ? '将清理 ' + files.length + ' 个 URL 的缓存。' : '将清空整个 Zone 的全部缓存，可能造成短时回源压力。';
    if (!(await confirmDialog(msg + ' 确认继续？', { danger: true }))) return;
    busy(btn, true);
    try { await API.Admin.cfPurge(files.length ? { files } : {}); toast.success('缓存清理指令已提交'); }
    catch (e) { toastError(e); } finally { busy(btn, false); }
  }

  async function cfAnalytics(btn) {
    busy(btn, true);
    try {
      const d = await API.Admin.cfAnalytics();
      const a = d.analytics;
      if (!a) { $('#cfAnalytics').innerHTML = '<p class="muted small mb-0">该套餐不提供 Analytics 数据。</p>'; return; }
      $('#cfAnalytics').innerHTML = kvRows([
        ['请求总数', num(a.requests && a.requests.all)],
        ['缓存命中', num(a.requests && a.requests.cached)],
        ['流量 (字节)', num(a.bandwidth && a.bandwidth.all)],
        ['独立访客', num(a.uniques && a.uniques.all)],
        ['威胁拦截', num(a.threats && a.threats.all)],
      ]);
    } catch (e) { toastError(e); } finally { busy(btn, false); }
  }

  async function cfDnsList(btn) {
    const tb = $('#cfDnsRows');
    if (btn) busy(btn, true);
    skeletonRows(tb, 5, 3);
    try {
      const d = await API.Admin.cfDns({ action: 'list' });
      const list = d.records || [];
      if (!list.length) { tableMessage(tb, 5, App.emptyState('没有 DNS 记录', '', 'globe')); return; }
      tb.innerHTML = list.map((r) =>
        '<tr>' +
          '<td><span class="badge">' + esc(r.type) + '</span></td>' +
          '<td><span class="mono small">' + esc(r.name) + '</span></td>' +
          '<td><span class="mono small">' + esc(r.content) + '</span></td>' +
          '<td>' + (r.proxied ? '<span class="badge badge-accent">已代理</span>' : '<span class="badge">仅 DNS</span>') + '</td>' +
          '<td><span class="small muted">' + (r.ttl === 1 ? 'Auto' : r.ttl) + '</span></td>' +
        '</tr>').join('');
    } catch (e) {
      tableMessage(tb, 5, '<p class="small" style="color:var(--danger);text-align:center;margin:0">' + esc(e.message) + '</p>');
    } finally { if (btn) busy(btn, false); }
  }

  function cfDnsDialog() {
    const body = el('div');
    body.innerHTML =
      '<div class="row" style="gap:12px;flex-wrap:wrap">' +
        '<div class="field" style="flex:0 0 110px"><label class="label">类型</label>' +
          '<select class="select" id="dnType">' +
            ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS'].map((t) => '<option>' + t + '</option>').join('') +
          '</select></div>' +
        '<div class="field grow" style="min-width:160px"><label class="label">名称</label>' +
          '<input class="input mono" id="dnName" placeholder="api 或 @"></div>' +
      '</div>' +
      '<div class="field"><label class="label">内容</label>' +
        '<input class="input mono" id="dnContent" placeholder="1.2.3.4 / target.example.com"></div>' +
      '<div class="row" style="gap:12px;flex-wrap:wrap">' +
        '<div class="field" style="flex:0 0 140px"><label class="label">TTL</label>' +
          '<input class="input mono" id="dnTtl" type="number" value="1"><div class="hint">1 表示 Auto</div></div>' +
        '<label class="switch-row grow" style="border:none">' +
          '<span class="sr-title">开启 Cloudflare 代理</span>' +
          '<span class="switch"><input type="checkbox" id="dnProxied" checked><span class="track"></span></span>' +
        '</label>' +
      '</div>';
    modal({
      title: '新增 DNS 记录', body, okText: T('common.create', '创建'),
      onOk: async () => {
        const name = $('#dnName', body).value.trim();
        const content = $('#dnContent', body).value.trim();
        if (!name || !content) { toast.warn('名称与内容不能为空'); return false; }
        await API.Admin.cfDns({
          action: 'create', type: $('#dnType', body).value, name, content,
          proxied: $('#dnProxied', body).checked, ttl: Number($('#dnTtl', body).value) || 1,
        });
        toast.success('DNS 记录已创建');
        await cfDnsList();
      },
    });
  }

  /* ========================================================================
   * 15. 事件绑定与启动
   * ==================================================================== */

  function bindEvents() {
    // 总览
    const rb = $('#btnRefreshOverview');
    if (rb) rb.onclick = async () => { busy(rb, true); try { await loadOverview(); } catch (e) { toastError(e); } finally { busy(rb, false); } };

    // 审核日志刷新
    const rab = $('#btnRefreshAudit');
    if (rab) rab.onclick = async () => { busy(rab, true); try { await loadAudit(); } catch (e) { toastError(e); } finally { busy(rab, false); } };

    // 用户搜索
    const us = $('#usSearch');
    if (us) us.addEventListener('input', App.debounce(async () => {
      state.users.q = us.value.trim();
      try { await loadUsers(true); } catch (e) { toastError(e); }
    }, 400));

    // 内容搜索
    const ps = $('#poSearch');
    if (ps) ps.addEventListener('input', App.debounce(async () => {
      state.posts.q = ps.value.trim();
      try { await loadPosts(true); } catch (e) { toastError(e); }
    }, 400));

    // 用户 / 文章 CSV 导出（基于已加载的表格数据，纯前端生成）
    const exU = $('#btnExportUsers');
    if (exU) exU.onclick = () => exportTableCsv('#usRows', 'users.csv', ['用户', '用户名', '邮箱', '身份组', '注册', '状态']);
    const exP = $('#btnExportPosts');
    if (exP) exP.onclick = () => exportTableCsv('#poRows', 'posts.csv', ['标题', '作者', '作用域', '数据', '发布时间']);

    // 批量创建账号（超管，免邮箱验证）
    const bcBtn = $('#btnBatchCreate');
    if (bcBtn) bcBtn.onclick = async () => {
      const ta = $('#bcAccounts');
      const lines = (ta.value || '').split('\n').map((s) => s.trim()).filter(Boolean);
      if (!lines.length) { $('#bcResult').textContent = '请先填写账号清单'; return; }
      const accounts = [];
      for (const line of lines) {
        const parts = line.includes(',') ? line.split(',') : line.split(/\s+/);
        const username = (parts[0] || '').trim();
        const password = (parts[1] || '').trim();
        const email = (parts[2] || '').trim();
        if (username && password) accounts.push({ username, password, email });
      }
      if (!accounts.length) { $('#bcResult').textContent = '未解析到有效行（格式：用户名,密码[,邮箱]）'; return; }
      if (accounts.length > 200) { $('#bcResult').textContent = '单次最多 200 个，请分批'; return; }
      busy(bcBtn, true);
      $('#bcResult').textContent = '创建中…';
      try {
        const d = await API.post('/api/admin/users/batch-create', { accounts, role: $('#bcRole').value });
        const skipped = (d.skipped || []).length, errs = (d.errors || []).length;
        $('#bcResult').textContent = `成功 ${d.created} 个，跳过 ${skipped} 个，失败 ${errs} 个`;
        const det = $('#bcDetail');
        det.style.display = 'block';
        let html = '';
        if (d.createdList && d.createdList.length) {
          html += '<div class="hint">已创建：' + d.createdList.map((u) => esc(u.username) + (u.email ? ` (${esc(u.email)})` : '')).join('、') + '</div>';
        }
        if (skipped) html += '<div class="hint" style="color:#f97316">跳过：' + d.skipped.map((s) => esc(s.username || '空') + ' — ' + esc(s.reason)).join('；') + '</div>';
        if (errs) html += '<div class="hint" style="color:#ef4444">失败：' + d.errors.map((s) => esc(s.username || '空') + ' — ' + esc(s.reason)).join('；') + '</div>';
        det.innerHTML = html;
        if (d.created) { try { await loadUsers(true); } catch (e) { /* 忽略刷新失败 */ } }
      } catch (e) { $('#bcResult').textContent = '创建失败：' + (e.message || e); }
      finally { busy(bcBtn, false); }
    };
    // 仅超级管理员可见「批量创建账号」卡片（后端已二次拦截）
    if (!App.Session.isSuperAdmin) { const bc = $('#bcCard'); if (bc) bc.remove(); }

    // 封禁公示刷新
    const rbB = $('#btnRefreshBans');
    if (rbB) rbB.onclick = async () => { busy(rbB, true); try { await loadBansPanel(); } catch (e) { toastError(e); } finally { busy(rbB, false); } };

    // 权限组
    const ls = $('#btnLoadScope');
    if (ls) ls.onclick = async () => {
      busy(ls, true);
      state.roles.active = null;
      try { await loadRoles(true); } catch (e) { toastError(e); } finally { busy(ls, false); }
    };
    const nr = $('#btnNewRole');
    if (nr) nr.onclick = newRoleDialog;
    const ncr = $('#btnNewCustomRole');
    if (ncr) ncr.onclick = () => openCustomRoleDialog(null);
    const mri = $('#btnMyRoleIcons');
    if (mri) mri.onclick = openMyRoleIcons;

    // 举报
    const rs = $('#rpStatus');
    if (rs) rs.onchange = () => loadReports().catch(toastError);

    // 站点设置
    const accent = $('#stAccent'), accentHex = $('#stAccentHex');
    if (accent) {
      accent.oninput = () => { accentHex.value = accent.value; App.applyAccent(accent.value); };
      accentHex.oninput = () => {
        if (/^#[0-9a-fA-F]{6}$/.test(accentHex.value)) { accent.value = accentHex.value; App.applyAccent(accentHex.value); }
      };
    }
    // 站点素材上传统一用 image 通道，避免覆盖管理员本人的头像 / 横幅
    if ($('#stLogoZone')) App.uploadZone($('#stLogoZone'), 'image', (url) => { $('#stLogo').value = url; });
    if ($('#stFaviconZone')) App.uploadZone($('#stFaviconZone'), 'image', (url) => { $('#stFavicon').value = url; });
    if ($('#stLoginBgZone')) App.uploadZone($('#stLoginBgZone'), 'image', (url) => { $('#stLoginBg').value = url; });
    if ($('#pnAvatarZone')) App.uploadZone($('#pnAvatarZone'), 'image', (url) => { $('#pnAvatar').value = url; });

    // 主题：圆角 / 字体实时预览 + 小贴士 / 表情管理
    const mt = $('#btnManageTips'); if (mt) mt.onclick = openTipsDialog;
    const me = $('#btnManageEmojis'); if (me) me.onclick = () => openEmojiManager().catch(toastError);
    const radius = $('#stRadius'), font = $('#stFont');
    if (radius) radius.oninput = () => App.applyTheme({ radius: Number(radius.value) || 12, font: (font && font.value.trim()) || '' });
    if (font) font.oninput = () => App.applyTheme({ radius: (radius && Number(radius.value)) || 12, font: font.value.trim() });

    const ap = $('#btnAddProject');
    if (ap) ap.onclick = () => { state.projects.push({ name: '', desc: '', url: '' }); renderProjects(); };
    const as = $('#btnAddSocial');
    if (as) as.onclick = () => { state.socials.push({ icon: '🔗', label: '', url: '' }); renderSocials(); };
    const ac = $('#btnAddContributor');
    if (ac) ac.onclick = () => { state.contributors.push({ name: '', url: '', role: '', note: '' }); renderContributors(); };
    const aa = $('#btnAddAnn');
    if (aa) aa.onclick = () => { state.announcements.push({ id: 'a' + Date.now(), title: '', body: '', pinned: false, createdAt: Date.now() }); renderAnnouncements(); };
    const ss = $('#btnSaveSite');
    if (ss) ss.onclick = () => saveSiteConfig(ss);

    const gv = $('#btnGenVapid');
    if (gv) gv.onclick = async () => {
      const force = await App.confirmDialog('生成新的 VAPID 密钥会导致所有已订阅设备失效，是否继续？', { danger: true, okText: T('common.confirm') });
      if (!force) return;
      busy(gv, true);
      try {
        const d = await API.post(API.BASE + '/api/admin/push/vapid', { force: true });
        $('#vapidPublic').value = d.publicKey || '';
        $('#vapidDevices').textContent = '0';
        $('#vapidState').textContent = d.existed ? T('push.admin.vapidExists') : T('push.admin.vapidGenerated');
        App.toast.success(T('push.admin.vapidGenerated'));
      } catch (e) { App.toastError(e); }
      finally { busy(gv, false); }
    };

    // 导航
    const an = $('#btnAddNav');
    if (an) an.onclick = () => {
      state.navLinks.push({ label: '', url: '', icon: '🔗', position: 'header', visibleTo: 'all', target: '_self', order: 0 });
      renderNav();
    };
    const sn = $('#btnSaveNav');
    if (sn) sn.onclick = () => saveNav(sn);

    // IP 封禁
    const ab = $('#btnAddIpBan');
    if (ab) ab.onclick = ipBanDialog;

    // 日志
    const lb = $('#btnLoadLogs');
    if (lb) lb.onclick = async () => { busy(lb, true); try { await loadLogs(true); } catch (e) { toastError(e); } finally { busy(lb, false); } };
    ['#lgIp', '#lgPath'].forEach((sel) => {
      const n = $(sel);
      if (n) n.addEventListener('keydown', (e) => { if (e.key === 'Enter') lb && lb.click(); });
    });

    // 邮件
    const sm = $('#btnSendMail');
    if (sm) sm.onclick = () => sendSingleMail(sm);
    const bc = $('#btnBroadcast');
    if (bc) bc.onclick = () => broadcastMail(bc);

    // 机器人
    const nb = $('#btnNewBot');
    if (nb) nb.onclick = () => newBotDialog().catch(toastError);
    const cc = $('#btnCopyCurl');
    if (cc) cc.onclick = async () => {
      if (await App.copy($('#botCurl').textContent)) toast.success('已复制');
    };

    // Cloudflare
    const cr = $('#btnCfRefresh');
    if (cr) cr.onclick = () => loadCloudflare();
    const cp = $('#btnCfPurge');
    if (cp) cp.onclick = () => cfPurge(cp);
    const ca = $('#btnCfAnalytics');
    if (ca) ca.onclick = () => cfAnalytics(ca);
    const cl = $('#btnCfDnsList');
    if (cl) cl.onclick = () => cfDnsList(cl);
    const cn = $('#btnCfDnsNew');
    if (cn) cn.onclick = cfDnsDialog;

    // 官方账号
    const so = $('#btnSaveOfficial');
    if (so) so.onclick = () => saveOfficial(so);
    const ro = $('#btnResetOfficialPwd');
    if (ro) ro.onclick = resetOfficialPassword;

    const nbBoard = $('#btnNewBoard');
    if (nbBoard) nbBoard.onclick = () => openBoardEditor(null);

    // 用户批量操作（要求验证邮箱）
    const all = $('#usCheckAll');
    if (all) all.onchange = () => {
      const rows = $$('#usRows .usChk');
      if (all.checked) rows.forEach((cb) => { cb.checked = true; _selUsers.add(cb.dataset.uid); });
      else rows.forEach((cb) => { cb.checked = false; _selUsers.delete(cb.dataset.uid); });
      syncBulkBar();
    };
    const bulkClear = $('#btnBulkClear');
    if (bulkClear) bulkClear.onclick = () => {
      _selUsers.clear();
      $$('#usRows .usChk').forEach((cb) => { cb.checked = false; });
      syncBulkBar();
    };
    const bulkFV = $('#btnBulkForceVerify');
    if (bulkFV) bulkFV.onclick = async () => {
      if (!App.Session.isSuperAdmin) { toastError('仅超级管理员可要求验证'); return; }
      const ids = [..._selUsers];
      if (!ids.length) { toast.warn('请先勾选用户'); return; }
      if (!(await confirmDialog('将向选中的 ' + ids.length + ' 位未验证邮箱的用户发送验证要求，他们（在线立即、离线下次访问）必须验证邮箱后才能继续使用。确认？', { danger: true }))) return;
      busy(bulkFV, true);
      let okN = 0, skip = 0;
      try {
        for (const id of ids) {
          const u = state.users.items.find((x) => x.id === id);
          if (u && u.emailVerified) { skip++; continue; }
          try { await API.Admin.userAction(id, { action: 'forceVerify' }); okN++; } catch (e) { /* 单个失败不影响其余 */ }
        }
        toast.success('已对 ' + okN + ' 位用户发送验证要求' + (skip ? '（跳过 ' + skip + ' 位已验证）' : ''));
        _selUsers.clear(); syncBulkBar();
      } catch (e) { toastError(e); }
      finally { busy(bulkFV, false); }
    };
  }

  /* --------------------------------- 封禁公示 + 导出 ---------------------------------- */

  function csvEscape(v) {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function downloadCsv(filename, csv) {
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** 把已渲染的表格导出为 CSV（跳过表头行与首列勾选框） */
  function exportTableCsv(sel, filename, headers) {
    const rows = Array.prototype.slice.call(document.querySelectorAll(sel + ' tr'));
    if (rows.length <= 1) { toast.warn('暂无可导出的数据，请先加载列表'); return; }
    const lines = [headers.map(csvEscape).join(',')];
    rows.slice(1).forEach((tr) => {
      const cells = Array.prototype.slice.call(tr.querySelectorAll('td')).slice(1);
      if (!cells.length) return;
      lines.push(cells.map((c) => csvEscape(c.textContent.replace(/\s+/g, ' ').trim())).join(','));
    });
    if (lines.length <= 1) { toast.warn('暂无可导出的数据'); return; }
    downloadCsv(filename, lines.join('\n'));
    toast.success('已导出 ' + (lines.length - 1) + ' 行');
  }

  async function loadBansPanel() {
    const uBox = $('#banUserList'); const iBox = $('#banIpList');
    if (!uBox || !iBox) return;
    uBox.innerHTML = '<p class="muted small mb-0">加载中…</p>';
    iBox.innerHTML = '<p class="muted small mb-0">加载中…</p>';
    let d;
    try { d = await API.Admin.bans(); } catch (e) { uBox.innerHTML = '<p class="muted small mb-0">加载失败：' + esc(e.message || e) + '</p>'; return; }
    const users = (d.userBans || []);
    const ips = (d.ipBans || []);
    if (!users.length) uBox.innerHTML = '<p class="muted small mb-0">' + T('admin.noBans', '当前没有封禁记录') + '</p>';
    else uBox.innerHTML = users.map((b) => {
      const u = b.user || {};
      const until = b.until ? new Date(b.until).toLocaleString() : T('bans.permanent', '永久');
      const name = u.displayName || u.username || b.userId || '未知用户';
      return '<div class="kv-row"><div><b>' + esc(name) + '</b>' +
        (b.reason ? ' <span class="muted small">· ' + esc(b.reason) + '</span>' : '') +
        '<div class="muted xsmall">' + T('admin.banUntil', '解封时间') + '：' + esc(until) + '</div></div>' +
        '<button class="btn btn-sm btn-warn" data-unban-user="' + esc(u.id || b.userId || '') + '">' + T('admin.unban', '解封') + '</button></div>';
    }).join('');
    if (!ips.length) iBox.innerHTML = '<p class="muted small mb-0">' + T('admin.noBans', '当前没有封禁记录') + '</p>';
    else iBox.innerHTML = ips.map((b) => {
      const until = b.until ? new Date(b.until).toLocaleString() : T('bans.permanent', '永久');
      return '<div class="kv-row"><div><b class="mono">' + esc(b.ip || '') + '</b>' +
        (b.reason ? ' <span class="muted small">· ' + esc(b.reason) + '</span>' : '') +
        '<div class="muted xsmall">' + T('admin.banUntil', '解封时间') + '：' + esc(until) + '</div></div>' +
        '<button class="btn btn-sm btn-warn" data-unban-ip="' + esc(b.ip || '') + '">' + T('admin.unban', '解封') + '</button></div>';
    }).join('');
    $$('#banUserList [data-unban-user]').forEach((btn) => btn.onclick = async () => {
      const id = btn.dataset.unbanUser; if (!id) return;
      btn.disabled = true;
      try { await API.Admin.userAction(id, { action: 'unban' }); toast.success('已解封'); await loadBansPanel(); }
      catch (e) { toastError(e); btn.disabled = false; }
    });
    $$('#banIpList [data-unban-ip]').forEach((btn) => btn.onclick = async () => {
      const ip = btn.dataset.unbanIp; if (!ip) return;
      btn.disabled = true;
      try { await API.Admin.unbanIP(ip); toast.success('已解封'); await loadBansPanel(); }
      catch (e) { toastError(e); btn.disabled = false; }
    });
  }

  /* --------------------------------- boot ---------------------------------- */

  App.boot({
    nav: 'admin',
    requireAuth: true,
    bootTips: () => (state.tips && state.tips.length ? state.tips : null),
    onReady() {
      const ADMIN_PERMS = ['site.admin', 'site.config', 'site.logs', 'site.mail', 'site.bot', 'site.cloudflare',
        'user.ban', 'user.mute', 'user.rename', 'user.role', 'ip.ban',
        'post.delete.any', 'board.manage', 'role.manage', 'report.handle'];
      if (!ADMIN_PERMS.some((p) => App.Session.can(p))) {
        document.querySelector('.admin-layout').innerHTML =
          '<div style="padding:80px 20px;grid-column:1/-1">' +
          App.emptyState(T('common.forbidden', '无权访问'), '你没有任何后台管理权限', 'lock',
            '<a class="btn btn-primary" href="/home.html">' + T('nav.home', '返回社区') + '</a>') + '</div>';
        return;
      }
      const first = gatePanes();
      bindEvents();
      bindPanes(first || 'overview');
    },
  });

})(window);
