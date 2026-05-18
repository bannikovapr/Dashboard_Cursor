#!/usr/bin/env python3
"""
Вырезает только зелёную марку из горизонтального логотипа (иконка + слово «Деснол»).
Источник по умолчанию: assets/desnol-logo-banner.png
Результат: assets/dashboard-icon-master.png (RGBA, чёрный фон → прозрачный)
"""
from __future__ import annotations

import os
import sys

from PIL import Image


def _is_icon_pixel(r: int, g: int, b: int, a: int) -> bool:
    if a < 40:
        return False
    if r > 233 and g > 233 and b > 233:
        return False
    if r < 22 and g < 22 and b < 22:
        return False
    if g > r + 15 and g > b + 15:
        return True
    if g > 70 and g >= r - 5 and g >= b - 5 and (r < 180 or b < 180):
        return True
    return False


def _icon_bbox(im: Image.Image) -> tuple[int, int, int, int] | None:
    im = im.convert("RGBA")
    w, h = im.size
    minx, miny, maxx, maxy = w, h, 0, 0
    found = False
    for y in range(h):
        for x in range(w):
            if _is_icon_pixel(*im.getpixel((x, y))):
                found = True
                minx = min(minx, x)
                miny = min(miny, y)
                maxx = max(maxx, x)
                maxy = max(maxy, y)
    if not found:
        return None
    return (minx, miny, maxx, maxy)


def _strip_black(im: Image.Image, thr: int = 22) -> Image.Image:
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a and r <= thr and g <= thr and b <= thr:
                px[x, y] = (0, 0, 0, 0)
    return im


def main() -> None:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    default_src = os.path.join(root, "assets", "desnol-logo-banner.png")
    src = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else default_src
    if not os.path.isfile(src):
        raise SystemExit(f"Нет файла: {src}")

    out = os.path.join(root, "assets", "dashboard-icon-master.png")
    im = Image.open(src)
    box = _icon_bbox(im)
    if not box:
        raise SystemExit("Не найдены зелёные пиксели марки.")

    l, t, r, b = box
    margin = max(4, int(round(max(r - l, b - t) * 0.10)))
    l = max(0, l - margin)
    t = max(0, t - margin)
    r = min(im.width - 1, r + margin)
    b = min(im.height - 1, b + margin)

    cropped = im.crop((l, t, r + 1, b + 1)).convert("RGBA")
    cropped = _strip_black(cropped)
    cropped.save(out, "PNG", optimize=True)
    print(f"Wrote {out} from {src} crop=({l},{t},{r+1},{b+1}) size={cropped.size}")


if __name__ == "__main__":
    main()
