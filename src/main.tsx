import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import DebugConsole from './components/DebugConsole.tsx';
import { GlobalErrorBoundary } from './components/common/GlobalErrorBoundary.tsx';
import { appLogger } from './lib/appLogger.ts';
import './index.css';
import './lib/webFileSystem.ts';

const isDebug = window.location.hash === '#/debug';

// Global uncaught exception listener with rich diagnostic trace
window.addEventListener('error', (event) => {
  const msg = event.message || '';
  if (
    msg.includes('GUEST_VIEW_MANAGER_CALL') ||
    msg.includes('ERR_ABORTED') ||
    msg.includes('(-3)') ||
    msg.toLowerCase().includes('websocket')
  ) {
    event.preventDefault();
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
});

// Global unhandled promise rejection listener
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const msg = reason ? (reason.message || String(reason)) : '';
  if (
    msg.includes('GUEST_VIEW_MANAGER_CALL') ||
    msg.includes('ERR_ABORTED') ||
    msg.includes('-3') ||
    msg.toLowerCase().includes('websocket') ||
    msg.toLowerCase().includes('vite')
  ) {
    event.preventDefault();
    return;
  }

  appLogger.log('CRASH', 'error', `🚨 Необработанный отказ Promise (Unhandled Rejection): ${msg}`, {
    reason,
    stack: reason?.stack
  });

  if ((window as any).electronAPI && (window as any).electronAPI.send) {
    (window as any).electronAPI.send('log-error', reason ? (reason.stack || String(reason)) : 'Unhandled Rejection');
  }
});

appLogger.info('SYSTEM', '🚀 Инициализация React интерфейса Anime Dub Manager завершена.');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobalErrorBoundary>
      {isDebug ? <DebugConsole /> : <App />}
    </GlobalErrorBoundary>
  </StrictMode>,
);
