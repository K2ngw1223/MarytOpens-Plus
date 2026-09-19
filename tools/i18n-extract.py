# -*- coding: utf-8 -*-
"""扫描 pages/ 下所有 HTML/JS，抽取硬编码中文短语。

输出 tools/i18n-phrases.txt：`次数<TAB>短语<TAB>出现文件`，按次数倒序。
已存在于 i18n.js DICT['zh-CN'] 的短语会被标记（第一列前加 *），
因为它们已被反向词典覆盖，不需要再写入自动短语表。
"""
import re, os, glob, collections

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(BASE, '..', 'pages'))

ZH = re.compile(r'[\u4e00-\u9fff]')
# 短语：中文起头，内部允许中文/字母/数字/中文标点/少量 ASCII，**不含引号与 ASCII 括号**
PHRASE = re.compile(
    r'[\u4e00-\u9fff]'
    r'[\u4e00-\u9fff0-9A-Za-z·—\-+/%.,:：、，。！？…《》「」【】 ]*'
)
TRAIL = re.compile(r'[\s,.:：、，。\-—/+]+$')


def clean(p: str) -> str:
    p = p.strip()
    p = TRAIL.sub('', p)
    return p.strip()


def valid(p: str) -> bool:
    if not p or not (2 <= len(p) <= 60):
        return False
    if not ZH.search(p):
        return False
    if '${' in p or '{{' in p or '\\' in p:
        return False
    # 中文占比太低的多半是误抓
    if len(ZH.findall(p)) / len(p) < 0.3:
        return False
    return True


def strip_comments_js(s: str) -> str:
    s = re.sub(r'/\*[\s\S]*?\*/', ' ', s)
    s = re.sub(r'(?m)^\s*//.*$', ' ', s)
    return s


def load_dict_zh():
    """从 i18n.js 里粗略解析 DICT['zh-CN'] 的中文值集合。"""
    p = os.path.join(ROOT, 'assets', 'js', 'i18n.js')
    s = open(p, encoding='utf-8').read()
    m = re.search(r"DICT\['zh-CN'\]\s*=\s*\{([\s\S]*?)\n  \};", s)
    vals = set()
    if m:
        for vm in re.finditer(r":\s*'((?:[^'\\]|\\.)*)'", m.group(1)):
            vals.add(vm.group(1))
    return vals


def main():
    known = load_dict_zh()
    counter = collections.Counter()
    where = collections.defaultdict(set)

    files = sorted(glob.glob(os.path.join(ROOT, '*.html')))
    files += sorted(glob.glob(os.path.join(ROOT, 'assets', 'js', '*.js')))

    for f in files:
        name = os.path.relpath(f, ROOT).replace('\\', '/')
        if name.endswith('i18n.js') or name.endswith('i18n-phrases.js'):
            continue
        s = open(f, encoding='utf-8').read()
        if f.endswith('.html'):
            s = re.sub(r'<!--[\s\S]*?-->', ' ', s)
            s = re.sub(r'<script[^>]*>([\s\S]*?)</script>',
                       lambda m: '<script>' + strip_comments_js(m.group(1)) + '</script>', s)
        else:
            s = strip_comments_js(s)

        for m in PHRASE.finditer(s):
            p = clean(m.group(0))
            if valid(p):
                counter[p] += 1
                where[p].add(name)

    todo = [(n, p) for p, n in counter.items() if p not in known]
    done = [(n, p) for p, n in counter.items() if p in known]
    todo.sort(key=lambda x: (-x[0], x[1]))

    out = os.path.join(BASE, 'i18n-phrases.txt')
    with open(out, 'w', encoding='utf-8') as fh:
        for n, p in todo:
            fh.write('%d\t%s\t%s\n' % (n, p, ','.join(sorted(where[p]))))

    print('去重短语总数 :', len(counter))
    print('已被词典覆盖 :', len(done))
    print('待补充翻译   :', len(todo))
    print('输出          :', out)
    b = collections.Counter()
    for _, p in todo:
        L = len(p)
        b['1-4' if L <= 4 else '5-8' if L <= 8 else '9-16' if L <= 16 else '17+'] += 1
    print('长度分布      :', dict(b))


if __name__ == '__main__':
    main()
