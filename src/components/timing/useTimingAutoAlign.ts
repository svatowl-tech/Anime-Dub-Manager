import React from "react";
import { toast } from "sonner";
import { Track, SubtitleLine } from "../../types";
import { ipcSafe } from "../../lib/ipcSafe";
import { getSharedAudioContext } from "../../lib/qa/sharedAudioContext";
import { TimingSettings } from "../TimingSettingsModal";
import {
  AudioClip,
  TimingIssue,
  MissingSubtitleMarker,
  VoiceCollisionMarker,
  calculateTextSimilarity,
  isFixTrack,
  formatSeconds,
  getPlayableAudioUrl,
  detectSpeechIntervals,
  isPhraseTimingNotRequired,
  normalizeName
} from "./timingAudioUtils";

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

      let currentClips = { ...audioClips };

      // Ensure silence is cut into audio clips if not yet done
      const hasUncutTracks = tracks.some(t => {
        const c = currentClips[t.id];
        return !c || c.length <= 1;
      });

      if (!isSilenceRemoved || hasUncutTracks) {
        setStatusMessage('Удаление тишины и нарезка речевых интервалов...');
        for (const track of tracks) {
          let audioBuf = audioBuffersRef.current[track.id];
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
            } catch (e) {}
          }
          if (audioBuf) {
            const intervals = detectSpeechIntervals(audioBuf, {
              minSilenceDurationSec: timingSettings.minSilenceDurationSec,
              leadInPaddingSec: timingSettings.leadInPaddingSec,
              leadOutPaddingSec: timingSettings.leadOutPaddingSec,
              minSpeechDurationSec: timingSettings.minSpeechDurationSec,
              mergeCloseGapsSec: timingSettings.mergeCloseGapsSec
            });
            const trSubs = trackSubLinesMap[track.id] || [];
            currentClips[track.id] = intervals.map((iv, idx) => {
              const sub = trSubs[idx];
              return {
                id: `clip_${track.id}_${idx}`,
                trackId: track.id,
                dubberName: track.participant || track.dubberName || 'Даббер',
                characterName: track.character || track.characterName || 'Персонаж',
                clipStartSec: iv.startSec,
                durationSec: iv.durationSec,
                sourceStartSec: iv.startSec,
                sourceEndSec: iv.endSec,
                rawSourceStartSec: iv.startSec,
                rawSourceEndSec: iv.endSec,
                text: sub?.text || `Фраза ${idx + 1}`,
                volumePercent: 100,
                isFix: isFixTrack(track),
                hasCollision: false,
                offsetSec: 0
              };
            });
          }
        }
        setIsSilenceRemoved(true);
      }

      const updatedClips: Record<string, AudioClip[]> = {};
      const newIssues: TimingIssue[] = [];
      const newMissingMarkers: MissingSubtitleMarker[] = [];
      const newCollisions: VoiceCollisionMarker[] = [];

      // Pass 1: Identify orphan clips (> 3.5s away from unassigned subtitles) and run Whisper for them
      const orphanClipsByTrack: Record<string, AudioClip[]> = {};
      for (const track of tracks) {
        const clips = currentClips[track.id] || [];
        const trSubs = trackSubLinesMap[track.id] || [];
        const orphans: AudioClip[] = [];

        clips.forEach(clip => {
          const cStart = clip.clipStartSec + (clip.offsetSec || 0);
          const hasNearbySub = trSubs.some(s => Math.abs(cStart - s.startSec) <= 3.5);
          if (!hasNearbySub && !clip.recognizedText) {
            orphans.push(clip);
          }
        });
        if (orphans.length > 0) {
          orphanClipsByTrack[track.id] = orphans;
        }
      }

      // Run Whisper for orphan clips if any exist
      const orphanTranscriptionMap: Record<string, string> = {};
      for (const track of tracks) {
        const orphans = orphanClipsByTrack[track.id];
        if (!orphans || orphans.length === 0) continue;

        setStatusMessage(`Whisper: распознавание висящих в воздухе фраз «${track.participant || track.dubberName}» (${orphans.length} фраз)...`);
        addLog(`🎙 Whisper: анализ ${orphans.length} висящих в воздухе фраз для «${track.participant || track.dubberName}»...`, 'info');

        const whisperPayload = orphans.map(c => ({
          id: c.id,
          startSec: c.sourceStartSec,
          endSec: c.sourceEndSec,
          hint: c.text
        }));

        try {
          const resp: any = await ipcSafe.invoke('timing-whisper-transcribe-clips', {
            audioFilePath: track.filePath,
            clips: whisperPayload,
            model: 'tiny',
            language: 'ru'
          });
          if (resp && Array.isArray(resp.results)) {
            resp.results.forEach((r: any) => {
              if (r.id && r.text) {
                orphanTranscriptionMap[r.id] = r.text.trim();
              }
            });
          }
        } catch (wErr: any) {
          console.warn('[Whisper AutoTiming Orphans] IPC error:', wErr);
        }
      }

      // Pass 2: Surgical Two-Pass Matching — Lock well-placed phrases FIRST so no phrase ever steals a neighbor's subtitle
      for (const track of tracks) {
        const dubberName = track.participant || track.dubberName || 'Даббер';
        const characterName = track.character || track.characterName || 'Персонаж';
        const clips = [...(currentClips[track.id] || [])].sort(
          (a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0))
        );
        const trSubs = trackSubLinesMap[track.id] || [];

        const assignedSubIndices = new Set<number>();
        const clipMatchedSubIdx = new Array<number>(clips.length).fill(-1);
        const clipMatchedByWhisper = new Array<boolean>(clips.length).fill(false);
        const clipWhisperScore = new Array<number>(clips.length).fill(0);

        // Attach Whisper transcription if available
        for (let cIdx = 0; cIdx < clips.length; cIdx++) {
          if (orphanTranscriptionMap[clips[cIdx].id]) {
            clips[cIdx] = { ...clips[cIdx], recognizedText: orphanTranscriptionMap[clips[cIdx].id] };
          }
        }

        // Helper: checks if moving clip cIdx to targetStartSec stays strictly inside its intra-track corridor (never jumps over neighbor clips!)
        const isWithinTrackCorridor = (cIdx: number, targetStartSec: number): boolean => {
          const clip = clips[cIdx];
          const prevEnd = cIdx > 0
            ? (clips[cIdx - 1].clipStartSec + (clips[cIdx - 1].offsetSec || 0) + clips[cIdx - 1].durationSec + 0.03)
            : 0;
          const nextStart = cIdx + 1 < clips.length
            ? (clips[cIdx + 1].clipStartSec + (clips[cIdx + 1].offsetSec || 0) - 0.03)
            : Infinity;
          return targetStartSec >= prevEnd - 0.15 && (targetStartSec + Math.min(clip.durationSec, 1.2)) <= nextStart + 0.15;
        };

        // STEP 2A: Closest-pair local matching within surgical window (<= 2.0s)
        // Because pairs are sorted by distance ascending, phrases sitting right on their subtitle (0.0s - 0.35s)
        // ALWAYS lock their subtitle first and can NEVER be evicted by an adjacent clip!
        const candidatePairs: Array<{ cIdx: number; sIdx: number; diff: number }> = [];
        for (let cIdx = 0; cIdx < clips.length; cIdx++) {
          const cStart = clips[cIdx].clipStartSec + (clips[cIdx].offsetSec || 0);
          for (let sIdx = 0; sIdx < trSubs.length; sIdx++) {
            const sub = trSubs[sIdx];
            const diff = Math.abs(cStart - sub.startSec);
            if (diff <= 2.0 && isWithinTrackCorridor(cIdx, sub.startSec)) {
              candidatePairs.push({ cIdx, sIdx, diff });
            }
          }
        }
        candidatePairs.sort((a, b) => a.diff - b.diff);
        for (const pair of candidatePairs) {
          if (clipMatchedSubIdx[pair.cIdx] !== -1 || assignedSubIndices.has(pair.sIdx)) continue;
          clipMatchedSubIdx[pair.cIdx] = pair.sIdx;
          assignedSubIndices.add(pair.sIdx);
        }

        // STEP 2B: For still-unmatched clips, check Whisper text match ONLY within a safe local neighborhood (<= 3.5s) and inside the corridor
        // Never teleport a phrase across the episode!
        for (let cIdx = 0; cIdx < clips.length; cIdx++) {
          if (clipMatchedSubIdx[cIdx] !== -1) continue;
          const clip = clips[cIdx];
          const cStart = clip.clipStartSec + (clip.offsetSec || 0);
          if (!clip.recognizedText) continue;

          let bestSIdx = -1;
          let bestSim = 0;
          for (let sIdx = 0; sIdx < trSubs.length; sIdx++) {
            if (assignedSubIndices.has(sIdx)) continue;
            const sub = trSubs[sIdx];
            const timeDist = Math.abs(cStart - sub.startSec);
            if (timeDist > 3.5 || !isWithinTrackCorridor(cIdx, sub.startSec)) continue;
            const sim = calculateTextSimilarity(clip.recognizedText, sub.text);
            if (sim > bestSim && sim >= 0.65) {
              bestSim = sim;
              bestSIdx = sIdx;
            }
          }
          if (bestSIdx !== -1) {
            clipMatchedSubIdx[cIdx] = bestSIdx;
            assignedSubIndices.add(bestSIdx);
            clipMatchedByWhisper[cIdx] = true;
            clipWhisperScore[cIdx] = Math.round(bestSim * 100);
          }
        }

        const mappedClips: AudioClip[] = [];

        for (let cIdx = 0; cIdx < clips.length; cIdx++) {
          const clip = { ...clips[cIdx] };
          const cStart = clip.clipStartSec + (clip.offsetSec || 0);
          const bestSubIdx = clipMatchedSubIdx[cIdx];
          const bestSub = bestSubIdx !== -1 ? trSubs[bestSubIdx] : null;
          const matchedByWhisper = clipMatchedByWhisper[cIdx];

          // Compute strict surgical corridor between previous and next clip on this track
          const prevClipEnd = cIdx > 0
            ? (mappedClips[cIdx - 1].clipStartSec + (mappedClips[cIdx - 1].offsetSec || 0) + mappedClips[cIdx - 1].durationSec + 0.04)
            : 0;
          const nextClipStart = cIdx + 1 < clips.length
            ? (clips[cIdx + 1].clipStartSec + (clips[cIdx + 1].offsetSec || 0) - 0.04)
            : Infinity;

          if (bestSub && bestSubIdx !== -1) {
            // Calculate safe surgical target position clamped to local corridor and max surgical shift (1.5s)
            const maxShift = 1.5;
            let surgicalTarget = Math.max(cStart - maxShift, Math.min(cStart + maxShift, bestSub.startSec));
            surgicalTarget = Math.max(prevClipEnd, Math.min(surgicalTarget, Math.max(prevClipEnd, nextClipStart - clip.durationSec)));
            surgicalTarget = Number(Math.max(0, surgicalTarget).toFixed(3));

            const rawTimeDiff = cStart - bestSub.startSec; // Positive = late, negative = early
            const absRawDiff = Math.abs(rawTimeDiff);
            const effectiveShift = Math.abs(surgicalTarget - cStart);

            clip.text = bestSub.text;
            clip.targetSubStartSec = surgicalTarget;
            clip.targetSubEndSec = bestSub.endSec;
            clip.timeDiffSec = Number(rawTimeDiff.toFixed(2));
            if (matchedByWhisper) {
              clip.whisperMatchedScore = clipWhisperScore[cIdx];
            }

            // User Rule: If phrase does not exceed sub or tail <= 30% of sub duration, timing is NOT required!
            const timingExempt = isPhraseTimingNotRequired(cStart, clip.durationSec, bestSub.startSec, bestSub.endSec);

            if (timingExempt.notRequired) {
              clip.timingNotRequired = true;
              clip.timingNotRequiredReason = timingExempt.reason;
              clip.timingIssue = null;
              clip.timingIssueText = undefined;
              clip.targetSubStartSec = cStart;
            } else if (matchedByWhisper && effectiveShift >= 0.25) {
              clip.timingNotRequired = false;
              clip.timingIssue = 'orphan';
              clip.timingIssueText = `Whisper локальная подтяжка: «${clip.recognizedText?.slice(0, 20)}» ➔ [${formatSeconds(surgicalTarget)}]`;

              newIssues.push({
                id: `issue_orphan_matched_${clip.id}`,
                type: 'orphan',
                trackId: track.id,
                dubberName,
                characterName,
                clipId: clip.id,
                timeSec: cStart,
                durationSec: clip.durationSec,
                subText: bestSub.text,
                subStartSec: surgicalTarget,
                subEndSec: bestSub.endSec,
                whisperText: clip.recognizedText,
                whisperMatchScore: clipWhisperScore[cIdx],
                description: `Хирургическая привязка Whisper «${clip.recognizedText}» ➔ «${bestSub.text.slice(0, 35)}» [${formatSeconds(surgicalTarget)}]`
              });
            } else if (absRawDiff >= 0.32 && absRawDiff <= 1.8 && effectiveShift >= 0.12) {
              clip.timingNotRequired = false;
              clip.timingIssue = 'desync';
              clip.timingIssueText = rawTimeDiff > 0 
                ? `Опаздывает на +${absRawDiff.toFixed(2)}с (сдвиг до ${formatSeconds(surgicalTarget)})` 
                : `Спешит на -${absRawDiff.toFixed(2)}с (сдвиг до ${formatSeconds(surgicalTarget)})`;

              newIssues.push({
                id: `issue_desync_${clip.id}`,
                type: 'desync',
                trackId: track.id,
                dubberName,
                characterName,
                clipId: clip.id,
                timeSec: cStart,
                durationSec: clip.durationSec,
                subText: bestSub.text,
                subStartSec: surgicalTarget,
                subEndSec: bestSub.endSec,
                timeDiffSec: Number(rawTimeDiff.toFixed(2)),
                description: rawTimeDiff > 0
                  ? `Фраза #${cIdx + 1} опаздывает на +${absRawDiff.toFixed(2)}с: «${bestSub.text.slice(0, 35)}»`
                  : `Фраза #${cIdx + 1} спешит на -${absRawDiff.toFixed(2)}с: «${bestSub.text.slice(0, 35)}»`
              });
            } else {
              // In place or cannot be safely shifted without disturbing neighbor — untouched!
              clip.timingIssue = null;
              clip.timingIssueText = undefined;
            }
          } else {
            // Unmatched phrase: keep it strictly in place! Never move it into nowhere!
            clip.timingIssue = null;
            clip.timingIssueText = undefined;
            clip.targetSubStartSec = undefined;
          }

          mappedClips.push(clip);
        }

        // 3. Problem: Missing Subtitle Lines (есть в субтитрах, но нет на дорожке)
        for (let sIdx = 0; sIdx < trSubs.length; sIdx++) {
          if (!assignedSubIndices.has(sIdx)) {
            const sub = trSubs[sIdx];
            // Check if any clip covers this timeframe
            const hasAudioCover = mappedClips.some(c => {
              const cStart = c.clipStartSec + (c.offsetSec || 0);
              const cEnd = cStart + c.durationSec;
              return (cStart <= sub.endSec + 1.2 && cEnd >= sub.startSec - 1.2);
            });

            if (!hasAudioCover) {
              newIssues.push({
                id: `issue_missing_${track.id}_${sub.id || sIdx}`,
                type: 'missing',
                trackId: track.id,
                dubberName,
                characterName,
                timeSec: sub.startSec,
                durationSec: sub.endSec - sub.startSec,
                subText: sub.text,
                subStartSec: sub.startSec,
                subEndSec: sub.endSec,
                description: `Пропущена реплика «${characterName}»: «${sub.text.slice(0, 40)}» [${formatSeconds(sub.startSec)}]`
              });

              newMissingMarkers.push({
                id: `missing_${track.id}_${sub.id ?? sIdx}`,
                subId: String(sub.id ?? sIdx),
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

        updatedClips[track.id] = mappedClips;
      }

      // Pass 3: Problem: Overlaps / Collisions (Наезды фраз друг на друга)
      // 3A. Intra-track overlaps (наезды фраз внутри одной дорожки)
      for (const track of tracks) {
        const clips = updatedClips[track.id] || [];
        const sorted = [...clips].sort((a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0)));

        for (let i = 0; i < sorted.length - 1; i++) {
          const c1 = sorted[i];
          const c2 = sorted[i + 1];
          const c1End = (c1.clipStartSec + (c1.offsetSec || 0)) + c1.durationSec;
          const c2Start = c2.clipStartSec + (c2.offsetSec || 0);

          if (c1End > c2Start + 0.04) {
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

      // 3B. Inter-track collisions between different dubbers (ONLY when NOT specified in original subtitles!)
      const trackIds = Object.keys(updatedClips);
      for (let i = 0; i < trackIds.length; i++) {
        for (let j = i + 1; j < trackIds.length; j++) {
          const tr1Clips = updatedClips[trackIds[i]] || [];
          const tr2Clips = updatedClips[trackIds[j]] || [];

          for (const c1 of tr1Clips) {
            const c1Start = c1.clipStartSec + (c1.offsetSec || 0);
            const c1End = c1Start + c1.durationSec;

            for (const c2 of tr2Clips) {
              const c2Start = c2.clipStartSec + (c2.offsetSec || 0);
              const c2End = c2Start + c2.durationSec;

              const overlapStart = Math.max(c1Start, c2Start);
              const overlapEnd = Math.min(c1End, c2End);
              const overlapDur = overlapEnd - overlapStart;

              if (overlapDur > 0.08) {
                // Check if original subtitles for these two phrases overlap in the script
                const sub1 = trackSubLinesMap[trackIds[i]]?.find(s => 
                  s.text === c1.text || (typeof c1.targetSubStartSec === 'number' && Math.abs(s.startSec - c1.targetSubStartSec) < 0.15)
                );
                const sub2 = trackSubLinesMap[trackIds[j]]?.find(s => 
                  s.text === c2.text || (typeof c2.targetSubStartSec === 'number' && Math.abs(s.startSec - c2.targetSubStartSec) < 0.15)
                );

                let isSpecifiedInSubtitles = false;
                if (sub1 && sub2) {
                  const subOverlapStart = Math.max(sub1.startSec, sub2.startSec);
                  const subOverlapEnd = Math.min(sub1.endSec, sub2.endSec);
                  if (subOverlapEnd > subOverlapStart + 0.05) {
                    isSpecifiedInSubtitles = true;
                  }
                }

                // If specified in subtitles, this is intentional simultaneous dialogue! Not an issue!
                if (isSpecifiedInSubtitles) {
                  c1.isIntentionalOverlap = true;
                  c2.isIntentionalOverlap = true;
                  continue;
                }

                const normD1 = normalizeName(c1.dubberName).split(' ')[0];
                const normD2 = normalizeName(c2.dubberName).split(' ')[0];
                const isSameDubber = normD1 && normD1 === normD2;

                if (isSameDubber) {
                  c1.isSelfOverlap = true;
                  c2.isSelfOverlap = true;
                } else {
                  c1.hasCollision = true;
                  c2.hasCollision = true;
                  c1.overlappingClipId = c2.id;
                  c2.overlappingClipId = c1.id;
                  if (!c1.timingIssue) c1.timingIssue = 'overlap';
                  if (!c2.timingIssue) c2.timingIssue = 'overlap';

                  newCollisions.push({
                    id: `col_${c1.id}_${c2.id}`,
                    track1Id: trackIds[i],
                    track2Id: trackIds[j],
                    dubber1Name: c1.dubberName,
                    dubber2Name: c2.dubberName,
                    character1Name: c1.characterName,
                    character2Name: c2.characterName,
                    startSec: overlapStart,
                    endSec: overlapEnd,
                    overlapDurationSec: Number(overlapDur.toFixed(2))
                  });

                  newIssues.push({
                    id: `issue_overlap_inter_${c1.id}_${c2.id}`,
                    type: 'overlap',
                    trackId: trackIds[j],
                    dubberName: c2.dubberName,
                    characterName: c2.characterName,
                    clipId: c2.id,
                    timeSec: overlapStart,
                    durationSec: overlapDur,
                    overlapDurationSec: Number(overlapDur.toFixed(2)),
                    overlappingClipId: c1.id,
                    overlappingDubber: c1.dubberName,
                    description: `Наезд голосов (не в субтитрах): «${c1.dubberName}» и «${c2.dubberName}» (${overlapDur.toFixed(2)}с) [${formatSeconds(overlapStart)}]`
                  });
                }
              }
            }
          }
        }
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

  // ---------------------------------------------------------------------------
  // ЭТАП 2: ТОЧЕЧНЫЙ ХИРУРГИЧЕСКИЙ АВТОТАЙМИНГ
  // Работает ТОЛЬКО с помеченными проблемами! Не трогает дорожки и фразы, которые уже в порядке.
  // 1. Рассинхрон: пододвигает ТОЛЬКО смещенную фразу чисто механически к началу её субтитра.
  // 2. Whisper Orphan: подставляет висевшую в воздухе фразу точно под найденный субтитр.
  // 3. Наезды: точечно раздвигает только эти фразы (+0.04с буфер) ровно до прекращения пересечения.
  // 4. Пропуски: остаются помеченными для отдельной записи/импорта через "+ Загрузить".
  // ---------------------------------------------------------------------------
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

      // 1 & 2. Хирургическое выравнивание рассинхрона (Desync) и локальных фраз (Orphan) строго внутри коридора дорожки
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

            // Clamp surgical shift to max +/- 1.5s and strictly within [prevEnd, nextStart - durationSec]
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

      // 3. Хирургическое разведение наездов (Overlap) — раздвигает ровно до прекращения пересечения в пределах коридора
      if (typeFilter === 'all' || typeFilter === 'overlap') {
        // 3A. Intra-track overlaps
        for (const trackId of Object.keys(updatedClips)) {
          const clips = [...(updatedClips[trackId] || [])];
          clips.sort((a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0)));

          for (let i = 0; i < clips.length - 1; i++) {
            const c1 = clips[i];
            const c2 = clips[i + 1];
            const c1End = (c1.clipStartSec + (c1.offsetSec || 0)) + c1.durationSec;
            const c2Start = c2.clipStartSec + (c2.offsetSec || 0);

            if (c1End > c2Start) {
              // Попытаться слегка пододвинуть c1 назад к ее субтитру, если c1 затянулась
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

        // 3B. Inter-track collisions (только микро-раздвижение в пределах безопасного коридора <= 1.2с)
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

      // Re-filter remaining unresolved issues
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

  // Quick surgical fixer for an overlap collision (intra-track or inter-track)
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

      // Find overlapping partner clip
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
