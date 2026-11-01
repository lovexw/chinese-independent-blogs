# 机器更新扫描报告（2026-11-01，范围：最近 7 天有更新的 187 个博客）

> 判定标准（双重指纹，缺一不杀）：A=cron 秒级指纹（≥3 篇发布时间精确到同一秒且跨 ≥2 天）+ B=标题模板化（≥3 篇）。
> 单一指纹进待复核名单。维护者确认后移除并写入 offline.json 永久拉黑。

## 实锤（8）

### https://miaotony.xyz/
- cron 指纹：19:30:00 x2天，13:30:00 x2天，12:30:00 x2天，14:30:00 x3天（共 40 条）
- 标题模板："CTFUSTCHackergameWriteUpx" x3
- 样例标题："Security | PHP2Shell：内存耗尽之后，服务器怎么就被拿下了？"、"Tech | Jev：不写一句话的 AI，怎么替程序做决定？"、"Security | CVE-2026-85706 GitLab 未授权任意文件读取漏洞分析"、"CTF | 2023 强网杯 S7 线上赛 WriteUp"

### https://youerning.top
- cron 指纹：16:00:00 x31天，02:47:13 x7天，10:30:27 x6天，10:30:15 x2天（共 153 条）
- 标题模板："rust网络框架Pingora源码阅读" x3
- 样例标题："腾讯云 Octop 快速入门：一小时跑通一个自托管的多用户 Agent 平台"、"AI 认识你的公司，不等于会推荐你：我们开源了 GEO Probe"、"WorkBuddy + REA 逆向框架：从一个不给导出的 App 里拿回 936 条打卡记录"、"使用智能体辅助 N1 盒子刷机：从备份到恢复 AdGuard Home 和 SmartDNS"

### https://wsh233.cn
- cron 指纹：16:00:00 x37天（共 167 条）
- 标题模板："无题" x5
- 样例标题："手机编年史"、"岗位保护"、"一只没有尾巴的猪"、"人生片段"

### https://yindongliang.com/
- cron 指纹：00:00:00 x217天，16:00:00 x2天（共 546 条）
- 标题模板："基础概念" x4
- 样例标题："workerd：运行原理、源码架构与自部署流程"、"huashu-design：在 Agent 里打一句话拿回能交付的设计"、"划词高亮原理与实现"、"Vite+（vite-plus）调研：统一前端工具链与 vp 用法"

### https://varzy.me
- cron 指纹：00:00:00 x120天（共 155 条）
- 标题模板："主页" x3
- 样例标题："使用 zsh 脚本同步 MacOS 开发环境"、"咖啡店广告"、"晚上十点半的众生相"、"中秋国庆小记"

### https://www.ranjl.cn/
- cron 指纹：09:00:03 x28天，09:00:01 x2天（共 50 条）
- 标题模板："学习问答" x37
- 样例标题："2026-11-01-学习问答"、"2026-10-31-学习问答"、"2026-10-30-学习问答"、"Vue 4 的消息之后，前端该怎么学"

### https://www.ftium4.com/
- cron 指纹：16:41:45 x14天，08:41:45 x2天，21:41:45 x2天（共 40 条）
- 标题模板："体验碎周报第期" x31
- 样例标题："体验碎周报第296期(2026.10.26)"、"体验碎周报第295期(2026.10.22)"、"体验碎周报第294期(2026.10.12)"、"体验碎周报第293期(2026.10.8)"

### https://wiki.eryajf.net
- cron 指纹：21:48:38 x2天，09:28:26 x2天，08:27:15 x2天，10:56:00 x2天（共 470 条）
- 标题模板："学习周刊总第期年第周" x252
- 样例标题："学习周刊-总第287期-2026年第44周"、"学习周刊-总第286期-2026年第43周"、"学习周刊-总第285期-2026年第42周"、"学习周刊-总第284期-2026年第41周"

## 待人工复核（68）

- https://blog.forecho.com — cron:02:00:00 x8天 / 靠近抓取时间的条目:0 / 样例:ICT 核心概念笔记：流动性、FVG、Power of 3 与订单块
- https://geekplux.com — cron:22:00:00 x2天,00:10:00 x2天,20:00:00 x13天,22:22:00 x2天 / 靠近抓取时间的条目:0 / 样例:Wish-Driven Development: Excitement Over Anxiety
- https://nicksxs.me — cron:12:00:00 x4天 / 靠近抓取时间的条目:0 / 样例:DeepSeek Harness 怎样把模型的一次回答变成可继续执行的任务
- https://lucifer.ren/blog — cron:16:00:00 x16天 / 靠近抓取时间的条目:0 / 样例:《查拉图斯特拉如是说》导读：一本反福音书
- https://www.vincentqin.tech/ — cron:00:00:00 x77天 / 靠近抓取时间的条目:0 / 样例:Think Different
- https://www.yinwang.org/ — cron:06:24:00 x2天,14:05:00 x2天,07:04:00 x2天,06:22:00 x2天 / 靠近抓取时间的条目:0 / 样例:体育运动的社交价值
- https://www.xlbd.me/ — cron:10:24:00 x11天 / 靠近抓取时间的条目:1 / 样例:小蘿蔔丁迁移到LiNode，开博一年纪念。
- http://lukefan.com/ — cron:00:30:00 x9天 / 靠近抓取时间的条目:0 / 样例:币安被盗、群晖被锁：AI打破攻防平衡，普通用户谁来兜底？
- https://wsdjeg.net/ — cron:00:00:00 x32天 / 靠近抓取时间的条目:0 / 样例:chat.nvim v1.11.0 与 v1.11.1：多 API Key 透明故障转移、截断续写与工具参数归一化
- https://cyrusyip.org/ — cron:16:00:00 x52天 / 靠近抓取时间的条目:0 / 样例:日产轩逸：白开水般的车
- https://zhurongshuo.com/ — cron:16:00:00 x3天 / 靠近抓取时间的条目:0 / 样例:过程实在论：观察收敛与确定性生成（RC）
- https://blog.orange.tw/ — cron:16:00:00 x92天 / 靠近抓取时间的条目:0 / 样例:The Last Proof of Human Craft: Forging a Microsoft Edge Full Chain with Logic Bugs Only!
- https://ednovas.xyz — cron:22:28:00 x4天,21:28:00 x2天 / 靠近抓取时间的条目:0 / 样例:Mondoze 云端 Mac mini M4 与 BX 独立服务器
- https://springwood.me — cron:15:00:00 x21天 / 靠近抓取时间的条目:0 / 样例:SFC 游戏：洛克人七代（Rockman 7）
- https://leimao.github.io/ — cron:07:00:00 x32天 / 靠近抓取时间的条目:0 / 样例:艾泽拉斯幸存者
- https://yinji.org/ — cron:00:00:00 x20天 / 靠近抓取时间的条目:0 / 样例:周报 #14 – 重新连接
- https://www.ezindie.com — cron:00:00:00 x11天 / 靠近抓取时间的条目:0 / 样例:独立开发变现周刊（第163期） : 单人公司被Anthropic收购 Pipeline-in-a-Person
- https://blog.bensontech.dev/ — cron:16:00:00 x100天 / 靠近抓取时间的条目:0 / 样例:Atomic habits
- https://www.xiaozonglin.cn/ — cron:00:00:00 x14天 / 靠近抓取时间的条目:0 / 样例:XDSEC运维组2026第一次组会讲义
- https://ursb.me/ — cron:00:00:00 x7天,02:10:00 x2天,14:17:00 x2天,02:15:00 x2天 / 靠近抓取时间的条目:0 / 样例:擦边经济火爆不是因为性压抑：关系长不出来，市场把亲密拆开卖（智能路障·围炉夜话）
- https://tw93.fun/ — cron:00:00:00 x10天 / 靠近抓取时间的条目:0 / 样例:2026 年，我的 21 条 AI Coding 最佳实践
- https://finisky.github.io/ — cron:16:13:33 x2天,11:18:16 x2天,11:32:15 x2天 / 靠近抓取时间的条目:0 / 样例:Reasoning-Intensive Retrieval：从表示学习到迭代搜索
- https://kenvix.com/ — cron:11:25:50 x2天,05:36:50 x2天,04:51:39 x2天 / 靠近抓取时间的条目:0 / 样例:自用 ChatGPT/Codex 防御性编程/说话修正/PowerShell调用问题修正提示词分享
- https://mephisto.cc/ — cron:00:00:00 x139天 / 靠近抓取时间的条目:0 / 样例:使用Trapfall收集个人项目错误
- https://blog.javazero.top/ — cron:00:00:00 x2天,13:20:00 x2天,12:40:00 x2天,12:00:00 x2天 / 靠近抓取时间的条目:0 / 样例:DeepSeek Super-agent 拆解：架构设计与开源插件的实现边界
- https://tonybai.com/ — cron:22:00:00 x7天,23:00:00 x2天 / 靠近抓取时间的条目:0 / 样例:递归自我改进（RSI）的 Harness 长什么样？英伟达 SoL-Pi 给出了第一份工程答卷
- https://blog.wohin.me — cron:00:00:00 x5天 / 靠近抓取时间的条目:0 / 样例:文章分类与统计
- http://elmagnifico.tech — cron:16:00:00 x10天 / 靠近抓取时间的条目:0 / 样例:AI对抗与逆向
- https://blog.tifa-233.com/ — cron:20:43:13 x2天,12:46:33 x2天,19:07:55 x4天,20:11:31 x2天 / 靠近抓取时间的条目:0 / 样例:随笔 - 关于 C++ 模板的部分特化
- https://blog.jasonleehere.com/ — cron:00:00:00 x67天 / 靠近抓取时间的条目:0 / 样例:反思错过这轮科技牛的原因
- https://pythoncat.top — cron:00:00:00 x22天 / 靠近抓取时间的条目:0 / 样例:Python 潮流周刊#173：Guido 保荐的 PEP 823 拟给 3.16 加 ?. 与 ?[]
- https://forrestgump618.github.io — cron:00:00:00 x39天 / 靠近抓取时间的条目:0 / 样例:Eve：科研工作台与使用方法
- https://fatbobman.com/ — cron:14:00:00 x13天,14:20:00 x2天,14:21:01 x2天 / 靠近抓取时间的条目:0 / 样例:当应用不再属于特定操作系统 - 肘子的 Swift 周报 #159
- https://blog.yasking.org/ — cron:02:35:00 x2天,09:21:00 x2天,11:20:00 x2天 / 靠近抓取时间的条目:0 / 样例:Memos: 当下软件开发的效率瓶颈
- https://quant67.com/ — cron:00:00:00 x26天 / 靠近抓取时间的条目:0 / 样例:【大模型基础设施工程·特别篇】28：DeepInfer 深度解析——DeepSeek 生产推理引擎开源了什么
- https://jame.work/ — cron:00:00:00 x24天 / 靠近抓取时间的条目:0 / 样例:积水潭
- https://razeen.me — cron:00:00:00 x2天,03:43:48 x2天,11:30:10 x2天,01:04:50 x2天 / 靠近抓取时间的条目:0 / 样例:合规是悬在可信CA头上的一把刀：下一个倒下的CA将会是谁？
- https://innomad.io — cron:00:00:00 x10天 / 靠近抓取时间的条目:0 / 样例:A 类、C 类股票有什么区别？看 Snap、Google 和 Meta
- https://ystyle.top — cron:03:00:00 x3天,02:00:00 x9天 / 靠近抓取时间的条目:0 / 样例:给 DeepSeek Harness 接上 QQ：一只会记住你的鲸鱼娘
- https://xeonzilla.top — cron:16:00:00 x20天 / 靠近抓取时间的条目:0 / 样例:millsage：将双手满载的幸福，献给你。
- https://sugarat.top/ — cron:00:00:00 x3天 / 靠近抓取时间的条目:0 / 样例:个人作品
- https://www.yysuni.com/ — cron:00:00:00 x39天 / 靠近抓取时间的条目:0 / 样例:Cordis 学习笔记 #1
- https://blog.sunmkt.uk/ — cron:00:00:00 x4天 / 靠近抓取时间的条目:0 / 样例:如果我能脸红，我早就脸红了：通过教育弥合数字技能的性别鸿沟
- https://blog.watermelonabc.top — cron:00:00:00 x4天 / 靠近抓取时间的条目:0 / 样例:关于PCLPoC
- https://xingwangzhe.fun/ — cron:02:00:00 x4天,07:00:00 x6天,03:30:00 x3天,14:00:00 x2天 / 靠近抓取时间的条目:0 / 样例:2026东北大学邮箱第三方客户端配置指南(Thunderbird)
- https://zelikk.blogspot.com/ — cron:00:15:00 x2天,00:10:00 x2天 / 靠近抓取时间的条目:0 / 样例:群抽奖 1x Racknerd 2 GB KVM VPS (2025&#39;s 11.11 Promo) 1年 群投票参与抽奖 drand.love提供随机数
- https://uwillno.com — cron:07:44:44 x3天,00:00:44 x8天,04:00:44 x2天,09:24:44 x2天 / 靠近抓取时间的条目:0 / 样例:Qt for WebAssembly 应用全屏适配
- https://daolanx.me/zh/ — cron:00:00:00 x25天 / 靠近抓取时间的条目:0 / 样例:从以工作为核心，变为以自己为核心
- https://blog.sayori.org/ — cron:00:00:00 x30天 / 靠近抓取时间的条目:0 / 样例:又来做一次自我介绍了（2026 年 11 月）
- https://kangaroogao.com/ — cron:16:00:00 x14天 / 靠近抓取时间的条目:0 / 样例:快走踏清秋：东北漫游
- https://wmhwiki.cn/ — cron:00:00:00 x9天 / 靠近抓取时间的条目:0 / 样例:读书笔记：我向达尔文学投资
- https://www.xbstack.com/ — cron:00:00:00 x39天 / 靠近抓取时间的条目:0 / 样例:为什么要研究近百年货币数据？读《美国货币史》的第一课
- https://blog.cloverta.top/ — cron:00:00:00 x16天 / 靠近抓取时间的条目:0 / 样例:操作系统如何组织电脑中的文件？——OS的文件管理
- https://pengline.cn/ — cron:16:00:00 x6天 / 靠近抓取时间的条目:0 / 样例:1697 ops/s 与 2,433 tasks/s 为什么不能直接比：任务队列性能口径拆解
- https://www.sagasu.art — cron:00:30:15 x3天,00:30:16 x6天,00:30:19 x8天,00:30:17 x3天 / 靠近抓取时间的条目:0 / 样例:10 个人月烧 310 万美元 tokens，别盯着数字激动，先看它拆掉了哪三堵墙
- https://www.auvetu.com/ — cron:00:00:00 x17天 / 靠近抓取时间的条目:0 / 样例:十月碎碎念
- https://tanqingbo.cn/ — cron:15:30:00 x2天,03:00:00 x2天,02:30:00 x2天 / 靠近抓取时间的条目:0 / 样例:怎么翻墙去国外的网站：2026 电脑/手机科学上网全流程教程
- https://notes.yachiyo.im/ — cron:00:00:00 x38天 / 靠近抓取时间的条目:0 / 样例:DeepMind 因军方合同出走：原则写在纸上，否决权不在合同里
- https://www.thefox.work/ — cron:00:00:00 x16天 / 靠近抓取时间的条目:0 / 样例:短剧会让人智商变低吗？
- https://blog.solazy.me/ — cron:15:00:00 x8天 / 靠近抓取时间的条目:0 / 样例:高德地图的赛博造林
- https://cavill.site/ — cron:00:00:00 x9天 / 靠近抓取时间的条目:0 / 样例:当时明月在，曾照彩云归
- https://www.echovic.com — cron:00:00:00 x6天 / 靠近抓取时间的条目:0 / 样例:Cleanzo 0.3.0 &#x5f00;&#x53d1;&#x590d;&#x76d8;&#xff1a;&#x4ece;&#x300c;&#x6709;&#x70b9;&#x6162;&#x3001;&#x4f1a;&#x95ea;&#x300d;&#x5230;&#x539f;&#x751f;&#x83dc;&#x5355;&#x680f;&#x9762;&#x677f;
- https://ftz.is-a.dev/ — cron:16:00:00 x15天,00:00:00 x21天 / 靠近抓取时间的条目:0 / 样例:Toashot：或许是一个更加方便好用的截图工具
- https://cbc688.com/ — cron:16:00:00 x13天 / 靠近抓取时间的条目:0 / 样例:我何以闺怨
- https://u1-lab.xiaoxia.io/ — cron:00:00:00 x73天 / 靠近抓取时间的条目:0 / 样例:记忆税：一次对 Agent 记忆的审计
- https://blog.wordtk.com/ — cron:09:02:00 x2天,04:00:00 x11天,06:00:00 x2天,08:00:00 x3天 / 靠近抓取时间的条目:0 / 样例:一人公司：我做了个替你操作网页的浏览器智能体
- https://shilongzai.com — cron:00:00:00 x21天 / 靠近抓取时间的条目:0 / 样例:红酥手，黄縢酒：陆游这辈子，没走出那座沈园
- https://dusays.com/ — cron:16:00:00 x9天 / 靠近抓取时间的条目:0 / 样例:PHP 性能优化，以及用 FastCGI 缓存加速 PHP 页面
