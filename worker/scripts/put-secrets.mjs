#!/usr/bin/env node
/**
 * MarytOpens · 安全注入 Worker 密钥
 * 读取仓库根目录的 `.secrets` 文件（已被 .gitignore 忽略），逐条执行
 * `wrangler secret put <KEY>`，把值通过 stdin 传给 wrangler，避免密钥出现在
 * 命令行参数、聊天记录或仓库中。
 *
 * 用法（在 worker/ 目录）：
 *   cp ../.secrets.example ../.secrets   # 然后填入真实值
 *   npm run secrets                      # 等价 node scripts/put-secrets.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..'); // worker/
const secretsPath = resolve(root, '..', '.secrets'); // MarytOpens/.secrets

if (!existsSync(secretsPath)) {
  console.error('✗ 找不到 .secrets 文件。请先执行：');
  console.error('    cp ../.secrets.example ../.secrets');
  console.error('  然后填入真实密钥值，再运行 npm run secrets');
  process.exit(1);
}

const wrangler = resolve(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
if (!existsSync(wrangler)) {
  console.error('✗ 未找到 wrangler，请先在 worker/ 目录执行 npm install');
  process.exit(1);
}

// 解析 .secrets：支持 # 注释、KEY=VALUE、值可带引号
const text = readFileSync(secretsPath, 'utf8');
const entries = {};
for (const raw of text.split('\n')) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq < 0) continue;
  const key = line.slice(0, eq).trim();
  let val = line.slice(eq + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  if (!key) continue;
  entries[key] = val;
}

if (Object.keys(entries).length === 0) {
  console.error('✗ .secrets 中没有可用的 KEY=VALUE 条目');
  process.exit(1);
}

console.log(`→ 将注入 ${Object.keys(entries).length} 个密钥到 Worker（${root}）\n`);
for (const [key, val] of Object.entries(entries)) {
  if (val === '' || val.includes('在此填入') || val.includes('<')) {
    console.warn(`! 跳过 ${key}：值看起来是占位符，请先在 .secrets 中填写真实值`);
    continue;
  }
  console.log(`· putting ${key} ...`);
  const r = spawnSync(process.execPath, [wrangler, 'secret', 'put', key], {
    input: val + '\n',
    cwd: root,
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    console.error(`✗ 注入 ${key} 失败`);
    process.exit(r.status || 1);
  }
}
console.log('\n✓ 所有密钥已上传。下一步：npm run deploy');
