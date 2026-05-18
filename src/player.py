import subprocess

DLS = "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls"


class Player:
    def __init__(self, soundfont: str | None = None):
        self._soundfont = soundfont or DLS
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
