# 和弦进行入门：是什么、为什么好听、怎么用

这篇是写给你自己学习用的，不是给某个功能做调研——目标是让你看懂"和弦进行"这件事到底在说什么，
以及为什么 Chord Match 的 Progression 模式选了这些和弦。跟之前两篇调研文档的关系：

- [常见和弦进行分类调研](common-chord-progressions-research.md) —— 更偏"这些进行分别叫什么、哪些歌用过"
- [Real Book 与经典爵士和弦进行调研](real-book-chord-progressions-research.md) —— 偏爵士标准曲的和声套路
- 这篇 —— 偏"和弦进行为什么这样排列，背后的规律是什么"，是前两篇的理论基础

## 1. 什么是"和弦进行"

和弦进行（chord progression）就是**一串按顺序弹奏的和弦**。但它不是随便排列——同一个调里的和弦，
换不同顺序排列，听感差别很大：有的让人觉得"完了、稳了"，有的让人觉得"还没完、要继续"。
这篇要讲的就是这套"为什么某些顺序听起来更顺"的规律。

## 2. 级数记谱法（Roman numeral analysis）

和弦进行几乎从不写具体调（"C-Am-F-G"），而是写**级数**（"I-vi-IV-V"）——因为级数记法是"调无关"的，
换个调直接套用同一套级数就行，这也是为什么 Chord Match 的 Progression 模式每次给你换一个随机调，
但级数结构不变。

大调音阶的七个级数，配上它们**自然形成**的和弦性质（把音阶里 1-3-5-7 度叠起来）：

| 级数 | C 大调举例 | 和弦性质 |
|---|---|---|
| I | C | 大三和弦 / maj7 |
| ii | Dm | 小三和弦 / m7 |
| iii | Em | 小三和弦 / m7 |
| IV | F | 大三和弦 / maj7 |
| V | G | 大三和弦 / 属七(7) |
| vi | Am | 小三和弦 / m7 |
| vii° | Bdim | 减三和弦 / m7b5（半减七） |

**大写罗马数字 = 大和弦，小写 = 小和弦，°是减和弦**——这套大小写规则本身就在告诉你和弦性质，
不用死记"C 大调里 Dm 是小和弦"这种具体例子，级数记法把这条规律直接封装进符号里了。

自然小调是把这套级数挪到第 6 级音开始（i-ii°-III-iv-v-VI-VII），性质刚好互换：i/iv/v 变小，III/VI/VII 变大。

## 3. 为什么某些和弦"想要"解决到另一个和弦：功能和声

七个级数不是地位平等的，它们分成三个**功能组**（function group）——这是标准的音乐理论术语，
来自"功能和声"（functional harmony）体系，中文教材（如斯波索宾《和声学教程》）译作"功能"，
口语里"属功能组""属和弦功能组""属功能和弦组"说的是同一件事，只是语序不同：

| 功能组 | 大调级数 | 听感 |
|---|---|---|
| **主功能组（Tonic, T）** | I, vi, iii | "稳定、到家了"——乐句可以停在这里 |
| **下属功能组（Subdominant / Predominant, S）** | IV, ii | "准备离开、往前走"——一种过渡感 |
| **属功能组（Dominant, D）** | V, vii° | "紧张、必须解决"——几乎必然要走回主和弦 |

**同一组内的和弦可以互相替代，是因为它们和该组"代表和弦"共享两个音**——比如 T 组里 vi（Am：A-C-E）
跟 I（C：C-E-G）共享 C、E；S 组里 ii（Dm：D-F-A）跟 IV（F：F-A-C）共享 F、A；D 组里 vii°（Bdim：B-D-F）
跟 V7（G7：G-B-D-F）共享 B、D、F 整整三个音（vii° 本质上就是"V7 去掉根音"）。共享的音越多，替换后
"骨架感"保留得越完整，只是换了个"味道"（vi 比 I 忧郁一点）。iii 是三个组里最模糊的一个——它跟 I
共享 E、G，但也跟 V（G-B-D）共享 G、B，所以有些教材会把 iii 同时算作 T/D 两栖，具体看它在哪个
进行里、前后接的是什么。

规律是：**功能倾向于按 T→S→D→T 的方向走**（当然可以跳过某一组，但很少反着走）。
这就是为什么"I-IV-V-I"这种进行天生顺耳——完全按功能顺序走了一圈；也是为什么"V 后面接 I"
（属到主）几乎是所有西方音乐里最常见的和声动作，专门有个名字叫**正格终止（authentic cadence）**。

**这三大功能组是整套和声理论的地基**——后面遇到的次属和弦、三全音代理、借用和弦、后门进行……
全都是"对着这三个组做的某种具体操作"，不是各自独立的知识点。想看这些手法怎么挂到这个骨架上，
见 [调性和声地图](tonal-harmony-map.md)。

## 4. 生成逻辑：所有进行其实来自 3-4 个基础模型

这是关键的一节——**Chord Match 库里 18 条进行，不是 18 个互相无关的东西要背，而是 3-4 种"生成机制"
套在不同级数组合上产出来的**。搞清楚生成机制，比背具体的级数序列有用得多。

### 机制一：功能替代 + 重排（functional substitution）

从最基础的骨架 **I – IV – V – I**（主→下属→属→主，走完一圈功能）出发，做两件事之一或两件都做：

1. **同功能内替换**：I 换成 vi 或 iii（都是主功能），IV 换成 ii（下属功能内互换）
2. **重新排列顺序**（只要大方向还是"主→下属→属"就行，可以从中间任何一点起，或省略首尾的主和弦）

`I-V-vi-IV`（流行"四和弦"）、`I-vi-IV-V`（50 年代）、`vi-IV-I-V` 全都是 **{I, IV, V, vi} 这四个和弦**
的不同排列——而且有个好玩的事实：`I-V-vi-IV` 和 `vi-IV-I-V` 其实是**同一个循环**，只是从循环的
不同位置开始听（把 I-V-vi-IV 首尾相连滚一圈：I,V,vi,IV,I,V,vi,IV,...，从第 3 个音 vi 开始读，正好就是
vi,IV,I,V）。`I-vi-IV-V` 顺序不一样（V 和 vi 位置对调了），是另一种排列，不是同一个循环的旋转。

### 机制二：五度圈链（circle of fifths）

根音每一步都**下降纯五度**（等价于上升纯四度），比如 `vi-ii-V-I` 根音是 A→D→G→C，每一步都是纯五度。
这条规律跟"功能"是两回事——它纯粹是"根音怎么移动"的规律，只是恰好五度圈走到最后几步
（ii→V→I）也是标准的功能顺序（下属→属→主），两条规律在这里重合了，听起来格外顺。

`ii-V-I`、`vi-ii-V-I`、`iii-vi-ii-V`、`i-iv-VII-III` 都是五度圈链的不同长度/起点。

**延伸：`4536251` 为什么是五度圈链最长的一种、为什么这么流行**

把 `4536251` 翻成级数：**IV - V - iii - vi - ii - V - I**。拆开看根音怎么走（以 C 大调为例）：

```
F  →  G  →  Em →  Am →  Dm →  G  →  C
  +2度    -3度    +4度   +4度   +4度   +4度
（IV→V）        （iii→vi→ii→V→I，连续四步纯四度上行 = 纯五度下行）
```

关键发现：**从第 3 个和弦 iii 开始，后面 iii-vi-ii-V-I 这五个和弦，根音连续四步都是纯五度下行**——
正是本节讲的五度圈链，而且这条链子还恰好是 App 库里已有的那条 **`iii – vi – ii – V`（jazz turnaround）**
的完整延伸（多走一步落回 I）。前两个和弦 `IV-V` 则是常见的"下属到属"的功能性开场（相当于给这条
五度圈链加了一个两小节的引子）。

**"3625" 和 "jazz turnaround" 是什么关系**：`3625` 是圈内对 `iii-vi-ii-V` 这条具体级数的俗称——
数字直接对应级数（3=iii, 6=vi, 2=ii, 5=V），跟更常见的 `1625`（`I-vi-ii-V`，doo-wop 进行，
比如《Stand By Me》）是同一个"家族"，只是起始和弦从 I 换成了 iii。而 **"jazz turnaround" 是个
更宽泛的英文统称**，指"结尾前那几小节、专门用来把和声带回 I 的一串和弦"，`1625`、`3625`、
`vi-ii-V-I` 等等都能叫 turnaround，不特指某一条固定级数。所以"3625 叫 jazz turnaround"这个说法
不算错，但更准确的说法是：**3625（iii-vi-ii-V）是 turnaround 家族里的一个具体成员**，不是
turnaround 的别名。

**为什么 `4536251` 这么流行**，可以用两条独立的规律叠加来解释：

1. **五度圈本身就是最强的和声推力**——纯五度下行（或纯四度上行）的根音关系，是所有和弦进行里
   "拉力"最强的一种（正格终止 V→I 就是它最短的版本），`4536251` 把这种拉力连续用了四次，
   听感上会有一种"越走越收紧、必然走到 I"的宿命感。
2. **它顺路走遍了几乎所有调内和弦**——七个级数里用了六个（只跳过了不稳定的 vii°），比常见的
   四和弦进行（比如 `I-V-vi-IV`）信息量更大、更有"叙事感"，常被当作副歌或桥段的扩展版进行，
   本质上可以理解成"把经典的 `I-vi-ii-V` 或 `iii-vi-ii-V-I` 转身/加长了一节"。

**App 里现在没有这条完整的 7 和弦进行**——`FB_CHORD_PROGRESSIONS`（`web/fretboard.js`）里最接近的是
`iii – vi – ii – V（jazz turnaround）`（后 4 步）和 `I – IV – V – IV`（前两步的味道），但没有
把两段拼成一条 `IV-V-iii-vi-ii-V-I` 的完整条目。如果想把它加进 Chord Match 的 Progression 库，
告诉我一声，几行配置就能加上（归进 `circle5` 类别）。

### 机制三：级进链（stepwise motion）

根音每一步只移动**一个音阶步**（全音或半音），listens 起来像"平滑滑梯"而不是"目的明确地推进"。
之前分析过的 `Emaj7-Ebm7-C#m7-Bmaj7`（B 大调 **IV-iii-ii-I**，根音 E-D#-C#-B 连续下行）就是这个机制。

`IV-iii-ii-I`、`I-ii-iii-IV`（同样的机制，方向反过来）、`i-VII-VI-v` 都属于这一类。

### 机制四：12 小节蓝调（自成一派）

蓝调的和弦表是历史上固定下来的一套约定俗成的形式（I-I-I-I-IV-IV-I-I-V-IV-I-I），不是从上面三种机制
推导出来的，是独立的第四类，收录进来是因为它太常见、值得单独练。

### 完整对照表

| 进行 | 机制 | 说明 |
|---|---|---|
| I – V – vi – IV | 功能替代 | 跟 vi–IV–I–V 是同一循环的不同起点 |
| I – vi – IV – V | 功能替代 | {I,IV,V,vi} 的另一种排列（非循环旋转） |
| I – IV – V – IV | 功能替代 | 三和弦小家族 |
| vi – IV – I – V | 功能替代 | 见上，跟 I-V-vi-IV 同一循环 |
| I – iii – IV – V | 功能替代 | 用 iii 代替 vi 做主功能替代 |
| I – V – IV – V | 功能替代 | 三和弦小家族 |
| i – VI – III – VII（小调） | 功能替代 | 小调版本 |
| i – iv – v（小调） | 功能替代 | 小调版本的 I-IV-V |
| i – VII – VI – VII（小调） | 功能替代 | 来回摆动型 |
| ii – V – I | 五度圈 | 教科书式正格终止，也是最短的五度圈 |
| I – vi – ii – V | 五度圈 | 后三个和弦 vi-ii-V 是五度圈 |
| vi – ii – V – I | 五度圈 | 完整四步五度圈 |
| iii – vi – ii – V | 五度圈 | 四步五度圈，从 iii 开始 |
| i – iv – VII – III（小调） | 五度圈 | 小调版五度圈 |
| I – ii – iii – IV | 级进（上行） | |
| IV – iii – ii – I | 级进（下行） | 就是 Emaj7-Ebm7-C#m7-Bmaj7 那条 |
| i – VII – VI – v（小调） | 级进（下行） | 小调版，接近 Andalusian 终止式 |
| 12-bar blues | 蓝调（独立） | 历史约定形式 |

现在 Chord Match 的 Progression 选项里加了一个 **Pattern** 筛选框（All / Functional / Circle of fifths /
Stepwise / 12-bar blues），可以只挑一种机制反复练，练熟了再切回 All 混着来。

## 5. 次属和弦（Secondary Dominant）——Chord Match 里"偶尔插入"的那个和弦

Chord Match 的 Progression 模式大概 30% 概率会在某个和弦前插入一个"次属和弦"。次属和弦的原理：
**V 能强烈地把你推向 I，那如果我想更强烈地推向 ii 呢？就借用"ii 的属和弦"，临时插在 ii 前面。**

比如在 C 大调，ii 是 Dm，Dm 的属和弦是 A7（不是 C 大调里的音，是临时借用的）。如果进行是
`C - Dm - G - C`，加上次属和弦就变成 `C - A7 - Dm - G - C`——A7 不属于 C 大调，但它解决到 Dm 的
感觉比直接从 C 跳到 Dm 更有推力。这是"和声里加变化"最基础也最常用的手法，Chord Match 就是在模拟这个。

## 6. 听真实歌曲例子：按第 4 节的机制分类，每类给具体歌名

这一节全部重新做了实时搜索验证（上一版有几条是没搜到结果、凭训练知识给的，这版替换成搜到的具体
歌名/出处）。按第 4 节的四种生成机制分类，方便你在 Chord Match 里选中对应 **Pattern** 之后，
直接去听同类型的真实歌曲练耳朵。

### 功能替代类（Functional）—— "I-V-vi-IV" 一条进行套几十首歌

- **[Axis of Awesome 的《4 Chords》](https://en.wikipedia.org/wiki/The_Axis_of_Awesome)**：一段喜剧
  串烧现场，全程用 I-V-vi-IV 一条进行（他们弹的是 D-A-Bm-G）连续弹了三十几首流行金曲，串烧通常从
  Journey 的《Don't Stop Believin'》开场，后面接 Bob Marley《No Woman, No Cry》、《Take Me Home,
  Country Roads》、《I'm Yours》等——这就是"同一个骨架能撑起这么多歌"最直观的证明。
- **Hooktheory 官方博客**里那篇[分析了 1300 首流行歌找规律](https://www.hooktheory.com/blog/i-analyzed-the-chords-of-1300-popular-songs-for-patterns-this-is-what-i-found/)
  的文章，结论就是 I-V-vi-IV 是数据库里出现频率最高的四和弦进行，F 和 G 甚至比 C（主和弦本身）出现
  的次数还多——可以直接去 [Hooktheory 的 Trends 工具](https://www.hooktheory.com/trends) 按级数进行搜，
  会列出真实用过这条进行的歌单。

### 50 年代 / doo-wop 类（I-vi-IV-V，也是"功能替代"的另一种排列）

这条进行有自己的历史名字和一票经典曲目，搜到的具体例子：**《Stand by Me》**、**《Heart and Soul》**
（这条进行因此也被叫做 "Heart and Soul" chords / "Stand by Me" changes）、**《Blue Moon》**（Elvis
Presley 1956 年翻唱版 + The Marcels 1961 年 doo-wop 版）、The Penguins 的**《Earth Angel》**（1954，
这条进行被主流采用的奠基之作）、The Everly Brothers 的**《All I Have to Do Is Dream》**、The
Platters 的**《Only You (And You Alone)》**、Dion and the Belmonts 的**《A Teenager in Love》**、
Santo & Johnny 的纯器乐曲**《Sleep Walk》**。详细列表见 [Wikipedia: '50s progression](https://en.wikipedia.org/wiki/%2750s_progression)。

### 五度圈类（Circle of fifths）

- 现代流行例子：Ed Sheeran **《Thinking Out Loud》**（D→A→Em→G 一段带五度圈味道的进行）、
  John Legend **《All of Me》**。
- 爵士标准曲（ii-V-I 是五度圈最短的版本，几乎每首 jazz standard 都会用到）：Duke Ellington
  **《Take the 'A' Train》**、Miles Davis **《Tune-Up》**、**《As Time Goes By》**（1931，《Casablanca》
  插曲）。想找更系统的 jazz standard 曲目和它们的和弦进行，可以查项目内已有的
  [Real Book 与经典爵士和弦进行调研](real-book-chord-progressions-research.md)。

### 级进类（Stepwise，包括你分析的 IV-iii-ii-I 那种下行）

YouTube 上直接有一个现成的合集视频：**["40 Songs that use Descending Stepwise chord progressions"](https://www.youtube.com/watch?v=dyDFcchDl2M)**，
就是按这个模式专门做的串烧，可以当成"级进版的 Axis of Awesome 4 Chords"来听。另外搜到的具体曲目
（根音沿音阶级进下行的贝斯线）：Procol Harum **《A Whiter Shade of Pale》**、Marvin Gaye/Tammi
Terrell **《Ain't No Mountain High Enough》**、Frank Sinatra **《My Way》**、The Jackson 5
**《I'll Be There》**、Billy Joel **《Piano Man》**（verse 里贝斯线沿音阶走一整段）、Bob Marley
**《No Woman, No Cry》**（I→V6→vi，根音 C→B→A 下行）、David Bowie **《Life on Mars?》**（半音级进下行）、
George Harrison **《While My Guitar Gently Weeps》**、Led Zeppelin **《Stairway to Heaven》**。

### 12 小节蓝调（自成一类）

Robert Johnson **《Sweet Home Chicago》**、B.B. King **《The Thrill Is Gone》**、Chuck Berry
**《Johnny B. Goode》**、Bill Haley & His Comets **《Rock Around the Clock》**、Little Richard
**《Tutti Frutti》**、Jimi Hendrix **《Red House》**、Led Zeppelin **《You Shook Me》**——都是教科书
式的 12 小节蓝调结构，练熟了这几首基本就摸到蓝调的骨架了。

### 想找人讲解、不只是看歌单

- **David Bennett Piano**（YouTube，126 万订阅，实时搜索确认）：专门做"具体歌曲里的和声理论"这类视频，
  常拿 Beatles、Radiohead、Taylor Swift、Queen、Billie Eilish 的歌举例，覆盖五度圈进行、调式互换、
  重配和声（reharmonization）这些主题，风格是"一首歌一首歌拆和弦"，跟这篇文档的思路很像。
- **Rick Beato 的《What Makes This Song Great?》系列**（YouTube，实时搜索确认）：每期挑一首经典摇滚/
  流行歌，用分轨（multitrack）拆和声、旋律、编曲，边讲边在钢琴/吉他上弹出和弦变化，适合"听讲解+跟弹"
  这种学习方式。

### 怎么用

去 [Hooktheory 的 TheoryTab](https://www.hooktheory.com/theorytab) 或 Trends 工具搜上面任意一首歌名，
能看到官方拆出来的级数进行和旋律可视化；也可以直接在 YouTube/Spotify 搜歌名放出来听，一边听一边对照
Chord Match 里同 Pattern 分类下弹的和弦，练"耳朵里认出这个进行"的感觉。

Sources:
- [The Axis of Awesome - Wikipedia](https://en.wikipedia.org/wiki/The_Axis_of_Awesome)
- [I analyzed the chords of 1300 popular songs for patterns - Hooktheory Blog](https://www.hooktheory.com/blog/i-analyzed-the-chords-of-1300-popular-songs-for-patterns-this-is-what-i-found/)
- [Hooktheory Trends Tool](https://www.hooktheory.com/trends)
- ['50s progression - Wikipedia](https://en.wikipedia.org/wiki/%2750s_progression)
- [vi–ii–V–I - Wikipedia](https://en.wikipedia.org/wiki/Vi%E2%80%93ii%E2%80%93V%E2%80%93I)
- [40 Songs that use Descending Stepwise chord progressions - YouTube](https://www.youtube.com/watch?v=dyDFcchDl2M)
- [Descending Bass Lines](https://www.angelfire.com/fl4/moneychords/DBL.html)
- [12 Best Examples Of 12-Bar Blues Songs - hellomusictheory](https://hellomusictheory.com/learn/best-12-bar-blues-examples/)
- [Hooktheory TheoryTab](https://www.hooktheory.com/theorytab)

## 7. 怎么拿这篇文档配合 Chord Match 练

1. 先看 Chord Match 页面上方显示的"Progression: XXX in Y — chord N/M"，对照上面第 4 节的表，
   搞清楚你现在弹的这个和弦属于哪种生成机制（功能替代/五度圈/级进/蓝调），而不是死记"这一条是 G-D-Em-C"。
2. 想专门练某一种机制（比如第 4 节末尾提到的级进下行），用 **Pattern** 筛选框只选那一种，集中刷几轮，
   练熟了再切回 All。
3. 弹之前先点 **🔊 Preview progression** 听一遍，建立"这条进行应该长什么样"的正确耳朵印象，
   再自己动手弹，避免因为弹错而记错音响效果。
4. 同一条进行会循环 2 遍（可在 Repeat 里调），利用这个机会在第二遍试着"预判"下一个和弦该往哪个
   方向走——如果你能猜对根音是五度圈还是级进，说明这套规律真的内化了。
5. 想把"耳朵里的进行"跟"真实歌曲"对上号，去 Hooktheory 的 TheoryTab/Trends 搜一下当前这条进行，
   听几首用了同一套和弦的歌，再回来对照 Chord Match 里的版本。

## 参考资料

- [Roman numeral analysis (Wikipedia)](https://en.wikipedia.org/wiki/Roman_numeral_analysis)
- [Function (music) — tonic/subdominant/dominant (Wikipedia)](https://en.wikipedia.org/wiki/Function_(music))
- [Circle of fifths (Wikipedia)](https://en.wikipedia.org/wiki/Circle_of_fifths)
- [Secondary dominant (Wikipedia)](https://en.wikipedia.org/wiki/Secondary_chord)
- [Hooktheory](https://www.hooktheory.com/)（实时搜索确认可用，TheoryTab + Trends 工具）
- 项目内已有：[常见和弦进行分类调研](common-chord-progressions-research.md)、
  [Real Book 与经典爵士和弦进行调研](real-book-chord-progressions-research.md)
