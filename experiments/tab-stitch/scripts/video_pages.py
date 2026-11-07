"""Pass 1 for video input: read the bottom tab strip of every sampled frame,
split into 'pages' (consecutive frames showing the same tab content) and, for each page,
build a clean image by taking the per-pixel MAX over its frames (removes the blue playhead
that sweeps across the strip: uncovered paper is lighter than covered paper).

usage: python3 -s video_pages.py VIDEO OUTDIR [fps=2] [y0=592] [h=488]
"""
import sys, subprocess, numpy as np, json, os
from PIL import Image
video, outdir = sys.argv[1], sys.argv[2]
fps = float(sys.argv[3]) if len(sys.argv)>3 else 2
y0 = int(sys.argv[4]) if len(sys.argv)>4 else 592
h  = int(sys.argv[5]) if len(sys.argv)>5 else 488
W = 1920
os.makedirs(outdir, exist_ok=True)
cmd = ["ffmpeg","-v","error","-i",video,"-vf",f"fps={fps},crop={W}:{h}:0:{y0},format=gray",
       "-f","rawvideo","-"]
p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
fsize = W*h
pages=[]; cur=None; prev_ink=None; n=0
def flush():
    global cur
    if cur and cur["n"]>=2:
        pages.append({k:cur[k] for k in ("t0","t1","n")})
        if cur["acc"][:40].mean() < 225: cur["acc"][:56]=255   # leaked video at the top -> blank it
        Image.fromarray(cur["acc"]).save(f"{outdir}/page_{len(pages):04d}.png")
    cur=None
while True:
    buf = p.stdout.read(fsize)
    if len(buf)<fsize: break
    t = n/fps; n+=1
    g = np.frombuffer(buf,np.uint8).reshape(h,W)
    has_tab = (g>225).mean() > 0.6
    if not has_tab:
        flush(); prev_ink=None; continue
    ink = g[56:]<90          # ignore the top 56px: video/subtitles leak in there on some pages
    if prev_ink is not None:
        diff = (ink^prev_ink).sum()/max(1,(ink|prev_ink).sum())
    else: diff = 1.0
    prev_ink = ink
    if cur is None or diff>0.25:
        flush(); cur={"acc":g.copy(),"t0":t,"t1":t,"n":1}
    else:
        np.maximum(cur["acc"],g,out=cur["acc"]); cur["t1"]=t; cur["n"]+=1
flush()
json.dump(pages,open(f"{outdir}/pages.json","w"),indent=1)
print(len(pages),"pages")
for i,pg in enumerate(pages,1): print(i, round(pg["t0"]), round(pg["t1"]), pg["n"])
