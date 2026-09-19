/* MeowCrypt —— MarytOpens 前端端到端加密（与 Worker 端 PawCrypt 同源算法）
 * 协议：MeowLink 信封  meowlink:<v>.<base64url(json({proto,alg,kdf,iter,salt,iv,ct}))>
 * 算法：PBKDF2-SHA256（100000 迭代，兼容 Cloudflare Workers 硬上限）+ AES-256-GCM
 * 设计目标：密钥仅由用户掌握（可经 MeowSync 本地代理托管），服务端只存密文——
 *         即便是用户自己，没有正确口令 / 设备密钥也解不开（满足「用户自己都解密不了」）。
 */
(function (global) {
  'use strict';
  const te = new TextEncoder();
  const td = new TextDecoder();
  const PAWCRYPT_ITER = 100000;

  function b64urlEncode(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(str) {
    const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
    const bin = atob(s + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function rand(n) { return crypto.getRandomValues(new Uint8Array(n)); }

  async function deriveKey(passphrase, salt) {
    const base = await crypto.subtle.importKey('raw', te.encode(String(passphrase)), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PAWCRYPT_ITER, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function encrypt(passphrase, plaintext) {
    if (typeof crypto === 'undefined' || !crypto.subtle) throw new Error('当前环境不支持 WebCrypto');
    const salt = rand(16);
    const iv = rand(12);
    const key = await deriveKey(passphrase, salt);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(String(plaintext))));
    const env = {
      v: 1, proto: 'MeowLink', alg: 'PawCrypt-AES256-GCM', kdf: 'PBKDF2-SHA256',
      iter: PAWCRYPT_ITER, salt: b64urlEncode(salt), iv: b64urlEncode(iv), ct: b64urlEncode(ct),
    };
    return 'meowlink:' + b64urlEncode(te.encode(JSON.stringify(env)));
  }

  async function decrypt(passphrase, packed) {
    try {
      const s = String(packed || '');
      if (!s.startsWith('meowlink:')) return null;
      const env = JSON.parse(td.decode(b64urlDecode(s.slice('meowlink:'.length))));
      if (!env || env.proto !== 'MeowLink' || !env.salt || !env.iv || !env.ct) return null;
      const key = await deriveKey(passphrase, b64urlDecode(env.salt));
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64urlDecode(env.iv) }, key, b64urlDecode(env.ct));
      return td.decode(pt);
    } catch (e) { return null; }
  }

  async function fingerprint(passphrase) {
    // 用于本地校验「两次输入的口令一致」，不离开浏览器
    const d = await crypto.subtle.digest('SHA-256', te.encode('mo:' + String(passphrase)));
    return b64urlEncode(d).slice(0, 12);
  }

  global.MeowCrypt = { encrypt, decrypt, fingerprint, PAWCRYPT_ITER, proto: 'MeowLink' };
})(window);
