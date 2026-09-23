import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

export const REQUIRED_VERSIONS = Object.freeze({
  node: '24.0.0',
  uv: '0.12.0',
  python: '3.12.0',
  sympy: '1.14.0',
});

const DEFAULT_PORTS = [5173, 8000];

export function parseVersion(text) {
  const match = /(?:^|[^0-9])(\d+)\.(\d+)\.(\d+)(?:[^0-9]|$)/.exec(String(text));
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function versionAtLeast(actual, minimum) {
  const left = parseVersion(actual);
  const right = parseVersion(minimum);
  if (left === null || right === null) return false;
  return (
    left.major > right.major ||
    (left.major === right.major &&
      (left.minor > right.minor || (left.minor === right.minor && left.patch >= right.patch)))
  );
}

export function packageManagerVersion(packageJson) {
  const value = packageJson?.packageManager;
  if (typeof value !== 'string') return null;
  const match = /^pnpm@(\d+\.\d+\.\d+)$/.exec(value);
  return match?.[1] ?? null;
}

function packageJsonAt(root) {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

function commandCandidates(name) {
  return process.platform === 'win32' ? [`${name}.cmd`, `${name}.exe`, name] : [name];
}

function run(command, args) {
  const invocation =
    process.platform === 'win32' && command.toLowerCase().endsWith('.cmd')
      ? {
          command: process.env.ComSpec ?? 'cmd.exe',
          args: ['/d', '/c', command, ...args],
        }
      : { command, args };
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.error !== undefined || result.status !== 0) return null;
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
}

function commandOutput(name, args = ['--version']) {
  for (const candidate of commandCandidates(name)) {
    const output = run(candidate, args);
    if (output !== null) return { command: candidate, output };
  }
  return null;
}

function pythonPath(root) {
  const relative =
    process.platform === 'win32'
      ? join('services', 'symbolic', '.venv', 'Scripts', 'python.exe')
      : join('services', 'symbolic', '.venv', 'bin', 'python');
  return join(root, relative);
}

function check(label, ok, value, detail = '') {
  return { label, ok, value, detail };
}

async function portAvailable(port) {
  return new Promise((resolveResult) => {
    const server = createServer();
    const finish = (available) => {
      server.close(() => resolveResult(available));
    };
    server.once('error', () => resolveResult(false));
    server.listen({ host: '127.0.0.1', port }, () => finish(true));
  });
}

export async function collectChecks({ root = ROOT, checkPorts = true } = {}) {
  const packageJson = packageJsonAt(root);
  const expectedPnpm = packageManagerVersion(packageJson) ?? '11.22.0';
  const checks = [];

  checks.push(
    check(
      'Node.js',
      versionAtLeast(process.version, REQUIRED_VERSIONS.node),
      process.version,
      `requires ${REQUIRED_VERSIONS.node}+`,
    ),
  );

  const pnpm = commandOutput('pnpm');
  const pnpmVersion = pnpm === null ? null : parseVersion(pnpm.output);
  checks.push(
    check(
      'pnpm',
      pnpmVersion !== null &&
        `${pnpmVersion.major}.${pnpmVersion.minor}.${pnpmVersion.patch}` === expectedPnpm,
      pnpmVersion === null
        ? 'not found'
        : `${pnpmVersion.major}.${pnpmVersion.minor}.${pnpmVersion.patch}`,
      `requires ${expectedPnpm}`,
    ),
  );

  const uv = commandOutput('uv');
  checks.push(
    check(
      'uv',
      uv !== null && versionAtLeast(uv.output, REQUIRED_VERSIONS.uv),
      uv === null ? 'not found' : uv.output.split(/\r?\n/, 1)[0],
      `requires ${REQUIRED_VERSIONS.uv}+`,
    ),
  );

  const python = pythonPath(root);
  const pythonVersionOutput = existsSync(python) ? run(python, ['--version']) : null;
  checks.push(
    check(
      'Python',
      pythonVersionOutput !== null && versionAtLeast(pythonVersionOutput, REQUIRED_VERSIONS.python),
      pythonVersionOutput ?? 'services/symbolic/.venv is missing',
      `requires ${REQUIRED_VERSIONS.python}+ in the project venv`,
    ),
  );

  const sympyOutput =
    pythonVersionOutput === null
      ? null
      : run(python, ['-c', 'import sympy; print(sympy.__version__)']);
  const sympyVersion = sympyOutput === null ? null : parseVersion(sympyOutput);
  checks.push(
    check(
      'SymPy',
      sympyVersion !== null &&
        `${sympyVersion.major}.${sympyVersion.minor}.${sympyVersion.patch}` ===
          REQUIRED_VERSIONS.sympy,
      sympyOutput ?? 'not importable',
      `requires ${REQUIRED_VERSIONS.sympy}`,
    ),
  );

  const dependenciesInstalled = existsSync(join(root, 'node_modules'));
  checks.push(
    check(
      'JS dependencies',
      dependenciesInstalled,
      dependenciesInstalled ? 'installed' : 'node_modules is missing',
      'run the bootstrap script to install them',
    ),
  );

  if (checkPorts) {
    for (const port of DEFAULT_PORTS) {
      const available = await portAvailable(port);
      checks.push(
        check(
          `port ${port}`,
          available,
          available ? 'available' : 'in use',
          available ? '' : 'stop the existing process before running start',
        ),
      );
    }
  }

  return checks;
}

export function printChecks(checks, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify({ ready: checks.every((item) => item.ok), checks }, null, 2));
    return;
  }

  console.log('MathVisualization environment');
  console.log('');
  for (const item of checks) {
    const mark = item.ok ? '✓' : '✗';
    console.log(`${mark} ${item.label.padEnd(16)} ${item.value}`);
    if (!item.ok && item.detail) console.log(`  ${item.detail}`);
  }
  console.log('');
  console.log(checks.every((item) => item.ok) ? 'Ready.' : 'Not ready. Run the bootstrap script.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const json = process.argv.includes('--json');
  const checks = await collectChecks();
  printChecks(checks, { json });
  if (!checks.every((item) => item.ok)) process.exitCode = 1;
}
