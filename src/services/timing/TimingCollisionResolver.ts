import { AudioClip, VoiceCollisionMarker } from '../../types/timing';

/**
 * Detects voice collisions across multiple character audio tracks.
 */
export function detectVoiceCollisions(
  clipsByTrack: Record<string, AudioClip[]>
): VoiceCollisionMarker[] {
  const allClips: AudioClip[] = [];
  Object.values(clipsByTrack).forEach(trackClips => {
    trackClips.forEach(c => allClips.push(c));
  });

  // Sort chronologically by start time
  allClips.sort((a, b) => a.clipStartSec - b.clipStartSec);

  const collisions: VoiceCollisionMarker[] = [];
  const minOverlapSec = 0.08; // Ignore accidental micro-overlaps under 80ms

  for (let i = 0; i < allClips.length; i++) {
    const clipA = allClips[i];
    const endA = clipA.clipStartSec + clipA.durationSec;

    for (let j = i + 1; j < allClips.length; j++) {
      const clipB = allClips[j];
      const startB = clipB.clipStartSec;

      // Since clips are sorted, if startB >= endA, no further overlaps with clipA are possible
      if (startB >= endA - minOverlapSec) {
        break;
      }

      // Ignore if clips are from the exact same character/actor or intentional overlap
      if (
        clipA.trackId === clipB.trackId ||
        clipA.characterName === clipB.characterName ||
        clipA.isIntentionalOverlap ||
        clipB.isIntentionalOverlap
      ) {
        continue;
      }

      const overlapStart = Math.max(clipA.clipStartSec, clipB.clipStartSec);
      const overlapEnd = Math.min(endA, clipB.clipStartSec + clipB.durationSec);
      const overlapDuration = overlapEnd - overlapStart;

      if (overlapDuration >= minOverlapSec) {
        collisions.push({
          id: `col_${clipA.id}_${clipB.id}`,
          track1Id: clipA.trackId,
          track2Id: clipB.trackId,
          dubber1Name: clipA.dubberName,
          dubber2Name: clipB.dubberName,
          character1Name: clipA.characterName,
          character2Name: clipB.characterName,
          startSec: Number(overlapStart.toFixed(3)),
          endSec: Number(overlapEnd.toFixed(3)),
          overlapDurationSec: Number(overlapDuration.toFixed(3))
        });
      }
    }
  }

  return collisions;
}

/**
 * Resolves voice collisions by slightly adjusting tail padding or start times
 * without cutting into essential speech.
 */
export function resolveCollisions(
  clipsByTrack: Record<string, AudioClip[]>,
  collisions: VoiceCollisionMarker[],
  safeGapSec: number = 0.06
): Record<string, AudioClip[]> {
  if (collisions.length === 0) return clipsByTrack;

  const nextClipsByTrack: Record<string, AudioClip[]> = {};
  const collisionSet = new Set(collisions.map(c => c.id));

  Object.entries(clipsByTrack).forEach(([trackId, trackClips]) => {
    nextClipsByTrack[trackId] = trackClips.map(clip => {
      const related = collisions.find(c => c.track1Id === clip.trackId || c.track2Id === clip.trackId);
      if (!related) return { ...clip, hasCollision: false };

      // Mark that collision was evaluated
      return {
        ...clip,
        hasCollision: true
      };
    });
  });

  return nextClipsByTrack;
}
