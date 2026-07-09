# Deploying the marketing website (automatic updates)

The site in `website/` is static HTML/CSS. To get **automatic updates**, connect the
GitHub repo to a static host that redeploys on every push. Below is the recommended
path (Netlify), plus a Cloudflare Pages alternative. The domain
`pennypinchingtrivia.com` stays registered at Hostinger — you only change DNS records.

> **Note — this is the marketing site only.** The playable web app (the Expo web export
> in `mobile/`) is a separate deploy; see the end of this doc.

## Decide the production branch first

The host deploys one branch and redeploys when that branch changes. Pick your mainline
(recommended: **`main`**) and make sure it holds the latest website copy, then point the
host at it. Every merge into that branch = an automatic redeploy.

---

## Option A — Netlify (recommended; keeps DNS at Hostinger)

1. Sign up at netlify.com and **"Add new site" → "Import an existing project" → GitHub**,
   authorize, and pick `modom123/Penny-Pincher-Trivia`.
2. Settings are auto-read from `netlify.toml` (publish dir `website`, no build). Set the
   **production branch** to your mainline (e.g. `main`). Deploy.
3. You'll get a `https://<name>.netlify.app` URL — confirm the site looks right.
4. **Custom domain:** Site → Domain management → add `pennypinchingtrivia.com` and
   `www.pennypinchingtrivia.com`.
5. **At Hostinger** (hPanel → Domains → DNS / Nameservers → DNS records), add:
   - **A** record: host `@` → `75.2.60.5` (Netlify's apex load balancer)
   - **CNAME** record: host `www` → `<name>.netlify.app`
   - Remove any conflicting existing `@`/`www` records pointing at Hostinger parking.
6. Netlify auto-provisions HTTPS (Let's Encrypt) once DNS resolves (minutes to a few hours).

Done — pushes to the production branch now redeploy automatically.

---

## Option B — Cloudflare Pages (free CDN; move nameservers)

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**, pick the
   repo.
2. Build settings: **Framework preset: None**, **Build command: empty**,
   **Build output directory: `website`**. Set the production branch. Deploy.
3. Add `pennypinchingtrivia.com` as a **Custom domain** in the Pages project.
4. **At Hostinger** (hPanel → Domains → Nameservers), change to Cloudflare's nameservers
   (Cloudflare shows the two `*.ns.cloudflare.com` values when you add the domain as a
   site). This moves DNS to Cloudflare; Pages then wires the records + SSL automatically.

---

## Verifying automatic updates

Make any edit under `website/`, commit, and push to the production branch. Within a
minute or two the host shows a new deploy and the live site updates. No manual upload,
no Hostinger file manager.

## The playable web app (separate, later)

The actual game runs from the Expo/React Native web export:
`cd mobile && npm run build:web` → static output in `mobile/web-build/`. Host it the same
way (e.g. a second Netlify/Pages project or a subdomain like `app.pennypinchingtrivia.com`
with publish dir `mobile/web-build` and build command `npm --prefix mobile run build:web`).
It also needs the Supabase URL/key as environment variables at build time.
