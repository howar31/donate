#!/usr/bin/env python3
"""Builds the deployable site: src/ -> dist/.

Copies src/ as is, except that every src/skins/*.css is inlined into the marked region of
index.html (comments stripped, relative url() paths re-rooted to skins/), so the served page
needs no stylesheet request: it paints complete, in its chosen skin, as soon as the HTML
arrives. The .css sources are not copied; skin assets (images) are.

    python3 tools/build.py            # writes dist/
    python3 tools/build.py --out DIR  # writes elsewhere (used by tests/verify.js)

Deterministic: the same sources always produce the same output.
"""
import argparse
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BEGIN = '/* skins:begin */'
END = '/* skins:end */'


def inline_skin(path: Path) -> str:
    css = path.read_text(encoding='utf-8')
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    # a bare relative file name (e.g. url('tile.webp')) is resolved from skins/ in the
    # source and from / in the page; data: URIs and absolute URLs are left alone
    css = re.sub(r"url\((['\"]?)([\w.-]+\.(?:webp|png|jpe?g|gif|svg|avif))\1\)", r"url(\1skins/\2\1)", css)
    for ref in re.findall(r"url\(['\"]?skins/([^'\")]+)", css):
        if not (path.parent / ref).is_file():
            sys.exit(f'{path.name}: references skins/{ref}, which does not exist')
    lines = [line.rstrip() for line in css.splitlines()]
    css = '\n'.join(line for line in lines if line.strip())
    return f'/* {path.stem} */\n{css}'


def build(src: Path, out: Path) -> None:
    template = (src / 'index.html').read_text(encoding='utf-8')
    if template.count(BEGIN) != 1 or template.count(END) != 1:
        sys.exit(f'{src / "index.html"}: expected exactly one {BEGIN} and one {END}')
    skins = sorted((src / 'skins').glob('*.css'))
    if not skins:
        sys.exit(f'{src / "skins"}: no skins found')
    head, rest = template.split(BEGIN)
    _, tail = rest.split(END)
    css = '\n'.join(inline_skin(p) for p in skins)
    html = f'{head}{BEGIN}\n{css}\n{END}{tail}'

    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(src, out, ignore=shutil.ignore_patterns('*.css', '.DS_Store'))
    (out / 'index.html').write_text(html, encoding='utf-8')
    print(f'{out / "index.html"}: {len(html.encode())} bytes, {len(skins)} skins inlined')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--src', default=ROOT / 'src', type=Path)
    ap.add_argument('--out', default=ROOT / 'dist', type=Path)
    a = ap.parse_args()
    build(a.src.resolve(), a.out.resolve())
