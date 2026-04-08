import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DISPLAY_PROFILES } from '../src/lib/display-profiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(repoRoot, 'public', 'data', 'city-manifest.json');

const manifest = JSON.parse(stripBom(await readFile(manifestPath, 'utf8')));

if (!Array.isArray(manifest) || manifest.length < 1) {
  throw new Error('Manifest must contain at least one city.');
}

for (const city of manifest) {
  assert(typeof city.slug === 'string', 'City slug must be a string.');
  assert(typeof city.name === 'string', 'City name must be a string.');
  assert(typeof city.region === 'string', 'City region must be a string.');
  assert(Array.isArray(city.centroid) && city.centroid.length === 2, 'City centroid must be a [lon, lat] tuple.');
  if (city.focusPoint !== undefined) {
    assert(Array.isArray(city.focusPoint) && city.focusPoint.length === 2, 'City focusPoint must be a [lon, lat] tuple.');
  }
  assert(Array.isArray(city.bounds) && city.bounds.length === 4, 'City bounds must be a [minLon, minLat, maxLon, maxLat] tuple.');
  assert(typeof city.lineCount === 'number' && city.lineCount > 0, 'City line count must be a positive number.');
  assert(city.display && typeof city.display === 'object', `${city.slug} must include display settings.`);
  assert(
    typeof city.display.profile === 'string' && city.display.profile in DISPLAY_PROFILES,
    `${city.slug} display.profile must be one of ${Object.keys(DISPLAY_PROFILES).join(', ')}.`
  );
  assert(
    typeof city.display.simplifyTolerance === 'number' && city.display.simplifyTolerance > 0,
    `${city.slug} display.simplifyTolerance must be a positive number.`
  );
  assert(
    typeof city.display.lineWidth === 'number' && city.display.lineWidth > 0,
    `${city.slug} display.lineWidth must be a positive number.`
  );
  const cityPath = path.join(repoRoot, 'public', city.dataPath);
  const geojson = JSON.parse(stripBom(await readFile(cityPath, 'utf8')));

  assert(geojson.type === 'FeatureCollection', `${city.slug} must be a FeatureCollection.`);
  assert(Array.isArray(geojson.features) && geojson.features.length === city.lineCount, `${city.slug} line count must match manifest.`);

  for (const feature of geojson.features) {
    assert(feature.type === 'Feature', `${city.slug} contains a non-Feature entry.`);
    assert(feature.geometry?.type === 'LineString' || feature.geometry?.type === 'MultiLineString', `${city.slug} must only contain line geometries.`);
    assert(Array.isArray(feature.geometry?.coordinates), `${city.slug} features must have coordinates.`);
  }
}

console.log(`Validated ${manifest.length} cities in city-manifest.json`);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function stripBom(content) {
  return content.replace(/^\uFEFF/, '');
}
