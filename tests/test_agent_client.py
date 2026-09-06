"""_StripNativeToolParts capability 的单元测试（不碰网络）。

背景：Kimi 等 Anthropic 兼容端点不支持把 native 工具的 server_tool_use /
web_search_tool_result beta 块回传（400 tool_call_id is not found），
所以发给模型前要剥掉；run 的权威历史不动。
"""
import asyncio
import json
from types import SimpleNamespace

from pydantic_ai.messages import (
    ModelRequest,
    ModelResponse,
    NativeToolCallPart,
    NativeToolReturnPart,
    SystemPromptPart,
    TextPart,
    UserPromptPart,
)

from src.agent_client import (
    _SUMMARY_PREFIX,
    _StripNativeToolParts,
    _TrackedSummarizingCompaction,
    _generate_accompaniment_tool,
    emergency_trim_history,
    history_from_dicts,
    is_context_overflow,
)


def _run_strip(messages):
    cap = _StripNativeToolParts()
    ctx = SimpleNamespace(messages=list(messages))
    return asyncio.run(cap.before_model_request(None, ctx)).messages


def test_strips_native_tool_parts_keeps_text():
    messages = [
        ModelRequest(parts=[UserPromptPart(content="q")]),
        ModelResponse(parts=[
            NativeToolCallPart(tool_name="web_search", args={"query": "x"}, tool_call_id="c1"),
            NativeToolReturnPart(tool_name="web_search", content="[]", tool_call_id="c1"),
            TextPart(content="正文保留"),
        ]),
        ModelRequest(parts=[UserPromptPart(content="追问")]),
    ]
    cleaned = _run_strip(messages)

    assert len(cleaned) == 3
    response = cleaned[1]
    assert [type(p) for p in response.parts] == [TextPart]
    assert response.parts[0].content == "正文保留"
    # 原历史对象不被就地修改（run 的权威历史要保留完整部件）
    assert len(messages[1].parts) == 3


def test_drops_response_that_has_only_native_parts():
    messages = [
        ModelRequest(parts=[UserPromptPart(content="q")]),
        ModelResponse(parts=[
            NativeToolReturnPart(tool_name="web_search", content="[]", tool_call_id="c1"),
        ]),
        ModelRequest(parts=[UserPromptPart(content="追问")]),
    ]
    cleaned = _run_strip(messages)
    assert len(cleaned) == 2
    assert all(isinstance(m, ModelRequest) for m in cleaned)


def test_noop_without_native_parts():
    messages = [
        ModelRequest(parts=[UserPromptPart(content="q")]),
        ModelResponse(parts=[TextPart(content="a")]),
    ]
    cleaned = _run_strip(messages)
    assert [type(p) for m in cleaned for p in m.parts] == [UserPromptPart, TextPart]


def test_history_from_dicts_maps_system_role_to_system_prompt_part():
    """压缩摘要条目（role=system）要重建回 SystemPromptPart——incremental 摘要
    靠 content 前缀认出它。"""
    messages = history_from_dicts([
        {"role": "system", "content": _SUMMARY_PREFIX + "之前的摘要"},
        {"role": "user", "content": "q"},
        {"role": "assistant", "content": "a"},
    ])
    assert len(messages) == 3
    assert isinstance(messages[0], ModelRequest)
    assert isinstance(messages[0].parts[0], SystemPromptPart)
    assert messages[0].parts[0].content.startswith(_SUMMARY_PREFIX)


def test_is_context_overflow_patterns():
    assert is_context_overflow("ModelHTTPError: status_code: 400, body: prompt is too long")
    assert is_context_overflow("Error: context_length_exceeded")
    assert is_context_overflow("status_code: 413")
    assert not is_context_overflow("ModelHTTPError: status_code: 401, unauthorized")
    assert not is_context_overflow("status_code: 400, tool_call_id is not found")


def test_emergency_trim_history_halves_and_pins_summary():
    summary = ModelRequest(parts=[SystemPromptPart(content=_SUMMARY_PREFIX + "摘要")])
    pairs = []
    for i in range(4):
        pairs.append(ModelRequest(parts=[UserPromptPart(content=f"q{i}")]))
        pairs.append(ModelResponse(parts=[TextPart(content=f"a{i}")]))
    messages = [summary, *pairs]

    trimmed = emergency_trim_history(messages)
    # 摘要钉住；8 条 QA 砍一半剩 4 条，且首条必须是 ModelRequest
    assert trimmed[0] is summary
    assert len(trimmed) == 1 + 4
    assert isinstance(trimmed[1], ModelRequest)


def test_emergency_trim_history_without_summary_keeps_request_first():
    pairs = []
    for i in range(3):
        pairs.append(ModelRequest(parts=[UserPromptPart(content=f"q{i}")]))
        pairs.append(ModelResponse(parts=[TextPart(content=f"a{i}")]))
    trimmed = emergency_trim_history(pairs)
    assert isinstance(trimmed[0], ModelRequest)
    assert len(trimmed) < len(pairs)


def test_tracked_summarizing_compaction_records_summary():
    """FunctionModel 集成：TieredCompaction 驱动 tracked tier 后，
    last_summary（带前缀）和 last_covers 被记录下来——这是落盘的数据源。"""
    from pydantic_ai import Agent
    from pydantic_ai.models.function import FunctionModel
    from pydantic_ai_harness.compaction import TieredCompaction

    def main_model(messages, info):
        return ModelResponse(parts=[TextPart(content="回答")])

    def summary_model(messages, info):
        return ModelResponse(parts=[TextPart(content="压缩出来的摘要")])

    tracked = _TrackedSummarizingCompaction(
        model=FunctionModel(summary_model),
        keep_messages=2,
        max_messages=1,  # 校验要求设置；被 TieredCompaction 接管驱动，不是实际触发条件
    )
    agent = Agent(
        FunctionModel(main_model),
        capabilities=[TieredCompaction(tiers=[tracked], target_tokens=10)],
    )
    history = []
    for i in range(4):
        history.append(ModelRequest(parts=[UserPromptPart(content=f"旧问题{i}" + "长" * 20)]))
        history.append(ModelResponse(parts=[TextPart(content=f"旧回答{i}" + "长" * 20)]))

    result = agent.run_sync("新问题", message_history=history)
    assert result.output == "回答"
    assert tracked.last_summary is not None
    assert tracked.last_summary.startswith(_SUMMARY_PREFIX)
    assert "压缩出来的摘要" in tracked.last_summary
    assert 0 < tracked.last_covers <= len(history)


# ── generate_accompaniment 工具（把和弦进行预览开放给助教，见 agent_api 的
# 系统提示词和 agent-assistant.js 的 widget 渲染）──────────────────────────


def test_generate_accompaniment_tool_returns_widget_envelope():
    result = json.loads(_generate_accompaniment_tool(
        key="C", style="ambient", bpm=80,
        progression=["C", "Am", "F", "G"],
    ))
    assert result["widget"] == "accompaniment_preview"
    acc = result["data"]["accompaniment"]
    assert acc["key"] == "C"
    assert acc["style"] == "ambient"
    assert acc["bpm"] == 80
    assert [bar["chords"][0]["name"] for bar in acc["bars"]] == ["C", "Am", "F", "G"]
    assert "note" not in result["data"]


def test_generate_accompaniment_tool_falls_back_to_pop_for_unknown_style():
    result = json.loads(_generate_accompaniment_tool(
        key="C", style="not-a-real-style", bpm=120, progression=["C", "G"],
    ))
    assert result["data"]["accompaniment"]["style"] == "pop"


def test_generate_accompaniment_tool_rejects_empty_progression():
    result = _generate_accompaniment_tool(key="C", style="pop", bpm=120, progression=[])
    assert result.startswith("Error:")


def test_generate_accompaniment_tool_strips_slash_bass_and_notes_it():
    # 复现原始 bug：gen_accompaniment_midi.parse_chord 不认 "X/Y" 转位记法，
    # 之前会一路传到 /api/play 才 500——现在在工具这一层就简化掉并如实告知模型。
    result = json.loads(_generate_accompaniment_tool(
        key="Cm", style="ambient", bpm=80,
        progression=["Cm", "G/B", "Bb", "F/A", "Ab", "Eb/G", "F#dim7", "G", "Cm"],
    ))
    acc = result["data"]["accompaniment"]
    assert [bar["chords"][0]["name"] for bar in acc["bars"]] == [
        "Cm", "G", "Bb", "F", "Ab", "Eb", "F#dim7", "G", "Cm",
    ]
    assert "G/B -> G" in result["data"]["note"]
    assert "F/A -> F" in result["data"]["note"]


def test_generate_accompaniment_tool_rejects_unparseable_chord():
    result = _generate_accompaniment_tool(key="C", style="pop", bpm=120, progression=["C", "Hmaj9"])
    assert result.startswith("Error:")
    assert "Hmaj9" in result
