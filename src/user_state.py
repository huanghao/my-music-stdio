"""Server-side storage for small per-page state that used to live only in
browser localStorage — practice stats and lick ordering. Moved here so it
survives clearing browser data, switching browsers, or migrating machines,
same as everything else under data_dir(). Page-level UI conveniences (last
selection, panel open/closed, volume) are deliberately NOT moved here — they
stay in localStorage, cheap to lose.

One shared JSON file, atomic write (temp file + rename) so a crash mid-write
can't corrupt every key's data at once — same reasoning as
materials_store.py's index file.
"""
import json
import logging
from pathlib import Path
from typing import Any

from src.data_dir import data_dir

logger = logging.getLogger(__name__)

# Keys this store accepts: the practice stats + lick ordering formerly kept
# only in localStorage (see CLAUDE.md's localStorage table for what stays
# client-side).
KEYS = {
    "dd_stats", "fb_chord_stats", "fb_ear_stats", "fb_pitch_stats", "kd_stats", "licks_order",
    "pt_blocks",
}


def _path() -> Path:
    return data_dir() / "user_state.json"


def _load_all() -> dict:
    p = _path()
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text())
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("failed to read user_state.json: %s: %s", type(e).__name__, e)
        return {}


def _save_all(data: dict) -> None:
    final_path = _path()
    final_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = final_path.with_name(final_path.name + ".tmp")
    tmp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    tmp_path.replace(final_path)


def get(key: str) -> Any:
    return _load_all().get(key)


def set(key: str, value: Any) -> None:
    data = _load_all()
    data[key] = value
    _save_all(data)
