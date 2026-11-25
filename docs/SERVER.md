# Photography Club website: sharing the server with the HRIS

Give this file to the Photography Club project (put it in that repository, e.g. as `docs/SERVER.md`,
and copy the "Rules for Claude" section into its `CLAUDE.md`).

The club website will run on the **same DigitalOcean Droplet** as the Dual Crest HRIS
(https://hris.dualcrest.com), with its **own domain**. Both apps must be able to run, update and
restart without ever touching each other. This guide lists what is already taken on the server
and what the club website uses instead.

Placeholders used below. Replace them once they are decided:

| Placeholder | Meaning |
|---|---|
| `www.imagescameraclub.com` | the club website's domain |
| `apsungahid/Images-Camera-Club` | the club website's GitHub repository |
| `3001` | the club website's port (see "What is taken") |

---

## 1. What is already on the server (do not touch)

| Thing | HRIS (existing, leave alone) | Photo club (use this) |
|---|---|---|
| Linux user that runs the app | `hris` | `photoclub` |
| App folder | `/srv/hris` | `/srv/photoclub` |
| Backups folder | `/srv/hris-backups` | `/srv/photoclub-backups` |
| Port (localhost only) | `3000` | `3001` |
| systemd service | `hris` (`/etc/systemd/system/hris.service`) | `photoclub` |
| sudoers file | `/etc/sudoers.d/hris` | `/etc/sudoers.d/photoclub` |
| Daily backup cron | `/etc/cron.d/hris-backup` (2:00 AM) | `/etc/cron.d/photoclub-backup` (e.g. 2:30 AM) |
| Database | `/srv/hris/data/app.db` | its own file under `/srv/photoclub/` |
| Domain | `hris.dualcrest.com` | `www.imagescameraclub.com` |
| GitHub repository | `apsungahid/Soju-Framework` | `apsungahid/Images-Camera-Club` |
| GitHub deploy trigger | push to `main` of the HRIS repo | push to `main` of the club repo |
| SSH key GitHub Actions logs in with | `/home/hris/.ssh/github_actions` (may log in as `hris` only) | a new key for `photoclub` only |
| Read-only GitHub deploy key on the server | `/home/hris/.ssh/id_ed25519` | a new key in `/home/photoclub/.ssh/` |

**Never:**
- edit, restart, stop or delete anything named `hris` (service, user, folders, cron, sudoers);
- run the HRIS's `deploy/setup-server.sh`: it is for the HRIS only, and it would also upgrade the
  whole system;
- use port `3000`;
- run `cloudflared service install` again (the server has one tunnel already; see section 3);
- change the firewall (`ufw`). No web port is open on purpose: visits arrive through the
  Cloudflare Tunnel;
- change the server's Node.js version, timezone (Asia/Manila) or swap without asking the owner.
  These are shared by both apps.

**Shared by both apps** (changes here affect the HRIS too, so ask the owner first):
- Node.js 22 (installed system-wide; if the club needs another version, use a version manager
  for the `photoclub` user only, e.g. `nvm`, rather than replacing the system Node);
- the operating system and its automatic security updates;
- the `cloudflared` tunnel service;
- memory: the Droplet is **1 GB RAM / 1 CPU** with 1 GB swap. Two Node apps fit if the club site
  is light. If it will process or resize photos on the server, plan to resize the Droplet to
  2 GB (about US$12 a month). Store large photo files outside the app folder (or in DigitalOcean
  Spaces / another object store), and keep an eye on the 25 GB disk.

---

## 2. Server setup for the club website (one time, as root)

```bash
# 1. its own user and folders
adduser --system --group --home /home/photoclub --shell /bin/bash photoclub
usermod -p '*' photoclub   # no password, but SSH keys can log in (GitHub deploys)
install -d -o photoclub -g photoclub -m 700 /home/photoclub/.ssh /srv/photoclub-backups
install -d -o photoclub -g photoclub -m 755 /srv/photoclub

# 2. a read-only deploy key so the server can pull the club repository
sudo -u photoclub ssh-keygen -t ed25519 -N '' -C "photoclub-server" -f /home/photoclub/.ssh/id_ed25519
sudo -u photoclub bash -c 'ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts'
cat /home/photoclub/.ssh/id_ed25519.pub
#    -> GitHub: apsungahid/Images-Camera-Club > Settings > Deploy keys > Add (read-only)
sudo -u photoclub git clone --branch main git@github.com:apsungahid/Images-Camera-Club.git /srv/photoclub

# 3. its .env (PORT=3001, its own secrets and domain), readable only by photoclub
sudo -u photoclub nano /srv/photoclub/.env
chmod 600 /srv/photoclub/.env
```

**systemd service** `/etc/systemd/system/photoclub.service` (adjust `ExecStart` to the club app):

```ini
[Unit]
Description=Photography Club website
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=photoclub
Group=photoclub
WorkingDirectory=/srv/photoclub
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=TZ=Asia/Manila
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/srv/photoclub/data
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Add `/srv/photoclub/uploads` (or wherever photos are stored) to `ReadWritePaths` if the app
saves files.

```bash
systemctl daemon-reload
systemctl enable --now photoclub

# the photoclub user may restart and read only its own service
cat > /etc/sudoers.d/photoclub <<'EOF'
photoclub ALL=(root) NOPASSWD: /usr/bin/systemctl restart photoclub, /usr/bin/systemctl status photoclub, /usr/bin/journalctl -u photoclub *
EOF
chmod 440 /etc/sudoers.d/photoclub

# the key GitHub Actions deploys with: it may log in as photoclub only
sudo -u photoclub ssh-keygen -t ed25519 -N '' -C "github-actions-photoclub" -f /home/photoclub/.ssh/github_actions
sudo -u photoclub bash -c 'cat ~/.ssh/github_actions.pub >> ~/.ssh/authorized_keys; chmod 600 ~/.ssh/authorized_keys'
cat /home/photoclub/.ssh/github_actions   # -> the club repo's DEPLOY_SSH_KEY secret (section 4)
```

Check it answers before going further: `curl -I http://127.0.0.1:3001/`.

---

## 3. The domain (Cloudflare Tunnel, no new ports)

The server already runs **one** Cloudflare Tunnel (named `hris`). The club domain is added as a
second **public hostname on the same tunnel**. Nothing changes on the server.

1. Add the club domain to the **same Cloudflare account** (Cloudflare › Add a site, then change the
   domain's nameservers at its registrar to the two Cloudflare gives). A tunnel can only serve
   domains in its own Cloudflare account.
2. Cloudflare › **Zero Trust › Networks › Tunnels** › tunnel `hris` › **Public hostname** ›
   **Add a public hostname**: the club domain (and `www` if wanted), service **HTTP**, URL
   **`localhost:3001`**. Save. Cloudflare creates the DNS record and the certificate.
3. **Do not edit or delete** the existing `hris.dualcrest.com → localhost:3000` hostname.

---

## 4. Automatic deploys for the club website only

The club repository gets its **own** workflow and its **own** secrets. The HRIS deploys only when
its own `main` changes, and the club website deploys only when the club's `main` changes, so a
deploy of one never touches the other.

Club repository › **Settings › Secrets and variables › Actions**:

| Name | Value |
|---|---|
| `DEPLOY_HOST` | the Droplet's IP address (the same server) |
| `DEPLOY_SSH_KEY` | the private key printed in section 2 (`/home/photoclub/.ssh/github_actions`) |

`.github/workflows/deploy.yml` in the club repository (same pattern as the HRIS):

```yaml
name: Test and deploy
on:
  push:
    branches: [main]
  workflow_dispatch:
concurrency:
  group: deploy-photoclub
  cancel-in-progress: false
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm test
  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Update the server
        env:
          DEPLOY_HOST: ${{ secrets.DEPLOY_HOST }}
          DEPLOY_SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
        run: |
          install -d -m 700 ~/.ssh
          printf '%s\n' "$DEPLOY_SSH_KEY" > ~/.ssh/deploy_key && chmod 600 ~/.ssh/deploy_key
          ssh-keyscan -H "$DEPLOY_HOST" >> ~/.ssh/known_hosts 2>/dev/null
          ssh -i ~/.ssh/deploy_key -o BatchMode=yes "photoclub@$DEPLOY_HOST" 'bash /srv/photoclub/scripts/deploy.sh'
```

`scripts/deploy.sh` in the club repository works **only inside `/srv/photoclub`**, restarts
**only `photoclub`**, and checks **port 3001**:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /srv/photoclub
# back up the club database here first, into /srv/photoclub-backups
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
```

---

## 5. Rules for Claude (copy into the club repository's CLAUDE.md)

The same Claude account works on both projects. Claude keeps its notes per project folder, so
the HRIS rules do not carry over: this section gives the club project its own.

- This repository is the **Photography Club website** (`apsungahid/Images-Camera-Club`), served at
  `www.imagescameraclub.com` from `/srv/photoclub` on port `3001`, service `photoclub`.
- The same server also runs the **Dual Crest HRIS** (`/srv/hris`, port 3000, service `hris`,
  repository `apsungahid/Soju-Framework`). Never read, change, restart, deploy or push anything of
  the HRIS from this project.
- **`/deploy`** in this project means: run the tests; if they pass, commit and push this
  repository's work branch to **this repository's** `main`. GitHub Actions then deploys the club
  website only. Before pushing, check `git remote get-url origin` is `apsungahid/Images-Camera-Club`; if it is
  anything else, stop and say so.
- Only `/deploy` pushes to `main`. Other pushes go to the work branch.
- Never commit `.env`, databases, uploaded photos or other local data.

**Make `/deploy` a project skill, not a personal one.** Put it in the club repository at
`.claude/skills/deploy/SKILL.md` so it exists only in this project. (The HRIS's own `/deploy`
belongs only in the HRIS project folder for the same reason: a personal skill in `~/.claude/skills/`
shows up in every project.) A minimal version:

```markdown
---
name: deploy
description: Deploy the Photography Club website (www.imagescameraclub.com) by pushing the work branch to main of apsungahid/Images-Camera-Club. Only when the user types /deploy.
---

1. `git remote get-url origin` must be apsungahid/Images-Camera-Club. If not, STOP: this is not the club project.
2. Run the tests. If any fail, STOP and report; the live site stays as it is.
3. Commit any changes (never .env, databases, uploads).
4. `git fetch origin`; merge origin/main into the work branch if it is behind.
5. Push the work branch, then `git push origin <branch>:main`. Never force-push.
6. Reply with the commit now on main; GitHub Actions deploys it (the Actions tab shows the run).
```

---

## 6. Quick checks after the club website goes live

```bash
systemctl status hris photoclub     # both "active (running)"
curl -I http://127.0.0.1:3000/health  # HRIS still answers
curl -I http://127.0.0.1:3001/        # club website answers
free -h && df -h /                     # memory and disk
```

Then open both https://hris.dualcrest.com and the club domain in a browser.
