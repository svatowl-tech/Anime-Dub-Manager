import { useMemo } from 'react';
import type React from 'react';
import { toast } from 'sonner';
import { Episode, Track, SubtitleLine } from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';
import {
  AudioClip,
  IntentionalOverlapMoment,
  OriginalStemsState,
  TimingPanelProps,
} from './timing.types';
import {
  buildExportIntentionalOverlapsAndSyncUnison as buildExportIntentionalOverlapsAndSyncUnisonService,
} from './timing.service';

export interface UseTimingExportControllerParams {
  currentEpisode: Episode | null;
  tracks: Track[];
  audioClips: Record<string, AudioClip[]>;
  trackSubLinesMap: Record<string, SubtitleLine[]>;
  intentionalOverlaps: IntentionalOverlapMoment[];
  volumes: Record<string, number>;
  originalStems: OriginalStemsState;
  duration: number;
  zoomLevel: number;
  selectedClipId: string | null;
  onNavigate?: TimingPanelProps['onNavigate'];
  setIntentionalOverlaps: React.Dispatch<React.SetStateAction<IntentionalOverlapMoment[]>>;
  setIsExportingToMixing: React.Dispatch<React.SetStateAction<boolean>>;
  setIsExportingSE: React.Dispatch<React.SetStateAction<boolean>>;
  setExportProgress: React.Dispatch<React.SetStateAction<number>>;
  setIsExportModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  updateProcess: (title: string, detail: string, progress: number, stepCurrent?: number, stepTotal?: number) => void;
  clearProcess: () => void;
  addLog: (msg: string, level?: 'info' | 'success' | 'warn' | 'error') => void;
}

export function useTimingExportController({
  currentEpisode,
  tracks,
  audioClips,
  trackSubLinesMap,
  intentionalOverlaps,
  volumes,
  originalStems,
  duration,
  zoomLevel,
  selectedClipId,
  onNavigate,
  setIntentionalOverlaps,
  setIsExportingToMixing,
  setIsExportingSE,
  setExportProgress,
  setIsExportModalOpen,
  updateProcess,
  clearProcess,
  addLog,
}: UseTimingExportControllerParams) {
  const buildExportIntentionalOverlapsAndSyncUnison = (
    clipsMap: Record<string, AudioClip[]>
  ): IntentionalOverlapMoment[] => {
    return buildExportIntentionalOverlapsAndSyncUnisonService(clipsMap, trackSubLinesMap, intentionalOverlaps);
  };

  const handleExportToMixing = async () => {
    if (!currentEpisode) return;
    try {
      setIsExportingToMixing(true);
      updateProcess('Экспорт в Сведение', 'Подготовка метаданных и рендеринг оттаймленных мастер-дорожек...', 15, 1, 2);
      addLog('🎬 Старт экспорта в Сведение: рендеринг всех готовых дорожек каждого даббера...', 'info');

      const activeTrackIds = new Set(tracks.map(t => t.id));
      const enrichedAudioClips: Record<string, AudioClip[]> = {};
      for (const trId of Object.keys(audioClips)) {
        if (!activeTrackIds.has(trId)) continue;
        const tr = tracks.find(t => t.id === trId);
        const clips = audioClips[trId] || [];
        enrichedAudioClips[trId] = clips.map(c => ({
          ...c,
          volumePercent: c.volumePercent ?? 100,
          volumeGainDb: c.volumeGainDb ?? 0,
          sourceAudioPath: c.sourceAudioPath || tr?.filePath
        }));
      }

      const exportIntentionalOverlaps = buildExportIntentionalOverlapsAndSyncUnison(enrichedAudioClips);
      setIntentionalOverlaps(exportIntentionalOverlaps);

      let targetDir = '';
      try {
        const res: any = await ipcSafe.invoke('mixing-get-status', { episode: currentEpisode });
        if (res && res.workingDir) {
          targetDir = res.workingDir;
        }
      } catch (e) {}

      if (!targetDir) {
        const baseFile = currentEpisode.rawPath || currentEpisode.subPath;
        if (baseFile) {
          const isWin = baseFile.includes('\\');
          const sep = isWin ? '\\' : '/';
          const lastSlashIndex = Math.max(baseFile.lastIndexOf('/'), baseFile.lastIndexOf('\\'));
          const epFolder = lastSlashIndex !== -1 ? baseFile.substring(0, lastSlashIndex) : baseFile;
          targetDir = `${epFolder}${sep}Сведения`;
        }
      }

      const timingMetadata = {
        version: '1.0',
        updatedAt: new Date().toISOString(),
        episodeNumber: currentEpisode?.number || 1,
        defaultVolumePercent: 100,
        intentionalOverlaps: exportIntentionalOverlaps,
        rolesVolumeMap: tracks.reduce((acc, tr) => {
          const roleName = tr.character || tr.characterName || tr.participant || 'Персонаж';
          const dubberNick = tr.participant || tr.dubberName || 'Даббер';
          acc[roleName] = 100;
          acc[dubberNick] = 100;
          return acc;
        }, {} as Record<string, number>),
        phrases: Object.keys(enrichedAudioClips).flatMap(trId => {
          const clips = enrichedAudioClips[trId] || [];
          return clips.map(b => {
            return {
              id: b.id,
              dubberNick: b.dubberName,
              characterName: b.characterName,
              startSec: Number((b.clipStartSec + (b.offsetSec || 0)).toFixed(2)),
              endSec: Number((b.clipStartSec + (b.offsetSec || 0) + b.durationSec).toFixed(2)),
              durationSec: Number(b.durationSec.toFixed(2)),
              text: b.text,
              isUnisonPhrase: Boolean(b.isUnisonPhrase),
              isIntentionalOverlap: Boolean(b.isIntentionalOverlap),
              isPhysics: Boolean(b.isPhysics),
              volumePercent: b.volumePercent ?? 100,
              volumeGainDb: b.volumeGainDb ?? 0,
              pan: 0,
              timeStretch: 1.0,
              headTrimSec: 0,
              tailTrimSec: 0
            };
          });
        })
      };

      try {
        await ipcSafe.invoke('mixing-save-timing-metadata', {
          episode: currentEpisode,
          timingMetadata
        });
        const epDir = (currentEpisode as any)?.folderPath || targetDir;
        if (epDir) {
          await ipcSafe.invoke('audio-save-timing-analysis', {
            episodeDir: epDir,
            data: timingMetadata
          });
        }
      } catch (e) {}

      updateProcess('Экспорт в Сведение', 'Рендеринг и сохранение мастер-дорожек дабберов...', 55, 2, 2);
      const unsubMix = ipcSafe.on('mixing-progress', (p: any) => {
        if (p && typeof p.percent === 'number') {
          updateProcess(
            'Экспорт в Сведение',
            p.message || 'Рендеринг мастер-дорожек...',
            Math.round(55 + p.percent * 0.45),
            2,
            2
          );
        }
      });

      let res: any;
      try {
        res = await ipcSafe.invoke('timing-export-to-mixing', {
          episode: currentEpisode,
          targetDir: targetDir || undefined,
          tracks,
          audioClips: enrichedAudioClips,
          volumes,
          timingMetadata,
          originalStems: originalStems.hasStems ? {
            hasStems: true,
            vocalsPath: originalStems.vocalsPath,
            instrumentalPath: originalStems.instrumentalPath,
            modelId: originalStems.modelId
          } : undefined
        });
      } finally {
        if (typeof unsubMix === 'function') unsubMix();
      }

      if (res && res.success === false) {
        throw new Error(res.error || 'Не удалось экспортировать дорожки в сведение');
      }

      updateProcess('Экспорт в Сведение', 'Мастер-дорожки успешно переданы в Сведение!', 100, 2, 2);
      toast.success('Готовые сведённые дорожки переданы в Сведение видео!');
      addLog('✓ Все оттаймленные дорожки дабберов успешно сведены и отправлены в Сведение', 'success');
      if (onNavigate) onNavigate('mixing');
    } catch (err: any) {
      toast.error(`Ошибка: ${err.message}`);
      addLog(`❌ Ошибка передачи в сведение: ${err.message}`, 'error');
    } finally {
      setIsExportingToMixing(false);
      clearProcess();
    }
  };

  const handleExportSoundEngineerFromTiming = async (
    targetDir: string,
    skipConversion: boolean,
    smartExport?: boolean,
    _uploadToYandex?: boolean,
    additionalProcessing?: boolean,
    autoApplyFixes?: boolean,
    includeSubtitles?: boolean,
    autoTiming?: boolean,
    selectedTrackIds?: string[]
  ) => {
    if (!currentEpisode || !targetDir) return;

    try {
      setIsExportingSE(true);
      setExportProgress(5);
      updateProcess('Экспорт звукорежиссёру', `Экспорт комплекта файлов в «${targetDir}»...`, 10);
      addLog(`Старт экспорта для звукорежиссёра в директорию: ${targetDir}`, 'info');

      const exportIntentionalOverlaps = buildExportIntentionalOverlapsAndSyncUnison(audioClips);

      const timingMetadata = {
        version: '1.0',
        updatedAt: new Date().toISOString(),
        episodeNumber: currentEpisode?.number || 1,
        defaultVolumePercent: 100,
        intentionalOverlaps: exportIntentionalOverlaps,
        rolesVolumeMap: tracks.reduce((acc, tr) => {
          const roleName = tr.character || tr.characterName || tr.participant || 'Персонаж';
          const dubberNick = tr.participant || tr.dubberName || 'Даббер';
          acc[roleName] = 100;
          acc[dubberNick] = 100;
          return acc;
        }, {} as Record<string, number>),
        phrases: Object.keys(audioClips).flatMap(trId => {
          const clips = audioClips[trId] || [];
          return clips.map(b => {
            return {
              id: b.id,
              dubberNick: b.dubberName,
              characterName: b.characterName,
              startSec: Number((b.clipStartSec + (b.offsetSec || 0)).toFixed(2)),
              endSec: Number((b.clipStartSec + (b.offsetSec || 0) + b.durationSec).toFixed(2)),
              durationSec: Number(b.durationSec.toFixed(2)),
              text: b.text,
              isUnisonPhrase: Boolean(b.isUnisonPhrase),
              isIntentionalOverlap: Boolean(b.isIntentionalOverlap),
              volumePercent: 100,
              volumeGainDb: 0,
              pan: 0,
              timeStretch: 1.0,
              headTrimSec: 0,
              tailTrimSec: 0
            };
          });
        })
      };

      try {
        await ipcSafe.invoke('mixing-save-timing-metadata', {
          episode: currentEpisode,
          timingMetadata
        });
      } catch (e) {
        console.warn('Metadata save warning:', e);
      }

      const res: any = await ipcSafe.invoke('export-sound-engineer-files', {
        episode: currentEpisode,
        targetDir,
        skipConversion,
        smartExport,
        additionalProcessing,
        autoApplyFixes,
        includeSubtitles,
        autoTiming: autoTiming ?? false,
        selectedTrackIds: Array.isArray(selectedTrackIds) ? selectedTrackIds : undefined,
        originalStems: originalStems.hasStems ? {
          hasStems: true,
          vocalsPath: originalStems.vocalsPath,
          instrumentalPath: originalStems.instrumentalPath,
          modelId: originalStems.modelId
        } : undefined
      });

      if (res && res.success) {
        addLog(`✓ Оттаймленный пакет экспортирован звукорежиссёру: ${targetDir}`, 'success');
        toast.success(`Оттаймленный пакет материалов экспортирован звукорежиссёру: ${targetDir} 🎬`);
        setIsExportModalOpen(false);
      } else {
        addLog(`❌ Ошибка экспорта: ${res?.error || 'неизвестная ошибка'}`, 'error');
        toast.error(`Ошибка при экспорте: ${res?.error || 'неизвестная ошибка'}`);
      }
    } catch (err: any) {
      console.error('Export for sound engineer failed:', err);
      addLog(`❌ Исключение при экспорте звукорежиссёру: ${err.message || String(err)}`, 'error');
      toast.error(`Не удалось экспортировать файлы звукорежиссёру: ${err.message || String(err)}`);
    } finally {
      setIsExportingSE(false);
      setExportProgress(0);
      clearProcess();
    }
  };

  const timeRulerTicks = useMemo(() => {
    const ticks: number[] = [];
    const stepSec = zoomLevel < 20 ? 30 : zoomLevel < 50 ? 10 : 5;
    for (let sec = 0; sec <= duration; sec += stepSec) {
      ticks.push(sec);
    }
    return ticks;
  }, [duration, zoomLevel]);

  // Find currently selected clip object
  const activeSelectedClip = useMemo(() => {
    if (!selectedClipId) return null;
    for (const trId of Object.keys(audioClips)) {
      const found = (audioClips[trId] || []).find(c => c.id === selectedClipId);
      if (found) return { clip: found, trackId: trId };
    }
    return null;
  }, [selectedClipId, audioClips]);

  return {
    buildExportIntentionalOverlapsAndSyncUnison,
    handleExportToMixing,
    handleExportSoundEngineerFromTiming,
    timeRulerTicks,
    activeSelectedClip,
  };
}
