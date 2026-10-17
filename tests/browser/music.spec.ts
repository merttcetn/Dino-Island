import { test, expect, type Page } from '@playwright/test';

// A short real PCM track reaches its end repeatedly without a five-minute test.
function shortTrack(): Buffer {
  const rate = 22050, count = rate / 4 | 0;
  const wav = Buffer.alloc(44 + count * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) wav.writeInt16LE(Math.round(Math.sin(i / rate * 440 * Math.PI * 2) * 16000), 44 + i * 2);
  return wav;
}

async function audioPage(page: Page, url = '/test-music.wav'): Promise<void> {
  await page.route('**/__music-test', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><button id="toggle">Müzik</button>' }));
  await page.route('**/test-music.wav', route => route.fulfill({ contentType: 'audio/wav', body: shortTrack() }));
  await page.goto('/__music-test');
  await page.evaluate(async url => {
    // Observe actual rendered audio samples, rather than only checking loop=true.
    const original = AudioContext.prototype.createGain;
    const observed: any = { sources: 0 };
    AudioContext.prototype.createGain = function () {
      const gain = original.call(this);
      const analyser = this.createAnalyser();
      gain.connect(analyser);
      observed.context = this; observed.analyser = analyser;
      return gain;
    };
    const originalSource = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      observed.sources++;
      const source = originalSource.call(this);
      observed.source = source;
      return source;
    };
    const modulePath = '/src/music.ts';
    const { LoopingMusic } = await import(modulePath);
    observed.music = new LoopingMusic(url);
    observed.error = null;
    document.querySelector<HTMLButtonElement>('#toggle')!.onclick = () => {
      observed.music.setEnabled(!observed.music.enabled).catch((error: Error) => { observed.error = error.message; });
    };
    (window as any).__musicTest = observed;
  }, url);
}

test('music still emits real audio after the track has looped several times', async ({ page }) => {
  await audioPage(page);
  await page.getByRole('button', { name: 'Müzik' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__musicTest.sources)).toBe(1);
  await page.waitForFunction(() => (window as any).__musicTest.context.currentTime > 1.1);
  const result = await page.evaluate(() => {
    const { analyser, source, error } = (window as any).__musicTest;
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    return { peak: Math.max(...samples.map(Math.abs)), duration: source.buffer.duration, error };
  });
  expect(result.duration).toBeLessThan(0.3);
  expect(result.peak).toBeGreaterThan(0.02);
  expect(result.error).toBeNull();
});

test('returning to the page resumes enabled music, but keeps muted music off', async ({ page }) => {
  await audioPage(page);
  await page.getByRole('button', { name: 'Müzik' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__musicTest.context?.state)).toBe('running');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect.poll(() => page.evaluate(() => (window as any).__musicTest.context.state)).toBe('suspended');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect.poll(() => page.evaluate(() => (window as any).__musicTest.context.state)).toBe('running');
  await page.getByRole('button', { name: 'Müzik' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__musicTest.context.state)).toBe('suspended');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  expect(await page.evaluate(() => (window as any).__musicTest.music.enabled)).toBe(false);
  expect(await page.evaluate(() => (window as any).__musicTest.context.state)).toBe('suspended');
});

test('the original island MP3 decodes and resumes without overlapping tracks', async ({ page }) => {
  await audioPage(page, '/assets/original-audio/musEquateur.mp3');
  await page.getByRole('button', { name: 'Müzik' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__musicTest.sources)).toBe(1);
  expect(await page.evaluate(() => (window as any).__musicTest.source.buffer.duration)).toBeGreaterThan(298);
  await page.getByRole('button', { name: 'Müzik' }).click();
  await page.getByRole('button', { name: 'Müzik' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__musicTest.context.state)).toBe('running');
  expect(await page.evaluate(() => (window as any).__musicTest.sources)).toBe(1);
  expect(await page.evaluate(() => (window as any).__musicTest.error)).toBeNull();
});
