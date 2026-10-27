$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$nodeVersion = (Get-Content (Join-Path $repositoryRoot ".node-version") -Raw).Trim()
$toolRoot = Join-Path $env:LOCALAPPDATA "AgentDeck\tools"
New-Item -ItemType Directory -Path $toolRoot -Force | Out-Null

function Add-UserPath([string]$Path) {
    $userPaths = @([Environment]::GetEnvironmentVariable("Path", "User") -split ";" | Where-Object { $_ })
    if ($userPaths -notcontains $Path) {
        $userPaths += $Path
        [Environment]::SetEnvironmentVariable("Path", ($userPaths -join ";"), "User")
    }
    if (($env:Path -split ";") -notcontains $Path) {
        $env:Path = "$Path;$env:Path"
    }
}

function Download-File([string]$Url, [string]$Destination) {
    Invoke-WebRequest -Uri $Url -OutFile $Destination
    if (-not (Test-Path $Destination)) { throw "Download did not create $Destination." }
}

$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
$buildTools = if (Test-Path $vswhere) {
    & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
}
$windowsSdk = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\Include"
if (-not $buildTools -or -not (Test-Path (Join-Path $windowsSdk "10.0.26100.0"))) {
    throw "Install Visual Studio 2022 Build Tools with C++ x64/x86 tools and Windows 11 SDK 10.0.26100.0."
}

$fnmRoot = Join-Path $toolRoot "fnm"
$fnm = Join-Path $fnmRoot "fnm.exe"
if (-not (Test-Path $fnm)) {
    $temporaryRoot = Join-Path $env:TEMP ([guid]::NewGuid().ToString("N"))
    $archivePath = Join-Path $temporaryRoot "fnm-windows.zip"
    $extractRoot = Join-Path $temporaryRoot "extract"
    New-Item -ItemType Directory -Path $temporaryRoot, $extractRoot -Force | Out-Null
    try {
        Download-File "https://github.com/Schniz/fnm/releases/download/v1.39.0/fnm-windows.zip" $archivePath
        Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot
        $fnmBinary = Get-ChildItem $extractRoot -Filter "fnm.exe" -Recurse | Select-Object -First 1
        if (-not $fnmBinary) { throw "fnm.exe was not present in the downloaded archive." }
        New-Item -ItemType Directory -Path $fnmRoot -Force | Out-Null
        Copy-Item -LiteralPath $fnmBinary.FullName -Destination $fnm
    } finally {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
Add-UserPath $fnmRoot
$nodeMirror = if ($env:AGENTDECK_NODE_DIST_MIRROR) { $env:AGENTDECK_NODE_DIST_MIRROR } else { "https://nodejs.org/dist" }
& $fnm install $nodeVersion --node-dist-mirror $nodeMirror --log-level error
if ($LASTEXITCODE -ne 0 -and -not $env:AGENTDECK_NODE_DIST_MIRROR) {
    & $fnm install $nodeVersion --node-dist-mirror "https://npmmirror.com/mirrors/node" --log-level error
}
if ($LASTEXITCODE -ne 0) { throw "fnm could not install Node.js 22.22.3 from the configured Node distribution mirrors." }
(& $fnm env --shell powershell --use-on-cd | Out-String) | Invoke-Expression
& $fnm use $nodeVersion
if ($LASTEXITCODE -ne 0) { throw "fnm could not activate Node.js 22.22.3." }
$nodeBin = $env:FNM_MULTISHELL_PATH
if ($nodeBin -and (Test-Path (Join-Path $nodeBin "node.exe"))) { $env:PATH = "$nodeBin;$env:PATH" }

$rustupPath = Join-Path $env:USERPROFILE ".cargo\bin\rustup.exe"
if (-not (Test-Path $rustupPath)) {
    $temporaryRoot = Join-Path $env:TEMP ([guid]::NewGuid().ToString("N"))
    $rustupInstaller = Join-Path $temporaryRoot "rustup-init.exe"
    New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
    try {
        Download-File "https://static.rust-lang.org/rustup/archive/1.29.1/x86_64-pc-windows-msvc/rustup-init.exe" $rustupInstaller
        & $rustupInstaller -y --default-host x86_64-pc-windows-msvc --default-toolchain none --profile minimal
        if ($LASTEXITCODE -ne 0) { throw "Rustup installation failed." }
    } finally {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
Add-UserPath (Join-Path $env:USERPROFILE ".cargo\bin")
& $rustupPath toolchain install stable-x86_64-pc-windows-msvc --profile minimal --component clippy --component rustfmt
if ($LASTEXITCODE -ne 0) { throw "Rust MSVC toolchain installation failed." }

$documentsPath = [Environment]::GetFolderPath("MyDocuments")
$profilePaths = @(
    $PROFILE.CurrentUserAllHosts,
    (Join-Path $documentsPath "PowerShell\profile.ps1"),
    (Join-Path $documentsPath "WindowsPowerShell\profile.ps1")
) | Select-Object -Unique
$profileBlock = @(
    "# AgentDeck development environment",
    '$env:PATH = "$env:LOCALAPPDATA\AgentDeck\tools\fnm;$env:PATH"',
    '$env:FNM_VERSION_FILE_STRATEGY = "recursive"',
    '& "$env:LOCALAPPDATA\AgentDeck\tools\fnm\fnm.exe" env --use-on-cd --shell powershell | Out-String | Invoke-Expression',
    'function global:Set-FnmOnLoad {',
    '    & "$env:LOCALAPPDATA\AgentDeck\tools\fnm\fnm.exe" use --silent-if-unchanged | Out-Null',
    '    $nodeVersionDirectory = Get-Item (Get-Location)',
    '    while ($nodeVersionDirectory -and -not (Test-Path (Join-Path $nodeVersionDirectory.FullName ".node-version"))) { $nodeVersionDirectory = $nodeVersionDirectory.Parent }',
    '    $oldNodeBin = $env:AGENTDECK_NODE_BIN',
    '    if ($oldNodeBin) { $env:PATH = (($env:PATH -split ";") | Where-Object { $_ -and $_ -ne $oldNodeBin }) -join ";" }',
    '    if ($nodeVersionDirectory) {',
    '        $nodeVersion = (Get-Content (Join-Path $nodeVersionDirectory.FullName ".node-version") -Raw).Trim()',
    '        $nodeStore = if ($env:FNM_DIR) { $env:FNM_DIR } else { Join-Path $env:APPDATA "fnm" }',
    '        $nodeBin = Join-Path $nodeStore "node-versions\v$nodeVersion\installation"',
    '        if (Test-Path (Join-Path $nodeBin "node.exe")) { $env:AGENTDECK_NODE_BIN = $nodeBin; $env:PATH = "$nodeBin;$env:PATH" } else { Remove-Item Env:AGENTDECK_NODE_BIN -ErrorAction SilentlyContinue }',
    '    } else { Remove-Item Env:AGENTDECK_NODE_BIN -ErrorAction SilentlyContinue }',
    '}',
    'Set-FnmOnLoad',
    '$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"',
    'function global:pnpm { & "$env:APPDATA\npm\pnpm.cmd" @args }',
    "# End AgentDeck development environment"
) -join [Environment]::NewLine
foreach ($profilePath in $profilePaths) {
    if (-not (Test-Path $profilePath)) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $profilePath) -Force | Out-Null
        New-Item -ItemType File -Path $profilePath -Force | Out-Null
    }
    $profileContents = if ((Get-Item -LiteralPath $profilePath).Length -gt 0) {
        Get-Content -LiteralPath $profilePath -Raw
    } else {
        ""
    }
    $profileMatch = [regex]::Match($profileContents, '(?s)# AgentDeck development environment\r?\n.*?# End AgentDeck development environment')
    if ($profileMatch.Success) {
        $profileContents = $profileContents.Substring(0, $profileMatch.Index) + $profileBlock + $profileContents.Substring($profileMatch.Index + $profileMatch.Length)
    } else {
        if ($profileContents -and -not $profileContents.EndsWith([Environment]::NewLine)) {
            $profileContents += [Environment]::NewLine
        }
        $profileContents += $profileBlock + [Environment]::NewLine
    }
    [IO.File]::WriteAllText($profilePath, $profileContents, [Text.UTF8Encoding]::new($false))
}

# Keep the pnpm shim independent of fnm's version-specific Corepack directory.
$npm = Get-Command npm.cmd -ErrorAction Stop
$packageManager = (Get-Content (Join-Path $repositoryRoot "package.json") -Raw | ConvertFrom-Json).packageManager
if ($packageManager -notmatch '^pnpm@\d+\.\d+\.\d+$') { throw "Expected an exact pnpm version in package.json." }
$pnpmShimDirectory = Join-Path $env:APPDATA "npm"
& $npm.Source install --global --prefix $pnpmShimDirectory $packageManager --force
if ($LASTEXITCODE -ne 0) { throw "Could not install the pinned pnpm command in the user directory." }
Add-UserPath $pnpmShimDirectory
$pnpmCommand = Join-Path $pnpmShimDirectory "pnpm.cmd"
& $pnpmCommand install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "pnpm dependency installation failed." }

Write-Host "Development environment is ready: Node 22.22.3, pnpm 12.3.4, Rust MSVC."
