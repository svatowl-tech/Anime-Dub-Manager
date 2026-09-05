const ffmpeg = require('fluent-ffmpeg');
const { app } = require('electron');
let ffmpegPath = require('ffmpeg-static');
const fs = require('fs');
const path = require('path');
const log = require('electron-log');
const { trackProcess, killPidTree } = require('../lib/ProcessTracker.cjs');

// Пытаемся найти встроенный FFmpeg (который мы скачиваем в assets/bin при сборке)
const isDev = !app.isPackaged;
const ffmpegName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const ffprobeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';

const resourcesPath = process.resourcesPath || '';

const bundledFfmpegPath = isDev 
  ? path.join(__dirname, '..', '..', 'assets', 'bin', ffmpegName)
  : (resourcesPath ? path.join(resourcesPath, 'bin', ffmpegName) : '');

const bundledFfprobePath = isDev
  ? path.join(__dirname, '..', '..', 'assets', 'bin', ffprobeName)
  : (resourcesPath ? path.join(resourcesPath, 'bin', ffprobeName) : '');

if (fs.existsSync(bundledFfmpegPath)) {
  log.info(`Using BUNDLED FFmpeg at: ${bundledFfmpegPath}`);
  ffmpegPath = bundledFfmpegPath;
  
  if (fs.existsSync(bundledFfprobePath)) {
    log.info(`Using BUNDLED FFprobe at: ${bundledFfprobePath}`);
    ffmpeg.setFfprobePath(bundledFfprobePath);
  }
} else if (ffmpegPath) {
  // Настройка пути к FFmpeg для работы в составе Electron (ffmpeg-static)
  // Если путь находится внутри app.asar, заменяем его на app.asar.unpacked
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
}

let activeProcesses = [];
let processIdCounter = 0;

function addProcess(commandLine, commandInstance = null) {
  const id = ++processIdCounter;
  activeProcesses.push({ id, commandLine, command: commandInstance });
  if (commandInstance && commandInstance.ffmpegProc) {
    trackProcess(commandInstance.ffmpegProc);
  }
  return id;
}

function removeProcess(id) {
  activeProcesses = activeProcesses.filter(p => p.id !== id);
}

function getActiveProcesses() {
  return activeProcesses;
}

function killAllProcesses() {
  log.info(`Killing all ${activeProcesses.length} active FFmpeg processes...`);
  for (const procItem of activeProcesses) {
    if (procItem.command) {
      if (procItem.command.ffmpegProc && procItem.command.ffmpegProc.pid) {
        try {
          killPidTree(procItem.command.ffmpegProc.pid);
        } catch (e) {}
      }
      if (typeof procItem.command.kill === 'function') {
        try {
          procItem.command.kill('SIGKILL');
        } catch (err) {}
      }
    }
  }
  activeProcesses = [];
}

if (ffmpegPath) {
  if (fs.existsSync(ffmpegPath)) {
    log.info('FFmpeg found at:', ffmpegPath);
    ffmpeg.setFfmpegPath(ffmpegPath);
  } else {
    log.error('FFmpeg NOT found at:', ffmpegPath, '- attempting to use system ffmpeg');
    // Fallback to system ffmpeg if static binary is missing
    try {
      const { execSync } = require('child_process');
      const isWin = process.platform === 'win32';
      const cmd = isWin ? 'where ffmpeg' : 'which ffmpeg';
      const systemFfmpeg = execSync(cmd).toString().trim().split('\n')[0].trim();
      if (systemFfmpeg && fs.existsSync(systemFfmpeg)) {
        log.info('Using system FFmpeg at:', systemFfmpeg);
        ffmpeg.setFfmpegPath(systemFfmpeg);
        ffmpegPath = systemFfmpeg;
      }
    } catch (e) {
      log.error('System FFmpeg not found in path');
    }
  }
}

/**
 * Функция для хардсаба субтитров в видеофайл (Main Process).
 * Использует fluent-ffmpeg для наложения .ass файла на видео.
 * 
 * @param videoPath Путь к исходному видеофайлу (например, .mp4)
 * @param finalAssPath Путь к финальному файлу субтитров (.ass)
 * @param outputPath Путь для сохранения готового видео
 * @param onProgress Коллбэк для отправки прогресса (в процентах) на фронтенд
 * @returns Promise с путем к готовому файлу
 */
function bakeSubtitles(videoPath, finalAssPath, outputPath, onProgress, onCommand, options = {}) {
  return new Promise(async (resolve, reject) => {
    log.info(`[bakeSubtitles] Invoked with options: ${JSON.stringify(options)}`);
    log.info(`[bakeSubtitles] Video: ${videoPath}, Subs: ${finalAssPath}, Output: ${outputPath}`);
    
    // Normalize paths for Windows
    const vPath = path.resolve(videoPath);
    const aPath = path.resolve(finalAssPath);
    const oPath = path.resolve(outputPath);

    let currentCommandLine = '';
    let processId = null;
    let command = ffmpeg(vPath).outputOptions('-y');
    
    if (onCommand) onCommand(command);
    // Apply hardware acceleration if requested
    if (options.useNvenc) {
      command = command
        .inputOptions('-hwaccel cuda')
        .videoCodec('h264_nvenc')
        .outputOptions(`-gpu ${options.gpuIndex || 0}`)
        .outputOptions('-preset slow')
        .outputOptions(`-cq ${options.crf || 23}`);
    } else {
      command = command
        .videoCodec('libx264')
        .outputOptions(`-crf ${options.crf || 23}`)
        .outputOptions('-preset medium');
    }

    // FFmpeg 'ass' filter path escaping on Windows:
    // 1. Use forward slashes
    // 2. Escape colon with a single backslash (C\:...)
    // 3. Wrap in single quotes
    const escapedAssPath = aPath
      .replace(/\\/g, '/')
      .replace(/:/g, '\\:')
      .replace(/'/g, "'\\''");

    const filters = [];
    if (options.additionalProcessing) {
      let origW = 1920;
      let origH = 1080;
      try {
        const meta = await getVideoMetadata(vPath);
        const videoStream = meta && meta.streams ? meta.streams.find(s => s.codec_type === 'video') : null;
        if (videoStream && videoStream.width && videoStream.height) {
          origW = videoStream.width;
          origH = videoStream.height;
        }
      } catch (e) {
        log.error('Error fetching video dimensions for bakeSubtitles:', e);
      }
      
      const scaledW = Math.round((origW * 1.02) / 2) * 2;
      const scaledH = Math.round((origH * 1.02) / 2) * 2;
      filters.push('hflip');
      filters.push(`scale=${scaledW}:${scaledH}`);
      filters.push(`crop=${origW}:${origH}`);
    }
    filters.push(`ass=filename='${escapedAssPath}'`);

    command
      .videoFilters(filters)
      .output(oPath)
      .format('mp4')
      .outputOptions('-pix_fmt yuv420p')
      .outputOptions('-strict -2') // For compatibility with some AAC encoders
      .on('start', (commandLine) => {
        log.info('FFmpeg started with command: ' + commandLine);
        currentCommandLine = commandLine;
        processId = addProcess(commandLine, command);
        onProgress(0);
      })
      .on('progress', (progress) => {
        if (progress.percent !== undefined) {
          onProgress(Math.round(progress.percent));
        }
      })
      .on('end', () => {
        log.info('FFmpeg processing finished successfully');
        if (processId) removeProcess(processId);
        onProgress(100);
        resolve(oPath);
      })
      .on('error', (err, stdout, stderr) => {
        log.error('FFmpeg processing error: ', err);
        log.error('FFmpeg stderr: ', stderr);
        if (processId) removeProcess(processId);
        
        const errStr = (err?.message || '') + ' ' + (stderr || '');
        const isNvencError = options.useNvenc && (
          errStr.toLowerCase().includes('nvenc') || 
          errStr.toLowerCase().includes('cuda') || 
          errStr.toLowerCase().includes('nvidia') || 
          errStr.toLowerCase().includes('driver') ||
          errStr.toLowerCase().includes('api version') ||
          errStr.toLowerCase().includes('encoder') ||
          errStr.toLowerCase().includes('function not implemented')
        );

        if (isNvencError) {
          log.warn('[FFmpeg] GPU NVENC error detected. Automatically retrying with safe CPU (libx264) transcoding...');
          const fallbackOptions = { ...options, useNvenc: false };
          bakeSubtitles(videoPath, finalAssPath, outputPath, onProgress, onCommand, fallbackOptions)
            .then(resolve)
            .catch(reject);
        } else {
          reject(new Error(`FFmpeg Error: ${err.message}\n\nCommand: ${currentCommandLine}\n\nStderr: ${stderr}`));
        }
      })
      .run();
  });
}

/**
 * Функция для перекодирования видео в MP4 (Main Process).
 * 
 * @param videoPath Путь к исходному видеофайлу
 * @param outputPath Путь для сохранения готового видео
 * @param onProgress Коллбэк для отправки прогресса
 * @param options Опции (например, использование NVENC)
 * @returns Promise с путем к готовому файлу
 */
function transcodeToMp4(videoPath, outputPath, onProgress, onCommand, options = {}) {
  return new Promise(async (resolve, reject) => {
    log.info(`[transcodeToMp4] Invoked with options: ${JSON.stringify(options)}`);
    log.info(`[transcodeToMp4] Input: ${videoPath}`);
    log.info(`[transcodeToMp4] Output: ${outputPath}`);
    
    const vPath = path.resolve(videoPath);
    const oPath = path.resolve(outputPath);

    let currentCommandLine = '';
    let processId = null;
    let command = ffmpeg(vPath).outputOptions('-y');

    if (onCommand) onCommand(command);
    if (options.useNvenc) {
      command = command
        .inputOptions('-hwaccel cuda')
        .videoCodec('h264_nvenc')
        .outputOptions(`-gpu ${options.gpuIndex || 0}`)
        .outputOptions('-preset slow')
        .outputOptions(`-cq ${options.crf || 23}`);
    } else {
      command = command
        .videoCodec('libx264')
        .outputOptions(`-crf ${options.crf || 23}`)
        .outputOptions('-preset medium');
    }

    if (options.additionalProcessing) {
      let origW = 1920;
      let origH = 1080;
      try {
        const meta = await getVideoMetadata(vPath);
        const videoStream = meta && meta.streams ? meta.streams.find(s => s.codec_type === 'video') : null;
        if (videoStream && videoStream.width && videoStream.height) {
          origW = videoStream.width;
          origH = videoStream.height;
        }
      } catch (e) {
        log.error('Error fetching video dimensions for transcodeToMp4:', e);
      }
      
      const scaledW = Math.round((origW * 1.02) / 2) * 2;
      const scaledH = Math.round((origH * 1.02) / 2) * 2;
      command.videoFilters(['hflip', `scale=${scaledW}:${scaledH}`, `crop=${origW}:${origH}`]);
    }

    if (options.audioStreamIndex !== undefined) {
      command
        .outputOptions('-map 0:v:0')
        .outputOptions(`-map 0:${options.audioStreamIndex}`);
    }

    command
      .output(oPath)
      .format('mp4')
      .audioCodec('aac')
      .outputOptions('-pix_fmt yuv420p')
      .outputOptions('-strict -2')
      .on('start', (commandLine) => {
        log.info('FFmpeg transcode started: ' + commandLine);
        currentCommandLine = commandLine;
        processId = addProcess(commandLine, command);
        onProgress(0);
      })
      .on('progress', (progress) => {
        if (progress.percent !== undefined) {
          onProgress(Math.round(progress.percent));
        }
      })
      .on('end', () => {
        log.info('FFmpeg transcode finished');
        if (processId) removeProcess(processId);
        onProgress(100);
        resolve(oPath);
      })
      .on('error', (err, stdout, stderr) => {
        log.error('FFmpeg transcode error: ', err);
        log.error('FFmpeg stderr: ', stderr);
        if (processId) removeProcess(processId);

        const errStr = (err?.message || '') + ' ' + (stderr || '');
        const isNvencError = options.useNvenc && (
          errStr.toLowerCase().includes('nvenc') || 
          errStr.toLowerCase().includes('cuda') || 
          errStr.toLowerCase().includes('nvidia') || 
          errStr.toLowerCase().includes('driver') ||
          errStr.toLowerCase().includes('api version') ||
          errStr.toLowerCase().includes('encoder') ||
          errStr.toLowerCase().includes('function not implemented')
        );

        if (isNvencError) {
          log.warn('[FFmpeg] GPU NVENC transcode error detected. Automatically retrying with safe CPU (libx264) transcoding...');
          const fallbackOptions = { ...options, useNvenc: false };
          transcodeToMp4(videoPath, outputPath, onProgress, onCommand, fallbackOptions)
            .then(resolve)
            .catch(reject);
        } else {
          reject(new Error(`FFmpeg Transcode Error: ${err.message}\n\nCommand: ${currentCommandLine}\n\nStderr: ${stderr}`));
        }
      })
      .run();
  });
}

function setCustomFfmpegPath(path) {
  if (path && fs.existsSync(path)) {
    ffmpeg.setFfmpegPath(path);
    ffmpegPath = path;
    console.log('Custom FFmpeg path set:', path);
    return true;
  }
  return false;
}

/**
 * Функция для сборки финального релиза (Main Process).
 * Объединяет видео, аудио от звукорежиссера и (опционально) субтитры надписей.
 * 
 * @param videoPath Путь к исходному видео
 * @param audioPath Путь к аудиофайлу от звукорежиссера
 * @param signsAssPath Путь к файлу субтитров с надписями (опционально)
 * @param outputPath Путь для сохранения результата
 * @param onProgress Коллбэк для прогресса
 * @returns Promise с путем к готовому файлу
 */
function muxRelease(videoPath, audioPath, signsAssPath, outputPath, onProgress, onCommand) {
  return new Promise((resolve, reject) => {
    const vPath = path.resolve(videoPath);
    const aPath = path.resolve(audioPath);
    const oPath = path.resolve(outputPath);

    let currentCommandLine = '';
    let processId = null;
    let command = ffmpeg(vPath).input(aPath).outputOptions('-y');

    if (onCommand) onCommand(command);
    // Если есть надписи, накладываем их хардсабом (требует перекодирования видео)
    if (signsAssPath && fs.existsSync(signsAssPath)) {
      const sPath = path.resolve(signsAssPath);
      const escapedAssPath = sPath
        .replace(/\\/g, '/')
        .replace(/:/g, '\\:')
        .replace(/'/g, "'\\''");

      command = command
        .videoFilters(`ass=filename='${escapedAssPath}'`)
        .videoCodec('libx264')
        .outputOptions('-crf 18')
        .outputOptions('-preset slow');
    } else {
      // Если надписей нет, просто копируем видеопоток для скорости и качества
      command = command.videoCodec('copy');
    }

    command
      .audioCodec('aac')
      .outputOptions('-pix_fmt yuv420p')
      .outputOptions('-map 0:v:0') // Видео из первого входа
      .outputOptions('-map 1:a:0') // Аудио из второго входа
      .on('start', (commandLine) => {
        log.info('Muxing started: ' + commandLine);
        currentCommandLine = commandLine;
        processId = addProcess(commandLine, command);
        onProgress(0);
      })
      .on('progress', (progress) => {
        if (progress.percent !== undefined) {
          onProgress(Math.round(progress.percent));
        }
      })
      .on('end', () => {
        log.info('Muxing finished');
        if (processId) removeProcess(processId);
        onProgress(100);
        resolve(oPath);
      })
      .on('error', (err, stdout, stderr) => {
        log.error('Muxing error: ', err);
        log.error('FFmpeg stderr: ', stderr);
        if (processId) removeProcess(processId);
        reject(new Error(`Muxing Error: ${err.message}\n\nCommand: ${currentCommandLine}\n\nStderr: ${stderr}`));
      })
      .save(oPath);
  });
}

/**
 * Функция для извлечения кадра из видео (Main Process).
 * 
 * @param videoPath Путь к исходному видеофайлу
 * @param timestamp Время в секундах или формат 'HH:MM:SS'
 * @param outputPath Путь для сохранения изображения
 * @returns Promise с путем к готовому файлу
 */
function takeScreenshot(videoPath, timestamp, outputPath) {
  return new Promise((resolve, reject) => {
    const vPath = path.resolve(videoPath);
    const oPath = path.resolve(outputPath);

    let processId = null;

    const command = ffmpeg(vPath)
      .seekInput(timestamp)
      .frames(1)
      .output(oPath)
      .on('start', (commandLine) => {
        processId = addProcess(commandLine, command);
      })
      .on('end', () => {
        if (processId) removeProcess(processId);
        resolve(oPath);
      })
      .on('error', (err) => {
        if (processId) removeProcess(processId);
        reject(err);
      });
      
    command.run();
  });
}

function getVideoMetadataFallback(videoPath) {
  return new Promise((resolve, reject) => {
    const { execFile } = require('child_process');
    const child = execFile(ffmpegPath, ['-i', videoPath], (err, stdout, stderr) => {
      const output = stdout + '\n' + stderr;
      const streams = [];
      const lines = output.split('\n');
      
      for (const line of lines) {
        if (line.includes('Stream #')) {
          if (line.includes('Audio:')) {
            streams.push({ codec_type: 'audio' });
          } else if (line.includes('Video:')) {
            streams.push({ codec_type: 'video' });
          } else if (line.includes('Subtitle:')) {
            streams.push({ codec_type: 'subtitle' });
          }
        }
      }
      resolve({ streams });
    });
    trackProcess(child);
  });
}

function getVideoMetadata(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        log.warn(`ffprobe failed for ${videoPath}, using ffmpeg fallback probe:`, err.message);
        getVideoMetadataFallback(videoPath)
          .then(resolve)
          .catch(() => reject(err));
      } else {
        resolve(metadata);
      }
    });
  });
}

function extractSubtitleTrack(videoPath, outputPath, streamIndex) {
  return new Promise((resolve, reject) => {
    let processId = null;
    const command = ffmpeg(videoPath)
      .outputOptions(`-map 0:${streamIndex}`)
      .on('start', (commandLine) => {
        processId = addProcess(commandLine, command);
      })
      .on('end', () => {
        if (processId) removeProcess(processId);
        resolve(outputPath);
      })
      .on('error', (err) => {
        if (processId) removeProcess(processId);
        reject(err);
      });
      
    command.save(outputPath);
  });
}

function extractAudioPeaks(videoPath, pointsPerSecond = 10, channelCount = 1) {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const samplingRate = 8000;
    const samplesPerPeak = Math.floor(samplingRate / pointsPerSecond);
    const peaks = [];
    
    // Check if the ffmpegPath is defined, else use system default
    const currentFfmpegExec = ffmpegPath || 'ffmpeg';

    log.info(`Extracting audio peaks for ${videoPath}`);
    
    const ffProcess = spawn(currentFfmpegExec, [
      '-i', videoPath,
      '-vn',
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      '-ar', String(samplingRate),
      '-ac', String(channelCount),
      '-'
    ]);
    trackProcess(ffProcess);

    let chunkBuffer = Buffer.alloc(0);

    ffProcess.stdout.on('data', (chunk) => {
      chunkBuffer = Buffer.concat([chunkBuffer, chunk]);
      
      // Process chunks of size `samplesPerPeak * 2` (2 bytes per sample for s16le)
      const bytesPerPeak = samplesPerPeak * 2;
      while (chunkBuffer.length >= bytesPerPeak) {
        let max = 0;
        for (let i = 0; i < bytesPerPeak; i += 2) {
          const sample = Math.abs(chunkBuffer.readInt16LE(i));
          if (sample > max) max = sample;
        }
        peaks.push(max / 32768); // normalize 0-1
        chunkBuffer = chunkBuffer.slice(bytesPerPeak);
      }
    });

    ffProcess.on('close', (code) => {
      log.info(`Audio peaks extraction finished with code ${code}, total peaks: ${peaks.length}`);
      resolve(peaks);
    });

    ffProcess.on('error', (err) => {
      log.error('Error during audio peaks extraction:', err);
      reject(err);
    });
  });
}

/**
 * Replaces specified time intervals in an audio file with silence using FFmpeg volume filter.
 * Creates an automatic .orig_backup copy before overwriting.
 * 
 * @param {string} filePath Path to audio file
 * @param {Array<{startSec: number, endSec: number}>} intervals Time ranges to silence
 */
function silenceAudioIntervals(filePath, intervals) {
  return new Promise((resolve, reject) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return reject(new Error(`Audio file not found: ${filePath}`));
    }
    if (!intervals || !Array.isArray(intervals) || intervals.length === 0) {
      return resolve({ success: true, message: 'No intervals provided' });
    }

    const ext = path.extname(filePath) || '.wav';
    const tempOutput = path.join(path.dirname(filePath), `temp_silenced_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`);
    const backupPath = `${filePath}.orig_backup`;

    // Filter clauses for FFmpeg: volume=enable='between(t,start,end)':volume=0
    const filterClauses = intervals.map(inter => {
      const s = Math.max(0, Number(inter.startSec) || 0).toFixed(3);
      const e = Math.max(0, Number(inter.endSec) || 0).toFixed(3);
      return `volume=enable='between(t,${s},${e})':volume=0`;
    }).join(',');

    log.info(`[silenceAudioIntervals] Processing ${intervals.length} intervals for: ${filePath}`);

    const command = ffmpeg(filePath)
      .audioFilters(filterClauses)
      .output(tempOutput)
      .on('end', () => {
        try {
          if (!fs.existsSync(backupPath)) {
            fs.copyFileSync(filePath, backupPath);
          }
          fs.copyFileSync(tempOutput, filePath);
          try { fs.unlinkSync(tempOutput); } catch (e) {}
          log.info(`[silenceAudioIntervals] Successfully silenced intervals in: ${filePath}`);
          resolve({ success: true, backupPath });
        } catch (copyErr) {
          log.error('[silenceAudioIntervals] Failed to replace file with silenced version:', copyErr);
          reject(copyErr);
        }
      })
      .on('error', (err) => {
        log.error('[silenceAudioIntervals] FFmpeg error:', err);
        try {
          if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
        } catch (e) {}
        reject(err);
      });

    addProcess(command._getArguments ? command._getArguments().join(' ') : 'silenceAudioIntervals', command);
    command.run();
  });
}

/**
 * Detects voiced/speech intervals in an audio file using FFmpeg silencedetect filter.
 * 
 * @param {string} filePath Path to audio file
 * @param {object} options Optional parameters { noiseDb, minSilenceDuration }
 * @returns {Promise<{duration: number, silences: Array<{start: number, end: number}>, speechIntervals: Array<{startSec: number, endSec: number, durationSec: number}>}>}
 */
function detectSpeechIntervals(filePath, options = {}) {
  return new Promise(async (resolve, reject) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return reject(new Error(`Audio file not found: ${filePath}`));
    }
    const noiseDb = options.noiseDb !== undefined ? options.noiseDb : -38;
    const minSilenceDuration = options.minSilenceDuration !== undefined ? options.minSilenceDuration : 0.25;

    let totalDur = 0;
    try {
      const meta = await getVideoMetadata(filePath);
      if (meta && meta.format && meta.format.duration) {
        totalDur = Number(meta.format.duration);
      }
    } catch (metaErr) {
      log.warn(`[detectSpeechIntervals] Could not probe duration for ${filePath}:`, metaErr.message);
    }

    const silences = [];
    let currentSilenceStart = null;

    const cmd = ffmpeg(filePath)
      .audioFilters(`silencedetect=noise=${noiseDb}dB:d=${minSilenceDuration}`)
      .format('null')
      .output('-')
      .on('stderr', (stderrChunk) => {
        const lines = stderrChunk.split('\n');
        for (const line of lines) {
          const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
          if (startMatch) {
            currentSilenceStart = parseFloat(startMatch[1]);
          }
          const endMatch = line.match(/silence_end:\s*([0-9.]+)/);
          if (endMatch) {
            const silenceEnd = parseFloat(endMatch[1]);
            if (currentSilenceStart !== null) {
              silences.push({ start: currentSilenceStart, end: silenceEnd });
              currentSilenceStart = null;
            } else {
              silences.push({ start: 0, end: silenceEnd });
            }
          }
        }
      })
      .on('end', () => {
        const finalDur = totalDur || (silences.length > 0 ? silences[silences.length - 1].end : 0);
        if (currentSilenceStart !== null && finalDur) {
          silences.push({ start: currentSilenceStart, end: finalDur });
        }

        const rawSpeech = [];
        if (silences.length === 0) {
          if (finalDur > 0) {
            rawSpeech.push({
              startSec: 0,
              endSec: finalDur,
              durationSec: finalDur
            });
          }
        } else {
          let curPos = 0;
          for (const s of silences) {
            if (s.start - curPos > 0.08) {
              const start = Math.max(0, curPos - 0.04);
              const end = s.start + 0.04;
              rawSpeech.push({
                startSec: start,
                endSec: end,
                durationSec: end - start
              });
            }
            curPos = s.end;
          }
          if (finalDur && (finalDur - curPos > 0.08)) {
            const start = Math.max(0, curPos - 0.04);
            const end = finalDur;
            rawSpeech.push({
              startSec: start,
              endSec: end,
              durationSec: end - start
            });
          }
        }

        // Merge contiguous intervals separated by small gap (< 0.25s)
        const speechIntervals = [];
        for (const interval of rawSpeech) {
          if (speechIntervals.length === 0) {
            speechIntervals.push({ ...interval });
          } else {
            const last = speechIntervals[speechIntervals.length - 1];
            if (interval.startSec - last.endSec < 0.25) {
              last.endSec = Math.max(last.endSec, interval.endSec);
              last.durationSec = last.endSec - last.startSec;
            } else {
              speechIntervals.push({ ...interval });
            }
          }
        }

        log.info(`[detectSpeechIntervals] Found ${speechIntervals.length} voiced intervals in ${filePath}`);
        resolve({
          duration: finalDur,
          silences,
          speechIntervals
        });
      })
      .on('error', (err) => {
        log.error('[detectSpeechIntervals] Error detecting speech intervals:', err);
        reject(err);
      });

    addProcess('detectSpeechIntervals', cmd);
    cmd.run();
  });
}

/**
 * Automatically applies fixes from a snippet fix track into an original track:
 * 1. Detects timings & boundaries of the phrase(s) in the fix file.
 * 2. Mutes (zeros out volume) in the original track at those intervals.
 * 3. Merges/overlays the fix track onto the original track.
 * 
 * @param {string} originalPath Path to original audio file
 * @param {string} fixPath Path to fix audio file (snippet)
 * @param {string} outputPath Target output path
 * @param {object} options Optional target timings or noise thresholds
 */
async function applyFixesToOriginalAudio(originalPath, fixPath, outputPath, options = {}) {
  if (!originalPath || !fs.existsSync(originalPath)) {
    throw new Error(`Original audio not found: ${originalPath}`);
  }
  if (!fixPath || !fs.existsSync(fixPath)) {
    throw new Error(`Fix audio not found: ${fixPath}`);
  }

  // 1. Detect speech intervals in fixPath
  const { duration: fixDuration, speechIntervals } = await detectSpeechIntervals(fixPath, options);

  if (!speechIntervals || speechIntervals.length === 0) {
    log.warn(`[applyFixesToOriginalAudio] No speech detected in fix file ${fixPath}. Copying original.`);
    await fs.promises.copyFile(originalPath, outputPath);
    return { success: true, applied: false, reason: 'no_speech_detected', intervals: [] };
  }

  let targetIntervals = speechIntervals;
  let delayMs = 0;

  // If targetSec was passed and the fix was recorded from 0s as a short standalone take (< 45s)
  if (options.targetSec !== undefined && options.targetSec > 0 && fixDuration < 45 && speechIntervals[0].startSec < 5) {
    delayMs = Math.round(options.targetSec * 1000);
    targetIntervals = speechIntervals.map(interval => ({
      startSec: options.targetSec + interval.startSec,
      endSec: options.targetSec + interval.endSec,
      durationSec: interval.durationSec
    }));
  }

  // Zero out the original track during all target intervals
  const volumeClauses = targetIntervals.map(inter => {
    const s = Math.max(0, inter.startSec).toFixed(3);
    const e = Math.max(0, inter.endSec).toFixed(3);
    return `between(t,${s},${e})`;
  }).join('+');

  const origMuteFilter = `volume=enable='${volumeClauses}':volume=0`;

  // Determine output extension and audio codec
  const ext = (path.extname(outputPath) || path.extname(originalPath) || '.wav').toLowerCase();
  let audioCodec = 'pcm_s16le';
  if (ext === '.mp3') audioCodec = 'libmp3lame';
  else if (ext === '.flac') audioCodec = 'flac';
  else if (ext === '.ogg') audioCodec = 'libvorbis';
  else if (ext === '.m4a' || ext === '.aac') audioCodec = 'aac';

  // Build filter chain with resample and amix
  let fixInputFilter = `aresample=48000,aformat=channel_layouts=stereo`;
  if (delayMs > 0) {
    fixInputFilter = `adelay=${delayMs}|${delayMs},${fixInputFilter}`;
  }

  const filterComplex = [
    `[0:a]aresample=48000,aformat=channel_layouts=stereo,${origMuteFilter}[orig_muted]`,
    `[1:a]${fixInputFilter}[fix_ready]`,
    `[orig_muted][fix_ready]amix=inputs=2:duration=first:dropout_transition=0:weights='1 1'[out]`
  ].join(';');

  const tempOut = path.join(path.dirname(outputPath), `temp_auto_fix_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`);

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg()
      .input(originalPath)
      .input(fixPath)
      .complexFilter(filterComplex)
      .map('[out]')
      .audioCodec(audioCodec)
      .output(tempOut)
      .on('end', async () => {
        try {
          if (fs.existsSync(outputPath)) {
            await fs.promises.unlink(outputPath);
          }
          await fs.promises.rename(tempOut, outputPath);
          log.info(`[applyFixesToOriginalAudio] Successfully merged fix into original: ${outputPath}`);
          resolve({
            success: true,
            applied: true,
            intervals: targetIntervals,
            outputPath
          });
        } catch (renameErr) {
          log.error(`[applyFixesToOriginalAudio] Failed renaming output:`, renameErr);
          reject(renameErr);
        }
      })
      .on('error', (err) => {
        log.error(`[applyFixesToOriginalAudio] FFmpeg error:`, err);
        try { if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut); } catch (e) {}
        reject(err);
      });

    addProcess('applyFixesToOriginalAudio', cmd);
    cmd.run();
  });
}

module.exports = {
  bakeSubtitles,
  transcodeToMp4,
  muxRelease,
  takeScreenshot,
  getVideoMetadata,
  extractSubtitleTrack,
  extractAudioPeaks,
  silenceAudioIntervals,
  detectSpeechIntervals,
  applyFixesToOriginalAudio,
  setCustomFfmpegPath,
  getActiveProcesses,
  killAllProcesses,
  addProcess,
  removeProcess,
  getFfmpegPath: () => ffmpegPath
};
