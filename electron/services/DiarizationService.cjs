const path = require('path');
const fs = require('fs/promises');
const log = require('electron-log');
const { app } = require('electron');
const { spawn } = require('child_process');
const { trackProcess } = require('../lib/ProcessTracker.cjs');
const { initSharedOnnx } = require('../lib/onnxConfig.cjs');

// Lazy loading of @huggingface/transformers with onnxruntime-web redirection
let transformersCache = null;

function getTransformers() {
  if (!transformersCache) {
    log.info('[DiarizationService] Loading @huggingface/transformers dynamically...');
    initSharedOnnx();
    transformersCache = require('@huggingface/transformers');
  }
  return transformersCache;
}

class DiarizationService {
  static getInstance(baseDir) {
    if (!DiarizationService.instance) {
      DiarizationService.instance = new DiarizationService(baseDir);
    }
    return DiarizationService.instance;
  }

  constructor(baseDir) {
    this.baseDir = baseDir;
    this.modelsDir = path.join(baseDir, 'models', 'diarization');
    this.bundledModelsDir = process.resourcesPath ? path.join(process.resourcesPath, 'models') : path.join(app.getAppPath(), 'assets', 'models');
    
    log.info('[DiarizationService] Constructor initialization');
    log.info(`[DiarizationService] baseDir: ${baseDir}`);
    log.info(`[DiarizationService] bundledModelsDir: ${this.bundledModelsDir}`);

    getTransformers();
    initSharedOnnx();

    this.processor = null;
    this.model = null;
    this.modelName = 'onnx-community/pyannote-segmentation-3.0';
    this.isLoading = false;
    this.downloadProgress = null;
    this.loadingStatus = 'Ожидание...';
  }

  async ensureFolder() {
    try {
      log.info(`Ensuring diarization models folder exists: ${this.modelsDir}`);
      await fs.mkdir(this.modelsDir, { recursive: true });
    } catch (err) {
      log.error('Failed to create diarization models folder:', err);
    }
  }

  async loadModel(onProgress) {
    if (this.processor && this.model) {
      this.loadingStatus = 'Готово';
      return { processor: this.processor, model: this.model };
    }
    if (this.isLoading) {
      while (this.isLoading) {
        await new Promise(r => setTimeout(r, 100));
      }
      return { processor: this.processor, model: this.model };
    }

    const { AutoProcessor, AutoModelForAudioFrameClassification, env } = getTransformers();

    // Check if bundled models exist
    const fsSync = require('fs');
    let useBundled = false;
    try {
      if (fsSync.existsSync(this.bundledModelsDir)) {
        const contents = fsSync.readdirSync(this.bundledModelsDir);
        log.info(`[DiarizationService] Bundled models dir found. Contents: ${contents.join(', ')}`);
        if (contents.length > 0) useBundled = true;
      }
    } catch(e) {
      log.error(`[DiarizationService] Error checking bundled models: ${e.message}`);
    }

    if (useBundled) {
      log.info('[DiarizationService] Using BUNDLED models path');
      env.localModelPath = this.bundledModelsDir;
      env.cacheDir = this.bundledModelsDir;
    } else {
      log.info('[DiarizationService] Using USER models path:', this.modelsDir);
      env.localModelPath = this.modelsDir;
      env.cacheDir = this.modelsDir;
    }

    this.isLoading = true;
    this.downloadProgress = 0;
    this.loadingStatus = 'Инициализация и запуск загрузки...';
    log.info(`Starting to load diarization models: ${this.modelName}`);

    const downloadStats = new Map();
    const config = {
      progress_callback: (p) => {
        if (p.status === 'initiate') {
          log.info(`[Transformers] Initializing: ${p.file || 'unknown'}`);
          this.loadingStatus = `Запуск скачивания: ${p.file || 'файл'}`;
        } else if (p.status === 'download') {
          this.loadingStatus = `Подключение: ${p.file || 'файл'}...`;
        } else if (p.status === 'done') {
          if (p.file) {
            downloadStats.set(p.file, 100);
            let totalFiles = downloadStats.size;
            let sumProgress = 0;
            for (const prog of downloadStats.values()) {
              sumProgress += prog;
            }
            this.downloadProgress = Math.round(totalFiles > 0 ? sumProgress / totalFiles : 0);
            this.loadingStatus = `Скачивание: файл ${p.file} сохранен (${this.downloadProgress}%)`;
            if (onProgress) onProgress(this.downloadProgress);
          }
        } else if (p.status === 'progress' && p.file) {
          downloadStats.set(p.file, p.progress || 0);
          let totalFiles = downloadStats.size;
          let sumProgress = 0;
          for (const prog of downloadStats.values()) {
            sumProgress += prog;
          }
          this.downloadProgress = Math.round(totalFiles > 0 ? sumProgress / totalFiles : 0);
          this.loadingStatus = `Скачивание: ${this.downloadProgress}% [${p.file}: ${Math.round(p.progress)}%]`;
          if (onProgress) onProgress(this.downloadProgress);
        }
      }
    };

    try {
      this.loadingStatus = 'Запуск OnnxRuntime ядра и компиляция pyannote-segmentation-3.0...';
      log.info(`[DiarizationService] Attempting to load processor and model: ${this.modelName}`);
      
      this.processor = await AutoProcessor.from_pretrained(this.modelName, {
        ...config,
        device: 'cpu'
      });
      this.model = await AutoModelForAudioFrameClassification.from_pretrained(this.modelName, {
        ...config,
        device: 'cpu'
      });
      
      this.downloadProgress = 100;
      this.loadingStatus = 'Готово';
      log.info(`Model ${this.modelName} loaded successfully.`);
      return { processor: this.processor, model: this.model };
    } catch (err) {
      log.error(`Failed to load ${this.modelName} via primary host:`, err);
      if (env.remoteHost === 'https://hf-mirror.com') {
        try {
          this.loadingStatus = 'Переподключение к основному репозиторию HF...';
          env.remoteHost = 'https://huggingface.co';
          this.processor = await AutoProcessor.from_pretrained(this.modelName, {
            ...config,
            device: 'cpu'
          });
          this.model = await AutoModelForAudioFrameClassification.from_pretrained(this.modelName, {
            ...config,
            device: 'cpu'
          });
          this.downloadProgress = 100;
          this.loadingStatus = 'Готово';
          return { processor: this.processor, model: this.model };
        } catch (retryErr) {
          log.error(`Retry failed:`, retryErr);
          this.downloadProgress = null;
          this.loadingStatus = `Ошибка загрузки: ${retryErr.message}`;
          throw retryErr;
        }
      }
      this.downloadProgress = null;
      this.loadingStatus = `Ошибка: ${err.message}`;
      throw err;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Extract video audio as Float32Array
   */
  async extractAudio(videoPath, samplingRate = 16000, onProgress) {
    return new Promise((resolve, reject) => {
      log.info(`Extracting ${samplingRate}Hz mono audio from: ${videoPath}`);
      if (onProgress) onProgress(`Запуск извлечения аудио дорожки (${samplingRate} Гц)...`);
      
      const ffmpeg = spawn('ffmpeg', [
        '-i', videoPath,
        '-vn',
        '-f', 's16le',
        '-acodec', 'pcm_s16le',
        '-ar', String(samplingRate),
        '-ac', '1',
        '-'
      ]);
      trackProcess(ffmpeg);

      const chunks = [];
      
      ffmpeg.stdout.on('data', (chunk) => {
        chunks.push(chunk);
      });

      ffmpeg.stderr.on('data', (data) => {
        // Can read ffmpeg stderr if needed
      });

      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`ffmpeg exited with code ${code}`));
          return;
        }
        
        try {
          if (onProgress) onProgress('Декодирование PCM буфера...');
          const buffer = Buffer.concat(chunks);
          const float32samples = new Float32Array(buffer.length / 2);
          for (let i = 0; i < float32samples.length; i++) {
            const int16 = buffer.readInt16LE(i * 2);
            float32samples[i] = int16 / 32768.0;
          }
          log.info(`Extracted ${float32samples.length} audio samples successfully.`);
          resolve(float32samples);
        } catch (err) {
          reject(err);
        }
      });

      ffmpeg.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Perform Speaker Diarization using pyannote-segmentation-3.0
   */
  async diarize(videoPath, subtitleLines, expectedSpeakersCount, onStepProgress) {
    if (!videoPath) throw new Error('Missing video path');
    if (!subtitleLines || subtitleLines.length === 0) throw new Error('Missing subtitle lines');

    log.info(`Starting diarization process: Lines=${subtitleLines.length}`);

    // Step 1: Ensure model and processor are loaded
    if (onStepProgress) {
      onStepProgress({ step: 1, totalSteps: 4, message: 'Загрузка модели pyannote-segmentation-3.0 в память...' });
    }
    await this.loadModel();

    const samplingRate = (this.processor && this.processor.feature_extractor && this.processor.feature_extractor.config && this.processor.feature_extractor.config.sampling_rate) || 16000;
    log.info(`[DiarizationService] Selected model sampling rate: ${samplingRate} Hz`);

    // Step 2: Extract whole raw audio
    if (onStepProgress) {
      onStepProgress({ step: 2, totalSteps: 4, message: 'Декодирование и извлечение звуковой дорожки серии...' });
    }
    const fullAudio = await this.extractAudio(videoPath, samplingRate);

    // Step 3: Run audio through processor
    if (onStepProgress) {
      onStepProgress({ step: 3, totalSteps: 4, message: 'Предобработка аудио-сигнала...' });
    }
    log.info('[DiarizationService] Passing audio array to processor...');
    const inputs = await this.processor(fullAudio);

    // Step 4: Inference on model
    if (onStepProgress) {
      onStepProgress({ step: 4, totalSteps: 4, message: 'Распознавание и сегментация голосов (инференс)...' });
    }
    log.info('[DiarizationService] Running Model inference...');
    const { logits } = await this.model(inputs);

    // Step 5: Post-processing built-in to the Pyannote Processor
    log.info('[DiarizationService] Running built-in speaker diarization post-processing...');
    const diarizationResult = this.processor.post_process_speaker_diarization(logits, fullAudio.length)[0];
    
    log.info(`[DiarizationService] Diarization post-processing returned ${diarizationResult?.length || 0} segments.`);

    // Step 6: Map speakers to subtitle intervals using optimized binary search and early-exits
    log.info('[DiarizationService] Mapping speaker labels to subtitles based on optimized interval intersection...');
    const speakerMapping = {}; // lineId -> speaker name
    const uniqueSpeakerIds = new Set();

    // Ensure segments are sorted by start time to allow binary search & early exits
    const sortedSegs = [...(diarizationResult || [])].sort((a, b) => Number(a.start) - Number(b.start));

    // Helper to find index of the first segment that could possibly overlap (ends after targetTime)
    const findFirstPossibleSegmentIdx = (segs, targetTime) => {
      let low = 0;
      let high = segs.length - 1;
      let result = segs.length;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (Number(segs[mid].end) > targetTime) {
          result = mid;
          high = mid - 1; // Try to find an earlier matching index
        } else {
          low = mid + 1;
        }
      }
      return result;
    };

    const parseTimeToSeconds = (timeStr) => {
      if (!timeStr) return 0;
      const parts = timeStr.toString().split(':');
      if (parts.length < 3) {
        const floatVal = parseFloat(timeStr);
        return isNaN(floatVal) ? 0 : floatVal;
      }
      const hrs = parseFloat(parts[0]);
      const mins = parseFloat(parts[1]);
      const secs = parseFloat(parts[2].replace(',', '.')); // support ASS and SRT delimiters
      return hrs * 3600 + mins * 60 + secs;
    };

    for (const line of subtitleLines) {
      let lineStart = Number(line.startSec);
      let lineEnd = Number(line.endSec);
      
      if (isNaN(lineStart) || line.startSec === undefined) {
        lineStart = parseTimeToSeconds(line.start);
      }
      if (isNaN(lineEnd) || line.endSec === undefined) {
        lineEnd = parseTimeToSeconds(line.end);
      }
      if (isNaN(lineStart) || isNaN(lineEnd)) continue;

      let speakerOverlapTally = {};
      let bestSpeakerId = null;
      let maxIntersectionTotal = 0;

      // Find first segment ending after lineStart
      const firstIdx = findFirstPossibleSegmentIdx(sortedSegs, lineStart);

      for (let i = firstIdx; i < sortedSegs.length; i++) {
        const seg = sortedSegs[i];
        const segStart = Number(seg.start);
        
        // Since sortedSegs is sorted by start time, any segment where start >= lineEnd can't overlap,
        // and neither can any subsequent segments. We can break early!
        if (segStart >= lineEnd) {
          break;
        }

        const segEnd = Number(seg.end);
        const segId = seg.id !== undefined ? seg.id : seg.label;

        const overlapStart = Math.max(lineStart, segStart);
        const overlapEnd = Math.min(lineEnd, segEnd);
        const intersection = Math.max(0, overlapEnd - overlapStart);

        if (intersection > 0) {
          speakerOverlapTally[segId] = (speakerOverlapTally[segId] || 0) + intersection;
        }
      }

      for (const segId in speakerOverlapTally) {
        if (speakerOverlapTally[segId] > maxIntersectionTotal) {
          maxIntersectionTotal = speakerOverlapTally[segId];
          bestSpeakerId = isNaN(Number(segId)) ? segId : Number(segId);
        }
      }

      // Fallback: If no direct overlap (silent or gap region), assign the closest speaker around firstIdx
      if (bestSpeakerId === null && sortedSegs.length > 0) {
        const lineCenter = (lineStart + lineEnd) / 2;
        let minDistance = Infinity;

        // Check segments immediately before and after the insertion index
        const candidates = [firstIdx - 1, firstIdx, firstIdx + 1];
        for (const idx of candidates) {
          if (idx >= 0 && idx < sortedSegs.length) {
            const seg = sortedSegs[idx];
            const segStart = Number(seg.start);
            const segEnd = Number(seg.end);
            const segId = seg.id !== undefined ? seg.id : seg.label;
            const segCenter = (segStart + segEnd) / 2;
            const distance = Math.abs(lineCenter - segCenter);
            if (distance < minDistance) {
              minDistance = distance;
              bestSpeakerId = segId;
            }
          }
        }
      }

      if (bestSpeakerId !== null) {
        uniqueSpeakerIds.add(bestSpeakerId);

        let speakerNum = 1;
        if (typeof bestSpeakerId === 'number') {
          speakerNum = bestSpeakerId + 1;
        } else {
          const matches = String(bestSpeakerId).match(/\d+/);
          if (matches) {
            speakerNum = parseInt(matches[0], 10) + 1;
          } else {
            speakerNum = bestSpeakerId;
          }
        }

        const speakerName = (typeof speakerNum === 'number') ? `Speaker ${speakerNum}` : speakerNum;
        speakerMapping[line.id] = speakerName;
      }
    }

    // In case no lines were mapped, set a safe default
    if (Object.keys(speakerMapping).length === 0) {
      log.warn('[DiarizationService] No speakers mapped, falling back to default mapping of Speaker 1');
      for (const line of subtitleLines) {
        speakerMapping[line.id] = 'Speaker 1';
      }
    }

    const detectedSpeakersCount = uniqueSpeakerIds.size || 1;
    log.info(`Diarization successfully completed! Mapped ${Object.keys(speakerMapping).length} lines. Detected unique speakers: ${detectedSpeakersCount}`);

    return {
      speakerMapping,
      detectedSpeakersCount
    };
  }
}

module.exports = DiarizationService;
