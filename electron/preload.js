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
   * @param {ArrayBuffer} buffer - 文件数据
   * @param {string} fileName - 默认文件名
   * @param {string} mimeType - MIME 类型
   * @returns {Promise<{success: boolean, path?: string, error?: string}>}
   */
  saveFile: async (buffer, fileName, mimeType) => {
    return ipcRenderer.invoke('save-file', { buffer, fileName, mimeType });
  },

  /**
   * 批量保存文件到指定目录（弹出选择目录对话框）
   * @param {Array<{buffer: ArrayBuffer, fileName: string, mimeType: string}>} files
   * @returns {Promise<{success: boolean, savedCount: number, errors?: string[]}>}
   */
  saveFilesToDir: async (files) => {
    return ipcRenderer.invoke('save-files-to-dir', files);
  },

  /** 检测是否在 Electron 环境中运行 */
  isElectron: () => true,
});
