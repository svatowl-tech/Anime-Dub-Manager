import { SubtitleLine, RoleAssignment } from "../../types";
import { ipcSafe } from "../../lib/ipcSafe";
import { normalizeSpeechText } from "../../lib/qa/whisperTextChecker";
import { resolveLocalPath } from "../../lib/webFileSystem";

/**
 * Calculates text similarity for Whisper speech vs. Subtitle text
 * Word-level Dice coefficient with prefix/stem matching for Russian morphology.
 */
export function calculateTextSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0;
  const norm1 = normalizeSpeechText(text1);
  const norm2 = normalizeSpeechText(text2);
  if (!norm1 || !norm2) return 0;
  if (norm1 === norm2) return 1.0;
  if (norm1.includes(norm2) || norm2.includes(norm1)) return 0.9;

  const words1 = norm1.split(' ').filter(Boolean);
  const words2 = norm2.split(' ').filter(Boolean);
  if (words1.length === 0 || words2.length === 0) return 0;

  let common = 0;
  for (const w of words1) {
    if (words2.includes(w)) {
      common += 1.0;
    } else {
      const stem = w.slice(0, Math.min(5, w.length));
      if (stem.length >= 4 && words2.some(w2 => w2.startsWith(stem))) {
        common += 0.8;
      }
    }
  }
  const dice = (2 * common) / (words1.length + words2.length);
  return Math.min(1.0, Math.max(0, dice));
}

export const isFixTrack = (t: any): boolean => {
  if (!t) return false;
  if (t.role === 'fix' || t.isFix === true || t.type === 'FIXES') return true;
  if (t.id && (t.id.endsWith('_fix') || t.id.includes('_fix_') || t.id.startsWith('fix_'))) return true;
  if (t.role === 'dubber') return false;
  if (t.filePath && (/(?:_fix|фикс|\[fix\]|\[фикс\])/i.test(t.filePath))) return true;
  return false;
};

export function parseTimeToSeconds(timeStr: string | number): number {
  if (typeof timeStr === 'number') return isNaN(timeStr) ? 0 : timeStr;
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const str = timeStr.trim();
  const parts = str.split(':');
  if (parts.length === 3) {
    const h = parseFloat(parts[0]) || 0;
    const m = parseFloat(parts[1]) || 0;
    const s = parseFloat(parts[2].replace(',', '.')) || 0;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const m = parseFloat(parts[0]) || 0;
    const s = parseFloat(parts[1].replace(',', '.')) || 0;
    return m * 60 + s;
  }
  const f = parseFloat(str.replace(',', '.'));
  return isNaN(f) ? 0 : f;
}

export function formatSeconds(sec: number): string {
  if (isNaN(sec) || sec < 0) return '00:00.00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function normalizeName(s: string): string {
  if (!s) return '';
  return s.toLowerCase().trim().replace(/[^a-z0-9а-яё]/gi, '');
}

/**
 * Strips technical suffixes like [Дорожка 1], _дорожка2, [фикс] so that
 * dubber nicknames are always canonical and never duplicate.
 */
export function cleanDubberNick(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '')
    .replace(/_дорожка\d+/gi, '')
    .replace(/\[(.*?)\]/g, (_m, inner) => {
      return inner.replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '').trim();
    })
    .replace(/[_\s-]+$/, '')
    .trim();
}

/**
 * Validates that candidate name is a legitimate person/character name,
 * and strictly filters out numeric artifacts (e.g. "0 3 4", "03_4", "123", timestamps, step IDs).
/**
 * Robust role-based subtitle line matching with alias expansion and style fallback.
 */
export function isSubtitleForCharacter(
  subName: string,
  charName: string,
  dubberNick: string,
  assignments: RoleAssignment[] = [],
  subStyle?: string,
  aliases?: Record<string, string>
): boolean {
  const candidates = [subName, subStyle].filter(Boolean) as string[];
  if (candidates.length === 0) return false;

  const normChar = normalizeName(charName);
  const normNick = normalizeName(dubberNick);

  const dubberAssigns = assignments.filter(a => {
    const aNick = normalizeName(a.substitute?.nickname || a.dubber?.nickname || (a as any).dubberNickname || '');
    const aId = a.substituteId || a.dubberId;
    return (aNick && (aNick === normNick || normNick.includes(aNick) || aNick.includes(normNick))) ||
           (aId && (aId === dubberNick || aId === normNick));
  });

  const assignedCharNames = dubberAssigns.map(a => normalizeName(a.characterName)).filter(Boolean);
  if (normChar && !assignedCharNames.includes(normChar)) assignedCharNames.push(normChar);

  // Add alias expansions if available
  if (aliases) {
    Object.entries(aliases).forEach(([orig, target]) => {
      const nOrig = normalizeName(orig);
      const nTarg = normalizeName(target);
      if (assignedCharNames.includes(nTarg) && nOrig && !assignedCharNames.includes(nOrig)) {
        assignedCharNames.push(nOrig);
      }
      if (assignedCharNames.includes(nOrig) && nTarg && !assignedCharNames.includes(nTarg)) {
        assignedCharNames.push(nTarg);
      }
    });
  }

  for (const rawCand of candidates) {
    if (!rawCand) continue;
    const normCand = normalizeName(rawCand);
    if (!normCand || normCand === 'default' || normCand === 'comment' || normCand === 'шумы' || normCand === 'sign' || normCand === 'titles') continue;

    // Direct match against assigned characters
    for (const cName of assignedCharNames) {
      if (!cName) continue;
      if (normCand === cName || normCand.includes(cName) || cName.includes(normCand)) {
        return true;
      }
      // Stem / prefix matching (e.g. Серебряков vs Серебрякова, Дегуршафф vs Дегуршафа)
      if (cName.length >= 4 && normCand.length >= 4) {
        const cStem = cName.slice(0, Math.min(5, cName.length - 1));
        const sStem = normCand.slice(0, Math.min(5, normCand.length - 1));
        if (cStem === sStem) return true;
      }
    }

    // Direct match against dubber nickname
    if (normNick) {
      if (normCand === normNick || normCand.includes(normNick) || normNick.includes(normCand)) {
        return true;
      }
    }

    // Split multi-character candidates (e.g. "Таня / Серебряков", "Виша, Таня", "Stan & Kori")
    const parts = rawCand.split(/[,;&/]|(?:\s+и\s+)/i).map(normalizeName).filter(Boolean);
    if (parts.some(p => assignedCharNames.some(c => c === p || c.includes(p) || p.includes(c)) || p === normNick || (normChar && (p.includes(normChar) || normChar.includes(p))))) {
      return true;
    }
  }

  return false;
}

export async function getPlayableAudioUrl(filePath: string): Promise<string | null> {
  if (!filePath) return null;
  if (filePath.startsWith('blob:') || filePath.startsWith('http://') || filePath.startsWith('https://') || filePath.startsWith('data:')) {
    return filePath;
  }
  if ((window as any).electronAPI) {
    return filePath.startsWith('file://') ? filePath : `file://${filePath.replace(/\\/g, '/')}`;
  }
  const cleanName = filePath.replace(/\\/g, '/').split('/').pop() || filePath;
  const cached = (window as any).getFileFromCache?.(cleanName);
  if (cached) {
    return URL.createObjectURL(cached);
  }
  try {
    const resolved = await resolveLocalPath(filePath);
    if (resolved) return resolved;
  } catch (err) {}
  return `file://${filePath.replace(/\\/g, '/')}`;
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

/**
 * Statistical Noise Floor & Speech Energy Analyzer.
 * Accurately analyzes the track before silence cutting to detect true ambient room noise,
 * speech dynamics, and safe threshold preventing clipping of quiet words or breaths.
 */
export function analyzeTrackAudioNoiseFloor(
  audioBuffer: AudioBuffer,
  manualThresholdDb?: number
): NoiseCalibration {
  if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function') {
    const floorDb = manualThresholdDb !== undefined ? manualThresholdDb : -42;
    return {
      noiseFloorDb: floorDb,
      speechFloorDb: -30,
      speechPeakDb: -6,
      calculatedThresholdDb: floorDb + 4,
      thresholdAmp: Math.pow(10, (floorDb + 4) / 20),
      dynamicRangeDb: 24,
      snrDb: 18
    };
  }
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const totalSamples = channelData.length;
  
  const windowSize = Math.max(128, Math.floor(sampleRate * 0.02)); // 20ms windows
  const totalWindows = Math.floor(totalSamples / windowSize);
  
  // Sample up to 12000 windows across the file for fast, ultra-accurate distribution
  const step = Math.max(1, Math.floor(totalWindows / 12000));
  const rmsDbValues: number[] = [];

  for (let w = 0; w < totalWindows; w += step) {
    const offset = w * windowSize;
    let sumSquares = 0;
    for (let j = 0; j < windowSize; j++) {
      const s = channelData[offset + j];
      sumSquares += s * s;
    }
    const rms = Math.sqrt(sumSquares / windowSize);
    const db = rms > 1e-5 ? 20 * Math.log10(rms) : -96;
    rmsDbValues.push(db);
  }

  if (rmsDbValues.length === 0) {
    return {
      noiseFloorDb: -60,
      speechFloorDb: -24,
      speechPeakDb: -6,
      calculatedThresholdDb: manualThresholdDb ?? -45,
      thresholdAmp: Math.pow(10, (manualThresholdDb ?? -45) / 20),
      dynamicRangeDb: 36,
      snrDb: 36
    };
  }

  rmsDbValues.sort((a, b) => a - b);

  // Real noise floor from lowest percentiles (excluding digital absolute nulls if non-null noise exists)
  const nonNullWindows = rmsDbValues.filter(v => v > -90);
  const effectiveNoiseWindows = nonNullWindows.length > 50 ? nonNullWindows : rmsDbValues;
  const noiseFloorDb = effectiveNoiseWindows[Math.floor(effectiveNoiseWindows.length * 0.15)];

  // Active speech windows: windows noticeably above the noise floor
  const activeSpeechWindows = rmsDbValues.filter(v => v > Math.max(-80, noiseFloorDb + 2.5));
  const speechFloorDb = activeSpeechWindows.length > 0
    ? activeSpeechWindows[Math.floor(activeSpeechWindows.length * 0.40)]
    : (nonNullWindows.length > 0 ? nonNullWindows[Math.floor(nonNullWindows.length * 0.75)] : -28.0);
  const speechPeakDb = activeSpeechWindows.length > 0
    ? activeSpeechWindows[Math.floor(activeSpeechWindows.length * 0.95)]
    : (nonNullWindows.length > 0 ? nonNullWindows[Math.floor(nonNullWindows.length * 0.98)] : -6.0);

  let calculatedThresholdDb: number;
  if (manualThresholdDb !== undefined && manualThresholdDb !== null && !isNaN(manualThresholdDb)) {
    calculatedThresholdDb = manualThresholdDb;
  } else {
    const snr = speechFloorDb - noiseFloorDb;
    if (snr > 14) {
      const margin = Math.min(8.0, Math.max(3.5, snr * 0.20));
      calculatedThresholdDb = Math.min(-34, noiseFloorDb + margin);
    } else {
      calculatedThresholdDb = Math.min(-32, noiseFloorDb + 2.5);
    }
    calculatedThresholdDb = Math.max(-65, Math.min(-30, calculatedThresholdDb));
  }

  const thresholdAmp = Math.pow(10, calculatedThresholdDb / 20);
  const dynamicRangeDb = Number((speechPeakDb - noiseFloorDb).toFixed(1));
  const snrDb = Number((speechFloorDb - noiseFloorDb).toFixed(1));

  return {
    noiseFloorDb: Number(noiseFloorDb.toFixed(1)),
    speechFloorDb: Number(speechFloorDb.toFixed(1)),
    speechPeakDb: Number(speechPeakDb.toFixed(1)),
    calculatedThresholdDb: Number(calculatedThresholdDb.toFixed(1)),
    thresholdAmp,
    dynamicRangeDb,
    snrDb
  };
}

/**
 * Speech interval detection algorithm on decoded AudioBuffer.
 * Identifies speech phrases and silences with noise calibration, intra-word pause smoothing,
 * and adaptive lead-in / lead-out padding so quiet consonants and breath tails are NEVER cut.
 */
export function detectSpeechIntervals(
  audioBuffer: AudioBuffer,
  options: {
    minSilenceDurationSec?: number;
    leadInPaddingSec?: number;
    leadOutPaddingSec?: number;
    minSpeechDurationSec?: number;
    mergeCloseGapsSec?: number;
    manualThresholdDb?: number;
    onCalibration?: (calib: NoiseCalibration) => void;
  } = {}
): Array<{ startSec: number; endSec: number; durationSec: number }> {
  const {
    minSilenceDurationSec = 0.26,
    leadInPaddingSec = 0.18,
    leadOutPaddingSec = 0.26,
    minSpeechDurationSec = 0.15,
    mergeCloseGapsSec = 0.25,
    manualThresholdDb,
    onCalibration
  } = options;

  const calib = analyzeTrackAudioNoiseFloor(audioBuffer, manualThresholdDb);
  if (onCalibration) onCalibration(calib);

  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const totalSamples = channelData.length;
  const duration = audioBuffer.duration;
  const thresholdAmp = calib.thresholdAmp;

  const chunkSize = Math.max(128, Math.floor(sampleRate * 0.02)); // 20ms chunks
  const totalChunks = Math.floor(totalSamples / chunkSize);
  const isSpeechChunk = new Uint8Array(totalChunks);

  for (let i = 0; i < totalChunks; i++) {
    let sumSquares = 0;
    const offset = i * chunkSize;
    for (let j = 0; j < chunkSize; j++) {
      const s = channelData[offset + j];
      sumSquares += s * s;
    }
    const rms = Math.sqrt(sumSquares / chunkSize);
    if (rms >= thresholdAmp) {
      isSpeechChunk[i] = 1;
    }
  }

  // Smooth short micro-pauses inside words (e.g. stop consonants like p, t, k < mergeCloseGapsSec)
  const minSilenceChunks = Math.floor(mergeCloseGapsSec / 0.02);
  let gapCount = 0;
  for (let i = 0; i < totalChunks; i++) {
    if (isSpeechChunk[i] === 0) {
      gapCount++;
    } else {
      if (gapCount > 0 && gapCount < minSilenceChunks) {
        for (let k = i - gapCount; k < i; k++) {
          isSpeechChunk[k] = 1;
        }
      }
      gapCount = 0;
    }
  }

  const rawIntervals: Array<{ startSec: number; endSec: number; durationSec: number }> = [];
  let inSpeech = false;
  let intervalStartSec = 0;

  for (let i = 0; i < totalChunks; i++) {
    const chunkTime = (i * chunkSize) / sampleRate;
    if (isSpeechChunk[i] === 1 && !inSpeech) {
      inSpeech = true;
      intervalStartSec = Math.max(0, chunkTime - leadInPaddingSec);
    } else if (isSpeechChunk[i] === 0 && inSpeech) {
      inSpeech = false;
      const intervalEndSec = Math.min(duration, chunkTime + leadOutPaddingSec);
      if (intervalEndSec - intervalStartSec >= minSpeechDurationSec) {
        rawIntervals.push({
          startSec: Number(intervalStartSec.toFixed(2)),
          endSec: Number(intervalEndSec.toFixed(2)),
          durationSec: Number((intervalEndSec - intervalStartSec).toFixed(2))
        });
      }
    }
  }

  if (inSpeech) {
    const intervalEndSec = duration;
    if (intervalEndSec - intervalStartSec >= minSpeechDurationSec) {
      rawIntervals.push({
        startSec: Number(intervalStartSec.toFixed(2)),
        endSec: Number(intervalEndSec.toFixed(2)),
        durationSec: Number((intervalEndSec - intervalStartSec).toFixed(2))
      });
    }
  }

  // Merge intervals if silence between them is less than minSilenceDurationSec
  const finalIntervals: Array<{ startSec: number; endSec: number; durationSec: number }> = [];
  for (const interval of rawIntervals) {
    if (finalIntervals.length === 0) {
      finalIntervals.push({ ...interval });
    } else {
      const last = finalIntervals[finalIntervals.length - 1];
      const gap = interval.startSec - last.endSec;
      if (gap < minSilenceDurationSec) {
        last.endSec = Math.max(last.endSec, interval.endSec);
        last.durationSec = Number((last.endSec - last.startSec).toFixed(2));
      } else {
        finalIntervals.push({ ...interval });
      }
    }
  }

  return finalIntervals;
}

/**
 * Rule: IF A PHRASE DOES NOT EXCEED THE BOUNDARIES OF THE SUBTITLE
 * OR EXCEEDS IT WITH A TAIL BY NO MORE THAN 30% OF THE SUBTITLE DURATION,
 * THEN TIMING OF THE PHRASE IS NOT REQUIRED.
 *
 * @param clipStartSec Audio phrase start time on timeline
 * @param clipDurationSec Audio phrase duration in seconds
 * @param subStartSec Subtitle start time
 * @param subEndSec Subtitle end time
 */
export function isPhraseTimingNotRequired(
  clipStartSec: number,
  clipDurationSec: number,
  subStartSec: number,
  subEndSec: number
): { notRequired: boolean; reason?: string; tailExcessSec?: number; tailExcessPct?: number } {
  if (
    typeof clipStartSec !== 'number' ||
    typeof clipDurationSec !== 'number' ||
    typeof subStartSec !== 'number' ||
    typeof subEndSec !== 'number'
  ) {
    return { notRequired: false };
  }
  const subDur = Math.max(0.1, subEndSec - subStartSec);
  const clipEndSec = clipStartSec + clipDurationSec;

  // Has phrase started noticeably before subtitle start? (allow a small acoustic margin 0.08s for consonant lead-in)
  const startsPrematurely = clipStartSec < subStartSec - 0.08;
  if (startsPrematurely) {
    return { notRequired: false };
  }

  // Case 1: Phrase does not exceed boundaries of the subtitle (with small 0.05s rounding margin)
  if (clipEndSec <= subEndSec + 0.05) {
    return {
      notRequired: true,
      reason: 'В пределах субтитра (тайминг не требуется)'
    };
  }

  // Case 2: Phrase exceeds with a tail, but by no more than 30% of the subtitle duration
  const tailExcessSec = clipEndSec - subEndSec;
  const maxAllowedTail = subDur * 0.30 + 0.05;
  const tailExcessPct = (tailExcessSec / subDur) * 100;

  if (tailExcessSec <= maxAllowedTail) {
    return {
      notRequired: true,
      reason: `Хвост фразы заходит на ${tailExcessSec.toFixed(2)}с (${Math.round(tailExcessPct)}% ≤ 30% саба — тайминг не требуется)`,
      tailExcessSec: Number(tailExcessSec.toFixed(2)),
      tailExcessPct: Math.round(tailExcessPct)
    };
  }

  return {
    notRequired: false,
    tailExcessSec: Number(tailExcessSec.toFixed(2)),
    tailExcessPct: Math.round(tailExcessPct)
  };
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
  volumeGainDb?: number;    // Gain dB offset (0 dB for main voice, -10 dB for secondary voice in overlaps)
  isFix?: boolean;          // Flag for spliced fix takes
  hasCollision?: boolean;   // Collision with another actor
  offsetSec: number;        // Manual mouse drag offset
  rawSourceStartSec?: number; // Detected start before any manual trim/expansion
  rawSourceEndSec?: number;   // Detected end before any manual trim/expansion
  isSelfOverlap?: boolean;    // Intentional parallel layer between 2 tracks of same dubber
  isIntentionalOverlap?: boolean; // Intentional overlap specified in original subtitles
  overlapGroupId?: string;  // Group ID for intentional overlap
  overlapRole?: 'main' | 'secondary' | null; // Main (0 dB) vs Secondary (-10 dB)
  overlapRoleDisabled?: boolean; // User explicitly disabled intentional overlap role on this phrase
  timingNotRequired?: boolean; // Phrase within sub or tail <= 30% of sub duration
  timingNotRequiredReason?: string;
  sourceAudioTrackId?: string; // Track ID of audio buffer if spliced from fix track
  sourceAudioPath?: string;    // Direct file path on disk for export / mixing
  // Two-Stage Auto-Timing Problem Tracking
  timingIssue?: 'overlap' | 'desync' | 'orphan' | null;
  timingIssueText?: string;
  targetSubStartSec?: number;
  targetSubEndSec?: number;
  timeDiffSec?: number;       // Difference in seconds from subtitle start (positive = late, negative = early)
  overlappingClipId?: string;
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

