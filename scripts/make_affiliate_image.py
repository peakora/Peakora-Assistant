#!/usr/bin/env python3
"""
Generate the 'Share Peakora, earn 50% recurring' section image.

Matches the dark-luxury aesthetic of the hero + real-life images:
obsidian canvas, warm terracotta/honey glow, amethyst accents. Depicts a
sharing/partnership moment - two soft warm light figures connected by a
glowing thread, symbolising recommendation + recurring reward - in the
same warm, calm, abstract style as the rest of the landing imagery.
"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import os, math, random

random.seed(7)
OUT = "/workspace/project/Peakora-Assistant/src/assets/images"
os.makedirs(OUT, exist_ok=True)
W, H = 1200, 896


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def vertical_gradient(w, h, top, bot):
    img = Image.new("RGB", (w, h), top)
    px = img.load()
    for y in range(h):
        c = lerp(top, bot, y / h)
        for x in range(w):
            px[x, y] = c
    return img


def add_glow(img, cx, cy, radius, color, alpha=120):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=color + (alpha,))
    layer = layer.filter(ImageFilter.GaussianBlur(radius * 0.5))
    return Image.alpha_composite(img.convert("RGBA"), layer)


def soft_figure(img, cx, base_y, scale, hue):
    """Abstract human-like warm silhouette: head + shoulders, soft glow."""
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    # aura
    aura = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ad = ImageDraw.Draw(aura)
    ad.ellipse([cx - 180 * scale, base_y - 320 * scale, cx + 180 * scale, base_y + 80 * scale],
               fill=hue + (70,))
    aura = aura.filter(ImageFilter.GaussianBlur(60))
    layer = Image.alpha_composite(layer, aura)
    d = ImageDraw.Draw(layer)
    # head
    hr = 34 * scale
    d.ellipse([cx - hr, base_y - 250 * scale - hr, cx + hr, base_y - 250 * scale + hr], fill=hue + (235,))
    # shoulders (rounded blob)
    sw = 110 * scale
    sh = 90 * scale
    d.pieslice([cx - sw, base_y - 170 * scale - sh, cx + sw, base_y - 170 * scale + sh],
               180, 360, fill=hue + (225,))
    layer = layer.filter(ImageFilter.GaussianBlur(2.5))
    return Image.alpha_composite(img.convert("RGBA"), layer)


# Base: obsidian -> deep terracotta-tinted bottom.
img = vertical_gradient(W, H, (14, 11, 24), (10, 8, 18))

# Ambient warm glow, lower-left.
img = add_glow(img, W * 0.30, H * 0.62, 360, (224, 122, 95), 90)
# Amethyst glow, upper-right.
img = add_glow(img, W * 0.74, H * 0.30, 320, (167, 139, 250), 70)
# Honey highlight, center.
img = add_glow(img, W * 0.50, H * 0.50, 300, (244, 162, 97), 60)

# Two connected warm figures (a recommendation/partnership motif).
img = soft_figure(img, W * 0.36, H * 0.78, 1.25, (244, 162, 97))
img = soft_figure(img, W * 0.66, H * 0.70, 1.05, (224, 122, 95))

# Glowing connecting thread between the two (the referral link).
thread = Image.new("RGBA", img.size, (0, 0, 0, 0))
td = ImageDraw.Draw(thread)
p1 = (W * 0.40, H * 0.55)
p2 = (W * 0.62, H * 0.52)
mid = ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2 - 40)
td.line([p1, mid, p2], fill=(255, 224, 180, 180), width=4)
# glowing dots at the endpoints
for p, r in [(p1, 12), (p2, 12), (mid, 8)]:
    td.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=(255, 236, 200, 230))
thread_glow = thread.filter(ImageFilter.GaussianBlur(8))
img = Image.alpha_composite(img, thread_glow)
img = Image.alpha_composite(img, thread)

# Floating amber sparkles (recurring reward / momentum).
spark = Image.new("RGBA", img.size, (0, 0, 0, 0))
sd = ImageDraw.Draw(spark)
for _ in range(40):
    x = random.randint(int(W * 0.1), int(W * 0.9))
    y = random.randint(int(H * 0.1), int(H * 0.85))
    r = random.choice([1, 1, 2, 2, 3])
    a = random.randint(80, 200)
    sd.ellipse([x - r, y - r, x + r, y + r], fill=(255, 220, 170, a))
spark = spark.filter(ImageFilter.GaussianBlur(0.6))
img = Image.alpha_composite(img, spark)

# Soft vignette to match the photographic depth of the hero image.
vig = Image.new("RGBA", img.size, (0, 0, 0, 0))
vd = ImageDraw.Draw(vig)
for i in range(60):
    a = int(i * 2.2)
    vd.rectangle([i, i, W - i, H - i], outline=(0, 0, 0, a))
img = Image.alpha_composite(img, vig)

final = img.convert("RGB")
path = os.path.join(OUT, "peakora_affiliate_dark_warm.png")
final.save(path, optimize=True)
print("Saved", path, final.size)
