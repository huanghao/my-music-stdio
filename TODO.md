# TODO

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
