import { ipcSafe } from '../ipcSafe';

export interface NormalizationMetrics {
  gain: number; // Multiplier (e.g. 1.0 = 0dB, 1.41 = +3dB, 0.7 = -3dB)
  gainDb: number; // Decibels adjustment (+X.X dB / -X.X dB)
  peak: number; // Maximum amplitude (0..1)
  peakDb: number; // Peak in dBFS
  rms: number; // Active speech RMS (0..1)
  rmsDb: number; // Speech RMS in dBFS
  status: 'idle' | 'analyzing' | 'ready' | 'error';
  error?: string;
}

const normalizationCache = new Map<string, NormalizationMetrics>();
const inFlightAnalysis = new Map<string, Promise<NormalizationMetrics>>();
const SESSION_NORM_CACHE_KEY = 'qa_norm_metrics_cache_v1';

// Hydrate normalization cache from sessionStorage on module load
try {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    const raw = window.sessionStorage.getItem(SESSION_NORM_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, NormalizationMetrics>;
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          if (v && v.status === 'ready') {
            normalizationCache.set(k, v);
          }
        }
      }
    }
  }
} catch (e) {
  // Ignore sessionStorage hydration errors
}

function persistNormMetricToSession(key: string, metrics: NormalizationMetrics): void {
  if (metrics.status !== 'ready') return;
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const obj: Record<string, NormalizationMetrics> = {};
      let count = 0;
      for (const [k, v] of normalizationCache.entries()) {
        if (v.status === 'ready') {
          obj[k] = v;
          count++;
          if (count >= 150) break;
        }
      }
      obj[key] = metrics;
      window.sessionStorage.setItem(SESSION_NORM_CACHE_KEY, JSON.stringify(obj));
    }
  } catch (e) {
    // Ignore storage quota errors
  }
}

// Concurrency limiter for backend audio-get-track-analysis calls (max 2 parallel jobs)
const MAX_CONCURRENT_IPC_ANALYSIS = 2;
let activeIpcAnalysisCount = 0;
const ipcAnalysisQueue: Array<() => void> = [];

async function runWithIpcSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeIpcAnalysisCount >= MAX_CONCURRENT_IPC_ANALYSIS) {
    await new Promise<void>(resolve => ipcAnalysisQueue.push(resolve));
  }
  activeIpcAnalysisCount++;
  try {
    return await task();
  } finally {
    activeIpcAnalysisCount--;
    const next = ipcAnalysisQueue.shift();
    if (next) next();
  }
}

// Target parameters for comfortable voiceover QA listening
const TARGET_SPEECH_RMS = 0.125; // ~ -18 dBFS (standard dialogue target)
const TARGET_MAX_PEAK = 0.92;    // ~ -0.7 dBFS (prevents digital clipping)
const MAX_BOOST_GAIN = 31.62;     // Max +30 dB boost
const MIN_CUT_GAIN = 0.0316;      // Max -30 dB cut

/**
 * Decodes audio from an URL / file path and analyzes peak & speech RMS to compute optimal preview gain.
 */
export async function analyzeAudioForPreview(
  audioUrl: string,
  cacheKey?: string,
  filePath?: string
): Promise<NormalizationMetrics> {
  const key = cacheKey || filePath || audioUrl;
  const pathKey = filePath ? `path:${filePath}` : key;
  
  if (normalizationCache.has(key)) {
    const cached = normalizationCache.get(key)!;
    if (cached.status === 'ready') {
      return cached;
    }
  }
  if (normalizationCache.has(pathKey)) {
    const cachedByPath = normalizationCache.get(pathKey)!;
    if (cachedByPath.status === 'ready') {
      normalizationCache.set(key, cachedByPath);
      return cachedByPath;
    }
  }

  const existingInFlight = inFlightAnalysis.get(pathKey) || inFlightAnalysis.get(key);
  if (existingInFlight) {
    return existingInFlight;
  }

  const initialMetrics: NormalizationMetrics = {
    gain: 1.0,
    gainDb: 0,
    peak: 1.0,
    peakDb: 0,
    rms: 0.125,
    rmsDb: -18,
    status: 'analyzing',
  };
  normalizationCache.set(key, initialMetrics);

  const analysisPromise = (async (): Promise<NormalizationMetrics> => {
    // Strategy 1: Try fast IPC sidecar analysis via backend FFmpeg (throttled & deduplicated)
    const rawPath = filePath || (audioUrl.startsWith('file://') ? audioUrl.replace(/^file:\/\//, '') : null);
    if (rawPath && typeof window !== 'undefined' && (window as any).electronAPI) {
      try {
        const analysis: any = await runWithIpcSlot(() =>
          ipcSafe.invoke('audio-get-track-analysis', {
            audioPath: rawPath,
            options: { skipWhisper: true }
          })
        );

        if (analysis && analysis.energyProfile) {
          const { speechRmsDb, peakDb: profilePeakDb } = analysis.energyProfile;
          const rmsDbVal = typeof speechRmsDb === 'number' ? speechRmsDb : -18;
          const peakDbVal = typeof profilePeakDb === 'number' ? profilePeakDb : 0;

          const activeRms = Math.pow(10, rmsDbVal / 20);
          const globalMaxPeak = Math.pow(10, peakDbVal / 20);

          let computedGain = TARGET_SPEECH_RMS / Math.max(0.01, activeRms);
          if (globalMaxPeak * computedGain > TARGET_MAX_PEAK) {
            computedGain = TARGET_MAX_PEAK / Math.max(0.001, globalMaxPeak);
          }
          computedGain = Math.max(MIN_CUT_GAIN, Math.min(MAX_BOOST_GAIN, computedGain));

          const gainDb = Math.round((20 * Math.log10(computedGain)) * 10) / 10;
          const result: NormalizationMetrics = {
            gain: computedGain,
            gainDb,
            peak: globalMaxPeak,
            peakDb: Math.round(peakDbVal * 10) / 10,
            rms: activeRms,
            rmsDb: Math.round(rmsDbVal * 10) / 10,
            status: 'ready',
          };

          normalizationCache.set(key, result);
          normalizationCache.set(pathKey, result);
          persistNormMetricToSession(key, result);
          persistNormMetricToSession(pathKey, result);
          return result;
        }
      } catch (ipcErr) {
        // Fallback to Web Audio if IPC analysis unavailable
      }
    }

    // Strategy 2: Web Audio API decoding fallback with timeout & safety limits
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const response = await fetch(audioUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to fetch audio: ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) {
        throw new Error('Web Audio API not supported');
      }

      const tempCtx = new AudioCtx();
      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
      } finally {
        if (tempCtx.state !== 'closed') {
          tempCtx.close().catch(() => {});
        }
      }

      if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function') {
        return {
          gain: 1.0,
          gainDb: 0,
          peak: 0.5,
          peakDb: -6,
          rms: 0.1,
          rmsDb: -20,
          status: 'ready'
        };
      }

      const numChannels = audioBuffer.numberOfChannels;
      const length = audioBuffer.length;
      
      let globalMaxPeak = 0.0001;
      let sumSquaresActive = 0;
      let activeSampleCount = 0;
      
      const voiceThreshold = 0.0056;
      const step = length > 500000 ? Math.ceil(length / 250000) : 1;

      for (let c = 0; c < numChannels; c++) {
        const channelData = audioBuffer.getChannelData(c);
        for (let i = 0; i < length; i += step) {
          const absVal = Math.abs(channelData[i]);
          if (absVal > globalMaxPeak) {
            globalMaxPeak = absVal;
          }
          if (absVal >= voiceThreshold) {
            sumSquaresActive += absVal * absVal;
            activeSampleCount++;
          }
        }
      }

      const activeRms = activeSampleCount > 0
        ? Math.sqrt(sumSquaresActive / activeSampleCount)
        : globalMaxPeak * 0.5;

      let computedGain = TARGET_SPEECH_RMS / Math.max(0.01, activeRms);
      if (globalMaxPeak * computedGain > TARGET_MAX_PEAK) {
        computedGain = TARGET_MAX_PEAK / globalMaxPeak;
      }
      computedGain = Math.max(MIN_CUT_GAIN, Math.min(MAX_BOOST_GAIN, computedGain));

      const gainDb = Math.round((20 * Math.log10(computedGain)) * 10) / 10;
      const peakDb = Math.round((20 * Math.log10(Math.max(0.0001, globalMaxPeak))) * 10) / 10;
      const rmsDb = Math.round((20 * Math.log10(Math.max(0.0001, activeRms))) * 10) / 10;

      const result: NormalizationMetrics = {
        gain: computedGain,
        gainDb,
        peak: globalMaxPeak,
        peakDb,
        rms: activeRms,
        rmsDb,
        status: 'ready',
      };

      normalizationCache.set(key, result);
      normalizationCache.set(pathKey, result);
      persistNormMetricToSession(key, result);
      persistNormMetricToSession(pathKey, result);
      return result;
    } catch (err: any) {
      console.warn(`Audio normalization analysis fallback failed for ${key}:`, err);
      const fallback: NormalizationMetrics = {
        gain: 1.0,
        gainDb: 0,
        peak: 1.0,
        peakDb: 0,
        rms: 0.125,
        rmsDb: -18,
        status: 'error',
        error: err?.message || 'Analysis error',
      };
      normalizationCache.set(key, fallback);
      return fallback;
    } finally {
      inFlightAnalysis.delete(key);
      inFlightAnalysis.delete(pathKey);
    }
  })();

  inFlightAnalysis.set(key, analysisPromise);
  inFlightAnalysis.set(pathKey, analysisPromise);
  return analysisPromise;
}

/**
 * Computes preview normalization metrics directly from an already-decoded AudioBuffer
 * using the exact same -18 dBFS RMS target and -0.7 dBFS peak limiter as QA preview.
 */
export function analyzeAudioBufferForPreview(
  audioBuffer: AudioBuffer,
  cacheKey?: string
): NormalizationMetrics {
  if (cacheKey && normalizationCache.has(cacheKey)) {
    const cached = normalizationCache.get(cacheKey)!;
    if (cached.status === 'ready') return cached;
  }

  if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function') {
    return {
      gain: 1.0,
      gainDb: 0,
      peak: 0.5,
      peakDb: -6,
      rms: 0.125,
      rmsDb: -18,
      status: 'ready',
    };
  }

  const numChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;

  let globalMaxPeak = 0.0001;
  let sumSquaresActive = 0;
  let activeSampleCount = 0;

  const voiceThreshold = 0.0056; // ~ -45 dBFS
  const step = length > 500000 ? Math.ceil(length / 250000) : 1;

  for (let c = 0; c < numChannels; c++) {
    const channelData = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i += step) {
      const absVal = Math.abs(channelData[i]);
      if (absVal > globalMaxPeak) {
        globalMaxPeak = absVal;
      }
      if (absVal >= voiceThreshold) {
        sumSquaresActive += absVal * absVal;
        activeSampleCount++;
      }
    }
  }

  const activeRms = activeSampleCount > 0
    ? Math.sqrt(sumSquaresActive / activeSampleCount)
    : globalMaxPeak * 0.5;

  let computedGain = TARGET_SPEECH_RMS / Math.max(0.01, activeRms);
  if (globalMaxPeak * computedGain > TARGET_MAX_PEAK) {
    computedGain = TARGET_MAX_PEAK / Math.max(0.001, globalMaxPeak);
  }
  computedGain = Math.max(MIN_CUT_GAIN, Math.min(MAX_BOOST_GAIN, computedGain));

  const gainDb = Math.round((20 * Math.log10(computedGain)) * 10) / 10;
  const peakDb = Math.round((20 * Math.log10(Math.max(0.0001, globalMaxPeak))) * 10) / 10;
  const rmsDb = Math.round((20 * Math.log10(Math.max(0.0001, activeRms))) * 10) / 10;

  const result: NormalizationMetrics = {
    gain: computedGain,
    gainDb,
    peak: globalMaxPeak,
    peakDb,
    rms: activeRms,
    rmsDb,
    status: 'ready',
  };

  if (cacheKey) {
    normalizationCache.set(cacheKey, result);
  }
  return result;
}

/**
 * Retrieves cached metrics if already computed.
 */
export function getCachedNormalization(cacheKey: string): NormalizationMetrics | undefined {
  return normalizationCache.get(cacheKey);
}

/**
 * Clears the normalization cache (e.g. on episode change).
 */
export function clearNormalizationCache(): void {
  normalizationCache.clear();
}

