"""Generate accompaniment MIDI: piano block chords + bass + drums.

Usage:
    python gen_accompaniment_midi.py                        # 1645, 120 BPM
    python gen_accompaniment_midi.py C Am F G --bpm 90      # custom progression
"""

import argparse
import os

import mido

PPQ = 480
TICKS_PER_BAR = PPQ * 4
REPEATS = 4

# chord -> [piano voicing MIDI notes]
CHORD_NOTES: dict[str, list[int]] = {
    "C":  [60, 64, 67],
    "Am": [57, 60, 64],
    "F":  [53, 57, 60],
    "G":  [55, 59, 62],
    "Dm": [50, 53, 57],
    "Em": [52, 55, 59],
    "E":  [52, 56, 59],
}

# chord -> bass root note (one octave below piano)
BASS_ROOT: dict[str, int] = {
    "C":  36,  # C2
    "Am": 33,  # A1
    "F":  29,  # F1
    "G":  31,  # G1
    "Dm": 26,  # D1
    "Em": 28,  # E1
    "E":  28,
}

KICK  = 36
SNARE = 38
HIHAT = 42


def tempo_from_bpm(bpm: int) -> int:
    return int(60_000_000 / bpm)


def bar_events(chord: str, bar_offset: int) -> list[tuple[int, mido.Message]]:
    events: list[tuple[int, mido.Message]] = []

    # --- piano: block chord on beat 1, release on beat 4 ---
    for n in CHORD_NOTES[chord]:
        events.append((bar_offset,            mido.Message("note_on",  channel=0, note=n, velocity=80)))
        events.append((bar_offset + PPQ * 3,  mido.Message("note_off", channel=0, note=n, velocity=0)))

    # --- bass: root on beat 1, fifth on beat 3 ---
    root = BASS_ROOT[chord]
    fifth = root + 7
    for beat, note in [(0, root), (PPQ * 2, fifth)]:
        t = bar_offset + beat
        events.append((t,            mido.Message("note_on",  channel=1, note=note, velocity=90)))
        events.append((t + PPQ - 10, mido.Message("note_off", channel=1, note=note, velocity=0)))

    # --- drums: kick 1&3, snare 2&4, hihat every 8th note ---
    for eighth in range(8):
        t = bar_offset + eighth * PPQ // 2
        events.append((t,              mido.Message("note_on",  channel=9, note=HIHAT, velocity=55)))
        events.append((t + PPQ // 4,   mido.Message("note_off", channel=9, note=HIHAT, velocity=0)))

    for beat in range(4):
        t = bar_offset + beat * PPQ
        if beat % 2 == 0:
            events.append((t,            mido.Message("note_on",  channel=9, note=KICK,  velocity=100)))
            events.append((t + PPQ // 4, mido.Message("note_off", channel=9, note=KICK,  velocity=0)))
        else:
            events.append((t,            mido.Message("note_on",  channel=9, note=SNARE, velocity=90)))
            events.append((t + PPQ // 4, mido.Message("note_off", channel=9, note=SNARE, velocity=0)))

    return events


def build_track(progression: list[str], bpm: int) -> mido.MidiTrack:
    track = mido.MidiTrack()
    track.append(mido.MetaMessage("set_tempo", tempo=tempo_from_bpm(bpm), time=0))
    # GM bass program: Acoustic Bass = program 32
    track.append(mido.Message("program_change", channel=1, program=32, time=0))

    all_events: list[tuple[int, mido.Message]] = []
    for repeat in range(REPEATS):
        for bar_i, chord in enumerate(progression):
            bar_offset = (repeat * len(progression) + bar_i) * TICKS_PER_BAR
            all_events.extend(bar_events(chord, bar_offset))

    all_events.sort(key=lambda e: e[0])

    prev_tick = 0
    for abs_tick, msg in all_events:
        delta = abs_tick - prev_tick
        track.append(msg.copy(time=delta))
        prev_tick = abs_tick

    return track


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("chords", nargs="*", default=["C", "Am", "F", "G"])
    parser.add_argument("--bpm", type=int, default=120)
    parser.add_argument("--out", default=None)
    args = parser.parse_args()

    progression = args.chords
    unknown = [c for c in progression if c not in CHORD_NOTES]
    if unknown:
        parser.error(f"Unknown chords: {unknown}. Available: {list(CHORD_NOTES)}")

    os.makedirs("output", exist_ok=True)
    name = "_".join(progression)
    out = args.out or f"output/{name}_{args.bpm}bpm.mid"

    mid = mido.MidiFile(type=0, ticks_per_beat=PPQ)
    mid.tracks.append(build_track(progression, args.bpm))
    mid.save(out)
    total_bars = REPEATS * len(progression)
    print(f"Saved: {out}  ({total_bars} bars, {args.bpm} BPM, chords: {progression})")


if __name__ == "__main__":
    main()
