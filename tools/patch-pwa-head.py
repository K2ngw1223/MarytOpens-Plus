# -*- coding: utf-8 -*-
import os
import re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pages')
HEAD_EXTRA = '''
  <meta name="theme-color" content="#6366f1">
  <link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.json">
  <script>
    (function() {
      const apiMeta = document.querySelector('meta[name="mo-api"]');
      const api = (apiMeta && apiMeta.content) || 'https://api.example.com';
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js?api=' + encodeURIComponent(api)).then(function(reg) {
          reg.addEventListener('updatefound', function() {
            const wb = reg.installing;
            if (wb) wb.addEventListener('statechange', function() {
              if (wb.state === 'activated') wb.postMessage({ type: 'mo-skip-waiting' });
            });
          });
        }).catch(function() {});
      }
    })();
  </script>
'''

files = [f for f in os.listdir(ROOT) if f.endswith('.html') and f != 'offline.html']
for fn in files:
    path = os.path.join(ROOT, fn)
    with open(path, 'r', encoding='utf-8') as f:
        s = f.read()
    if '<link rel="manifest"' in s:
        print('SKIP', fn)
        continue
    m = re.search(r'(<link rel="icon"[^>]+>\s*)', s)
    if not m:
        print('NOFAV', fn)
        continue
    s = s[:m.end()] + HEAD_EXTRA + s[m.end():]
    with open(path, 'w', encoding='utf-8') as f:
        f.write(s)
    print('PATCH', fn)
