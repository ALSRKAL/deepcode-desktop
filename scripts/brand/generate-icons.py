#!/usr/bin/env python3
"""Generate every DeepCode Studio app icon from the split-D mark.

The mark is the one the web portal uses (apps/web/src/app/icon.svg in the server
repository): dark rounded square, white "D" bowl, cyan stem. Re-run after changing
the colours or geometry below:

    python3 scripts/brand/generate-icons.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
BG = (17, 24, 39, 255)        # #111827
BOWL = (248, 250, 252, 255)   # #F8FAFC
STEM = (34, 211, 238, 255)    # #22D3EE
SS = 4                        # supersampling for smooth edges


def mark(size: int, margin: float = 0.0, tile_bg: bool = True, mono: bool = False) -> Image.Image:
    """Mark at `size` px; `margin` is the transparent inset (fraction) around the tile."""
    n = size * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    inset = n * margin
    tile = n - 2 * inset
    u = tile / 32  # the SVG is drawn in a 32-unit box
    ox = oy = inset
    if tile_bg:
        d.rounded_rectangle([ox, oy, ox + tile, oy + tile], radius=8 * u, fill=BG)
    bowl, stem = (BOWL, BOWL if mono else STEM)
    w = max(1, round(3 * u))
    r = w / 2

    def p(x, y):
        return (ox + x * u, oy + y * u)

    def cap(x, y, col):
        cx, cy = p(x, y)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)

    # Bowl: M10.5 9 H17 a7 7 0 0 1 0 14 H10.5
    d.line([p(10.5, 9), p(17, 9)], fill=bowl, width=w)
    d.line([p(17, 23), p(10.5, 23)], fill=bowl, width=w)
    # PIL draws arc width inward: grow the box by half the stroke so the arc's
    # centre line has radius 7 like the SVG path (centre 17,16).
    cx, cy = p(17, 16)
    rad = 7 * u + w / 2
    d.arc([cx - rad, cy - rad, cx + rad, cy + rad], start=270, end=90, fill=bowl, width=w)
    for x, y in [(17, 9), (17, 23)]:
        cap(x, y, bowl)
    # Stem: M10.5 9 v14 (accent)
    d.line([p(10.5, 9), p(10.5, 23)], fill=stem, width=w)
    for x, y in [(10.5, 9), (10.5, 23)]:
        cap(x, y, stem)
    return img.resize((size, size), Image.LANCZOS)


SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]


def write_png_set(directory: Path, margin: float = 0.0) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for s in SIZES:
        mark(s, margin).save(directory / f"{s}x{s}.png")


FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
]


def font(px: int):
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, px)
    return ImageFont.load_default(px)


def dmg_background(scale: int) -> Image.Image:
    """macOS installer window (540x380 pt): mark + name above the drag arrow.
    The app and Applications icons are placed by electron-builder at the arrow ends."""
    w, h = 540 * scale, 380 * scale
    img = Image.new("RGBA", (w, h), (245, 246, 248, 255))
    d = ImageDraw.Draw(img)
    m = mark(56 * scale)
    title = "DeepCode Studio"
    f = font(30 * scale)
    tw = d.textlength(title, font=f)
    gap = 14 * scale
    total = m.width + gap + tw
    x = (w - total) / 2
    y = 62 * scale
    img.paste(m, (int(x), int(y)), m)
    d.text((x + m.width + gap, y + m.height / 2), title, font=f, fill=(17, 24, 39, 255), anchor="lm")
    # Drag arrow between the two icon slots.
    ax0, ax1, ay = 218 * scale, 322 * scale, 205 * scale
    d.line([(ax0, ay), (ax1, ay)], fill=(110, 116, 128, 255), width=4 * scale)
    d.polygon([(ax1 + 2 * scale, ay), (ax1 - 12 * scale, ay - 9 * scale), (ax1 - 12 * scale, ay + 9 * scale)], fill=(110, 116, 128, 255))
    return img


def main() -> None:
    build = ROOT / "packages/desktop/build"
    big = mark(1024)
    # macOS tiles leave a margin like other Dock icons.
    mac = mark(1024, margin=0.08)
    for target in [build / "icon.png", build / "icon_installer.png", build / "icon_linux.png", build / "icon_windows.png"]:
        (mac if target.name == "icon.png" else big).save(target)
    write_png_set(build / "icons")
    write_png_set(ROOT / "public/logo/icons")
    mark(512).save(ROOT / "packages/desktop/src/renderer/public/logo/icons/512x512.png")
    ico_sizes = [(s, s) for s in (16, 24, 32, 48, 64, 128, 256)]
    for target in [build / "icon.ico", build / "icon_installer.ico", ROOT / "public/logo/icons/icon.ico"]:
        big.save(target, sizes=ico_sizes)
    for target in [build / "icon.icns", build / "icon_installer.icns", ROOT / "public/logo/icons/icon.icns"]:
        mac.save(target)
    # Empty-state watermark: monochrome alpha mark (tinted by the UI).
    mark(512, tile_bg=False, mono=True).save(ROOT / "public/logo/watermark.png")
    for s in (32, 64):
        mark(s).save(build / f"placeholder-tray-{s}.png")
    dmg_background(1).save(build / "dmg_background.png")
    dmg_background(2).save(build / "dmg_background@2x.png")
    print("icons written")


if __name__ == "__main__":
    main()
