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
  renderer gets no Node/Electron APIs beyond the two things `preload.js`
  exposes (see below).
- `setWindowOpenHandler` denies all in-app popups and routes anything that
  tries to `window.open` to the system browser instead - this is also how
  Google's OAuth consent screen gets opened (see below).
- `will-navigate` blocks the app window from being navigated to an untrusted
  origin. Only the local bundle (`file://`) and Stripe checkout
  (`checkout.stripe.com`, `js.stripe.com`) can navigate in place - Stripe
  doesn't mind rendering inside an embedded webview. Everything else opens in
  the system browser rather than hijacking the app window. Update the
  `ALLOWED_NAVIGATION_HOSTS` list in `main.js` if a new trusted in-window
  redirect target is added.

## Google sign-in (and why it doesn't just navigate the window)

Google's OAuth policy blocks its consent screen outright inside embedded
WebView user agents (Electron included) - "This browser or app may not be
secure." So `signInWithGoogle` (`mobile/src/contexts/AuthContext.tsx`) detects
it's running in Electron (`window.electronBridge`, exposed by `preload.js`)
and instead:

1. Calls `signInWithOAuth` with `skipBrowserRedirect: true` to get the Google
   URL back without navigating, then opens it with `window.open` - which
   `setWindowOpenHandler` in `main.js` routes to the user's real system
   browser via `shell.openExternal`.
2. The whole round trip (Google consent -> Supabase's callback -> final
   redirect) happens in that system browser tab, ending at a
   `pennypincher://auth-callback` URL instead of an `https://` one - `file://`
   isn't something Supabase's redirect allow-list can practically hold (it's a
   different absolute path per OS/install).
3. The OS treats that as a request to relaunch this app (`main.js` registers
   it via `app.setAsDefaultProtocolClient('pennypincher')` and handles both
   `open-url` on mac and the `second-instance` argv on Windows/Linux), which
   forwards the callback URL to the already-open renderer over `ipcRenderer`.
   `AuthContext` completes the session from it (`exchangeCodeForSession` for
   PKCE, `setSession` for implicit hash tokens - handled defensively either
   way since the client's flow type isn't pinned).

**Required one-time setup, not something this repo can configure:** add
`pennypincher://auth-callback` (or `pennypincher://**`) to Supabase Auth ->
URL Configuration -> Redirect URLs in the dashboard. Without it Supabase will
reject the redirect and sign-in will fail after the Google consent screen.

## Stripe checkout on desktop

`create-checkout-session`'s `success_url`/`cancel_url` are fixed `https://`
URLs computed server-side from `APP_PUBLIC_URL` (not from `window.location`),
so they were never actually broken by packaging. What differs on desktop:
Stripe checkout itself opens in the app window (`checkout.stripe.com` is
allowlisted), but its return to `success_url` is not an allowlisted host, so
`will-navigate` sends that hop to the system browser instead of reloading the
app - meaning the web build's `/wallet/success` polling effect
(`WalletScreen.tsx`) never fires here. Instead, `WalletScreen` refreshes the
balance whenever the Electron window regains focus (`onWindowFocus` from the
bridge), which covers the common case of alt-tabbing back after paying.

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
- **Google sign-in needs the Supabase dashboard step above done once** before
  it will work in a packaged build (see "Google sign-in").
- **Not tested against a live Google OAuth consent screen in this sandbox** -
  there's no way to complete a real browser-based Google login here. The code
  path (`skipBrowserRedirect` + `shell.openExternal` + custom-protocol
  deep-link + `exchangeCodeForSession`/`setSession`) is syntax- and
  type-checked but hasn't been exercised end-to-end; test it on a machine that
  can actually run the packaged app before shipping.
