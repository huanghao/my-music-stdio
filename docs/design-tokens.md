# Design Tokens 速查表

单一事实来源：`web/tokens.css`（值只在那里定义）。Tailwind utility 是语义 token 的别名（定义在 `index.html` 的 `@theme` 块），两边引用的是同一个变量。

**规则：组件 CSS 和 utility 只用 Tier 2 语义 token；Tier 1 primitive 只被 Tier 2 引用。没有现成 token 就先在 tokens.css 加，不要硬编值。**

## 背景（surfaces）

| Token | 值 | Tailwind utility | 用途 |
|---|---|---|---|
| `--bg-page` | `#f0efe8` | `bg-page` | 页面底色（暖米色） |
| `--bg-card` | `#fff` | `bg-card` | 卡片/面板 |
| `--bg-subtle` | `#f5f5f0` | `bg-subtle` | 嵌套次级区域、右键菜单 |
| `--bg-raised` | `#e8e4d8` | `bg-raised` | 导航选中、状态条、节拍点 |
| `--bg-faint` | `#eee` | `bg-faint` | 未激活 chip、空位 |

## 文字（ink）

| Token | 值 | Tailwind utility | 用途 |
|---|---|---|---|
| `--text` | `#2a2a2a` | `text-fg` | 主文字 |
| `--text-dim` | `#666` | `text-fg-dim` | 次级标签、导航 |
| `--text-muted` | `#888` | `text-fg-muted` | 元信息、字段标签 |
| `--text-faint` | `#aaa` | `text-fg-faint` | 时间戳、单位 |
| `--text-inverse` | `#fff` | `text-fg-inverse` | 彩色按钮上的文字 |

## 边框（lines）

| Token | 值 | Tailwind utility | 用途 |
|---|---|---|---|
| `--border` | `#ddd` | `border-line` | 标准卡片边框 |
| `--border-dim` | `#ccc` | `border-line-dim` | ghost 按钮、部分输入框 |
| `--border-muted` | `#bbb` | `border-line-muted` | 图表线、上下文菜单 |
| `--border-warm` | `#d8d4c8` | `border-line-warm` | chord-chart 暖色边框 |

## 品牌色（brand families）

| 族 | Tokens → utilities | 用途 |
|---|---|---|
| 绿 primary | `--primary` `#4a7c4a` → `bg-primary`/`text-primary`；`--primary-lt` `#7a9a7a` → `-lt`；`--primary-bg` `#e6f0e6` → `-bg`；`--primary-bg-lt` `#eef5ee` → `-bg-lt` | 主按钮、激活态、成功底色 |
| 红 danger | `--danger` `#c04040`；`--danger-dark` `#8f4a4a`；`--danger-bg` `#fff0f0`；`--danger-border` `#d98f84` → `bg-danger`/`text-danger`/`border-danger-border` 等 | 删除、错误 |
| 琥珀 warn | `--warn` `#b8843a`；`--warn-dark` `#8a7030`；`--warn-bg` `#f5f0e0` | 目标 BPM 线、草稿状态 |
| 蓝 accent | `--accent` `#4a7ca0`；`--accent-dim` `#6a8caa` | 探索模式、辅助标注 |

## 领域色（domain）

| 族 | Tokens → utilities |
|---|---|
| 和弦纸面 | `--chord-ink` `#2b2621`、`--chord-root` `#a8492f`、`--chord-card` `#f5f1e9`、`--chord-paper` `#fdfbf7` → `text-chord-ink` 等 |
| 指板图 | `--fb-string` `#999`、`--fb-nut` `#444`、`--fb-inlay` `#9c8f6a`、`--fb-quiz` `#c0503f`、`--fb-shape` `#cfd8c8`、`--fb-chroma` `#b8c8b8` → `fill-fb-*`/`stroke-fb-*`/`bg-fb-*` |
| Song Loop | `--sl-teal`、`--sl-wave`、`--sl-ruler`、`--sl-invalid` → `text-sl-teal` 等 |
| 热力图 | `--heat-1..4`（浅→深绿）→ `bg-heat-1..4`（HTML）；SVG 里用 `.heat-l1..4` 的 `fill` |
| 其它 | `--chart-hover` `#27ae60`、`--screen-dark` `#111` |

## 圆角 / 字号 / 阴影 / 层级

| 类别 | Scale | Tailwind utility |
|---|---|---|
| 圆角 | `--rad-xs` 3 / `--rad-sm` 4 / `--rad-md` 6 / `--rad-lg` 8 / `--rad-xl` 12 / `--rad-full` 999px | `rounded-xs`…`rounded-full` |
| 字号 | `--fs-xs` 11 / `--fs-sm` 12 / `--fs-base` 13 / `--fs-md` 14 / `--fs-lg` 15 / `--fs-xl` 18 / `--fs-2xl` 20px | `text-xs`…`text-2xl` |
| 阴影 | `--elev-sm` / `--elev-md` / `--elev-lg` | `shadow-sm`/`shadow-md`/`shadow-lg` |
| z-index | `--z-base` 1 / `--z-sticky` 10 / `--z-panel` 20 / `--z-float` 60 / `--z-overlay` 100 / `--z-menu` 200 | CSS 里 `var(--z-*)`；utility 用 `z-10` 等任意值 |

间距不设自定义 scale，直接用 Tailwind 默认 4px 基数（`p-2` = 8px、`ml-3` = 12px、`gap-1.5` = 6px…）。

## 两个必须知道的坑

1. **层级**：utility 在 `@layer utilities`，优先级低于 style.css 的无层规则。覆盖 legacy 规则时加 `!` 后缀（`w-[72px]!`、`py-2!`）。
2. **可见性**：用 `hidden` class + `classList.toggle()`，不用 `el.style.display`（`.hidden` 是 `!important`，内联样式盖不掉）。

## Tailwind 管不到的地方

canvas/SVG 的 JS API 颜色（`fillStyle`、svguitar 选项、`stroke()` 等）引用不了 CSS 变量，保留字面值，注释里注明对应 token 名。
