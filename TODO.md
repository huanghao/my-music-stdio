# TODO

## 已知并发问题（单用户本地使用暂不影响，需要并发时修）

- `gen.REPEATS` 是模块全局变量，并发请求时会互相覆盖。修法：把 `loops` 作为参数传入 `build_track`
- `_play_meta` dict 的 `clear()+update()` 不是原子操作，`/api/status` 并发读时结构上不对。修法：移入 `Player` 类或改为原子替换

- 服务端重启后，客户端出错，没有报错。没有展示服务连接状态的展示器
- 播放的时候，你怎么怎么知道你没有搞出来内存泄露
- 重新review一下架构，看看哪些有问题需要修改

- jam提供一种我经常用来练音阶、提升速度的场景下用的，就选择一个和弦，比如Am（A小调），然后就直接播放5min。
  通过现在的交互应该怎么搞？它就没有和弦走向，你现在的jam上来默认选择了一个中对应的和弦走向
- 默认一般多少小节，4/4拍是不是12小节，或者16小节，每4小节是一句，最后一个小节加fill，结尾最后一遍换fill？

- 默认的风格有点难听，或者太简单了（机械），pop风格只有两个2分音符，也没有鼓，太难听了。

## 其他功能

- 识别架子鼓谱，示范演奏
- 手机App

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
