# General MIDI 介绍

## General MIDI 是什么

General MIDI，简称 GM，是建立在 MIDI 1.0 之上的播放兼容约定。它不是新的线缆协议，也不是新的文件格式，而是规定“如果一个 MIDI 文件使用某些 program、channel 和 note number，兼容设备应该按什么方式解释”。

GM 的目标是让同一份 MIDI 文件在不同设备上播放时，乐器分配至少大体一致。

## 为什么需要 General MIDI

MIDI 1.0 的 Program Change 只说“切换到第几个 program”，但没有规定 program 1 一定是什么乐器。

没有 GM 时：

```text
Program Change 1
设备 A：解释成钢琴
设备 B：解释成合成器 Pad
设备 C：解释成贝斯
```

有 GM 后：

```text
Program Change 1 -> Acoustic Grand Piano
Program Change 25 -> Acoustic Guitar (nylon)
Program Change 41 -> Violin
```

这不保证音色质量一致，只保证基本乐器类别可预期。

## GM 约定了什么

GM Level 1 的核心约定包括：

- 128 个标准旋律乐器 program。
- channel 10 用于打击乐。
- 打击乐用 note number 区分鼓件。
- 至少支持 16 个 MIDI channel。
- 至少 24 个同时发声能力。

## Program 和乐器

GM 把 128 个 program 分成若干组，例如：

- Piano。
- Chromatic Percussion。
- Organ。
- Guitar。
- Bass。
- Strings。
- Ensemble。
- Brass。
- Reed。
- Pipe。
- Synth Lead。
- Synth Pad。
- Synth Effects。
- Ethnic。
- Percussive。
- Sound Effects。

不同资料中 program 编号有时从 1 开始显示，底层 MIDI data byte 从 0 开始。读表时要注意这个差异。

这里的 Synth Lead、Synth Pad、Synth Effects 只是 General MIDI 对“合成器音色类别”的命名。它不解释合成器怎么发声，也不规定 oscillator、filter、envelope 等具体参数。合成器的声音生成原理见 [合成器介绍](synthesizer-research.md)。

## 为什么 channel 10 是鼓

旋律乐器通常一个 channel 对应一个音色，例如 channel 1 是钢琴，channel 2 是贝斯。

鼓组不一样。一套鼓里有底鼓、军鼓、踩镲、通鼓、吊镲等很多鼓件。如果每个鼓件都占一个 channel，很快就会用完 16 个 channel。

所以 GM 约定 channel 10 是 rhythm channel，在这个 channel 上，不同 note number 表示不同鼓件。

常见例子：

```text
35 / 36: Bass Drum
38: Acoustic Snare
42: Closed Hi-Hat
46: Open Hi-Hat
49: Crash Cymbal
51: Ride Cymbal
```

## 16 个通道和 24 个同时发声

16 个通道是控制分组数量，24 个同时发声是复音能力。

例子：

```text
channel 1: 钢琴
channel 2: 贝斯
channel 10: 鼓
```

钢琴只占一个 channel，但一个和弦可能同时有 6 个音；加上延音踏板，前一个和弦还没消失，下一个和弦又响起，同时发声数量会继续增加。

因此 GM 要求设备不只是“能接收 16 个 channel”，还要“至少能同时响 24 个音”。

## GM 的局限

- 它不保证音色质量，只保证乐器类别。
- 它不覆盖现代大型采样库的复杂 articulations。
- 它不能表达完整谱面、指法或真实演奏细节。
- 不同设备即使都支持 GM，听起来仍可能差异很大。

## 参考资料

- MIDI Association General MIDI：https://midi.org/general-midi
- MIDI Association Specs：https://midi.org/specs
