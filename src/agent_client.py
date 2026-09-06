"""Agent 调用层：provider 发现/选择 + 直连 Pydantic AI（Anthropic 协议）流式问答。

历史：这个文件曾经是从 ~/workspace/0625-misc/pylab/agent_client.py 复制来的、
跨 app 共享的"单文件可复制"模块，靠 spawn claude/kc CLI 二进制拿模型回复。
2026-08-30 起 my-music-stdio 从这个共享模式里 fork 出来，改成用 pydantic-ai
直连各家的 Anthropic 协议兼容端点（不再套 CLI 壳），配置也搬到本项目自己的
~/.config/my-music-stdio/agent-backends.yaml，不再读/写共享的
~/.config/agent-backends.yaml——避免把这里的 schema 变更（provider/model/
api_key 取代 command/env/shim）传染给还在用旧 CLI-shim 约定的其它 app。
以后这个文件不再需要跟 pylab 的版本保持字节级同步。

核心原则（借鉴 pi/dsh 这类 agent harness）："错误即数据，不抛异常"——
stream_parts() 无论是 provider 不可用、鉴权失败、网络错误还是模型调用中途
出错，一律 yield ("error", ...) 交给调用方决定怎么展示/重试，绝不 raise。
"""
import asyncio
import base64
import json
import logging
import os
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field, replace
from pathlib import Path

import httpx
import yaml
from openai import AsyncOpenAI
from pydantic_ai import Agent
from pydantic_ai.capabilities import NativeTool
from pydantic_ai.capabilities.abstract import AbstractCapability
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    ModelMessage,
    ModelRequest,
    ModelResponse,
    NativeToolCallPart,
    NativeToolReturnPart,
    PartDeltaEvent,
    PartStartEvent,
    SystemPromptPart,
    TextPart,
    TextPartDelta,
    ThinkingPart,
    ThinkingPartDelta,
    UserPromptPart,
)
from pydantic_ai.models.anthropic import AnthropicModel, AnthropicModelSettings
from pydantic_ai.models.openai import OpenAIResponsesModel, OpenAIResponsesModelSettings
from pydantic_ai.native_tools import WebSearchTool
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.tools import Tool
from pydantic_ai_harness.compaction import (
    ClearToolResults,
    SummarizingCompaction,
    TieredCompaction,
)
from pydantic_ai_harness.compaction._summarizing_compaction import (
    _SUMMARY_PREFIX,
    find_safe_cutoff,
    find_token_cutoff,
)

from src import prefs
from src.gen_accompaniment_midi import parse_chord as _parse_chord
from src.materials_store import LocalFlatMaterialsStore
from src.pdf_text import read_material_pdf
from src.styles import get_all_styles

logger = logging.getLogger(__name__)


class _StripNativeToolParts(AbstractCapability):
    """发给模型前，把历史里 native 工具的调用/结果部件（web_search 的
    server_tool_use / web_search_tool_result beta 块）剥掉。

    Kimi 这类 Anthropic 兼容端点不支持把这些块回传：400 tool_call_id is not
    found——Kimi 的响应里甚至只有 result 块、没有配对的 call 块，id 本来就对不上。
    搜索结果的作用已经体现在正文 TextPart 里，剥掉不影响对话连续性；真 Anthropic
    端点丢了它也只是少一层引用信息，对本 app 的场景可接受。

    只改发给模型的 request_context.messages 副本，run 的权威历史（ctx.messages）
    不动——落盘/压缩看到的仍是完整部件。
    """

    @classmethod
    def get_serialization_name(cls) -> str | None:
        return None  # 代码里直接构造，不从 spec 反序列化

    async def before_model_request(self, ctx, request_context):
        def needs_strip(m) -> bool:
            return isinstance(m, ModelResponse) and any(
                isinstance(p, (NativeToolCallPart, NativeToolReturnPart)) for p in m.parts
            )

        if not any(needs_strip(m) for m in request_context.messages):
            return request_context
        cleaned = []
        for m in request_context.messages:
            if needs_strip(m):
                kept = [
                    p for p in m.parts
                    if not isinstance(p, (NativeToolCallPart, NativeToolReturnPart))
                ]
                if kept:
                    cleaned.append(replace(m, parts=kept))
                # 整个 response 只剩 native 部件（没有正文）时整条丢掉
            else:
                cleaned.append(m)
        request_context.messages = cleaned
        return request_context

CONFIG_PATH = Path.home() / ".config" / "my-music-stdio" / "agent-backends.yaml"
_ZSHRC_LOCAL = Path.home() / ".zshrc.local"  # 环境变量没 export 到当前进程时的兜底来源

# codex provider：直接读 Codex CLI 自己的登录态（同一个 OAuth 账号），只读不写、
# 也不自己刷新——2026-08-30 决策：refresh token 有轮换机制，我们单独刷新有可能
# 把 CLI 自己的登录态弄失效。过期后正常用一下 `codex` 命令它自己会刷新，我们这边
# 下次读到的就是新文件。
_CODEX_AUTH_PATH = Path.home() / ".codex" / "auth.json"
_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex"
_CODEX_JWT_CLAIM_PATH = "https://api.openai.com/auth"

# read 工具的作用域：只能读项目 docs/ 目录（教学材料），不开放整个仓库/文件系统。
DOCS_ROOT = (Path(__file__).resolve().parent.parent / "docs").resolve()

_TOOL_RESULT_PREVIEW_LIMIT = 200
_READ_TOOL_OUTPUT_LIMIT = 4000

# auto-compact（pydantic-ai-harness）：会话超过 model 窗口这个比例时触发，压缩后给最近消息
# 留这么多 token 的尾巴。取代了旧的"硬截最近 N 条消息"（详见 agent_api.py 的历史注释）——
# 早期内容不再被直接丢弃，而是摘要成一条 SystemPromptPart 保留下来。
_COMPACTION_TARGET_FRACTION = 0.7
_COMPACTION_KEEP_TOKENS = 20_000


@dataclass
class AgentModel:
    name: str  # 传给 pydantic-ai 的 model name，如 "k3-256k"/"claude-sonnet-4-5"
    context_window: int | None = None
    thinking_levels: list[str] = field(default_factory=lambda: ["off"])


@dataclass
class AgentProvider:
    name: str
    description: str = ""
    kind: str = "anthropic"  # "anthropic"（Anthropic 协议 API key）| "codex"（读 Codex CLI 登录态）
    base_url: str | None = None  # Anthropic-compatible endpoint override（kc 用得到）
    api_key_env: str = "ANTHROPIC_API_KEY"
    proxy: str | None = None  # 直连常被墙的官方端点（Anthropic/OpenAI）需要走代理，见 local-ai-clis.md
    models: list[AgentModel] = field(default_factory=list)
    default: bool = False


def _default_providers() -> list[AgentProvider]:
    """没有配置文件时的兜底：跟目前实际在用的两个 provider 对齐。"""
    return [
        AgentProvider(
            name="kc",
            description="Kimi K3（k3-256k，走 Kimi API 配额）",
            base_url="https://api.kimi.com/coding/",
            api_key_env="KIMI_API_KEY",
            models=[AgentModel(name="k3-256k", context_window=256000, thinking_levels=["off"])],
            default=True,
        ),
        AgentProvider(
            name="codex",
            description="ChatGPT 订阅（读 Codex CLI 自己的登录态 ~/.codex/auth.json）",
            kind="codex",
            proxy="http://127.0.0.1:7890",  # 直连 chatgpt.com/auth.openai.com 同样常被墙
            models=[AgentModel(name="gpt-5.5", thinking_levels=["off", "low", "medium", "high"])],
        ),
    ]


# 本机跑过 pi 系工具（kolab/md-viewer 之类）时，pi 自己登录/刷新会维护一份真实的
# 模型目录缓存——contextWindow、支持哪些 thinking 档位都是真数据，不是我们猜的。
# 有就用它把 kc/codex 的静态占位模型列表换成真列表，没有（这台机器没装过 pi 系工具）
# 就照旧用上面写死的兜底，不强依赖。做法照抄 kolab 的 server/pi-models.ts。
_PI_MODELS_STORE_PATH = Path.home() / ".pi" / "agent" / "models-store.json"
_PI_STORE_KEY_BY_PROVIDER = {"kc": "kimi-coding", "codex": "openai-codex"}
_EXTENDED_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
# 每个 provider 静态兜底列表里排第一的 model name，enrich 完也保持它排第一，
# 这样"没显式指定 model 时用 p.models[0]"这条既有逻辑不用跟着改。
_PREFERRED_DEFAULT_MODEL = {"kc": "k3-256k", "codex": "gpt-5.5"}


def _supported_thinking_levels(model_entry: dict) -> list[str]:
    """复刻 pi-ai 的 getSupportedThinkingLevels()：off/minimal/low/medium/high 默认都算
    支持，除非 thinkingLevelMap 里显式写了 null 排除；xhigh/max 反过来，得显式出现在
    map 里（值不是 null）才算支持。"""
    if not model_entry.get("reasoning"):
        return ["off"]
    level_map = model_entry.get("thinkingLevelMap") or {}
    supported = []
    for level in _EXTENDED_THINKING_LEVELS:
        if level in level_map and level_map[level] is None:
            continue  # explicitly excluded
        if level in ("xhigh", "max"):
            if level in level_map and level_map[level] is not None:
                supported.append(level)  # opt-in only
            continue
        supported.append(level)  # off/minimal/low/medium/high default to supported
    return supported or ["off"]


def _models_from_pi_store(provider_name: str) -> list["AgentModel"] | None:
    store_key = _PI_STORE_KEY_BY_PROVIDER.get(provider_name)
    if not store_key:
        return None
    if not _PI_MODELS_STORE_PATH.exists():
        return None
    try:
        store = json.loads(_PI_MODELS_STORE_PATH.read_text())
    except (OSError, ValueError) as e:
        logger.warning("failed to read pi models store: %s: %s", type(e).__name__, e)
        return None
    entries = (store.get(store_key) or {}).get("models") or []
    if not entries:
        return None
    models = [
        AgentModel(
            name=m["id"],
            context_window=m.get("contextWindow"),
            thinking_levels=_supported_thinking_levels(m),
        )
        for m in entries
        if m.get("id")
    ]
    preferred = _PREFERRED_DEFAULT_MODEL.get(provider_name)
    if preferred:
        models.sort(key=lambda m: m.name != preferred)  # preferred 排第一，其余保持原序
    return models or None


def _enrich_from_pi_store(providers: list["AgentProvider"]) -> None:
    for p in providers:
        real_models = _models_from_pi_store(p.name)
        if real_models:
            p.models = real_models


def discover_providers(config_path: Path = CONFIG_PATH) -> list[AgentProvider]:
    if not config_path.exists():
        providers = _default_providers()
        _enrich_from_pi_store(providers)
        return providers
    try:
        raw = yaml.safe_load(config_path.read_text()) or {}
    except Exception as e:
        logger.warning("failed to parse %s: %s: %s", config_path, type(e).__name__, e)
        providers = _default_providers()
        _enrich_from_pi_store(providers)
        return providers

    providers = []
    for entry in raw.get("providers") or []:
        models = [
            AgentModel(
                name=m["name"],
                context_window=m.get("context_window"),
                thinking_levels=list(m.get("thinking_levels") or ["off"]),
            )
            for m in entry.get("models") or []
        ]
        providers.append(
            AgentProvider(
                name=entry["name"],
                description=entry.get("description", ""),
                kind=entry.get("kind", "anthropic"),
                base_url=entry.get("base_url"),
                api_key_env=entry.get("api_key_env", "ANTHROPIC_API_KEY"),
                proxy=entry.get("proxy"),
                models=models,
            )
        )
    if not providers:
        providers = _default_providers()
        _enrich_from_pi_store(providers)
        return providers

    default_name = raw.get("default")
    if not any(p.default for p in providers):
        matched = next((p for p in providers if p.name == default_name), providers[0])
        matched.default = True
    _enrich_from_pi_store(providers)
    return providers


def _resolve_var(name: str) -> str | None:
    """按变量名（不带 ${}）解析：先查进程环境，再兜底从 ~/.zshrc.local 里找 export 行。"""
    val = os.environ.get(name)
    if val:
        return val
    if not _ZSHRC_LOCAL.exists():
        return None
    try:
        text = _ZSHRC_LOCAL.read_text()
    except OSError as e:
        logger.warning("failed to read %s: %s", _ZSHRC_LOCAL, e)
        return None
    m = re.search(rf'^\s*export\s+{re.escape(name)}=["\']?([^"\'\n]+)["\']?\s*$', text, re.MULTILINE)
    return m.group(1) if m else None


def _codex_credentials() -> dict | None:
    """只读 Codex CLI 自己的登录态；缺失/损坏/过期都返回 None，绝不 raise。"""
    try:
        auth = json.loads(_CODEX_AUTH_PATH.read_text())
        tokens = auth.get("tokens") or {}
        access_token, account_id = tokens.get("access_token"), tokens.get("account_id")
        if not access_token or not account_id:
            return None
        payload_b64 = access_token.split(".")[1]
        payload_b64 += "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        if payload.get("exp", 0) < time.time() + 60:  # 留 60s 余量，别踩着过期线用
            return None
        return {"access_token": access_token, "account_id": account_id}
    except Exception as e:
        logger.warning("failed to read codex credentials: %s: %s", type(e).__name__, e)
        return None


def check_available(p: AgentProvider) -> str | None:
    """返回 None 表示可用，否则返回人类可读的不可用原因。绝不 raise。"""
    if not p.models:
        return "没有配置可用模型"
    if p.kind == "codex":
        if _codex_credentials() is None:
            return "读不到有效的 Codex 登录态（~/.codex/auth.json），跑一下 `codex` 命令登录/刷新"
        return None
    if _resolve_var(p.api_key_env) is None:
        return f"环境变量 {p.api_key_env} 未设置"
    return None


def _clip(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n... [truncated {len(text) - limit} chars]"


def _read_tool(path: str) -> str:
    """读取 docs/ 目录下的教学材料文件，按行号返回文本。

    错误即协议消息：路径越界/不存在/读取失败等情况一律返回 "Error: ..." 字符串
    交回模型自己决定怎么回应，不抛异常打断整个 run。
    """
    try:
        target = (DOCS_ROOT / path).resolve()
        if not (target == DOCS_ROOT or target.is_relative_to(DOCS_ROOT)):
            return f"Error: path outside docs/: {path}"
        if not target.is_file():
            return f"Error: not a file: {path}"
        text = target.read_text(encoding="utf-8", errors="replace")
        numbered = "\n".join(f"{i + 1}\t{line}" for i, line in enumerate(text.splitlines()))
        return _clip(numbered, _READ_TOOL_OUTPUT_LIMIT)
    except Exception as e:
        return f"Error: {type(e).__name__}: {e}"


_READ_TOOL = Tool(
    _read_tool,
    name="read",
    description="Read a file under docs/ (course material) by path relative to docs/, e.g. 'design-tokens.md'.",
)


# read_pdf 工具的作用域：materials 库（Lick 笔记里引用的谱面 PDF），按
# material id 解析。store 本身无状态、根目录每次调用现读 prefs，所以这里
# 自建一个实例和 server.py 的那份互不干扰；解析/抽取/错误协议都在
# src/pdf_text.py（不带 pydantic_ai 依赖，可独立单测）。
def _materials_dir() -> Path:
    return Path(prefs.load()["materials_dir"]).expanduser()


_MATERIALS_STORE = LocalFlatMaterialsStore(_materials_dir)


def _read_pdf_tool(material_id: str, start_page: int = 1, end_page: int = 0) -> str:
    return read_material_pdf(
        material_id, start_page, end_page, path_for=_MATERIALS_STORE.path_for
    )


_READ_PDF_TOOL = Tool(
    _read_pdf_tool,
    name="read_pdf",
    description=(
        "Extract text from a PDF in the materials library (scores referenced from Lick notes), "
        "by material id — the <id> in /api/materials/<id>. Returns page-numbered text; for long "
        "PDFs pass start_page/end_page (1-based, inclusive). A scanned image PDF yields no text."
    ),
)


# generate_accompaniment 工具的作用域：只构造一个可播放的伴奏预览（复用 Vamp/Jam
# 的引擎），不写文件、不落库——"预览"和"保存进用户的库"是两回事，后者仍然是助教
# 只读禁令覆盖的范围（见 agent_api.py 的系统提示词）。
_ACCOMPANIMENT_MIN_BPM, _ACCOMPANIMENT_MAX_BPM = 20.0, 300.0
_ACCOMPANIMENT_MAX_BARS = 64


def _style_ids() -> set[str]:
    return {s["id"] for s in get_all_styles()}


def _strip_slash_bass(name: str) -> str:
    """"G/B" -> "G"：和 Progression Lab 发送到 Jam 时的做法一致（见
    web/progression-lab.js plJamChordName 的同一条注释）——
    gen_accompaniment_midi.parse_chord 没有转位/斜杠贝斯音语法，Jam 的贝斯声部
    本来就是按 style 型态从根音生成，不是从字面贝斯音生成，斜杠贝斯音发过去
    只会在 /api/play 里 500。"""
    return name.split("/", 1)[0]


def _chord_parses(name: str) -> bool:
    try:
        _parse_chord(name)
        return True
    except ValueError:
        return False


def _generate_accompaniment_tool(
    key: str, style: str, bpm: float, progression: list[str], loops: int = 4
) -> str:
    """构造一个可播放的和弦进行预览，交给前端渲染成可交互卡片。

    返回值是一个 widget 信封（JSON 字符串）而不是给模型/用户看的文本——
    agent_api._emit_tool_result 认出顶层 "widget" 字段后，会把它作为独立的
    "widget" SSE 事件转发（不裁剪、不当工具摘要展示），前端 agent-assistant.js
    按 widget 类型渲染成"试听 / 在 Jam 中打开"的卡片。

    `progression` 一个元素=一整小节（和 Vamp/Jam 的数据模型、/api/play 的展开
    方式一致：server.py api_play 把每个 bar 的 chords 拼平成一个和弦=一小节）。
    """
    style = style if style in _style_ids() else "pop"
    if not progression or not (1 <= len(progression) <= _ACCOMPANIMENT_MAX_BARS):
        return f"Error: progression must have 1-{_ACCOMPANIMENT_MAX_BARS} chords"
    bpm = max(_ACCOMPANIMENT_MIN_BPM, min(_ACCOMPANIMENT_MAX_BPM, float(bpm)))
    loops = max(1, min(999, int(loops)))
    stripped = [_strip_slash_bass(name) for name in progression]
    bad = [name for name, s in zip(progression, stripped) if not _chord_parses(s)]
    if bad:
        return f"Error: unparseable chord(s): {', '.join(bad)}"
    accompaniment = {
        "title": ("助教生成：" + " ".join(progression))[:60],
        "key": key or "C",
        "style": style,
        "bpm": bpm,
        "loops": loops,
        "time_signature": "4/4",
        "bars": [{"chords": [{"name": name, "beats": 4}]} for name in stripped],
        "fill_every": 8,
        "volume": 1.0,
    }
    data = {"accompaniment": accompaniment}
    if stripped != progression:
        # 告诉模型这一轮简化了什么，让它据实转述给用户，而不是替用户以为
        # 贝斯就是按原斜杠和弦发的音在响。
        data["note"] = (
            "Jam 引擎不支持转位/斜杠贝斯音记法，以下和弦已简化为根位（贝斯声部按 "
            f"style 自动生成）：{', '.join(f'{o} -> {s}' for o, s in zip(progression, stripped) if o != s)}"
        )
    return json.dumps(
        {"widget": "accompaniment_preview", "data": data},
        ensure_ascii=False,
    )


_GENERATE_ACCOMPANIMENT_TOOL = Tool(
    _generate_accompaniment_tool,
    name="generate_accompaniment",
    description=(
        "Generate a playable chord-progression preview using this app's own accompaniment "
        "engine (drums/bass/piano groove matched to `style`), one chord per bar, e.g. "
        "progression=['Cm', 'G/B', 'Bb', 'F/A']. Use this whenever the user asks you to "
        "play/generate/demo a chord progression for them to listen to — it renders an "
        "in-chat preview card with a Play button and an 'open in Jam' link; it is not audio "
        "you can narrate in text, and it does not save anything to the user's library. "
        "`style` must be one of the app's style ids (pop/ballad/shuffle/blues/rock/metal/"
        "rnb/funk/bossa/ambient) — pick the closest feel, default to 'pop' if unsure. Slash "
        "chords (e.g. 'G/B') are accepted but the Jam engine has no inversion notation, so "
        "the bass note after '/' is dropped and the bass line is generated from the style "
        "pattern instead — if the return value includes a `note`, tell the user what got "
        "simplified rather than implying the bass plays the literal slash note."
    ),
)


@dataclass
class _TrackedSummarizingCompaction(SummarizingCompaction):
    """记下最近一次摘要的内容和覆盖范围（覆盖的是输入消息列表的前 N 条），
    供调用方落盘——摘要只有跨轮持久化，SummarizingCompaction 的 incremental
    模式才能在下轮摘要时基于它续写，而不是每轮从头重新摘要。"""

    last_summary: str | None = None  # 带 _SUMMARY_PREFIX 前缀的完整 content
    last_covers: int = 0

    async def compact(self, messages, ctx):
        result = await super().compact(messages, ctx)
        if result is messages:
            return result  # cutoff <= 0，没动
        for m in result:
            if not isinstance(m, ModelRequest):
                continue
            for p in m.parts:
                if isinstance(p, SystemPromptPart) and p.content.startswith(_SUMMARY_PREFIX):
                    # 覆盖范围 = 被摘要掉的前缀长度，和 summarize 内部的 cutoff 同一份输入
                    cutoff = (
                        find_token_cutoff(messages, self.keep_tokens, self.tokenizer)
                        if self.keep_tokens is not None
                        else find_safe_cutoff(messages, self.keep_messages)
                    )
                    self.last_summary = p.content
                    self.last_covers = max(cutoff, 0)
                    return result
        return result


def _compaction_capability(model, model_obj: "AgentModel") -> TieredCompaction:
    """跑在 model 前面的压缩管线：先零成本清掉旧 tool result，还超再摘要。

    `context_window` 显式传 model_obj.context_window（我们自己配置里已知的窗口大小）而不是
    让库去猜——kc/codex 这两个 model name 不在 pydantic-ai 的 genai-prices 注册表里，猜不到
    真实窗口，猜错了压缩触发时机就全错。
    """
    return TieredCompaction(
        tiers=[
            ClearToolResults(max_tokens=1, keep_pairs=2),
            _TrackedSummarizingCompaction(
                model=model,
                max_fraction=_COMPACTION_TARGET_FRACTION,  # 校验要求设置；被 TieredCompaction 接管驱动，这里不是实际触发条件
                context_window=model_obj.context_window,
                keep_tokens=_COMPACTION_KEEP_TOKENS,
            ),
        ],
        target_fraction=_COMPACTION_TARGET_FRACTION,
        context_window=model_obj.context_window,
    )


def history_from_dicts(history: list[dict]) -> list[ModelMessage]:
    """把 session 存出来的 [{role, content}, ...] 重建成 pydantic-ai 的 message_history。

    每轮问答都走这条路（服务端不持有跨 run 的原生 message_history，权威历史是
    agent_sessions 的 JSONL）。role 除了 user/assistant 还可能是 "system"——上一轮
    压缩落盘的摘要条目（见 agent_sessions.load_history_for_prompt）。
    这条重建路径本身没有历史上限：重建出来的列表照样会先过一遍 stream_parts 里挂的压缩
    capability 再发给模型，超限一样会被摘要掉，不需要在这里再截一次。
    """
    messages: list[ModelMessage] = []
    for msg in history:
        role = msg.get("role")
        content = str(msg.get("content", ""))
        if not content:
            continue
        if role == "user":
            messages.append(ModelRequest(parts=[UserPromptPart(content=content)]))
        elif role == "assistant":
            messages.append(ModelResponse(parts=[TextPart(content=content)]))
        elif role == "system":
            # 上一轮压缩留下的摘要（content 自带 _SUMMARY_PREFIX 前缀）——原样塞回
            # SystemPromptPart，SummarizingCompaction 的 incremental 模式靠认出这个
            # 前缀来续写旧摘要，而不是从头重新摘要。
            messages.append(ModelRequest(parts=[SystemPromptPart(content=content)]))
    return messages


def is_context_overflow(error: str) -> bool:
    """provider 返回的上下文超长错误（token 估算漏了、压缩也没能救回来的情况）。

    匹配各家的常见报文：Anthropic 的 "prompt is too long"、OpenAI 的
    "context_length_exceeded"、Kimi 兼容端点的同类 400，以及 HTTP 413。
    """
    s = error.lower()
    if "status_code: 413" in s or "status code: 413" in s:
        return True
    return any(
        k in s
        for k in (
            "prompt is too long",
            "context_length_exceeded",
            "context length",
            "maximum context",
            "too many tokens",
            "request too large",
        )
    )


def emergency_trim_history(messages: list[ModelMessage]) -> list[ModelMessage]:
    """overflow 兜底：砍掉最旧的一半历史，重试一次。压缩摘要条目（SystemPromptPart
    的 ModelRequest）是最有价值的压缩产物，钉住不砍；砍完保证首条是 ModelRequest
    （Anthropic 协议要求对话以 user 角色开头）。"""
    if not messages:
        return messages
    head: list[ModelMessage] = []
    rest = list(messages)
    first = rest[0]
    if isinstance(first, ModelRequest) and any(
        isinstance(p, SystemPromptPart) for p in first.parts
    ):
        head.append(first)
        rest = rest[1:]
    rest = rest[len(rest) // 2:]
    while rest and not isinstance(rest[0], ModelRequest):
        rest = rest[1:]
    return head + rest


async def stream_parts(
    prompt: str,
    system_prompt: str,
    provider: AgentProvider | None = None,
    model_name: str | None = None,
    thinking: str | None = None,
    meta: dict | None = None,
    message_history: list[ModelMessage] | None = None,
    followup_queue: "asyncio.Queue[str] | None" = None,
) -> AsyncIterator[tuple[str, str]]:
    """流式问答。永不 raise——任何失败都作为最后一次 ("error", msg) yield 出去。

    `prompt` 只是当前这一轮的用户输入（+页面上下文），更早的对话轮次走 `message_history`
    （真正的 pydantic-ai message_history，不是拼进 prompt 的文本）——这样超窗口时才能被
    下面挂的压缩 capability 自动摘要，而不是被硬截断。

    `followup_queue`：run 进行中塞进来的追问消息（完整 prompt 文本）。一个转发协程
    把它们逐个 `run.enqueue(..., priority="when_idle")`——pydantic-ai 2.36 核心自带的
    PendingMessageDrainCapability 会在 run 本要结束时投递并续跑一轮回答它，不打断当前
    输出（对应 pi-mono 的 followUp 语义，不是 steer 打断）。追问的回答开始流式时
    会 yield 一次 ("followup", "") 作为气泡分界标记。

    yield 的 kind: "text"（正文增量）/ "thinking"（思考过程增量）/
    "tool"（一次工具调用的 JSON 摘要，供前端渲染小提示气泡）/ "widget"（工具返回了
    结构化信封 {"widget": <类型名>, "data": {...}}——不是给模型/用户看的文本，是
    App 能力开放给助教的通道，见 _GENERATE_ACCOMPANIMENT_TOOL；前端按类型渲染成
    可交互卡片）/ "followup"（追问回答开始的分界标记，data 为空）/ "error"。
    """
    try:
        providers = discover_providers()
        if not providers:
            yield ("error", "没有可用的 agent provider")
            return

        p = provider or next((x for x in providers if x.default), providers[0])
        reason = check_available(p)
        if reason:
            yield ("error", f"provider {p.name} 不可用：{reason}")
            return

        model_obj = next((m for m in p.models if m.name == model_name), None) if model_name else None
        model_obj = model_obj or p.models[0]

        use_thinking = bool(thinking and thinking != "off" and thinking in model_obj.thinking_levels)
        if p.kind == "codex":
            creds = _codex_credentials()
            if creds is None:
                yield ("error", f"provider {p.name} 不可用：登录态过期或缺失")
                return
            # openai SDK 的 AsyncOpenAI 客户端只认 api_key 概念的 Authorization: Bearer
            # header，正好拿 access_token 塞进去；chatgpt-account-id/originator/OpenAI-Beta
            # 这几个是 Codex 后端专属的必需 header，不是标准 OpenAI API 需要的。
            openai_client = AsyncOpenAI(
                api_key=creds["access_token"],
                base_url=_CODEX_BASE_URL,
                http_client=httpx.AsyncClient(proxy=p.proxy) if p.proxy else None,
                default_headers={
                    "chatgpt-account-id": creds["account_id"],
                    "originator": "my-music-stdio",
                    "OpenAI-Beta": "responses=experimental",
                },
            )
            model = OpenAIResponsesModel(model_obj.name, provider=OpenAIProvider(openai_client=openai_client))
            # Codex 后端拒绝 store:true（"Store must be set to false"）——它不是标准
            # api.openai.com，没有 server-side 会话存储这回事。
            settings = OpenAIResponsesModelSettings(openai_store=False)
            if use_thinking:
                settings["thinking"] = thinking
                # Responses API 默认不回思考摘要（reasoning.summary 为空），只设 thinking
                # 档位的话前端「思考过程」框永远收不到一个字——要摘要得显式开。
                settings["openai_reasoning_summary"] = "auto"
        else:
            api_key = _resolve_var(p.api_key_env)
            model = AnthropicModel(
                model_obj.name,
                provider=AnthropicProvider(
                    api_key=api_key,
                    base_url=p.base_url,
                    http_client=httpx.AsyncClient(proxy=p.proxy) if p.proxy else None,
                ),
            )
            settings = AnthropicModelSettings(thinking=thinking) if use_thinking else None

        # web_search 是 provider 自己服务端跑的 hosted tool（Anthropic/OpenAI 都支持同一套
        # NativeTool 协议）——搜索本身发生在 Anthropic/OpenAI 的服务器上，不是我们代码做的。
        # 压缩 capability 跑在 before_model_request，会话超窗口时自动触发，不需要调用方关心；
        # compaction 变量留着引用，run 结束后从里面的 tracked tier 取摘要结果上报 meta。
        compaction = _compaction_capability(model, model_obj)
        agent = Agent(
            model,
            system_prompt=system_prompt,
            tools=[_READ_TOOL, _READ_PDF_TOOL, _GENERATE_ACCOMPANIMENT_TOOL],
            capabilities=[
                NativeTool(WebSearchTool()),
                compaction,
                _StripNativeToolParts(),
            ],
            model_settings=settings,
        )

        pending_calls: dict[str, tuple[str, dict]] = {}
        start = time.monotonic()

        def _widget_envelope(content) -> dict | None:
            # 只有本地 Tool（如 _GENERATE_ACCOMPANIMENT_TOOL）会返回这种信封；
            # web_search 的 NativeToolReturnPart content 不是这个形状，parse
            # 失败或形状不对就当普通工具结果处理，不当异常抛出。
            if not isinstance(content, str):
                return None
            try:
                parsed = json.loads(content)
            except (json.JSONDecodeError, TypeError):
                return None
            if isinstance(parsed, dict) and "widget" in parsed and "data" in parsed:
                return parsed
            return None

        def _emit_tool_result(tool_call_id: str, tool_name: str, content) -> tuple[str, str]:
            name, args = pending_calls.pop(tool_call_id, (tool_name, None))
            envelope = _widget_envelope(content)
            if envelope is not None:
                return (
                    "widget",
                    json.dumps(
                        {"name": name, "args": args, **envelope},
                        ensure_ascii=False,
                    ),
                )
            return (
                "tool",
                json.dumps(
                    {"name": name, "args": args, "result_preview": _clip(str(content), _TOOL_RESULT_PREVIEW_LIMIT)},
                    ensure_ascii=False,
                ),
            )

        async def _forward_followups(run) -> None:
            # 把 followup_queue 里的追问转成 when_idle enqueue。enqueue 要求和驱动
            # agent.iter() 的是同一个 event loop——这里转发协程和 run 同在当前 loop，
            # 生产方（HTTP handler）也只是往 asyncio.Queue 里 put，天然安全。
            while True:
                text = await followup_queue.get()
                try:
                    run.enqueue(text, priority="when_idle")
                except Exception:  # run 刚好结束等竞态：消息已由调用方落盘，reload 后可见
                    logger.warning("followup enqueue 失败（run 可能已结束）", exc_info=True)

        async with agent.iter(prompt, message_history=message_history) as run:
            forwarder = asyncio.create_task(_forward_followups(run)) if followup_queue is not None else None
            answered = False  # 本轮已经产出过正文（用于识别追问续跑的边界）
            try:
                async for node in run:
                    if Agent.is_model_request_node(node):
                        # when_idle 投递后 run 会续跑一个新的 ModelRequestNode，其 request
                        # 以 UserPromptPart 结尾；工具循环的续跑 request 以 ToolReturnPart
                        # 结尾。以此区分"追问的回答开始了"，让前端另起一个气泡。
                        if answered and node.request.parts and isinstance(node.request.parts[-1], UserPromptPart):
                            yield ("followup", "")
                            answered = False
                        async with node.stream(run.ctx) as stream:
                            async for event in stream:
                                # Anthropic always starts a part empty and streams TextPartDelta/
                                # ThinkingPartDelta chunks; the OpenAI Responses API (Codex) can
                                # instead hand back a short answer's full content in one
                                # PartStartEvent with no deltas at all — handle both shapes.
                                if isinstance(event, PartStartEvent):
                                    if isinstance(event.part, TextPart) and event.part.content:
                                        yield ("text", event.part.content)
                                        answered = True
                                    elif isinstance(event.part, ThinkingPart) and event.part.content:
                                        yield ("thinking", event.part.content)
                                    elif isinstance(event.part, NativeToolCallPart):
                                        pending_calls[event.part.tool_call_id] = (event.part.tool_name, event.part.args)
                                    elif isinstance(event.part, NativeToolReturnPart):
                                        yield _emit_tool_result(
                                            event.part.tool_call_id, event.part.tool_name, event.part.content
                                        )
                                elif isinstance(event, PartDeltaEvent):
                                    delta = event.delta
                                    if isinstance(delta, TextPartDelta) and delta.content_delta:
                                        yield ("text", delta.content_delta)
                                        answered = True
                                    elif isinstance(delta, ThinkingPartDelta) and delta.content_delta:
                                        yield ("thinking", delta.content_delta)
                    elif Agent.is_call_tools_node(node):
                        async with node.stream(run.ctx) as stream:
                            async for event in stream:
                                if isinstance(event, FunctionToolCallEvent):
                                    pending_calls[event.part.tool_call_id] = (event.part.tool_name, event.part.args)
                                elif isinstance(event, FunctionToolResultEvent):
                                    yield _emit_tool_result(event.part.tool_call_id, event.part.tool_name, event.part.content)
            finally:
                if forwarder is not None:
                    forwarder.cancel()

            if meta is not None:
                usage = run.usage
                meta["duration_ms"] = int((time.monotonic() - start) * 1000)
                meta["num_turns"] = usage.requests
                meta["usage"] = {
                    "input_tokens": usage.input_tokens,
                    "cache_read_input_tokens": usage.cache_read_tokens,
                    "cache_creation_input_tokens": usage.cache_write_tokens,
                }
                meta["model_usage"] = [model_obj.name]
                # 本轮如果触发了摘要压缩，把摘要内容和覆盖范围上报给调用方落盘——
                # 下一轮用它重建历史，incremental 摘要才能跨轮续写而不是每轮重来。
                tracked = next(
                    (t for t in compaction.tiers if isinstance(t, _TrackedSummarizingCompaction)),
                    None,
                )
                if tracked is not None and tracked.last_summary:
                    # covers 是 capability 视角的消息条数（历史 + 当前提问 [+ 工具往返]），
                    # 换算成 JSONL 历史条数：当前提问和工具往返都在近期尾部，不会被摘要
                    # 覆盖，钳到输入历史长度即可。
                    meta["compaction"] = {
                        "summary": tracked.last_summary,
                        "covers": min(tracked.last_covers, len(message_history or [])),
                    }
    except Exception as e:
        yield ("error", f"{type(e).__name__}: {e}")
