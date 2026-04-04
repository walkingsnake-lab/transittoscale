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

