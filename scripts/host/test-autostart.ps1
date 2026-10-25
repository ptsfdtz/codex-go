param([Parameter(Mandatory=$true)][string]$Cli)
$ErrorActionPreference = 'Stop'
$Cli = (Resolve-Path -LiteralPath $Cli).Path
$previousData = $env:AGENTDECK_DATA_DIR
$previousName = $env:AGENTDECK_AUTOSTART_NAME
$entryName = 'AgentDeck Host Acceptance ' + [guid]::NewGuid().ToString('N')
$testDirectory = Join-Path ([IO.Path]::GetTempPath()) ('agentdeck-autostart-' + [guid]::NewGuid().ToString('N') + ' state')
$registryPath = 'HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run'
$env:AGENTDECK_DATA_DIR = $testDirectory
$env:AGENTDECK_AUTOSTART_NAME = $entryName
try {
    & $Cli autostart enable
    if ($LASTEXITCODE -ne 0) { throw 'Could not save isolated logon startup entry.' }
    $command = [Microsoft.Win32.Registry]::GetValue($registryPath, $entryName, $null)
    if (-not $command -or -not $command.Contains($testDirectory) -or $command -notmatch '^"([^"]+agentdeck-service.exe)" (.*)$') { throw 'Startup entry lost its executable or state directory.' }
    Start-Process -FilePath $Matches[1] -ArgumentList $Matches[2] -WindowStyle Hidden
    $until = [DateTime]::UtcNow.AddSeconds(20)
    do {
        Start-Sleep -Milliseconds 200
        $state = (& $Cli status --json | Out-String | ConvertFrom-Json)
    } while (-not $state.running -and [DateTime]::UtcNow -lt $until)
    # MSIX may canonicalize LOCALAPPDATA into its private redirect. Compare the
    # generated certificate through both paths instead of assuming string identity.
    if (-not $state.running -or -not $state.dataDir -or
        (Get-FileHash -LiteralPath (Join-Path $state.dataDir 'tls.dpapi')).Hash -ne
        (Get-FileHash -LiteralPath (Join-Path $testDirectory 'tls.dpapi')).Hash) {
        throw "Logon command did not start: running=$($state.running), expected=$testDirectory, actual=$($state.dataDir)"
    }
    & $Cli stop
    if ($LASTEXITCODE -ne 0) { throw 'Scheduled host did not stop.' }
    & $Cli autostart disable
    if ($LASTEXITCODE -ne 0 -or [Microsoft.Win32.Registry]::GetValue($registryPath, $entryName, $null)) { throw 'Isolated startup entry was not removed.' }
    Write-Output 'PASS: user logon entry, explicit state path with spaces, real hidden launch, stop and removal. Actual Windows logon remains a manual check.'
} finally {
    & $Cli stop | Out-Null
    & $Cli autostart disable | Out-Null
    $env:AGENTDECK_DATA_DIR = $previousData
    $env:AGENTDECK_AUTOSTART_NAME = $previousName
}
