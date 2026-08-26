import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BIN_DIR = path.join(__dirname, '..', 'assets', 'bin');

// Сопоставление платформ для загрузки
// Для упрощения возьмем сборки от BtbN (GitHub)
// Ссылка на мастер/релиз может меняться, для примера возьмем логику выбора URL
function getFFmpegUrl() {
  const platform = os.platform();
  const arch = os.arch();

  if (platform === 'win32') {
    return 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
  } else if (platform === 'linux') {
    return 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz';
  } else if (platform === 'darwin') {
    if (arch === 'arm64') {
        // macOS ARM64 build from a reliable community source or use evermeet (which might be rosetta)
        // Actually, we can just use the ffmpeg-static binary that's already in node_modules if we want, 
        // but to keep script self-sufficient, we can use a known static build or just copy from node_modules.
        // The URL for an arm64 static build for macOS:
        return 'https://github.com/eugeneware/ffmpeg-static/releases/download/b5.0.1/darwin-arm64';
    }
    return 'https://evermeet.cx/ffmpeg/getrelease/zip';
  }
  return null;
}

function getFFprobeUrl() {
  const platform = os.platform();
  const arch = os.arch();
  
  if (platform === 'win32' || platform === 'linux') return null; // already included in the archives above
  
  if (platform === 'darwin') {
    if (arch === 'arm64') {
        return 'https://github.com/eugeneware/ffprobe-static/releases/download/b5.0.1/darwin-arm64';
    }
    return 'https://evermeet.cx/ffmpeg/info/ffprobe/getrelease/zip';
  }
  return null;
}

async function downloadBinaryDirect(url, destPath) {
  console.log(`[FFmpeg] Скачивание ${path.basename(destPath)} с ${url}...`);
  const response = await axios({ method: 'GET', url: url, responseType: 'stream' });
  const writer = fs.createWriteStream(destPath);
  response.data.pipe(writer);
  await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
  if (os.platform() !== 'win32') fs.chmodSync(destPath, 0o755);
}

async function downloadFFmpeg() {
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }

  const ffmpegName = os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const ffprobeName = os.platform() === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const ffmpegPath = path.join(BIN_DIR, ffmpegName);
  const ffprobePath = path.join(BIN_DIR, ffprobeName);

  if (fs.existsSync(ffmpegPath) && fs.existsSync(ffprobePath)) {
    console.log(`[FFmpeg] FFmpeg и FFprobe уже присутствуют в ${BIN_DIR}`);
    return;
  }

  const platform = os.platform();
  const arch = os.arch();

  // For mac OS arm64 we use direct binary downloads from static releases to ensure we get arm64 binaries
  if (platform === 'darwin' && arch === 'arm64') {
      const ffmpegUrl = getFFmpegUrl();
      const ffprobeUrl = getFFprobeUrl();
      if (ffmpegUrl) await downloadBinaryDirect(ffmpegUrl, ffmpegPath);
      if (ffprobeUrl) await downloadBinaryDirect(ffprobeUrl, ffprobePath);
      console.log(`[FFmpeg] FFmpeg и FFprobe установлены напрямую.`);
      return;
  }

  const url = getFFmpegUrl();
  if (!url) {
    console.error('[FFmpeg] Не удалось определить URL для вашей платформы');
    return;
  }

  console.log(`[FFmpeg] Скачивание FFmpeg с ${url}...`);
  const tempFile = path.join(BIN_DIR, 'ffmpeg-temp' + (url.endsWith('.zip') ? '.zip' : '.tar.xz'));

  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
    });

    const writer = fs.createWriteStream(tempFile);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    console.log('[FFmpeg] Распаковка архива...');
    
    // Используем системные команды для распаковки (zip/tar) для надежности в CI
    if (url.endsWith('.zip')) {
      if (os.platform() === 'win32') {
         execSync(`powershell -Command "Expand-Archive -Path '${tempFile}' -DestinationPath '${BIN_DIR}' -Force"`);
      } else {
         execSync(`unzip -o "${tempFile}" -d "${BIN_DIR}"`);
      }
    } else {
      execSync(`tar -xf "${tempFile}" -C "${BIN_DIR}"`);
    }

    // Поиск бинарников в распакованных папках и перенос в BIN_DIR
    const findBinary = (dir, name) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
          const found = findBinary(fullPath, name);
          if (found) return found;
        } else if (file === name) {
          return fullPath;
        }
      }
      return null;
    };

    const foundFfmpeg = findBinary(BIN_DIR, ffmpegName);
    if (foundFfmpeg) {
      fs.copyFileSync(foundFfmpeg, ffmpegPath);
      if (os.platform() !== 'win32') fs.chmodSync(ffmpegPath, 0o755);
      console.log(`[FFmpeg] FFmpeg установлен: ${ffmpegPath}`);
    }

    const foundFfprobe = findBinary(BIN_DIR, ffprobeName);
    if (foundFfprobe) {
      fs.copyFileSync(foundFfprobe, ffprobePath);
      if (os.platform() !== 'win32') fs.chmodSync(ffprobePath, 0o755);
      console.log(`[FFmpeg] FFprobe установлен: ${ffprobePath}`);
    }

    // Очистка
    fs.unlinkSync(tempFile);
    
  } catch (error) {
    console.error('[FFmpeg] Ошибка при установке:', error.message);
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    process.exit(1);
  }
}

downloadFFmpeg();
