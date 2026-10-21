"""
Rebuilds every data file in one go: cities, metro-area populations, country
borders, and state outlines with their cities.

Downloads missing sources into tools/src/ and runs `npm install` if the npm
packages are missing. Needs Node (on PATH, or set the NODE environment variable
to node.exe) and the Python package shapely.

Usage: python tools/rebuild.py
"""
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
SRC = os.path.join(HERE, 'src')
NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'

DOWNLOADS = [
    (NE + 'ne_50m_admin_0_countries.geojson', 'ne_50m_admin_0_countries.geojson'),
    (NE + 'ne_10m_admin_1_states_provinces.geojson', 'admin1_10m.geojson'),
    (NE + 'ne_10m_populated_places.geojson', 'ne_10m_populated_places.geojson'),
    ('https://download.geonames.org/export/dump/cities5000.zip', 'cities5000.zip'),
]


def fetch():
    os.makedirs(SRC, exist_ok=True)
    for url, name in DOWNLOADS:
        path = os.path.join(SRC, name)
        if not os.path.exists(path):
            print('downloading', name)
            urllib.request.urlretrieve(url, path)
    txt = os.path.join(SRC, 'cities5000.txt')
    if not os.path.exists(txt):
        with zipfile.ZipFile(os.path.join(SRC, 'cities5000.zip')) as z:
            z.extract('cities5000.txt', SRC)


def run(*cmd):
    print('>', ' '.join(os.path.basename(c) if i == 0 else c for i, c in enumerate(cmd)))
    subprocess.run(cmd, cwd=ROOT, check=True)


def main():
    node = os.environ.get('NODE') or shutil.which('node')
    if not node:
        sys.exit('Node not found: put it on PATH or set NODE to node.exe.')
    fetch()
    if not os.path.isdir(os.path.join(ROOT, 'node_modules', 'all-the-cities')):
        run(shutil.which('npm') or 'npm', 'install', 'all-the-cities', 'countries-list')

    py = sys.executable
    cities = os.path.join('data', 'cities.json')
    run(node, os.path.join('tools', 'build-data.js'), cities)      # city-proper list
    run(py, os.path.join('tools', 'build-metro.py'))               # metro figures from it
    run(node, os.path.join('tools', 'build-data.js'), cities)      # apply them
    run(py, os.path.join('tools', 'build-borders.py'))
    run(py, os.path.join('tools', 'build-states.py'))


if __name__ == '__main__':
    main()
