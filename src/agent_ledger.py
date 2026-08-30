"""Agent 用量记账：每轮问答结束后 append 一行 JSON 到本地日志文件，仅用于事后审计，
不参与任何限流/计费逻辑。falls back silently (with a warning log) on any IO
failure so a broken ledger file never takes down the actual agent request."""
import json
import logging
from datetime import UTC, datetime
from pathlib import Path

logger = logging.getLogger(__name__)

_LEDGER_PATH = (
    Path.home() / "Library" / "Application Support" / "MyMusicStdio" / "agent-ledger.jsonl"
)


def record_run(entry: dict) -> None:
    row = {"ts": datetime.now(UTC).isoformat(), **entry}
    try:
        _LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _LEDGER_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    except OSError as e:
        logger.warning("failed to write agent ledger: %s: %s", type(e).__name__, e)
