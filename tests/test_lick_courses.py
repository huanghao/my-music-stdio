"""Course metadata must survive legacy note edits and independent practice saves."""
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    from src import server
    monkeypatch.setattr(server, "_licks_dir", lambda: tmp_path)
    return TestClient(server.app)


def test_course_roundtrip_and_old_editor_preserves_metadata(client):
    lick = client.post('/api/licks', json={
        'title': 'Course 01', 'collection': 'Picking', 'course_order': 1,
        'tags': ['跨弦'], 'status': 'waiting',
        'practice_plan': {'start_bpm': 80, 'loop_bars': 8, 'rounds_per_step': 3},
        'score_images': ['/api/materials/score.png'], 'target_bpm': 100,
    }).json()
    key = lick['id']
    assert client.post(f'/api/licks/{key}/sessions', json={'bpm': 85, 'duration_min': 2}).status_code == 200
    # Existing resize/notes clients do not know about course fields.
    saved = client.put(f'/api/licks/{key}', json={'title': 'Renamed', 'notes': 'Resized', 'target_bpm': 110}).json()
    assert saved['practice_plan']['loop_bars'] == 8
    assert saved['collection'] == 'Picking'
    assert saved['score_images'] == ['/api/materials/score.png']
    assert len(saved['sessions']) == 1
    summary = client.get('/api/licks').json()[0]
    assert summary['course_order'] == 1
    assert summary['session_count'] == 1
    assert 'sessions' not in summary


def test_training_save_does_not_replace_history_or_notes(client):
    key = client.post('/api/licks', json={'title': 'Lick', 'notes': 'Keep', 'target_bpm': 100}).json()['id']
    client.post(f'/api/licks/{key}/sessions', json={'bpm': 75, 'duration_min': 1})
    client.post(f'/api/licks/{key}/bpm', json={'bpm': 82})
    saved = client.put(f'/api/licks/{key}/practice-plan', json={
        'practice_plan': {'start_bpm': 70, 'loop_bars': 4, 'rounds_per_step': 2, 'subdivision': 3},
        'target_bpm': 120,
    }).json()
    assert saved['notes'] == 'Keep'
    assert len(saved['sessions']) == 1
    assert saved['last_practiced_bpm'] == 82
    assert saved['target_bpm'] == 120
    assert saved['practice_plan']['subdivision'] == 3


@pytest.mark.parametrize('payload', [
    {'status': 'done'}, {'practice_plan': {'loop_bars': 0}},
    {'practice_plan': {'subdivision': 5}}, {'course_order': -1},
    {'score_images': ['javascript:alert(1)']}, {'pdf_url': 'file:///etc/passwd'},
])
def test_invalid_course_fields_rejected(client, payload):
    assert client.post('/api/licks', json={'title': 'Invalid', **payload}).status_code == 422


def test_independent_lessons_keep_separate_training_state(client):
    a = client.post('/api/licks', json={'title': 'A', 'collection': 'C'}).json()['id']
    b = client.post('/api/licks', json={'title': 'B', 'collection': 'C'}).json()['id']
    client.put(f'/api/licks/{a}/practice-plan', json={'practice_plan': {'start_bpm': 95}, 'target_bpm': 120})
    other = client.get(f'/api/licks/{b}').json()
    assert other['practice_plan'] is None
    assert other['target_bpm'] is None


def test_concurrent_training_and_sessions_do_not_lose_history(client):
    key = client.post('/api/licks', json={'title': 'Concurrent'}).json()['id']

    def save(i):
        if i % 2:
            return client.post(f'/api/licks/{key}/sessions', json={'bpm': 80 + i, 'duration_min': 1})
        return client.put(f'/api/licks/{key}/practice-plan', json={'practice_plan': {'start_bpm': 60 + i}, 'target_bpm': 120})

    with ThreadPoolExecutor(max_workers=6) as pool:
        assert all(r.status_code == 200 for r in pool.map(save, range(20)))
    assert len(client.get(f'/api/licks/{key}').json()['sessions']) == 10
