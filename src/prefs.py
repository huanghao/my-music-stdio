import json
from pathlib import Path

DEFAULTS = {
    "bars_per_row": 4,
    "soundfont_path": "~/music-practice/soundfonts/MuseScore_General.sf3",
    "songs_dir": "~/music-practice/songs/",
}


def _prefs_path() -> Path:
    return Path.home() / ".config" / "music-practice" / "prefs.json"


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
