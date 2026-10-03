# Pixel diff of the -ref/-ours pairs written by parity-capture.mjs:  OUT=/tmp/sf-parity/pub python3 parity-diff.py 'aurora-*'
import sys,glob,os
from PIL import Image, ImageChops
import os
d=os.environ.get('OUT','/tmp/sf-parity/pub')+'/'
pat=sys.argv[1] if len(sys.argv)>1 else '*'
for r in sorted(glob.glob(d+f'pub-{pat}-ref.png')):
    o=r.replace('-ref.png','-ours.png')
    if not os.path.exists(o): continue
    a=Image.open(r).convert('RGB'); b=Image.open(o).convert('RGB')
    if a.size!=b.size:
        print(os.path.basename(r)[:-8],'SIZE',a.size,b.size); w=min(a.width,b.width); h=min(a.height,b.height); a=a.crop((0,0,w,h)); b=b.crop((0,0,w,h))
    diff=ImageChops.difference(a,b).convert('L').point(lambda x:255 if x>24 else 0)
    n=sum(1 for p in diff.getdata() if p)
    print(f"{os.path.basename(r)[:-8]:50s} diff {100*n/(a.width*a.height):5.2f}%")
