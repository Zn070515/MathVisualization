import { manifestFor } from '../scenarioManifest.mjs';

const manifest = manifestFor('transforms');
const SLIDER_DRAG_STEPS = 18;

export default {
  ...manifest,
  description: 'sampled time-domain signal, DFT/FFT spectrum and origin-aware aliasing readout',
  async run({ page, pause, replaceMathField, pressEnter, moveHumanLike }) {
    const fields = page.locator('math-field');
    await fields.nth(1).waitFor();

    await replaceMathField(page, 0, 'f(t)=cos(15*t)');
    await pressEnter(page, 0);
    await replaceMathField(page, 1, 'D(ω)=');

    await page.getByRole('button', { name: 'Show the mathematical keypad' }).click();
    await page.getByRole('tab', { name: 'func' }).click();
    await fields.nth(1).click();
    await page.getByRole('button', { name: 'A numerical discrete Fourier transform' }).click();
    await fields.nth(1).pressSequentially('f(t)', { delay: 75 });

    const frequency = page.locator('section[aria-label="DFT spectrum view"]');
    await frequency.waitFor();
    const frequencyCanvas = frequency.locator('canvas[role="img"]');
    await frequencyCanvas.waitFor();
    await frequency.locator('.legend__range').filter({ hasText: 'Nyquist' }).waitFor();
    await pause(page, 1200);

    await frequency.locator('select[aria-label="DFT sample count"]').selectOption('32');
    await pause(page, 900);
    await frequency.locator('select[aria-label="DFT algorithm"]').selectOption('fft');
    await pause(page, 1200);

    const frequencyBounds = await frequencyCanvas.boundingBox();
    if (frequencyBounds === null) throw new Error('Frequency-domain canvas has no visible bounds.');
    await moveHumanLike(
      page,
      {
        x: frequencyBounds.x + frequencyBounds.width * 0.2,
        y: frequencyBounds.y + frequencyBounds.height * 0.55,
      },
      {
        x: frequencyBounds.x + frequencyBounds.width * 0.5,
        y: frequencyBounds.y + frequencyBounds.height * 0.42,
      },
      { steps: 24, durationMs: 700 },
    );
    await page.getByText(/index-domain aliases:/).waitFor();
    await page.getByText(/phase per \+Ωs/).waitFor();
    await pause(page, 1200);

    await frequency.locator('header select').selectOption('phase');
    await pause(page, 1000);

    await pressEnter(page, 1);
    await replaceMathField(page, 2, 'a=15');
    await replaceMathField(page, 0, 'f(t)=cos(a*t)');

    const slider = page.locator('.expr-row__parameters input[type="range"]');
    await slider.waitFor();
    const sliderBounds = await slider.boundingBox();
    if (sliderBounds === null) throw new Error('Fourier parameter slider has no visible bounds.');
    const current = Number(await slider.inputValue());
    // Keep the drag inside the initial slider range. The product deliberately
    // expands a range when a value leaves it; staying inside that range keeps
    // the thumb visually stable while the recording shows a real drag.
    const target = 10;
    const initialMin = Number(await slider.getAttribute('min'));
    const initialMax = Number(await slider.getAttribute('max'));
    const xFor = (value, bounds, min, max) =>
      bounds.x + ((value - min) / (max - min)) * bounds.width;
    let pointer = {
      x: xFor(current, sliderBounds, initialMin, initialMax),
      y: sliderBounds.y + sliderBounds.height / 2,
    };
    await page.mouse.move(pointer.x, pointer.y);
    await page.mouse.down();
    for (let step = 1; step <= SLIDER_DRAG_STEPS; step += 1) {
      const value = current + ((target - current) * step) / SLIDER_DRAG_STEPS;
      const liveBounds = await slider.boundingBox();
      if (liveBounds === null) throw new Error('Fourier parameter slider left the page.');
      const liveMin = Number(await slider.getAttribute('min'));
      const liveMax = Number(await slider.getAttribute('max'));
      const next = {
        x: xFor(value, liveBounds, liveMin, liveMax),
        y: liveBounds.y + liveBounds.height / 2,
      };
      await moveHumanLike(page, pointer, next, {
        steps: 1,
        durationMs: 600 / SLIDER_DRAG_STEPS,
      });
      pointer = next;
    }
    await page.mouse.up();
    await frequency.locator('header select').selectOption('magnitude');
    await pause(page, 1800);
  },
};
