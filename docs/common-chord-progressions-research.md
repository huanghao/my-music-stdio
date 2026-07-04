# 常见和弦进行分类调研

这篇文档要解决一个具体问题：Sight Read 页面需要和弦进行数据来练习，但你现在没有保存过任何 Song。与其让你从零开始编，不如先调研业界公认的"常用和弦进行"，分类整理成一份候选清单，你 review 后我们把选中的几组直接作为 Sight Read 的内置练习库（跟 `src/styles.py` 里每个风格自带的 `default_progression` 是同一种数据形状，但作为独立于风格的一组"进行库"）。

不是泛泛罗列"这个进行很好听、应用很广"，每一组都给：级数公式、具体调上的和弦名、真实歌曲例子、以及它和项目里已有数据的关系（比如 pop 风格默认进行本身就是下面某一组的实例）。

## 分类总览

| 分类 | 级数公式 | 代表进行（C 调） | 适用风格 |
|---|---|---|---|
| 流行"四和弦"— Doo-Wop | I–vi–IV–V | C–Am–F–G | 50s/60s pop、doo-wop |
| 流行"四和弦"— Axis | I–V–vi–IV | C–G–Am–F | 现代流行、Pop-punk |
| 流行"四和弦"— Singer-Songwriter | vi–IV–I–V | Am–F–C–G | 90s 民谣/校园民谣 |
| 流行"四和弦"— Hopscotch | IV–V–vi–I | F–G–Am–C | 2010 年后流行 |
| Blues 12 小节（标准） | I-I-I-I-IV-IV-I-I-V-IV-I-I | A7×4, D7×2, A7×2, E7-D7-A7-A7 | 蓝调、摇滚 |
| Blues 12 小节（quick change） | I-IV-I-I-IV-IV-I-I-V-IV-I-I | 第 2 小节提前进 IV | 蓝调标准曲目 |
| 爵士 ii–V–I | ii–V–I | Dm7–G7–Cmaj7 | 爵士、bossa nova |
| 爵士 turnaround / rhythm changes | I–vi–ii–V | Cmaj7–Am7–Dm7–G7 | 爵士乐句结尾、"I Got Rhythm" 类 |
| 小调 Andalusian 终止式 | i–♭VII–♭VI–V | Am–G–F–E | 弗拉门戈、摇滚、流行 |
| Mixolydian 民谣摇滚 vamp | I–♭VII–IV | G–F–C | 经典摇滚、凯尔特民谣 |

## 1. 流行/摇滚"四和弦"家族

这四组用的是同一套四个和弦（I、IV、V、vi），只是排列顺序不同，合起来大约覆盖了流行音乐里 80% 的和弦进行——顺序不同，情绪和"落地感"不同，这是这个家族真正的重点，不是和弦本身有什么特别。

- **Doo-Wop（I–vi–IV–V）**：C–Am–F–G。50、60 年代 doo-wop 和早期摇滚的标配。**这正是 `src/styles.py` 里 `pop` 风格的 `default_progression`（C-Am-F-G）**——项目里已经在用这一组，只是没有把它当作"进行库"里的一个独立条目。
- **Axis（I–V–vi–IV）**：C–G–Am–F。被称为"最常见的流行和弦进行"，很多千禧年后的流行/pop-punk 歌都是这个，順序上比 Doo-Wop 更早给出属和弦(V)的推力。
- **Singer-Songwriter（vi–IV–I–V）**：Am–F–C–G。90 年代校园民谣常见写法，从小调和弦开始给人"先忧后喜"的感觉，跟 Axis 是同一组和弦的不同起点。
- **Hopscotch（IV–V–vi–I）**：F–G–Am–C。2010 年后流行乐更常见，把小调和弦(vi)放在解决到主和弦之前，制造一个"意外的弯"。

## 2. Blues 12 小节

蓝调的"和弦表"本身几乎是标准化的，变化的地方主要是每小节的和弦是否提前进行（quick change）以及结尾几小节的 turnaround（收尾转回主和弦的过渡句）写法。

- **标准 12 小节**（A 调）：A7-A7-A7-A7 / D7-D7-A7-A7 / E7-D7-A7-A7。**这正是 `src/styles.py` 里 `blues` 风格的 `BLUES_12_BAR`**——项目已经用了这个确切的版本。
- **Quick change 变体**：把第 2 小节提前换成 IV（A7-D7-A7-A7 / D7-D7-A7-A7 / E7-D7-A7-A7），是最常见的变化写法之一，"Sweet Home Chicago"、"Hoochie Coochie Man" 都用这个。
- **Turnaround（收尾转折句）**：最后两小节常见写法是 V-IV-I（这里是 E7-D7-A7）或更复杂的 I-vi-ii-V，作用是在段落循环回开头之前制造一次"完满终止感"。

## 3. 爵士 ii–V–I 家族

如果说 12 小节蓝调是蓝调的基本单位，那 ii–V–I 就是爵士和声的基本单位——绝大多数爵士标准曲的和声骨架都能拆解成一串 ii–V–I。

- **ii–V–I**（C 调）：Dm7–G7–Cmaj7。根音按五度下行（ii→V→I），是这个家族的核心结构。
- **I–vi–ii–V turnaround**（C 调）：Cmaj7–Am7–Dm7–G7。常用来在乐句/段落结尾处，把原本"停在主和弦"的静止感换成持续推进的和声运动，是"I Got Rhythm"这类 rhythm changes 曲式的核心骨架。
- 更进阶的变化（tritone substitution，把 V 换成低半音的属七和弦制造半音下行低音线）属于 bebop/cool jazz 常见手法，这里先不纳入候选库——难度明显跳一级，等前面几组练熟再考虑。

## 4. 小调 / 民谣调式进行

- **Andalusian 终止式（i–♭VII–♭VI–V）**：Am–G–F–E。源自弗拉门戈，但被广泛借用到摇滚、流行、电子乐——特点是四个和弦根音级进下行（A-G-F-E），带来一种"螺旋下沉"的戏剧性听感，"Hit the Road Jack" 几乎全曲都在重复这一句。跟前面几组不同的是它不是"终止到主和弦"就完，而是常被当作可以无限循环的 ostinato（固定反复型）用。
- **Mixolydian vamp（I–♭VII–IV）**：G-F-C（G 调）。特征音是"不属于大调音阶的 ♭VII 和弦"（G 大调里正常是 F#dim 或干脆没有这个和弦，但 Mixolydian 用了自然的 F 大三和弦），是经典摇滚/凯尔特民谣的标志性声音，"Sweet Home Alabama"（D-C-G）是最常被引用的例子。

## 建议纳入 Sight Read 练习库的候选清单

下面是打算直接转成 `bars`/`chords` 数据（跟现有 song.json 同一形状）的具体实例，选了几个吉他友好的调（C/G/A/Am/E），你 review 一下要不要调整调性或增删：

1. Doo-Wop — C: `C - Am - F - G`（已存在于 pop 风格默认值，可以直接复用不用重复建）
2. Axis — C: `C - G - Am - F`
3. Singer-Songwriter — Am: `Am - F - C - G`
4. Hopscotch — C: `F - G - Am - C`
5. Blues 12 小节标准 — A: 复用 `BLUES_12_BAR`（已存在于 blues 风格）
6. Blues quick change — A: `A7 - D7 - A7 - A7 / D7 - D7 - A7 - A7 / E7 - D7 - A7 - A7`
7. ii–V–I — C: `Dm7 - G7 - Cmaj7`（3 小节一组，可以考虑循环 4 组填满一个 vamp 长度）
8. Turnaround/Rhythm changes 骨架 — C: `Cmaj7 - Am7 - Dm7 - G7`
9. Andalusian 终止式 — Am: `Am - G - F - E`
10. Mixolydian vamp — G: `G - F - C`

## 参考资料

- [I–V–vi–IV progression (Wikipedia)](https://en.wikipedia.org/wiki/I%E2%80%93V%E2%80%93vi%E2%80%93IV_progression)
- [Four-Chord Schemas – Open Music Theory](https://viva.pressbooks.pub/openmusictheory/chapter/4-chord-schemas/)
- [Twelve-bar blues (Wikipedia)](https://en.wikipedia.org/wiki/Twelve-bar_blues)
- [Common variations on the 12 bar blues (Happy Bluesman)](https://happybluesman.com/common-variations-12-bar-blues/)
- [12 Bar Blues Progression - Turnaround in Music](https://www.howmusicreallyworks.com/chapter-six-chords-progressions/12-bar-blues-progression-turnaround-music.html)
- [ii–V–I progression (Wikipedia)](https://en.wikipedia.org/wiki/Ii%E2%80%93V%E2%80%93I_progression)
- [The 10 Most Popular Jazz Chord Progressions (jazzguitar.be)](https://www.jazzguitar.be/blog/jazz-chord-progressions/)
- [Andalusian cadence (Wikipedia)](https://en.wikipedia.org/wiki/Andalusian_cadence)
- [Andalusian Cadence — StudyBass](https://www.studybass.com/lessons/harmony/minor-progression-the-andalusian-cadence/)
- [The 1-flat7-4-1 Chord Progression (The Mixolydian Vamp)](https://www.bennysutton.com/chords/the-1-flat7-4-1-chord-progression)
- [Modal Chord Progressions on Guitar (guitarwiz.app)](https://guitarwiz.app/articles/modal-chord-progressions/)
