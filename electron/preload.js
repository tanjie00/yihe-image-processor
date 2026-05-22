const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: async (buffer, fileName, mimeType) => {
    const arrayBuffer = buffer instanceof ArrayBuffer ? buffer : await buffer.arrayBuffer();
    return ipcRenderer.invoke('save-file', { buffer: arrayBuffer, fileName, mimeType });
  },
  isElectron: () => true,
});
