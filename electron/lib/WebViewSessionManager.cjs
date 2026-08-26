const { session, shell } = require('electron');
const log = require('electron-log');

const CHROME_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

/**
 * Configure session to bypass frame embedding restrictions (X-Frame-Options, CSP frame-ancestors)
 * and provide clean browser headers so Telegram, VK, YouTube, Google Drive, RuTube, etc. load smoothly.
 */
function configureWebViewSession(targetSession) {
  if (!targetSession) return;

  try {
    targetSession.setUserAgent(CHROME_USER_AGENT);

    const filter = { urls: ['*://*/*'] };

    // 1. Remove embedding and frame-blocking headers from HTTP responses
    targetSession.webRequest.onHeadersReceived(filter, (details, callback) => {
      const responseHeaders = { ...details.responseHeaders };

      // Case-insensitive deletion of framing restriction headers
      const headersToDelete = [
        'x-frame-options',
        'content-security-policy',
        'content-security-policy-report-only',
        'cross-origin-opener-policy',
        'cross-origin-embedder-policy',
        'cross-origin-resource-policy'
      ];

      for (const header of Object.keys(responseHeaders)) {
        if (headersToDelete.includes(header.toLowerCase())) {
          delete responseHeaders[header];
        }
      }

      // Allow all cookies to be received inside webview (vital for VK ID, Google, Yandex SSO)
      callback({
        cancel: false,
        responseHeaders
      });
    });

    // 2. Normalize request headers (User-Agent, sec-ch-ua, Accept-Language)
    targetSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
      const requestHeaders = { ...details.requestHeaders };

      requestHeaders['User-Agent'] = CHROME_USER_AGENT;
      if (requestHeaders['user-agent']) {
        requestHeaders['user-agent'] = CHROME_USER_AGENT;
      }
      
      // Provide clean Chrome client hints
      requestHeaders['sec-ch-ua'] = '"Chromium";v="133", "Not(A:Brand";v="99", "Google Chrome";v="133"';
      requestHeaders['sec-ch-ua-mobile'] = '?0';
      requestHeaders['sec-ch-ua-platform'] = '"Windows"';

      if (!requestHeaders['Accept-Language'] && !requestHeaders['accept-language']) {
        requestHeaders['Accept-Language'] = 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7';
      }

      callback({ requestHeaders });
    });

    // 3. Auto-accept valid TLS/SSL certificates
    if (typeof targetSession.setCertificateVerifyProc === 'function') {
      targetSession.setCertificateVerifyProc((request, callback) => {
        callback(0); // 0 = accept
      });
    }

    // 4. Auto-grant standard browser permissions (clipboard, media, notifications, fullscreen)
    if (typeof targetSession.setPermissionRequestHandler === 'function') {
      targetSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowed = ['clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'notifications', 'media'];
        if (allowed.includes(permission)) {
          return callback(true);
        }
        callback(true);
      });
    }

    log.info('[WebViewSession] Configured webview session with frame-bypass & browser headers');
  } catch (err) {
    log.error('[WebViewSession] Failed to configure webview session:', err);
  }
}

/**
 * Attaches handlers for web-contents created for webview tags
 */
function handleWebContentsCreated(event, contents) {
  if (contents.getType() === 'webview') {
    log.info('[WebViewSession] Webview webContents created');
    contents.setUserAgent(CHROME_USER_AGENT);

    // Support OAuth Popups (VK ID, Google, Yandex ID) smoothly like in Wexond & electron-browser-shell
    contents.setWindowOpenHandler(({ url, frameName, features }) => {
      log.info(`[WebViewSession] Window open requested: ${url}`);
      
      if (!url || url === 'about:blank') {
        return { action: 'allow' };
      }

      // If it's an OAuth / login popup (VK ID, Google SSO, Yandex ID, Telegram), allow native popup window
      const isAuthPopup = /id\.vk\.ru|accounts\.google\.com|oauth\.yandex\.ru|telegram\.org|t\.me|login|auth|signin/i.test(url) || (features && features.includes('width='));
      
      if (isAuthPopup) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 620,
            height: 720,
            autoHideMenuBar: true,
            title: 'Авторизация',
            webPreferences: {
              partition: 'persist:publisher',
              contextIsolation: true,
              nodeIntegration: false
            }
          }
        };
      }

      // Default: navigate in webview
      if (url.startsWith('http://') || url.startsWith('https://')) {
        contents.loadURL(url).catch((err) => {
          log.warn(`[WebViewSession] Webview failed to load URL (${url}):`, err.message);
        });
        return { action: 'deny' };
      } else {
        shell.openExternal(url).catch(() => {});
        return { action: 'deny' };
      }
    });

    contents.on('will-navigate', (event, url) => {
      log.info(`[WebViewSession] Webview navigation requested to: ${url}`);
      if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
        event.preventDefault();
        shell.openExternal(url).catch(() => {});
      }
    });

    contents.on('did-navigate', (event, url) => {
      log.info(`[WebViewSession] Webview successfully navigated to: ${url}`);
    });

    contents.on('render-process-gone', (event, details) => {
      log.warn(`[WebViewSession] Webview process crashed or was killed: ${details.reason} (${details.exitCode})`);
    });

    contents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      // Ignore normal aborts from redirects
      if (errorCode === -3) {
        return;
      }
      log.warn(`[WebViewSession] Webview failed loading: ${validatedURL} [${errorCode}: ${errorDescription}]`);
    });
  }
}

module.exports = {
  CHROME_USER_AGENT,
  configureWebViewSession,
  handleWebContentsCreated
};
