import asyncio
import json
import logging
import time
import uuid
from typing import Any, AsyncIterator, Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import src.agent_client as agent_client
import src.agent_ledger as agent_ledger

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent")


class AgentAskRequest(BaseModel):
    """Floating assistant request.

    `context` is a JSON snapshot the frontend computed from the active page.
    The backend only relays and clips it; it does not re-derive music theory.
    """

    question: str = Field(min_length=1, max_length=4000)
    provider: Optional[str] = None
    model: Optional[str] = None
    thinking: Optional[str] = None
    history: list[dict] = Field(default_factory=list)
    context: dict = Field(default_factory=dict)


_AGENT_CONTEXT_TEXT_LIMIT = 6000
_AGENT_CONTEXT_DATA_JSON_LIMIT = 12000
_AGENT_HISTORY_LIMIT = 8
_AGENT_HISTORY_MESSAGE_LIMIT = 2000
_AGENT_AUTO_RETRIES = 1
_AGENT_RUN_TTL_SEC = 15 * 60

_AGENT_SYSTEM_PROMPT = """你是嵌入在一个吉他练习网页 app 里的助教，飘在页面右下角随时可以被问到。

规则：
- [页面上下文] 是当前页面已经算好的真实数据（JSON），回答优先基于它，不要假装看到了它没给你的东西；缺什么就说缺什么。
- 在 Chord ID 页面，页面上下文包含当前和声进行每个和弦的罗马数字分析、检测到的终止式、同功能组替代建议，以及每个位置的备选读法（省略了哪些音、是否根音在贝斯）。回答"为什么这个更合理"时具体引用这些依据（省略了根音 vs 省略了别的音、是否落在调内音级、覆盖度高低），不要只讲泛泛乐理。
- 你是只读助教：不要声称已经修改、保存、删除、上传或操作了这个 app；如果用户要你做写入类操作，说明当前助教只能解释和建议。
- 不确定的地方直说不确定，不要编。
- 回答简洁，除非用户明确要求展开讲。
"""


def _clip_text(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return value[:limit] + f"\n...[truncated {len(value) - limit} chars]"


def _compact_agent_value(
    value: Any,
    *,
    depth: int = 0,
    list_limit: int = 80,
) -> Any:
    if depth > 5:
        return "<max-depth>"
    if isinstance(value, str):
        return _clip_text(value, 600)
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    if isinstance(value, list):
        items = [
            _compact_agent_value(item, depth=depth + 1, list_limit=list_limit)
            for item in value[:list_limit]
        ]
        if len(value) > list_limit:
            items.append({"_truncated_items": len(value) - list_limit})
        return items
    if isinstance(value, dict):
        out = {}
        for idx, (key, item) in enumerate(value.items()):
            if idx >= 80:
                out["_truncated_keys"] = len(value) - 80
                break
            out[str(key)] = _compact_agent_value(
                item, depth=depth + 1, list_limit=list_limit
            )
        return out
    return str(value)


def _agent_prompt(req: AgentAskRequest) -> tuple[str, int, list[str]]:
    context = dict(req.context or {})
    context_hits = []
    page = context.get("page") or ""
    title = context.get("title") or ""
    if page or title:
        context_hits.append(f"页面：{title or page}")
    if "visibleText" in context:
        context["visibleText"] = _clip_text(
            str(context.get("visibleText") or ""),
            _AGENT_CONTEXT_TEXT_LIMIT,
        )
        if context["visibleText"]:
            context_hits.append("可见文本")
    if "visible_text" in context:
        context["visible_text"] = _clip_text(
            str(context.get("visible_text") or ""),
            _AGENT_CONTEXT_TEXT_LIMIT,
        )
        if context["visible_text"]:
            context_hits.append("可见文本")
    if "selectedText" in context:
        context["selectedText"] = _clip_text(str(context.get("selectedText") or ""), 2000)
        if context["selectedText"]:
            context_hits.append("用户选中文本")
    if "selected_text" in context:
        context["selected_text"] = _clip_text(str(context.get("selected_text") or ""), 2000)
        if context["selected_text"]:
            context_hits.append("用户选中文本")
    if "data" in context:
        context["data"] = _compact_agent_value(context.get("data") or {}, list_limit=40)
        if context["data"]:
            keys = (
                ", ".join(list(context["data"])[:6])
                if isinstance(context["data"], dict)
                else "data"
            )
            context_hits.append(f"结构化数据：{keys}")

    prompt = ""
    if context:
        prompt += "[页面上下文]\n"
        prompt += _clip_text(
            json.dumps(context, ensure_ascii=False, default=str),
            _AGENT_CONTEXT_DATA_JSON_LIMIT,
        )
        prompt += "\n\n"
    for msg in req.history[-_AGENT_HISTORY_LIMIT:]:
        role = "用户" if msg.get("role") == "user" else "助教"
        content = _clip_text(str(msg.get("content", "")), _AGENT_HISTORY_MESSAGE_LIMIT)
        prompt += f"[{role}]\n{content}\n\n"
    prompt += f"[用户问题]\n{req.question}"
    return prompt, len(prompt), context_hits


class AgentRun:
    def __init__(self, run_id: str):
        self.id = run_id
        self.events: list[dict[str, Any]] = []
        self.done = False
        self.updated_at = time.monotonic()
        self.condition = asyncio.Condition()
        self.task: asyncio.Task | None = None

    async def append(self, event: dict[str, Any]) -> None:
        async with self.condition:
            if self.done:
                return
            self.events.append(event)
            self.updated_at = time.monotonic()
            if event.get("type") == "done":
                self.done = True
            self.condition.notify_all()


_agent_runs: dict[str, AgentRun] = {}


def _cleanup_agent_runs() -> None:
    now = time.monotonic()
    stale_ids = [
        run_id
        for run_id, run in _agent_runs.items()
        if run.done and now - run.updated_at > _AGENT_RUN_TTL_SEC
    ]
    for run_id in stale_ids:
        _agent_runs.pop(run_id, None)


async def _run_agent_request(run: AgentRun, req: AgentAskRequest) -> None:
    providers = agent_client.discover_providers()
    provider = next((p for p in providers if p.name == req.provider), None) if req.provider else None
    prompt, context_chars, context_hits = _agent_prompt(req)
    effective_provider = provider or next((p for p in providers if p.default), None)
    effective_model = None
    if effective_provider:
        effective_model = next(
            (m for m in effective_provider.models if m.name == req.model), None
        ) or (effective_provider.models[0] if effective_provider.models else None)

    result_meta: dict = {}
    emitted_text = False
    attempt = 0
    attempt_error: str | None = None
    try:
        while True:
            attempt += 1
            attempt_error = None
            try:
                async for kind, text in agent_client.stream_parts(
                    prompt=prompt,
                    system_prompt=_AGENT_SYSTEM_PROMPT,
                    provider=provider,
                    model_name=req.model,
                    thinking=req.thinking,
                    meta=result_meta,
                ):
                    if kind == "thinking":
                        await run.append({"type": "thinking", "text": text})
                        continue
                    if kind == "tool":
                        await run.append({"type": "tool", **json.loads(text)})
                        continue
                    if kind == "error":
                        attempt_error = text
                        continue
                    emitted_text = True
                    await run.append({"type": "delta", "text": text})
            except Exception as e:
                attempt_error = f"{type(e).__name__}: {e}"

            if attempt_error is None:
                break
            if emitted_text or attempt > _AGENT_AUTO_RETRIES:
                logger.warning("agent ask failed: %s", attempt_error)
                await run.append({"type": "error", "message": attempt_error})
                break
            await run.append({
                "type": "retry",
                "attempt": attempt,
                "max": _AGENT_AUTO_RETRIES,
                "reason": attempt_error,
            })

        usage = result_meta.get("usage") or {}
        ctx_tokens = sum(
            usage.get(key, 0) or 0
            for key in (
                "input_tokens",
                "cache_read_input_tokens",
                "cache_creation_input_tokens",
            )
        ) or None
        await run.append({
            "type": "meta",
            "duration_ms": result_meta.get("duration_ms"),
            "round_ms": result_meta.get("duration_ms"),
            "num_turns": result_meta.get("num_turns"),
            "model": ", ".join(result_meta.get("model_usage") or []) or None,
            "thinking": req.thinking or "off",
            "ctx_tokens": ctx_tokens,
            "ctx_window": effective_model.context_window if effective_model else None,
            "context_chars": context_chars,
            "context_hits": context_hits or None,
        })
        agent_ledger.record_run({
            "run_id": run.id,
            "provider": effective_provider.name if effective_provider else None,
            "model": result_meta.get("model_usage"),
            "thinking": req.thinking or "off",
            "question_chars": len(req.question),
            "context_chars": context_chars,
            "duration_ms": result_meta.get("duration_ms"),
            "num_turns": result_meta.get("num_turns"),
            "usage": result_meta.get("usage"),
            "outcome": "error" if attempt_error is not None else "done",
        })
        await run.append({"type": "done"})
    except Exception as e:
        logger.warning("agent ask failed: %s: %s", type(e).__name__, e)
        agent_ledger.record_run({
            "run_id": run.id,
            "provider": effective_provider.name if effective_provider else None,
            "outcome": "error",
            "error": f"{type(e).__name__}: {e}",
        })
        await run.append({"type": "error", "message": f"{type(e).__name__}: {e}"})
        await run.append({"type": "done"})


def _start_agent_run(req: AgentAskRequest) -> AgentRun:
    _cleanup_agent_runs()
    run = AgentRun(uuid.uuid4().hex)
    _agent_runs[run.id] = run
    run.task = asyncio.create_task(_run_agent_request(run, req))
    return run


async def _stream_agent_run(
    run: AgentRun,
    request: Request,
    *,
    cursor: int = 0,
) -> AsyncIterator[str]:
    next_idx = max(0, cursor)
    while True:
        async with run.condition:
            while next_idx >= len(run.events) and not run.done:
                await run.condition.wait()
            while next_idx < len(run.events):
                event = run.events[next_idx]
                payload = json.dumps(event, ensure_ascii=False)
                yield f"id: {next_idx}\ndata: {payload}\n\n"
                next_idx += 1
            if run.done:
                break
        if await request.is_disconnected():
            return


async def cancel_agent_runs() -> None:
    for run in list(_agent_runs.values()):
        if not run.done and run.task is not None:
            run.task.cancel()
            await run.append({"type": "error", "message": "服务关闭"})
            await run.append({"type": "done"})


@router.get("/providers")
def api_agent_providers():
    return [
        {
            "name": p.name, "description": p.description, "default": p.default,
            "unavailable_reason": agent_client.check_available(p),
            "models": [
                {"name": m.name, "context_window": m.context_window, "thinking_levels": m.thinking_levels}
                for m in p.models
            ],
        }
        for p in agent_client.discover_providers()
    ]


@router.post("/runs")
async def api_agent_start_run(req: AgentAskRequest):
    run = _start_agent_run(req)
    return {"run_id": run.id}


@router.get("/runs/{run_id}/events")
async def api_agent_run_events(
    run_id: str,
    request: Request,
    cursor: int = 0,
) -> StreamingResponse:
    run = _agent_runs.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Agent run not found")
    return StreamingResponse(
        _stream_agent_run(run, request, cursor=cursor),
        media_type="text/event-stream",
    )


@router.delete("/runs/{run_id}")
async def api_agent_cancel_run(run_id: str, reason: Literal["cancel", "steer"] = "cancel"):
    run = _agent_runs.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Agent run not found")
    if run.done:
        return {"ok": True}
    if run.task is not None:
        run.task.cancel()
    if reason == "steer":
        await run.append({"type": "steered"})
    else:
        await run.append({"type": "error", "message": "已取消"})
    await run.append({"type": "done"})
    agent_ledger.record_run({"run_id": run.id, "outcome": "steered" if reason == "steer" else "cancelled"})
    return {"ok": True}


@router.post("/ask")
async def api_agent_ask(req: AgentAskRequest, request: Request) -> StreamingResponse:
    run = _start_agent_run(req)

    async def stream():
        async for event in _stream_agent_run(run, request):
            yield event

    return StreamingResponse(stream(), media_type="text/event-stream")
