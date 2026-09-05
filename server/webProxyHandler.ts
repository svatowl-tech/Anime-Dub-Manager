import { Request, Response } from 'express';
import axios from 'axios';

// In-memory cookie store per domain to keep user sessions across requests in web mode
const domainCookieJar: Record<string, string[]> = {};

/**
 * Universal High-Compatibility Web Proxy Handler
 * - Removes X-Frame-Options, CSP, COOP, COEP
 * - Maintains persistent session cookies across navigation
 * - Injects browser stealth polyfills (navigator.webdriver mask, window.chrome)
 * - Injects link & form interceptors so navigation stays smoothly within the proxy
 * - Allows full authentication and browsing across VK, Telegram, anime portals, trackers, etc.
 */
export async function handleWebProxy(req: Request, res: Response) {
  const targetUrl = (req.query.url as string) || '';

  if (!targetUrl || (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://'))) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"><title>Anime Dub Manager</title></head>
        <body style="background:#0a0a0a;color:#eee;font-family:sans-serif;padding:24px;text-align:center;">
          <h2>Не указан адрес страницы</h2>
          <p style="color:#888;">Введите URL для перехода в браузере</p>
        </body>
      </html>
    `);
  }

  try {
    const urlObj = new URL(targetUrl);
    const domainKey = urlObj.hostname;

    // Collect stored cookies for this domain
    const existingCookies = domainCookieJar[domainKey] || [];
    const cookieHeader = existingCookies.length > 0 ? existingCookies.join('; ') : undefined;

    // Build headers with authentic Chrome Desktop profile
    const reqHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      'sec-ch-ua': '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-ch-ua-platform-version': '"15.0.0"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
      'Referer': `${urlObj.origin}/`,
      'Cache-Control': 'no-cache',
    };

    if (cookieHeader) {
      reqHeaders['Cookie'] = cookieHeader;
    }

    // Determine HTTP method
    const method = req.method === 'POST' ? 'POST' : 'GET';
    const postData = method === 'POST' ? req.body : undefined;

    const response = await axios({
      method,
      url: targetUrl,
      data: postData,
      timeout: 15000,
      headers: reqHeaders,
      responseType: 'arraybuffer',
      validateStatus: () => true, // Don't throw on non-200 so real site errors/login states render
      maxRedirects: 5
    });

    // Capture and persist any Set-Cookie headers into domain cookie store
    const setCookies = response.headers['set-cookie'];
    if (setCookies) {
      if (!domainCookieJar[domainKey]) {
        domainCookieJar[domainKey] = [];
      }
      const rawList = Array.isArray(setCookies) ? setCookies : [setCookies];
      rawList.forEach((cookieStr: string) => {
        const parts = cookieStr.split(';')[0];
        if (parts && parts.includes('=')) {
          const name = parts.split('=')[0].trim();
          // Remove old cookie with same name
          domainCookieJar[domainKey] = domainCookieJar[domainKey].filter(
            c => !c.startsWith(`${name}=`)
          );
          domainCookieJar[domainKey].push(parts.trim());
        }
      });
    }

    const contentType = String(response.headers['content-type'] || 'text/html');

    // Remove all headers that prevent embedding or framing
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('Content-Security-Policy-Report-Only');
    res.removeHeader('Cross-Origin-Embedder-Policy');
    res.removeHeader('Cross-Origin-Opener-Policy');
    res.removeHeader('Cross-Origin-Resource-Policy');

    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    // If response is media, script, font, or stylesheet, return binary payload directly
    if (!contentType.includes('text/html')) {
      return res.status(response.status).send(response.data);
    }

    let html = response.data.toString('utf-8');

    // Inject stealth scripts, base tag, and link navigation interceptor
    const baseTag = `<base href="${targetUrl}">`;
    const stealthAndBridgeScript = `
      <script>
        (function() {
          try {
            // 1. Mask automation
            if ('webdriver' in navigator) {
              delete navigator.webdriver;
            }
            try {
              Object.defineProperty(Object.getPrototypeOf(navigator), 'webdriver', {
                get: () => undefined,
                configurable: true
              });
            } catch(e) {}

            // 2. Emulate Chrome runtime
            if (!window.chrome) window.chrome = {};
            if (!window.chrome.app) window.chrome.app = { isInstalled: false };
            if (!window.chrome.runtime) window.chrome.runtime = {};

            // 3. Inform host app of page title and current URL
            const sendMeta = () => {
              try {
                window.parent.postMessage({
                  type: 'ADM_BROWSER_PAGE_DATA',
                  title: document.title || window.location.hostname,
                  url: ${JSON.stringify(targetUrl)}
                }, '*');
              } catch(e) {}
            };
            sendMeta();
            window.addEventListener('DOMContentLoaded', sendMeta);
            window.addEventListener('load', sendMeta);

            // 4. Intercept link clicks so navigation stays inside the smart proxy
            document.addEventListener('click', function(e) {
              const a = e.target.closest('a');
              if (a && a.href && !a.href.startsWith('javascript:') && !a.href.startsWith('#')) {
                if (a.target === '_blank') {
                  return; // let new tabs open
                }
                e.preventDefault();
                const proxied = '/api/web-proxy?url=' + encodeURIComponent(a.href);
                window.location.href = proxied;
              }
            }, true);

            // 5. Intercept form submissions
            document.addEventListener('submit', function(e) {
              const form = e.target;
              if (form && form.action) {
                const actionUrl = new URL(form.action, ${JSON.stringify(targetUrl)}).href;
                form.action = '/api/web-proxy?url=' + encodeURIComponent(actionUrl);
              }
            }, true);
          } catch(err) {}
        })();
      </script>
    `;

    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>${baseTag}${stealthAndBridgeScript}`);
    } else if (html.includes('<html>')) {
      html = html.replace('<html>', `<html><head>${baseTag}${stealthAndBridgeScript}</head>`);
    } else {
      html = `${baseTag}${stealthAndBridgeScript}${html}`;
    }

    return res.status(response.status).send(html);
  } catch (error: any) {
    console.warn(`[WebProxy] Error proxying ${targetUrl}:`, error.message);
    return res.status(502).send(`
      <!DOCTYPE html>
      <html lang="ru">
        <head>
          <meta charset="utf-8">
          <title>Ошибка загрузки страницы</title>
          <style>
            body { background: #0f0f0f; color: #eee; font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
            .box { background: #1a1a1a; border: 1px solid #333; border-radius: 12px; padding: 24px; max-width: 500px; text-align: center; }
            h2 { color: #f87171; margin-bottom: 8px; font-size: 18px; }
            p { color: #aaa; font-size: 13px; line-height: 1.5; margin-bottom: 16px; }
            .url { background: #111; padding: 8px; border-radius: 6px; font-family: monospace; font-size: 12px; color: #38bdf8; word-break: break-all; margin-bottom: 16px; }
            .btn { display: inline-block; background: #2563eb; color: white; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
            .btn:hover { background: #1d4ed8; }
          </style>
        </head>
        <body>
          <div class="box">
            <h2>Не удалось загрузить страницу</h2>
            <p>${error.message || 'Ошибка сети или тайм-аут соединения'}</p>
            <div class="url">${targetUrl}</div>
            <button class="btn" onclick="window.location.reload()">Повторить попытку</button>
          </div>
        </body>
      </html>
    `);
  }
}

