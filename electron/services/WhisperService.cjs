const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs/promises');
const log = require('electron-log');
const axios = require('axios');

// Importing getActiveProcesses, addProcess, removeProcess from ffmpegService is slightly complex if it's cyclic,
// Let's just use fluent-ffmpeg locally and not manage its process in the global list for now, 
// or require ffmpegService properly.
const { addProcess, removeProcess, getVideoMetadata } = require('./ffmpegService.cjs');

const { app } = require('electron');

function formatSrtTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

class WhisperService {
  constructor(baseDir) {
    this.baseDir = baseDir;
    const isDev = !app.isPackaged;
    this.modelsDir = path.join(baseDir, 'models', 'whisper');
    this.bundledModelsDir = process.resourcesPath ? path.join(process.resourcesPath, 'models') : path.join(app.getAppPath(), 'assets', 'models');
    
    log.info('[WhisperService] Constructor initialization');
    log.info(`[WhisperService] baseDir: ${baseDir}`);
    log.info(`[WhisperService] bundledModelsDir: ${this.bundledModelsDir}`);
  }

  async ensureFolder() {
    await fs.mkdir(this.modelsDir, { recursive: true });
  }

  async getModelPath(modelName) {
    const fileName = `ggml-${modelName}.bin`;
    const userPath = path.join(this.modelsDir, fileName);

    try {
      await fs.access(userPath);
      return userPath;
    } catch {
      if (this.bundledModelsDir) {
        const bundledPath = path.join(this.bundledModelsDir, fileName);
        try {
          await fs.access(bundledPath);
          return bundledPath;
        } catch {
          // ignore
        }
      }
      return userPath; // Result path for downloading
    }
  }

  /**
   * Транскрибация видео файла باستخدام FFmpeg whisper (требует FFmpeg 8.0+ с --enable-whisper)
   * @param {string} videoPath - Путь к видео
   * @param {string} language - Код языка (например, 'ja' или 'ru')
   * @param {string} modelName - Название модели (например, 'base', 'small')
   * @param {function} onProgress - Коллбэк для прогресса
   */
  async transcribe(videoPath, language = 'ja', modelName = 'base', onProgress) {
    try {
      await this.ensureFolder();
      const outputDir = path.dirname(videoPath);
      const fileName = path.basename(videoPath, path.extname(videoPath));
      const srtPath = path.join(outputDir, `${fileName}.srt`);

      // Check if video file contains any audio streams to prevent FFmpeg null mapping exception
      let hasAudioStream = false;
      try {
        const metadata = await getVideoMetadata(videoPath);
        if (metadata && metadata.streams) {
          hasAudioStream = metadata.streams.some(s => s.codec_type === 'audio');
        }
      } catch (err) {
        log.error('Failed to probe video file for audio stream in WhisperService:', err);
        // Fallback: assume it has audio if probe fails so we don't break general workflow
        hasAudioStream = true;
      }

      if (!hasAudioStream) {
        log.warn(`Video file ${videoPath} has NO audio track! Creating a dummy subtitles file to prevent FFmpeg crashes.`);
        await fs.writeFile(srtPath, '1\n00:00:01,000 --> 00:00:03,000\n[Без звука / Silent]\n', 'utf-8');
        if (onProgress) onProgress(100);
        return srtPath;
      }

      log.info(`Whisper (FFmpeg): Starting transcription for ${videoPath} [${language}] using model [${modelName}]`);
      
      const modelPath = await this.getModelPath(modelName);
      
      // Check if model exists (optional, ffmpeg will throw if not)
      try {
        await fs.access(modelPath);
      } catch (e) {
        log.warn(`Модель Whisper не найдена по пути: ${modelPath}. FFmpeg может выдать ошибку, если модель не загружена.`);
      }

      // Escape paths for FFmpeg filter
      const escapedModelPath = modelPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''");
      const escapedSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''");

      return new Promise((resolve, reject) => {
        let processId = null;
        let currentCommandLine = '';

        const command = ffmpeg(videoPath)
          .noVideo() // -vn
          .audioFilters(`whisper=model='${escapedModelPath}':language=${language}:destination='${escapedSrtPath}':format=srt`)
          .outputOptions('-f null')
          .output('-') // -f null -
          .on('start', (commandLine) => {
            log.info('FFmpeg Whisper started: ' + commandLine);
            currentCommandLine = commandLine;
            processId = addProcess(commandLine, command);
            if (onProgress) onProgress(0);
          })
          .on('progress', (progress) => {
            if (onProgress && progress.percent !== undefined) {
              // Note: percent might not be completely accurate with whisper filter
              onProgress(Math.round(progress.percent));
            }
          })
          .on('end', () => {
            log.info('FFmpeg Whisper transcription finished successfully');
            if (processId) removeProcess(processId);
            if (onProgress) onProgress(100);
            resolve(srtPath);
          })
          .on('error', async (err, stdout, stderr) => {
            log.error('FFmpeg Whisper error: ', err);
            log.error('FFmpeg stderr: ', stderr);
            if (processId) removeProcess(processId);

            const isFilterError = err.message.includes('Filter not found') || 
                                  err.message.includes('No such filter') || 
                                  (stderr && (stderr.includes('No such filter') || stderr.includes('Filter not found')));

            if (isFilterError) {
              log.warn('[WhisperService] FFmpeg whisper filter is not supported. Redirecting to fallback transcription methods...');
              try {
                const resultPath = await this.runFallbackTranscription(videoPath, language, modelName, onProgress, err, srtPath);
                resolve(resultPath);
              } catch (fallbackErr) {
                reject(fallbackErr);
              }
            } else {
              reject(new Error(`FFmpeg Whisper Error: ${err.message}\n\nУбедитесь, что ваш FFmpeg >= 8.0 и собран с ключом --enable-whisper\n\nStderr: ${stderr}`));
            }
          });

        command.run();
      });
    } catch (error) {
      log.error('Whisper Transcription failed:', error);
      throw error;
    }
  }

  async runFallbackTranscription(videoPath, language, modelName, onProgress, originalError, srtPath) {
    log.info('[WhisperService] Activating fallback transcription methods...');
    const outputDir = path.dirname(videoPath);
    const fileName = path.basename(videoPath, path.extname(videoPath));
    const apiKey = process.env.GEMINI_API_KEY;

    if (apiKey) {
      log.info('[WhisperService] Found GEMINI_API_KEY. Using Gemini API fallback.');
      const mp3Path = path.join(outputDir, `${fileName}_temp.mp3`);
      try {
        await this.extractAudioToMp3(videoPath, mp3Path);
        const srtContent = await this.transcribeWithGemini(mp3Path, language, onProgress);
        await fs.writeFile(srtPath, srtContent, 'utf-8');
        log.info(`[WhisperService] Fallback Gemini API transcription successful. Saved to ${srtPath}`);
        if (onProgress) onProgress(100);
        return srtPath;
      } catch (geminiError) {
        log.error('[WhisperService] Gemini API fallback failed:', geminiError);
        // Fall down to local method if Gemini fails
      } finally {
        try {
          await fs.unlink(mp3Path);
        } catch (e) {
          // ignore
        }
      }
    }

    log.info('[WhisperService] Trying local @huggingface/transformers (ONNX) fallback...');
    const wavPath = path.join(outputDir, `${fileName}_temp.wav`);
    try {
      await this.extractAudioToWav(videoPath, wavPath);
      const srtContent = await this.transcribeLocally(wavPath, language, modelName, onProgress);
      await fs.writeFile(srtPath, srtContent, 'utf-8');
      log.info(`[WhisperService] Fallback local Transformers transcription successful. Saved to ${srtPath}`);
      if (onProgress) onProgress(100);
      return srtPath;
    } catch (localError) {
      log.error('[WhisperService] Local Transformers fallback failed:', localError);
      throw new Error(`Не удалось выполнить транскрибацию. Исходная ошибка FFmpeg: ${originalError.message}. Ошибка локального Whisper: ${localError.message}`);
    } finally {
      try {
        await fs.unlink(wavPath);
      } catch (e) {
        // ignore
      }
    }
  }

  async extractAudioToWav(videoPath, wavPath) {
    log.info(`[WhisperService] Extracting audio to 16kHz mono WAV: ${wavPath}`);
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .noVideo()
        .audioCodec('pcm_s16le')
        .audioChannels(1)
        .audioFrequency(16000)
        .output(wavPath)
        .on('end', () => {
          log.info('[WhisperService] Audio extraction to WAV completed');
          resolve();
        })
        .on('error', (err) => {
          log.error('[WhisperService] Audio extraction to WAV failed:', err);
          reject(err);
        })
        .run();
    });
  }

  async extractAudioToMp3(videoPath, mp3Path) {
    log.info(`[WhisperService] Extracting audio to 16kHz mono MP3: ${mp3Path}`);
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .noVideo()
        .audioCodec('libmp3lame')
        .audioChannels(1)
        .audioFrequency(16000)
        .audioBitrate('48k')
        .output(mp3Path)
        .on('end', () => {
          log.info('[WhisperService] Audio extraction to MP3 completed');
          resolve();
        })
        .on('error', (err) => {
          log.error('[WhisperService] Audio extraction to MP3 failed:', err);
          reject(err);
        })
        .run();
    });
  }

  async transcribeWithGemini(mp3Path, language, onProgress) {
    log.info(`[WhisperService] Starting transcription via Gemini API for: ${mp3Path}`);
    if (onProgress) onProgress(30);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not defined in environment variables.');
    }

    const audioBuffer = await fs.readFile(mp3Path);
    const base64Audio = audioBuffer.toString('base64');
    
    if (onProgress) onProgress(50);

    log.info('[WhisperService] Sending audio to Gemini API...');
    const langName = language === 'ja' ? 'японский' : 'русский';
    
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: 'audio/mp3',
                  data: base64Audio
                }
              },
              {
                text: `Ты — профессиональный субтитрировщик. Твоя задача — прослушать аудиофайл и составить точные, профессиональные субтитры в формате SRT.
- Язык распознавания: ${langName} (или определи автоматически, если слышен другой язык).
- Формат вывода: Строго валидный SRT файл с таймингами.
- Не пиши никаких пояснений, комментариев, предысторий или Markdown-разметки (никаких \`\`\`srt). Верни ТОЛЬКО чистое содержимое SRT файла.`
              }
            ]
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 180000 // 3 minutes timeout for larger files
      }
    );

    if (onProgress) onProgress(90);

    if (!response.data || !response.data.candidates || !response.data.candidates[0]) {
      throw new Error(`Invalid response from Gemini API: ${JSON.stringify(response.data)}`);
    }

    const candidate = response.data.candidates[0];
    if (!candidate.content || !candidate.content.parts || !candidate.content.parts[0]) {
      throw new Error(`Empty content in Gemini API response: ${JSON.stringify(candidate)}`);
    }

    const srtText = candidate.content.parts[0].text;
    if (!srtText) {
      throw new Error('Gemini API returned empty text');
    }

    log.info('[WhisperService] Gemini API transcription completed successfully');
    
    let cleanSrt = srtText;
    if (cleanSrt.includes('```')) {
      cleanSrt = cleanSrt.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '');
    }
    return cleanSrt.trim();
  }

  async transcribeLocally(wavPath, language, modelName, onProgress) {
    log.info(`[WhisperService] Starting local transcription using @huggingface/transformers. Model: ${modelName}, Language: ${language}`);
    
    if (onProgress) onProgress(10);
    
    const { pipeline, env } = require('@huggingface/transformers');
    
    const fsSync = require('fs');
    let useBundled = false;
    try {
      if (fsSync.existsSync(this.bundledModelsDir)) {
        const contents = fsSync.readdirSync(this.bundledModelsDir);
        if (contents.length > 0) useBundled = true;
      }
    } catch(e) {
      log.error(`[WhisperService] Error checking bundled models in transcribeLocally: ${e.message}`);
    }

    if (useBundled) {
      env.localModelPath = this.bundledModelsDir;
      env.cacheDir = this.bundledModelsDir;
    } else {
      env.localModelPath = this.modelsDir;
      env.cacheDir = this.modelsDir;
    }

    let hfModelName = 'Xenova/whisper-tiny';
    if (modelName === 'base') {
      hfModelName = 'Xenova/whisper-base';
    } else if (modelName === 'small') {
      hfModelName = 'Xenova/whisper-small';
    } else if (modelName === 'medium') {
      hfModelName = 'Xenova/whisper-medium';
    }

    log.info(`[WhisperService] Loading pipeline for ${hfModelName}...`);
    if (onProgress) onProgress(20);

    const transcriber = await pipeline('automatic-speech-recognition', hfModelName, {
      progress_callback: (progress) => {
        if (progress.status === 'progress' && onProgress) {
          const downloadPercent = Math.round(20 + (progress.loaded / progress.total) * 60);
          onProgress(downloadPercent);
        }
      }
    });

    log.info('[WhisperService] Pipeline loaded. Reading and decoding WAV file...');
    if (onProgress) onProgress(80);

    const buffer = await fs.readFile(wavPath);
    let dataOffset = 12;
    while (dataOffset < buffer.length - 8) {
      const chunkId = buffer.toString('ascii', dataOffset, dataOffset + 4);
      const chunkSize = buffer.readUInt32LE(dataOffset + 4);
      if (chunkId === 'data') {
        dataOffset += 8;
        break;
      }
      dataOffset += 8 + chunkSize;
    }
    
    const pcmBuffer = buffer.subarray(dataOffset);
    const float32Array = new Float32Array(pcmBuffer.length / 2);
    for (let i = 0; i < float32Array.length; i++) {
      const int16 = pcmBuffer.readInt16LE(i * 2);
      float32Array[i] = int16 / 32768.0;
    }

    log.info(`[WhisperService] Transcribing audio data (length: ${float32Array.length} samples)...`);
    if (onProgress) onProgress(85);

    const result = await transcriber(float32Array, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
      language: language === 'ja' ? 'japanese' : (language === 'ru' ? 'russian' : language),
      task: 'transcribe'
    });

    log.info('[WhisperService] Transcription completed. Formatting to SRT...');
    if (onProgress) onProgress(95);

    let srtContent = '';
    const chunks = result.chunks || [];
    
    if (chunks.length === 0 && result.text) {
      srtContent = `1\n00:00:01,000 --> 00:00:10,000\n${result.text.trim()}\n\n`;
    } else {
      chunks.forEach((chunk, index) => {
        const start = chunk.timestamp[0] !== null ? chunk.timestamp[0] : 0;
        const end = chunk.timestamp[1] !== null ? chunk.timestamp[1] : start + 2;
        srtContent += `${index + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${chunk.text.trim()}\n\n`;
      });
    }

    return srtContent;
  }
}

module.exports = WhisperService;
