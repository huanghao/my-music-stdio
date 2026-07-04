# 练习模式功能规划与开源生态调研

本文档回答两个问题：（1）项目现有功能对应的领域里，还有哪些开源软件/库做过同样的事、能直接借鉴或复用；（2）参考这些软件后，`TODO.md` 里列的练习模式想法该怎么落地、先做哪个。不重复 [alphaTab 渲染调研](alphatab-rendering-research.md)、[伴奏生成调研](accompaniment-generation-research.md)、[吉他和弦指法学习资料推荐](guitar-chord-shapes-resources.md) 已经覆盖的内容，只补充这几篇里没提到的库和结论。

## 现状：svguitar 已经在用

写这篇文档时发现 `web/fretboard.js` 的和弦指位图渲染（`fbShapeToSvguitarChord` 函数）已经从手写 SVG 几何计算换成了 [svguitar](https://github.com/omnibrain/svguitar)（MIT，通过 `web/index.html` 里的 CDN `<script>` 引入，版本锁定在 `svguitar@2.5.1`，不是 npm 依赖）。代码注释里记录了原因：手写版本有一个真实的 off-by-one bug（品位不是从横按品起算时，按位画高了一行），和弦图的行列几何是一个已经被解决过的问题，不值得再手写一遍踩坑。这一步不需要再做，下面单独一节说明为什么这是对的决定（对应 `TODO.md` 里"是否真的需要一个库"的疑问）。

## 和弦指位图到底有多少种：需要库，还是需要一套图片？

先算清楚这个问题里的"和弦指型"到底有多少个。`web/fretboard.js` 里实际用到的可移动横按指型是：

- `FB_MOVABLE_SHAPES`（`web/fretboard.js:1001-1032`）：E/A/D 三个可横按形状 × 9 种和弦性质（大三、小三、大七、属七、小七、减七、半减七、sus2、sus4）= **27 个指型**
- `FB_CAGED_SHAPES`（CAGED Shapes 页用，只有大三和弦）：C/A/G/E/D 五个开放位置形状 = **5 个指型**

合计 **32 个固定指型**——这是"当前代码已经实现的范围"，不是"一个吉他手最终要掌握的全部指型"，两者不是一回事，下一节会分开说。核心结论不变：换根音（换调）只是把同一个指型横按到不同品位，指型本身（哪根弦按第几品的相对位置）完全不变，`fbBarreFretForShape`（`web/fretboard.js:30-34`）已经把"换品位"和"指型"拆开算了，根音数量（12 个）不会让指型数量翻倍。

这个"32 个家族只做 E/A/D、不做 C/G"的设计选择，独立验证过一次：[guitarcommand.com 讲半减七和弦的页面](https://www.guitarcommand.com/half-diminished-chord-how-to-play-m7b5-chords-on-guitar/) 只给了 3 个"把位家族"（根音在6弦/5弦/4弦），文章原话是"three ways of playing half-diminished chords"，完全没提 C-shape/G-shape 的可横按版本——因为那两个指法（小指大跨度或拇指扣弦）实际中只在开放位置弹，不会被当成横按全指板的家族用，和 `FB_MOVABLE_SHAPES` 只收 E/A/D 三家族的判断一致。

### 修正一版结论：动态的到底是哪一部分

再重新看一遍 `fbShapeToSvguitarChord`（`web/fretboard.js:373` 附近）实际做的三件事，逐条确认它是不是真的"因题而变"：

| 视觉元素 | 之前的说法 | 实际情况 |
|---|---|---|
| 根音那根弦标特殊颜色 | "跟这道题问的是哪个和弦绑定" | ❌ 不对：`shape.rootString`/`shape.rootFret` 是 **(家族, 性质)** 这个组合本身固定的属性（比如 E-shape major 的根音永远在 string0/fret0），跟具体考到哪个根音无关——**可以预先烧进静态图** |
| 音程度数标签（"1 5 1 3 5 1"） | "同一个指型在不同和弦性质下标签不同" | ⚠️ 部分对：标签确实随"性质"变，但**不随根音变**——同一个 (家族, 性质) 组合的度数标签永远一样，本质上也是这 32 个指型各自固定的属性，**同样可以预先烧进静态图** |
| 横按品位数字（"3fr"/"8fr"） | "运行时算出来的" | ✅ 对，这是唯一真正依赖"当前出题的具体根音"的内容 |

也就是说，**32 个固定指型对应的图（含根音高亮、含度数标签）其实可以整张预生成、一次性做好**，运行时只需要换一行文字（品位数字），不需要重新摆放任何一个点或重新计算任何一条线的位置。这比"不够，因为这些图不是静态的"这个结论更准确——真正不能预生成的东西只有一个数字，不是整张图的布局。

### 方案对比（更新版）

| 方案 | 说明 | 优点 | 缺点 |
|---|---|---|---|
| **方案1：继续用 svguitar（现状）** | 运行时从 CDN 加载库，每次出题实时调用库生成完整 SVG | 代码量小；加新和弦性质只要加数据，不用管图；不用维护素材目录 | 依赖外部 CDN（离线/内网环境加载不出来） |
| **方案2：预生成 32 张静态图（含高亮+标签）+ 只叠加品位数字这一行文字** | 用 svguitar 离线批量跑一遍，导出 32 个 `(家族,性质)` 的 SVG，图里就含根音颜色和度数标签；运行时只在图外或图上固定位置追加一个 `<text>3fr</text>` | 彻底不依赖外部网络；因为只叠加一个文本节点，不涉及重新计算点/线坐标，不会重蹈手写 SVG 那个 off-by-one bug 的风险；32 个文件规模完全可控 | 需要一次性生成脚本；换和弦性质要重新生成对应的那一张图（不是全部重来） |
| **方案3：找现成图集直接用** | 网上找一套别人做好的和弦图图片 | 理论上不用自己画 | 现成图集几乎都按"具体和弦"（如 Cmaj7.png）组织，不是按"指型"组织，规模会变成 12 根音 × 32 指型量级；风格不统一，可能有版权/署名要求 |

**结论调整为：方案2 现在看是可行的，而且代价比之前分析的更低**（只需要一次性生成 + 单个文字节点叠加，不需要重新实现摆点逻辑）。是否要从方案1切到方案2，取决于"CDN 依赖"这件事对你来说是不是真问题——如果本地/内网离线部署是明确需求，方案2 值得做；如果只是本地用、网络一直有，方案1 维护成本更低，可以先不动。

## 一个吉他手实际要记多少个指型：分级

上一节的"32 个"是当前代码已经实现的范围，不是"要不要练到这么多就够了"的答案。下面按"实际编曲/弹唱/即兴够不够用"分级，数量不重复累加：

| 等级 | 内容 | 新增数量 | 累计 |
|---|---|---|---|
| **L1 生存线** | 8-10 个经典开放和弦（C A G E D Am Em Dm）+ E/A-shape 大三/小三横按 | 开放10 + 横按4 | **14** |
| **L2 弹唱够用** | + E/A-shape 的属七/大七/小七（6个）+ 移动 power chord（2个）+ D-shape 大三/小三（2个）+ 常用开放七和弦（G7 C7 D7 A7 E7 Am7 Em7 Dm7 约8个） | +18 | **32** |
| **L3 编曲/伴奏进阶** | + E/A/D-shape 的 sus2/sus4（6个）+ D-shape 的属七/大七/小七（3个） | +9 | **41** |
| **L4 爵士/半音化和声入门** | + E/A/D-shape 的减七、半减七（6个，即本文档开头那篇 guitarcommand 文章讲的东西）+ add9/6/m6 常用的 E/A-shape 变体（约6个） | +12 | **53** |
| **L5 完整声部进行（drop2/drop3）** | 常用小七/属七/大七的 drop2、drop3 转位（换弦组的换指法），一般只有明确要往爵士 comping 方向走的人才专门练 | +15~20 | **68~73** |

**"50-100 个"这个直觉量级是对的**，只是要分场合看：L1-L3（41个）已经能应付绝大多数流行/民谣/摇滚伴奏和即兴；L4（53个）覆盖到常见爵士化声，`FB_MOVABLE_SHAPES` 现在的 27 个 + `FB_CAGED_SHAPES` 的 5 个大三，合起来正好覆盖 L1-L4 里所有"可横按"的部分（L1-L4 里的开放和弦、power chord 目前还没有对应的练习模式，是 Fretboard 工具还没做但可以加的一块）；L5 是锦上添花，不建议现阶段规划。

## 还没采纳的开源库地图

以下是上次分析里筛出来、当前代码还没用到、值得记录以备将来参考的库，按功能域列：

| 功能域 | 库 | 许可证/形态 | 能借鉴什么 | 对应现有代码 |
|---|---|---|---|---|
| 音高检测 | [pitchfinder.js](https://github.com/peterkhayes/pitchfinder)（npm `pitchfinder`） | MIT，纯 JS，浏览器可直接用 | **实测结论（见下）：不建议替换** | `fbAutoCorrelate`（`web/fretboard.js:1446-1483`，手写 ACF2+ 自相关） |
| 和弦/音阶数学 | [Tonal.js](https://github.com/tonaljs/tonal) | MIT，纯函数式 JS | **读代码复核后：不建议替换（见下）** | `FB_CHORD_QUALITIES`/`FB_CHORD_DEGREE_LABELS`（`web/fretboard.js:903-913`，手写和弦音程表） |
| 伴奏风格引擎 | [Impro-Visor](https://www.cs.hmc.edu/~keller/jazz/improvisor/)（Harvey Mudd，GPL，Java 桌面软件） | 不是库，是同类产品的参考实现 | 用文本 pattern 规范描述伴奏风格（跟 [伴奏风格模式设计](style-pattern-design.md) 方向一致），且有 Style Extractor——从真实 MIDI 演奏反推风格 pattern，可能是解决"默认风格太机械"最直接的路子 | `src/style_patterns.py`（目前只有 pop 迁移到表驱动，其余 8 风格还在硬编码 if-elif） |
| 音频和弦识别 | [Chordino / NNLS Chroma](https://github.com/c4dm/nnls-chroma)（Queen Mary，GPL2）、[madmom](https://github.com/CPJKU/madmom)（Python） | 原生 C++ Vamp 插件 / Python 库，塞进纯浏览器页面成本高 | 色度特征 + HMM/Viterbi 平滑，比现在"连续 N 帧超阈值+冷却时间"稳健，了解原理即可，暂不迁移 | Chord Match 的 `fbRenderChordChroma`/帧数阈值逻辑 |
| 乐理分析 | [music21](https://github.com/cuthbertLab/music21)（BSD-3，Python） | 重型工具，罗马数字分析、voice leading 检查 | 如果做"分析我自己写的和弦进行"或解决 TODO 里"更好的声部进行"，这个现成 | 无对应现有代码，纯新功能候选 |
| 耳训练习设计 | [Perfect Ear](https://www.perfectear.app/) | 免费非开源 App，仅供参考分类法 | 音程听辨/比较/视唱、和弦听辨/转位/进行、节奏视奏——可以把现有"认音名/认CAGED/认和弦"横向扩展的方向 | 无对应现有代码，产品范围参考 |

### 音高检测替换：实测过，结论是不换

上面表格最初写的是"YIN 算法比自相关更抗八度错误，可直接替换现有实现"——这是没做过对比实验、纯凭算法名声下的判断，后来实际测了一遍，结论是错的，记录如下以免以后又凭印象重新提议。

**方法**：`npm install --no-save pitchfinder`（临时安装，未写入 `package.json`，用完删除，没有引入真实依赖），用现有 `fbAutoCorrelate` 函数（通过 `web/fretboard.js` 底部的 CommonJS 导出，见 `web/fretboard.js:1454` 附近）对比 pitchfinder.js 自带的 `ACF2PLUS`（验证手写实现有没有 port 错）和 `YIN`。测试信号：纯正弦波、谐波丰富的"典型拨弦音色"（基频+衰减泛音）、谐波丰富且第二泛音接近基频强度的"亮音色"（理论上最容易让自相关类算法错认八度的情况）、以及加噪声版本，覆盖 6 根空弦 + 1 个按品音，buffer 大小用 app 实际配置 `fftSize=2048` @ 44.1kHz（`web/fretboard.js:446`）。

**结果**：`fbAutoCorrelate` 和 `ACF2PLUS` 在全部 28 组测试里都正确识别（误差 <1%，没有出现任何八度错误）；`YIN` 在低音 E 空弦（82.41Hz）上全部 4 组信号都识别错（锁定到 86.3Hz，偏差 4.7%），其余 6 个音都对。追查原因：pitchfinder.js 的 YIN 实现内部把搜索窗口砍到"小于等于输入长度的最大 2 的幂再减半"，2048 长度的输入实际只有 1024 samples 可搜索，对应的最低可测频率恰好卡在低音 E 弦之上一点；把 buffer 加到 4096 重测，YIN 才能测对低音 E。

**结论**：不建议换。第一，现有手写实现在真实 buffer 大小下没有出现过理论上担心的八度错误，谐波丰富和加噪声都测过。第二，YIN 要测对最低那根弦（低音 E）需要更大的 buffer（4096 起），这会让每次读数的延迟从约 46ms 翻倍到约 93ms——这恰恰是以后做推弦/揉弦这类需要连续追踪的功能最不想要的代价（追踪延迟越大，画出来的音高曲线越滞后、越不能反映真实按弦动作）。之前"性价比最高的音高检测替换"这个判断，实测后反而是反过来的：现状比换了更适合以后的连续追踪场景。

### 和弦数学库替换：读代码复核，结论也是不换

上面表格最初写的是"Tonal.js 还能反向'从音符集合猜和弦名'"，暗示这是现有代码没有、值得引入的能力——同样是没对着代码核实就下的判断，复核后发现这个能力已经做了，只是实现方式不同，记录如下。

Chord Match 的 `fbChordOnFrame`/`fbChordOnWrong`（`web/fretboard.js:1349-1390` 附近）在没匹配上目标和弦时，会把麦克风 FFT 算出的连续色度向量（`fbComputeChroma`），跟一个由全部 12 个根音 × `FB_CHORD_QUALITIES` 9 种性质枚举出的候选池（`pool`，108 个模板）做余弦相似度比对，找最接近的一个——这就是"从弹出来的声音反推是什么和弦"，已经存在，不是空白。

Tonal.js 的 `Chord.detect()` 输入假设是一组已经离散化、干净的音符名（例如 `["C","E","G"]`），适合从 MIDI/乐谱这种确定性数据源反推；麦克风实时音频给不出这种干净的离散音符集合，真正的难点始终是"怎么从一段带噪声的连续频谱可靠提取出弹了哪几个音"——这一步 Tonal 不解决，得自己写，而现在的实现直接跳过了这个易碎的离散化步骤，用连续相似度比对，对真实麦克风输入更稳。

去掉这个能力之后，Tonal.js 剩下能替换的就只有 `FB_CHORD_QUALITIES`/`FB_CHORD_DEGREE_LABELS` 这 20 行左右的音程表——这张表很小、很稳定（9 种性质，不会经常加新的），而且已经在 [吉他和弦指法学习资料推荐](guitar-chord-shapes-resources.md) 里跟真实指法交叉验证过。为了替换 20 行不会变的数据引入一个新依赖，不划算。**结论：不换。**

## 下一步该做什么

`TODO.md` 练习模式里列的五项，按"复用现有代码的程度"排序：

1. **和弦视奏**（滚动和弦谱同步播放）——成本最低。`src/player.py` 的 `status()` 方法（`src/player.py:186-207` 附近）已经在算 `elapsed_sec`/`current_loop`，前端只需要新增一个模式，把现有 `song.bars` 渲染成一排和弦框，跟着 `current_loop` 高亮当前小节。不需要新库、不需要后端改动。
2. **常见和弦走向**（流行/blues/爵士经典进行）——同样低成本。`src/styles.py` 已经有 `default_progression`/`BLUES_12_BAR` 的写法，只需要再加几组命名进行（ii-V-I、50 年代 I-vi-IV-V 等）作为数据，接到 #1 同一套视奏 UI 上复用。
3. **推弦音高训练**——中等成本。继续用现有 `fbAutoCorrelate`（实测过没有必要换，见上一节），逐帧调用画成连续曲线（现在是单次读数），再加一个"目标音高上方 N 音分"的容差判定。
4. **揉弦训练**——中等成本，建立在 #3 同一套连续追踪基础上，额外做一个音高曲线的周期性震荡检测（找 4-7Hz 范围的峰值），这部分没有现成小库，需要自己写。
5. **动态谱**（滚动五线谱/Tab + 播放光标同步）——成本最高，直接对应已有的 [alphaTab 渲染调研](alphatab-rendering-research.md)，需要引入 alphaTab 并设计"内部和弦/小节数据 → alphaTab 数据模型"的转换层（该文档"需要验证的能力 → 数据接入"一节已经指出这是关键风险点）。

建议顺序：先做 1、2（零新增依赖，纯复用现有播放位置追踪和数据结构），验证"视奏"这个交互模式好不好用之后，再做 3、4（复用现有 `fbAutoCorrelate`，不需要新依赖），或为 5 引入 alphaTab。

## 参考资料

- [pitchfinder (GitHub)](https://github.com/peterkhayes/pitchfinder)
- [Tonal (GitHub)](https://github.com/tonaljs/tonal)
- [Impro-Visor (Harvey Mudd)](https://www.cs.hmc.edu/~keller/jazz/improvisor/)
- [nnls-chroma / Chordino (GitHub)](https://github.com/c4dm/nnls-chroma)
- [music21 (GitHub)](https://github.com/cuthbertLab/music21)
- [svguitar (GitHub)](https://github.com/omnibrain/svguitar)
- [Perfect Ear](https://www.perfectear.app/)
- [Half Diminished Chord: How To Play m7b5 Chords On Guitar (guitarcommand.com)](https://www.guitarcommand.com/half-diminished-chord-how-to-play-m7b5-chords-on-guitar/)
