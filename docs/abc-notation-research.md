# ABC Notation 调研

## 定位

ABC Notation 是一种文本化音乐记谱方式，适合快速输入旋律、调号、拍号、节奏和简单和弦标记。它非常适合轻量旋律草稿和教学示例，不适合作为复杂谱面、吉他谱或多乐器演奏模型。

## 基本形态

一个简单 ABC 片段通常包含元信息和旋律正文：

```abc
X:1
T:Simple Tune
M:4/4
L:1/8
K:C
CDEF GABc|cBAG FEDC|
```

常见字段：

- `X`：曲目编号。
- `T`：标题。
- `M`：拍号。
- `L`：默认音符长度。
- `K`：调号。

## 适合表达的内容

- 单旋律或简单多声部。
- 调号、拍号、基本节奏。
- 反复和简单段落。
- 装饰音。
- 和弦标记。

## 不适合表达的内容

- 精细排版。
- 复杂钢琴谱。
- 吉他弦、品、推弦、泛音等技巧。
- 口琴吹吸、孔位、position。
- 练习评分和实时输入事件。

## 在产品中的用途

### 快速录入

适合给用户一个纯文本输入入口，把简单旋律快速转换成内部模型。

```text
ABC Text -> Parser -> Internal Music Model -> Render/Playback
```

### 教学示例

文档和教程中可以用 ABC 表达短旋律，比 MusicXML 更容易阅读和版本管理。

### 测试样例

ABC 文本适合作为单元测试 fixture，用来覆盖调号、拍号、节奏解析。

## 第一阶段验证点

- 是否采用 abcjs 或其他现成解析/渲染库。
- ABC 到内部模型的 pitch、duration、barline 映射。
- 和弦标记如何映射到 `ChordSymbol`。
- 非标准扩展是否接受，还是只支持标准子集。

## 风险

- ABC 生态中存在方言和扩展。
- 对复杂谱面支持有限。
- 用户可能期待“简谱输入”，但 ABC 不是中文语境下的数字简谱。

## 参考资料

- ABC Notation Standard：https://www.abcnotation.com/wiki/abc:standard
- abcjs ABC Notation overview：https://docs.abcjs.net/overview/abc-notation

