const path = require('path');
const fs = require('fs/promises');
const log = require('electron-log');
const { app } = require('electron');
const { initSharedOnnx } = require('../lib/onnxConfig.cjs');

// Lazy loading of @huggingface/transformers with onnxruntime-web redirection
let transformersCache = null;

function getTransformers() {
  if (!transformersCache) {
    log.info('[TranslateService] Loading @huggingface/transformers dynamically...');
    initSharedOnnx();
    transformersCache = require('@huggingface/transformers');
  }
  return transformersCache;
}

class LocalTranslateService {
  static getInstance(baseDir) {
    if (!LocalTranslateService.instance) {
      LocalTranslateService.instance = new LocalTranslateService(baseDir);
    }
    return LocalTranslateService.instance;
  }

  constructor(baseDir) {
    this.baseDir = baseDir;
    this.modelsDir = path.join(baseDir, 'models', 'translation');
    this.bundledModelsDir = process.resourcesPath ? path.join(process.resourcesPath, 'models') : path.join(app.getAppPath(), 'assets', 'models');
    
    log.info('[TranslateService] Constructor initialization');
    log.info(`[TranslateService] baseDir: ${baseDir}`);
    log.info(`[TranslateService] bundledModelsDir: ${this.bundledModelsDir}`);

    this.translator = null;
    this.modelName = 'Xenova/m2m100_418M';
    this.isLoading = false;
    this.downloadProgress = null;
    this.loadingStatus = 'Ожидание...';
  }

  setModelName(name) {
    let sanitized = name;
    // Map outdated model capitalization
    if (sanitized === 'Xenova/m2m100_1.2B') {
      sanitized = 'Xenova/m2m100_1.2b';
    }
    if (name === 'Xenova/nllb-200-distilled-1.3B' || name === 'Xenova/nllb-200-3.3B') {
      sanitized = 'Xenova/nllb-200-distilled-600M';
      log.warn(`Invalid or private local translation model name requested: "${name}". Mapping/falling back to: "${sanitized}"`);
    }
    if (this.modelName !== sanitized) {
      this.modelName = sanitized;
      this.translator = null; // Reset current translator if model changed
    }
  }

  async ensureFolder() {
    try {
      log.info(`Ensuring translation models folder exists: ${this.modelsDir}`);
      await fs.mkdir(this.modelsDir, { recursive: true });
    } catch (err) {
      log.error('Failed to create models folder:', err);
    }
  }

  async loadModel(onProgress) {
    if (this.translator) {
      log.info('Translation model already loaded in memory.');
      this.loadingStatus = 'Готово';
      return this.translator;
    }
    if (this.isLoading) {
      log.info('Model is already loading, waiting for completion...');
      while (this.isLoading) {
        await new Promise(r => setTimeout(r, 100));
      }
      log.info('Model finished loading while waiting.');
      return this.translator;
    }

    const { pipeline, env } = getTransformers();

    // Dynamically apply instance-specific local paths to the global environment
    const fsSync = require('fs');
    let useBundled = false;
    try {
      if (fsSync.existsSync(this.bundledModelsDir)) {
        const contents = fsSync.readdirSync(this.bundledModelsDir);
        log.info(`[TranslateService] Bundled models dir found. Contents: ${contents.join(', ')}`);
        if (contents.length > 0) useBundled = true;
      }
    } catch(e) {
      log.error(`[TranslateService] Error checking bundled models: ${e.message}`);
    }

    if (useBundled) {
      log.info('[TranslateService] Setting paths to BUNDLED models');
      env.localModelPath = this.bundledModelsDir;
      env.cacheDir = this.bundledModelsDir;
    } else {
      log.info('[TranslateService] Setting paths to USER models:', this.modelsDir);
      env.localModelPath = this.modelsDir;
      env.cacheDir = this.modelsDir;
    }

    this.isLoading = true;
    this.downloadProgress = 0;
    this.loadingStatus = 'Инициализация и запуск загрузки...';
    log.info(`Starting to load translation model: ${this.modelName} from ${this.modelsDir}`);
    
    let lastLoggedFile = '';
    let lastLoggedProgress = 0;

    // Track download progress for multiple files
    const downloadStats = new Map();

    // Configuration for offline loading
    const config = {
      progress_callback: (p) => {
        if (p.status === 'initiate') {
          log.info(`[Transformers] Initializing: ${p.file || 'unknown'}`);
          this.loadingStatus = `Запуск скачивания: ${p.file || 'файл'}`;
        } else if (p.status === 'download') {
          log.info(`[Transformers] Downloading: ${p.file || 'unknown'}`);
          this.loadingStatus = `Подключение к источнику: ${p.file || 'файл'}...`;
        } else if (p.status === 'done') {
          log.info(`[Transformers] Done: ${p.file || 'unknown'}`);
          if (p.file) {
            downloadStats.set(p.file, 100);
            let totalFiles = downloadStats.size;
            let sumProgress = 0;
            for (const prog of downloadStats.values()) {
              sumProgress += prog;
            }
            const overallProgress = totalFiles > 0 ? sumProgress / totalFiles : 0;
            this.downloadProgress = Math.round(overallProgress);
            
            if (this.downloadProgress >= 100) {
              this.loadingStatus = 'Все файлы скачаны. Инициализация слоев нейросети... Пожалуйста, подождите.';
            } else {
              this.loadingStatus = `Скачивание: файл ${p.file} успешно сохранен (${this.downloadProgress}%)`;
            }

            if (onProgress) {
              onProgress(this.downloadProgress);
            }
          }
        } else if (p.status === 'progress' && p.file) {
          downloadStats.set(p.file, p.progress || 0);

          // Calculate overall progress across currently downloading files
          let totalFiles = downloadStats.size;
          let sumProgress = 0;
          for (const prog of downloadStats.values()) {
            sumProgress += prog;
          }
          const overallProgress = totalFiles > 0 ? sumProgress / totalFiles : 0;
          this.downloadProgress = Math.round(overallProgress);
          
          this.loadingStatus = `Скачивание файлов модели: ${Math.round(this.downloadProgress)}% [${p.file}: ${Math.round(p.progress)}%]`;
          
          // Log progress every ~10% for the specific file to avoid flooding
          if (p.file !== lastLoggedFile) {
            lastLoggedProgress = 0;
            lastLoggedFile = p.file;
          }
          if (p.progress - lastLoggedProgress >= 10 || p.progress === 100) {
            log.info(`[Transformers] Progress ${p.file}: ${Math.round(p.progress)}%`);
            lastLoggedProgress = p.progress;
          }

          if (onProgress) {
            onProgress(this.downloadProgress);
          }
        }
      }
    };

    const loadWithTimeout = async () => {
      // 1200 second timeout promise (20 minutes to allow slow download on slow internet)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Превышено время ожидания загрузки/компиляции модели (1200 сек). Проверьте интернет-соединение.'));
        }, 1200000);
      });

      // Pipeline loading promise
      const pipelinePromise = (async () => {
        log.info(`[TranslateService] Calling @xenova/transformers pipeline for model: ${this.modelName}`);
        log.info(`[TranslateService] Environment: cacheDir=${env.cacheDir}, localModelPath=${env.localModelPath}, remoteHost=${env.remoteHost}`);
        this.loadingStatus = 'Запуск OnnxRuntime ядра и компиляция слоев нейросети в памяти... Пожалуйста, подождите (это может занять до 1-2 минут)...';
        const modelStartTime = Date.now();
        
        if (env.localModelPath) {
          log.info(`[TranslateService] Checking if model files exist in ${env.localModelPath}/${this.modelName}`);
        }

        const translator = await pipeline('translation', this.modelName, {
          ...config,
          device: 'cpu'
        });
        const modelDuration = Date.now() - modelStartTime;
        log.info(`[TranslateService] Translation model ${this.modelName} loaded successfully in ${modelDuration}ms.`);
        this.downloadProgress = 100;
        this.loadingStatus = 'Готово';
        return translator;
      })();

      return Promise.race([pipelinePromise, timeoutPromise]);
    };

    try {
      this.translator = await loadWithTimeout();
      return this.translator;
    } catch (err) {
      log.error(`[TranslateService] Failed to load translation model ${this.modelName} via primary host (${env.remoteHost}):`, err);
      log.error(`[TranslateService] Stack trace: ${err.stack}`);
      
      const isAllocError = err.message.toLowerCase().includes('allocate') || 
                           err.message.toLowerCase().includes('buffer') || 
                           err.message.toLowerCase().includes('1340271309') || 
                           err.message.toLowerCase().includes('memory') || 
                           err.message.toLowerCase().includes('session');
                           
      if (isAllocError) {
        const memErr = new Error(`Недостаточно оперативной памяти для загрузки модели ${this.modelName}. Ошибка выделения буфера в ONNX. Пожалуйста, переключитесь на более легкую модель M2M-100 (418M) или NLLB-200 (600M).`);
        this.downloadProgress = null;
        this.loadingStatus = 'Ошибка памяти: выберите модель 418M или 600M';
        throw memErr;
      }
      
      if (env.remoteHost === 'https://hf-mirror.com' && !err.message.includes('Превышено время ожидания')) {
        log.info('Retrying loading local model with official Hugging Face repository (https://huggingface.co)...');
        try {
          this.loadingStatus = 'Зеркало недоступно. Переподключение к Hugging Face...';
          env.remoteHost = 'https://huggingface.co';
          
          const retryWithTimeout = async () => {
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => {
                reject(new Error('Превышено время ожидания при повторной попытке загрузки/компиляции модели (1200 сек).'));
              }, 1200000);
            });
            const pipelinePromise = (async () => {
              const modelStartTime = Date.now();
              const translator = await pipeline('translation', this.modelName, {
                ...config,
                device: 'cpu'
              });
              const modelDuration = Date.now() - modelStartTime;
              log.info(`Translation model ${this.modelName} loaded successfully on retry in ${modelDuration}ms.`);
              this.downloadProgress = 100;
              this.loadingStatus = 'Готово';
              return translator;
            })();
            return Promise.race([pipelinePromise, timeoutPromise]);
          };

          this.translator = await retryWithTimeout();
          return this.translator;
        } catch (retryErr) {
          log.error(`Failed to load translation model ${this.modelName} on retry:`, retryErr);
          const isRetryAllocError = retryErr.message.toLowerCase().includes('allocate') || 
                                    retryErr.message.toLowerCase().includes('buffer') || 
                                    retryErr.message.toLowerCase().includes('1340271309') || 
                                    retryErr.message.toLowerCase().includes('memory') || 
                                    retryErr.message.toLowerCase().includes('session');
          if (isRetryAllocError) {
            const memErr = new Error(`Недостаточно оперативной памяти для загрузки модели ${this.modelName}. Ошибка выделения буфера в ONNX. Пожалуйста, переключитесь на более легкую модель M2M-100 (418M) или NLLB-200 (600M).`);
            this.downloadProgress = null;
            this.loadingStatus = 'Ошибка памяти: выберите модель 418M или 600M';
            throw memErr;
          }
          this.downloadProgress = null;
          this.loadingStatus = `Ошибка загрузки: ${retryErr.message}`;
          throw retryErr;
        }
      }
      
      this.downloadProgress = null;
      this.loadingStatus = `Ошибка загрузки: ${err.message}`;
      throw err;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Translate text (supports single string or array of strings)
   * @param {string|string[]} text 
   * @param {string} sourceLang - Lang code (e.g. 'jpn_Jpan')
   * @param {string} targetLang - Lang code (e.g. 'rus_Cyrl')
   */
  async translate(text, sourceLang = 'jpn_Jpan', targetLang = 'rus_Cyrl') {
    const translator = await this.loadModel();
    
    // NLLB uses specific language codes like 'jpn_Jpan', 'rus_Cyrl'
    // We might need a mapper if we receive 'ja', 'ru'
    const langMapper = {
      'ja': 'jpn_Jpan',
      'ru': 'rus_Cyrl',
      'en': 'eng_Latn',
      'zh': 'zho_Hans',
      'ko': 'kor_Kore'
    };

    const src = langMapper[sourceLang] || sourceLang;
    const tgt = langMapper[targetLang] || targetLang;

    const isArray = Array.isArray(text);
    const inputs = isArray ? text : [text];

    log.info(`Local Translation: ${src} -> ${tgt} (${inputs.length} items)`);
    
    // Batch translation into sub-batches of 8 to respect the context window and prevent memory issues
    const batchSize = 8;
    const results = [];

    for (let i = 0; i < inputs.length; i += batchSize) {
      const batch = inputs.slice(i, i + batchSize);
      
      // Clean up each input item (if empty, null or de-serialized undefined, return " " to avoid infinite token generation)
      const modelInputs = batch.map(t => {
        if (t === undefined || t === null || String(t).trim() === "") {
          return " ";
        }
        return String(t);
      });

      try {
        const outputs = await translator(modelInputs, {
          src_lang: src,
          tgt_lang: tgt,
          max_new_tokens: 256, // Prevents looping and excessive model generation
        });

        for (let j = 0; j < outputs.length; j++) {
          let translated = outputs[j]?.translation_text || "";
          translated = translated.trim();
          
          // Revert back if translation is empty and original line has value
          if (!translated && modelInputs[j] && modelInputs[j].trim()) {
            translated = modelInputs[j].trim();
          }
          results.push(translated);
        }
      } catch (err) {
        log.error(`Error translating batch from ${i} to ${i + batchSize}:`, err);
        // Fallback for this entire batch in case of error
        for (const item of modelInputs) {
          results.push(item);
        }
      }
    }

    return isArray ? results : results[0];
  }
}

module.exports = LocalTranslateService;
