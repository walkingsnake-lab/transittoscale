import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { getCityTheme } from '../src/config.js';
import { createCityDisplay } from '../src/lib/display-profiles.js';
import {
  DETAIL_BASE_HEIGHT,
  DETAIL_BASE_WIDTH,
  DETAIL_DIAGRAM_SCALE,
  DETAIL_RASTER_SCALE,
  DETAIL_SAFE_INSET,
  OVERVIEW_BASE_HEIGHT,
  OVERVIEW_BASE_WIDTH,
  OVERVIEW_RASTER_SCALE,
  OVERVIEW_SAFE_INSET,
  OVERVIEW_ZOOM_STEPS
} from '../src/lib/overview-config.js';
import { createOverviewDiagramSvg, getOverviewDiagramLayout } from '../src/lib/overview-diagram.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const rawDataPath = path.join(repoRoot, 'data', 'raw', 'city-seeds.json');
const normalizedDataPath = path.join(repoRoot, 'data', 'normalized', 'cities.json');
const sourceDataPath = path.join(repoRoot, 'data', 'sources', 'gtfs-sources.json');
const publicDataDir = path.join(repoRoot, 'public', 'data');
const cityDir = path.join(publicDataDir, 'cities');
const overviewDir = path.join(publicDataDir, 'overview');
const CITY_ORDER_COLLATOR = new Intl.Collator('en', { sensitivity: 'base' });

const raw = JSON.parse(await readFile(rawDataPath, 'utf8'));
const sourceConfigs = JSON.parse(await readFile(sourceDataPath, 'utf8'));
const sourceConfigBySlug = new Map(sourceConfigs.map((sourceConfig) => [sourceConfig.slug, sourceConfig]));
const normalized = await readNormalizedCities();

await mkdir(cityDir, { recursive: true });
await mkdir(overviewDir, { recursive: true });

const manifestSeed =
  normalized.size > 0
    ? [...normalized.values()].map((city) => attachDisplaySettings(attachServiceMetadata(city)))
    : raw.map((city) => attachDisplaySettings(attachServiceMetadata(buildSeedCity(city))));
const manifest = await Promise.all(sortCitiesForDisplay(manifestSeed).map((city, index) => attachOverviewAssets(city, index)));

for (const city of manifest) {
  const cityPath = path.join(cityDir, `${city.slug}.geojson`);
  await writeFile(cityPath, JSON.stringify(city.featureCollection, null, 2));
}
await pruneGeneratedFiles(
  cityDir,
  new Set(manifest.map((city) => `${city.slug}.geojson`))
);
await pruneGeneratedFiles(
  overviewDir,
  new Set(
    manifest.flatMap((city) => [
      ...OVERVIEW_ZOOM_STEPS.map((step) => `${city.slug}--${step.key}.webp`),
      `${city.slug}--detail.png`
    ])
  )
);

const manifestOutput = manifest.map(({ featureCollection, ...city }) => city);
await writeFile(
  path.join(publicDataDir, 'city-manifest.json'),
  JSON.stringify(manifestOutput, null, 2)
);

async function readNormalizedCities() {
  try {
    const normalizedManifest = JSON.parse(await readFile(normalizedDataPath, 'utf8'));
    const cities = await Promise.all(
      normalizedManifest.map(async (city) => {
        const featureCollection = JSON.parse(
          await readFile(path.join(repoRoot, 'data', 'normalized', `${city.slug}.geojson`), 'utf8')
        );

        return [city.slug, { ...city, featureCollection }];
      })
    );

    return new Map(cities);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return new Map();
    }

    throw error;
  }
}

function buildSeedCity(city) {
  const features = city.lines.map((line) => ({
    type: 'Feature',
    properties: {
      lineId: line.lineId,
      lineName: line.lineName,
      systemName: city.name
    },
    geometry: {
      type: 'LineString',
      coordinates: line.coordinates
    }
  }));

  const bounds = computeBounds(city.lines);
  const centroid = city.centroid ?? computeCentroid(city.lines);

  const featureCollection = {
    type: 'FeatureCollection',
    properties: {
      slug: city.slug,
      name: city.name,
      region: city.region,
      centroid,
      focusPoint: city.focusPoint ?? centroid,
      bounds
    },
    features
  };

  return {
    slug: city.slug,
    name: city.name,
    region: city.region,
    dataPath: `data/cities/${city.slug}.geojson`,
    centroid,
    focusPoint: city.focusPoint ?? centroid,
    bounds,
    lineCount: features.length,
    featureCollection
  };
}

function attachDisplaySettings(city) {
  const requestedProfile = city.displayProfile ?? sourceConfigBySlug.get(city.slug)?.displayProfile;

  return {
    ...city,
    display: createCityDisplay(requestedProfile, city.lineCount)
  };
}

function attachServiceMetadata(city) {
  const sourceConfig = sourceConfigBySlug.get(city.slug);
  const sourceName = city.sourceName ?? sourceConfig?.sourceName;
  const serviceSummary = city.serviceSummary ?? sourceConfig?.serviceSummary ?? sourceName;

  return {
    ...city,
    sourceName,
    serviceSummary
  };
}

async function attachOverviewAssets(city, index) {
  const theme = getCityTheme(city.slug, index);
  const variants = {};

  for (const step of OVERVIEW_ZOOM_STEPS) {
    const fileName = `${city.slug}--${step.key}.webp`;
    const layout = getOverviewDiagramLayout({
      city,
      minWidth: OVERVIEW_BASE_WIDTH,
      minHeight: OVERVIEW_BASE_HEIGHT,
      diagramScale: step.diagramScale,
      planePadding: OVERVIEW_SAFE_INSET
    });
    const svg = createOverviewDiagramSvg({
      city,
      width: layout.width,
      height: layout.height,
      theme,
      idPrefix: `${city.slug}-${step.key}`,
      includeReferenceMarker: false,
      layout
    });
    const png = new Resvg(svg, {
      fitTo: {
        mode: 'width',
        value: layout.width * OVERVIEW_RASTER_SCALE
      }
    }).render().asPng();
    const webp = await sharp(png)
      .webp({
        lossless: true,
        effort: 6
      })
      .toBuffer();

    await writeFile(path.join(overviewDir, fileName), webp);
    variants[step.key] = {
      imagePath: `data/overview/${fileName}`,
      width: layout.width,
      height: layout.height,
      referenceMarker: serializeReferenceMarker(layout)
    };
  }

  const detailFileName = `${city.slug}--detail.png`;
  const detailLayout = getOverviewDiagramLayout({
    city,
    minWidth: DETAIL_BASE_WIDTH,
    minHeight: DETAIL_BASE_HEIGHT,
    diagramScale: DETAIL_DIAGRAM_SCALE,
    planePadding: DETAIL_SAFE_INSET,
    centerContent: true
  });
  const detailSvg = createOverviewDiagramSvg({
    city,
    width: detailLayout.width,
    height: detailLayout.height,
    theme,
    idPrefix: `${city.slug}-detail`,
    includeReferenceMarker: false,
    layout: detailLayout
  });
  const detailPng = new Resvg(detailSvg, {
    fitTo: {
      mode: 'width',
      value: detailLayout.width * DETAIL_RASTER_SCALE
    }
  }).render().asPng();

  await writeFile(path.join(overviewDir, detailFileName), detailPng);

  return {
    ...city,
    overview: {
      viewportWidth: OVERVIEW_BASE_WIDTH,
      viewportHeight: OVERVIEW_BASE_HEIGHT,
      rasterScale: OVERVIEW_RASTER_SCALE,
      defaultVariant: 'standard',
      variants
    },
    detail: {
      viewportWidth: DETAIL_BASE_WIDTH,
      viewportHeight: DETAIL_BASE_HEIGHT,
      width: DETAIL_BASE_WIDTH,
      height: DETAIL_BASE_HEIGHT,
      rasterScale: DETAIL_RASTER_SCALE,
      imageWidth: detailLayout.width,
      imageHeight: detailLayout.height,
      imagePath: `data/overview/${detailFileName}`,
      referenceMarker: serializeReferenceMarker(detailLayout)
    }
  };
}

function sortCitiesForDisplay(cities) {
  return [...cities].sort((left, right) => {
    const regionComparison = CITY_ORDER_COLLATOR.compare(left.region ?? '', right.region ?? '');

    if (regionComparison !== 0) {
      return regionComparison;
    }

    return CITY_ORDER_COLLATOR.compare(left.name, right.name);
  });
}

function computeBounds(lines) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  for (const line of lines) {
    for (const [lon, lat] of line.coordinates) {
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    }
  }

  return [minLon, minLat, maxLon, maxLat];
}

function computeCentroid(lines) {
  let lonTotal = 0;
  let latTotal = 0;
  let count = 0;

  for (const line of lines) {
    for (const [lon, lat] of line.coordinates) {
      lonTotal += lon;
      latTotal += lat;
      count += 1;
    }
  }

  return [lonTotal / count, latTotal / count];
}

async function pruneGeneratedFiles(directory, keepFiles) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || keepFiles.has(entry.name)) {
      continue;
    }

    await unlinkWithRetries(path.join(directory, entry.name));
  }
}

async function unlinkWithRetries(filePath, retries = 6, delayMs = 150) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await unlink(filePath);
      return;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return;
      }

      const isRetryable = error.code === 'EPERM' || error.code === 'EBUSY';

      if (!isRetryable || attempt === retries) {
        console.warn(`Skipping stale generated file ${path.basename(filePath)}: ${error.code ?? error.message}`);
        return;
      }

      await sleep(delayMs * (attempt + 1));
    }
  }
}

function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function serializeReferenceMarker(layout) {
  return {
    centerX: roundDisplayNumber(layout.referenceCenterX),
    centerY: roundDisplayNumber(layout.referenceCenterY),
    radius: roundDisplayNumber(layout.referenceRadius),
    labelRadius: roundDisplayNumber(layout.referenceLabelRadius)
  };
}

function roundDisplayNumber(value) {
  return Number(value.toFixed(2));
}
