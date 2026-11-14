import { Track, SubtitleLine } from '../../types';
import { AudioClip } from './timing.types';
import {
  detectClipSpeechBounds,
  findOriginalVocalsAnchorForSub,
  getAudioBufferRoomNoiseDb,
} from './timing.dsp';
import {
  OccupiedVocalInterval,
  findOriginalVocalsBurstForPhysics,
  detectInternalPausesInClip,
  checkOriginalVocalsPauseInWindow,
} from './timing.vocalsDsp';
import { formatSeconds, isFixTrack } from './timing.utils';
import { TIMING_RULES, evaluateSoftTimeFit } from './timing.rules';

/**
 * Computes effective play duration accounting for internal pause compression and playbackRate.
 */
export function computeEffectiveClipDurationSec(clip: AudioClip): number {
  const rawSpan = Math.max(0.05, (clip.sourceEndSec || 0) - (clip.sourceStartSec || 0));
  const pauseSaved = clip.internalPauseEdit
    ? Math.max(0, (clip.internalPauseEdit.pauseEndSec - clip.internalPauseEdit.pauseStartSec) - clip.internalPauseEdit.targetPauseSec)
    : 0;
  const unscaled = Math.max(0.05, rawSpan - pauseSaved);
  const rate = clip.playbackRate && clip.playbackRate > 1.005 ? clip.playbackRate : 1.0;
  return Number((unscaled / rate).toFixed(3));
}

/**
 * Rule 1: Smart "Физика" Sync.
 * For every physics clip (no subtitle):
 * - Scans ±1.0s on `original_vocals.wav` for an unoccupied non-dialogue vocal burst (0.12s .. 2.50s).
 * - If found, snaps the physics clip's vocal attack (`speechOnsetOffsetSec`) to the burst onset.
 * - If silence or only occupied speech exists in ±1.0s, leaves the clip untouched at its original position.
 */
export function applyPhysicsSmartSyncOnMap(params: {
  tracks: Track[];
  clipsMap: Record<string, AudioClip[]>;
  trackSubLinesMap: Record<string, SubtitleLine[]>;
  vocalsBuffer?: AudioBuffer;
  vocalsNoiseDbHint?: number;
  applyShift?: boolean;
  addLog?: (msg: string, level?: 'info' | 'success' | 'warn' | 'error') => void;
}): { syncedCount: number } {
  const {
    tracks,
    clipsMap,
    trackSubLinesMap,
    vocalsBuffer,
    vocalsNoiseDbHint,
    applyShift = true,
    addLog
  } = params;

  if (!vocalsBuffer) return { syncedCount: 0 };

  const occupiedWindows: OccupiedVocalInterval[] = [];
  for (const tr of tracks) {
    const trSubs = trackSubLinesMap[tr.id] || [];
    for (const s of trSubs) {
      occupiedWindows.push({ startSec: s.startSec, endSec: s.endSec });
    }
    const trClips = clipsMap[tr.id] || [];
    for (const c of trClips) {
      if (c.isPhysics) continue;
      if (typeof c.refVocalStartSec === 'number' && typeof c.refVocalEndSec === 'number') {
        occupiedWindows.push({ startSec: c.refVocalStartSec, endSec: c.refVocalEndSec });
      } else {
        const cs = c.clipStartSec + (c.offsetSec || 0);
        occupiedWindows.push({ startSec: cs, endSec: cs + c.durationSec });
      }
    }
  }

  let syncedCount = 0;

  for (const tr of tracks) {
    const clips = clipsMap[tr.id];
    if (!clips || clips.length === 0) continue;

    const sorted = [...clips].sort(
      (a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0))
    );

    for (let i = 0; i < sorted.length; i++) {
      const clip = sorted[i];
      if (!clip.isPhysics || clip.overlapResolvedLock) continue;

      const curStart = clip.clipStartSec + (clip.offsetSec || 0);
      const curEnd = curStart + clip.durationSec;
      const onsetOffset = clip.speechOnsetOffsetSec || 0;

      const burst = findOriginalVocalsBurstForPhysics(
        vocalsBuffer,
        curStart,
        curEnd,
        onsetOffset,
        occupiedWindows,
        vocalsNoiseDbHint
      );

      if (!burst.found || burst.burstStartSec === undefined) {
        clip.physicsSynced = false;
        continue;
      }

      const desiredStart = Math.max(0, burst.burstStartSec - onsetOffset);
      const origStart = clip.rawSourceStartSec ?? clip.sourceStartSec ?? curStart;
      const win = TIMING_RULES.PHYSICS_SEARCH_WINDOW_SEC;
      const clampedByWindow = Math.max(origStart - win, Math.min(origStart + win, desiredStart));

      const prevEnd = i > 0
        ? (sorted[i - 1].clipStartSec + (sorted[i - 1].offsetSec || 0) + sorted[i - 1].durationSec + TIMING_RULES.MIN_SAME_TRACK_GAP_SEC)
        : 0;
      const nextStart = i + 1 < sorted.length
        ? (sorted[i + 1].clipStartSec + (sorted[i + 1].offsetSec || 0) - TIMING_RULES.MIN_SAME_TRACK_GAP_SEC)
        : Infinity;

      const safeTarget = Number(
        Math.max(0, Math.max(prevEnd, Math.min(clampedByWindow, Math.max(prevEnd, nextStart - clip.durationSec)))).toFixed(3)
      );

      const shiftDelta = Math.abs(safeTarget - curStart);
      if (shiftDelta >= TIMING_RULES.MIN_EFFECTIVE_SHIFT_SEC && Math.abs(safeTarget - desiredStart) < Math.abs(curStart - desiredStart) - 0.02) {
        clip.physicsBurstStartSec = burst.burstStartSec;
        clip.physicsBurstEndSec = burst.burstEndSec;
        clip.refVocalStartSec = burst.burstStartSec;
        clip.refVocalEndSec = burst.burstEndSec;
        clip.hasRefVocalAnchor = true;
        clip.targetSubStartSec = safeTarget;
        clip.targetSubEndSec = burst.burstEndSec;
        clip.physicsSynced = true;

        if (applyShift) {
          clip.clipStartSec = safeTarget;
          clip.offsetSec = 0;
          clip.timeDiffSec = Number(((safeTarget + onsetOffset) - burst.burstStartSec).toFixed(2));
        }

        // Claim this burst so no sibling physics track grabs the exact same reaction twice unless unison
        occupiedWindows.push({ startSec: burst.burstStartSec, endSec: burst.burstEndSec ?? (burst.burstStartSec + burst.burstDurationSec!) });
        syncedCount++;

        addLog?.(
          `⚡ [Физика ⇄ Оригинал] «${clip.characterName}»: вздох/реакция привязана к всплеску на ${formatSeconds(burst.burstStartSec)} (${formatSeconds(curStart)} ➔ ${formatSeconds(safeTarget)})`,
          'info'
        );
      } else {
        clip.physicsSynced = false;
      }
    }

    clipsMap[tr.id] = sorted;
  }

  return { syncedCount };
}

/**
 * Rule 2B: Adaptive Internal Pause Splitting & Compression inside a single long subtitle.
 * - Detects pauses 200-550ms inside a clip matched to a long subtitle.
 * - Checks `original_vocals.wav` in that subtitle:
 *   * If original seiyuu also has a pause > 180ms: splits clip into Part 1 & Part 2, aligning each half
 *     to its respective half of original speech (`origHalf1StartSec` and `origHalf2StartSec`).
 *   * If original seiyuu speaks continuously without pause: NEVER splits; if dubber's pause > 300ms,
 *     compresses the internal empty pause down to 120ms (`internalPauseEdit`).
 */
export function applyAdaptiveInternalPauseRuleOnTrack(params: {
  track: Track;
  clips: AudioClip[];
  trSubs: SubtitleLine[];
  audioBuffer?: AudioBuffer;
  vocalsBuffer?: AudioBuffer;
  vocalsNoiseDbHint?: number;
  addLog?: (msg: string, level?: 'info' | 'success' | 'warn' | 'error') => void;
}): { clips: AudioClip[]; splitCount: number; compressedCount: number } {
  const { track, clips, trSubs, audioBuffer, vocalsBuffer, vocalsNoiseDbHint, addLog } = params;
  if (!audioBuffer || !vocalsBuffer || clips.length === 0 || trSubs.length === 0) {
    return { clips, splitCount: 0, compressedCount: 0 };
  }

  const trackNoiseDb = getAudioBufferRoomNoiseDb(audioBuffer);
  const nextClips: AudioClip[] = [];
  let splitCount = 0;
  let compressedCount = 0;

  for (const clip of clips) {
    if (
      clip.isPhysics ||
      clip.isSplitContinuation ||
      clip.internalPauseEdit ||
      clip.overlapResolvedLock ||
      (clip.coveredSubIds && clip.coveredSubIds.length > 1) ||
      clip.durationSec < 0.70
    ) {
      nextClips.push(clip);
      continue;
    }

    const sub = clip.matchedSubId
      ? trSubs.find(s => String(s.id) === String(clip.matchedSubId))
      : undefined;
    if (!sub || (sub.endSec - sub.startSec) < 0.85) {
      nextClips.push(clip);
      continue;
    }

    const pauses = detectInternalPausesInClip(
      audioBuffer,
      clip.sourceStartSec,
      clip.sourceEndSec,
      TIMING_RULES.INTERNAL_PAUSE_MIN_SEC,
      TIMING_RULES.INTERNAL_PAUSE_MAX_SEC,
      trackNoiseDb
    );
    if (pauses.length === 0) {
      nextClips.push(clip);
      continue;
    }

    // Analyze the most prominent internal pause
    pauses.sort((a, b) => b.pauseDurationSec - a.pauseDurationSec);
    const mainPause = pauses[0];
    const relFrac = (mainPause.valleyCenterSec - clip.sourceStartSec) / Math.max(0.2, clip.sourceEndSec - clip.sourceStartSec);

    const origCheck = checkOriginalVocalsPauseInWindow(
      vocalsBuffer,
      sub.startSec,
      sub.endSec,
      relFrac,
      0.45,
      TIMING_RULES.ORIG_VOCAL_PAUSE_MIN_SEC,
      vocalsNoiseDbHint
    );

    if (origCheck.hasPause && origCheck.origHalf2StartSec !== undefined) {
      const part1SrcEnd = Number(Math.max(clip.sourceStartSec + 0.22, mainPause.valleyCenterSec - 0.01).toFixed(3));
      const part2SrcStart = Number(Math.min(clip.sourceEndSec - 0.22, mainPause.valleyCenterSec + 0.01).toFixed(3));

      if (part1SrcEnd - clip.sourceStartSec >= 0.22 && clip.sourceEndSec - part2SrcStart >= 0.22) {
        const b1 = detectClipSpeechBounds(audioBuffer, clip.sourceStartSec, part1SrcEnd, trackNoiseDb);
        const b2 = detectClipSpeechBounds(audioBuffer, part2SrcStart, clip.sourceEndSec, trackNoiseDb);

        const part1TargetStart = Number(Math.max(0, origCheck.origHalf1StartSec - b1.onsetOffsetSec).toFixed(3));
        const part1Dur = Number((part1SrcEnd - clip.sourceStartSec).toFixed(3));
        const desiredPart2Start = Math.max(0, origCheck.origHalf2StartSec - b2.onsetOffsetSec);
        const part2Start = Number(Math.max(part1TargetStart + part1Dur + TIMING_RULES.MIN_SAME_TRACK_GAP_SEC, desiredPart2Start).toFixed(3));
        const part2Dur = Number((clip.sourceEndSec - part2SrcStart).toFixed(3));

        const part1: AudioClip = {
          ...clip,
          id: `${clip.id}_p1`,
          durationSec: part1Dur,
          unscaledDurationSec: part1Dur,
          sourceEndSec: part1SrcEnd,
          rawSourceEndSec: part1SrcEnd,
          speechOnsetOffsetSec: b1.onsetOffsetSec,
          speechOffsetSec: b1.offsetSec,
          clipStartSec: part1TargetStart,
          offsetSec: 0,
          targetSubStartSec: part1TargetStart,
          targetSubEndSec: origCheck.origHalf1EndSec,
          refVocalStartSec: origCheck.origHalf1StartSec,
          refVocalEndSec: origCheck.origHalf1EndSec,
          hasRefVocalAnchor: true,
          text: `${sub.text} (ч. 1)`,
          timingIssue: null,
          timingIssueText: undefined
        };

        const part2: AudioClip = {
          ...clip,
          id: `${clip.id}_p2`,
          durationSec: part2Dur,
          unscaledDurationSec: part2Dur,
          sourceStartSec: part2SrcStart,
          rawSourceStartSec: part2SrcStart,
          speechOnsetOffsetSec: b2.onsetOffsetSec,
          speechOffsetSec: b2.offsetSec,
          clipStartSec: part2Start,
          offsetSec: 0,
          targetSubStartSec: part2Start,
          targetSubEndSec: origCheck.origHalf2EndSec ?? sub.endSec,
          refVocalStartSec: origCheck.origHalf2StartSec,
          refVocalEndSec: origCheck.origHalf2EndSec ?? sub.endSec,
          hasRefVocalAnchor: true,
          isSplitContinuation: true,
          text: `${sub.text} (ч. 2)`,
          timingIssue: null,
          timingIssueText: undefined
        };

        nextClips.push(part1, part2);
        splitCount++;
        addLog?.(
          `✂️ [Пауза в оригинале >180мс] Фраза «${sub.text.slice(0, 26)}» (${track.dubberName}) разделена на 2 части и выровнена по половинам речи сейю (${formatSeconds(origCheck.origHalf1StartSec)} / ${formatSeconds(origCheck.origHalf2StartSec)})`,
          'info'
        );
        continue;
      }
    } else if (mainPause.pauseDurationSec > TIMING_RULES.INTERNAL_PAUSE_COMPRESS_TRIGGER_SEC) {
      // Original seiyuu speaks WITHOUT a >180ms pause -> do NOT split, gently compress empty pause >300ms down to 120ms
      const targetPauseSec = TIMING_RULES.INTERNAL_PAUSE_TARGET_SEC;
      const savedSec = Number((mainPause.pauseDurationSec - targetPauseSec).toFixed(3));
      const newUnscaledDur = Number(Math.max(0.25, (clip.sourceEndSec - clip.sourceStartSec) - savedSec).toFixed(3));
      const rate = clip.playbackRate && clip.playbackRate > 1.005 ? clip.playbackRate : 1.0;

      const updated: AudioClip = {
        ...clip,
        internalPauseEdit: {
          pauseStartSec: mainPause.pauseStartSec,
          pauseEndSec: mainPause.pauseEndSec,
          targetPauseSec
        },
        unscaledDurationSec: newUnscaledDur,
        durationSec: Number((newUnscaledDur / rate).toFixed(3)),
        speechOffsetSec: typeof clip.speechOffsetSec === 'number'
          ? Number(Math.max(0.15, clip.speechOffsetSec - savedSec).toFixed(3))
          : undefined
      };
      nextClips.push(updated);
      compressedCount++;
      addLog?.(
        `🗜 [Сжатие запнувшейся паузы] В фразе «${sub.text.slice(0, 26)}» (${track.dubberName}) оригинал без паузы — пустая пауза ${Math.round(mainPause.pauseDurationSec * 1000)}мс сжата до 120мс`,
        'info'
      );
      continue;
    }

    nextClips.push(clip);
  }

  return { clips: nextClips, splitCount, compressedCount };
}

/**
 * Rule 3: Soft Time-Fit for long Russian translations.
 * Triggered AFTER attack alignment when a clip's speech end overhangs original speech end by > 25%
 * AND collides with the next line (intra or inter-track), and shifting left is blocked:
 *   1. Trims trailing silent tail down to 40 ms (`speechOffsetSec + 0.04`).
 *   2. Applies safe pitch-preserving `playbackRate` in [1.0 .. 1.18].
 */
export function applySoftTimeFitToTrackClips(params: {
  trackId: string;
  clipsMap: Record<string, AudioClip[]>;
  trackSubLinesMap: Record<string, SubtitleLine[]>;
  subtitles: SubtitleLine[];
  addLog?: (msg: string, level?: 'info' | 'success' | 'warn' | 'error') => void;
}): { trimmedCount: number; stretchedCount: number } {
  const { trackId, clipsMap, trackSubLinesMap, subtitles, addLog } = params;
  const clips = clipsMap[trackId];
  if (!clips || clips.length === 0) return { trimmedCount: 0, stretchedCount: 0 };

  const sorted = [...clips].sort(
    (a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0))
  );
  const trSubs = trackSubLinesMap[trackId] || [];

  let trimmedCount = 0;
  let stretchedCount = 0;

  for (let i = 0; i < sorted.length; i++) {
    const clip = sorted[i];
    if (
      clip.isPhysics ||
      clip.isSplitContinuation ||
      clip.isUnisonPhrase ||
      clip.isIntentionalOverlap ||
      clip.overlapRole ||
      clip.durationSec >= 25
    ) {
      continue;
    }

    const curStart = clip.clipStartSec + (clip.offsetSec || 0);
    const matchedSub = clip.matchedSubId
      ? (trSubs.find(s => String(s.id) === String(clip.matchedSubId)) || subtitles.find(s => String(s.id) === String(clip.matchedSubId)))
      : undefined;

    const anchorStart = clip.refVocalStartSec ?? matchedSub?.startSec ?? curStart;
    const anchorEnd = clip.refVocalEndSec ?? clip.targetSubEndSec ?? matchedSub?.endSec;
    if (anchorEnd === undefined) continue;

    const prevIntraEnd = i > 0
      ? (sorted[i - 1].clipStartSec + (sorted[i - 1].offsetSec || 0) + sorted[i - 1].durationSec + TIMING_RULES.MIN_SAME_TRACK_GAP_SEC)
      : 0;
    const nextIntraStart = i + 1 < sorted.length
      ? (sorted[i + 1].clipStartSec + (sorted[i + 1].offsetSec || 0) - TIMING_RULES.MIN_SAME_TRACK_GAP_SEC)
      : Infinity;

    // Also inspect next inter-track non-intentional dialogue line that may collide with our tail
    let nextInterStart = Infinity;
    for (const [otherTrId, otherList] of Object.entries(clipsMap)) {
      if (otherTrId === trackId) continue;
      for (const oc of otherList) {
        if (oc.isPhysics || oc.isIntentionalOverlap || oc.overlapRole) continue;
        const oStart = oc.clipStartSec + (oc.offsetSec || 0);
        if (oStart <= curStart + 0.08 || oStart >= curStart + clip.durationSec + 0.5) continue;
        // Skip if subtitles intentionally overlap
        const oSub = oc.matchedSubId
          ? ((trackSubLinesMap[otherTrId] || []).find(s => String(s.id) === String(oc.matchedSubId)) || subtitles.find(s => String(s.id) === String(oc.matchedSubId)))
          : undefined;
        if (matchedSub && oSub && Math.min(matchedSub.endSec, oSub.endSec) - Math.max(matchedSub.startSec, oSub.startSec) > -TIMING_RULES.INTENTIONAL_OVERLAP_ASS_TOLERANCE_SEC) {
          continue;
        }
        if (oStart - TIMING_RULES.MIN_INTER_TRACK_GAP_SEC < nextInterStart) {
          nextInterStart = oStart - TIMING_RULES.MIN_INTER_TRACK_GAP_SEC;
        }
      }
    }

    const nextPhraseCeiling = Math.min(nextIntraStart, nextInterStart);
    const pauseSaved = clip.internalPauseEdit
      ? Math.max(0, (clip.internalPauseEdit.pauseEndSec - clip.internalPauseEdit.pauseStartSec) - clip.internalPauseEdit.targetPauseSec)
      : 0;

    const preEval = evaluateSoftTimeFit({
      curStartSec: curStart,
      clipDurationSec: clip.durationSec,
      unscaledDurationSec: clip.unscaledDurationSec ?? Math.max(0.25, (clip.sourceEndSec - clip.sourceStartSec) - pauseSaved),
      anchorStartSec: anchorStart,
      anchorEndSec: anchorEnd,
      speechOffsetSec: typeof clip.speechOffsetSec === 'number' && clip.speechOffsetSec > 0
        ? (clip.speechOffsetSec / (clip.playbackRate || 1))
        : undefined,
      nextPhraseCeilingSec: nextPhraseCeiling,
      playbackRate: clip.playbackRate || 1.0,
    });

    if (!preEval.collidesNext && !preEval.hasOverhangOver25) continue;

    // Cannot pull earlier if locked by previous phrase or already aligned at onset
    const onsetOffset = clip.speechOnsetOffsetSec || 0;
    const alignedStart = Math.max(0, anchorStart - onsetOffset);
    const canPullLeft = Math.max(0, curStart - Math.max(prevIntraEnd, alignedStart - 0.06));
    if (canPullLeft > 0.12 && !preEval.hasOverhangOver25) continue;

    // Step 1: Trim silent tail at end of clip down to speechOffsetSec + 40 ms
    const tailFloor = typeof clip.speechOffsetSec === 'number' && clip.speechOffsetSec > 0
      ? Math.max(0.20, clip.speechOffsetSec + 0.04)
      : Math.max(0.25, clip.durationSec - 0.08);

    if ((clip.sourceEndSec - clip.sourceStartSec - pauseSaved) > tailFloor + 0.015) {
      const newSourceEnd = Number((clip.sourceStartSec + pauseSaved + tailFloor).toFixed(3));
      if (newSourceEnd < clip.sourceEndSec) {
        clip.sourceEndSec = newSourceEnd;
        clip.unscaledDurationSec = Number(Math.max(0.20, tailFloor).toFixed(3));
        const rate = clip.playbackRate && clip.playbackRate > 1.005 ? clip.playbackRate : 1.0;
        clip.durationSec = Number((clip.unscaledDurationSec / rate).toFixed(3));
        trimmedCount++;
      }
    }

    // Step 2: Re-evaluate unified Soft Time-Fit rule (>25% overhang AND collides next, range 1.0x–1.18x)
    const unscaledDur = clip.unscaledDurationSec ?? Math.max(0.25, (clip.sourceEndSec - clip.sourceStartSec) - pauseSaved);
    const postEval = evaluateSoftTimeFit({
      curStartSec: curStart,
      clipDurationSec: clip.durationSec,
      unscaledDurationSec: unscaledDur,
      anchorStartSec: anchorStart,
      anchorEndSec: anchorEnd,
      speechOffsetSec: typeof clip.speechOffsetSec === 'number' && clip.speechOffsetSec > 0
        ? (clip.speechOffsetSec / (clip.playbackRate || 1))
        : undefined,
      nextPhraseCeilingSec: nextPhraseCeiling,
      playbackRate: clip.playbackRate || 1.0,
    });

    if (postEval.shouldApply) {
      const clampedRate = postEval.recommendedRate;
      clip.unscaledDurationSec = Number(unscaledDur.toFixed(3));
      clip.playbackRate = clampedRate;
      clip.durationSec = Number((unscaledDur / clampedRate).toFixed(3));
      clip.timeFitApplied = true;
      clip.timingNotRequired = false;

      // Keep vocal attack locked on anchorStart even after compression
      const adjustedStart = Number(
        Math.max(prevIntraEnd, Math.max(0, anchorStart - (onsetOffset / clampedRate))).toFixed(3)
      );
      if (Math.abs(adjustedStart - curStart) >= 0.01 && adjustedStart + clip.durationSec <= nextIntraStart) {
        clip.clipStartSec = adjustedStart;
        clip.offsetSec = 0;
        clip.targetSubStartSec = adjustedStart;
      }
      stretchedCount++;
      addLog?.(
        `⏩ [Soft Time-Fit ${clampedRate.toFixed(2)}x] «${clip.text.slice(0, 26)}» (${clip.dubberName}): длинный перевод сжат с ${unscaledDur.toFixed(2)}с до ${clip.durationSec.toFixed(2)}с без изменения тона`,
        'info'
      );
    }
  }

  clipsMap[trackId] = sorted;
  return { trimmedCount, stretchedCount };
}

/**
 * Rule 4: Cross-Role Missing Phrase Rescue.
 * If Actor A still has an unvoiced subtitle after primary pass, and Actor B nearby (±2.0s) has an
 * unassigned clip (orphan or mistaken "Физика") whose duration matches original within <= 40%
 * and falls within the subtitle window, bind Actor B's clip (`crossRoleMatched: true`).
 */
export function rescueCrossRoleMissingSubtitles(params: {
  tracks: Track[];
  clipsMap: Record<string, AudioClip[]>;
  trackSubLinesMap: Record<string, SubtitleLine[]>;
  vocalsBuffer?: AudioBuffer;
  vocalsNoiseDbHint?: number;
  applyShift?: boolean;
  addLog?: (msg: string, level?: 'info' | 'success' | 'warn' | 'error') => void;
}): { rescuedCount: number; rescuedSubKeys: Set<string> } {
  const {
    tracks,
    clipsMap,
    trackSubLinesMap,
    vocalsBuffer,
    vocalsNoiseDbHint,
    applyShift = true,
    addLog
  } = params;

  let rescuedCount = 0;
  const rescuedSubKeys = new Set<string>();
  const nonFixTracks = tracks.filter(t => !isFixTrack(t));

  for (const actorATrack of nonFixTracks) {
    const trSubs = [...(trackSubLinesMap[actorATrack.id] || [])].sort((a, b) => a.startSec - b.startSec);
    const aClips = clipsMap[actorATrack.id] || [];
    const aCharacter = actorATrack.character || actorATrack.characterName || 'Персонаж';

    for (let sIdx = 0; sIdx < trSubs.length; sIdx++) {
      const sub = trSubs[sIdx];
      const subIdStr = String(sub.id ?? sIdx);
      const subDur = Math.max(0.25, sub.endSec - sub.startSec);

      // Skip if Actor A already covers this subtitle
      const coveredOnA = aClips.some(c => {
        if (c.matchedSubId === subIdStr || c.coveredSubIds?.includes(subIdStr)) return true;
        if (c.isPhysics) return false;
        const cs = c.clipStartSec + (c.offsetSec || 0);
        const ce = cs + c.durationSec;
        const ov = Math.min(ce, sub.endSec + 0.25) - Math.max(cs, sub.startSec - 0.25);
        return ov >= Math.min(0.28, subDur * 0.35);
      });
      if (coveredOnA) continue;

      // Skip if another dubber's dialogue clip already covers this subtitle
      const alreadyCoveredByOtherDialogue = nonFixTracks.some(otherTr => {
        if (otherTr.id === actorATrack.id) return false;
        return (clipsMap[otherTr.id] || []).some(oc => {
          if (oc.isPhysics || oc.durationSec >= 90) return false;
          const os = oc.clipStartSec + (oc.offsetSec || 0);
          const oe = os + oc.durationSec;
          const ov = Math.min(oe, sub.endSec + 0.25) - Math.max(os, sub.startSec - 0.25);
          return ov >= Math.min(0.28, subDur * 0.35);
        });
      });
      if (alreadyCoveredByOtherDialogue) continue;

      const anchor = findOriginalVocalsAnchorForSub(vocalsBuffer, sub.startSec, sub.endSec, vocalsNoiseDbHint);
      const refDur = Math.max(0.20, anchor.anchorEndSec - anchor.anchorStartSec);

      let bestMatch: {
        trackB: Track;
        clipIdx: number;
        clip: AudioClip;
        score: number;
      } | null = null;

      for (const actorBTrack of nonFixTracks) {
        if (actorBTrack.id === actorATrack.id) continue;
        const bClips = clipsMap[actorBTrack.id] || [];

        for (let cIdx = 0; cIdx < bClips.length; cIdx++) {
          const cand = bClips[cIdx];
          // Must be unassigned (orphan or mistaken Physics) and not already cross-role rescued or synced physics
          const isUnassigned = cand.isPhysics || cand.timingIssue === 'orphan' || !cand.matchedSubId;
          if (!isUnassigned || cand.crossRoleMatched || cand.isSplitContinuation || cand.physicsSynced) continue;

          const cStart = cand.clipStartSec + (cand.offsetSec || 0);
          const cEnd = cStart + cand.durationSec;
          const onsetOffset = cand.speechOnsetOffsetSec || 0;
          const vocalAttack = cStart + onsetOffset;

          // Within ±2.0s window of subtitle
          const searchWin = TIMING_RULES.CROSS_ROLE_SEARCH_WINDOW_SEC;
          const startDist = Math.abs(vocalAttack - anchor.anchorStartSec);
          const inWindow =
            startDist <= searchWin &&
            cEnd >= sub.startSec - searchWin &&
            cStart <= sub.endSec + searchWin;
          if (!inWindow) continue;

          // Duration similarity <= 40% difference vs original (check clip duration or active speech duration)
          const speechDur = typeof cand.speechOffsetSec === 'number' && cand.speechOffsetSec > onsetOffset
            ? Math.max(0.12, cand.speechOffsetSec - onsetOffset)
            : cand.durationSec;
          const clipDiffRatio = Math.abs(cand.durationSec - refDur) / Math.max(0.25, refDur);
          const speechDiffRatio = Math.abs(speechDur - refDur) / Math.max(0.25, refDur);
          const minDurDiffRatio = Math.min(clipDiffRatio, speechDiffRatio);
          if (minDurDiffRatio > TIMING_RULES.CROSS_ROLE_MAX_DUR_DIFF_RATIO) continue;

          const score = startDist + minDurDiffRatio * 1.5;
          if (!bestMatch || score < bestMatch.score) {
            bestMatch = { trackB: actorBTrack, clipIdx: cIdx, clip: cand, score };
          }
        }
      }

      if (bestMatch) {
        const bClips = clipsMap[bestMatch.trackB.id];
        const targetClip = bClips[bestMatch.clipIdx];
        const onsetOffset = targetClip.speechOnsetOffsetSec || 0;
        const cStart = targetClip.clipStartSec + (targetClip.offsetSec || 0);
        const desiredStart = Math.max(0, anchor.anchorStartSec - onsetOffset);

        const prevEnd = bestMatch.clipIdx > 0
          ? (bClips[bestMatch.clipIdx - 1].clipStartSec + (bClips[bestMatch.clipIdx - 1].offsetSec || 0) + bClips[bestMatch.clipIdx - 1].durationSec + TIMING_RULES.MIN_SAME_TRACK_GAP_SEC)
          : 0;
        const nextStart = bestMatch.clipIdx + 1 < bClips.length
          ? (bClips[bestMatch.clipIdx + 1].clipStartSec + (bClips[bestMatch.clipIdx + 1].offsetSec || 0) - TIMING_RULES.MIN_SAME_TRACK_GAP_SEC)
          : Infinity;

        const safeTarget = Number(
          Math.max(0, Math.max(prevEnd, Math.min(desiredStart, Math.max(prevEnd, nextStart - targetClip.durationSec)))).toFixed(3)
        );

        targetClip.isPhysics = false;
        targetClip.crossRoleMatched = true;
        targetClip.crossRoleOriginalActor = aCharacter;
        targetClip.crossRoleTargetTrackId = actorATrack.id;
        targetClip.matchedSubId = subIdStr;
        targetClip.coveredSubIds = [subIdStr];
        targetClip.text = sub.text;
        targetClip.refVocalStartSec = anchor.refVocalStartSec;
        targetClip.refVocalEndSec = anchor.refVocalEndSec;
        targetClip.hasRefVocalAnchor = anchor.hasRefVocal;
        targetClip.targetSubStartSec = safeTarget;
        targetClip.targetSubEndSec = anchor.anchorEndSec;
        targetClip.timingIssue = null;
        targetClip.timingIssueText = undefined;
        targetClip.timeDiffSec = Number(((safeTarget + onsetOffset) - anchor.anchorStartSec).toFixed(2));

        if (applyShift && Math.abs(safeTarget - cStart) >= TIMING_RULES.MIN_EFFECTIVE_SHIFT_SEC) {
          targetClip.clipStartSec = safeTarget;
          targetClip.offsetSec = 0;
        }

        rescuedSubKeys.add(`${actorATrack.id}_${subIdStr}`);
        rescuedCount++;

        addLog?.(
          `🎭 [Кросс-спасение реплики] Пустой саб «${sub.text.slice(0, 26)}» (${aCharacter}) спасён за счёт непривязанного клипа актёра «${bestMatch.trackB.participant || bestMatch.trackB.dubberName}» (${formatSeconds(cStart)} ➔ ${formatSeconds(safeTarget)})`,
          'success'
        );
      }
    }
  }

  return { rescuedCount, rescuedSubKeys };
}
