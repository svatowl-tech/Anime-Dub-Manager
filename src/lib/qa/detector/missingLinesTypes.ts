import { Track, SubtitleLine } from '../../../types';
import { AudioArtifactType, ArtifactSeverity } from '../artifactDetector';
import { WordDiff, TextDiscrepancyType } from '../whisperTextChecker';

export interface QAScanLogEntry {
  id: string;
  timestamp: string;
  stage: 'general' | 'audio' | 'missing' | 'speech' | 'collisions' | 'timing' | 'artifacts' | 'whisper';
  level: 'info' | 'success' | 'warn' | 'error' | 'whisper';
  message: string;
  details?: string;
}

export interface WhisperScanStatus {
  attempted: boolean;
  ready: boolean;
  success: boolean;
  modelUsed?: string;
  totalLinesChecked: number;
  discrepanciesCount: number;
  errorMessage?: string;
  completedAt?: string;
}

export interface QAScanReport {
  timestamp: string;
  totalTracks: number;
  totalSubLines: number;
  totalGapsFound: number;
  whisperStatus: WhisperScanStatus;
  logs: QAScanLogEntry[];
}

export type DefectCategory = 
  | 'missing_line' 
  | 'unwanted_speech' 
  | 'actor_collision' 
  | 'timing_too_short' 
  | 'timing_too_long' 
  | 'actor_overlap'
  | 'audio_artifact'
  | 'text_mismatch';

export type DefectType = 
  | 'silence' 
  | 'noise' 
  | 'unwanted_speech' 
  | 'actor_collision' 
  | 'timing_too_short' 
  | 'timing_too_long' 
  | 'actor_overlap'
  | 'clipping'
  | 'mouse_click'
  | 'plosive'
  | 'swallowed_vowel'
  | 'text_mismatch';

export type DefectResolution = 
  | 'keep' 
  | 'silence' 
  | 'fix_subs' 
  | 'reassign_character'
  | 'keep_first' 
  | 'keep_second' 
  | 'transfer_first_to_second'
  | 'transfer_second_to_first'
  | 'auto_shift'
  | 'keep_both'
  | 'note_sound_engineer'
  | 'request_dubber_fix'
  | 'ignore'
  | 'trim_tail'
  | 'actor_better_than_sub'
  | 'legitimate_fix';

export interface MissingLineDetection {
  id: string;
  defectCategory?: DefectCategory;
  trackId: string;
  dubberName: string;
  characterName: string;
  assignmentId?: string;
  lineIndex: number;
  subId?: string;
  startSec: number;
  endSec: number;
  startFormatted: string;
  endFormatted: string;
  durationSec: number;
  text: string;
  peakDb: number;
  rmsDb: number;
  dynamicRangeDb: number;
  type: DefectType;
  typeLabel: string;
  selected: boolean;
  comment: string;
  audioUrl?: string;
  audioBuffer?: AudioBuffer;

  // Reference original audio buffer (if available)
  originalAudioBuffer?: AudioBuffer | null;

  // Unwanted speech context
  nearestContext?: string;

  // Timing mismatch details
  actualSpeechStartSec?: number;
  actualSpeechEndSec?: number;
  actualDurationSec?: number;
  speechDurationSec?: number;
  subDurationSec?: number;
  timingDeltaPercent?: number; // e.g. -28% or +35%
  tailDurationSec?: number; // hanging original tail duration in seconds
  overflowDurationSec?: number; // speech overshooting subtitle end in seconds

  // Collision & Overlap fields
  isTimingTooLongMerged?: boolean;
  naturalSilenceStartSec?: number;
  naturalSilenceEndSec?: number;
  secondNaturalSilenceStartSec?: number;
  secondNaturalSilenceEndSec?: number;
  secondTrackId?: string;
  secondDubberName?: string;
  secondCharacterName?: string;
  secondAssignmentId?: string;
  secondAudioUrl?: string;
  secondAudioBuffer?: AudioBuffer;
  secondPeakDb?: number;
  secondRmsDb?: number;
  secondDynamicRangeDb?: number;
  secondText?: string;
  secondLineIndex?: number;
  secondSubId?: string;
  overlapSec?: number; // duration of collision or speech overlap in seconds

  // Technical artifact fields
  artifactType?: AudioArtifactType;
  artifactMetric?: string;
  artifactSeverity?: ArtifactSeverity;
  artifactTimestampSec?: number;
  artifactTitle?: string;
  artifactDescription?: string;
  nearestSubtitleText?: string;

  // Whisper speech-to-text discrepancy fields
  expectedText?: string;
  recognizedText?: string;
  textSimilarityPercent?: number;
  textDiscrepancyType?: TextDiscrepancyType;
  wordDiffs?: WordDiff[];
  whisperModelUsed?: string;

  // Curator resolution options
  resolutionAction?: DefectResolution;
  selectedCharacterForSub?: string;
  isSilenced?: boolean;

  // Subtitle error / Character reassignment fields
  isSubtitleError?: boolean;
  reassignedCharacterName?: string;
  reassignedDubberName?: string;
  reassignedDubberId?: string;
  reassignedAssignmentId?: string;
}

export interface GapDetectionOptions {
  scanMissingLines?: boolean;
  speechDynamicThresholdDb?: number;
  silencePeakThresholdDb?: number;
  silenceRmsThresholdDb?: number;
  minDurationSec?: number;
  scanUnwantedSpeech?: boolean;
  scanCollisions?: boolean;
  scanTimingMismatches?: boolean;
  scanOverlaps?: boolean;
  shortLineThresholdPercent?: number;
  longLineThresholdPercent?: number;
  scanArtifacts?: boolean;
  scanWhisperText?: boolean;
  whisperModel?: string;
}

export interface DecodedTrackContext {
  track: Track;
  audioUrl: string;
  audioBuffer: AudioBuffer;
  assignedCharacters: Set<string>;
  fixBuffer?: AudioBuffer | null;
  fixAudioUrl?: string | null;
}

export interface VoicedLineRecord {
  track: Track;
  audioBuffer: AudioBuffer;
  audioUrl: string;
  line: SubtitleLine;
  lineIndex: number;
  subId: string;
  rawCharName: string;
  resolvedCharName: string;
  matchingAssignmentId?: string;
  subStartSec: number;
  subEndSec: number;
  subDurationSec: number;
  speechStartSec: number;
  speechEndSec: number;
  speechDurationSec: number;
  metrics: {
    peakDb: number;
    rmsDb: number;
    minDb: number;
    maxDb: number;
    dynamicRangeDb: number;
    peakToMinDb: number;
    stdDevDb: number;
  };
  cleanedText: string;
}

/**
 * Formats seconds into MM:SS.ss string
 */
export function formatTimecode(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  return `${mins.toString().padStart(2, '0')}:${parseFloat(secs) < 10 ? '0' : ''}${secs}`;
}

/**
 * Resolves a playable/fetchable audio URL for both Electron and Web preview
 */
export function resolveAudioUrl(filePath: string): string {
  if (!filePath) return '';
  if (filePath.startsWith('http://') || filePath.startsWith('https://') || filePath.startsWith('blob:') || filePath.startsWith('data:') || filePath.startsWith('/api/')) {
    return filePath;
  }
  
  if (!window.electronAPI) {
    const cleanName = filePath.replace(/\\/g, '/').split('/').pop() || filePath;
    const cached = (window as any).getFileFromCache?.(cleanName);
    if (cached) {
      return URL.createObjectURL(cached);
    }
    const cleanPath = filePath.replace(/^file:\/\//, '');
    if (!/^[a-zA-Z]:[/\\]/.test(cleanPath)) {
      return `/api/media-file?path=${encodeURIComponent(cleanPath)}`;
    }
    return '';
  }
  
  return filePath.startsWith('file://') ? filePath : `file://${filePath}`;
}

/**
 * Decodes an audio file into an AudioBuffer using the Web Audio API
 */
export async function decodeAudioFile(url: string): Promise<AudioBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Не удалось загрузить аудио: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();

  const OfflineCtx = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!OfflineCtx && !AudioCtx) {
    throw new Error('Web Audio API не поддерживается данным браузером');
  }

  if (OfflineCtx) {
    const offlineCtx = new OfflineCtx(1, 44100, 44100);
    return await offlineCtx.decodeAudioData(arrayBuffer);
  } else {
    const tempCtx = new AudioCtx();
    try {
      return await tempCtx.decodeAudioData(arrayBuffer);
    } finally {
      if (tempCtx.state !== 'closed') {
        tempCtx.close().catch(() => {});
      }
    }
  }
}
