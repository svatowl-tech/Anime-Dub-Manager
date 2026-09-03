import { ipcSafe } from './ipcSafe';
import { extractEpisodeNumber } from './episodeNumberExtractor';
import { Project, Episode, RoleAssignment } from '../types';
import { toast } from 'sonner';
import { inspectMkvTracks, MkvTrackInfo } from './mkvSubtitleExtractor';
import { sanitizeFolderName } from './pathUtils';

export interface LinkTorrentResult {
  success: boolean;
  episodeNumber: number;
  targetEpisode?: Episode;
  fileType: 'video' | 'subtitle' | 'audio' | 'other';
  detectedSubtitleTracks?: MkvTrackInfo[];
  filePath?: string;
  error?: string;
}

/**
 * Automatically links a completed downloaded torrent file to the appropriate project episode.
 */
export async function linkDownloadedTorrentFile(params: {
  projectId: string;
  filePath: string;
  fileName?: string;
  fallbackEpNumber?: number;
  isSingleDownload?: boolean;
  currentEpisodeId?: string;
  onRefresh?: () => void;
}): Promise<LinkTorrentResult> {
  const { projectId, filePath, fileName, fallbackEpNumber, onRefresh } = params;
  if (!projectId || !filePath) {
    return { success: false, episodeNumber: 1, fileType: 'other', error: 'Missing projectId or filePath' };
  }

  const nameToParse = fileName || filePath.split(/[/\\]/).pop() || '';
  const ext = (filePath.split('.').pop() || '').toLowerCase();
  
  const isVideo = ['mkv', 'mp4', 'webm', 'avi', 'mov', 'ts', 'flv', 'm4v', 'wmv'].includes(ext);
  const isSubtitle = ['ass', 'srt', 'vtt', 'ssa'].includes(ext);
  const isAudio = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'].includes(ext);
  const fileType: 'video' | 'subtitle' | 'audio' | 'other' = isVideo ? 'video' : isSubtitle ? 'subtitle' : isAudio ? 'audio' : 'other';

  try {
    // 1. Fetch freshest project instance from backend
    const proj: Project | null = await ipcSafe.invoke('get-project', projectId);
    if (!proj) {
      throw new Error(`Проект не найден (ID: ${projectId})`);
    }

    const episodes: Episode[] = Array.isArray(proj.episodes) ? [...proj.episodes] : [];
    
    // 2. Determine target episode number
    let detectedEpNum = extractEpisodeNumber(nameToParse, fallbackEpNumber);
    if (!detectedEpNum || detectedEpNum <= 0) {
      detectedEpNum = fallbackEpNumber && fallbackEpNumber > 0 ? fallbackEpNumber : Math.max(1, episodes.length + 1);
    }

    // 3. Find existing episode or construct a new one
    let targetEp = episodes.find(e => e.number === detectedEpNum);
    let isNewEpisode = false;

    if (!targetEp) {
      isNewEpisode = true;
      targetEp = {
        id: `ep-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        projectId: proj.id,
        number: detectedEpNum,
        status: 'ROLES',
        assignments: [],
        uploads: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      episodes.push(targetEp);
      episodes.sort((a, b) => a.number - b.number);
    }

    // 4. Update episode paths based on file type
    const updatedEp: Episode = { ...targetEp, updatedAt: new Date().toISOString() };
    const projectTitle = sanitizeFolderName(proj.title || 'Project');
    const episodeFolder = sanitizeFolderName(`Episode_${updatedEp.number}`);
    const subDir = `${projectTitle}/${episodeFolder}`;

    let detectedSubtitleTracks: MkvTrackInfo[] = [];

    if (isVideo) {
      const targetFileName = `raw_video.${ext}`;
      let finalVideoPath = filePath;

      try {
        const copyRes = await ipcSafe.invoke('copy-file', {
          sourcePath: filePath,
          targetDir: subDir,
          fileName: targetFileName
        });
        if (copyRes && copyRes.path) {
          finalVideoPath = copyRes.path;
        }
      } catch (copyErr) {
        console.warn('Failed to copy torrent video to project folder, using original path:', copyErr);
      }

      updatedEp.rawPath = finalVideoPath;
      updatedEp.isHardsub = false;

      // If video is MKV, inspect for embedded subtitle streams and enqueue background transcode
      if (ext === 'mkv') {
        try {
          const { subtitles } = await inspectMkvTracks(finalVideoPath);
          if (subtitles && subtitles.length > 0) {
            detectedSubtitleTracks = subtitles;
          }
        } catch (e) {
          console.warn('Failed to inspect torrent MKV for subtitle tracks:', e);
        }

        // Transcode MKV -> MP4 for HTML5 browser/player compatibility
        const mp4OutputPath = finalVideoPath.replace(/\.mkv$/i, '.mp4');
        try {
          await ipcSafe.invoke('enqueue-ffmpeg-task', {
            type: 'transcode-video',
            payload: {
              videoPath: finalVideoPath,
              outputPath: mp4OutputPath,
              options: {}
            },
            metadata: {
              title: `Конвертация серии ${updatedEp.number} (MKV -> MP4)`,
              episodeId: updatedEp.id,
              projectId: proj.id,
              outputPath: mp4OutputPath
            }
          });
        } catch (tqErr) {
          console.error('Failed to enqueue transcode task for torrent video:', tqErr);
        }
      }
    } else if (isSubtitle) {
      const targetFileName = `subtitles.${ext}`;
      let finalSubPath = filePath;

      try {
        const copyRes = await ipcSafe.invoke('copy-file', {
          sourcePath: filePath,
          targetDir: subDir,
          fileName: targetFileName
        });
        if (copyRes && copyRes.path) {
          finalSubPath = copyRes.path;
        }
      } catch (copyErr) {
        console.warn('Failed to copy torrent subtitle to project folder, using original path:', copyErr);
      }

      updatedEp.subPath = finalSubPath;
      
      // Auto-extract characters & lines from subtitle
      try {
        const subData = await ipcSafe.invoke('get-raw-subtitles', finalSubPath);
        if (subData && subData.actors && Array.isArray(subData.actors)) {
          const rawActors: string[] = subData.actors;
          const lines: any[] = subData.lines || [];
          const globalMapping = proj.globalMapping || {};
          const existingAssignments = updatedEp.assignments || [];

          const newAssignments: RoleAssignment[] = rawActors.map((actor: string) => {
            const actorLines = lines.filter((l: any) => l.actor === actor || l.character === actor);
            const lineCount = actorLines.length;
            const mappedParticipantId = typeof globalMapping === 'object' && globalMapping ? (globalMapping as any)[actor] || '' : '';

            return {
              id: `${updatedEp.id}-${actor}-${Date.now()}`,
              episodeId: updatedEp.id,
              characterName: actor,
              dubberId: mappedParticipantId,
              lineCount: lineCount,
              status: mappedParticipantId ? 'PENDING' : 'PENDING'
            };
          });

          updatedEp.assignments = [...existingAssignments, ...newAssignments];
        }
      } catch (e) {
        console.warn('Auto character extraction on torrent sub failed:', e);
      }
    }

    // Advance to ROLES if both rawPath and subPath are present
    if (updatedEp.rawPath && updatedEp.subPath) {
      updatedEp.status = 'ROLES';
    }

    // 5. Save changes to DB
    if (isNewEpisode) {
      const updatedProject = { ...proj, episodes };
      await ipcSafe.invoke('save-project', updatedProject);
    } else {
      await ipcSafe.invoke('save-episode', updatedEp);
    }

    if (onRefresh) {
      onRefresh();
    }

    const typeName = isVideo ? 'Видео (RAW)' : isSubtitle ? 'Субтитры' : isAudio ? 'Аудио' : 'Файл';
    toast.success(`Серия ${updatedEp.number}: ${typeName} успешно прикреплен!`);

    return {
      success: true,
      episodeNumber: updatedEp.number,
      targetEpisode: updatedEp,
      fileType,
      detectedSubtitleTracks,
      filePath: updatedEp.rawPath || filePath
    };

  } catch (err: any) {
    console.error('Failed to link downloaded torrent file:', err);
    toast.error(`Ошибка прикрепления файла к серии: ${err.message || String(err)}`);
    return {
      success: false,
      episodeNumber: 1,
      fileType,
      error: err.message || String(err)
    };
  }
}

