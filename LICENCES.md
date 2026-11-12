# Licences and monetisation

Checked 2026-10-21.

| Component | Licence | Commercial use |
|---|---|---|
| MapLibre GL JS 5.24.0 | BSD-3-Clause | Yes |
| City data (GeoNames, via `all-the-cities` MIT) | CC BY 4.0 | Yes, with credit (shown in the app) |
| Country and state borders, populated places (Natural Earth) | Public domain | Yes |
| `countries-list` | MIT | Yes |
| Satellite imagery: EOX Sentinel-2 cloudless, 2016 mosaic | CC BY 4.0 | Yes, with credit (shown in the app) |

## Imagery

The app uses EOX's `s2cloudless_3857` layer. EOX's own capabilities file titles it
"Sentinel-2 cloudless layer for 2016" and states CC BY 4.0, with the credit
"EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified
Copernicus Sentinel data 2016)". The app's attribution carries this.

- EOX's 2018-2025 mosaics are CC BY-NC-SA 4.0 and need a paid EOX licence for
  commercial use. Do not switch to them for a monetised version.
- The site serves its own copy of the tiles up to zoom 8 (`tiles/`: 42,138 land tiles, 380 MB, fetched
  by `tools/fetch-tiles.py`; open-ocean tiles are skipped); CC BY 4.0 allows this with the credit. Zoom 10 would be
  about 4.5 GB and over a million files, too big for GitHub Pages (1 GB limit): it
  would need object storage such as Cloudflare R2.
- Resolution is 10 m (native to zoom 14). Coastlines and
  terrain are sharp at country zoom; cities, rivers and airports are clear at
  city zoom.
- Not checked: EOX's fair-use limits for heavy traffic. At scale, ask EOX
  (cloudless@eox.at) or host the tiles yourself.
- Esri World Imagery, used before, was dropped: its terms for commercial use
  could not be confirmed.

## Monetisation

- GeoGuessr moved to paid subscription in 2024, citing Google Maps API costs.
- Free geography games found rely on ads or donations (Geotastic: donations
  and ads, ads removable by donating).
- Revenue figures were not found, and nothing on Seterra.
- Remaining to do for a public monetised version: host MapLibre yourself instead
  of loading it from unpkg, and host the site somewhere that allows commercial
  use (GitHub Pages is not meant for it).
