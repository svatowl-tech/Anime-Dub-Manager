import { Episode, Track } from '../../types';
import { MissingLineDetection } from './missingLinesDetector';
import { VoiceCollisionMarker, TimingIssue, MissingSubtitleMarker } from '../../components/TimingPanel';

// Safe IPC wrapper
const ipcSafe = {
  invoke: async (channel: string, ...args: any[]) => {
    if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.invoke === 'function') {
      return await window.electronAPI.invoke(channel, ...args);
    }
    return null;
  }
};

export interface TimingProjectData {
  version: string;
  source: 'qa_scan' | 'timing_studio';
  savedAt: string;
  episodeId: string;
  episodeDir?: string;
  collisions: VoiceCollisionMarker[];
  timingIssues: TimingIssue[];
  missingSubtitles: MissingSubtitleMarker[];
  rawGaps: MissingLineDetection[];
  summary: {
    totalGaps: number;
    collisionsCount: number;
    overlapsCount: number;
    desyncCount: number;
    missingCount: number;
    artifactsCount: number;
  };
}

/**
 * Returns the folder path on disk for this episode based on episode and tracks
 */
export function getEpisodeDirectory(episode: Episode | null, tracks: Track[] = []): string {
  if (!episode) return '';
  if ((episode as any).folderPath) return (episode as any).folderPath;

  const rawPath = episode.rawPath || '';
  if (rawPath) {
    const lastSlash = Math.max(rawPath.lastIndexOf('/'), rawPath.lastIndexOf('\\'));
    if (lastSlash > 0) return rawPath.substring(0, lastSlash);
  }

  for (const t of tracks) {
    const p = t.files?.[0]?.path;
    if (p) {
      const lastSlash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
      if (lastSlash > 0) return p.substring(0, lastSlash);
    }
  }

  return '';
}

/**
 * Converts QA gap detections into structured Timing Panel markers and issues
 */
export function convertQAGapsToTimingData(
  episode: Episode | null,
  gaps: MissingLineDetection[],
  tracks: Track[] = []
): TimingProjectData {
  const collisions: VoiceCollisionMarker[] = [];
  const timingIssues: TimingIssue[] = [];
  const missingSubtitles: MissingSubtitleMarker[] = [];

  let collisionsCount = 0;
  let overlapsCount = 0;
  let desyncCount = 0;
  let missingCount = 0;
  let artifactsCount = 0;

  gaps.forEach((gap, index) => {
    const category = gap.defectCategory || 'missing_line';
    const startSec = gap.startSec || 0;
    const endSec = gap.endSec || (startSec + (gap.durationSec || 1));
    const duration = gap.durationSec || Math.max(0.1, endSec - startSec);

    // 1. Dubber Collisions
    if (category === 'actor_collision') {
      collisionsCount++;
      const colId = `col_qa_${gap.id || index}`;
      const secondTrk = tracks.find(t => t.id === gap.secondTrackId || t.participant === gap.secondDubberName);

      collisions.push({
        id: colId,
        track1Id: gap.trackId,
        track2Id: gap.secondTrackId || secondTrk?.id || gap.trackId,
        dubber1Name: gap.dubberName || 'Даббер 1',
        dubber2Name: gap.secondDubberName || secondTrk?.participant || 'Даббер 2',
        character1Name: gap.characterName || 'Персонаж 1',
        character2Name: gap.secondCharacterName || secondTrk?.character || 'Персонаж 2',
        startSec,
        endSec,
        overlapDurationSec: Number(duration.toFixed(2))
      });

      timingIssues.push({
        id: `issue_qa_col_${gap.id || index}`,
        type: 'overlap',
        trackId: gap.trackId,
        dubberName: gap.dubberName || 'Даббер',
        characterName: gap.characterName || 'Персонаж',
        timeSec: startSec,
        durationSec: duration,
        overlapDurationSec: Number(duration.toFixed(2)),
        overlappingDubber: gap.secondDubberName || 'Второй даббер',
        subText: gap.text,
        description: gap.comment || `Конфликт дубляжа: «${gap.dubberName}» и «${gap.secondDubberName || 'второй'}» (${duration.toFixed(2)}с)`
      });
    }

    // 2. Actor Overlaps (наезды хвостов)
    else if (category === 'actor_overlap') {
      overlapsCount++;
      const overlapDur = gap.overlapSec || gap.overflowDurationSec || duration;
      const colId = `overlap_qa_${gap.id || index}`;
      const secondTrk = tracks.find(t => t.id === gap.secondTrackId || t.participant === gap.secondDubberName);

      collisions.push({
        id: colId,
        track1Id: gap.trackId,
        track2Id: gap.secondTrackId || secondTrk?.id || gap.trackId,
        dubber1Name: gap.dubberName || 'Даббер 1',
        dubber2Name: gap.secondDubberName || secondTrk?.participant || 'Даббер 2',
        character1Name: gap.characterName || 'Персонаж 1',
        character2Name: gap.secondCharacterName || secondTrk?.character || 'Персонаж 2',
        startSec,
        endSec,
        overlapDurationSec: Number(overlapDur.toFixed(2))
      });

      timingIssues.push({
        id: `issue_qa_ov_${gap.id || index}`,
        type: 'overlap',
        trackId: gap.trackId,
        dubberName: gap.dubberName || 'Даббер',
        characterName: gap.characterName || 'Персонаж',
        timeSec: startSec,
        durationSec: duration,
        overlapDurationSec: Number(overlapDur.toFixed(2)),
        overlappingDubber: gap.secondDubberName,
        subText: gap.text,
        description: gap.comment || `Наезд реплики: «${gap.dubberName}» перекрывает «${gap.secondDubberName || 'соседнюю реплику'}» (${overlapDur.toFixed(2)}с)`
      });
    }

    // 3. Timing Desync (вылеты и короткие фразы)
    else if (category === 'timing_too_long' || category === 'timing_too_short') {
      desyncCount++;
      timingIssues.push({
        id: `issue_qa_desync_${gap.id || index}`,
        type: 'desync',
        trackId: gap.trackId,
        dubberName: gap.dubberName || 'Даббер',
        characterName: gap.characterName || 'Персонаж',
        timeSec: startSec,
        durationSec: duration,
        subStartSec: gap.startSec,
        subEndSec: gap.endSec,
        timeDiffSec: gap.timingDeltaPercent ? gap.timingDeltaPercent / 100 : undefined,
        subText: gap.text,
        description: gap.comment || (category === 'timing_too_long' ? `Фраза длиннее саба (+${gap.overflowDurationSec || duration}с)` : `Фраза короче саба`)
      });
    }

    // 4. Missing lines (пропуски)
    else if (category === 'missing_line') {
      missingCount++;
      const subId = gap.subId || String(gap.lineIndex ?? index);

      missingSubtitles.push({
        id: `missing_qa_${gap.id || index}`,
        subId,
        trackId: gap.trackId,
        dubberName: gap.dubberName || 'Даббер',
        characterName: gap.characterName || 'Персонаж',
        startSec,
        endSec,
        text: gap.text || 'Пропущенная реплика'
      });

      timingIssues.push({
        id: `issue_qa_missing_${gap.id || index}`,
        type: 'missing',
        trackId: gap.trackId,
        dubberName: gap.dubberName || 'Даббер',
        characterName: gap.characterName || 'Персонаж',
        timeSec: startSec,
        durationSec: duration,
        subText: gap.text,
        description: gap.comment || `Пропуск реплики [${gap.startFormatted || startSec}]: "${gap.text}"`
      });
    }

    // 5. Technical Audio Artifacts
    else if (category === 'audio_artifact') {
      artifactsCount++;
      timingIssues.push({
        id: `issue_qa_art_${gap.id || index}`,
        type: 'orphan',
        trackId: gap.trackId,
        dubberName: gap.dubberName || 'Даббер',
        characterName: gap.characterName || 'Персонаж',
        timeSec: startSec,
        durationSec: duration,
        description: gap.comment || `Артефакт звука: ${gap.typeLabel || 'клиппинг/щелчок'}`
      });
    }
  });

  return {
    version: '1.0.0',
    source: 'qa_scan',
    savedAt: new Date().toISOString(),
    episodeId: episode?.id || 'unknown',
    collisions,
    timingIssues,
    missingSubtitles,
    rawGaps: gaps,
    summary: {
      totalGaps: gaps.length,
      collisionsCount,
      overlapsCount,
      desyncCount,
      missingCount,
      artifactsCount
    }
  };
}

/**
 * Saves QA gaps as the official timing project passport on disk and in localStorage
 */
export async function saveQAGapsToTimingProject(
  episode: Episode | null,
  gaps: MissingLineDetection[],
  tracks: Track[] = []
): Promise<{ success: boolean; path?: string; summary: TimingProjectData['summary'] }> {
  if (!episode) {
    throw new Error('Episode is required to save timing project');
  }

  const timingData = convertQAGapsToTimingData(episode, gaps, tracks);
  const epDir = getEpisodeDirectory(episode, tracks);
  timingData.episodeDir = epDir;

  // 1. Save to localStorage for instant React SPA cross-tab sync
  try {
    localStorage.setItem(`qa_timing_project_${episode.id}`, JSON.stringify(timingData));
    localStorage.setItem(`qa_detected_gaps_${episode.id}`, JSON.stringify(gaps));
  } catch (e) {
    console.warn('Failed to save timing project to localStorage:', e);
  }

  // 2. Save to disk via Electron IPC (both audio analysis timing passport and mixing metadata)
  let savedFilePath = '';
  if (epDir) {
    try {
      const res: any = await ipcSafe.invoke('audio-save-timing-analysis', {
        episodeDir: epDir,
        data: timingData
      });
      if (res) savedFilePath = res;
    } catch (e) {
      console.warn('audio-save-timing-analysis IPC failed:', e);
    }
  }

  try {
    await ipcSafe.invoke('mixing-save-timing-metadata', {
      episode,
      timingMetadata: {
        ...timingData,
        targetDir: epDir
      }
    });
  } catch (e) {
    console.warn('mixing-save-timing-metadata IPC failed:', e);
  }

  return {
    success: true,
    path: savedFilePath || (epDir ? `${epDir}/Тайминг/timing_project.analysis.json` : undefined),
    summary: timingData.summary
  };
}

/**
 * Loads the saved timing project data for an episode (from disk or localStorage)
 */
export async function loadTimingProjectForEpisode(
  episode: Episode | null,
  tracks: Track[] = []
): Promise<TimingProjectData | null> {
  if (!episode) return null;

  const epDir = getEpisodeDirectory(episode, tracks);

  // 1. Try to read from disk via IPC
  if (epDir) {
    try {
      const diskData: any = await ipcSafe.invoke('audio-get-timing-analysis', { episodeDir: epDir });
      if (diskData && (Array.isArray(diskData.collisions) || Array.isArray(diskData.timingIssues) || Array.isArray(diskData.rawGaps))) {
        return diskData as TimingProjectData;
      }
    } catch (e) {
      console.warn('Failed to get timing analysis from disk IPC:', e);
    }
  }

  // 2. Try to read from localStorage
  try {
    const rawLocal = localStorage.getItem(`qa_timing_project_${episode.id}`);
    if (rawLocal) {
      const parsed = JSON.parse(rawLocal);
      if (parsed) return parsed as TimingProjectData;
    }
  } catch (e) {
    console.warn('Failed to parse qa_timing_project from localStorage:', e);
  }

  // 3. Fallback: Check if raw detected gaps exist in localStorage and convert on-the-fly
  try {
    const rawGapsLocal = localStorage.getItem(`qa_detected_gaps_${episode.id}`);
    if (rawGapsLocal) {
      const gaps = JSON.parse(rawGapsLocal);
      if (Array.isArray(gaps) && gaps.length > 0) {
        return convertQAGapsToTimingData(episode, gaps, tracks);
      }
    }
  } catch (e) {}

  return null;
}

/**
 * Cross-links loaded QA Timing Passport data to audio clips so that
 * all detected collisions and timing issues are immediately visible on the timeline.
 */
export function applyTimingPassportToClips(
  clipsByTrack: Record<string, any[]>,
  passport: TimingProjectData
): Record<string, any[]> {
  if (!passport || (!passport.collisions?.length && !passport.timingIssues?.length)) {
    return clipsByTrack;
  }

  const updated: Record<string, any[]> = {};
  const allTrackIds = Object.keys(clipsByTrack);

  // Check if tracks have already been sliced into individual phrase clips
  const isSliced = allTrackIds.some(tId => {
    const trClips = clipsByTrack[tId] || [];
    return trClips.length > 1 || (trClips.length === 1 && !String(trClips[0].id).endsWith('_full') && trClips[0].durationSec < 90);
  });

  for (const trackId of allTrackIds) {
    const clips = clipsByTrack[trackId] || [];
    updated[trackId] = clips.map(clip => {
      const clipStart = clip.clipStartSec + (clip.offsetSec || 0);
      const clipEnd = clipStart + clip.durationSec;
      const dubberNorm = (clip.dubberName || '').toLowerCase().trim();

      // Check collision match
      const matchingCol = passport.collisions.find(col => {
        const trkMatch = col.track1Id === trackId || col.track2Id === trackId ||
          (col.dubber1Name && dubberNorm && col.dubber1Name.toLowerCase().trim() === dubberNorm) ||
          (col.dubber2Name && dubberNorm && col.dubber2Name.toLowerCase().trim() === dubberNorm);
        if (!trkMatch) return false;
        return !(clipEnd <= col.startSec + 0.03 || clipStart >= col.endSec - 0.03);
      });

      // Check timing issue match
      const matchingIssue = passport.timingIssues.find(iss => {
        const trkMatch = iss.trackId === trackId ||
          (iss.dubberName && dubberNorm && iss.dubberName.toLowerCase().trim() === dubberNorm) ||
          (iss.overlappingDubber && dubberNorm && iss.overlappingDubber.toLowerCase().trim() === dubberNorm);
        if (!trkMatch) return false;
        const issStart = iss.timeSec ?? (iss as any).startSec ?? 0;
        const issEnd = issStart + (iss.durationSec || 1.0);
        return !(clipEnd <= issStart + 0.03 || clipStart >= issEnd - 0.03);
      });

      let hasCollision = Boolean(matchingCol) || (matchingIssue?.type === 'overlap');
      let timingIssue: 'overlap' | 'desync' | 'orphan' | 'missing' | null | undefined = clip.timingIssue;
      let timingIssueText = clip.timingIssueText;
      let overlappingClipId = clip.overlappingClipId;

      if (hasCollision && isSliced && clip.durationSec < 90) {
        // Find actual overlapping partner clip on the timeline right now
        let partnerClip: any = null;
        for (const otherTrkId of allTrackIds) {
          for (const other of (clipsByTrack[otherTrkId] || [])) {
            if (other.id === clip.id || other.isPhysics || other.durationSec >= 90) continue;
            const oStart = other.clipStartSec + (other.offsetSec || 0);
            const oEnd = oStart + other.durationSec;
            const ov = Math.min(clipEnd, oEnd) - Math.max(clipStart, oStart);
            if (ov > 0.015) {
              partnerClip = other;
              break;
            }
          }
          if (partnerClip) break;
        }

        if (partnerClip) {
          overlappingClipId = partnerClip.id;
          timingIssue = 'overlap';
          timingIssueText = matchingIssue?.description ||
            (matchingCol
              ? `Наезд: «${matchingCol.dubber1Name}» и «${matchingCol.dubber2Name}» (${matchingCol.overlapDurationSec}с)`
              : `Наезд с «${partnerClip.dubberName}»`);
        } else {
          // If tracks are sliced and no clip actually overlaps this clip anymore, the collision is already resolved
          hasCollision = false;
          if (timingIssue === 'overlap') {
            timingIssue = null;
            timingIssueText = undefined;
          }
        }
      } else if (matchingIssue) {
        if (matchingIssue.type === 'overlap') {
          hasCollision = true;
          timingIssue = 'overlap';
          timingIssueText = matchingIssue.description;
        } else if (matchingIssue.type === 'desync') {
          if (typeof matchingIssue.subStartSec === 'number') {
            const startDelta = Math.abs(clipStart - matchingIssue.subStartSec);
            if (startDelta >= 0.30 && startDelta <= 1.50) {
              timingIssue = 'desync';
              timingIssueText = matchingIssue.description;
            }
          }
        } else {
          timingIssue = matchingIssue.type as any;
          timingIssueText = matchingIssue.description;
        }
      } else if (matchingCol) {
        hasCollision = true;
        timingIssue = 'overlap';
        timingIssueText = `Наезд: «${matchingCol.dubber1Name}» и «${matchingCol.dubber2Name}» (${matchingCol.overlapDurationSec}с)`;
      }

      return {
        ...clip,
        hasCollision,
        overlappingClipId,
        timingIssue: timingIssue ?? null,
        timingIssueText
      };
    });
  }

  return updated;
}
