# Licences and monetisation

Checked 2026-10-21.

| Component | Licence | Commercial use |
|---|---|---|
| MapLibre GL JS 5.24.0 | BSD-3-Clause | Yes |
| City data (GeoNames, via `all-the-cities` MIT) | CC BY 4.0 | Yes, with credit (shown in the app) |
| Country and state borders, populated places (Natural Earth) | Public domain | Yes |
| `countries-list` | MIT | Yes |
| **Esri World Imagery (current satellite layer)** | Esri terms | **Unresolved** |

## The blocker: imagery

A web search did not surface Esri's current terms for World Imagery. Older forum
reports read them as allowing use inside Esri software only, with a paid
ArcGIS subscription needed otherwise. Check Esri's current terms (ArcGIS
Location Platform, free tier, API key) before showing ads or charging.

Alternative: EOX Sentinel-2 cloudless (tiles at
`https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg`,
tested: returns imagery).
- Per EOX's licence page, the 2016 mosaic is CC BY 4.0 (commercial use with
  credit); 2018-2025 are CC BY-NC-SA 4.0, and commercial use needs a paid EOX
  licence.
- Not confirmed which year the un-dated layer above is: ask EOX
  (cloudless@eox.at) before relying on it.
- Resolution is 10 m, so city-level zoom is coarser than Esri's.

## Monetisation

- GeoGuessr moved to paid subscription in 2024, citing Google Maps API costs.
- Free geography games found rely on ads or donations (Geotastic: donations
  and ads, ads removable by donating).
- Revenue figures were not found, and nothing on Seterra.
- Imagery licensing is the main cost and legal risk. Everything else is free
  to use commercially with attribution.
