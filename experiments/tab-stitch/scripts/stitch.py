import numpy as np
from PIL import Image, ImageDraw
from norm import *
BARS = {
 "1-5":[(1,82),(2,518),(3,1061),(4,1435),(5,1988),(6,2537)],
 "6-9":[(6,34),(7,751),(8,1315),(9,1820)],
 "9-13":[(10,162),(11,992),(12,1384),(13,2234)],
 "13-17":[(14,940),(15,1422),(16,2016),(17,2464)],
 "17-21":[(18,515),(19,1038),(20,1632),(21,2200)],
 "21-25":[(22,428),(23,1271),(24,1920),(25,2369)],
 "25-29":[(26,245),(27,982),(28,1634),(29,2466)],
 "29-33":[(29,146),(30,585),(31,929),(32,1695),(33,2180)],
 "33-39":[(34,238),(35,752),(36,1054),(37,1570),(38,1871),(39,2373)],
 "39-44":[(40,300),(41,818),(42,1173),(43,1716),(44,1998)],
 "44-48":[(44,4),(45,634),(46,1264),(47,1772),(48,2218),(49,2514)],
}
# overlap (px at normalized scale) between consecutive images for partial bars; negative = gap
OVERLAP = {("6-9","9-13"):40, ("9-13","13-17"):285, ("13-17","17-21"):-140, ("17-21","21-25"):75,
           ("21-25","25-29"):65, ("29-33","33-39"):59, ("33-39","39-44"):129}
PAD = 20
IMGS = {n: load_norm(n) for n in BARS}
def bx(n, bar):
    s = IMGS[n][1]
    return dict(BARS[n])[bar]*s
def staff_fill(arr, x0, x1):
    """draw staff lines onto arr between x0..x1 (used for gaps)"""
    for k in range(6):
        y = TOP + round(k*SP)
        arr[y-0:y+1, x0:x1] = 150
    return arr
def crop(n, a, b):
    im = np.array(IMGS[n][0].convert("L"))
    H, W = im.shape
    a=max(0,int(round(a))); b=min(W,int(round(b)))
    return im[:, a:b]
def strip_complete(bar):
    for n in BARS:
        d=dict(BARS[n])
        if bar in d and bar+1 in d:
            xl, xr = bx(n,bar), bx(n,bar+1)
            return crop(n, xl-PAD, xr+PAD), xl-max(0,xl-PAD), n
    return None
def pano(a, b, ov):
    A = np.array(IMGS[a][0].convert("L")); B = np.array(IMGS[b][0].convert("L"))
    WA, WB = A.shape[1], B.shape[1]
    H = A.shape[0]
    d = WA - ov                     # x of B's left edge in A coords
    seam = d + (ov//2 if ov>0 else 0)
    P = np.full((H, d+WB), 244, np.uint8)
    if ov < 0:
        P[:, :WA] = A; P[:, d:] = B; staff_fill(P, WA, d)
        # blank slate in gap, then draw lines
        return P, d, seam
    P[:, :seam] = A[:, :seam]
    P[:, seam:] = B[:, seam-d:]
    return P, d, seam
def strip_stitched(bar):
    for (a,b),ov in OVERLAP.items():
        da, db = dict(BARS[a]), dict(BARS[b])
        if bar in da and bar+1 in db and bar+1 not in da:
            P, d, seam = pano(a,b,ov)
            xl = bx(a,bar); xr = d + bx(b,bar+1)
            x0 = int(round(xl-PAD)); x1 = int(round(xr+PAD))
            return P[:, x0:x1], xl-x0, (a,b)
    return None
def get_bar(bar):
    s = strip_complete(bar)
    if s: return s
    return strip_stitched(bar)
if __name__=="__main__":
    import sys
    for bar in (9,13,17,21,25,33,39):
        arr, xl, src = get_bar(bar)
        Image.fromarray(arr).save(f"stitch_{bar}.png")
        print(bar, arr.shape, src)
