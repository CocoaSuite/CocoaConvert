/**
 * Drives the production build in Chrome, served by the real server with its conversion tools.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../server/app';
import { loadConfig } from '../../server/config';
import { detectTools } from '../../server/process';
import { launch } from '../helpers/browser';
import { FIXTURES, sniff } from '../helpers/fixtures';

const tmp = mkdtempSync(join(tmpdir(), 'cc-ui-'));
const F = (n: string) => join(FIXTURES, n);
let app: FastifyInstance;
let bare: FastifyInstance;
let browser: Browser;
const shots = process.env.SHOTS_DIR;

async function start(disabled: string[], port: number) {
  const a = await buildApp(
    { ...loadConfig({}), staticDir: join(process.cwd(), 'dist'), workRoot: mkdtempSync(join(tmpdir(), 'cc-uiw-')), disabled, rateLimit: 10_000 },
    await detectTools(),
  );
  await a.listen({ port, host: '127.0.0.1' });
  return a;
}

beforeAll(async () => {
  app = await start([], 8093);
  bare = await start(['libreoffice', 'pandoc', 'ffmpeg', 'archive-native'], 8094);
  browser = await launch();
});

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await bare?.close();
});

async function open(width = 1360, height = 860, port = 8093): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height }, acceptDownloads: true });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()));
  (page as Page & { errors: string[] }).errors = errors;
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector('.start');
  return page;
}

const rows = (page: Page) => page.locator('[data-testid=file-row]');
const row = (page: Page, name: string) => rows(page).filter({ has: page.locator('.row-name', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });

async function waitIdle(page: Page) {
  // Updates render on the next animation frame; let the click land first.
  await page.waitForTimeout(250);
  await page.waitForFunction(() => !document.querySelector('.row.status-queued, .row.status-converting, .row.status-detecting'), null, {
    timeout: 240_000,
  });
}

async function download(page: Page, click: () => Promise<void>) {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  const path = join(tmp, dl.suggestedFilename());
  await dl.saveAs(path);
  return { name: dl.suggestedFilename(), data: new Uint8Array(readFileSync(path)), path };
}

describe('CocoaConvert in the browser', () => {
  it('converts a picked file and downloads the result', async () => {
    const page = await open();
    if (shots) await page.screenshot({ path: join(shots, 'desktop-start.png') });
    await page.setInputFiles('[data-testid=file-input]', F('sample.heic'));
    await expect.poll(() => row(page, 'sample.heic').locator('select').inputValue()).toBe('jpg');
    await page.getByRole('button', { name: 'Convert', exact: true }).click();
    await waitIdle(page);
    const file = await download(page, () => row(page, 'sample.heic').getByRole('button', { name: 'Download' }).click());
    expect(file.name).toBe('sample.jpg');
    expect(sniff(file.data, file.name).format).toBe('jpg');
    expect(execFileSync('identify', ['-format', '%w %h', file.path]).toString()).toBe('64 48');
    expect((page as Page & { errors: string[] }).errors).toEqual([]);
  });

  it('accepts dropped and pasted files', async () => {
    const page = await open();
    const b64 = readFileSync(F('sample.png')).toString('base64');
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }));
      for (const type of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      const clip = new DataTransfer();
      clip.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clip, bubbles: true, cancelable: true }));
    }, b64);
    await expect.poll(() => rows(page).count()).toBe(2);
    await expect.poll(() => row(page, 'dropped.png').innerText()).toContain('PNG');
    await expect.poll(() => row(page, 'Pasted image.png').count()).toBe(1);
  });

  it('runs a mixed batch: failures do not block the rest, retry works, ZIP has every result', async () => {
    const page = await open();
    const broken = join(tmp, 'broken.png');
    writeFileSync(broken, readFileSync(F('sample.png')).subarray(0, 60));
    const junk = join(tmp, 'mystery.bin');
    writeFileSync(junk, Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 37 + 11) % 256)));
    const many = Array.from({ length: 24 }, (_, i) => {
      const p = join(tmp, `copy-${i}.png`);
      copyFileSync(F('sample.png'), p);
      return p;
    });
    await page.setInputFiles('[data-testid=file-input]', [broken, junk, F('sample.csv'), F('sample.json'), F('sample.mp3'), F('sample.tar.gz'), ...many]);
    await expect.poll(() => row(page, 'mystery.bin').innerText()).toContain('not supported yet');
    // Bulk choice: WebP applies to the images only.
    await page.locator('.panel select').selectOption('webp');
    await expect.poll(() => row(page, 'copy-3.png').locator('select').inputValue()).toBe('webp');
    expect(await row(page, 'sample.csv').locator('select').inputValue()).toBe('xlsx');
    await row(page, 'sample.mp3').locator('select').selectOption('flac');
    await page.getByRole('button', { name: /^Convert \d+ files$/ }).click();
    await waitIdle(page);
    if (shots) await page.screenshot({ path: join(shots, 'desktop-batch.png'), fullPage: true });
    expect(await row(page, 'broken.png').innerText()).toMatch(/could not be read/);
    expect(await page.locator('.row.status-done').count()).toBe(28);
    await expect.poll(() => page.locator('.panel').innerText()).toMatch(/29 of 29 finished · 1 failed/);
    // Retry a failed file: it fails again for the same honest reason, and nothing else is touched.
    await row(page, 'broken.png').getByRole('button', { name: 'Retry' }).click();
    await waitIdle(page);
    expect(await row(page, 'broken.png').innerText()).toMatch(/could not be read/);
    const zip = await download(page, () => page.getByRole('button', { name: /Download all as ZIP/ }).click());
    const listing = execFileSync('unzip', ['-l', zip.path]).toString();
    expect(listing).toContain('copy-23.webp');
    expect(listing).toContain('sample.xlsx');
    expect(listing).toContain('sample.flac');
    expect(listing).toContain('sample.zip');
    expect(listing).toContain('sample.csv');
    expect(listing).toMatch(/\s28 files/);
  });

  it('cancels a running conversion and converts it again', async () => {
    const page = await open();
    await page.setInputFiles('[data-testid=file-input]', '/tmp/long.mp4');
    await expect.poll(() => row(page, 'long.mp4').locator('select').inputValue()).toBe('webm');
    await page.getByRole('button', { name: 'Convert', exact: true }).click();
    await expect.poll(() => row(page, 'long.mp4').innerText(), { timeout: 60_000 }).toMatch(/\d+%/);
    if (shots) await page.screenshot({ path: join(shots, 'desktop-progress.png') });
    await row(page, 'long.mp4').getByRole('button', { name: 'Cancel' }).click();
    await expect.poll(() => row(page, 'long.mp4').innerText()).toContain('Cancelled');
    await row(page, 'long.mp4').locator('select').selectOption('mp3');
    await page.getByRole('button', { name: 'Convert', exact: true }).click();
    await waitIdle(page);
    const file = await download(page, () => row(page, 'long.mp4').getByRole('button', { name: 'Download' }).click());
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', file.path]).toString());
    expect(Math.round(Number(probe.format.duration))).toBe(20);
  });

  it('asks before uploading, then converts on the server', async () => {
    const page = await open();
    await page.setInputFiles('[data-testid=file-input]', [F('sample.docx'), F('sample.md')]);
    await expect.poll(() => row(page, 'sample.docx').innerText()).toContain('Needs the server');
    await row(page, 'sample.md').locator('select').selectOption('html');
    // Only the on-device file starts without consent.
    await page.getByRole('button', { name: 'Convert', exact: true }).click();
    await waitIdle(page);
    expect(await row(page, 'sample.docx').getAttribute('class')).toContain('status-ready');
    await page.getByText('Allow server conversion').click();
    await page.getByRole('button', { name: 'Convert', exact: true }).click();
    await waitIdle(page);
    const pdf = await download(page, () => row(page, 'sample.docx').getByRole('button', { name: 'Download' }).click());
    expect(pdf.name).toBe('sample.pdf');
    expect(execFileSync('pdftotext', [pdf.path, '-']).toString()).toContain('CocoaConvert sample');
  });

  it('works on a phone without sideways scrolling', async () => {
    const page = await open(390, 844);
    if (shots) await page.screenshot({ path: join(shots, 'mobile-start.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.setInputFiles('[data-testid=file-input]', [F('sample.png'), F('sample.mov'), F('sample.zip'), F('sample.xlsx')]);
    await expect.poll(() => rows(page).count()).toBe(4);
    await page.getByRole('button', { name: /^Convert 4 files$/ }).click();
    await waitIdle(page);
    if (shots) await page.screenshot({ path: join(shots, 'mobile-done.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const btn = await row(page, 'sample.png').getByRole('button', { name: 'Download' }).boundingBox();
    expect(btn!.height).toBeGreaterThanOrEqual(40);
  });

  it('lists supported formats and remembers the theme', async () => {
    const page = await open();
    await page.getByRole('button', { name: 'Formats' }).click();
    const dialog = page.getByRole('dialog');
    await expect.poll(() => dialog.innerText()).toContain('HEIC');
    await dialog.getByRole('searchbox').fill('docx');
    expect(await dialog.innerText()).toMatch(/DOCX[\s\S]*HTML/);
    if (shots) await page.screenshot({ path: join(shots, 'desktop-formats.png') });
    await dialog.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Use light theme' }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('cc-theme'))).toBe('light');
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.classList.contains('light'))).toBe(true);
    await page.setInputFiles('[data-testid=file-input]', [F('sample.png'), F('sample.docx')]);
    await expect.poll(() => rows(page).count()).toBe(2);
    if (shots) await page.screenshot({ path: join(shots, 'desktop-light.png') });
  });

  it('without a server, offers only what the browser can do and says so', async () => {
    const page = await open(1360, 860, 8094);
    expect(await page.locator('.privacy').innerText()).toContain('Everything runs on this device');
    await page.setInputFiles('[data-testid=file-input]', [F('sample.docx'), F('sample.doc')]);
    await expect.poll(() => row(page, 'sample.docx').locator('option').count()).toBeGreaterThan(1);
    const options = await row(page, 'sample.docx').locator('option').allInnerTexts();
    expect(options.some((o) => o.includes('server'))).toBe(false);
    expect(options).toContain('HTML');
    await expect.poll(() => row(page, 'sample.doc').innerText()).toContain('cannot be converted yet in the browser');
  });
});
