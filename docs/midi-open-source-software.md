# MIDI 相关开源软件介绍

## 目标

这篇文档整理 MIDI 生态里常见、知名的开源软件和库，覆盖乐谱、DAW、音序器、软件合成器、MIDI 播放、MIDI 路由和开发库。

最后核对日期：2026-05-18。

说明：

- “流行程度”主要参考 GitHub stars、SourceForge 下载、发行版生态和音乐制作社区中的常见程度。
- “最后维护时间”优先看最新正式 release；没有清晰 release 的项目，看官网、源码仓库或发行版包维护状态。
- GitHub stars 和下载量会持续变化，下面只作为量级判断，不作为精确排名。

## 总览表

| 项目 | 类型 | 年代 | 主要语言 | 当前状态 | 最新版本/维护信息 | 流行程度 |
| --- | --- | --- | --- | --- | --- | --- |
| MuseScore Studio | 乐谱编辑器 | 2002 起步，1.0 在 2011 | C++ / Qt / QML | 活跃 | 4.6.x 系列，2025 年仍有 release | 非常流行，GitHub 约 14k+ stars |
| Ardour | DAW | 2005 首发 | C++ | 活跃 | 9.0 于 2026-02-05 发布 | Linux 专业音频核心项目，GitHub 镜像约 4k+ stars |
| LMMS | 音乐制作软件 / pattern sequencer | 2004 起步 | C++ / Qt | 开发仍在继续，但稳定版偏旧 | 1.2.2 于 2020 发布 | 入门电子音乐制作中知名，GitHub 约 8k+ stars |
| Rosegarden | MIDI sequencer + notation | 1990s 起源，2000 起进入 Rosegarden-4 | C++ / Qt | 仍维护 | 25.12 于 2025-12-03 发布 | Linux MIDI/notation 老牌项目，小众但长期存在 |
| FluidSynth | SoundFont 软件合成器 | 2000s 初 | C | 活跃 | 2.5.4 于 2026-04-19 发布 | MIDI 渲染基础设施级项目，GitHub 约 2k+ stars |
| TiMidity++ | MIDI 播放/转音频 | 原 TiMidity 1995，TiMidity++ 后续发展 | C | 上游偏旧，发行版仍打包维护 | SourceForge 项目 2024 有更新，发行版常见 2.15.x 包 | 经典老工具，现代新项目不建议优先选 |
| JACK | 低延迟音频/MIDI 路由 | 2000s | C / C++ | 仍重要，Linux 音频生态核心 | JACK2 持续在发行版和音频生态中使用 | Linux 专业音频基础设施 |
| RtMidi | 跨平台实时 MIDI I/O 库 | 2003 起 | C++ | 稳定维护，API 成熟 | 6.0.0 常见于包管理器 | C++ MIDI I/O 经典小库，GitHub 约 1k+ stars |
| Mido | Python MIDI 库 | 2010s | Python | 稳定维护 | 1.3.3 于 2024-10-25 发布 | Python MIDI 生态常用，GitHub 约 1k+ stars |
| JUCE | 音频应用/插件框架 | 2004 起 | C++ | 活跃 | 8.0.x 系列，2025 年仍有 release | 商业和开源音频开发都常见，GitHub 约 8k+ stars |

## MuseScore Studio

定位：

- 开源乐谱编辑软件。
- 重点是 notation、MusicXML、排版、播放和导入导出。
- MIDI 是它的输入/输出和播放能力之一，不是它的唯一核心。

年代和维护：

- MuseScore 的 release history 可以追溯到 2002 年的 0.0.x。
- 1.0 发布于 2011 年。
- 当前 4.x 系列仍活跃，GitHub release 页面显示 2025 年仍有 4.6.x release。

技术：

- 主要语言：C++。
- UI/框架：Qt / QML。
- 相关格式：MusicXML、MIDI、MuseScore 自有 `.mscz` / `.mscx`。

流行程度：

- GitHub 约 14k+ stars，属于开源乐谱软件里最主流的项目之一。
- 用户群远大于“纯 MIDI 工具”，更接近 Finale、Sibelius 的开源替代。

适合了解：

- MIDI 到乐谱转换为什么困难。
- 乐谱模型、MusicXML、MIDI 之间如何互转。
- 乐谱播放如何从 notation 生成 MIDI 或音频。

注意：

- MuseScore.com 的在线曲谱平台和 MuseScore Studio 这个开源桌面软件需要区分。
- 如果目标是研究 MIDI 协议细节，MuseScore 不是最直接的代码样本；如果目标是研究“乐谱如何播放”，它很有参考价值。

## Ardour

定位：

- 开源 DAW，覆盖录音、剪辑、MIDI、插件、混音、自动化等完整制作流程。
- 更接近 Pro Tools、Logic Pro、Cubase、Reaper 这一类工具。

年代和维护：

- Ardour 2005 年左右公开发布。
- 官方新闻显示 Ardour 9.0 于 2026-02-05 发布。
- 项目仍在活跃维护。

技术：

- 主要语言：C++。
- 生态：JACK、ALSA、Core Audio、插件、MIDI、音频路由。
- 平台：Linux、macOS、Windows。

流行程度：

- Linux 专业音频生态的核心 DAW。
- GitHub 上是源码镜像，stars 约 4k+，但它的真实用户和开发生态不只体现在 GitHub。

适合了解：

- DAW 中 MIDI 轨道和音频轨道如何共存。
- 插件如何接收 MIDI 并输出音频。
- MIDI 编辑器、piano roll、clip、automation 的工程组织方式。

注意：

- Ardour 很大，不适合作为“学习 MIDI 最小实现”的入口。
- 如果目标是做专业音频工作站架构，它非常值得研究。

## LMMS

定位：

- 开源音乐制作软件，偏 pattern-based workflow。
- 面向电子音乐、循环片段、piano roll、内置乐器和插件。

年代和维护：

- 项目起源通常追溯到 2004 年左右，最初叫 Linux MultiMedia Studio。
- 最新稳定版 1.2.2 发布于 2020-07-04。
- 稳定版偏旧，但 GitHub 开发仍有活动；社区长期讨论 1.3 / 新版本发布节奏较慢。

技术：

- 主要语言：C++。
- UI/框架：Qt。
- 支持 MIDI、内置合成器、pattern、piano roll。

流行程度：

- GitHub 约 8k+ stars。
- 在免费电子音乐制作入门工具里知名度较高。

适合了解：

- Piano roll 如何编辑 MIDI 音符。
- Pattern、song editor、instrument track 如何组织。
- MIDI 与内置软件乐器的关系。

注意：

- 稳定版 release cadence 慢。
- 如果要参考现代 DAW 架构，Ardour 更专业；如果要看入门级 pattern sequencer，LMMS 更直观。

## Rosegarden

定位：

- Linux 上的 MIDI sequencer + notation editor。
- 介于 DAW、MIDI 音序器和乐谱编辑器之间。

年代和维护：

- Rosegarden 2.1 早在 1997 年左右就已存在。
- Rosegarden-4 系列从 2000 年左右开始。
- 官网显示当前稳定版 25.12，发布时间为 2025-12-03。

技术：

- 主要语言：C++。
- UI/框架：Qt。
- 平台重点：Linux。

流行程度：

- 不像 MuseScore 和 Ardour 那样大众，但在 Linux MIDI/notation 生态里是老牌项目。
- SourceForge 下载量不大，说明它现在偏小众。

适合了解：

- MIDI sequencer 和 notation 如何结合。
- Linux MIDI 工作流。
- 老式 MIDI 编曲软件的交互模型。

注意：

- 对 Windows/macOS 用户不友好。
- UI 和工作流相对传统。

## FluidSynth

定位：

- 基于 SoundFont 2 的开源软件合成器。
- 它把 MIDI 事件渲染成音频。

典型链路：

```text
MIDI file / MIDI input
  -> FluidSynth
  -> SoundFont
  -> audio output
```

年代和维护：

- 项目在 2000s 初发展起来。
- 官网和 GitHub 显示 2.5.x 系列仍活跃，2.5.4 于 2026-04-19 发布。

技术：

- 主要语言：C。
- 支持 SoundFont 2。
- 可作为命令行工具，也可作为库嵌入其他程序。

流行程度：

- GitHub 约 2k+ stars。
- 在“把 MIDI 播放成声音”这个领域非常基础，很多软件会直接或间接用它。

适合了解：

- MIDI 本身不发声，音源负责发声。
- General MIDI / SoundFont 播放链路。
- 软件合成器如何作为库集成。

注意：

- FluidSynth 的重点不是编辑 MIDI，而是渲染 MIDI。
- 声音质量很大程度取决于 SoundFont。

## TiMidity++

定位：

- 经典 MIDI 播放器和 MIDI-to-WAV 转换器。
- 可以用 patch 文件或 SoundFont 把 MIDI 渲染成 PCM 音频。

年代和维护：

- 原 TiMidity 可追溯到 1995。
- TiMidity++ 是后续继续发展的分支。
- 官方网站很老，传统上游 release 偏旧；SourceForge 页面显示项目仍有维护记录，发行版也仍有打包，例如 Fedora / SUSE 等仍能看到 2.15.x 包。

技术：

- 主要语言：C。
- 支持多种输出和前端。

流行程度：

- 历史影响很大，是很多 Linux 用户早期播放 MIDI 的常见选择。
- 现代新项目更常选择 FluidSynth 或平台自带/插件音源。

适合了解：

- 早期软件 MIDI 播放方式。
- MIDI 转 WAV。
- SoundFont / patch-based MIDI 渲染。

注意：

- 不建议作为新项目首选依赖。
- 如果只是为了现代、可维护的 MIDI 渲染，优先看 FluidSynth。

## JACK

定位：

- JACK 是低延迟音频和 MIDI 路由系统。
- 它不是 MIDI 文件库，也不是合成器，而是把音频/MIDI 应用连接起来的基础设施。

典型场景：

```text
MIDI keyboard -> sequencer -> synth -> effects -> recorder
```

JACK 可以让这些软件之间建立实时连接。

技术：

- 主要语言：C / C++。
- 重点平台：Linux，也支持其他平台。
- 常见工具：QjackCtl、Carla、Ardour。

流行程度：

- Linux 专业音频生态里的基础设施级项目。
- 即使 PipeWire 越来越普及，JACK 的模型仍然很重要，PipeWire 也提供 JACK 兼容层。

适合了解：

- 实时音频/MIDI 路由。
- Linux 专业音频应用如何互联。
- 低延迟音频系统为什么复杂。

注意：

- JACK 解决的是路由和实时性，不解决 MIDI 文件解析。
- 对初学者配置门槛偏高。

## RtMidi

定位：

- 跨平台 C++ 实时 MIDI 输入输出库。
- 提供 `RtMidiIn` 和 `RtMidiOut`，封装 Linux、macOS、Windows 的底层 MIDI API。

年代和维护：

- 项目由 Gary P. Scavone 开发，文档中提到 2003-2023。
- 常见包管理器版本为 6.0.0。

技术：

- 主要语言：C++。
- 设计目标：小、简单、跨平台。
- 支持 ALSA、JACK、CoreMIDI、Windows Multimedia、Web MIDI、iOS、Android 等。

流行程度：

- GitHub 约 1k+ stars。
- 很多 C++ 音乐工具、小型 MIDI 项目会使用或参考它。

适合了解：

- 程序如何枚举 MIDI 端口。
- 程序如何收发实时 MIDI 消息。
- 跨平台 MIDI I/O 如何封装。

注意：

- RtMidi 不负责 MIDI 文件解析。
- RtMidi 不做调度器；输出消息通常立即发送，时间控制要由调用方处理。

## Mido

定位：

- Python MIDI 库。
- 适合读取、写入、创建、播放 MIDI 文件，也能通过后端连接 MIDI 端口。

年代和维护：

- 1.3.x 是稳定版本线。
- GitHub release 显示 1.3.3 于 2024-10-25 发布。

技术：

- 主要语言：Python。
- 可配合 `python-rtmidi` 做端口 I/O。
- 支持 MIDI messages、MIDI files、SYX files。

流行程度：

- GitHub 约 1.6k stars。
- Python 生态里非常常见，适合脚本、分析、原型。

适合了解：

- Python 里如何表示 MIDI message。
- 如何读写 `.mid` 文件。
- 如何快速做 MIDI 分析、转换、测试脚本。

注意：

- 实时性能和底层端口能力取决于后端。
- 做大型实时音频应用时，Python 不是最底层的音频实时线程选择。

## JUCE

定位：

- C++ 跨平台音频应用和插件开发框架。
- 不只是 MIDI 库，但 MIDI、音频设备、插件、GUI、宿主和插件开发都覆盖。

年代和维护：

- JUCE 起源于 2004 年左右。
- GitHub 显示 8.0.x 系列仍在维护，2025 年仍有 8.0.x release。

技术：

- 主要语言：C++。
- 支持 VST、VST3、AU、AUv3、AAX、LV2。
- 支持桌面和移动平台。

流行程度：

- GitHub 约 8k+ stars。
- 商业音频软件和插件开发中非常常见。

适合了解：

- 音频插件开发。
- MIDI 输入输出与音频处理如何结合。
- 跨平台音频应用架构。

注意：

- 框架很大，学习成本高。
- 如果只想读写 MIDI 文件，用 Mido 或 midifile 更轻。
- 如果只想收发实时 MIDI，RtMidi 更直接。

## 选型建议

按目标选择：

- 想研究乐谱和 MIDI 的关系：MuseScore。
- 想研究 DAW 架构：Ardour。
- 想研究 pattern / piano roll：LMMS。
- 想研究 Linux MIDI + notation 老工作流：Rosegarden。
- 想把 MIDI 渲染成声音：FluidSynth。
- 想研究历史 MIDI 播放器：TiMidity++。
- 想做 Linux 音频/MIDI 路由：JACK。
- 想在 C++ 程序里收发实时 MIDI：RtMidi。
- 想在 Python 里读写 MIDI：Mido。
- 想做音频插件或完整音频应用：JUCE。

## 参考资料

- MuseScore release history：https://musescore.org/about/release-history
- MuseScore GitHub：https://github.com/musescore/MuseScore
- Ardour 9.0 release：https://ardour.org/news/9.0.html
- Ardour 官网：https://ardour.org/
- LMMS GitHub：https://github.com/LMMS/lmms
- Rosegarden source downloads：https://www.rosegardenmusic.com/getting/source/
- Rosegarden SourceForge：https://sourceforge.net/projects/rosegarden/files/rosegarden/
- FluidSynth 官网：https://www.fluidsynth.org/
- FluidSynth GitHub：https://github.com/FluidSynth/fluidsynth
- TiMidity++ 官网：https://timidity.sourceforge.net/
- TiMidity++ SourceForge：https://sourceforge.net/projects/timidity/
- JACK：https://jackaudio.org/
- RtMidi GitHub：https://github.com/thestk/rtmidi
- Mido GitHub：https://github.com/mido/mido
- JUCE GitHub：https://github.com/juce-framework/JUCE
