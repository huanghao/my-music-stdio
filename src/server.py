import json
import logging
import re
import shutil
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import mido
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
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


class LickSession(BaseModel):
    bpm: float = Field(ge=20.0, le=300.0)
    duration_min: float = Field(ge=0.5, le=180.0)

class LickBody(BaseModel):
    title: str = "Untitled"
    notes: str = ""
    target_bpm: Optional[float] = Field(default=None, ge=20.0, le=300.0)

class LickBpmUpdate(BaseModel):
    bpm: float = Field(ge=20.0, le=300.0)

class LickMetronomeLinkUpdate(BaseModel):
    linked: bool


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


def _licks_dir() -> Path:
    d = Path(prefs.load()["licks_dir"]).expanduser()
    d.mkdir(parents=True, exist_ok=True)
    return d

def _lick_path(lick_id: str) -> Path:
    base = _licks_dir()
    p = (base / lick_id).resolve()
    if not p.is_relative_to(base.resolve()):
        raise HTTPException(status_code=400, detail="Invalid lick id")
    return p

def _read_lick(lick_id: str) -> dict:
    p = _lick_path(lick_id) / "lick.json"
    if not p.exists():
        raise HTTPException(status_code=404, detail="Lick not found")
    return json.loads(p.read_text())

MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024  # 20MB — generous for a sheet-music photo

def _attachment_filename(name: str) -> str:
    """Sanitize an uploaded filename: keep only the basename (strips any
    directory components an attacker could use for path traversal), restrict
    to a safe charset, and prefix a timestamp so repeat uploads never collide."""
    base = re.sub(r"[^\w.\-]", "_", Path(name).name) or "file"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    return f"{stamp}_{base}"

def _attachments_dir(lick_id: str) -> Path:
    d = _lick_path(lick_id) / "attachments"
    d.mkdir(parents=True, exist_ok=True)
    return d

def _attachment_path(lick_id: str, filename: str) -> Path:
    base = _attachments_dir(lick_id)
    p = (base / filename).resolve()
    if not p.is_relative_to(base.resolve()):
        raise HTTPException(status_code=400, detail="Invalid attachment filename")
    return p

def _write_lick(lick_id: str, data: dict) -> None:
    d = _lick_path(lick_id)
    d.mkdir(parents=True, exist_ok=True)
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    (d / "lick.json").write_text(json.dumps(data, ensure_ascii=False, indent=2))


# ── Materials library ──
# Shared reference material (score PDFs, backing tracks) that multiple licks
# link to from their notes — unlike a lick's own /attachments, these aren't
# owned by any single lick, so uploading once and reusing the URL across
# several licks doesn't duplicate storage and doesn't break when one of
# those licks gets deleted.

MAX_MATERIAL_BYTES = 100 * 1024 * 1024  # 100MB — generous for backing-track audio

def _materials_dir() -> Path:
    d = Path(prefs.load()["materials_dir"]).expanduser()
    d.mkdir(parents=True, exist_ok=True)
    return d

def _materials_index_path() -> Path:
    return _materials_dir() / "_index.json"

def _materials_index_load() -> dict:
    p = _materials_index_path()
    if not p.exists():
        return {}
    return json.loads(p.read_text())

def _materials_index_save(index: dict) -> None:
    _materials_index_path().write_text(json.dumps(index, ensure_ascii=False, indent=2))

def _material_path(material_id: str) -> Path:
    base = _materials_dir()
    p = (base / material_id).resolve()
    if not p.is_relative_to(base.resolve()):
        raise HTTPException(status_code=400, detail="Invalid material id")
    return p


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


@app.get("/api/licks")
def api_list_licks():
    licks = []
    for d in _licks_dir().iterdir():
        p = d / "lick.json"
        if p.exists():
            data = json.loads(p.read_text())
            data["id"] = d.name
            # Summary: omit sessions array, add computed fields
            sessions = data.pop("sessions", [])
            data["session_count"] = len(sessions)
            data["last_bpm"] = sessions[-1]["bpm"] if sessions else None
            data["last_date"] = sessions[-1]["date"] if sessions else None
            licks.append(data)
    licks.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
    return licks


@app.get("/api/licks/sessions/all")
def api_list_all_lick_sessions():
    """Flat list of every session across every lick, for the practice heatmap.

    Returns [{date, bpm, duration_min, lick_id, lick_title}, ...] sorted by date
    ascending.  The list endpoint omits sessions, so this is the cheap way to
    get all of them in one request without N round-trips.
    """
    out = []
    for d in _licks_dir().iterdir():
        p = d / "lick.json"
        if not p.exists():
            continue
        data = json.loads(p.read_text())
        title = data.get("title", d.name)
        for s in data.get("sessions", []):
            out.append({
                "date": s["date"],
                "bpm": s["bpm"],
                "duration_min": s["duration_min"],
                "lick_id": d.name,
                "lick_title": title,
            })
    out.sort(key=lambda x: x["date"])
    return out


@app.post("/api/licks")
def api_create_lick(lick: LickBody):
    data = lick.model_dump()
    data["sessions"] = []
    data["created_at"] = datetime.now(timezone.utc).isoformat()
    lick_id = _slugify(data.get("title", "lick"))
    base = lick_id
    i = 1
    while _lick_path(lick_id).exists():
        lick_id = f"{base}-{i}"
        i += 1
    _write_lick(lick_id, data)
    return {**data, "id": lick_id}


@app.get("/api/licks/{lick_id}")
def api_get_lick(lick_id: str):
    data = _read_lick(lick_id)
    data["id"] = lick_id
    return data


@app.put("/api/licks/{lick_id}")
def api_update_lick(lick_id: str, lick: LickBody):
    data = _read_lick(lick_id)
    data.update(lick.model_dump())
    _write_lick(lick_id, data)
    return {**data, "id": lick_id}


@app.delete("/api/licks/{lick_id}")
def api_delete_lick(lick_id: str):
    p = _lick_path(lick_id)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Lick not found")
    shutil.rmtree(p)
    return {"ok": True}


@app.post("/api/licks/{lick_id}/sessions")
def api_add_lick_session(lick_id: str, session: LickSession):
    data = _read_lick(lick_id)
    data.setdefault("sessions", []).append({
        "date": datetime.now(timezone.utc).isoformat(),
        "bpm": session.bpm,
        "duration_min": session.duration_min,
    })
    _write_lick(lick_id, data)
    return {**data, "id": lick_id}


@app.post("/api/licks/{lick_id}/bpm")
def api_update_lick_bpm(lick_id: str, body: LickBpmUpdate):
    """Auto-save hook: called (debounced) whenever the Speed Trainer's tempo
    changes while a lick is being actively practiced, so live progress isn't
    lost if the user never explicitly logs a session (see licksNotifyBpmChange
    in licks.js). Deliberately separate from the PUT endpoint above — that one
    round-trips the full title/notes/target_bpm form, which would clobber a
    concurrent edit if it fired on every tempo tick.
    """
    data = _read_lick(lick_id)
    data["last_practiced_bpm"] = body.bpm
    _write_lick(lick_id, data)
    return {**data, "id": lick_id}


@app.post("/api/licks/{lick_id}/metronome_linked")
def api_update_lick_metronome_linked(lick_id: str, body: LickMetronomeLinkUpdate):
    """Whether this lick's practice timer is linked to the metronome's
    Play/Stop (see ptToggleLinked/licksNotifyLinkedChange in
    practice-timer.js/licks.js) is a trait of the lick itself — some licks
    are metronome-paired practice, some aren't — not a single app-wide
    setting. Separate endpoint for the same reason as /bpm above: this
    fires on every toggle click, and shouldn't round-trip (or risk
    clobbering) the full title/notes/target_bpm form.
    """
    data = _read_lick(lick_id)
    data["metronome_linked"] = body.linked
    _write_lick(lick_id, data)
    return {**data, "id": lick_id}


@app.post("/api/licks/{lick_id}/attachments")
async def api_upload_lick_attachment(lick_id: str, file: UploadFile = File(...)):
    _read_lick(lick_id)  # 404s if the lick doesn't exist
    content = await file.read()
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 20MB)")
    filename = _attachment_filename(file.filename or "image")
    _attachment_path(lick_id, filename).write_bytes(content)
    return {"url": f"/api/licks/{lick_id}/attachments/{filename}"}


@app.get("/api/licks/{lick_id}/attachments/{filename}")
def api_get_lick_attachment(lick_id: str, filename: str):
    p = _attachment_path(lick_id, filename)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Attachment not found")
    return FileResponse(p)


@app.post("/api/materials")
async def api_upload_material(file: UploadFile = File(...)):
    content = await file.read()
    if len(content) > MAX_MATERIAL_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 100MB)")
    material_id = _attachment_filename(file.filename or "file")
    _material_path(material_id).write_bytes(content)
    index = _materials_index_load()
    index[material_id] = {
        "filename": file.filename or material_id,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "size": len(content),
    }
    _materials_index_save(index)
    return {"id": material_id, "filename": index[material_id]["filename"], "url": f"/api/materials/{material_id}"}


@app.get("/api/materials")
def api_list_materials():
    index = _materials_index_load()
    out = []
    for material_id, meta in index.items():
        if not _material_path(material_id).exists():
            continue  # stale index entry (file removed out-of-band) — skip rather than 500
        out.append({"id": material_id, "url": f"/api/materials/{material_id}", **meta})
    out.sort(key=lambda m: m["uploaded_at"], reverse=True)
    return out


@app.get("/api/materials/{material_id}")
def api_get_material(material_id: str):
    p = _material_path(material_id)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Material not found")
    return FileResponse(p)


@app.delete("/api/materials/{material_id}")
def api_delete_material(material_id: str):
    p = _material_path(material_id)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Material not found")
    p.unlink()
    index = _materials_index_load()
    index.pop(material_id, None)
    _materials_index_save(index)
    return {"ok": True}


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
