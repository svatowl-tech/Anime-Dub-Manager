import {
  NoiseCalibration,
  AudioClip,
  IntentionalOverlapMoment,
  IntentionalOverlapTrackEntry,
  OriginalStemsState,
  Episode,
  Track,
  SubtitleLine
} from './timing.types';
import { TimingSettings } from '../TimingSettingsModal';
import { NormalizationMetrics } from '../../lib/qa/audioNormalizer';
import { normalizeSpeechText } from '../../lib/qa/whisperTextChecker';
import { formatSeconds } from './timing.utils';
import {
  analyzeTrackAudioNoiseFloor,
  detectSpeechIntervals,
  detectSpeechOnsetOffsetSec,
  measureClipActiveSpeechStats
} from './timing.dsp';
import {
  scanBufferWindowForSpeech,
  computeOriginalWaveformPeakStats,
  extractFallbackWebAudioPeaks,
  bindTrackClipsToSubtitlesMonotonicallyService
} from './timing.waveform';

/**
 * Surgical Overlap & Collision Resolver (Intra-Track & Inter-Track):
 * Protects simultaneous scenes, trims silent tails first, and shifts clips within safe boundaries.
 */
export function separateOverlappingClipPairService(params: {
  earlyClip: AudioClip;
  lateClip: AudioClip;
  earlyTrackClips: AudioClip[];
  lateTrackClips: AudioClip[];
  allClipsMap?: Record<string, AudioClip[]>;
  trackSubLinesMap: Record<string, SubtitleLine[]>;
  subtitles: SubtitleLine[];
  addLog?: (msg: string, level?: 'info' | 'warn' | 'error' | 'success') => void;
}): boolean {
  const {
    earlyClip,
    lateClip,
    earlyTrackClips,
    lateTrackClips,
    allClipsMap,
    trackSubLinesMap,
    subtitles,
    addLog
  } = params;

  const clearCollisionFlags = () => {
    earlyClip.hasCollision = false;
    lateClip.hasCollision = false;
    earlyClip.overlappingClipId = undefined;
    lateClip.overlappingClipId = undefined;
    if (earlyClip.timingIssue === 'overlap') {
      earlyClip.timingIssue = null;
      earlyClip.timingIssueText = undefined;
    }
    if (lateClip.timingIssue === 'overlap') {
      lateClip.timingIssue = null;
      lateClip.timingIssueText = undefined;
    }
  };

  const earlyStart = earlyClip.clipStartSec + (earlyClip.offsetSec || 0);
  const earlyEnd = earlyStart + earlyClip.durationSec;
  const lateStart = lateClip.clipStartSec + (lateClip.offsetSec || 0);
  const lateEnd = lateStart + lateClip.durationSec;
  const overlap = earlyEnd - lateStart;

  if (overlap <= 0.015) {
    clearCollisionFlags();
    return false;
  }

  const findBestSubForClip = (clip: AudioClip): SubtitleLine | undefined => {
    const trSubs = trackSubLinesMap[clip.trackId] || [];
    if (clip.matchedSubId) {
      const byId = trSubs.find(s => String(s.id) === String(clip.matchedSubId)) ||
        subtitles.find(s => String(s.id) === String(clip.matchedSubId));
      if (byId) return byId;
    }
    const cs = clip.clipStartSec + (clip.offsetSec || 0);
    const ce = cs + clip.durationSec;
    const pool = trSubs.length > 0 ? trSubs : subtitles;
    let best: SubtitleLine | undefined;
    let bestDist = Infinity;
    for (const s of pool) {
      const ov = Math.min(ce, s.endSec) - Math.max(cs, s.startSec);
      const dist = Math.abs(cs - s.startSec) - (ov > 0 ? ov * 0.5 : 0);
      if (Math.abs(cs - s.startSec) <= 1.35 && dist < bestDist) {
        bestDist = dist;
        best = s;
      }
    }
    return best;
  };

  const subEarly = findBestSubForClip(earlyClip);
  const subLate = findBestSubForClip(lateClip);
  const minClipDur = Math.min(earlyClip.durationSec, lateClip.durationSec);

  if (earlyClip.trackId !== lateClip.trackId) {
    if (
      earlyClip.isIntentionalOverlap ||
      lateClip.isIntentionalOverlap ||
      earlyClip.overlapRole ||
      lateClip.overlapRole ||
      earlyClip.isUnisonPhrase ||
      lateClip.isUnisonPhrase ||
      (earlyClip.timingNotRequired && lateClip.timingNotRequired)
    ) {
      clearCollisionFlags();
      return false;
    }
    if (
      lateStart - earlyStart <= 0.12 ||
      lateEnd <= earlyEnd + 0.15 ||
      overlap > 0.40 ||
      overlap > minClipDur * 0.38
    ) {
      clearCollisionFlags();
      return false;
    }
    if (subEarly && subLate) {
      if (subEarly.id !== undefined && subLate.id !== undefined && String(subEarly.id) === String(subLate.id)) {
        clearCollisionFlags();
        return false;
      }
      const subOv = Math.min(subEarly.endSec, subLate.endSec) - Math.max(subEarly.startSec, subLate.startSec);
      if (subOv > -0.05 || earlyEnd - subLate.startSec > 0.35) {
        clearCollisionFlags();
        return false;
      }
    }
    const activeGlobalSubs = subtitles.filter(
      s => s.endSec >= lateStart - 0.05 && s.startSec <= earlyEnd + 0.05
    );
    for (let a = 0; a < activeGlobalSubs.length; a++) {
      for (let b = a + 1; b < activeGlobalSubs.length; b++) {
        const gOv = Math.min(activeGlobalSubs[a].endSec, activeGlobalSubs[b].endSec) -
          Math.max(activeGlobalSubs[a].startSec, activeGlobalSubs[b].startSec);
        if (gOv >= 0.04) {
          clearCollisionFlags();
          return false;
        }
      }
    }
  } else {
    if (overlap > 0.50) {
      clearCollisionFlags();
      return false;
    }
  }

  const needed = overlap + 0.03;
  let remaining = needed;
  let movedOrTrimmed = false;

  if (earlyClip.durationSec - 0.10 >= 0.28) {
    const maxSafeTrim = Math.min(0.10, earlyClip.durationSec - 0.28);
    const trim = Math.min(remaining, maxSafeTrim);
    if (trim >= 0.015) {
      earlyClip.durationSec = Number((earlyClip.durationSec - trim).toFixed(3));
      earlyClip.sourceEndSec = Number((earlyClip.sourceStartSec + earlyClip.durationSec).toFixed(3));
      remaining -= trim;
      movedOrTrimmed = true;
    }
  }

  const origEarlyStart = earlyClip.rawSourceStartSec ?? earlyClip.sourceStartSec ?? earlyStart;
  const earlySorted = [...earlyTrackClips].sort(
    (a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0))
  );
  const earlyIdx = earlySorted.findIndex(c => c.id === earlyClip.id);
  let earlyPrevEnd = earlyIdx > 0
    ? (earlySorted[earlyIdx - 1].clipStartSec + (earlySorted[earlyIdx - 1].offsetSec || 0) + earlySorted[earlyIdx - 1].durationSec + 0.04)
    : 0;

  if (allClipsMap) {
    for (const [tId, list] of Object.entries(allClipsMap)) {
      if (tId === earlyClip.trackId) continue;
      for (const oc of list) {
        if (oc.id === earlyClip.id || oc.id === lateClip.id || oc.isPhysics) continue;
        const os = oc.clipStartSec + (oc.offsetSec || 0);
        const oe = os + oc.durationSec;
        if (oe <= earlyStart + 0.05 && oe > earlyStart - 0.35) {
          earlyPrevEnd = Math.max(earlyPrevEnd, oe + 0.04);
        }
      }
    }
  }

  const subEarlyFloor = subEarly ? subEarly.startSec - 0.12 : origEarlyStart - 0.18;
  const earlyMinAllowed = Math.max(earlyPrevEnd, origEarlyStart - 0.18, subEarlyFloor);
  const maxPullEarlyBack = Math.max(0, earlyStart - earlyMinAllowed);

  if (remaining > 0.008 && maxPullEarlyBack >= 0.015) {
    const pull = Math.min(remaining, maxPullEarlyBack);
    earlyClip.clipStartSec = Number(Math.max(0, earlyStart - pull).toFixed(3));
    earlyClip.offsetSec = 0;
    remaining -= pull;
    movedOrTrimmed = true;
  }

  if (remaining > 0.008) {
    const origLateStart = lateClip.rawSourceStartSec ?? lateClip.sourceStartSec ?? lateStart;
    const lateSorted = [...lateTrackClips].sort(
      (a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0))
    );
    const lateIdx = lateSorted.findIndex(c => c.id === lateClip.id);
    let nextAnyTrackStart = lateIdx !== -1 && lateIdx + 1 < lateSorted.length
      ? (lateSorted[lateIdx + 1].clipStartSec + (lateSorted[lateIdx + 1].offsetSec || 0) - 0.04)
      : Infinity;

    if (allClipsMap) {
      for (const [tId, list] of Object.entries(allClipsMap)) {
        if (tId === lateClip.trackId) continue;
        for (const oc of list) {
          if (oc.id === earlyClip.id || oc.id === lateClip.id || oc.isPhysics) continue;
          const os = oc.clipStartSec + (oc.offsetSec || 0);
          if (os >= lateStart + 0.15 && os <= lateEnd + 0.60) {
            nextAnyTrackStart = Math.min(nextAnyTrackStart, os - 0.04);
          }
        }
      }
    }

    const maxByNextClip = Math.max(0, nextAnyTrackStart - (lateStart + lateClip.durationSec));
    const maxByOrigPos = Math.max(0, (origLateStart + 0.25) - lateStart);
    const maxBySubPos = subLate ? Math.max(0, (subLate.startSec + 0.28) - lateStart) : 0.25;
    const maxPushLateForward = Math.min(maxByNextClip, maxByOrigPos, maxBySubPos);

    if (maxPushLateForward >= 0.015) {
      const push = Math.min(remaining, maxPushLateForward);
      lateClip.clipStartSec = Number((lateStart + push).toFixed(3));
      lateClip.offsetSec = 0;
      remaining -= push;
      movedOrTrimmed = true;
    }
  }

  const finalEarlyStart = earlyClip.clipStartSec + (earlyClip.offsetSec || 0);
  const finalLateStart = lateClip.clipStartSec + (lateClip.offsetSec || 0);

  earlyClip.targetSubStartSec = finalEarlyStart;
  lateClip.targetSubStartSec = finalLateStart;
  earlyClip.overlapResolvedLock = true;
  lateClip.overlapResolvedLock = true;
  clearCollisionFlags();

  if (movedOrTrimmed) {
    addLog?.(
      `↔️ Наезд раздвинут: «${earlyClip.dubberName}» (${formatSeconds(finalEarlyStart)}–${formatSeconds(finalEarlyStart + earlyClip.durationSec)}) и «${lateClip.dubberName}» (➔ ${formatSeconds(finalLateStart)})`,
      'success'
    );
    return true;
  }
  return false;
}

/**
 * Builds intentional overlap groups and synchronizes unison phrases across tracks for export.
 */
export function buildExportIntentionalOverlapsAndSyncUnisonService(
  clipsMap: Record<string, AudioClip[]>,
  trackSubLinesMap: Record<string, SubtitleLine[]>,
  intentionalOverlaps: IntentionalOverlapMoment[]
): IntentionalOverlapMoment[] {
  const trackIds = Object.keys(clipsMap);
  const existingPriorityById: Record<string, string | null> = {};
  intentionalOverlaps.forEach(ov => {
    if (ov.id && ov.priorityTrackKey) existingPriorityById[ov.id] = ov.priorityTrackKey;
  });

  const findSub = (trId: string, clip: AudioClip) => {
    const list = trackSubLinesMap[trId] || [];
    const cStart = clip.clipStartSec + (clip.offsetSec || 0);
    if (clip.matchedSubId) {
      const byId = list.find(s => String(s.id) === clip.matchedSubId);
      if (byId) return byId;
    }
    return list.find(s =>
      s.text === clip.text ||
      (typeof clip.targetSubStartSec === 'number' && Math.abs(s.startSec - clip.targetSubStartSec) < 0.25) ||
      Math.abs(s.startSec - cStart) < 1.2
    );
  };

  const overlapsMap = new Map<string, IntentionalOverlapMoment>();

  for (let i = 0; i < trackIds.length; i++) {
    for (let j = i + 1; j < trackIds.length; j++) {
      const tr1Clips = clipsMap[trackIds[i]] || [];
      const tr2Clips = clipsMap[trackIds[j]] || [];

      for (const c1 of tr1Clips) {
        const c1Start = c1.clipStartSec + (c1.offsetSec || 0);
        const c1End = c1Start + c1.durationSec;
        const sub1 = findSub(trackIds[i], c1);

        for (const c2 of tr2Clips) {
          const c2Start = c2.clipStartSec + (c2.offsetSec || 0);
          const c2End = c2Start + c2.durationSec;
          const sub2 = findSub(trackIds[j], c2);

          if (!sub1 || !sub2) continue;

          const normT1 = normalizeSpeechText(sub1.text || c1.text || '');
          const normT2 = normalizeSpeechText(sub2.text || c2.text || '');
          const isSamePhrase =
            (sub1.id !== undefined && sub2.id !== undefined && String(sub1.id) === String(sub2.id)) ||
            (normT1 !== '' && normT1 === normT2 && Math.abs(sub1.startSec - sub2.startSec) <= 0.08);

          if (isSamePhrase) {
            const syncStart = Number(Math.max(0, sub1.startSec).toFixed(3));
            c1.clipStartSec = syncStart;
            c1.offsetSec = 0;
            c2.clipStartSec = syncStart;
            c2.offsetSec = 0;
            c1.isUnisonPhrase = true;
            c2.isUnisonPhrase = true;
            continue;
          }

          const subOvStart = Math.max(sub1.startSec, sub2.startSec);
          const subOvEnd = Math.min(sub1.endSec, sub2.endSec);
          if (subOvEnd > subOvStart + 0.05) {
            c1.isIntentionalOverlap = true;
            c2.isIntentionalOverlap = true;

            const ovStart = Number(Math.max(c1Start, c2Start).toFixed(2));
            const ovEnd = Number(Math.min(c1End, c2End).toFixed(2));
            const sStart = Number(Math.min(sub1.startSec, sub2.startSec).toFixed(2));
            const sEnd = Number(Math.max(sub1.endSec, sub2.endSec).toFixed(2));

            let matchedGroup: IntentionalOverlapMoment | undefined;
            for (const grp of overlapsMap.values()) {
              if (Math.min(grp.endSec, Math.max(c1End, c2End)) > Math.max(grp.startSec, Math.min(c1Start, c2Start)) - 0.25) {
                matchedGroup = grp;
                break;
              }
            }

            const entry1: IntentionalOverlapTrackEntry = {
              trackId: trackIds[i],
              dubberNick: c1.dubberName,
              characterName: c1.characterName,
              phraseId: c1.id,
              subId: String(sub1.id ?? ''),
              text: sub1.text || c1.text,
              phraseStartSec: Number(c1Start.toFixed(2)),
              phraseEndSec: Number(c1End.toFixed(2))
            };
            const entry2: IntentionalOverlapTrackEntry = {
              trackId: trackIds[j],
              dubberNick: c2.dubberName,
              characterName: c2.characterName,
              phraseId: c2.id,
              subId: String(sub2.id ?? ''),
              text: sub2.text || c2.text,
              phraseStartSec: Number(c2Start.toFixed(2)),
              phraseEndSec: Number(c2End.toFixed(2))
            };

            if (!matchedGroup) {
              const groupId = c1.overlapGroupId || c2.overlapGroupId || `sub_overlap_${Math.round(sStart * 10)}_${sub1.id ?? i}_${sub2.id ?? j}`;
              const chosenMainKey =
                c1.overlapRole === 'main'
                  ? `${trackIds[i]}::${c1.id}`
                  : c2.overlapRole === 'main'
                  ? `${trackIds[j]}::${c2.id}`
                  : existingPriorityById[groupId] || null;
              matchedGroup = {
                id: groupId,
                startSec: Math.min(entry1.phraseStartSec, entry2.phraseStartSec),
                endSec: Math.max(entry1.phraseEndSec, entry2.phraseEndSec),
                overlapStartSec: ovStart,
                overlapEndSec: Math.max(ovStart + 0.1, ovEnd),
                subStartSec: sStart,
                subEndSec: sEnd,
                priorityTrackKey: chosenMainKey,
                attenuationDb: -10,
                tracks: [entry1, entry2]
              };
              overlapsMap.set(groupId, matchedGroup);
            } else {
              matchedGroup.startSec = Math.min(matchedGroup.startSec, entry1.phraseStartSec, entry2.phraseStartSec);
              matchedGroup.endSec = Math.max(matchedGroup.endSec, entry1.phraseEndSec, entry2.phraseEndSec);
              if (c1.overlapRole === 'main') matchedGroup.priorityTrackKey = `${trackIds[i]}::${c1.id}`;
              else if (c2.overlapRole === 'main') matchedGroup.priorityTrackKey = `${trackIds[j]}::${c2.id}`;
              if (!matchedGroup.tracks.some(t => t.dubberNick === entry1.dubberNick && t.phraseId === entry1.phraseId)) {
                matchedGroup.tracks.push(entry1);
              }
              if (!matchedGroup.tracks.some(t => t.dubberNick === entry2.dubberNick && t.phraseId === entry2.phraseId)) {
                matchedGroup.tracks.push(entry2);
              }
            }
          }
        }
      }
    }
  }

  const result = Array.from(overlapsMap.values()).sort((a, b) => a.startSec - b.startSec);
  return result.length > 0 ? result : intentionalOverlaps;
}

/**
 * Builds the complete timing metadata payload for Mixing and Sound Engineer export.
 */
export function buildTimingExportMetadata(params: {
  currentEpisode: Episode;
  tracks: Track[];
  enrichedAudioClips: Record<string, AudioClip[]>;
  exportIntentionalOverlaps: IntentionalOverlapMoment[];
  isSilenceRemoved: boolean;
  isFixesStitched: boolean;
  isTimingAnalyzed: boolean;
  isAutoNormalize: boolean;
  normalizationMetrics: Record<string, NormalizationMetrics>;
  calibrationsByTrack: Record<string, NoiseCalibration>;
  timingSettings: TimingSettings;
  originalStems: OriginalStemsState;
  duration: number;
  videoUrl: string | null;
}) {
  const {
    currentEpisode,
    tracks,
    enrichedAudioClips,
    exportIntentionalOverlaps,
    isSilenceRemoved,
    isFixesStitched,
    isTimingAnalyzed,
    isAutoNormalize,
    normalizationMetrics,
    calibrationsByTrack,
    timingSettings,
    originalStems,
    duration,
    videoUrl
  } = params;

  return {
    episodeId: currentEpisode.id,
    tracks: tracks.map(t => ({
      ...t,
      dubberName: t.participant,
      characterName: t.character || t.characterName || 'Персонаж',
      clips: (enrichedAudioClips[t.id] || []).map(({ customAudioBuffer, ...rest }) => rest),
      normalizationGainDb: isAutoNormalize ? (normalizationMetrics[t.id]?.gainDb || 0) : 0,
      calibration: calibrationsByTrack[t.id] || null
    })),
    audioClips: Object.fromEntries(
      Object.entries(enrichedAudioClips).map(([k, list]) => [
        k,
        list.map(({ customAudioBuffer, ...rest }) => rest)
      ])
    ),
    isSilenceRemoved,
    isFixesStitched,
    isTimingAnalyzed,
    isAutoNormalized: isAutoNormalize,
    intentionalOverlaps: exportIntentionalOverlaps,
    timingSettings,
    originalStems: originalStems.hasStems
      ? {
          hasStems: true,
          modelId: originalStems.modelId,
          vocalsPath: originalStems.vocalsPath,
          vocalsUrl: originalStems.vocalsUrl,
          vocalsVolume: originalStems.vocalsVolume,
          vocalsMuted: originalStems.vocalsMuted,
          instrumentalPath: originalStems.instrumentalPath,
          instrumentalUrl: originalStems.instrumentalUrl,
          instrumentalVolume: originalStems.instrumentalVolume,
          instrumentalMuted: originalStems.instrumentalMuted
        }
      : null,
    duration,
    videoPath: (currentEpisode as any).videoPath || currentEpisode.rawPath,
    videoUrl,
    exportedAt: new Date().toISOString()
  };
}

export {
  analyzeTrackAudioNoiseFloor,
  detectSpeechIntervals,
  detectSpeechOnsetOffsetSec,
  measureClipActiveSpeechStats,
  scanBufferWindowForSpeech,
  computeOriginalWaveformPeakStats,
  extractFallbackWebAudioPeaks,
  bindTrackClipsToSubtitlesMonotonicallyService,
  bindTrackClipsToSubtitlesMonotonicallyService as bindTrackClipsToSubtitlesMonotonically,
  separateOverlappingClipPairService as separateOverlappingClipPair,
  buildExportIntentionalOverlapsAndSyncUnisonService as buildExportIntentionalOverlapsAndSyncUnison
};
