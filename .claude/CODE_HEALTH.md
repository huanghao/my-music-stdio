# Code Health Review Log

## 2026-07-21 素材库上传逻辑在两个文件里重复（部分已解决）
- 位置：`web/licks.js:1158-1179`（`materialUploadAndInsert`）与 `web/song-loop.js:2074-2101`（`registerAsLibraryMaterial`）
- 进展：去重检查那部分已经抽到 `web/materials.js` 的 `mtCheckDuplicateBeforeUpload`/`mtSha256Hex`，两处都在调用同一个函数了。但「构造 FormData → POST /api/materials → 解析 {filename,url}」这段本身仍然各写了一份，字段名和错误处理分支基本一致，只是调用方后续动作不同（插入 markdown link vs. 记录 sourceUrl）。
- 建议：如果之后还有第三处需要上传素材，可以把这段也搬进 `web/materials.js`，提供 `uploadMaterial(file) -> {filename, url}`，两处各自保留自己的成功/失败 UI 处理。
- 风险：目前只有两处重复、每处几行，抽公共函数属于新增抽象/跨文件改动，未直接处理。
