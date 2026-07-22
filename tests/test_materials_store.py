import json

from src.materials_store import LocalFlatMaterialsStore


def make_store(tmp_path):
    return LocalFlatMaterialsStore(lambda: tmp_path / "materials")


def test_save_then_path_for_round_trips_content(tmp_path):
    store = make_store(tmp_path)
    record = store.save("song.mp3", b"fake mp3 bytes")
    assert record.filename == "song.mp3"
    assert record.size == len(b"fake mp3 bytes")

    p = store.path_for(record.id)
    assert p is not None
    assert p.read_bytes() == b"fake mp3 bytes"


def test_list_all_sorts_by_uploaded_at_descending(tmp_path):
    store = make_store(tmp_path)
    a = store.save("a.mp3", b"a")
    b = store.save("b.mp3", b"b")
    listed = store.list_all()
    assert [r.id for r in listed] == [b.id, a.id]


def test_delete_removes_file_and_index_entry(tmp_path):
    store = make_store(tmp_path)
    record = store.save("song.mp3", b"data")
    assert store.delete(record.id) is True
    assert store.path_for(record.id) is None
    assert store.delete(record.id) is False  # already gone


def test_list_all_skips_stale_index_entries_whose_file_is_missing(tmp_path):
    store = make_store(tmp_path)
    record = store.save("song.mp3", b"data")
    # simulate the file being removed out-of-band, leaving the index stale
    store.path_for(record.id).unlink()
    assert store.list_all() == []


def test_path_for_and_delete_reject_path_traversal_ids(tmp_path):
    store = make_store(tmp_path)
    assert store.path_for("../../etc/passwd") is None
    assert store.delete("../../etc/passwd") is False


def test_save_state_then_load_state_round_trips(tmp_path):
    store = make_store(tmp_path)
    record = store.save("song.mp3", b"data")
    assert store.load_state(record.id) is None  # nothing saved yet

    state = {"bpm": 120, "loopFromBar": 5, "annotations": {"1": {"chord": "C"}}}
    assert store.save_state(record.id, state) is True
    assert store.load_state(record.id) == state


def test_save_state_and_load_state_return_false_and_none_for_unknown_id(tmp_path):
    store = make_store(tmp_path)
    assert store.save_state("nope.mp3", {"bpm": 100}) is False
    assert store.load_state("nope.mp3") is None


def test_list_all_tolerates_index_entries_without_a_state_key(tmp_path):
    # Index entries written before this feature existed have no "state" key.
    store = make_store(tmp_path)
    record = store.save("song.mp3", b"data")
    index_path = tmp_path / "materials" / "_index.json"
    index = json.loads(index_path.read_text())
    assert "state" not in index[record.id]  # sanity check on the fixture itself
    listed = store.list_all()
    assert listed[0].state is None


def test_root_dir_is_read_lazily_on_every_call(tmp_path):
    # root_dir_fn is a callable, not a fixed Path, so changing what it
    # returns (e.g. materials_dir changing via Preferences) takes effect
    # without recreating the store.
    calls = {"dir": tmp_path / "first"}
    store = LocalFlatMaterialsStore(lambda: calls["dir"])
    record = store.save("a.mp3", b"a")
    assert (calls["dir"] / record.id).exists()

    calls["dir"] = tmp_path / "second"
    assert store.path_for(record.id) is None  # not visible from the new dir
    record2 = store.save("b.mp3", b"b")
    assert (calls["dir"] / record2.id).exists()
