import React, { useCallback } from "react";
import { toast } from "sonner";
import { ipcSafe } from "../../lib/ipcSafe";
import { Episode, Participant, Track, SubtitleLine, Comment } from "../../types";
import { sanitizeFolderName } from "../../lib/pathUtils";
import {
  MissingLineDetection,
  silenceAudioBufferInterval,
  transferAudioBufferPhrase,
  findFullPhraseSilenceBoundaries
} from "../../lib/qa/missingLinesDetector";
import { generateStatusMessage, generateSoundEngineerQAReport } from "../../lib/templates";
import { saveQAGapsToTimingProject } from "../../lib/qa/timingSyncService";
import { normalizeKey } from "../../lib/qaTimingHelper";

export interface UseQAGapFixApplierParams {
  currentEpisode: Episode | null;
  tracks: Track[];
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  subLines: SubtitleLine[];
  setSubLines: React.Dispatch<React.SetStateAction<SubtitleLine[]>>;
  participants: Participant[];
  detectedGaps: MissingLineDetection[];
  setDetectedGaps: React.Dispatch<React.SetStateAction<MissingLineDetection[]>>;
  setIsApplyingGapFixes: React.Dispatch<React.SetStateAction<boolean>>;
  setIsGapModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setGeneratedMessage: React.Dispatch<React.SetStateAction<string | null>>;
  setIsMessageCopied: React.Dispatch<React.SetStateAction<boolean>>;
  setIsMessageModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsExportModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsBaking: React.Dispatch<React.SetStateAction<boolean>>;
  setBakeProgress: React.Dispatch<React.SetStateAction<number>>;
  setBakeStatus: React.Dispatch<React.SetStateAction<string>>;
  handleGenerateFixesMessage: () => void;
  onRefresh: () => void;
}

export function useQAGapFixApplier({
  currentEpisode,
  tracks,
  setTracks,
  subLines,
  setSubLines,
  participants,
  detectedGaps,
  setDetectedGaps,
  setIsApplyingGapFixes,
  setIsGapModalOpen,
  setGeneratedMessage,
  setIsMessageCopied,
  setIsMessageModalOpen,
  setIsExportModalOpen,
  setIsBaking,
  setBakeProgress,
  setBakeStatus,
  handleGenerateFixesMessage,
  onRefresh
}: UseQAGapFixApplierParams) {
  const handleApplyGapFixes = async (selectedGaps: MissingLineDetection[]) => {
    if (!currentEpisode || selectedGaps.length === 0) return;

    setIsApplyingGapFixes(true);
    try {
      const commentsByTrackId: Record<string, Comment[]> = {};
      const commentsByAssignmentId: Record<string, Comment[]> = {};
      const intervalsToSilenceByFilePath: Record<string, { startSec: number; endSec: number }[]> = {};
      const phrasesToTransfer: Array<{
        sourcePath: string;
        targetPath: string;
        startSec: number;
        endSec: number;
        naturalStartSec?: number;
        naturalEndSec?: number;
      }> = [];
      const subUpdates: { rawLineIndex: number; name?: string; text?: string }[] = [];

      const getFilePathForTrack = (trackId: string): string | null => {
        const trk = tracks.find(t => t.id === trackId);
        const fl = trk?.files.find(f => f.id === trk.selectedFileId) || trk?.files[0];
        return fl?.path || null;
      };

      selectedGaps.forEach(gap => {
        const category = gap.defectCategory || 'missing_line';

        // 1. Missing line handling
        if (category === 'missing_line') {
          // Check if this missing line is a subtitle misattribution error reassigned to another character
          if (gap.resolutionAction === 'reassign_character' || gap.isSubtitleError || gap.reassignedCharacterName) {
            const targetCharName = (gap.reassignedCharacterName || gap.selectedCharacterForSub || '').trim();
            if (targetCharName && typeof gap.lineIndex === 'number') {
              subUpdates.push({ rawLineIndex: gap.lineIndex, name: targetCharName });
            }

            // Find target assignment for the new character
            const targetAssignment = currentEpisode.assignments?.find(
              a => a.characterName.toLowerCase().trim() === targetCharName.toLowerCase()
            );

            // Find target track (by character name or by dubber/substitute ID)
            const targetTrack = tracks.find(
              t => t.character?.toLowerCase().trim() === targetCharName.toLowerCase() ||
                   (targetAssignment && (t.id === targetAssignment.substituteId || t.id === targetAssignment.dubberId))
            );

            const targetTrackId = targetTrack?.id || (targetAssignment ? (targetAssignment.substituteId || targetAssignment.dubberId) : null);

            const commentText = gap.comment || (
              `[Ошибка в субтитрах] Реплика [${gap.startFormatted}]: "${gap.text}". ` +
              `В исходных субтитрах эта фраза ошибочно числилась за персонажем ${gap.characterName}, ` +
              `поэтому отсутствовала в вашем исходном скрипте. Пожалуйста, доозвучьте!`
            );

            const comment: Comment = {
              id: Math.random().toString(36).substr(2, 9),
              text: commentText,
              timestamp: gap.startSec,
              author: 'Куратор (Сабы/Авто)',
              subId: gap.subId
            };

            // Route the fix task to the correct dubber
            if (targetTrackId) {
              if (!commentsByTrackId[targetTrackId]) commentsByTrackId[targetTrackId] = [];
              commentsByTrackId[targetTrackId].push(comment);
            }

            if (targetAssignment) {
              if (!commentsByAssignmentId[targetAssignment.id]) commentsByAssignmentId[targetAssignment.id] = [];
              commentsByAssignmentId[targetAssignment.id].push(comment);
            } else if (targetCharName) {
              const syntheticAssId = `new_ass_${targetCharName.toLowerCase()}`;
              if (!commentsByAssignmentId[syntheticAssId]) commentsByAssignmentId[syntheticAssId] = [];
              commentsByAssignmentId[syntheticAssId].push(comment);
            }

            // Notice: The previous dubber (gap.trackId / gap.assignmentId) gets NO fix or penalty,
            // because they rightly didn't voice someone else's line!
            return;
          }

          const comment: Comment = {
            id: Math.random().toString(36).substr(2, 9),
            text: gap.comment || `Пропуск реплики [${gap.startFormatted}]: "${gap.text}"`,
            timestamp: gap.startSec,
            author: 'Куратор (Авто)',
            subId: gap.subId
          };

          if (!commentsByTrackId[gap.trackId]) commentsByTrackId[gap.trackId] = [];
          commentsByTrackId[gap.trackId].push(comment);

          if (gap.assignmentId) {
            if (!commentsByAssignmentId[gap.assignmentId]) commentsByAssignmentId[gap.assignmentId] = [];
            commentsByAssignmentId[gap.assignmentId].push(comment);
          }
        }

        // 2. Unwanted speech outside subtitles
        else if (category === 'unwanted_speech') {
          if (gap.resolutionAction === 'silence') {
            let actualRange = { startSec: gap.startSec, endSec: gap.endSec };
            if (gap.audioBuffer) {
              actualRange = silenceAudioBufferInterval(gap.audioBuffer, gap.startSec, gap.endSec, { expandToSilence: true });
            }
            const filePath = getFilePathForTrack(gap.trackId);
            if (filePath) {
              if (!intervalsToSilenceByFilePath[filePath]) intervalsToSilenceByFilePath[filePath] = [];
              intervalsToSilenceByFilePath[filePath].push(actualRange);
            }

            const comment: Comment = {
              id: Math.random().toString(36).substr(2, 9),
              text: gap.comment || `Лишняя речь вне сабов [${gap.startFormatted} - ${gap.endFormatted}]: заменена тишиной (до тишины)`,
              timestamp: actualRange.startSec,
              author: 'Куратор (Авто)',
              subId: gap.subId
            };

            if (!commentsByTrackId[gap.trackId]) commentsByTrackId[gap.trackId] = [];
            commentsByTrackId[gap.trackId].push(comment);
          }
        }

        // 3. Dubber collisions (конфликты двух даберов на одном сабе)
        else if (category === 'actor_collision') {
          if (gap.resolutionAction === 'fix_subs') {
            const targetName = gap.selectedCharacterForSub || gap.characterName;
            if (targetName && typeof gap.lineIndex === 'number') {
              subUpdates.push({ rawLineIndex: gap.lineIndex, name: targetName });
            }
          } else if (gap.resolutionAction === 'keep_first') {
            if (gap.secondTrackId) {
              let actualRange = { 
                startSec: gap.secondNaturalSilenceStartSec ?? gap.startSec, 
                endSec: gap.secondNaturalSilenceEndSec ?? gap.endSec 
              };
              if (gap.secondAudioBuffer) {
                actualRange = silenceAudioBufferInterval(gap.secondAudioBuffer, gap.startSec, gap.endSec, { expandToSilence: true });
              }
              const filePath = getFilePathForTrack(gap.secondTrackId);
              if (filePath) {
                if (!intervalsToSilenceByFilePath[filePath]) intervalsToSilenceByFilePath[filePath] = [];
                intervalsToSilenceByFilePath[filePath].push(actualRange);
              }
              const comment: Comment = {
                id: Math.random().toString(36).substr(2, 9),
                text: `Дублирование реплики #${(gap.lineIndex ?? 0) + 1} удалено до естественной тишины (реплика отдана ${gap.dubberName}, хвосты сохранены)`,
                timestamp: gap.startSec,
                author: 'Куратор (Авто)',
                subId: gap.subId
              };
              if (!commentsByTrackId[gap.secondTrackId]) commentsByTrackId[gap.secondTrackId] = [];
              commentsByTrackId[gap.secondTrackId].push(comment);
            }
          } else if (gap.resolutionAction === 'keep_second') {
            if (gap.trackId) {
              let actualRange = { 
                startSec: gap.naturalSilenceStartSec ?? gap.startSec, 
                endSec: gap.naturalSilenceEndSec ?? gap.endSec 
              };
              if (gap.audioBuffer) {
                actualRange = silenceAudioBufferInterval(gap.audioBuffer, gap.startSec, gap.endSec, { expandToSilence: true });
              }
              const filePath = getFilePathForTrack(gap.trackId);
              if (filePath) {
                if (!intervalsToSilenceByFilePath[filePath]) intervalsToSilenceByFilePath[filePath] = [];
                intervalsToSilenceByFilePath[filePath].push(actualRange);
              }
              const comment: Comment = {
                id: Math.random().toString(36).substr(2, 9),
                text: `Дублирование реплики #${(gap.lineIndex ?? 0) + 1} удалено до естественной тишины (реплика отдана ${gap.secondDubberName || 'второму даберу'}, хвосты сохранены)`,
                timestamp: gap.startSec,
                author: 'Куратор (Авто)',
                subId: gap.subId
              };
              if (!commentsByTrackId[gap.trackId]) commentsByTrackId[gap.trackId] = [];
              commentsByTrackId[gap.trackId].push(comment);
            }
          } else if (gap.resolutionAction === 'transfer_second_to_first') {
            let actualRange = { 
              startSec: gap.secondNaturalSilenceStartSec ?? gap.startSec, 
              endSec: gap.secondNaturalSilenceEndSec ?? gap.endSec 
            };
            if (gap.secondAudioBuffer && gap.audioBuffer) {
              const res = transferAudioBufferPhrase(gap.secondAudioBuffer, gap.audioBuffer, gap.startSec, gap.endSec);
              actualRange = { startSec: res.naturalStartSec, endSec: res.naturalEndSec };
            }
            const sourcePath = gap.secondTrackId ? getFilePathForTrack(gap.secondTrackId) : null;
            const targetPath = gap.trackId ? getFilePathForTrack(gap.trackId) : null;
            if (sourcePath && targetPath) {
              phrasesToTransfer.push({
                sourcePath,
                targetPath,
                startSec: actualRange.startSec,
                endSec: actualRange.endSec,
                naturalStartSec: actualRange.startSec,
                naturalEndSec: actualRange.endSec
              });
            }
            const comment: Comment = {
              id: Math.random().toString(36).substr(2, 9),
              text: `Реплика #${(gap.lineIndex ?? 0) + 1} перенесена целиком от ${gap.secondDubberName} в дорожку ${gap.dubberName} (до тишины, без обрезки хвостов)`,
              timestamp: gap.startSec,
              author: 'Куратор (Авто)',
              subId: gap.subId
            };
            if (!commentsByTrackId[gap.trackId]) commentsByTrackId[gap.trackId] = [];
            commentsByTrackId[gap.trackId].push(comment);
          } else if (gap.resolutionAction === 'transfer_first_to_second') {
            let actualRange = { 
              startSec: gap.naturalSilenceStartSec ?? gap.startSec, 
              endSec: gap.naturalSilenceEndSec ?? gap.endSec 
            };
            if (gap.audioBuffer && gap.secondAudioBuffer) {
              const res = transferAudioBufferPhrase(gap.audioBuffer, gap.secondAudioBuffer, gap.startSec, gap.endSec);
              actualRange = { startSec: res.naturalStartSec, endSec: res.naturalEndSec };
            }
            const sourcePath = gap.trackId ? getFilePathForTrack(gap.trackId) : null;
            const targetPath = gap.secondTrackId ? getFilePathForTrack(gap.secondTrackId) : null;
            if (sourcePath && targetPath) {
              phrasesToTransfer.push({
                sourcePath,
                targetPath,
                startSec: actualRange.startSec,
                endSec: actualRange.endSec,
                naturalStartSec: actualRange.startSec,
                naturalEndSec: actualRange.endSec
              });
            }
            const comment: Comment = {
              id: Math.random().toString(36).substr(2, 9),
              text: `Реплика #${(gap.lineIndex ?? 0) + 1} перенесена целиком от ${gap.dubberName} в дорожку ${gap.secondDubberName} (до тишины, без обрезки хвостов)`,
              timestamp: gap.startSec,
              author: 'Куратор (Авто)',
              subId: gap.subId
            };
            if (gap.secondTrackId) {
              if (!commentsByTrackId[gap.secondTrackId]) commentsByTrackId[gap.secondTrackId] = [];
              commentsByTrackId[gap.secondTrackId].push(comment);
            }
          }
        }

        // 4. Actor Overlaps (наезды хвостов фраз)
        else if (category === 'actor_overlap') {
          if (gap.resolutionAction === 'note_sound_engineer' || gap.resolutionAction === 'auto_shift') {
            const comment: Comment = {
              id: Math.random().toString(36).substr(2, 9),
              text: `[Наезд/Стык] Хвост реплики ${gap.dubberName} заходит на начало ${gap.secondDubberName || 'второго дабера'} на ~${gap.overlapSec || 0.2}с. Развести стык в DAW (хвосты сохранены в полном объёме, ничего не обрезано).`,
              timestamp: gap.startSec,
              author: 'Куратор (Контроль стыков)',
              subId: gap.subId
            };
            if (!commentsByTrackId[gap.trackId]) commentsByTrackId[gap.trackId] = [];
            commentsByTrackId[gap.trackId].push(comment);
          } else if (gap.resolutionAction === 'keep_first') {
            if (gap.secondTrackId) {
              let actualRange = { 
                startSec: gap.secondNaturalSilenceStartSec ?? gap.startSec, 
                endSec: gap.secondNaturalSilenceEndSec ?? gap.endSec 
              };
              if (gap.secondAudioBuffer) {
                actualRange = silenceAudioBufferInterval(gap.secondAudioBuffer, gap.startSec, gap.endSec, { expandToSilence: true });
              }
              const filePath = getFilePathForTrack(gap.secondTrackId);
              if (filePath) {
                if (!intervalsToSilenceByFilePath[filePath]) intervalsToSilenceByFilePath[filePath] = [];
                intervalsToSilenceByFilePath[filePath].push(actualRange);
              }
              const comment: Comment = {
                id: Math.random().toString(36).substr(2, 9),
                text: `Наезд устранен: фраза ${gap.secondDubberName} удалена целиком до естественной тишины (реплика отдана ${gap.dubberName}, хвосты сохранены)`,
                timestamp: gap.startSec,
                author: 'Куратор (Авто)',
                subId: gap.subId
              };
              if (!commentsByTrackId[gap.secondTrackId]) commentsByTrackId[gap.secondTrackId] = [];
              commentsByTrackId[gap.secondTrackId].push(comment);
            }
          } else if (gap.resolutionAction === 'keep_second') {
            if (gap.trackId) {
              let actualRange = { 
                startSec: gap.naturalSilenceStartSec ?? gap.startSec, 
                endSec: gap.naturalSilenceEndSec ?? gap.endSec 
              };
              if (gap.audioBuffer) {
                actualRange = silenceAudioBufferInterval(gap.audioBuffer, gap.startSec, gap.endSec, { expandToSilence: true });
              }
              const filePath = getFilePathForTrack(gap.trackId);
              if (filePath) {
                if (!intervalsToSilenceByFilePath[filePath]) intervalsToSilenceByFilePath[filePath] = [];
                intervalsToSilenceByFilePath[filePath].push(actualRange);
              }
              const comment: Comment = {
                id: Math.random().toString(36).substr(2, 9),
                text: `Наезд устранен: фраза ${gap.dubberName} удалена целиком до естественной тишины (реплика отдана ${gap.secondDubberName || 'второму даберу'}, хвосты сохранены)`,
                timestamp: gap.startSec,
                author: 'Куратор (Авто)',
                subId: gap.subId
              };
              if (!commentsByTrackId[gap.trackId]) commentsByTrackId[gap.trackId] = [];
              commentsByTrackId[gap.trackId].push(comment);
            }
          } else if (gap.resolutionAction === 'transfer_second_to_first') {
            let actualRange = { 
              startSec: gap.secondNaturalSilenceStartSec ?? gap.startSec, 
              endSec: gap.secondNaturalSilenceEndSec ?? gap.endSec 
            };
            if (gap.secondAudioBuffer && gap.audioBuffer) {
              const res = transferAudioBufferPhrase(gap.secondAudioBuffer, gap.audioBuffer, gap.startSec, gap.endSec);
              actualRange = { startSec: res.naturalStartSec, endSec: res.naturalEndSec };
            }
            const sourcePath = gap.secondTrackId ? getFilePathForTrack(gap.secondTrackId) : null;
            const targetPath = gap.trackId ? getFilePathForTrack(gap.trackId) : null;
            if (sourcePath && targetPath) {
              phrasesToTransfer.push({
                sourcePath,
                targetPath,
                startSec: actualRange.startSec,
                endSec: actualRange.endSec,
                naturalStartSec: actualRange.startSec,
                naturalEndSec: actualRange.endSec
              });
            }
          }
        }

        // 5. Technical Audio Artifacts (перегруз, клики, задувы, обрывы)
        else if (category === 'audio_artifact') {
          if (gap.resolutionAction === 'request_dubber_fix') {
            const comment: Comment = {
              id: Math.random().toString(36).substr(2, 9),
              text: gap.comment || `[Перезапись] Технический дефект (${gap.typeLabel || 'артефакт записи'}) [${gap.startFormatted}]: "${gap.text}"`,
              timestamp: gap.artifactTimestampSec ?? gap.startSec,
              author: 'Куратор (Артефакты)',
              subId: gap.subId
            };

            if (!commentsByTrackId[gap.trackId]) commentsByTrackId[gap.trackId] = [];
            commentsByTrackId[gap.trackId].push(comment);

            if (gap.assignmentId) {
              if (!commentsByAssignmentId[gap.assignmentId]) commentsByAssignmentId[gap.assignmentId] = [];
              commentsByAssignmentId[gap.assignmentId].push(comment);
            }
          }
          // Note: 'note_sound_engineer' is included in sound engineer QA report, 'ignore' is dismissed.
        }

        // 6. Text Mismatch / Whisper ASR
        else if (category === 'text_mismatch') {
          if (gap.resolutionAction === 'actor_better_than_sub') {
            // Actor's delivery is superior to original subtitles -> update subtitles!
            if (gap.recognizedText && typeof gap.lineIndex === 'number') {
              subUpdates.push({
                rawLineIndex: gap.lineIndex,
                text: gap.recognizedText,
                name: gap.characterName
              });
            }
          } else if (gap.resolutionAction === 'legitimate_fix' || gap.resolutionAction === 'request_dubber_fix') {
            // Dubber made a slip of tongue / mistake -> request re-recording
            const comment: Comment = {
              id: Math.random().toString(36).substr(2, 9),
              text: gap.comment || `[Фикс текста / Оговорка] В сабах: "${gap.expectedText || gap.text}". Озвучено: "${gap.recognizedText}". Перезапишите строго по тексту.`,
              timestamp: gap.startSec,
              author: 'Куратор (Whisper QA)',
              subId: gap.subId
            };

            if (!commentsByTrackId[gap.trackId]) commentsByTrackId[gap.trackId] = [];
            commentsByTrackId[gap.trackId].push(comment);

            if (gap.assignmentId) {
              if (!commentsByAssignmentId[gap.assignmentId]) commentsByAssignmentId[gap.assignmentId] = [];
              commentsByAssignmentId[gap.assignmentId].push(comment);
            }
          }
        }
      });

      // Execute audio silencing on physical files in Electron (always expanded to natural silence)
      for (const [filePath, intervals] of Object.entries(intervalsToSilenceByFilePath)) {
        try {
          await ipcSafe.invoke('silence-audio-intervals', { filePath, intervals });
        } catch (silenceErr) {
          console.warn(`Could not silence audio intervals in ${filePath}:`, silenceErr);
        }
      }

      // Execute phrase transfers between physical files in Electron (cut to natural silence and transferred)
      for (const transferItem of phrasesToTransfer) {
        try {
          await ipcSafe.invoke('transfer-audio-phrase', transferItem);
        } catch (transferErr) {
          console.warn(`Could not transfer audio phrase between files:`, transferErr);
        }
      }

      // Execute subtitle updates if .ass file was corrected
      if (subUpdates.length > 0 && currentEpisode.subPath) {
        try {
          await ipcSafe.invoke('save-raw-subtitles', {
            filePath: currentEpisode.subPath,
            lines: subUpdates
          });
          setSubLines(prev => prev.map(l => {
            const up = subUpdates.find(u => u.rawLineIndex === l.rawLineIndex);
            if (!up) return l;
            return {
              ...l,
              name: up.name !== undefined ? up.name : l.name,
              text: up.text !== undefined ? up.text : l.text
            };
          }));
        } catch (subErr) {
          console.error('Failed to save corrected subtitles:', subErr);
        }
      }

      // Update local tracks state with deduplication
      const updatedTracks = tracks.map(t => {
        const newComments = commentsByTrackId[t.id];
        if (newComments && newComments.length > 0) {
          const existingKeys = new Set(t.comments.map(c => c.subId ? `sub_${c.subId}_${c.text.trim()}` : `${c.text.trim()}_${Math.round(c.timestamp || 0)}`));
          const uniqueToAdd = newComments.filter(c => {
            const key = c.subId ? `sub_${c.subId}_${c.text.trim()}` : `${c.text.trim()}_${Math.round(c.timestamp || 0)}`;
            if (!existingKeys.has(key)) {
              existingKeys.add(key);
              return true;
            }
            return false;
          });
          return {
            ...t,
            comments: [...t.comments, ...uniqueToAdd],
            status: 'fixes_needed' as const
          };
        }
        return t;
      });
      setTracks(updatedTracks);

      // Update assignments in DB with cross-assignment deduplication per dubber
      const seenCommentsByDubber = new Set<string>();

      const getCommentKey = (c: Comment) => {
        if (c.subId !== undefined && c.subId !== null) {
          return `sub_${c.subId}_${c.text.trim()}`;
        }
        return `${c.text.trim()}_${Math.round(c.timestamp || 0)}`;
      };

      const updatedAssignments = (currentEpisode.assignments || []).map(a => {
        const assignedId = a.substituteId || a.dubberId;
        const rawNewComments = commentsByAssignmentId[a.id] || (
          commentsByTrackId[assignedId || '']?.filter(c => {
            const gap = selectedGaps.find(g => g.subId === c.subId);
            if (gap?.isSubtitleError || gap?.resolutionAction === 'reassign_character') {
              return (gap.reassignedCharacterName || gap.selectedCharacterForSub || '').toLowerCase() === a.characterName.toLowerCase();
            }
            return gap && gap.characterName?.toLowerCase() === a.characterName.toLowerCase();
          })
        ) || [];

        let existingComments: Comment[] = [];
        try {
          existingComments = JSON.parse(a.comments || '[]');
        } catch (e) {}

        if (assignedId) {
          existingComments.forEach(c => {
            seenCommentsByDubber.add(`${assignedId}_${getCommentKey(c)}`);
          });
        }

        const uniqueNewComments: Comment[] = [];
        for (const c of rawNewComments) {
          const dubberKey = assignedId ? `${assignedId}_${getCommentKey(c)}` : getCommentKey(c);
          if (!seenCommentsByDubber.has(dubberKey)) {
            const existsInThisAss = existingComments.some(e => getCommentKey(e) === getCommentKey(c));
            if (!existsInThisAss) {
              uniqueNewComments.push(c);
            }
            seenCommentsByDubber.add(dubberKey);
          }
        }

        const mergedComments = [...existingComments, ...uniqueNewComments];

        if (mergedComments.length > existingComments.length) {
          return {
            ...a,
            comments: JSON.stringify(mergedComments),
            status: 'FIXES_NEEDED' as const
          };
        }
        return a;
      });

      // Also append any synthetic assignments for unlisted characters
      Object.keys(commentsByAssignmentId).forEach(assKey => {
        if (assKey.startsWith('new_ass_')) {
          const charName = assKey.replace('new_ass_', '');
          const exists = updatedAssignments.find(a => a.characterName.toLowerCase() === charName.toLowerCase());
          if (!exists) {
            updatedAssignments.push({
              id: Math.random().toString(36).substr(2, 9),
              episodeId: currentEpisode.id,
              characterName: charName,
              status: 'FIXES_NEEDED',
              comments: JSON.stringify(commentsByAssignmentId[assKey]),
              lineCount: 1,
              isMain: false
            });
          }
        }
      });

      await ipcSafe.invoke('save-episode', {
        ...currentEpisode,
        assignments: updatedAssignments,
        status: currentEpisode.status === 'FINISHED' ? 'FINISHED' : 'FIXES'
      });

      onRefresh();

      const updatedGapsState = detectedGaps.map(g => {
        const found = selectedGaps.find(sg => sg.id === g.id);
        if (found) {
          return {
            ...g,
            resolved: true,
            selected: false,
            resolutionAction: found.resolutionAction || g.resolutionAction
          };
        }
        return g;
      });
      setDetectedGaps(updatedGapsState);
      if (currentEpisode?.id) {
        try {
          localStorage.setItem(`qa_detected_gaps_${currentEpisode.id}`, JSON.stringify(updatedGapsState));
        } catch (e) {
          console.warn('Failed to save QA gaps to localStorage:', e);
        }
      }

      const reassignCount = selectedGaps.filter(g => g.isSubtitleError || g.resolutionAction === 'reassign_character').length;
      if (reassignCount > 0) {
        toast.success(`Применено! Обновлено субтитров: ${subUpdates.length}, перенаправлено доозвучек: ${reassignCount}`);
      } else {
        toast.success(`Успешно применены решения для ${selectedGaps.length} замечаний!`);
      }
      setIsGapModalOpen(false);

      if (Object.keys(commentsByTrackId).length > 0) {
        setTimeout(() => {
          handleGenerateFixesMessage();
        }, 300);
      }
    } catch (e: any) {
      console.error('Failed to apply gap fixes:', e);
      toast.error(`Ошибка при сохранении фиксов: ${e?.message || e}`);
    } finally {
      setIsApplyingGapFixes(false);
    }
  };

  const handleGenerateReminderMessage = () => {
    if (!currentEpisode) return;
    try {
      const msg = generateStatusMessage(currentEpisode, participants);
      setGeneratedMessage(msg);
      setIsMessageCopied(false);
      setIsMessageModalOpen(true);
    } catch (e: any) {
      console.error('Failed to generate reminder message:', e);
      toast.error('Ошибка генерации напоминания: ' + (e?.message || String(e)));
    }
  };

  const handleGenerateSoundEngineerReport = useCallback(() => {
    if (!currentEpisode) return;
    try {
      const msg = generateSoundEngineerQAReport(currentEpisode, detectedGaps, participants);
      setGeneratedMessage(msg);
      setIsMessageCopied(false);
      setIsMessageModalOpen(true);
    } catch (e: any) {
      console.error('Failed to generate sound engineer report:', e);
      toast.error('Ошибка генерации отчета: ' + (e?.message || String(e)));
    }
  }, [currentEpisode, detectedGaps, participants]);

  const handleExportSoundEngineer = async (targetDir: string, skipConversion: boolean, smartExport?: boolean, uploadToYandex?: boolean, additionalProcessing?: boolean, autoApplyFixes?: boolean, includeSubtitles?: boolean, autoTiming?: boolean) => {
    if (!currentEpisode) return;
    try {
      await ipcSafe.invoke('enqueue-ffmpeg-task', {
        type: 'export-sound-engineer-files',
        payload: {
          episode: currentEpisode,
          targetDir,
          skipConversion,
          smartExport,
          additionalProcessing,
          autoApplyFixes,
          includeSubtitles: includeSubtitles ?? true,
          autoTiming: autoTiming ?? false
        },
        metadata: {
          title: `Экспорт Звукорежиссеру: ${currentEpisode.project?.title || 'Проект'} - Серия ${currentEpisode.number}`,
          targetDir
        }
      });
      setIsExportModalOpen(false);
      toast.success('Экспорт для звукорежиссера добавлен в фоновую очередь задач!');
    } catch (error: any) {
      console.error('Export sound engineer task enqueue error:', error);
      toast.error('Ошибка добавления экспорта в очередь: ' + (error.message || String(error)));
    }
  };

  const handleBakeSubtitles = async () => {
    if (!currentEpisode) return;
    setIsBaking(true);
    setBakeProgress(0);
    setBakeStatus('Запуск FFmpeg...');
    
    let removeListener: (() => void) | undefined;
    removeListener = ipcSafe.on('ffmpeg-progress', (percent: number) => {
      setBakeProgress(percent);
      setBakeStatus(`Рендеринг: ${percent}%`);
    });

    try {
      const projectTitle = sanitizeFolderName(currentEpisode.project?.title || 'Project');
      const episodeFolder = sanitizeFolderName(`Episode_${currentEpisode.number}`);
      const subDir = `${projectTitle}/${episodeFolder}`;
      
      await ipcSafe.invoke('bake-subtitles', {
        videoPath: currentEpisode.rawPath, 
        finalAssPath: currentEpisode.subPath, 
        outputPath: `${subDir}/final_release.mp4`
      });
      
      setBakeStatus('Видео успешно отрендерено!');
      setBakeProgress(100);
    } catch (err: any) {
      setBakeStatus(`Ошибка: ${err.message}`);
    } finally {
      setIsBaking(false);
      if (removeListener) removeListener();
    }
  };

  return {
    handleApplyGapFixes,
    handleGenerateReminderMessage,
    handleGenerateSoundEngineerReport,
    handleExportSoundEngineer,
    handleBakeSubtitles
  };
}
