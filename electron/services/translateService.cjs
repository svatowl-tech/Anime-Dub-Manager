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

  try {
    // Используем бесплатный API Google Translate (через скрипт или прокси)
    const BASE_URL = process.env.TRANSLATE_API_URL || 'https://translate.googleapis.com/translate_a/single';
    
    const response = await axios.get(BASE_URL, {
      params: {
        client: 'gtx',
        sl: sourceLang,
        tl: destLang,
        dt: 't',
        q: text
      }
    });

    // Формат ответа Google Translate: [[["translated_text", "source_text", ...]]]
    if (response.data && response.data[0] && response.data[0][0] && response.data[0][0][0]) {
      // Поддержка ситуации, когда ответ разбит на несколько сегментов текста
      const translatedText = response.data[0].map(segment => segment[0]).join('');
      if (attempt === 1) {
        log.info(`Translation successful: ${text.substring(0, 20)}... -> ${translatedText.substring(0, 20)}...`);
      }
      return {
        "source-text": text,
        "destination-text": translatedText
      };
    }

    log.error('Translation error: Invalid response format', response.data);
    throw new Error('Некорректный формат ответа от сервиса перевода');
  } catch (error) {
    if (error.response && error.response.status === 429 && attempt <= 3) {
      const waitTimeMs = attempt * 2000 + Math.random() * 1000;
      log.warn(`Received 429 Too Many Requests for translation. Retrying in ${Math.round(waitTimeMs)}ms...`);
      await sleep(waitTimeMs);
      return translateText(text, sourceLang, destLang, attempt + 1);
    }
    log.error("Translation API error:", error.message);
    throw error;
  }
}

module.exports = { translateText };
