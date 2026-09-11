"""Stretch a TrueType font horizontally and nothing else.

    python scripts/widen-font.py src/renderer/fonts/Hangyaku-0vRGR.ttf 1.06

Every outline's x coordinate and every advance width is multiplied by the
factor; the y coordinates are left alone. So a glyph comes out wider without
coming out taller, and — because the advance grows with the outline — the
spacing between characters is stretched by exactly as much as the characters
are. Nothing is squeezed together and nothing overlaps.

**The advance is what makes this different from a CSS `scaleX`.** A transform
is drawn after layout has already measured the run, so the box stays the width
it was and the type runs out of it; this app steps several runs down to fit by
measuring `scrollWidth` (the clock, the Sort field, the graph's `FitName`), and
every one of those measurements would be wrong. Widening the file means the
layout is measuring the type that is actually drawn.

A composite glyph carries its components' offsets in the *base* glyph's own
space, and its base has been stretched already, so the offset is scaled with
everything else and any 2x2 transform on it is conjugated by the scale
(S·T·S⁻¹) — which leaves a plain scale untouched and only matters to a
component that is rotated or sheared.

What is deliberately not touched: GPOS. Its x-advance adjustments (kerning,
`palt`) stay in the original units, so a kern is off by the factor — a unit or
two out of a thousand, which is under the rounding the rasteriser does anyway.

The font is renamed as it is written. A file whose outlines are not the ones
the family name stands for is a file that lies about itself, and the name is
what `@font-face` then declares.
"""

import sys
from pathlib import Path

from fontTools.ttLib import TTFont

SUFFIX = ' Wide'


def widen(src: Path, factor: float) -> Path:
    font = TTFont(str(src), recalcBBoxes=True)
    glyf = font['glyf']
    hmtx = font['hmtx']

    for name in font.getGlyphOrder():
        glyph = glyf[name]
        if glyph.isComposite():
            for part in glyph.components:
                part.x = round(part.x * factor)
                transform = getattr(part, 'transform', None)
                if transform is not None:
                    (a, b), (c, d) = transform
                    part.transform = ((a, b / factor), (c * factor, d))
        elif glyph.numberOfContours > 0:
            coords = glyph.coordinates
            for i in range(len(coords)):
                x, y = coords[i]
                coords[i] = (round(x * factor), y)

        advance, lsb = hmtx[name]
        hmtx[name] = (round(advance * factor), round(lsb * factor))

    # The bounds every glyph reports, and the whole font's, follow from the
    # coordinates rather than being stored twice; recalcBBoxes redoes head's
    # and hhea's on compile, and a glyph's own is redone here.
    for name in font.getGlyphOrder():
        glyph = glyf[name]
        if glyph.numberOfContours != 0:
            glyph.recalcBounds(glyf)

    os2 = font['OS/2']
    os2.xAvgCharWidth = round(os2.xAvgCharWidth * factor)

    # Say what it is. Family (1), full name (4), PostScript name (6) and the
    # typographic family (16) where the file carries one.
    for record in font['name'].names:
        if record.nameID not in (1, 4, 6, 16):
            continue
        text = record.toUnicode()
        if text.endswith(SUFFIX):
            continue
        record.string = text + (SUFFIX.replace(' ', '') if record.nameID == 6 else SUFFIX)

    # **The factor is in the name.** Overwriting one file left the dev server
    # handing back the same URL for different bytes, and Chromium went on
    # drawing the face it had already loaded — a regeneration that changed
    # nothing on the screen. A new factor is a new file and so a new fetch.
    tag = f'{round(factor * 100)}'
    out = src.with_name(f'{src.stem.split("-")[0]}-wide-{tag}.ttf')
    font.save(str(out))
    return out


def main() -> None:
    src = Path(sys.argv[1])
    factor = float(sys.argv[2]) if len(sys.argv) > 2 else 1.06
    out = widen(src, factor)
    print(f'{src.name} x{factor} -> {out.name} ({out.stat().st_size:,} bytes)')


if __name__ == '__main__':
    main()
