import sys, numpy as np
from PIL import Image
names = ["1-5","6-9","9-13","13-17","17-21","21-25","25-29","29-33","33-39","39-44","44-48"]
D = "/Users/huanghao/Downloads/"
for n in names:
    im = np.array(Image.open(D+n+".png").convert("L")).astype(float)
    H,W = im.shape
    dark = im < 150
    # staff lines: rows where lots of pixels are mid-dark (lines are thin gray)
    rowfrac = (im < 200).mean(axis=1)
    rows = [y for y in range(H) if rowfrac[y] > 0.6]
    # group consecutive
    groups=[]
    for y in rows:
        if groups and y-groups[-1][-1] <= 2: groups[-1].append(y)
        else: groups.append([y])
    centers=[np.mean(g) for g in groups]
    sp = np.diff(centers).mean() if len(centers)>1 else None
    print(n, (W,H), "bg", np.median(im), "lines", [round(c) for c in centers], "spacing", sp and round(sp,2))
