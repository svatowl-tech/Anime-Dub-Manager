import fs from 'fs';
import path from 'path';
import os from 'os';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const BIN_DIR = path.join(ROOT_DIR, 'assets', 'bin');
const MODELS_DIR = path.join(ROOT_DIR, 'assets', 'models');
const WLK_DIR = path.join(ROOT_DIR, 'whisperlivekit');

console.log('===========================================================');
console.log('🚀 [Build Sidecars Preparation] Подготовка зависимостей и сайдкаров...');
console.log('===========================================================');

/**
 * 1. Загрузка бинарных файлов (FFmpeg, FFprobe)
 */
function getFFmpegUrl() {
  const platform = os.platform();
  const arch = os.arch();

  if (platform === 'win32') {
    return 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
  } else if (platform === 'linux') {
    return 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz';
  } else if (platform === 'darwin') {
    if (arch === 'arm64') {
      return 'https://github.com/eugeneware/ffmpeg-static/releases/download/b5.0.1/darwin-arm64';
    }
    return 'https://evermeet.cx/ffmpeg/getrelease/zip';
  }
  return null;
}

function getFFprobeUrl() {
  const platform = os.platform();
  const arch = os.arch();
  
  if (platform === 'win32' || platform === 'linux') return null;
  if (platform === 'darwin') {
    if (arch === 'arm64') {
      return 'https://github.com/eugeneware/ffprobe-static/releases/download/b5.0.1/darwin-arm64';
    }
    return 'https://evermeet.cx/ffmpeg/info/ffprobe/getrelease/zip';
  }
  return null;
}

async function downloadBinaryDirect(url, destPath) {
  console.log(`  [Binary Download] Скачивание ${path.basename(destPath)}...`);
  const response = await axios({ method: 'GET', url: url, responseType: 'stream', timeout: 30000 });
  const writer = fs.createWriteStream(destPath);
  response.data.pipe(writer);
  await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
  if (os.platform() !== 'win32') fs.chmodSync(destPath, 0o755);
}

async function prepareBinaries() {
  console.log('\n📦 Шаг 1: Подготовка бинарных утилит FFmpeg / FFprobe...');
  fs.mkdirSync(BIN_DIR, { recursive: true });

  const ffmpegName = os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const ffprobeName = os.platform() === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const ffmpegPath = path.join(BIN_DIR, ffmpegName);
  const ffprobePath = path.join(BIN_DIR, ffprobeName);

  if (fs.existsSync(ffmpegPath) && fs.existsSync(ffprobePath)) {
    console.log(`  ✓ Бинарные файлы уже присутствуют в ${BIN_DIR}`);
    return;
  }

  const platform = os.platform();
  const arch = os.arch();

  try {
    if (platform === 'darwin' && arch === 'arm64') {
      const ffmpegUrl = getFFmpegUrl();
      const ffprobeUrl = getFFprobeUrl();
      if (ffmpegUrl && !fs.existsSync(ffmpegPath)) await downloadBinaryDirect(ffmpegUrl, ffmpegPath);
      if (ffprobeUrl && !fs.existsSync(ffprobePath)) await downloadBinaryDirect(ffprobeUrl, ffprobePath);
      console.log('  ✓ macOS ARM64 бинарники успешно загружены.');
      return;
    }

    const url = getFFmpegUrl();
    if (!url) {
      console.warn('  ⚠️ Не удалось определить URL сборки FFmpeg для текущей ОС. Пропуск.');
      return;
    }

    console.log(`  Скачивание архива FFmpeg: ${url}`);
    const tempFile = path.join(BIN_DIR, 'ffmpeg-temp' + (url.endsWith('.zip') ? '.zip' : '.tar.xz'));
    const response = await axios({ method: 'GET', url: url, responseType: 'stream', timeout: 45000 });
    const writer = fs.createWriteStream(tempFile);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    console.log('  Распаковка FFmpeg архива...');
    if (url.endsWith('.zip')) {
      if (os.platform() === 'win32') {
        execSync(`powershell -Command "Expand-Archive -Path '${tempFile}' -DestinationPath '${BIN_DIR}' -Force"`);
      } else {
        execSync(`unzip -o "${tempFile}" -d "${BIN_DIR}"`);
      }
    } else {
      execSync(`tar -xf "${tempFile}" -C "${BIN_DIR}"`);
    }

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
    if (foundFfmpeg && foundFfmpeg !== ffmpegPath) {
      fs.copyFileSync(foundFfmpeg, ffmpegPath);
      if (os.platform() !== 'win32') fs.chmodSync(ffmpegPath, 0o755);
      console.log(`  ✓ FFmpeg размещен: ${ffmpegPath}`);
    }

    const foundFfprobe = findBinary(BIN_DIR, ffprobeName);
    if (foundFfprobe && foundFfprobe !== ffprobePath) {
      fs.copyFileSync(foundFfprobe, ffprobePath);
      if (os.platform() !== 'win32') fs.chmodSync(ffprobePath, 0o755);
      console.log(`  ✓ FFprobe размещен: ${ffprobePath}`);
    }

    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  } catch (err) {
    console.warn(`  ⚠️ Не удалось автоматически загрузить FFmpeg (${err.message}). Приложение будет использовать системный или встроенный fallback.`);
  }
}

/**
 * 2. Загрузка офлайн моделей ИИ (Diarization, Translation, Whisper)
 */
async function downloadFileWithProgress(url, destPath) {
  const dirName = path.dirname(destPath);
  if (!fs.existsSync(dirName)) {
    fs.mkdirSync(dirName, { recursive: true });
  }

  if (fs.existsSync(destPath)) {
    console.log(`  [Уже готов] ${path.relative(MODELS_DIR, destPath)}`);
    return;
  }

  console.log(`  Загрузка ${url} -> ${path.relative(MODELS_DIR, destPath)}`);
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 60000
    });

    const totalLength = response.headers['content-length'];
    let downloadedBytes = 0;
    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalLength) {
          const percent = ((downloadedBytes / totalLength) * 100).toFixed(1);
          const MB = (downloadedBytes / (1024 * 1024)).toFixed(1);
          const totalMB = (totalLength / (1024 * 1024)).toFixed(1);
          process.stdout.write(`\r    Прогресс: ${percent}% (${MB} / ${totalMB} MB)`);
        }
      });

      writer.on('finish', () => {
        process.stdout.write('\n    ✓ Загружено успешно.\n');
        resolve();
      });

      writer.on('error', (err) => {
        process.stdout.write('\n    ❌ Ошибка записи файла!\n');
        reject(err);
      });
    });
  } catch (error) {
    console.warn(`    ⚠️ Пропуск загрузки ${url}: ${error.message}`);
  }
}

async function prepareModels() {
  console.log('\n🧠 Шаг 2: Подготовка офлайн моделей (Diarization ONNX, Translation, Whisper)...');
  fs.mkdirSync(MODELS_DIR, { recursive: true });

  const models = [
    {
      name: 'onnx-community/pyannote-segmentation-3.0',
      files: [
        'config.json',
        'preprocessor_config.json',
        'onnx/model_quantized.onnx',
        'onnx/model.onnx'
      ]
    },
    {
      name: 'Xenova/m2m100_418M',
      files: [
        'config.json',
        'generation_config.json',
        'tokenizer_config.json',
        'sentencepiece.bpe.model',
        'tokenizer.json',
        'onnx/encoder_model_quantized.onnx',
        'onnx/decoder_model_merged_quantized.onnx'
      ]
    }
  ];

  for (const model of models) {
    console.log(`  📦 Модель: ${model.name}`);
    for (const file of model.files) {
      const url = `https://huggingface.co/${model.name}/resolve/main/${file}`;
      const destPath = path.join(MODELS_DIR, model.name, file);
      await downloadFileWithProgress(url, destPath);
    }
  }

  // Whisper GGML tiny
  console.log('  📦 Модель: Whisper Native GGML');
  const whisperDest = path.join(MODELS_DIR, 'whisper', 'ggml-tiny.bin');
  const whisperUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin';
  await downloadFileWithProgress(whisperUrl, whisperDest);
}

/**
 * 3. Подготовка бинарного файла yt-dlp (прямое скачивание с GitHub Releases без использования GitHub REST API)
 */
async function prepareYtDlp() {
  console.log('\n📹 Шаг 3: Подготовка бинарного файла yt-dlp...');
  const isWin = os.platform() === 'win32';
  const ytDlpFileName = isWin ? 'yt-dlp.exe' : 'yt-dlp';
  const binDest = path.join(BIN_DIR, ytDlpFileName);
  const nodeModulesYtDlpDir = path.join(ROOT_DIR, 'node_modules', 'youtube-dl-exec', 'bin');
  const nodeModulesYtDlpDest = path.join(nodeModulesYtDlpDir, ytDlpFileName);

  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.mkdirSync(nodeModulesYtDlpDir, { recursive: true });

  if (fs.existsSync(binDest) && fs.existsSync(nodeModulesYtDlpDest)) {
    console.log(`  ✓ yt-dlp уже присутствует в assets/bin и node_modules`);
    return;
  }

  if (fs.existsSync(nodeModulesYtDlpDest) && !fs.existsSync(binDest)) {
    fs.copyFileSync(nodeModulesYtDlpDest, binDest);
    if (!isWin) fs.chmodSync(binDest, 0o755);
    console.log(`  ✓ yt-dlp скопирован из node_modules в assets/bin`);
    return;
  }

  if (fs.existsSync(binDest) && !fs.existsSync(nodeModulesYtDlpDest)) {
    fs.copyFileSync(binDest, nodeModulesYtDlpDest);
    if (!isWin) fs.chmodSync(nodeModulesYtDlpDest, 0o755);
    console.log(`  ✓ yt-dlp скопирован из assets/bin в node_modules`);
    return;
  }

  // Direct GitHub release download URLs (bypasses GitHub REST API and avoids rate-limit 403 errors)
  const primaryUrl = isWin
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    : (os.platform() === 'darwin'
      ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
      : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp');

  try {
    console.log(`  [yt-dlp] Загрузка с ${primaryUrl}...`);
    const response = await axios({
      method: 'GET',
      url: primaryUrl,
      responseType: 'stream',
      maxRedirects: 5,
      timeout: 60000
    });

    const writer = fs.createWriteStream(binDest);
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    if (!isWin) fs.chmodSync(binDest, 0o755);
    fs.copyFileSync(binDest, nodeModulesYtDlpDest);
    if (!isWin) fs.chmodSync(nodeModulesYtDlpDest, 0o755);
    console.log(`  ✓ yt-dlp успешно загружен и размещен в assets/bin и node_modules/youtube-dl-exec/bin`);
  } catch (err) {
    console.warn(`  ⚠️ Не удалось загрузить автономный yt-dlp (${err.message}). Попробуем скачать универсальный скрипт...`);
    try {
      const fallbackUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
      const response = await axios({ method: 'GET', url: fallbackUrl, responseType: 'stream', maxRedirects: 5, timeout: 60000 });
      const writer = fs.createWriteStream(binDest);
      response.data.pipe(writer);
      await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });
      if (!isWin) fs.chmodSync(binDest, 0o755);
      fs.copyFileSync(binDest, nodeModulesYtDlpDest);
      if (!isWin) fs.chmodSync(nodeModulesYtDlpDest, 0o755);
      console.log(`  ✓ Универсальный yt-dlp успешно загружен в bin`);
    } catch (e2) {
      console.warn(`  ⚠️ Ошибка резервной загрузки yt-dlp: ${e2.message}`);
    }
  }
}

/**
 * 4. Валидация и проверка структуры WhisperLiveKit sidecar
 */
function preparePythonSidecars() {
  console.log('\n🐍 Шаг 4: Проверка и валидация Python Sidecar модулей...');

  const checkFile = (relPath, desc) => {
    const full = path.join(ROOT_DIR, relPath);
    if (fs.existsSync(full)) {
      console.log(`  ✓ ${desc}: ${relPath} [Найден]`);
      return true;
    } else {
      console.warn(`  ⚠️ ${desc}: ${relPath} [Отсутствует]`);
      return false;
    }
  };

  const wlkStatus = checkFile('whisperlivekit/whisperlivekit/basic_server.py', 'WhisperLiveKit Server Sidecar');
  const wlkCliStatus = checkFile('whisperlivekit/whisperlivekit/cli.py', 'WhisperLiveKit CLI Sidecar');
  const matcherStatus = checkFile('electron/services/voice_matcher.py', 'Voice Matcher Python Engine');
  const faceDetectorStatus = checkFile('scripts/face_detector.py', 'Face Detector Python Utility');

  // Генерация манифеста сайдкаров для сборки
  const manifest = {
    version: '1.2.0',
    preparedAt: new Date().toISOString(),
    binaries: {
      ffmpeg: fs.existsSync(path.join(BIN_DIR, os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')),
      ffprobe: fs.existsSync(path.join(BIN_DIR, os.platform() === 'win32' ? 'ffprobe.exe' : 'ffprobe')),
      ytdlp: fs.existsSync(path.join(BIN_DIR, os.platform() === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'))
    },
    models: {
      pyannoteSegmentation: fs.existsSync(path.join(MODELS_DIR, 'onnx-community', 'pyannote-segmentation-3.0')),
      m2m100: fs.existsSync(path.join(MODELS_DIR, 'Xenova', 'm2m100_418M')),
      whisperGgml: fs.existsSync(path.join(MODELS_DIR, 'whisper', 'ggml-tiny.bin'))
    },
    sidecars: {
      whisperLiveKit: wlkStatus && wlkCliStatus,
      voiceMatcher: matcherStatus,
      faceDetector: faceDetectorStatus
    }
  };

  const manifestPath = path.join(ROOT_DIR, 'assets', 'sidecars-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`  ✓ Манифест сайдкаров записан в ${path.relative(ROOT_DIR, manifestPath)}`);
}

async function run() {
  try {
    await prepareBinaries();
    await prepareModels();
    await prepareYtDlp();
    preparePythonSidecars();
    console.log('\n===========================================================');
    console.log('✅ Все сайдкары, бинарные утилиты и модели успешно подготовлены!');
    console.log('===========================================================\n');
  } catch (err) {
    console.error('❌ Ошибка при подготовке сайдкаров:', err);
    // Не прерываем сборку фатально, чтобы vite build мог продолжить сборку веб-бандла
  }
}

run();
