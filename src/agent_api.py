import asyncio
import json
import logging
import time
import uuid
from typing import Any, AsyncIterator, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import src.agent_client as agent_client
import src.agent_ledger as agent_ledger
from src import agent_sessions

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent")


class AgentAskRequest(BaseModel):
    """Floating assistant request.

    `context` is a JSON snapshot the frontend computed from the active page.
    The backend only relays and clips it; it does not re-derive music theory.

    Conversation history is server-side (src/agent_sessions.py) once a session
    exists: `session_id` selects it. `history` is only the one-time migration
    path — a client with a purely-local (localStorage) history sends it on the
    first ask of a session, and it gets seeded into the new session file.
    `retry` voids the last completed turn before asking again (the frontend's
    重试 button), so the replaced answer doesn't linger in the history.
    `followup` is the busy-session path: instead of rejecting with 409, the
    question is queued into the running agent run (pydantic-ai when_idle
    enqueue) and answered in the same run when the current answer finishes.
    """

    question: str = Field(min_length=1, max_length=4000)
    provider: Optional[str] = None
    model: Optional[str] = None
    thinking: Optional[str] = None
    history: list[dict] = Field(default_factory=list)
    context: dict = Field(default_factory=dict)
    session_id: str | None = None
    retry: bool = False
    followup: bool = False


_AGENT_CONTEXT_TEXT_LIMIT = 6000
_AGENT_CONTEXT_DATA_JSON_LIMIT = 12000
# 读会话历史时的兜底上限——不是真正的历史裁剪：真正的裁剪现在由 agent_client.py 里挂的
# pydantic-ai-harness 压缩 capability 做（超过 model 窗口才触发，早期内容摘要保留而不是
# 硬丢），这两个数字只是防一个坏掉/异常巨大的 session 文件把整个进程拖垮。
_AGENT_HISTORY_SANITY_LIMIT = 500
_AGENT_HISTORY_MESSAGE_SANITY_LIMIT = 200_000
_AGENT_AUTO_RETRIES = 1
_AGENT_RUN_TTL_SEC = 15 * 60

_AGENT_SYSTEM_PROMPT = """你是嵌入在一个吉他练习网页 app 里的助教，飘在页面右下角随时可以被问到。

规则：
- [页面上下文] 是当前页面已经算好的真实数据（JSON），回答优先基于它，不要假装看到了它没给你的东西；缺什么就说缺什么。
- 在 Chord ID 页面，页面上下文包含当前和声进行每个和弦的罗马数字分析、检测到的终止式、同功能组替代建议，以及每个位置的备选读法（省略了哪些音、是否根音在贝斯）。回答"为什么这个更合理"时具体引用这些依据（省略了根音 vs 省略了别的音、是否落在调内音级、覆盖度高低），不要只讲泛泛乐理。
- 在 Lick 详情页，页面上下文的 data.pdfMaterials 列出该 Lick 笔记引用的谱面 PDF（material_id 和文件名）。用户问谱面内容时用 read_pdf 工具按 material_id 抽取文本再回答，不要凭猜；抽出来为空说明是扫描图片谱，直说图片谱读不了，别编谱面内容。
- 你是只读助教：不要声称已经修改、保存、删除、上传或操作了这个 app；如果用户要你做写入类操作，说明当前助教只能解释和建议。
- 例外：用户要你"生成/播放/演示一个和弦进行"时，用 generate_accompaniment 工具生成一张可播放的预览卡片（用户在对话里点按钮试听、或跳转到 Jam 页面调整），不要因为"只读"就拒绝，也不要转而在文字里贴 MIDI 生成代码让用户自己跑。这仍然只是"预览"，不是"已经帮你保存到库里了"——别混淆两者。
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
    """当前这一轮的 prompt：页面上下文 + 这次的问题。更早的对话轮次不再拼进这段文本——
    走 agent_client.stream_parts 的 message_history 参数（见 _run_agent_request），让
    pydantic-ai-harness 的压缩 capability 能看到完整轮次结构，超窗口时才摘要，而不是
    这里先硬截一刀。"""
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
        self.session_id: str | None = None
        # busy 时 followup 提问的收件箱：POST /runs 往里放，stream_parts 里的
        # 转发协程取出并 run.enqueue(priority="when_idle")。队列在注册 run 时就
        # 建好，所以"run 已登记但 agent.iter() 还没进来"的窗口期也能安全收消息。
        self.followup_queue: asyncio.Queue[str] = asyncio.Queue()

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

# session_id → run_id of the currently-streaming run. A second non-followup ask
# against a busy session is rejected with 409 instead of opening a competing
# run that would interleave writes into the same session file (kolab has this
# data-corruption footgun; we just guard it). followup asks are queued into the
# busy run instead (see api_agent_start_run).
_session_active_run: dict[str, str] = {}


def _session_busy_run(session_id: str) -> AgentRun | None:
    run_id = _session_active_run.get(session_id)
    if run_id is None:
        return None
    run = _agent_runs.get(run_id)
    if run is None or run.done:
        _session_active_run.pop(session_id, None)
        return None
    return run


def _cleanup_agent_runs() -> None:
    now = time.monotonic()
    stale_ids = [
        run_id
        for run_id, run in _agent_runs.items()
        if run.done and now - run.updated_at > _AGENT_RUN_TTL_SEC
    ]
    for run_id in stale_ids:
        _agent_runs.pop(run_id, None)


async def _run_agent_request(
    run: AgentRun, req: AgentAskRequest, history: list[dict]
) -> None:
    providers = agent_client.discover_providers()
    provider = next((p for p in providers if p.name == req.provider), None) if req.provider else None
    prompt, context_chars, context_hits = _agent_prompt(req)
    message_history = agent_client.history_from_dicts(history)
    effective_provider = provider or next((p for p in providers if p.default), None)
    effective_model = None
    if effective_provider:
        effective_model = next(
            (m for m in effective_provider.models if m.name == req.model), None
        ) or (effective_provider.models[0] if effective_provider.models else None)

    result_meta: dict = {}
    emitted_text = False
    answer_parts: list[str] = []  # 当前回答段的 delta 累积；followup 边界处落盘并清零
    widgets: list[dict] = []  # 当前回答段收到的结构化 widget（见 agent_client 的 "widget" kind）；followup 边界处随 answer_parts 一起落盘并清零
    attempt = 0
    attempt_error: str | None = None
    overflow_trimmed = False  # 上下文超长的紧急裁剪只做一次，避免无限重试
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
                    message_history=message_history,
                    followup_queue=run.followup_queue,
                ):
                    if kind == "thinking":
                        await run.append({"type": "thinking", "text": text})
                        continue
                    if kind == "tool":
                        await run.append({"type": "tool", **json.loads(text)})
                        continue
                    if kind == "widget":
                        payload = json.loads(text)
                        widgets.append(payload)
                        await run.append({"type": "widget", **payload})
                        continue
                    if kind == "followup":
                        # 追问的回答开始了：上一段回答此刻已完整（when_idle 在 run
                        # 本要结束时才投递），立刻落盘——否则之后取消会把已完成
                        # 的答案连同中断墓碑一起丢掉。usage/duration 要 run 结束
                        # 才有，这段只落 model/thinking。
                        segment = "".join(answer_parts)
                        if run.session_id and segment.strip():
                            agent_sessions.append_assistant(run.session_id, segment, {
                                "model": effective_model.name if effective_model else None,
                                "thinking": req.thinking or "off",
                                "widgets": widgets or None,
                            })
                        answer_parts.clear()
                        widgets = []
                        # 注意故意不重置 emitted_text：本 attempt 已经有过产出，
                        # 追问段出错时不能整轮重试（会重复提问）。
                        await run.append({"type": "followup"})
                        continue
                    if kind == "error":
                        attempt_error = text
                        continue
                    emitted_text = True
                    answer_parts.append(text)
                    await run.append({"type": "delta", "text": text})
            except Exception as e:
                attempt_error = f"{type(e).__name__}: {e}"

            if attempt_error is None:
                break
            if emitted_text or attempt > _AGENT_AUTO_RETRIES:
                logger.warning("agent ask failed: %s", attempt_error)
                await run.append({"type": "error", "message": attempt_error})
                break
            # overflow 兜底：压缩 capability 的 token 估算漏了、API 真的拒了——
            # 拿同样历史重试必然再撞一次，先把最旧的一半砍掉再重试（只做一次）。
            if (
                not overflow_trimmed
                and message_history
                and agent_client.is_context_overflow(attempt_error)
            ):
                overflow_trimmed = True
                before = len(message_history)
                message_history = agent_client.emergency_trim_history(message_history)
                logger.warning(
                    "context overflow, emergency-trimmed history %d -> %d messages",
                    before, len(message_history),
                )
            await run.append({
                "type": "retry",
                "attempt": attempt,
                "max": _AGENT_AUTO_RETRIES,
                "reason": attempt_error,
            })

        if run.session_id:
            store_meta = {
                "model": ", ".join(result_meta.get("model_usage") or []) or None,
                "thinking": req.thinking or "off",
                "duration_ms": result_meta.get("duration_ms"),
                "usage": result_meta.get("usage"),
                "widgets": widgets or None,
            }
            if attempt_error is not None:
                store_meta["outcome"] = "error"
            agent_sessions.append_assistant(run.session_id, "".join(answer_parts), store_meta)
            # 本轮触发过摘要压缩则落盘（跟在 assistant 条目后面）——下一轮
            # load_history_for_prompt 用它替代被覆盖的历史前缀，incremental
            # 摘要跨轮续写。只在成功路径落：错误轮的摘要下一轮回重新算。
            compaction = result_meta.get("compaction")
            if compaction and attempt_error is None:
                agent_sessions.append_compacted(
                    run.session_id, compaction["summary"], compaction["covers"]
                )
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
        if run.session_id:
            agent_sessions.append_assistant(
                run.session_id, "".join(answer_parts),
                {"outcome": "error", "error": f"{type(e).__name__}: {e}"},
            )
        await run.append({"type": "error", "message": f"{type(e).__name__}: {e}"})
        await run.append({"type": "done"})
    finally:
        # CancelledError（DELETE 取消/服务关闭）是 BaseException，不走上面的
        # except——中断墓碑由 DELETE handler 落。注册表清理两种路径都要跑。
        if run.session_id and _session_active_run.get(run.session_id) == run.id:
            _session_active_run.pop(run.session_id, None)


def _start_agent_run(req: AgentAskRequest, session_id: str, history: list[dict]) -> AgentRun:
    _cleanup_agent_runs()
    run = AgentRun(uuid.uuid4().hex)
    run.session_id = session_id
    _agent_runs[run.id] = run
    _session_active_run[session_id] = run.id
    run.task = asyncio.create_task(_run_agent_request(run, req, history))
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
    if req.session_id is not None and not agent_sessions.is_valid_id(req.session_id):
        raise HTTPException(status_code=400, detail="Invalid session id")
    session_id = req.session_id or uuid.uuid4().hex[:12]
    if not agent_sessions.session_exists(session_id):
        # One-time migration path: a client whose history only ever lived in
        # localStorage sends it with the first ask; it gets seeded into the
        # new session file. After that the server is the source of truth and
        # the client stops sending history.
        agent_sessions.create_session(session_id, seed_history=req.history or None)
    busy_run = _session_busy_run(session_id)
    if busy_run is not None:
        if not req.followup:
            raise HTTPException(status_code=409, detail="该会话已有进行中的回答")
        # followup：不打断当前回答，把问题排进进行中的 run（pydantic-ai 的
        # when_idle enqueue，见 stream_parts 里的转发协程），当前回答结束后
        # 在同一个 run 里续答。先落盘后入队——崩在两者之间时问题会作为
        # "未回答"气泡留在会话里，不会丢。
        followup_prompt, _, _ = _agent_prompt(req)
        agent_sessions.append_user(session_id, req.question)
        busy_run.followup_queue.put_nowait(followup_prompt)
        return {"queued": True, "run_id": busy_run.id, "session_id": session_id}
    # 走到这里说明会话不在流式中：文件里若还有未配对的 user 条目（上次 run
    # 被取消/崩溃时留下的提问、排队后没被回答的追问），它们对应的 run 已经
    # 没了，先封印为"永不再配对"——否则这一轮的回答会 FIFO 错配到它们头上。
    agent_sessions.seal_unanswered(session_id)
    if req.retry:
        agent_sessions.append_voided(session_id)
    # History for the prompt is read BEFORE appending the current question.
    history = agent_sessions.load_history_for_prompt(
        session_id, _AGENT_HISTORY_SANITY_LIMIT, _AGENT_HISTORY_MESSAGE_SANITY_LIMIT
    )
    agent_sessions.append_user(session_id, req.question)
    run = _start_agent_run(req, session_id, history)
    return {"run_id": run.id, "session_id": session_id}


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
async def api_agent_cancel_run(run_id: str):
    run = _agent_runs.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Agent run not found")
    if run.done:
        return {"ok": True}
    if run.task is not None:
        run.task.cancel()
    if run.session_id:
        # Tombstone the interrupted turn: the partial answer stays visible in
        # the UI ("已取消") but the turn is excluded from future prompts.
        # 只取当前回答段的 delta：followup 边界之前的段已经作为完整答案落盘了，
        # 不能再算进 partial（否则会重复持久化）。
        seg_events = run.events
        for i in range(len(run.events) - 1, -1, -1):
            if run.events[i].get("type") == "followup":
                seg_events = run.events[i + 1:]
                break
        partial = "".join(
            e.get("text", "") for e in seg_events if e.get("type") == "delta"
        )
        agent_sessions.append_aborted(run.session_id, partial)
    await run.append({"type": "error", "message": "已取消"})
    await run.append({"type": "done"})
    agent_ledger.record_run({"run_id": run.id, "outcome": "cancelled"})
    return {"ok": True}


# ── Sessions（服务端持久化的对话历史，见 src/agent_sessions.py 头注）──────────


@router.get("/sessions")
def api_agent_sessions_list():
    return agent_sessions.list_sessions()


@router.get("/sessions/{session_id}")
def api_agent_session_detail(session_id: str):
    if not agent_sessions.is_valid_id(session_id):
        raise HTTPException(status_code=400, detail="Invalid session id")
    if not agent_sessions.session_exists(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return {"id": session_id, "messages": agent_sessions.load_messages(session_id)}


@router.delete("/sessions/{session_id}")
def api_agent_session_delete(session_id: str):
    if not agent_sessions.is_valid_id(session_id):
        raise HTTPException(status_code=400, detail="Invalid session id")
    if _session_busy_run(session_id) is not None:
        raise HTTPException(status_code=409, detail="该会话已有进行中的回答")
    if not agent_sessions.delete_session(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return {"ok": True}
