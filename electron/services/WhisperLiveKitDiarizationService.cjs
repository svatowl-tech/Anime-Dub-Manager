const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const log = require('electron-log');
const { app } = require('electron');
const { getFfmpegPath } = require('./ffmpegService.cjs');
const { trackProcess } = require('../lib/ProcessTracker.cjs');

function resolveWlkPythonPath() {
  const candidateDirs = [];

  if (process.resourcesPath) {
    candidateDirs.push(path.join(process.resourcesPath, 'whisperlivekit'));
    candidateDirs.push(process.resourcesPath);
  }

  const cwd = process.cwd();
  candidateDirs.push(path.join(cwd, 'whisperlivekit'));
  candidateDirs.push(cwd);

  if (typeof app !== 'undefined' && app.getPath) {
    try {
      const userData = app.getPath('userData');
      candidateDirs.push(path.join(userData, 'whisperlivekit'));
      candidateDirs.push(path.join(userData, 'ai_env', 'whisperlivekit'));
      candidateDirs.push(path.join(userData, 'ai_env'));
    } catch (e) {}
  }

  if (typeof app !== 'undefined' && app.getAppPath) {
    try {
      const appPath = app.getAppPath();
      if (!appPath.includes('.asar')) {
        candidateDirs.push(path.join(appPath, 'whisperlivekit'));
        candidateDirs.push(appPath);
      }
    } catch (e) {}
  }

  const validPaths = [];

  for (const cand of candidateDirs) {
    if (!cand || cand.includes('.asar')) continue;
    try {
      const innerWlk = path.join(cand, 'whisperlivekit');
      if (fsSync.existsSync(innerWlk)) {
        if (fsSync.existsSync(path.join(innerWlk, 'cli.py')) ||
            fsSync.existsSync(path.join(innerWlk, 'basic_server.py')) ||
            fsSync.existsSync(path.join(innerWlk, '__init__.py'))) {
          if (!validPaths.includes(cand)) validPaths.push(cand);
        }
      }
      if (fsSync.existsSync(path.join(cand, 'cli.py')) ||
          fsSync.existsSync(path.join(cand, 'basic_server.py')) ||
          fsSync.existsSync(path.join(cand, '__init__.py'))) {
        const parent = path.dirname(cand);
        if (!validPaths.includes(parent)) validPaths.push(parent);
      }
    } catch (e) {}
  }

  if (process.env.PYTHONPATH) {
    process.env.PYTHONPATH.split(path.delimiter).forEach(p => {
      if (p && !p.includes('.asar') && !validPaths.includes(p)) validPaths.push(p);
    });
  }

  const result = validPaths.join(path.delimiter);
  log.info(`[WhisperLiveKitDiarizationService] Physical PYTHONPATH entries: ${JSON.stringify(validPaths)}`);
  return result;
}

class WhisperLiveKitDiarizationService {
  /**
   * Запускает WhisperLiveKit для диаризации и сопоставляет результаты с существующими субтитрами.
   *
   * @param {string} videoPath Путь к медиафайлу
   * @param {Array<{id: string, start: number, end: number, text: string}>} subtitleLines Массив строк субтитров
   * @param {string} hfToken Токен Hugging Face для доступа к pyannote
   * @param {string} backend Бэкенд диаризации ('sortformer' или 'diart')
   * @param {Function} onProgress Коллбек для передачи прогресса в UI
   * @returns {Promise<{speakerMapping: Record<string, string>, detectedSpeakersCount: number}>}
   */
  async diarize(videoPath, subtitleLines, hfToken, backend = 'sortformer', onProgress) {
    let tempDir = null;

    try {
      log.info(`[WhisperLiveKitDiarizationService] Старт обработки файла: ${videoPath} с бэкендом ${backend}`);

      if (!subtitleLines || subtitleLines.length === 0) {
        throw new Error('Нет субтитров для анализа. Массив subtitleLines пуст.');
      }

      try {
        await fs.access(videoPath);
      } catch {
        throw new Error(`Файл не найден по пути: ${videoPath}`);
      }

      // Проверка наличия локальной среды Python
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

      // Создание временной папки для результатов работы
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wlk-temp-'));
      const resultJsonPath = path.join(tempDir, 'result.json');
      log.info(`[WhisperLiveKitDiarizationService] Создана временная папка: ${tempDir}`);

      onProgress({
        step: 1,
        totalSteps: 3,
        message: 'Запуск WhisperLiveKit...',
        current: 0,
        total: 100
      });

      const wlkPythonPath = resolveWlkPythonPath();

      // Формирование аргументов запуска
      const args = [
        '-m', 'whisperlivekit.cli',
        'transcribe',
        videoPath,
        '--diarization',
        '--diarization-backend', backend,
        '--format', 'verbose_json',
        '--output', resultJsonPath
      ];

      log.info(`[WhisperLiveKitDiarizationService] Исполняемый файл: ${pythonPath}`);
      log.info(`[WhisperLiveKitDiarizationService] PYTHONPATH: ${wlkPythonPath}`);
      log.info(`[WhisperLiveKitDiarizationService] Аргументы: python ${args.join(' ')}`);

      // Детальное логирование входящего запроса
      log.info(`[WhisperLiveKitDiarizationService] Количество входящих реплик для сопоставления: ${subtitleLines.length}`);
      if (subtitleLines.length > 0) {
        log.info(`[WhisperLiveKitDiarizationService] Первая реплика: [${subtitleLines[0].start} - ${subtitleLines[0].end}] "${subtitleLines[0].text}"`);
        log.info(`[WhisperLiveKitDiarizationService] Последняя реплика: [${subtitleLines[subtitleLines.length - 1].start} - ${subtitleLines[subtitleLines.length - 1].end}] "${subtitleLines[subtitleLines.length - 1].text}"`);
      }

      // Запуск дочернего процесса
      await new Promise((resolve, reject) => {
        const env = { 
          ...process.env, 
          PYTHONIOENCODING: 'utf-8',
          PYTHONPATH: wlkPythonPath
        };

        if (hfToken) {
          log.info(`[WhisperLiveKitDiarizationService] Используется переданный Hugging Face токен (маска: ${hfToken.slice(0, 6)}...${hfToken.slice(-4)})`);
          env.HF_TOKEN = hfToken;
        } else if (process.env.HF_TOKEN) {
          env.HF_TOKEN = process.env.HF_TOKEN;
        }

        const ffmpegExec = getFfmpegPath();
        if (ffmpegExec) {
          const ffmpegDir = path.dirname(ffmpegExec);
          log.info(`[WhisperLiveKitDiarizationService] Найден путь к ffmpeg: ${ffmpegExec}. Добавляем в PATH: ${ffmpegDir}`);
          env.PATH = `${ffmpegDir}${path.delimiter}${env.PATH || ''}`;
        } else {
          log.warn(`[WhisperLiveKitDiarizationService] Путь к ffmpeg не определен в ffmpegService, надеемся на системный ffmpeg`);
        }

        log.info(`[WhisperLiveKitDiarizationService] Спавним дочерний процесс Python...`);
        const child = spawn(pythonPath, args, { env });
        trackProcess(child);

        let errorOutput = '';
        let infoOutputCount = 0;

        child.stdout.on('data', (data) => {
          const output = data.toString().trim();
          infoOutputCount++;
          // Ограничим логирование слишком частых сообщений
          if (infoOutputCount < 50 || output.includes('progress') || output.includes('model') || output.includes('diariz')) {
            log.info(`[WhisperLiveKit stdout]: ${output}`);
          } else if (infoOutputCount === 50) {
            log.info(`[WhisperLiveKit stdout]: ...вывод stdout продолжается (скрыто для экономии места в логах)...`);
          }
          
          // Простейший парсинг прогресса (если выводится какая-то информация)
          onProgress({
            step: 2,
            totalSteps: 3,
            message: 'Анализ аудио и разделение спикеров (WhisperLiveKit)...',
            current: 50, // Индикатор промежуточного состояния
            total: 100
          });
        });

        child.stderr.on('data', (data) => {
          const msg = data.toString().trim();
          if (msg) {
             log.warn(`[WhisperLiveKit stderr]: ${msg}`);
             errorOutput += msg + '\n';
          }
        });

        child.on('error', (err) => {
          log.error(`[WhisperLiveKitDiarizationService] Ошибка спавна процесса:`, err);
          reject(new Error(`Не удалось запустить WhisperLiveKit. Ошибка: ${err.message}`));
        });

        child.on('close', (code) => {
          log.info(`[WhisperLiveKitDiarizationService] Дочерний процесс завершился с кодом: ${code}`);
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Процесс WhisperLiveKit завершился с кодом ошибки: ${code}.\nОшибка:\n${errorOutput.slice(-1500)}`));
          }
        });
      });

      onProgress({
        step: 3,
        totalSteps: 3,
        message: 'Сопоставление таймкодов...',
        current: 90,
        total: 100
      });

      // Чтение сгенерированного JSON-отчета
      let rawData;
      log.info(`[WhisperLiveKitDiarizationService] Попытка чтения отчета из: ${resultJsonPath}`);
      try {
        rawData = await fs.readFile(resultJsonPath, 'utf-8');
      } catch (err) {
        log.error(`[WhisperLiveKitDiarizationService] Не удалось прочитать JSON-отчет по пути: ${resultJsonPath}`, err);
        throw new Error('Отчет JSON от WhisperLiveKit не был сгенерирован или не найден.');
      }

      const parsedData = JSON.parse(rawData);
      const segments = parsedData.segments || [];
      log.info(`[WhisperLiveKitDiarizationService] Успешно прочитан JSON-отчет. Найдено сегментов диаризации: ${segments.length}`);
      if (segments.length === 0) {
        log.warn('[WhisperLiveKitDiarizationService] В отчете отсутствуют сегменты распознавания.');
      } else {
        log.info(`[WhisperLiveKitDiarizationService] Первый сегмент из отчета: start=${segments[0].start}, end=${segments[0].end}, speaker=${segments[0].speaker}`);
      }

      // Математика пересечений (Intersection Logic)
      const speakerMapping = {};
      const uniqueSpeakers = new Set();
      const internalSpeakerMap = {};
      let speakerCounter = 1;
      let matchedCount = 0;
      let unmatchedCount = 0;

      const parseTimeToSeconds = (timeStr) => {
        if (typeof timeStr === 'number') return timeStr;
        if (!timeStr) return 0;
        
        // "0:01:23.45" -> секунды
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

      for (const line of subtitleLines) {
        const subStart = parseTimeToSeconds(line.startSec !== undefined ? line.startSec : line.start);
        const subEnd = parseTimeToSeconds(line.endSec !== undefined ? line.endSec : line.end);
        
        let maxOverlap = 0;
        let bestSpeaker = null;

        for (const seg of segments) {
          if (seg.speaker === undefined || seg.speaker === null) continue;

          // Конвертируем время сегментов, если оно строковое
          const segStart = parseTimeToSeconds(seg.start);
          const segEnd = parseTimeToSeconds(seg.end);
          
          const overlapStart = Math.max(subStart, segStart);
          const overlapEnd = Math.min(subEnd, segEnd);
          const overlapDuration = overlapEnd - overlapStart;
          
          if (overlapDuration > 0 && overlapDuration > maxOverlap) {
            maxOverlap = overlapDuration;
            bestSpeaker = String(seg.speaker);
          }
        }

        if (!bestSpeaker) {
          bestSpeaker = "UNKNOWN";
          unmatchedCount++;
        } else {
          matchedCount++;
        }

        // Преобразование индекса спикера в читаемый формат "Speaker X"
        if (!internalSpeakerMap[bestSpeaker]) {
          if (bestSpeaker === "UNKNOWN") {
            internalSpeakerMap[bestSpeaker] = "Speaker 1";
          } else {
            internalSpeakerMap[bestSpeaker] = `Speaker ${speakerCounter++}`;
          }
        }
        
        const finalSpeakerName = internalSpeakerMap[bestSpeaker];
        speakerMapping[line.id] = finalSpeakerName;
        uniqueSpeakers.add(finalSpeakerName);
      }

      log.info(`[WhisperLiveKitDiarizationService] Диаризация успешно завершена. Сопоставлено реплик: ${matchedCount}, не сопоставлено: ${unmatchedCount}. Уникальных спикеров: ${uniqueSpeakers.size}`);

      return {
        speakerMapping,
        detectedSpeakersCount: uniqueSpeakers.size > 0 ? uniqueSpeakers.size : 1
      };

    } catch (error) {
      log.error('[WhisperLiveKitDiarizationService] Ошибка в процессе работы:', error);
      throw error;
    } finally {
      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch (cleanupError) {
          log.error('[WhisperLiveKitDiarizationService] Ошибка удаления временной папки:', cleanupError);
        }
      }
    }
  }
}

module.exports = new WhisperLiveKitDiarizationService();
