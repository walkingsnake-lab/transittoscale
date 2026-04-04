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
- The build now regenerates `public/data` from `data/raw/city-seeds.json` during deployment, so source data stays canonical.
- Preview deployments are a good fit for checking card density, animation pacing, and mobile layout before promoting to production.

## Data Workflow

- Edit the seed dataset in `data/raw/city-seeds.json`.
- Import real GTFS pilot data with `npm run data:import`.
- Inspect GTFS source config in `data/sources/gtfs-sources.json` and generated normalized outputs in `data/normalized/`.
- Run `npm run data:build` to regenerate `public/data/city-manifest.json` and the per-city GeoJSON files.
- Run `npm run data:check` to validate the generated output before shipping.

## Current Starter Dataset

The repo currently mixes real and placeholder data:

- Chicago and New York are imported from official GTFS feeds and normalized into GeoJSON overrides.
- The remaining cities still use the hand-curated starter dataset so the full comparison grid stays populated while the real-data pipeline expands.
