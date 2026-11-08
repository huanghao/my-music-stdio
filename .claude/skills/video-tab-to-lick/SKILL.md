---
name: video-tab-to-lick
description: 把 B 站吉他教学视频里的谱面提取成"每行 4 小节"的整齐 PDF，并连同视频一起建成一条 Lick。用户给出视频链接并说"扒谱 / 把谱子做成 lick / 用这个视频的谱子"时使用。
---

# 视频扒谱 → Lick

用户说法示例：`/video-tab-to-lick <B站链接>`，或"把这个视频的谱子做成 lick：<链接>"。可附带类型（歌曲/练习/乐队课）和标题，没说就按内容判断，标题由你起。

## 流程

1. **下载**（工具和代理见 `docs/tab-screenshots-and-video-to-score.md`）：
   `yt-dlp --cookies-from-browser chrome --no-playlist -o "%(id)s.%(ext)s" --merge-output-format mp4 -f "30080+30280/bv*+ba" URL`，
   放到 `~/workspace/my-store/tab-stitch-data/<视频目录>/`；先 `--print "%(title)s|%(duration)s"` 取标题和时长。
2. **看版式**（每个视频不一样，先看再动手）：`ffmpeg -vf "fps=1/N,scale=640:-1,tile=4x4"` 拼联系图，再截一帧原分辨率确认谱条的 y 范围（Y0、H）。分三种：
   - 谱条在画面某处，**翻页**显示 → 用脚本（下一步）。
   - 谱是**整页图**出现在视频某处（如结尾） → 直接截帧裁边放大存 PDF，不用拼接。
   - 平滑滚动 → 脚本还不支持；先用相位相关测位移，几乎全是 0 就是翻页。
3. **提取**：`experiments/tab-stitch/scripts/video_to_score.sh VIDEO OUTDIR Y0 H [FPS]`
   （内部是 video_pages → video_tab → compose_rows，参数含义见脚本头和 `docs/tab-screenshots-and-video-to-score.md`）。
   - 每页停留很短（≈2s）→ `MINN=3`；页间重叠很大 → 调大 `MAXOV`；左右角有水印 → `REG_BELOW=8`（脚本默认已是）。
4. **一定要看产出图**（`score.pdf.png`）：行是否 4 小节、小节数对不对、接缝有无错位/重影、水印残影。有问题就调参数重跑，别直接交付。
5. **发布**：`python3 -s experiments/tab-stitch/scripts/publish_lick.py "标题" score.pdf --video V.mp4 --type 歌曲 --note "来源/小节数/已知瑕疵"`
   **属于系列课程的视频**（如"某某课程 第 N 课"）必须再加 `--collection "系列名" --order N`：序号只放 `course_order`，**标题里不要再写序号**（列表和详情页会自动显示 `01 …`，并按它排序）；同一系列的 `--collection` 名字必须逐字一致。不属于系列的单条 lick 两个参数都不加。
   （服务在 localhost:3050，由 nanny 管理；不通就先启动）。
6. **优化脚本（每次都要做）**：这次遇到的新情况（版式、纸色、水印、配准、小节线…）若脚本没处理好，改脚本并做成可配置/自适应的通用逻辑，
   把经验写进 `docs/tab-screenshots-and-video-to-score.md` 的"跑过的视频"列表，只提交自己改的文件（仓库里常有别人未提交的改动，别混进去）。
7. 汇报：小节数、用了哪些参数、已知瑕疵、新建 lick 的 id；说明脚本这次改了什么。

## 约定

- 持久数据放 `~/workspace/my-store/tab-stitch-data/`，不进仓库。
- 系列课程的序号规范：`collection`（系列名）+ `course_order`（整数）两个字段一起设；标题只写课名，不带序号。已有 lick 缺这两个字段时，用 `PUT /api/licks/<id>` 补，不改标题。
- Lick 类型只有 `歌曲 / 练习 / 乐队课` 三种（存在 `tags` 里）。
- 笔记里的链接写 `[名字](/api/materials/xxx "w=775")`，不要用 `<>` 包裹。
- 不 OCR：谱面像素原样裁剪拼接，所以音符不会被识别错，被遮挡的像素只能靠相邻页补。
