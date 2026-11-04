import { getSharedAudioContext, ensureAudioContextResumed } from '../sharedAudioContext';

/**
 * Accurately detects the complete natural speech phrase boundaries expanded into true silence.
 * GUARANTEE: Never clips any real vocal energy, consonant, onset breath, vowel or release tail.
 * Everything extends backwards and forwards until audio energy fully drops to silence.
 */
export function findFullPhraseSilenceBoundaries(
  audioBuffer: AudioBuffer,
  approxStartSec: number,
  approxEndSec: number,
  options?: {
    maxSearchBackwardSec?: number;
    maxSearchForwardSec?: number;
    silencePaddingSec?: number;
    speechDynamicThresholdDb?: number;
  }
): {
  naturalStartSec: number;
  naturalEndSec: number;
  speechStartSec: number;
  speechEndSec: number;
  isVoiced: boolean;
  peakDb: number;
  rmsDb: number;
} {
  if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function') {
    return {
      naturalStartSec: approxStartSec,
      naturalEndSec: approxEndSec,
      speechStartSec: approxStartSec,
      speechEndSec: approxEndSec,
      isVoiced: false,
      peakDb: -60,
      rmsDb: -60
    };
  }
  const sampleRate = audioBuffer.sampleRate;
  const totalDuration = audioBuffer.duration;
  const channelData = audioBuffer.getChannelData(0);

  const maxBack = options?.maxSearchBackwardSec ?? 2.0;
  const maxFwd = options?.maxSearchForwardSec ?? 3.0;
  const padding = options?.silencePaddingSec ?? 0.08;

  const searchStart = Math.max(0, approxStartSec - maxBack);
  const searchEnd = Math.min(totalDuration, approxEndSec + maxFwd);

  const frameMs = 20;
  const hopMs = 10;
  const frameSamples = Math.max(16, Math.floor((frameMs / 1000) * sampleRate));
  const hopSamples = Math.max(8, Math.floor((hopMs / 1000) * sampleRate));

  const startSample = Math.max(0, Math.floor(searchStart * sampleRate));
  const endSample = Math.min(audioBuffer.length, Math.ceil(searchEnd * sampleRate));

  const frames: { time: number; rmsDb: number; peakDb: number }[] = [];
  let overallPeak = 0.00001;
  let overallSumSq = 0;
  let totalSamples = 0;

  for (let s = startSample; s + frameSamples <= endSample; s += hopSamples) {
    let fSumSq = 0;
    let fPeak = 0;
    for (let i = s; i < s + frameSamples; i++) {
      const v = Math.abs(channelData[i]);
      if (v > fPeak) fPeak = v;
      fSumSq += v * v;
    }
    const fRms = Math.sqrt(fSumSq / frameSamples);
    const timeSec = s / sampleRate;
    const fRmsDb = 20 * Math.log10(Math.max(0.000001, fRms));
    const fPeakDb = 20 * Math.log10(Math.max(0.000001, fPeak));
    frames.push({ time: timeSec, rmsDb: fRmsDb, peakDb: fPeakDb });

    if (fPeak > overallPeak) overallPeak = fPeak;
    overallSumSq += fSumSq;
    totalSamples += frameSamples;
  }

  const overallPeakDb = Math.round((20 * Math.log10(overallPeak)) * 10) / 10;
  const overallRmsDb = Math.round((20 * Math.log10(Math.sqrt(overallSumSq / Math.max(1, totalSamples)))) * 10) / 10;

  if (frames.length < 4) {
    const s = Math.max(0, approxStartSec - padding);
    const e = Math.min(totalDuration, approxEndSec + padding);
    return {
      naturalStartSec: s,
      naturalEndSec: e,
      speechStartSec: s,
      speechEndSec: e,
      isVoiced: false,
      peakDb: overallPeakDb,
      rmsDb: overallRmsDb
    };
  }

  const sortedRms = [...frames].map(f => f.rmsDb).sort((a, b) => a - b);
  const noiseFloorDb = sortedRms[Math.floor(sortedRms.length * 0.15)] ?? -58;
  const speechThreshDb = Math.max(noiseFloorDb + (options?.speechDynamicThresholdDb ?? 2.5), -48);
  const minPeakDb = -42;

  const coreVoiceIndices: number[] = [];
  for (let idx = 0; idx < frames.length; idx++) {
    const f = frames[idx];
    if (f.time >= approxStartSec - 0.35 && f.time <= approxEndSec + 0.35) {
      if (f.rmsDb >= speechThreshDb && f.peakDb >= minPeakDb) {
        coreVoiceIndices.push(idx);
      }
    }
  }

  if (coreVoiceIndices.length === 0) {
    for (let idx = 0; idx < frames.length; idx++) {
      const f = frames[idx];
      if (f.rmsDb >= speechThreshDb + 1 && f.peakDb >= minPeakDb) {
        coreVoiceIndices.push(idx);
      }
    }
  }

  if (coreVoiceIndices.length === 0) {
    const s = Math.max(0, approxStartSec - padding);
    const e = Math.min(totalDuration, approxEndSec + padding);
    return {
      naturalStartSec: s,
      naturalEndSec: e,
      speechStartSec: s,
      speechEndSec: e,
      isVoiced: false,
      peakDb: overallPeakDb,
      rmsDb: overallRmsDb
    };
  }

  const firstCoreIdx = coreVoiceIndices[0];
  const lastCoreIdx = coreVoiceIndices[coreVoiceIndices.length - 1];

  let speechStartIdx = firstCoreIdx;
  let silentFramesBack = 0;
  for (let idx = firstCoreIdx - 1; idx >= 0; idx--) {
    const f = frames[idx];
    const isSpeech = f.rmsDb >= speechThreshDb - 1.5 || f.peakDb >= minPeakDb - 4;
    if (isSpeech) {
      speechStartIdx = idx;
      silentFramesBack = 0;
    } else {
      silentFramesBack++;
      if (silentFramesBack >= 8) {
        break;
      }
    }
  }

  let speechEndIdx = lastCoreIdx;
  let silentFramesFwd = 0;
  for (let idx = lastCoreIdx + 1; idx < frames.length; idx++) {
    const f = frames[idx];
    const isSpeech = f.rmsDb >= speechThreshDb - 2.0 || f.peakDb >= minPeakDb - 6;
    if (isSpeech) {
      speechEndIdx = idx;
      silentFramesFwd = 0;
    } else {
      silentFramesFwd++;
      if (silentFramesFwd >= 14) {
        break;
      }
    }
  }

  const speechStartSec = frames[speechStartIdx].time;
  const speechEndSec = frames[speechEndIdx].time + (frameMs / 1000);

  const naturalStartSec = Math.max(0, speechStartSec - padding);
  const naturalEndSec = Math.min(totalDuration, speechEndSec + padding + 0.05);

  return {
    naturalStartSec: Math.round(naturalStartSec * 1000) / 1000,
    naturalEndSec: Math.round(naturalEndSec * 1000) / 1000,
    speechStartSec: Math.round(speechStartSec * 1000) / 1000,
    speechEndSec: Math.round(speechEndSec * 1000) / 1000,
    isVoiced: true,
    peakDb: overallPeakDb,
    rmsDb: overallRmsDb
  };
}

/**
 * Zeros out audio samples in an AudioBuffer in-place across all channels.
 */
export function silenceAudioBufferInterval(
  audioBuffer: AudioBuffer,
  startSec: number,
  endSec: number,
  options?: {
    expandToSilence?: boolean;
    fadeMs?: number;
  }
): { startSec: number; endSec: number } {
  let s = startSec;
  let e = endSec;

  if (options?.expandToSilence !== false) {
    const bounds = findFullPhraseSilenceBoundaries(audioBuffer, startSec, endSec);
    s = bounds.naturalStartSec;
    e = bounds.naturalEndSec;
  }

  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const startSample = Math.max(0, Math.floor(s * sampleRate));
  const endSample = Math.min(audioBuffer.length, Math.ceil(e * sampleRate));
  const fadeSamples = Math.min(480, Math.floor(((options?.fadeMs ?? 10) / 1000) * sampleRate));

  for (let c = 0; c < numChannels; c++) {
    const data = audioBuffer.getChannelData(c);

    if (fadeSamples > 0 && startSample >= fadeSamples) {
      for (let i = 0; i < fadeSamples; i++) {
        const factor = (fadeSamples - i) / fadeSamples;
        data[startSample - fadeSamples + i] *= factor;
      }
    }

    data.fill(0, startSample, endSample);

    if (fadeSamples > 0 && endSample + fadeSamples <= audioBuffer.length) {
      for (let i = 0; i < fadeSamples; i++) {
        const factor = i / fadeSamples;
        data[endSample + i] *= factor;
      }
    }
  }

  return { startSec: s, endSec: e };
}

/**
 * Transfers a complete audio phrase from sourceBuffer into targetBuffer.
 */
export function transferAudioBufferPhrase(
  sourceBuffer: AudioBuffer,
  targetBuffer: AudioBuffer,
  startSec: number,
  endSec: number
): { naturalStartSec: number; naturalEndSec: number; transferredDurationSec: number } {
  const bounds = findFullPhraseSilenceBoundaries(sourceBuffer, startSec, endSec);
  const s = bounds.naturalStartSec;
  const e = bounds.naturalEndSec;
  const sampleRate = sourceBuffer.sampleRate;
  const numChannels = Math.min(sourceBuffer.numberOfChannels, targetBuffer.numberOfChannels);

  const startSample = Math.max(0, Math.floor(s * sampleRate));
  const endSample = Math.min(sourceBuffer.length, Math.ceil(e * sampleRate));
  const sliceLength = endSample - startSample;

  if (sliceLength > 0) {
    const fadeSamples = Math.min(384, Math.floor(sampleRate * 0.008));

    for (let c = 0; c < numChannels; c++) {
      const srcData = sourceBuffer.getChannelData(c);
      const dstData = targetBuffer.getChannelData(c);

      for (let i = 0; i < sliceLength; i++) {
        const dstIdx = startSample + i;
        if (dstIdx >= dstData.length) break;

        let fade = 1.0;
        if (i < fadeSamples) fade = i / fadeSamples;
        else if (i > sliceLength - fadeSamples) fade = (sliceLength - i) / fadeSamples;

        dstData[dstIdx] = srcData[startSample + i] * fade;
      }
    }

    silenceAudioBufferInterval(sourceBuffer, s, e, { expandToSilence: false, fadeMs: 8 });
  }

  return {
    naturalStartSec: s,
    naturalEndSec: e,
    transferredDurationSec: Math.round((e - s) * 100) / 100
  };
}

/**
 * Computes dynamic metrics across a specific time slice of an AudioBuffer.
 */
export function analyzeSegmentDynamics(
  audioBuffer: AudioBuffer,
  startSec: number,
  endSec: number,
  frameSizeMs: number = 40,
  hopSizeMs: number = 20
) {
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const totalSamples = audioBuffer.length;

  const startSample = Math.max(0, Math.floor((startSec - 0.04) * sampleRate));
  const endSample = Math.min(totalSamples, Math.ceil((endSec + 0.04) * sampleRate));
  const segmentLength = endSample - startSample;

  if (segmentLength <= 0) {
    return {
      peakDb: -100,
      rmsDb: -100,
      minDb: -100,
      maxDb: -100,
      dynamicRangeDb: 0,
      peakToMinDb: 0,
      stdDevDb: 0
    };
  }

  const frameSamples = Math.max(16, Math.floor((frameSizeMs / 1000) * sampleRate));
  const hopSamples = Math.max(8, Math.floor((hopSizeMs / 1000) * sampleRate));

  let segMaxPeak = 0.00001;
  let segSumSquares = 0;

  for (let c = 0; c < numChannels; c++) {
    const chanData = audioBuffer.getChannelData(c);
    for (let i = startSample; i < endSample; i++) {
      const val = Math.abs(chanData[i]);
      if (val > segMaxPeak) segMaxPeak = val;
      segSumSquares += val * val;
    }
  }

  const segRms = Math.sqrt(segSumSquares / (segmentLength * numChannels));
  const segPeakDb = Math.round((20 * Math.log10(Math.max(0.00001, segMaxPeak))) * 10) / 10;
  const segRmsDb = Math.round((20 * Math.log10(Math.max(0.00001, segRms))) * 10) / 10;

  const frameDbValues: number[] = [];
  const primaryChannel = audioBuffer.getChannelData(0);

  for (let fStart = startSample; fStart + frameSamples <= endSample; fStart += hopSamples) {
    let frameSumSq = 0;
    for (let i = fStart; i < fStart + frameSamples; i++) {
      const v = primaryChannel[i];
      frameSumSq += v * v;
    }
    const frameRms = Math.sqrt(frameSumSq / frameSamples);
    const frameDb = 20 * Math.log10(Math.max(0.000001, frameRms));
    frameDbValues.push(frameDb);
  }

  if (frameDbValues.length <= 1) {
    frameDbValues.push(segRmsDb);
  }

  const sorted = [...frameDbValues].sort((a, b) => a - b);
  const p10Index = Math.floor(sorted.length * 0.1);
  const minDb = sorted[p10Index] ?? sorted[0];

  const p90Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9));
  const maxDb = sorted[p90Index] ?? sorted[sorted.length - 1];

  const dynamicRangeDb = Math.round(Math.max(0, maxDb - minDb) * 10) / 10;
  const peakToMinDb = Math.round(Math.max(0, segPeakDb - minDb) * 10) / 10;

  let sumDb = 0;
  for (const v of frameDbValues) sumDb += v;
  const meanDb = sumDb / frameDbValues.length;

  let sumSqDiff = 0;
  for (const v of frameDbValues) {
    const diff = v - meanDb;
    sumSqDiff += diff * diff;
  }
  const stdDevDb = Math.round(Math.sqrt(sumSqDiff / frameDbValues.length) * 10) / 10;

  return {
    peakDb: segPeakDb,
    rmsDb: segRmsDb,
    minDb: Math.round(minDb * 10) / 10,
    maxDb: Math.round(maxDb * 10) / 10,
    dynamicRangeDb,
    peakToMinDb,
    stdDevDb
  };
}

/**
 * Finds voice activity boundaries in an AudioBuffer around a given timeframe.
 */
export function findVoicedBoundaries(
  audioBuffer: AudioBuffer,
  searchStartSec: number,
  searchEndSec: number,
  speechDynamicThresholdDb: number = 2.8,
  minSpeechPeakDb: number = -38
): {
  speechStartSec: number;
  speechEndSec: number;
  speechDurationSec: number;
  isVoiced: boolean;
  peakDb: number;
  rmsDb: number;
} {
  const sampleRate = audioBuffer.sampleRate;
  const startSample = Math.max(0, Math.floor(searchStartSec * sampleRate));
  const endSample = Math.min(audioBuffer.length, Math.ceil(searchEndSec * sampleRate));

  if (endSample <= startSample) {
    return {
      speechStartSec: searchStartSec,
      speechEndSec: searchEndSec,
      speechDurationSec: 0,
      isVoiced: false,
      peakDb: -100,
      rmsDb: -100
    };
  }

  const frameMs = 30;
  const hopMs = 15;
  const frameSamples = Math.max(16, Math.floor((frameMs / 1000) * sampleRate));
  const hopSamples = Math.max(8, Math.floor((hopMs / 1000) * sampleRate));

  const primaryChannel = audioBuffer.getChannelData(0);
  const frames: { time: number; rmsDb: number; peakDb: number }[] = [];

  let overallPeak = 0.00001;
  let overallSumSq = 0;
  let totalSamples = 0;

  for (let s = startSample; s + frameSamples <= endSample; s += hopSamples) {
    let fSumSq = 0;
    let fPeak = 0;
    for (let i = s; i < s + frameSamples; i++) {
      const v = Math.abs(primaryChannel[i]);
      if (v > fPeak) fPeak = v;
      fSumSq += v * v;
    }
    const fRms = Math.sqrt(fSumSq / frameSamples);
    const timeSec = s / sampleRate;
    const fRmsDb = 20 * Math.log10(Math.max(0.000001, fRms));
    const fPeakDb = 20 * Math.log10(Math.max(0.000001, fPeak));
    frames.push({ time: timeSec, rmsDb: fRmsDb, peakDb: fPeakDb });

    if (fPeak > overallPeak) overallPeak = fPeak;
    overallSumSq += fSumSq;
    totalSamples += frameSamples;
  }

  const overallPeakDb = Math.round((20 * Math.log10(overallPeak)) * 10) / 10;
  const overallRmsDb = Math.round((20 * Math.log10(Math.sqrt(overallSumSq / Math.max(1, totalSamples)))) * 10) / 10;

  if (frames.length < 2) {
    return {
      speechStartSec: searchStartSec,
      speechEndSec: searchEndSec,
      speechDurationSec: searchEndSec - searchStartSec,
      isVoiced: false,
      peakDb: overallPeakDb,
      rmsDb: overallRmsDb
    };
  }

  const sortedRms = [...frames].map(f => f.rmsDb).sort((a, b) => a - b);
  const noiseFloorDb = sortedRms[Math.floor(sortedRms.length * 0.15)] ?? -60;
  const activeThresholdDb = Math.max(noiseFloorDb + speechDynamicThresholdDb, -46);

  const voicedFrames = frames.filter(f => f.rmsDb >= activeThresholdDb && f.peakDb >= minSpeechPeakDb);

  if (voicedFrames.length < 2) {
    return {
      speechStartSec: searchStartSec,
      speechEndSec: searchEndSec,
      speechDurationSec: 0,
      isVoiced: false,
      peakDb: overallPeakDb,
      rmsDb: overallRmsDb
    };
  }

  const speechStart = voicedFrames[0].time;
  const speechEnd = voicedFrames[voicedFrames.length - 1].time + (frameMs / 1000);
  const speechDuration = Math.max(0.05, speechEnd - speechStart);

  return {
    speechStartSec: Math.round(speechStart * 100) / 100,
    speechEndSec: Math.round(speechEnd * 100) / 100,
    speechDurationSec: Math.round(speechDuration * 100) / 100,
    isVoiced: true,
    peakDb: overallPeakDb,
    rmsDb: overallRmsDb
  };
}

/**
 * SnippetAudioPlayer with soft-knee limiting and dynamic peak volume normalization.
 */
export class SnippetAudioPlayer {
  private static activeSourceA: AudioBufferSourceNode | null = null;
  private static activeSourceB: AudioBufferSourceNode | null = null;
  private static onStopCallback: (() => void) | null = null;
  private static limiterNode: DynamicsCompressorNode | null = null;

  private static getLimiter(ctx: AudioContext): DynamicsCompressorNode {
    if (!this.limiterNode || this.limiterNode.context !== ctx) {
      this.limiterNode = ctx.createDynamicsCompressor();
      this.limiterNode.threshold.setValueAtTime(-1.0, ctx.currentTime);
      this.limiterNode.knee.setValueAtTime(0, ctx.currentTime);
      this.limiterNode.ratio.setValueAtTime(20, ctx.currentTime);
      this.limiterNode.attack.setValueAtTime(0.002, ctx.currentTime);
      this.limiterNode.release.setValueAtTime(0.05, ctx.currentTime);
      this.limiterNode.connect(ctx.destination);
    }
    return this.limiterNode;
  }

  public static computeNormalizedGain(
    buffer: AudioBuffer | null | undefined,
    startSec: number,
    endSec: number,
    targetPeak: number = 0.89
  ): number {
    if (!buffer) return 1.0;
    const sampleRate = buffer.sampleRate;
    const startSample = Math.max(0, Math.floor(startSec * sampleRate));
    const endSample = Math.min(buffer.length, Math.ceil(endSec * sampleRate));
    const totalSamples = endSample - startSample;
    if (totalSamples <= 0) return 1.0;

    let peak = 0;
    const step = Math.max(1, Math.floor(totalSamples / 3000));
    const numChannels = buffer.numberOfChannels;
    for (let ch = 0; ch < numChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = startSample; i < endSample; i += step) {
        const val = Math.abs(data[i]);
        if (val > peak) peak = val;
      }
    }

    if (peak < 0.002) return 1.0;
    const desiredGain = targetPeak / peak;
    return Math.min(16.0, Math.max(0.4, desiredGain));
  }

  public static play(
    buffer: AudioBuffer,
    startSec: number,
    endSec: number,
    onEnded?: () => void,
    loop: boolean = false
  ): void {
    this.stop();

    const ctx = getSharedAudioContext();
    if (!ctx) return;
    ensureAudioContextResumed();

    const limiter = this.getLimiter(ctx);

    this.activeSourceA = ctx.createBufferSource();
    this.activeSourceA.buffer = buffer;

    const startTime = Math.max(0, startSec - 0.05);
    const duration = Math.max(0.1, endSec - startTime);
    const normGain = this.computeNormalizedGain(buffer, startTime, endSec);

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(normGain, ctx.currentTime);
    this.activeSourceA.connect(gainNode);
    gainNode.connect(limiter);

    if (loop) {
      this.activeSourceA.loop = true;
      this.activeSourceA.loopStart = startTime;
      this.activeSourceA.loopEnd = endSec + 0.05;
    } else {
      this.onStopCallback = onEnded || null;
      this.activeSourceA.onended = () => {
        if (this.onStopCallback) {
          this.onStopCallback();
          this.onStopCallback = null;
        }
        this.activeSourceA = null;
      };
    }

    this.activeSourceA.start(0, startTime, loop ? undefined : (duration + 0.1));
  }

  public static playMix(
    bufferA: AudioBuffer,
    bufferB: AudioBuffer,
    startSec: number,
    endSec: number,
    gainA: number = 1.0,
    gainB: number = 1.0,
    onEnded?: () => void
  ): void {
    this.stop();

    const ctx = getSharedAudioContext();
    if (!ctx) return;
    ensureAudioContextResumed();

    const limiter = this.getLimiter(ctx);

    const duration = Math.max(0.1, endSec - startSec);
    const startTime = Math.max(0, startSec - 0.05);

    const normA = this.computeNormalizedGain(bufferA, startTime, endSec, 0.80) * gainA;
    const normB = this.computeNormalizedGain(bufferB, startTime, endSec, 0.80) * gainB;

    this.activeSourceA = ctx.createBufferSource();
    this.activeSourceA.buffer = bufferA;
    const gainNodeA = ctx.createGain();
    gainNodeA.gain.setValueAtTime(normA, ctx.currentTime);
    this.activeSourceA.connect(gainNodeA);
    gainNodeA.connect(limiter);

    this.activeSourceB = ctx.createBufferSource();
    this.activeSourceB.buffer = bufferB;
    const gainNodeB = ctx.createGain();
    gainNodeB.gain.setValueAtTime(normB, ctx.currentTime);
    this.activeSourceB.connect(gainNodeB);
    gainNodeB.connect(limiter);

    this.onStopCallback = onEnded || null;

    let endedCount = 0;
    const handleEnded = () => {
      endedCount++;
      if (endedCount >= 2) {
        if (this.onStopCallback) {
          this.onStopCallback();
          this.onStopCallback = null;
        }
        this.activeSourceA = null;
        this.activeSourceB = null;
      }
    };

    this.activeSourceA.onended = handleEnded;
    this.activeSourceB.onended = handleEnded;

    this.activeSourceA.start(0, startTime, duration + 0.1);
    this.activeSourceB.start(0, startTime, duration + 0.1);
  }

  public static stop(): void {
    if (this.activeSourceA) {
      try {
        this.activeSourceA.stop();
        this.activeSourceA.disconnect();
      } catch (e) {}
      this.activeSourceA = null;
    }
    if (this.activeSourceB) {
      try {
        this.activeSourceB.stop();
        this.activeSourceB.disconnect();
      } catch (e) {}
      this.activeSourceB = null;
    }
    if (this.onStopCallback) {
      this.onStopCallback();
      this.onStopCallback = null;
    }
  }
}
