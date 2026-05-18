# 伴奏生成调研

## 目标

伴奏生成要为练习提供稳定、可循环、可变速、可编辑、可同步的背景声部。第一阶段建议做规则和 pattern 系统，不直接做 AI 音频生成。

## 基本原理

伴奏生成的核心不是“直接生成一段音频”，而是把音乐结构逐步展开成可播放事件：

```text
和弦进行
  -> 曲式段落
  -> 风格 Pattern
  -> 乐器声部
  -> MIDI 事件
  -> 音源播放
```

输入通常包括：

- 调性。
- 拍号。
- 速度。
- 和弦进行。
- 曲式段落。
- 风格。
- 密度和难度。

输出通常是多声部事件：

- 鼓。
- 贝斯。
- 钢琴。
- 吉他扫弦。
- 吉他分解。
- Pad。
- 简单填充旋律。

## Pattern 是什么

Pattern 是“某种风格在一小节或数小节内怎样运动”的模板。它不直接绑定绝对音高，而是绑定节拍位置、力度、声部角色和相对音。

例子：

```text
4/4 Pop Bass Pattern
beat 1: root
beat 2: fifth
beat 3: root
beat 4: fifth or approach note
```

当和弦是 `C` 时，root 是 C，fifth 是 G。当和弦变成 `Am` 时，root 是 A，fifth 是 E。这样同一个 pattern 可以复用到不同和弦。

## 各声部生成逻辑

### 鼓

鼓通常不依赖和弦，主要依赖风格、拍号和段落强度。

- Kick 强调重拍。
- Snare/Clap 强调 backbeat。
- Hi-hat 或 ride 决定细分节奏。
- Fill-in 用于段落结尾和过门。

### 贝斯

贝斯依赖和弦根音、五音、经过音和节奏风格。

- 简单模式：root / fifth。
- 流行模式：根音 + 八分音符律动。
- Blues/Jazz：walking bass 和半音趋近。

### 钢琴

钢琴常用于和声铺底或节奏型伴奏。

- Block chord。
- 分解和弦。
- 左手低音 + 右手和弦。
- syncopation。

### 吉他

吉他伴奏要区分扫弦和分解。

- 扫弦：上下方向、闷音、重音、空拍。
- 分解：弦序、和弦指型、可演奏性。

## 为什么先不用 AI 音频生成

- 可控性差。
- 很难和谱面小节精确同步。
- 难以编辑某个声部或某个小节。
- 变速和循环练习不稳定。
- 生成结果难以复现。

练习软件更需要可解释的音乐结构，而不是一次性音频结果。

## 数据结构重点

伴奏模型至少需要：

- chord progression。
- section。
- style。
- pattern id。
- bar range。
- instrument part。
- rhythmic grid。
- voicing rule。
- velocity rule。
- humanization。
- fill rule。

## 第一阶段建议

- 从 4/4、Pop、Folk、Blues 三类风格开始。
- 先做鼓、贝斯、钢琴三个声部。
- 输出 MIDI 事件，不直接输出音频文件。
- 支持小节循环、变速、静音声部。
- 让伴奏和谱面共享同一套小节时间轴。

## 可参考产品

- iReal Pro：和弦表驱动伴奏。
- Band-in-a-Box：风格库和自动伴奏。
- Guitar Pro RSE：谱面播放和音色表现。
- DAW MIDI pattern / arranger track：基于片段和段落组织伴奏。

