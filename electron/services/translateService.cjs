const axios = require('axios');
const log = require('electron-log');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Сервис для перевода текста через внешние API (Main Process).
 * Использует стандартные методы перевода.
 */
async function translateText(text, sourceLang, destLang, attempt = 1) {
  if (attempt === 1) {
    log.info(`Translating text from ${sourceLang} to ${destLang}...`);
  } else {
    log.info(`Translating text from ${sourceLang} to ${destLang}... (Attempt: ${attempt})`);
  }

  // First try clients5.google.com endpoint which is fast, lightweight, and works seamlessly
  try {
    const clients5Url = 'https://clients5.google.com/translate_a/t';
    const c5Resp = await axios.get(clients5Url, {
      params: {
        client: 'dict-chrome-ex',
        sl: sourceLang,
        tl: destLang,
        q: text
      },
      timeout: 10000
    });

    if (c5Resp.data) {
      let translatedText = '';
      if (Array.isArray(c5Resp.data)) {
        translatedText = c5Resp.data.map(item => Array.isArray(item) ? item[0] : item).join('');
      } else if (typeof c5Resp.data === 'string') {
        translatedText = c5Resp.data;
      }

      if (translatedText) {
        log.info(`Google Translate (clients5) successful: "${text.substring(0, 30)}" -> "${translatedText.substring(0, 30)}"`);
        return {
          "source-text": text,
          "destination-text": translatedText
        };
      }
    }
  } catch (c5Err) {
    log.warn(`Google Translate clients5 endpoint error: ${c5Err.message}. Trying standard single endpoint...`);
  }

  try {
    // Fallback to standard Google Translate API
    const BASE_URL = process.env.TRANSLATE_API_URL || 'https://translate.googleapis.com/translate_a/single';
    
    const response = await axios.get(BASE_URL, {
      params: {
        client: 'gtx',
        sl: sourceLang,
        tl: destLang,
        dt: 't',
        q: text
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      },
      timeout: 10000
    });

    if (response.data && response.data[0] && response.data[0][0] && response.data[0][0][0]) {
      const translatedText = response.data[0].map(segment => segment[0]).join('');
      log.info(`Google Translate (single) successful: ${text.substring(0, 20)}... -> ${translatedText.substring(0, 20)}...`);
      return {
        "source-text": text,
        "destination-text": translatedText
      };
    }
  } catch (error) {
    if (error.response && error.response.status === 429 && attempt <= 3) {
      const waitTimeMs = attempt * 1500 + Math.random() * 500;
      log.warn(`Received 429 Too Many Requests for translation. Retrying in ${Math.round(waitTimeMs)}ms...`);
      await sleep(waitTimeMs);
      return translateText(text, sourceLang, destLang, attempt + 1);
    }
    log.error("Translation API error:", error.message);
  }

  // Gemini API translation fallback if Google Translate is completely unavailable
  if (process.env.GEMINI_API_KEY) {
    try {
      log.info('[translateService] Trying Gemini API translation fallback...');
      const geminiResp = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          contents: [{
            parts: [{
              text: `Переведи следующий текст с языка "${sourceLang}" на язык "${destLang}".
Верни ТОЛЬКО переведенный текст, без кавычек, комментариев и Markdown.
Текст: ${text}`
            }]
          }]
        },
        { timeout: 15000 }
      );
      const translated = geminiResp.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (translated) {
        log.info(`Gemini fallback translation successful: "${text.substring(0, 30)}" -> "${translated.substring(0, 30)}"`);
        return {
          "source-text": text,
          "destination-text": translated
        };
      }
    } catch (gErr) {
      log.warn('[translateService] Gemini translation fallback failed:', gErr.message);
    }
  }

  throw new Error('Не удалось перевести текст через сервисы перевода');
}

module.exports = { translateText };
