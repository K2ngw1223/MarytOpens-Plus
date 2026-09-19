/* MarytOpens · 问卷 / 调研系统（前端）
 * 管理层（超管 / 站点管理员 / 官方账号）可发布问卷；普通用户可填写。
 */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const toast = App.toast;
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (n) => (App && App.icon ? App.icon(n) : '');
  const T = () => (global.I18N ? I18N.t.bind(I18N) : (k) => k);
  const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString() : '');

  let state = { canManage: false, status: 'open' };

  async function loadList() {
    const list = $('#surveyList');
    list.innerHTML = '<div class="skeleton-list">' + Array(3).fill('<div class="skeleton-card"></div>').join('') + '</div>';
    try {
      const d = await API.Survey.list({ status: state.canManage ? state.status : 'open' });
      state.canManage = !!d.canManage;
      renderList(d.surveys || []);
      $('#btnNewSurvey').hidden = !state.canManage;
      renderTabs();
    } catch (e) { list.innerHTML = '<div class="card card-pad muted">加载失败：' + esc(e.message || e) + '</div>'; }
  }

  function renderTabs() {
    const tabs = $('#surveyTabs');
    if (!state.canManage) { tabs.innerHTML = ''; return; }
    const items = [['open', '进行中'], ['all', '全部'], ['closed', '已结束']];
    tabs.innerHTML = items.map(([k, label]) =>
      '<button class="chip' + (state.status === k ? ' active' : '') + '" data-st="' + k + '">' + label + '</button>').join('');
    $$('#surveyTabs .chip').forEach((b) => b.addEventListener('click', () => {
      state.status = b.dataset.st; loadList();
    }));
  }

  function renderList(surveys) {
    const list = $('#surveyList');
    if (!surveys.length) { list.innerHTML = '<div class="card card-pad muted">暂无问卷。</div>'; return; }
    list.innerHTML = surveys.map((s) => {
      const badge = s.status === 'open'
        ? '<span class="badge badge-ok">进行中</span>'
        : '<span class="badge badge-warn">已结束</span>';
      const action = s.answered
        ? '<button class="btn btn-sm btn-soft" data-view="' + s.id + '">查看我的回答</button>'
        : (s.status === 'open'
          ? '<button class="btn btn-sm btn-primary" data-view="' + s.id + '">填写</button>'
          : '<button class="btn btn-sm btn-ghost" data-view="' + s.id + '">查看</button>');
      const stat = state.canManage ? ' · ' + (s.responseCount || 0) + ' 份回答' : '';
      return '<div class="card card-pad survey-card">' +
        '<div class="row-between wrap" style="gap:8px"><h3 style="margin:0">' + esc(s.title) + '</h3>' + badge + '</div>' +
        (s.description ? '<p class="muted mt-2">' + esc(s.description) + '</p>' : '') +
        '<div class="small muted2 mt-2">' + (s.questionCount || 0) + ' 题' + stat +
          (s.authorName ? ' · 由 ' + esc(s.authorName) + ' 发布' : '') + '</div>' +
        '<div class="mt-3">' + action + '</div>' +
      '</div>';
    }).join('');
    $$('#surveyList [data-view]').forEach((b) => b.addEventListener('click', () => openSurvey(b.dataset.view)));
  }

  async function openSurvey(id) {
    const det = $('#surveyDetail');
    det.classList.remove('hidden');
    det.innerHTML = '<div class="card card-pad muted">加载中…</div>';
    $('#surveyList').scrollIntoView({ behavior: 'smooth' });
    try {
      const d = await API.Survey.get(id);
      const s = d.survey;
      const qHtml = (s.questions || []).map((q, i) => questionHTML(q, i, d.myResponse)).join('');
      const foot = [];
      if (s.status === 'open') foot.push('<button class="btn btn-primary" id="surveySubmit">' + (d.answered ? '更新提交' : '提交') + '</button>');
      if (state.canManage) foot.push('<button class="btn btn-ghost" id="surveyResults">查看统计</button>');
      if (state.canManage && s.status === 'open') foot.push('<button class="btn btn-ghost" id="surveyClose">结束问卷</button>');
      if (state.canManage) foot.push('<button class="btn btn-ghost btn-danger" id="surveyDelete">删除</button>');
      det.innerHTML =
        '<div class="card card-pad">' +
          '<button class="btn btn-ghost btn-sm mb-3" id="surveyBack">' + icon('arrow-left') + ' 返回</button>' +
          '<div class="row-between wrap" style="gap:8px"><h2 style="margin:0">' + esc(s.title) + '</h2>' +
            (s.status === 'open' ? '<span class="badge badge-ok">进行中</span>' : '<span class="badge badge-warn">已结束</span>') + '</div>' +
          (s.description ? '<p class="muted mt-2">' + esc(s.description) + '</p>' : '') +
          '<div class="small muted2 mt-2">' + (s.responseCount || 0) + ' 份回答' + (s.authorName ? ' · ' + esc(s.authorName) : '') + '</div>' +
          '<form id="surveyForm" class="mt-4">' + qHtml + '</form>' +
          (foot.length ? '<div class="mt-4" style="display:flex;gap:8px;flex-wrap:wrap">' + foot.join('') + '</div>' : '') +
        '</div>';

      $('#surveyBack').addEventListener('click', () => { det.classList.add('hidden'); det.innerHTML = ''; });
      if (s.status === 'open') $('#surveySubmit').addEventListener('click', () => submitSurvey(s));
      if (state.canManage) {
        const rb = $('#surveyResults'); if (rb) rb.addEventListener('click', () => showResults(s.id));
        const cb = $('#surveyClose'); if (cb) cb.addEventListener('click', async () => { await API.Survey.close(s.id); toast.success('已结束'); loadList(); det.classList.add('hidden'); });
        const db = $('#surveyDelete'); if (db) db.addEventListener('click', async () => {
          if (!confirm('确认删除该问卷？此操作不可恢复。')) return;
          await API.Survey.remove(s.id); toast.success('已删除'); loadList(); det.classList.add('hidden');
        });
      }
    } catch (e) { det.innerHTML = '<div class="card card-pad muted">加载失败：' + esc(e.message || e) + '</div>'; }
  }

  function questionHTML(q, i, myResponse) {
    const prev = myResponse ? myResponse[q.id] : null;
    let inner = '';
    if (q.type === 'text') {
      inner = '<textarea class="textarea" name="q' + i + '" data-qid="' + q.id + '" rows="3" placeholder="请输入…">' + esc(prev || '') + '</textarea>';
    } else if (q.type === 'single') {
      inner = (q.options || []).map((o, j) =>
        '<label class="opt"><input type="radio" name="q' + i + '" data-qid="' + q.id + '" value="' + esc(o) + '"' + (prev === o ? ' checked' : '') + '> <span>' + esc(o) + '</span></label>').join('');
    } else {
      const arr = Array.isArray(prev) ? prev : [];
      inner = (q.options || []).map((o) =>
        '<label class="opt"><input type="checkbox" name="q' + i + '" data-qid="' + q.id + '" value="' + esc(o) + '"' + (arr.includes(o) ? ' checked' : '') + '> <span>' + esc(o) + '</span></label>').join('');
    }
    return '<div class="survey-q">' +
      '<div class="sq-title">' + (i + 1) + '. ' + esc(q.title) + (q.required ? ' <span class="req">*</span>' : '') + '</div>' +
      '<div class="sq-body">' + inner + '</div></div>';
  }

  async function submitSurvey(s) {
    const form = $('#surveyForm');
    const answers = $$('[data-qid]', form).map((el) => {
      const qid = el.dataset.qid;
      if (el.type === 'checkbox') return null; // 多选单独处理
      return { qid, value: el.value };
    }).filter(Boolean);
    // 多选
    const multi = {};
    $$('input[type=checkbox][data-qid]', form).forEach((el) => {
      if (!multi[el.dataset.qid]) multi[el.dataset.qid] = [];
      if (el.checked) multi[el.dataset.qid].push(el.value);
    });
    Object.keys(multi).forEach((qid) => answers.push({ qid, value: multi[qid] }));
    try {
      await API.Survey.respond(s.id, { answers });
      toast.success('提交成功，感谢参与！');
      loadList(); $('#surveyDetail').classList.add('hidden');
    } catch (e) { toast.error(e.message || '提交失败'); }
  }

  async function showResults(id) {
    const det = $('#surveyDetail');
    try {
      const d = await API.Survey.results(id);
      const s = d.survey;
      const counts = {};
      (d.responses || []).forEach((r) => {
        (s.questions || []).forEach((q) => {
          const a = r.answers ? r.answers[q.id] : null;
          if (a == null) return;
          if (Array.isArray(a)) a.forEach((v) => { counts[q.id] = counts[q.id] || {}; counts[q.id][v] = (counts[q.id][v] || 0) + 1; });
          else { counts[q.id] = counts[q.id] || {}; counts[q.id][a] = (counts[q.id][a] || 0) + 1; }
        });
      });
      const total = d.responseCount || (d.responses || []).length;
      const html = (s.questions || []).map((q, i) => {
        const c = counts[q.id] || {};
        let body = '';
        if (q.type === 'text') {
          body = '<p class="muted small">共 ' + total + ' 份文本回答（明细略）</p>';
        } else {
          body = (q.options || []).map((o) => {
            const n = c[o] || 0; const pct = total ? Math.round(n / total * 100) : 0;
            return '<div class="poll-row"><div class="poll-label">' + esc(o) + '</div>' +
              '<div class="poll-bar"><span style="width:' + pct + '%"></span></div>' +
              '<div class="poll-num">' + n + ' (' + pct + '%)</div></div>';
          }).join('');
        }
        return '<div class="survey-q"><div class="sq-title">' + (i + 1) + '. ' + esc(q.title) + '</div><div class="sq-body">' + body + '</div></div>';
      }).join('');
      det.innerHTML = '<div class="card card-pad">' +
        '<button class="btn btn-ghost btn-sm mb-3" id="surveyBack">' + icon('arrow-left') + ' 返回</button>' +
        '<h2 style="margin:0 0 4px">' + esc(s.title) + ' · 统计</h2>' +
        '<div class="small muted2">共 ' + total + ' 份回答</div>' + html + '</div>';
      $('#surveyBack').addEventListener('click', () => { det.classList.add('hidden'); det.innerHTML = ''; });
    } catch (e) { toast.error(e.message || '加载统计失败'); }
  }

  /* ----------------------------- 发布问卷（管理层） ----------------------------- */
  function openCreate() {
    const body = App.el('div', { class: 'survey-create' });
    body.innerHTML =
      '<div class="field"><label class="label">标题</label><input class="input" id="scTitle" maxlength="200" placeholder="问卷标题"></div>' +
      '<div class="field"><label class="label">简介（可选）</label><textarea class="textarea" id="scDesc" rows="2" maxlength="2000" placeholder="一句话说明用途"></textarea></div>' +
      '<div class="field"><label class="label">题目</label><div id="scQuestions"></div>' +
        '<button class="btn btn-ghost btn-sm mt-2" id="scAddQ" type="button">' + icon('plus') + ' 添加题目</button></div>';
    const modal = App.modal({ title: '新建问卷', body, okText: '发布', onOk: submitCreate });
    const qWrap = body.querySelector('#scQuestions');
    const addQ = () => {
      const row = App.el('div', { class: 'q-editor' });
      row.innerHTML =
        '<div class="q-row"><select class="select q-type"><option value="single">单选</option><option value="multiple">多选</option><option value="text">填空</option></select>' +
        '<input class="input q-title" placeholder="题目" maxlength="200">' +
        '<button class="btn btn-ghost btn-sm q-del" type="button">×</button></div>' +
        '<textarea class="textarea q-opts" rows="2" placeholder="选项，每行一个（填空题留空）"></textarea>';
      row.querySelector('.q-del').addEventListener('click', () => row.remove());
      qWrap.appendChild(row);
    };
    addQ();
    body.querySelector('#scAddQ').addEventListener('click', addQ);

    async function submitCreate() {
      const title = body.querySelector('#scTitle').value.trim();
      if (title.length < 2) { toast.error('标题至少 2 个字符'); return false; }
      const questions = $$('#scQuestions .q-editor', body).map((r) => ({
        type: r.querySelector('.q-type').value,
        title: r.querySelector('.q-title').value.trim(),
        required: false,
        options: r.querySelector('.q-type').value === 'text' ? [] : r.querySelector('.q-opts').value.split('\n').map((x) => x.trim()).filter(Boolean),
      })).filter((q) => q.title);
      if (!questions.length) { toast.error('至少需要 1 道有效题目'); return false; }
      try {
        await API.Survey.create({ title, description: body.querySelector('#scDesc').value.trim(), questions });
        toast.success('问卷已发布');
        loadList();
        return true;
      } catch (e) { toast.error(e.message || '发布失败'); return false; }
    }
  }

  const SurveysUI = {
    init() {
      $('#btnNewSurveyIco').innerHTML = icon('plus');
      $('#btnNewSurvey').addEventListener('click', openCreate);
      loadList();
    },
  };
  window.SurveysUI = SurveysUI;
})();
