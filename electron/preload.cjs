const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

let browserPreloadPath = '';
try {
  browserPreloadPath = path.join(__dirname, 'lib', 'browser-preload.cjs');
} catch (e) {}

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
  },
  browserPreloadPath
});

