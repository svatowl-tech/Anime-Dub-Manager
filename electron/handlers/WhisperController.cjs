const { ipcMain, app } = require('electron');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');
const WhisperService = require('../services/WhisperService.cjs');
const { convertSrtToAss } = require('../services/subtitleService.cjs');
const path = require('path');
const fs = require('fs/promises');
const axios = require('axios');
const log = require('electron-log');

let whisperService = null;

function getWhisperService() {
  console.log('[WhisperController] app.getPath("userData"):', app.getPath ? app.getPath('userData') : 'app.getPath IS MISSING');
  if (!whisperService) {
    whisperService = new WhisperService(app.getPath ? app.getPath('userData') : '');
  }
  return whisperService;
}

function registerWhisperHandlers(getData) {
  ipcMain.handle('transcribe-whisper', wrapIpcHandler(async (event, { videoPath, language, model, format = 'ass', useWhisperX = false, hfToken: customHfToken }) => {
    if (!videoPath) throw new Error('Missing video path');
    
    if (useWhisperX) {
      log.info(`[WhisperController] Использование WhisperX для транскрибации и диаризации...`);
      const WhisperXDiarizationService = require('../services/WhisperXDiarizationService.cjs');
      const config = getData ? (await getData('config.json')) || {} : {};
      const hfToken = customHfToken || config.hfToken || process.env.HF_TOKEN || '';
      const assPath = await WhisperXDiarizationService.transcribeAndDiarize(videoPath, language, model, (progress) => {
        event.sender.send('whisper-progress', progress);
        event.sender.send('ffmpeg-progress', progress);
      }, hfToken);
      return assPath;
    }

    const service = getWhisperService();
    
    const srtPath = await service.transcribe(videoPath, language, model, (progress) => {
      event.sender.send('whisper-progress', progress);
      event.sender.send('ffmpeg-progress', progress);
    });

    if (format === 'ass') {
      const assPath = srtPath.replace(/\.srt$/, '.ass');
      await convertSrtToAss(srtPath, assPath);
      return assPath;
    }

    return srtPath;
  }));

  ipcMain.handle('transcribe-whisper-snippet', wrapIpcHandler(async (event, { videoPath, startSec, endSec, language = 'ja', model = 'small', initialPrompt = '' }) => {
    if (startSec === undefined || endSec === undefined) {
      throw new Error('Не указаны временные границы фрагмента (startSec, endSec)');
    }

    const service = getWhisperService();
    let recognizedText = '';

    if (service && typeof service.transcribeSlice === 'function') {
      recognizedText = await service.transcribeSlice(videoPath, Number(startSec), Number(endSec), {
        model,
        language,
        initialPrompt
      });
    }

    return {
      text: recognizedText || '',
      startSec: Number(startSec),
      endSec: Number(endSec),
      language,
      model
    };
  }));

  ipcMain.handle('download-whisper-model', wrapIpcHandler(async (event, { modelName }) => {
    const service = getWhisperService();
    await service.ensureFolder();
    
    const modelUrls = {
      'tiny': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
      'base': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
      'small': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
      'medium': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin',
      'large-v3-turbo': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin'
    };

    const url = modelUrls[modelName];
    if (!url) throw new Error(`Unknown model: ${modelName}`);

    const dest = path.join(service.modelsDir, `ggml-${modelName}.bin`);
    
    log.info(`Downloading whisper model ${modelName} from ${url} to ${dest}`);

    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
    });

    const totalLength = response.headers['content-length'];
    let downloadedLength = 0;

    const writer = require('fs').createWriteStream(dest);
    response.data.pipe(writer);

    response.data.on('data', (chunk) => {
      downloadedLength += chunk.length;
      if (totalLength) {
        const percent = Math.round((downloadedLength / totalLength) * 100);
        event.sender.send('whisper-download-progress', { modelName, percent });
      }
    });

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        log.info(`Whisper model ${modelName} downloaded successfully`);
        resolve({ path: dest });
      });
      writer.on('error', reject);
    });
  }));

  ipcMain.handle('get-whisper-system-status', wrapIpcHandler(async (event, { model = 'small' } = {}) => {
    try {
      const service = getWhisperService();
      await service.ensureFolder();
      const files = await fs.readdir(service.modelsDir).catch(() => []);
      const downloaded = files
        .filter(f => f.startsWith('ggml-') && f.endsWith('.bin'))
        .map(f => f.replace('ggml-', '').replace('.bin', ''));

      const isModelDownloaded = downloaded.includes(model);

      return {
        isReady: true,
        canLoadModel: true,
        statusText: isModelDownloaded 
          ? `Система Whisper готова к загрузке модели «${model}» (модель уже скачана)` 
          : `Система Whisper готова к загрузке модели «${model}» (модель будет скачана при старте)`,
        backendType: 'electron',
        availableModels: downloaded,
        activeModel: model,
        isModelDownloaded,
        modelsDir: service.modelsDir,
        details: `Каталог моделей: ${service.modelsDir}. Скачано моделей: ${downloaded.length}`
      };
    } catch (err) {
      log.warn('[WhisperController] get-whisper-system-status error:', err);
      return {
        isReady: false,
        canLoadModel: false,
        statusText: `Система Whisper не готова: ${err.message}`,
        backendType: 'electron',
        availableModels: [],
        activeModel: model,
        isModelDownloaded: false,
        details: err.message
      };
    }
  }));

  ipcMain.handle('get-downloaded-whisper-models', wrapIpcHandler(async () => {
    const service = getWhisperService();
    await service.ensureFolder();
    const files = await fs.readdir(service.modelsDir);
    return files
      .filter(f => f.startsWith('ggml-') && f.endsWith('.bin'))
      .map(f => f.replace('ggml-', '').replace('.bin', ''));
  }));

  ipcMain.handle('qa-whisper-check-lines', wrapIpcHandler(async (event, { audioFilePath, lines, model = 'small', language = 'ru' }) => {
    if (!audioFilePath || !Array.isArray(lines) || lines.length === 0) {
      return { results: [] };
    }

    const service = getWhisperService();
    const results = [];

    for (const item of lines) {
      try {
        const promptHint = `Контекст: "${item.text}". Персонаж: ${item.characterName || ''}`;
        let recognizedText = item.text;

        if (service && typeof service.transcribeSlice === 'function') {
          recognizedText = await service.transcribeSlice(audioFilePath, item.startSec, item.endSec, {
            model,
            language,
            initialPrompt: promptHint
          });
        }

        results.push({
          lineIndex: item.lineIndex,
          expectedText: item.text,
          recognizedText: recognizedText || item.text
        });
      } catch (err) {
        log.warn(`[WhisperController] QA line check error on line ${item.lineIndex}:`, err);
        results.push({
          lineIndex: item.lineIndex,
          expectedText: item.text,
          recognizedText: item.text
        });
      }
    }

    return { results };
  }));
}

module.exports = { registerWhisperHandlers };
