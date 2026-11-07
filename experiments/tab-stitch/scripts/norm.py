import numpy as np
from PIL import Image
D = "/Users/huanghao/Downloads/"
LINES = {"1-5":(220,376),"6-9":(273,458),"9-13":(232,416),"13-17":(220,395),"17-21":(192,346),
 "21-25":(188,344),"25-29":(204,340),"29-33":(220,380),"33-39":(218,393),"39-44":(210,374),"44-48":(223,395)}
SP = 32.0
TOP, BOT = 175, 160   # px above line1 / below line6 after normalization
BG = (245,245,245)
def load_norm(n):
    """scaled so staff spacing == SP, line1 at y=TOP; returns RGB PIL image, scale"""
    im = Image.open(D+n+".png").convert("RGB")
    y1,y6 = LINES[n]; sp=(y6-y1)/5; s=SP/sp
    im2 = im.resize((round(im.width*s), round(im.height*s)), Image.LANCZOS)
    y1s, y6s = y1*s, y6*s
    H = TOP + round(5*SP) + BOT
    canvas = Image.new("RGB",(im2.width,H),BG)
    off = round(TOP - y1s)
    canvas.paste(im2,(0,off))
    return canvas, s
