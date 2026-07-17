const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

// Domains the app window is allowed to navigate to in-place: Google OAuth
// (Supabase signInWithOAuth), the Supabase project itself (auth callback
// hop), and Stripe's hosted checkout (wallet top-ups). Everything else
// tries to hijack the window instead of opening a real link, so it gets
// sent to the user's system browser instead - see will-navigate below.
const ALLOWED_NAVIGATION_HOSTS = [
  'accounts.google.com',
  'pkvdthwqvjpxhqorfpub.supabase.co',
  'checkout.stripe.com',
  'js.stripe.com',
];

function isAllowedHost(hostname) {
  return ALLOWED_NAVIGATION_HOSTS.some(
    (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`)
  );
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

  // Never let the app open a real new BrowserWindow (no in-app feature needs
  // one); if the page ever calls window.open, hand it to the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Block the app window itself from being navigated to an untrusted origin
  // (e.g. via a compromised redirect chain). Our own local bundle and the
  // handful of trusted auth/payment domains navigate in place; anything
  // else opens in the system browser instead of hijacking the app window.
  win.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    if (target.protocol === 'file:') return;
    if (isAllowedHost(target.hostname)) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  win.loadFile(path.join(__dirname, 'web-build', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
