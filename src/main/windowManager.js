const { app, BrowserWindow, Notification, WebContentsView } = require('electron');
const path = require('path');

const { loadData, ensureDir } = require('./store');

let mainWindow;

function showToastNotification(title, body) {
  const icoPath = path.resolve(__dirname, '..', '..', 'imgs', 'appicon.ico');
  if (Notification.isSupported()) new Notification({ title, body, icon: icoPath }).show();
}

function createWindow() {
  const iconPath = path.resolve(__dirname, '..', '..', 'imgs', 'appicon.ico');

  mainWindow = new BrowserWindow({
    width: 1360, height: 860, minWidth: 960, minHeight: 640,
    frame: false, backgroundColor: '#ffffff',
    icon: iconPath,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload.js'),
      contextIsolation: true, 
      nodeIntegration: false, 
      webSecurity: true, // ✅ SECURITY FIX: Enabled web security
      webviewTag: false, // Disable webviewTag for security
      enableRemoteModule: false,
      sandbox: false
    }
  });
  
  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Background Mode: Hide on close
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });

  mainWindow.webContents.on('console-message', (event, level, message) => {
    const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
    console.log(`[RENDERER/${levels[level] || level}] ${message}`);
  });

  // ── Phase 1.1: WebContentsView Manager ──
  // Using WebContentsView as the modern replacement for the deprecated BrowserView
  /*
  const view = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Attach view to window
  // mainWindow.contentView.addChildView(view);

  // CRITICAL: Implement dynamic bounds resizing
  const updateBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const { width, height } = mainWindow.getBounds();
    // Accounting for a typical 45px frameless titlebar so the view fits perfectly.
    // view.setBounds({ x: 0, y: 45, width: width, height: height - 45 });
  };

  mainWindow.on('resize', updateBounds);
  mainWindow.on('maximize', updateBounds);
  mainWindow.on('restore', updateBounds);
  
  // Set initial bounds
  updateBounds();
  */



  // ── Automated Media Organizer ──
  if (mainWindow && mainWindow.webContents && mainWindow.webContents.session) {
    mainWindow.webContents.session.on('will-download', (event, item) => {
      try {
        const filename = item?.getFilename?.();
        if (!filename) {
          console.warn('[DOWNLOAD] No filename provided');
          return;
        }
        const data = loadData();
        const baseDir = data.downloadPath || (data.libraryFolders && data.libraryFolders[0]) || path.join(app.getPath('downloads'), 'MediaVault_Downloads');
    
    // Pattern detection: Series (S01E01, 1x01, or Anime episode numbering like - 03)
    const seriesMatch = filename.match(/(.*)[. ]S(\d{1,2})E(\d{1,3})/i) || 
                        filename.match(/(.*)[. ](\d{1,2})x(\d{1,3})/i) ||
                        filename.match(/(^.*)\s-\s(\d{1,3})/i); // Anime style
    
    let targetPath;
    if (seriesMatch) {
      const showName = seriesMatch[1].replace(/[\._]/g, ' ').replace(/\[.*?\]/g, '').trim();
      const seasonNum = seriesMatch[3] ? String(seriesMatch[2]).padStart(2, '0') : '01'; // Default to Season 01 for simple ep count
      const finalDir = path.join(baseDir, showName, `Season ${seasonNum}`);
      ensureDir(finalDir);
      targetPath = path.join(finalDir, filename);
    } else {
      // Movie detection: Try to clean title and put in its own folder or root Movies
      const cleanMovieName = filename.replace(/\.(mp4|mkv|avi|mov)$/i, '').replace(/[\._]/g, ' ').trim();
      const movieDir = path.join(baseDir, 'Movies', cleanMovieName);
      ensureDir(movieDir);
      targetPath = path.join(movieDir, filename);
    }

    item.setSavePath(targetPath);
    item.on('updated', (event, state) => {
      if (state === 'interrupted') showToastNotification('Download Interrupted', filename);
    });
    item.once('done', (event, state) => {
      if (state === 'completed') {
        showToastNotification('Download Complete', `Saved to ${targetPath}`);
        mainWindow?.webContents?.send?.('library-updated');
      } else if (state === 'cancelled') {
        console.warn('[DOWNLOAD] Download cancelled:', filename);
      }
    });
    
    item.on('error', (err) => {
      console.error('[DOWNLOAD] Item error:', err);
    });
  } catch (err) {
    console.error('[WINDOW] Download handler error:', err.message);
  }
  });
}

  return mainWindow;
}

function initWindowIpc(ipcMain) {
  ipcMain.on('win-minimize', () => mainWindow?.minimize());
  ipcMain.on('win-maximize', () => { mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize(); });
  ipcMain.on('win-close', () => mainWindow?.close());
  ipcMain.handle('set-fullscreen', (_e, flag) => { mainWindow?.setFullScreen(flag); return flag; });
  ipcMain.handle('is-fullscreen', () => mainWindow?.isFullScreen() ?? false);
}

function getMainWindow() {
  return mainWindow;
}

module.exports = { createWindow, initWindowIpc, getMainWindow, showToastNotification };
