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
   * 选择目录对话框
   * 返回 { success: boolean, directory: string | null }
   */
  selectDirectory: async (title) => {
    return ipcRenderer.invoke('select-directory', title || null);
  },

  /**
   * 批量保存文件到指定目录（弹出选择目录对话框）
   */
  saveFilesToDir: async (files, targetDir) => {
    return ipcRenderer.invoke('save-files-to-dir', files, targetDir || null);
  },

  /**
   * 保存视频 Blob 到临时文件
   */
  saveBlobToTemp: async (buffer, fileName) => {
    return ipcRenderer.invoke('save-blob-to-temp', { buffer, fileName });
  },

  /**
   * 从临时目录批量复制文件到目标目录
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

  /**
   * 分块写入文件到磁盘
   */
  writeFileChunk: async (filePath, data, append) => {
    return ipcRenderer.invoke('write-file-chunk', { filePath, data, append: !!append });
  },

  /** 检测是否在 Electron 环境中运行 */
  isElectron: () => true,
});
