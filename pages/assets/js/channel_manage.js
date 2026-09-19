/* ==========================================================================
 * MarytOpens · channel_manage.js
 * 版块管理面板：基本信息 / 频道 / 身份组权限矩阵 / 成员 / 举报 / 危险区
 * 层级：版块(board) ⊃ 频道(channel)，版主 > 频道主
 * 依赖：i18n.js api.js app.js
 * ========================================================================== */
(function () {
  'use strict';

  const { $, $$, esc, icon, toast, toastError } = App;
  const T = (k) => I18N.t(k);

  const BOARD_ID = new URLSearchParams(location.search).get('id') || '';

  const state = {
    detail: null,        // /api/boards/:id → { board, channels, member, roles, perms, canManage }
    scope: '',           // 当前身份组作用域
    roleData: null,      // /api/roles?scope=
    activeRole: null,
    banner: '',
    iconUrl: '',
    memberCursor: null,
    members: [],
    membersLoading: false,
  };

  const CH_TYPE = () => ({ text: T('ch.type.text'), forum: T('ch.type.forum'), announcement: T('ch.type.announcement'), voice: T('ch.type.voice') });

  /* ======================= 面板切换 ======================= */

  function bindPanes() {
    $$('.admin-side [data-pane]').forEach((btn) => {
      btn.onclick = () => {
        $$('.admin-side [data-pane]').forEach((b) => b.classList.toggle('active', b === btn));
        $$('.admin-main .tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'pane-' + btn.dataset.pane));
        history.replaceState(null, '', '?id=' + BOARD_ID + '&tab=' + btn.dataset.pane);
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
    if (name === 'interactions') fillInteractions();
  }

  function openPane(name) {
    const btn = $('.admin-side [data-pane="' + name + '"]');
    if (btn) btn.click();
  }

  /* ======================= 基本信息 ======================= */

  function fillGeneral() {
    const b = state.detail.board;
    $('#cfIcon').value = b.icon || '📁';
    $('#cfName').value = b.name || '';
    $('#cfDesc').value = b.description || '';
    $('#cfVis').value = b.visibility || 'public';
    $('#cfOrder').value = b.order || 0;
    state.banner = b.banner || '';
    state.iconUrl = b.iconUrl || '';
    paintBanner();
    paintIcon();

    App.uploadZone($('#cfBannerZone'), 'banner', (url) => { state.banner = url; paintBanner(); });
    $('#cfBannerClear').onclick = () => { state.banner = ''; paintBanner(); };

    App.uploadZone($('#cfIconZone'), 'image', (url) => { state.iconUrl = url; paintIcon(); });
    $('#cfIconClear').onclick = () => { state.iconUrl = ''; paintIcon(); };

    const canA = App.canAnnounce();
    $('#cfOfficialRow').style.display = canA ? '' : 'none';
    $('#cfOfficial').checked = !!b.official;
    const cs = $('#cfSensitive'); if (cs) cs.checked = !!b.sensitive;
    const sp = $('#cfSpoiler'); if (sp) sp.checked = !!b.spoiler;

    $('#btnSaveGeneral').onclick = async () => {
      const btn = $('#btnSaveGeneral');
      App.busy(btn, true);
      try {
        const d = await API.Boards.update(BOARD_ID, {
          name: $('#cfName').value.trim(),
          icon: $('#cfIcon').value.trim() || '📁',
          description: $('#cfDesc').value.trim(),
          banner: state.banner,
          iconUrl: state.iconUrl,
          visibility: $('#cfVis').value,
          order: Number($('#cfOrder').value) || 0,
          official: canA ? $('#cfOfficial').checked : undefined,
          sensitive: $('#cfSensitive') ? $('#cfSensitive').checked : false,
          spoiler: $('#cfSpoiler') ? $('#cfSpoiler').checked : false,
        });
        state.detail.board = d.board;
        $('#sideChName').textContent = d.board.name;
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

  function paintIcon() {
    const img = $('#cfIconPreview');
    if (state.iconUrl) {
      img.src = API.fileURL(state.iconUrl);
      img.style.display = '';
      $('#cfIconClear').hidden = false;
    } else {
      img.style.display = 'none';
      $('#cfIconClear').hidden = true;
    }
  }

  /* ========================= 频道 ========================= */

  function renderChannels() {
    const box = $('#channelEditor');
    const cs = state.detail.channels || [];
    if (!cs.length) {
      box.innerHTML = '<p class="muted small">还没有频道。频道拥有独立的身份组作用域，适合把版块拆成多个自治讨论区。</p>';
      return;
    }
    const types = CH_TYPE();
    box.innerHTML = cs.map((c) =>
      '<div class="row-between" style="padding:10px 0;border-bottom:1px solid var(--border);gap:10px">' +
        '<div class="row" style="gap:10px;min-width:0">' +
          '<span class="gi-hash" style="font-size:18px">' + esc(c.icon || '#') + '</span>' +
          '<div style="min-width:0"><b>' + esc(c.name) + '</b>' +
            '<div class="xsmall muted truncate">' + esc(c.topic || '暂无主题说明') + '</div></div>' +
        '</div>' +
        '<div class="row" style="gap:6px">' +
          '<span class="badge">' + esc(types[c.type] || c.type) + '</span>' +
          (c.official ? '<span class="badge badge-ok">官方</span>' : '') +
          (c.private ? '<span class="badge badge-warn">私密</span>' : '') +
          '<button class="btn btn-sm btn-ghost" data-cperm="' + esc(c.id) + '">权限</button>' +
          (App.canAnnounce() ? '<button class="btn btn-sm btn-ghost" data-ccmt="' + esc(c.id) + '">委员</button>' : '') +
          '<button class="btn btn-sm btn-ghost" data-cedit="' + esc(c.id) + '">' + T('common.edit') + '</button>' +
          '<button class="btn btn-sm btn-ghost" data-cdel="' + esc(c.id) + '">' + T('common.delete') + '</button>' +
        '</div>' +
      '</div>').join('');

    box.querySelectorAll('[data-cedit]').forEach((b) => b.onclick = () => channelDialog(cs.find((x) => x.id === b.dataset.cedit)));
    box.querySelectorAll('[data-ccmt]').forEach((b) => b.onclick = () => {
      const cid = b.dataset.ccmt;
      App.openCommitteeManager({
        list: () => API.Channels.committee(BOARD_ID, cid),
        add: (data) => API.Channels.addCommittee(BOARD_ID, cid, data),
        update: (uid, data) => API.Channels.updateCommittee(BOARD_ID, cid, uid, data),
        remove: (uid) => API.Channels.removeCommittee(BOARD_ID, cid, uid),
        setChairman: (uid) => API.Channels.setChairman(BOARD_ID, cid, uid),
      });
    });
    box.querySelectorAll('[data-cdel]').forEach((b) => b.onclick = async () => {
      if (!(await App.confirmDialog('删除该频道？相关身份组配置会一并失效。', { danger: true }))) return;
      try { await API.Boards.removeChannel(BOARD_ID, b.dataset.cdel); toast.success(T('common.success')); await reload(); }
      catch (e) { toastError(e); }
    });
    box.querySelectorAll('[data-cperm]').forEach((b) => b.onclick = () => {
      state.scope = 'channel:' + BOARD_ID + ':' + b.dataset.cperm;
      openPane('roles');
      $('#roleScopeSel').value = state.scope;
      loadRoles(true);
    });
  }

  function channelDialog(c) {
    const types = CH_TYPE();
    const canA = App.canAnnounce();
    const body = App.el('div');
    body.innerHTML =
      '<div class="row" style="gap:12px">' +
        '<div class="field" style="flex:0 0 90px"><label class="label" data-i18n="ch.icon">图标</label>' +
          '<input class="input text-center" id="cdIcon" maxlength="4" value="' + esc((c && c.icon) || '#') + '"></div>' +
        '<div class="field grow"><label class="label" data-i18n="ch.name">频道名称</label>' +
          '<input class="input" id="cdName" maxlength="40" value="' + esc((c && c.name) || '') + '"></div>' +
      '</div>' +
      '<div class="field"><label class="label">自定义图标（上传，可选）</label>' +
        '<div class="upload-zone" id="cdIconZone"><p>点击或拖拽上传图标图（≤2MB）</p></div>' +
        '<img id="cdIconPreview" alt="" style="max-height:48px;border-radius:8px;display:' + ((c && c.iconUrl) ? '' : 'none') + ';margin-top:8px">' +
      '</div>' +
      '<div class="field"><label class="label" data-i18n="ch.topic">主题说明</label>' +
        '<input class="input" id="cdTopic" maxlength="300" value="' + esc((c && c.topic) || '') + '"></div>' +
      '<div class="row" style="gap:12px">' +
        '<div class="field grow"><label class="label" data-i18n="ch.type">类型</label><select class="select" id="cdType">' +
          ['text', 'forum', 'announcement', 'voice'].map((t) =>
            '<option value="' + t + '"' + (c && c.type === t ? ' selected' : '') + '>' +
            esc(types[t]) + '</option>').join('') +
        '</select></div>' +
        '<div class="field" style="flex:0 0 130px"><label class="label">排序</label>' +
          '<input class="input" id="cdOrder" type="number" value="' + ((c && c.order) || 0) + '"></div>' +
        '<div class="field" style="flex:0 0 110px"><label class="label">私密</label>' +
          '<label class="switch" style="margin-top:9px"><input type="checkbox" id="cdPriv"' +
            (c && c.private ? ' checked' : '') + '><span class="track"></span></label></div>' +
      '</div>' +
      (canA ? '<div class="switch-row"><span><span class="sr-title">官方频道</span><span class="sr-desc">标记为官方频道，展示在「官方栏」</span></span>' +
        '<label class="switch"><input type="checkbox" id="cdOfficial"' + (c && c.official ? ' checked' : '') + '><span class="track"></span></label></div>' : '');

    let iconUrl = (c && c.iconUrl) || '';
    if (iconUrl) { const pr = body.querySelector('#cdIconPreview'); if (pr) pr.src = API.fileURL(iconUrl); }
    App.uploadZone(body.querySelector('#cdIconZone'), 'image', (url) => {
      iconUrl = url;
      const pr = body.querySelector('#cdIconPreview');
      if (pr) { pr.src = API.fileURL(url); pr.style.display = ''; }
    });

    App.modal({
      title: c ? T('ch.edit') : T('ch.create'), body, okText: T('common.save'),
      onOk: async () => {
        const payload = {
          name: body.querySelector('#cdName').value.trim(),
          icon: body.querySelector('#cdIcon').value.trim() || '#',
          iconUrl: iconUrl,
          topic: body.querySelector('#cdTopic').value.trim(),
          type: body.querySelector('#cdType').value,
          order: Number(body.querySelector('#cdOrder').value) || 0,
          private: body.querySelector('#cdPriv').checked,
          official: canA ? !!(body.querySelector('#cdOfficial') && body.querySelector('#cdOfficial').checked) : undefined,
        };
        if (!payload.name) { toast.warn(T('ch.nameRequired')); return false; }
        if (c) await API.Boards.updateChannel(BOARD_ID, c.id, payload);
        else await API.Boards.createChannel(BOARD_ID, payload);
        toast.success(T('common.success'));
        await reload();
      },
    });
  }

  /* ===================== 身份组与权限 ===================== */

  function scopeOptions() {
    const opts = [{ v: 'board:' + BOARD_ID, l: T('bd.scopeBoard') + ' · ' + state.detail.board.name }];
    (state.detail.channels || []).forEach((c) => opts.push({ v: 'channel:' + BOARD_ID + ':' + c.id, l: T('bd.scopeChannel') + ' · ' + c.name }));
    $('#roleScopeSel').innerHTML = opts.map((o) =>
      '<option value="' + esc(o.v) + '"' + (state.scope === o.v ? ' selected' : '') + '>' + esc(o.l) + '</option>').join('');
  }

  async function loadRoles(keepScope) {
    if (!state.scope || !keepScope) state.scope = state.scope || ('board:' + BOARD_ID);
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
    if (state.membersLoading) return;
    state.membersLoading = true;
    try {
      if (reset) { tb.innerHTML = '<tr><td colspan="5">' + App.skeletonList(2, 34) + '</td></tr>'; state.memberCursor = null; state.members = []; }
      const d = await API.Boards.members(BOARD_ID, { cursor: state.memberCursor, limit: 50 });
      state.memberCursor = d.cursor;
      const seen = new Set(state.members.map((x) => x.id));
      state.members = state.members.concat((d.items || []).filter((x) => x && !seen.has(x.id)));
      $('#btnMoreMem').hidden = !d.cursor;
      renderMembers();
    } catch (e) {
      tb.innerHTML = '<tr><td colspan="5"><p class="error-text text-center" style="padding:18px 0">' + esc(e.message) + '</p></td></tr>';
    } finally { state.membersLoading = false; }
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
      const nn = await App.promptDialog('版块内昵称', { required: true, maxlength: 40 });
      if (!nn) return;
      try {
        await API.Admin.userAction(b.dataset.rename, { action: 'rename', scope: 'board:' + BOARD_ID, displayName: nn });
        toast.success(T('common.success')); loadMembers(true);
      } catch (e) { toastError(e); }
    });
    tb.querySelectorAll('[data-mute]').forEach((b) => b.onclick = async () => {
      const isUnmute = b.textContent.trim() === T('admin.unmute');
      try {
        if (isUnmute) await API.Admin.userAction(b.dataset.mute, { action: 'unmute', scope: 'board:' + BOARD_ID });
        else {
          const mins = await App.promptDialog('禁言时长（分钟）', { value: '60', required: true });
          if (!mins) return;
          await API.Admin.userAction(b.dataset.mute, { action: 'mute', scope: 'board:' + BOARD_ID, minutes: Number(mins) || 60 });
        }
        toast.success(T('common.success')); loadMembers(true);
      } catch (e) { toastError(e); }
    });
  }

  async function assignDialog(userId) {
    const m = state.members.find((x) => x.id === userId);
    const scope = 'board:' + BOARD_ID;
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
      const d = await API.Reports.list({ scope: 'board:' + BOARD_ID, status: $('#repStatus').value });
      const items = d.items || [];
      if (!items.length) { box.innerHTML = App.emptyState('没有举报', '本版块当前没有需要处理的举报。', 'flag'); return; }
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
      const name = state.detail.board.name;
      const typed = await App.promptDialog('输入版块名称「' + name + '」以确认删除', { required: true, danger: true });
      if (typed !== name) { if (typed) toast.warn('名称不匹配，已取消'); return; }
      try {
        await API.Boards.remove(BOARD_ID);
        toast.success('版块已删除');
        setTimeout(() => location.href = '/channels.html', 600);
      } catch (e) { toastError(e); }
    };
  }

  /* ======================= 互动与机器人 ======================= */

  function fillInteractions() {
    const b = state.detail.board;
    state.welcomeImage = b.welcomeImage || '';
    $('#itBot').checked = b.botEnabled !== false;
    $('#itWelcomeOn').checked = !!b.welcomeEnabled;
    $('#itReact').checked = b.allowReactions !== false;
    $('#itWelcomeMsg').value = b.welcomeMessage || '欢迎加入 ${user}！';
    $('#itOnboarding').value = b.onboarding || '';
    $('#itWelcomeImg').value = b.welcomeImage || '';

    const chSel = $('#itWelcomeCh');
    chSel.innerHTML = '<option value="none">不发送</option>' +
      (state.detail.channels || []).map((c) =>
        '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>').join('');
    chSel.value = b.welcomeChannelId || 'none';

    App.uploadZone($('#itWelcomeImgZone'), 'image', (url) => { state.welcomeImage = url; $('#itWelcomeImg').value = url; });
    $('#itWelcomeImg').addEventListener('input', () => { state.welcomeImage = $('#itWelcomeImg').value.trim(); });

    // 频道表态开关
    const cl = $('#itChannelList');
    const chs = state.detail.channels || [];
    cl.innerHTML = chs.length ? chs.map((c) =>
      '<div class="switch-row"><span><span class="sr-title">' + esc(c.name) + ' 允许表态</span></span>' +
      '<label class="switch"><input type="checkbox" data-chreact="' + esc(c.id) + '"' + (c.allowReactions !== false ? ' checked' : '') + '><span class="track"></span></label></div>'
    ).join('') : '<p class="muted small mb-0">本版块暂无频道。</p>';
    cl.querySelectorAll('[data-chreact]').forEach((cb) => {
      cb.onchange = async () => {
        try { await API.Boards.updateChannel(BOARD_ID, cb.dataset.chreact, { allowReactions: cb.checked }); toast.success(T('settings.saved')); }
        catch (e) { toastError(e); cb.checked = !cb.checked; }
      };
    });

    let saved = false;
    $('#btnSaveInteractions').onclick = async () => {
      if (saved) return; saved = true;
      const btn = $('#btnSaveInteractions'); App.busy(btn, true);
      try {
        const d = await API.Boards.update(BOARD_ID, {
          botEnabled: $('#itBot').checked,
          welcomeEnabled: $('#itWelcomeOn').checked,
          welcomeChannelId: $('#itWelcomeCh').value === 'none' ? '' : $('#itWelcomeCh').value,
          welcomeMessage: $('#itWelcomeMsg').value.trim(),
          welcomeImage: state.welcomeImage || '',
          onboarding: $('#itOnboarding').value.trim(),
          allowReactions: $('#itReact').checked,
        });
        state.detail.board = d.board;
        toast.success(T('settings.saved'));
      } catch (e) { toastError(e); } finally { App.busy(btn, false); saved = false; }
    };
  }

  /* ========================== 启动 ========================= */

  async function reload() {
    state.detail = await API.Boards.detail(BOARD_ID);
    $('#sideChName').textContent = state.detail.board.name;
    $('#backToChannel').href = '/channels.html?id=' + BOARD_ID;
    document.title = state.detail.board.name + ' · 版块管理 · MarytOpens';
    renderChannels();
  }

  App.boot({
    nav: 'channels',
    requireAuth: true,
    onReady: async function () {
      if (!BOARD_ID) {
        document.querySelector('.admin-main').innerHTML =
          App.emptyState('缺少版块参数', '请从版块列表进入管理面板。', 'alert',
            '<a class="btn btn-primary" href="/channels.html">' + T('bd.title') + '</a>');
        return;
      }
      bindPanes();
      bindDanger();
      $('#btnAddChannel').onclick = () => channelDialog(null);
      const bc = $('#btnBoardCommittee');
      if (bc) bc.onclick = () => {
        App.openCommitteeManager({
          list: () => API.Boards.committee(BOARD_ID),
          add: (data) => API.Boards.addCommittee(BOARD_ID, data),
          update: (uid, data) => API.Boards.updateCommittee(BOARD_ID, uid, data),
          remove: (uid) => API.Boards.removeCommittee(BOARD_ID, uid),
          setChairman: (uid) => API.Boards.setChairman(BOARD_ID, uid),
        });
      };
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
          App.emptyState(T('common.forbidden'), '你没有该版块的管理权限（需要 board.manage）。', 'lock',
            '<a class="btn btn-primary" href="/channels.html?id=' + BOARD_ID + '">返回版块</a>');
        return;
      }

      fillGeneral();
      state.scope = 'board:' + BOARD_ID;

      const tab = new URLSearchParams(location.search).get('tab');
      if (tab) openPane(tab); else onPaneEnter('general');
    },
  });
})();
