# City Hunt

A configurable "find the city on the globe" game, in the spirit of
[maptap.gg](https://maptap.gg). Pick a region, pick how many cities, and click
them on satellite imagery. Built as a static site — no server, no build step,
works on a phone.

## Playing

Two game modes:

- **Click the city I name.** A city is named at the top; tap the globe to drop a
  pin, then **Guess**. Scoring is exponential in the distance you miss by, with
  the scale tied to the size of the region, so a round inside one country demands
  far more precision than a world round. 100 points for a bullseye.
- **Name the cities I mark.** Every city in the set appears as a red dot. Type
  names into the box; each correct one turns its dot green and labels it. The
  clock allows a fixed number of seconds per city (15 by default, or no limit),
  spent as one shared budget across the whole set. Anything still unnamed when
  the time goes is revealed in amber. 100 points per city named.

- **Draw the country I name.** A country is named; draw its outline from
  memory. The toolbar is hand (pan and zoom), pen, undo and tick (submit). The
  pen draws one line, then returns to the hand; small circles mark the open
  ends, and dragging from one switches to the pen and continues the line.
  Dropping an end on another end joins them, and joining a line's two ends
  closes the loop (use several loops for islands). Submit needs one closed loop;
  unclosed lines are ignored. Shape,
  placement and size are each scored out of 100; the country's score is their mean.
  - *Placement:* centroid miss in units of the real country's equivalent radius.
  - *Size:* log of the area ratio.
  - *Shape:* mean gap between the two outlines after moving the drawing onto the
    real centroid and scaling it to the real area (no rotation).
  Each falls off exponentially; the constants are at the top of the draw-mode
  section of `app.js`. Countries under 1,000 km² have no border and are skipped.

The modes share the same selection: a **world region** (the world, one of six
continents, or a finer region such as Western Europe or the Middle East — the
lists are `SUBREGIONS` in `app.js`), optionally narrowed to a single **country**
within it. For the US, Canada, Australia, Brazil, Mexico, India, China, Germany
and the UK, a **state / province** can be chosen too (click and name modes use the
cities inside it), and draw mode can draw the country's states instead of the
country itself (the UK's are England, Scotland, Wales and Northern Ireland); how many
**cities**; and whether they should be the largest exactly or a random draw from
the top 20/40/60. A *capital cities only* option restricts the pool to capitals.

Typed answers ignore case, accents and punctuation, expand `St` to `Saint`, and
tolerate a typo or two in longer names. Best scores are kept per settings
combination in the browser's local storage.

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

## Rebuilding the data

One command rebuilds everything (it downloads missing sources into `tools/src/`
and needs Node, or `NODE` set to `node.exe`, plus `shapely`):

```
python tools/rebuild.py
```

- `data/cities.json`: the 60 largest settlements per country (name, coordinates,
  population, capital flag, optional alternative name), from GeoNames via
  `all-the-cities`. `tools/build-data.js` keeps genuine settlements only,
  collapses duplicate names, then applies `tools/city-fixes.json`: districts
  GeoNames lists as cities are dropped, missing capitals fixed, English names set
  (with the local name still accepted) and common alternative names added. Those
  lists are curated, not exhaustive; add to them as more turn up.
- **Populations are metro-area figures** where a city is the core of one
  (`tools/metro.py`, from Natural Earth populated places, via
  `tools/metro-pop.json`); satellites such as Yokohama keep their own city-proper
  figure, and unmatched cities keep GeoNames'. Natural Earth's estimates are
  uneven, so some rankings look odd (Katowice tops Poland, Stuttgart and
  Mannheim outrank Hamburg).
- `data/borders.json`: simplified country outlines (outer rings only, tiny islands
  dropped; overseas territories of France, Norway, the Netherlands, Denmark and
  the UK dropped), `tools/build-borders.py`.
- `data/sub/<ISO>.json`: for each country with states, their outlines and the
  GeoNames cities (5,000+) inside them, with the same metro figures; each file
  loads when its country is chosen. `tools/build-states.py`.

## Sources and licences

- City data: [GeoNames](https://www.geonames.org/), CC BY 4.0, via the
  [`all-the-cities`](https://www.npmjs.com/package/all-the-cities) package.
- Country names and continents:
  [`countries-list`](https://www.npmjs.com/package/countries-list).
- Country borders (1:50m) and state/province borders (1:10m):
  [Natural Earth](https://www.naturalearthdata.com/), public domain.
- State-level cities: [GeoNames](https://www.geonames.org/) `cities5000`, CC BY 4.0.
- Map rendering: [MapLibre GL JS](https://maplibre.org/) 5.24.0, BSD-3-Clause.
- Satellite imagery: Esri World Imagery (Esri, Maxar, Earthstar Geographics),
  free for non-commercial use under Esri's
  [terms](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9).

Licence details and what blocks monetisation: `LICENCES.md`.
