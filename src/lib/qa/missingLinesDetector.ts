/**
 * Automatic Gap Detection Engine for Dubber Audio vs Subtitles
 * 
 * Analyzes dubber audio tracks against assigned subtitle lines to find
 * missing voiced lines (complete silence or background room noise without dialogue).
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
  type: 'silence' | 'noise';
  typeLabel: string;
  selected: boolean;
  comment: string;
  audioUrl?: string;
  audioBuffer?: AudioBuffer;
}

export interface GapDetectionOptions {
  /**
   * Peak threshold below which audio is considered pure silence (dBFS).
   * Default: -38 dBFS
   */
  silencePeakThresholdDb?: number;
  /**
   * RMS threshold below which audio is considered pure silence (dBFS).
   * Default: -48 dBFS
   */
  silenceRmsThresholdDb?: number;
  /**
   * Relative drop below speech level to detect missing line even with noise (dB).
   * Default: 16 dB
   */
  relativeSpeechDropDb?: number;
  /**
   * Minimum duration in seconds of a subtitle to analyze.
   * Default: 0.2s
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
    silencePeakThresholdDb = -36,
    silenceRmsThresholdDb = -46,
    relativeSpeechDropDb = 15,
    minDurationSec = 0.2
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

    const sampleRate = audioBuffer.sampleRate;
    const numChannels = audioBuffer.numberOfChannels;
    const totalSamples = audioBuffer.length;

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

    // 1. Calculate general track baseline statistics (speech RMS vs quiet noise floor)
    let sumSquaresActive = 0;
    let activeSampleCount = 0;
    let maxOverallPeak = 0.0001;

    const channel0 = audioBuffer.getChannelData(0);
    const step = totalSamples > 1000000 ? Math.ceil(totalSamples / 300000) : 1;
    const speechGate = 0.0056; // -45 dBFS

    for (let i = 0; i < totalSamples; i += step) {
      const absVal = Math.abs(channel0[i]);
      if (absVal > maxOverallPeak) maxOverallPeak = absVal;
      if (absVal >= speechGate) {
        sumSquaresActive += absVal * absVal;
        activeSampleCount++;
      }
    }

    const trackSpeechRms = activeSampleCount > 0
      ? Math.sqrt(sumSquaresActive / activeSampleCount)
      : maxOverallPeak * 0.4;
    const trackSpeechRmsDb = 20 * Math.log10(Math.max(0.00001, trackSpeechRms));

    // 2. Iterate through subtitle lines matching this dubber's characters
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

      // Extract segment audio samples with a small 40ms margin
      const startSample = Math.max(0, Math.floor((startSec - 0.04) * sampleRate));
      const endSample = Math.min(totalSamples, Math.ceil((endSec + 0.04) * sampleRate));
      const segmentLength = endSample - startSample;

      if (segmentLength <= 0) continue;

      let segMaxPeak = 0.00001;
      let segSumSquares = 0;

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

      // Detection criteria
      const isAbsoluteSilence = segPeakDb <= silencePeakThresholdDb || segRmsDb <= silenceRmsThresholdDb;
      const isNoiseWithoutVoice = segPeakDb <= (silencePeakThresholdDb + 6) && segRmsDb <= (trackSpeechRmsDb - relativeSpeechDropDb);

      if (isAbsoluteSilence || isNoiseWithoutVoice) {
        const gapType: 'silence' | 'noise' = isAbsoluteSilence ? 'silence' : 'noise';
        const typeLabel = isAbsoluteSilence ? 'Полная тишина' : 'Фоновый шум (нет реплики)';
        
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
          peakDb: segPeakDb,
          rmsDb: segRmsDb,
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
