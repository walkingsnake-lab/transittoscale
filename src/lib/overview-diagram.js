import {
  CARD_STYLE,
  REFERENCE_RADIUS_PIXELS,
  getCityTheme
} from '../config.js';
import { OVERVIEW_BASE_HEIGHT, OVERVIEW_BASE_WIDTH, OVERVIEW_SAFE_INSET } from './overview-config.js';
import { projectFeatureCollection } from './projection.js';

const SEGMENT_SNAP_PRECISION = 0.1;
const MIN_SEGMENT_DUPLICATE_SHARE = 0.15;
const OVERVIEW_SCALE_BIAS = 1.08;
const OVERVIEW_CIRCLE_ALPHA = 0.24;
const OVERVIEW_LABEL_ALPHA = 0.22;
const REFERENCE_LABEL_PADDING = 26;
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
  safeInset = OVERVIEW_SAFE_INSET,
  includeReferenceMarker = true,
  layout = null
}) {
  const resolvedLayout =
    layout ??
    getOverviewDiagramLayout({
      city,
      minWidth: width,
      minHeight: height,
      diagramScale,
      planePadding: safeInset
    });
  const {
    width: layoutWidth,
    height: layoutHeight,
    paths: displayPaths,
    referenceCenterX,
    referenceCenterY,
    referenceRadius,
    referenceLabelRadius
  } = resolvedLayout;
  const lineMarkup = displayPaths
    .map((path) => `<path d="${toSvgPathData(path)}" />`)
    .join('');
  let referenceMarkerMarkup = '';

  if (includeReferenceMarker) {
    const arcId = `${idPrefix}-arc`;
    const [arcStartX, arcStartY] = polarToCartesian(referenceCenterX, referenceCenterY, referenceLabelRadius, ARC_LABEL_START_ANGLE);
    const [arcEndX, arcEndY] = polarToCartesian(referenceCenterX, referenceCenterY, referenceLabelRadius, ARC_LABEL_END_ANGLE);
    const arcSweepFlag = ARC_LABEL_END_ANGLE - ARC_LABEL_START_ANGLE <= Math.PI ? 0 : 1;

    referenceMarkerMarkup = `
    <defs>
      <path id="${arcId}" d="M ${formatNumber(arcStartX)} ${formatNumber(arcStartY)} A ${formatNumber(referenceLabelRadius)} ${formatNumber(referenceLabelRadius)} 0 ${arcSweepFlag} 1 ${formatNumber(arcEndX)} ${formatNumber(arcEndY)}" />
    </defs>
    <circle
      cx="${formatNumber(referenceCenterX)}"
      cy="${formatNumber(referenceCenterY)}"
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
    </text>`;
  }

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layoutWidth} ${layoutHeight}" width="${layoutWidth}" height="${layoutHeight}" fill="none">
  <g shape-rendering="geometricPrecision" text-rendering="geometricPrecision">
    ${referenceMarkerMarkup}
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

export function getOverviewDiagramLayout({
  city,
  minWidth = OVERVIEW_BASE_WIDTH,
  minHeight = OVERVIEW_BASE_HEIGHT,
  diagramScale = 1,
  planePadding = OVERVIEW_SAFE_INSET
}) {
  const targetScale = diagramScale * OVERVIEW_SCALE_BIAS;
  const { paths: localPaths } = getOverviewDisplayPaths({
    city,
    diagramScale: targetScale
  });
  const referenceRadius = REFERENCE_RADIUS_PIXELS * targetScale;
  const bounds = getPathBounds(localPaths);
  const halfWidth = Math.max(
    referenceRadius + REFERENCE_LABEL_PADDING,
    bounds ? Math.max(Math.abs(bounds.minX), Math.abs(bounds.maxX)) : 0
  );
  const halfHeight = Math.max(
    referenceRadius + REFERENCE_LABEL_PADDING,
    bounds ? Math.max(Math.abs(bounds.minY), Math.abs(bounds.maxY)) : 0
  );
  const width = Math.max(minWidth, Math.ceil(halfWidth * 2 + planePadding * 2));
  const height = Math.max(minHeight, Math.ceil(halfHeight * 2 + planePadding * 2));
  const referenceCenterX = width / 2;
  const referenceCenterY = height / 2;
  const paths = localPaths.map((path) => translatePath(path, referenceCenterX, referenceCenterY));

  return {
    width,
    height,
    paths,
    referenceCenterX,
    referenceCenterY,
    referenceRadius,
    referenceLabelRadius: referenceRadius + 10
  };
}

export function getOverviewDisplayPaths({
  city,
  diagramScale = 1
}) {
  const featureCollection = city.featureCollection ?? city.geojson;

  if (!featureCollection) {
    return {
      paths: [],
      referenceCenterX: 0,
      referenceCenterY: 0
    };
  }

  const anchorPoint = city.focusPoint ?? city.centroid;
  const projectedFeatures = projectFeatureCollection(featureCollection, anchorPoint);
  const projectedPaths = projectedFeatures.flatMap((feature) =>
    feature.paths
      .filter((path) => path.length > 1)
  );
  const { mergedPaths, duplicateShare } = mergeOverlappingPaths(projectedPaths);
  let displayPaths = duplicateShare >= MIN_SEGMENT_DUPLICATE_SHARE ? mergedPaths : projectedPaths;

  if (Math.abs(diagramScale - 1) > 0.001) {
    displayPaths = displayPaths.map((path) => scalePathAroundPoint(path, 0, 0, diagramScale));
  }

  return {
    paths: displayPaths,
    referenceCenterX: 0,
    referenceCenterY: 0
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

function translatePath(path, offsetX, offsetY) {
  return path.map(([x, y]) => [x + offsetX, y + offsetY]);
}

function getPathBounds(paths) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const path of paths) {
    for (const [x, y] of path) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (!Number.isFinite(minX)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
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
