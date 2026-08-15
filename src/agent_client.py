"""通用 agent 调用层：backend 发现 + 选择 + 流式问答。

Copied verbatim from ~/workspace/0625-misc/pylab/agent_client.py — per
~/.claude/docs/local-ai-clis.md this file is designed to be copied into any
app that wants agent access ("单文件可复制"). Keep it byte-for-byte in sync
with the source; if you need to change behavior, change it there first.

设计目标——pylab 之外的 app 也能直接用：
- backend 声明集中在用户级配置 ~/.config/agent-backends.yaml，所有 app 共享一份
- 本模块只有「调用」没有「上下文」：上下文由调用方自己组装成 prompt 字符串传入

为什么用 shim 脚本：claude-agent-sdk 只能覆盖 env 不能 unset，
spawn 的 CLI 会继承父进程全部环境——父 shell 里残留的 ANTHROPIC_BASE_URL/
ANTHROPIC_MODEL 会劫持/污染目标 backend（实测：mc 被 kc 的 k3-256k 劫持报 400）。
所以每个 backend 生成一个 shim：先 unset 污染变量，再 export 自己的，最后 exec 真 CLI。
shim 同时解决「cli 需要前缀参数」（如 mc --code）的问题。
"""
import os
import re
import stat
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path

import yaml
from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    StreamEvent,
    TextBlock,
    query,
)

CONFIG_PATH = Path.home() / ".config" / "agent-backends.yaml"
SHIM_DIR = Path.home() / ".cache" / "agent-client"
_ZSHRC_LOCAL = Path.home() / ".zshrc.local"  # ${VAR} 展开的兜底来源

# 会在 backend 之间互相劫持的路由/模型变量；没显式 export 的 backend 默认全部 unset
_HIJACK_VARS = [
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_FABLE_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "CLAUDE_CODE_SUBAGENT_MODEL",
]


@dataclass
class AgentBackend:
    name: str
    description: str = ""
    command: str = "claude"          # shim 里 exec 的命令，可带前缀参数（如 "/usr/local/bin/mc --code"）
    env: dict[str, str] = field(default_factory=dict)       # export 的变量，值支持 ${VAR} 展开
    env_unset: list[str] = field(default_factory=list)      # 额外 unset 的变量
    context_window: int | None = None   # 模型上下文窗口（tokens），用于前端展示用量百分比；未知留 None
    default: bool = False


def _resolve_var(var: str) -> str | None:
    """${VAR} 展开：先查进程环境，再兜底解析 ~/.zshrc.local 的 export 行。"""
    if var in os.environ:
        return os.environ[var]
    if _ZSHRC_LOCAL.exists():
        m = re.search(
            rf"^(?:export\s+)?{re.escape(var)}=[\"']?(.*?)[\"']?\s*$",
            _ZSHRC_LOCAL.read_text(encoding="utf-8"),
            re.MULTILINE,
        )
        if m:
            return m.group(1)
    return None


def discover_backends(config_path: Path = CONFIG_PATH) -> list[AgentBackend]:
    """读用户级配置；没有配置时兜底为 PATH 上的官方 claude。"""
    if not config_path.exists():
        return [AgentBackend(name="claude", description="官方 Claude Code（默认）", default=True)]
    cfg = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    default_name = cfg.get("default")
    backends = []
    for b in cfg.get("backends", []):
        backends.append(AgentBackend(
            name=b["name"],
            description=b.get("description", ""),
            command=b.get("command", "claude"),
            env=b.get("env") or {},
            env_unset=b.get("env_unset") or [],
            context_window=b.get("context_window"),
            default=b["name"] == default_name,
        ))
    if backends and not any(b.default for b in backends):
        backends[0].default = True
    return backends


def check_available(b: AgentBackend) -> str | None:
    """返回 None 表示可用，否则返回不可用原因。"""
    for k, v in b.env.items():
        for var in re.findall(r"\$\{(\w+)\}", str(v)):
            if _resolve_var(var) is None:
                return f"环境变量 {var} 无法展开（{k} 需要）"
    return None


def _shim_path(b: AgentBackend) -> Path:
    """生成/刷新 backend 的 shim 脚本，返回路径（幂等，内容没变不重写）。"""
    unset = sorted(set(_HIJACK_VARS) | set(b.env_unset) - set(b.env))
    lines = ["#!/bin/sh", f"# agent-client shim for backend: {b.name}"]
    if unset:
        lines.append("unset " + " ".join(unset))
    for k, v in b.env.items():
        value = re.sub(r"\$\{(\w+)\}", lambda m: _resolve_var(m.group(1)) or "", str(v))
        lines.append(f"export {k}={_sh_quote(value)}")
    lines.append(f"exec {b.command} \"$@\"")
    content = "\n".join(lines) + "\n"

    SHIM_DIR.mkdir(parents=True, exist_ok=True)
    path = SHIM_DIR / f"{b.name}.sh"
    if not path.exists() or path.read_text(encoding="utf-8") != content:
        path.write_text(content, encoding="utf-8")
        path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return path


def _sh_quote(s: str) -> str:
    return "'" + s.replace("'", "'\\''") + "'"


async def stream_parts(
    prompt: str,
    system_prompt: str,
    backend: AgentBackend | None = None,
    cwd: str | None = None,
    meta: dict | None = None,
    model: str | None = None,
) -> AsyncIterator[tuple[str, str]]:
    """向指定 backend 发起一轮纯问答（无工具、裸配置），逐段 yield (kind, chunk)。

    kind 为 "text"（正文）或 "thinking"（模型思考过程，k3 等模型思考期很长，
    不接出来调用方只能干等）。meta（可选）会被填入本轮 ResultMessage 信息：
    duration_ms / num_turns / usage / model_usage，供展示耗时、token 用量、实际模型。
    上下文由调用方组装进 prompt——本函数不知道也不关心上下文是什么。
    model（可选）覆盖 backend 默认模型，用于「这个任务足够简单，换便宜模型」的场景；
    只对没有固定模型的 backend（如官方 claude）有意义，kc 这类 env 里锁死模型的 backend 会忽略。
    """
    b = backend or next((x for x in discover_backends() if x.default), None)
    if b is None:
        raise RuntimeError("没有可用的 agent backend")
    if reason := check_available(b):
        raise RuntimeError(f"backend {b.name} 不可用：{reason}")

    options = ClaudeAgentOptions(
        system_prompt=system_prompt,
        allowed_tools=[],
        setting_sources=[],
        include_partial_messages=True,
        max_turns=3,  # 纯问答一轮够，但 kc 偶发内部续步会触顶报错，留余量
        cli_path=str(_shim_path(b)),
        cwd=cwd or str(Path.home()),
        model=model,
    )
    sent_any = False
    result_error: str | None = None
    async for msg in query(prompt=prompt, options=options):
        if isinstance(msg, StreamEvent):
            ev = msg.event
            if ev.get("type") == "content_block_delta":
                delta = ev.get("delta", {})
                if delta.get("type") == "text_delta" and delta.get("text"):
                    sent_any = True
                    yield ("text", delta["text"])
                elif delta.get("type") == "thinking_delta" and delta.get("thinking"):
                    yield ("thinking", delta["thinking"])
        elif isinstance(msg, AssistantMessage) and not sent_any:
            for block in msg.content:
                if isinstance(block, TextBlock) and block.text:
                    sent_any = True
                    yield ("text", block.text)
        elif isinstance(msg, ResultMessage):
            if meta is not None:
                meta.update({
                    "duration_ms": msg.duration_ms,
                    "num_turns": msg.num_turns,
                    "usage": msg.usage,
                    "model_usage": list((msg.model_usage or {}).keys()),
                })
            if msg.is_error:
                result_error = msg.result or "agent 返回错误"
    if result_error and not sent_any:
        raise RuntimeError(f"backend {b.name}: {result_error}")


async def stream_text(
    prompt: str,
    system_prompt: str,
    backend: AgentBackend | None = None,
    cwd: str | None = None,
    meta: dict | None = None,
    model: str | None = None,
) -> AsyncIterator[str]:
    """stream_parts 的正文-only 包装：只要文本、不关心思考过程的调用方用这个。"""
    async for kind, chunk in stream_parts(prompt, system_prompt, backend=backend, cwd=cwd, meta=meta, model=model):
        if kind == "text":
            yield chunk
