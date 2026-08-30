import ctypes
import logging
import os
import threading
import time as _time
from pathlib import Path

import mido

logger = logging.getLogger(__name__)

DEFAULT_SOUNDFONT = str(Path("~/music-practice/soundfonts/Timbres of Heaven (XGM) 4.00(G).sf2").expanduser())

# pyfluidsynth needs libfluidsynth.dylib resolvable via ctypes.
# On macOS with Homebrew, it lives in /opt/homebrew/lib but is not on the
# default dyld search path. Load it explicitly so the subsequent
# `import fluidsynth` finds it.
_LIB_PATH = "/opt/homebrew/lib/libfluidsynth.dylib"
try:
    ctypes.cdll.LoadLibrary(_LIB_PATH)
except OSError as e:
    logger.warning("preload libfluidsynth failed (%s): %s", _LIB_PATH, e)

# pyfluidsynth locates the dylib via ctypes.util.find_library, which does not
# search /opt/homebrew/lib on macOS; its fallback is $HOMEBREW_PREFIX, which is
# only set by interactive shells (brew shellenv). Service managers (LaunchAgent,
# nanny daemon) run without it, so set it here when unset and the lib exists.
if not os.environ.get("HOMEBREW_PREFIX") and Path(_LIB_PATH).exists():
    os.environ["HOMEBREW_PREFIX"] = str(Path(_LIB_PATH).parent.parent)

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
        self._started_at: float | None = None
        self._paused_at: float | None = None
        self._total_paused: float = 0.0
        self._bpm: float = 120.0  # dynamically adjustable
        self._midi_tempo: int = 500_000  # microseconds per beat from MIDI file
        self._session_meta: dict = {}
        self._volume: float = 1.0  # 0.0-1.0, applied as MIDI CC7 (channel volume)
        self._lock = threading.Lock()

    def _ensure_synth(self) -> None:
        if self._fs is None:
            logger.info("initialising FluidSynth with %s", self._soundfont)
            self._fs = fluidsynth.Synth(gain=0.7)
            self._fs.start(driver="coreaudio")
            sf = str(Path(self._soundfont).expanduser())
            self._sfid = self._fs.sfload(sf)
            self._init_gm_channels()

    def _init_gm_channels(self) -> None:
        # GM standard: channel 9 is drums (bank 128), others default to bank 0
        midi_volume = round(self._volume * 127)
        for ch in range(16):
            if ch == 9:
                self._fs.program_select(ch, self._sfid, 128, 0)
            else:
                self._fs.program_select(ch, self._sfid, 0, 0)
            self._fs.cc(ch, 7, midi_volume)  # CC7 = channel volume

    def _all_notes_off(self) -> None:
        if self._fs:
            for ch in range(16):
                self._fs.cc(ch, 123, 0)  # All Notes Off

    def _playback_loop(self, midi_file: str) -> None:
        mid = mido.MidiFile(midi_file)
        ppq = mid.ticks_per_beat or 480
        # collect all messages with absolute tick positions
        messages: list[tuple[int, mido.Message]] = []
        tick = 0
        for msg in mid.tracks[0]:
            tick += msg.time
            messages.append((tick, msg))

        first_note = True
        # Drift-free scheduling: accumulate musical time and sleep to an absolute
        # deadline anchored at t0, instead of re-anchoring every message (which
        # adds per-message dispatch overhead to every gap and lags the audio
        # behind the wall clock the UI uses to track bar position).
        t0 = _time.monotonic()
        musical_sec = 0.0
        for i, (abs_tick, msg) in enumerate(messages):
            # --- sleep for delta ticks using current BPM ---
            if i > 0:
                delta_ticks = abs_tick - messages[i - 1][0]
                if delta_ticks > 0:
                    with self._lock:
                        bpm = self._bpm
                        paused_acc = self._total_paused
                    musical_sec += delta_ticks * (60.0 / (bpm * ppq))
                    deadline = t0 + musical_sec + paused_acc
                    # split sleep into small chunks so pause/stop stay responsive
                    chunk = 0.02  # 20ms chunks
                    while True:
                        self._pause_event.wait()
                        if self._stop_event.is_set():
                            break
                        remaining = deadline - _time.monotonic()
                        if remaining <= 0:
                            break
                        _time.sleep(min(chunk, remaining))
                    if self._stop_event.is_set():
                        break

            self._pause_event.wait()
            if self._stop_event.is_set():
                break

            if msg.is_meta:
                if msg.type == "set_tempo":
                    # update reference tempo but don't override user BPM
                    self._midi_tempo = msg.tempo
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
                if msg.channel != 9:
                    self._fs.program_change(msg.channel, msg.program)
            elif msg.type == "control_change":
                self._fs.cc(msg.channel, msg.control, msg.value)

        self._all_notes_off()
        with self._lock:
            if self._current_file == midi_file:
                self._current_file = None
                self._started_at = None
                self._session_meta = {}

    def set_soundfont(self, path: str) -> None:
        path = str(Path(path).expanduser())
        if path == str(Path(self._soundfont).expanduser()):
            return
        logger.info("switching soundfont → %s", path)
        self._soundfont = path
        if self._fs is not None:
            self.stop()
            if self._sfid is not None:
                self._fs.sfunload(self._sfid, reset_presets=True)
            self._sfid = self._fs.sfload(path)
            self._init_gm_channels()

    def set_volume(self, volume: float) -> None:
        with self._lock:
            self._volume = max(0.0, min(1.0, float(volume)))
        if self._fs is not None:
            midi_volume = round(self._volume * 127)
            for ch in range(16):
                self._fs.cc(ch, 7, midi_volume)

    def set_bpm(self, bpm: float) -> None:
        with self._lock:
            self._bpm = max(20.0, min(300.0, float(bpm)))
            if self._session_meta:
                self._session_meta["bpm"] = self._bpm
                # duration_sec feeds the UI's bar-position math; keep it in
                # sync with the live tempo or the bar highlight drifts.
                bars = self._session_meta.get("bars")
                loops = self._session_meta.get("loops")
                if bars and loops:
                    self._session_meta["duration_sec"] = round(
                        bars * loops * 4 * 60.0 / self._bpm, 2
                    )

    def play(
        self,
        midi_file: str,
        bpm: float | None = None,
        session_meta: dict | None = None,
    ) -> None:
        logger.info("play: %s (bpm=%s)", midi_file, bpm)
        self.stop()
        self._ensure_synth()
        self._init_gm_channels()  # reset channels on every play
        self._stop_event.clear()
        self._pause_event.set()
        with self._lock:
            self._current_file = midi_file
            self._started_at = None
            self._paused_at = None
            self._total_paused = 0.0
            if bpm is not None:
                self._bpm = max(20.0, min(300.0, float(bpm)))
            self._session_meta = dict(session_meta or {})
            if self._session_meta and bpm is not None:
                self._session_meta["bpm"] = self._bpm
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
            self._paused_at = None
            self._total_paused = 0.0
            self._session_meta = {}

    def pause(self) -> None:
        self._pause_event.clear()
        with self._lock:
            self._paused_at = _time.monotonic()

    def resume(self) -> None:
        with self._lock:
            if self._paused_at is not None:
                self._total_paused += _time.monotonic() - self._paused_at
                self._paused_at = None
        self._pause_event.set()

    def status(self) -> dict:
        playing = bool(
            self._thread and self._thread.is_alive() and not self._stop_event.is_set()
        )
        paused = playing and not self._pause_event.is_set()
        with self._lock:
            f = self._current_file
            started = self._started_at
            total_paused = self._total_paused
            paused_at = self._paused_at
            session_meta = dict(self._session_meta)
        if playing and started:
            now = _time.monotonic()
            raw = now - started - total_paused
            if paused_at is not None:
                raw -= now - paused_at
            elapsed = round(max(0.0, raw), 3)
        else:
            elapsed = None
        status = {"playing": playing, "paused": paused, "file": f, "elapsed_sec": elapsed}
        if playing and session_meta:
            status.update(session_meta)
            duration = session_meta.get("duration_sec")
            loops = session_meta.get("loops")
            if elapsed is not None and duration and loops:
                sec_per_loop = duration / loops
                status["current_loop"] = (
                    min(int(elapsed / sec_per_loop) + 1, loops)
                    if sec_per_loop > 0
                    else 1
                )
            else:
                status["current_loop"] = 1
        return status

    def close(self) -> None:
        self.stop()
        if self._fs:
            self._fs.delete()
            self._fs = None
