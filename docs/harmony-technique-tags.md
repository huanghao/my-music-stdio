# 和声手法标签词表（跨歌曲分析用）

给每首歌的和声分析标注用的固定标签，来自 [和弦进行入门](chord-progressions-guide.md) /
[和声进阶](chromatic-harmony-and-substitutions.md) / [调性和声地图](tonal-harmony-map.md)
已有的术语。新歌分析时优先复用这里的 slug，不要自己另起说法——不然不同歌曲的同一种手法会被
打上不同标签，以后没法搜索、没法跨歌曲对比。

这张表是跟着新歌分析持续更新的活文档，不是写一次就定死。

## 分类维度：三大功能组

每个技巧除了自己的 slug，还应该标注**操作的是哪个功能组**——这是 [调性和声地图 §1](tonal-harmony-map.md#1-地基三大功能组)
定义的框架，本身不是一个单独的标签，而是给下面每一行做分类用的维度：

| 功能组 | 大调级数 | 角色 |
|---|---|---|
| T（主，Tonic） | I, vi, iii | 稳定、可以停 |
| S（下属，Subdominant） | IV, ii | 过渡、准备离开 |
| D（属，Dominant） | V, vii° | 紧张、必须解决 |

下表"操作对象"这一列，就是按这个维度写的（组内部换 / 临时伪造 D / 换 D 的替身 / 削弱 D / 跳出 T-S-D / 绕开 D / 换掉整套坐标系……）。

## 已覆盖（直接复用现有文档术语）

**状态**区分两种来源：**已验证**＝在真实歌曲分析里遇到过、确认好用；**预登记**＝三份文档已经写好定义，
但还没在任何歌曲分析里实际标注过，先占个坑，实际用到时不用再临时想说法。

| slug | 名称 | 定义来源 | 操作对象 | 状态 |
|---|---|---|---|---|
| `stepwise-chain` | 级进链 | [和弦进行入门 §4 机制三](chord-progressions-guide.md#机制三级进链stepwise-motion) | 根音移动规律（独立于功能组） | 已验证（特别的人） |
| `circle-of-fifths` | 五度圈链 | [和弦进行入门 §4 机制二](chord-progressions-guide.md#机制二五度圈链circle-of-fifths) | 根音移动规律（独立于功能组） | 已验证（特别的人） |
| `authentic-cadence` | 正格终止 | [和弦进行入门 §3](chord-progressions-guide.md#3-为什么某些和弦想要解决到另一个和弦功能和声) | D 正常解决到 T | 已验证（特别的人） |
| `functional-substitution` | 功能替代 | [调性和声地图 §3](tonal-harmony-map.md#3-每个具体手法都是对某个功能组做的一种操作) | 组内部换和弦 | 已验证（特别的人） |
| `functional-connector` | 功能替代（连接用法） | 同上，特化用法 | 组内部，当经过音用 | 已验证（特别的人，iii 连接 I/vi/V） |
| `secondary-dominant` | 附属和弦 | [和声进阶 §1](chromatic-harmony-and-substitutions.md#1-附属和弦secondary-dominant) | 临时伪造一个 D | 已验证（特别的人，V7/ii） |
| `borrowed-chord-iv` | 借用和弦（借 iv） | [和声进阶 §3](chromatic-harmony-and-substitutions.md#3-借用和弦borrowed-chord--modal-mixture) | 跳出本调 T-S-D | 已验证（特别的人） |
| `deceptive-cadence` | 假终止 | [调性和声地图 §3](tonal-harmony-map.md#3-每个具体手法都是对某个功能组做的一种操作) | D 解决，但 T 被调包 | 预登记（《特别的人》里实际是 `dominant-misdirection` 那种更远的改道，不是标准 V-vi） |
| `secondary-ii-v-chain` | 套娃式属和弦链 | [和声进阶 §1](chromatic-harmony-and-substitutions.md#1-附属和弦secondary-dominant) | 临时伪造 S→D | 预登记 |
| `tritone-substitution` | 三全音代理 | [和声进阶 §2](chromatic-harmony-and-substitutions.md#2-三全音代理tritone-substitution) | 换 D 的替身 | 预登记 |
| `dominant-9sus4` | V9sus4 | [和声进阶 §5](chromatic-harmony-and-substitutions.md#属-9sus4-替代-vv9sus4-for-v) | 削弱 D | 预登记 |
| `borrowed-chord-bvi` | 借用和弦（借 ♭VI） | [和声进阶 §3](chromatic-harmony-and-substitutions.md#3-借用和弦borrowed-chord--modal-mixture) | 跳出本调 T-S-D | 预登记 |
| `borrowed-chord-bvii` | 借用和弦（借 ♭VII） | 同上 | 跳出本调 T-S-D | 预登记 |
| `borrowed-chord-biii` | 借用和弦（借 ♭III） | 同上 | 跳出本调 T-S-D | 预登记 |
| `borrowed-chord-ii-dim` | 借用和弦（借 ii°） | 同上 | 跳出本调 T-S-D，多作经过和弦 | 预登记 |
| `backdoor-progression` | 后门进行（ivm6-I / ivm7-♭VII7-I） | [和声进阶 §5](chromatic-harmony-and-substitutions.md#4-级小六和弦替代-v-ivm6-后门进行-backdoor-progression) | 绕开 D，借 S 改走别的路到 T | 预登记 |
| `brake-chord` | "刹车和弦"（V-♭VI） | [和声进阶 §5](chromatic-harmony-and-substitutions.md#刹车和弦) | 假终止的加强版，落地和弦跳出本调 | 预登记 |
| `relative-key-shift` | 关系大小调转移 | [调性和声地图 §3](tonal-harmony-map.md#3-每个具体手法都是对某个功能组做的一种操作) | 换掉整套 T-S-D 坐标系 | 预登记 |
| `secondary-leading-tone-chord` | 副属导七和弦（vii°7/x） | [和声进阶 §4](chromatic-harmony-and-substitutions.md#4-三者速查表) | 附属和弦的近亲，少根音的临时 D | 预登记 |
| `vii-dim7-for-v` | vii°7 替代 V（属七省根音） | [和声进阶 §5](chromatic-harmony-and-substitutions.md#其它常见的替代-v-手法以及它们相通的原理) | 换 D 的替身，去掉根音 | 预登记 |
| `augmented-sixth` | 增六和弦（意/德/法三种） | [和声进阶 §4](chromatic-harmony-and-substitutions.md#4-三者速查表) | 三全音代理的古典写法 | 预登记 |
| `neapolitan-chord` | 那不勒斯六和弦（♭II） | [和声进阶 §4](chromatic-harmony-and-substitutions.md#4-三者速查表) | 借用和弦的近亲，下属功能的借色 | 预登记 |
| `augmented-dominant` | V+（升 5 音属和弦） | [和声进阶 §5](chromatic-harmony-and-substitutions.md#其它常见的替代-v-手法以及它们相通的原理) | 改装 D，不是替代 D | 预登记 |

## 缺口（用到了，但现有三份文档都没有对应条目）

先记录在这里，不急着改源文档——攒够第二、三首歌的独立例子，确认不是孤例，再考虑要不要正式写回
对应的 harmony 文档。

| slug（暂定） | 现象 | 出现在 | 跟已有概念的关系 |
|---|---|---|---|
| `plagal-ish-ending` | 变格式收尾（IV-ii-I，不含 V 的收尾） | 《特别的人》尾声 70-72 小节 | 三份文档都没有"变格终止"（plagal cadence，经典定义 IV→I）这个条目；本例是它的一个变体，中间垫了 ii |
| `dominant-misdirection` | 属和弦不解决到 I，改道到别的功能组（本例 V→IV，不是假终止的 V→vi 同组置换） | 《特别的人》主歌结尾 13→14 小节 | 比假终止换得更远——假终止只是换同功能组内的替身，这里直接跳到下属功能组，现有"假终止"定义覆盖不了 |
| `tacet` | 留白/不弹，整小节没有和声支撑，人声清唱过渡 | 《特别的人》桥段 58-59 小节 | 三份文档完全没提过，是编配/配器层面的技巧不是纯和声手法，但对听感影响很大，值得单独收录 |

## 使用规则

1. 新歌分析前先查这张表，能对上就直接用现成 slug（"预登记"的也可以直接用，不用等第二首歌才启用）。
2. 真遇到表里没有的现象，先记到"缺口"区，别急着现编一个听起来像术语的词。
3. 某个缺口标签在第二、三首歌里又独立出现一次，才考虑要不要正式写回三份 harmony 文档、转正为"已覆盖"。
4. 某个"预登记"标签第一次在真实歌曲分析里用到，把状态改成"已验证（歌名）"。
