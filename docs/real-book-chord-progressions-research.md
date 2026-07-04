# Real Book 与经典爵士和弦进行调研

这篇文档回答两个问题：Real Book 是什么、能不能下载；以及里面反复出现的经典和弦进行是什么、能不能用到 Chord Match 的 Progression 模式里。

## Real Book 是什么，能不能下载

**不能，也不应该下载** —— 这不是技术限制，是版权问题，说明一下原因：

- "The Real Book" 最初（1970 年代）是伯克利音乐学院几个学生手抄整理的爵士标准曲手写乐谱合集（旋律 + 和弦，俗称 "fake book"），从没有获得任何一首曲子的版权授权，几十年来在乐手之间以盗版形式流传（复印、扫描、PDF），这也是它在爵士圈"人手一本"却又"见不得光"的由来。
- 2004 年起，Hal Leonard 出版社发行了**合法授权版**《The Real Book, Volumes 1-6》，重新取得曲目版权、修正了大量盗版版本里的错音错和弦，是现在唯一合法的实体/电子版本。
- 网上能搜到的"Real Book PDF 下载"几乎全部是原始盗版的扫描件再传播，属于版权侵权文件——所以我不会帮你搜索、下载或整理这类文件的链接。

**合法获取方式**（如果你想要完整曲目+乐谱）：
- 购买 Hal Leonard 官方《The Real Book》纸质/PDF 版（Hal Leonard 官网、亚马逊、乐谱店都有）。
- iReal Pro App（付费）：只包含和弦级进（没有旋律抄写），版权风险远低于扫描乐谱，且能直接播放伴奏、移调、改速度——如果你想要"能听、能练"的爵士标准曲和弦库，这个比找 PDF 更实用。
- 一些爵士标准曲本身已进入公有领域（作曲年代早、版权到期），可以合法找到免费乐谱，但覆盖的曲目有限。

## Real Book 里反复出现的和弦进行套路

Real Book 收录的两三百首爵士标准曲，和声上高度重复使用几种"骨架"套路——这也是为什么职业乐手能"看和弦就上"，因为套路是共享的、旋律和曲子是变化的。下面这些和 `docs/common-chord-progressions-research.md` 里已经调研过的爵士部分是同一批结论，这里补充展开，并标注哪些已经用进了这次 Chord Match 的 Progression 模式（`web/fretboard.js` 的 `FB_CHORD_PROGRESSIONS`）。

| 套路 | 级数公式 | C 调实例 | 已加入 Progression 模式 |
|---|---|---|---|
| ii–V–I | ii7–V7–Imaj7 | Dm7–G7–Cmaj7 | ✅ |
| I–vi–ii–V turnaround | Imaj7–vi7–ii7–V7 | Cmaj7–Am7–Dm7–G7 | ✅ |
| iii–vi–ii–V turnaround | iii7–vi7–ii7–V7 | Em7–Am7–Dm7–G7 | ✅ |
| Rhythm changes（"I Got Rhythm"骨架） | A 段 I-vi-ii-V，桥段 III7-VI7-II7-V7（纯属七和弦下行五度圈） | 是上面 turnaround 的曲式化用法，桥段是"次属和弦串" | 未加（桥段全属七和弦，超出目前"三和弦/常见七和弦"练习范围，见下） |
| 12 小节爵士蓝调 | I7-IV7-I7-I7 / IV7-IV7-I7-VI7 / ii7-V7-I7-VI7（比摇滚蓝调多了 turnaround 里的 ii-V） | C7-F7-C7-C7 / F7-F7-C7-A7 / Dm7-G7-C7-A7 | 简化版已加（`12-bar blues (changes)`，去掉了逐小节重复，只留骨架） |
| Coltrane changes（"Giant Steps"） | 按大三度分割八度（三个相隔大三度的调中心） | C-Ab-E 三个调中心循环 | 未加——公认的进阶/高难度和声，属于"练熟前面几组以后"的下一步 |
| 次属和弦（Secondary dominant） | V7/x，临时借来的属七和弦，解决到下一个和弦 | 比如去 ii 之前先来一个 V7/ii | ✅ 以"约 30% 概率插入"的形式加入，而不是固定套路——这是你之前问的"中间加点变化"的具体实现 |

**为什么 Coltrane changes 和 rhythm-changes 桥段先不加**：这两个都要求同时练习"半音阶级远关系的属七和弦"或"纯属七和弦下行五度圈"，对着麦克风弹这些和弦本身没问题，但作为**练习顺序**来说，跳过 ii-V-I 直接上 Coltrane changes 容易变成"死记硬背指法"而不是"理解和声逻辑"——先把已加入的这几组练顺，再考虑加这两个更合理。如果你想现在就加，告诉我一声就行。

## 参考资料

- [The Real Book (Wikipedia)](https://en.wikipedia.org/wiki/Fake_book#The_Real_Book) — Real Book 的历史与盗版/合法版本沿革
- [Hal Leonard: The Real Book official editions](https://www.halleonard.com) — 合法授权版本
- [Rhythm changes (Wikipedia)](https://en.wikipedia.org/wiki/Rhythm_changes)
- [ii–V–I progression (Wikipedia)](https://en.wikipedia.org/wiki/Ii%E2%80%93V%E2%80%93I_progression)
- [Coltrane changes (Wikipedia)](https://en.wikipedia.org/wiki/Coltrane_changes)
- 已有调研：[常见和弦进行分类调研](common-chord-progressions-research.md)（本文档的爵士部分与之互补，不重复展开 doo-wop/axis/blues 等非爵士套路）
