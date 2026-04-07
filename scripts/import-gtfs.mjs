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
  ['geojson', 'gtfs', 'gtfs-merge', 'merge', 'tfl-api'].includes(sourceConfig.sourceType)
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

function resolveRequestQuery(sourceConfig) {
  const query = {};

  for (const [paramName, paramConfig] of Object.entries(sourceConfig.requestQuery ?? {})) {
    if (typeof paramConfig === 'string') {
      query[paramName] = paramConfig;
      continue;
    }

    if (paramConfig?.env) {
      const envValue = process.env[paramConfig.env];

      if (!envValue) {
        return null;
      }

      query[paramName] = envValue;
    }
  }

  return query;
}

function resolveRequestUrl(sourceConfig) {
  const query = resolveRequestQuery(sourceConfig);

  if (query === null) {
    return null;
  }

  const url = new URL(sourceConfig.sourceUrl);

  for (const [paramName, value] of Object.entries(query)) {
    url.searchParams.set(paramName, value);
  }

  return url.toString();
}

async function importSourceCity(sourceConfig, existingCitiesBySlug) {
  const features = await importSourceFeatures(sourceConfig, existingCitiesBySlug, sourceConfig);
  return buildImportedCity(sourceConfig, features);
}

async function importSourceFeatures(sourceConfig, existingCitiesBySlug, rootSourceConfig = sourceConfig) {
  if (sourceConfig.sourceType === 'geojson') {
    const requestHeaders = resolveRequestHeaders(sourceConfig);
    const requestUrl = resolveRequestUrl(sourceConfig);

    if (requestHeaders === null || requestUrl === null) {
      return reuseExistingCityFeatures(existingCitiesBySlug, rootSourceConfig);
    }

    return importGeoJsonFeatures(sourceConfig, requestHeaders, requestUrl);
  }

  if (sourceConfig.sourceType === 'gtfs') {
    const requestHeaders = resolveRequestHeaders(sourceConfig);
    const requestUrl = resolveRequestUrl(sourceConfig);

    if (requestHeaders === null || requestUrl === null) {
      return reuseExistingCityFeatures(existingCitiesBySlug, rootSourceConfig);
    }

    return importGtfsFeatures(sourceConfig, requestHeaders, requestUrl);
  }

  if (sourceConfig.sourceType === 'gtfs-merge' || sourceConfig.sourceType === 'merge') {
    return importMergedSourceFeatures(sourceConfig, existingCitiesBySlug, rootSourceConfig);
  }

  if (sourceConfig.sourceType === 'tfl-api') {
    return importTflApiFeatures(sourceConfig);
  }

  throw new Error(`Unsupported source type for ${rootSourceConfig.slug}: ${sourceConfig.sourceType}`);
}

function reuseExistingCityFeatures(existingCitiesBySlug, rootSourceConfig) {
  const existingCity = existingCitiesBySlug.get(rootSourceConfig.slug);

  if (existingCity) {
    console.warn(`Skipping ${rootSourceConfig.slug}: missing required credentials, reusing existing data.`);
    return existingCity.featureCollection.features;
  }

  throw new Error(`Missing required credentials for ${rootSourceConfig.slug}`);
}

async function importMergedSourceFeatures(sourceConfig, existingCitiesBySlug, rootSourceConfig) {
  const mergedSourceConfigs = sourceConfig.sources ?? [];

  if (mergedSourceConfigs.length === 0) {
    throw new Error(`No merged sources configured for ${sourceConfig.slug}`);
  }

  const features = [];

  for (const mergedSourceConfig of mergedSourceConfigs) {
    const effectiveSourceConfig = inheritMergedSourceConfig(sourceConfig, mergedSourceConfig);
    features.push(...(await importSourceFeatures(effectiveSourceConfig, existingCitiesBySlug, rootSourceConfig)));
  }

  return features;
}

function inheritMergedSourceConfig(sourceConfig, mergedSourceConfig) {
  return {
    ...sourceConfig,
    ...mergedSourceConfig,
    slug: sourceConfig.slug,
    name: sourceConfig.name,
    region: sourceConfig.region,
    focusPoint: mergedSourceConfig.focusPoint ?? sourceConfig.focusPoint,
    bounds: mergedSourceConfig.bounds ?? sourceConfig.bounds,
    centroid: mergedSourceConfig.centroid ?? sourceConfig.centroid
  };
}

async function importGeoJsonFeatures(sourceConfig, requestHeaders, requestUrl = sourceConfig.sourceUrl) {
  const geojson = JSON.parse(
    stripBom(
      await fetchTextWithRetries(requestUrl, {
        headers: requestHeaders
      })
    )
  );
  const lineIdProperty = normalizeValue(sourceConfig.lineIdProperty);

  if (!lineIdProperty) {
    throw new Error(`Missing lineIdProperty for ${sourceConfig.slug}`);
  }

  const allowedLineIds = sourceConfig.lineIdAllowlist ? new Set(sourceConfig.lineIdAllowlist) : null;
  const segmentsByCanonicalLine = new Map();
  const seenSegmentsByCanonicalLine = new Map();

  for (const feature of geojson.features ?? []) {
    const rawLineId = normalizeValue(String(feature.properties?.[lineIdProperty] ?? ''));

    if (!rawLineId || (allowedLineIds && !allowedLineIds.has(rawLineId))) {
      continue;
    }

    const canonicalLineId = sourceConfig.lineIdAliases?.[rawLineId] ?? rawLineId;
    const existingSegments = segmentsByCanonicalLine.get(canonicalLineId) ?? [];
    const seenSegments = seenSegmentsByCanonicalLine.get(canonicalLineId) ?? new Set();

    for (const segment of normalizeGeoJsonLineGeometry(feature.geometry, sourceConfig)) {
      const forwardKey = JSON.stringify(segment);
      const reverseKey = JSON.stringify([...segment].reverse());
      const dedupeKey = forwardKey < reverseKey ? forwardKey : reverseKey;

      if (seenSegments.has(dedupeKey)) {
        continue;
      }

      seenSegments.add(dedupeKey);
      existingSegments.push(segment);
    }

    if (existingSegments.length > 0) {
      segmentsByCanonicalLine.set(canonicalLineId, existingSegments);
      seenSegmentsByCanonicalLine.set(canonicalLineId, seenSegments);
    }
  }

  const features = [];

  for (const [canonicalLineId, segments] of segmentsByCanonicalLine.entries()) {
    if (segments.length === 0) {
      continue;
    }

    const lineName = sourceConfig.lineNameOverrides?.[canonicalLineId] ?? canonicalLineId;
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
        type: segments.length === 1 ? 'LineString' : 'MultiLineString',
        coordinates: segments.length === 1 ? segments[0] : segments
      }
    });
  }

  if (features.length === 0) {
    throw new Error(`No features were produced for ${sourceConfig.slug}`);
  }

  return features;
}

async function importGtfsFeatures(sourceConfig, requestHeaders, requestUrl = sourceConfig.sourceUrl) {
  const zip = openSourceArchive(
    await fetchBufferWithRetries(requestUrl, {
      headers: requestHeaders
    }),
    sourceConfig
  );
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

  return features;
}

function openSourceArchive(buffer, sourceConfig) {
  const zip = new AdmZip(buffer);
  const archiveEntry = normalizeValue(sourceConfig.archiveEntry);

  if (!archiveEntry) {
    return zip;
  }

  const nestedEntry = zip.getEntry(archiveEntry);

  if (!nestedEntry) {
    throw new Error(`Missing nested archive ${archiveEntry} in GTFS archive for ${sourceConfig.slug}`);
  }

  return new AdmZip(nestedEntry.getData());
}

function buildImportedCity(sourceConfig, features) {
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

async function importTflApiFeatures(sourceConfig) {
  const lineIds = sourceConfig.lineIds ?? [];

  if (lineIds.length === 0) {
    throw new Error(`No lineIds configured for ${sourceConfig.slug}`);
  }

  const features = [];

  for (const lineId of lineIds) {
    const routeSequence = await fetchJsonWithRetries(
      `${sourceConfig.sourceUrl.replace(/\/$/, '')}/Line/${lineId}/Route/Sequence/all`
    );
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

  return features;
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

function normalizeGeoJsonLineGeometry(geometry, sourceConfig) {
  if (!geometry) {
    return [];
  }

  const segments =
    geometry.type === 'MultiLineString'
      ? geometry.coordinates
      : geometry.type === 'LineString'
        ? [geometry.coordinates]
        : [];

  return segments
    .filter((segment) => Array.isArray(segment) && segment.length > 1)
    .map((segment) =>
      simplifyPoints(
        dedupeAdjacentPoints(
          segment
            .map(([lon, lat]) => ({
              lon: Number(lon),
              lat: Number(lat)
            }))
            .filter((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat))
        ),
        sourceConfig.minPointSpacingMeters ?? 0
      ).map(({ lon, lat }) => [lon, lat])
    )
    .filter((segment) => segment.length > 1);
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

async function fetchBufferWithRetries(url, options = {}, retries = 3) {
  return withFetchRetries(
    async () => Buffer.from(await fetchOk(url, options).then((response) => response.arrayBuffer())),
    retries
  );
}

async function fetchJsonWithRetries(url, options = {}, retries = 3) {
  return withFetchRetries(async () => fetchOk(url, options).then((response) => response.json()), retries);
}

async function fetchTextWithRetries(url, options = {}, retries = 3) {
  return withFetchRetries(async () => fetchOk(url, options).then((response) => response.text()), retries);
}

async function fetchOk(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  return response;
}

async function withFetchRetries(action, retries = 3, delayMs = 300) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      if (!isRetryableFetchError(error) || attempt === retries) {
        throw error;
      }

      await sleep(delayMs * (attempt + 1));
    }
  }
}

function isRetryableFetchError(error) {
  return (
    error?.cause?.code === 'UND_ERR_SOCKET' ||
    error?.cause?.code === 'ECONNRESET' ||
    error?.cause?.code === 'ETIMEDOUT' ||
    error?.cause?.code === 'EPIPE' ||
    error?.name === 'TypeError'
  );
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
