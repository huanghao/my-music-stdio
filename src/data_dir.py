"""Single on-disk data directory for this app's server-side state: prefs,
accompaniments, licks, materials, agent ledger/sessions. Historically these
lived scattered under macOS's per-app Application Support folder; consolidated
here under ~/workspace/my-store/ so that migrating to a new machine is just
`git clone` of the project plus copying that one directory (my-store holds
other projects' data the same way).

Mirrors prefs.py's earlier folder-rename migration (MyMusic -> MyMusicStdio):
one rename() of the whole old directory moves prefs.json/accompaniments/
licks/materials/agent-ledger.jsonl/agent-sessions together in one step,
instead of each piece silently going dark under the old path independently.

data_dir() recomputes Path.home() on every call rather than caching a
module-level Path — required so it stays correct under tests that
monkeypatch HOME and reload only the caller's module, not this one.
"""
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def data_dir() -> Path:
    home = Path.home()
    old_name = home / "Library" / "Application Support" / "MyMusic"
    app_support = home / "Library" / "Application Support" / "MyMusicStdio"
    new = home / "workspace" / "my-store" / "my-music-stdio-data"

    if old_name.exists() and not app_support.exists():
        try:
            old_name.rename(app_support)
        except OSError as e:
            logger.warning("Could not migrate %s to %s: %s", old_name, app_support, e)

    if app_support.exists() and not new.exists():
        try:
            new.parent.mkdir(parents=True, exist_ok=True)
            app_support.rename(new)
        except OSError as e:
            logger.warning("Could not migrate %s to %s: %s", app_support, new, e)

    return new
