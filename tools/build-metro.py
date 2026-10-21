"""
Builds tools/metro-pop.json, read by build-data.js: { ISO: { cityName: population } }
for cities whose metro-area population differs from their GeoNames figure.

Reads tools/src/cities-geonames.json, written by build-data.js. See metro.py
for the rule.

Usage: python tools/build-metro.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import metro  # noqa: E402


def main():
    places = metro.load_places(os.path.join(HERE, 'src', 'ne_10m_populated_places.geojson'))
    with open(os.path.join(HERE, 'src', 'cities-geonames.json'), encoding='utf-8') as f:
        countries = json.load(f)['countries']

    out = {}
    for iso, c in countries.items():
        rows = c['cities']
        # City-proper figures, as written by build-data.js.
        pops = metro.metro_pops([(r[0], r[1], r[2], r[3]) for r in rows], places.get(iso, []))
        changed = {r[0]: p for r, p in zip(rows, pops) if p != r[3]}
        if changed:
            out[iso] = changed

    path = os.path.join(HERE, 'metro-pop.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{sum(len(v) for v in out.values())} cities updated -> {path}')


if __name__ == '__main__':
    main()
