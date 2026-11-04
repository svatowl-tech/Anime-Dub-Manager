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

export async function runStage1TimingAnalysisEngine(params: {
  tracks: Track[];
  audioClips: Record<string, AudioClip[]>;
  isSilenceRemoved: boolean;
  audioBuffersRef: { current: Record<string, AudioBuffer> };
  timingSettings: TimingSettings;
  trackSubLinesMap: Record<string, SubtitleLine[]>;
  setStatusMessage: (msg: string) => void;
  addLog: (msg: string, level?: "info" | "success" | "warn" | "error") => void;
}): Promise<{
  updatedClips: Record<string, AudioClip[]>;
  newIssues: TimingIssue[];
  newMissingMarkers: MissingSubtitleMarker[];
  newCollisions: VoiceCollisionMarker[];
  didCutSilence: boolean;
}> {
  const {
    tracks,
    audioClips,
    isSilenceRemoved,
    audioBuffersRef,
    timingSettings,
    trackSubLinesMap,
    setStatusMessage,
    addLog
  } = params;

  let currentClips = { ...audioClips };
  let didCutSilence = false;

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
    didCutSilence = true;
  }

  const updatedClips: Record<string, AudioClip[]> = {};
  const newIssues: TimingIssue[] = [];
  const newMissingMarkers: MissingSubtitleMarker[] = [];
  const newCollisions: VoiceCollisionMarker[] = [];

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

    for (let cIdx = 0; cIdx < clips.length; cIdx++) {
      if (orphanTranscriptionMap[clips[cIdx].id]) {
        clips[cIdx] = { ...clips[cIdx], recognizedText: orphanTranscriptionMap[clips[cIdx].id] };
      }
    }

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

      const prevClipEnd = cIdx > 0
        ? (mappedClips[cIdx - 1].clipStartSec + (mappedClips[cIdx - 1].offsetSec || 0) + mappedClips[cIdx - 1].durationSec + 0.04)
        : 0;
      const nextClipStart = cIdx + 1 < clips.length
        ? (clips[cIdx + 1].clipStartSec + (clips[cIdx + 1].offsetSec || 0) - 0.04)
        : Infinity;

      if (bestSub && bestSubIdx !== -1) {
        const maxShift = 1.5;
        let surgicalTarget = Math.max(cStart - maxShift, Math.min(cStart + maxShift, bestSub.startSec));
        surgicalTarget = Math.max(prevClipEnd, Math.min(surgicalTarget, Math.max(prevClipEnd, nextClipStart - clip.durationSec)));
        surgicalTarget = Number(Math.max(0, surgicalTarget).toFixed(3));

        const rawTimeDiff = cStart - bestSub.startSec;
        const absRawDiff = Math.abs(rawTimeDiff);
        const effectiveShift = Math.abs(surgicalTarget - cStart);

        clip.text = bestSub.text;
        clip.targetSubStartSec = surgicalTarget;
        clip.targetSubEndSec = bestSub.endSec;
        clip.timeDiffSec = Number(rawTimeDiff.toFixed(2));
        if (matchedByWhisper) {
          clip.whisperMatchedScore = clipWhisperScore[cIdx];
        }

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
          clip.timingIssue = null;
          clip.timingIssueText = undefined;
        }
      } else {
        clip.timingIssue = null;
        clip.timingIssueText = undefined;
        clip.targetSubStartSec = undefined;
      }

      mappedClips.push(clip);
    }

    for (let sIdx = 0; sIdx < trSubs.length; sIdx++) {
      if (!assignedSubIndices.has(sIdx)) {
        const sub = trSubs[sIdx];
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

  return {
    updatedClips,
    newIssues,
    newMissingMarkers,
    newCollisions,
    didCutSilence
  };
}
