/* MarytOpens · 社区意见反馈中心（前端）
 * 展示超管配置的说明与渠道，并提供提交反馈表单（后端存储 + 可选邮件通知）。
 */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (n) => (App && App.icon ? App.icon(n) : '');
  const toast = App.toast;
  const T = () => (global.I18N ? I18N.t.bind(I18N) : (k) => k);

  function render() {
    const cfg = (App.Site && App.Site.cfg) || {};
    const fb = cfg.feedback || {};
    const links = cfg.links || {};
    const T = window.I18N ? I18N.t.bind(I18N) : (k) => k;
    const md = (fb.markdown || '').trim();
    $('#fcIntro').innerHTML = md ? App.markdown(md) : '<p class="muted">欢迎在这里提出你的意见与建议。</p>';

    const ch = [];
    // 私信官方账号（未登录会被 messages.html 重定向到登录，登录后回跳至此并直接打开会话）
    if (fb.officialUsername) {
      ch.push(channel({
        ic: 'message',
        title: T('feedback.channel.dmOfficial'),
        sub: T('feedback.channel.dmOfficialSub'),
        href: '/messages.html?to=' + encodeURIComponent(fb.officialUsername),
      }));
    }
    // 加入 Telegram 频道
    if (links.telegram) {
      ch.push(channel({
        ic: 'telegram',
        title: T('feedback.channel.joinTelegram'),
        sub: T('feedback.channel.joinTelegramSub'),
        href: App.safeURL(links.telegram),
        avatar: links.telegramAvatar || '',
        external: true,
      }));
    }
    // 发送邮件
    if (fb.email) {
      ch.push(channel({
        ic: 'mail',
        title: T('feedback.channel.email'),
        sub: T('feedback.channel.emailSub'),
        href: 'mailto:' + esc(fb.email),
      }));
    }
    $('#fcChannels').innerHTML = ch.length ? ch.join('') : '<p class="muted">暂无额外渠道，可直接使用下方表单。</p>';
  }

  function channel(o) {
    const external = o.external || /^https?:/i.test(o.href);
    const lead = o.avatar
      ? '<img class="fc-avatar" src="' + esc(App.tgAvatarURL(o.avatar)) + '" alt="" onerror="this.style.display=\'none\'">'
      : '<span class="fc-ico">' + icon(o.ic) + '</span>';
    return '<a class="fc-channel" href="' + esc(o.href) + '"' + (external ? ' target="_blank" rel="noopener"' : '') + '>' +
      lead +
      '<span class="fc-text"><b>' + esc(o.title) + '</b><span class="small muted">' + esc(o.sub) + '</span></span>' +
      '<span class="fc-go">' + icon('arrow-right') + '</span></a>';
  }

  async function submit(e) {
    e.preventDefault();
    const msg = $('#fcMessage').value.trim();
    if (msg.length < 2) { toast.warn('请填写反馈内容'); return; }
    const btn = $('#fcSubmit'); btn.disabled = true;
    try {
      await API.Feedback.submit({
        type: $('#fcType').value,
        message: msg,
        contact: $('#fcContact').value.trim(),
      });
      $('#fcResult').innerHTML = '<div class="alert alert-ok">✓ 已收到你的反馈，感谢支持！</div>';
      $('#fcForm').reset();
    } catch (err) {
      $('#fcResult').innerHTML = '<div class="alert alert-err">提交失败：' + esc(err.message || err) + '</div>';
    } finally { btn.disabled = false; }
  }

  const FeedbackCenter = {
    init() {
      render();
      $('#fcForm').addEventListener('submit', submit);
    },
  };
  window.FeedbackCenter = FeedbackCenter;
})();
