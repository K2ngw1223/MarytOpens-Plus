#!/usr/bin/env node
/**
 * MarytOpens · 前端 Pages 直传部署（不依赖 wrangler，网络走 curl）
 *
 * 与 deploy-api.mjs 同源的原因：本机 TUN 代理按进程分流，node.exe 未被接管，
 * Node fetch 连 api.cloudflare.com 会 ECONNRESET，故所有网络请求交给 curl。
 *
 * 用法（在 worker/ 目录）：
 *   CLOUDFLARE_API_TOKEN=xxx CF_ACCOUNT_ID=xxx node scripts/deploy-pages.mjs [--takeover]
 *
 *   --takeover  把根域 natrois.top 从占用它的 Worker 上解绑，改绑到本 Pages 项目
 *
 * 流程（Cloudflare Pages Direct Upload）：
 *   1. 确保 Pages 项目存在
 *   2. 取 upload-token（JWT）
 *   3. blake3 计算每个文件哈希 → check-missing → 只传缺失的
 *   4. POST /pages/assets/upload 批量上传
 *   5. POST .../deployments 提交 manifest，生成正式部署
 *   6. （可选）接管自定义域
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { hash as blake3hash } from 'blake3-wasm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const projectRoot = resolve(root, '..');
const pagesDir = resolve(projectRoot, 'pages');

const TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const ACCOUNT = process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || '';
const PROJECT = process.env.PAGES_PROJECT || 'marytopens';
const DOMAIN = process.env.PAGES_DOMAIN || 'natrois.top';
const TAKEOVER = process.argv.includes('--takeover');
if (!TOKEN || !ACCOUNT) { console.error('✗ 缺少 CLOUDFLARE_API_TOKEN / CF_ACCOUNT_ID'); process.exit(1); }

const API = 'https://api.cloudflare.com/client/v4';
const tmpFiles = [];
function tmpJson(data) {
  const p = resolve(tmpdir(), `mo-p-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data));
  tmpFiles.push(p);
  return p;
}
function cleanup() { for (const f of tmpFiles) { try { unlinkSync(f); } catch {} } tmpFiles.length = 0; }

function req(method, url, { json, form, bearer } = {}) {
  const args = ['-s', '-X', method, url, '-H', `Authorization: Bearer ${bearer || TOKEN}`];
  if (json !== undefined) args.push('-H', 'Content-Type: application/json', '--data-binary', `@${tmpJson(json)}`);
  if (form) for (const f of form) args.push('-F', f);
  const r = spawnSync('curl', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const out = (r.stdout || '').trim();
  // DELETE 等接口成功时会返回 204 空体，不能当成失败
  if (!out) return { success: r.status === 0, result: null, errors: [] };
  try { return JSON.parse(out); } catch {
    return { success: false, errors: [{ message: `非 JSON 响应: ${out.slice(0, 300) || r.stderr}` }] };
  }
}

const MIME = {
  html: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', txt: 'text/plain', map: 'application/json',
};

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

console.log('=== MarytOpens 前端部署（Pages Direct Upload）===');

// ---- 1. 确保项目存在 ----
console.log(`\n[1/6] 检查 Pages 项目 ${PROJECT} ...`);
let proj = req('GET', `${API}/accounts/${ACCOUNT}/pages/projects/${PROJECT}`);
if (!proj.success) {
  console.log('  · 不存在，创建中 ...');
  proj = req('POST', `${API}/accounts/${ACCOUNT}/pages/projects`, {
    json: { name: PROJECT, production_branch: 'main' },
  });
  if (!proj.success) { console.error('✗ 创建项目失败：' + JSON.stringify(proj.errors)); cleanup(); process.exit(1); }
  console.log('  ✓ 已创建');
} else console.log('  ✓ 已存在');
const subdomain = proj.result.subdomain;

// ---- 2. 计算文件哈希 ----
console.log('\n[2/6] 扫描并哈希前端文件 ...');
const files = walk(pagesDir);
const entries = files.map((abs) => {
  const content = readFileSync(abs);
  const b64 = content.toString('base64');
  const ext = basename(abs).includes('.') ? basename(abs).split('.').pop() : '';
  // Cloudflare Pages 的哈希算法：blake3(base64内容 + 扩展名) 取前 32 位 hex
  const h = blake3hash(b64 + ext).toString('hex').slice(0, 32);
  const rel = '/' + relative(pagesDir, abs).split(/[\\/]/).join('/');
  return { abs, rel, b64, hash: h, contentType: MIME[ext] || 'application/octet-stream', size: content.length };
});
console.log(`  ✓ ${entries.length} 个文件，共 ${(entries.reduce((a, e) => a + e.size, 0) / 1024).toFixed(0)} KB`);

// ---- 3. 取上传令牌 ----
console.log('\n[3/6] 获取上传令牌 ...');
const tk = req('GET', `${API}/accounts/${ACCOUNT}/pages/projects/${PROJECT}/upload-token`);
if (!tk.success) { console.error('✗ 获取失败：' + JSON.stringify(tk.errors)); cleanup(); process.exit(1); }
const jwt = tk.result.jwt;
console.log('  ✓ 已获取');

// ---- 4. 查缺 + 上传 ----
console.log('\n[4/6] 检查需上传的文件 ...');
const miss = req('POST', `${API}/pages/assets/check-missing`, {
  json: { hashes: entries.map((e) => e.hash) }, bearer: jwt,
});
const missing = miss.success ? miss.result : entries.map((e) => e.hash);
console.log(`  · 需上传 ${missing.length} / ${entries.length} 个`);

if (missing.length) {
  const set = new Set(missing);
  const todo = entries.filter((e) => set.has(e.hash));
  // 分批：每批不超过 ~8MB 或 100 个文件
  const batches = [];
  let cur = [], curSize = 0;
  for (const e of todo) {
    if (cur.length >= 100 || curSize + e.b64.length > 8 * 1024 * 1024) { batches.push(cur); cur = []; curSize = 0; }
    cur.push(e); curSize += e.b64.length;
  }
  if (cur.length) batches.push(cur);

  for (let i = 0; i < batches.length; i++) {
    const payload = batches[i].map((e) => ({
      key: e.hash, value: e.b64, metadata: { contentType: e.contentType }, base64: true,
    }));
    const up = req('POST', `${API}/pages/assets/upload`, { json: payload, bearer: jwt });
    if (!up.success) { console.error(`✗ 第 ${i + 1} 批上传失败：` + JSON.stringify(up.errors)); cleanup(); process.exit(1); }
    console.log(`  ✓ 第 ${i + 1}/${batches.length} 批已上传（${batches[i].length} 个文件）`);
  }
} else console.log('  · 全部命中缓存，无需上传');

// ---- 5. 创建部署 ----
console.log('\n[5/6] 提交部署 ...');
const manifest = {};
for (const e of entries) manifest[e.rel] = e.hash;
const manifestPath = tmpJson(manifest);
const dep = req('POST', `${API}/accounts/${ACCOUNT}/pages/projects/${PROJECT}/deployments`, {
  form: [`manifest=<${manifestPath}`, 'branch=main'],
});
if (!dep.success) { console.error('✗ 部署失败：' + JSON.stringify(dep.errors)); cleanup(); process.exit(1); }
console.log(`  ✓ 部署成功：${dep.result.url}`);
console.log(`  · 生产地址：https://${PROJECT}.${subdomain ? subdomain.replace(/^.*?\./, '') : 'pages.dev'}`);

// ---- 6. 自定义域 ----
if (TAKEOVER) {
  console.log(`\n[6/6] 接管自定义域 ${DOMAIN} ...`);
  // 6a. 若被某个 Worker 自定义域占用，先解绑
  const doms = req('GET', `${API}/accounts/${ACCOUNT}/workers/domains`);
  if (doms.success) {
    const hit = (doms.result || []).find((d) => d.hostname === DOMAIN);
    if (hit) {
      console.log(`  · ${DOMAIN} 当前被 Worker「${hit.service}」占用，解绑中 ...`);
      const del = req('DELETE', `${API}/accounts/${ACCOUNT}/workers/domains/${hit.id}`);
      // DELETE 成功时可能返回空体
      console.log(del && del.success === false && del.errors ? '    ! 解绑返回：' + JSON.stringify(del.errors) : '    ✓ 已解绑');
    }
  }
  // 6b. 绑定到 Pages
  const add = req('POST', `${API}/accounts/${ACCOUNT}/pages/projects/${PROJECT}/domains`, { json: { name: DOMAIN } });
  if (add.success) console.log(`  ✓ 已绑定 ${DOMAIN} → Pages/${PROJECT}`);
  else console.warn('  ! 绑定失败：' + JSON.stringify(add.errors));
} else {
  console.log('\n[6/6] 未指定 --takeover，跳过自定义域绑定');
}

cleanup();
console.log('\n=== 前端部署完成 ===');
