#!/usr/bin/env bash
# One-time setup of the Images Camera Club website on the shared Droplet. Run as root:
#   sudo bash setup-photoclub.sh https://icc.dualcrest.com
#
# It creates and touches ONLY photoclub things (user, /srv/photoclub*, photoclub service,
# its sudoers and cron files). It never changes the HRIS, the firewall, Node.js, the timezone,
# the Cloudflare tunnel or system packages. Safe to run again: finished steps are skipped.
set -euo pipefail

SITE_URL="${1:-https://icc.dualcrest.com}"
REPO="git@github.com:apsungahid/Images-Camera-Club.git"
APP=/srv/photoclub
BACKUPS=/srv/photoclub-backups
PORT=3001

say() { printf '\n==> %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Please run as root (sudo bash $0 $SITE_URL)"; exit 1; }

# Refuse to continue if something else already uses our port.
if ss -ltn "sport = :$PORT" | grep -q LISTEN && ! systemctl is-active --quiet photoclub; then
  echo "Port $PORT is already used by another program. Stopping without changes."; exit 1
fi
command -v node >/dev/null || { echo "Node.js is not installed (the HRIS uses the system Node 22)."; exit 1; }
command -v git >/dev/null || { echo "git is not installed."; exit 1; }

say "1/8 User and folders"
id photoclub >/dev/null 2>&1 || adduser --system --group --home /home/photoclub --shell /bin/bash photoclub
usermod -p '*' photoclub
install -d -o photoclub -g photoclub -m 700 /home/photoclub/.ssh "$BACKUPS"
install -d -o photoclub -g photoclub -m 755 "$APP"

say "2/8 Read-only deploy key for GitHub"
if [ ! -f /home/photoclub/.ssh/id_ed25519 ]; then
  sudo -u photoclub ssh-keygen -q -t ed25519 -N '' -C "photoclub-server" -f /home/photoclub/.ssh/id_ed25519
fi
grep -q github.com /home/photoclub/.ssh/known_hosts 2>/dev/null || sudo -u photoclub bash -c 'ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null'
if [ ! -d "$APP/.git" ]; then
  echo
  echo "Add this key in GitHub: apsungahid/Images-Camera-Club > Settings > Deploy keys > Add deploy key"
  echo "(title: photoclub-server, leave 'Allow write access' OFF):"
  echo
  cat /home/photoclub/.ssh/id_ed25519.pub
  echo
  read -r -p "Press Enter once the key is added in GitHub... " _
  sudo -u photoclub git clone --quiet --branch main "$REPO" "$APP"
fi

say "3/8 Packages"
sudo -u photoclub bash -c "cd $APP && npm ci --omit=dev --no-audit --no-fund --loglevel=error"

say "4/8 Settings (.env)"
install -d -o photoclub -g photoclub -m 755 "$APP/data" "$APP/uploads"
if [ ! -f "$APP/.env" ]; then
  SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
  NOINDEX=true
  case "$SITE_URL" in *imagescameraclub.com*) NOINDEX=false ;; esac
  sudo -u photoclub tee "$APP/.env" >/dev/null <<EOF
NODE_ENV=production
PORT=$PORT
SITE_URL=$SITE_URL
NOINDEX=$NOINDEX
SESSION_SECRET=$SECRET
DB_PATH=$APP/data/club.db
UPLOADS_DIR=$APP/uploads
FORMS_DIR=$APP/data/forms
PHOTO_LIMIT=50
WATERMARK=on
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
EOF
  chmod 600 "$APP/.env"
else
  echo "Keeping the existing $APP/.env"
fi

say "5/8 Service"
install -m 644 "$APP/deploy/photoclub.service" /etc/systemd/system/photoclub.service
systemctl daemon-reload
systemctl enable --now photoclub
systemctl restart photoclub

say "6/8 Permissions for automatic deploys"
cat > /etc/sudoers.d/photoclub <<'EOF'
photoclub ALL=(root) NOPASSWD: /usr/bin/systemctl restart photoclub, /usr/bin/systemctl status photoclub, /usr/bin/journalctl -u photoclub *
EOF
chmod 440 /etc/sudoers.d/photoclub
visudo -cf /etc/sudoers.d/photoclub >/dev/null
if [ ! -f /home/photoclub/.ssh/github_actions ]; then
  sudo -u photoclub ssh-keygen -q -t ed25519 -N '' -C "github-actions-photoclub" -f /home/photoclub/.ssh/github_actions
  sudo -u photoclub bash -c 'cat ~/.ssh/github_actions.pub >> ~/.ssh/authorized_keys; chmod 600 ~/.ssh/authorized_keys'
fi

say "7/8 Daily backup at 2:30 AM (the HRIS backs up at 2:00)"
cat > /etc/cron.d/photoclub-backup <<EOF
30 2 * * * photoclub cd $APP && /usr/bin/node scripts/backup.js $BACKUPS 14 >> $BACKUPS/backup.log 2>&1
EOF
chmod 644 /etc/cron.d/photoclub-backup

say "8/8 Checking it answers on port $PORT"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
    echo "Club website is up (after ${i}s)."
    echo "HRIS still: $(systemctl is-active hris 2>/dev/null || echo 'not found')"
    echo
    echo "Next:"
    echo " - Cloudflare: add public hostname ${SITE_URL#https://} -> HTTP localhost:$PORT on the existing tunnel."
    echo " - First administrator: sudo -u photoclub bash -c 'cd $APP && npm run create-admin -- \"Your Name\"'"
    echo " - For automatic deploys, the private key for the DEPLOY_SSH_KEY secret is in /home/photoclub/.ssh/github_actions"
    exit 0
  fi
  sleep 1
done
journalctl -u photoclub -n 40 --no-pager
exit 1
