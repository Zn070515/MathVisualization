export function typeDelays(text, { min = 55, max = 95 } = {}) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) {
    throw new RangeError('Typing delay bounds must satisfy 0 <= min <= max.');
  }

  if (text.length === 0) return [];
  if (text.length === 1) return [Math.round(min)];

  return Array.from({ length: text.length }, (_, index) =>
    Math.round(min + ((max - min) * index) / (text.length - 1)),
  );
}

export function pause(page, milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new RangeError('Pause duration must be a non-negative number.');
  }
  return page.waitForTimeout(milliseconds);
}
