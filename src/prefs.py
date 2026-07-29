import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULTS = {
    "bars_per_row": 4,
    "soundfont_path": "~/music-practice/soundfonts/Timbres of Heaven (XGM) 4.00(G).sf2",
    # Data directories default to the macOS Application Support location so a
    # future Mac App Store build can comply with App Sandbox requirements without
    # a migration step.  Existing installs keep their saved paths from prefs.json
    # and are not affected.
    "accompaniments_dir": "~/Library/Application Support/MyMusicStdio/accompaniments/",
    "licks_dir": "~/Library/Application Support/MyMusicStdio/licks/",
    "materials_dir": "~/Library/Application Support/MyMusicStdio/materials/",
}


def _migrate_app_support_folder() -> None:
    """One-time rename of the whole per-app data folder: an earlier version
    used "MyMusic" as the folder name (inconsistent with the project's actual
    name, my-music-stdio) — renaming the whole folder in one move means a
    prior install's prefs.json/accompaniments/licks/materials all come along
    together, instead of silently going dark under the old name once DEFAULTS
    above points somewhere else."""
    base = Path.home() / "Library" / "Application Support"
    old = base / "MyMusic"
    new = base / "MyMusicStdio"
    if old.exists() and not new.exists():
        try:
            old.rename(new)
        except OSError as e:
            # _prefs_path() (below) runs this on every load()/save(), and
            # those can fire concurrently on app startup (e.g. Promise.all
            # over /api/prefs + /api/soundfonts) — a second call landing
            # here after a first one already renamed it is an expected
            # race, not a real failure. Log instead of raising either way:
            # worst case the app just keeps using the old folder name.
            logger.warning("Could not migrate %s to %s: %s", old, new, e)


def _prefs_path() -> Path:
    _migrate_app_support_folder()
    new = Path.home() / "Library" / "Application Support" / "MyMusicStdio" / "prefs.json"
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
