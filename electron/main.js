const { app, BrowserWindow, screen, shell, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

// 启用硬件加速，提升渲染性能
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// 启用更多 GPU 特性以提升滚动性能
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,RawDraw,Vulkan');
// 限制渲染进程内存，避免 OOM
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=768');

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
      preload: path.join(__dirname, 'preload.js'),
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

// ==================== IPC Handlers ====================

/**
 * 处理渲染进程的文件保存请求
 * 弹出保存对话框，将 Blob 数据写入用户选择的路径
 */
ipcMain.handle('save-file', async (event, { buffer, fileName, mimeType }) => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: fileName,
      filters: [
        { name: '视频文件', extensions: ['mp4', 'webm', 'zip'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });

    if (canceled || !filePath) {
      return { success: false, error: '用户取消保存' };
    }

    // 将 ArrayBuffer 写入文件
    const uint8Array = new Uint8Array(buffer);
    fs.writeFileSync(filePath, uint8Array);

    return { success: true, path: filePath };
  } catch (err) {
    console.error('Save file error:', err);
    return { success: false, error: err.message || '保存失败' };
  }
});

/**
 * 处理批量文件保存请求
 * 弹出选择目录对话框，将所有文件保存到用户选择的目录
 */
ipcMain.handle('save-files-to-dir', async (event, files) => {
  try {
    const { canceled, filePath: dirPath } = await dialog.showOpenDialog(mainWindow, {
      title: '选择保存目录',
      properties: ['openDirectory', 'createDirectory'],
    });

    if (canceled || !dirPath || dirPath.length === 0) {
      return { success: false, savedCount: 0, errors: ['用户取消'] };
    }

    const targetDir = dirPath[0];
    let savedCount = 0;
    const errors = [];

    for (const file of files) {
      try {
        const filePath = path.join(targetDir, file.fileName);
        const uint8Array = new Uint8Array(file.buffer);
        // 确保子目录存在
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, uint8Array);
        savedCount++;
      } catch (err) {
        errors.push(`${file.fileName}: ${err.message}`);
      }
    }

    return { success: true, savedCount, errors: errors.length > 0 ? errors : undefined };
  } catch (err) {
    console.error('Save files to dir error:', err);
    return { success: false, savedCount: 0, errors: [err.message] };
  }
});

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
