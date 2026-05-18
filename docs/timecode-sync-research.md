# 音视频同步与工程交换标准介绍

## 先说本质

同步标准解决的不是“声音怎么生成”，而是“多个系统怎样在同一时间位置上做同一件事”。

典型问题：

```text
视频播放到 01:12:03:10 时，
DAW 必须播放对应的对白、音效和配乐；
灯光控制台必须触发对应灯光；
另一台录音机必须知道自己也到了同一个时间位置。
```

这里要同步的可能是两类时间：

- 绝对时间位置：现在是第几小时、第几分钟、第几秒、第几帧。
- 音乐拍点位置：现在是第几小节、第几拍，tempo 是多少。

SMPTE timecode 和 MTC 主要解决绝对时间位置；MIDI Clock 和 Ableton Link 主要解决音乐拍点；AAF / OMF 解决工程数据交换，不是实时同步协议。

## Timecode vs Clock vs 工程交换

| 类型 | 回答的问题 | 典型用途 |
| --- | --- | --- |
| Timecode | 当前在时间线的哪个绝对位置？ | 影视后期、广播、录音棚同步 |
| Clock | 当前节拍速度和拍点在哪里？ | 鼓机、合成器、音序器同步 |
| 工程交换 | 这个工程的轨道、片段、剪辑位置怎么搬到另一个软件？ | DAW 之间交接工程 |

一个常见误区是把它们都叫“同步”。它们确实都和协同有关，但同步对象不同。

## SMPTE Timecode

SMPTE timecode 是影视和广播领域常见的时间码体系。它把时间线位置写成：

```text
hours:minutes:seconds:frames
01:23:45:12
```

含义是第 1 小时 23 分 45 秒第 12 帧。

它的核心不是“节拍”，而是“帧”。视频是按帧走的，所以音频、字幕、音效、灯光如果要和画面对齐，就需要知道当前是第几帧。

关键点：

- 它绑定帧率，例如 24 fps、25 fps、29.97 fps、30 fps。
- 它适合线性时间线，例如电影、电视剧、广告、广播。
- 它不关心音乐上的小节和拍。

例子：

```text
导演说爆炸声要在 00:12:18:06 出现。
音效师就按这个 timecode 把爆炸音频放到对应帧。
```

## MTC

MTC 是 MIDI Time Code。它的作用是把类似 SMPTE timecode 的时间位置通过 MIDI 消息传出去。

MTC 适合这种场景：

```text
主机：视频播放系统
从机：DAW、录音机、灯光系统

主机持续发送 MTC；
从机读取 MTC 后跳到相同时间位置并跟随播放。
```

MTC 不传音频，不传 MIDI 音符，也不传 tempo。它只告诉对方“现在时间线走到哪里了”。

MTC 和 MIDI Clock 的区别：

- MTC 是按小时、分钟、秒、帧同步。
- MIDI Clock 是按 tempo 和拍点同步。

如果做影视配乐，MTC 更自然；如果同步鼓机和合成器，MIDI Clock 更自然。

## MIDI Clock

MIDI Clock 是音乐设备之间常见的节拍同步方式。它让多台设备共享 tempo 和播放状态。

它通常配合这些消息：

- Timing Clock：持续发送节拍脉冲。
- Start：从头开始。
- Continue：从当前位置继续。
- Stop：停止。
- Song Position Pointer：告诉从设备播放位置。

MIDI Clock 的本质是“节拍脉冲”。MIDI 规范中每个四分音符有 24 个 clock pulse，所以设备可以根据脉冲速度推算 tempo。

例子：

```text
DAW 设置为 120 BPM，并发送 MIDI Clock。
鼓机收到 clock 后也按 120 BPM 播放 pattern。
当 DAW Stop，鼓机也停止。
```

局限：

- 它同步的是拍点，不是视频帧。
- 网络或接口抖动会影响稳定性。
- 复杂工程中还要处理开始位置、延迟补偿和设备响应时间。

## Ableton Link

Ableton Link 是现代音乐软件常用的网络节拍同步技术。它让同一局域网里的多个应用共享 tempo、beat 和 phase。

它和 MIDI Clock 的差异：

- Link 通常走网络，不依赖传统 MIDI 端口。
- Link 更强调多个设备平等协作，不一定有固定主从。
- Link 适合现场电子音乐、移动设备、多人 jam。

例子：

```text
一台电脑跑 Ableton Live；
一台 iPad 跑鼓机 app；
另一台电脑跑合成器 app。

它们加入同一个 Link session 后，共享 tempo 和拍点。
```

Link 不负责传音频，也不负责交换工程文件。它只解决“大家一起按同一速度和拍点运行”。

## AAF / OMF

AAF 和 OMF 是工程交换格式，不是实时同步协议。

它们要解决的问题是：

```text
剪辑师在视频剪辑软件里剪完片子；
声音团队需要把片段、时间线、剪辑位置带到 DAW 里继续做声音。
```

AAF / OMF 通常能携带：

- 轨道结构。
- 音频片段引用或嵌入音频。
- 剪辑开始和结束位置。
- 时间线位置。
- 部分淡入淡出和音量信息。

它们通常不能完整无损搬运：

- 插件链。
- 所有自动化细节。
- 所有软件专有参数。
- 虚拟乐器和 MIDI 工程语义。

所以 AAF / OMF 的本质是“工程交接格式”，不是“实时跟随播放”。

## 怎么选

| 场景 | 更合适的机制 |
| --- | --- |
| DAW 跟视频精确对帧 | SMPTE timecode / MTC |
| 鼓机和合成器跟 DAW tempo 走 | MIDI Clock |
| 多个音乐 app 在同一局域网 jam | Ableton Link |
| 从视频剪辑软件交给声音后期 | AAF / OMF |
| 多台设备共享开始/停止和节拍 | MIDI Clock 或 Link |
| 多台设备跟随绝对时间线 | MTC |

## 参考资料

- SMPTE：https://www.smpte.org/
- MIDI Association MIDI Time Code：https://midi.org/midi-time-code
- Ableton Link：https://www.ableton.com/link/
