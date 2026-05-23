# 伴奏风格模式设计

## 本质问题

伴奏风格模式不是把 Python 分支翻译成 JSON、YAML 或另一种 DSL。那样只会得到“可配置的死板代码”：每个小节仍然固定落点、固定力度、固定声部，听起来还是机械。

这里要解决的问题是：把音乐人描述、总结和交流风格的方式，转成一个能生成可变 MIDI 事件的中间模型。输入是和弦进行、拍号、速度、段落位置、目标风格和强度；输出是鼓、贝斯、钢琴或吉他等声部的事件。Pattern 只是中间模型的一部分，它必须服务于“风格规则”，而不是取代风格本身。

因此，风格模式应该表达的是“一个风格的可变语法”：哪些东西稳定不变，哪些东西可以变化，变化范围有多大，哪些变化一出现就不再像这个风格。

## 音乐人怎样描述风格

音乐人通常不会用“第 0、4、8、12 格触发 snare”来描述风格。更常见的描述会同时包含参考对象、律动、声部角色和演奏习惯。

例如：

```text
做一个 90 BPM 左右的流行抒情，不要太满。
鼓就是稳一点的 2/4 backbeat，踩镲可以八分，别太炸。
钢琴左手别一直跳，右手铺和弦，可以有一点分解。
贝斯跟根音为主，段尾可以有一点经过音。
每 4 小节有个很轻的 fill，别像 rock。
```

这段话里真正有用的信息不是一个固定 pattern，而是几类约束：

- **参考对象**：流行抒情，不是 rock、funk 或 jazz swing。
- **速度范围**：90 BPM 左右，速度偏离后同一 pattern 的听感会变。
- **律动 feel**：直拍、稳、不要太满。
- **声部角色**：鼓负责时间骨架，钢琴负责和声铺底，贝斯负责根音支撑。
- **密度**：整体偏稀疏，不能每个声部都在填满 16 分音符。
- **重音结构**：snare 在 backbeat，kick 支撑强拍。
- **变化规则**：段尾可以 fill，但 fill 要轻。
- **禁忌**：不要 rock 化，不要过满，不要过炸。

这些内容才是风格定义。固定的鼓点表只是它的一种具体实现。

## 可变空间与约束

可以把伴奏生成理解成三件事：

1. 先定义**可变空间**：系统允许哪些音乐维度发生变化。
2. 再定义**风格约束**：某个风格在这些维度上允许什么、禁止什么、偏好什么。
3. 最后定义**选择策略**：在允许的范围内，当前小节应该选哪一种变化。

可变空间不需要一开始穷尽所有音乐可能性，但第一版必须把自己支持的空间说清楚。否则“风格约束”没有对象，“变化策略”也只能退化成随机数。

第一版建议只承认这些可变维度：

| 维度 | 含义 | 第一版例子 |
|---|---|---|
| 时间网格 | 一拍如何细分 | quarter、eighth、sixteenth、shuffle triplet |
| 重音结构 | 哪些拍点承担骨架 | beat 1、backbeat、offbeat、push |
| 事件密度 | 每小节发生多少动作 | sparse、medium、busy |
| 声部角色 | 每个乐器负责什么 | keep time、root support、harmonic pad |
| 音高材料 | 声部能用哪些相对音 | root、third、fifth、octave、approach_next |
| 运动方向 | 音高或能量如何移动 | stay、step up、step down、return to root |
| 段落位置 | 当前小节在乐句中的功能 | phrase_start、phrase_middle、phrase_end、turnaround |
| 力度范围 | 强弱和 ghost note 的区间 | accent、normal、ghost |
| 时值偏移 | 人味和 swing 的微小时值 | straight、light swing、late backbeat |
| Fill 行为 | 过门何时出现、出现多大 | none、light、medium、strong |

风格就是这些维度上的约束组合。例如 Pop 可以约束为：直拍、backbeat 稳定、密度中等、kick 支撑 beat 1、snare 支撑 beat 2/4、fill 只在乐句末尾小幅出现。Ballad 则会进一步降低密度、减弱鼓、增加钢琴铺底或分解。

## 变化不是随机

变化不能理解成“从可选落点里随机挑几个”。随机只能避免完全重复，不能自动产生音乐性。音乐性的变化至少要满足三个条件：

- **有上下文**：变化要知道当前是乐句开头、中间、结尾，还是 turnaround。
- **有方向**：变化要知道当前要更稳定、更推进、更收束，还是更留白。
- **有预算**：变化要知道这个风格允许多大幅度，不能每个声部同时变化。

因此，选择策略应该像一个带约束的决策过程，而不是普通随机：

```text
bar_context
  -> decide energy and density budget
  -> choose required anchors
  -> choose optional motions within style constraints
  -> apply small humanization
  -> reject result if it violates forbidden traits
```

例如一个 4 小节 Pop 乐句可以这样变化：

| 小节角色 | 目标 | 鼓 | 贝斯 | 钢琴 |
|---|---|---|---|---|
| phrase_start | 建立稳定感 | 最简单 backbeat | root 为主 | 少量和弦铺底 |
| phrase_middle | 保持循环 | 可加一个 kick 变体 | root/fifth | 稳定节奏型 |
| phrase_middle | 稍微推进 | hihat 可更密一点 | 加 octave | 增加一次切分 |
| phrase_end | 引向下一句 | 轻 fill 或 pickup | approach_next | 留空间或短促收束 |

这里的“变化模式”来自乐句功能和能量曲线。实现上可以有少量随机，但随机只能在同一功能下的候选项之间选择，不能决定音乐方向。

## 风格模式的分层

一个可用的风格模式至少分四层：风格画像、声部策略、候选 pattern、变化规则。

### 风格画像

风格画像描述“这个风格听起来应该像什么”。它不直接生成 MIDI，而是限制下面的选择空间。

```text
StyleProfile
- id: ballad_pop
- tempo_range: 60-90
- feel: straight
- energy: low_to_medium
- density: sparse_to_medium
- groove_anchor: backbeat
- forbidden_traits: heavy_crash, dense_double_kick, funk_16th_stabs
```

这层回答的是：什么是这个风格，什么不是这个风格。

### 声部策略

声部策略描述每个乐器在风格里的职责。它不是事件表，而是“应该怎么参与”。

```text
PartStrategy
- drums: keep_time, light_backbeat, short_fill
- bass: root_support, occasional_approach
- piano: harmonic_pad, broken_chord_optional
- guitar: absent_or_light_strum
```

同一个风格可以有多个声部策略。例如 ballad 可以是钢琴主导，也可以是吉他主导；pop 可以是鼓贝斯主导，也可以是轻量 acoustic 版。

### 候选 Pattern

候选 pattern 是可执行的素材库。它表达一类动作，但不应该只有一个固定版本。

```text
DrumPatternFamily
- role: main_groove
- grid: eighth
- kick: strong beat 1, optional beat 3, optional pickup before beat 3
- snare: beat 2 and beat 4, velocity medium
- hihat: eighth notes, slight accent on downbeats
- variation_budget: low
```

注意这里的关键词是 `optional` 和 `variation_budget`。如果 pattern 只能表达一个确定落点，它只能生成循环，不足以表达风格。

### 变化规则

变化规则决定“什么时候变、怎么变、变多少”。这是避免机械感的关键。

```text
VariationRule
- bar_role: phrase_start | phrase_middle | phrase_end | turnaround
- density_curve: phrase_start sparse, phrase_end slightly busier
- fill_probability: low except phrase_end
- velocity_jitter: small
- timing_jitter: very small
- avoid_repeating_identical_bar: true
```

同一小节内的随机不是音乐变化。音乐变化通常和段落位置、能量曲线、声部职责有关。

## 什么可以数据化

适合直接数据化的是稳定、局部、可验证的规则。

- 网格：4/4 的 8 分、16 分、shuffle 三连音网格。
- 落点候选：kick 可以落在哪些位置，snare 的主落点在哪里。
- 力度范围：主拍、弱拍、ghost note 的 velocity 区间。
- 声部动作：root、third、fifth、chord、approach_next 等相对音。
- 段落规则：第 4 小节末尾更容易 fill，段落开头可加 crash。
- 密度范围：每小节事件数量的上下限。
- 禁忌规则：某风格不允许 heavy crash、不允许过密 kick、不允许过多半音趋近。

不适合第一阶段直接数据化的是需要高级语义判断的内容。

- “像某个鼓手”的微观 timing。
- “更深情一点”的表情控制。
- 复杂爵士 comping 的互动逻辑。
- 真实吉他扫弦的指型、上下扫、闷音和弦序。
- 根据旋律自动避让伴奏音区。

这些可以以后作为更深的 Module，而不是塞进第一版 pattern 格式。

## 最小可执行模型

第一版不要设计成完整编曲系统。建议先支持一个小而有弹性的模型：

```text
StylePattern
- profile: 风格画像
- parts: 每个声部的策略
- pattern_families: 每个声部的候选 pattern family
- variation: 段落位置、密度、fill、humanize 规则
```

生成流程：

```text
和弦进行 + 速度 + 段落位置
  -> 选择 StyleProfile
  -> 为每个声部选择 PartStrategy
  -> 按 bar_role 选择 PatternFamily 的一个变体
  -> 展开相对音和节奏网格
  -> 应用密度、力度、timing、fill 变化
  -> 输出 MIDI 事件
```

这里的接口重点不是“数据文件长什么样”，而是每层保留多少音乐语义。数据格式可以之后用 Python dict、JSON、YAML 或 dataclass 表达。

## 已验证的实现切片：Pop 鼓、贝斯和钢琴

为了避免文档停在抽象层，当前代码已经先落地了一个最小切片：迁移 Pop 的鼓、贝斯和钢琴声部，其他风格暂时保持原实现。这个切片验证的是：风格模式可以先把一个风格做深，不需要一次性重写整个伴奏生成器。

当前实现位于 `src/style_patterns.py`。它没有把 Pop 鼓写成“一个固定小节”，而是拆成两类规则：

- **required**：风格锚点，必须稳定存在。Pop 鼓的锚点是 beat 1 的 kick、beat 2/4 的 snare，以及八分踩镲。
- **optional_by_role**：按小节角色加入的变化。`phrase_start` 简单，`phrase_middle` 加更明显的切分 kick，`phrase_end` 加 pickup、轻 snare 和 open hi-hat。

代码形态大致是：

```text
POP_DRUMS
- grid_slots: 16
- required:
  - kick: slot 0
  - snare: slot 4, slot 12
  - hihat: downbeat slots louder, offbeat slots lighter
- optional_by_role:
  - phrase_start: kick on slot 8
  - phrase_middle: kick on slot 6, 8, 10
  - phrase_end: kick and open hi-hat on slot 14, light snare on slot 15
```

这里的 `slot` 是 16 分音符网格。一小节 16 个 slot，`slot 0` 是 beat 1，`slot 4` 是 beat 2，`slot 8` 是 beat 3，`slot 12` 是 beat 4。

Pop 贝斯也使用同样的小节角色，但它不直接写 MIDI 音高，而是写相对音：

```text
POP_BASS
- phrase_start: root, octave
- phrase_middle: root, fifth, octave, fifth
- phrase_end: root, fifth, root, approach_next
```

这里的 `root`、`fifth`、`octave`、`approach_next` 都不是固定音名。生成器会根据当前和弦把它们展开成具体 MIDI 音高。例如和弦是 `C` 时，`root` 是 C 的低音区；和弦变成 `Am` 时，`root` 变成 A 的低音区。`approach_next` 表示向下一个和弦根音靠近的经过音，只适合在乐句末尾或小节连接处使用。

Pop 钢琴同样使用小节角色，但它目前只表达和弦动作，不处理复杂转位：

```text
POP_PIANO
- phrase_start: block on slot 0 and 8
- phrase_middle: stab on slot 4, 10, 12
- phrase_end: block on slot 0, stab on slot 8 and 14
```

这里的 `block` 表示当前和弦音同时按下，`stab` 表示短促和弦击打。第一版先不做复杂 `voicing`（和弦音排列）和 arpeggio（分解琶音），因为这些会引入更多演奏法问题。先让钢琴跟随同一套小节角色变化，验证整体听感是否比固定 hit 更自然。

这说明“数据驱动”不是把完整 MIDI 事件塞进数据里，而是把音乐决策拆成：

```text
必须保留的风格锚点
+ 当前小节角色允许的变化
+ 当前和弦决定的相对音展开
+ 当前声部的动作类型
-> 展开为 MIDI note_on/note_off
```

目前这个切片仍然有限：钢琴的 `voicing` 还没有真正使用，所有 `block` 和 `stab` 都使用当前和弦的基础音。下一步如果继续提升听感，应处理转位、音区和分解琶音。

## 怎么使用这种风格模式

这个模式目前不是给用户在页面上手写的配置语言，而是给开发者维护风格库的代码结构。使用方式分三类。

### 听当前效果

运行开发服务：

```bash
just dev
```

打开 `http://localhost:8765`，在 Jam 或 Vamp 里选择 Pop 并播放。当前 Pop 播放会自动使用 `src/style_patterns.py` 里的 Pop 鼓、贝斯和钢琴规则；不需要在页面上额外打开开关。

### 调整 Pop 鼓

修改 `src/style_patterns.py` 里的 `POP_DRUMS`：

```text
required
- 放必须稳定存在的风格锚点，例如 beat 1 kick、beat 2/4 snare。

optional_by_role
- phrase_start: 乐句开头，应该简单稳定。
- phrase_middle: 乐句中间，可以增加一点推进。
- phrase_end: 乐句结尾，可以加入 pickup、open hi-hat 或轻 fill。
```

如果只是想让 Pop 鼓更忙一点，优先改 `phrase_middle`，不要改 `required`。`required` 太复杂会让每个小节都很满，循环久了更机械。

### 调整 Pop 贝斯

修改 `src/style_patterns.py` 里的 `BASS_PATTERNS["pop"]`：

```text
phrase_start: root, octave
phrase_middle: root, fifth, octave, fifth
phrase_end: root, fifth, root, approach_next
```

这里应该写相对音，不应该写 `C2`、`G2` 这种绝对音。常用相对音先限制为：

| 相对音 | 含义 | 适合位置 |
|---|---|---|
| root | 当前和弦根音低音区 | 强拍、乐句开头 |
| fifth | 当前和弦五音低音区 | 中间拍、稳定运动 |
| octave | 根音上方八度 | 推进但不改变和声 |
| approach_next | 靠近下一个和弦根音的经过音 | phrase_end 或小节连接 |

如果贝斯听起来乱，通常先减少 `approach_next`，再减少 offbeat 上的事件。贝斯的第一职责是支撑和弦和时间，不是制造复杂旋律。

### 调整 Pop 钢琴

修改 `src/style_patterns.py` 里的 `PIANO_PATTERNS["pop"]`：

```text
phrase_start: block, block
phrase_middle: stab, stab, stab
phrase_end: block, stab, stab
```

第一版常用动作先限制为：

| 动作 | 含义 | 适合位置 |
|---|---|---|
| block | 当前和弦音同时按下，时值较长 | phrase_start、段落铺底 |
| stab | 短促和弦击打 | phrase_middle、phrase_end |

如果钢琴听起来抢拍或太满，先减少 `phrase_middle` 的 hit 数量，或缩短 `duration_slots`。如果听起来太空，优先增加 `phrase_start` 的长音，而不是给每个 16 分音符都加事件。

## 示例：Pop 不是一个固定鼓点

死板版本：

```text
Kick:  beat 1, beat 3
Snare: beat 2, beat 4
HiHat: every eighth note
Piano: beat 2 and 3.5
Bass: root third fifth approach
```

更合理的风格模式：

```text
Pop
- feel: straight
- groove_anchor: backbeat
- drums:
  - snare must support beat 2 and beat 4
  - kick must support beat 1
  - kick may add beat 3 or pickup before beat 3
  - hihat may be quarter, eighth, or light sixteenth depending on density
- bass:
  - use root on strong beats
  - use fifth or octave for simple motion
  - use approach note only near phrase end
- piano:
  - choose block chord, sparse stab, or broken chord by energy
  - avoid filling every subdivision unless style variant asks for it
- variation:
  - phrase_start: simpler
  - phrase_middle: stable
  - phrase_end: small fill or pickup
```

这样生成器每次仍然像 Pop，但不会每 4 小节机械复制同一个小节。

这个例子现在已有完整 Pop 切片：鼓、贝斯和钢琴都能根据 `phrase_start`、`phrase_middle`、`phrase_end` 产生不同小节。尚未实现的是更细的钢琴转位、音区控制和分解琶音。

## 示例：Ballad 和 Pop 的边界

Ballad 不是“Pop 降低 BPM”。它还改变声部职责和密度。

| 维度 | Pop | Ballad |
|---|---|---|
| 速度 | 中速为主 | 慢速为主 |
| 鼓 | 稳定 backbeat，可有较明确 groove | 更轻，可能只保留少量 kick/snare/hihat |
| 钢琴 | 可做节奏切分 | 更常做铺底、分解、长音 |
| 贝斯 | 支撑律动 | 支撑根音和段落推进 |
| Fill | 可以明显 | 应该克制 |

如果只把 Pop pattern 减速，就会得到“慢速机械 Pop”。如果同时改变密度、声部角色和 fill 规则，才更接近 Ballad。

## 第一版实现边界

第一版应只解决三个问题：

1. 同一个风格下不要每小节完全重复。
2. 同一个风格的变化不能跑出风格边界。
3. 增加新风格时，主要增加风格画像、声部策略和 pattern family，而不是继续写大段 `if style == ...`。

第一版不追求：

- 自动生成完整歌曲编曲。
- 模拟真实乐手水平。
- 按任意自然语言直接生成风格。
- 做大型风格库。

## 实施顺序

下一步不要继续扩很多风格，而应该把一个风格做深。推荐顺序是：

1. **Pop drums**：已完成最小切片。继续试听并调整 required/optional 的音乐性。
2. **Pop bass**：已完成最小切片。继续试听 root、fifth、octave、approach_next 的密度和连接效果。
3. **Pop piano**：已完成最小切片。下一步应补 voicing、音区和 broken chord。
4. **统一 Pop style profile**：把 drums、bass、piano 放到同一个 Pop 风格画像下，明确 density、energy、forbidden traits。
5. **再迁移 Ballad**：Ballad 和 Pop 相邻，但约束不同，适合作为第二个风格验证模型是否能表达边界。

这个顺序的目标不是快速增加风格数量，而是验证同一套可变空间和约束是否能同时控制多个声部。如果 Pop 的三个声部都能用这套模型表达，再扩风格才有意义。

## 与现有代码的关系

当前 `src/gen_accompaniment_midi.py` 里有三类东西混在一起：

- 音乐知识：哪些风格用哪些 groove、fill、bass、piano。
- 展开逻辑：如何把 chord、bar、tick 展开成 MIDI event。
- 随机变化：humanize、fill 随机选择。

下一步不应该直接把所有函数改成数据表，而是先拆出三个 Module：

- `style_patterns`：保存风格画像、声部策略、pattern family 和变化规则。
- `pattern_expander`：把相对音、节奏网格和段落位置展开成 MIDI event。
- `midi_renderer`：把事件排序、转 delta time，写成 `mido.MidiTrack`。

这样风格知识有 locality，展开器有清晰 Interface，测试也能从“给定风格、和弦、小节角色，应该产生什么事件范围”开始写，而不是只测某个固定 MIDI 文件。
