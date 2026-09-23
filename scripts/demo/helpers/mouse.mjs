export function humanPoints(from, to, steps) {
  if (!Number.isInteger(steps) || steps < 1) {
    throw new RangeError('Pointer movement steps must be a positive integer.');
  }

  return Array.from({ length: steps + 1 }, (_, index) => {
    const progress = index / steps;
    return {
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress,
    };
  });
}

export async function moveHumanLike(page, from, to, { steps = 20, durationMs = 500 } = {}) {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new RangeError('Pointer movement duration must be non-negative.');
  }

  const points = humanPoints(from, to, steps);
  const perStep = durationMs / steps;
  for (const point of points) {
    await page.mouse.move(point.x, point.y);
    if (perStep > 0) await page.waitForTimeout(perStep);
  }
}
