#!/usr/bin/env bash
# Runs ON THE SERVER as the photoclub user (called by GitHub Actions). Touches only /srv/photoclub.
set -euo pipefail
cd /srv/photoclub

# Back up the database, photos and contest entries first (keeps 14 days).
node scripts/backup.js /srv/photoclub-backups 14 || echo "==> Backup failed; continuing with the update"

git fetch --quiet origin main
git reset --quiet --hard origin/main
npm ci --omit=dev --no-audit --no-fund --loglevel=error
sudo /usr/bin/systemctl restart photoclub
for i in $(seq 1 30); do
  curl -fsS http://127.0.0.1:3001/ >/dev/null 2>&1 && { echo "==> Up and answering (after ${i}s)"; exit 0; }
  sleep 1
done
sudo /usr/bin/journalctl -u photoclub -n 40 --no-pager
exit 1
