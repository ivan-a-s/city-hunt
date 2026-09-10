'use strict';

/* ------------------------------------------------------------------ *
 * City Hunt — a configurable geography drill on a satellite globe.
 *
 *   click mode — a city is named, you click where it is.
 *   name mode  — the cities are marked in red, you type their names
 *                against the clock, turning them green.
 *
 * Data: data/cities.json (built by tools/build-data.js from GeoNames).
 * ------------------------------------------------------------------ */

const CONTINENT_NAMES = {
  AF: 'Africa', AS: 'Asia', EU: 'Europe',
  NA: 'North America', SA: 'South America', OC: 'Oceania',
};
const CONTINENT_ORDER = ['AF', 'AS', 'EU', 'NA', 'SA', 'OC'];

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

function normalise(s) {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // strip diacritics
    .toLowerCase()
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
  const tol = b.length >= 12 ? 2 : b.length >= 6 ? 1 : 0;
  return tol > 0 && editDistance(a, b) <= tol;
}

/* ---------------------------- Setup UI --------------------------- */

function buildRegionSelect() {
  el.region.appendChild(new Option('The whole world', 'world', true, true));
  for (const code of CONTINENT_ORDER) {
    el.region.appendChild(new Option(CONTINENT_NAMES[code], code));
  }
}

function countriesIn(region) {
  return Object.entries(DATA.countries)
    .filter(([, c]) => region === 'world' || c.c === region)
    .sort((a, b) => a[1].n.localeCompare(b[1].n));
}

function buildCountrySelect() {
  const region = el.region.value;
  const label = region === 'world'
    ? 'Everywhere' : `All of ${CONTINENT_NAMES[region]}`;
  el.country.innerHTML = '';
  el.country.appendChild(new Option(label, '', true, true));
  for (const [iso, c] of countriesIn(region)) {
    el.country.appendChild(new Option(c.n, iso));
  }
}

function scopeCities(cfg) {
  const out = [];
  const add = (iso) => {
    for (const [name, lat, lon, pop, cap] of DATA.countries[iso].cities) {
      out.push({ name, lat, lon, pop, cap: !!cap, country: DATA.countries[iso].n });
    }
  };
  if (cfg.country) add(cfg.country);
  else countriesIn(cfg.region).forEach(([iso]) => add(iso));
  return out;
}

function currentConfig() {
  return {
    mode: el.mode.value,
    region: el.region.value,
    country: el.country.value,
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

function refreshNote() {
  el.timingRow.hidden = el.mode.value !== 'name';
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
    if (!game || game.cfg.mode !== 'click' || game.locked) return;
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

function clearMap() {
  if (guessMarker) { guessMarker.remove(); guessMarker = null; }
  if (actualMarker) { actualMarker.remove(); actualMarker = null; }
  if (game && game.markers) { game.markers.forEach((m) => m.remove()); game.markers = []; }
  const src = map.getSource('link');
  if (src) src.setData({ type: 'FeatureCollection', features: [] });
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
  return `cityhunt:${cfg.mode}:${cfg.region}:${cfg.country}:${cfg.count}:${cfg.pool}:${cfg.capitals ? 1 : 0}`;
}

function km(d) {
  return d < 10 ? `${d.toFixed(1)} km` : `${Math.round(d).toLocaleString('en-GB')} km`;
}

function startGame(cfg) {
  const ranked = availableFor(cfg);
  const count = Math.min(cfg.count, ranked.length);
  const depth = Math.max(cfg.pool || 0, count);
  const targets = shuffle(ranked.slice(0, Math.min(depth, ranked.length))).slice(0, count);

  const bounds = boundsOf(ranked.slice(0, Math.max(depth, 10)));
  const worldwide = cfg.region === 'world' && !cfg.country;
  const diag = worldwide ? 20000 : Math.max(50, diagonalKm(bounds));

  game = {
    cfg, targets, bounds, markers: [],
    // Scoring falls off exponentially with distance; the scale is tied to the
    // size of the region so a country round demands more precision than a
    // world round. 1000 points for a bullseye, ~370 at one scale length.
    k: Math.max(20, diag / 14),
    i: 0, score: 0, locked: false, results: [], found: 0,
  };

  el.setup.hidden = true;
  el.summary.hidden = true;
  el.hud.hidden = false;
  el.controls.hidden = false;
  clearMap();

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
  el.hud.hidden = true;
  el.controls.hidden = true;
  el.result.hidden = true;
  el.hint.hidden = true;
  el.summary.hidden = true;
  el.setup.hidden = false;
}

/* --------------------------- Click mode -------------------------- */

function startClickRound() {
  clearMap();
  game.locked = false;
  el.result.hidden = true;
  el.answerRow.hidden = true;
  el.next.hidden = true;
  el.guess.hidden = false;
  el.guess.disabled = true;
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
  finishGame(lines, game.score, game.targets.length * 1000);
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
    (c, i) => !game.solved.has(i) && matches(typed, c.name));
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

  finishGame(lines, game.found * 1000, game.targets.length * 1000);
}

/* ----------------------------- Wiring ---------------------------- */

el.guess.addEventListener('click', submitGuess);
el.next.addEventListener('click', () => {
  if (game.i === game.targets.length - 1) finishClickGame();
  else { game.i++; startClickRound(); }
});
el.answer.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); trySubmitName(); }
});
el.answer.addEventListener('input', () => el.answer.classList.remove('wrong'));
el.giveup.addEventListener('click', () => finishNameGame(false));

el.start.addEventListener('click', () => startGame(currentConfig()));
el.again.addEventListener('click', () => startGame(game ? game.cfg : currentConfig()));
el.change.addEventListener('click', toSetup);
el.quit.addEventListener('click', toSetup);

el.region.addEventListener('change', () => { buildCountrySelect(); refreshNote(); });
for (const c of [el.mode, el.country, el.count, el.pool, el.seconds, el.capitals]) {
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

fetch('data/cities.json')
  .then((r) => r.json())
  .then((d) => {
    DATA = d;
    buildRegionSelect();
    buildCountrySelect();
    refreshNote();
    initMap();
  })
  .catch(() => {
    el.note.textContent = 'Could not load the city data.';
    el.start.disabled = true;
  });
