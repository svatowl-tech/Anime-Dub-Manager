const { session, shell, BrowserWindow } = require('electron');
const log = require('electron-log');

const CHROME_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

// Track configured sessions to avoid redundant filter registrations
const configuredSessions = new WeakSet();

/**
 * Configure session to bypass frame embedding restrictions (X-Frame-Options, CSP frame-ancestors)
 * and provide authentic Chrome browser headers so VK, Telegram, YouTube, Google Drive, RuTube,
 * Sibnet, Kodik, Anime365, Shikimori, RuTracker, etc. load and authenticate smoothly.
 */
function configureWebViewSession(targetSession) {
  if (!targetSession) return;
  if (configuredSessions.has(targetSession)) return;
  configuredSessions.add(targetSession);

  try {
    targetSession.setUserAgent(CHROME_USER_AGENT);

    const filter = { urls: ['*://*/*'] };

    // 1. Remove embedding, frame-blocking, and opener-blocking headers from HTTP responses
    targetSession.webRequest.onHeadersReceived(filter, (details, callback) => {
      const responseHeaders = { ...details.responseHeaders };

      // Case-insensitive deletion of framing and isolation restriction headers
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

      // Ensure Set-Cookie is preserved without restrictive SameSite attributes for embedded frames
      if (responseHeaders['set-cookie'] || responseHeaders['Set-Cookie']) {
        const key = responseHeaders['set-cookie'] ? 'set-cookie' : 'Set-Cookie';
        if (Array.isArray(responseHeaders[key])) {
          responseHeaders[key] = responseHeaders[key].map(cookieStr => {
            // Strip SameSite=Strict if present in iframe context, use SameSite=None; Secure if https
            if (cookieStr.includes('SameSite=Strict') && details.url.startsWith('https:')) {
              return cookieStr.replace('SameSite=Strict', 'SameSite=None; Secure');
            }
            return cookieStr;
          });
        }
      }

      callback({
        cancel: false,
        responseHeaders
      });
    });

    // 2. Normalize request headers (User-Agent, sec-ch-ua, Accept-Language, Client Hints)
    targetSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
      const requestHeaders = { ...details.requestHeaders };

      // Strip any Electron signature from User-Agent
      requestHeaders['User-Agent'] = CHROME_USER_AGENT;
      if (requestHeaders['user-agent']) {
        requestHeaders['user-agent'] = CHROME_USER_AGENT;
      }
      
      // Provide clean Chrome desktop client hints
      requestHeaders['sec-ch-ua'] = '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"';
      requestHeaders['sec-ch-ua-mobile'] = '?0';
      requestHeaders['sec-ch-ua-platform'] = '"Windows"';
      requestHeaders['sec-ch-ua-platform-version'] = '"15.0.0"';
      requestHeaders['sec-ch-ua-full-version'] = '"133.0.6943.127"';

      if (!requestHeaders['Accept-Language'] && !requestHeaders['accept-language']) {
        requestHeaders['Accept-Language'] = 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7';
      }

      callback({ requestHeaders });
    });

    // 3. Auto-accept valid TLS/SSL certificates & allow custom media/tracker endpoints
    if (typeof targetSession.setCertificateVerifyProc === 'function') {
      targetSession.setCertificateVerifyProc((request, callback) => {
        callback(0); // 0 = accept
      });
    }

    // 4. Auto-grant standard browser permissions (clipboard, media, notifications, fullscreen)
    if (typeof targetSession.setPermissionRequestHandler === 'function') {
      targetSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowed = [
          'clipboard-read',
          'clipboard-sanitized-write',
          'fullscreen',
          'notifications',
          'media',
          'mediaKeySystem',
          'pointerLock',
          'openExternal'
        ];
        if (allowed.includes(permission)) {
          return callback(true);
        }
        callback(true);
      });
    }

    if (typeof targetSession.setPermissionCheckHandler === 'function') {
      targetSession.setPermissionCheckHandler(() => true);
    }

    log.info('[WebViewSession] Configured session with full browser header bypass and persistent auth.');
  } catch (err) {
    log.error('[WebViewSession] Failed to configure webview session:', err);
  }
}

/**
 * Attaches handlers for web-contents created for webview tags and auth popup windows
 */
function handleWebContentsCreated(event, contents) {
  const type = contents.getType();
  
  if (type === 'webview' || type === 'window') {
    log.info(`[WebViewSession] WebContents created of type: ${type}`);
    
    try {
      contents.setUserAgent(CHROME_USER_AGENT);
      if (contents.session) {
        configureWebViewSession(contents.session);
      }
    } catch (e) {}

    // Support OAuth Popups (VK ID, Google, Yandex ID, Telegram, RuTube, Discord, etc.)
    contents.setWindowOpenHandler(({ url, frameName, features }) => {
      log.info(`[WebViewSession] Window open requested: ${url}`);
      
      if (!url || url === 'about:blank') {
        return { action: 'allow' };
      }

      // Check if this is an OAuth / auth popup or window.open with dimensions
      const isAuthPopup = /id\.vk\.(?:com|ru)|oauth\.vk\.com|vk\.com\/(?:login|join|auth)|accounts\.google\.com|oauth\.yandex\.(?:ru|com)|passport\.yandex\.(?:ru|com)|telegram\.org|oauth\.telegram\.org|t\.me|rutube\.ru\/(?:auth|login)|account\.mail\.ru|connect\.mail\.ru|discord\.com\/oauth2|github\.com\/login|shikimori\.one\/users\/sign_in|smotret-anime\.online\/users\/login|login|auth|signin|signup|authorize/i.test(url) || (features && (features.includes('width=') || features.includes('height=')));
      
      if (isAuthPopup) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 720,
            height: 820,
            autoHideMenuBar: true,
            title: 'Авторизация в сервисе',
            backgroundColor: '#0f0f0f',
            webPreferences: {
              partition: 'persist:publisher',
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: false,
              userAgent: CHROME_USER_AGENT
            }
          }
        };
      }

      // Default: allow window open with shared session
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 1024,
            height: 768,
            autoHideMenuBar: true,
            webPreferences: {
              partition: 'persist:publisher',
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: false,
              userAgent: CHROME_USER_AGENT
            }
          }
        };
      } else {
        shell.openExternal(url).catch(() => {});
        return { action: 'deny' };
      }
    });

    contents.on('will-navigate', (event, url) => {
      log.info(`[WebViewSession] Navigation requested to: ${url}`);
      if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
        event.preventDefault();
        shell.openExternal(url).catch(() => {});
      }
    });

    contents.on('did-navigate', (event, url) => {
      log.info(`[WebViewSession] Successfully navigated to: ${url}`);
    });

    contents.on('render-process-gone', (event, details) => {
      log.warn(`[WebViewSession] Render process gone: ${details.reason} (${details.exitCode})`);
    });

    contents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      // Ignore normal aborts from redirects (-3), blocked by client (-20), etc.
      if (errorCode === -3 || errorCode === -20 || errorCode === -102 || errorCode === -105) {
        return;
      }
      log.warn(`[WebViewSession] Load failure: ${validatedURL} [${errorCode}: ${errorDescription}]`);
    });
  }
}

/**
 * Open a standalone dedicated authentication window for any service (VK ID, Google, Yandex, etc.)
 * sharing the persist:publisher partition so cookies sync immediately into embedded webviews.
 */
function openAuthModalWindow(url, title = 'Авторизация') {
  return new Promise((resolve) => {
    try {
      const authWin = new BrowserWindow({
        width: 740,
        height: 840,
        title: title || 'Авторизация в сервисе',
        autoHideMenuBar: true,
        backgroundColor: '#0f0f0f',
        webPreferences: {
          partition: 'persist:publisher',
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          userAgent: CHROME_USER_AGENT
        }
      });

      if (authWin.webContents && authWin.webContents.session) {
        configureWebViewSession(authWin.webContents.session);
      }

      authWin.loadURL(url);

      authWin.on('closed', () => {
        resolve({ success: true });
      });
    } catch (err) {
      log.error('[WebViewSession] Failed to open auth window:', err);
      resolve({ success: false, error: err.message });
    }
  });
}

module.exports = {
  CHROME_USER_AGENT,
  configureWebViewSession,
  handleWebContentsCreated,
  openAuthModalWindow
};
