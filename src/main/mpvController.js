// ─── mpvController.js ─── MediaVault v7.1 ────────────────────────────────────
// Manages mpv as a child process via JSON IPC (named pipe on Windows).
// Replaces the old transcoder.js — mpv plays everything natively, no re-encoding needed.

const mpvAPI = require('node-mpv');
const path = require('path');
const fs = require('fs');

let mpvInstance = null;
let mainWindow = null;
let timeUpdateInterval = null;

// Try to find mpv binary
function findMpvBinary() {
  // 1. Check if bundled with app
  const bundledPaths = [
    path.join(__dirname, '..', '..', 'mpv', 'mpv.exe'),
    path.join(__dirname, '..', '..', 'bin', 'mpv.exe'),
    path.join(process.resourcesPath || '', 'mpv', 'mpv.exe'),
  ];
  for (const p of bundledPaths) {
    if (fs.existsSync(p)) return p;
  }
  // 2. Fall back to system PATH (user-installed mpv)
  return null; // node-mpv will use 'mpv' from PATH
}

async function createMpvInstance() {
  if (mpvInstance) return mpvInstance;

  const binary = findMpvBinary();
  const opts = {
    audio_only: false,
    auto_restart: false,
    debug: false,
    verbose: false,
    socket: '\\\\.\\pipe\\mediavault-mpv-' + process.pid,
    time_update: 0.5,
  };

  if (binary) {
    opts.binary = binary;
  }

  const extraArgs = [
    '--no-osc',
    '--no-osd-bar',
    '--no-input-default-bindings',
    '--no-input-cursor',
    '--cursor-autohide=no',
    '--no-keepaspect-window',
    '--keepaspect=yes',
    '--ontop=no',
    '--title=MediaVault-MPV',
    '--force-window=yes',
    '--window-minimized=yes',
    '--autofit=100%',
    '--background=color',
    '--background-color=#000000',
    '--hwdec=auto-safe',
    '--vo=gpu',
    '--gpu-api=d3d11',
    '--hr-seek=yes',
    '--demuxer-max-bytes=150MiB',
    '--demuxer-max-back-bytes=75MiB',
    '--cache=yes',
    '--cache-secs=30',
  ];

  mpvInstance = new mpvAPI(opts, extraArgs);

  // Wire up events
  mpvInstance.on('timeposition', (time) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mpv-time-pos', time);
    }
  });

  mpvInstance.on('status', (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (status.property === 'pause') {
        mainWindow.webContents.send('mpv-paused', status.value);
      } else if (status.property === 'duration') {
        mainWindow.webContents.send('mpv-duration', status.value);
      } else if (status.property === 'volume') {
        mainWindow.webContents.send('mpv-volume-changed', status.value);
      }
    }
  });

  mpvInstance.on('stopped', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mpv-eof', true);
    }
  });

  mpvInstance.on('crashed', () => {
    console.error('[MPV] Player crashed');
    mpvInstance = null;
  });

  mpvInstance.on('quit', () => {
    console.log('[MPV] Player quit');
    mpvInstance = null;
  });

  return mpvInstance;
}

function initMpvController(ipcMain, getWin) {
  mainWindow = typeof getWin === 'function' ? getWin() : getWin;

  // ─── Start mpv ───
  ipcMain.handle('mpv-start', async () => {
    try {
      const mpv = await createMpvInstance();
      await mpv.start();
      
      // Observe key properties
      try { await mpv.observeProperty('pause'); } catch(e) {}
      try { await mpv.observeProperty('duration'); } catch(e) {}
      try { await mpv.observeProperty('volume'); } catch(e) {}
      
      console.log('[MPV] Started successfully');
      return { success: true };
    } catch (err) {
      console.error('[MPV] Failed to start:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ─── Load file ───
  ipcMain.handle('mpv-load-file', async (_event, filePath, options = {}) => {
    try {
      const mpv = await createMpvInstance();
      if (!mpv.isRunning()) {
        await mpv.start();
        try { await mpv.observeProperty('pause'); } catch(e) {}
        try { await mpv.observeProperty('duration'); } catch(e) {}
        try { await mpv.observeProperty('volume'); } catch(e) {}
      }

      await mpv.load(filePath);
      
      // Apply options
      if (options.startTime && options.startTime > 2) {
        // Small delay to let the file load before seeking
        setTimeout(async () => {
          try {
            await mpv.seek(options.startTime, 'absolute');
          } catch(e) {
            console.warn('[MPV] Seek after load failed:', e.message);
          }
        }, 300);
      }
      if (options.volume !== undefined) {
        await mpv.volume(options.volume);
      }
      if (options.audioTrack !== undefined) {
        await mpv.setProperty('aid', options.audioTrack + 1); // mpv is 1-indexed
      }
      if (options.paused) {
        await mpv.pause();
      }

      // Get track list after a short delay
      setTimeout(async () => {
        try {
          const trackCount = await mpv.getProperty('track-list/count');
          const tracks = { audio: [], video: [], subtitle: [] };
          for (let i = 0; i < trackCount; i++) {
            const type = await mpv.getProperty(`track-list/${i}/type`);
            let title = '';
            try { title = await mpv.getProperty(`track-list/${i}/title`); } catch(e) {}
            let lang = '';
            try { lang = await mpv.getProperty(`track-list/${i}/lang`); } catch(e) {}
            let codec = '';
            try { codec = await mpv.getProperty(`track-list/${i}/codec`); } catch(e) {}
            const selected = await mpv.getProperty(`track-list/${i}/selected`);
            
            tracks[type]?.push({
              index: i,
              id: await mpv.getProperty(`track-list/${i}/id`),
              title: title || `Track ${i + 1}`,
              lang: lang || '',
              codec: codec || '',
              selected: !!selected,
            });
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('mpv-tracks', tracks);
          }
        } catch(e) {
          console.warn('[MPV] Track enumeration failed:', e.message);
        }
      }, 500);

      return { success: true };
    } catch (err) {
      console.error('[MPV] Load failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ─── Play ───
  ipcMain.handle('mpv-play', async () => {
    try {
      if (mpvInstance && mpvInstance.isRunning()) {
        await mpvInstance.play();
        return { success: true };
      }
      return { success: false, error: 'MPV not running' };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // ─── Pause ───
  ipcMain.handle('mpv-pause', async () => {
    try {
      if (mpvInstance && mpvInstance.isRunning()) {
        await mpvInstance.pause();
        return { success: true };
      }
      return { success: false, error: 'MPV not running' };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // ─── Toggle Pause ───
  ipcMain.handle('mpv-toggle-pause', async () => {
    try {
      if (mpvInstance && mpvInstance.isRunning()) {
        await mpvInstance.togglePause();
        return { success: true };
      }
      return { success: false, error: 'MPV not running' };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // ─── Seek ───
  ipcMain.handle('mpv-seek', async (_event, timeSeconds) => {
    try {
      if (mpvInstance && mpvInstance.isRunning()) {
        await mpvInstance.seek(timeSeconds, 'absolute');
        return { success: true };
      }
      return { success: false, error: 'MPV not running' };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // ─── Seek Relative ───
  ipcMain.handle('mpv-seek-relative', async (_event, seconds) => {
    try {
      if (mpvInstance && mpvInstance.isRunning()) {
        await mpvInstance.seek(seconds);
        return { success: true };
      }
      return { success: false, error: 'MPV not running' };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // ─── Volume ───
  ipcMain.handle('mpv-volume', async (_event, level) => {
    try {
      if (mpvInstance && mpvInstance.isRunning()) {
        await mpvInstance.volume(level);
        return { success: true };
      }
      return { success: false, error: 'MPV not running' };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // ─── Mute ───
  ipcMain.handle('mpv-mute', async (_event, muted) => {
    try {
      if (mpvInstance && mpvInstance.isRunning()) {
        await mpvInstance.mute(muted);
        return { success: true };
      }
      return { success: false, error: 'MPV not running' };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // ─── Set Audio Track ───
  ipcMain.handle('mpv-set-audio-track', async (_event, trackId) => {
    try {
      if (mpvInstance && mpvInstance.isRunning()) {
        await mpvInstance.setProperty('aid', trackId);
        return { success: true };
      }
      return { success: false, error: 'MPV not running' };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // ─── Set Subtitle Track ───
  ipcMain.handle('mpv-set-subtitle-track', async (_event, trackId) => {
    try {
      if (mpvInstance && mpvInstance.isRunning()) {
        if (trackId === 'no' || trackId === false) {
          await mpvInstance.setProperty('sid', 'no');
        } else {
          await mpvInstance.setProperty('sid', trackId);
        }
        return { success: true };
      }
      return { success: false, error: 'MPV not running' };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // ─── Add External Subtitle ───
  ipcMain.handle('mpv-add-subtitle', async (_event, subPath) => {
    try {
      if (mpvInstance && mpvInstance.isRunning()) {
        await mpvInstance.addSubtitles(subPath);
        return { success: true };
      }
      return { success: false, error: 'MPV not running' };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // ─── Get Property ───
  ipcMain.handle('mpv-get-property', async (_event, prop) => {
    try {
      if (mpvInstance && mpvInstance.isRunning()) {
        const value = await mpvInstance.getProperty(prop);
        return { success: true, value };
      }
      return { success: false, error: 'MPV not running' };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // ─── Get Duration ───
  ipcMain.handle('mpv-get-duration', async () => {
    try {
      if (mpvInstance && mpvInstance.isRunning()) {
        const dur = await mpvInstance.getDuration();
        return { success: true, value: dur };
      }
      return { success: false, error: 'MPV not running' };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // ─── Get Time Position ───
  ipcMain.handle('mpv-get-time-pos', async () => {
    try {
      if (mpvInstance && mpvInstance.isRunning()) {
        const pos = await mpvInstance.getTimePosition();
        return { success: true, value: pos };
      }
      return { success: false, error: 'MPV not running' };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // ─── Is Running ───
  ipcMain.handle('mpv-is-running', async () => {
    return { running: !!(mpvInstance && mpvInstance.isRunning()) };
  });

  // ─── Stop (keep mpv idle) ───
  ipcMain.handle('mpv-stop', async () => {
    try {
      if (mpvInstance && mpvInstance.isRunning()) {
        await mpvInstance.stop();
        return { success: true };
      }
      return { success: false, error: 'MPV not running' };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // ─── Quit ───
  ipcMain.handle('mpv-quit', async () => {
    try {
      if (mpvInstance) {
        await mpvInstance.quit();
        mpvInstance = null;
      }
      return { success: true };
    } catch (err) {
      mpvInstance = null;
      return { success: false, error: err.message };
    }
  });

  // ─── Window visibility control ───
  ipcMain.handle('mpv-show-window', async () => {
    try {
      if (mpvInstance && mpvInstance.isRunning()) {
        await mpvInstance.setProperty('window-minimized', 'no');
        return { success: true };
      }
      return { success: false };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('mpv-hide-window', async () => {
    try {
      if (mpvInstance && mpvInstance.isRunning()) {
        await mpvInstance.setProperty('window-minimized', 'yes');
        return { success: true };
      }
      return { success: false };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // ─── Fullscreen ───
  ipcMain.handle('mpv-fullscreen', async (_event, enabled) => {
    try {
      if (mpvInstance && mpvInstance.isRunning()) {
        await mpvInstance.setProperty('fullscreen', enabled ? 'yes' : 'no');
        return { success: true };
      }
      return { success: false };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // ─── Set subtitle delay ───
  ipcMain.handle('mpv-sub-delay', async (_event, delaySec) => {
    try {
      if (mpvInstance && mpvInstance.isRunning()) {
        await mpvInstance.setProperty('sub-delay', delaySec);
        return { success: true };
      }
      return { success: false };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // ─── Set subtitle font size ───
  ipcMain.handle('mpv-sub-font-size', async (_event, size) => {
    try {
      if (mpvInstance && mpvInstance.isRunning()) {
        await mpvInstance.setProperty('sub-font-size', size);
        return { success: true };
      }
      return { success: false };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // Clean up on app exit
  const cleanup = async () => {
    if (timeUpdateInterval) clearInterval(timeUpdateInterval);
    if (mpvInstance) {
      try { await mpvInstance.quit(); } catch(e) {}
      mpvInstance = null;
    }
  };

  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  console.log('[MPV] Controller initialized');
}

module.exports = { initMpvController };
