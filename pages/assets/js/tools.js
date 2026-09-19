/* MarytOpens · 小工具页面交互
 * 纯前端实现，不依赖后端。复用 App.markdown 做 Markdown 预览。
 */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const icon = (n) => (App && App.icon ? App.icon(n) : '');
  const md = (t) => (App && App.markdown ? App.markdown(t || '') : esc(t || ''));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rnd = (n) => Math.floor(Math.random() * n); // 0..n-1
  const pick = (arr) => arr[rnd(arr.length)];

  function setIcons() {
    const map = {
      icoDice: 'dice', icoCoin: 'coin', icoPick: 'shuffle', icoEat: 'food',
      icoCount: 'text', icoColor: 'palette', icoMd: 'markdown',
      icoPwd: 'key', icoUuid: 'at', icoTs: 'refresh', icoCase: 'text', icoBase: 'layers',
    };
    Object.keys(map).forEach((id) => { const e = $('#' + id); if (e) e.innerHTML = icon(map[id]); });
  }

  /* ---------- 掷骰子 ---------- */
  function initDice() {
    const btn = $('#diceRoll'); if (!btn) return;
    btn.addEventListener('click', () => {
      const count = parseInt($('#diceCount').value, 10) || 1;
      const sides = parseInt($('#diceSides').value, 10) || 6;
      const rolls = [];
      let sum = 0;
      for (let i = 0; i < count; i++) { const v = 1 + rnd(sides); rolls.push(v); sum += v; }
      const out = $('#diceResult');
      out.innerHTML = '<div class="dice-faces">' + rolls.map((v) => '<span class="die">' + v + '</span>').join('') + '</div>' +
        (count > 1 ? '<div class="muted mt-2">合计 <b>' + sum + '</b></div>' : '');
    });
  }

  /* ---------- 抛硬币 ---------- */
  function initCoin() {
    const btn = $('#coinFlip'); if (!btn) return;
    btn.addEventListener('click', () => {
      const r = Math.random() < 0.5;
      const out = $('#coinResult');
      out.innerHTML = '<span class="coin-face ' + (r ? 'heads' : 'tails') + '">' + (r ? '正面' : '反面') + '</span>';
    });
  }

  /* ---------- 随机抽签 ---------- */
  function initPicker() {
    const btn = $('#pickBtn'); if (!btn) return;
    btn.addEventListener('click', () => {
      const items = $('#pickList').value.split('\n').map((s) => s.trim()).filter(Boolean);
      const out = $('#pickResult');
      if (!items.length) { out.innerHTML = '<span class="muted">先填几个选项吧</span>'; return; }
      out.innerHTML = '<span class="picked">' + esc(pick(items)) + '</span>';
    });
  }

  /* ---------- 今天吃什么 ---------- */
  function initEat() {
    const btn = $('#eatBtn'); if (!btn) return;
    const DEFAULTS = ['火锅', '烧烤', '麻辣烫', '沙拉', '泡面', '盖饭', '麻辣香锅', '汉堡', '日料', '饺子'];
    btn.addEventListener('click', () => {
      const raw = $('#eatList').value.trim();
      const items = (raw ? raw.split('\n') : DEFAULTS).map((s) => s.trim()).filter(Boolean);
      const out = $('#eatResult');
      if (!items.length) { out.innerHTML = '<span class="muted">菜单是空的</span>'; return; }
      out.innerHTML = '<span class="picked">' + esc(pick(items)) + '</span>';
    });
  }

  /* ---------- 文字计数 ---------- */
  function initCounter() {
    const ta = $('#countInput'); if (!ta) return;
    const render = () => {
      const text = ta.value;
      const chars = text.length;
      const noSpace = text.replace(/\s/g, '').length;
      const words = (text.trim().match(/[A-Za-z0-9_\u00C0-\uFFFF]+/g) || []).length;
      const lines = text === '' ? 0 : text.split('\n').length;
      $('#cntChars').textContent = chars;
      $('#cntNoSpace').textContent = noSpace;
      $('#cntWords').textContent = words;
      $('#cntLines').textContent = lines;
    };
    ta.addEventListener('input', render);
    render();
  }

  /* ---------- 随机颜色 ---------- */
  function initColor() {
    const btn = $('#colorBtn'); if (!btn) return;
    const swatch = $('#colorSwatch');
    const hexEl = $('#colorHex');
    const gen = () => {
      let h = '#';
      for (let i = 0; i < 6; i++) h += '0123456789abcdef'[rnd(16)];
      swatch.style.background = h;
      hexEl.textContent = h;
    };
    btn.addEventListener('click', gen);
    gen();
    hexEl.addEventListener('click', () => {
      const v = hexEl.textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(v).then(() => {
        if (App.toast && App.toast.success) App.toast.success('已复制 ' + v);
      }).catch(() => {});
    });
  }

  /* ---------- Markdown 预览 ---------- */
  function initMd() {
    const ta = $('#mdInput'); if (!ta) return;
    const prev = $('#mdPreview');
    const render = () => {
      const v = ta.value.trim();
      if (!v) { prev.innerHTML = '<span class="muted">预览将显示在这里</span>'; return; }
      prev.innerHTML = md(v) || '<span class="muted">（空）</span>';
    };
    ta.addEventListener('input', render);
    render();
  }

  /* ---------- 密码生成器 ---------- */
  function initPassword() {
    const btn = $('#pwdGen'); if (!btn) return;
    const gen = () => {
      const len = Math.max(4, Math.min(64, parseInt($('#pwdLen').value, 10) || 16));
      const sets = [];
      if ($('#pwdUpper').checked) sets.push('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
      if ($('#pwdLower').checked) sets.push('abcdefghijklmnopqrstuvwxyz');
      if ($('#pwdNum').checked) sets.push('0123456789');
      if ($('#pwdSym').checked) sets.push('!@#$%^&*()-_=+[]{};:,.<>?');
      const out = $('#pwdResult');
      if (!sets.length) { out.textContent = '至少勾选一种字符'; return; }
      // 先保证每种字符至少出现一次，再随机填充，避免全为单一集合
      let pool = sets.join('');
      let pwd = sets.map((s) => s[rnd(s.length)]);
      while (pwd.length < len) pwd.push(pool[rnd(pool.length)]);
      pwd = pwd.map((c) => c);
      for (let i = pwd.length - 1; i > 0; i--) { const j = rnd(i + 1); const t = pwd[i]; pwd[i] = pwd[j]; pwd[j] = t; }
      out.textContent = pwd.join('').slice(0, len);
    };
    btn.addEventListener('click', gen);
    $('#pwdResult').addEventListener('click', () => copyText($('#pwdResult').textContent, '已复制密码'));
    gen();
  }

  /* ---------- UUID 生成器 ---------- */
  function initUuid() {
    const btn = $('#uuidGen'); if (!btn) return;
    const gen = () => {
      const n = Math.max(1, Math.min(20, parseInt($('#uuidCount').value, 10) || 3));
      const list = [];
      for (let i = 0; i < n; i++) list.push((crypto.randomUUID ? crypto.randomUUID() : ('xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = rnd(16); const v = c === 'x' ? r : (r & 0x3 | 0x8); return v.toString(16); }))));
      $('#uuidResult').innerHTML = list.map((u) => '<div class="uuid-line mono" data-uuid="' + esc(u) + '">' + esc(u) + '</div>').join('');
      $$('#uuidResult .uuid-line').forEach((el) => el.addEventListener('click', () => copyText(el.dataset.uuid, '已复制 UUID')));
    };
    btn.addEventListener('click', gen);
    gen();
  }

  /* ---------- 时间戳转换 ---------- */
  function initTimestamp() {
    const input = $('#tsInput'); const out = $('#tsResult'); if (!input) return;
    const render = () => {
      const v = input.value.trim();
      if (!v) { out.textContent = '—'; return; }
      const ts = Number(v);
      if (!ts) { out.textContent = '无效时间戳'; return; }
      // 兼容秒级 / 毫秒级
      const ms = v.length <= 10 ? ts * 1000 : ts;
      const d = new Date(ms);
      out.innerHTML = '<div>' + esc(d.toLocaleString()) + '</div>' +
        '<div class="muted small">ISO: ' + esc(d.toISOString()) + '</div>' +
        '<div class="muted small">相对: ' + esc(relTime(ms)) + '</div>';
    };
    input.addEventListener('input', render);
    $('#tsNow').addEventListener('click', () => { input.value = String(Math.floor(Date.now() / 1000)); render(); });
    render();
  }

  /* ---------- 文本大小写转换 ---------- */
  function initCase() {
    const input = $('#caseInput'); const out = $('#caseResult'); if (!input) return;
    const toTitle = (s) => s.replace(/\b\w+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    const toSentence = (s) => s.replace(/(^|[.!?]\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase());
    const apply = (mode) => {
      const v = input.value;
      if (!v) { out.textContent = '—'; return; }
      let r = v;
      if (mode === 'upper') r = v.toUpperCase();
      else if (mode === 'lower') r = v.toLowerCase();
      else if (mode === 'title') r = toTitle(v);
      else if (mode === 'sentence') r = toSentence(v);
      out.textContent = r;
    };
    document.querySelectorAll('[data-case]').forEach((b) => b.addEventListener('click', () => apply(b.dataset.case)));
    out.addEventListener('click', () => copyText(out.textContent, '已复制'));
  }

  /* ---------- 进制转换 ---------- */
  function initBase() {
    const input = $('#baseInput'); const out = $('#baseResult'); if (!input) return;
    const render = () => {
      const v = (input.value || '').trim();
      if (!v) { out.textContent = '—'; return; }
      const from = parseInt($('#baseFrom').value, 10);
      const to = parseInt($('#baseTo').value, 10);
      let num;
      try { num = parseInt(v, from); } catch (e) { num = NaN; }
      if (isNaN(num)) { out.textContent = '无效输入'; return; }
      let res = num.toString(to).toUpperCase();
      if (to === 16) res = '0x' + res;
      else if (to === 2) res = '0b' + res;
      out.textContent = res;
    };
    input.addEventListener('input', render);
    $('#baseFrom').addEventListener('change', render);
    $('#baseTo').addEventListener('change', render);
    out.addEventListener('click', () => copyText(out.textContent, '已复制'));
  }

  function copyText(text, msg) {
    if (!text || text === '—') return;
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => {
      if (App.toast && App.toast.success) App.toast.success(msg || '已复制');
    }).catch(() => {});
  }

  function relTime(ts) {
    const diff = Date.now() - ts;
    const abs = Math.abs(diff);
    const min = 60000, hr = 3600000, day = 86400000;
    if (abs < min) return '刚刚';
    if (abs < hr) return Math.floor(abs / min) + ' 分钟' + (diff < 0 ? '后' : '前');
    if (abs < day) return Math.floor(abs / hr) + ' 小时' + (diff < 0 ? '后' : '前');
    return Math.floor(abs / day) + ' 天' + (diff < 0 ? '后' : '前');
  }

  const ToolsUI = {
    init() {
      setIcons();
      initDice();
      initCoin();
      initPicker();
      initEat();
      initCounter();
      initColor();
      initMd();
      initPassword();
      initUuid();
      initTimestamp();
      initCase();
      initBase();
    },
  };

  window.ToolsUI = ToolsUI;
})();
