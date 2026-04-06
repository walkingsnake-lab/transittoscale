import {
  CARD_STYLE,
  HEADER_OFFSET,
  REFERENCE_RADIUS_PIXELS,
  getCityTheme
} from '../config.js';
import { OVERVIEW_BASE_HEIGHT, OVERVIEW_BASE_WIDTH, OVERVIEW_SAFE_INSET } from './overview-config.js';
import { projectFeatureCollection } from './projection.js';

const SEGMENT_SNAP_PRECISION = 0.1;
const MIN_SEGMENT_DUPLICATE_SHARE = 0.15;
const OVERVIEW_FRAME_PADDING = 8;
const OVERVIEW_SCALE_BIAS = 1.08;
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
  idPrefix = 'overview',
  safeInset = OVERVIEW_SAFE_INSET
}) {
  const targetScale = diagramScale * OVERVIEW_SCALE_BIAS;
  const { paths: displayPaths, appliedScale } = getOverviewDisplayPaths({
    city,
    width,
    height,
    diagramScale: targetScale,
    safeInset
  });
  const circleCenterX = width / 2;
  const circleCenterY = height / 2;
  const referenceRadius = REFERENCE_RADIUS_PIXELS * appliedScale;
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

export function getOverviewDisplayPaths({
  city,
  width = OVERVIEW_BASE_WIDTH,
  height = OVERVIEW_BASE_HEIGHT,
  diagramScale = 1,
  safeInset = OVERVIEW_SAFE_INSET
}) {
  const featureCollection = city.featureCollection ?? city.geojson;

  if (!featureCollection) {
    return {
      paths: [],
      appliedScale: diagramScale
    };
  }

  const frameWidth = width - OVERVIEW_FRAME_PADDING * 2;
  const frameHeight = height - OVERVIEW_FRAME_PADDING * 2 - HEADER_OFFSET;
  const centerX = OVERVIEW_FRAME_PADDING + frameWidth / 2;
  const centerY = OVERVIEW_FRAME_PADDING + HEADER_OFFSET + frameHeight / 2;
  const anchorPoint = city.focusPoint ?? city.centroid;
  const projectedFeatures = projectFeatureCollection(featureCollection, anchorPoint);
  const projectedPaths = projectedFeatures.flatMap((feature) =>
    feature.paths
      .map((path) => path.map(([x, y]) => [centerX + x, centerY + y]))
      .filter((path) => path.length > 1)
  );
  const { mergedPaths, duplicateShare } = mergeOverlappingPaths(projectedPaths);
  let displayPaths = duplicateShare >= MIN_SEGMENT_DUPLICATE_SHARE ? mergedPaths : projectedPaths;
  const appliedScale = clampPathScaleToFrame(
    displayPaths,
    centerX,
    centerY,
    diagramScale,
    safeInset,
    width - safeInset,
    safeInset,
    height - safeInset
  );

  if (Math.abs(appliedScale - 1) > 0.001) {
    displayPaths = displayPaths.map((path) => scalePathAroundPoint(path, centerX, centerY, appliedScale));
  }

  return {
    paths: displayPaths,
    appliedScale
  };
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

function scalePathAroundPoint(path, centerX, centerY, scale) {
  return path.map(([x, y]) => [
    centerX + (x - centerX) * scale,
    centerY + (y - centerY) * scale
  ]);
}

function clampPathScaleToFrame(paths, centerX, centerY, targetScale, minX, maxX, minY, maxY) {
  let maxAllowedScale = Number.POSITIVE_INFINITY;

  for (const path of paths) {
    for (const [x, y] of path) {
      const dx = x - centerX;
      const dy = y - centerY;

      if (dx > 0) {
        maxAllowedScale = Math.min(maxAllowedScale, (maxX - centerX) / dx);
      } else if (dx < 0) {
        maxAllowedScale = Math.min(maxAllowedScale, (minX - centerX) / dx);
      }

      if (dy > 0) {
        maxAllowedScale = Math.min(maxAllowedScale, (maxY - centerY) / dy);
      } else if (dy < 0) {
        maxAllowedScale = Math.min(maxAllowedScale, (minY - centerY) / dy);
      }
    }
  }

  if (!Number.isFinite(maxAllowedScale) || maxAllowedScale <= 0) {
    return targetScale;
  }

  return Math.min(targetScale, maxAllowedScale);
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
