# Deployment (Ubuntu)

The app is fully static after the build: `dist/` contains plain
HTML/CSS/JS and needs no Node process at runtime. Node is required only
**at build time**. The recommended setup is nginx serving `dist/`.

Tested paths below assume Ubuntu 22.04/24.04, the app living in
`/opt/gedcom-visualizer` and nginx serving it on port 80.

## 1. Initial deployment

### Install prerequisites

```bash
sudo apt update
sudo apt install -y nginx rsync

# Node.js 20 LTS (build-time only) via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # v20+
```

### Get the code and build

```bash
sudo mkdir -p /opt/gedcom-visualizer
sudo chown "$USER": /opt/gedcom-visualizer

# copy the project to the server (from your machine):
#   rsync -a --delete --exclude node_modules --exclude dist \
#     ./ user@server:/opt/gedcom-visualizer/
# or clone it:
#   git clone <repo-url> /opt/gedcom-visualizer

cd /opt/gedcom-visualizer
npm ci            # reproducible install from package-lock.json
npm run build     # typecheck + build into dist/
```

### Configure nginx

`/etc/nginx/sites-available/gedcom-visualizer`:

```nginx
server {
    listen 80;
    server_name _;               # or your domain

    root /opt/gedcom-visualizer/dist;
    index index.html;

    # SPA has a single page; no history-API routes, so try_files is trivial
    location / {
        try_files $uri $uri/ =404;
    }

    # Hashed assets are immutable — cache aggressively
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # The entry point must always be revalidated
    location = /index.html {
        add_header Cache-Control "no-cache";
    }

    gzip on;
    gzip_types text/css application/javascript image/svg+xml;
}
```

```bash
sudo ln -s /etc/nginx/sites-available/gedcom-visualizer /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Open `http://<server>/` — the demo tree should render.

Notes:

- **HTTPS**: `sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx`.
- **Fonts**: Spectral/Manrope load from Google Fonts, so clients need
  internet access; without it the UI falls back to system fonts and the
  JPEG export falls back to Georgia (see [export.md](export.md)).
- No backend, no database, nothing else to run: GEDCOM files are parsed
  entirely in the browser and never leave the client.

## 2. Updating to a new version

After uploading the new code into the server folder, reinstall
dependencies and rebuild; nginx picks up the new files automatically —
**no service restart is required** for static content.

```bash
cd /opt/gedcom-visualizer

# 1. Upload the new version into this folder beforehand, e.g.
#    rsync -a --delete --exclude node_modules --exclude dist \
#      ./ user@server:/opt/gedcom-visualizer/
#    (--exclude keeps the server's node_modules and the currently served dist)
#    or: git pull

# 2. Install dependencies (safe to run every time; fast when unchanged)
npm ci

# 3. Rebuild
npm run build

# 4. Optional — only if you changed the nginx config itself
sudo nginx -t && sudo systemctl reload nginx
```

Because asset filenames are content-hashed and `index.html` is served with
`no-cache`, browsers fetch the new version on the next page load — no
cache flushing needed.

### Zero-downtime variant

`npm run build` clears `dist/` before writing, so for a few seconds nginx
may serve a half-written build. Usually irrelevant for this app; if it
matters, build aside and swap atomically:

```bash
cd /opt/gedcom-visualizer
npm ci
npx vite build --outDir dist-next
mv dist dist-prev && mv dist-next dist && rm -rf dist-prev
```

### One-shot update script

Save as `/opt/gedcom-visualizer/update.sh` and run after every upload:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /opt/gedcom-visualizer
npm ci
npx vite build --outDir dist-next
rm -rf dist-prev
mv dist dist-prev 2>/dev/null || true
mv dist-next dist
echo "Deployed. Previous build kept in dist-prev/ (rollback: swap back)."
```

Rollback after a bad deploy: `mv dist dist-bad && mv dist-prev dist`.
