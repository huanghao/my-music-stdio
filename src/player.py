import subprocess
import time
from pathlib import Path

DLS = "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls"
DEFAULT_SOUNDFONT = str(Path("~/music-practice/soundfonts/Timbres of Heaven (XGM) 4.00(G).sf2").expanduser())


class Player:
    """Subprocess-based player: plays a MIDI file via fluidsynth CLI."""

    def __init__(self, soundfont: str | None = None):
        self._soundfont = soundfont or DEFAULT_SOUNDFONT
        self._proc: subprocess.Popen | None = None
        self._current_file: str | None = None

    def play(self, midi_file: str) -> None:
        self.stop()
        self._proc = subprocess.Popen(
            ["fluidsynth", "-a", "coreaudio", self._soundfont, midi_file],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self._current_file = midi_file

    def stop(self) -> None:
        if self._proc and self._proc.poll() is None:
            self._proc.terminate()
        self._proc = None
        self._current_file = None

    def status(self) -> dict:
        if self._proc and self._proc.poll() is None:
            return {"playing": True, "file": self._current_file}
        if self._proc:
            self._proc = None
            self._current_file = None
        return {"playing": False, "file": None}


class LiveSynth:
    """Real-time MIDI event player via pyfluidsynth.

    Wraps fluidsynth.Synth to send noteon/noteoff events directly,
    without writing a MIDI file first. Useful for interactive demos
    and low-latency playback.
    """

    def __init__(self, soundfont: str | None = None, gain: float = 0.5):
        import fluidsynth  # optional dependency
        self._fs = fluidsynth.Synth(gain=gain)
        self._fs.start(driver="coreaudio")
        sf_path = soundfont or DEFAULT_SOUNDFONT
        self._sfid = self._fs.sfload(sf_path)
        time.sleep(0.2)  # let audio driver initialise

    def program_select(self, channel: int, bank: int, preset: int) -> None:
        self._fs.program_select(channel, self._sfid, bank, preset)

    def noteon(self, channel: int, note: int, velocity: int) -> None:
        self._fs.noteon(channel, note, velocity)

    def noteoff(self, channel: int, note: int) -> None:
        self._fs.noteoff(channel, note)

    def close(self) -> None:
        self._fs.delete()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
