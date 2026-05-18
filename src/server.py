import json
import re
import shutil
import time as _time
from datetime import datetime, timezone
from pathlib import Path

import mido
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

import src.prefs as prefs
from src.styles import get_all_styles
from src.player import Player
import src.gen_accompaniment_midi as gen

app = FastAPI()
_player = Player()
_play_meta: dict = {}  # stores duration_sec and loops for the current play session


def _songs_dir() -> Path:
    d = Path(prefs.load()["songs_dir"]).expanduser()
    d.mkdir(parents=True, exist_ok=True)
    return d


def _song_path(song_id: str) -> Path:
    return _songs_dir() / song_id


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
def api_create_song(song: dict):
    song_id = _slugify(song.get("title", "song"))
    base = song_id
    i = 1
    while _song_path(song_id).exists():
        song_id = f"{base}-{i}"
        i += 1
    _write_song(song_id, song)
    return {**song, "id": song_id, "generated": False}


@app.put("/api/songs/{song_id}")
def api_update_song(song_id: str, song: dict):
    _read_song(song_id)  # 404 if not found
    _write_song(song_id, song)
    return {**song, "id": song_id}


@app.delete("/api/songs/{song_id}")
def api_delete_song(song_id: str):
    p = _song_path(song_id)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Song not found")
    shutil.rmtree(p)
    return {"ok": True}


@app.post("/api/play")
def api_play(song: dict):
    p = prefs.load()
    soundfont = str(Path(p["soundfont_path"]).expanduser())

    progression = []
    for bar in song.get("bars", []):
        for chord in bar.get("chords", []):
            progression.append(chord["name"])

    if not progression:
        raise HTTPException(status_code=400, detail="No chords in song")

    loops = song.get("loops", 4)
    bpm = song.get("bpm", 120)
    style = song.get("style", "pop")
    fill_every = int(song.get("fill_every", 4))

    song_id = song.get("id")
    if song_id:
        out_dir = _song_path(song_id)
        out_dir.mkdir(parents=True, exist_ok=True)
        midi_path = str(out_dir / "accompaniment.mid")
    else:
        tmp_dir = Path("/tmp/my-music-stdio")
        tmp_dir.mkdir(exist_ok=True)
        midi_path = str(tmp_dir / "jam_accompaniment.mid")

    original_repeats = gen.REPEATS
    gen.REPEATS = loops
    mid = mido.MidiFile(type=0, ticks_per_beat=gen.PPQ)
    mid.tracks.append(gen.build_track(progression, bpm, style, fill_every=fill_every))
    mid.save(midi_path)
    gen.REPEATS = original_repeats

    # compute total duration
    bars_per_loop = len(song.get("bars", []))
    sec_per_bar = 4 * 60 / bpm
    duration_sec = round(bars_per_loop * loops * sec_per_bar, 2)

    _player.set_soundfont(soundfont)
    _play_meta.clear()
    _play_meta.update({
        "duration_sec": duration_sec,
        "loops": loops,
        "bars": bars_per_loop,
        "bpm": bpm,
    })
    _player.play(midi_path)

    if song_id:
        try:
            data = _read_song(song_id)
            _write_song(song_id, data)
        except HTTPException:
            pass

    return {"playing": True, "file": midi_path, "duration_sec": duration_sec, "loops": loops}


@app.post("/api/stop")
def api_stop():
    _player.stop()
    return {"playing": False}


@app.post("/api/pause")
def api_pause():
    _player.pause()
    return _player.status()


@app.post("/api/resume")
def api_resume():
    _player.resume()
    return _player.status()


@app.get("/api/status")
def api_status():
    s = _player.status()
    if s["playing"] and _play_meta:
        elapsed = s.get("elapsed_sec")  # from first note, set by player
        duration = _play_meta["duration_sec"]
        s["duration_sec"] = duration
        s["loops"] = _play_meta["loops"]
        s["bars"] = _play_meta["bars"]
        s["bpm"] = _play_meta["bpm"]
        if elapsed is not None:
            sec_per_loop = duration / _play_meta["loops"] if _play_meta["loops"] else duration
            s["current_loop"] = min(int(elapsed / sec_per_loop) + 1, _play_meta["loops"]) if sec_per_loop > 0 else 1
        else:
            s["current_loop"] = 1
    return s


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
