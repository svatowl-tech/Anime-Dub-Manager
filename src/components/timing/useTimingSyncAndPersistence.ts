import { useEffect, useRef } from 'react';
import type React from 'react';
import { toast } from 'sonner';
import { Episode, Track, SubtitleLine } from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';
import { loadTimingProjectForEpisode, applyTimingPassportToClips, TimingProjectData } from '../../lib/qa/timingSyncService';
import { TimingSettings } from '../TimingSettingsModal';
import {
  AudioClip,
  IntentionalOverlapMoment,
  MissingSubtitleMarker,
  NoiseCalibration,
  OriginalStemsState,
  TimingIssue,
  VoiceCollisionMarker,
} from './timing.types';
import {
  formatSeconds,
  isFixTrack,
} from './timing.utils';
import {
  bindTrackClipsToSubtitlesMonotonicallyService as bindTrackClipsToSubtitlesMonotonically,
} from './timing.waveform';

export interface UseTimingSyncAndPersistenceParams {
  currentEpisode: Episode | null;
  tracks: Track[];
  audioClips: Record<string, AudioClip[]>;
  trackSubLinesMap: Record<string, SubtitleLine[]>;
  subtitles: SubtitleLine[];
  isSilenceRemoved: boolean;
  isFixesStitched: boolean;
  isTimingAnalyzed: boolean;
  collisions: VoiceCollisionMarker[];
  intentionalOverlaps: IntentionalOverlapMoment[];
  timingIssues: TimingIssue[];
  missingSubtitles: MissingSubtitleMarker[];
  qaPassportLoaded: {
    loaded: boolean;
    summary: TimingProjectData['summary'];
    savedAt: string;
  } | null;
  finalVerificationReport: {
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
  } | null;
  calibrationsByTrack: Record<string, NoiseCalibration>;
  volumes: Record<string, number>;
  mutedTracks: Set<string>;
  originalVolume: number;
  isOriginalMuted: boolean;
  originalWaveScale: number;
  isOriginalWaveNormalized: boolean;
  originalTrackHeight: number;
  zoomLevel: number;
  trackHeightMode: 'standard' | 'compact' | 'fit';
  timingSettings: TimingSettings;
  originalStems: OriginalStemsState;
  isLoading: boolean;
  audioBuffersRef: React.MutableRefObject<Record<string, AudioBuffer>>;
  savedPassportRef: React.MutableRefObject<TimingProjectData | null>;
  allCatalogTracksRef: React.MutableRefObject<Track[]>;
  isStateRestoredRef: React.MutableRefObject<boolean>;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  currentTimeRef: React.MutableRefObject<number>;
  setAudioClips: React.Dispatch<React.SetStateAction<Record<string, AudioClip[]>>>;
  setCollisions: React.Dispatch<React.SetStateAction<VoiceCollisionMarker[]>>;
  setIntentionalOverlaps: React.Dispatch<React.SetStateAction<IntentionalOverlapMoment[]>>;
  setTimingIssues: React.Dispatch<React.SetStateAction<TimingIssue[]>>;
  setMissingSubtitles: React.Dispatch<React.SetStateAction<MissingSubtitleMarker[]>>;
  setIsTimingAnalyzed: React.Dispatch<React.SetStateAction<boolean>>;
  setIsIssuesDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setQaPassportLoaded: React.Dispatch<React.SetStateAction<{
    loaded: boolean;
    summary: TimingProjectData['summary'];
    savedAt: string;
  } | null>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setIsImporting: React.Dispatch<React.SetStateAction<boolean>>;
  setIsResetConfirmOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>;
  setSavedTimingStateInfo: React.Dispatch<React.SetStateAction<{
    savedAt: string;
    filePath?: string;
  } | null>>;
  setIsSilenceRemoved: React.Dispatch<React.SetStateAction<boolean>>;
  setIsFixesStitched: React.Dispatch<React.SetStateAction<boolean>>;
  setFinalVerificationReport: React.Dispatch<React.SetStateAction<{
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
  } | null>>;
  setCalibrationsByTrack: React.Dispatch<React.SetStateAction<Record<string, NoiseCalibration>>>;
  setSelectedClipId: React.Dispatch<React.SetStateAction<string | null>>;
  stopAllScheduledClips: () => void;
  loadEpisodeData: (forceCleanReload?: boolean, skipSavedTimingState?: boolean) => Promise<void>;
  updateProcess: (title: string, detail: string, progress: number, stepCurrent?: number, stepTotal?: number) => void;
  clearProcess: () => void;
  addLog: (msg: string, level?: 'info' | 'success' | 'warn' | 'error') => void;
}

export function useTimingSyncAndPersistence({
  currentEpisode,
  tracks,
  audioClips,
  trackSubLinesMap,
  subtitles,
  isSilenceRemoved,
  isFixesStitched,
  isTimingAnalyzed,
  collisions,
  intentionalOverlaps,
  timingIssues,
  missingSubtitles,
  qaPassportLoaded,
  finalVerificationReport,
  calibrationsByTrack,
  volumes,
  mutedTracks,
  originalVolume,
  isOriginalMuted,
  originalWaveScale,
  isOriginalWaveNormalized,
  originalTrackHeight,
  zoomLevel,
  trackHeightMode,
  timingSettings,
  originalStems,
  isLoading,
  audioBuffersRef,
  savedPassportRef,
  allCatalogTracksRef,
  isStateRestoredRef,
  videoRef,
  currentTimeRef,
  setAudioClips,
  setCollisions,
  setIntentionalOverlaps,
  setTimingIssues,
  setMissingSubtitles,
  setIsTimingAnalyzed,
  setIsIssuesDrawerOpen,
  setQaPassportLoaded,
  setIsLoading,
  setIsImporting,
  setIsResetConfirmOpen,
  setIsPlaying,
  setCurrentTime,
  setSavedTimingStateInfo,
  setIsSilenceRemoved,
  setIsFixesStitched,
  setFinalVerificationReport,
  setCalibrationsByTrack,
  setSelectedClipId,
  stopAllScheduledClips,
  loadEpisodeData,
  updateProcess,
  clearProcess,
  addLog,
}: UseTimingSyncAndPersistenceParams) {
  const handleSyncFromQA = async () => {
    if (!currentEpisode) return;
    try {
      setIsLoading(true);
      updateProcess('Синхронизация с QA', 'Загрузка паспорта QA проверки...', 40, 1, 2);
      const savedProject = await loadTimingProjectForEpisode(currentEpisode, tracks);
      updateProcess('Синхронизация с QA', 'Применение меток замечаний и сверка с текущим таймлайном...', 85, 2, 2);
      if (savedProject && (
        (savedProject.collisions && savedProject.collisions.length > 0) ||
        (savedProject.timingIssues && savedProject.timingIssues.length > 0) ||
        (savedProject.missingSubtitles && savedProject.missingSubtitles.length > 0)
      )) {
        savedPassportRef.current = savedProject;

        const markedClips = applyTimingPassportToClips(audioClips, savedProject);
        const allTrackIds = Object.keys(markedClips);
        const isSliced = allTrackIds.some(tId => {
          const list = markedClips[tId] || [];
          return list.length > 1 || (list.length === 1 && !String(list[0].id).endsWith('_full') && list[0].durationSec < 90);
        });

        // Ensure sliced clips have monotonic subtitle bindings so simultaneous subtitles are accurately recognized
        if (isSliced) {
          for (const tr of tracks) {
            if (isFixTrack(tr)) continue;
            const list = markedClips[tr.id] || [];
            if (list.length > 0 && list.some(c => !c.matchedSubId && !c.isPhysics && c.durationSec < 90)) {
              const trSubs = [...(trackSubLinesMap[tr.id] || [])].sort((a, b) => a.startSec - b.startSec);
              markedClips[tr.id] = bindTrackClipsToSubtitlesMonotonically(tr, list, trSubs, audioBuffersRef.current);
            }
          }
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

        const isSimultaneousOrContainedPair = (early: AudioClip, late: AudioClip): boolean => {
          const earlyStart = early.clipStartSec + (early.offsetSec || 0);
          const earlyEnd = earlyStart + early.durationSec;
          const lateStart = late.clipStartSec + (late.offsetSec || 0);
          const lateEnd = lateStart + late.durationSec;
          const ov = earlyEnd - lateStart;
          const minDur = Math.min(early.durationSec, late.durationSec);

          if (early.trackId !== late.trackId) {
            if (early.isIntentionalOverlap || late.isIntentionalOverlap || early.isUnisonPhrase || late.isUnisonPhrase) {
              return true;
            }
            // Contained clip (e.g., short phrase inside a 7-9s yell/reaction) or simultaneous start or large overlap (> 0.48s)
            if (lateStart - earlyStart <= 0.10 || lateEnd <= earlyEnd + 0.18 || ov > 0.48 || ov > minDur * 0.42) {
              return true;
            }
            const subEarly = findBestSubForClip(early);
            const subLate = findBestSubForClip(late);
            if (subEarly && subLate) {
              if (subEarly.id !== undefined && subLate.id !== undefined && String(subEarly.id) === String(subLate.id)) {
                return true;
              }
              // If the two subtitles in .ass overlap at all (even by 0ms touch when speaking together)
              const subOv = Math.min(subEarly.endSec, subLate.endSec) - Math.max(subEarly.startSec, subLate.startSec);
              if (subOv > -0.02) return true;
              // If the second subtitle is scheduled while the first clip still has > 0.45s left
              if (earlyEnd - subLate.startSec > 0.45) return true;
            }
            // Check global subtitles: if two distinct .ass subtitles overlap in this window, two characters are meant to speak simultaneously
            const activeGlobalSubs = subtitles.filter(
              s => s.endSec >= lateStart - 0.05 && s.startSec <= earlyEnd + 0.05
            );
            for (let a = 0; a < activeGlobalSubs.length; a++) {
              for (let b = a + 1; b < activeGlobalSubs.length; b++) {
                const gOv = Math.min(activeGlobalSubs[a].endSec, activeGlobalSubs[b].endSec) -
                  Math.max(activeGlobalSubs[a].startSec, activeGlobalSubs[b].startSec);
                if (gOv >= 0.05) return true;
              }
            }
          }
          return false;
        };

        // Cross-link QA issues to actual sliced clips on the timeline and filter out already-resolved items
        const enrichedIssues: TimingIssue[] = [];
        const activeCollisions: VoiceCollisionMarker[] = [];
        const seenOverlapPairs = new Set<string>();

        for (const rawIssue of (savedProject.timingIssues || [])) {
          if (rawIssue.type === 'overlap') {
            if (!isSliced) {
              enrichedIssues.push({ ...rawIssue });
              continue;
            }
            // Find the two clips that overlap near rawIssue.timeSec
            const issStart = rawIssue.timeSec ?? 0;
            const issEnd = issStart + (rawIssue.durationSec || 1.2);
            let foundEarly: AudioClip | null = null;
            let foundLate: AudioClip | null = null;

            for (let i = 0; i < allTrackIds.length; i++) {
              for (const c1 of (markedClips[allTrackIds[i]] || [])) {
                if (c1.isPhysics || c1.durationSec >= 90) continue;
                const s1 = c1.clipStartSec + (c1.offsetSec || 0);
                const e1 = s1 + c1.durationSec;
                if (e1 < issStart - 0.8 || s1 > issEnd + 0.8) continue;

                for (let j = i; j < allTrackIds.length; j++) {
                  for (const c2 of (markedClips[allTrackIds[j]] || [])) {
                    if (c1.id === c2.id || c2.isPhysics || c2.durationSec >= 90) continue;
                    const s2 = c2.clipStartSec + (c2.offsetSec || 0);
                    const e2 = s2 + c2.durationSec;
                    const ov = Math.min(e1, e2) - Math.max(s1, s2);
                    if (ov > 0.015) {
                      const [early, late] = s1 <= s2 ? [c1, c2] : [c2, c1];
                      if (isSimultaneousOrContainedPair(early, late)) {
                        early.hasCollision = false;
                        late.hasCollision = false;
                        if (early.timingIssue === 'overlap') early.timingIssue = null;
                        if (late.timingIssue === 'overlap') late.timingIssue = null;
                        continue;
                      }
                      foundEarly = early;
                      foundLate = late;
                      break;
                    }
                  }
                  if (foundEarly && foundLate) break;
                }
                if (foundEarly && foundLate) break;
              }
              if (foundEarly && foundLate) break;
            }

            if (foundEarly && foundLate) {
              const pairKey = [foundEarly.id, foundLate.id].sort().join('__');
              if (!seenOverlapPairs.has(pairKey)) {
                seenOverlapPairs.add(pairKey);
                const earlyEnd = foundEarly.clipStartSec + (foundEarly.offsetSec || 0) + foundEarly.durationSec;
                const lateStart = foundLate.clipStartSec + (foundLate.offsetSec || 0);
                const ovDur = Number(Math.max(0.02, earlyEnd - lateStart).toFixed(2));

                foundEarly.hasCollision = true;
                foundLate.hasCollision = true;
                foundEarly.timingIssue = 'overlap';
                foundLate.timingIssue = 'overlap';
                foundEarly.overlappingClipId = foundLate.id;
                foundLate.overlappingClipId = foundEarly.id;

                enrichedIssues.push({
                  ...rawIssue,
                  trackId: foundLate.trackId,
                  dubberName: foundLate.dubberName,
                  characterName: foundLate.characterName,
                  clipId: foundLate.id,
                  overlappingClipId: foundEarly.id,
                  overlappingDubber: foundEarly.dubberName,
                  timeSec: lateStart,
                  durationSec: ovDur,
                  overlapDurationSec: ovDur
                });

                activeCollisions.push({
                  id: `col_sync_${foundEarly.id}_${foundLate.id}`,
                  track1Id: foundEarly.trackId,
                  track2Id: foundLate.trackId,
                  dubber1Name: foundEarly.dubberName,
                  dubber2Name: foundLate.dubberName,
                  character1Name: foundEarly.characterName,
                  character2Name: foundLate.characterName,
                  startSec: lateStart,
                  endSec: earlyEnd,
                  overlapDurationSec: ovDur
                });
              }
            }
          } else if (rawIssue.type === 'missing') {
            if (!isSliced) {
              enrichedIssues.push({ ...rawIssue });
              continue;
            }
            const mStart = rawIssue.timeSec ?? 0;
            const mEnd = mStart + (rawIssue.durationSec || 1.2);
            const mDur = Math.max(0.25, mEnd - mStart);
            // Check if ANY dubber track (this dubber OR another dubber) has a speech clip covering [mStart, mEnd]
            const isVoicedByAnyDubber = allTrackIds.some(tId => {
              const trObj = tracks.find(t => t.id === tId);
              if (trObj && isFixTrack(trObj)) return false;
              return (markedClips[tId] || []).some(c => {
                if (c.isPhysics || c.durationSec >= 90) return false;
                const cs = c.clipStartSec + (c.offsetSec || 0);
                const ce = cs + c.durationSec;
                const ov = Math.min(ce, mEnd + 0.25) - Math.max(cs, mStart - 0.25);
                return ov >= Math.min(0.28, mDur * 0.35);
              });
            });
            if (!isVoicedByAnyDubber) {
              enrichedIssues.push({ ...rawIssue });
            }
          } else {
            enrichedIssues.push({ ...rawIssue });
          }
        }

        // Also scan sliced timeline for any live intra-track or inter-track tail-to-head overlaps not yet in enrichedIssues
        if (isSliced) {
          for (let i = 0; i < allTrackIds.length; i++) {
            const t1 = tracks.find(t => t.id === allTrackIds[i]);
            if (t1 && isFixTrack(t1)) continue;
            const clips1 = markedClips[allTrackIds[i]] || [];

            for (let idx1 = 0; idx1 < clips1.length; idx1++) {
              const c1 = clips1[idx1];
              if (c1.isPhysics || c1.durationSec >= 90) continue;
              const s1 = c1.clipStartSec + (c1.offsetSec || 0);
              const e1 = s1 + c1.durationSec;

              for (let j = i; j < allTrackIds.length; j++) {
                const t2 = tracks.find(t => t.id === allTrackIds[j]);
                if (t2 && isFixTrack(t2)) continue;
                const clips2 = markedClips[allTrackIds[j]] || [];

                for (let idx2 = (i === j ? idx1 + 1 : 0); idx2 < clips2.length; idx2++) {
                  const c2 = clips2[idx2];
                  if (c1.id === c2.id || c2.isPhysics || c2.durationSec >= 90) continue;
                  if (c1.isUnisonPhrase && c2.isUnisonPhrase) continue;
                  const s2 = c2.clipStartSec + (c2.offsetSec || 0);
                  const e2 = s2 + c2.durationSec;
                  const ov = Math.min(e1, e2) - Math.max(s1, s2);

                  if (ov > 0.03) {
                    const [early, late] = s1 <= s2 ? [c1, c2] : [c2, c1];
                    const pairKey = [early.id, late.id].sort().join('__');
                    if (seenOverlapPairs.has(pairKey)) continue;

                    if (isSimultaneousOrContainedPair(early, late)) {
                      early.hasCollision = false;
                      late.hasCollision = false;
                      if (early.timingIssue === 'overlap') early.timingIssue = null;
                      if (late.timingIssue === 'overlap') late.timingIssue = null;
                      continue;
                    }

                    seenOverlapPairs.add(pairKey);
                    const earlyEnd = early.clipStartSec + (early.offsetSec || 0) + early.durationSec;
                    const lateStart = late.clipStartSec + (late.offsetSec || 0);
                    const ovDur = Number(Math.max(0.02, earlyEnd - lateStart).toFixed(2));

                    early.hasCollision = true;
                    late.hasCollision = true;
                    early.timingIssue = 'overlap';
                    late.timingIssue = 'overlap';
                    early.overlappingClipId = late.id;
                    late.overlappingClipId = early.id;

                    enrichedIssues.push({
                      id: `issue_live_ov_${early.id}_${late.id}`,
                      type: 'overlap',
                      trackId: late.trackId,
                      dubberName: late.dubberName,
                      characterName: late.characterName,
                      clipId: late.id,
                      overlappingClipId: early.id,
                      overlappingDubber: early.dubberName,
                      timeSec: lateStart,
                      durationSec: ovDur,
                      overlapDurationSec: ovDur,
                      description: i === j
                        ? `Наезд внутри дорожки «${late.dubberName}» (${ovDur}с): «${early.text.slice(0, 18)}» 💥 «${late.text.slice(0, 18)}»`
                        : `Наезд голосов: «${early.dubberName}» перекрывает «${late.dubberName}» (${ovDur}с) [${formatSeconds(lateStart)}]`
                    });

                    activeCollisions.push({
                      id: `col_live_${early.id}_${late.id}`,
                      track1Id: early.trackId,
                      track2Id: late.trackId,
                      dubber1Name: early.dubberName,
                      dubber2Name: late.dubberName,
                      character1Name: early.characterName,
                      character2Name: late.characterName,
                      startSec: lateStart,
                      endSec: earlyEnd,
                      overlapDurationSec: ovDur
                    });
                  }
                }
              }
            }
          }
        }

        const filteredMissingMarkers = (savedProject.missingSubtitles || []).filter(m => {
          if (!isSliced) return true;
          const mDur = Math.max(0.25, m.endSec - m.startSec);
          return !allTrackIds.some(tId => {
            const trObj = tracks.find(t => t.id === tId);
            if (trObj && isFixTrack(trObj)) return false;
            return (markedClips[tId] || []).some(c => {
              if (c.isPhysics || c.durationSec >= 90) return false;
              const cs = c.clipStartSec + (c.offsetSec || 0);
              const ce = cs + c.durationSec;
              const ov = Math.min(ce, m.endSec + 0.25) - Math.max(cs, m.startSec - 0.25);
              return ov >= Math.min(0.28, mDur * 0.35);
            });
          });
        });

        const finalCollisions = isSliced ? activeCollisions : (savedProject.collisions || []);
        const finalSummary = {
          ...savedProject.summary,
          totalGaps: enrichedIssues.length,
          overlapsCount: enrichedIssues.filter(i => i.type === 'overlap' && !i.overlappingDubber).length,
          collisionsCount: finalCollisions.length,
          desyncCount: enrichedIssues.filter(i => i.type === 'desync').length,
          missingCount: filteredMissingMarkers.length
        };

        setAudioClips(markedClips);
        setCollisions(finalCollisions);
        setTimingIssues(enrichedIssues);
        setMissingSubtitles(filteredMissingMarkers);
        setIsTimingAnalyzed(true);
        setIsIssuesDrawerOpen(enrichedIssues.length > 0);

        setQaPassportLoaded({
          loaded: true,
          summary: finalSummary,
          savedAt: savedProject.savedAt
        });

        addLog(
          `✓ Синхронизация с QA завершена: актуальных замечаний — ${finalSummary.totalGaps} (наездов/коллизий — ${enrichedIssues.filter(i => i.type === 'overlap').length}, рассинхронов — ${finalSummary.desyncCount}, пропусков — ${finalSummary.missingCount}).`,
          'success'
        );
        toast.success(`Синхронизировано с QA! Актуальных замечаний: ${finalSummary.totalGaps}`);
      } else {
        toast.info('В QA проверке пока нет сохраненных замечаний или проверка еще не запускалась.');
      }
    } catch (err: any) {
      toast.error('Ошибка синхронизации с QA: ' + (err?.message || String(err)));
    } finally {
      setIsLoading(false);
      clearProcess();
    }
  };

  // Reset timing state and restart from scratch
  const handleResetTimingToStart = async () => {
    if (!currentEpisode) return;
    try {
      setIsLoading(true);
      setIsResetConfirmOpen(false);
      setIsPlaying(false);
      stopAllScheduledClips();
      if (videoRef.current) {
        try { videoRef.current.pause(); videoRef.current.currentTime = 0; } catch (e) {}
      }
      setCurrentTime(0);
      currentTimeRef.current = 0;
      updateProcess('Сброс тайминга', 'Очистка сохраненного состояния и удаление файла из папки «Тайминг»...', 20, 1, 2);
      addLog('Запуск сброса состояния тайминга серии...', 'warn');

      await ipcSafe.invoke('timing-reset-state', { episode: currentEpisode });
      isStateRestoredRef.current = false;
      setSavedTimingStateInfo(null);
      setIsSilenceRemoved(false);
      setIsFixesStitched(false);
      setIsTimingAnalyzed(false);
      setCollisions([]);
      setIntentionalOverlaps([]);
      setTimingIssues([]);
      setMissingSubtitles([]);
      setFinalVerificationReport(null);
      setCalibrationsByTrack({});
      setSelectedClipId(null);
      setQaPassportLoaded(null);

      updateProcess('Сброс тайминга', 'Перезагрузка исходных дорожек серии...', 50, 2, 2);
      await loadEpisodeData(false, true);

      toast.success('Тайминг серии успешно сброшен! Загружены исходные дорожки с начала.');
      addLog('✓ Тайминг серии сброшен к исходному состоянию.', 'success');
    } catch (err: any) {
      toast.error(`Ошибка при сбросе: ${err.message || String(err)}`);
      addLog(`❌ Ошибка сброса тайминга: ${err.message || String(err)}`, 'error');
    } finally {
      setIsLoading(false);
      clearProcess();
    }
  };

  // Debounced auto-save of Timing tab state to <EpisodeDir>/Тайминг/timing_state.json
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isStateRestoredRef.current || isLoading || !currentEpisode || tracks.length === 0) {
      return;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const statePayload = {
          tracks,
          allCatalogTracks: allCatalogTracksRef.current.length > 0 ? allCatalogTracksRef.current : tracks,
          audioClips,
          trackSubLinesMap,
          isSilenceRemoved,
          isFixesStitched,
          isTimingAnalyzed,
          collisions,
          intentionalOverlaps,
          timingIssues,
          missingSubtitles,
          qaPassportLoaded,
          finalVerificationReport,
          calibrationsByTrack,
          volumes,
          mutedTracks: Array.from(mutedTracks),
          originalVolume,
          isOriginalMuted,
          originalWaveScale,
          isOriginalWaveNormalized,
          originalTrackHeight,
          zoomLevel,
          trackHeightMode,
          timingSettings,
          originalStems
        };

        const res: any = await ipcSafe.invoke('timing-save-state', {
          episode: currentEpisode,
          state: statePayload
        });

        if (res && res.success) {
          setSavedTimingStateInfo({
            savedAt: res.updatedAt || new Date().toISOString(),
            filePath: res.filePath
          });
        }
      } catch (err) {
        console.warn('[TimingAutoSave] Error saving state:', err);
      }
    }, 600);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [
    currentEpisode?.id,
    tracks,
    audioClips,
    trackSubLinesMap,
    isSilenceRemoved,
    isFixesStitched,
    isTimingAnalyzed,
    collisions,
    intentionalOverlaps,
    timingIssues,
    missingSubtitles,
    qaPassportLoaded,
    finalVerificationReport,
    calibrationsByTrack,
    volumes,
    mutedTracks,
    originalVolume,
    isOriginalMuted,
    originalWaveScale,
    isOriginalWaveNormalized,
    originalTrackHeight,
    zoomLevel,
    trackHeightMode,
    timingSettings,
    isLoading
  ]);

  // PIPELINE STEP 1: Import all tracks from QA
  const handleImportFromQA = async () => {
    if (!currentEpisode) return;
    try {
      setIsLoading(true);
      setIsImporting(true);
      updateProcess('1. Импорт дорожек из QA', 'Сборка и экспорт файлов дорожек из QA...', 5, 1, 2);
      addLog('Запуск импорта и подготовки дорожек из QA...', 'info');

      const unsub = ipcSafe.on('mixing-progress', (p: any) => {
        if (p && typeof p.percent === 'number') {
          const scaled = Math.min(42, Math.round(5 + p.percent * 0.37));
          updateProcess(
            '1. Импорт дорожек из QA',
            p.message ? `1/2. ${p.message}` : 'Сборка файлов звукорежиссёра...',
            scaled,
            1,
            2
          );
        }
      });

      try {
        await ipcSafe.invoke('mixing-import-sound-engineer-files', {
          episode: currentEpisode,
          autoApplyFixes: false,
          autoTiming: false
        });
      } finally {
        if (typeof unsub === 'function') unsub();
      }

      updateProcess('1. Импорт дорожек из QA', '2/2. Загрузка и декодирование аудиоволн на таймлайн...', 45, 2, 2);
      await loadEpisodeData(true);
      updateProcess('1. Импорт дорожек из QA', 'Импорт дорожек успешно завершён!', 100, 2, 2);
      toast.success('Импорт дорожек выполнен! Исходные файлы загружены в тайминг.');
    } catch (err: any) {
      addLog(`❌ Ошибка импорта: ${err.message || String(err)}`, 'error');
      toast.error(`Ошибка импорта: ${err.message || String(err)}`);
    } finally {
      setTimeout(() => {
        setIsLoading(false);
        setIsImporting(false);
        clearProcess();
      }, 400);
    }
  };

  return {
    handleSyncFromQA,
    handleResetTimingToStart,
    handleImportFromQA,
  };
}
