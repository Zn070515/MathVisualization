import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  gifAttemptPlan,
  paletteGenerationFilter,
  paletteUseFilter,
  validateGif,
} from './helpers/media.mjs';

const execFileAsync = promisify(execFile);

async function runFfmpeg(args) {
  await execFileAsync('ffmpeg', ['-y', ...args], { windowsHide: true });
}

export async function convertWebmToGif(sourcePath, gifPath, options = {}) {
  const attempts = options.attempts ?? [
    ...gifAttemptPlan(),
    { fps: 12, width: 1000, minWidth: 1000 },
  ];
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mathviz-demo-'));
  const failures = [];
  await mkdir(path.dirname(gifPath), { recursive: true });

  try {
    for (const attempt of attempts) {
      const palettePath = path.join(tempDir, `palette-${attempt.fps}-${attempt.width}.png`);
      const candidatePath = path.join(tempDir, `output-${attempt.fps}-${attempt.width}.gif`);
      try {
        await runFfmpeg(['-i', sourcePath, '-vf', paletteGenerationFilter(attempt), palettePath]);
        await runFfmpeg([
          '-i',
          sourcePath,
          '-i',
          palettePath,
          '-lavfi',
          paletteUseFilter(attempt),
          '-loop',
          '0',
          candidatePath,
        ]);
        const measured = await validateGif(candidatePath, {
          minWidth: attempt.minWidth ?? 1100,
        });
        await rm(gifPath, { force: true });
        await rename(candidatePath, gifPath);
        return { ...measured, fps: attempt.fps, width: attempt.width };
      } catch (error) {
        failures.push(
          `${attempt.fps}fps/${attempt.width}px: ${error instanceof Error ? error.message : error}`,
        );
      } finally {
        await rm(palettePath, { force: true });
        await rm(candidatePath, { force: true });
      }
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  throw new Error(`Unable to create a validated GIF from ${sourcePath}.\n${failures.join('\n')}`);
}
