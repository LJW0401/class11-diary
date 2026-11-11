#!/usr/bin/env python3
"""把页面文案里真正用到的字，抽出来做字体子集。

为什么只做子集：LXGW WenKai 全量 24MB，中文全字库直接上 GH Pages 太重；
站点文案是固定的，把出现过（以及少量兜底标点）的字符抽出来，woff2 只有几十 KB。

职责边界
- 只扫 index.html / reader.html / assets/js/*.js 的文本内容，产出 woff2。
- 改文案后需要重跑本脚本，否则新字会掉回系统字体（不会报错，只是字形不同）。
- 不做：不写 @font-face（在 base.css 里），不碰图片。

用法
    python3 scripts/build_fonts.py
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "fonts"

WENKAI_SRC = Path("/tmp/fonts/LXGWWenKai-Regular.ttf")
GARAMOND_SRC = Path("/usr/share/fonts/opentype/ebgaramond/EBGaramond12-Regular.otf")

TEXT_FILES = [
    ROOT / "index.html",
    ROOT / "reader.html",
    *sorted((ROOT / "assets" / "js").glob("*.js")),
]

# 兜底：中英文标点、数字与常见符号，避免标点掉字。
EXTRA = (
    "，。、；：？！“”‘’（）《》〈〉【】「」『』—…·～"
    "0123456789%+-×÷=<>/\\|@#&*()[]{}\"'`~^_,.;:!?、 "
    "页第个册跨原片年代书架上一下自动翻阅缩略图全屏退出停止全部收起"
)


def collect_charset() -> str:
    chars = set(EXTRA)
    for path in TEXT_FILES:
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        # 去掉标签与代码噪音意义不大，直接全量取字更稳；这里只过滤掉控制字符。
        for ch in text:
            if ch.isspace():
                continue
            if ord(ch) < 32:
                continue
            chars.add(ch)
    ascii_chars = [c for c in chars if ord(c) < 128]
    cjk_chars = [c for c in chars if ord(c) >= 128]
    return "".join(sorted(ascii_chars)) + "".join(sorted(cjk_chars))


def run_subset(src: Path, dst: Path, text_file: Path, layout: str) -> None:
    if not src.exists():
        raise SystemExit(f"找不到字体源文件：{src}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable, "-m", "fontTools.subset",
        str(src),
        f"--text-file={text_file}",
        f"--output-file={dst}",
        "--flavor=woff2",
        "--no-hinting",
        "--desubroutinize",
        "--layout-features=" + layout,
        "--name-IDs=*",
        "--drop-tables+=DSIG",
        "--recalc-bounds",
    ]
    subprocess.run(cmd, check=True)
    print(f"  {dst.relative_to(ROOT)}  {dst.stat().st_size / 1024:.1f} KB")


def main() -> int:
    text = collect_charset()
    cjk = [c for c in text if ord(c) >= 128]
    print(f"字符集：{len(text)} 个（其中 CJK {len(cjk)} 个）")

    OUT.mkdir(parents=True, exist_ok=True)
    tmp = ROOT / ".cache-charset.txt"
    tmp.write_text(text, encoding="utf-8")
    try:
        print("WenKai 子集：")
        run_subset(WENKAI_SRC, OUT / "wenkai.woff2", tmp, "kern,liga,clig,calt")
        print("Garamond 子集：")
        latin = "".join(sorted({c for c in text if ord(c) < 128})) or "0123456789"
        tmp.write_text(latin, encoding="utf-8")
        run_subset(GARAMOND_SRC, OUT / "garamond.woff2", tmp, "kern,liga,clig,calt,onum")
    finally:
        tmp.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
