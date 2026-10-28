param(
    [Parameter(Mandatory = $true)][string]$Cli,
    [Parameter(Mandatory = $true)][string]$AffectedCodex,
    [Parameter(Mandatory = $true)][string]$AcceptanceDirectory,
    [string]$CompatibleCodex
)
# Real native regression acceptance. No model, credentials or daily Host needed.
$ErrorActionPreference = 'Stop'
$Cli = (Resolve-Path -LiteralPath $Cli).Path
$AffectedCodex = (Resolve-Path -LiteralPath $AffectedCodex).Path
$directory = [IO.Path]::GetFullPath($AcceptanceDirectory)
$savedDirectory = $env:AGENTDECK_DATA_DIR
$originalHash = (Get-FileHash -LiteralPath $AffectedCodex -Algorithm SHA256).Hash
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'compatible-windows.json') -Raw | ConvertFrom-Json
try {
    $env:AGENTDECK_DATA_DIR = $directory
    $first = & $Cli runtime-check --codex-exe $AffectedCodex | Out-String
    if ($LASTEXITCODE -ne 0) { throw 'Affected runtime did not recover automatically.' }
    $result = $first | ConvertFrom-Json
    if ($result.version -ne $manifest.version -or -not $result.verification.passed -or -not $result.verification.instructionLoading) { throw 'Missing native compatibility proof.' }
    if ($result.executable -eq $AffectedCodex) { throw 'Affected runtime was incorrectly accepted.' }
    if (-not $result.officialPrecompiled) { throw 'Missing official precompiled origin proof.' }
    $second = & $Cli runtime-check --codex-exe $AffectedCodex | Out-String
    if ($LASTEXITCODE -ne 0 -or ($second | ConvertFrom-Json).executable -ne $result.executable) { throw 'Official selection was not retained.' }
    # Corrupt only an isolated downloaded resource, then restore it exactly.
    $packageDirectory = Split-Path (Split-Path $result.executable)
    $resource = $manifest.files | Where-Object { $_.path -notlike '*.exe' -and $_.path -notlike '*.dll' } | Select-Object -First 1
    if (-not $resource) { throw 'Missing resource for integrity regression check.' }
    $resourcePath = Join-Path $packageDirectory $resource.path
    $savedBytes = [IO.File]::ReadAllBytes($resourcePath)
    try {
        [IO.File]::AppendAllText($resourcePath, 'integrity-regression-check')
        $failure = & $Cli runtime-check --codex-exe $AffectedCodex 2>&1 | Out-String
        if ($LASTEXITCODE -eq 0 -or $failure -notmatch 'RUNTIME_INTEGRITY_ERROR') { throw 'Corrupted runtime was accepted.' }
    } finally {
        [IO.File]::WriteAllBytes($resourcePath, $savedBytes)
    }
    if ($CompatibleCodex) {
        $good = & $Cli runtime-check --codex-exe $CompatibleCodex | Out-String
        if ($LASTEXITCODE -ne 0 -or ($good | ConvertFrom-Json).executable -ne (Resolve-Path -LiteralPath $CompatibleCodex).Path) { throw 'An official allowlisted runtime was replaced.' }
    }
    if ((Get-FileHash -LiteralPath $AffectedCodex -Algorithm SHA256).Hash -ne $originalHash) { throw 'Original Codex was modified.' }
    Write-Output 'PASS: real upstream regression recovery, instruction loading, filesystem boundaries, retained selection, corrupt-resource rejection and original executable preserved; no model request.'
} finally {
    $env:AGENTDECK_DATA_DIR = $savedDirectory
}
