const http = require('http');
const fs = require('fs');
const path = require('path');
const ip = require('ip');
const mime = require('mime-types');

let server = null;
let currentFile = null;
let port = 0;

function startServer(filePath) {
  if (server) {
    if (currentFile === filePath) return getServerUrl();
    stopServer();
  }

  currentFile = filePath;
  server = http.createServer((req, res) => {
    if (!currentFile || !fs.existsSync(currentFile)) {
      res.writeHead(404);
      res.end();
      return;
    }

    const stat = fs.statSync(currentFile);
    const fileSize = stat.size;
    const range = req.headers.range;
    const contentType = mime.lookup(currentFile) || 'video/mp4';

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(currentFile, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': contentType,
      };
      res.writeHead(200, head);
      fs.createReadStream(currentFile).pipe(res);
    }
  });

  server.listen(0, () => {
    port = server.address().port;
    console.log(`[MediaServer] Serving ${path.basename(currentFile)} at http://${ip.address()}:${port}`);
  });

  return getServerUrl();
}

function stopServer() {
  if (server) {
    server.close();
    server = null;
    port = 0;
    currentFile = null;
  }
}

function getServerUrl() {
  if (!port) return null;
  return `http://${ip.address()}:${port}/video${path.extname(currentFile)}`;
}

module.exports = {
  startServer,
  stopServer,
  getServerUrl
};
