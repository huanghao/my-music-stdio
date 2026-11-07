"""Pass 2 for video input: pages (from video_pages.py) -> one normalized panorama + barline list.

 1. de-duplicate pages (same tab shown again while the teacher repeats a section) and merge duplicates
    with per-pixel max (kills leftovers of the blue playhead)
 2. detect the 6 staff lines of each page, rescale so staff spacing == 32px and line 1 sits at y=TOP
 3. chain consecutive unique pages (time order) by registration (x shift + small scale tweak)
 4. detect barlines on the panorama

usage: python3 -s video_tab.py PAGES_DIR OUT_PREFIX      -> OUT_PREFIX.png, OUT_PREFIX.json
"""
import sys, os, json, itertools, numpy as np
from PIL import Image
pdir, outp = sys.argv[1], sys.argv[2]
SP, TOP, BOT = 32.0, 175, 175
GAP = 120
DEDUPE_THR = float(os.environ.get("DEDUPE_THR", 0.03))   # pages closer than this (dilated-ink diff) are 'the same page shown again'. Repetitive riffs differ only by the grey bar numbers (~0.04): keep it tight
MERGE_MIN_NCC = float(os.environ.get("MERGE_MIN_NCC", 0.8))   # >= this: take the darker pixel in the overlap; below: switch pages mid-overlap
MIN_NCC = float(os.environ.get("MIN_NCC", 0.7))   # below this a registration is treated as 'no overlap' (a big overlap at ~0.6 is usually still right: check the seam)
MAXOV = int(os.environ.get("MAXOV", 2400))   # max overlap searched; slow-flipping/wide pages may overlap more
MINN = int(os.environ.get("MINN", 10))   # pages shown for fewer frames are transitions; fast-flipping videos need ~3
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
    if m["n"]<MINN: continue
    for g in groups:
        if pdiff(i,g[0])<DEDUPE_THR: g.append(i); break
    else: groups.append([i])
uniq=[]
for g in groups:
    acc=imgs[g[0]].copy()
    for j in g[1:]: np.maximum(acc,imgs[j],out=acc)
    uniq.append(acc)
print("unique pages (1-based page ids):",[[i+1 for i in g] for g in groups])
# ---------- 2. normalize ----------
def staff_lines(a):
    if os.environ.get("FIXED_STAFF"):      # "y1,spacing": same layout on every page, skip detection (dense pages hide lines)
        y1,sp=map(float,os.environ["FIXED_STAFF"].split(",")); return y1,sp
    rf=(a<205).mean(axis=1)
    best=None
    for frac in (0.55,0.45,0.35):          # thin/faint lines or dense pages: retry with a lower coverage bar
        ys=[y for y in range(len(rf)) if rf[y]>frac]
        gs=[]
        for y in ys:
            if gs and y-gs[-1][-1]<=2: gs[-1].append(y)
            else: gs.append([y])
        c=[float(np.mean(g)) for g in gs][:14]
        for comb in itertools.combinations(range(len(c)),6):
            d=np.diff([c[k] for k in comb])
            if d.min()<15 or d.max()>45: continue
            v=d.std()
            if best is None or v<best[0]: best=(v,comb,c)
        if best: break
    if not best: return None
    ys6=np.array([best[2][k] for k in best[1]]); k=np.arange(6)
    sp,y1=np.polyfit(k,ys6,1)
    return y1,sp
# Same video => same layout on every page: pages where detection fails (lines hidden by dense notes) borrow the median.
geoms=[staff_lines(a) for a in uniq]
ok=[g for g in geoms if g]
assert ok, "no staff found on any page (set FIXED_STAFF=y1,spacing)"
MED=(float(np.median([g[0] for g in ok])),float(np.median([g[1] for g in ok])))
print("staff geometry per page (y1, spacing):",[tuple(round(v,1) for v in (g or MED)) for g in geoms],"" if len(ok)==len(geoms) else f"(borrowed median for {len(geoms)-len(ok)} page(s))")
def normalize(a,geom=None):
    y1,sp=geom or MED; s=SP/sp
    im=Image.fromarray(a).resize((round(a.shape[1]*s),round(a.shape[0]*s)),Image.LANCZOS)
    H=TOP+round(5*SP)+BOT
    canvas=Image.new("L",(im.width,H),245)
    canvas.paste(im,(0,round(TOP-y1*s)))
    return np.array(canvas)
norm=[normalize(a,g) for a,g in zip(uniq,geoms)]
print("normalized widths:",[n.shape[1] for n in norm])
# ---------- 3. register ----------
def inkf(a): return np.clip((255-a.astype(np.float32))/255-0.12,0,1)/0.88
def ncc(ra,rb,mask_rows):
    ra=ra[mask_rows]; rb=rb[mask_rows]
    ma,mb=ra.mean(),rb.mean(); va,vb=ra.var(),rb.var()
    if va<1e-5 or vb<1e-5: return -1
    return float(((ra-ma)*(rb-mb)).mean()/np.sqrt(va*vb))
REG_BELOW=int(os.environ.get("REG_BELOW",60))   # px below the lowest staff line used for registration (a corner watermark/logo sits there: lower it, e.g. 8)
rows=slice(0,TOP+5*int(SP)+REG_BELOW)   # tab + marks above, a bit below
def register(A,B,lo=40,hi=None):
    """returns (ncc, overlap_px, scale f applied to B)"""
    best=(-1,0,1.0)
    a=inkf(A)
    def scaled(f):
        Bf=Image.fromarray(B).resize((round(B.shape[1]*f),round(B.shape[0]*f)),Image.LANCZOS)
        c=Image.new("L",(Bf.width,B.shape[0]),245); c.paste(Bf,(0,round(TOP-TOP*f)))
        return inkf(np.array(c))
    # 1) full overlap range at scale 1  2) other scales only around the best overlap (6x faster than a full grid)
    b=scaled(1.0); WA,WB=a.shape[1],b.shape[1]
    for ov in range(lo,min(WA,WB,hi or MAXOV),2):
        sc=ncc(a[:,WA-ov:],b[:,:ov],rows)
        if sc>best[0]: best=(sc,ov,1.0)
    ov1=best[1]
    for f in (0.97,0.98,0.99,1.01,1.02,1.03):
        b=scaled(f); WA,WB=a.shape[1],b.shape[1]
        for ov in range(max(lo,ov1-24),min(WA,WB,ov1+25),2):
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
    tail=pano[:, -max(2200,MAXOV):] if pano.shape[1]>max(2200,MAXOV) else pano
    sc,ov,f,B=register(tail, norm[k])
    good=[l["overlap"] for l in links if l["ncc"]>=0.8]
    if sc<0.8 and len(good)>=3:
        # Pages of one video flip by the same amount, so a weak global peak is suspicious: look again near the usual overlap
        m=int(np.median(good)); r=register(tail, norm[k], int(m*0.6), int(m*1.4))
        if r[0]>max(sc,0.5): print(f"   (weak global match {sc:.2f}@{ov}px; using the match near the usual overlap {m}px)"); sc,ov,f,B=r
    print(f"unique {k}->{k+1}: ncc={sc:.3f} overlap={ov}px scale={f}")
    links.append({"ncc":sc,"overlap":ov,"scale":f})
    WA=pano.shape[1]
    if sc<MIN_NCC:     # no usable overlap: pages just touch. Leave an estimated gap (staff lines continue)
        print("   !! weak match -> treated as NO overlap, gap of",GAP,"px inserted (check manually)")
        links[-1]["gap"]=GAP
        new=np.full((pano.shape[0],WA+GAP+B.shape[1]),245,np.uint8)
        new[:,:WA]=pano; new[:,WA+GAP:]=B
        ref=np.median(pano[:,WA-14:WA-4],axis=1).astype(np.uint8); new[:,WA:WA+GAP]=ref[:,None]
        pano=new; continue
    new=np.full((pano.shape[0],WA-ov+B.shape[1]),245,np.uint8)
    if sc>=MERGE_MIN_NCC:
        # Well registered: in the overlap keep the DARKER pixel. A watermark/playhead only ever lightens paper+ink,
        # so whichever page shows a note cleanly wins and notes covered on one page are recovered from the other.
        new[:,:WA-ov]=pano[:,:WA-ov]
        new[:,WA-ov:WA]=np.minimum(pano[:,WA-ov:],B[:,:ov])
        new[:,WA:]=B[:,ov:]
    else:
        # Weaker match: taking the darker pixel would double digits that are 1-2px off, so just switch pages in the middle of the overlap.
        seam=ov//2
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
