import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BIN_DIR = path.join(__dirname, '..', 'assets', 'bin');
const RELEASE_BASE = 'https://github.com/descriptinc/ffmpeg-ffprobe-static/releases/download/b6.1.2-rc.1';

function getBinaryUrls() {
  const platform = os.platform();
  const arch = os.arch();

  let ffmpegBinaryName = '';
  let ffprobeBinaryName = '';

  if (platform === 'win32') {
    ffmpegBinaryName = 'ffmpeg-win32-x64';
    ffprobeBinaryName = 'ffprobe-win32-x64';
  } else if (platform === 'darwin') {
    const suffix = arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
    ffmpegBinaryName = `ffmpeg-${suffix}`;
    ffprobeBinaryName = `ffprobe-${suffix}`;
  } else if (platform === 'linux') {
    const suffix = arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
    ffmpegBinaryName = `ffmpeg-${suffix}`;
    ffprobeBinaryName = `ffprobe-${suffix}`;
  }

  if (!ffmpegBinaryName || !ffprobeBinaryName) {
    return null;
  }

  return {
    ffmpegUrl: `${RELEASE_BASE}/${ffmpegBinaryName}`,
    ffprobeUrl: `${RELEASE_BASE}/${ffprobeBinaryName}`
  };
}

async function downloadWithRetry(url, destPath, retries = 3) {
  const fileName = path.basename(destPath);
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[FFmpeg] [Попытка ${attempt}/${retries}] Скачивание ${fileName} с ${url}...`);
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AnimeDubManager-Build/1.2)'
        },
        maxRedirects: 5,
        timeout: 120000
      });

      const tempPath = `${destPath}.tmp`;
      const writer = fs.createWriteStream(tempPath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      // Переименование после полной загрузки
      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath);
      }
      fs.renameSync(tempPath, destPath);

      if (os.platform() !== 'win32') {
        fs.chmodSync(destPath, 0o755);
      }

      console.log(`[FFmpeg] Успешно загружен ${fileName} (${(fs.statSync(destPath).size / 1024 / 1024).toFixed(2)} MB)`);
      return;
    } catch (err) {
      console.error(`[FFmpeg] Ошибка при скачивании ${fileName} (попытка ${attempt}):`, err.message);
      if (attempt === retries) {
        throw err;
      }
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
}

async function downloadFFmpeg() {
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }

  const isWin = os.platform() === 'win32';
  const ffmpegTarget = path.join(BIN_DIR, isWin ? 'ffmpeg.exe' : 'ffmpeg');
  const ffprobeTarget = path.join(BIN_DIR, isWin ? 'ffprobe.exe' : 'ffprobe');

  const ffmpegValid = fs.existsSync(ffmpegTarget) && fs.statSync(ffmpegTarget).size > 1000000;
  const ffprobeValid = fs.existsSync(ffprobeTarget) && fs.statSync(ffprobeTarget).size > 1000000;

  if (ffmpegValid && ffprobeValid) {
    console.log(`[FFmpeg] FFmpeg и FFprobe уже присутствуют и валидны в ${BIN_DIR}`);
    return;
  }

  const urls = getBinaryUrls();
  if (!urls) {
    console.error(`[FFmpeg] Не удалось определить URL для платформы ${os.platform()} (${os.arch()})`);
    process.exit(1);
  }

  try {
    if (!ffmpegValid) {
      await downloadWithRetry(urls.ffmpegUrl, ffmpegTarget);
    }
    if (!ffprobeValid) {
      await downloadWithRetry(urls.ffprobeUrl, ffprobeTarget);
    }
    console.log('[FFmpeg] Все бинарные файлы FFmpeg и FFprobe готовы к использованию.');
  } catch (err) {
    console.error('[FFmpeg] Критическая ошибка при установке FFmpeg/FFprobe:', err.message);
    process.exit(1);
  }
}

downloadFFmpeg();
