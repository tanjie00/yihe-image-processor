const { app, BrowserWindow, screen, shell, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

// ==================== 日志系统 ====================
const LOG_FILE = path.join(app.getPath('userData'), 'app-debug.log');

function logToFile(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line, { encoding: 'utf-8' });
  } catch (e) {
    // 无法写入日志文件，忽略
  }
  console.log(message);
}

logToFile('========== 应用启动 ==========');
logToFile(`平台: ${process.platform} ${process.arch}`);
logToFile(`Electron: ${process.versions.electron}`);
logToFile(`Chrome: ${process.versions.chrome}`);
logToFile(`Node: ${process.versions.node}`);
logToFile(`__dirname: ${__dirname}`);
logToFile(`resourcesPath: ${process.resourcesPath}`);
logToFile(`userData: ${app.getPath('userData')}`);
logToFile(`LOG_FILE: ${LOG_FILE}`);

// ==================== GPU 加速配置 ====================
// 启用硬件加速，提升渲染性能
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// 平台特定的 GPU 特性开关（避免 Windows 上因 Linux 专有特性导致白屏）
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,RawDraw,Vulkan');
} else if (process.platform === 'win32') {
  // Windows 使用 DirectX 相关加速，不启用 Vulkan 以避免驱动兼容性问题
  app.commandLine.appendSwitch('enable-features', 'RawDraw');
  app.commandLine.appendSwitch('disable-features', 'Vulkan');
}

// 限制渲染进程内存，避免 OOM（从 768MB 提升到 1024MB）
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=1024');

let splashWindow = null;
let mainWindow = null;
let server = null;

// ==================== MIME 类型映射 ====================
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

// ==================== 静态文件服务器 ====================
function startStaticServer(outDir, port) {
  logToFile(`Starting static server from: ${outDir} on port ${port}`);

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
              logToFile(`404: ${urlPath}`);
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
      const url = `http://127.0.0.1:${port}`;
      logToFile(`Static server started at: ${url}`);
      resolve(url);
    });

    server.on('error', (err) => {
      logToFile(`Server error: ${err.code} - ${err.message}`);
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
      logToFile(`Error serving ${filePath}: ${err.message}`);
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

// ==================== 窗口管理 ====================
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
  logToFile(`Loading splash from: ${splashHtml}`);
  splashWindow.loadFile(splashHtml);

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function createMainWindow(serverUrl) {
  logToFile(`Creating main window, URL: ${serverUrl}`);

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

  // Remove the default Electron menu bar
  mainWindow.setMenu(null);

  // F12 快捷键打开 DevTools（用于调试白屏等问题）
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
    // Ctrl+Shift+I 也可以打开 DevTools
    if (input.control && input.shift && input.key === 'I') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  // 页面加载失败时的处理
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    logToFile(`Page load FAILED: ${errorCode} - ${errorDescription} (${validatedURL})`);
    // 显示错误提示页面（带重试按钮）
    const errorHtml = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>一合图片处理 - 加载失败</title>
<style>
  body { display:flex; align-items:center; justify-content:center; height:100vh; margin:0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
    background: linear-gradient(135deg, #0f0f23, #1a1a3e); color: #fff; }
  .card { text-align:center; background: rgba(255,255,255,0.05); border-radius:16px;
    padding:40px; border:1px solid rgba(255,255,255,0.1); max-width:460px; }
  h2 { color:#e74c3c; margin-bottom:12px; }
  .error-code { color:#888; font-size:13px; margin:8px 0; }
  .error-desc { color:#666; font-size:12px; margin:4px 0; }
  .btn { margin-top:24px; padding:12px 32px; background:linear-gradient(135deg,#6c5ce7,#a855f7);
    color:#fff; border:none; border-radius:10px; cursor:pointer; font-size:15px;
    transition: transform 0.2s; }
  .btn:hover { transform: scale(1.05); }
  .log-hint { color:#555; font-size:11px; margin-top:20px; }
</style>
</head>
<body>
  <div class="card">
    <h2>页面加载失败</h2>
    <p class="error-code">错误代码: ${errorCode}</p>
    <p class="error-desc">${errorDescription}</p>
    <p class="error-desc">URL: ${validatedURL}</p>
    <button class="btn" onclick="location.reload()">重新加载</button>
    <p class="log-hint">按 F12 打开开发者工具查看详细错误<br/>日志文件: ${LOG_FILE.replace(/\\/g, '\\\\')}</p>
  </div>
</body>
</html>`;
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(errorHtml));
  });

  // 页面加载完成后的日志
  mainWindow.webContents.on('did-finish-load', () => {
    logToFile(`Page loaded successfully: ${mainWindow.webContents.getURL()}`);
  });

  // 控制台消息日志（捕获渲染进程的 console 输出）
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const levelNames = ['verbose', 'info', 'warning', 'error'];
    if (level >= 2) { // 只记录 warning 和 error
      logToFile(`[Renderer ${levelNames[level] || level}] ${message} (${sourceId}:${line})`);
    }
  });

  // 渲染进程崩溃处理
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    logToFile(`Renderer process gone: ${details.reason} - ${details.exitCode}`);
  });

  // 未捕获的渲染进程异常
  mainWindow.webContents.on('unresponsive', () => {
    logToFile('Main window became unresponsive');
  });

  // Load via local HTTP server
  logToFile(`Loading URL: ${serverUrl}`);
  mainWindow.loadURL(serverUrl);

  // 超时处理：如果 10 秒内页面没有触发 ready-to-show，强制显示窗口
  const showTimeout = setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      logToFile('WARNING: Page took too long to show, displaying window anyway');
      if (splashWindow) {
        splashWindow.close();
        splashWindow = null;
      }
      mainWindow.show();
      mainWindow.focus();
      // 自动打开 DevTools 便于调试
      mainWindow.webContents.openDevTools();
    }
  }, 10000);

  mainWindow.once('ready-to-show', () => {
    clearTimeout(showTimeout);
    logToFile('Window ready-to-show triggered');
    // Close splash and show main window
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => {
    clearTimeout(showTimeout);
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

// ==================== IPC 处理器 ====================

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

// ==================== 应用生命周期 ====================
app.whenReady().then(async () => {
  logToFile('App ready, creating splash window...');
  createSplashWindow();

  try {
    // 查找输出目录，优先使用 __dirname 相对路径，失败则尝试其他位置
    let outDir = path.join(__dirname, '..', 'out');
    logToFile(`Primary output directory: ${outDir}`);

    // 验证输出目录是否存在且包含 index.html
    const indexPath = path.join(outDir, 'index.html');
    try {
      fs.accessSync(indexPath, fs.constants.R_OK);
      logToFile('Primary output directory verified ✓');
    } catch (e) {
      logToFile(`Primary output directory NOT accessible: ${e.message}`);
      logToFile('Trying alternative paths...');

      // 尝试替代路径
      const altPaths = [
        path.join(process.resourcesPath || __dirname, 'out'),
        path.join(__dirname, 'out'),
        path.join(app.getAppPath(), 'out'),
      ];

      let found = false;
      for (const altDir of altPaths) {
        logToFile(`Trying: ${altDir}`);
        try {
          fs.accessSync(path.join(altDir, 'index.html'), fs.constants.R_OK);
          outDir = altDir;
          found = true;
          logToFile(`Alternative output directory found: ${outDir} ✓`);
          break;
        } catch (e2) {
          logToFile(`Not accessible: ${e2.message}`);
        }
      }

      if (!found) {
        logToFile('ERROR: No output directory found! Listing __dirname contents:');
        try {
          const dirContents = fs.readdirSync(path.join(__dirname, '..'));
          logToFile(`  ${dirContents.join(', ')}`);
        } catch (e3) {
          logToFile(`  Cannot list directory: ${e3.message}`);
        }
      }
    }

    const serverUrl = await startStaticServer(outDir, 3456);

    // Delay main window creation to show splash animation
    setTimeout(() => {
      createMainWindow(serverUrl);
    }, 800);
  } catch (err) {
    logToFile(`FATAL: Failed to start local server: ${err.message}\n${err.stack}`);
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
  logToFile('All windows closed');
  if (server) {
    server.close();
    server = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  logToFile('App quitting...');
  if (server) {
    server.close();
    server = null;
  }
});

// 未捕获的异常处理
process.on('uncaughtException', (err) => {
  logToFile(`UNCAUGHT EXCEPTION: ${err.message}\n${err.stack}`);
});

process.on('unhandledRejection', (reason, promise) => {
  logToFile(`UNHANDLED REJECTION: ${reason}`);
});
