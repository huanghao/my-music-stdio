# Guitar Pro 格式调研

## 定位

Guitar Pro 格式是吉他谱生态的重要入口，覆盖六线谱、五线谱、技巧记号、播放信息和多轨编曲。它适合导入吉他谱内容，但不建议第一阶段完整复刻文件格式。

常见扩展名包括：

- `.gp3`
- `.gp4`
- `.gp5`
- `.gpx`
- `.gp`

不同版本格式差异较大，新版格式可能涉及兼容性和授权风险。

## 适合导入的内容

- 弦、品、调弦、变调夹。
- 多轨和乐器信息。
- 节奏、拍号、小节。
- 推弦、滑音、击弦、勾弦、泛音、闷音等技巧。
- 播放相关信息，例如速度、音色、力度。

## 建模重点

内部模型不要把 Guitar Pro 文件当作唯一真相。建议转换成自己的吉他演奏模型：

```text
GuitarPro File
  -> parser
  -> tracks/measures/beats/notes/effects
  -> Internal Music Model
  -> Guitar Fingering Model
```

吉他音符至少需要表达：

- string。
- fret。
- pitch。
- duration。
- technique。
- tie/slur。
- bend curve。
- let ring。
- palm mute。

## alphaTab 的作用

alphaTab 是第一阶段最值得验证的方案，因为它已经面向 Guitar Pro 类文件和六线谱渲染。产品可以先用 alphaTab 验证导入、渲染和播放同步，再决定是否需要更底层的解析能力。

需要验证：

- `.gp3`、`.gp4`、`.gp5`、`.gpx`、`.gp` 支持范围。
- 技巧记号导入是否完整。
- 是否能从 alphaTab 数据结构映射到内部模型。
- 渲染样式和交互是否可定制。

## 第一阶段建议

- 不做 Guitar Pro 编辑器。
- 不做完整格式兼容承诺。
- 只选几首真实 Guitar Pro 文件做导入样例。
- 优先支持六线谱显示、播放同步和常见技巧映射。
- 内部保存使用自己的格式，导入文件只作为来源。

## 风险

- 文件版本差异大。
- 部分格式非公开或兼容性不稳定。
- 技巧记号映射到通用模型时容易丢语义。
- 如果直接依赖某个库的数据结构，后续迁移成本高。

## 参考资料

- alphaTab File Formats：https://www.alphatab.net/docs/category/formats/
- alphaTab v1.0 release note 提到 Guitar Pro 3-5 binary format 支持：https://alphatab.net/docs/releases/release1_0/

