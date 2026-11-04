import type React from 'react';
import { toast } from 'sonner';
import { Track, SubtitleLine } from '../../types';
import { getSharedAudioContext } from '../../lib/qa/sharedAudioContext';
import { analyzeAudioBufferForPreview, NormalizationMetrics } from '../../lib/qa/audioNormalizer';
import { globalAudioAICleanupEngine } from '../../services/AudioAICleanupEngine';
import { isPhraseTimingNotRequired } from './timingAudioUtils';
import {
  AudioClip,
  MissingSubtitleMarker,
  TimingIssue,
  VoiceCollisionMarker,
} from './timing.types';
import {
  formatSeconds,
} from './timing.utils';
import { SelfHealingVerificationReport } from './useTimingSelfHealingAndOverlaps';

export interface UseTimingStage2AndClipsParams {
  tracks: Track[];
  audioClips: Record<string, AudioClip[]>;
  trackSubLinesMap: Record<string, SubtitleLine[]>;
  subtitles: SubtitleLine[];
  timingIssues: TimingIssue[];
  audioBuffersRef: React.MutableRefObject<Record<string, AudioBuffer>>;
  setAudioClips: React.Dispatch<React.SetStateAction<Record<string, AudioClip[]>>>;
  setTimingIssues: React.Dispatch<React.SetStateAction<TimingIssue[]>>;
  setCollisions: React.Dispatch<React.SetStateAction<VoiceCollisionMarker[]>>;
  setMissingSubtitles: React.Dispatch<React.SetStateAction<MissingSubtitleMarker[]>>;
  setFinalVerificationReport: React.Dispatch<React.SetStateAction<SelfHealingVerificationReport | null>>;
  setVolumes: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setNormalizationMetrics: React.Dispatch<React.SetStateAction<Record<string, NormalizationMetrics>>>;
  setAiProcessingTrackId: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveAiMenuTrackId: React.Dispatch<React.SetStateAction<string | null>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  bindTrackClipsToSubtitlesMonotonically: (track: Track, rawClips: AudioClip[], trSubs: SubtitleLine[]) => AudioClip[];
  runIterativeSelfHealingAudit: (clipsInput: Record<string, AudioClip[]>) => {
    healedClips: Record<string, AudioClip[]>;
    report: SelfHealingVerificationReport;
  };
  separateOverlappingClipPair: (
    earlyClip: AudioClip,
    lateClip: AudioClip,
    earlyTrackClips: AudioClip[],
    lateTrackClips: AudioClip[],
    allClipsMap?: Record<string, AudioClip[]>
  ) => boolean;
  updateProcess: (title: string, detail: string, progress: number, stepCurrent?: number, stepTotal?: number) => void;
  clearProcess: () => void;
  addLog: (msg: string, level?: 'info' | 'success' | 'warn' | 'error') => void;
}

export function useTimingStage2AndClips({
  tracks,
  audioClips,
  trackSubLinesMap,
  subtitles,
  timingIssues,
  audioBuffersRef,
  setAudioClips,
  setTimingIssues,
  setCollisions,
  setMissingSubtitles,
  setFinalVerificationReport,
  setVolumes,
  setNormalizationMetrics,
  setAiProcessingTrackId,
  setActiveAiMenuTrackId,
  setIsLoading,
  bindTrackClipsToSubtitlesMonotonically,
  runIterativeSelfHealingAudit,
  separateOverlappingClipPair,
  updateProcess,
  clearProcess,
  addLog,
}: UseTimingStage2AndClipsParams) {
  // ---------------------------------------------------------------------------
  // ЭТАП 2: ТОЧЕЧНЫЙ ХИРУРГИЧЕСКИЙ АВТОТАЙМИНГ + ИТЕРАЦИОННЫЙ САМОВОССТАНАВЛИВАЮЩИЙСЯ АУДИТ
  // ---------------------------------------------------------------------------
  const handleApplyTargetedAutoTiming = async (typeFilter: 'all' | 'overlap' | 'desync' | 'orphan' = 'all') => {
    if (tracks.length === 0) return;
    try {
      setIsLoading(true);
      updateProcess('2. Точечный автотайминг', 'Монотонная привязка фраз к субтитрам и защита физики...', 25, 1, 3);
      addLog(`Запуск Этапа 2: хирургический автотайминг (режим: ${typeFilter})...`, 'info');
      await new Promise(r => setTimeout(r, 0));

      const updatedClips: Record<string, AudioClip[]> = {};
      for (const track of tracks) {
        const trSubs = [...(trackSubLinesMap[track.id] || [])].sort((a, b) => a.startSec - b.startSec);
        updatedClips[track.id] = bindTrackClipsToSubtitlesMonotonically(track, audioClips[track.id] || [], trSubs);
      }

      let fixedDesyncCount = 0;
      let fixedOverlapCount = 0;
      let fixedOrphanCount = 0;

      // Helper to resolve genuine tail-to-head overlaps currently on the timeline or in timingIssues
      const resolveAllOverlapsInMap = (clipsMap: Record<string, AudioClip[]>): number => {
        let resolved = 0;
        const findClipEntryById = (id?: string): { clip: AudioClip; trackId: string } | null => {
          if (!id) return null;
          for (const [tId, list] of Object.entries(clipsMap)) {
            const found = list.find(c => c.id === id);
            if (found) return { clip: found, trackId: tId };
          }
          return null;
        };

        // Pass 1: Resolve explicit overlap issues from `timingIssues` (skipping simultaneous two-subtitle scenes)
        for (const issue of timingIssues) {
          if (issue.type !== 'overlap') continue;
          let entryA = findClipEntryById(issue.clipId);
          let entryB = findClipEntryById(issue.overlappingClipId || entryA?.clip.overlappingClipId);

          if (!entryA || !entryB) {
            const nearClips: Array<{ clip: AudioClip; trackId: string }> = [];
            for (const [tId, list] of Object.entries(clipsMap)) {
              for (const c of list) {
                if (c.isPhysics) continue;
                const cs = c.clipStartSec + (c.offsetSec || 0);
                const ce = cs + c.durationSec;
                if (cs <= issue.timeSec + 0.85 && ce >= issue.timeSec - 0.85) {
                  nearClips.push({ clip: c, trackId: tId });
                }
              }
            }
            for (let i = 0; i < nearClips.length; i++) {
              for (let j = i + 1; j < nearClips.length; j++) {
                const a = nearClips[i];
                const b = nearClips[j];
                const as = a.clip.clipStartSec + (a.clip.offsetSec || 0);
                const ae = as + a.clip.durationSec;
                const bs = b.clip.clipStartSec + (b.clip.offsetSec || 0);
                const be = bs + b.clip.durationSec;
                const ov = Math.min(ae, be) - Math.max(as, bs);
                if (ov > 0.015 && ov <= 0.48) {
                  entryA = as <= bs ? a : b;
                  entryB = as <= bs ? b : a;
                  break;
                }
              }
              if (entryA && entryB) break;
            }
          }

          if (entryA && entryB && entryA.clip.id !== entryB.clip.id) {
            const aStart = entryA.clip.clipStartSec + (entryA.clip.offsetSec || 0);
            const bStart = entryB.clip.clipStartSec + (entryB.clip.offsetSec || 0);
            const early = aStart <= bStart ? entryA : entryB;
            const late = aStart <= bStart ? entryB : entryA;
            if (separateOverlappingClipPair(early.clip, late.clip, clipsMap[early.trackId] || [], clipsMap[late.trackId] || [], clipsMap)) {
              resolved++;
            }
          }
        }

        // Pass 2: Resolve any remaining intra-track overlaps on every track
        for (const trackId of Object.keys(clipsMap)) {
          const clips = clipsMap[trackId] || [];
          clips.sort((a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0)));
          for (let i = 0; i < clips.length - 1; i++) {
            const c1 = clips[i];
            const c2 = clips[i + 1];
            const c1End = (c1.clipStartSec + (c1.offsetSec || 0)) + c1.durationSec;
            const c2Start = c2.clipStartSec + (c2.offsetSec || 0);
            const ov = c1End - c2Start;
            if (ov > 0.015 && ov <= 0.55) {
              if (separateOverlappingClipPair(c1, c2, clips, clips, clipsMap)) {
                resolved++;
              }
            }
          }
        }

        // Pass 3: Resolve any remaining flagged inter-track tail-to-head collisions (only if <= 0.48s and not simultaneous subtitles)
        const allDialogue: Array<{ clip: AudioClip; trackId: string }> = [];
        for (const [tId, list] of Object.entries(clipsMap)) {
          for (const c of list) {
            if (!c.isPhysics && !c.isUnisonPhrase && !c.isIntentionalOverlap) {
              allDialogue.push({ clip: c, trackId: tId });
            }
          }
        }
        allDialogue.sort(
          (a, b) => (a.clip.clipStartSec + (a.clip.offsetSec || 0)) - (b.clip.clipStartSec + (b.clip.offsetSec || 0))
        );
        for (let i = 0; i < allDialogue.length; i++) {
          for (let j = i + 1; j < allDialogue.length; j++) {
            const a = allDialogue[i];
            const b = allDialogue[j];
            if (a.trackId === b.trackId) continue;
            const aStart = a.clip.clipStartSec + (a.clip.offsetSec || 0);
            const aEnd = aStart + a.clip.durationSec;
            const bStart = b.clip.clipStartSec + (b.clip.offsetSec || 0);
            if (bStart >= aEnd - 0.015) break;

            const ov = aEnd - bStart;
            if (ov <= 0.48) {
              if (separateOverlappingClipPair(a.clip, b.clip, clipsMap[a.trackId] || [], clipsMap[b.trackId] || [], clipsMap)) {
                resolved++;
              }
            } else {
              // Clear false collision badge on long simultaneous overlaps (> 0.48s)
              a.clip.hasCollision = false;
              b.clip.hasCollision = false;
              if (a.clip.timingIssue === 'overlap') a.clip.timingIssue = null;
              if (b.clip.timingIssue === 'overlap') b.clip.timingIssue = null;
            }
          }
        }

        return resolved;
      };

      // Mode "overlap": ONLY separate overlaps, never running desync shifts or audit!
      if (typeFilter === 'overlap') {
        updateProcess('2. Точечный автотайминг', 'Хирургическое разведение наездов...', 75, 2, 2);
        fixedOverlapCount = resolveAllOverlapsInMap(updatedClips);
        setAudioClips(updatedClips);
        setTimingIssues(prev => prev.filter(i => i.type !== 'overlap'));
        setCollisions([]);
        toast.success(`Раздвинуто наездов: ${fixedOverlapCount}`);
        return;
      }

      // 1 & 2. Хирургическое выравнивание только реально рассинхроненных фраз
      // (НЕ трогаем фразы, которые уже стоят внутри своего субтитра [sub.startSec - 0.35s .. sub.startSec + 0.55s]!)
      for (const trackId of Object.keys(updatedClips)) {
        const clips = [...(updatedClips[trackId] || [])].sort(
          (a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0))
        );

        for (let idx = 0; idx < clips.length; idx++) {
          const clip = clips[idx];
          if (clip.isPhysics || clip.isUnisonPhrase || clip.isSplitContinuation || clip.overlapResolvedLock || clip.overlapRole || clip.timingNotRequired) continue;

          const curStart = clip.clipStartSec + (clip.offsetSec || 0);
          const trSubs = trackSubLinesMap[trackId] || [];
          const matchedSub = clip.matchedSubId
            ? (trSubs.find(s => String(s.id) === String(clip.matchedSubId)) || subtitles.find(s => String(s.id) === String(clip.matchedSubId)))
            : undefined;
          const subStart = matchedSub ? matchedSub.startSec : clip.targetSubStartSec;
          const subEnd = matchedSub ? matchedSub.endSec : (clip.targetSubEndSec ?? (typeof subStart === 'number' ? subStart + clip.durationSec : undefined));

          // User Rule: If phrase is inside sub or tail <= 30% of sub duration, timing is NOT required!
          if (typeof subStart === 'number' && typeof subEnd === 'number') {
            const exemptCheck = isPhraseTimingNotRequired(curStart, clip.durationSec, subStart, subEnd);
            if (exemptCheck.notRequired) {
              clips[idx] = {
                ...clip,
                timingNotRequired: true,
                timingNotRequiredReason: exemptCheck.reason,
                timingIssue: null,
                timingIssueText: undefined
              };
              continue;
            }
          }

          const shouldFixDesync = (typeFilter === 'all' || typeFilter === 'desync');
          const shouldFixOrphan = clip.timingIssue === 'orphan' && (typeFilter === 'all' || typeFilter === 'orphan');

          if ((shouldFixDesync || shouldFixOrphan) && typeof clip.targetSubStartSec === 'number') {
            const origStart = clip.rawSourceStartSec ?? clip.sourceStartSec ?? curStart;
            const signedDiff = curStart - clip.targetSubStartSec;
            const rawDiff = Math.abs(signedDiff);

            // If the phrase is already inside its subtitle window (-0.35s .. +0.55s) and not explicitly flagged as desync/orphan, DO NOT TOUCH IT!
            const isAlreadyInSubtitleWindow = signedDiff >= -0.35 && signedDiff <= 0.55;
            if (isAlreadyInSubtitleWindow && clip.timingIssue !== 'desync' && clip.timingIssue !== 'orphan') {
              clips[idx] = {
                ...clip,
                timingIssue: null,
                timingIssueText: undefined
              };
              continue;
            }

            const prevIntraEnd = idx > 0
              ? (clips[idx - 1].clipStartSec + (clips[idx - 1].offsetSec || 0) + clips[idx - 1].durationSec + 0.03)
              : 0;
            // Respect preceding speaker's phrase end on other tracks when pulling earlier
            let prevInterEnd = 0;
            if (clip.targetSubStartSec < curStart) {
              for (const [otherTrId, otherClips] of Object.entries(updatedClips)) {
                if (otherTrId === trackId) continue;
                for (const oc of otherClips) {
                  if (oc.isPhysics) continue;
                  const os = oc.clipStartSec + (oc.offsetSec || 0);
                  const oe = os + oc.durationSec;
                  if (os < curStart - 0.10 && oe > clip.targetSubStartSec - 0.04 && oe <= curStart + 0.65) {
                    prevInterEnd = Math.max(prevInterEnd, oe + 0.04);
                  }
                }
              }
            }
            const prevEnd = Math.max(prevIntraEnd, prevInterEnd);
            const nextStart = idx + 1 < clips.length
              ? (clips[idx + 1].clipStartSec + (clips[idx + 1].offsetSec || 0) - 0.03)
              : Infinity;

            // Cap maximum automatic shift to 0.35s from original recorded position
            let safeStart = Math.max(origStart - 0.35, Math.min(origStart + 0.35, clip.targetSubStartSec));
            safeStart = Math.max(prevEnd, Math.min(safeStart, Math.max(prevEnd, nextStart - clip.durationSec)));
            safeStart = Number(Math.max(0, safeStart).toFixed(3));

            if (Math.abs(safeStart - curStart) >= 0.06 && Math.abs(safeStart - clip.targetSubStartSec) < rawDiff - 0.04) {
              if (clip.timingIssue === 'orphan') fixedOrphanCount++;
              else fixedDesyncCount++;
              addLog(`🎯 Хирургически пододвинута фраза «${clip.text.slice(0, 25)}» с ${formatSeconds(curStart)} ➔ ${formatSeconds(safeStart)}`, 'info');
              clips[idx] = {
                ...clip,
                clipStartSec: safeStart,
                offsetSec: 0,
                timingIssue: null,
                timingIssueText: undefined,
                timeDiffSec: 0
              };
            } else {
              clips[idx] = {
                ...clip,
                timingIssue: null,
                timingIssueText: undefined
              };
            }
          }
        }
        updatedClips[trackId] = clips;
      }

      // 3. ИТЕРАЦИОННАЯ ФИНАЛЬНАЯ ПРОВЕРКА И САМОВОССТАНОВЛЕНИЕ ВСЕХ САБОВ ВСЕХ ДАББЕРОВ
      updateProcess(
        '3. Финальный аудит и самовосстановление',
        'Проверка 100% субтитров всех дабберов и поиск пропавших реплик (Фиксы ➔ Оригинал)...',
        72,
        2,
        3
      );
      await new Promise(r => setTimeout(r, 0));

      const { healedClips, report } = runIterativeSelfHealingAudit(updatedClips);

      // 4. Хирургическое разведение наездов (ПОСЛЕ аудита, с защитой одновременных сабов и запретом каскадных сдвигов!)
      if (typeFilter === 'all') {
        updateProcess('3. Разведение наездов', 'Финальное хирургическое разведение локальных и междорожечных наездов...', 92, 3, 3);
        await new Promise(r => setTimeout(r, 0));
        fixedOverlapCount += resolveAllOverlapsInMap(healedClips);
      }

      setAudioClips(healedClips);
      setFinalVerificationReport(report);
      setMissingSubtitles(report.unvoicedSubs);

      const remainingUnvoicedSubIds = new Set(report.unvoicedSubs.map(u => `${u.trackId}_${u.subId}`));
      const remainingIssues = timingIssues.filter(issue => {
        if (issue.type === 'desync' && (typeFilter === 'all' || typeFilter === 'desync')) return false;
        if (issue.type === 'overlap' && typeFilter === 'all') return false;
        if (issue.type === 'orphan' && (typeFilter === 'all' || typeFilter === 'orphan')) {
          const targetClip = Object.values(healedClips).flat().find(c => c.id === issue.clipId);
          return targetClip?.timingIssue === 'orphan';
        }
        if (issue.type === 'missing') {
          const matchUnvoiced = report.unvoicedSubs.some(
            u => u.trackId === issue.trackId && Math.abs(u.startSec - issue.timeSec) < 0.25
          );
          return matchUnvoiced && remainingUnvoicedSubIds.size > 0;
        }
        return true;
      });
      setTimingIssues(remainingIssues);
      setCollisions([]);

      const totalFixed = fixedDesyncCount + fixedOverlapCount + fixedOrphanCount + report.recoveredFromFixCount + report.recoveredFromOrigCount + report.realignedCount;

      if (report.passed) {
        addLog(
          `✅ ФИНАЛЬНАЯ ПРОВЕРКА ПРОЙДЕНА (итераций: ${report.iterationsRun}): 100% субтитров всех дабберов (${report.voicedSubs}/${report.totalSubs}${report.voicedByOtherDubberCount ? `, из них озвучено другими дабберами: ${report.voicedByOtherDubberCount}` : ''}) озвучены и стоят на своих местах! Раздвинуто наездов: ${fixedOverlapCount}, восстановлено из фиксов: ${report.recoveredFromFixCount}, из оригинала: ${report.recoveredFromOrigCount}, довыровнено: ${report.realignedCount}.`,
          'success'
        );
        toast.success(
          `Финальная проверка пройдена! Все ${report.voicedSubs}/${report.totalSubs} сабов на местах (наездов раздвинуто: ${fixedOverlapCount}, исправлено: ${totalFixed}).`
        );
      } else {
        addLog(
          `⚠️ Финальный аудит завершён за ${report.iterationsRun} итераций: озвучено ${report.voicedSubs}/${report.totalSubs} сабов${report.voicedByOtherDubberCount ? ` (в т.ч. другими дабберами: ${report.voicedByOtherDubberCount})` : ''}, раздвинуто наездов: ${fixedOverlapCount}. Не найдено звука для ${report.unvoicedSubs.length} сабов.`,
          'warn'
        );
        toast.warning(
          `Автотайминг завершён! Озвучено ${report.voicedSubs}/${report.totalSubs} сабов, раздвинуто наездов: ${fixedOverlapCount}. Пропусков в исходниках: ${report.unvoicedSubs.length}.`,
          { duration: 6000 }
        );
      }
    } catch (err: any) {
      addLog(`❌ Ошибка этапа 2 (Точечный автотайминг): ${err.message}`, 'error');
      toast.error(`Ошибка применения автотайминга: ${err.message}`);
    } finally {
      setIsLoading(false);
      clearProcess();
    }
  };

  // Quick surgical fixer for a single desynced clip or orphan clip
  const handleFixSingleClip = (trackId: string, clipId: string) => {
    setAudioClips(prev => {
      const trClips = prev[trackId] || [];
      const updated = trClips.map(c => {
        if (c.id === clipId && typeof c.targetSubStartSec === 'number') {
          addLog(`🎯 Фраза «${c.text.slice(0, 25)}» точечно пододвинута под субтитр на ${formatSeconds(c.targetSubStartSec)}`, 'success');
          return {
            ...c,
            clipStartSec: c.targetSubStartSec,
            offsetSec: 0,
            timingIssue: null,
            timingIssueText: undefined,
            timeDiffSec: 0
          };
        }
        return c;
      });
      return { ...prev, [trackId]: updated };
    });
    setTimingIssues(prev => prev.filter(i => i.clipId !== clipId));
    toast.success('Фраза точечно пододвинута к субтитру!');
  };

  // Quick surgical fixer for an overlap collision (intra-track or inter-track, by clipId or timeSec)
  const handleResolveSingleOverlap = (trackId: string, clipId?: string, issueTimeSec?: number, explicitOverlappingClipId?: string) => {
    let wasResolved = false;
    setAudioClips(prev => {
      const updated: Record<string, AudioClip[]> = {};
      for (const [tId, list] of Object.entries(prev)) {
        updated[tId] = list.map(c => ({ ...c }));
      }

      const findById = (id?: string): { clip: AudioClip; trackId: string } | null => {
        if (!id) return null;
        for (const [tId, list] of Object.entries(updated)) {
          const found = list.find(c => c.id === id);
          if (found) return { clip: found, trackId: tId };
        }
        return null;
      };

      let entryA = findById(clipId);
      let entryB = findById(explicitOverlappingClipId || entryA?.clip.overlappingClipId);

      // If entryA exists but entryB is not linked by ID, search for any clip overlapping entryA (same track or other tracks)
      if (entryA && !entryB) {
        const aStart = entryA.clip.clipStartSec + (entryA.clip.offsetSec || 0);
        const aEnd = aStart + entryA.clip.durationSec;
        for (const [tId, list] of Object.entries(updated)) {
          for (const c of list) {
            if (c.id === entryA.clip.id || c.isPhysics) continue;
            const cs = c.clipStartSec + (c.offsetSec || 0);
            const ce = cs + c.durationSec;
            const ov = Math.min(aEnd, ce) - Math.max(aStart, cs);
            if (ov > 0.015 && ov <= 0.48) {
              entryB = { clip: c, trackId: tId };
              break;
            }
          }
          if (entryB) break;
        }
      }

      // Fallback: search by issueTimeSec across all tracks if clip IDs were from QA passport before slicing
      if ((!entryA || !entryB) && typeof issueTimeSec === 'number') {
        const near: Array<{ clip: AudioClip; trackId: string }> = [];
        for (const [tId, list] of Object.entries(updated)) {
          for (const c of list) {
            if (c.isPhysics) continue;
            const cs = c.clipStartSec + (c.offsetSec || 0);
            const ce = cs + c.durationSec;
            if (cs <= issueTimeSec + 0.85 && ce >= issueTimeSec - 0.85) {
              near.push({ clip: c, trackId: tId });
            }
          }
        }
        for (let i = 0; i < near.length; i++) {
          for (let j = i + 1; j < near.length; j++) {
            const a = near[i];
            const b = near[j];
            const as = a.clip.clipStartSec + (a.clip.offsetSec || 0);
            const ae = as + a.clip.durationSec;
            const bs = b.clip.clipStartSec + (b.clip.offsetSec || 0);
            const be = bs + b.clip.durationSec;
            const ov = Math.min(ae, be) - Math.max(as, bs);
            if (ov > 0.015 && ov <= 0.48) {
              entryA = as <= bs ? a : b;
              entryB = as <= bs ? b : a;
              break;
            }
          }
          if (entryA && entryB) break;
        }
      }

      if (entryA && entryB && entryA.clip.id !== entryB.clip.id) {
        const aStart = entryA.clip.clipStartSec + (entryA.clip.offsetSec || 0);
        const bStart = entryB.clip.clipStartSec + (entryB.clip.offsetSec || 0);
        const early = aStart <= bStart ? entryA : entryB;
        const late = aStart <= bStart ? entryB : entryA;
        wasResolved = separateOverlappingClipPair(
          early.clip,
          late.clip,
          updated[early.trackId] || [],
          updated[late.trackId] || [],
          updated
        );
      }

      return updated;
    });

    setTimingIssues(prev =>
      prev.filter(i => {
        if (clipId && (i.clipId === clipId || i.overlappingClipId === clipId)) return false;
        if (typeof issueTimeSec === 'number' && i.type === 'overlap' && Math.abs(i.timeSec - issueTimeSec) <= 0.35) return false;
        return true;
      })
    );
    if (wasResolved) {
      toast.success('Наезд точечно раздвинут!');
    } else {
      toast.info('Фразы на этом участке уже разведены.');
    }
  };

  // Quick clipboard helper for missing phrases
  const handleCopyMissingTimecode = (text: string, startSec: number, endSec: number) => {
    const formatted = `[${formatSeconds(startSec)} - ${formatSeconds(endSec)}] ${text}`;
    navigator.clipboard?.writeText(formatted);
    toast.success(`Таймкод скопирован: ${formatted}`);
  };

  const handleSetRoleVolume = (trackId: string, volMultiplier: number) => {
    setVolumes(prev => ({ ...prev, [trackId]: volMultiplier }));
    const volPct = Math.round(volMultiplier * 100);
    setAudioClips(prev => {
      const trClips = prev[trackId] || [];
      const updated = trClips.map(b => ({ ...b, volumePercent: volPct }));
      return { ...prev, [trackId]: updated };
    });
    toast.info(`Громкость роли установлена: ${volPct}%`);
  };

  const handleSetClipVolume = (trackId: string, clipId: string, volPct: number) => {
    setAudioClips(prev => {
      const trClips = prev[trackId] || [];
      const updated = trClips.map(b => b.id === clipId ? { ...b, volumePercent: volPct } : b);
      return { ...prev, [trackId]: updated };
    });
  };

  const handleSplitClip = (trackId: string, clipId: string) => {
    setAudioClips(prev => {
      const trClips = prev[trackId] || [];
      const updated: AudioClip[] = [];
      for (const b of trClips) {
        if (b.id === clipId) {
          const half = Number((b.durationSec / 2).toFixed(2));
          updated.push({
            ...b,
            id: `${b.id}_1`,
            durationSec: half,
            sourceEndSec: b.sourceStartSec + half,
            text: `${b.text} (1/2)`
          });
          updated.push({
            ...b,
            id: `${b.id}_2`,
            clipStartSec: b.clipStartSec + half,
            durationSec: half,
            sourceStartSec: b.sourceStartSec + half,
            text: `${b.text} (2/2)`
          });
        } else {
          updated.push(b);
        }
      }
      return { ...prev, [trackId]: updated };
    });
    toast.success('Клип разрезан на две части');
  };

  const handleNudgeClip = (trackId: string, clipId: string, deltaSec: number) => {
    setAudioClips(prev => {
      const trClips = prev[trackId] || [];
      const updated = trClips.map(b => {
        if (b.id === clipId) {
          const newStart = Math.max(0, Number((b.clipStartSec + deltaSec).toFixed(2)));
          return { ...b, clipStartSec: newStart };
        }
        return b;
      });
      return { ...prev, [trackId]: updated };
    });
  };

  const handleAICleanupTrack = async (
    trackId: string,
    actionType: 'deplosive' | 'thickener' | 'leveler' | 'dereverb' | 'headroom' | 'voicefixer' | 'denoise'
  ) => {
    const audioBuf = audioBuffersRef.current[trackId];
    if (!audioBuf) {
      toast.error('Аудиодорожка еще не декодирована');
      return;
    }
    const tr = tracks.find(t => t.id === trackId);
    const dubberName = tr?.participant || tr?.dubberName || 'Даббер';

    try {
      setAiProcessingTrackId(trackId);
      setActiveAiMenuTrackId(null);
      const sharedAudioCtx = getSharedAudioContext();
      if (!sharedAudioCtx) return;

      const numChannels = audioBuf.numberOfChannels;
      const sampleRate = audioBuf.sampleRate;
      const length = audioBuf.length;

      const newAudioBuf = sharedAudioCtx.createBuffer(numChannels, length, sampleRate);

      for (let ch = 0; ch < numChannels; ch++) {
        updateProcess(
          `AI обработка дорожки «${dubberName}»`,
          `Фильтр «${actionType}» (канал ${ch + 1}/${numChannels})...`,
          Math.round(((ch + 0.5) / Math.max(1, numChannels)) * 90),
          ch + 1,
          numChannels
        );
        const inputData = new Float32Array(audioBuf.getChannelData(ch));
        let processedData: Float32Array;

        switch (actionType) {
          case 'deplosive':
            toast.info(`[AI De-Plosive] Подавление задувов и хлопков «П»/«Б» для «${dubberName}»...`);
            processedData = await globalAudioAICleanupEngine.processDePlosive(inputData, { sampleRate });
            break;
          case 'thickener':
            toast.info(`[AI Vocal Thickener] Добавление плотности и ленточной сатурации для «${dubberName}»...`);
            processedData = await globalAudioAICleanupEngine.processVocalThickener(inputData, { sampleRate });
            break;
          case 'leveler':
            toast.info(`[AI Speech Leveler] Выравнивание скачков громкости речи для «${dubberName}»...`);
            processedData = await globalAudioAICleanupEngine.processSpeechLeveler(inputData, { sampleRate });
            break;
          case 'dereverb':
            toast.info(`[AI Spectral De-Reverb] Подавление комнатного эха для «${dubberName}»...`);
            processedData = await globalAudioAICleanupEngine.processSpectralDeReverb(inputData, { sampleRate });
            break;
          case 'headroom':
            toast.info(`[AI Headroom Recovery] Разгон тихих фраз с True-Peak лимитером для «${dubberName}»...`);
            processedData = await globalAudioAICleanupEngine.processHeadroomRecovery(inputData, { sampleRate });
            break;
          case 'voicefixer':
            toast.info(`[AI VoiceFixer] Восстановление обертонов и верхов для «${dubberName}»...`);
            processedData = await globalAudioAICleanupEngine.processVoiceFixer(inputData, { sampleRate });
            break;
          case 'denoise':
            toast.info(`[AI Denoise] Шумоподавление для «${dubberName}»...`);
            processedData = await globalAudioAICleanupEngine.processDenoise(inputData, { modelId: 'deepfilternet3', intensityPercent: 75, sampleRate });
            break;
          default:
            processedData = inputData;
        }

        newAudioBuf.copyToChannel(new Float32Array(processedData), ch);
      }

      audioBuffersRef.current[trackId] = newAudioBuf;
      const updatedNorm = analyzeAudioBufferForPreview(newAudioBuf, `${trackId}_${Date.now()}`);
      setNormalizationMetrics(prev => ({ ...prev, [trackId]: updatedNorm }));
      setAudioClips(prev => ({ ...prev }));
      toast.success(`✓ [AI Cleanup] Дорожка «${dubberName}» успешно обработана!`);
      addLog(`✨ [AI Cleanup] Дорожка «${dubberName}» успешно обработана фильтром ${actionType}`, 'success');
    } catch (e: any) {
      toast.error(`Ошибка обработки: ${e.message || String(e)}`);
      addLog(`❌ [AI Cleanup] Ошибка: ${e.message}`, 'error');
    } finally {
      setAiProcessingTrackId(null);
      clearProcess();
    }
  };

  return {
    handleApplyTargetedAutoTiming,
    handleFixSingleClip,
    handleResolveSingleOverlap,
    handleCopyMissingTimecode,
    handleSetRoleVolume,
    handleSetClipVolume,
    handleSplitClip,
    handleNudgeClip,
    handleAICleanupTrack,
  };
}
