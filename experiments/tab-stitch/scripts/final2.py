import numpy as np
from PIL import Image
from scipy import ndimage as ndi
TOP,SP=175,32
T=2800                      # common row width (normalized px)
rows=[np.array(Image.open(f"row_{i:02d}.png").convert("L")) for i in range(1,13)]
def justify(a, T):
    H,W=a.shape
    if W>T:   # too wide: scale the whole row down to T
        im=Image.fromarray(a).resize((T,round(H*T/W)),Image.LANCZOS)
        return np.array(im)
    band=np.zeros(H,bool)
    for k in range(6):
        y=TOP+k*SP; band[y-3:y+4]=True
    ink=(a<170)&(~band[:,None])
    col=ink.any(axis=0)
    col=ndi.binary_dilation(col,structure=np.ones(11))
    col[:170]=True            # never stretch inside the left margin / first barline area
    blank=~col
    lab,n=ndi.label(blank)
    runs=[(np.where(lab==i)[0]) for i in range(1,n+1)]
    runs=[r for r in runs if len(r)>=6]
    E=T-W
    wts=np.array([len(r) for r in runs],float); alloc=np.floor(E*wts/wts.sum()).astype(int)
    alloc[np.argmax(wts)]+=E-alloc.sum()
    out=[]; prev=0
    for r,e in zip(runs,alloc):
        c=int(r[len(r)//2])
        out.append(a[:,prev:c+1]); out.append(np.repeat(a[:,c:c+1],e,axis=1)); prev=c+1
    out.append(a[:,prev:])
    res=np.concatenate(out,axis=1); assert res.shape[1]==T,(res.shape,T)
    return res
def crop_v(a,pad=14):
    ys=np.where((a<200).any(axis=1))[0]
    return a[max(0,ys.min()-pad):min(a.shape[0],ys.max()+pad)]
rows=[crop_v(justify(r,T)) for r in rows]
PW,PH=2339,1654; M=70; GAP=22
scale=(PW-2*M)/T
pages=[Image.new("L",(PW,PH),255)]; y=M
for r in rows:
    im=Image.fromarray(r); rs=im.resize((round(T*scale),round(im.height*scale)),Image.LANCZOS)
    if y+rs.height>PH-M:
        pages.append(Image.new("L",(PW,PH),255)); y=M
    pages[-1].paste(rs,(M,y)); y+=rs.height+GAP
out="/Users/huanghao/Downloads/guitar-solo-tab.pdf"
pages=[p.convert("RGB") for p in pages]
pages[0].save(out,"PDF",resolution=200.0,save_all=True,append_images=pages[1:])
for i,p in enumerate(pages): p.save(f"page2_{i+1}.png")
print(len(pages),"pages; scale",round(scale,3))
