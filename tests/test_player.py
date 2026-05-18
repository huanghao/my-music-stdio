import time
from unittest.mock import MagicMock, patch

import mido
import pytest


@pytest.fixture
def player():
    mock_fs = MagicMock()
    mock_fs.sfload.return_value = 1
    with patch("fluidsynth.Synth", return_value=mock_fs):
        from importlib import reload
        import src.player as pm
        reload(pm)
        p = pm.Player(soundfont="/tmp/test.sf3")
        p._ensure_synth()
        yield p
        p.close()


def _make_mid(path, duration_ticks=480):
    mid = mido.MidiFile(type=0, ticks_per_beat=480)
    t = mido.MidiTrack()
    t.append(mido.Message("note_on",  channel=0, note=60, velocity=80, time=0))
    t.append(mido.Message("note_off", channel=0, note=60, velocity=0,  time=duration_ticks))
    mid.tracks.append(t)
    mid.save(str(path))
    return str(path)


def test_initial_state_is_stopped(player):
    s = player.status()
    assert s["playing"] is False
    assert s["paused"] is False
    assert s["file"] is None
    assert s["elapsed_sec"] is None


def test_play_sets_playing_state(player, tmp_path):
    f = _make_mid(tmp_path / "test.mid", duration_ticks=96000)
    player.play(f)
    time.sleep(0.05)
    s = player.status()
    assert s["playing"] is True
    assert s["paused"] is False
    assert s["file"] == f


def test_stop_clears_state(player, tmp_path):
    f = _make_mid(tmp_path / "test.mid", duration_ticks=96000)
    player.play(f)
    time.sleep(0.05)
    player.stop()
    s = player.status()
    assert s["playing"] is False
    assert s["file"] is None
    assert s["elapsed_sec"] is None


def test_pause_and_resume(player, tmp_path):
    f = _make_mid(tmp_path / "test.mid", duration_ticks=96000)
    player.play(f)
    time.sleep(0.05)
    player.pause()
    assert player.status()["paused"] is True
    player.resume()
    assert player.status()["paused"] is False
    player.stop()


def test_play_replaces_previous(player, tmp_path):
    f1 = _make_mid(tmp_path / "a.mid", duration_ticks=96000)
    f2 = _make_mid(tmp_path / "b.mid", duration_ticks=96000)
    player.play(f1)
    time.sleep(0.05)
    player.play(f2)
    time.sleep(0.05)
    assert player.status()["file"] == f2
    player.stop()
