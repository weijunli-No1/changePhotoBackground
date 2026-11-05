#!/usr/bin/env python3
"""Render campus navigation glyphs; requires Pillow. Does not alter theme configuration."""
from pathlib import Path
from PIL import Image, ImageDraw
root=Path(__file__).resolve().parents[1]/"mini-program"
scale=4
blue='#2358EE';slate='#63718A'
def canvas():
 im=Image.new('RGBA',(80*scale,80*scale));return im,ImageDraw.Draw(im)
def xy(points):return [(int(x*scale),int(y*scale)) for x,y in points]
def line(d,points,fill,w=5):
 d.line(xy(points),fill=fill,width=w*scale,joint='curve')
 for x,y in (points[0],points[-1]):d.ellipse(((x-w/2)*scale,(y-w/2)*scale,(x+w/2)*scale,(y+w/2)*scale),fill=fill)
def box(d,b,**kw):d.rounded_rectangle(tuple(int(v*scale) for v in b),radius=8*scale,**kw)
for theme in ("light", "dark"):
 for name in ['home','history','user']:
  for active in [False,True]:
   im,d=canvas();color=(blue if theme == "light" else "#91B4FF") if active else (slate if theme == "light" else "#ABABAF")
   if name=='home':
    shape=[(9,35),(40,10),(71,35),(67,35),(67,68),(48,68),(48,49),(32,49),(32,68),(13,68),(13,35),(9,35)]
    if active:d.polygon(xy(shape),fill=color);d.ellipse((61*scale,7*scale,77*scale,23*scale),fill='#FFE34C')
    else:line(d,shape,color)
   elif name=='history':
    box(d,(12,12,68,68),fill=color if active else None,outline=color,width=5*scale)
    fg=('#FFFFFF' if theme == 'light' else '#102144') if active else color
    d.ellipse((46*scale,22*scale,56*scale,32*scale),fill=fg)
    line(d,[(18,57),(33,41),(45,53),(54,43),(64,53)],fg,4)
   else:
    d.ellipse((28*scale,10*scale,52*scale,34*scale),fill=color if active else None,outline=color,width=5*scale)
    if active:d.rounded_rectangle((14*scale,42*scale,66*scale,69*scale),radius=18*scale,fill=color)
    else:line(d,[(14,68),(14,59),(18,49),(29,43),(51,43),(62,49),(66,59),(66,68),(14,68)],color,5)
   im.resize((80,80),Image.Resampling.LANCZOS).save(root/f'assets/icons/{name}{"-active" if active else ""}-campus{"-dark" if theme == "dark" else ""}.png')
im,d=canvas();d.polygon(xy([(8,23),(25,36),(40,13),(55,36),(72,23),(65,57),(15,57)]),fill='white');d.rounded_rectangle((15*scale,63*scale,65*scale,69*scale),radius=3*scale,fill='white');im.resize((80,80),Image.Resampling.LANCZOS).save(root/'assets/icons/crown-campus.png')
