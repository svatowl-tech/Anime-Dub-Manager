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

export interface MissingLineDetection {
  id: string;
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
  type: 'silence' | 'noise';
  typeLabel: string;
  selected: boolean;
  comment: string;
  audioUrl?: string;
  audioBuffer?: AudioBuffer;
}

export interface GapDetectionOptions {
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

  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('Web Audio API не поддерживается данным браузером');
  }

  const audioCtx = new AudioCtx();
  try {
    return await audioCtx.decodeAudioData(arrayBuffer);
  } finally {
    if (audioCtx.state !== 'closed') {
      audioCtx.close().catch(() => {});
    }
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
      dynamicRangeDb: 0,
      peakToMinDb: 0,
      stdDevDb: 0,
      hasSpeechDynamics: false
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
 * Main detection function to analyze dubber tracks against subtitles in an episode
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
    minDurationSec = 0.15
  } = options;

  const results: MissingLineDetection[] = [];

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

  const totalTracks = dubberTracks.length;
  let processedTracks = 0;

  for (const track of dubberTracks) {
    processedTracks++;
    onProgress?.(
      processedTracks,
      totalTracks,
      `Анализ дорожки [${processedTracks}/${totalTracks}]: ${track.participant}...`
    );

    const selectedFile = track.files.find(f => f.id === track.selectedFileId) || track.files[0];
    if (!selectedFile || !selectedFile.path) continue;

    const audioUrl = resolveAudioUrl(selectedFile.path);
    if (!audioUrl) continue;

    let audioBuffer: AudioBuffer | null = null;
    try {
      audioBuffer = await decodeAudioFile(audioUrl);
    } catch (err) {
      console.warn(`Не удалось декодировать аудио для даббера ${track.participant}:`, err);
      continue;
    }

    if (!audioBuffer || audioBuffer.length === 0) continue;

    // Determine characters assigned to this dubber
    const assignedCharacters = new Set<string>();
    (episode.assignments || []).forEach(as => {
      const assignedId = as.substituteId || as.dubberId;
      if (assignedId === track.id && as.characterName) {
        assignedCharacters.add(as.characterName.trim().toLowerCase());
      }
    });

    // Fallback: also include characters parsed from track.character string
    track.character.split(',').forEach(c => {
      if (c.trim()) assignedCharacters.add(c.trim().toLowerCase());
    });

    // Iterate through subtitle lines matching this dubber's characters
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

      // Analyze dynamic range and energy fluctuation inside this line
      const metrics = analyzeSegmentDynamics(audioBuffer, startSec, endSec);

      // Detection Decision Logic:
      //
      // 1. If dynamic range is >= threshold (e.g. 3.0 dB) or peak-to-floor delta >= (threshold + 1.2 dB)
      //    and peak is above pure silence (-52 dBFS), speech modulation is clearly present!
      //    -> NOT a gap!
      //
      // 2. If it is pure digital silence (peak <= -52 dBFS and RMS <= -60 dBFS) -> GAP (type: silence).
      //
      // 3. If it is static background noise (e.g. room tone / preamp hiss / fan noise)
      //    where the energy level stays practically constant (dynamic swing < threshold dB, stdDev < 1.0 dB):
      //    -> GAP (type: noise, stationary room tone without voiced words).
      
      const isAbsoluteSilence = metrics.peakDb <= silencePeakThresholdDb || metrics.rmsDb <= silenceRmsThresholdDb;
      
      // Steady static background noise without voice:
      // Dynamic swing is below threshold (e.g. < 3 dB, stands in place +/- 1.5 dB)
      // and not an abnormally loud sound (peak < -24 dBFS)
      const isStationaryNoise = 
        metrics.dynamicRangeDb < speechDynamicThresholdDb &&
        metrics.peakToMinDb < (speechDynamicThresholdDb + 1.2) &&
        metrics.stdDevDb < 1.0 &&
        metrics.peakDb < -24;

      if (isAbsoluteSilence || isStationaryNoise) {
        const gapType: 'silence' | 'noise' = isAbsoluteSilence ? 'silence' : 'noise';
        const typeLabel = isAbsoluteSilence 
          ? '🔇 Тишина' 
          : `〰 Статичный фон (разбег ${metrics.dynamicRangeDb} дБ)`;
        
        // Clean subtitle text for comment (remove ASS override tags like {\an8}, \N, etc.)
        const cleanedText = line.text
          .replace(/\{[^}]+\}/g, '')
          .replace(/\\N/gi, ' ')
          .replace(/\\n/gi, ' ')
          .replace(/\\h/gi, ' ')
          .trim();

        const detectionId = `${track.id}_${line.rawLineIndex ?? lineIdx}_${startSec.toFixed(2)}`;

        // Match assignment for this character
        const matchingAssignment = (episode.assignments || []).find(a => {
          const assignedId = a.substituteId || a.dubberId;
          const char = (a.characterName || '').toLowerCase();
          return assignedId === track.id && (char === rawCharName.toLowerCase() || char === resolvedCharName.toLowerCase());
        });

        results.push({
          id: detectionId,
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
        });
      }
    }
  }

  // Sort chronologically by start timestamp
  results.sort((a, b) => a.startSec - b.startSec);
  return results;
}

/**
 * Plays an isolated audio snippet from startSec to endSec
 */
export class SnippetAudioPlayer {
  private static activeCtx: AudioContext | null = null;
  private static activeSource: AudioBufferSourceNode | null = null;
  private static onStopCallback: (() => void) | null = null;

  public static play(
    buffer: AudioBuffer,
    startSec: number,
    endSec: number,
    onEnded?: () => void
  ): void {
    this.stop();

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;

    this.activeCtx = new AudioCtx();
    this.activeSource = this.activeCtx.createBufferSource();
    this.activeSource.buffer = buffer;

    const gainNode = this.activeCtx.createGain();
    gainNode.gain.value = 1.0;
    this.activeSource.connect(gainNode);
    gainNode.connect(this.activeCtx.destination);

    const duration = Math.max(0.1, endSec - startSec);
    this.onStopCallback = onEnded || null;

    this.activeSource.onended = () => {
      if (this.onStopCallback) {
        this.onStopCallback();
        this.onStopCallback = null;
      }
      this.activeSource = null;
    };

    this.activeSource.start(0, Math.max(0, startSec - 0.05), duration + 0.1);
  }

  public static stop(): void {
    if (this.activeSource) {
      try {
        this.activeSource.stop();
        this.activeSource.disconnect();
      } catch (e) {}
      this.activeSource = null;
    }
    if (this.activeCtx && this.activeCtx.state !== 'closed') {
      this.activeCtx.close().catch(() => {});
      this.activeCtx = null;
    }
    if (this.onStopCallback) {
      this.onStopCallback();
      this.onStopCallback = null;
    }
  }
}

