/* ==========================================================================
 * MarytOpens · channel_manage.js
 * 频道管理面板：基本信息 / 板块 / 群组 / 身份组权限矩阵 / 成员 / 举报 / 危险区
 * 依赖：i18n.js api.js app.js
 * ========================================================================== */
(function () {
  'use strict';

  const { $, $$, esc, icon, toast, toastError } = App;
  const T = (k) => I18N.t(k);

  const CHANNEL_ID = new URLSearchParams(location.search).get('id') || '';

  const state = {
    detail: null,        // /api/channels/:id
    boards: [],
    scope: '',           // 当前身份组作用域
    roleData: null,      // /api/roles?scope=
    activeRole: null,
    banner: '',
    memberCursor: null,
    members: [],
  };

  /* ======================= 面板切换 ======================= */

  function bindPanes() {
    $$('.admin-side [data-pane]').forEach((btn) => {
      btn.onclick = () => {
        $$('.admin-side [data-pane]').forEach((b) => b.classList.toggle('active', b === btn));
        $$('.admin-main .tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'pane-' + btn.dataset.pane));
        history.replaceState(null, '', '?id=' + CHANNEL_ID + '&tab=' + btn.dataset.pane);
        onPaneEnter(btn.dataset.pane);
      };
    });
  }

  const paneLoaded = {};
  function onPaneEnter(name) {
    if (paneLoaded[name]) return;
    paneLoaded[name] = true;
    if (name === 'members') loadMembers(true);
    if (name === 'reports') loadReports();
    if (name === 'roles') loadRoles();
  }

  function openPane(name) {
    const btn = $('.admin-side [data-pane="' + name + '"]');
    if (btn) btn.click();
  }

  /* ======================= 基本信息 ======================= */

  function fillGeneral() {
    const c = state.detail.channel;
    $('#cfIcon').value = c.icon || '#';
    $('#cfName').value = c.name || '';
    $('#cfDesc').value = c.description || '';
    $('#cfVis').value = c.visibility || 'public';
    $('#cfOrder').value = c.order || 0;
    state.banner = c.banner || '';
    paintBanner();

    App.uploadZone($('#cfBannerZone'), 'banner', (url) => { state.banner = url; paintBanner(); });
    $('#cfBannerClear').onclick = () => { state.banner = ''; paintBanner(); };

    $('#btnSaveGeneral').onclick = async () => {
      const btn = $('#btnSaveGeneral');
      App.busy(btn, true);
      try {
        const d = await API.Channels.update(CHANNEL_ID, {
          name: $('#cfName').value.trim(),
          icon: $('#cfIcon').value.trim() || '#',
          description: $('#cfDesc').value.trim(),
          banner: state.banner,
          visibility: $('#cfVis').value,
          order: Number($('#cfOrder').value) || 0,
        });
        state.detail.channel = d.channel;
        $('#sideChName').textContent = d.channel.name;
        toast.success(T('settings.saved'));
      } catch (e) { toastError(e); } finally { App.busy(btn, false); }
    };
  }

  function paintBanner() {
    const img = $('#cfBannerPreview');
    if (state.banner) {
      img.src = API.fileURL(state.banner);
      img.style.display = '';
      $('#cfBannerClear').hidden = false;
    } else {
      img.style.display = 'none';
      $('#cfBannerClear').hidden = true;
    }
  }

  /* ========================= 板块 ========================= */

  function renderBoards() {
    const box = $('#boardEditor');
    if (!state.boards.length) {
      box.innerHTML = '<p class="muted small">还没有板块，点击右上角「新增板块」创建。</p>';
      return;
    }
    box.innerHTML = state.boards.map((b, i) =>
      '<div class="row" style="gap:10px;align-items:flex-end;padding:10px 0;border-bottom:1px solid var(--border)" data-bi="' + i + '">' +
        '<div class="field mb-0" style="flex:0 0 76px"><label class="label">图标</label>' +
          '<input class="input input-sm text-center" data-bf="icon" maxlength="4" value="' + esc(b.icon || '📁') + '"></div>' +
        '<div class="field mb-0" style="flex:0 0 180px"><label class="label">名称</label>' +
          '<input class="input input-sm" data-bf="name" maxlength="40" value="' + esc(b.name || '') + '"></div>' +
        '<div class="field mb-0 grow"><label class="label">说明</label>' +
          '<input class="input input-sm" data-bf="desc" maxlength="200" value="' + esc(b.desc || '') + '"></div>' +
        '<div class="field mb-0" style="flex:0 0 140px"><label class="label">标识 (id)</label>' +
          '<input class="input input-sm mono" data-bf="id" maxlength="40" value="' + esc(b.id || '') + '"></div>' +
        '<button class="icon-btn" data-brm="' + i + '" aria-label="delete">' + icon('trash') + '</button>' +
      '</div>').join('');

    box.querySelectorAll('[data-brm]').forEach((btn) => btn.onclick = () => {
      state.boards.splice(Number(btn.dataset.brm), 1);
      collectBoards(); renderBoards();
    });
  }

  function collectBoards() {
    $$('#boardEditor [data-bi]').forEach((row) => {
      const i = Number(row.dataset.bi);
      if (!state.boards[i]) return;
      row.querySelectorAll('[data-bf]').forEach((inp) => { state.boards[i][inp.dataset.bf] = inp.value.trim(); });
    });
  }

  function bindBoards() {
    $('#btnAddBoard').onclick = () => {
      collectBoards();
      state.boards.push({ id: 'board' + (state.boards.length + 1), name: '新板块', icon: '📁', desc: '' });
      renderBoards();
    };
    $('#btnSaveBoards').onclick = async () => {
      collectBoards();
      const btn = $('#btnSaveBoards');
      App.busy(btn, true);
      try {
        const d = await API.Channels.update(CHANNEL_ID, { boards: state.boards });
        state.detail.channel = d.channel;
        state.boards = (d.channel.boards || []).slice();
        renderBoards();
        toast.success(T('settings.saved'));
      } catch (e) { toastError(e); } finally { App.busy(btn, false); }
    };
  }

  /* ========================= 群组 ========================= */

  function renderGroups() {
    const box = $('#groupEditor');
    const gs = state.detail.groups || [];
    if (!gs.length) {
      box.innerHTML = '<p class="muted small">还没有群组。群组拥有独立的身份组作用域，适合把频道拆成多个自治小组。</p>';
      return;
    }
    box.innerHTML = gs.map((g) =>
      '<div class="row-between" style="padding:10px 0;border-bottom:1px solid var(--border);gap:10px">' +
        '<div class="row" style="gap:10px;min-width:0">' +
          '<span class="gi-hash" style="font-size:18px">' + esc(g.icon || '#') + '</span>' +
          '<div style="min-width:0"><b>' + esc(g.name) + '</b>' +
            '<div class="xsmall muted truncate">' + esc(g.topic || '暂无主题说明') + '</div></div>' +
        '</div>' +
        '<div class="row" style="gap:6px">' +
          '<span class="badge">' + esc(g.type) + '</span>' +
          (g.private ? '<span class="badge badge-warn">私密</span>' : '') +
          '<button class="btn btn-sm btn-ghost" data-gperm="' + esc(g.id) + '">权限</button>' +
          '<button class="btn btn-sm btn-ghost" data-gedit="' + esc(g.id) + '">' + T('common.edit') + '</button>' +
          '<button class="btn btn-sm btn-ghost" data-gdel="' + esc(g.id) + '">' + T('common.delete') + '</button>' +
        '</div>' +
      '</div>').join('');

    box.querySelectorAll('[data-gedit]').forEach((b) => b.onclick = () => groupDialog(gs.find((x) => x.id === b.dataset.gedit)));
    box.querySelectorAll('[data-gdel]').forEach((b) => b.onclick = async () => {
      if (!(await App.confirmDialog('删除该群组？相关身份组配置会一并失效。', { danger: true }))) return;
      try { await API.Channels.removeGroup(CHANNEL_ID, b.dataset.gdel); toast.success(T('common.success')); await reload(); }
      catch (e) { toastError(e); }
    });
    box.querySelectorAll('[data-gperm]').forEach((b) => b.onclick = () => {
      state.scope = 'group:' + CHANNEL_ID + ':' + b.dataset.gperm;
      openPane('roles');
      $('#roleScopeSel').value = state.scope;
      loadRoles(true);
    });
  }

  function groupDialog(g) {
    const body = App.el('div');
    body.innerHTML =
      '<div class="row" style="gap:12px">' +
        '<div class="field" style="flex:0 0 90px"><label class="label">图标</label>' +
          '<input class="input text-center" id="gdIcon" maxlength="4" value="' + esc((g && g.icon) || '#') + '"></div>' +
        '<div class="field grow"><label class="label" data-i18n="ch.groupName">群组名称</label>' +
          '<input class="input" id="gdName" maxlength="40" value="' + esc((g && g.name) || '') + '"></div>' +
      '</div>' +
      '<div class="field"><label class="label">主题说明</label>' +
        '<input class="input" id="gdTopic" maxlength="300" value="' + esc((g && g.topic) || '') + '"></div>' +
      '<div class="row" style="gap:12px">' +
        '<div class="field grow"><label class="label">类型</label><select class="select" id="gdType">' +
          ['text', 'forum', 'announcement', 'voice'].map((t) =>
            '<option value="' + t + '"' + (g && g.type === t ? ' selected' : '') + '>' +
            ({ text: '文字讨论', forum: '论坛帖', announcement: '公告', voice: '语音（占位）' })[t] + '</option>').join('') +
        '</select></div>' +
        '<div class="field" style="flex:0 0 130px"><label class="label">排序</label>' +
          '<input class="input" id="gdOrder" type="number" value="' + ((g && g.order) || 0) + '"></div>' +
        '<div class="field" style="flex:0 0 110px"><label class="label">私密</label>' +
          '<label class="switch" style="margin-top:9px"><input type="checkbox" id="gdPriv"' +
            (g && g.private ? ' checked' : '') + '><span class="track"></span></label></div>' +
      '</div>';

    App.modal({
      title: g ? '编辑群组' : T('ch.newGroup'), body, okText: T('common.save'),
      onOk: async () => {
        const payload = {
          name: body.querySelector('#gdName').value.trim(),
          icon: body.querySelector('#gdIcon').value.trim() || '#',
          topic: body.querySelector('#gdTopic').value.trim(),
          type: body.querySelector('#gdType').value,
          order: Number(body.querySelector('#gdOrder').value) || 0,
          private: body.querySelector('#gdPriv').checked,
        };
        if (!payload.name) { toast.warn('请输入群组名称'); return false; }
        if (g) await API.Channels.updateGroup(CHANNEL_ID, g.id, payload);
        else await API.Channels.createGroup(CHANNEL_ID, payload);
        toast.success(T('common.success'));
        await reload();
      },
    });
  }

  /* ===================== 身份组与权限 ===================== */

  function scopeOptions() {
    const opts = [{ v: 'channel:' + CHANNEL_ID, l: '频道 · ' + state.detail.channel.name }];
    (state.detail.groups || []).forEach((g) => opts.push({ v: 'group:' + CHANNEL_ID + ':' + g.id, l: '群组 · ' + g.name }));
    $('#roleScopeSel').innerHTML = opts.map((o) =>
      '<option value="' + esc(o.v) + '"' + (state.scope === o.v ? ' selected' : '') + '>' + esc(o.l) + '</option>').join('');
  }

  async function loadRoles(keepScope) {
    if (!state.scope || !keepScope) state.scope = state.scope || ('channel:' + CHANNEL_ID);
    scopeOptions();
    $('#roleSideList').innerHTML = App.skeletonList(3, 34);
    try {
      state.roleData = await API.Roles.list(state.scope);
      $('#roleScopeHint').textContent = '作用域 ' + state.scope + '　·　' +
        (state.roleData.canManage ? '你可以在此作用域内创建与编辑身份组' : '你没有该作用域的身份组管理权限（只读）');
      $('#btnNewRole').disabled = !state.roleData.canManage;
      renderRoleList();
    } catch (e) {
      $('#roleSideList').innerHTML = '<p class="error-text small">' + esc(e.message) + '</p>';
    }
  }

  function renderRoleList() {
    const roles = (state.roleData.roles || []).slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
    $('#roleSideList').innerHTML = roles.map((r) =>
      '<button class="side-item' + (state.activeRole && state.activeRole.id === r.id ? ' active' : '') +
      '" data-role="' + esc(r.id) + '">' +
        '<span class="rr-color" style="width:9px;height:9px;border-radius:50%;background:' + esc(r.color) + '"></span>' +
        '<span class="truncate">' + esc(r.name) + '</span>' +
        '<span class="count">' + (r.perms || []).length + '</span></button>').join('') ||
      '<p class="muted small">该作用域暂无身份组</p>';

    $$('#roleSideList [data-role]').forEach((b) => b.onclick = () => {
      state.activeRole = roles.find((r) => r.id === b.dataset.role);
      renderRoleList(); renderRoleDetail();
    });
  }

  function renderRoleDetail() {
    const r = state.activeRole;
    const box = $('#roleDetail');
    if (!r) { box.innerHTML = '<p class="muted small">从左侧选择一个身份组开始编辑。</p>'; return; }

    const catalog = state.roleData.catalog || [];
    const canManage = !!state.roleData.canManage;
    const locked = r.system && r.id === 'role_super_admin';

    box.innerHTML =
      '<div class="row-between wrap mb-4" style="gap:10px">' +
        '<div class="row" style="gap:10px;align-items:center">' +
          '<input class="color-input" type="color" id="rdColor" value="' + esc(r.color || '#64748b') + '"' + (canManage ? '' : ' disabled') + '>' +
          '<input class="input" id="rdName" style="max-width:220px" maxlength="30" value="' + esc(r.name) + '"' + (canManage ? '' : ' disabled') + '>' +
          (r.system ? '<span class="badge">系统预设</span>' : '') +
        '</div>' +
        '<div class="row" style="gap:8px">' +
          '<div class="field mb-0" style="width:130px"><label class="label" data-i18n="role.priority">优先级</label>' +
            '<input class="input input-sm" id="rdPriority" type="number" value="' + (r.priority || 0) + '"' + (canManage ? '' : ' disabled') + '></div>' +
          '<button class="btn btn-primary btn-sm" id="rdSave"' + (canManage ? '' : ' disabled') + '>' + T('common.save') + '</button>' +
          (r.system || !canManage ? '' : '<button class="btn btn-danger btn-sm" id="rdDel">' + T('common.delete') + '</button>') +
        '</div>' +
      '</div>' +
      '<div class="row-between mb-4">' +
        '<div class="section-title mb-0" style="flex:1" data-i18n="role.perms">权限</div>' +
        (canManage && !locked ? '<div class="row" style="gap:6px">' +
          '<button class="btn btn-sm btn-ghost" id="rdAll">全选</button>' +
          '<button class="btn btn-sm btn-ghost" id="rdNone">清空</button></div>' : '') +
      '</div>' +
      '<div class="perm-grid" id="rdPerms">' +
        catalog.map((p) => {
          const on = (r.perms || []).includes(p.key);
          return '<label class="perm-item' + (on ? ' checked' : '') + (locked ? ' locked' : '') + '" data-pk="' + esc(p.key) + '">' +
            '<input type="checkbox" class="check"' + (on ? ' checked' : '') + (canManage && !locked ? '' : ' disabled') + '>' +
            '<span><span class="pi-label">' + esc(p.label) + '</span><br>' +
            '<span class="pi-key">' + esc(p.key) + '</span></span></label>';
        }).join('') +
      '</div>' +
      '<p class="hint mt-4">提示：你只能授予自己已拥有、且属于「作用域级(S)」的权限；站点级(G)权限仅超级管理员可分配。</p>';

    // 交互
    box.querySelectorAll('.perm-item').forEach((it) => {
      const cb = it.querySelector('input');
      cb.addEventListener('change', () => it.classList.toggle('checked', cb.checked));
    });
    const all = $('#rdAll'), none = $('#rdNone');
    if (all) all.onclick = () => box.querySelectorAll('.perm-item').forEach((it) => {
      const cb = it.querySelector('input'); cb.checked = true; it.classList.add('checked');
    });
    if (none) none.onclick = () => box.querySelectorAll('.perm-item').forEach((it) => {
      const cb = it.querySelector('input'); cb.checked = false; it.classList.remove('checked');
    });

    const save = $('#rdSave');
    if (save) save.onclick = async () => {
      App.busy(save, true);
      try {
        const perms = Array.from(box.querySelectorAll('.perm-item'))
          .filter((it) => it.querySelector('input').checked).map((it) => it.dataset.pk);
        const d = await API.Roles.update(r.id, {
          scope: state.scope,
          name: $('#rdName').value.trim(),
          color: $('#rdColor').value,
          priority: Number($('#rdPriority').value) || 0,
          perms,
        });
        state.activeRole = d.role;
        toast.success(T('settings.saved'));
        await loadRoles(true);
        renderRoleDetail();
      } catch (e) { toastError(e); } finally { App.busy(save, false); }
    };

    const del = $('#rdDel');
    if (del) del.onclick = async () => {
      if (!(await App.confirmDialog(T('role.deleteConfirm'), { danger: true }))) return;
      try {
        await API.Roles.remove(r.id, state.scope);
        state.activeRole = null;
        toast.success(T('common.success'));
        await loadRoles(true);
        renderRoleDetail();
      } catch (e) { toastError(e); }
    };
  }

  function newRoleDialog() {
    const body = App.el('div');
    body.innerHTML =
      '<div class="row" style="gap:12px">' +
        '<div class="field" style="flex:0 0 70px"><label class="label" data-i18n="role.color">颜色</label>' +
          '<input class="color-input" type="color" id="nrColor" value="#6366f1"></div>' +
        '<div class="field grow"><label class="label" data-i18n="role.name">身份组名称</label>' +
          '<input class="input" id="nrName" maxlength="30" placeholder="例如：内容审核"></div>' +
        '<div class="field" style="flex:0 0 120px"><label class="label" data-i18n="role.priority">优先级</label>' +
          '<input class="input" id="nrPriority" type="number" value="200"></div>' +
      '</div>' +
      '<p class="hint">创建后可在右侧权限矩阵中勾选具体权限。</p>';

    App.modal({
      title: T('role.create'), body, okText: T('role.create'),
      onOk: async () => {
        const name = body.querySelector('#nrName').value.trim();
        if (!name) { toast.warn('请输入身份组名称'); return false; }
        const d = await API.Roles.create({
          scope: state.scope, name,
          color: body.querySelector('#nrColor').value,
          priority: Number(body.querySelector('#nrPriority').value) || 200,
          perms: [],
        });
        toast.success(T('common.success'));
        state.activeRole = d.role;
        await loadRoles(true);
        renderRoleDetail();
      },
    });
  }

  /* ========================= 成员 ========================= */

  async function loadMembers(reset) {
    const tb = $('#memRows');
    if (reset) { tb.innerHTML = '<tr><td colspan="5">' + App.skeletonList(2, 34) + '</td></tr>'; state.memberCursor = null; state.members = []; }
    try {
      const d = await API.Channels.members(CHANNEL_ID, { cursor: state.memberCursor, limit: 50 });
      state.memberCursor = d.cursor;
      state.members = state.members.concat(d.items || []);
      $('#btnMoreMem').hidden = !d.cursor;
      renderMembers();
    } catch (e) {
      tb.innerHTML = '<tr><td colspan="5"><p class="error-text text-center" style="padding:18px 0">' + esc(e.message) + '</p></td></tr>';
    }
  }

  function renderMembers() {
    const kw = ($('#memSearch').value || '').trim().toLowerCase();
    const items = kw
      ? state.members.filter((m) => (m.username + ' ' + m.displayName + ' ' + (m.nickname || '')).toLowerCase().includes(kw))
      : state.members;
    const tb = $('#memRows');
    if (!items.length) {
      tb.innerHTML = '<tr><td colspan="5"><p class="muted small text-center" style="padding:18px 0">没有匹配的成员</p></td></tr>';
      return;
    }
    tb.innerHTML = items.map((m) => {
      const muted = m.mutedUntil && m.mutedUntil > Date.now();
      return '<tr>' +
        '<td><a class="row" style="gap:8px;align-items:center" href="/profile.html?u=' + esc(m.id) + '">' +
          App.avatar(m, 'xs') + '<span>' + esc(m.nickname || m.displayName) + '</span>' +
          '<span class="muted2 xsmall">@' + esc(m.username) + '</span></a></td>' +
        '<td>' + (App.roleTagsHTML(m.roleTags) || '<span class="muted2 small">—</span>') + '</td>' +
        '<td><span class="small muted" data-time="' + (m.joinedAt || 0) + '" data-time-style="abs"></span></td>' +
        '<td>' + (muted ? '<span class="badge badge-warn">禁言中</span>' : '<span class="badge badge-ok">正常</span>') + '</td>' +
        '<td class="td-actions">' +
          '<button class="btn btn-sm btn-ghost" data-assign="' + esc(m.id) + '">' + T('role.assign') + '</button>' +
          '<button class="btn btn-sm btn-ghost" data-rename="' + esc(m.id) + '">' + T('admin.rename') + '</button>' +
          '<button class="btn btn-sm btn-ghost" data-mute="' + esc(m.id) + '">' + (muted ? T('admin.unmute') : T('admin.mute')) + '</button>' +
        '</td></tr>';
    }).join('');
    I18N.apply(tb);

    tb.querySelectorAll('[data-assign]').forEach((b) => b.onclick = () => assignDialog(b.dataset.assign));
    tb.querySelectorAll('[data-rename]').forEach((b) => b.onclick = async () => {
      const nn = await App.promptDialog('频道内昵称', { required: true, maxlength: 40 });
      if (!nn) return;
      try {
        await API.Admin.userAction(b.dataset.rename, { action: 'rename', scope: 'channel:' + CHANNEL_ID, displayName: nn });
        toast.success(T('common.success')); loadMembers(true);
      } catch (e) { toastError(e); }
    });
    tb.querySelectorAll('[data-mute]').forEach((b) => b.onclick = async () => {
      const isUnmute = b.textContent.trim() === T('admin.unmute');
      try {
        if (isUnmute) await API.Admin.userAction(b.dataset.mute, { action: 'unmute', scope: 'channel:' + CHANNEL_ID });
        else {
          const mins = await App.promptDialog('禁言时长（分钟）', { value: '60', required: true });
          if (!mins) return;
          await API.Admin.userAction(b.dataset.mute, { action: 'mute', scope: 'channel:' + CHANNEL_ID, minutes: Number(mins) || 60 });
        }
        toast.success(T('common.success')); loadMembers(true);
      } catch (e) { toastError(e); }
    });
  }

  async function assignDialog(userId) {
    const m = state.members.find((x) => x.id === userId);
    const scope = 'channel:' + CHANNEL_ID;
    let data;
    try { data = await API.Roles.list(scope); } catch (e) { toastError(e); return; }
    const cur = new Set(m ? (m.roles || []) : []);
    const body = App.el('div');
    body.innerHTML =
      '<p class="small muted">为 <b>' + esc(m ? (m.displayName || m.username) : userId) + '</b> 在 <code class="mono">' + esc(scope) + '</code> 内分配身份组</p>' +
      '<div class="perm-grid mt-4">' +
        (data.roles || []).map((r) =>
          '<label class="perm-item' + (cur.has(r.id) ? ' checked' : '') + '" data-rid="' + esc(r.id) + '">' +
            '<input type="checkbox" class="check"' + (cur.has(r.id) ? ' checked' : '') + '>' +
            '<span><span class="pi-label" style="color:' + esc(r.color) + '">' + esc(r.name) + '</span><br>' +
            '<span class="pi-key">' + (r.perms || []).length + ' perms · P' + (r.priority || 0) + '</span></span></label>').join('') +
      '</div>';
    body.querySelectorAll('.perm-item').forEach((it) => {
      const cb = it.querySelector('input');
      cb.addEventListener('change', () => it.classList.toggle('checked', cb.checked));
    });

    App.modal({
      title: T('role.assign'), body, okText: T('common.save'), size: 'lg',
      onOk: async () => {
        const roles = Array.from(body.querySelectorAll('.perm-item'))
          .filter((it) => it.querySelector('input').checked).map((it) => it.dataset.rid);
        await API.Roles.assign({ scope, userId, roles });
        toast.success(T('common.success'));
        loadMembers(true);
      },
    });
  }

  /* ========================= 举报 ========================= */

  async function loadReports() {
    const box = $('#repList');
    box.innerHTML = App.skeletonList(3, 76);
    try {
      const d = await API.Reports.list({ scope: 'channel:' + CHANNEL_ID, status: $('#repStatus').value });
      const items = d.items || [];
      if (!items.length) { box.innerHTML = App.emptyState('没有举报', '本频道当前没有需要处理的举报。', 'flag'); return; }
      box.innerHTML = items.map((r) =>
        '<div class="card card-pad">' +
          '<div class="row-between wrap" style="gap:8px">' +
            '<div>' +
              '<span class="badge ' + (r.status === 'open' ? 'badge-warn' : r.status === 'resolved' ? 'badge-ok' : '') + '">' + esc(r.status) + '</span> ' +
              '<b>' + esc(T('report.reason.' + r.reason) || r.reason) + '</b> ' +
              '<span class="small muted">· ' + esc(r.targetType) + ' ' + esc(r.targetId) + '</span>' +
            '</div>' +
            '<span class="small muted" data-time="' + r.createdAt + '"></span>' +
          '</div>' +
          (r.detail ? '<p class="small mt-2 mb-0">' + esc(r.detail) + '</p>' : '') +
          '<div class="row mt-4" style="gap:8px">' +
            '<a class="btn btn-sm btn-ghost" href="/post.html?id=' + esc(r.targetId) + '" target="_blank" rel="noopener">查看目标</a>' +
            (r.status !== 'resolved'
              ? '<button class="btn btn-sm btn-soft" data-rs="' + esc(r.id) + '" data-st="resolved">' + T('admin.resolve') + '</button>' +
                '<button class="btn btn-sm btn-ghost" data-rs="' + esc(r.id) + '" data-st="rejected">' + T('admin.reject') + '</button>'
              : '<span class="small muted">已于 <span data-time="' + (r.handledAt || 0) + '"></span> 处理</span>') +
          '</div>' +
        '</div>').join('');
      I18N.apply(box);

      box.querySelectorAll('[data-rs]').forEach((b) => b.onclick = async () => {
        const note = await App.promptDialog('处理说明（可留空）', { multiline: true });
        try {
          await API.Reports.resolve(b.dataset.rs, { status: b.dataset.st, resolution: note || '' });
          toast.success(T('common.success')); loadReports();
        } catch (e) { toastError(e); }
      });
    } catch (e) {
      box.innerHTML = App.emptyState(T('common.failed'), e.message, 'alert');
    }
  }

  /* ======================= 危险区域 ======================= */

  function bindDanger() {
    $('#btnDeleteChannel').onclick = async () => {
      const name = state.detail.channel.name;
      const typed = await App.promptDialog('输入频道名称「' + name + '」以确认删除', { required: true, danger: true });
      if (typed !== name) { if (typed) toast.warn('名称不匹配，已取消'); return; }
      try {
        await API.Channels.remove(CHANNEL_ID);
        toast.success('频道已删除');
        setTimeout(() => location.href = '/channels.html', 600);
      } catch (e) { toastError(e); }
    };
  }

  /* ========================== 启动 ========================= */

  async function reload() {
    state.detail = await API.Channels.detail(CHANNEL_ID);
    state.boards = (state.detail.boards || []).map((b) => Object.assign({}, b));
    $('#sideChName').textContent = state.detail.channel.name;
    $('#backToChannel').href = '/channels.html?id=' + CHANNEL_ID;
    document.title = state.detail.channel.name + ' · 频道管理 · MarytOpens';
    renderBoards();
    renderGroups();
  }

  App.boot({
    nav: 'channels',
    requireAuth: true,
    onReady: async function () {
      if (!CHANNEL_ID) {
        document.querySelector('.admin-main').innerHTML =
          App.emptyState('缺少频道参数', '请从频道列表进入管理面板。', 'alert',
            '<a class="btn btn-primary" href="/channels.html">' + T('ch.title') + '</a>');
        return;
      }
      bindPanes();
      bindBoards();
      bindDanger();
      $('#btnAddGroup').onclick = () => groupDialog(null);
      $('#btnNewRole').onclick = newRoleDialog;
      $('#roleScopeSel').onchange = () => { state.scope = $('#roleScopeSel').value; state.activeRole = null; loadRoles(true); renderRoleDetail(); };
      $('#repStatus').onchange = loadReports;
      $('#btnMoreMem').onclick = () => loadMembers(false);
      $('#memSearch').addEventListener('input', App.debounce(renderMembers, 200));

      try {
        await reload();
      } catch (e) {
        document.querySelector('.admin-main').innerHTML = App.emptyState(T('common.failed'), e.message, 'alert');
        return;
      }

      if (!state.detail.canManage) {
        document.querySelector('.admin-main').innerHTML =
          App.emptyState(T('common.forbidden'), '你没有该频道的管理权限（需要 channel.manage）。', 'lock',
            '<a class="btn btn-primary" href="/channels.html?id=' + CHANNEL_ID + '">返回频道</a>');
        return;
      }

      fillGeneral();
      state.scope = 'channel:' + CHANNEL_ID;

      const tab = new URLSearchParams(location.search).get('tab');
      if (tab) openPane(tab); else onPaneEnter('general');
    },
  });
})();
