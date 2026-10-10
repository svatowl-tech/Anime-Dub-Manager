import { ipcRenderer } from './ipc';
import { appLogger } from './appLogger';

export const isWeb = typeof window !== 'undefined' && !(window as any).electronAPI;

// Тяжелые фоновые операции: инференс AI, транскодирование, рендеринг, большие скачивания
// Для них расчетные таймауты устанавливаются адаптивно, чтобы не генерировать ложные ошибки зависания
const HEAVY_CHANNELS: Record<string, number> = {
  // Audio AI Cleanup & DSP
  'ai-denoise-audio': 60000,
  'ai-separate-stems': 120000,
  'ai-dereverb-audio': 60000,
  'ai-voice-fixer': 60000,
  'ai-process-subtitles': 90000,
  
  // Whisper Speech-to-Text & Diarization
  'transcribe-whisper-snippet': 30000,
  'timing-whisper-transcribe-clips': 60000,
  'qa-whisper-check-lines': 60000,
  'run-diarization': 120000,
  'load-local-translate-model': 45000,
  'translate-local': 30000,
  'load-diarization-model': 45000,
  'ollama-generate': 45000,
  'ollama-chat': 45000,
  
  // Media / Video / Transcoding
  'transcode-video': 180000,
  'render-final-video': 240000,
  'export-mix-audio': 120000,
  'extract-subtitle-track': 30000,
  'analyze-mkv-subtitles': 30000,
  'silence-audio-intervals': 45000,
  'burn-subtitles': 180000,
  'download-youtube-audio': 90000,
  
  // Network / Downloads
  'start-torrent-download': 30000,
  'search-nyaa-torrents': 25000,
  'get-torrent-metadata': 30000,
  'anime365-download-subtitle': 20000,
  'anime365-start-direct-download': 30000,
  'telegram-download-file': 120000,
  'telegram-upload-file': 120000,
  'cloud-push': 60000,
  'cloud-pull': 60000,
};

// Каналы циклического фонового мониторинга / телеметрии
// Их успешные рутинные вызовы не спамят консоль и буфер логов
const POLLING_CHANNELS = new Set([
  'get-active-downloads',
  'get-debug-stats',
  'get-tasks',
  'get-torrent-download-status',
  'anime365-get-direct-download-status',
  'cloud-sync-status',
  'check-diarization-status',
  'check-ollama-status',
  'telegram-get-status',
  'telegram-get-logs'
]);

export const ipcSafe = {
  invoke: async (channel: string, ...args: any[]) => {
    const isPolling = POLLING_CHANNELS.has(channel);
    const expectedDurationMs = HEAVY_CHANNELS[channel];

    // Start tracking process with smart adaptive hang detection
    const proc = appLogger.startProcess(
      'IPC',
      channel,
      args.length > 0 ? (args.length === 1 ? args[0] : args) : undefined,
      {
        silentPolling: isPolling,
        expectedDurationMs
      }
    );

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
