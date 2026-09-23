import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const path = (relative) => new URL(relative, root);

test('local setup wrappers exist for both shell families', () => {
  for (const file of [
    'scripts/bootstrap.ps1',
    'scripts/bootstrap.sh',
    'scripts/start.ps1',
    'scripts/start.sh',
    'scripts/start.mjs',
    'scripts/doctor.mjs',
  ]) {
    assert.equal(existsSync(path(file)), true, file);
  }
});

test('wrappers use the repository ports and project-local symbolic environment', () => {
  const powershell = readFileSync(path('scripts/start.ps1'), 'utf8');
  const shell = readFileSync(path('scripts/start.sh'), 'utf8');
  const node = readFileSync(path('scripts/start.mjs'), 'utf8');

  assert.match(node, /5173/);
  assert.match(node, /8000/);
  assert.match(node, /services/);
  assert.match(node, /symbolic/);
  assert.match(powershell, /start\.mjs/);
  assert.match(shell, /start\.mjs/);
});

test('Windows setup resolves installed Node, npm and pnpm outside the stale PATH', () => {
  const bootstrap = readFileSync(path('scripts/bootstrap.ps1'), 'utf8');
  const helper = readFileSync(path('scripts/windows-paths.ps1'), 'utf8');
  const start = readFileSync(path('scripts/start.ps1'), 'utf8');
  const windowsScripts = `${bootstrap}\n${helper}`;

  assert.match(windowsScripts, /Resolve-NodeTool/);
  assert.match(windowsScripts, /ProgramFiles/);
  assert.match(windowsScripts, /npm.*prefix.*-g/s);
  assert.match(windowsScripts, /pnpm\.cmd/);
  assert.match(
    helper,
    /if \(-not \$KnownOnly\)[\s\S]*Get-Command[\s\S]*Get-StandardNodeDirectories/,
  );
  assert.match(bootstrap, /Resolve-NodeTool -Name 'node\.exe' -KnownOnly/);
  assert.match(bootstrap, /NpmGlobalBin.*NodeDirectory.*env:Path/s);
  assert.match(start, /Resolve-NodeTool/);
  assert.match(start, /Get-NpmGlobalExecutableDirectory/);
  assert.match(start, /NodeDirectory.*NpmGlobalBin.*env:Path/s);
});

test(
  'Windows path helper returns absolute executable and npm-global paths',
  { skip: process.platform !== 'win32' },
  () => {
    const helper = fileURLToPath(path('scripts/windows-paths.ps1'));
    const escapedHelper = helper.replaceAll("'", "''");
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `. '${escapedHelper}'`,
      "$env:Path = (($env:Path -split ';' | Where-Object { $_ -notmatch '(?i)nodejs' }) -join ';')",
      "$node = Resolve-NodeTool -Name 'node.exe'",
      "$npm = Resolve-NodeTool -Name 'npm.cmd'",
      '$global = Get-NpmGlobalExecutableDirectory -NpmPath $npm',
      "if (-not [IO.Path]::IsPathRooted($node)) { throw 'node path is not absolute' }",
      "if (-not [IO.Path]::IsPathRooted($npm)) { throw 'npm path is not absolute' }",
      "if (-not [IO.Path]::IsPathRooted($global)) { throw 'npm global path is not absolute' }",
      'Write-Output (@($node, $npm, $global) -join [Environment]::NewLine)',
    ].join('; ');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
      encoding: 'utf8',
      windowsHide: true,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /node\.exe/i);
    assert.match(result.stdout, /npm\.cmd/i);
  },
);

test('POSIX bootstrap loads a user-installed nvm before checking for it', () => {
  const shell = readFileSync(path('scripts/bootstrap.sh'), 'utf8');

  assert.match(shell, /\.nvm[\\/]nvm\.sh/);
  assert.match(shell, /command -v nvm/);
});
