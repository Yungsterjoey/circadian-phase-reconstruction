/**
 * Keyboard accessibility — phase tool must be usable without a mouse.
 */
import { test, expect } from '@playwright/test';

test('phase tool is keyboard-navigable: Tab reaches each field in order, Enter submits', async ({ page }) => {
  await page.goto('/neuro');

  await page.getByTestId('input-sleep-onset').focus();
  await expect(page.getByTestId('input-sleep-onset')).toBeFocused();

  // <input type="time"> has internal HH/MM segments; walk forward until we reach
  // each expected control in sequence.
  const expected = ['input-wake-time', 'input-timezone', 'btn-compute-phase'];
  for (const target of expected) {
    let reached = false;
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      const tid = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      if (tid === target) { reached = true; break; }
    }
    expect(reached, `${target} reachable via Tab`).toBe(true);
  }

  // Compute button is focused; Enter (or Space) should submit.
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('phase-result')).toBeVisible({ timeout: 5000 });
  const text = await page.getByTestId('phase-result').innerText();
  expect(text).toMatch(/CT\s+\d+/);
});
