#!/usr/bin/env python3
"""
Сборка assets/toir-dashboard.ico.

Приоритет источников:
  1) assets/dashboard-icon-master.png или desnol-userpic.png — если длинная сторона ≥
     MIN_PNG_LONG_SIDE (мелкий растр иначе физически обрезан);
  2) иначе векторная марка как в desnol-mark.svg (полные ромб и шевроны).

Эталон из репозитория часто бывает мелким (десятки пикселей): перед сборкой слоёв мастер
апскейлится до min 512 px по большей стороне, иначе 256×256 слой получается «мягким».

Фон: по цвету углов (белый/чёрный), без общего порога «всё что светлее 245» —
он срезал светло-зелёное сглаживание и обрезал марку.

Pillow: первый кадр ICO обязан быть максимального размера (256×256), иначе остальные
слои не попадут в файл (см. IcoImagePlugin._save).

Эталон вписывается в ~68% стороны квадрата (поля), чтобы Explorer не обрезал марку.
"""
from __future__ import annotations

import os
from PIL import Image, ImageDraw, ImageFilter

SIZES = (16, 24, 32, 48, 64, 128, 256)
MASTER_MIN_SIDE = 512

# Экспорт марки меньше этого по длинной стороне часто уже урезан (как 86×65) —
# тогда для .ico используем вектор desnol-mark (полная геометрия).
MIN_PNG_LONG_SIDE = 180

FILL = (30, 215, 96, 255)
POLYGONS = [
    [(10, 30), (24, 16), (32, 24), (18, 38)],
    [(32, 44), (54, 22), (62, 30), (40, 52)],
    [(54, 58), (84, 28), (92, 36), (62, 66)],
]
MINX, MINY, MAXX, MAXY = 10, 16, 92, 66


def _strip_background_corners(im: Image.Image) -> Image.Image:
    """
    Убираем фон по цвету углов. Для светлого фона допуск должен быть жёстким: иначе
    антиалиас «бело-зелёный» ошибочно попадает под «почти белый» и срезаются боковые
    части марки (визуально «половина логотипа»).
    """
    im = im.convert("RGBA")
    w, h = im.size
    samples = (
        im.getpixel((0, 0))[:3],
        im.getpixel((w - 1, 0))[:3],
        im.getpixel((0, h - 1))[:3],
        im.getpixel((w - 1, h - 1))[:3],
    )
    br = round(sum(s[0] for s in samples) / len(samples))
    bg_ = round(sum(s[1] for s in samples) / len(samples))
    bb = round(sum(s[2] for s in samples) / len(samples))
    luma = (br + bg_ + bb) / 3

    if luma >= 200:
        tolerance = 8
    elif luma <= 55:
        tolerance = 12
    else:
        tolerance = 18

    px = im.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if not a:
                continue
            if max(abs(r - br), abs(g - bg_), abs(b - bb)) <= tolerance:
                px[x, y] = (0, 0, 0, 0)
    return im


def _crop_content_with_margin(im: Image.Image, margin_ratio: float = 0.07) -> Image.Image:
    bbox = im.getbbox()
    if not bbox:
        return im
    l, t, r, b = bbox
    cw = r - l
    ch = b - t
    margin = max(2, int(round(max(cw, ch) * margin_ratio)))
    l2 = max(0, l - margin)
    t2 = max(0, t - margin)
    r2 = min(im.width, r + margin)
    b2 = min(im.height, b + margin)
    return im.crop((l2, t2, r2, b2))


def _inset_logo_on_square(im: Image.Image, fill_ratio: float = 0.70) -> Image.Image:
    """
    Уменьшает марку внутри квадрата: занимает ~fill_ratio стороны, по краям прозрачное поле.
    Так ярлык в Explorer не «подрезает» геометрию по краям.
    """
    im = im.convert("RGBA")
    w, h = im.size
    side = max(w, h)
    if w != h:
        im = _square_rgba(im)
        w = h = im.size[0]
        side = w
    bbox = im.getbbox()
    if not bbox:
        return im
    l, t, r, b = bbox
    content = im.crop((l, t, r + 1, b + 1))
    cw, ch = content.size
    max_inner = max(1, int(side * fill_ratio))
    scale = min(max_inner / cw, max_inner / ch)
    nw = max(1, int(round(cw * scale)))
    nh = max(1, int(round(ch * scale)))
    resized = content.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(resized, ((side - nw) // 2, (side - nh) // 2), resized)
    return canvas


def _square_rgba(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    if w == h:
        return im
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - w) // 2, (side - h) // 2), im)
    return canvas
    w, h = im.size
    m = max(w, h)
    if m >= min_side:
        return im
    scale = min_side / m
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    return im.resize((nw, nh), Image.Resampling.LANCZOS)


def _layer_from_master(master: Image.Image, target: int) -> Image.Image:
    if target <= 0:
        raise ValueError(target)
    base = master.resize((target, target), Image.Resampling.LANCZOS)
    if target <= 48:
        base = base.filter(ImageFilter.UnsharpMask(radius=0.65, percent=80, threshold=2))
    return base


def _layers_from_png(png_path: str) -> list[Image.Image]:
    raw = Image.open(png_path).convert("RGBA")
    corners_a = [
        raw.getpixel((0, 0))[3],
        raw.getpixel((raw.width - 1, 0))[3],
        raw.getpixel((0, raw.height - 1))[3],
        raw.getpixel((raw.width - 1, raw.height - 1))[3],
    ]
    if all(a > 200 for a in corners_a):
        raw = _strip_background_corners(raw)
    raw = _crop_content_with_margin(raw)
    raw = _square_rgba(raw)
    raw = _inset_logo_on_square(raw, fill_ratio=0.68)
    master = _bump_master_resolution(raw)
    return [_layer_from_master(master, t) for t in SIZES]


def _map_points(target: int, supersample: int) -> list[list[tuple[float, float]]]:
    s = target * supersample
    pad = s * 0.12
    bw = MAXX - MINX
    bh = MAXY - MINY
    scale = (s - 2 * pad) / max(bw, bh)
    ox = (s - bw * scale) / 2 - MINX * scale
    oy = (s - bh * scale) / 2 - MINY * scale

    def t(p):
        return (ox + p[0] * scale, oy + p[1] * scale)

    return [[t(p) for p in poly] for poly in POLYGONS]


def _render_vector_master(output_side: int, supersample: int = 4) -> Image.Image:
    s = output_side * supersample
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for poly in _map_points(output_side, supersample):
        draw.polygon(poly, fill=FILL)
    return img.resize((output_side, output_side), Image.Resampling.LANCZOS)


def _layers_vector_fallback() -> list[Image.Image]:
    master = _render_vector_master(512, 4)
    master = _inset_logo_on_square(master, fill_ratio=0.68)
    return [_layer_from_master(master, t) for t in SIZES]


def _save_ico(path: str, layers: list[Image.Image]) -> None:
    largest = layers[-1]
    smaller = layers[:-1]
    largest.save(
        path,
        format="ICO",
        sizes=[(im.width, im.height) for im in layers],
        append_images=smaller,
        bitmap_format="bmp",
    )


def _pick_png_source(root: str) -> str | None:
    preferred = os.path.join(root, "assets", "dashboard-icon-master.png")
    fallback = os.path.join(root, "assets", "desnol-userpic.png")

    if os.path.isfile(preferred):
        with Image.open(preferred) as im:
            if max(im.size) >= MIN_PNG_LONG_SIDE:
                return preferred
        # Файл есть, но слишком мелкий (частый случай — кропнутая экспортная картинка):
        # не падаем на userpic с другой подложкой — сборщик возьмёт вектор.
        return None

    if os.path.isfile(fallback):
        with Image.open(fallback) as im:
            if max(im.size) >= MIN_PNG_LONG_SIDE:
                return fallback
    return None


def main() -> None:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(root, "assets", "toir-dashboard.ico")
    png_path = _pick_png_source(root)

    if png_path:
        images = _layers_from_png(png_path)
        src = f"PNG {png_path}"
    else:
        images = _layers_vector_fallback()
        src = "vector fallback (desnol-mark)"

    _save_ico(out, images)
    print(f"Wrote {out} from {src} sizes={list(SIZES)}")


if __name__ == "__main__":
    main()
