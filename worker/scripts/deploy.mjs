#!/usr/bin/env node
/**
 * MarytOpens · 一键部署（Worker 后端 + Pages 前端）
 *
 * 前置条件：
 *   - 已 `wrangler login`，或在环境变量设置 CLOUDFLARE_API_TOKEN 与 CF_ACCOUNT_ID
 *   - worker/ 下已 `npm install`（安装 wrangler）
 *   - 仓库根目录 .secrets 已填好（cp ../.secrets.example ../.secrets 后填写）
 *
 * 步骤：
 *   1. wrangler whoami               校验登录
 *   2. kv namespace create DB        创建 KV（含 preview）并自动回填 wrangler.toml
 *   3. r2 bucket create              创建 R2 桶 marytopens-media
 *   4. node scripts/put-secrets.mjs  注入所有密钥
 *   5. wrangler deploy               部署后端 → api.natrois.top
 *   6. wrangler pages deploy         部署前端 → natrois.top（Pages 项目 marytopens）
 *
 * 用法（在 worker/ 目录）：
 *   npm run deploy
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..'); // worker/
const projectRoot = resolve(root, '..'); // MarytOpens/
const wrangler = resolve(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const pagesDir = resolve(projectRoot, 'pages');
const tomPath = resolve(root, 'wrangler.toml');
const secretsPath = resolve(projectRoot, '.secrets'); // MarytOpens/.secrets

function run(args) {
  console.log('\n$ wrangler ' + args.join(' '));
  const r = spawnSync(process.execPath, [wrangler, ...args], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) { console.error('✗ 命令失败：wrangler ' + args.join(' ')); process.exit(r.status || 1); }
  return r;
}
function runCapture(args) {
  const r = spawnSync(process.execPath, [wrangler, ...args], { cwd: root, encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

console.log('=== MarytOpens 部署开始 ===');

// 0. 预检：必须已填好 .secrets（否则密钥无法注入，部署后功能缺失）
if (!existsSync(secretsPath)) {
  console.error('✗ 找不到 .secrets 文件，无法注入密钥。请先执行：');
  console.error('    cp ../.secrets.example ../.secrets');
  console.error('  然后填入真实密钥值，再运行 npm run deploy');
  process.exit(1);
}
console.log('· 已检测到 .secrets，将自动注入所有密钥');

// 1. 校验登录
console.log('\n[1/6] 校验 Cloudflare 登录 ...');
const who = runCapture(['whoami']);
if (who.status !== 0) {
  console.error('✗ 未登录 Cloudflare。请先执行 `wrangler login`，或在环境变量设置 CLOUDFLARE_API_TOKEN 与 CF_ACCOUNT_ID 后重试。');
  process.exit(1);
}
console.log(who.out.trim());

// 2. 创建 KV 命名空间并回填 wrangler.toml
// 从 wrangler 各版本的输出里稳健地抽取 32 位 KV id
// wrangler 3.x: { "binding": "DB", "id": "abc..." }
// wrangler 2.x: id = "abc..."   /   老版本: ID: abc...
function extractKvId(out) {
  const pats = [
    /"id"\s*:\s*"([0-9a-f]{32})"/i,
    /\bid\s*=\s*"([0-9a-f]{32})"/i,
    /\bID:\s*([0-9a-f]{32})\b/i,
    /\b([0-9a-f]{32})\b/, // 兜底：输出中出现的第一个 32 位 hex
  ];
  for (const p of pats) { const m = out.match(p); if (m) return m[1]; }
  return null;
}
// 已存在同名命名空间时，改用 list 查回 id（避免重复创建导致的失败）
function kvLookup(title) {
  const r = runCapture(['kv', 'namespace', 'list']);
  if (r.status !== 0) return null;
  try {
    const json = JSON.parse(r.out.slice(r.out.indexOf('[')));
    const hit = json.find((n) => n.title === title);
    return hit ? hit.id : null;
  } catch { return null; }
}
function kvCreate(name, preview) {
  const args = ['kv', 'namespace', 'create', name];
  if (preview) args.push('--preview');
  const r = runCapture(args);
  const title = `marytopens-api-${name}${preview ? '_preview' : ''}`;
  if (r.status !== 0) {
    // 已存在则直接查回，不算失败
    const existing = kvLookup(title);
    if (existing) { console.log(`  · KV ${title} 已存在，复用 id=${existing}`); return existing; }
    console.error('✗ 创建 KV 失败：\n' + r.out); process.exit(1);
  }
  return extractKvId(r.out) || kvLookup(title);
}
console.log('\n[2/6] 创建 KV 命名空间 DB ...');
let tom = readFileSync(tomPath, 'utf8');
const KV_ID_RE = /id\s*=\s*"([0-9a-f]{32})"/i;
const PREVIEW_ID_RE = /preview_id\s*=\s*"([0-9a-f]{32})"/i;
if (!KV_ID_RE.test(tom) || !PREVIEW_ID_RE.test(tom)) {
  const kvId = kvCreate('DB');
  const kvPreviewId = kvCreate('DB', true);
  // 防御：解析不到真实 id 时绝不写回，否则会把 wrangler.toml 写成 id = "null" 导致部署失败
  if (!kvId || !kvPreviewId) {
    console.error('✗ 无法解析 KV 命名空间 ID（wrangler 输出格式可能已变更）。');
    console.error('  请手动执行 `wrangler kv namespace list`，把 marytopens-api-DB 与 marytopens-api-DB_preview');
    console.error('  的 id 填入 worker/wrangler.toml 的 [[kv_namespaces]] 后重试。');
    process.exit(1);
  }
  // 兼容任意旧值（占位符 / null / 空串），统一替换 [[kv_namespaces]] 段内的 id 与 preview_id
  tom = tom
    .replace(/^(\s*)preview_id\s*=\s*"[^"]*"/m, `$1preview_id = "${kvPreviewId}"`)
    .replace(/^(\s*)id\s*=\s*"[^"]*"/m, `$1id = "${kvId}"`);
  writeFileSync(tomPath, tom);
  console.log(`  ✓ KV id=${kvId} preview=${kvPreviewId}（已写回 wrangler.toml）`);
} else {
  console.log('  · wrangler.toml 中已有有效 KV ID，跳过创建');
}

// 3. 创建 R2 桶（可选：未绑定 R2 时 Worker 会自动回退到 KV 存储文件）
console.log('\n[3/6] 创建 R2 存储桶 marytopens-media（可选）...');
const r2 = runCapture(['r2', 'bucket', 'create', 'marytopens-media']);
if (r2.status === 0) console.log('  ✓ 已创建（或已存在）');
else console.warn('  ! R2 创建跳过/失败：' + r2.out.trim() + '\n    若你不需要 R2（使用 KV 存储文件），可忽略此步。');

// 4. 注入密钥
console.log('\n[4/6] 注入密钥 ...');
const sec = spawnSync(process.execPath, [resolve(__dirname, 'put-secrets.mjs')], { cwd: root, stdio: 'inherit' });
if (sec.status !== 0) process.exit(sec.status || 1);

// 5. 部署后端
console.log('\n[5/6] 部署 Worker 后端 → api.natrois.top ...');
run(['deploy']);

// 6. 部署前端
console.log('\n[6/6] 部署 Pages 前端 → natrois.top ...');
run(['pages', 'deploy', pagesDir, '--project-name', 'marytopens', '--branch', 'main']);

// 7. 验证后端连通性（核心：确认 api.natrois.top 真正在响应，避免「无法连接后端API」）
console.log('\n[7/7] 验证后端连通性 https://api.natrois.top/api/health ...');
try {
  const hc = await fetch('https://api.natrois.top/api/health');
  const hj = await hc.json().catch(() => null);
  if (hc.ok && hj && hj.ok) console.log('  ✓ 后端已上线，可正常连接：', JSON.stringify(hj));
  else console.warn('  ! 后端返回异常：', hc.status, JSON.stringify(hj));
} catch (e) {
  console.warn('  ! 暂时无法连接到 api.natrois.top：', String(e).slice(0, 200));
  console.warn('    可能是自定义域 api.natrois.top 尚未在 Cloudflare 完成解析/激活（DNS 通常需几分钟生效）。');
  console.warn('    请到 Cloudflare 控制台 → Workers → marytopens-api → 路由 确认 api.natrois.top 已绑定。');
}

console.log('\n=== 部署完成 ===');
console.log('请到 Cloudflare 控制台完成收尾：');
console.log('  1. Workers → marytopens-api → Settings → 自定义域：绑定 api.natrois.top（路由已在 wrangler.toml，等待 DNS 生效）');
console.log('  2. Pages → marytopens → 自定义域：绑定 natrois.top（根域）');
console.log('  3. 公开 Client ID 仍占位：GITHUB_CLIENT_ID / DISCORD_CLIENT_ID / TURNSTILE_SITE_KEY / CF_OAUTH_CLIENT_ID');
console.log('     请在 worker/wrangler.toml 的 [vars] 填入真实值后重新 `npm run deploy`');
console.log('  4. 验证：curl https://api.natrois.top/api/meta');
