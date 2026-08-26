import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import DebugConsole from './components/DebugConsole.tsx';
import './index.css';
import './lib/webFileSystem.ts';

const isDebug = window.location.hash === '#/debug';

window.addEventListener('error', (event) => {
  const msg = event.message || '';
  if (msg.includes('GUEST_VIEW_MANAGER_CALL') || msg.includes('ERR_ABORTED') || msg.includes('(-3)')) {
    event.preventDefault();
    return;
  }
  if (window.electronAPI && window.electronAPI.send) {
    window.electronAPI.send('log-error', event.error ? event.error.stack : event.message);
  }
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const msg = reason ? (reason.message || String(reason)) : '';
  if (
    msg.includes('GUEST_VIEW_MANAGER_CALL') ||
    msg.includes('ERR_ABORTED') ||
    msg.includes('-3')
  ) {
    event.preventDefault();
    return;
  }
  if (window.electronAPI && window.electronAPI.send) {
    window.electronAPI.send('log-error', reason ? (reason.stack || String(reason)) : 'Unhandled Rejection');
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDebug ? <DebugConsole /> : <App />}
  </StrictMode>,
);
