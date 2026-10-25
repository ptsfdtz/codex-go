#!/bin/sh
# Run on the download server after uploading a merged host-downloads directory.
# Publishes versioned files first and changes the stable pointer last.
set -eu
source_dir=${1:?Usage: publish-downloads.sh SOURCE_DIRECTORY [TARGET_DIRECTORY]}
target_dir=${2:-/opt/agentdeck/downloads}
[ -d "$source_dir/releases" ] || { echo 'Missing releases directory' >&2; exit 1; }
publish_host=false
if [ -f "$source_dir/releases/stable.txt" ]; then
    publish_host=true
    version=$(cat "$source_dir/releases/stable.txt")
else
    version=$(python3 - "$source_dir/android/stable.json" <<'PY'
import json, sys
parts = json.load(open(sys.argv[1]))['file'].split('/')
assert len(parts) == 3 and parts[0] == 'releases' and parts[2] == 'AgentDeck-android.apk'
print(parts[1])
PY
    )
fi
case "$version" in ''|*[!a-zA-Z0-9._-]*|*..*) echo 'Invalid version' >&2; exit 1;; esac
files=0
host_files=0
for archive in "$source_dir/releases/$version"/*.zip "$source_dir/releases/$version"/*.tar.gz "$source_dir/releases/$version"/*.apk; do
    [ -f "$archive" ] || continue
    expected=$(cat "$archive.sha256")
    actual=$(sha256sum "$archive"); actual=${actual%% *}
    [ "$actual" = "$expected" ] || { echo "Integrity failure: $archive" >&2; exit 1; }
    files=$((files + 1))
    case "$archive" in *.zip|*.tar.gz) host_files=$((host_files + 1));; esac
done
[ "$files" -gt 0 ] || { echo 'No release archives' >&2; exit 1; }
[ "$publish_host" != true ] || [ "$host_files" -gt 0 ] || { echo 'Host stable pointer requires a Host archive' >&2; exit 1; }
if [ -f "$source_dir/android/stable.json" ]; then
    python3 - "$source_dir" "$version" "$target_dir" <<'PY'
import hashlib, json, pathlib, sys
root, version = pathlib.Path(sys.argv[1]), sys.argv[2]
m = json.loads((root / 'android/stable.json').read_text())
assert m['file'] == f'releases/{version}/AgentDeck-android.apk'
assert isinstance(m['versionCode'], int) and m['versionCode'] > 0
assert hashlib.sha256((root / m['file']).read_bytes()).hexdigest() == m['sha256']
assert json.loads((root / f'releases/{version}/android.json').read_text()) == m
previous = pathlib.Path(sys.argv[3]) / 'android/stable.json'
if previous.exists():
    old = json.loads(previous.read_text())
    assert (old['sha256'] == m['sha256'] and old['versionCode'] == m['versionCode']) or m['versionCode'] > old['versionCode'], 'Android updates must increase versionCode'
PY
fi
mkdir -p "$target_dir/releases"
if [ -e "$target_dir/releases/$version" ]; then
    diff -qr "$source_dir/releases/$version" "$target_dir/releases/$version" || { echo 'Published versions are immutable; use a new version identifier.' >&2; exit 1; }
else
    staging="$target_dir/releases/.staging-$version-$$"
    mkdir "$staging"
    cp -R "$source_dir/releases/$version/." "$staging/"
    find "$staging" -type d -exec chmod 755 {} +
    find "$staging" -type f -exec chmod 644 {} +
    mv "$staging" "$target_dir/releases/$version"
fi
for script in install.sh install.ps1 install-codex.ps1; do
    [ -f "$source_dir/$script" ] || continue
    cp "$source_dir/$script" "$target_dir/.$script.new.$$"
    chmod 644 "$target_dir/.$script.new.$$"
    mv -f "$target_dir/.$script.new.$$" "$target_dir/$script"
done
if [ "$publish_host" = true ]; then
    printf '%s\n' "$version" > "$target_dir/releases/.stable.new.$$"
    chmod 644 "$target_dir/releases/.stable.new.$$"
    mv -f "$target_dir/releases/.stable.new.$$" "$target_dir/releases/stable.txt"
fi
if [ -f "$source_dir/android/stable.json" ]; then
    mkdir -p "$target_dir/android"
    cp "$source_dir/android/stable.json" "$target_dir/android/.stable.new.$$"
    chmod 644 "$target_dir/android/.stable.new.$$"
    mv -f "$target_dir/android/.stable.new.$$" "$target_dir/android/stable.json"
fi
printf 'Published %s (%s platform packages)\n' "$version" "$files"
