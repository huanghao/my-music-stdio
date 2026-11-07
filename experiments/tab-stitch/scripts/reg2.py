import numpy as np
from PIL import Image
from norm import *
def ink(img):
    a = 1 - np.array(img.convert("L")).astype(float)/255.0
    return np.clip((a-0.15)/0.85,0,1)
def ncc(a,b,w):
    n=w.sum()
    if n<1: return -1
    ma=(a*w).sum()/n; mb=(b*w).sum()/n
    va=((a-ma)**2*w).sum()/n; vb=((b-mb)**2*w).sum()/n
    if va<1e-6 or vb<1e-6: return -1
    return ((a-ma)*(b-mb)*w).sum()/n/np.sqrt(va*vb)
def search(an,bn,ovr=(20,400),fs=np.arange(0.90,1.101,0.01)):
    A,_=load_norm(an); B0,_=load_norm(bn)
    a=ink(A); WA=a.shape[1]
    res=[]
    for f in fs:
        Bf=B0.resize((round(B0.width*f), B0.height), Image.LANCZOS)  # horizontal-only stretch just to model scale err
        # vertical scale error: also model by stretching vertical equally (uniform scale)
        Bu=B0.resize((round(B0.width*f), round(B0.height*f)), Image.LANCZOS)
        # re-align line1 at TOP
        canvas=Image.new("RGB",(Bu.width,B0.height),BG)
        canvas.paste(Bu,(0,round(TOP-TOP*f)))
        b=ink(canvas)
        for ov in range(ovr[0],ovr[1]):
            d=WA-ov
            ra=a[:,d:WA]; rb=b[:,:ov]
            w=np.ones_like(ra); w[TOP+5*32+8:,:]=0   # ignore below staff (beams, watermark) 
            w[:,:]=w
            c=ncc(ra,rb,w)
            res.append((c,round(f,2),ov))
    res.sort(reverse=True)
    return res[:5]
import sys
pairs=[("17-21","21-25"),("13-17","17-21"),("21-25","25-29"),("29-33","33-39")]
for p in pairs:
    print(p,[(round(c,3),f,ov) for c,f,ov in search(*p)])
