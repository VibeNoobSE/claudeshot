"""Turn a logo PNG into compact 3D-extrudable rectangles.

The game is built from boxes, so the logo becomes boxes too: downsample, drop the
background by luminance, snap every remaining pixel to the logo's real palette,
then merge pixel runs into as few rectangles as possible.
"""
import json
from collections import Counter
from PIL import Image

BG_LUM = 0.72          # anything lighter than this is background
MERGE_DIST = 60        # squared-ish distance below which two palette entries are one

def lum(c):
    return (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114) / 255.0

def load(path, target_w):
    im = Image.open(path).convert("RGBA")
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    im = Image.alpha_composite(bg, im).convert("RGB")
    h = max(1, round(im.height * target_w / im.width))
    return im.resize((target_w, h), Image.LANCZOS)

def hsv(c):
    r, g, b = [v / 255.0 for v in c]
    mx, mn = max(r, g, b), min(r, g, b)
    v = mx
    sat = 0.0 if mx == 0 else (mx - mn) / mx
    return sat, v

def palette(im, want=3):
    """These logos are a neutral wordmark plus a saturated mark, so split on
    saturation rather than clustering — that keeps anti-aliasing blends from
    swallowing the accent colour."""
    ink = [p for p in list(im.getdata()) if lum(p) <= BG_LUM]
    if not ink:
        return []
    accent = [c for c in ink if hsv(c)[0] >= 0.35]
    neutral = [c for c in ink if hsv(c)[0] < 0.35 and hsv(c)[1] <= 0.45]
    out = []
    if neutral:
        n = len(neutral)
        out.append(tuple(sum(c[i] for c in neutral) // n for i in range(3)))
    if accent:
        # average only the most saturated pixels: those are the true brand colour
        accent.sort(key=lambda c: -hsv(c)[0])
        top = accent[:max(1, len(accent) * 2 // 5)]
        t = len(top)
        out.append(tuple(sum(c[i] for c in top) // t for i in range(3)))
    return out

def classify_px(c, cols):
    """Snap to accent if the pixel carries real colour, else to the neutral ink."""
    sat = hsv(c)[0]
    cands = cols
    if len(cols) == 2:
        cands = [cols[1]] if sat >= 0.30 else [cols[0]]
    return min(cands, key=lambda k: sum((a - b) ** 2 for a, b in zip(c, k)))

def rects(im, cols):
    w, h = im.size
    px = im.load()
    grid = [[None] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            c = px[x, y]
            if lum(c) > BG_LUM:
                continue
            grid[y][x] = classify_px(c, cols)
    runs = []
    for y in range(h):
        x = 0
        while x < w:
            c = grid[y][x]
            if c is None:
                x += 1
                continue
            x2 = x
            while x2 < w and grid[y][x2] == c:
                x2 += 1
            runs.append([x, y, x2 - x, 1, c])
            x = x2
    used = [False] * len(runs)
    by_key = {}
    for i, r in enumerate(runs):
        by_key.setdefault((r[0], r[2], r[4]), []).append(i)
    merged = []
    for i, r in enumerate(runs):
        if used[i]:
            continue
        used[i] = True
        for j in by_key[(r[0], r[2], r[4])]:
            if not used[j] and runs[j][1] == r[1] + r[3]:
                used[j] = True
                r[3] += 1
        merged.append(r)
    return merged

def preview(data, path, scale=6):
    w, h = data["grid"]
    im = Image.new("RGB", (w * scale, h * scale), (255, 255, 255))
    px = im.load()
    cols = [tuple(int(c[i:i+2], 16) for i in (1, 3, 5)) for c in data["colors"]]
    for x, y, rw, rh, ci in data["rects"]:
        for yy in range(y * scale, (y + rh) * scale):
            for xx in range(x * scale, (x + rw) * scale):
                px[xx, yy] = cols[ci]
    im.save(path)

def build(src, out, target_w, name, prev):
    im = load(src, target_w)
    cols = palette(im)
    rs = rects(im, cols)
    w, h = im.size
    data = {
        "name": name,
        "grid": [w, h],
        "colors": ["#%02x%02x%02x" % c for c in cols],
        "rects": [[r[0], r[1], r[2], r[3], cols.index(r[4])] for r in rs],
    }
    json.dump(data, open(out, "w"))
    preview(data, prev)
    print("%-7s %dx%d  palette=%s  rects=%d" % (name, w, h, data["colors"], len(rs)))

if __name__ == "__main__":
    import sys, os
    if len(sys.argv) < 3:
        print("usage: python3 tools/voxelize-logo.py <logo.png> <name> [grid_width]")
        print("  e.g. python3 tools/voxelize-logo.py frontend/assets/bookis-logo.png bookis 150")
        print("  writes frontend/assets/<name>-logo.json plus a preview PNG next to it")
        sys.exit(1)
    src, name = sys.argv[1], sys.argv[2]
    width = int(sys.argv[3]) if len(sys.argv) > 3 else 150
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(here, "frontend", "assets", name + "-logo.json")
    prev = os.path.join(here, "frontend", "assets", name + "-logo-preview.png")
    build(src, out, width, name, prev)
