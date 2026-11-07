"""Panorama + barlines (video_tab.py output) -> 4 bars per row, rows justified to equal width -> A4 landscape PDF.

usage: python3 -s compose_rows.py PANO_PREFIX OUT_PDF [bars_per_row=4] [T=2800]
"""
import sys, json, numpy as np
from PIL import Image
from scipy import ndimage as ndi
prefix, out = sys.argv[1], sys.argv[2]
PER = int(sys.argv[3]) if len(sys.argv)>3 else 4
T   = int(sys.argv[4]) if len(sys.argv)>4 else 2800
TOP, SP, PAD, LEFT = 175, 32, 20, 130
pano = np.array(Image.open(prefix+".png")); H = pano.shape[0]
bl = json.load(open(prefix+".json"))["barlines"]
nb = len(bl)-1
def bar(n):                        # n = 0-based; strip with PAD on both sides, xl = left barline inside strip
    xl, xr = bl[n], bl[n+1]
    a = 0 if n==0 else int(round(xl-PAD))          # first bar: keep the 'od.guit.' label and TAB clef
    b = int(round(xr+PAD)) + (10 if n==nb-1 else 0)   # last bar: include the thick final barline
    return pano[:, a:b], xl-a, xr-xl
clef = pano[:, int(bl[0])+14:int(bl[0])+55].copy()    # the 'TAB' glyph only (no time signature)
clef[int(175+5*32+8):] = 245        # below the staff only watermark/beam debris can be in this strip
def compose(ns, first):
    left = 0 if first else LEFT
    xs=[]; right=None
    for i,n in enumerate(ns):
        arr,xl,w = bar(n)
        x = left if i==0 else int(round(right-xl))
        xs.append(x); right = x+xl+w
    total = max(x+bar(n)[0].shape[1] for n,x in zip(ns,xs))
    row = np.full((H,total),245,np.uint8)
    for n,x in zip(ns,xs):
        arr=bar(n)[0]; row[:,x:x+arr.shape[1]] = np.minimum(row[:,x:x+arr.shape[1]],arr)
    if not first:
        ref = np.median(bar(1)[0],axis=1).astype(np.uint8)     # staff-line colours from a normal bar
        # only the staff lines are wanted: on dense (16th-beam) bars the median of a beam row is dark and would draw a stripe
        ref[:TOP-3] = 245; ref[TOP+5*SP+4:] = 245
        row[:,:left] = np.minimum(row[:,:left],ref[:,None])
        row[:,40:40+clef.shape[1]] = np.minimum(row[:,40:40+clef.shape[1]],clef)
    return row
def justify(a):
    H_,W_=a.shape
    if W_>T: return np.array(Image.fromarray(a).resize((T,round(H_*T/W_)),Image.LANCZOS))
    band=np.zeros(H_,bool)
    for k in range(6): y=TOP+k*SP; band[y-3:y+4]=True
    col=ndi.binary_dilation(((a<170)&~band[:,None]).any(axis=0),structure=np.ones(11)); col[:170]=True
    lab,n=ndi.label(~col); runs=[np.where(lab==i)[0] for i in range(1,n+1)]; runs=[r for r in runs if len(r)>=6]
    E=T-W_; w=np.array([len(r) for r in runs],float); al=np.floor(E*w/w.sum()).astype(int); al[np.argmax(w)]+=E-al.sum()
    parts=[]; prev=0
    for r,e in zip(runs,al):
        c=int(r[len(r)//2]); parts+= [a[:,prev:c+1], np.repeat(a[:,c:c+1],e,axis=1)]; prev=c+1
    parts.append(a[:,prev:]); res=np.concatenate(parts,axis=1); assert res.shape[1]==T; return res
def crop_v(a,pad=14):
    ys=np.where((a<200).any(axis=1))[0]; return a[max(0,ys.min()-pad):min(a.shape[0],ys.max()+pad)]
rows=[crop_v(justify(compose(list(range(i,min(i+PER,nb))), i==0))) for i in range(0,nb,PER)]
PW,PH,M,GAP=2339,1654,70,22; sc=(PW-2*M)/T
pages=[Image.new("L",(PW,PH),255)]; y=M
for r in rows:
    im=Image.fromarray(r).resize((round(T*sc),round(r.shape[0]*sc)),Image.LANCZOS)
    if y+im.height>PH-M: pages.append(Image.new("L",(PW,PH),255)); y=M
    pages[-1].paste(im,(M,y)); y+=im.height+GAP
pages=[p.convert("RGB") for p in pages]
pages[0].save(out,"PDF",resolution=200.0,save_all=True,append_images=pages[1:])
for i,p in enumerate(pages): p.save(f"{prefix}_page{i+1}.png")
print(nb,"bars,",len(rows),"rows,",len(pages),"pages ->",out)
