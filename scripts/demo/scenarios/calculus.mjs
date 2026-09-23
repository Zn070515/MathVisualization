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
    const sliderY = sliderBounds.y + sliderBounds.height / 2;
    const xFor = (value, bounds, lower, upper) =>
      bounds.x + ((value - lower) / (upper - lower)) * bounds.width;
    let pointer = {
      x: xFor(current, sliderBounds, min, max),
      y: sliderY,
    };
    await page.mouse.move(pointer.x, pointer.y);
    await page.mouse.down();
    for (let step = 1; step <= 20; step += 1) {
      const desired = current + ((target - current) * step) / 20;
      const currentBounds = await slider.boundingBox();
      if (currentBounds === null) throw new Error('Parameter slider disappeared while dragging.');
      const lower = Number(await slider.getAttribute('min'));
      const upper = Number(await slider.getAttribute('max'));
      const next = {
        x: xFor(desired, currentBounds, lower, upper),
        y: currentBounds.y + currentBounds.height / 2,
      };
      await moveHumanLike(page, pointer, next, {
        steps: 1,
        durationMs: 650 / 20,
      });
      pointer = next;
    }
    await page.mouse.up();
    const exactValue = page.getByRole('textbox', { name: 'Exact value of a' });
    await exactValue.click();
    await exactValue.press('Control+A');
    await exactValue.pressSequentially('1.8', { delay: 75 });
    await exactValue.press('Enter');
    await page.waitForFunction(
      () =>
        globalThis.document.querySelector('input[aria-label="Exact value of a"]')?.value === '1.8',
    );
    await pause(page, 2400);
  },
};
