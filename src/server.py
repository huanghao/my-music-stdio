import json
import logging
import re
import shutil
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import mido
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import Optional

import src.prefs as prefs
from src.styles import get_all_styles
from src.player import Player
import src.gen_accompaniment_midi as gen

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


# ── Request models ──

class ChordEntry(BaseModel):
    name: str
    beats: Optional[int] = None


class BarEntry(BaseModel):
    chords: list[ChordEntry] = []


class SongBody(BaseModel):
    """Validated request body for song create/update and play endpoints."""
    model_config = {"extra": "allow"}

    title: str = "Untitled"
    key: str = "C"
    style: str = "pop"
    bpm: float = Field(default=120.0, ge=20.0, le=300.0)
    loops: int = Field(default=4, ge=1, le=999)
    time_signature: str = "4/4"
    bars: list[BarEntry] = []
    fill_every: int = Field(default=4, ge=1, le=32)
    id: Optional[str] = None


_player = Player()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    _player.close()


app = FastAPI(lifespan=lifespan)


def _songs_dir() -> Path:
    d = Path(prefs.load()["songs_dir"]).expanduser()
    d.mkdir(parents=True, exist_ok=True)
    return d


def _song_path(song_id: str) -> Path:
    base = _songs_dir()
    p = (base / song_id).resolve()
    if not p.is_relative_to(base.resolve()):
        raise HTTPException(status_code=400, detail="Invalid song id")
    return p


def _slugify(title: str) -> str:
    s = re.sub(r"[^\w一-鿿-]", "-", title.strip())
    return re.sub(r"-+", "-", s).strip("-") or "song"


def _read_song(song_id: str) -> dict:
    p = _song_path(song_id) / "song.json"
    if not p.exists():
        raise HTTPException(status_code=404, detail="Song not found")
    return json.loads(p.read_text())


def _write_song(song_id: str, data: dict) -> None:
    d = _song_path(song_id)
    d.mkdir(parents=True, exist_ok=True)
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    (d / "song.json").write_text(json.dumps(data, ensure_ascii=False, indent=2))


# ── API ──

@app.get("/api/styles")
def api_styles():
    return get_all_styles()


@app.get("/api/prefs")
def api_get_prefs():
    return prefs.load()


@app.put("/api/prefs")
def api_put_prefs(updates: dict):
    return prefs.save(updates)


@app.get("/api/songs")
def api_list_songs():
    songs = []
    for d in _songs_dir().iterdir():
        p = d / "song.json"
        if p.exists():
            data = json.loads(p.read_text())
            data["id"] = d.name
            data["generated"] = (d / "accompaniment.mid").exists()
            songs.append(data)
    songs.sort(key=lambda s: s.get("updated_at", ""), reverse=True)
    return songs


@app.get("/api/songs/{song_id}")
def api_get_song(song_id: str):
    data = _read_song(song_id)
    data["id"] = song_id
    data["generated"] = (_song_path(song_id) / "accompaniment.mid").exists()
    return data


@app.post("/api/songs")
def api_create_song(song: SongBody):
    data = song.model_dump(exclude={"id"})
    song_id = _slugify(data.get("title", "song"))
    base = song_id
    i = 1
    while _song_path(song_id).exists():
        song_id = f"{base}-{i}"
        i += 1
    _write_song(song_id, data)
    return {**data, "id": song_id, "generated": False}


@app.put("/api/songs/{song_id}")
def api_update_song(song_id: str, song: SongBody):
    _read_song(song_id)  # 404 if not found
    data = song.model_dump(exclude={"id"})
    _write_song(song_id, data)
    return {**data, "id": song_id}


@app.delete("/api/songs/{song_id}")
def api_delete_song(song_id: str):
    p = _song_path(song_id)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Song not found")
    shutil.rmtree(p)
    return {"ok": True}


@app.post("/api/play")
def api_play(song: SongBody):
    p = prefs.load()
    soundfont = str(Path(p["soundfont_path"]).expanduser())

    progression = [chord.name for bar in song.bars for chord in bar.chords]

    if not progression:
        raise HTTPException(status_code=400, detail="No chords in song")

    loops = song.loops
    bpm = song.bpm
    style = song.style
    fill_every = song.fill_every

    song_id = song.id
    if song_id:
        out_dir = _song_path(song_id)
        out_dir.mkdir(parents=True, exist_ok=True)
        midi_path = str(out_dir / "accompaniment.mid")
    else:
        tmp_dir = Path(__file__).parent.parent / "tmp"
        tmp_dir.mkdir(exist_ok=True)
        midi_path = str(tmp_dir / "jam_accompaniment.mid")

    mid = mido.MidiFile(type=0, ticks_per_beat=gen.PPQ)
    mid.tracks.append(
        gen.build_track(progression, bpm, style, fill_every=fill_every, loops=loops)
    )
    mid.save(midi_path)

    # compute total duration
    bars_per_loop = len(song.bars)
    sec_per_bar = 4 * 60 / bpm
    duration_sec = round(bars_per_loop * loops * sec_per_bar, 2)

    session_meta = {
        "duration_sec": duration_sec,
        "loops": loops,
        "bars": bars_per_loop,
        "bpm": bpm,
    }
    logger.info("play: %s bars, bpm=%s, style=%s, loops=%s → %s", len(song.get("bars", [])), bpm, style, loops, midi_path)
    _player.set_soundfont(soundfont)
    _player.play(midi_path, bpm=bpm, session_meta=session_meta)

    if song_id:
        try:
            data = _read_song(song_id)
            _write_song(song_id, data)
        except HTTPException:
            pass

    return {"playing": True, "file": midi_path, "duration_sec": duration_sec, "loops": loops}


@app.post("/api/bpm")
def api_set_bpm(body: dict):
    bpm = float(body.get("bpm", 120))
    _player.set_bpm(bpm)
    return {"bpm": bpm}


@app.post("/api/stop")
def api_stop():
    logger.info("stop")
    _player.stop()
    return {"playing": False}


@app.post("/api/pause")
def api_pause():
    logger.info("pause")
    _player.pause()
    return _player.status()


@app.post("/api/resume")
def api_resume():
    logger.info("resume")
    _player.resume()
    return _player.status()


@app.get("/api/status")
def api_status():
    return _player.status()


@app.get("/api/soundfonts")
def api_soundfonts():
    """List .sf2/.sf3 files in the configured soundfonts directory."""
    p = prefs.load()
    sf_dir = Path(p["soundfont_path"]).expanduser().parent
    if not sf_dir.exists():
        return []
    files = sorted(
        str(f) for f in sf_dir.iterdir()
        if f.suffix.lower() in {".sf2", ".sf3"}
    )
    return files


# Serve frontend static files
_web_dir = Path(__file__).parent.parent / "web"
if _web_dir.exists():
    app.mount("/", StaticFiles(directory=str(_web_dir), html=True), name="static")
