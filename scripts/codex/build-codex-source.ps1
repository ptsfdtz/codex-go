param(
    [Parameter(Mandatory = $true)][string]$SourceDir,
    [Parameter(Mandatory = $true)][string]$BuildDir,
    [string]$TargetDir,
    [string]$SourceVersion,
    [switch]$BackportSystemRootFix
)
# Explicit source repair build. Installation and Host configuration are separate.
# Uses the same sandbox-enabled V8 artifacts and checksum chain as Codex CI.
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $SourceDir).Path
$build = [IO.Path]::GetFullPath($BuildDir)
$remote = & git -C $source remote get-url origin
if ($LASTEXITCODE -ne 0 -or $remote -notmatch '^https://github\.com/openai/codex(?:\.git)?$') {
    throw 'Expected an official openai/codex source checkout.'
}
$changes = & git -C $source status --porcelain
if ($LASTEXITCODE -ne 0 -or $changes) { throw 'Build from a clean source checkout.' }
$commit = & git -C $source rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') { throw 'Cannot identify source commit.' }
if ($SourceVersion -and ($SourceVersion -notmatch '^\d+\.\d+\.\d+-dev\.agentdeck\.([a-f0-9]{7,40})$' -or -not $commit.StartsWith($Matches[1]))) {
    throw 'A source version must explicitly identify this commit, for example 0.165.0-dev.agentdeck.d4bdafd.'
}
$version = & python (Join-Path $source '.github/scripts/rusty_v8_bazel.py') resolved-v8-crate-version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^\d+\.\d+\.\d+$') { throw 'Cannot resolve V8 version.' }
$target = 'x86_64-pc-windows-msvc'
if (-not [Environment]::Is64BitOperatingSystem -or $env:OS -ne 'Windows_NT') {
    throw 'This diagnostic builder currently supports Windows x64 only.'
}
$artifacts = Join-Path $build 'official-v8'
New-Item -ItemType Directory -Path $artifacts -Force | Out-Null
$profile = 'ptrcomp_sandbox_release'
$archiveName = "rusty_v8_${profile}_${target}.lib.gz"
$bindingName = "src_binding_${profile}_${target}.rs"
$manifestName = "rusty_v8_${profile}_${target}.sha256"
& gh release download "rusty-v8-v$version" --repo openai/codex --pattern "*${profile}_${target}*" --dir $artifacts --skip-existing
if ($LASTEXITCODE -ne 0) { throw 'Official V8 artifact download failed.' }
$trusted = Join-Path $source "third_party/v8/rusty_v8_$($version.Replace('.', '_'))_release_manifests.sha256"
$trustedLines = @(Get-Content -LiteralPath $trusted | Where-Object { $_ -match "  $([regex]::Escape($manifestName))$" })
if ($trustedLines.Count -ne 1) { throw 'Missing unique trusted V8 manifest digest.' }
$manifest = Join-Path $artifacts $manifestName
if ((Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash -ine $trustedLines[0].Split(' ')[0]) {
    throw 'Official V8 manifest checksum mismatch; no build started.'
}
$lines = @(Get-Content -LiteralPath $manifest)
if ($lines.Count -ne 2) { throw 'Expected exactly two V8 artifact digests.' }
$names = @{}
foreach ($line in $lines) {
    if ($line -notmatch '^([0-9a-fA-F]{64})  (.+)$') { throw 'Invalid V8 digest entry.' }
    $digest = $Matches[1]
    $name = $Matches[2]
    if ($name -notin @($archiveName, $bindingName) -or $names.ContainsKey($name)) { throw 'Unexpected V8 artifact.' }
    $names[$name] = $true
    if ((Get-FileHash -LiteralPath (Join-Path $artifacts $name) -Algorithm SHA256).Hash -ine $digest) {
        throw 'V8 artifact checksum mismatch; no build started.'
    }
}
$settings = @{
    CARGO_TARGET_DIR = $(if ($TargetDir) { [IO.Path]::GetFullPath($TargetDir) } else { Join-Path $build 'target' })
    STABLE_GIT_COMMIT = $commit
    RUSTY_V8_ARCHIVE = (Join-Path $artifacts $archiveName)
    RUSTY_V8_SRC_BINDING_PATH = (Join-Path $artifacts $bindingName)
    LIBSQLITE3_FLAGS = 'SQLITE_DISABLE_INTRINSIC'
    V8_FROM_SOURCE = $null
}
$saved = @{}
foreach ($key in $settings.Keys) {
    $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, $settings[$key], 'Process')
}
Push-Location (Join-Path $source 'codex-rs')
$cargoPath = Join-Path $source 'codex-rs/Cargo.toml'
$lockPath = Join-Path $source 'codex-rs/Cargo.lock'
$cargoBytes = [IO.File]::ReadAllBytes($cargoPath)
$lockBytes = [IO.File]::ReadAllBytes($lockPath)
$sandboxPath = Join-Path $source 'codex-rs/exec-server/src/fs_sandbox.rs'
$sandboxBytes = [IO.File]::ReadAllBytes($sandboxPath)
try {
    if ($BackportSystemRootFix) {
        if (-not $SourceVersion) { throw 'A backport requires an explicit source version.' }
        # Minimal equivalent of official d4bdafd378a8e328a67a4cd3557b5fe634af378c:
        # preserve desktop-baseline protocol/runtime behavior and all sandbox
        # restrictions; only carry the required Windows variable into helpers.
        $sandboxText = [IO.File]::ReadAllText($sandboxPath)
        $oldAllowlist = '["PATH", "SystemDrive", "LOCALAPPDATA"]'
        $newAllowlist = '["PATH", "SystemDrive", "SystemRoot", "LOCALAPPDATA"]'
        if (($sandboxText.Split(@($oldAllowlist), [StringSplitOptions]::None).Count - 1) -ne 1) {
            throw 'Expected the exact affected Windows helper allowlist; no backport applied.'
        }
        [IO.File]::WriteAllText($sandboxPath, $sandboxText.Replace($oldAllowlist, $newAllowlist), (New-Object Text.UTF8Encoding $false))
        Write-Output 'Applying minimal SystemRoot backport from official d4bdafd for this build only.'
    }
    $lockArgs = @('--locked')
    if ($SourceVersion) {
        # Stamp an honest source prerelease into compiled Cargo version fields.
        # Metadata alone does not update the native CLI/initialize versions.
        # Restore the checkout byte-for-byte even when the build fails.
        $cargoText = [IO.File]::ReadAllText($cargoPath)
        $pattern = '(?s)(\[workspace\.package\][^\[]*?version\s*=\s*")[^"]+("\s*)'
        if ([regex]::Matches($cargoText, $pattern).Count -ne 1) { throw 'Cannot identify workspace package version.' }
        $cargoText = [regex]::Replace($cargoText, $pattern, { param($match) $match.Groups[1].Value + $SourceVersion + $match.Groups[2].Value })
        [IO.File]::WriteAllText($cargoPath, $cargoText, (New-Object Text.UTF8Encoding $false))
        # Only local workspace package identities change; preserve registry/git
        # dependency resolution and require the lockfile to have no other edits.
        & cargo update --offline --workspace
        if ($LASTEXITCODE -ne 0) { throw 'Source version metadata failed.' }
        $stampedLock = [IO.File]::ReadAllText($lockPath)
        $originalLock = [Text.Encoding]::UTF8.GetString($lockBytes)
        if ($stampedLock.Replace("version = `"$SourceVersion`"", 'version = "0.0.0"').Replace("`r`n", "`n") -cne $originalLock.Replace("`r`n", "`n")) {
            throw 'Unexpected dependency lock changes during source version stamping.'
        }
    }
    & cargo build @lockArgs -p codex-cli --bin codex -p codex-code-mode-host --bin codex-code-mode-host -p codex-windows-sandbox --bin codex-command-runner --bin codex-windows-sandbox-setup
    if ($LASTEXITCODE -ne 0) { throw 'Codex source build failed; installed programs remain unchanged.' }
    Write-Output "Built source commit $commit in $($settings.CARGO_TARGET_DIR). No runtime installed or activated."
} finally {
    [IO.File]::WriteAllBytes($cargoPath, $cargoBytes)
    [IO.File]::WriteAllBytes($lockPath, $lockBytes)
    [IO.File]::WriteAllBytes($sandboxPath, $sandboxBytes)
    Pop-Location
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process') }
}
