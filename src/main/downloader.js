const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const axios = require('axios');
const { TEMP_DIR, ensureDir } = require('./store');
const { getMainWindow, showToastNotification } = require('./windowManager');

const activeDownloads = new Map();
let WebTorrent;
let wtClient = null;

async function getWT() {
  if (!WebTorrent) {
    const module = await import('webtorrent');
    WebTorrent = module.default;
  }
  return WebTorrent;
}

function isYouTubeUrl(url) { return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i.test(url); }

// yt-dlp supports 1000+ sites. We detect the most common social media platforms.
function isSocialMediaUrl(url) {
  return /^https?:\/\/(www\.)?(instagram\.com|tiktok\.com|twitter\.com|x\.com|facebook\.com|fb\.watch|vimeo\.com|dailymotion\.com|twitch\.tv|reddit\.com|soundcloud\.com|bilibili\.com|nicovideo\.jp|rumble\.com|streamable\.com|ok\.ru|vk\.com|vk\.video|snapchat\.com|pinterest\.com|linkedin\.com|threads\.net)\//i.test(url);
}

function isSupportedByYtDlp(url) {
  // Use yt-dlp for all HTTP/S downloads to utilize -N 8 parallel speeds
  return url.startsWith('http');
}
function formatBytes(bytes) { 
  if (!bytes) return '0 B'; 
  const k=1024, s=['B','KB','MB','GB']; 
  const i=Math.floor(Math.log(bytes)/Math.log(k)); 
  return (bytes/Math.pow(k,i)).toFixed(1)+' '+s[i]; 
}
let ffmpegPath = null;
try {
  const ffStatic = require('ffmpeg-static');
  if (ffStatic && fs.existsSync(ffStatic)) {
    ffmpegPath = ffStatic;
    if (app.isPackaged || __dirname.includes('app.asar')) {
      ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
    }
  }
} catch (e) {
  console.warn('[Downloader] Failed to find ffmpeg-static:', e.message);
}

async function extractFrame(videoPath, outputPath) {
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) return false;
  return new Promise((resolve) => {
    const { execFile } = require('child_process');
    execFile(ffmpegPath, [
      '-ss', '00:00:01',
      '-i', videoPath,
      '-vframes', '1',
      '-q:v', '2',
      '-y',
      outputPath
    ], (err) => {
      if (err) {
        console.error('[Downloader] Frame extraction failed:', err.message);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

async function downloadYouTube(url, outputPath, downloadId, displayName) {
  let cancelled = false, childProcess = null;
  const mainWindow = getMainWindow();
  const encodedUrl = encodeURI(url);
  activeDownloads.set(downloadId, { cancel: () => { cancelled = true; if (childProcess) childProcess.kill(); } });
  return new Promise((resolve, reject) => {
    mainWindow?.webContents?.send?.('download-progress', { id: downloadId, name: displayName, percent: 1, downloaded: 'Starting...', total: 'Fetching...', status: 'downloading' });
    const isPackaged = app.isPackaged || __dirname.includes('app.asar');
    let ytPath = path.join(__dirname, '..', '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
    if (isPackaged) ytPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
    if (!fs.existsSync(ytPath)) ytPath = 'yt-dlp';
    const outputTemplate = path.join(path.dirname(outputPath), downloadId + '.%(ext)s');
    const args = ['--no-playlist'];
    if (ffmpegPath && fs.existsSync(ffmpegPath)) {
      args.push('--ffmpeg-location', ffmpegPath, '-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', '--merge-output-format', 'mp4');
    } else {
      console.warn('[DL] FFmpeg not available, using best available format');
      args.push('-f', 'b[ext=mp4]/b');
    }
    // High-speed parallel connection with UA Headers & optimized buffer
    args.push('-o', outputTemplate, '--no-warnings', '--newline', '-N', '16', '--concurrent-fragments', '16', '--buffer-size', '1M', '--add-header', 'User-Agent: MediaVault/3.0', '--postprocessor-args', 'ffmpeg:-pix_fmt yuv420p', url);
    childProcess = require('child_process').spawn(ytPath, args);
    childProcess.stdout.on('data', (d) => { 
      if (cancelled) return; 
      const t = d.toString();
      const m = t.match(/\[download\]\s+([\d\.]+)%\s+of\s+[~]?([\d\.]+[a-zA-Z]+)(?:\s+at\s+([^\s]+))?/); 
      if (m) {
        mainWindow?.webContents?.send?.('download-progress', { id: downloadId, name: displayName, percent: parseFloat(m[1]).toFixed(1), downloaded: 'Downloading...', total: m[2], speed: m[3] || '', status: 'downloading' }); 
      }
    });
    childProcess.on('close', (code) => { 
      if (cancelled) return; 
      if (code === 0) {
        resolve();
      } else if (code === 143 || code === null) {
        console.log('[DL] YouTube download process killed');
      } else {
        reject(new Error(`YouTube download failed with code ${code}`));
      }
    });
    childProcess.on('error', (err) => { if (!cancelled) reject(err); });
  });
}


async function downloadThumbnail(url, outputPath) {
  if (!url) return false;
  try {
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.youtube.com/'
      },
      timeout: 10000
    });
    const ws = fs.createWriteStream(outputPath);
    response.data.pipe(ws);
    return new Promise((resolve) => {
      ws.on('finish', () => resolve(true));
      ws.on('error', () => resolve(false));
    });
  } catch (err) {
    console.error('[DL] Thumbnail fetch failed:', err.message);
    return false;
  }
}

function downloadDirect(url, outputPath, downloadId, displayName) {
  const encodedUrl = encodeURI(url);
  const proto = encodedUrl.startsWith('https') ? https : http;
  const mainWindow = getMainWindow();
  return new Promise((resolve, reject) => {
    const req = proto.get(encodedUrl, { headers: { 'User-Agent': 'MediaVault/3.0' } }, (res) => {
      // Handle redirects safely
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const newLocation = res.headers.location;
        // Prevent infinite loops
        if (newLocation && newLocation !== encodedUrl) {
          return downloadDirect(newLocation, outputPath, downloadId, displayName).then(resolve).catch(reject);
        }
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const totalBytes = parseInt(res.headers['content-length']) || 0;
      let downloadedBytes = 0, cancelled = false;
      const ws = fs.createWriteStream(outputPath);
      activeDownloads.set(downloadId, { cancel: () => { cancelled = true; req.destroy(); res.destroy(); ws.close(); } });
      res.on('data', chunk => { 
        if (cancelled) return; 
        downloadedBytes += chunk.length; 
        mainWindow?.webContents?.send?.('download-progress', { id: downloadId, name: displayName, percent: totalBytes > 0 ? +((downloadedBytes/totalBytes)*100).toFixed(1) : 0, downloaded: formatBytes(downloadedBytes), total: formatBytes(totalBytes), status: 'downloading' }); 
      });
      res.pipe(ws); ws.on('finish', () => { if (!cancelled) resolve(); });
      res.on('error', e => { if (!cancelled) reject(e); });
    });
    req.on('error', reject);
  });
}

async function downloadTorrent(magnet, outputPath, downloadId, displayName) {
  const WT = await getWT();
  if (!wtClient) wtClient = new WT({
    maxConns: 1000,
    maxWebConns: 250,
    dht: true,
    lsd: true,
    pex: true,
    tracker: true,
    utp: true // Enable uTP for better performance on restrictive networks
  });

  const bestTrackers = [
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://9.rarbg.com:2810/announce',
    'udp://open.stealth.si:80/announce',
    'udp://exodus.desync.com:6969/announce',
    'udp://tracker.openbittorrent.com:6969/announce',
    'udp://opentracker.i2p.rocks:6969/announce',
    'udp://tracker.torrent.eu.org:451/announce',
    'udp://tracker.moeking.me:6969/announce',
    'udp://tracker.bitsearch.to:1337/announce',
    'udp://www.torrent.eu.org:451/announce',
    'udp://retracker.akado.ru:2710/announce',
    'udp://tracker.tiny-vps.com:6969/announce',
    'udp://ipv4.tracker.harry.lu:80/announce',
    'udp://tracker.auctor.tv:6969/announce',
    'udp://tracker.monitorit4.me:6969/announce',
    'udp://bt1.archive.org:6969/announce',
    'udp://bt2.archive.org:6969/announce',
    'udp://tracker.leechers-paradise.org:6969/announce',
    'udp://tracker.dler.org:6969/announce',
    'udp://p4p.arenabg.ch:1337/announce',
    'udp://tracker.skyts.net:6969/announce',
    'http://tracker.files.fm:6969/announce',
    'udp://ipv4.tracker.harry.lu:80/announce',
    'udp://open.demonii.com:1337/announce',
    'udp://explodie.org:6969/announce',
    'udp://tracker1.bt-chat.com:6969/announce'
  ];

  function normalizeMagnet(uri, extraTrackers) {
    if (!uri.startsWith('magnet:')) return uri;
    let normalized = uri;
    extraTrackers.forEach(tr => {
      const trParam = 'tr=' + encodeURIComponent(tr);
      if (!normalized.includes(trParam)) {
        normalized += (normalized.includes('?') ? '&' : '?') + trParam;
      }
    });
    return normalized;
  }

  const magnetWithTrackers = normalizeMagnet(magnet, bestTrackers);

  const mainWindow = getMainWindow();

  return new Promise((resolve, reject) => {
    let cancelled = false;
    let metadataReceived = false;
    let lastProgressTime = Date.now();
    let startTime = Date.now();
    
    // Status Heartbeat: Update peer count even before metadata is received
    const heartbeatInterval = setInterval(() => {
      if (cancelled || metadataReceived) return; // Note: !torrent check removed because we want to show messages until it starts
      
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      let statusMsg = `Finding Peers...`;
      
      const peers = torrent ? torrent.numPeers : 0;
      
      if (peers > 0) {
        statusMsg = `Connecting to ${peers} peer${peers > 1 ? 's' : ''}...`;
      } else {
        if (elapsed > 10) statusMsg = `Searching trackers (${elapsed}s)...`;
        if (elapsed > 20) statusMsg = `Checking DHT & PEX networks...`;
        if (elapsed > 40) statusMsg = `Still searching (attempting deep discovery)...`;
        if (elapsed > 70) statusMsg = `Source might be slow or inactive (0 peers).`;
      }
      
      mainWindow?.webContents.send('download-progress', { 
        id: downloadId, 
        name: displayName, 
        percent: 0, 
        status: 'searching', 
        statusText: statusMsg 
      });
    }, 3000);

    // Watchdog: Timeout if no peers found within 120s
    const discoveryTimeout = setTimeout(() => {
      clearInterval(heartbeatInterval);
      if (!metadataReceived && !cancelled) {
        cancelled = true;
        try { wtClient.remove(torrent.infoHash); } catch(e) {}
        reject(new Error('Download failed: No peers found within 120s. The source might be dead or have 0 seeds.'));
      }
    }, 120000);

    let torrent;
    try {
      // Re-initialize client if needed with robust options
      if (!wtClient) wtClient = new WT({ dht: true, pex: true, lpd: true });
      torrent = wtClient.add(magnetWithTrackers, { path: path.dirname(outputPath) });
    } catch (e) {
      clearInterval(heartbeatInterval);
      clearTimeout(discoveryTimeout);
      reject(new Error('Failed to add torrent: ' + e.message));
      return;
    }

    // Attach events DIRECTLY on the torrent object (not inside callback)
    torrent.on('metadata', () => {
      metadataReceived = true;
      clearInterval(heartbeatInterval);
      clearTimeout(discoveryTimeout);
      
      if (torrent.files && torrent.files.length > 0) {
        const videoFiles = torrent.files.filter(f => f.name.match(/\.(mp4|mkv|avi|webm|mov)$/i));
        const largeVideos = videoFiles.filter(f => f.length > 50 * 1024 * 1024);

        if (largeVideos.length > 1) {
          // Season Pack: Deselect everything except the actual video episodes
          torrent.files.forEach(f => { if (!largeVideos.includes(f)) f.deselect(); });
          torrent.targetFile = null; // null implies batch mode
        } else {
          // Single Movie: Select only the largest file definitively
          const targetFile = torrent.files.reduce((prev, curr) => (prev.length > curr.length) ? prev : curr);
          torrent.files.forEach(f => { if (f !== targetFile) f.deselect(); });
          torrent.targetFile = targetFile;
        }
      }
      
      mainWindow?.webContents?.send?.('download-progress', { id: downloadId, name: displayName, percent: 0, status: 'metadata_ready', statusText: 'Metadata received...' });
    });

    torrent.on('ready', () => {
      metadataReceived = true;
      clearTimeout(discoveryTimeout);
    });

    torrent.on('download', () => {
      if (cancelled) return;
      metadataReceived = true;
      clearTimeout(discoveryTimeout);
      
      // Throttle UI updates to every 500ms
      const now = Date.now();
      if (now - lastProgressTime < 500) return;
      lastProgressTime = now;
      
      // Calculate true progress based on selection mode
      const progress = torrent.targetFile ? torrent.targetFile.progress : torrent.progress;
      const downloadedBytes = torrent.targetFile ? torrent.targetFile.downloaded : torrent.downloaded;
      const totalBytes = torrent.targetFile ? torrent.targetFile.length : torrent.length;

      mainWindow?.webContents.send('download-progress', { 
        id: downloadId, 
        name: displayName, 
        percent: (progress * 100).toFixed(1),
        downloaded: formatBytes(downloadedBytes),
        total: formatBytes(totalBytes),
        speed: formatBytes(torrent.downloadSpeed) + '/s',
        peers: torrent.numPeers,
        status: 'downloading'
      });
    });

    torrent.on('done', () => {
      if (cancelled) return;
      clearTimeout(discoveryTimeout);
      try {
        if (torrent.targetFile) {
          // Single file move
          const srcPath = path.join(path.dirname(outputPath), torrent.targetFile.path);
          if (fs.existsSync(srcPath) && srcPath !== outputPath) fs.copyFileSync(srcPath, outputPath);
        } else {
          // Season Pack: No renaming needed, keep the folder structure as is
        }
      } catch(e) { console.warn('[Downloader] File move error:', e.message); }
      resolve();
    });

    torrent.on('error', (err) => {
      clearTimeout(discoveryTimeout);
      if (!cancelled) reject(err);
    });

    activeDownloads.set(downloadId, { cancel: () => { cancelled = true; clearTimeout(discoveryTimeout); try { wtClient.remove(torrent.infoHash); } catch(e) {} } });
  });
}

function initDownloaderIpc(ipcMain) {
  ipcMain.handle('start-download', async (_e, opts) => {
    let { url, name, type, season, episode, isMusicMode } = opts;
    const mainWindow = getMainWindow();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    
    // Immediate feedback so the UI doesn't delay
    mainWindow?.webContents?.send?.('download-progress', { id, name: name || 'Initializing...', percent: 0, status: 'searching', statusText: 'Initializing...' });

    const isPackaged = app.isPackaged || __dirname.includes('app.asar');
    let ytPath = path.join(__dirname, '..', '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
    if (isPackaged) ytPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
    if (!fs.existsSync(ytPath)) ytPath = 'yt-dlp';

    const fetchInfo = (args) => new Promise((resolve, reject) => {
      const { exec } = require('child_process');
      exec(`"${ytPath}" ${args} "${url}"`, { maxBuffer: 1024 * 1024 * 50 }, (err, stdout) => {
        if (err) reject(err); else resolve(stdout.trim());
      });
    });

    // START METADATA FETCH IN BACKGROUND (NON-BLOCKING)
    let metadataPromise = null;
    if (url && (isMusicMode || (!name || name === ''))) {
      metadataPromise = (async () => {
        try {
          if (isMusicMode) {
            const jsonInfo = await fetchInfo('--print-json --skip-download --no-warnings');
            const info = JSON.parse(jsonInfo);
            const artist = info.artist || info.uploader || info.channel || (info.title.includes(' - ') ? info.title.split(' - ')[0].trim() : 'Unknown Artist');
            return {
              title: info.title || name,
              artist,
              album: info.album || 'Unknown Album',
              year: info.release_year || info.upload_date?.substring(0, 4) || '',
              coverUrl: info.thumbnail,
              sourceUrl: url,
              isVideoMusic: true
            };
          } else {
            const fetchedTitle = await fetchInfo('--get-title --no-warnings');
            return { title: fetchedTitle };
          }
        } catch (e) {
          console.error('[Downloader] Background metadata fetch failed:', e.message);
          return null;
        }
      })();
    }

    const safeName = (name || 'download').replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
    
    // Determine category
    let category = 'Social';
    const isMovie = opts.type === 'movie' || opts.mediaType === 'movie';
    const isSeries = opts.type === 'series' || opts.type === 'tv' || opts.mediaType === 'tv' || opts.type === 'anime' || opts.mediaType === 'anime';

    if (isMusicMode || opts.type === 'music' || opts.mediaType === 'music') {
        category = 'Music';
    } else if (isSeries || (season !== undefined && episode !== undefined && season !== null && episode !== null)) {
        category = 'Series';
    } else if (isMovie) {
        category = 'Movies';
    } else if (isYouTubeUrl(url) || isSocialMediaUrl(url)) {
        category = 'Social';
    } else {
        category = 'Downloads'; 
    }

    // --- SMART PATH RESOLUTION ---
    let rootDir = path.join(app.getPath('videos'), 'MediaVault');
    const profileName = opts.profileName || 'Default';
    const profileSafe = profileName.replace(/[<>:"/\\|?*]/g, '_');
    
    // Default fallback path
    let finalDir = path.join(rootDir, profileSafe, category);

    // If profile has custom library folders, try to pick the most relevant one
    if (opts.libraryFolders && Array.isArray(opts.libraryFolders) && opts.libraryFolders.length > 0) {
        let bestMatch = null;
        if (category === 'Movies') {
            bestMatch = opts.libraryFolders.find(f => f.toLowerCase().includes('movie') || f.toLowerCase().includes('film'));
        } else if (category === 'Series') {
            bestMatch = opts.libraryFolders.find(f => f.toLowerCase().includes('tv') || f.toLowerCase().includes('series') || f.toLowerCase().includes('show') || f.toLowerCase().includes('anime'));
        } else if (category === 'Music') {
            bestMatch = opts.libraryFolders.find(f => f.toLowerCase().includes('music') || f.toLowerCase().includes('audio'));
        } else if (category === 'Social') {
            bestMatch = opts.libraryFolders.find(f => f.toLowerCase().includes('social') || f.toLowerCase().includes('youtube') || f.toLowerCase().includes('video'));
        }
        
        // If we found a specific folder for this category, use it AS-IS (the user expects it to go there)
        // If not, use the first library folder as the root for the Default/{Category} structure
        if (bestMatch) {
            finalDir = bestMatch;
        } else {
            rootDir = opts.libraryFolders[0];
            finalDir = path.join(rootDir, category); // No extra profile naming if it's already a custom folder
        }
    }
    let finalName = `${safeName}.mp4`;
    
    // Smart Parsing & Routing
    let pSeason = season;
    let pEpisode = episode;
    
    if (category === 'Series') {
        // Attempt to parse missing S/E
        if (pSeason == null || pEpisode == null) {
            const seMatch = (name || '').match(/[Ss](\d{1,2})\s*[Ee](\d{1,4})/i) || (name || '').match(/[Ss]eason\s*(\d{1,2})\s*[Ee]pisode\s*(\d{1,4})/i);
            if (seMatch) {
                if (pSeason == null) pSeason = parseInt(seMatch[1], 10);
                if (pEpisode == null) pEpisode = parseInt(seMatch[2], 10);
            } else {
                const sMatch = (name || '').match(/[Ss](\d{1,2})\b/);
                if (sMatch && pSeason == null) pSeason = parseInt(sMatch[1], 10);
                const epMatch = (name || '').match(/(?:\s-\s|_[Ee][Pp]?\s*|^\s*0*)(\d{1,4})(?:v\d)?\b/);
                if (epMatch && pEpisode == null) pEpisode = parseInt(epMatch[1], 10);
            }
        }
        
        // Defaults for Anime/Series
        if (pSeason == null || Number.isNaN(pSeason)) pSeason = 1;
        if (pEpisode == null || Number.isNaN(pEpisode)) pEpisode = 1;

        const sNum = String(pSeason).padStart(2, '0');
        const eNum = String(pEpisode).padStart(2, '0');
        
        let showTitle = opts.title || name || safeName;
        // Clean title from standard tags
        showTitle = showTitle.replace(/[\[\(].*?[\]\)]/g, '').replace(/[._-]/g, ' ').replace(/[Ss]\d+.*$/i, '').trim();
        if (!showTitle) showTitle = safeName;
        showTitle = showTitle.replace(/[<>:"/\\|?*]/g, '_');
        
        finalDir = path.join(rootDir, profileSafe, 'Series', showTitle, `Season ${pSeason}`);
        finalName = `${showTitle} - S${sNum}E${eNum}.mp4`;
        
    } else if (category === 'Movies') {
        // Movie -> \Movies\Movie Title (Year)\Movie Title.mp4
        let movieTitle = opts.title || name || safeName;
        movieTitle = movieTitle.replace(/[\[\(].*?[\]\)]/g, '').replace(/[._-]/g, ' ').trim() || safeName;
        movieTitle = movieTitle.replace(/[<>:"/\\|?*]/g, '_');
        const yearTxt = opts.year ? ` (${opts.year})` : '';
        finalDir = path.join(rootDir, profileSafe, 'Movies', `${movieTitle}${yearTxt}`);
        finalName = `${movieTitle}.mp4`;
    }

    ensureDir(TEMP_DIR);
    if (!fs.existsSync(finalDir)) {
       fs.mkdirSync(finalDir, { recursive: true });
    }

    const tempPath = path.join(TEMP_DIR, `${id}.mp4`);
    let finalPath = path.join(finalDir, finalName);

    mainWindow?.webContents?.send?.('download-progress', { id, name: finalName, percent: 0, status: 'searching', statusText: 'Starting download...' });
    
    try {
      if (url.startsWith('magnet:') || (url.length === 40 && !url.includes(':'))) { await downloadTorrent(url, tempPath, id, finalName); }
      else if (isSupportedByYtDlp(url)) { await downloadYouTube(url, tempPath, id, finalName); }
      else { await downloadDirect(url, tempPath, id, finalName); }
      
      const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(id));
      if (files.length === 0) throw new Error('Download finished but no internal file was found.');
      const sourceFile = path.join(TEMP_DIR, files[0]), actualExt = path.extname(files[0]);
      if (actualExt !== '.mp4') { finalPath = finalPath.replace(/\.mp4$/i, actualExt); finalName = finalName.replace(/\.mp4$/i, actualExt); }
      
      // Secondary check: Ensure dir exists right before copying to prevent ENOENT
      if (!fs.existsSync(path.dirname(finalPath))) fs.mkdirSync(path.dirname(finalPath), { recursive: true });
      fs.copyFileSync(sourceFile, finalPath); 
      
      // Notify completion IMMEDIATELY - Don't wait for metadata tasks
      const mDataResolved = metadataPromise ? await Promise.race([
        metadataPromise,
        new Promise(r => setTimeout(() => r(null), 1500))
      ]).catch(() => null) : null;

      const fallbackTitle = mDataResolved?.title || name || finalName;
      mainWindow?.webContents?.send?.('download-complete', { id, name: fallbackTitle, path: finalPath, url });
      showToastNotification('Download Complete', fallbackTitle);
      activeDownloads.delete(id);

      // PERFORM METADATA TASKS IN BACKGROUND (Async)
      (async () => {
        try {
          const mData = metadataPromise ? await Promise.race([
            metadataPromise,
            new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 6000))
          ]).catch(() => null) : null;

          const metadataPath = finalPath + '.metadata.json';
          const coverPath = finalPath + '.cover.jpg';
          
          // GENERATE THUMBNAIL FROM VIDEO AS REQUESTED
          let hasCover = false;
          if (isMusicMode || category === 'Social') {
            hasCover = await extractFrame(finalPath, coverPath);
          }
          
          if (isMusicMode && mData) {
            const sidecar = { 
              ...mData, 
              cover: hasCover ? coverPath : (mData.coverUrl || ''), 
              downloadDate: new Date().toISOString() 
            };
            fs.writeFileSync(metadataPath, JSON.stringify(sidecar, null, 2));
          }
          
          // Signal the renderer to re-scan for the new cover/metadata
          mainWindow?.webContents?.send?.('metadata-ready', { path: finalPath });
        } catch (bgErr) {
          console.warn('[Downloader] Background tasks failed:', bgErr.message);
        }
      })();

      return { success: true, id, path: finalPath };
    } catch (err) {
      try { 
        const fList = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(id)); 
        for (const f of fList) fs.unlinkSync(path.join(TEMP_DIR, f)); 
      } catch (cleanErr) { 
        console.warn('[DL] Failed to clean temp dir:', cleanErr.message); 
      }
      activeDownloads.delete(id); 
      mainWindow?.webContents?.send?.('download-error', { id, name: finalName, error: err.message }); 
      return { success: false, id, error: err.message };
    }
  });

  ipcMain.handle('cancel-download', (_e, id) => { 
    const dl = activeDownloads.get(id); 
    if (dl?.cancel) { dl.cancel(); activeDownloads.delete(id); } 
    return true; 
  });

  ipcMain.handle('fetch-url-metadata', async (_e, url) => {
    return new Promise((resolve) => {
      const isPackaged = app.isPackaged || __dirname.includes('app.asar');
      let ytPath = path.join(__dirname, '..', '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
      if (isPackaged) ytPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
      if (!fs.existsSync(ytPath)) ytPath = 'yt-dlp';

      const cp = require('child_process').spawn(ytPath, ['--get-title', '--no-playlist', '--quiet', '--no-warnings', url]);
      let title = '';
      cp.stdout.on('data', d => title += d.toString());
      cp.on('close', (code) => {
        if (code === 0 && title.trim()) resolve({ success: true, title: title.trim() });
        else resolve({ success: false });
      });
      cp.on('error', () => resolve({ success: false }));
      // Timeout after 5 seconds to avoid hanging the UI
      setTimeout(() => { try { cp.kill(); } catch(e){} resolve({ success: false }); }, 5000);
    });
  });
}

module.exports = { initDownloaderIpc };
