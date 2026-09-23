$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$PnpmVersion = '11.22.0'
$MinimumNodeVersion = [Version]'24.0.0'
$MinimumUvVersion = [Version]'0.12.0'

function Write-Step([string]$Message) {
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Get-ToolPath([string[]]$Names) {
  foreach ($Name in $Names) {
    $Command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -ne $Command) { return $Command.Source }
  }
  return $null
}

function Get-Version([string]$Text) {
  $Match = [regex]::Match($Text, '(?<![0-9])([0-9]+)\.([0-9]+)\.([0-9]+)(?![0-9])')
  if (-not $Match.Success) { return $null }
  return [Version]::new([int]$Match.Groups[1].Value, [int]$Match.Groups[2].Value, [int]$Match.Groups[3].Value)
}

function Invoke-Required([string]$Command, [string[]]$Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE`: $Command $($Arguments -join ' ')"
  }
}

function Test-CommandVersion([string]$Command, [Version]$Minimum) {
  try {
    $Output = (& $Command --version 2>&1 | Out-String)
    $Version = Get-Version $Output
    return $null -ne $Version -and $Version -ge $Minimum
  } catch {
    return $false
  }
}

Write-Step 'Checking Node.js 24 LTS'
$Node = Get-ToolPath @('node.exe', 'node')
if ($null -eq $Node -or -not (Test-CommandVersion $Node $MinimumNodeVersion)) {
  $Winget = Get-ToolPath @('winget.exe', 'winget')
  if ($null -eq $Winget) {
    throw 'Node.js 24 LTS is required. Install it from https://nodejs.org/ or install winget, then rerun this script.'
  }
  Write-Host 'Node.js 24 LTS is missing or too old; installing it with winget.'
  Invoke-Required $Winget @('install', '--id', 'OpenJS.NodeJS.LTS', '--exact', '--accept-source-agreements', '--accept-package-agreements')
  $NodeBin = Join-Path ${env:ProgramFiles} 'nodejs'
  if (Test-Path $NodeBin) { $env:Path = "$NodeBin;$env:Path" }
  $Node = Get-ToolPath @('node.exe', 'node')
  if ($null -eq $Node) { throw 'Node.js was installed but is not available in this PowerShell process. Open a new terminal and rerun bootstrap.' }
}

Write-Step "Ensuring pnpm $PnpmVersion"
$Pnpm = Get-ToolPath @('pnpm.cmd', 'pnpm.exe', 'pnpm')
$PnpmOutput = if ($null -ne $Pnpm) { (& $Pnpm --version 2>&1 | Out-String).Trim() } else { '' }
if ($PnpmOutput -ne $PnpmVersion) {
  $Npm = Get-ToolPath @('npm.cmd', 'npm.exe', 'npm')
  if ($null -eq $Npm) { throw 'npm is unavailable after installing Node.js.' }
  Invoke-Required $Npm @('install', '--global', "pnpm@$PnpmVersion")
}
$Pnpm = Get-ToolPath @('pnpm.cmd', 'pnpm.exe', 'pnpm')
if ($null -eq $Pnpm) { throw 'pnpm was installed but is not available in this PowerShell process.' }

Write-Step 'Ensuring uv 0.12 or newer'
$Uv = Get-ToolPath @('uv.exe', 'uv')
if ($null -eq $Uv -or -not (Test-CommandVersion $Uv $MinimumUvVersion)) {
  Write-Host 'Installing/updating uv with the official installer.'
  $Installer = 'irm https://astral.sh/uv/install.ps1 | iex'
  Invoke-Required 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $Installer)
  $UvBin = Join-Path $env:USERPROFILE '.local\bin'
  if (Test-Path $UvBin) { $env:Path = "$UvBin;$env:Path" }
  $Uv = Get-ToolPath @('uv.exe', 'uv')
  if ($null -eq $Uv) { throw 'uv was installed but is not available in this PowerShell process. Open a new terminal and rerun bootstrap.' }
}

Write-Step 'Creating the project-local Python 3.12 environment'
Push-Location $Root
try {
  Invoke-Required $Uv @('python', 'install', '3.12')
  Invoke-Required $Uv @('venv', '--python', '3.12', 'services/symbolic/.venv')
  $VenvPython = Join-Path $Root 'services\symbolic\.venv\Scripts\python.exe'
  Invoke-Required $Uv @('pip', 'install', '--python', $VenvPython, '-r', 'services/symbolic/requirements.txt')

  Write-Step 'Installing JavaScript dependencies'
  Invoke-Required $Pnpm @('install', '--frozen-lockfile')

  Write-Step 'Checking the completed environment'
  Invoke-Required $Node @('scripts/doctor.mjs')
} finally {
  Pop-Location
}

Write-Host "`nBootstrap complete. Start the app with .\scripts\start.ps1" -ForegroundColor Green
