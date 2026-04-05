import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sourcesPath = path.join(repoRoot, 'data', 'sources', 'gtfs-sources.json');
const normalizedDir = path.join(repoRoot, 'data', 'normalized');
const publicDataDir = path.join(repoRoot, 'public', 'data');
const publicCityDir = path.join(publicDataDir, 'cities');

const sourceConfigs = JSON.parse(stripBom(await readFile(sourcesPath, 'utf8')));
const importSourceConfigs = sourceConfigs.filter((sourceConfig) =>
  ['gtfs', 'tfl-api'].includes(sourceConfig.sourceType)
);
const sourceConfigBySlug = new Map(importSourceConfigs.map((sourceConfig) => [sourceConfig.slug, sourceConfig]));
const selectedCitySlugs = parseSelectedCitySlugs(process.argv.slice(2));
const selectedSourceConfigs = resolveSelectedSourceConfigs(selectedCitySlugs, sourceConfigBySlug, importSourceConfigs);
const isSelectiveImport = selectedCitySlugs.length > 0;
const existingCitiesBySlug = await readExistingImportedCities(sourceConfigBySlug);

await mkdir(normalizedDir, { recursive: true });

const citiesBySlug = isSelectiveImport ? new Map(existingCitiesBySlug) : new Map();

for (const sourceConfig of selectedSourceConfigs) {
  const city = await importSourceCity(sourceConfig, existingCitiesBySlug);
  citiesBySlug.set(city.slug, city);
}

const manifestCities = sortCitiesForManifest([...citiesBySlug.values()], importSourceConfigs);

for (const city of manifestCities) {
  await writeFile(
    path.join(normalizedDir, `${city.slug}.geojson`),
    `${JSON.stringify(city.featureCollection, null, 2)}\n`
  );
}

const manifest = manifestCities.map(({ featureCollection, ...city }) => city);
await writeFile(
  path.join(normalizedDir, 'cities.json'),
  `${JSON.stringify(manifest, null, 2)}\n`
);
if (!isSelectiveImport) {
  await pruneGeneratedFiles(
    normalizedDir,
    new Set([...manifestCities.map((city) => `${city.slug}.geojson`), 'cities.json'])
  );
}

if (isSelectiveImport) {
  console.log(
    `Imported ${selectedSourceConfigs.length} requested transit cities; normalized catalog now has ${manifestCities.length} cities.`
  );
} else {
  console.log(`Imported ${manifestCities.length} transit cities into data/normalized`);
}

async function readExistingImportedCities(sourceConfigBySlug) {
  const cities = new Map();
  await addExistingCitiesFromManifest(
    cities,
    sourceConfigBySlug,
    path.join(normalizedDir, 'cities.json'),
    normalizedDir
  );
  await addExistingCitiesFromManifest(
    cities,
    sourceConfigBySlug,
    path.join(publicDataDir, 'city-manifest.json'),
    publicCityDir
  );
  return cities;
}

async function addExistingCitiesFromManifest(cities, sourceConfigBySlug, manifestPath, cityDirectory) {
  try {
    const manifest = JSON.parse(stripBom(await readFile(manifestPath, 'utf8')));

    for (const city of manifest) {
      if (cities.has(city.slug) || !sourceConfigBySlug.has(city.slug)) {
        continue;
      }

      const featureCollection = JSON.parse(
        stripBom(await readFile(path.join(cityDirectory, `${city.slug}.geojson`), 'utf8'))
      );
      cities.set(city.slug, { ...city, featureCollection });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

function parseSelectedCitySlugs(argv) {
  const citySlugs = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument !== '--city') {
      throw new Error(`Unknown argument: ${argument}`);
    }

    const value = argv[index + 1];

    if (!value || value.startsWith('--')) {
      throw new Error('The --city flag requires a slug.');
    }

    citySlugs.push(
      ...value
        .split(',')
        .map((slug) => slug.trim())
        .filter(Boolean)
    );
    index += 1;
  }

  return [...new Set(citySlugs)];
}

function resolveSelectedSourceConfigs(selectedCitySlugs, sourceConfigBySlug, importSourceConfigs) {
  if (selectedCitySlugs.length === 0) {
    return importSourceConfigs;
  }

  const unknownSlugs = selectedCitySlugs.filter((slug) => !sourceConfigBySlug.has(slug));

  if (unknownSlugs.length > 0) {
    throw new Error(`Unknown GTFS city slug(s): ${unknownSlugs.join(', ')}`);
  }

  return selectedCitySlugs.map((slug) => sourceConfigBySlug.get(slug));
}

function sortCitiesForManifest(cities, gtfsSourceConfigs) {
  const sortIndexBySlug = new Map(
    gtfsSourceConfigs.map((sourceConfig, index) => [sourceConfig.slug, index])
  );

  return [...cities].sort((left, right) => {
    const leftIndex = sortIndexBySlug.get(left.slug) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = sortIndexBySlug.get(right.slug) ?? Number.MAX_SAFE_INTEGER;

    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }

    return left.name.localeCompare(right.name);
  });
}

function resolveRequestHeaders(sourceConfig) {
  const headers = {
    'user-agent': 'Transit To Scale importer'
  };

  for (const [headerName, headerConfig] of Object.entries(sourceConfig.requestHeaders ?? {})) {
    if (typeof headerConfig === 'string') {
      headers[headerName] = headerConfig;
      continue;
    }

    if (headerConfig?.env) {
      const envValue = process.env[headerConfig.env];

      if (!envValue) {
        return null;
      }

      headers[headerName] = envValue;
    }
  }

  return headers;
}

async function importSourceCity(sourceConfig, existingCitiesBySlug) {
  if (sourceConfig.sourceType === 'gtfs') {
    const requestHeaders = resolveRequestHeaders(sourceConfig);

    if (requestHeaders === null) {
      const existingCity = existingCitiesBySlug.get(sourceConfig.slug);

      if (existingCity) {
        console.warn(`Skipping ${sourceConfig.slug}: missing required credentials, reusing existing data.`);
        return existingCity;
      }

      throw new Error(`Missing required credentials for ${sourceConfig.slug}`);
    }

    return importGtfsCity(sourceConfig, requestHeaders);
  }

  if (sourceConfig.sourceType === 'tfl-api') {
    return importTflApiCity(sourceConfig);
  }

  throw new Error(`Unsupported source type for ${sourceConfig.slug}: ${sourceConfig.sourceType}`);
}

async function importGtfsCity(sourceConfig, requestHeaders) {
  const response = await fetch(sourceConfig.sourceUrl, {
    headers: requestHeaders
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${sourceConfig.slug}: ${response.status} ${response.statusText}`);
  }

  const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
  const routes = parseCsvFromZip(zip, 'routes.txt');
  const trips = parseCsvFromZip(zip, 'trips.txt');
  const shapes = parseCsvFromZip(zip, 'shapes.txt');

  const selectedRoutes = selectRoutes(routes, sourceConfig);
  const selectedRouteIds = new Set(selectedRoutes.map((route) => route.route_id));
  const routeCanonicalById = new Map(
    selectedRoutes.map((route) => [route.route_id, getCanonicalLineId(route, sourceConfig)])
  );
  const shapePointsById = groupShapesById(shapes, sourceConfig);
  const shapeCountsByCanonicalLine = collectShapeCountsByCanonicalLine(
    trips,
    selectedRouteIds,
    routeCanonicalById
  );
  const routesByCanonicalId = groupRoutesByCanonicalLine(selectedRoutes, sourceConfig);

  const features = [];

  for (const [canonicalLineId, groupedRoutes] of routesByCanonicalId.entries()) {
    const shapeCounts = shapeCountsByCanonicalLine.get(canonicalLineId) ?? new Map();
    const selectedShapeIds = selectDisplayShapeIds(shapeCounts, sourceConfig);
    const multiLineCoordinates = selectedShapeIds
      .map((shapeId) => shapePointsById.get(shapeId))
      .filter((points) => points && points.length > 1)
      .map((points) => points.map(({ lon, lat }) => [lon, lat]));

    if (multiLineCoordinates.length === 0) {
      continue;
    }

    const lineName = getLineName(canonicalLineId, groupedRoutes[0], sourceConfig);
    features.push({
      type: 'Feature',
      properties: {
        lineId: canonicalLineId,
        lineName,
        systemName: sourceConfig.name,
        sourceName: sourceConfig.sourceName,
        sourceUrl: sourceConfig.sourceUrl
      },
      geometry: {
        type: multiLineCoordinates.length === 1 ? 'LineString' : 'MultiLineString',
        coordinates: multiLineCoordinates.length === 1 ? multiLineCoordinates[0] : multiLineCoordinates
      }
    });
  }

  if (features.length === 0) {
    throw new Error(`No features were produced for ${sourceConfig.slug}`);
  }

  const bounds = computeBoundsFromFeatures(features);
  const centroid = computeCentroidFromBounds(bounds);

  return {
    slug: sourceConfig.slug,
    name: sourceConfig.name,
    region: sourceConfig.region,
    dataPath: `data/cities/${sourceConfig.slug}.geojson`,
    centroid,
    focusPoint: sourceConfig.focusPoint ?? centroid,
    bounds,
    lineCount: features.length,
    sourceName: sourceConfig.sourceName,
    sourceUrl: sourceConfig.sourceUrl,
    featureCollection: {
      type: 'FeatureCollection',
      properties: {
        slug: sourceConfig.slug,
        name: sourceConfig.name,
        region: sourceConfig.region,
        centroid,
        focusPoint: sourceConfig.focusPoint ?? centroid,
        bounds,
        sourceName: sourceConfig.sourceName,
        sourceUrl: sourceConfig.sourceUrl
      },
      features
    }
  };
}

async function importTflApiCity(sourceConfig) {
  const lineIds = sourceConfig.lineIds ?? [];

  if (lineIds.length === 0) {
    throw new Error(`No lineIds configured for ${sourceConfig.slug}`);
  }

  const features = [];

  for (const lineId of lineIds) {
    const response = await fetch(`${sourceConfig.sourceUrl.replace(/\/$/, '')}/Line/${lineId}/Route/Sequence/all`);

    if (!response.ok) {
      throw new Error(`Failed to download ${sourceConfig.slug}/${lineId}: ${response.status} ${response.statusText}`);
    }

    const routeSequence = await response.json();
    const multiLineCoordinates = normalizeTflLineStrings(routeSequence.lineStrings, sourceConfig);

    if (multiLineCoordinates.length === 0) {
      continue;
    }

    const lineName = sourceConfig.lineNameOverrides?.[lineId] ?? routeSequence.lineName ?? lineId;
    features.push({
      type: 'Feature',
      properties: {
        lineId,
        lineName,
        systemName: sourceConfig.name,
        sourceName: sourceConfig.sourceName,
        sourceUrl: sourceConfig.sourceUrl
      },
      geometry: {
        type: multiLineCoordinates.length === 1 ? 'LineString' : 'MultiLineString',
        coordinates: multiLineCoordinates.length === 1 ? multiLineCoordinates[0] : multiLineCoordinates
      }
    });
  }

  if (features.length === 0) {
    throw new Error(`No features were produced for ${sourceConfig.slug}`);
  }

  const bounds = computeBoundsFromFeatures(features);
  const centroid = computeCentroidFromBounds(bounds);

  return {
    slug: sourceConfig.slug,
    name: sourceConfig.name,
    region: sourceConfig.region,
    dataPath: `data/cities/${sourceConfig.slug}.geojson`,
    centroid,
    focusPoint: sourceConfig.focusPoint ?? centroid,
    bounds,
    lineCount: features.length,
    sourceName: sourceConfig.sourceName,
    sourceUrl: sourceConfig.sourceUrl,
    featureCollection: {
      type: 'FeatureCollection',
      properties: {
        slug: sourceConfig.slug,
        name: sourceConfig.name,
        region: sourceConfig.region,
        centroid,
        focusPoint: sourceConfig.focusPoint ?? centroid,
        bounds,
        sourceName: sourceConfig.sourceName,
        sourceUrl: sourceConfig.sourceUrl
      },
      features
    }
  };
}

function parseCsvFromZip(zip, filename) {
  const entry = zip.getEntry(filename);

  if (!entry) {
    throw new Error(`Missing ${filename} in GTFS archive`);
  }

  return parse(entry.getData().toString('utf8'), {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: true
  });
}

function selectRoutes(routes, sourceConfig) {
  const allowedTypes = new Set(sourceConfig.routeTypes ?? []);
  const allowedRouteIds = sourceConfig.routeIdAllowlist
    ? new Set(sourceConfig.routeIdAllowlist)
    : null;
  const allowedShortNames = sourceConfig.routeShortNameAllowlist
    ? new Set(sourceConfig.routeShortNameAllowlist)
    : null;

  return routes.filter((route) => {
    const routeTypeMatch = allowedTypes.size === 0 || allowedTypes.has(String(route.route_type));
    const routeIdMatch = !allowedRouteIds || allowedRouteIds.has(normalizeValue(route.route_id));
    const shortName = normalizeValue(route.route_short_name);
    const shortNameMatch = !allowedShortNames || allowedShortNames.has(shortName);
    return routeTypeMatch && routeIdMatch && shortNameMatch;
  });
}

function groupRoutesByCanonicalLine(routes, sourceConfig) {
  const grouped = new Map();

  for (const route of routes) {
    const canonicalLineId = getCanonicalLineId(route, sourceConfig);
    const current = grouped.get(canonicalLineId) ?? [];
    current.push(route);
    grouped.set(canonicalLineId, current);
  }

  return grouped;
}

function groupShapesById(shapeRows, sourceConfig) {
  const grouped = new Map();

  for (const row of shapeRows) {
    const shapeId = row.shape_id;
    const point = {
      lat: Number(row.shape_pt_lat),
      lon: Number(row.shape_pt_lon),
      sequence: Number(row.shape_pt_sequence)
    };

    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon) || !Number.isFinite(point.sequence)) {
      continue;
    }

    const points = grouped.get(shapeId) ?? [];
    points.push(point);
    grouped.set(shapeId, points);
  }

  for (const [shapeId, points] of grouped.entries()) {
    points.sort((left, right) => left.sequence - right.sequence);
    grouped.set(
      shapeId,
      simplifyPoints(dedupeAdjacentPoints(points), sourceConfig.minPointSpacingMeters ?? 0)
    );
  }

  return grouped;
}

function collectShapeCountsByCanonicalLine(trips, selectedRouteIds, routeCanonicalById) {
  const shapeCountsByCanonicalLine = new Map();

  for (const trip of trips) {
    if (!selectedRouteIds.has(trip.route_id) || !trip.shape_id) {
      continue;
    }

    const canonicalLineId = routeCanonicalById.get(trip.route_id);
    const shapeCounts = shapeCountsByCanonicalLine.get(canonicalLineId) ?? new Map();
    shapeCounts.set(trip.shape_id, (shapeCounts.get(trip.shape_id) ?? 0) + 1);
    shapeCountsByCanonicalLine.set(canonicalLineId, shapeCounts);
  }

  return shapeCountsByCanonicalLine;
}

function selectDisplayShapeIds(shapeCounts, sourceConfig) {
  const sortedEntries = [...shapeCounts.entries()].sort((left, right) => right[1] - left[1]);

  if (sortedEntries.length === 0) {
    return [];
  }

  const maxTripCount = sortedEntries[0][1];
  const minShapeTrips = sourceConfig.minShapeTrips ?? 1;
  const shapeTripShareThreshold = sourceConfig.shapeTripShareThreshold ?? 0;

  const selectedShapeIds = sortedEntries
    .filter(([, tripCount]) => {
      const tripShare = tripCount / maxTripCount;
      return tripCount >= minShapeTrips && tripShare >= shapeTripShareThreshold;
    })
    .map(([shapeId]) => shapeId);

  return selectedShapeIds.length > 0 ? selectedShapeIds : [sortedEntries[0][0]];
}

function dedupeAdjacentPoints(points) {
  const deduped = [];

  for (const point of points) {
    const previous = deduped[deduped.length - 1];

    if (previous && previous.lat === point.lat && previous.lon === point.lon) {
      continue;
    }

    deduped.push(point);
  }

  return deduped;
}

function simplifyPoints(points, minPointSpacingMeters) {
  if (minPointSpacingMeters <= 0 || points.length <= 2) {
    return points;
  }

  const simplified = [points[0]];

  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const previous = simplified[simplified.length - 1];

    if (distanceMeters(previous, point) >= minPointSpacingMeters) {
      simplified.push(point);
    }
  }

  simplified.push(points.at(-1));
  return simplified;
}

function normalizeTflLineStrings(lineStrings, sourceConfig) {
  const segments = [];

  for (const lineString of lineStrings ?? []) {
    const parsed = typeof lineString === 'string' ? JSON.parse(lineString) : lineString;
    const normalizedSegments = Array.isArray(parsed?.[0]?.[0]) ? parsed : [parsed];

    for (const segment of normalizedSegments) {
      if (!Array.isArray(segment) || segment.length < 2) {
        continue;
      }

      const points = segment
        .map(([lon, lat]) => ({
          lon: Number(lon),
          lat: Number(lat)
        }))
        .filter((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat));

      if (points.length < 2) {
        continue;
      }

      segments.push(
        simplifyPoints(dedupeAdjacentPoints(points), sourceConfig.minPointSpacingMeters ?? 0).map(
          ({ lon, lat }) => [lon, lat]
        )
      );
    }
  }

  return segments;
}

function distanceMeters(left, right) {
  const toRadians = Math.PI / 180;
  const meanLat = ((left.lat + right.lat) / 2) * toRadians;
  const deltaLat = (right.lat - left.lat) * 111_320;
  const deltaLon = (right.lon - left.lon) * 111_320 * Math.cos(meanLat);
  return Math.hypot(deltaLat, deltaLon);
}

function getLineName(canonicalLineId, route, sourceConfig) {
  if (sourceConfig.lineNameOverrides?.[canonicalLineId]) {
    return sourceConfig.lineNameOverrides[canonicalLineId];
  }

  const shortName = normalizeValue(route.route_short_name);
  return normalizeValue(route.route_long_name) || shortName || canonicalLineId;
}

function getCanonicalLineId(route, sourceConfig) {
  const routeId = normalizeValue(route.route_id);
  return sourceConfig.routeIdAliases?.[routeId] || routeId;
}

function normalizeValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stripBom(content) {
  return content.replace(/^\uFEFF/, '');
}

function computeBoundsFromFeatures(features) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  for (const feature of features) {
    const segments =
      feature.geometry.type === 'MultiLineString'
        ? feature.geometry.coordinates
        : [feature.geometry.coordinates];

    for (const segment of segments) {
      for (const [lon, lat] of segment) {
        minLon = Math.min(minLon, lon);
        minLat = Math.min(minLat, lat);
        maxLon = Math.max(maxLon, lon);
        maxLat = Math.max(maxLat, lat);
      }
    }
  }

  return [minLon, minLat, maxLon, maxLat];
}

function computeCentroidFromBounds(bounds) {
  const [minLon, minLat, maxLon, maxLat] = bounds;
  return [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
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
        throw error;
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
