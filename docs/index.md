# 文档索引

## 总览

- [音乐练习工作站设计调研草案](music-practice-workstation-research.md)：项目总体目标、架构思路、音乐模型、技术栈、MVP 和阶段规划。

## 音乐表示与格式

- [和弦表示法调研](chord-symbol-notation-research.md)：流行/爵士和弦符号、iReal Pro 写法、罗马数字分析、Nashville Number System 和内部结构化建议。
- [MIDI 协议介绍](midi-format-research.md)：MIDI 消息、通道、字节结构、Standard MIDI File、General MIDI、MIDI 2.0、优缺点和相关标准。
- [General MIDI 介绍](general-midi-research.md)：GM 的音色映射、鼓通道、复音能力和播放兼容意义。
- [MusicXML 格式调研](musicxml-format-research.md)：MusicXML 的定位、适合表达的内容、导入策略、风险和验证点。
- [Guitar Pro 格式调研](guitar-pro-format-research.md)：Guitar Pro 格式的导入价值、吉他演奏模型、alphaTab 验证方向和风险。
- [ABC Notation 调研](abc-notation-research.md)：ABC 文本记谱的基本形态、适用范围、产品用途和验证点。

## 渲染、播放与伴奏

- [alphaTab 渲染调研](alphatab-rendering-research.md)：alphaTab 的定位、数据模型、文件导入、谱面渲染、播放同步和集成风险。
- [伴奏生成调研](accompaniment-generation-research.md)：规则和 pattern 伴奏生成、各声部逻辑、MVP 工作拆解和参考产品。
- [伴奏风格模式设计](style-pattern-design.md)：把音乐人描述风格的方式拆成风格画像、声部策略、候选 pattern 和变化规则，避免把风格写成死板事件表。

## 数字音乐基础设施

- [合成器介绍](synthesizer-research.md)：synthesizer 的声音生成原理、核心模块、常见合成方式，以及它和 MIDI、采样器、插件的关系。
- [音频插件格式介绍](audio-plugin-formats-research.md)：VST、Audio Units、AAX、LV2 的定位，以及插件和 MIDI 的关系。
- [低延迟音频接口介绍](audio-driver-low-latency-research.md)：ASIO、Core Audio、WASAPI、JACK 的用途和低延迟音频链路。
- [OSC 协议介绍](osc-research.md)：Open Sound Control 的消息形态、适用场景，以及和 MIDI 的区别。
- [音视频同步与工程交换标准介绍](timecode-sync-research.md)：SMPTE timecode、MTC、MIDI Clock、Ableton Link、AAF、OMF 的区别。
- [MIDI 相关开源软件介绍](midi-open-source-software.md)：MuseScore、Ardour、LMMS、Rosegarden、FluidSynth、JACK、RtMidi、JUCE 等软件和库。

## 学习资料

- [音乐专业英语词汇表](music-professional-english-glossary.md)：音乐、吉他、钢琴、谱面、演奏表达和数字音乐制作相关的专业英语词汇。

## 建议阅读顺序

1. 先读 [音乐练习工作站设计调研草案](music-practice-workstation-research.md)，建立整体背景。
2. 再读 [音乐专业英语词汇表](music-professional-english-glossary.md)，补齐常用术语。
3. 如果关注数据建模，读 [和弦表示法调研](chord-symbol-notation-research.md)、[MIDI 协议介绍](midi-format-research.md)、[MusicXML 格式调研](musicxml-format-research.md)。
4. 如果关注吉他谱导入和渲染，读 [Guitar Pro 格式调研](guitar-pro-format-research.md)、[alphaTab 渲染调研](alphatab-rendering-research.md)。
5. 如果关注伴奏能力，读 [伴奏生成调研](accompaniment-generation-research.md)。
6. 如果关注数字音乐软件生态，读 [合成器介绍](synthesizer-research.md)、[音频插件格式介绍](audio-plugin-formats-research.md)、[低延迟音频接口介绍](audio-driver-low-latency-research.md)、[MIDI 相关开源软件介绍](midi-open-source-software.md)。
