# -*- coding: utf-8 -*-
"""Inline the 5 face JPEGs into index.html as base64 data URLs."""
import base64, io, os, re
from PIL import Image

ROOT = r"E:\AI\1"
ASSETS = os.path.join(ROOT, "assets")
HTML = os.path.join(ROOT, "index.html")

urls = []
for i in range(1, 6):
    p = os.path.join(ASSETS, "face%d.jpg" % i)
    im = Image.open(p)
    im = im.resize((224, 224), Image.LANCZOS)          # 游戏内最大显示约 272px@1x，224 足够
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=80, optimize=True, progressive=True)
    b = buf.getvalue()
    urls.append("data:image/jpeg;base64," + base64.b64encode(b).decode("ascii"))
    print("face%d: %d bytes -> base64 %d chars" % (i, len(b), len(urls[-1])))

src = open(HTML, encoding="utf-8").read()
if "__SPRITES__" not in src:
    raise SystemExit("placeholder __SPRITES__ not found (already injected?)")
js = "[\n" + ",\n".join('  "%s"' % u for u in urls) + "\n]"
src = src.replace("__SPRITES__", js)
open(HTML, "w", encoding="utf-8", newline="\n").write(src)
print("index.html: %.1f KB" % (os.path.getsize(HTML) / 1024.0))
