import threading
from pathlib import Path

import fluidsynth
import mido

DEFAULT_SOUNDFONT = str(Path("~/music-practice/soundfonts/MuseScore_General.sf3").expanduser())


class Player:
    """Thread-based MIDI player using pyfluidsynth.

    Plays a .mid file in a background thread. Supports stop and pause.
    The fluidsynth.Synth instance is created once and reused across plays.
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
        self._lock = threading.Lock()

    def _ensure_synth(self) -> None:
        if self._fs is None:
            self._fs = fluidsynth.Synth(gain=0.7)
            self._fs.start(driver="coreaudio")
            self._sfid = self._fs.sfload(self._soundfont)

    def _all_notes_off(self) -> None:
        if self._fs:
            for ch in range(16):
                self._fs.cc(ch, 123, 0)  # All Notes Off

    def _playback_loop(self, midi_file: str) -> None:
        mid = mido.MidiFile(midi_file)
        for msg in mid.play():
            # pause: block here until resumed or stopped
            self._pause_event.wait()
            if self._stop_event.is_set():
                break
            if msg.is_meta:
                continue
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
            self._current_file = None

    def play(self, midi_file: str) -> None:
        self.stop()
        self._ensure_synth()
        self._stop_event.clear()
        self._pause_event.set()
        with self._lock:
            self._current_file = midi_file
        self._thread = threading.Thread(target=self._playback_loop, args=(midi_file,), daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        self._pause_event.set()  # unblock if paused so thread can exit
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)
        self._thread = None
        self._all_notes_off()
        with self._lock:
            self._current_file = None

    def pause(self) -> None:
        self._pause_event.clear()

    def resume(self) -> None:
        self._pause_event.set()

    def status(self) -> dict:
        playing = bool(self._thread and self._thread.is_alive() and not self._stop_event.is_set())
        paused = playing and not self._pause_event.is_set()
        with self._lock:
            f = self._current_file
        return {"playing": playing, "paused": paused, "file": f}

    def close(self) -> None:
        self.stop()
        if self._fs:
            self._fs.delete()
            self._fs = None
