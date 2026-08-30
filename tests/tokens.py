"""Token-contract check for every skin in src/skins/*.css.

Asserts, per skin: the 10 colour tokens in all three colour blocks (light, system dark,
forced dark), the 14 type/shape tokens once, every skin-specific extra token defined in the
light block also defined in both dark blocks, no !important, no adblock-bait identifiers.
Also cross-checks src/index.html: every skin file has a SKINS entry and vice versa, and the
skins region is empty (the build fills it; generated CSS must never be committed there).
Static companion to tests/verify.js (which needs a browser); run from the repo root:

    python3 tests/tokens.py
"""
import glob
import re
import sys

COLORS="--bg --surface --ink --muted --faint --line --line-hover --accent --region --shadow".split()
ONCE="--font-body --font-display --font-label --font-size-body --font-size-lede --font-size-note --display-weight --display-tracking --name-weight --name-weight-latin --name-tracking --label-weight --label-tracking --radius-card".split()
failed = False
for f in sorted(glob.glob('src/skins/*.css')):
    s=open(f).read(); name=f.split('/')[-1][:-4]
    # split into the three color blocks by selector
    blocks={}
    for label,pat in [('light',r':root\[data-skin="%s"\]\s*\{(.*?)\n\}'%name),
                      ('sysdark',r':root\[data-skin="%s"\]:not\(\[data-theme="light"\]\)\s*\{(.*?)\n  \}'%name),
                      ('forced',r':root\[data-skin="%s"\]\[data-theme="dark"\]\s*\{(.*?)\n\}'%name)]:
        m=re.search(pat,s,re.S); blocks[label]=m.group(1) if m else ''
    probs=[]
    for b,body in blocks.items():
        if not body: probs.append(f'missing block {b}'); continue
        for t in COLORS:
            if not re.search(r'(^|\s)'+re.escape(t)+r'\s*:',body): probs.append(f'{b}: {t}')
    for t in ONCE:
        if not re.search(r'(^|\s)'+re.escape(t)+r'\s*:',blocks['light']): probs.append(f'once: {t}')
    # extras defined in light but missing in a dark block
    extras=set(re.findall(r'(--[a-z0-9-]+)\s*:',blocks['light']))-set(COLORS)-set(ONCE)
    for t in sorted(extras):
        for b in ('sysdark','forced'):
            if blocks[b] and not re.search(re.escape(t)+r'\s*:',blocks[b]): probs.append(f'extra {t} missing in {b}')
    if '!important' in s: probs.append('!important used')
    if re.search(r'(sponsor|donat|donor|supporter|patron|tip-jar)',s,re.I): probs.append('adblock identifier')
    print(name, 'OK' if not probs else 'PROBLEMS: ' + '; '.join(probs))
    failed |= bool(probs)

# src/index.html vs the skin files
html=open('src/index.html').read()
m=re.search(r'var SKINS = \{(.*?)\n      \};',html,re.S)
entries=set(re.findall(r'\n        ([a-z0-9-]+): \{',m.group(1))) if m else set()
files=[f.split('/')[-1][:-4] for f in sorted(glob.glob('src/skins/*.css'))]
for name in sorted(set(files)|entries):
    probs=[]
    if name not in entries: probs.append('no SKINS entry in src/index.html')
    elif name not in files: probs.append('SKINS entry without src/skins/%s.css'%name)
    print('SKINS', name, 'OK' if not probs else 'PROBLEMS: ' + '; '.join(probs))
    failed |= bool(probs)
region=re.search(r'/\* skins:begin \*/(.*?)/\* skins:end \*/',html,re.S)
ok=bool(region) and not region.group(1).strip()
print('skins region', 'OK (empty, filled by the build)' if ok else 'PROBLEMS: missing markers or generated content committed in src/index.html')
failed |= not ok
sys.exit(1 if failed else 0)
