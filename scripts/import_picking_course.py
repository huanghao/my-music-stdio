"""Import the reviewed ten-lesson course through the running local API.

Runtime inputs/outputs stay under my-store; existing lessons are skipped.
Run: .venv/bin/python scripts/import_picking_course.py [--source PATH] [--base-url URL]
"""
import argparse
import hashlib
import json
import mimetypes
import uuid
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

COLLECTION = '交替拨弦提速 · Guitar Speed Trainer'
LESSONS = [
    ('交替拨弦基础', ['交替拨弦', '单弦'], 80, 100, 180, 4, '在同一组指法中切换八分和十六分音符，保持拨片动作幅度一致。'),
    ('单音爆发速度', ['交替拨弦', '单弦', '爆发速度'], 100, 120, 240, 4, '固定第 1 弦第 10 品，交替练习稳定八分音符和短促十六分音符。保留四小节循环。'),
    ('三连音与换把位', ['交替拨弦', '单弦', '三连音'], 60, 80, 160, 8, '先慢速连贯完成两个四小节把位组，再提高速度。注意三连音与更密集节奏的切换。'),
    ('单弦六连音', ['交替拨弦', '单弦', '六连音'], 60, 75, 120, 4, '在单弦上完成四小节六连音音型，保留休止、滑音和结束音，换把时保持节拍。'),
    ('琶音双拨', ['交替拨弦', '跨弦', '琶音', '双拨'], 60, 75, 120, 8, '每个音连续拨两次，完整练习八小节琶音进行。换弦时保持两次拨弦均匀。'),
    ('五声音阶跨弦', ['交替拨弦', '跨弦', '五声音阶'], 60, 80, 145, 8, '连贯完成八小节各把位音型，重点观察跨弦时左右手是否同步。'),
    ('Malmsteen 三连音', ['交替拨弦', '跨弦', '三连音'], 60, 70, 120, 4, '完整练习四小节下行音型，注意三连音分组、跨弦和结束长音。'),
    ('Rock Discipline 半音阶', ['交替拨弦', '跨弦', '半音阶'], 60, 80, 180, 5, '四小节核心音型加一小节结束长音。采用原第 2–4、9–10 小节，保留最后的滑音收束。'),
    ('高低八度跨弦', ['交替拨弦', '跨弦', '三连音'], 60, 75, 120, 4, '高、低八度各练两小节：第一小节含休止，第二小节切换更密集的三连音。去掉各音区内相同的再次重复。'),
    ('三连音跨弦与滑音', ['交替拨弦', '跨弦', '三连音', '滑音'], 100, 120, 200, 4, '完成四小节循环，在跨弦三连音之后准确落到滑音和长音。'),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path.home() / 'workspace/my-store/my-music-stdio-data/video-tabs/speed-lessons')
    parser.add_argument('--base-url', default='http://localhost:3050')
    args = parser.parse_args()
    root = args.source.expanduser().resolve()

    def request(path, method='GET', data=None, headers=None):
        if isinstance(data, dict):
            data = json.dumps(data, ensure_ascii=False).encode()
            headers = {'Content-Type': 'application/json'}
        req = Request(args.base_url.rstrip('/') + path, method=method, data=data, headers=headers or {})
        with urlopen(req, timeout=180) as response:
            return json.load(response)

    materials = {m.get('content_hash'): m for m in request('/api/materials') if m.get('content_hash')}

    def upload(path, filename):
        content = path.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        if digest in materials:
            return materials[digest]['url']
        boundary = 'lick-course-' + uuid.uuid4().hex
        mime = mimetypes.guess_type(filename)[0] or 'application/octet-stream'
        head = f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: {mime}\r\n\r\n'.encode()
        record = request('/api/materials', 'POST', head + content + f'\r\n--{boundary}--\r\n'.encode(), {'Content-Type': 'multipart/form-data; boundary=' + boundary})
        materials[digest] = record
        return record['url']

    playlist = json.loads((root / 'playlist.json').read_text())['entries']
    pdfs = sorted(f for f in (root / 'completed').glob('*.pdf') if f.name[:2].isdigit())
    assert len(pdfs) == 10, 'Expected ten reviewed single-lesson PDFs'
    existing = request('/api/licks')
    # Read all inputs before creating records: missing assets must not yield partial lessons.
    assets = []
    for n, video in enumerate(playlist, 1):
        images = [root / 'compact-row-1.png'] if n == 1 else [root / 'lesson02-core-row.png'] if n == 2 else sorted(root.glob(f'lesson{n:02d}-core-row-*.png'))
        demo = root / 'with-audio' / (video['id'] + '.mp4')
        assert images and all(f.is_file() for f in images) and demo.is_file(), (n, images, demo)
        assets.append((images, demo))
    receipts = []
    for n, (video, lesson, pdf, asset) in enumerate(zip(playlist, LESSONS, pdfs, assets), 1):
        title, tags, start, target, maximum, bars, instruction = lesson
        source = 'https://www.youtube.com/watch?v=' + video['id']
        old = next((l for l in existing if l.get('collection') == COLLECTION and l.get('source_url') == source), None)
        if old:
            receipts.append({'order': n, 'id': old['id'], 'action': 'existing'})
            print(f'{n:02d} exists: {old["id"]}', flush=True)
            continue
        images, demo = asset
        payload = dict(
            title=title, collection=COLLECTION, course_order=n,
            status='active' if n == 1 else 'waiting', tags=tags,
            notes=instruction + '\n\n以完整、均匀的一轮为单位练习；默认每档两轮后可手动提速，自动提速可按需要开启。初始个人目标可以在节拍器中调整。',
            target_bpm=target, source_url=source,
            reference_bpm_min=start, reference_bpm_max=maximum,
            score_images=[upload(f, f'picking-{n:02d}-score-{i}.png') for i, f in enumerate(images, 1)],
            demo_url=upload(demo, f'picking-{n:02d}-demo.mp4'),
            pdf_url=upload(pdf, pdf.name),
            practice_plan=dict(start_bpm=start, step_bpm=5, beats_per_bar=4, subdivision=1,
                               loop_bars=bars, rounds_per_step=2, auto_advance=False, bounce=False),
        )
        saved = request('/api/licks', 'POST', payload)
        receipts.append({'order': n, 'id': saved['id'], 'action': 'created'})
        print(f'{n:02d} imported: {saved["id"]}', flush=True)
    (root / 'licks-import-receipt.json').write_text(json.dumps(receipts, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
