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

以下节拍位置以 16 分音符为单位，一小节共 16 格（1-16），"●" 表示击打：

```
位置:  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16
       |        |        |        |        |
       1拍      2拍      3拍      4拍
```

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

**Fill 实现要点：**
- 替换最后半拍（或最后 1-2 拍）的 hihat，改为 snare/tom roll
- Fill 力度通常从弱到强（crescendo）
- 简单 fill：snare 在最后 4 个 16 分音符连击
- 进阶 fill：tom 从高到低依次下行（high tom → mid tom → floor tom）

**示例：简单 snare fill（最后 2 拍）**
```
正常 groove 最后 2 拍：
HiHat: ●  .  ●  .  ●  .  ●  .

替换为 fill：
Snare: ●  ●  ●  ●  ●  ●  ●  ●  （16分音符连击，力度渐强）
```

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

## 5. 扩展计划

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
