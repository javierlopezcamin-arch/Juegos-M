#!/usr/bin/env python3
"""Genera los iconos de la app sin dependencias externas.

Dibuja un tótem de cuatro bandas, una por tema, sobre el fondo oscuro de la app.
Uso: python3 tools/make-icons.py
"""
import struct
import zlib
from pathlib import Path

BG = (21, 18, 16)
BANDS = [(91, 141, 184), (224, 138, 60), (111, 165, 124), (138, 111, 176)]
SS = 3  # supermuestreo para suavizar los bordes


def rounded_rect(x0, y0, x1, y1, r):
    def inside(x, y):
        if x < x0 or x > x1 or y < y0 or y > y1:
            return False
        cx = min(max(x, x0 + r), x1 - r)
        cy = min(max(y, y0 + r), y1 - r)
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
    return inside


def render(size, scale):
    """scale: proporción del lienzo que ocupa el dibujo (menor en maskable)."""
    big = size * SS
    pixels = [[BG] * big for _ in range(big)]

    art = big * scale
    left = (big - art * 0.52) / 2
    right = left + art * 0.52
    top = (big - art) / 2
    gap = art * 0.045
    band_h = (art - gap * 3) / 4

    shapes = []
    for i, color in enumerate(BANDS):
        y0 = top + i * (band_h + gap)
        inset = art * 0.055 * abs(1.5 - i) / 1.5
        shapes.append((rounded_rect(left + inset, y0, right - inset, y0 + band_h, band_h * 0.42), color))

    for y in range(big):
        row = pixels[y]
        for shape, color in shapes:
            for x in range(big):
                if shape(x + 0.5, y + 0.5):
                    row[x] = color

    out = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            r = g = b = 0
            for dy in range(SS):
                for dx in range(SS):
                    p = pixels[y * SS + dy][x * SS + dx]
                    r += p[0]; g += p[1]; b += p[2]
            n = SS * SS
            row += bytes((r // n, g // n, b // n))
        out.append(bytes(row))
    return out


def write_png(path, rows, size):
    raw = b''.join(b'\x00' + row for row in rows)

    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xffffffff)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    Path(path).write_bytes(png)
    print(path, size, 'px')


if __name__ == '__main__':
    Path('icons').mkdir(exist_ok=True)
    for name, size, scale in [
        ('icons/icon-192.png', 192, 0.74),
        ('icons/icon-512.png', 512, 0.74),
        ('icons/maskable-512.png', 512, 0.56),
    ]:
        write_png(name, render(size, scale), size)
