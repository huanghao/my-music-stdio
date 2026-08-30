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


def test_pause_silences_sounding_notes(player, tmp_path):
    # Sustained notes (a chord holding a whole bar) must be cut on pause,
    # or they keep ringing and Pause feels like it did nothing.
    f = _make_mid(tmp_path / "test.mid", duration_ticks=96000)
    player.play(f)
    time.sleep(0.05)
    player._fs.cc.reset_mock()
    player.pause()
    calls = [c for c in player._fs.cc.call_args_list if c.args[1] == 123]
    assert len(calls) == 16  # CC123 All Notes Off on every channel
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


def test_status_includes_session_metadata(player, tmp_path):
    f = _make_mid(tmp_path / "test.mid", duration_ticks=96000)
    player.play(
        f,
        bpm=120,
        session_meta={"duration_sec": 8, "loops": 2, "bars": 4, "bpm": 120},
    )
    time.sleep(0.05)

    s = player.status()

    assert s["playing"] is True
    assert s["duration_sec"] == 8
    assert s["loops"] == 2
    assert s["bars"] == 4
    assert s["bpm"] == 120
    assert s["current_loop"] == 1
    player.stop()


def test_set_volume_sends_cc7_to_all_channels(player):
    player._fs.cc.reset_mock()
    player.set_volume(0.5)
    calls = [c for c in player._fs.cc.call_args_list if c.args[1] == 7]
    assert len(calls) == 16
    assert all(c.args[2] == 64 for c in calls)  # round(0.5 * 127)


def test_set_volume_clamps_out_of_range(player):
    player.set_volume(2.0)
    assert player._volume == 1.0
    player.set_volume(-1.0)
    assert player._volume == 0.0


def test_play_reapplies_current_volume_on_fresh_channels(player, tmp_path):
    player.set_volume(0.25)
    f = _make_mid(tmp_path / "test.mid", duration_ticks=96000)
    player._fs.cc.reset_mock()
    player.play(f)
    time.sleep(0.05)
    calls = [c for c in player._fs.cc.call_args_list if c.args[1] == 7]
    assert len(calls) == 16
    assert all(c.args[2] == round(0.25 * 127) for c in calls)
    player.stop()


def test_set_bpm_updates_session_metadata(player, tmp_path):
    f = _make_mid(tmp_path / "test.mid", duration_ticks=96000)
    player.play(
        f,
        bpm=120,
        session_meta={"duration_sec": 8, "loops": 2, "bars": 4, "bpm": 120},
    )
    time.sleep(0.05)

    player.set_bpm(144)

    assert player.status()["bpm"] == 144
    player.stop()


def test_set_bpm_recomputes_duration_sec(player, tmp_path):
    # duration_sec feeds the UI's bar-highlight math; a live tempo change
    # must rescale it or the highlight drifts from the audio.
    f = _make_mid(tmp_path / "test.mid", duration_ticks=96000)
    player.play(
        f,
        bpm=120,
        session_meta={"duration_sec": 16, "loops": 2, "bars": 4, "bpm": 120},
    )
    time.sleep(0.05)

    player.set_bpm(240)  # twice as fast → half the duration

    assert player.status()["duration_sec"] == 8
    player.stop()
