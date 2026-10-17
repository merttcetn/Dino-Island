import { test, expect, type Page } from '@playwright/test';

async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__DINO_ISLAND__), null, { timeout: 45000 });
  await page.waitForFunction(() => (window as any).__DINO_ISLAND__.diagnostics().dinosaurModels === 4);
}
const state = (page: Page) => page.evaluate(() => (window as any).__DINO_ISLAND__.getState());
async function clickGround(page: Page, point: { x: number; z: number }): Promise<void> {
  const projected = await page.evaluate(p => (window as any).__DINO_ISLAND__.project(p), point);
  await page.mouse.click(projected.x, projected.y);
}

test('imports the original island, dinosaur models and native HUD without asset errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await ready(page);
  const initialDinosaurs = (await state(page)).dinosaurs;
  expect(initialDinosaurs).toHaveLength(4);
  expect(initialDinosaurs.every((dinosaur: any) => dinosaur.genome?.genes.length === 18)).toBe(true);
  await expect(page.getByRole('toolbar', { name: 'Park menüsü' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Genetik laboratuvarı', exact: true })).toBeVisible();
  const diagnostics = await page.evaluate(() => (window as any).__DINO_ISLAND__.diagnostics());
  expect(diagnostics.triangles).toBeGreaterThan(100000);
  expect(diagnostics.dinosaurModels).toBe(4);
  expect(diagnostics.animatedDinosaurs).toBe(4);
  expect(diagnostics.cameraProfile).toBe('Config1');
  expect(diagnostics.cameraDistance).toEqual([10, 300]);
  expect(diagnostics.skybox).toBe('isl01');
  expect(diagnostics.cloudLayers).toBe(2);
  await page.screenshot({ path: 'test-results/dino-island-park.png' });
  expect(errors).toEqual([]);
});

test('purchase, construction, incubation and save/load work through the native controls', async ({ page }) => {
  await ready(page);
  await page.keyboard.press('Space');
  expect((await state(page)).paused).toBe(true);
  expect((await page.evaluate(() => (window as any).__DINO_ISLAND__.diagnostics())).animatedDinosaurs).toBe(0);
  await page.getByRole('button', { name: 'Dinozor satın al', exact: true }).click();
  await page.getByRole('button', { name: 'Satın al', exact: true }).first().click();
  const initial = await state(page);
  const habitat = initial.habitats[0];
  await clickGround(page, { x: habitat.x + 6, z: habitat.z + 4 });
  await expect.poll(async () => (await state(page)).dinosaurs.length).toBe(5);
  expect((await state(page)).money).toBe(initial.money - 6500);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Yollar, çitler ve çevre düzenlemesi', exact: true }).click();
  await page.locator('.park-list-row').filter({ hasText: 'Yemlik' }).getByRole('button', { name: 'İnşa et' }).click();
  await clickGround(page, { x: habitat.x + 10, z: habitat.z + 8 });
  await expect.poll(async () => (await state(page)).buildings.length).toBe(1);
  expect((await state(page)).buildings[0].kind).toBe('feeder');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Genetik laboratuvarı', exact: true }).click();
  await page.getByLabel('Birinci ebeveyn').selectOption('1');
  await page.getByLabel('İkinci ebeveyn').selectOption('2');
  await page.getByRole('button', { name: 'Melez dinozor üret' }).click();
  expect((await state(page)).eggs.length).toBe(1);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Oyun seçenekleri', exact: true }).click();
  await page.getByRole('button', { name: 'Oyunu kaydet', exact: true }).first().click();
  const saved = await state(page);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Dinozor satın al', exact: true }).click();
  await page.getByRole('button', { name: 'Satın al', exact: true }).first().click();
  await clickGround(page, { x: habitat.x - 6, z: habitat.z + 4 });
  expect((await state(page)).dinosaurs.length).toBe(6);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Oyun seçenekleri', exact: true }).click();
  await page.getByRole('button', { name: 'Kaydı yükle', exact: true }).first().click();
  expect((await state(page)).dinosaurs.length).toBe(5);
  expect((await state(page)).money).toBe(saved.money);
  expect((await state(page)).eggs.length).toBe(1);
  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).__DINO_ISLAND__));
  expect((await state(page)).dinosaurs.length).toBe(5);
});

test('native controls remain visible at the original 800 by 600 resolution', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await ready(page);
  await page.getByRole('button', { name: 'Dinozor satın al', exact: true }).click();
  const dialog = page.locator('#park-dialog');
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(800);
  await expect(page.getByRole('button', { name: 'Satın al', exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/dino-island-800.png' });
});
