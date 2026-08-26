const axios = require('axios');
const log = require('electron-log');

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

// In-memory cookie jar per domain for smart proxy sessions
const domainCookies = new Map();

/**
 * Normalizes URL and extracts clean origin
 */
function getOrigin(urlString) {
  try {
    const u = new URL(urlString);
    return u.origin;
  } catch (e) {
    return '';
  }
}

/**
 * Rewrite HTML tags to route relative scripts, styles, and links through proxy asset handler
 */
function rewriteHtmlForProxy(html, targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    const origin = parsed.origin;
    const currentDir = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);

    // 1. Rewrite relative src and href attributes to pass through proxy or asset endpoint
    let modifiedHtml = html;

    // Inject smart client runtime into <head>
    const injectedScript = `
      <base href="${origin}/">
      <script>
        window.__ADM_PROXY_ORIGIN__ = "${origin}";
        window.__ADM_TARGET_URL__ = "${targetUrl}";
        
        // Intercept ServiceWorker registration
        try {
          if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(function(regs) {
              if (regs && regs.length) regs.forEach(function(r) { r.unregister(); });
            }).catch(function() {});
            navigator.serviceWorker.register = function() {
              return Promise.reject(new Error('ServiceWorker disabled in proxy environment'));
            };
          }
        } catch (e) {}

        // Global message helper for metadata extraction
        function sendMetadataToParent() {
          try {
            const meta = {
              type: 'ADM_BROWSER_PAGE_DATA',
              title: document.title || '',
              url: window.location.href,
              ogImage: (document.querySelector('meta[property="og:image"]') || {}).content || '',
              description: (document.querySelector('meta[name="description"]') || document.querySelector('meta[property="og:description"]') || {}).content || ''
            };
            window.parent.postMessage(meta, '*');
          } catch(e) {}
        }
        window.addEventListener('load', sendMetadataToParent);
      </script>
    `;

    // Neutralize frame-busting scripts
    modifiedHtml = modifiedHtml.replace(/if\s*\(\s*top\s*!==\s*self\s*\)/g, 'if(false)');
    modifiedHtml = modifiedHtml.replace(/if\s*\(\s*window\.top\s*!==\s*window\.self\s*\)/g, 'if(false)');
    modifiedHtml = modifiedHtml.replace(/top\.location\s*=/g, '/*top.loc*/ null=');

    // Fix fonts crossorigin attribute
    modifiedHtml = modifiedHtml.replace(/<link([^>]*rel=["']preload["'][^>]*as=["']font["'][^>]*)>/gi, (match) => {
      if (!match.includes('crossorigin')) {
        return match.replace(/<link/i, '<link crossorigin="anonymous"');
      }
      return match;
    });

    if (modifiedHtml.includes('<head>')) {
      modifiedHtml = modifiedHtml.replace('<head>', `<head>${injectedScript}`);
    } else if (modifiedHtml.includes('<html>')) {
      modifiedHtml = modifiedHtml.replace('<html>', `<html><head>${injectedScript}</head>`);
    } else {
      modifiedHtml = `<head>${injectedScript}</head>` + modifiedHtml;
    }

    return modifiedHtml;
  } catch (err) {
    log.warn('[WebProxy] HTML rewrite notice:', err.message);
    return html;
  }
}

/**
 * Handles main web proxy page requests
 */
async function handleWebProxyRequest(req, res) {
  const targetUrl = req.query.url;
  if (!targetUrl || typeof targetUrl !== 'string') {
    log.warn('[WebProxy] Missing url parameter in request');
    return res.status(400).send('Параметр url отсутствует');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (err) {
    log.warn(`[WebProxy] Invalid URL received: ${targetUrl}`);
    return res.status(400).send('Некорректный URL');
  }

  const origin = parsedUrl.origin;
  const startTime = Date.now();
  log.info(`[WebProxy] Smart Proxy requesting: ${targetUrl}`);

  try {
    const existingCookies = domainCookies.get(origin) || '';

    const response = await axios({
      method: req.method || 'GET',
      url: targetUrl,
      headers: {
        'User-Agent': CHROME_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cookie': existingCookies,
        'sec-ch-ua': '"Chromium";v="133", "Google Chrome";v="133", "Not_A Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none'
      },
      responseType: 'arraybuffer',
      maxRedirects: 5,
      validateStatus: () => true,
      timeout: 18000
    });

    // Save set-cookie headers
    const setCookie = response.headers['set-cookie'];
    if (setCookie && Array.isArray(setCookie)) {
      const merged = setCookie.map(c => c.split(';')[0]).join('; ');
      domainCookies.set(origin, merged);
    }

    const contentType = response.headers['content-type'] || 'text/html';
    const duration = Date.now() - startTime;
    log.info(`[WebProxy] Response for ${targetUrl} [${response.status}] in ${duration}ms, Type: ${contentType}`);

    res.status(response.status);

    // Set permissive CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    // Block embedding restriction headers
    const blockedHeaders = [
      'x-frame-options',
      'content-security-policy',
      'content-security-policy-report-only',
      'cross-origin-opener-policy',
      'cross-origin-embedder-policy',
      'cross-origin-resource-policy',
      'clear-site-data',
      'content-encoding'
    ];

    for (const [key, value] of Object.entries(response.headers)) {
      if (!blockedHeaders.includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    }

    if (contentType.includes('text/html')) {
      const rawHtml = Buffer.from(response.data).toString('utf-8');
      const processedHtml = rewriteHtmlForProxy(rawHtml, targetUrl);
      return res.send(processedHtml);
    }

    return res.send(Buffer.from(response.data));
  } catch (error) {
    const duration = Date.now() - startTime;
    log.warn(`[WebProxy] Smart Proxy error for ${targetUrl} (${duration}ms):`, error.message);
    
    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #09090b;
            color: #f4f4f5;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            padding: 24px;
            box-sizing: border-box;
          }
          .card {
            background: #18181b;
            border: 1px solid #27272a;
            border-radius: 16px;
            padding: 28px;
            max-width: 520px;
            text-align: center;
            box-shadow: 0 12px 40px rgba(0,0,0,0.6);
          }
          .icon {
            width: 48px;
            height: 48px;
            background: rgba(56, 189, 248, 0.1);
            border: 1px solid rgba(56, 189, 248, 0.2);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 16px;
            font-size: 22px;
          }
          h2 { margin: 0 0 8px 0; color: #38bdf8; font-size: 18px; font-weight: 700; }
          p { font-size: 13px; color: #a1a1aa; line-height: 1.6; margin-bottom: 20px; }
          .badge {
            display: inline-block;
            background: #27272a;
            color: #e4e4e7;
            padding: 4px 10px;
            border-radius: 6px;
            font-family: monospace;
            font-size: 12px;
            margin-bottom: 16px;
            word-break: break-all;
          }
          .actions {
            display: flex;
            gap: 10px;
            justify-content: center;
            flex-wrap: wrap;
          }
          .btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: #0284c7;
            color: white;
            padding: 10px 18px;
            border-radius: 10px;
            text-decoration: none;
            font-weight: 600;
            font-size: 13px;
            transition: all 0.2s;
          }
          .btn:hover { background: #0369a1; }
          .btn-secondary {
            background: #27272a;
            color: #d4d4d8;
          }
          .btn-secondary:hover { background: #3f3f46; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">🛡️</div>
          <h2>Защищенный веб-ресурс</h2>
          <div class="badge">${targetUrl}</div>
          <p>Сайт использует многоуровневую защиту (Cloudflare Turnstile, SSO или строгие политики авторизации). Для стабильной работы переключите движок на <strong>«Интерактивное окно»</strong> или откройте во внешнем браузере.</p>
          <div class="actions">
            <a href="${targetUrl}" target="_blank" class="btn">Открыть в браузере ↗</a>
            <button onclick="window.parent.postMessage({type: 'ADM_SWITCH_ENGINE', engine: 'popup-overlay'}, '*')" class="btn btn-secondary">Включить режим окна</button>
          </div>
        </div>
      </body>
      </html>
    `);
  }
}

/**
 * Handles asset proxy requests (css, js, images, api)
 */
async function handleWebProxyAgentRequest(req, res) {
  const targetUrl = req.query.url;
  const origin = req.query.origin;

  if (!targetUrl) {
    return res.status(400).send('Missing url parameter');
  }

  let finalUrl = targetUrl;
  if (targetUrl.startsWith('/') && origin) {
    finalUrl = `${origin}${targetUrl}`;
  }

  try {
    const existingCookies = origin ? (domainCookies.get(origin) || '') : '';
    const response = await axios({
      method: req.method || 'GET',
      url: finalUrl,
      headers: {
        'User-Agent': CHROME_UA,
        'Cookie': existingCookies,
        'Accept': '*/*'
      },
      responseType: 'arraybuffer',
      timeout: 12000,
      validateStatus: () => true
    });

    res.status(response.status);
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (response.headers['content-type']) {
      res.setHeader('Content-Type', response.headers['content-type']);
    }
    return res.send(Buffer.from(response.data));
  } catch (err) {
    return res.status(404).send('Asset not found');
  }
}

module.exports = {
  handleWebProxyRequest,
  handleWebProxyAgentRequest
};
