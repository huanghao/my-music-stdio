# SoundFont 介绍

## 什么是 SoundFont

SoundFont 是一种**采样音色库格式**，由 Creative Technology（创新）在 1990 年代为 Sound Blaster 声卡开发，后来成为通用标准。

文件本质是：把真实乐器的录音片段（采样）+ 演奏规则打包成一个文件。合成器引擎（如 FluidSynth）读取这个文件，根据 MIDI 指令找到对应音高的采样播放。

```
MIDI Note On (note=60, velocity=80)
        ↓
SoundFont 查找：钢琴 program，C4 音高，中等力度
        ↓
播放对应的录音片段（可能经过音高移调）
```

## 格式

| 格式 | 说明 |
|------|------|
| `.sf2` | 标准格式，未压缩，文件较大，兼容性最好 |
| `.sf3` | sf2 的压缩版（Ogg Vorbis），MuseScore 使用 |
| `.sfz` | 文本描述 + 独立采样文件，更灵活，非单文件 |
| `.sfArk` | sf2 的专有压缩格式，需解压后使用 |
| `.dls` | 微软/苹果的类似格式，macOS 系统内置 `gs_instruments.dls` |

## 与 DLS 的关系

macOS 系统自带的 `gs_instruments.dls` 是 DLS（Downloadable Sounds）格式，和 SoundFont 概念相同，都是采样音色库，只是格式规范不同。FluidSynth 不能直接解析 DLS，但 `-a coreaudio` 模式下 macOS CoreAudio 自己处理了播放。

## 免费 SoundFont 推荐

| 名称 | 格式 | 特点 |
|------|------|------|
| **GeneralUser GS** | SF2 | 最常用，兼容 GM 和 Roland GS，轻量，约 30MB |
| **Arachno SoundFont** | SF2 | 音色丰富，兼容 GM 和 Roland GS |
| **Roland SC-55 SoundFont** | SF2 | 模拟经典 Roland SC-55 硬件音源音色 |
| **MuseScore General** | SF3 | MuseScore 自带，质量好，sf3 压缩格式 |
| **Fluid R3 GM** | SF2 | FluidSynth 官方配套，老牌 |

更多资源：
- [Musical Artifacts](https://musicalartifacts.com) — 按 soundfont 标签搜索
- [Awesome SoundFonts](https://github.com/ad-si/awesome-soundfonts) — 整理列表

## SoundFont 编辑器：Polyphone

[Polyphone](https://www.polyphone.io) 是免费开源的 SoundFont 编辑器，支持 sf2/sf3/sfz/sfArk 格式。

主要用途：
- 从零创建或修改 SoundFont
- 分层编辑：采样（Sample）→ 乐器（Instrument）→ 预设（Preset）
- 内置在线音色库浏览器，可直接搜索下载社区共享的 SoundFont

对这个项目的价值：如果需要定制特定乐器音色（比如专门调整鼓的音色），可以用 Polyphone 编辑 sf2 文件。

## 在本项目中的使用

当前用法：

```bash
fluidsynth -a coreaudio /System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls output/xxx.mid
```

实际上 CoreAudio 使用系统内置 DLS 音色播放，FluidSynth 作为 MIDI 解析层。

未来集成播放器时，建议下载 GeneralUser GS.sf2，让 FluidSynth 完整控制音色：

```bash
fluidsynth -a coreaudio ~/music-practice/soundfonts/GeneralUser_GS.sf2 output/xxx.mid
```
