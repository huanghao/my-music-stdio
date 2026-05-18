# MIDI 协议介绍

## MIDI 是什么

MIDI 是 Musical Instrument Digital Interface 的缩写，意思是“乐器数字接口”。它是一套让电子乐器、电脑、音序器、效果器、灯光控制器等设备互相通信的标准。

MIDI 传的不是声音，而是控制消息。它描述的是“演奏动作”和“设备控制”：

```text
按下哪个音？
力度多大？
什么时候松开？
切换成什么音色？
踏板有没有踩下？
弯音轮移动了多少？
当前速度是多少？
```

最重要的一点是：MIDI 把“演奏指令”和“声音结果”分开了。同一段 MIDI 数据可以驱动钢琴音源、合成器音源、管弦乐音源或鼓机，最终声音由接收端的音源决定。

## 先理解几个基础概念

在进入协议细节前，先把常见词说明清楚。

| 概念 | 含义 |
| --- | --- |
| message | 一条 MIDI 消息，例如 Note On、Program Change、Control Change。 |
| event | 带有发生时间的 MIDI 消息。实时 MIDI 中事件就是“现在发出一条消息”；MIDI 文件中事件会带 delta time。 |
| note | 音高编号。MIDI 1.0 里常见范围是 0-127，常见约定中 60 是 C4，69 是 A4。 |
| velocity | 触发音符时的力度值，常见范围是 0-127。它不是绝对音量，但音源通常会把它映射成音量、音色亮度或采样层。 |
| channel | 通道。MIDI 1.0 一个端口有 16 个通道，常用来区分不同乐器或声部。 |
| controller / CC | Control Change 控制器，用编号和值控制踏板、音量、声像、表情等参数。 |
| program | 音色或预设编号。Program Change 用来告诉音源切换到哪个 program。 |
| tick | MIDI 文件或音序器里的时间刻度，不是秒。tick 要结合 PPQ 和 tempo 才能换算成真实时间。 |
| tempo | 速度，通常用 BPM 表示。120 BPM 表示每分钟 120 个四分音符。 |
| PPQ | pulses per quarter note，也叫 ticks per quarter note，表示一个四分音符被分成多少个 tick。 |

## 一个音符的时长在哪里

实时 MIDI 消息本身通常不带“这个音持续多久”的字段。音符时长由 Note On 和 Note Off 之间的时间差决定。

实时演奏时：

```text
现在：按下琴键 -> 发送 Note On
过一会儿：松开琴键 -> 发送 Note Off
```

MIDI 文件中，事件会带时间信息。比如：

```text
delta 0:   Note On   channel 1, note 60, velocity 90
delta 480: Note Off  channel 1, note 60, velocity 0
```

如果这个文件的 PPQ 是 480，那么 480 tick 就是一个四分音符。若 tempo 是 120 BPM，一个四分音符是 0.5 秒，所以这个音持续 0.5 秒。若 tempo 改成 60 BPM，同样 480 tick 会持续 1 秒。

所以 MIDI 音符时长不是写在 Note On 里，而是由时间轴上的 Note On 和 Note Off 的距离决定。

## MIDI 是数字音乐的基础吗

MIDI 是数字音乐领域最重要、最著名的标准之一，但数字音乐不只有 MIDI。

数字音乐大致有几类基础表示：

- 音频采样：把真实声音记录成波形，例如 WAV、AIFF、FLAC、MP3、AAC。
- 事件控制：记录演奏和控制事件，MIDI 是这个方向最有代表性的标准。
- 谱面记谱：记录给人看的乐谱，例如 MusicXML、MEI、LilyPond。
- 插件和音频处理接口：让软件音源、效果器和宿主软件协作，例如 VST、Audio Units、AAX、LV2。详见 [音频插件格式介绍](audio-plugin-formats-research.md)。
- 同步和工程交换：让设备、软件和工程文件协同，例如 SMPTE timecode、Ableton Link、AAF、OMF。详见 [音视频同步与工程交换标准介绍](timecode-sync-research.md)。

MIDI 的地位在于：它用很小、很稳定、很通用的消息格式，把“演奏控制”从“声音结果”里分离出来。这使得一段演奏可以被编辑、量化、换音色、变速、重新编曲，并能在不同设备之间传递。

## 音色是怎么表达的

MIDI 本身不保存真实音色。它表达音色主要靠三类信息：

### Program Change

Program Change 告诉音源切换到某个 program，也就是某个音色或预设。

```text
Program Change: channel 1, program 1
```

如果接收端遵守 General MIDI，那么 program 1 通常是 Acoustic Grand Piano。如果接收端是某个合成器，program 1 可能是它自己的第一个预设，未必是钢琴。

### Bank Select

MIDI 1.0 的 program number 只有 0-127。大型音源有远超 128 个音色，于是常用 Bank Select 选择音色库，再用 Program Change 选择库里的具体音色。

常见组合是：

```text
CC 0: Bank Select MSB
CC 32: Bank Select LSB
Program Change: program number
```

### SysEx 和插件参数

厂商自定义音色、合成器参数、采样器设置常用 SysEx 或插件自己的参数系统表达。也就是说，MIDI 可以触发音色和切换预设，但“这个钢琴到底是什么采样、滤波器怎么设、混响多少”通常属于音源或插件内部。

## MIDI、音频、乐谱的区别

同一段音乐可以有三种完全不同的表达：

```text
乐谱：第一小节有一个四分音符 C
MIDI：第 0 tick 发送 Note On，note=60，velocity=90；第 480 tick 发送 Note Off
音频：扬声器里播放出来的一段声音波形
```

区别是：

- 乐谱面向人，强调可读性、声部、指法、连线、段落和排版。
- MIDI 面向设备，强调事件、时间、通道和控制参数。
- 音频面向听觉结果，记录最终声音波形。

MIDI 文件通常远小于音频文件，因为它只保存事件列表，不保存声音本身。但也因为它不保存声音，所以播放效果依赖音源。

## MIDI 协议、传输、文件和兼容约定

讨论 MIDI 时要区分四个层面：

### MIDI 消息

这是 MIDI 的核心语言，例如 Note On、Note Off、Control Change、Program Change、Pitch Bend。消息说明设备之间传什么。

### MIDI 传输

同样的 MIDI 消息可以通过不同介质传输：

- 传统 5-pin DIN MIDI 线。
- USB-MIDI。
- Bluetooth MIDI。
- Network MIDI。
- 设备或软件内部的虚拟 MIDI 端口。

MIDI 标准当然关心传输方式，但传输方式通常不改变“消息语义”。Note On 通过 DIN 线、USB 或蓝牙发送，含义仍然是 Note On。

传输方式主要影响：

- 延迟：蓝牙和网络通常比本机虚拟端口更不稳定。
- 带宽：传统 DIN MIDI 速度低，密集控制数据可能拥堵；USB-MIDI 带宽更宽。
- 抖动：事件到达时间不稳定会影响节奏手感。
- 连接形态：硬件线缆、电脑 USB、移动设备蓝牙、软件内部路由的使用场景不同。

所以传输不是 MIDI 的竞争者，而是承载 MIDI 消息的不同道路。

### Standard MIDI File

`.mid` 文件不是实时传输协议，而是把 MIDI 事件按时间保存到文件里。它用于保存、交换、播放和编辑 MIDI 序列。

这里强调“不是实时传输协议”，是为了避免把两件事混在一起：

- 实时 MIDI：键盘按下时立刻发消息，适合演奏和设备控制。
- MIDI 文件：把一组事件和时间关系保存下来，适合回放和编辑。

它们不竞争，而是同一套 MIDI 消息的两种使用方式。

### General MIDI

General MIDI 不是传输协议，也不是文件格式，而是一套播放兼容约定。它规定音色编号、鼓通道、最低复音数等规则，让同一个 MIDI 文件在不同设备上播放时至少有可预期的乐器分配。详见 [General MIDI 介绍](general-midi-research.md)。

例子：

```text
如果 MIDI 文件在 channel 1 发送 Program Change 1，
General MIDI 设备应把它解释为 Acoustic Grand Piano。

如果 MIDI 文件在 channel 10 发送 note 38，
General MIDI 设备应把它解释为 Acoustic Snare。
```

如果没有 General MIDI，同一个文件在 A 设备上可能是钢琴，在 B 设备上可能变成合成器音效。

## MIDI 版本简史

### MIDI 1.0

MIDI 1.0 在 1980 年代初形成并发布，是至今最广泛兼容的 MIDI 基础。大量硬件合成器、电子琴、音频接口、DAW 和插件仍然支持 MIDI 1.0。

它没有废弃。理解 MIDI 时，MIDI 1.0 仍然是必须掌握的核心。

### General MIDI

General MIDI 出现在 MIDI 1.0 之后，目标是解决 MIDI 文件跨设备播放时音色不一致的问题。它不替代 MIDI 1.0，而是在 MIDI 1.0 消息之上加兼容约定。

### MIDI 2.0

MIDI 2.0 是现代扩展，目标是更高分辨率、更好的设备能力协商和更丰富的表达。它不是简单替代 MIDI 1.0，而是与 MIDI 1.0 共存，并通过 Universal MIDI Packet 统一承载 MIDI 1.0 和 MIDI 2.0 消息。

## MIDI 1.0 的字节结构

MIDI 1.0 的核心消息通常由 status byte 和 data byte 组成。

- status byte：状态字节，最高位是 1，用来说明消息类型。
- data byte：数据字节，最高位是 0，用来携带参数。

因为 data byte 只有 7 个有效位，所以很多 MIDI 1.0 参数范围是 `0-127`。这就是为什么 velocity、controller value、program number 等经常是 128 档。

128 档在很多场景够用，例如普通按键力度、开关踏板、简单音量控制。但对连续表情来说可能不够细，例如滤波器扫频、弦乐渐强、管乐气息变化，可能出现台阶感。MIDI 2.0 和一些 MIDI 1.0 扩展就是为了解决这类精度问题。

一个常见 MIDI 1.0 通道消息是 2 到 3 个字节：

```text
status byte + data byte 1 + data byte 2
```

例如 Note On：

```text
0x90 0x3C 0x5A
```

含义：

- `0x90`：Note On，channel 1。
- `0x3C`：note number 60。
- `0x5A`：velocity 90。

MIDI 通道编号在底层通常是 `0-15`，用户界面里常显示为 channel 1 到 channel 16。

## MIDI 1.0 常见消息类型

MIDI 1.0 消息可以粗略分为 Channel Voice、Channel Mode、System Common、System Real-Time、System Exclusive 等类别。初学最常用的是 Channel Voice 消息。

常见 Channel Voice 消息：

| 消息 | 常见用途 | 数据 |
| --- | --- | --- |
| Note Off | 松开音符 | note number, release velocity |
| Note On | 按下音符 | note number, velocity |
| Polyphonic Key Pressure | 单个音符的按后压力 | note number, pressure |
| Control Change | 控制踏板、音量、表情、声像等 | controller number, value |
| Program Change | 切换音色或预设 | program number |
| Channel Pressure | 整个通道的按后压力 | pressure |
| Pitch Bend Change | 连续弯音 | 14-bit bend value |

常见 System 消息：

| 消息 | 常见用途 |
| --- | --- |
| System Exclusive | 厂商或设备专用数据 |
| MIDI Time Code Quarter Frame | 时间码同步 |
| Song Position Pointer | 歌曲播放位置 |
| MIDI Clock | 节拍同步 |
| Start / Continue / Stop | 控制外部设备播放 |
| Active Sensing | 检测连接是否仍然存在 |
| System Reset | 系统复位 |

## 16 个通道

MIDI 1.0 的通道消息有 16 个 channel。可以把 channel 理解成 16 条逻辑控制线。

例子：

- channel 1 控制钢琴。
- channel 2 控制贝斯。
- channel 10 控制鼓。
- channel 11 控制弦乐。

同一根 MIDI 线或同一个 MIDI 文件里，可以混合多个 channel 的消息。接收设备根据 channel 决定哪个声部响应。

通道解决的是“同一批消息里，哪些属于哪个乐器或声部”。它不是音频声道，不等于左声道/右声道。

复杂编曲可以通过多个 MIDI 端口、多个插件实例、DAW 内部轨道、MIDI 2.0、MPE 或直接使用音频轨道来绕开 16 通道限制。现代 DAW 里“轨道数很多”并不等于“一个 MIDI 端口里有无限通道”，DAW 可以在内部把不同轨道分配给不同插件或不同虚拟端口。

## 常见 MIDI 消息

### Note On / Note Off

Note On 表示按下一个音，Note Off 表示松开一个音。

```text
Note On:  channel, note number, velocity
Note Off: channel, note number, release velocity
```

note number 是音高编号。常见约定里：

- 60 是 C4。
- 61 是 C#4 / Db4。
- 69 是 A4，通常对应 440 Hz。

velocity 通常表示按键力度，不是音量本身。音源可以把 velocity 映射成音量、音色亮度、采样层或其他表现。

对钢琴和鼓，velocity 很自然：键盘敲得更重，鼓垫打得更重。对小提琴、管乐、人声这类连续发声乐器，velocity 只能表达“起音”的力度，不能完整表达持续过程中的弓压、气息、揉弦和渐强。通常需要再配合 CC 1、CC 11、aftertouch、pitch bend、MPE 或音源专用控制来模拟连续表情。

也就是说，MIDI 的 note 是离散的，但连续乐器的表现可以由“note + 连续控制数据”共同表达。

### Program Change

Program Change 用来切换音色或预设。

```text
Program Change: channel, program number
```

如果音源遵守 General MIDI，那么 program number 会对应一套标准乐器表，例如钢琴、吉他、贝斯、弦乐、铜管等。如果音源不遵守 General MIDI，program number 只是这个设备自己的预设编号。

例如：

```text
Program Change 1  -> General MIDI 中通常表示 Acoustic Grand Piano
Program Change 25 -> General MIDI 中通常表示 Acoustic Guitar (nylon)
Program Change 41 -> General MIDI 中通常表示 Violin
```

注意不同文档有时用 1-128 显示 program 编号，底层数据常是 0-127。所以界面里的 program 1 在字节里可能是数值 0。

### Control Change

Control Change 简称 CC，用来控制连续或开关参数。

常见例子：

| CC | 名称 | 作用 |
| --- | --- | --- |
| CC 0 | Bank Select MSB | 选择音色库的高位部分，常和 CC 32、Program Change 配合。 |
| CC 1 | Modulation Wheel | 调制轮，常被音源映射到颤音、滤波器、弦乐动态等。 |
| CC 7 | Channel Volume | 通道音量，适合设定这个声部的整体音量。 |
| CC 10 | Pan | 声像位置，决定声音偏左、居中或偏右。 |
| CC 11 | Expression | 表情控制，常用于在既定音量下做渐强渐弱。 |
| CC 32 | Bank Select LSB | 选择音色库的低位部分。 |
| CC 64 | Sustain Pedal | 延音踏板，钢琴中常用；0 通常表示松开，127 通常表示踩下。 |
| CC 91 | Reverb Send | 混响发送量，控制送入混响的多少。 |
| CC 93 | Chorus Send | 合唱效果发送量。 |
| CC 120 | All Sound Off | 关闭所有声音。 |
| CC 123 | All Notes Off | 关闭当前通道所有音符。 |

Control Change 的值通常是 `0-127`。有些 CC 是连续控制，有些是开关控制，有些只是约定俗成；具体如何响应仍取决于音源。

### Pitch Bend

Pitch Bend 用来连续改变音高，常见于弯音轮、吉他推弦、合成器滑音。

Pitch Bend 在 MIDI 1.0 中通常使用 14-bit 数值，比普通 CC 的 7-bit 更细。中心值表示不弯音，向上或向下偏移表示升高或降低音高。

`pitch bend range` 指“弯音轮推到最大时，音高最多变化多少”。它由接收端音源设置，常见范围是上下 2 个半音，也可能设置成 12 个半音或更大。

例子：

```text
同样的最大 Pitch Bend：
range = 2 semitones  -> 最多升高或降低 2 个半音
range = 12 semitones -> 最多升高或降低 12 个半音
```

所以 MIDI 发送的是弯音位置，不直接说明“升高几个半音”；实际半音数由 pitch bend range 决定。

### Aftertouch

Aftertouch 表示按键按下后继续施加的压力。

有两类：

- Channel Pressure：整个 channel 一个压力值。
- Polyphonic Key Pressure：每个音符独立压力值。

很多键盘只支持 Channel Pressure，Polyphonic Key Pressure 更少见，但表达能力更强。

### System Exclusive

System Exclusive 简称 SysEx，用于厂商或设备专用消息。

它可以传普通通道消息表达不了的数据，例如：

- 合成器音色参数。
- 设备固件或配置。
- 采样器数据。
- 厂商私有控制命令。

SysEx 很强大，但也意味着兼容性取决于具体设备。

## 时间：实时 MIDI 和 MIDI 文件不同

实时 MIDI 发送的是“现在发生了什么”。如果你按下键盘，设备立刻发 Note On；松手时立刻发 Note Off。

MIDI 文件里还需要保存“什么时候发生”。Standard MIDI File 使用 delta time 表示事件之间的时间间隔，常配合 PPQ，也就是 pulses per quarter note / ticks per quarter note。

PPQ 表示一个四分音符被分成多少个 tick。PPQ 越高，文件能表达的节奏位置越细。

例如：

```text
PPQ = 480
delta 0:   Note On C4
delta 480: Note Off C4
```

这表示 C4 持续一个四分音符。实际秒数还要结合 tempo：

```text
120 BPM: 一个四分音符 = 0.5 秒
60 BPM:  一个四分音符 = 1 秒
```

## Standard MIDI File

Standard MIDI File 通常扩展名是 `.mid` 或 `.midi`。它把 MIDI 事件、时间信息和一些 meta event 存成文件。

常见文件类型：

- Type 0：所有事件放在一个 track。
- Type 1：多个同步 track，最常见，适合多乐器编曲。
- Type 2：多个相互独立的 sequence，标准里有但很少见。

MIDI 文件里的 meta event 可以保存一些不属于实时 MIDI 传输消息的信息，例如：

- tempo。
- time signature。
- key signature。
- track name。
- lyric。
- marker。
- end of track。

注意：MIDI 文件可以有 tempo 和拍号，但这仍然不等于完整乐谱。它一般不知道某个音在谱面上应该写成 C# 还是 Db，也不知道复杂指法、版式和教学标注。

## General MIDI

早期 MIDI 只规定“发送 program change”，但没有统一规定“program 1 一定是什么乐器”。这导致同一份 MIDI 文件在不同设备上可能一个播放钢琴，另一个播放奇怪音色。

General MIDI 解决的是最基本的播放兼容问题。它约定：

- 一套标准 program/instrument 映射。
- 至少 16 个通道。
- 至少 24 个同时发声能力。
- channel 10 通常用于打击乐。
- 鼓音色按不同 note number 触发不同鼓件。

“16 个通道”和“24 个同时发声能力”不是一回事：

- 16 个通道是控制分组数量，表示最多 16 组逻辑声部。
- 24 个同时发声能力是 polyphony，表示同一时刻至少能响 24 个音。

例如钢琴一个 channel 就可能同时弹 10 个音；弦乐、Pad 和延音踏板也会让多个音同时保持。所以 General MIDI 要求设备不只是能接收 16 个通道，还要至少能同时发出一定数量的声音。

channel 10 用于打击乐，是 General MIDI 为了兼容播放做的约定。旋律乐器通常一个 channel 对应一个乐器音色，而鼓组不同：一套鼓里有底鼓、军鼓、踩镲、吊镲、通鼓等很多鼓件。如果每个鼓件都占一个 channel 会很浪费。因此 General MIDI 约定 channel 10 是 rhythm channel，在这个通道里用不同 note number 触发不同鼓件。

常见例子：

```text
note 35 / 36: Bass Drum
note 38: Acoustic Snare
note 42: Closed Hi-Hat
note 46: Open Hi-Hat
note 49: Crash Cymbal
```

General MIDI 的目标不是让所有设备听起来一样，而是让同一个 MIDI 文件在不同设备上至少有可预期的乐器分配。

## MIDI 的优点

- 文件小：保存事件，不保存声音波形。
- 可编辑：音高、时值、力度、音色都能改。
- 可换音色：同一段演奏可以换不同音源。
- 可实时：适合键盘、控制器、鼓垫、脚踏板等实时输入。
- 跨设备：几十年来大量硬件和软件都支持。
- 稳定：MIDI 1.0 长期保持兼容，是电子音乐设备互联的共同语言。

## MIDI 的缺点

### 不保存声音本身

MIDI 文件没有真实音频。播放效果取决于音源和采样库。同一个 `.mid` 文件，在高质量钢琴音源和廉价系统音源上会完全不同。

### 7-bit 分辨率有限

MIDI 1.0 很多控制值只有 `0-127`。对音量、滤波器、表情控制这类连续参数来说，128 档有时会出现不够细、变化有台阶的问题。

Pitch Bend 用 14-bit 缓解了弯音精度问题，但普通 CC 仍然受 7-bit 限制。

### 表情模型偏键盘

MIDI 最初服务电子乐器互联，很多设计天然贴近键盘演奏：note on、note off、velocity、channel。对弦乐、管乐、吉他、声乐等连续音高和复杂发音方式，需要额外控制器、技巧映射或厂商扩展。

### 通道数量有限

MIDI 1.0 每个端口只有 16 个 channel。复杂编曲、MPE、多乐器细分控制会很快遇到通道压力。

常见解决方式：

- 使用多个 MIDI 端口，每个端口各有 16 个通道。
- 在 DAW 内部用多个插件实例，每个实例接收自己的 MIDI 轨道。
- 对表达型控制器使用 MPE，把一个音分配到一个通道以获得独立弯音和表情控制。
- 使用 MIDI 2.0，获得更现代的消息和能力协商。
- 最终混音阶段转成音频轨道，减少 MIDI 路由复杂度。

### 谱面语义弱

MIDI 知道“音什么时候响”，但不知道完整乐谱含义。它通常不能可靠表达：

- 音符拼写，例如 C# 还是 Db。
- 声部归属。
- 指法。
- 连线和乐句。
- 和弦功能分析。
- 乐谱排版。

所以 MIDI 文件导入乐谱软件后，经常需要重新量化、拆声部、修谱。

### 兼容性依赖约定

MIDI 协议本身很通用，但具体含义常依赖设备约定：

- 某个 Program Change 对应什么音色。
- 某个 CC 控制什么参数。
- SysEx 怎么解释。
- Pitch Bend 范围是多少。

General MIDI 解决了一部分兼容性问题，但不能覆盖所有设备和音源。

## MIDI 2.0 解决什么

MIDI 2.0 是 MIDI 1.0 的扩展，不是简单替代。它保留 MIDI 的核心语义，例如 note、controller、program change，同时提升精度、表达能力和设备协商能力。

### Universal MIDI Packet

MIDI 2.0 使用 Universal MIDI Packet，简称 UMP。UMP 用固定 32-bit 倍数的 packet 承载不同类型的 MIDI 数据，包括 MIDI 1.0 Channel Voice 和 MIDI 2.0 Channel Voice。

它的意义是：现代系统可以用统一 packet 结构处理旧消息和新消息，而不是为每一种传输方式重新定义一套表达。

### 更高分辨率

MIDI 1.0 很多值是 7-bit，也就是 0-127。MIDI 2.0 把很多控制提升到更高精度，适合连续表情控制。

这对弦乐、管乐、合成器滤波、动态控制很重要，因为这些参数不是简单开关，而是持续变化的曲线。

### Per-note control

MIDI 1.0 里很多控制是 channel 级的，比如一个 channel 的 pitch bend 会影响这个 channel 上所有正在响的音。MIDI 2.0 更强调 per-note control，即对单个音符做独立控制。

这对 MPE 类控制器、吉他弦独立弯音、复音表情、现代合成器很有意义。

### MIDI-CI

MIDI-CI 是 MIDI Capability Inquiry，意思是能力查询。设备之间可以互相询问：

```text
你支持 MIDI 2.0 吗？
你支持哪些 Profile？
你有哪些可交换属性？
你能不能切换到某种控制模式？
```

这比 MIDI 1.0 时代“只能假设对方怎么解释消息”更可靠。

### Profiles

Profile 是一类设备或使用场景的行为约定。例如某类控制器、混音器、风琴 drawbar、MPE 设备可以通过 Profile 让发送端和接收端对控制含义达成一致。

它解决的是“同一个 CC 在不同设备上含义不一致”的问题。

### Property Exchange

Property Exchange 允许设备交换更丰富的信息，例如设备名称、参数列表、当前配置、可用功能等。

这对软件自动识别硬件、生成控制界面、保存工程配置很有帮助。

### MIDI 2.0 的现实状态

MIDI 2.0 是方向，但 MIDI 1.0 仍然非常重要。原因是：

- MIDI 1.0 设备存量巨大。
- 很多场景 7-bit 控制已经够用。
- MIDI 2.0 需要操作系统、硬件、DAW、插件和控制器共同支持。

因此学习顺序应该是：先理解 MIDI 1.0 的消息、通道、文件和 GM，再理解 MIDI 2.0 如何补它的短板。

## 和 MIDI 一样重要的数字音乐标准

MIDI 在“演奏控制协议”里非常著名。数字音乐领域还有一些同样重要但解决不同问题的标准或事实标准：

- WAV / AIFF：无压缩或近似原始的 PCM 音频文件容器。
- MP3 / AAC / Opus：有损音频编码，面向分发和流媒体。
- FLAC / ALAC：无损音频压缩。
- MusicXML：乐谱交换格式，面向谱面软件。
- General MIDI：MIDI 播放兼容约定。详见 [General MIDI 介绍](general-midi-research.md)。
- VST / Audio Units / AAX / LV2：软件乐器和效果器插件接口。详见 [音频插件格式介绍](audio-plugin-formats-research.md)。
- ASIO / Core Audio / WASAPI / JACK：音频驱动和低延迟音频接口。详见 [低延迟音频接口介绍](audio-driver-low-latency-research.md)。
- OSC：Open Sound Control，常用于现代媒体艺术、控制器和网络控制。详见 [OSC 协议介绍](osc-research.md)。
- SMPTE timecode / MTC：音视频同步相关标准。详见 [音视频同步与工程交换标准介绍](timecode-sync-research.md)。

这些标准不是互相替代，而是分别覆盖声音、演奏控制、谱面、插件、驱动和同步。

## 相关开源软件

MIDI 生态里有很多著名开源软件，覆盖乐谱、音序、合成器、伴奏、路由和开发库。详见 [MIDI 相关开源软件介绍](midi-open-source-software.md)。

## 总结

MIDI 的核心思想很简单：把音乐演奏抽象成一串可传输、可编辑、可播放的数字事件。

它的强项是控制和互联，不是保存声音，也不是完整记谱。理解 MIDI 时要分清：

- MIDI 消息：实时控制语言。
- MIDI 传输：消息通过什么介质传。
- MIDI 文件：消息和时间如何保存。
- General MIDI：音色和鼓件如何约定。
- MIDI 2.0：如何在保持兼容的基础上提升精度和表达能力。

## 参考资料

- MIDI Association Specs：https://midi.org/specs
- MIDI 1.0 Core Specifications：https://midi.org/midi-1-0-core-specifications
- Standard MIDI Files：https://midi.org/about-midi-part-4midi-files
- MIDI 2.0 overview and update：https://midi.org/the-state-of-midi-2-0-high-resolution-performance-and-the-rise-of-profiles-update-feb-2026
