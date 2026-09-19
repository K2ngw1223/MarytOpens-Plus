/* ==========================================================================
 * MarytOpens Service Worker
 * --------------------------------------------------------------------------
 * 职责：
 *   1. Web Push 消息推送（push / notificationclick / pushsubscriptionchange）
 *   2. 后台常驻（periodicsync / sync）—— 定期拉取未读摘要并弹出系统通知
 *   3. 轻量离线兜底（仅导航请求 network-first，不缓存静态资源，避免版本错乱）
 *
 * 注册方式：navigator.serviceWorker.register('/sw.js?api=<API_BASE>')
 * 页面通过 postMessage({type:'mo-config', ...}) 同步 token / 语言。
 * ========================================================================== */

const SW_VERSION = 'mo-sw-v1';
const OFFLINE_CACHE = 'mo-offline-v1';
const CONFIG_CACHE = 'mo-config-v1';
const CONFIG_URL = 'https://marytopens.local/sw-config';
const DIGEST_TAG = 'mo-digest';

/* ----------------------------- 多语言字典 ------------------------------- */
/* 推送正文由服务端给出（原文），此处只本地化「标题 / 类型名 / 兜底文案」 */
const L = {
  'zh-CN': { app: 'MarytOpens', message: '新私信', friend: '好友申请', reply: '新回复', mention: '有人提到你', like: '收到点赞', follow: '新的关注者', group: '群组动态', system: '系统通知', unread: (n) => `你有 ${n} 条未读通知`, view: '查看', close: '关闭' },
  'zh-TW': { app: 'MarytOpens', message: '新私訊', friend: '好友申請', reply: '新回覆', mention: '有人提到你', like: '收到讚', follow: '新的追蹤者', group: '群組動態', system: '系統通知', unread: (n) => `你有 ${n} 則未讀通知`, view: '查看', close: '關閉' },
  en: { app: 'MarytOpens', message: 'New message', friend: 'Friend request', reply: 'New reply', mention: 'You were mentioned', like: 'New like', follow: 'New follower', group: 'Group activity', system: 'Notification', unread: (n) => `You have ${n} unread notifications`, view: 'View', close: 'Dismiss' },
  ja: { app: 'MarytOpens', message: '新しいメッセージ', friend: 'フレンド申請', reply: '新しい返信', mention: 'メンションされました', like: 'いいねが届きました', follow: '新しいフォロワー', group: 'グループの動き', system: 'お知らせ', unread: (n) => `未読の通知が ${n} 件あります`, view: '表示', close: '閉じる' },
  ko: { app: 'MarytOpens', message: '새 메시지', friend: '친구 요청', reply: '새 답글', mention: '나를 언급함', like: '좋아요 받음', follow: '새 팔로워', group: '그룹 활동', system: '알림', unread: (n) => `읽지 않은 알림 ${n}개`, view: '보기', close: '닫기' },
  ru: { app: 'MarytOpens', message: 'Новое сообщение', friend: 'Запрос в друзья', reply: 'Новый ответ', mention: 'Вас упомянули', like: 'Новый лайк', follow: 'Новый подписчик', group: 'Активность группы', system: 'Уведомление', unread: (n) => `У вас ${n} непрочитанных уведомлений`, view: 'Открыть', close: 'Закрыть' },
  de: { app: 'MarytOpens', message: 'Neue Nachricht', friend: 'Freundschaftsanfrage', reply: 'Neue Antwort', mention: 'Du wurdest erwähnt', like: 'Neues Like', follow: 'Neuer Follower', group: 'Gruppenaktivität', system: 'Benachrichtigung', unread: (n) => `Du hast ${n} ungelesene Benachrichtigungen`, view: 'Ansehen', close: 'Schließen' },
  fr: { app: 'MarytOpens', message: 'Nouveau message', friend: "Demande d'ami", reply: 'Nouvelle réponse', mention: 'Vous avez été mentionné', like: "Nouveau j'aime", follow: 'Nouvel abonné', group: 'Activité de groupe', system: 'Notification', unread: (n) => `Vous avez ${n} notifications non lues`, view: 'Voir', close: 'Fermer' },
  es: { app: 'MarytOpens', message: 'Nuevo mensaje', friend: 'Solicitud de amistad', reply: 'Nueva respuesta', mention: 'Te han mencionado', like: 'Nuevo me gusta', follow: 'Nuevo seguidor', group: 'Actividad del grupo', system: 'Notificación', unread: (n) => `Tienes ${n} notificaciones sin leer`, view: 'Ver', close: 'Cerrar' },
};
function dict(locale) { return L[locale] || L[String(locale || '').split('-')[0]] || L['zh-CN']; }

/* ------------------------------- 配置存取 -------------------------------- */

async function readConfig() {
  try {
    const c = await caches.open(CONFIG_CACHE);
    const r = await c.match(CONFIG_URL);
    if (!r) return {};
    return await r.json();
  } catch { return {}; }
}

async function writeConfig(patch) {
  const cur = await readConfig();
  const next = { ...cur, ...patch };
  const c = await caches.open(CONFIG_CACHE);
  await c.put(CONFIG_URL, new Response(JSON.stringify(next), { headers: { 'Content-Type': 'application/json' } }));
  return next;
}

function apiBase(cfg) {
  if (cfg && cfg.api) return String(cfg.api).replace(/\/$/, '');
  const q = new URL(self.location.href).searchParams.get('api');
  if (q) return q.replace(/\/$/, '');
  return 'https://api.example.com';
}

function b64urlToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

/* ------------------------------ 生命周期 --------------------------------- */

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    try {
      const c = await caches.open(OFFLINE_CACHE);
      await c.add(new Request('/offline.html', { cache: 'reload' }));
    } catch { /* 离线页缺失不影响推送能力 */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((n) => (n.startsWith('mo-') && n !== OFFLINE_CACHE && n !== CONFIG_CACHE) ? caches.delete(n) : null));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'mo-config') {
    e.waitUntil(writeConfig({
      api: d.api || undefined,
      token: d.token !== undefined ? d.token : undefined,
      locale: d.locale || undefined,
      background: d.background,
    }));
  } else if (d.type === 'mo-logout') {
    e.waitUntil(writeConfig({ token: '', lastUnread: 0 }));
  } else if (d.type === 'mo-skip-waiting') {
    self.skipWaiting();
  }
});

/* ------------------------------- 离线兜底 -------------------------------- */

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  e.respondWith((async () => {
    try {
      return await fetch(req);
    } catch {
      const c = await caches.open(OFFLINE_CACHE);
      return (await c.match('/offline.html')) || new Response('offline', { status: 503 });
    }
  })());
});

/* -------------------------------- 推送 ----------------------------------- */

self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    const cfg = await readConfig();
    const t = dict(cfg.locale);
    let p = {};
    try { p = e.data ? e.data.json() : {}; } catch { p = { body: e.data ? e.data.text() : '' }; }

    const typeName = t[p.type] || t.system;
    const title = p.title && p.title !== 'MarytOpens' ? p.title : `${t.app} · ${typeName}`;
    const body = p.body || (typeof p.unread === 'number' ? t.unread(p.unread) : typeName);

    if (typeof p.unread === 'number') await writeConfig({ lastUnread: p.unread });

    await self.registration.showNotification(title, {
      body,
      icon: '/assets/img/icon-192.png',
      badge: '/assets/img/badge-72.png',
      tag: p.tag || 'mo-notify',
      renotify: true,
      timestamp: p.ts || Date.now(),
      data: { link: p.link || '/notifications.html', notifId: p.notifId || '' },
      actions: [{ action: 'open', title: t.view }, { action: 'close', title: t.close }],
    });

    // 同步刷新已打开页面的未读角标
    const cls = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of cls) c.postMessage({ type: 'mo-push', payload: p });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  if (e.action === 'close') return;
  const link = (e.notification.data && e.notification.data.link) || '/notifications.html';
  e.waitUntil((async () => {
    const url = new URL(link, self.location.origin).href;
    const cls = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of cls) {
      if ('focus' in c) { await c.focus(); if ('navigate' in c) { try { await c.navigate(url); } catch { /* 忽略 */ } } return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});

/* 浏览器轮换订阅密钥时自动重新订阅并上报 */
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    const cfg = await readConfig();
    if (!cfg.publicKey) return;
    try {
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64urlToBytes(cfg.publicKey),
      });
      await fetch(`${apiBase(cfg)}/api/push/subscribe`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(cfg.token ? { Authorization: 'Bearer ' + cfg.token } : {}) },
        body: JSON.stringify({ subscription: sub.toJSON(), background: !!cfg.background }),
      });
    } catch { /* 静默失败，下次进入站点会重新订阅 */ }
  })());
});

/* ----------------------------- 后台常驻轮询 ------------------------------- */

async function runDigest() {
  const cfg = await readConfig();
  if (!cfg.token) return;
  let data;
  try {
    const r = await fetch(`${apiBase(cfg)}/api/push/digest`, {
      credentials: 'include',
      headers: { Authorization: 'Bearer ' + cfg.token },
    });
    if (!r.ok) return;
    data = await r.json();
  } catch { return; }
  if (!data || !data.ok) return;

  const unread = data.unread || 0;
  const last = cfg.lastUnread || 0;
  await writeConfig({ lastUnread: unread, lastDigestAt: Date.now() });
  if (unread <= last || unread === 0) return;

  const t = dict(cfg.locale);
  const n = data.latest;
  await self.registration.showNotification(
    n && n.title ? n.title : `${t.app} · ${t.system}`,
    {
      body: n && n.body ? n.body : t.unread(unread),
      icon: '/assets/img/icon-192.png',
      badge: '/assets/img/badge-72.png',
      tag: 'mo-digest',
      renotify: false,
      data: { link: (n && n.link) || '/notifications.html' },
    },
  );
}

self.addEventListener('periodicsync', (e) => {
  if (e.tag === DIGEST_TAG) e.waitUntil(runDigest());
});

self.addEventListener('sync', (e) => {
  if (e.tag === DIGEST_TAG) e.waitUntil(runDigest());
});
