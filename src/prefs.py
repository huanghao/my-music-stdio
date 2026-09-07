import json
import logging
from pathlib import Path

from src.data_dir import data_dir

logger = logging.getLogger(__name__)

DEFAULTS = {
    "bars_per_row": 4,
    # Soundfonts default under data_dir() too — see _migrate_soundfonts_dir()
    # below, which moves the whole folder there so it comes along with
    # everything else when this directory gets copied to a new machine.
    "soundfont_path": str(data_dir() / "soundfonts" / "Timbres of Heaven (XGM) 4.00(G).sf2"),
    # Data directories default under data_dir() (~/workspace/my-store/my-music-stdio-data)
    # so a fresh install's accompaniments/licks/materials live in the same
    # migratable place as everything else. Existing installs keep their saved
    # paths from prefs.json and are not affected.
    "accompaniments_dir": str(data_dir() / "accompaniments") + "/",
    "licks_dir": str(data_dir() / "licks") + "/",
    "materials_dir": str(data_dir() / "materials") + "/",
}

_OLD_SOUNDFONTS_DIR = Path.home() / "music-practice" / "soundfonts"


def _prefs_path() -> Path:
    new = data_dir() / "prefs.json"
    old = Path.home() / ".config" / "music-practice" / "prefs.json"
    # One-time migration: copy old location → new on first run after this change.
    if old.exists() and not new.exists():
        new.parent.mkdir(parents=True, exist_ok=True)
        new.write_text(old.read_text())
    return new


def _migrate_soundfonts_dir() -> Path:
    """One-time move of the soundfonts folder — a large, re-downloadable
    public resource, unlike everything else under data_dir() — out of
    ~/music-practice/soundfonts and into data_dir(), so it isn't silently
    left behind when this directory is the only thing copied to a new
    machine."""
    new_dir = data_dir() / "soundfonts"
    if _OLD_SOUNDFONTS_DIR.exists() and not new_dir.exists():
        try:
            new_dir.parent.mkdir(parents=True, exist_ok=True)
            _OLD_SOUNDFONTS_DIR.rename(new_dir)
        except OSError as e:
            logger.warning("Could not migrate %s to %s: %s", _OLD_SOUNDFONTS_DIR, new_dir, e)
    return new_dir


def load() -> dict:
    p = _prefs_path()
    data = json.loads(p.read_text()) if p.exists() else {}
    merged = {**DEFAULTS, **data}

    # A saved soundfont_path pointing at the pre-migration location needs to
    # follow the directory rename above, or playback silently breaks (file no
    # longer exists at the old path). Rewritten in place and persisted so
    # this only happens once.
    new_sf_dir = _migrate_soundfonts_dir()
    old_prefix = str(_OLD_SOUNDFONTS_DIR)
    if merged["soundfont_path"].startswith(old_prefix):
        merged["soundfont_path"] = str(new_sf_dir) + merged["soundfont_path"][len(old_prefix):]
        data["soundfont_path"] = merged["soundfont_path"]
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data, indent=2))

    return merged


def save(updates: dict) -> dict:
    current = load()
    current.update(updates)
    p = _prefs_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(current, indent=2))
    return current
