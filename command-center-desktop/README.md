# Penny Pincher Command Center Desktop (Mac/Windows)

Thin Electron shell around a build of `command-center/` (the staff dashboard -
game approval, question review, compliance, etc.), packaged as a desktop app so
staff can run it without a browser tab. Same one-codebase approach as
`desktop/` (the player app): no separate desktop-specific UI code.

## How it works

`npm run build-web` builds `command-center/` with Vite using `--base ./` (so
asset paths are relative, which `file://` loading requires) and
`--outDir ../command-center-desktop/web-build`, entirely separate from
`command-center/dist/` (what Vercel deploys). `main.js` opens a `BrowserWindow`
pointed at that bundle's `index.html`.

The Supabase URL and publishable anon key have a hardcoded fallback in
`command-center/src/lib/supabase.ts` (used whenever the `VITE_SUPABASE_*` env
vars aren't set), so the desktop build needs no extra configuration - same
public project the player app and `.env.example` already point at.

## Run locally

```bash
cd command-center-desktop
npm install
npm start   # builds the web bundle, then launches Electron
```

## Package a distributable

```bash
npm run dist   # runs electron-builder - produces a .dmg (mac) / installer (win) in dist/
```

## Security

Same hardening as `desktop/`:
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`;
  `preload.js` is intentionally empty.
- `setWindowOpenHandler` denies all in-app popups, routing any `window.open`
  attempt to the system browser.
- `will-navigate` restricts in-window navigation to the local bundle
  (`file://`) plus the Supabase project itself (`ALLOWED_NAVIGATION_HOSTS` in
  `main.js`) - staff sign in with Supabase email/password today, so there's no
  OAuth or payment redirect target to allowlist yet. Add one to that list if a
  future feature introduces one.

## Known gaps

Same sandbox limitation as `desktop/`: `npm install` cannot download
Electron's prebuilt binary here (network egress to its release CDN is
blocked), so `node_modules` never finishes installing in this environment
even though every other dependency (including `electron-builder`) resolves
fine. `main.js`/`preload.js` are syntax-checked (`node --check`) but not run
in a real window here. Run `npm install` from a machine with normal internet
access to build and package for real.

No code signing/notarization or auto-update wiring is configured -
`package.json`'s `build.publish` points at this GitHub repo as a placeholder
release target only.
