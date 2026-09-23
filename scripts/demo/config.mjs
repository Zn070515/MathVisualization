import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifestFor } from './scenarioManifest.mjs';

export const ROOT_DIR = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const DEFAULT_BASE_URL = 'http://127.0.0.1:5173';
export const VIDEO_SIZE = Object.freeze({ width: 1440, height: 900 });
export const ASSET_DIR = path.join(ROOT_DIR, 'docs', 'assets');
export const SOURCE_DIR = path.join(ASSET_DIR, 'source');

export function resolvePlaywrightRepo() {
  return path.resolve(
    process.env.MATHVIZ_PLAYWRIGHT_REPO ?? path.join(ROOT_DIR, '..', 'demo_ArtFlow'),
  );
}

export function loadPlaywright() {
  const repo = resolvePlaywrightRepo();
  const requireFromRepo = createRequire(path.join(repo, 'package.json'));
  try {
    return requireFromRepo('playwright');
  } catch (error) {
    throw new Error(
      `Could not load Playwright from ${repo}. Set MATHVIZ_PLAYWRIGHT_REPO to the external repo containing node_modules.`,
      { cause: error },
    );
  }
}

function assertRecordable(name) {
  const demo = manifestFor(name);
  if (demo.status !== 'ready') {
    throw new Error(`Scenario "${name}" is planned; no media will be created.`);
  }
}

export function scenarioSourcePath(name) {
  assertRecordable(name);
  return path.join(SOURCE_DIR, `${name}-demo.webm`);
}

export function scenarioGifPath(name) {
  assertRecordable(name);
  return path.join(ASSET_DIR, `${name}-demo.gif`);
}
