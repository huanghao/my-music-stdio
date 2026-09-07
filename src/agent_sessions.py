"""Agent 会话的服务端持久化：append-only JSONL，一个会话一个文件。

设计借鉴 kolab（pi SDK SessionManager）：append-only 条目流、取消/retry 用
墓碑标记而不是改写历史、动态上下文（页面数据）不落历史。有意简化的部分：
我们是单用户本地 app，没有分叉需求，所以用线性条目而不是 parentId 树；
session_id 校验后直接作文件名，不需要 kolab 那层短 id→路径映射（避免两个
事实来源）。

条目类型：
- {"type": "session", ...}   首行，创建时写
- {"type": "user", ...}      一次提问（含 followup 排队追问，见 agent_api）
- {"type": "assistant", ...} 一轮完整回答（含 meta：model/usage/duration_ms/widgets…）；
                             一个 run 里每回答一个问题落一条（followup 边界各落一条）
- {"type": "aborted", ...}   取消：把当时正在回答的 user 标记为"被打断"
- {"type": "orphaned", ...}  封印：新 run 开启时把此前所有未配对的 user 标记为
                             "永不再配对"（对应的 run 已取消/崩溃）——展示保留为
                             未回答气泡，但不再参与 FIFO 配对，防止后续 assistant
                             错配到它们头上
- {"type": "voided", ...}    retry：把上一轮（已完成的）整个作废——展示和
                             prompt 重建都不再出现，但文件里保留（append-only）
- {"type": "compacted", ...} 摘要压缩落盘：summary + 覆盖条数，下一轮重建
                             prompt 历史时用它替代被覆盖的前缀（跨轮增量摘要）

重建规则见 load_messages()。落盘失败只记日志不抛异常——和 agent_ledger 同一
原则：存储出问题不能拖垮正在进行的问答。
"""
import json
import logging
import os
import re
from datetime import UTC, datetime
from pathlib import Path

from src.data_dir import data_dir

logger = logging.getLogger(__name__)

# 与 prefs.py / agent_ledger.py 共用 data_dir.py 的同一个数据根目录；
# 环境变量覆盖用于测试隔离（kolab 的 KOLAB_DATA_DIR 同款）。
SESSIONS_DIR_ENV = "MMS_AGENT_SESSIONS_DIR"

# 前端 agentNewSessionId() 生成的 base36 id 也落在这个字符集内，所以
# 客户端生成的 id 可以直接当服务端 session id 用，无需映射层。
_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# 列表/详情接口的标题来源（和 kolab 一样：首条 user 消息截断）。
_TITLE_LEN = 30


def is_valid_id(session_id: str) -> bool:
    return bool(_SESSION_ID_RE.fullmatch(session_id or ""))


def _dir() -> Path:
    override = os.environ.get(SESSIONS_DIR_ENV)
    d = Path(override).expanduser() if override else data_dir() / "agent-sessions"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _path(session_id: str) -> Path:
    if not is_valid_id(session_id):
        raise ValueError(f"invalid session id: {session_id!r}")
    return _dir() / f"{session_id}.jsonl"


def session_exists(session_id: str) -> bool:
    return is_valid_id(session_id) and _path(session_id).exists()


def _append(session_id: str, entry: dict) -> None:
    row = {"ts": datetime.now(UTC).isoformat(), **entry}
    try:
        with _path(session_id).open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    except (OSError, ValueError) as e:
        logger.warning("failed to append agent session entry: %s: %s", type(e).__name__, e)


def create_session(session_id: str, seed_history: list[dict] | None = None) -> None:
    """创建会话文件。seed_history 是老前端一次性迁移用的历史消息
    （[{role, content}, ...]），逐对落成 user/assistant 条目。"""
    p = _path(session_id)  # validates id
    if p.exists():
        return
    try:
        with p.open("x", encoding="utf-8") as f:
            f.write(json.dumps({
                "type": "session", "id": session_id,
                "ts": datetime.now(UTC).isoformat(),
            }, ensure_ascii=False) + "\n")
    except FileExistsError:
        return  # 并发创建竞态：单用户 app，后到的直接认输
    except OSError as e:
        logger.warning("failed to create agent session: %s: %s", type(e).__name__, e)
        return
    for msg in seed_history or []:
        role, content = msg.get("role"), str(msg.get("content") or "")
        if not content:
            continue
        if role == "user":
            _append(session_id, {"type": "user", "content": content})
        elif role == "assistant":
            _append(session_id, {"type": "assistant", "content": content, "meta": {}})


def append_user(session_id: str, content: str) -> None:
    _append(session_id, {"type": "user", "content": content})


def append_assistant(session_id: str, content: str, meta: dict | None = None) -> None:
    _append(session_id, {"type": "assistant", "content": content, "meta": meta or {}})


def append_aborted(session_id: str, partial: str = "") -> None:
    """取消的墓碑：作废当时正在回答的 user 条目（队首未配对者）。partial 是
    被打断时已经流出的部分回答，仅供展示，不进 prompt。"""
    _append(session_id, {"type": "aborted", "partial": partial})


def append_voided(session_id: str) -> None:
    """retry 的墓碑：作废上一个完整轮次（user+assistant 一对）。"""
    _append(session_id, {"type": "voided"})


def append_compacted(session_id: str, summary: str, covers: int) -> None:
    """摘要压缩的落盘：summary 是带 _SUMMARY_PREFIX 前缀的完整 SystemPromptPart
    content，covers 是它覆盖的历史消息条数（从重建列表头部数起）。
    消费方是 load_history_for_prompt——用摘要替代被覆盖的前缀，下一轮摘要时
    incremental 模式基于它续写，而不是每轮从头重新摘要。"""
    _append(session_id, {"type": "compacted", "summary": summary, "covers": covers})


def seal_unanswered(session_id: str) -> int:
    """把当前所有未配对的 user 条目封印为"永不再配对"（追加一条 orphaned
    墓碑）。开启新 run 前调用：这些条目对应的 run 已经没了（取消/崩溃），
    不封印的话下一个 assistant 条目会 FIFO 错配到它们头上。
    返回封印的条数；为 0 时不写墓碑。"""
    pairable = 0
    for e in _read_entries(session_id):
        t = e.get("type")
        if t == "user":
            pairable += 1
        elif t in ("assistant", "aborted") and pairable:
            pairable -= 1
        elif t == "orphaned":
            pairable = 0
    if pairable:
        _append(session_id, {"type": "orphaned", "count": pairable})
    return pairable


def _read_entries(session_id: str) -> list[dict]:
    p = _path(session_id)
    entries = []
    try:
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                logger.warning("skipping corrupt line in %s", p.name)
    except OSError:
        pass
    return entries


def _reconstruct(entries: list[dict]) -> tuple[list[dict], list[dict], list[dict]]:
    """把条目流重建为轮次。返回 (turns, aborted_turns, unanswered_users)：

    - turns: 有效轮 [{"user": entry, "assistant": entry}]
    - aborted_turns: 被打断的轮（取消），带 partial，只用于展示
    - unanswered_users: 从未被回答的 user 条目（followup 排队后 run 被取消/
      进程崩掉），只展示，不进 prompt
    voided 条目会把上一个有效轮整个移除（展示和 prompt 都看不到）。

    配对一律 FIFO（配队首）：followup 排队会产生"连续 user 之后接连 assistant"
    的序列（user Q、user F、assistant A1、assistant A2——A1 答 Q、A2 答 F），
    取消时正在回答的也一定是队首那个（单会话只有一个活跃 run）。反过来用
    LIFO 会把 prompt 历史里的问答内容配错，所以不用。
    """
    turns: list[dict] = []
    aborted: list[dict] = []
    pending: list[dict] = []
    unanswered: list[dict] = []  # 已封印 + 结尾仍未配对的 user，只展示不配对
    for e in entries:
        t = e.get("type")
        if t == "user":
            pending.append(e)
        elif t == "assistant":
            if pending:
                turns.append({"user": pending.pop(0), "assistant": e})
            # 没有待配对 user 的 assistant（坏文件/并发写）：无法归属，忽略。
        elif t == "aborted":
            if pending:
                aborted.append({"user": pending.pop(0), "partial": e.get("partial", "")})
            # 没有 pending 的 aborted（如服务重启时 run 被打断但 user 已配对）
            # 无法归属，忽略。
        elif t == "orphaned":
            # 封印：此前未配对的 user 移入"只展示"集合，永不再参与配对
            # （见 seal_unanswered）。已封印的和结尾仍 pending 的（还没来得及
            # 封印，如下次提问前）在展示上没有区别。
            unanswered.extend(pending)
            pending.clear()
        elif t == "voided" and turns:
            # retry 的目标永远是上一个已完成轮次。pending 里留着的是还没被
            # 回答的提问（排队追问/崩溃遗留），不由 retry 负责清——它们要么
            # 等下次开 run 时被 orphaned 封印，要么继续作为未回答气泡展示。
            turns.pop()
    unanswered.extend(pending)
    return turns, aborted, unanswered


def _latest_valid_compaction(entries: list[dict]) -> dict | None:
    """最后一条有效的 compacted 条目。retry（voided）会作废已完成的轮次，
    如果这些轮次已被摘要覆盖，摘要内容就脏了——保守起见 voided 之后出现的
    摘要一律失效（下轮重新摘要）。aborted/orphaned 不改变已覆盖轮次的内容，
    不失效。"""
    latest = None
    for e in entries:
        t = e.get("type")
        if t == "compacted" and e.get("summary") and e.get("covers"):
            latest = e
        elif t == "voided":
            latest = None
    return latest


def load_history_for_prompt(session_id: str, limit: int, message_chars: int) -> list[dict]:
    """给 _agent_prompt 用的历史：有效轮次、时间正序、末尾 limit 条消息，
    内容截到 message_chars。被打断/作废/未回答的轮次不进 prompt。
    如果有有效的 compacted 条目（上轮摘要落盘），用它替代被覆盖的前缀——
    重建出来是 [{"role": "system", ...摘要}] + 未覆盖的 user/assistant 尾巴。"""
    entries = _read_entries(session_id)
    turns, _, _ = _reconstruct(entries)
    messages = []
    for turn in turns:
        messages.append({"role": "user", "content": turn["user"].get("content", "")})
        assistant = turn["assistant"]
        if assistant is not None:
            messages.append({"role": "assistant", "content": assistant.get("content", "")})
    compaction = _latest_valid_compaction(entries)
    if (
        compaction is not None
        and 0 < compaction["covers"] <= len(messages)
        and len(messages) <= limit  # 超窗口时窗口左移、覆盖下标对不上，保守弃用摘要
    ):
        tail = messages[compaction["covers"]:]
        return [{"role": "system", "content": compaction["summary"]}] + [
            {"role": m["role"], "content": m["content"][:message_chars]}
            for m in tail[-limit:]
        ]
    return [
        {"role": m["role"], "content": m["content"][:message_chars]}
        for m in messages[-limit:]
    ]


def load_messages(session_id: str) -> list[dict]:
    """给 UI 恢复用的完整消息列表：有效轮次 + 被打断轮（interrupted 标记）+
    未回答的提问（排队追问后 run 没了的情况，普通 user 气泡，没有回答），
    时间正序。assistant 的 meta 拍平到消息上（model/thinking/duration_ms），
    对齐前端 agentRenderMessages 读的字段。"""
    if not session_exists(session_id):
        raise ValueError(f"unknown session id: {session_id!r}")
    turns, aborted, unanswered = _reconstruct(_read_entries(session_id))
    messages = []
    for turn in turns:
        messages.append({
            "role": "user", "content": turn["user"].get("content", ""),
            "_ts": turn["user"].get("ts", ""),
        })
        assistant = turn["assistant"]
        if assistant is not None:
            meta = assistant.get("meta") or {}
            messages.append({
                "role": "assistant",
                "content": assistant.get("content", ""),
                "done": True,
                "model": meta.get("model"),
                "thinkingLevel": meta.get("thinking"),
                "durationMs": meta.get("duration_ms"),
                "widgets": meta.get("widgets") or [],
                "_ts": assistant.get("ts", ""),
                **({"error": True} if meta.get("outcome") == "error" else {}),
            })
    for turn in aborted:
        messages.append({
            "role": "user", "content": turn["user"].get("content", ""),
            "_ts": turn["user"].get("ts", ""),
        })
        messages.append({
            "role": "assistant", "content": turn.get("partial", ""),
            "done": True, "interrupted": True,
            "_ts": turn["user"].get("ts", ""),
        })
    for u in unanswered:
        messages.append({
            "role": "user", "content": u.get("content", ""),
            "_ts": u.get("ts", ""),
        })
    # 被打断/未回答的条目要按时间戳插回原本的位置，不能全堆在末尾
    messages.sort(key=lambda m: m["_ts"])
    for m in messages:
        del m["_ts"]
    return messages


def _title_of(entries: list[dict]) -> str:
    # 标题取重建后的第一个有效轮次，而不是原始条目里的第一条 user——
    # 否则"第一个问题被 retry 作废"时标题会停留在一个已作废的问题上。
    # 还没有任何完整轮次时（如第一个问题还没答完进程就没了）退到未回答的提问。
    turns, _, unanswered = _reconstruct(entries)
    if turns:
        return (turns[0]["user"].get("content") or "")[:_TITLE_LEN] or "新对话"
    if unanswered:
        return (unanswered[0].get("content") or "")[:_TITLE_LEN] or "新对话"
    return "新对话"


def list_sessions() -> list[dict]:
    out = []
    for p in _dir().glob("*.jsonl"):
        session_id = p.stem
        if not is_valid_id(session_id):
            continue
        entries = []
        try:
            for line in p.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line:
                    try:
                        entries.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
        except OSError:
            continue
        turns, aborted, unanswered = _reconstruct(entries)
        out.append({
            "id": session_id,
            "title": _title_of(entries),
            "updated_at": datetime.fromtimestamp(p.stat().st_mtime, UTC).isoformat(),
            "message_count": sum(2 for _ in turns) + sum(2 for _ in aborted) + len(unanswered),
        })
    out.sort(key=lambda s: s["updated_at"], reverse=True)
    return out


def delete_session(session_id: str) -> bool:
    if not is_valid_id(session_id):
        return False
    try:
        _path(session_id).unlink()
        return True
    except FileNotFoundError:
        return False
