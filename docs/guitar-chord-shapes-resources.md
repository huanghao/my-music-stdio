# 吉他和弦指法学习资料推荐

本文档收录的是配合 Fretboard 页面（Note Names / CAGED Shapes / Chord Match）当前练习内容——**可移动横按和弦指型（E/A/D-shape）、七和弦与减和弦变体、和弦图读法惯例、爵士记谱法**——实际验证过的外部资料，每条都标了来源链接，不是泛泛的入门清单。

## 现在在练什么，对应看哪块

| 你在练习工具里做的事 | 对应资料 |
|---|---|
| CAGED Shapes 页猜和弦横按品位 | [CAGED 系统入门](#caged-系统入门) |
| Chord Match Learn Mode 看 E/A/D 指位图 | [如何读和弦图](#如何读和弦图标准惯例)、[减七与半减七和弦指法](#减七dim7与半减七m7b5和弦指法) |
| Chord Match 里切换 Standard / Jazz 记谱 | [和弦记谱法](#和弦记谱法standard-vs-jazzireal-pro) |

## 如何读和弦图（标准惯例）

标准和弦图（chord diagram）是竖版的：**竖线代表 6 根弦，从左到右是低音 E 到高音 e**；**横线代表品格，最上面一条粗线是琴枕（nut），往下品位递增**。字符含义：

- **X**（弦上方）：该弦不弹 / 闷音
- **O**（弦上方）：该弦空弦弹响
- 圆点里的数字（如果标了）：建议用第几根手指按

这正是 Fretboard 页面 CAGED Shapes 和 Chord Match Learn Mode 里指位图现在采用的画法（横线品位从上到下递增，低音弦在左）。注意这和 Note Names 页面那张完整 12 品指板图不是一回事——那张图是"整根指板俯视图"横向画法（低音弦在上、往右品位递增），是不同用途的另一种惯例，两者不冲突。

Sources:
- [How to Read Guitar Chord Charts (Fender)](https://www.fender.com/articles/chords/read-guitar-chord-charts)

## CAGED 系统入门

CAGED 的核心思路：吉他上只有 5 个"根音在低把位"的开放和弦形状（C、A、G、E、D 五个字母对应的和弦），把这 5 个形状依次横按移动到指板各处，就能在任意品位弹出同一个和弦——这也是 Fretboard 页面 CAGED Shapes 用来出题的理论基础（问你"用某个形状弹某个和弦该按第几品"）。

Fretboard 工具里目前只用 E/A/D 三个形状做"可移动横按和弦"练习，是因为 C-shape 和 G-shape 在实际演奏里很少真的横按到高把位用（指法别扭，通常只弹开放位置），E/A/D 才是吉他手真正会横按走遍全指板的三个形状。

Sources:
- [The Guitarist's Guide to the CAGED System (D'Addario)](https://www.daddario.com/blogs/guitar/guitarists-guide-to-the-caged-system)
- [The Guitarist's Guide to CAGED (Premier Guitar)](https://www.premierguitar.com/lessons/guitarists-guide-to-caged)

## 减七（dim7）与半减七（m7♭5）和弦指法

这两种和弦不像大三/小三/属七那样能直接从开放和弦横按推出来（减七和弦是对称结构，每隔 3 品重复同一个指型；半减七也没有对应的开放和弦原型）。下面是 Chord Match Learn Mode 里 E/A/D 三个指位实际用的指法，来源 + 我用音程数学交叉验证过每个指法弹出来的确实是正确的和弦音（根音 / 小三度 / 减五度 / 减七度或小七度）：

| 和弦 | 指法（低音E→高音e，x=闷音） | 根音所在弦 | 来源 |
|---|---|---|---|
| Gdim7（E-shape 参考） | `3 x 2 3 2 x` | 6弦 | [guitarcommand.com](https://www.guitarcommand.com/diminished-7th-guitar-chord-shape/) |
| Cdim7（A-shape 参考） | `x 3 4 2 4 x` | 5弦 | [fachords.com](https://www.fachords.com/diminished-guitar-chords/) |
| Am7♭5（E-shape 参考） | `5 x 5 5 4 x` | 6弦 | [guitarcommand.com](https://www.guitarcommand.com/half-diminished-chord-how-to-play-m7b5-chords-on-guitar/) |
| Bm7♭5（A-shape 参考） | `x 2 3 2 3 x` | 5弦 | [fachords.com](https://www.fachords.com/diminished-guitar-chords/) |
| Em7♭5（D-shape 参考） | `x x 2 3 3 3` | 4弦 | [fachords.com](https://www.fachords.com/diminished-guitar-chords/) |

D-shape 的 dim7 指法没有找到直接可引用的资料，是我用同样的方法（在 D/G/B/e 四根弦上找最低品位的和弦音组合）系统推导并用音程数学验证过的，不是瞎编。

Sources:
- [Diminished 7th Guitar Chord Shape (guitarcommand.com)](https://www.guitarcommand.com/diminished-7th-guitar-chord-shape/)
- [Diminished Guitar Chords: Triads, Half-Diminished and Dim 7th (fachords.com)](https://www.fachords.com/diminished-guitar-chords/)
- [Half Diminished Chord: How To Play m7b5 Chords On Guitar (guitarcommand.com)](https://www.guitarcommand.com/half-diminished-chord-how-to-play-m7b5-chords-on-guitar/)

## 和弦记谱法：Standard vs Jazz/iReal Pro

Chord Match 里 "Notation" 下拉框切换的两种写法：

- **Standard**：Cm、Cmaj7、C7、Cm7、Cdim7、Cm7b5 —— 大多数教材、Ultimate Guitar 等网站默认用的写法
- **Jazz / iReal Pro**：C-、CΔ7、C7、C-7、C°7、Cø7 —— 用减号表示小和弦、三角符号表示大七、度数符号表示减七、斜杠圆圈表示半减七，是爵士谱面和 iReal Pro app 的标准记法

项目里已经有一篇更完整的调研文档 [和弦表示法调研](chord-symbol-notation-research.md)，覆盖了流行/爵士记号、罗马数字分析、Nashville Number System 等更大范围的内容，如果想深入了解可以直接看那篇。

## 建议阅读顺序

1. 先看[如何读和弦图](#如何读和弦图标准惯例)，确保能看懂 Fretboard 页面里的指位图
2. 再看 [CAGED 系统入门](#caged-系统入门)，理解 E/A/D 三个形状为什么能覆盖全指板
3. 三和弦、属七、大七、小七练熟以后，再看[减七与半减七和弦指法](#减七dim7与半减七m7b5和弦指法)——这两种和弦音程关系复杂一些，指法也更别扭，不用急
4. 如果对记谱习惯（比如乐队谱、iReal Pro）感兴趣，看[和弦记谱法](#和弦记谱法standard-vs-jazzireal-pro)一节和内部的[和弦表示法调研](chord-symbol-notation-research.md)
