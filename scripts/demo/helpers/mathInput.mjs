import { typeDelays } from './timing.mjs';

async function fieldValue(field) {
  return field.evaluate((element) => element.value ?? '');
}

export async function replaceMathField(page, index, value, { minDelay = 55, maxDelay = 95 } = {}) {
  const field = page.locator('math-field').nth(index);
  await field.waitFor();
  const before = await fieldValue(field);
  await field.click();
  await field.press('Control+A');
  await field.press('Backspace');

  const delays = typeDelays(value, { min: minDelay, max: maxDelay });
  for (const [characterIndex, character] of Array.from(value).entries()) {
    await field.pressSequentially(character, { delay: delays[characterIndex] });
  }

  await page.waitForFunction(
    ({ fieldIndex, previousValue, expectedEmpty }) => {
      const element = globalThis.document.querySelectorAll('math-field')[fieldIndex];
      if (!element) return false;
      const currentValue = element.value ?? '';
      return expectedEmpty ? currentValue === '' : currentValue !== previousValue;
    },
    { fieldIndex: index, previousValue: before, expectedEmpty: value.length === 0 },
  );
}

export async function pressEnter(page, index) {
  const fields = page.locator('math-field');
  const countBefore = await fields.count();
  await fields.nth(index).press('Enter');
  await page.waitForFunction(
    (previousCount) => globalThis.document.querySelectorAll('math-field').length > previousCount,
    countBefore,
  );
}

export async function clickKeypadButton(page, label) {
  const button = page.getByRole('button', { name: label });
  await button.waitFor();
  await button.click();
}
