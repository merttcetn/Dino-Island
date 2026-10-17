#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const origin = 'http://dino-island.local';

function browserExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const cache = process.platform === 'darwin'
    ? join(homedir(), 'Library/Caches/ms-playwright')
    : join(homedir(), '.cache/ms-playwright');
  if (!existsSync(cache)) return undefined;
  const fullBrowser = readdirSync(cache)
    .filter(name => /^chromium-\d+$/.test(name))
    .sort((left, right) => Number(right.split('-').at(-1)) - Number(left.split('-').at(-1)))
    .map(installation => process.platform === 'darwin'
      ? join(cache, installation, `chrome-mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}`, 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
      : join(cache, installation, 'chrome-linux/google_chrome_for_testing'))
    .find(existsSync);
  if (fullBrowser) return fullBrowser;
  const installations = readdirSync(cache)
    .filter(name => /^chromium_headless_shell-\d+$/.test(name))
    .sort((left, right) => Number(right.split('-').at(-1)) - Number(left.split('-').at(-1)));
  for (const installation of installations) {
    const relative = process.platform === 'darwin'
      ? `chrome-headless-shell-mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}/chrome-headless-shell`
      : 'chrome-headless-shell-linux64/chrome-headless-shell';
    const executable = join(cache, installation, relative);
    if (existsSync(executable)) return executable;
  }
  return undefined;
}

function publicFile(pathname) {
  const relative = pathname.replace(/^\/+/, '');
  if (!relative || relative.includes('..')) return undefined;
  const candidate = join(root, 'public', relative);
  return existsSync(candidate) && candidate.startsWith(join(root, 'public')) ? candidate : undefined;
}

const vite = await createServer({
  root,
  appType: 'spa',
  clearScreen: false,
  server: { middlewareMode: true, hmr: false, ws: false },
});

let browser;

try {
  browser = await chromium.launch({
    executablePath: browserExecutable(),
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });

  await page.route(`${origin}/**`, async route => {
    const requestUrl = new URL(route.request().url());
    const pathname = decodeURIComponent(requestUrl.pathname);
    try {
      if (pathname === '/' || pathname === '/index.html') {
        const html = await vite.transformIndexHtml('/', readFileSync(join(root, 'index.html'), 'utf8'));
        await route.fulfill({ body: html, contentType: 'text/html' });
        return;
      }

      const staticFile = publicFile(pathname);
      if (staticFile) {
        await route.fulfill({ path: staticFile });
        return;
      }

      const transformed = await vite.transformRequest(`${pathname}${requestUrl.search}`);
      if (transformed?.code) {
        await route.fulfill({
          body: transformed.code,
          contentType: 'text/javascript',
        });
        return;
      }
      await route.fulfill({ status: 404, body: `Offline QA missing asset: ${pathname}` });
    } catch (error) {
      await route.fulfill({ status: 500, body: String(error) });
    }
  });

  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(globalThis.__DINO_ISLAND__), null, { timeout: 60000 });
  await page.waitForFunction(() => globalThis.__DINO_ISLAND__.diagnostics().dinosaurModels === 4, null, { timeout: 60000 });
  const diagnostics = await page.evaluate(() => globalThis.__DINO_ISLAND__.diagnostics());
  mkdirSync(join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: join(root, 'test-results/dino-island-offline-qa.png'), animations: 'disabled' });

  const expected = {
    dinosaurModels: 4,
    animatedDinosaurs: 4,
    cameraProfile: 'Config1',
    skybox: 'isl01',
    cloudLayers: 2,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (diagnostics[key] !== value) problems.push(`diagnostics.${key}: expected ${value}, received ${diagnostics[key]}`);
  }
  if (!Array.isArray(diagnostics.cameraDistance) || diagnostics.cameraDistance[0] !== 10 || diagnostics.cameraDistance[1] !== 300) {
    problems.push(`diagnostics.cameraDistance: expected 10,300, received ${JSON.stringify(diagnostics.cameraDistance)}`);
  }
  if (diagnostics.triangles <= 100000) problems.push(`diagnostics.triangles: ${diagnostics.triangles}`);
  if (problems.length) throw new Error(`Offline browser QA failed:\n- ${problems.join('\n- ')}`);
  console.log(JSON.stringify({ ok: true, diagnostics, screenshot: 'test-results/dino-island-offline-qa.png' }, null, 2));
} finally {
  await browser?.close();
  await vite.close();
}
