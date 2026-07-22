// Minimal bridge for the two things the packaged app needs that a plain web
// page can't do: receiving the OAuth deep-link callback (Google sign-in can't
// redirect to a file:// origin) and knowing when the window regains focus
// (so the wallet balance can refresh after a Trustly bank-authorization
// completes in the system browser). No other Node/Electron API is exposed to
// the renderer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronBridge', {
  isElectron: true,
  onDeepLink(callback) {
    const handler = (_event, url) => callback(url);
    ipcRenderer.on('deep-link', handler);
    return () => ipcRenderer.removeListener('deep-link', handler);
  },
  onWindowFocus(callback) {
    const handler = () => callback();
    ipcRenderer.on('window-focus', handler);
    return () => ipcRenderer.removeListener('window-focus', handler);
  },
});
