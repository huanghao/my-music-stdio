from typing import Any


def _bar(chords: list[tuple[str, int]]) -> dict:
    return {"chords": [{"name": n, "beats": b} for n, b in chords]}


STYLES: list[dict[str, Any]] = [
    {
        "id": "pop", "name": "Pop", "tags": ["流行"],
        "bpm_range": [90, 130], "bpm_default": 120,
        "time_signature": "4/4", "feel": "straight", "default_key": "C",
        "default_progression": [_bar([("C", 4)]), _bar([("Am", 4)]), _bar([("F", 4)]), _bar([("G", 4)])],
        "parts": {"drums": "groove_pop", "bass": "root_fifth", "piano": "block_chord"},
        "reference_songs": ["周杰伦《七里香》", "Ed Sheeran《Shape of You》"],
    },
    {
        "id": "ballad", "name": "Ballad", "tags": ["抒情"],
        "bpm_range": [60, 80], "bpm_default": 70,
        "time_signature": "4/4", "feel": "straight", "default_key": "C",
        "default_progression": [_bar([("Cmaj7", 4)]), _bar([("Am7", 4)]), _bar([("Fmaj7", 4)]), _bar([("G7", 4)])],
        "parts": {"drums": "groove_ballad", "bass": "root_fifth", "piano": "block_chord"},
        "reference_songs": ["Adele《Someone Like You》", "张学友《吻别》"],
    },
    {
        "id": "shuffle", "name": "Shuffle", "tags": ["蓝调"],
        "bpm_range": [80, 130], "bpm_default": 110,
        "time_signature": "4/4", "feel": "shuffle", "default_key": "G",
        "default_progression": [_bar([("G7", 4)]), _bar([("C7", 4)]), _bar([("G7", 4)]), _bar([("D7", 4)])],
        "parts": {"drums": "groove_shuffle", "bass": "root_fifth", "piano": "block_chord"},
        "reference_songs": ["Stevie Ray Vaughan《Pride and Joy》"],
    },
    {
        "id": "blues", "name": "Blues", "tags": ["蓝调"],
        "bpm_range": [70, 130], "bpm_default": 90,
        "time_signature": "4/4", "feel": "shuffle", "default_key": "A",
        "default_progression": [
            _bar([("A7", 4)]), _bar([("A7", 4)]), _bar([("A7", 4)]), _bar([("A7", 4)]),
            _bar([("D7", 4)]), _bar([("D7", 4)]), _bar([("A7", 4)]), _bar([("A7", 4)]),
            _bar([("E7", 4)]), _bar([("D7", 4)]), _bar([("A7", 4)]), _bar([("E7", 4)]),
        ],
        "parts": {"drums": "groove_shuffle", "bass": "root_fifth", "piano": "block_chord"},
        "reference_songs": ["B.B. King《The Thrill Is Gone》"],
    },
    {
        "id": "rock", "name": "Rock", "tags": ["摇滚"],
        "bpm_range": [110, 160], "bpm_default": 135,
        "time_signature": "4/4", "feel": "straight", "default_key": "E",
        "default_progression": [_bar([("E", 4)]), _bar([("D", 4)]), _bar([("A", 4)]), _bar([("E", 4)])],
        "parts": {"drums": "groove_rock", "bass": "root_fifth", "piano": "block_chord"},
        "reference_songs": ["AC/DC《Back in Black》", "Nirvana《Smells Like Teen Spirit》"],
    },
    {
        "id": "metal", "name": "Metal", "tags": ["金属"],
        "bpm_range": [140, 220], "bpm_default": 160,
        "time_signature": "4/4", "feel": "straight", "default_key": "E",
        "default_progression": [_bar([("Em", 4)]), _bar([("Em", 4)]), _bar([("C", 4)]), _bar([("D", 4)])],
        "parts": {"drums": "groove_metal", "bass": "root_fifth", "piano": "block_chord"},
        "reference_songs": ["Metallica《Enter Sandman》"],
    },
    {
        "id": "rnb", "name": "R&B", "tags": ["节奏蓝调"],
        "bpm_range": [65, 100], "bpm_default": 90,
        "time_signature": "4/4", "feel": "straight", "default_key": "C",
        "default_progression": [_bar([("Cm7", 4)]), _bar([("Fm7", 4)]), _bar([("Cm7", 4)]), _bar([("Fm7", 4)])],
        "parts": {"drums": "groove_rnb", "bass": "root_fifth", "piano": "block_chord"},
        "reference_songs": ["Stevie Wonder《Superstition》"],
    },
    {
        "id": "funk", "name": "Funk", "tags": ["放克"],
        "bpm_range": [90, 115], "bpm_default": 100,
        "time_signature": "4/4", "feel": "straight", "default_key": "A",
        "default_progression": [_bar([("Am7", 4)]), _bar([("Am7", 4)]), _bar([("D7", 4)]), _bar([("D7", 4)])],
        "parts": {"drums": "groove_funk", "bass": "root_fifth", "piano": "block_chord"},
        "reference_songs": ["James Brown《Sex Machine》"],
    },
    {
        "id": "bossa", "name": "Bossa Nova", "tags": ["巴萨诺瓦"],
        "bpm_range": [120, 160], "bpm_default": 130,
        "time_signature": "4/4", "feel": "straight", "default_key": "C",
        "default_progression": [_bar([("Cmaj7", 4)]), _bar([("Am7", 4)]), _bar([("Dm7", 4)]), _bar([("G7", 4)])],
        "parts": {"drums": "groove_bossa", "bass": "root_fifth", "piano": "block_chord"},
        "reference_songs": ["João Gilberto《The Girl from Ipanema》"],
    },
]

_INDEX = {s["id"]: s for s in STYLES}


def get_all_styles() -> list[dict]:
    return STYLES


def get_style(style_id: str) -> dict:
    return _INDEX[style_id]
