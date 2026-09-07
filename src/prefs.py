import json
import logging
from pathlib import Path

from src.data_dir import data_dir

logger = logging.getLogger(__name__)

DEFAULTS = {
    "bars_per_row": 4,
    "soundfont_path": "~/music-practice/soundfonts/Timbres of Heaven (XGM) 4.00(G).sf2",
    # Data directories default under data_dir() (~/workspace/my-store/my-music-stdio-data)
    # so a fresh install's accompaniments/licks/materials live in the same
    # migratable place as everything else. Existing installs keep their saved
    # paths from prefs.json and are not affected.
    "accompaniments_dir": str(data_dir() / "accompaniments") + "/",
    "licks_dir": str(data_dir() / "licks") + "/",
    "materials_dir": str(data_dir() / "materials") + "/",
}


def _prefs_path() -> Path:
    new = data_dir() / "prefs.json"
    old = Path.home() / ".config" / "music-practice" / "prefs.json"
    # One-time migration: copy old location → new on first run after this change.
    if old.exists() and not new.exists():
        new.parent.mkdir(parents=True, exist_ok=True)
        new.write_text(old.read_text())
    return new


def load() -> dict:
    p = _prefs_path()
    if not p.exists():
        return dict(DEFAULTS)
    data = json.loads(p.read_text())
    return {**DEFAULTS, **data}


def save(updates: dict) -> dict:
    current = load()
    current.update(updates)
    p = _prefs_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(current, indent=2))
    return current
