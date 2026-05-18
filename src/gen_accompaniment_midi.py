"""Generate accompaniment MIDI: piano block chords + bass + drums.

Usage:
    python gen_accompaniment_midi.py                             # 1645, 120 BPM, pop
    python gen_accompaniment_midi.py C Am F G --bpm 90           # custom progression
    python gen_accompaniment_midi.py A E F#m D --style shuffle   # shuffle feel
    python gen_accompaniment_midi.py --style blues               # 12-bar blues in A
"""

import argparse
import os
import random

import mido

PPQ = 480
TICKS_PER_BAR = PPQ * 4
REPEATS = 4

# --- chord builder ---

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

ENHARMONIC = {"Db": "C#", "Eb": "D#", "Fb": "E", "Gb": "F#", "Ab": "G#", "Bb": "A#", "Cb": "B"}

QUALITY_INTERVALS: dict[str, list[int]] = {
    "":     [0, 4, 7],        # major
    "m":    [0, 3, 7],        # minor
    "7":    [0, 4, 7, 10],    # dominant 7
    "maj7": [0, 4, 7, 11],
    "m7":   [0, 3, 7, 10],
    "dim":  [0, 3, 6],
    "aug":  [0, 4, 8],
    "sus2": [0, 2, 7],
    "sus4": [0, 5, 7],
    "9":    [0, 4, 7, 10, 14],
    "maj9": [0, 4, 7, 11, 14],
    "m9":   [0, 3, 7, 10, 14],
    "add9": [0, 4, 7, 14],
    "6":    [0, 4, 7, 9],
    "m6":   [0, 3, 7, 9],
    "dim7": [0, 3, 6, 9],
    "m7b5": [0, 3, 6, 10],    # half-diminished
}


def parse_chord(symbol: str) -> tuple[int, str]:
    """Parse 'Am7' -> (root_midi, quality). Root is voiced around C4 (midi 60)."""
    for length in (2, 1):
        root_name = symbol[:length]
        root_name = ENHARMONIC.get(root_name, root_name)
        if root_name in NOTE_NAMES:
            quality = symbol[length:]
            if quality in QUALITY_INTERVALS:
                root_midi = 60 + NOTE_NAMES.index(root_name)
                # keep within one octave below C4 for comfortable voicing
                if root_midi > 65:
                    root_midi -= 12
                return root_midi, quality
    raise ValueError(f"Cannot parse chord: '{symbol}'. "
                     f"Roots: {NOTE_NAMES}, qualities: {list(QUALITY_INTERVALS)}")


def chord_midi_notes(symbol: str) -> list[int]:
    root, quality = parse_chord(symbol)
    return [root + i for i in QUALITY_INTERVALS[quality]]


def bass_root_midi(symbol: str) -> int:
    root, _ = parse_chord(symbol)
    return root - 24  # two octaves below piano voicing


# --- GM drum note numbers ---
KICK   = 36
SNARE  = 38
HIHAT  = 42  # closed
HIHAT_OPEN = 46
RIDE   = 51
TOM_HI = 50
TOM_LO = 45
CRASH  = 49
RIM    = 37


# --- style definitions ---
# Each style provides:
#   groove(bar_offset, is_fill) -> list[(abs_tick, channel, note, velocity)]
# Piano/bass voicing style is also per-style.

def _drum(t: int, note: int, vel: int, dur: int = PPQ // 4) -> list[tuple]:
    return [
        (t,       9, note, vel),
        (t + dur, 9, note, 0),
    ]


def groove_pop(bar_offset: int, is_fill: bool) -> list[tuple]:
    events = []
    # hihat: every 8th note
    for e in range(8):
        t = bar_offset + e * PPQ // 2
        vel = 65 if e % 2 == 0 else 50
        events += _drum(t, HIHAT, vel)
    # kick 1 & 3, snare 2 & 4
    for beat, note, vel in [(0, KICK, 100), (PPQ, SNARE, 90),
                             (PPQ*2, KICK, 95), (PPQ*3, SNARE, 88)]:
        events += _drum(bar_offset + beat, note, vel)
    if is_fill:
        # replace last beat hihat with snare roll
        for e in range(4):
            t = bar_offset + PPQ * 3 + e * PPQ // 4
            events += _drum(t, SNARE, 80 + e * 5, PPQ // 8)
    return events


def groove_shuffle(bar_offset: int, is_fill: bool) -> list[tuple]:
    # swing hihat: 8th triplets, accent on beat
    events = []
    TRIPLET = PPQ // 3
    for beat in range(4):
        t = bar_offset + beat * PPQ
        events += _drum(t, HIHAT, 70)
        events += _drum(t + TRIPLET * 2, HIHAT, 45)  # swing 8th
    for beat, note, vel in [(0, KICK, 100), (PPQ, SNARE, 88),
                             (PPQ*2, KICK, 95), (PPQ*3, SNARE, 85)]:
        events += _drum(bar_offset + beat, note, vel)
    if is_fill:
        for e in range(4):
            t = bar_offset + PPQ * 3 + e * PPQ // 4
            events += _drum(t, TOM_HI if e < 2 else TOM_LO, 85)
    return events


def groove_ballad(bar_offset: int, is_fill: bool) -> list[tuple]:
    events = []
    # hihat: quarter notes, open on beat 2 & 4
    for beat in range(4):
        t = bar_offset + beat * PPQ
        note = HIHAT_OPEN if beat % 2 == 1 else HIHAT
        events += _drum(t, note, 55, PPQ // 2)
    for beat, note, vel in [(0, KICK, 90), (PPQ, SNARE, 75),
                             (PPQ*2, KICK, 85), (PPQ*3, SNARE, 72)]:
        events += _drum(bar_offset + beat, note, vel)
    if is_fill:
        events += _drum(bar_offset + PPQ * 3 + PPQ // 2, SNARE, 80)
    return events


def groove_rock(bar_offset: int, is_fill: bool) -> list[tuple]:
    events = []
    # 16th hihat
    for s in range(16):
        t = bar_offset + s * PPQ // 4
        vel = 70 if s % 4 == 0 else 45
        events += _drum(t, HIHAT, vel, PPQ // 8)
    # double kick on 1 & 2.5, snare 2 & 4
    for t, note, vel in [
        (0,           KICK,  105),
        (PPQ // 2,    KICK,   90),
        (PPQ,         SNARE,  95),
        (PPQ * 2,     KICK,  105),
        (PPQ * 2 + PPQ // 2, KICK, 88),
        (PPQ * 3,     SNARE,  95),
    ]:
        events += _drum(bar_offset + t, note, vel)
    if is_fill:
        for e in range(4):
            t = bar_offset + PPQ * 3 + e * PPQ // 4
            events += _drum(t, TOM_HI if e < 2 else TOM_LO, 95 - e * 5)
        events += _drum(bar_offset + TICKS_PER_BAR - PPQ // 8, CRASH, 100)
    return events


def groove_metal(bar_offset: int, is_fill: bool) -> list[tuple]:
    events = []
    # 16th ride
    for s in range(16):
        t = bar_offset + s * PPQ // 4
        events += _drum(t, RIDE, 60, PPQ // 8)
    # blast-adjacent: kick every 8th, snare on 2 & 4
    for e in range(8):
        t = bar_offset + e * PPQ // 2
        events += _drum(t, KICK, 110, PPQ // 8)
    for beat in [PPQ, PPQ * 3]:
        events += _drum(bar_offset + beat, SNARE, 100)
    if is_fill:
        for e in range(8):
            t = bar_offset + PPQ * 2 + e * PPQ // 4
            events += _drum(t, SNARE, 100, PPQ // 8)
    return events


def groove_rnb(bar_offset: int, is_fill: bool) -> list[tuple]:
    events = []
    # 16th hihat with ghost notes
    for s in range(16):
        t = bar_offset + s * PPQ // 4
        vel = 65 if s % 4 == 0 else 30
        events += _drum(t, HIHAT, vel, PPQ // 8)
    # syncopated kick: beat 1, beat 2.5, beat 3, beat 4.5 (16th before 1 of next)
    for t, vel in [(0, 100), (PPQ + PPQ//2, 85), (PPQ*2, 90)]:
        events += _drum(bar_offset + t, KICK, vel)
    # snare 2 & 4
    for beat in [PPQ, PPQ * 3]:
        events += _drum(bar_offset + beat, SNARE, 92)
    # ghost snare on 16th off-beats
    for s in [2, 6, 10, 14]:
        events += _drum(bar_offset + s * PPQ // 4, SNARE, 28, PPQ // 8)
    if is_fill:
        for e in range(4):
            t = bar_offset + PPQ * 3 + e * PPQ // 4
            events += _drum(t, SNARE, 75 + e * 5, PPQ // 8)
    return events


def groove_funk(bar_offset: int, is_fill: bool) -> list[tuple]:
    events = []
    # 16th hihat
    for s in range(16):
        t = bar_offset + s * PPQ // 4
        vel = 70 if s % 2 == 0 else 40
        events += _drum(t, HIHAT, vel, PPQ // 8)
    # classic funk kick: beat 1, and 16th before beat 3
    for t, vel in [(0, 105), (PPQ*2 - PPQ//4, 85), (PPQ*2, 90)]:
        events += _drum(bar_offset + t, KICK, vel)
    # snare 2 & 4, ghost notes
    for beat in [PPQ, PPQ * 3]:
        events += _drum(bar_offset + beat, SNARE, 95)
    for s in [3, 7, 11]:
        events += _drum(bar_offset + s * PPQ // 4, SNARE, 25, PPQ // 8)
    if is_fill:
        for e in range(6):
            t = bar_offset + PPQ * 3 - PPQ // 4 + e * PPQ // 8
            events += _drum(t, SNARE, 80, PPQ // 8)
    return events


def groove_bossa(bar_offset: int, is_fill: bool) -> list[tuple]:
    # rim shot pattern + kick on 1 and "and of 2"
    events = []
    # classic bossa rim pattern (16th grid positions: 0,3,6,9,12)
    for s in [0, 3, 6, 9, 12]:
        t = bar_offset + s * PPQ // 4
        events += _drum(t, RIM, 65, PPQ // 8)
    for t, note, vel in [(0, KICK, 85), (PPQ + PPQ//2, KICK, 75)]:
        events += _drum(bar_offset + t, note, vel)
    # hi-hat on beat 2 & 4
    for beat in [PPQ, PPQ * 3]:
        events += _drum(bar_offset + beat, HIHAT, 50)
    if is_fill:
        events += _drum(bar_offset + PPQ * 3 + PPQ // 2, RIM, 80)
    return events


GROOVE_FN = {
    "pop":     groove_pop,
    "shuffle": groove_shuffle,
    "blues":   groove_shuffle,   # blues uses shuffle feel
    "ballad":  groove_ballad,
    "rock":    groove_rock,
    "metal":   groove_metal,
    "rnb":     groove_rnb,
    "funk":    groove_funk,
    "bossa":   groove_bossa,
}

# piano voicing style per style-group
PIANO_STYLE = {
    "pop":     "block",
    "shuffle": "block",
    "blues":   "block",
    "ballad":  "block",   # could be arpeggio later
    "rock":    "block",
    "metal":   "block",
    "rnb":     "block",
    "funk":    "block",
    "bossa":   "block",
}

# 12-bar blues progression in A
BLUES_12_BAR = ["A7", "A7", "A7", "A7", "D7", "D7", "A7", "A7", "E7", "D7", "A7", "E7"]


# --- humanize ---

def humanize(tick: int, velocity: int, tick_jitter: int = 8, vel_jitter: int = 8) -> tuple[int, int]:
    t = max(0, tick + random.randint(-tick_jitter, tick_jitter))
    v = max(1, min(127, velocity + random.randint(-vel_jitter, vel_jitter)))
    return t, v


# --- event builders ---

def piano_bar_events(chord: str, bar_offset: int) -> list[tuple[int, mido.Message]]:
    events = []
    notes = chord_midi_notes(chord)
    chord_on  = bar_offset
    chord_off = bar_offset + PPQ * 3 + PPQ // 2
    for n in notes:
        t, v = humanize(chord_on, 78)
        events.append((t, mido.Message("note_on",  channel=0, note=n, velocity=v)))
        events.append((chord_off, mido.Message("note_off", channel=0, note=n, velocity=0)))
    return events


def bass_bar_events(chord: str, bar_offset: int) -> list[tuple[int, mido.Message]]:
    events = []
    root = bass_root_midi(chord)
    fifth = root + 7
    for beat_tick, note in [(0, root), (PPQ * 2, fifth)]:
        t, v = humanize(bar_offset + beat_tick, 88)
        events.append((t, mido.Message("note_on",  channel=1, note=note, velocity=v)))
        events.append((t + PPQ - 20, mido.Message("note_off", channel=1, note=note, velocity=0)))
    return events


def drum_bar_events(groove_fn, bar_offset: int, is_fill: bool) -> list[tuple[int, mido.Message]]:
    raw = groove_fn(bar_offset, is_fill)
    events = []
    for abs_tick, ch, note, vel in raw:
        if vel == 0:
            events.append((abs_tick, mido.Message("note_off", channel=ch, note=note, velocity=0)))
        else:
            t, v = humanize(abs_tick, vel, tick_jitter=5, vel_jitter=6)
            events.append((t, mido.Message("note_on", channel=ch, note=note, velocity=v)))
    return events


# --- track builder ---

def build_track(progression: list[str], bpm: int, style: str, fill_every: int = 4) -> mido.MidiTrack:
    groove_fn = GROOVE_FN[style]
    track = mido.MidiTrack()
    track.append(mido.MetaMessage("set_tempo", tempo=int(60_000_000 / bpm), time=0))
    track.append(mido.Message("program_change", channel=1, program=32, time=0))  # Acoustic Bass

    all_events: list[tuple[int, mido.Message]] = []
    total_bars = REPEATS * len(progression)
    for repeat in range(REPEATS):
        for bar_i, chord in enumerate(progression):
            global_bar = repeat * len(progression) + bar_i
            bar_offset = global_bar * TICKS_PER_BAR
            is_fill = (global_bar % fill_every == fill_every - 1) and (global_bar < total_bars - 1)

            all_events += piano_bar_events(chord, bar_offset)
            all_events += bass_bar_events(chord, bar_offset)
            all_events += drum_bar_events(groove_fn, bar_offset, is_fill)

    all_events.sort(key=lambda e: e[0])
    prev_tick = 0
    for abs_tick, msg in all_events:
        delta = max(0, abs_tick - prev_tick)
        track.append(msg.copy(time=delta))
        prev_tick = abs_tick

    return track


# --- CLI ---

def main() -> None:
    parser = argparse.ArgumentParser(description="Generate accompaniment MIDI")
    parser.add_argument("chords", nargs="*", default=["C", "Am", "F", "G"])
    parser.add_argument("--bpm",   type=int, default=120)
    parser.add_argument("--style", choices=list(GROOVE_FN), default="pop")
    parser.add_argument("--bars",  type=int, default=None, help="override REPEATS")
    parser.add_argument("--out",   default=None)
    args = parser.parse_args()

    global REPEATS
    if args.bars:
        REPEATS = args.bars

    progression = BLUES_12_BAR if args.style == "blues" and args.chords == ["C", "Am", "F", "G"] else args.chords

    # validate
    for c in progression:
        try:
            parse_chord(c)
        except ValueError as e:
            parser.error(str(e))

    os.makedirs("output", exist_ok=True)
    name = "_".join(progression[:4]) + ("..." if len(progression) > 4 else "")
    out = args.out or f"output/{name}_{args.style}_{args.bpm}bpm.mid"

    mid = mido.MidiFile(type=0, ticks_per_beat=PPQ)
    mid.tracks.append(build_track(progression, args.bpm, args.style))
    mid.save(out)
    print(f"Saved: {out}  ({REPEATS * len(progression)} bars, {args.bpm} BPM, style={args.style})")


if __name__ == "__main__":
    main()
