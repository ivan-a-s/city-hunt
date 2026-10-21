"""
Builds data/sub/<ISO>.json: state/province outlines and the cities inside them,
for the countries in COUNTRIES.

Sources, downloaded into tools/src/:
  ne_10m_admin_1_states_provinces.geojson (Natural Earth, public domain; saved
    as admin1_10m.geojson)
    https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson
  cities5000.txt (GeoNames, CC BY 4.0), unzipped from
    https://download.geonames.org/export/dump/cities5000.zip

Output per country: { s: [{n, a, p}], c: [[name, lat, lon, pop, isCapital, stateIndex]] }
  s: name, area km2, outer rings as flat [lon, lat, ...] lists
  c: isCapital is 1 for national and state capitals (PPLC, PPLA)
The UK is dissolved from its districts into England, Scotland, Wales and
Northern Ireland.

Populations are metro-area figures where available (metro.py), else GeoNames'.

Requires shapely. Usage: python tools/build-states.py
"""
import json
import math
import os
import sys

from shapely.geometry import Point, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import metro  # noqa: E402

SRC = os.path.join(HERE, 'src')
DEST = os.path.join(HERE, '..', 'data', 'sub')

COUNTRIES = ['US', 'CA', 'AU', 'BR', 'MX', 'IN', 'CN', 'DE', 'GB']
MIN_RING = 0.01        # fraction of the state's largest ring
NEAR = 0.3             # degrees: a city this close to a state is assigned to it
KEEP = {'PPL', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPLA5', 'PPLC', 'PPLG'}
R_EARTH = 6371.0


def ring_area(ring):
    s = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        s += math.radians(x2 - x1) * (2 + math.sin(math.radians(y1)) + math.sin(math.radians(y2)))
    return abs(s) * R_EARTH ** 2 / 2


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


def outline(geom):
    """Flat outer rings, tiny islands dropped, simplified to the state's size."""
    polys = list(geom.geoms) if geom.geom_type == 'MultiPolygon' else [geom]
    rings = [list(p.exterior.coords)[:-1] for p in polys]
    areas = [ring_area(r) for r in rings]
    w = geom.bounds[2] - geom.bounds[0]
    h = geom.bounds[3] - geom.bounds[1]
    tol = min(0.04, max(0.005, 0.01 * max(w, h)))
    out = []
    for r, a in zip(rings, areas):
        if a < max(areas) * MIN_RING:
            continue
        s = simplify(r, tol)
        if len(s) >= 3:
            out.append([round(v, 2) for p in s for v in p])
    return out, sum(areas)


def load_states():
    with open(os.path.join(SRC, 'admin1_10m.geojson'), encoding='utf-8') as f:
        gj = json.load(f)
    by = {iso: [] for iso in COUNTRIES}
    for feat in gj['features']:
        p = feat['properties']
        if p['iso_a2'] in by:
            by[p['iso_a2']].append((p['geonunit'] if p['iso_a2'] == 'GB' else p['name'],
                                    shape(feat['geometry'])))
    # Dissolve the UK's districts into its four nations.
    nations = {}
    for name, g in by['GB']:
        nations.setdefault(name, []).append(g)
    by['GB'] = [(n, unary_union(gs)) for n, gs in nations.items()]
    return by


def load_cities():
    by = {iso: [] for iso in COUNTRIES}
    with open(os.path.join(SRC, 'cities5000.txt'), encoding='utf-8') as f:
        for line in f:
            c = line.rstrip('\n').split('\t')
            if c[8] in by and c[6] == 'P' and c[7] in KEEP:
                by[c[8]].append((c[1], float(c[4]), float(c[5]), int(c[14]), c[7]))
    return by


def main():
    states, cities = load_states(), load_cities()
    places = metro.load_places(os.path.join(SRC, 'ne_10m_populated_places.geojson'))
    os.makedirs(DEST, exist_ok=True)
    for iso in COUNTRIES:
        names = [n for n, _ in states[iso]]
        geoms = [g for _, g in states[iso]]
        tree = STRtree(geoms)

        s_out = []
        for n, g in states[iso]:
            rings, area = outline(g)
            s_out.append({'n': n, 'a': round(area), 'p': rings})

        best = {}
        for name, lat, lon, pop, code in cities[iso]:
            pt = Point(lon, lat)
            hits = [i for i in tree.query(pt) if geoms[i].contains(pt)]
            if hits:
                si = hits[0]
            else:
                si = tree.nearest(pt)
                if si is None or geoms[si].distance(pt) > NEAR:
                    continue
            key = (si, name.lower())
            if key not in best or pop > best[key][3]:
                best[key] = (name, round(lat, 4), round(lon, 4), pop,
                             1 if code in ('PPLC', 'PPLA') else 0, int(si))
        rows = list(best.values())
        # Metro-area populations where a city is the core of one (see metro.py).
        pops = metro.metro_pops([(r[0], r[1], r[2], r[3]) for r in rows], places.get(iso, []))
        rows = [(r[0], r[1], r[2], p, r[4], r[5]) for r, p in zip(rows, pops)]
        c_out = sorted(rows, key=lambda r: -r[3])

        path = os.path.join(DEST, f'{iso}.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump({'s': s_out, 'c': [list(r) for r in c_out]}, f, separators=(',', ':'), ensure_ascii=False)
        print(f'{iso}: {len(s_out)} states, {len(c_out)} cities, {os.path.getsize(path) / 1024:.0f} kB')


if __name__ == '__main__':
    main()
