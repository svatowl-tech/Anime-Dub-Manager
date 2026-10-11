import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import DebugConsole from './components/DebugConsole.tsx';
import { GlobalErrorBoundary } from './components/common/GlobalErrorBoundary.tsx';
import { appLogger } from './lib/appLogger.ts';
import './index.css';
import './lib/webFileSystem.ts';

const isDebug = window.location.hash === '#/debug';

function isIgnorableError(msg: string, stack?: string, filename?: string): boolean {
  const fullText = `${msg} ${stack || ''} ${filename || ''}`.toLowerCase();
  return (
    fullText.includes('chrome-extension://') ||
    fullText.includes('moz-extension://') ||
    fullText.includes('safari-extension://') ||
    fullText.includes('metamask') ||
    fullText.includes('ethereum') ||
    fullText.includes('inpage.js') ||
    fullText.includes('guest_view_manager_call') ||
    fullText.includes('err_aborted') ||
    fullText.includes('(-3)') ||
    fullText.includes('resizeobserver') ||
    fullText.includes('websocket') ||
    fullText.includes('vite')
  );
}

// Global uncaught exception listener with rich diagnostic trace
window.addEventListener('error', (event) => {
  const msg = event.message || '';
  const stack = event.error ? event.error.stack : '';
  const filename = event.filename || '';

  if (isIgnorableError(msg, stack, filename)) {
    event.preventDefault();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
    return;
  }

  appLogger.log('CRASH', 'error', `🚨 Необработанная ошибка окна: ${msg}`, {
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error
  });

  if ((window as any).electronAPI && (window as any).electronAPI.send) {
    (window as any).electronAPI.send('log-error', event.error ? event.error.stack : event.message);
  }
}, true);

// Global unhandled promise rejection listener
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const msg = reason ? (reason.message || String(reason)) : '';
  const stack = reason ? (reason.stack || '') : '';

  if (isIgnorableError(msg, stack)) {
    event.preventDefault();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
    return;
  }

  appLogger.log('CRASH', 'error', `🚨 Необработанный отказ Promise (Unhandled Rejection): ${msg}`, {
    reason,
    stack: reason?.stack
  });

  if ((window as any).electronAPI && (window as any).electronAPI.send) {
    (window as any).electronAPI.send('log-error', reason ? (reason.stack || String(reason)) : 'Unhandled Rejection');
  }
}, true);

appLogger.info('SYSTEM', '🚀 Инициализация React интерфейса Anime Dub Manager завершена.');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobalErrorBoundary>
      {isDebug ? <DebugConsole /> : <App />}
    </GlobalErrorBoundary>
  </StrictMode>,
);
