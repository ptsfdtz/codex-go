#!/bin/sh
# Run on the download server after uploading a merged host-downloads directory.
# Publishes versioned files first and changes the stable pointer last.
set -eu
source_dir=${1:?Usage: publish-downloads.sh SOURCE_DIRECTORY [TARGET_DIRECTORY]}
target_dir=${2:-/opt/agentdeck/downloads}
gate=${3:-$(dirname "$0")/../release/gate.py}
mode=${4:-promote}
case "$mode" in stage|promote) ;; *) echo 'Expected stage or promote' >&2; exit 1;; esac
# Refuse direct stable promotion without the same candidate-bound real E2E gate.
python3 "$gate" verify "$source_dir" --evidence "$source_dir/evidence" --current-stable "$target_dir/releases/stable.txt"
[ -d "$source_dir/releases" ] || { echo 'Missing releases directory' >&2; exit 1; }
[ -f "$source_dir/releases/stable.txt" ] || { echo 'Missing Host stable pointer' >&2; exit 1; }
version=$(cat "$source_dir/releases/stable.txt")
[ "$version" = "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$source_dir/candidate.json")" ] || { echo 'Stable pointer differs from tested candidate' >&2; exit 1; }
case "$version" in ''|*[!a-zA-Z0-9._-]*|*..*) echo 'Invalid version' >&2; exit 1;; esac
files=0
for archive in "$source_dir/releases/$version"/*.zip "$source_dir/releases/$version"/*.tar.gz; do
    [ -f "$archive" ] || continue
    expected=$(cat "$archive.sha256")
    actual=$(sha256sum "$archive"); actual=${actual%% *}
    [ "$actual" = "$expected" ] || { echo "Integrity failure: $archive" >&2; exit 1; }
    files=$((files + 1))
done
[ "$files" -gt 0 ] || { echo 'No release archives' >&2; exit 1; }
mkdir -p "$target_dir/releases"
exec 8>"$target_dir/.publish.lock"
flock -n 8 || { echo 'Another download publication is active' >&2; exit 1; }
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
if [ "$mode" = stage ]; then
    printf 'Staged %s; stable pointer unchanged\n' "$version"
    exit 0
fi
for script in install.sh install.ps1 install-codex.ps1; do
    [ -f "$source_dir/$script" ] || continue
    cp "$source_dir/$script" "$target_dir/.$script.new.$$"
    chmod 644 "$target_dir/.$script.new.$$"
    mv -f "$target_dir/.$script.new.$$" "$target_dir/$script"
done
printf '%s\n' "$version" > "$target_dir/releases/.stable.new.$$"
chmod 644 "$target_dir/releases/.stable.new.$$"
mv -f "$target_dir/releases/.stable.new.$$" "$target_dir/releases/stable.txt"
printf 'Published %s (%s platform packages)\n' "$version" "$files"
