const path = require('path');
const fs = require('fs');
const { app } = require('electron');

/**
 * Subtitle System: Local-First Implementation (Tangible Library)
 * This system stores subtitles in the user's actual profile folder (e.g., Documents/MediaVault/ProfileName/Subtitles)
 * so they are visible and manageable by the user.
 */

function getProfileSubPath(profileName, libraryRoot, subDir = '') {
  // Use user-specified library root or fallback to default Videos/MediaVault
  let root = libraryRoot;
  if (!root || root === 'undefined') {
    root = path.join(app.getPath('videos'), 'MediaVault');
  }
  const safeName = (profileName || 'Default').replace(/[<>:"/\\|?*]/g, '_');
  const base = path.join(root, safeName, 'Subtitles');
  if (subDir) return path.join(base, subDir);
  return base;
}

function initSubtitlesIpc(ipcMain) {
  
  // List all subtitle files and folders in the user's tangible profile library
  ipcMain.handle('list-profile-subtitles', async (_e, { profileName, libraryRoot, subDir }) => {
    try {
      const profilePath = getProfileSubPath(profileName, libraryRoot, subDir);
      
      if (!fs.existsSync(profilePath)) {
        fs.mkdirSync(profilePath, { recursive: true });
        return [];
      }
      
      const entries = fs.readdirSync(profilePath, { withFileTypes: true });
      return entries
        .filter(ent => {
           if (ent.isDirectory()) return true;
           const f = ent.name.toLowerCase();
           return f.endsWith('.srt') || f.endsWith('.vtt') || f.endsWith('.ass');
        })
        .map(ent => {
          const fullPath = path.join(profilePath, ent.name);
          const stats = fs.statSync(fullPath);
          return {
            name: ent.name,
            path: fullPath,
            size: stats.size,
            isDir: ent.isDirectory()
          };
        })
        .sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
    } catch (err) {
      console.error('[SUB-LIBRARY] Failed to list subtitles:', err);
      return [];
    }
  });

  // Create a new folder in the tangible profile library
  ipcMain.handle('create-subtitle-folder', async (_e, { profileName, libraryRoot, folderName, parentDir }) => {
    try {
      const base = getProfileSubPath(profileName, libraryRoot, parentDir);
      const safeDir = folderName.replace(/[<>:"/\\|?*]/g, '_');
      const fullPath = path.join(base, safeDir);
      
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
      return { success: true };
    } catch (err) {
      console.error('[SUB-LIBRARY] Folder creation failed:', err);
      return { success: false, error: err.message };
    }
  });

  // Save a dropped or selected subtitle file to the tangible profile library
  ipcMain.handle('save-subtitle-local', async (_e, { profileName, libraryRoot, filePath, subDir }) => {
    try {
      const profilePath = getProfileSubPath(profileName, libraryRoot, subDir);
      
      if (!fs.existsSync(profilePath)) {
        fs.mkdirSync(profilePath, { recursive: true });
      }

      const fileName = path.basename(filePath);
      const destPath = path.join(profilePath, fileName);
      
      fs.copyFileSync(filePath, destPath);
      console.log(`[SUB-LIBRARY] Subtitle saved to: ${destPath}`);
      return { success: true, path: destPath };
    } catch (err) {
      console.error('[SUB-LIBRARY] Save failed:', err);
      return { success: false, error: err.message };
    }
  });


  // Delete from tangible library
  ipcMain.handle('delete-subtitle-local', async (_e, { profileName, libraryRoot, fileName, subDir }) => {
    try {
      const subPath = path.join(getProfileSubPath(profileName, libraryRoot, subDir), fileName);
      if (fs.existsSync(subPath)) {
        if (fs.statSync(subPath).isDirectory()) {
          fs.rmSync(subPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(subPath);
        }
      }
      return true;
    } catch (err) {
      console.error('[SUB-LIBRARY] Delete failed:', err);
      return false;
    }
  });

  // Rename a subtitle file/folder in the library
  ipcMain.handle('rename-subtitle-local', async (_e, { profileName, libraryRoot, oldName, newName, subDir }) => {
    try {
      const profilePath = getProfileSubPath(profileName, libraryRoot, subDir);
      const oldPath = path.join(profilePath, oldName);
      const newPath = path.join(profilePath, newName);

      if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
        return { success: true };
      }
      return { success: false, error: 'Original item not found' };
    } catch (err) {
      console.error('[SUB-LIBRARY] Rename failed:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('move-subtitle-local', async (_e, { profileName, libraryRoot, fileName, fromDir, toDir }) => {
    try {
      const sourcePath = path.join(getProfileSubPath(profileName, libraryRoot, fromDir), fileName);
      const targetDir = getProfileSubPath(profileName, libraryRoot, toDir);
      const destPath = path.join(targetDir, fileName);

      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      
      if (fs.existsSync(sourcePath)) {
        fs.renameSync(sourcePath, destPath);
        return { success: true };
      }
      return { success: false, error: 'Source file not found' };
    } catch (err) {
      console.error('[SUB-LIBRARY] Move failed:', err);
      return { success: false, error: err.message };
    }
  });
}

module.exports = { initSubtitlesIpc };
