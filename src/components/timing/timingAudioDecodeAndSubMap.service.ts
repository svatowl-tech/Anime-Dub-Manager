import React from 'react';
import { Episode, Track, SubtitleLine } from '../../types';
import { getSharedAudioContext } from '../../lib/qa/sharedAudioContext';
import { analyzeAudioBufferForPreview, analyzeAudioForPreview, NormalizationMetrics } from '../../lib/qa/audioNormalizer';
import { AudioClip } from './timing.types';
import { isFixTrack, normalizeName, isSubtitleForCharacter, getPlayableAudioUrl } from './timing.utils';
import { detectSpeechIntervals } from './timing.dsp';

export async function decodeSavedStateAudioSources({
  catalogTracks,
  savedAudioClips,
  setImportDecodedTracks,
  updateProcess,
  audioElementsRef,
  trackFileSizesRef,
  audioBuffersRef,
  fixBuffersByActorRef,
  origBuffersByTrackRef,
  setDuration
}: {
  catalogTracks: Track[];
  savedAudioClips: Record<string, AudioClip[]>;
  setImportDecodedTracks: React.Dispatch<React.SetStateAction<Array<{ id: string; name: string; duration?: number; status: 'pending' | 'decoding' | 'done' | 'error' }>>>;
  updateProcess: (title: string, detail: string, progress: number, stepCurrent?: number, stepTotal?: number) => void;
  audioElementsRef: React.MutableRefObject<Record<string, HTMLAudioElement>>;
  trackFileSizesRef: React.MutableRefObject<Record<string, number>>;
  audioBuffersRef: React.MutableRefObject<Record<string, AudioBuffer>>;
  fixBuffersByActorRef: React.MutableRefObject<Record<string, Array<{ buffer: AudioBuffer; filePath?: string; sourceTrackId: string; participant: string }>>>;
  origBuffersByTrackRef: React.MutableRefObject<Record<string, { buffer: AudioBuffer; filePath?: string; sourceTrackId: string }>>;
  setDuration: React.Dispatch<React.SetStateAction<number>>;
}): Promise<Record<string, NormalizationMetrics>> {
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

  Object.values(savedAudioClips || {}).forEach(cList => {
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

  return computedNormMetrics;
}

export async function decodeFetchedTracksAudioBuffers({
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
}: {
  fetchedTracks: Track[];
  isImportFlow: boolean;
  setImportDecodedTracks: React.Dispatch<React.SetStateAction<Array<{ id: string; name: string; duration?: number; status: 'pending' | 'decoding' | 'done' | 'error' }>>>;
  updateProcess: (title: string, detail: string, progress: number, stepCurrent?: number, stepTotal?: number) => void;
  audioElementsRef: React.MutableRefObject<Record<string, HTMLAudioElement>>;
  trackFileSizesRef: React.MutableRefObject<Record<string, number>>;
  audioBuffersRef: React.MutableRefObject<Record<string, AudioBuffer>>;
  fixBuffersByActorRef: React.MutableRefObject<Record<string, Array<{ buffer: AudioBuffer; filePath?: string; sourceTrackId: string; participant: string }>>>;
  origBuffersByTrackRef: React.MutableRefObject<Record<string, { buffer: AudioBuffer; filePath?: string; sourceTrackId: string }>>;
  setDuration: React.Dispatch<React.SetStateAction<number>>;
  addLog: (msg: string, level?: 'info' | 'success' | 'warn' | 'error') => void;
}): Promise<Record<string, NormalizationMetrics>> {
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

  return computedNormMetrics;
}

export function mapSubtitlesAndBuildInitialClips({
  currentEpisode,
  fetchedTracks,
  parsedLines,
  audioBuffersRef,
  addLog
}: {
  currentEpisode: Episode;
  fetchedTracks: Track[];
  parsedLines: SubtitleLine[];
  audioBuffersRef: React.MutableRefObject<Record<string, AudioBuffer>>;
  addLog: (msg: string, level?: 'info' | 'success' | 'warn' | 'error') => void;
}): {
  initialClips: Record<string, AudioClip[]>;
  trackSubMap: Record<string, SubtitleLine[]>;
} {
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

  return { initialClips, trackSubMap };
}
