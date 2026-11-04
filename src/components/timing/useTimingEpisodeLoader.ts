import React, { useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Episode, Track, SubtitleLine } from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';
import { getSharedAudioContext } from '../../lib/qa/sharedAudioContext';
import { analyzeAudioBufferForPreview, analyzeAudioForPreview, NormalizationMetrics } from '../../lib/qa/audioNormalizer';
import { prepareQATracksForTiming } from '../../lib/qaTimingHelper';
import { loadTimingProjectForEpisode, applyTimingPassportToClips, TimingProjectData } from '../../lib/qa/timingSyncService';
import { TimingSettings } from '../TimingSettingsModal';
import { AudioClip, VoiceCollisionMarker, IntentionalOverlapMoment, TimingIssue, MissingSubtitleMarker, NoiseCalibration, OriginalStemsState } from './timing.types';
import { isFixTrack, parseTimeToSeconds, normalizeName, isSubtitleForCharacter, getPlayableAudioUrl } from './timing.utils';
import { detectSpeechIntervals } from './timing.dsp';

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

            const sharedAudioCtx = getSharedAudioContext();
            const sourcesToDecode = new Map<string, { id: string; filePath: string; participant: string; isFix?: boolean; dubberName?: string }>();

            catalogTracks.forEach(t => {
              if (t.filePath) {
                sourcesToDecode.set(t.id, {
                  id: t.id,
                  filePath: t.filePath,
                  participant: t.participant,
                  isFix: isFixTrack(t),
                  dubberName: t.dubberName
                });
              }
            });

            Object.values(st.audioClips as Record<string, AudioClip[]>).forEach(cList => {
              (cList || []).forEach(c => {
                if (c.sourceAudioTrackId && c.sourceAudioPath && !sourcesToDecode.has(c.sourceAudioTrackId)) {
                  sourcesToDecode.set(c.sourceAudioTrackId, {
                    id: c.sourceAudioTrackId,
                    filePath: c.sourceAudioPath,
                    participant: `${c.dubberName || 'Даббер'} (${c.isFix ? 'Фикс' : 'Аудио'})`,
                    isFix: Boolean(c.isFix),
                    dubberName: c.dubberName
                  });
                }
              });
            });

            const decodeList = Array.from(sourcesToDecode.values());
            setImportDecodedTracks(decodeList.map(t => ({ id: t.id, name: t.participant, status: 'pending' })));

            const computedNormMetrics: Record<string, NormalizationMetrics> = {};
            let dIdx = 0;
            for (const item of decodeList) {
              dIdx++;
              const curPct = Math.round(30 + (65 * dIdx / Math.max(1, decodeList.length)));
              updateProcess('Восстановление тайминга', `Декодирование аудиоволн [${dIdx}/${decodeList.length}]: «${item.participant}» (${curPct}%)...`, curPct, dIdx, decodeList.length);

              setImportDecodedTracks(prev => prev.map(p => p.id === item.id ? { ...p, status: 'decoding' } : p));
              const playableUrl = await getPlayableAudioUrl(item.filePath);
              if (playableUrl) {
                const audio = new Audio(playableUrl);
                audio.preload = 'metadata';
                audioElementsRef.current[item.id] = audio;

                try {
                  const resp = await fetch(playableUrl);
                  const arrayBuf = await resp.arrayBuffer();
                  const fileByteLength = arrayBuf.byteLength || 0;
                  trackFileSizesRef.current[item.id] = fileByteLength;

                  if (sharedAudioCtx) {
                    const decodedBuf = await sharedAudioCtx.decodeAudioData(arrayBuf);
                    audioBuffersRef.current[item.id] = decodedBuf;

                    if (item.isFix) {
                      const actorNorm = normalizeName(item.dubberName || item.participant || 'Даббер');
                      if (!fixBuffersByActorRef.current[actorNorm]) fixBuffersByActorRef.current[actorNorm] = [];
                      const existingIdx = fixBuffersByActorRef.current[actorNorm].findIndex(f => f.sourceTrackId === item.id);
                      const fEntry = { buffer: decodedBuf, filePath: item.filePath, sourceTrackId: item.id, participant: item.participant };
                      if (existingIdx >= 0) fixBuffersByActorRef.current[actorNorm][existingIdx] = fEntry;
                      else fixBuffersByActorRef.current[actorNorm].push(fEntry);
                    } else {
                      const origKey = `orig_${item.id}`;
                      audioBuffersRef.current[origKey] = decodedBuf;
                      origBuffersByTrackRef.current[item.id] = { buffer: decodedBuf, filePath: item.filePath, sourceTrackId: origKey };
                    }

                    setDuration(prev => Math.max(prev, decodedBuf.duration));
                    const norm = analyzeAudioBufferForPreview(decodedBuf, item.id);
                    computedNormMetrics[item.id] = norm;
                    setImportDecodedTracks(prev => prev.map(p => p.id === item.id ? { ...p, status: 'done', duration: decodedBuf.duration } : p));
                  }
                } catch (decodeErr) {
                  console.warn(`[AudioDecode] Не удалось декодировать ${item.id}:`, decodeErr);
                  setImportDecodedTracks(prev => prev.map(p => p.id === item.id ? { ...p, status: 'error' } : p));
                }
              }
            }

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
      const sharedAudioCtx = getSharedAudioContext();
      const tracksToDecode = fetchedTracks.filter(t => t.filePath);
      const computedNormMetrics: Record<string, NormalizationMetrics> = {};

      setImportDecodedTracks(tracksToDecode.map(t => ({
        id: t.id,
        name: t.participant,
        status: 'pending'
      })));

      let decodedIdx = 0;
      for (const tr of fetchedTracks) {
        if (tr.filePath) {
          decodedIdx++;
          const startPct = isImportFlow ? 45 : 30;
          const pctSpan = isImportFlow ? 45 : 58;
          const curPct = Math.round(startPct + (pctSpan * decodedIdx / Math.max(1, tracksToDecode.length)));
          updateProcess(
            'Декодирование аудиоволн и нормализация',
            `Декодирование [${decodedIdx}/${tracksToDecode.length}]: «${tr.participant}» (${curPct}%)...`,
            curPct,
            decodedIdx,
            tracksToDecode.length
          );

          setImportDecodedTracks(prev => prev.map(item =>
            item.id === tr.id ? { ...item, status: 'decoding' } : item
          ));

          const playableUrl = await getPlayableAudioUrl(tr.filePath);
          if (playableUrl) {
            const audio = new Audio(playableUrl);
            audio.preload = 'metadata';
            audioElementsRef.current[tr.id] = audio;

            try {
              const resp = await fetch(playableUrl);
              const arrayBuf = await resp.arrayBuffer();
              const fileByteLength = arrayBuf.byteLength || tr.fileSize || (tr.files?.[0]?.size) || 0;
              trackFileSizesRef.current[tr.id] = fileByteLength;
              if (sharedAudioCtx) {
                const decodedBuf = await sharedAudioCtx.decodeAudioData(arrayBuf);
                audioBuffersRef.current[tr.id] = decodedBuf;
                if (isFixTrack(tr)) {
                  const actorNorm = normalizeName(tr.dubberName || tr.participant || 'Даббер');
                  if (!fixBuffersByActorRef.current[actorNorm]) {
                    fixBuffersByActorRef.current[actorNorm] = [];
                  }
                  const existingIdx = fixBuffersByActorRef.current[actorNorm].findIndex(f => f.sourceTrackId === tr.id);
                  const entry = {
                    buffer: decodedBuf,
                    filePath: tr.filePath,
                    sourceTrackId: tr.id,
                    participant: tr.participant || tr.dubberName || 'Фикс'
                  };
                  if (existingIdx >= 0) fixBuffersByActorRef.current[actorNorm][existingIdx] = entry;
                  else fixBuffersByActorRef.current[actorNorm].push(entry);
                } else {
                  const origKey = `orig_${tr.id}`;
                  audioBuffersRef.current[origKey] = decodedBuf;
                  origBuffersByTrackRef.current[tr.id] = {
                    buffer: decodedBuf,
                    filePath: tr.filePath,
                    sourceTrackId: origKey
                  };
                }

                setDuration(prev => Math.max(prev, decodedBuf.duration));
                const norm = analyzeAudioBufferForPreview(decodedBuf, tr.id);
                computedNormMetrics[tr.id] = norm;
                addLog(`📈 Аудиоволна декодирована для «${tr.participant}» (${decodedBuf.duration.toFixed(1)}s, ${(fileByteLength / (1024 * 1024)).toFixed(1)} МБ, норм.: ${norm.gainDb >= 0 ? '+' : ''}${norm.gainDb} dB)`, 'success');
                setImportDecodedTracks(prev => prev.map(item =>
                  item.id === tr.id ? { ...item, status: 'done', duration: decodedBuf.duration } : item
                ));
              }
            } catch (decodeErr) {
              console.warn(`[AudioDecode] Не удалось декодировать аудио для ${tr.id}:`, decodeErr);
              try {
                const fallbackNorm = await analyzeAudioForPreview(playableUrl, tr.id, tr.filePath);
                computedNormMetrics[tr.id] = fallbackNorm;
              } catch (e) {}
              setImportDecodedTracks(prev => prev.map(item =>
                item.id === tr.id ? { ...item, status: 'error' } : item
              ));
            }
          }
        }
      }

      for (const fixTr of fetchedTracks.filter(t => isFixTrack(t))) {
        const mainTr = fetchedTracks.find(t => !isFixTrack(t) && (t.id === (fixTr as any).targetMainTrackId || t.id === fixTr.id.replace(/_fix$/, '') || normalizeName(t.dubberName) === normalizeName(fixTr.dubberName)));
        if (!mainTr) continue;
        const fixBuf = audioBuffersRef.current[fixTr.id];
        const mainBuf = audioBuffersRef.current[mainTr.id];

        if (fixBuf && mainBuf) {
          const fixIvs = detectSpeechIntervals(fixBuf);
          const mainIvs = detectSpeechIntervals(mainBuf);
          addLog(
            `🛠 Дорожка фикса «${fixTr.participant}» подготовлена (${fixIvs.length} речевых фраз в фиксе vs ${mainIvs.length} в основной дорожке) — готова к операции «Вшить фиксы».`,
            'info'
          );
        }
      }

      setNormalizationMetrics(computedNormMetrics);

      updateProcess(
        'Формирование таймлайна',
        'Привязка субтитров и проверка паспорта QA...',
        95,
        5,
        5
      );

      // 4. Map Subtitles and Initialize Initial Audio Clips
      const initialClips: Record<string, AudioClip[]> = {};
      const trackSubMap: Record<string, SubtitleLine[]> = {};

      const tracksByActor: Record<string, Track[]> = {};
      fetchedTracks.forEach(tr => {
        const actorKey = tr.dubberName || 'Даббер';
        if (!tracksByActor[actorKey]) tracksByActor[actorKey] = [];
        tracksByActor[actorKey].push(tr);
      });

      const projectAliases = currentEpisode.project?.characterAliases
        ? (typeof currentEpisode.project.characterAliases === 'string'
            ? JSON.parse(currentEpisode.project.characterAliases || '{}')
            : currentEpisode.project.characterAliases)
        : undefined;

      const allMappedSubIds = new Set<string>();

      Object.entries(tracksByActor).forEach(([actorNick, actorTrks]) => {
        const firstTrk = actorTrks[0];
        const charName = firstTrk.character || firstTrk.characterName || 'Персонаж';

        let matchedLines = parsedLines.filter(line =>
          isSubtitleForCharacter(line.name, charName, actorNick, currentEpisode.assignments || [], line.style, projectAliases)
        ).sort((a, b) => a.startSec - b.startSec);

        if (matchedLines.length === 0 && (charName !== 'Персонаж' || actorNick !== 'Даббер')) {
          const normC = normalizeName(charName);
          const normD = normalizeName(actorNick);
          matchedLines = parsedLines.filter(line => {
            const normSub = normalizeName(line.name);
            const normStyle = normalizeName(line.style);
            return (normC && (normSub === normC || normSub.includes(normC) || normStyle === normC || normStyle.includes(normC))) ||
                   (normD && (normSub === normD || normSub.includes(normD) || normStyle === normD || normStyle.includes(normD)));
          }).sort((a, b) => a.startSec - b.startSec);
        }

        matchedLines.forEach(l => allMappedSubIds.add(String(l.id)));

        const mainTracks = actorTrks.filter(t => !isFixTrack(t));
        const fixTracks = actorTrks.filter(t => isFixTrack(t));

        if (mainTracks.length >= 2) {
          const primaryLines: SubtitleLine[] = [];
          const overlapLines: SubtitleLine[] = [];

          matchedLines.forEach((line) => {
            const prevPrimary = primaryLines[primaryLines.length - 1];
            if (prevPrimary && line.startSec < prevPrimary.endSec) {
              overlapLines.push(line);
            } else {
              primaryLines.push(line);
            }
          });

          trackSubMap[mainTracks[0].id] = primaryLines;
          trackSubMap[mainTracks[1].id] = overlapLines;
        } else if (mainTracks.length === 1) {
          trackSubMap[mainTracks[0].id] = matchedLines;
        } else if (mainTracks.length === 0 && fixTracks.length > 0) {
          fixTracks.forEach(fx => {
            trackSubMap[fx.id] = [...matchedLines];
          });
        }

        if (fixTracks.length > 0 && mainTracks.length > 0) {
          const actorAssigns = (currentEpisode.assignments || []).filter(a => {
            const aNick = a.substitute?.nickname || a.dubber?.nickname || '';
            return normalizeName(aNick) === normalizeName(actorNick);
          });
          const commentTimestamps: number[] = [];
          actorAssigns.forEach(a => {
            if (a.comments) {
              try {
                const parsedComments = JSON.parse(a.comments);
                if (Array.isArray(parsedComments)) {
                  parsedComments.forEach(c => {
                    if (typeof c.timestamp === 'number') commentTimestamps.push(c.timestamp);
                  });
                }
              } catch (e) {}
            }
          });

          let candidateFixLines = commentTimestamps.length > 0
            ? matchedLines.filter(l => commentTimestamps.some(ts => Math.abs(l.startSec - ts) < 3.5 || (ts >= l.startSec && ts <= l.endSec)))
            : [];

          if (candidateFixLines.length === 0) {
            candidateFixLines = matchedLines.slice(0, Math.min(3, matchedLines.length));
          }

          fixTracks.forEach(fx => {
            trackSubMap[fx.id] = candidateFixLines.length > 0 ? [...candidateFixLines] : [...matchedLines];
          });
        }
      });

      const unmatchedDialogueLines = parsedLines.filter(l => {
        if (allMappedSubIds.has(String(l.id))) return false;
        const normName = normalizeName(l.name);
        const normStyle = normalizeName(l.style);
        return !['sign', 'text', 'title', 'signs', 'titles', 'надпись', 'титры', 'заставка', 'note', 'info'].some(k => normName.includes(k) || normStyle.includes(k));
      });

      if (unmatchedDialogueLines.length > 0 && fetchedTracks.length > 0) {
        unmatchedDialogueLines.forEach(l => {
          const normLName = normalizeName(l.name);
          const normLStyle = normalizeName(l.style);
          let targetTrack = fetchedTracks.find(t => {
            const trChar = normalizeName(t.character || t.characterName || '');
            const trNick = normalizeName(t.participant || t.dubberName || '');
            return (normLName && (trChar.includes(normLName) || normLName.includes(trChar) || trNick.includes(normLName) || normLName.includes(trNick))) ||
                   (normLStyle && (trChar.includes(normLStyle) || normLStyle.includes(trChar)));
          });

          if (!targetTrack) {
            targetTrack = fetchedTracks[0];
          }

          if (targetTrack) {
            if (!trackSubMap[targetTrack.id]) trackSubMap[targetTrack.id] = [];
            trackSubMap[targetTrack.id].push(l);
            trackSubMap[targetTrack.id].sort((a, b) => a.startSec - b.startSec);
            allMappedSubIds.add(String(l.id));
          }
        });
      }

      addLog(`✓ Привязано ${allMappedSubIds.size} из ${parsedLines.length} строк субтитров к дорожкам актеров.`, 'success');

      fetchedTracks.forEach(tr => {
        const charName = tr.character || tr.characterName || 'Персонаж';
        const dubberName = tr.participant || tr.dubberName || 'Даббер';
        const trSubs = trackSubMap[tr.id] || [];
        const trackBuf = audioBuffersRef.current[tr.id];
        const trackDur = trackBuf ? trackBuf.duration : (trSubs[trSubs.length - 1]?.endSec || 100);

        initialClips[tr.id] = [{
          id: `clip_${tr.id}_full`,
          trackId: tr.id,
          dubberName,
          characterName: charName,
          clipStartSec: 0,
          durationSec: trackDur,
          sourceStartSec: 0,
          sourceEndSec: trackDur,
          text: `Полная запись: ${dubberName}`,
          volumePercent: 100,
          isFix: isFixTrack(tr),
          hasCollision: false,
          offsetSec: 0
        }];
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
