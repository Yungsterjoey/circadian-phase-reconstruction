/**
 * Legal modal — all five descriptor panels open from footer, render as glass
 * panels, and close via ESC / backdrop / close button. Cookie panel writes
 * consent to localStorage.
 */
import { test, expect } from '@playwright/test';

const SECTIONS = [
  { label: 'Terms of Service',     title: 'Terms of Service' },
  { label: 'Privacy Policy',       title: 'Privacy Policy' },
  { label: 'Disclaimer',           title: 'Disclaimer' },
  { label: 'Acceptable Use',       title: 'Acceptable Use Policy' },
  { label: 'Cookie Settings',      title: 'Cookie Policy' },
];

// Seed consent so the CookieBanner doesn't auto-appear and intercept footer clicks
// during sequential full-suite runs. Tests that exercise consent-writing still work
// because they open the Cookie *modal* from the footer and overwrite consent there.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try {
      localStorage.setItem(
        'kuro_cookies',
        JSON.stringify({ level: 'essential', version: '1.0', timestamp: new Date(0).toISOString() })
      );
    } catch {}
  });
});

test.describe('Legal modals on HomePage', () => {
  for (const { label, title } of SECTIONS) {
    test(`footer "${label}" opens modal with title "${title}"`, async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: label }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('heading', { name: title, level: 2 })).toBeVisible();
    });
  }

  test('ESC key closes the modal', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Terms of Service' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('Close button dismisses the modal', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Privacy Policy' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.locator('.lgl-close').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('Backdrop click dismisses the modal', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Disclaimer' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    // Click well outside the panel (top-left corner of viewport).
    await page.mouse.down({ x: 5, y: 5 });
    await page.mouse.up({ x: 5, y: 5 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('Cookie panel "Essential Only" writes consent and closes', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Cookie Settings' }).click();
    await page.getByRole('button', { name: 'Essential Only' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const consent = await page.evaluate(() => JSON.parse(localStorage.getItem('kuro_cookies') || 'null'));
    expect(consent?.level).toBe('essential');
  });

  test('Cookie panel "Accept All" writes consent and closes', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Cookie Settings' }).click();
    await page.getByRole('button', { name: 'Accept All' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const consent = await page.evaluate(() => JSON.parse(localStorage.getItem('kuro_cookies') || 'null'));
    expect(consent?.level).toBe('all');
  });
});

test.describe('Legal modals on NeuroPage', () => {
  test('footer Legal col is present and Terms modal opens', async ({ page }) => {
    await page.goto('/neuro');
    await page.getByRole('button', { name: 'Terms of Service' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Terms of Service', level: 2 })).toBeVisible();
  });

  test('Disclaimer panel mentions NeuroKURO + decision support', async ({ page }) => {
    await page.goto('/neuro');
    await page.getByRole('button', { name: 'Disclaimer' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/decision support/i)).toBeVisible();
  });
});

test.describe('Legal modal aesthetics', () => {
  test('modal applies liquid-glass backdrop-filter and border radius', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Terms of Service' }).click();
    const panel = page.locator('.lgl-panel');
    await expect(panel).toBeVisible();
    const style = await panel.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        radius: cs.borderRadius,
        backdrop: cs.backdropFilter || cs.webkitBackdropFilter,
      };
    });
    expect(parseFloat(style.radius)).toBeGreaterThanOrEqual(18);
    expect(style.backdrop).toMatch(/blur/);
  });
});
