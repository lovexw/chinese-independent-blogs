# 更新时间审计报告（多信号）

> 由 `scripts/update-audit.mjs` 于 2026-10-11 生成，每周随巡检更新。

## 方法论

单纯依赖列表里的 RSS 地址会产生两类误判：博客改版/搬家后旧 feed 还挂着（**真更新了却显示沉睡**），
或 feed 的 lastBuildDate/评论时间被误当文章时间（**没更新却显示活跃**）。本次审计对每个博客采集三种独立信号：

1. **feed** — 重新推导 RSS：从首页**实际落点 URL** 做自动发现 + 常见路径探测，修“地址错位”；评论 feed 一律排除
2. **home** — 首页可见的最新文章日期（ISO / 中文 / 英文 / `<time datetime>` / JSON-LD，全部为绝对日期；
   相对日期“3天前/今天”刻意不用——旧文章引用这些词会造成假新鲜）
3. **sitemap** — sitemap.xml（含 robots.txt 声明、sitemapindex 子文件）的最大 `<lastmod>`

最终 `lastUpdate = max(信号)`，并记录命中来源。某轮探测失败的博客**保留上次确认的日期**，不会被抹成“未知”。

## 本次结果

| 判定 | 数量 | 含义 |
| --- | --- | --- |
| unchanged | 1319 | 与之前一致 |
| date-shifted | 13 | 日期得到修正 |
| revived | 11 | **原本以为沉睡/未知，实际仍在更新** |
| newly-stale | 24 | **原本以为活跃，实际已沉睡** |

信号来源分布：feed=617，home=338，sitemap=234

| 指标 | 审计前 | 审计后 |
| --- | --- | --- |
| 确认沉睡(2年+) | 148 | 182 |
| 更新时间未知 | 293 | 153 |

RSS 地址修正：3 个（评论区 feed 排除后自动发现的新 feed，仅限同域名）

## 复活：以为沉睡，实际在更新（11）

- [张鑫旭-鑫空间-鑫生活](https://www.zhangxinxu.com/) — 此前记录 2024-07-01 → 实际 2026-10-08（来源: feed）
- [小蘿蔔丁](https://www.xlbd.me/) — 此前记录 2022-06-29 → 实际 2026-10-11（来源: feed）
- [Power's Wiki](https://wiki-power.com/) — 此前记录 2022-12-31 → 实际 2026-09-23（来源: feed）
- [jtr109's Castle](https://jtr109.com) — 此前记录 2024-03-28 → 实际 2026-08-19（来源: feed）
- [独立开发变现周刊](https://www.ezindie.com) — 此前记录 2020-07-05 → 实际 2026-10-08（来源: feed）
- [互航飞](https://www.huhangfei.com/) — 此前记录 2019-04-27 → 实际 2026-08-30（来源: feed）
- [老鱼的博客](https://hgoldfish.com/) — 此前记录 2022-04-13 → 实际 2026-10-03（来源: feed）
- [RustFisher软件开发](https://an.rustfisher.com) — 此前记录 2022-02-08 → 实际 2026-08-27（来源: feed）
- [叹世界](https://www.hauhau.cn) — 此前记录 2024-04-19 → 实际 2026-02-17（来源: sitemap）
- [Lcblogcraft](http://luviichann.top/) — 此前未知 → 实际 2025-01-06（来源: home）
- [姓王者的博客](https://xingwangzhe.fun/) — 此前记录 2024-06-20 → 实际 2026-10-11（来源: feed）

## 新发现沉睡：以为活跃，实际已停更（24）

- [Allen's Blog](https://www.capallen.top) — 此前记录 2026-10-01 → 实际 未知（来源: -）
- [朝舞](https://ii74.com) — 此前记录 2026-07-13 → 实际 未知（来源: -）
- [Teach Talk](https://www.ttalk.im/) — 此前记录 2026-10-01 → 实际 未知（来源: -）
- [区块链罗宾](https://dbarobin.com) — 此前记录 2026-05-12 → 实际 未知（来源: -）
- [jax - 走在路上](https://cdjax.com/) — 此前记录 2026-08-16 → 实际 未知（来源: -）
- [teobler](https://teobler.com) — 此前记录 2025-11-01 → 实际 未知（来源: -）
- [苍穹の下](https://www.blueskyxn.com) — 此前记录 2025-06-23 → 实际 未知（来源: -）
- [程序员忆初](https://www.developerastrid.com/) — 此前记录 2025-08-28 → 实际 未知（来源: -）
- [lowinli's blog](https://lowin.li/) — 此前记录 2026-01-02 → 实际 未知（来源: -）
- [White Space](https://whites.space) — 此前记录 2024-10-14 → 实际 未知（来源: -）
- [屹铭说](https://www.iccat.cn) — 此前记录 2025-10-17 → 实际 未知（来源: -）
- [Jim Luo's blog](https://www.jimmieluo.com/) — 此前记录 2026-10-09 → 实际 未知（来源: -）
- [了迹奇有没](https://whrss.com) — 此前记录 2026-10-02 → 实际 未知（来源: -）
- [LanYunのBlog](https://lanyundev.com/) — 此前记录 2026-08-07 → 实际 未知（来源: -）
- [钟意博客](https://thatcoder.cn/) — 此前记录 2026-04-08 → 实际 未知（来源: -）
- [潘智祥](https://blog.panzhixiang.cn/) — 此前记录 2026-06-01 → 实际 未知（来源: -）
- [王光卫博客](https://www.guangweiblog.com/) — 此前记录 2026-04-28 → 实际 未知（来源: -）
- [阮超民的个人网站](https://www.ruanchaomin.com/) — 此前记录 2026-10-08 → 实际 未知（来源: -）
- [Kerry的学习笔记](https://kerrynotes.com/) — 此前记录 2026-09-14 → 实际 未知（来源: -）
- [闪电的自留地](https://blog.lyujp.com) — 此前记录 2026-08-30 → 实际 未知（来源: -）
- [Nemo](https://nemo.cool/) — 此前记录 2026-08-23 → 实际 未知（来源: -）
- [Oleg's Tech Blog](https://timoshinoleg-eng.github.io/blog/) — 此前记录 2026-06-18 → 实际 未知（来源: -）
- [冰冻大西瓜的博客](https://bddxg.top/) — 此前记录 2026-09-07 → 实际 未知（来源: -）
- [Huan's Blog](https://blog.huan99.com) — 此前记录 2025-10-17 → 实际 未知（来源: -）

## RSS 地址修正（3）

- [小吴乐意Blog](https://blog.xiaowuleyi.com/) — `https://blog.xiaowuleyi.com/rss.php` → `https://blog.xiaowuleyi.com/rss.xml`
- [Frytea's Blog](https://www.frytea.com) — `https://www.frytea.com/index.xml` → `https://www.frytea.com/feed`
- [Kuricat's Blog](https://kuricat.com) — `https://kuricat.com/rss` → `https://kuricat.com/feed.xml`

