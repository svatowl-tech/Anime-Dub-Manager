const Module = require('module');
const path = require('path');
const log = require('electron-log');
const { pathToFileURL } = require('url');

log.info('[ONNX Config] Hooking Module.require to ensure unified onnxruntime instance...');

// 1. Инициализируем и кэшируем единственный экземпляр onnxruntime-web на уровне всего приложения
let globalOrt = null;
try {
  // Заставляем Node загрузить root-level onnxruntime-web
  globalOrt = Module.prototype.require.call(module, 'onnxruntime-web');
  log.info('[ONNX Config] Successfully preloaded root onnxruntime-web');
  
  if (globalOrt && globalOrt.env) {
    if (!globalOrt.env.wasm) {
      globalOrt.env.wasm = {};
    }
    // Сразу настраиваем локальные пути, чтобы предотвратить установку CDN-адресов сторонними библиотеками
    try {
      let localWasmPath;
      try {
        const ortPath = require.resolve('onnxruntime-web');
        localWasmPath = path.dirname(ortPath);
      } catch (resolveErr) {
        log.warn(`[ONNX Config] Could not resolve onnxruntime-web entry point, falling back to static path: ${resolveErr.message}`);
        localWasmPath = path.join(__dirname, '..', '..', 'node_modules', 'onnxruntime-web', 'dist');
      }
      const wasmPathStr = pathToFileURL(localWasmPath).href + '/';
      globalOrt.env.wasm.wasmPaths = wasmPathStr;
      globalOrt.env.wasm.numThreads = 1;
      globalOrt.env.wasm.proxy = false;
      log.info(`[ONNX Config] Configured globalOrt.env.wasm.wasmPaths immediately to local path: ${wasmPathStr}`);
    } catch (e) {
      log.error(`[ONNX Config] Failed to configure early globalOrt wasm settings: ${e.message}`);
    }
  }
} catch (err) {
  log.error('[ONNX Config] Critical: Failed to preload top-level onnxruntime-web!', err);
}

// 2. Безопасный перехватщик вызова registerBackend, предотвращающий падение с ошибкой priority 10
if (globalOrt && typeof globalOrt.registerBackend === 'function') {
  const originalRegisterBackend = globalOrt.registerBackend;
  globalOrt.registerBackend = function (name, backend, priority) {
    try {
      return originalRegisterBackend.call(this, name, backend, priority);
    } catch (e) {
      if (e.message && e.message.includes('cannot register backend')) {
        log.warn(`[ONNX Config] Suppressed duplicate backend registration error for "${name}" (priority ${priority}): ${e.message}`);
        return;
      }
      throw e;
    }
  };
  log.debug('[ONNX Config] Unified onnx runtime registerBackend is active');
}

// 3. Переопределяем require для перенаправления всех запросов onnxruntime-node и onnxruntime-web на наш единственный экземпляр
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'onnxruntime-node' || id === 'onnxruntime-web') {
    if (globalOrt) {
      return globalOrt;
    }
  }
  return originalRequire.apply(this, arguments);
};

let isInitialized = false;

function initSharedOnnx() {
  if (isInitialized) return;
  
  log.info('[ONNX Config] Initializing shared ONNX Runtime environment...');
  
  try {
    // Настраиваем Symbol.for('onnxruntime') глобально
    const SymbolForOnnxruntime = Symbol.for('onnxruntime');
    try {
      if (globalOrt) {
        globalThis[SymbolForOnnxruntime] = globalOrt;
        log.info('[ONNX Config] Registered custom onnxruntime-web global symbol');
      }
    } catch (e) {
      log.error('[ONNX Config] Error setting onnxruntime global: ' + e.message);
    }

    // Собираем все установленные библиотеки Transformers.js (как v2 @xenova, так и v3 @huggingface)
    const envsToConfigure = [];
    
    const savedGlobalOnnxruntime = globalThis[SymbolForOnnxruntime];
    
    // Временно удаляем глобальный символ перед загрузкой, чтобы обойти баг @huggingface/transformers.js с пустым `supportedDevices` при наличии ORT_SYMBOL в globalThis
    try {
      delete globalThis[SymbolForOnnxruntime];
    } catch (e) {
      log.warn('[ONNX Config] Could not delete global symbol temporarily: ' + e.message);
    }
    
    try {
      const hfTransformers = originalRequire.call(module, '@huggingface/transformers');
      if (hfTransformers && hfTransformers.env) {
        envsToConfigure.push({ name: '@huggingface/transformers', env: hfTransformers.env });
      }
    } catch (e) {
      log.info('[ONNX Config] @huggingface/transformers is not loaded yet or unavailable: ' + e.message);
    }

    try {
      const xenovaTransformers = originalRequire.call(module, '@xenova/transformers');
      if (xenovaTransformers && xenovaTransformers.env) {
        envsToConfigure.push({ name: '@xenova/transformers', env: xenovaTransformers.env });
      }
    } catch (e) {
      log.info('[ONNX Config] @xenova/transformers is not loaded yet or unavailable: ' + e.message);
    }

    // Восстанавливаем оригинальный или новый глобальный ONNX объект
    try {
      if (savedGlobalOnnxruntime) {
        globalThis[SymbolForOnnxruntime] = savedGlobalOnnxruntime;
      } else if (globalOrt) {
        globalThis[SymbolForOnnxruntime] = globalOrt;
      }
    } catch (e) {
      log.error('[ONNX Config] Error restoring WebAssembly onnxruntime global: ' + e.message);
    }

    // Настраиваем окружение для каждого найденного пакета Transformers.js
    for (const item of envsToConfigure) {
      const env = item.env;
      log.info(`[ONNX Config] Applying optimized properties to ${item.name} environment...`);
      
      env.allowLocalModels = true;
      env.allowRemoteModels = true;
      env.useBrowserCache = false;
      env.remoteHost = 'https://hf-mirror.com'; // Зеркало для РФ
      
      // Надежно привязываем предопределенный onnxruntime
      if (globalOrt) {
        env.backends.onnx.onnxruntime = globalOrt;
      }
      
      // Настройка производительности и путей WASM инференса
      env.backends.onnx.device = 'cpu';
      env.backends.onnx.wasm.proxy = false;
      env.backends.onnx.wasm.numThreads = 1;
      
      try {
        let localWasmPath;
        try {
          const ortPath = require.resolve('onnxruntime-web');
          localWasmPath = path.dirname(ortPath);
        } catch (resolveErr) {
          log.warn(`[ONNX Config] Could not resolve onnxruntime-web entry point, falling back to static path search: ${resolveErr.message}`);
          localWasmPath = path.join(__dirname, '..', '..', 'node_modules', 'onnxruntime-web', 'dist');
        }
        const wasmPathStr = pathToFileURL(localWasmPath).href + '/';
        env.backends.onnx.wasm.wasmPaths = wasmPathStr;
        log.info(`[ONNX Config] Successfully set wasmPaths for ${item.name} to local path URL: ${wasmPathStr}`);
      } catch(err) {
        log.warn(`[ONNX Config] Could not set wasmPaths for ${item.name}: ${err.message}`);
      }
    }

    isInitialized = true;
    log.info('[ONNX Config] Shared ONNX settings and Transformers envs successfully aligned.');
  } catch (error) {
    log.error('[ONNX Config] Error during environment check/configuration:', error.message);
  }
}

// Автоматически инициализируем при первой загрузке модуля
initSharedOnnx();

module.exports = { initSharedOnnx };
