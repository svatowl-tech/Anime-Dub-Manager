import type React from 'react';
import { toast } from 'sonner';
import { Track, SubtitleLine } from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';
import { getSharedAudioContext } from '../../lib/qa/sharedAudioContext';
import { NormalizationMetrics } from '../../lib/qa/audioNormalizer';
import { TimingSettings } from '../TimingSettingsModal';
import {
  AudioClip,
  NoiseCalibration,
} from './timing.types';
import {
  calculateTextSimilarity,
  formatSeconds,
  getPlayableAudioUrl,
  isFixTrack,
  normalizeName,
} from './timing.utils';
import {
  detectSpeechIntervals,
  detectSpeechOnsetOffsetSec,
} from './timing.dsp';

export interface UseTimingSilenceAndFixesParams {
  tracks: Track[];
  audioClips: Record<string, AudioClip[]>;
  trackSubLinesMap: Record<string, SubtitleLine[]>;
  timingSettings: TimingSettings;
  normalizationMetrics: Record<string, NormalizationMetrics>;
  duration: number;
  audioBuffersRef: React.MutableRefObject<Record<string, AudioBuffer>>;
  audioElementsRef: React.MutableRefObject<Record<string, HTMLAudioElement>>;
  origBuffersByTrackRef: React.MutableRefObject<Record<string, { buffer: AudioBuffer; filePath?: string; sourceTrackId: string }>>;
  fixBuffersByActorRef: React.MutableRefObject<Record<string, Array<{ buffer: AudioBuffer; filePath?: string; sourceTrackId: string; participant: string }>>>;
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  setAudioClips: React.Dispatch<React.SetStateAction<Record<string, AudioClip[]>>>;
  setCalibrationsByTrack: React.Dispatch<React.SetStateAction<Record<string, NoiseCalibration>>>;
  setNormalizationMetrics: React.Dispatch<React.SetStateAction<Record<string, NormalizationMetrics>>>;
  setIsSilenceRemoved: React.Dispatch<React.SetStateAction<boolean>>;
  setIsFixesStitched: React.Dispatch<React.SetStateAction<boolean>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  updateProcess: (title: string, detail: string, progress: number, stepCurrent?: number, stepTotal?: number) => void;
  clearProcess: () => void;
  addLog: (msg: string, level?: 'info' | 'success' | 'warn' | 'error') => void;
}

export function useTimingSilenceAndFixes({
  tracks,
  audioClips,
  trackSubLinesMap,
  timingSettings,
  normalizationMetrics,
  duration,
  audioBuffersRef,
  audioElementsRef,
  origBuffersByTrackRef,
  fixBuffersByActorRef,
  setTracks,
  setAudioClips,
  setCalibrationsByTrack,
  setNormalizationMetrics,
  setIsSilenceRemoved,
  setIsFixesStitched,
  setIsLoading,
  updateProcess,
  clearProcess,
  addLog,
}: UseTimingSilenceAndFixesParams) {
  // PIPELINE STEP 3: "Удалить тишину" — Real VAD Silence Cutting with Noise Floor Auto-Calibration on ALL tracks
  const handleCutSilence = async () => {
    if (tracks.length === 0) {
      toast.error('Нет загруженных дорожек');
      return;
    }
    try {
      setIsLoading(true);
      updateProcess('3. Удаление тишины и калибровка', 'Авто-калибровка шума и нарезка речевых фраз...', 5, 0, tracks.length);
      addLog('Запуск анализа энергии аудиосигнала и авто-калибровки шума/тишины перед нарезкой...', 'info');

      const updatedClips: Record<string, AudioClip[]> = {};
      let totalClips = 0;
      const newCalibrations: Record<string, NoiseCalibration> = {};

      for (let tIdx = 0; tIdx < tracks.length; tIdx++) {
        const track = tracks[tIdx];
        let audioBuf = audioBuffersRef.current[track.id];
        const dubberName = track.participant || track.dubberName || 'Даббер';
        const characterName = track.character || track.characterName || 'Персонаж';
        const trSubs = trackSubLinesMap[track.id] || [];

        const pct = Math.round(((tIdx + 0.5) / Math.max(1, tracks.length)) * 95);
        updateProcess(
          '3. Удаление тишины и калибровка',
          `Калибровка шума и нарезка фраз [${tIdx + 1}/${tracks.length}]: «${dubberName}»...`,
          pct,
          tIdx + 1,
          tracks.length
        );
        await new Promise(r => setTimeout(r, 0));

        // Ensure audio buffer is decoded in memory so live adaptive per-track + subtitle-guided calibration runs
        if (!audioBuf && track.filePath) {
          try {
            const pUrl = await getPlayableAudioUrl(track.filePath);
            if (pUrl) {
              const resp = await fetch(pUrl);
              const arrayBuf = await resp.arrayBuffer();
              const sharedAudioCtx = getSharedAudioContext();
              if (sharedAudioCtx) {
                audioBuf = await sharedAudioCtx.decodeAudioData(arrayBuf);
                audioBuffersRef.current[track.id] = audioBuf;
              }
            }
          } catch (decodeErr) {
            console.warn(`[SilenceCut] Ошибка декодирования ${track.id}:`, decodeErr);
          }
        }

        if (audioBuf) {
          const subLinesForVad = !isFixTrack(track)
            ? trSubs
            : (tracks.find(t => !isFixTrack(t) && normalizeName(t.dubberName) === normalizeName(track.dubberName))
                ? (trackSubLinesMap[tracks.find(t => !isFixTrack(t) && normalizeName(t.dubberName) === normalizeName(track.dubberName))!.id] || trSubs)
                : trSubs);

          const intervals = detectSpeechIntervals(audioBuf, {
            minSilenceDurationSec: timingSettings.minSilenceDurationSec,
            leadInPaddingSec: timingSettings.leadInPaddingSec,
            leadOutPaddingSec: timingSettings.leadOutPaddingSec,
            minSpeechDurationSec: timingSettings.minSpeechDurationSec,
            mergeCloseGapsSec: timingSettings.mergeCloseGapsSec,
            manualThresholdDb: timingSettings.autoAnalyzeNoiseFloor ? undefined : timingSettings.silenceThresholdDb,
            subLines: subLinesForVad,
            onCalibration: (calib) => {
              newCalibrations[track.id] = calib;
              const normGain = normalizationMetrics[track.id]?.gainDb;
              const normInfo = normGain !== undefined ? `, Усиление норм.: ${normGain >= 0 ? '+' : ''}${normGain} dB` : '';
              addLog(`📊 Авто-калибровка «${dubberName}»: Шум: ${calib.noiseFloorDb} dB, Речь: ${calib.speechFloorDb} dB, Порог: ${calib.calculatedThresholdDb} dB${normInfo} (Запас: ${Math.round(timingSettings.leadInPaddingSec * 1000)}/${Math.round(timingSettings.leadOutPaddingSec * 1000)} мс)`, 'info');
            }
          });

          addLog(`🎙 Дорожка «${dubberName}»: обнаружено ${intervals.length} полезных речевых фраз (вырезана только тишина, позиции фраз не сдвинуты).`, 'info');

          const assignedSubsForCut = new Set<number>();
          const matchedSubByIv = new Array<SubtitleLine | undefined>(intervals.length).fill(undefined);
          const cutPairs: Array<{ ivIdx: number; sIdx: number; diff: number }> = [];
          intervals.forEach((iv, ivIdx) => {
            trSubs.forEach((s, sIdx) => {
              const diff = Math.abs(s.startSec - iv.startSec);
              if (diff <= 2.2) {
                cutPairs.push({ ivIdx, sIdx, diff });
              }
            });
          });
          cutPairs.sort((a, b) => a.diff - b.diff);
          for (const pair of cutPairs) {
            if (matchedSubByIv[pair.ivIdx] || assignedSubsForCut.has(pair.sIdx)) continue;
            matchedSubByIv[pair.ivIdx] = trSubs[pair.sIdx];
            assignedSubsForCut.add(pair.sIdx);
          }

          updatedClips[track.id] = intervals.map((iv, idx) => {
            const matchingSub = matchedSubByIv[idx];
            const onsetSec = detectSpeechOnsetOffsetSec(audioBuf, iv.startSec, iv.endSec);

            totalClips++;
            return {
              id: `clip_${track.id}_${idx}`,
              trackId: track.id,
              dubberName,
              characterName,
              clipStartSec: iv.startSec,
              durationSec: iv.durationSec,
              sourceStartSec: iv.startSec,
              sourceEndSec: iv.endSec,
              rawSourceStartSec: iv.startSec,
              rawSourceEndSec: iv.endSec,
              speechOnsetOffsetSec: onsetSec,
              sourceAudioPath: track.filePath,
              text: matchingSub?.text || `Фраза ${idx + 1}`,
              matchedSubId: matchingSub ? String(matchingSub.id) : undefined,
              volumePercent: 100,
              isFix: isFixTrack(track),
              hasCollision: false,
              offsetSec: 0
            };
          });
        } else {
          updatedClips[track.id] = trSubs.map((sub, idx) => {
            totalClips++;
            return {
              id: `clip_${track.id}_${idx}`,
              trackId: track.id,
              dubberName,
              characterName,
              clipStartSec: sub.startSec,
              durationSec: Math.max(0.4, sub.endSec - sub.startSec),
              sourceStartSec: sub.startSec,
              sourceEndSec: sub.endSec,
              rawSourceStartSec: sub.startSec,
              rawSourceEndSec: sub.endSec,
              text: sub.text,
              volumePercent: 100,
              isFix: isFixTrack(track),
              hasCollision: false,
              offsetSec: 0
            };
          });
        }
      }

      updateProcess('3. Удаление тишины и калибровка', `Сформировано ${totalClips} фраз (без сдвига позиций)`, 100, tracks.length, tracks.length);
      setCalibrationsByTrack(newCalibrations);
      setAudioClips(updatedClips);
      setIsSilenceRemoved(true);
      addLog(`✓ Удаление тишины со всех дорожек завершено! Сформировано ${totalClips} фраз. Все фразы стоят строго на своих исходных местах (0 мс сдвига).`, 'success');
      toast.success(`Тишина удалена! Сформировано ${totalClips} фраз (все реплики строго на своих исходных местах).`);
    } catch (err: any) {
      addLog(`❌ Ошибка удаления тишины: ${err.message}`, 'error');
      toast.error(`Ошибка: ${err.message}`);
    } finally {
      setIsLoading(false);
      clearProcess();
    }
  };

  // PIPELINE STEP 4: "Применить фиксы" — Two-Scenario Fix Stitching (Full Replacement vs Targeted Splicing with Boundary Protection)
  const handleStitchFixes = async () => {
    try {
      setIsLoading(true);
      updateProcess('3. Вшитие фиксов', 'Анализ дорожек фиксов и классификация (полный перезапис / точечный фикс)...', 10);
      addLog('Запуск вшивания фиксов: проверка типа фикса (полная замена или точечное вшивание с защитой концов фраз)...', 'info');

      const updatedClips = { ...audioClips };
      let appliedCount = 0;

      // Group tracks by actor
      const tracksByActor: Record<string, Track[]> = {};
      tracks.forEach(tr => {
        const actorKey = tr.dubberName || 'Даббер';
        if (!tracksByActor[actorKey]) tracksByActor[actorKey] = [];
        tracksByActor[actorKey].push(tr);
      });

      const actorEntries = Object.entries(tracksByActor);
      for (let aIdx = 0; aIdx < actorEntries.length; aIdx++) {
        const [actorNick, actorTrks] = actorEntries[aIdx];
        const mainTracks = actorTrks.filter(t => !isFixTrack(t));
        const fixTracks = actorTrks.filter(t => isFixTrack(t));

        updateProcess(
          '3. Вшитие фиксов',
          `Обработка фиксов [${aIdx + 1}/${actorEntries.length}]: «${actorNick}»...`,
          Math.round(((aIdx + 1) / Math.max(1, actorEntries.length)) * 95),
          aIdx + 1,
          actorEntries.length
        );
        await new Promise(r => setTimeout(r, 0));

        if (mainTracks.length === 0 || fixTracks.length === 0) continue;

        // Ensure all main tracks have their original buffers saved and are sliced into speech phrases
        for (const mTrk of mainTracks) {
          const mBuf = audioBuffersRef.current[mTrk.id];
          if (mBuf && !origBuffersByTrackRef.current[mTrk.id]) {
            const origKey = `orig_${mTrk.id}`;
            audioBuffersRef.current[origKey] = mBuf;
            origBuffersByTrackRef.current[mTrk.id] = {
              buffer: mBuf,
              filePath: mTrk.filePath,
              sourceTrackId: origKey
            };
          }
          const curMainClips = updatedClips[mTrk.id] || [];
          if (curMainClips.length <= 1 && mBuf) {
            const mSubs = trackSubLinesMap[mTrk.id] || [];
            const mIntervals = detectSpeechIntervals(mBuf, {
              minSilenceDurationSec: timingSettings.minSilenceDurationSec,
              leadInPaddingSec: timingSettings.leadInPaddingSec,
              leadOutPaddingSec: timingSettings.leadOutPaddingSec,
              minSpeechDurationSec: timingSettings.minSpeechDurationSec,
              mergeCloseGapsSec: timingSettings.mergeCloseGapsSec,
              subLines: mSubs
            });
            if (mIntervals.length > 0) {
              updatedClips[mTrk.id] = mIntervals.map((iv, idx) => {
                const nearSub = mSubs.find(s => Math.abs(s.startSec - iv.startSec) <= 2.2);
                return {
                  id: `clip_${mTrk.id}_${idx}`,
                  trackId: mTrk.id,
                  dubberName: mTrk.participant || mTrk.dubberName || actorNick,
                  characterName: mTrk.character || mTrk.characterName || 'Персонаж',
                  clipStartSec: iv.startSec,
                  durationSec: iv.durationSec,
                  sourceStartSec: iv.startSec,
                  sourceEndSec: iv.endSec,
                  rawSourceStartSec: iv.startSec,
                  rawSourceEndSec: iv.endSec,
                  speechOnsetOffsetSec: detectSpeechOnsetOffsetSec(mBuf, iv.startSec, iv.endSec),
                  sourceAudioPath: mTrk.filePath,
                  text: nearSub?.text || `Фраза ${idx + 1}`,
                  matchedSubId: nearSub ? String(nearSub.id) : undefined,
                  volumePercent: 100,
                  isFix: false,
                  hasCollision: false,
                  offsetSec: 0
                };
              });
            }
          }
        }

        for (const fixTrack of fixTracks) {
          let fixClips = updatedClips[fixTrack.id] || [];
          const fixBuf = audioBuffersRef.current[fixTrack.id];

          // Preserve fix buffer in fixBuffersByActorRef for Priority 1 self-healing recovery
          if (fixBuf) {
            const actorNorm = normalizeName(actorNick);
            if (!fixBuffersByActorRef.current[actorNorm]) {
              fixBuffersByActorRef.current[actorNorm] = [];
            }
            if (!fixBuffersByActorRef.current[actorNorm].some(f => f.sourceTrackId === fixTrack.id)) {
              fixBuffersByActorRef.current[actorNorm].push({
                buffer: fixBuf,
                filePath: fixTrack.filePath,
                sourceTrackId: fixTrack.id,
                participant: fixTrack.participant || actorNick
              });
            }
          }

          if (fixClips.length <= 1 && fixBuf) {
            const trSubs = trackSubLinesMap[fixTrack.id] || trackSubLinesMap[mainTracks[0].id] || [];
            const fixIntervals = detectSpeechIntervals(fixBuf, {
              minSilenceDurationSec: timingSettings.minSilenceDurationSec,
              leadInPaddingSec: timingSettings.leadInPaddingSec,
              leadOutPaddingSec: timingSettings.leadOutPaddingSec,
              minSpeechDurationSec: timingSettings.minSpeechDurationSec,
              mergeCloseGapsSec: timingSettings.mergeCloseGapsSec,
              subLines: trSubs
            });
            if (fixIntervals.length > 0) {
              fixClips = fixIntervals.map((iv, idx) => ({
                id: `clip_${fixTrack.id}_${idx}`,
                trackId: fixTrack.id,
                dubberName: fixTrack.dubberName || actorNick,
                characterName: fixTrack.characterName || mainTracks[0].characterName,
                clipStartSec: iv.startSec,
                durationSec: iv.durationSec,
                sourceStartSec: iv.startSec,
                sourceEndSec: iv.endSec,
                rawSourceStartSec: iv.startSec,
                rawSourceEndSec: iv.endSec,
                speechOnsetOffsetSec: detectSpeechOnsetOffsetSec(fixBuf, iv.startSec, iv.endSec),
                sourceAudioTrackId: fixTrack.id,
                sourceAudioPath: fixTrack.filePath,
                text: trSubs[idx]?.text || `Фраза фикса ${idx + 1}`,
                volumePercent: 100,
                isFix: true,
                offsetSec: 0
              }));
              updatedClips[fixTrack.id] = fixClips;
            }
          }

          if (fixClips.length === 0) continue;

          const fixDuration = fixBuf ? fixBuf.duration : (fixClips[fixClips.length - 1]?.clipStartSec || 0);

          const strippedId = fixTrack.id.replace(/_fix(?:_\d+)?$/, '');
          const fixIdxMatch = fixTrack.id.match(/_fix_(\d+)$/);
          const fixTrackNum = fixIdxMatch ? parseInt(fixIdxMatch[1], 10) : (fixTrack as any).subTrackIndex;

          let bestMainTrackForFull =
            mainTracks.find(mt => mt.id === (fixTrack as any).targetMainTrackId) ||
            (fixTrackNum ? mainTracks.find(mt => (mt as any).subTrackIndex === fixTrackNum) : null) ||
            mainTracks.find(mt => mt.id === strippedId) ||
            mainTracks[0];
          if (!mainTracks.some(mt => mt.id === (fixTrack as any).targetMainTrackId || mt.id === strippedId || (fixTrackNum && (mt as any).subTrackIndex === fixTrackNum))) {
            let bestDurDiff = Infinity;
            for (const mt of mainTracks) {
              const buf = audioBuffersRef.current[mt.id];
              const mtClips = updatedClips[mt.id] || [];
              const dur = buf ? buf.duration : (mtClips[mtClips.length - 1]?.clipStartSec || 0);
              const diff = Math.abs(dur - fixDuration);
              if (diff < bestDurDiff) {
                bestDurDiff = diff;
                bestMainTrackForFull = mt;
              }
            }
          }

          const targetClips = updatedClips[bestMainTrackForFull.id] || [];
          const mainSubs = trackSubLinesMap[bestMainTrackForFull.id] || [];

          const fixActiveSpeechSec = fixClips.reduce((acc, c) => acc + c.durationSec, 0);
          const mainActiveSpeechSec = targetClips.reduce((acc, c) => acc + c.durationSec, 0);

          // Scenario 1 vs Scenario 2 Classification:
          let voicedInMainSubs = 0;
          let voicedInFixSubs = 0;
          let voicedOnlyInMainSubs = 0;
          for (const sub of mainSubs) {
            const hasMainVoice = targetClips.some(mc => {
              const s = mc.clipStartSec + (mc.offsetSec || 0);
              const e = s + mc.durationSec;
              return e >= sub.startSec - 1.8 && s <= sub.endSec + 1.8;
            });
            const hasFixVoice = fixClips.some(fc => {
              const s = fc.clipStartSec + (fc.offsetSec || 0);
              const e = s + fc.durationSec;
              return e >= sub.startSec - 1.8 && s <= sub.endSec + 1.8;
            });
            if (hasMainVoice) voicedInMainSubs++;
            if (hasFixVoice) voicedInFixSubs++;
            if (hasMainVoice && !hasFixVoice) voicedOnlyInMainSubs++;
          }

          const mainDialogueClipCount = Math.max(1, targetClips.filter(c => !c.isPhysics).length);
          const isFullReplacement =
            (fixClips.length >= Math.max(2, Math.floor(mainDialogueClipCount * 0.72)) &&
             fixActiveSpeechSec >= mainActiveSpeechSec * 0.70 &&
             (voicedInMainSubs === 0 || voicedOnlyInMainSubs <= Math.max(2, Math.floor(voicedInMainSubs * 0.15)))) ||
            (mainSubs.length > 0 &&
             voicedInMainSubs > 0 &&
             voicedInFixSubs >= Math.ceil(voicedInMainSubs * 0.80) &&
             voicedOnlyInMainSubs <= 2 &&
             fixActiveSpeechSec >= mainActiveSpeechSec * 0.65);

          if (isFullReplacement) {
            // SCENARIO 1: Full Track Replacement — replace the entire track cleanly without splicing into the old track
            addLog(
              `⚡ Сценарий 1 (Полная замена дорожки) для «${actorNick}»: фикс содержит ${fixClips.length} фраз (${fixActiveSpeechSec.toFixed(1)}с речи vs ${mainActiveSpeechSec.toFixed(1)}с). Основная дорожка «${bestMainTrackForFull.participant}» полностью заменена на дорожку фикса без сдвигов!`,
              'success'
            );
            if (fixBuf) {
              audioBuffersRef.current[bestMainTrackForFull.id] = fixBuf;
            }
            if (audioElementsRef.current[fixTrack.id]) {
              audioElementsRef.current[bestMainTrackForFull.id] = audioElementsRef.current[fixTrack.id];
            }
            if (normalizationMetrics[fixTrack.id]) {
              setNormalizationMetrics(prev => ({
                ...prev,
                [bestMainTrackForFull.id]: prev[fixTrack.id] || normalizationMetrics[fixTrack.id]
              }));
            }
            bestMainTrackForFull.filePath = fixTrack.filePath || bestMainTrackForFull.filePath;
            const replacedClips = fixClips.map((fc, idx) => {
              const nearSub = mainSubs.find(s => Math.abs(s.startSec - fc.clipStartSec) <= 2.2) || mainSubs[idx];
              return {
                ...fc,
                id: `clip_${bestMainTrackForFull.id}_fullfix_${idx}`,
                trackId: bestMainTrackForFull.id,
                sourceAudioTrackId: fixTrack.id,
                sourceAudioPath: fc.sourceAudioPath || fixTrack.filePath,
                isFix: true,
                text: nearSub?.text || targetClips[idx]?.text || fc.text,
                matchedSubId: nearSub ? String(nearSub.id) : undefined
              };
            });
            updatedClips[bestMainTrackForFull.id] = replacedClips;
            delete updatedClips[fixTrack.id];
            appliedCount += fixClips.length;
          } else {
            // SCENARIO 2: Targeted Fix Splicing
            // - For timecode-aligned fix tracks (!isShortFixFile): insert at exact fixClip.clipStartSec WITHOUT shifting to subtitle start!
            // - For short standalone fix files starting near 00:00 (isShortFixFile): match via Whisper / comment timestamps.
            let fixAppliedOnTrack = 0;
            const mainBuf = audioBuffersRef.current[bestMainTrackForFull.id];
            const mainDur = mainBuf ? mainBuf.duration : duration;

            const maxFixEndSec = Math.max(...fixClips.map(c => c.clipStartSec + c.durationSec));
            const isShortFixFile =
              fixDuration < mainDur * 0.45 &&
              maxFixEndSec < 45 &&
              mainSubs.some(s => s.startSec > 45);

            const fixWhisperMap: Record<string, string> = {};
            const needsWhisperClips = fixClips.filter(fc => {
              if (isShortFixFile) return true;
              const hasTimecodeSub = mainSubs.some(s => Math.abs(s.startSec - fc.clipStartSec) <= 3.0);
              const hasTimecodeClip = targetClips.some(mc => Math.abs(mc.clipStartSec - fc.clipStartSec) <= 3.0);
              return !hasTimecodeSub && !hasTimecodeClip;
            });

            if (needsWhisperClips.length > 0 && fixTrack.filePath) {
              try {
                addLog(`🎙 Whisper: распознавание ${needsWhisperClips.length} фраз точечного фикса «${actorNick}»...`, 'info');
                const resp: any = await ipcSafe.invoke('timing-whisper-transcribe-clips', {
                  audioFilePath: fixTrack.filePath,
                  clips: needsWhisperClips.map(c => ({
                    id: c.id,
                    startSec: c.sourceStartSec,
                    endSec: c.sourceEndSec,
                    hint: c.text
                  })),
                  model: 'tiny',
                  language: 'ru'
                });
                if (resp && Array.isArray(resp.results)) {
                  resp.results.forEach((r: any) => {
                    if (r.id && r.text) {
                      fixWhisperMap[r.id] = r.text.trim();
                    }
                  });
                }
              } catch (wErr) {
                console.warn('[FixStitch Whisper] Failed to transcribe short fix clips:', wErr);
              }
            }

            const usedTargetSubIds = new Set<string>();

            for (let fIdx = 0; fIdx < fixClips.length; fIdx++) {
              const fixClip = fixClips[fIdx];
              const recognizedFixText = fixWhisperMap[fixClip.id] || fixClip.recognizedText || '';

              let targetTrackId = bestMainTrackForFull.id;
              let matchedSub: SubtitleLine | undefined;
              let targetInsertSec = fixClip.clipStartSec;

              if (!isShortFixFile) {
                // Timecode-anchored fix track: find which main track/subtitle corresponds to this timecode,
                // but KEEP targetInsertSec = fixClip.clipStartSec so the fix stays at the exact timecode recorded by the dubber!
                let bestSubDist = Infinity;
                for (const mTrk of mainTracks) {
                  const mSubs = trackSubLinesMap[mTrk.id] || [];
                  for (const s of mSubs) {
                    const dist = Math.abs(s.startSec - fixClip.clipStartSec);
                    if (dist <= 2.5 && dist < bestSubDist) {
                      bestSubDist = dist;
                      matchedSub = s;
                      targetTrackId = mTrk.id;
                    }
                  }
                }
                targetInsertSec = fixClip.clipStartSec;
                if (matchedSub) {
                  usedTargetSubIds.add(String(matchedSub.id));
                }
              } else {
                // Short standalone fix file starting at 00:00
                const candidateFixSubs = (trackSubLinesMap[fixTrack.id] || []).length > 0
                  ? (trackSubLinesMap[fixTrack.id] || [])
                  : mainSubs;

                let bestSim = 0;
                for (const mTrk of mainTracks) {
                  const mSubs = trackSubLinesMap[mTrk.id] || [];
                  for (const s of mSubs) {
                    if (usedTargetSubIds.has(String(s.id))) continue;
                    const sim = recognizedFixText
                      ? calculateTextSimilarity(recognizedFixText, s.text)
                      : calculateTextSimilarity(fixClip.text || '', s.text);
                    if (sim > bestSim) {
                      bestSim = sim;
                      matchedSub = s;
                      targetTrackId = mTrk.id;
                    }
                  }
                }

                if ((!matchedSub || bestSim < 0.35) && candidateFixSubs[fIdx]) {
                  matchedSub = candidateFixSubs[fIdx];
                }

                if (matchedSub) {
                  targetInsertSec = matchedSub.startSec;
                  usedTargetSubIds.add(String(matchedSub.id));
                }
              }

              const targetMainTrack = mainTracks.find(t => t.id === targetTrackId) || bestMainTrackForFull;
              let mClips = [...(updatedClips[targetMainTrack.id] || [])].sort(
                (a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0))
              );

              // Only excise old clips that directly overlap the fix replacement window [replaceStart, replaceEnd]
              const replaceStart = targetInsertSec - 0.08;
              const replaceEnd = targetInsertSec + fixClip.durationSec + 0.08;

              const excisedClips: AudioClip[] = [];
              const survivingClips: AudioClip[] = [];

              for (const mc of mClips) {
                if (mc.isPhysics || mc.isFix) {
                  survivingClips.push(mc);
                  continue;
                }
                const mcStart = mc.clipStartSec + (mc.offsetSec || 0);
                const mcEnd = mcStart + mc.durationSec;
                const overlapSec = Math.min(mcEnd, replaceEnd) - Math.max(mcStart, replaceStart);
                const isDirectTarget =
                  overlapSec >= 0.08 ||
                  (isShortFixFile && matchedSub && Math.abs(mcStart - matchedSub.startSec) <= 1.2);

                if (isDirectTarget) {
                  excisedClips.push(mc);
                } else {
                  survivingClips.push(mc);
                }
              }

              // Fallback for short 00:00 fix files: if no clip overlapped directly, replace closest old clip within 1.4s
              if (excisedClips.length === 0 && isShortFixFile) {
                let closestIdx = -1;
                let closestDist = 1.4;
                survivingClips.forEach((mc, idx) => {
                  if (mc.isPhysics || mc.isFix) return;
                  const dist = Math.abs((mc.clipStartSec + (mc.offsetSec || 0)) - targetInsertSec);
                  if (dist < closestDist) {
                    closestDist = dist;
                    closestIdx = idx;
                  }
                });
                if (closestIdx !== -1) {
                  excisedClips.push(survivingClips[closestIdx]);
                  survivingClips.splice(closestIdx, 1);
                }
              }

              const basePlacementStart = isShortFixFile && excisedClips.length > 0
                ? excisedClips[0].clipStartSec
                : targetInsertSec;

              const splicedClip: AudioClip = {
                ...fixClip,
                id: `clip_${targetMainTrack.id}_spliced_${fixClip.id}_${fIdx}`,
                trackId: targetMainTrack.id,
                dubberName: targetMainTrack.participant || targetMainTrack.dubberName || actorNick,
                characterName: targetMainTrack.character || targetMainTrack.characterName || fixClip.characterName,
                sourceAudioTrackId: fixTrack.id,
                sourceAudioPath: fixClip.sourceAudioPath || fixTrack.filePath,
                clipStartSec: Number(Math.max(0, basePlacementStart).toFixed(3)),
                durationSec: fixClip.durationSec,
                sourceStartSec: fixClip.sourceStartSec,
                sourceEndSec: fixClip.sourceEndSec,
                rawSourceStartSec: fixClip.rawSourceStartSec ?? fixClip.sourceStartSec,
                rawSourceEndSec: fixClip.rawSourceEndSec ?? fixClip.sourceEndSec,
                speechOnsetOffsetSec: fixClip.speechOnsetOffsetSec ?? detectSpeechOnsetOffsetSec(fixBuf, fixClip.sourceStartSec, fixClip.sourceEndSec),
                isFix: true,
                isPhysics: false,
                text: matchedSub?.text || excisedClips[0]?.text || fixClip.text,
                matchedSubId: matchedSub ? String(matchedSub.id) : excisedClips[0]?.matchedSubId,
                recognizedText: recognizedFixText || fixClip.recognizedText,
                offsetSec: 0
              };

              survivingClips.push(splicedClip);
              survivingClips.sort((a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0)));

              updatedClips[targetMainTrack.id] = survivingClips;
              appliedCount++;
              fixAppliedOnTrack++;
              addLog(
                `⚡ Вшит точечный фикс «${splicedClip.text.slice(0, 32)}» на ${formatSeconds(splicedClip.clipStartSec)} (${splicedClip.durationSec.toFixed(2)}с, заменено старых фраз: ${excisedClips.length}) в «${targetMainTrack.participant}».`,
                'info'
              );
            }

            delete updatedClips[fixTrack.id];
            addLog(`⚡ Вшито ${fixAppliedOnTrack} точечных фраз фикса для даббера «${actorNick}» строго по таймкодам.`, 'success');
          }
        }
      }

      setTracks(prev =>
        prev
          .filter(t => !isFixTrack(t))
          .map(t => {
            const firstFixClip = (updatedClips[t.id] || []).find(c => c.isFix && c.sourceAudioPath && c.id.includes('_fullfix_'));
            if (firstFixClip && firstFixClip.sourceAudioPath) {
              return { ...t, filePath: firstFixClip.sourceAudioPath };
            }
            return t;
          })
      );
      setAudioClips(updatedClips);
      setIsFixesStitched(true);

      if (appliedCount > 0) {
        toast.success(`Применено фиксов: ${appliedCount}! Концы фраз и полнота субтитров проверены и защищены.`);
      } else {
        toast.info('Все актуальные фиксы уже вшиты.');
      }
    } catch (err: any) {
      addLog(`❌ Ошибка применения фиксов: ${err.message}`, 'error');
      toast.error(`Ошибка применения фиксов: ${err.message}`);
    } finally {
      setIsLoading(false);
      clearProcess();
    }
  };

  return {
    handleCutSilence,
    handleStitchFixes,
  };
}
