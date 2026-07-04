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

## 代码风格

- 前端：Vanilla JS，无构建工具，保持和现有代码一致的风格
- 后端：Python 3.12，FastAPI，ruff lint（`just lint`）
- 所有 `innerHTML` 拼接必须用 `htmlEsc()` 转义用户数据，防止 XSS
