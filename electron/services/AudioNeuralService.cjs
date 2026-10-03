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
    }

    for (const cand of candidatePaths) {
      if (fs.existsSync(cand)) {
        return cand;
      }
    }

    return path.join(__dirname, 'audio_ai_processor.py');
  }

  /**
   * Spawns Python sidecar CLI process and handles streaming stdout / stderr / progress.
   */
  async _runPythonSidecar(args, { onProgress, onLog, abortSignal, operationName = 'AudioNeural' }) {
    const pythonPath = EnvironmentManager.getPythonPath();
    const scriptPath = this.getSidecarScriptPath();

    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Скрипт нейросетевого процессора не найден: ${scriptPath}`);
    }

    const fullArgs = [scriptPath, ...args];
    const displayCmd = `${pythonPath} ${fullArgs.join(' ')}`;

    if (onLog) {
      onLog(`[Neural AI] Запуск ${operationName}: ${displayCmd}`, 'debug');
    }
    log.info(`[AudioNeuralService] Spawning: ${displayCmd}`);

    return new Promise((resolve, reject) => {
      let isSettled = false;
      let lastProgress = 0;
      let resultData = null;
      let stdoutBuffer = '';
      let stderrBuffer = '';

      const child = spawn(pythonPath, fullArgs, {
        cwd: path.dirname(scriptPath),
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8',
          TORCH_HOME: path.join(typeof app !== 'undefined' && app.getPath ? app.getPath('userData') : process.cwd(), 'models', 'torch')
        },
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
        error: e.message
      };
    }
  }

  /**
   * DeepFilterNet3 Denoise
   */
  async denoiseAudio({ inputPath, outputPath, attenuationLimitDb = -100.0, sensitivity = 1.0, wetDryBlend = 100.0, onProgress, onLog, abortSignal }) {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Входной файл не существует: ${inputPath}`);
    }

    await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });

    const args = [
      '--mode', 'denoise',
      '--input', inputPath,
      '--output', outputPath,
      '--attenuation_limit_db', String(attenuationLimitDb),
      '--sensitivity', String(sensitivity),
      '--wet_dry_blend', String(wetDryBlend)
    ];

    await this._runPythonSidecar(args, {
      onProgress,
      onLog,
      abortSignal,
      operationName: 'DeepFilterNet3 Denoise'
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error(`Выходной файл шумоподавления не был создан: ${outputPath}`);
    }

    const st = await fsPromises.stat(outputPath);
    return { outputPath, size: st.size };
  }

  /**
   * DeepFilterNet3 Dereverb
   */
  async dereverbAudio({ inputPath, outputPath, reverbReduction = 0.8, sensitivity = 1.0, wetDryBlend = 100.0, onProgress, onLog, abortSignal }) {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Входной файл не существует: ${inputPath}`);
    }

    await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });

    const args = [
      '--mode', 'dereverb',
      '--input', inputPath,
      '--output', outputPath,
      '--reverb_reduction', String(reverbReduction),
      '--sensitivity', String(sensitivity),
      '--wet_dry_blend', String(wetDryBlend)
    ];

    await this._runPythonSidecar(args, {
      onProgress,
      onLog,
      abortSignal,
      operationName: 'DeepFilterNet3 Dereverb'
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error(`Выходной файл дериверберации не был создан: ${outputPath}`);
    }

    const st = await fsPromises.stat(outputPath);
    return { outputPath, size: st.size };
  }

  /**
   * Demucs v4 Stem Separation
   */
  async separateStems({ inputPath, outputDir, modelName = 'htdemucs', shifts = 1, overlap = 0.25, stems = 'both', prefix = '', onProgress, onLog, abortSignal }) {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Входной файл не существует: ${inputPath}`);
    }

    await fsPromises.mkdir(outputDir, { recursive: true });

    const args = [
      '--mode', 'separate',
      '--input', inputPath,
      '--output_dir', outputDir,
      '--model_name', modelName,
      '--shifts', String(shifts),
      '--overlap', String(overlap),
      '--stems', stems,
      '--prefix', prefix
    ];

    const result = await this._runPythonSidecar(args, {
      onProgress,
      onLog,
      abortSignal,
      operationName: `Demucs v4 (${modelName})`
    });

    const expectedVocals = path.join(outputDir, `${prefix}original_vocals.wav`);
    const expectedInst = path.join(outputDir, `${prefix}original_instrumental_ME.wav`);

    const outputs = [];
    if (fs.existsSync(expectedVocals)) {
      const st = await fsPromises.stat(expectedVocals);
      outputs.push({ type: 'vocals', name: path.basename(expectedVocals), path: expectedVocals, size: st.size });
    }
    if (fs.existsSync(expectedInst)) {
      const st = await fsPromises.stat(expectedInst);
      outputs.push({ type: 'instrumental', name: path.basename(expectedInst), path: expectedInst, size: st.size });
    }

    return outputs;
  }
}

module.exports = new AudioNeuralService();
