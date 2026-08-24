#!/usr/bin/env python3
"""Generates the Roster app icon.

The mark is a roster: ragged-right rows in the accent square, the top one
amber to nod at the status vocabulary the app uses everywhere else.

Three rows stop resolving below about 20px — the gaps close up and the
faintest row disappears — so small sizes get a two-row cut on a slightly
larger body, which is the same simplification Apple's own icons make.

src/components/Logo.tsx draws the small profile on a 16-unit viewBox for the
sidebar. Keep the two in step.

Run: python3 scripts/make-icon.py
"""
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"

CANVAS = 1024
ACCENT_TOP = (143, 116, 255)
ACCENT_BOTTOM = (100, 66, 240)

AMBER = (255, 202, 112, 255)
BRIGHT = (255, 255, 255, 224)
FAINT = (255, 255, 255, 122)

# PIL's shape drawing is aliased, so everything is drawn large and reduced.
SUPERSAMPLE = 4


@dataclass(frozen=True)
class Profile:
    """How the mark is laid out, in units of the 1024 canvas."""

    body: int
    radius: int
    thickness: int
    gap: int
    x: int
    rows: tuple[tuple[int, tuple[int, int, int, int]], ...]


# macOS draws app icons on a 1024 grid with the body inset; matching it keeps
# Roster the same visual weight as everything else in the dock.
FULL = Profile(
    body=824,
    radius=185,
    thickness=66,
    gap=72,
    x=190,
    rows=((444, AMBER), (326, BRIGHT), (212, FAINT)),
)

SMALL = Profile(
    body=904,
    radius=210,
    thickness=116,
    gap=104,
    x=190,
    rows=((524, AMBER), (356, BRIGHT)),
)

# Below this, three rows blur into one another.
SMALL_MAX = 20


def profile_for(size: int) -> Profile:
    return SMALL if size <= SMALL_MAX else FULL


def accent_gradient(size: int) -> Image.Image:
    """A vertical accent wash — flat purple reads dead at icon scale."""
    gradient = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / (size - 1)
        gradient.putpixel(
            (0, y),
            tuple(round(a + (b - a) * t) for a, b in zip(ACCENT_TOP, ACCENT_BOTTOM)),
        )
    return gradient.resize((size, size), Image.BICUBIC)


def render(size: int) -> Image.Image:
    spec = profile_for(size)
    s = size * SUPERSAMPLE
    scale = s / CANVAS

    def px(value: float) -> int:
        return round(value * scale)

    icon = Image.new("RGBA", (s, s), (0, 0, 0, 0))

    body = px(spec.body)
    mask = Image.new("L", (body, body), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, body - 1, body - 1), radius=px(spec.radius), fill=255
    )
    inset = (s - body) // 2
    icon.paste(accent_gradient(body), (inset, inset), mask)

    draw = ImageDraw.Draw(icon)
    count = len(spec.rows)
    total = count * spec.thickness + (count - 1) * spec.gap
    top = (spec.body - total) / 2
    for index, (length, color) in enumerate(spec.rows):
        y = top + index * (spec.thickness + spec.gap)
        draw.rounded_rectangle(
            (
                inset + px(spec.x),
                inset + px(y),
                inset + px(spec.x + length),
                inset + px(y + spec.thickness),
            ),
            radius=px(spec.thickness / 2),
            fill=color,
        )

    return icon.resize((size, size), Image.LANCZOS)


def main() -> int:
    BUILD.mkdir(exist_ok=True)
    render(CANVAS).save(BUILD / "icon.png")

    iconset = BUILD / "icon.iconset"
    iconset.mkdir(exist_ok=True)
    for base in (16, 32, 128, 256, 512):
        render(base).save(iconset / f"icon_{base}x{base}.png")
        render(base * 2).save(iconset / f"icon_{base}x{base}@2x.png")

    result = subprocess.run(
        ["iconutil", "-c", "icns", str(iconset), "-o", str(BUILD / "icon.icns")]
    )
    if result.returncode != 0:
        print("iconutil failed; icon.icns not written", file=sys.stderr)
        return result.returncode

    for stale in iconset.iterdir():
        stale.unlink()
    iconset.rmdir()
    print(f"wrote {BUILD/'icon.png'} and {BUILD/'icon.icns'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
