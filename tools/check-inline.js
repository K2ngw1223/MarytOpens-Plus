/* 校验 HTML 中所有内联 <script> 块的语法（开发期工具，不参与部署） */
const fs = require('fs');
const vm = require('vm');

let bad = 0;
for (const f of process.argv.slice(2)) {
  const html = fs.readFileSync(f, 'utf8');
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, i = 0, local = 0;
  while ((m = re.exec(html))) {
    i++;
    try { new vm.Script(m[1], { filename: f + '#' + i }); }
    catch (e) { local++; bad++; console.log('FAIL ' + f + ' block#' + i + ' => ' + e.message); }
  }
  if (!local) console.log('OK   ' + f + '  (' + i + ' inline block)');
}
process.exit(bad ? 1 : 0);
