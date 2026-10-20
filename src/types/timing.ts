import { Episode, Track, SubtitleLine, RoleAssignment, Comment } from '../types';

export interface AudioClip {
  id: string;
  trackId: string;
  dubberName: string;
  characterName: string;
  clipStartSec: number;        // Position on timeline in seconds
  durationSec: number;         // Total visible duration
  sourceStartSec: number;      // Start position within original audio file
  sourceEndSec: number;        // End position within original audio file
  text: string;                // Dialogue line hint
  recognizedText?: string;     // Speech-to-text transcription
  whisperMatchedScore?: number; // Match confidence (0-100)
  volumePercent: number;       // Gain percentage (0-200%)
  isFix?: boolean;             // Splice from fix take
  hasCollision?: boolean;      // Overlap with another character
  offsetSec: number;           // User manual offset
  rawSourceStartSec?: number;  // Detected initial start
  rawSourceEndSec?: number;    // Detected initial end
  isSelfOverlap?: boolean;
  isIntentionalOverlap?: boolean;
  sourceAudioTrackId?: string;
  sourceAudioPath?: string;
  timingIssue?: 'overlap' | 'desync' | 'orphan' | null;
  timingIssueText?: string;
  targetSubStartSec?: number;
  targetSubEndSec?: number;
  timeDiffSec?: number;
  overlappingClipId?: string;
  // Pause compensation metadata
  pauseModifications?: {
    originalPauseDuration: number;
    compensatedPauseDuration: number;
    pauseIntervals: Array<{ startSec: number; endSec: number; scale: number }>;
  };
}

export type TimingIssueType = 'overlap' | 'desync' | 'missing' | 'orphan';

export interface TimingIssue {
  id: string;
  type: TimingIssueType;
  trackId: string;
  dubberName: string;
  characterName: string;
  clipId?: string;
  timeSec: number;
  durationSec?: number;
  subText?: string;
  subStartSec?: number;
  subEndSec?: number;
  timeDiffSec?: number;
  overlapDurationSec?: number;
  overlappingClipId?: string;
  overlappingDubber?: string;
  whisperText?: string;
  whisperMatchScore?: number;
  description: string;
  isResolved?: boolean;
}

export interface MissingSubtitleMarker {
  id: string;
  subId: string;
  trackId: string;
  dubberName: string;
  characterName: string;
  startSec: number;
  endSec: number;
  text: string;
}

export interface StitchedFixMarker {
  id: string;
  trackId: string;
  dubberName: string;
  characterName: string;
  startSec: number;
  endSec: number;
  filename: string;
}

export interface VoiceCollisionMarker {
  id: string;
  track1Id: string;
  track2Id: string;
  dubber1Name: string;
  dubber2Name: string;
  character1Name: string;
  character2Name: string;
  startSec: number;
  endSec: number;
  overlapDurationSec: number;
}

export interface NoiseCalibration {
  noiseFloorDb: number;
  speechFloorDb: number;
  speechPeakDb: number;
  calculatedThresholdDb: number;
  thresholdAmp: number;
  dynamicRangeDb: number;
  snrDb: number;
}

export interface SpeechInterval {
  startSec: number;
  endSec: number;
  durationSec: number;
  internalPauses?: Array<{ startSec: number; endSec: number; durationSec: number }>;
}

export interface SmartPauseOptions {
  minPauseDurationSec: number;    // Minimum allowable pause to retain natural breathing (e.g. 0.08s)
  silenceThresholdDb: number;     // Silence floor (e.g. -38 dB)
  maxCompressionRatio: number;    // Maximum allowable compression (e.g. 0.35x of pause)
  maxExpansionRatio: number;      // Maximum expansion (e.g. 2.0x of pause)
  protectBreathTails: boolean;     // Add 40ms safety padding around breath intakes
  preventCollisions: boolean;     // Adjust neighboring clips if conflict detected
}

export interface ClipAlignmentDiff {
  clipId: string;
  trackId: string;
  characterName: string;
  subText: string;
  targetStartSec: number;
  targetEndSec: number;
  originalStartSec: number;
  originalDurationSec: number;
  adjustedStartSec: number;
  adjustedDurationSec: number;
  pauseDeltaSec: number;
  status: 'perfect' | 'adjusted' | 'exceeds_limit' | 'collision';
  recommendedShiftSec: number;
  isApproved: boolean;
}

export interface TimingPanelProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
  onNavigate?: (tab: 'dashboard' | 'subtitles' | 'qa' | 'timing' | 'mixing' | 'release' | 'telegram' | 'settings' | 'database' | 'cover' | 'stats' | 'archive') => void;
}
