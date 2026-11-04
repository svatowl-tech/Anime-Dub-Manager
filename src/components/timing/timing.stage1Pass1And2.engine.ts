import type React from 'react';
import { Track, SubtitleLine } from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';
import { getSharedAudioContext } from '../../lib/qa/sharedAudioContext';
import { normalizeSpeechText } from '../../lib/qa/whisperTextChecker';
import { TimingSettings } from '../TimingSettingsModal';
import { isPhraseTimingNotRequired } from './timingAudioUtils';
import {
  AudioClip,
  MissingSubtitleMarker,
  TimingIssue,
} from './timing.types';
import {
  calculateTextSimilarity,
  formatSeconds,
  getPlayableAudioUrl,
  isFixTrack,
} from './timing.utils';
import {
  detectSpeechIntervals,
  measureClipActiveSpeechStats,
} from './timing.dsp';

export interface Stage1Pass1And2Params {
  tracks: Track[];
  audioClips: Record<string, AudioClip[]>;
  trackSubLinesMap: Record<string, SubtitleLine[]>;
  isSilenceRemoved: boolean;
  timingSettings: TimingSettings;
  audioBuffersRef: React.MutableRefObject<Record<string, AudioBuffer>>;
  setIsSilenceRemoved: React.Dispatch<React.SetStateAction<boolean>>;
  updateProcess: (title: string, detail: string, progress: number, stepCurrent?: number, stepTotal?: number) => void;
  addLog: (msg: string, level?: 'info' | 'success' | 'warn' | 'error') => void;
}

export interface Stage1Pass1And2Result {
  updatedClips: Record<string, AudioClip[]>;
  newIssues: TimingIssue[];
  newMissingMarkers: MissingSubtitleMarker[];
  totalPhysicsDetected: number;
  totalMultiSubClips: number;
  crossDubberCoveredCount: number;
}

export async function runStage1Pass1And2Engine({
  tracks,
  audioClips,
  trackSubLinesMap,
  isSilenceRemoved,
  timingSettings,
  audioBuffersRef,
  setIsSilenceRemoved,
  updateProcess,
  addLog,
}: Stage1Pass1And2Params): Promise<Stage1Pass1And2Result> {
  let currentClips = { ...audioClips };

  const hasUncutTracks = tracks.some(t => {
    const c = currentClips[t.id];
    return !c || c.length <= 1;
  });

  if (!isSilenceRemoved || hasUncutTracks) {
    updateProcess('1. Анализ проблем (Whisper)', 'Удаление тишины и нарезка речевых интервалов...', 15, 1, 4);
    for (const track of tracks) {
      let audioBuf = audioBuffersRef.current[track.id];
      if (!audioBuf && track.filePath) {
        try {
          const pUrl = await getPlayableAudioUrl(track.filePath);
          if (pUrl) {
            const resp = await fetch(pUrl);
            const arrayBuf = await resp.arrayBuffer();
            const sharedAudioCtx = getSharedAudioContext();
            if (sharedAudioCtx) {
              audioBuf = await sharedAudioCtx.decodeAudioData(arrayBuf);
              audioBuffersRef.current[track.id] = audioBuf;
            }
          }
        } catch (e) {}
      }
      if (audioBuf) {
        const trSubs = trackSubLinesMap[track.id] || [];
        const intervals = detectSpeechIntervals(audioBuf, {
          minSilenceDurationSec: timingSettings.minSilenceDurationSec,
          leadInPaddingSec: timingSettings.leadInPaddingSec,
          leadOutPaddingSec: timingSettings.leadOutPaddingSec,
          minSpeechDurationSec: timingSettings.minSpeechDurationSec,
          mergeCloseGapsSec: timingSettings.mergeCloseGapsSec,
          subLines: trSubs
        });
        currentClips[track.id] = intervals.map((iv, idx) => {
          const sub = trSubs[idx];
          return {
            id: `clip_${track.id}_${idx}`,
            trackId: track.id,
            dubberName: track.participant || track.dubberName || 'Даббер',
            characterName: track.character || track.characterName || 'Персонаж',
            clipStartSec: iv.startSec,
            durationSec: iv.durationSec,
            sourceStartSec: iv.startSec,
            sourceEndSec: iv.endSec,
            rawSourceStartSec: iv.startSec,
            rawSourceEndSec: iv.endSec,
            text: sub?.text || `Фраза ${idx + 1}`,
            volumePercent: 100,
            isFix: isFixTrack(track),
            hasCollision: false,
            offsetSec: 0
          };
        });
      }
    }
    setIsSilenceRemoved(true);
  }

  const updatedClips: Record<string, AudioClip[]> = {};
  const newIssues: TimingIssue[] = [];
  const newMissingMarkers: MissingSubtitleMarker[] = [];
  let totalPhysicsDetected = 0;
  let totalMultiSubClips = 0;

  // Pass 1: Identify distant orphan clips (> 3.5s away from any subtitle) and run Whisper for them
  const orphanClipsByTrack: Record<string, AudioClip[]> = {};
  for (const track of tracks) {
    const clips = currentClips[track.id] || [];
    const trSubs = trackSubLinesMap[track.id] || [];
    const orphans: AudioClip[] = [];

    clips.forEach(clip => {
      const cStart = clip.clipStartSec + (clip.offsetSec || 0);
      const hasNearbySub = trSubs.some(s => Math.abs(cStart - s.startSec) <= 3.5 || (cStart >= s.startSec - 1.5 && cStart <= s.endSec + 1.5));
      if (!hasNearbySub && !clip.recognizedText && !clip.isPhysics) {
        orphans.push(clip);
      }
    });
    if (orphans.length > 0) {
      orphanClipsByTrack[track.id] = orphans;
    }
  }

  // Run Whisper for distant orphan clips if any exist
  const orphanTranscriptionMap: Record<string, string> = {};
  const orphanTrackIds = Object.keys(orphanClipsByTrack);
  for (let oIdx = 0; oIdx < orphanTrackIds.length; oIdx++) {
    const trId = orphanTrackIds[oIdx];
    const track = tracks.find(t => t.id === trId);
    const orphans = orphanClipsByTrack[trId];
    if (!track || !orphans || orphans.length === 0) continue;

    const wPct = Math.round(25 + ((oIdx + 1) / Math.max(1, orphanTrackIds.length)) * 35);
    updateProcess(
      '1. Анализ проблем (Whisper)',
      `Whisper распознавание фраз вне сабов: «${track.participant || track.dubberName}» (${orphans.length} фраз)...`,
      wPct,
      2,
      4
    );
    addLog(`🎙 Whisper: анализ ${orphans.length} звуков вне тайминга сабов для «${track.participant || track.dubberName}»...`, 'info');

    const whisperPayload = orphans.map(c => ({
      id: c.id,
      startSec: c.sourceStartSec,
      endSec: c.sourceEndSec,
      hint: c.text
    }));

    try {
      const resp: any = await ipcSafe.invoke('timing-whisper-transcribe-clips', {
        audioFilePath: track.filePath,
        clips: whisperPayload,
        model: 'tiny',
        language: 'ru'
      });
      if (resp && Array.isArray(resp.results)) {
        resp.results.forEach((r: any) => {
          if (r.id && r.text) {
            orphanTranscriptionMap[r.id] = r.text.trim();
          }
        });
      }
    } catch (wErr: any) {
      console.warn('[Whisper AutoTiming Orphans] IPC error:', wErr);
    }
  }

  updateProcess('1. Анализ проблем (Whisper)', 'Привязка фраз к субтитрам, защита физики и адаптированных реплик...', 68, 3, 4);
  await new Promise(r => setTimeout(r, 0));

  // Pass 2: Subtitle-Anchored Monotonic Matching with:
  // 1) Multi-subtitle single audio clip support (1 clip -> K consecutive subtitles)
  // 2) Split-phrase continuation protection (K clips -> 1 subtitle when a phrase has an internal pause, so the 2nd part is NEVER pulled to a skipped next subtitle)
  // 3) Cross-dubber voicing check (if a subtitle is skipped by this dubber but voiced by another dubber, it is NOT missing)
  // 4) "Физика" (sighs, gasps, grunts, laughs outside subtitles) detection & protection
  let crossDubberCoveredCount = 0;

  for (const track of tracks) {
    const dubberName = track.participant || track.dubberName || 'Даббер';
    const characterName = track.character || track.characterName || 'Персонаж';
    const trackBuf = audioBuffersRef.current[track.id];
    const clips = [...(currentClips[track.id] || [])].sort(
      (a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0))
    );
    const trSubs = [...(trackSubLinesMap[track.id] || [])].sort((a, b) => a.startSec - b.startSec);

    const assignedSubIndices = new Set<number>();
    const clipMatchedSubIdx = new Array<number>(clips.length).fill(-1);
    const clipIsSplitContinuation = new Array<boolean>(clips.length).fill(false);
    const clipCoveredSubIndices: number[][] = Array.from({ length: clips.length }, () => []);
    const clipMatchedByWhisper = new Array<boolean>(clips.length).fill(false);
    const clipWhisperScore = new Array<number>(clips.length).fill(0);

    for (let cIdx = 0; cIdx < clips.length; cIdx++) {
      if (orphanTranscriptionMap[clips[cIdx].id]) {
        clips[cIdx] = { ...clips[cIdx], recognizedText: orphanTranscriptionMap[clips[cIdx].id] };
      }
    }

    const isWithinTrackCorridor = (cIdx: number, targetStartSec: number): boolean => {
      const clip = clips[cIdx];
      const prevEnd = cIdx > 0
        ? (clips[cIdx - 1].clipStartSec + (clips[cIdx - 1].offsetSec || 0) + clips[cIdx - 1].durationSec + 0.03)
        : 0;
      const nextStart = cIdx + 1 < clips.length
        ? (clips[cIdx + 1].clipStartSec + (clips[cIdx + 1].offsetSec || 0) - 0.03)
        : Infinity;
      return targetStartSec >= prevEnd - 0.25 && (targetStartSec + Math.min(clip.durationSec, 1.2)) <= nextStart + 0.25;
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

    // Helper: expand a matched clip across consecutive subtitles if the dubber voiced 2-3 consecutive subtitles in one continuous breath
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
        const interSubGap = nxtSub.startSec - prevSub.endSec;
        if (interSubGap > 1.35) break;

        if (Math.abs(nextClipStart - nxtSub.startSec) <= 0.85) break;

        const nxtSubDur = Math.max(0.25, nxtSub.endSec - nxtSub.startSec);
        const overlapIntoNextSub = effectiveEnd - nxtSub.startSec;
        if (overlapIntoNextSub >= Math.min(0.45, nxtSubDur * 0.40)) {
          assignedSubIndices.add(nxtSIdx);
          clipCoveredSubIndices[cIdx].push(nxtSIdx);
          totalMultiSubClips++;
          curSIdx = nxtSIdx;
        } else {
          break;
        }
      }
    };

    // Sub-Pass 2A: Lock primary dialogue clips within a tight physiological window [-0.70s, +1.35s] of subtitle start
    const candidatePairs: Array<{ cIdx: number; sIdx: number; score: number }> = [];
    for (let cIdx = 0; cIdx < clips.length; cIdx++) {
      const clip = clips[cIdx];
      if (clip.isPhysics) continue;
      const cStart = clip.clipStartSec + (clip.offsetSec || 0);
      const speechStats = measureClipActiveSpeechStats(
        audioBuffersRef.current[clip.sourceAudioTrackId || track.id] || trackBuf,
        clip.sourceStartSec,
        clip.sourceEndSec
      );
      for (let sIdx = 0; sIdx < trSubs.length; sIdx++) {
        const sub = trSubs[sIdx];
        const signedDiff = cStart - sub.startSec;
        const absDiff = Math.abs(signedDiff);

        // Prevent a clip that sits inside the previous subtitle from being matched as an early start of `sub`
        if (sIdx > 0) {
          const prevSub = trSubs[sIdx - 1];
          if (cStart >= prevSub.startSec - 0.15 && cStart <= prevSub.endSec + 0.25 && sub.startSec - cStart > 0.55) {
            continue;
          }
        }

        if (signedDiff >= -0.70 && signedDiff <= 1.35 && isWithinTrackCorridor(cIdx, sub.startSec)) {
          const subDur = Math.max(0.25, sub.endSec - sub.startSec);
          const durRatio = Math.min(clip.durationSec, subDur) / Math.max(clip.durationSec, subDur);
          const shortBreathPenalty = (clip.durationSec < 0.24 && speechStats.activeWindows < 8 && subDur > 0.9) ? 1.4 : 0;
          const score = absDiff - durRatio * 0.35 + shortBreathPenalty;
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

    // Sub-Pass 2A.2: Absorb Split-Phrase Continuation Clips (2nd/3rd part of a phrase divided by an internal pause)
    for (let cIdx = 0; cIdx < clips.length; cIdx++) {
      const sIdx = clipMatchedSubIdx[cIdx];
      if (sIdx === -1 || clipIsSplitContinuation[cIdx]) continue;
      const covered = clipCoveredSubIndices[cIdx];
      const lastCoveredSIdx = covered.length > 0 ? covered[covered.length - 1] : sIdx;
      const sub = trSubs[lastCoveredSIdx];
      const nextSub = lastCoveredSIdx + 1 < trSubs.length ? trSubs[lastCoveredSIdx + 1] : null;

      let scanIdx = cIdx + 1;
      while (scanIdx < clips.length && clipMatchedSubIdx[scanIdx] === -1) {
        const prevPart = clips[scanIdx - 1];
        const prevPartEnd = prevPart.clipStartSec + (prevPart.offsetSec || 0) + prevPart.durationSec;
        const partClip = clips[scanIdx];
        if (partClip.isPhysics) break;
        const partStart = partClip.clipStartSec + (partClip.offsetSec || 0);
        const partEnd = partStart + partClip.durationSec;
        const pauseGap = partStart - prevPartEnd;

        const fitsInsideCurrentSub =
          pauseGap >= -0.05 &&
          pauseGap <= 1.25 &&
          (partStart <= sub.endSec + 0.35 || partEnd <= sub.endSec + 0.65);

        const clearlyBeforeNextSub = !nextSub || (
          nextSub.startSec - partStart >= 0.55 &&
          (partStart <= sub.endSec + 0.25 || Math.abs(partStart - sub.endSec) < Math.abs(partStart - nextSub.startSec))
        );

        if (fitsInsideCurrentSub && clearlyBeforeNextSub) {
          clipMatchedSubIdx[scanIdx] = lastCoveredSIdx;
          clipIsSplitContinuation[scanIdx] = true;
          clipCoveredSubIndices[scanIdx] = [lastCoveredSIdx];
          scanIdx++;
        } else {
          break;
        }
      }
    }

    // Sub-Pass 2B: Subtitle-Anchored Corridor Matching for remaining unassigned subtitles
    for (let sIdx = 0; sIdx < trSubs.length; sIdx++) {
      if (assignedSubIndices.has(sIdx)) continue;
      const sub = trSubs[sIdx];
      const prevSub = sIdx > 0 ? trSubs[sIdx - 1] : null;

      let bestCIdx = -1;
      let bestCandidateScore = -Infinity;

      for (let cIdx = 0; cIdx < clips.length; cIdx++) {
        if (clipMatchedSubIdx[cIdx] !== -1 || clipIsSplitContinuation[cIdx]) continue;
        const clip = clips[cIdx];
        if (clip.isPhysics) continue;
        if (!isMonotonicCompatible(cIdx, sIdx)) continue;

        const cStart = clip.clipStartSec + (clip.offsetSec || 0);
        const signedDiff = cStart - sub.startSec;
        const timeDist = Math.abs(signedDiff);

        // Never pull a clip that starts > 0.75s before `sub.startSec` or sits inside `prevSub`
        if (signedDiff < -0.75 || signedDiff > 1.45 || !isWithinTrackCorridor(cIdx, sub.startSec)) continue;
        if (prevSub && cStart <= prevSub.endSec + 0.25 && sub.startSec - cStart > 0.55) continue;

        const subDur = Math.max(0.25, sub.endSec - sub.startSec);
        const durFit = Math.min(clip.durationSec, subDur) / Math.max(clip.durationSec, subDur);
        const speechStats = measureClipActiveSpeechStats(
          audioBuffersRef.current[clip.sourceAudioTrackId || track.id] || trackBuf,
          clip.sourceStartSec,
          clip.sourceEndSec
        );

        const recWords = normalizeSpeechText(clip.recognizedText || '');
        const hasAnyWhisperWords = recWords.length >= 2;
        const textSim = clip.recognizedText ? calculateTextSimilarity(clip.recognizedText, sub.text) : 0;

        const candidateScore =
          (2.5 - timeDist) * 2.0 +
          durFit * 2.5 +
          Math.min(2.0, speechStats.activeSpeechSec) +
          (hasAnyWhisperWords ? 2.0 : 0) +
          textSim * 3.0;

        if (candidateScore > bestCandidateScore) {
          bestCandidateScore = candidateScore;
          bestCIdx = cIdx;
        }
      }

      if (bestCIdx !== -1) {
        clipMatchedSubIdx[bestCIdx] = sIdx;
        assignedSubIndices.add(sIdx);
        if (clips[bestCIdx].recognizedText) {
          const sim = calculateTextSimilarity(clips[bestCIdx].recognizedText!, sub.text);
          clipMatchedByWhisper[bestCIdx] = Math.abs((clips[bestCIdx].clipStartSec + (clips[bestCIdx].offsetSec || 0)) - sub.startSec) > 1.2;
          clipWhisperScore[bestCIdx] = Math.max(60, Math.round(sim * 100));
        }
        expandMultiSubCoverage(bestCIdx, sIdx);
      }
    }

    const mappedClips: AudioClip[] = [];

    for (let cIdx = 0; cIdx < clips.length; cIdx++) {
      const clip = { ...clips[cIdx] };
      const cStart = clip.clipStartSec + (clip.offsetSec || 0);
      const bestSubIdx = clipMatchedSubIdx[cIdx];
      const bestSub = bestSubIdx !== -1 ? trSubs[bestSubIdx] : null;
      const isContinuation = clipIsSplitContinuation[cIdx];
      const matchedByWhisper = clipMatchedByWhisper[cIdx];

      const prevClipEnd = cIdx > 0
        ? (mappedClips[cIdx - 1].clipStartSec + (mappedClips[cIdx - 1].offsetSec || 0) + mappedClips[cIdx - 1].durationSec + 0.04)
        : 0;
      const nextClipStart = cIdx + 1 < clips.length
        ? (clips[cIdx + 1].clipStartSec + (clips[cIdx + 1].offsetSec || 0) - 0.04)
        : Infinity;

      if (bestSub && bestSubIdx !== -1) {
        if (isContinuation) {
          // 2nd/3rd part of a split phrase: lock in place on its recorded timestamp!
          clip.isPhysics = false;
          clip.isSplitContinuation = true;
          clip.text = `${bestSub.text} (ч. 2)`;
          clip.matchedSubId = String(bestSub.id ?? bestSubIdx);
          clip.coveredSubIds = [String(bestSub.id ?? bestSubIdx)];
          clip.targetSubStartSec = Number(cStart.toFixed(3));
          clip.targetSubEndSec = bestSub.endSec;
          clip.timeDiffSec = 0;
          clip.timingIssue = null;
          clip.timingIssueText = undefined;
        } else {
          const coveredIdxs = clipCoveredSubIndices[cIdx].length > 0 ? clipCoveredSubIndices[cIdx] : [bestSubIdx];
          const coveredSubs = coveredIdxs.map(idx => trSubs[idx]).filter(Boolean);
          const firstSub = coveredSubs[0] || bestSub;
          const lastSub = coveredSubs[coveredSubs.length - 1] || bestSub;

          const maxShift = 1.6;
          let surgicalTarget = Math.max(cStart - maxShift, Math.min(cStart + maxShift, firstSub.startSec));
          surgicalTarget = Math.max(prevClipEnd, Math.min(surgicalTarget, Math.max(prevClipEnd, nextClipStart - clip.durationSec)));
          surgicalTarget = Number(Math.max(0, surgicalTarget).toFixed(3));

          const rawTimeDiff = cStart - firstSub.startSec;
          const absRawDiff = Math.abs(rawTimeDiff);
          const effectiveShift = Math.abs(surgicalTarget - cStart);

          clip.isPhysics = false;
          clip.isSplitContinuation = false;
          clip.text = coveredSubs.length > 1
            ? coveredSubs.map(s => s.text).join(' / ')
            : firstSub.text;
          clip.matchedSubId = String(firstSub.id ?? bestSubIdx);
          clip.coveredSubIds = coveredSubs.map((s, idx) => String(s.id ?? coveredIdxs[idx]));
          clip.targetSubStartSec = surgicalTarget;
          clip.targetSubEndSec = lastSub.endSec;
          clip.timeDiffSec = Number(rawTimeDiff.toFixed(2));
          if (matchedByWhisper) {
            clip.whisperMatchedScore = clipWhisperScore[cIdx];
          }

          // User Rule: If phrase does not exceed subtitle boundaries or tail <= 30% of sub duration, timing is NOT required!
          const timingExempt = isPhraseTimingNotRequired(cStart, clip.durationSec, firstSub.startSec, lastSub.endSec);

          if (timingExempt.notRequired) {
            clip.timingNotRequired = true;
            clip.timingNotRequiredReason = timingExempt.reason;
            clip.timingIssue = null;
            clip.timingIssueText = undefined;
            clip.targetSubStartSec = cStart;
          } else if (matchedByWhisper && effectiveShift >= 0.25) {
            clip.timingNotRequired = false;
            clip.timingIssue = 'orphan';
            clip.timingIssueText = `Подтяжка к субтитру: «${(clip.recognizedText || clip.text).slice(0, 20)}» ➔ [${formatSeconds(surgicalTarget)}]`;

            newIssues.push({
              id: `issue_orphan_matched_${clip.id}`,
              type: 'orphan',
              trackId: track.id,
              dubberName,
              characterName,
              clipId: clip.id,
              timeSec: cStart,
              durationSec: clip.durationSec,
              subText: clip.text,
              subStartSec: surgicalTarget,
              subEndSec: lastSub.endSec,
              whisperText: clip.recognizedText,
              whisperMatchScore: clipWhisperScore[cIdx],
              description: `Привязка реплики «${(clip.recognizedText || clip.text).slice(0, 35)}» ➔ [${formatSeconds(surgicalTarget)}]`
            });
          } else if (absRawDiff >= 0.30 && absRawDiff <= 1.8 && effectiveShift >= 0.10) {
            clip.timingNotRequired = false;
            clip.timingIssue = 'desync';
            clip.timingIssueText = rawTimeDiff > 0 
              ? `Опаздывает на +${absRawDiff.toFixed(2)}с (сдвиг до ${formatSeconds(surgicalTarget)})` 
              : `Спешит на -${absRawDiff.toFixed(2)}с (сдвиг до ${formatSeconds(surgicalTarget)})`;

            newIssues.push({
              id: `issue_desync_${clip.id}`,
              type: 'desync',
              trackId: track.id,
              dubberName,
              characterName,
              clipId: clip.id,
              timeSec: cStart,
              durationSec: clip.durationSec,
              subText: clip.text,
              subStartSec: surgicalTarget,
              subEndSec: lastSub.endSec,
              timeDiffSec: Number(rawTimeDiff.toFixed(2)),
              description: rawTimeDiff > 0
                ? `Фраза #${cIdx + 1} опаздывает на +${absRawDiff.toFixed(2)}с: «${clip.text.slice(0, 35)}»`
                : `Фраза #${cIdx + 1} спешит на -${absRawDiff.toFixed(2)}с: «${clip.text.slice(0, 35)}»`
            });
          } else {
            clip.timingIssue = null;
            clip.timingIssueText = undefined;
          }
        }
      } else {
        // Sub-Pass 2C: Unmatched clip where there is NO unvoiced subtitle in the corridor -> Protected "Физика" (sigh, gasp, grunt, laugh)
        clip.isPhysics = true;
        clip.timingIssue = null;
        clip.timingIssueText = undefined;
        clip.targetSubStartSec = undefined;
        clip.matchedSubId = undefined;
        clip.coveredSubIds = undefined;
        if (!clip.text || clip.text.startsWith('Фраза ')) {
          clip.text = `⚡ Физика (${characterName})`;
        }
        totalPhysicsDetected++;
      }

      mappedClips.push(clip);
    }

    // 3. Problem: Missing Subtitle Lines (checking both this dubber AND cross-dubber voicing across all other tracks!)
    for (let sIdx = 0; sIdx < trSubs.length; sIdx++) {
      if (!assignedSubIndices.has(sIdx)) {
        const sub = trSubs[sIdx];
        const subIdStr = String(sub.id ?? sIdx);
        const subDur = Math.max(0.25, sub.endSec - sub.startSec);
        const hasAudioCover = mappedClips.some(c => {
          if (c.coveredSubIds?.includes(subIdStr) || c.matchedSubId === subIdStr) return true;
          if (c.isPhysics) return false;
          const cStart = c.clipStartSec + (c.offsetSec || 0);
          const cEnd = cStart + c.durationSec;
          const ov = Math.min(cEnd, sub.endSec + 0.25) - Math.max(cStart, sub.startSec - 0.25);
          return ov >= Math.min(0.28, subDur * 0.35);
        });

        // Cross-dubber check: if another dubber voiced this subtitle window, it is NOT a missing phrase!
        const voicedByOtherDubber = !hasAudioCover && tracks.some(otherTr => {
          if (otherTr.id === track.id || isFixTrack(otherTr)) return false;
          const otherList = updatedClips[otherTr.id] || currentClips[otherTr.id] || [];
          return otherList.some(oc => {
            if (oc.isPhysics || oc.durationSec >= 90) return false;
            const oStart = oc.clipStartSec + (oc.offsetSec || 0);
            const oEnd = oStart + oc.durationSec;
            const ov = Math.min(oEnd, sub.endSec + 0.25) - Math.max(oStart, sub.startSec - 0.25);
            return ov >= Math.min(0.28, subDur * 0.35);
          });
        });

        if (voicedByOtherDubber) {
          crossDubberCoveredCount++;
        } else if (!hasAudioCover) {
          newIssues.push({
            id: `issue_missing_${track.id}_${sub.id || sIdx}`,
            type: 'missing',
            trackId: track.id,
            dubberName,
            characterName,
            timeSec: sub.startSec,
            durationSec: sub.endSec - sub.startSec,
            subText: sub.text,
            subStartSec: sub.startSec,
            subEndSec: sub.endSec,
            description: `Пропущена реплика «${characterName}»: «${sub.text.slice(0, 40)}» [${formatSeconds(sub.startSec)}]`
          });

          newMissingMarkers.push({
            id: `missing_${track.id}_${sub.id ?? sIdx}`,
            subId: subIdStr,
            trackId: track.id,
            dubberName,
            characterName,
            startSec: sub.startSec,
            endSec: sub.endSec,
            text: sub.text
          });
        }
      }
    }

    updatedClips[track.id] = mappedClips;
  }

  return {
    updatedClips,
    newIssues,
    newMissingMarkers,
    totalPhysicsDetected,
    totalMultiSubClips,
    crossDubberCoveredCount,
  };
}
