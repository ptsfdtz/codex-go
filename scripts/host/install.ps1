param(
    [string]$Origin = 'https://agent.ptsfdtz.top',
    [string]$Version = '',
    [string]$InstallDir = '',
    [switch]$Autostart,
    [switch]$NoPath,
    [ValidateSet('system', 'zh-CN', 'en')]
    [string]$Language = $(if ($env:AGENTDECK_LANG) { $env:AGENTDECK_LANG } else { 'system' })
)
# Keep localization local to this installer and preserve command/protocol values.
$agentdeckInstallLocale = if ($Language -eq 'system') { [Globalization.CultureInfo]::CurrentUICulture.Name } else { $Language }
function Get-AgentDeckText([string]$English, [string]$Chinese) {
    if ($agentdeckInstallLocale -match '^zh(?:-|_|$)') { return $Chinese }
    return $English
}
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if (-not $env:LOCALAPPDATA) { throw (Get-AgentDeckText 'Install this script as a regular Windows user.' '请使用普通 Windows 用户运行此安装脚本。') }
$downloadOrigin = [Uri]$Origin
if ($downloadOrigin.Scheme -ne 'https' -or $downloadOrigin.UserInfo -or $downloadOrigin.Query -or $downloadOrigin.Fragment -or $downloadOrigin.AbsolutePath -ne '/') { throw (Get-AgentDeckText 'Origin must be an HTTPS origin without a path or credentials.' '来源必须是 HTTPS 站点，不能包含路径或凭据。') }
$Origin = $Origin.TrimEnd('/')
$arch = [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITEW6432')
if (-not $arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
if ($arch -ne 'AMD64') { throw (Get-AgentDeckText "No verified Windows release is available for architecture $arch." "没有适用于 $arch 架构的已验证 Windows 发布包。") }
if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\AgentDeck' }
$InstallDir = [IO.Path]::GetFullPath($InstallDir)
if (-not $Version) { $Version = ([string](Invoke-RestMethod -Uri "$Origin/releases/stable.txt")).Trim() }
if ($Version -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$' -or $Version.Contains('..')) { throw (Get-AgentDeckText 'Invalid release version.' '发布版本无效。') }
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
    if ($expected -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ine $expected) { throw (Get-AgentDeckText 'Download integrity check failed; installed files were not changed.' '下载完整性校验失败，已安装的文件未更改。') }
    $staging = Join-Path $temporaryRoot 'package'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($archive, $staging)
    foreach ($name in @('agentdeck.exe', 'agentdeck-service.exe', 'agentdeck-codex-proxy.exe', 'start.ps1')) {
        if (-not (Test-Path -LiteralPath (Join-Path $staging $name) -PathType Leaf)) { throw (Get-AgentDeckText "Release is missing $name." "发布包缺少 $name。") }
    }
    # Version directories avoid overwriting a running executable. Keep older versions for rollback.
    if (-not (Test-Path -LiteralPath $releaseRoot)) {
        New-Item -ItemType Directory -Path (Split-Path $releaseRoot) -Force | Out-Null
        Move-Item -LiteralPath $staging -Destination $releaseRoot
    } else {
        foreach ($name in @('agentdeck.exe', 'agentdeck-service.exe')) {
            if ((Get-FileHash -LiteralPath (Join-Path $releaseRoot $name)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $staging $name)).Hash) { throw (Get-AgentDeckText 'Existing release directory has different binaries; it was left untouched.' '已有发布目录中的程序不同，已保留原内容。') }
        }
        # Preserve old release compatibility while checking the optional native
        # desktop adapter as part of an immutable version's contents.
        $adapterName = 'agentdeck-codex-proxy.exe'
        $installedAdapter = Join-Path $releaseRoot $adapterName
        $stagedAdapter = Join-Path $staging $adapterName
        $hasInstalledAdapter = Test-Path -LiteralPath $installedAdapter -PathType Leaf
        $hasStagedAdapter = Test-Path -LiteralPath $stagedAdapter -PathType Leaf
        if ($hasInstalledAdapter -ne $hasStagedAdapter) { throw (Get-AgentDeckText 'Existing release has different desktop adapter contents; it was left untouched.' '已有版本的桌面适配器内容不同，已保留原内容。') }
        if ($hasInstalledAdapter -and ((Get-FileHash -LiteralPath $installedAdapter).Hash -ne (Get-FileHash -LiteralPath $stagedAdapter).Hash)) { throw (Get-AgentDeckText 'Existing release desktop adapter differs; it was left untouched.' '已有版本的桌面适配器不同，已保留原内容。') }
    }
    $cli = Join-Path $releaseRoot 'agentdeck.exe'
    [IO.File]::WriteAllText((Join-Path $releaseRoot 'release.txt'), $Version, [Text.Encoding]::ASCII)
    [IO.File]::WriteAllText((Join-Path $releaseRoot 'update-origin.txt'), $Origin, [Text.Encoding]::ASCII)
    & $cli --version
    if ($LASTEXITCODE -ne 0) { throw (Get-AgentDeckText 'Downloaded CLI could not run.' '下载的 CLI 无法运行。') }
    $enabled = ((& $cli autostart status | Out-String).Trim().StartsWith('enabled'))
    New-Item -ItemType Directory -Path $bin -Force | Out-Null
    # cmd expands % even inside quotes; reject unusual installation paths rather than misroute commands.
    if ($cli.Contains('%') -or $cli.Contains('"') -or $cli.Contains("`n")) { throw (Get-AgentDeckText 'Installation path contains unsupported command characters.' '安装路径包含不支持的命令字符。') }
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
        if ($LASTEXITCODE -ne 0) { throw (Get-AgentDeckText 'Installed, but automatic startup could not be configured.' '安装完成，但无法配置自动启动。') }
    }
    # A normal Start-menu entry discovers the installed original desktop; no
    # private runtime path, address, or token is embedded in the shortcut.
    $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'AgentDeck'
    New-Item -ItemType Directory -Path $menu -Force | Out-Null
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path $menu 'Codex shared.lnk'))
    $shortcut.TargetPath = $cli
    $shortcut.Arguments = 'desktop'
    $shortcut.WorkingDirectory = $env:USERPROFILE
    $shortcut.Save()
    Write-Output (Get-AgentDeckText "Installed AgentDeck Host $Version. Account and project data are preserved." "已安装 AgentDeck Host $Version。账户和项目数据已保留。")
    Write-Output (Get-AgentDeckText 'Next: agentdeck login --username NAME; agentdeck projects add PATH; agentdeck start; agentdeck autostart enable' '下一步：agentdeck login --username NAME; agentdeck projects add PATH; agentdeck start; agentdeck autostart enable')
    Write-Output (Get-AgentDeckText 'Official Codex downloads and shared transport initialize automatically on first start. If authentication is needed: agentdeck codex-login. Start the original desktop with the Codex shared shortcut.' '首次启动会自动下载官方 Codex 并初始化共享传输。如需认证，请运行 agentdeck codex-login。使用 Codex shared 快捷方式启动原版桌面。')
    Write-Output (Get-AgentDeckText 'Open a new terminal if agentdeck is not found. An already running host keeps its current version until agentdeck restart.' '如果找不到 agentdeck，请打开新的终端。运行中的 Host 将继续使用当前版本，直到执行 agentdeck restart。')
} finally {
    # Both paths are fixed descendants of this invocation's unique temporary directory.
    $resolvedTemporary = [IO.Path]::GetFullPath($temporaryRoot)
    $temporaryParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolvedTemporary.StartsWith($temporaryParent, [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force -ErrorAction SilentlyContinue }
}
