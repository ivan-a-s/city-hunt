/*
 * Builds data/cities.json for the geography game.
 *
 * Requires (run once):  npm install all-the-cities countries-list
 * Sources: GeoNames (CC BY 4.0) via the `all-the-cities` package; ISO country
 * names and continents via `countries-list`.
 *
 * Corrections (districts removed, capitals fixed) come from city-fixes.json.
 *
 * Usage: node build-data.js ../data/cities.json
 */
const fs = require('fs');
const path = require('path');
const cities = require('all-the-cities');
const { countries, continents } = require('countries-list');

const TOP_PER_COUNTRY = 60;

// Feature codes that denote a real settlement. Excludes PPLX (borough /
// section of a city), PPLL (locality), PPLQ/PPLW (abandoned/destroyed),
// PPLF (farm village), PPLR (religious), PPLH (historical).
const KEEP = new Set([
  'PPL', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPLA5', 'PPLC', 'PPLG',
]);

const byCountry = new Map();

for (const c of cities) {
  if (!KEEP.has(c.featureCode)) continue;
  if (!c.population || c.population < 1000) continue;
  if (!countries[c.country]) continue;
  if (!byCountry.has(c.country)) byCountry.set(c.country, new Map());
  const bucket = byCountry.get(c.country);
  // Collapse duplicate names within a country, keeping the largest.
  const key = c.name.toLowerCase();
  const prev = bucket.get(key);
  if (!prev || c.population > prev.population) {
    bucket.set(key, {
      name: c.name,
      population: c.population,
      lat: c.loc.coordinates[1],
      lon: c.loc.coordinates[0],
      capital: c.featureCode === 'PPLC',
    });
  }
}

const out = { generated: new Date().toISOString().slice(0, 10), continents, countries: {} };

for (const [iso, bucket] of byCountry) {
  const list = [...bucket.values()]
    .sort((a, b) => b.population - a.population)
    .slice(0, TOP_PER_COUNTRY);
  if (!list.length) continue;
  out.countries[iso] = {
    n: countries[iso].name,
    c: countries[iso].continent,
    // [name, lat, lon, population, isCapital]
    cities: list.map((c) => [
      c.name,
      Math.round(c.lat * 1e4) / 1e4,
      Math.round(c.lon * 1e4) / 1e4,
      c.population,
      c.capital ? 1 : 0,
    ]),
  };
}

// Curated corrections: districts GeoNames lists as cities, missing capitals.
const fixes = require('./city-fixes.json');
for (const [iso, names] of Object.entries(fixes.exclude)) {
  const country = out.countries[iso];
  if (country) country.cities = country.cities.filter((r) => !names.includes(r[0]));
}
for (const [iso, name] of Object.entries(fixes.capitals)) {
  const row = out.countries[iso] && out.countries[iso].cities.find((r) => r[0] === name);
  if (row) row[4] = 1;
}
for (const [iso, [name, lat, lon, pop]] of Object.entries(fixes.add)) {
  const country = out.countries[iso];
  if (!country) continue;
  let row = country.cities.find((r) => r[0] === name);
  if (!row) { row = [name, lat, lon, pop, 1]; country.cities.push(row); }
  row[4] = 1;
  country.cities.sort((a, b) => b[3] - a[3]);
}

// City-proper figures, before the metro-area substitution, for build-metro.py.
const rawPath = path.join(__dirname, 'src', 'cities-geonames.json');
fs.mkdirSync(path.dirname(rawPath), { recursive: true });
fs.writeFileSync(rawPath, JSON.stringify(out));

// Metro-area populations (tools/build-metro.py), where a city is the core of one.
let metro = {};
try { metro = require('./metro-pop.json'); } catch (e) { /* not built yet */ }
for (const [iso, pops] of Object.entries(metro)) {
  const country = out.countries[iso];
  if (!country) continue;
  for (const row of country.cities) if (pops[row[0]] !== undefined) row[3] = pops[row[0]];
  country.cities.sort((a, b) => b[3] - a[3]);
}

// English names, with the GeoNames name kept as an accepted alternative (row[5]);
// then other well-known alternative names.
for (const [iso, names] of Object.entries(fixes.rename || {})) {
  const country = out.countries[iso];
  if (!country) continue;
  for (const row of country.cities) {
    if (names[row[0]]) { row[5] = row[0]; row[0] = names[row[0]]; }
  }
}

for (const [iso, names] of Object.entries(fixes.alias || {})) {
  const country = out.countries[iso];
  if (!country) continue;
  for (const row of country.cities) if (names[row[0]]) row[5] = names[row[0]];
}

const dest = process.argv[2] || path.join(__dirname, '..', 'data', 'cities.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out));

const n = Object.keys(out.countries).length;
const total = Object.values(out.countries).reduce((s, c) => s + c.cities.length, 0);
console.log(`${n} countries, ${total} cities -> ${dest} (${(fs.statSync(dest).size / 1024).toFixed(0)} kB)`);
