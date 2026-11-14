import { getAudioBufferRoomNoiseDb } from './timing.dsp';

export interface OccupiedVocalInterval {
  startSec: number;
  endSec: number;
}

export interface PhysicsBurstResult {
  found: boolean;
  burstStartSec?: number;
  burstEndSec?: number;
  burstDurationSec?: number;
}

export interface QuietValleyResult {
  valleySec: number;
  valleyRms: number;
}

export interface ClipInternalPause {
  pauseStartSec: number;
  pauseEndSec: number;
  pauseDurationSec: number;
  valleyCenterSec: number;
}

export interface OriginalVocalsPauseCheckResult {
  hasPause: boolean;
  origPauseStartSec?: number;
  origPauseEndSec?: number;
  origHalf1StartSec: number;
  origHalf1EndSec: number;
  origHalf2StartSec?: number;
  origHalf2EndSec?: number;
}

function compute10msRmsFrames(
  audioBuffer: AudioBuffer,
  rangeStartSec: number,
  rangeEndSec: number
): {
  rmsFrames: Float32Array;
  frameDurSec: number;
  actualStartSec: number;
  peakRms: number;
} | null {
  if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function') return null;
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = Math.max(1, audioBuffer.numberOfChannels || 1);
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(audioBuffer.getChannelData(ch));
  }
  const totalLen = channels[0].length;
  const winSamples = Math.max(64, Math.floor(sampleRate * 0.01)); // 10ms window
  const frameDurSec = winSamples / sampleRate;

  const sSample = Math.max(0, Math.floor(Math.max(0, rangeStartSec) * sampleRate));
  const eSample = Math.min(totalLen, Math.ceil(Math.min(audioBuffer.duration, rangeEndSec) * sampleRate));
  const numFrames = Math.floor((eSample - sSample) / winSamples);
  if (numFrames <= 0) return null;

  const rmsFrames = new Float32Array(numFrames);
  let peakRms = 0;
  for (let f = 0; f < numFrames; f++) {
    const base = sSample + f * winSamples;
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

  return {
    rmsFrames,
    frameDurSec,
    actualStartSec: sSample / sampleRate,
    peakRms
  };
}

/**
 * Rule 1: Smart "Физика" Sync.
 * Scans a ±1.0s window around the clip on `original_vocals.wav` looking for an unoccupied
 * non-dialogue vocal burst (duration 0.12s .. 2.50s) that does not overlap dialogue lines.
 */
export function findOriginalVocalsBurstForPhysics(
  vocalsBuffer: AudioBuffer | undefined,
  clipStartSec: number,
  clipEndSec: number,
  speechOnsetOffsetSec: number,
  occupiedWindows: OccupiedVocalInterval[],
  vocalsNoiseDbHint?: number
): PhysicsBurstResult {
  if (!vocalsBuffer || typeof vocalsBuffer.getChannelData !== 'function') {
    return { found: false };
  }

  const clipVocalAttack = clipStartSec + (speechOnsetOffsetSec || 0);
  const scanStartSec = Math.max(0, clipStartSec - 1.0);
  const scanEndSec = Math.min(vocalsBuffer.duration, Math.max(clipEndSec + 1.0, clipStartSec + 3.5));
  const frames = compute10msRmsFrames(vocalsBuffer, scanStartSec, scanEndSec);
  if (!frames || frames.rmsFrames.length < 12) return { found: false };

  const minFloorAmp = Math.pow(10, -47 / 20);
  if (frames.peakRms < minFloorAmp) return { found: false };

  const noiseDb = vocalsNoiseDbHint ?? getAudioBufferRoomNoiseDb(vocalsBuffer);
  const noisePlus10Amp = Math.pow(10, (noiseDb + 10) / 20);
  const threshold = Math.max(noisePlus10Amp, frames.peakRms * 0.14, Math.pow(10, -44 / 20));

  const n = frames.rmsFrames.length;
  const active = new Uint8Array(n);
  for (let f = 0; f < n; f++) {
    if (frames.rmsFrames[f] > threshold) {
      const adj =
        (f + 1 < n && frames.rmsFrames[f + 1] > threshold * 0.8) ||
        (f - 1 >= 0 && frames.rmsFrames[f - 1] > threshold * 0.8) ||
        frames.rmsFrames[f] > frames.peakRms * 0.30;
      if (adj) active[f] = 1;
    }
  }

  // Merge tiny breath dips <= 120ms inside a single laugh/cry/gasp burst
  const maxMergeDipFrames = Math.max(2, Math.round(0.12 / frames.frameDurSec));
  let zeroRun = 0;
  for (let f = 0; f < n; f++) {
    if (active[f] === 0) {
      zeroRun++;
    } else {
      if (zeroRun > 0 && zeroRun <= maxMergeDipFrames) {
        for (let k = f - zeroRun; k < f; k++) active[k] = 1;
      }
      zeroRun = 0;
    }
  }

  const bursts: Array<{ startSec: number; endSec: number; durationSec: number; dist: number }> = [];
  let inBurst = false;
  let bStartFrame = 0;

  for (let f = 0; f <= n; f++) {
    const isAct = f < n && active[f] === 1;
    if (isAct && !inBurst) {
      inBurst = true;
      bStartFrame = f;
    } else if (!isAct && inBurst) {
      inBurst = false;
      const bStart = Number((frames.actualStartSec + bStartFrame * frames.frameDurSec).toFixed(3));
      const bEnd = Number((frames.actualStartSec + f * frames.frameDurSec).toFixed(3));
      const bDur = Number((bEnd - bStart).toFixed(3));

      if (bDur >= 0.12 && bDur <= 2.50 && Math.abs(bStart - clipVocalAttack) <= 1.0) {
        const isOccupied = occupiedWindows.some(occ => {
          const ov = Math.min(bEnd, occ.endSec + 0.06) - Math.max(bStart, occ.startSec - 0.06);
          return ov >= Math.min(0.08, bDur * 0.25);
        });
        if (!isOccupied) {
          bursts.push({
            startSec: bStart,
            endSec: bEnd,
            durationSec: bDur,
            dist: Math.abs(bStart - clipVocalAttack)
          });
        }
      }
    }
  }

  if (bursts.length === 0) return { found: false };
  bursts.sort((a, b) => a.dist - b.dist);
  const best = bursts[0];
  return {
    found: true,
    burstStartSec: best.startSec,
    burstEndSec: best.endSec,
    burstDurationSec: best.durationSec
  };
}

/**
 * Rule 2A: Finds the quietest 40-ms (4 x 10ms) RMS valley inside [searchStartSec .. searchEndSec].
 */
export function findQuietValley40msInBuffer(
  audioBuffer: AudioBuffer | undefined,
  searchStartSec: number,
  searchEndSec: number
): QuietValleyResult | null {
  if (!audioBuffer || searchEndSec <= searchStartSec + 0.05) return null;
  const frames = compute10msRmsFrames(audioBuffer, searchStartSec, searchEndSec);
  if (!frames || frames.rmsFrames.length < 4) return null;

  let minAvg = Infinity;
  let minStartIdx = 0;
  const winLen = 4; // 40ms (4 x 10ms)
  for (let f = 0; f <= frames.rmsFrames.length - winLen; f++) {
    const avg =
      (frames.rmsFrames[f] +
        frames.rmsFrames[f + 1] +
        frames.rmsFrames[f + 2] +
        frames.rmsFrames[f + 3]) /
      winLen;
    if (avg < minAvg) {
      minAvg = avg;
      minStartIdx = f;
    }
  }

  return {
    valleySec: Number((frames.actualStartSec + (minStartIdx + winLen / 2) * frames.frameDurSec).toFixed(3)),
    valleyRms: minAvg
  };
}

/**
 * Rule 2B: Scans a clip [sourceStartSec .. sourceEndSec] for an interior pause (200-550ms)
 * bordered by active speech (>= 100ms) on both sides.
 */
export function detectInternalPausesInClip(
  audioBuffer: AudioBuffer | undefined,
  sourceStartSec: number,
  sourceEndSec: number,
  minPauseSec = 0.20,
  maxPauseSec = 0.55,
  roomNoiseDbHint?: number
): ClipInternalPause[] {
  const clipDur = (sourceEndSec || 0) - (sourceStartSec || 0);
  if (!audioBuffer || clipDur < 0.65) return [];

  const frames = compute10msRmsFrames(audioBuffer, sourceStartSec, sourceEndSec);
  if (!frames || frames.rmsFrames.length < 40) return [];

  const noiseDb = roomNoiseDbHint ?? getAudioBufferRoomNoiseDb(audioBuffer);
  const noiseFloorAmp = Math.pow(10, noiseDb / 20);
  const silenceThreshold = Math.max(noiseFloorAmp * 2.4, Math.pow(10, (noiseDb + 9) / 20), frames.peakRms * 0.09);

  const n = frames.rmsFrames.length;
  const isSilent = new Uint8Array(n);
  for (let f = 0; f < n; f++) {
    isSilent[f] = frames.rmsFrames[f] < silenceThreshold ? 1 : 0;
  }

  // Smooth tiny 10ms isolated spikes inside a genuine pause
  for (let f = 1; f < n - 1; f++) {
    if (isSilent[f - 1] === 1 && isSilent[f + 1] === 1) {
      isSilent[f] = 1;
    }
  }

  const minEdgeSpeechFrames = Math.max(8, Math.round(0.10 / frames.frameDurSec));
  const pauses: ClipInternalPause[] = [];

  let firstActive = -1;
  let lastActive = -1;
  for (let f = 0; f < n; f++) {
    if (isSilent[f] === 0) {
      if (firstActive === -1) firstActive = f;
      lastActive = f;
    }
  }
  if (firstActive === -1 || lastActive - firstActive < minEdgeSpeechFrames * 2) return [];

  let inPause = false;
  let pStart = 0;
  for (let f = firstActive; f <= lastActive; f++) {
    if (isSilent[f] === 1 && !inPause) {
      inPause = true;
      pStart = f;
    } else if (isSilent[f] === 0 && inPause) {
      inPause = false;
      const beforeActiveCount = pStart - firstActive;
      const afterActiveCount = lastActive - f + 1;
      if (beforeActiveCount >= minEdgeSpeechFrames && afterActiveCount >= minEdgeSpeechFrames) {
        const pStartSec = Number((frames.actualStartSec + pStart * frames.frameDurSec).toFixed(3));
        const pEndSec = Number((frames.actualStartSec + f * frames.frameDurSec).toFixed(3));
        const pDur = Number((pEndSec - pStartSec).toFixed(3));
        if (pDur >= minPauseSec && pDur <= maxPauseSec) {
          // Locate quietest 40ms valley center inside the pause
          let bestIdx = Math.floor((pStart + f) / 2);
          let min4 = Infinity;
          for (let k = pStart; k <= f - 4; k++) {
            const avg =
              (frames.rmsFrames[k] +
                frames.rmsFrames[k + 1] +
                frames.rmsFrames[k + 2] +
                frames.rmsFrames[k + 3]) /
              4;
            if (avg < min4) {
              min4 = avg;
              bestIdx = k + 2;
            }
          }
          pauses.push({
            pauseStartSec: pStartSec,
            pauseEndSec: pEndSec,
            pauseDurationSec: pDur,
            valleyCenterSec: Number((frames.actualStartSec + bestIdx * frames.frameDurSec).toFixed(3))
          });
        }
      }
    }
  }

  return pauses;
}

/**
 * Rule 2B: Checks whether `original_vocals.wav` inside [subStartSec .. subEndSec] has a genuine pause (> 180ms)
 * around the proportional pause position inside the sentence, and resolves both speech halves if present.
 */
export function checkOriginalVocalsPauseInWindow(
  vocalsBuffer: AudioBuffer | undefined,
  subStartSec: number,
  subEndSec: number,
  approxRelFrac: number,
  searchRadiusSec = 0.45,
  minOrigPauseSec = 0.18,
  vocalsNoiseDbHint?: number
): OriginalVocalsPauseCheckResult {
  const fallback: OriginalVocalsPauseCheckResult = {
    hasPause: false,
    origHalf1StartSec: subStartSec,
    origHalf1EndSec: subEndSec
  };
  if (!vocalsBuffer || subEndSec <= subStartSec + 0.4) return fallback;

  const scanStart = Math.max(0, subStartSec - 0.35);
  const scanEnd = Math.min(vocalsBuffer.duration, subEndSec + 0.35);
  const frames = compute10msRmsFrames(vocalsBuffer, scanStart, scanEnd);
  if (!frames || frames.rmsFrames.length < 30 || frames.peakRms < Math.pow(10, -46 / 20)) {
    return fallback;
  }

  const noiseDb = vocalsNoiseDbHint ?? getAudioBufferRoomNoiseDb(vocalsBuffer);
  const threshold = Math.max(Math.pow(10, (noiseDb + 11) / 20), frames.peakRms * 0.14, Math.pow(10, -44 / 20));
  const n = frames.rmsFrames.length;
  const isSilent = new Uint8Array(n);
  for (let f = 0; f < n; f++) {
    isSilent[f] = frames.rmsFrames[f] <= threshold ? 1 : 0;
  }

  let firstAct = -1;
  let lastAct = -1;
  for (let f = 0; f < n; f++) {
    if (isSilent[f] === 0) {
      if (firstAct === -1) firstAct = f;
      lastAct = f;
    }
  }
  if (firstAct === -1 || lastAct <= firstAct + 20) return fallback;

  const origStart = Number((frames.actualStartSec + firstAct * frames.frameDurSec).toFixed(3));
  const origEnd = Number((frames.actualStartSec + (lastAct + 1) * frames.frameDurSec).toFixed(3));
  const expectedPauseCenterSec = origStart + (origEnd - origStart) * Math.max(0.15, Math.min(0.85, approxRelFrac));

  let bestPause: { start: number; end: number; dist: number; firstAfterIdx: number; lastBeforeIdx: number } | null = null;
  let inPause = false;
  let pStart = 0;

  for (let f = firstAct; f <= lastAct; f++) {
    if (isSilent[f] === 1 && !inPause) {
      inPause = true;
      pStart = f;
    } else if (isSilent[f] === 0 && inPause) {
      inPause = false;
      const pStartSec = frames.actualStartSec + pStart * frames.frameDurSec;
      const pEndSec = frames.actualStartSec + f * frames.frameDurSec;
      const pDur = pEndSec - pStartSec;
      const pCenter = (pStartSec + pEndSec) / 2;
      const dist = Math.abs(pCenter - expectedPauseCenterSec);
      const hasEnoughSpeechBefore = pStart - firstAct >= 8;
      const hasEnoughSpeechAfter = lastAct - f + 1 >= 8;

      if (pDur > minOrigPauseSec && dist <= searchRadiusSec + 0.35 && hasEnoughSpeechBefore && hasEnoughSpeechAfter) {
        if (!bestPause || dist < bestPause.dist) {
          bestPause = {
            start: Number(pStartSec.toFixed(3)),
            end: Number(pEndSec.toFixed(3)),
            dist,
            lastBeforeIdx: pStart,
            firstAfterIdx: f
          };
        }
      }
    }
  }

  if (!bestPause) {
    return {
      hasPause: false,
      origHalf1StartSec: origStart,
      origHalf1EndSec: origEnd
    };
  }

  return {
    hasPause: true,
    origPauseStartSec: bestPause.start,
    origPauseEndSec: bestPause.end,
    origHalf1StartSec: origStart,
    origHalf1EndSec: Number((frames.actualStartSec + bestPause.lastBeforeIdx * frames.frameDurSec).toFixed(3)),
    origHalf2StartSec: Number((frames.actualStartSec + bestPause.firstAfterIdx * frames.frameDurSec).toFixed(3)),
    origHalf2EndSec: origEnd
  };
}
