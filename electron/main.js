const { app, BrowserWindow, screen, shell, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

// ==================== 关键修复：禁用硬件加速 ====================
app.disableHardwareAcceleration();

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

// 清理旧日志（保留最近 5MB）
try {
  const stat = fs.statSync(LOG_FILE);
  if (stat.size > 5 * 1024 * 1024) {
    fs.writeFileSync(LOG_FILE, '', { encoding: 'utf-8' });
  }
} catch (e) {
  // 文件不存在，忽略
}

logToFile('========== 应用启动 ==========');
logToFile(`版本: 2.0.0 (便携版修复)`);
logToFile(`平台: ${process.platform} ${process.arch}`);
logToFile(`Electron: ${process.versions.electron}`);
logToFile(`Chrome: ${process.versions.chrome}`);
logToFile(`Node: ${process.versions.node}`);
logToFile(`__dirname: ${__dirname}`);
logToFile(`resourcesPath: ${process.resourcesPath}`);
logToFile(`userData: ${app.getPath('userData')}`);
logToFile(`exe路径: ${app.getPath('exe')}`);
logToFile(`硬件加速: 已禁用`);

let splashWindow = null;
let mainWindow = null;
let httpServer = null;
let serverPort = null;

// ==================== 查找输出目录 ====================
function findOutDir() {
  const candidates = [
    path.join(__dirname, '..', 'out'),                    // 正常开发/unpacked/ASAR内
    path.join(process.resourcesPath || '', 'out'),         // ASAR 打包后 resources/out
    path.join(__dirname, 'out'),                           // 同目录
    path.join(app.getAppPath(), 'out'),                    // app 路径
  ];

  // Windows portable exe 的特殊路径
  if (process.platform === 'win32') {
    const exeDir = path.dirname(app.getPath('exe'));
    // electron-builder portable 解压后的标准结构
    candidates.push(path.join(exeDir, 'resources', 'app', 'out'));
    candidates.push(path.join(exeDir, 'resources', 'out'));
    candidates.push(path.join(exeDir, 'out'));
    // 便携版可能解压到临时目录
    candidates.push(path.join(process.resourcesPath, 'app', 'out'));
    candidates.push(path.join(process.resourcesPath, 'app.asar', 'out'));
    // 对于 ASAR 打包的情况
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'out'));
  }

  logToFile('搜索输出目录:');
  for (const dir of candidates) {
    logToFile(`  尝试: ${dir}`);
    try {
      const indexPath = path.join(dir, 'index.html');
      fs.accessSync(indexPath, fs.constants.R_OK);
      logToFile(`  ✓ 找到: ${dir}`);
      return dir;
    } catch (e) {
      // 继续尝试
    }
  }

  // 最后手段：列出目录内容帮助调试
  logToFile('!!! 所有候选路径均未找到 index.html !!!');
  try {
    logToFile(`__dirname 上级目录内容:`);
    for (const entry of fs.readdirSync(path.join(__dirname, '..'))) {
      logToFile(`  ${entry}`);
    }
    logToFile(`resourcesPath 目录内容:`);
    if (fs.existsSync(process.resourcesPath)) {
      for (const entry of fs.readdirSync(process.resourcesPath)) {
        logToFile(`  ${entry}`);
      }
    }
  } catch (e) {
    logToFile(`无法列出目录: ${e.message}`);
  }

  return null;
}

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
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
  '.xml': 'application/xml',
  '.ts': 'text/plain; charset=utf-8',
};

// ==================== 本地 HTTP 服务器 ====================
// 绑定到 127.0.0.1（仅本地），随机端口，不触发防火墙

function startHttpServer(outDirPath) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        // 解析 URL，去除查询参数
        let urlPath = req.url.split('?')[0];

        // 默认指向 index.html
        if (urlPath === '/' || urlPath === '') {
          urlPath = '/index.html';
        }

        // 安全：防止路径遍历攻击
        const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
        const filePath = path.join(outDirPath, safePath);

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        // 读取文件
        const data = fs.readFileSync(filePath);
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(data);
      } catch (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found: ' + req.url);
        logToFile(`HTTP 404: ${req.url} - ${err.message}`);
      }
    });

    // 绑定到 127.0.0.1:0 — 随机端口，仅本地访问，不触发防火墙
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      logToFile(`本地 HTTP 服务器启动成功: http://127.0.0.1:${port}`);
      resolve({ server, port });
    });

    server.on('error', (err) => {
      logToFile(`HTTP 服务器启动失败: ${err.message}`);
      reject(err);
    });
  });
}

// ==================== 窗口管理 ====================
function createSplashWindow() {
  try {
    splashWindow = new BrowserWindow({
      width: 600,
      height: 400,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      center: true,
      skipTaskbar: true,
      // 不使用 transparent: true，因为禁用硬件加速后透明可能不工作
      backgroundColor: '#0f0f23',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    const splashHtml = path.join(__dirname, 'splash.html');
    logToFile(`加载启动画面: ${splashHtml}`);
    splashWindow.loadFile(splashHtml);

    splashWindow.on('closed', () => {
      splashWindow = null;
    });
  } catch (err) {
    logToFile(`创建启动窗口失败: ${err.message}`);
  }
}

function createMainWindow() {
  logToFile('创建主窗口...');

  try {
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

    mainWindow = new BrowserWindow({
      width: Math.min(1400, screenWidth - 100),
      height: Math.min(900, screenHeight - 100),
      minWidth: 900,
      minHeight: 650,
      show: false,
      title: '一合图片处理',
      icon: path.join(__dirname, 'icon.png'),
      backgroundColor: '#0f0f23',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: false,  // 允许加载本地资源
        preload: path.join(__dirname, 'preload.js'),
        backgroundThrottling: false,
      },
    });

    // 移除菜单栏
    mainWindow.setMenu(null);

    // ===== 页面加载事件 =====
    mainWindow.webContents.on('did-start-loading', () => {
      logToFile('页面开始加载...');
    });

    mainWindow.webContents.on('did-finish-load', () => {
      logToFile(`页面加载完成: ${mainWindow.webContents.getURL()}`);
    });

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      logToFile(`页面加载失败: ${errorCode} - ${errorDescription} (${validatedURL})`);
      // 尝试使用 loadFile 回退
      if (outDir && !validatedURL.includes('file://')) {
        logToFile('尝试 loadFile 回退方案...');
        try {
          mainWindow.loadFile(path.join(outDir, 'index.html'));
        } catch (e) {
          logToFile(`loadFile 回退失败: ${e.message}`);
          showLoadError(errorCode, errorDescription, validatedURL);
        }
      } else {
        showLoadError(errorCode, errorDescription, validatedURL);
      }
    });

    // 渲染进程崩溃
    mainWindow.webContents.on('render-process-gone', (event, details) => {
      logToFile(`渲染进程崩溃: reason=${details.reason} exitCode=${details.exitCode}`);
      showCrashError(details.reason, details.exitCode);
    });

    // 控制台消息
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
      const levelNames = ['verbose', 'info', 'warning', 'error'];
      if (level >= 2) { // 只记录 warning 和 error
        logToFile(`[控制台 ${levelNames[level] || level}] ${message}`);
      }
    });

    // ===== 加载页面 =====
    if (serverPort && outDir) {
      // 使用本地 HTTP 服务器加载页面
      const appUrl = `http://127.0.0.1:${serverPort}/index.html`;
      logToFile(`使用 HTTP 服务器加载: ${appUrl}`);
      mainWindow.loadURL(appUrl);
    } else if (outDir) {
      // 回退：直接加载本地文件（可能无法加载绝对路径资源）
      logToFile(`HTTP 服务器未启动，使用 loadFile 加载: ${outDir}`);
      mainWindow.loadFile(path.join(outDir, 'index.html'));
    } else {
      logToFile('无法找到输出目录，显示错误页面');
      showNoOutDirError();
    }

    // ===== 超时保护 =====
    const showTimeout = setTimeout(() => {
      if (mainWindow && !mainWindow.isVisible()) {
        logToFile('超时：页面未触发 ready-to-show，强制显示窗口');
        if (splashWindow) {
          try { splashWindow.close(); } catch(e) {}
          splashWindow = null;
        }
        mainWindow.show();
        mainWindow.focus();
      }
    }, 10000);

    mainWindow.once('ready-to-show', () => {
      clearTimeout(showTimeout);
      logToFile('窗口 ready-to-show 事件触发');
      if (splashWindow) {
        try { splashWindow.close(); } catch(e) {}
        splashWindow = null;
      }
      mainWindow.show();
      mainWindow.focus();
    });

    mainWindow.on('closed', () => {
      clearTimeout(showTimeout);
      mainWindow = null;
    });

    // 外部链接处理
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    mainWindow.webContents.on('will-navigate', (event, url) => {
      // 允许本地 HTTP 服务器和文件协议
      if (url.startsWith('http://127.0.0.1')) return;
      if (url.startsWith('file://')) return;
      if (url.startsWith('http') || url.startsWith('https')) {
        event.preventDefault();
        shell.openExternal(url);
      }
    });

  } catch (err) {
    logToFile(`创建主窗口异常: ${err.message}\n${err.stack}`);
  }
}

// ==================== 错误页面 ====================

function showLoadError(errorCode, errorDescription, url) {
  try {
    const errorHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>加载失败 - 一合图片处理</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { display:flex; align-items:center; justify-content:center; height:100vh;
  font-family: -apple-system, 'Segoe UI', 'PingFang SC', sans-serif;
  background: linear-gradient(135deg, #0f0f23, #1a1a3e); color: #fff; }
.card { text-align:center; background: rgba(255,255,255,0.05); border-radius:16px;
  padding:40px; border:1px solid rgba(255,255,255,0.1); max-width:500px; width:90%; }
h2 { color:#e74c3c; margin-bottom:16px; font-size:22px; }
.info { color:#888; font-size:13px; margin:8px 0; line-height:1.6; }
.btn { margin-top:24px; padding:12px 32px; background:linear-gradient(135deg,#6c5ce7,#a855f7);
  color:#fff; border:none; border-radius:10px; cursor:pointer; font-size:15px; }
.btn:hover { opacity:0.9; }
.log-info { color:#555; font-size:11px; margin-top:24px; line-height:1.8; }
</style></head>
<body><div class="card">
<h2>页面加载失败</h2>
<p class="info">错误代码: ${errorCode}</p>
<p class="info">${errorDescription}</p>
<p class="info" style="word-break:break-all;">URL: ${url || 'unknown'}</p>
<button class="btn" onclick="location.reload()">重新加载</button>
<p class="log-info">日志文件: %APPDATA%\\yihe-image-processor\\app-debug.log</p>
</div></body></html>`;
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(errorHtml));
  } catch (e) {
    logToFile(`显示错误页面失败: ${e.message}`);
  }
}

function showCrashError(reason, exitCode) {
  try {
    const errorHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>崩溃 - 一合图片处理</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { display:flex; align-items:center; justify-content:center; height:100vh;
  font-family: -apple-system, 'Segoe UI', 'PingFang SC', sans-serif;
  background: linear-gradient(135deg, #0f0f23, #1a1a3e); color: #fff; }
.card { text-align:center; background: rgba(255,255,255,0.05); border-radius:16px;
  padding:40px; border:1px solid rgba(255,255,255,0.1); max-width:500px; width:90%; }
h2 { color:#e74c3c; margin-bottom:16px; }
.info { color:#888; font-size:13px; margin:8px 0; }
.btn { margin-top:24px; padding:12px 32px; background:linear-gradient(135deg,#6c5ce7,#a855f7);
  color:#fff; border:none; border-radius:10px; cursor:pointer; font-size:15px; }
.btn:hover { opacity:0.9; }
.log-info { color:#555; font-size:11px; margin-top:24px; line-height:1.8; }
</style></head>
<body><div class="card">
<h2>渲染进程崩溃</h2>
<p class="info">原因: ${reason || 'unknown'}</p>
<p class="info">退出代码: ${exitCode || 'N/A'}</p>
<button class="btn" onclick="location.reload()">重新加载</button>
<p class="log-info">硬件加速已禁用，如仍崩溃请检查日志<br/>
日志文件: %APPDATA%\\yihe-image-processor\\app-debug.log</p>
</div></body></html>`;
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(errorHtml));
  } catch (e) {
    logToFile(`显示崩溃页面失败: ${e.message}`);
  }
}

function showNoOutDirError() {
  try {
    const errorHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>找不到资源 - 一合图片处理</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { display:flex; align-items:center; justify-content:center; height:100vh;
  font-family: -apple-system, 'Segoe UI', 'PingFang SC', sans-serif;
  background: linear-gradient(135deg, #0f0f23, #1a1a3e); color: #fff; }
.card { text-align:center; background: rgba(255,255,255,0.05); border-radius:16px;
  padding:40px; border:1px solid rgba(255,255,255,0.1); max-width:500px; width:90%; }
h2 { color:#f39c12; margin-bottom:16px; }
.info { color:#888; font-size:13px; margin:8px 0; line-height:1.6; }
.log-info { color:#555; font-size:11px; margin-top:24px; line-height:1.8; text-align:left;
  background:rgba(0,0,0,0.3); padding:12px; border-radius:8px; word-break:break-all; }
</style></head>
<body><div class="card">
<h2>找不到应用资源</h2>
<p class="info">无法找到前端页面文件 (out/index.html)</p>
<p class="info">请确认应用安装完整，或重新下载</p>
<p class="log-info">调试信息:<br/>
__dirname: ${__dirname}<br/>
resourcesPath: ${process.resourcesPath}<br/>
日志文件: %APPDATA%\\yihe-image-processor\\app-debug.log</p>
</div></body></html>`;
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(errorHtml));
  } catch (e) {
    logToFile(`显示无资源页面失败: ${e.message}`);
  }
}

// ==================== IPC 处理器 ====================

// 保存单个文件
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

    const uint8Array = new Uint8Array(buffer);
    fs.writeFileSync(filePath, uint8Array);
    return { success: true, path: filePath };
  } catch (err) {
    logToFile(`保存文件错误: ${err.message}`);
    return { success: false, error: err.message || '保存失败' };
  }
});

// 批量保存文件到指定目录
ipcMain.handle('save-files-to-dir', async (event, files, targetDirOverride) => {
  try {
    let targetDir = targetDirOverride;

    // 如果没有指定目录，弹出目录选择对话框
    if (!targetDir) {
      const { canceled, filePath: dirPath } = await dialog.showOpenDialog(mainWindow, {
        title: '选择保存目录',
        properties: ['openDirectory', 'createDirectory'],
      });

      if (canceled || !dirPath || dirPath.length === 0) {
        return { success: false, savedCount: 0, errors: ['用户取消'], targetDir: null };
      }
      targetDir = dirPath[0];
    }

    let savedCount = 0;
    const errors = [];

    for (const file of files) {
      try {
        const filePath = path.join(targetDir, file.fileName);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        if (file.buffer) {
          // 单个 buffer 方式
          const uint8Array = new Uint8Array(file.buffer);
          fs.writeFileSync(filePath, uint8Array);
        } else if (file.buffers && Array.isArray(file.buffers)) {
          // 分块 buffer 方式（用于大文件）
          const writeStream = fs.createWriteStream(filePath);
          for (const chunk of file.buffers) {
            writeStream.write(Buffer.from(new Uint8Array(chunk)));
          }
          writeStream.end();
          await new Promise((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
          });
        }
        savedCount++;
      } catch (err) {
        logToFile(`保存文件失败 ${file.fileName}: ${err.message}`);
        errors.push(`${file.fileName}: ${err.message}`);
      }
    }

    logToFile(`批量保存完成: ${savedCount}/${files.length} 文件, 错误: ${errors.length}`);
    return { success: true, savedCount, errors: errors.length > 0 ? errors : undefined, targetDir };
  } catch (err) {
    logToFile(`批量保存错误: ${err.message}`);
    return { success: false, savedCount: 0, errors: [err.message], targetDir: null };
  }
});

// 新增：保存视频 Blob 到临时文件（避免 IPC 传输大 ArrayBuffer）
ipcMain.handle('save-blob-to-temp', async (event, { buffer, fileName }) => {
  try {
    const tempDir = path.join(app.getPath('userData'), 'temp-downloads');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const tempPath = path.join(tempDir, fileName);
    const uint8Array = new Uint8Array(buffer);
    fs.writeFileSync(tempPath, uint8Array);
    logToFile(`临时文件已保存: ${tempPath} (${uint8Array.length} bytes)`);
    return { success: true, tempPath };
  } catch (err) {
    logToFile(`保存临时文件错误: ${err.message}`);
    return { success: false, error: err.message };
  }
});

// 新增：从临时目录批量复制文件到目标目录
ipcMain.handle('copy-temp-files-to-dir', async (event, { fileMap, targetDir }) => {
  try {
    if (!targetDir) {
      const { canceled, filePath: dirPath } = await dialog.showOpenDialog(mainWindow, {
        title: '选择保存目录',
        properties: ['openDirectory', 'createDirectory'],
      });

      if (canceled || !dirPath || dirPath.length === 0) {
        return { success: false, savedCount: 0, errors: ['用户取消'], targetDir: null };
      }
      targetDir = dirPath[0];
    }

    let savedCount = 0;
    const errors = [];

    for (const [tempPath, relativePath] of Object.entries(fileMap)) {
      try {
        const destPath = path.join(targetDir, relativePath as string);
        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.copyFileSync(tempPath, destPath);
        savedCount++;
      } catch (err) {
        errors.push(`${relativePath}: ${err.message}`);
      }
    }

    // 清理临时文件
    try {
      for (const tempPath of Object.keys(fileMap)) {
        fs.unlinkSync(tempPath);
      }
    } catch (e) {
      // 忽略清理错误
    }

    logToFile(`批量复制完成: ${savedCount}/${Object.keys(fileMap).length} 文件`);
    return { success: true, savedCount, errors: errors.length > 0 ? errors : undefined, targetDir };
  } catch (err) {
    logToFile(`批量复制错误: ${err.message}`);
    return { success: false, savedCount: 0, errors: [err.message], targetDir: null };
  }
});

// 新增：清理临时文件
ipcMain.handle('cleanup-temp-files', async (event, tempPaths) => {
  try {
    for (const tempPath of tempPaths) {
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch (e) {
        // 忽略
      }
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ==================== 应用生命周期 ====================
let outDir = null;

app.whenReady().then(async () => {
  logToFile('App ready');

  // 查找输出目录
  outDir = findOutDir();

  // 启动本地 HTTP 服务器
  if (outDir) {
    try {
      const result = await startHttpServer(outDir);
      httpServer = result.server;
      serverPort = result.port;
    } catch (err) {
      logToFile(`HTTP 服务器启动失败，将使用 loadFile 回退: ${err.message}`);
      httpServer = null;
      serverPort = null;
    }
  }

  // 创建启动画面（不依赖 HTTP 服务器）
  createSplashWindow();

  // 延迟创建主窗口（让启动画面展示）
  setTimeout(() => {
    createMainWindow();
  }, 800);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  logToFile('所有窗口已关闭');
  // 关闭 HTTP 服务器
  if (httpServer) {
    try { httpServer.close(); } catch(e) {}
    httpServer = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  logToFile('应用退出中...');
  // 关闭 HTTP 服务器
  if (httpServer) {
    try { httpServer.close(); } catch(e) {}
    httpServer = null;
  }
});

// 全局异常处理
process.on('uncaughtException', (err) => {
  logToFile(`未捕获异常: ${err.message}\n${err.stack}`);
});

process.on('unhandledRejection', (reason) => {
  logToFile(`未处理的 Promise 拒绝: ${reason}`);
});
