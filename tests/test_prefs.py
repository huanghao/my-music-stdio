import pytest


def test_load_defaults(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    from importlib import reload
    import src.prefs as prefs
    reload(prefs)
    p = prefs.load()
    assert p["bars_per_row"] == 4
    assert "soundfont_path" in p
    assert "songs_dir" in p


def test_save_and_reload(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    from importlib import reload
    import src.prefs as prefs
    reload(prefs)
    prefs.save({"bars_per_row": 8, "soundfont_path": "/tmp/test.sf2", "songs_dir": "/tmp/songs"})
    p = prefs.load()
    assert p["bars_per_row"] == 8
    assert p["soundfont_path"] == "/tmp/test.sf2"


def test_partial_update(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    from importlib import reload
    import src.prefs as prefs
    reload(prefs)
    prefs.save({"bars_per_row": 2})
    p = prefs.load()
    assert p["bars_per_row"] == 2
    assert "soundfont_path" in p  # defaults preserved
