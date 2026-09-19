/* MarytOpens · 页面内联脚本「App 成员误用」检查
 *
 * 用法： node tools/check-app-helpers.js [pages 目录]
 *
 * 页面里习惯写 `const { $, esc } = App;` 取工具函数，漏解构一个名字就会抛
 * ReferenceError。如果它抛在 try 之外，表现是「按钮点了没反应，后端连请求
 * 都没收到」，光看服务端日志查不出来，所以用脚本挡在前面。
 *
 * 判据：裸调用了 App 的成员，但没解构、没写 App.xxx、也没有本地同名定义。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const dir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'pages');
const APP = path.join(dir, 'assets', 'js', 'app.js');

if (!fs.existsSync(APP)) {
  console.error('找不到 ' + APP + '\n用法: node tools/check-app-helpers.js [pages 目录]');
  process.exit(2);
}

/* ---------- 1. 解析 App 导出的成员名 ---------- */
const appSrc = fs.readFileSync(APP, 'utf8');
const start = appSrc.indexOf('Object.assign(App, {');
if (start < 0) { console.error('app.js 里找不到 Object.assign(App, {...}) 导出块'); process.exit(2); }
const block = appSrc.slice(start + 'Object.assign(App, {'.length, appSrc.indexOf('});', start));
const members = new Set();
for (const rawLine of block.split('\n')) {
  const line = rawLine.split('//')[0].trim();
  if (!line) continue;
  for (const part of line.replace(/,$/, '').split(',')) {
    const name = part.trim().split(':')[0].trim();
    if (/^[A-Za-z_$][\w$]*$/.test(name)) members.add(name);
  }
}

/* ---------- 2. 逐页检查 ---------- */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let problems = 0, checked = 0;

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.html'))) {
  const src = fs.readFileSync(path.join(dir, file), 'utf8');
  checked++;

  // ① 从 App 解构出来的名字
  const destructured = new Set();
  for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*App\s*;/g)) {
    m[1].split(',').forEach((x) => destructured.add(x.trim().split(':')[0].trim()));
  }

  const missing = [];
  for (const name of members) {
    if (destructured.has(name)) continue;
    const re = new RegExp('(?<![\\w.$])' + escapeRe(name) + '\\s*\\(');
    if (!re.test(src)) continue;                       // 没裸调用，跳过
    // ② 本地定义（自己实现的同名函数/变量）
    const local = new RegExp(
      'function\\s+' + escapeRe(name) + '\\s*\\(' +                                  // function foo(
      '|(?:const|let|var)\\s+' + escapeRe(name) + '\\s*=' +                          // const foo =
      '|\\b' + escapeRe(name) + '\\s*=\\s*(?:function|\\()',                         // foo = function / foo = (
    );
    if (local.test(src)) continue;
    missing.push(name);
  }

  if (missing.length) {
    problems++;
    console.log('✗ ' + file + ' → 裸调用未定义的 App 成员: ' + missing.join(', '));
  }
}

console.log('\n检查 ' + checked + ' 个页面：' + (problems ? problems + ' 个有问题' : '全部通过'));
process.exit(problems ? 1 : 0);
