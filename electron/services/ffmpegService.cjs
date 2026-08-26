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
    execFile(ffmpegPath, ['-i', videoPath], (err, stdout, stderr) => {
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

module.exports = {
  bakeSubtitles,
  transcodeToMp4,
  muxRelease,
  takeScreenshot,
  getVideoMetadata,
  extractSubtitleTrack,
  extractAudioPeaks,
  setCustomFfmpegPath,
  getActiveProcesses,
  killAllProcesses,
  addProcess,
  removeProcess,
  getFfmpegPath: () => ffmpegPath
};
