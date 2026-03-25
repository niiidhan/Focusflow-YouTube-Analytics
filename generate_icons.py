"""
Generate PNG icons for the YT Analytics Chrome Extension.
Run: python generate_icons.py
Requires: Pillow  (pip install Pillow)
"""
from PIL import Image, ImageDraw
import os, math

sizes = [16, 48, 128]
icons_dir = os.path.join(os.path.dirname(__file__), "icons")
os.makedirs(icons_dir, exist_ok=True)

def draw_rounded_rect(draw, xy, radius, fill):
    x0, y0, x1, y1 = xy
    draw.rectangle([x0 + radius, y0, x1 - radius, y1], fill=fill)
    draw.rectangle([x0, y0 + radius, x1, y1 - radius], fill=fill)
    draw.ellipse([x0, y0, x0 + 2*radius, y0 + 2*radius], fill=fill)
    draw.ellipse([x1 - 2*radius, y0, x1, y0 + 2*radius], fill=fill)
    draw.ellipse([x0, y1 - 2*radius, x0 + 2*radius, y1], fill=fill)
    draw.ellipse([x1 - 2*radius, y1 - 2*radius, x1, y1], fill=fill)

for size in sizes:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Dark background
    bg_r = max(2, int(size * 0.18))
    draw_rounded_rect(draw, (0, 0, size, size), bg_r, (15, 15, 17, 255))

    # Red YouTube badge
    pad    = max(1, int(size * 0.1))
    yt_y0  = int(size * 0.28)
    yt_y1  = int(size * 0.72)
    yt_r   = max(2, int(size * 0.1))
    draw_rounded_rect(draw, (pad, yt_y0, size - pad, yt_y1), yt_r, (255, 0, 0, 255))

    # White triangle
    cx, cy = size // 2, size // 2
    h      = int(size * 0.3)
    w      = int(size * 0.26)
    tx     = cx - int(w * 0.35)
    triangle = [
        (tx,         cy - h // 2),
        (tx + w,     cy),
        (tx,         cy + h // 2),
    ]
    draw.polygon(triangle, fill=(255, 255, 255, 255))

    out_path = os.path.join(icons_dir, f"icon{size}.png")
    img.save(out_path, "PNG")
    print(f"Saved {out_path}")

print("All icons generated!")
