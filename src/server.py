import json
import logging
import re
import shutil
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import httpx
import mido
from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import Optional

import src.prefs as prefs
from src.styles import get_all_styles
from src.player import Player
import src.gen_accompaniment_midi as gen
import src.agent_client as agent_client
from src.materials_store import LocalFlatMaterialsStore

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


class AccompanimentBody(BaseModel):
    """Validated request body for accompaniment create/update and play endpoints."""
    model_config = {"extra": "allow"}

    title: str = "Untitled"
    key: str = "C"
    style: str = "pop"
    bpm: float = Field(default=120.0, ge=20.0, le=300.0)
    loops: int = Field(default=4, ge=1, le=999)
    time_signature: str = "4/4"
    bars: list[BarEntry] = []
    fill_every: int = Field(default=4, ge=1, le=32)
    volume: float = Field(default=1.0, ge=0.0, le=1.0)
    id: Optional[str] = None


class VolumeBody(BaseModel):
    volume: float = Field(ge=0.0, le=1.0)


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


class AgentAskRequest(BaseModel):
    """The floating agent assistant (see web/agent-assistant.js). `context` is
    a JSON snapshot the frontend already computed from whatever page is open
    (for Chord ID: the progression, roman-numeral analysis, cadences, and
    each chord's candidate readings — see fbCidAgentContext) — this endpoint
    only relays it into the prompt, it never re-derives anything music-theory
    related server-side."""
    question: str = Field(min_length=1, max_length=4000)
    backend: Optional[str] = None
    history: list[dict] = []
    context: dict = {}


_player = Player()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    _player.close()


app = FastAPI(lifespan=lifespan)


def _accompaniments_dir() -> Path:
    d = Path(prefs.load()["accompaniments_dir"]).expanduser()
    d.mkdir(parents=True, exist_ok=True)
    return d


def _accompaniment_path(accompaniment_id: str) -> Path:
    base = _accompaniments_dir()
    p = (base / accompaniment_id).resolve()
    if not p.is_relative_to(base.resolve()):
        raise HTTPException(status_code=400, detail="Invalid accompaniment id")
    return p


def _slugify(title: str) -> str:
    s = re.sub(r"[^\w一-鿿-]", "-", title.strip())
    return re.sub(r"-+", "-", s).strip("-") or "accompaniment"


def _read_accompaniment(accompaniment_id: str) -> dict:
    p = _accompaniment_path(accompaniment_id) / "song.json"
    if not p.exists():
        raise HTTPException(status_code=404, detail="Accompaniment not found")
    return json.loads(p.read_text())


def _write_accompaniment(accompaniment_id: str, data: dict) -> None:
    d = _accompaniment_path(accompaniment_id)
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
# those licks gets deleted. Storage itself lives behind MaterialsStore
# (src/materials_store.py) — routes below only see that interface.

MAX_MATERIAL_BYTES = 100 * 1024 * 1024  # 100MB — generous for backing-track audio

def _materials_dir() -> Path:
    return Path(prefs.load()["materials_dir"]).expanduser()

_materials_store = LocalFlatMaterialsStore(_materials_dir)


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


@app.get("/api/accompaniments")
def api_list_accompaniments():
    accompaniments = []
    for d in _accompaniments_dir().iterdir():
        p = d / "song.json"
        if p.exists():
            data = json.loads(p.read_text())
            data["id"] = d.name
            data["generated"] = (d / "accompaniment.mid").exists()
            accompaniments.append(data)
    accompaniments.sort(key=lambda s: s.get("updated_at", ""), reverse=True)
    return accompaniments


@app.get("/api/accompaniments/{accompaniment_id}")
def api_get_accompaniment(accompaniment_id: str):
    data = _read_accompaniment(accompaniment_id)
    data["id"] = accompaniment_id
    data["generated"] = (_accompaniment_path(accompaniment_id) / "accompaniment.mid").exists()
    return data


@app.post("/api/accompaniments")
def api_create_accompaniment(accompaniment: AccompanimentBody):
    data = accompaniment.model_dump(exclude={"id"})
    accompaniment_id = _slugify(data.get("title", "accompaniment"))
    base = accompaniment_id
    i = 1
    while _accompaniment_path(accompaniment_id).exists():
        accompaniment_id = f"{base}-{i}"
        i += 1
    _write_accompaniment(accompaniment_id, data)
    return {**data, "id": accompaniment_id, "generated": False}


@app.put("/api/accompaniments/{accompaniment_id}")
def api_update_accompaniment(accompaniment_id: str, accompaniment: AccompanimentBody):
    _read_accompaniment(accompaniment_id)  # 404 if not found
    data = accompaniment.model_dump(exclude={"id"})
    _write_accompaniment(accompaniment_id, data)
    return {**data, "id": accompaniment_id}


@app.delete("/api/accompaniments/{accompaniment_id}")
def api_delete_accompaniment(accompaniment_id: str):
    p = _accompaniment_path(accompaniment_id)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Accompaniment not found")
    shutil.rmtree(p)
    return {"ok": True}


@app.post("/api/play")
def api_play(accompaniment: AccompanimentBody):
    p = prefs.load()
    soundfont = str(Path(p["soundfont_path"]).expanduser())

    progression = [chord.name for bar in accompaniment.bars for chord in bar.chords]

    if not progression:
        raise HTTPException(status_code=400, detail="No chords in song")

    loops = accompaniment.loops
    bpm = accompaniment.bpm
    style = accompaniment.style
    fill_every = accompaniment.fill_every

    accompaniment_id = accompaniment.id
    if accompaniment_id:
        out_dir = _accompaniment_path(accompaniment_id)
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
    bars_per_loop = len(accompaniment.bars)
    sec_per_bar = 4 * 60 / bpm
    duration_sec = round(bars_per_loop * loops * sec_per_bar, 2)

    session_meta = {
        "duration_sec": duration_sec,
        "loops": loops,
        "bars": bars_per_loop,
        "bpm": bpm,
    }
    logger.info("play: %s bars, bpm=%s, style=%s, loops=%s → %s", len(accompaniment.bars), bpm, style, loops, midi_path)
    _player.set_soundfont(soundfont)
    _player.set_volume(accompaniment.volume)
    _player.play(midi_path, bpm=bpm, session_meta=session_meta)

    if accompaniment_id:
        try:
            data = _read_accompaniment(accompaniment_id)
            _write_accompaniment(accompaniment_id, data)
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
    record = _materials_store.save(file.filename or "file", content)
    return {"id": record.id, "filename": record.filename, "url": f"/api/materials/{record.id}"}


@app.get("/api/materials")
def api_list_materials():
    return [
        {"id": r.id, "url": f"/api/materials/{r.id}", "filename": r.filename,
         "uploaded_at": r.uploaded_at, "size": r.size, "state": r.state,
         "content_hash": r.content_hash}
        for r in _materials_store.list_all()
    ]


# Registered before /{material_id} below only for readability, not routing
# correctness — FastAPI matches by segment count, and "by-hash/<hash>" is two
# segments vs one, so there's no ambiguity either way. Lets the upload flow
# check "does this content already exist?" *before* spending the bandwidth to
# actually upload a duplicate — see materialUploadAndInsert (licks.js) /
# registerAsLibraryMaterial (song-loop.js) for the client-side hash + confirm.
@app.get("/api/materials/by-hash/{content_hash}")
def api_material_by_hash(content_hash: str):
    record = _materials_store.find_by_hash(content_hash)
    if record is None:
        raise HTTPException(status_code=404, detail="No matching material")
    return {"id": record.id, "url": f"/api/materials/{record.id}", "filename": record.filename,
             "uploaded_at": record.uploaded_at, "size": record.size}


@app.get("/api/materials/{material_id}")
def api_get_material(material_id: str):
    p = _materials_store.path_for(material_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Material not found")
    # A material's id/url never changes even when its content is overwritten
    # in place (see update_content — the PDF annotate-and-save flow relies on
    # this). Without Cache-Control, browsers apply heuristic freshness and
    # can keep serving an old cached response for hours/days without ever
    # even asking the server — so a successful save can look "lost" after
    # refresh even though the file on disk is already correct. `no-cache`
    # forces the browser to hit the network on every load instead of trusting
    # a stale local copy (Starlette's FileResponse here doesn't implement
    # conditional-GET/304, so this always re-sends the full body — a bit more
    # bandwidth, but that's a minor cost next to silently showing stale data).
    return FileResponse(p, headers={"Cache-Control": "no-cache"})


# Overwrites a material's bytes in place (same id/url) — used by the Lick PDF
# viewer's annotate-and-save flow (web/vendor/pdfjs/save-hook.js) to bake
# drawn annotations into the PDF and write it straight back, without
# re-uploading or touching any link that already points at this material.
@app.put("/api/materials/{material_id}/content")
async def api_update_material_content(material_id: str, file: UploadFile = File(...)):
    content = await file.read()
    if len(content) > MAX_MATERIAL_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 100MB)")
    if not _materials_store.update_content(material_id, content):
        raise HTTPException(status_code=404, detail="Material not found")
    return {"ok": True}


@app.delete("/api/materials/{material_id}")
def api_delete_material(material_id: str):
    if not _materials_store.delete(material_id):
        raise HTTPException(status_code=404, detail="Material not found")
    return {"ok": True}


class MaterialRenameBody(BaseModel):
    filename: str = Field(min_length=1)


@app.put("/api/materials/{material_id}/filename")
def api_rename_material(material_id: str, body: MaterialRenameBody):
    name = body.filename.strip()
    if not name:
        raise HTTPException(status_code=400, detail="文件名不能为空")
    if not _materials_store.rename(material_id, name):
        raise HTTPException(status_code=404, detail="Material not found")
    return {"ok": True}


@app.get("/api/materials/{material_id}/state")
def api_get_material_state(material_id: str):
    if _materials_store.path_for(material_id) is None:
        raise HTTPException(status_code=404, detail="Material not found")
    return _materials_store.load_state(material_id) or {}


@app.put("/api/materials/{material_id}/state")
def api_put_material_state(material_id: str, state: dict):
    if not _materials_store.save_state(material_id, state):
        raise HTTPException(status_code=404, detail="Material not found")
    return {"ok": True}


# Unofficial NetEase Cloud Music lyric endpoint — widely used by open-source
# lyric tools, no auth needed for most (non-VIP-only) tracks. Proxied
# server-side because the browser can't call it directly (no CORS headers),
# and so the server can attach the Referer NetEase's API expects.
@app.get("/api/netease-lyric")
def api_netease_lyric(song_id: str):
    if not re.fullmatch(r"\d+", song_id):
        raise HTTPException(status_code=400, detail="song_id 必须是数字")
    try:
        resp = httpx.get(
            "https://music.163.com/api/song/lyric",
            params={"id": song_id, "lv": 1, "kv": 1, "tv": -1},
            headers={"Referer": "https://music.163.com", "User-Agent": "Mozilla/5.0"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        logger.warning("netease lyric fetch failed for id=%s: %s", song_id, e)
        raise HTTPException(status_code=502, detail="拉取歌词失败（网络问题，或网易接口变更）")
    lrc = (data.get("lrc") or {}).get("lyric", "")
    if not lrc:
        raise HTTPException(status_code=404, detail="没有找到这首歌的时间轴歌词（可能是纯音乐或没有 LRC）")
    return {"lrc": lrc}


@app.post("/api/bpm")
def api_set_bpm(body: dict):
    bpm = float(body.get("bpm", 120))
    _player.set_bpm(bpm)
    return {"bpm": bpm}


@app.put("/api/volume")
def api_set_volume(body: VolumeBody):
    _player.set_volume(body.volume)
    return {"volume": body.volume}


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


# ── Floating agent assistant (web/agent-assistant.js) ──
# Thin relay over src/agent_client.py's local-CLI backends (kc/mc/claude,
# see ~/.config/agent-backends.yaml) — this file assembles no context itself,
# the frontend already did (see AgentAskRequest.context above).

_AGENT_SYSTEM_PROMPT = """你是嵌入在一个吉他练习网页 app 里的助教，飘在页面右下角随时可以被问到。

规则：
- [页面上下文] 是当前页面已经算好的真实数据（JSON），回答优先基于它，不要假装看到了它没给你的东西；缺什么就说缺什么。
- 在 Chord ID 页面，页面上下文包含当前和声进行每个和弦的罗马数字分析、检测到的终止式、同功能组替代建议，以及每个位置的备选读法（省略了哪些音、是否根音在贝斯）。回答"为什么这个更合理"时具体引用这些依据（省略了根音 vs 省略了别的音、是否落在调内音级、覆盖度高低），不要只讲泛泛乐理。
- 不确定的地方直说不确定，不要编。
- 回答简洁，除非用户明确要求展开讲。
"""


@app.get("/api/agent/backends")
def api_agent_backends():
    return [
        {"name": b.name, "description": b.description, "default": b.default,
         "unavailable_reason": agent_client.check_available(b)}
        for b in agent_client.discover_backends()
    ]


@app.post("/api/agent/ask")
async def api_agent_ask(req: AgentAskRequest, request: Request) -> StreamingResponse:
    backends = agent_client.discover_backends()
    backend = next((b for b in backends if b.name == req.backend), None) if req.backend else None

    prompt = ""
    if req.context:
        prompt += "[页面上下文]\n" + json.dumps(req.context, ensure_ascii=False, default=str)[:16000] + "\n\n"
    for msg in req.history[-8:]:
        role = "用户" if msg.get("role") == "user" else "助教"
        content = str(msg.get("content", ""))[:2000]
        prompt += f"[{role}]\n{content}\n\n"
    prompt += f"[用户问题]\n{req.question}"

    async def stream():
        try:
            async for kind, text in agent_client.stream_parts(
                prompt=prompt, system_prompt=_AGENT_SYSTEM_PROMPT, backend=backend,
            ):
                event_type = "thinking" if kind == "thinking" else "delta"
                yield f"data: {json.dumps({'type': event_type, 'text': text}, ensure_ascii=False)}\n\n"
                if await request.is_disconnected():
                    break
            yield 'data: {"type": "done"}\n\n'
        except Exception as e:
            logger.warning("agent ask failed: %s: %s", type(e).__name__, e)
            yield f"data: {json.dumps({'type': 'error', 'message': f'{type(e).__name__}: {e}'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")


# Serve frontend static files
#
# StaticFiles sends no Cache-Control header by default, so once a browser has
# cached a response it can (per RFC 7234's heuristic freshness — Last-Modified
# with no explicit Cache-Control/Expires) skip revalidation entirely on a
# later request, silently serving stale JS/CSS after an edit even on a hard
# reload. Never confirmed as anything but a dev-loop nuisance until it cost
# real time chasing a "fix" that had already landed on disk — no-cache (not
# no-store) keeps the ETag/If-None-Match 304 path for cheap repeat loads,
# it just forces every request to actually ask the server first.
class _NoCacheStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


_web_dir = Path(__file__).parent.parent / "web"
if _web_dir.exists():
    app.mount("/", _NoCacheStaticFiles(directory=str(_web_dir), html=True), name="static")
