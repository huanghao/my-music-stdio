"""Real-time FluidSynth playback demo using LiveSynth.

Plays a chord progression with piano block chords, bass root, and a pop drum groove.
Reuses chord parsing from gen_accompaniment_midi.

Usage:
    python src/demo_fluidsynth.py
    python src/demo_fluidsynth.py C Am F G --bpm 90
    python src/demo_fluidsynth.py --sf ~/music-practice/soundfonts/MuseScore_General.sf3
    python src/demo_fluidsynth.py --compare   # both SoundFonts back to back
"""

import argparse
import time

from gen_accompaniment_midi import chord_midi_notes, bass_root_midi
from player import LiveSynth, DEFAULT_SOUNDFONT

SOUNDFONTS = {
    "timbres":   DEFAULT_SOUNDFONT,
    "musescore": "~/music-practice/soundfonts/MuseScore_General.sf3",
}

# GM preset numbers
GM_PIANO = 0
GM_BASS  = 32

# GM drum note numbers (channel 9)
KICK    = 36
SNARE   = 38
HIHAT_C = 42

# Pop groove: 1 = hit, 0 = rest, 16 slots per bar (16th notes)
GROOVE = {
    KICK:    [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    SNARE:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    HIHAT_C: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
}


def play_progression(progression: list[str], bpm: int, sf_path: str, repeats: int) -> None:
    sixteenth = (60.0 / bpm) / 4

    with LiveSynth(soundfont=sf_path) as synth:
        synth.program_select(0, 0, GM_PIANO)
        synth.program_select(1, 0, GM_BASS)
        # channel 9 is drums by GM standard; no program_select needed

        for _ in range(repeats):
            for chord in progression:
                notes = chord_midi_notes(chord)
                bass  = bass_root_midi(chord)

                synth.noteon(0, notes[0], 80)
                for n in notes:
                    synth.noteon(0, n, 80)
                synth.noteon(1, bass, 90)

                for i in range(16):
                    # new chord on every beat (every 4 sixteenth notes)
                    if i > 0 and i % 4 == 0:
                        for n in notes:
                            synth.noteoff(0, n)
                        synth.noteoff(1, bass)
                        synth.noteon(0, notes[0], 80)
                        for n in notes:
                            synth.noteon(0, n, 80)
                        synth.noteon(1, bass, 90)

                    for drum_note, pattern in GROOVE.items():
                        if pattern[i]:
                            vel = 100 if drum_note == SNARE else 85
                            synth.noteon(9, drum_note, vel)

                    time.sleep(sixteenth)

                    for drum_note, pattern in GROOVE.items():
                        if pattern[i]:
                            synth.noteoff(9, drum_note)

                for n in notes:
                    synth.noteoff(0, n)
                synth.noteoff(1, bass)


def main() -> None:
    parser = argparse.ArgumentParser(description="FluidSynth live playback demo")
    parser.add_argument("chords", nargs="*", default=["C", "Am", "F", "G"])
    parser.add_argument("--bpm",     type=int, default=90)
    parser.add_argument("--repeats", type=int, default=2)
    parser.add_argument("--sf",      default=None, help="Path to SoundFont file")
    parser.add_argument("--compare", action="store_true",
                        help="Play with MuseScore SF3 then Timbres of Heaven back to back")
    args = parser.parse_args()

    if args.compare:
        for label, sf in [("MuseScore_General", SOUNDFONTS["musescore"]),
                          ("Timbres of Heaven", SOUNDFONTS["timbres"])]:
            print(f"▶ {label}  {' - '.join(args.chords)}  BPM={args.bpm}")
            play_progression(args.chords, args.bpm, sf, repeats=1)
            time.sleep(1.5)
    else:
        sf = args.sf or SOUNDFONTS["timbres"]
        print(f"▶ {' - '.join(args.chords)}  BPM={args.bpm}")
        play_progression(args.chords, args.bpm, sf, repeats=args.repeats)


if __name__ == "__main__":
    main()
