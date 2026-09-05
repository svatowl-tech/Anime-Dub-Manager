const { ipcRenderer } = require('electron');

/**
 * Enterprise-grade stealth & compatibility preload script for guest WebViews
 * Ensures maximum website compatibility (VK, Telegram, Google, Discord, Cloudflare Turnstile, Anime365, Shikimori, RuTracker)
 * Removes automation flags, emulates standard Google Chrome, polyfills missing runtime objects,
 * protects against frame-busting, and provides autofill/injection bridges for dubbing workflows.
 */

(function () {
  try {
    if (typeof window !== 'undefined') {
      // 1. STEALTH: Mask navigator.webdriver at prototype level so Cloudflare Turnstile, VK, and Google see a normal browser
      try {
        if ('webdriver' in navigator) {
          delete navigator.webdriver;
        }
        const proto = Object.getPrototypeOf(navigator);
        if (proto && 'webdriver' in proto) {
          Object.defineProperty(proto, 'webdriver', {
            get: () => undefined,
            enumerable: true,
            configurable: true
          });
        }
      } catch (e) {}

      // 2. STEALTH: Emulate window.chrome environment (required by Google Accounts, VK ID, Discord)
      try {
        if (!window.chrome) {
          window.chrome = {};
        }
        if (!window.chrome.app) {
          window.chrome.app = {
            isInstalled: false,
            InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
            RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
            getDetails: function () {},
            getIsInstalled: function () { return false; },
            installState: function () {}
          };
        }
        if (!window.chrome.runtime) {
          window.chrome.runtime = {
            id: undefined,
            connect: function () {},
            sendMessage: function () {},
            onMessage: { addListener: function () {}, removeListener: function () {}, hasListener: function () {} },
            onConnect: { addListener: function () {}, removeListener: function () {} }
          };
        }
        if (!window.chrome.csi) {
          window.chrome.csi = function () {
            return {
              startE: Date.now(),
              onloadT: Date.now() + 50,
              pageT: 100,
              tran: 15
            };
          };
        }
        if (!window.chrome.loadTimes) {
          window.chrome.loadTimes = function () {
            return {
              requestTime: Date.now() / 1000,
              startLoadTime: Date.now() / 1000,
              commitLoadTime: Date.now() / 1000,
              finishDocumentLoadTime: Date.now() / 1000,
              firstPaintTime: Date.now() / 1000,
              firstPaintAfterLoadTime: 0,
              navigationType: 'Other',
              wasFetchedViaSpdy: true,
              wasNpnNegotiated: true,
              npnNegotiatedProtocol: 'h2',
              wasAlternateProtocolAvailable: false,
              connectionInfo: 'h2'
            };
          };
        }
      } catch (e) {}

      // 3. STEALTH: Standard Russian + English browser languages
      try {
        Object.defineProperty(navigator, 'languages', {
          get: () => ['ru-RU', 'ru', 'en-US', 'en'],
          configurable: true
        });
      } catch (e) {}

      // 4. STEALTH: Standard permissions query fallback (prevents Turnstile/VK permission stalls)
      try {
        if (window.navigator.permissions && typeof window.navigator.permissions.query === 'function') {
          const origQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
          window.navigator.permissions.query = function (parameters) {
            if (parameters && parameters.name === 'notifications') {
              return Promise.resolve({
                state: typeof Notification !== 'undefined' && Notification.permission === 'denied' ? 'denied' : 'default',
                onchange: null
              });
            }
            return origQuery(parameters).catch(() => Promise.resolve({ state: 'granted', onchange: null }));
          };
        }
      } catch (e) {}

      // 5. COMPATIBILITY: Prevent Node.js global pollution from breaking UMD modules on anime & tracker sites
      if (typeof window.module !== 'undefined' && !window.module.exports) {
        try { delete window.module; } catch (e) {}
      }
      if (typeof window.exports !== 'undefined' && Object.keys(window.exports).length === 0) {
        try { delete window.exports; } catch (e) {}
      }

      // 6. COMPATIBILITY: Fallback for window.axios if a site relies on global window.axios
      if (typeof window.axios === 'undefined') {
        const fetchAxiosLike = async (url, config = {}) => {
          const method = (config.method || 'GET').toUpperCase();
          const headers = { ...config.headers };
          let body = config.data || config.body;
          if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
            body = JSON.stringify(body);
            if (!headers['Content-Type'] && !headers['content-type']) {
              headers['Content-Type'] = 'application/json';
            }
          }
          const response = await fetch(url, {
            method,
            headers,
            body: ['GET', 'HEAD'].includes(method) ? undefined : body,
            credentials: config.withCredentials ? 'include' : 'same-origin'
          });
          const contentType = response.headers.get('content-type') || '';
          let data;
          if (contentType.includes('application/json')) {
            data = await response.json().catch(() => null);
          } else {
            data = await response.text().catch(() => '');
          }
          return {
            data,
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            config,
            request: response
          };
        };

        const axiosShim = function(configOrUrl, maybeConfig) {
          if (typeof configOrUrl === 'string') {
            return fetchAxiosLike(configOrUrl, maybeConfig || {});
          }
          return fetchAxiosLike(configOrUrl.url, configOrUrl);
        };

        axiosShim.get = (url, config) => fetchAxiosLike(url, { ...config, method: 'GET' });
        axiosShim.post = (url, data, config) => fetchAxiosLike(url, { ...config, data, method: 'POST' });
        axiosShim.put = (url, data, config) => fetchAxiosLike(url, { ...config, data, method: 'PUT' });
        axiosShim.delete = (url, config) => fetchAxiosLike(url, { ...config, method: 'DELETE' });
        axiosShim.patch = (url, data, config) => fetchAxiosLike(url, { ...config, data, method: 'PATCH' });
        axiosShim.head = (url, config) => fetchAxiosLike(url, { ...config, method: 'HEAD' });
        axiosShim.options = (url, config) => fetchAxiosLike(url, { ...config, method: 'OPTIONS' });
        axiosShim.create = () => axiosShim;
        axiosShim.defaults = { headers: { common: {} }, timeout: 0 };
        axiosShim.interceptors = {
          request: { use: () => 0, eject: () => {} },
          response: { use: () => 0, eject: () => {} }
        };

        try {
          Object.defineProperty(window, 'axios', {
            value: axiosShim,
            writable: true,
            configurable: true
          });
        } catch (e) {
          window.axios = axiosShim;
        }
      }

      // 7. SNIFFER: Notify host container of Title, Favicon, and Media updates
      const notifyMetadata = () => {
        try {
          const title = document.title || window.location.hostname || '';
          let favicon = '';
          const iconLink = document.querySelector("link[rel*='icon'], link[rel='shortcut icon']");
          if (iconLink && iconLink.href) {
            favicon = iconLink.href;
          } else {
            favicon = `${window.location.origin}/favicon.ico`;
          }

          // Scan media sources for sniffer
          const mediaUrls = [];
          document.querySelectorAll('video, video source, audio, audio source').forEach(el => {
            const s = el.getAttribute('src');
            if (s && (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('blob:'))) {
              mediaUrls.push(s);
            }
          });

          ipcRenderer.sendToHost('browser-page-metadata', {
            title,
            favicon,
            url: window.location.href,
            mediaUrls: Array.from(new Set(mediaUrls))
          });
        } catch (err) {}
      };

      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        notifyMetadata();
      } else {
        window.addEventListener('DOMContentLoaded', notifyMetadata);
      }
      window.addEventListener('load', notifyMetadata);

      // Observe dynamic DOM changes for titles and media
      try {
        const titleEl = document.querySelector('title');
        if (titleEl) {
          const obs = new MutationObserver(notifyMetadata);
          obs.observe(titleEl, { childList: true, characterData: true, subtree: true });
        }
      } catch (e) {}

      // 8. AUTOPASTE & POST INJECTION BRIDGE
      // Allows user to click "Вставить пост в поле на сайте" and cleanly insert text into VK, TG, etc.
      ipcRenderer.on('adm-inject-post', (event, text) => {
        try {
          if (!text || typeof text !== 'string') return;

          let target = document.activeElement;
          if (!target || target === document.body || (target.tagName !== 'TEXTAREA' && target.tagName !== 'INPUT' && !target.isContentEditable)) {
            // Target specific platform editors
            target = document.querySelector('#post_field') || 
                     document.querySelector('.mention_rich_ta') ||
                     document.querySelector('.input-message-input') || 
                     document.querySelector('.input-message-container [contenteditable="true"]') ||
                     document.querySelector('#message') || 
                     document.querySelector('textarea[name="message"]') ||
                     document.querySelector('[contenteditable="true"]') ||
                     document.querySelector('textarea') || 
                     document.querySelector('input[type="text"]');
          }

          if (target) {
            target.focus();
            if (target.isContentEditable) {
              document.execCommand('insertText', false, text);
              if (!target.innerText || !target.innerText.includes(text.slice(0, 15))) {
                target.innerText = text;
              }
            } else {
              const start = target.selectionStart || 0;
              const end = target.selectionEnd || 0;
              target.value = target.value.slice(0, start) + text + target.value.slice(end);
              target.selectionStart = target.selectionEnd = start + text.length;
            }

            target.dispatchEvent(new Event('input', { bubbles: true }));
            target.dispatchEvent(new Event('change', { bubbles: true }));
            ipcRenderer.sendToHost('adm-inject-result', { success: true });
          } else {
            ipcRenderer.sendToHost('adm-inject-result', { success: false, reason: 'Поле ввода не найдено' });
          }
        } catch (err) {
          ipcRenderer.sendToHost('adm-inject-result', { success: false, error: err.message });
        }
      });
    }
  } catch (globalErr) {
    console.warn('[browser-preload] Notice:', globalErr);
  }
})();

