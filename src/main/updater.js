const { autoUpdater } = require('electron-updater');
const { ipcMain } = require('electron');

function initUpdater(win) {
  // autoUpdater.autoDownload = false; // We can control this via settings if needed

  autoUpdater.on('checking-for-update', () => {
    win.webContents.send('update-status', { status: 'checking', msg: 'Checking for updates...' });
  });

  autoUpdater.on('update-available', (info) => {
    win.webContents.send('update-status', { 
      status: 'available', 
      msg: `Update Available: v${info.version}`,
      version: info.version
    });
  });

  autoUpdater.on('update-not-available', () => {
    win.webContents.send('update-status', { status: 'none', msg: 'App is up to date.' });
  });

  autoUpdater.on('error', (err) => {
    win.webContents.send('update-status', { status: 'error', msg: `Update Error: ${err.message}` });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    win.webContents.send('update-status', { 
      status: 'downloading', 
      percent: progressObj.percent.toFixed(1),
      speed: (progressObj.bytesPerSecond / 1024 / 1024).toFixed(2), // MB/s
      msg: `Downloading: ${progressObj.percent.toFixed(1)}%`
    });
  });

  autoUpdater.on('update-downloaded', () => {
    win.webContents.send('update-status', { 
      status: 'ready', 
      msg: 'Update Downloaded. Restart to apply.' 
    });
  });

  // IPC Listeners for Renderer
  ipcMain.handle('check-for-updates', async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return { success: true, result };
    } catch (err) {
      console.error('[UPDATER] Check failed:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('start-update-download', async () => {
    return await autoUpdater.downloadUpdate();
  });

  ipcMain.handle('restart-app-and-install', () => {
    autoUpdater.quitAndInstall();
  });
}

module.exports = { initUpdater };
