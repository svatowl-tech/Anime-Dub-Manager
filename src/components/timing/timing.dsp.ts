import { NoiseCalibration } from './timing.types';
import { TIMING_RULES } from './timing.rules';

/**
 * Statistical Noise Floor & Speech Energy Analyzer.
 * Accurately analyzes the track before silence cutting to detect true ambient room noise,
 * speech dynamics, and safe threshold preventing clipping of quiet words or breaths.
 */
export function analyzeTrackAudioNoiseFloor(
  audioBuffer: AudioBuffer,
  manualThresholdDb?: number,
  _subLines?: Array<{ startSec: number; endSec: number }>
): NoiseCalibration {
  if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function') {
    const floorDb = manualThresholdDb !== undefined ? manualThresholdDb : -42;
    return {
      noiseFloorDb: floorDb,
      speechFloorDb: -30,
      speechPeakDb: -6,
      calculatedThresholdDb: floorDb + 4,
      thresholdAmp: Math.pow(10, (floorDb + 4) / 20),
      dynamicRangeDb: 24,
      snrDb: 18
    };
  }
  const numChannels = Math.max(1, audioBuffer.numberOfChannels || 1);
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }
  const sampleRate = audioBuffer.sampleRate;
  const totalSamples = channels[0].length;

  const windowSize = Math.max(128, Math.floor(sampleRate * 0.02)); // 20ms windows
  const totalWindows = Math.floor(totalSamples / windowSize);

  // Sample up to 12000 windows across the file for fast, ultra-accurate distribution
  const step = Math.max(1, Math.floor(totalWindows / 12000));
  const rmsDbValues: number[] = [];

  for (let w = 0; w < totalWindows; w += step) {
    const offset = w * windowSize;
    let maxRms = 0;
    for (let c = 0; c < numChannels; c++) {
      const ch = channels[c];
      let sumSquares = 0;
      for (let j = 0; j < windowSize; j++) {
        const s = ch[offset + j];
        sumSquares += s * s;
      }
      const chRms = Math.sqrt(sumSquares / windowSize);
      if (chRms > maxRms) maxRms = chRms;
    }
    const db = maxRms > 3.16e-5 ? 20 * Math.log10(maxRms) : -91;
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

  // Real noise floor estimation that NEVER mistakes gated speech clips for room noise:
  const nonNullWindows = rmsDbValues.filter(v => v > -88);
  const activeFraction = nonNullWindows.length / Math.max(1, rmsDbValues.length);
  const isGatedOrSparseTrack = activeFraction < 0.55;

  let noiseFloorDb: number;
  let noiseUpperDb: number;

  if (isGatedOrSparseTrack) {
    const rawClipNoise = nonNullWindows.length > 20
      ? nonNullWindows[Math.floor(nonNullWindows.length * 0.08)]
      : -72;
    noiseFloorDb = Math.max(-84, Math.min(-52, rawClipNoise));
    noiseUpperDb = Math.min(-48, noiseFloorDb + 3.0);
  } else {
    const rawRoomNoise = rmsDbValues[Math.floor(rmsDbValues.length * 0.15)];
    const medianDb = rmsDbValues[Math.floor(rmsDbValues.length * 0.50)];
    noiseFloorDb = Math.max(-84, Math.min(-48, rawRoomNoise));
    noiseUpperDb = Math.min(-44, medianDb, noiseFloorDb + 3.5);
  }

  // Top 0.5% energy windows represent true vocal peaks
  const topPeakIdx = Math.min(rmsDbValues.length - 1, Math.max(0, Math.floor(rmsDbValues.length * 0.995)));
  const topVoicePeakDb = rmsDbValues[topPeakIdx];

  // Filter strictly for real vocal syllable windows (within 26 dB of peak voice and well above room noise)
  // so quiet room-tone tails never drag speechFloorDb down to -55..-65 dB
  const minSpeechCandDb = Math.max(
    -54,
    noiseUpperDb + 8.0,
    noiseFloorDb + 10.0,
    topVoicePeakDb - 26.0
  );
  const activeSpeechWindows = rmsDbValues.filter(v => v >= minSpeechCandDb);

  const speechFloorDb = activeSpeechWindows.length > 0
    ? activeSpeechWindows[Math.floor(activeSpeechWindows.length * 0.30)]
    : Math.max(-42, topVoicePeakDb - 18.0);
  const speechPeakDb = activeSpeechWindows.length > 0
    ? activeSpeechWindows[Math.floor(activeSpeechWindows.length * 0.90)]
    : Math.max(speechFloorDb + 6.0, topVoicePeakDb);

  let calculatedThresholdDb: number;
  if (manualThresholdDb !== undefined && manualThresholdDb !== null && !isNaN(manualThresholdDb)) {
    calculatedThresholdDb = manualThresholdDb;
  } else {
    // Keep auto-threshold in the clean vocal trigger band [-50 dB, -38 dB]:
    const safeNoiseMarginDb = Math.max(-50, noiseUpperDb + 8.0, noiseFloorDb + 12.0);
    const voiceEntryDb = Math.min(-38, speechFloorDb - 6.0, speechPeakDb - 18.0);
    calculatedThresholdDb = Math.max(-50, Math.min(-38, Math.max(safeNoiseMarginDb, voiceEntryDb)));
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
 * Surgical Speech Interval Detection on decoded AudioBuffer.
 * - Cuts ONLY silence between phrases without shifting phrase timecodes (clipStartSec === sourceStartSec).
 * - Uses tight, natural word-edge detection (100ms pre-edge, 140ms post-edge, 80ms/120ms padding) so phrases
 *   never glue together into 15-30s blocks and never acquire 500ms-1000ms of pre-speech dead air.
 * - Performs Subtitle-Boundary Valley Splitting when `subLines` are provided so consecutive subtitles
 *   separated by a brief breath dip (>= 60ms) are cleanly separated into individual clips.
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
    subLines?: Array<{ startSec: number; endSec: number }>;
    vocalsBuffer?: AudioBuffer;
    vocalsNoiseDbHint?: number;
    onCalibration?: (calib: NoiseCalibration) => void;
  } = {}
): Array<{ startSec: number; endSec: number; durationSec: number }> {
  const {
    minSilenceDurationSec = 0.24,
    leadInPaddingSec = 0.18,
    leadOutPaddingSec = 0.26,
    minSpeechDurationSec = 0.14,
    mergeCloseGapsSec = 0.22,
    manualThresholdDb,
    subLines,
    vocalsBuffer,
    onCalibration
  } = options;

  const calib = analyzeTrackAudioNoiseFloor(audioBuffer, manualThresholdDb, subLines);
  if (onCalibration) onCalibration(calib);

  const numChannels = Math.max(1, audioBuffer.numberOfChannels || 1);
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }
  const sampleRate = audioBuffer.sampleRate;
  const totalSamples = channels[0].length;
  const duration = audioBuffer.duration;
  const triggerThresholdAmp = calib.thresholdAmp;

  // Sensitive word-edge threshold to capture delicate consonant attacks and breath endings
  // so quiet speech ends are never cut flush ("заподлицо").
  const edgeThresholdDb = Math.max(
    -60,
    calib.noiseFloorDb + 4.5,
    calib.calculatedThresholdDb - 7.0
  );
  const edgeThresholdAmp = Math.pow(10, edgeThresholdDb / 20);

  const chunkSize = Math.max(128, Math.floor(sampleRate * 0.02)); // 20ms chunks
  const totalChunks = Math.floor(totalSamples / chunkSize);
  const chunkRmsValues = new Float32Array(totalChunks);
  const chunkPeakValues = new Float32Array(totalChunks);
  const isSpeechChunk = new Uint8Array(totalChunks);

  for (let i = 0; i < totalChunks; i++) {
    const offset = i * chunkSize;
    let maxRms = 0;
    let maxPeak = 0;
    for (let c = 0; c < numChannels; c++) {
      const ch = channels[c];
      let sumSquares = 0;
      let chPeak = 0;
      for (let j = 0; j < chunkSize; j++) {
        const s = ch[offset + j];
        const absS = Math.abs(s);
        if (absS > chPeak) chPeak = absS;
        sumSquares += s * s;
      }
      const chRms = Math.sqrt(sumSquares / chunkSize);
      if (chRms > maxRms) maxRms = chRms;
      if (chPeak > maxPeak) maxPeak = chPeak;
    }
    chunkRmsValues[i] = maxRms;
    chunkPeakValues[i] = maxPeak;
    if (maxRms >= triggerThresholdAmp || (maxPeak >= triggerThresholdAmp * 2.2 && maxRms >= edgeThresholdAmp)) {
      isSpeechChunk[i] = 1;
    }
  }

  // Subtitle-Window Quiet Phrase Recovery:
  if (subLines && subLines.length > 0 && duration >= 45 && manualThresholdDb === undefined) {
    const minLocalNoiseAmp = Math.pow(10, Math.max(-58, calib.noiseFloorDb + 8.0) / 20);
    for (const sub of subLines) {
      const wStartSec = Math.max(0, sub.startSec - 0.6);
      const wEndSec = Math.min(duration, sub.endSec + 0.6);
      const startChunk = Math.max(0, Math.floor((wStartSec * sampleRate) / chunkSize));
      const endChunk = Math.min(totalChunks - 1, Math.floor((wEndSec * sampleRate) / chunkSize));
      if (endChunk <= startChunk + 4) continue;

      let activeCount = 0;
      let localMaxRms = 0;
      for (let cIdx = startChunk; cIdx <= endChunk; cIdx++) {
        if (isSpeechChunk[cIdx] === 1) activeCount++;
        if (chunkRmsValues[cIdx] > localMaxRms) localMaxRms = chunkRmsValues[cIdx];
      }

      if (activeCount < 3 && localMaxRms >= minLocalNoiseAmp * 1.5) {
        const localThreshAmp = Math.max(minLocalNoiseAmp, localMaxRms * 0.30);
        let candidateCount = 0;
        for (let cIdx = startChunk; cIdx <= endChunk; cIdx++) {
          if (chunkRmsValues[cIdx] >= localThreshAmp) candidateCount++;
        }
        if (candidateCount >= 4) {
          for (let cIdx = startChunk; cIdx <= endChunk; cIdx++) {
            if (chunkRmsValues[cIdx] >= localThreshAmp) {
              isSpeechChunk[cIdx] = 1;
            }
          }
        }
      }
    }
  }

  // Pass 1: Smooth only intra-word stop-consonant closures (<= 180ms)
  const effectiveMergeSec = Math.min(0.22, Math.max(0.14, mergeCloseGapsSec));
  const minSilenceChunks = Math.max(3, Math.floor(effectiveMergeSec / 0.02));
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

  // Pass 2: Natural Word-Edge Expansion (up to 200ms backwards and 280ms forwards)
  const maxBackwardExpandChunks = 10; // 200ms
  const maxForwardExpandChunks = 14;  // 280ms
  const isAboveEdge = (idx: number) =>
    chunkRmsValues[idx] >= edgeThresholdAmp || chunkPeakValues[idx] >= edgeThresholdAmp * 1.8;

  let segIdx = 0;
  while (segIdx < totalChunks) {
    if (isSpeechChunk[segIdx] === 1) {
      const segStart = segIdx;
      while (segIdx < totalChunks && isSpeechChunk[segIdx] === 1) {
        segIdx++;
      }
      const segEnd = segIdx - 1;

      let newStart = segStart;
      let backSilentRun = 0;
      const minBackLimit = Math.max(0, segStart - maxBackwardExpandChunks);
      for (let b = segStart - 1; b >= minBackLimit; b--) {
        if (isAboveEdge(b)) {
          newStart = b;
          backSilentRun = 0;
        } else {
          backSilentRun++;
          if (backSilentRun > 2) break;
        }
      }
      for (let k = newStart; k < segStart; k++) {
        isSpeechChunk[k] = 1;
      }

      let newEnd = segEnd;
      let fwdSilentRun = 0;
      const maxFwdLimit = Math.min(totalChunks - 1, segEnd + maxForwardExpandChunks);
      for (let f = segEnd + 1; f <= maxFwdLimit; f++) {
        if (isAboveEdge(f)) {
          newEnd = f;
          fwdSilentRun = 0;
        } else {
          fwdSilentRun++;
          if (fwdSilentRun > 2) break;
        }
      }
      for (let k = segEnd + 1; k <= newEnd; k++) {
        isSpeechChunk[k] = 1;
      }

      segIdx = newEnd + 1;
    } else {
      segIdx++;
    }
  }

  // Generous lead-in and lead-out margins (default 180ms lead-in, 260ms lead-out)
  const effectiveLeadInSec = Math.min(0.40, Math.max(0.12, leadInPaddingSec || 0.18));
  const effectiveLeadOutSec = Math.min(0.50, Math.max(0.18, leadOutPaddingSec || 0.26));
  const effectiveMinSilenceSec = Math.min(0.35, Math.max(0.16, minSilenceDurationSec));

  const rawIntervals: Array<{ startSec: number; endSec: number; durationSec: number }> = [];
  let inSpeech = false;
  let intervalStartSec = 0;

  for (let i = 0; i < totalChunks; i++) {
    const chunkTime = (i * chunkSize) / sampleRate;
    if (isSpeechChunk[i] === 1 && !inSpeech) {
      inSpeech = true;
      intervalStartSec = Math.max(0, chunkTime - effectiveLeadInSec);
    } else if (isSpeechChunk[i] === 0 && inSpeech) {
      inSpeech = false;
      const intervalEndSec = Math.min(duration, chunkTime + effectiveLeadOutSec);
      if (intervalEndSec - intervalStartSec >= minSpeechDurationSec) {
        rawIntervals.push({
          startSec: Number(intervalStartSec.toFixed(2)),
          endSec: Number(intervalEndSec.toFixed(2)),
          durationSec: Number((intervalEndSec - intervalStartSec).toFixed(2))
        });
      }
    }
  }

  if (inSpeech) {
    const intervalEndSec = duration;
    if (intervalEndSec - intervalStartSec >= minSpeechDurationSec) {
      rawIntervals.push({
        startSec: Number(intervalStartSec.toFixed(2)),
        endSec: Number(intervalEndSec.toFixed(2)),
        durationSec: Number((intervalEndSec - intervalStartSec).toFixed(2))
      });
    }
  }

  // Merge intervals only if the gap between them is smaller than effectiveMinSilenceSec
  const mergedIntervals: Array<{ startSec: number; endSec: number; durationSec: number }> = [];
  for (const interval of rawIntervals) {
    if (mergedIntervals.length === 0) {
      mergedIntervals.push({ ...interval });
    } else {
      const last = mergedIntervals[mergedIntervals.length - 1];
      const gap = interval.startSec - last.endSec;
      if (gap < effectiveMinSilenceSec) {
        last.endSec = Math.max(last.endSec, interval.endSec);
        last.durationSec = Number((last.endSec - last.startSec).toFixed(2));
      } else {
        mergedIntervals.push({ ...interval });
      }
    }
  }

  // Pass 3: Subtitle-Boundary Valley Splitting
  if (!subLines || subLines.length < 2) {
    return mergedIntervals;
  }

  const sortedSubs = [...subLines].sort((a, b) => a.startSec - b.startSec);
  const finalIntervals: Array<{ startSec: number; endSec: number; durationSec: number }> = [];

  for (const iv of mergedIntervals) {
    const overlappingSubs = sortedSubs.filter(
      s => s.startSec <= iv.endSec - 0.15 && s.endSec >= iv.startSec + 0.15
    );
    if (overlappingSubs.length < 2 || iv.durationSec < 1.1) {
      finalIntervals.push(iv);
      continue;
    }

    let currentStart = iv.startSec;
    for (let sIdx = 0; sIdx < overlappingSubs.length - 1; sIdx++) {
      const subA = overlappingSubs[sIdx];
      const subB = overlappingSubs[sIdx + 1];
      if (subB.startSec < subA.endSec - 0.10) continue;

      const assBoundarySec = (subA.endSec + subB.startSec) / 2;
      let anchorBoundarySec = assBoundarySec;

      // Rule 2A: If original_vocals.wav is available, locate the quietest 40ms valley in [assBoundary ± 0.45s]
      if (vocalsBuffer && typeof vocalsBuffer.getChannelData === 'function') {
        const vSr = vocalsBuffer.sampleRate;
        const vCh = vocalsBuffer.getChannelData(0);
        const vWin = Math.max(64, Math.floor(vSr * 0.01)); // 10ms RMS step -> 4x = 40ms valley
        const vScanStart = Math.max(0, assBoundarySec - 0.45);
        const vScanEnd = Math.min(vocalsBuffer.duration, assBoundarySec + 0.45);
        const sSamp = Math.max(0, Math.floor(vScanStart * vSr));
        const eSamp = Math.min(vCh.length, Math.ceil(vScanEnd * vSr));
        const numVFrames = Math.floor((eSamp - sSamp) / vWin);
        if (numVFrames >= 6) {
          const vRms = new Float32Array(numVFrames);
          for (let vf = 0; vf < numVFrames; vf++) {
            const base = sSamp + vf * vWin;
            let sumSq = 0;
            for (let k = 0; k < vWin; k++) {
              const s = vCh[base + k];
              sumSq += s * s;
            }
            vRms[vf] = Math.sqrt(sumSq / vWin);
          }
          let minVAvg = Infinity;
          let minVFrame = -1;
          for (let vf = 0; vf <= numVFrames - 4; vf++) {
            const avg4 = (vRms[vf] + vRms[vf + 1] + vRms[vf + 2] + vRms[vf + 3]) / 4;
            if (avg4 < minVAvg) {
              minVAvg = avg4;
              minVFrame = vf + 2;
            }
          }
          if (minVFrame !== -1) {
            anchorBoundarySec = sSamp / vSr + (minVFrame * vWin) / vSr;
          }
        }
      }

      const searchStartSec = vocalsBuffer
        ? Math.max(currentStart + 0.25, Math.min(subA.endSec - 0.35, anchorBoundarySec - 0.35))
        : Math.max(currentStart + 0.30, subA.endSec - 0.35);
      const searchEndSec = vocalsBuffer
        ? Math.min(iv.endSec - 0.25, Math.max(subB.startSec + 0.35, anchorBoundarySec + 0.35))
        : Math.min(iv.endSec - 0.30, subB.startSec + 0.35);
      if (searchEndSec <= searchStartSec + 0.08) continue;

      const cStart = Math.max(0, Math.floor((searchStartSec * sampleRate) / chunkSize));
      const cEnd = Math.min(totalChunks - 2, Math.floor((searchEndSec * sampleRate) / chunkSize));
      if (cEnd <= cStart + 1) continue;

      // Measure surrounding phrase peak RMS
      const phraseStartChunk = Math.max(0, Math.floor((currentStart * sampleRate) / chunkSize));
      const phraseEndChunk = Math.min(totalChunks - 1, Math.floor((iv.endSec * sampleRate) / chunkSize));
      let localPhrasePeakRms = 0;
      for (let k = phraseStartChunk; k <= phraseEndChunk; k++) {
        if (chunkRmsValues[k] > localPhrasePeakRms) localPhrasePeakRms = chunkRmsValues[k];
      }

      // Find the quietest 2-chunk (40ms) valley inside [cStart, cEnd]
      let minValleyRms = Infinity;
      let minValleyChunk = -1;
      for (let k = cStart; k <= cEnd; k++) {
        const avg2 = (chunkRmsValues[k] + chunkRmsValues[k + 1]) / 2;
        if (avg2 < minValleyRms) {
          minValleyRms = avg2;
          minValleyChunk = k + 1;
        }
      }

      const isGenuinePauseValley =
        minValleyChunk !== -1 &&
        (minValleyRms <= triggerThresholdAmp * 1.45 || minValleyRms <= localPhrasePeakRms * 0.32);

      if (isGenuinePauseValley) {
        const splitSec = Number(((minValleyChunk * chunkSize) / sampleRate).toFixed(2));
        const leftEnd = Number(Math.max(currentStart + 0.20, splitSec - 0.01).toFixed(2));
        const rightStart = Number(Math.min(iv.endSec - 0.20, splitSec + 0.01).toFixed(2));
        if (leftEnd - currentStart >= minSpeechDurationSec && iv.endSec - rightStart >= minSpeechDurationSec) {
          finalIntervals.push({
            startSec: currentStart,
            endSec: leftEnd,
            durationSec: Number((leftEnd - currentStart).toFixed(2))
          });
          currentStart = rightStart;
        }
      }
    }

    if (iv.endSec - currentStart >= minSpeechDurationSec) {
      finalIntervals.push({
        startSec: currentStart,
        endSec: iv.endSec,
        durationSec: Number((iv.endSec - currentStart).toFixed(2))
      });
    }
  }

  return finalIntervals;
}

const roomNoiseDbCache = new WeakMap<AudioBuffer, number>();

/**
 * Computes and caches the adaptive room noise floor (dBFS) for an AudioBuffer.
 */
export function getAudioBufferRoomNoiseDb(audioBuffer: AudioBuffer | undefined): number {
  if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function') return -48;
  const cached = roomNoiseDbCache.get(audioBuffer);
  if (cached !== undefined) return cached;
  const calib = analyzeTrackAudioNoiseFloor(audioBuffer);
  roomNoiseDbCache.set(audioBuffer, calib.noiseFloorDb);
  return calib.noiseFloorDb;
}

export interface ClipSpeechBounds {
  /** Offset in seconds from sourceStartSec where actual voice begins (pre-roll / breath length) */
  onsetOffsetSec: number;
  /** Offset in seconds from sourceStartSec where actual voice ends */
  offsetSec: number;
  /** Peak RMS amplitude detected inside [sourceStartSec, sourceEndSec] */
  peakRms: number;
  /** Estimated room noise floor in dBFS */
  roomNoiseDb: number;
}

/**
 * Analyzes 10-ms RMS windows across [sourceStartSec, sourceEndSec] (all channels)
 * to determine:
 * - `onsetOffsetSec`: true word onset (walking backwards from the vocal nucleus to capture quiet initial consonants/syllables, capped by MAX_ONSET_PREROLL_SEC)
 * - `offsetSec`: end of last active speech 10ms frame (walking forwards to include soft trailing consonants)
 */
export function detectClipSpeechBounds(
  audioBuffer: AudioBuffer | undefined,
  sourceStartSec: number,
  sourceEndSec: number,
  roomNoiseDbHint?: number
): ClipSpeechBounds {
  const clipDur = Math.max(0.05, (sourceEndSec || 0) - (sourceStartSec || 0));
  if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function') {
    return { onsetOffsetSec: 0, offsetSec: clipDur, peakRms: 0, roomNoiseDb: -48 };
  }

  const sampleRate = audioBuffer.sampleRate;
  const numChannels = Math.max(1, audioBuffer.numberOfChannels || 1);
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(audioBuffer.getChannelData(ch));
  }

  const totalLen = channels[0].length;
  const startSample = Math.max(0, Math.floor(sourceStartSec * sampleRate));
  const endSample = Math.min(totalLen, Math.ceil(sourceEndSec * sampleRate));
  if (endSample <= startSample) {
    return { onsetOffsetSec: 0, offsetSec: clipDur, peakRms: 0, roomNoiseDb: -48 };
  }

  const winSamples = Math.max(64, Math.floor(sampleRate * 0.01)); // 10ms windows
  const numFrames = Math.floor((endSample - startSample) / winSamples);
  if (numFrames <= 0) {
    return { onsetOffsetSec: 0, offsetSec: clipDur, peakRms: 0, roomNoiseDb: -48 };
  }

  const rmsFrames = new Float32Array(numFrames);
  let peakRms = 0;

  for (let f = 0; f < numFrames; f++) {
    const base = startSample + f * winSamples;
    let sumSq = 0;
    for (let i = 0; i < winSamples; i++) {
      let sampleVal = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        sampleVal += channels[ch][base + i];
      }
      sampleVal /= numChannels;
      sumSq += sampleVal * sampleVal;
    }
    const rms = Math.sqrt(sumSq / winSamples);
    rmsFrames[f] = rms;
    if (rms > peakRms) peakRms = rms;
  }

  const roomNoiseDb = roomNoiseDbHint ?? getAudioBufferRoomNoiseDb(audioBuffer);
  const noiseFloorAmp = Math.pow(10, roomNoiseDb / 20);
  const noisePlus10Amp = Math.pow(10, (roomNoiseDb + 10) / 20);
  const peak15Amp = peakRms * 0.15;

  // Guard against scanning pure room-noise / silence clips
  if (peakRms < Math.max(1e-5, noiseFloorAmp * 1.35)) {
    return { onsetOffsetSec: 0, offsetSec: clipDur, peakRms, roomNoiseDb };
  }

  const isSpeechFrame = (idx: number): boolean => {
    const r = rmsFrames[idx];
    return r > noiseFloorAmp * 1.4 && (r > noisePlus10Amp || r > peak15Amp);
  };

  let onsetFrame = -1;
  let offsetFrame = -1;

  for (let f = 0; f < numFrames; f++) {
    if (!isSpeechFrame(f)) continue;
    // Require adjacent 10ms confirmation or strong transient (>= 35% peak) to avoid isolated 10ms mic clicks
    const confirmedNext = f + 1 < numFrames && isSpeechFrame(f + 1);
    const confirmedPrev = f - 1 >= 0 && isSpeechFrame(f - 1);
    const strongPeak = rmsFrames[f] > peakRms * 0.35;
    if (confirmedNext || confirmedPrev || strongPeak) {
      if (onsetFrame === -1) onsetFrame = f;
      offsetFrame = f + 1;
    }
  }

  if (onsetFrame === -1 || offsetFrame === -1) {
    return { onsetOffsetSec: 0, offsetSec: clipDur, peakRms, roomNoiseDb };
  }

  // Backward Word-Edge Walk: capture quiet Russian initial consonants (с, ш, п, т, к, ф, х, ч) and unstressed first syllables
  // so they are NEVER treated as silent pre-roll and subtracted from anchorStartSec!
  const wordEdgeAmp = Math.max(
    noiseFloorAmp * 1.75,
    Math.pow(10, Math.max(-58, roomNoiseDb + 4.5) / 20),
    peakRms * 0.04
  );
  let trueOnsetFrame = onsetFrame;
  let backSilentRun = 0;
  const minBackFrame = Math.max(0, onsetFrame - 28); // up to 280ms backward consonant/syllable recovery
  for (let b = onsetFrame - 1; b >= minBackFrame; b--) {
    if (rmsFrames[b] >= wordEdgeAmp) {
      trueOnsetFrame = b;
      backSilentRun = 0;
    } else {
      backSilentRun++;
      if (backSilentRun > 3) break; // >30ms of pure room noise ends the word edge walk
    }
  }

  // Forward Word-Edge Walk: preserve soft trailing consonants/endings
  let trueOffsetFrame = offsetFrame;
  let fwdSilentRun = 0;
  const maxFwdFrame = Math.min(numFrames - 1, offsetFrame + 18); // up to 180ms forward
  for (let f = offsetFrame; f <= maxFwdFrame; f++) {
    if (rmsFrames[f] >= wordEdgeAmp) {
      trueOffsetFrame = f + 1;
      fwdSilentRun = 0;
    } else {
      fwdSilentRun++;
      if (fwdSilentRun > 3) break;
    }
  }

  const onsetSecRaw = (trueOnsetFrame * winSamples) / sampleRate;
  const offsetSecRaw = (trueOffsetFrame * winSamples) / sampleRate;

  // Cap pre-roll compensation at MAX_ONSET_PREROLL_SEC (0.18s) so soft/whispered beginnings never pull clips early
  const maxAllowedPreRollSec = Math.min(clipDur - 0.04, TIMING_RULES.MAX_ONSET_PREROLL_SEC);
  const onsetOffsetSec = Number(Math.max(0, Math.min(maxAllowedPreRollSec, onsetSecRaw)).toFixed(3));
  const offsetSec = Number(Math.max(Math.min(clipDur, onsetOffsetSec + 0.02), Math.min(clipDur, offsetSecRaw)).toFixed(3));

  return { onsetOffsetSec, offsetSec, peakRms, roomNoiseDb };
}

/**
 * Detects the exact acoustic vocal onset offset inside a clip [sourceStartSec, sourceEndSec].
 * Used so that pre-roll / breath shifts left of the reference anchor and actual vocal attack lands synchronously.
 */
export function detectSpeechOnsetOffsetSec(
  audioBuffer: AudioBuffer | undefined,
  sourceStartSec: number,
  sourceEndSec: number
): number {
  return detectClipSpeechBounds(audioBuffer, sourceStartSec, sourceEndSec).onsetOffsetSec;
}

export interface OriginalVocalsAnchorResult {
  refVocalStartSec?: number;
  refVocalEndSec?: number;
  anchorStartSec: number;
  anchorEndSec: number;
  hasRefVocal: boolean;
}

/**
 * Scans separated `original_vocals.wav` in window [subStartSec - 0.06s .. subEndSec + 0.35s]
 * to locate the real original seiyuu speech start (`refVocalStartSec`) and end (`refVocalEndSec`).
 * Ignores pre-subtitle breaths or previous speaker tails and falls back cleanly to subtitle timestamps.
 */
export function findOriginalVocalsAnchorForSub(
  vocalsBuffer: AudioBuffer | undefined,
  subStartSec: number,
  subEndSec: number,
  vocalsNoiseDbHint?: number
): OriginalVocalsAnchorResult {
  if (!vocalsBuffer || typeof vocalsBuffer.getChannelData !== 'function') {
    return { anchorStartSec: subStartSec, anchorEndSec: subEndSec, hasRefVocal: false };
  }

  const sampleRate = vocalsBuffer.sampleRate;
  const numChannels = Math.max(1, vocalsBuffer.numberOfChannels || 1);
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(vocalsBuffer.getChannelData(ch));
  }

  const totalLen = channels[0].length;
  // Never scan 450ms before subStartSec (which captures previous speaker tails or pre-line inhales)!
  const preSubMaxSec = TIMING_RULES.VOCALS_ANCHOR_PRE_SUB_MAX_SEC ?? 0.06;
  const postSubMaxSec = TIMING_RULES.VOCALS_ANCHOR_POST_SUB_MAX_SEC ?? 0.35;
  const scanStartSec = Math.max(0, subStartSec - preSubMaxSec);
  const scanEndSec = Math.min(vocalsBuffer.duration, subEndSec + postSubMaxSec);
  const startSample = Math.max(0, Math.floor(scanStartSec * sampleRate));
  const endSample = Math.min(totalLen, Math.ceil(scanEndSec * sampleRate));

  if (endSample <= startSample + Math.floor(sampleRate * 0.04)) {
    return { anchorStartSec: subStartSec, anchorEndSec: subEndSec, hasRefVocal: false };
  }

  const winSamples = Math.max(64, Math.floor(sampleRate * 0.01)); // 10ms windows
  const numFrames = Math.floor((endSample - startSample) / winSamples);
  if (numFrames <= 0) {
    return { anchorStartSec: subStartSec, anchorEndSec: subEndSec, hasRefVocal: false };
  }

  const rmsFrames = new Float32Array(numFrames);
  let peakRms = 0;
  for (let f = 0; f < numFrames; f++) {
    const base = startSample + f * winSamples;
    let sumSq = 0;
    for (let i = 0; i < winSamples; i++) {
      let s = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        s += channels[ch][base + i];
      }
      s /= numChannels;
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / winSamples);
    rmsFrames[f] = rms;
    if (rms > peakRms) peakRms = rms;
  }

  // Must have real vocal energy (>= -46 dBFS peak)
  const minVoiceFloorAmp = Math.pow(10, -46 / 20);
  if (peakRms < minVoiceFloorAmp) {
    return { anchorStartSec: subStartSec, anchorEndSec: subEndSec, hasRefVocal: false };
  }

  const noiseDb = vocalsNoiseDbHint ?? getAudioBufferRoomNoiseDb(vocalsBuffer);
  const noisePlus12Amp = Math.pow(10, (noiseDb + 12) / 20);
  const threshold = Math.max(noisePlus12Amp, peakRms * 0.16, Math.pow(10, -44 / 20));

  // Build active frame mask and segment into vocal clusters (merging micro-gaps <= 30ms / 3 frames)
  const activeMask = new Uint8Array(numFrames);
  let activeFrames = 0;
  for (let f = 0; f < numFrames; f++) {
    if (rmsFrames[f] <= threshold) continue;
    const confirmedAdj =
      (f + 1 < numFrames && rmsFrames[f + 1] > threshold) ||
      (f - 1 >= 0 && rmsFrames[f - 1] > threshold) ||
      rmsFrames[f] > peakRms * 0.35;
    if (confirmedAdj) {
      activeMask[f] = 1;
      activeFrames++;
    }
  }

  if (activeFrames < 3) {
    return { anchorStartSec: subStartSec, anchorEndSec: subEndSec, hasRefVocal: false };
  }

  // Bridge intra-syllable micro-gaps <= 3 frames (30ms)
  let gapRun = 0;
  for (let f = 0; f < numFrames; f++) {
    if (activeMask[f] === 0) {
      gapRun++;
    } else {
      if (gapRun > 0 && gapRun <= 3 && f - gapRun > 0) {
        for (let k = f - gapRun; k < f; k++) activeMask[k] = 1;
      }
      gapRun = 0;
    }
  }

  const clusters: Array<{ startFrame: number; endFrame: number; durFrames: number; clusterPeak: number }> = [];
  let idx = 0;
  while (idx < numFrames) {
    if (activeMask[idx] === 1) {
      const cStart = idx;
      let cPeak = 0;
      while (idx < numFrames && activeMask[idx] === 1) {
        if (rmsFrames[idx] > cPeak) cPeak = rmsFrames[idx];
        idx++;
      }
      const cEnd = idx;
      if (cEnd - cStart >= 2) {
        clusters.push({
          startFrame: cStart,
          endFrame: cEnd,
          durFrames: cEnd - cStart,
          clusterPeak: cPeak
        });
      }
    } else {
      idx++;
    }
  }

  if (clusters.length === 0) {
    return { anchorStartSec: subStartSec, anchorEndSec: subEndSec, hasRefVocal: false };
  }

  // If the first cluster is a brief pre-speech breath or leftover tail from a previous line
  // (duration <= 150ms or weak peak < 45% of main speech) separated by >= 40ms valley from a main cluster,
  // skip the pre-breath and anchor on the real speech cluster!
  let chosenClusterIdx = 0;
  if (clusters.length >= 2) {
    const first = clusters[0];
    const second = clusters[1];
    const firstStartSec = scanStartSec + (first.startFrame * winSamples) / sampleRate;
    const valleyFrames = second.startFrame - first.endFrame;
    const isFirstPreBreathOrTail =
      firstStartSec <= subStartSec + 0.06 &&
      valleyFrames >= 4 &&
      (first.durFrames <= 15 || first.clusterPeak < peakRms * 0.45) &&
      (second.durFrames >= 10 || second.clusterPeak >= first.clusterPeak * 1.25);
    if (isFirstPreBreathOrTail) {
      chosenClusterIdx = 1;
    }
  }

  let onsetFrame = clusters[chosenClusterIdx].startFrame;
  const offsetFrame = clusters[clusters.length - 1].endFrame;

  // Gentle 1-3 frame (<= 30ms) backward consonant edge walk on the chosen Japanese vocal cluster
  const edgeThreshold = Math.max(Math.pow(10, (noiseDb + 8) / 20), peakRms * 0.08);
  const minEdgeFrame = chosenClusterIdx > 0 ? clusters[chosenClusterIdx - 1].endFrame + 2 : 0;
  for (let b = onsetFrame - 1; b >= Math.max(minEdgeFrame, onsetFrame - 3); b--) {
    if (rmsFrames[b] >= edgeThreshold) {
      onsetFrame = b;
    } else {
      break;
    }
  }

  const minAllowedVocalStartSec = Math.max(0, subStartSec - preSubMaxSec);
  const rawVocalStartSec = scanStartSec + (onsetFrame * winSamples) / sampleRate;
  const refVocalStartSec = Number(Math.max(minAllowedVocalStartSec, rawVocalStartSec).toFixed(3));
  const refVocalEndSec = Number(
    Math.max(refVocalStartSec + 0.08, scanStartSec + (offsetFrame * winSamples) / sampleRate).toFixed(3)
  );

  return {
    refVocalStartSec,
    refVocalEndSec,
    anchorStartSec: refVocalStartSec,
    anchorEndSec: refVocalEndSec,
    hasRefVocal: true
  };
}

/**
 * Measures active speech windows and syllable energy spread inside a clip or buffer region.
 */
export function measureClipActiveSpeechStats(
  audioBuffer: AudioBuffer | undefined,
  startSec: number,
  endSec: number,
  thresholdAmp = 0.008
): {
  activeWindows: number;
  activeSpeechSec: number;
  peakRms: number;
} {
  if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function') {
    const dur = Math.max(0, endSec - startSec);
    return { activeWindows: Math.round(dur / 0.02), activeSpeechSec: dur, peakRms: 0.05 };
  }
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const sSample = Math.max(0, Math.floor(startSec * sampleRate));
  const eSample = Math.min(channelData.length, Math.floor(endSec * sampleRate));
  const winSize = Math.max(128, Math.floor(sampleRate * 0.02));
  let activeWindows = 0;
  let peakRms = 0;

  for (let p = sSample; p + winSize <= eSample; p += winSize) {
    let sumSq = 0;
    for (let j = 0; j < winSize; j++) {
      const v = channelData[p + j];
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / winSize);
    if (rms > peakRms) peakRms = rms;
    if (rms >= thresholdAmp) {
      activeWindows++;
    }
  }

  return {
    activeWindows,
    activeSpeechSec: Number((activeWindows * 0.02).toFixed(2)),
    peakRms
  };
}
