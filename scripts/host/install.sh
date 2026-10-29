#!/bin/sh
# Public bootstrap; no account secrets or model calls. Safe when piped to sh.
set -eu
origin=${AGENTDECK_DOWNLOAD_ORIGIN:-https://agent.ptsfdtz.top}
version=${AGENTDECK_VERSION:-}
install_dir=${AGENTDECK_INSTALL_DIR:-"$HOME/.local/share/agentdeck"}
bin_dir=${AGENTDECK_BIN_DIR:-"$HOME/.local/bin"}
case "$origin" in https://*) ;; *) echo 'An HTTPS download origin is required.' >&2; exit 1;; esac
origin=${origin%/}
case "$(uname -s)" in Linux) platform=linux;; Darwin) platform=macos;; *) echo 'This installer supports Linux and macOS. Windows: use install.ps1.' >&2; exit 1;; esac
case "$(uname -m)" in x86_64|amd64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo 'Unsupported CPU architecture.' >&2; exit 1;; esac
for tool in curl tar; do command -v "$tool" >/dev/null 2>&1 || { echo "Missing dependency: $tool" >&2; exit 1; }; done
if command -v sha256sum >/dev/null 2>&1; then
    hash_file() { sha256sum "$1"; }
elif command -v shasum >/dev/null 2>&1; then
    hash_file() { shasum -a 256 "$1"; }
else
    echo 'Missing dependency: sha256sum or shasum' >&2
    exit 1
fi
if [ -z "$version" ]; then version=$(curl --proto '=https' --tlsv1.2 -fsSL "$origin/releases/stable.txt"); fi
case "$version" in ''|*[!a-zA-Z0-9._-]*|*..*) echo 'Invalid release version.' >&2; exit 1;; esac
umask 077
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
package="agentdeck-$platform-$arch.tar.gz"
url="$origin/releases/$version/$package"
curl --proto '=https' --tlsv1.2 -fsSL "$url" -o "$temporary/$package"
expected=$(curl --proto '=https' --tlsv1.2 -fsSL "$url.sha256")
case "$expected" in *[!a-fA-F0-9]*|'') echo 'Invalid checksum.' >&2; exit 1;; esac
[ "${#expected}" -eq 64 ] || { echo 'Invalid checksum length.' >&2; exit 1; }
actual=$(hash_file "$temporary/$package"); actual=${actual%% *}
[ "$actual" = "$expected" ] || { echo 'Integrity check failed; installation was not changed.' >&2; exit 1; }
mkdir "$temporary/package"
tar -xzf "$temporary/$package" -C "$temporary/package"
for name in agentdeck agentdeck-service agentdeck-codex-proxy start.sh; do [ -f "$temporary/package/$name" ] || { echo "Release is missing $name" >&2; exit 1; }; done
chmod 755 "$temporary/package/agentdeck" "$temporary/package/agentdeck-service" "$temporary/package/agentdeck-codex-proxy" "$temporary/package/start.sh"
"$temporary/package/agentdeck" --version
mkdir -p "$install_dir/versions" "$bin_dir"
release_dir="$install_dir/versions/$version"
if [ -e "$release_dir" ]; then
    for name in agentdeck agentdeck-service agentdeck-codex-proxy; do cmp "$release_dir/$name" "$temporary/package/$name" || { echo 'Existing release differs; it was preserved.' >&2; exit 1; }; done
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
printf '\nInstalled AgentDeck Host %s. Account and project data are preserved.\n' "$version"
printf 'Ensure %s is in PATH, then run:\n' "$bin_dir"
printf '  agentdeck login --username NAME\n  agentdeck projects add PATH\n  agentdeck start\n  agentdeck autostart enable\n'
printf 'The first start automatically downloads a verified official Codex package and initializes private shared transport. Run agentdeck codex-login if Codex authentication is needed.\n'
printf 'A running host keeps its current version until agentdeck restart.\n'
