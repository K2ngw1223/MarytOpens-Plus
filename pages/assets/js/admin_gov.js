/* ==========================================================================
 * admin_gov.js — 认证/荣誉 + 选举与风纪 后台面板逻辑
 * ========================================================================== */
(function () {
  'use strict';
  const { $, $$, esc, toast, toastError } = App;
  const T = (k) => (global.I18N ? I18N.t(k) : k);
  let catalog = [];

  function renderCatalog() {
    const box = $('#honorCatalog');
    if (!catalog.length) { box.innerHTML = '<span class="empty-hint">' + T('honor.empty') + '</span>'; return; }
    box.innerHTML = catalog.map((b, i) =>
      '<div class="honor-edit-card" style="--hc:' + esc(b.color || '#6366f1') + '">' +
        '<div class="honor-preview" style="background:' + esc(b.color || '#6366f1') + '">' +
          '<span class="bp-icon">' + esc(b.icon || '★') + '</span><span>' + esc(b.name || '未命名') + '</span></div>' +
        '<div class="honor-fields">' +
          '<div class="row" style="gap:8px">' +
            '<div class="field" style="flex:1"><label class="label">名称</label><input class="input input-sm" data-hf="name" data-idx="' + i + '" value="' + esc(b.name || '') + '"></div>' +
            '<div class="field" style="flex:none;width:60px"><label class="label">图标</label><input class="input input-sm" data-hf="icon" data-idx="' + i + '" value="' + esc(b.icon || '') + '" style="text-align:center"></div>' +
            '<div class="field" style="flex:none;width:90px"><label class="label">颜色</label><input class="input input-sm" data-hf="color" data-idx="' + i + '" type="color" value="' + esc(b.color || '#6366f1') + '"></div>' +
            '<div class="field" style="flex:none;width:80px"><label class="label">级别</label><input class="input input-sm" data-hf="level" data-idx="' + i + '" type="number" value="' + esc(b.level || 0) + '" min="0" max="99"></div>' +
          '</div>' +
          '<div class="field"><label class="label">描述 / 获取条件</label><input class="input input-sm" data-hf="desc" data-idx="' + i + '" value="' + esc(b.desc || '') + '" placeholder="简短描述"></div>' +
          '<label class="label checkbox xsmall" style="height:auto"><input type="checkbox" data-hf="officialCert" data-idx="' + i + '"' + (b.officialCert ? ' checked' : '') + '> 官方认证类（仅官方账号可授予）</label>' +
          '<div style="text-align:right"><button class="btn btn-xs btn-danger" data-del="' + i + '">删除</button></div>' +
        '</div>' +
      '</div>'
    ).join('');

    box.querySelectorAll('[data-hf]').forEach((inp) => {
      const idx = +inp.dataset.idx;
      const field = inp.dataset.hf;
      inp.addEventListener('input', () => {
        const val = field === 'officialCert' ? inp.checked : field === 'level' ? Number(inp.value) || 0 : inp.value;
        catalog[idx][field] = val;
        if (field === 'name' || field === 'icon' || field === 'color') renderCatalog();
      });
    });
    box.querySelectorAll('[data-del]').forEach((x) => x.onclick = () => { catalog.splice(+x.dataset.del, 1); renderCatalog(); });

    const sel = $('#hgBadge');
    if (sel) sel.innerHTML = catalog.map((b, i) => '<option value="' + i + '">' + esc(b.name) + '</option>').join('');
  }

  async function loadCatalog() {
    try { const d = await API.Honors.catalog(); catalog = d.items || []; renderCatalog(); }
    catch (e) { $('#honorCatalog').innerHTML = '<span class="error-text">' + esc(e.message) + '</span>'; }
  }

  async function loadGov() {
    try {
      const d = await API.GovAdmin.disciplineMembers();
      const box = $('#govMembers');
      if (!d.items || !d.items.length) { box.innerHTML = '<span class="empty-hint">' + T('dc.empty') + '</span>'; return; }
      box.innerHTML = d.items.map((u) =>
        '<div class="gov-member-row">' +
          '<span class="row" style="gap:10px;align-items:center">' + App.avatar(u, 'sm') +
            '<span style="min-width:0"><b class="truncate">' + esc(u.displayName || u.username) + '</b>' +
            '<span class="muted2 small">@' + esc(u.username) + '</span></span></span>' +
          '<button class="btn btn-xs btn-soft" data-rm="' + esc(u.id) + '">' + (T('common.remove') || '移除') + '</button>' +
        '</div>'
      ).join('');
      box.querySelectorAll('[data-rm]').forEach((x) => x.onclick = async () => {
        try { await API.GovAdmin.setDisciplineMember({ userId: x.dataset.rm, action: 'remove' }); loadGov(); }
        catch (e) { toastError(e); }
      });
    } catch (e) { $('#govMembers').innerHTML = '<span class="error-text">' + esc(e.message) + '</span>'; }
  }

  function wire() {
    const addHonor = $('#btnAddHonor');
    if (addHonor) addHonor.onclick = () => { catalog.push({ name: '新荣誉', color: '#6366f1', icon: '★', desc: '', officialCert: false }); renderCatalog(); };
    const saveCat = $('#btnSaveHonorCatalog');
    if (saveCat) saveCat.onclick = async () => { try { await API.Honors.saveCatalog(catalog); toast.success(T('common.success')); } catch (e) { toastError(e); } };
    const grant = $('#btnGrantHonor');
    if (grant) grant.onclick = async () => {
      const uid = $('#hgUserId').value.trim();
      const idx = $('#hgBadge').value;
      if (!uid) { toast.warn(T('honor.userPH')); return; }
      const b = catalog[+idx]; if (!b) return;
      App.busy(grant, true);
      try {
        const d = await API.Honors.grant({ userId: uid, badge: { id: b.id, name: b.name, color: b.color, icon: b.icon, desc: b.desc, officialCert: !!b.officialCert } });
        $('#hgResult').textContent = T('honor.granted') + '：' + ((d.badges || []).length) + ' ' + T('honor.badgesOf');
        toast.success(T('honor.granted'));
      } catch (e) { toastError(e); } finally { App.busy(grant, false); }
    };
    const addGov = $('#btnAddGov');
    if (addGov) addGov.onclick = async () => {
      const uid = $('#gmUserId').value.trim(); if (!uid) { toast.warn(T('honor.userPH')); return; }
      try { await API.GovAdmin.setDisciplineMember({ userId: uid, action: 'add' }); toast.success(T('common.success')); $('#gmUserId').value = ''; loadGov(); }
      catch (e) { toastError(e); }
    };
    const refGov = $('#btnRefreshGov');
    if (refGov) refGov.onclick = loadGov;

    $$('#adminSide .side-item[data-pane="honors"], #adminSide .side-item[data-pane="gov"]').forEach((b) => {
      b.addEventListener('click', () => { if (b.dataset.pane === 'honors') loadCatalog(); else loadGov(); });
    });
  }

  function init() { if (App.Session.isSuperAdmin) { loadCatalog(); loadGov(); } }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
  document.addEventListener('session:ready', init);
  if (App.Session.ready) init();
})();
