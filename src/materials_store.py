"""Storage-agnostic contract for the materials library.

Callers (the /api/materials routes in server.py) only see MaterialsStore —
swapping the on-disk layout, the index format, or the storage strategy
entirely happens by swapping the implementation below, not by touching the
routes.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import re


@dataclass
class MaterialRecord:
    id: str
    filename: str
    uploaded_at: str
    size: int
    state: dict | None = None  # opaque, caller-owned JSON blob (e.g. Song Loop's practice settings)
    content_hash: str | None = None  # sha256 hex digest — see find_by_hash for why


class MaterialsStore(ABC):
    @abstractmethod
    def save(self, filename: str, content: bytes) -> MaterialRecord: ...

    @abstractmethod
    def list_all(self) -> list[MaterialRecord]: ...

    @abstractmethod
    def path_for(self, material_id: str) -> Path | None:
        """None for both "unknown id" and "invalid/unsafe id" — callers
        don't need to distinguish, they just 404 either way."""
        ...

    @abstractmethod
    def delete(self, material_id: str) -> bool: ...

    @abstractmethod
    def find_by_hash(self, content_hash: str) -> "MaterialRecord | None":
        """The first existing material whose content hash matches, or None.
        Used to warn on upload ("this file already exists") instead of
        silently accumulating byte-identical copies under new ids."""
        ...

    @abstractmethod
    def rename(self, material_id: str, filename: str) -> bool:
        """Changes only the *display* filename, never the id (which is the
        on-disk name) — every reference elsewhere (Lick notes, Song Loop
        sourceUrl) points at the id/url, never the display filename, so
        renaming can never break an existing link. Returns False if the
        material doesn't exist."""
        ...

    @abstractmethod
    def save_state(self, material_id: str, state: dict) -> bool:
        """Attach an arbitrary JSON-serializable blob to a material, keyed
        by its id. The store doesn't interpret it. Returns False if the
        material doesn't exist."""
        ...

    @abstractmethod
    def load_state(self, material_id: str) -> dict | None:
        """None if the material doesn't exist or has no state saved yet."""
        ...


def _safe_filename(name: str) -> str:
    """Sanitize an uploaded filename: keep only the basename (strips any
    directory components an attacker could use for path traversal), restrict
    to a safe charset, and prefix a timestamp so repeat uploads never collide."""
    base = re.sub(r"[^\w.\-]", "_", Path(name).name) or "file"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    return f"{stamp}_{base}"


class LocalFlatMaterialsStore(MaterialsStore):
    """Today's behavior: a flat directory of files plus a _index.json sidecar."""

    def __init__(self, root_dir_fn):
        # A callable, not a fixed Path — the materials dir can change at
        # runtime via the Preferences page, so it's re-read on every call
        # rather than captured once at construction time.
        self._root_dir_fn = root_dir_fn

    def _root(self) -> Path:
        d = self._root_dir_fn()
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _index_path(self) -> Path:
        return self._root() / "_index.json"

    def _load_index(self) -> dict:
        p = self._index_path()
        return json.loads(p.read_text()) if p.exists() else {}

    def _save_index(self, index: dict) -> None:
        # Every song's entire Song Loop state lives in this one shared file —
        # write_text() truncates before writing, so a crash/power-loss mid-write
        # would corrupt every song's data at once, not just the one being saved.
        # Write to a temp file in the same directory (so os.replace stays on one
        # filesystem, which is what makes it atomic) and rename it into place —
        # the old file is only ever replaced by a fully-written new one.
        final_path = self._index_path()
        tmp_path = final_path.with_name(final_path.name + ".tmp")
        tmp_path.write_text(json.dumps(index, ensure_ascii=False, indent=2))
        tmp_path.replace(final_path)

    def _resolve(self, material_id: str) -> Path | None:
        base = self._root()
        p = (base / material_id).resolve()
        return p if p.is_relative_to(base.resolve()) else None

    def save(self, filename: str, content: bytes) -> MaterialRecord:
        material_id = _safe_filename(filename or "file")
        self._resolve(material_id).write_bytes(content)
        record = MaterialRecord(
            id=material_id,
            filename=filename or material_id,
            uploaded_at=datetime.now(timezone.utc).isoformat(),
            size=len(content),
            content_hash=hashlib.sha256(content).hexdigest(),
        )
        index = self._load_index()
        index[material_id] = {
            "filename": record.filename,
            "uploaded_at": record.uploaded_at,
            "size": record.size,
            "content_hash": record.content_hash,
        }
        self._save_index(index)
        return record

    def list_all(self) -> list[MaterialRecord]:
        index = self._load_index()
        out = []
        # Materials saved before content_hash existed have no hash on file —
        # backfilled here (once) rather than in a separate migration script,
        # since list_all() already reads every entry anyway. Persisted back
        # so it's a one-time cost per legacy entry, not recomputed every call.
        changed = False
        for material_id, meta in index.items():
            p = self._resolve(material_id)
            if p is None or not p.exists():
                continue  # stale index entry (file removed out-of-band) — skip rather than 500
            if not meta.get("content_hash"):
                meta["content_hash"] = hashlib.sha256(p.read_bytes()).hexdigest()
                changed = True
            out.append(MaterialRecord(
                id=material_id, filename=meta["filename"], uploaded_at=meta["uploaded_at"],
                size=meta["size"], state=meta.get("state"), content_hash=meta["content_hash"],
            ))
        if changed:
            self._save_index(index)
        out.sort(key=lambda m: m.uploaded_at, reverse=True)
        return out

    def find_by_hash(self, content_hash: str) -> MaterialRecord | None:
        for record in self.list_all():  # backfills legacy hashes as a side effect
            if record.content_hash == content_hash:
                return record
        return None

    def rename(self, material_id: str, filename: str) -> bool:
        index = self._load_index()
        if material_id not in index:
            return False
        index[material_id]["filename"] = filename
        self._save_index(index)
        return True

    def path_for(self, material_id: str) -> Path | None:
        p = self._resolve(material_id)
        return p if p and p.exists() else None

    def delete(self, material_id: str) -> bool:
        p = self._resolve(material_id)
        if not p or not p.exists():
            return False
        p.unlink()
        index = self._load_index()
        index.pop(material_id, None)
        self._save_index(index)
        return True

    def save_state(self, material_id: str, state: dict) -> bool:
        p = self._resolve(material_id)
        if not p or not p.exists():
            return False
        index = self._load_index()
        if material_id not in index:
            return False
        index[material_id]["state"] = state
        self._save_index(index)
        return True

    def load_state(self, material_id: str) -> dict | None:
        entry = self._load_index().get(material_id)
        return entry.get("state") if entry else None
