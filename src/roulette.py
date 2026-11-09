"""Improv roulette — a phrase catalog for "random lick over a 12-bar blues" practice.

Deliberately independent of the Licks store: the catalog is its own JSON file under
data_dir()/roulette/, seeded once from src/roulette_seed.json. Edit/append phrases there
(or tell the agent to) — the page reads it fresh on every load.
"""
import json
import shutil
from pathlib import Path

from fastapi import APIRouter

from src.data_dir import data_dir

router = APIRouter()
_SEED = Path(__file__).parent / "roulette_seed.json"


def _catalog_path() -> Path:
    return data_dir() / "roulette" / "catalog.json"


@router.get("/api/roulette/catalog")
def get_catalog():
    path = _catalog_path()
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(_SEED, path)
    return json.loads(path.read_text(encoding="utf-8"))
