# -*- coding: utf-8 -*-
"""Writes i18n-en.ts from every key the interface can be translated through,
keeping whatever English has already been filled in.

Two kinds of key:
  - a Japanese literal on a line that calls `t(` — the ordinary case, including
    `t(cond ? 'A' : 'B')`;
  - every Japanese literal in a *key table*: a module constant that is built as
    its module is imported, so it holds the Japanese and is read through `t()`
    where it is drawn. One is marked by writing `i18n-keys` in a comment on the
    line above it, and runs to the line that closes it at column 0.
"""
import io
import os
import re

ROOT = 'src'
JA = re.compile(r'[぀-ヿ㐀-鿿！-｠]')
LITERAL = re.compile(r"'((?:[^'\\]|\\.)*)'")
# The first argument of a `t(` call, which prettier may have moved onto the
# next line: the line-by-line pass below would never see the two together.
FIRST_ARG = re.compile(r"\bt\(\s*'((?:[^'\\]|\\.)*)'")
MARKER = 'i18n-keys'
CLOSES = ('}', ']', '};', '];')
# Written in the language they name, so never translated.
SKIP = {'日本語'}

keys = []
seen = set()
for base, _dirs, names in os.walk(ROOT):
    for name in sorted(names):
        if not name.endswith(('.ts', '.tsx')) or name == 'i18n-en.ts':
            continue
        path = os.path.join(base, name).replace('\\', '/')
        text = io.open(path, encoding='utf-8', newline='').read()

        def take(key: str) -> None:
            if key and key not in seen and key not in SKIP and JA.search(key):
                seen.add(key)
                keys.append(key)

        for match in FIRST_ARG.finditer(text):
            take(match.group(1))

        in_table = False
        for line in text.split('\n'):
            if MARKER in line:
                in_table = True
                continue
            if in_table and line in CLOSES:
                in_table = False
            if not in_table and 't(' not in line:
                continue
            for match in LITERAL.finditer(line):
                take(match.group(1))

OUT = 'src/shared/i18n-en.ts'
ENTRY = re.compile(r"^  '((?:[^'\\]|\\.)*)':\s*'((?:[^'\\]|\\.)*)'", re.M)
existing = {}
if os.path.exists(OUT):
    for m in ENTRY.finditer(io.open(OUT, encoding='utf-8', newline='').read()):
        existing[m.group(1)] = m.group(2)

HEAD = """/*
 * **The English half of the interface, and the only file it lives in.**
 *
 * The key is the Japanese run exactly as it is written in the code; the value
 * is what English says instead. A key left empty is left in Japanese, so this
 * can be filled in a line at a time and the app works at every point along the
 * way.
 *
 * `{0}`, `{1}` are the figures the run is written around. They may be moved
 * anywhere in the English, but every one the Japanese carries has to appear
 * somewhere or the number it stands for is simply not written. `\\n` is a line
 * break and belongs wherever the English wants it.
 *
 * The design's own words are not in here and never will be: Home, SORT, GROUP,
 * ADD TAG +, PLAY TIME, ADD IMAGE, APPLY, OK, CANCEL and the rest are English
 * in Penpot and are English in both languages. So are 日本語 and ENG, which are
 * each written in the language they name. Only what `t()` reaches is here.
 *
 * The list is generated from the code itself (`scratchpad/dict.py`), so it is
 * always the whole of what can be translated and nothing that cannot.
 */
export const EN: Record<string, string> = {
"""

lines = [HEAD]
for key in keys:
    lines.append(f"  '{key}': '{existing.get(key, '')}',\n")
lines.append('}\n')
io.open(OUT, 'w', encoding='utf-8', newline='').write(''.join(lines))
print(f'{len(keys)} keys, {sum(1 for k in keys if existing.get(k))} already translated')
