# Deploying to Vercel (`pennypinchingtrivia.com`)

This repo is a monorepo with **three independently-deployable web surfaces**. On
Vercel each becomes its **own Project** pointed at a subdirectory (the "Root
Directory" setting), so they build and scale independently and can sit on
different domains/subdomains. DNS for `pennypinchingtrivia.com` lives at
Hostinger and points at Vercel.

> The mobile & desktop **native** apps are not web deploys — they ship through
> the App Store / Play Store / Electron packaging, not Vercel.

## The three projects

| Vercel project | Root Directory | Build | Output | Suggested domain |
|---|---|---|---|---|
| **Marketing site** | `website/` | _(none, static)_ | `.` | `pennypinchingtrivia.com` + `www.` |
| **Player web app** | `mobile/` | `npm run build:web` | `web-build/` | `play.pennypinchingtrivia.com` |
| **Command Center** | `command-center/` | `npm run build` | `dist/` | `admin.pennypinchingtrivia.com` |

Each directory already contains a `vercel.json` with the correct build command,
output dir, SPA rewrites, and cache headers — Vercel picks these up automatically
once the Root Directory is set. The apex-vs-subdomain choice below is made in the
Vercel dashboard (Domains tab), not in code, so it's trivial to change later.

### Recommended domain plan
- **Marketing at the apex** (`pennypinchingtrivia.com`) — the public front door.
- **Player app at `play.`** — where funded players actually play.
- **Command Center at `admin.`** — staff only (also protect it with Vercel
  Access / an allowlist; it's already gated by staff RBAC in Postgres).

If you'd rather the **player app** be the apex (fewer clicks for players), just
assign `pennypinchingtrivia.com` to the mobile project instead and move
marketing to `www.` or `about.` — no code change needed.

## One-time setup per project (Vercel dashboard)

1. **Add New… → Project → Import** this Git repo. (Do this three times, once per
   project above — Vercel lets one repo back multiple projects.)
2. In project **Settings → General → Root Directory**, set it to `website`,
   `mobile`, or `command-center` respectively. Leave "Include files outside the
   Root Directory" **off**.
3. Framework preset: Vercel auto-detects Vite for the command center; for the
   website and mobile app leave it as **Other** (the `vercel.json` handles it).
4. **Command Center only — Environment Variables** (Settings → Environment
   Variables), for Production + Preview:
   - `VITE_SUPABASE_URL` = `https://pkvdthwqvjpxhqorfpub.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = your Supabase **publishable** key
   (These are the same public values in `command-center/.env.example` — the
   publishable key is safe to expose; RLS + `is_staff()` do the real gating.)
   The **player app** reads Supabase config from `mobile/app.json` (`expo.extra`),
   so it needs no Vercel env vars. The marketing site needs none.
5. **Deploy.** Repeat for all three.

## DNS at Hostinger

In Hostinger's DNS zone editor for `pennypinchingtrivia.com`, add the records
Vercel shows you under each project's **Domains** tab. They'll be along these
lines (use the exact values Vercel displays — these can change):

| Type | Name/Host | Value |
|---|---|---|
| `A` | `@` (apex) | `76.76.21.21` |
| `CNAME` | `www` | `cname.vercel-dns.com` |
| `CNAME` | `play` | `cname.vercel-dns.com` |
| `CNAME` | `admin` | `cname.vercel-dns.com` |

Then, in each Vercel project → **Domains**, add the matching hostname and let
Vercel verify + issue the TLS cert. Propagation is usually minutes.

> **"Vercel middleware" note:** if you prefer a single Vercel project that routes
> by path/host with an Edge Middleware instead of three projects, that's possible
> but heavier — you'd merge the three build outputs and hand-write routing. The
> three-project split above is simpler, isolates failures, and lets each app
> deploy on its own. Recommended unless you have a specific reason to unify.

## Post-deploy wiring (Stripe redirect)

Once the **player app** has a real origin, point Stripe's return URLs at it so
checkout sends players back into the app:

- In **Supabase → Project Settings → Edge Functions → Secrets**, set
  `APP_PUBLIC_URL` = `https://play.pennypinchingtrivia.com` (or whatever origin
  you gave the player app), then redeploy the `create-checkout-session` function.
- Add that same origin to your **Stripe** allowed redirect/checkout domains.

See the root `README.md` ("Web MVP soft launch deployment") for the broader
launch checklist (geo-fence, KYC, etc.).

## Deploying updates

Every push to the production branch redeploys all three projects automatically
(each watches the same repo but only rebuilds when files under its Root Directory
change). Preview deployments are created for other branches/PRs.
