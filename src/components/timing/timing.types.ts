import { Episode, Track, SubtitleLine, RoleAssignment } from '../../types';
import { NormalizationMetrics } from '../../lib/qa/audioNormalizer';
import { TimingSettings } from '../TimingSettingsModal';
import { TimingProjectData } from '../../lib/qa/timingSyncService';

export interface NoiseCalibration {
  noiseFloorDb: number;
  speechFloorDb: number;
  speechPeakDb: number;
  calculatedThresholdDb: number;
  thresholdAmp: number;
  dynamicRangeDb: number;
  snrDb: number;
}

export interface AudioClip {
  id: string;
  trackId: string;
  dubberName: string;
  characterName: string;
  clipStartSec: number;     // Position on timeline
  durationSec: number;      // Clip duration
  sourceStartSec: number;   // Start time inside audio file
  sourceEndSec: number;     // End time inside audio file
  text: string;             // Dialogue text hint / matched subtitle
  recognizedText?: string;  // What Whisper recognized in this audio phrase
  whisperMatchedScore?: number; // Match confidence percentage (0-100)
  volumePercent: number;    // Gain % (0 - 200%)
  volumeGainDb?: number;    // Gain dB offset (e.g. 0 dB for main voice, -10 dB for secondary voice in overlaps)
  isFix?: boolean;          // Flag for spliced fix takes
  isPhysics?: boolean;      // Non-dialogue character sound ("физика": sighs, grunts, laughs, gasps outside subtitles)
  coveredSubIds?: string[]; // All subtitle IDs voiced by this single clip (supports 1 clip -> K consecutive subtitles)
  speechOnsetOffsetSec?: number; // Offset from sourceStartSec to actual speech attack peak for unison sync
  overlapGroupId?: string;  // Intentional subtitle overlap group ID
  overlapRole?: 'main' | 'secondary' | 'background' | null; // Main (0 dB) vs Secondary (-10 dB) voice in overlapping dialogue
  recoveredFrom?: 'fix' | 'original'; // Set if recovered by Iterative Self-Healing Final Audit
  hasCollision?: boolean;   // Collision with another actor
  offsetSec: number;        // Manual mouse drag offset
  rawSourceStartSec?: number; // Detected start before any manual trim/expansion
  rawSourceEndSec?: number;   // Detected end before any manual trim/expansion
  isSelfOverlap?: boolean;    // Intentional parallel layer between 2 tracks of same dubber
  isIntentionalOverlap?: boolean; // Intentional overlap specified in original subtitles
  isUnisonPhrase?: boolean;   // Same subtitle phrase assigned to multiple dubbers (timed in absolute sync)
  matchedSubId?: string;      // ID of matched subtitle line
  sourceAudioTrackId?: string; // Track ID of audio buffer if spliced from fix track
  sourceAudioPath?: string;    // Direct file path on disk for export / mixing
  isStitchedFix?: boolean;
  customAudioBuffer?: AudioBuffer;
  customFilePath?: string;
  whisperRecognizedText?: string;
  whisperConfidence?: number;
  whisperMatchedByText?: boolean;
  // Two-Stage Auto-Timing Problem Tracking
  timingIssue?: 'overlap' | 'desync' | 'orphan' | null;
  timingIssueText?: string;
  targetSubStartSec?: number;
  targetSubEndSec?: number;
  timeDiffSec?: number;       // Difference in seconds from subtitle start (positive = late, negative = early)
  overlappingClipId?: string;
  isSplitContinuation?: boolean; // 2nd/3rd part of a phrase split by a dramatic pause inside the same subtitle (locked in place)
  overlapResolvedLock?: boolean; // Locked after surgical overlap separation so audit loop never pulls it back into collision
  overlapRoleDisabled?: boolean; // Explicitly disabled intentional overlap mode by user
  timingNotRequired?: boolean;   // Phrase within subtitle bounds or tail <= 30% of sub duration
  timingNotRequiredReason?: string;
}

export interface IntentionalOverlapTrackEntry {
  trackId: string;
  dubberNick: string;
  characterName: string;
  phraseId: string;
  subId: string;
  text: string;
  phraseStartSec: number;
  phraseEndSec: number;
}

export interface IntentionalOverlapMoment {
  id: string;
  startSec: number;
  endSec: number;
  overlapStartSec: number;
  overlapEndSec: number;
  subStartSec: number;
  subEndSec: number;
  priorityTrackKey: string | null;
  attenuationDb: number;
  tracks: IntentionalOverlapTrackEntry[];
}

export type TimingIssueType = 'overlap' | 'desync' | 'missing' | 'orphan';

export interface TimingIssue {
  id: string;
  type: TimingIssueType;
  severity?: 'error' | 'warning';
  trackId: string;
  dubberName: string;
  characterName: string;
  clipId?: string;
  timeSec: number;
  endSec?: number;
  durationSec?: number;
  subText?: string;
  subStartSec?: number;
  subEndSec?: number;
  timeDiffSec?: number;
  driftSec?: number;
  overlapDurationSec?: number;
  overlappingTrackId?: string;
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

export interface OriginalStemsState {
  hasStems: boolean;
  modelId: string;
  vocalsUrl?: string | null;
  vocalsPath?: string | null;
  instrumentalUrl?: string | null;
  instrumentalPath?: string | null;
  vocalsPeaks: number[] | null;
  instrumentalPeaks: number[] | null;
  vocalsVolume: number;
  instrumentalVolume: number;
  vocalsMuted: boolean;
  instrumentalMuted: boolean;
  vocalsSolo?: boolean;
  instrumentalSolo?: boolean;
  vocalsWaveScale?: number;
  instrumentalWaveScale?: number;
  vocalsTrackHeight?: number;
  instrumentalTrackHeight?: number;
  isSeparating?: boolean;
  separationProgress?: number;
  separationStatus?: string;
}

export interface FinalVerificationUnvoicedSub {
  id: string;
  trackId: string;
  dubberName: string;
  characterName: string;
  text: string;
  startSec: number;
  endSec: number;
}

export interface FinalVerificationReport {
  totalSubs: number;
  voicedSubs: number;
  recoveredFromFixCount: number;
  recoveredFromOrigCount: number;
  voicedByOtherDubberCount?: number;
  realignedCount: number;
  physicsProtectedCount: number;
  iterationsRun: number;
  passed: boolean;
  unvoicedSubs: FinalVerificationUnvoicedSub[];
}

export interface ActiveTimingProcess {
  title: string;
  detail: string;
  progress: number;
  stepCurrent?: number;
  stepTotal?: number;
}

export interface DecodedTrackProgressItem {
  id: string;
  name: string;
  duration?: number;
  status: 'pending' | 'decoding' | 'done' | 'error';
  clipsCount?: number;
}

export interface OperationLogEntry {
  time: string;
  msg: string;
  level: 'info' | 'warn' | 'error' | 'success';
}

export type TrackHeightMode = 'standard' | 'compact' | 'fit';
export type VideoWindowSize = 'S' | 'M' | 'L';
export type IssueFilterType = 'all' | 'overlap' | 'desync' | 'missing' | 'orphan';

export interface DraggingClipState {
  clipId: string;
  trackId: string;
  startMouseX: number;
  initialOffsetSec: number;
}

export interface ResizingClipState {
  clipId: string;
  trackId: string;
  edge: 'left' | 'right';
  startMouseX: number;
  initialSourceStartSec: number;
  initialSourceEndSec: number;
  initialClipStartSec: number;
  initialDurationSec: number;
  initialOffsetSec: number;
}

export interface DraggingVideoState {
  startMouseX: number;
  startMouseY: number;
  initialX: number;
  initialY: number;
}

export interface ActivePopoverClipState {
  clipId: string;
  trackId: string;
  x: number;
  y: number;
}

export interface OriginalWaveformStats {
  peaks: number[];
  normPeaks: number[];
  phraseSegments: Array<{ startSec: number; endSec: number; peakDb: number }>;
  p95: number;
  median: number;
}

export interface QAPassportLoadedState {
  loaded: boolean;
  summary: TimingProjectData['summary'];
  savedAt: string;
}

export interface SavedTimingStateInfo {
  savedAt: string;
  filePath?: string;
}

export interface TimingPanelProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
  onNavigate?: (tab: 'dashboard' | 'subtitles' | 'qa' | 'timing' | 'mixing' | 'release' | 'telegram' | 'settings' | 'database' | 'cover' | 'stats' | 'archive') => void;
}

export type {
  Episode,
  Track,
  SubtitleLine,
  RoleAssignment,
  NormalizationMetrics,
  TimingSettings,
  TimingProjectData
};
