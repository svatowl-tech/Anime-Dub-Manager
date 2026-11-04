import type React from 'react';
import { toast } from 'sonner';
import { Track, SubtitleLine } from '../../types';
import { normalizeSpeechText } from '../../lib/qa/whisperTextChecker';
import { TimingSettings } from '../TimingSettingsModal';
import {
  AudioClip,
  IntentionalOverlapMoment,
  IntentionalOverlapTrackEntry,
  MissingSubtitleMarker,
  TimingIssue,
  VoiceCollisionMarker,
} from './timing.types';
import {
  formatSeconds,
  normalizeName,
} from './timing.utils';
import {
  detectSpeechOnsetOffsetSec,
} from './timing.dsp';
import { runStage1Pass1And2Engine } from './timing.stage1Pass1And2.engine';

export interface UseTimingStage1AnalysisParams {
  tracks: Track[];
  audioClips: Record<string, AudioClip[]>;
  trackSubLinesMap: Record<string, SubtitleLine[]>;
  subtitles: SubtitleLine[];
  isSilenceRemoved: boolean;
  timingSettings: TimingSettings;
  intentionalOverlaps: IntentionalOverlapMoment[];
  audioBuffersRef: React.MutableRefObject<Record<string, AudioBuffer>>;
  setAudioClips: React.Dispatch<React.SetStateAction<Record<string, AudioClip[]>>>;
  setTimingIssues: React.Dispatch<React.SetStateAction<TimingIssue[]>>;
  setMissingSubtitles: React.Dispatch<React.SetStateAction<MissingSubtitleMarker[]>>;
  setCollisions: React.Dispatch<React.SetStateAction<VoiceCollisionMarker[]>>;
  setIntentionalOverlaps: React.Dispatch<React.SetStateAction<IntentionalOverlapMoment[]>>;
  setIsSilenceRemoved: React.Dispatch<React.SetStateAction<boolean>>;
  setIsTimingAnalyzed: React.Dispatch<React.SetStateAction<boolean>>;
  setIsIssuesDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  updateProcess: (title: string, detail: string, progress: number, stepCurrent?: number, stepTotal?: number) => void;
  clearProcess: () => void;
  addLog: (msg: string, level?: 'info' | 'success' | 'warn' | 'error') => void;
}

export function useTimingStage1Analysis({
  tracks,
  audioClips,
  trackSubLinesMap,
  subtitles,
  isSilenceRemoved,
  timingSettings,
  intentionalOverlaps,
  audioBuffersRef,
  setAudioClips,
  setTimingIssues,
  setMissingSubtitles,
  setCollisions,
  setIntentionalOverlaps,
  setIsSilenceRemoved,
  setIsTimingAnalyzed,
  setIsIssuesDrawerOpen,
  setIsLoading,
  updateProcess,
  clearProcess,
  addLog,
}: UseTimingStage1AnalysisParams) {
  // ---------------------------------------------------------------------------
  // PIPELINE STEP 5 — TWO-STAGE AUTO-TIMING & TARGETED DIAGNOSTICS
  // ---------------------------------------------------------------------------
  const handleAnalyzeTiming = async () => {
    if (tracks.length === 0) return;
    try {
      setIsLoading(true);
      updateProcess('1. Анализ проблем (Whisper)', 'Подготовка речевых интервалов и поиск проблем...', 8, 1, 4);
      addLog('Запуск Этапа 1: глубокий анализ наездов, рассинхронов и пропущенных реплик...', 'info');

      const {
        updatedClips,
        newIssues,
        newMissingMarkers,
        totalPhysicsDetected,
        totalMultiSubClips,
        crossDubberCoveredCount,
      } = await runStage1Pass1And2Engine({
        tracks,
        audioClips,
        trackSubLinesMap,
        isSilenceRemoved,
        timingSettings,
        audioBuffersRef,
        setIsSilenceRemoved,
        updateProcess,
        addLog,
      });

      const newCollisions: VoiceCollisionMarker[] = [];

      updateProcess('1. Анализ проблем (Whisper)', 'Анализ наездов, синхрон унисонов по пику и ролей -10 дБ...', 88, 4, 4);
      await new Promise(r => setTimeout(r, 0));

      // Pass 3: Overlaps / Collisions
      for (const track of tracks) {
        const clips = updatedClips[track.id] || [];
        const sorted = [...clips].sort((a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0)));

        for (let i = 0; i < sorted.length - 1; i++) {
          const c1 = sorted[i];
          const c2 = sorted[i + 1];
          const c1End = (c1.clipStartSec + (c1.offsetSec || 0)) + c1.durationSec;
          const c2Start = c2.clipStartSec + (c2.offsetSec || 0);

          if (c1End > c2Start + 0.03) {
            const overlapDur = c1End - c2Start;
            c1.timingIssue = 'overlap';
            c2.timingIssue = 'overlap';
            c1.hasCollision = true;
            c2.hasCollision = true;
            c2.overlappingClipId = c1.id;
            c1.overlappingClipId = c2.id;

            newIssues.push({
              id: `issue_overlap_intra_${c1.id}_${c2.id}`,
              type: 'overlap',
              trackId: track.id,
              dubberName: c1.dubberName,
              characterName: c1.characterName,
              clipId: c2.id,
              timeSec: c2Start,
              durationSec: overlapDur,
              overlapDurationSec: Number(overlapDur.toFixed(2)),
              overlappingClipId: c1.id,
              description: `Наезд внутри дорожки «${c1.dubberName}» (${overlapDur.toFixed(2)}с): «${c1.text.slice(0, 15)}» 💥 «${c2.text.slice(0, 15)}»`
            });
          }
        }
      }

      // 3B. Inter-track analysis between different dubbers:
      // - Unison / Mass phrases: align by vocal onset peak (detectSpeechOnsetOffsetSec)
      // - Simultaneous overlapping subtitles (>= 0.45s): stamp overlapGroupId & Main (0 dB) / Secondary (-10 dB) role
      // - Sequential tail overlaps (< 0.45s sub overlap): flag as collision ('overlap') so "Исправить" separates them cleanly
      const trackIds = Object.keys(updatedClips);
      const detectedIntentionalOverlapsMap = new Map<string, IntentionalOverlapMoment>();
      const existingPriorityById: Record<string, string | null> = {};
      intentionalOverlaps.forEach(ov => {
        if (ov.id && ov.priorityTrackKey) existingPriorityById[ov.id] = ov.priorityTrackKey;
      });
      let unisonSyncedCount = 0;

      const findSubForClip = (trId: string, clip: AudioClip) => {
        if (clip.isPhysics) return undefined;
        const list = trackSubLinesMap[trId] || [];
        if (clip.matchedSubId) {
          const byId = list.find(s => String(s.id) === clip.matchedSubId);
          if (byId) return byId;
        }
        return list.find(s =>
          s.text === clip.text ||
          (typeof clip.targetSubStartSec === 'number' && Math.abs(s.startSec - clip.targetSubStartSec) < 0.25)
        );
      };

      for (let i = 0; i < trackIds.length; i++) {
        for (let j = i + 1; j < trackIds.length; j++) {
          const tr1Clips = updatedClips[trackIds[i]] || [];
          const tr2Clips = updatedClips[trackIds[j]] || [];
          for (let idx1 = 0; idx1 < tr1Clips.length; idx1++) {
            const c1 = tr1Clips[idx1];
            if (c1.isPhysics) continue;
            const sub1 = findSubForClip(trackIds[i], c1);
            if (!sub1) continue;
            for (let idx2 = 0; idx2 < tr2Clips.length; idx2++) {
              const c2 = tr2Clips[idx2];
              if (c2.isPhysics) continue;
              const sub2 = findSubForClip(trackIds[j], c2);
              if (!sub2) continue;

              const normT1 = normalizeSpeechText(sub1.text);
              const normT2 = normalizeSpeechText(sub2.text);
              const isSameSubPhrase =
                (sub1.id !== undefined && sub2.id !== undefined && String(sub1.id) === String(sub2.id)) ||
                (normT1 !== '' && normT1 === normT2 && Math.abs(sub1.startSec - sub2.startSec) <= 0.08);

              if (isSameSubPhrase) {
                const buf1 = audioBuffersRef.current[c1.sourceAudioTrackId || trackIds[i]];
                const buf2 = audioBuffersRef.current[c2.sourceAudioTrackId || trackIds[j]];
                const onset1 = detectSpeechOnsetOffsetSec(buf1, c1.sourceStartSec, c1.sourceEndSec);
                const onset2 = detectSpeechOnsetOffsetSec(buf2, c2.sourceStartSec, c2.sourceEndSec);
                c1.speechOnsetOffsetSec = onset1;
                c2.speechOnsetOffsetSec = onset2;

                const syncTarget1 = Number(Math.max(0, sub1.startSec - onset1).toFixed(3));
                const syncTarget2 = Number(Math.max(0, sub1.startSec - onset2).toFixed(3));

                const prev1End = idx1 > 0 ? (tr1Clips[idx1 - 1].clipStartSec + (tr1Clips[idx1 - 1].offsetSec || 0) + tr1Clips[idx1 - 1].durationSec + 0.02) : 0;
                const next1Start = idx1 + 1 < tr1Clips.length ? (tr1Clips[idx1 + 1].clipStartSec + (tr1Clips[idx1 + 1].offsetSec || 0) - 0.02) : Infinity;
                const prev2End = idx2 > 0 ? (tr2Clips[idx2 - 1].clipStartSec + (tr2Clips[idx2 - 1].offsetSec || 0) + tr2Clips[idx2 - 1].durationSec + 0.02) : 0;
                const next2Start = idx2 + 1 < tr2Clips.length ? (tr2Clips[idx2 + 1].clipStartSec + (tr2Clips[idx2 + 1].offsetSec || 0) - 0.02) : Infinity;

                if (syncTarget1 >= prev1End && syncTarget1 + c1.durationSec <= next1Start) {
                  c1.clipStartSec = syncTarget1;
                  c1.offsetSec = 0;
                }
                if (syncTarget2 >= prev2End && syncTarget2 + c2.durationSec <= next2Start) {
                  c2.clipStartSec = syncTarget2;
                  c2.offsetSec = 0;
                }
                c1.isUnisonPhrase = true;
                c2.isUnisonPhrase = true;
                c1.hasCollision = false;
                c2.hasCollision = false;
                if (c1.timingIssue === 'desync' || c1.timingIssue === 'overlap') {
                  c1.timingIssue = null;
                  c1.timingIssueText = undefined;
                }
                if (c2.timingIssue === 'desync' || c2.timingIssue === 'overlap') {
                  c2.timingIssue = null;
                  c2.timingIssueText = undefined;
                }
                const rmIds = new Set([`issue_desync_${c1.id}`, `issue_desync_${c2.id}`]);
                for (let k = newIssues.length - 1; k >= 0; k--) {
                  if (rmIds.has(newIssues[k].id)) newIssues.splice(k, 1);
                }
                unisonSyncedCount++;
              }
            }
          }
        }
      }

      for (let i = 0; i < trackIds.length; i++) {
        for (let j = i + 1; j < trackIds.length; j++) {
          const tr1Clips = updatedClips[trackIds[i]] || [];
          const tr2Clips = updatedClips[trackIds[j]] || [];

          for (const c1 of tr1Clips) {
            if (c1.isPhysics) continue;
            const c1Start = c1.clipStartSec + (c1.offsetSec || 0);
            const c1End = c1Start + c1.durationSec;

            for (const c2 of tr2Clips) {
              if (c2.isPhysics) continue;
              const c2Start = c2.clipStartSec + (c2.offsetSec || 0);
              const c2End = c2Start + c2.durationSec;

              const overlapStart = Math.max(c1Start, c2Start);
              const overlapEnd = Math.min(c1End, c2End);
              const overlapDur = overlapEnd - overlapStart;

              if (overlapDur > 0.04) {
                const sub1 = findSubForClip(trackIds[i], c1);
                const sub2 = findSubForClip(trackIds[j], c2);

                const normT1 = normalizeSpeechText(sub1?.text || c1.text || '');
                const normT2 = normalizeSpeechText(sub2?.text || c2.text || '');
                const isSamePhrase =
                  Boolean(c1.isUnisonPhrase && c2.isUnisonPhrase && Math.abs(c1Start - c2Start) <= 0.25) ||
                  Boolean(sub1 && sub2 && (
                    (sub1.id !== undefined && sub2.id !== undefined && String(sub1.id) === String(sub2.id)) ||
                    (normT1 !== '' && normT1 === normT2 && Math.abs(sub1.startSec - sub2.startSec) <= 0.08)
                  ));

                if (isSamePhrase) {
                  const buf1 = audioBuffersRef.current[c1.sourceAudioTrackId || trackIds[i]];
                  const buf2 = audioBuffersRef.current[c2.sourceAudioTrackId || trackIds[j]];
                  const onset1 = c1.speechOnsetOffsetSec ?? detectSpeechOnsetOffsetSec(buf1, c1.sourceStartSec, c1.sourceEndSec);
                  const onset2 = c2.speechOnsetOffsetSec ?? detectSpeechOnsetOffsetSec(buf2, c2.sourceStartSec, c2.sourceEndSec);
                  const baseSync = sub1 ? sub1.startSec : c1Start;
                  c1.clipStartSec = Number(Math.max(0, baseSync - onset1).toFixed(3));
                  c1.offsetSec = 0;
                  c2.clipStartSec = Number(Math.max(0, baseSync - onset2).toFixed(3));
                  c2.offsetSec = 0;
                  c1.isUnisonPhrase = true;
                  c2.isUnisonPhrase = true;
                  c1.hasCollision = false;
                  c2.hasCollision = false;
                  continue;
                }

                // Classify as intentional simultaneous scene whenever:
                // 1) The two clips' subtitles overlap in .ass (> -0.02s), OR
                // 2) Global .ass subtitles have two overlapping lines at this moment, OR
                // 3) One clip is contained inside the other (e.g. a short line inside a 7-9s reaction) or overlap > 0.48s
                let isSpecifiedInSubtitles = false;
                const [earlyC, lateC] = c1Start <= c2Start ? [c1, c2] : [c2, c1];
                const earlyS = Math.min(c1Start, c2Start);
                const earlyE = c1Start <= c2Start ? c1End : c2End;
                const lateS = Math.max(c1Start, c2Start);
                const lateE = c1Start <= c2Start ? c2End : c1End;
                const minClipDur = Math.min(c1.durationSec, c2.durationSec);

                if (sub1 && sub2) {
                  const subOverlapStart = Math.max(sub1.startSec, sub2.startSec);
                  const subOverlapEnd = Math.min(sub1.endSec, sub2.endSec);
                  if (subOverlapEnd - subOverlapStart > -0.02) {
                    isSpecifiedInSubtitles = true;
                  }
                }
                if (!isSpecifiedInSubtitles) {
                  const activeGlobal = subtitles.filter(
                    s => s.endSec >= overlapStart - 0.05 && s.startSec <= overlapEnd + 0.05
                  );
                  for (let a = 0; a < activeGlobal.length; a++) {
                    for (let b = a + 1; b < activeGlobal.length; b++) {
                      const gOv = Math.min(activeGlobal[a].endSec, activeGlobal[b].endSec) -
                        Math.max(activeGlobal[a].startSec, activeGlobal[b].startSec);
                      if (gOv >= 0.05) {
                        isSpecifiedInSubtitles = true;
                        break;
                      }
                    }
                    if (isSpecifiedInSubtitles) break;
                  }
                }
                if (
                  !isSpecifiedInSubtitles &&
                  (lateS - earlyS <= 0.10 ||
                    lateE <= earlyE + 0.18 ||
                    overlapDur > 0.48 ||
                    overlapDur > minClipDur * 0.42)
                ) {
                  isSpecifiedInSubtitles = true;
                }

                if (isSpecifiedInSubtitles && (sub1 || sub2 || earlyC)) {
                  const effSub1 = sub1 || ({ id: earlyC.id, startSec: earlyS, endSec: earlyE, text: earlyC.text } as unknown as SubtitleLine);
                  const effSub2 = sub2 || ({ id: lateC.id, startSec: lateS, endSec: lateE, text: lateC.text } as unknown as SubtitleLine);
                  const subOvStart = Number(Math.min(effSub1.startSec, effSub2.startSec).toFixed(2));
                  const subOvEnd = Number(Math.max(effSub1.endSec, effSub2.endSec).toFixed(2));
                  const ovStart = Number(overlapStart.toFixed(2));
                  const ovEnd = Number(overlapEnd.toFixed(2));

                  let matchedGroup: IntentionalOverlapMoment | undefined;
                  for (const grp of detectedIntentionalOverlapsMap.values()) {
                    if (Math.min(grp.endSec, Math.max(c1End, c2End)) > Math.max(grp.startSec, Math.min(c1Start, c2Start)) - 0.25) {
                      matchedGroup = grp;
                      break;
                    }
                  }

                  c1.isIntentionalOverlap = true;
                  c2.isIntentionalOverlap = true;
                  c1.hasCollision = false;
                  c2.hasCollision = false;

                  const entry1: IntentionalOverlapTrackEntry = {
                    trackId: trackIds[i],
                    dubberNick: c1.dubberName,
                    characterName: c1.characterName,
                    phraseId: c1.id,
                    subId: String(effSub1.id ?? ''),
                    text: effSub1.text || c1.text,
                    phraseStartSec: Number(c1Start.toFixed(2)),
                    phraseEndSec: Number(c1End.toFixed(2))
                  };
                  const entry2: IntentionalOverlapTrackEntry = {
                    trackId: trackIds[j],
                    dubberNick: c2.dubberName,
                    characterName: c2.characterName,
                    phraseId: c2.id,
                    subId: String(effSub2.id ?? ''),
                    text: effSub2.text || c2.text,
                    phraseStartSec: Number(c2Start.toFixed(2)),
                    phraseEndSec: Number(c2End.toFixed(2))
                  };
                  if (!matchedGroup) {
                    const groupId = `sub_overlap_${Math.round(subOvStart * 10)}_${effSub1.id ?? i}_${effSub2.id ?? j}`;
                    const defaultMainKey = existingPriorityById[groupId] || c1.dubberName;
                    matchedGroup = {
                      id: groupId,
                      startSec: Math.min(entry1.phraseStartSec, entry2.phraseStartSec),
                      endSec: Math.max(entry1.phraseEndSec, entry2.phraseEndSec),
                      overlapStartSec: ovStart,
                      overlapEndSec: ovEnd,
                      subStartSec: subOvStart,
                      subEndSec: subOvEnd,
                      priorityTrackKey: defaultMainKey,
                      attenuationDb: -10,
                      tracks: [entry1, entry2]
                    };
                    detectedIntentionalOverlapsMap.set(groupId, matchedGroup);
                  } else {
                    matchedGroup.startSec = Math.min(matchedGroup.startSec, entry1.phraseStartSec, entry2.phraseStartSec);
                    matchedGroup.endSec = Math.max(matchedGroup.endSec, entry1.phraseEndSec, entry2.phraseEndSec);
                    matchedGroup.overlapStartSec = Math.min(matchedGroup.overlapStartSec, ovStart);
                    matchedGroup.overlapEndSec = Math.max(matchedGroup.overlapEndSec, ovEnd);
                    if (!matchedGroup.tracks.some(t => t.dubberNick === entry1.dubberNick && t.phraseId === entry1.phraseId)) {
                      matchedGroup.tracks.push(entry1);
                    }
                    if (!matchedGroup.tracks.some(t => t.dubberNick === entry2.dubberNick && t.phraseId === entry2.phraseId)) {
                      matchedGroup.tracks.push(entry2);
                    }
                  }

                  const activePrio = matchedGroup.priorityTrackKey || c1.dubberName;
                  c1.overlapGroupId = matchedGroup.id;
                  c2.overlapGroupId = matchedGroup.id;
                  const c1IsMain = c1.dubberName === activePrio || c1.trackId === activePrio || c1.id === activePrio;
                  const c2IsMain = !c1IsMain && (c2.dubberName === activePrio || c2.trackId === activePrio || c2.id === activePrio);
                  c1.overlapRole = c1IsMain ? 'main' : 'secondary';
                  c2.overlapRole = c2IsMain ? 'main' : 'secondary';
                  c1.volumeGainDb = c1.overlapRole === 'main' ? 0 : -10;
                  c2.volumeGainDb = c2.overlapRole === 'main' ? 0 : -10;
                  continue;
                }

                const normD1 = normalizeName(c1.dubberName).split(' ')[0];
                const normD2 = normalizeName(c2.dubberName).split(' ')[0];
                const isSameDubber = normD1 && normD1 === normD2;

                if (isSameDubber) {
                  c1.isSelfOverlap = true;
                  c2.isSelfOverlap = true;
                } else {
                  const [earlyClip, lateClip] = c1Start <= c2Start ? [c1, c2] : [c2, c1];
                  c1.hasCollision = true;
                  c2.hasCollision = true;
                  c1.overlappingClipId = c2.id;
                  c2.overlappingClipId = c1.id;
                  if (!c1.timingIssue) c1.timingIssue = 'overlap';
                  if (!c2.timingIssue) c2.timingIssue = 'overlap';

                  newCollisions.push({
                    id: `col_${earlyClip.id}_${lateClip.id}`,
                    track1Id: earlyClip.trackId,
                    track2Id: lateClip.trackId,
                    dubber1Name: earlyClip.dubberName,
                    dubber2Name: lateClip.dubberName,
                    character1Name: earlyClip.characterName,
                    character2Name: lateClip.characterName,
                    startSec: overlapStart,
                    endSec: overlapEnd,
                    overlapDurationSec: Number(overlapDur.toFixed(2))
                  });

                  newIssues.push({
                    id: `issue_overlap_inter_${earlyClip.id}_${lateClip.id}`,
                    type: 'overlap',
                    trackId: lateClip.trackId,
                    dubberName: lateClip.dubberName,
                    characterName: lateClip.characterName,
                    clipId: lateClip.id,
                    timeSec: overlapStart,
                    durationSec: overlapDur,
                    overlapDurationSec: Number(overlapDur.toFixed(2)),
                    overlappingClipId: earlyClip.id,
                    overlappingDubber: earlyClip.dubberName,
                    description: `Наезд голосов: «${earlyClip.dubberName}» и «${lateClip.dubberName}» (${overlapDur.toFixed(2)}с) [${formatSeconds(overlapStart)}]`
                  });
                }
              }
            }
          }
        }
      }

      const detectedIntentionalOverlaps = Array.from(detectedIntentionalOverlapsMap.values()).sort((a, b) => a.startSec - b.startSec);
      setIntentionalOverlaps(detectedIntentionalOverlaps);
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

      if (totalPhysicsDetected > 0) {
        addLog(`⚡ Защита физики: распознано и защищено от сдвига/удаления ${totalPhysicsDetected} звуков физики (вздохи/охи/смех вне субтитров).`, 'info');
      }
      if (crossDubberCoveredCount > 0) {
        addLog(`🤝 Перекрёстная озвучка: ${crossDubberCoveredCount} сабов озвучены другими дабберами серии — исключены из пропусков.`, 'success');
      }
      if (totalMultiSubClips > 0) {
        addLog(`🔗 Слитные реплики: обнаружено ${totalMultiSubClips} соседних субтитров, озвученных дабберами на одном дыхании в одном клипе.`, 'info');
      }
      if (unisonSyncedCount > 0) {
        addLog(`🔗 Синхронизировано общих фраз (унисон нескольких дабберов по пику атаки голоса): ${unisonSyncedCount} шт.`, 'success');
      }
      if (detectedIntentionalOverlaps.length > 0) {
        addLog(`📋 Зафиксировано ${detectedIntentionalOverlaps.length} сцен одновременной речи по субтитрам — переключатель «★ Главный (0 дБ) / 🔉 Второй (-10 дБ)» доступен прямо на клипах таймлайна.`, 'info');
      }
      addLog(`✓ Этап 1 (Анализ) завершен! Найдено проблем: наездов — ${overlapCount}, рассинхронов — ${desyncCount}, пропущенных — ${missingCount}, подтяжек — ${orphanCount}.`, newIssues.length > 0 ? 'warn' : 'success');

      if (newIssues.length === 0) {
        toast.success('🎉 Анализ завершен! На дорожках нет ни одного наезда, рассинхрона или пропуска.');
      } else {
        toast.warning(`Найдено проблем: ${newIssues.length} (Наезды: ${overlapCount}, Рассинхрон: ${desyncCount}, Пропуски: ${missingCount}). Примените «5. Автотайминг» с финальным самовосстановлением.`, { duration: 6000 });
      }
    } catch (err: any) {
      addLog(`❌ Ошибка этапа 1 (Анализ): ${err.message}`, 'error');
      toast.error(`Ошибка анализа таймингов: ${err.message}`);
    } finally {
      setIsLoading(false);
      clearProcess();
    }
  };

  return {
    handleAnalyzeTiming,
  };
}
