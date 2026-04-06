import {
  CARD_PADDING,
  CARD_STYLE,
  HEADER_OFFSET,
  REFERENCE_RADIUS_PIXELS,
  getCityTheme
} from '../config.js';
import { simplifyPath } from './canvas.js';
import { OVERVIEW_BASE_HEIGHT, OVERVIEW_BASE_WIDTH } from './overview-config.js';
import { projectFeatureCollection } from './projection.js';

const SEGMENT_SNAP_PRECISION = 0.1;
const MIN_SEGMENT_DUPLICATE_SHARE = 0.15;
const CORRIDOR_SIGNATURE_PRECISION = 1.25;
const CORRIDOR_LENGTH_PRECISION = 1.5;
const CORRIDOR_ENDPOINT_PRECISION = 0.45;
const CORRIDOR_ANGLE_BUCKETS = 18;
const MIN_CORRIDOR_COLLAPSE_SHARE = 0.12;
const OVERVIEW_CIRCLE_ALPHA = 0.24;
const OVERVIEW_LABEL_ALPHA = 0.22;
const ARC_LABEL_START_ANGLE = Math.PI + 0.08;
const ARC_LABEL_END_ANGLE = Math.PI * 1.5 - 0.08;
const ARC_LABEL_FONT_FAMILY = 'Arial, sans-serif';

export function createOverviewDiagramSvg({
  city,
  width = OVERVIEW_BASE_WIDTH,
  height = OVERVIEW_BASE_HEIGHT,
  diagramScale = 1,
  theme = getCityTheme(city.slug),
  idPrefix = 'overview'
}) {
  const displayPaths = getOverviewDisplayPaths(city, width, height, diagramScale);
  const circleCenterX = width / 2;
  const circleCenterY = height / 2;
  const referenceRadius = REFERENCE_RADIUS_PIXELS * diagramScale;
  const arcId = `${idPrefix}-arc`;
  const lineMarkup = displayPaths
    .map((path) => `<path d="${toSvgPathData(path)}" />`)
    .join('');
  const [arcStartX, arcStartY] = polarToCartesian(circleCenterX, circleCenterY, referenceRadius + 10, ARC_LABEL_START_ANGLE);
  const [arcEndX, arcEndY] = polarToCartesian(circleCenterX, circleCenterY, referenceRadius + 10, ARC_LABEL_END_ANGLE);
  const arcSweepFlag = ARC_LABEL_END_ANGLE - ARC_LABEL_START_ANGLE <= Math.PI ? 0 : 1;

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" fill="none">
  <defs>
    <path id="${arcId}" d="M ${formatNumber(arcStartX)} ${formatNumber(arcStartY)} A ${formatNumber(referenceRadius + 10)} ${formatNumber(referenceRadius + 10)} 0 ${arcSweepFlag} 1 ${formatNumber(arcEndX)} ${formatNumber(arcEndY)}" />
  </defs>
  <g shape-rendering="geometricPrecision" text-rendering="geometricPrecision">
    <circle
      cx="${formatNumber(circleCenterX)}"
      cy="${formatNumber(circleCenterY)}"
      r="${formatNumber(referenceRadius)}"
      fill="${theme.referenceFill}"
      fill-opacity="${OVERVIEW_CIRCLE_ALPHA}"
    />
    <text
      fill="${theme.referenceFill}"
      fill-opacity="${OVERVIEW_LABEL_ALPHA}"
      font-family="${ARC_LABEL_FONT_FAMILY}"
      font-size="15"
      font-weight="800"
      letter-spacing="0.9"
    >
      <textPath href="#${arcId}" startOffset="50%" text-anchor="middle">5 MILES</textPath>
    </text>
    <g
      stroke="${theme.ink}"
      stroke-opacity="${city.display.lineAlpha}"
      stroke-width="${CARD_STYLE.baseLineWidth}"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      ${lineMarkup}
    </g>
  </g>
</svg>`.trim();
}

export function getOverviewDisplayPaths(city, width = OVERVIEW_BASE_WIDTH, height = OVERVIEW_BASE_HEIGHT, diagramScale = 1) {
  const featureCollection = city.featureCollection ?? city.geojson;

  if (!featureCollection) {
    return [];
  }

  const frameWidth = width - CARD_PADDING * 2;
  const frameHeight = height - CARD_PADDING * 2 - HEADER_OFFSET;
  const centerX = CARD_PADDING + frameWidth / 2;
  const centerY = CARD_PADDING + HEADER_OFFSET + frameHeight / 2;
  const anchorPoint = city.focusPoint ?? city.centroid;
  const projectedFeatures = projectFeatureCollection(featureCollection, anchorPoint);
  const projectedPaths = projectedFeatures.flatMap((feature) =>
    feature.paths
      .map((path) => path.map(([x, y]) => [centerX + x, centerY + y]))
      .map((translatedPath) => simplifyPath(translatedPath, city.display.simplifyTolerance))
      .filter((path) => path.length > 1)
  );
  const { mergedPaths, duplicateShare } = mergeOverlappingPaths(projectedPaths);
  let displayPaths = duplicateShare >= MIN_SEGMENT_DUPLICATE_SHARE ? mergedPaths : projectedPaths;
  const shouldCollapseCorridors = city.display.profile !== 'standard' || city.lineCount >= 8;

  if (shouldCollapseCorridors) {
    const { collapsedPaths, collapseShare } = collapseNearbyCorridors(displayPaths);

    if (collapseShare >= MIN_CORRIDOR_COLLAPSE_SHARE) {
      displayPaths = collapsedPaths;
    }
  }

  if (Math.abs(diagramScale - 1) > 0.001) {
    displayPaths = displayPaths.map((path) => scalePathAroundPoint(path, centerX, centerY, diagramScale));
  }

  return displayPaths;
}

function mergeOverlappingPaths(paths, snapPrecision = SEGMENT_SNAP_PRECISION) {
  const pointByKey = new Map();
  const segmentByKey = new Map();
  const adjacency = new Map();
  let totalSegmentCount = 0;

  for (const path of paths) {
    for (let index = 1; index < path.length; index += 1) {
      totalSegmentCount += 1;
      const startPoint = path[index - 1];
      const endPoint = path[index];
      const startKey = getSnappedPointKey(startPoint, pointByKey, snapPrecision);
      const endKey = getSnappedPointKey(endPoint, pointByKey, snapPrecision);

      if (startKey === endKey) {
        continue;
      }

      const segmentKey = startKey < endKey ? `${startKey}|${endKey}` : `${endKey}|${startKey}`;

      if (segmentByKey.has(segmentKey)) {
        continue;
      }

      segmentByKey.set(segmentKey, { startKey, endKey });
      addAdjacency(adjacency, startKey, segmentKey);
      addAdjacency(adjacency, endKey, segmentKey);
    }
  }

  const unusedSegmentKeys = new Set(segmentByKey.keys());
  const mergedPaths = [];

  for (const [pointKey, connectedSegmentKeys] of adjacency.entries()) {
    if (connectedSegmentKeys.size === 2) {
      continue;
    }

    for (const segmentKey of connectedSegmentKeys) {
      if (!unusedSegmentKeys.has(segmentKey)) {
        continue;
      }

      mergedPaths.push(walkMergedPath(pointKey, segmentKey, unusedSegmentKeys, adjacency, segmentByKey, pointByKey));
    }
  }

  for (const segmentKey of [...unusedSegmentKeys]) {
    const segment = segmentByKey.get(segmentKey);
    mergedPaths.push(
      walkMergedPath(segment.startKey, segmentKey, unusedSegmentKeys, adjacency, segmentByKey, pointByKey)
    );
  }

  return {
    mergedPaths: mergedPaths.filter((path) => path.length > 1),
    duplicateShare: totalSegmentCount > 0 ? 1 - segmentByKey.size / totalSegmentCount : 0
  };
}

function collapseNearbyCorridors(paths) {
  const corridorGroups = new Map();
  let totalSegmentCount = 0;

  for (const path of paths) {
    for (let index = 1; index < path.length; index += 1) {
      let start = path[index - 1];
      let end = path[index];

      if (!start || !end) {
        continue;
      }

      if (end[0] < start[0] || (end[0] === start[0] && end[1] < start[1])) {
        [start, end] = [end, start];
      }

      const dx = end[0] - start[0];
      const dy = end[1] - start[1];
      const length = Math.hypot(dx, dy);

      if (length <= 0.01) {
        continue;
      }

      totalSegmentCount += 1;
      let angle = Math.atan2(dy, dx);

      if (angle < 0) {
        angle += Math.PI;
      }

      const signatureKey = [
        snapValue((start[0] + end[0]) / 2, CORRIDOR_SIGNATURE_PRECISION),
        snapValue((start[1] + end[1]) / 2, CORRIDOR_SIGNATURE_PRECISION),
        Math.round((angle / Math.PI) * CORRIDOR_ANGLE_BUCKETS),
        snapValue(length, CORRIDOR_LENGTH_PRECISION)
      ].join('|');
      const group = corridorGroups.get(signatureKey) ?? {
        count: 0,
        startX: 0,
        startY: 0,
        endX: 0,
        endY: 0
      };

      group.count += 1;
      group.startX += start[0];
      group.startY += start[1];
      group.endX += end[0];
      group.endY += end[1];
      corridorGroups.set(signatureKey, group);
    }
  }

  const collapsedSegmentPaths = [...corridorGroups.values()]
    .map((group) => {
      const start = [group.startX / group.count, group.startY / group.count];
      const end = [group.endX / group.count, group.endY / group.count];
      return [start, end];
    })
    .filter((path) => {
      const [start, end] = path;
      return Math.hypot(end[0] - start[0], end[1] - start[1]) > 0.01;
    });
  const { mergedPaths } = mergeOverlappingPaths(collapsedSegmentPaths, CORRIDOR_ENDPOINT_PRECISION);

  return {
    collapsedPaths: mergedPaths,
    collapseShare: totalSegmentCount > 0 ? 1 - corridorGroups.size / totalSegmentCount : 0
  };
}

function scalePathAroundPoint(path, centerX, centerY, scale) {
  return path.map(([x, y]) => [
    centerX + (x - centerX) * scale,
    centerY + (y - centerY) * scale
  ]);
}

function getSnappedPointKey(point, pointByKey, snapPrecision) {
  const snappedX = snapValue(point[0], snapPrecision);
  const snappedY = snapValue(point[1], snapPrecision);
  const pointKey = `${snappedX},${snappedY}`;

  if (!pointByKey.has(pointKey)) {
    pointByKey.set(pointKey, [snappedX, snappedY]);
  }

  return pointKey;
}

function addAdjacency(adjacency, pointKey, segmentKey) {
  const connectedSegmentKeys = adjacency.get(pointKey) ?? new Set();
  connectedSegmentKeys.add(segmentKey);
  adjacency.set(pointKey, connectedSegmentKeys);
}

function walkMergedPath(startPointKey, firstSegmentKey, unusedSegmentKeys, adjacency, segmentByKey, pointByKey) {
  const path = [pointByKey.get(startPointKey)];
  let currentPointKey = startPointKey;
  let currentSegmentKey = firstSegmentKey;

  while (currentSegmentKey) {
    unusedSegmentKeys.delete(currentSegmentKey);
    const segment = segmentByKey.get(currentSegmentKey);
    const nextPointKey = segment.startKey === currentPointKey ? segment.endKey : segment.startKey;

    path.push(pointByKey.get(nextPointKey));
    currentPointKey = nextPointKey;

    const nextSegmentKey = [...(adjacency.get(currentPointKey) ?? [])].find((segmentKey) =>
      unusedSegmentKeys.has(segmentKey)
    );

    if (!nextSegmentKey || (adjacency.get(currentPointKey)?.size ?? 0) !== 2) {
      break;
    }

    currentSegmentKey = nextSegmentKey;
  }

  return path;
}

function toSvgPathData(path) {
  const [start, ...rest] = path;
  return [`M ${formatNumber(start[0])} ${formatNumber(start[1])}`]
    .concat(rest.map(([x, y]) => `L ${formatNumber(x)} ${formatNumber(y)}`))
    .join(' ');
}

function polarToCartesian(centerX, centerY, radius, angle) {
  return [
    centerX + Math.cos(angle) * radius,
    centerY + Math.sin(angle) * radius
  ];
}

function formatNumber(value) {
  return Number(value.toFixed(2));
}

function snapValue(value, precision) {
  return Math.round(value / precision) * precision;
}
