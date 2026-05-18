# 音频插件格式介绍

## 先说本质

音频插件格式解决的是“一个外部软件模块如何被 DAW 加载、运行、传音频、收 MIDI、暴露参数、保存状态”。

它不是 MIDI 的替代品。MIDI 是演奏和控制事件；插件格式是宿主软件和插件之间的二进制接口/运行约定。

典型链路：

```text
DAW / host
  -> 加载插件文件
  -> 传入 MIDI events 和 audio buffers
  -> 插件生成或处理 audio buffers
  -> DAW 继续混音、自动化、导出
```

例子：

```text
MIDI Note On C4
  -> VST3 钢琴插件
  -> 插件输出一段钢琴音频
  -> DAW 把音频送到 master bus
```

所以：

- MIDI 说“弹 C4，力度 90”。
- 插件格式说“这个钢琴插件如何被宿主加载，如何接收 MIDI，如何返回音频，参数怎么自动化，状态怎么保存”。

## Host 和 Plugin

音频插件生态里有两个角色。

Host 是宿主，例如：

- Cubase。
- Ableton Live。
- Logic Pro。
- Pro Tools。
- Ardour。
- Reaper。

Plugin 是插件，例如：

- 软件钢琴。
- 合成器。
- 鼓机。
- EQ。
- 压缩器。
- 混响。

宿主负责：

- 扫描插件。
- 创建插件实例。
- 分配音频输入/输出 buffer。
- 发送 MIDI events。
- 读取和写入参数。
- 保存插件状态。
- 做自动化和工程管理。

插件负责：

- 根据输入生成或处理声音。
- 暴露参数，例如 cutoff、gain、attack、threshold。
- 把参数变化反映到音频处理里。
- 告诉宿主自己需要几个输入/输出、是否接收 MIDI、是否有编辑器 UI。

## 插件的三类用途

### Instrument Plugin

软件乐器插件接收 MIDI，输出音频。

```text
MIDI -> synth / sampler -> audio
```

例子：

- 合成器。
- 钢琴采样器。
- 鼓机。
- 管弦乐音源。

### Audio Effect Plugin

音频效果器接收音频，输出处理后的音频。

```text
audio -> EQ / compressor / reverb -> audio
```

例子：

- EQ。
- Compressor。
- Reverb。
- Delay。
- Distortion。

### MIDI Effect Plugin

MIDI 效果器接收 MIDI，输出修改后的 MIDI。

```text
MIDI notes -> arpeggiator -> new MIDI notes
```

例子：

- Arpeggiator。
- Chord generator。
- MIDI transposer。
- Velocity processor。

## 插件和 MIDI 的区别

| 维度 | MIDI | 音频插件格式 |
| --- | --- | --- |
| 本质 | 事件协议 | 软件模块接口 |
| 传什么 | Note、CC、Program Change、Pitch Bend | audio buffer、MIDI event、parameter、state |
| 解决问题 | 怎么表达演奏和控制 | 宿主怎么加载和运行插件 |
| 是否发声 | 不发声 | 乐器插件会发声，效果器处理声音 |
| 文件例子 | `.mid` | `.vst3`、`.component`、`.aaxplugin`、`.lv2` |

一句话：MIDI 是“乐谱上的演奏指令”，插件格式是“乐器或效果器如何插进 DAW 里工作”。

## VST

VST 是 Steinberg 推出的插件格式，全称 Virtual Studio Technology。它是跨平台音乐制作中最有名的插件标准之一。

本质：

- VST 定义宿主和插件之间的 API。
- 插件通常以动态库形式存在。
- 宿主扫描插件目录，加载插件，调用处理函数。

VST2 和 VST3 的差异：

- VST2 是老生态，历史插件非常多，但官方 SDK 授权和分发已经停止。
- VST3 是当前主推版本，支持更清晰的事件、参数、总线和宿主集成模型。

VST 插件可以是：

- 软件乐器。
- 音频效果器。
- MIDI 效果器。

为什么重要：

- 生态最大之一。
- Windows/macOS/Linux 都能见到。
- 很多 DAW 都支持 VST3。

## Audio Units

Audio Units，简称 AU，是 Apple 平台的音频插件体系。

本质：

- AU 是 Apple Core Audio 生态里的插件接口。
- 插件和宿主通过 Apple 的 Audio Unit API 交互。
- 文件常见为 `.component`。

适合场景：

- Logic Pro。
- GarageBand。
- macOS / iOS 音频 app。

特点：

- 和 Apple 平台集成深。
- macOS/iOS 上体验好。
- 跨平台性不如 VST。

如果一个插件同时提供 VST3 和 AU，通常是同一套 DSP 核心打包成两种宿主接口。

## AAX

AAX 是 Avid Pro Tools 使用的插件格式。

本质：

- AAX 定义 Pro Tools 宿主和插件之间的接口。
- 它服务于 Pro Tools 的专业录音、混音、后期生态。

适合场景：

- 商业录音棚。
- 影视后期。
- Pro Tools 工程。

特点：

- 与 Pro Tools 绑定更深。
- 发布和签名流程更严格。
- 对要进入专业录音棚生态的插件厂商很重要。

## LV2

LV2 是开源音频插件标准，Linux 音频生态中常见。

本质：

- LV2 是开放插件规范。
- 它通过扩展机制表达 MIDI、UI、参数、状态、事件等能力。
- 常见于 Ardour、Carla 等开源音频工具。

特点：

- 开放标准。
- Linux 和开源生态友好。
- 商业插件生态不如 VST/AU/AAX 大。

适合场景：

- Linux 音频工作站。
- 开源插件。
- 学术和实验性音频工具。

## 插件内部通常怎么工作

一个效果器插件的处理循环可以简化为：

```text
host 给插件一块 input audio buffer
插件逐 sample 或逐 block 处理
插件写入 output audio buffer
host 拿 output 继续混音
```

一个乐器插件的处理循环可以简化为：

```text
host 在当前 audio block 里传入 MIDI events
插件根据 MIDI events 更新 voice 状态
插件合成或播放采样
插件写入 output audio buffer
```

这就是为什么插件开发会同时涉及：

- MIDI event handling。
- DSP。
- 参数自动化。
- 实时线程安全。
- GUI。
- 状态保存和加载。

## 怎么选格式

| 目标 | 优先格式 |
| --- | --- |
| 跨平台商业插件 | VST3 + AU，必要时加 AAX |
| Apple 生态 | AU / AUv3 |
| Pro Tools 专业生态 | AAX |
| Linux 开源生态 | LV2 + VST3 |
| 自己做音频应用而非插件 | 不一定需要插件格式，直接用音频引擎即可 |

## 参考资料

- Steinberg VST：https://www.steinberg.net/developers/
- Apple Audio Units：https://developer.apple.com/documentation/audiotoolbox/audio_unit
- Avid AAX：https://developer.avid.com/aax/
- LV2：https://lv2plug.in/
