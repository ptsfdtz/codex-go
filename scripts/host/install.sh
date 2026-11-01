#!/bin/sh
# Public bootstrap; no account secrets or model calls. Safe when piped to sh.
set -eu
# Localized bootstrap text is self-contained so installation needs no extra download.
agentdeck_install_language=${AGENTDECK_LANG:-system}
if [ "$agentdeck_install_language" = system ]; then
    agentdeck_install_language=${LC_ALL:-${LC_MESSAGES:-${LANG:-en}}}
fi
agentdeck_printf() {
    case "$agentdeck_install_language" in zh|zh-*|zh_*) agentdeck_install_format=$2;; *) agentdeck_install_format=$1;; esac
    shift 2
    printf "$agentdeck_install_format" "$@"
}
agentdeck_message() {
    case "$agentdeck_install_language" in zh|zh-*|zh_*) printf '%s\n' "$2";; *) printf '%s\n' "$1";; esac
}
origin=${AGENTDECK_DOWNLOAD_ORIGIN:-https://agent.ptsfdtz.top}
version=${AGENTDECK_VERSION:-}
install_dir=${AGENTDECK_INSTALL_DIR:-"$HOME/.local/share/agentdeck"}
bin_dir=${AGENTDECK_BIN_DIR:-"$HOME/.local/bin"}
case "$origin" in https://*) ;; *) agentdeck_message 'An HTTPS download origin is required.' '下载来源必须使用 HTTPS。' >&2; exit 1;; esac
origin=${origin%/}
case "$(uname -s)" in Linux) platform=linux;; Darwin) platform=macos;; *) agentdeck_message 'This installer supports Linux and macOS. Windows: use install.ps1.' '此安装器支持 Linux 和 macOS。Windows 请使用 install.ps1。' >&2; exit 1;; esac
case "$(uname -m)" in x86_64|amd64) arch=x64;; aarch64|arm64) arch=arm64;; *) agentdeck_message 'Unsupported CPU architecture.' '不支持此 CPU 架构。' >&2; exit 1;; esac
for tool in curl tar; do command -v "$tool" >/dev/null 2>&1 || { agentdeck_message "Missing dependency: $tool" "缺少依赖：$tool" >&2; exit 1; }; done
if command -v sha256sum >/dev/null 2>&1; then
    hash_file() { sha256sum "$1"; }
elif command -v shasum >/dev/null 2>&1; then
    hash_file() { shasum -a 256 "$1"; }
else
    agentdeck_message 'Missing dependency: sha256sum or shasum' '缺少依赖：sha256sum 或 shasum' >&2
    exit 1
fi
if [ -z "$version" ]; then version=$(curl --proto '=https' --tlsv1.2 -fsSL "$origin/releases/stable.txt"); fi
case "$version" in ''|*[!a-zA-Z0-9._-]*|*..*) agentdeck_message 'Invalid release version.' '发布版本无效。' >&2; exit 1;; esac
umask 077
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
package="agentdeck-$platform-$arch.tar.gz"
url="$origin/releases/$version/$package"
curl --proto '=https' --tlsv1.2 -fsSL "$url" -o "$temporary/$package"
expected=$(curl --proto '=https' --tlsv1.2 -fsSL "$url.sha256")
case "$expected" in *[!a-fA-F0-9]*|'') agentdeck_message 'Invalid checksum.' '校验和无效。' >&2; exit 1;; esac
[ "${#expected}" -eq 64 ] || { agentdeck_message 'Invalid checksum length.' '校验和长度无效。' >&2; exit 1; }
actual=$(hash_file "$temporary/$package"); actual=${actual%% *}
[ "$actual" = "$expected" ] || { agentdeck_message 'Integrity check failed; installation was not changed.' '完整性校验失败；现有安装未更改。' >&2; exit 1; }
mkdir "$temporary/package"
tar -xzf "$temporary/$package" -C "$temporary/package"
for name in agentdeck agentdeck-service agentdeck-codex-proxy start.sh; do [ -f "$temporary/package/$name" ] || { agentdeck_message "Release is missing $name" "发布包缺少 $name" >&2; exit 1; }; done
chmod 755 "$temporary/package/agentdeck" "$temporary/package/agentdeck-service" "$temporary/package/agentdeck-codex-proxy" "$temporary/package/start.sh"
"$temporary/package/agentdeck" --version
mkdir -p "$install_dir/versions" "$bin_dir"
release_dir="$install_dir/versions/$version"
if [ -e "$release_dir" ]; then
    for name in agentdeck agentdeck-service agentdeck-codex-proxy; do cmp "$release_dir/$name" "$temporary/package/$name" || { agentdeck_message 'Existing release differs; it was preserved.' '已有版本内容不同；已保留原安装。' >&2; exit 1; }; done
else
    mv "$temporary/package" "$release_dir"
fi
printf '%s\n' "$version" > "$release_dir/release.txt"
printf '%s\n' "$origin" > "$release_dir/update-origin.txt"
for name in agentdeck agentdeck-service; do
    ln -s "$release_dir/$name" "$bin_dir/.$name.new.$$"
    mv -f "$bin_dir/.$name.new.$$" "$bin_dir/$name"
done
# The macOS LaunchAgent targets the stable ~/.local/bin symlink, so refreshing
# it would restart a running Host before the user explicitly asks for restart.
if [ "$platform" != macos ] && "$bin_dir/agentdeck" autostart status 2>/dev/null | grep -q '^enabled'; then
    "$bin_dir/agentdeck" autostart enable
fi
agentdeck_printf '\nInstalled AgentDeck Host %s. Account and project data are preserved.\n' '\n已安装 AgentDeck Host %s。账户和项目数据已保留。\n' "$version"
agentdeck_printf 'Ensure %s is in PATH, then run:\n' '请确保 %s 已加入 PATH，然后运行：\n' "$bin_dir"
printf '  agentdeck login --username NAME\n  agentdeck projects add PATH\n  agentdeck start\n  agentdeck autostart enable\n'
agentdeck_printf 'The first start automatically downloads a verified official Codex package and initializes private shared transport. Run agentdeck codex-login if Codex authentication is needed.\n' '首次启动会自动下载并校验官方 Codex 包，并初始化私有共享传输。如需 Codex 认证，请运行 agentdeck codex-login。\n'
agentdeck_printf 'A running host keeps its current version until agentdeck restart.\n' '运行中的 Host 会继续使用当前版本，直到执行 agentdeck restart。\n'
