import { Episode, Track, SubtitleLine } from '../../../types';
import {
  MissingLineDetection,
  DecodedTrackContext,
  VoicedLineRecord,
  formatTimecode,
} from './missingLinesTypes';
import {
  analyzeSegmentDynamics,
  findVoicedBoundaries,
  findFullPhraseSilenceBoundaries,
} from './missingLinesDspEngine';

export interface ScanMissingAndTimingOptions {
  episode: Episode;
  validSubLines: SubtitleLine[];
  decodedTracks: DecodedTrackContext[];
  aliases: Record<string, string>;
  minDurationSec: number;
  silencePeakThresholdDb: number;
  silenceRmsThresholdDb: number;
  speechDynamicThresholdDb: number;
  scanMissingLines: boolean;
  scanTimingMismatches: boolean;
  shortLineThresholdPercent: number;
  longLineThresholdPercent: number;
  originalAudioBuffer: AudioBuffer | null;
}

export function scanSubtitlesForMissingAndTiming({
  episode,
  validSubLines,
  decodedTracks,
  aliases,
  minDurationSec,
  silencePeakThresholdDb,
  silenceRmsThresholdDb,
  speechDynamicThresholdDb,
  scanMissingLines,
  scanTimingMismatches,
  shortLineThresholdPercent,
  longLineThresholdPercent,
  originalAudioBuffer,
}: ScanMissingAndTimingOptions): {
  results: MissingLineDetection[];
  voicedLines: VoicedLineRecord[];
  longTimingDetections: Map<string, MissingLineDetection>;
} {
  const results: MissingLineDetection[] = [];
  const voicedLines: VoicedLineRecord[] = [];
  const longTimingDetections = new Map<string, MissingLineDetection>();

  for (let lineIdx = 0; lineIdx < validSubLines.length; lineIdx++) {
    const line = validSubLines[lineIdx];
    const rawCharName = (line.name || '').trim();
    const resolvedCharName = (aliases[rawCharName] || rawCharName).trim();
    const rawCharLower = rawCharName.toLowerCase();
    const resolvedCharLower = resolvedCharName.toLowerCase();

    const assignmentForLine = (episode.assignments || []).find(a => {
      const char = (a.characterName || '').toLowerCase().trim();
      return char === rawCharLower || char === resolvedCharLower;
    });

    const matchingTracks = decodedTracks.filter(ctx => {
      if (ctx.assignedCharacters.has(rawCharLower) || ctx.assignedCharacters.has(resolvedCharLower)) {
        return true;
      }
      if (assignmentForLine) {
        const targetDubberId = assignmentForLine.substituteId || assignmentForLine.dubberId;
        if (targetDubberId && ctx.track.id === targetDubberId) return true;

        const dubberParticipant = assignmentForLine.substitute?.nickname || assignmentForLine.dubber?.nickname;
        if (dubberParticipant && ctx.track.participant && ctx.track.participant.toLowerCase().trim() === dubberParticipant.toLowerCase().trim()) {
          return true;
        }
      }
      return false;
    });

    if (matchingTracks.length === 0) continue;

    const startSec = Math.max(0, line.startSec);
    const cleanedText = line.text
      .replace(/\{[^}]+\}/g, '')
      .replace(/\\N/gi, ' ')
      .replace(/\\n/gi, ' ')
      .replace(/\\h/gi, ' ')
      .trim();

    const trackAnalyses = matchingTracks.map(ctx => {
      const { audioBuffer, fixBuffer } = ctx;

      if (fixBuffer && fixBuffer.length > 0) {
        const fixEndSec = Math.min(fixBuffer.duration, line.endSec);
        const fixDur = fixEndSec - startSec;
        if (fixDur >= minDurationSec) {
          const fixMetrics = analyzeSegmentDynamics(fixBuffer, startSec, fixEndSec);
          const fixSilence = fixMetrics.peakDb <= silencePeakThresholdDb || fixMetrics.rmsDb <= silenceRmsThresholdDb;
          const fixStationary = 
            fixMetrics.dynamicRangeDb < speechDynamicThresholdDb &&
            fixMetrics.peakToMinDb < (speechDynamicThresholdDb + 1.2) &&
            fixMetrics.stdDevDb < 1.0 &&
            fixMetrics.peakDb < -24;
          if (!fixSilence && !fixStationary) {
            return {
              ctx: { ...ctx, audioBuffer: fixBuffer, audioUrl: ctx.fixAudioUrl || ctx.audioUrl },
              isVoiced: true,
              isAbsoluteSilence: false,
              isStationaryNoise: false,
              metrics: fixMetrics,
              durationSec: fixDur,
              startSec,
              endSec: fixEndSec
            };
          }
        }
      }

      const endSec = Math.min(audioBuffer.duration, line.endSec);
      const durationSec = endSec - startSec;

      if (durationSec < minDurationSec) {
        return { ctx, isVoiced: false, isAbsoluteSilence: true, isStationaryNoise: false, metrics: null, durationSec, startSec, endSec };
      }

      const metrics = analyzeSegmentDynamics(audioBuffer, startSec, endSec);
      const isAbsoluteSilence = metrics.peakDb <= silencePeakThresholdDb || metrics.rmsDb <= silenceRmsThresholdDb;
      const isStationaryNoise = 
        metrics.dynamicRangeDb < speechDynamicThresholdDb &&
        metrics.peakToMinDb < (speechDynamicThresholdDb + 1.2) &&
        metrics.stdDevDb < 1.0 &&
        metrics.peakDb < -24;

      const isVoiced = !isAbsoluteSilence && !isStationaryNoise;
      return { ctx, isVoiced, isAbsoluteSilence, isStationaryNoise, metrics, durationSec, startSec, endSec };
    });

    const validAnalyses = trackAnalyses.filter(a => a.durationSec >= minDurationSec);
    if (validAnalyses.length === 0) continue;

    const voicedAnalyses = validAnalyses.filter(a => a.isVoiced);

    if (voicedAnalyses.length > 0) {
      voicedAnalyses.sort((a, b) => (b.metrics?.peakDb || -100) - (a.metrics?.peakDb || -100));
      const bestAnalysis = voicedAnalyses[0];
      const { ctx, metrics, durationSec, startSec: calcStart, endSec: calcEnd } = bestAnalysis;
      const { track, audioBuffer, audioUrl } = ctx;

      const matchingAssignment = assignmentForLine || (episode.assignments || []).find(a => {
        const assignedId = a.substituteId || a.dubberId;
        const char = (a.characterName || '').toLowerCase().trim();
        return assignedId === track.id && (char === rawCharLower || char === resolvedCharLower);
      });

      const searchStart = Math.max(0, calcStart - 0.4);
      const searchEnd = Math.min(audioBuffer.duration, calcEnd + 1.5);
      const boundaries = findVoicedBoundaries(audioBuffer, searchStart, searchEnd, speechDynamicThresholdDb - 0.2);

      if (boundaries.isVoiced) {
        const voicedRecord: VoicedLineRecord = {
          track,
          audioBuffer,
          audioUrl,
          line,
          lineIndex: line.rawLineIndex ?? lineIdx,
          subId: line.id ? String(line.id) : String(line.rawLineIndex ?? lineIdx),
          rawCharName,
          resolvedCharName: resolvedCharName || track.character,
          matchingAssignmentId: matchingAssignment?.id,
          subStartSec: calcStart,
          subEndSec: calcEnd,
          subDurationSec: durationSec,
          speechStartSec: boundaries.speechStartSec,
          speechEndSec: boundaries.speechEndSec,
          speechDurationSec: boundaries.speechDurationSec,
          metrics: metrics!,
          cleanedText
        };
        voicedLines.push(voicedRecord);

        if (scanTimingMismatches) {
          const speechDur = boundaries.speechDurationSec;
          const subDur = durationSec;

          const shortRatio = (subDur - speechDur) / subDur;
          const shortThreshold = (shortLineThresholdPercent || 30) / 100;
          const tailSec = Math.max(0, calcEnd - boundaries.speechEndSec);

          if (shortRatio > shortThreshold && (subDur - speechDur) >= 0.35 && (tailSec >= 0.28 || shortRatio >= 0.30)) {
            const timingDeltaPercent = -Math.round(shortRatio * 100);
            const tailDurationSec = Math.round(tailSec * 10) / 10;

            results.push({
              id: `timing_short_${track.id}_${line.rawLineIndex ?? lineIdx}_${calcStart.toFixed(2)}`,
              defectCategory: 'timing_too_short',
              trackId: track.id,
              dubberName: track.participant,
              characterName: resolvedCharName || track.character,
              assignmentId: matchingAssignment?.id,
              lineIndex: line.rawLineIndex ?? lineIdx,
              subId: line.id ? String(line.id) : String(line.rawLineIndex ?? lineIdx),
              startSec: calcStart,
              endSec: calcEnd,
              startFormatted: formatTimecode(calcStart),
              endFormatted: formatTimecode(calcEnd),
              durationSec: Math.round(durationSec * 10) / 10,
              text: cleanedText,
              peakDb: boundaries.peakDb,
              rmsDb: boundaries.rmsDb,
              dynamicRangeDb: metrics!.dynamicRangeDb,
              type: 'timing_too_short',
              typeLabel: `⏱ Фраза короче саба на ${Math.abs(timingDeltaPercent)}% (>30%)`,
              selected: true,
              actualSpeechStartSec: boundaries.speechStartSec,
              actualSpeechEndSec: boundaries.speechEndSec,
              actualDurationSec: boundaries.speechDurationSec,
              speechDurationSec: boundaries.speechDurationSec,
              subDurationSec: Math.round(durationSec * 10) / 10,
              timingDeltaPercent,
              tailDurationSec,
              comment: `Фраза короче саба на ${Math.abs(timingDeltaPercent)}% (речь ${boundaries.speechDurationSec}с при сабе ${durationSec.toFixed(1)}с). Японский хвост оригинала: ~${tailDurationSec}с`,
              audioUrl,
              audioBuffer,
              originalAudioBuffer,
              resolutionAction: 'note_sound_engineer'
            });
          }

          const longRatio = (speechDur - subDur) / subDur;
          const longThreshold = (longLineThresholdPercent || 40) / 100;
          const overflowSec = Math.max(0, boundaries.speechEndSec - calcEnd);

          if (longRatio > longThreshold && (speechDur - subDur) >= 0.35) {
            const timingDeltaPercent = Math.round(longRatio * 100);
            const overflowDurationSec = Math.round(overflowSec * 10) / 10;
            const expandedEnd = Math.max(calcEnd, boundaries.speechEndSec);

            const lineKey = `${track.id}_${line.rawLineIndex ?? lineIdx}`;
            longTimingDetections.set(lineKey, {
              id: `timing_long_${track.id}_${line.rawLineIndex ?? lineIdx}_${calcStart.toFixed(2)}`,
              defectCategory: 'timing_too_long',
              trackId: track.id,
              dubberName: track.participant,
              characterName: resolvedCharName || track.character,
              assignmentId: matchingAssignment?.id,
              lineIndex: line.rawLineIndex ?? lineIdx,
              subId: line.id ? String(line.id) : String(line.rawLineIndex ?? lineIdx),
              startSec: calcStart,
              endSec: expandedEnd,
              startFormatted: formatTimecode(calcStart),
              endFormatted: formatTimecode(expandedEnd),
              durationSec: Math.round(boundaries.speechDurationSec * 10) / 10,
              text: cleanedText,
              peakDb: boundaries.peakDb,
              rmsDb: boundaries.rmsDb,
              dynamicRangeDb: metrics!.dynamicRangeDb,
              type: 'timing_too_long',
              typeLabel: `⏱ Фраза длиннее саба на +${timingDeltaPercent}% (>40%)`,
              selected: true,
              actualSpeechStartSec: boundaries.speechStartSec,
              actualSpeechEndSec: boundaries.speechEndSec,
              actualDurationSec: boundaries.speechDurationSec,
              speechDurationSec: boundaries.speechDurationSec,
              subDurationSec: Math.round(durationSec * 10) / 10,
              timingDeltaPercent,
              overflowDurationSec,
              comment: `Фраза длиннее саба на +${timingDeltaPercent}% (речь ${boundaries.speechDurationSec}с при сабе ${durationSec.toFixed(1)}с, вылет на +${overflowDurationSec}с). Рекомендуется поджать тайминг звукорежиссеру`,
              audioUrl,
              audioBuffer,
              originalAudioBuffer,
              resolutionAction: 'note_sound_engineer'
            });
          }
        }
      }
    } else {
      if (!scanMissingLines) continue;

      const primaryAnalysis = validAnalyses[0];
      const { ctx, metrics, durationSec, startSec: calcStart, endSec: calcEnd } = primaryAnalysis;
      const { track, audioBuffer, audioUrl } = ctx;

      const isAbsSilence = validAnalyses.every(a => a.isAbsoluteSilence);
      const gapType: 'silence' | 'noise' = isAbsSilence ? 'silence' : 'noise';
      const typeLabel = isAbsSilence 
        ? '🔇 Тишина' 
        : `〰 Статичный фон (разбег ${metrics?.dynamicRangeDb || 0} дБ)`;

      const matchingAssignment = assignmentForLine || (episode.assignments || []).find(a => {
        const assignedId = a.substituteId || a.dubberId;
        const char = (a.characterName || '').toLowerCase().trim();
        return assignedId === track.id && (char === rawCharLower || char === resolvedCharLower);
      });

      results.push({
        id: `gap_${track.id}_${line.rawLineIndex ?? lineIdx}_${calcStart.toFixed(2)}`,
        defectCategory: 'missing_line',
        trackId: track.id,
        dubberName: track.participant,
        characterName: resolvedCharName || track.character,
        assignmentId: matchingAssignment?.id,
        lineIndex: line.rawLineIndex ?? lineIdx,
        subId: line.id ? String(line.id) : String(line.rawLineIndex ?? lineIdx),
        startSec: calcStart,
        endSec: calcEnd,
        startFormatted: formatTimecode(calcStart),
        endFormatted: formatTimecode(calcEnd),
        durationSec: Math.round(durationSec * 10) / 10,
        text: cleanedText,
        peakDb: metrics?.peakDb || -60,
        rmsDb: metrics?.rmsDb || -60,
        dynamicRangeDb: metrics?.dynamicRangeDb || 0,
        type: gapType,
        typeLabel,
        selected: true,
        comment: `Пропуск реплики [${formatTimecode(calcStart)}]: "${cleanedText}"`,
        audioUrl,
        audioBuffer,
        originalAudioBuffer,
        resolutionAction: 'keep'
      });
    }
  }

  return { results, voicedLines, longTimingDetections };
}

export function scanUnwantedSpeechGaps(
  decodedTracks: DecodedTrackContext[],
  validSubLines: SubtitleLine[],
  aliases: Record<string, string>,
  speechDynamicThresholdDb: number,
  originalAudioBuffer: AudioBuffer | null
): MissingLineDetection[] {
  const results: MissingLineDetection[] = [];

  for (const trackCtx of decodedTracks) {
    const { track, audioBuffer, audioUrl, assignedCharacters } = trackCtx;
    const duration = audioBuffer.duration;
    if (duration <= 1.0) continue;

    const protectedIntervals: { start: number; end: number }[] = [];

    for (const line of validSubLines) {
      const rawCharName = (line.name || '').trim();
      const resolvedCharName = (aliases[rawCharName] || rawCharName).trim();
      const isThisChar = assignedCharacters.has(rawCharName.toLowerCase()) || 
                         assignedCharacters.has(resolvedCharName.toLowerCase());

      const marginPre = isThisChar ? 2.0 : 1.2;
      const marginPost = isThisChar ? 2.5 : 1.5;

      protectedIntervals.push({
        start: Math.max(0, line.startSec - marginPre),
        end: Math.min(duration, line.endSec + marginPost)
      });
    }

    protectedIntervals.sort((a, b) => a.start - b.start);
    const mergedProtected: { start: number; end: number }[] = [];
    for (const cur of protectedIntervals) {
      if (mergedProtected.length === 0) {
        mergedProtected.push({ ...cur });
      } else {
        const last = mergedProtected[mergedProtected.length - 1];
        if (cur.start <= last.end) {
          last.end = Math.max(last.end, cur.end);
        } else {
          mergedProtected.push({ ...cur });
        }
      }
    }

    const candidateGaps: { start: number; end: number }[] = [];
    let cursor = 0;
    for (const p of mergedProtected) {
      if (p.start - cursor >= 1.2) {
        candidateGaps.push({ start: cursor, end: p.start });
      }
      cursor = Math.max(cursor, p.end);
    }
    if (duration - cursor >= 1.2) {
      candidateGaps.push({ start: cursor, end: duration });
    }

    for (const gap of candidateGaps) {
      const gapDuration = gap.end - gap.start;
      if (gapDuration < 1.0) continue;

      const windowSizeSec = 0.3;
      const hopSec = 0.15;
      let speechActive = false;
      let speechStart = 0;
      let speechEnd = 0;

      for (let t = gap.start; t + windowSizeSec <= gap.end; t += hopSec) {
        const wMetrics = analyzeSegmentDynamics(audioBuffer, t, t + windowSizeSec);
        const isVoiced = wMetrics.peakDb > -36 && wMetrics.rmsDb > -46 && wMetrics.dynamicRangeDb >= (speechDynamicThresholdDb - 0.4);

        if (isVoiced) {
          if (!speechActive) {
            speechActive = true;
            speechStart = t;
            speechEnd = t + windowSizeSec;
          } else {
            speechEnd = t + windowSizeSec;
          }
        } else {
          if (speechActive) {
            const burstDuration = speechEnd - speechStart;
            if (burstDuration >= 0.35) {
              const burstMetrics = analyzeSegmentDynamics(audioBuffer, speechStart, speechEnd);
              if (burstMetrics.dynamicRangeDb >= speechDynamicThresholdDb && burstMetrics.peakDb > -36) {
                let prevSub: SubtitleLine | undefined;
                let nextSub: SubtitleLine | undefined;

                for (const l of validSubLines) {
                  if (l.endSec <= speechStart) {
                    if (!prevSub || l.endSec > prevSub.endSec) prevSub = l;
                  }
                  if (l.startSec >= speechEnd) {
                    if (!nextSub || l.startSec < nextSub.startSec) nextSub = l;
                  }
                }

                let contextStr = '';
                if (prevSub && nextSub) {
                  contextStr = `Между сабами #${(prevSub.rawLineIndex ?? 0) + 1} (${formatTimecode(prevSub.endSec)}) и #${(nextSub.rawLineIndex ?? 0) + 1} (${formatTimecode(nextSub.startSec)})`;
                } else if (prevSub) {
                  contextStr = `После саба #${(prevSub.rawLineIndex ?? 0) + 1} (${formatTimecode(prevSub.endSec)})`;
                } else if (nextSub) {
                  contextStr = `Перед сабом #${(nextSub.rawLineIndex ?? 0) + 1} (${formatTimecode(nextSub.startSec)})`;
                } else {
                  contextStr = `Вне таймингов субтитров`;
                }

                const startClean = Math.max(0, speechStart - 0.1);
                const endClean = Math.min(duration, speechEnd + 0.15);
                const durClean = Math.round((endClean - startClean) * 10) / 10;

                results.push({
                  id: `unwanted_${track.id}_${startClean.toFixed(2)}`,
                  defectCategory: 'unwanted_speech',
                  trackId: track.id,
                  dubberName: track.participant,
                  characterName: track.character,
                  lineIndex: prevSub ? (prevSub.rawLineIndex ?? 0) : 0,
                  subId: prevSub?.id ? String(prevSub.id) : undefined,
                  startSec: startClean,
                  endSec: endClean,
                  startFormatted: formatTimecode(startClean),
                  endFormatted: formatTimecode(endClean),
                  durationSec: durClean,
                  text: `Лишняя речь вне сабов (${durClean}с)`,
                  peakDb: burstMetrics.peakDb,
                  rmsDb: burstMetrics.rmsDb,
                  dynamicRangeDb: burstMetrics.dynamicRangeDb,
                  type: 'unwanted_speech',
                  typeLabel: '🎙 Озвучено вне сабов',
                  selected: true,
                  resolutionAction: 'silence',
                  nearestContext: contextStr,
                  comment: `Озвучено вне сабов [${formatTimecode(startClean)} - ${formatTimecode(endClean)}]: заменить тишиной`,
                  audioUrl,
                  audioBuffer,
                  originalAudioBuffer
                });
              }
            }
            speechActive = false;
          }
        }
      }
    }
  }

  return results;
}

export function scanDubberCollisions(
  decodedTracks: DecodedTrackContext[],
  validSubLines: SubtitleLine[],
  aliases: Record<string, string>,
  minDurationSec: number,
  speechDynamicThresholdDb: number,
  originalAudioBuffer: AudioBuffer | null
): MissingLineDetection[] {
  const results: MissingLineDetection[] = [];

  for (let lineIdx = 0; lineIdx < validSubLines.length; lineIdx++) {
    const line = validSubLines[lineIdx];
    const lineStart = Math.max(0, line.startSec);
    const lineEnd = line.endSec;
    const lineDuration = lineEnd - lineStart;
    if (lineDuration < minDurationSec) continue;

    const rawCharName = (line.name || '').trim();
    const resolvedCharName = (aliases[rawCharName] || rawCharName).trim();

    const cleanedLineText = (line.text || '').replace(/\{[^}]+\}/g, '').replace(/\\N/gi, ' ').trim().toLowerCase();
    const splitTokens = (str: string) =>
      str.split(/[,/&+]|(?:\s+и\s+)/i).map(s => s.trim().toLowerCase()).filter(Boolean);

    const lineAssignedCharTokens = new Set<string>([
      rawCharName.toLowerCase(),
      resolvedCharName.toLowerCase(),
      ...splitTokens(rawCharName),
      ...splitTokens(resolvedCharName)
    ]);

    for (const otherSub of validSubLines) {
      if (Math.abs(otherSub.startSec - lineStart) <= 0.08) {
        const otherCleaned = (otherSub.text || '').replace(/\{[^}]+\}/g, '').replace(/\\N/gi, ' ').trim().toLowerCase();
        if (otherCleaned && otherCleaned === cleanedLineText) {
          const oRaw = (otherSub.name || '').trim();
          const oRes = (aliases[oRaw] || oRaw).trim();
          if (oRaw) lineAssignedCharTokens.add(oRaw.toLowerCase());
          if (oRes) lineAssignedCharTokens.add(oRes.toLowerCase());
          splitTokens(oRaw).forEach(t => lineAssignedCharTokens.add(t));
          splitTokens(oRes).forEach(t => lineAssignedCharTokens.add(t));
        }
      }
    }

    const collidingActors: {
      track: Track;
      audioBuffer: AudioBuffer;
      audioUrl: string;
      metrics: ReturnType<typeof analyzeSegmentDynamics>;
      isAssigned: boolean;
    }[] = [];

    for (const trackCtx of decodedTracks) {
      const { track, audioBuffer, audioUrl, assignedCharacters } = trackCtx;
      if (lineEnd > audioBuffer.duration + 0.5) continue;

      const boundaries = findVoicedBoundaries(
        audioBuffer,
        Math.max(0, lineStart - 0.2),
        Math.min(audioBuffer.duration, lineEnd + 0.25),
        speechDynamicThresholdDb - 0.2
      );

      if (!boundaries.isVoiced) continue;

      const voicedStartInSub = Math.max(lineStart, boundaries.speechStartSec);
      const voicedEndInSub = Math.min(lineEnd, boundaries.speechEndSec);
      const voicedDurationInSub = Math.max(0, voicedEndInSub - voicedStartInSub);
      const subCoverageRatio = voicedDurationInSub / Math.max(0.1, lineDuration);

      const isTrueVoiceAcrossSub = 
        subCoverageRatio >= 0.45 &&
        voicedDurationInSub >= Math.min(0.45, lineDuration * 0.45) &&
        boundaries.speechStartSec <= lineStart + Math.max(0.6, lineDuration * 0.45) &&
        boundaries.speechEndSec >= lineEnd - Math.max(0.6, lineDuration * 0.45) &&
        boundaries.peakDb > -38;

      if (isTrueVoiceAcrossSub) {
        let isAssigned = false;
        for (const tok of lineAssignedCharTokens) {
          if (tok && assignedCharacters.has(tok)) {
            isAssigned = true;
            break;
          }
        }

        const metrics = analyzeSegmentDynamics(
          audioBuffer,
          lineStart,
          Math.min(audioBuffer.duration, lineEnd)
        );

        collidingActors.push({
          track,
          audioBuffer,
          audioUrl,
          metrics,
          isAssigned
        });
      }
    }

    if (collidingActors.length >= 2) {
      const distinctDubbers = new Set(collidingActors.map(a => a.track.participant?.trim().toLowerCase() || a.track.id));
      if (distinctDubbers.size < 2) continue;

      const assignedCount = collidingActors.filter(a => a.isAssigned).length;
      if (assignedCount >= 2) {
        continue;
      }

      collidingActors.sort((a, b) => (b.isAssigned ? 1 : 0) - (a.isAssigned ? 1 : 0));

      const actorA = collidingActors[0];
      const actorB = collidingActors[1];

      const cleanedText = line.text
        .replace(/\{[^}]+\}/g, '')
        .replace(/\\N/gi, ' ')
        .replace(/\\n/gi, ' ')
        .replace(/\\h/gi, ' ')
        .trim();

      const naturalA = findFullPhraseSilenceBoundaries(actorA.audioBuffer, lineStart, lineEnd);
      const naturalB = findFullPhraseSilenceBoundaries(actorB.audioBuffer, lineStart, lineEnd);

      results.push({
        id: `collision_${line.rawLineIndex ?? lineIdx}_${lineStart.toFixed(2)}`,
        defectCategory: 'actor_collision',
        trackId: actorA.track.id,
        dubberName: actorA.track.participant,
        characterName: actorA.track.character,
        lineIndex: line.rawLineIndex ?? lineIdx,
        subId: line.id ? String(line.id) : String(line.rawLineIndex ?? lineIdx),
        startSec: lineStart,
        endSec: lineEnd,
        naturalSilenceStartSec: naturalA.naturalStartSec,
        naturalSilenceEndSec: naturalA.naturalEndSec,
        secondNaturalSilenceStartSec: naturalB.naturalStartSec,
        secondNaturalSilenceEndSec: naturalB.naturalEndSec,
        startFormatted: formatTimecode(lineStart),
        endFormatted: formatTimecode(lineEnd),
        durationSec: Math.round(lineDuration * 10) / 10,
        text: cleanedText,
        peakDb: actorA.metrics.peakDb,
        rmsDb: actorA.metrics.rmsDb,
        dynamicRangeDb: actorA.metrics.dynamicRangeDb,
        type: 'actor_collision',
        typeLabel: '⚡ Конфликт: озвучили вдвоём',
        selected: true,
        resolutionAction: 'fix_subs',
        selectedCharacterForSub: actorA.track.character,
        audioUrl: actorA.audioUrl,
        audioBuffer: actorA.audioBuffer,
        originalAudioBuffer,
        secondTrackId: actorB.track.id,
        secondDubberName: actorB.track.participant,
        secondCharacterName: actorB.track.character,
        secondAudioUrl: actorB.audioUrl,
        secondAudioBuffer: actorB.audioBuffer,
        secondPeakDb: actorB.metrics.peakDb,
        secondRmsDb: actorB.metrics.rmsDb,
        secondDynamicRangeDb: actorB.metrics.dynamicRangeDb,
        comment: `Конфликт озвучки: реплику "${cleanedText}" озвучили ${actorA.track.participant} и ${actorB.track.participant}`
      });
    }
  }

  return results;
}

export function scanActorOverlaps(
  voicedLines: VoicedLineRecord[],
  longTimingDetections: Map<string, MissingLineDetection>,
  originalAudioBuffer: AudioBuffer | null
): MissingLineDetection[] {
  const results: MissingLineDetection[] = [];
  const sortedVoiced = [...voicedLines].sort((a, b) => a.speechStartSec - b.speechStartSec);

  for (let i = 0; i < sortedVoiced.length; i++) {
    const itemA = sortedVoiced[i];

    for (let j = i + 1; j < sortedVoiced.length; j++) {
      const itemB = sortedVoiced[j];

      if (itemB.speechStartSec >= itemA.speechEndSec) {
        break;
      }

      if (itemA.track.id === itemB.track.id || itemA.subId === itemB.subId) {
        continue;
      }

      const subOverlapStart = Math.max(itemA.subStartSec, itemB.subStartSec);
      const subOverlapEnd = Math.min(itemA.subEndSec, itemB.subEndSec);
      const subOverlapDuration = subOverlapEnd - subOverlapStart;
      if (subOverlapDuration > 0.08) {
        continue;
      }

      const overlapStart = Math.max(itemA.speechStartSec, itemB.speechStartSec);
      const overlapEnd = Math.min(itemA.speechEndSec, itemB.speechEndSec);
      const speechOverlapDuration = overlapEnd - overlapStart;

      const subBoundaryOverrun = itemA.speechEndSec - itemB.subStartSec;
      const overlapDuration = Math.max(
        speechOverlapDuration,
        (speechOverlapDuration > 0 || subBoundaryOverrun >= 0.15) ? subBoundaryOverrun : 0
      );

      if (overlapDuration >= 0.12) {
        const overlapSecRounded = Math.round(overlapDuration * 100) / 100;
        const collisionStart = Math.max(0, overlapStart - 0.25);
        const collisionEnd = overlapEnd + 0.25;

        const longKeyA = `${itemA.track.id}_${itemA.lineIndex}`;
        const longCandidateA = longTimingDetections.get(longKeyA);

        const isMerged = !!longCandidateA;
        if (longCandidateA) {
          longCandidateA.isTimingTooLongMerged = true;
        }

        const timingDeltaPercent = longCandidateA?.timingDeltaPercent;
        const overflowDurationSec = longCandidateA?.overflowDurationSec;

        const typeLabel = isMerged
          ? `⚡ Наезд хвостом + вылет тайминга (+${timingDeltaPercent}%)`
          : `⚡ Наезд хвостом (${overlapSecRounded}с)`;

        const comment = isMerged
          ? `Фраза ${itemA.track.participant} (${itemA.resolvedCharName}) длиннее саба на +${timingDeltaPercent}% (вылет +${overflowDurationSec}с) и залезла на ${overlapSecRounded}с на начало реплики ${itemB.track.participant} (${itemB.resolvedCharName}). Объединено в один фикс: требуется поджать фразу и развести стык звукорежиссеру.`
          : `Наезд дублеров: хвост реплики ${itemA.track.participant} (${itemA.resolvedCharName}) залез на ${overlapSecRounded}с на начало реплики ${itemB.track.participant} (${itemB.resolvedCharName}). Требуется разводка или подрезка стыка звукорежиссером.`;

        const naturalA = findFullPhraseSilenceBoundaries(itemA.audioBuffer, itemA.speechStartSec, itemA.speechEndSec);
        const naturalB = findFullPhraseSilenceBoundaries(itemB.audioBuffer, itemB.speechStartSec, itemB.speechEndSec);

        results.push({
          id: `overlap_${itemA.track.id}_${itemB.track.id}_${itemA.lineIndex}_${itemB.lineIndex}_${overlapStart.toFixed(2)}`,
          defectCategory: 'actor_overlap',
          isTimingTooLongMerged: isMerged,
          trackId: itemA.track.id,
          dubberName: itemA.track.participant,
          characterName: itemA.resolvedCharName,
          assignmentId: itemA.matchingAssignmentId,
          lineIndex: itemA.lineIndex,
          subId: itemA.subId,
          startSec: collisionStart,
          endSec: collisionEnd,
          naturalSilenceStartSec: naturalA.naturalStartSec,
          naturalSilenceEndSec: naturalA.naturalEndSec,
          secondNaturalSilenceStartSec: naturalB.naturalStartSec,
          secondNaturalSilenceEndSec: naturalB.naturalEndSec,
          startFormatted: formatTimecode(collisionStart),
          endFormatted: formatTimecode(collisionEnd),
          durationSec: Math.round((collisionEnd - collisionStart) * 10) / 10,
          text: `[${itemA.track.participant}]: "${itemA.cleanedText}"`,
          peakDb: itemA.metrics.peakDb,
          rmsDb: itemA.metrics.rmsDb,
          dynamicRangeDb: itemA.metrics.dynamicRangeDb,
          type: 'actor_overlap',
          typeLabel,
          selected: true,
          resolutionAction: 'note_sound_engineer',
          audioUrl: itemA.audioUrl,
          audioBuffer: itemA.audioBuffer,
          originalAudioBuffer,
          secondTrackId: itemB.track.id,
          secondDubberName: itemB.track.participant,
          secondCharacterName: itemB.resolvedCharName,
          secondAssignmentId: itemB.matchingAssignmentId,
          secondAudioUrl: itemB.audioUrl,
          secondAudioBuffer: itemB.audioBuffer,
          secondPeakDb: itemB.metrics.peakDb,
          secondRmsDb: itemB.metrics.rmsDb,
          secondDynamicRangeDb: itemB.metrics.dynamicRangeDb,
          secondText: `[${itemB.track.participant}]: "${itemB.cleanedText}"`,
          secondLineIndex: itemB.lineIndex,
          secondSubId: itemB.subId,
          overlapSec: overlapSecRounded,
          timingDeltaPercent,
          overflowDurationSec,
          speechDurationSec: itemA.speechDurationSec,
          subDurationSec: itemA.subDurationSec,
          actualDurationSec: itemA.speechDurationSec,
          comment
        });
      }
    }
  }

  for (const longDet of longTimingDetections.values()) {
    if (!longDet.isTimingTooLongMerged) {
      results.push(longDet);
    }
  }

  return results;
}
