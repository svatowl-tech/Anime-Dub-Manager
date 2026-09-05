const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, callback) => {
    const subscription = (_event, ...args) => callback(...args);
    const result = ipcRenderer.on(channel, subscription);
    if (typeof result === 'function') {
      return result;
    }
    return () => ipcRenderer.off(channel, subscription);
  }
});

