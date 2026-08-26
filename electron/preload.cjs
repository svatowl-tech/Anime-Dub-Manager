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
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },
  browserPreloadPath
});

