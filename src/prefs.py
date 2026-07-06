import json
from pathlib import Path

DEFAULTS = {
    "bars_per_row": 4,
    "soundfont_path": "~/music-practice/soundfonts/Timbres of Heaven (XGM) 4.00(G).sf2",
    # Data directories default to the macOS Application Support location so a
    # future Mac App Store build can comply with App Sandbox requirements without
    # a migration step.  Existing installs keep their saved paths from prefs.json
    # and are not affected.
    "songs_dir": "~/Library/Application Support/MyMusic/songs/",
    "licks_dir": "~/Library/Application Support/MyMusic/licks/",
}


def _prefs_path() -> Path:
    new = Path.home() / "Library" / "Application Support" / "MyMusic" / "prefs.json"
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
