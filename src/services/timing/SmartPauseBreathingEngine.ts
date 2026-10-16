import { AudioClip, SmartPauseOptions, ClipAlignmentDiff } from '../../types/timing';
import { SubtitleLine } from '../../types';
import { detectInternalPauses } from './AudioVADEngine';

export const DEFAULT_SMART_PAUSE_OPTIONS: SmartPauseOptions = {
  minPauseDurationSec: 0.08,    // 80ms minimum pause to retain natural breath
  silenceThresholdDb: -40.0,    // -40 dB silence detection threshold
  maxCompressionRatio: 0.35,    // Allow compressing pauses down to 35% of their original duration
  maxExpansionRatio: 2.2,       // Allow expanding pauses up to 220%
  protectBreathTails: true,     // Protect breath intakes at the start and end of phrases
  preventCollisions: true       // Prevent overlapping into adjacent character lines
};

/**
 * Calculates smart pause breathing diffs for all clips mapped to subtitles.
 * Pure function: does not mutate input clips.
 */
export function calculateSmartPauseAlignment(
  clips: AudioClip[],
  subtitles: SubtitleLine[],
  audioBuffers: Record<string, AudioBuffer>,
  options: Partial<SmartPauseOptions> = {}
): ClipAlignmentDiff[] {
  const opts: SmartPauseOptions = { ...DEFAULT_SMART_PAUSE_OPTIONS, ...options };
  const diffs: ClipAlignmentDiff[] = [];

  for (const clip of clips) {
    if (!clip.targetSubStartSec || !clip.targetSubEndSec) {
      continue;
    }

    const targetStart = clip.targetSubStartSec;
    const targetEnd = clip.targetSubEndSec;
    const targetDuration = Math.max(0.1, targetEnd - targetStart);
    const origDuration = clip.durationSec;
    const durationDelta = targetDuration - origDuration;

    const audioBuf = audioBuffers[clip.sourceAudioTrackId || clip.trackId];
    const internalPauses = audioBuf
      ? detectInternalPauses(audioBuf, clip.sourceStartSec, clip.sourceEndSec, {
          minPauseSec: opts.minPauseDurationSec,
          silenceThresholdDb: opts.silenceThresholdDb
        })
      : [];

    const totalInternalPauseDuration = internalPauses.reduce((acc, p) => acc + p.durationSec, 0);

    let adjustedDuration = origDuration;
    let pauseDeltaSec = 0;
    let status: ClipAlignmentDiff['status'] = 'perfect';

    if (Math.abs(durationDelta) < 0.04) {
      // Already aligned within 40ms threshold
      status = 'perfect';
      adjustedDuration = targetDuration;
    } else if (durationDelta < 0) {
      // Clip is longer than subtitle by Math.abs(durationDelta)
      const neededCompression = Math.abs(durationDelta);
      const maxPossibleReduction = internalPauses.reduce((acc, p) => {
        return acc + Math.max(0, p.durationSec - opts.minPauseDurationSec);
      }, 0);

      if (maxPossibleReduction >= neededCompression) {
        // Can be 100% absorbed by compressing inter-word pauses
        status = 'adjusted';
        adjustedDuration = targetDuration;
        pauseDeltaSec = -neededCompression;
      } else if (maxPossibleReduction > 0) {
        // Partially absorbed
        status = 'adjusted';
        adjustedDuration = origDuration - maxPossibleReduction;
        pauseDeltaSec = -maxPossibleReduction;
      } else {
        // Words are spoken too slowly with almost no pauses
        status = 'exceeds_limit';
        adjustedDuration = origDuration;
      }
    } else {
      // Clip is shorter than subtitle: expand internal pauses if present
      if (internalPauses.length > 0 && totalInternalPauseDuration > 0.1) {
        const expansionAllowed = totalInternalPauseDuration * (opts.maxExpansionRatio - 1.0);
        const actualExpansion = Math.min(durationDelta, expansionAllowed);
        status = 'adjusted';
        adjustedDuration = origDuration + actualExpansion;
        pauseDeltaSec = actualExpansion;
      } else {
        // Phrase is spoken quickly, keep speech tempo intact and align start
        status = 'adjusted';
        adjustedDuration = origDuration;
      }
    }

    // Recommended position shift
    const recommendedShift = targetStart - clip.clipStartSec;

    diffs.push({
      clipId: clip.id,
      trackId: clip.trackId,
      characterName: clip.characterName,
      subText: clip.text || '',
      targetStartSec: Number(targetStart.toFixed(3)),
      targetEndSec: Number(targetEnd.toFixed(3)),
      originalStartSec: Number(clip.clipStartSec.toFixed(3)),
      originalDurationSec: Number(origDuration.toFixed(3)),
      adjustedStartSec: Number(targetStart.toFixed(3)),
      adjustedDurationSec: Number(adjustedDuration.toFixed(3)),
      pauseDeltaSec: Number(pauseDeltaSec.toFixed(3)),
      status,
      recommendedShiftSec: Number(recommendedShift.toFixed(3)),
      isApproved: status === 'perfect' || status === 'adjusted'
    });
  }

  return diffs;
}

/**
 * Applies approved alignment diffs to the clip collection.
 */
export function applySmartPauseDiffs(
  clipsByTrack: Record<string, AudioClip[]>,
  diffs: ClipAlignmentDiff[]
): Record<string, AudioClip[]> {
  const diffMap = new Map<string, ClipAlignmentDiff>();
  diffs.forEach(d => {
    if (d.isApproved) diffMap.set(d.clipId, d);
  });

  const nextClipsByTrack: Record<string, AudioClip[]> = {};

  Object.entries(clipsByTrack).forEach(([trackId, trackClips]) => {
    nextClipsByTrack[trackId] = trackClips.map(clip => {
      const diff = diffMap.get(clip.id);
      if (!diff) return clip;

      return {
        ...clip,
        clipStartSec: diff.adjustedStartSec,
        durationSec: diff.adjustedDurationSec,
        offsetSec: 0,
        timeDiffSec: 0,
        timingIssue: null,
        timingIssueText: undefined,
        pauseModifications: diff.pauseDeltaSec !== 0 ? {
          originalPauseDuration: clip.durationSec,
          compensatedPauseDuration: diff.adjustedDurationSec,
          pauseIntervals: []
        } : clip.pauseModifications
      };
    });
  });

  return nextClipsByTrack;
}
