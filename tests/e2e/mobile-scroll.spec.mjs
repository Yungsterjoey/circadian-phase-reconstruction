/**
 * Mobile scroll + DesktopBackground regression guard.
 * Reproduces the iPhone Safari issue where OS-shell scroll-lock
 * (html/body/#root { position:fixed; overflow:hidden } in index.html)
 * leaked onto the marketing pages.
 */
import { test, expect, devices } from '@playwright/test';

test.use({ ...devices['iPhone 13'] });

test('HomePage mounts DesktopBackground and scrolls on iPhone viewport', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.desktop-bg')).toHaveCount(1);

  // Scroll lock released: html should NOT be position:fixed.
  const htmlPosition = await page.evaluate(() =>
    getComputedStyle(document.documentElement).position
  );
  expect(htmlPosition).not.toBe('fixed');

  const hasScrollClass = await page.evaluate(() =>
    document.documentElement.classList.contains('kg-scroll-page')
  );
  expect(hasScrollClass).toBe(true);

  // Content extends past viewport: footer must be reachable via scroll.
  const footer = page.getByText('© 2026 KURO Technologies');
  await footer.scrollIntoViewIfNeeded();
  await expect(footer).toBeVisible();
});

test('NeuroPage also scrolls on iPhone viewport', async ({ page }) => {
  await page.goto('/neuro');
  await expect(page.locator('.desktop-bg')).toHaveCount(1);

  const htmlPosition = await page.evaluate(() =>
    getComputedStyle(document.documentElement).position
  );
  expect(htmlPosition).not.toBe('fixed');

  const bottomBanner = page.getByText('Decision support only. Not medical advice. Not a diagnostic device.');
  await bottomBanner.scrollIntoViewIfNeeded();
  await expect(bottomBanner).toBeVisible();
});

test('scroll-lock is restored when leaving kuroglass landing for /app', async ({ page }) => {
  await page.goto('/');
  await page.goto('/app'); // will redirect to /login
  const htmlPosition = await page.evaluate(() =>
    getComputedStyle(document.documentElement).position
  );
  // OS shell lock reinstated.
  expect(htmlPosition).toBe('fixed');
});
