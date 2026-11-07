import numpy as np, sys
from norm import *
pairs=[("6-9","9-13"),("9-13","13-17"),("13-17","17-21"),("17-21","21-25"),("21-25","25-29"),("29-33","33-39"),("33-39","39-44"),("25-29","29-33")]
def ink(img, mask_wm=True):
    a = 1 - np.array(img.convert("L")).astype(float)/255.0
    a = np.clip((a-0.1)/0.9,0,1)
    H,W = a.shape
    w = np.ones_like(a)
    if mask_wm:
        # watermark region: x in [W-200,W-40], y below staff
        w[TOP+5*32+8:, max(0,W-200):W-40] = 0
    return a,w
def reg(an,bn):
    A,_=load_norm(an); B,_=load_norm(bn)
    a,wa=ink(A); b,wb=ink(B)
    WA, WB = a.shape[1], b.shape[1]
    best=[]
    for ov in range(30, 900):
        d = WA-ov
        ra = a[:, d:WA]; rb = b[:, :ov]
        wa_ = wa[:, d:WA]; wb_ = wb[:, :ov]
        # B's watermark is far right; ignore. weights
        w = wa_*wb_
        n = w.sum()
        if n<1: continue
        ma=(ra*w).sum()/n; mb=(rb*w).sum()/n
        va=((ra-ma)**2*w).sum()/n; vb=((rb-mb)**2*w).sum()/n
        if va<1e-6 or vb<1e-6: continue
        c=((ra-ma)*(rb-mb)*w).sum()/n/np.sqrt(va*vb)
        best.append((c,ov))
    best.sort(reverse=True)
    return best[:3], WA, WB
for p in pairs:
    r,WA,WB = reg(*p)
    print(p, "WA",WA, [(round(c,3),ov) for c,ov in r])
