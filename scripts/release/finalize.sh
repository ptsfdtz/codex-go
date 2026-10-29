#!/bin/sh
# Open updates only after VPS health and Pages deployment both pass.
set -eu
upload=${1:?Usage: finalize.sh UPLOAD_DIRECTORY}
case "$upload" in /var/tmp/agentdeck-publish.*) ;; *) exit 1;; esac
exec 9>/var/lock/agentdeck-release.lock
flock -n 9 || { echo 'Another production release is active' >&2; exit 1; }
. /etc/agentdeck/release.env
candidate="$upload/candidate"
python3 "$upload/gate.py" verify "$candidate" --evidence "$candidate/evidence" --current-stable "${AGENTDECK_DOWNLOADS:-/opt/agentdeck/downloads}/releases/stable.txt"
version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$candidate/candidate.json")
release="/opt/agentdeck/releases/$version"
[ "$(readlink -f "${AGENTDECK_CLOUD_LINK:-/opt/agentdeck/current}")" = "$release" ]
[ "$(readlink -f "$AGENTDECK_WEB_LINK")" = "$release/web" ]
origin=${AGENTDECK_PUBLIC_ORIGIN:-https://agent.ptsfdtz.top}
curl --fail --silent --show-error "$origin/health/ready" > /dev/null
python3 "$upload/verify-web.py" "$release/web" "$origin"
python3 "$upload/verify-web.py" "$release" "$origin" --downloads
sh "$upload/publish-downloads.sh" "$candidate" "${AGENTDECK_DOWNLOADS:-/opt/agentdeck/downloads}" "$upload/gate.py" promote
printf 'Stable update %s is now available\n' "$version"
