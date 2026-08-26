#!/usr/bin/env python3
"""
Generate Peakora square app icon (hub-logo.png) + PWA manifest icons.
Dark Luxury Wellness aesthetic: obsidian gradient bg, amber/terracotta glow,
elegant serif "P" monogram. Produces a 1024 master, then 512 + 192 PNGs.
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os, math

OUT = "/workspace/project/Peakora-Assistant/assets"
FONT_PATH = "/tmp/fonts/PlayfairDisplay.ttf"

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def radial_gradient(size, inner, outer, center=None, radius=None):
    """Diagonal + radial blend for a soft glow on the dark canvas."""
    w = h = size
    img = Image.new("RGB", (w, h), outer)
    px = img.load()
    cx, cy = center or (w * 0.5, h * 0.62)
    r = radius or (w * 0.62)
    for y in range(h):
        for x in range(w):
            dx = x - cx
            dy = y - cy
            d = math.sqrt(dx * dx + dy * dy) / r
            t = max(0.0, 1.0 - min(d, 1.0))
            t = t * t
            px[x, y] = lerp(outer, inner, t * 0.55)
    return img

def make_master(size=1024):
    bg = radial_gradient(
        size,
        inner=(58, 32, 24),
        outer=(12, 10, 21),
        center=(size * 0.5, size * 0.58),
        radius=size * 0.66,
    )

    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([size * 0.18, size * 0.22, size * 0.82, size * 0.86], fill=(244, 162, 97, 120))
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.10))
    bg = Image.alpha_composite(bg.convert("RGBA"), glow)

    ring = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    margin = size * 0.085
    bbox = [margin, margin, size - margin, size - margin]
    rd.ellipse(bbox, outline=(244, 162, 97, 200), width=int(size * 0.012))
    ring = ring.filter(ImageFilter.GaussianBlur(2))
    bg = Image.alpha_composite(bg, ring)

    font = ImageFont.truetype(FONT_PATH, int(size * 0.62))
    letter = "P"
    txt = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    td = ImageDraw.Draw(txt)
    tb = td.textbbox((0, 0), letter, font=font)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    tx = (size - tw) / 2 - tb[0]
    ty = (size - th) / 2 - tb[1] - size * 0.02
    td.text((tx, ty), letter, font=font, fill=(255, 246, 232, 255))

    grad = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gpx = grad.load()
    top = (255, 246, 232)
    bot = (244, 162, 97)
    for y in range(size):
        t = y / size
        c = lerp(top, bot, t)
        for x in range(size):
            gpx[x, y] = (c[0], c[1], c[2], 255)
    letter_mask = txt.split()[3]
    grad_alpha = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    grad_alpha.paste(grad, (0, 0), letter_mask)

    letter_glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    letter_glow.paste((244, 162, 97, 90), (0, 0), letter_mask)
    letter_glow = letter_glow.filter(ImageFilter.GaussianBlur(size * 0.025))
    bg = Image.alpha_composite(bg, letter_glow)
    bg = Image.alpha_composite(bg, grad_alpha)

    return bg

master = make_master(1024)
master.convert("RGBA").save(os.path.join(OUT, "hub-logo-master.png"))

i512 = master.resize((512, 512), Image.LANCZOS)
i512.save(os.path.join(OUT, "hub-logo-512.png"))

i192 = master.resize((192, 192), Image.LANCZOS)
i192.save(os.path.join(OUT, "hub-logo-192.png"))

master.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, "hub-logo.png"))

print("Generated: hub-logo.png (512), hub-logo-192.png, hub-logo-512.png, hub-logo-master.png (1024)")
