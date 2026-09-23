import { manifestFor } from '../scenarioManifest.mjs';

const manifest = manifestFor('complex');

export default {
  ...manifest,
  description: 'poles, contour integration and accumulated integral trajectory',
  async run({ page, pause, replaceMathField, pressEnter, moveHumanLike }) {
    const fields = page.locator('math-field');
    await fields.nth(1).waitFor();

    await replaceMathField(page, 0, 'f(z)=1/(z^2+1)');
    await replaceMathField(page, 1, '');

    const plane = page.locator('section[aria-label="Complex plane view"]');
    await plane.waitFor();
    await plane.locator('canvas[role="img"]').waitFor();
    await plane.locator('.legend__range').filter({ hasText: '○ 2 poles' }).waitFor();
    await pause(page, 700);

    const canvas = plane.locator('canvas[role="img"]');
    const bounds = await canvas.boundingBox();
    if (bounds === null) throw new Error('Complex plane canvas has no visible bounds.');

    // The clean context uses the application default viewport: centre (0, 0), half-width 2.4.
    // Deriving this point from the canvas bounds makes the hover independent of a screenshot.
    const halfHeight = 2.4 * (bounds.height / bounds.width);
    const pole = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height * (1 - (1 + halfHeight) / (2 * halfHeight)),
    };
    await moveHumanLike(
      page,
      { x: bounds.x + bounds.width * 0.18, y: bounds.y + bounds.height * 0.78 },
      pole,
      { steps: 24, durationMs: 700 },
    );
    await page.locator('.readout:not(.readout--idle)').waitFor();
    await pause(page, 1000);

    await pressEnter(page, 0);
    await replaceMathField(page, 1, 'gamma(t)=2e^(it)');
    await pressEnter(page, 1);
    await pause(page, 700);

    const contourField = fields.nth(2);
    await page.getByRole('button', { name: 'Show the mathematical keypad' }).click();
    await page.getByRole('tab', { name: 'func' }).click();
    await contourField.click();
    await page.getByRole('button', { name: 'A contour integral around a path' }).click();
    await contourField.pressSequentially('gamma', { delay: 70 });
    await contourField.press('Tab');
    await contourField.pressSequentially('f(z)', { delay: 70 });
    await contourField.press('Tab');
    await contourField.pressSequentially('z', { delay: 70 });

    await page.locator('.legend__range').filter({ hasText: 'the integral so far' }).waitFor();
    const valueLine = page.locator('.expr-row__value').last();
    await valueLine.waitFor();
    await page.waitForFunction(() => {
      const line = globalThis.document.querySelector('.expr-row__value:last-of-type');
      return line?.textContent?.includes('over') === true;
    });
    await pause(page, 2200);
  },
};
