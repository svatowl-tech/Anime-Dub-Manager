import React from "react";
import { toast } from "sonner";
import { Track, SubtitleLine } from "../../types";
import { TimingSettings } from "../TimingSettingsModal";
import {
  AudioClip,
  TimingIssue,
  MissingSubtitleMarker,
  VoiceCollisionMarker,
  formatSeconds
} from "./timingAudioUtils";
import { runStage1TimingAnalysisEngine } from "./timing.autoAlign.engine";

export function useTimingAutoAlign(params: {
  tracks: Track[];
  audioClips: Record<string, AudioClip[]>;
  setAudioClips: React.Dispatch<React.SetStateAction<Record<string, AudioClip[]>>>;
  isSilenceRemoved: boolean;
  setIsSilenceRemoved: React.Dispatch<React.SetStateAction<boolean>>;
  audioBuffersRef: React.MutableRefObject<Record<string, AudioBuffer>>;
  timingSettings: TimingSettings;
  trackSubLinesMap: Record<string, SubtitleLine[]>;
  collisions: VoiceCollisionMarker[];
  setCollisions: React.Dispatch<React.SetStateAction<VoiceCollisionMarker[]>>;
  timingIssues: TimingIssue[];
  setTimingIssues: React.Dispatch<React.SetStateAction<TimingIssue[]>>;
  setMissingSubtitles: React.Dispatch<React.SetStateAction<MissingSubtitleMarker[]>>;
  setIsTimingAnalyzed: React.Dispatch<React.SetStateAction<boolean>>;
  setIsIssuesDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
  addLog: (msg: string, level?: "info" | "success" | "warn" | "error") => void;
}) {
  const {
    tracks,
    audioClips,
    setAudioClips,
    isSilenceRemoved,
    setIsSilenceRemoved,
    audioBuffersRef,
    timingSettings,
    trackSubLinesMap,
    collisions,
    setCollisions,
    timingIssues,
    setTimingIssues,
    setMissingSubtitles,
    setIsTimingAnalyzed,
    setIsIssuesDrawerOpen,
    setIsLoading,
    setStatusMessage,
    addLog
  } = params;

  const handleAnalyzeTiming = async () => {
    if (tracks.length === 0) return;
    try {
      setIsLoading(true);
      setStatusMessage('Этап 1: Анализ таймингов и поиск проблем...');
      addLog('Запуск Этапа 1: глубокий анализ наездов, рассинхронов и пропущенных реплик...', 'info');

      const {
        updatedClips,
        newIssues,
        newMissingMarkers,
        newCollisions,
        didCutSilence
      } = await runStage1TimingAnalysisEngine({
        tracks,
        audioClips,
        isSilenceRemoved,
        audioBuffersRef,
        timingSettings,
        trackSubLinesMap,
        setStatusMessage,
        addLog
      });

      if (didCutSilence) {
        setIsSilenceRemoved(true);
      }

      setAudioClips(updatedClips);
      setTimingIssues(newIssues);
      setMissingSubtitles(newMissingMarkers);
      setCollisions(newCollisions);
      setIsTimingAnalyzed(true);
      setIsIssuesDrawerOpen(newIssues.length > 0);

      const overlapCount = newIssues.filter(i => i.type === 'overlap').length;
      const desyncCount = newIssues.filter(i => i.type === 'desync').length;
      const missingCount = newIssues.filter(i => i.type === 'missing').length;
      const orphanCount = newIssues.filter(i => i.type === 'orphan').length;

      addLog(`✓ Этап 1 (Анализ) завершен! Найдено проблем: наездов — ${overlapCount}, рассинхронов — ${desyncCount}, пропущенных — ${missingCount}, висящих в воздухе — ${orphanCount}.`, newIssues.length > 0 ? 'warn' : 'success');

      if (newIssues.length === 0) {
        toast.success('🎉 Анализ завершен! На дорожках нет ни одного наезда, рассинхрона или пропуска.');
      } else {
        toast.warning(`Найдено проблем: ${newIssues.length} (Наезды: ${overlapCount}, Рассинхрон: ${desyncCount}, Пропуски: ${missingCount}, Висящие: ${orphanCount}). Проверьте на таймлайне или примените «2. Точечный автотайминг».`, { duration: 6000 });
      }
    } catch (err: any) {
      addLog(`❌ Ошибка этапа 1 (Анализ): ${err.message}`, 'error');
      toast.error(`Ошибка анализа таймингов: ${err.message}`);
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  };

  const handleApplyTargetedAutoTiming = async (typeFilter: 'all' | 'overlap' | 'desync' | 'orphan' = 'all') => {
    if (tracks.length === 0) return;
    try {
      setIsLoading(true);
      setStatusMessage('Этап 2: Точечное исправление помеченных проблем...');
      addLog(`Запуск Этапа 2: точечный автотайминг (фильтр: ${typeFilter})...`, 'info');

      const updatedClips = { ...audioClips };
      let fixedDesyncCount = 0;
      let fixedOverlapCount = 0;
      let fixedOrphanCount = 0;

      for (const trackId of Object.keys(updatedClips)) {
        const clips = [...(updatedClips[trackId] || [])].sort(
          (a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0))
        );

        for (let idx = 0; idx < clips.length; idx++) {
          const clip = clips[idx];
          const shouldFixDesync = clip.timingIssue === 'desync' && (typeFilter === 'all' || typeFilter === 'desync');
          const shouldFixOrphan = clip.timingIssue === 'orphan' && (typeFilter === 'all' || typeFilter === 'orphan');

          if ((shouldFixDesync || shouldFixOrphan) && typeof clip.targetSubStartSec === 'number') {
            const curStart = clip.clipStartSec + (clip.offsetSec || 0);
            const prevEnd = idx > 0
              ? (clips[idx - 1].clipStartSec + (clips[idx - 1].offsetSec || 0) + clips[idx - 1].durationSec + 0.04)
              : 0;
            const nextStart = idx + 1 < clips.length
              ? (clips[idx + 1].clipStartSec + (clips[idx + 1].offsetSec || 0) - 0.04)
              : Infinity;

            let safeStart = Math.max(curStart - 1.5, Math.min(curStart + 1.5, clip.targetSubStartSec));
            safeStart = Math.max(prevEnd, Math.min(safeStart, Math.max(prevEnd, nextStart - clip.durationSec)));
            safeStart = Number(Math.max(0, safeStart).toFixed(3));

            if (Math.abs(safeStart - curStart) >= 0.03) {
              if (shouldFixDesync) fixedDesyncCount++;
              else fixedOrphanCount++;
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

      if (typeFilter === 'all' || typeFilter === 'overlap') {
        for (const trackId of Object.keys(updatedClips)) {
          const clips = [...(updatedClips[trackId] || [])];
          clips.sort((a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0)));

          for (let i = 0; i < clips.length - 1; i++) {
            const c1 = clips[i];
            const c2 = clips[i + 1];
            const c1End = (c1.clipStartSec + (c1.offsetSec || 0)) + c1.durationSec;
            const c2Start = c2.clipStartSec + (c2.offsetSec || 0);

            if (c1End > c2Start) {
              if (typeof c1.targetSubStartSec === 'number' && c1.clipStartSec > c1.targetSubStartSec) {
                const prevLimit = i > 0 ? ((clips[i - 1].clipStartSec + (clips[i - 1].offsetSec || 0)) + clips[i - 1].durationSec + 0.04) : 0;
                const canMoveBack = Math.min(0.8, Math.max(0, c1.clipStartSec - Math.max(c1.targetSubStartSec, prevLimit)));
                if (canMoveBack > 0.01) {
                  c1.clipStartSec = Number((c1.clipStartSec - canMoveBack).toFixed(3));
                  c1.offsetSec = 0;
                }
              }
              const newC1End = (c1.clipStartSec + (c1.offsetSec || 0)) + c1.durationSec;
              if (newC1End > (c2.clipStartSec + (c2.offsetSec || 0))) {
                const nextLimit = i + 2 < clips.length
                  ? (clips[i + 2].clipStartSec + (clips[i + 2].offsetSec || 0) - c2.durationSec - 0.04)
                  : Infinity;
                const rawShift = (newC1End - (c2.clipStartSec + (c2.offsetSec || 0))) + 0.04;
                const clampedShift = Math.min(1.2, rawShift);
                const targetC2Start = Math.min(nextLimit, c2.clipStartSec + clampedShift);
                if (targetC2Start > c2.clipStartSec) {
                  c2.clipStartSec = Number(targetC2Start.toFixed(3));
                  c2.offsetSec = 0;
                }
              }
              c1.hasCollision = false;
              c2.hasCollision = false;
              c1.timingIssue = null;
              c2.timingIssue = null;
              c1.timingIssueText = undefined;
              c2.timingIssueText = undefined;
              fixedOverlapCount++;
              addLog(`↔️ Хирургически раздвинут наезд в «${c1.dubberName}»: фраза #${i + 2} пододвинута на (${formatSeconds(c2.clipStartSec)})`, 'info');
            }
          }
          updatedClips[trackId] = clips;
        }

        for (const col of collisions) {
          const tr1 = updatedClips[col.track1Id] || [];
          const tr2 = updatedClips[col.track2Id] || [];
          const c1Idx = tr1.findIndex(c => {
            const s = c.clipStartSec + (c.offsetSec || 0);
            const e = s + c.durationSec;
            return s < col.endSec && e > col.startSec;
          });
          const c2Idx = tr2.findIndex(c => {
            const s = c.clipStartSec + (c.offsetSec || 0);
            const e = s + c.durationSec;
            return s < col.endSec && e > col.startSec;
          });

          if (c1Idx !== -1 && c2Idx !== -1) {
            const c1 = tr1[c1Idx];
            const c2 = tr2[c2Idx];
            const c1End = (c1.clipStartSec + (c1.offsetSec || 0)) + c1.durationSec;
            const c2Start = c2.clipStartSec + (c2.offsetSec || 0);
            if (c1End > c2Start) {
              const rawShift = (c1End - c2Start) + 0.04;
              if (rawShift <= 1.25) {
                const nextInTr2 = c2Idx + 1 < tr2.length
                  ? (tr2[c2Idx + 1].clipStartSec + (tr2[c2Idx + 1].offsetSec || 0) - c2.durationSec - 0.04)
                  : Infinity;
                const safeC2Start = Math.min(nextInTr2, c2Start + rawShift);
                if (safeC2Start > c2Start) {
                  c2.clipStartSec = Number(safeC2Start.toFixed(3));
                  c2.offsetSec = 0;
                  fixedOverlapCount++;
                  addLog(`↔️ Хирургически раздвинут наезд между «${col.dubber1Name}» и «${col.dubber2Name}» (+${(safeC2Start - c2Start).toFixed(2)}с)`, 'info');
                }
              }
              c1.hasCollision = false;
              c2.hasCollision = false;
              c1.timingIssue = null;
              c2.timingIssue = null;
            }
          }
        }
      }

      setAudioClips(updatedClips);

      const remainingIssues = timingIssues.filter(issue => {
        if (issue.type === 'desync' && (typeFilter === 'all' || typeFilter === 'desync')) return false;
        if (issue.type === 'overlap' && (typeFilter === 'all' || typeFilter === 'overlap')) return false;
        if (issue.type === 'orphan' && (typeFilter === 'all' || typeFilter === 'orphan')) {
          const targetClip = Object.values(updatedClips).flat().find(c => c.id === issue.clipId);
          return targetClip?.timingIssue === 'orphan';
        }
        return true;
      });
      setTimingIssues(remainingIssues);
      setCollisions([]);

      const totalFixed = fixedDesyncCount + fixedOverlapCount + fixedOrphanCount;
      addLog(`✓ Этап 2 (Точечный автотайминг) завершен! Исправлено проблем: ${totalFixed} (рассинхронов: ${fixedDesyncCount}, наездов: ${fixedOverlapCount}, сопоставлено Whisper: ${fixedOrphanCount}). Остальные фразы сохранены 1:1!`, 'success');
      toast.success(`Точечный автотайминг применен! Исправлено: ${totalFixed} проблем. Непроблемные фразы сохранены 1:1.`);
    } catch (err: any) {
      addLog(`❌ Ошибка этапа 2 (Точечный автотайминг): ${err.message}`, 'error');
      toast.error(`Ошибка применения автотайминга: ${err.message}`);
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  };

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

  const handleResolveSingleOverlap = (trackId: string, clipId: string) => {
    setAudioClips(prev => {
      const updated = { ...prev };
      let targetClip: AudioClip | null = null;
      let targetTrackId = trackId;

      for (const [tId, clips] of Object.entries(updated)) {
        const found = clips.find(c => c.id === clipId);
        if (found) {
          targetClip = found;
          targetTrackId = tId;
          break;
        }
      }
      if (!targetClip) return prev;

      let collidingClip: AudioClip | null = null;
      if (targetClip.overlappingClipId) {
        for (const clips of Object.values(updated)) {
          const found = clips.find(c => c.id === targetClip!.overlappingClipId);
          if (found) {
            collidingClip = found;
            break;
          }
        }
      }

      if (collidingClip) {
        const colEnd = (collidingClip.clipStartSec + (collidingClip.offsetSec || 0)) + collidingClip.durationSec;
        const curStart = targetClip.clipStartSec + (targetClip.offsetSec || 0);
        if (colEnd > curStart) {
          const shift = (colEnd - curStart) + 0.04;
          targetClip.clipStartSec = Number((targetClip.clipStartSec + shift).toFixed(3));
          targetClip.offsetSec = 0;
          targetClip.hasCollision = false;
          collidingClip.hasCollision = false;
          targetClip.timingIssue = null;
          collidingClip.timingIssue = null;
          addLog(`↔️ Раздвинут наезд: «${targetClip.text}» сдвинута на +${shift.toFixed(2)}с`, 'success');
        }
      } else {
        const trClips = [...(updated[targetTrackId] || [])];
        trClips.sort((a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0)));
        const idx = trClips.findIndex(c => c.id === clipId);
        if (idx > 0) {
          const prevClip = trClips[idx - 1];
          const prevEnd = (prevClip.clipStartSec + (prevClip.offsetSec || 0)) + prevClip.durationSec;
          const curStart = targetClip.clipStartSec + (targetClip.offsetSec || 0);
          if (prevEnd > curStart) {
            const shift = (prevEnd - curStart) + 0.04;
            targetClip.clipStartSec = Number((targetClip.clipStartSec + shift).toFixed(3));
            targetClip.offsetSec = 0;
            targetClip.hasCollision = false;
            prevClip.hasCollision = false;
            targetClip.timingIssue = null;
            prevClip.timingIssue = null;
            addLog(`↔️ Раздвинут наезд внутри дорожки: «${targetClip.text}» сдвинута на +${shift.toFixed(2)}с`, 'success');
          }
        }
        updated[targetTrackId] = trClips;
      }

      return updated;
    });
    setTimingIssues(prev => prev.filter(i => i.clipId !== clipId));
    toast.success('Наезд точечно раздвинут!');
  };

  return {
    handleAnalyzeTiming,
    handleApplyTargetedAutoTiming,
    handleFixSingleClip,
    handleResolveSingleOverlap
  };
}
