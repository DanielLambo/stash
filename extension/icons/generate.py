#!/usr/bin/env python3
"""Generate app icons for the Clipboard extension.
Run: python3 generate.py
Outputs icon-16.png, icon-48.png, icon-128.png.
"""
from PIL import Image, ImageDraw, ImageFilter
import math
import os

OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient_squircle(size, color_a=(10, 132, 255), color_b=(94, 92, 230)):
    """Render at 4x then downscale for crisp anti-aliased corners."""
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Diagonal gradient (a -> b)
    grad = Image.new("RGB", (s, s))
    gpx = grad.load()
    for y in range(s):
        for x in range(s):
            t = (x + y) / (2 * s)
            gpx[x, y] = lerp(color_a, color_b, t)

    # Squircle mask (rounded rectangle approximating a smooth squircle)
    mask = Image.new("L", (s, s), 0)
    mdraw = ImageDraw.Draw(mask)
    radius = int(s * 0.225)  # ~22.5% of side — typical app-icon corner ratio
    mdraw.rounded_rectangle((0, 0, s - 1, s - 1), radius=radius, fill=255)

    img.paste(grad, (0, 0), mask)

    # Subtle inner top-light highlight
    highlight = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    hdraw = ImageDraw.Draw(highlight)
    hdraw.rounded_rectangle((0, 0, s - 1, int(s * 0.55)), radius=radius, fill=(255, 255, 255, 30))
    highlight = highlight.filter(ImageFilter.GaussianBlur(radius=s * 0.04))
    img.alpha_composite(Image.composite(highlight, Image.new("RGBA", (s, s), (0, 0, 0, 0)), mask))

    # Clipboard glyph in white
    glyph = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glyph)

    # Body of clipboard (rounded rect outline)
    cx, cy = s / 2, s / 2 + s * 0.05
    body_w = s * 0.50
    body_h = s * 0.58
    body = (cx - body_w / 2, cy - body_h / 2, cx + body_w / 2, cy + body_h / 2)
    body_radius = int(body_w * 0.18)
    body_stroke = max(2, int(s * 0.04))
    gdraw.rounded_rectangle(body, radius=body_radius, outline=(255, 255, 255, 255), width=body_stroke)

    # Top clip
    clip_w = body_w * 0.55
    clip_h = s * 0.10
    clip_x = cx - clip_w / 2
    clip_y = cy - body_h / 2 - clip_h * 0.45
    gdraw.rounded_rectangle(
        (clip_x, clip_y, clip_x + clip_w, clip_y + clip_h),
        radius=int(clip_h * 0.35),
        fill=(255, 255, 255, 255),
    )

    # Lines
    line_thickness = max(2, int(s * 0.025))
    line_y_start = cy - body_h * 0.18
    line_x_pad = body_w * 0.22
    line_lengths = [body_w * 0.56, body_w * 0.40, body_w * 0.28]
    for i, w in enumerate(line_lengths):
        ly = line_y_start + i * (body_h * 0.18)
        opacity = [255, 200, 140][i]
        gdraw.rounded_rectangle(
            (cx - body_w / 2 + line_x_pad, ly,
             cx - body_w / 2 + line_x_pad + w, ly + line_thickness),
            radius=line_thickness // 2,
            fill=(255, 255, 255, opacity),
        )

    img.alpha_composite(glyph)

    # Soft drop shadow for depth (only visible at larger sizes)
    if size >= 48:
        shadow_layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        sd = ImageDraw.Draw(shadow_layer)
        sd.rounded_rectangle((0, int(s * 0.04), s - 1, s - 1 + int(s * 0.04)), radius=radius, fill=(0, 0, 0, 70))
        shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(radius=s * 0.03))
        composed = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        composed.alpha_composite(shadow_layer)
        composed.alpha_composite(img)
        img = composed

    return img.resize((size, size), Image.LANCZOS)


def main():
    for size in (16, 48, 128):
        icon = gradient_squircle(size)
        out = os.path.join(OUT_DIR, f"icon-{size}.png")
        icon.save(out, "PNG")
        print(f"wrote {out}")


if __name__ == "__main__":
    main()
