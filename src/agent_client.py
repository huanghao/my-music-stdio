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
import base64
import json
import logging
import os
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path

import httpx
import yaml
from openai import AsyncOpenAI
from pydantic_ai import Agent
from pydantic_ai.capabilities import NativeTool
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    NativeToolCallPart,
    NativeToolReturnPart,
    PartDeltaEvent,
    PartStartEvent,
    TextPart,
    TextPartDelta,
    ThinkingPart,
    ThinkingPartDelta,
)
from pydantic_ai.models.anthropic import AnthropicModel, AnthropicModelSettings
from pydantic_ai.models.openai import OpenAIResponsesModel, OpenAIResponsesModelSettings
from pydantic_ai.native_tools import WebSearchTool
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.tools import Tool

import src.prefs as prefs
from src.materials_store import LocalFlatMaterialsStore
from src.pdf_text import read_material_pdf

logger = logging.getLogger(__name__)

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
    try:
        store = json.loads(_PI_MODELS_STORE_PATH.read_text())
    except Exception:
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
    except OSError:
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


async def stream_parts(
    prompt: str,
    system_prompt: str,
    provider: AgentProvider | None = None,
    model_name: str | None = None,
    thinking: str | None = None,
    meta: dict | None = None,
) -> AsyncIterator[tuple[str, str]]:
    """流式问答。永不 raise——任何失败都作为最后一次 ("error", msg) yield 出去。

    yield 的 kind: "text"（正文增量）/ "thinking"（思考过程增量）/
    "tool"（一次工具调用的 JSON 摘要，供前端渲染小提示气泡）/ "error"。
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
        agent = Agent(
            model,
            system_prompt=system_prompt,
            tools=[_READ_TOOL, _READ_PDF_TOOL],
            capabilities=[NativeTool(WebSearchTool())],
            model_settings=settings,
        )

        pending_calls: dict[str, tuple[str, dict]] = {}
        start = time.monotonic()

        def _emit_tool_result(tool_call_id: str, tool_name: str, content) -> tuple[str, str]:
            name, args = pending_calls.pop(tool_call_id, (tool_name, None))
            return (
                "tool",
                json.dumps(
                    {"name": name, "args": args, "result_preview": _clip(str(content), _TOOL_RESULT_PREVIEW_LIMIT)},
                    ensure_ascii=False,
                ),
            )

        async with agent.run_stream_events(prompt) as events:
            async for event in events:
                # Anthropic always starts a part empty and streams TextPartDelta/
                # ThinkingPartDelta chunks; the OpenAI Responses API (Codex) can
                # instead hand back a short answer's full content in one
                # PartStartEvent with no deltas at all — handle both shapes.
                if isinstance(event, PartStartEvent):
                    if isinstance(event.part, TextPart) and event.part.content:
                        yield ("text", event.part.content)
                    elif isinstance(event.part, ThinkingPart) and event.part.content:
                        yield ("thinking", event.part.content)
                    elif isinstance(event.part, NativeToolCallPart):
                        pending_calls[event.part.tool_call_id] = (event.part.tool_name, event.part.args)
                    elif isinstance(event.part, NativeToolReturnPart):
                        yield _emit_tool_result(event.part.tool_call_id, event.part.tool_name, event.part.content)
                elif isinstance(event, PartDeltaEvent):
                    delta = event.delta
                    if isinstance(delta, TextPartDelta) and delta.content_delta:
                        yield ("text", delta.content_delta)
                    elif isinstance(delta, ThinkingPartDelta) and delta.content_delta:
                        yield ("thinking", delta.content_delta)
                elif isinstance(event, FunctionToolCallEvent):
                    pending_calls[event.part.tool_call_id] = (event.part.tool_name, event.part.args)
                elif isinstance(event, FunctionToolResultEvent):
                    yield _emit_tool_result(event.part.tool_call_id, event.part.tool_name, event.part.content)

            if meta is not None:
                usage = events.usage
                meta["duration_ms"] = int((time.monotonic() - start) * 1000)
                meta["num_turns"] = usage.requests
                meta["usage"] = {
                    "input_tokens": usage.input_tokens,
                    "cache_read_input_tokens": usage.cache_read_tokens,
                    "cache_creation_input_tokens": usage.cache_write_tokens,
                }
                meta["model_usage"] = [model_obj.name]
    except Exception as e:
        yield ("error", f"{type(e).__name__}: {e}")
