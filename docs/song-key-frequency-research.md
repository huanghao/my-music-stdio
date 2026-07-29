# 流行音乐常用调分布：数据、方法论局限、和对练习的启示

这篇是给 [Key Drill 练习工具](../web/key-drill.js) 提供理论依据的调研笔记，也是写给自己看的——不只是抄一个排名表，
而是搞清楚这些排名"是怎么算出来的"，因为不同方法论算出来的东西其实**不是一回事**，混着引用会得出错误结论（下面第 3 节
就是一个真实的案例）。

## 1. 结论先行

| 排名 | 调 | 备注 |
|---|---|---|
| 1 | **G 大调** | 单一最常用的调，约 10.7% |
| 2 | **C 大调** | 约 10.2%，钢琴上最省事的调（无黑键） |
| 3 | **D 大调** | |
| 4 | **A 大调** | 前四个调合计**超过 1/3 的歌曲** |
| 5 | **E 大调** | |
| — | **Em / Am / Bm** | 三个最常见小调，恰好是 G / C / D 的关系小调；除这三个外，其它小调都不到 4% |
| 较少 | F、Bb、Eb 大调 | R&B / Soul 偏多（管乐编曲习惯用降号调） |
| 罕见 | F#/Gb、Db、B 等 | F# 小调是个例外——虽是 A 大调的关系小调，但因指板上横按太多，反而被回避 |

这套分布严重偏向"吉他/钢琴人体工学友好"的调，而不是均匀分布在 12 个调上。

## 2. 数据来自哪里，怎么算出来的

引用最广的数据源是 Spotify 数据科学家 **Kenny Ning** 在内部博客发的一篇分析，样本是 Spotify 平台上**超过 3000 万首歌**
的音频特征（[Digital Trends 报道](https://www.digitaltrends.com/music/whats-the-most-popular-music-key-spotify/)、
[Gizmodo 的图表报道](https://gizmodo.com/a-chart-of-the-most-commonly-used-keys-shows-our-actual-1703086174) 都转载了这份结果，原始博客本身已经找不到了，只能通过转载文章回溯）。

这些"调"不是人工标注的，是 Spotify（前身 The Echo Nest）的**自动调性检测算法**跑出来的：对音频做色度特征
（chroma/pitch-class profile）分析，统计一段时间内各音级的能量分布，再跟大调/小调的音阶模板做匹配，选最像的那个。

### 这套算法有多准？

这是我觉得**必须提一句**的局限，因为它直接影响"G 大调排第一"这类结论的可信度：

- 同类自动调性检测工具（Tunebat 等，用的是同一套色度匹配技术路线）在第三方实测中报告过低至 **~38%** 的准确率。
- 最常见的错误类型是**关系大小调混淆**——比如一首真正的 A 小调歌曲被识别成 C 大调（[Orphiq 的调性检测工具评测](https://orphiq.com/resources/song-key-finder-guide)）。这类错误不会影响"C/Am 这一组有多常见"的结论，但会让"到底该算大调还是关系小调"这个细节不可信。
- 算法对调性中心明确的类型（流行、R&B、乡村、摇滚、大多数电子乐）效果较好，对高度半音化、频繁转调、或打击乐主导（音高信息稀薄）的曲目效果差（[arXiv 论文](https://arxiv.org/pdf/2604.10021) 讨论了这类现代神经网络方案想解决的正是这个问题）。

**结论**：把这份数据当作"哪几个调是主流、大致占比多少"的**方向性参考**是没问题的（G/C/D/A/E 这个大集群足够稳固，
样本量 3000 万也足够大，不会被 38% 级别的噪声完全淹没），但不要把"10.7% vs 10.2%"这种小数点后一位的精确排序太当真——
G 和 C 谁第一，在算法噪声范围内其实没有那么大意义。这也是为什么 [Key Drill](../web/key-drill.js) 的权重表用的是粗粒度分档
（10/9/8/7/5/4/3/2/1），而不是照抄小数点后一位的百分比。

## 3. 一个网上很常见的误传，顺手澄清一下

搜"most common song keys"会看到大量文章引用这样一份"排名"：

> C, G, Eb, F, D, A, E, Db, Bb, Ab, B, F#

这份名单经常被转述成"歌曲最常用调的排名"，出处指向 Hooktheory 那篇《I analyzed the chords of 1300 popular songs》。
但查到 [Bobby Owsinski 的转述原文](http://bobbyowsinski.blogspot.com/2014/12/the-most-popular-song-keys.html) 会发现，
Hooktheory 的原始方法论其实是：

> 把 1300 首歌**统一移调到 C 调**，再统计哪个和弦出现得最多。

也就是说，这份"排名"本质上是"和弦级数出现频率"（移到 C 调之后看到的 G、F、Am、Dm、Em... 分别对应 V、IV、vi、ii、iii
这些级数出现的次数），跟"这首歌原本写在哪个调"是两回事——被大量网站以讹传讹，套上了"最常用调排名"的标题转载。

这个案例本身对练习设计很有启发：**"C 大调最常见"和"V/IV/vi 这几个级数最常见"是两条独立的规律，都成立，但不能混为一谈**。
Key Drill 的设计也刻意把这两条规律分开处理——调的权重表对应第 1 节的调排名，选项池对应"同一个调内的级数"而不是跨调比较级数热度。

## 4. 级数本身的热度：哪几级和弦最常见

这条规律来自 Hooktheory 对同一批 1300 首歌**更细粒度**的和弦转移统计（[Hear and Play 的转述](https://hearandplay.com/main/they-analyzed-1300-songs-heres-what-they-found/)，
原始 Hooktheory 博客本身有反爬限制，抓不到全文）：

从 I 级（主和弦）出发，下一个和弦最可能是：

| 下一个和弦 | 占比 |
|---|---|
| V（属和弦） | 29%，算上以七和弦形式出现的 V7 则约 38% |
| IV（下属和弦） | 20% |
| vi（关系小调） | 9% |

对应到具体进行，**I-V-vi-IV**（"流行金曲进行"/Axis progression，"C-G-Am-F"是最常被举例的版本）被反复提到是流行音乐里
出现密度最高的一条四和弦循环。这也是 [上一版本回复](../web/progression-lab.js) 里 Progressions 页面把 I/V/vi/IV
当作练习优先级最高的四个级数的理论依据。

## 5. 为什么偏偏是这几个调：乐器人体工学

这条不需要复杂数据支撑，是乐理常识 + 乐器构造的直接推论：

- **C 大调**：钢琴上没有黑键，作曲/弹奏门槛最低，"新手友好"到近乎默认选项。
- **G/D/A/E 大调**：吉他上这几个调的 I/IV/V 级和弦大概率能弹成**空弦和弦**（open chord：G、C、D、A、E、Em、Am、Dm 这几个
  形状），不用横按，换和弦速度快、音色也更"响"（空弦有额外共振）。这解释了为什么民谣吉他弹唱、乡村、摇滚这几个体裁
  格外偏向这个集群。
- **反例 F# 大调**：虽然是 A 大调的关系小调该有的地位，但 F# 小调本身在吉他上几乎每个和弦都要横按，实际使用率被按下去
  了——这是"关系大小调理论上同样常见，但实际频率被乐器难度打了折扣"的一个具体例子。
- **Db/Eb/Bb 这类降号调**在 R&B / Soul / 爵士更常见，一个解释是这类编曲经常带铜管/木管组，而降号调是铜管乐器
  （萨克斯、小号）更顺手的调性——体裁的常用乐器编制会反过来影响作曲者选调的习惯。

## 6. 对 Key Drill 练习设计的启示

1. **调的练习优先级**用第 1 节的粗粒度分档，不追求精确复刻小数点排名（第 2 节已经说明了为什么不该追求这个精度）。
2. **级数的练习优先级**（如果以后要做"常见进行"专项）应该参考第 4 节独立的级数频率数据，不能直接从"哪个调常见"推出
   "哪个级数常见"——这是第 3 节澄清误传时发现的教训。
3. F#/Gb、Db、B 这几个"理论上因为是常见调的关系调、但实际因为乐器难度被按下去"的调，练习优先级可以放最低——现实里
   真正需要弹到它们的场景本来就少。

## 参考链接

- [Play it in G! Spotify analyses our streams to find the most popular musical key - Digital Trends](https://www.digitaltrends.com/music/whats-the-most-popular-music-key-spotify/)
- [A Chart Of The Most Commonly Used Keys Shows Our Actual Musical Tastes - Gizmodo](https://gizmodo.com/a-chart-of-the-most-commonly-used-keys-shows-our-actual-1703086174)
- [I analyzed the chords of 1300 popular songs for patterns - Hooktheory Blog](https://www.hooktheory.com/blog/i-analyzed-the-chords-of-1300-popular-songs-for-patterns-this-is-what-i-found/)
- [They Analyzed 1300 Songs & Here's What They Found - Hear and Play](https://hearandplay.com/main/they-analyzed-1300-songs-heres-what-they-found/)
- [Bobby Owsinski: The Most Popular Song Keys](http://bobbyowsinski.blogspot.com/2014/12/the-most-popular-song-keys.html)
- [Song Key Finder Tools: How to Use Them - Orphiq](https://orphiq.com/resources/song-key-finder-guide)
- [Masked Contrastive Pre-Training Improves Music Audio Key Detection (arXiv)](https://arxiv.org/pdf/2604.10021)
