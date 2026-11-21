"""Draws the app icons into ../icons. Run: python3 tools/make-icons.py (needs Pillow).
A cream rocket with an orange nose and flame on the night-sky background of the control room, with a few stars."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
BG = (8, 12, 24)
PAPER = (240, 235, 227)
ACCENT = (255, 148, 51)
TEAL = (93, 202, 165)


def draw(size: int) -> Image.Image:
    s = 1024
    img = Image.new("RGB", (s, s), BG)
    d = ImageDraw.Draw(img)
    for x, y, r in [(250, 270, 9), (770, 230, 7), (690, 420, 5), (300, 610, 6), (800, 700, 8), (210, 450, 4), (560, 190, 5)]:
        d.ellipse([x - r, y - r, x + r, y + r], fill=PAPER)
    c = s / 2
    # radar arc behind the rocket
    d.arc([c - 330, c - 330, c + 330, c + 330], 200, 340, fill=TEAL, width=26)
    # body (all inside Android's safe circle)
    d.rounded_rectangle([c - 78, 380, c + 78, 640], radius=30, fill=PAPER)
    d.polygon([(c - 78, 400), (c, 230), (c + 78, 400)], fill=ACCENT)          # nose
    d.ellipse([c - 36, 430, c + 36, 502], fill=BG)                              # window
    d.ellipse([c - 22, 444, c + 22, 488], fill=TEAL)
    d.polygon([(c - 78, 540), (c - 170, 650), (c - 170, 700), (c - 78, 640)], fill=ACCENT)   # fins
    d.polygon([(c + 78, 540), (c + 170, 650), (c + 170, 700), (c + 78, 640)], fill=ACCENT)
    d.polygon([(c - 52, 650), (c, 800), (c + 52, 650)], fill=ACCENT)            # flame
    d.polygon([(c - 24, 650), (c, 730), (c + 24, 650)], fill=PAPER)
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(exist_ok=True)
for name, size in [("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)]:
    draw(size).save(OUT / name, optimize=True)
    print("wrote", OUT / name)
