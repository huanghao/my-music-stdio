# 音频技术术语介绍

> 面向不熟悉音乐制作生态的开发者，解释 DAW、VST、AU、MIDI 等常见术语。

---

## DAW（Digital Audio Workstation，数字音频工作站）

DAW 是音乐制作的主软件，相当于音乐制作的 IDE。它把录音、编曲、混音、母带处理集成在一个界面里。

常见 DAW：

| DAW | 平台 | 价格 | 定位 |
|-----|------|------|------|
| GarageBand | macOS/iOS | 免费 | 入门，苹果自带 |
| Logic Pro | macOS | $199 | 专业，苹果出品 |
| Ableton Live | Win/Mac | $99–$749 | 电音、现场演出 |
| Reaper | Win/Mac | $60 | 全能，轻量，支持命令行 |
| Pro Tools | Win/Mac | 订阅制 | 录音棚行业标准 |

DAW 的核心概念：
- **Track（音轨）**：一个声部，可以是录音、MIDI、或效果器链
- **MIDI Track**：不含真实音频，只含音符事件；需要连接一个"乐器插件"来发声
- **Audio Track**：直接录音或导入 WAV/MP3
- **Plugin（插件）**：加载到 DAW 里的音源或效果器

---

## VST / AU / AAX（插件格式）

插件格式是 DAW 和音源/效果器之间的接口标准，相当于驱动程序的规范。

| 格式 | 全称 | 开发商 | 支持平台 | 说明 |
|------|------|--------|---------|------|
| **VST2** | Virtual Studio Technology 2 | Steinberg | Win/Mac | 最广泛，几乎所有 DAW 支持 |
| **VST3** | Virtual Studio Technology 3 | Steinberg | Win/Mac | VST2 的继任，更省 CPU |
| **AU** | Audio Unit | Apple | macOS only | macOS 系统原生格式，GarageBand/Logic 使用 |
| **AAX** | Avid Audio eXtension | Avid | Win/Mac | Pro Tools 专用 |

同一个音源通常同时提供 VST3 和 AU 两种格式。macOS 上两种都能用；Windows 上只有 VST。

---

## 音源插件（Instrument Plugin / VSTi）

音源插件是"能发出声音的插件"，接收 MIDI 音符，输出音频。

两种实现原理：

**采样器（Sampler）**
- 内部存着真实乐器的录音片段（采样）
- 收到 MIDI 音符后，找到对应音高/力度的采样片段播放
- 优点：音色真实；缺点：文件大，高质量的几 GB 起步
- 代表：Kontakt、Spitfire LABS、EXS24（Logic 内置）

**合成器（Synthesizer）**
- 用数学算法实时生成波形（正弦波、锯齿波等），不依赖预录采样
- 优点：文件小，音色可塑性强；缺点：模拟真实乐器效果差
- 代表：Massive、Serum、Surge（免费）

SoundFont（.sf2/.sf3）本质上是一个轻量版采样器格式，FluidSynth 是它的播放引擎。

---

## 常见免费高质量音源插件

### Spitfire LABS
- 官网：https://labs.spitfireaudio.com
- 每种乐器独立免费下载，已有 50+ 款
- 代表音色：Soft Piano（钢琴）、Strings（弦乐）、Choir（合唱）
- 格式：VST3 + AU，需要安装 Spitfire App 管理下载
- 文件大小：每款 100MB–2GB 不等

### Decent Sampler（插件引擎）
- 免费采样器引擎，可加载社区制作的 `.dspreset` 音色包
- https://www.decentsamples.com
- 大量免费钢琴、弦乐、民族乐器可下载

### Surge XT（合成器）
- 完全开源免费，https://surge-synthesizer.github.io
- 功能媲美商业合成器

---

## pedalboard（Python 调用 VST 的库）

[pedalboard](https://github.com/spotify/pedalboard) 是 Spotify 开源的 Python 库，可以在 Python 代码里加载并驱动 VST3/AU 插件，无需打开 DAW。

主要用途：
- 批量渲染音频（把 MIDI + 音源 → WAV，全在 Python 里完成）
- 给音频加效果器（混响、压缩、均衡器）
- 在 Python 脚本里做自动化音频处理

```python
from pedalboard import load_plugin
from pedalboard.io import AudioFile
import numpy as np

# 加载 AU 插件（macOS）
synth = load_plugin("/Library/Audio/Plug-Ins/Components/Surge XT.component")

# 构造 MIDI 消息
from mido import Message
notes_on  = [Message('note_on',  note=60, velocity=80, time=0)]
notes_off = [Message('note_off', note=60, velocity=0,  time=22050)]  # 0.5s 后

# 渲染成音频（离线，不实时）
audio = synth(np.zeros((2, 44100)), 44100, midi_messages=notes_on + notes_off)

# 保存
with AudioFile("output.wav", "w", 44100, 2) as f:
    f.write(audio)
```

**限制**：pedalboard 目前是**离线渲染**模式，不支持真正的实时 MIDI 输入（比如边弹边出声）。实时播放仍需用 FluidSynth 或 DAW。

---

## 本项目的定位

对于这个练习伴奏工具：

- **现阶段**：FluidSynth + Timbres of Heaven，够用，零依赖
- **若需更好音质导出**：pedalboard + Surge XT（免费合成器）或 MuseScore 4 命令行
- **VST/DAW 生态**：了解即可，不作为当前实现目标

---

*最后更新：2026-05-18*
