import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import osmtogeojson from 'osmtogeojson';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sourcesPath = path.join(repoRoot, 'data', 'sources', 'water-sources.json');
const outputDir = path.join(repoRoot, 'data', 'normalized-water');
const sourceConfigs = JSON.parse(await readFile(sourcesPath, 'utf8'));

await mkdir(outputDir, { recursive: true });

const importedSlugs = [];

for (const sourceConfig of sourceConfigs) {
  if (sourceConfig.sourceType !== 'osm-overpass') {
    continue;
  }

  const featureCollection = await importWaterContext(sourceConfig);
  importedSlugs.push(sourceConfig.slug);
  await writeFile(
    path.join(outputDir, `${sourceConfig.slug}.geojson`),
    `${JSON.stringify(featureCollection, null, 2)}\n`
  );
}

await pruneGeneratedFiles(
  outputDir,
  new Set(importedSlugs.map((slug) => `${slug}.geojson`))
);

console.log(`Imported ${importedSlugs.length} water context layers into data/normalized-water`);

async function importWaterContext(sourceConfig) {
  const response = await fetch(sourceConfig.sourceUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'Transit To Scale water importer'
    },
    body: `data=${encodeURIComponent(buildOverpassQuery(sourceConfig.bbox))}`
  });

  if (!response.ok) {
    throw new Error(`Failed to download water context for ${sourceConfig.slug}: ${response.status} ${response.statusText}`);
  }

  const geojson = osmtogeojson(await response.json());
  const features = geojson.features
    .filter((feature) => isSupportedGeometry(feature.geometry?.type))
    .filter((feature) => shouldKeepFeature(feature, sourceConfig))
    .map((feature) => normalizeFeature(feature, sourceConfig))
    .filter(Boolean);

  return {
    type: 'FeatureCollection',
    properties: {
      slug: sourceConfig.slug,
      sourceName: sourceConfig.sourceName,
      sourceUrl: sourceConfig.sourceUrl
    },
    features
  };
}

function buildOverpassQuery([south, west, north, east]) {
  return `
[out:json][timeout:90];
(
  way["natural"="water"](${south},${west},${north},${east});
  relation["natural"="water"](${south},${west},${north},${east});
  way["waterway"="riverbank"](${south},${west},${north},${east});
  relation["waterway"="riverbank"](${south},${west},${north},${east});
  way["natural"="coastline"](${south},${west},${north},${east});
);
out body;
>;
out skel qt;
`.trim();
}

function isSupportedGeometry(type) {
  return (
    type === 'Polygon' ||
    type === 'MultiPolygon' ||
    type === 'LineString' ||
    type === 'MultiLineString'
  );
}

function shouldKeepFeature(feature, sourceConfig) {
  const properties = feature.properties ?? {};
  const water = normalizeValue(properties.water);
  const natural = normalizeValue(properties.natural);
  const waterway = normalizeValue(properties.waterway);
  const name = normalizeValue(properties.name);
  const includeNames = new Set(sourceConfig.includeNames ?? []);
  const includeNaturalValues = new Set(sourceConfig.includeNaturalValues ?? []);
  const includeWaterValues = new Set(sourceConfig.includeWaterValues ?? []);
  const includeWaterwayValues = new Set(sourceConfig.includeWaterwayValues ?? []);
  const excludeWaterValues = new Set(sourceConfig.excludeWaterValues ?? []);

  if (includeNames.has(name)) {
    return true;
  }

  if (isPolygonGeometry(feature.geometry.type)) {
    if (waterway && includeWaterwayValues.has(waterway)) {
      return polygonAreaSquareMeters(feature.geometry) >= (sourceConfig.minAreaSquareMeters ?? 0);
    }

    if (!includeNaturalValues.has(natural)) {
      return false;
    }

    if (water && excludeWaterValues.has(water)) {
      return false;
    }

    if (water && includeWaterValues.size > 0 && !includeWaterValues.has(water)) {
      return false;
    }

    return polygonAreaSquareMeters(feature.geometry) >= (sourceConfig.minAreaSquareMeters ?? 0);
  }

  if (feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString') {
    const isCoastline = natural === 'coastline';
    const isIncludedWaterway = waterway && includeWaterwayValues.has(waterway);
    if (!isCoastline && !isIncludedWaterway) {
      return false;
    }

    return lineLengthMeters(feature.geometry) >= (sourceConfig.minLineLengthMeters ?? 0);
  }

  return false;
}

function normalizeFeature(feature, sourceConfig) {
  const geometry = simplifyGeometry(feature.geometry, sourceConfig.minPointSpacingMeters ?? 0);

  if (!geometry) {
    return null;
  }

  return {
    type: 'Feature',
    properties: {
      name: normalizeValue(feature.properties?.name),
      natural: normalizeValue(feature.properties?.natural),
      water: normalizeValue(feature.properties?.water),
      waterway: normalizeValue(feature.properties?.waterway),
      sourceName: sourceConfig.sourceName,
      sourceUrl: sourceConfig.sourceUrl
    },
    geometry
  };
}

function simplifyGeometry(geometry, minPointSpacingMeters) {
  if (geometry.type === 'Polygon') {
    const coordinates = geometry.coordinates
      .map((ring) => simplifyRing(ring, minPointSpacingMeters))
      .filter((ring) => ring.length >= 4);

    return coordinates.length > 0 ? { type: 'Polygon', coordinates } : null;
  }

  if (geometry.type === 'MultiPolygon') {
    const coordinates = geometry.coordinates
      .map((polygon) =>
        polygon
          .map((ring) => simplifyRing(ring, minPointSpacingMeters))
          .filter((ring) => ring.length >= 4)
      )
      .filter((polygon) => polygon.length > 0);

    return coordinates.length > 0 ? { type: 'MultiPolygon', coordinates } : null;
  }

  if (geometry.type === 'LineString') {
    const coordinates = simplifyLine(geometry.coordinates, minPointSpacingMeters);
    return coordinates.length > 1 ? { type: 'LineString', coordinates } : null;
  }

  if (geometry.type === 'MultiLineString') {
    const coordinates = geometry.coordinates
      .map((line) => simplifyLine(line, minPointSpacingMeters))
      .filter((line) => line.length > 1);

    return coordinates.length > 0 ? { type: 'MultiLineString', coordinates } : null;
  }

  return null;
}

function simplifyRing(ring, minPointSpacingMeters) {
  if (ring.length < 4) {
    return ring;
  }

  const openRing = ring.slice(0, -1);
  const simplified = simplifyLine(openRing, minPointSpacingMeters);

  if (simplified.length < 3) {
    return [];
  }

  return [...simplified, simplified[0]];
}

function simplifyLine(line, minPointSpacingMeters) {
  if (minPointSpacingMeters <= 0 || line.length <= 2) {
    return line;
  }

  const simplified = [line[0]];

  for (let index = 1; index < line.length - 1; index += 1) {
    const point = line[index];
    const previous = simplified[simplified.length - 1];

    if (distanceMeters(previous, point) >= minPointSpacingMeters) {
      simplified.push(point);
    }
  }

  simplified.push(line.at(-1));
  return dedupeAdjacentCoordinates(simplified);
}

function dedupeAdjacentCoordinates(coordinates) {
  const deduped = [];

  for (const coordinate of coordinates) {
    const previous = deduped[deduped.length - 1];

    if (previous && previous[0] === coordinate[0] && previous[1] === coordinate[1]) {
      continue;
    }

    deduped.push(coordinate);
  }

  return deduped;
}

function polygonAreaSquareMeters(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.reduce((total, polygon) => total + polygonArea(polygon), 0);
}

function polygonArea(rings) {
  if (rings.length === 0) {
    return 0;
  }

  const outerArea = ringAreaSquareMeters(rings[0]);
  const holeArea = rings.slice(1).reduce((total, ring) => total + ringAreaSquareMeters(ring), 0);
  return Math.max(0, outerArea - holeArea);
}

function ringAreaSquareMeters(ring) {
  if (ring.length < 4) {
    return 0;
  }

  const origin = ring[0];
  const projected = ring.map((coordinate) => projectToMeters(origin, coordinate));
  let area = 0;

  for (let index = 0; index < projected.length - 1; index += 1) {
    const [x1, y1] = projected[index];
    const [x2, y2] = projected[index + 1];
    area += x1 * y2 - x2 * y1;
  }

  return Math.abs(area) / 2;
}

function lineLengthMeters(geometry) {
  const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;

  return lines.reduce((total, line) => {
    let length = 0;
    for (let index = 1; index < line.length; index += 1) {
      length += distanceMeters(line[index - 1], line[index]);
    }
    return total + length;
  }, 0);
}

function projectToMeters(origin, coordinate) {
  const [originLon, originLat] = origin;
  const [lon, lat] = coordinate;
  const meanLat = ((originLat + lat) / 2) * (Math.PI / 180);
  const x = (lon - originLon) * 111_320 * Math.cos(meanLat);
  const y = (lat - originLat) * 111_320;
  return [x, y];
}

function distanceMeters(left, right) {
  const [x1, y1] = projectToMeters(left, left);
  const [x2, y2] = projectToMeters(left, right);
  return Math.hypot(x2 - x1, y2 - y1);
}

function isPolygonGeometry(type) {
  return type === 'Polygon' || type === 'MultiPolygon';
}

function normalizeValue(value) {
  return typeof value === 'string' ? value.trim() : '';
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
