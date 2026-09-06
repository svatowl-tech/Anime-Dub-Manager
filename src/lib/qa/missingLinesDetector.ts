/**
 * Automatic Gap Detection Engine for Dubber Audio vs Subtitles
 * 
 * Analyzes dubber audio tracks against assigned subtitle lines to find
 * missing voiced lines (complete silence or stationary background noise without dialogue).
 * 
 * Uses dynamic energy variation (short-time RMS delta / variance in dB) rather than
 * static global volume, correctly identifying speech even when recorded at very low gain.
 */

import { Episode, Track, SubtitleLine } from '../../types';
import { SIGN_KEYWORDS } from '../../constants';
import { getSharedAudioContext, ensureAudioContextResumed } from './sharedAudioContext';
import { scanTrackForArtifacts, AudioArtifactType, ArtifactSeverity } from './artifactDetector';
import { checkTrackTextWithWhisper, WordDiff, TextDiscrepancyType } from './whisperTextChecker';

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
  /**
   * Scan for missing voiced lines. Default: true.
   */
  scanMissingLines?: boolean;
  /**
   * Dynamic swing threshold in dB (max short-time RMS vs min short-time RMS).
   * If audio energy fluctuates by more than this threshold within the subtitle duration,
   * it contains speech modulation (vowels/consonants/intonation) and is NOT a gap.
   * Default: 3.0 dB
   */
  speechDynamicThresholdDb?: number;
  /**
   * Absolute peak threshold below which audio is considered pure digital silence (dBFS).
   * Default: -52 dBFS
   */
  silencePeakThresholdDb?: number;
  /**
   * Absolute RMS threshold below which audio is considered pure digital silence (dBFS).
   * Default: -60 dBFS
   */
  silenceRmsThresholdDb?: number;
  /**
   * Minimum duration in seconds of a subtitle to analyze.
   * Default: 0.15s
   */
  minDurationSec?: number;
  /**
   * Scan for unwanted speech outside subtitles. Default: true.
   */
  scanUnwantedSpeech?: boolean;
  /**
   * Scan for dubber collision (two dubbers voicing the same subtitle). Default: true.
   */
  scanCollisions?: boolean;
  /**
   * Scan for timing mismatches (short speech / hanging original tail > 30%, or long speech > 40%). Default: true.
   */
  scanTimingMismatches?: boolean;
  /**
   * Scan for speech overlap collisions between dubbers (phrase tails colliding). Default: true.
   */
  scanOverlaps?: boolean;
  /**
   * Threshold percentage below which short speech is flagged (default: 30%).
   */
  shortLineThresholdPercent?: number;
  /**
   * Threshold percentage above which long speech is flagged (default: 40%).
   */
  longLineThresholdPercent?: number;
  /**
   * Scan for audio artifacts (clipping, mouse clicks, plosives, swallowed words/gate cutoffs). Default: true.
   */
  scanArtifacts?: boolean;
  /**
   * Scan voiced lines for text discrepancies with Whisper ASR (model: small). Default: false.
   */
  scanWhisperText?: boolean;
  /**
   * Whisper model to use ('small' | 'base' | 'tiny'). Default: 'small'.
   */
  whisperModel?: string;
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
  if (filePath.startsWith('http://') || filePath.startsWith('https://') || filePath.startsWith('blob:')) {
    return filePath;
  }
  
  if (!window.electronAPI) {
    const cleanName = filePath.replace(/\\/g, '/').split('/').pop() || filePath;
    const cached = (window as any).getFileFromCache?.(cleanName);
    if (cached) {
      return URL.createObjectURL(cached);
    }
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

/**
 * Zeros out audio samples in an AudioBuffer in-place across all channels
 */
export function silenceAudioBufferInterval(
  audioBuffer: AudioBuffer,
  startSec: number,
  endSec: number
): void {
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const startSample = Math.max(0, Math.floor((startSec - 0.02) * sampleRate));
  const endSample = Math.min(audioBuffer.length, Math.ceil((endSec + 0.02) * sampleRate));

  for (let c = 0; c < numChannels; c++) {
    const data = audioBuffer.getChannelData(c);
    data.fill(0, startSample, endSample);
  }
}

/**
 * Computes dynamic metrics (short-time RMS frames, dynamic range, std dev, peak)
 * across a specific time slice of an AudioBuffer.
 */
export function analyzeSegmentDynamics(
  audioBuffer: AudioBuffer,
  startSec: number,
  endSec: number,
  frameSizeMs: number = 40,
  hopSizeMs: number = 20
) {
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const totalSamples = audioBuffer.length;

  // Add a small 40ms margin to capture speech attacks and tails
  const startSample = Math.max(0, Math.floor((startSec - 0.04) * sampleRate));
  const endSample = Math.min(totalSamples, Math.ceil((endSec + 0.04) * sampleRate));
  const segmentLength = endSample - startSample;

  if (segmentLength <= 0) {
    return {
      peakDb: -100,
      rmsDb: -100,
      minDb: -100,
      maxDb: -100,
      dynamicRangeDb: 0,
      peakToMinDb: 0,
      stdDevDb: 0
    };
  }

  const frameSamples = Math.max(16, Math.floor((frameSizeMs / 1000) * sampleRate));
  const hopSamples = Math.max(8, Math.floor((hopSizeMs / 1000) * sampleRate));

  let segMaxPeak = 0.00001;
  let segSumSquares = 0;

  // Compute overall segment peak & sum of squares
  for (let c = 0; c < numChannels; c++) {
    const chanData = audioBuffer.getChannelData(c);
    for (let i = startSample; i < endSample; i++) {
      const val = Math.abs(chanData[i]);
      if (val > segMaxPeak) segMaxPeak = val;
      segSumSquares += val * val;
    }
  }

  const segRms = Math.sqrt(segSumSquares / (segmentLength * numChannels));
  const segPeakDb = Math.round((20 * Math.log10(Math.max(0.00001, segMaxPeak))) * 10) / 10;
  const segRmsDb = Math.round((20 * Math.log10(Math.max(0.00001, segRms))) * 10) / 10;

  // Extract short-time RMS frames across the segment
  const frameDbValues: number[] = [];
  const primaryChannel = audioBuffer.getChannelData(0);

  for (let fStart = startSample; fStart + frameSamples <= endSample; fStart += hopSamples) {
    let frameSumSq = 0;
    for (let i = fStart; i < fStart + frameSamples; i++) {
      const v = primaryChannel[i];
      frameSumSq += v * v;
    }
    const frameRms = Math.sqrt(frameSumSq / frameSamples);
    const frameDb = 20 * Math.log10(Math.max(0.000001, frameRms));
    frameDbValues.push(frameDb);
  }

  // If segment is too short for multiple frames, treat as single frame
  if (frameDbValues.length <= 1) {
    frameDbValues.push(segRmsDb);
  }

  // Sort frame dB values to find reliable baseline noise floor vs peak speech
  const sorted = [...frameDbValues].sort((a, b) => a - b);
  
  // 10th percentile (noise floor / micro-pause level)
  const p10Index = Math.floor(sorted.length * 0.1);
  const minDb = sorted[p10Index] ?? sorted[0];

  // 90th percentile (sustained speech peaks)
  const p90Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9));
  const maxDb = sorted[p90Index] ?? sorted[sorted.length - 1];

  // Dynamic range within the subtitle line (in decibels)
  const dynamicRangeDb = Math.round(Math.max(0, maxDb - minDb) * 10) / 10;
  const peakToMinDb = Math.round(Math.max(0, segPeakDb - minDb) * 10) / 10;

  // Standard deviation of energy
  let sumDb = 0;
  for (const v of frameDbValues) sumDb += v;
  const meanDb = sumDb / frameDbValues.length;

  let sumSqDiff = 0;
  for (const v of frameDbValues) {
    const diff = v - meanDb;
    sumSqDiff += diff * diff;
  }
  const stdDevDb = Math.round(Math.sqrt(sumSqDiff / frameDbValues.length) * 10) / 10;

  return {
    peakDb: segPeakDb,
    rmsDb: segRmsDb,
    minDb: Math.round(minDb * 10) / 10,
    maxDb: Math.round(maxDb * 10) / 10,
    dynamicRangeDb,
    peakToMinDb,
    stdDevDb
  };
}

/**
 * Accurately finds speech start and end boundaries (Voice Activity Detection)
 * in an AudioBuffer around a given subtitle timeframe.
 */
export function findVoicedBoundaries(
  audioBuffer: AudioBuffer,
  searchStartSec: number,
  searchEndSec: number,
  speechDynamicThresholdDb: number = 2.8,
  minSpeechPeakDb: number = -38
): {
  speechStartSec: number;
  speechEndSec: number;
  speechDurationSec: number;
  isVoiced: boolean;
  peakDb: number;
  rmsDb: number;
} {
  const sampleRate = audioBuffer.sampleRate;
  const startSample = Math.max(0, Math.floor(searchStartSec * sampleRate));
  const endSample = Math.min(audioBuffer.length, Math.ceil(searchEndSec * sampleRate));
  
  if (endSample <= startSample) {
    return {
      speechStartSec: searchStartSec,
      speechEndSec: searchEndSec,
      speechDurationSec: 0,
      isVoiced: false,
      peakDb: -100,
      rmsDb: -100
    };
  }

  const frameMs = 30;
  const hopMs = 15;
  const frameSamples = Math.max(16, Math.floor((frameMs / 1000) * sampleRate));
  const hopSamples = Math.max(8, Math.floor((hopMs / 1000) * sampleRate));

  const primaryChannel = audioBuffer.getChannelData(0);
  const frames: { time: number; rmsDb: number; peakDb: number }[] = [];

  let overallPeak = 0.00001;
  let overallSumSq = 0;
  let totalSamples = 0;

  for (let s = startSample; s + frameSamples <= endSample; s += hopSamples) {
    let fSumSq = 0;
    let fPeak = 0;
    for (let i = s; i < s + frameSamples; i++) {
      const v = Math.abs(primaryChannel[i]);
      if (v > fPeak) fPeak = v;
      fSumSq += v * v;
    }
    const fRms = Math.sqrt(fSumSq / frameSamples);
    const timeSec = s / sampleRate;
    const fRmsDb = 20 * Math.log10(Math.max(0.000001, fRms));
    const fPeakDb = 20 * Math.log10(Math.max(0.000001, fPeak));
    frames.push({ time: timeSec, rmsDb: fRmsDb, peakDb: fPeakDb });

    if (fPeak > overallPeak) overallPeak = fPeak;
    overallSumSq += fSumSq;
    totalSamples += frameSamples;
  }

  const overallPeakDb = Math.round((20 * Math.log10(overallPeak)) * 10) / 10;
  const overallRmsDb = Math.round((20 * Math.log10(Math.sqrt(overallSumSq / Math.max(1, totalSamples)))) * 10) / 10;

  if (frames.length < 2) {
    return {
      speechStartSec: searchStartSec,
      speechEndSec: searchEndSec,
      speechDurationSec: searchEndSec - searchStartSec,
      isVoiced: false,
      peakDb: overallPeakDb,
      rmsDb: overallRmsDb
    };
  }

  // Find baseline noise floor (15th percentile of RMS)
  const sortedRms = [...frames].map(f => f.rmsDb).sort((a, b) => a - b);
  const noiseFloorDb = sortedRms[Math.floor(sortedRms.length * 0.15)] ?? -60;
  const activeThresholdDb = Math.max(noiseFloorDb + speechDynamicThresholdDb, -46);

  // Filter frames containing active voice speech
  const voicedFrames = frames.filter(f => f.rmsDb >= activeThresholdDb && f.peakDb >= minSpeechPeakDb);

  if (voicedFrames.length < 2) {
    return {
      speechStartSec: searchStartSec,
      speechEndSec: searchEndSec,
      speechDurationSec: 0,
      isVoiced: false,
      peakDb: overallPeakDb,
      rmsDb: overallRmsDb
    };
  }

  const speechStart = voicedFrames[0].time;
  const speechEnd = voicedFrames[voicedFrames.length - 1].time + (frameMs / 1000);
  const speechDuration = Math.max(0.05, speechEnd - speechStart);

  return {
    speechStartSec: Math.round(speechStart * 100) / 100,
    speechEndSec: Math.round(speechEnd * 100) / 100,
    speechDurationSec: Math.round(speechDuration * 100) / 100,
    isVoiced: true,
    peakDb: overallPeakDb,
    rmsDb: overallRmsDb
  };
}

interface DecodedTrackContext {
  track: Track;
  audioUrl: string;
  audioBuffer: AudioBuffer;
  assignedCharacters: Set<string>;
}

/**
 * Main detection function to analyze dubber tracks against subtitles in an episode.
 * Detects:
 * 1. Missing Lines (пропуски реплик)
 * 2. Unwanted Speech (озвучено там, где не надо - фразы вне сабов)
 * 3. Collisions (конфликты: два даббера озвучили одну и ту же реплику)
 */
export async function detectEpisodeGaps(
  episode: Episode,
  tracks: Track[],
  subLines: SubtitleLine[],
  options: GapDetectionOptions = {},
  onProgress?: (current: number, total: number, message: string) => void
): Promise<MissingLineDetection[]> {
  const {
    speechDynamicThresholdDb = 3.0,
    silencePeakThresholdDb = -52,
    silenceRmsThresholdDb = -60,
    minDurationSec = 0.15,
    scanMissingLines = true,
    scanUnwantedSpeech = true,
    scanCollisions = true,
    scanTimingMismatches = true,
    scanOverlaps = true,
    shortLineThresholdPercent = 30,
    longLineThresholdPercent = 40,
    scanWhisperText = false,
    whisperModel = 'small'
  } = options;

  const results: MissingLineDetection[] = [];
  // Map to hold timing_too_long defects for potential merging with subsequent actor_overlap
  const longTimingDetections = new Map<string, MissingLineDetection>();

  // Filter valid dubber tracks with uploaded files
  const dubberTracks = tracks.filter(t => t.id !== 'original' && t.files.length > 0);
  if (dubberTracks.length === 0 || subLines.length === 0) {
    return results;
  }

  // Parse project character aliases
  let aliases: Record<string, string> = {};
  if (episode.project?.characterAliases) {
    try {
      aliases = JSON.parse(episode.project.characterAliases);
    } catch (e) {
      console.warn('Failed to parse characterAliases:', e);
    }
  }

  // Clean subtitle lines (ignore signs/karaoke/openings)
  const validSubLines = subLines.filter(l => {
    const name = (l.name || '').toLowerCase();
    const style = (l.style || '').toLowerCase();
    const isSign = SIGN_KEYWORDS.some(k => name.includes(k.toLowerCase()) || style.includes(k.toLowerCase()));
    const duration = (l.endSec || 0) - (l.startSec || 0);
    return !isSign && duration >= minDurationSec && (l.text || '').trim().length > 0;
  });

  // Decode original track / video audio for reference if available
  let originalAudioBuffer: AudioBuffer | null = null;
  const originalTrack = tracks.find(t => t.id === 'original');
  const rawFile = originalTrack?.files[0]?.path || episode.rawPath;
  if (rawFile) {
    try {
      const origUrl = resolveAudioUrl(rawFile);
      if (origUrl) {
        originalAudioBuffer = await decodeAudioFile(origUrl);
      }
    } catch (e) {
      console.warn('Original audio decode for reference skipped:', e);
    }
  }

  const totalTracks = dubberTracks.length;
  const decodedTracks: DecodedTrackContext[] = [];

  // Pre-decode all dubber audio tracks
  for (let i = 0; i < totalTracks; i++) {
    const track = dubberTracks[i];
    onProgress?.(
      i + 1,
      totalTracks,
      `Загрузка и декодирование дорожки [${i + 1}/${totalTracks}]: ${track.participant}...`
    );

    const selectedFile = track.files.find(f => f.id === track.selectedFileId) || track.files[0];
    if (!selectedFile || !selectedFile.path) continue;

    const audioUrl = resolveAudioUrl(selectedFile.path);
    if (!audioUrl) continue;

    try {
      const audioBuffer = await decodeAudioFile(audioUrl);
      if (audioBuffer && audioBuffer.length > 0) {
        const assignedCharacters = new Set<string>();
        (episode.assignments || []).forEach(as => {
          const assignedId = as.substituteId || as.dubberId;
          if (assignedId === track.id && as.characterName) {
            assignedCharacters.add(as.characterName.trim().toLowerCase());
          }
        });

        track.character.split(',').forEach(c => {
          if (c.trim()) assignedCharacters.add(c.trim().toLowerCase());
        });

        decodedTracks.push({
          track,
          audioUrl,
          audioBuffer,
          assignedCharacters
        });
      }
    } catch (err) {
      console.warn(`Не удалось декодировать аудио для даббера ${track.participant}:`, err);
    }
  }

  if (decodedTracks.length === 0) {
    return results;
  }

  // Keep track of active voiced speech lines across all dubbers for timing & overlap checks
  interface VoicedLineRecord {
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
    metrics: ReturnType<typeof analyzeSegmentDynamics>;
    cleanedText: string;
  }

  const voicedLines: VoicedLineRecord[] = [];

  // =========================================================================
  // 1. SCAN FOR MISSING LINES (ПРОПУСКИ) & TIMING MISMATCHES (РАСХОЖДЕНИЯ)
  // =========================================================================
  onProgress?.(totalTracks, totalTracks, 'Анализ пропусков и тайминга реплик...');

  for (const trackCtx of decodedTracks) {
    const { track, audioBuffer, audioUrl, assignedCharacters } = trackCtx;

    for (let lineIdx = 0; lineIdx < validSubLines.length; lineIdx++) {
      const line = validSubLines[lineIdx];
      const rawCharName = (line.name || '').trim();
      const resolvedCharName = (aliases[rawCharName] || rawCharName).trim();

      const isMatch = assignedCharacters.has(rawCharName.toLowerCase()) || 
                      assignedCharacters.has(resolvedCharName.toLowerCase());

      if (!isMatch) continue;

      const startSec = Math.max(0, line.startSec);
      const endSec = Math.min(audioBuffer.duration, line.endSec);
      const durationSec = endSec - startSec;
      if (durationSec < minDurationSec) continue;

      // Analyze dynamic range inside this subtitle line
      const metrics = analyzeSegmentDynamics(audioBuffer, startSec, endSec);

      const isAbsoluteSilence = metrics.peakDb <= silencePeakThresholdDb || metrics.rmsDb <= silenceRmsThresholdDb;
      const isStationaryNoise = 
        metrics.dynamicRangeDb < speechDynamicThresholdDb &&
        metrics.peakToMinDb < (speechDynamicThresholdDb + 1.2) &&
        metrics.stdDevDb < 1.0 &&
        metrics.peakDb < -24;

      const cleanedText = line.text
        .replace(/\{[^}]+\}/g, '')
        .replace(/\\N/gi, ' ')
        .replace(/\\n/gi, ' ')
        .replace(/\\h/gi, ' ')
        .trim();

      const matchingAssignment = (episode.assignments || []).find(a => {
        const assignedId = a.substituteId || a.dubberId;
        const char = (a.characterName || '').toLowerCase();
        return assignedId === track.id && (char === rawCharName.toLowerCase() || char === resolvedCharName.toLowerCase());
      });

      if (isAbsoluteSilence || isStationaryNoise) {
        if (!scanMissingLines) continue;
        const gapType: 'silence' | 'noise' = isAbsoluteSilence ? 'silence' : 'noise';
        const typeLabel = isAbsoluteSilence 
          ? '🔇 Тишина' 
          : `〰 Статичный фон (разбег ${metrics.dynamicRangeDb} дБ)`;

        const detectionId = `gap_${track.id}_${line.rawLineIndex ?? lineIdx}_${startSec.toFixed(2)}`;

        results.push({
          id: detectionId,
          defectCategory: 'missing_line',
          trackId: track.id,
          dubberName: track.participant,
          characterName: resolvedCharName || track.character,
          assignmentId: matchingAssignment?.id,
          lineIndex: line.rawLineIndex ?? lineIdx,
          subId: line.id ? String(line.id) : String(line.rawLineIndex ?? lineIdx),
          startSec,
          endSec,
          startFormatted: formatTimecode(startSec),
          endFormatted: formatTimecode(endSec),
          durationSec: Math.round(durationSec * 10) / 10,
          text: cleanedText,
          peakDb: metrics.peakDb,
          rmsDb: metrics.rmsDb,
          dynamicRangeDb: metrics.dynamicRangeDb,
          type: gapType,
          typeLabel,
          selected: true,
          comment: `Пропуск реплики [${formatTimecode(startSec)}]: "${cleanedText}"`,
          audioUrl,
          audioBuffer,
          originalAudioBuffer,
          resolutionAction: 'keep'
        });
      } else {
        // Line is voiced. Run Voice Activity Detection around this subtitle
        const searchStart = Math.max(0, startSec - 0.4);
        const searchEnd = Math.min(audioBuffer.duration, endSec + 1.5);
        const boundaries = findVoicedBoundaries(audioBuffer, searchStart, searchEnd, speechDynamicThresholdDb - 0.2);

        if (boundaries.isVoiced) {
          const voicedRecord: VoicedLineRecord = {
            track,
            audioBuffer,
            audioUrl,
            line,
            lineIndex: line.rawLineIndex ?? lineIdx,
            subId: line.id ? String(line.id) : String(line.rawLineIndex ?? lineIdx),
            rawCharName,
            resolvedCharName: resolvedCharName || track.character,
            matchingAssignmentId: matchingAssignment?.id,
            subStartSec: startSec,
            subEndSec: endSec,
            subDurationSec: durationSec,
            speechStartSec: boundaries.speechStartSec,
            speechEndSec: boundaries.speechEndSec,
            speechDurationSec: boundaries.speechDurationSec,
            metrics,
            cleanedText
          };
          voicedLines.push(voicedRecord);

          // Check timing mismatches if enabled
          if (scanTimingMismatches) {
            const speechDur = boundaries.speechDurationSec;
            const subDur = durationSec;

            // 1. Line is significantly shorter than subtitle (> 30%)
            // Leads to the original Japanese dialogue sticking out ("японский хвост остаётся")
            const shortRatio = (subDur - speechDur) / subDur;
            const shortThreshold = (shortLineThresholdPercent || 30) / 100;
            const tailSec = Math.max(0, endSec - boundaries.speechEndSec);

            if (shortRatio > shortThreshold && (subDur - speechDur) >= 0.35 && (tailSec >= 0.28 || shortRatio >= 0.30)) {
              const timingDeltaPercent = -Math.round(shortRatio * 100);
              const tailDurationSec = Math.round(tailSec * 10) / 10;

              results.push({
                id: `timing_short_${track.id}_${line.rawLineIndex ?? lineIdx}_${startSec.toFixed(2)}`,
                defectCategory: 'timing_too_short',
                trackId: track.id,
                dubberName: track.participant,
                characterName: resolvedCharName || track.character,
                assignmentId: matchingAssignment?.id,
                lineIndex: line.rawLineIndex ?? lineIdx,
                subId: line.id ? String(line.id) : String(line.rawLineIndex ?? lineIdx),
                startSec,
                endSec,
                startFormatted: formatTimecode(startSec),
                endFormatted: formatTimecode(endSec),
                durationSec: Math.round(durationSec * 10) / 10,
                text: cleanedText,
                peakDb: boundaries.peakDb,
                rmsDb: boundaries.rmsDb,
                dynamicRangeDb: metrics.dynamicRangeDb,
                type: 'timing_too_short',
                typeLabel: `⏱ Фраза короче саба на ${Math.abs(timingDeltaPercent)}% (>30%)`,
                selected: true,
                actualSpeechStartSec: boundaries.speechStartSec,
                actualSpeechEndSec: boundaries.speechEndSec,
                actualDurationSec: boundaries.speechDurationSec,
                speechDurationSec: boundaries.speechDurationSec,
                subDurationSec: Math.round(durationSec * 10) / 10,
                timingDeltaPercent,
                tailDurationSec,
                comment: `Фраза короче саба на ${Math.abs(timingDeltaPercent)}% (речь ${boundaries.speechDurationSec}с при сабе ${durationSec.toFixed(1)}с). Японский хвост оригинала: ~${tailDurationSec}с`,
                audioUrl,
                audioBuffer,
                originalAudioBuffer,
                resolutionAction: 'note_sound_engineer'
              });
            }

            // 2. Line is significantly longer than subtitle (> 40%)
            // Must be compressed or trimmed so it does not collide with neighboring lines
            const longRatio = (speechDur - subDur) / subDur;
            const longThreshold = (longLineThresholdPercent || 40) / 100;
            const overflowSec = Math.max(0, boundaries.speechEndSec - endSec);

            if (longRatio > longThreshold && (speechDur - subDur) >= 0.35) {
              const timingDeltaPercent = Math.round(longRatio * 100);
              const overflowDurationSec = Math.round(overflowSec * 10) / 10;
              const expandedEnd = Math.max(endSec, boundaries.speechEndSec);

              const lineKey = `${track.id}_${line.rawLineIndex ?? lineIdx}`;
              longTimingDetections.set(lineKey, {
                id: `timing_long_${track.id}_${line.rawLineIndex ?? lineIdx}_${startSec.toFixed(2)}`,
                defectCategory: 'timing_too_long',
                trackId: track.id,
                dubberName: track.participant,
                characterName: resolvedCharName || track.character,
                assignmentId: matchingAssignment?.id,
                lineIndex: line.rawLineIndex ?? lineIdx,
                subId: line.id ? String(line.id) : String(line.rawLineIndex ?? lineIdx),
                startSec,
                endSec: expandedEnd,
                startFormatted: formatTimecode(startSec),
                endFormatted: formatTimecode(expandedEnd),
                durationSec: Math.round(boundaries.speechDurationSec * 10) / 10,
                text: cleanedText,
                peakDb: boundaries.peakDb,
                rmsDb: boundaries.rmsDb,
                dynamicRangeDb: metrics.dynamicRangeDb,
                type: 'timing_too_long',
                typeLabel: `⏱ Фраза длиннее саба на +${timingDeltaPercent}% (>40%)`,
                selected: true,
                actualSpeechStartSec: boundaries.speechStartSec,
                actualSpeechEndSec: boundaries.speechEndSec,
                actualDurationSec: boundaries.speechDurationSec,
                speechDurationSec: boundaries.speechDurationSec,
                subDurationSec: Math.round(durationSec * 10) / 10,
                timingDeltaPercent,
                overflowDurationSec,
                comment: `Фраза длиннее саба на +${timingDeltaPercent}% (речь ${boundaries.speechDurationSec}с при сабе ${durationSec.toFixed(1)}с, вылет на +${overflowDurationSec}с). Рекомендуется поджать тайминг звукорежиссеру`,
                audioUrl,
                audioBuffer,
                originalAudioBuffer,
                resolutionAction: 'note_sound_engineer'
              });
            }
          }
        }
      }
    }
  }

  // =========================================================================
  // 2. SCAN FOR UNWANTED SPEECH (ОЗВУЧЕНО ТАМ, ГДЕ НЕ НАДО / ВНЕ САБОВ)
  // =========================================================================
  if (scanUnwantedSpeech) {
    onProgress?.(totalTracks, totalTracks, 'Поиск лишней озвучки вне сабов...');

    for (const trackCtx of decodedTracks) {
      const { track, audioBuffer, audioUrl, assignedCharacters } = trackCtx;
      const duration = audioBuffer.duration;
      if (duration <= 1.0) continue;

      // Collect all subtitle intervals with generous grace margins.
      // For this character's lines: allow 2.0s before and 2.5s after for natural tails/breaths.
      // For any other dialogue: allow 1.2s before and 1.5s after.
      const protectedIntervals: { start: number; end: number }[] = [];

      for (const line of validSubLines) {
        const rawCharName = (line.name || '').trim();
        const resolvedCharName = (aliases[rawCharName] || rawCharName).trim();
        const isThisChar = assignedCharacters.has(rawCharName.toLowerCase()) || 
                           assignedCharacters.has(resolvedCharName.toLowerCase());

        const marginPre = isThisChar ? 2.0 : 1.2;
        const marginPost = isThisChar ? 2.5 : 1.5;

        protectedIntervals.push({
          start: Math.max(0, line.startSec - marginPre),
          end: Math.min(duration, line.endSec + marginPost)
        });
      }

      // Merge overlapping protected intervals
      protectedIntervals.sort((a, b) => a.start - b.start);
      const mergedProtected: { start: number; end: number }[] = [];
      for (const cur of protectedIntervals) {
        if (mergedProtected.length === 0) {
          mergedProtected.push({ ...cur });
        } else {
          const last = mergedProtected[mergedProtected.length - 1];
          if (cur.start <= last.end) {
            last.end = Math.max(last.end, cur.end);
          } else {
            mergedProtected.push({ ...cur });
          }
        }
      }

      // Derive non-protected gaps (empty spaces far outside subtitles)
      const candidateGaps: { start: number; end: number }[] = [];
      let cursor = 0;
      for (const p of mergedProtected) {
        if (p.start - cursor >= 1.2) {
          candidateGaps.push({ start: cursor, end: p.start });
        }
        cursor = Math.max(cursor, p.end);
      }
      if (duration - cursor >= 1.2) {
        candidateGaps.push({ start: cursor, end: duration });
      }

      // Scan candidate gaps for isolated active speech bursts
      for (const gap of candidateGaps) {
        const gapDuration = gap.end - gap.start;
        if (gapDuration < 1.0) continue;

        // Sliding window across gap
        const windowSizeSec = 0.3;
        const hopSec = 0.15;
        let speechActive = false;
        let speechStart = 0;
        let speechEnd = 0;

        for (let t = gap.start; t + windowSizeSec <= gap.end; t += hopSec) {
          const wMetrics = analyzeSegmentDynamics(audioBuffer, t, t + windowSizeSec);
          // Active speech detection in empty space:
          // Noticeable dynamic modulation and peak above ambient room tone
          const isVoiced = wMetrics.peakDb > -36 && wMetrics.rmsDb > -46 && wMetrics.dynamicRangeDb >= (speechDynamicThresholdDb - 0.4);

          if (isVoiced) {
            if (!speechActive) {
              speechActive = true;
              speechStart = t;
              speechEnd = t + windowSizeSec;
            } else {
              speechEnd = t + windowSizeSec;
            }
          } else {
            if (speechActive) {
              // Burst ended
              const burstDuration = speechEnd - speechStart;
              if (burstDuration >= 0.35) {
                // Confirm full burst dynamics
                const burstMetrics = analyzeSegmentDynamics(audioBuffer, speechStart, speechEnd);
                if (burstMetrics.dynamicRangeDb >= speechDynamicThresholdDb && burstMetrics.peakDb > -36) {
                  // Find context: nearest previous and next subtitle
                  let prevSub: SubtitleLine | undefined;
                  let nextSub: SubtitleLine | undefined;

                  for (const l of validSubLines) {
                    if (l.endSec <= speechStart) {
                      if (!prevSub || l.endSec > prevSub.endSec) prevSub = l;
                    }
                    if (l.startSec >= speechEnd) {
                      if (!nextSub || l.startSec < nextSub.startSec) nextSub = l;
                    }
                  }

                  let contextStr = '';
                  if (prevSub && nextSub) {
                    contextStr = `Между сабами #${(prevSub.rawLineIndex ?? 0) + 1} (${formatTimecode(prevSub.endSec)}) и #${(nextSub.rawLineIndex ?? 0) + 1} (${formatTimecode(nextSub.startSec)})`;
                  } else if (prevSub) {
                    contextStr = `После саба #${(prevSub.rawLineIndex ?? 0) + 1} (${formatTimecode(prevSub.endSec)})`;
                  } else if (nextSub) {
                    contextStr = `Перед сабом #${(nextSub.rawLineIndex ?? 0) + 1} (${formatTimecode(nextSub.startSec)})`;
                  } else {
                    contextStr = `Вне таймингов субтитров`;
                  }

                  const startClean = Math.max(0, speechStart - 0.1);
                  const endClean = Math.min(duration, speechEnd + 0.15);
                  const durClean = Math.round((endClean - startClean) * 10) / 10;

                  results.push({
                    id: `unwanted_${track.id}_${startClean.toFixed(2)}`,
                    defectCategory: 'unwanted_speech',
                    trackId: track.id,
                    dubberName: track.participant,
                    characterName: track.character,
                    lineIndex: prevSub ? (prevSub.rawLineIndex ?? 0) : 0,
                    subId: prevSub?.id ? String(prevSub.id) : undefined,
                    startSec: startClean,
                    endSec: endClean,
                    startFormatted: formatTimecode(startClean),
                    endFormatted: formatTimecode(endClean),
                    durationSec: durClean,
                    text: `Лишняя речь вне сабов (${durClean}с)`,
                    peakDb: burstMetrics.peakDb,
                    rmsDb: burstMetrics.rmsDb,
                    dynamicRangeDb: burstMetrics.dynamicRangeDb,
                    type: 'unwanted_speech',
                    typeLabel: '🎙 Озвучено вне сабов',
                    selected: true,
                    resolutionAction: 'silence', // default to silence, curator can toggle to 'keep'
                    nearestContext: contextStr,
                    comment: `Озвучено вне сабов [${formatTimecode(startClean)} - ${formatTimecode(endClean)}]: заменить тишиной`,
                    audioUrl,
                    audioBuffer,
                    originalAudioBuffer
                  });
                }
              }
              speechActive = false;
            }
          }
        }
      }
    }
  }

  // =========================================================================
  // 3. SCAN FOR DUBBER COLLISIONS (КОНФЛИКТЫ: ДВА ДАББЕРА ОЗВУЧИЛИ ОДИН САБ)
  // =========================================================================
  if (scanCollisions && decodedTracks.length >= 2) {
    onProgress?.(totalTracks, totalTracks, 'Поиск конфликтов дубляжа...');

    for (let lineIdx = 0; lineIdx < validSubLines.length; lineIdx++) {
      const line = validSubLines[lineIdx];
      const lineStart = Math.max(0, line.startSec);
      const lineEnd = line.endSec;
      const lineDuration = lineEnd - lineStart;
      if (lineDuration < minDurationSec) continue;

      const rawCharName = (line.name || '').trim();
      const resolvedCharName = (aliases[rawCharName] || rawCharName).trim();

      const collidingActors: {
        track: Track;
        audioBuffer: AudioBuffer;
        audioUrl: string;
        metrics: ReturnType<typeof analyzeSegmentDynamics>;
        isAssigned: boolean;
      }[] = [];

      for (const trackCtx of decodedTracks) {
        const { track, audioBuffer, audioUrl, assignedCharacters } = trackCtx;
        if (lineEnd > audioBuffer.duration + 0.5) continue;

        // Use findVoicedBoundaries to inspect speech structure inside this subtitle interval
        const boundaries = findVoicedBoundaries(
          audioBuffer,
          Math.max(0, lineStart - 0.2),
          Math.min(audioBuffer.duration, lineEnd + 0.25),
          speechDynamicThresholdDb - 0.2
        );

        if (!boundaries.isVoiced) continue;

        // Calculate overlap of voiced speech with the subtitle duration
        const voicedStartInSub = Math.max(lineStart, boundaries.speechStartSec);
        const voicedEndInSub = Math.min(lineEnd, boundaries.speechEndSec);
        const voicedDurationInSub = Math.max(0, voicedEndInSub - voicedStartInSub);
        const subCoverageRatio = voicedDurationInSub / Math.max(0.1, lineDuration);

        // A conflict specifically requires that BOTH dubbers recorded speech across the body of this subtitle,
        // rather than just having a bleeding tail in the first few fractions of a second or an early intake at the end.
        const isTrueVoiceAcrossSub = 
          subCoverageRatio >= 0.45 &&
          voicedDurationInSub >= Math.min(0.45, lineDuration * 0.45) &&
          boundaries.speechStartSec <= lineStart + Math.max(0.6, lineDuration * 0.45) &&
          boundaries.speechEndSec >= lineEnd - Math.max(0.6, lineDuration * 0.45) &&
          boundaries.peakDb > -38;

        if (isTrueVoiceAcrossSub) {
          const isAssigned = 
            assignedCharacters.has(rawCharName.toLowerCase()) || 
            assignedCharacters.has(resolvedCharName.toLowerCase());

          const metrics = analyzeSegmentDynamics(
            audioBuffer,
            lineStart,
            Math.min(audioBuffer.duration, lineEnd)
          );

          collidingActors.push({
            track,
            audioBuffer,
            audioUrl,
            metrics,
            isAssigned
          });
        }
      }

      // If 2 or more distinct dubbers have active voice on this exact subtitle line
      if (collidingActors.length >= 2) {
        // Place the officially assigned dubber first (or the louder one if neither/both)
        collidingActors.sort((a, b) => (b.isAssigned ? 1 : 0) - (a.isAssigned ? 1 : 0));

        const actorA = collidingActors[0];
        const actorB = collidingActors[1];

        const cleanedText = line.text
          .replace(/\{[^}]+\}/g, '')
          .replace(/\\N/gi, ' ')
          .replace(/\\n/gi, ' ')
          .replace(/\\h/gi, ' ')
          .trim();

        results.push({
          id: `collision_${line.rawLineIndex ?? lineIdx}_${lineStart.toFixed(2)}`,
          defectCategory: 'actor_collision',
          trackId: actorA.track.id,
          dubberName: actorA.track.participant,
          characterName: actorA.track.character,
          lineIndex: line.rawLineIndex ?? lineIdx,
          subId: line.id ? String(line.id) : String(line.rawLineIndex ?? lineIdx),
          startSec: lineStart,
          endSec: lineEnd,
          startFormatted: formatTimecode(lineStart),
          endFormatted: formatTimecode(lineEnd),
          durationSec: Math.round(lineDuration * 10) / 10,
          text: cleanedText,
          peakDb: actorA.metrics.peakDb,
          rmsDb: actorA.metrics.rmsDb,
          dynamicRangeDb: actorA.metrics.dynamicRangeDb,
          type: 'actor_collision',
          typeLabel: '⚡ Конфликт: озвучили вдвоём',
          selected: true,
          resolutionAction: 'fix_subs', // Default resolution: analyze who it belongs to, fix subs or mute
          selectedCharacterForSub: actorA.track.character,
          audioUrl: actorA.audioUrl,
          audioBuffer: actorA.audioBuffer,
          originalAudioBuffer,
          // Second actor in collision
          secondTrackId: actorB.track.id,
          secondDubberName: actorB.track.participant,
          secondCharacterName: actorB.track.character,
          secondAudioUrl: actorB.audioUrl,
          secondAudioBuffer: actorB.audioBuffer,
          secondPeakDb: actorB.metrics.peakDb,
          secondRmsDb: actorB.metrics.rmsDb,
          secondDynamicRangeDb: actorB.metrics.dynamicRangeDb,
          comment: `Конфликт озвучки: реплику "${cleanedText}" озвучили ${actorA.track.participant} и ${actorB.track.participant}`
        });
      }
    }
  }

  // =========================================================================
  // 4. SCAN FOR ACTOR OVERLAPS (НАЕЗД ХВОСТОВ ФРАЗ ДУБЛЕРОВ ДРУГ НА ДРУГА)
  // =========================================================================
  if (scanOverlaps && voicedLines.length >= 2) {
    onProgress?.(totalTracks, totalTracks, 'Поиск наездов хвостов фраз дублеров друг на друга...');

    // Sort chronologically by speechStartSec
    const sortedVoiced = [...voicedLines].sort((a, b) => a.speechStartSec - b.speechStartSec);

    for (let i = 0; i < sortedVoiced.length; i++) {
      const itemA = sortedVoiced[i];

      for (let j = i + 1; j < sortedVoiced.length; j++) {
        const itemB = sortedVoiced[j];

        // If speech B starts comfortably after speech A ended, no further overlaps for itemA
        if (itemB.speechStartSec >= itemA.speechEndSec) {
          break;
        }

        // Ignore same track or same subtitle (handled by collisions)
        if (itemA.track.id === itemB.track.id || itemA.subId === itemB.subId) {
          continue;
        }

        // Check if subtitles themselves overlap in time ("наезд сабов").
        // If subtitles are concurrent/overlapping in the script, speech overlap is completely legitimate!
        const subOverlapStart = Math.max(itemA.subStartSec, itemB.subStartSec);
        const subOverlapEnd = Math.min(itemA.subEndSec, itemB.subEndSec);
        const subOverlapDuration = subOverlapEnd - subOverlapStart;
        if (subOverlapDuration > 0.08) {
          continue;
        }

        // Overlap timeframe
        const overlapStart = Math.max(itemA.speechStartSec, itemB.speechStartSec);
        const overlapEnd = Math.min(itemA.speechEndSec, itemB.speechEndSec);
        const speechOverlapDuration = overlapEnd - overlapStart;

        // Also check if itemA speechEnd overruns past itemA.subEndSec and into itemB.subStartSec
        const subBoundaryOverrun = itemA.speechEndSec - itemB.subStartSec;
        const overlapDuration = Math.max(
          speechOverlapDuration,
          (speechOverlapDuration > 0 || subBoundaryOverrun >= 0.15) ? subBoundaryOverrun : 0
        );

        // Threshold: at least 0.12s overlap
        if (overlapDuration >= 0.12) {
          const overlapSecRounded = Math.round(overlapDuration * 100) / 100;
          const collisionStart = Math.max(0, overlapStart - 0.25);
          const collisionEnd = overlapEnd + 0.25;

          // Check if this phrase (itemA) also figures in timing_too_long (> 40%).
          // If so, merge into ONE unified fix instead of two separate defects.
          const longKeyA = `${itemA.track.id}_${itemA.lineIndex}`;
          const longCandidateA = longTimingDetections.get(longKeyA);

          const isMerged = !!longCandidateA;
          if (longCandidateA) {
            longCandidateA.isTimingTooLongMerged = true;
          }

          const timingDeltaPercent = longCandidateA?.timingDeltaPercent;
          const overflowDurationSec = longCandidateA?.overflowDurationSec;

          const typeLabel = isMerged
            ? `⚡ Наезд хвостом + вылет тайминга (+${timingDeltaPercent}%)`
            : `⚡ Наезд хвостом (${overlapSecRounded}с)`;

          const comment = isMerged
            ? `Фраза ${itemA.track.participant} (${itemA.resolvedCharName}) длиннее саба на +${timingDeltaPercent}% (вылет +${overflowDurationSec}с) и залезла на ${overlapSecRounded}с на начало реплики ${itemB.track.participant} (${itemB.resolvedCharName}). Объединено в один фикс: требуется поджать фразу и развести стык звукорежиссеру.`
            : `Наезд дублеров: хвост реплики ${itemA.track.participant} (${itemA.resolvedCharName}) залез на ${overlapSecRounded}с на начало реплики ${itemB.track.participant} (${itemB.resolvedCharName}). Требуется разводка или подрезка стыка звукорежиссером.`;

          results.push({
            id: `overlap_${itemA.track.id}_${itemB.track.id}_${itemA.lineIndex}_${itemB.lineIndex}_${overlapStart.toFixed(2)}`,
            defectCategory: 'actor_overlap',
            isTimingTooLongMerged: isMerged,
            trackId: itemA.track.id,
            dubberName: itemA.track.participant,
            characterName: itemA.resolvedCharName,
            assignmentId: itemA.matchingAssignmentId,
            lineIndex: itemA.lineIndex,
            subId: itemA.subId,
            startSec: collisionStart,
            endSec: collisionEnd,
            startFormatted: formatTimecode(collisionStart),
            endFormatted: formatTimecode(collisionEnd),
            durationSec: Math.round((collisionEnd - collisionStart) * 10) / 10,
            text: `[${itemA.track.participant}]: "${itemA.cleanedText}"`,
            peakDb: itemA.metrics.peakDb,
            rmsDb: itemA.metrics.rmsDb,
            dynamicRangeDb: itemA.metrics.dynamicRangeDb,
            type: 'actor_overlap',
            typeLabel,
            selected: true,
            resolutionAction: 'note_sound_engineer',
            audioUrl: itemA.audioUrl,
            audioBuffer: itemA.audioBuffer,
            originalAudioBuffer,
            // Second actor in overlap
            secondTrackId: itemB.track.id,
            secondDubberName: itemB.track.participant,
            secondCharacterName: itemB.resolvedCharName,
            secondAssignmentId: itemB.matchingAssignmentId,
            secondAudioUrl: itemB.audioUrl,
            secondAudioBuffer: itemB.audioBuffer,
            secondPeakDb: itemB.metrics.peakDb,
            secondRmsDb: itemB.metrics.rmsDb,
            secondDynamicRangeDb: itemB.metrics.dynamicRangeDb,
            secondText: `[${itemB.track.participant}]: "${itemB.cleanedText}"`,
            secondLineIndex: itemB.lineIndex,
            secondSubId: itemB.subId,
            overlapSec: overlapSecRounded,
            timingDeltaPercent,
            overflowDurationSec,
            speechDurationSec: itemA.speechDurationSec,
            subDurationSec: itemA.subDurationSec,
            actualDurationSec: itemA.speechDurationSec,
            comment
          });
        }
      }
    }
  }

  // Add stand-alone timing_too_long defects (those not merged into any actor_overlap)
  for (const longDet of longTimingDetections.values()) {
    if (!longDet.isTimingTooLongMerged) {
      results.push(longDet);
    }
  }

  // =========================================================================
  // 5. SCAN FOR TECHNICAL ARTIFACTS (КЛИППИНГ, КЛИКИ, ЗАДУВЫ, ОБРЫВЫ ГЕЙТОМ)
  // =========================================================================
  if (options.scanArtifacts !== false) {
    onProgress?.(totalTracks, totalTracks, 'Сканирование технических артефактов (перегруз, клики, задувы)...');
    for (const trackCtx of decodedTracks) {
      const { track, audioBuffer, audioUrl } = trackCtx;
      const artifacts = scanTrackForArtifacts(audioBuffer, track, validSubLines, {
        detectClipping: true,
        detectClicks: true,
        detectPlosives: true,
        detectSwallowed: true
      });

      for (const art of artifacts) {
        const typeLabel = 
          art.type === 'clipping' ? 'Перегруз' :
          art.type === 'mouse_click' ? 'Клик мыши' :
          art.type === 'plosive' ? 'Задув (П/Б)' : 'Обрыв фразы';

        // Find assignment if available
        const matchingAssignment = (episode.assignments || []).find(a => {
          const assignedId = a.substituteId || a.dubberId;
          return assignedId === track.id || 
            (a.characterName && track.character.toLowerCase().includes(a.characterName.toLowerCase()));
        });

        results.push({
          id: art.id,
          defectCategory: 'audio_artifact',
          type: art.type,
          typeLabel,
          trackId: art.trackId,
          dubberName: art.dubberName,
          characterName: art.characterName,
          assignmentId: matchingAssignment?.id,
          lineIndex: art.lineIndex ?? -1,
          subId: art.subId,
          startSec: art.startSec,
          endSec: art.endSec,
          startFormatted: art.startFormatted,
          endFormatted: art.endFormatted,
          durationSec: art.durationSec,
          text: art.nearestSubtitleText || `[Технический огрех]: ${art.title}`,
          peakDb: art.type === 'clipping' ? 0.0 : -6.0,
          rmsDb: -18.0,
          dynamicRangeDb: 15.0,
          selected: art.selected,
          comment: art.comment,
          audioUrl,
          audioBuffer,
          originalAudioBuffer,
          resolutionAction: art.resolutionAction,
          artifactType: art.type,
          artifactMetric: art.metricDetails,
          artifactSeverity: art.severity,
          artifactTimestampSec: art.timestampSec,
          artifactTitle: art.title,
          artifactDescription: art.description,
          nearestSubtitleText: art.nearestSubtitleText
        });
      }
    }
  }

  // =========================================================================
  // 6. SCAN FOR TEXT DISCREPANCIES VIA WHISPER (ASR + SUBTITLE PROMPT CONTEXT)
  // =========================================================================
  if (scanWhisperText) {
    onProgress?.(totalTracks, totalTracks, `Сверка текста через Whisper (${whisperModel}) с контекстом сценария...`);

    for (const trackCtx of decodedTracks) {
      const { track, audioBuffer, audioUrl } = trackCtx;
      const trackVoiced = voicedLines.filter(v => v.track.id === track.id);
      if (trackVoiced.length === 0) continue;

      const linesToCheck = trackVoiced.map(v => ({
        lineIndex: v.lineIndex,
        subId: v.subId,
        startSec: v.speechStartSec,
        endSec: v.speechEndSec,
        startFormatted: formatTimecode(v.speechStartSec),
        endFormatted: formatTimecode(v.speechEndSec),
        characterName: v.resolvedCharName || track.character,
        text: v.cleanedText
      }));

      const selectedFile = track.files.find(f => f.id === track.selectedFileId) || track.files[0];
      const filePath = selectedFile?.path || audioUrl;

      const comparisons = await checkTrackTextWithWhisper(
        filePath,
        linesToCheck,
        whisperModel,
        (curr, tot, msg) => {
          onProgress?.(curr, tot, `Whisper (${whisperModel}): ${track.participant} [${curr}/${tot}]`);
        }
      );

      for (const comp of comparisons) {
        if (!comp.isDiscrepancy) continue;

        const voicedItem = trackVoiced.find(v => v.lineIndex === comp.lineIndex);
        if (!voicedItem) continue;

        const discType = comp.discrepancyType || 'changed_words';
        const typeLabel = 
          discType === 'missing_words' ? 'Пропуск слов' :
          discType === 'extra_words_or_retake' ? 'Лишние слова / дубль' : 'Отсебятина / замена слов';

        const detectionId = `whisper_text_${track.id}_${comp.lineIndex}_${voicedItem.speechStartSec.toFixed(2)}`;

        results.push({
          id: detectionId,
          defectCategory: 'text_mismatch',
          type: 'text_mismatch',
          typeLabel: `ASR: ${typeLabel}`,
          trackId: track.id,
          dubberName: track.participant,
          characterName: voicedItem.resolvedCharName || track.character,
          assignmentId: voicedItem.matchingAssignmentId,
          lineIndex: comp.lineIndex,
          subId: voicedItem.subId,
          startSec: voicedItem.speechStartSec,
          endSec: voicedItem.speechEndSec,
          startFormatted: formatTimecode(voicedItem.speechStartSec),
          endFormatted: formatTimecode(voicedItem.speechEndSec),
          durationSec: Math.round((voicedItem.speechEndSec - voicedItem.speechStartSec) * 10) / 10,
          text: comp.expectedText,
          expectedText: comp.expectedText,
          recognizedText: comp.recognizedText,
          textSimilarityPercent: comp.similarityPercent,
          textDiscrepancyType: discType,
          wordDiffs: comp.wordDiffs,
          whisperModelUsed: whisperModel,
          peakDb: voicedItem.metrics.peakDb,
          rmsDb: voicedItem.metrics.rmsDb,
          dynamicRangeDb: voicedItem.metrics.dynamicRangeDb,
          selected: true,
          resolutionAction: 'legitimate_fix',
          comment: `[Несовпадение текста] В сценарии: "${comp.expectedText}". Сказано: "${comp.recognizedText}".`,
          audioUrl,
          audioBuffer,
          originalAudioBuffer
        });
      }
    }
  }

  // Sort chronologically by start timestamp
  results.sort((a, b) => a.startSec - b.startSec);
  return results;
}

/**
 * Plays an isolated audio snippet or simultaneous dual mix (for overlaps and sync checks)
 * with dynamic peak volume normalization and soft limiting so all tracks are clearly audible.
 */
export class SnippetAudioPlayer {
  private static activeSourceA: AudioBufferSourceNode | null = null;
  private static activeSourceB: AudioBufferSourceNode | null = null;
  private static onStopCallback: (() => void) | null = null;
  private static limiterNode: DynamicsCompressorNode | null = null;

  /**
   * Lazily creates or reuses a shared soft-knee audio limiter node
   * to guarantee zero clipping when quiet tracks are boosted.
   */
  private static getLimiter(ctx: AudioContext): DynamicsCompressorNode {
    if (!this.limiterNode || this.limiterNode.context !== ctx) {
      this.limiterNode = ctx.createDynamicsCompressor();
      this.limiterNode.threshold.setValueAtTime(-1.0, ctx.currentTime);
      this.limiterNode.knee.setValueAtTime(0, ctx.currentTime);
      this.limiterNode.ratio.setValueAtTime(20, ctx.currentTime);
      this.limiterNode.attack.setValueAtTime(0.002, ctx.currentTime);
      this.limiterNode.release.setValueAtTime(0.05, ctx.currentTime);
      this.limiterNode.connect(ctx.destination);
    }
    return this.limiterNode;
  }

  /**
   * Computes dynamic peak normalization gain for a specific interval of an AudioBuffer.
   * Brings quiet lines up to standard audible volume (target peak ~ -1.0 dBFS)
   * while guarding against blowing up baseline quiet noise floors.
   */
  public static computeNormalizedGain(
    buffer: AudioBuffer | null | undefined,
    startSec: number,
    endSec: number,
    targetPeak: number = 0.89 // -1.0 dBFS
  ): number {
    if (!buffer) return 1.0;
    const sampleRate = buffer.sampleRate;
    const startSample = Math.max(0, Math.floor(startSec * sampleRate));
    const endSample = Math.min(buffer.length, Math.ceil(endSec * sampleRate));
    const totalSamples = endSample - startSample;
    if (totalSamples <= 0) return 1.0;

    let peak = 0;
    // Fast peak scan sampling up to 3000 points
    const step = Math.max(1, Math.floor(totalSamples / 3000));
    const numChannels = buffer.numberOfChannels;
    for (let ch = 0; ch < numChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = startSample; i < endSample; i += step) {
        const val = Math.abs(data[i]);
        if (val > peak) peak = val;
      }
    }

    // If pure digital silence or very low noise floor (< -54 dBFS), keep standard unity gain
    if (peak < 0.002) return 1.0;

    // Calculate gain needed to reach target peak
    const desiredGain = targetPeak / peak;
    // Allow boosting up to +24 dB (16.0x) for very quiet recordings, down to 0.4x for loud takes
    return Math.min(16.0, Math.max(0.4, desiredGain));
  }

  public static play(
    buffer: AudioBuffer,
    startSec: number,
    endSec: number,
    onEnded?: () => void,
    loop: boolean = false
  ): void {
    this.stop();

    const ctx = getSharedAudioContext();
    if (!ctx) return;
    ensureAudioContextResumed();

    const limiter = this.getLimiter(ctx);

    this.activeSourceA = ctx.createBufferSource();
    this.activeSourceA.buffer = buffer;

    const startTime = Math.max(0, startSec - 0.05);
    const duration = Math.max(0.1, endSec - startTime);

    // Compute dynamic normalization gain for this snippet
    const normGain = this.computeNormalizedGain(buffer, startTime, endSec);

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(normGain, ctx.currentTime);
    this.activeSourceA.connect(gainNode);
    gainNode.connect(limiter);

    if (loop) {
      this.activeSourceA.loop = true;
      this.activeSourceA.loopStart = startTime;
      this.activeSourceA.loopEnd = endSec + 0.05;
    } else {
      this.onStopCallback = onEnded || null;
      this.activeSourceA.onended = () => {
        if (this.onStopCallback) {
          this.onStopCallback();
          this.onStopCallback = null;
        }
        this.activeSourceA = null;
      };
    }

    this.activeSourceA.start(0, startTime, loop ? undefined : (duration + 0.1));
  }

  public static playMix(
    bufferA: AudioBuffer,
    bufferB: AudioBuffer,
    startSec: number,
    endSec: number,
    gainA: number = 1.0,
    gainB: number = 1.0,
    onEnded?: () => void
  ): void {
    this.stop();

    const ctx = getSharedAudioContext();
    if (!ctx) return;
    ensureAudioContextResumed();

    const limiter = this.getLimiter(ctx);

    const duration = Math.max(0.1, endSec - startSec);
    const startTime = Math.max(0, startSec - 0.05);

    // Dynamic normalization for both channels so neither is muffled
    const normA = this.computeNormalizedGain(bufferA, startTime, endSec, 0.80) * gainA;
    const normB = this.computeNormalizedGain(bufferB, startTime, endSec, 0.80) * gainB;

    this.activeSourceA = ctx.createBufferSource();
    this.activeSourceA.buffer = bufferA;
    const gainNodeA = ctx.createGain();
    gainNodeA.gain.setValueAtTime(normA, ctx.currentTime);
    this.activeSourceA.connect(gainNodeA);
    gainNodeA.connect(limiter);

    this.activeSourceB = ctx.createBufferSource();
    this.activeSourceB.buffer = bufferB;
    const gainNodeB = ctx.createGain();
    gainNodeB.gain.setValueAtTime(normB, ctx.currentTime);
    this.activeSourceB.connect(gainNodeB);
    gainNodeB.connect(limiter);

    this.onStopCallback = onEnded || null;

    let endedCount = 0;
    const handleEnded = () => {
      endedCount++;
      if (endedCount >= 2) {
        if (this.onStopCallback) {
          this.onStopCallback();
          this.onStopCallback = null;
        }
        this.activeSourceA = null;
        this.activeSourceB = null;
      }
    };

    this.activeSourceA.onended = handleEnded;
    this.activeSourceB.onended = handleEnded;

    this.activeSourceA.start(0, startTime, duration + 0.1);
    this.activeSourceB.start(0, startTime, duration + 0.1);
  }

  public static stop(): void {
    if (this.activeSourceA) {
      try {
        this.activeSourceA.stop();
        this.activeSourceA.disconnect();
      } catch (e) {}
      this.activeSourceA = null;
    }
    if (this.activeSourceB) {
      try {
        this.activeSourceB.stop();
        this.activeSourceB.disconnect();
      } catch (e) {}
      this.activeSourceB = null;
    }
    if (this.onStopCallback) {
      this.onStopCallback();
      this.onStopCallback = null;
    }
  }
}


