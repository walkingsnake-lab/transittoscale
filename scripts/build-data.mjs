import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const rawDataPath = path.join(repoRoot, 'data', 'raw', 'city-seeds.json');
const normalizedDataPath = path.join(repoRoot, 'data', 'normalized', 'cities.json');
const publicDataDir = path.join(repoRoot, 'public', 'data');
const cityDir = path.join(publicDataDir, 'cities');

const raw = JSON.parse(await readFile(rawDataPath, 'utf8'));
const normalized = await readNormalizedCities();

await rm(cityDir, { recursive: true, force: true });
await mkdir(cityDir, { recursive: true });

const manifest =
  normalized.size > 0
    ? [...normalized.values()]
    : raw.map((city) => {
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
      });

for (const city of manifest) {
  const cityPath = path.join(cityDir, `${city.slug}.geojson`);
  await writeFile(cityPath, JSON.stringify(city.featureCollection, null, 2));
}

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
