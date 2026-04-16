/**
 * KURO relaunch E2E — three-tile front page, NeuroKURO phase tool, auth gate.
 * Run:  npx playwright test -c tests/e2e/playwright.config.mjs
 */
import { test, expect } from '@playwright/test';

test.describe('Front page (/)', () => {
  test('renders three tiles with correct copy and routes', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Sovereign infrastructure for the agentic era.', level: 1 })).toBeVisible();

    const tiles = page.locator('h3');
    await expect(tiles).toHaveCount(3);
    await expect(tiles.nth(0)).toHaveText('KURO OS');
    await expect(tiles.nth(1)).toHaveText('NeuroKURO');
    await expect(tiles.nth(2)).toHaveText('KUROPay');

    const buttons = page.locator('.kg-tile-btn');
    await expect(buttons.nth(0)).toHaveAttribute('href', '/app');
    await expect(buttons.nth(1)).toHaveAttribute('href', '/neuro');
    await expect(buttons.nth(2)).toHaveAttribute('href', 'https://kuropay.com');
  });

  test('footer contains ABN and x402 Foundation', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('ABN 45 340 322 909')).toBeVisible();
    await expect(page.getByText('x402 Foundation member')).toBeVisible();
    await expect(page.getByText('Built in Da Nang and Melbourne')).toBeVisible();
  });

  test('NeuroKURO tile click navigates to /neuro', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Learn →' }).click();
    await expect(page).toHaveURL(/\/neuro$/);
  });

  test('KURO OS tile click navigates to /app (redirects to /login when unauth)', async ({ page }) => {
    await page.goto('/');
    await page.locator('.kg-tile-btn').first().click();
    await page.waitForURL(/\/(app|login)$/);
    expect(page.url()).toMatch(/\/(app|login)$/);
  });
});

test.describe('NeuroKURO (/neuro)', () => {
  test('renders advisory, validation, phase tool, and resources', async ({ page }) => {
    await page.goto('/neuro');
    await expect(page.getByRole('heading', { name: 'NeuroKURO', level: 1 })).toBeVisible();
    await expect(page.getByText('Advisory only — not medical advice.').first()).toBeVisible();
    await expect(page.getByText('MMASH dataset')).toBeVisible();
    await expect(page.getByText('SANDD dataset')).toBeVisible();
    await expect(page.getByText('N=368 sessions · MAE 0.31h')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Phase tool' })).toBeVisible();
    await expect(page.getByRole('link', { name: /DOI: 10\.5281\/zenodo\.18869320/ })).toBeVisible();
  });

  test('phase tool submits and renders CT value', async ({ page }) => {
    await page.goto('/neuro');
    await page.getByTestId('input-sleep-onset').fill('22:45');
    await page.getByTestId('input-wake-time').fill('06:30');
    await page.getByTestId('btn-compute-phase').click();

    const result = page.getByTestId('phase-result');
    await expect(result).toBeVisible({ timeout: 5000 });
    const text = await result.innerText();
    expect(text).toMatch(/CT\s+\d+(\.\d+)?/);
    expect(text).toMatch(/ACTIVATION|BALANCE|BRAKE|RESET/);
    expect(text).toMatch(/Next phase/);
  });

  test('advisory banner appears both top and bottom', async ({ page }) => {
    await page.goto('/neuro');
    const banners = page.getByText('Advisory only — not medical advice.');
    await expect(banners).toHaveCount(2);
  });
});

test.describe('Routing', () => {
  test('unauthenticated /app redirects to /login', async ({ page }) => {
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('/login renders sign-in form', async ({ page }) => {
    await page.goto('/login');
    const inputs = page.locator('input');
    await expect(inputs.first()).toBeVisible();
  });
});

test.describe('Streaming API', () => {
  test('/api/neuro/phase/simulate returns ct and phaseLabel', async ({ request }) => {
    const r = await request.post('/api/neuro/phase/simulate', {
      data: { sleepOnset: '22:45', wakeTime: '06:30', timezone: 'Asia/Ho_Chi_Minh' },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(typeof body.ct).toBe('number');
    expect(body.phaseLabel).toMatch(/ACTIVATION|BALANCE|BRAKE|RESET/);
    expect(body.advisory).toMatch(/[Nn]ot medical advice/);
    expect(Array.isArray(body.transitions)).toBe(true);
  });

  test('/api/stream emits model event naming the current KURO tier', async ({ request }) => {
    const r = await request.post('/api/stream', {
      data: { messages: [{ role: 'user', content: 'hi' }], mode: 'main' },
      timeout: 15_000,
    });
    expect(r.status()).toBe(200);
    const reader = await r.body();
    const text = reader.toString('utf8');
    expect(text).toMatch(/"type":"model"/);
    expect(text).toMatch(/"model":"kuro-free"|"model":"kuro-pro"|"model":"kuro-sov"/);
  });
});
