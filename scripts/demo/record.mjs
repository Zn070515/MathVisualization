import { execFile } from 'node:child_process';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { loadPlaywright, scenarioSourcePath } from './config.mjs';
import { newDemoContext, startAppServer, waitForAppReady } from './helpers/app.mjs';
import { replaceMathField, pressEnter } from './helpers/mathInput.mjs';
import { moveHumanLike } from './helpers/mouse.mjs';
import { pause } from './helpers/timing.mjs';
import { DEMO_NAMES, manifestFor } from './scenarioManifest.mjs';
import calculus from './scenarios/calculus.mjs';
import complex from './scenarios/complex.mjs';
import transforms from './scenarios/transforms.mjs';

const execFileAsync = promisify(execFile);
const scenarios = { complex, transforms, calculus };

export function parseDemoArgs(args) {
  if (args.length === 1 && args[0] === '--check') return { mode: 'check', names: [] };

  let mode = 'record';
  let target = null;
  if (args[0] === '--rehearse') {
    mode = 'rehearse';
    target = args[1] ?? 'all';
    if (args.length > 2) throw new Error('Usage: pnpm demo:rehearse <name|all>');
  } else {
    target = args[0] ?? null;
    if (args.length !== 1) throw new Error('Usage: pnpm demo <name|all>');
  }

  const names = target === 'all' ? [...DEMO_NAMES] : [target];
  if (target !== 'all' && (names.length !== 1 || !DEMO_NAMES.includes(names[0]))) {
    throw new Error(`Unknown demo scenario "${target}". Choose ${DEMO_NAMES.join(', ')} or all.`);
  }
  return { mode, names };
}

async function checkCommand(command, label) {
  try {
    await execFileAsync(command, ['-version'], { windowsHide: true });
    globalThis.console.log(`${label}: ${command}`);
  } catch (error) {
    throw new Error(`${label} is not available on PATH.`, { cause: error });
  }
}

export async function checkPrerequisites() {
  const playwright = loadPlaywright();
  const browser = await playwright.chromium.launch({ headless: true });
  await browser.close();
  globalThis.console.log(`Playwright: ${playwright.chromium.name()}`);
  await checkCommand('ffmpeg', 'FFmpeg');
  await checkCommand('ffprobe', 'FFprobe');
}

async function recordOne(name, mode, resources) {
  const scenario = scenarios[name];
  const manifest = manifestFor(name);
  if (manifest.status !== 'ready') {
    globalThis.console.log(`SKIP ${name}: ${scenario.skipReason}`);
    return { status: 'skipped' };
  }

  const { browser, baseUrl } = resources;
  const { context, page } = await newDemoContext(browser, {
    recordVideo: mode === 'record',
    scenario: name,
  });
  const video = page.video();
  let succeeded = false;
  try {
    await page.goto(`${baseUrl}${manifest.route}`, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await scenario.run({ page, pause, replaceMathField, pressEnter, moveHumanLike });
    succeeded = true;
  } finally {
    await context.close();
  }

  if (mode === 'rehearse') {
    globalThis.console.log(`REHEARSED ${name} at ${manifest.route}`);
    return { status: 'rehearsed' };
  }

  if (!succeeded || video === null) {
    throw new Error(`No Playwright video was produced for ${name}.`);
  }

  const temporaryPath = await video.path();
  const sourcePath = scenarioSourcePath(name);
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await rm(sourcePath, { force: true });
  await rename(temporaryPath, sourcePath);
  globalThis.console.log(`RECORDED ${name}: ${sourcePath}`);

  const { convertWebmToGif } = await import('./gif.mjs');
  const gifPath = (await import('./config.mjs')).scenarioGifPath(name);
  const converted = await convertWebmToGif(sourcePath, gifPath);
  globalThis.console.log(
    `GIF ${name}: ${gifPath} · ${converted.width}×${converted.height} · ${converted.duration.toFixed(2)}s · ${converted.fps}fps · ${converted.bytes} bytes`,
  );
  return { status: 'recorded', sourcePath };
}

async function runWithResources(names, mode) {
  const readyNames = names.filter((name) => manifestFor(name).status === 'ready');
  if (readyNames.length === 0) {
    return Promise.all(
      names.map((name) => recordOne(name, mode, { browser: null, baseUrl: null })),
    );
  }

  const server = await startAppServer();
  let browser = null;
  try {
    const playwright = loadPlaywright();
    browser = await playwright.chromium.launch({ headless: true });
    const results = [];
    for (const name of names) {
      results.push(await recordOne(name, mode, { browser, baseUrl: server.baseUrl }));
    }
    return results;
  } finally {
    await browser?.close();
    await server.close();
  }
}

export async function runScenario(name, { mode = 'record', resources = null } = {}) {
  manifestFor(name);
  if (resources !== null) return recordOne(name, mode, resources);
  const results = await runWithResources([name], mode);
  return results[0];
}

export async function main(args = process.argv.slice(2)) {
  const parsed = parseDemoArgs(args);
  if (parsed.mode === 'check') {
    await checkPrerequisites();
    return;
  }
  await runWithResources(parsed.names, parsed.mode);
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error) => {
    globalThis.console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
