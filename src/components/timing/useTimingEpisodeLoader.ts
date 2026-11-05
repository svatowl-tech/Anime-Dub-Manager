import React, { useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Episode, Track, SubtitleLine } from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';
import { getSharedAudioContext } from '../../lib/qa/sharedAudioContext';
import { NormalizationMetrics } from '../../lib/qa/audioNormalizer';
import { prepareQATracksForTiming } from '../../lib/qaTimingHelper';
import { loadTimingProjectForEpisode, applyTimingPassportToClips, TimingProjectData } from '../../lib/qa/timingSyncService';
import { TimingSettings } from '../TimingSettingsModal';
import { AudioClip, VoiceCollisionMarker, IntentionalOverlapMoment, TimingIssue, MissingSubtitleMarker, NoiseCalibration, OriginalStemsState } from './timing.types';
import { parseTimeToSeconds, getPlayableAudioUrl } from './timing.utils';
import {
  decodeSavedStateAudioSources,
  decodeFetchedTracksAudioBuffers,
  mapSubtitlesAndBuildInitialClips
} from './timingAudioDecodeAndSubMap.service';

export {
  decodeSavedStateAudioSources,
  decodeFetchedTracksAudioBuffers,
  mapSubtitlesAndBuildInitialClips
};

export function useTimingEpisodeLoader({
  currentEpisode, setTracks, setAudioClips, setCollisions, setIntentionalOverlaps,
  setQaPassportLoaded, savedPassportRef, allCatalogTracksRef, isStateRestoredRef,
  setSavedTimingStateInfo, setIsSilenceRemoved, setIsFixesStitched, setTimingIssues,
  setMissingSubtitles, setIsTimingAnalyzed, setIsIssuesDrawerOpen, setIsLoading,
  setImportDecodedTracks, setTrackHeightMode, setRawSubtitles, setTrackSubLinesMap,
  setVideoUrl, setOriginalPeaks, setIsOriginalMuted, handleChangeOriginalWaveScale,
  setIsOriginalWaveNormalized, handleChangeOriginalTrackHeight, setNormalizationMetrics,
  timingSettings, setTimingSettings, setCalibrationsByTrack, setDuration, setZoomLevel,
  setMutedTracks, setVolumes, setOriginalVolume, setOriginalStems, setSelectedStemModel,
  setFinalVerificationReport, audioElementsRef, audioBuffersRef, trackFileSizesRef,
  origBuffersByTrackRef, fixBuffersByActorRef, updateProcess, clearProcess, addLog,
}: {
  currentEpisode: Episode | null;
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  setAudioClips: React.Dispatch<React.SetStateAction<Record<string, AudioClip[]>>>;
  setCollisions: React.Dispatch<React.SetStateAction<VoiceCollisionMarker[]>>;
  setIntentionalOverlaps: React.Dispatch<React.SetStateAction<IntentionalOverlapMoment[]>>;
  setQaPassportLoaded: React.Dispatch<React.SetStateAction<{ loaded: boolean; summary: TimingProjectData['summary']; savedAt: string } | null>>;
  savedPassportRef: React.MutableRefObject<TimingProjectData | null>;
  allCatalogTracksRef: React.MutableRefObject<Track[]>;
  isStateRestoredRef: React.MutableRefObject<boolean>;
  setSavedTimingStateInfo: React.Dispatch<React.SetStateAction<{ savedAt: string; filePath?: string } | null>>;
  setIsSilenceRemoved: React.Dispatch<React.SetStateAction<boolean>>;
  setIsFixesStitched: React.Dispatch<React.SetStateAction<boolean>>;
  setTimingIssues: React.Dispatch<React.SetStateAction<TimingIssue[]>>;
  setMissingSubtitles: React.Dispatch<React.SetStateAction<MissingSubtitleMarker[]>>;
  setIsTimingAnalyzed: React.Dispatch<React.SetStateAction<boolean>>;
  setIsIssuesDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setImportDecodedTracks: React.Dispatch<React.SetStateAction<Array<{ id: string; name: string; duration?: number; status: 'pending' | 'decoding' | 'done' | 'error' }>>>;
  setTrackHeightMode: React.Dispatch<React.SetStateAction<'standard' | 'compact' | 'fit'>>;
  setRawSubtitles: React.Dispatch<React.SetStateAction<SubtitleLine[]>>;
  setTrackSubLinesMap: React.Dispatch<React.SetStateAction<Record<string, SubtitleLine[]>>>;
  setVideoUrl: React.Dispatch<React.SetStateAction<string | null>>;
  setOriginalPeaks: React.Dispatch<React.SetStateAction<number[]>>;
  setIsOriginalMuted: React.Dispatch<React.SetStateAction<boolean>>;
  handleChangeOriginalWaveScale: (nextVal: number) => void;
  setIsOriginalWaveNormalized: React.Dispatch<React.SetStateAction<boolean>>;
  handleChangeOriginalTrackHeight: (nextHeight: number) => void;
  setNormalizationMetrics: React.Dispatch<React.SetStateAction<Record<string, NormalizationMetrics>>>;
  timingSettings: TimingSettings;
  setTimingSettings: React.Dispatch<React.SetStateAction<TimingSettings>>;
  setCalibrationsByTrack: React.Dispatch<React.SetStateAction<Record<string, NoiseCalibration>>>;
  setDuration: React.Dispatch<React.SetStateAction<number>>;
  setZoomLevel: React.Dispatch<React.SetStateAction<number>>;
  setMutedTracks: React.Dispatch<React.SetStateAction<Set<string>>>;
  setVolumes: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setOriginalVolume: React.Dispatch<React.SetStateAction<number>>;
  setOriginalStems: React.Dispatch<React.SetStateAction<OriginalStemsState>>;
  setSelectedStemModel: React.Dispatch<React.SetStateAction<string>>;
  setFinalVerificationReport: React.Dispatch<React.SetStateAction<{
    totalSubs: number; voicedSubs: number; voicedByOtherDubberCount?: number;
    recoveredFromFixCount: number; recoveredFromOrigCount: number; realignedCount: number;
    physicsProtectedCount: number; iterationsRun: number; unvoicedSubs: MissingSubtitleMarker[]; passed: boolean;
  } | null>>;
  audioElementsRef: React.MutableRefObject<Record<string, HTMLAudioElement>>;
  audioBuffersRef: React.MutableRefObject<Record<string, AudioBuffer>>;
  trackFileSizesRef: React.MutableRefObject<Record<string, number>>;
  origBuffersByTrackRef: React.MutableRefObject<Record<string, { buffer: AudioBuffer; filePath?: string; sourceTrackId: string }>>;
  fixBuffersByActorRef: React.MutableRefObject<Record<string, Array<{ buffer: AudioBuffer; filePath?: string; sourceTrackId: string; participant: string }>>>;
  updateProcess: (title: string, detail: string, progress: number, stepCurrent?: number, stepTotal?: number) => void;
  clearProcess: () => void;
  addLog: (msg: string, level?: 'info' | 'success' | 'warn' | 'error') => void;
}) {

  const loadEpisodeData = useCallback(async (isImportFlow = false, forceReset = false) => {
    if (!currentEpisode) return;
    try {
      setIsLoading(true);
      if (!isImportFlow) {
        updateProcess(
          'Загрузка проекта тайминга',
          'Чтение субтитров серии...',
          5,
          1,
          5
        );
      }
      addLog(`=== Начало загрузки тайминга серии #${currentEpisode.number} (${currentEpisode.project?.title || 'Проект'}) ===`, 'info');

      // 1. Load Subtitles
      let parsedLines: SubtitleLine[] = [];
      const subPath = currentEpisode.subPath;
      if (subPath) {
        const subData = await ipcSafe.invoke('get-raw-subtitles', subPath).catch(() => null);
        if (subData && subData.lines) {
          parsedLines = subData.lines.map((l: any, idx: number) => ({
            id: `sub_${idx}`,
            rawLineIndex: l.rawLineIndex ?? idx,
            startSec: parseTimeToSeconds(l.start),
            endSec: parseTimeToSeconds(l.end),
            startFormatted: l.start || '00:00.00',
            endFormatted: l.end || '00:00.00',
            name: l.name || 'Default',
            text: l.text || '',
            style: l.style || 'Default'
          }));
          const maxSubTime = parsedLines.reduce((max, l) => Math.max(max, l.endSec), 10);
          setDuration(prev => Math.max(prev, maxSubTime + 10));
          addLog(`✓ Успешно распарсено ${parsedLines.length} строк субтитров.`, 'success');
        }
      }
      setRawSubtitles(parsedLines);

      // 1B. Load Original Video & Extract Original Audio Waveform Peaks
      if (currentEpisode.rawPath) {
        if (!isImportFlow) {
          updateProcess(
            'Подготовка оригинала серии',
            'Подключение видеопотока и извлечение вейвформы оригинала...',
            14,
            2,
            5
          );
        }
        const resolvedVideo = await getPlayableAudioUrl(currentEpisode.rawPath);
        if (resolvedVideo) {
          setVideoUrl(resolvedVideo);
          addLog(`🎬 Подключено оригинальное видео и аудио серии: ${currentEpisode.rawPath.split(/[/\\]/).pop()}`, 'success');
        }
        try {
          const peaksRes: any = await ipcSafe.invoke('extract-audio-peaks', {
            videoPath: currentEpisode.rawPath,
            filePath: currentEpisode.rawPath,
            pointsPerSecond: 25
          });
          const extractedPeaks = Array.isArray(peaksRes)
            ? peaksRes
            : (peaksRes && Array.isArray(peaksRes.peaks) ? peaksRes.peaks : []);
          if (extractedPeaks.length > 0) {
            setOriginalPeaks(extractedPeaks);
            if (peaksRes && typeof peaksRes.duration === 'number' && peaksRes.duration > 0) {
              setDuration(prev => Math.max(prev, peaksRes.duration));
            }
          } else if (resolvedVideo) {
            try {
              const resp = await fetch(resolvedVideo);
              const arr = await resp.arrayBuffer();
              const ctx = getSharedAudioContext();
              if (ctx) {
                const decoded = await ctx.decodeAudioData(arr);
                const ch = decoded.getChannelData(0);
                const ptsPerSec = 25;
                const totalPts = Math.max(100, Math.floor(decoded.duration * ptsPerSec));
                const samplesPerPt = Math.max(1, Math.floor(ch.length / totalPts));
                const webPeaks: number[] = [];
                for (let i = 0; i < totalPts; i++) {
                  const start = i * samplesPerPt;
                  const end = Math.min(ch.length, start + samplesPerPt);
                  let max = 0;
                  for (let j = start; j < end; j++) {
                    const v = Math.abs(ch[j]);
                    if (v > max) max = v;
                  }
                  webPeaks.push(max);
                }
                setOriginalPeaks(webPeaks);
                setDuration(prev => Math.max(prev, decoded.duration));
              }
            } catch (e) {}
          }
        } catch (e) {}
      } else {
        setVideoUrl(null);
        setOriginalPeaks([]);
      }

      if (!isImportFlow) {
        updateProcess(
          'Загрузка проекта тайминга',
          'Получение списка дорожек дабберов...',
          22,
          3,
          5
        );
      }

      // 1C. Check for Saved Timing State in <EpisodeDir>/Тайминг/timing_state.json
      if (!isImportFlow && !forceReset) {
        try {
          const savedStateRes: any = await ipcSafe.invoke('timing-load-state', { episode: currentEpisode }).catch(() => null);
          if (
            savedStateRes &&
            savedStateRes.exists &&
            savedStateRes.state &&
            Array.isArray(savedStateRes.state.tracks) &&
            savedStateRes.state.tracks.length > 0 &&
            savedStateRes.state.audioClips
          ) {
            const st = savedStateRes.state;
            addLog(`💾 Загружено сохраненное состояние тайминга из «${savedStateRes.timingDir || 'Тайминг'}» (${st.updatedAt ? new Date(st.updatedAt).toLocaleString('ru-RU') : ''}). Восстановление...`, 'info');
            updateProcess('Загрузка проекта тайминга', 'Восстановление сохраненного таймлайна и декодирование аудиоволн...', 25, 3, 5);

            const restoredTracks: Track[] = st.tracks;
            const catalogTracks: Track[] = Array.isArray(st.allCatalogTracks) && st.allCatalogTracks.length > 0
              ? st.allCatalogTracks
              : restoredTracks;

            allCatalogTracksRef.current = catalogTracks;
            setTracks(restoredTracks);
            setAudioClips(st.audioClips || {});
            if (st.trackSubLinesMap) setTrackSubLinesMap(st.trackSubLinesMap);
            setIsSilenceRemoved(Boolean(st.isSilenceRemoved));
            setIsFixesStitched(Boolean(st.isFixesStitched));
            setIsTimingAnalyzed(Boolean(st.isTimingAnalyzed));
            setCollisions(Array.isArray(st.collisions) ? st.collisions : []);
            setIntentionalOverlaps(Array.isArray(st.intentionalOverlaps) ? st.intentionalOverlaps : []);
            setTimingIssues(Array.isArray(st.timingIssues) ? st.timingIssues : []);
            setMissingSubtitles(Array.isArray(st.missingSubtitles) ? st.missingSubtitles : []);
            if (st.qaPassportLoaded) setQaPassportLoaded(st.qaPassportLoaded);
            if (st.finalVerificationReport) setFinalVerificationReport(st.finalVerificationReport);
            if (st.calibrationsByTrack) setCalibrationsByTrack(st.calibrationsByTrack);
            if (st.volumes) setVolumes(st.volumes);
            if (Array.isArray(st.mutedTracks)) setMutedTracks(new Set(st.mutedTracks));
            if (typeof st.originalVolume === 'number') setOriginalVolume(st.originalVolume);
            if (typeof st.isOriginalMuted === 'boolean') setIsOriginalMuted(st.isOriginalMuted);
            if (typeof st.originalWaveScale === 'number') handleChangeOriginalWaveScale(st.originalWaveScale);
            if (typeof st.isOriginalWaveNormalized === 'boolean') setIsOriginalWaveNormalized(st.isOriginalWaveNormalized);
            if (typeof st.originalTrackHeight === 'number') handleChangeOriginalTrackHeight(st.originalTrackHeight);
            if (typeof st.zoomLevel === 'number') setZoomLevel(st.zoomLevel);
            if (st.trackHeightMode) setTrackHeightMode(st.trackHeightMode);
            if (st.timingSettings) setTimingSettings(prev => ({ ...prev, ...st.timingSettings }));
            if (st.originalStems && typeof st.originalStems === 'object') {
              setOriginalStems(prev => ({
                ...prev,
                ...st.originalStems,
                isSeparating: false
              }));
              if (st.originalStems.modelId) setSelectedStemModel(st.originalStems.modelId);
            }

            setSavedTimingStateInfo({
              savedAt: st.updatedAt || new Date().toISOString(),
              filePath: savedStateRes.filePath
            });

            const computedNormMetrics = await decodeSavedStateAudioSources({
              catalogTracks,
              savedAudioClips: st.audioClips as Record<string, AudioClip[]>,
              setImportDecodedTracks,
              updateProcess,
              audioElementsRef,
              trackFileSizesRef,
              audioBuffersRef,
              fixBuffersByActorRef,
              origBuffersByTrackRef,
              setDuration
            });

            setNormalizationMetrics(computedNormMetrics);
            isStateRestoredRef.current = true;
            addLog(`✓ Состояние вкладки «Тайминг» успешно восстановлено из файла! Загружено ${restoredTracks.length} дорожек, клипов: ${Object.values(st.audioClips).flat().length}. Повторный автотайминг/нарезка не требуются.`, 'success');
            toast.success(`Тайминг серии успешно загружен из сохраненного файла («Тайминг»)! 💾`);
            return;
          }
        } catch (loadErr: any) {
          console.warn('[TimingState] Ошибка при автозагрузке сохраненного состояния:', loadErr);
        }
      }

      // 2. Fetch Dubber Tracks from Manifest or Sound Engineer Files
      const statusRes: any = await ipcSafe.invoke('mixing-get-status', { episode: currentEpisode }).catch(() => null);
      let manifestDubberTracks = statusRes?.manifest?.sourceFiles?.dubberTracks || [];

      if (manifestDubberTracks.length === 0) {
        updateProcess(
          'Сборка дорожек из QA',
          'Экспорт и сборка файлов звукорежиссера из QA...',
          28,
          3,
          5
        );
        const importRes: any = await ipcSafe.invoke('mixing-import-sound-engineer-files', {
          episode: currentEpisode,
          autoApplyFixes: false,
          autoTiming: false
        }).catch(() => null);

        if (importRes?.manifest?.sourceFiles?.dubberTracks) {
          manifestDubberTracks = importRes.manifest.sourceFiles.dubberTracks;
        }
      }

      const cleanManifestTracks = manifestDubberTracks.filter((dt: any) => {
        const p = dt.path || '';
        const base = p.split(/[/\\]/).pop() || '';
        if (base.toLowerCase().includes('slice') || base.toLowerCase().includes('temp_') || base.toLowerCase().includes('snippet')) {
          return false;
        }
        if (/^(0[1-9]|1[0-9])_(denoise|deepfilter|glue|compress|master|video_mux|eq|limiter|reverb|delay|mix)/i.test(base) || /^[\d\s._-]+$/.test(base.replace(/\.[^.]+$/, ''))) {
          return false;
        }
        if (/master|glue|denoise|deepfilter|mix|compress|release|original_audio/i.test(base)) {
          return false;
        }
        const nick = (dt.dubberNick || '').trim();
        if (!nick || /^[\d\s._-]+$/.test(nick)) {
          return false;
        }
        return true;
      });

      const rawFetched = prepareQATracksForTiming(currentEpisode, cleanManifestTracks);
      const fetchedTracks: Track[] = [];
      for (const tr of rawFetched) {
        fetchedTracks.push(tr);
        const snippets: any[] = (tr as any).patchSnippets && (tr as any).patchSnippets.length > 0
          ? (tr as any).patchSnippets
          : ((tr as any).patchSnippet && (tr as any).patchSnippet.path ? [(tr as any).patchSnippet] : []);

        snippets.forEach((snip, sIdx) => {
          if (!snip || !snip.path) return;
          const fixNum = snip.trackIndex || (sIdx + 1);
          const fixId = snippets.length > 1 ? `${tr.id}_fix_${fixNum}` : `${tr.id}_fix`;
          const fixLabel = snippets.length > 1 ? `${tr.participant} (Фикс ${fixNum})` : `${tr.participant} (Фикс)`;
          fetchedTracks.push({
            id: fixId,
            targetMainTrackId: tr.id,
            subTrackIndex: fixNum,
            projectId: tr.projectId,
            episodeId: tr.episodeId,
            participant: fixLabel,
            character: tr.character,
            dubberName: tr.dubberName,
            characterName: tr.characterName,
            filePath: snip.path,
            role: 'fix',
            status: 'fixes_needed',
            files: [{ id: snip.id || `${fixId}_file`, path: snip.path, createdAt: '', type: 'FIXES', isFix: true, targetTrackId: tr.id }],
            selectedFileId: snip.id || `${fixId}_file`,
            comments: tr.comments || []
          } as any);
        });
      }

      setTracks(fetchedTracks);
      addLog(`Загружено ${fetchedTracks.length} уникальных мастер-дорожек дабберов (без дублирования и с приоритетом чистовых фиксов).`, fetchedTracks.length > 0 ? 'success' : 'warn');

      // 3. Decode Real AudioBuffers & Calculate QA Auto-Normalization
      const computedNormMetrics = await decodeFetchedTracksAudioBuffers({
        fetchedTracks,
        isImportFlow,
        setImportDecodedTracks,
        updateProcess,
        audioElementsRef,
        trackFileSizesRef,
        audioBuffersRef,
        fixBuffersByActorRef,
        origBuffersByTrackRef,
        setDuration,
        addLog
      });

      setNormalizationMetrics(computedNormMetrics);

      updateProcess(
        'Формирование таймлайна',
        'Привязка субтитров и проверка паспорта QA...',
        95,
        5,
        5
      );

      // 4. Map Subtitles and Initialize Initial Audio Clips
      const { initialClips, trackSubMap } = mapSubtitlesAndBuildInitialClips({
        currentEpisode,
        fetchedTracks,
        parsedLines,
        audioBuffersRef,
        addLog
      });

      setTrackSubLinesMap(trackSubMap);
      setAudioClips(initialClips);

      try {
        const savedProject = await loadTimingProjectForEpisode(currentEpisode, fetchedTracks);
        if (savedProject && (
          (savedProject.collisions && savedProject.collisions.length > 0) ||
          (savedProject.timingIssues && savedProject.timingIssues.length > 0) ||
          (savedProject.missingSubtitles && savedProject.missingSubtitles.length > 0)
        )) {
          savedPassportRef.current = savedProject;
          setCollisions(savedProject.collisions || []);
          setTimingIssues(savedProject.timingIssues || []);
          setMissingSubtitles(savedProject.missingSubtitles || []);
          setIsTimingAnalyzed(true);
          setIsIssuesDrawerOpen((savedProject.timingIssues?.length || 0) > 0);

          const markedClips = applyTimingPassportToClips(initialClips, savedProject);
          setAudioClips(markedClips);

          setQaPassportLoaded({
            loaded: true,
            summary: savedProject.summary,
            savedAt: savedProject.savedAt
          });

          addLog(
            `📋 Подхвачен паспорт QA проверки! Замечаний: ${savedProject.summary.totalGaps} (наездов: ${savedProject.summary.overlapsCount}, коллизий: ${savedProject.summary.collisionsCount}, рассинхронов: ${savedProject.summary.desyncCount}, пропусков: ${savedProject.summary.missingCount}). Повторная перепроверка не требуется!`,
            'success'
          );
        }
      } catch (passportErr) {
        console.warn('Failed to auto-load QA timing passport:', passportErr);
      }

      allCatalogTracksRef.current = fetchedTracks;
      isStateRestoredRef.current = true;

      try {
        const freshStatePayload = {
          tracks: fetchedTracks,
          allCatalogTracks: fetchedTracks,
          audioClips: initialClips,
          trackSubLinesMap: trackSubMap,
          isSilenceRemoved: false,
          isFixesStitched: false,
          isTimingAnalyzed: false,
          collisions: [],
          intentionalOverlaps: [],
          timingIssues: [],
          missingSubtitles: [],
          calibrationsByTrack: {},
          volumes: {},
          mutedTracks: [],
          originalVolume: 0.4,
          isOriginalMuted: false,
          zoomLevel: 30,
          trackHeightMode: 'standard',
          timingSettings
        };
        const saveRes: any = await ipcSafe.invoke('timing-save-state', {
          episode: currentEpisode,
          state: freshStatePayload
        });
        if (saveRes?.success) {
          setSavedTimingStateInfo({
            savedAt: saveRes.updatedAt || new Date().toISOString(),
            filePath: saveRes.filePath
          });
          addLog(`💾 Состояние тайминга инициализировано и сохранено в папку «${saveRes.timingDir || 'Тайминг'}» серии.`, 'info');
        }
      } catch (saveErr) {
        console.warn('Initial timing state save warning:', saveErr);
      }

      if (fetchedTracks.length > 0) {
        toast.success(`Загружено ${fetchedTracks.length} дорожек дабберов с реальными аудиоволнами и сохранено в «Тайминг»!`);
      }
    } catch (err: any) {
      addLog(`❌ Ошибка загрузки данных тайминга: ${err.message || String(err)}`, 'error');
      toast.error(`Ошибка загрузки: ${err.message || String(err)}`);
    } finally {
      setIsLoading(false);
      if (!isImportFlow) {
        clearProcess();
      }
    }
  }, [currentEpisode, addLog, updateProcess, clearProcess]);

  useEffect(() => {
    loadEpisodeData();
  }, [currentEpisode?.id]);

  return {
    loadEpisodeData
  };
}
