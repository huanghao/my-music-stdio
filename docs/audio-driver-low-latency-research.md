# 低延迟音频接口介绍

## 先说本质

低延迟音频接口解决的是“音频数据怎样在硬件和软件之间稳定、及时地来回流动”。

它和 MIDI 不同：

- MIDI 传的是事件：按下哪个音、力度多少、控制器多少。
- 音频接口传的是连续音频采样：每秒 44100 或 48000 个 sample。

实时虚拟乐器的完整链路通常是：

```text
MIDI 键盘
  -> MIDI event
  -> DAW / 插件生成 audio samples
  -> audio driver
  -> audio interface / sound card
  -> speaker / headphones
```

即使 MIDI 很快，如果音频驱动和 buffer 设置不好，听到声音仍然会慢。

## 延迟到底从哪里来

音频软件不会一个 sample 一个 sample 地和声卡来回通信，而是一块一块处理。这个块叫 audio buffer。

例子：

```text
sample rate = 48000 Hz
buffer size = 256 samples

单个 buffer 的时长 = 256 / 48000 = 5.33 ms
```

实际往返延迟通常包括：

- 输入 buffer。
- DAW / 插件处理时间。
- 输出 buffer。
- 声卡硬件转换延迟。
- 系统调度和安全缓冲。

所以看到 buffer 是 5.33 ms，不代表总延迟就是 5.33 ms。实际 round-trip latency 可能是十几毫秒或更多。

## Buffer Size 的取舍

buffer 越小：

- 延迟越低。
- CPU 压力越大。
- 更容易爆音、卡顿、dropout。

buffer 越大：

- 延迟越高。
- 系统更稳定。
- 更适合混音、母带、离线渲染。

常见经验：

| 场景 | buffer 倾向 |
| --- | --- |
| 实时弹虚拟乐器 | 64 / 128 samples |
| 普通录音监听 | 128 / 256 samples |
| 大工程混音 | 512 / 1024 samples |
| 离线导出 | 延迟不敏感 |

低延迟音频接口的重点就是让系统在较小 buffer 下仍然稳定运行。

## 普通系统音频为什么不够用

普通桌面系统音频通常优先保证：

- 多个应用可以同时发声。
- 系统音量和设备切换方便。
- 蓝牙、浏览器、播放器、会议软件都能工作。
- 不轻易因为某个应用卡顿而崩溃。

这些目标和专业音频的目标不同。专业音频更关心：

- 延迟低。
- 抖动小。
- buffer 调度稳定。
- 多输入/多输出。
- 采样率和设备时钟可控。
- 和 DAW / 插件实时线程配合好。

ASIO、Core Audio、WASAPI exclusive、JACK 等接口，就是为了解决专业音频路径和普通系统混音路径之间的差异。

## ASIO

ASIO 是 Steinberg 推出的低延迟音频驱动协议，Windows 专业音频制作中非常常见。

本质：

- ASIO 让 DAW 直接和声卡厂商的专用驱动交换音频 buffer。
- 它绕过一部分普通 Windows 系统混音路径。
- 它通常提供更低、更稳定的延迟。

典型场景：

```text
DAW -> ASIO driver -> audio interface
```

优点：

- Windows 上专业音频事实标准之一。
- 多输入/多输出支持好。
- 延迟通常比普通共享系统音频低。

缺点：

- 依赖声卡厂商驱动质量。
- 一个 ASIO 设备常被一个专业音频应用独占。
- 没有好声卡时，用户可能会用 ASIO4ALL 这类兼容层，但它不等于真正厂商 ASIO 驱动。

## Core Audio

Core Audio 是 Apple 平台的音频系统，不只是一个驱动 API，而是一整套音频架构。

本质：

- macOS / iOS 原生音频系统。
- 提供低延迟音频 I/O、设备管理、格式转换、Audio Units 等能力。
- DAW 和插件生态直接建立在 Core Audio 之上。

优点：

- 系统级集成好。
- 不需要像 Windows 那样经常安装厂商专用 ASIO 才能获得可用低延迟。
- 和 AU 插件、macOS 音频设备模型结合紧密。

缺点：

- 主要限于 Apple 平台。
- 跨平台软件仍要为 Windows/Linux 使用其他后端。

## WASAPI

WASAPI 是 Windows Audio Session API，是 Windows 原生音频接口。

它有两种重要模式：

- Shared mode：共享模式，多个应用可以同时通过系统混音器发声。
- Exclusive mode：独占模式，应用独占设备，减少系统混音路径带来的延迟和格式转换。

Shared mode 适合：

- 浏览器。
- 播放器。
- 会议软件。
- 普通应用声音。

Exclusive mode 更适合：

- 低延迟录音。
- bit-perfect 播放。
- 不想经过系统混音器的音频应用。

和 ASIO 的关系：

- WASAPI 是 Windows 原生接口。
- ASIO 是专业音频生态长期使用的低延迟接口。
- 现代应用可能同时支持 ASIO 和 WASAPI，让用户按设备和场景选择。

## JACK

JACK 是低延迟音频和 MIDI 路由服务器，在 Linux 专业音频生态中很重要。

本质：

- JACK 不只是“驱动接口”，更像一个实时音频连接中心。
- 多个应用可以作为 JACK client，把音频/MIDI 端口互相连接。

例子：

```text
MIDI sequencer -> software synth -> effect plugin host -> recorder
```

在 JACK 里，这些可以是不同进程，通过 JACK 的端口连接起来。

优点：

- 路由能力强。
- 适合复杂音频/MIDI 系统。
- Linux 专业音频工作流成熟。

缺点：

- 配置门槛高。
- 需要理解 sample rate、buffer、period、device、client、port。
- 现代 Linux 桌面上 PipeWire 正在接管很多普通用户场景，但 JACK 模型仍然很重要。

## PipeWire 和 JACK 的关系

PipeWire 是 Linux 上较新的多媒体服务器，目标是统一处理音频、视频、屏幕采集和应用权限。

对音乐制作来说，关键点是：

- PipeWire 可以提供 JACK 兼容层。
- 很多桌面系统逐渐默认使用 PipeWire。
- 专业音频用户仍需要关注延迟、buffer、路由和兼容性。

可以把 PipeWire 理解成更现代的系统级多媒体基础设施，而 JACK 是专业音频低延迟路由模型的经典方案。

## 它们和插件、MIDI 的关系

三者在链路里位置不同：

```text
MIDI event
  -> 插件生成或处理 audio buffer
  -> 音频接口把 buffer 送到硬件
```

| 层 | 负责什么 |
| --- | --- |
| MIDI | 演奏和控制事件 |
| 插件 | 生成或处理声音 |
| 音频接口/驱动 | 把连续音频 buffer 稳定送进送出硬件 |

如果弹虚拟钢琴觉得慢，可能原因有：

- MIDI 设备本身延迟。
- 插件采样库加载或处理太重。
- audio buffer 太大。
- 驱动路径不是低延迟路径。
- 蓝牙耳机或系统音频路径额外增加延迟。

## 怎么选

| 平台/场景 | 常见选择 |
| --- | --- |
| Windows 专业录音/制作 | ASIO，必要时 WASAPI exclusive |
| macOS / iOS | Core Audio |
| Linux 专业音频路由 | JACK 或 PipeWire JACK 兼容层 |
| 普通桌面播放 | 系统默认音频路径即可 |
| 实时演奏虚拟乐器 | 小 buffer + 稳定低延迟驱动 + 有线监听 |

## 参考资料

- Steinberg ASIO SDK：https://www.steinberg.net/developers/
- Apple Core Audio：https://developer.apple.com/documentation/coreaudio
- Microsoft WASAPI：https://learn.microsoft.com/en-us/windows/win32/coreaudio/wasapi
- JACK：https://jackaudio.org/
- PipeWire：https://pipewire.org/
