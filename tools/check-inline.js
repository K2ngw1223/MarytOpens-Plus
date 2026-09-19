/* 校验 HTML 中所有内联 <script> 块的语法（开发期工具，不参与部署）
 *
 * 用法：
 *   node tools/check-inline.js pages            # 目录，递归检查所有 .html
 *   node tools/check-inline.js pages/a.html b.html
 *
 * 页面里的内联脚本出错往往只在浏览器控制台可见，很容易静默失效，
 * 所以改完前端先跑这个。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SKIP = new Set(['node_modules', '.git', '.wrangler', 'dist']);

function collect(target, out = []) {
  let st;
  try { st = fs.statSync(target); } catch { console.log('SKIP ' + target + ' (不存在)'); return out; }
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(target)) {
      if (SKIP.has(name)) continue;
      collect(path.join(target, name), out);
    }
  } else if (/\.html?$/i.test(target)) {
    out.push(target);
  }
  return out;
}

const files = process.argv.slice(2).flatMap((t) => collect(t));
if (!files.length) {
  console.error('用法: node tools/check-inline.js <目录|文件>...');
  process.exit(2);
}

let bad = 0;
let blocks = 0;

for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, i = 0, local = 0;
  while ((m = re.exec(html))) {
    i++;
    blocks++;
    try { new vm.Script(m[1], { filename: f + '#' + i }); }
    catch (e) { local++; bad++; console.log('FAIL ' + f + ' block#' + i + ' => ' + e.message); }
  }
  if (!local && i) console.log('OK   ' + f + '  (' + i + ' inline block)');
}

console.log('\n共检查 ' + files.length + ' 个文件 / ' + blocks + ' 个内联块，' + (bad ? bad + ' 个失败' : '全部通过'));
process.exit(bad ? 1 : 0);
