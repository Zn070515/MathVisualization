import { manifestFor } from '../scenarioManifest.mjs';

const manifest = manifestFor('calculus');

export default {
  ...manifest,
  description: 'Cartesian 3D surface, hover readout and parameter slider',
  async run({ page, pause, replaceMathField, pressEnter, moveHumanLike }) {
    const fields = page.locator('math-field');
    await fields.nth(1).waitFor();

    await replaceMathField(page, 0, 'f(x,y)=x^2-a*y^2');
    await pressEnter(page, 0);
    await replaceMathField(page, 1, 'a=1');

    const surface = page.locator('section[aria-label="3D surface view"]');
    await surface.waitFor();
    const surfaceCanvas = surface.locator('canvas[role="img"]');
    await surfaceCanvas.waitFor();
    const slider = page.locator('.expr-row__parameters input[type="range"]');
    await slider.waitFor();
    await pause(page, 900);

    const surfaceBounds = await surfaceCanvas.boundingBox();
    if (surfaceBounds === null) throw new Error('3D surface canvas has no visible bounds.');
    const orbitFrom = {
      x: surfaceBounds.x + surfaceBounds.width * 0.52,
      y: surfaceBounds.y + surfaceBounds.height * 0.48,
    };
    const orbitTo = { x: orbitFrom.x + 80, y: orbitFrom.y + 30 };
    await page.mouse.move(orbitFrom.x, orbitFrom.y);
    await page.mouse.down();
    await moveHumanLike(page, orbitFrom, orbitTo, { steps: 24, durationMs: 700 });
    await page.mouse.up();
    await pause(page, 800);

    await moveHumanLike(
      page,
      { x: orbitTo.x, y: orbitTo.y },
      {
        x: surfaceBounds.x + surfaceBounds.width * 0.5,
        y: surfaceBounds.y + surfaceBounds.height * 0.5,
      },
      { steps: 18, durationMs: 550 },
    );
    await page.locator('.readout:not(.readout--idle)').waitFor();
    await pause(page, 1000);
    await pause(page, 800);

    const sliderBounds = await slider.boundingBox();
    if (sliderBounds === null) throw new Error('Parameter slider has no visible bounds.');
    const min = Number(await slider.getAttribute('min'));
    const max = Number(await slider.getAttribute('max'));
    const current = Number(await slider.inputValue());
    const target = 1.8;
    const xFor = (value) => sliderBounds.x + ((value - min) / (max - min)) * sliderBounds.width;
    const sliderY = sliderBounds.y + sliderBounds.height / 2;
    const from = { x: xFor(current), y: sliderY };
    const to = { x: xFor(target), y: sliderY };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await moveHumanLike(page, from, to, { steps: 20, durationMs: 650 });
    await page.mouse.up();
    await pause(page, 2400);
  },
};
