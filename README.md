# City Hunt

A configurable "find the city on the globe" game, in the spirit of
[maptap.gg](https://maptap.gg). Pick a region, pick how many cities, and click
them on satellite imagery. Built as a static site — no server, no build step,
works on a phone.

## Playing

Choose a **region** (the world, a continent, or any of 236 countries), how many
**cities to find**, and whether they should be the largest exactly or a random
draw from the top 20/40/60. A *capital cities only* option restricts the pool to
capitals.

Tap the globe to drop a pin, then **Guess**. Scoring is exponential in the
distance you miss by, with the scale tied to the size of the region, so a round
inside one country demands far more precision than a world round. 1000 points
per city is a bullseye. Best scores are kept per settings combination in the
browser's local storage.

## Running it

Any static file server will do; the page needs to be served over http rather
than opened as a `file://` URL, because it fetches `data/cities.json`.

```
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploying

Push the repository to GitHub and turn on **Settings → Pages → Deploy from a
branch → main / (root)**. No build step is required.

## Rebuilding the city data

`data/cities.json` holds the 60 largest settlements in each country: name,
coordinates, population, and a capital flag. To regenerate it:

```
npm install all-the-cities countries-list
node tools/build-data.js data/cities.json
```

The build filters GeoNames feature codes down to genuine settlements — boroughs
(`PPLX`), localities, farm villages and abandoned places are excluded — and
collapses duplicate names within a country, keeping the largest.

A caveat worth knowing: GeoNames populations are for the city proper as its
local administrative boundary defines it, not the metropolitan area. This is why
the United Kingdom's top five come out as London, Birmingham, Liverpool,
Nottingham and Sheffield rather than the metro-area ordering one might expect.

## Sources and licences

- City data: [GeoNames](https://www.geonames.org/), CC BY 4.0, via the
  [`all-the-cities`](https://www.npmjs.com/package/all-the-cities) package.
- Country names and continents:
  [`countries-list`](https://www.npmjs.com/package/countries-list).
- Map rendering: [MapLibre GL JS](https://maplibre.org/) 5.24.0, BSD-3-Clause.
- Satellite imagery: Esri World Imagery (Esri, Maxar, Earthstar Geographics),
  free for non-commercial use under Esri's
  [terms](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9).
