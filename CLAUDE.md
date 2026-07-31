# Project Rules — my-music-stdio

## UI 状态持久化（强制）

**所有页面上的用户选项，必须在刷新后保持上一次的选择。**

这是一条不可妥协的规则：每当你在任何页面新增交互选项（input、select、checkbox 等），都必须同步实现持久化。

### 现有机制

| 页面 | localStorage key | 实现位置 |
|------|-----------------|---------|
| Vamp、Jam | `mps_last_selection` | `app.js` `loadLastSelection()` / `saveLastSelection()` |
| Fretboard（全部模式） | `fb_prefs` | `fretboard.js` `fbPrefsLoad()` / `fbPrefsSave()` |
| Speed Trainer | `st_prefs` | `speed-trainer.js` `stPrefsLoad()` / `stPrefsSave()` |
| Lick 编辑器（编辑/预览模式） | `lick_editor_prefs` | `licks.js` `lickEditorPrefsLoad()` / `lickEditorPrefsSave()` |
| Lick 笔记 PDF 展开/收起状态 | `lick_pdf_open` | `licks.js` `licksPdfOpenMap()` / `licksPdfSetOpen()`（按 URL 记，最后一次操作为准） |

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

使用 `fretboard.js` 顶部定义的 `guarded()` 工具函数：

```js
// fretboard.js 顶部已有
function guarded(fn, ms = 400) {
  let blocked = false;
  return function(...args) {
    if (blocked) return;
    blocked = true;
    setTimeout(() => { blocked = false; }, ms);
    return fn.apply(this, args);
  };
}

// 在文件末尾（module.exports 之前）包装：
fbCagedNext = guarded(fbCagedNext);
fbEarPlayCurrent = guarded(fbEarPlayCurrent);
// ... 其他需要防抖的函数
```

`guarded()` 是 leading-edge 防抖：**第一次调用立即执行**，`ms` 毫秒内的重复调用被丢弃。这与 trailing-edge debounce 不同，后者会延迟执行。

### 新增按钮时的规则

1. 判断该按钮是否属于上述"需要防抖"的类型
2. 如果是，在 `fretboard.js` 末尾的包装列表里加上对应函数
3. `app.js` 里的新 play/stop 按钮通常已通过 UI 状态切换隐式保护，但若有疑问，也用 `guarded()` 包装

---

## 代码风格

- 前端：Vanilla JS，无构建工具，保持和现有代码一致的风格
- 后端：Python 3.12，FastAPI，ruff lint（`just lint`）
- 所有 `innerHTML` 拼接必须用 `htmlEsc()` 转义用户数据，防止 XSS
