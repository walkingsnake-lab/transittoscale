import { distance } from './math.js';

export function clearHiDpiCanvas(canvas, ctx, width, height, dpr) {
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function buildPathMetrics(points) {
  const segments = [];
  let totalLength = 0;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = distance(start, end);

    segments.push({ start, end, length });
    totalLength += length;
  }

  return {
    points,
    segments,
    totalLength
  };
}

export function simplifyPath(points, tolerance = 0.5) {
  if (!Array.isArray(points) || points.length < 3 || tolerance <= 0) {
    return points;
  }

  const sqTolerance = tolerance * tolerance;
  const reducedPoints = simplifyRadialDistance(points, sqTolerance);

  if (reducedPoints.length < 3) {
    return reducedPoints;
  }

  return simplifyDouglasPeucker(reducedPoints, sqTolerance);
}

export function drawProgressPath(ctx, metrics, progress) {
  if (!metrics || metrics.points.length < 2 || progress <= 0) {
    return;
  }

  if (progress >= 0.999) {
    ctx.beginPath();
    ctx.moveTo(metrics.points[0][0], metrics.points[0][1]);

    for (let index = 1; index < metrics.points.length; index += 1) {
      ctx.lineTo(metrics.points[index][0], metrics.points[index][1]);
    }

    ctx.stroke();
    return;
  }

  const targetLength = metrics.totalLength * progress;
  let traversed = 0;

  ctx.beginPath();
  ctx.moveTo(metrics.points[0][0], metrics.points[0][1]);

  for (const segment of metrics.segments) {
    if (segment.length === 0) {
      continue;
    }

    const nextLength = traversed + segment.length;

    if (targetLength >= nextLength) {
      ctx.lineTo(segment.end[0], segment.end[1]);
      traversed = nextLength;
      continue;
    }

    const ratio = (targetLength - traversed) / segment.length;
    const x = segment.start[0] + (segment.end[0] - segment.start[0]) * ratio;
    const y = segment.start[1] + (segment.end[1] - segment.start[1]) * ratio;
    ctx.lineTo(x, y);
    break;
  }

  ctx.stroke();
}

export function strokeCircleProgress(ctx, x, y, radius, progress) {
  if (progress <= 0) {
    return;
  }

  const endAngle = -Math.PI / 2 + Math.PI * 2 * progress;
  ctx.beginPath();
  ctx.arc(x, y, radius, -Math.PI / 2, endAngle);
  ctx.stroke();
}

function simplifyRadialDistance(points, sqTolerance) {
  const simplified = [points[0]];
  let previousPoint = points[0];

  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];

    if (squaredDistance(point, previousPoint) > sqTolerance) {
      simplified.push(point);
      previousPoint = point;
    }
  }

  const lastPoint = points[points.length - 1];

  if (simplified[simplified.length - 1] !== lastPoint) {
    simplified.push(lastPoint);
  }

  return simplified;
}

function simplifyDouglasPeucker(points, sqTolerance) {
  const markers = new Uint8Array(points.length);
  const lastIndex = points.length - 1;
  const stack = [[0, lastIndex]];

  markers[0] = 1;
  markers[lastIndex] = 1;

  while (stack.length > 0) {
    const [firstIndex, endIndex] = stack.pop();
    let maxDistance = 0;
    let farthestIndex = 0;

    for (let index = firstIndex + 1; index < endIndex; index += 1) {
      const distanceToSegment = squaredSegmentDistance(points[index], points[firstIndex], points[endIndex]);

      if (distanceToSegment > maxDistance) {
        maxDistance = distanceToSegment;
        farthestIndex = index;
      }
    }

    if (maxDistance > sqTolerance) {
      markers[farthestIndex] = 1;
      stack.push([firstIndex, farthestIndex], [farthestIndex, endIndex]);
    }
  }

  const simplified = [];

  for (let index = 0; index < points.length; index += 1) {
    if (markers[index]) {
      simplified.push(points[index]);
    }
  }

  return simplified;
}

function squaredDistance(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return dx * dx + dy * dy;
}

function squaredSegmentDistance(point, start, end) {
  let x = start[0];
  let y = start[1];
  let dx = end[0] - x;
  let dy = end[1] - y;

  if (dx !== 0 || dy !== 0) {
    const projection = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);

    if (projection > 1) {
      x = end[0];
      y = end[1];
    } else if (projection > 0) {
      x += dx * projection;
      y += dy * projection;
    }
  }

  dx = point[0] - x;
  dy = point[1] - y;

  return dx * dx + dy * dy;
}
