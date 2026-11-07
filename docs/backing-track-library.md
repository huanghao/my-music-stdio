# 吉他伴奏素材库：分类、来源与练习选择

伴奏素材库把可播放的音频和可检索的练习信息放在一起。它的输入是创作者提供的音频下载或公开视频链接，输出是按调、速度、风格和和弦进行筛选的播放清单；它不负责生成伴奏，也不应把“视频可播放”误认为“允许下载”。

## 分类字段

每条记录至少包含标题、调/调式、速度、拍号、风格/律动、和弦进行、时长、来源链接、下载链接或本地文件、许可/使用条件、核验日期。可选字段包括适用音阶、难度、是否含主奏、段落结构和备注。调、速度、风格与和弦进行应分别记录：例如“Am、70 BPM、slow blues、12 小节变体”比单写“Am backing track”更能决定它是否适合当前练习。

## 当前目录

本地索引在 `~/workspace/my-store/my-music-stdio-data/backing-tracks.json`，当前有 8 条可在线播放候选。在应用顶部打开「伴奏库」，可按调、风格、BPM 范围和标题/和弦文字筛选；点「试听」会在页面内播放 YouTube 嵌入播放器，也可点来源打开原页面。没有确认免费下载的候选不会冒充本地文件；YouTube 免费观看不等于允许下载。

| 曲目 | 调 / 速度 / 风格 | 和弦信息 | 使用方式 |
|---|---|---|---|
| 对四：Am Back Track | Am / 未知 / blues jam | 待听辨 | [YouTube](https://www.youtube.com/watch?v=einl3CzAp1E)，在线播放 |
| Tasty Groove Blues | Am / 70 BPM / groove blues | Am、Dm9、Fmaj7、G、E7 | [YouTube](https://www.youtube.com/watch?v=znpvCw7YSpE)，页面列出和弦与速度 |
| Am Blues 70 BPM | Am / 70 BPM / blues | 待核实 | [YouTube](https://www.youtube.com/watch?v=jsHxBvBws48)，在线播放 |
| Em Pop Rock | Em / 70 BPM / pop rock | Em–C–G–D | [YouTube](https://www.youtube.com/watch?v=TrTlsjAXh5E)，在线播放 |
| Em Atmospheric Rock | Em / 72 BPM / atmospheric rock | 待听辨 | [YouTube](https://www.youtube.com/watch?v=Pnkz_67USSs)，在线播放 |
| Em Emotional Rock | Em / 76 BPM / emotional rock | 待听辨 | [YouTube](https://www.youtube.com/watch?v=FfqAexdAn4Q)，在线播放 |
| Em Minor Blues | Em / 80 BPM / minor blues | Em、Am、Bm、C、D、B7 的循环变体 | [YouTube](https://www.youtube.com/watch?v=utYGqqQfdIo)，在线播放；下载另收费的版本未收入本地音频 |
| Ambient Worship | E 大调 / 82 BPM / ambient | E–B–C#m–A | [YouTube](https://www.youtube.com/watch?v=7_M1LR0XsjM)，在线播放 |

## 练习时怎么选

1. 先按练习目标选和声：练小调布鲁斯句子选 minor blues；练流行摇滚旋律选 Em–C–G–D 这类循环；练持续音、推弦和长线条则选和弦变化较慢的 ambient。
2. 再选调。优先选手上熟悉、能专注在节奏与句子上的调；Am、Em 对标准调弦吉他很顺手，C 则适合练开放把位和大调旋律。
3. 选速度时从能放松、能准确落拍的速度开始。70、80、90 BPM 可以做阶梯，但同一个 BPM 在不同律动/细分下感觉差别很大；注意是直八、摇摆八分还是半拍感。
4. 播放前确认和弦进行与适用音阶。只有调名不足以保证某一套音阶全程合适；比如 E minor blues 的 B7 会引入 D#，自然小调音阶并非每个位置都同样贴合。
5. 收藏后记录“这条伴奏是否真的常用”。如果连续几周都找不到合适曲目，再考虑补生成能力。

一个实际选择例子：想练 A 小调布鲁斯推弦，就筛 `Am + blues + 70–80 BPM`，先听伴奏的和弦段落；若有 Dm/F/G/E7 变化，练习时在变化处明确跟随和弦音，不要只循环 A 小调五声音阶。

## 本地资料库怎么用

打开应用顶部的「伴奏库」，先按目标筛风格/和弦，再按调和速度缩小结果。点「试听」听拍感和段落；筛选不到时放宽速度或风格，不要只按调名判断音阶。

索引和选择脚本分开存放：JSON 与运行时音频位于 `~/workspace/my-store/my-music-stdio-data/`，脚本位于项目 `scripts/`。以后获得创作者授权的 MP3/M4A 后，把文件放进现有 Materials 库，再给对应 JSON 条目补上本地材料 ID。当前目录里的候选都是在线来源，没有擅自下载 YouTube 音频。

## 参考资料

- [Quist 的 Am 伴奏视频](https://www.youtube.com/watch?v=znpvCw7YSpE)
- [Quist 的 Em Blues 下载页](https://quistbackingjamtracks.bandcamp.com/track/e-minor-blues-guitar-backing-jam-track)
- [JMP 的 Em Pop Rock 视频](https://www.youtube.com/watch?v=TrTlsjAXh5E)
- [YT Jam Tracks 的 Em 氛围摇滚下载页](https://ytjamtracks.bandcamp.com/track/cool-atmospheric-melodic-rock-backing-track)
- [用户提供的 Am 视频](https://www.youtube.com/watch?v=einl3CzAp1E)
