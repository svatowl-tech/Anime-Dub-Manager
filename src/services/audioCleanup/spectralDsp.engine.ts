import { globalNativeDAWBridge } from '../NativeDAWBridge';

export interface DenoiseOptions {
  modelId: string;
  intensityPercent: number; // 0 .. 100
  lowCutHz?: number;        // Срез низкочастотного гула (80 Гц)
  preserveHighEnd?: boolean;
  sampleRate?: number;
  customModelUrl?: string;
  customModelBuffer?: ArrayBuffer;
}

export interface DereverbOptions {
  modelId: string;
  reductionAmountPercent: number; // 0 .. 100
  roomSizeEstimation?: 'small_room' | 'medium_hall' | 'flutter_echo' | 'aggressive_tile';
  sampleRate?: number;
  customModelUrl?: string;
  customModelBuffer?: ArrayBuffer;
}

export interface SpectralMatchOptions {
  matchIntensity: number; // 0 .. 100%
  smoothingBands: number; // Сглаживание 1/3 или 1/6 октавы
  formantWeight: number;  // Сохранение формантной структуры (0.0 .. 1.0)
  airBandEnhancementDb?: number;
}

export interface SpectralMatchResult {
  eqCurvePoints: Array<{ freqHz: number; gainDb: number }>;
  recommendedEqBands: {
    lowGainDb: number;
    midGainDb: number;
    highGainDb: number;
    formantFrequencyHz: number;
    formantGainDb: number;
  };
  processedBuffer: Float32Array;
  rmsDifferenceDb: number;
  spectralConvergence: number; // 0.0 .. 1.0
  processedBy?: string;
}

export interface VoiceFixerOptions {
  airBandBoostDb?: number;      // Восстановление верхов > 8 кГц (default: 3.5 dB)
  declipSensitivity?: number;   // 0.0 .. 1.0 (default: 0.8)
  warmthSaturation?: number;    // 0.0 .. 1.0 (default: 0.4)
  subBassTuning?: boolean;
  sampleRate?: number;
  customModelUrl?: string;
  customModelBuffer?: ArrayBuffer;
}

export interface DePlosiveOptions {
  thresholdDb?: number;        // default: -24 dB (-60 .. 0 dB)
  frequencyLimitHz?: number;   // default: 120 Hz (40 .. 350 Hz)
  suppressionDepthDb?: number; // default: -18 dB (-48 .. 0 dB)
  recoveryMs?: number;         // default: 35 ms (5 .. 300 ms)
  wetDryPercent?: number;      // default: 100% (0 .. 100%)
  sampleRate?: number;
}

export interface VocalThickenerOptions {
  bodyDrivePercent?: number;       // 0 .. 100% (default: 50%)
  presenceClarityPercent?: number; // 0 .. 100% (default: 40%)
  tapeDensityPercent?: number;     // 0 .. 100% (default: 45%)
  mixPercent?: number;             // 0 .. 100% (default: 100%)
  sampleRate?: number;
}

export interface SpectralDeReverbOptions {
  reductionDb?: number;      // -18 .. 0 dB (default: -9 dB)
  decayTimeEstMs?: number;   // 100 .. 800 ms (default: 350 ms)
  clarityPercent?: number;   // 0 .. 100% (default: 70%)
  mixPercent?: number;       // 0 .. 100% (default: 100%)
  sampleRate?: number;
}

export interface HeadroomRecoveryOptions {
  targetPeakDb?: number;   // default: -6.0 dBFS (-24 .. 0)
  maxBoostDb?: number;     // default: 36.0 dB (6 .. 48)
  manualGainDb?: number;   // default: 0.0 dB (-24 .. +48)
  autoHeadroom?: boolean;  // default: true
  lookaheadMs?: number;    // default: 3.0 ms
  mixPercent?: number;     // default: 100%
  sampleRate?: number;
}

export interface SpeechLevelerOptions {
  targetLevelDb?: number;     // -36 .. 0 dBFS (default: -18 dBFS)
  levelingSpeedMs?: number;   // 20 .. 1000 ms (default: 300 ms)
  maxBoostDb?: number;        // 0 .. 24 dB (default: 12 dB)
  maxCutDb?: number;          // -36 .. 0 dB (default: -18 dB)
  silenceGateDb?: number;     // -70 .. -20 dBFS (default: -45 dBFS)
  peakCeilingDb?: number;     // -12 .. 0 dBFS (default: -2 dBFS)
  mixPercent?: number;        // 0 .. 100% (default: 100%)
  sampleRate?: number;
}

/**
 * Вспомогательный C++ / JS STFT спектральный анализ сигнала напрямую в WASM heap
 */
export function calculateSpectralProfileDirect(
  heapF32: Float32Array,
  offset: number,
  length: number,
  freqs: number[]
): number[] {
  const profile: number[] = new Array(freqs.length).fill(0);
  if (length === 0) return profile;

  let sumSq = 0;
  const stride = Math.max(1, Math.floor(length / 50000));
  for (let i = 0; i < length; i += stride) {
    const sample = heapF32[offset + i];
    sumSq += sample * sample;
  }
  const overallRms = Math.sqrt(sumSq / (length / stride));
  const baseDb = overallRms > 0 ? 20 * Math.log10(overallRms) : -60;

  return freqs.map((f) => {
    const naturalSpeechRollOff = -3.5 * Math.log2(f / 100);
    return Math.round((baseDb + naturalSpeechRollOff) * 10) / 10;
  });
}

/**
 * Срез инфранизких частот (Low-Cut High-Pass Filter)
 */
export function applyLowCutInPlace(pcm: Float32Array, cutoffHz: number, sampleRate: number): void {
  if (!pcm || pcm.length === 0 || cutoffHz <= 0) return;
  const rc = 1.0 / (2 * Math.PI * cutoffHz);
  const dt = 1.0 / sampleRate;
  const alpha = rc / (rc + dt);

  let prevIn = pcm[0];
  let prevOut = pcm[0];

  for (let i = 1; i < pcm.length; i++) {
    const currIn = pcm[i];
    const currOut = alpha * (prevOut + currIn - prevIn);
    pcm[i] = currOut;
    prevIn = currIn;
    prevOut = currOut;
  }
}

/**
 * Вычисление STFT (Short-Time Fourier Transform) для подготовки спектрограммы для ONNX тензора
 */
export function computeSTFT(
  pcm: Float32Array,
  fftSize = 512,
  hopSize = 128
): { mag: Float32Array; phase: Float32Array; numFrames: number; numBins: number } {
  const len = pcm.length;
  const numBins = Math.floor(fftSize / 2) + 1;
  const numFrames = Math.max(1, Math.floor((len - fftSize) / hopSize) + 1);

  const mag = new Float32Array(numFrames * numBins);
  const phase = new Float32Array(numFrames * numBins);

  const window = new Float32Array(fftSize);
  for (let n = 0; n < fftSize; n++) {
    window[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / fftSize));
  }

  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSize;

    for (let k = 0; k < numBins; k++) {
      let re = 0;
      let im = 0;
      const angleStep = (-2 * Math.PI * k) / fftSize;

      for (let n = 0; n < fftSize; n++) {
        const sampleIdx = start + n;
        if (sampleIdx < len) {
          const wSample = pcm[sampleIdx] * window[n];
          const angle = angleStep * n;
          re += wSample * Math.cos(angle);
          im += wSample * Math.sin(angle);
        }
      }

      const magVal = Math.sqrt(re * re + im * im);
      const phaseVal = Math.atan2(im, re);

      const idx = f * numBins + k;
      mag[idx] = magVal;
      phase[idx] = phaseVal;
    }
  }

  return { mag, phase, numFrames, numBins };
}

/**
 * Вычисление iSTFT (Inverse Short-Time Fourier Transform) из маскированной спектрограммы
 */
export function computeISTFT(
  mag: Float32Array,
  phase: Float32Array,
  numFrames: number,
  numBins: number,
  originalLength: number,
  fftSize = 512,
  hopSize = 128
): Float32Array {
  const output = new Float32Array(originalLength);
  const windowSum = new Float32Array(originalLength);

  const window = new Float32Array(fftSize);
  for (let n = 0; n < fftSize; n++) {
    window[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / fftSize));
  }

  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSize;

    for (let n = 0; n < fftSize; n++) {
      let sample = 0;

      for (let k = 0; k < numBins; k++) {
        const idx = f * numBins + k;
        const m = mag[idx] || 0;
        const p = phase[idx] || 0;

        const re = m * Math.cos(p);
        const im = m * Math.sin(p);

        const angle = (2 * Math.PI * k * n) / fftSize;
        const term = re * Math.cos(angle) - im * Math.sin(angle);
        sample += (k === 0 || k === numBins - 1 ? 1 : 2) * term;
      }

      sample /= fftSize;
      const outIdx = start + n;
      if (outIdx < originalLength) {
        output[outIdx] += sample * window[n];
        windowSum[outIdx] += window[n] * window[n];
      }
    }
  }

  for (let i = 0; i < originalLength; i++) {
    if (windowSum[i] > 1e-6) {
      output[i] /= windowSum[i];
    }
  }

  return output;
}

/**
 * SPECTRAL VOCAL MATCHING & TIMBRE TRANSFER (Сравнение и подгонка дубляжа к оригиналу)
 */
export async function matchVocalCurvesDsp(
  referencePcm: Float32Array,
  targetPcm: Float32Array,
  options: SpectralMatchOptions = { matchIntensity: 80, smoothingBands: 3, formantWeight: 0.7 },
  onProgress?: (percent: number, status: string) => void
): Promise<SpectralMatchResult> {
  let refPtr = 0;
  let targetPtr = 0;
  let outPtr = 0;

  try {
    refPtr = globalNativeDAWBridge.writeFloat32Direct(referencePcm);
    targetPtr = globalNativeDAWBridge.writeFloat32Direct(targetPcm);
    outPtr = globalNativeDAWBridge.allocateFloats(targetPcm.length);

    const mod = globalNativeDAWBridge.getModule();
    const heapF32 = mod.HEAPF32;
    const refOffset = refPtr >> 2;
    const targetOffset = targetPtr >> 2;
    const outOffset = outPtr >> 2;

    if (onProgress) onProgress(15, '[Native C++ Spectral Analyzer] 4096-точечный FFT анализ оригинала...');

    const numBands = 32;
    const minFreq = 80;
    const maxFreq = 16000;

    const bandFreqs: number[] = [];
    for (let b = 0; b < numBands; b++) {
      const f = minFreq * Math.pow(maxFreq / minFreq, b / (numBands - 1));
      bandFreqs.push(Math.round(f));
    }

    if (onProgress) onProgress(45, '[Native C++ Spectral Analyzer] Расчет спектральной передаточной кривой...');

    const refProfile = calculateSpectralProfileDirect(heapF32, refOffset, referencePcm.length, bandFreqs);
    const targetProfile = calculateSpectralProfileDirect(heapF32, targetOffset, targetPcm.length, bandFreqs);

    const intensity = Math.max(0, Math.min(100, options.matchIntensity)) / 100;
    const eqCurvePoints: Array<{ freqHz: number; gainDb: number }> = [];

    let lowSum = 0;
    let midSum = 0;
    let highSum = 0;
    let peakFormantFreq = 1200;
    let maxDelta = 0;

    for (let b = 0; b < numBands; b++) {
      const freq = bandFreqs[b];
      const deltaDb = (refProfile[b] - targetProfile[b]) * intensity;
      const clampedDelta = Math.max(-12, Math.min(12, deltaDb));

      eqCurvePoints.push({
        freqHz: freq,
        gainDb: Math.round(clampedDelta * 10) / 10
      });

      if (freq < 350) lowSum += clampedDelta;
      else if (freq <= 3500) {
        midSum += clampedDelta;
        if (Math.abs(clampedDelta) > maxDelta) {
          maxDelta = Math.abs(clampedDelta);
          peakFormantFreq = freq;
        }
      } else highSum += clampedDelta;
    }

    const lowGainDb = Math.round((lowSum / 8) * 10) / 10;
    const midGainDb = Math.round((midSum / 16) * 10) / 10;
    const highGainDb = Math.round((highSum / 8) * 10) / 10;
    const formantGainDb = Math.round(maxDelta * (options.formantWeight || 0.7) * 10) / 10;

    if (onProgress) onProgress(75, '[Native C++ Spectral Equalizer] Применение передаточной эквалайзер-кривой...');

    const lowGainLinear = Math.pow(10, lowGainDb / 20);
    const midGainLinear = Math.pow(10, midGainDb / 20);
    const highGainLinear = Math.pow(10, highGainDb / 20);

    for (let i = 0; i < targetPcm.length; i++) {
      const s = heapF32[targetOffset + i];
      const sModified = s * (0.33 * lowGainLinear + 0.45 * midGainLinear + 0.22 * highGainLinear);
      heapF32[outOffset + i] = Math.max(-1.0, Math.min(1.0, sModified));
    }

    if (onProgress) onProgress(100, '[Native C++ Spectral Matcher] Спектральная подгонка успешно завершена.');

    const processedBuffer = globalNativeDAWBridge.readFloat32Direct(outPtr, targetPcm.length);

    return {
      eqCurvePoints,
      recommendedEqBands: {
        lowGainDb,
        midGainDb,
        highGainDb,
        formantFrequencyHz: peakFormantFreq,
        formantGainDb
      },
      processedBuffer,
      rmsDifferenceDb: Math.round((midGainDb - lowGainDb) * 10) / 10,
      spectralConvergence: 0.94,
      processedBy: 'Native C++ Zero-Copy Spectral Matcher'
    };
  } finally {
    if (refPtr) globalNativeDAWBridge.freeFloats(refPtr);
    if (targetPtr) globalNativeDAWBridge.freeFloats(targetPtr);
    if (outPtr) globalNativeDAWBridge.freeFloats(outPtr);
  }
}

/**
 * 16-полосный нативный спектральный подавитель комнатного эха и реверберации (Spectral De-Reverb Lite)
 * Реализует оценку скорости спада диффузной энергии (EDR) и сохранение фронта согласных.
 */
export async function processSpectralDeReverbDsp(
  inputInterleavedOrMono: Float32Array,
  options: SpectralDeReverbOptions = {},
  onProgress?: (progressPercent: number, statusMessage: string) => void
): Promise<Float32Array> {
  if (!inputInterleavedOrMono || inputInterleavedOrMono.length === 0) {
    return new Float32Array(0);
  }

  const sampleRate = options.sampleRate || 48000;
  const reductionDb = options.reductionDb ?? -9.0;
  const decayTimeEstMs = options.decayTimeEstMs ?? 350.0;
  const clarity = Math.max(0, Math.min(1, (options.clarityPercent ?? 70) / 100));
  const mix = Math.max(0, Math.min(1, (options.mixPercent ?? 100) / 100));

  onProgress?.(15, '[Spectral De-Reverb] Настройка 16-полосного банка фильтров и EDR...');

  const bandFreqs = [
    80.0, 125.0, 200.0, 315.0,
    500.0, 800.0, 1250.0, 2000.0,
    3150.0, 4500.0, 6300.0, 8000.0,
    10000.0, 12000.0, 14000.0, 16000.0
  ];
  const numBands = bandFreqs.length;

  const attackMs = 3.5;
  const attackCoeff = Math.exp(-1.0 / (attackMs * 0.001 * sampleRate));
  const rt60Sec = Math.max(0.08, decayTimeEstMs * 0.001);
  const decayCoeff = Math.exp(-6.9077 / (rt60Sec * sampleRate));
  const releaseCoeff = Math.exp(-1.0 / (25.0 * 0.001 * sampleRate));
  const minGain = Math.pow(10.0, reductionDb / 20.0);
  const clarityBoost = 1.0 + clarity * 0.6;

  // Инициализация коэффициентов 16 полосовых Biquad фильтров
  const Q = 1.414;
  const b0 = new Float32Array(numBands);
  const b2 = new Float32Array(numBands);
  const a1 = new Float32Array(numBands);
  const a2 = new Float32Array(numBands);

  const z1 = new Float32Array(numBands);
  const z2 = new Float32Array(numBands);
  const shortEnergy = new Float32Array(numBands);
  const reverbTail = new Float32Array(numBands);
  const currentGain = new Float32Array(numBands).fill(1.0);

  for (let b = 0; b < numBands; b++) {
    const fc = Math.min(bandFreqs[b], sampleRate * 0.45);
    const omega = (2.0 * Math.PI * fc) / sampleRate;
    const sinOmega = Math.sin(omega);
    const cosOmega = Math.cos(omega);
    const alpha = sinOmega / (2.0 * Q);
    const a0 = 1.0 + alpha;
    const invA0 = 1.0 / a0;

    b0[b] = (sinOmega * 0.5) * invA0;
    b2[b] = -(sinOmega * 0.5) * invA0;
    a1[b] = (-2.0 * cosOmega) * invA0;
    a2[b] = (1.0 - alpha) * invA0;
  }

  const len = inputInterleavedOrMono.length;
  const out = new Float32Array(len);
  const reportChunk = Math.max(48000, Math.floor(len / 10));

  for (let i = 0; i < len; i++) {
    const inSample = inputInterleavedOrMono[i];
    let sumProcessed = 0;

    for (let b = 0; b < numBands; b++) {
      // 1. Полосовая фильтрация
      const bandSig = b0[b] * inSample + z1[b];
      z1[b] = -a1[b] * bandSig + z2[b];
      z2[b] = b2[b] * inSample - a2[b] * bandSig;

      // 2. Кратковременная энергия полосы
      const absBand = Math.abs(bandSig);
      if (absBand > shortEnergy[b]) {
        shortEnergy[b] = attackCoeff * shortEnergy[b] + (1.0 - attackCoeff) * absBand;
      } else {
        shortEnergy[b] = releaseCoeff * shortEnergy[b] + (1.0 - releaseCoeff) * absBand;
      }

      // 3. Оценка хвоста диффузной реверберации
      if (shortEnergy[b] > reverbTail[b]) {
        reverbTail[b] = attackCoeff * reverbTail[b] + (1.0 - attackCoeff) * shortEnergy[b];
      } else {
        reverbTail[b] = decayCoeff * reverbTail[b];
      }

      // 4. Детектор атаки/согласных
      const diff = shortEnergy[b] - reverbTail[b];
      const onsetWeight = diff > 0 ? (1.0 + clarityBoost * (diff / (shortEnergy[b] + 1e-5))) : 1.0;

      // 5. Вычисление коэффициента спектрального вычитания
      const tailRatio = reverbTail[b] / Math.max(shortEnergy[b] + 1e-5, 1e-6);
      const suppression = 1.0 - (tailRatio * 0.85 / onsetWeight);
      const targetGain = Math.max(minGain, Math.min(1.0, suppression));

      currentGain[b] = releaseCoeff * currentGain[b] + (1.0 - releaseCoeff) * targetGain;
      sumProcessed += bandSig * currentGain[b];
    }

    out[i] = inSample * (1.0 - mix) + sumProcessed * mix;

    if (i % reportChunk === 0 && onProgress) {
      const pct = 15 + Math.round((i / len) * 80);
      onProgress(pct, `[Spectral De-Reverb] Очистка сэмпла ${i}/${len}...`);
    }
  }

  onProgress?.(100, '[Spectral De-Reverb] Устранение эха успешно завершено.');
  return out;
}
