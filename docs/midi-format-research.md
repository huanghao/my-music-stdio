# MIDI 格式调研

## 定位

MIDI 是演奏事件和控制信息标准，适合播放、录制、伴奏生成、外部设备输入和音源控制。它不是谱面格式，也不应该作为内部谱面模型。

产品中需要区分三层概念：

- MIDI 协议消息：note on/off、control change、program change 等。
- Standard MIDI File：把 MIDI 事件保存到文件，通常是 `.mid`。
- MIDI 2.0：新的协议体系，增加更高分辨率和双向能力，但第一阶段通常不必优先依赖。

## 适合表达的内容

- 音符开始和结束。
- velocity。
- tempo map。
- time signature meta event。
- program change。
- control change，例如延音踏板、调制轮、音量。
- pitch bend。
- drum channel 和打击乐事件。

## 不适合表达的内容

- 谱面上的连音、声部、指法、把位。
- 和弦名称和功能分析。
- 吉他技巧的完整语义。
- 口琴吹吸和孔位。
- 用户看到的排版结构。

MIDI 可以记录“什么时候响了什么音”，但很难表达“这个音在谱面上为什么这样写、应该怎样演奏、属于哪个和弦功能”。

## 在产品中的用途

### 播放

内部模型生成 MIDI 事件，交给音源播放：

```text
Music Model -> Playback Scheduler -> MIDI Events -> Synth/Sampler
```

### 录制

外部 MIDI 键盘输入可转换成练习事件：

```text
MIDI Input -> Quantize/Match -> Practice Event -> Score Feedback
```

### 伴奏生成

伴奏系统生成鼓、贝斯、钢琴、吉他等声部的 MIDI 事件，再由音源渲染。

## 第一阶段验证点

- Web MIDI 或桌面端 MIDI 输入是否满足目标平台。
- MIDI 文件导出是否能被常见播放器、DAW、MuseScore 打开。
- tempo map 和小节位置是否能与谱面同步。
- velocity、swing、humanization 是否能改善伴奏机械感。
- 鼓轨映射是否采用 General MIDI 习惯。

## 风险

- MIDI 回放效果高度依赖音源。
- MIDI 文件导入无法可靠还原谱面。
- Quantize 过强会损失真实演奏，过弱又难以对齐练习评分。
- MIDI 2.0 很重要，但设备和系统支持仍需要按目标平台验证。

## 参考资料

- MIDI Association Specs：https://midi.org/specs
- MIDI Association About：https://midi.org/about

