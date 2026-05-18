import ctypes
import threading
import time as _time
from pathlib import Path

import mido

DEFAULT_SOUNDFONT = str(Path("~/music-practice/soundfonts/Timbres of Heaven (XGM) 4.00(G).sf2").expanduser())

# pyfluidsynth needs libfluidsynth.dylib resolvable via ctypes.
# On macOS with Homebrew, it lives in /opt/homebrew/lib but is not on the
# default dyld search path. Load it explicitly so the subsequent
# `import fluidsynth` finds it.
_LIB_PATH = "/opt/homebrew/lib/libfluidsynth.dylib"
try:
    ctypes.cdll.LoadLibrary(_LIB_PATH)
except OSError:
    pass  # already loaded or not at this path — fall through

import fluidsynth  # noqa: E402  (must come after ctypes preload)


class Player:
    """Thread-based MIDI player using pyfluidsynth.

    The fluidsynth.Synth instance is created once on first play and reused.
    Playback runs in a daemon thread. Stop and pause are controlled via
    threading.Event flags.
    """

    def __init__(self, soundfont: str | None = None):
        self._soundfont = soundfont or DEFAULT_SOUNDFONT
        self._fs: fluidsynth.Synth | None = None
        self._sfid: int | None = None
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._pause_event = threading.Event()
        self._pause_event.set()  # not paused initially
        self._current_file: str | None = None
        self._started_at: float | None = None  # monotonic time of first note
        self._lock = threading.Lock()

    def _ensure_synth(self) -> None:
        if self._fs is None:
            self._fs = fluidsynth.Synth(gain=0.7)
            self._fs.start(driver="coreaudio")
            sf = str(Path(self._soundfont).expanduser())
            self._sfid = self._fs.sfload(sf)

    def _all_notes_off(self) -> None:
        if self._fs:
            for ch in range(16):
                self._fs.cc(ch, 123, 0)  # All Notes Off

    def _playback_loop(self, midi_file: str) -> None:
        mid = mido.MidiFile(midi_file)
        first_note = True
        for msg in mid.play():
            self._pause_event.wait()
            if self._stop_event.is_set():
                break
            if msg.is_meta:
                continue
            if first_note:
                with self._lock:
                    self._started_at = _time.monotonic()
                first_note = False
            if msg.type == "note_on":
                self._fs.noteon(msg.channel, msg.note, msg.velocity)
            elif msg.type == "note_off":
                self._fs.noteoff(msg.channel, msg.note)
            elif msg.type == "program_change":
                self._fs.program_change(msg.channel, msg.program)
            elif msg.type == "control_change":
                self._fs.cc(msg.channel, msg.control, msg.value)
        self._all_notes_off()
        with self._lock:
            if self._current_file == midi_file:
                self._current_file = None
                self._started_at = None

    def play(self, midi_file: str) -> None:
        self.stop()
        self._ensure_synth()
        self._stop_event.clear()
        self._pause_event.set()
        with self._lock:
            self._current_file = midi_file
            self._started_at = None
        self._thread = threading.Thread(
            target=self._playback_loop, args=(midi_file,), daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        self._pause_event.set()  # unblock paused thread so it can exit
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)
        self._thread = None
        self._all_notes_off()
        with self._lock:
            self._current_file = None
            self._started_at = None

    def pause(self) -> None:
        self._pause_event.clear()

    def resume(self) -> None:
        self._pause_event.set()

    def status(self) -> dict:
        playing = bool(
            self._thread and self._thread.is_alive() and not self._stop_event.is_set()
        )
        paused = playing and not self._pause_event.is_set()
        with self._lock:
            f = self._current_file
            started = self._started_at
        elapsed = round(_time.monotonic() - started, 3) if (playing and started) else None
        return {"playing": playing, "paused": paused, "file": f, "elapsed_sec": elapsed}

    def close(self) -> None:
        self.stop()
        if self._fs:
            self._fs.delete()
            self._fs = None
