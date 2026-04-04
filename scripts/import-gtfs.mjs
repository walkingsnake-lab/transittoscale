import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sourcesPath = path.join(repoRoot, 'data', 'sources', 'gtfs-sources.json');
const normalizedDir = path.join(repoRoot, 'data', 'normalized');

const sourceConfigs = JSON.parse(await readFile(sourcesPath, 'utf8'));

await rm(normalizedDir, { recursive: true, force: true });
await mkdir(normalizedDir, { recursive: true });

const importedCities = [];

for (const sourceConfig of sourceConfigs) {
  if (sourceConfig.sourceType !== 'gtfs') {
    continue;
  }

  const requestHeaders = resolveRequestHeaders(sourceConfig);

  if (requestHeaders === null) {
    console.warn(`Skipping ${sourceConfig.slug}: missing required credentials.`);
    continue;
  }

  const city = await importGtfsCity(sourceConfig, requestHeaders);
  importedCities.push(city);
  await writeFile(
    path.join(normalizedDir, `${city.slug}.geojson`),
    `${JSON.stringify(city.featureCollection, null, 2)}\n`
  );
}

const manifest = importedCities.map(({ featureCollection, ...city }) => city);
await writeFile(
  path.join(normalizedDir, 'cities.json'),
  `${JSON.stringify(manifest, null, 2)}\n`
);

console.log(`Imported ${importedCities.length} GTFS cities into data/normalized`);

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
