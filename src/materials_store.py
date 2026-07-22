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
import json
import re


@dataclass
class MaterialRecord:
    id: str
    filename: str
    uploaded_at: str
    size: int
    state: dict | None = None  # opaque, caller-owned JSON blob (e.g. Song Loop's practice settings)


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
        self._index_path().write_text(json.dumps(index, ensure_ascii=False, indent=2))

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
        )
        index = self._load_index()
        index[material_id] = {
            "filename": record.filename,
            "uploaded_at": record.uploaded_at,
            "size": record.size,
        }
        self._save_index(index)
        return record

    def list_all(self) -> list[MaterialRecord]:
        index = self._load_index()
        out = []
        for material_id, meta in index.items():
            p = self._resolve(material_id)
            if p is None or not p.exists():
                continue  # stale index entry (file removed out-of-band) — skip rather than 500
            out.append(MaterialRecord(
                id=material_id, filename=meta["filename"], uploaded_at=meta["uploaded_at"],
                size=meta["size"], state=meta.get("state"),
            ))
        out.sort(key=lambda m: m.uploaded_at, reverse=True)
        return out

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
