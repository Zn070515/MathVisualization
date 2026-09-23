import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const appUrl = 'http://127.0.0.1:5173/';
const symbolicUrl = 'http://127.0.0.1:8000/health';
const symbolicDirectory = join(root, 'services', 'symbolic');
const symbolicPython =
  process.platform === 'win32'
    ? join(symbolicDirectory, '.venv', 'Scripts', 'python.exe')
    : join(symbolicDirectory, '.venv', 'bin', 'python');

const children = new Set();
let shuttingDown = false;

function executable(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function sleep(milliseconds) {
  return new Promise((resolveResult) => setTimeout(resolveResult, milliseconds));
}

function spawnChild(label, command, args, options = {}) {
  const invocation =
    process.platform === 'win32' && command.toLowerCase().endsWith('.cmd')
      ? {
          command: process.env.ComSpec ?? 'cmd.exe',
          args: ['/d', '/c', command, ...args],
        }
      : { command, args };
  const child = spawn(invocation.command, invocation.args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: false,
    detached: process.platform !== 'win32',
    ...options,
  });

  children.add(child);
  child.once('error', (error) => {
    if (!shuttingDown) {
      console.error(`${label} failed to start: ${error.message}`);
      stopAll(1);
    }
  });
  child.once('exit', (code, signal) => {
    children.delete(child);
    if (!shuttingDown) {
      const status = signal === null ? `exit code ${code}` : `signal ${signal}`;
      console.error(`${label} stopped unexpectedly (${status}).`);
      stopAll(code === 0 ? 1 : (code ?? 1));
    }
  });
  return child;
}

function terminate(child) {
  if (child.killed || child.exitCode !== null) return;

  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // The child already exited between the checks above.
    }
  }
}

function stopAll(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) terminate(child);
  process.exitCode = exitCode;
  setTimeout(() => process.exit(exitCode), 100);
}

process.once('exit', () => {
  for (const child of children) terminate(child);
});

async function waitFor(url, label, timeoutMilliseconds = 30_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError = 'no response';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(250);
  }

  throw new Error(`${label} was not ready after ${timeoutMilliseconds / 1000}s (${lastError}).`);
}

function openBrowser(url) {
  let command;
  let args;

  if (process.platform === 'win32') {
    command = 'cmd.exe';
    args = ['/d', '/c', 'start', '', url];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  const browser = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  browser.unref();
  browser.once('error', () => {
    console.log(`Open ${url} in your browser.`);
  });
}

if (!existsSync(symbolicPython)) {
  console.error('The symbolic Python environment is missing. Run the bootstrap script first.');
  process.exit(1);
}

console.log('Starting MathVisualization...');
console.log('  App:      http://127.0.0.1:5173');
console.log('  Symbolic: http://127.0.0.1:8000');

process.once('SIGINT', () => stopAll(0));
process.once('SIGTERM', () => stopAll(0));

spawnChild('Symbolic service', symbolicPython, ['server.py'], { cwd: symbolicDirectory });
spawnChild('Vite app', executable('pnpm'), ['--filter', '@mathviz/app', 'dev']);

try {
  await Promise.all([
    waitFor(appUrl, 'The Vite app'),
    waitFor(symbolicUrl, 'The symbolic service'),
  ]);
  console.log('');
  console.log('MathVisualization is ready. Press Ctrl+C to stop both services.');
  openBrowser(appUrl);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  stopAll(1);
}
