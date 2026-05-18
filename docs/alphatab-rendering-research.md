# alphaTab 渲染调研

## 定位

alphaTab 不是文件格式，也不是“把抽象层编码成某种二进制文件”的标准。它是一个谱面解析、渲染和播放库：从 Guitar Pro、MusicXML、alphaTex 等输入格式读入乐谱，转换成 alphaTab 自己的内存数据模型，再用这个模型渲染五线谱/六线谱，并生成 MIDI 播放事件。

可以把它理解成三层：

```text
外部文件格式（Guitar Pro / MusicXML / alphaTex）
  -> alphaTab 数据模型
  -> 渲染器 + MIDI 生成器 + 播放同步
```

它适合第一阶段验证六线谱、五线谱联合显示、Guitar Pro 文件导入和播放游标同步。

## alphaTab 的抽象层

alphaTab 官方文档把核心称为 data model。这个模型是乐谱的语义描述，尽量不保存视觉排版细节。导入器负责从文件格式填充模型，渲染器根据模型生成谱面图形，MIDI 生成器根据模型生成播放事件。

核心层级大致是：

```text
Score
  Track
    Staff
      Bar
        Voice
          Beat
            Note
```

关键概念：

- `Score`：整首曲子，包含标题、作者、全局速度、轨道列表、全局小节信息。
- `MasterBar`：所有轨道共享的小节级信息，例如拍号、调号、反复。它保证多个轨道能按同一条播放时间线对齐。
- `Track`：一个乐器或声部，例如主音吉他、节奏吉他、贝斯、鼓。
- `Staff`：一个 track 内的逻辑谱表。吉他 track 可能在渲染时同时显示五线谱和六线谱，但底层仍是同一套音符语义。
- `Bar`：某个 staff 上的一小节。
- `Voice`：同一小节内可并行的声部。
- `Beat`：节奏位置上的一组事件，可以包含单音或和弦。
- `Note`：具体音符，包含音高、弦品信息和技巧效果。

这意味着 alphaTab 的抽象层更接近“可渲染、可播放的谱面模型”，不是通用音乐理论模型。它适合承接 Guitar Pro 类谱面，但不应该直接替代产品自己的内部 Music Model。

## 适合方向

- 吉他谱。
- Guitar Pro 类文件。
- 六线谱 + 五线谱联合显示。
- 播放同步。
- 网页和桌面 WebView 集成。

## 需要验证的能力

### 文件导入

重点验证：

- Guitar Pro 3-5 二进制格式。
- Guitar Pro 8 `.gp`。
- `.gpx` 是否满足目标曲库。
- 技巧记号覆盖率。

### 渲染

重点验证：

- 六线谱和五线谱是否能同时显示。
- 小节换行、缩放、分页是否可控。
- 样式是否能满足练习软件 UI。
- 当前播放位置是否能高亮。

### 播放

重点验证：

- 播放游标与谱面位置同步。
- 变速播放。
- 循环小节。
- 静音/独奏轨道。

### 数据接入

关键问题是 alphaTab 是否只能从 Guitar Pro 文件导入，还是能接受内部模型生成的数据。如果不能直接吃内部模型，就需要设计转换层：

```text
Internal Music Model -> alphaTab-compatible data/file -> alphaTab Render/Playback
```

## 集成方式

如果桌面端选择 Tauri 或 Electron，可以先把 alphaTab 放在前端渲染层验证。核心逻辑仍应保持在自己的模型中，不要让业务逻辑依赖 alphaTab 的内部数据结构。

## 第一阶段建议

- 用 alphaTab 做 Guitar Pro 导入和谱面渲染验证。
- 同时保留 VexFlow 或自研渲染的可能性，用于非吉他谱和高度自定义场景。
- 不承诺 alphaTab 覆盖所有乐器和所有格式。

## 风险

- 对自定义内部模型输入的支持可能不如文件导入成熟。
- 样式和交互定制可能受限制。
- 如果产品后续需要深度编辑器能力，可能需要自研更多谱面层。

## 参考资料

- alphaTab Documentation：https://www.alphatab.net/docs/
- alphaTab File Formats：https://www.alphatab.net/docs/category/formats/
