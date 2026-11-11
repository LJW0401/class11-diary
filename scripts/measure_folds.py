#!/usr/bin/env python3
"""量出每个跨页原图里的中缝位置，写进 fold-lines.json 供 build_assets.py 使用。

中缝是两页纸相接处的那条暗缝：左右两页在这里各自向下弯，形成一条比两侧
都暗的窄带。所以按列取亮度的低分位数（抗字迹），找一条最暗的窄带即可。
只在包围盒中线附近 ±5% 找，避免锁到页面里的竖笔或书脊装订线。

用法：
  python3 scripts/measure_folds.py            # 量一遍，报告置信度
  python3 scripts/measure_folds.py --write    # 写回 scripts/fold-lines.json
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC_PNG = Path("/home/penguin/Desktop/penguin/高中观察日记/裁剪/PNG")
OUT = ROOT / "scripts" / "fold-lines.json"

SEARCH = 0.055  # 在中线左右各找 5.5% 宽度
WIDTH = 1200  # 分析用的缩放宽度


def spread_stems() -> list[str]:
    data = json.loads((ROOT / "assets/js/books-data.js").read_text().split("=", 1)[1].strip().rstrip(";"))
    stems: list[str] = []
    for book in data["books"]:
        stems += [p["id"] for p in book["pages"]]
    return stems


def column_profile(gray: Image.Image) -> list[float]:
    """每列的低分位数亮度：中缝在绝大多数行上都暗，字迹只在少数行上暗。"""
    w, h = gray.size
    px = gray.load()
    prof = []
    for x in range(w):
        vals = sorted(px[x, y] for y in range(0, h, 2))
        prof.append(vals[int(len(vals) * 0.4)])
    return prof


def smooth(vals: list[float], k: int = 4) -> list[float]:
    out = []
    for i in range(len(vals)):
        lo, hi = max(0, i - k), min(len(vals), i + k + 1)
        out.append(sum(vals[lo:hi]) / (hi - lo))
    return out


def measure(stem: str) -> dict:
    im = Image.open(SRC_PNG / f"{stem}.png").convert("RGBA")
    bbox = im.getchannel("A").getbbox()
    if bbox is None:
        raise SystemExit(f"{stem}: 整张图都是透明的")
    x0, y0, x1, y1 = bbox
    bw = x1 - x0
    # 上下各留 8%，避开纸边与装订
    top = y0 + int((y1 - y0) * 0.08)
    bot = y1 - int((y1 - y0) * 0.08)
    gray = im.crop((x0, top, x1, bot)).convert("L")
    scale = WIDTH / gray.width
    gray = gray.resize((WIDTH, max(1, int(gray.height * scale))), Image.LANCZOS)

    prof = smooth(column_profile(gray))
    center = WIDTH / 2
    lo = max(2, int(center - WIDTH * SEARCH))
    hi = min(WIDTH - 3, int(center + WIDTH * SEARCH))
    best = min(range(lo, hi), key=lambda i: prof[i])

    # 置信度：谷底比两侧平均暗多少
    span = 26
    left = sum(prof[max(0, best - span - 8):best - span]) / 8
    right = sum(prof[best + span:best + span + 8]) / 8
    contrast = (left + right) / 2 - prof[best]

    return {
        "stem": stem,
        "bbox": bbox,
        "fold": round(x0 + best / scale, 1),
        "offset_pct": round((x0 + best / scale - (x0 + x1) / 2) / bw * 100, 2),
        "contrast": round(contrast, 1),
        "at_edge": best <= lo + 1 or best >= hi - 2,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="写回 fold-lines.json")
    ap.add_argument("--only", default="", help="只量这些 stem，逗号分隔")
    args = ap.parse_args()

    stems = args.only.split(",") if args.only else spread_stems()
    rows = [measure(s) for s in stems]

    weak = [r for r in rows if r["contrast"] < 12 or r["at_edge"]]
    offs = [abs(r["offset_pct"]) for r in rows]
    print(f"跨页 {len(rows)} 张")
    print(f"中缝偏移 |%|: 中位 {statistics.median(offs):.2f}  P90 {sorted(offs)[int(len(offs)*0.9)]:.2f}  最大 {max(offs):.2f}")
    print(f"置信度(谷深): 中位 {statistics.median(r['contrast'] for r in rows):.1f}  最低 {min(r['contrast'] for r in rows):.1f}")
    if weak:
        print(f"需要人眼复核 {len(weak)} 张：")
        for r in sorted(weak, key=lambda r: r["contrast"]):
            print(f"  {r['stem']}  偏移 {r['offset_pct']:+.2f}%  谷深 {r['contrast']:.1f}  触边 {r['at_edge']}")

    if args.write:
        old = json.loads(OUT.read_text()) if OUT.exists() else {}
        for r in rows:
            old[r["stem"]] = {"fold": r["fold"], "bbox": r["bbox"], "contrast": r["contrast"]}
        OUT.write_text(json.dumps(dict(sorted(old.items())), ensure_ascii=False, indent=1) + "\n")
        print(f"已写入 {OUT.relative_to(ROOT)}（{len(old)} 条）")


if __name__ == "__main__":
    sys.exit(main())
