const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const log = require('electron-log');
const { app } = require('electron');
const { getFfmpegPath } = require('./ffmpegService.cjs');

const { trackProcess } = require('../lib/ProcessTracker.cjs');

class WhisperXDiarizationService {
  /**
   * Запускает WhisperX для диаризации и сопоставляет результаты с существующими субтитрами.
   *
   * @param {string} videoPath Путь к медиафайлу
   * @param {Array<{id: string, start: number, end: number, text: string}>} subtitleLines Массив строк субтитров
   * @param {number} expectedSpeakersCount Ожидаемое количество спикеров (0 = авто)
   * @param {string} hfToken Токен Hugging Face для доступа к pyannote
   * @param {Function} onProgress Коллбек для передачи прогресса в UI
   * @returns {Promise<{speakerMapping: Record<string, string>, detectedSpeakersCount: number}>}
   */
  async diarize(videoPath, subtitleLines, language, model, expectedSpeakersCount, hfToken, onProgress) {
    let tempDir = null;

    try {
      log.info(`[WhisperXDiarizationService] Старт обработки файла: ${videoPath}`);

      // 1. Проверка валидности входных данных
      if (!subtitleLines || subtitleLines.length === 0) {
        throw new Error('Нет субтитров для анализа. Массив subtitleLines пуст.');
      }

      try {
        await fs.access(videoPath);
      } catch {
        throw new Error(`Файл не найден по пути: ${videoPath}`);
      }

      // 2. Проверка наличия локальной среды Python с WhisperX
      const isWin = process.platform === 'win32';
      const winPython = path.join(app.getPath('userData'), 'ai_env', 'python_env', 'python.exe');
      const unixPython = path.join(app.getPath('userData'), 'ai_env', 'python_env', 'bin', 'python');
      const unixPythonAlt = path.join(app.getPath('userData'), 'ai_env', 'python_env', 'python');
      
      let pythonPath = winPython;
      if (!isWin) {
        try {
          await fs.access(unixPython);
          pythonPath = unixPython;
        } catch {
          pythonPath = unixPythonAlt;
        }
      }

      try {
        await fs.access(pythonPath);
      } catch {
        throw new Error('Среда ИИ не установлена. Пожалуйста, скачайте ее в настройках.');
      }

      // 3. Создание временной папки для результатов работы WhisperX
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'whisperx-temp-'));
      log.info(`[WhisperXDiarizationService] Создана временная папка: ${tempDir}`);

      // Отправка начального состояния в IPC
      onProgress({
        step: 1,
        totalSteps: 3,
        message: 'Запуск локальной нейросети WhisperX...',
        current: 0,
        total: 100
      });

      // 4. Формирование аргументов для процесса whisperx через python -m
      const args = [
        '-m', 'whisperx',
        videoPath,
        '--diarize',
        '--output_format', 'json',
        '--compute_type', 'int8',
        '--output_dir', tempDir
      ];

      if (language && language !== 'auto') {
        args.push('--language', language);
      }

      if (model) {
        let wxModel = model;
        if (model === 'large-v3-turbo') {
          wxModel = 'large-v3';
        }
        args.push('--model', wxModel);
      } else {
        // Use a faster model by default for diarization if only timecodes matter
        args.push('--model', 'base');
      }

      // Если пользователь явно указал ожидаемое количество спикеров
      if (typeof expectedSpeakersCount === 'number' && expectedSpeakersCount > 0) {
        args.push('--min_speakers', String(expectedSpeakersCount));
        args.push('--max_speakers', String(expectedSpeakersCount));
      }

      const effectiveToken = hfToken || process.env.HF_TOKEN;
      if (effectiveToken) {
        args.push('--hf_token', effectiveToken);
      }

      log.info(`[WhisperXDiarizationService] Исполняемый файл: ${pythonPath}`);
      log.info(`[WhisperXDiarizationService] Аргументы запуска: python ${args.join(' ')}`);

      // 5. Запуск дочернего процесса WhisperX
      await new Promise((resolve, reject) => {
        const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
        if (effectiveToken) {
          env.HF_TOKEN = effectiveToken;
        }
        const ffmpegExec = getFfmpegPath();
        if (ffmpegExec) {
          const ffmpegDir = path.dirname(ffmpegExec);
          env.PATH = `${ffmpegDir}${path.delimiter}${env.PATH || ''}`;
        }

        const child = spawn(pythonPath, args, { env });
        trackProcess(child);

        // Вспомогательная функция парсинга прогресса (tqdm обычно пишет прогресс вида 45% в stderr)
        const parseProgress = (data) => {
          const output = data.toString();
          const match = output.match(/(\d+)%/);
          if (match && match[1]) {
            const percent = parseInt(match[1], 10);
            onProgress({
              step: 2,
              totalSteps: 3,
              message: 'Анализ аудио и разделение спикеров (WhisperX)...',
              current: percent,
              total: 100
            });
          }
        };

        child.stdout.on('data', (data) => {
          parseProgress(data);
          log.info(`[WhisperX stdout]: ${data.toString().trim()}`);
        });

        let errorOutput = '';

        child.stderr.on('data', (data) => {
          parseProgress(data);
          const msg = data.toString().trim();
          if (msg) {
             log.info(`[WhisperX stderr]: ${msg}`);
             errorOutput += msg + '\n';
          }
        });

        child.on('error', (err) => {
          reject(new Error(`Не удалось запустить портативную среду Python. Ошибка: ${err.message}`));
        });

        child.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            let errorMsg = `Процесс WhisperX завершился с кодом ошибки: ${code}.\nОшибка:\n${errorOutput.slice(-1000)}`;
            if (errorOutput.includes('GatedRepoError') || errorOutput.includes('401 Client Error') || errorOutput.includes('Access to model pyannote/speaker-diarization')) {
              errorMsg = `Ошибка доступа к Hugging Face (Gated Repo).\nПожалуйста, перейдите в Настройки и укажите свой собственный HF Token.\nВам также необходимо принять пользовательское соглашение для модели pyannote/speaker-diarization-3.1 на сайте Hugging Face.\n\nДетали:\n${errorOutput.slice(-500)}`;
            }
            reject(new Error(errorMsg));
          }
        });
      });

      onProgress({
        step: 3,
        totalSteps: 3,
        message: 'Сопоставление таймкодов...',
        current: 100,
        total: 100
      });

      // 6. Поиск сгенерированного JSON-отчета
      const files = await fs.readdir(tempDir);
      const jsonFile = files.find(f => f.endsWith('.json'));

      if (!jsonFile) {
        throw new Error('Отчет JSON не найден. Возможно, WhisperX не сгенерировал результаты.');
      }

      const jsonPath = path.join(tempDir, jsonFile);
      const rawData = await fs.readFile(jsonPath, 'utf-8');
      const parsedData = JSON.parse(rawData);
      
      const segments = parsedData.segments || [];
      if (segments.length === 0) {
        log.warn('[WhisperXDiarizationService] В отчете WhisperX отсутствуют сегменты распознавания.');
      }

      // 7. Математика пересечений с учетом текстового сходства (Intersection + Text Matching Logic)
      const speakerMapping = {};
      const uniqueSpeakers = new Set();
      
      // Словарь для перевода внутренних ID WhisperX ("SPEAKER_00") в формат UI ("Speaker 1")
      const internalSpeakerMap = {};
      let speakerCounter = 1;

      const parseTimeToSeconds = (timeStr) => {
        if (typeof timeStr === 'number') return timeStr;
        if (!timeStr) return 0;
        const parts = timeStr.toString().split(':');
        if (parts.length < 3) {
          const floatVal = parseFloat(timeStr);
          return isNaN(floatVal) ? 0 : floatVal;
        }
        const hrs = parseFloat(parts[0]);
        const mins = parseFloat(parts[1]);
        const secs = parseFloat(parts[2].replace(',', '.'));
        return hrs * 3600 + mins * 60 + secs;
      };

      const cleanTextForMatching = (text) => {
        if (!text) return '';
        return text.replace(/\{[^}]+\}/g, '')
                   .replace(/\\N/gi, ' ')
                   .replace(/[^\w\s\u0400-\u04FF]/gi, '')
                   .toLowerCase()
                   .trim();
      };

      const computeWordSimilarity = (str1, str2) => {
        if (!str1 || !str2) return 0;
        const words1 = str1.split(/\s+/).filter(w => w.length > 1);
        const words2 = str2.split(/\s+/).filter(w => w.length > 1);
        if (words1.length === 0 || words2.length === 0) return 0;

        let matches = 0;
        for (const w1 of words1) {
          if (words2.some(w2 => w2.includes(w1) || w1.includes(w2))) {
            matches++;
          }
        }
        return matches / Math.max(words1.length, words2.length);
      };

      for (const line of subtitleLines) {
        const subStart = parseTimeToSeconds(line.startSec !== undefined ? line.startSec : line.start);
        const subEnd = parseTimeToSeconds(line.endSec !== undefined ? line.endSec : line.end);
        const cleanSubText = cleanTextForMatching(line.text);
        
        let maxScore = -1;
        let bestSpeaker = null;

        // Перебираем сегменты WhisperX для поиска наибольшего соответствия по времени и тексту
        for (const seg of segments) {
          if (!seg.speaker) continue;

          const segStart = Number(seg.start || 0);
          const segEnd = Number(seg.end || 0);
          
          const overlapStart = Math.max(subStart, segStart);
          const overlapEnd = Math.min(subEnd, segEnd);
          const overlapDuration = overlapEnd - overlapStart;
          
          if (overlapDuration > 0) {
            const cleanSegText = cleanTextForMatching(seg.text);
            const textSim = computeWordSimilarity(cleanSubText, cleanSegText);

            // Комбинированная оценка: временное перекрытие + бонус за текстовое совпадение
            // Это разрешает конфликты при одновременных репликах нескольких персонажей
            const score = overlapDuration * (1 + textSim * 4);

            if (score > maxScore) {
              maxScore = score;
              bestSpeaker = seg.speaker;
            }
          }
        }

        // Fallback: Если пересечений не найдено (например, короткий вздох или тишина), 
        // назначаем "UNKNOWN" спикера, чтобы не ломать структуру данных
        if (!bestSpeaker) {
            bestSpeaker = "UNKNOWN";
            log.warn(`[WhisperXDiarizationService] Не найден спикер для реплики #${line.id} (${subStart} - ${subEnd}). Fallback активирован.`);
        }

        // Преобразование "SPEAKER_00" -> "Speaker 1"
        if (!internalSpeakerMap[bestSpeaker]) {
          if (bestSpeaker === "UNKNOWN") {
            // Для ненайденных спикеров логично прокинуть fallback на основного (первого) спикера
            // Но мы зафиксируем это как "Speaker 1" чтобы UI мог корректно это отобразить
            internalSpeakerMap[bestSpeaker] = "Speaker 1";
          } else {
            internalSpeakerMap[bestSpeaker] = `Speaker ${speakerCounter++}`;
          }
        }
        
        const finalSpeakerName = internalSpeakerMap[bestSpeaker];
        speakerMapping[line.id] = finalSpeakerName;
        uniqueSpeakers.add(finalSpeakerName);
      }

      log.info(`[WhisperXDiarizationService] Диаризация завершена. Найдено уникальных спикеров: ${uniqueSpeakers.size}`);

      return {
        speakerMapping,
        detectedSpeakersCount: uniqueSpeakers.size > 0 ? uniqueSpeakers.size : 1
      };

    } catch (error) {
      log.error('[WhisperXDiarizationService] Ошибка в процессе работы:', error);
      throw error;
    } finally {
      // 8. Гарантированное удаление временных файлов (JSON, wav и т.д.)
      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
          log.info(`[WhisperXDiarizationService] Временная папка успешно удалена: ${tempDir}`);
        } catch (cleanupError) {
          log.error(`[WhisperXDiarizationService] Не удалось удалить временную папку ${tempDir}:`, cleanupError);
        }
      }
    }
  }

  /**
   * Запускает WhisperX для транскрибации и диаризации с нуля.
   *
   * @param {string} videoPath Путь к медиафайлу
   * @param {string} language Код языка (например, 'ru', 'ja', 'en' или 'auto')
   * @param {string} model Имя модели (например, 'tiny', 'base', 'small', 'medium', 'large-v3-turbo')
   * @param {Function} onProgress Коллбек для передачи прогресса в UI
   * @param {string} [hfToken] Токен Hugging Face для pyannote
   * @returns {Promise<string>} Путь к сгенерированному файлу .ass с репликами и персонажами (Name)
   */
  async transcribeAndDiarize(videoPath, language, model, onProgress, hfToken) {
    let tempDir = null;
    const tokenToUse = hfToken || process.env.HF_TOKEN || '';

    try {
      log.info(`[WhisperXDiarizationService] Старт распознавания и диаризации с нуля: ${videoPath}`);

      try {
        await fs.access(videoPath);
      } catch {
        throw new Error(`Файл не найден по пути: ${videoPath}`);
      }

      // 1. Проверка наличия локальной среды Python с WhisperX
      const isWin = process.platform === 'win32';
      const winPython = path.join(app.getPath('userData'), 'ai_env', 'python_env', 'python.exe');
      const unixPython = path.join(app.getPath('userData'), 'ai_env', 'python_env', 'bin', 'python');
      const unixPythonAlt = path.join(app.getPath('userData'), 'ai_env', 'python_env', 'python');
      
      let pythonPath = winPython;
      if (!isWin) {
        try {
          await fs.access(unixPython);
          pythonPath = unixPython;
        } catch {
          pythonPath = unixPythonAlt;
        }
      }

      try {
        await fs.access(pythonPath);
      } catch {
        throw new Error('Среда ИИ не установлена. Пожалуйста, скачайте ее в настройках.');
      }

      // 2. Создание временной папки для результатов работы WhisperX
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'whisperx-temp-'));
      log.info(`[WhisperXDiarizationService] Создана временная папка: ${tempDir}`);

      // Отправка начального состояния в UI
      if (onProgress) {
        onProgress(5);
      }

      // 3. Формирование аргументов для процесса whisperx через python -m
      const args = [
        '-m', 'whisperx',
        videoPath,
        '--diarize',
        '--output_format', 'json',
        '--compute_type', 'int8',
        '--output_dir', tempDir
      ];

      if (language && language !== 'auto') {
        args.push('--language', language);
      }

      if (model) {
        let wxModel = model;
        if (model === 'large-v3-turbo') {
          wxModel = 'large-v3';
        }
        args.push('--model', wxModel);
      }

      // Hugging Face token for pyannote speaker diarization
      if (tokenToUse) {
        args.push('--hf_token', tokenToUse);
      }

      log.info(`[WhisperXDiarizationService] Исполняемый файл: ${pythonPath}`);
      log.info(`[WhisperXDiarizationService] Аргументы запуска: python ${args.join(' ')}`);

      // 4. Запуск дочернего процесса WhisperX
      await new Promise((resolve, reject) => {
        const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
        env.HF_TOKEN = tokenToUse;
        const ffmpegExec = getFfmpegPath();
        if (ffmpegExec) {
          const ffmpegDir = path.dirname(ffmpegExec);
          env.PATH = `${ffmpegDir}${path.delimiter}${env.PATH || ''}`;
        }

        const child = spawn(pythonPath, args, { env });
        trackProcess(child);

        const parseProgress = (data) => {
          const output = data.toString();
          const match = output.match(/(\d+)%/);
          if (match && match[1]) {
            const percent = parseInt(match[1], 10);
            if (onProgress) {
              const totalPercent = Math.round(10 + (percent * 0.8));
              onProgress(totalPercent);
            }
          }
        };

        child.stdout.on('data', (data) => {
          parseProgress(data);
          log.info(`[WhisperX stdout]: ${data.toString().trim()}`);
        });

        let errorOutput = '';
        child.stderr.on('data', (data) => {
          parseProgress(data);
          const msg = data.toString().trim();
          if (msg) {
             log.info(`[WhisperX stderr]: ${msg}`);
             errorOutput += msg + '\n';
          }
        });

        child.on('error', (err) => {
          reject(new Error(`Не удалось запустить портативную среду Python. Ошибка: ${err.message}`));
        });

        child.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            let errorMsg = `Процесс WhisperX завершился с кодом ошибки: ${code}.\nОшибка:\n${errorOutput.slice(-1000)}`;
            if (errorOutput.includes('GatedRepoError') || errorOutput.includes('401 Client Error') || errorOutput.includes('Access to model pyannote/speaker-diarization')) {
              errorMsg = `Ошибка доступа к Hugging Face (Gated Repo).\nПожалуйста, перейдите в Настройки и укажите свой собственный HF Token.\nВам также необходимо принять пользовательское соглашение для модели pyannote/speaker-diarization-3.1 на сайте Hugging Face.\n\nДетали:\n${errorOutput.slice(-500)}`;
            }
            reject(new Error(errorMsg));
          }
        });
      });

      if (onProgress) {
        onProgress(95);
      }

      // 5. Поиск сгенерированного JSON-отчета
      const files = await fs.readdir(tempDir);
      const jsonFile = files.find(f => f.endsWith('.json'));

      if (!jsonFile) {
        throw new Error('Отчет JSON не найден. Возможно, WhisperX не сгенерировал результаты.');
      }

      const jsonPath = path.join(tempDir, jsonFile);
      const rawData = await fs.readFile(jsonPath, 'utf-8');
      const parsedData = JSON.parse(rawData);
      
      const segments = parsedData.segments || [];
      if (segments.length === 0) {
        log.warn('[WhisperXDiarizationService] В отчете WhisperX отсутствуют сегменты распознавания.');
      }

      // 6. Форматирование сегментов в ASS
      const internalSpeakerMap = {};
      let speakerCounter = 1;

      const formatTimeToAss = (secs) => {
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = Math.floor(secs % 60);
        const cs = Math.floor((secs % 1) * 100);
        const hStr = h.toString();
        const mStr = m.toString().padStart(2, '0');
        const sStr = s.toString().padStart(2, '0');
        const csStr = cs.toString().padStart(2, '0');
        return `${hStr}:${mStr}:${sStr}.${csStr}`;
      };

      const assLines = [];
      assLines.push('[Script Info]');
      assLines.push('Title: WhisperX Generated Subtitles');
      assLines.push('ScriptType: v4.00+');
      assLines.push('PlayResX: 640');
      assLines.push('PlayResY: 360');
      assLines.push('');
      assLines.push('[V4+ Styles]');
      assLines.push('Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding');
      assLines.push('Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1');
      assLines.push('');
      assLines.push('[Events]');
      assLines.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');

      segments.forEach((seg) => {
        const startSec = Number(seg.start || 0);
        const endSec = Number(seg.end || (startSec + 2));
        const rawSpeaker = seg.speaker || 'UNKNOWN';
        
        if (!internalSpeakerMap[rawSpeaker]) {
          if (rawSpeaker === 'UNKNOWN') {
            internalSpeakerMap[rawSpeaker] = 'Speaker 1';
          } else {
            internalSpeakerMap[rawSpeaker] = `Speaker ${speakerCounter++}`;
          }
        }
        const speakerName = internalSpeakerMap[rawSpeaker];
        const text = (seg.text || '').trim().replace(/\n/g, '\\N');
        
        const startAss = formatTimeToAss(startSec);
        const endAss = formatTimeToAss(endSec);

        assLines.push(`Dialogue: 0,${startAss},${endAss},Default,${speakerName},0,0,0,,${text}`);
      });

      const finalAssPath = path.join(path.dirname(videoPath), `${path.basename(videoPath, path.extname(videoPath))}_whisperx.ass`);
      await fs.writeFile(finalAssPath, assLines.join('\n'), 'utf-8');
      
      log.info(`[WhisperXDiarizationService] Распознавание WhisperX успешно завершено и сохранено в ${finalAssPath}`);
      
      if (onProgress) {
        onProgress(100);
      }

      return finalAssPath;

    } catch (error) {
      log.error('[WhisperXDiarizationService] Ошибка в процессе распознавания WhisperX:', error);
      throw error;
    } finally {
      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
          log.info(`[WhisperXDiarizationService] Временная папка успешно удалена: ${tempDir}`);
        } catch (cleanupError) {
          log.error(`[WhisperXDiarizationService] Не удалось удалить временную папку ${tempDir}:`, cleanupError);
        }
      }
    }
  }
}

module.exports = new WhisperXDiarizationService();
