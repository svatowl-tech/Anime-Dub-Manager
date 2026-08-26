import { ipcRenderer } from './ipc';

export const isWeb = typeof window !== 'undefined' && !(window as any).electronAPI;

// Debounce background sync
let syncTimeout: any = null;

export const ipcSafe = {
  invoke: async (channel: string, ...args: any[]) => {
    try {
      const response = await ipcRenderer.invoke(channel, ...args);
      
      // If the response is the new standardized format
      if (response && typeof response === 'object' && 'success' in response) {
        if (!response.success) {
          const errMsg = response.error || 'Unknown IPC Error';
          
          console.group(`🔴 [IPC Error on channel "${channel}"]`);
          console.error(`Message:`, errMsg);
          if (response.stderr) console.error(`Stderr:`, response.stderr);
          if (response.stdout) console.error(`Stdout:`, response.stdout);
          if (response.stack) console.error(`Stack trace:`, response.stack);
          if (response.code) console.error(`Code:`, response.code);
          console.groupEnd();

          const richError = new Error(errMsg);
          (richError as any).stack = response.stack || richError.stack;
          (richError as any).stderr = response.stderr;
          (richError as any).stdout = response.stdout;
          (richError as any).code = response.code;
          throw richError;
        }
        return response.data;
      }
      
      // Fallback for handlers that haven't been wrapped yet
      return response;
    } catch (error: any) {
      if (error && typeof error === 'object' && (error.stderr || error.stdout || error.stack)) {
        console.group(`🔴 [IPC Throw on channel "${channel}"]`);
        console.error(`Message:`, error.message);
        if (error.stderr) console.error(`Stderr:`, error.stderr);
        if (error.stdout) console.error(`Stdout:`, error.stdout);
        if (error.stack) console.error(`Stack trace:`, error.stack);
        if (error.code) console.error(`Code:`, error.code);
        console.groupEnd();
      } else {
        console.error(`IPC Error on channel "${channel}":`, error);
      }
      throw error;
    }
  },
  send: (channel: string, ...args: any[]) => {
    try {
      ipcRenderer.send(channel, ...args);
    } catch (error) {
      console.error(`IPC Send Error on channel "${channel}":`, error);
    }
  },
  on: ipcRenderer.on,
  removeListener: ipcRenderer.removeListener
};
