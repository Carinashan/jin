# -*- coding: utf-8 -*-
"""Crop the 5 meme faces into circular game sprites + build a verification sheet."""
import os, shutil
from PIL import Image, ImageDraw, ImageFont

SRC = r"C:\Users\Administrator\.dsh\attachments\v1\objects"
OUT = r"E:\AI\1\assets"
RAW = os.path.join(OUT, "raw")
os.makedirs(RAW, exist_ok=True)

# (name, source-sha path, crop box in source pixels, label)
JOBS = [
    ("face1", r"94\94ccfb7e8351461389414d5feee61f1c71678130345a1156bbd0d1675af7cfb9", (72, 240, 592, 760),  "face1"),
    ("face2", r"e4\e4a043e8b502f885668b370ec8a538fff44a108cfe41e508fb5bdafed4abed00", (130, 280, 650, 800), "face2"),
    ("face3", r"e9\e9be3110efe9f3cedecf33dd18026bf2901f3e044378f86ae457a4a3c7dec933", (55, 58, 205, 208),   "face3"),
    ("face4", r"38\383d1fa3a6ee75fac75ae61df6898a0aa2f3ff28b993d832271f8b44da45b59a", (85, 210, 545, 670),  "face4"),
    ("face5", r"d1\d1227768534aa30d0e048b177018afdc7f6a0354e873b2fe02217c8f23f5db86", (90, 405, 550, 865),  "face5"),
]

SIZE = 256
results = []
for name, rel, box, label in JOBS:
    sp = os.path.join(SRC, rel)
    copy = os.path.join(RAW, name + os.path.splitext(rel)[1])
    shutil.copyfile(sp, copy)
    im = Image.open(copy).convert("RGB")
    print(f"{name}: source={im.size} file={os.path.basename(copy)}")
    x0, y0, x1, y1 = box
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(im.width, x1), min(im.height, y1)
    w, h = x1 - x0, y1 - y0
    s = min(w, h)
    # center the square on the crop box center
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    sq = (cx - s // 2, cy - s // 2, cx - s // 2 + s, cy - s // 2 + s)
    sq = (max(0, sq[0]), max(0, sq[1]), min(im.width, sq[2]), min(im.height, sq[3]))
    crop = im.crop(sq).resize((SIZE, SIZE), Image.LANCZOS)
    dst = os.path.join(OUT, name + ".jpg")
    crop.save(dst, "JPEG", quality=82, optimize=True, progressive=False)
    print(f"   crop={sq} -> {dst} ({os.path.getsize(dst)} bytes)")
    results.append((name, crop))

# --- verification sheet: big circles + tiny circles (game sizes) ---
PAD, R = 24, 110
sheet = Image.new("RGB", (PAD + 5 * (2 * R + PAD), 2 * R + PAD * 2 + 150), (24, 26, 34))
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc", 22)
    small = ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc", 14)
except Exception:
    font = small = ImageFont.load_default()
colors = ["#ff5d73", "#ffa63d", "#ffe066", "#7ddf64", "#4cc9f0"]
for i, (name, im) in enumerate(results):
    cx = PAD + R + i * (2 * R + PAD)
    cy = PAD + R
    mask = Image.new("L", (2 * R, 2 * R), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, 2 * R - 1, 2 * R - 1), fill=255)
    sheet.paste(im.resize((2 * R, 2 * R), Image.LANCZOS), (cx - R, cy - R), mask)
    d.ellipse((cx - R, cy - R, cx + R, cy + R), outline=colors[i % 5], width=5)
    d.text((cx - 26, cy + R + 6), name, fill=(230, 232, 240), font=font)
    # small copies at levels 1(r=20) / 3(r=31) / 6(r=56)
    xx = cx - 90
    for rr in (20, 31, 56):
        m2 = Image.new("L", (2 * rr, 2 * rr), 0)
        ImageDraw.Draw(m2).ellipse((0, 0, 2 * rr - 1, 2 * rr - 1), fill=255)
        sheet.paste(im.resize((2 * rr, 2 * rr), Image.LANCZOS), (xx, cy + R + 46), m2)
        d.ellipse((xx, cy + R + 46, xx + 2 * rr, cy + R + 46 + 2 * rr), outline=colors[i % 5], width=2)
        xx += 2 * rr + 14
    d.text((cx - 88, cy + R + 126), "game sizes r=20/31/56", fill=(150, 154, 170), font=small)
sheet.save(os.path.join(OUT, "verify_sheet.png"))
print("sheet:", os.path.join(OUT, "verify_sheet.png"), sheet.size)
