const { app, BrowserWindow } = require('electron');
const path = require('path');
const express = require('express');

const PORT = 3456;
let server = null;
let mainWindow = null;

// Determine the static files path
// In development: ../out
// In packaged app: resources/app/out (or resources/app.asar/out)
function getStaticPath() {
  if (app.isPackaged) {
    // Packaged app - files are in asar or resources directory
    return path.join(process.resourcesPath, 'app', 'out');
  }
  // Development mode
  return path.join(__dirname, '..', 'out');
}

function createServer() {
  return new Promise((resolve, reject) => {
    const app_express = express();
    const staticPath = getStaticPath();

    console.log('[Electron] Serving static files from:', staticPath);

    // Serve static files with proper MIME types
    app_express.use(express.static(staticPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js')) {
          res.setHeader('Content-Type', 'application/javascript');
        } else if (filePath.endsWith('.css')) {
          res.setHeader('Content-Type', 'text/css');
        } else if (filePath.endsWith('.html')) {
          res.setHeader('Content-Type', 'text/html');
        } else if (filePath.endsWith('.svg')) {
          res.setHeader('Content-Type', 'image/svg+xml');
        } else if (filePath.endsWith('.webm')) {
          res.setHeader('Content-Type', 'video/webm');
        } else if (filePath.endsWith('.wasm')) {
          res.setHeader('Content-Type', 'application/wasm');
        }
      }
    }));

    // SPA fallback - serve index.html for all non-file routes
    app_express.get('*', (req, res) => {
      res.sendFile(path.join(staticPath, 'index.html'));
    });

    server = app_express.listen(PORT, '127.0.0.1', () => {
      console.log(`[Electron] Local server running at http://127.0.0.1:${PORT}`);
      resolve();
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`[Electron] Port ${PORT} in use, trying ${PORT + 1}...`);
        server = app_express.listen(PORT + 1, '127.0.0.1', () => {
          console.log(`[Electron] Local server running at http://127.0.0.1:${PORT + 1}`);
          resolve();
        });
      } else {
        reject(err);
      }
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: '一合图片处理',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
    show: false, // Don't show until ready
    backgroundColor: '#030712', // Match dark theme
    autoHideMenuBar: true,
  });

  // Remove menu bar completely
  mainWindow.setMenu(null);

  // Load the app from local server
  const serverPort = server ? server.address().port : PORT;
  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);

  // Show window when content is ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open external links in default browser (not in Electron)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });
}

// App lifecycle
app.whenReady().then(async () => {
  try {
    await createServer();
    createWindow();
  } catch (err) {
    console.error('[Electron] Failed to start:', err);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
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
