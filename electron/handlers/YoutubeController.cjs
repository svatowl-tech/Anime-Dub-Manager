const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const log = require('electron-log');
const { execFile } = require('child_process');
const ytdlConstants = require('youtube-dl-exec/src/constants');
const ytdlArgs = require('youtube-dl-exec/src/index').args;
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');
const { convertSrtToAss } = require('../services/subtitleService.cjs');
const { trackProcess } = require('../lib/ProcessTracker.cjs');

function getYtDlpBinaryPath() {
  const fsSync = require('fs');
  const candidates = [
    ytdlConstants.YOUTUBE_DL_PATH,
    ytdlConstants.YOUTUBE_DL_PATH ? ytdlConstants.YOUTUBE_DL_PATH.replace('app.asar', 'app.asar.unpacked') : null,
    path.join(process.resourcesPath || '', 'bin', ytdlConstants.YOUTUBE_DL_FILE || 'yt-dlp'),
    path.join(__dirname, '..', '..', 'assets', 'bin', ytdlConstants.YOUTUBE_DL_FILE || 'yt-dlp'),
    app && typeof app.getAppPath === 'function' ? path.join(app.getAppPath(), 'assets', 'bin', ytdlConstants.YOUTUBE_DL_FILE || 'yt-dlp') : null
  ];

  for (const p of candidates) {
    if (p && fsSync.existsSync(p)) {
      try {
        if (process.platform !== 'win32') {
          fsSync.chmodSync(p, 0o755);
        }
      } catch (_) {}
      return p;
    }
  }

  return ytdlConstants.YOUTUBE_DL_PATH;
}

function safeYtDlp(url, flags) {
  return new Promise((resolve, reject) => {
    // Always ignore external/local configuration files to prevent interference with our app
    flags.ignoreConfig = true;

    const args = [url].concat(ytdlArgs(flags));
    const binPath = getYtDlpBinaryPath();
    
    const child = execFile(binPath, args, { maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
      if (err) {
        const error = new Error(err.message || stderr || 'yt-dlp execution error');
        error.code = err.code;
        error.stderr = stderr;
        error.stdout = stdout;
        return reject(error);
      }
      
      if (flags.dumpSingleJson || flags.dumpJson) {
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          resolve(stdout);
        }
      } else {
        resolve(stdout);
      }
    });
    trackProcess(child);
  });
}

async function safeYtDlpWithFallback(url, flags, cookiesPath) {
  // If user provided a specific cookies.txt file, use it first
  if (cookiesPath && cookiesPath.trim()) {
    log.info(`[Youtube] Using custom cookies file: ${cookiesPath}`);
    return await safeYtDlp(url, { ...flags, cookies: cookiesPath.trim() });
  }

  try {
    return await safeYtDlp(url, flags);
  } catch (err) {
    const stderr = err.stderr || '';
    if (stderr.includes('Sign in') || stderr.includes('bot')) {
      log.warn('[Youtube] Sign-in required. Retrying with browser cookies...');
      
      const browsers = ['chrome', 'edge', 'firefox', 'brave', 'opera', 'vivaldi'];
      for (const browser of browsers) {
        try {
          log.info(`[Youtube] Trying cookies from ${browser}...`);
          return await safeYtDlp(url, { ...flags, cookiesFromBrowser: browser });
        } catch (cookieErr) {
          log.warn(`[Youtube] Failed with ${browser} cookies:`, cookieErr.stderr || cookieErr.message);
        }
      }
      
      throw new Error('Для скачивания этого видео требуется авторизация на YouTube. Укажите путь к файлу cookies.txt в Настройках приложения (экспортируйте его из браузера с помощью расширения Get cookies.txt LOCALLY).');
    }
    
    throw err;
  }
}

function registerYoutubeHandlers(getData, mainWindow, taskQueue) {
  ipcMain.handle('youtube-get-info', wrapIpcHandler(async (event, url) => {
    log.info(`[Youtube] Fetching info for: ${url}`);
    try {
      if (!url || typeof url !== 'string' || !url.trim()) {
        throw new Error('Пустая или некорректная ссылка на YouTube');
      }

      const config = await getData('config.json');
      const cookiesPath = config?.youtubeCookiesPath || '';

      const info = await safeYtDlpWithFallback(url.trim(), {
        dumpSingleJson: true,
        noWarnings: true,
        noCheckCertificates: true,
      }, cookiesPath);

      if (!info) {
        throw new Error('Не удалось получить информацию о видео (пустой ответ от yt-dlp)');
      }

      const formatsList = Array.isArray(info.formats) ? info.formats : [];

      return {
        id: info.id || '',
        title: info.title || 'YouTube Video',
        duration: info.duration || 0,
        formats: formatsList.map(f => ({
          format_id: f.format_id || '',
          ext: f.ext || '',
          resolution: f.resolution || '',
          height: f.height || null,
          vcodec: f.vcodec || 'none',
          acodec: f.acodec || 'none',
          filesize: f.filesize || f.filesize_approx || null
        })),
        subtitles: info.subtitles || {},
        automatic_captions: info.automatic_captions || {}
      };
    } catch (err) {
      console.error('[Youtube Controller Detail Error] Failed to get video details:', err);
      if (err && typeof err === 'object') {
        if (err.stderr) console.error('[Youtube Controller stderr]:', err.stderr);
        if (err.stdout) console.error('[Youtube Controller stdout]:', err.stdout);
      }
      log.error('[Youtube] Error fetching info:', err);
      throw err;
    }
  }));

  ipcMain.handle('youtube-download', wrapIpcHandler(async (event, { url, formatId, subLang, targetDir, baseFilename }) => {
    log.info(`[Youtube] Downloading ${url} to ${targetDir} (format: ${formatId}, sub: ${subLang})`);
    try {
      const config = await getData('config.json');
      const baseDir = config.baseDir || app.getPath('userData');
      const fullTargetDir = path.isAbsolute(targetDir) ? targetDir : path.join(baseDir, targetDir);

      await fs.mkdir(fullTargetDir, { recursive: true });
      
      const args = {
        noWarnings: true,
        noCheckCertificates: true,
        format: formatId || 'best',
        output: path.join(fullTargetDir, `${baseFilename}.%(ext)s`),
      };

      if (subLang && subLang !== 'none') {
        args.writeSub = true;
        args.writeAutoSub = true;
        args.subLangs = subLang;
        args.convertSubs = 'srt'; // youtubedl does not reliably convert to ass, so use srt
      }

      // Download
      const cookiesPath = config?.youtubeCookiesPath || '';
      await safeYtDlpWithFallback(url, args, cookiesPath);

      // find the downloaded files in the output directory
      const files = await fs.readdir(fullTargetDir);
      let videoFile = null;
      let subFile = null;
      
      for (const file of files) {
        if (file.startsWith(baseFilename)) {
          if (file.endsWith('.srt') || file.endsWith('.vtt')) {
            const rawSubPath = path.join(fullTargetDir, file);
            // Convert to ass
            const assPath = path.join(fullTargetDir, file.replace(/\.(srt|vtt)$/, '.ass'));
            await convertSrtToAss(rawSubPath, assPath);
            await fs.unlink(rawSubPath); // Clean up the original
            subFile = assPath;
          } else if (file.match(/\.(mp4|mkv|webm|ts|m4a|mp3)$/)) {
            videoFile = path.join(fullTargetDir, file);
          }
        }
      }

      return {
        videoFile,
        subFile
      };
    } catch (err) {
      log.error('[Youtube] Download error:', err);
      throw err;
    }
  }));
}

module.exports = { registerYoutubeHandlers };
