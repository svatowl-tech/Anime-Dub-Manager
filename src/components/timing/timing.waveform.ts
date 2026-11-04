import {
  AudioClip,
  OriginalWaveformStats,
  Track,
  SubtitleLine
} from './timing.types';
import {
  analyzeTrackAudioNoiseFloor,
  detectSpeechOnsetOffsetSec,
  measureClipActiveSpeechStats
} from './timing.dsp';

/**
 * Targeted local window speech scanner for the Iterative Self-Healing Final Audit.
 * Scans a strictly bounded local window [windowStartSec, windowEndSec] in a Fix or Original AudioBuffer
 * to recover genuinely missing phrases without ever merging adjacent lines or picking up room noise.
 */
export function scanBufferWindowForSpeech(
  audioBuffer: AudioBuffer,
  windowStartSec: number,
  windowEndSec: number,
  leadInSec = 0.08,
  leadOutSec = 0.12
): Array<{ startSec: number; endSec: number; durationSec: number }> {
  if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function') return [];
  const calib = analyzeTrackAudioNoiseFloor(audioBuffer);
  const sensitiveDb = Math.max(
    -52,
    calib.noiseFloorDb + 8.0,
    Math.min(-40, calib.calculatedThresholdDb - 3.0)
  );
  const thresholdAmp = Math.pow(10, sensitiveDb / 20);
  const edgeAmp = Math.pow(10, Math.max(-56, calib.noiseFloorDb + 6.0, sensitiveDb - 4.0) / 20);

  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const startSecClamped = Math.max(0, windowStartSec);
  const endSecClamped = Math.min(audioBuffer.duration, windowEndSec);
  if (endSecClamped <= startSecClamped + 0.14) return [];

  const sSample = Math.floor(startSecClamped * sampleRate);
  const eSample = Math.min(channelData.length, Math.floor(endSecClamped * sampleRate));
  const chunkSize = Math.max(128, Math.floor(sampleRate * 0.02));
  const numChunks = Math.floor((eSample - sSample) / chunkSize);
  if (numChunks <= 0) return [];

  const chunkRms = new Float32Array(numChunks);
  const isSpeech = new Uint8Array(numChunks);
  for (let i = 0; i < numChunks; i++) {
    let sumSq = 0;
    const off = sSample + i * chunkSize;
    for (let j = 0; j < chunkSize; j++) {
      const v = channelData[off + j];
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / chunkSize);
    chunkRms[i] = rms;
    if (rms >= thresholdAmp) isSpeech[i] = 1;
  }

  // Smooth micro-gaps < 160ms
  const smoothChunks = Math.floor(0.16 / 0.02);
  let gap = 0;
  for (let i = 0; i < numChunks; i++) {
    if (isSpeech[i] === 0) {
      gap++;
    } else {
      if (gap > 0 && gap < smoothChunks) {
        for (let k = i - gap; k < i; k++) isSpeech[k] = 1;
      }
      gap = 0;
    }
  }

  // Tight local edge expansion (up to 80ms back, 100ms forward)
  for (let i = 0; i < numChunks; i++) {
    if (isSpeech[i] === 1) {
      for (let b = i - 1; b >= Math.max(0, i - 4); b--) {
        if (chunkRms[b] >= edgeAmp) isSpeech[b] = 1;
        else break;
      }
      while (i < numChunks && isSpeech[i] === 1) i++;
      const endIdx = i - 1;
      for (let f = endIdx + 1; f < Math.min(numChunks, endIdx + 5); f++) {
        if (chunkRms[f] >= edgeAmp) isSpeech[f] = 1;
        else break;
      }
    }
  }

  const effLeadIn = Math.min(0.10, Math.max(0.05, leadInSec));
  const effLeadOut = Math.min(0.14, Math.max(0.08, leadOutSec));

  const found: Array<{ startSec: number; endSec: number; durationSec: number }> = [];
  let inSeg = false;
  let segStart = 0;
  for (let i = 0; i < numChunks; i++) {
    const t = startSecClamped + (i * chunkSize) / sampleRate;
    if (isSpeech[i] === 1 && !inSeg) {
      inSeg = true;
      segStart = Math.max(0, t - effLeadIn);
    } else if (isSpeech[i] === 0 && inSeg) {
      inSeg = false;
      const segEnd = Math.min(audioBuffer.duration, t + effLeadOut);
      if (segEnd - segStart >= 0.16) {
        found.push({
          startSec: Number(segStart.toFixed(2)),
          endSec: Number(segEnd.toFixed(2)),
          durationSec: Number((segEnd - segStart).toFixed(2))
        });
      }
    }
  }
  if (inSeg) {
    const segEnd = endSecClamped;
    if (segEnd - segStart >= 0.16) {
      found.push({
        startSec: Number(segStart.toFixed(2)),
        endSec: Number(segEnd.toFixed(2)),
        durationSec: Number((segEnd - segStart).toFixed(2))
      });
    }
  }
  return found;
}

/**
 * Computes auto-normalized peaks and detected speech phrase segments for the original video waveform.
 */
export function computeOriginalWaveformPeakStats(
  originalWaveformPeaks: number[] | null,
  duration: number
): OriginalWaveformStats | null {
  if (!originalWaveformPeaks || originalWaveformPeaks.length === 0) return null;
  const n = originalWaveformPeaks.length;
  const nonZero = originalWaveformPeaks.filter(p => p > 0.002).sort((a, b) => a - b);
  const p95 = nonZero.length > 0 ? nonZero[Math.floor(nonZero.length * 0.95)] : 0.5;
  const median = nonZero.length > 0 ? nonZero[Math.floor(nonZero.length * 0.35)] : 0.03;

  const normFactor = p95 > 0.01 ? Math.min(6.0, 0.92 / p95) : 1.0;

  const normPeaks = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const raw = originalWaveformPeaks[i] || 0;
    const boosted = Math.min(1.0, raw * normFactor);
    normPeaks[i] = boosted > 0.005 ? Math.pow(boosted, 0.68) : 0;
  }

  const secPerBin = Math.max(0.01, duration / n);
  const speechTrigger = Math.max(0.018, median * 1.45);
  const speechSustain = Math.max(0.012, median * 1.15);
  const minGapBins = Math.max(2, Math.round(0.22 / secPerBin));
  const minSpeechBins = Math.max(2, Math.round(0.12 / secPerBin));

  const phraseSegments: Array<{ startSec: number; endSec: number; peakDb: number }> = [];
  let inSeg = false;
  let segStartIdx = 0;
  let lastActiveIdx = 0;
  let quietBins = 0;
  let maxPeakInSeg = 0;

  for (let i = 0; i < n; i++) {
    const val = originalWaveformPeaks[i] || 0;
    if (!inSeg) {
      if (val >= speechTrigger) {
        inSeg = true;
        segStartIdx = i;
        lastActiveIdx = i;
        quietBins = 0;
        maxPeakInSeg = val;
      }
    } else {
      if (val >= speechSustain) {
        lastActiveIdx = i;
        quietBins = 0;
        if (val > maxPeakInSeg) maxPeakInSeg = val;
      } else {
        quietBins++;
        if (quietBins >= minGapBins) {
          if (lastActiveIdx - segStartIdx + 1 >= minSpeechBins) {
            const st = Math.max(0, segStartIdx * secPerBin - 0.04);
            const en = Math.min(duration, (lastActiveIdx + 1) * secPerBin + 0.06);
            const db = maxPeakInSeg > 1e-5 ? Math.round(20 * Math.log10(maxPeakInSeg)) : -60;
            phraseSegments.push({ startSec: Number(st.toFixed(2)), endSec: Number(en.toFixed(2)), peakDb: db });
          }
          inSeg = false;
        }
      }
    }
  }

  if (inSeg && lastActiveIdx - segStartIdx + 1 >= minSpeechBins) {
    const st = Math.max(0, segStartIdx * secPerBin - 0.04);
    const en = Math.min(duration, (lastActiveIdx + 1) * secPerBin + 0.06);
    const db = maxPeakInSeg > 1e-5 ? Math.round(20 * Math.log10(maxPeakInSeg)) : -60;
    phraseSegments.push({ startSec: Number(st.toFixed(2)), endSec: Number(en.toFixed(2)), peakDb: db });
  }

  return {
    peaks: originalWaveformPeaks,
    normPeaks,
    phraseSegments,
    p95,
    median
  };
}

/**
 * Extracts fallback WebAudio peaks directly from an audio/video URL in browser mode.
 */
export async function extractFallbackWebAudioPeaks(
  mediaUrl: string,
  audioCtx: AudioContext,
  samplesCount: number = 2500
): Promise<{ peaks: number[]; duration: number } | null> {
  const response = await fetch(mediaUrl);
  if (!response.ok) return null;
  const arrayBuf = await response.arrayBuffer();
  const decoded = await audioCtx.decodeAudioData(arrayBuf.slice(0));
  const chan = decoded.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(chan.length / samplesCount));
  const peaks: number[] = [];
  let maxPeak = 0.001;
  for (let i = 0; i < samplesCount; i++) {
    const start = i * blockSize;
    let max = 0;
    for (let j = 0; j < blockSize && start + j < chan.length; j += 8) {
      const v = Math.abs(chan[start + j]);
      if (v > max) max = v;
    }
    peaks.push(max);
    if (max > maxPeak) maxPeak = max;
  }
  return {
    peaks: peaks.map(p => Number((p / maxPeak).toFixed(3))),
    duration: decoded.duration
  };
}

/**
 * Monotonic Subtitle-to-Clip Binding Service:
 * Ensures clips have accurate 1-to-1 (or 1-to-K continuous breath) subtitle locks,
 * speechOnsetOffsetSec, and isPhysics protection.
 */
export function bindTrackClipsToSubtitlesMonotonicallyService(
  track: Track,
  rawClips: AudioClip[],
  trSubs: SubtitleLine[],
  audioBuffersMap: Record<string, AudioBuffer>
): AudioClip[] {
  const characterName = track.character || track.characterName || 'Персонаж';
  const trackBuf = audioBuffersMap[track.id];

  const clips = [...rawClips]
    .map(c => ({ ...c }))
    .sort((a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0)));

  if (trSubs.length === 0 || clips.length === 0) return clips;

  for (let i = 0; i < clips.length; i++) {
    if (clips[i].speechOnsetOffsetSec === undefined) {
      const srcBuf = audioBuffersMap[clips[i].sourceAudioTrackId || track.id] || trackBuf;
      clips[i].speechOnsetOffsetSec = detectSpeechOnsetOffsetSec(srcBuf, clips[i].sourceStartSec, clips[i].sourceEndSec);
    }
  }

  const assignedSubIndices = new Set<number>();
  const clipMatchedSubIdx = new Array<number>(clips.length).fill(-1);
  const clipIsSplitContinuation = new Array<boolean>(clips.length).fill(false);
  const clipCoveredSubIndices: number[][] = Array.from({ length: clips.length }, () => []);

  const isWithinTrackCorridor = (cIdx: number, targetStartSec: number): boolean => {
    const clip = clips[cIdx];
    const prevEnd = cIdx > 0
      ? (clips[cIdx - 1].clipStartSec + (clips[cIdx - 1].offsetSec || 0) + clips[cIdx - 1].durationSec + 0.02)
      : 0;
    const nextStart = cIdx + 1 < clips.length
      ? (clips[cIdx + 1].clipStartSec + (clips[cIdx + 1].offsetSec || 0) - 0.02)
      : Infinity;
    return targetStartSec >= prevEnd - 0.30 && (targetStartSec + Math.min(clip.durationSec, 1.0)) <= nextStart + 0.30;
  };

  const isMonotonicCompatible = (cIdx: number, sIdx: number): boolean => {
    for (let i = 0; i < cIdx; i++) {
      if (clipMatchedSubIdx[i] !== -1 && clipMatchedSubIdx[i] >= sIdx) return false;
    }
    for (let i = cIdx + 1; i < clips.length; i++) {
      if (clipMatchedSubIdx[i] !== -1 && clipMatchedSubIdx[i] <= sIdx) return false;
    }
    return true;
  };

  const expandMultiSubCoverage = (cIdx: number, primarySIdx: number) => {
    const clip = clips[cIdx];
    const cStart = clip.clipStartSec + (clip.offsetSec || 0);
    const primarySub = trSubs[primarySIdx];
    const effectiveEnd = Math.max(cStart + clip.durationSec, primarySub.startSec + clip.durationSec);
    const nextClipStart = cIdx + 1 < clips.length
      ? (clips[cIdx + 1].clipStartSec + (clips[cIdx + 1].offsetSec || 0))
      : Infinity;

    if (!clipCoveredSubIndices[cIdx].includes(primarySIdx)) {
      clipCoveredSubIndices[cIdx].push(primarySIdx);
    }

    let curSIdx = primarySIdx;
    while (curSIdx + 1 < trSubs.length) {
      const nxtSIdx = curSIdx + 1;
      if (assignedSubIndices.has(nxtSIdx)) break;
      const prevSub = trSubs[curSIdx];
      const nxtSub = trSubs[nxtSIdx];
      if (nxtSub.startSec - prevSub.endSec > 1.25) break;
      if (Math.abs(nextClipStart - nxtSub.startSec) <= 0.85) break;

      const nxtSubDur = Math.max(0.25, nxtSub.endSec - nxtSub.startSec);
      const overlapIntoNextSub = effectiveEnd - nxtSub.startSec;
      if (overlapIntoNextSub >= Math.min(0.40, nxtSubDur * 0.38)) {
        assignedSubIndices.add(nxtSIdx);
        clipCoveredSubIndices[cIdx].push(nxtSIdx);
        curSIdx = nxtSIdx;
      } else {
        break;
      }
    }
  };

  const candidatePairs: Array<{ cIdx: number; sIdx: number; score: number }> = [];
  for (let cIdx = 0; cIdx < clips.length; cIdx++) {
    const clip = clips[cIdx];
    const cStart = clip.clipStartSec + (clip.offsetSec || 0);
    const speechStats = measureClipActiveSpeechStats(
      audioBuffersMap[clip.sourceAudioTrackId || track.id] || trackBuf,
      clip.sourceStartSec,
      clip.sourceEndSec
    );
    for (let sIdx = 0; sIdx < trSubs.length; sIdx++) {
      const sub = trSubs[sIdx];
      const signedDiff = cStart - sub.startSec;
      const diff = Math.abs(signedDiff);
      if (signedDiff >= -0.70 && signedDiff <= 1.35 && isWithinTrackCorridor(cIdx, sub.startSec)) {
        const subDur = Math.max(0.25, sub.endSec - sub.startSec);
        const durRatio = Math.min(clip.durationSec, subDur) / Math.max(clip.durationSec, subDur);
        const shortBreathPenalty = (clip.durationSec < 0.22 && speechStats.activeWindows < 7 && subDur > 0.85) ? 1.5 : 0;
        const score = diff - durRatio * 0.35 + shortBreathPenalty;
        candidatePairs.push({ cIdx, sIdx, score });
      }
    }
  }
  candidatePairs.sort((a, b) => a.score - b.score);
  for (const pair of candidatePairs) {
    if (clipMatchedSubIdx[pair.cIdx] !== -1 || assignedSubIndices.has(pair.sIdx)) continue;
    if (!isMonotonicCompatible(pair.cIdx, pair.sIdx)) continue;
    clipMatchedSubIdx[pair.cIdx] = pair.sIdx;
    assignedSubIndices.add(pair.sIdx);
    expandMultiSubCoverage(pair.cIdx, pair.sIdx);
  }

  for (let cIdx = 1; cIdx < clips.length; cIdx++) {
    if (clipMatchedSubIdx[cIdx] !== -1) continue;
    const prevSubIdx = clipMatchedSubIdx[cIdx - 1];
    if (prevSubIdx === -1) continue;

    const prevClip = clips[cIdx - 1];
    const curClip = clips[cIdx];
    const prevEnd = prevClip.clipStartSec + (prevClip.offsetSec || 0) + prevClip.durationSec;
    const curStart = curClip.clipStartSec + (curClip.offsetSec || 0);
    const gapFromPrevClip = curStart - prevEnd;

    const coveredByPrev = clipCoveredSubIndices[cIdx - 1].length > 0
      ? clipCoveredSubIndices[cIdx - 1]
      : [prevSubIdx];
    const lastCoveredSubIdx = coveredByPrev[coveredByPrev.length - 1];
    const prevSub = trSubs[lastCoveredSubIdx] || trSubs[prevSubIdx];
    const nextUnassignedSub = lastCoveredSubIdx + 1 < trSubs.length ? trSubs[lastCoveredSubIdx + 1] : null;

    const isInsideOrNearPrevSub =
      curStart <= prevSub.endSec + 0.95 ||
      (gapFromPrevClip <= 1.35 && (prevClip.durationSec + gapFromPrevClip + curClip.durationSec) <= (prevSub.endSec - prevSub.startSec) + 1.45);
    const isCloserToNextSub =
      nextUnassignedSub !== null &&
      Math.abs(curStart - nextUnassignedSub.startSec) <= 0.60 &&
      curStart >= prevSub.endSec + 0.15 &&
      Math.abs(curStart - nextUnassignedSub.startSec) <= gapFromPrevClip;

    if (gapFromPrevClip >= -0.05 && gapFromPrevClip <= 1.35 && isInsideOrNearPrevSub && !isCloserToNextSub) {
      clipMatchedSubIdx[cIdx] = prevSubIdx;
      clipIsSplitContinuation[cIdx] = true;
      clipCoveredSubIndices[cIdx] = [...coveredByPrev];
    }
  }

  for (let sIdx = 0; sIdx < trSubs.length; sIdx++) {
    if (assignedSubIndices.has(sIdx)) continue;
    const sub = trSubs[sIdx];
    let bestCIdx = -1;
    let bestScore = -Infinity;

    for (let cIdx = 0; cIdx < clips.length; cIdx++) {
      if (clipMatchedSubIdx[cIdx] !== -1) continue;
      if (!isMonotonicCompatible(cIdx, sIdx)) continue;
      const clip = clips[cIdx];
      const cStart = clip.clipStartSec + (clip.offsetSec || 0);
      const signedDiff = cStart - sub.startSec;
      const timeDist = Math.abs(signedDiff);
      if (signedDiff < -0.75 || signedDiff > 1.40 || timeDist > 1.35 || !isWithinTrackCorridor(cIdx, sub.startSec)) continue;

      const subDur = Math.max(0.25, sub.endSec - sub.startSec);
      const durFit = Math.min(clip.durationSec, subDur) / Math.max(clip.durationSec, subDur);
      const score = (2.0 - timeDist) * 2.0 + durFit * 2.5;
      if (score > bestScore) {
        bestScore = score;
        bestCIdx = cIdx;
      }
    }

    if (bestCIdx !== -1) {
      clipMatchedSubIdx[bestCIdx] = sIdx;
      assignedSubIndices.add(sIdx);
      expandMultiSubCoverage(bestCIdx, sIdx);
    }
  }

  for (let cIdx = 0; cIdx < clips.length; cIdx++) {
    const clip = clips[cIdx];
    const cStart = clip.clipStartSec + (clip.offsetSec || 0);
    const bestSubIdx = clipMatchedSubIdx[cIdx];
    const isSplitPart = clipIsSplitContinuation[cIdx] || Boolean(clip.isSplitContinuation);

    if (bestSubIdx !== -1) {
      const coveredIdxs = clipCoveredSubIndices[cIdx].length > 0 ? clipCoveredSubIndices[cIdx] : [bestSubIdx];
      const coveredSubs = coveredIdxs.map(idx => trSubs[idx]).filter(Boolean);
      const firstSub = coveredSubs[0] || trSubs[bestSubIdx];
      const lastSub = coveredSubs[coveredSubs.length - 1] || firstSub;

      clip.isPhysics = false;
      clip.isSplitContinuation = isSplitPart;
      clip.text = isSplitPart
        ? `${firstSub.text} (ч. 2)`
        : coveredSubs.length > 1
        ? coveredSubs.map(s => s.text).join(' / ')
        : firstSub.text;
      clip.matchedSubId = String(firstSub.id ?? bestSubIdx);
      clip.coveredSubIds = coveredSubs.map((s, idx) => String(s.id ?? coveredIdxs[idx]));
      clip.targetSubStartSec = (isSplitPart || clip.overlapResolvedLock)
        ? Number(cStart.toFixed(3))
        : Number(firstSub.startSec.toFixed(3));
      clip.targetSubEndSec = lastSub.endSec;
    } else {
      clip.isPhysics = true;
      clip.isSplitContinuation = false;
      clip.timingIssue = null;
      clip.timingIssueText = undefined;
      clip.targetSubStartSec = undefined;
      clip.matchedSubId = undefined;
      clip.coveredSubIds = undefined;
      if (!clip.text || clip.text.startsWith('Фраза ')) {
        clip.text = `⚡ Физика (${characterName})`;
      }
    }
  }

  return clips;
}
