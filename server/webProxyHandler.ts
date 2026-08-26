import { Request, Response } from 'express';
import axios from 'axios';

/**
 * Smart Web Proxy Handler for Web Preview Mode
 * Removes X-Frame-Options, CSP, and injects base tags and communication bridge
 */
export async function handleWebProxy(req: Request, res: Response) {
  const targetUrl = (req.query.url as string) || '';

  if (!targetUrl || (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://'))) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"><title>Неверный URL</title></head>
        <body style="background:#0a0a0a;color:#eee;font-family:sans-serif;padding:24px;text-align:center;">
          <h2>Не указан адрес страницы</h2>
        </body>
      </html>
    `);
  }

  try {
    const urlObj = new URL(targetUrl);
    
    // Perform upstream request with browser-like headers
    const response = await axios({
      method: 'GET',
      url: targetUrl,
      timeout: 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': `${urlObj.origin}/`,
        'Cache-Control': 'no-cache',
      },
      responseType: 'arraybuffer',
      validateStatus: () => true, // Don't throw on 401/403/500 so we can inspect and rewrite
      maxRedirects: 5
    });

    const contentType = String(response.headers['content-type'] || 'text/html');

    // Remove frame-blocking headers
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('Content-Security-Policy-Report-Only');
    res.removeHeader('Cross-Origin-Embedder-Policy');
    res.removeHeader('Cross-Origin-Opener-Policy');
    res.removeHeader('Cross-Origin-Resource-Policy');

    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');

    // If it's not HTML (e.g. image, css, script), pipe raw bytes directly
    if (!contentType.includes('text/html')) {
      return res.status(response.status).send(response.data);
    }

    let html = response.data.toString('utf-8');

    // If site returned bot protection / SSO wall / forbidden (VK / Cloudflare)
    if (response.status === 403 || response.status === 401 || html.includes('cf-challenge') || html.includes('VK ID') || html.includes('Авторизация через VK ID')) {
      return res.status(200).send(renderBypassFallbackHtml(targetUrl, response.status));
    }

    // Inject <base href="..."> into <head> so relative assets load
    const baseTag = `<base href="${targetUrl}">`;
    const bridgeScript = `
      <script>
        (function() {
          try {
            // Send page title to parent app
            window.parent.postMessage({
              type: 'ADM_BROWSER_PAGE_DATA',
              title: document.title,
              url: window.location.href
            }, '*');
          } catch(e) {}
        })();
      </script>
    `;

    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>${baseTag}${bridgeScript}`);
    } else if (html.includes('<html>')) {
      html = html.replace('<html>', `<html><head>${baseTag}${bridgeScript}</head>`);
    } else {
      html = `${baseTag}${bridgeScript}${html}`;
    }

    return res.status(200).send(html);
  } catch (error: any) {
    console.warn(`[WebProxy] Error proxying ${targetUrl}:`, error.message);
    return res.status(200).send(renderBypassFallbackHtml(targetUrl, 500, error.message));
  }
}

/**
 * Friendly dark-themed fallback view for strict SSO / Cloudflare / VK Video
 */
function renderBypassFallbackHtml(targetUrl: string, statusCode: number, errorDetail?: string): string {
  let hostname = targetUrl;
  try {
    hostname = new URL(targetUrl).hostname;
  } catch(e) {}

  return `
    <!DOCTYPE html>
    <html lang="ru">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${hostname} - Защищенная страница</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            background-color: #0a0a0a;
            color: #e5e5e5;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 24px;
          }
          .card {
            background: #171717;
            border: 1px solid #262626;
            border-radius: 16px;
            max-width: 520px;
            width: 100%;
            padding: 28px;
            text-align: center;
            box-shadow: 0 20px 40px rgba(0,0,0,0.6);
          }
          .icon-badge {
            width: 56px;
            height: 56px;
            border-radius: 14px;
            background: rgba(245, 158, 11, 0.1);
            border: 1px solid rgba(245, 158, 11, 0.3);
            color: #fbbf24;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 16px;
            font-size: 26px;
          }
          h1 {
            font-size: 18px;
            font-weight: 700;
            color: #f5f5f5;
            margin-bottom: 8px;
          }
          p {
            font-size: 13px;
            color: #a3a3a3;
            line-height: 1.5;
            margin-bottom: 20px;
          }
          .url-box {
            background: #0d0d0d;
            border: 1px solid #262626;
            border-radius: 8px;
            padding: 8px 12px;
            font-size: 12px;
            color: #38bdf8;
            word-break: break-all;
            margin-bottom: 20px;
            font-family: monospace;
          }
          .btn-primary {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            width: 100%;
            background: #2563eb;
            color: white;
            padding: 12px 18px;
            border-radius: 10px;
            font-size: 14px;
            font-weight: 600;
            text-decoration: none;
            border: none;
            cursor: pointer;
            transition: background 0.15s ease;
            margin-bottom: 10px;
          }
          .btn-primary:hover {
            background: #1d4ed8;
          }
          .btn-secondary {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            width: 100%;
            background: #262626;
            color: #d4d4d4;
            padding: 10px 18px;
            border-radius: 10px;
            font-size: 13px;
            font-weight: 500;
            text-decoration: none;
            border: 1px solid #404040;
            cursor: pointer;
          }
          .btn-secondary:hover {
            background: #333333;
          }
          .hint {
            margin-top: 16px;
            font-size: 11px;
            color: #737373;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon-badge">🛡️</div>
          <h1>Защищенный сервис (${hostname})</h1>
          <p>
            Сервис использует авторизацию VK ID / Cloudflare с запретом встраивания в браузерные фреймы (X-Frame-Options).
          </p>
          <div class="url-box">${targetUrl}</div>

          <button class="btn-primary" onclick="openInteractiveWindow()">
            🚀 Открыть в интерактивном окне (Рядом с генератором)
          </button>
          
          <button class="btn-secondary" onclick="window.open('${targetUrl}', '_blank')">
            ↗️ Открыть в новой вкладке браузера
          </button>

          <p class="hint">
            В десктопной версии Anime Dub Manager (Electron) все сайты открываются напрямую без ограничений.
          </p>
        </div>

        <script>
          function openInteractiveWindow() {
            try {
              // Notify parent React app to switch engine to popup-overlay
              window.parent.postMessage({
                type: 'ADM_SWITCH_ENGINE',
                engine: 'popup-overlay'
              }, '*');
            } catch(e) {}

            // Also open popup directly
            const width = 1040;
            const height = 780;
            const left = window.screenX + (window.outerWidth - width) / 2;
            const top = window.screenY + (window.outerHeight - height) / 2;
            window.open('${targetUrl}', 'adm_popup_target', 'width=' + width + ',height=' + height + ',left=' + left + ',top=' + top + ',resizable=yes,scrollbars=yes');
          }
        </script>
      </body>
    </html>
  `;
}
