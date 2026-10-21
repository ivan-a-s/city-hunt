"""
Metro-area populations from Natural Earth populated places (POP_MAX).

metro_pops(cities, places) takes one country's cities as (name, lat, lon, pop)
and returns a population for each. A city takes the Natural Earth figure only
if no city within CORE_KM has a larger figure, so Tokyo gets its agglomeration
while Yokohama and Kawasaki keep their own city-proper figures. Cities with no match
keep their GeoNames population.

Source: tools/src/ne_10m_populated_places.geojson (Natural Earth, public domain)
https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places.geojson
"""
import json
import math
import unicodedata

CORE_KM = 40      # a larger city this close makes a city a satellite
NAME_KM = 40      # name-matched Natural Earth place must be this close
NEAR_KM = 12      # otherwise the nearest unclaimed place this close is used


def norm(s):
    s = unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode().lower()
    return ''.join(ch for ch in s if ch.isalnum())


def km(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1] - a[1])
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def load_places(path):
    """{iso2: [(normalised name, lat, lon, pop_max)]}"""
    with open(path, encoding='utf-8') as f:
        feats = json.load(f)['features']
    out = {}
    for ft in feats:
        p = ft['properties']
        if p['ISO_A2'] and p['POP_MAX']:
            out.setdefault(p['ISO_A2'], []).append(
                (norm(p['NAME']), p['LATITUDE'], p['LONGITUDE'], p['POP_MAX']))
    return out


def metro_pops(cities, places):
    n = len(cities)
    claimed = set()
    match = [None] * n

    # Pass 1: same name, nearest.
    for i, (name, lat, lon, _) in enumerate(cities):
        key = norm(name)
        best = None
        for j, (pn, plat, plon, pop) in enumerate(places):
            if j in claimed or not (pn == key or pn.startswith(key) or key.startswith(pn)):
                continue
            d = km((lat, lon), (plat, plon))
            if d <= NAME_KM and (best is None or d < best[0]):
                best = (d, j)
        if best:
            match[i] = best[1]
            claimed.add(best[1])

    # Pass 2: nearest unclaimed place, largest cities first.
    for i in sorted(range(n), key=lambda k: -cities[k][3]):
        if match[i] is not None:
            continue
        _, lat, lon, _ = cities[i]
        best = None
        for j, (_, plat, plon, _) in enumerate(places):
            if j in claimed:
                continue
            d = km((lat, lon), (plat, plon))
            if d <= NEAR_KM and (best is None or d < best[0]):
                best = (d, j)
        if best:
            match[i] = best[1]
            claimed.add(best[1])

    # A city's figure is its Natural Earth one if matched. It takes that figure
    # only if no city within CORE_KM has a larger one.
    eff = [places[match[i]][3] if match[i] is not None else cities[i][3] for i in range(n)]
    out = []
    for i, (name, lat, lon, pop) in enumerate(cities):
        core = not any(
            (eff[k], -k) > (eff[i], -i) and km((lat, lon), (cities[k][1], cities[k][2])) <= CORE_KM
            for k in range(n) if k != i)
        out.append(eff[i] if match[i] is not None and core else pop)
    return out
