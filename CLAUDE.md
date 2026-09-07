# Project Rules — my-music-stdio

## UI 状态持久化（强制）

**所有页面上的用户选项，必须在刷新后保持上一次的选择。**

这是一条不可妥协的规则：每当你在任何页面新增交互选项（input、select、checkbox 等），都必须同步实现持久化。

### 判断新状态该落哪：localStorage vs 后端

两条腿：**纯 UI 便利状态**（丢了不心疼，换设备/清缓存重新选一次成本很低——上次选项、面板展开/收起、音量、播放位置）留在 `localStorage`；**练习数据**（统计、历史、用户手动整理的顺序——丢了是真的损失，且应该跨设备/浏览器一致）必须走后端 `src/user_state.py` 的 `/api/state/{key}`（GET 返回当前值或 `null`，PUT 整体覆盖）。新增一个 key 时，先在 `src/user_state.py` 的 `KEYS` 里注册，再照下表任一现成模式实现前端读写。

### localStorage（纯 UI 便利状态，现有机制）

| 页面 | localStorage key | 实现位置 |
|------|-----------------|---------|
| Vamp、Jam | `mps_last_selection` | `app.js` `loadLastSelection()` / `saveLastSelection()` |
| 当前页面 / 底部 transport 播放位置 | `mps_current_page` / `transport_pos` | `app.js` |
| Fretboard（全部模式，含 Chord Match 选项） | `fb_prefs` / `fb_chordid_prefs` | `fb-prefs.js` `fbPrefsLoad()` / `fbPrefsSave()`；`chord-id.js` |
| Fretboard 主音量 / 各音色音量 | `fb_master_volume` / `fb_sound_volumes` | `fb-audio.js` |
| Speed Trainer | `st_prefs` | `speed-trainer.js` `stPrefsLoad()` / `stPrefsSave()` |
| Progression Lab | `pl_prefs` | `progression-lab.js` |
| Agent 助教面板选项 | `mps_agent_prefs` | `agent-assistant.js` |
| 练习计时器运行状态 | `pt_state` | `practice-timer.js` |
| Lick 编辑器（编辑/预览模式） | `lick_editor_prefs` | `licks.js` `lickEditorPrefsLoad()` / `lickEditorPrefsSave()` |
| Lick 笔记 PDF 展开/收起状态 | `lick_pdf_open` | `licks.js` `licksPdfOpenMap()` / `licksPdfSetOpen()`（按 URL 记，最后一次操作为准） |
| Lick 音频迷你播放器变速 | `lick_audio_speed` | `licks.js` `licksAudioSpeedMap()` / `licksAudioSpeedSet()`（按 URL 记，最后一次操作为准） |
| Lick 详情 Sessions 列表展开/收起 | `lick_sessions_open` | `licks.js` `licksSessionsOpen()` / `licksSessionsOnToggle()`（全局布尔，默认收起） |
| Dom Drill（方向、五度圈开关、反应时限） | `dd_prefs` | `dom-drill.js` `ddPrefsLoad()` / `ddPrefsSave()` |
| Key Drill（方向、聚焦调） | `kd_prefs` | `key-drill.js` `kdPrefsLoad()` / `kdPrefsSave()` |
| Song Loop | `sl_prefs` / 每首曲子的 url 专属 state | `song-loop.js`（url 专属 state 走后端 `/api/materials/{id}/state`，localStorage 只是迁移前的一次性种子） |

### 后端 `/api/state/{key}`（练习数据，`src/user_state.py`）

| 数据 | key | 实现位置 |
|------|-----|---------|
| Dom Drill 练习统计（按 target root） | `dd_stats` | `dom-drill.js` `ddStatsLoad()` / `ddStatsSave()`（async） |
| Key Drill 练习统计（按 key） | `kd_stats` | `key-drill.js` `kdStatsLoad()` / `kdStatsSave()`（async） |
| Fretboard 和弦练习统计 | `fb_chord_stats` | `fb-chord.js` `fbChordLoadStats()` / `fbChordSaveStats()`（async） |
| Fretboard 视唱练耳统计 | `fb_ear_stats` | `fb-ear.js` `fbEarLoadStats()` / `fbEarSaveStats()`（async） |
| Fretboard 音高练习统计 | `fb_pitch_stats` | `fb-pitch.js` `fbPitchLoadStats()` / `fbPitchSaveStats()`（async） |
| Lick 列表手动排序 | `licks_order` | `licks.js` `licksOrderLoad()` / `licksOrderSave()`（async） |

以上 load 函数都是 async（fetch `/api/state/{key}`），调用方要 `await` 完再渲染依赖它的 UI；save 是 fire-and-forget（失败只是这次没存上，不阻塞交互，也不重试——下次操作会再存一次）。

### 实现模式

```js
// 1. 定义 key
const FOO_PREFS_KEY = 'foo_prefs';

// 2. 加载（在页面 init 最开始调用）
function fooPrefsLoad() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(FOO_PREFS_KEY)) || {}; } catch (_) {}
  if (Number.isFinite(saved.bpm)) fooState.bpm = saved.bpm;
  // ...对每个字段做类型检查后赋值
}

// 3. 保存（每次选项变化时调用）
function fooPrefsSave() {
  localStorage.setItem(FOO_PREFS_KEY, JSON.stringify({
    bpm: fooState.bpm,
    // ...
  }));
}

// 4. 初始化时先加载，再把 state 同步到 DOM
function initFooPage() {
  fooPrefsLoad();
  fooApplyStateToUI();   // 把 state 写入 DOM input/select/checkbox
  // ...注册 change 事件后调用 fooPrefsSave()
}
```

### 注意事项

- 加载时做**类型检查**（`Number.isFinite`、`typeof === 'boolean'` 等），防止损坏的 localStorage 数据污染 state
- 保存时机：用户改变选项时立即保存，**不要**等到播放/提交时才保存
- 新增页面时，先确认它是否需要持久化，再写 UI 代码

---

## 操作按钮防抖（强制）

**会触发播放、下一题、提交之类副作用的按钮，必须防抖，防止快速双击重复执行。**

### 适用范围

需要防抖的按钮类型：
- "Next →" / "下一题" / "New …" — 快速双击会跳过题目或重置当前题
- "▶ Play" / 播放音频 — 快速双击会重叠播放或打断音频队列
- "Check" / "Submit" / 答题确认 — 重复提交会错误地累计统计

**不需要防抖的**：
- 播放页面的 Play/Stop/Pause/Resume — `setPlaybackUI()` 已立即切换按钮可见性，天然防止双击
- 答题按钮（如 `fbNotesAnswer`、`fbEarTwoAnswer`）— 已有内部 `locked`/`answered` flag

### 实现方式

使用 `web/fb-core.js` 顶部定义的 `guarded()` 工具函数（原 `fretboard.js` 已按 section 拆分为 `web/fb-*.js` 共 12 个文件）：

```js
// fb-core.js 顶部已有
function guarded(fn, ms = 400) {
  let blocked = false;
  return function(...args) {
    if (blocked) return;
    blocked = true;
    setTimeout(() => { blocked = false; }, ms);
    return fn.apply(this, args);
  };
}

// 在 fb-init.js 末尾（module.exports 之前）包装：
fbCagedNext = guarded(fbCagedNext);
fbEarPlayCurrent = guarded(fbEarPlayCurrent);
// ... 其他需要防抖的函数
```

`guarded()` 是 leading-edge 防抖：**第一次调用立即执行**，`ms` 毫秒内的重复调用被丢弃。这与 trailing-edge debounce 不同，后者会延迟执行。

### 新增按钮时的规则

1. 判断该按钮是否属于上述"需要防抖"的类型
2. 如果是，在 `web/fb-init.js` 末尾的包装列表里加上对应函数
3. `app.js` 里的新 play/stop 按钮通常已通过 UI 状态切换隐式保护，但若有疑问，也用 `guarded()` 包装

---

## 代码风格

- 前端：Vanilla JS，无构建工具，保持和现有代码一致的风格
- 后端：Python 3.12，FastAPI，ruff lint（`just lint`）
- 所有 `innerHTML` 拼接必须用 `htmlEsc()` 转义用户数据，防止 XSS

### Tailwind 与设计 Token

项目接入了 **Tailwind v4 浏览器版**（vendored 在 `web/vendor/tailwind/`，零构建，运行时编译），并有一套两层的统一设计 token。**新写 UI 一律用 Tailwind utility + token，不要再手写内联 style，也不要新造色值。**

- **Token 唯一来源是 `web/tokens.css`**：Tier 1 primitive（原始色板/scale）→ Tier 2 semantic（`--bg-card`、`--text-dim`、`--primary`…）。组件 CSS 和 Tailwind utility 都只引用 semantic 层。`index.html` 里的 `@theme` 块是纯别名层（`--color-card: var(--bg-card)` → `bg-card`），**不要在 @theme 里写具体值**。
- **完整 token 速查表见 `docs/design-tokens.md`**。写代码前先看一眼有没有现成 token，没有就在 tokens.css 里加，别硬编。
- **可见性切换一律用 `hidden` class**：`el.classList.toggle('hidden', cond)` / `add` / `remove`，初始隐藏就在 HTML 写 `class="hidden"`。**不要再用 `el.style.display`**——`hidden` 在 style.css 里是 `display:none !important`，内联 `style.display=''` 盖不掉它（反之 class 方案两边都兼容）。判断元素是否隐藏用 `el.classList.contains('hidden')`。
- **层级陷阱**：Tailwind utility 编译进 `@layer utilities`，**优先级低于 style.css 里的无层规则**（与选择器特异性无关）。当 utility 要覆盖一条 legacy CSS 规则时（如 `input[type=number]` 的 64px 宽、`.modal` 的 300px 宽、`.empty-state` 的 padding），必须加 `!` 后缀：`class="w-[72px]!"`。新元素没有冲突规则时用普通 utility 即可。
- **运行时拼接的 HTML 里的 utility 同样生效**（浏览器版用 MutationObserver 监听），innerHTML 模板里放心用。
- **Tailwind 管不到的例外**：canvas/SVG 的 JS API 颜色（`fillStyle`、svguitar 选项等）无法引用 CSS 变量，保留字面值即可，但尽量从 token 取值注释说明来源。
- 未引入 preflight（会冲掉 legacy CSS 依赖的 button/input 默认样式），只有 theme + utilities。
- 旧组件 class 不强制迁移——**碰到才迁**：改到某块旧 UI 时顺手把它的色值换成 token；新 UI 直接 utility。
