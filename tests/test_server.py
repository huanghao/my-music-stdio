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


def test_get_status(client):
    r = client.get("/api/status")
    assert r.status_code == 200
    assert r.json()["playing"] is False
