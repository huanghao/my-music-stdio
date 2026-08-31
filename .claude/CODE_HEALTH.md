# Code Health Review Log

## 2026-08-31 前端「今天」用 toISOString().slice(0,10)（UTC 日历日），与本地日边界差 8 小时
- 位置：`web/practice-timer.js:53`（`ptTodayTotalSec`）、`web/licks.js:871`（练习热力图单元格 key）
- 问题：命中经验库 [tz] 检测签名。`ptTodayTotalSec` 的「今日总时长」在 UTC 零点（北京 8:00）而非本地午夜 rollover；热力图里 cell key 是本地午夜的 Date 转 toISOString（UTC+8 下退一天），而 session 的 `s.date` 是服务端 UTC 时间戳——晚上 8 点到午夜之间的练习会落到后一天的格子上。两处均为存量代码（不在本轮 diff 内），故只记录不直接改。
- 建议：引入共用的本地日历日 helper（`getFullYear/getMonth/getDate` 拼 YYYY-MM-DD），`ptTodayTotalSec` 两侧（`completedAt` 先 `new Date()` 解析再取本地日）与热力图 cell key 统一改走它；热力图侧还要先定口径——session date 是 UTC 时刻，按本地日归档需要先转本地。
- 风险：改口径会移动历史数据在热力图上的落格（视觉变化），且涉及「UTC 时刻→本地日历日」的口径决策，不替用户拍板。

## 2026-07-21 素材库上传逻辑在两个文件里重复（部分已解决）
- 位置：`web/licks.js:1279`（`materialUploadAndInsert`）与 `web/song-loop.js:2014`（`registerAsLibraryMaterial`）
- 进展：去重检查那部分已经抽到 `web/materials.js` 的 `mtCheckDuplicateBeforeUpload`/`mtSha256Hex`，两处都在调用同一个函数了。但「构造 FormData → POST /api/materials → 解析 {filename,url}」这段本身仍然各写了一份，字段名和错误处理分支基本一致，只是调用方后续动作不同（插入 markdown link vs. 记录 sourceUrl）。（2026-08-31 复核：重复仍在，行号已更新。）
- 建议：如果之后还有第三处需要上传素材，可以把这段也搬进 `web/materials.js`，提供 `uploadMaterial(file) -> {filename, url}`，两处各自保留自己的成功/失败 UI 处理。
- 风险：目前只有两处重复、每处几行，抽公共函数属于新增抽象/跨文件改动，未直接处理。
