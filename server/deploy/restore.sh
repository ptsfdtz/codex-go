#!/bin/sh
# Restore into an empty database on a stopped/replacement deployment.
set -eu
if [ "$#" -ne 1 ] || [ ! -r "$1" ]; then
  echo 'Usage: ./restore.sh /secure/path/agentdeck.dump' >&2
  exit 2
fi
docker compose up -d --wait postgres
docker compose exec -T postgres pg_restore --list < "$1" > /dev/null
docker compose stop cloud
account_tables=$(docker compose exec -T postgres psql -U agentdeck -d agentdeck -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
if [ "$account_tables" -ne 0 ]; then
  echo 'Restore requires an empty database; existing data was preserved' >&2
  exit 2
fi
docker compose exec -T postgres pg_restore -U agentdeck -d agentdeck --no-owner --no-privileges --single-transaction --exit-on-error < "$1"
# A restored session must not resurrect a login revoked after the backup.
docker compose exec -T postgres psql -U agentdeck -d agentdeck -v ON_ERROR_STOP=1 -c 'UPDATE sessions SET revoked_at=now() WHERE revoked_at IS NULL' > /dev/null
docker compose up -d --wait
echo 'Restore completed. Clients must sign in again.'
