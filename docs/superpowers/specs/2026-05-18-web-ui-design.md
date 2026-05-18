# Web UI Design Spec
Date: 2026-05-18

## 目标

为伴奏生成器做一个本地 Web UI，给自己用，Mac 专属。核心工作流：

```
Jam（快速试听）→ 满意 → Save as Song → 以后继续练
```

---

## 架构

```
浏览器 (Web UI)
    ↕ HTTP API
Python 后端 (FastAPI)
    ↕
gen_accompaniment_midi.py  →  FluidSynth 播放
```

后端负责：生成 MIDI、调用 FluidSynth 播放/停止、读写 song.json。
前端负责：编辑、展示、交互。

---

## 页面结构

三个顶级页面，通过顶部导航栏切换：

```
[ Jam ]  [ Songs ]  [ Preferences ]
```

---

## Jam 页

**定位**：快速试听，不保存。选风格预设 → 参数自动填入 → 即时播放 → 随时修改 → 关掉就没了。

### 布局

```
顶部导航: [ Jam* ]  [ Songs ]  [ Preferences ]

─────────────────────────────────────────────
Style Preset: [ Pop ▼ ]   Key: [C▼]  BPM: [120]  Loops: [1]  ≈ 0:58 min
[ ▶ Play ]  [ ■ Stop ]  [ Save as Song... ]
─────────────────────────────────────────────
Chord Chart（可编辑，与 Song 编辑器相同）
─────────────────────────────────────────────
Generation: ● Playing  ~/tmp/jam_session.mid
```

### 交互

- 选 Style Preset → 自动填入该风格的默认和弦进行、BPM、Key
- 参数和 chord chart 均可手动覆盖
- 点 Play → 立即生成 MIDI 并播放，无需保存
- 点 Save as Song → 弹出命名对话框，保存到 Songs
- 切换页面/关闭浏览器 → Jam 状态丢弃，不提示

---

## Songs 页

**定位**：已保存的练习曲目列表。

### 布局

```
[ + New Song ]

┌─────────────────────────────────────────────┐
│ 1645 练习          C · Pop · 120 BPM        │
│ 4 bars × 4 = 3:12  ● Generated  2h ago      │
│                               [Duplicate] [×]│
├─────────────────────────────────────────────┤
│ Blues in A         A · Blues · 90 BPM       │
│ 12 bars × 3 = 9:36  ● Generated  1d ago     │
│                               [Duplicate] [×]│
├─────────────────────────────────────────────┤
│ Bossa sketch       C · Bossa · 130 BPM      │
│ 4 bars × 4 = 2:58  ○ Draft      3d ago      │
│                               [Duplicate] [×]│
└─────────────────────────────────────────────┘
```

- 按最近编辑时间排序
- Generated（绿点）/ Draft（黄点）状态
- Duplicate：复制一首歌作为新起点
- 点击卡片 → 进入 Song 编辑器

---

## Song 编辑器页

从 Songs 列表点击进入，或点 New Song 进入。

### 布局

```
← Songs

Title: [1645 练习    ]  Key:[C▼]  BPM:[120]  Style:[Pop▼]  Loops:[4] ≈3:12
[ ▶ Generate & Play ]  [ ■ Stop ]  [ Save ]

Generation: ○ Not generated  ~/music-practice/songs/1645-练习/accompaniment.mid

────────────────────────────────────────────────────
4/4  ║  C              │  Am             ║  F      G    ║  G              ║
     ║                 │                 ║  ←2→  ←2→   ║                 ║
────────────────────────────────────────────────────
     ║  C              │  Am             ║  F      G    ║  G              ║
     ║                 │                 ║              ║                 ║
────────────────────────────────────────────────────
```

### Chord Chart 规格

**视觉**
- 背景色 `#f5f5f0`（谱纸浅灰）
- 每行 4 小节（可在 Preferences 改为 2/4/8）
- 小节之间竖线分隔，行首显示拍号
- 字体：衬线体或手写感字体，和弦名大号显示

**小节内拍位分配**
- 1 个和弦：占满 4 拍
- 2 个和弦：各 2 拍
- 3 个和弦：默认 2+1+1，可手动调整每个和弦的拍数
- 4 个和弦：各 1 拍
- 超过 4 个：缩小显示，或提示"拍数不足"

**编辑交互**
- 点击和弦名 → 原地弹出输入框（手写，不是下拉），回车确认，Esc 取消
- 右键和弦 → 菜单：编辑 / 删除 / 在前插入 / 在后插入
- 右键小节空白 → 菜单：添加和弦 / 删除小节 / 在前插入小节 / 在后插入小节
- 点击小节线 → 切换反复记号（无 / 反复开始 / 反复结束）

**反复记号**
- 细竖线：普通小节线
- 双竖线：段落结束
- 双竖线+两点：反复记号

### 歌曲目录结构

```
~/music-practice/songs/
└── 1645-练习/
    ├── song.json
    └── accompaniment.mid
```

`song.json` 结构：

```json
{
  "title": "1645 练习",
  "key": "C",
  "bpm": 120,
  "style": "pop",
  "time_signature": "4/4",
  "loops": 4,
  "updated_at": "2026-05-18T10:00:00",
  "bars": [
    { "chords": [{ "name": "C", "beats": 4 }] },
    { "chords": [{ "name": "Am", "beats": 4 }] },
    { "chords": [{ "name": "F", "beats": 2 }, { "name": "G", "beats": 2 }] },
    { "chords": [{ "name": "G", "beats": 4 }] }
  ]
}
```

---

## Preferences 页

设置保存在 `~/.config/music-practice/prefs.json`，后端启动时读取，前端通过 `/api/prefs` GET/PUT 读写。修改后**不需要重启服务**，后端热更新配置。

两个路径（SoundFont、Songs 目录）也在这里修改，不是服务器启动参数——服务器每次使用时从 prefs.json 动态读取。

```json
{
  "bars_per_row": 4,
  "soundfont_path": "~/music-practice/soundfonts/MuseScore_General.sf3",
  "songs_dir": "~/music-practice/songs/"
}
```

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| 每行小节数 | 4 | 选项：2 / 4 / 8 |
| SoundFont 路径 | `~/music-practice/soundfonts/MuseScore_General.sf3` | FluidSynth 音色文件 |
| Songs 目录 | `~/music-practice/songs/` | 歌曲保存位置 |

---

## 风格库（Style Preset）

每个风格条目包含：

```json
{
  "id": "pop",
  "name": "Pop",
  "tags": ["流行"],
  "bpm_range": [90, 130],
  "bpm_default": 120,
  "time_signature": "4/4",
  "feel": "straight",
  "default_key": "C",
  "default_progression": [
    { "chords": [{ "name": "C", "beats": 4 }] },
    { "chords": [{ "name": "Am", "beats": 4 }] },
    { "chords": [{ "name": "F", "beats": 4 }] },
    { "chords": [{ "name": "G", "beats": 4 }] }
  ],
  "parts": {
    "drums": "groove_pop",
    "bass": "root_fifth",
    "piano": "block_chord"
  },
  "reference_songs": ["周杰伦《七里香》", "Ed Sheeran《Shape of You》"]
}
```

第一阶段风格库：pop / ballad / shuffle / blues / rock / metal / rnb / funk / bossa（已在 `gen_accompaniment_midi.py` 实现）。

---

## API 设计（后端）

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/styles` | 返回风格库列表 |
| GET | `/api/songs` | 返回 songs 目录列表，按 updated_at 排序 |
| GET | `/api/songs/:id` | 返回单首歌 song.json |
| POST | `/api/songs` | 新建歌曲 |
| PUT | `/api/songs/:id` | 保存歌曲 |
| DELETE | `/api/songs/:id` | 删除歌曲 |
| POST | `/api/play` | 生成 MIDI 并调用 FluidSynth 播放，body: song data |
| POST | `/api/stop` | 停止播放 |
| GET | `/api/status` | 返回当前播放状态 |

---

## TODO（不在本阶段）

- [ ] 每行小节数可配置（先固定 4）
- [ ] 反复记号编辑（先只显示，不可交互）
- [ ] 风格高级选项：单独选鼓/贝斯/钢琴演奏方式
- [ ] 拍号选择（先固定 4/4）
- [ ] 节拍器
- [ ] 变速练习
- [ ] 声部静音开关
