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
  const key = cacheKey || audioUrl;
  
  if (normalizationCache.has(key)) {
    const cached = normalizationCache.get(key)!;
    if (cached.status === 'ready') {
      return cached;
    }
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

  // Strategy 1: Try fast IPC sidecar analysis via backend FFmpeg (Instant <5ms, ZERO RAM blowup)
  const rawPath = filePath || (audioUrl.startsWith('file://') ? audioUrl.replace(/^file:\/\//, '') : null);
  if (rawPath && typeof window !== 'undefined' && (window as any).electronAPI) {
    try {
      const analysis: any = await ipcSafe.invoke('audio-get-track-analysis', {
        audioPath: rawPath,
        options: { skipWhisper: true }
      });

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
  }
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
