/* MarytOpens · 用户文件存储 UI（绑定 Cloudflare / 本地兜底）
 * 依赖：App（$, el, icon, esc, toast, toastError, busy, modal, confirmDialog, copy）
 *       API.Storage（bindStart/status/unbind/files/upload/setShare/remove）
 */
(function () {
  const { $, el, icon, esc, toast, toastError, busy, modal, confirmDialog } = App;
  const T = (k, fb) => (global.I18N ? I18N.t(k) : (fb || k));
  const LS_KEY = 'mo_local_files';
  const MAX_LOCAL = 3 * 1024 * 1024; // 本地兜底仅建议小文件

  function fmtSize(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }

  function loadLocal() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; } }
  function saveLocal(arr) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); }
    catch (e) { toast.warn('本地存储空间不足，部分文件可能未被保存'); }
  }

  /* ------------------------------- 绑定卡片 ------------------------------- */
  function renderBind(bound, info) {
    const box = $('#bindCard');
    if (bound) {
      box.innerHTML = '<div class="card card-pad bind-card ok">' +
        '<div class="bc-icon">' + icon('cloud') + '</div>' +
        '<div class="bc-body"><div class="bc-title">' + T('files.bound', '已绑定 Cloudflare 账号') + '</div>' +
        '<div class="bc-sub muted">' + esc(info.accountName || '') + ' · KV ' + esc(info.kvId || '-') +
        (info.d1Id ? ' · D1 ' + esc(info.d1Id) : '') + '</div></div>' +
        '<button class="btn btn-ghost btn-sm" id="unbindBtn">' + T('files.unbind', '解绑') + '</button></div>';
      $('#unbindBtn').onclick = doUnbind;
      $('#warnLocal').classList.add('hidden');
    } else {
      box.innerHTML = '<div class="card card-pad bind-card">' +
        '<div class="bc-icon">' + icon('cloud') + '</div>' +
        '<div class="bc-body"><div class="bc-title">' + T('files.bindTitle', '绑定 Cloudflare 账号') + '</div>' +
        '<div class="bc-sub muted">' + T('files.bindDesc', '绑定后系统会在你的 Cloudflare 账户下自动创建 KV 命名空间与 D1 数据库，文件存于你自己的账户。') + '</div></div>' +
        '<button class="btn btn-primary btn-sm" id="bindBtn">' + icon('link') + T('files.bind', '绑定') + '</button></div>';
      $('#bindBtn').onclick = () => API.Storage.bindStart();
      $('#warnLocal').classList.remove('hidden');
    }
  }

  /* ------------------------------- 文件列表 ------------------------------- */
  function renderList(bound, files) {
    const mount = $('#fileList');
    if (!files.length) {
      mount.innerHTML = '<div class="text-center muted mt-6">' + icon('inbox') +
        ' <span>' + T('files.empty', '还没有文件') + '</span></div>';
      return;
    }
    mount.innerHTML = files.map((f) => {
      const share = bound ? location.origin + '/f/' + esc(f.owner) + '/' + esc(f.id) : '';
      const codeTag = f.previewCode ? ' <span class="badge badge-warn">' + icon('key') + T('files.coded', '预览码') + '</span>' : '';
      return '<div class="file-row" data-id="' + esc(f.id) + '">' +
        '<div class="fr-icon">' + icon('file') + '</div>' +
        '<div class="fr-body"><div class="fr-name">' + esc(f.name) + codeTag + '</div>' +
        '<div class="fr-sub muted">' + fmtSize(f.size) + ' · ' + esc(f.mime || '') + '</div>' +
        (bound ? '<div class="fr-link"><input class="input input-sm" readonly value="' + esc(share) + '"><button class="btn btn-sm" data-act="copy">' + icon('copy') + '</button></div>' : '') +
        '</div>' +
        '<div class="fr-actions">' +
          (bound ? '<button class="icon-btn" data-act="share" title="' + T('files.share', '分享/预览码') + '">' + icon('key') + '</button>' : '') +
          '<button class="icon-btn" data-act="del">' + icon('trash') + '</button>' +
        '</div></div>';
    }).join('');

    mount.querySelectorAll('.file-row').forEach((row) => {
      const id = row.dataset.id;
      const f = files.find((x) => x.id === id);
      row.querySelector('[data-act="del"]').onclick = () => doDelete(id, f);
      if (bound) {
        row.querySelector('[data-act="copy"]').onclick = () => App.copy(location.origin + '/f/' + f.owner + '/' + f.id);
        row.querySelector('[data-act="share"]').onclick = () => doShare(id, f);
      }
    });
  }

  /* ------------------------------- 操作 ---------------------------------- */
  async function doUnbind() {
    if (!await confirmDialog(T('files.unbindConfirm', '确定解绑？你 Cloudflare 账户中的存储资源将保留，但本站的分享记录会清除。'))) return;
    await API.Storage.unbind();
    toast.success(T('files.unbound', '已解绑'));
    await refresh();
  }

  async function doDelete(id, f) {
    if (!await confirmDialog(T('files.delConfirm', '确定删除该文件？'))) return;
    if (f.owner === 'local') {
      const arr = loadLocal().filter((x) => x.id !== id);
      saveLocal(arr); refreshLocal(arr);
      toast.success(T('common.deleted', '已删除'));
      return;
    }
    await API.Storage.remove(id);
    toast.success(T('common.deleted', '已删除'));
    await refresh();
  }

  function doShare(id, f) {
    const input = el('input', { class: 'input', placeholder: T('files.codePlaceholder', '留空则取消预览码'), maxlength: 64, value: f.previewCode && f.previewCode !== '••••' ? f.previewCode : '' });
    modal({
      title: T('files.shareTitle', '分享设置'),
      body: el('div', { class: 'field' }, [el('label', { class: 'label', text: T('files.previewCode', '预览码') }), input]),
      okText: T('common.save', '保存'),
      onOk: async () => {
        await API.Storage.setShare(id, input.value.trim());
        toast.success(T('common.saved', '已保存'));
        await refresh();
      },
    });
  }

  /* 未绑定：存本地 */
  function storeLocal(file) {
    if (file.size > MAX_LOCAL) toast.warn(T('files.localBig', '本地兜底仅建议小于 3MB 的文件，大文件请先绑定 Cloudflare。'));
    const reader = new FileReader();
    reader.onload = () => {
      const arr = loadLocal();
      arr.unshift({ id: 'l_' + Date.now().toString(36), name: file.name, mime: file.type, size: file.size, base64: reader.result, createdAt: Date.now(), owner: 'local' });
      saveLocal(arr);
      refreshLocal(arr);
      toast.success(T('files.savedLocal', '已保存到本地（更换设备/清缓存将丢失）'));
    };
    reader.readAsDataURL(file);
  }

  function refreshLocal(arr) {
    const files = (arr || loadLocal()).slice().sort((a, b) => b.createdAt - a.createdAt).map((f) => ({ ...f, id: f.id }));
    renderList(false, files);
  }

  /* 绑定：上传到用户 Cloudflare */
  async function uploadCf(file) {
    const previewCode = $('#previewCode').value.trim();
    const days = parseInt($('#expireDays').value || '0', 10);
    const expiresAt = days > 0 ? Date.now() + days * 86400000 : 0;
    const tip = el('div', { class: 'progress mt-2' }, [el('div', { class: 'bar', style: { width: '0%' } })]);
    $('#dropZone').appendChild(tip);
    try {
      const d = await API.Storage.upload(file, { name: file.name, previewCode, expiresAt }, (p) => { tip.firstChild.style.width = p + '%'; });
      toast.success(T('files.uploaded', '上传成功'));
      await refresh();
    } catch (e) { toastError(e); }
    finally { tip.remove(); }
  }

  async function refresh() {
    const d = await API.Storage.files();
    renderBind(!!d.bound, d);
    renderList(!!d.bound, d.files || []);
  }

  /* ------------------------------- 初始化 -------------------------------- */
  function initDropZone(bound) {
    const zone = $('#dropZone');
    const input = el('input', { type: 'file', style: { display: 'none' } });
    zone.appendChild(input);
    const pick = (f) => { if (bound) uploadCf(f); else storeLocal(f); };
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('dragover'); if (e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]); });
    input.addEventListener('change', () => { if (input.files[0]) pick(input.files[0]); input.value = ''; });
  }

  async function init() {
    const d = await API.Storage.status().catch(() => ({ bound: false }));
    renderBind(!!d.bound, d);
    initDropZone(!!d.bound);
    if (d.bound) {
      const fl = await API.Storage.files().catch(() => ({ files: [] }));
      renderList(true, fl.files || []);
    } else {
      refreshLocal();
    }
  }

  window.StorageUI = { init };
})();
