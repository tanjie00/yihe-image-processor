/**
 * Electron Preload Script
 *
 * 暴露安全的 API 给渲染进程，用于文件保存等操作。
 * 使用 contextBridge 隔离，不直接暴露 Node.js API。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * 保存文件到磁盘（弹出保存对话框）
   */
  saveFile: async (buffer, fileName, mimeType) => {
    return ipcRenderer.invoke('save-file', { buffer, fileName, mimeType });
  },

  /**
   * 批量保存文件到指定目录（弹出选择目录对话框）
   * 注意：每批文件数量不宜过多（建议≤10），避免 IPC 传输超限
   */
  saveFilesToDir: async (files, targetDir) => {
    return ipcRenderer.invoke('save-files-to-dir', files, targetDir || null);
  },

  /**
   * 保存视频 Blob 到临时文件（避免通过 IPC 传输大 ArrayBuffer）
   * 返回 { success: boolean, tempPath?: string }
   */
  saveBlobToTemp: async (buffer, fileName) => {
    return ipcRenderer.invoke('save-blob-to-temp', { buffer, fileName });
  },

  /**
   * 从临时目录批量复制文件到目标目录
   * fileMap: { [tempPath: string]: relativePath: string }
   * 返回 { success: boolean, savedCount: number, errors?: string[], targetDir?: string }
   */
  copyTempFilesToDir: async (fileMap, targetDir) => {
    return ipcRenderer.invoke('copy-temp-files-to-dir', { fileMap, targetDir: targetDir || null });
  },

  /**
   * 清理临时文件
   */
  cleanupTempFiles: async (tempPaths) => {
    return ipcRenderer.invoke('cleanup-temp-files', tempPaths);
  },

  /** 检测是否在 Electron 环境中运行 */
  isElectron: () => true,
});
