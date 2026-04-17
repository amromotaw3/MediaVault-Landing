const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const USER_DATA   = app.getPath('userData');
const DATA_DIR    = path.join(USER_DATA, 'data');
const DATA_FILE   = path.join(DATA_DIR, 'appdata.json');
const BANNERS_DIR = path.join(USER_DATA, 'banners');
const TEMP_DIR    = path.join(USER_DATA, 'temp_downloads');

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

function loadData() {
  try { 
    if (fs.existsSync(DATA_FILE)) {
      const rawData = fs.readFileSync(DATA_FILE, 'utf-8');
      let data = JSON.parse(rawData);
      if (typeof data !== 'object' || data === null) {
        throw new Error('Invalid data structure: not an object');
      }
      console.log(`[STORE] Loaded data from ${DATA_FILE}. TMDB Key present: ${!!data.tmdbKey}`);
      return data;
    }
  } catch(e){ 
    console.error(`[STORE] Failed to load data (${e.message}). Creating backup...`);
    if (fs.existsSync(DATA_FILE)) {
      const backup = DATA_FILE + '.backup.' + Date.now();
      try { fs.copyFileSync(DATA_FILE, backup); console.log(`[STORE] Backup created: ${backup}`); } catch(err) { console.error(`[STORE] Backup failed: ${err.message}`); }
    }
  }
  console.log(`[STORE] No valid data file found, returning empty object.`);
  return {};
}

function saveData(data) {
  try { 
    ensureDir(DATA_DIR);
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); 
  } catch(e){ console.error(`[STORE] Failed to save data: ${e.message}`); }
}

function initStoreIpc(ipcMain) {
  ipcMain.handle('load-app-data', () => {
    console.log('[IPC] Handling load-app-data');
    return loadData();
  });
  ipcMain.handle('save-app-data', (e, data) => { 
    saveData(data); return true; 
  });


  ipcMain.handle('clean-missing-downloads', (e, history) => {
    if (!history || !history.length) return history;
    return history.filter(d => {
      if (d.status !== 'complete' || !d.path) return true;
      return fs.existsSync(d.path);
    });
  });
}

module.exports = {
  USER_DATA, DATA_DIR, DATA_FILE, BANNERS_DIR, TEMP_DIR,
  ensureDir, loadData, saveData, initStoreIpc
};
