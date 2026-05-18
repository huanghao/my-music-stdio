# 伴奏风格设计文档

> 本文档面向开发者，描述伴奏生成器中"风格"的定义、现有风格规格、groove/fill 实现方式，以及扩展参考来源。

---

## 1. 什么是风格

**风格 = 鼓 groove pattern + 和弦演奏方式 + 速度范围的组合。**

- **Groove**：在一个小节（通常 4/4）内循环的基础律动，由 kick、snare、hihat 的落点组成。Groove 是风格的骨架，决定了听感上的"律动感"。
- **Fill**：段落结尾（通常第 4 小节末尾）的 1-2 拍过渡敲击，用 tom 或 snare roll 制造"收尾感"，引导进入下一段落。Fill 不循环，只在特定位置触发一次。
- **和弦演奏方式**：钢琴/吉他如何演奏和弦，例如 block chord（齐奏）、分解琶音、切分节奏等。
- **BPM 范围**：该风格的典型速度区间，超出范围听感会偏离风格特征。

---

## 2. 各风格规格

以下节拍位置以 16 分音符为单位，一小节共 16 格（1-16），用点阵表示击打（●）和静音（·），力度用大小写区分（●=正常，○=轻触 ghost note，◉=重击 accent）：

```
位置:  1  2  3  4 | 5  6  7  8 | 9 10 11 12 |13 14 15 16
       ↑           ↑            ↑            ↑
       beat 1      beat 2       beat 3       beat 4
```

> 另一种常见写法是 MIDI piano roll 格网，但对于 groove 文档，上述 ASCII 点阵最直观。Band-in-a-Box 和 iReal Pro 均使用类似的 "x" / "." 记谱法。

**"x / ." 写法示例（与本文 ● / · 等价）：**

鼓谱常见用 `x` 表示敲击、`.` 表示静音，hihat 有时用小写 `x` 区分音色（闭合=`x`，开合=`o`）：

```
         1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16
Kick:    x  .  .  .  .  .  .  .  x  .  .  .  .  .  .  .
Snare:   .  .  .  .  x  .  .  .  .  .  .  .  x  .  .  .
HiHat:   x  .  x  .  x  .  x  .  x  .  x  .  x  .  x  .
```

**"动次打次"与鼓点的对应关系：**

"动次打次"是民间对 Pop/Rock 基础律动的口语化描述，对应关系如下：

| 口语音节 | 听感 | 对应乐器 | 16 分格位 |
|---------|------|---------|----------|
| **动** | 低沉 "咚" | Kick（底鼓） | 格 1（beat 1） |
| **次** | 轻 "哒" | HiHat（踩镲） | 格 3（beat 1 后半） |
| **打** | 响亮 "啪" | Snare（军鼓） | 格 5（beat 2） |
| **次** | 轻 "哒" | HiHat | 格 7（beat 2 后半） |

一小节完整展开（8 分音符 hihat 版）：

```
口语:   动    次    打    次    动    次    打    次
格位:   1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16
Kick:   x  .  .  .  .  .  .  .  x  .  .  .  .  .  .  .
Snare:  .  .  .  .  x  .  .  .  .  .  .  .  x  .  .  .
HiHat:  x  .  x  .  x  .  x  .  x  .  x  .  x  .  x  .
```

> "次大次大"（funk 版）：hihat 改为 16 分密集，kick 出现在切分位置，律动感更强。

---

### Pop（已实现）

**鼓 Groove：**
```
Kick:  ●  .  .  .  .  .  .  .  ●  .  .  .  .  .  .  .   （1、3拍）
Snare: .  .  .  .  ●  .  .  .  .  .  .  .  ●  .  .  .   （2、4拍）
HiHat: ●  .  ●  .  ●  .  ●  .  ●  .  ●  .  ●  .  ●  .   （8分音符，偶数格）
```

**和弦演奏方式：** Piano block chord，每拍齐奏一个和弦（4次/小节）

**典型 BPM：** 90–130

**代表艺人/歌曲：** Taylor Swift《Shake It Off》、Ed Sheeran《Shape of You》、周杰伦《七里香》

---

### Ballad（抒情慢歌）

**鼓 Groove：**
```
Kick:  ●  .  .  .  .  .  .  .  ●  .  .  .  .  .  .  .   （1、3拍）
Snare: .  .  .  .  ●  .  .  .  .  .  .  .  ●  .  .  .   （2、4拍，力度轻）
HiHat: ●  .  .  .  ●  .  .  .  ●  .  .  .  ●  .  .  .   （4分音符，每拍一下）
```

**和弦演奏方式：** 钢琴分解琶音（broken chord），按 根音→3音→5音→3音 顺序，每拍 4 个 16 分音符

**典型 BPM：** 60–80

**代表艺人/歌曲：** Adele《Someone Like You》、张学友《吻别》、John Legend《All of Me》

---

### Shuffle / Blues（12小节蓝调）

Shuffle 的核心是"摇摆感"：每拍的前半拍拉长、后半拍缩短，形成 long-short 的三连音律动（实际写为 8 分三连音，第 1、3 个三连音格落点）。

**鼓 Groove（三连音律动，每拍 3 格，共 12 格/小节）：**
```
Kick:  ●  .  .  ●  .  .  .  .  .  .  .  .   （1拍、2拍）
Snare: .  .  .  .  .  .  ●  .  .  .  .  .   （3拍）
HiHat: ●  .  ●  ●  .  ●  ●  .  ●  ●  .  ●   （三连音第1、3格）
```

**和弦演奏方式：** 钢琴 shuffle comping，右手切分和弦，左手低音 walking bass

**典型 BPM：** 80–130（blues shuffle）；快 blues 可到 160

**代表艺人/歌曲：** B.B. King《The Thrill Is Gone》、Robert Johnson《Sweet Home Chicago》、Stevie Ray Vaughan《Pride and Joy》

---

### Bossa Nova

Bossa Nova 的特征是巴西桑巴节奏与爵士和声的融合，鼓（或打击乐）使用特定的 clave 律动。

**鼓 Groove（16 分音符）：**
```
Kick:  ●  .  .  .  ●  .  .  .  .  .  ●  .  .  .  .  .   （1、1.5、3拍）
Snare: .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .   （通常用 rim click 代替）
Rim:   .  .  .  ●  .  .  .  ●  .  .  .  ●  .  .  ●  .   （Clave 节奏）
HiHat: ●  .  ●  .  ●  .  ●  .  ●  .  ●  .  ●  .  ●  .   （8分音符，脚踩）
```

**和弦演奏方式：** 吉他/钢琴切分 comping，和弦在弱拍落点，大量使用 maj7、m7、dom9 等爵士和弦

**典型 BPM：** 120–160

**代表艺人/歌曲：** João Gilberto《The Girl from Ipanema》、Stan Getz《Corcovado》、Astrud Gilberto

---

### R&B / Soul

**鼓 Groove（16 分音符，强调 backbeat 和 ghost note）：**
```
Kick:  ●  .  .  .  .  .  .  ●  ●  .  .  .  .  .  .  .   （1拍、2拍末、3拍）
Snare: .  .  .  .  ●  .  .  .  .  .  .  .  ●  .  .  .   （2、4拍，力度重）
HiHat: ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●   （16分音符密集）
```

Ghost note（轻触 snare）穿插在 16 分音符空隙中，增加律动密度。

**和弦演奏方式：** 钢琴 Rhodes 风格，切分和弦 + 滑音；或 organ 持续 pad

**典型 BPM：** 65–100

**代表艺人/歌曲：** Stevie Wonder《Superstition》、D'Angelo《Brown Sugar》、Aretha Franklin《Respect》

---

### Funk

Funk 的核心是"The One"（强调第 1 拍）和密集的 16 分音符律动，以及频繁的 kick 切分。

**鼓 Groove（16 分音符）：**
```
Kick:  ●  .  .  ●  .  .  ●  .  ●  .  .  .  .  ●  .  .   （切分，不规则）
Snare: .  .  .  .  ●  .  .  .  .  .  .  .  ●  .  .  .   （2、4拍）
HiHat: ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●   （16分音符，开合交替）
```

**和弦演奏方式：** 钢琴/Rhodes 切分 stab（短促击打和弦），通常在弱拍；bass 线主导律动

**典型 BPM：** 90–115

**代表艺人/歌曲：** James Brown《Sex Machine》、Sly & The Family Stone《Thank You》、Parliament《Give Up the Funk》

---

### Rock

**鼓 Groove（16 分音符）：**
```
Kick:  ●  .  .  .  .  .  .  .  ●  .  .  .  .  .  .  .   （1、3拍，力度重）
Snare: .  .  .  .  ●  .  .  .  .  .  .  .  ●  .  .  .   （2、4拍，响亮）
HiHat: ●  .  ●  .  ●  .  ●  .  ●  .  ●  .  ●  .  ●  .   （8分音符）
```

也常见 kick 在 1、2.5、3 拍的变体（"four on the floor" 风格见 disco）。

**和弦演奏方式：** 吉他 power chord（根音+五度），钢琴用 block chord 或 boogie 律动

**典型 BPM：** 110–160

**代表艺人/歌曲：** AC/DC《Back in Black》、Nirvana《Smells Like Teen Spirit》、The Beatles《Come Together》

---

### Heavy Metal

**鼓 Groove（16 分音符，双踩或快速单踩）：**
```
Kick:  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●   （16分音符连续，双踩）
Snare: .  .  .  .  ●  .  .  .  .  .  .  .  ●  .  .  .   （2、4拍）
Crash: ●  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .   （每小节第1拍）
HiHat: （通常关闭，偶尔在 snare 间隙出现）
```

**和弦演奏方式：** 吉他 palm-mute power chord，低音区切分节奏；钢琴伴奏较少见，若有则用 unison 齐奏

**典型 BPM：** 140–220（death metal 可达 250+）

**代表艺人/歌曲：** Metallica《Enter Sandman》、Black Sabbath《Iron Man》、Slayer《Raining Blood》

---

## 3. Groove vs Fill

### 概念区分

| | Groove | Fill |
|---|---|---|
| 触发时机 | 每小节循环 | 第 4 小节末尾，或段落切换前 |
| 持续时间 | 整个小节 | 通常最后 1-2 拍（4-8 个 16 分音符） |
| 乐器 | kick / snare / hihat | tom / snare roll，hihat 通常停止 |
| 作用 | 维持律动 | 制造"收尾感"，引导段落切换 |

### 代码实现思路

```python
TICKS_PER_BEAT = 480
BEATS_PER_BAR = 4

def generate_bar(bar_index, style):
    is_fill_bar = (bar_index % 4 == 3)  # 每 4 小节的最后一小节

    for beat in range(BEATS_PER_BAR):
        if is_fill_bar and beat >= 2:
            # 最后两拍替换为 fill pattern
            generate_fill(beat, style)
        else:
            # 正常 groove pattern
            generate_groove(beat, style)
```

**Fill 通用规则：**
- HiHat 在 fill 期间通常停止（或只保留 crash 收尾）
- Fill 力度通常从弱到强（crescendo），最后一击最重
- Fill 长度：短 fill = 最后 1 拍（4 个 16 分音符）；长 fill = 最后 2 拍（8 个）
- Fill 结尾通常配一下 crash cymbal（第 1 拍 crash = 进入新段落的标志）

**Fill 变体分类：**

| 类型 | 乐器 | 规律 | 适用风格 |
|------|------|------|----------|
| Snare roll | Snare 连击 | 均匀 16 分，力度渐强 | Pop、Rock、R&B |
| Tom cascade | High tom → Mid tom → Floor tom | 每 2 格换一个 tom，向下走 | Rock、Metal |
| Snare + Tom 混合 | Snare 穿插 Tom | 非规律排列，模仿真实鼓手 | Funk、R&B |
| Ghost note fill | Snare（轻） + accent（重） | 弱强交替，节奏感强 | Funk、R&B |
| 反向 tom（ascending） | Floor tom → Mid tom → High tom | 向上走，制造"起飞感" | Metal、Rock |
| Kick + Snare 交替 | Kick 和 Snare 轮流 | 8 分或 16 分交替 | Funk、Blues |
| Half-time fill | 只占 2 个 16 分音符 | 极简，只在最后半拍换一下 | Ballad、Pop |

**示例：各类型 fill（最后 2 拍 = 8 个 16 分音符格）**

```
Snare roll（均匀连击）：
Snare: ○  ○  ●  ○  ●  ●  ◉  ●   力度 pp→ff 渐强

Tom cascade（高→低）：
HiTom: ●  ●  .  .  .  .  .  .
MidTom:.  .  ●  ●  .  .  .  .
FlrTom:.  .  .  .  ●  ●  .  .
Snare: .  .  .  .  .  .  ●  ◉   最后收尾

Ghost note fill（Funk 风格）：
Snare: ○  .  ○  ●  ○  .  ●  ◉   轻触穿插重拍，节奏感强

Half-time fill（Ballad）：
HiHat: ●  .  ●  .  ●  .  .  .
Snare: .  .  .  .  .  .  ●  ◉   最后半拍一击即可
```

**风格与 fill 偏好的对应：**

| 风格 | 首选 fill 类型 | 长度 |
|------|--------------|------|
| Pop | Snare roll | 1-2 拍 |
| Ballad | Half-time / Snare roll | 1 拍 |
| Rock | Tom cascade | 2 拍 |
| Metal | Tom cascade（快速）/ Ascending tom | 2 拍 |
| Funk | Ghost note fill | 1-2 拍 |
| R&B | Snare + Tom 混合 | 1-2 拍 |
| Blues/Shuffle | Kick + Snare 交替 | 1 拍 |

---

## 4. 获取更多风格的参考来源

### 现成风格库

- **iReal Pro** （https://irealpro.com） ：内置数百种风格（Jazz Swing、Bossa Nova、Samba、Waltz 等），每种风格都有对应的 chord chart 和节奏型，是最全面的流行/爵士风格参考。
- **Band-in-a-Box** （PG Music） ：`.sty` 格式的风格文件包含鼓、bass、钢琴的完整 MIDI pattern，可用 MIDI 工具解析提取 groove。

### 鼓手教材

- **"The Drumset Musician" (Rod Morgenstein & Rick Mattingly)**：包含 rock、funk、jazz、latin 等风格的完整 groove 谱，附带实际歌曲示例。
- **"Groove Essentials" (Tommy Igoe)**：50 种 groove pattern，从简单到复杂，每种都有 BPM 示范音频。
- **"The New Breed" (Gary Chester)**：主要针对 studio 鼓手的独立性训练，但包含大量实用 groove 变体。

### MIDI 数据集

- **Groove MIDI Dataset（Magenta / Google）**：https://magenta.tensorflow.org/datasets/groove
  - 包含真实鼓手演奏的 13.6 小时 MIDI 录音，涵盖多种风格
  - 可直接提取 pattern，也可用于训练生成模型
- **MIDI World / FreeMidi.org**：大量免费 MIDI 文件，可下载后用 mido 解析提取鼓轨 pattern

### 自录提取

```python
import mido

def extract_drum_pattern(midi_file, bars=1):
    """从 MIDI 文件提取第一个鼓轨的 groove pattern"""
    mid = mido.MidiFile(midi_file)
    drum_track = None
    for track in mid.tracks:
        for msg in track:
            if msg.type == 'note_on' and msg.channel == 9:  # channel 10 = drums
                drum_track = track
                break
    # ... 按 tick 位置归类 note，量化到 16 分音符格
```

---

## 5. 各风格推荐和弦进行

风格和和弦进行是两个独立维度，但每种风格有约定俗成的"配套和弦"。以下是各风格的典型和弦进行，可作为默认预设。

### 说明

- 和弦进行用相对音级表示（1=I，6=VI，4=IV，5=V），方便移调
- "调式"指该风格常用的音阶背景
- 每种风格列出 1-2 个最常见的进行，够覆盖大部分练习场景

---

### Pop

**调式：** 大调（Ionian）

| 进行名 | 和弦（C 大调） | 特点 |
|--------|---------------|------|
| 1645   | C - Am - F - G | 最常见，几乎无处不在 |
| 1564   | C - G - Am - F | 同一组和弦，不同顺序 |
| 15634  | C - G - Am - Em - F - G | 6 和弦版本，更丰富 |

---

### Ballad

**调式：** 大调或自然小调

| 进行名 | 和弦（C 大调） | 特点 |
|--------|---------------|------|
| 1645   | Cmaj7 - Am7 - Fmaj7 - G7 | 加 maj7/m7 让声音更柔和 |
| 6451   | Am - F - C - G | 小调感，常见于抒情慢歌 |

---

### Blues（12小节）

**调式：** 蓝调音阶（Blues Scale），全用 dominant 7 和弦

| 进行名 | 和弦（A 调） | 特点 |
|--------|-------------|------|
| 12-bar blues | A7 A7 A7 A7 / D7 D7 A7 A7 / E7 D7 A7 E7 | 标准 12 小节蓝调，I IV V 三个和弦 |
| Quick change | A7 D7 A7 A7 / D7 D7 A7 A7 / E7 D7 A7 E7 | 第 2 小节提前到 IV，更常见于现代蓝调 |

---

### Shuffle

**调式：** 大调或混合利底亚（Mixolydian）

与 Blues 类似，常用 dominant 7，但也可以用普通大三和弦：

| 进行名 | 和弦（G 调） | 特点 |
|--------|-------------|------|
| 1451   | G7 - C7 - G7 - D7 | 标准 shuffle 进行 |
| 1645   | G - Em - C - D | 较轻盈的 shuffle 感 |

---

### Bossa Nova

**调式：** 大调，大量爵士和声色彩

| 进行名 | 和弦（C 调） | 特点 |
|--------|-------------|------|
| II-V-I | Dm7 - G7 - Cmaj7 | 爵士最核心进行，Bossa 里极常见 |
| I-VI-II-V | Cmaj7 - Am7 - Dm7 - G7 | 标准 turnaround，循环性强 |
| 桑巴进行 | Cmaj7 - Cm7 - F7 - Bbmaj7 | 含平行小调借用，有层次感 |

---

### R&B / Soul

**调式：** 大调、多利亚小调（Dorian）

| 进行名 | 和弦（C 调） | 特点 |
|--------|-------------|------|
| I-IV   | Cm7 - Fm7（循环） | 极简，强调律动而非和声变化 |
| 1645   | C - Am7 - F - G7 | 加 7 音，更柔和 |
| Dorian | Dm7 - G7（循环） | D Dorian，Soul 常见 |

---

### Funk

**调式：** 多利亚小调（Dorian）、混合利底亚（Mixolydian）

Funk 的和弦进行通常极简，节奏感 > 和声变化：

| 进行名 | 和弦 | 特点 |
|--------|------|------|
| I7 vamp | E7（循环） | 单和弦，律动完全靠节奏 |
| I-IV   | Am7 - D7（循环） | 两和弦循环，A Dorian |
| 1625   | Cm7 - F7 - Bbmaj7 - Eb7 | 稍复杂，带爵士色彩的 funk |

---

### Rock

**调式：** 大调、自然小调、五声音阶

| 进行名 | 和弦（E 调） | 特点 |
|--------|-------------|------|
| I-IV-V | E - A - B（循环） | 最基础的 rock 进行 |
| I-bVII-IV | E - D - A | 借用降七级，经典 rock 感 |
| I-VI-IV-V | E - C#m - A - B | 带小六和弦，更有张力 |
| Power chord 版 | E5 - D5 - A5 | 只用 power chord（根音+五音），无三音 |

---

### Heavy Metal

**调式：** 自然小调（Aeolian）、弗里几亚（Phrygian）、洛克里亚（Locrian）

Metal 几乎只用 power chord（无三音），和弦标记为 X5：

| 进行名 | 和弦（E 调） | 特点 |
|--------|-------------|------|
| i-bVII-bVI | Em5 - D5 - C5 | 自然小调进行，最常见 |
| i-bII      | Em5 - F5（循环）| 弗里几亚特色，半音上行感，极具压迫感 |
| i-bVI-bVII | Em5 - C5 - D5 | 经典 metal 进行，稳重有力 |

---

### 代码中的实现方式

每种风格对应一个默认和弦进行，作为 `--style xxx` 时的 fallback：

```python
# 用级数表示，运行时根据 --key 参数移调
# 格式：罗马数字 + 可选修饰符（maj7 / m7 / 7 / m / 5）
STYLE_DEFAULT_PROGRESSION = {
    "pop":     ["I", "VIm", "IV", "V"],
    "ballad":  ["Imaj7", "VIm7", "IVmaj7", "V7"],
    "blues":   ["I7", "I7", "I7", "I7", "IV7", "IV7", "I7", "I7", "V7", "IV7", "I7", "V7"],
    "shuffle": ["I7", "IV7", "I7", "V7"],
    "bossa":   ["Imaj7", "VIm7", "IIm7", "V7"],
    "rnb":     ["Im7", "IVm7", "Im7", "IVm7"],
    "funk":    ["IIm7", "IIm7", "V7", "V7"],
    "rock":    ["I", "bVII", "IV", "I"],
    "metal":   ["i5", "i5", "bVI5", "bVII5"],
}
```

用户不传和弦时自动使用对应风格的默认进行，传了和弦则覆盖默认值。移调示例：`I` 在 C 调 = `C`，在 A 调 = `A`，在 E 调 = `E`。

---

## 6. 扩展计划

| 风格 | 鼓特征 | 和弦演奏 | 实现难度 |
|---|---|---|---|
| Ballad | 简单 4/4，轻 hihat | 钢琴分解琶音 | 简单 |
| Rock | 标准 2&4 backbeat，重 kick | 吉他 power chord | 简单 |
| Bossa Nova | Clave 节奏型 | 切分 comping | 中等 |
| R&B / Soul | Ghost note，16 分密集 hihat | Rhodes 切分 stab | 中等 |
| Shuffle / Blues | 三连音律动，swing feel | Walking bass + comping | 中等 |
| Funk | 切分 kick，16 分 hihat 开合 | 切分 stab | 中等 |
| Jazz Swing | 三连音 ride，brush snare | Comping（随机切分） | 复杂 |
| Heavy Metal | 双踩，blast beat | Palm-mute power chord | 复杂 |
| Reggae | Kick 在 3 拍，rim on 2&4 | 吉他 skank（弱拍切分） | 中等 |
| Waltz (3/4) | 3/4 拍，kick 在 1，hihat 在 2&3 | 琶音或 oom-pah-pah | 简单 |
| Samba | 快速 surdo + caixa 节奏 | 切分 comping | 复杂 |
| Hip-Hop | 采样风格，kick/snare 切分 | 钢琴 loop | 中等 |

**优先推荐实现顺序：**
1. Ballad — 代码改动最小，只需降速+改 hihat 密度+改钢琴为琶音
2. Rock — 与 Pop 结构相同，主要调整力度和 BPM
3. Shuffle/Blues — 需要实现三连音量化，是后续 jazz 风格的基础
4. R&B — 需要 ghost note 支持，但律动听感提升明显

---

*最后更新：2026-05-18*
