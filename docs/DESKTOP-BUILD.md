# Desktop Apps (Mac/Windows)

Two Electron shells, each wrapping an existing web build with no separate
desktop-specific UI code:

| App | Wraps | Location |
|---|---|---|
| Player app | `mobile/` (Expo + react-native-web) | `desktop/` |
| Command Center | `command-center/` (Vite + React) | `command-center-desktop/` |

Both follow the same pattern: a `build-web` npm script produces a static
bundle, `main.js` opens a single `BrowserWindow` pointed at that bundle's
`index.html`, and both are hardened the same way (see below). Each has its own
README with app-specific detail.

## Prerequisites

- Node.js + npm.
- **Normal internet access to `github.com`.** Electron's own prebuilt binary is
  fetched from its GitHub releases CDN during `npm install`. This repo's
  sandbox environment blocks that host, so `npm install` in either `desktop/`
  or `command-center-desktop/` fails there (`HTTPError: 403` fetching
  `node_modules/electron`, after which npm removes `node_modules` entirely).
  Every other dependency, including `electron-builder`, installs fine — only
  Electron's binary fetch needs a machine without that restriction.

## Build & run

```bash
cd desktop                  # or command-center-desktop
npm install
npm start                    # build-web, then launch Electron
npm run dist                  # build-web, then electron-builder -> dist/*.dmg / installer
```

## Security hardening (both apps)

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` — the
  renderer has no Node/Electron APIs. `preload.js` is intentionally empty.
- `setWindowOpenHandler` denies all in-app popups; any `window.open` call is
  routed to the system browser instead.
- `will-navigate` blocks the window from being navigated to an untrusted
  origin. Only the local bundle (`file://`) plus a short per-app allowlist in
  `main.js` (`ALLOWED_NAVIGATION_HOSTS`) can navigate in place:
  - Player app: Stripe checkout only. Google OAuth deliberately does **not**
    navigate the app window — see `desktop/README.md` § Google sign-in.
  - Command Center: the Supabase project only (staff sign in with
    email/password — no OAuth/payment redirect today).

## Supabase configuration

Neither app needs desktop-specific config — both already bake in the public
project URL + publishable anon key:
- Player app: `mobile/app.json` → `expo.extra` (read via `expo-constants`).
- Command Center: hardcoded fallback in `command-center/src/lib/supabase.ts`,
  used whenever `VITE_SUPABASE_*` env vars aren't set.

## Known gaps (both apps)

- **Can't produce a real installer in this sandbox** — see the Electron
  binary note above. The build config (icons, `dmg` background, NSIS options,
  a GitHub-releases `publish` placeholder) is ready; run `npm run dist` on a
  machine with normal internet access to get the actual `.dmg`/installer.
- **No code signing/notarization.** Needed for macOS Gatekeeper/notarization
  and Windows SmartScreen before distributing outside your own testing.
- **No auto-update wired into the app code.** `package.json`'s `build.publish`
  only gives `electron-builder --publish` somewhere to push releases; neither
  app has an `electron-updater` dependency or update-check call yet.
- **Player app only:** Google sign-in now goes through the system browser and
  a `pennypincher://` deep link back into the app (see `desktop/README.md`),
  but it needs a one-time dashboard step — add `pennypincher://auth-callback`
  to Supabase Auth's allowed Redirect URLs — and hasn't been exercised against
  a live Google consent screen in this sandbox (no way to complete that
  browser flow here). Test it end-to-end on a machine that can run the
  packaged app before shipping.
