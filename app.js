'use strict';

/* ------------------------------------------------------------------ *
 * City Hunt — a configurable geography drill on a satellite globe.
 *
 *   click mode — a city is named, you click where it is.
 *   name mode  — the cities are marked in red, you type their names
 *                against the clock, turning them green.
 *   draw mode  — a country is named, you draw its outline from memory.
 *
 * Data: data/cities.json (built by tools/build-data.js from GeoNames),
 *       data/borders.json (built by tools/build-borders.py from Natural Earth).
 * ------------------------------------------------------------------ */

const CONTINENT_NAMES = {
  AF: 'Africa', AS: 'Asia', EU: 'Europe',
  NA: 'North America', SA: 'South America', OC: 'Oceania',
};
const CONTINENT_ORDER = ['AF', 'AS', 'EU', 'NA', 'SA', 'OC'];

// Finer regions than continents, as ISO 3166 alpha-2 lists.
const SUBREGIONS = {
  'western-europe': ['Western Europe', 'GB IE FR BE NL LU DE CH AT LI MC'],
  'northern-europe': ['Northern Europe', 'NO SE FI DK IS EE LV LT FO'],
  'southern-europe': ['Southern Europe', 'ES PT IT MT SM VA AD GR CY'],
  'balkans': ['The Balkans', 'SI HR BA RS ME MK AL BG RO XK'],
  'eastern-europe': ['Eastern Europe', 'PL CZ SK HU UA BY MD RU'],
  'middle-east': ['Middle East', 'TR SY LB IL PS JO IQ IR SA YE OM AE QA BH KW'],
  'caucasus-central-asia': ['Caucasus and Central Asia', 'GE AM AZ KZ UZ TM KG TJ'],
  'south-asia': ['South Asia', 'IN PK BD LK NP BT MV AF'],
  'east-asia': ['East Asia', 'CN JP KR KP MN TW HK MO'],
  'southeast-asia': ['Southeast Asia', 'TH VN LA KH MM MY SG ID PH BN TL'],
  'north-africa': ['North Africa', 'MA DZ TN LY EG'],
  'west-africa': ['West Africa', 'MR SN GM GW GN SL LR CI GH TG BJ NG BF ML NE CV'],
  'central-africa': ['Central Africa', 'CM CF TD CG CD GA GQ ST AO'],
  'east-africa': ['East Africa', 'ET ER DJ SO KE UG TZ RW BI SS SD'],
  'southern-africa': ['Southern Africa', 'ZA NA BW ZW ZM MW MZ MG LS SZ MU SC KM'],
  'usa-canada': ['USA and Canada', 'US CA'],
  'central-america': ['Central America', 'GT BZ HN SV NI CR PA'],
  'caribbean': ['The Caribbean', 'CU JM HT DO PR BS BB TT AG DM GD KN LC VC'],
  'andes': ['The Andes', 'CO VE EC PE BO'],
  'southern-cone': ['Southern Cone', 'AR CL UY PY'],
};
for (const v of Object.values(SUBREGIONS)) v[1] = v[1].split(' ');

// Countries with state/province outlines and cities (data/sub/<ISO>.json,
// loaded when the country is chosen).
const SUB_COUNTRIES = ['US', 'CA', 'AU', 'BR', 'MX', 'IN', 'CN', 'DE', 'GB'];
const SUB = {};

// Satellite tiles: our own copy up to TILE_MAXZOOM (tools/fetch-tiles.py); deeper
// zooms are upsampled. To use EOX's server (native to zoom 14) instead, set
// TILE_URL to 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'
// and TILE_MAXZOOM to 14.
const TILE_URL = 'tiles/{z}/{x}/{y}.jpg';
const TILE_MAXZOOM = 8;

const $ = (id) => document.getElementById(id);
const el = {
  setup: $('setup'), mode: $('mode'), region: $('region'), country: $('country'),
  count: $('count'), pool: $('pool'), seconds: $('seconds'), timingRow: $('timing-row'),
  capitals: $('capitals'), start: $('start'), note: $('setup-note'),
  hud: $('hud'), quit: $('quit'), cityName: $('city-name'), citySub: $('city-sub'),
  score: $('score'), progress: $('progress'), hint: $('hint'),
  controls: $('controls'), guess: $('guess'), next: $('next'),
  answerRow: $('answer-row'), answer: $('answer'), giveup: $('giveup'),
  result: $('result'), resultCity: $('result-city'), resultDist: $('result-dist'),
  resultPts: $('result-pts'), resultPop: $('result-pop'),
  summary: $('summary'), finalScore: $('final-score'), best: $('best'),
  breakdown: $('breakdown'), again: $('again'), change: $('change'),
  countLabel: $('count-label'), capitalsLabel: $('capitals-label'),
  stateRow: $('state-row'), state: $('state'), levelRow: $('level-row'), level: $('level'),
  drawRow: $('draw-row'), toolMove: $('tool-move'), toolPen: $('tool-pen'),
  undo: $('undo'), submit: $('submit'),
};

let DATA = null;
let BORDERS = null;
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

// Bounding box that copes with regions straddling the antimeridian.
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

// Keep a longitude within half a globe of a reference, so a line drawn
// between two points takes the short way round.
function nearLon(lon, ref) {
  while (lon - ref > 180) lon -= 360;
  while (ref - lon > 180) lon += 360;
  return lon;
}

/* --------------------------- Name matching ----------------------- */

// Letters that do not decompose into a base letter plus accent.
const LETTERS = { '\u0142': 'l', '\u00f8': 'o', '\u0111': 'd', '\u00f0': 'd', '\u0131': 'i', '\u00df': 'ss', '\u00e6': 'ae', '\u0153': 'oe', '\u00fe': 'th' };

function normalise(s) {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // strip diacritics
    .toLowerCase()
    .replace(/[\u0142\u00f8\u0111\u00f0\u0131\u00df\u00e6\u0153\u00fe]/g, (ch) => LETTERS[ch])
    .replace(/\bst\.?\b/g, 'saint')
    .replace(/[^a-z0-9]+/g, '');
}

// Damerau-free Levenshtein, capped for speed.
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

// A typed answer matches if it is the same once normalised, or close
// enough that only a slip of the finger separates them.
function matches(typed, name) {
  const a = normalise(typed);
  const b = normalise(name);
  if (!a) return false;
  if (a === b) return true;
  const tol = b.length >= 14 ? 2 : b.length >= 8 ? 1 : 0;
  return tol > 0 && a[0] === b[0] && editDistance(a, b) <= tol;
}

/* ---------------------------- Setup UI --------------------------- */

function buildRegionSelect() {
  el.region.appendChild(new Option('The whole world', 'world', true, true));
  const group = (label, entries) => {
    const g = document.createElement('optgroup');
    g.label = label;
    for (const [value, text] of entries) g.appendChild(new Option(text, value));
    el.region.appendChild(g);
  };
  group('Continents', CONTINENT_ORDER.map((code) => [code, CONTINENT_NAMES[code]]));
  group('Regions', Object.entries(SUBREGIONS).map(([key, [name]]) => [key, name]));
}

function regionName(region) {
  return SUBREGIONS[region] ? SUBREGIONS[region][0] : CONTINENT_NAMES[region];
}

function countriesIn(region) {
  const sub = SUBREGIONS[region];
  return Object.entries(DATA.countries)
    .filter(([iso, c]) => region === 'world' || (sub ? sub[1].includes(iso) : c.c === region))
    .sort((a, b) => a[1].n.localeCompare(b[1].n));
}

function buildCountrySelect() {
  const region = el.region.value;
  const label = region === 'world'
    ? 'Everywhere' : `All of ${regionName(region)}`;
  el.country.innerHTML = '';
  el.country.appendChild(new Option(label, '', true, true));
  for (const [iso, c] of countriesIn(region)) {
    el.country.appendChild(new Option(c.n, iso));
  }
}

function scopeCities(cfg) {
  const out = [];
  const add = (iso) => {
    for (const [name, lat, lon, pop, cap, alt] of DATA.countries[iso].cities) {
      out.push({ name, alt, lat, lon, pop, cap: !!cap, country: DATA.countries[iso].n });
    }
  };
  if (cfg.state !== '' && SUB[cfg.country]) {
    const country = DATA.countries[cfg.country].n;
    for (const [name, lat, lon, pop, cap, si] of SUB[cfg.country].c) {
      if (si === +cfg.state) out.push({ name, lat, lon, pop, cap: !!cap, country });
    }
  } else if (cfg.country) add(cfg.country);
  else countriesIn(cfg.region).forEach(([iso]) => add(iso));
  return out;
}

function currentConfig() {
  return {
    mode: el.mode.value,
    region: el.region.value,
    country: el.country.value,
    state: el.stateRow.hidden ? '' : el.state.value,
    level: el.levelRow.hidden ? 'country' : el.level.value,
    scopeLabel: el.country.value
      ? el.country.selectedOptions[0].textContent
      : el.region.selectedOptions[0].textContent,
    count: +el.count.value,
    pool: +el.pool.value,
    seconds: +el.seconds.value,
    capitals: el.capitals.checked,
  };
}

function availableFor(cfg) {
  let list = scopeCities(cfg);
  if (cfg.capitals) list = list.filter((c) => c.cap);
  return list.sort((a, b) => b.pop - a.pop);
}

// Countries in scope that have a border, largest first.
function drawPool(cfg) {
  if (!BORDERS) return [];
  if (cfg.level === 'states' && SUB[cfg.country]) {
    const country = DATA.countries[cfg.country].n;
    return SUB[cfg.country].s
      .filter((s) => s.a >= 1000 && s.p.length)
      .map((s) => ({ name: s.n, area: s.a, flat: s.p, country }))
      .sort((a, b) => b.area - a.area);
  }
  const isos = cfg.country ? [cfg.country] : countriesIn(cfg.region).map(([iso]) => iso);
  return isos
    .filter((iso) => BORDERS[iso])
    .map((iso) => ({ name: DATA.countries[iso].n, area: BORDERS[iso].a, flat: BORDERS[iso].p }))
    .sort((a, b) => b.area - a.area);
}

// Show the state / level rows to suit the mode and the chosen country.
function refreshSubRows() {
  const hasSub = !!SUB[el.country.value];
  const draw = el.mode.value === 'draw';
  el.stateRow.hidden = draw || !hasSub;
  el.levelRow.hidden = !(draw && hasSub);
}

function buildStateSelect() {
  el.state.innerHTML = '';
  el.state.appendChild(new Option('Whole country', '', true, true));
  const sub = SUB[el.country.value];
  if (!sub) return;
  sub.s.map((s, i) => [s.n, i]).sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([name, i]) => el.state.appendChild(new Option(name, String(i))));
}

function loadSub(iso) {
  if (SUB[iso] || !SUB_COUNTRIES.includes(iso)) return Promise.resolve();
  return fetch(`data/sub/${iso}.json`).then((r) => r.json())
    .then((d) => { SUB[iso] = d; })
    .catch(() => { /* no subdivisions for this country */ });
}

function countryChanged() {
  const iso = el.country.value;
  buildStateSelect();
  refreshNote();
  loadSub(iso).then(() => {
    if (el.country.value !== iso) return;
    buildStateSelect();
    refreshNote();
  });
}

function refreshNote() {
  const draw = el.mode.value === 'draw';
  refreshSubRows();
  el.timingRow.hidden = el.mode.value !== 'name';
  el.capitalsLabel.hidden = draw;
  const states = draw && !el.levelRow.hidden && el.level.value === 'states';
  el.countLabel.textContent = !draw ? 'Cities' : states ? 'States' : 'Countries';
  const cfg = currentConfig();
  const n = draw ? drawPool(cfg).length : availableFor(cfg).length;
  const noun = !draw ? 'cities' : states ? 'states' : 'countries';
  if (n < (draw ? 1 : 2)) {
    el.note.textContent = `Only ${n} ${noun === 'cities' ? 'city' : noun.replace(/ies$/, 'y').replace(/s$/, '')} available there — try a wider region.`;
    el.start.disabled = true;
  } else if (n < cfg.count) {
    el.note.textContent = `Only ${n} ${noun} available there; the round will be ${n} long.`;
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
          // Absolute, because MapLibre fetches tiles from a worker; built by hand
          // because new URL() would percent-encode the {z}/{x}/{y} placeholders.
          tiles: [/^https?:/.test(TILE_URL)
            ? TILE_URL
            : location.href.split(/[?#]/)[0].replace(/[^/]*$/, '') + TILE_URL],
          tileSize: 256,
          maxzoom: TILE_MAXZOOM,
          attribution: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless</a> by <a href="https://eox.at" target="_blank" rel="noopener">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2016), CC BY 4.0',
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
    const empty = { type: 'FeatureCollection', features: [] };
    map.addSource('link', { type: 'geojson', data: empty });
    map.addLayer({
      id: 'link',
      type: 'line',
      source: 'link',
      paint: { 'line-color': '#ffffff', 'line-width': 2.5, 'line-dasharray': [2, 2] },
    });

    // Draw mode: the real border, then the player's strokes on top.
    map.addSource('truth', { type: 'geojson', data: empty });
    map.addSource('draw', { type: 'geojson', data: empty });
    map.addLayer({ id: 'truth-fill', type: 'fill', source: 'truth',
      paint: { 'fill-color': '#47d18a', 'fill-opacity': 0.25 } });
    map.addLayer({ id: 'truth-line', type: 'line', source: 'truth',
      paint: { 'line-color': '#47d18a', 'line-width': 2.5 } });
    map.addLayer({ id: 'draw-fill', type: 'fill', source: 'draw',
      filter: ['==', ['get', 'k'], 'fill'],
      paint: { 'fill-color': '#4da3ff', 'fill-opacity': 0.25 } });
    map.addLayer({ id: 'draw-line', type: 'line', source: 'draw',
      filter: ['==', ['get', 'k'], 'line'],
      paint: { 'line-color': '#4da3ff', 'line-width': 3 } });
    map.addLayer({ id: 'draw-ends', type: 'circle', source: 'draw',
      filter: ['==', ['get', 'k'], 'end'],
      paint: { 'circle-radius': 9, 'circle-color': '#4da3ff',
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } });
  });

  map.on('click', (e) => {
    if (!game || game.cfg.mode !== 'click' || game.locked) return;
    placeGuess(e.lngLat);
  });

  const cv = map.getCanvas();
  cv.addEventListener('pointerdown', penDown);
  cv.addEventListener('pointermove', penMove);
  cv.addEventListener('pointerup', penUp);
  cv.addEventListener('pointercancel', penUp);
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

function clearMap() {
  if (guessMarker) { guessMarker.remove(); guessMarker = null; }
  if (actualMarker) { actualMarker.remove(); actualMarker = null; }
  if (game && game.markers) { game.markers.forEach((m) => m.remove()); game.markers = []; }
  for (const id of ['link', 'truth']) {
    const src = map.getSource(id);
    if (src) src.setData({ type: 'FeatureCollection', features: [] });
  }
  resetDraw();
}

function fitTo(bounds, padding, maxZoom) {
  map.fitBounds(
    [[bounds.west, bounds.south], [bounds.east, bounds.north]],
    { padding, duration: 900, maxZoom: maxZoom || 9 },
  );
}

function viewScope() {
  if (game.cfg.region === 'world' && !game.cfg.country) {
    map.easeTo({ center: [0, 20], zoom: 0.6, duration: 900 });
  } else {
    fitTo(game.bounds, { top: 120, bottom: 130, left: 40, right: 40 });
  }
}

/* ----------------------------- Shared ---------------------------- */

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function bestKey(cfg) {
  return `cityhunt2:${cfg.mode}:${cfg.region}:${cfg.country}:${cfg.state}:${cfg.level}:${cfg.count}:${cfg.pool}:${cfg.capitals ? 1 : 0}`;
}

function km(d) {
  return d < 10 ? `${d.toFixed(1)} km` : `${Math.round(d).toLocaleString('en-GB')} km`;
}

function showPlay() {
  el.setup.hidden = true;
  el.summary.hidden = true;
  el.hud.hidden = false;
  el.controls.hidden = false;
}

function startGame(cfg) {
  if (cfg.mode === 'draw') { startDrawGame(cfg); return; }
  const ranked = availableFor(cfg);
  const count = Math.min(cfg.count, ranked.length);
  const depth = Math.max(cfg.pool || 0, count);
  const targets = shuffle(ranked.slice(0, Math.min(depth, ranked.length))).slice(0, count);

  const bounds = boundsOf(ranked.slice(0, Math.max(depth, 10)));
  const worldwide = cfg.region === 'world' && !cfg.country;
  const diag = worldwide ? 20000 : Math.max(50, diagonalKm(bounds));

  clearMap();   // while `game` is still the previous round, so its markers go

  game = {
    cfg, targets, bounds, markers: [],
    // Scoring falls off exponentially with distance; the scale is tied to the
    // size of the region so a country round demands more precision than a
    // world round. 100 points for a bullseye, ~37 at one scale length.
    k: Math.max(20, diag / 8),
    i: 0, score: 0, locked: false, results: [], found: 0,
  };

  showPlay();

  if (cfg.mode === 'click') startClickRound();
  else startNameRound();
}

function finishGame(lines, scored, maxScore) {
  stopClock();
  el.finalScore.textContent = `${scored.toLocaleString('en-GB')} / ${maxScore.toLocaleString('en-GB')}`;

  let prev = null;
  try { prev = Number(localStorage.getItem(bestKey(game.cfg))) || null; } catch (e) { /* ignore */ }
  if (prev === null || scored > prev) {
    try { localStorage.setItem(bestKey(game.cfg), String(scored)); } catch (e) { /* ignore */ }
    el.best.textContent = prev === null
      ? 'First run at these settings.'
      : `New best — was ${prev.toLocaleString('en-GB')}.`;
  } else {
    el.best.textContent = `Your best here: ${prev.toLocaleString('en-GB')}.`;
  }

  el.breakdown.innerHTML = '';
  for (const line of lines) {
    const li = document.createElement('li');
    li.innerHTML = line;
    el.breakdown.appendChild(li);
  }

  el.hud.hidden = true;
  el.controls.hidden = true;
  el.result.hidden = true;
  el.hint.hidden = true;
  el.summary.hidden = false;
}

function toSetup() {
  stopClock();
  clearMap();
  game = null;
  setTool('move');
  el.hud.hidden = true;
  el.controls.hidden = true;
  el.drawRow.hidden = true;
  el.result.hidden = true;
  el.hint.hidden = true;
  el.summary.hidden = true;
  el.setup.hidden = false;
}

/* --------------------------- Click mode -------------------------- */

function startClickRound() {
  clearMap();
  setTool('move');
  game.locked = false;
  el.result.hidden = true;
  el.answerRow.hidden = true;
  el.drawRow.hidden = true;
  el.next.hidden = true;
  el.guess.hidden = false;
  el.guess.disabled = true;
  el.hint.textContent = 'Tap the map to drop your pin';
  el.hint.hidden = false;

  const c = game.targets[game.i];
  el.cityName.textContent = c.name;
  el.citySub.textContent = game.cfg.country ? '' : c.country;
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
  const pts = Math.round(100 * Math.exp(-dist / game.k));

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
  el.resultDist.textContent = `${km(dist)} away`;
  el.resultPts.textContent = `+${pts} points`;
  el.resultPop.textContent = `Population ${target.pop.toLocaleString('en-GB')}`;
  el.result.hidden = false;
  el.score.textContent = game.score;
  el.guess.hidden = true;
  el.next.hidden = false;
  el.next.textContent = game.i === game.targets.length - 1 ? 'Finish' : 'Next city';

  fitTo(
    {
      west: Math.min(g.lng, tLon), east: Math.max(g.lng, tLon),
      south: Math.min(g.lat, target.lat), north: Math.max(g.lat, target.lat),
    },
    { top: 130, bottom: 230, left: 50, right: 50 },
  );
}

function finishClickGame() {
  const lines = game.results.map(
    (r) => `${r.name} — <span class="d">${km(r.dist)}</span> — ${r.pts}`,
  );
  finishGame(lines, game.score, game.targets.length * 100);
}

/* ---------------------------- Name mode -------------------------- */

let clockId = null;

function stopClock() {
  if (clockId) { clearInterval(clockId); clockId = null; }
}

function formatClock(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function startNameRound() {
  game.locked = false;
  game.found = 0;
  game.solved = new Set();
  setTool('move');
  el.drawRow.hidden = true;
  el.result.hidden = true;
  el.hint.hidden = true;
  el.guess.hidden = true;
  el.next.hidden = true;
  el.answerRow.hidden = false;
  el.answer.value = '';

  // Red dot for every city to be named.
  game.markers = game.targets.map((c) =>
    new maplibregl.Marker({ element: makePin('target') })
      .setLngLat([c.lon, c.lat]).addTo(map));

  game.bounds = boundsOf(game.targets);
  fitTo(game.bounds, { top: 120, bottom: 150, left: 45, right: 45 });

  updateNameHud();

  if (game.cfg.seconds > 0) {
    game.left = game.cfg.seconds * game.targets.length;
    clockId = setInterval(() => {
      game.left -= 1;
      updateNameHud();
      if (game.left <= 0) finishNameGame(true);
    }, 1000);
  } else {
    game.left = null;
  }

  el.answer.focus();
}

function updateNameHud() {
  el.cityName.textContent = `${game.found} / ${game.targets.length}`;
  el.citySub.textContent = 'named';
  el.score.textContent = game.left === null ? '∞' : formatClock(Math.max(0, game.left));
  el.score.classList.toggle('urgent', game.left !== null && game.left <= 10);
  el.progress.textContent = game.left === null ? 'no limit' : 'left';
}

function trySubmitName() {
  const typed = el.answer.value.trim();
  if (!typed || game.locked) return;

  const hit = game.targets.findIndex(
    (c, i) => !game.solved.has(i) && (matches(typed, c.name) || (c.alt && matches(typed, c.alt))));
  if (hit === -1) {
    el.answer.classList.remove('wrong');
    void el.answer.offsetWidth;   // restart the shake
    el.answer.classList.add('wrong');
    return;
  }

  game.solved.add(hit);
  game.found += 1;
  el.answer.value = '';
  el.answer.classList.remove('wrong');

  const c = game.targets[hit];
  game.markers[hit].remove();
  game.markers[hit] = new maplibregl.Marker({ element: makePin('actual', c.name) })
    .setLngLat([c.lon, c.lat]).addTo(map);

  updateNameHud();
  if (game.found === game.targets.length) finishNameGame(false);
}

function finishNameGame(timedOut) {
  stopClock();
  game.locked = true;

  // Reveal whatever was missed, in amber.
  game.targets.forEach((c, i) => {
    if (game.solved.has(i)) return;
    game.markers[i].remove();
    game.markers[i] = new maplibregl.Marker({ element: makePin('missed', c.name) })
      .setLngLat([c.lon, c.lat]).addTo(map);
  });

  const lines = game.targets.map((c, i) => (
    game.solved.has(i)
      ? `${c.name}`
      : `<span class="miss">${c.name}</span> <span class="d">— missed</span>`
  ));
  if (timedOut) lines.unshift('<span class="d">Time.</span>');

  finishGame(lines, game.found * 100, game.targets.length * 100);
}

/* ---------------------------- Draw mode -------------------------- */

// Shape, placement and size are each scored out of 100; the total is their mean.
const PLACE_K = 1.5;   // centroid miss, in equivalent radii, at which placement falls to 37%
const SIZE_K = 1;      // |ln(area ratio)| at which size falls to 37% (area x2.7)
const SHAPE_K = 0.2;   // mean boundary gap, in equivalent radii, at which shape falls to 37%
const SNAP_PX = 24;    // how close counts as touching an end

const draw = { tool: 'move', strokes: [], history: [], cur: null, before: null, from: 0 };

function ringFromFlat(flat) {
  const ring = [];
  for (let i = 0; i < flat.length; i += 2) ring.push([flat[i], flat[i + 1]]);
  return ring;
}

const wrapLon = (l) => ((((l + 180) % 360) + 360) % 360) - 180;

// Lambert azimuthal equal-area projection about (lat0, lon0), in km.
function lambert(lat0, lon0) {
  const p0 = rad(lat0), l0 = rad(lon0);
  const s0 = Math.sin(p0), c0 = Math.cos(p0);
  return ([lon, lat]) => {
    const p = rad(lat), dl = rad(lon) - l0;
    const k = Math.sqrt(2 / Math.max(1e-9, 1 + s0 * Math.sin(p) + c0 * Math.cos(p) * Math.cos(dl)));
    return [
      R_EARTH * k * Math.cos(p) * Math.sin(dl),
      R_EARTH * k * (c0 * Math.sin(p) - s0 * Math.cos(p) * Math.cos(dl)),
    ];
  };
}

// Mean direction of all vertices, as [lon, lat].
function centreOf(rings) {
  let x = 0, y = 0, z = 0;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      x += Math.cos(rad(lat)) * Math.cos(rad(lon));
      y += Math.cos(rad(lat)) * Math.sin(rad(lon));
      z += Math.sin(rad(lat));
    }
  }
  return [Math.atan2(y, x) * 180 / Math.PI, Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI];
}

// Total area and area-weighted centroid of a set of planar rings.
function moments(rings) {
  let area = 0, cx = 0, cy = 0;
  for (const r of rings) {
    let a = 0, x = 0, y = 0;
    for (let i = 0; i < r.length; i++) {
      const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length];
      const cr = x1 * y2 - x2 * y1;
      a += cr; x += (x1 + x2) * cr; y += (y1 + y2) * cr;
    }
    if (!a) continue;
    const w = Math.abs(a / 2);
    area += w; cx += (x / (3 * a)) * w; cy += (y / (3 * a)) * w;
  }
  return { area, cx: area ? cx / area : 0, cy: area ? cy / area : 0 };
}

function samplePoints(rings, n) {
  let per = 0;
  for (const r of rings) for (let i = 0; i < r.length; i++) per += Math.hypot(...sub(r[(i + 1) % r.length], r[i]));
  const step = per / n;
  const pts = [];
  if (!step) return pts;
  let carry = 0;
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const L = Math.hypot(...sub(b, a));
      if (!L) continue;
      let t = carry;
      for (; t < L; t += step) pts.push([a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L]);
      carry = t - L;
    }
  }
  return pts;
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }

function distToRings(p, rings) {
  let best = Infinity;
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
      const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
      if (d < best) best = d;
    }
  }
  return best;
}

function meanGap(from, to) {
  const pts = samplePoints(from, 300);
  if (!pts.length) return Infinity;
  return pts.reduce((s, p) => s + distToRings(p, to), 0) / pts.length;
}

// Placement: centroid miss. Size: area ratio. Shape: boundary gap once the
// drawing is moved onto the real centroid and scaled to the real area.
function scoreDrawing(loops, targetRings) {
  const [clon, clat] = centreOf(targetRings);
  const proj = lambert(clat, clon);
  const T = targetRings.map((r) => r.map(proj));
  const D = loops.map((r) => r.map(proj));
  const mt = moments(T), md = moments(D);
  if (!(md.area > 0)) return { place: 0, size: 0, shape: 0, total: 0 };

  const R = Math.sqrt(mt.area / Math.PI);
  const place = Math.exp(-Math.hypot(md.cx - mt.cx, md.cy - mt.cy) / R / PLACE_K);
  const size = Math.exp(-Math.abs(Math.log(md.area / mt.area)) / SIZE_K);

  const s = Math.sqrt(mt.area / md.area);
  const aligned = D.map((r) => r.map(([x, y]) => [mt.cx + s * (x - md.cx), mt.cy + s * (y - md.cy)]));
  const gap = (meanGap(aligned, T) + meanGap(T, aligned)) / 2 / R;
  const shape = Math.exp(-gap / SHAPE_K);

  const p = Math.round(100 * place);
  const q = Math.round(100 * size);
  const z = Math.round(100 * shape);
  return { place: p, size: q, shape: z, total: Math.round((p + q + z) / 3) };
}

/* Pen tool. Strokes are polylines in lon/lat; a stroke is open until its two
 * ends meet, and an end dropped on another stroke's end joins them. */

function setTool(t) {
  draw.tool = t;
  const pen = t === 'pen';
  for (const h of ['dragPan', 'scrollZoom', 'touchZoomRotate', 'doubleClickZoom', 'keyboard']) {
    map[h][pen ? 'disable' : 'enable']();
  }
  map.getCanvasContainer().style.touchAction = pen ? 'none' : '';
  map.getCanvas().style.cursor = pen ? 'crosshair' : '';
  el.toolPen.classList.toggle('active', pen);
  el.toolMove.classList.toggle('active', !pen);
}

function resetDraw() {
  draw.strokes = [];
  draw.history = [];
  draw.cur = null;
  const src = map && map.getSource('draw');
  if (src) src.setData({ type: 'FeatureCollection', features: [] });
  updateDrawButtons();
}

function updateDrawButtons() {
  el.undo.disabled = !draw.history.length;
  el.submit.disabled = !draw.strokes.some((s) => s.closed);
}

function renderDraw() {
  const feats = [];
  const f = (k, geometry) => feats.push({ type: 'Feature', properties: { k }, geometry });
  for (const s of draw.strokes) {
    if (s.closed) {
      const ring = [...s.pts, s.pts[0]];
      f('fill', { type: 'Polygon', coordinates: [ring] });
      f('line', { type: 'LineString', coordinates: ring });
    } else if (s.pts.length > 1) {
      f('line', { type: 'LineString', coordinates: s.pts });
      f('end', { type: 'Point', coordinates: s.pts[0] });
      f('end', { type: 'Point', coordinates: s.pts[s.pts.length - 1] });
    }
  }
  map.getSource('draw').setData({ type: 'FeatureCollection', features: feats });
  updateDrawButtons();
}

const toPx = (p) => map.project(p);
const pxDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function canvasPoint(e) {
  const r = map.getCanvas().getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

// The open stroke end nearest the pointer, if within reach.
function nearestEnd(pt) {
  let best = null, bd = SNAP_PX;
  for (const s of draw.strokes) {
    if (s.closed) continue;
    for (const which of ['start', 'end']) {
      const p = s.pts[which === 'start' ? 0 : s.pts.length - 1];
      const d = pxDist(pt, toPx(p));
      if (d <= bd) { bd = d; best = { stroke: s, which }; }
    }
  }
  return best;
}

// Douglas-Peucker in screen pixels.
function simplifyPx(pts, tol) {
  if (pts.length < 3) return pts;
  const px = pts.map(toPx);
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const dx = px[j].x - px[i].x, dy = px[j].y - px[i].y;
    const norm = Math.hypot(dx, dy);
    let best = 0, idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = norm
        ? Math.abs(dy * (px[k].x - px[i].x) - dx * (px[k].y - px[i].y)) / norm
        : pxDist(px[k], px[i]);
      if (d > best) { best = d; idx = k; }
    }
    if (best > tol) { keep[idx] = true; stack.push([i, idx], [idx, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

function alignLon(pts, ref) {
  const shift = Math.round((ref - pts[0][0]) / 360) * 360;
  return pts.map(([lon, lat]) => [lon + shift, lat]);
}

function penDown(e) {
  if (!game || game.cfg.mode !== 'draw' || game.locked) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;

  const pt = canvasPoint(e);
  const end = nearestEnd(pt);
  // With the hand, only an open end switches to the pen; anything else pans.
  if (draw.tool !== 'pen') {
    if (!end) return;
    setTool('pen');
  }
  e.preventDefault();
  try { map.getCanvas().setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
  draw.pid = e.pointerId;
  draw.before = JSON.stringify(draw.strokes);

  if (end) {
    draw.cur = end.stroke;
    if (end.which === 'start') draw.cur.pts.reverse();
  } else {
    const ll = map.unproject([pt.x, pt.y]);
    draw.cur = { pts: [[ll.lng, ll.lat]], closed: false };
    draw.strokes.push(draw.cur);
  }
  draw.from = draw.cur.pts.length - 1;
  draw.last = toPx(draw.cur.pts[draw.from]);
  el.hint.hidden = true;
}

function penMove(e) {
  if (!draw.cur || e.pointerId !== draw.pid) return;
  const pt = canvasPoint(e);
  if (pxDist(pt, draw.last) < 4) return;
  const ll = map.unproject([pt.x, pt.y]);
  if (!isFinite(ll.lng) || !isFinite(ll.lat)) return;
  const prev = draw.cur.pts[draw.cur.pts.length - 1];
  draw.cur.pts.push([nearLon(ll.lng, prev[0]), ll.lat]);
  draw.last = pt;
  renderDraw();
}

function penUp(e) {
  const s = draw.cur;
  if (!s || e.pointerId !== draw.pid) return;
  draw.cur = null;

  // Keep the old end and the simplified new part.
  const head = s.pts.slice(0, draw.from + 1);
  const tail = s.pts.slice(draw.from);
  s.pts = head.slice(0, -1).concat(simplifyPx(tail, 1.5));

  if (s.pts.length < 2) draw.strokes = draw.strokes.filter((x) => x !== s);
  else joinEnds(s);

  if (JSON.stringify(draw.strokes) !== draw.before) draw.history.push(draw.before);
  renderDraw();
  setTool('move');
}

// Close the stroke on itself, or join its end to another open stroke's end.
function joinEnds(s) {
  const tryClose = () => {
    if (s.pts.length < 4) return false;
    if (pxDist(toPx(s.pts[0]), toPx(s.pts[s.pts.length - 1])) > SNAP_PX) return false;
    s.pts.pop();
    s.closed = true;
    return true;
  };
  if (tryClose()) return;

  const endPx = toPx(s.pts[s.pts.length - 1]);
  for (const t of draw.strokes) {
    if (t === s || t.closed) continue;
    for (const which of ['start', 'end']) {
      const p = t.pts[which === 'start' ? 0 : t.pts.length - 1];
      if (pxDist(endPx, toPx(p)) > SNAP_PX) continue;
      const rest = which === 'start' ? t.pts : t.pts.slice().reverse();
      s.pts = s.pts.concat(alignLon(rest, s.pts[s.pts.length - 1][0]).slice(1));
      draw.strokes = draw.strokes.filter((x) => x !== t);
      tryClose();
      return;
    }
  }
}

function undoDraw() {
  if (!draw.history.length || game.locked) return;
  draw.strokes = JSON.parse(draw.history.pop());
  renderDraw();
}

function startDrawGame(cfg) {
  const ranked = drawPool(cfg);
  const count = Math.min(cfg.count, ranked.length);
  const depth = Math.max(cfg.pool || 0, count);
  const targets = shuffle(ranked.slice(0, Math.min(depth, ranked.length))).slice(0, count)
    .map((t) => ({ ...t, rings: t.flat.map(ringFromFlat) }));
  const cities = scopeCities(cfg);

  clearMap();   // while `game` is still the previous round
  game = {
    cfg, targets, bounds: boundsOf(cities), markers: [],
    i: 0, score: 0, locked: false, results: [], found: 0,
  };
  showPlay();
  startDrawRound();
}

function startDrawRound() {
  clearMap();
  game.locked = false;
  el.result.hidden = true;
  el.answerRow.hidden = true;
  el.guess.hidden = true;
  el.next.hidden = true;
  el.drawRow.hidden = false;
  setTool('move');

  const c = game.targets[game.i];
  el.cityName.textContent = c.name;
  el.citySub.textContent = c.country || '';
  el.score.textContent = game.score;
  el.progress.textContent = `${game.i + 1}/${game.targets.length}`;
  el.hint.hidden = true;
  viewScope();
}

function submitDraw() {
  const loops = draw.strokes.filter((s) => s.closed).map((s) => s.pts);
  if (!loops.length || game.locked) return;
  game.locked = true;
  setTool('move');

  const target = game.targets[game.i];
  const sc = scoreDrawing(loops, target.rings);
  game.score += sc.total;
  game.results.push({ name: target.name, ...sc });

  map.getSource('truth').setData({
    type: 'Feature',
    geometry: { type: 'MultiPolygon', coordinates: target.rings.map((r) => [[...r, r[0]]]) },
  });

  const open = draw.strokes.length - loops.length;
  el.resultCity.textContent = target.name;
  el.resultDist.textContent = `${sc.total} / 100`;
  el.resultPts.textContent =
    `Placement ${sc.place} · Size ${sc.size} · Shape ${sc.shape}`;
  el.resultPop.textContent = open ? `${open} unclosed line${open > 1 ? 's' : ''} ignored` : '';
  el.result.hidden = false;
  el.score.textContent = game.score;
  el.drawRow.hidden = true;
  el.next.hidden = false;
  el.next.textContent = game.i === game.targets.length - 1 ? 'Finish' : 'Next country';

  const all = [...target.rings, ...loops].flat()
    .map(([lon, lat]) => ({ lon: wrapLon(lon), lat }));
  fitTo(boundsOf(all), { top: 130, bottom: 230, left: 50, right: 50 });
}

function finishDrawGame() {
  const lines = game.results.map((r) =>
    `${r.name} — <span class="d">placement ${r.place} · size ${r.size} · shape ${r.shape}</span> — ${r.total}`);
  finishGame(lines, game.score, game.targets.length * 100);
}

/* ----------------------------- Wiring ---------------------------- */

el.guess.addEventListener('click', submitGuess);
el.next.addEventListener('click', () => {
  const draw = game.cfg.mode === 'draw';
  if (game.i === game.targets.length - 1) (draw ? finishDrawGame : finishClickGame)();
  else { game.i++; (draw ? startDrawRound : startClickRound)(); }
});
el.toolMove.addEventListener('click', () => setTool('move'));
el.toolPen.addEventListener('click', () => setTool('pen'));
el.undo.addEventListener('click', undoDraw);
el.submit.addEventListener('click', submitDraw);
el.answer.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); trySubmitName(); }
});
el.answer.addEventListener('input', () => el.answer.classList.remove('wrong'));
el.giveup.addEventListener('click', () => finishNameGame(false));

el.start.addEventListener('click', () => startGame(currentConfig()));
el.again.addEventListener('click', () => startGame(game ? game.cfg : currentConfig()));
el.change.addEventListener('click', toSetup);
el.quit.addEventListener('click', toSetup);

el.region.addEventListener('change', () => { buildCountrySelect(); countryChanged(); });
el.country.addEventListener('change', countryChanged);
for (const c of [el.mode, el.state, el.level, el.count, el.pool, el.seconds, el.capitals]) {
  c.addEventListener('change', refreshNote);
}

// Keep the answer box above the on-screen keyboard.
if (window.visualViewport) {
  const reposition = () => {
    const vv = window.visualViewport;
    const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    el.controls.style.transform = `translateY(${-hidden}px)`;
  };
  window.visualViewport.addEventListener('resize', reposition);
  window.visualViewport.addEventListener('scroll', reposition);
}

Promise.all([
  fetch('data/cities.json').then((r) => r.json()),
  fetch('data/borders.json').then((r) => r.json()).catch(() => null),
])
  .then(([d, b]) => {
    DATA = d;
    BORDERS = b;
    if (!BORDERS) el.mode.querySelector('option[value="draw"]').remove();
    buildRegionSelect();
    buildCountrySelect();
    refreshNote();
    initMap();
  })
  .catch(() => {
    el.note.textContent = 'Could not load the city data.';
    el.start.disabled = true;
  });
