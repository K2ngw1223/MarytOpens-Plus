#!/usr/bin/env node
/* ==========================================================================
 * MarytOpens · 集中配置应用器
 *
 *   node tools/configure.mjs          把 site.config.json 应用到全项目
 *   node tools/configure.mjs --check  只检查有没有漏改的占位值（CI 用）
 *
 * 做三件事：
 *   1. 同步 worker/wrangler.toml 的域名、路由、发件地址与登记开关
 *   2. 替换源码与文档里的占位域名
 *   3. 生成 deploy-info.json
 *
 * 可重复执行。上次生效的值记在 site.config.json 的 _applied 里，
 * 改了域名再跑一遍也能正确覆盖。
 * ========================================================================== */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');

const PLACEHOLDER = {
  apiOrigin: 'https://api.example.com',
  siteOrigin: 'https://example.com',
  wwwOrigin: 'https://www.example.com',
  supportEmail: 'admin@example.com',
  noReplyEmail: 'no-reply@example.com',
};

const TEXT_EXTS = new Set(['.js', '.mjs', '.html', '.json', '.toml', '.md', '.py', '.css', '.example', '.txt']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler', '_backup', '_probe', '.verify_tmp', 'tools']);

const rel = (p) => relative(ROOT, p).split(sep).join('/');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

function fail(msg) {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
}

/* ---------------------------------- 读取配置 -------------------------------- */

const cfgPath = join(ROOT, 'site.config.json');
if (!existsSync(cfgPath)) fail('找不到 site.config.json');
const cfg = readJson(cfgPath);

const origin = (v) => String(v || '').replace(/\/+$/, '');
const host = (v) => origin(v).replace(/^https?:\/\//, '');

const apiOrigin = origin(cfg.apiOrigin);
const siteOrigin = origin(cfg.siteOrigin);
const supportEmail = String(cfg.supportEmail || '').trim();

if (!/^https?:\/\//.test(apiOrigin)) fail('site.config.json 的 apiOrigin 必须是完整 URL（含 https://）');
if (!/^https?:\/\//.test(siteOrigin)) fail('site.config.json 的 siteOrigin 必须是完整 URL（含 https://）');

const derived = {
  apiOrigin,
  siteOrigin,
  wwwOrigin: siteOrigin.replace(/^(https?:\/\/)/, '$1www.'),
  supportEmail,
  noReplyEmail: `no-reply@${host(siteOrigin)}`,
};

const prev = cfg._applied || {};

/* 未替换的占位清单（--check 用） */
function placeholdersIn(src) {
  return Object.values(PLACEHOLDER).filter((ph) => src.includes(ph));
}

/* ------------------------------- 遍历文件树 -------------------------------- */

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(ROOT);
let placeholdersLeft = [];

/* ------------------------- 2. worker/wrangler.toml 同步 --------------------- */

const tomlPath = join(ROOT, 'worker', 'wrangler.toml');
let tomlUpdated = 0;

if (!CHECK_ONLY && existsSync(tomlPath)) {
  let src = readFileSync(tomlPath, 'utf8');
  const before = src;
  const setVar = (key, value) => {
    const re = new RegExp(`^(${key}\\s*=\\s*)"[^"]*"`, 'm');
    if (re.test(src)) src = src.replace(re, `$1"${value}"`);
  };
  setVar('FRONTEND_ORIGIN', siteOrigin);
  setVar('API_ORIGIN', apiOrigin);
  setVar('MEDIA_PUBLIC_BASE', `${apiOrigin}/files`);
  setVar('SUPER_ADMIN_EMAIL', supportEmail);
  setVar('MAIL_FROM', `${cfg.mailFromName || cfg.siteName || 'MarytOpens'} <${derived.noReplyEmail}>`);
  setVar('ALLOWED_ORIGINS', [
    derived.siteOrigin,
    derived.wwwOrigin,
    'https://marytopens.pages.dev',
    'http://localhost:8788',
    'http://127.0.0.1:8788',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
  ].join(','));

  /* routes 里的自定义域 */
  src = src.replace(/(\{\s*pattern\s*=\s*")[^"]*(")/g, `$1${host(apiOrigin)}$2`);

  /* 部署登记开关 */
  setVar('DEPLOY_REGISTRY_ENABLED', String(!!cfg.registry?.enabled));
  setVar('DEPLOY_REGISTRY_PUBLIC', String(!!cfg.registry?.public));
  setVar('DEPLOY_REGISTRY_ISSUE', String(!!cfg.registry?.issue));
  setVar('DEPLOY_REGISTRY_REPO', cfg.registry?.repo || '');

  if (src !== before) { writeFileSync(tomlPath, src, 'utf8'); tomlUpdated = 1; }
}

/* --------------------------- 3. 文档占位域名替换 ---------------------------- */

/* 顺序：邮箱 → api → www → 主站 → 裸域。长串优先，避免误伤 */
function buildPairs() {
  const pairs = [
    [PLACEHOLDER.supportEmail, derived.supportEmail, prev.supportEmail],
    [PLACEHOLDER.noReplyEmail, derived.noReplyEmail, prev.noReplyEmail],
    [PLACEHOLDER.apiOrigin, derived.apiOrigin, prev.apiOrigin],
    [PLACEHOLDER.apiOrigin.replace(/^https?:\/\//, ''), host(derived.apiOrigin), prev.apiOrigin && host(prev.apiOrigin)],
    [PLACEHOLDER.wwwOrigin, derived.wwwOrigin, prev.siteOrigin && prev.siteOrigin.replace(/^(https?:\/\/)/, '$1www.')],
    [PLACEHOLDER.siteOrigin, derived.siteOrigin, prev.siteOrigin],
    [PLACEHOLDER.siteOrigin.replace(/^https?:\/\//, ''), host(derived.siteOrigin), prev.siteOrigin && host(prev.siteOrigin)],
  ];
  const seen = new Set();
  return pairs.filter(([from, to, old]) => {
    if (!from || from === to) return false;
    const key = `${from}→${to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(([from, to, old]) => [from, to, old && old !== to ? old : null]);
}

const pairs = buildPairs();
let docFiles = 0;

for (const p of files) {
  if (!TEXT_EXTS.has(extname(p))) continue;
  if (rel(p) === 'site.config.json') continue;
  if (rel(p).startsWith('tools/')) continue; // 配置器自身保留占位字面量
  let src = readFileSync(p, 'utf8');
  const before = src;
  for (const [from, to, old] of pairs) {
    src = src.split(from).join(to);
    if (old) src = src.split(old).join(to);
  }
  if (src !== before) { if (!CHECK_ONLY) writeFileSync(p, src, 'utf8'); docFiles++; }
}

/* ------------------------------- 4. 占位残留检查 ---------------------------- */

for (const p of files) {
  if (!TEXT_EXTS.has(extname(p))) continue;
  if (rel(p) === 'site.config.json' || rel(p).startsWith('tools/')) continue;
  const hits = placeholdersIn(readFileSync(p, 'utf8'));
  if (hits.length) placeholdersLeft.push([rel(p), hits]);
}

/* --------------------------- 5. deploy-info.json --------------------------- */

const instanceId = createHash('sha256').update(`${siteOrigin}|${apiOrigin}`).digest('hex').slice(0, 16);

if (!CHECK_ONLY) {
  const info = {
    siteName: cfg.siteName,
    siteOrigin: derived.siteOrigin,
    apiOrigin: derived.apiOrigin,
    supportEmail: derived.supportEmail,
    repoUrl: cfg.repoUrl,
    instanceId,
    generator: 'marytopens-oss',
    configuredAt: new Date().toISOString(),
  };
  writeFileSync(join(ROOT, 'deploy-info.json'), JSON.stringify(info, null, 2) + '\n', 'utf8');

  cfg._applied = { ...derived, configuredAt: info.configuredAt };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

/* ---------------------------------- 输出 ---------------------------------- */

if (CHECK_ONLY) {
  if (placeholdersLeft.length) {
    console.error(`\x1b[31m✗ 仍有 ${placeholdersLeft.length} 个文件含未替换的占位值：\x1b[0m`);
    for (const [f, hits] of placeholdersLeft.slice(0, 30)) console.error(`   ${f}  ${[...new Set(hits)].join(', ')}`);
    console.error('\n请修改 site.config.json 后执行： node tools/configure.mjs');
    process.exit(1);
  }
  console.log('\x1b[32m✓ 配置检查通过，无占位残留\x1b[0m');
  process.exit(0);
}

console.log('MarytOpens · 配置已应用');
console.log(`  前端 API 基址   ${derived.apiOrigin}`);
console.log(`  站点域名        ${derived.siteOrigin}`);
console.log(`  发件地址        ${derived.noReplyEmail}`);
console.log(`  实例标识        ${instanceId}`);
console.log('');
console.log(`  wrangler.toml   ${tomlUpdated ? '已同步' : '无变化'}`);
console.log(`  源码/文档替换   ${docFiles} 个文件`);
console.log(`  deploy-info.json 已生成`);

if (placeholdersLeft.length) {
  console.log('');
  console.log(`\x1b[33m⚠ 仍有 ${placeholdersLeft.length} 个文件含占位值（多为示例/文档，可忽略）：\x1b[0m`);
  for (const [f, hits] of placeholdersLeft.slice(0, 10)) console.log(`   ${f}  ${[...new Set(hits)].join(', ')}`);
  if (placeholdersLeft.length > 10) console.log(`   … 其余 ${placeholdersLeft.length - 10} 个`);
}
