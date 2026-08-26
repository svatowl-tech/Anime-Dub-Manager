const { ipcRenderer } = require('electron');

/**
 * Clean isolated preload script for guest WebViews in Anime Dub Manager
 * Inspired by Wexond, Lulumi, and electron-browser-shell
 * Ensures maximum web compatibility, prevents UMD scope pollution, and polyfills missing globals
 */

(function () {
  try {
    if (typeof window !== 'undefined') {
      // 1. Prevent Node.js global pollution from breaking UMD modules on sites like Anime365 / smotret-anime
      if (typeof window.module !== 'undefined' && !window.module.exports) {
        try { delete window.module; } catch (e) {}
      }
      if (typeof window.exports !== 'undefined' && Object.keys(window.exports).length === 0) {
        try { delete window.exports; } catch (e) {}
      }

      // 2. Fallback for window.axios if a site relies on global window.axios
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

      // 3. Notify host container of Title & Favicon updates
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

          ipcRenderer.sendToHost('browser-page-metadata', {
            title,
            favicon,
            url: window.location.href
          });
        } catch (err) {}
      };

      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        notifyMetadata();
      } else {
        window.addEventListener('DOMContentLoaded', notifyMetadata);
      }
      window.addEventListener('load', notifyMetadata);

      // Observe dynamic changes in document.title
      try {
        const titleEl = document.querySelector('title');
        if (titleEl) {
          const obs = new MutationObserver(notifyMetadata);
          obs.observe(titleEl, { childList: true, characterData: true, subtree: true });
        }
      } catch (e) {}
    }
  } catch (globalErr) {
    console.warn('[browser-preload] Notice:', globalErr);
  }
})();
