const { ipcMain, app } = require('electron');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');
const LocalTranslateService = require('../services/LocalTranslateService.cjs');
const log = require('electron-log');

let localTranslateService = null;

function getLocalTranslateService() {
  return LocalTranslateService.getInstance(app.getPath('userData'));
}

function filterProfanity(text) {
  if (!text) return text;
  const badWords = [
    /\bхуй\b/gi, /\bхуя\b/gi, /\bхули\b/gi, /\bхуё\b/gi,
    /\bпизд\b/gi, /\bбля\b/gi, /\bблядь\b/gi, /\bблять\b/gi,
    /\bсука\b/gi, /\bёб\b/gi, /\bеба\b/gi, /\bебя\b/gi,
    /\bfuck\b/gi, /\bshit\b/gi, /\bass\b/gi, /\bbitch\b/gi
  ];
  let filtered = text;
  for (const regex of badWords) {
    filtered = filtered.replace(regex, (match) => '*'.repeat(match.length));
  }
  return filtered;
}

function registerLocalTranslateHandlers() {
  ipcMain.handle('translate-local', wrapIpcHandler(async (event, { text, sourceLang, destLang, modelName, allowProfanity, genre }) => {
    if (!text || !text.trim()) {
      log.info('Received empty or whitespace-only text for translation, returning empty string instantly.');
      return '';
    }
    log.info(`Request to translate text (Length: ${text.length}): "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
    log.info(`Translation Options: Source=${sourceLang}, Dest=${destLang}, Model=${modelName}, Genre=${genre}, AllowProfanity=${allowProfanity}`);

    const service = getLocalTranslateService();
    if (modelName) {
      log.info(`Setting model name to: ${modelName}`);
      service.setModelName(modelName);
    }

    log.info('Calling LocalTranslateService.translate...');
    const startTime = Date.now();
    let resultText = await service.translate(text, sourceLang, destLang);
    const duration = Date.now() - startTime;
    
    log.info(`Translation completed in ${duration}ms: "${resultText.substring(0, 50)}${resultText.length > 50 ? '...' : ''}"`);
    
    if (allowProfanity === false) {
      const originalResult = resultText;
      resultText = filterProfanity(resultText);
      if (originalResult !== resultText) {
        log.info('Profanity filtered from the translation result.');
      }
    }
    
    return resultText;
  }));

  ipcMain.handle('load-local-translate-model', wrapIpcHandler(async (event, { modelName }) => {
    log.info(`Request received to load local translation model: ${modelName || 'default'}`);
    const service = getLocalTranslateService();
    if (modelName) service.setModelName(modelName);
    await service.ensureFolder();
    
    log.info('Starting loadModel process from controller...');
    try {
      return await service.loadModel((progress) => {
        event.sender.send('local-translate-download-progress', progress);
      });
    } catch (err) {
      log.error(`Failed to load local translate model inside controller: ${err.message}`);
      throw err; // Re-throw so wrapIpcHandler formats it into { success: false, error: err.message }
    }
  }));

  ipcMain.handle('check-local-translate-status', wrapIpcHandler(async () => {
    const service = getLocalTranslateService();
    return {
      isLoaded: !!service.translator,
      isLoading: service.isLoading,
      modelName: service.modelName,
      downloadProgress: service.downloadProgress,
      loadingStatus: service.loadingStatus
    };
  }));
}

module.exports = { registerLocalTranslateHandlers };
