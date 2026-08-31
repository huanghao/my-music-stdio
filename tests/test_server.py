import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    (tmp_path / "accompaniments").mkdir()
    from importlib import reload
    import src.prefs as prefs
    reload(prefs)
    prefs.save({
        "bars_per_row": 4,
        "soundfont_path": "/tmp/test.sf3",
        "accompaniments_dir": str(tmp_path / "accompaniments"),
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


def test_get_accompaniments_empty(client):
    r = client.get("/api/accompaniments")
    assert r.status_code == 200
    assert r.json() == []


def test_create_and_get_accompaniment(client):
    song = {
        "title": "Test Song",
        "key": "C", "bpm": 120, "style": "pop",
        "time_signature": "4/4", "loops": 4,
        "bars": [{"chords": [{"name": "C", "beats": 4}]}],
    }
    r = client.post("/api/accompaniments", json=song)
    assert r.status_code == 200
    accompaniment_id = r.json()["id"]

    r = client.get(f"/api/accompaniments/{accompaniment_id}")
    assert r.status_code == 200
    assert r.json()["title"] == "Test Song"


def test_update_accompaniment(client):
    song = {"title": "A", "key": "C", "bpm": 120, "style": "pop",
            "time_signature": "4/4", "loops": 4, "bars": []}
    accompaniment_id = client.post("/api/accompaniments", json=song).json()["id"]

    r = client.put(f"/api/accompaniments/{accompaniment_id}", json={**song, "title": "B"})
    assert r.status_code == 200

    r = client.get(f"/api/accompaniments/{accompaniment_id}")
    assert r.json()["title"] == "B"


def test_delete_accompaniment(client):
    song = {"title": "Del", "key": "C", "bpm": 120, "style": "pop",
            "time_signature": "4/4", "loops": 4, "bars": []}
    accompaniment_id = client.post("/api/accompaniments", json=song).json()["id"]
    r = client.delete(f"/api/accompaniments/{accompaniment_id}")
    assert r.status_code == 200
    r = client.get(f"/api/accompaniments/{accompaniment_id}")
    assert r.status_code == 404


def test_accompaniment_id_path_traversal_is_rejected(client, tmp_path):
    # httpx/browsers normalize a literal ".." out of the URL before sending it,
    # so use percent-encoding to exercise the raw path the server actually sees.
    r = client.delete("/api/accompaniments/%2e%2e")
    assert r.status_code == 400
    assert (tmp_path / "accompaniments").exists()  # would be gone if the parent got rmtree'd

    r = client.get("/api/accompaniments/%2e%2e")
    assert r.status_code == 400

    r = client.put("/api/accompaniments/%2e%2e", json={"title": "x"})
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
    assert client.post("/api/accompaniments", json={**base, "bpm": 5}).status_code == 422
    assert client.post("/api/accompaniments", json={**base, "bpm": 400}).status_code == 422
    # Boundary values must be accepted
    assert client.post("/api/accompaniments", json={**base, "bpm": 20}).status_code == 200
    assert client.post("/api/accompaniments", json={**base, "bpm": 300}).status_code == 200


def test_loops_out_of_range_rejected(client):
    """Loops outside [1, 999] → HTTP 422."""
    base = {"title": "T", "key": "C", "style": "pop", "bpm": 120,
            "time_signature": "4/4", "bars": []}
    assert client.post("/api/accompaniments", json={**base, "loops": 0}).status_code == 422
    assert client.post("/api/accompaniments", json={**base, "loops": 1000}).status_code == 422
    assert client.post("/api/accompaniments", json={**base, "loops": 1}).status_code == 200
    assert client.post("/api/accompaniments", json={**base, "loops": 999}).status_code == 200


def test_play_empty_bars_returns_400(client):
    """POSTing /api/play with no chords should return 400."""
    r = client.post("/api/play", json={
        "bars": [], "bpm": 120, "style": "pop", "loops": 4,
    })
    assert r.status_code == 400
    assert "No chords" in r.json()["detail"]


def test_play_ignores_empty_bars_in_duration(client):
    """A trailing empty bar (chords=[]) generates no MIDI bars, so it must not
    count toward duration_sec either — otherwise the UI's bar-highlight math
    (duration / bars / loops) drifts one bar per loop behind the audio."""
    r = client.post("/api/play", json={
        "bars": [
            {"chords": [{"name": "C", "beats": 4}]},
            {"chords": [{"name": "G", "beats": 4}]},
            {"chords": []},  # trailing "+ Add Bar" cell never filled in
        ],
        "bpm": 120, "style": "pop", "loops": 2,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["loops"] == 2
    # 2 sounding bars * 2 loops * 2s/bar at 120bpm — not 3 bars
    assert body["duration_sec"] == 8.0
    client.post("/api/stop")


def test_play_routes_output_device_to_player(client, monkeypatch):
    """The web UI's output-device picker label must reach Player so server-side
    FluidSynth playback goes to the same interface the user picked."""
    import src.server as server
    mock_player = MagicMock()
    monkeypatch.setattr(server, "_player", mock_player)
    monkeypatch.setattr(
        server.audio_devices, "resolve_output_device",
        lambda name: name or None,
    )
    r = client.post("/api/play", json={
        "bars": [{"chords": [{"name": "C"}]}],
        "bpm": 120, "style": "pop", "loops": 1,
        "output_device": "Scarlett Solo USB",
    })
    assert r.status_code == 200
    mock_player.set_output_device.assert_called_once_with("Scarlett Solo USB")


def test_play_without_output_device_uses_system_default(client, monkeypatch):
    import src.server as server
    mock_player = MagicMock()
    monkeypatch.setattr(server, "_player", mock_player)
    monkeypatch.setattr(
        server.audio_devices, "resolve_output_device",
        lambda name: name or None,
    )
    r = client.post("/api/play", json={
        "bars": [{"chords": [{"name": "C"}]}],
        "bpm": 120, "style": "pop", "loops": 1,
    })
    assert r.status_code == 200
    mock_player.set_output_device.assert_called_once_with(None)


def test_play_bpm_validated(client):
    """POST /api/play also validates bpm through AccompanimentBody."""
    r = client.post("/api/play", json={
        "bars": [{"chords": [{"name": "C"}]}],
        "bpm": 5, "style": "pop", "loops": 2,
    })
    assert r.status_code == 422


def test_play_volume_validated(client):
    """POST /api/play validates volume through AccompanimentBody (0.0-1.0)."""
    base = {"bars": [{"chords": [{"name": "C"}]}], "bpm": 120, "style": "pop", "loops": 1}
    assert client.post("/api/play", json={**base, "volume": 1.5}).status_code == 422
    assert client.post("/api/play", json={**base, "volume": -0.1}).status_code == 422


def test_put_volume_round_trips_and_validates_range(client):
    r = client.put("/api/volume", json={"volume": 0.5})
    assert r.status_code == 200
    assert r.json() == {"volume": 0.5}
    assert client.put("/api/volume", json={"volume": 1.5}).status_code == 422
    assert client.put("/api/volume", json={"volume": -0.1}).status_code == 422


# ── Lick API ──────────────────────────────────────────────────────────────

def test_create_and_list_lick(client):
    r = client.post("/api/licks", json={"title": "Test Lick", "notes": "hi", "target_bpm": 120})
    assert r.status_code == 200
    lick_id = r.json()["id"]

    r = client.get("/api/licks")
    assert r.status_code == 200
    ids = [lick["id"] for lick in r.json()]
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
    listed = next(lick for lick in client.get("/api/licks").json() if lick["id"] == lick_id)
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


def test_material_state_round_trips_and_shows_up_in_list(client):
    body = client.post(
        "/api/materials",
        files={"file": ("song.mp3", b"fake mp3 bytes", "audio/mpeg")},
    ).json()

    # nothing saved yet
    assert client.get(f"{body['url']}/state").json() == {}

    state = {"bpm": 120, "loopFromBar": 5, "loopToBar": 9}
    r = client.put(f"{body['url']}/state", json=state)
    assert r.status_code == 200

    assert client.get(f"{body['url']}/state").json() == state
    listed = next(m for m in client.get("/api/materials").json() if m["id"] == body["id"])
    assert listed["state"] == state


def test_material_state_404s_for_unknown_material(client):
    assert client.get("/api/materials/nope.mp3/state").status_code == 404
    assert client.put("/api/materials/nope.mp3/state", json={"bpm": 100}).status_code == 404


def test_material_upload_includes_content_hash_and_finds_by_hash(client):
    body = client.post(
        "/api/materials",
        files={"file": ("song.mp3", b"identical bytes", "audio/mpeg")},
    ).json()
    listed = next(m for m in client.get("/api/materials").json() if m["id"] == body["id"])
    assert listed["content_hash"]

    r = client.get(f"/api/materials/by-hash/{listed['content_hash']}")
    assert r.status_code == 200
    assert r.json()["id"] == body["id"]

    assert client.get("/api/materials/by-hash/deadbeef").status_code == 404


def test_material_by_hash_matches_a_separately_uploaded_duplicate(client):
    # Two uploads, different filenames, byte-identical content — by-hash
    # should surface *some* existing match for the dedupe prompt (which one,
    # of several byte-identical materials, is unspecified/either is fine).
    first = client.post(
        "/api/materials",
        files={"file": ("original.wav", b"same audio content", "audio/wav")},
    ).json()
    second = client.post(
        "/api/materials",
        files={"file": ("renamed-copy.wav", b"same audio content", "audio/wav")},
    ).json()
    hash_ = next(m for m in client.get("/api/materials").json() if m["id"] == first["id"])["content_hash"]
    r = client.get(f"/api/materials/by-hash/{hash_}")
    assert r.status_code == 200
    assert r.json()["id"] in (first["id"], second["id"])


def test_material_rename_changes_filename_but_not_id_or_url(client):
    body = client.post(
        "/api/materials",
        files={"file": ("original-name.pdf", b"pdf bytes", "application/pdf")},
    ).json()

    r = client.put(f"{body['url']}/filename", json={"filename": "Better Name.pdf"})
    assert r.status_code == 200

    listed = next(m for m in client.get("/api/materials").json() if m["id"] == body["id"])
    assert listed["filename"] == "Better Name.pdf"
    assert listed["id"] == body["id"]  # id/url (what everything else references) never changes
    # the file itself is still reachable at the same, unchanged url
    assert client.get(body["url"]).status_code == 200


def test_material_rename_rejects_blank_name_and_unknown_id(client):
    body = client.post(
        "/api/materials",
        files={"file": ("x.pdf", b"data", "application/pdf")},
    ).json()
    assert client.put(f"{body['url']}/filename", json={"filename": "   "}).status_code == 400
    assert client.put("/api/materials/nope.pdf/filename", json={"filename": "x"}).status_code == 404
