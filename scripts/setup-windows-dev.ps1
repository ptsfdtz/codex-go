$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repositoryRoot = Split-Path -Parent $PSScriptRoot
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

$webView = Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\*" -ErrorAction SilentlyContinue |
    Where-Object { $_.name -eq "Microsoft Edge WebView2 Runtime" } |
    Select-Object -First 1
if (-not $webView) { throw "Install the Microsoft Edge WebView2 Runtime before developing the desktop app." }

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

$jdkRoot = Join-Path $toolRoot "jdk-21"
$java = Get-ChildItem $jdkRoot -Filter "java.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $java) {
    $temporaryRoot = Join-Path $env:TEMP ([guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
    try {
        winget download --id EclipseAdoptium.Temurin.21.JDK --exact --architecture x64 --accept-source-agreements --accept-package-agreements --disable-interactivity --download-directory $temporaryRoot --skip-dependencies
        if ($LASTEXITCODE -ne 0) { throw "winget could not download the Temurin JDK 21 installer." }
        $jdkInstaller = Get-ChildItem $temporaryRoot -Filter "*.msi" -Recurse | Select-Object -First 1
        if (-not $jdkInstaller) { throw "The downloaded Temurin package did not contain an MSI installer." }
        & "$env:SystemRoot\System32\msiexec.exe" /a $jdkInstaller.FullName /qn "TARGETDIR=$jdkRoot"
        if ($LASTEXITCODE -ne 0) { throw "The JDK installer could not be extracted under the current user's profile." }
    } finally {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
$java = Get-ChildItem $jdkRoot -Filter "java.exe" -Recurse | Select-Object -First 1
if (-not $java) { throw "The extracted Temurin package does not contain java.exe." }
$javaHome = Split-Path -Parent (Split-Path -Parent $java.FullName)
$javaVersion = (& $java.FullName -version 2>&1 | Out-String)
if ($javaVersion -notmatch 'version "21\.') { throw "The extracted Java runtime is not JDK 21." }
$env:JAVA_HOME = $javaHome
[Environment]::SetEnvironmentVariable("JAVA_HOME", $javaHome, "User")
Add-UserPath (Join-Path $javaHome "bin")

$sdkRoot = if ($env:ANDROID_HOME) {
    $env:ANDROID_HOME
} elseif ($env:ANDROID_SDK_ROOT) {
    $env:ANDROID_SDK_ROOT
} else {
    Join-Path $env:LOCALAPPDATA "Android\Sdk"
}
$sdkManager = Join-Path $sdkRoot "cmdline-tools\latest\bin\sdkmanager.bat"
if (-not (Test-Path $sdkManager)) {
    $toolsRoot = Join-Path $sdkRoot "cmdline-tools"
    $latestTools = Join-Path $toolsRoot "latest"
    if (Test-Path $latestTools) {
        throw "Android command-line tools are incomplete at $latestTools; repair that directory, then rerun setup."
    }

    $temporaryRoot = Join-Path $env:TEMP ([guid]::NewGuid().ToString("N"))
    $archivePath = Join-Path $temporaryRoot "android-command-line-tools.zip"
    $extractRoot = Join-Path $temporaryRoot "extract"
    New-Item -ItemType Directory -Path $temporaryRoot, $extractRoot -Force | Out-Null
    try {
        $repository = [xml](Invoke-WebRequest "https://dl.google.com/android/repository/repository2-1.xml").Content
        $package = $repository.GetElementsByTagName("remotePackage") |
            Where-Object { $_.GetAttribute("path") -eq "cmdline-tools;latest" } |
            Select-Object -First 1
        if (-not $package) { throw "Google did not list Android command-line tools." }
        $archive = $package.GetElementsByTagName("archive") |
            Where-Object {
                ($_.GetElementsByTagName("host-os") | Select-Object -First 1).InnerText -eq "windows"
            } |
            Select-Object -First 1
        $archiveName = ($archive.GetElementsByTagName("url") | Select-Object -First 1).InnerText
        if (-not $archiveName) { throw "Google did not list a Windows command-line tools archive." }

        Download-File "https://dl.google.com/android/repository/$archiveName" $archivePath
        Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot
        New-Item -ItemType Directory -Path $toolsRoot -Force | Out-Null
        Move-Item -LiteralPath (Join-Path $extractRoot "cmdline-tools") -Destination $latestTools
    } finally {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
[Environment]::SetEnvironmentVariable("ANDROID_HOME", $sdkRoot, "User")
[Environment]::SetEnvironmentVariable("ANDROID_SDK_ROOT", $sdkRoot, "User")
Add-UserPath (Join-Path $sdkRoot "platform-tools")

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
    ('$env:JAVA_HOME = "' + $javaHome + '"'),
    '$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"',
    '$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME',
    '$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"',
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

$androidCli = Join-Path $sdkRoot "cmdline-tools\latest\bin\android.exe"
if (-not (Test-Path $androidCli)) {
    & $sdkManager "--sdk_root=$sdkRoot" --list
    if ($LASTEXITCODE -ne 0) { throw "Android CLI bootstrap failed." }
}
& $androidCli "--sdk=$sdkRoot" sdk install "platform-tools" "platforms/android-36" "build-tools/36.0.0"
if ($LASTEXITCODE -ne 0) { throw "Android SDK 36 package installation failed." }
foreach ($requiredFile in @(
    (Join-Path $sdkRoot "platform-tools\adb.exe"),
    (Join-Path $sdkRoot "platforms\android-36\android.jar"),
    (Join-Path $sdkRoot "build-tools\36.0.0\aapt2.exe")
)) {
    if (-not (Test-Path $requiredFile)) { throw "Android SDK package file is missing: $requiredFile" }
}

$localProperties = Join-Path $repositoryRoot "android\local.properties"
$sdkPropertyPath = $sdkRoot.Replace("\", "/")
$escapedSdkPath = New-Object System.Text.StringBuilder
foreach ($character in $sdkPropertyPath.ToCharArray()) {
    if ([int]$character -gt 127) {
        [void]$escapedSdkPath.Append(("\u{0:X4}" -f [int]$character))
    } else {
        [void]$escapedSdkPath.Append($character)
    }
}
$localContents = if (Test-Path $localProperties) { Get-Content -LiteralPath $localProperties -Raw } else { "" }
$sdkLine = "sdk.dir=$escapedSdkPath"
$propertyMatch = [regex]::Match($localContents, '(?m)^[ \t]*sdk\.dir[ \t]*=.*$')
if ($propertyMatch.Success) {
    $localContents = $localContents.Substring(0, $propertyMatch.Index) + $sdkLine + $localContents.Substring($propertyMatch.Index + $propertyMatch.Length)
} else {
    if ($localContents -and -not $localContents.EndsWith([Environment]::NewLine)) {
        $localContents += [Environment]::NewLine
    }
    $localContents += $sdkLine + [Environment]::NewLine
}
[IO.File]::WriteAllText($localProperties, $localContents, [Text.UTF8Encoding]::new($false))

$corepack = Get-Command corepack -ErrorAction SilentlyContinue
if (-not $corepack) { throw "Corepack was not found with Node.js 22.22.3." }
$pnpmShimDirectory = Join-Path $env:APPDATA "npm"
& $corepack.Source enable pnpm --install-directory $pnpmShimDirectory
if ($LASTEXITCODE -ne 0) { throw "Corepack could not enable the pinned pnpm command." }
Add-UserPath $pnpmShimDirectory
$pnpmCommand = Join-Path $pnpmShimDirectory "pnpm.cmd"
& $pnpmCommand install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "pnpm dependency installation failed." }

Write-Host "Development environment is ready: Node 22.22.3, pnpm 12.3.4, Rust MSVC, JDK 21 and Android SDK 36."
