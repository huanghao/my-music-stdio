import asyncio
import json
from importlib import reload

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import src.agent_api as agent_api


@pytest.fixture
def agent_api_client(monkeypatch):
    reload(agent_api)
    monkeypatch.setattr(agent_api.agent_ledger, "record_run", lambda entry: None)
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


def test_agent_ask_retries_empty_error_once(agent_api_client, monkeypatch):
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
    r = agent_api_client.post("/api/agent/ask", json={"question": "hello"})
    assert r.status_code == 200

    payloads = _sse_payloads(r.text)
    assert [item["type"] for item in payloads] == ["retry", "delta", "meta", "done"]
    assert payloads[0]["reason"] == "backend fake: Reached maximum number of turns (3)"
    assert payloads[1]["text"] == "ok"
    assert payloads[2]["model"] == "fake-model"
    assert payloads[2]["ctx_tokens"] == 10
    assert calls == 2


def test_agent_ask_does_not_retry_after_text_was_sent(agent_api_client, monkeypatch):
    calls = 0

    async def fake_stream_parts(**kwargs):
        nonlocal calls
        calls += 1
        yield ("text", "partial")
        yield ("error", "late failure")

    monkeypatch.setattr(agent_api.agent_client, "stream_parts", fake_stream_parts)
    r = agent_api_client.post("/api/agent/ask", json={"question": "hello"})
    assert r.status_code == 200

    payloads = _sse_payloads(r.text)
    assert [item["type"] for item in payloads] == ["delta", "error", "meta", "done"]
    assert payloads[0]["text"] == "partial"
    assert payloads[1]["message"] == "late failure"
    assert calls == 1


def test_agent_ask_reports_context_hits_and_clips_prompt(agent_api_client, monkeypatch):
    captured = {}

    async def fake_stream_parts(**kwargs):
        captured["prompt"] = kwargs["prompt"]
        yield ("text", "ok")

    monkeypatch.setattr(agent_api.agent_client, "stream_parts", fake_stream_parts)
    r = agent_api_client.post(
        "/api/agent/ask",
        json={
            "question": "explain this",
            "context": {
                "page": "test-page",
                "title": "Test Page",
                "visibleText": "v" * 7000,
                "selectedText": "s" * 2500,
                "data": {"items": list(range(45)), "label": "shape"},
            },
        },
    )
    assert r.status_code == 200

    prompt = captured["prompt"]
    assert "[页面上下文]" in prompt
    assert "[用户问题]\nexplain this" in prompt
    assert "truncated 1000 chars" in prompt
    assert "truncated 500 chars" in prompt
    assert "_truncated_items" in prompt

    payloads = _sse_payloads(r.text)
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


def test_agent_run_steer_emits_steered_and_done(agent_api_client, monkeypatch):
    async def fake_stream_parts(**kwargs):
        yield ("thinking", "still working")
        await asyncio.sleep(60)

    monkeypatch.setattr(agent_api.agent_client, "stream_parts", fake_stream_parts)
    r = agent_api_client.post("/api/agent/runs", json={"question": "hello"})
    run_id = r.json()["run_id"]

    steered = agent_api_client.delete(f"/api/agent/runs/{run_id}?reason=steer")
    assert steered.status_code == 200

    events = agent_api_client.get(f"/api/agent/runs/{run_id}/events")
    payloads = _sse_payloads(events.text)
    assert payloads[-2:] == [{"type": "steered"}, {"type": "done"}]


def test_agent_ask_forwards_tool_events(agent_api_client, monkeypatch):
    async def fake_stream_parts(**kwargs):
        yield ("tool", '{"name": "read", "args": {"path": "x.md"}, "result_preview": "1\\thi"}')
        yield ("text", "ok")

    monkeypatch.setattr(agent_api.agent_client, "stream_parts", fake_stream_parts)
    r = agent_api_client.post("/api/agent/ask", json={"question": "hello"})
    payloads = _sse_payloads(r.text)
    assert [item["type"] for item in payloads] == ["tool", "delta", "meta", "done"]
    assert payloads[0]["name"] == "read"
    assert payloads[0]["args"] == {"path": "x.md"}


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
