from src.styles import get_all_styles, get_style


def test_get_all_styles_returns_list():
    styles = get_all_styles()
    assert len(styles) >= 9
    assert all("id" in s for s in styles)


def test_get_style_pop():
    s = get_style("pop")
    assert s["id"] == "pop"
    assert s["bpm_default"] == 120
    assert len(s["default_progression"]) == 4
    assert s["default_progression"][0]["chords"][0]["name"] == "C"
    assert s["default_progression"][0]["chords"][0]["beats"] == 4


def test_get_style_blues_has_12_bars():
    s = get_style("blues")
    assert len(s["default_progression"]) == 12


def test_get_style_unknown_raises():
    import pytest
    with pytest.raises(KeyError):
        get_style("nonexistent")


def test_all_styles_have_required_fields():
    required = {"id", "name", "bpm_default", "bpm_range", "default_key", "default_progression"}
    for s in get_all_styles():
        assert required <= s.keys(), f"{s['id']} missing fields"
