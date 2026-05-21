const { app, BrowserWindow, screen, shell, Menu } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

let splashWindow = null;
let mainWindow = null;
let server = null;

// MIME type mapping
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
  '.xml': 'application/xml',
};

// Simple static file server
function startStaticServer(outDir, port) {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      let urlPath = req.url.split('?')[0]; // Remove query string

      // Default to index.html
      if (urlPath === '/') urlPath = '/index.html';

      // Security: prevent directory traversal
      const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
      const filePath = path.join(outDir, safePath);

      // Check if file exists
      fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
          // Try .html extension for SPA-like routing
          const htmlPath = filePath + '.html';
          fs.stat(htmlPath, (err2, stats2) => {
            if (err2 || !stats2.isFile()) {
              res.writeHead(404);
              res.end('Not Found');
              return;
            }
            serveFile(htmlPath, res);
          });
          return;
        }
        serveFile(filePath, res);
      });
    });

    server.listen(port, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${port}`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        // Port in use, try next one
        server.close();
        startStaticServer(outDir, port + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end('Internal Server Error');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 600,
    height: 400,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    center: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const splashHtml = path.join(__dirname, 'splash.html');
  splashWindow.loadFile(splashHtml);

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function createMainWindow(serverUrl) {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1400, screenWidth - 100),
    height: Math.min(900, screenHeight - 100),
    minWidth: 900,
    minHeight: 650,
    show: false,
    title: '一合图片处理',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  // Clear HTTP cache to ensure UI updates are always reflected
  mainWindow.webContents.session.clearCache().catch(() => {});

  // Remove the default Electron menu bar
  mainWindow.setMenu(null);

  // Load via local HTTP server
  mainWindow.loadURL(serverUrl);

  mainWindow.once('ready-to-show', () => {
    // Close splash and show main window
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle external links - open in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Open http/https links externally
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http://127.0.0.1')) return; // Allow local server
    if (url.startsWith('http') || url.startsWith('https')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

// App lifecycle
app.whenReady().then(async () => {
  createSplashWindow();

  try {
    const outDir = path.join(__dirname, '..', 'out');
    const serverUrl = await startStaticServer(outDir, 3456);

    // Delay main window creation to show splash animation
    setTimeout(() => {
      createMainWindow(serverUrl);
    }, 800);
  } catch (err) {
    console.error('Failed to start local server:', err);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const outDir = path.join(__dirname, '..', 'out');
      startStaticServer(outDir, 3456).then((serverUrl) => {
        createMainWindow(serverUrl);
      }).catch(console.error);
    }
  });
});

app.on('window-all-closed', () => {
  if (server) {
    server.close();
    server = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (server) {
    server.close();
    server = null;
  }
});
