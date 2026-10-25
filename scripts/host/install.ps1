param(
    [string]$Origin = 'https://agent.ptsfdtz.top',
    [string]$Version = '',
    [string]$InstallDir = '',
    [switch]$Autostart,
    [switch]$NoPath
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if (-not $env:LOCALAPPDATA) { throw 'Install this script as a regular Windows user.' }
$downloadOrigin = [Uri]$Origin
if ($downloadOrigin.Scheme -ne 'https' -or $downloadOrigin.UserInfo -or $downloadOrigin.Query -or $downloadOrigin.Fragment -or $downloadOrigin.AbsolutePath -ne '/') { throw 'Origin must be an HTTPS origin without a path or credentials.' }
$Origin = $Origin.TrimEnd('/')
$arch = [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITEW6432')
if (-not $arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
if ($arch -ne 'AMD64') { throw "No verified Windows release is available for architecture $arch." }
if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\AgentDeck' }
$InstallDir = [IO.Path]::GetFullPath($InstallDir)
if (-not $Version) { $Version = ([string](Invoke-RestMethod -Uri "$Origin/releases/stable.txt")).Trim() }
if ($Version -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$' -or $Version.Contains('..')) { throw 'Invalid release version.' }
$package = 'agentdeck-windows-x64.zip'
$releaseUrl = "$Origin/releases/$Version/$package"
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ('agentdeck-install-' + [guid]::NewGuid().ToString('N'))
$releaseRoot = Join-Path $InstallDir "versions\$Version"
$bin = Join-Path $InstallDir 'bin'
New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
try {
    $archive = Join-Path $temporaryRoot $package
    Invoke-WebRequest -UseBasicParsing -Uri $releaseUrl -OutFile $archive -TimeoutSec 900
    $expected = ([string](Invoke-RestMethod -Uri "$releaseUrl.sha256")).Trim()
    if ($expected -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ine $expected) { throw 'Download integrity check failed; installed files were not changed.' }
    $staging = Join-Path $temporaryRoot 'package'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($archive, $staging)
    foreach ($name in @('agentdeck.exe', 'agentdeck-service.exe', 'start.ps1')) {
        if (-not (Test-Path -LiteralPath (Join-Path $staging $name) -PathType Leaf)) { throw "Release is missing $name." }
    }
    # Version directories avoid overwriting a running executable. Keep older versions for rollback.
    if (-not (Test-Path -LiteralPath $releaseRoot)) {
        New-Item -ItemType Directory -Path (Split-Path $releaseRoot) -Force | Out-Null
        Move-Item -LiteralPath $staging -Destination $releaseRoot
    } else {
        foreach ($name in @('agentdeck.exe', 'agentdeck-service.exe')) {
            if ((Get-FileHash -LiteralPath (Join-Path $releaseRoot $name)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $staging $name)).Hash) { throw 'Existing release directory has different binaries; it was left untouched.' }
        }
    }
    $cli = Join-Path $releaseRoot 'agentdeck.exe'
    & $cli --version
    if ($LASTEXITCODE -ne 0) { throw 'Downloaded CLI could not run.' }
    $enabled = ((& $cli autostart status | Out-String).Trim().StartsWith('enabled'))
    New-Item -ItemType Directory -Path $bin -Force | Out-Null
    # cmd expands % even inside quotes; reject unusual installation paths rather than misroute commands.
    if ($cli.Contains('%') -or $cli.Contains('"') -or $cli.Contains("`n")) { throw 'Installation path contains unsupported command characters.' }
    $shim = "@echo off`r`n`"$cli`" %*`r`nexit /b %errorlevel%`r`n"
    $shimFile = Join-Path $bin ('agentdeck-' + [guid]::NewGuid().ToString('N') + '.cmd')
    [IO.File]::WriteAllText($shimFile, $shim, [Text.Encoding]::Default)
    Move-Item -LiteralPath $shimFile -Destination (Join-Path $bin 'agentdeck.cmd') -Force
    if (-not $NoPath) {
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        if (($userPath -split ';') -notcontains $bin) { [Environment]::SetEnvironmentVariable('Path', ($bin + ';' + $userPath), 'User') }
        if (($env:Path -split ';') -notcontains $bin) { $env:Path = $bin + ';' + $env:Path }
    }
    if ($Autostart -or $enabled) {
        & $cli autostart enable
        if ($LASTEXITCODE -ne 0) { throw 'Installed, but automatic startup could not be configured.' }
    }
    Write-Output "Installed AgentDeck Host $Version. Account and project data are preserved."
    Write-Output 'Next: agentdeck login --username NAME; agentdeck projects add PATH; agentdeck start; agentdeck autostart enable'
    Write-Output 'Open a new terminal if agentdeck is not found. An already running host keeps its current version until agentdeck restart.'
} finally {
    # Both paths are fixed descendants of this invocation's unique temporary directory.
    $resolvedTemporary = [IO.Path]::GetFullPath($temporaryRoot)
    $temporaryParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolvedTemporary.StartsWith($temporaryParent, [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force -ErrorAction SilentlyContinue }
}
