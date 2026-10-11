#!/usr/bin/env python3
"""给 xwblog 面板 bundle 注入「博客列表」导航按钮（ops.bloghao.com → /blog-admin/）。
面板源码不在服务器上（打包进镜像），镜像升级后 bundle 会变，需重新执行：
  docker cp xwblog-xwblog-1:/app/docker-poc/dist/server.js /tmp/server.js
  python3 deploy/ops-patch.py /tmp/server.js
  sudo cp /tmp/server.js ~/apps/xwblog/ops-patch/server.js
  cd ~/apps/xwblog && docker compose up -d   # compose 已有 volume 挂载该文件
"""
import sys
p = sys.argv[1] if len(sys.argv) > 1 else '/tmp/server.js'
s = open(p, encoding='utf8').read()
before = 'return `<form class="logout-form" method="post" action="/logout">'
if 'href="/blog-admin/"' in s:
    print('already patched'); raise SystemExit(0)
if before not in s:
    print('PATTERN NOT FOUND —— bundle 结构变了，手动在 logoutHtml() 里加链接'); raise SystemExit(1)
after = 'return `<a class="btn" href="/blog-admin/" style="text-decoration:none;display:inline-block">博客列表</a><form class="logout-form" method="post" action="/logout">'
assert s.count(before) == 1
open(p, 'w', encoding='utf8').write(s.replace(before, after))
print('patched ✓')
