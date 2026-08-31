from dataclasses import dataclass, field


DRUM_NOTES = {
    "crash": 49,
    "kick": 36,
    "snare": 38,
    "hihat": 42,
    "hihat_open": 46,
}


@dataclass(frozen=True)
class DrumHitRule:
    instrument: str
    slots: tuple[int, ...]
    velocity: int
    duration_slots: float = 1.0


@dataclass(frozen=True)
class DrumPatternFamily:
    grid_slots: int
    required: tuple[DrumHitRule, ...]
    optional_by_role: dict[str, tuple[DrumHitRule, ...]] = field(default_factory=dict)


@dataclass(frozen=True)
class BassHitRule:
    slot: int
    degree: str
    velocity: int
    duration_slots: float = 3.5


@dataclass(frozen=True)
class BassPatternFamily:
    grid_slots: int
    by_role: dict[str, tuple[BassHitRule, ...]]


@dataclass(frozen=True)
class PianoHitRule:
    slot: int
    voicing: str
    velocity: int
    duration_slots: float = 2.0


@dataclass(frozen=True)
class PianoPatternFamily:
    grid_slots: int
    by_role: dict[str, tuple[PianoHitRule, ...]]


@dataclass(frozen=True)
class StyleProfile:
    id: str
    feel: str
    tempo_range: tuple[int, int]
    energy: str
    density: str
    groove_anchor: str
    forbidden_traits: tuple[str, ...] = ()


@dataclass(frozen=True)
class StylePattern:
    profile: StyleProfile
    drums: DrumPatternFamily | None = None
    bass: BassPatternFamily | None = None
    piano: PianoPatternFamily | None = None


POP_DRUMS = DrumPatternFamily(
    grid_slots=16,
    required=(
        DrumHitRule("kick", (0,), 100),
        DrumHitRule("snare", (4,), 90),
        DrumHitRule("snare", (12,), 88),
        DrumHitRule("hihat", (0, 4, 8, 12), 66),
        DrumHitRule("hihat", (2, 6, 10, 14), 46),
    ),
    optional_by_role={
        "phrase_start": (
            DrumHitRule("kick", (8,), 94),
        ),
        "phrase_middle": (
            DrumHitRule("kick", (6,), 76),
            DrumHitRule("kick", (8,), 94),
            DrumHitRule("kick", (10,), 78),
        ),
        "phrase_end": (
            DrumHitRule("kick", (8,), 94),
            DrumHitRule("kick", (14,), 72, duration_slots=0.5),
            DrumHitRule("snare", (15,), 50, duration_slots=0.5),
            DrumHitRule("hihat_open", (14,), 70, duration_slots=2.0),
        ),
    },
)

BASS_PATTERNS = {
    "pop": BassPatternFamily(
        grid_slots=16,
        by_role={
            "phrase_start": (
                BassHitRule(0, "root", 96, duration_slots=7.5),
                BassHitRule(8, "octave", 82, duration_slots=7.5),
            ),
            "phrase_middle": (
                BassHitRule(0, "root", 96),
                BassHitRule(4, "fifth", 78),
                BassHitRule(8, "octave", 86),
                BassHitRule(12, "fifth", 76),
            ),
            "phrase_end": (
                BassHitRule(0, "root", 96),
                BassHitRule(4, "fifth", 78),
                BassHitRule(8, "root", 84),
                BassHitRule(12, "approach_next", 74),
            ),
        },
    ),
}

PIANO_PATTERNS = {
    "pop": PianoPatternFamily(
        grid_slots=16,
        by_role={
            "phrase_start": (
                PianoHitRule(0, "block", 68, duration_slots=6.0),
                PianoHitRule(8, "block", 62, duration_slots=6.0),
            ),
            "phrase_middle": (
                PianoHitRule(4, "stab", 78, duration_slots=2.0),
                PianoHitRule(10, "stab", 66, duration_slots=2.0),
                PianoHitRule(12, "stab", 70, duration_slots=2.0),
            ),
            "phrase_end": (
                PianoHitRule(0, "block", 66, duration_slots=4.0),
                PianoHitRule(8, "stab", 72, duration_slots=2.0),
                PianoHitRule(14, "stab", 58, duration_slots=1.0),
            ),
        },
    ),
}

POP_STYLE = StylePattern(
    profile=StyleProfile(
        id="pop",
        feel="straight",
        tempo_range=(90, 130),
        energy="medium",
        density="medium",
        groove_anchor="backbeat",
        forbidden_traits=("dense_double_kick", "heavy_crash", "shuffle_triplet"),
    ),
    drums=POP_DRUMS,
    bass=BASS_PATTERNS["pop"],
    piano=PIANO_PATTERNS["pop"],
)

# NOTE: this declarative pattern system is the intended direction for style
# definitions, but pop is a pilot — the other 9 styles (ballad, funk, rnb,
# rock, metal, blues, bossa, jazz, reggae) still live as hardcoded groove
# branches in gen_accompaniment_midi.py (piano_bar_events / bass_bar_events /
# drum_bar_events dispatch here first, then fall through to those branches).
# Deliberate status, not forgotten half-work: migrate a style only when you're
# already touching it, and verify the generated MIDI by ear when you do.
STYLE_PATTERNS = {
    "pop": POP_STYLE,
}

DRUM_PATTERNS = {
    style_id: style.drums
    for style_id, style in STYLE_PATTERNS.items()
    if style.drums is not None
}


def drum_bar_raw_events(
    style: str,
    bar_offset: int,
    bar_role: str,
    ppq: int,
) -> list[tuple[int, int, int, int]]:
    pattern = DRUM_PATTERNS[style]
    rules = list(pattern.required)
    rules.extend(pattern.optional_by_role.get(bar_role, ()))

    events = []
    ticks_per_slot = ppq * 4 // pattern.grid_slots
    for rule in rules:
        note = DRUM_NOTES[rule.instrument]
        duration = max(1, int(ticks_per_slot * rule.duration_slots))
        for slot in rule.slots:
            tick = bar_offset + slot * ticks_per_slot
            events.append((tick, 9, note, rule.velocity))
            events.append((tick + duration, 9, note, 0))
    return events


def bass_rules(style: str, bar_role: str) -> tuple[BassHitRule, ...]:
    pattern = STYLE_PATTERNS[style].bass
    if pattern is None:
        raise KeyError(f"No bass pattern for style: {style}")
    return pattern.by_role.get(bar_role, pattern.by_role["phrase_middle"])


def piano_rules(style: str, bar_role: str) -> tuple[PianoHitRule, ...]:
    pattern = STYLE_PATTERNS[style].piano
    if pattern is None:
        raise KeyError(f"No piano pattern for style: {style}")
    return pattern.by_role.get(bar_role, pattern.by_role["phrase_middle"])
