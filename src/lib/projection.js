import { geoMercator } from 'd3-geo';
import { EARTH_RADIUS_METERS, METERS_PER_PIXEL } from '../config.js';

const DEG_TO_RAD = Math.PI / 180;

export function createLocalProjection(anchorPoint) {
  const [lon, lat] = anchorPoint;
  const rawProjection = geoMercator()
    .center([lon, lat])
    .translate([0, 0])
    .scale(EARTH_RADIUS_METERS / METERS_PER_PIXEL);

  const anchor = rawProjection([lon, lat]) ?? [0, 0];
  const xCorrection = Math.cos(lat * DEG_TO_RAD);

  return (coordinate) => {
    const projected = rawProjection(coordinate);

    if (!projected) {
      return null;
    }

    return [
      (projected[0] - anchor[0]) * xCorrection,
      projected[1] - anchor[1]
    ];
  };
}

export function projectFeatureCollection(featureCollection, anchorPoint) {
  const project = createLocalProjection(anchorPoint);

  return featureCollection.features.map((feature) => {
    const geometry = feature.geometry;
    const segments =
      geometry.type === 'MultiLineString'
        ? geometry.coordinates
        : [geometry.coordinates];

    return {
      ...feature.properties,
      paths: segments
        .map((segment) => segment.map(project).filter(Boolean))
        .filter((segment) => segment.length > 1)
    };
  });
}
