function Get-StandardNodeDirectories {
  $Directories = @()

  if ($env:ProgramFiles) {
    $Directories += Join-Path $env:ProgramFiles 'nodejs'
  }
  if (${env:ProgramFiles(x86)}) {
    $Directories += Join-Path ${env:ProgramFiles(x86)} 'nodejs'
  }
  if ($env:LOCALAPPDATA) {
    $Directories += Join-Path $env:LOCALAPPDATA 'Programs\nodejs'
  }

  return $Directories | Select-Object -Unique
}

function Resolve-ExecutablePath([string[]]$Candidates) {
  foreach ($Candidate in $Candidates) {
    if ([string]::IsNullOrWhiteSpace($Candidate)) { continue }
    if (Test-Path -LiteralPath $Candidate -PathType Leaf) {
      return [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Candidate).Path)
    }
  }
  return $null
}

function Resolve-NodeTool {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [switch]$KnownOnly
  )

  # In a normal invocation, respect the user's active Node selection first. This
  # matters for nvm, Volta and other version managers: a machine can have an old
  # system Node beside a newer version deliberately placed on PATH.
  if (-not $KnownOnly) {
    $Command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -ne $Command) {
      $CommandPath = if ($Command.Source) { $Command.Source } else { $Command.Path }
      $PathResult = Resolve-ExecutablePath @($CommandPath)
      if ($null -ne $PathResult) { return $PathResult }
    }
  }

  # The known locations are the fallback for a freshly installed Node whose
  # installer updated the machine but not this already-running PowerShell.
  $KnownCandidates = foreach ($Directory in Get-StandardNodeDirectories) {
    Join-Path $Directory $Name
  }
  return Resolve-ExecutablePath $KnownCandidates
}

function Resolve-UvTool {
  param([switch]$KnownOnly)

  $Candidates = @()
  if ($env:USERPROFILE) {
    $Candidates += Join-Path $env:USERPROFILE '.local\bin\uv.exe'
  }
  if ($env:LOCALAPPDATA) {
    $Candidates += Join-Path $env:LOCALAPPDATA 'uv\uv.exe'
  }
  $KnownPath = Resolve-ExecutablePath $Candidates
  if ($null -ne $KnownPath) { return $KnownPath }
  if ($KnownOnly) { return $null }

  $Command = Get-Command uv.exe, uv -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $Command) { return $null }
  $CommandPath = if ($Command.Source) { $Command.Source } else { $Command.Path }
  return Resolve-ExecutablePath @($CommandPath)
}

function Get-NpmGlobalExecutableDirectory {
  param(
    [Parameter(Mandatory = $true)]
    [string]$NpmPath
  )

  $Prefix = (& $NpmPath 'prefix' '-g' 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($Prefix)) {
    throw "Could not resolve npm's global prefix using $NpmPath."
  }

  if (-not [IO.Path]::IsPathRooted($Prefix)) {
    throw "npm returned a non-absolute global prefix: $Prefix"
  }
  return [IO.Path]::GetFullPath($Prefix)
}
