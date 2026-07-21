# Code Health Review Log

## 2026-07-21 素材库上传逻辑在两个文件里重复
- 位置：`web/licks.js:685-704`（`materialUploadAndInsert`）与 `web/song-loop.js` 的 `registerAsLibraryMaterial`（约第 940-960 行）
- 问题：两处都独立实现了「构造 FormData → POST /api/materials → 解析 {filename,url} → 处理成功/失败状态文案」这套逻辑，字段名和错误处理分支基本一致，只是调用方后续动作不同（插入 markdown link vs. 记录 sourceUrl）。
- 建议：如果之后还有第三处需要上传素材，可以考虑抽一个 `web/materials-client.js`（或加进已有的某个公共文件）提供 `uploadMaterial(file) -> {filename, url}`，两处各自保留自己的成功/失败 UI 处理。
- 风险：目前只有两处重复、每处几行，抽公共函数需要新建模块或选定挂载位置，属于新增抽象/跨文件改动，未直接处理。
