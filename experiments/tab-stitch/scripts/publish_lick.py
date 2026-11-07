"""Upload a score PDF (+ optional lesson video) to the materials library and create a Lick that embeds them.

usage: python3 -s publish_lick.py TITLE SCORE.pdf [--video X.mp4] [--type 歌曲|练习|乐队课] [--note "text"]
                                   [--pdf-name NAME] [--video-name NAME] [--server http://localhost:3050]

Files are uploaded under friendly names; the notes use the plain `[name](/api/materials/..)` form (no <> wrapping),
videos get `"w=775"` and PDFs `"page=1,w=1155,h=823"` so both are drag-resizable in the Lick page afterwards.
Prints the Lick id. Re-running with the same TITLE creates a second lick (ids are slugs, so it gets a suffix).
"""
import argparse, json, mimetypes, os, sys, uuid, urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("title"); ap.add_argument("score")
ap.add_argument("--video"); ap.add_argument("--type", default="歌曲", choices=["歌曲", "练习", "乐队课"])
ap.add_argument("--note", default=""); ap.add_argument("--pdf-name"); ap.add_argument("--video-name")
ap.add_argument("--server", default="http://localhost:3050")
a = ap.parse_args()
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))   # never go through the local proxy

def upload(path, name):
    boundary = uuid.uuid4().hex
    data = open(path, "rb").read()
    ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
            f'Content-Type: {ctype}\r\n\r\n').encode() + data + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(a.server + "/api/materials", body,
                                 {"Content-Type": f"multipart/form-data; boundary={boundary}"}, method="POST")
    return json.load(opener.open(req))["url"]

parts = []
if a.video:
    name = a.video_name or f"{a.title} 示范.mp4"
    parts.append(f'[示范]({upload(a.video, name)} "w=775")')
pdf_name = a.pdf_name or f"{a.title} 吉他谱.pdf"
parts.append(f'[{pdf_name}]({upload(a.score, pdf_name)} "page=1,w=1155,h=823")')
if a.note: parts.append(a.note)
body = json.dumps({"title": a.title, "notes": "\n\n".join(parts), "tags": [a.type]}).encode()
req = urllib.request.Request(a.server + "/api/licks", body, {"Content-Type": "application/json"}, method="POST")
print(json.load(opener.open(req))["id"])
