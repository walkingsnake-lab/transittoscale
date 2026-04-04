export function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function invLerp(value, start, end) {
  if (end === start) {
    return 1;
  }

  return clamp((value - start) / (end - start));
}

export function mix(start, end, amount) {
  return start + (end - start) * amount;
}

export function damp(current, target, smoothing, deltaSeconds) {
  const amount = 1 - Math.exp(-smoothing * deltaSeconds);
  return mix(current, target, amount);
}

export function nearlyEqual(a, b, epsilon = 0.001) {
  return Math.abs(a - b) <= epsilon;
}

export function distance(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return Math.hypot(dx, dy);
}

