import numpy as np
from PIL import Image
names = ["1-5","6-9","9-13","13-17","17-21","21-25","25-29","29-33","33-39","39-44","44-48"]
D = "/Users/huanghao/Downloads/"
LINES = {  # first/last staff line y (from analyze)
 "1-5":(220,376),"6-9":(273,458),"9-13":(232,416),"13-17":(220,395),"17-21":(192,346),
 "21-25":(188,344),"25-29":(204,340),"29-33":(220,380),"33-39":(218,393),"39-44":(210,374),"44-48":(223,395)}
def barlines(n):
    im = np.array(Image.open(D+n+".png").convert("L")).astype(float)
    y1,y6 = LINES[n]; sp=(y6-y1)/5
    band = im[int(y1+3):int(y6-3)] < 120
    cov = band.mean(axis=0)
    below = (im[int(y6+0.5*sp):int(y6+0.9*sp)] < 120).mean(axis=0)
    cand = (cov>0.93)&(below<0.3)
    xs=[x for x in range(len(cand)) if cand[x]]
    g=[]
    for x in xs:
        if g and x-g[-1][-1]<=3: g[-1].append(x)
        else: g.append([x])
    return [(round(np.mean(a)), len(a)) for a in g], sp, im.shape[1]
for n in names:
    b,sp,W = barlines(n)
    print(n, "W",W,"sp",round(sp,1), b)
