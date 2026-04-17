const { dialog, shell, app } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const axios = require('axios');
const { BANNERS_DIR, ensureDir, loadData } = require('./store');
const { getMainWindow } = require('./windowManager');

let currentTmdbKey = null; // Removed hardcoded key
let currentSubdlKey = null; // New SubDL key
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
const JIKAN_BASE = 'https://api.jikan.moe/v4';

let metadataProvider = 'tmdb'; // 'tmdb' or 'mal'

function tmdbFetch(endpoint) {
  if (!currentTmdbKey) return Promise.resolve({ error: 'TMDB API key required. Please configure it in settings.' });
  const sep = endpoint.includes('?') ? '&' : '?';
  const url = `${TMDB_BASE}${endpoint}${sep}api_key=${currentTmdbKey}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'MediaVault/3.0' }, timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400 || json.success === false) {
            resolve({ error: json.status_message || `API Error ${res.statusCode}` });
          } else {
            resolve(json);
          }
        } catch {
          resolve({ error: 'Invalid response from TMDB' });
        }
      });
    });
    req.on('error', (err) => resolve({ error: 'Connectivity Error: ' + err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'TMDB Request Timed Out' }); });
  });
}

// Jikan API for MyAnimeList
async function jikanFetch(endpoint) {
  try {
    const url = `${JIKAN_BASE}${endpoint}`;
    const response = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'MediaVault/3.0' } });
    return response.data;
  } catch (err) {
    if (err.response?.status === 429) {
      return { error: 'Jikan API rate limited - please try again later' };
    }
    return { error: 'Jikan API Error: ' + (err.message || 'Unknown error') };
  }
}

function initMiscIpc(ipcMain) {
  // Initialize keys from store on startup
  const data = loadData();
  if (data.tmdbKey) currentTmdbKey = data.tmdbKey;
  if (data.subdlKey) currentSubdlKey = data.subdlKey;
  if (data.metadataProvider) metadataProvider = data.metadataProvider;
  
  ipcMain.handle('get-app-version', () => app.getVersion());

  ipcMain.handle('clear-cache', () => {
    try {
      if (fs.existsSync(BANNERS_DIR)) {
        for (const file of fs.readdirSync(BANNERS_DIR)) fs.unlinkSync(path.join(BANNERS_DIR, file));
      }
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('select-folder', async () => {
    const r = await dialog.showOpenDialog(getMainWindow(), { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('select-download-folder', async () => {
    const r = await dialog.showOpenDialog(getMainWindow(), { properties: ['openDirectory'], title: 'Select Download Location' });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('open-external', (_e, url) => { shell.openExternal(url); });

  ipcMain.handle('open-in-external-player', (_e, pathOrUrl) => {
    // If it's a local file path, open with default app. If it's a URL, open with external browser/player
    if (pathOrUrl.startsWith('http')) {
      shell.openExternal(pathOrUrl);
    } else {
      shell.openPath(pathOrUrl);
    }
  });

  ipcMain.handle('delete-file', async (_e, filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        await shell.trashItem(filePath);
        return { success: true };
      }
      return { success: false, error: 'File not found' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('open-subtitle-dialog', async () => {
    const r = await dialog.showOpenDialog(getMainWindow(), { properties: ['openFile'], title: 'Select Subtitle', filters: [{ name: 'Subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa'] }] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('set-custom-banner', async (_e, itemId) => {
    const r = await dialog.showOpenDialog(getMainWindow(), { properties: ['openFile'], title: 'Select Cover', filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }] });
    if (r.canceled || !r.filePaths.length) return null;
    ensureDir(BANNERS_DIR); const src = r.filePaths[0], ext = path.extname(src);
    const safe = Buffer.from(itemId).toString('base64').replace(/[/+=]/g, '_');
    const dest = path.join(BANNERS_DIR, safe + ext); fs.copyFileSync(src, dest); return dest;
  });

  ipcMain.handle('rename-file', (_e, oldPath, newName) => {
    try {
      const newPath = path.join(path.dirname(oldPath), newName);
      fs.renameSync(oldPath, newPath);
      return { success: true, newPath };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // TMDB handlers
  // UNIFIED Search (respects metadata provider)
  ipcMain.handle('tmdb-search', async (_e, type, query) => {
    try {
      return await tmdbFetch(`/search/${type}?query=${encodeURIComponent(query)}`);
    } catch (err) {
      return { results: [], error: err.message };
    }
  });

  ipcMain.handle('tmdb-details', async (_e, type, id) => {
    try {
      return await tmdbFetch(`/${type}/${id}?append_to_response=credits,videos,external_ids`);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('tmdb-trending', async () => {
    try {
      return await tmdbFetch('/trending/all/week');
    } catch (err) {
      return { results: [], error: err.message };
    }
  });

  ipcMain.handle('tmdb-popular', async (_e, type) => {
    try {
      return await tmdbFetch(`/${type}/popular`);
    } catch (err) {
      return { results: [], error: err.message };
    }
  });

  ipcMain.handle('tmdb-top-rated', async (_e, type) => {
    try {
      return await tmdbFetch(`/${type}/top_rated`);
    } catch (err) {
      return { results: [], error: err.message };
    }
  });

  ipcMain.handle('tmdb-upcoming', async () => { try { return await tmdbFetch('/movie/upcoming'); } catch (err) { return { results: [], error: err.message }; } });
  
  ipcMain.handle('tmdb-anime-featured', async () => {
    try {
      return await tmdbFetch('/discover/tv?with_genres=16&sort_by=popularity.desc');
    } catch (err) {
      return { results: [], error: err.message };
    }
  });
  ipcMain.handle('tmdb-credits', async (_e, type, id) => { try { return await tmdbFetch(`/${type}/${id}/credits`); } catch (err) { return { cast: [], error: err.message }; } });
  ipcMain.handle('tmdb-videos', async (_e, type, id) => { try { return await tmdbFetch(`/${type}/${id}/videos`); } catch (err) { return { results: [], error: err.message }; } });
  ipcMain.handle('tmdb-providers', async (_e, type, id) => { try { return await tmdbFetch(`/${type}/${id}/watch/providers`); } catch (err) { return { results: {}, error: err.message }; } });
  ipcMain.handle('tmdb-search-discover', async (_e, query) => {
    try {
      const q = query.trim();
      
      // If using MyAnimeList provider, search anime primarily
      if (metadataProvider === 'mal') {
        const result = await jikanFetch(`/anime?query=${encodeURIComponent(q)}&status=complete`);
        if (result.data) {
          return {
            results: result.data.map(anime => ({
              id: anime.mal_id,
              mal_id: anime.mal_id,
              name: anime.title,
              title: anime.title,
              poster_path: anime.images?.jpg?.image_url,
              overview: anime.synopsis,
              popularity: anime.score || 0,
              media_type: 'tv',
              source: 'mal'
            }))
          };
        }
        return result;
      }

      // TMDB Search (Movies & TV)
      // If it's an IMDB ID (e.g., tt1234567 or 26443616), use the /find endpoint first
      const imdbMatch = q.match(/^(tt)?(\d{7,9})$/);
      if (imdbMatch) {
        const imdbId = imdbMatch[1] ? q : `tt${imdbMatch[2]}`;
        const find = await tmdbFetch(`/find/${imdbId}?external_source=imdb_id`);
        const results = [];
        if (find.movie_results?.length) find.movie_results.forEach(r => results.push({ ...r, media_type: 'movie' }));
        if (find.tv_results?.length) find.tv_results.forEach(r => results.push({ ...r, media_type: 'tv' }));
        if (results.length > 0) return { results };
      }

      const [movies, shows] = await Promise.all([
        tmdbFetch(`/search/movie?query=${encodeURIComponent(q)}`),
        tmdbFetch(`/search/tv?query=${encodeURIComponent(q)}`)
      ]);
      return { results: [...(movies.results || []).map(r => ({ ...r, media_type: 'movie' })), ...(shows.results || []).map(r => ({ ...r, media_type: 'tv' }))] };
    } catch (err) { return { results: [], error: err.message }; }
  });
  ipcMain.handle('tmdb-season-details', async (_e, tvId, seasonNumber) => {
    try { return await tmdbFetch(`/tv/${tvId}/season/${seasonNumber}`); }
    catch (err) { return { episodes: [], error: err.message }; }
  });

  ipcMain.handle('tmdb-external-ids', async (_e, { id, type }) => {
    try { return await tmdbFetch(`/${type}/${id}/external_ids`); }
    catch (err) { return { error: err.message }; }
  });
  ipcMain.handle('tmdb-discover-by-genre', async (_e, genreId) => {
    try {
      // If using MyAnimeList, return popular anime instead
      if (metadataProvider === 'mal') {
        const result = await jikanFetch(`/anime?status=complete&orderBy=score&sort=desc&limit=40`);
        if (result.data) {
          return {
            results: result.data.map(anime => ({
              id: anime.mal_id,
              mal_id: anime.mal_id,
              name: anime.title,
              title: anime.title,
              poster_path: anime.images?.jpg?.image_url,
              overview: anime.synopsis,
              popularity: anime.score || 0,
              media_type: 'tv',
              source: 'mal'
            }))
          };
        }
        return result;
      }

      // Mapping table for genres that differ between Movie and TV
      // Movie ID -> TV ID (if different)
      const tvGenreMap = {
        '28': '10759', // Action (Movie) -> Action & Adventure (TV)
        '878': '10765', // Sci-Fi (Movie) -> Sci-Fi & Fantasy (TV)
        '27': '10765', // Horror (Movie) -> No exact TV match, use Sci-Fi/Fantasy as fallback or just keep original
      };

      const movieGenre = genreId;
      const tvGenre = tvGenreMap[genreId] || genreId;

      // Fetch both Movie and TV results
      const [movies, shows] = await Promise.all([
        tmdbFetch(`/discover/movie?with_genres=${movieGenre}&sort_by=popularity.desc`),
        tmdbFetch(`/discover/tv?with_genres=${tvGenre}&sort_by=popularity.desc`)
      ]);

      // Merge and tag results
      const results = [
        ...(movies.results || []).map(r => ({ ...r, media_type: 'movie' })),
        ...(shows.results || []).map(r => ({ ...r, media_type: 'tv' }))
      ];

      // Sort by popularity descending
      results.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

      return { results: results.slice(0, 40) };
    }
    catch (err) { return { results: [], error: err.message }; }
  });



  ipcMain.handle('download-image', async (_e, imgPath, itemId) => {
    if (!imgPath) return null;
    ensureDir(BANNERS_DIR);
    // Support both TMDB relative paths (/xyz.jpg) and full HTTP URLs (MAL, Jikan)
    let url;
    if (imgPath.startsWith('http://') || imgPath.startsWith('https://')) {
      url = imgPath;
    } else {
      url = `${TMDB_IMG}/w500${imgPath}`;
    }
    const safe = Buffer.from(String(itemId)).toString('base64').replace(/[/+=]/g, '_');
    const dest = path.join(BANNERS_DIR, safe + '.jpg');
    if (fs.existsSync(dest)) return dest;
    return new Promise((resolve) => {
      const file = fs.createWriteStream(dest);
      const proto = url.startsWith('https') ? https : require('http');
      const req = proto.get(url, { headers: { 'User-Agent': 'MediaVault/3.0' }, timeout: 10000 }, (res) => {
        if (res.statusCode !== 200) {
          file.close();
          try { fs.unlinkSync(dest); } catch (err) {
            console.warn('[IMG] Failed to unlink failed download:', err.message);
          }
          resolve(null);
          return;
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(dest); });
      });
      req.on('error', (err) => {
        file.close();
        try { fs.unlinkSync(dest); } catch (cleanErr) {
          console.warn('[IMG] Failed to clean failed download:', cleanErr.message);
        }
        resolve(null);
      });
      req.on('timeout', () => {
        req.destroy();
        file.close();
        try { fs.unlinkSync(dest); } catch (e) {}
        resolve(null);
      });
    });
  });

  ipcMain.handle('fetch-icon', async (_e, faviconUrl) => {
    try {
      const response = await fetch(faviconUrl);
      if (!response.ok) throw new Error('Failed to fetch icon');
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      const mime = response.headers.get('content-type') || 'image/x-icon';
      return `data:${mime};base64,${base64}`;
    } catch (err) { console.error('Icon fetch error:', err); return null; }
  });

  ipcMain.handle('is-media-link', (_e, url) => {
    const mediaExts = ['.mp4', '.mkv', '.avi', '.mov', '.mp3', '.wav', '.flac', '.srt', '.vtt'];
    try {
      const ext = path.extname(new URL(url).pathname).toLowerCase();
      return mediaExts.includes(ext);
    } catch (e) { return false; }
  });

  ipcMain.handle('save-frame', async (_e, { id, data }) => {
    try {
      ensureDir(BANNERS_DIR);
      const safe = Buffer.from(id).toString('base64').replace(/[/+=]/g, '_');
      const dest = path.join(BANNERS_DIR, safe + '.jpg');

      // Data is base64 string
      const base64Data = data.replace(/^data:image\/jpeg;base64,/, "");
      fs.writeFileSync(dest, base64Data, 'base64');
      return { path: dest };
    } catch (err) {
      console.error('Save frame error:', err);
      return { error: err.message };
    }
  });

  ipcMain.handle('get-profile-media-paths', (_e, profileName) => {
    if (!profileName) return null;
    const { app: electronApp } = require('electron');
    const p = (sub) => path.join(electronApp.getPath('videos'), 'MediaVault', profileName, sub);
    const paths = {
      movies: p('Movies'),
      series: p('Series'),
      social: p('Social'),
      music: p('Music')
    };
    console.log(`[BACKEND/INFO] Resolved Profile Media Paths for "${profileName}":`, paths);
    return paths;
  });

  ipcMain.handle('ensure-profile-folders', (_e, profileName) => {
    if (!profileName) return false;
    const { app: electronApp } = require('electron');
    const basePath = path.join(electronApp.getPath('videos'), 'MediaVault', profileName);
    const subDirs = ['Movies', 'Series', 'Social', 'Music'];
    
    try {
      subDirs.forEach(sub => {
        const fullPath = path.join(basePath, sub);
        if (!fs.existsSync(fullPath)) {
          fs.mkdirSync(fullPath, { recursive: true });
        }
      });
      return true;
    } catch (err) {
      console.error('[BACKEND] Failed to create profile folders:', err);
      return false; // graceful fail
    }
  });

  ipcMain.handle('select-user-avatar', async () => {
    const r = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openFile'],
      title: 'Select Avatar Image',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'png'] }]
    });
    if (r.canceled || !r.filePaths.length) return null;
    ensureDir(BANNERS_DIR);
    const src = r.filePaths[0], ext = path.extname(src);
    const dest = path.join(BANNERS_DIR, `avatar_${Date.now()}${ext}`);
    fs.copyFileSync(src, dest);
    return dest;
  });

  // ───────── METADATA PROVIDER MANAGEMENT ─────────
  ipcMain.handle('get-metadata-provider', () => metadataProvider);
  ipcMain.handle('set-metadata-provider', (_e, p) => {
    if (['tmdb', 'mal'].includes(p)) {
      metadataProvider = p;
      return true;
    }
    return false;
  });

  // ───────── TMDB KEY MANAGEMENT ─────────
  ipcMain.handle('set-tmdb-key', (_e, key) => {
    if (key && key.trim().length > 0) {
      currentTmdbKey = key.trim();
      console.log('[TMDB] API key updated');
      return true;
    }
    return false;
  });

  ipcMain.handle('get-tmdb-key-masked', () => {
    // Return masked version: show only first 2 and last 2 characters
    if (!currentTmdbKey) return '';
    if (currentTmdbKey.length <= 4) return '••••••••••••';
    return currentTmdbKey.substring(0, 2) + '••••••••••' + currentTmdbKey.substring(currentTmdbKey.length - 2);
  });

  ipcMain.handle('verify-tmdb-key', async (_e, key) => {
    // Test if the TMDB key is valid
    try {
      const testUrl = `${TMDB_BASE}/movie/550?api_key=${key}`;
      const response = await new Promise((resolve) => {
        https.get(testUrl, { timeout: 5000, headers: { 'User-Agent': 'MediaVault/3.0' } }, (res) => {
          resolve(res.statusCode);
        }).on('error', () => resolve(0));
      });
      return response === 200;
    } catch {
      return false;
    }
  });

  // ───────── SUBDL KEY MANAGEMENT ─────────
  ipcMain.handle('get-subdl-key', () => currentSubdlKey);
  ipcMain.handle('set-subdl-key', (_e, key) => {
    if (key && key.trim().length > 0) {
      currentSubdlKey = key.trim();
      return true;
    }
    return false;
  });

  ipcMain.handle('get-subdl-key-masked', () => {
    if (!currentSubdlKey) return '';
    if (currentSubdlKey.length <= 4) return '••••••••••••';
    return currentSubdlKey.substring(0, 2) + '••••••••••' + currentSubdlKey.substring(currentSubdlKey.length - 2);
  });

  ipcMain.handle('verify-subdl-key', async (_e, key) => {
    // Simple verification check to see if key exists and responds
    try {
      const testUrl = `https://api.subdl.com/api/v1/subtitles?api_key=${key}&type=movie&tmdb_id=550`;
      const response = await axios.get(testUrl, { timeout: 5000 });
      return response.status === 200;
    } catch { return false; }
  });

  // ───────── JIKAN API (MYANIMELIST) ─────────
  ipcMain.handle('mal-search', async (_e, query) => {
    if (!query.trim()) return { data: [] };
    try {
      const result = await jikanFetch(`/anime?query=${encodeURIComponent(query)}&status=complete`);
      return result;
    } catch (err) {
      return { error: err.message, data: [] };
    }
  });

  // ── Kitsu API (The Ultimate Anime Provider for Torrents) ──
  ipcMain.handle('kitsu-search', async (_e, query) => {
    try {
      const response = await axios.get(`https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(query)}`, {
        headers: { 'Accept': 'application/vnd.api+json' },
        timeout: 8000
      });
      const media = response.data?.data || [];
      
      const results = media.map(m => {
        const attr = m.attributes;
        return {
          id: m.id,
          title: attr.canonicalTitle || attr.titles?.en || attr.titles?.en_jp || 'Unknown',
          title_romaji: attr.titles?.en_jp,
          title_english: attr.titles?.en,
          overview: attr.synopsis,
          poster_path: attr.posterImage?.large || attr.posterImage?.original || '',
          backdrop_path: attr.coverImage?.large || attr.coverImage?.original || '',
          vote_average: attr.averageRating ? parseFloat(attr.averageRating) / 10 : 0,
          first_air_date: attr.startDate || '',
          media_type: 'anime', // explicitly mark as anime
          source: 'kitsu',
          episodes: attr.episodeCount || 1,
          status: attr.status,
          format: attr.subtype, // TV, MOVIE, OVA, etc.
          trailer: attr.youtubeVideoId ? { id: attr.youtubeVideoId, site: 'youtube' } : null
        };
      });
      return { results };
    } catch (err) {
      console.error('[Kitsu] Search error:', err.message);
      return { results: [], error: err.message };
    }
  });
  
  ipcMain.handle('kitsu-trending', async () => {
    try {
      const response = await axios.get(`https://kitsu.io/api/edge/trending/anime`, {
        headers: { 'Accept': 'application/vnd.api+json' },
        timeout: 8000
      });
      const media = response.data?.data || [];
      const results = media.map(m => {
        const attr = m.attributes;
        return {
          id: m.id,
          title: attr.canonicalTitle || attr.titles?.en || attr.titles?.en_jp || 'Unknown',
          name: attr.canonicalTitle || attr.titles?.en || 'Unknown',
          overview: attr.synopsis,
          poster_path: attr.posterImage?.large || attr.posterImage?.original || '',
          backdrop_path: attr.coverImage?.large || attr.coverImage?.original || '',
          vote_average: attr.averageRating ? parseFloat(attr.averageRating) / 10 : 0,
          first_air_date: attr.startDate || '',
          media_type: 'anime',
          source: 'kitsu',
          episodes: attr.episodeCount || 1,
          format: attr.subtype,
          status: attr.status
        };
      });
      return { results };
    } catch (err) {
      console.error('[Kitsu] Trending error:', err.message);
      return { results: [], error: err.message };
    }
  });

  ipcMain.handle('kitsu-cast', async (_e, id) => {
    try {
      const response = await axios.get(`https://kitsu.io/api/edge/anime/${id}/characters?include=character`, {
        headers: { 'Accept': 'application/vnd.api+json' },
        timeout: 8000
      });
      const included = response.data?.included || [];
      const cast = included.filter(item => item.type === 'characters').map(char => {
        return {
          id: char.id,
          name: char.attributes.canonicalName || char.attributes.name,
          character: 'Character',
          profile_path: char.attributes.image?.original || char.attributes.image?.large || char.attributes.image?.medium || ''
        };
      });
      return cast;
    } catch (err) {
      console.error('[Kitsu] Cast error:', err.message);
      return [];
    }
  });

  // NOTE: get-transcoded-url, probe-media, and get-subtitle-url are
  // registered by transcoder.js via initTranscoder() — do not duplicate here.
}

module.exports = { initMiscIpc };
