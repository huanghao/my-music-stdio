"""Pass 2 for video input: pages (from video_pages.py) -> one normalized panorama + barline list.

 1. de-duplicate pages (same tab shown again while the teacher repeats a section) and merge duplicates
    with per-pixel max (kills leftovers of the blue playhead)
 2. detect the 6 staff lines of each page, rescale so staff spacing == 32px and line 1 sits at y=TOP
 3. chain consecutive unique pages (time order) by registration (x shift + small scale tweak)
 4. detect barlines on the panorama

usage: python3 -s video_tab.py PAGES_DIR OUT_PREFIX      -> OUT_PREFIX.png, OUT_PREFIX.json
"""
import sys, json, itertools, numpy as np
from PIL import Image
pdir, outp = sys.argv[1], sys.argv[2]
SP, TOP, BOT = 32.0, 175, 175
GAP = 120
meta = json.load(open(f"{pdir}/pages.json"))
imgs = [np.array(Image.open(f"{pdir}/page_{i+1:04d}.png")) for i in range(len(meta))]
# ---------- 1. dedupe ----------
from scipy import ndimage as ndi
ink = [a[56:]<90 for a in imgs]
dil = [ndi.binary_dilation(m,iterations=2) for m in ink]      # tolerate 1-2px vertical jitter between repeats
def pdiff(i,j):
    return max((ink[i]&~dil[j]).sum()/max(1,ink[i].sum()), (ink[j]&~dil[i]).sum()/max(1,ink[j].sum()))
groups=[]
for i,m in enumerate(meta):
    if m["n"]<10: continue
    for g in groups:
        if pdiff(i,g[0])<0.10: g.append(i); break
    else: groups.append([i])
uniq=[]
for g in groups:
    acc=imgs[g[0]].copy()
    for j in g[1:]: np.maximum(acc,imgs[j],out=acc)
    uniq.append(acc)
print("unique pages (1-based page ids):",[[i+1 for i in g] for g in groups])
# ---------- 2. normalize ----------
def staff_lines(a):
    rf=(a<205).mean(axis=1)
    ys=[y for y in range(len(rf)) if rf[y]>0.55]
    gs=[]
    for y in ys:
        if gs and y-gs[-1][-1]<=2: gs[-1].append(y)
        else: gs.append([y])
    c=[float(np.mean(g)) for g in gs]
    best=None
    for comb in itertools.combinations(range(len(c)),6):
        d=np.diff([c[k] for k in comb])
        if d.min()<15 or d.max()>45: continue
        v=d.std()
        if best is None or v<best[0]: best=(v,comb)
    assert best, "no staff"
    ys6=np.array([c[k] for k in best[1]]); k=np.arange(6)
    sp,y1=np.polyfit(k,ys6,1)
    return y1,sp
def normalize(a):
    y1,sp=staff_lines(a); s=SP/sp
    im=Image.fromarray(a).resize((round(a.shape[1]*s),round(a.shape[0]*s)),Image.LANCZOS)
    H=TOP+round(5*SP)+BOT
    canvas=Image.new("L",(im.width,H),245)
    canvas.paste(im,(0,round(TOP-y1*s)))
    return np.array(canvas)
norm=[normalize(a) for a in uniq]
print("normalized widths:",[n.shape[1] for n in norm])
# ---------- 3. register ----------
def inkf(a): return np.clip((255-a.astype(np.float32))/255-0.12,0,1)/0.88
def ncc(ra,rb,mask_rows):
    ra=ra[mask_rows]; rb=rb[mask_rows]
    ma,mb=ra.mean(),rb.mean(); va,vb=ra.var(),rb.var()
    if va<1e-5 or vb<1e-5: return -1
    return float(((ra-ma)*(rb-mb)).mean()/np.sqrt(va*vb))
rows=slice(0,TOP+5*int(SP)+60)          # tab + marks above, a bit below
def register(A,B):
    """returns (ncc, overlap_px, scale f applied to B)"""
    best=(-1,0,1.0)
    a=inkf(A)
    for f in (0.97,0.98,0.99,1.0,1.01,1.02,1.03):
        Bf=Image.fromarray(B).resize((round(B.shape[1]*f),round(B.shape[0]*f)),Image.LANCZOS)
        c=Image.new("L",(Bf.width,B.shape[0]),245); c.paste(Bf,(0,round(TOP-TOP*f)))
        b=inkf(np.array(c)); WA,WB=a.shape[1],b.shape[1]
        for ov in range(40,min(WA,WB,1500),2):
            sc=ncc(a[:,WA-ov:],b[:,:ov],rows)
            if sc>best[0]: best=(sc,ov,f)
    # refine ov at the winning f
    sc0,ov0,f=best
    Bf=Image.fromarray(B).resize((round(B.shape[1]*f),round(B.shape[0]*f)),Image.LANCZOS)
    c=Image.new("L",(Bf.width,B.shape[0]),245); c.paste(Bf,(0,round(TOP-TOP*f))); b=inkf(np.array(c))
    for ov in range(max(20,ov0-3),ov0+4):
        sc=ncc(a[:,A.shape[1]-ov:],b[:,:ov],rows)
        if sc>sc0: sc0,ov0=sc,ov
    return sc0,ov0,f,np.array(c)
pano=norm[0]; links=[]
for k in range(1,len(norm)):
    sc,ov,f,B=register(pano[:, -2200:] if pano.shape[1]>2200 else pano, norm[k])
    print(f"unique {k}->{k+1}: ncc={sc:.3f} overlap={ov}px scale={f}")
    links.append({"ncc":sc,"overlap":ov,"scale":f})
    WA=pano.shape[1]
    if sc<0.7:     # no usable overlap: pages just touch. Leave an estimated gap (staff lines continue)
        print("   !! weak match -> treated as NO overlap, gap of",GAP,"px inserted (check manually)")
        links[-1]["gap"]=GAP
        new=np.full((pano.shape[0],WA+GAP+B.shape[1]),245,np.uint8)
        new[:,:WA]=pano; new[:,WA+GAP:]=B
        ref=np.median(pano[:,WA-14:WA-4],axis=1).astype(np.uint8); new[:,WA:WA+GAP]=ref[:,None]
        pano=new; continue
    seam=ov//2
    new=np.full((pano.shape[0],WA-ov+B.shape[1]),245,np.uint8)
    new[:,:WA-ov+seam]=pano[:,:WA-ov+seam]; new[:,WA-ov+seam:]=B[:,seam:]
    pano=new
Image.fromarray(pano).save(outp+".png"); print("panorama",pano.shape)
# ---------- 4. barlines ----------
y1,y6=TOP,TOP+5*SP
band=pano[int(y1+3):int(y6-3)]<120
cov=band.mean(axis=0)
below=(pano[int(y6+16):int(y6+29)]<120).mean(axis=0)
cand=(cov>0.93)&(below<0.3)
xs=np.where(cand)[0]; bl=[]
for x in xs:
    if bl and x-bl[-1][-1]<=14: bl[-1].append(x)
    else: bl.append([x])
bl=[float(np.mean(g)) for g in bl]
print(len(bl),"barlines:",[round(x) for x in bl])
json.dump({"links":links,"barlines":bl},open(outp+".json","w"),indent=1)
