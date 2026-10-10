import { ipcRenderer } from './ipc';
import { appLogger } from './appLogger';

export const isWeb = typeof window !== 'undefined' && !(window as any).electronAPI;

export const ipcSafe = {
  invoke: async (channel: string, ...args: any[]) => {
    // Start tracking process with automatic hang detection
    const proc = appLogger.startProcess('IPC', channel, args.length > 0 ? args : undefined);

    try {
      const response = await ipcRenderer.invoke(channel, ...args);
      
      // If the response is the standardized format { success: boolean, data?: any, error?: string }
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
          
          proc.fail(richError, {
            error: errMsg,
            stderr: response.stderr,
            stdout: response.stdout,
            code: response.code
          });
          throw richError;
        }

        const data = response.data !== undefined ? response.data : response;
        proc.success(
          typeof data === 'object' && data !== null
            ? (Array.isArray(data) ? `[Array: ${data.length} items]` : `[Object: ${Object.keys(data).length} keys]`)
            : data
        );
        return data;
      }
      
      // Fallback for handlers that haven't been wrapped yet
      proc.success(
        typeof response === 'object' && response !== null
          ? (Array.isArray(response) ? `[Array: ${response.length} items]` : `[Object: ${Object.keys(response).length} keys]`)
          : response
      );
      return response;
    } catch (error: any) {
      const isOperationalTgChannel = channel.startsWith('telegram-mtproto-') && 
        !channel.includes('qr') && 
        !channel.includes('send-code') && 
        !channel.includes('sign-in') && 
        !channel.includes('submit-password');

      const errStr = String(error?.message || error || '');
      // Only treat actual Telegram session revocation / expiration as invalidated!
      const isSessionRevoked = errStr.includes('AUTH_KEY_UNREGISTERED') ||
                               errStr.includes('AUTH_KEY_INVALID') ||
                               errStr.includes('SESSION_REVOKED') ||
                               errStr.includes('SESSION_EXPIRED') ||
                               errStr.includes('Сессия Telegram устарела');

      if (isOperationalTgChannel && isSessionRevoked) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('telegram-auth-invalidated'));
        }
        appLogger.warn('TELEGRAM', `Auth session revoked on channel "${channel}": ${error.message || errStr}`);
        proc.warn(`Telegram session revoked: ${error.message || errStr}`);
        throw error;
      }

      proc.fail(error, {
        channel,
        args,
        stderr: error.stderr,
        stdout: error.stdout,
        code: error.code
      });

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
      appLogger.info('IPC', `📤 ipcSafe.send: ${channel}`, args.length > 0 ? args : undefined);
      ipcRenderer.send(channel, ...args);
    } catch (error) {
      appLogger.error('IPC', `❌ IPC Send Error on channel "${channel}":`, error);
      console.error(`IPC Send Error on channel "${channel}":`, error);
    }
  },

  on: (channel: string, callback: (...args: any[]) => void) => {
    appLogger.debug('IPC', `👂 ipcSafe.on listener registered: ${channel}`);
    return ipcRenderer.on(channel, callback);
  },

  removeListener: (channel: string, callback: (...args: any[]) => void) => {
    appLogger.debug('IPC', `🔕 ipcSafe.removeListener: ${channel}`);
    return ipcRenderer.removeListener(channel, callback);
  }
};
