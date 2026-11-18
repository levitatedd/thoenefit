"""Builds every app icon from one master image (#248).

    python3 docs/icons/make-icons.py

Reads docs/icons/monogram-master.png (the approved mint monogram: the
dumbbell/T in a rounded mint border on near-black, no text) and writes:

    web/favicon.ico                  16, 32 and 48px, rounded corners see-through. The
                                     16px one is redrawn slightly bolder (thicker border,
                                     larger symbol) so it stays clear in a browser tab.
    web/icons/favicon-32.png         browser tab
    web/icons/icon-192.png           installed app ("any")
    web/icons/icon-512.png           installed app ("any")
    web/icons/icon-maskable-512.png  Android adaptive icon: full-bleed background,
                                     the whole design inside the centre safe circle
    web/icons/apple-touch-icon.png   iPhone Home Screen, square and opaque
                                     (iOS rounds the corners itself)

After changing the master, run this, then bump ?v= on the icon links in
web/index.html and web/manifest.webmanifest so browsers fetch the new files.
Needs Pillow.
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
MASTER = ROOT / 'docs/icons/monogram-master.png'
ICONS = ROOT / 'web/icons'
# Background for the maskable icon, sampled from the master just inside the border.
BG = (2, 5, 8, 255)
BORDER = (2, 252, 197, 255)  # the master's border colour
# Android's safe zone is a circle of 40% of the icon's size (radius) around the centre.
# The master's rounded square (corner radius about 22% of its side) fits inside it at 66%.
MASKABLE_SCALE = 0.66


def master() -> Image.Image:
    im = Image.open(MASTER).convert('RGB')
    if im.width != im.height:
        raise SystemExit('The master must be square.')
    return im


def see_through_corners(im: Image.Image) -> Image.Image:
    """The black outside the rounded border becomes transparent."""
    marked = im.copy()
    w, h = marked.size
    for xy in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(marked, xy, (255, 0, 255), thresh=40)
    out = im.convert('RGBA')
    src, dst = marked.load(), out.load()
    for y in range(h):
        for x in range(w):
            if src[x, y] == (255, 0, 255):
                dst[x, y] = (0, 0, 0, 0)
    return out


def tiny_favicon(im: Image.Image, size: int = 16) -> Image.Image:
    """The design simplified for 16px: the same symbol, a bolder border."""
    S = 256
    c = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(c).rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.24), fill=BG, outline=BORDER, width=22)
    px = im.load()
    pts = [(x, y) for y in range(im.height // 6, im.height * 5 // 6) for x in range(im.width // 8, im.width * 7 // 8)
           if px[x, y][1] > 150 and px[x, y][0] < 140]
    box = (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts) + 1, max(p[1] for p in pts) + 1)
    sym = im.crop(box).convert('RGBA')
    sp = sym.load()
    for y in range(sym.height):
        for x in range(sym.width):
            r, g, b, _ = sp[x, y]
            sp[x, y] = (r, g, b, int(255 * min(1, max(0, (g - 40) / 140))))  # mint only, no backdrop
    sw = int(S * 0.76)
    sh = int(sw * sym.height / sym.width)
    sym = sym.resize((sw, sh), Image.LANCZOS)
    c.alpha_composite(sym, ((S - sw) // 2, (S - sh) // 2 + int(S * 0.02)))
    return c.resize((size, size), Image.LANCZOS)


def sized(im: Image.Image, px: int) -> Image.Image:
    return im.resize((px, px), Image.LANCZOS)


def main() -> None:
    opaque = master()
    rounded = see_through_corners(opaque)

    sized(rounded, 32).save(ICONS / 'favicon-32.png', optimize=True)
    sized(rounded, 192).save(ICONS / 'icon-192.png', optimize=True)
    sized(rounded, 512).save(ICONS / 'icon-512.png', optimize=True)
    sized(opaque, 180).save(ICONS / 'apple-touch-icon.png', optimize=True)

    canvas = Image.new('RGBA', (512, 512), BG)
    inner = round(512 * MASKABLE_SCALE)
    art = sized(rounded, inner)
    canvas.alpha_composite(art, ((512 - inner) // 2, (512 - inner) // 2))
    canvas.convert('RGB').save(ICONS / 'icon-maskable-512.png', optimize=True)

    sized(rounded, 48).save(ROOT / 'web/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)],
                            append_images=[tiny_favicon(opaque), sized(rounded, 32)])
    print('Icons written from', MASTER.relative_to(ROOT))


if __name__ == '__main__':
    main()
