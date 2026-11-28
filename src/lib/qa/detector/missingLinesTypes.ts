import { Track, SubtitleLine } from '../../../types';
import { AudioArtifactType, ArtifactSeverity } from '../artifactDetector';
import { WordDiff, TextDiscrepancyType } from '../whisperTextChecker';

export interface QAScanLogEntry {
  id: string;
  timestamp: string;
  stage: 'general' | 'audio' | 'missing' | 'speech' | 'collisions' | 'timing' | 'artifacts' | 'whisper' | 'stems' | 'acting';
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
  | 'text_mismatch'
  | 'speech_disfluency'
  | 'diction_clarity'
  | 'emotion_mismatch'
  | 'stress_error'
  | 'persona_mismatch';

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
  | 'text_mismatch'
  | 'speech_disfluency'
  | 'diction_clarity'
  | 'emotion_mismatch'
  | 'stress_error'
  | 'persona_mismatch';

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
  | 'legitimate_fix'
  | 'add_to_stress_dictionary'
  | 'accept_as_acting';

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

  // Reference original audio buffer & isolated original vocal URL (if available)
  originalAudioBuffer?: AudioBuffer | null;
  originalVocalsUrl?: string;

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

  // Local Acting, Diction, Stress & Persona fields
  disfluencySubtype?: string;
  disfluencyDetails?: string;
  gopScore?: number;
  speechRateSyllablesPerSec?: number;
  originalSpeechRateSyllablesPerSec?: number;
  emotionDubberArousal?: number;
  emotionOrigArousal?: number;
  emotionDubberValence?: number;
  emotionOrigValence?: number;
  f0StdHz?: number;
  stressWord?: string;
  stressExpectedIndex?: number;
  stressActualIndex?: number;
  stressExpectedMarked?: string;
  stressActualMarked?: string;
  stressRuleSource?: 'dictionary' | 'ruaccent';
  personaExpectedAgeGroup?: string;
  personaDetectedAgeYears?: number;
  personaDetectedGender?: string;
  personaVoiceSimilarity?: number;

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

export type QAPresetId = 'soft' | 'standard' | 'strict' | 'custom';
export type OriginalStemMode = 'full_cached' | 'dialogue_windows' | 'none';
export type OriginalStemModel = 'htdemucs' | 'uvr_mdx_voc_ft';
export type ActingResourceProfile = 'fast_diction' | 'full_acting';
export type StressCheckMode = 'dictionary_and_text' | 'dictionary_only';

export interface QADetectionSettings {
  presetId: QAPresetId;

  // Missing lines & voice threshold
  scanMissingLines: boolean;
  speechDynamicThresholdDb: number;
  silencePeakThresholdDb: number;
  silenceRmsThresholdDb: number;
  minDurationSec: number;
  stationaryNoiseStdDevDb: number;
  stationaryNoisePeakDb: number;

  // Timing mismatches (вылеты и недоборы)
  scanTimingMismatches: boolean;
  shortLineThresholdPercent: number;
  shortLineMinDiffSec: number;
  shortLineMinTailSec: number;
  longLineThresholdPercent: number;
  longLineMinOverflowSec: number;

  // Unwanted speech (лишняя речь вне сабов)
  scanUnwantedSpeech: boolean;
  unwantedOwnSubPreMarginSec: number;
  unwantedOwnSubPostMarginSec: number;
  unwantedOtherSubPreMarginSec: number;
  unwantedOtherSubPostMarginSec: number;
  unwantedMinBurstSec: number;
  unwantedPeakThresholdDb: number;
  unwantedRmsThresholdDb: number;

  // Collisions & Overlaps (конфликты и наезды)
  scanCollisions: boolean;
  collisionMinCoverageRatio: number;
  collisionPeakThresholdDb: number;
  collisionParallelSubToleranceSec: number;

  scanOverlaps: boolean;
  overlapMinSec: number;
  overlapAllowedSubOverlapSec: number;
  overlapMinSubBoundaryOverrunSec: number;

  // Technical Artifacts
  scanArtifacts: boolean;
  detectClipping: boolean;
  clipMinConsecutive: number;
  clipThresholdLinear: number;
  detectClicks: boolean;
  clickRatioThreshold: number;
  clickMinDiff: number;
  detectPlosives: boolean;
  plosiveLowDbThreshold: number;
  plosiveDeltaDbThreshold: number;
  detectSwallowed: boolean;
  cutoffDropDbThreshold: number;
  cutoffMinSubDurationSec: number;

  // Whisper ASR
  scanWhisperText: boolean;
  whisperModel: string;
  whisperSimilarityThresholdPercent: number;

  // Stage 0 Original Stems & Acting QA
  originalStemMode: OriginalStemMode;
  originalStemModel: OriginalStemModel;
  actingResourceProfile: ActingResourceProfile;

  scanSpeechDisfluencies: boolean;
  disfluencyMaxPauseSec: number;
  disfluencyEventsThreshold: number;
  disfluencyCrossCheckOriginal: boolean;

  scanDictionClarity: boolean;
  dictionMinGopScore: number;
  dictionMaxRateDeltaPercent: number;

  scanEmotionMismatch: boolean;
  emotionMaxArousalDelta: number;
  emotionMaxPitchMonotonyRatio: number;

  scanStressErrors: boolean;
  stressCheckMode: StressCheckMode;
  stressContrastThresholdDb: number;

  scanPersonaMismatch: boolean;
  personaMinVoiceSimilarity: number;
  personaMaxAgeDeltaYears: number;
}

export type GapDetectionOptions = Partial<QADetectionSettings>;

export const QA_PRESET_STANDARD: QADetectionSettings = {
  presetId: 'standard',
  scanMissingLines: true,
  speechDynamicThresholdDb: 3.0,
  silencePeakThresholdDb: -52,
  silenceRmsThresholdDb: -60,
  minDurationSec: 0.15,
  stationaryNoiseStdDevDb: 1.0,
  stationaryNoisePeakDb: -24,

  scanTimingMismatches: true,
  shortLineThresholdPercent: 30,
  shortLineMinDiffSec: 0.35,
  shortLineMinTailSec: 0.28,
  longLineThresholdPercent: 40,
  longLineMinOverflowSec: 0.35,

  scanUnwantedSpeech: true,
  unwantedOwnSubPreMarginSec: 2.0,
  unwantedOwnSubPostMarginSec: 2.5,
  unwantedOtherSubPreMarginSec: 1.2,
  unwantedOtherSubPostMarginSec: 1.5,
  unwantedMinBurstSec: 0.35,
  unwantedPeakThresholdDb: -36,
  unwantedRmsThresholdDb: -46,

  scanCollisions: true,
  collisionMinCoverageRatio: 0.45,
  collisionPeakThresholdDb: -38,
  collisionParallelSubToleranceSec: 0.08,

  scanOverlaps: true,
  overlapMinSec: 0.12,
  overlapAllowedSubOverlapSec: 0.08,
  overlapMinSubBoundaryOverrunSec: 0.15,

  scanArtifacts: true,
  detectClipping: true,
  clipMinConsecutive: 2,
  clipThresholdLinear: 0.9985,
  detectClicks: true,
  clickRatioThreshold: 17.5,
  clickMinDiff: 0.07,
  detectPlosives: true,
  plosiveLowDbThreshold: -22,
  plosiveDeltaDbThreshold: -2.0,
  detectSwallowed: true,
  cutoffDropDbThreshold: 24,
  cutoffMinSubDurationSec: 1.4,

  scanWhisperText: true,
  whisperModel: 'small',
  whisperSimilarityThresholdPercent: 88,

  originalStemMode: 'full_cached',
  originalStemModel: 'htdemucs',
  actingResourceProfile: 'full_acting',

  scanSpeechDisfluencies: true,
  disfluencyMaxPauseSec: 0.45,
  disfluencyEventsThreshold: 0.45,
  disfluencyCrossCheckOriginal: true,

  scanDictionClarity: true,
  dictionMinGopScore: 0.55,
  dictionMaxRateDeltaPercent: 35,

  scanEmotionMismatch: true,
  emotionMaxArousalDelta: 0.32,
  emotionMaxPitchMonotonyRatio: 0.55,

  scanStressErrors: true,
  stressCheckMode: 'dictionary_and_text',
  stressContrastThresholdDb: 2.5,

  scanPersonaMismatch: true,
  personaMinVoiceSimilarity: 0.68,
  personaMaxAgeDeltaYears: 14,
};

export const QA_PRESET_SOFT: QADetectionSettings = {
  ...QA_PRESET_STANDARD,
  presetId: 'soft',
  shortLineThresholdPercent: 42,
  longLineThresholdPercent: 55,
  longLineMinOverflowSec: 0.5,
  overlapMinSec: 0.2,
  unwantedMinBurstSec: 0.5,
  clipMinConsecutive: 4,
  clickRatioThreshold: 22.0,
  plosiveLowDbThreshold: -17,
  whisperSimilarityThresholdPercent: 80,
  disfluencyMaxPauseSec: 0.65,
  disfluencyEventsThreshold: 0.6,
  dictionMinGopScore: 0.45,
  dictionMaxRateDeltaPercent: 45,
  emotionMaxArousalDelta: 0.42,
  emotionMaxPitchMonotonyRatio: 0.42,
  stressContrastThresholdDb: 3.8,
  personaMinVoiceSimilarity: 0.58,
  personaMaxAgeDeltaYears: 18,
};

export const QA_PRESET_STRICT: QADetectionSettings = {
  ...QA_PRESET_STANDARD,
  presetId: 'strict',
  shortLineThresholdPercent: 22,
  longLineThresholdPercent: 25,
  longLineMinOverflowSec: 0.25,
  overlapMinSec: 0.08,
  unwantedMinBurstSec: 0.25,
  clipMinConsecutive: 2,
  clickRatioThreshold: 14.5,
  plosiveLowDbThreshold: -25,
  whisperSimilarityThresholdPercent: 92,
  disfluencyMaxPauseSec: 0.35,
  disfluencyEventsThreshold: 0.35,
  dictionMinGopScore: 0.65,
  dictionMaxRateDeltaPercent: 25,
  emotionMaxArousalDelta: 0.24,
  emotionMaxPitchMonotonyRatio: 0.65,
  stressContrastThresholdDb: 1.8,
  personaMinVoiceSimilarity: 0.75,
  personaMaxAgeDeltaYears: 10,
};

export const DEFAULT_QA_DETECTION_SETTINGS: QADetectionSettings = QA_PRESET_STANDARD;

export interface StressDictionaryEntry {
  id: string;
  word: string;
  stressedForm: string;
  scope: 'project' | 'global';
  projectId: string | null;
  notes?: string;
  updatedAt?: string;
}

export type CharacterAgeGroup = 'any' | 'child' | 'teen' | 'young_adult' | 'adult' | 'mature';
export type CharacterGenderTarget = 'any' | 'male' | 'female';
export type CharacterEmotionTolerance = 'strict' | 'standard' | 'free';

export interface CharacterPersonaProfile {
  id: string;
  projectId: string | null;
  characterName: string;
  ageGroup: CharacterAgeGroup;
  expectedGender: CharacterGenderTarget;
  targetF0MinHz?: number | null;
  targetF0MaxHz?: number | null;
  emotionTolerance: CharacterEmotionTolerance;
  notes?: string;
  updatedAt?: string;
}

export interface ActingModelStatusItem {
  id: string;
  repo: string;
  title: string;
  profile: ActingResourceProfile;
  sizeMb: number;
  downloaded: boolean;
  required: boolean;
}

export interface ActingModelsStatus {
  profile: ActingResourceProfile;
  ready: boolean;
  missingCount: number;
  totalMissingMb: number;
  models: ActingModelStatusItem[];
  error?: string;
}

export interface QAActingProgress {
  stage: 'stems' | 'acting' | 'models';
  percent: number;
  message: string;
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
