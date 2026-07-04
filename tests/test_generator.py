import pytest

from src import gen_accompaniment_midi as gen
from src import style_patterns


def _musical_message_count(track):
    return sum(1 for msg in track if not msg.is_meta and msg.type != "program_change")


def test_build_track_uses_explicit_loops():
    progression = ["C", "Am"]

    one_loop = gen.build_track(progression, 120, "rock", fill_every=999, loops=1)
    three_loops = gen.build_track(progression, 120, "rock", fill_every=999, loops=3)

    assert _musical_message_count(three_loops) == _musical_message_count(one_loop) * 3


def test_default_loop_count_is_stable():
    progression = ["C"]

    default_track = gen.build_track(progression, 120, "rock", fill_every=999)
    explicit_track = gen.build_track(
        progression,
        120,
        "rock",
        fill_every=999,
        loops=gen.DEFAULT_LOOPS,
    )

    assert _musical_message_count(default_track) == _musical_message_count(explicit_track)


def _drum_note_on_events(raw_events):
    return [(tick, note, velocity) for tick, _ch, note, velocity in raw_events if velocity]


def test_pop_drum_pattern_has_required_backbeat_anchors():
    raw = style_patterns.drum_bar_raw_events(
        "pop",
        bar_offset=0,
        bar_role="phrase_start",
        ppq=gen.PPQ,
    )

    events = _drum_note_on_events(raw)

    assert (0, gen.KICK, 100) in events
    assert (gen.PPQ, gen.SNARE, 90) in events
    assert (gen.PPQ * 3, gen.SNARE, 88) in events


def test_pop_drum_pattern_changes_by_bar_role_without_randomness():
    start = style_patterns.drum_bar_raw_events("pop", 0, "phrase_start", gen.PPQ)
    middle = style_patterns.drum_bar_raw_events("pop", 0, "phrase_middle", gen.PPQ)
    end = style_patterns.drum_bar_raw_events("pop", 0, "phrase_end", gen.PPQ)

    assert start == style_patterns.drum_bar_raw_events(
        "pop",
        0,
        "phrase_start",
        gen.PPQ,
    )
    assert len(_drum_note_on_events(start)) < len(_drum_note_on_events(middle))
    assert (gen.PPQ + gen.PPQ // 2, gen.KICK, 76) in _drum_note_on_events(middle)
    assert (gen.PPQ * 3 + gen.PPQ // 2, gen.KICK, 72) in _drum_note_on_events(end)
    assert (gen.PPQ * 3 + gen.PPQ // 2, gen.HIHAT_OPEN, 70) in _drum_note_on_events(end)


def test_pop_bass_rules_change_by_bar_role():
    start = style_patterns.bass_rules("pop", "phrase_start")
    middle = style_patterns.bass_rules("pop", "phrase_middle")
    end = style_patterns.bass_rules("pop", "phrase_end")

    assert [rule.degree for rule in start] == ["root", "octave"]
    assert [rule.degree for rule in middle] == ["root", "fifth", "octave", "fifth"]
    assert [rule.degree for rule in end] == ["root", "fifth", "root", "approach_next"]


def test_bass_context_resolves_relative_notes():
    notes = gen._bass_context("C", "Am")

    assert notes["root"] == 36
    assert notes["fifth"] == 43
    assert notes["octave"] == 48
    assert notes["approach_next"] != notes["root"]


def test_pop_piano_rules_change_by_bar_role():
    start = style_patterns.piano_rules("pop", "phrase_start")
    middle = style_patterns.piano_rules("pop", "phrase_middle")
    end = style_patterns.piano_rules("pop", "phrase_end")

    assert [(rule.slot, rule.voicing) for rule in start] == [(0, "block"), (8, "block")]
    assert [(rule.slot, rule.voicing) for rule in middle] == [
        (4, "stab"),
        (10, "stab"),
        (12, "stab"),
    ]
    assert [(rule.slot, rule.voicing) for rule in end] == [
        (0, "block"),
        (8, "stab"),
        (14, "stab"),
    ]


def test_pop_style_profile_groups_all_pattern_parts():
    pop = style_patterns.STYLE_PATTERNS["pop"]

    assert pop.profile.feel == "straight"
    assert pop.profile.groove_anchor == "backbeat"
    assert "shuffle_triplet" in pop.profile.forbidden_traits
    assert pop.drums is style_patterns.POP_DRUMS
    assert pop.bass is style_patterns.BASS_PATTERNS["pop"]
    assert pop.piano is style_patterns.PIANO_PATTERNS["pop"]


def test_bass_rules_raises_for_style_missing_bass_pattern():
    style_patterns.STYLE_PATTERNS["_no_bass"] = style_patterns.StylePattern(
        profile=style_patterns.StyleProfile(
            id="_no_bass",
            feel="straight",
            tempo_range=(90, 130),
            energy="medium",
            density="medium",
            groove_anchor="backbeat",
        ),
    )
    try:
        with pytest.raises(KeyError):
            style_patterns.bass_rules("_no_bass", "phrase_middle")
        with pytest.raises(KeyError):
            style_patterns.piano_rules("_no_bass", "phrase_middle")
    finally:
        del style_patterns.STYLE_PATTERNS["_no_bass"]
