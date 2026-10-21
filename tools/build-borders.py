"""
Builds data/borders.json for the draw-the-borders mode.

Source: Natural Earth 1:50m admin-0 countries (public domain), downloaded to
tools/src/ne_50m_admin_0_countries.geojson from
https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson

Output: { ISO2: { a: area km2, p: [flat [lon, lat, lon, lat, ...] outer ring, ...] } }
Holes are dropped, rings under 1% of the country's largest are dropped, and
countries under MIN_AREA km2 are omitted. For the HOME_ONLY countries, rings
more than HOME_KM from the capital (French Guiana, Svalbard and so on) are
dropped, since Natural Earth counts overseas territories with their country.

Usage: python tools/build-borders.py
"""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'src', 'ne_50m_admin_0_countries.geojson')
DEST = os.path.join(HERE, '..', 'data', 'borders.json')

MIN_AREA = 1000        # km2
MIN_RING = 0.01        # fraction of the largest ring
TOLERANCE = 0.04       # degrees, Douglas-Peucker
R_EARTH = 6371.0
HOME_ONLY = {'FR', 'NO', 'NL', 'DK', 'GB'}
HOME_KM = 1500
CITIES = os.path.join(HERE, '..', 'data', 'cities.json')


def ring_area(ring):
    """Spherical polygon area, km2 (Chamberlain-Duquette)."""
    s = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        s += math.radians(x2 - x1) * (2 + math.sin(math.radians(y1)) + math.sin(math.radians(y2)))
    return abs(s) * R_EARTH ** 2 / 2


def km(a, b):
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dl = math.radians(b[0] - a[0])
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_EARTH * math.asin(math.sqrt(h))


def capitals():
    with open(CITIES, encoding='utf-8') as f:
        countries = json.load(f)['countries']
    return {iso: [(c[2], c[1]) for c in v['cities'] if c[4]][:1] for iso, v in countries.items()}


def simplify(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        (x1, y1), (x2, y2) = pts[i], pts[j]
        dx, dy = x2 - x1, y2 - y1
        norm = math.hypot(dx, dy)
        best, idx = 0.0, -1
        for k in range(i + 1, j):
            x, y = pts[k]
            d = (math.hypot(x - x1, y - y1) if norm == 0
                 else abs(dy * (x - x1) - dx * (y - y1)) / norm)
            if d > best:
                best, idx = d, k
        if best > tol:
            keep[idx] = True
            stack += [(i, idx), (idx, j)]
    return [p for p, k in zip(pts, keep) if k]


def main():
    with open(SRC, encoding='utf-8') as f:
        gj = json.load(f)

    caps = capitals()
    out = {}
    for feat in gj['features']:
        props = feat['properties']
        iso = props.get('ISO_A2_EH') or props.get('ISO_A2')
        if not iso or iso == '-99':
            continue
        geom = feat['geometry']
        polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
        rings = [[tuple(p[:2]) for p in poly[0][:-1]] for poly in polys]
        if iso in HOME_ONLY and caps.get(iso):
            rings = [r for r in rings
                     if km((sum(p[0] for p in r) / len(r), sum(p[1] for p in r) / len(r)),
                           caps[iso][0]) <= HOME_KM]
            if not rings:
                continue
        areas = [ring_area(r) for r in rings]
        total = sum(areas)
        if total < MIN_AREA:
            continue
        biggest = max(areas)
        kept = []
        for r, a in zip(rings, areas):
            if a < biggest * MIN_RING:
                continue
            s = simplify(r, TOLERANCE)
            if len(s) >= 3:
                kept.append([round(v, 2) for p in s for v in p])
        out[iso] = {'a': round(total), 'p': kept}

    os.makedirs(os.path.dirname(DEST), exist_ok=True)
    with open(DEST, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f'{len(out)} countries -> {os.path.normpath(DEST)} ({os.path.getsize(DEST) / 1024:.0f} kB)')


if __name__ == '__main__':
    main()
