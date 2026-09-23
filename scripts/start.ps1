$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. (Join-Path $PSScriptRoot 'windows-paths.ps1')

$Node = Resolve-NodeTool -Name 'node.exe'
if ($null -eq $Node) {
  throw 'Node.js is not installed. Run .\scripts\bootstrap.ps1 first.'
}
$NodeDirectory = Split-Path -Parent $Node
$Npm = Resolve-ExecutablePath @(Join-Path $NodeDirectory 'npm.cmd')
if ($null -eq $Npm) { $Npm = Resolve-NodeTool -Name 'npm.cmd' }
if ($null -eq $Npm) {
  throw 'npm was not found beside Node.js. Run .\scripts\bootstrap.ps1 first.'
}
$NpmGlobalBin = Get-NpmGlobalExecutableDirectory -NpmPath $Npm
$Pnpm = Resolve-ExecutablePath @(
  (Join-Path $NpmGlobalBin 'pnpm.cmd'),
  (Join-Path $NpmGlobalBin 'pnpm.exe')
)
if ($null -eq $Pnpm) {
  throw "pnpm was not found in npm's global executable directory: $NpmGlobalBin. Run .\scripts\bootstrap.ps1 first."
}
$env:Path = "$NpmGlobalBin;$NodeDirectory;$env:Path"

& $Node (Join-Path $Root 'scripts\start.mjs') @args
exit $LASTEXITCODE
