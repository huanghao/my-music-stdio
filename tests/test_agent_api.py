import asyncio
import json
from importlib import reload

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import src.agent_api as agent_api
from src import agent_sessions


@pytest.fixture
def agent_api_client(monkeypatch, tmp_path):
    reload(agent_api)
    monkeypatch.setattr(agent_api.agent_ledger, "record_run", lambda entry: None)
    monkeypatch.setenv(agent_api.agent_sessions.SESSIONS_DIR_ENV, str(tmp_path))
    app = FastAPI()
    app.include_router(agent_api.router)
    return TestClient(app)


def _sse_payloads(text: str) -> list[dict]:
    payloads = []
    for event in text.split("\n\n"):
        data_line = next(
            (line for line in event.splitlines() if line.startswith("data: ")),
            None,
        )
        if data_line is None:
            continue
        payloads.append(json.loads(data_line.removeprefix("data: ")))
    return payloads


def _post_run_and_collect_events(client: TestClient, body: dict) -> str:
    """Start a run via POST /runs and drain its full SSE event stream."""
    r = client.post("/api/agent/runs", json=body)
    assert r.status_code == 200
    run_id = r.json()["run_id"]
    events = client.get(f"/api/agent/runs/{run_id}/events")
    assert events.status_code == 200
    return events.text


def test_agent_run_retries_empty_error_once(agent_api_client, monkeypatch):
    calls = 0

    async def fake_stream_parts(**kwargs):
        nonlocal calls
        calls += 1
        meta = kwargs.get("meta")
        if meta is not None:
            meta.update({
                "duration_ms": 123,
                "num_turns": 1,
                "usage": {"input_tokens": 10},
                "model_usage": ["fake-model"],
            })
        if calls == 1:
            yield ("error", "backend fake: Reached maximum number of turns (3)")
            return
        yield ("text", "ok")

    monkeypatch.setattr(agent_api.agent_client, "stream_parts", fake_stream_parts)
    payloads = _sse_payloads(_post_run_and_collect_events(agent_api_client, {"question": "hello"}))
    assert [item["type"] for item in payloads] == ["retry", "delta", "meta", "done"]
    assert payloads[0]["reason"] == "backend fake: Reached maximum number of turns (3)"
    assert payloads[1]["text"] == "ok"
    assert payloads[2]["model"] == "fake-model"
    assert payloads[2]["ctx_tokens"] == 10
    assert calls == 2


def test_agent_run_does_not_retry_after_text_was_sent(agent_api_client, monkeypatch):
    calls = 0

    async def fake_stream_parts(**kwargs):
        nonlocal calls
        calls += 1
        yield ("text", "partial")
        yield ("error", "late failure")

    monkeypatch.setattr(agent_api.agent_client, "stream_parts", fake_stream_parts)
    payloads = _sse_payloads(_post_run_and_collect_events(agent_api_client, {"question": "hello"}))
    assert [item["type"] for item in payloads] == ["delta", "error", "meta", "done"]
    assert payloads[0]["text"] == "partial"
    assert payloads[1]["message"] == "late failure"
    assert calls == 1


def test_agent_run_reports_context_hits_and_clips_prompt(agent_api_client, monkeypatch):
    captured = {}

    async def fake_stream_parts(**kwargs):
        captured["prompt"] = kwargs["prompt"]
        yield ("text", "ok")

    monkeypatch.setattr(agent_api.agent_client, "stream_parts", fake_stream_parts)
    text = _post_run_and_collect_events(agent_api_client, {
        "question": "explain this",
        "context": {
            "page": "test-page",
            "title": "Test Page",
            "visibleText": "v" * 7000,
            "selectedText": "s" * 2500,
            "data": {"items": list(range(45)), "label": "shape"},
        },
    })

    prompt = captured["prompt"]
    assert "[页面上下文]" in prompt
    assert "[用户问题]\nexplain this" in prompt
    assert "truncated 1000 chars" in prompt
    assert "truncated 500 chars" in prompt
    assert "_truncated_items" in prompt

    payloads = _sse_payloads(text)
    meta = next(item for item in payloads if item["type"] == "meta")
    assert meta["context_hits"] == [
        "页面：Test Page",
        "可见文本",
        "用户选中文本",
        "结构化数据：items, label",
    ]
    assert meta["context_chars"] == len(prompt)


def test_agent_run_events_resume_from_cursor(agent_api_client, monkeypatch):
    async def fake_stream_parts(**kwargs):
        yield ("text", "first")
        yield ("text", "second")

    monkeypatch.setattr(agent_api.agent_client, "stream_parts", fake_stream_parts)
    r = agent_api_client.post("/api/agent/runs", json={"question": "hello"})
    assert r.status_code == 200
    run_id = r.json()["run_id"]

    first = agent_api_client.get(f"/api/agent/runs/{run_id}/events")
    assert first.status_code == 200
    first_payloads = _sse_payloads(first.text)
    assert [item["type"] for item in first_payloads] == ["delta", "delta", "meta", "done"]
    assert [item["text"] for item in first_payloads[:2]] == ["first", "second"]

    resumed = agent_api_client.get(f"/api/agent/runs/{run_id}/events?cursor=1")
    assert resumed.status_code == 200
    resumed_payloads = _sse_payloads(resumed.text)
    assert [item["type"] for item in resumed_payloads] == ["delta", "meta", "done"]
    assert resumed_payloads[0]["text"] == "second"


def test_agent_run_cancel_emits_error_and_done(agent_api_client, monkeypatch):
    async def fake_stream_parts(**kwargs):
        yield ("thinking", "still working")
        await asyncio.sleep(60)

    monkeypatch.setattr(agent_api.agent_client, "stream_parts", fake_stream_parts)
    r = agent_api_client.post("/api/agent/runs", json={"question": "hello"})
    assert r.status_code == 200
    run_id = r.json()["run_id"]

    cancelled = agent_api_client.delete(f"/api/agent/runs/{run_id}")
    assert cancelled.status_code == 200

    events = agent_api_client.get(f"/api/agent/runs/{run_id}/events")
    assert events.status_code == 200
    payloads = _sse_payloads(events.text)
    assert payloads[-2:] == [
        {"type": "error", "message": "已取消"},
        {"type": "done"},
    ]


def test_agent_run_followup_queues_into_busy_session(agent_api_client, monkeypatch):
    """busy 会话上的 followup:true：不 409、不打断当前 run——问题落盘为
    user 条目，包装后的 prompt 排进 run 的 followup_queue（由 stream_parts
    里的转发协程 enqueue 给进行中的 pydantic-ai run）。"""
    async def fake_stream_parts(**kwargs):
        yield ("thinking", "still working")
        await asyncio.sleep(60)

    monkeypatch.setattr(agent_api.agent_client, "stream_parts", fake_stream_parts)
    r = agent_api_client.post("/api/agent/runs", json={"question": "hello", "session_id": "s-fu"})
    run_id = r.json()["run_id"]
    # TestClient 会在响应结束后立即取消后台任务（finally 随之清掉登记表），
    # 而 uvicorn 下任务会持续存活——这里直接恢复"仍在流式"的登记状态来测排队。
    agent_api._session_active_run["s-fu"] = run_id

    fu = agent_api_client.post("/api/agent/runs", json={
        "question": "排队追问", "session_id": "s-fu", "followup": True,
    })
    assert fu.status_code == 200
    assert fu.json()["queued"] is True
    assert fu.json()["run_id"] == run_id
    assert fu.json()["session_id"] == "s-fu"

    run = agent_api._agent_runs[run_id]
    queued_prompt = run.followup_queue.get_nowait()
    assert "[用户问题]\n排队追问" in queued_prompt
    # 追问已落盘（run 没了也能作为未回答气泡恢复出来）
    assert agent_sessions.load_messages("s-fu")[-1]["content"] == "排队追问"

    agent_api_client.delete(f"/api/agent/runs/{run_id}")


def test_agent_run_followup_on_idle_session_runs_normally(agent_api_client, monkeypatch):
    """followup:true 但会话并不 busy（run 刚好结束了的竞态）：按正常提问处理。"""
    monkeypatch.setattr(agent_api.agent_client, "stream_parts", lambda **kw: _fake_ok_stream(**kw))
    r = agent_api_client.post("/api/agent/runs", json={
        "question": "普通问题", "session_id": "s-fu-idle", "followup": True,
    })
    assert r.status_code == 200
    assert "queued" not in r.json()
    _post_run_and_collect_events2(agent_api_client, r.json()["run_id"])
    messages = agent_api_client.get("/api/agent/sessions/s-fu-idle").json()["messages"]
    assert [m["content"] for m in messages] == ["普通问题", "回答内容"]


def test_agent_run_followup_event_splits_segments(agent_api_client, monkeypatch):
    """stream_parts 的 ("followup", "") 边界：之前的回答段立刻作为完整答案
    落盘（防后续取消把它弄丢），SSE 上发 {"type":"followup"} 让前端另起气泡。"""
    async def fake_stream_parts(**kwargs):
        meta = kwargs.get("meta")
        if meta is not None:
            meta.update({"duration_ms": 5, "usage": {"input_tokens": 1},
                         "model_usage": ["fake-model"]})
        yield ("text", "第一段回答")
        # 模拟 busy 分支在 run 中途落盘的追问 user 条目
        agent_sessions.append_user("s-seg", "排队的追问")
        yield ("followup", "")
        yield ("text", "追问的回答")

    monkeypatch.setattr(agent_api.agent_client, "stream_parts", fake_stream_parts)
    r = agent_api_client.post("/api/agent/runs", json={"question": "原问题", "session_id": "s-seg"})
    run_id = r.json()["run_id"]
    _post_run_and_collect_events2(agent_api_client, run_id)

    payloads = _sse_payloads(agent_api_client.get(f"/api/agent/runs/{run_id}/events").text)
    assert [p["type"] for p in payloads] == ["delta", "followup", "delta", "meta", "done"]

    messages = agent_api_client.get("/api/agent/sessions/s-seg").json()["messages"]
    assert [(m["role"], m["content"]) for m in messages] == [
        ("user", "原问题"), ("user", "排队的追问"),
        ("assistant", "第一段回答"), ("assistant", "追问的回答"),
    ]
    # prompt 历史按 FIFO 配对：追问的回答配追问，不错配
    history = agent_sessions.load_history_for_prompt("s-seg", 8, 2000)
    assert [m["content"] for m in history] == [
        "原问题", "第一段回答", "排队的追问", "追问的回答",
    ]


def test_agent_run_forwards_tool_events(agent_api_client, monkeypatch):
    async def fake_stream_parts(**kwargs):
        yield ("tool", '{"name": "read", "args": {"path": "x.md"}, "result_preview": "1\\thi"}')
        yield ("text", "ok")

    monkeypatch.setattr(agent_api.agent_client, "stream_parts", fake_stream_parts)
    payloads = _sse_payloads(_post_run_and_collect_events(agent_api_client, {"question": "hello"}))
    assert [item["type"] for item in payloads] == ["tool", "delta", "meta", "done"]
    assert payloads[0]["name"] == "read"
    assert payloads[0]["args"] == {"path": "x.md"}


def test_agent_run_forwards_widget_events_and_persists_them(agent_api_client, monkeypatch):
    widget_json = json.dumps({
        "widget": "accompaniment_preview",
        "data": {"accompaniment": {"key": "Cm", "style": "ambient", "bpm": 80, "bars": []}},
    })

    async def fake_stream_parts(**kwargs):
        yield ("widget", json.dumps({"name": "generate_accompaniment", "args": {}, **json.loads(widget_json)}))
        yield ("text", "试听一下")

    monkeypatch.setattr(agent_api.agent_client, "stream_parts", fake_stream_parts)
    payloads = _sse_payloads(_post_run_and_collect_events(
        agent_api_client, {"question": "生成一个和弦进行", "session_id": "sess-widget"},
    ))
    assert [item["type"] for item in payloads] == ["widget", "delta", "meta", "done"]
    assert payloads[0]["widget"] == "accompaniment_preview"
    assert payloads[0]["data"]["accompaniment"]["key"] == "Cm"

    detail = agent_api_client.get("/api/agent/sessions/sess-widget")
    messages = detail.json()["messages"]
    assert messages[1]["widgets"] == [{
        "name": "generate_accompaniment", "args": {}, **json.loads(widget_json),
    }]


def test_agent_providers_lists_models_and_thinking_levels(agent_api_client, monkeypatch):
    from src.agent_client import AgentModel, AgentProvider

    fake = [
        AgentProvider(
            name="fake",
            description="fake provider",
            api_key_env="FAKE_KEY",
            default=True,
            models=[AgentModel(name="fake-model", context_window=1000, thinking_levels=["off", "high"])],
        )
    ]
    monkeypatch.setattr(agent_api.agent_client, "discover_providers", lambda: fake)
    r = agent_api_client.get("/api/agent/providers")
    assert r.status_code == 200
    body = r.json()
    assert body == [{
        "name": "fake",
        "description": "fake provider",
        "default": True,
        "unavailable_reason": "环境变量 FAKE_KEY 未设置",
        "models": [{"name": "fake-model", "context_window": 1000, "thinking_levels": ["off", "high"]}],
    }]


def _fake_ok_stream(**kwargs):
    async def gen():
        meta = kwargs.get("meta")
        if meta is not None:
            meta.update({"duration_ms": 5, "usage": {"input_tokens": 1},
                         "model_usage": ["fake-model"]})
        yield ("text", "回答内容")
    return gen()


def test_agent_run_persists_turn_to_session(agent_api_client, monkeypatch):
    monkeypatch.setattr(agent_api.agent_client, "stream_parts", lambda **kw: _fake_ok_stream(**kw))
    r = agent_api_client.post("/api/agent/runs", json={"question": "第一问", "session_id": "sess1"})
    assert r.status_code == 200
    assert r.json()["session_id"] == "sess1"
    _post_run_and_collect_events2(agent_api_client, r.json()["run_id"])

    detail = agent_api_client.get("/api/agent/sessions/sess1")
    assert detail.status_code == 200
    messages = detail.json()["messages"]
    assert [m["role"] for m in messages] == ["user", "assistant"]
    assert messages[0]["content"] == "第一问"
    assert messages[1]["content"] == "回答内容"
    assert messages[1]["model"] == "fake-model"

    listing = agent_api_client.get("/api/agent/sessions").json()
    assert [s["id"] for s in listing] == ["sess1"]
    assert listing[0]["title"] == "第一问"
    assert listing[0]["message_count"] == 2


def _post_run_and_collect_events2(client, run_id):
    events = client.get(f"/api/agent/runs/{run_id}/events")
    assert events.status_code == 200
    return events.text


def test_agent_run_seeds_localstorage_history_on_first_ask(agent_api_client, monkeypatch):
    monkeypatch.setattr(agent_api.agent_client, "stream_parts", lambda **kw: _fake_ok_stream(**kw))
    r = agent_api_client.post("/api/agent/runs", json={
        "question": "第三问",
        "session_id": "seeded",
        "history": [
            {"role": "user", "content": "旧问题1"},
            {"role": "assistant", "content": "旧回答1"},
        ],
    })
    assert r.status_code == 200
    _post_run_and_collect_events2(agent_api_client, r.json()["run_id"])

    messages = agent_api_client.get("/api/agent/sessions/seeded").json()["messages"]
    assert [m["content"] for m in messages] == ["旧问题1", "旧回答1", "第三问", "回答内容"]


def test_agent_run_retry_voids_last_turn(agent_api_client, monkeypatch):
    monkeypatch.setattr(agent_api.agent_client, "stream_parts", lambda **kw: _fake_ok_stream(**kw))
    r = agent_api_client.post("/api/agent/runs", json={"question": "原始问题", "session_id": "s-retry"})
    _post_run_and_collect_events2(agent_api_client, r.json()["run_id"])

    r2 = agent_api_client.post("/api/agent/runs", json={
        "question": "原始问题", "session_id": "s-retry", "retry": True,
    })
    assert r2.status_code == 200
    _post_run_and_collect_events2(agent_api_client, r2.json()["run_id"])

    contents = [m["content"] for m in agent_api_client.get("/api/agent/sessions/s-retry").json()["messages"]]
    assert contents == ["原始问题", "回答内容"]  # 第一轮被 voided，只剩重试这轮


def test_agent_run_cancel_marks_turn_interrupted_in_session(agent_api_client, monkeypatch):
    """取消（pagehide 的 keepalive DELETE）：当前段已流出的部分落 interrupted
    墓碑，展示保留但不进 prompt。"""
    async def fake_stream_parts(**kwargs):
        yield ("text", "说到一半")
        await asyncio.sleep(60)

    monkeypatch.setattr(agent_api.agent_client, "stream_parts", fake_stream_parts)
    r = agent_api_client.post("/api/agent/runs", json={"question": "被打断的问题", "session_id": "s-steer"})
    run_id = r.json()["run_id"]
    agent_api_client.delete(f"/api/agent/runs/{run_id}")

    messages = agent_api_client.get("/api/agent/sessions/s-steer").json()["messages"]
    assert [m["role"] for m in messages] == ["user", "assistant"]
    assert messages[1]["interrupted"] is True
    assert messages[1]["content"] == "说到一半"


def test_agent_run_cancel_after_followup_tombstones_current_segment_only(agent_api_client, monkeypatch):
    """followup 边界之前的段已经作为完整答案落盘；取消时墓碑只记当前段的
    partial，不能把已落盘的第一段重复算进去。"""
    async def fake_stream_parts(**kwargs):
        yield ("text", "完整的第一段")
        # 模拟 busy 分支在 run 中途落盘的追问 user 条目
        agent_sessions.append_user("s-seg-cancel", "追问")
        yield ("followup", "")
        yield ("text", "追问说到一半")
        await asyncio.sleep(60)

    monkeypatch.setattr(agent_api.agent_client, "stream_parts", fake_stream_parts)
    r = agent_api_client.post("/api/agent/runs", json={"question": "原问题", "session_id": "s-seg-cancel"})
    run_id = r.json()["run_id"]
    agent_api_client.delete(f"/api/agent/runs/{run_id}")

    messages = agent_api_client.get("/api/agent/sessions/s-seg-cancel").json()["messages"]
    by_content = {m["content"]: m for m in messages if m["role"] == "assistant"}
    # 第一段是正常完成的回答；追问段是被打断的 partial
    assert "完整的第一段" in by_content
    assert by_content["完整的第一段"].get("interrupted") is None
    assert by_content["追问说到一半"]["interrupted"] is True
    # prompt 历史：只有完整的第一段，中断的 partial 不进
    history = agent_sessions.load_history_for_prompt("s-seg-cancel", 8, 2000)
    assert [m["content"] for m in history] == ["原问题", "完整的第一段"]


def test_agent_run_same_session_busy_returns_409(agent_api_client, monkeypatch):
    async def fake_stream_parts(**kwargs):
        yield ("thinking", "working")
        await asyncio.sleep(60)

    monkeypatch.setattr(agent_api.agent_client, "stream_parts", fake_stream_parts)
    r = agent_api_client.post("/api/agent/runs", json={"question": "q", "session_id": "s-busy"})
    assert r.status_code == 200
    # TestClient 会在响应结束后立即取消后台任务（finally 随之清掉登记表），
    # 而 uvicorn 下任务会持续存活——这里直接恢复"仍在流式"的登记状态来测 409。
    agent_api._session_active_run["s-busy"] = r.json()["run_id"]
    again = agent_api_client.post("/api/agent/runs", json={"question": "q2", "session_id": "s-busy"})
    assert again.status_code == 409
    # 另一个会话不受影响
    other = agent_api_client.post("/api/agent/runs", json={"question": "q", "session_id": "s-other"})
    assert other.status_code == 200
    agent_api_client.delete(f"/api/agent/runs/{r.json()['run_id']}")
    agent_api_client.delete(f"/api/agent/runs/{other.json()['run_id']}")


def test_agent_run_invalid_session_id_rejected(agent_api_client, monkeypatch):
    monkeypatch.setattr(agent_api.agent_client, "stream_parts", lambda **kw: _fake_ok_stream(**kw))
    r = agent_api_client.post("/api/agent/runs", json={"question": "q", "session_id": "../bad"})
    assert r.status_code == 400


def test_agent_session_detail_and_delete_404s(agent_api_client):
    assert agent_api_client.get("/api/agent/sessions/nope").status_code == 404
    assert agent_api_client.delete("/api/agent/sessions/nope").status_code == 404
    assert agent_api_client.get("/api/agent/sessions/../bad").status_code in (400, 404)


def test_agent_session_delete_removes_history(agent_api_client, monkeypatch):
    monkeypatch.setattr(agent_api.agent_client, "stream_parts", lambda **kw: _fake_ok_stream(**kw))
    r = agent_api_client.post("/api/agent/runs", json={"question": "q", "session_id": "s-del"})
    _post_run_and_collect_events2(agent_api_client, r.json()["run_id"])

    assert agent_api_client.delete("/api/agent/sessions/s-del").status_code == 200
    assert agent_api_client.get("/api/agent/sessions/s-del").status_code == 404
    assert agent_api_client.get("/api/agent/sessions").json() == []


def test_agent_run_persists_compaction_entry(agent_api_client, monkeypatch):
    """stream_parts 上报 meta["compaction"] 时，run 结束后落 compacted 条目，
    下一轮 load_history_for_prompt 用摘要替代被覆盖的前缀。"""
    async def fake_stream_parts(**kwargs):
        meta = kwargs.get("meta")
        if meta is not None:
            meta.update({
                "duration_ms": 5, "usage": {"input_tokens": 1},
                "model_usage": ["fake-model"],
                "compaction": {
                    "summary": "Summary of previous conversation:\n\n第一轮谈了三和弦",
                    "covers": 2,
                },
            })
        yield ("text", "回答")

    monkeypatch.setattr(agent_api.agent_client, "stream_parts", fake_stream_parts)
    # 先造两轮历史（不触发压缩上报）
    monkeypatch.setattr(agent_api.agent_client, "is_context_overflow", lambda e: False)
    agent_sessions.create_session("s-comp")
    agent_sessions.append_user("s-comp", "q0")
    agent_sessions.append_assistant("s-comp", "a0", {})
    agent_sessions.append_user("s-comp", "q1")
    agent_sessions.append_assistant("s-comp", "a1", {})

    _post_run_and_collect_events(agent_api_client, {"question": "q2", "session_id": "s-comp"})

    # 下一轮的历史：摘要（覆盖 q0/a0）+ q1/a1 + q2/回答
    history = agent_sessions.load_history_for_prompt("s-comp", 100, 2000)
    assert history[0]["role"] == "system"
    assert "第一轮谈了三和弦" in history[0]["content"]
    assert [m["content"] for m in history[1:]] == ["q1", "a1", "q2", "回答"]


def test_agent_run_overflow_trims_history_and_retries(agent_api_client, monkeypatch):
    """压缩估算漏了、API 真的返回超长错误时：紧急砍掉一半历史再重试一次，
    而不是拿同样历史再撞一次。"""
    seen_histories = []

    async def fake_stream_parts(**kwargs):
        history = kwargs.get("message_history") or []
        seen_histories.append(len(history))
        if len(seen_histories) == 1:
            yield ("error", "ModelHTTPError: status_code: 400, body: prompt is too long")
            return
        meta = kwargs.get("meta")
        if meta is not None:
            meta.update({"duration_ms": 5, "usage": {"input_tokens": 1},
                         "model_usage": ["fake-model"]})
        yield ("text", "裁剪后回答")

    monkeypatch.setattr(agent_api.agent_client, "stream_parts", fake_stream_parts)
    agent_sessions.create_session("s-overflow")
    for i in range(3):
        agent_sessions.append_user("s-overflow", f"q{i}")
        agent_sessions.append_assistant("s-overflow", f"a{i}", {})

    payloads = _sse_payloads(_post_run_and_collect_events(
        agent_api_client, {"question": "q3", "session_id": "s-overflow"}
    ))
    assert [p["type"] for p in payloads] == ["retry", "delta", "meta", "done"]
    assert seen_histories[0] == 6  # 3 轮完整历史
    assert seen_histories[1] < 6   # 重试时历史被裁剪
    assert any("prompt is too long" in p.get("reason", "") for p in payloads)
