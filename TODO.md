# TODO

## 音乐风格问题

- 默认的风格有点难听，或者太简单了（机械），pop风格只有两个2分音符，太难听了。

- 风格生成都是代码里写死的，怎么抽象出来。先把代码整理成文档，再变成抽象成模式，代码只负责解析模式并执行

## 已知并发问题（单用户本地使用暂不影响，需要并发时修）

- `gen.REPEATS` 是模块全局变量，并发请求时会互相覆盖。修法：把 `loops` 作为参数传入 `build_track`
- `_play_meta` dict 的 `clear()+update()` 不是原子操作，`/api/status` 并发读时结构上不对。修法：移入 `Player` 类或改为原子替换

## 技术问题

- 服务端重启后，客户端出错，没有报错。没有展示服务连接状态的展示器
- 播放的时候，你怎么怎么知道你没有搞出来内存泄露
- 重新review一下架构，看看哪些有问题需要修改

- 播放的过程中不让修改和弦。只让修改BMP，其他都不能改
- 怎么保证播放时间长了以后，后台声音和前台展示的误差不会越来越大？

## 其他功能

- 识别架子鼓谱，示范演奏
- 手机App
- 记录打卡，哪天练了哪个，速度是多少

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
  - 这是做成完整产品的前提，但不是当前 MVP 的障碍

### 功能

- [ ] 接入谱面：从 MusicXML 或自定义格式读和弦进行
- [ ] 多段落支持（verse/chorus 用不同 pattern）
- [ ] 导出时附带小节标注 (marker meta message)
