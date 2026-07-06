# TODO

## 练习模式

- 动态谱

- 错题/薄弱点记忆：不是 Ear Training 专属需求，Key Map、Shape Degrees 等练习模式
  都需要。现在的统计都是纯客户端内存态，一刷新就清零，没有长期记忆。要做成跨练习
  模式的统一基础能力（比如"记录哪些题型/参数组合错得多，出题时适当提高概率"），但
  长期存储的统计如果算错了，可能导致该练的东西被漏掉——这个风险要在设计阶段就想清楚
  （比如怎么校正、要不要有衰减机制），值得单独立项设计，不要顺手糊一个

- 推弦/麦克风实时检测灵敏度不够，表现为音已发出但图形无响应，原因未明

--------------------

## 技术问题

- 设计一下 DB：现在所有持久化都是 JSON 文件（songs/licks 各一个目录），
  数据量大了以后查询无法高效 filter。潜在方案：SQLite（零依赖）、TinyDB、
  DuckDB（适合分析查询）

- 怎么保证播放时间长了以后，后台声音和前台展示的误差不会越来越大？

--------------------

## 功能

- 记录打卡：哪天练了哪个，速度是多少
- 识别架子鼓谱，示范演奏
- 手机 App

--------------------

## 伴奏生成器 (src/gen_accompaniment_midi.py)

### 声部

- [ ] 节奏吉他声部
  - GM Electric Guitar Clean (program 27) 或 Overdriven (program 29)
  - 简化版：在 beat 1/3 或切分点打和弦音，比钢琴高八度
  - 真实扫弦方向感、闷音、弦序难以用 MIDI 模拟，暂不做

### 风格

- [ ] 更多风格：jazz, latin, reggae, country — 参考 docs/style-design.md
- [ ] arpeggio 钢琴演奏方式（ballad 风格用）
- [ ] fill 细化：按风格定制不同的 fill pattern

### 和弦

- [ ] slash chord 支持（如 C/E, G/B）
- [ ] 更好的和声声部进行（voice leading），避免跳进

### 集成播放

- [ ] 在集成界面中直接播放 MIDI，不依赖 GarageBand 等外部软件
  - 候选方案：FluidSynth (pyfluidsynth)、MuseScore CLI (`mscore -o`)、pygame.midi
  - 需要选定音色方案（SoundFont .sf2 或 Muse Sounds）

### 功能

- [ ] 接入谱面：从 MusicXML 或自定义格式读和弦进行
- [ ] 多段落支持（verse/chorus 用不同 pattern）
- [ ] 导出时附带小节标注 (marker meta message)
