# 文档索引

## 总览

- [音乐练习工作站设计调研草案](music-practice-workstation-research.md)：项目总体目标、架构思路、音乐模型、技术栈、MVP 和阶段规划。

## 音乐表示与格式

- [和弦表示法调研](chord-symbol-notation-research.md)：流行/爵士和弦符号、iReal Pro 写法、罗马数字分析、Nashville Number System 和内部结构化建议。
- [常见和弦进行分类调研](common-chord-progressions-research.md)：流行"四和弦"家族、Blues 12 小节变体、爵士 ii-V-I、小调/调式进行分类，以及给 Sight Read 练习库用的具体候选清单。
- [和弦进行入门：是什么、为什么好听、怎么用](chord-progressions-guide.md)：和弦进行为什么这样排列背后的理论基础，也是 Chord Match 的 Progression 模式为什么选了这些和弦的解释。
- [和声进阶：附属和弦、三全音代理、借用和弦，以及几种"替代 V"的手法](chromatic-harmony-and-substitutions.md)：附属和弦/三全音代理/借用和弦三者的区别，`4536251` 进行和五度圈的关系及为什么流行，V9sus4、ivm6 后门进行、"刹车和弦"分别是什么。
- [CAGED 同把位级数进行练习 + 任意调级数快查方法](caged-positional-progression-practice.md)：用 G 大调 1-6-4-5 具体走一遍"同把位换形状"的横按品位，以及"看到一个小调秒答级数进行"的关系大小调快查法和拆解练习方法。
- [流行音乐常用调分布：数据、方法论局限、和对练习的启示](song-key-frequency-research.md)：Spotify 3000 万首歌调性统计的数据来源和自动检测算法准确率局限、一个被广泛误传的"最常用调排名"案例澄清、级数出现频率（I 后接 V/IV/vi 的比例）、以及这些结论如何指导 Key Drill 工具的权重设计。
- [MIDI 协议介绍](midi-format-research.md)：MIDI 消息、通道、字节结构、Standard MIDI File、General MIDI、MIDI 2.0、优缺点和相关标准。
- [General MIDI 介绍](general-midi-research.md)：GM 的音色映射、鼓通道、复音能力和播放兼容意义。
- [MusicXML 格式调研](musicxml-format-research.md)：MusicXML 的定位、适合表达的内容、导入策略、风险和验证点。
- [Guitar Pro 格式调研](guitar-pro-format-research.md)：Guitar Pro 格式的导入价值、吉他演奏模型、alphaTab 验证方向和风险。
- [ABC Notation 调研](abc-notation-research.md)：ABC 文本记谱的基本形态、适用范围、产品用途和验证点。

## 渲染、播放与伴奏

- [alphaTab 渲染调研](alphatab-rendering-research.md)：alphaTab 的定位、数据模型、文件导入、谱面渲染、播放同步和集成风险。
- [伴奏生成调研](accompaniment-generation-research.md)：规则和 pattern 伴奏生成、各声部逻辑、MVP 工作拆解和参考产品。
- [伴奏风格模式设计](style-pattern-design.md)：把音乐人描述风格的方式拆成风格画像、声部策略、候选 pattern 和变化规则，避免把风格写成死板事件表。
- [练习模式功能规划与开源生态调研](practice-mode-oss-landscape.md)：现有练习功能对应领域的开源库地图（pitchfinder.js、Tonal.js、Impro-Visor、music21 等）、和弦指位图"要不要用库生成"的设计结论，以及下一步练习模式的落地优先级。

## 数字音乐基础设施

- [合成器介绍](synthesizer-research.md)：synthesizer 的声音生成原理、核心模块、常见合成方式，以及它和 MIDI、采样器、插件的关系。
- [音频插件格式介绍](audio-plugin-formats-research.md)：VST、Audio Units、AAX、LV2 的定位，以及插件和 MIDI 的关系。
- [低延迟音频接口介绍](audio-driver-low-latency-research.md)：ASIO、Core Audio、WASAPI、JACK 的用途和低延迟音频链路。
- [OSC 协议介绍](osc-research.md)：Open Sound Control 的消息形态、适用场景，以及和 MIDI 的区别。
- [音视频同步与工程交换标准介绍](timecode-sync-research.md)：SMPTE timecode、MTC、MIDI Clock、Ableton Link、AAF、OMF 的区别。
- [MIDI 相关开源软件介绍](midi-open-source-software.md)：MuseScore、Ardour、LMMS、Rosegarden、FluidSynth、JACK、RtMidi、JUCE 等软件和库。

## 学习资料

- [音乐专业英语词汇表](music-professional-english-glossary.md)：音乐、吉他、钢琴、谱面、演奏表达和数字音乐制作相关的专业英语词汇。
- [吉他和弦指法学习资料推荐](guitar-chord-shapes-resources.md)：配合 Fretboard 页面练习内容整理的外部资料——和弦图读法惯例、CAGED 系统、减七/半减七和弦指法来源、Standard/Jazz 记谱法对比。
- [吉他延伸和弦（6/add9/9/11/13）常用程度调研](guitar-extended-chords-research.md)：这几类和弦在流行/摇滚/民谣/爵士里的实际使用频率对比，以及哪些值得加进指型参考表的结论。
- [独奏爵士吉他（Chord Melody）全景：门类背景、谱系必知乐手，以及 Joe Pass、Ted Greene 深度介绍](joe-pass-ted-greene-intro.md)：Chord Melody 是什么、为什么存在，从 Django Reinhardt、George Van Eps、Wes Montgomery 到 Martin Taylor 的完整谱系，以及 Joe Pass、Ted Greene 两人的生平、风格、代表作品和教材深度介绍。
- [Shell Chord（壳和弦）完全指南：从基础到精通](shell-chords-guide.md)：根音+3音+7音三音和弦的理论、指板上的两组基础指型家族、ii-V-I 与全 12 调练习法、进阶到 drop voicing 和 chord melody 的路径，以及推荐练习材料。
- [《Take the A Train》的历史，以及《猫和老鼠》为什么听起来是这个味儿](take-the-a-train-and-cartoon-jazz.md)：Billy Strayhorn 怎么写出这首曲子、ASCAP/BMI 版权纠纷意外让它成为 Ellington 乐团团歌的经过，以及黄金时代动画配乐（Mickey Mousing、Scott Bradley）为什么天生该用摇摆爵士的语汇。
- [用《Take the A Train》练 Two-Notes Solo：为什么练这三个调、怎么练](two-notes-solo-practice-take-the-a-train.md)：guide-tone line/两音旋律这套经典即兴入门练法的原理、"先看调性+曲式再补细节"的曲子分析方法、逐和弦拆解 Jens Larsen 实际用的两音组合（含共用音连接的设计思路）、C→G→F 的练习顺序节奏安排，以及库里对应的伴奏 mp3、教材 PDF 和课程字幕原文。
- [Voice Leading / 引导音线（37 音接力）—— 待理解，先存档](voice-leading-guide-tone-lines.md)：和助教关于37音三种练习路径（音名直接找、和弦形状、指板音程几何）的讨论，以及"相邻和弦37音最多移动半音"这条 voice leading 规律；当前先练指板音程几何这一层，本文暂存档待回头看。

## 建议阅读顺序

1. 先读 [音乐练习工作站设计调研草案](music-practice-workstation-research.md)，建立整体背景。
2. 再读 [音乐专业英语词汇表](music-professional-english-glossary.md)，补齐常用术语。
3. 如果关注数据建模，读 [和弦表示法调研](chord-symbol-notation-research.md)、[MIDI 协议介绍](midi-format-research.md)、[MusicXML 格式调研](musicxml-format-research.md)。
4. 如果关注吉他谱导入和渲染，读 [Guitar Pro 格式调研](guitar-pro-format-research.md)、[alphaTab 渲染调研](alphatab-rendering-research.md)。
5. 如果关注伴奏能力，读 [伴奏生成调研](accompaniment-generation-research.md)。
6. 如果关注数字音乐软件生态，读 [合成器介绍](synthesizer-research.md)、[音频插件格式介绍](audio-plugin-formats-research.md)、[低延迟音频接口介绍](audio-driver-low-latency-research.md)、[MIDI 相关开源软件介绍](midi-open-source-software.md)。
