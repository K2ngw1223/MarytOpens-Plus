'use strict';

/**
 * MarytOpens 机器人 API 客户端。
 * 基址默认 https://api.natrois.top，所有请求通过 X-Bot-Token 头鉴权。
 * 对应 Worker 路由：/api/bot/*
 */
const API_BASE_DEFAULT = 'https://api.natrois.top';

class MarytOpensClient {
  constructor({ apiBase, botToken } = {}) {
    this.apiBase = (apiBase || API_BASE_DEFAULT).replace(/\/+$/, '');
    this.botToken = botToken || '';
  }

  _headers() {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Bot-Token': this.botToken,
    };
  }

  async _req(method, path, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    let res;
    try {
      res = await fetch(this.apiBase + path, {
        method,
        headers: this._headers(),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('请求超时（30s）：' + path);
      throw new Error('网络错误：' + (e.message || e));
    }
    clearTimeout(timer);

    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok || (data && data.ok === false)) {
      const msg = (data && (data.message || (data.error && data.error.message)))
        || ('HTTP ' + res.status);
      throw new Error('MarytOpens API ' + method + ' ' + path + ' 失败: ' + msg);
    }
    return data;
  }

  /** GET /api/bot/whoami —— 查询当前机器人身份与权限 */
  whoami() {
    return this._req('GET', '/api/bot/whoami');
  }

  /**
   * POST /api/bot/posts —— 以指定作者身份发布文章
   * @param {object} p
   * @param {string} p.authorId  作者用户 ID（必须系统中存在）
   * @param {string} p.title     标题（≤200 字符）
   * @param {string} p.content   正文（Markdown）
   * @param {string[]} [p.tags]  标签（≤8）
   * @param {string} [p.board]   板块，默认 general
   * @param {string} [p.scope]   作用域，默认 global
   */
  createPost({ authorId, title, content, tags, board, scope }) {
    return this._req('POST', '/api/bot/posts', {
      authorId,
      title,
      content,
      tags: tags || [],
      board: board || 'general',
      scope: scope || 'global',
    });
  }

  /**
   * POST /api/bot/notify —— 向指定用户推送站内通知
   * @param {object} p
   * @param {string} p.userId  目标用户 ID
   * @param {string} p.title   通知标题（≤100）
   * @param {string} [p.body]  通知正文（≤400）
   * @param {string} [p.link]  跳转链接
   */
  notify({ userId, title, body, link }) {
    return this._req('POST', '/api/bot/notify', {
      userId,
      title,
      body: body || '',
      link: link || '',
    });
  }

  /**
   * POST /api/bot/moderate —— 审核操作
   * @param {object} p
   * @param {string} p.postId  文章 ID
   * @param {'delete'|'lock'|'pin'} p.action
   * @param {string} [p.reason] 原因（≤200）
   */
  moderate({ postId, action, reason }) {
    return this._req('POST', '/api/bot/moderate', {
      postId,
      action,
      reason: reason || '',
    });
  }

  /**
   * GET /api/bot/feed —— 拉取最新公开文章
   * @param {object} [opts]
   * @param {number} [opts.since] 仅返回 createdAt 大于该时间戳的文章
   * @param {number} [opts.limit] 数量 1-100
   */
  feed({ since, limit } = {}) {
    const qs = new URLSearchParams();
    if (since) qs.set('since', String(since));
    if (limit) qs.set('limit', String(limit));
    const q = qs.toString();
    return this._req('GET', '/api/bot/feed' + (q ? '?' + q : ''));
  }
}

module.exports = { MarytOpensClient, API_BASE_DEFAULT };
