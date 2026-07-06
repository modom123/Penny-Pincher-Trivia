# Penny Pincher Desktop (Mac/Windows)

Thin Electron shell around a web build of the same game client used on mobile
(`mobile/`, built with Expo + `react-native-web`) - one codebase, three targets
(iOS, Android, and now desktop).

## How it works

`npm run build-web` runs `expo export --platform web` from `mobile/` and drops the
static bundle into `desktop/web-build/`. `main.js` just opens a `BrowserWindow`
pointed at that bundle's `index.html` - no separate desktop-specific UI code exists
or should need to.

## Run locally

```bash
cd desktop
npm install
npm start   # builds the web bundle, then launches Electron
```

## Package a distributable

```bash
npm run dist   # runs electron-builder - see caveats below
```

## Known gaps

- **Electron's binary couldn't be downloaded in the sandbox this was built in**
  (network egress to Electron's release CDN was blocked, same class of restriction
  documented elsewhere in this repo for Supabase) - `npm install` completes everything
  except fetching the Electron binary itself. Run `npm install` again from an
  environment with normal internet access and it should complete cleanly; the
  `main.js`/`preload.js` scripts have been syntax-checked but not run in a real window.
- **No code signing / notarization configured.** Shipping a real installer needs an
  Apple Developer ID (macOS notarization) and a code-signing certificate (Windows
  SmartScreen) - `electron-builder`'s config in `package.json` is a starting point, not
  production-ready packaging.
- **Auto-update is not wired up.** Consider `electron-updater` before distributing this
  outside your own testing.
