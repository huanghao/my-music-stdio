# Shell Chord（壳和弦）完全指南：从基础到精通

这篇是 [独奏爵士吉他全景介绍](joe-pass-ted-greene-intro.md) 提到的"地基"单独展开——目标是让你**完全掌握**
shell voicing 这一件事：不是背几个指型应付一下，而是理解到"给我任意一个和弦、任意一根弦当根音，我两秒内能
摆出正确指型"的程度。文档按"基础 → 精通"的顺序组织，每一节都是下一节的前提。

## 1. 是什么，为什么只弹三个音

**Shell voicing（壳和弦，也叫 guide-tone voicing，因为 Count Basie 乐队吉他手 Freddie Green 常年用这套
东西伴奏，也常被称为 Freddie Green chords）**：只用**根音（root）+ 三音（3rd）+ 七音（7th）**三个音的和弦，
故意不弹五音（5th）。

**为什么能省略五音**：大多数和弦的五音是**纯五度**，不管大和弦、小和弦、属七和弦，纯五度都一样，它不参与
"区分这是什么和弦"这件事——三音才决定这是大和弦还是小和弦，七音才决定这是大七、属七还是小七。换句话说，
五音是和弦里"信息量最低"的音，省略掉完全不影响别人听出这是什么和弦，反而因为音更少，声音更干净、换和弦
更快。

**推论**：三音和七音才是一个和弦真正的"身份证"，这两个音也叫 **guide tones（导音）**——这也是为什么 shell
voicing 又叫 guide-tone voicing。

### 一个重要但常被忽略的细节：m7 和 m7b5 的壳和弦是同一个

m7（小七）和 m7♭5（半减七）的区别**只在五音**（m7 是纯五度，m7♭5 是减五度），而 shell voicing 恰好把五音
省略了——也就是说，纯 shell voicing **弹不出 m7 和 m7♭5 的区别**，两者的根+3+7 三个音完全一样。实战里要
么靠上下文（前后和弦、旋律音）让听众自己脑补，要么在这三个音之外把五音加回去（这就是第 5 节"进阶"要做的事）。

## 2. 两组基础指型家族

指板上有两组最常用的 shell voicing 指法家族，分别以**根音在第 6 弦**和**根音在第 5 弦**为基准。**这两组
必须都学**，原因在第 3 节——真实的和弦进行里，根音会在 6 弦和 5 弦之间来回跳，只会一组会导致换和弦时手在
指板上大幅度平移。

下面的指法用"品位差"（相对根音品格的偏移量）描述，而不是绑死某个具体调——这样记住的是**可移动的规律**，
套到任意品位、任意调直接能用，不用背 12 个调 × 2 个家族 × 4 种和弦性质 = 96 个指法。

### 根音在第 6 弦（用 6/4/3 弦，不弹 5/2/1 弦）

设根音按在第 6 弦第 R 品：

| 和弦性质 | 第 4 弦（品位） | 第 3 弦（品位） |
|---|---|---|
| 大七（maj7） | R+1 | R+1 |
| 属七（7） | R | R+1 |
| 小七（m7 / m7♭5） | R | R |

**验证方法**：这组指法不是凭空编的——可以拿吉他上最熟悉的**开放 E7 和弦**（6-5-4-3-2-1 弦按 `0-2-0-1-0-0`）
反推验证：根音 E 在第 6 弦空弦（R=0），第 4 弦空弦（D，R+0=属七的 b7 音）、第 3 弦第 1 品（G#，R+1=属七的
3 音）——跟上表"属七：第4弦=R，第3弦=R+1"完全对上。把这个开放 E7 当参照物，就能推出任何根音品位的属七
shell 指法。

### 根音在第 5 弦（用 5/3/2 弦，不弹 6/4/1 弦）

设根音按在第 5 弦第 R 品：

| 和弦性质 | 第 3 弦（品位） | 第 2 弦（品位） |
|---|---|---|
| 大七（maj7） | R+1 | R+2 |
| 属七（7） | R | R+2 |
| 小七（m7 / m7♭5） | R | R+1 |

**验证方法**：同样能拿**开放 A7 和弦**（6-5-4-3-2-1 弦按 `x-0-2-0-2-0`）反推：根音 A 在第 5 弦空弦
（R=0），第 3 弦空弦（G，R+0=属七的 b7 音）、第 2 弦第 2 品（C#，R+2=属七的 3 音）——跟上表"属七：第3弦=R，
第2弦=R+2"完全对上。

### 两组家族放在一起怎么记

- 6 弦家族的两个 guide tone**几乎贴在一起**（相差 0-1 品），指型很"方"，像一个小横按。
- 5 弦家族的两个 guide tone**隔得稍开**（3 音比 7 音高 1-2 品），指型是斜着往上爬的"楼梯"形状。
- 大七 vs 属七：只差**第 4/3 弦（6弦家族）或第 3 弦（5弦家族）那个音降半品**——这也是为什么 maj7 → 7 只是
  "松一根手指往下挪一品"的动作，练熟了换和弦性质会变得很直觉。
- 属七 vs 小七：只差**3 音那根弦降半品**（6弦家族的第3弦，或5弦家族的第2弦）。

## 3. 练习法：ii-V-I 与全 12 调

### 为什么从 ii-V-I 开始

**ii-V-I** 是爵士曲目里出现密度最高的三和弦循环（参考 [常用调分布调研](song-key-frequency-research.md) 里提到
的"I 后面接 V/IV/vi 最常见"——ii-V-I 是这条规律在小节级别的具体应用）。用 ii-V-I 当练习素材，等于同时练了
"最常用的和弦顺序"和"最常用的指型换法"。

### 具体练法

1. 挑一个调，比如 C 大调：**Dm7（ii）→ G7（V）→ Cmaj7（I）**。
2. 三个和弦**交替用两组家族**，不要都用同一组——这样根音移动时手在指板上的位置基本不变，只是微调品位：
   Dm7 用 5 弦家族（根音在 5 弦第 5 品）→ G7 用 6 弦家族（根音在 6 弦第 3 品）→ Cmaj7 用 5 弦家族（根音在
   5 弦第 3 品）。这正是前面提到的"两组家族都要学"的原因——真实和弦进行就是这样两组交替用的。
3. 弹熟一个调之后，按**五度圈顺序**（C→F→Bb→Eb→...→G→C）走完全部 12 个大调的 ii-V-I，再走一遍**小调的
   ii°-V-i**（小调 ii 是半减七 ii°，V 通常是属七不是自然小调的 v，这是"和声小调"里唯一动的音，为的是让
   V→i 有真正的解决感）。
4. 全部 12 调一圈弹下来不看谱、不卡顿，是这一步的合格线——公开资料里给的经验值是**逐个和弦类型吃透大概
   需要 2-3 周**，别指望一两天速成。

### 节奏应用：Freddie Green 式伴奏

Shell voicing 最经典的实战场景是**"四拍一下"的摇摆伴奏**（4/4 拍每拍一下，全部下拨、短促断音、不装饰），
这是 Freddie Green 在 Count Basie 乐队几十年伴奏的标志性打法。练的时候：

- 配合节拍器，先从很慢的速度开始，每拍弹一次和弦，短促松手制造断音感，不要让和弦拖长音。
- 熟悉之后可以用本项目的 **Jam 页面**编一条 ii-V-I 或者一整首曲子的和弦进行，生成伴奏，跟着伴奏用 shell
  voicing 实时伴奏——比对着节拍器空弹更接近真实合奏场景。

## 4. 精通检验标准

达到下面几条，才算真的把这门技艺内化了，而不是"看谱能弹"：

- **任意报一个和弦（比如"Ab7"），两秒内能在两组家族任选一组摆出正确指型**，不用现算音名。
- **全 12 调的 ii-V-I（大调 + 小调）**闭眼弹一遍不卡顿。
- **跟一整首标准曲从头弹到尾**只用 shell voicing 伴奏，不断线——推荐用 *Autumn Leaves*（本项目已有
  [和弦进行分析文档](autumn-leaves-analysis.md) 可以直接对照着标注 shell voicing）练手，这首曲子的和弦
  进行基本就是一串 ii-V-I 首尾相连，练完这一首基本就把第 3 节的循环练习用到了真实曲目上。

## 5. 精通之后：往上加东西

Shell voicing 是骨架，"精通"之后的下一步都是**在骨架上加东西**，而不是丢掉骨架重新学一套：

- **加旋律音**：在最高音弦上加一个旋律音，同时保持 guide tone 不变——这一步已经是简化版的 chord melody
  了，直接衔接回 [独奏爵士吉他全景介绍](joe-pass-ted-greene-intro.md) 里 Joe Pass / Ted Greene 的技艺。
- **加走动低音**：在根音位置换成一条移动的低音线，guide tone 留在原地不动——Joe Pass 那种"一把吉他当三件
  乐器"的核心机制就是这个。
- **加张力音（9/13/#11 等）**：在不破坏 3 音、7 音这两个"身份证"音的前提下，往和弦里加音——这部分是 Ted
  Greene《Chord Chemistry》整本书的内容，shell voicing 打好基础后直接对照那本书学最系统。
- **升级到 drop 2 / drop 3 voicing**：这是把五音或张力音加回来的四音和弦体系，音色更丰满，但学习成本明显
  更高——**必须先有 shell voicing 的地基**，否则四音和弦的声部连接逻辑会很难消化，这也是本文档只讲三音
  shell、不展开 drop voicing 具体指法的原因（放到下一篇专门讲）。
- **补上 m7 / m7♭5 的区分**：第 1 节提到 shell voicing 弹不出这两者的区别，加回五音（m7=纯五度，
  m7♭5=减五度）就能解决，通常放在四音和弦阶段一起补齐。

## 6. 推荐练习材料

### 免费网站/视频（有实际指板图，本文档只讲品位公式，具体图示建议直接看这些）

- [How to Play Shell Voicings for Jazz Guitar (3-Note Chords) - JazzGuitarLessons.net](https://www.jazzguitarlessons.net/blog/shell-voicings-jazz-guitar)
- [Shell Voicings for Guitar - Part 1 - Jazz Night School](https://jazznightschool.org/pages/shell-voicings-for-guitar-part-1)（有 Part 2，两组家族分别对应本文档第 2 节的两组）
- [Jazz Chord Essentials – Shell voicings - Jens Larsen](https://jenslarsen.nl/jazz-chord-essentials-shell-voicings/)（Jens Larsen 的 YouTube 频道也有大量免费声部连接内容，是这条路线上更新最勤的免费资源之一）
- [Shell Jazz Guitar Chords (For Beginners) - JazzGuitar.be](https://www.jazzguitar.be/blog/shell-jazz-guitar-chords-beginners/)
- [Shell Chord Voicings for Guitar - JustMusicTheory.com](https://justmusictheory.com/shell-chords/)

### 教材

- **Mickey Baker《Complete Course in Jazz Guitar》**：老牌经典方法书，shell voicing/guide-tone 概念是全书
  的标配基础内容，从这本书起步的爵士吉他手非常多。
- **Ted Greene《Chord Chemistry》**（1971）：shell voicing 吃透之后，直接对应这本书"和弦构造与转位"部分，
  是从三音壳和弦走向完整声部处理最系统的进阶教材——详见 [独奏爵士吉他全景介绍](joe-pass-ted-greene-intro.md)。

### 练习工具

- **节拍器**：从很慢的速度开始练 Freddie Green 式"四拍一下"节奏型，稳了再提速——跟本项目 Speed Trainer
  页面"只有稳了才提速"的练习哲学是一回事。
- **本项目的 Jam / Vamp 页面**：编一条 ii-V-I 或整首曲子的和弦进行，生成伴奏，跟着实时用 shell voicing
  伴奏，比对着节拍器空弹更接近真实合奏场景（见第 3 节）。
- **iReal Pro 或同类 backing track App**（外部工具，非本项目自带）：内置大量标准曲的和弦谱 + 自动生成的
  节奏组伴奏，适合练熟基础指法之后，直接找一整首真实曲目练习实战运用。

## Sources

- [How to Play Shell Voicings for Jazz Guitar (3-Note Chords) - JazzGuitarLessons.net](https://www.jazzguitarlessons.net/blog/shell-voicings-jazz-guitar)
- [Shell Chords for Jazz Guitar (Easy 3-Note Voicings) - Jazz-Guitar-Licks.com](https://www.jazz-guitar-licks.com/blog/lessons/shell-chords.html)
- [Shell Jazz Guitar Chords (For Beginners) - JazzGuitar.be](https://www.jazzguitar.be/blog/shell-jazz-guitar-chords-beginners/)
- [Shell Voicings for Guitar - Part 1 - Jazz Night School](https://jazznightschool.org/pages/shell-voicings-for-guitar-part-1)
- [Shell Voicings Guitar: The Only Shapes You Actually Need - Weiss Guitar](https://weissguitar.com/master-jazz-guitar-shell-voicings-5-pro-comping-techniques/)
- [Jazz Chord Essentials – Shell voicings - Jens Larsen](https://jenslarsen.nl/jazz-chord-essentials-shell-voicings/)
- [Shell Chord Voicings for Guitar - JustMusicTheory.com](https://justmusictheory.com/shell-chords/)
- [Shell Voicings for Guitar: The Secret to Clean Jazz Chords - Guitar Wiz Blog](https://guitarwiz.app/articles/shell-voicings-guitar/)

*文中第 2 节的品位公式表是我用吉他调弦音程（各弦间隔完全四度，3-2 弦间隔大三度）逐音推导、并拿开放 E7/A7
和弦这两个所有吉他手都熟悉的参照物交叉验证过的，不是照抄某个网站的图；具体指法图示请点上面链接直接看
对应网站的可视化和弦图。*
