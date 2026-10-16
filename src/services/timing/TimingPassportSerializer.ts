import { AudioClip, VoiceCollisionMarker, TimingIssue, MissingSubtitleMarker } from '../../types/timing';
import { Episode, Track } from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';

export interface TimingPassportPayload {
  version: string;
  episodeId: string;
  episodeNumber: number;
  exportedAt: string;
  clipsByTrack: Record<string, AudioClip[]>;
  collisions: VoiceCollisionMarker[];
  timingIssues: TimingIssue[];
  totalClipsCount: number;
}

/**
 * Creates a complete serializable snapshot of the current timing project.
 */
export function createTimingPassport(
  episode: Episode | null,
  clipsByTrack: Record<string, AudioClip[]>,
  collisions: VoiceCollisionMarker[] = [],
  timingIssues: TimingIssue[] = []
): TimingPassportPayload {
  let totalClips = 0;
  Object.values(clipsByTrack).forEach(cList => {
    totalClips += cList.length;
  });

  return {
    version: '2.0-pro',
    episodeId: episode?.id || 'unknown',
    episodeNumber: episode?.number || 1,
    exportedAt: new Date().toISOString(),
    clipsByTrack,
    collisions,
    timingIssues,
    totalClipsCount: totalClips
  };
}

/**
 * Saves timing passport to local disk via IPC.
 */
export async function saveTimingPassportToDisk(
  episode: Episode | null,
  passport: TimingPassportPayload,
  episodeDir?: string
): Promise<boolean> {
  try {
    const jsonStr = JSON.stringify(passport, null, 2);
    if ((window as any).electronAPI) {
      const res = await ipcSafe.invoke('save-timing-passport', {
        episodeId: episode?.id,
        episodeDir,
        passportData: jsonStr
      });
      return !!res?.success;
    }
    // Fallback: localStorage
    localStorage.setItem(`timing_passport_${episode?.id}`, jsonStr);
    return true;
  } catch (err) {
    console.error('Failed to save timing passport to disk:', err);
    return false;
  }
}

/**
 * Loads timing passport from disk or localStorage.
 */
export async function loadTimingPassportFromDisk(
  episode: Episode | null,
  episodeDir?: string
): Promise<TimingPassportPayload | null> {
  try {
    if ((window as any).electronAPI) {
      const res = await ipcSafe.invoke('load-timing-passport', {
        episodeId: episode?.id,
        episodeDir
      });
      if (res && res.passportData) {
        return typeof res.passportData === 'string' ? JSON.parse(res.passportData) : res.passportData;
      }
    }
    // Fallback: localStorage
    const saved = localStorage.getItem(`timing_passport_${episode?.id}`);
    if (saved) {
      return JSON.parse(saved);
    }
    return null;
  } catch (err) {
    console.warn('Could not load timing passport from disk:', err);
    return null;
  }
}
