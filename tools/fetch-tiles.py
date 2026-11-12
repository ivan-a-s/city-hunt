"""
Downloads the EOX Sentinel-2 cloudless 2016 mosaic (CC BY 4.0) up to zoom
MAX_ZOOM into tiles/{z}/{x}/{y}.jpg, so the site serves its own imagery.
Resumable: existing files are skipped. Tiles more than OCEAN_MARGIN degrees from
any land are not fetched (the page's background colour shows through), which cuts
the count by more than half. Needs shapely and tools/src/ne_50m_admin_0_countries.geojson
(see build-borders.py).

Source layer: https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857
Credit required: EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH
(Contains modified Copernicus Sentinel data 2016).

Usage: python tools/fetch-tiles.py [max_zoom]
"""
import json
import math
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from shapely.geometry import box, shape
from shapely.ops import unary_union
from shapely.prepared import prep

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tiles')
URL = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'
WORKERS = 12
OCEAN_MARGIN = 0.3
LAND = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'src', 'ne_50m_admin_0_countries.geojson')


def fetch(job):
    z, x, y = job
    path = os.path.join(ROOT, str(z), str(x), f'{y}.jpg')
    if os.path.exists(path):
        return 0
    for attempt in range(4):
        try:
            req = urllib.request.Request(URL.format(z=z, x=x, y=y),
                                         headers={'User-Agent': 'cityhunt-tile-fetch/1.0'})
            data = urllib.request.urlopen(req, timeout=30).read()
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'wb') as f:
                f.write(data)
            return 1
        except Exception:
            time.sleep(1 + attempt * 2)
    print('failed', z, x, y, flush=True)
    return 0


def tile_box(z, x, y):
    n = 2 ** z
    lat = lambda t: math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * t / n))))
    return box(x / n * 360 - 180, lat(y + 1), (x + 1) / n * 360 - 180, lat(y))


def main():
    max_zoom = int(sys.argv[1]) if len(sys.argv) > 1 else 8
    with open(LAND, encoding='utf-8') as f:
        land = prep(unary_union([shape(ft['geometry']) for ft in json.load(f)['features']])
                    .buffer(OCEAN_MARGIN))
    jobs = [(z, x, y) for z in range(max_zoom + 1)
            for x in range(2 ** z) for y in range(2 ** z)
            if z <= 3 or land.intersects(tile_box(z, x, y))]
    print(f'{len(jobs)} land tiles to fetch', flush=True)
    done = 0
    with ThreadPoolExecutor(WORKERS) as pool:
        for i, n in enumerate(pool.map(fetch, jobs, chunksize=64), 1):
            done += n
            if i % 5000 == 0:
                print(f'{i}/{len(jobs)} ({done} downloaded)', flush=True)
    print(f'done: {len(jobs)} tiles, {done} downloaded now')


if __name__ == '__main__':
    main()
