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
- Import the full GTFS catalog with `npm run data:import`.
- Import or refresh one city without re-fetching the rest with `npm run data:import -- --city <slug>`.
- Import multiple specific cities with repeated flags or a comma-separated list such as `npm run data:import -- --city montreal --city san-francisco-bay-area`.
- Inspect GTFS source config in `data/sources/gtfs-sources.json` and generated normalized outputs in `data/normalized/`.
- Run `npm run data:build` to regenerate `public/data/city-manifest.json` and the per-city GeoJSON files.
- Run `npm run data:check` to validate the generated output before shipping.

## Adding Or Updating Cities

- Add or edit an import source entry in `data/sources/gtfs-sources.json`.
- Keep scope to `metro / rapid transit only`, and use allowlists or aliases so each city maps to the intended lines.
- For a new city or a single-city tuning pass, run `npm run data:import -- --city <slug>`.
- For a city that requires credentials, the importer reuses the last generated normalized copy when credentials are unavailable, instead of dropping the city from the catalog.
- After importing, run `npm run data:build` and `npm run data:check`.
- Run `npm run build` before shipping to verify the app still bundles cleanly.
- If you remove a city from `data/sources/gtfs-sources.json` or want to reconcile the entire imported catalog from scratch, run the full `npm run data:import` instead of a targeted import.

## Incremental Import Notes

- `data/normalized/` is the source of truth for imported GTFS cities.
- `npm run data:import` rewrites the normalized manifest from every configured GTFS source.
- `npm run data:import -- --city <slug>` merges only the requested city into the existing normalized manifest and preserves the other imported cities as-is.
- `npm run data:build` is local-only: it publishes whatever already exists in `data/normalized/` to `public/data/`.
- The hand-curated seed dataset in `data/raw/city-seeds.json` is only used when there are no normalized imports available.

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
- For London, this means `Underground + DLR + London Overground + Elizabeth line`, and excludes `Thameslink` and other National Rail services.
- If we ever want a broader comparison, it should be a separate mode rather than mixing definitions city by city.

## Current Imported Dataset

- The live manifest currently includes only normalized real-data cities.
- Chicago, New York, Boston, Washington, DC, Minneapolis-St. Paul, Seattle, Toronto, Montreal, London, San Francisco Bay Area, San Jose / Santa Clara Valley, Atlanta, and Baltimore are imported from official agency feeds or APIs and rendered in the app.
