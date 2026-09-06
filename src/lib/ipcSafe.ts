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
          const richError = new Error(errMsg);
          (richError as any).stack = response.stack || richError.stack;
          (richError as any).stderr = response.stderr;
          (richError as any).stdout = response.stdout;
          (richError as any).code = response.code;
          (richError as any)._isIpcError = true;
          (richError as any)._channel = channel;
          throw richError;
        }
        return response.data !== undefined ? response.data : response;
      }
      
      // Fallback for handlers that haven't been wrapped yet
      return response;
    } catch (error: any) {
      const isOperationalTgChannel = channel.startsWith('telegram-mtproto-') && 
        !channel.includes('qr') && 
        !channel.includes('send-code') && 
        !channel.includes('sign-in') && 
        !channel.includes('submit-password');

      const errStr = String(error?.message || error || '');
      const isAuthError = errStr.includes('AUTH_KEY_UNREGISTERED') ||
                          errStr.includes('AUTH_KEY_INVALID') ||
                          errStr.includes('SESSION_REVOKED') ||
                          errStr.includes('SESSION_EXPIRED') ||
                          errStr.includes('Сессия Telegram устарела');

      if (isOperationalTgChannel && isAuthError) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('telegram-auth-invalidated'));
        }
        console.warn(`[Telegram MTProto] Session invalidated on channel "${channel}". Prompting re-auth.`);
        throw error;
      }

      if (error && error._isIpcError) {
        console.group(`🔴 [IPC Error on channel "${error._channel}"]`);
        console.error(`Message:`, error.message);
        if (error.stderr) console.error(`Stderr:`, error.stderr);
        if (error.stdout) console.error(`Stdout:`, error.stdout);
        if (error.stack) console.error(`Stack trace:`, error.stack);
        if (error.code) console.error(`Code:`, error.code);
        console.groupEnd();
      } else if (error && typeof error === 'object' && (error.stderr || error.stdout || error.stack)) {
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
