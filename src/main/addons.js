const { app, net } = require('electron');
const path = require('path');

let WebTorrent;
let client = null;
let torrentServer = null;
const http = require('http'); // Required for custom streaming server

async function getWebTorrent() {
    if (!WebTorrent) {
        const module = await import('webtorrent');
        WebTorrent = module.default;
    }
    return WebTorrent;
}

function initAddonsIpc(ipcMain, store) {
    // IPC: Search for streams from various add-ons
    ipcMain.handle('search-addons', async (_e, { imdbId, tmdbId, type, season, episode, title }) => {
        const results = [];
        const appData = store.get('appData') || {};
        const sc = appData.scraperConfig || {};
        const config = {
            torrentio_url: (sc.torrentio_url || 'https://torrentio.strem.fun').trim().replace(/\/$/, ''),
            alt_url: (sc.alt_url || 'https://comet.strem.fun').trim().replace(/\/$/, ''),
            anime_url: (sc.anime_url || 'https://anime-kitsu.strem.io').trim().replace(/\/$/, '')
        };

        const fetchStremioAddon = async (name, baseUrl, icon) => {
            if (!baseUrl) return;
            try {
                const stremioType = type === 'movie' ? 'movie' : 'series';
                let stremioId = type === 'movie' ? imdbId : `${imdbId}:${season}:${episode}`;
                
                // If it's an anime from Kitsu, we use Kitsu's native ID which Torrentio natively supports
                if (type === 'anime') {
                    // For Kitsu, the ID passed as imdbId is the actual Kitsu ID. Format: kitsu:{id}:{episode}
                    stremioId = `kitsu:${imdbId}:${episode}`;
                }

                const url = `${baseUrl}/stream/${stremioType}/${stremioId}.json`;
                
                const response = await fetch(url, { 
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
                    signal: AbortSignal.timeout(15000) 
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                
                if (data && data.streams) {
                    console.log(`[Addon] ${name} found ${data.streams.length} streams.`);
                    data.streams.forEach(s => {
                        results.push({
                            addon: name,
                            icon: icon,
                            title: s.title || s.name,
                            quality: detectQuality(s.title || s.name),
                            url: s.url || s.infoHash || s.externalUrl,
                            type: s.infoHash ? 'torrent' : 'http',
                            infoHash: s.infoHash,
                            fileIdx: s.fileIdx
                        });
                    });
                }
            } catch (err) {
                console.warn(`[Addon] ${name} (${baseUrl}) skipped or failed:`, err.message);
            }
        };

        // Parallel fetch for all configured addons
        await Promise.all([
            fetchStremioAddon('Torrentio', config.torrentio_url, '⚡'),
            fetchStremioAddon('Global Alt', config.alt_url, '🌍'),
            fetchStremioAddon('Anime Alt', config.anime_url, '🇯🇵')
        ]);

        // 3. Browser Fallback
        if (results.length < 5) {
            results.push({
                addon: 'External Search',
                icon: '🌐',
                title: `Search "${title}" on Google`,
                quality: 'Browser',
                url: `https://www.google.com/search?q=${encodeURIComponent(title + ' stream free')}`,
                type: 'browser'
            });
        }

        return results;
    });

    // IPC: Start streaming a torrent
    ipcMain.handle('stream-torrent', async (_e, infoHashOrMagnet, fileIdx) => {
        const WT = await getWebTorrent();
        if (!client) client = new WT({
            maxConns: 800, // Balanced for streaming
            maxWebConns: 200,
            utp: true,    // Enable uTP
            dht: true,
            lsd: true,
            pex: true
        });

        let link = infoHashOrMagnet;
        const publicTrackers = [
            'udp://tracker.opentrackr.org:1337/announce',
            'udp://9.rarbg.com:2810/announce',
            'udp://open.stealth.si:80/announce',
            'udp://exodus.desync.com:6969/announce',
            'udp://tracker.openbittorrent.com:6969/announce',
            'udp://opentracker.i2p.rocks:6969/announce',
            'udp://tracker.torrent.eu.org:451/announce',
            'udp://tracker.moeking.me:6969/announce',
            'udp://tracker.bitsearch.to:1337/announce',
            'udp://tracker.tiny-vps.com:6969/announce',
            'udp://tracker.leechers-paradise.org:6969/announce',
            'udp://p4p.arenabg.ch:1337/announce',
            'udp://open.demonii.com:1337/announce'
        ];

        if (!link.startsWith('http')) {
            if (!link.includes('tr=')) {
                if (link.startsWith('magnet:')) {
                    link = link + '&tr=' + publicTrackers.map(encodeURIComponent).join('&tr=');
                } else if (link.length >= 20) {
                    link = `magnet:?xt=urn:btih:${link}&tr=` + publicTrackers.map(encodeURIComponent).join('&tr=');
                }
            }
        }

        return new Promise((resolve, reject) => {
            let timeoutResolved = false;
            const timeoutHandle = setTimeout(() => {
                if (timeoutResolved) return;
                reject(new Error('Torrent timeout (No peers found within 120s)'));
            }, 120000);

            const torrent = client.torrents.find(t => 
                t.infoHash === infoHashOrMagnet || 
                t.magnetURI.includes(infoHashOrMagnet)
            );

            if (torrent) {
                if (torrent.ready) setupServer(torrent);
                else torrent.once('ready', () => setupServer(torrent));
            } else {
                try {
                    const t = client.add(link, { sequential: true }, (t) => setupServer(t));
                    t.on('ready', () => {
                      // Aggressively prioritize the first few pieces for metadata/header loading
                      for (let i = 0; i < Math.min(t.pieces.length, 10); i++) {
                        t.pieces[i].priority = 2;
                      }
                    });
                    
                    const progressInterval = setInterval(() => {
                        if (t.ready && t.server) { clearInterval(progressInterval); return; }
                        if (t.destroyed) { clearInterval(progressInterval); return; }
                        const isMetadataLoading = t.progress < 0.002 && t.numPeers > 0;
                        const win = require('electron').BrowserWindow.getAllWindows()[0];
                        if (win && !win.isDestroyed()) {
                            win.webContents.send('torrent-progress', {
                                speed: (t.downloadSpeed / 1024 / 1024).toFixed(1) + ' MB/s',
                                percent: isMetadataLoading ? 'Fetching metadata...' : (t.progress * 100).toFixed(1) + '%',
                                peers: t.numPeers
                            });
                        }
                    }, 800);

                    t.on('error', (err) => { clearInterval(progressInterval); reject(err); });
                } catch (err) { reject(err); }
            }

            function setupServer(t) {
                timeoutResolved = true;
                clearTimeout(timeoutHandle);
                try {
                    if (torrentServer) { torrentServer.close(); torrentServer = null; }
                    
                    // Use Stremio's provided fileIdx if available, otherwise fallback to biggest file
                    let file;
                    if (fileIdx !== undefined && fileIdx !== null && t.files[fileIdx]) {
                        file = t.files[fileIdx];
                    } else {
                        file = t.files.reduce((prev, curr) => (prev.length > curr.length) ? prev : curr);
                    }
                    
                    const ext = path.extname(file.name).toLowerCase();
                    const mime = ext === '.mkv' ? 'video/x-matroska' : (ext === '.avi' ? 'video/x-msvideo' : 'video/mp4');
                    
                    torrentServer = http.createServer((req, res) => {
                        const range = req.headers.range;
                        res.setHeader('Access-Control-Allow-Origin', '*');
                        res.setHeader('Accept-Ranges', 'bytes');
                        
                        if (req.method === 'HEAD') {
                            res.writeHead(200, { 'Content-Length': file.length, 'Content-Type': mime, 'Connection': 'keep-alive' });
                            res.end(); return;
                        }

                        if (!range) {
                            res.writeHead(200, { 'Content-Length': file.length, 'Content-Type': mime, 'Connection': 'keep-alive' });
                            file.createReadStream().pipe(res); return;
                        }

                        const parts = range.replace(/bytes=/, "").split("-");
                        const start = parseInt(parts[0], 10);
                        const end = parts[1] ? parseInt(parts[1], 10) : file.length - 1;
                        const chunksize = (end - start) + 1;
                        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${file.length}`, 'Content-Length': chunksize, 'Content-Type': mime, 'Connection': 'keep-alive' });
                        file.createReadStream({ start, end }).pipe(res);
                    });

                    torrentServer.listen(0, () => {
                        const port = torrentServer.address().port;
                        const url = `http://localhost:${port}`; 
                        resolve({ url, title: t.name });
                    });
                } catch (err) { reject(err); }
            }
        });
    });
}

function detectQuality(text) {
    if (!text) return 'Unknown';
    if (text.includes('2160p') || text.includes('4K')) return '4K';
    if (text.includes('1080p')) return '1080p';
    if (text.includes('720p')) return '720p';
    if (text.includes('480p')) return '480p';
    return 'HD';
}

module.exports = { initAddonsIpc };
