const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const log = require('electron-log');
const { app } = require('electron');
const { trackProcess } = require('../lib/ProcessTracker.cjs');
const EnvironmentManager = require('./EnvironmentManager.cjs');

class AudioNeuralService {
  constructor() {
    this._cachedEnvStatus = null;
  }

  /**
   * Resolves absolute path to audio_ai_processor.py.
   * Always extracts/synchronizes the latest bundled version to userData/sidecars
   * and updates any stale sidecars in ai_env so that external python.exe can execute it directly on disk.
   */
  getSidecarScriptPath() {
    const userData = typeof app !== 'undefined' && app.getPath ? app.getPath('userData') : process.cwd();
    const targetScript = path.join(userData, 'sidecars', 'audio_ai_processor.py');
    const aiEnvSidecarScript = path.join(userData, 'ai_env', 'sidecars', 'audio_ai_processor.py');

    // 1. Look for the application's latest bundled sidecar script
    const appBundledCandidates = [
      path.join(__dirname, '..', 'sidecars', 'audio_ai_processor.py'),
      path.join(__dirname, 'audio_ai_processor.py'),
      path.join(process.cwd(), 'electron', 'sidecars', 'audio_ai_processor.py'),
      path.join(process.cwd(), 'electron', 'services', 'audio_ai_processor.py'),
    ];

    if (process.resourcesPath) {
      appBundledCandidates.unshift(path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'sidecars', 'audio_ai_processor.py'));
      appBundledCandidates.unshift(path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'services', 'audio_ai_processor.py'));
      appBundledCandidates.push(path.join(process.resourcesPath, 'electron', 'sidecars', 'audio_ai_processor.py'));
      appBundledCandidates.push(path.join(process.resourcesPath, 'audio_ai_processor.py'));
    }

    let sourceContent = null;
    for (const cand of appBundledCandidates) {
      if (cand && fs.existsSync(cand)) {
        try {
          const content = fs.readFileSync(cand);
          if (content && content.length > 500) {
            sourceContent = content;
            break;
          }
        } catch (e) {}
      }
    }

    // 2. If bundled master source found, sync to disk so Python can run the latest code
    if (sourceContent) {
      try {
        fs.mkdirSync(path.dirname(targetScript), { recursive: true });
        fs.writeFileSync(targetScript, sourceContent);
        log.info(`[AudioNeuralService] Synchronized sidecar script to ${targetScript}`);
      } catch (e) {}

      // Also overwrite the stale copy in ai_env/sidecars if it exists
      try {
        if (fs.existsSync(path.dirname(aiEnvSidecarScript))) {
          fs.writeFileSync(aiEnvSidecarScript, sourceContent);
          log.info(`[AudioNeuralService] Updated ai_env sidecar script at ${aiEnvSidecarScript}`);
        }
      } catch (e) {}

      return targetScript;
    }

    // 3. Fallbacks
    if (fs.existsSync(targetScript)) {
      this._sanitizeSidecarScript(targetScript);
      return targetScript;
    }
    if (fs.existsSync(aiEnvSidecarScript)) {
      this._sanitizeSidecarScript(aiEnvSidecarScript);
      return aiEnvSidecarScript;
    }

    return path.join(__dirname, 'audio_ai_processor.py');
  }

  /**
   * Очищает целевой скрипт на диске от устаревших meta_path хуков (_TorchTestingFinder),
   * которые вызывали AttributeError: 'function' object has no attribute 'endswith' в inspect.py.
   */
  _sanitizeSidecarScript(scriptPath) {
    if (!scriptPath || !fs.existsSync(scriptPath)) return;
    try {
      const code = fs.readFileSync(scriptPath, 'utf8');
      if (code.includes('_TorchTestingFinder') || code.includes('_TestingDynamicShim')) {
        const bundledCandidates = [
          path.join(__dirname, '..', 'sidecars', 'audio_ai_processor.py'),
          path.join(__dirname, 'audio_ai_processor.py'),
          path.join(process.cwd(), 'electron', 'sidecars', 'audio_ai_processor.py'),
          path.join(process.cwd(), 'electron', 'services', 'audio_ai_processor.py')
        ];
        if (process.resourcesPath) {
          bundledCandidates.unshift(path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'sidecars', 'audio_ai_processor.py'));
          bundledCandidates.unshift(path.join(process.resourcesPath, 'electron', 'sidecars', 'audio_ai_processor.py'));
        }
        for (const c of bundledCandidates) {
          if (fs.existsSync(c)) {
            try {
              const fresh = fs.readFileSync(c, 'utf8');
              if (fresh && !fresh.includes('_TorchTestingFinder')) {
                fs.writeFileSync(scriptPath, fresh, 'utf8');
                log.info(`[AudioNeuralService] Скрипт ${scriptPath} обновлен на чистую версию без meta_path хуков.`);
                break;
              }
            } catch (e) {}
          }
        }
      }
    } catch (err) {
      log.warn('[AudioNeuralService] Ошибка при санитации скрипта:', err);
    }
  }

  /**
   * Spawns Python sidecar CLI process directly without cmd.exe / shell: true
   * and handles streaming stdout / stderr / progress.
   */
  async _runPythonSidecar(args, { onProgress, onLog, abortSignal, operationName = 'AudioNeural' }) {
    const pythonPath = EnvironmentManager.getPythonPath();
    const scriptPath = this.getSidecarScriptPath();

    // Превентивное восстановление torch/testing/_internal/common_dtype.py и SciPy/NumPy 2.x совместимости на диске
    try {
      const pyDir = path.dirname(pythonPath);
      EnvironmentManager._ensureTorchTestingIntegrity(pyDir);
      EnvironmentManager._ensureTorchTestingIntegrity(path.dirname(pyDir));
      EnvironmentManager._ensureScipyNumpyIntegrity(pyDir);
      EnvironmentManager._ensureScipyNumpyIntegrity(path.dirname(pyDir));
    } catch (e) {}

    // Гарантированная санитация скрипта процессора
    this._sanitizeSidecarScript(scriptPath);

    const pythonExists = Boolean(pythonPath && fs.existsSync(pythonPath));
    const scriptExists = Boolean(scriptPath && fs.existsSync(scriptPath));

    if (onLog) {
      onLog(`[Neural AI Диагностика] Интерпретатор: ${pythonPath} (найден: ${pythonExists ? 'Да' : 'НЕТ'})`, 'info');
      onLog(`[Neural AI Диагностика] Скрипт процессора: ${scriptPath} (найден: ${scriptExists ? 'Да' : 'НЕТ'})`, 'info');
    }

    if (!pythonExists) {
      const errMsg = `Интерпретатор Python не найден по указанному пути: "${pythonPath}". Проверьте путь или переустановите AI-окружение в настройках.`;
      if (onLog) onLog(`❌ [Neural AI Ошибка] ${errMsg}`, 'error');
      throw new Error(errMsg);
    }

    if (!scriptExists) {
      const errMsg = `Скрипт нейросетевого процессора не найден: "${scriptPath}".`;
      if (onLog) onLog(`❌ [Neural AI Ошибка] ${errMsg}`, 'error');
      throw new Error(errMsg);
    }

    if (!EnvironmentManager._isPythonExecutableWorking(pythonPath)) {
      const errDetail = `Python (${pythonPath}) недоступен или поврежден (код ошибки ENOENT/Crash). ` +
        `Убедитесь, что AI-окружение установлено в настройках или установите Python 3.10+ в систему.`;
      if (onLog) onLog(`❌ [Neural AI Ошибка] ${errDetail}`, 'error');
      throw new Error(errDetail);
    }

    const fullArgs = [scriptPath, ...args];
    const displayCmd = `"${pythonPath}" "${scriptPath}" ${args.map(a => `"${a}"`).join(' ')}`;

    if (onLog) {
      onLog(`[Neural AI] Запуск команды: ${displayCmd}`, 'info');
    }
    log.info(`[AudioNeuralService] Spawning directly (shell: false): ${displayCmd}`);

    return new Promise((resolve, reject) => {
      let isSettled = false;
      let lastProgress = 0;
      let resultData = null;
      let stdoutBuffer = '';
      let stderrBuffer = '';

      // Prepend python dir and pythonBaseDir to PATH so all native DLLs (CUDA/Torch/SoundFile) resolve cleanly
      const pythonDir = path.dirname(pythonPath);
      const pythonBaseDir = path.dirname(pythonDir);
      const extraPaths = [pythonDir, pythonBaseDir];
      if (process.platform === 'win32') {
        extraPaths.push(path.join(pythonBaseDir, 'Library', 'bin'));
      }
      const delimiter = path.delimiter || (process.platform === 'win32' ? ';' : ':');
      const updatedPath = `${extraPaths.join(delimiter)}${delimiter}${process.env.PATH || ''}`;

      // Propagate AI_env site-packages to PYTHONPATH
      const sitePackages = EnvironmentManager.getPythonSitePackagesDirs(pythonPath);
      const existingPythonPath = process.env.PYTHONPATH || '';
      const fullPythonPath = sitePackages.length > 0 
        ? `${sitePackages.join(delimiter)}${delimiter}${existingPythonPath}`
        : existingPythonPath;

      if (onLog && sitePackages.length > 0) {
        onLog(`[Neural AI] Подключены библиотеки нейросети (${sitePackages.length}): ${sitePackages.join('; ')}`, 'info');
      }

      const env = {
        ...process.env,
        SystemRoot: process.env.SystemRoot || (process.platform === 'win32' ? 'C:\\Windows' : undefined),
        ComSpec: process.env.ComSpec || (process.platform === 'win32' ? 'C:\\Windows\\system32\\cmd.exe' : undefined),
        PATH: updatedPath,
        PYTHONPATH: fullPythonPath,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        TORCH_HOME: path.join(typeof app !== 'undefined' && app.getPath ? app.getPath('userData') : process.cwd(), 'models', 'torch')
      };

      // Determine safe working directory: NEVER use a path inside an app.asar
      let workingDir = path.dirname(scriptPath);
      if (workingDir.includes('.asar')) {
        workingDir = typeof app !== 'undefined' && app.getPath ? app.getPath('userData') : process.cwd();
      }

      // Launch python executable directly without cmd.exe / shell: true
      const child = spawn(pythonPath, fullArgs, {
        cwd: workingDir,
        env,
        shell: false,
        windowsHide: true
      });

      // Track process for emergency SIGKILL cancellation
      trackProcess(child, operationName);

      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          if (!isSettled) {
            isSettled = true;
            try {
              child.kill('SIGKILL');
            } catch (e) {}
            reject(new Error(`Операция ${operationName} отменена пользователем.`));
          }
        });
      }

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        stdoutBuffer += text;
        const lines = text.split('\n');

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;

          if (line.startsWith('PROGRESS:')) {
            const numStr = line.replace('PROGRESS:', '').trim();
            const pct = parseFloat(numStr);
            if (!isNaN(pct)) {
              lastProgress = pct;
              if (onProgress) {
                onProgress({ percent: Math.round(pct), message: `${operationName}: ${Math.round(pct)}%` });
              }
            }
          } else if (line.startsWith('LOG:')) {
            const msg = line.replace('LOG:', '').trim();
            if (onLog) onLog(msg, 'info');
          } else if (line.startsWith('DEVICE:')) {
            const dev = line.replace('DEVICE:', '').trim();
            if (onLog) onLog(`Используемое аппаратное ускорение: ${dev}`, 'info');
          } else if (line.startsWith('RESULT:')) {
            try {
              resultData = JSON.parse(line.replace('RESULT:', '').trim());
            } catch (e) {}
          } else if (line.startsWith('ENV_STATUS:')) {
            try {
              resultData = JSON.parse(line.replace('ENV_STATUS:', '').trim());
            } catch (e) {}
          } else {
            if (onLog) onLog(line, 'info');
          }
        }
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        stderrBuffer += text;
        if (onLog) onLog(`[Python STDERR] ${text.trim()}`, 'warn');
      });

      child.on('error', (err) => {
        if (!isSettled) {
          isSettled = true;
          log.error(`[AudioNeuralService] Child process error: ${err.message}`);
          const msg = `Не удалось запустить Python-окружение (${pythonPath}): ${err.message}. Проверьте наличие Python 3.10+ или переустановите AI_env в настройках.`;
          if (onLog) onLog(`❌ [Neural AI Ошибка запуска] ${msg}`, 'error');
          reject(new Error(msg));
        }
      });

      child.on('close', (code) => {
        if (isSettled) return;
        isSettled = true;

        if (code === 0) {
          log.info(`[AudioNeuralService] ${operationName} finished successfully.`);
          resolve(resultData || { success: true });
        } else {
          const tailStderr = (stderrBuffer || stdoutBuffer).slice(-1200);
          const errMessage = `Скрипт ${operationName} завершился с кодом ошибки ${code}.\nДетали:\n${tailStderr}`;
          log.error(`[AudioNeuralService] ${errMessage}`);
          if (onLog) onLog(`❌ [Neural AI Сбой] ${errMessage}`, 'error');
          reject(new Error(errMessage));
        }
      });
    });
  }

  /**
   * Diagnostic environment check for DeepFilterNet & Demucs
   */
  async checkEnvironment() {
    try {
      const res = await this._runPythonSidecar(['--mode', 'check_env'], {
        operationName: 'CheckEnvironment'
      });
      this._cachedEnvStatus = res;
      return res;
    } catch (e) {
      return {
        torch: false,
        deepfilternet: false,
        demucs: false,
        onnxruntime: false,
        error: e.message
      };
    }
  }

  /**
   * Neural AI Speech Denoising (DeepFilterNet 3 ONNX / VR Architecture Denoise)
   */
  async denoiseAudio({ inputPath, outputPath, modelPath = null, modelId = 'deepfilternet3', attenuationLimitDb = -100.0, sensitivity = 1.0, wetDryBlend = 100.0, onProgress, onLog, abortSignal }) {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Входной файл не существует: ${inputPath}`);
    }

    await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });

    const args = [
      '--mode', 'denoise',
      '--input', inputPath,
      '--output', outputPath,
      '--model_id', String(modelId),
      '--attenuation_limit_db', String(attenuationLimitDb),
      '--sensitivity', String(sensitivity),
      '--wet_dry_blend', String(wetDryBlend)
    ];

    if (modelPath && fs.existsSync(modelPath)) {
      args.push('--model_path', modelPath);
    }

    await this._runPythonSidecar(args, {
      onProgress,
      onLog,
      abortSignal,
      operationName: `Neural Denoise [${modelId}]`
    });

    return outputPath;
  }

  /**
   * Neural AI Room & Flutter Echo Dereverberation (DeepFilterNet3 / Reverb HQ FoxJoy ONNX / UVR De-Echo Normal / Aggressive)
   */
  async dereverbAudio({ inputPath, outputPath, modelPath = null, modelId = 'uvr_deecho_normal', reverbReduction = 0.8, sensitivity = 1.0, wetDryBlend = 100.0, onProgress, onLog, abortSignal }) {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Входной файл не существует: ${inputPath}`);
    }

    await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });

    const args = [
      '--mode', 'dereverb',
      '--input', inputPath,
      '--output', outputPath,
      '--model_id', String(modelId),
      '--reverb_reduction', String(reverbReduction),
      '--sensitivity', String(sensitivity),
      '--wet_dry_blend', String(wetDryBlend)
    ];

    if (modelPath && fs.existsSync(modelPath)) {
      args.push('--model_path', modelPath);
    }

    await this._runPythonSidecar(args, {
      onProgress,
      onLog,
      abortSignal,
      operationName: `Neural Dereverb [${modelId}]`
    });

    return outputPath;
  }

  /**
   * Neural AI Stem Separation (Demucs v4, MDX-Net ONNX, RoFormer, Kim, Karaoke)
   */
  async separateStems({ inputPath, outputDir, model = 'htdemucs', modelName, modelPath = null, modelId = 'htdemucs', shifts = 1, overlap = 0.25, stems = 'both', prefix = '', onProgress, onLog, abortSignal }) {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Входной файл не существует: ${inputPath}`);
    }

    await fsPromises.mkdir(outputDir, { recursive: true });

    const selectedModel = modelName || model || 'htdemucs';
    const args = [
      '--mode', 'separate',
      '--input', inputPath,
      '--output_dir', outputDir,
      '--model_name', selectedModel,
      '--model_id', String(modelId),
      '--shifts', String(shifts),
      '--overlap', String(overlap),
      '--stems', stems,
      '--prefix', prefix
    ];

    if (modelPath && fs.existsSync(modelPath)) {
      args.push('--model_path', modelPath);
    }

    const result = await this._runPythonSidecar(args, {
      onProgress,
      onLog,
      abortSignal,
      operationName: `Neural Stem Separation [${selectedModel}]`
    });

    return result;
  }

  /**
   * VoiceFixer Neural Harmonic Restorer (High-frequency harmonic synthesizer & formant presence)
   */
  async voiceFixer({ inputPath, outputPath, modelPath = null, airBandBoostDb = 3.5, harmonicSaturation = 0.45, formantClarity = 0.65, warmTubeEmulation = true, subBassProtect = true, onProgress, onLog, abortSignal }) {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Входной файл не существует: ${inputPath}`);
    }

    await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });

    const args = [
      '--mode', 'voicefixer',
      '--input', inputPath,
      '--output', outputPath,
      '--air_boost', String(airBandBoostDb),
      '--saturation', String(harmonicSaturation),
      '--clarity', String(formantClarity),
      '--warm_tube', String(warmTubeEmulation),
      '--sub_bass', String(subBassProtect)
    ];

    if (modelPath && fs.existsSync(modelPath)) {
      args.push('--model_path', modelPath);
    }

    await this._runPythonSidecar(args, {
      onProgress,
      onLog,
      abortSignal,
      operationName: 'VoiceFixer Harmonic Restorer'
    });

    return outputPath;
  }

  /**
   * Spotify Pedalboard Studio Voice DSP Engine
   * (Voice EQ, Vocal Compressor, De-Esser, Reverb, Limiter, Master Strip)
   */
  async processPedalboardDsp({ inputPath, outputPath, moduleId = 'voice_master_strip', params = {}, onProgress, onLog, abortSignal }) {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Входной файл не существует: ${inputPath}`);
    }

    await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });

    const args = [
      '--mode', 'pedalboard_dsp',
      '--input', inputPath,
      '--output', outputPath,
      '--model_id', moduleId,
      '--params_json', JSON.stringify({ ...params, moduleId })
    ];

    await this._runPythonSidecar(args, {
      onProgress,
      onLog,
      abortSignal,
      operationName: `Pedalboard DSP [${moduleId}]`
    });

    return outputPath;
  }
}

module.exports = new AudioNeuralService();
