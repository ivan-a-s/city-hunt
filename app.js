'use strict';

/* ------------------------------------------------------------------ *
 * City Hunt — a configurable "find the city on the globe" game.
 * Data: data/cities.json (built by tools/build-data.js from GeoNames).
 * ------------------------------------------------------------------ */

const CONTINENT_NAMES = {
  AF: 'Africa', AS: 'Asia', EU: 'Europe',
  NA: 'North America', SA: 'South America', OC: 'Oceania',
};
const CONTINENT_ORDER = ['AF', 'AS', 'EU', 'NA', 'SA', 'OC'];

const $ = (id) => document.getElementById(id);
const el = {
  setup: $('setup'), scope: $('scope'), count: $('count'), pool: $('pool'),
  capitals: $('capitals'), start: $('start'), note: $('setup-note'),
  hud: $('hud'), quit: $('quit'), cityName: $('city-name'), citySub: $('city-sub'),
  score: $('score'), progress: $('progress'), hint: $('hint'),
  controls: $('controls'), guess: $('guess'), next: $('next'),
  result: $('result'), resultCity: $('result-city'), resultDist: $('result-dist'),
  resultPts: $('result-pts'), resultPop: $('result-pop'),
  summary: $('summary'), finalScore: $('final-score'), best: $('best'),
  breakdown: $('breakdown'), again: $('again'), change: $('change'),
};

let DATA = null;
let map = null;
let game = null;
let guessMarker = null;
let actualMarker = null;

/* ---------------------------- Geometry --------------------------- */

const R_EARTH = 6371;
const rad = (d) => (d * Math.PI) / 180;

function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Bounding box that copes with countries straddling the antimeridian.
function boundsOf(cities) {
  const lats = cities.map((c) => c.lat);
  const plain = cities.map((c) => c.lon);
  const shifted = plain.map((l) => (l < 0 ? l + 360 : l));
  const span = (a) => Math.max(...a) - Math.min(...a);
  const lons = span(shifted) < span(plain) ? shifted : plain;
  return {
    west: Math.min(...lons), east: Math.max(...lons),
    south: Math.min(...lats), north: Math.max(...lats),
  };
}

function diagonalKm(b) {
  return haversine({ lat: b.south, lon: b.west }, { lat: b.north, lon: b.east });
}

// Keep a longitude within half a globe of a reference, so lines drawn
// between two points take the short way round.
function nearLon(lon, ref) {
  while (lon - ref > 180) lon -= 360;
  while (ref - lon > 180) lon += 360;
  return lon;
}

/* ---------------------------- Setup UI --------------------------- */

function buildScopeSelect() {
  const frag = document.createDocumentFragment();

  const world = new Option('The whole world', 'world', true, true);
  frag.appendChild(world);

  const gc = document.createElement('optgroup');
  gc.label = 'Continents';
  for (const code of CONTINENT_ORDER) {
    gc.appendChild(new Option(CONTINENT_NAMES[code], 'c:' + code));
  }
  frag.appendChild(gc);

  const byContinent = {};
  for (const [iso, c] of Object.entries(DATA.countries)) {
    (byContinent[c.c] ||= []).push([iso, c.n]);
  }
  for (const code of CONTINENT_ORDER) {
    const list = (byContinent[code] || []).sort((a, b) => a[1].localeCompare(b[1]));
    if (!list.length) continue;
    const g = document.createElement('optgroup');
    g.label = CONTINENT_NAMES[code];
    for (const [iso, name] of list) g.appendChild(new Option(name, 'k:' + iso));
    frag.appendChild(g);
  }

  el.scope.appendChild(frag);
}

function scopeCities(scope) {
  const out = [];
  const add = (iso) => {
    for (const [name, lat, lon, pop, cap] of DATA.countries[iso].cities) {
      out.push({ name, lat, lon, pop, cap: !!cap, country: DATA.countries[iso].n });
    }
  };
  if (scope === 'world') Object.keys(DATA.countries).forEach(add);
  else if (scope.startsWith('c:')) {
    const code = scope.slice(2);
    Object.entries(DATA.countries).forEach(([iso, c]) => { if (c.c === code) add(iso); });
  } else add(scope.slice(2));
  return out;
}

function currentConfig() {
  return {
    scope: el.scope.value,
    scopeLabel: el.scope.selectedOptions[0].textContent,
    count: +el.count.value,
    pool: +el.pool.value,
    capitals: el.capitals.checked,
  };
}

function availableFor(cfg) {
  let list = scopeCities(cfg.scope);
  if (cfg.capitals) list = list.filter((c) => c.cap);
  return list.sort((a, b) => b.pop - a.pop);
}

function refreshNote() {
  const cfg = currentConfig();
  const n = availableFor(cfg).length;
  if (n < 2) {
    el.note.textContent = `Only ${n} city available there — try a wider region.`;
    el.start.disabled = true;
  } else if (n < cfg.count) {
    el.note.textContent = `Only ${n} cities available there; the round will be ${n} long.`;
    el.start.disabled = false;
  } else {
    el.note.textContent = '';
    el.start.disabled = false;
  }
}

/* ------------------------------ Map ------------------------------ */

function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      projection: { type: 'globe' },
      sources: {
        sat: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          maxzoom: 19,
          attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
        },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#0b1220' } },
        { id: 'sat', type: 'raster', source: 'sat' },
      ],
      sky: {
        'sky-color': '#0b1220',
        'horizon-color': '#6ea8d8',
        'fog-color': '#0b1220',
        'sky-horizon-blend': 0.5,
        'horizon-fog-blend': 0.5,
        'fog-ground-blend': 0.5,
      },
    },
    center: [0, 20],
    zoom: 0.6,
    attributionControl: { compact: true },
    dragRotate: false,
  });

  map.touchZoomRotate.disableRotation();

  map.on('load', () => {
    map.addSource('link', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'link',
      type: 'line',
      source: 'link',
      paint: { 'line-color': '#ffffff', 'line-width': 2.5, 'line-dasharray': [2, 2] },
    });
  });

  map.on('click', (e) => {
    if (!game || game.locked) return;
    placeGuess(e.lngLat);
  });
}

function makePin(cls, label) {
  const wrap = document.createElement('div');
  const dot = document.createElement('div');
  dot.className = 'pin ' + cls;
  wrap.appendChild(dot);
  if (label) {
    const t = document.createElement('div');
    t.className = 'city-label';
    t.textContent = label;
    wrap.appendChild(t);
  }
  return wrap;
}

function placeGuess(lngLat) {
  if (guessMarker) guessMarker.setLngLat(lngLat);
  else {
    guessMarker = new maplibregl.Marker({ element: makePin('guess'), draggable: true })
      .setLngLat(lngLat).addTo(map);
  }
  el.hint.hidden = true;
  el.guess.disabled = false;
}

function clearMarkers() {
  if (guessMarker) { guessMarker.remove(); guessMarker = null; }
  if (actualMarker) { actualMarker.remove(); actualMarker = null; }
  const src = map.getSource('link');
  if (src) src.setData({ type: 'FeatureCollection', features: [] });
}

function viewScope() {
  if (game.cfg.scope === 'world') {
    map.easeTo({ center: [0, 20], zoom: 0.6, duration: 900 });
    return;
  }
  const b = game.bounds;
  map.fitBounds(
    [[b.west, b.south], [b.east, b.north]],
    { padding: { top: 120, bottom: 130, left: 40, right: 40 }, duration: 900, maxZoom: 9 },
  );
}

/* ----------------------------- Game ------------------------------ */

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startGame(cfg) {
  const ranked = availableFor(cfg);
  const count = Math.min(cfg.count, ranked.length);
  const depth = Math.max(cfg.pool || 0, count);
  const targets = shuffle(ranked.slice(0, Math.min(depth, ranked.length))).slice(0, count);

  const bounds = boundsOf(ranked.slice(0, Math.max(depth, 10)));
  const diag = cfg.scope === 'world' ? 20000 : Math.max(50, diagonalKm(bounds));

  game = {
    cfg, targets, bounds,
    // Scoring falls off exponentially with distance; the scale is tied to the
    // size of the region so a country round demands more precision than a
    // world round. 1000 points for a bullseye, ~370 at one scale length.
    k: Math.max(20, diag / 14),
    i: 0, score: 0, locked: false, results: [],
  };

  el.setup.hidden = true;
  el.summary.hidden = true;
  el.hud.hidden = false;
  el.controls.hidden = false;
  nextRound();
}

function nextRound() {
  clearMarkers();
  game.locked = false;
  el.result.hidden = true;
  el.next.hidden = true;
  el.guess.hidden = false;
  el.guess.disabled = true;
  el.hint.hidden = false;

  const c = game.targets[game.i];
  el.cityName.textContent = c.name;
  el.citySub.textContent = game.cfg.scope.startsWith('k:') ? '' : c.country;
  el.score.textContent = game.score;
  el.progress.textContent = `${game.i + 1}/${game.targets.length}`;
  viewScope();
}

function submitGuess() {
  if (!guessMarker || game.locked) return;
  game.locked = true;

  const target = game.targets[game.i];
  const g = guessMarker.getLngLat();
  const dist = haversine({ lat: g.lat, lon: g.lng }, target);
  const pts = Math.round(1000 * Math.exp(-dist / game.k));

  game.score += pts;
  game.results.push({ name: target.name, dist, pts });

  const tLon = nearLon(target.lon, g.lng);
  actualMarker = new maplibregl.Marker({ element: makePin('actual', target.name) })
    .setLngLat([tLon, target.lat]).addTo(map);
  guessMarker.setDraggable(false);
  map.getSource('link').setData({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[g.lng, g.lat], [tLon, target.lat]] },
  });

  el.resultCity.textContent = target.name;
  el.resultDist.textContent = dist < 10
    ? `${dist.toFixed(1)} km away`
    : `${Math.round(dist).toLocaleString('en-GB')} km away`;
  el.resultPts.textContent = `+${pts} points`;
  el.resultPop.textContent = `Population ${target.pop.toLocaleString('en-GB')}`;
  el.result.hidden = false;
  el.score.textContent = game.score;
  el.guess.hidden = true;
  el.next.hidden = false;
  el.next.textContent = game.i === game.targets.length - 1 ? 'Finish' : 'Next city';

  const pad = { top: 130, bottom: 230, left: 50, right: 50 };
  map.fitBounds(
    [[Math.min(g.lng, tLon), Math.min(g.lat, target.lat)],
     [Math.max(g.lng, tLon), Math.max(g.lat, target.lat)]],
    { padding: pad, duration: 900, maxZoom: 9 },
  );
}

function bestKey(cfg) {
  return `cityhunt:${cfg.scope}:${cfg.count}:${cfg.pool}:${cfg.capitals ? 1 : 0}`;
}

function finish() {
  const max = game.targets.length * 1000;
  el.finalScore.textContent = `${game.score.toLocaleString('en-GB')} / ${max.toLocaleString('en-GB')}`;

  let prev = null;
  try { prev = Number(localStorage.getItem(bestKey(game.cfg))) || null; } catch (e) { /* ignore */ }
  if (prev === null || game.score > prev) {
    try { localStorage.setItem(bestKey(game.cfg), String(game.score)); } catch (e) { /* ignore */ }
    el.best.textContent = prev === null ? 'First run at these settings.' : `New best — was ${prev.toLocaleString('en-GB')}.`;
  } else {
    el.best.textContent = `Your best here: ${prev.toLocaleString('en-GB')}.`;
  }

  el.breakdown.innerHTML = '';
  for (const r of game.results) {
    const li = document.createElement('li');
    const d = r.dist < 10 ? `${r.dist.toFixed(1)} km` : `${Math.round(r.dist).toLocaleString('en-GB')} km`;
    li.innerHTML = `${r.name} — <span class="d">${d}</span> — ${r.pts}`;
    el.breakdown.appendChild(li);
  }

  el.hud.hidden = true;
  el.controls.hidden = true;
  el.result.hidden = true;
  el.hint.hidden = true;
  el.summary.hidden = false;
}

function toSetup() {
  game = null;
  clearMarkers();
  el.hud.hidden = true;
  el.controls.hidden = true;
  el.result.hidden = true;
  el.hint.hidden = true;
  el.summary.hidden = true;
  el.setup.hidden = false;
}

/* ----------------------------- Wiring ---------------------------- */

el.guess.addEventListener('click', submitGuess);
el.next.addEventListener('click', () => {
  if (game.i === game.targets.length - 1) finish();
  else { game.i++; nextRound(); }
});
el.start.addEventListener('click', () => startGame(currentConfig()));
el.again.addEventListener('click', () => startGame(game ? game.cfg : currentConfig()));
el.change.addEventListener('click', toSetup);
el.quit.addEventListener('click', toSetup);
for (const c of [el.scope, el.count, el.pool, el.capitals]) {
  c.addEventListener('change', refreshNote);
}

fetch('data/cities.json')
  .then((r) => r.json())
  .then((d) => {
    DATA = d;
    buildScopeSelect();
    refreshNote();
    initMap();
  })
  .catch(() => {
    el.note.textContent = 'Could not load the city data.';
    el.start.disabled = true;
  });
