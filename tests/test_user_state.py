import pytest


@pytest.fixture(autouse=True)
def isolated_data_dir(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    from importlib import reload
    import src.data_dir as data_dir
    import src.user_state as user_state
    reload(data_dir)
    reload(user_state)
    yield user_state


def test_get_missing_key_returns_none(isolated_data_dir):
    assert isolated_data_dir.get("dd_stats") is None


def test_set_then_get_roundtrip(isolated_data_dir):
    isolated_data_dir.set("dd_stats", {"C": {"correct": 3, "total": 5}})
    assert isolated_data_dir.get("dd_stats") == {"C": {"correct": 3, "total": 5}}


def test_set_preserves_other_keys(isolated_data_dir):
    isolated_data_dir.set("dd_stats", {"a": 1})
    isolated_data_dir.set("licks_order", ["lick1", "lick2"])
    assert isolated_data_dir.get("dd_stats") == {"a": 1}
    assert isolated_data_dir.get("licks_order") == ["lick1", "lick2"]


def test_pt_blocks_roundtrip(isolated_data_dir):
    blocks = [{"durationSec": 300, "completedAt": "2026-09-07T12:00:00.000Z", "context": None}]
    isolated_data_dir.set("pt_blocks", blocks)
    assert isolated_data_dir.get("pt_blocks") == blocks
