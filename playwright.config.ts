import { defineConfig } from '@playwright/test';
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function browserExecutable(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (existsSync(chromium.executablePath())) return undefined;
  const cache = process.platform === 'darwin' ? join(homedir(), 'Library/Caches/ms-playwright') : join(homedir(), '.cache/ms-playwright');
  if (!existsSync(cache)) return undefined;
  const installations = readdirSync(cache).filter(name => /^chromium_headless_shell-\d+$/.test(name)).sort((a, b) => Number(b.split('-').at(-1)) - Number(a.split('-').at(-1)));
  for (const installation of installations) {
    const relative = process.platform === 'darwin' ? `chrome-headless-shell-mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}/chrome-headless-shell` : 'chrome-headless-shell-linux64/chrome-headless-shell';
    const executable = join(cache, installation, relative);
    if (existsSync(executable)) return executable;
  }
  return undefined;
}

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5179',
    viewport: { width: 1280, height: 800 },
    launchOptions: { executablePath: browserExecutable(), args: ['--enable-unsafe-swiftshader'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 5179 --strictPort',
    url: 'http://127.0.0.1:5179',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
