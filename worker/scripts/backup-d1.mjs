#!/usr/bin/env node
/**
 * MarytOpens · D1 全量备份（走 curl，不依赖 wrangler / Node fetch）
 *
 * 为什么：本机 TUN 代理未接管 node.exe，Node fetch 连 api.cloudflare.com 必失败，
 *        因此所有网络请求交给 curl，Node 只负责分页拼装与写本地文件。
 *
 * 用法（在 worker/ 目录）：
 *   CLOUDFLARE_API_TOKEN=xxx CF_ACCOUNT_ID=xxx node scripts/backup-d1.mjs
 *
 * 产物：../_backup/d1-<db>-<时间戳>.json     全部业务表逐表 dump
 *      ../_backup/d1-latest.json           指向最近一次备份的软副本
 *
 * 说明：kv_store 是主数据表（KV 模拟层落地表），其它表为 #234 起的 D1 真表。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const projectRoot = resolve(root, '..');
const outDir = resolve(projectRoot, '_backup');

const TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const ACCOUNT = process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || '';
if (!TOKEN || !ACCOUNT) {
  console.error('✗ 缺少凭证：请设置 CLOUDFLARE_API_TOKEN 与 CF_ACCOUNT_ID');
  process.exit(1);
}

/** 从 wrangler.toml 读 d1 database_id */
function readD1Id() {
  const toml = readFileSync(resolve(root, 'wrangler.toml'), 'utf8');
  const m = toml.match(/database_id\s*=\s*"([^"]+)"/);
  if (!m) { console.error('✗ wrangler.toml 里找不到 database_id'); process.exit(1); }
  return m[1];
}
const DB = process.env.CF_D1_ID || readD1Id();
const API = 'https://api.cloudflare.com/client/v4';

function q(sql, params) {
  const tmpFile = resolve(tmpdir(), `mo-d1-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(tmpFile, JSON.stringify(params ? { sql, params } : { sql }));
  const r = spawnSync('curl', [
    '-s', '-X', 'POST', `${API}/accounts/${ACCOUNT}/d1/database/${DB}/query`,
    '-H', `Authorization: Bearer ${TOKEN}`,
    '-H', 'Content-Type: application/json',
    '--data-binary', `@${tmpFile}`,
  ], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  const out = (r.stdout || '').trim();
  let j;
  try { j = JSON.parse(out); } catch {
    console.error('✗ 非 JSON 响应：' + (out.slice(0, 300) || r.stderr));
    process.exit(1);
  }
  if (!j.success) { console.error('✗ SQL 失败：' + JSON.stringify(j.errors)); process.exit(1); }
  return (j.result && j.result[0] && j.result[0].results) || [];
}

/** 分页拉全表（避免单次响应过大被截断） */
function dumpTable(name, pageSize = 500) {
  const rows = [];
  for (let off = 0; ; off += pageSize) {
    const page = q(`SELECT * FROM "${name}" LIMIT ${pageSize} OFFSET ${off}`);
    rows.push(...page);
    process.stdout.write(`\r  ${name}: ${rows.length} 行`);
    if (page.length < pageSize) break;
    if (off > 500000) break; // 安全阀
  }
  process.stdout.write('\n');
  return rows;
}

console.log(`▶ 备份 D1 ${DB}`);
const tables = q(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name`)
  .map((r) => r.name);
console.log(`  发现 ${tables.length} 张表：${tables.join(', ')}`);

const dump = { database_id: DB, account_id: ACCOUNT, exported_at: new Date().toISOString(), tables: {} };
let total = 0;
for (const t of tables) {
  const rows = dumpTable(t);
  dump.tables[t] = rows;
  total += rows.length;
}

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const file = resolve(outDir, `d1-${DB.slice(0, 8)}-${stamp}.json`);
writeFileSync(file, JSON.stringify(dump, null, 0), 'utf8');
writeFileSync(resolve(outDir, 'd1-latest.json'), JSON.stringify(dump, null, 0), 'utf8');
console.log(`✓ 已备份 ${total} 行 → ${file}`);
console.log(`  同时写入 _backup/d1-latest.json`);
