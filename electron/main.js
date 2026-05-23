const { app, BrowserWindow, screen, shell, Menu, ipcMain, dialog, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');

// ==================== 关键修复：在 app.ready 之前注册自定义协议 ====================
// 必须在 app.whenReady() 之前调用
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
      stream: true,
    },
  },
]);

// ==================== 关键修复：完全禁用硬件加速 ====================
// 这是最彻底的白屏修复方案 — 用 CPU 软件渲染替代 GPU
// 牺牲少量性能换取最大兼容性，解决所有 GPU 驱动兼容性问题
app.disableHardwareAcceleration();

// 移除所有 GPU 相关标志（之前的标志可能在某些驱动上导致崩溃）
// 不再需要 appendSwitch，因为已经禁用了硬件加速

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
logToFile(`版本: 1.7.0 (白屏修复版)`);
logToFile(`平台: ${process.platform} ${process.arch}`);
logToFile(`Electron: ${process.versions.electron}`);
logToFile(`Chrome: ${process.versions.chrome}`);
logToFile(`Node: ${process.versions.node}`);
logToFile(`__dirname: ${__dirname}`);
logToFile(`resourcesPath: ${process.resourcesPath}`);
logToFile(`userData: ${app.getPath('userData')}`);
logToFile(`LOG_FILE: ${LOG_FILE}`);
logToFile(`硬件加速: 已禁用 (app.disableHardwareAcceleration)`);

let splashWindow = null;
let mainWindow = null;

// ==================== 查找输出目录 ====================
function findOutDir() {
  // 按优先级尝试多个路径
  const candidates = [
    path.join(__dirname, '..', 'out'),                    // 正常开发/unpacked
    path.join(process.resourcesPath || '', 'out'),         // ASAR 打包后
    path.join(__dirname, 'out'),                           // 同目录
    path.join(app.getAppPath(), 'out'),                    // app 路径
  ];

  // Windows portable exe 的特殊路径
  if (process.platform === 'win32') {
    const exeDir = path.dirname(app.getPath('exe'));
    candidates.push(path.join(exeDir, 'resources', 'out'));
    candidates.push(path.join(exeDir, 'out'));
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
      logToFile(`  ✗ 不存在或不可读`);
    }
  }

  // 最后手段：列出目录内容帮助调试
  logToFile('!!! 所有候选路径均未找到 index.html !!!');
  try {
    logToFile(`__dirname 上级目录内容:`);
    for (const entry of fs.readdirSync(path.join(__dirname, '..'))) {
      logToFile(`  ${entry}`);
    }
  } catch (e) {
    logToFile(`无法列出目录: ${e.message}`);
  }

  return null;
}

// ==================== 自定义协议处理 ====================
// 使用 app:// 协议替代 HTTP 服务器，消除端口绑定和防火墙问题
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
  '.ts': 'text/plain; charset=utf-8',
};

let outDir = null;

function registerAppProtocol() {
  // 注意：protocol.registerSchemesAsPrivileged 已在文件顶部调用（必须在 app.ready 之前）
  // 这里只注册协议处理逻辑（protocol.handle 在 app.ready 之后调用）

  // 使用 handle 方式注册（Electron 25+ 推荐）
  protocol.handle('app', (request) => {
    try {
      const url = new URL(request.url);
      let urlPath = url.pathname;

      // 解码 URL 编码的路径
      urlPath = decodeURIComponent(urlPath);

      // 默认指向 index.html
      if (urlPath === '/' || urlPath === '') {
        urlPath = '/index.html';
      }

      // 安全：防止路径遍历
      const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
      const filePath = path.join(outDir, safePath);

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      // 同步读取文件
      const data = fs.readFileSync(filePath);
      return new Response(data, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      });
    } catch (err) {
      logToFile(`协议处理错误: ${err.message} for ${request.url}`);
      return new Response('Not Found', { status: 404 });
    }
  });

  logToFile('自定义协议 app:// 注册成功');
}

// ==================== 窗口管理 ====================
function createSplashWindow() {
  try {
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
        offscreen: false,
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
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        preload: path.join(__dirname, 'preload.js'),
        offscreen: false,
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
      showLoadError(errorCode, errorDescription, validatedURL);
    });

    // 渲染进程崩溃
    mainWindow.webContents.on('render-process-gone', (event, details) => {
      logToFile(`渲染进程崩溃: reason=${details.reason} exitCode=${details.exitCode}`);
      showCrashError(details.reason, details.exitCode);
    });

    // GPU 进程崩溃
    app.on('gpu-process-crashed', (event, killed) => {
      logToFile(`GPU 进程崩溃: killed=${killed}`);
    });

    // 控制台消息
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
      const levelNames = ['verbose', 'info', 'warning', 'error'];
      if (level >= 1) { // info 及以上都记录
        logToFile(`[控制台 ${levelNames[level] || level}] ${message}`);
      }
    });

    // ===== 加载页面 =====

    if (outDir) {
      // 优先使用自定义 app:// 协议加载页面（消除 HTTP 服务器端口/防火墙问题）
      const appUrl = 'app://./index.html';
      logToFile(`使用自定义协议加载: ${appUrl}`);
      logToFile(`输出目录: ${outDir}`);
      
      mainWindow.loadURL(appUrl);

      // 备用方案：如果 3 秒后仍白屏，回退到 loadFile 方案
      const fallbackTimer = setTimeout(() => {
        try {
          const currentUrl = mainWindow.webContents.getURL();
          logToFile(`3秒后检查 - 当前URL: ${currentUrl}`);
          // 如果还在加载中或页面看起来空白，尝试 loadFile 回退
          if (currentUrl.includes('app://')) {
            logToFile('尝试 loadFile 回退方案...');
            const indexPath = path.join(outDir, 'index.html');
            mainWindow.loadFile(indexPath);
          }
        } catch (e) {
          logToFile(`回退检查失败: ${e.message}`);
        }
      }, 5000);

      mainWindow.webContents.once('did-finish-load', () => {
        clearTimeout(fallbackTimer);
      });
      mainWindow.webContents.once('did-fail-load', () => {
        clearTimeout(fallbackTimer);
      });
    } else {
      logToFile('无法找到输出目录，显示错误页面');
      showNoOutDirError();
    }

    // ===== 超时保护 =====

    const showTimeout = setTimeout(() => {
      if (mainWindow && !mainWindow.isVisible()) {
        logToFile('⚠ 超时：页面未触发 ready-to-show，强制显示窗口');
        if (splashWindow) {
          try { splashWindow.close(); } catch(e) {}
          splashWindow = null;
        }
        mainWindow.show();
        mainWindow.focus();
        // 自动打开 DevTools
        try { mainWindow.webContents.openDevTools(); } catch(e) {}
      }
    }, 8000);

    mainWindow.once('ready-to-show', () => {
      clearTimeout(showTimeout);
      logToFile('窗口 ready-to-show 事件触发');
      if (splashWindow) {
        try { splashWindow.close(); } catch(e) {}
        splashWindow = null;
      }
      mainWindow.show();
      mainWindow.focus();

      // 开发调试：3秒后自动打开 DevTools
      // 如果不需要可以注释掉
      // setTimeout(() => {
      //   try { mainWindow.webContents.openDevTools(); } catch(e) {}
      // }, 3000);
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
      if (url.startsWith('app://')) return;
      if (url.startsWith('http://127.0.0.1')) return;
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
    logToFile(`批量保存错误: ${err.message}`);
    return { success: false, savedCount: 0, errors: [err.message] };
  }
});

// ==================== 应用生命周期 ====================
app.whenReady().then(async () => {
  logToFile('App ready');

  // 查找输出目录
  outDir = findOutDir();

  // 注册自定义协议（替代 HTTP 服务器）
  try {
    registerAppProtocol();
  } catch (err) {
    logToFile(`注册自定义协议失败: ${err.message}\n${err.stack}`);
    // 回退到 HTTP 服务器方案
    logToFile('尝试回退到 loadFile 方案...');
  }

  // 创建启动画面
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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  logToFile('应用退出中...');
});

// 全局异常处理
process.on('uncaughtException', (err) => {
  logToFile(`未捕获异常: ${err.message}\n${err.stack}`);
});

process.on('unhandledRejection', (reason) => {
  logToFile(`未处理的 Promise 拒绝: ${reason}`);
});
