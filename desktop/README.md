# Penny Pincher Desktop (Mac/Windows)

Thin Electron shell around a web build of the same game client used on mobile
(`mobile/`, built with Expo + `react-native-web`) - one codebase, three targets
(iOS, Android, and now desktop).

## How it works

`npm run build-web` runs `expo export --platform web` from `mobile/` and drops the
static bundle into `desktop/web-build/`. `main.js` opens a `BrowserWindow` pointed
at that bundle's `index.html` - no separate desktop-specific UI code exists or
should need to. The Supabase URL and publishable anon key are already baked into
`mobile/app.json` (`expo.extra`), so the web bundle needs no extra desktop-side
configuration.

## Run locally

```bash
cd desktop
npm install
npm start   # builds the web bundle, then launches Electron
```

## Package a distributable

```bash
npm run dist   # runs electron-builder - produces a .dmg (mac) / installer (win) in dist/
```

## Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` - the
  renderer gets no Node/Electron APIs. `preload.js` is intentionally empty; add
  `contextBridge.exposeInMainWorld` there if a future feature needs one.
- `setWindowOpenHandler` denies all in-app popups and routes anything that tries
  to `window.open` to the system browser instead.
- `will-navigate` blocks the app window from being navigated to an untrusted
  origin. Only the local bundle (`file://`) and a small allowlist - Google OAuth
  (`accounts.google.com`), the Supabase project itself, and Stripe checkout
  (`checkout.stripe.com`, `js.stripe.com`) - can navigate in place. Everything
  else opens in the system browser rather than hijacking the app window. Update
  the `ALLOWED_NAVIGATION_HOSTS` list in `main.js` if a new trusted redirect
  target (e.g. a different payment or auth provider) is added.

## Known gaps

- **Electron's binary can't be downloaded in this sandbox.** `npm install`
  fails downloading `node_modules/electron`'s prebuilt binary
  (`HTTPError: 403` from the release CDN, then npm rolls back `node_modules`
  entirely) - the sandbox's network policy doesn't allow that host. Every other
  package (including `electron-builder` and its dependencies) installs cleanly;
  only Electron's own binary fetch is blocked. Run `npm install` again from a
  machine with normal internet access and it completes; `main.js`/`preload.js`
  are syntax-checked (`node --check`) but have not been run in a real window in
  this environment.
- **No code signing / notarization configured.** Shipping a real installer needs
  an Apple Developer ID (macOS notarization) and a code-signing certificate
  (Windows SmartScreen) - `electron-builder`'s config in `package.json` is a
  starting point, not production-ready packaging.
- **Auto-update is not wired into the app.** `package.json`'s `build.publish`
  points at this GitHub repo (`modom123/Penny-Pincher-Trivia`) so
  `electron-builder --publish` has somewhere to push releases, but no
  `electron-updater` dependency or update-check code has been added to
  `main.js`. Add both before relying on auto-update in production.
- **Google/Stripe OAuth+checkout redirects assume an `https://` origin.**
  `signInWithGoogle` computes `redirectTo` from `window.location.origin`, which
  is `file://` inside the packaged app - Google/Stripe will reject a `file://`
  redirect URI. Sign-in/checkout that redirects away from the app will need a
  real redirect target (e.g. a custom protocol handler, or a hosted page that
  deep-links back) before those flows work end-to-end in the packaged desktop
  app; this is a product-flow gap, not a build issue.
