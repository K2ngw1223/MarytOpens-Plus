#!/usr/bin/env node
/**
 * MarytOpens · 直连 Cloudflare REST API 部署（不依赖 wrangler）
 *
 * 为什么需要这个脚本？
 *   某些机器上装有 TUN 模式代理（Clash / v2rayN 等）并按「进程名」分流，
 *   node.exe 未被代理接管，DNS 又返回 fake-ip（198.18.x.x），导致 Node 内置 fetch
 *   连 api.cloudflare.com 时 TLS 握手被重置：
 *       TypeError: fetch failed / ECONNRESET ... before secure TLS connection was established
 *   而 curl 走的是被接管的路径，一切正常。wrangler 全程用 Node fetch，因此必然失败。
 *   本脚本把「网络请求」全部交给 curl，Node 只负责本地读文件 / 拼 JSON。
 *
 * 用法（在 worker/ 目录）：
 *   CLOUDFLARE_API_TOKEN=xxx CF_ACCOUNT_ID=xxx node scripts/deploy-api.mjs
 *
 * 步骤：
 *   1. 解析 wrangler.toml（name / compatibility / vars / kv_namespaces）
 *   2. 读取 ../.secrets，非空项作为 secret_text binding
 *   3. PUT  /workers/scripts/{name}          上传脚本 + 全部 bindings
 *   4. PUT  /workers/scripts/{name}/schedules 设置 cron
 *   5. POST /workers/scripts/{name}/subdomain 关闭 workers.dev
 *   6. PUT  /workers/domains                 绑定 api.natrois.top
 *   7. GET  https://api.natrois.top/api/health 连通性自检
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..'); // worker/
const projectRoot = resolve(root, '..'); // MarytOpens/
const tomlPath = resolve(root, 'wrangler.toml');
const entryPath = resolve(root, 'src', 'index.js');
const secretsPath = resolve(projectRoot, '.secrets');

const TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const ACCOUNT = process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || '';
if (!TOKEN || !ACCOUNT) {
  console.error('✗ 缺少凭证。请设置环境变量 CLOUDFLARE_API_TOKEN 与 CF_ACCOUNT_ID 后重试。');
  process.exit(1);
}

const API = 'https://api.cloudflare.com/client/v4';

/** 用 curl 发请求，返回解析后的 JSON */
function cf(method, path, { json, form, absolute } = {}) {
  const url = absolute || API + path;
  const args = ['-s', '-X', method, url, '-H', `Authorization: Bearer ${TOKEN}`];
  let tmpFile = null;
  if (json !== undefined) {
    // 走临时文件，避免超长命令行 / Windows 引号转义问题
    tmpFile = resolve(tmpdir(), `mo-cf-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(tmpFile, JSON.stringify(json));
    args.push('-H', 'Content-Type: application/json', '--data-binary', `@${tmpFile}`);
  }
  if (form) for (const f of form) args.push('-F', f);
  const r = spawnSync('curl', args, { encoding: 'utf8', cwd: root, maxBuffer: 64 * 1024 * 1024 });
  if (tmpFile) { try { unlinkSync(tmpFile); } catch {} }
  const out = (r.stdout || '').trim();
  if (!out) return { success: r.status === 0, result: null, errors: [] }; // 204 空体视为成功
  try { return JSON.parse(out); } catch {
    return { success: false, errors: [{ message: `非 JSON 响应: ${out.slice(0, 400) || r.stderr}` }] };
  }
}
function must(res, label) {
  if (!res || !res.success) {
    console.error(`✗ ${label} 失败：` + JSON.stringify(res && res.errors));
    process.exit(1);
  }
  return res.result;
}

// ---------------- 1. 解析 wrangler.toml ----------------
const toml = readFileSync(tomlPath, 'utf8');
const pick = (re) => { const m = toml.match(re); return m ? m[1] : null; };
const scriptName = pick(/^\s*name\s*=\s*"([^"]+)"/m) || 'marytopens-api';
const compatDate = pick(/^\s*compatibility_date\s*=\s*"([^"]+)"/m) || '2026-01-01';
const compatFlags = (pick(/^\s*compatibility_flags\s*=\s*\[([^\]]*)\]/m) || '')
  .split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
const kvId = pick(/\[\[kv_namespaces\]\][\s\S]*?\bid\s*=\s*"([0-9a-f]{32})"/);
const kvBinding = pick(/\[\[kv_namespaces\]\][\s\S]*?binding\s*=\s*"([^"]+)"/) || 'DB';
const cron = pick(/^\s*crons\s*=\s*\[\s*"([^"]+)"/m);
const routeHost = pick(/pattern\s*=\s*"([^"]+)"\s*,\s*custom_domain\s*=\s*true/);

if (!kvId) { console.error('✗ wrangler.toml 缺少有效的 KV id（32 位 hex）。'); process.exit(1); }

// [vars] 段（到下一个 [ 段落为止）
const varsBlock = (toml.split(/^\[vars\]\s*$/m)[1] || '').split(/^\[/m)[0] || '';
const vars = {};
for (const line of varsBlock.split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"([^"]*)"/);
  if (m) vars[m[1]] = m[2];
}

// ---------------- 2. 读取 .secrets ----------------
const secrets = {};
if (existsSync(secretsPath)) {
  for (const line of readFileSync(secretsPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const v = m[2].trim();
    if (!v || /^(在此填入|your_|<|xxx)/i.test(v)) continue; // 跳过空值与占位符
    secrets[m[1]] = v;
  }
}

console.log('=== MarytOpens 部署（REST API 直连，绕过 wrangler）===');
console.log(`· Worker      : ${scriptName}`);
console.log(`· KV 绑定     : ${kvBinding} → ${kvId}`);
console.log(`· 环境变量    : ${Object.keys(vars).length} 个`);
console.log(`· 密钥        : ${Object.keys(secrets).length} 个 (${Object.keys(secrets).join(', ') || '无'})`);
console.log(`· 自定义域    : ${routeHost || '(未配置)'}`);

// ---------------- 3. 上传 Worker 脚本 ----------------
const bindings = [
  { type: 'kv_namespace', name: kvBinding, namespace_id: kvId },
  ...Object.entries(vars).map(([name, text]) => ({ type: 'plain_text', name, text })),
  ...Object.entries(secrets).map(([name, text]) => ({ type: 'secret_text', name, text })),
];
const metadata = {
  main_module: 'index.js',
  compatibility_date: compatDate,
  compatibility_flags: compatFlags,
  bindings,
  observability: { enabled: true },
  placement: { mode: 'smart' },
};
const metaPath = resolve(tmpdir(), `mo-meta-${Date.now()}.json`);
writeFileSync(metaPath, JSON.stringify(metadata));

console.log('\n[1/5] 上传 Worker 脚本 ...');
const up = cf('PUT', `/accounts/${ACCOUNT}/workers/scripts/${scriptName}`, {
  form: [
    `metadata=@${metaPath};type=application/json`,
    `index.js=@${entryPath};type=application/javascript+module;filename=index.js`,
  ],
});
try { unlinkSync(metaPath); } catch {}
must(up, '上传 Worker');
console.log(`  ✓ 已部署，脚本大小 ${(readFileSync(entryPath).length / 1024).toFixed(1)} KB`);

// ---------------- 4. Cron ----------------
if (cron) {
  console.log(`\n[2/5] 设置定时任务 (${cron}) ...`);
  const sc = cf('PUT', `/accounts/${ACCOUNT}/workers/scripts/${scriptName}/schedules`, { json: [{ cron }] });
  if (sc.success) console.log('  ✓ 已设置');
  else console.warn('  ! 设置失败（不影响主功能）：' + JSON.stringify(sc.errors));
} else console.log('\n[2/5] 无 cron 配置，跳过');

// ---------------- 5. 关闭 workers.dev ----------------
console.log('\n[3/5] 关闭 workers.dev 子域 ...');
const sub = cf('POST', `/accounts/${ACCOUNT}/workers/scripts/${scriptName}/subdomain`, { json: { enabled: false } });
console.log(sub.success ? '  ✓ 已关闭' : '  · 跳过：' + JSON.stringify(sub.errors));

// ---------------- 6. 绑定自定义域 ----------------
if (routeHost) {
  console.log(`\n[4/5] 绑定自定义域 ${routeHost} ...`);
  const apex = routeHost.split('.').slice(-2).join('.');
  const zones = cf('GET', `/zones?name=${apex}`);
  const zone = zones.success && zones.result[0];
  if (!zone) {
    console.warn(`  ! 未在当前账号找到 zone ${apex}，请先把域名接入 Cloudflare`);
  } else {
    const dom = cf('PUT', `/accounts/${ACCOUNT}/workers/domains`, {
      json: { environment: 'production', hostname: routeHost, service: scriptName, zone_id: zone.id },
    });
    if (dom.success) console.log(`  ✓ 已绑定（zone ${apex} / ${zone.id}）`);
    else console.warn('  ! 绑定失败：' + JSON.stringify(dom.errors));
  }
} else console.log('\n[4/5] 无自定义域配置，跳过');

// ---------------- 7. 连通性自检 ----------------
console.log(`\n[5/5] 验证后端连通性 https://${routeHost}/api/health ...`);
let ok = false;
for (let i = 1; i <= 6; i++) {
  const h = cf('GET', '', { absolute: `https://${routeHost}/api/health` });
  if (h && h.ok) { console.log('  ✓ 后端已上线：' + JSON.stringify(h)); ok = true; break; }
  console.log(`  · 第 ${i}/6 次探测未就绪，5 秒后重试 ...`);
  spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},5000)']);
}
if (!ok) {
  // 区分「后端没上线」与「本机网络连不上自己的站点」两种完全不同的情况，避免误判
  const probe = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}|%{remote_ip}',
    '--max-time', '15', `https://${routeHost}/api/health`], { encoding: 'utf8' });
  const [code, ip] = (probe.stdout || '|').split('|');
  console.warn(`  ! 本机未探测到健康响应（http=${code || '000'} ip=${ip || '-'}）。`);
  if (/^198\.18\./.test(ip || '')) {
    console.warn('    ↳ 解析到 198.18.x.x（代理软件 fake-ip）。这是本机 TUN 代理的分流问题，');
    console.warn('      与部署无关：后端很可能已正常上线，只是这台机器访问不到自己的域名。');
    console.warn('      请用手机流量 / 其他网络，或临时关闭代理后再验证。');
  } else {
    console.warn('    ↳ 自定义域 DNS 与证书生效通常需要 1-3 分钟，请稍后手动验证：');
    console.warn(`        curl https://${routeHost}/api/health`);
  }
}

console.log('\n=== 部署完成 ===');
if (!secrets.SUPER_ADMIN_PASSWORD) {
  console.log('⚠ 未设置 SUPER_ADMIN_PASSWORD，超级管理员账号不会自动创建。');
  console.log('  请到 Cloudflare 控制台 → Workers → ' + scriptName + ' → Settings → Variables');
  console.log('  添加加密变量 SUPER_ADMIN_PASSWORD 后，访问一次站点即可自动建号。');
}
