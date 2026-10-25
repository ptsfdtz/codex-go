param(
    [Parameter(Mandatory=$true)][string]$PackageDirectory,
    [string]$Origin = 'https://agent.ptsfdtz.top'
)
# Explicit real HTTPS acceptance with isolated account/project state and startup entry.
$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('agentdeck-update-test-' + [guid]::NewGuid().ToString('N'))
$release = Join-Path $root 'installation\versions\acceptance-local'
New-Item -ItemType Directory -Path $release -Force | Out-Null
Copy-Item -Path (Join-Path $PackageDirectory '*') -Destination $release
[IO.File]::WriteAllText((Join-Path $release 'release.txt'), 'acceptance-local')
$saved = @{}
foreach ($key in @('AGENTDECK_DATA_DIR','AGENTDECK_AUTOSTART_NAME','AGENTDECK_CODEX_EXE','AGENTDECK_DOWNLOAD_ORIGIN')) {
    $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
}
$env:AGENTDECK_DATA_DIR = Join-Path $root 'state'
$env:AGENTDECK_AUTOSTART_NAME = 'AgentDeck Update Test ' + [guid]::NewGuid().ToString('N')
$env:AGENTDECK_CODEX_EXE = Join-Path $root 'missing-codex.exe'
$env:AGENTDECK_DOWNLOAD_ORIGIN = $Origin
$cli = Join-Path $release 'agentdeck.exe'
$project = Join-Path $root 'project'
New-Item -ItemType Directory -Path $project | Out-Null
function Invoke-Cli([string[]]$Arguments) {
    $result = & $cli @Arguments
    if ($LASTEXITCODE -ne 0) { throw "CLI failed: $Arguments" }
    return $result
}
try {
    Invoke-Cli -Arguments @('start') | Out-Null
    Invoke-Cli -Arguments @('projects','add',$project) | Out-Null
    $before = Invoke-Cli -Arguments @('status','--json') | Out-String | ConvertFrom-Json
    $certificate = (Get-FileHash -LiteralPath (Join-Path $env:AGENTDECK_DATA_DIR 'tls.dpapi')).Hash
    Invoke-Cli -Arguments @('update','--check')
    Invoke-Cli -Arguments @('update')
    $after = Invoke-Cli -Arguments @('status','--json') | Out-String | ConvertFrom-Json
    if (-not $after.running -or $before.hostId -ne $after.hostId -or $before.servicePid -ne $after.servicePid -or $after.projects.Count -ne 1) { throw 'Update changed the running service or persistent state' }
    if ($certificate -ne (Get-FileHash -LiteralPath (Join-Path $env:AGENTDECK_DATA_DIR 'tls.dpapi')).Hash) { throw 'Update replaced the computer certificate' }
    $shim = Join-Path $root 'installation\bin\agentdeck.cmd'
    & $shim --version
    if ($LASTEXITCODE -ne 0) { throw 'Updated command entry could not run' }
    $stable = (Invoke-RestMethod "$Origin/releases/stable.txt").Trim()
    if ((Get-Content (Join-Path $root "installation\versions\$stable\release.txt") -Raw).Trim() -ne $stable) { throw 'Installed release marker does not match stable' }
    Write-Output 'PASS: real HTTPS update/check, checksum installer, isolated installation, running service PID, identity, certificate and authorized project preserved.'
} finally {
    & $cli stop | Out-Null
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process') }
    Write-Output "Acceptance files retained at $root"
}
