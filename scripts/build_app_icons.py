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
  badge-96               the ANDROID STATUS-BAR icon, which is a different kind
                         of thing entirely — see render_badge()

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

# PURE BLACK, not the app's --ink-950 (5,5,6).
#
# On a phone the icon sits against a wallpaper, not against the app, so the
# reason to match the app's ground disappears — and on an OLED screen true black
# has the pixels off, which makes the honey mark look like it is floating rather
# than sitting on a very dark square. Asked for on 2026-08-26.
#
# Opaque either way: a transparent PWA icon gets composited onto whatever the
# launcher feels like, usually white, and the honey mark on white is the one
# background it was never drawn for.
BACKGROUND = (0, 0, 0)

# Android crops a maskable icon to a circle inscribed in the middle 80%. Art
# outside that is decoration; art at the edge is a haircut.
SAFE_ZONE = 0.60

# Material draws the status-bar icon at 24dp with the art inside about 22 of
# them, so a hair of inset rather than art running to the edge.
BADGE_COVERAGE = 0.90


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


def render_badge(size: int, path: Path) -> None:
    """The notification BADGE: a silhouette on transparency, not a picture.

    Android takes the small icon (what the web calls `badge`), throws away
    every colour channel, and uses the ALPHA as a stencil it fills with the
    status-bar tint. So an OPAQUE image — which every icon above is, on
    purpose — is a stencil with no holes, and the phone draws a solid white
    box. That is the whole bug: collapsed notifications show only this icon,
    expanded ones show `icon`, which is why the logo appeared the moment the
    shade was pulled down.

    The mark saves this: it is line art, so its own alpha already IS the
    silhouette — strokes opaque, everything between them transparent. Filling
    that mask with white keeps the shape readable when the tint lands on it.
    """
    art = mark()
    target = int(size * BADGE_COVERAGE)
    w, h = art.size
    scale = target / max(w, h)
    stencil = art.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)

    canvas = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    # White through the mark's own alpha. The colour is decoration — Android
    # replaces it — but a platform that does NOT tint still gets a visible mark
    # rather than honey-on-honey.
    solid = Image.new("RGBA", stencil.size, (255, 255, 255, 255))
    canvas.paste(solid, ((size - stencil.width) // 2, (size - stencil.height) // 2), stencil)
    canvas.save(path, optimize=True)
    print(f"  {path.relative_to(ROOT)}  {size}x{size}  {path.stat().st_size // 1024} KB  (silhouette)")


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
    # 96 px is 24dp at xxxhdpi — the largest an Android status bar asks for.
    render_badge(96, OUT / "badge-96.png")


if __name__ == "__main__":
    main()
