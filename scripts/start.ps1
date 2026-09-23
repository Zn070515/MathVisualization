$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
  throw 'Node.js is not installed. Run .\scripts\bootstrap.ps1 first.'
}

& node.exe (Join-Path $Root 'scripts\start.mjs') @args
exit $LASTEXITCODE
