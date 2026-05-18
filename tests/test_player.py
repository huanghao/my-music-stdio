from unittest.mock import patch, MagicMock
from src.player import Player


def test_initial_state_is_stopped():
    p = Player(soundfont="/tmp/test.sf3")
    assert p.status() == {"playing": False, "file": None}


def test_play_sets_playing_state(tmp_path):
    midi_file = tmp_path / "test.mid"
    midi_file.write_bytes(b"")
    p = Player(soundfont="/tmp/test.sf3")
    with patch("subprocess.Popen") as mock_popen:
        mock_proc = MagicMock()
        mock_proc.poll.return_value = None
        mock_popen.return_value = mock_proc
        p.play(str(midi_file))
        assert p.status()["playing"] is True
        assert p.status()["file"] == str(midi_file)


def test_stop_clears_state(tmp_path):
    midi_file = tmp_path / "test.mid"
    midi_file.write_bytes(b"")
    p = Player(soundfont="/tmp/test.sf3")
    with patch("subprocess.Popen") as mock_popen:
        mock_proc = MagicMock()
        mock_proc.poll.return_value = None
        mock_popen.return_value = mock_proc
        p.play(str(midi_file))
        p.stop()
        assert p.status() == {"playing": False, "file": None}
        mock_proc.terminate.assert_called_once()


def test_play_stops_existing_before_starting(tmp_path):
    midi1 = tmp_path / "a.mid"
    midi2 = tmp_path / "b.mid"
    midi1.write_bytes(b"")
    midi2.write_bytes(b"")
    p = Player(soundfont="/tmp/test.sf3")
    with patch("subprocess.Popen") as mock_popen:
        mock_proc = MagicMock()
        mock_proc.poll.return_value = None
        mock_popen.return_value = mock_proc
        p.play(str(midi1))
        p.play(str(midi2))
        assert mock_proc.terminate.call_count == 1
