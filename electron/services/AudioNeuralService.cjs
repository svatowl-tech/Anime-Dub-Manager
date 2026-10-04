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
   * Resolves absolute path to audio_ai_processor.py
   */
  getSidecarScriptPath() {
    const candidatePaths = [
      path.join(__dirname, 'audio_ai_processor.py'),
      path.join(__dirname, '..', 'sidecars', 'audio_ai_processor.py'),
      path.join(process.cwd(), 'electron', 'services', 'audio_ai_processor.py'),
      path.join(process.cwd(), 'electron', 'sidecars', 'audio_ai_processor.py'),
    ];

    if (process.resourcesPath) {
      candidatePaths.push(path.join(process.resourcesPath, 'audio_ai_processor.py'));
      candidatePaths.push(path.join(process.resourcesPath, 'electron', 'services', 'audio_ai_processor.py'));
      candidatePaths.push(path.join(process.resourcesPath, 'electron', 'sidecars', 'audio_ai_processor.py'));
    }

    for (const cand of candidatePaths) {
      if (fs.existsSync(cand)) {
        return cand;
      }
    }

    return path.join(__dirname, 'audio_ai_processor.py');
  }

  /**
   * Spawns Python sidecar CLI process directly without cmd.exe / shell: true
   * and handles streaming stdout / stderr / progress.
   */
  async _runPythonSidecar(args, { onProgress, onLog, abortSignal, operationName = 'AudioNeural' }) {
    const pythonPath = EnvironmentManager.getPythonPath();
    const scriptPath = this.getSidecarScriptPath();

    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Скрипт нейросетевого процессора не найден: ${scriptPath}`);
    }

    if (!fs.existsSync(pythonPath)) {
      throw new Error(`Файл интерпретатора Python не найден по пути: ${pythonPath}`);
    }

    const fullArgs = [scriptPath, ...args];
    const displayCmd = `"${pythonPath}" "${scriptPath}" ${args.map(a => `"${a}"`).join(' ')}`;

    if (onLog) {
      onLog(`[Neural AI] Запуск ${operationName}: ${displayCmd}`, 'debug');
    }
    log.info(`[AudioNeuralService] Spawning directly: ${displayCmd}`);

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

      const env = {
        ...process.env,
        PATH: updatedPath,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        TORCH_HOME: path.join(typeof app !== 'undefined' && app.getPath ? app.getPath('userData') : process.cwd(), 'models', 'torch')
      };

      // Launch python executable directly without cmd.exe
      const child = spawn(pythonPath, fullArgs, {
        cwd: path.dirname(scriptPath),
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
            if (onLog) onLog(line, 'debug');
          }
        }
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        stderrBuffer += text;
        if (onLog) onLog(`[PyStderr] ${text.trim()}`, 'debug');
      });

      child.on('error', (err) => {
        if (!isSettled) {
          isSettled = true;
          log.error(`[AudioNeuralService] Child process error: ${err.message}`);
          reject(new Error(`Не удалось запустить Python-окружение (${pythonPath}): ${err.message}`));
        }
      });

      child.on('close', (code) => {
        if (isSettled) return;
        isSettled = true;

        if (code === 0) {
          log.info(`[AudioNeuralService] ${operationName} finished successfully.`);
          resolve(resultData || { success: true });
        } else {
          const tailStderr = (stderrBuffer || stdoutBuffer).slice(-800);
          const errMessage = `Скрипт ${operationName} завершился с кодом ошибки ${code}.\nДетали:\n${tailStderr}`;
          log.error(`[AudioNeuralService] ${errMessage}`);
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
}

module.exports = new AudioNeuralService();
