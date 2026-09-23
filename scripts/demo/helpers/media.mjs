import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function gifAttemptPlan() {
  return [
    { fps: 15, width: 1200 },
    { fps: 12, width: 1200 },
    { fps: 12, width: 1100 },
  ];
}

/**
 * The complete one-graph equivalent of the two-step palette pipeline.
 * Conversion uses the same stages as separate ffmpeg commands below; this string
 * makes both palette stages inspectable in a pure contract test.
 */
export function gifFilter({ fps, width }) {
  return [
    `fps=${fps},scale=${width}:-1:flags=lanczos,split[paletteSource][gifSource]`,
    `[paletteSource]palettegen=max_colors=256[palette]`,
    `[gifSource][palette]paletteuse=dither=none:diff_mode=rectangle`,
  ].join(';');
}

export function paletteGenerationFilter({ fps, width }) {
  return `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen=max_colors=256`;
}

export function paletteUseFilter({ fps, width }) {
  return `fps=${fps},scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle`;
}

function parseFrameRate(value) {
  const [numerator, denominator] = String(value ?? '0/1')
    .split('/')
    .map(Number);
  return denominator === 0 ? 0 : numerator / denominator;
}

export async function probeMedia(filePath) {
  const [{ stdout }, fileStats] = await Promise.all([
    execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height,r_frame_rate,duration:format=duration',
        '-of',
        'json',
        filePath,
      ],
      { windowsHide: true },
    ),
    stat(filePath),
  ]);
  const parsed = JSON.parse(stdout);
  const stream = parsed.streams?.[0] ?? {};
  const duration = Number(stream.duration ?? parsed.format?.duration ?? 0);
  return {
    width: Number(stream.width ?? 0),
    height: Number(stream.height ?? 0),
    fps: parseFrameRate(stream.r_frame_rate),
    duration,
    bytes: fileStats.size,
  };
}

export async function validateGif(
  filePath,
  { minDuration = 12, maxDuration = 18, maxBytes = 10 * 1024 * 1024, minWidth = 1100 } = {},
) {
  const measured = await probeMedia(filePath);
  const failures = [];
  if (measured.bytes === 0) failures.push('size is zero');
  if (measured.bytes > maxBytes) failures.push(`size is ${measured.bytes} bytes, over ${maxBytes}`);
  if (measured.width < minWidth) failures.push(`width is ${measured.width}px, below ${minWidth}px`);
  if (measured.fps < 12 || measured.fps > 15) {
    failures.push(`frame rate is ${measured.fps}fps, outside 12–15fps`);
  }
  if (measured.duration < minDuration || measured.duration > maxDuration) {
    failures.push(
      `duration is ${measured.duration.toFixed(2)}s, outside ${minDuration}–${maxDuration}s`,
    );
  }
  if (failures.length > 0) {
    throw new Error(`GIF validation failed for ${filePath}: ${failures.join('; ')}.`);
  }
  return measured;
}
