# 《男孩别哭111.pdf》第 2 页基线测试

## 输入

- 文件：`男孩别哭111.pdf`
- 页码：第 2 页
- 预期内容：总谱，第一行是鼓，下面或后面包含其他乐器声部。
- 测试目标：观察 Audiveris 能否在混合总谱中定位鼓声部，并继续识别到音符和节奏。

## 运行方式

```bash
./experiments/drum-omr/scripts/run_audiveris_page.sh \
  experiments/drum-omr/input/男孩别哭111.pdf \
  2 \
  experiments/drum-omr/runs/boy-dont-cry-page2
```

为了单独测试总谱中的吉他六线谱支持，还会使用：

```text
-constant org.audiveris.omr.sheet.ProcessingSwitches.sixStringTablatures=true
```

## Audiveris 基线结果

运行版本为本机的 Audiveris 5.10.2，启用了 `drumNotation` 和 `oneLineStaves`；第二轮额外启用了 `sixStringTablatures`。

- 页面载入：成功，图像尺寸为 `2480 × 3507`。
- 页面/系统定位：检测到 12 个系统；视觉上页面确实包含多行鼓谱、TAB（六线谱）和其他声部，但 Audiveris 将整页拆成两个内部 page/score 结构。
- 声部结构：日志显示第一页为 5 个声部、11 个系统，识别到 1 个 tablature（六线谱）；剩余一个系统被拆成 3 个声部。
- 鼓谱相关：GRID 阶段发现多个 one-line staff，但有 4 个因 barline 峰不足被丢弃。当前无法证明第一行鼓谱已被正确保留为一个可转写的声部。
- 音符和节奏：未执行到音符识别；流程在 `HEADERS`（谱表头信息）阶段停止。
- MusicXML/MIDI：未生成 `.mxl`，因此没有可播放结果。
- 独立环境问题：Audiveris 日志显示没有安装 OCR 语言包，标题和普通文字本轮未评估。

## 初步判断

这个样本暴露出两个和上一页不同的基线问题：

1. 总谱的多声部/多系统组织比单独鼓谱复杂，Audiveris 能找到不少几何结构，但声部归属还没有稳定下来。
2. 页面没有明确拍号，导致 `HEADERS` 阶段无法继续，因而不能评价音符、鼓件和节奏识别准确率。

因此当前结论不是“音符识别准确率为零”，而是“在这类没有拍号、混合 TAB 和鼓谱的页面上，默认流程还没有进入音符识别阶段”。

后续样本应分别覆盖：

- 带明确拍号的干净印刷总谱，用于测音符和节奏；
- 没有拍号但鼓谱结构清楚的谱，用于测默认拍号/小节推断；
- 手机拍照的透视、阴影、反光和背景噪声，用于测图像预处理。

详细日志和生成文件位于被忽略的本地目录：

```text
experiments/drum-omr/runs/boy-dont-cry-page2/
```
