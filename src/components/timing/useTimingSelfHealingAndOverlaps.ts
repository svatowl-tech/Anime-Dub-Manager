import { useCallback } from 'react';
import type React from 'react';
import { toast } from 'sonner';
import { Track, SubtitleLine } from '../../types';
import { TimingSettings } from '../TimingSettingsModal';
import { isPhraseTimingNotRequired } from './timingAudioUtils';
import {
  AudioClip,
  IntentionalOverlapMoment,
  MissingSubtitleMarker,
} from './timing.types';
import {
  formatSeconds,
  normalizeName,
} from './timing.utils';
import {
  detectSpeechOnsetOffsetSec,
} from './timing.dsp';
import {
  bindTrackClipsToSubtitlesMonotonicallyService,
  scanBufferWindowForSpeech,
} from './timing.waveform';
import {
  separateOverlappingClipPair as separateOverlappingClipPairService,
} from './timing.service';

export interface SelfHealingVerificationReport {
  totalSubs: number;
  voicedSubs: number;
  voicedByOtherDubberCount?: number;
  recoveredFromFixCount: number;
  recoveredFromOrigCount: number;
  realignedCount: number;
  physicsProtectedCount: number;
  iterationsRun: number;
  unvoicedSubs: MissingSubtitleMarker[];
  passed: boolean;
}

export interface UseTimingSelfHealingAndOverlapsParams {
  tracks: Track[];
  trackSubLinesMap: Record<string, SubtitleLine[]>;
  subtitles: SubtitleLine[];
  timingSettings: TimingSettings;
  audioBuffersRef: React.MutableRefObject<Record<string, AudioBuffer>>;
  origBuffersByTrackRef: React.MutableRefObject<Record<string, { buffer: AudioBuffer; filePath?: string; sourceTrackId: string }>>;
  fixBuffersByActorRef: React.MutableRefObject<Record<string, Array<{ buffer: AudioBuffer; filePath?: string; sourceTrackId: string; participant: string }>>>;
  setAudioClips: React.Dispatch<React.SetStateAction<Record<string, AudioClip[]>>>;
  setIntentionalOverlaps: React.Dispatch<React.SetStateAction<IntentionalOverlapMoment[]>>;
  addLog: (msg: string, level?: 'info' | 'success' | 'warn' | 'error') => void;
}

export function useTimingSelfHealingAndOverlaps({
  tracks,
  trackSubLinesMap,
  subtitles,
  timingSettings,
  audioBuffersRef,
  origBuffersByTrackRef,
  fixBuffersByActorRef,
  setAudioClips,
  setIntentionalOverlaps,
  addLog,
}: UseTimingSelfHealingAndOverlapsParams) {
  // Toggle Main (0 dB) vs Secondary (-10 dB) voice directly from an overlapping clip card on the timeline
  const handleSetOverlapMainClip = useCallback((groupId: string, mainClipId: string, mainDubberName: string) => {
    setIntentionalOverlaps(prev =>
      prev.map(grp => grp.id === groupId ? { ...grp, priorityTrackKey: mainDubberName } : grp)
    );
    setAudioClips(prev => {
      const next: Record<string, AudioClip[]> = {};
      for (const [trId, trClips] of Object.entries(prev)) {
        next[trId] = trClips.map(c => {
          if (c.overlapGroupId !== groupId) return c;
          const isMain = c.id === mainClipId || c.dubberName === mainDubberName;
          return {
            ...c,
            overlapRole: isMain ? 'main' : 'secondary',
            volumeGainDb: isMain ? 0 : -10
          };
        });
      }
      return next;
    });
    addLog(`🔊 В пересечении сабов главным голосом выбран «${mainDubberName}» (0 дБ), второстепенные голоса автоматически приглушены на -10 дБ.`, 'info');
    toast.success(`Главный голос: ${mainDubberName} (0 дБ) • Второй голос: -10 дБ`);
  }, [setIntentionalOverlaps, setAudioClips, addLog]);

  // Activate Main/Secondary mode on a phrase (and pair it with any overlapping phrase on other tracks)
  const handleActivateClipOverlapMode = useCallback((trackId: string, clipId: string, targetRole: 'main' | 'secondary' = 'main') => {
    setAudioClips(prev => {
      const next: Record<string, AudioClip[]> = {};
      for (const [tId, trClips] of Object.entries(prev)) {
        next[tId] = trClips.map(c => ({ ...c }));
      }

      const thisClip = next[trackId]?.find(c => c.id === clipId);
      if (!thisClip) return prev;

      const cStart = thisClip.clipStartSec + (thisClip.offsetSec || 0);
      const cEnd = cStart + thisClip.durationSec;
      const groupId = thisClip.overlapGroupId || `ov_grp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      thisClip.overlapGroupId = groupId;
      thisClip.isIntentionalOverlap = true;
      thisClip.overlapRole = targetRole;
      thisClip.overlapRoleDisabled = false;
      thisClip.volumeGainDb = targetRole === 'main' ? 0 : -10;
      thisClip.hasCollision = false;
      if (thisClip.timingIssue === 'overlap') {
        thisClip.timingIssue = null;
        thisClip.timingIssueText = undefined;
      }

      let pairedDubber = '';
      for (const [otherTrackId, otherClips] of Object.entries(next)) {
        if (otherTrackId === trackId) continue;
        for (const oc of otherClips) {
          if (oc.isPhysics) continue;
          const os = oc.clipStartSec + (oc.offsetSec || 0);
          const oe = os + oc.durationSec;
          const overlap = Math.min(cEnd, oe) - Math.max(cStart, os);
          if (overlap > 0.04) {
            oc.overlapGroupId = groupId;
            oc.isIntentionalOverlap = true;
            oc.overlapRole = targetRole === 'main' ? 'secondary' : 'main';
            oc.overlapRoleDisabled = false;
            oc.volumeGainDb = oc.overlapRole === 'main' ? 0 : -10;
            oc.hasCollision = false;
            if (oc.timingIssue === 'overlap') {
              oc.timingIssue = null;
              oc.timingIssueText = undefined;
            }
            pairedDubber = oc.dubberName;
          }
        }
      }

      addLog(`✨ Активирован режим одновременной речи: «${thisClip.dubberName}» (${targetRole === 'main' ? '★ Главный 0 дБ' : '🔉 Второй -10 дБ'})${pairedDubber ? ` в паре с «${pairedDubber}»` : ''}.`, 'info');
      toast.success(`Режим одновременной речи: ${thisClip.dubberName} (${targetRole === 'main' ? '★ Главный 0 дБ' : '🔉 Второй -10 дБ'})`);

      return next;
    });
  }, [setAudioClips, addLog]);

  // Remove Main/Secondary mode from a phrase (restore 0 dB)
  const handleRemoveClipOverlapMode = useCallback((trackId: string, clipId: string) => {
    setAudioClips(prev => {
      const next: Record<string, AudioClip[]> = {};
      for (const [tId, trClips] of Object.entries(prev)) {
        next[tId] = trClips.map(c => ({ ...c }));
      }

      const thisClip = next[trackId]?.find(c => c.id === clipId);
      if (!thisClip) return prev;

      thisClip.overlapRole = null;
      thisClip.overlapRoleDisabled = true;
      thisClip.volumeGainDb = 0;
      thisClip.isIntentionalOverlap = false;
      thisClip.overlapGroupId = undefined;

      addLog(`🚫 Режим Главный/Второй снят с фразы «${thisClip.text.slice(0, 30)}» (${thisClip.dubberName}), громкость возвращена на 0 дБ.`, 'info');
      toast.info(`Режим Главный/Второй отключен (0 дБ)`);

      return next;
    });
  }, [setAudioClips, addLog]);

  // Toggle Main (0 dB) <-> Secondary (-10 dB) role, or activate if not active
  const handleToggleClipOverlapRole = useCallback((trackId: string, clipId: string) => {
    setAudioClips(prev => {
      const next: Record<string, AudioClip[]> = {};
      for (const [tId, trClips] of Object.entries(prev)) {
        next[tId] = trClips.map(c => ({ ...c }));
      }

      const thisClip = next[trackId]?.find(c => c.id === clipId);
      if (!thisClip) return prev;

      if (!thisClip.overlapRole) {
        const groupId = thisClip.overlapGroupId || `ov_grp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        thisClip.overlapGroupId = groupId;
        thisClip.isIntentionalOverlap = true;
        thisClip.overlapRole = 'main';
        thisClip.overlapRoleDisabled = false;
        thisClip.volumeGainDb = 0;
        thisClip.hasCollision = false;
        toast.success(`Фраза «${thisClip.dubberName}» сделана Главной (0 дБ)`);
      } else if (thisClip.overlapRole === 'main') {
        thisClip.overlapRole = 'secondary';
        thisClip.volumeGainDb = -10;
        toast.info(`Фраза «${thisClip.dubberName}» сделана Второй (-10 дБ)`);
      } else {
        thisClip.overlapRole = 'main';
        thisClip.volumeGainDb = 0;
        toast.success(`Фраза «${thisClip.dubberName}» сделана Главной (0 дБ)`);
      }

      if (thisClip.overlapGroupId) {
        for (const [tId, trClips] of Object.entries(next)) {
          for (const oc of trClips) {
            if (oc.id !== thisClip.id && oc.overlapGroupId === thisClip.overlapGroupId) {
              oc.overlapRole = thisClip.overlapRole === 'main' ? 'secondary' : 'main';
              oc.volumeGainDb = oc.overlapRole === 'main' ? 0 : -10;
            }
          }
        }
      }

      return next;
    });
  }, [setAudioClips]);

  // Manual toggle between "⚡ Физика" (protected non-subtitle sound) and "💬 Фраза" (dialogue phrase)
  const handleToggleClipPhysics = useCallback((trackId: string, clipId: string) => {
    setAudioClips(prev => {
      const trClips = prev[trackId] || [];
      const trSubs = trackSubLinesMap[trackId] || [];
      const updated = trClips.map(c => {
        if (c.id !== clipId) return c;
        const nextIsPhysics = !c.isPhysics;
        if (nextIsPhysics) {
          addLog(`⚡ Клип «${c.text.slice(0, 25)}» (${formatSeconds(c.clipStartSec)}) помечен как «Физика» — защищён от сдвига и удаления.`, 'info');
          return {
            ...c,
            isPhysics: true,
            timingIssue: null,
            timingIssueText: undefined,
            targetSubStartSec: undefined,
            matchedSubId: undefined,
            coveredSubIds: undefined
          };
        } else {
          const cStart = c.clipStartSec + (c.offsetSec || 0);
          const nearSub = trSubs.find(s => Math.abs(s.startSec - cStart) <= 3.0);
          addLog(`💬 Клип на ${formatSeconds(cStart)} переведён в режим «Фраза диалога»${nearSub ? ` (саб: «${nearSub.text.slice(0, 25)}»)` : ''}.`, 'info');
          return {
            ...c,
            isPhysics: false,
            text: nearSub ? nearSub.text : c.text.replace(/^⚡ Физика\s*\([^)]*\)\s*/i, '') || 'Фраза',
            matchedSubId: nearSub ? String(nearSub.id) : undefined,
            targetSubStartSec: nearSub ? nearSub.startSec : undefined
          };
        }
      });
      return { ...prev, [trackId]: updated };
    });
  }, [trackSubLinesMap, setAudioClips, addLog]);

  // ---------------------------------------------------------------------------
  // MONOTONIC SUBTITLE-TO-CLIP BINDING HELPER
  // ---------------------------------------------------------------------------
  const bindTrackClipsToSubtitlesMonotonically = useCallback((
    track: Track,
    rawClips: AudioClip[],
    trSubs: SubtitleLine[]
  ): AudioClip[] => {
    return bindTrackClipsToSubtitlesMonotonicallyService(track, rawClips, trSubs, audioBuffersRef.current);
  }, [audioBuffersRef]);

  // ---------------------------------------------------------------------------
  // ITERATIVE SELF-HEALING FINAL AUDIT LOOP
  // ---------------------------------------------------------------------------
  const runIterativeSelfHealingAudit = useCallback((
    clipsInput: Record<string, AudioClip[]>
  ): {
    healedClips: Record<string, AudioClip[]>;
    report: SelfHealingVerificationReport;
  } => {
    const workingClips: Record<string, AudioClip[]> = {};
    for (const [trId, list] of Object.entries(clipsInput)) {
      workingClips[trId] = list.map(c => ({ ...c }));
    }

    // Helper: check if another dubber's track already voices a subtitle window `[sub.startSec, sub.endSec]`
    const findOtherDubberCoveringSubtitle = (currentTrackId: string, sub: SubtitleLine): { dubberName: string; clip: AudioClip } | null => {
      const subDur = Math.max(0.25, sub.endSec - sub.startSec);
      for (const otherTrack of tracks) {
        if (otherTrack.id === currentTrackId) continue;
        const otherClips = workingClips[otherTrack.id] || [];
        for (const oc of otherClips) {
          if (oc.isPhysics) continue;
          const os = oc.clipStartSec + (oc.offsetSec || 0);
          const oe = os + oc.durationSec;
          const ov = Math.min(oe, sub.endSec + 0.20) - Math.max(os, sub.startSec - 0.20);
          if (ov >= Math.min(0.28, subDur * 0.35)) {
            return {
              dubberName: otherTrack.participant || otherTrack.dubberName || 'Другой даббер',
              clip: oc
            };
          }
        }
      }
      return null;
    };

    // Helper: find the latest end time of a preceding dialogue turn on any other track so moving a clip earlier never creates an inter-track overlap
    const getPrevInterTrackTurnEnd = (currentTrackId: string, curStart: number, targetStart: number): number => {
      let maxPrevEnd = 0;
      for (const [otherTrId, otherClips] of Object.entries(workingClips)) {
        if (otherTrId === currentTrackId) continue;
        for (const oc of otherClips) {
          if (oc.isPhysics) continue;
          const os = oc.clipStartSec + (oc.offsetSec || 0);
          const oe = os + oc.durationSec;
          if (os < curStart - 0.10 && oe > targetStart - 0.04 && oe <= curStart + 0.65) {
            maxPrevEnd = Math.max(maxPrevEnd, oe + 0.04);
          }
        }
      }
      return maxPrevEnd;
    };

    const MAX_ITERATIONS = 4;
    let recoveredFromFixCount = 0;
    let recoveredFromOrigCount = 0;
    let realignedCount = 0;
    let iterationsRun = 0;

    for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
      iterationsRun = iter;
      let actionsInPass = 0;

      for (const track of tracks) {
        const trSubs = [...(trackSubLinesMap[track.id] || [])].sort((a, b) => a.startSec - b.startSec);
        if (trSubs.length === 0) continue;

        const dubberName = track.participant || track.dubberName || 'Даббер';
        const characterName = track.character || track.characterName || 'Персонаж';
        const actorNorm = normalizeName(dubberName);

        // Re-bind clips monotonically at the start of each pass so matchedSubId & coveredSubIds are 100% accurate
        let trClips = bindTrackClipsToSubtitlesMonotonically(track, workingClips[track.id] || [], trSubs);
        // Lock all split-phrase continuation clips right away so they are never grabbed by any subsequent subtitle
        const lockedClipIds = new Set<string>(
          trClips.filter(c => c.isSplitContinuation || c.overlapResolvedLock).map(c => c.id)
        );

        for (let sIdx = 0; sIdx < trSubs.length; sIdx++) {
          const sub = trSubs[sIdx];
          const subIdStr = String(sub.id ?? sIdx);

          // 1. Check if `sub` is a SECONDARY subtitle (index >= 1) of a continuous multi-subtitle clip or split phrase.
          const multiSubOwner = trClips.find(
            c => !c.isPhysics && c.coveredSubIds && c.coveredSubIds.length > 1 && c.coveredSubIds.includes(subIdStr) && c.coveredSubIds[0] !== subIdStr
          );
          if (multiSubOwner) {
            lockedClipIds.add(multiSubOwner.id);
            continue;
          }

          // 2. Find the primary clip assigned to `sub`
          let coveringClipIdx = trClips.findIndex(
            c => !c.isPhysics && !c.isSplitContinuation && !lockedClipIds.has(c.id) && (c.matchedSubId === subIdStr || c.coveredSubIds?.[0] === subIdStr)
          );
          if (coveringClipIdx === -1) {
            coveringClipIdx = trClips.findIndex(c => {
              if (c.isPhysics || c.isSplitContinuation || lockedClipIds.has(c.id)) return false;
              if (c.matchedSubId && c.matchedSubId !== subIdStr) return false;
              const cs = c.clipStartSec + (c.offsetSec || 0);
              const ce = cs + c.durationSec;
              return cs <= sub.endSec + 0.35 && ce >= sub.startSec - 0.35;
            });
          }

          if (coveringClipIdx !== -1) {
            const covClip = trClips[coveringClipIdx];
            lockedClipIds.add(covClip.id);

            if (covClip.isSplitContinuation || covClip.overlapResolvedLock || covClip.isUnisonPhrase || covClip.overlapRole) {
              continue;
            }

            const covStart = covClip.clipStartSec + (covClip.offsetSec || 0);
            const origStart = covClip.rawSourceStartSec ?? covClip.sourceStartSec ?? covStart;

            // User Rule: If phrase does not exceed sub or tail <= 30% of sub duration, timing is NOT required!
            const exemptCheck = isPhraseTimingNotRequired(covStart, covClip.durationSec, sub.startSec, sub.endSec);
            if (exemptCheck.notRequired) {
              covClip.timingNotRequired = true;
              covClip.timingNotRequiredReason = exemptCheck.reason;
              covClip.targetSubStartSec = covStart;
              continue; // Phrase is exempt from timing, leave in place!
            }

            const signedDiff = covStart - sub.startSec;

            // Only align if the phrase is genuinely displaced (starts > 0.35s BEFORE sub.startSec or > 0.55s AFTER sub.startSec)
            const isDisplaced = signedDiff < -0.35 || signedDiff > 0.55;

            if (isDisplaced) {
              const prevIntraLim = coveringClipIdx > 0
                ? (trClips[coveringClipIdx - 1].clipStartSec + (trClips[coveringClipIdx - 1].offsetSec || 0) + trClips[coveringClipIdx - 1].durationSec + 0.03)
                : 0;
              const idealStart = Math.max(0, sub.startSec);
              const prevInterLim = idealStart < covStart
                ? getPrevInterTrackTurnEnd(track.id, covStart, idealStart)
                : 0;
              const prevLim = Math.max(prevIntraLim, prevInterLim);

              const nextLim = coveringClipIdx + 1 < trClips.length
                ? (trClips[coveringClipIdx + 1].clipStartSec + (trClips[coveringClipIdx + 1].offsetSec || 0) - covClip.durationSec - 0.03)
                : Infinity;

              // Never move a clip more than 0.40s from its recorded position
              const clampedTarget = Math.max(origStart - 0.40, Math.min(origStart + 0.40, idealStart));
              const healedStart = Number(
                Math.max(0, Math.max(prevLim, Math.min(clampedTarget, Math.max(prevLim, nextLim)))).toFixed(3)
              );

              if (Math.abs(healedStart - covStart) >= 0.06 && Math.abs(healedStart - idealStart) < Math.abs(covStart - idealStart) - 0.04) {
                covClip.clipStartSec = healedStart;
                covClip.offsetSec = 0;
                covClip.matchedSubId = subIdStr;
                covClip.targetSubStartSec = healedStart;
                covClip.timeDiffSec = Number((healedStart - sub.startSec).toFixed(2));
                covClip.timingIssue = null;
                realignedCount++;
                actionsInPass++;
                addLog(
                  `🔄 [Аудит Итерация #${iter}] Выровнена сдвинутая реплика «${sub.text.slice(0, 28)}» (${dubberName}) ➔ ${formatSeconds(healedStart)}`,
                  'info'
                );
              }
            }
            continue;
          }

          // 3. Check if any clip on this track (including split continuations) already covers [sub.startSec, sub.endSec] acoustically
          const alreadyCoveredAcoustically = trClips.some(c => {
            const cs = c.clipStartSec + (c.offsetSec || 0);
            const ce = cs + c.durationSec;
            const overlap = Math.min(ce, sub.endSec + 0.25) - Math.max(cs, sub.startSec - 0.25);
            return overlap >= Math.min(0.22, (sub.endSec - sub.startSec) * 0.30);
          });
          if (alreadyCoveredAcoustically) continue;

          // Subtitle `sub` is UNVOICED on this dubber's timeline — check local corridor first
          const prevSubEnd = sIdx > 0 ? trSubs[sIdx - 1].endSec : 0;
          const nextSubStart = sIdx + 1 < trSubs.length ? trSubs[sIdx + 1].startSec : Infinity;

          // Step A: Check if a clip right inside this subtitle's tight local window (<= 0.75s) was tagged as `isPhysics`
          const nearbyPhysicsIdx = trClips.findIndex(c => {
            if (!c.isPhysics || lockedClipIds.has(c.id)) return false;
            const cs = c.clipStartSec + (c.offsetSec || 0);
            return cs >= prevSubEnd - 0.15 && cs <= nextSubStart + 0.15 && Math.abs(cs - sub.startSec) <= 0.75;
          });

          if (nearbyPhysicsIdx !== -1) {
            const rescuedClip = trClips[nearbyPhysicsIdx];
            lockedClipIds.add(rescuedClip.id);
            rescuedClip.isPhysics = false;
            rescuedClip.overlapResolvedLock = true;
            rescuedClip.text = sub.text;
            rescuedClip.matchedSubId = subIdStr;
            rescuedClip.coveredSubIds = [subIdStr];
            rescuedClip.targetSubStartSec = rescuedClip.clipStartSec;
            rescuedClip.targetSubEndSec = sub.endSec;
            rescuedClip.timingIssue = null;
            realignedCount++;
            actionsInPass++;
            addLog(
              `🛡 [Аудит Итерация #${iter}] Реплика «${sub.text.slice(0, 28)}» (${dubberName}) возвращена из категории физики на ${formatSeconds(rescuedClip.clipStartSec)}`,
              'success'
            );
            continue;
          }

          // Step B: Search Priority 1 — Fix Track Buffers, then Priority 2 — Original Track Buffer
          const localWinStart = Math.max(0, Math.max(prevSubEnd - 0.10, sub.startSec - 1.3));
          const localWinEnd = Math.min(nextSubStart + 0.10, sub.endSec + 1.3);
          if (localWinEnd <= localWinStart + 0.18) continue;

          const isSourceIntervalAlreadyUsed = (ivStart: number, ivEnd: number): boolean => {
            return trClips.some(existing => {
              const srcOverlap = Math.min(existing.sourceEndSec, ivEnd) - Math.max(existing.sourceStartSec, ivStart);
              const tlStart = existing.clipStartSec + (existing.offsetSec || 0);
              const tlEnd = tlStart + existing.durationSec;
              const tlOverlap = Math.min(tlEnd, ivEnd) - Math.max(tlStart, ivStart);
              return srcOverlap >= 0.08 || tlOverlap >= 0.12;
            });
          };

          let recoveredClip: AudioClip | null = null;

          // Priority 1: Fix Track Buffers for this dubber
          const actorFixBuffers = fixBuffersByActorRef.current[actorNorm] || [];
          for (const fixSource of actorFixBuffers) {
            const candidateIntervals = scanBufferWindowForSpeech(
              fixSource.buffer,
              localWinStart,
              Math.min(fixSource.buffer.duration, localWinEnd),
              timingSettings.leadInPaddingSec,
              timingSettings.leadOutPaddingSec
            );
            const unusedIv = candidateIntervals.find(iv => !isSourceIntervalAlreadyUsed(iv.startSec, iv.endSec));
            if (unusedIv) {
              recoveredClip = {
                id: `clip_${track.id}_healed_fix_${subIdStr}_${iter}`,
                trackId: track.id,
                dubberName,
                characterName,
                clipStartSec: Number(unusedIv.startSec.toFixed(3)),
                durationSec: unusedIv.durationSec,
                sourceStartSec: unusedIv.startSec,
                sourceEndSec: unusedIv.endSec,
                rawSourceStartSec: unusedIv.startSec,
                rawSourceEndSec: unusedIv.endSec,
                speechOnsetOffsetSec: detectSpeechOnsetOffsetSec(fixSource.buffer, unusedIv.startSec, unusedIv.endSec),
                sourceAudioTrackId: fixSource.sourceTrackId,
                sourceAudioPath: fixSource.filePath || track.filePath,
                text: sub.text,
                matchedSubId: subIdStr,
                coveredSubIds: [subIdStr],
                targetSubStartSec: sub.startSec,
                targetSubEndSec: sub.endSec,
                volumePercent: 100,
                isFix: true,
                isPhysics: false,
                recoveredFrom: 'fix',
                hasCollision: false,
                offsetSec: 0,
                timingIssue: null
              };
              recoveredFromFixCount++;
              addLog(
                `🚑 [Аудит Итерация #${iter}] Пропущенная реплика «${sub.text.slice(0, 30)}» (${dubberName}) найдена в ДОРОЖКЕ ФИКСОВ [${formatSeconds(unusedIv.startSec)}-${formatSeconds(unusedIv.endSec)}] и восстановлена!`,
                'success'
              );
              break;
            }
          }

          // Priority 2: Original Main Track Buffer
          if (!recoveredClip) {
            const origSource = origBuffersByTrackRef.current[track.id] || (
              audioBuffersRef.current[track.id]
                ? { buffer: audioBuffersRef.current[track.id], filePath: track.filePath, sourceTrackId: track.id }
                : null
            );
            if (origSource && origSource.buffer) {
              const candidateIntervals = scanBufferWindowForSpeech(
                origSource.buffer,
                localWinStart,
                Math.min(origSource.buffer.duration, localWinEnd),
                timingSettings.leadInPaddingSec,
                timingSettings.leadOutPaddingSec
              );
              const unusedCandidates = candidateIntervals
                .filter(iv => !isSourceIntervalAlreadyUsed(iv.startSec, iv.endSec))
                .sort((a, b) => Math.abs(a.startSec - sub.startSec) - Math.abs(b.startSec - sub.startSec));

              if (unusedCandidates.length > 0) {
                const bestIv = unusedCandidates[0];
                recoveredClip = {
                  id: `clip_${track.id}_healed_orig_${subIdStr}_${iter}`,
                  trackId: track.id,
                  dubberName,
                  characterName,
                  clipStartSec: Number(bestIv.startSec.toFixed(3)),
                  durationSec: bestIv.durationSec,
                  sourceStartSec: bestIv.startSec,
                  sourceEndSec: bestIv.endSec,
                  rawSourceStartSec: bestIv.startSec,
                  rawSourceEndSec: bestIv.endSec,
                  speechOnsetOffsetSec: detectSpeechOnsetOffsetSec(origSource.buffer, bestIv.startSec, bestIv.endSec),
                  sourceAudioTrackId: origSource.sourceTrackId,
                  sourceAudioPath: origSource.filePath || track.filePath,
                  text: sub.text,
                  matchedSubId: subIdStr,
                  coveredSubIds: [subIdStr],
                  targetSubStartSec: sub.startSec,
                  targetSubEndSec: sub.endSec,
                  volumePercent: 100,
                  isFix: false,
                  isPhysics: false,
                  recoveredFrom: 'original',
                  hasCollision: false,
                  offsetSec: 0,
                  timingIssue: null
                };
                recoveredFromOrigCount++;
                addLog(
                  `🚑 [Аудит Итерация #${iter}] Пропущенная реплика «${sub.text.slice(0, 30)}» (${dubberName}) найдена в ОРИГИНАЛЬНОЙ ДОРОЖКЕ [${formatSeconds(bestIv.startSec)}-${formatSeconds(bestIv.endSec)}] и восстановлена!`,
                  'success'
                );
              }
            }
          }

          if (recoveredClip) {
            lockedClipIds.add(recoveredClip.id);
            trClips.push(recoveredClip);
            trClips.sort((a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0)));
            actionsInPass++;
          }
        }

        // Local micro-overlap cleanup (NEVER domino-pushing clips across the track!)
        trClips.sort((a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0)));
        for (let i = 0; i < trClips.length - 1; i++) {
          const c1 = trClips[i];
          const c2 = trClips[i + 1];
          const c1Start = c1.clipStartSec + (c1.offsetSec || 0);
          const c1End = c1Start + c1.durationSec;
          const c2Start = c2.clipStartSec + (c2.offsetSec || 0);
          const overlap = c1End - c2Start;
          if (overlap > 0 && overlap <= 0.16 && c1.durationSec - overlap >= 0.20) {
            c1.durationSec = Number((c1.durationSec - overlap - 0.01).toFixed(3));
            c1.sourceEndSec = Number((c1.sourceStartSec + c1.durationSec).toFixed(3));
          }
        }

        workingClips[track.id] = trClips;
      }

      if (actionsInPass === 0) {
        break;
      }
    }

    // Final Verification Tally across 100% of subtitles of all dubbers (with Cross-Dubber Voicing Check)
    let totalSubs = 0;
    let voicedSubs = 0;
    let voicedByOtherDubberCount = 0;
    let physicsProtectedCount = 0;
    const unvoicedSubs: MissingSubtitleMarker[] = [];

    for (const track of tracks) {
      const trSubs = trackSubLinesMap[track.id] || [];
      const trClips = workingClips[track.id] || [];
      const dubberName = track.participant || track.dubberName || 'Даббер';
      const characterName = track.character || track.characterName || 'Персонаж';

      physicsProtectedCount += trClips.filter(c => c.isPhysics).length;

      for (let sIdx = 0; sIdx < trSubs.length; sIdx++) {
        totalSubs++;
        const sub = trSubs[sIdx];
        const subIdStr = String(sub.id ?? sIdx);
        const isCoveredOnOwnTrack = trClips.some(c => {
          if (c.matchedSubId === subIdStr || c.coveredSubIds?.includes(subIdStr)) return true;
          const cs = c.clipStartSec + (c.offsetSec || 0);
          const ce = cs + c.durationSec;
          return cs <= sub.endSec + 0.55 && ce >= sub.startSec - 0.55;
        });

        if (isCoveredOnOwnTrack) {
          voicedSubs++;
        } else {
          // Cross-dubber check: if another dubber voiced this subtitle window, it's NOT a missing phrase!
          const otherCoverage = findOtherDubberCoveringSubtitle(track.id, sub);
          if (otherCoverage) {
            voicedSubs++;
            voicedByOtherDubberCount++;
            addLog(
              `🤝 [Проверка дабберов] Реплика «${sub.text.slice(0, 28)}» (${formatSeconds(sub.startSec)}, роль: ${characterName}) отсутствует у «${dubberName}», но озвучена даббером «${otherCoverage.dubberName}» — пропуск снят.`,
              'info'
            );
          } else {
            unvoicedSubs.push({
              id: `missing_${track.id}_${subIdStr}`,
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
    }

    return {
      healedClips: workingClips,
      report: {
        totalSubs,
        voicedSubs,
        voicedByOtherDubberCount,
        recoveredFromFixCount,
        recoveredFromOrigCount,
        realignedCount,
        physicsProtectedCount,
        iterationsRun,
        unvoicedSubs,
        passed: unvoicedSubs.length === 0
      }
    };
  }, [tracks, trackSubLinesMap, timingSettings.leadInPaddingSec, timingSettings.leadOutPaddingSec, bindTrackClipsToSubtitlesMonotonically, origBuffersByTrackRef, fixBuffersByActorRef, audioBuffersRef, addLog]);

  // ---------------------------------------------------------------------------
  // SURGICAL OVERLAP & COLLISION RESOLVER (INTRA-TRACK & INTER-TRACK)
  // ---------------------------------------------------------------------------
  const separateOverlappingClipPair = useCallback((
    earlyClip: AudioClip,
    lateClip: AudioClip,
    earlyTrackClips: AudioClip[],
    lateTrackClips: AudioClip[],
    allClipsMap?: Record<string, AudioClip[]>
  ): boolean => {
    return separateOverlappingClipPairService({
      earlyClip,
      lateClip,
      earlyTrackClips,
      lateTrackClips,
      allClipsMap,
      trackSubLinesMap,
      subtitles,
      addLog
    });
  }, [trackSubLinesMap, subtitles, addLog]);

  return {
    handleSetOverlapMainClip,
    handleActivateClipOverlapMode,
    handleRemoveClipOverlapMode,
    handleToggleClipOverlapRole,
    handleToggleClipPhysics,
    bindTrackClipsToSubtitlesMonotonically,
    runIterativeSelfHealingAudit,
    separateOverlappingClipPair,
  };
}
