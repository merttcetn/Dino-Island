#!/usr/bin/env python3
"""Inspect original Dino Island overlay records without running game executables."""
from pathlib import Path
import argparse
import json
import re

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--match', default='RIGHT_PANEL|NAVIGATION|GAUGE_PANEL|MAP_PANEL|TIME_PANEL')
parser.add_argument('--source', type=Path, default=ROOT / 'references/original/game/Data/Overlay')
args = parser.parse_args()
pattern = re.compile(args.match, re.I)
records = {}
for name in ('ParkInterface.Ini', 'ParkGraphicDB.Ini'):
    path = next((p for p in args.source.iterdir() if p.name.lower() == name.lower()), None)
    if path is None:
        raise SystemExit(f'Missing {name} under {args.source}')
    sections = {}
    for section in re.split(r'^\s*\[', path.read_text(encoding='latin1'), flags=re.M)[1:]:
        title, body = section.split(']', 1)
        if not pattern.search(title):
            continue
        props = {}
        for line in body.splitlines():
            match = re.match(r'^\s*([A-Z][A-Z_0-9]*)\s*=\s*(.*?)\s*(?:;.*)?$', line)
            if match:
                key, value = match.groups()
                props[key] = value.strip('"')
        sections[title] = props
    records[name] = sections
print(json.dumps(records, indent=2, ensure_ascii=False))
