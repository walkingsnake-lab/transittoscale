# Transit To Scale

Transit To Scale is a static web visualization that compares world metro systems side-by-side at the same real-world scale.

## Stack

- Vite
- Vanilla JavaScript
- Canvas 2D
- D3-geo for projection math
- Repo-local GeoJSON data and manifest files

## Getting Started

1. Install Node.js 20 or newer.
2. Install dependencies with `npm install`.
3. Validate the generated transit data with `npm run data:check`.
4. Start the dev server with `npm run dev`.

## Deploying To Vercel

- Import the repository into Vercel and keep the detected framework preset as Vite.
- The repo includes `vercel.json` with `npm run build` and `dist` as the output directory.
- The build regenerates `public/data` from normalized GTFS imports when they exist, and falls back to `data/raw/city-seeds.json` otherwise.
- Preview deployments are a good fit for checking card density, animation pacing, and mobile layout before promoting to production.

## Data Workflow

- Edit the seed dataset in `data/raw/city-seeds.json`.
- Import real GTFS pilot data with `npm run data:import`.
- Import water context layers with `npm run data:import-water`.
- Inspect GTFS source config in `data/sources/gtfs-sources.json` and generated normalized outputs in `data/normalized/`.
- Inspect water source config in `data/sources/water-sources.json` and generated outputs in `data/normalized-water/`.
- Run `npm run data:build` to regenerate `public/data/city-manifest.json` and the per-city GeoJSON files.
- Run `npm run data:check` to validate the generated output before shipping.

## Water Context

- Water context is optional per city and currently sourced from OpenStreetMap via the Overpass API.
- The importer keeps only major explanatory features such as lake, river, canal, and harbor geometry, then simplifies them for rendering.
- Water is rendered as a faint fill with a blue outline beneath the transit lines.
- If we ship OSM-derived water data, we should preserve OpenStreetMap attribution in the project.

## Anchoring Rule

- Cards stay at a shared real-world scale using one global meters-per-pixel constant.
- Each city can define a `focusPoint` in `[lon, lat]` form to anchor the card on its downtown or core urban center.
- When `focusPoint` is present, the network is translated so that point sits at the card center and the 5-mile circle is centered on the same anchor.
- When `focusPoint` is absent, the renderer falls back to the city's computed network centroid.

## Data Scope

- The launch scope is `metro / rapid transit only`.
- Include urban rapid-transit systems that function as the city's core metro or subway network.
- Exclude commuter rail and regional rail, even when they share downtown terminals or are strongly associated with the same city.
- Exclude adjacent or cross-jurisdiction systems unless they are explicitly part of the primary metro definition used across cities.
- For New York, this means `NYC Subway + Staten Island Railway`, and excludes `PATH`, `LIRR`, and `Metro-North`.
- If we ever want a broader comparison, it should be a separate mode rather than mixing definitions city by city.

## Current Imported Dataset

- The live manifest currently includes only normalized real-data cities.
- Chicago, New York, and Boston are imported from official GTFS feeds and rendered in the app.
- The hand-curated seed dataset remains in the repo as a fallback and development aid, but it is not shown once normalized imports exist.
