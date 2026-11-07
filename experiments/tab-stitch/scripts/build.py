import numpy as np
from PIL import Image, ImageDraw, ImageFont
import norm
from norm import *
# ---- 1. watermark cleaning on originals (before normalization) ----
WM = {"1-5":(2392,2499,405,515),"6-9":(1934,2041,405,510),"9-13":(2390,2497,413,518),
      "13-17":(2396,2503,410,518),"17-21":(2395,2500,348,458),"29-33":(2140,2247,335,442),
      "39-44":(2390,2496,372,480),"44-48":(2394,2501,372,480)}
def clean_orig(n):
    im = Image.open(D+n+".png").convert("L")
    if n in WM:
        g = np.array(im).astype(np.uint8)
        x0,x1,y0,y1 = WM[n]; x0-=7; x1+=7; y0-=7; y1+=7
        box = g[y0:y1, x0:x1]
        box[box>=110] = 244
        # restore staff lines hidden under the logo
        ys, ye = LINES[n]; sp=(ye-ys)/5
        ref = np.median(g[:, x0-16:x0-6], axis=1)
        for k in range(6):
            yc = round(ys+k*sp)
            for y in range(yc-1, yc+2):
                if y0<=y<y1:
                    row = g[y, x0:x1]
                    row[:] = np.minimum(row, ref[y])
        im = Image.fromarray(g)
    return im.convert("RGB")
def load_norm_clean(n):
    im = clean_orig(n)
    y1,y6 = LINES[n]; sp=(y6-y1)/5; s=SP/sp
    im2 = im.resize((round(im.width*s), round(im.height*s)), Image.LANCZOS)
    H = TOP + round(5*SP) + BOT
    canvas = Image.new("RGB",(im2.width,H),BG)
    canvas.paste(im2,(0, round(TOP - y1*s)))
    return canvas, s
norm.load_norm = load_norm_clean
import stitch
PAD = stitch.PAD
stitch.IMGS = {n: load_norm_clean(n) for n in stitch.BARS}
# per-pair scale correction for B (21-25 is 2% larger than the estimate)
def gap_fill(P, x0, x1, ref_cols):
    ref = np.median(P[:, ref_cols[0]:ref_cols[1]], axis=1)
    P[:, x0:x1] = ref[:,None].astype(np.uint8)
stitch_pano_orig = stitch.pano
def pano(a,b,ov):
    P,d,seam = stitch_pano_orig(a,b,ov)
    if ov<0:
        WA = stitch.IMGS[a][0].width
        P[:, WA:d] = 244
        gap_fill(P, WA, d, (WA-14, WA-4))
    return P,d,seam
stitch.pano = pano
stitch.OVERLAP[("17-21","21-25")] = 75
# fix: rescale 21-25 by 1.02 relative to its normalization (measured by correlation)
def rescale(n, f):
    c = stitch.IMGS[n][0]; s = stitch.IMGS[n][1]
    Bu = c.resize((round(c.width*f), round(c.height*f)), Image.LANCZOS)
    canvas = Image.new("RGB",(Bu.width, c.height),BG)
    canvas.paste(Bu,(0, round(TOP-TOP*f)))
    stitch.IMGS[n] = (canvas, s*f)
# only for the stitched bar 21 we need 21-25 scaled 1.02; but bars 22-24 from the same image would also be 2% larger -> keep a copy
IM2125 = stitch.IMGS["21-25"]
rescale("21-25", 1.02)
bar21 = stitch.get_bar(21)
stitch.IMGS["21-25"] = IM2125
# ---- 2. bars ----
bars = {}
for n in range(1,49):
    if n==21: bars[n]=bar21; continue
    bars[n] = stitch.get_bar(n)
    assert bars[n] is not None, n
for n,(a,xl,src) in bars.items():
    pass
# first bar: include "od.guit." label at far left & TAB clef (crop from x=14)
import numpy as np
def bar1():
    im = np.array(stitch.IMGS["1-5"][0].convert("L")); s=stitch.IMGS["1-5"][1]
    x0 = int(14*s); x1 = int(518*s)+PAD
    return im[:, x0:x1], 82*s-x0
b1, xl1 = bar1(); bars[1]=(b1, xl1, "1-5")
# last bar: extend to the end of final barline
def bar48():
    im = np.array(stitch.IMGS["44-48"][0].convert("L")); s=stitch.IMGS["44-48"][1]
    xl=2218*s; x1=int(2545*s)
    return im[:, int(xl-PAD):x1], xl-int(xl-PAD)
b48,xl48 = bar48(); bars[48]=(b48,xl48,"44-48")
# ---- 3. rows of 4 bars ----
def compose_row(ns, clef=None):
    left = 130 if clef is not None else 0
    xs=[]; right_bl=None
    for i,n in enumerate(ns):
        arr, xl, _ = bars[n]
        x = left if i==0 else right_bl - xl
        x = int(round(x)); xs.append(x)
        right_bl = x + xl + (arr.shape[1]-xl-PAD)
    total = int(max(x+bars[n][0].shape[1] for n,x in zip(ns,xs)))
    H = bars[ns[0]][0].shape[0]
    row = np.full((H,total),244,np.uint8)
    for n,x in zip(ns,xs):
        arr = bars[n][0]
        row[:, x:x+arr.shape[1]] = np.minimum(row[:, x:x+arr.shape[1]], arr)
    if clef is not None:
        # staff lines across the left margin
        ref = np.median(bars[2][0], axis=1).astype(np.uint8)
        row[:, :left] = np.minimum(row[:, :left], ref[:,None])
        cw = clef.shape[1]
        row[:, 40:40+cw] = np.minimum(row[:, 40:40+cw], clef)
    return row
# TAB clef crop from bar 1: x 98..138 orig, tall
im1 = np.array(stitch.IMGS["1-5"][0].convert("L")); s1 = stitch.IMGS["1-5"][1]
clef = im1[:, int(98*s1):int(138*s1)]
rows=[list(range(i,i+4)) for i in range(1,49,4)]
rowimgs=[]
for r in rows:
    rowimgs.append(compose_row(r, None if r[0]==1 else clef))
# staff line colour from first row
print([ (r.shape[1]) for r in rowimgs])
np.save("rows_meta.npy", np.array([r.shape[1] for r in rowimgs]))
for i,r in enumerate(rowimgs):
    Image.fromarray(r).save(f"row_{i+1:02d}.png")
