#!/usr/bin/env python3
"""
Build the app icons a phone actually asks for, from the bee mark.

`public/bee-dark.png` is a 3000 px honey mark on transparency. Serving that as
the icon "works" in the sense that a browser will scale it, and fails in every
way that matters: 133 KB fetched to draw 48 px, a transparent mark that Android
drops into a white circle, and an iOS home screen that letterboxes it.

So each size is generated properly:

  icon-192 / icon-512    the standard PWA pair, mark on the app's own dark ground
  icon-maskable-512      the same, but sized for Android's SAFE ZONE — a maskable
                         icon is cropped to a circle on many launchers, and art
                         drawn to the edges loses its edges
  apple-touch-icon       180 px, what iOS uses for the home screen
  favicon-32 / -16       the browser tab

Run: python scripts/build_app_icons.py
"""
from __future__ import annotations

from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    raise SystemExit("openpyxl's friend Pillow is needed: python -m pip install pillow")

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "bee-dark.png"
OUT = ROOT / "public"

# --brand ground from tokens.css. Icons are opaque on purpose: a transparent PWA
# icon is composited onto whatever the launcher feels like, usually white, and
# the honey mark on white is the one background it was never drawn for.
BACKGROUND = (5, 5, 6)  # --ink-950

# Android crops a maskable icon to a circle inscribed in the middle 80%. Art
# outside that is decoration; art at the edge is a haircut.
SAFE_ZONE = 0.60


def mark() -> Image.Image:
    img = Image.open(SRC).convert("RGBA")
    box = img.getbbox()  # the source carries a wide transparent margin
    return img.crop(box) if box else img


def render(size: int, coverage: float, path: Path) -> None:
    """The mark centred on the brand ground, covering `coverage` of the canvas."""
    art = mark()
    target = int(size * coverage)
    w, h = art.size
    scale = target / max(w, h)
    art = art.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)

    canvas = Image.new("RGBA", (size, size), BACKGROUND)
    canvas.paste(art, ((size - art.width) // 2, (size - art.height) // 2), art)
    canvas.convert("RGB").save(path, optimize=True)
    print(f"  {path.relative_to(ROOT)}  {size}x{size}  {path.stat().st_size // 1024} KB")


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"missing {SRC}")
    print("Building app icons from bee-dark.png")
    # 0.72 leaves a little breathing room without looking lost in the square.
    render(192, 0.72, OUT / "icon-192.png")
    render(512, 0.72, OUT / "icon-512.png")
    render(512, SAFE_ZONE, OUT / "icon-maskable-512.png")
    render(180, 0.72, OUT / "apple-touch-icon.png")
    render(32, 0.80, OUT / "favicon-32.png")
    render(16, 0.86, OUT / "favicon-16.png")


if __name__ == "__main__":
    main()
