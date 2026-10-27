$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$version = "0.159.2"
$packageUrl = "https://registry.npmjs.org/@openai/codex/-/codex-0.159.2-win32-x64.tgz"
$expectedIntegrity = "sha512-1ZJVTO40/ZaHPUUWc3uCX73jwzJRaDxAjRQEf37dC5Q3h1fp/Z7+1L8oX3bPlXgjhEY6kHW3rm0wz2sdQ5rxNw=="
$runtimeInArchive = "package/vendor/x86_64-pc-windows-msvc"

if (-not $env:LOCALAPPDATA) { throw "LOCALAPPDATA is unavailable for the current Windows user." }
if (-not [Environment]::Is64BitOperatingSystem) { throw "The supported Codex package requires 64-bit Windows." }

# Reuse a supported native runtime before downloading our verified fallback.
# Never execute command shims: npm's native binary is resolved from its layout.
function Get-CompatibleCodexVersion([string]$Binary) {
    if (-not (Test-Path -LiteralPath $Binary -PathType Leaf)) { return $null }
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo.FileName = $Binary
    $process.StartInfo.Arguments = '--version'
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    try {
        if (-not $process.Start()) { return $null }
        $outputTask = $process.StandardOutput.ReadToEndAsync()
        $errorTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(15000)) { $process.Kill(); return $null }
        $output = $outputTask.GetAwaiter().GetResult().Trim()
        $null = $errorTask.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { return $null }
        if ($output -notmatch '^codex-cli ((0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?)$') { return $null }
        $reported = $Matches[1]
        $numeric = [version]($Matches[2] + '.' + $Matches[3] + '.' + $Matches[4])
        $prerelease = $Matches[5]
        $minimum = [version]$version
        if ($numeric -lt $minimum -or ($numeric -eq $minimum -and $prerelease)) { return $null }
        return $reported
    } catch { return $null } finally { $process.Dispose() }
}

$candidates = @()
if ($env:AGENTDECK_CODEX_EXE) {
    $explicitVersion = Get-CompatibleCodexVersion $env:AGENTDECK_CODEX_EXE
    if (-not $explicitVersion) { throw "AGENTDECK_CODEX_EXE must point to a native Codex >= $version. No runtime was installed." }
    Write-Output "Reusing Codex CLI $explicitVersion at $env:AGENTDECK_CODEX_EXE. No additional version was installed."
    exit 0
}
foreach ($command in @(Get-Command codex,codex.exe -All -ErrorAction SilentlyContinue)) {
    if (-not $command.Path) { continue }
    if ([IO.Path]::GetExtension($command.Path) -ieq '.exe') { $candidates += $command.Path }
    $candidates += Join-Path (Split-Path $command.Path) 'node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe'
}
foreach ($directory in @(Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin') -Directory -ErrorAction SilentlyContinue)) {
    $candidates += Join-Path $directory.FullName 'codex.exe'
}
$toolsRoot = Join-Path $env:LOCALAPPDATA "AgentDeck\tools\codex-cli"
foreach ($directory in @(Get-ChildItem -LiteralPath $toolsRoot -Directory -ErrorAction SilentlyContinue)) {
    # Leave incomplete legacy copies to the repair path below.
    if (-not (Test-Path -LiteralPath (Join-Path $directory.FullName 'codex-resources\codex-command-runner.exe'))) { continue }
    $candidates += Join-Path $directory.FullName 'bin\codex.exe'
    $candidates += Join-Path $directory.FullName 'codex.exe'
}
foreach ($candidate in @($candidates | Select-Object -Unique)) {
    $existingVersion = Get-CompatibleCodexVersion $candidate
    if ($existingVersion) {
        Write-Output "Reusing Codex CLI $existingVersion at $candidate. No additional version was installed."
        exit 0
    }
}

$installRoot = Join-Path $toolsRoot $version
$installBinary = Join-Path $installRoot "bin\codex.exe"
if (Test-Path $installBinary) {
    $installedVersion = (& $installBinary --version | Out-String).Trim()
    if ($installedVersion -eq "codex-cli $version" -and (Test-Path (Join-Path $installRoot "codex-resources\codex-command-runner.exe"))) {
        Write-Output "Codex CLI $version is already installed for AgentDeck."
        exit 0
    }
    if ($installedVersion -ne "codex-cli $version") {
        throw "An unverified file already exists at $installBinary. It was left untouched."
    }
}

$temporaryRoot = Join-Path $env:TEMP ([guid]::NewGuid().ToString("N"))
$stagingRoot = Join-Path $toolsRoot (".staging-" + [guid]::NewGuid().ToString("N"))
$archivePath = Join-Path $temporaryRoot "codex-win32-x64.tgz"
New-Item -ItemType Directory -Path $temporaryRoot, $stagingRoot -Force | Out-Null
try {
    Invoke-WebRequest -UseBasicParsing -Uri $packageUrl -OutFile $archivePath -TimeoutSec 900
    $sha512 = [System.Security.Cryptography.SHA512]::Create()
    try {
        $archive = [System.IO.File]::OpenRead($archivePath)
        try {
            $hashBytes = $sha512.ComputeHash($archive)
        } finally {
            $archive.Dispose()
        }
    } finally {
        $sha512.Dispose()
    }
    $actualIntegrity = "sha512-" + [Convert]::ToBase64String($hashBytes)
    if ($actualIntegrity -cne $expectedIntegrity) {
        throw "The downloaded npm package failed its SHA-512 integrity check."
    }

    $tar = Join-Path $env:SystemRoot "System32\tar.exe"
    if (-not (Test-Path $tar)) { throw "Windows tar.exe is unavailable; install Windows 10/11 updates and retry." }
    & $tar -xzf $archivePath -C $stagingRoot $runtimeInArchive
    if ($LASTEXITCODE -ne 0) { throw "Could not extract the verified Codex CLI package." }

    $runtime = Join-Path $stagingRoot ($runtimeInArchive.Replace("/", "\"))
    $binary = Join-Path $runtime "bin\codex.exe"
    if (-not (Test-Path $binary)) { throw "The verified package did not contain its Windows x64 executable." }
    # Keep the official relative layout: the executable also needs its helpers.
    $stagedBinary = $binary

    $installedVersion = (& $stagedBinary --version | Out-String).Trim()
    if ($installedVersion -ne "codex-cli $version") {
        throw "The downloaded executable reported an unexpected version: $installedVersion"
    }

    # Repair older installs that extracted only codex.exe without replacing a running binary.
    New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
    Copy-Item -Path (Join-Path $runtime "*") -Destination $installRoot -Recurse -Force
    Write-Output "Installed Codex CLI $version for AgentDeck at $installBinary."
} finally {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
}
