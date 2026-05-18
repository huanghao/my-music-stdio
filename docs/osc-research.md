# OSC 协议调研

## 目标

这篇文档回答三个问题：

- OSC 是什么，和 MIDI、普通 HTTP/WebSocket 有什么不同。
- 如果做音乐练习工作站，OSC 适合放在哪一层。
- 第一阶段是否需要实现 OSC，以及后续实现时需要注意什么。

结论：OSC 适合作为“外部控制协议”和“跨软件实时控制协议”，不适合作为乐谱、MIDI 文件或伴奏数据的内部主格式。第一阶段可以先不实现 OSC，但内部的播放、练习控制、参数控制模型应该保留清晰的 command/event 边界，方便以后把 OSC 映射进来。

## 先说本质

OSC 和 MIDI 的定位不同。

MIDI 的核心是“音乐演奏事件”：按下哪个音、力度多少、哪个通道、哪个控制器变化。它默认有一套面向乐器的固定语义，例如 Note On、Note Off、Control Change、Program Change。

OSC 的核心是“网络参数控制”：给某个地址发送一个或多个参数，让接收端按自己的规则解释。它不预设“音符、通道、音色”这些音乐语义，而是让应用自己定义地址。

可以把 OSC 类比成“网络调音台/网络控制面板”，但它比调音台更通用：

```text
/track/1/volume 0.75       -> 调第 1 轨音量
/synth/filter/cutoff 1200  -> 调合成器滤波器 cutoff
/light/scene "chorus"      -> 切换灯光场景
/avatar/hand/x 0.42        -> 发送传感器或动作数据
```

所以 OSC 更像“把很多软件、设备、参数暴露成一棵地址树，然后通过网络实时改这些参数”。它可以控制很多设备和通道，但前提是发送端和接收端约定好地址含义。

## OSC 是什么

OSC 是 Open Sound Control 的缩写，是一种面向音乐、媒体艺术、交互装置和网络控制的消息协议。它最常见的用途不是保存音乐内容，而是在设备、软件和交互系统之间发送实时控制消息。

可以把 OSC 理解成“带层级地址的实时参数消息”：

```text
/synth/filter/cutoff 1200
/track/1/volume 0.75
/transport/play
/xy 0.42 0.83
```

它常用于：

- 控制合成器、采样器、效果器和音频软件。
- 在 TouchOSC 这类手机/平板控制器和电脑软件之间传递控制消息。
- Max/MSP、Pure Data、SuperCollider、Processing、openFrameworks 等创意编程环境之间通信。
- 多媒体装置中的灯光、视觉、传感器、空间定位和声音系统联动。
- 网络化音乐表演和现场演出控制。
- 数字调音台、舞台控制、媒体服务器等系统的远程参数控制。

OSC 的重点是“控制”和“通信”，不是“乐谱表示”。它通常不会表达一首歌的完整结构，也不会像 MIDI 文件那样保存一串可回放的音符事件。

## 基本消息结构

一个 OSC message 通常由三部分组成：

```text
address pattern + type tag string + arguments
```

例子：

```text
/track/1/volume ,f 0.75
/synth/filter/cutoff ,i 1200
/clip/launch ,is 3 "chorus"
```

含义：

- `address pattern`：地址路径，必须从 `/` 开始，例如 `/track/1/volume`。
- `type tag string`：参数类型标记，通常以 `,` 开头，例如 `,f` 表示一个 float 参数，`,is` 表示一个 int 参数后面跟一个 string 参数。
- `arguments`：实际参数值，例如 `0.75`、`1200`、`"chorus"`。

常见类型：

| Type Tag | 含义 | 例子 |
| --- | --- | --- |
| `i` | 32-bit integer | `1200` |
| `f` | 32-bit float | `0.75` |
| `s` | string | `"chorus"` |
| `b` | blob，任意二进制数据 | 一段采样、图像或自定义数据 |
| `T` / `F` | true / false | 开关状态 |
| `t` | timetag | bundle 调度时间 |

OSC 的底层编码是二进制格式，并且按 4 字节对齐。日常使用时，开发者通常通过库来收发 OSC，不需要手写二进制编码，但理解 address、type tag、arguments 这三层结构很重要。

## Address Pattern

OSC 地址像文件路径或 URL 路径，天然适合表达层级关系：

```text
/transport/play
/transport/stop
/track/1/mute
/track/1/volume
/practice/loop/start_bar
/practice/loop/end_bar
/metronome/enabled
```

地址设计建议：

- 用名词层级表达模块，例如 `/track/1/volume`、`/practice/tempo`。
- 用动词表达明确动作，例如 `/transport/play`、`/clip/launch`。
- 同一类参数保持一致命名，例如统一用 `/enabled` 表示开关。
- 尽量不要把多个含义塞进一个字符串参数。
- 地址应该稳定，避免 UI 文案变化导致协议变化。

OSC 地址还可以支持通配模式，例如 `*`、`?`、`[]`、`{}`。但实际产品里不要过早依赖通配。很多软件或库对通配支持程度不一致，调试也更困难。

## Bundle 和 Timetag

OSC 不只能发单条 message，还可以把多条 message 放进 bundle。

bundle 的作用：

- 把多条控制消息作为一组发送。
- 给一组消息附上 timetag，让接收端按指定时间执行。
- 表达“这些参数应该同时改变”。

例子：

```text
#bundle timetag=immediate
  /track/1/volume 0.8
  /track/1/pan -0.2
  /track/1/mute false
```

在音乐软件里，bundle/timetag 适合处理需要同步生效的控制，例如：

- 同时切换多个声部的静音状态。
- 在下一小节开始时切换伴奏 pattern。
- 同步设置 tempo、loop range 和播放状态。

但 timetag 是否被严格执行，取决于接收端实现。很多应用只是立即处理收到的 OSC message，并不会做高精度调度。因此如果本项目需要拍点级同步，仍然应该依赖内部音频/MIDI 时间轴，而不是把 OSC 当作主时钟。

## 传输方式

OSC 不是一个应用层服务框架，它主要定义消息格式。实际传输通常使用：

- UDP：最常见，延迟低，适合实时控制，但不保证送达和顺序。
- TCP：可靠、有顺序，但可能因为重传带来抖动。
- WebSocket：浏览器环境里常见，但通常需要 OSC-over-WebSocket 或中间桥接层。
- Serial / Bluetooth / 自定义传输：某些装置或硬件项目中也会使用。

UDP 是 OSC 生态里最常见的选择。它适合发送“当前值”类消息，例如 fader、XY pad、sensor value，因为下一帧新值会覆盖旧值。它不适合发送必须保证执行的事务，例如保存文件、购买、不可重复动作。

如果要用 UDP OSC 控制本项目，需要考虑：

- 端口配置。
- 本机地址 `127.0.0.1` 和局域网 IP 的区别。
- 防火墙和系统网络权限。
- 丢包、乱序和重复消息。
- 输入速率限制，避免控制器高频刷屏。

## OSC 和 MIDI 的区别

MIDI 1.0 的消息结构很紧凑，适合乐器演奏和音符事件，但历史包袱较重，例如 16 个通道、7-bit controller 值、固定消息类型。

OSC 更像一个灵活的网络消息系统。它使用可读地址路径和类型化参数，不预设“音符、控制器、音色、通道”这些固定语义。

| 维度 | MIDI | OSC |
| --- | --- | --- |
| 主要用途 | 乐器演奏、音符事件、控制器事件 | 软件/设备之间的实时控制消息 |
| 数据模型 | 固定消息类型，例如 Note On、CC、Program Change | 地址路径 + 类型标签 + 参数 |
| 可读性 | 二进制消息，不直接可读 | 地址路径通常可读 |
| 互操作性 | 乐器和 DAW 支持极广 | 依赖各软件自己的地址约定 |
| 时间模型 | MIDI 文件可保存事件时间；实时 MIDI 依赖外部时钟 | bundle 可带 timetag，但实现差异较大 |
| 适合表达 | 音符、踏板、控制器、节拍同步 | 参数控制、UI 控制、传感器、跨软件联动 |
| 不适合表达 | 复杂自定义层级参数 | 通用乐器兼容、标准曲谱格式 |

简单判断：

- 要表达“用户弹了 C4，力度 90”，优先用 MIDI。
- 要表达“把练习速度设为 80 BPM”，OSC 很合适。
- 要保存一首歌的和弦、段落、谱面和练习设置，不应该直接用 OSC。

## OSC 和 HTTP/WebSocket 的区别

HTTP 更适合请求-响应式 API，例如读取曲库、保存练习记录、登录、同步账号数据。

WebSocket 更适合浏览器和服务器之间的双向长连接，例如多人协作、远程控制、状态推送。

OSC 更适合音乐和媒体软件生态里的实时控制互联，例如 TouchOSC 控制桌面应用，或 Max/MSP 把传感器数据发给音频引擎。

对本项目来说：

- 应用内部 UI 到后端服务：优先考虑普通 API 或 WebSocket。
- MIDI 设备输入输出：使用 MIDI。
- 外部音乐软件、平板控制器、现场装置联动：可以提供 OSC 映射层。

## 对音乐练习工作站的可能用途

OSC 可以作为外部控制入口，映射到本项目已有命令：

```text
/transport/play
/transport/stop
/transport/record 1
/practice/tempo 80
/practice/loop/enabled 1
/practice/loop/start_bar 5
/practice/loop/end_bar 8
/metronome/enabled 1
/track/drums/mute 0
/track/bass/volume 0.65
/score/current_bar 12
```

适合的场景：

- 用 iPad/手机做练习控制面板。
- 用脚踏控制器或外部装置控制播放、停止、循环。
- 和 Max/MSP、Pure Data、TouchDesigner 这类软件联动。
- 接收传感器数据，驱动练习难度、音色参数或可视化。
- 在现场演示时把本项目纳入更大的音频/视觉系统。

不适合的场景：

- 用 OSC 保存工程文件。
- 用 OSC 代替 MIDI 音符事件模型。
- 用 OSC 代替 MusicXML、alphaTab 或内部谱面模型。
- 用 OSC 作为浏览器前端和后端之间的唯一通信协议。

## 内部设计建议

即使第一阶段不实现 OSC，也建议内部模型提前区分：

- `Command`：明确动作，例如 play、stop、setTempo、toggleLoop。
- `State`：当前状态，例如 currentBar、tempo、isPlaying、loopRange。
- `Event`：已经发生的事件，例如 playbackStarted、barChanged、notePlayed。
- `Mapping`：外部输入到内部 command 的映射规则。

这样以后 OSC 可以只是一个 adapter：

```text
OSC message
  -> parse address and arguments
  -> validate mapping
  -> internal command
  -> update state / schedule playback
```

不要让业务逻辑直接依赖 OSC 地址。内部代码应该关心 `setTempo(80)`，而不是到处判断 `/practice/tempo`。

## 第一阶段建议

第一阶段可以不实现 OSC，优先级低于：

- MIDI 输入输出。
- 谱面渲染。
- 和弦/伴奏数据结构。
- 播放时间轴。
- 练习循环和变速。

但可以做两件准备：

- 命令层设计时保留外部控制入口。
- 练习控制命令使用清晰、稳定、可序列化的参数。

后续如果要加 OSC，建议先做很小的 MVP：

- UDP server 监听本机端口。
- 支持 `/transport/play`、`/transport/stop`、`/practice/tempo`。
- 提供日志面板显示收到的 OSC address、type tag、arguments。
- 对非法地址、参数类型错误、频率过高的消息做明确提示。
- 不在第一版支持通配地址和复杂 bundle 调度。

## 调试注意点

OSC 调试常见问题：

- 地址不一致：发送 `/track/1/vol`，接收端只监听 `/track/1/volume`。
- 参数类型不一致：发送 string `"0.75"`，接收端期望 float `0.75`。
- 端口或 IP 配错：发送到了错误网卡、错误端口或被防火墙拦截。
- UDP 丢包：高频传感器或 XY pad 数据可能丢失部分帧。
- 坐标范围不一致：控制器发 `0..1`，接收端期望 `0..127` 或 `-1..1`。
- 状态同步缺失：外部控制器发了命令，但 UI 没有收到状态回传。

建议实现调试日志：

```text
received /practice/tempo ,f 82.5
mapped to setTempo(82.5)
applied tempo = 82.5
```

这样比只显示“收到 OSC”更容易定位问题。

## 参考资料

- Open Sound Control 1.0 Specification：https://opensoundcontrol.stanford.edu/spec-1_0.html
- Open Sound Control 官方站点：https://opensoundcontrol.stanford.edu/
- NYU ITP Open Sound Control 介绍：https://itp.nyu.edu/networks/explanations/open-sound-control/
