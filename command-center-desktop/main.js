const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

// Staff sign in via Supabase email/password (no third-party OAuth redirect in
// the command center today), so the only trusted navigation target besides
// our own local bundle is the Supabase project itself. Update this list if a
// future auth provider or payment redirect is added.
const ALLOWED_NAVIGATION_HOSTS = ['pkvdthwqvjpxhqorfpub.supabase.co'];

function isAllowedHost(hostname) {
  return ALLOWED_NAVIGATION_HOSTS.some(
    (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`)
  );
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: 'Penny Pincher Command Center',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#0f0f14',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

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
