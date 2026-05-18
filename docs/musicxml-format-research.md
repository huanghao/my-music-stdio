# MusicXML 格式调研

## 定位

MusicXML 是传统乐谱交换格式，重点解决五线谱软件之间的互通。它适合作为导入导出格式，不适合作为音乐练习工作站的内部模型。

当前应以 MusicXML 4.0 为主要参考。MusicXML 4.0 由 W3C Music Notation Community Group 发布，并提供 XSD 和 DTD。官方说明建议实现时参考具体 XSD 或 DTD，而不是只看概念文档。

## 适合表达的内容

- 音高、时值、小节、拍号、调号、谱号。
- 多声部、多谱表、多乐器。
- 反复、跳房子、Coda、Segno 等传统谱面结构。
- 歌词、力度、速度、演奏法、装饰音。
- 和弦符号。
- 部分指法和技术记号。

## 不适合作为内部模型的原因

- 它服务于谱面交换，结构会受排版和传统记谱习惯影响。
- 吉他六线谱、推弦、滑音、击勾弦、泛音等技巧可能有表达差异或缺失。
- 口琴吹吸、孔位、position 等演奏动作不是 MusicXML 的核心语义。
- 练习评分、伴奏生成、实时输入等产品逻辑需要更直接的领域模型。

## 导入策略

导入流程建议：

```text
MusicXML 文件 -> 解析器 -> 中间解析结果 -> 内部 Music Model -> 谱面/播放/练习功能
```

重点不是“完整保留 MusicXML 的所有字段”，而是识别哪些字段进入内部模型：

- 必须保留：音符、节奏、小节、拍号、调号、声部、谱表、反复结构。
- 尽量保留：和弦符号、歌词、力度、速度、常见演奏法。
- 可选保留：排版细节、页面布局、字体、精细位置。

## 第一阶段验证点

- 从 MuseScore 导出一首简单钢琴谱，验证音符、节奏、谱表、声部导入。
- 从 MuseScore 导出一首带和弦标记的 lead sheet，验证 harmony 导入。
- 从吉他谱或六线谱导出 MusicXML，检查技巧记号损失。
- 确认 TypeScript 或 Rust 生态中是否有可用解析库。
- 设计 MusicXML 到内部模型的字段映射表。

## 风险

- 不同软件导出的 MusicXML 细节可能不同。
- 导入后再导出可能无法做到无损 round-trip。
- 用 MusicXML 直接驱动产品逻辑会让内部模型被外部格式绑架。

## 参考资料

- W3C MusicXML 4.0：https://www.w3.org/2021/06/musicxml40/
- MusicXML for Developers：https://www.musicxml.com/for-developers/
- MusicXML XSD：https://www.musicxml.com/for-developers/musicxml-xsd/

