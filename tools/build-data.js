/*
 * Builds data/cities.json for the geography game.
 *
 * Requires (run once):  npm install all-the-cities countries-list
 * Sources: GeoNames (CC BY 4.0) via the `all-the-cities` package; ISO country
 * names and continents via `countries-list`.
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

const dest = process.argv[2] || path.join(__dirname, '..', 'data', 'cities.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out));

const n = Object.keys(out.countries).length;
const total = Object.values(out.countries).reduce((s, c) => s + c.cities.length, 0);
console.log(`${n} countries, ${total} cities -> ${dest} (${(fs.statSync(dest).size / 1024).toFixed(0)} kB)`);
