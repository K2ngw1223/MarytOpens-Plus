# -*- coding: utf-8 -*-
"""
纯 Python（仅标准库）生成 MarytOpens 的 PWA / 通知图标。
无需 Pillow：自行做距离场抗锯齿光栅化 + zlib PNG 编码。

产物（写入 pages/assets/img/）：
  icon-192.png / icon-512.png   —— PWA 安装图标（渐变圆角底 + 白色 M）
  maskable-512.png              —— maskable 图标（内容缩到安全区）
  apple-touch-icon.png (180)    —— iOS 主屏图标
  badge-72.png                  —— 通知角标（透明底 + 纯白 M，供系统着色）
"""
import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pages', 'assets', 'img')

# 32x32 设计稿坐标（与 favicon.svg 一致）
LOGO_PTS = [(8, 23), (8, 10), (16, 19), (24, 10), (24, 23)]
LOGO_W = 2.8
GRAD_A = (0x63, 0x66, 0xF1)   # #6366f1
GRAD_B = (0x0E, 0xA5, 0xE9)   # #0ea5e9


def seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    L2 = vx * vx + vy * vy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / L2))
    dx, dy = wx - t * vx, wy - t * vy
    return math.sqrt(dx * dx + dy * dy)


def rrect_sdf(px, py, w, h, r):
    """圆角矩形有符号距离（<0 在内部）"""
    qx = abs(px - w / 2.0) - (w / 2.0 - r)
    qy = abs(py - h / 2.0) - (h / 2.0 - r)
    ax, ay = max(qx, 0.0), max(qy, 0.0)
    return math.sqrt(ax * ax + ay * ay) + min(max(qx, qy), 0.0) - r


def cov(d, aa=0.7):
    """距离 → 覆盖率（0..1），d<0 为内部"""
    return max(0.0, min(1.0, 0.5 - d / aa))


def render(size, scale=1.0, background=True, radius_ratio=0.25):
    """返回 RGBA bytes。scale 为 logo 相对画布的缩放（maskable 用 0.72）"""
    px = bytearray(size * size * 4)
    k = size / 32.0
    r = size * radius_ratio
    # logo 变换：以画布中心为基准缩放
    def to_canvas(p):
        x = (p[0] - 16) * k * scale + size / 2.0
        y = (p[1] - 16) * k * scale + size / 2.0
        return (x, y)
    pts = [to_canvas(p) for p in LOGO_PTS]
    half = LOGO_W * k * scale / 2.0

    for y in range(size):
        for x in range(size):
            cx, cy = x + 0.5, y + 0.5
            R = G = B = 0
            A = 0.0
            if background:
                a_bg = cov(rrect_sdf(cx, cy, size, size, r), aa=1.2)
                if a_bg > 0:
                    t = (cx + cy) / (2.0 * size)
                    R = GRAD_A[0] + (GRAD_B[0] - GRAD_A[0]) * t
                    G = GRAD_A[1] + (GRAD_B[1] - GRAD_A[1]) * t
                    B = GRAD_A[2] + (GRAD_B[2] - GRAD_A[2]) * t
                    A = a_bg
            # 白色 M 描边
            dmin = min(seg_dist(cx, cy, *pts[i], *pts[i + 1]) for i in range(len(pts) - 1))
            a_fg = cov(dmin - half, aa=max(1.0, k * scale))
            if a_fg > 0:
                R = R * (1 - a_fg) + 255 * a_fg
                G = G * (1 - a_fg) + 255 * a_fg
                B = B * (1 - a_fg) + 255 * a_fg
                A = A + (1 - A) * a_fg
            o = (y * size + x) * 4
            px[o] = int(round(R)); px[o + 1] = int(round(G))
            px[o + 2] = int(round(B)); px[o + 3] = int(round(A * 255))
    return bytes(px)


def write_png(path, size, rgba):
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)
        raw += rgba[y * stride:(y + 1) * stride]

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
    return len(png)


def main():
    os.makedirs(OUT, exist_ok=True)
    jobs = [
        ('icon-192.png', 192, dict(scale=1.0, background=True)),
        ('icon-512.png', 512, dict(scale=1.0, background=True)),
        ('maskable-512.png', 512, dict(scale=0.68, background=True, radius_ratio=0.5)),
        ('apple-touch-icon.png', 180, dict(scale=1.0, background=True, radius_ratio=0.0)),
        ('badge-72.png', 72, dict(scale=1.15, background=False)),
    ]
    for name, size, kw in jobs:
        data = render(size, **kw)
        n = write_png(os.path.join(OUT, name), size, data)
        print(f'{name:22s} {size:>4d}px  {n:>7d} bytes')


if __name__ == '__main__':
    main()
