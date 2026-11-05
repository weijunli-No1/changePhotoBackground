#!/usr/bin/env python3
"""Bundle the existing TDesign 0.4.1 icon font, preserving glyph names.

Usage: python3 scripts/bundle-icon-font.py /path/to/t.woff
Official source: https://tdesign.gtimg.com/icon/0.4.1/fonts/t.woff
TDesign license is retained alongside the component. No runtime network requests.
"""
import base64
import json
from pathlib import Path
import re
import shutil
import sys

root = Path(__file__).resolve().parents[1]
vendor = root / "mini-program/node_modules/tdesign-miniprogram"
target = root / "mini-program/components/local-icon"
font = Path(sys.argv[1]).read_bytes()
if not font.startswith(b"wOFF"):
    raise ValueError("Expected a WOFF font")
css = (vendor / "miniprogram_dist/icon/icon.wxss").read_text()
glyphs = {name: chr(int(code, 16)) for name, code in re.findall(
    r"\.t-icon-([\w-]+):before\{content:'\\([0-9A-Fa-f]+)';\}", css
)}
if len(glyphs) < 100:
    raise ValueError("Unexpected TDesign glyph mapping")
target.mkdir(exist_ok=True, parents=True)
(target / "glyphs.js").write_text("module.exports = " + json.dumps(glyphs, ensure_ascii=True, separators=(",", ":")) + ";\n")
encoded = base64.b64encode(font).decode()
(target / "index.wxss").write_text(
    "/* TDesign icon font 0.4.1, MIT; see TDesign-LICENSE.txt. */\n"
    "@font-face{font-family:sg-tdesign;src:url(\"data:font/woff;base64," + encoded + "\") format(\"woff\");font-weight:400;font-style:normal;}\n"
    ".icon{display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;line-height:1;flex-shrink:0;}\n"
    ".glyph{font-family:sg-tdesign!important;font-style:normal;font-weight:400;line-height:1;text-align:center;}\n"
    ".image-icon{width:100%;height:100%;}\n"
)
shutil.copyfile(vendor / "LICENSE", target / "TDesign-LICENSE.txt")
print(f"Bundled {len(glyphs)} TDesign glyphs, {len(font)} font bytes.")
