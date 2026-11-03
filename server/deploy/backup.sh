#!/bin/sh
# Run from server/deploy; output is a PostgreSQL custom archive.
set -eu
umask 077
if [ "$#" -ne 1 ]; then
  echo 'Usage: ./backup.sh /secure/path/agentdeck.dump' >&2
  exit 2
fi
if [ -e "$1" ]; then
  echo 'Backup destination already exists' >&2
  exit 2
fi
backup_temp=$(mktemp "$1.partial.XXXXXXXX")
trap 'rm -f -- "$backup_temp"' EXIT HUP INT TERM
docker compose exec -T postgres pg_dump -U agentdeck -d agentdeck --format=custom > "$backup_temp"
docker compose exec -T postgres pg_restore --list < "$backup_temp" > /dev/null
# Atomically refuse an existing destination, including a symlink created after
# the initial check. Both paths are in the same directory/filesystem.
ln -T -- "$backup_temp" "$1"
echo 'Database backup created. Keep the deployment environment and Caddy volume backups separately.'
