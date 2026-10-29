#!/bin/sh
# Production machine prerequisites live in /etc/agentdeck/release.env.
# Never rebuild here. E2E evidence must match every deployed byte.
set -eu
upload=${1:?Usage: deploy.sh UPLOAD_DIRECTORY}
case "$upload" in /var/tmp/agentdeck-publish.*) ;; *) echo 'Unexpected upload directory' >&2; exit 1;; esac
exec 9>/var/lock/agentdeck-release.lock
flock -n 9 || { echo 'Another production release is active' >&2; exit 1; }
[ -f /etc/agentdeck/release.env ] || { echo 'Configure /etc/agentdeck/release.env first' >&2; exit 1; }
. /etc/agentdeck/release.env
: "${AGENTDECK_WEB_LINK:?Absolute Nginx document-root symlink is required}"
cloud_link=${AGENTDECK_CLOUD_LINK:-/opt/agentdeck/current}
downloads=${AGENTDECK_DOWNLOADS:-/opt/agentdeck/downloads}
origin=${AGENTDECK_PUBLIC_ORIGIN:-https://agent.ptsfdtz.top}
for link in "$AGENTDECK_WEB_LINK" "$cloud_link"; do
    case "$link" in /*) ;; *) echo 'Deployment links must be absolute' >&2; exit 1;; esac
    [ -L "$link" ] && [ -d "$link" ] || { echo "Provision existing directory symlink first: $link" >&2; exit 1; }
done
candidate="$upload/candidate"
mkdir "$candidate"
python3 "$upload/extract.py" "$upload/tested-candidate.tar.gz" "$candidate"
python3 "$upload/gate.py" verify "$candidate" --evidence "$candidate/evidence" --current-stable "$downloads/releases/stable.txt"
version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$candidate/candidate.json")
release="/opt/agentdeck/releases/$version"
backup="/var/backups/agentdeck/publish-$version-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup"
chmod 700 "$backup"
readlink -f "$cloud_link" > "$backup/previous-cloud.txt"
readlink -f "$AGENTDECK_WEB_LINK" > "$backup/previous-web.txt"
cp /etc/agentdeck/cloud.env /etc/agentdeck/release.env "$backup/"
for file in releases/stable.txt install.ps1 install.sh install-codex.ps1; do
    if [ -f "$downloads/$file" ]; then
        mkdir -p "$backup/downloads/$(dirname "$file")"
        cp "$downloads/$file" "$backup/downloads/$file"
    fi
done
# Existing native backup service owns credentials, pg_dump and integrity checks.
systemctl start agentdeck-backup.service
[ "$(systemctl show agentdeck-backup.service -p Result --value)" = success ]
if [ -e "$release" ]; then
    cmp "$release/candidate.json" "$candidate/candidate.json"
    python3 "$upload/gate.py" verify "$release" --evidence "$release/evidence"
else
    staging="/opt/agentdeck/releases/.candidate-$version-$$"
    mkdir -p "$staging"
    cp -R "$candidate/." "$staging/"
    mkdir "$staging/web"
    python3 "$upload/extract.py" "$staging/web.tar.gz" "$staging/web"
    chmod 755 "$staging"
    find "$staging/web" -type d -exec chmod 755 {} +
    find "$staging/web" -type f -exec chmod 644 {} +
    find "$staging/evidence" -type d -exec chmod 700 {} +
    find "$staging/evidence" -type f -exec chmod 600 {} +
    chmod 755 "$staging/agentdeck-cloud"
    mv "$staging" "$release"
fi
# A retry must not trust a previously extracted tree merely because its archive
# is still correct. Compare against a fresh extraction of the tested bytes.
mkdir "$upload/verified-web"
python3 "$upload/extract.py" "$release/web.tar.gz" "$upload/verified-web"
diff -qr "$upload/verified-web" "$release/web"
switched=0
rollback() {
    result=$?
    trap - EXIT HUP INT TERM
    if [ "$result" -ne 0 ] && [ "$switched" -eq 1 ]; then
        # Static resources are safe to restore. Cloud program rollback is opt-in:
        # database schema compatibility must have been assessed by the operator.
        ln -s "$(cat "$backup/previous-web.txt")" "$AGENTDECK_WEB_LINK.rollback.$$"
        mv -Tf "$AGENTDECK_WEB_LINK.rollback.$$" "$AGENTDECK_WEB_LINK"
        if [ "${AGENTDECK_ROLLBACK_SAFE_VERSION:-}" = "$version" ]; then
            ln -s "$(cat "$backup/previous-cloud.txt")" "$cloud_link.rollback.$$"
            mv -Tf "$cloud_link.rollback.$$" "$cloud_link"
            systemctl restart agentdeck-cloud || true
        fi
        echo "Deployment failed. Stable download pointer was not advanced. Recovery: $backup" >&2
    fi
    exit "$result"
}
trap rollback EXIT
trap 'exit 1' HUP INT TERM
nginx -t
ln -s "$release" "$cloud_link.new.$$"
mv -Tf "$cloud_link.new.$$" "$cloud_link"
switched=1
ln -s "$release/web" "$AGENTDECK_WEB_LINK.new.$$"
mv -Tf "$AGENTDECK_WEB_LINK.new.$$" "$AGENTDECK_WEB_LINK"
systemctl restart agentdeck-cloud
curl --retry 8 --retry-delay 2 --retry-connrefused --fail --silent --show-error "$origin/health/live" > /dev/null
curl --fail --silent --show-error "$origin/health/ready" > /dev/null
curl --fail --silent --show-error -H 'Cache-Control: no-cache' "$origin/version.json" > "$upload/online-version.json"
cmp "$release/web/version.json" "$upload/online-version.json"
# Verify all public Web assets, not only index.html or a health endpoint.
python3 "$upload/verify-web.py" "$release/web" "$origin"
sh "$upload/publish-downloads.sh" "$release" "$downloads" "$upload/gate.py" stage
python3 "$upload/verify-web.py" "$release" "$origin" --downloads
trap - EXIT HUP INT TERM
printf 'Deployed %s; stable updates remain unchanged until finalization. Recovery: %s\n' "$version" "$backup"
