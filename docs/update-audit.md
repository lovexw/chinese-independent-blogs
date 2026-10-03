# 更新时间审计报告（多信号）

> 由 `scripts/update-audit.mjs` 于 2026-10-03 生成，每周随巡检更新。

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
| unchanged | 858 | 与之前一致 |
| date-shifted | 297 | 日期得到修正 |
| revived | 133 | **原本以为沉睡/未知，实际仍在更新** |
| newly-stale | 10 | **原本以为活跃，实际已沉睡** |

信号来源分布：feed=584，home=256，sitemap=294

| 指标 | 审计前 | 审计后 |
| --- | --- | --- |
| 确认沉睡(2年+) | 148 | 155 |
| 更新时间未知 | 293 | 160 |

RSS 地址修正：115 个（评论区 feed 排除后自动发现的新 feed，仅限同域名）

## 复活：以为沉睡，实际在更新（133）

- [酷 壳 – CoolShell](https://coolshell.cn) — 此前记录 2023-05-09 → 实际 2026-08-29（来源: home）
- [The Will Will Web](https://blog.miniasp.com) — 此前未知 → 实际 2026-09-22（来源: sitemap）
- [人人都是产品经理——iamsujie](https://blog.csdn.net/iamsujie) — 此前未知 → 实际 2026-05-15（来源: home）
- [余果的博客](https://yuguo.us) — 此前未知 → 实际 2026-03-25（来源: home）
- [我爱自然语言处理](https://www.52nlp.cn/) — 此前未知 → 实际 2026-04-04（来源: sitemap）
- [刘悦的技术博客](https://v3u.cn) — 此前未知 → 实际 2024-12-09（来源: home）
- [IPhysResearch](https://iphysresearch.github.io/blog/) — 此前记录 2023-05-30 → 实际 2026-09-21（来源: home）
- [Teach Talk](https://www.ttalk.im/) — 此前未知 → 实际 2026-10-01（来源: sitemap）
- [悬铃木](https://blog.hbsun.top/) — 此前未知 → 实际 2025-01-31（来源: sitemap）
- [五分钟学算法](https://www.algomooc.com/) — 此前未知 → 实际 2026-09-27（来源: sitemap）
- [Panda Home](https://old-panda.com/) — 此前未知 → 实际 2026-07-25（来源: feed）
- [朱双印](https://www.zsythink.net/) — 此前记录 2022-06-30 → 实际 2026-05-12（来源: home）
- [LarsCheng](http://larscheng.com/) — 此前未知 → 实际 2026-10-03（来源: home）
- [Lu Shuyu](https://blog.lushuyu.site/) — 此前记录 2024-07-03 → 实际 2025-12-13（来源: sitemap）
- [Jansora](https://www.jansora.com/) — 此前未知 → 实际 2026-09-29（来源: home）
- [DuyaoSS](https://www.duyaoss.com/) — 此前记录 2024-04-30 → 实际 2026-08-17（来源: home）
- [木子](https://blog.k8s.li/) — 此前记录 2024-06-13 → 实际 2025-01-16（来源: sitemap）
- [阳志平的网志](https://www.yangzhiping.com/) — 此前未知 → 实际 2026-09-20（来源: sitemap）
- [Beyond the Void](https://www.byvoid.com/) — 此前未知 → 实际 2026-07-31（来源: sitemap）
- [清言](https://plausistory.blog/) — 此前记录 2024-01-25 → 实际 2026-10-03（来源: home）
- [琚致远](https://juzhiyuan.me/) — 此前未知 → 实际 2025-09-21（来源: sitemap）
- [Tinywan 杂货摊](https://www.tinywan.com) — 此前未知 → 实际 2025-11-13（来源: home）
- [Dawner](https://dawner.top/) — 此前未知 → 实际 2026-10-03（来源: sitemap）
- [TwIStOy](https://twistoy.cn/) — 此前记录 2023-10-04 → 实际 2025-06-12（来源: sitemap）
- [区块链罗宾](https://dbarobin.com) — 此前未知 → 实际 2026-05-12（来源: sitemap）
- [Platform Thinking +](https://pt.plus) — 此前未知 → 实际 2026-08-25（来源: sitemap）
- [陈仓颉](https://jefftay.com/) — 此前未知 → 实际 2026-09-21（来源: sitemap）
- [Diff客旅日记](https://diff.im/blog/) — 此前未知 → 实际 2024-12-20（来源: home）
- [一切皆有可能](http://kubesphereio.com/) — 此前未知 → 实际 2026-10-03（来源: sitemap）
- [堆栈酒馆](http://atticuslab.com/) — 此前未知 → 实际 2026-10-03（来源: sitemap）
- [JimmyLv@吕立青的博客](https://blog.jimmylv.info) — 此前记录 2024-02-08 → 实际 2026-09-17（来源: sitemap）
- [herrkaefer](https://herrkaefer.com/) — 此前未知 → 实际 2026-03-08（来源: sitemap）
- [魚立说](https://www.yulisay.com) — 此前未知 → 实际 2026-05-18（来源: sitemap）
- [崮生 • 一些随笔 🎨](https://shenzilong.cn/) — 此前未知 → 实际 2026-10-03（来源: sitemap）
- [木小丰的博客](https://lesofn.com/) — 此前未知 → 实际 2025-04-23（来源: home）
- [Max_Qiu](https://maxqiu.com) — 此前未知 → 实际 2026-08-21（来源: sitemap）
- [侯爷的博客](http://houye.xyz/) — 此前未知 → 实际 2026-10-03（来源: home）
- [珒陶](https://blog.chenjt.com/) — 此前未知 → 实际 2024-10-12（来源: home）
- [刘荣星的博客](https://www.liurongxing.com/) — 此前记录 2023-12-08 → 实际 2024-11-07（来源: sitemap）
- [Fl0w3r](https://yousazoe.top) — 此前未知 → 实际 2026-09-12（来源: sitemap）
- [程序员忆初](https://www.developerastrid.com/) — 此前未知 → 实际 2025-08-28（来源: sitemap）
- [Shall We Code?](https://www.waynerv.com/) — 此前未知 → 实际 2025-02-26（来源: sitemap）
- [思为说](https://siwei.io) — 此前未知 → 实际 2025-04-30（来源: sitemap）
- [凌赟's blog](https://www.zhukang.tech/) — 此前记录 2022-04-05 → 实际 2026-10-01（来源: sitemap）
- [Zhendong的博客](https://www.kxit.net/) — 此前记录 2024-03-26 → 实际 2026-07-10（来源: sitemap）
- [emperinter's blog](https://www.emperinter.info) — 此前未知 → 实际 2026-05-25（来源: feed）
- [itgoyo's blog](https://itgoyo.github.io/) — 此前未知 → 实际 2026-09-15（来源: home）
- [hqingLau的博客](http://www.orzlinux.cn/) — 此前未知 → 实际 2026-10-03（来源: sitemap）
- [White Space](https://whites.space) — 此前未知 → 实际 2024-10-14（来源: sitemap）
- [忘忧 忘忧的小站](https://wangyou233.wang/) — 此前未知 → 实际 2025-11-14（来源: home）
- [gyro永不抽风！](https://gyrojeff.top) — 此前记录 2023-02-18 → 实际 2025-04-20（来源: home）
- [程序员充电站](https://itcharge.cn) — 此前未知 → 实际 2026-07-10（来源: sitemap）
- [Huiliu](https://fucktheworld.top/) — 此前记录 2022-10-06 → 实际 2026-08-02（来源: sitemap）
- [Sirius's Blog](https://blog.yeefire.com) — 此前记录 2021-09-06 → 实际 2025-11-28（来源: sitemap）
- [后端工程师](https://hdgcs.com) — 此前未知 → 实际 2026-09-17（来源: home）
- [Shadow Walker 松烟阁](https://www.edony.ink/) — 此前未知 → 实际 2026-10-01（来源: sitemap）
- [D2PE](https://d2pe.com) — 此前未知 → 实际 2026-09-11（来源: sitemap）
- [Alfxjx的博客](https://www.abandon.work) — 此前未知 → 实际 2026-05-25（来源: sitemap）
- [富录-前端开发](https://www.arbays.com/) — 此前未知 → 实际 2026-04-01（来源: home）
- [QAIU's Blog](https://blog.qaiu.top/) — 此前未知 → 实际 2026-08-31（来源: home）
- [SakuraWald](https://sakurawald.github.io/) — 此前未知 → 实际 2026-05-19（来源: feed）
- [冰雪殇璃陌梦の小站](https://www.dreamofice.cn) — 此前记录 2023-09-25 → 实际 2025-09-05（来源: sitemap）
- [七米蓝](https://www.chirmyram.top/) — 此前记录 2021-12-13 → 实际 2026-07-07（来源: sitemap）
- [戴兜的小屋](https://daidr.me) — 此前记录 2024-04-09 → 实际 2026-10-03（来源: home）
- [matsuri's neverland](https://matsuri.site/) — 此前未知 → 实际 2025-12-22（来源: home）
- [小冷-瞎逼逼](https://littlecold.cn/) — 此前未知 → 实际 2026-01-07（来源: home）
- [阿猫的博客](https://ameow.xyz/) — 此前未知 → 实际 2026-08-11（来源: home）
- [流年石刻](https://www.timeshike.com/) — 此前未知 → 实际 2026-04-01（来源: home）
- [了迹奇有没](https://whrss.com) — 此前未知 → 实际 2026-10-02（来源: sitemap）
- [Wriprin's Blog](https://blog.cnix.cc) — 此前记录 2023-02-09 → 实际 2026-09-27（来源: home）
- [xiongxinwei的个人博客](https://cubxxw.com/) — 此前未知 → 实际 2026-10-03（来源: home）
- [Mycpen](https://blog.cpen.top/) — 此前记录 2023-10-11 → 实际 2025-11-01（来源: home）
- [我不是咕咕鸽](https://blog.laoda.de/) — 此前未知 → 实际 2026-09-19（来源: home）
- [HuangFuSL's Blog](https://blog.huangfusl.net/) — 此前未知 → 实际 2025-05-16（来源: home）
- [Anjhon’s Blog](https://www.anjhon.top/) — 此前未知 → 实际 2025-04-18（来源: home）
- [Yi's Blog](https://ycao.net/) — 此前未知 → 实际 2026-08-03（来源: home）
- [Enderfga's blog](https://enderfga.cn/) — 此前未知 → 实际 2026-06-08（来源: sitemap）
- [Freeze's Blog](https://durongjie.com) — 此前未知 → 实际 2026-09-22（来源: home）
- [闫越的网络日志](https://yanyue404.github.io/blog/) — 此前未知 → 实际 2026-09-22（来源: home）
- [千古八方的博客](https://rangotec.com) — 此前未知 → 实际 2026-09-09（来源: sitemap）
- [清风菀月轩](http://qingwan.top) — 此前未知 → 实际 2024-11-08（来源: home）
- [豆逗子的小黑屋](https://weaxsey.org) — 此前未知 → 实际 2025-12-09（来源: feed）
- [饭喵](https://blog.fanmiao.site) — 此前记录 2023-08-05 → 实际 2026-10-03（来源: home）
- [trudbot's blog](https://trudbot.cn) — 此前未知 → 实际 2026-07-02（来源: home）
- [潘智祥](https://blog.panzhixiang.cn/) — 此前未知 → 实际 2026-06-01（来源: feed）
- [PHP武器库](https://phpreturn.com) — 此前未知 → 实际 2026-06-26（来源: sitemap）
- [菜皮日记](https://www.lipijin.com/) — 此前未知 → 实际 2025-06-13（来源: sitemap）
- [叹世界](https://www.hauhau.cn) — 此前记录 2024-04-19 → 实际 2026-02-17（来源: sitemap）
- [Jason Lee的个人博客](https://blog.jasonleehere.com/) — 此前未知 → 实际 2026-09-29（来源: feed）
- [王郁的小站](https://wycode.cn/) — 此前未知 → 实际 2026-09-15（来源: home）
- [booop](http://booop.net/) — 此前未知 → 实际 2026-10-03（来源: sitemap）
- [Lcblogcraft](http://luviichann.top/) — 此前未知 → 实际 2025-01-06（来源: home）
- [lazy_forever's Blog](https://blog.lazyforever.top/) — 此前记录 2024-04-24 → 实际 2024-11-19（来源: sitemap）
- [Raye's Journey](https://rayepeng.net) — 此前未知 → 实际 2026-05-01（来源: feed）
- [tcmiku的档案库](https://tcmiku.github.io/) — 此前未知 → 实际 2025-04-28（来源: home）
- [烧烤的小站](https://blog.verlif.top/) — 此前未知 → 实际 2026-04-22（来源: home）
- [JaSpirit 的万事屋](https://blog.jaspirit.cc/) — 此前记录 2024-09-25 → 实际 2025-02-04（来源: home）
- [OneCoder的博客](https://www.coderli.com) — 此前未知 → 实际 2026-10-03（来源: sitemap）
- [小松鼠的博客](https://ycyin.eu.org) — 此前未知 → 实际 2025-08-01（来源: feed）
- [人生足迹 · 博客平台](https://blog.lifebus.top) — 此前未知 → 实际 2024-12-13（来源: home）
- [RisingIce](https://www.imrising.cn/) — 此前未知 → 实际 2026-09-04（来源: sitemap）
- [Wake Me Up When September Ends.](https://www.zyimm.com) — 此前未知 → 实际 2026-03-13（来源: home）
- [好好学习的郝](https://www.voidking.com/) — 此前未知 → 实际 2026-11-02（来源: sitemap）
- [崔鹏飞的blog](http://cuipengfei.me/) — 此前未知 → 实际 2026-10-03（来源: sitemap）
- [宇宇博客](https://nxysj.top/) — 此前未知 → 实际 2026-10-01（来源: home）
- [二歪同学](https://blog.waistu.com) — 此前未知 → 实际 2026-04-07（来源: home）
- [runzhliu的容器笔记](https://runzhliu.cn/) — 此前未知 → 实际 2026-03-21（来源: home）
- [映屿](https://blog.verdant.ee/) — 此前未知 → 实际 2026-09-05（来源: home）
- [行书指南](https://xszn.org/) — 此前未知 → 实际 2026-07-06（来源: sitemap）
- [TansBlog](https://tans.fun) — 此前未知 → 实际 2025-11-02（来源: home）
- [Kevin's Blog](https://kevintan.pro/) — 此前未知 → 实际 2025-10-02（来源: sitemap）
- [假设检验](https://jiashejianyan.com) — 此前未知 → 实际 2026-09-20（来源: sitemap）
- [solaireh3](https://Ashlord.com) — 此前未知 → 实际 2026-09-22（来源: home）
- [Yibo's Blog](https://boboxy.github.io/) — 此前未知 → 实际 2026-05-12（来源: home）
- [資工小廢物 - JN](https://blog.giveanornot.com/) — 此前未知 → 实际 2026-10-01（来源: home）
- [技术人的一亩田](https://jeremysong.cn) — 此前未知 → 实际 2026-03-31（来源: home）
- [Firenze42](https://firenze42.com/zh) — 此前未知 → 实际 2026-10-03（来源: sitemap）
- [Haku](https://re.karlbaey.top) — 此前未知 → 实际 2026-09-30（来源: home）
- [郭飞的笔记](https://www.guofei.site/) — 此前未知 → 实际 2026-08-01（来源: home）
- [BWYLBT Blog](https://blog.sxizhuo.cn/) — 此前记录 2024-07-25 → 实际 2026-10-03（来源: sitemap）
- [keggin's blog](https://keggin.tech/) — 此前未知 → 实际 2026-06-08（来源: home）
- [戈壁有耳](https://www.zhanggeer.net/) — 此前未知 → 实际 2026-09-09（来源: home）
- [捻墨运营笔记](https://dyy.nianmo.top) — 此前未知 → 实际 2026-01-15（来源: home）
- [未曾见过的山与海](https://tangzhipeng.cn/) — 此前未知 → 实际 2026-10-02（来源: sitemap）
- [小助点](https://helpoke.com/) — 此前未知 → 实际 2026-09-29（来源: sitemap）
- [狐莘月柒的博客](https://yueqi1sama.github.io/) — 此前未知 → 实际 2026-03-23（来源: home）
- [余一叶知秋尽](https://pengline.cn/) — 此前未知 → 实际 2026-09-30（来源: feed）
- [智客](https://zicq.com/) — 此前未知 → 实际 2026-10-03（来源: home）
- [Garan no dou](https://blog.ibireme.com/) — 此前记录 2023-09-27 → 实际 2026-10-03（来源: sitemap）
- [可能吧](https://kenengba.com/) — 此前记录 2024-01-24 → 实际 2026-10-03（来源: home）
- [KSkun's Blog](https://ksmeow.moe/) — 此前记录 2023-04-15 → 实际 2026-10-03（来源: home）
- [Easton Man's Blog](https://blog.eastonman.com) — 此前记录 2024-03-19 → 实际 2026-10-02（来源: home）
- [solaireh3](https://Ashlord.com) — 此前未知 → 实际 2026-09-22（来源: home）

## 新发现沉睡：以为活跃，实际已停更（10）

- [MouT.me](https://mout.me) — 此前记录 2026-10-02 → 实际 2020-07-24（来源: feed）
- [遥远的街市](https://blog.henix.info/) — 此前记录 2025-05-28 → 实际 2024-04-28（来源: home）
- [焦点的动力炉](https://dianjiaogit.github.io/) — 此前记录 2025-05-15 → 实际 2023-05-26（来源: home）
- [Amicoyuan的高性能计算世界](https://xingyuanjie.top) — 此前记录 2026-10-02 → 实际 2023-07-30（来源: feed）
- [Jim Luo's blog](https://www.jimmieluo.com/) — 此前记录 2026-10-01 → 实际 未知（来源: -）
- [老鱼的博客](https://hgoldfish.com/) — 此前记录 2026-10-02 → 实际 2022-10-18（来源: feed）
- [方寸之间](https://smj.im) — 此前记录 2026-05-31 → 实际 2023-08-20（来源: feed）
- [Jame](https://jame.work/) — 此前记录 2026-09-15 → 实际 未知（来源: -）
- [Shanwer's Blog](https://blog.shanwer.top) — 此前记录 2026-08-11 → 实际 未知（来源: -）
- [月石MoonStone](https://moonstone.fun) — 此前记录 2025-10-27 → 实际 未知（来源: -）

## RSS 地址修正（115）

- [开源实验室](https://kymjs.com) — `https://www.kymjs.com/feed.xml` → `https://kymjs.com/feed`
- [陈沙克日志](http://www.chenshake.com) — `http://www.chenshake.com/feed/` → `https://chenshake.com/feed`
- [解道jdon.com](https://www.jdon.com) — `https://www.jdon.com/jivejdon/rss` → `https://www.jdon.com/rss`
- [程序师](https://www.techug.com) — `http://www.techug.com/feed` → `https://www.techug.com/feed/`
- [林小沐](https://immmmm.com) — `http://feed.immmmm.com/` → `https://immmmm.com/feed`
- [isaced](https://www.isaced.com/) — `http://www.isaced.com/index.xml` → `https://www.isaced.com/rss.xml`
- [王垠的博客](https://www.yinwang.org/) — `https://rsshub.app/blogs/wangyin` → `https://www.yinwang.org/notes/feed.xml`
- [某岛](http://www.shuizilong.com/house) — `http://www.shuizilong.com/house/feed/` → `https://www.shuizilong.com/house/feed/atom/`
- [搞搞震](https://www.wujingquan.com) — `https://www.wujingquan.com/atom.xml` → `https://www.wujingquan.com/feed`
- [Allen's Blog](https://www.capallen.top) — `https://www.capallen.top/atom.xml` → `https://capallen.top/feed/`
- [Tianke Youke](https://jyzhu.top) — `https://jyzhu.top/atom.xml` → `https://jyzhu.top/feed.xml`
- [Realcat](https://www.vincentqin.tech/) — `https://www.vincentqin.tech/atom.xml` → `https://vincentqin.tech/rss.xml`
- [WEB VIEW](https://webview.tech/) — `https://webview.tech/category/blog/feed/` → `https://webview.tech/feed/podcast/`
- [可可托海没有海](https://darmau.co/zh) — `https://darmau.co/zh/article/rss.xml` → `https://darmau.co/zh/rss.xml`
- [小蘿蔔丁](https://www.xlbd.me/) — `http://xlbd.me/rss/` → `https://xlbd.me/feed.xml`
- [沐凉](https://blog.lacia.cn) — `https://blog.lacia.cn/atom.xml` → `https://blog.lacia.cn/feed`
- [Panda Home](https://old-panda.com/) — `https://old-panda.com/feed/` → `https://old-panda.com/atom.xml`
- [青空之蓝](https://blog.ixk.me) — `https://blog.ixk.me/feed` → `https://blog.ixk.me/rss.xml`
- [LFhacks.com](https://www.lfhacks.com/) — `https://www.lfhacks.com/rss/` → `https://www.lfhacks.com/rss`
- [CodeSky](https://codesky.me) — `https://codesky.me/feed/` → `https://www.codesky.me/feed`
- [CallMeSoul](https://callmesoul.cn) — `https://callmesoul.cn/rss.xml` → `https://callmesoul.cn/feed`
- [Bryan's Blog](https://articles.singee.me/) — `https://articles.singee.me/feed/xml` → `https://blog.singee.me/atom.xml`
- [typeblog](https://typeblog.net/) — `https://typeblog.net/rss/` → `https://typeblog.net/feed.xml`
- [失眠海峡](https://blog.imalan.cn) — `https://blog.imalan.cn/feed.xml` → `https://blog.imalan.cn/feed/atom/index.xml`
- [编程沉思录](https://www.cyhone.com) — `https://www.cyhone.com/atom.xml` → `https://www.cyhone.com/feeds/all.xml`
- [ScarSu的个人网站](https://www.scarsu.com/) — `https://www.scarsu.com/atom.xml` → `https://scarsu.com/rss.xml`
- [61's life](https://61.life/) — `https://61.life/feed.xml` → `https://61.life/feed/post.xml`
- [Chores](http://blog.raincorn.top/) — `https://raincorn.top/feed/` → `http://blog.raincorn.top/atom.xml`
- [L1Yu's Blog - 蓝色的博客](https://www.l1yu.com) — `https://www.l1yu.com/feed/feed.xml` → `https://www.l1yu.com/rss`
- [Wulu's Blog](https://wulu.zone/) — `https://wulu.zone/feed/post.xml` → `https://wulu.zone/feed.xml`
- [Ray's Blog](https://blog.mk1.io) — `https://blog.mk1.io/api/feed` → `https://blog.mk1.io/rss.xml`
- [Gowhich](https://www.gowhich.com) — `https://www.gowhich.com/feed` → `https://gowhich.com/rss.xml`
- [251](https://blog.251.sh/) — `https://blog.251.sh/feed/` → `https://blog.251.sh/feed.xml`
- [懒得勤快的博客](https://masuit.com) — `https://masuit.com/rss` → `https://masuit.net/rss/`
- [HappyHack](https://growcoin.pw/) — `https://blog.happyhack.io/atom.xml` → `https://eshopper.vc/feed/`
- [王宜楷工作室](http://wangyikai.com) — `http://wangyikai.com/feed` → `http://wangyikai.com/?feed=rss2`
- [Shuo's Blog](https://wushuo.me) — `https://wushuo.me/atom.xml` → `https://wushuo.me/index.xml`
- [苍穹の下](https://www.blueskyxn.com) — `https://www.blueskyxn.com/feed/` → `https://www.blueskyxn.com/feed`
- [Orange](https://blog.orange.tw/) — `https://feeds.feedburner.com/blogspot/Aohx` → `https://blog.orange.tw/atom.xml`
- [sulinehk's blog](https://www.sulinehk.com/) — `https://www.sulinehk.com/index.xml` → `https://www.sulinehk.com/rss.xml`
- [方泽强](https://zeqiang.fun) — `https://zeqiang.fun/index.xml` → `https://zeqiang.fun/rss.xml`
- [mengtnt的Blog](https://mengtnt.com/) — `https://mengtnt.com/rss` → `https://mengtnt.com/feed`
- [7gugu's Blog](https://www.7gugu.com) — `https://www.7gugu.com/feed/` → `https://7gugu.com/index.php/feed/`
- [墨菲易](https://murphyyi.com/) — `https://blog.murphyyi.com/atom.xml` → `https://murphyyi.com/index.xml`
- [吴润写字的地方](http://wu.run) — `http://wu.run/atom.xml` → `https://wu.run/index.xml`
- [周良博客](https://imzl.com/) — `https://imzl.com/feed/` → `https://imzl.com/rss.xml`
- [emperinter's blog](https://www.emperinter.info) — `https://www.emperinter.info/sitemap.rss` → `https://www.emperinter.info/feed`
- [Godot's Blog](https://iamgodot.com) — `https://iamgodot.com/posts/index.xml` → `https://iamgodot.com/rss.xml`
- [whyes的博客](https://whyes.org) — `https://whyes.org/feed.xml` → `https://whyes.org/feed/post.xml`
- [一颗小树](https://yeshu.cloud/) — `https://yeshu.cloud/atom.xml` → `https://yeshu.cloud/rss.xml`
- [LのWorld](https://lllgoyour.com/) — `https://lllgoyour.com/feed/` → `https://lllgoyour.com/rss.xml`
- [林林杂语](https://www.xiaozonglin.cn/) — `https://www.xiaozonglin.cn/feed/` → `https://www.xiaozonglin.cn/blog/rss.xml`
- [jtr109's Castle](https://jtr109.com) — `https://www.jtr109.com/index.xml` → `https://jtr109.com/atom.xml`
- [烧饼博客](https://u.sb) — `https://u.sb/rss.xml` → `https://u.sb/atom.xml`
- [杂烩饭](https://zahui.fan) — `https://zahui.fan/index.xml` → `https://zahui.fan/atom.xml`
- [陈昱行博客](https://yuhang.ch/) — `https://blog.yuhang.ch/index.xml` → `https://yuhang.ch/rss.xml`
- [Frange Zone｜Xu's Blog](https://frangezone.github.io) — `https://frangezone.github.io/index.xml` → `https://frangezone.github.io/feed`
- [SakuraWald](https://sakurawald.github.io/) — `https://sakurawald.github.io/sitemap.xml` → `https://sakurawald.github.io/atom.xml`
- [DAVID'S BLOG](https://blog.blahaj.uk/) — `https://blog.blahaj.uk/feed` → `https://blog.blahaj.uk/rss.xml`
- [Owen的博客](https://www.owenyoung.com) — `https://www.owenyoung.com/atom.xml` → `https://www.owenyoung.com/latest/feed`
- [Chancel's blog](https://www.chancel.me/) — `https://www.chancel.me/rest/api/v1/feed` → `https://www.chancel.me/rss.xml`
- [Qiuyuair的自留地](https://qiuyuair.com/) — `https://qiuyuair.com/feed/` → `https://qiuyuair.com/index.xml`
- [造壳 MkShell](https://www.mkshell.com/) — `https://www.mkshell.com/feed/` → `https://www.mkshell.com/rss.xml`
- [Finisky Garden](https://finisky.github.io/) — `https://finisky.github.io/atom.xml` → `https://finisky.github.io/rss`
- [SeerSu](https://suus.me/) — `https://suus.me/index.xml` → `https://suus.me/rss.xml`
- [Wang's Blog](https://vlight.me/) — `https://vlight.me/rss2.xml` → `https://vlight.me/atom.xml`
- [YuZhangWang的领域](https://yuzhang.wang/) — `https://yuzhang.wang/atom.xml` → `https://yuzhang.wang/rss2.xml`
- [EAimTY 的博客](https://www.eaimty.com/) — `https://www.eaimty.com/feed/` → `https://www.eaimty.com/rss`
- [阿啊阿吖丁](https://4ading.com/) — `https://4ading.com/feed/` → `https://4ading.com/atom.xml`
- [一纸忘忧](https://www.ikxin.com/) — `https://www.ikxin.com/feed/` → `https://www.ikxin.com/atom.xml`
- [Anjhon’s Blog](https://www.anjhon.top/) — `https://www.anjhon.top/feed` → `https://www.anjhon.top/rss`
- [Tony Bai](https://tonybai.com/) — `http://feed.tonybai.com/` → `https://tonybai.com/index.xml`
- [膨胀的面包](https://blog.wangtwothree.com/) — `https://blog.wangtwothree.com/feed` → `https://wangtwothree.com/index.xml`
- [晓空blog](https://blog.moeworld.tech/) — `https://blog.moeworld.tech/feed/` → `https://blog.moeworld.tech/atom/`
- [Airing's Blog](https://ursb.me/) — `https://blog.ursb.me/feed.xml` → `https://ursb.me/reading/feed.xml`
- [TARESKY](https://taresky.com/) — `https://taresky.com/feed.xml` → `https://taresky.com/feed/post.xml`
- [牧尘的网络日志](https://www.dreamlyn.cn/) — `https://www.dreamlyn.cn/feed` → `https://www.dreamlyn.cn/atom.xml`
- [szhshp 的第三边境研究所](https://szhshp.org/) — `https://szhshp.org/sitemap.xml` → `https://szhshp.org/rss.xml`
- [LearnData 开源笔记](https://newzone.top/) — `https://newzone.top/rss.xml` → `https://newzone.top/atom.xml`
- [tj‘sblog_无聊项目聚集地](https://www.tjsite.cn/) — `https://www.tjsite.cn/feed.php` → `https://www.tjsite.cn/feed`
- [郑文峰的博客](https://www.zhengwenfeng.com) — `https://www.zhengwenfeng.com/rss.xml` → `https://www.zhengwenfeng.com/feed.atom`
- [云萧的咕咕屋](https://blog.crrashh.com/) — `https://blog.crrashh.com/feed` → `https://blog.crrashh.com/rss.xml`
- [若绾](https://royc30ne.com) — `https://royc30ne.xlog.app/feed/xml` → `https://www.royc30ne.com/feed`
- [豆逗子的小黑屋](https://weaxsey.org) — `https://weaxsey.org/index.html` → `https://weaxsey.org/index.xml`
- [菜皮日记](https://www.lipijin.com/) — `https://www.lipijin.com/feed` → `https://www.lipijin.com/rss`
- [Ivan's blog](https://ivanli.cc/) — `https://ivanli.cc/feed.xml` → `https://ivanli.cc/atom.xml`
- [FKY&JYQ](https://blog.fkynjyq.com) — `https://blog.fkynjyq.com/feed.xml` → `https://blog.fkynjyq.com/feed`
- [Krysztal的书桌](https://blog.krysztal.dev) — `https://blog.krysztal.dev/atom.xml` → `https://blog.krysztal.dev/rss`
- [元否的研究室](https://www.happyfou.com/) — `https://www.happyfou.com/index.xml` → `https://happyfou.com/feed`
- [Jason Lee的个人博客](https://blog.jasonleehere.com/) — `https://blog.jasonleehere.com/atom.xml` → `https://jasonleehere.com/feed.xml`
- [秋澪Akimio](https://blog.akimio.top/) — `https://blog.akimio.top/rss2.xml/` → `https://blog.akimio.top/atom.xml`
- [月梦の技术博客](https://ymiir.top/) — `https://ymiir.top/feed.xml` → `https://ymiir.top/feed`
- [Ruter's Blog](https://ruterly.com/) — `https://ruterly.com/feed/` → `https://ruterly.com/rss`
- [CuB3y0nd's Writings](https://cubeyond.net) — `https://www.cubeyond.net/feed.xml` → `https://www.cubeyond.net/rss.xml`
- [游钓四方](https://lhasa.icu/) — `https://lhasa.icu/atom.xml` → `https://blog.lhasa.icu/rss.xml/`
- [Innomad一挪迈](https://innomad.io) — `https://innomad.io/feed` → `https://innomad.io/rss`
- [一个夏天的年少](https://forrestgump618.github.io) — `https://forrestgump618.github.io/atom.xml` → `https://forrestgump618.github.io/rss`
- [小松鼠的博客](https://ycyin.eu.org) — `https://ycyin.eu.org/sitemap.xml` → `https://ycyin.eu.org/atom.xml`
- [RisingIce](https://www.imrising.cn/) — `https://www.imrising.cn/sitemap.xml` → `https://www.imrising.cn/rss.xml`
- [有话豪说](https://blog.lihao00.com/) — `https://www.lihao00.com/feed/` → `https://blog.lihao00.com/feed`
- [WSH](https://wsh233.cn) — `https://www.wsh233.cn/feed.xml` → `https://wsh233.cn/rss.xml`
- [好好学习的郝](https://www.voidking.com/) — `https://www.voidking.com/sitemap.xml` → `https://www.voidking.com/atom.xml`
- [Rolenx](https://home.yesord.top/) — `https://blog.yesord.top/atom.xml` → `https://home.yesord.top/atom.xml`
- [NBlog](https://blog.nocp.space/) — `https://nocp.space/rss/feed.json` → `https://nocp.space/rss/feed.xml`
- [Kevin's Blog](https://kevintan.pro/) — `https://kevintan.pro/sitemap.xml` → `https://kevintan.pro/feed`
- [SuperGrey的笔记本](https://supergrey.bearblog.dev/) — `https://supergrey.bearblog.dev/rss/` → `https://supergrey.bearblog.dev/feed/`
- [假设检验](https://jiashejianyan.com) — `https://jiashejianyan.com/sitemap.xml` → `https://jiashejianyan.com/rss/`
- [ICDYCT我能你也行](https://zelikk.blogspot.com/) — `https://zelikk.blogspot.com/rss.xml` → `https://zelikk.blogspot.com/feeds/posts/default`
- [GISerLab 地理空间](https://blog.giserlab.cn) — `https://blog.giserlab.cn/feed.xml` → `https://blog.giserlab.cn/rss.xml`
- [闪电的自留地](https://blog.lyujp.com) — `https://blog.lyujp.com/sitemap.xml` → `https://blog.lyujp.com/feed/`
- [刘果的小站](https://liu-guo.com/) — `https://liu-guo.com/feed.xml` → `https://www.liu-guo.com/rss.xml`
- [fengc's Blog](https://fengcblog.880200.xyz/) — `https://rssweball.top/feed/afaf2a3c-e11a-4783-a358-9e2d20d76a69.xml` → `https://fengcblog.880200.xyz/feed`
- [Amiya的书桌](https://blog.sayori.org/) — `https://blog.sayori.org/rss.xml` → `https://blog.sayori.org/atom.xml`
- [余一叶知秋尽](https://pengline.cn/) — `https://pengline.cn/sitemap.xml` → `https://pengline.cn/atom.xml`
- [可能吧](https://kenengba.com/) — `http://feeds.kenengba.com/kenengbarss` → `https://kenengba.com/feed`

