# 延迟监控方案设计

> 适用项目：音乐练习工作站（Python FastAPI + pyfluidsynth + 未来吉他实时音高检测）

---

## 1. 为什么延迟对练习软件重要

人耳对延迟的感知有明确阈值：

| 延迟范围 | 主观感受 |
|---------|---------|
| < 10ms | 感知不到，等同于"实时" |
| 10–30ms | 轻微可察觉，大多数人可接受 |
| > 30ms | 明显的"回声感"，干扰演奏节奏 |
| > 100ms | 完全破坏演奏感，无法使用 |

**吉他练习场景的具体影响：**
- 弹下一个音 → 听到伴奏反馈的延迟超过 30ms，会导致演奏者下意识提前或推迟下一个音，破坏节奏感。
- 推弦、滑音等连续音高变化，若检测延迟过高，屏幕反馈会明显滞后，影响练习效果。
- 伴奏起拍延迟（点 Play 到第一个音）超过 200ms 会让用户感觉"卡顿"，影响使用体验。

---

## 2. 延迟来源分层分析

```
吉他弦振动
    ↓ [声卡输入 buffer]         硬件层：5–20ms（取决于 buffer size，通常 128–512 frames）
    ↓ [CoreAudio driver buffer]  系统层：2–10ms（macOS 默认约 5ms）
    ↓ [音高检测算法窗口]         算法层：20–50ms（YIN 需要约 2048 samples @ 44100Hz ≈ 46ms）
    ↓ [MIDI 生成耗时]            软件层：1–10ms（build_track + mido.save）
    ↓ [soundfont 加载时间]       启动层：200–2000ms（仅第一次，后续可忽略）
    ↓ [pyfluidsynth 输出 buffer] 播放层：5–20ms
    ↓
用户听到反馈
```

**端到端 round-trip 估算（接入吉他后）：**

| 场景 | 估算延迟 |
|-----|---------|
| 最优（小 buffer，快算法） | ~50ms |
| 典型配置 | ~80–120ms |
| 默认大 buffer | ~150ms+ |

---

## 3. 现阶段可以测量的指标（伴奏播放阶段）

目前没有接入吉他，重点测量伴奏生成和播放链路：

### 3.1 MIDI 生成耗时
- **定义**：从调用 `build_track()` 开始，到 `mido.MidiFile.save()` 完成。
- **目标**：< 50ms（用户点 Play 后的感知等待时间）。
- **埋点位置**：`/api/play` handler 内。

### 3.2 soundfont 初始化耗时
- **定义**：第一次调用 `_ensure_synth()` 的耗时（加载 .sf2 文件）。
- **目标**：记录即可，属于一次性成本，可在应用启动时预热。
- **优化方向**：应用启动时主动预加载，避免第一次 Play 时卡顿。

### 3.3 mido.play() timing 精度
- **定义**：实际播放小节时长 vs 理论时长的偏差（ms）。
- **计算方式**：`abs(actual_bar_duration - expected_bar_duration)`。
- **目标**：偏差 < 5ms/小节，累积误差 < 20ms/分钟。

---

## 4. 未来接入吉他后需要测量的指标

### 4.1 音频输入 → 音高检测延迟
- 从 PyAudio 回调触发，到 YIN/pYIN 返回 pitch 结果的时间。
- 目标：< 50ms（算法窗口决定下限，约 46ms @ 2048 frames）。

### 4.2 端到端延迟
- 从真实吉他音发出 → 屏幕显示检测结果。
- 测量方法：用已知频率的参考信号（如节拍器点击）同时触发录音和计时。
- 目标：< 100ms（可接受），< 50ms（优秀）。

### 4.3 音高检测准确率
需要在各种演奏技巧下分别评估：

| 技巧 | 挑战 | 目标准确率 |
|-----|-----|----------|
| 普通单音 | 基准 | > 95% |
| 推弦（bend） | 音高连续滑动 | > 85% |
| 滑音（slide） | 快速音高变化 | > 80% |
| 泛音（harmonic） | 泛音列，音色特殊 | > 70% |

---

## 5. 实现方案

### 5.1 现阶段：在 /api/play 返回值里加 generation_ms

**后端埋点（`time.perf_counter()`）：**

```python
import time

@router.post("/api/play")
async def play(request: PlayRequest):
    t0 = time.perf_counter()
    midi_file = build_track(request)
    midi_file.save(tmp_path)
    generation_ms = (time.perf_counter() - t0) * 1000

    # 启动播放...

    return {
        "status": "playing",
        "generation_ms": round(generation_ms, 1),
    }
```

**前端展示：**
- 在 generation status 栏里显示，例如：`生成耗时：12.3ms`。
- 颜色编码：< 50ms 绿色，50–100ms 黄色，> 100ms 红色。

### 5.2 未来：独立的 /api/metrics 端点 + Debug 面板

**端点设计：**

```
GET /api/metrics
返回：
{
  "soundfont_init_ms": 850,       // 首次加载耗时
  "last_generation_ms": 12.3,     // 最近一次 MIDI 生成耗时
  "play_timing_drift_ms": 2.1,    // 最近一次小节 timing 偏差
  "pitch_detection_ms": null,     // 未接入时为 null
  "e2e_latency_ms": null
}
```

**前端 Debug 面板：**
- 可折叠，默认收起。
- 展示各层延迟的实时数值和历史趋势（简单折线图）。

---

## 6. 参考标准

| 场景 | buffer size | 延迟 |
|-----|------------|-----|
| 专业录音室 | 32–64 frames | < 5ms |
| GarageBand / Logic Pro 低延迟模式 | 128 frames | ~3ms |
| GarageBand / Logic Pro 默认 | 256–512 frames | 6–12ms |
| iReal Pro（软件伴奏，无实时检测） | N/A | 主观感受约 50–100ms |
| 练习软件可接受标准 | — | < 30ms（实时反馈）|
| 本项目当前目标（伴奏生成） | — | generation < 50ms |

**结论：**
- 伴奏生成延迟（MIDI build + save）目标 < 50ms，现阶段容易达到。
- 接入吉他后，端到端延迟目标 < 100ms，核心瓶颈在音高检测算法窗口（~46ms），可通过减小 frame size 或用更轻量的算法（如 CREPE lite）来压缩。
- soundfont 加载在应用启动时预热，消除第一次 Play 的卡顿感。
