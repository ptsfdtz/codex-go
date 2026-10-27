#!/bin/sh
# Publish immutable candidate packages only. Never change stable, Web or cloud.
set -eu
upload=${1:?Usage: stage-candidate.sh UPLOAD_DIRECTORY}
case "$upload" in /var/tmp/agentdeck-publish.*) ;; *) exit 1;; esac
. /etc/agentdeck/release.env
target=${AGENTDECK_DOWNLOADS:-/opt/agentdeck/downloads}
mkdir "$upload/candidate"
python3 "$upload/extract.py" "$upload/candidate.tar.gz" "$upload/candidate"
python3 "$upload/gate.py" verify-candidate "$upload/candidate"
version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$upload/candidate/candidate.json")
mkdir -p "$target/releases"
exec 8>"$target/.publish.lock"
flock -n 8 || { echo 'Another package publication is active' >&2; exit 1; }
if [ -e "$target/releases/$version" ]; then
    diff -qr "$upload/candidate/releases/$version" "$target/releases/$version"
else
    staging="$target/releases/.candidate-$version-$$"
    mkdir "$staging"
    cp -R "$upload/candidate/releases/$version/." "$staging/"
    find "$staging" -type d -exec chmod 755 {} +
    find "$staging" -type f -exec chmod 644 {} +
    mv "$staging" "$target/releases/$version"
fi
printf 'Candidate %s is available for explicitly configured test Hosts; production pointers unchanged\n' "$version"
