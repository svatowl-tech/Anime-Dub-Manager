/**
 * Media manager for fetching character dialogue lines, resolving video paths,
 * extracting frame snapshots, and caching previews.
 */

import { ipcSafe } from '../ipcSafe';
import { CharacterDialogueLine } from './characterPreviewTypes';
import { parseAssTimeToSeconds, cleanDialogueText } from './timeUtils';

// Frame cache by `${videoPath}_${timeSec}`
const frameCache = new Map<string, string>();

/**
 * Resolves a local or remote video/audio path to a playable HTML5 media source.
 */
export async function resolveVideoUrl(videoPath: string): Promise<string> {
  if (!videoPath) return '';
  if (videoPath.startsWith('http://') || videoPath.startsWith('https://') || videoPath.startsWith('blob:') || videoPath.startsWith('data:')) {
    return videoPath;
  }

  // Check in browser electron vs web environment
  if (typeof window !== 'undefined' && !window.electronAPI) {
    const cleanName = videoPath.replace(/\\/g, '/').split('/').pop() || videoPath;
    const cached = (window as any).getFileFromCache?.(cleanName);
    if (cached) {
      return URL.createObjectURL(cached);
    }
    try {
      const { resolveLocalPath } = await import('../webFileSystem');
      const resolved = await resolveLocalPath(videoPath);
      if (resolved) return resolved;
    } catch (err) {
      console.warn('Could not resolve local path:', err);
    }
  } else {
    // Electron environment
    if (!videoPath.startsWith('file://')) {
      return `file://${videoPath.replace(/\\/g, '/')}`;
    }
  }

  return videoPath;
}

/**
 * Fetches and filters dialogue lines for a specific character from the episode subtitle file.
 */
export async function fetchCharacterDialogueLines(
  subPath: string,
  targetCharacterName: string,
  aliases: Record<string, string> = {}
): Promise<CharacterDialogueLine[]> {
  if (!subPath || !targetCharacterName) return [];

  try {
    const result = await ipcSafe.invoke('get-raw-subtitles', subPath);
    if (!result) return [];

    const rawLines: any[] = result.lines || result || [];
    if (!Array.isArray(rawLines)) return [];

    const targetLower = targetCharacterName.trim().toLowerCase();

    // Map each raw line to CharacterDialogueLine and filter
    const characterLines: CharacterDialogueLine[] = [];

    rawLines.forEach((line, index) => {
      const actor = (line.name || line.style || '').trim();
      const mappedActor = aliases[actor] || actor;
      const actorLower = actor.toLowerCase();
      const mappedActorLower = mappedActor.toLowerCase();

      // Check if line belongs to target character
      const isMatch =
        actorLower === targetLower ||
        mappedActorLower === targetLower ||
        targetLower === actorLower ||
        (aliases[targetCharacterName] && aliases[targetCharacterName].toLowerCase() === actorLower);

      if (isMatch) {
        const start = line.start || '0:00:00.00';
        const end = line.end || '0:00:00.00';
        const startSec = line.startSec !== undefined ? Number(line.startSec) : parseAssTimeToSeconds(start);
        const endSec = line.endSec !== undefined ? Number(line.endSec) : parseAssTimeToSeconds(end);
        const rawText = line.text || '';
        const clean = cleanDialogueText(rawText);

        characterLines.push({
          id: index + 1,
          rawIndex: line.rawLineIndex !== undefined ? line.rawLineIndex : index + 1,
          start,
          end,
          startSec,
          endSec,
          durationSec: Math.max(0.1, endSec - startSec),
          name: actor || targetCharacterName,
          style: line.style || 'Default',
          rawText,
          cleanText: clean,
        });
      }
    });

    // Sort by startSec
    characterLines.sort((a, b) => a.startSec - b.startSec);
    return characterLines;
  } catch (error) {
    console.error('Error fetching character dialogue lines:', error);
    return [];
  }
}

/**
 * Extracts a video snapshot frame at a given timestamp using an offscreen canvas.
 */
export async function captureVideoFrame(
  videoElement: HTMLVideoElement,
  timeSec: number,
  quality = 0.92
): Promise<string> {
  const cacheKey = `${videoElement.src}_${timeSec.toFixed(2)}`;
  if (frameCache.has(cacheKey)) {
    return frameCache.get(cacheKey)!;
  }

  return new Promise<string>((resolve) => {
    // If video is already at the desired time or ready
    const handleSeeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = videoElement.videoWidth || 1280;
        canvas.height = videoElement.videoHeight || 720;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          frameCache.set(cacheKey, dataUrl);
          resolve(dataUrl);
        } else {
          resolve('');
        }
      } catch (err) {
        console.warn('Failed to capture frame to canvas:', err);
        resolve('');
      }
    };

    if (Math.abs(videoElement.currentTime - timeSec) < 0.05 && videoElement.readyState >= 2) {
      handleSeeked();
    } else {
      const onSeek = () => {
        videoElement.removeEventListener('seeked', onSeek);
        handleSeeked();
      };
      videoElement.addEventListener('seeked', onSeek, { once: true });
      videoElement.currentTime = timeSec;
    }
  });
}
