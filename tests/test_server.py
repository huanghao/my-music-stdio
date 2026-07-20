import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    (tmp_path / "songs").mkdir()
    from importlib import reload
    import src.prefs as prefs
    reload(prefs)
    prefs.save({
        "bars_per_row": 4,
        "soundfont_path": "/tmp/test.sf3",
        "songs_dir": str(tmp_path / "songs"),
    })
    # reload server to pick up new prefs
    import src.server as server
    reload(server)
    return TestClient(server.app)


def test_get_styles(client):
    r = client.get("/api/styles")
    assert r.status_code == 200
    data = r.json()
    assert len(data) >= 9
    assert data[0]["id"] == "pop"


def test_get_prefs(client):
    r = client.get("/api/prefs")
    assert r.status_code == 200
    assert "bars_per_row" in r.json()


def test_put_prefs(client):
    r = client.put("/api/prefs", json={"bars_per_row": 8})
    assert r.status_code == 200
    assert r.json()["bars_per_row"] == 8


def test_get_songs_empty(client):
    r = client.get("/api/songs")
    assert r.status_code == 200
    assert r.json() == []


def test_create_and_get_song(client):
    song = {
        "title": "Test Song",
        "key": "C", "bpm": 120, "style": "pop",
        "time_signature": "4/4", "loops": 4,
        "bars": [{"chords": [{"name": "C", "beats": 4}]}],
    }
    r = client.post("/api/songs", json=song)
    assert r.status_code == 200
    song_id = r.json()["id"]

    r = client.get(f"/api/songs/{song_id}")
    assert r.status_code == 200
    assert r.json()["title"] == "Test Song"


def test_update_song(client):
    song = {"title": "A", "key": "C", "bpm": 120, "style": "pop",
            "time_signature": "4/4", "loops": 4, "bars": []}
    song_id = client.post("/api/songs", json=song).json()["id"]

    r = client.put(f"/api/songs/{song_id}", json={**song, "title": "B"})
    assert r.status_code == 200

    r = client.get(f"/api/songs/{song_id}")
    assert r.json()["title"] == "B"


def test_delete_song(client):
    song = {"title": "Del", "key": "C", "bpm": 120, "style": "pop",
            "time_signature": "4/4", "loops": 4, "bars": []}
    song_id = client.post("/api/songs", json=song).json()["id"]
    r = client.delete(f"/api/songs/{song_id}")
    assert r.status_code == 200
    r = client.get(f"/api/songs/{song_id}")
    assert r.status_code == 404


def test_song_id_path_traversal_is_rejected(client, tmp_path):
    # httpx/browsers normalize a literal ".." out of the URL before sending it,
    # so use percent-encoding to exercise the raw path the server actually sees.
    r = client.delete("/api/songs/%2e%2e")
    assert r.status_code == 400
    assert (tmp_path / "songs").exists()  # would be gone if the parent got rmtree'd

    r = client.get("/api/songs/%2e%2e")
    assert r.status_code == 400

    r = client.put("/api/songs/%2e%2e", json={"title": "x"})
    assert r.status_code == 400


def test_get_status(client):
    r = client.get("/api/status")
    assert r.status_code == 200
    assert r.json()["playing"] is False


# ── Pydantic validation ────────────────────────────────────────────────────

def test_bpm_out_of_range_rejected(client):
    """BPM outside [20, 300] → HTTP 422 Unprocessable Entity."""
    base = {"title": "T", "key": "C", "style": "pop",
            "time_signature": "4/4", "loops": 4,
            "bars": [{"chords": [{"name": "C", "beats": 4}]}]}
    assert client.post("/api/songs", json={**base, "bpm": 5}).status_code == 422
    assert client.post("/api/songs", json={**base, "bpm": 400}).status_code == 422
    # Boundary values must be accepted
    assert client.post("/api/songs", json={**base, "bpm": 20}).status_code == 200
    assert client.post("/api/songs", json={**base, "bpm": 300}).status_code == 200


def test_loops_out_of_range_rejected(client):
    """Loops outside [1, 999] → HTTP 422."""
    base = {"title": "T", "key": "C", "style": "pop", "bpm": 120,
            "time_signature": "4/4", "bars": []}
    assert client.post("/api/songs", json={**base, "loops": 0}).status_code == 422
    assert client.post("/api/songs", json={**base, "loops": 1000}).status_code == 422
    assert client.post("/api/songs", json={**base, "loops": 1}).status_code == 200
    assert client.post("/api/songs", json={**base, "loops": 999}).status_code == 200


def test_play_empty_bars_returns_400(client):
    """POSTing /api/play with no chords should return 400."""
    r = client.post("/api/play", json={
        "bars": [], "bpm": 120, "style": "pop", "loops": 4,
    })
    assert r.status_code == 400
    assert "No chords" in r.json()["detail"]


def test_play_bpm_validated(client):
    """POST /api/play also validates bpm through SongBody."""
    r = client.post("/api/play", json={
        "bars": [{"chords": [{"name": "C"}]}],
        "bpm": 5, "style": "pop", "loops": 2,
    })
    assert r.status_code == 422


# ── Lick API ──────────────────────────────────────────────────────────────

def test_create_and_list_lick(client):
    r = client.post("/api/licks", json={"title": "Test Lick", "notes": "hi", "target_bpm": 120})
    assert r.status_code == 200
    lick_id = r.json()["id"]

    r = client.get("/api/licks")
    assert r.status_code == 200
    ids = [l["id"] for l in r.json()]
    assert lick_id in ids


def test_get_lick(client):
    lick_id = client.post("/api/licks", json={"title": "Get Me"}).json()["id"]
    r = client.get(f"/api/licks/{lick_id}")
    assert r.status_code == 200
    assert r.json()["title"] == "Get Me"
    assert r.json()["sessions"] == []


def test_update_lick(client):
    lick_id = client.post("/api/licks", json={"title": "Old"}).json()["id"]
    r = client.put(f"/api/licks/{lick_id}", json={"title": "New", "notes": "", "target_bpm": None})
    assert r.status_code == 200
    assert client.get(f"/api/licks/{lick_id}").json()["title"] == "New"


def test_delete_lick(client):
    lick_id = client.post("/api/licks", json={"title": "Del"}).json()["id"]
    assert client.delete(f"/api/licks/{lick_id}").status_code == 200
    assert client.get(f"/api/licks/{lick_id}").status_code == 404


def test_add_lick_session(client):
    lick_id = client.post("/api/licks", json={"title": "Practice"}).json()["id"]
    r = client.post(f"/api/licks/{lick_id}/sessions", json={"bpm": 90, "duration_min": 5})
    assert r.status_code == 200
    sessions = r.json()["sessions"]
    assert len(sessions) == 1
    assert sessions[0]["bpm"] == 90


def test_lick_session_bpm_validated(client):
    lick_id = client.post("/api/licks", json={"title": "V"}).json()["id"]
    assert client.post(f"/api/licks/{lick_id}/sessions",
                       json={"bpm": 5, "duration_min": 5}).status_code == 422


def test_list_all_lick_sessions(client):
    """The flat /api/licks/sessions/all endpoint feeds the practice heatmap."""
    a = client.post("/api/licks", json={"title": "A"}).json()["id"]
    b = client.post("/api/licks", json={"title": "B"}).json()["id"]
    client.post(f"/api/licks/{a}/sessions", json={"bpm": 80, "duration_min": 5})
    client.post(f"/api/licks/{a}/sessions", json={"bpm": 90, "duration_min": 8})
    client.post(f"/api/licks/{b}/sessions", json={"bpm": 120, "duration_min": 3})

    r = client.get("/api/licks/sessions/all")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 3
    # sorted ascending by date
    assert rows == sorted(rows, key=lambda x: x["date"])
    # each row carries the lick context for tooltips
    titles = {row["lick_title"] for row in rows}
    assert titles == {"A", "B"}


def test_lick_id_path_traversal_rejected(client):
    assert client.get("/api/licks/%2e%2e").status_code == 400
    assert client.delete("/api/licks/%2e%2e").status_code == 400


def test_update_lick_bpm_saves_live_practice_tempo_separately_from_sessions(client):
    """The /bpm endpoint is the auto-save hook for live tempo changes — it
    must not require (or touch) the session log."""
    lick_id = client.post("/api/licks", json={"title": "Live BPM"}).json()["id"]
    r = client.post(f"/api/licks/{lick_id}/bpm", json={"bpm": 95})
    assert r.status_code == 200
    assert r.json()["last_practiced_bpm"] == 95
    fetched = client.get(f"/api/licks/{lick_id}").json()
    assert fetched["last_practiced_bpm"] == 95
    assert fetched["sessions"] == []  # unaffected


def test_update_lick_bpm_shows_up_in_list_summary(client):
    lick_id = client.post("/api/licks", json={"title": "L"}).json()["id"]
    client.post(f"/api/licks/{lick_id}/bpm", json={"bpm": 88})
    listed = next(l for l in client.get("/api/licks").json() if l["id"] == lick_id)
    assert listed["last_practiced_bpm"] == 88


def test_update_lick_bpm_validated(client):
    lick_id = client.post("/api/licks", json={"title": "V"}).json()["id"]
    assert client.post(f"/api/licks/{lick_id}/bpm", json={"bpm": 5}).status_code == 422


def test_update_lick_metronome_linked_persists_per_lick(client):
    """metronome_linked is a per-lick trait (some licks are metronome-paired,
    some aren't) — not a single global setting, so two licks must be able to
    disagree."""
    a = client.post("/api/licks", json={"title": "A"}).json()["id"]
    b = client.post("/api/licks", json={"title": "B"}).json()["id"]
    r = client.post(f"/api/licks/{a}/metronome_linked", json={"linked": True})
    assert r.status_code == 200
    assert r.json()["metronome_linked"] is True

    assert client.get(f"/api/licks/{a}").json()["metronome_linked"] is True
    # B was never touched — must not have silently inherited A's setting
    assert client.get(f"/api/licks/{b}").json().get("metronome_linked") in (None, False)


def test_update_lick_metronome_linked_does_not_touch_other_fields(client):
    lick_id = client.post("/api/licks", json={"title": "Keep", "notes": "hi", "target_bpm": 100}).json()["id"]
    client.post(f"/api/licks/{lick_id}/metronome_linked", json={"linked": True})
    fetched = client.get(f"/api/licks/{lick_id}").json()
    assert fetched["title"] == "Keep"
    assert fetched["notes"] == "hi"
    assert fetched["target_bpm"] == 100
    assert fetched["metronome_linked"] is True


def test_update_lick_metronome_linked_survives_a_full_edit_save(client):
    """The full PUT (title/notes/target_bpm form) must not silently reset
    metronome_linked back to its default — this is the same clobbering bug
    class that /bpm and /metronome_linked are deliberately separate endpoints
    to avoid."""
    lick_id = client.post("/api/licks", json={"title": "Edit"}).json()["id"]
    client.post(f"/api/licks/{lick_id}/metronome_linked", json={"linked": True})
    client.put(f"/api/licks/{lick_id}", json={"title": "Edit", "notes": "updated", "target_bpm": None})
    assert client.get(f"/api/licks/{lick_id}").json()["metronome_linked"] is True


def test_lick_attachment_upload_and_fetch(client):
    lick_id = client.post("/api/licks", json={"title": "Pic"}).json()["id"]
    r = client.post(
        f"/api/licks/{lick_id}/attachments",
        files={"file": ("chart.png", b"\x89PNG fake bytes", "image/png")},
    )
    assert r.status_code == 200
    url = r.json()["url"]
    assert url.startswith(f"/api/licks/{lick_id}/attachments/")
    assert url.endswith("chart.png")

    r2 = client.get(url)
    assert r2.status_code == 200
    assert r2.content == b"\x89PNG fake bytes"


def test_lick_attachment_sanitizes_path_traversal_in_filename(client):
    lick_id = client.post("/api/licks", json={"title": "Pic"}).json()["id"]
    r = client.post(
        f"/api/licks/{lick_id}/attachments",
        files={"file": ("../../evil.png", b"data", "image/png")},
    )
    assert r.status_code == 200
    url = r.json()["url"]
    assert "/../" not in url
    assert url.endswith("evil.png")  # directory components stripped, basename kept


def test_lick_attachment_fetch_rejects_path_traversal(client):
    lick_id = client.post("/api/licks", json={"title": "Pic"}).json()["id"]
    assert client.get(f"/api/licks/{lick_id}/attachments/..%2f..%2flick.json").status_code in (400, 404)


def test_lick_attachment_unknown_file_404s(client):
    lick_id = client.post("/api/licks", json={"title": "Pic"}).json()["id"]
    assert client.get(f"/api/licks/{lick_id}/attachments/nope.png").status_code == 404


def test_lick_attachment_too_large_rejected(client):
    lick_id = client.post("/api/licks", json={"title": "Pic"}).json()["id"]
    big = b"x" * (20 * 1024 * 1024 + 1)
    r = client.post(
        f"/api/licks/{lick_id}/attachments",
        files={"file": ("big.png", big, "image/png")},
    )
    assert r.status_code == 413


def test_material_upload_fetch_list_and_delete(client):
    r = client.post(
        "/api/materials",
        files={"file": ("Chapter1 Exercises.pdf", b"%PDF fake bytes", "application/pdf")},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["filename"] == "Chapter1 Exercises.pdf"
    assert body["url"] == f"/api/materials/{body['id']}"

    r2 = client.get(body["url"])
    assert r2.status_code == 200
    assert r2.content == b"%PDF fake bytes"

    listed = client.get("/api/materials").json()
    assert any(m["id"] == body["id"] and m["filename"] == "Chapter1 Exercises.pdf" for m in listed)

    r3 = client.delete(body["url"])
    assert r3.status_code == 200
    assert client.get(body["url"]).status_code == 404
    assert not any(m["id"] == body["id"] for m in client.get("/api/materials").json())


def test_material_shared_across_multiple_licks(client):
    body = client.post(
        "/api/materials",
        files={"file": ("backing.mp3", b"fake mp3 bytes", "audio/mpeg")},
    ).json()
    lick_a = client.post("/api/licks", json={"title": "Basics", "notes": f"[bt]({body['url']})"}).json()["id"]
    lick_b = client.post("/api/licks", json={"title": "Song", "notes": f"[bt]({body['url']})"}).json()["id"]
    client.delete(f"/api/licks/{lick_a}")
    # deleting one referencing lick must not remove the shared material
    assert client.get(body["url"]).status_code == 200
    assert client.get(f"/api/licks/{lick_b}").status_code == 200


def test_material_sanitizes_path_traversal_in_filename(client):
    r = client.post(
        "/api/materials",
        files={"file": ("../../evil.pdf", b"data", "application/pdf")},
    )
    assert r.status_code == 200
    url = r.json()["url"]
    assert "/../" not in url
    assert url.endswith("evil.pdf")


def test_material_fetch_rejects_path_traversal(client):
    assert client.get("/api/materials/..%2f..%2fetc%2fpasswd").status_code in (400, 404)


def test_material_unknown_id_404s(client):
    assert client.get("/api/materials/nope.pdf").status_code == 404
    assert client.delete("/api/materials/nope.pdf").status_code == 404


def test_material_too_large_rejected(client):
    big = b"x" * (100 * 1024 * 1024 + 1)
    r = client.post(
        "/api/materials",
        files={"file": ("big.mp3", big, "audio/mpeg")},
    )
    assert r.status_code == 413
