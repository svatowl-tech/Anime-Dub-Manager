/**
 * Automatic Gap Detection Engine for Dubber Audio vs Subtitles
 * 
 * Orchestrates analysis of dubber audio tracks against assigned subtitle lines to find:
 * - Missing voiced lines (complete silence or stationary background noise without dialogue).
 * - Unwanted speech outside subtitle timestamps.
 * - Collisions and overlaps between concurrent dubbers.
 * - Timing mismatches (short speech / hanging original tail, or speech overrunning subtitles).
 * - Audio artifacts (clipping, clicks, plosives, gate cutoffs).
 * - Text discrepancies via Whisper ASR.
 */

import { Episode, Track, SubtitleLine } from '../../types';
import { SIGN_KEYWORDS } from '../../constants';
import { scanTrackForArtifacts } from './artifactDetector';
import {
  checkTrackTextWithWhisper,
  checkWhisperSystemReadiness,
} from './whisperTextChecker';

import {
  QAScanLogEntry,
  WhisperScanStatus,
  QAScanReport,
  DefectCategory,
  DefectType,
  DefectResolution,
  MissingLineDetection,
  GapDetectionOptions,
  DecodedTrackContext,
  VoicedLineRecord,
  formatTimecode,
  resolveAudioUrl,
  decodeAudioFile,
} from './detector/missingLinesTypes';

import {
  findFullPhraseSilenceBoundaries,
  silenceAudioBufferInterval,
  transferAudioBufferPhrase,
  analyzeSegmentDynamics,
  findVoicedBoundaries,
  SnippetAudioPlayer,
} from './detector/missingLinesDspEngine';

import {
  scanSubtitlesForMissingAndTiming,
  scanUnwantedSpeechGaps,
  scanDubberCollisions,
  scanActorOverlaps,
} from './detector/missingLinesMatcher';

// Re-export all public contracts for 100% backward compatibility
export type {
  QAScanLogEntry,
  WhisperScanStatus,
  QAScanReport,
  DefectCategory,
  DefectType,
  DefectResolution,
  MissingLineDetection,
  GapDetectionOptions,
  DecodedTrackContext,
  VoicedLineRecord,
};

export {
  formatTimecode,
  resolveAudioUrl,
  decodeAudioFile,
  findFullPhraseSilenceBoundaries,
  silenceAudioBufferInterval,
  transferAudioBufferPhrase,
  analyzeSegmentDynamics,
  findVoicedBoundaries,
  SnippetAudioPlayer,
};

/**
 * Main detection function to analyze dubber tracks against subtitles in an episode.
 */
export async function detectEpisodeGaps(
  episode: Episode,
  tracks: Track[],
  subLines: SubtitleLine[],
  options: GapDetectionOptions = {},
  onProgress?: (current: number, total: number, message: string) => void,
  onLog?: (logEntry: QAScanLogEntry) => void
): Promise<MissingLineDetection[]> {
  const {
    speechDynamicThresholdDb = 3.0,
    silencePeakThresholdDb = -52,
    silenceRmsThresholdDb = -60,
    minDurationSec = 0.15,
    scanMissingLines = true,
    scanUnwantedSpeech = true,
    scanCollisions = true,
    scanTimingMismatches = true,
    scanOverlaps = true,
    shortLineThresholdPercent = 30,
    longLineThresholdPercent = 40,
    scanWhisperText = false,
    whisperModel = 'small'
  } = options;

  const scanLogs: QAScanLogEntry[] = [];
  const addLog = (
    stage: QAScanLogEntry['stage'],
    level: QAScanLogEntry['level'],
    message: string,
    details?: string
  ) => {
    const now = new Date();
    const ts = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0').slice(0, 2)}`;
    const entry: QAScanLogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: ts,
      stage,
      level,
      message,
      details
    };
    scanLogs.push(entry);
    onLog?.(entry);
  };

  let whisperStatus: WhisperScanStatus = {
    attempted: scanWhisperText,
    ready: false,
    success: false,
    modelUsed: whisperModel,
    totalLinesChecked: 0,
    discrepanciesCount: 0
  };

  let results: MissingLineDetection[] = [];

  const dubberTracks = tracks.filter(t => t.id !== 'original' && t.files.length > 0);
  if (dubberTracks.length === 0 || subLines.length === 0) {
    addLog('general', 'warn', 'Не найдены дорожки озвучки с аудиофайлами или список субтитров пуст.');
    const report: QAScanReport = {
      timestamp: new Date().toISOString(),
      totalTracks: dubberTracks.length,
      totalSubLines: subLines.length,
      totalGapsFound: 0,
      whisperStatus,
      logs: scanLogs
    };
    (results as any).scanReport = report;
    return results;
  }

  addLog('general', 'info', `Старт комплексного QA сканирования серии: ${dubberTracks.length} дабберских дорожек, ${subLines.length} субтитров.`);

  let aliases: Record<string, string> = {};
  if (episode.project?.characterAliases) {
    try {
      aliases = JSON.parse(episode.project.characterAliases);
    } catch (e) {
      console.warn('Failed to parse characterAliases:', e);
    }
  }

  const validSubLines = subLines.filter(l => {
    const name = (l.name || '').toLowerCase();
    const style = (l.style || '').toLowerCase();
    const isSign = SIGN_KEYWORDS.some(k => name.includes(k.toLowerCase()) || style.includes(k.toLowerCase()));
    const duration = (l.endSec || 0) - (l.startSec || 0);
    return !isSign && duration >= minDurationSec && (l.text || '').trim().length > 0;
  });

  let originalAudioBuffer: AudioBuffer | null = null;
  const originalTrack = tracks.find(t => t.id === 'original');
  const rawFile = originalTrack?.files[0]?.path || episode.rawPath;
  if (rawFile) {
    try {
      const origUrl = resolveAudioUrl(rawFile);
      if (origUrl) {
        originalAudioBuffer = await decodeAudioFile(origUrl);
      }
    } catch (e) {
      console.warn('Original audio decode for reference skipped:', e);
    }
  }

  const totalTracks = dubberTracks.length;
  const decodedTracks: DecodedTrackContext[] = [];

  for (let i = 0; i < totalTracks; i++) {
    const track = dubberTracks[i];
    onProgress?.(
      i + 1,
      totalTracks,
      `Загрузка и декодирование дорожки [${i + 1}/${totalTracks}]: ${track.participant}...`
    );

    const sortedFiles = [...track.files].sort((a, b) => (b.size || 0) - (a.size || 0));
    const mainFile = sortedFiles[0] || track.files.find(f => f.id === track.selectedFileId) || track.files[0];
    if (!mainFile || !mainFile.path) continue;

    const fixFileCandidate = track.patchSnippet || sortedFiles.find(f => f.path !== mainFile.path);
    const audioUrl = resolveAudioUrl(mainFile.path);
    if (!audioUrl) continue;

    try {
      const audioBuffer = await decodeAudioFile(audioUrl);
      if (audioBuffer && audioBuffer.length > 0) {
        let fixBuffer: AudioBuffer | null = null;
        let fixAudioUrl: string | null = null;

        if (fixFileCandidate && fixFileCandidate.path && fixFileCandidate.path !== mainFile.path) {
          try {
            fixAudioUrl = resolveAudioUrl(fixFileCandidate.path);
            if (fixAudioUrl) {
              fixBuffer = await decodeAudioFile(fixAudioUrl);
            }
          } catch (fixErr) {
            console.warn(`Не удалось декодировать фикс-дорожку для ${track.participant}:`, fixErr);
          }
        }

        const assignedCharacters = new Set<string>();
        (episode.assignments || []).forEach(as => {
          const assignedId = as.substituteId || as.dubberId;
          if (assignedId === track.id && as.characterName) {
            assignedCharacters.add(as.characterName.trim().toLowerCase());
          }
        });

        track.character.split(',').forEach(c => {
          if (c.trim()) assignedCharacters.add(c.trim().toLowerCase());
        });

        decodedTracks.push({
          track,
          audioUrl,
          audioBuffer,
          assignedCharacters,
          fixBuffer,
          fixAudioUrl
        });
      }
    } catch (err) {
      console.warn(`Не удалось декодировать аудио для даббера ${track.participant}:`, err);
    }
  }

  if (decodedTracks.length === 0) {
    return results;
  }

  // 1. SCAN FOR MISSING LINES & TIMING MISMATCHES
  onProgress?.(totalTracks, totalTracks, 'Анализ пропусков и тайминга реплик...');
  const { results: missingResults, voicedLines, longTimingDetections } = scanSubtitlesForMissingAndTiming({
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
  });
  results.push(...missingResults);

  // 2. SCAN FOR UNWANTED SPEECH
  if (scanUnwantedSpeech) {
    onProgress?.(totalTracks, totalTracks, 'Поиск лишней озвучки вне сабов...');
    const unwantedResults = scanUnwantedSpeechGaps(
      decodedTracks,
      validSubLines,
      aliases,
      speechDynamicThresholdDb,
      originalAudioBuffer
    );
    results.push(...unwantedResults);
  }

  // 3. SCAN FOR DUBBER COLLISIONS
  if (scanCollisions && decodedTracks.length >= 2) {
    onProgress?.(totalTracks, totalTracks, 'Поиск конфликтов дубляжа...');
    const collisionResults = scanDubberCollisions(
      decodedTracks,
      validSubLines,
      aliases,
      minDurationSec,
      speechDynamicThresholdDb,
      originalAudioBuffer
    );
    results.push(...collisionResults);
  }

  // 4. SCAN FOR ACTOR OVERLAPS
  if (scanOverlaps && voicedLines.length >= 2) {
    onProgress?.(totalTracks, totalTracks, 'Поиск наездов хвостов фраз дублеров друг на друга...');
    const overlapResults = scanActorOverlaps(
      voicedLines,
      longTimingDetections,
      originalAudioBuffer
    );
    results.push(...overlapResults);
  } else {
    for (const longDet of longTimingDetections.values()) {
      results.push(longDet);
    }
  }

  // 5. SCAN FOR TECHNICAL ARTIFACTS
  if (options.scanArtifacts !== false) {
    onProgress?.(totalTracks, totalTracks, 'Сканирование технических артефактов (перегруз, клики, задувы)...');
    for (const trackCtx of decodedTracks) {
      const { track, audioBuffer, audioUrl } = trackCtx;
      const artifacts = scanTrackForArtifacts(audioBuffer, track, validSubLines, {
        detectClipping: true,
        detectClicks: true,
        detectPlosives: true,
        detectSwallowed: true
      });

      for (const art of artifacts) {
        const typeLabel = 
          art.type === 'clipping' ? 'Перегруз' :
          art.type === 'mouse_click' ? 'Клик мыши' :
          art.type === 'plosive' ? 'Задув (П/Б)' : 'Обрыв фразы';

        const matchingAssignment = (episode.assignments || []).find(a => {
          const assignedId = a.substituteId || a.dubberId;
          return assignedId === track.id || 
            (a.characterName && track.character.toLowerCase().includes(a.characterName.toLowerCase()));
        });

        results.push({
          id: art.id,
          defectCategory: 'audio_artifact',
          type: art.type,
          typeLabel,
          trackId: art.trackId,
          dubberName: art.dubberName,
          characterName: art.characterName,
          assignmentId: matchingAssignment?.id,
          lineIndex: art.lineIndex ?? -1,
          subId: art.subId,
          startSec: art.startSec,
          endSec: art.endSec,
          startFormatted: art.startFormatted,
          endFormatted: art.endFormatted,
          durationSec: art.durationSec,
          text: art.nearestSubtitleText || `[Технический огрех]: ${art.title}`,
          peakDb: art.type === 'clipping' ? 0.0 : -6.0,
          rmsDb: -18.0,
          dynamicRangeDb: 15.0,
          selected: art.selected,
          comment: art.comment,
          audioUrl,
          audioBuffer,
          originalAudioBuffer,
          resolutionAction: art.resolutionAction,
          artifactType: art.type,
          artifactMetric: art.metricDetails,
          artifactSeverity: art.severity,
          artifactTimestampSec: art.timestampSec,
          artifactTitle: art.title,
          artifactDescription: art.description,
          nearestSubtitleText: art.nearestSubtitleText
        });
      }
    }
  }

  // 6. SCAN FOR TEXT DISCREPANCIES VIA WHISPER
  if (scanWhisperText) {
    addLog('whisper', 'whisper', `--- НАЧАЛО ПРОВЕРКИ ПО WHISPER ---`);
    addLog('whisper', 'whisper', `Инициализация сверки текста. Выбранная модель: «${whisperModel}».`);
    onProgress?.(totalTracks, totalTracks, `Проверка готовности Whisper системы к загрузке модели «${whisperModel}»...`);

    addLog('whisper', 'whisper', `Запрос статуса системы Whisper: готова ли система к загрузке модели «${whisperModel}»...`);
    const readiness = await checkWhisperSystemReadiness(whisperModel);

    whisperStatus = {
      attempted: true,
      ready: readiness.isReady && readiness.canLoadModel,
      success: false,
      modelUsed: whisperModel,
      totalLinesChecked: 0,
      discrepanciesCount: 0,
      errorMessage: undefined
    };

    if (!readiness.isReady || !readiness.canLoadModel) {
      const failReason = readiness.errorMessage || readiness.statusText || 'Служба Whisper недоступна';
      whisperStatus.success = false;
      whisperStatus.errorMessage = `Проверка по Whisper не произошла: ${failReason}`;
      addLog('whisper', 'error', `❌ Система Whisper не готова к загрузке модели «${whisperModel}»: ${failReason}`);
      addLog('whisper', 'error', `❌ Проверка текста по Whisper завершилась неудачей (проверка не произошла).`);
      addLog('whisper', 'whisper', `--- ЗАВЕРШЕНИЕ ПРОВЕРКИ ПО WHISPER (ОШИБКА ГОТОВНОСТИ) ---`);
    } else {
      addLog('whisper', 'success', `🟢 ${readiness.statusText}`);
      addLog('whisper', 'whisper', `Система Whisper готова. Начинается загрузка модели «${whisperModel}» в память и сверка аудиодорожек...`);

      let totalCheckedLines = 0;
      let totalDiscrepancies = 0;
      let hasWhisperFailure = false;
      let lastErrorMessage = '';

      for (let tIdx = 0; tIdx < decodedTracks.length; tIdx++) {
        const trackCtx = decodedTracks[tIdx];
        const { track, audioBuffer, audioUrl } = trackCtx;
        const trackVoiced = voicedLines.filter(v => v.track.id === track.id);
        if (trackVoiced.length === 0) {
          addLog('whisper', 'info', `Дорожка «${track.participant}»: нет озвученных реплик для сверки, пропуск.`);
          continue;
        }

        const linesToCheck = trackVoiced.map(v => ({
          lineIndex: v.lineIndex,
          subId: v.subId,
          startSec: v.speechStartSec,
          endSec: v.speechEndSec,
          startFormatted: formatTimecode(v.speechStartSec),
          endFormatted: formatTimecode(v.speechEndSec),
          characterName: v.resolvedCharName || track.character,
          text: v.cleanedText
        }));

        const selectedFile = track.files.find(f => f.id === track.selectedFileId) || track.files[0];
        const filePath = selectedFile?.path || audioUrl;

        addLog('whisper', 'whisper', `[Дорожка ${tIdx + 1}/${decodedTracks.length}] Сверка даббера «${track.participant}» (${linesToCheck.length} реплик)...`);

        const trackResult = await checkTrackTextWithWhisper(
          filePath,
          linesToCheck,
          whisperModel,
          (curr, tot, _msg) => {
            onProgress?.(curr, tot, `Whisper (${whisperModel}): ${track.participant} [${curr}/${tot}]`);
          },
          (msg, level) => {
            addLog('whisper', level, msg);
          }
        );

        if (!trackResult.success) {
          hasWhisperFailure = true;
          lastErrorMessage = trackResult.errorMessage || 'Ошибка сверки реплик через Whisper';
          addLog('whisper', 'error', `❌ Дорожка «${track.participant}»: ${lastErrorMessage}`);
        } else {
          totalCheckedLines += linesToCheck.length;
          const comparisons = trackResult.results;

          for (const comp of comparisons) {
            if (!comp.isDiscrepancy) continue;

            const voicedItem = trackVoiced.find(v => v.lineIndex === comp.lineIndex);
            if (!voicedItem) continue;

            totalDiscrepancies++;
            const discType = comp.discrepancyType || 'changed_words';
            const typeLabel = 
              discType === 'missing_words' ? 'Пропуск слов' :
              discType === 'extra_words_or_retake' ? 'Лишние слова / дубль' : 'Отсебятина / замена слов';

            const detectionId = `whisper_text_${track.id}_${comp.lineIndex}_${voicedItem.speechStartSec.toFixed(2)}`;

            results.push({
              id: detectionId,
              defectCategory: 'text_mismatch',
              type: 'text_mismatch',
              typeLabel: `ASR: ${typeLabel}`,
              trackId: track.id,
              dubberName: track.participant,
              characterName: voicedItem.resolvedCharName || track.character,
              assignmentId: voicedItem.matchingAssignmentId,
              lineIndex: comp.lineIndex,
              subId: voicedItem.subId,
              startSec: voicedItem.speechStartSec,
              endSec: voicedItem.speechEndSec,
              startFormatted: formatTimecode(voicedItem.speechStartSec),
              endFormatted: formatTimecode(voicedItem.speechEndSec),
              durationSec: Math.round((voicedItem.speechEndSec - voicedItem.speechStartSec) * 10) / 10,
              text: comp.expectedText,
              expectedText: comp.expectedText,
              recognizedText: comp.recognizedText,
              textSimilarityPercent: comp.similarityPercent,
              textDiscrepancyType: discType,
              wordDiffs: comp.wordDiffs,
              whisperModelUsed: whisperModel,
              peakDb: voicedItem.metrics.peakDb,
              rmsDb: voicedItem.metrics.rmsDb,
              dynamicRangeDb: voicedItem.metrics.dynamicRangeDb,
              selected: true,
              resolutionAction: 'legitimate_fix',
              comment: `[Несовпадение текста] В сценарии: "${comp.expectedText}". Сказано: "${comp.recognizedText}".`,
              audioUrl,
              audioBuffer,
              originalAudioBuffer
            });
          }
        }
      }

      whisperStatus.totalLinesChecked = totalCheckedLines;
      whisperStatus.discrepanciesCount = totalDiscrepancies;
      whisperStatus.completedAt = new Date().toISOString();

      if (hasWhisperFailure) {
        whisperStatus.success = false;
        whisperStatus.errorMessage = `Проверка по Whisper завершилась с ошибкой: ${lastErrorMessage}`;
        addLog('whisper', 'error', `❌ Проверка по Whisper неудачна / завершилась с ошибкой: ${lastErrorMessage}`);
      } else {
        whisperStatus.success = true;
        addLog('whisper', 'success', `✅ Сверка через Whisper ASR успешно завершена: проверено ${totalCheckedLines} реплик, выявлено ${totalDiscrepancies} расхождений.`);
      }

      addLog('whisper', 'whisper', `--- ЗАВЕРШЕНИЕ ПРОВЕРКИ ПО WHISPER ---`);
    }
  } else {
    addLog('whisper', 'info', 'Сверка текста через Whisper отключена в параметрах сканирования.');
  }

  results.sort((a, b) => a.startSec - b.startSec);
  addLog('general', 'success', `Комплексный анализ завершён. Всего выявлено замечаний: ${results.length}.`);

  const report: QAScanReport = {
    timestamp: new Date().toISOString(),
    totalTracks: dubberTracks.length,
    totalSubLines: validSubLines.length,
    totalGapsFound: results.length,
    whisperStatus,
    logs: scanLogs
  };
  (results as any).scanReport = report;

  return results;
}
