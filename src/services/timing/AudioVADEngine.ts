import { NoiseCalibration, SpeechInterval } from '../../types/timing';

/**
 * High-precision RMS noise floor and dynamic range analysis on decoded AudioBuffer.
 */
export function analyzeTrackAudioNoiseFloor(
  audioBuffer: AudioBuffer,
  manualThresholdDb?: number
): NoiseCalibration {
  if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function') {
    return {
      noiseFloorDb: -60,
      speechFloorDb: -24,
      speechPeakDb: -6,
      calculatedThresholdDb: manualThresholdDb ?? -45,
      thresholdAmp: Math.pow(10, (manualThresholdDb ?? -45) / 20),
      dynamicRangeDb: 36,
      snrDb: 36
    };
  }

  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const totalSamples = channelData.length;
  const windowSize = Math.max(128, Math.floor(sampleRate * 0.05)); // 50ms windows
  const totalWindows = Math.floor(totalSamples / windowSize);

  // Sample across the entire track for fast and representative statistical distribution
  const step = Math.max(1, Math.floor(totalWindows / 12000));
  const rmsDbValues: number[] = [];

  for (let w = 0; w < totalWindows; w += step) {
    const offset = w * windowSize;
    let sumSquares = 0;
    for (let j = 0; j < windowSize; j++) {
      const s = channelData[offset + j];
      sumSquares += s * s;
    }
    const rms = Math.sqrt(sumSquares / windowSize);
    const db = rms > 1e-5 ? 20 * Math.log10(rms) : -96;
    rmsDbValues.push(db);
  }

  if (rmsDbValues.length === 0) {
    return {
      noiseFloorDb: -60,
      speechFloorDb: -24,
      speechPeakDb: -6,
      calculatedThresholdDb: manualThresholdDb ?? -45,
      thresholdAmp: Math.pow(10, (manualThresholdDb ?? -45) / 20),
      dynamicRangeDb: 36,
      snrDb: 36
    };
  }

  rmsDbValues.sort((a, b) => a - b);

  // Noise floor from 15th percentile of non-silent sections
  const nonNullWindows = rmsDbValues.filter(v => v > -90);
  const effectiveNoiseWindows = nonNullWindows.length > 50 ? nonNullWindows : rmsDbValues;
  const noiseFloorDb = effectiveNoiseWindows[Math.floor(effectiveNoiseWindows.length * 0.15)];

  // Active speech windows
  const activeSpeechWindows = rmsDbValues.filter(v => v > Math.max(-80, noiseFloorDb + 2.5));
  const speechFloorDb = activeSpeechWindows.length > 0
    ? activeSpeechWindows[Math.floor(activeSpeechWindows.length * 0.40)]
    : (nonNullWindows.length > 0 ? nonNullWindows[Math.floor(nonNullWindows.length * 0.75)] : -28.0);
  const speechPeakDb = activeSpeechWindows.length > 0
    ? activeSpeechWindows[Math.floor(activeSpeechWindows.length * 0.95)]
    : (nonNullWindows.length > 0 ? nonNullWindows[Math.floor(nonNullWindows.length * 0.98)] : -6.0);

  let calculatedThresholdDb: number;
  if (manualThresholdDb !== undefined && manualThresholdDb !== null && !isNaN(manualThresholdDb)) {
    calculatedThresholdDb = manualThresholdDb;
  } else {
    const snr = speechFloorDb - noiseFloorDb;
    if (snr > 14) {
      const margin = Math.min(8.0, Math.max(3.5, snr * 0.20));
      calculatedThresholdDb = Math.min(-34, noiseFloorDb + margin);
    } else {
      calculatedThresholdDb = Math.min(-32, noiseFloorDb + 2.5);
    }
    calculatedThresholdDb = Math.max(-65, Math.min(-30, calculatedThresholdDb));
  }

  const thresholdAmp = Math.pow(10, calculatedThresholdDb / 20);
  const dynamicRangeDb = Number((speechPeakDb - noiseFloorDb).toFixed(1));
  const snrDb = Number((speechFloorDb - noiseFloorDb).toFixed(1));

  return {
    noiseFloorDb: Number(noiseFloorDb.toFixed(1)),
    speechFloorDb: Number(speechFloorDb.toFixed(1)),
    speechPeakDb: Number(speechPeakDb.toFixed(1)),
    calculatedThresholdDb: Number(calculatedThresholdDb.toFixed(1)),
    thresholdAmp,
    dynamicRangeDb,
    snrDb
  };
}

/**
 * Speech interval detection algorithm on decoded AudioBuffer.
 * Preserves subtle consonant attacks and breath tails through adaptive padding.
 */
export function detectSpeechIntervals(
  audioBuffer: AudioBuffer,
  options: {
    minSilenceDurationSec?: number;
    leadInPaddingSec?: number;
    leadOutPaddingSec?: number;
    minSpeechDurationSec?: number;
    mergeCloseGapsSec?: number;
    manualThresholdDb?: number;
    onCalibration?: (calib: NoiseCalibration) => void;
  } = {}
): SpeechInterval[] {
  const {
    minSilenceDurationSec = 0.30,
    leadInPaddingSec = 0.15,
    leadOutPaddingSec = 0.22,
    minSpeechDurationSec = 0.20,
    mergeCloseGapsSec = 0.35,
    manualThresholdDb,
    onCalibration
  } = options;

  const calib = analyzeTrackAudioNoiseFloor(audioBuffer, manualThresholdDb);
  if (onCalibration) onCalibration(calib);

  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const totalSamples = channelData.length;
  const duration = audioBuffer.duration;
  const thresholdAmp = calib.thresholdAmp;

  const chunkSize = Math.max(128, Math.floor(sampleRate * 0.02)); // 20ms chunks
  const totalChunks = Math.floor(totalSamples / chunkSize);
  const isSpeechChunk = new Uint8Array(totalChunks);

  for (let i = 0; i < totalChunks; i++) {
    let sumSquares = 0;
    const offset = i * chunkSize;
    for (let j = 0; j < chunkSize; j++) {
      const s = channelData[offset + j];
      sumSquares += s * s;
    }
    const rms = Math.sqrt(sumSquares / chunkSize);
    if (rms >= thresholdAmp) {
      isSpeechChunk[i] = 1;
    }
  }

  // Smooth short micro-pauses inside words (e.g. stop consonants like p, t, k)
  const minSilenceChunks = Math.floor(mergeCloseGapsSec / 0.02);
  let gapCount = 0;
  for (let i = 0; i < totalChunks; i++) {
    if (isSpeechChunk[i] === 0) {
      gapCount++;
    } else {
      if (gapCount > 0 && gapCount < minSilenceChunks) {
        for (let k = i - gapCount; k < i; k++) {
          isSpeechChunk[k] = 1;
        }
      }
      gapCount = 0;
    }
  }

  const rawIntervals: Array<{ startSec: number; endSec: number; durationSec: number }> = [];
  let inSpeech = false;
  let intervalStartSec = 0;

  for (let i = 0; i < totalChunks; i++) {
    const chunkTime = (i * chunkSize) / sampleRate;
    if (isSpeechChunk[i] === 1 && !inSpeech) {
      inSpeech = true;
      intervalStartSec = chunkTime;
    } else if (isSpeechChunk[i] === 0 && inSpeech) {
      inSpeech = false;
      const intervalEndSec = chunkTime;
      if (intervalEndSec - intervalStartSec >= minSpeechDurationSec) {
        rawIntervals.push({
          startSec: intervalStartSec,
          endSec: intervalEndSec,
          durationSec: intervalEndSec - intervalStartSec
        });
      }
    }
  }

  if (inSpeech) {
    const intervalEndSec = (totalChunks * chunkSize) / sampleRate;
    if (intervalEndSec - intervalStartSec >= minSpeechDurationSec) {
      rawIntervals.push({
        startSec: intervalStartSec,
        endSec: intervalEndSec,
        durationSec: intervalEndSec - intervalStartSec
      });
    }
  }

  // Apply protective lead-in and lead-out padding
  const paddedIntervals: SpeechInterval[] = rawIntervals.map((interval, idx) => {
    const prevEnd = idx > 0 ? rawIntervals[idx - 1].endSec : 0;
    const nextStart = idx < rawIntervals.length - 1 ? rawIntervals[idx + 1].startSec : duration;

    const paddedStart = Math.max(0, Math.max(prevEnd, interval.startSec - leadInPaddingSec));
    const paddedEnd = Math.min(duration, Math.min(nextStart, interval.endSec + leadOutPaddingSec));

    return {
      startSec: Number(paddedStart.toFixed(3)),
      endSec: Number(paddedEnd.toFixed(3)),
      durationSec: Number((paddedEnd - paddedStart).toFixed(3))
    };
  });

  return paddedIntervals;
}

/**
 * Detects internal inter-word silence intervals inside a given speech phrase
 * so that Smart Pause Breathing can adjust them without affecting voiced phonemes.
 */
export function detectInternalPauses(
  audioBuffer: AudioBuffer,
  rangeStartSec: number,
  rangeEndSec: number,
  options: {
    minPauseSec?: number;
    silenceThresholdDb?: number;
  } = {}
): Array<{ startSec: number; endSec: number; durationSec: number }> {
  const { minPauseSec = 0.10, silenceThresholdDb = -42 } = options;
  if (!audioBuffer) return [];

  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0);
  const startSample = Math.max(0, Math.floor(rangeStartSec * sampleRate));
  const endSample = Math.min(channelData.length, Math.floor(rangeEndSec * sampleRate));

  if (endSample <= startSample) return [];

  const windowSize = Math.max(64, Math.floor(sampleRate * 0.015)); // 15ms
  const thresholdAmp = Math.pow(10, silenceThresholdDb / 20);
  const totalWindows = Math.floor((endSample - startSample) / windowSize);

  const isSilent = new Uint8Array(totalWindows);
  for (let w = 0; w < totalWindows; w++) {
    const offset = startSample + w * windowSize;
    let sumSquares = 0;
    for (let j = 0; j < windowSize; j++) {
      const s = channelData[offset + j];
      sumSquares += s * s;
    }
    const rms = Math.sqrt(sumSquares / windowSize);
    if (rms < thresholdAmp) {
      isSilent[w] = 1;
    }
  }

  const minSilentWindows = Math.floor(minPauseSec / 0.015);
  const pauses: Array<{ startSec: number; endSec: number; durationSec: number }> = [];

  let inSilence = false;
  let silenceStartWin = 0;

  for (let w = 0; w < totalWindows; w++) {
    if (isSilent[w] === 1 && !inSilence) {
      inSilence = true;
      silenceStartWin = w;
    } else if (isSilent[w] === 0 && inSilence) {
      inSilence = false;
      const count = w - silenceStartWin;
      if (count >= minSilentWindows) {
        const pStart = rangeStartSec + (silenceStartWin * windowSize) / sampleRate;
        const pEnd = rangeStartSec + (w * windowSize) / sampleRate;
        pauses.push({
          startSec: Number(pStart.toFixed(3)),
          endSec: Number(pEnd.toFixed(3)),
          durationSec: Number((pEnd - pStart).toFixed(3))
        });
      }
    }
  }

  if (inSilence && totalWindows - silenceStartWin >= minSilentWindows) {
    const pStart = rangeStartSec + (silenceStartWin * windowSize) / sampleRate;
    const pEnd = rangeEndSec;
    pauses.push({
      startSec: Number(pStart.toFixed(3)),
      endSec: Number(pEnd.toFixed(3)),
      durationSec: Number((pEnd - pStart).toFixed(3))
    });
  }

  return pauses;
}

/**
 * Finds the nearest zero-crossing point in the audio buffer within searchWindowSec.
 * Eliminates click/pop artifacts when splitting or slicing clips.
 */
export function findNearestZeroCrossing(
  audioBuffer: AudioBuffer,
  timeSec: number,
  searchWindowSec: number = 0.01
): number {
  if (!audioBuffer) return timeSec;
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const targetSample = Math.floor(timeSec * sampleRate);
  const windowSamples = Math.floor(searchWindowSec * sampleRate);

  const minSample = Math.max(1, targetSample - windowSamples);
  const maxSample = Math.min(channelData.length - 1, targetSample + windowSamples);

  let bestSample = targetSample;
  let minAbs = Math.abs(channelData[targetSample] || 0);

  for (let i = minSample; i <= maxSample; i++) {
    const cur = channelData[i];
    const prev = channelData[i - 1];
    // Exact sign change
    if ((prev <= 0 && cur >= 0) || (prev >= 0 && cur <= 0)) {
      return i / sampleRate;
    }
    if (Math.abs(cur) < minAbs) {
      minAbs = Math.abs(cur);
      bestSample = i;
    }
  }

  return bestSample / sampleRate;
}
