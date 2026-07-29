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


def test_save_state_writes_index_atomically_leaving_no_tmp_file_behind(tmp_path):
    store = make_store(tmp_path)
    record = store.save("song.mp3", b"data")
    store.save_state(record.id, {"bpm": 100})
    index_dir = tmp_path / "materials"
    names = {p.name for p in index_dir.iterdir()}
    assert "_index.json" in names
    assert "_index.json.tmp" not in names  # temp file was renamed away, not left dangling


def test_save_state_survives_a_simulated_crash_mid_write(tmp_path, monkeypatch):
    # If the process dies while writing the temp file, the real _index.json
    # (written via os.replace, all-or-nothing) must still hold the last
    # successfully saved state — not a truncated/corrupted file.
    store = make_store(tmp_path)
    record = store.save("song.mp3", b"data")
    store.save_state(record.id, {"bpm": 100})

    from pathlib import Path
    real_write_text = Path.write_text

    def crash_on_tmp_write(self, *args, **kwargs):
        if self.name.endswith(".tmp"):
            raise OSError("simulated crash mid-write")
        return real_write_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "write_text", crash_on_tmp_write)
    try:
        store.save_state(record.id, {"bpm": 200})
    except OSError:
        pass
    monkeypatch.undo()

    assert store.load_state(record.id) == {"bpm": 100}  # last good save, not corrupted/lost


def test_save_computes_content_hash(tmp_path):
    store = make_store(tmp_path)
    record = store.save("song.mp3", b"some bytes")
    assert record.content_hash
    listed = store.list_all()[0]
    assert listed.content_hash == record.content_hash


def test_find_by_hash_matches_identical_content_uploaded_under_different_names(tmp_path):
    store = make_store(tmp_path)
    a = store.save("original.wav", b"identical content")
    store.save("renamed-copy.wav", b"identical content")
    match = store.find_by_hash(a.content_hash)
    assert match is not None
    assert match.content_hash == a.content_hash


def test_find_by_hash_returns_none_for_unknown_hash(tmp_path):
    store = make_store(tmp_path)
    store.save("song.mp3", b"data")
    assert store.find_by_hash("0" * 64) is None


def test_list_all_backfills_content_hash_for_legacy_entries_and_persists_it(tmp_path):
    # Simulates a material saved before content_hash existed — the index
    # entry has no such key at all.
    store = make_store(tmp_path)
    record = store.save("song.mp3", b"legacy bytes")
    index_path = tmp_path / "materials" / "_index.json"
    index = json.loads(index_path.read_text())
    del index[record.id]["content_hash"]
    index_path.write_text(json.dumps(index))

    listed = store.list_all()
    assert listed[0].content_hash  # backfilled in-memory...
    reloaded = json.loads(index_path.read_text())
    assert reloaded[record.id]["content_hash"]  # ...and persisted, not recomputed every call


def test_rename_changes_filename_but_keeps_id_and_file_untouched(tmp_path):
    store = make_store(tmp_path)
    record = store.save("original.pdf", b"pdf bytes")
    assert store.rename(record.id, "Better Name.pdf") is True

    listed = store.list_all()[0]
    assert listed.filename == "Better Name.pdf"
    assert listed.id == record.id
    assert store.path_for(record.id).read_bytes() == b"pdf bytes"


def test_rename_returns_false_for_unknown_id(tmp_path):
    store = make_store(tmp_path)
    assert store.rename("nope.mp3", "new name") is False


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
