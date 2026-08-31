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

from src import style_patterns

PPQ = 480
TICKS_PER_BAR = PPQ * 4
DEFAULT_LOOPS = 4

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
    # Qualities the Progressions page's roman-numeral parser can produce
    # (web/progression-lab.js PL_QUALITIES) but that weren't otherwise
    # reachable from the chord toolbar / styles.py — kept in sync with that
    # table so "send progression to Jam" never hits an unparseable chord.
    "madd9": [0, 3, 7, 2],
    "7sus4": [0, 5, 7, 10],
    "9sus4": [0, 5, 7, 10, 14],
    "6/9":   [0, 4, 7, 9, 2],
    "mmaj7": [0, 3, 7, 11],
    "7b9":   [0, 4, 7, 10, 1],
    "7#9":   [0, 4, 7, 10, 3],
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


def _fill_snare_roll(bar_offset: int) -> list[tuple]:
    """Snare 16th crescendo over last beat."""
    events = []
    for i in range(4):
        t = bar_offset + PPQ * 3 + i * PPQ // 4
        events += _drum(t, SNARE, 75 + i * 8, PPQ // 8)
    return events


def _fill_tom_cascade(bar_offset: int) -> list[tuple]:
    """High tom → low tom descending over last 2 beats."""
    events = []
    pattern = [TOM_HI, TOM_HI, TOM_LO, TOM_LO, TOM_LO, SNARE, SNARE, CRASH]
    for i, note in enumerate(pattern):
        t = bar_offset + PPQ * 2 + i * PPQ // 4
        vel = 80 + i * 4
        dur = PPQ // 8 if note != CRASH else PPQ // 2
        events += _drum(t, note, min(vel, 120), dur)
    return events


def _fill_snare_tom_mix(bar_offset: int) -> list[tuple]:
    """Snare + toms mixed, last 2 beats."""
    events = []
    pattern = [(SNARE, 85), (TOM_HI, 80), (SNARE, 90), (TOM_LO, 78),
               (SNARE, 88), (SNARE, 92), (TOM_LO, 85), (CRASH, 100)]
    for i, (note, vel) in enumerate(pattern):
        t = bar_offset + PPQ * 2 + i * PPQ // 4
        dur = PPQ // 8 if note != CRASH else PPQ // 2
        events += _drum(t, note, vel, dur)
    return events


def _fill_half(bar_offset: int) -> list[tuple]:
    """Minimal fill: two snare hits on last beat."""
    events = []
    events += _drum(bar_offset + PPQ * 3 + PPQ // 2, SNARE, 88, PPQ // 8)
    events += _drum(bar_offset + PPQ * 3 + PPQ * 3 // 4, SNARE, 100, PPQ // 8)
    return events


def _pick_fill(style: str, bar_offset: int) -> list[tuple]:
    """Choose fill variant by style, with randomisation."""
    if style == 'ambient':
        return []  # no drums, no fills
    r = random.random()
    if style in ('rock', 'metal'):
        return _fill_tom_cascade(bar_offset) if r < 0.6 else _fill_snare_roll(bar_offset)
    if style in ('funk', 'rnb'):
        return _fill_snare_tom_mix(bar_offset) if r < 0.6 else _fill_half(bar_offset)
    if style in ('ballad',):
        return _fill_half(bar_offset)
    if style in ('shuffle', 'blues'):
        return _fill_snare_tom_mix(bar_offset) if r < 0.4 else _fill_snare_roll(bar_offset)
    # pop, bossa, default
    return _fill_snare_roll(bar_offset) if r < 0.6 else _fill_half(bar_offset)


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
    return events


def groove_ambient(bar_offset: int, is_fill: bool) -> list[tuple]:
    return []  # no drums: sustained pad only


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
    "ambient": groove_ambient,
}

# GM program per style for the piano/pad channel (channel 0); default is Acoustic Grand Piano (0)
PIANO_PROGRAM = {
    "ambient": 89,  # Warm Pad
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

def piano_bar_events(
    chord: str,
    bar_offset: int,
    style: str = "pop",
    bar_role: str = "phrase_middle",
    hold_bars: int = 1,
) -> list[tuple[int, mido.Message]]:
    notes = chord_midi_notes(chord)
    events = []

    def hit(tick: int, vel: int, dur: int = PPQ - 20) -> None:
        t, v = humanize(bar_offset + tick, vel, tick_jitter=6, vel_jitter=8)
        for n in notes:
            events.append((t, mido.Message("note_on",  channel=0, note=n, velocity=v)))
            events.append((t + dur, mido.Message("note_off", channel=0, note=n, velocity=0)))

    # Declarative patterns (style_patterns.py) win when present; the elif
    # branches below are the not-yet-migrated styles. See the note on
    # STYLE_PATTERNS.
    if style in style_patterns.STYLE_PATTERNS and style_patterns.STYLE_PATTERNS[style].piano:
        pattern = style_patterns.STYLE_PATTERNS[style].piano
        ticks_per_slot = PPQ * 4 // pattern.grid_slots
        for rule in style_patterns.piano_rules(style, bar_role):
            hit(
                rule.slot * ticks_per_slot,
                rule.velocity,
                int(rule.duration_slots * ticks_per_slot),
            )
    elif style in ("funk", "rnb"):
        # Staccato stabs on offbeats: beat 2-and, beat 4
        hit(PPQ + PPQ // 2, 88, PPQ // 3)
        hit(PPQ * 3,        75, PPQ // 3)
    elif style in ("ballad",):
        # Sparse: beat 1 long, beat 3 long
        hit(0,       70, PPQ * 2)
        hit(PPQ * 2, 65, PPQ * 2)
    elif style in ("bossa",):
        # Bossa syncopation: beat 1-and, beat 3, beat 4-and
        hit(PPQ // 2,           75, PPQ // 2)
        hit(PPQ * 2,            80, PPQ // 2)
        hit(PPQ * 3 + PPQ // 2, 68, PPQ // 3)
    elif style in ("rock", "metal"):
        # Power chords on every beat, short
        for beat in range(4):
            hit(beat * PPQ, 85 if beat % 2 == 0 else 75, PPQ // 2)
    elif style in ("shuffle", "blues"):
        # Shuffle comping: beat 2, beat 4 (backbeat emphasis)
        hit(PPQ,       85, PPQ - 20)
        hit(PPQ * 3,   80, PPQ - 20)
    elif style in ("ambient",):
        # Sustained pad: one soft hit, held across `hold_bars` bars while the chord repeats
        # (avoids re-triggering the slow pad attack every bar, which sounds like a heartbeat)
        hit(0, 55, PPQ * 4 * hold_bars - 20)
    else:
        # pop default: beat 2 + beat 3-and
        hit(PPQ,                 82)
        hit(PPQ * 2 + PPQ // 2,  68)

    return events


def _bass_context(chord: str, next_chord: str | None = None) -> dict[str, int]:
    root, quality = parse_chord(chord)
    intervals = QUALITY_INTERVALS[quality]

    # beat 4 approach: chromatic step toward next chord's root
    if next_chord:
        next_root, _ = parse_chord(next_chord)
        # normalise to same octave region as root
        while next_root > root + 7:
            next_root -= 12
        while next_root < root - 4:
            next_root += 12
        diff = next_root - root
        # approach from semitone below or above
        approach = next_root - 1 if diff >= 0 else next_root + 1
    else:
        approach = root  # no movement, stay on root

    bass_root = bass_root_midi(chord)

    # map voice-leading notes to bass octave range
    def to_bass(midi_note: int) -> int:
        b = (bass_root // 12) * 12 + (midi_note % 12)
        if b > bass_root + 7:
            b -= 12
        return b

    return {
        "root": bass_root,
        "third": to_bass(root + intervals[1]),
        "fifth": to_bass(root + 7),
        "sixth": to_bass(root + 9),  # walking-blues passing tone (see bass_bar_events shuffle/blues)
        "octave": bass_root + 12,
        "approach_next": to_bass(approach),
    }


def bass_bar_events(
    chord: str,
    bar_offset: int,
    next_chord: str | None = None,
    style: str = "pop",
    bar_role: str = "phrase_middle",
) -> list[tuple[int, mido.Message]]:
    events = []
    bass_notes = _bass_context(chord, next_chord)

    if style in style_patterns.STYLE_PATTERNS and style_patterns.STYLE_PATTERNS[style].bass:
        pattern = style_patterns.STYLE_PATTERNS[style].bass
        ticks_per_slot = PPQ * 4 // pattern.grid_slots
        rules = style_patterns.bass_rules(style, bar_role)
        hits = [
            (
                rule.slot * ticks_per_slot,
                bass_notes[rule.degree],
                rule.velocity,
                int(ticks_per_slot * rule.duration_slots),
            )
            for rule in rules
        ]
    elif style == "ambient":
        hits = []  # pure pad, no bass
    elif style in ("shuffle", "blues"):
        # Walking blues bass (1-3-5-6 walk), swung to the same triplet
        # subdivision as groove_shuffle's hi-hat (TRIPLET*2 = the swung
        # "and"). The old flat-quarter-note fallback played straight against
        # a swung hi-hat, which is what made this style feel rhythmically
        # unstable — locking the bass to the same grid fixes that.
        TRIPLET = PPQ // 3
        SWING_OFF = TRIPLET * 2
        hits = [
            (0,                   bass_notes["root"],   100, SWING_OFF - 10),
            (SWING_OFF,           bass_notes["third"],   70, TRIPLET - 10),
            (PPQ,                 bass_notes["fifth"],   90, SWING_OFF - 10),
            (PPQ + SWING_OFF,     bass_notes["sixth"],   68, TRIPLET - 10),
            (PPQ * 2,             bass_notes["octave"],  88, SWING_OFF - 10),
            (PPQ * 2 + SWING_OFF, bass_notes["sixth"],   66, TRIPLET - 10),
            (PPQ * 3,             bass_notes["fifth"],   85, SWING_OFF - 10),
            (PPQ * 3 + SWING_OFF, bass_notes["approach_next"], 78, TRIPLET - 10),
        ]
    elif style == "rock":
        # Driving eighth-note pumping root, matching groove_rock's kick on
        # the "and" of beat 1 — this is what made rock indistinguishable
        # from pop's plain quarter notes.
        HALF = PPQ // 2
        hits = [
            (0,            bass_notes["root"],          105, HALF - 8),
            (HALF,         bass_notes["root"],            80, HALF - 8),
            (PPQ,          bass_notes["fifth"],            95, HALF - 8),
            (PPQ + HALF,   bass_notes["root"],             78, HALF - 8),
            (PPQ * 2,      bass_notes["root"],            100, HALF - 8),
            (PPQ * 2 + HALF, bass_notes["root"],           80, HALF - 8),
            (PPQ * 3,      bass_notes["fifth"],             90, HALF - 8),
            (PPQ * 3 + HALF, bass_notes["approach_next"],   80, HALF - 8),
        ]
    elif style == "metal":
        # Tight 8th-note root pumping doubling groove_metal's kick-on-every-
        # 8th pattern (a real metal bass locks to the kick, it doesn't amble
        # through chord tones like a ballad bass would).
        HALF = PPQ // 2
        hits = []
        for e in range(8):
            if e == 7:
                note, vel = bass_notes["approach_next"], 85
            elif e == 6:
                note, vel = bass_notes["fifth"], 100
            else:
                note, vel = bass_notes["root"], 112 if e % 2 == 0 else 92
            hits.append((e * HALF, note, vel, HALF - 6))
    elif style == "funk":
        # Syncopated 16ths doubling groove_funk's kick (beat 1, the 16th
        # before beat 3, beat 3) plus a ghost note — a straight quarter-note
        # bass under a syncopated kick is exactly the "fighting the drums"
        # problem this whole pass is fixing.
        Q = PPQ // 4
        hits = [
            (0,                bass_notes["root"],          100, Q - 4),
            (Q * 3,            bass_notes["root"],            35, Q - 6),   # ghost, 16th before beat 2
            (PPQ,              bass_notes["fifth"],           85, Q - 4),
            (PPQ * 2 - Q,      bass_notes["root"],             92, Q - 4),  # syncopated push into beat 3
            (PPQ * 2,          bass_notes["root"],             98, Q - 4),
            (PPQ * 3,          bass_notes["third"],            80, Q - 4),
            (PPQ * 3 + Q * 2,  bass_notes["fifth"],             70, Q - 4),
            (PPQ * 3 + Q * 3,  bass_notes["approach_next"],     75, Q - 4),
        ]
    elif style == "rnb":
        # Smooth syncopation doubling groove_rnb's kick (beat 1, beat 2-and,
        # beat 3) instead of plain quarters.
        Q = PPQ // 4
        hits = [
            (0,             bass_notes["root"],          95, Q * 2 - 6),
            (PPQ,           bass_notes["fifth"],          75, Q * 2 - 6),
            (PPQ + PPQ // 2, bass_notes["root"],           85, Q - 6),
            (PPQ * 2,       bass_notes["third"],          88, Q * 2 - 6),
            (PPQ * 3,       bass_notes["fifth"],          80, Q - 6),
            (PPQ * 3 + Q * 2, bass_notes["approach_next"], 72, Q * 2 - 6),
        ]
    elif style == "ballad":
        # Sparse and sustained, matching piano_bar_events' "beat 1 long,
        # beat 3 long" comping instead of pumping quarters under a ballad.
        hits = [
            (0,       bass_notes["root"],  85, PPQ * 2 - 20),
            (PPQ * 2, bass_notes["fifth"], 72, PPQ * 2 - 20),
        ]
    elif style == "bossa":
        # Two-note tumbao doubling groove_bossa's kick (beat 1, beat 1-and)
        # instead of four even quarters.
        hits = [
            (0,                    bass_notes["root"],  85, PPQ + PPQ // 2 - 15),
            (PPQ + PPQ // 2,       bass_notes["fifth"], 75, PPQ * 2 + PPQ // 2 - 15),
        ]
    else:
        hits = [
            (0,       bass_notes["root"],          95, PPQ - 30),
            (PPQ,     bass_notes["third"],         78, PPQ - 30),
            (PPQ * 2, bass_notes["fifth"],         82, PPQ - 30),
            (PPQ * 3, bass_notes["approach_next"], 72, PPQ - 30),
        ]

    for beat_tick, note, base_vel, dur in hits:
        t, v = humanize(bar_offset + beat_tick, base_vel, tick_jitter=4, vel_jitter=7)
        events.append((t, mido.Message("note_on",  channel=1, note=note, velocity=v)))
        events.append((t + dur, mido.Message("note_off", channel=1, note=note, velocity=0)))
    return events


def _bar_role(global_bar: int, is_fill: bool, fill_every: int) -> str:
    if is_fill:
        return "phrase_end"
    if fill_every > 0 and global_bar % fill_every == 0:
        return "phrase_start"
    return "phrase_middle"


def drum_bar_events(
    groove_fn,
    bar_offset: int,
    is_fill: bool,
    style: str = "pop",
    bar_role: str = "phrase_middle",
) -> list[tuple[int, mido.Message]]:
    if style in style_patterns.DRUM_PATTERNS:  # declarative styles only (pop); others use groove_fn below
        raw = style_patterns.drum_bar_raw_events(style, bar_offset, bar_role, PPQ)
    else:
        raw = groove_fn(bar_offset, False)  # groove functions no longer handle fills
    if is_fill:
        raw = raw + _pick_fill(style, bar_offset)
    events = []
    for abs_tick, ch, note, vel in raw:
        if vel == 0:
            events.append((abs_tick, mido.Message("note_off", channel=ch, note=note, velocity=0)))
        else:
            t, v = humanize(abs_tick, vel, tick_jitter=5, vel_jitter=6)
            events.append((t, mido.Message("note_on", channel=ch, note=note, velocity=v)))
    return events


# --- track builder ---

def build_track(
    progression: list[str],
    bpm: int,
    style: str,
    fill_every: int = 4,
    loops: int = DEFAULT_LOOPS,
) -> mido.MidiTrack:
    groove_fn = GROOVE_FN[style]
    track = mido.MidiTrack()
    track.append(mido.MetaMessage("set_tempo", tempo=int(60_000_000 / bpm), time=0))
    track.append(mido.Message("program_change", channel=1, program=32, time=0))  # Acoustic Bass
    piano_program = PIANO_PROGRAM.get(style)
    if piano_program is not None:
        track.append(mido.Message("program_change", channel=0, program=piano_program, time=0))

    all_events: list[tuple[int, mido.Message]] = []
    total_bars = loops * len(progression)
    flat = progression * loops  # all bars in order

    # ambient: hold the pad across consecutive repeated bars instead of
    # re-triggering every bar (re-triggering restarts the pad's slow attack,
    # which produces an audible pulse in sync with the bar length)
    hold_bars_at_start: dict[int, int] = {}
    if style == "ambient":
        bar = 0
        while bar < total_bars:
            run_end = bar
            while run_end + 1 < total_bars and flat[run_end + 1] == flat[bar]:
                run_end += 1
            hold_bars_at_start[bar] = run_end - bar + 1
            bar = run_end + 1

    for global_bar, chord in enumerate(flat):
        bar_offset = global_bar * TICKS_PER_BAR
        is_fill = (global_bar % fill_every == fill_every - 1) and (global_bar < total_bars - 1)
        bar_role = _bar_role(global_bar, is_fill, fill_every)
        next_chord = flat[global_bar + 1] if global_bar + 1 < total_bars else None

        if style == "ambient":
            if global_bar in hold_bars_at_start:
                all_events += piano_bar_events(
                    chord, bar_offset, style, bar_role, hold_bars=hold_bars_at_start[global_bar]
                )
        else:
            all_events += piano_bar_events(chord, bar_offset, style, bar_role)
        all_events += bass_bar_events(chord, bar_offset, next_chord, style, bar_role)
        all_events += drum_bar_events(groove_fn, bar_offset, is_fill, style, bar_role)

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
    parser.add_argument("--bars",  type=int, default=DEFAULT_LOOPS, help="loop count")
    parser.add_argument("--out",   default=None)
    args = parser.parse_args()

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
    mid.tracks.append(build_track(progression, args.bpm, args.style, loops=args.bars))
    mid.save(out)
    print(f"Saved: {out}  ({args.bars * len(progression)} bars, {args.bpm} BPM, style={args.style})")


if __name__ == "__main__":
    main()
