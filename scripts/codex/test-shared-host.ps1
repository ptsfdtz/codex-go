param(
    [Parameter(Mandatory = $true)][string]$CodexExe
)
# Explicit isolated native acceptance. Does not configure or restart a user Host.
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$native = (Resolve-Path -LiteralPath $CodexExe).Path
$savedProbe = $env:AGENTDECK_DESKTOP_PROBE_EXE
$savedTemp = $env:TEMP
$savedTmp = $env:TMP
$savedTarget = $env:CARGO_TARGET_DIR
Push-Location $repo
try {
    # Workspace executables can carry a low-integrity label on Windows. Build
    # in a normal user directory so the test parent can start native MXC; never
    # remove integrity checks or edit ACLs on the user's project.
    $acceptanceRoot = Join-Path $env:LOCALAPPDATA 'AgentDeck/shared-host-acceptance'
    $probeTemp = Join-Path $acceptanceRoot 'temp'
    New-Item -ItemType Directory -Path $probeTemp -Force | Out-Null
    $env:TEMP = $probeTemp
    $env:TMP = $probeTemp
    $env:CARGO_TARGET_DIR = Join-Path $acceptanceRoot 'target'
    $env:AGENTDECK_DESKTOP_PROBE_EXE = $native
    & cargo test --locked --manifest-path desktop/core/Cargo.toml --test runtime_websocket real_desktop_baseline_ -- --ignored --nocapture --test-threads=1
    if ($LASTEXITCODE -ne 0) { throw 'Shared Host acceptance failed; preserve the native sandbox checks and inspect the error above.' }
    Write-Output 'PASS: isolated native Host contracts, original history, continuation, steering and recovery. The installed Host configuration is unchanged.'
} finally {
    $env:AGENTDECK_DESKTOP_PROBE_EXE = $savedProbe
    $env:TEMP = $savedTemp
    $env:TMP = $savedTmp
    $env:CARGO_TARGET_DIR = $savedTarget
    Pop-Location
}
