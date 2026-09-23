import { manifestFor } from '../scenarioManifest.mjs';

const manifest = manifestFor('transforms');

export default {
  ...manifest,
  description: 'time-domain signal, numerical Fourier spectrum and parameter-linked views',
  async run({ page, pause, replaceMathField, pressEnter, moveHumanLike }) {
    const fields = page.locator('math-field');
    await fields.nth(1).waitFor();

    await replaceMathField(page, 0, 'f(t)=exp(-t^2)');
    await pressEnter(page, 0);
    await replaceMathField(page, 1, 'F(ω)=');

    await page.getByRole('button', { name: 'Show the mathematical keypad' }).click();
    await page.getByRole('tab', { name: 'func' }).click();
    await fields.nth(1).click();
    await page.getByRole('button', { name: 'A numerical Fourier transform' }).click();
    await fields.nth(1).pressSequentially('f(t)', { delay: 75 });

    const frequency = page.locator('section[aria-label="Frequency domain view"]');
    await frequency.waitFor();
    const frequencyCanvas = frequency.locator('canvas[role="img"]');
    await frequencyCanvas.waitFor();
    await frequency.locator('.legend__range').filter({ hasText: 'finite t-window' }).waitFor();
    await pause(page, 1000);

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
    await page.locator('.readout:not(.readout--idle)').waitFor();
    await pause(page, 900);

    await frequency.locator('select').selectOption('phase');
    await pause(page, 900);

    await pressEnter(page, 1);
    await replaceMathField(page, 2, 'a=1');
    await replaceMathField(page, 0, 'f(t)=exp(-a*t^2)');

    const slider = page.locator('.expr-row__parameters input[type="range"]');
    await slider.waitFor();
    const sliderBounds = await slider.boundingBox();
    if (sliderBounds === null) throw new Error('Fourier parameter slider has no visible bounds.');
    const min = Number(await slider.getAttribute('min'));
    const max = Number(await slider.getAttribute('max'));
    const current = Number(await slider.inputValue());
    // Keep the drag inside the initial slider range. The product deliberately
    // expands a range when a value leaves it; staying inside that range keeps
    // the thumb visually stable while the recording shows a real drag.
    const target = 1.35;
    const xFor = (value) => sliderBounds.x + ((value - min) / (max - min)) * sliderBounds.width;
    let pointer = { x: xFor(current), y: sliderBounds.y + sliderBounds.height / 2 };
    await page.mouse.move(pointer.x, pointer.y);
    await page.mouse.down();
    for (let step = 1; step <= 1; step += 1) {
      const value = current + ((target - current) * step) / 1;
      const next = { x: xFor(value), y: pointer.y };
      await moveHumanLike(page, pointer, next, { steps: 1, durationMs: 600 });
      pointer = next;
    }
    await page.mouse.up();
    await frequency.locator('select').selectOption('magnitude');
    await pause(page, 2100);
  },
};
