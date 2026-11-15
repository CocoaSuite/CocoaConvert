import { chromium, type Browser } from 'playwright';
import { existsSync } from 'node:fs';

/** Uses an installed Chrome when present, otherwise Playwright's own Chromium. */
export function launch(): Promise<Browser> {
  const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
  return chromium.launch({ executablePath: process.env.CHROME_PATH ?? chrome, args: ['--no-sandbox'] });
}
