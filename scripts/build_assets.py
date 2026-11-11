#!/usr/bin/env python3
"""把「裁剪」后的书页原图，加工成站点可直接发布的 Web 资源。

职责边界
- 输入：抠图脚本产出的 PNG（透明底）与 JPG（白底）两套原图，以及本文件内的书目定义。
- 输出：`assets/books/<slug>/` 下的页图、缩略图、封面，以及 `assets/js/books-data.js` 清单。
- 不做：不碰页面结构与样式，不起服务，不上传。

关键取舍
- 页图输出为带 alpha 的 WebP：书页轮廓要真的「透」出来，翻页时才看得出纸的边。
- 每张跨页都要「重新装框」：中缝钉在 1600x1200 画布正中（x=800），纸的上下边钉在
  固定高度（y=64 与 y=1135），左右两页各自按自己那半的宽度缩放。
  源片是手持翻拍的，书在画面里忽大忽小、中缝也不在正中；不归一化的话，翻页时
  纸边会一页一跳。归一化之后每张纸都落在同一个矩形里，翻起来才稳。
- 中缝位置由 scripts/measure_folds.py 量出来写进 scripts/fold-lines.json，
  这里只负责按表装框；缺表就报错，不猜。
- 每页附带 40x30 的 base64 占位图：翻页瞬间先铺占位，再换上正图，避免白闪。

用法
    python3 scripts/measure_folds.py --write       # 换过原图先量中缝，写 fold-lines.json
    python3 scripts/build_assets.py                # 重建全部页图与清单
    python3 scripts/build_assets.py --copy-source  # 顺带复制原始 JPG 到 assets/source/
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import shutil
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC_JPG = Path("/home/penguin/Desktop/penguin/高中观察日记/裁剪/JPG")
SRC_PNG = Path("/home/penguin/Desktop/penguin/高中观察日记/裁剪/PNG")
OUT_BOOKS = ROOT / "assets" / "books"
OUT_SOURCE = ROOT / "assets" / "source" / "jpg"
OUT_DATA = ROOT / "assets" / "js" / "books-data.js"

PAGE_SIZE = (1600, 1200)
PAGE_QUALITY = 76
THUMB_SIZE = (400, 300)
THUMB_QUALITY = 62
COVER_SIZE = (900, 1200)
COVER_QUALITY = 80
PLACEHOLDER_SIZE = (40, 30)

# 归一化后的纸张矩形：中缝在正中的 x=800，左右各半页 770 宽，上下留 64/65 的白边。
PAPER_BOX = (30, 64, 1570, 1135)
FOLD_X = PAGE_SIZE[0] // 2
FOLD_TABLE = ROOT / "scripts" / "fold-lines.json"

# 书目与页序：先封面，再逐张跨页，最后封底。左右顺序即原片拍摄顺序。
BOOKS = [
    {
        "slug": "vol-1",
        "no": "壹",
        "title": "斜塔",
        "en": "The Leaning Tower",
        "cover": "IMG_5543",
        "back": "IMG_5643",
        "spreads": [f"IMG_{n}" for n in range(5548, 5642)],
    },
    {
        "slug": "vol-2",
        "no": "贰",
        "title": "暗香",
        "en": "An Xiang",
        "cover": "IMG_5644",
        "back": "IMG_5665",
        "spreads": [f"IMG_{n}" for n in range(5645, 5665)],
    },
]


def log(msg: str) -> None:
    print(msg, flush=True)


def page_stems(book: dict) -> list[str]:
    """按文件名顺序取出实际存在的跨页，缺号自动跳过（原片本身有断号）。"""
    stems = []
    for stem in book["spreads"]:
        if not (SRC_PNG / f"{stem}.png").exists():
            log(f"  ! 缺页 {stem}，跳过")
            continue
        stems.append(stem)
    return stems


def load_rgba(stem: str) -> Image.Image:
    """优先用透明底 PNG；没有就退回白底 JPG（白底会被当作不透明区域保留）。"""
    png = SRC_PNG / f"{stem}.png"
    if png.exists():
        return flatten_transparent(Image.open(png).convert("RGBA"))
    return flatten_transparent(Image.open(SRC_JPG / f"{stem}.jpg").convert("RGBA"))


def flatten_transparent(im: Image.Image, rgb=(10, 9, 7)) -> Image.Image:
    """把透明区域的 RGB 统一压成深色。

    原图透明处的 RGB 是白色；缩放时这些白像素会渗进书页边缘，网页上就成了一圈白边。
    先按 alpha 把外面的颜色换成近黑，再缩放，边缘混出来的就是一道柔和的暗边，
    在深色桌面上看着像纸张的投影，而不是发光的轮廓。
    """
    alpha = im.getchannel("A")
    solid = alpha.point(lambda v: 255 if v > 3 else 0)
    body = im.convert("RGB")
    base = Image.new("RGB", im.size, rgb)
    merged = Image.composite(body, base, solid)
    return Image.merge("RGBA", (*merged.split(), alpha))


def resize(im: Image.Image, size: tuple[int, int]) -> Image.Image:
    return im.resize(size, Image.LANCZOS)


def load_folds() -> dict[str, float]:
    if not FOLD_TABLE.exists():
        raise SystemExit(
            f"缺少 {FOLD_TABLE.relative_to(ROOT)}：先跑 python3 scripts/measure_folds.py --write"
        )
    table = json.loads(FOLD_TABLE.read_text())
    return {stem: float(row["fold"]) for stem, row in table.items()}


def frame_page(im: Image.Image, fold: float) -> Image.Image:
    """把一张跨页摆进固定画框：中缝对 x=800，纸的上下边对 PAPER_BOX。

    左右两页分别缩放：源片里中缝因为透视常常不在正中，两页拍出来的宽度不等；
    各自贴到自己那半的宽度上，纸的两条外边也就对齐了。
    """
    bbox = im.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError("整张图都是透明的")
    x0, y0, x1, y1 = bbox
    left, top, right, bottom = PAPER_BOX
    fold_px = int(round(fold))
    if not x0 < fold_px < x1:
        raise ValueError(f"中缝 {fold_px} 不在纸张范围内 {bbox}")

    height = bottom - top
    half_w = FOLD_X - left
    out = Image.new("RGBA", PAGE_SIZE, (0, 0, 0, 0))
    for sx0, sx1, dx in ((x0, fold_px, left), (fold_px, x1, FOLD_X)):
        crop = im.crop((sx0, y0, sx1, y1))
        out.paste(crop.resize((half_w, height), Image.LANCZOS), (dx, top))
    return out


def save_webp(im: Image.Image, path: Path, quality: int) -> int:
    im.save(path, "WEBP", quality=quality, method=6, alpha_quality=90)
    return path.stat().st_size


def placeholder(im: Image.Image) -> str:
    tiny = im.convert("RGBA").resize(PLACEHOLDER_SIZE, Image.LANCZOS)
    buf = io.BytesIO()
    tiny.save(buf, "WEBP", quality=40, method=4)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def build_book(book: dict) -> dict:
    slug = book["slug"]
    out = OUT_BOOKS / slug
    (out / "pages").mkdir(parents=True, exist_ok=True)
    (out / "thumbs").mkdir(parents=True, exist_ok=True)

    stems = page_stems(book)
    log(f"\n[{slug}] {book['title']} — {len(stems)} 个跨页")

    folds = load_folds()
    pages = []
    total_bytes = 0
    for i, stem in enumerate(stems, start=1):
        name = f"{i:03d}.webp"
        page_path = out / "pages" / name
        thumb_path = out / "thumbs" / name
        im = load_rgba(stem)
        if stem not in folds:
            raise SystemExit(
                f"{stem} 没有中缝记录：先跑 python3 scripts/measure_folds.py --write"
            )
        page = frame_page(im, folds[stem])
        total_bytes += save_webp(page, page_path, PAGE_QUALITY)
        total_bytes += save_webp(resize(page, THUMB_SIZE), thumb_path, THUMB_QUALITY)

        pages.append(
            {
                "src": f"assets/books/{slug}/pages/{name}",
                "thumb": f"assets/books/{slug}/thumbs/{name}",
                "ph": placeholder(page),
                "id": stem,
            }
        )
        if i % 10 == 0 or i == len(stems):
            log(f"  {i}/{len(stems)}")

    # 封面：首页书卡用竖版原图，带 alpha，直接叠在暗色桌面上。
    cover_im = resize(load_rgba(book["cover"]), COVER_SIZE)
    total_bytes += save_webp(cover_im, out / "cover.webp", COVER_QUALITY)
    back_im = resize(load_rgba(book["back"]), COVER_SIZE)
    total_bytes += save_webp(back_im, out / "back.webp", COVER_QUALITY)

    log(f"  资源体积 {total_bytes / 1024 / 1024:.1f} MB")
    return {
        "slug": slug,
        "no": book["no"],
        "title": book["title"],
        "en": book["en"],
        "cover": f"assets/books/{slug}/cover.webp",
        "back": f"assets/books/{slug}/back.webp",
        "count": len(pages),
        "pages": pages,
    }


def write_data(books: list[dict]) -> None:
    payload = {
        "generated": "build_assets.py",
        "pageAspect": PAGE_SIZE[0] / PAGE_SIZE[1],
        "books": books,
    }
    body = json.dumps(payload, ensure_ascii=False, indent=1)
    OUT_DATA.parent.mkdir(parents=True, exist_ok=True)
    OUT_DATA.write_text(
        "// 由 scripts/build_assets.py 生成，请勿手改。\n"
        f"window.BOOK_DATA = {body};\n",
        encoding="utf-8",
    )
    log(f"\n清单写入 {OUT_DATA.relative_to(ROOT)} "
        f"({OUT_DATA.stat().st_size / 1024:.0f} KB)")


def copy_source() -> None:
    OUT_SOURCE.mkdir(parents=True, exist_ok=True)
    files = sorted(SRC_JPG.glob("*.jpg"))
    log(f"复制原始 JPG {len(files)} 张 → {OUT_SOURCE.relative_to(ROOT)}")
    for f in files:
        target = OUT_SOURCE / f.name
        if not target.exists():
            shutil.copy2(f, target)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--copy-source", action="store_true", help="复制原始 JPG 到项目内")
    args = ap.parse_args()

    if not SRC_PNG.exists() or not SRC_JPG.exists():
        log(f"找不到原图目录：{SRC_PNG} / {SRC_JPG}")
        return 1

    if args.copy_source:
        copy_source()

    books = [build_book(b) for b in BOOKS]
    write_data(books)
    return 0


if __name__ == "__main__":
    sys.exit(main())
