# alphaTab 渲染调研

## 定位

alphaTab 是面向吉他谱和 Guitar Pro 类文件的谱面渲染与播放同步方案。它适合第一阶段验证六线谱、五线谱联合显示、Guitar Pro 文件导入和播放游标同步。

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

