import { ipcSafe } from './ipcSafe';

/**
 * Universal, non-blocking clipboard copy utility.
 * 
 * Works safely across Electron (Windows/macOS/Linux) and Web/Browser environments.
 * Prevents OS clipboard locks, Chromium permission hangs, and unhandled promise rejections.
 */
export async function safeCopyToClipboard(text: string): Promise<boolean> {
  const textToCopy = typeof text === 'string' ? text : String(text ?? '');
  if (!textToCopy) return false;

  // 1. Electron Native IPC (Instant, zero-permission, never hangs on Windows/Mac)
  try {
    if (typeof window !== 'undefined' && window.electronAPI?.invoke) {
      const result = await Promise.race([
        ipcSafe.invoke('clipboard-write-text', textToCopy),
        new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error('IPC timeout')), 800))
      ]);
      if (result) return true;
    }
  } catch (e) {
    // Continue to web fallbacks
  }

  // 2. Modern navigator.clipboard API protected with strict 600ms timeout race to avoid Chromium hang
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await Promise.race([
        navigator.clipboard.writeText(textToCopy),
        new Promise((_, reject) => setTimeout(() => reject(new Error('navigator.clipboard timeout')), 600))
      ]);
      return true;
    }
  } catch (e) {
    // Continue to legacy fallback
  }

  // 3. Fallback: Hidden textarea with document.execCommand('copy')
  try {
    if (typeof document !== 'undefined') {
      const textarea = document.createElement('textarea');
      textarea.value = textToCopy;
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      textarea.style.left = '-9999px';
      textarea.style.opacity = '0';
      textarea.setAttribute('readonly', '');
      document.body.appendChild(textarea);
      
      textarea.focus();
      textarea.select();
      
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (successful) return true;
    }
  } catch (e) {
    console.error('All clipboard write methods failed:', e);
  }

  return false;
}
