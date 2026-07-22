const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

// Domains the app window is allowed to navigate to in-place: Trustly's
// hosted bank-authorization page (wallet top-ups, payouts, and identity
// verification all go through this one flow - see trustly-establish-bank-auth)
// - a first-party Trustly surface that doesn't mind rendering inside an
// embedded webview. Google OAuth deliberately does NOT navigate the app
// window at all (see AuthContext.signInWithGoogle): Google blocks its
// consent screen outright inside embedded/WebView user agents like this one,
// so that flow opens in the user's real system browser and only ever hands
// this window a pennypincher:// deep link at the very end. Anything not in
// this list tries to hijack the window instead of opening a real link, so it
// gets sent to the system browser instead - see will-navigate below.
//
// VERIFY: trustly.one is confirmed as Trustly's hosted-flow domain (sandbox
// is sandbox.trustly.one); confirm the exact production hostname their
// establish response actually redirects to before shipping a desktop build.
const ALLOWED_NAVIGATION_HOSTS = [
  'trustly.one',
  'sandbox.trustly.one',
];

// Custom protocol Supabase's OAuth callback redirects to instead of an https
// origin - file:// isn't an origin Supabase's redirect allow-list can
// practically hold, since it's a different absolute path per OS/install. Must
// also be added to Supabase Auth -> URL Configuration -> Redirect URLs (e.g.
// "pennypincher://**") for sign-in to complete; that's a dashboard setting,
// not something this file can configure.
const DEEP_LINK_SCHEME = 'pennypincher';

function isAllowedHost(hostname) {
  return ALLOWED_NAVIGATION_HOSTS.some(
    (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`)
  );
}

let mainWindow = null;

function forwardDeepLink(url) {
  if (mainWindow) mainWindow.webContents.send('deep-link', url);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 850,
    minWidth: 380,
    minHeight: 640,
    title: 'Penny Pinching Trivia',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#0f0f14',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.on('focus', () => win.webContents.send('window-focus'));

  // Never let the app open a real new BrowserWindow (no in-app feature needs
  // one); if the page ever calls window.open, hand it to the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Block the app window itself from being navigated to an untrusted origin
  // (e.g. via a compromised redirect chain). Our own local bundle and the
  // handful of trusted auth/payment domains navigate in place; the deep-link
  // scheme is handled directly (Electron can't render it); anything else
  // opens in the system browser instead of hijacking the app window.
  win.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    if (target.protocol === 'file:') return;
    if (target.protocol === `${DEEP_LINK_SCHEME}:`) {
      event.preventDefault();
      forwardDeepLink(url);
      return;
    }
    if (isAllowedHost(target.hostname)) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  win.loadFile(path.join(__dirname, 'web-build', 'index.html'));
}

// Deep links only work reliably with a single instance: a second launch (via
// OS protocol dispatch on Windows/Linux) hands its URL to this one instead of
// opening a second window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const deepLink = argv.find((arg) => arg.startsWith(`${DEEP_LINK_SCHEME}://`));
    if (deepLink) forwardDeepLink(deepLink);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);

  // macOS delivers the deep link via this event instead of a second launch.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    forwardDeepLink(url);
  });

  app.whenReady().then(() => {
    createWindow();
    // Windows/Linux: a cold launch via protocol dispatch carries the URL in argv.
    const deepLink = process.argv.find((arg) => arg.startsWith(`${DEEP_LINK_SCHEME}://`));
    if (deepLink) forwardDeepLink(deepLink);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
