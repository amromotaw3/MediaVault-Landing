const path = require('path');
const fs = require('fs');

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.avi', '.webm', '.mov', '.m4v', '.wmv', '.flv', '.3gp', '.mpg', '.mpeg', '.vob']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.flac', '.m4a', '.ogg', '.aac', '.wma']);
function isVideo(name) { return VIDEO_EXT.has(path.extname(name).toLowerCase()); }
function isAudio(name) { return AUDIO_EXT.has(path.extname(name).toLowerCase()); }

function parseEpisode(filename) {
  const base = path.basename(filename, path.extname(filename)).trim();
  let m;
  
  // Standard formats: S01E01, S1E1
  m = base.match(/[Ss](\d{1,2})\s*[Ee](\d{1,3})/);
  if (m) return { season: +m[1], episode: +m[2] };
  
  // Alternative format: 1x01, 01x01
  m = base.match(/(\d{1,2})[xX](\d{1,3})/);
  if (m) return { season: +m[1], episode: +m[2] };
  
  // Long format: Season 1 Episode 01
  m = base.match(/[Ss]eason\s*(\d{1,2}).*[Ee]pisode\s*(\d{1,3})/i);
  if (m) return { season: +m[1], episode: +m[2] };
  
  // Ep/Episode only format: Episode 01, Ep 01, E01
  m = base.match(/(?:[Ee]pisode|[Ee]p|[Ee])\s*(\d{1,3})\b/i);
  if (m) return { season: null, episode: +m[1] };
  
  // Fallback: dash format for anime - "Show Name - 01"
  m = base.match(/\s-\s(\d{1,3})\b/);
  if (m) return { season: null, episode: +m[1] };

  // NEW: Pure numeric filename - "01", "1", "001"
  m = base.match(/^(\d{1,3})$/);
  if (m) return { season: null, episode: +m[1] };
  
  // NEW: Ending with number - "Some Name 01"
  m = base.match(/\s(\d{1,3})$/);
  if (m) return { season: null, episode: +m[1] };
  
  return { season: null, episode: 0 };
}

function parseSeasonFromFolder(folderName) {
  let m;
  m = folderName.match(/season\s*(\d+)/i); if (m) return +m[1];
  m = folderName.match(/^s(\d{1,2})$/i);   if (m) return +m[1];
  m = folderName.match(/part\s*(\d+)/i);   if (m) return +m[1];
  m = folderName.match(/cour\s*(\d+)/i);   if (m) return +m[1];
  m = folderName.match(/^(\d{1,2})$/);     if (m) return +m[1];
  return null;
}

function extractCleanTitle(name) {
  let t = name.replace(/\.[^/.]+$/, '');
  t = t.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '');
  t = t.replace(/[\._]/g, ' ');
  t = t.replace(/\b(720p|1080p|2160p|4k|bluray|brrip|webrip|web-?dl|hdtv|dvdrip|x264|x265|hevc|aac|ac3|dts|hdrip|hdr|amzn|nf|remux|proper|repack|yts|yify|rarbg|10bit|8bit|5\.1|7\.1|subs?|dual|multi|extended|unrated|directors?.cut)\b/gi, '');
  t = t.replace(/\b[Ss]\d{1,2}[Ee]\d{1,3}\b/, '');
  t = t.replace(/[-–—]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return t;
}

// Extract year from filename for TMDB year-filtered search
function extractYearFromName(name) {
  // Match year in parentheses first: "Movie (2020)" or "Movie [2020]"
  let m = name.match(/[\(\[]((?:19|20)\d{2})[\)\]]/);
  if (m) return m[1];
  // Match standalone year: "Movie 2020 1080p"
  m = name.match(/\b((?:19|20)\d{2})\b/);
  if (m) return m[1];
  return null;
}

function walkDir(dir, maxDepth = 10, currentDepth = 0) {
  const out = [];
  if (currentDepth >= maxDepth) return out; // Prevent infinite recursion
  let entries; 
  try { 
    entries = fs.readdirSync(dir, { withFileTypes: true }); 
  } catch (err) { 
    console.warn(`[SCANNER] Cannot read directory ${dir}:`, err.message);
    return out; 
  }
  for (const e of entries) { 
    try {
      const p = path.join(dir, e.name); 
      if (e.isFile()) out.push(p); 
      else if (e.isDirectory()) out.push(...walkDir(p, maxDepth, currentDepth + 1));
    } catch (err) {
      console.warn(`[SCANNER] Error processing entry ${e.name}:`, err.message);
    }
  }
  return out;
}

function scanFolder(libraryPath) {
  const movies = [], shows = [];
  let entries; 
  try { 
    entries = fs.readdirSync(libraryPath, { withFileTypes: true }); 
  } catch (err) { 
    console.warn(`[SCANNER] Cannot scan folder ${libraryPath}:`, err.message);
    return { movies, shows }; 
  }
  for (const entry of entries) {
    const fullPath = path.join(libraryPath, entry.name);
    if (entry.isFile() && isVideo(entry.name)) {
      movies.push({ id: fullPath, title: path.basename(entry.name, path.extname(entry.name)), cleanTitle: extractCleanTitle(entry.name), year: extractYearFromName(entry.name), filename: entry.name, path: fullPath, type: 'movie' });
    } else if (entry.isDirectory()) {
      const folderEntries = fs.readdirSync(fullPath, { withFileTypes: true });
      const subDirs = folderEntries.filter(e => e.isDirectory());
      const episodes = [], parts = [];
      if (subDirs.length > 0) {
        for (const subDir of subDirs) {
          const subDirPath = path.join(fullPath, subDir.name);
          const folderSeason = parseSeasonFromFolder(subDir.name);
          const partEps = [];
          for (const file of walkDir(subDirPath)) {
            if (!isVideo(file)) continue;
            const parsed = parseEpisode(file);
            const season = folderSeason !== null ? folderSeason : (parsed.season !== null ? parsed.season : 1);
            const ep = { id: file, filename: path.basename(file), title: path.basename(file, path.extname(file)), path: file, season, episode: parsed.episode, partName: subDir.name };
            episodes.push(ep); partEps.push(ep);
          }
          if (partEps.length) parts.push({ name: subDir.name, count: partEps.length });
        }
        for (const f of folderEntries.filter(e => e.isFile() && isVideo(e.name))) {
          const pPath = path.join(fullPath, f.name);
          const parsed = parseEpisode(f.name);
          episodes.push({ id: pPath, filename: f.name, title: path.basename(f.name, path.extname(f.name)), path: pPath, season: parsed.season || 1, episode: parsed.episode, partName: 'Main' });
        }
      } else {
        for (const file of walkDir(fullPath)) {
          if (!isVideo(file)) continue;
          const parsed = parseEpisode(file);
          episodes.push({ id: file, filename: path.basename(file), title: path.basename(file, path.extname(file)), path: file, season: parsed.season || 1, episode: parsed.episode });
        }
      }
      if (episodes.length) {
        episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
        shows.push({ id: fullPath, title: entry.name, cleanTitle: extractCleanTitle(entry.name), year: extractYearFromName(entry.name), folder: fullPath, path: fullPath, filename: entry.name, episodes, parts, type: 'show' });
      }
    }
  }
  return { movies, shows };
}

async function scanMusic(musicPath) {
  if (!musicPath || !fs.existsSync(musicPath)) return [];
  const { parseFile } = await import('music-metadata');
  
  // Include both audio and video files in the music folder
  const files = walkDir(musicPath).filter(fp => isAudio(fp) || isVideo(fp));
  const out = [];

  for (const fp of files) {
    try {
      let metadata = { common: {}, format: {} };
      const sidecarPath = fp + '.metadata.json';
      let sidecarData = null;

      if (fs.existsSync(sidecarPath)) {
        try {
          sidecarData = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
        } catch (e) { console.warn('[SCANNER-MUSIC] Failed to parse sidecar:', sidecarPath); }
      }

      if (isAudio(fp)) {
        try {
          metadata = await parseFile(fp);
        } catch (e) { console.warn('[SCANNER-MUSIC] Failed to parse audio tags:', fp); }
      }

      const common = metadata.common || {};
      const localCoverPath = fp + '.cover.jpg';
      let coverBase64 = null;
      
      if (sidecarData?.cover && fs.existsSync(sidecarData.cover)) {
        // Read local cover file saved by downloader
        const buffer = fs.readFileSync(sidecarData.cover);
        coverBase64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
      } else if (fs.existsSync(localCoverPath)) {
        // Fallback to convention-based cover filename
        const buffer = fs.readFileSync(localCoverPath);
        coverBase64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
      } else if (common.picture && common.picture.length > 0) {
        // Fallback to embedded tags
        const pic = common.picture[0];
        coverBase64 = `data:${pic.format};base64,${pic.data.toString('base64')}`;
      } else if (sidecarData?.coverUrl) {
        // Final fallback to remote URL if absolutely necessary
        coverBase64 = sidecarData.coverUrl;
      }

      out.push({
        id: fp,
        path: fp,
        filename: path.basename(fp),
        title: sidecarData?.title || common.title || path.basename(fp, path.extname(fp)),
        artist: sidecarData?.artist || common.artist || 'Unknown Artist',
        album: common.album || 'Unknown Album',
        duration: metadata.format.duration || 0,
        cover: coverBase64,
        type: 'music',
        isVideoMusic: isVideo(fp) || !!sidecarData?.isVideoMusic
      });
    } catch (err) {
      console.warn(`[SCANNER-MUSIC] General failure for ${fp}:`, err.message);
    }
  }
  return out;
}

function initLibraryScannerIpc(ipcMain) {
  ipcMain.handle('scan-library', (_e, libraryPath) => scanFolder(libraryPath));
  ipcMain.handle('scan-youtube', (_e, youtubePath) => {
    if (!youtubePath) { console.warn('[SCANNER-BACKEND] youtubePath is null'); return []; }
    if (!fs.existsSync(youtubePath)) { console.warn(`[SCANNER-BACKEND] path does not exist: ${youtubePath}`); return []; }
    const files = walkDir(youtubePath).filter(isVideo);
    console.log(`[SCANNER-BACKEND] Found ${files.length} social videos in ${youtubePath}`);
    if (files.length > 0) console.log(`[SCANNER-BACKEND] Sample file: ${files[0]}`);
    return files.map(p => {
      const sidecarPath = p + '.metadata.json';
      const coverPath = p + '.cover.jpg';
      let sidecarData = null;
      let coverBase64 = null;

      if (fs.existsSync(sidecarPath)) {
        try { sidecarData = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8')); } catch (e) {}
      }

      if (sidecarData?.cover && fs.existsSync(sidecarData.cover)) {
        try {
          const buffer = fs.readFileSync(sidecarData.cover);
          coverBase64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
        } catch (e) {}
      } else if (fs.existsSync(coverPath)) {
        try {
          const buffer = fs.readFileSync(coverPath);
          coverBase64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
        } catch (e) {}
      } else if (sidecarData?.coverUrl) {
        coverBase64 = sidecarData.coverUrl;
      }

      return {
        id: p, path: p, filename: path.basename(p),
        title: sidecarData?.title || path.basename(p, path.extname(p)),
        type: 'social',
        cover: coverBase64,
        artist: sidecarData?.artist || 'Social Media'
      };
    });
  });
  
  ipcMain.handle('scan-music', (_e, musicPath) => scanMusic(musicPath));
  
  ipcMain.handle('find-subtitles', (_e, videoPath) => {
    const dir = path.dirname(videoPath), base = path.basename(videoPath, path.extname(videoPath)).toLowerCase();
    const result = [];
    try { 
      for (const f of fs.readdirSync(dir)) { 
        const ext = path.extname(f).toLowerCase(); 
        const stem = path.basename(f, ext).toLowerCase(); 
        if (['.srt', '.vtt', '.ass', '.ssa'].includes(ext) && stem.startsWith(base)) {
          result.push({ path: path.join(dir, f), filename: f, format: ext.slice(1) });
        } 
      } 
    } catch (err) { 
      console.warn('[SCANNER] Failed to read subtitle directory:', err.message); 
    }
    return result;
  });
  
  ipcMain.handle('read-subtitle-file', (_e, fp) => { 
    try { 
      const buf = fs.readFileSync(fp);
      let str = buf.toString('utf8');
      
      // Heuristic: If Node's UTF-8 decoder produces Replacement Characters, it's likely a legacy encoding
      if (str.includes('\uFFFD')) {
        const decoder = new TextDecoder('windows-1256');
        str = decoder.decode(buf);
      }
      return str;
    } catch (err) { 
      console.warn('[SCANNER] Failed to read subtitle file:', err.message); 
      return null; 
    } 
  });
}

module.exports = { initLibraryScannerIpc, extractCleanTitle };
