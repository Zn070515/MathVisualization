import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';

import { DEFAULT_BASE_URL, ROOT_DIR, SOURCE_DIR, VIDEO_SIZE } from '../config.mjs';

function isLoopbackUrl(value) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]')
    );
  } catch {
    return false;
  }
}

function tail(text, size = 4000) {
  return text.length <= size ? text : text.slice(-size);
}

function commandForPlatform() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null) return;

  if (process.platform === 'win32' && child.pid) {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('close', resolve);
      killer.once('error', resolve);
    });
    return;
  }

  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timeout = globalThis.setTimeout(resolve, 2000);
    child.once('close', () => {
      globalThis.clearTimeout(timeout);
      resolve();
    });
  });
}

export async function startAppServer({
  baseUrl = process.env.MATHVIZ_DEMO_BASE_URL ?? DEFAULT_BASE_URL,
} = {}) {
  const externalBaseUrl = process.env.MATHVIZ_DEMO_BASE_URL;
  const resolvedBaseUrl = externalBaseUrl ?? baseUrl;
  if (!isLoopbackUrl(resolvedBaseUrl)) {
    throw new Error(
      `MATHVIZ_DEMO_BASE_URL must be a loopback HTTP(S) URL, received: ${resolvedBaseUrl}`,
    );
  }

  if (externalBaseUrl) {
    return { baseUrl: resolvedBaseUrl.replace(/\/$/, ''), close: async () => {} };
  }

  const child = spawn(commandForPlatform(), ['dev'], {
    cwd: ROOT_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout?.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    output += chunk.toString();
  });

  const deadline = Date.now() + 30_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `The MathVisualization dev server exited before becoming ready.\n${tail(output)}`,
      );
    }
    try {
      const response = await globalThis.fetch(new URL('/complex', resolvedBaseUrl));
      if (response.ok) {
        return {
          baseUrl: resolvedBaseUrl.replace(/\/$/, ''),
          close: () => terminateChild(child),
        };
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
  }

  await terminateChild(child);
  throw new Error(
    `Timed out waiting for the MathVisualization dev server at ${resolvedBaseUrl}. ${lastError?.message ?? ''}\n${tail(output)}`,
  );
}

export async function waitForAppReady(page) {
  await page.waitForSelector('.workspace');
  await page.waitForFunction(() => globalThis.document.querySelectorAll('math-field').length > 0);
  await page.evaluate(() => globalThis.document.fonts?.ready);
}

export async function newDemoContext(browser, { recordVideo = false, scenario } = {}) {
  if (recordVideo) await mkdir(SOURCE_DIR, { recursive: true });
  const context = await browser.newContext({
    viewport: VIDEO_SIZE,
    screen: VIDEO_SIZE,
    locale: 'en-US',
    deviceScaleFactor: 1,
    ...(recordVideo ? { recordVideo: { dir: SOURCE_DIR, size: VIDEO_SIZE } } : {}),
  });
  const page = await context.newPage();
  if (scenario) page.setDefaultTimeout(10_000);
  return { context, page };
}
