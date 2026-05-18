import time
from unittest.mock import MagicMock, patch
import pytest


@pytest.fixture
def player(tmp_path):
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


def test_initial_state_is_stopped(player):
    s = player.status()
    assert s["playing"] is False
    assert s["paused"] is False
    assert s["file"] is None


def test_play_sets_playing_state(player, tmp_path):
    midi_file = tmp_path / "test.mid"
    import mido
    mid = mido.MidiFile(type=0, ticks_per_beat=480)
    track = mido.MidiTrack()
    track.append(mido.Message("note_on", channel=0, note=60, velocity=80, time=0))
    track.append(mido.Message("note_off", channel=0, note=60, velocity=0, time=480))
    mid.tracks.append(track)
    mid.save(str(midi_file))

    player.play(str(midi_file))
    time.sleep(0.05)
    assert player.status()["playing"] is True
    assert player.status()["file"] == str(midi_file)
    player.stop()


def test_stop_clears_state(player, tmp_path):
    midi_file = tmp_path / "test.mid"
    import mido
    mid = mido.MidiFile(type=0, ticks_per_beat=480)
    track = mido.MidiTrack()
    track.append(mido.Message("note_on", channel=0, note=60, velocity=80, time=0))
    track.append(mido.Message("note_off", channel=0, note=60, velocity=0, time=9600))
    mid.tracks.append(track)
    mid.save(str(midi_file))

    player.play(str(midi_file))
    time.sleep(0.05)
    player.stop()
    s = player.status()
    assert s["playing"] is False
    assert s["file"] is None


def test_pause_and_resume(player, tmp_path):
    midi_file = tmp_path / "long.mid"
    import mido
    mid = mido.MidiFile(type=0, ticks_per_beat=480)
    track = mido.MidiTrack()
    track.append(mido.Message("note_on", channel=0, note=60, velocity=80, time=0))
    track.append(mido.Message("note_off", channel=0, note=60, velocity=0, time=96000))
    mid.tracks.append(track)
    mid.save(str(midi_file))

    player.play(str(midi_file))
    time.sleep(0.05)
    player.pause()
    assert player.status()["paused"] is True
    player.resume()
    assert player.status()["paused"] is False
    player.stop()


def test_play_replaces_previous(player, tmp_path):
    def make_mid(path):
        import mido
        mid = mido.MidiFile(type=0, ticks_per_beat=480)
        track = mido.MidiTrack()
        track.append(mido.Message("note_on", channel=0, note=60, velocity=80, time=0))
        track.append(mido.Message("note_off", channel=0, note=60, velocity=0, time=96000))
        mid.tracks.append(track)
        mid.save(str(path))

    f1 = tmp_path / "a.mid"
    f2 = tmp_path / "b.mid"
    make_mid(f1)
    make_mid(f2)

    player.play(str(f1))
    time.sleep(0.05)
    player.play(str(f2))
    time.sleep(0.05)
    assert player.status()["file"] == str(f2)
    player.stop()
