# 鼓谱 OMR 实验

这个目录集中管理从 PDF 或手机照片识别鼓谱的实验代码、测试说明和结果报告。

OMR（Optical Music Recognition，光学音乐识谱）负责把谱面图片转换成结构化乐谱；OCR 只负责识别标题、速度、注释等普通文字。本实验优先测试 Audiveris 对印刷总谱和鼓谱的处理能力，再决定哪些阶段值得复用，哪些阶段需要自行实现。

## 目录

- `scripts/`：可重复运行的测试脚本。
- `docs/`：按样本记录输入特征、运行参数、识别结果和结论。
- `input/`：本地测试 PDF 或照片。已加入 `.gitignore`，不要提交原始谱面。
- `runs/`：Audiveris 的 `.omr`、`.mxl`、截图和日志。已加入 `.gitignore`。

## Audiveris 基线

本机使用用户级安装的 Audiveris：

```text
~/Applications/Audiveris.app
```

对 PDF 的第 2 页运行：

```bash
./experiments/drum-omr/scripts/run_audiveris_page.sh \
  experiments/drum-omr/input/男孩别哭111.pdf \
  2 \
  experiments/drum-omr/runs/boy-dont-cry-page2
```

脚本会启用 Audiveris 的鼓谱模式，同时保留总谱中的普通五线谱设置。运行结果和日志都在第三个参数指定的目录中。

如果需要打开额外的 Audiveris 处理开关，可以把参数接在运行目录之后，例如识别吉他六线谱：

```bash
./experiments/drum-omr/scripts/run_audiveris_page.sh \
  experiments/drum-omr/input/男孩别哭111.pdf \
  2 \
  experiments/drum-omr/runs/boy-dont-cry-page2-six-string-tab \
  -constant org.audiveris.omr.sheet.ProcessingSwitches.sixStringTablatures=true
```

## 评估原则

每个样本至少记录四层结果：

1. 页面和谱表定位是否正确。
2. 鼓声部是否与其他乐器声部正确分离。
3. 音符、音符头形状、鼓件位置和节奏是否正确。
4. MusicXML 是否能被 MuseScore 等软件打开并播放，MIDI 是否只是最终导出结果。

如果某一步失败，要记录“在哪个阶段失败”和“是否由输入版面习惯导致”，不要把尚未执行的音符识别误判成识别准确率为零。
