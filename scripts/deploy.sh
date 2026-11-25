#!/usr/bin/env bash
# Runs ON THE SERVER as the photoclub user (called by GitHub Actions). Touches only /srv/photoclub.
set -euo pipefail
cd /srv/photoclub

# Back up the club database first (keeps 14 days).
if [ -f data/club.db ]; then
  ts=$(date +%Y%m%d-%H%M%S)
  sqlite3 data/club.db ".backup '/srv/photoclub-backups/club-${ts}.db'" 2>/dev/null \
    || cp data/club.db "/srv/photoclub-backups/club-${ts}.db"
  find /srv/photoclub-backups -name 'club-*.db' -mtime +14 -delete
fi

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
