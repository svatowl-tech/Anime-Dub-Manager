import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Clock, 
  Play, 
  Pause, 
  RotateCcw, 
  Scissors, 
  Sparkles, 
  Sliders, 
  AlertTriangle, 
  CheckCircle2, 
  Download, 
  FolderOpen, 
  ZoomIn, 
  ZoomOut,
  ChevronDown,
  Volume2,
  VolumeX,
  ArrowRight,
  RefreshCw,
  MoveHorizontal,
  Layers,
  Activity,
  Check,
  X,
  Trash2,
  Settings,
  Loader2,
  ShieldCheck,
  Radio,
  Search,
  Crosshair,
  Zap,
  Copy,
  Video,
  EyeOff,
  GripHorizontal
} from 'lucide-react';
import { toast } from 'sonner';
import { Episode, Track, SubtitleLine, RoleAssignment } from '../types';
import { ipcSafe } from '../lib/ipcSafe';
import { getSharedAudioContext } from '../lib/qa/sharedAudioContext';
import { analyzeAudioBufferForPreview, analyzeAudioForPreview, NormalizationMetrics } from '../lib/qa/audioNormalizer';
import { ExportModal } from './ExportModal';
import { TimingSettingsModal, TimingSettings, DEFAULT_TIMING_SETTINGS } from './TimingSettingsModal';
import { normalizeSpeechText } from '../lib/qa/whisperTextChecker';
import { globalAudioAICleanupEngine } from '../services/AudioAICleanupEngine';
import { prepareQATracksForTiming } from '../lib/qaTimingHelper';
import { loadTimingProjectForEpisode, applyTimingPassportToClips, TimingProjectData } from '../lib/qa/timingSyncService';
import { resolveLocalPath } from '../lib/webFileSystem';


/**
 * Calculates text similarity for Whisper speech vs. Subtitle text
 * Word-level Dice coefficient with prefix/stem matching for Russian morphology.
 */
function calculateTextSimilarity(text1: string, text2: string): number {
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

function parseTimeToSeconds(timeStr: string | number): number {
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

function formatSeconds(sec: number): string {
  if (isNaN(sec) || sec < 0) return '00:00.00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function normalizeName(s: string): string {
  if (!s) return '';
  return s.toLowerCase().trim().replace(/[^a-z0-9а-яё]/gi, '');
}

/**
 * Strips technical suffixes like [Дорожка 1], _дорожка2, [фикс] so that
 * dubber nicknames are always canonical and never duplicate.
 */
function cleanDubberNick(raw: string): string {
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
function isSubtitleForCharacter(
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

async function getPlayableAudioUrl(filePath: string): Promise<string | null> {
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
  manualThresholdDb?: number,
  subLines?: Array<{ startSec: number; endSec: number }>
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
  const numChannels = Math.max(1, audioBuffer.numberOfChannels || 1);
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }
  const sampleRate = audioBuffer.sampleRate;
  const totalSamples = channels[0].length;
  
  const windowSize = Math.max(128, Math.floor(sampleRate * 0.02)); // 20ms windows
  const totalWindows = Math.floor(totalSamples / windowSize);
  
  // Sample up to 12000 windows across the file for fast, ultra-accurate distribution
  const step = Math.max(1, Math.floor(totalWindows / 12000));
  const rmsDbValues: number[] = [];

  for (let w = 0; w < totalWindows; w += step) {
    const offset = w * windowSize;
    let maxRms = 0;
    for (let c = 0; c < numChannels; c++) {
      const ch = channels[c];
      let sumSquares = 0;
      for (let j = 0; j < windowSize; j++) {
        const s = ch[offset + j];
        sumSquares += s * s;
      }
      const chRms = Math.sqrt(sumSquares / windowSize);
      if (chRms > maxRms) maxRms = chRms;
    }
    const db = maxRms > 3.16e-5 ? 20 * Math.log10(maxRms) : -91;
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

  // Real noise floor estimation that NEVER mistakes gated speech clips for room noise:
  // In DAW-exported or gated dubber tracks, 80-98% of windows are digital silence (<= -88 dB),
  // so nonNullWindows contains almost exclusively the dubber's active speech phrases!
  const nonNullWindows = rmsDbValues.filter(v => v > -88);
  const activeFraction = nonNullWindows.length / Math.max(1, rmsDbValues.length);
  const isGatedOrSparseTrack = activeFraction < 0.55;

  let noiseFloorDb: number;
  let noiseUpperDb: number;

  if (isGatedOrSparseTrack) {
    // Track already has silent pauses between phrases: lowest 8% of non-null windows is clip room-tone tail
    const rawClipNoise = nonNullWindows.length > 20
      ? nonNullWindows[Math.floor(nonNullWindows.length * 0.08)]
      : -72;
    noiseFloorDb = Math.max(-86, Math.min(-50, rawClipNoise));
    noiseUpperDb = Math.min(-46, noiseFloorDb + 3.0);
  } else {
    // Continuous open-mic recording: lowest 15% of all windows is ambient room noise, capped by file median
    const rawRoomNoise = rmsDbValues[Math.floor(rmsDbValues.length * 0.15)];
    const medianDb = rmsDbValues[Math.floor(rmsDbValues.length * 0.50)];
    noiseFloorDb = Math.max(-86, Math.min(-45, rawRoomNoise));
    noiseUpperDb = Math.min(-42, medianDb, noiseFloorDb + 3.5);
  }

  // Top 0.5% energy windows represent true vocal peaks (immune to 95%+ silence/room-tone in 24-min dubbing tracks)
  const topPeakIdx = Math.min(rmsDbValues.length - 1, Math.max(0, Math.floor(rmsDbValues.length * 0.995)));
  const topVoicePeakDb = rmsDbValues[topPeakIdx];

  // Active speech windows: adaptively scaled above true room noise
  const minSpeechCandDb = Math.max(
    -80,
    noiseUpperDb + 4.0,
    noiseFloorDb + 7.0,
    topVoicePeakDb - 34.0
  );
  const activeSpeechWindows = rmsDbValues.filter(v => v >= minSpeechCandDb);

  const speechFloorDb = activeSpeechWindows.length > 0
    ? activeSpeechWindows[Math.floor(activeSpeechWindows.length * 0.25)]
    : Math.max(noiseUpperDb + 6.0, topVoicePeakDb - 18.0);
  const speechPeakDb = activeSpeechWindows.length > 0
    ? activeSpeechWindows[Math.floor(activeSpeechWindows.length * 0.90)]
    : Math.max(speechFloorDb + 4.0, topVoicePeakDb);

  let calculatedThresholdDb: number;
  if (manualThresholdDb !== undefined && manualThresholdDb !== null && !isNaN(manualThresholdDb)) {
    calculatedThresholdDb = manualThresholdDb;
  } else {
    // Trigger threshold must sit well below speechFloorDb (-13 dB below average speech, -28 dB below peak)
    // while staying safely above the true room noise floor (+6.5 dB above noiseFloorDb)
    const safeNoiseMarginDb = Math.max(-78, noiseUpperDb + 3.5, noiseFloorDb + 6.5);
    const voiceEntryDb = Math.min(speechFloorDb - 13.0, speechPeakDb - 28.0);
    calculatedThresholdDb = Math.max(safeNoiseMarginDb, voiceEntryDb);

    // If assigned subtitle windows are known on a full-length track, calibrate against the quietest recorded subtitle windows
    // so quiet phrases, whispers, or unnormalized syllables are never eaten
    const isShortFile = audioBuffer.duration < 45;
    if (subLines && subLines.length > 0 && !isShortFile) {
      const subPhraseEnergyDbs: number[] = [];
      for (const sub of subLines) {
        const wStart = Math.max(0, sub.startSec - 1.2);
        const wEnd = Math.min(audioBuffer.duration, sub.endSec + 1.5);
        const sSample = Math.floor(wStart * sampleRate);
        const eSample = Math.min(totalSamples, Math.floor(wEnd * sampleRate));
        if (eSample <= sSample + windowSize) continue;

        const winDbs: number[] = [];
        for (let pos = sSample; pos + windowSize <= eSample; pos += windowSize) {
          let maxRms = 0;
          for (let c = 0; c < numChannels; c++) {
            const ch = channels[c];
            let sumSq = 0;
            for (let j = 0; j < windowSize; j++) {
              const s = ch[pos + j];
              sumSq += s * s;
            }
            const r = Math.sqrt(sumSq / windowSize);
            if (r > maxRms) maxRms = r;
          }
          const db = maxRms > 3.16e-5 ? 20 * Math.log10(maxRms) : -91;
          if (db >= noiseFloorDb + 5.0 && db >= noiseUpperDb + 3.0) {
            winDbs.push(db);
          }
        }
        if (winDbs.length >= 4) {
          winDbs.sort((a, b) => a - b);
          const p50 = winDbs[Math.floor(winDbs.length * 0.50)];
          subPhraseEnergyDbs.push(p50);
        }
      }

      if (subPhraseEnergyDbs.length > 0) {
        subPhraseEnergyDbs.sort((a, b) => a - b);
        const quietestSubPhraseDb = subPhraseEnergyDbs[Math.floor(subPhraseEnergyDbs.length * 0.05)];
        const subGuidedThresholdDb = Math.max(
          safeNoiseMarginDb,
          quietestSubPhraseDb - 9.0
        );
        calculatedThresholdDb = Math.min(calculatedThresholdDb, subGuidedThresholdDb);
      }
    }

    // Never allow auto-threshold to exceed -42 dB (a threshold of -26..-35 dB chops off consonants and phrase endings)
    calculatedThresholdDb = Math.max(-82, Math.min(-42, calculatedThresholdDb));
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
 * Dual-Threshold (Hysteresis) Speech Interval Detection on decoded AudioBuffer.
 * 1. Core Speech Trigger (`thresholdAmp`) detects real vocal phrases (RMS + consonant peak transients).
 * 2. Subtitle-Window Quiet Phrase Recovery ensures soft/whispered subtitle lines are never skipped.
 * 3. Hysteresis Boundary Expansion (`edgeThresholdAmp` = noiseFloor + 3 dB) traces backwards and forwards
 *    from every phrase until true room silence ("от тишины до тишины"), capturing all soft consonant attacks,
 *    stop-consonant closures, breaths, and trailing vocal fade-outs before adding lead-in/lead-out padding.
 */
function detectSpeechIntervals(
  audioBuffer: AudioBuffer,
  options: {
    minSilenceDurationSec?: number;
    leadInPaddingSec?: number;
    leadOutPaddingSec?: number;
    minSpeechDurationSec?: number;
    mergeCloseGapsSec?: number;
    manualThresholdDb?: number;
    subLines?: Array<{ startSec: number; endSec: number }>;
    onCalibration?: (calib: NoiseCalibration) => void;
  } = {}
): Array<{ startSec: number; endSec: number; durationSec: number }> {
  const {
    minSilenceDurationSec = 0.32,
    leadInPaddingSec = 0.20,
    leadOutPaddingSec = 0.30,
    minSpeechDurationSec = 0.18,
    mergeCloseGapsSec = 0.40,
    manualThresholdDb,
    subLines,
    onCalibration
  } = options;

  const calib = analyzeTrackAudioNoiseFloor(audioBuffer, manualThresholdDb, subLines);
  if (onCalibration) onCalibration(calib);

  const numChannels = Math.max(1, audioBuffer.numberOfChannels || 1);
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }
  const sampleRate = audioBuffer.sampleRate;
  const totalSamples = channels[0].length;
  const duration = audioBuffer.duration;
  const triggerThresholdAmp = calib.thresholdAmp;

  // Lower boundary threshold ("от тишины до тишины") sits just 3.0 dB above the room noise floor
  // (and at least 7.5 dB below the trigger threshold) so phrase starts and ends are traced all the way to true silence.
  const edgeThresholdDb = Math.max(
    -86,
    Math.min(calib.calculatedThresholdDb - 7.5, calib.noiseFloorDb + 3.0)
  );
  const edgeThresholdAmp = Math.pow(10, edgeThresholdDb / 20);

  const chunkSize = Math.max(128, Math.floor(sampleRate * 0.02)); // 20ms chunks
  const totalChunks = Math.floor(totalSamples / chunkSize);
  const chunkRmsValues = new Float32Array(totalChunks);
  const chunkPeakValues = new Float32Array(totalChunks);
  const isSpeechChunk = new Uint8Array(totalChunks);

  for (let i = 0; i < totalChunks; i++) {
    const offset = i * chunkSize;
    let maxRms = 0;
    let maxPeak = 0;
    for (let c = 0; c < numChannels; c++) {
      const ch = channels[c];
      let sumSquares = 0;
      let chPeak = 0;
      for (let j = 0; j < chunkSize; j++) {
        const s = ch[offset + j];
        const absS = Math.abs(s);
        if (absS > chPeak) chPeak = absS;
        sumSquares += s * s;
      }
      const chRms = Math.sqrt(sumSquares / chunkSize);
      if (chRms > maxRms) maxRms = chRms;
      if (chPeak > maxPeak) maxPeak = chPeak;
    }
    chunkRmsValues[i] = maxRms;
    chunkPeakValues[i] = maxPeak;
    // Trigger on either RMS above threshold OR sharp consonant/plosive peak transient above 2.1x threshold
    if (maxRms >= triggerThresholdAmp || (maxPeak >= triggerThresholdAmp * 2.1 && maxRms >= edgeThresholdAmp)) {
      isSpeechChunk[i] = 1;
    }
  }

  // Subtitle-Window Quiet Phrase Recovery:
  // On full-length tracks (>= 45s) when subtitle windows are known, check if any subtitle window
  // has no detected speech chunks at the global threshold, and if there is vocal energy above the noise floor
  // inside [sub.startSec - 1.2, sub.endSec + 1.5], activate those chunks with a local adaptive threshold.
  if (subLines && subLines.length > 0 && duration >= 45 && manualThresholdDb === undefined) {
    const minLocalNoiseAmp = Math.pow(10, Math.max(-85, calib.noiseFloorDb + 4.5) / 20);
    for (const sub of subLines) {
      const wStartSec = Math.max(0, sub.startSec - 1.2);
      const wEndSec = Math.min(duration, sub.endSec + 1.5);
      const startChunk = Math.max(0, Math.floor((wStartSec * sampleRate) / chunkSize));
      const endChunk = Math.min(totalChunks - 1, Math.floor((wEndSec * sampleRate) / chunkSize));
      if (endChunk <= startChunk + 4) continue;

      let activeCount = 0;
      let localMaxRms = 0;
      for (let cIdx = startChunk; cIdx <= endChunk; cIdx++) {
        if (isSpeechChunk[cIdx] === 1) activeCount++;
        if (chunkRmsValues[cIdx] > localMaxRms) localMaxRms = chunkRmsValues[cIdx];
      }

      if (activeCount < 4 && localMaxRms >= minLocalNoiseAmp * 1.25) {
        const localThreshAmp = Math.max(minLocalNoiseAmp, localMaxRms * 0.22);
        let candidateCount = 0;
        for (let cIdx = startChunk; cIdx <= endChunk; cIdx++) {
          if (chunkRmsValues[cIdx] >= localThreshAmp) candidateCount++;
        }
        if (candidateCount >= 4) {
          for (let cIdx = startChunk; cIdx <= endChunk; cIdx++) {
            if (chunkRmsValues[cIdx] >= localThreshAmp) {
              isSpeechChunk[cIdx] = 1;
            }
          }
        }
      }
    }
  }

  // Pass 1: Smooth short micro-pauses inside words (stop consonants like p, t, k, brief breath pauses)
  const effectiveMergeSec = Math.max(0.38, mergeCloseGapsSec);
  const minSilenceChunks = Math.floor(effectiveMergeSec / 0.02);
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

  // Pass 2: Hysteresis Edge Expansion ("От тишины до тишины")
  // For every detected speech segment, trace backwards and forwards down to `edgeThresholdAmp`
  // so soft consonant attacks, inhalations, trailing syllables, and word endings are 100% preserved.
  const maxBackwardExpandChunks = Math.floor(0.90 / 0.02); // up to 900ms backwards
  const maxForwardExpandChunks = Math.floor(1.30 / 0.02);  // up to 1300ms forwards
  const isAboveEdge = (idx: number) =>
    chunkRmsValues[idx] >= edgeThresholdAmp || chunkPeakValues[idx] >= edgeThresholdAmp * 1.85;

  let segIdx = 0;
  while (segIdx < totalChunks) {
    if (isSpeechChunk[segIdx] === 1) {
      const segStart = segIdx;
      while (segIdx < totalChunks && isSpeechChunk[segIdx] === 1) {
        segIdx++;
      }
      const segEnd = segIdx - 1;

      // Expand backwards to true silence (allowing up to 4 chunks = 80ms stop-consonant closure dip)
      let newStart = segStart;
      let backSilentRun = 0;
      const minBackLimit = Math.max(0, segStart - maxBackwardExpandChunks);
      for (let b = segStart - 1; b >= minBackLimit; b--) {
        if (isAboveEdge(b)) {
          newStart = b;
          backSilentRun = 0;
        } else {
          backSilentRun++;
          if (backSilentRun > 4) break;
        }
      }
      for (let k = newStart; k < segStart; k++) {
        isSpeechChunk[k] = 1;
      }

      // Expand forwards to true silence (allowing up to 5 chunks = 100ms final stop-consonant closure dip)
      let newEnd = segEnd;
      let fwdSilentRun = 0;
      const maxFwdLimit = Math.min(totalChunks - 1, segEnd + maxForwardExpandChunks);
      for (let f = segEnd + 1; f <= maxFwdLimit; f++) {
        if (isAboveEdge(f)) {
          newEnd = f;
          fwdSilentRun = 0;
        } else {
          fwdSilentRun++;
          if (fwdSilentRun > 5) break;
        }
      }
      for (let k = segEnd + 1; k <= newEnd; k++) {
        isSpeechChunk[k] = 1;
      }

      segIdx = newEnd + 1;
    } else {
      segIdx++;
    }
  }

  // Pass 3: Re-smooth any micro-gaps after edge expansion
  gapCount = 0;
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

  const effectiveLeadInSec = Math.max(0.18, leadInPaddingSec);
  const effectiveLeadOutSec = Math.max(0.26, leadOutPaddingSec);

  const rawIntervals: Array<{ startSec: number; endSec: number; durationSec: number }> = [];
  let inSpeech = false;
  let intervalStartSec = 0;

  for (let i = 0; i < totalChunks; i++) {
    const chunkTime = (i * chunkSize) / sampleRate;
    if (isSpeechChunk[i] === 1 && !inSpeech) {
      inSpeech = true;
      intervalStartSec = Math.max(0, chunkTime - effectiveLeadInSec);
    } else if (isSpeechChunk[i] === 0 && inSpeech) {
      inSpeech = false;
      const intervalEndSec = Math.min(duration, chunkTime + effectiveLeadOutSec);
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
 * Detects the exact acoustic vocal onset offset inside a clip [sourceStartSec, sourceEndSec].
 * Used for unison / mass phrases so that multiple dubbers' actual vocal attacks hit simultaneously
 * even if their lead-in padding or breath lengths differ slightly.
 */
function detectSpeechOnsetOffsetSec(
  audioBuffer: AudioBuffer | undefined,
  sourceStartSec: number,
  sourceEndSec: number
): number {
  if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function') return 0;
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const startSample = Math.max(0, Math.floor(sourceStartSec * sampleRate));
  const scanLimitSec = Math.min(sourceEndSec, sourceStartSec + 0.65);
  const endSample = Math.min(channelData.length, Math.floor(scanLimitSec * sampleRate));
  if (endSample <= startSample) return 0;

  const winSamples = Math.max(64, Math.floor(sampleRate * 0.01)); // 10ms window
  const rmsList: number[] = [];
  let maxRms = 0;

  for (let pos = startSample; pos + winSamples <= endSample; pos += winSamples) {
    let sumSq = 0;
    for (let i = 0; i < winSamples; i++) {
      const s = channelData[pos + i];
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / winSamples);
    rmsList.push(rms);
    if (rms > maxRms) maxRms = rms;
  }

  if (rmsList.length === 0 || maxRms < 1e-4) return 0;
  const onsetThreshold = Math.max(1e-3, maxRms * 0.28);

  for (let idx = 0; idx < rmsList.length; idx++) {
    if (rmsList[idx] >= onsetThreshold) {
      const offsetSec = (idx * winSamples) / sampleRate;
      return Number(Math.max(0, Math.min(0.45, offsetSec)).toFixed(3));
    }
  }
  return 0;
}

/**
 * Measures active speech windows and syllable energy spread inside a clip or buffer region.
 * Used to distinguish full vs targeted fix tracks and sustained speech vs ultra-short breath bursts
 * without relying on Whisper word matching.
 */
function measureClipActiveSpeechStats(
  audioBuffer: AudioBuffer | undefined,
  startSec: number,
  endSec: number,
  thresholdAmp = 0.008
): {
  activeWindows: number;
  activeSpeechSec: number;
  peakRms: number;
} {
  if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function') {
    const dur = Math.max(0, endSec - startSec);
    return { activeWindows: Math.round(dur / 0.02), activeSpeechSec: dur, peakRms: 0.05 };
  }
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const sSample = Math.max(0, Math.floor(startSec * sampleRate));
  const eSample = Math.min(channelData.length, Math.floor(endSec * sampleRate));
  const winSize = Math.max(128, Math.floor(sampleRate * 0.02));
  let activeWindows = 0;
  let peakRms = 0;

  for (let p = sSample; p + winSize <= eSample; p += winSize) {
    let sumSq = 0;
    for (let j = 0; j < winSize; j++) {
      const v = channelData[p + j];
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / winSize);
    if (rms > peakRms) peakRms = rms;
    if (rms >= thresholdAmp) {
      activeWindows++;
    }
  }

  return {
    activeWindows,
    activeSpeechSec: Number((activeWindows * 0.02).toFixed(2)),
    peakRms
  };
}

/**
 * Targeted local window speech scanner for the Iterative Self-Healing Final Audit.
 * Scans a specific time window [windowStartSec, windowEndSec] in a fix or original AudioBuffer
 * with increased sensitivity (+4 dB lower threshold) to recover quiet or accidentally dropped phrases.
 */
function scanBufferWindowForSpeech(
  audioBuffer: AudioBuffer,
  windowStartSec: number,
  windowEndSec: number,
  leadInSec = 0.20,
  leadOutSec = 0.30
): Array<{ startSec: number; endSec: number; durationSec: number }> {
  if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function') return [];
  const calib = analyzeTrackAudioNoiseFloor(audioBuffer);
  // Lower threshold by 6 dB (down to -84 dB on clean unnormalized tracks) to catch softer phrases that initial VAD may have missed
  const sensitiveDb = Math.max(
    -84,
    calib.noiseFloorDb + 4.0,
    Math.min(-44, calib.calculatedThresholdDb - 6.0)
  );
  const thresholdAmp = Math.pow(10, sensitiveDb / 20);
  const edgeAmp = Math.pow(10, Math.max(-86, calib.noiseFloorDb + 2.8) / 20);

  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const startSecClamped = Math.max(0, windowStartSec);
  const endSecClamped = Math.min(audioBuffer.duration, windowEndSec);
  if (endSecClamped <= startSecClamped + 0.12) return [];

  const sSample = Math.floor(startSecClamped * sampleRate);
  const eSample = Math.min(channelData.length, Math.floor(endSecClamped * sampleRate));
  const chunkSize = Math.max(128, Math.floor(sampleRate * 0.02));
  const numChunks = Math.floor((eSample - sSample) / chunkSize);
  if (numChunks <= 0) return [];

  const chunkRms = new Float32Array(numChunks);
  const isSpeech = new Uint8Array(numChunks);
  for (let i = 0; i < numChunks; i++) {
    let sumSq = 0;
    const off = sSample + i * chunkSize;
    for (let j = 0; j < chunkSize; j++) {
      const v = channelData[off + j];
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / chunkSize);
    chunkRms[i] = rms;
    if (rms >= thresholdAmp) isSpeech[i] = 1;
  }

  // Smooth micro-gaps < 380ms
  const smoothChunks = Math.floor(0.38 / 0.02);
  let gap = 0;
  for (let i = 0; i < numChunks; i++) {
    if (isSpeech[i] === 0) {
      gap++;
    } else {
      if (gap > 0 && gap < smoothChunks) {
        for (let k = i - gap; k < i; k++) isSpeech[k] = 1;
      }
      gap = 0;
    }
  }

  // Expand edges to edgeAmp ("от тишины до тишины")
  for (let i = 0; i < numChunks; i++) {
    if (isSpeech[i] === 1) {
      for (let b = i - 1; b >= Math.max(0, i - 25); b--) {
        if (chunkRms[b] >= edgeAmp) isSpeech[b] = 1;
        else break;
      }
      while (i < numChunks && isSpeech[i] === 1) i++;
      const endIdx = i - 1;
      for (let f = endIdx + 1; f < Math.min(numChunks, endIdx + 35); f++) {
        if (chunkRms[f] >= edgeAmp) isSpeech[f] = 1;
        else break;
      }
    }
  }

  const found: Array<{ startSec: number; endSec: number; durationSec: number }> = [];
  let inSeg = false;
  let segStart = 0;
  for (let i = 0; i < numChunks; i++) {
    const t = startSecClamped + (i * chunkSize) / sampleRate;
    if (isSpeech[i] === 1 && !inSeg) {
      inSeg = true;
      segStart = Math.max(0, t - leadInSec);
    } else if (isSpeech[i] === 0 && inSeg) {
      inSeg = false;
      const segEnd = Math.min(audioBuffer.duration, t + leadOutSec);
      if (segEnd - segStart >= 0.16) {
        found.push({
          startSec: Number(segStart.toFixed(2)),
          endSec: Number(segEnd.toFixed(2)),
          durationSec: Number((segEnd - segStart).toFixed(2))
        });
      }
    }
  }
  if (inSeg) {
    const segEnd = endSecClamped;
    if (segEnd - segStart >= 0.16) {
      found.push({
        startSec: Number(segStart.toFixed(2)),
        endSec: Number(segEnd.toFixed(2)),
        durationSec: Number((segEnd - segStart).toFixed(2))
      });
    }
  }
  return found;
}

/**
 * Real Audio Waveform Canvas Component for Individual Speech Clips
 * Renders real PCM peaks directly from the decoded AudioBuffer between sourceStartSec and sourceEndSec.
 */
const ClipWaveform: React.FC<{
  audioBuffer: AudioBuffer | null;
  sourceStartSec: number;
  sourceEndSec: number;
  width: number;
  height: number;
  color?: string;
  volumePercent?: number;
}> = ({ audioBuffer, sourceStartSec, sourceEndSec, width, height, color = '#818cf8', volumePercent = 100 }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    const centerY = height / 2;
    const volMult = Math.min(2.0, Math.max(0.1, (volumePercent || 100) / 100));

    if (audioBuffer && typeof audioBuffer.getChannelData === 'function') {
      const channelData = audioBuffer.getChannelData(0);
      const sampleRate = audioBuffer.sampleRate;
      const startSample = Math.max(0, Math.floor(sourceStartSec * sampleRate));
      const endSample = Math.min(channelData.length, Math.floor(sourceEndSec * sampleRate));
      const totalSamples = Math.max(1, endSample - startSample);

      const barWidth = 2.0;
      const barGap = 1.2;
      const step = barWidth + barGap;
      const numBars = Math.max(2, Math.floor(width / step));
      const samplesPerBar = Math.floor(totalSamples / numBars);

      ctx.fillStyle = color;

      for (let i = 0; i < numBars; i++) {
        const offset = startSample + i * samplesPerBar;
        let maxPeak = 0;
        const count = Math.min(samplesPerBar, endSample - offset);
        for (let j = 0; j < count; j++) {
          const val = Math.abs(channelData[offset + j]);
          if (val > maxPeak) maxPeak = val;
        }

        const barHeight = Math.max(1.5, Math.min(centerY - 1, (centerY - 2) * maxPeak * 2.4 * volMult));
        const x = i * step;
        ctx.fillRect(x, centerY - barHeight, barWidth, barHeight * 2);
      }
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();
    }
  }, [audioBuffer, sourceStartSec, sourceEndSec, width, height, color, volumePercent]);

  return <canvas ref={canvasRef} width={width} height={height} className="w-full h-full pointer-events-none" />;
};

const OriginalPeaksWaveform: React.FC<{
  peaks: number[];
  width: number;
  height: number;
  volume: number;
  isMuted: boolean;
}> = ({ peaks, width, height, volume, isMuted }) => {
  const tileWidth = 4096;
  const numTiles = Math.max(1, Math.ceil(width / tileWidth));
  const tiles = useMemo(() => Array.from({ length: numTiles }, (_, i) => i), [numTiles]);

  return (
    <div className="relative flex h-full pointer-events-none" style={{ width: `${width}px` }}>
      {tiles.map((tileIdx) => {
        const startX = tileIdx * tileWidth;
        const w = Math.min(tileWidth, Math.max(1, width - startX));
        return (
          <OriginalPeaksTile
            key={tileIdx}
            peaks={peaks}
            totalWidth={width}
            startX={startX}
            tileWidth={w}
            height={height}
            volume={volume}
            isMuted={isMuted}
          />
        );
      })}
    </div>
  );
};

const OriginalPeaksTile: React.FC<{
  peaks: number[];
  totalWidth: number;
  startX: number;
  tileWidth: number;
  height: number;
  volume: number;
  isMuted: boolean;
}> = ({ peaks, totalWidth, startX, tileWidth, height, volume, isMuted }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || tileWidth <= 0 || height <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, tileWidth, height);
    const centerY = height / 2;

    if (!peaks || peaks.length === 0) {
      ctx.strokeStyle = isMuted ? 'rgba(115,115,115,0.25)' : 'rgba(245,158,11,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(tileWidth, centerY);
      ctx.stroke();
      return;
    }

    const barWidth = 2;
    const barGap = 1.5;
    const step = barWidth + barGap;
    const numBars = Math.floor(tileWidth / step);
    const volScale = isMuted ? 0.25 : Math.max(0.2, Math.min(1.8, volume * 1.6));

    ctx.fillStyle = isMuted ? 'rgba(115, 115, 115, 0.35)' : 'rgba(245, 158, 11, 0.55)';

    for (let i = 0; i < numBars; i++) {
      const globalX = startX + i * step;
      const ratioStart = globalX / Math.max(1, totalWidth);
      const ratioEnd = (globalX + step) / Math.max(1, totalWidth);
      const idxStart = Math.max(0, Math.floor(ratioStart * peaks.length));
      const idxEnd = Math.min(peaks.length, Math.max(idxStart + 1, Math.ceil(ratioEnd * peaks.length)));

      let maxPeak = 0;
      for (let p = idxStart; p < idxEnd; p++) {
        const val = Math.abs(peaks[p] || 0);
        if (val > maxPeak) maxPeak = val;
      }

      const barH = Math.max(1.5, Math.min(centerY - 2, maxPeak * (centerY - 3) * volScale));
      ctx.fillRect(i * step, centerY - barH, barWidth, barH * 2);
    }
  }, [peaks, totalWidth, startX, tileWidth, height, volume, isMuted]);

  return <canvas ref={canvasRef} width={tileWidth} height={height} className="shrink-0 h-full" />;
};

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
  overlapRole?: 'main' | 'secondary' | null; // Main (0 dB) vs Secondary (-10 dB) voice in overlapping dialogue
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
  // Two-Stage Auto-Timing Problem Tracking
  timingIssue?: 'overlap' | 'desync' | 'orphan' | null;
  timingIssueText?: string;
  targetSubStartSec?: number;
  targetSubEndSec?: number;
  timeDiffSec?: number;       // Difference in seconds from subtitle start (positive = late, negative = early)
  overlappingClipId?: string;
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

interface TimingPanelProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
  onNavigate?: (tab: 'dashboard' | 'subtitles' | 'qa' | 'timing' | 'mixing' | 'release' | 'telegram' | 'settings' | 'database' | 'cover' | 'stats' | 'archive') => void;
}

export default function TimingPanel({ currentEpisode, onRefresh: _onRefresh, onNavigate }: TimingPanelProps) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [audioClips, setAudioClips] = useState<Record<string, AudioClip[]>>({}); // trackId -> AudioClip[]
  const [collisions, setCollisions] = useState<VoiceCollisionMarker[]>([]);
  const [intentionalOverlaps, setIntentionalOverlaps] = useState<IntentionalOverlapMoment[]>([]);
  const [qaPassportLoaded, setQaPassportLoaded] = useState<{
    loaded: boolean;
    summary: TimingProjectData['summary'];
    savedAt: string;
  } | null>(null);
  const savedPassportRef = useRef<TimingProjectData | null>(null);
  
  // Pipeline status flags
  const [isSilenceRemoved, setIsSilenceRemoved] = useState<boolean>(false);
  const [isFixesStitched, setIsFixesStitched] = useState<boolean>(false);
  const [timingIssues, setTimingIssues] = useState<TimingIssue[]>([]);
  const [missingSubtitles, setMissingSubtitles] = useState<MissingSubtitleMarker[]>([]);
  const [isTimingAnalyzed, setIsTimingAnalyzed] = useState<boolean>(false);
  const [isIssuesDrawerOpen, setIsIssuesDrawerOpen] = useState<boolean>(false);
  const [activeIssueFilter, setActiveIssueFilter] = useState<'all' | 'overlap' | 'desync' | 'missing' | 'orphan'>('all');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [importDecodedTracks, setImportDecodedTracks] = useState<Array<{ id: string; name: string; duration?: number; status: 'pending' | 'decoding' | 'done' | 'error' }>>([]);
  const [trackHeightMode, setTrackHeightMode] = useState<'standard' | 'compact' | 'fit'>('standard');
  const [exportingToMixing, setIsExportingToMixing] = useState<boolean>(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isExportingSE, setIsExportingSE] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [isLogDrawerOpen, setIsLogDrawerOpen] = useState<boolean>(false);
  const [operationLogs, setOperationLogs] = useState<Array<{ time: string; msg: string; level: 'info' | 'success' | 'warn' | 'error' }>>([]);
  const [trackSubLinesMap, setTrackSubLinesMap] = useState<Record<string, SubtitleLine[]>>({});

  // Unified Adaptive Active Process State (surfaces all background & active tasks under header)
  const [activeProcess, setActiveProcess] = useState<{
    title: string;
    detail: string;
    progress: number;
    stepCurrent?: number;
    stepTotal?: number;
  } | null>(null);

  const updateProcess = useCallback((
    title: string,
    detail: string,
    progress: number,
    stepCurrent?: number,
    stepTotal?: number
  ) => {
    const clamped = Math.max(0, Math.min(100, Math.round(progress)));
    setActiveProcess({ title, detail, progress: clamped, stepCurrent, stepTotal });
    setStatusMessage(detail);
    setImportProgress(clamped);
  }, []);

  const clearProcess = useCallback(() => {
    setActiveProcess(null);
    setStatusMessage('');
    setImportProgress(0);
  }, []);

  // Original Video & Floating Draggable Video Window State
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [originalPeaks, setOriginalPeaks] = useState<number[]>([]);
  const [isOriginalMuted, setIsOriginalMuted] = useState<boolean>(false);
  const [isVideoOpen, setIsVideoOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('timing_video_open') !== 'false';
    } catch (e) {
      return true;
    }
  });
  const [videoSize, setVideoSize] = useState<'S' | 'M' | 'L'>(() => {
    try {
      const saved = localStorage.getItem('timing_video_size');
      if (saved === 'S' || saved === 'M' || saved === 'L') return saved;
    } catch (e) {}
    return 'M';
  });
  const [videoPos, setVideoPos] = useState<{ x: number; y: number }>({ x: 280, y: 44 });
  const [draggingVideo, setDraggingVideo] = useState<{
    startMouseX: number;
    startMouseY: number;
    initialX: number;
    initialY: number;
  } | null>(null);
  const videoDragMovedRef = useRef<boolean>(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const handleToggleVideoOpen = () => {
    setIsVideoOpen(prev => {
      const next = !prev;
      try { localStorage.setItem('timing_video_open', String(next)); } catch (e) {}
      return next;
    });
  };

  const handleChangeVideoSize = (sz: 'S' | 'M' | 'L') => {
    setVideoSize(sz);
    try { localStorage.setItem('timing_video_size', sz); } catch (e) {}
  };

  useEffect(() => {
    if (!draggingVideo) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - draggingVideo.startMouseX;
      const dy = e.clientY - draggingVideo.startMouseY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        videoDragMovedRef.current = true;
      }
      const maxX = Math.max(20, window.innerWidth - 180);
      const maxY = Math.max(20, window.innerHeight - 160);
      setVideoPos({
        x: Math.max(8, Math.min(maxX, draggingVideo.initialX + dx)),
        y: Math.max(8, Math.min(maxY, draggingVideo.initialY + dy))
      });
    };
    const onUp = () => setDraggingVideo(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingVideo]);

  // QA Auto-Normalization State (-18 dBFS target RMS + -0.7 dBFS peak limiter)
  const [isAutoNormalize, setIsAutoNormalize] = useState<boolean>(() => {
    try {
      return localStorage.getItem('timing_auto_normalize') !== 'false';
    } catch (e) {
      return true;
    }
  });
  const [normalizationMetrics, setNormalizationMetrics] = useState<Record<string, NormalizationMetrics>>({});

  const handleToggleAutoNormalize = () => {
    setIsAutoNormalize(prev => {
      const next = !prev;
      try { localStorage.setItem('timing_auto_normalize', String(next)); } catch (e) {}
      toast.info(next ? 'Нормализация при воспроизведении включена (-18 dBFS как в QA)' : 'Нормализация при воспроизведении отключена (исходная громкость)');
      return next;
    });
  };

  // Timing & Silence Settings Modal
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [timingSettings, setTimingSettings] = useState<TimingSettings>(() => {
    try {
      const saved = localStorage.getItem('timing_settings');
      if (saved) return { ...DEFAULT_TIMING_SETTINGS, ...JSON.parse(saved) };
    } catch (e) {}
    return DEFAULT_TIMING_SETTINGS;
  });
  const [calibrationsByTrack, setCalibrationsByTrack] = useState<Record<string, NoiseCalibration>>({});

  const handleSaveSettings = (newSettings: TimingSettings) => {
    setTimingSettings(newSettings);
    try {
      localStorage.setItem('timing_settings', JSON.stringify(newSettings));
    } catch (e) {}
    toast.success('Настройки тайминга и удаления тишины сохранены!');
  };

  // Mouse Dragging & Resizing State for Clips (DAW-style trim and expand)
  const [draggingClip, setDraggingClip] = useState<{
    type: 'move' | 'resize-start' | 'resize-end';
    trackId: string;
    clipId: string;
    startMouseX: number;
    initialClipStartSec: number;
    initialDurationSec: number;
    initialSourceStartSec: number;
    initialSourceEndSec: number;
  } | null>(null);

  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);

  // Audio upload helper for missing phrases
  const missingFileInputRef = useRef<HTMLInputElement>(null);
  const [activeMissingMarker, setActiveMissingMarker] = useState<MissingSubtitleMarker | null>(null);

  const handleTriggerUploadMissing = (marker: MissingSubtitleMarker) => {
    setActiveMissingMarker(marker);
    if (missingFileInputRef.current) {
      missingFileInputRef.current.value = '';
      missingFileInputRef.current.click();
    }
  };

  const handleMissingFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeMissingMarker) return;
    const marker = activeMissingMarker;

    try {
      setIsLoading(true);
      updateProcess('Загрузка недостающей реплики', `Декодирование «${file.name}» для «${marker.characterName}»...`, 25, 1, 2);
      const arrayBuf = await file.arrayBuffer();
      const sharedAudioCtx = getSharedAudioContext();
      if (!sharedAudioCtx) throw new Error('AudioContext недоступен');

      const audioBuf = await sharedAudioCtx.decodeAudioData(arrayBuf);
      const audioKey = `${marker.trackId}_uploaded_${marker.id}`;
      audioBuffersRef.current[audioKey] = audioBuf;
      const norm = analyzeAudioBufferForPreview(audioBuf, audioKey);
      setNormalizationMetrics(prev => ({ ...prev, [audioKey]: norm }));

      updateProcess('Загрузка недостающей реплики', `Сохранение файла и вставка на таймкод ${formatSeconds(marker.startSec)}...`, 75, 2, 2);
      let savedPath = (file as any).path || '';
      if (!savedPath) {
        try {
          const safeName = `uploaded_${marker.dubberName}_${Date.now()}_${file.name.replace(/[^\w.-]/g, '_')}`;
          const targetDir = (currentEpisode as any)?.folderPath || 'temp_uploads';
          const saveRes: any = await ipcSafe.invoke('save-file-buffer', {
            buffer: Array.from(new Uint8Array(arrayBuf)),
            targetDir,
            fileName: safeName
          });
          if (saveRes?.path) {
            savedPath = saveRes.path;
          }
        } catch (e) {}
      }

      const newClip: AudioClip = {
        id: `clip_up_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        trackId: marker.trackId,
        dubberName: marker.dubberName,
        characterName: marker.characterName,
        clipStartSec: marker.startSec,
        durationSec: Number(audioBuf.duration.toFixed(3)),
        sourceStartSec: 0,
        sourceEndSec: Number(audioBuf.duration.toFixed(3)),
        rawSourceStartSec: 0,
        rawSourceEndSec: Number(audioBuf.duration.toFixed(3)),
        sourceAudioTrackId: audioKey,
        sourceAudioPath: savedPath || undefined,
        text: marker.text,
        volumePercent: 100,
        offsetSec: 0,
        timingIssue: null
      };

      setAudioClips(prev => ({
        ...prev,
        [marker.trackId]: [...(prev[marker.trackId] || []), newClip].sort((a, b) => a.clipStartSec - b.clipStartSec)
      }));

      setMissingSubtitles(prev => prev.filter(m => m.id !== marker.id));
      setTimingIssues(prev => prev.filter(i => i.id !== `issue_missing_${marker.trackId}_${marker.subId}`));

      addLog(`✓ Реплика «${marker.text.slice(0, 30)}» успешно загружена из «${file.name}» (${audioBuf.duration.toFixed(2)}с) на таймкод ${formatSeconds(marker.startSec)}`, 'success');
      toast.success(`Реплика загружена и вставлена на ${formatSeconds(marker.startSec)}!`);
    } catch (err: any) {
      addLog(`❌ Ошибка загрузки реплики: ${err.message}`, 'error');
      toast.error(`Ошибка загрузки аудио: ${err.message}`);
    } finally {
      setIsLoading(false);
      clearProcess();
      setActiveMissingMarker(null);
    }
  };

  const handleDismissMissing = (markerId: string) => {
    setMissingSubtitles(prev => prev.filter(m => m.id !== markerId));
    setTimingIssues(prev => prev.filter(i => !i.id.includes(markerId)));
    toast.success('Пропущенная реплика скрыта с таймлайна');
  };

  const addLog = useCallback((msg: string, level: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString('ru-RU');
    setOperationLogs(prev => [...prev.slice(-300), { time, msg, level }]);
    if (level === 'error') console.error(`[TimingLog] ${msg}`);
    else if (level === 'warn') console.warn(`[TimingLog] ${msg}`);
    else console.log(`[TimingLog] ${msg}`);
  }, []);

  useEffect(() => {
    const unsub = ipcSafe.on('ffmpeg-progress', (percent: any) => {
      if (typeof percent === 'number') {
        const rounded = Math.max(0, Math.min(100, Math.round(percent)));
        setExportProgress(rounded);
        setActiveProcess(prev => prev ? { ...prev, progress: rounded } : prev);
      }
    });
    return () => {
      if (unsub) unsub();
    };
  }, []);

  // Playback & Zoom Controls
  const [currentTime, setCurrentTime] = useState<number>(0);
  const currentTimeRef = useRef<number>(0);
  const [duration, setDuration] = useState<number>(100);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [zoomLevel, setZoomLevel] = useState<number>(30); // pixels per second

  // Audio Playback
  const [mutedTracks, setMutedTracks] = useState<Set<string>>(new Set());
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [originalVolume, setOriginalVolume] = useState<number>(0.4);

  // Refs for animation & decoded audio buffers
  const playbackRef = useRef<number | null>(null);
  const timelineContainerRef = useRef<HTMLDivElement | null>(null);
  const timeRulerContainerRef = useRef<HTMLDivElement | null>(null);
  const audioElementsRef = useRef<Record<string, HTMLAudioElement>>({});
  const audioBuffersRef = useRef<Record<string, AudioBuffer>>({});
  const trackFileSizesRef = useRef<Record<string, number>>({});
  // Preserved source AudioBuffers for Iterative Self-Healing Final Audit (Fix Priority 1 -> Original Priority 2)
  const origBuffersByTrackRef = useRef<Record<string, { buffer: AudioBuffer; filePath?: string; sourceTrackId: string }>>({});
  const fixBuffersByActorRef = useRef<Record<string, Array<{ buffer: AudioBuffer; filePath?: string; sourceTrackId: string; participant: string }>>>({});

  // Final Self-Healing Verification Report Banner State
  const [finalVerificationReport, setFinalVerificationReport] = useState<{
    totalSubs: number;
    voicedSubs: number;
    recoveredFromFixCount: number;
    recoveredFromOrigCount: number;
    realignedCount: number;
    physicsProtectedCount: number;
    iterationsRun: number;
    unvoicedSubs: MissingSubtitleMarker[];
    passed: boolean;
  } | null>(null);

  // Real-Time Clip WebAudio Scheduler Refs
  const activeClipNodesRef = useRef<Map<string, {
    clipId: string;
    trackId: string;
    source: AudioBufferSourceNode;
    gainNode: GainNode;
    clipStart: number;
    clipEnd: number;
    sourceStart: number;
    sourceEnd: number;
  }>>(new Map());

  const stopAllScheduledClips = useCallback(() => {
    activeClipNodesRef.current.forEach(node => {
      try { node.source.onended = null; node.source.stop(); } catch (e) {}
      try { node.source.disconnect(); } catch (e) {}
      try { node.gainNode.disconnect(); } catch (e) {}
    });
    activeClipNodesRef.current.clear();
  }, []);

  const computeEffectiveClipGain = useCallback((
    trackId: string,
    sourceAudioKey: string,
    clipVolumePercent = 100,
    clipVolumeGainDb = 0
  ): number => {
    const trackVol = volumes[trackId] ?? 1.0;
    const clipVol = (clipVolumePercent ?? 100) / 100;
    const dbMult = clipVolumeGainDb ? Math.pow(10, clipVolumeGainDb / 20) : 1.0;
    const normGain = isAutoNormalize
      ? (normalizationMetrics[sourceAudioKey]?.gain ?? normalizationMetrics[trackId]?.gain ?? 1.0)
      : 1.0;
    return Math.max(0, Math.min(8.0, trackVol * clipVol * dbMult * normGain));
  }, [volumes, isAutoNormalize, normalizationMetrics]);

  const syncRealtimeClipPlayback = useCallback((playheadSec: number, forceReschedule = false) => {
    // 1. Sync Original Video & Audio element
    const vid = videoRef.current;
    if (vid) {
      vid.muted = isOriginalMuted || originalVolume <= 0;
      vid.volume = isOriginalMuted ? 0 : Math.max(0, Math.min(1, originalVolume));
      if (!isPlaying) {
        if (!vid.paused) {
          try { vid.pause(); } catch (e) {}
        }
      } else {
        if (forceReschedule || Math.abs(vid.currentTime - playheadSec) > 0.25) {
          try { vid.currentTime = playheadSec; } catch (e) {}
        }
        if (vid.paused) {
          vid.play().catch(() => {});
        }
      }
    }

    if (!isPlaying) {
      stopAllScheduledClips();
      Object.values(audioElementsRef.current).forEach(a => {
        try { a.pause(); } catch (e) {}
      });
      return;
    }

    // Pause raw uncut HTMLAudioElements for all tracks that have decoded AudioBuffers
    Object.entries(audioElementsRef.current).forEach(([trId, a]) => {
      if (audioBuffersRef.current[trId] || mutedTracks.has(trId)) {
        try { if (!a.paused) a.pause(); } catch (e) {}
      }
    });

    const audioCtx = getSharedAudioContext();
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }

    if (forceReschedule) {
      stopAllScheduledClips();
    }

    // Build lookup of current valid clips on non-muted tracks
    const currentValidClips = new Map<string, { clip: AudioClip; trackId: string }>();
    tracks.forEach(tr => {
      if (mutedTracks.has(tr.id)) return;
      const trClips = audioClips[tr.id] || [];
      for (const c of trClips) {
        currentValidClips.set(c.id, { clip: c, trackId: tr.id });
      }
    });

    // 2. Prune finished, deleted, muted, or modified/moved clips immediately
    activeClipNodesRef.current.forEach((node, clipId) => {
      const entry = currentValidClips.get(clipId);
      if (!entry) {
        try { node.source.onended = null; node.source.stop(); } catch (e) {}
        try { node.source.disconnect(); node.gainNode.disconnect(); } catch (e) {}
        activeClipNodesRef.current.delete(clipId);
        return;
      }
      const { clip } = entry;
      const curStart = clip.clipStartSec + (clip.offsetSec || 0);
      const curEnd = curStart + clip.durationSec;

      const hasTimingMoved =
        Math.abs(node.clipStart - curStart) > 0.015 ||
        Math.abs(node.clipEnd - curEnd) > 0.015 ||
        Math.abs(node.sourceStart - clip.sourceStartSec) > 0.015 ||
        Math.abs(node.sourceEnd - clip.sourceEndSec) > 0.015;

      const isOutOfBounds = curEnd <= playheadSec || curStart > playheadSec + 0.35;

      if (hasTimingMoved || isOutOfBounds) {
        try { node.source.onended = null; node.source.stop(); } catch (e) {}
        try { node.source.disconnect(); node.gainNode.disconnect(); } catch (e) {}
        activeClipNodesRef.current.delete(clipId);
      }
    });

    // 3. Schedule active & upcoming (within 0.25s lookahead) clips and update live gains
    const nowCtx = audioCtx.currentTime;
    currentValidClips.forEach(({ clip, trackId }, clipId) => {
      const clipStart = clip.clipStartSec + (clip.offsetSec || 0);
      const clipEnd = clipStart + clip.durationSec;

      // Only schedule clips overlapping [playheadSec, playheadSec + 0.25]
      if (clipEnd <= playheadSec + 0.01 || clipStart > playheadSec + 0.25) {
        return;
      }

      const sourceKey = clip.sourceAudioTrackId || trackId;
      const targetGain = computeEffectiveClipGain(trackId, sourceKey, clip.volumePercent, clip.volumeGainDb ?? 0);

      const existingNode = activeClipNodesRef.current.get(clipId);
      if (existingNode) {
        try {
          existingNode.gainNode.gain.setTargetAtTime(targetGain, nowCtx, 0.015);
        } catch (e) {
          existingNode.gainNode.gain.value = targetGain;
        }
        return;
      }

      const buf = audioBuffersRef.current[sourceKey];
      if (!buf) {
        // Fallback only if AudioBuffer wasn't decoded yet
        const fallbackAudio = audioElementsRef.current[trackId];
        if (fallbackAudio) {
          try {
            if (Math.abs(fallbackAudio.currentTime - playheadSec) > 0.25) {
              fallbackAudio.currentTime = playheadSec;
            }
            fallbackAudio.volume = Math.max(0, Math.min(1, targetGain));
            if (fallbackAudio.paused) fallbackAudio.play().catch(() => {});
          } catch (e) {}
        }
        return;
      }

      try {
        const source = audioCtx.createBufferSource();
        const gainNode = audioCtx.createGain();
        source.buffer = buf;
        gainNode.gain.value = targetGain;
        source.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        if (playheadSec >= clipStart) {
          const elapsedInClip = playheadSec - clipStart;
          const offsetInBuf = Math.max(0, Math.min(buf.duration - 0.01, clip.sourceStartSec + elapsedInClip));
          const remainingDur = Math.max(0.015, Math.min(clip.durationSec - elapsedInClip, buf.duration - offsetInBuf));
          source.start(0, offsetInBuf, remainingDur);
        } else {
          const delaySec = Math.max(0, clipStart - playheadSec);
          const offsetInBuf = Math.max(0, Math.min(buf.duration - 0.01, clip.sourceStartSec));
          const playDur = Math.max(0.015, Math.min(clip.durationSec, buf.duration - offsetInBuf));
          source.start(nowCtx + delaySec, offsetInBuf, playDur);
        }

        const scheduledNode = {
          clipId,
          trackId,
          source,
          gainNode,
          clipStart,
          clipEnd,
          sourceStart: clip.sourceStartSec,
          sourceEnd: clip.sourceEndSec
        };
        activeClipNodesRef.current.set(clipId, scheduledNode);
        source.onended = () => {
          const cur = activeClipNodesRef.current.get(clipId);
          if (cur && cur.source === source) {
            activeClipNodesRef.current.delete(clipId);
          }
        };
      } catch (e) {
        console.warn('[RealtimeClipScheduler] Failed to schedule clip:', clipId, e);
      }
    });
  }, [isPlaying, tracks, audioClips, mutedTracks, computeEffectiveClipGain, stopAllScheduledClips, isOriginalMuted, originalVolume]);

  const syncRealtimeRef = useRef(syncRealtimeClipPlayback);
  useEffect(() => {
    syncRealtimeRef.current = syncRealtimeClipPlayback;
  }, [syncRealtimeClipPlayback]);

  // Immediately apply clip timing changes, mutes, volumes, or normalization in real time while playing
  useEffect(() => {
    if (isPlaying) {
      syncRealtimeClipPlayback(currentTimeRef.current, false);
    } else if (videoRef.current) {
      videoRef.current.muted = isOriginalMuted || originalVolume <= 0;
      videoRef.current.volume = isOriginalMuted ? 0 : Math.max(0, Math.min(1, originalVolume));
    }
  }, [audioClips, mutedTracks, volumes, isAutoNormalize, normalizationMetrics, isOriginalMuted, originalVolume, isPlaying, syncRealtimeClipPlayback]);

  const seekToTime = useCallback((newTimeSec: number) => {
    const clamped = Math.max(0, Math.min(duration, newTimeSec));
    currentTimeRef.current = clamped;
    setCurrentTime(clamped);
    if (videoRef.current) {
      try { videoRef.current.currentTime = clamped; } catch (e) {}
    }
    if (isPlaying) {
      syncRealtimeRef.current(clamped, true);
    }
  }, [duration, isPlaying]);

  const [aiProcessingTrackId, setAiProcessingTrackId] = useState<string | null>(null);
  const [activeAiMenuTrackId, setActiveAiMenuTrackId] = useState<string | null>(null);

  // Synchronize Horizontal Scrolling from Timeline to Timecode Ruler
  const handleTimelineScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (timeRulerContainerRef.current) {
      timeRulerContainerRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  }, []);

  // Handle mouse wheel scrolling: horizontal scroll with shift or trackpad swipe
  const handleTimelineWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      if (timelineContainerRef.current) {
        timelineContainerRef.current.scrollLeft += (e.deltaX || e.deltaY);
        if (timeRulerContainerRef.current) {
          timeRulerContainerRef.current.scrollLeft = timelineContainerRef.current.scrollLeft;
        }
      }
    }
  }, []);

  // Mouse Dragging & Resizing (DAW Trim/Expand into Silence)
  useEffect(() => {
    if (!draggingClip) return;
    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - draggingClip.startMouseX;
      const deltaSec = deltaX / zoomLevel;

      if (draggingClip.type === 'move') {
        setAudioClips(prev => {
          const trClips = prev[draggingClip.trackId] || [];
          const updated = trClips.map(clip => {
            if (clip.id === draggingClip.clipId) {
              const newStart = Math.max(0, Number((draggingClip.initialClipStartSec + deltaSec).toFixed(2)));
              return { ...clip, clipStartSec: newStart, offsetSec: 0 };
            }
            return clip;
          });
          return { ...prev, [draggingClip.trackId]: updated };
        });
      } else if (draggingClip.type === 'resize-start') {
        const maxBackwardsExpandSec = draggingClip.initialSourceStartSec;
        const clampedDelta = Math.max(-maxBackwardsExpandSec, deltaSec);
        const maxTrimInwards = draggingClip.initialDurationSec - 0.10;
        const finalDelta = Math.min(maxTrimInwards, clampedDelta);

        const newClipStart = Math.max(0, Number((draggingClip.initialClipStartSec + finalDelta).toFixed(2)));
        const newSourceStart = Math.max(0, Number((draggingClip.initialSourceStartSec + finalDelta).toFixed(2)));
        const newDuration = Math.max(0.10, Number((draggingClip.initialDurationSec - finalDelta).toFixed(2)));

        setAudioClips(prev => {
          const trClips = prev[draggingClip.trackId] || [];
          const updated = trClips.map(clip => {
            if (clip.id === draggingClip.clipId) {
              return {
                ...clip,
                clipStartSec: newClipStart,
                sourceStartSec: newSourceStart,
                durationSec: newDuration,
                sourceEndSec: Number((newSourceStart + newDuration).toFixed(2)),
                offsetSec: 0
              };
            }
            return clip;
          });
          return { ...prev, [draggingClip.trackId]: updated };
        });
      } else if (draggingClip.type === 'resize-end') {
        const trackBuffer = audioBuffersRef.current[draggingClip.trackId];
        const maxSourceDuration = trackBuffer ? trackBuffer.duration : 3600;
        const maxForwardsExpandSec = Math.max(0, maxSourceDuration - draggingClip.initialSourceEndSec);

        const clampedDelta = Math.min(maxForwardsExpandSec, deltaSec);
        const maxTrimBackwards = -(draggingClip.initialDurationSec - 0.10);
        const finalDelta = Math.max(maxTrimBackwards, clampedDelta);

        const newDuration = Math.max(0.10, Number((draggingClip.initialDurationSec + finalDelta).toFixed(2)));
        const newSourceEnd = Math.min(maxSourceDuration, Number((draggingClip.initialSourceEndSec + finalDelta).toFixed(2)));

        setAudioClips(prev => {
          const trClips = prev[draggingClip.trackId] || [];
          const updated = trClips.map(clip => {
            if (clip.id === draggingClip.clipId) {
              return {
                ...clip,
                durationSec: newDuration,
                sourceEndSec: newSourceEnd
              };
            }
            return clip;
          });
          return { ...prev, [draggingClip.trackId]: updated };
        });
      }
    };

    const handleMouseUp = () => {
      setDraggingClip(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingClip, zoomLevel]);

  const handleClipMouseDown = (e: React.MouseEvent, trackId: string, clip: AudioClip) => {
    e.stopPropagation();
    setSelectedClipId(clip.id);
    setDraggingClip({
      type: 'move',
      trackId,
      clipId: clip.id,
      startMouseX: e.clientX,
      initialClipStartSec: clip.clipStartSec + (clip.offsetSec || 0),
      initialDurationSec: clip.durationSec,
      initialSourceStartSec: clip.sourceStartSec,
      initialSourceEndSec: clip.sourceEndSec
    });
  };

  const handleResizeMouseDown = (e: React.MouseEvent, trackId: string, clip: AudioClip, edge: 'start' | 'end') => {
    e.stopPropagation();
    setSelectedClipId(clip.id);
    setDraggingClip({
      type: edge === 'start' ? 'resize-start' : 'resize-end',
      trackId,
      clipId: clip.id,
      startMouseX: e.clientX,
      initialClipStartSec: clip.clipStartSec + (clip.offsetSec || 0),
      initialDurationSec: clip.durationSec,
      initialSourceStartSec: clip.sourceStartSec,
      initialSourceEndSec: clip.sourceEndSec
    });
  };

  const handleExpandClip = (trackId: string, clipId: string, side: 'start' | 'end', deltaSec: number) => {
    setAudioClips(prev => {
      const trClips = prev[trackId] || [];
      const trackBuffer = audioBuffersRef.current[trackId];
      const maxSourceDuration = trackBuffer ? trackBuffer.duration : 3600;

      const updated = trClips.map(clip => {
        if (clip.id === clipId) {
          if (side === 'start') {
            const actualDelta = Math.min(clip.sourceStartSec, deltaSec);
            const newClipStart = Math.max(0, Number((clip.clipStartSec - actualDelta).toFixed(2)));
            const newSourceStart = Math.max(0, Number((clip.sourceStartSec - actualDelta).toFixed(2)));
            const newDuration = Number((clip.durationSec + actualDelta).toFixed(2));
            return {
              ...clip,
              clipStartSec: newClipStart,
              sourceStartSec: newSourceStart,
              durationSec: newDuration,
              sourceEndSec: Number((newSourceStart + newDuration).toFixed(2))
            };
          } else {
            const availableEnd = Math.max(0, maxSourceDuration - clip.sourceEndSec);
            const actualDelta = Math.min(availableEnd, deltaSec);
            const newDuration = Number((clip.durationSec + actualDelta).toFixed(2));
            const newSourceEnd = Number((clip.sourceEndSec + actualDelta).toFixed(2));
            return {
              ...clip,
              durationSec: newDuration,
              sourceEndSec: newSourceEnd
            };
          }
        }
        return clip;
      });
      return { ...prev, [trackId]: updated };
    });
    toast.success(`Клип расширен на +${deltaSec}с (${side === 'start' ? 'начало' : 'хвост'})`);
  };

  const handleResetClipToOriginal = (trackId: string, clipId: string) => {
    setAudioClips(prev => {
      const trClips = prev[trackId] || [];
      const updated = trClips.map(clip => {
        if (clip.id === clipId && clip.rawSourceStartSec !== undefined && clip.rawSourceEndSec !== undefined) {
          const origDur = Math.max(0.1, clip.rawSourceEndSec - clip.rawSourceStartSec);
          return {
            ...clip,
            sourceStartSec: clip.rawSourceStartSec,
            sourceEndSec: clip.rawSourceEndSec,
            durationSec: origDur
          };
        }
        return clip;
      });
      return { ...prev, [trackId]: updated };
    });
    toast.info('Границы клипа сброшены к начальной детекции');
  };

  // Delete clip (remove noise, splashes, extra sounds so they are excluded from mixing)
  const handleDeleteClip = (clipId: string, explicitTrackId?: string) => {
    let targetTrackId = explicitTrackId;
    let deletedClip: AudioClip | null = null;

    if (!targetTrackId) {
      for (const trId of Object.keys(audioClips)) {
        const found = (audioClips[trId] || []).find(c => c.id === clipId);
        if (found) {
          targetTrackId = trId;
          deletedClip = found;
          break;
        }
      }
    } else {
      deletedClip = (audioClips[targetTrackId] || []).find(c => c.id === clipId) || null;
    }

    if (!targetTrackId || !deletedClip) return;

    setAudioClips(prev => {
      const trClips = prev[targetTrackId!] || [];
      const updated = trClips.filter(c => c.id !== clipId);
      return { ...prev, [targetTrackId!]: updated };
    });

    if (selectedClipId === clipId) {
      setSelectedClipId(null);
    }

    addLog(`🗑 Удалена фраза/шум: «${deletedClip.text}» (${deletedClip.dubberName}, ${formatSeconds(deletedClip.clipStartSec)}, ${deletedClip.durationSec.toFixed(2)}с). Фраза исключена из монтажа.`, 'info');
    
    toast.success(`Фраза удалена из тайминга и исключена из финального монтажа`, {
      action: {
        label: 'Отменить',
        onClick: () => {
          if (deletedClip && targetTrackId) {
            setAudioClips(prev => {
              const trClips = prev[targetTrackId!] || [];
              const restored = [...trClips, deletedClip!].sort((a, b) => a.clipStartSec - b.clipStartSec);
              return { ...prev, [targetTrackId!]: restored };
            });
            toast.info(`Фраза «${deletedClip.text}» восстановлена`);
            addLog(`↩ Восстановлена фраза «${deletedClip.text}» на дорожке ${deletedClip.dubberName}`, 'info');
          }
        }
      }
    });
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('.group\\/edge') || target.tagName === 'BUTTON') return;
    const lane = e.currentTarget;
    const rect = lane.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const newTime = Math.max(0, Math.min(duration, clickX / zoomLevel));
    seekToTime(newTime);
    addLog(`⏩ Перемещение плейбэка на ${formatSeconds(newTime)}`, 'info');
  };

  const handleTimeRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const ruler = timeRulerContainerRef.current;
    if (!ruler) return;
    const rect = ruler.getBoundingClientRect();
    const clickX = e.clientX - rect.left + ruler.scrollLeft;
    const newTime = Math.max(0, Math.min(duration, clickX / zoomLevel));
    seekToTime(newTime);
    addLog(`⏩ Перемещение плейбэка на ${formatSeconds(newTime)}`, 'info');
  };

  // Spacebar Key Listener for Play / Pause & Delete/Backspace to delete selected clip
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (isInput) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying(prev => {
          const next = !prev;
          addLog(next ? `▶ Воспроизведение запущено` : `⏸ Воспроизведение остановлено`, 'info');
          return next;
        });
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        if (selectedClipId) {
          e.preventDefault();
          handleDeleteClip(selectedClipId);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedClipId, audioClips, addLog]);

  // Real-Time Clip Audio & Video Playback Loop
  useEffect(() => {
    if (!isPlaying) {
      if (playbackRef.current) cancelAnimationFrame(playbackRef.current);
      stopAllScheduledClips();
      if (videoRef.current && !videoRef.current.paused) {
        try { videoRef.current.pause(); } catch (e) {}
      }
      Object.values(audioElementsRef.current).forEach(audio => {
        try { audio.pause(); } catch (e) {}
      });
      return;
    }

    // Initial schedule at current playhead
    syncRealtimeRef.current(currentTimeRef.current, true);

    let lastTimestamp = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastTimestamp) / 1000;
      lastTimestamp = now;

      const next = currentTimeRef.current + dt;
      if (next >= duration) {
        currentTimeRef.current = 0;
        setCurrentTime(0);
        setIsPlaying(false);
        stopAllScheduledClips();
        if (videoRef.current) {
          try { videoRef.current.pause(); videoRef.current.currentTime = 0; } catch (e) {}
        }
        addLog(`⏹ Достигнут конец таймлайна (${formatSeconds(duration)})`, 'info');
        return;
      }

      currentTimeRef.current = next;
      setCurrentTime(next);
      syncRealtimeRef.current(next, false);

      playbackRef.current = requestAnimationFrame(tick);
    };

    playbackRef.current = requestAnimationFrame(tick);

    return () => {
      if (playbackRef.current) cancelAnimationFrame(playbackRef.current);
      stopAllScheduledClips();
      if (videoRef.current && !videoRef.current.paused) {
        try { videoRef.current.pause(); } catch (e) {}
      }
      Object.values(audioElementsRef.current).forEach(audio => {
        try { audio.pause(); } catch (e) {}
      });
    };
  }, [isPlaying, duration, addLog, stopAllScheduledClips]);

  // Load Subtitles, Original Video & Dubber Tracks from Episode
  const loadEpisodeData = useCallback(async (isImportFlow = false) => {
    if (!currentEpisode) return;
    try {
      setIsLoading(true);
      if (!isImportFlow) {
        updateProcess(
          'Загрузка проекта тайминга',
          'Чтение субтитров серии...',
          5,
          1,
          5
        );
      }
      addLog(`=== Начало загрузки тайминга серии #${currentEpisode.number} (${currentEpisode.project?.title || 'Проект'}) ===`, 'info');

      // 1. Load Subtitles
      let parsedLines: SubtitleLine[] = [];
      const subPath = currentEpisode.subPath;
      if (subPath) {
        const subData = await ipcSafe.invoke('get-raw-subtitles', subPath).catch(() => null);
        if (subData && subData.lines) {
          parsedLines = subData.lines.map((l: any, idx: number) => ({
            id: `sub_${idx}`,
            rawLineIndex: l.rawLineIndex ?? idx,
            startSec: parseTimeToSeconds(l.start),
            endSec: parseTimeToSeconds(l.end),
            startFormatted: l.start || '00:00.00',
            endFormatted: l.end || '00:00.00',
            name: l.name || 'Default',
            text: l.text || '',
            style: l.style || 'Default'
          }));
          const maxSubTime = parsedLines.reduce((max, l) => Math.max(max, l.endSec), 10);
          setDuration(prev => Math.max(prev, maxSubTime + 10));
          addLog(`✓ Успешно распарсено ${parsedLines.length} строк субтитров.`, 'success');
        }
      }

      // 1B. Load Original Video & Extract Original Audio Waveform Peaks
      if (currentEpisode.rawPath) {
        if (!isImportFlow) {
          updateProcess(
            'Подготовка оригинала серии',
            'Подключение видеопотока и извлечение вейвформы оригинала...',
            14,
            2,
            5
          );
        }
        const resolvedVideo = await getPlayableAudioUrl(currentEpisode.rawPath);
        if (resolvedVideo) {
          setVideoUrl(resolvedVideo);
          addLog(`🎬 Подключено оригинальное видео и аудио серии: ${currentEpisode.rawPath.split(/[/\\]/).pop()}`, 'success');
        }
        try {
          const peaksRes: any = await ipcSafe.invoke('extract-audio-peaks', {
            videoPath: currentEpisode.rawPath,
            filePath: currentEpisode.rawPath,
            pointsPerSecond: 5
          });
          const extractedPeaks = Array.isArray(peaksRes)
            ? peaksRes
            : (peaksRes && Array.isArray(peaksRes.peaks) ? peaksRes.peaks : []);
          if (extractedPeaks.length > 0) {
            setOriginalPeaks(extractedPeaks);
            if (peaksRes && typeof peaksRes.duration === 'number' && peaksRes.duration > 0) {
              setDuration(prev => Math.max(prev, peaksRes.duration));
            }
          }
        } catch (e) {}
      } else {
        setVideoUrl(null);
        setOriginalPeaks([]);
      }

      if (!isImportFlow) {
        updateProcess(
          'Загрузка проекта тайминга',
          'Получение списка дорожек дабберов...',
          22,
          3,
          5
        );
      }

      // 2. Fetch Dubber Tracks from Manifest or Sound Engineer Files
      const statusRes: any = await ipcSafe.invoke('mixing-get-status', { episode: currentEpisode }).catch(() => null);
      let manifestDubberTracks = statusRes?.manifest?.sourceFiles?.dubberTracks || [];

      if (manifestDubberTracks.length === 0) {
        updateProcess(
          'Сборка дорожек из QA',
          'Экспорт и сборка файлов звукорежиссера из QA...',
          28,
          3,
          5
        );
        const importRes: any = await ipcSafe.invoke('mixing-import-sound-engineer-files', {
          episode: currentEpisode,
          autoApplyFixes: false,
          autoTiming: false
        }).catch(() => null);

        if (importRes?.manifest?.sourceFiles?.dubberTracks) {
          manifestDubberTracks = importRes.manifest.sourceFiles.dubberTracks;
        }
      }

      // Filter manifest tracks to exclude intermediate pipeline renders or numeric artifacts (e.g. 01_denoise..., 0 3 4)
      const cleanManifestTracks = manifestDubberTracks.filter((dt: any) => {
        const p = dt.path || '';
        const base = p.split(/[/\\]/).pop() || '';
        if (base.toLowerCase().includes('slice') || base.toLowerCase().includes('temp_') || base.toLowerCase().includes('snippet')) {
          return false;
        }
        if (/^(0[1-9]|1[0-9])_(denoise|deepfilter|glue|compress|master|video_mux|eq|limiter|reverb|delay|mix)/i.test(base) || /^[\d\s._-]+$/.test(base.replace(/\.[^.]+$/, ''))) {
          return false;
        }
        if (/master|glue|denoise|deepfilter|mix|compress|release|original_audio/i.test(base)) {
          return false;
        }
        const nick = (dt.dubberNick || '').trim();
        if (!nick || /^[\d\s._-]+$/.test(nick)) {
          return false;
        }
        return true;
      });

      const rawFetched = prepareQATracksForTiming(currentEpisode, cleanManifestTracks);
      const fetchedTracks: Track[] = [];
      for (const tr of rawFetched) {
        fetchedTracks.push(tr);
        if ((tr as any).patchSnippet && (tr as any).patchSnippet.path) {
          const snip = (tr as any).patchSnippet;
          fetchedTracks.push({
            id: `${tr.id}_fix`,
            targetMainTrackId: tr.id,
            projectId: tr.projectId,
            episodeId: tr.episodeId,
            participant: `${tr.participant} (Фикс)`,
            character: tr.character,
            dubberName: tr.dubberName,
            characterName: tr.characterName,
            filePath: snip.path,
            role: 'fix',
            status: 'fixes_needed',
            files: [{ id: snip.id || `${tr.id}_fix_file`, path: snip.path, createdAt: '', type: 'FIXES', isFix: true, targetTrackId: tr.id }],
            selectedFileId: snip.id || `${tr.id}_fix_file`,
            comments: tr.comments || []
          } as any);
        }
      }

      setTracks(fetchedTracks);
      addLog(`Загружено ${fetchedTracks.length} уникальных мастер-дорожек дабберов (без дублирования и с приоритетом чистовых фиксов).`, fetchedTracks.length > 0 ? 'success' : 'warn');

      // 3. Decode Real AudioBuffers & Calculate QA Auto-Normalization for Every Track with Progress Bar updates
      const sharedAudioCtx = getSharedAudioContext();
      const tracksToDecode = fetchedTracks.filter(t => t.filePath);
      const computedNormMetrics: Record<string, NormalizationMetrics> = {};
      
      setImportDecodedTracks(tracksToDecode.map(t => ({
        id: t.id,
        name: t.participant,
        status: 'pending'
      })));

      let decodedIdx = 0;
      for (const tr of fetchedTracks) {
        if (tr.filePath) {
          decodedIdx++;
          const startPct = isImportFlow ? 45 : 30;
          const pctSpan = isImportFlow ? 45 : 58;
          const curPct = Math.round(startPct + (pctSpan * decodedIdx / Math.max(1, tracksToDecode.length)));
          updateProcess(
            'Декодирование аудиоволн и нормализация',
            `Декодирование [${decodedIdx}/${tracksToDecode.length}]: «${tr.participant}» (${curPct}%)...`,
            curPct,
            decodedIdx,
            tracksToDecode.length
          );

          setImportDecodedTracks(prev => prev.map(item => 
            item.id === tr.id ? { ...item, status: 'decoding' } : item
          ));

          const playableUrl = await getPlayableAudioUrl(tr.filePath);
          if (playableUrl) {
            const audio = new Audio(playableUrl);
            audio.preload = 'metadata';
            audioElementsRef.current[tr.id] = audio;

            try {
              const resp = await fetch(playableUrl);
              const arrayBuf = await resp.arrayBuffer();
              // Capture byteLength BEFORE decodeAudioData detaches/transfers the ArrayBuffer!
              const fileByteLength = arrayBuf.byteLength || tr.fileSize || (tr.files?.[0]?.size) || 0;
              trackFileSizesRef.current[tr.id] = fileByteLength;
              if (sharedAudioCtx) {
                const decodedBuf = await sharedAudioCtx.decodeAudioData(arrayBuf);
                audioBuffersRef.current[tr.id] = decodedBuf;
                // Preserve source AudioBuffers in dedicated refs so Iterative Self-Healing Audit
                // can always search Fix Track (Priority 1) and Original Track (Priority 2)
                if (isFixTrack(tr)) {
                  const actorNorm = normalizeName(tr.dubberName || tr.participant || 'Даббер');
                  if (!fixBuffersByActorRef.current[actorNorm]) {
                    fixBuffersByActorRef.current[actorNorm] = [];
                  }
                  const existingIdx = fixBuffersByActorRef.current[actorNorm].findIndex(f => f.sourceTrackId === tr.id);
                  const entry = {
                    buffer: decodedBuf,
                    filePath: tr.filePath,
                    sourceTrackId: tr.id,
                    participant: tr.participant || tr.dubberName || 'Фикс'
                  };
                  if (existingIdx >= 0) fixBuffersByActorRef.current[actorNorm][existingIdx] = entry;
                  else fixBuffersByActorRef.current[actorNorm].push(entry);
                } else {
                  const origKey = `orig_${tr.id}`;
                  audioBuffersRef.current[origKey] = decodedBuf;
                  origBuffersByTrackRef.current[tr.id] = {
                    buffer: decodedBuf,
                    filePath: tr.filePath,
                    sourceTrackId: origKey
                  };
                }

                setDuration(prev => Math.max(prev, decodedBuf.duration));
                // Compute QA preview normalization (-18 dBFS RMS target, -0.7 dBFS peak ceiling)
                const norm = analyzeAudioBufferForPreview(decodedBuf, tr.id);
                computedNormMetrics[tr.id] = norm;
                addLog(`📈 Аудиоволна декодирована для «${tr.participant}» (${decodedBuf.duration.toFixed(1)}s, ${(fileByteLength / (1024*1024)).toFixed(1)} МБ, норм.: ${norm.gainDb >= 0 ? '+' : ''}${norm.gainDb} dB)`, 'success');
                setImportDecodedTracks(prev => prev.map(item => 
                  item.id === tr.id ? { ...item, status: 'done', duration: decodedBuf.duration } : item
                ));
              }
            } catch (decodeErr) {
              console.warn(`[AudioDecode] Не удалось декодировать аудио для ${tr.id}:`, decodeErr);
              try {
                const fallbackNorm = await analyzeAudioForPreview(playableUrl, tr.id, tr.filePath);
                computedNormMetrics[tr.id] = fallbackNorm;
              } catch (e) {}
              setImportDecodedTracks(prev => prev.map(item => 
                item.id === tr.id ? { ...item, status: 'error' } : item
              ));
            }
          }
        }
      }

      // 3B. Keep both Main Track and Fix Track visible on initial load so the user can inspect both
      // and run «Удалить тишину» ➔ «Вшить фиксы» (which classifies Scenario 1 Full Replacement vs Scenario 2 Targeted Fix).
      for (const fixTr of fetchedTracks.filter(t => isFixTrack(t))) {
        const mainTr = fetchedTracks.find(t => !isFixTrack(t) && (t.id === (fixTr as any).targetMainTrackId || t.id === fixTr.id.replace(/_fix$/, '') || normalizeName(t.dubberName) === normalizeName(fixTr.dubberName)));
        if (!mainTr) continue;
        const fixBuf = audioBuffersRef.current[fixTr.id];
        const mainBuf = audioBuffersRef.current[mainTr.id];

        if (fixBuf && mainBuf) {
          const fixIvs = detectSpeechIntervals(fixBuf);
          const mainIvs = detectSpeechIntervals(mainBuf);
          addLog(
            `🛠 Дорожка фикса «${fixTr.participant}» подготовлена (${fixIvs.length} речевых фраз в фиксе vs ${mainIvs.length} в основной дорожке) — готова к операции «Вшить фиксы».`,
            'info'
          );
        }
      }

      setNormalizationMetrics(computedNormMetrics);

      updateProcess(
        'Формирование таймлайна',
        'Привязка субтитров и проверка паспорта QA...',
        95,
        5,
        5
      );

      // 4. Map Subtitles and Initialize Initial Audio Clips (continuous full file before silence cut)
      const initialClips: Record<string, AudioClip[]> = {};
      const trackSubMap: Record<string, SubtitleLine[]> = {};

      // Group tracks by actor to distribute overlapping lines (Layer 2) and fixes cleanly
      const tracksByActor: Record<string, Track[]> = {};
      fetchedTracks.forEach(tr => {
        const actorKey = tr.dubberName || 'Даббер';
        if (!tracksByActor[actorKey]) tracksByActor[actorKey] = [];
        tracksByActor[actorKey].push(tr);
      });

      const projectAliases = currentEpisode.project?.characterAliases
        ? (typeof currentEpisode.project.characterAliases === 'string'
            ? JSON.parse(currentEpisode.project.characterAliases || '{}')
            : currentEpisode.project.characterAliases)
        : undefined;

      const allMappedSubIds = new Set<string>();

      Object.entries(tracksByActor).forEach(([actorNick, actorTrks]) => {
        const firstTrk = actorTrks[0];
        const charName = firstTrk.character || firstTrk.characterName || 'Персонаж';

        let matchedLines = parsedLines.filter(line => 
          isSubtitleForCharacter(line.name, charName, actorNick, currentEpisode.assignments || [], line.style, projectAliases)
        ).sort((a, b) => a.startSec - b.startSec);

        if (matchedLines.length === 0 && (charName !== 'Персонаж' || actorNick !== 'Даббер')) {
          const normC = normalizeName(charName);
          const normD = normalizeName(actorNick);
          matchedLines = parsedLines.filter(line => {
            const normSub = normalizeName(line.name);
            const normStyle = normalizeName(line.style);
            return (normC && (normSub === normC || normSub.includes(normC) || normStyle === normC || normStyle.includes(normC))) ||
                   (normD && (normSub === normD || normSub.includes(normD) || normStyle === normD || normStyle.includes(normD)));
          }).sort((a, b) => a.startSec - b.startSec);
        }

        matchedLines.forEach(l => allMappedSubIds.add(String(l.id)));

        const mainTracks = actorTrks.filter(t => !isFixTrack(t));
        const fixTracks = actorTrks.filter(t => isFixTrack(t));

        if (mainTracks.length >= 2) {
          const primaryLines: SubtitleLine[] = [];
          const overlapLines: SubtitleLine[] = [];

          matchedLines.forEach((line) => {
            const prevPrimary = primaryLines[primaryLines.length - 1];
            if (prevPrimary && line.startSec < prevPrimary.endSec) {
              overlapLines.push(line);
            } else {
              primaryLines.push(line);
            }
          });

          trackSubMap[mainTracks[0].id] = primaryLines;
          trackSubMap[mainTracks[1].id] = overlapLines;
        } else if (mainTracks.length === 1) {
          trackSubMap[mainTracks[0].id] = matchedLines;
        } else if (mainTracks.length === 0 && fixTracks.length > 0) {
          trackSubMap[fixTracks[0].id] = matchedLines;
        }

        if (fixTracks.length > 0 && mainTracks.length > 0) {
          const actorAssigns = (currentEpisode.assignments || []).filter(a => {
            const aNick = a.substitute?.nickname || a.dubber?.nickname || '';
            return normalizeName(aNick) === normalizeName(actorNick);
          });
          const commentTimestamps: number[] = [];
          actorAssigns.forEach(a => {
            if (a.comments) {
              try {
                const parsedComments = JSON.parse(a.comments);
                if (Array.isArray(parsedComments)) {
                  parsedComments.forEach(c => {
                    if (typeof c.timestamp === 'number') commentTimestamps.push(c.timestamp);
                  });
                }
              } catch (e) {}
            }
          });

          let candidateFixLines = commentTimestamps.length > 0
            ? matchedLines.filter(l => commentTimestamps.some(ts => Math.abs(l.startSec - ts) < 3.5 || (ts >= l.startSec && ts <= l.endSec)))
            : [];

          if (candidateFixLines.length === 0) {
            candidateFixLines = matchedLines.slice(0, Math.min(3, matchedLines.length));
          }

          if (fixTracks.length === 1) {
            trackSubMap[fixTracks[0].id] = candidateFixLines;
          } else {
            const mid = Math.ceil(candidateFixLines.length / 2);
            trackSubMap[fixTracks[0].id] = candidateFixLines.slice(0, mid);
            trackSubMap[fixTracks[1].id] = candidateFixLines.slice(mid);
          }
        }
      });

      const unmatchedDialogueLines = parsedLines.filter(l => {
        if (allMappedSubIds.has(String(l.id))) return false;
        const normName = normalizeName(l.name);
        const normStyle = normalizeName(l.style);
        return !['sign', 'text', 'title', 'signs', 'titles', 'надпись', 'титры', 'заставка', 'note', 'info'].some(k => normName.includes(k) || normStyle.includes(k));
      });

      if (unmatchedDialogueLines.length > 0 && fetchedTracks.length > 0) {
        unmatchedDialogueLines.forEach(l => {
          const normLName = normalizeName(l.name);
          const normLStyle = normalizeName(l.style);
          let targetTrack = fetchedTracks.find(t => {
            const trChar = normalizeName(t.character || t.characterName || '');
            const trNick = normalizeName(t.participant || t.dubberName || '');
            return (normLName && (trChar.includes(normLName) || normLName.includes(trChar) || trNick.includes(normLName) || normLName.includes(trNick))) ||
                   (normLStyle && (trChar.includes(normLStyle) || normLStyle.includes(trChar)));
          });

          if (!targetTrack) {
            targetTrack = fetchedTracks[0];
          }

          if (targetTrack) {
            if (!trackSubMap[targetTrack.id]) trackSubMap[targetTrack.id] = [];
            trackSubMap[targetTrack.id].push(l);
            trackSubMap[targetTrack.id].sort((a, b) => a.startSec - b.startSec);
            allMappedSubIds.add(String(l.id));
          }
        });
      }

      addLog(`✓ Привязано ${allMappedSubIds.size} из ${parsedLines.length} строк субтитров к дорожкам актеров.`, 'success');

      fetchedTracks.forEach(tr => {
        const charName = tr.character || tr.characterName || 'Персонаж';
        const dubberName = tr.participant || tr.dubberName || 'Даббер';
        const trSubs = trackSubMap[tr.id] || [];
        const trackBuf = audioBuffersRef.current[tr.id];
        const trackDur = trackBuf ? trackBuf.duration : (trSubs[trSubs.length - 1]?.endSec || 100);

        initialClips[tr.id] = [{
          id: `clip_${tr.id}_full`,
          trackId: tr.id,
          dubberName,
          characterName: charName,
          clipStartSec: 0,
          durationSec: trackDur,
          sourceStartSec: 0,
          sourceEndSec: trackDur,
          text: `Полная запись: ${dubberName}`,
          volumePercent: 100,
          isFix: isFixTrack(tr),
          hasCollision: false,
          offsetSec: 0
        }];
      });

      setTrackSubLinesMap(trackSubMap);
      setAudioClips(initialClips);

      // Check for saved QA Timing Project Passport
      try {
        const savedProject = await loadTimingProjectForEpisode(currentEpisode, fetchedTracks);
        if (savedProject && (
          (savedProject.collisions && savedProject.collisions.length > 0) ||
          (savedProject.timingIssues && savedProject.timingIssues.length > 0) ||
          (savedProject.missingSubtitles && savedProject.missingSubtitles.length > 0)
        )) {
          savedPassportRef.current = savedProject;
          setCollisions(savedProject.collisions || []);
          setTimingIssues(savedProject.timingIssues || []);
          setMissingSubtitles(savedProject.missingSubtitles || []);
          setIsTimingAnalyzed(true);
          setIsIssuesDrawerOpen((savedProject.timingIssues?.length || 0) > 0);

          const markedClips = applyTimingPassportToClips(initialClips, savedProject);
          setAudioClips(markedClips);

          setQaPassportLoaded({
            loaded: true,
            summary: savedProject.summary,
            savedAt: savedProject.savedAt
          });

          addLog(
            `📋 Подхвачен паспорт QA проверки! Замечаний: ${savedProject.summary.totalGaps} (наездов: ${savedProject.summary.overlapsCount}, коллизий: ${savedProject.summary.collisionsCount}, рассинхронов: ${savedProject.summary.desyncCount}, пропусков: ${savedProject.summary.missingCount}). Повторная перепроверка не требуется!`,
            'success'
          );
        }
      } catch (passportErr) {
        console.warn('Failed to auto-load QA timing passport:', passportErr);
      }

      if (fetchedTracks.length > 0) {
        toast.success(`Загружено ${fetchedTracks.length} дорожек дабберов с реальными аудиоволнами и нормализацией!`);
      }
    } catch (err: any) {
      addLog(`❌ Ошибка загрузки данных тайминга: ${err.message || String(err)}`, 'error');
      toast.error(`Ошибка загрузки: ${err.message || String(err)}`);
    } finally {
      setIsLoading(false);
      if (!isImportFlow) {
        clearProcess();
      }
    }
  }, [currentEpisode, addLog, updateProcess, clearProcess]);

  const handleSyncFromQA = async () => {
    if (!currentEpisode) return;
    try {
      setIsLoading(true);
      updateProcess('Синхронизация с QA', 'Загрузка паспорта QA проверки...', 40, 1, 2);
      const savedProject = await loadTimingProjectForEpisode(currentEpisode, tracks);
      updateProcess('Синхронизация с QA', 'Применение меток замечаний к клипам таймлайна...', 85, 2, 2);
      if (savedProject && (
        (savedProject.collisions && savedProject.collisions.length > 0) ||
        (savedProject.timingIssues && savedProject.timingIssues.length > 0) ||
        (savedProject.missingSubtitles && savedProject.missingSubtitles.length > 0)
      )) {
        savedPassportRef.current = savedProject;
        setCollisions(savedProject.collisions || []);
        setTimingIssues(savedProject.timingIssues || []);
        setMissingSubtitles(savedProject.missingSubtitles || []);
        setIsTimingAnalyzed(true);
        setIsIssuesDrawerOpen((savedProject.timingIssues?.length || 0) > 0);

        setAudioClips(prev => applyTimingPassportToClips(prev, savedProject));

        setQaPassportLoaded({
          loaded: true,
          summary: savedProject.summary,
          savedAt: savedProject.savedAt
        });

        addLog(
          `✓ Синхронизация с QA завершена: загружено замечаний — ${savedProject.summary.totalGaps} (наездов — ${savedProject.summary.overlapsCount}, коллизий — ${savedProject.summary.collisionsCount}, рассинхронов — ${savedProject.summary.desyncCount}).`,
          'success'
        );
        toast.success(`Синхронизировано с QA! Загружено замечаний: ${savedProject.summary.totalGaps}`);
      } else {
        toast.info('В QA проверке пока нет сохраненных замечаний или проверка еще не запускалась.');
      }
    } catch (err: any) {
      toast.error('Ошибка синхронизации с QA: ' + (err?.message || String(err)));
    } finally {
      setIsLoading(false);
      clearProcess();
    }
  };

  useEffect(() => {
    loadEpisodeData();
  }, [currentEpisode?.id]);

  // PIPELINE STEP 1: Import all tracks from QA
  const handleImportFromQA = async () => {
    if (!currentEpisode) return;
    try {
      setIsLoading(true);
      setIsImporting(true);
      updateProcess('1. Импорт дорожек из QA', 'Сборка и экспорт файлов дорожек из QA...', 5, 1, 2);
      addLog('Запуск импорта и подготовки дорожек из QA...', 'info');

      const unsub = ipcSafe.on('mixing-progress', (p: any) => {
        if (p && typeof p.percent === 'number') {
          const scaled = Math.min(42, Math.round(5 + p.percent * 0.37));
          updateProcess(
            '1. Импорт дорожек из QA',
            p.message ? `1/2. ${p.message}` : 'Сборка файлов звукорежиссёра...',
            scaled,
            1,
            2
          );
        }
      });

      try {
        await ipcSafe.invoke('mixing-import-sound-engineer-files', {
          episode: currentEpisode,
          autoApplyFixes: false,
          autoTiming: false
        });
      } finally {
        if (typeof unsub === 'function') unsub();
      }

      updateProcess('1. Импорт дорожек из QA', '2/2. Загрузка и декодирование аудиоволн на таймлайн...', 45, 2, 2);
      await loadEpisodeData(true);
      updateProcess('1. Импорт дорожек из QA', 'Импорт дорожек успешно завершён!', 100, 2, 2);
      toast.success('Импорт дорожек выполнен! Исходные файлы загружены в тайминг.');
    } catch (err: any) {
      addLog(`❌ Ошибка импорта: ${err.message || String(err)}`, 'error');
      toast.error(`Ошибка импорта: ${err.message || String(err)}`);
    } finally {
      setTimeout(() => {
        setIsLoading(false);
        setIsImporting(false);
        clearProcess();
      }, 400);
    }
  };
  // PIPELINE STEP 3: "Удалить тишину" — Real VAD Silence Cutting with Noise Floor Auto-Calibration on ALL tracks
  const handleCutSilence = async () => {
    if (tracks.length === 0) {
      toast.error('Нет загруженных дорожек');
      return;
    }
    try {
      setIsLoading(true);
      updateProcess('3. Удаление тишины и калибровка', 'Авто-калибровка шума и нарезка речевых фраз...', 5, 0, tracks.length);
      addLog('Запуск анализа энергии аудиосигнала и авто-калибровки шума/тишины перед нарезкой...', 'info');

      const updatedClips: Record<string, AudioClip[]> = {};
      let totalClips = 0;
      const newCalibrations: Record<string, NoiseCalibration> = {};

      for (let tIdx = 0; tIdx < tracks.length; tIdx++) {
        const track = tracks[tIdx];
        let audioBuf = audioBuffersRef.current[track.id];
        const dubberName = track.participant || track.dubberName || 'Даббер';
        const characterName = track.character || track.characterName || 'Персонаж';
        const trSubs = trackSubLinesMap[track.id] || [];

        const pct = Math.round(((tIdx + 0.5) / Math.max(1, tracks.length)) * 95);
        updateProcess(
          '3. Удаление тишины и калибровка',
          `Калибровка шума и нарезка фраз [${tIdx + 1}/${tracks.length}]: «${dubberName}»...`,
          pct,
          tIdx + 1,
          tracks.length
        );
        await new Promise(r => setTimeout(r, 0));

        // Ensure audio buffer is decoded in memory so live adaptive per-track + subtitle-guided calibration runs
        if (!audioBuf && track.filePath) {
          try {
            const pUrl = await getPlayableAudioUrl(track.filePath);
            if (pUrl) {
              const resp = await fetch(pUrl);
              const arrayBuf = await resp.arrayBuffer();
              const sharedAudioCtx = getSharedAudioContext();
              if (sharedAudioCtx) {
                audioBuf = await sharedAudioCtx.decodeAudioData(arrayBuf);
                audioBuffersRef.current[track.id] = audioBuf;
              }
            }
          } catch (decodeErr) {
            console.warn(`[SilenceCut] Ошибка декодирования ${track.id}:`, decodeErr);
          }
        }

        if (audioBuf) {
          const subLinesForVad = !isFixTrack(track)
            ? trSubs
            : (tracks.find(t => !isFixTrack(t) && normalizeName(t.dubberName) === normalizeName(track.dubberName))
                ? (trackSubLinesMap[tracks.find(t => !isFixTrack(t) && normalizeName(t.dubberName) === normalizeName(track.dubberName))!.id] || trSubs)
                : trSubs);

          const intervals = detectSpeechIntervals(audioBuf, {
            minSilenceDurationSec: timingSettings.minSilenceDurationSec,
            leadInPaddingSec: timingSettings.leadInPaddingSec,
            leadOutPaddingSec: timingSettings.leadOutPaddingSec,
            minSpeechDurationSec: timingSettings.minSpeechDurationSec,
            mergeCloseGapsSec: timingSettings.mergeCloseGapsSec,
            manualThresholdDb: timingSettings.autoAnalyzeNoiseFloor ? undefined : timingSettings.silenceThresholdDb,
            subLines: subLinesForVad,
            onCalibration: (calib) => {
              newCalibrations[track.id] = calib;
              const normGain = normalizationMetrics[track.id]?.gainDb;
              const normInfo = normGain !== undefined ? `, Усиление норм.: ${normGain >= 0 ? '+' : ''}${normGain} dB` : '';
              addLog(`📊 Авто-калибровка «${dubberName}»: Шум: ${calib.noiseFloorDb} dB, Речь: ${calib.speechFloorDb} dB, Порог: ${calib.calculatedThresholdDb} dB${normInfo} (Запас: ${Math.round(timingSettings.leadInPaddingSec * 1000)}/${Math.round(timingSettings.leadOutPaddingSec * 1000)} мс)`, 'info');
            }
          });

          addLog(`🎙 Дорожка «${dubberName}»: обнаружено ${intervals.length} полезных речевых фраз (от тишины до тишины).`, 'info');

          const assignedSubsForCut = new Set<number>();
          const matchedSubByIv = new Array<SubtitleLine | undefined>(intervals.length).fill(undefined);
          const cutPairs: Array<{ ivIdx: number; sIdx: number; diff: number }> = [];
          intervals.forEach((iv, ivIdx) => {
            trSubs.forEach((s, sIdx) => {
              const diff = Math.abs(s.startSec - iv.startSec);
              if (diff <= 2.2) {
                cutPairs.push({ ivIdx, sIdx, diff });
              }
            });
          });
          cutPairs.sort((a, b) => a.diff - b.diff);
          for (const pair of cutPairs) {
            if (matchedSubByIv[pair.ivIdx] || assignedSubsForCut.has(pair.sIdx)) continue;
            matchedSubByIv[pair.ivIdx] = trSubs[pair.sIdx];
            assignedSubsForCut.add(pair.sIdx);
          }

          updatedClips[track.id] = intervals.map((iv, idx) => {
            const matchingSub = matchedSubByIv[idx];

            totalClips++;
            return {
              id: `clip_${track.id}_${idx}`,
              trackId: track.id,
              dubberName,
              characterName,
              clipStartSec: iv.startSec,
              durationSec: iv.durationSec,
              sourceStartSec: iv.startSec,
              sourceEndSec: iv.endSec,
              rawSourceStartSec: iv.startSec,
              rawSourceEndSec: iv.endSec,
              sourceAudioPath: track.filePath,
              text: matchingSub?.text || `Фраза ${idx + 1}`,
              volumePercent: 100,
              isFix: isFixTrack(track),
              hasCollision: false,
              offsetSec: 0
            };
          });
        } else {
          updatedClips[track.id] = trSubs.map((sub, idx) => {
            totalClips++;
            return {
              id: `clip_${track.id}_${idx}`,
              trackId: track.id,
              dubberName,
              characterName,
              clipStartSec: sub.startSec,
              durationSec: Math.max(0.4, sub.endSec - sub.startSec),
              sourceStartSec: sub.startSec,
              sourceEndSec: sub.endSec,
              rawSourceStartSec: sub.startSec,
              rawSourceEndSec: sub.endSec,
              text: sub.text,
              volumePercent: 100,
              isFix: isFixTrack(track),
              hasCollision: false,
              offsetSec: 0
            };
          });
        }
      }

      updateProcess('3. Удаление тишины и калибровка', `Сформировано ${totalClips} фраз от тишины до тишины`, 100, tracks.length, tracks.length);
      setCalibrationsByTrack(newCalibrations);
      const finalClips = savedPassportRef.current
        ? applyTimingPassportToClips(updatedClips, savedPassportRef.current)
        : updatedClips;
      setAudioClips(finalClips);
      setIsSilenceRemoved(true);
      addLog(`✓ Удаление тишины со всех дорожек завершено! Сформировано ${totalClips} фраз (от тишины до тишины). Границы фраз защищены от обрезания.`, 'success');
      toast.success(`Тишина удалена из всех дорожек! Сформировано ${totalClips} фраз от тишины до тишины.`);
    } catch (err: any) {
      addLog(`❌ Ошибка удаления тишины: ${err.message}`, 'error');
      toast.error(`Ошибка: ${err.message}`);
    } finally {
      setIsLoading(false);
      clearProcess();
    }
  };

  // PIPELINE STEP 4: "Применить фиксы" — Two-Scenario Fix Stitching (Full Replacement vs Targeted Splicing with Boundary Protection)
  const handleStitchFixes = async () => {
    try {
      setIsLoading(true);
      updateProcess('3. Вшитие фиксов', 'Анализ дорожек фиксов и классификация (полный перезапис / точечный фикс)...', 10);
      addLog('Запуск вшивания фиксов: проверка типа фикса (полная замена или точечное вшивание с защитой концов фраз)...', 'info');

      const updatedClips = { ...audioClips };
      let appliedCount = 0;

      // Group tracks by actor
      const tracksByActor: Record<string, Track[]> = {};
      tracks.forEach(tr => {
        const actorKey = tr.dubberName || 'Даббер';
        if (!tracksByActor[actorKey]) tracksByActor[actorKey] = [];
        tracksByActor[actorKey].push(tr);
      });

      const actorEntries = Object.entries(tracksByActor);
      for (let aIdx = 0; aIdx < actorEntries.length; aIdx++) {
        const [actorNick, actorTrks] = actorEntries[aIdx];
        const mainTracks = actorTrks.filter(t => !isFixTrack(t));
        const fixTracks = actorTrks.filter(t => isFixTrack(t));

        updateProcess(
          '3. Вшитие фиксов',
          `Обработка фиксов [${aIdx + 1}/${actorEntries.length}]: «${actorNick}»...`,
          Math.round(((aIdx + 1) / Math.max(1, actorEntries.length)) * 95),
          aIdx + 1,
          actorEntries.length
        );
        await new Promise(r => setTimeout(r, 0));

        if (mainTracks.length === 0 || fixTracks.length === 0) continue;

        // Ensure all main tracks have their original buffers saved and are sliced into speech phrases
        for (const mTrk of mainTracks) {
          const mBuf = audioBuffersRef.current[mTrk.id];
          if (mBuf && !origBuffersByTrackRef.current[mTrk.id]) {
            const origKey = `orig_${mTrk.id}`;
            audioBuffersRef.current[origKey] = mBuf;
            origBuffersByTrackRef.current[mTrk.id] = {
              buffer: mBuf,
              filePath: mTrk.filePath,
              sourceTrackId: origKey
            };
          }
          const curMainClips = updatedClips[mTrk.id] || [];
          if (curMainClips.length <= 1 && mBuf) {
            const mSubs = trackSubLinesMap[mTrk.id] || [];
            const mIntervals = detectSpeechIntervals(mBuf, {
              minSilenceDurationSec: timingSettings.minSilenceDurationSec,
              leadInPaddingSec: timingSettings.leadInPaddingSec,
              leadOutPaddingSec: timingSettings.leadOutPaddingSec,
              minSpeechDurationSec: timingSettings.minSpeechDurationSec,
              mergeCloseGapsSec: timingSettings.mergeCloseGapsSec,
              subLines: mSubs
            });
            if (mIntervals.length > 0) {
              updatedClips[mTrk.id] = mIntervals.map((iv, idx) => {
                const nearSub = mSubs.find(s => Math.abs(s.startSec - iv.startSec) <= 2.2);
                return {
                  id: `clip_${mTrk.id}_${idx}`,
                  trackId: mTrk.id,
                  dubberName: mTrk.participant || mTrk.dubberName || actorNick,
                  characterName: mTrk.character || mTrk.characterName || 'Персонаж',
                  clipStartSec: iv.startSec,
                  durationSec: iv.durationSec,
                  sourceStartSec: iv.startSec,
                  sourceEndSec: iv.endSec,
                  rawSourceStartSec: iv.startSec,
                  rawSourceEndSec: iv.endSec,
                  sourceAudioPath: mTrk.filePath,
                  text: nearSub?.text || `Фраза ${idx + 1}`,
                  matchedSubId: nearSub ? String(nearSub.id) : undefined,
                  volumePercent: 100,
                  isFix: false,
                  hasCollision: false,
                  offsetSec: 0
                };
              });
            }
          }
        }

        for (const fixTrack of fixTracks) {
          let fixClips = updatedClips[fixTrack.id] || [];
          const fixBuf = audioBuffersRef.current[fixTrack.id];

          // Preserve fix buffer in fixBuffersByActorRef for Priority 1 self-healing recovery
          if (fixBuf) {
            const actorNorm = normalizeName(actorNick);
            if (!fixBuffersByActorRef.current[actorNorm]) {
              fixBuffersByActorRef.current[actorNorm] = [];
            }
            if (!fixBuffersByActorRef.current[actorNorm].some(f => f.sourceTrackId === fixTrack.id)) {
              fixBuffersByActorRef.current[actorNorm].push({
                buffer: fixBuf,
                filePath: fixTrack.filePath,
                sourceTrackId: fixTrack.id,
                participant: fixTrack.participant || actorNick
              });
            }
          }

          if (fixClips.length <= 1 && fixBuf) {
            const trSubs = trackSubLinesMap[fixTrack.id] || trackSubLinesMap[mainTracks[0].id] || [];
            const fixIntervals = detectSpeechIntervals(fixBuf, {
              minSilenceDurationSec: timingSettings.minSilenceDurationSec,
              leadInPaddingSec: timingSettings.leadInPaddingSec,
              leadOutPaddingSec: timingSettings.leadOutPaddingSec,
              minSpeechDurationSec: timingSettings.minSpeechDurationSec,
              mergeCloseGapsSec: timingSettings.mergeCloseGapsSec,
              subLines: trSubs
            });
            if (fixIntervals.length > 0) {
              fixClips = fixIntervals.map((iv, idx) => ({
                id: `clip_${fixTrack.id}_${idx}`,
                trackId: fixTrack.id,
                dubberName: fixTrack.dubberName || actorNick,
                characterName: fixTrack.characterName || mainTracks[0].characterName,
                clipStartSec: iv.startSec,
                durationSec: iv.durationSec,
                sourceStartSec: iv.startSec,
                sourceEndSec: iv.endSec,
                rawSourceStartSec: iv.startSec,
                rawSourceEndSec: iv.endSec,
                sourceAudioTrackId: fixTrack.id,
                sourceAudioPath: fixTrack.filePath,
                text: trSubs[idx]?.text || `Фраза фикса ${idx + 1}`,
                volumePercent: 100,
                isFix: true,
                offsetSec: 0
              }));
              updatedClips[fixTrack.id] = fixClips;
            }
          }

          if (fixClips.length === 0) continue;

          const fixDuration = fixBuf ? fixBuf.duration : (fixClips[fixClips.length - 1]?.clipStartSec || 0);

          let bestMainTrackForFull =
            mainTracks.find(mt => mt.id === (fixTrack as any).targetMainTrackId || mt.id === fixTrack.id.replace(/_fix$/, '')) ||
            mainTracks[0];
          if (!mainTracks.some(mt => mt.id === (fixTrack as any).targetMainTrackId || mt.id === fixTrack.id.replace(/_fix$/, ''))) {
            let bestDurDiff = Infinity;
            for (const mt of mainTracks) {
              const buf = audioBuffersRef.current[mt.id];
              const mtClips = updatedClips[mt.id] || [];
              const dur = buf ? buf.duration : (mtClips[mtClips.length - 1]?.clipStartSec || 0);
              const diff = Math.abs(dur - fixDuration);
              if (diff < bestDurDiff) {
                bestDurDiff = diff;
                bestMainTrackForFull = mt;
              }
            }
          }

          const targetClips = updatedClips[bestMainTrackForFull.id] || [];
          const mainSubs = trackSubLinesMap[bestMainTrackForFull.id] || [];

          const fixActiveSpeechSec = fixClips.reduce((acc, c) => acc + c.durationSec, 0);
          const mainActiveSpeechSec = targetClips.reduce((acc, c) => acc + c.durationSec, 0);

          // Scenario 1 vs Scenario 2 Classification:
          // Check how many of the character's subtitles are voiced in the main track vs in the fix track.
          // If the main track has voiced subtitles that are SILENT in the fix track, the fix track is GUARANTEED
          // to be a Targeted Fix (Scenario 2), because replacing the whole track would lose those un-recorded subtitles!
          let voicedInMainSubs = 0;
          let voicedInFixSubs = 0;
          let voicedOnlyInMainSubs = 0;
          for (const sub of mainSubs) {
            const hasMainVoice = targetClips.some(mc => {
              const s = mc.clipStartSec + (mc.offsetSec || 0);
              const e = s + mc.durationSec;
              return e >= sub.startSec - 1.8 && s <= sub.endSec + 1.8;
            });
            const hasFixVoice = fixClips.some(fc => {
              const s = fc.clipStartSec + (fc.offsetSec || 0);
              const e = s + fc.durationSec;
              return e >= sub.startSec - 1.8 && s <= sub.endSec + 1.8;
            });
            if (hasMainVoice) voicedInMainSubs++;
            if (hasFixVoice) voicedInFixSubs++;
            if (hasMainVoice && !hasFixVoice) voicedOnlyInMainSubs++;
          }

          const referencePhraseCount = Math.max(mainSubs.length, targetClips.filter(c => !c.isPhysics).length, 1);
          const isFullReplacement =
            fixClips.length >= Math.max(2, Math.ceil(referencePhraseCount * 0.82)) &&
            fixActiveSpeechSec >= mainActiveSpeechSec * 0.75 &&
            (mainSubs.length === 0 || (voicedInFixSubs >= Math.ceil(Math.max(1, voicedInMainSubs) * 0.85) && voicedOnlyInMainSubs <= 1));

          if (isFullReplacement) {
            // SCENARIO 1: Full Track Replacement — replace the entire track cleanly without splicing into the old track
            addLog(
              `⚡ Сценарий 1 (Полная замена дорожки) для «${actorNick}»: фикс содержит ${fixClips.length} фраз (${fixActiveSpeechSec.toFixed(1)}с речи vs ${mainActiveSpeechSec.toFixed(1)}с). Основная дорожка «${bestMainTrackForFull.participant}» полностью заменена на дорожку фикса без вшивания!`,
              'success'
            );
            if (fixBuf) {
              audioBuffersRef.current[bestMainTrackForFull.id] = fixBuf;
            }
            if (audioElementsRef.current[fixTrack.id]) {
              audioElementsRef.current[bestMainTrackForFull.id] = audioElementsRef.current[fixTrack.id];
            }
            if (normalizationMetrics[fixTrack.id]) {
              setNormalizationMetrics(prev => ({
                ...prev,
                [bestMainTrackForFull.id]: prev[fixTrack.id] || normalizationMetrics[fixTrack.id]
              }));
            }
            bestMainTrackForFull.filePath = fixTrack.filePath || bestMainTrackForFull.filePath;
            const replacedClips = fixClips.map((fc, idx) => {
              const nearSub = mainSubs.find(s => Math.abs(s.startSec - fc.clipStartSec) <= 2.2) || mainSubs[idx];
              return {
                ...fc,
                id: `clip_${bestMainTrackForFull.id}_fullfix_${idx}`,
                trackId: bestMainTrackForFull.id,
                sourceAudioTrackId: fixTrack.id,
                sourceAudioPath: fc.sourceAudioPath || fixTrack.filePath,
                isFix: true,
                text: nearSub?.text || targetClips[idx]?.text || fc.text,
                matchedSubId: nearSub ? String(nearSub.id) : undefined
              };
            });
            updatedClips[bestMainTrackForFull.id] = replacedClips;
            delete updatedClips[fixTrack.id];
            appliedCount += fixClips.length;
          } else {
            // SCENARIO 2: Targeted Fix Splicing (Timecode matching for full-length padded fix tracks + Whisper for short 00:00 fix files)
            let fixAppliedOnTrack = 0;
            const mainBuf = audioBuffersRef.current[bestMainTrackForFull.id];
            const mainDur = mainBuf ? mainBuf.duration : duration;

            // Detect if this fix file is a short standalone recording starting near 00:00
            const maxFixEndSec = Math.max(...fixClips.map(c => c.clipStartSec + c.durationSec));
            const isShortFixFile =
              fixDuration < mainDur * 0.45 &&
              maxFixEndSec < 45 &&
              mainSubs.some(s => s.startSec > 45);

            // Run Whisper on fix clips if it's a short file or if any fix clip doesn't have an obvious timecode match
            const fixWhisperMap: Record<string, string> = {};
            const needsWhisperClips = fixClips.filter(fc => {
              if (isShortFixFile) return true;
              const hasTimecodeSub = mainSubs.some(s => Math.abs(s.startSec - fc.clipStartSec) <= 3.0);
              const hasTimecodeClip = targetClips.some(mc => Math.abs(mc.clipStartSec - fc.clipStartSec) <= 3.0);
              return !hasTimecodeSub && !hasTimecodeClip;
            });

            if (needsWhisperClips.length > 0 && fixTrack.filePath) {
              try {
                addLog(`🎙 Whisper: распознавание ${needsWhisperClips.length} фраз точечного фикса «${actorNick}» для точной привязки к субтитрам...`, 'info');
                const resp: any = await ipcSafe.invoke('timing-whisper-transcribe-clips', {
                  audioFilePath: fixTrack.filePath,
                  clips: needsWhisperClips.map(c => ({
                    id: c.id,
                    startSec: c.sourceStartSec,
                    endSec: c.sourceEndSec,
                    hint: c.text
                  })),
                  model: 'tiny',
                  language: 'ru'
                });
                if (resp && Array.isArray(resp.results)) {
                  resp.results.forEach((r: any) => {
                    if (r.id && r.text) {
                      fixWhisperMap[r.id] = r.text.trim();
                    }
                  });
                }
              } catch (wErr) {
                console.warn('[FixStitch Whisper] Failed to transcribe short fix clips:', wErr);
              }
            }

            // Snapshot of voiced subtitles before splicing so we can verify 100% completeness afterwards
            const preSpliceClipsByTrack: Record<string, AudioClip[]> = {};
            mainTracks.forEach(mt => {
              preSpliceClipsByTrack[mt.id] = [...(updatedClips[mt.id] || [])];
            });

            const usedTargetSubIds = new Set<string>();

            for (let fIdx = 0; fIdx < fixClips.length; fIdx++) {
              const fixClip = fixClips[fIdx];
              const recognizedFixText = fixWhisperMap[fixClip.id] || fixClip.recognizedText || '';

              let targetTrackId = bestMainTrackForFull.id;
              let matchedSub: SubtitleLine | undefined;
              let targetInsertSec = fixClip.clipStartSec;

              if (!isShortFixFile) {
                // Timecode-anchored fix track (padded with silence at real episode timecodes)
                let bestSubDist = Infinity;
                for (const mTrk of mainTracks) {
                  const mSubs = trackSubLinesMap[mTrk.id] || [];
                  for (const s of mSubs) {
                    const dist = Math.abs(s.startSec - fixClip.clipStartSec);
                    if (dist <= 3.2 && dist < bestSubDist) {
                      bestSubDist = dist;
                      matchedSub = s;
                      targetTrackId = mTrk.id;
                    }
                  }
                }
                if (matchedSub) {
                  targetInsertSec = matchedSub.startSec;
                  usedTargetSubIds.add(String(matchedSub.id));
                } else {
                  targetInsertSec = fixClip.clipStartSec;
                }
              } else {
                // Short fix file starting at 00:00 — match via Whisper similarity + candidate fix subtitles
                const candidateFixSubs = (trackSubLinesMap[fixTrack.id] || []).length > 0
                  ? (trackSubLinesMap[fixTrack.id] || [])
                  : mainSubs;

                let bestSim = 0;
                for (const mTrk of mainTracks) {
                  const mSubs = trackSubLinesMap[mTrk.id] || [];
                  for (const s of mSubs) {
                    if (usedTargetSubIds.has(String(s.id))) continue;
                    const sim = recognizedFixText
                      ? calculateTextSimilarity(recognizedFixText, s.text)
                      : calculateTextSimilarity(fixClip.text || '', s.text);
                    if (sim > bestSim) {
                      bestSim = sim;
                      matchedSub = s;
                      targetTrackId = mTrk.id;
                    }
                  }
                }

                if ((!matchedSub || bestSim < 0.35) && candidateFixSubs[fIdx]) {
                  matchedSub = candidateFixSubs[fIdx];
                }

                if (matchedSub) {
                  targetInsertSec = matchedSub.startSec;
                  usedTargetSubIds.add(String(matchedSub.id));
                }
              }

              const targetMainTrack = mainTracks.find(t => t.id === targetTrackId) || bestMainTrackForFull;
              let mClips = [...(updatedClips[targetMainTrack.id] || [])].sort(
                (a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0))
              );

              // Define the exact replacement window on the main track:
              // Any old dialogue phrase (!isPhysics) overlapping the replaced phrase/subtitle window is COMPLETELY EXCISED
              const windowStart = matchedSub
                ? Math.min(matchedSub.startSec, !isShortFixFile ? fixClip.clipStartSec : matchedSub.startSec) - 0.25
                : fixClip.clipStartSec - 0.25;
              const windowEnd = matchedSub
                ? Math.max(matchedSub.endSec, targetInsertSec + fixClip.durationSec) + 0.20
                : fixClip.clipStartSec + fixClip.durationSec + 0.20;

              const excisedClips: AudioClip[] = [];
              const survivingClips: AudioClip[] = [];

              for (const mc of mClips) {
                if (mc.isPhysics) {
                  // Protect non-dialogue "физика" outside the direct fix speech body
                  survivingClips.push(mc);
                  continue;
                }
                const mcStart = mc.clipStartSec + (mc.offsetSec || 0);
                const mcEnd = mcStart + mc.durationSec;
                const sameSubId = matchedSub && mc.matchedSubId && String(mc.matchedSubId) === String(matchedSub.id);
                const overlapSec = Math.min(mcEnd, windowEnd) - Math.max(mcStart, windowStart);
                const isOverlappingTarget =
                  sameSubId ||
                  (overlapSec > 0.12 && (
                    !matchedSub ||
                    Math.abs(mcStart - matchedSub.startSec) <= Math.max(1.8, fixClip.durationSec * 0.85) ||
                    (!isShortFixFile && Math.abs(mcStart - fixClip.clipStartSec) <= 1.8)
                  ));

                if (isOverlappingTarget && !mc.isFix) {
                  excisedClips.push(mc);
                } else {
                  survivingClips.push(mc);
                }
              }

              // Fallback: if no clip overlapped the window directly, find the single closest dialogue clip within 2.5s
              if (excisedClips.length === 0) {
                let closestIdx = -1;
                let closestDist = 2.5;
                survivingClips.forEach((mc, idx) => {
                  if (mc.isPhysics || mc.isFix) return;
                  const dist = Math.abs((mc.clipStartSec + (mc.offsetSec || 0)) - targetInsertSec);
                  if (dist < closestDist) {
                    closestDist = dist;
                    closestIdx = idx;
                  }
                });
                if (closestIdx !== -1) {
                  excisedClips.push(survivingClips[closestIdx]);
                  survivingClips.splice(closestIdx, 1);
                }
              }

              const basePlacementStart = excisedClips.length > 0 && !matchedSub
                ? excisedClips[0].clipStartSec
                : targetInsertSec;

              // Create the intact spliced fix clip (full sourceStartSec..sourceEndSec from silence to silence, NEVER trimmed!)
              const splicedClip: AudioClip = {
                ...fixClip,
                id: `clip_${targetMainTrack.id}_spliced_${fixClip.id}_${fIdx}`,
                trackId: targetMainTrack.id,
                dubberName: targetMainTrack.participant || targetMainTrack.dubberName || actorNick,
                characterName: targetMainTrack.character || targetMainTrack.characterName || fixClip.characterName,
                sourceAudioTrackId: fixTrack.id,
                sourceAudioPath: fixClip.sourceAudioPath || fixTrack.filePath,
                clipStartSec: Number(Math.max(0, basePlacementStart).toFixed(3)),
                durationSec: fixClip.durationSec,
                sourceStartSec: fixClip.sourceStartSec,
                sourceEndSec: fixClip.sourceEndSec,
                rawSourceStartSec: fixClip.rawSourceStartSec ?? fixClip.sourceStartSec,
                rawSourceEndSec: fixClip.rawSourceEndSec ?? fixClip.sourceEndSec,
                isFix: true,
                isPhysics: false,
                text: matchedSub?.text || excisedClips[0]?.text || fixClip.text,
                matchedSubId: matchedSub ? String(matchedSub.id) : excisedClips[0]?.matchedSubId,
                recognizedText: recognizedFixText || fixClip.recognizedText,
                offsetSec: 0
              };

              // Insert splicedClip and sort monotonically
              survivingClips.push(splicedClip);
              survivingClips.sort((a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0)));

              const insIdx = survivingClips.findIndex(c => c.id === splicedClip.id);
              const prevClip = insIdx > 0 ? survivingClips[insIdx - 1] : null;
              const nextClip = insIdx + 1 < survivingClips.length ? survivingClips[insIdx + 1] : null;

              const prevEnd = prevClip
                ? (prevClip.clipStartSec + (prevClip.offsetSec || 0) + prevClip.durationSec + 0.04)
                : 0;

              // 1. Protect previous phrase tail: never let splicedClip start before prevEnd
              if (splicedClip.clipStartSec < prevEnd) {
                splicedClip.clipStartSec = Number(prevEnd.toFixed(3));
              }

              // 2. Protect splicedClip tail AND nextClip head if the new fix phrase is longer than the old phrase:
              // Step 2a: First shift splicedClip earlier into available silence before it (toward subtitle start / prevEnd)
              if (nextClip) {
                const nextStart = nextClip.clipStartSec + (nextClip.offsetSec || 0);
                const neededEnd = splicedClip.clipStartSec + splicedClip.durationSec + 0.04;
                if (neededEnd > nextStart) {
                  const earliestAllowedStart = Math.max(
                    prevEnd,
                    (matchedSub ? matchedSub.startSec : splicedClip.clipStartSec) - 0.30
                  );
                  if (splicedClip.clipStartSec > earliestAllowedStart) {
                    const shiftBack = Math.min(
                      splicedClip.clipStartSec - earliestAllowedStart,
                      neededEnd - nextStart
                    );
                    splicedClip.clipStartSec = Number((splicedClip.clipStartSec - shiftBack).toFixed(3));
                  }
                }

                // Step 2b: If still touching/overlapping nextClip, gently push nextClip (and cascading neighbors) forward with 40ms gap
                for (let k = insIdx; k < survivingClips.length - 1; k++) {
                  const curC = survivingClips[k];
                  const nxtC = survivingClips[k + 1];
                  const curEnd = (curC.clipStartSec + (curC.offsetSec || 0)) + curC.durationSec + 0.04;
                  const nxtStart = nxtC.clipStartSec + (nxtC.offsetSec || 0);
                  if (curEnd > nxtStart) {
                    nxtC.clipStartSec = Number(curEnd.toFixed(3));
                    nxtC.offsetSec = 0;
                  } else {
                    break;
                  }
                }
              }

              updatedClips[targetMainTrack.id] = survivingClips;
              appliedCount++;
              fixAppliedOnTrack++;
              addLog(
                `⚡ Вшит точечный фикс «${splicedClip.text.slice(0, 32)}» на ${formatSeconds(splicedClip.clipStartSec)} (${splicedClip.durationSec.toFixed(2)}с, вырезано старых кусков: ${excisedClips.length}) в «${targetMainTrack.participant}» — концы фраз защищены!`,
                'info'
              );
            }

            // Post-Fix Completeness Verification: Ensure no previously-voiced subtitle on the main track lost coverage
            for (const mTrk of mainTracks) {
              const mSubs = trackSubLinesMap[mTrk.id] || [];
              const beforeClips = preSpliceClipsByTrack[mTrk.id] || [];
              const afterClips = updatedClips[mTrk.id] || [];

              for (const sub of mSubs) {
                const wasCoveredBefore = beforeClips.some(c => {
                  const cs = c.clipStartSec + (c.offsetSec || 0);
                  const ce = cs + c.durationSec;
                  return cs <= sub.endSec + 0.6 && ce >= sub.startSec - 0.6;
                });
                const isCoveredAfter = afterClips.some(c => {
                  const cs = c.clipStartSec + (c.offsetSec || 0);
                  const ce = cs + c.durationSec;
                  return cs <= sub.endSec + 0.6 && ce >= sub.startSec - 0.6;
                });

                if (wasCoveredBefore && !isCoveredAfter) {
                  // Restore the accidentally removed original clip for this adjacent subtitle and place it with a 40ms gap
                  const candidateOld = beforeClips.find(c => {
                    const cs = c.clipStartSec + (c.offsetSec || 0);
                    return Math.abs(cs - sub.startSec) <= 1.5;
                  });
                  if (candidateOld) {
                    afterClips.push({ ...candidateOld, offsetSec: 0 });
                    afterClips.sort((a, b) => a.clipStartSec - b.clipStartSec);
                    for (let k = 0; k < afterClips.length - 1; k++) {
                      const cEnd = afterClips[k].clipStartSec + afterClips[k].durationSec + 0.04;
                      if (cEnd > afterClips[k + 1].clipStartSec) {
                        afterClips[k + 1].clipStartSec = Number(cEnd.toFixed(3));
                      }
                    }
                    addLog(
                      `🛡 Защита полноты субтитров при вшивании фикса: сохранена соседняя реплика «${sub.text.slice(0, 28)}» на ${formatSeconds(sub.startSec)}`,
                      'info'
                    );
                  }
                }
              }
              updatedClips[mTrk.id] = afterClips;
            }

            delete updatedClips[fixTrack.id];
            addLog(`⚡ Вшито ${fixAppliedOnTrack} точечных фраз фикса для даббера «${actorNick}» с защитой концов фраз и проверкой всех субтитров.`, 'success');
          }
        }
      }

      setTracks(prev => prev.filter(t => !isFixTrack(t)));
      setAudioClips(updatedClips);
      setIsFixesStitched(true);

      if (appliedCount > 0) {
        toast.success(`Применено фиксов: ${appliedCount}! Концы фраз и полнота субтитров проверены и защищены.`);
      } else {
        toast.info('Все актуальные фиксы уже вшиты.');
      }
    } catch (err: any) {
      addLog(`❌ Ошибка применения фиксов: ${err.message}`, 'error');
      toast.error(`Ошибка применения фиксов: ${err.message}`);
    } finally {
      setIsLoading(false);
      clearProcess();
    }
  };

  const jumpToTime = useCallback((timeSec: number) => {
    if (timelineContainerRef.current) {
      const targetPx = Math.max(0, timeSec * zoomLevel - 250);
      timelineContainerRef.current.scrollTo({ left: targetPx, behavior: 'smooth' });
    }
    seekToTime(Math.max(0, timeSec));
  }, [zoomLevel, seekToTime]);

  // ---------------------------------------------------------------------------
  // PIPELINE STEP 5 — TWO-STAGE AUTO-TIMING & TARGETED DIAGNOSTICS
  // ---------------------------------------------------------------------------
  const handleAnalyzeTiming = async () => {
    if (tracks.length === 0) return;
    try {
      setIsLoading(true);
      updateProcess('1. Анализ проблем (Whisper)', 'Подготовка речевых интервалов и поиск проблем...', 8, 1, 4);
      addLog('Запуск Этапа 1: глубокий анализ наездов, рассинхронов и пропущенных реплик...', 'info');

      let currentClips = { ...audioClips };

      const hasUncutTracks = tracks.some(t => {
        const c = currentClips[t.id];
        return !c || c.length <= 1;
      });

      if (!isSilenceRemoved || hasUncutTracks) {
        updateProcess('1. Анализ проблем (Whisper)', 'Удаление тишины и нарезка речевых интервалов...', 15, 1, 4);
        for (const track of tracks) {
          let audioBuf = audioBuffersRef.current[track.id];
          if (!audioBuf && track.filePath) {
            try {
              const pUrl = await getPlayableAudioUrl(track.filePath);
              if (pUrl) {
                const resp = await fetch(pUrl);
                const arrayBuf = await resp.arrayBuffer();
                const sharedAudioCtx = getSharedAudioContext();
                if (sharedAudioCtx) {
                  audioBuf = await sharedAudioCtx.decodeAudioData(arrayBuf);
                  audioBuffersRef.current[track.id] = audioBuf;
                }
              }
            } catch (e) {}
          }
          if (audioBuf) {
            const trSubs = trackSubLinesMap[track.id] || [];
            const intervals = detectSpeechIntervals(audioBuf, {
              minSilenceDurationSec: timingSettings.minSilenceDurationSec,
              leadInPaddingSec: timingSettings.leadInPaddingSec,
              leadOutPaddingSec: timingSettings.leadOutPaddingSec,
              minSpeechDurationSec: timingSettings.minSpeechDurationSec,
              mergeCloseGapsSec: timingSettings.mergeCloseGapsSec,
              subLines: trSubs
            });
            currentClips[track.id] = intervals.map((iv, idx) => {
              const sub = trSubs[idx];
              return {
                id: `clip_${track.id}_${idx}`,
                trackId: track.id,
                dubberName: track.participant || track.dubberName || 'Даббер',
                characterName: track.character || track.characterName || 'Персонаж',
                clipStartSec: iv.startSec,
                durationSec: iv.durationSec,
                sourceStartSec: iv.startSec,
                sourceEndSec: iv.endSec,
                rawSourceStartSec: iv.startSec,
                rawSourceEndSec: iv.endSec,
                text: sub?.text || `Фраза ${idx + 1}`,
                volumePercent: 100,
                isFix: isFixTrack(track),
                hasCollision: false,
                offsetSec: 0
              };
            });
          }
        }
        setIsSilenceRemoved(true);
      }

      const updatedClips: Record<string, AudioClip[]> = {};
      const newIssues: TimingIssue[] = [];
      const newMissingMarkers: MissingSubtitleMarker[] = [];
      const newCollisions: VoiceCollisionMarker[] = [];
      let totalPhysicsDetected = 0;
      let totalMultiSubClips = 0;

      // Pass 1: Identify distant orphan clips (> 3.5s away from any subtitle) and run Whisper for them
      const orphanClipsByTrack: Record<string, AudioClip[]> = {};
      for (const track of tracks) {
        const clips = currentClips[track.id] || [];
        const trSubs = trackSubLinesMap[track.id] || [];
        const orphans: AudioClip[] = [];

        clips.forEach(clip => {
          const cStart = clip.clipStartSec + (clip.offsetSec || 0);
          const hasNearbySub = trSubs.some(s => Math.abs(cStart - s.startSec) <= 3.5 || (cStart >= s.startSec - 1.5 && cStart <= s.endSec + 1.5));
          if (!hasNearbySub && !clip.recognizedText && !clip.isPhysics) {
            orphans.push(clip);
          }
        });
        if (orphans.length > 0) {
          orphanClipsByTrack[track.id] = orphans;
        }
      }

      // Run Whisper for distant orphan clips if any exist
      const orphanTranscriptionMap: Record<string, string> = {};
      const orphanTrackIds = Object.keys(orphanClipsByTrack);
      for (let oIdx = 0; oIdx < orphanTrackIds.length; oIdx++) {
        const trId = orphanTrackIds[oIdx];
        const track = tracks.find(t => t.id === trId);
        const orphans = orphanClipsByTrack[trId];
        if (!track || !orphans || orphans.length === 0) continue;

        const wPct = Math.round(25 + ((oIdx + 1) / Math.max(1, orphanTrackIds.length)) * 35);
        updateProcess(
          '1. Анализ проблем (Whisper)',
          `Whisper распознавание фраз вне сабов: «${track.participant || track.dubberName}» (${orphans.length} фраз)...`,
          wPct,
          2,
          4
        );
        addLog(`🎙 Whisper: анализ ${orphans.length} звуков вне тайминга сабов для «${track.participant || track.dubberName}»...`, 'info');

        const whisperPayload = orphans.map(c => ({
          id: c.id,
          startSec: c.sourceStartSec,
          endSec: c.sourceEndSec,
          hint: c.text
        }));

        try {
          const resp: any = await ipcSafe.invoke('timing-whisper-transcribe-clips', {
            audioFilePath: track.filePath,
            clips: whisperPayload,
            model: 'tiny',
            language: 'ru'
          });
          if (resp && Array.isArray(resp.results)) {
            resp.results.forEach((r: any) => {
              if (r.id && r.text) {
                orphanTranscriptionMap[r.id] = r.text.trim();
              }
            });
          }
        } catch (wErr: any) {
          console.warn('[Whisper AutoTiming Orphans] IPC error:', wErr);
        }
      }

      updateProcess('1. Анализ проблем (Whisper)', 'Привязка фраз к субтитрам, защита физики и адаптированных реплик...', 68, 3, 4);
      await new Promise(r => setTimeout(r, 0));

      // Pass 2: Subtitle-Anchored Monotonic Matching with:
      // 1) Multi-subtitle single audio clip support (1 clip -> K consecutive subtitles)
      // 2) Adapted/rephrased line protection (Whisper NEVER disqualifies a clip in an unvoiced subtitle window)
      // 3) "Физика" (sighs, gasps, grunts, laughs outside subtitles) detection & protection
      for (const track of tracks) {
        const dubberName = track.participant || track.dubberName || 'Даббер';
        const characterName = track.character || track.characterName || 'Персонаж';
        const trackBuf = audioBuffersRef.current[track.id];
        const clips = [...(currentClips[track.id] || [])].sort(
          (a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0))
        );
        const trSubs = [...(trackSubLinesMap[track.id] || [])].sort((a, b) => a.startSec - b.startSec);

        const assignedSubIndices = new Set<number>();
        const clipMatchedSubIdx = new Array<number>(clips.length).fill(-1);
        const clipCoveredSubIndices: number[][] = Array.from({ length: clips.length }, () => []);
        const clipMatchedByWhisper = new Array<boolean>(clips.length).fill(false);
        const clipWhisperScore = new Array<number>(clips.length).fill(0);

        for (let cIdx = 0; cIdx < clips.length; cIdx++) {
          if (orphanTranscriptionMap[clips[cIdx].id]) {
            clips[cIdx] = { ...clips[cIdx], recognizedText: orphanTranscriptionMap[clips[cIdx].id] };
          }
        }

        const isWithinTrackCorridor = (cIdx: number, targetStartSec: number): boolean => {
          const clip = clips[cIdx];
          const prevEnd = cIdx > 0
            ? (clips[cIdx - 1].clipStartSec + (clips[cIdx - 1].offsetSec || 0) + clips[cIdx - 1].durationSec + 0.03)
            : 0;
          const nextStart = cIdx + 1 < clips.length
            ? (clips[cIdx + 1].clipStartSec + (clips[cIdx + 1].offsetSec || 0) - 0.03)
            : Infinity;
          return targetStartSec >= prevEnd - 0.25 && (targetStartSec + Math.min(clip.durationSec, 1.2)) <= nextStart + 0.25;
        };

        // Helper: check monotonic order compatibility (clip cIdx can only match sIdx if no earlier clip matched > sIdx and no later clip matched < sIdx)
        const isMonotonicCompatible = (cIdx: number, sIdx: number): boolean => {
          for (let i = 0; i < cIdx; i++) {
            if (clipMatchedSubIdx[i] !== -1 && clipMatchedSubIdx[i] >= sIdx) return false;
          }
          for (let i = cIdx + 1; i < clips.length; i++) {
            if (clipMatchedSubIdx[i] !== -1 && clipMatchedSubIdx[i] <= sIdx) return false;
          }
          return true;
        };

        // Helper: expand a matched clip across consecutive subtitles if the dubber voiced 2-3 consecutive subtitles in one continuous breath
        const expandMultiSubCoverage = (cIdx: number, primarySIdx: number) => {
          const clip = clips[cIdx];
          const cStart = clip.clipStartSec + (clip.offsetSec || 0);
          const primarySub = trSubs[primarySIdx];
          // Estimate where clip ends when placed on primarySub.startSec
          const effectiveEnd = Math.max(cStart + clip.durationSec, primarySub.startSec + clip.durationSec);
          const nextClipStart = cIdx + 1 < clips.length
            ? (clips[cIdx + 1].clipStartSec + (clips[cIdx + 1].offsetSec || 0))
            : Infinity;

          if (!clipCoveredSubIndices[cIdx].includes(primarySIdx)) {
            clipCoveredSubIndices[cIdx].push(primarySIdx);
          }

          let curSIdx = primarySIdx;
          while (curSIdx + 1 < trSubs.length) {
            const nxtSIdx = curSIdx + 1;
            if (assignedSubIndices.has(nxtSIdx)) break;
            const prevSub = trSubs[curSIdx];
            const nxtSub = trSubs[nxtSIdx];
            const interSubGap = nxtSub.startSec - prevSub.endSec;
            if (interSubGap > 1.35) break;

            // Check if the next clip on the track is actually intended for nxtSub
            if (Math.abs(nextClipStart - nxtSub.startSec) <= 0.85) break;

            const nxtSubDur = Math.max(0.25, nxtSub.endSec - nxtSub.startSec);
            const overlapIntoNextSub = effectiveEnd - nxtSub.startSec;
            if (overlapIntoNextSub >= Math.min(0.45, nxtSubDur * 0.40)) {
              assignedSubIndices.add(nxtSIdx);
              clipCoveredSubIndices[cIdx].push(nxtSIdx);
              totalMultiSubClips++;
              curSIdx = nxtSIdx;
            } else {
              break;
            }
          }
        };

        // Sub-Pass 2A: Lock well-placed dialogue clips first (diff <= 2.2s)
        const candidatePairs: Array<{ cIdx: number; sIdx: number; score: number }> = [];
        for (let cIdx = 0; cIdx < clips.length; cIdx++) {
          const clip = clips[cIdx];
          if (clip.isPhysics) continue;
          const cStart = clip.clipStartSec + (clip.offsetSec || 0);
          const speechStats = measureClipActiveSpeechStats(
            audioBuffersRef.current[clip.sourceAudioTrackId || track.id] || trackBuf,
            clip.sourceStartSec,
            clip.sourceEndSec
          );
          for (let sIdx = 0; sIdx < trSubs.length; sIdx++) {
            const sub = trSubs[sIdx];
            const diff = Math.abs(cStart - sub.startSec);
            if (diff <= 2.2 && isWithinTrackCorridor(cIdx, sub.startSec)) {
              const subDur = Math.max(0.25, sub.endSec - sub.startSec);
              const durRatio = Math.min(clip.durationSec, subDur) / Math.max(clip.durationSec, subDur);
              // Penalize ultra-short (< 0.24s) non-verbal breath bursts when a multi-word subtitle (> 0.9s) is being matched
              const shortBreathPenalty = (clip.durationSec < 0.24 && speechStats.activeWindows < 8 && subDur > 0.9) ? 1.4 : 0;
              const score = diff - durRatio * 0.35 + shortBreathPenalty;
              candidatePairs.push({ cIdx, sIdx, score });
            }
          }
        }
        candidatePairs.sort((a, b) => a.score - b.score);
        for (const pair of candidatePairs) {
          if (clipMatchedSubIdx[pair.cIdx] !== -1 || assignedSubIndices.has(pair.sIdx)) continue;
          if (!isMonotonicCompatible(pair.cIdx, pair.sIdx)) continue;
          clipMatchedSubIdx[pair.cIdx] = pair.sIdx;
          assignedSubIndices.add(pair.sIdx);
          expandMultiSubCoverage(pair.cIdx, pair.sIdx);
        }

        // Sub-Pass 2B: Subtitle-Anchored Corridor Matching for any remaining unassigned subtitles
        // CRITICAL RULE: Where an unvoiced subtitle exists in the corridor, a speech clip in that window IS the dialogue phrase,
        // even if the dubber adapted/rephrased the text for lip-sync or Whisper failed to transcribe it!
        for (let sIdx = 0; sIdx < trSubs.length; sIdx++) {
          if (assignedSubIndices.has(sIdx)) continue;
          const sub = trSubs[sIdx];

          let bestCIdx = -1;
          let bestCandidateScore = -Infinity;

          for (let cIdx = 0; cIdx < clips.length; cIdx++) {
            if (clipMatchedSubIdx[cIdx] !== -1) continue;
            const clip = clips[cIdx];
            if (clip.isPhysics) continue;
            if (!isMonotonicCompatible(cIdx, sIdx)) continue;

            const cStart = clip.clipStartSec + (clip.offsetSec || 0);
            const timeDist = Math.abs(cStart - sub.startSec);
            if (timeDist > 4.2 || !isWithinTrackCorridor(cIdx, sub.startSec)) continue;

            const subDur = Math.max(0.25, sub.endSec - sub.startSec);
            const durFit = Math.min(clip.durationSec, subDur) / Math.max(clip.durationSec, subDur);
            const speechStats = measureClipActiveSpeechStats(
              audioBuffersRef.current[clip.sourceAudioTrackId || track.id] || trackBuf,
              clip.sourceStartSec,
              clip.sourceEndSec
            );

            // Whisper is used strictly as a positive bonus — never as a rejection filter!
            const recWords = normalizeSpeechText(clip.recognizedText || '');
            const hasAnyWhisperWords = recWords.length >= 2;
            const textSim = clip.recognizedText ? calculateTextSimilarity(clip.recognizedText, sub.text) : 0;

            const candidateScore =
              (4.5 - timeDist) * 2.0 +
              durFit * 2.5 +
              Math.min(2.0, speechStats.activeSpeechSec) +
              (hasAnyWhisperWords ? 2.0 : 0) +
              textSim * 3.0;

            if (candidateScore > bestCandidateScore) {
              bestCandidateScore = candidateScore;
              bestCIdx = cIdx;
            }
          }

          if (bestCIdx !== -1) {
            clipMatchedSubIdx[bestCIdx] = sIdx;
            assignedSubIndices.add(sIdx);
            if (clips[bestCIdx].recognizedText) {
              const sim = calculateTextSimilarity(clips[bestCIdx].recognizedText!, sub.text);
              clipMatchedByWhisper[bestCIdx] = timeDistGreater(clips[bestCIdx], sub.startSec, 2.2);
              clipWhisperScore[bestCIdx] = Math.max(60, Math.round(sim * 100));
            }
            expandMultiSubCoverage(bestCIdx, sIdx);
          }
        }

        function timeDistGreater(c: AudioClip, targetSec: number, thresh: number): boolean {
          return Math.abs((c.clipStartSec + (c.offsetSec || 0)) - targetSec) > thresh;
        }

        const mappedClips: AudioClip[] = [];

        for (let cIdx = 0; cIdx < clips.length; cIdx++) {
          const clip = { ...clips[cIdx] };
          const cStart = clip.clipStartSec + (clip.offsetSec || 0);
          const bestSubIdx = clipMatchedSubIdx[cIdx];
          const bestSub = bestSubIdx !== -1 ? trSubs[bestSubIdx] : null;
          const matchedByWhisper = clipMatchedByWhisper[cIdx];

          const prevClipEnd = cIdx > 0
            ? (mappedClips[cIdx - 1].clipStartSec + (mappedClips[cIdx - 1].offsetSec || 0) + mappedClips[cIdx - 1].durationSec + 0.04)
            : 0;
          const nextClipStart = cIdx + 1 < clips.length
            ? (clips[cIdx + 1].clipStartSec + (clips[cIdx + 1].offsetSec || 0) - 0.04)
            : Infinity;

          if (bestSub && bestSubIdx !== -1) {
            const coveredIdxs = clipCoveredSubIndices[cIdx].length > 0 ? clipCoveredSubIndices[cIdx] : [bestSubIdx];
            const coveredSubs = coveredIdxs.map(idx => trSubs[idx]).filter(Boolean);
            const firstSub = coveredSubs[0] || bestSub;
            const lastSub = coveredSubs[coveredSubs.length - 1] || bestSub;

            const maxShift = 2.2;
            let surgicalTarget = Math.max(cStart - maxShift, Math.min(cStart + maxShift, firstSub.startSec));
            surgicalTarget = Math.max(prevClipEnd, Math.min(surgicalTarget, Math.max(prevClipEnd, nextClipStart - clip.durationSec)));
            surgicalTarget = Number(Math.max(0, surgicalTarget).toFixed(3));

            const rawTimeDiff = cStart - firstSub.startSec;
            const absRawDiff = Math.abs(rawTimeDiff);
            const effectiveShift = Math.abs(surgicalTarget - cStart);

            clip.isPhysics = false;
            clip.text = coveredSubs.length > 1
              ? coveredSubs.map(s => s.text).join(' / ')
              : firstSub.text;
            clip.matchedSubId = String(firstSub.id ?? bestSubIdx);
            clip.coveredSubIds = coveredSubs.map((s, idx) => String(s.id ?? coveredIdxs[idx]));
            clip.targetSubStartSec = surgicalTarget;
            clip.targetSubEndSec = lastSub.endSec;
            clip.timeDiffSec = Number(rawTimeDiff.toFixed(2));
            if (matchedByWhisper) {
              clip.whisperMatchedScore = clipWhisperScore[cIdx];
            }

            if (matchedByWhisper && effectiveShift >= 0.25) {
              clip.timingIssue = 'orphan';
              clip.timingIssueText = `Подтяжка к субтитру: «${(clip.recognizedText || clip.text).slice(0, 20)}» ➔ [${formatSeconds(surgicalTarget)}]`;

              newIssues.push({
                id: `issue_orphan_matched_${clip.id}`,
                type: 'orphan',
                trackId: track.id,
                dubberName,
                characterName,
                clipId: clip.id,
                timeSec: cStart,
                durationSec: clip.durationSec,
                subText: clip.text,
                subStartSec: surgicalTarget,
                subEndSec: lastSub.endSec,
                whisperText: clip.recognizedText,
                whisperMatchScore: clipWhisperScore[cIdx],
                description: `Привязка реплики «${(clip.recognizedText || clip.text).slice(0, 35)}» ➔ [${formatSeconds(surgicalTarget)}]`
              });
            } else if (absRawDiff >= 0.28 && absRawDiff <= 2.4 && effectiveShift >= 0.10) {
              clip.timingIssue = 'desync';
              clip.timingIssueText = rawTimeDiff > 0 
                ? `Опаздывает на +${absRawDiff.toFixed(2)}с (сдвиг до ${formatSeconds(surgicalTarget)})` 
                : `Спешит на -${absRawDiff.toFixed(2)}с (сдвиг до ${formatSeconds(surgicalTarget)})`;

              newIssues.push({
                id: `issue_desync_${clip.id}`,
                type: 'desync',
                trackId: track.id,
                dubberName,
                characterName,
                clipId: clip.id,
                timeSec: cStart,
                durationSec: clip.durationSec,
                subText: clip.text,
                subStartSec: surgicalTarget,
                subEndSec: lastSub.endSec,
                timeDiffSec: Number(rawTimeDiff.toFixed(2)),
                description: rawTimeDiff > 0
                  ? `Фраза #${cIdx + 1} опаздывает на +${absRawDiff.toFixed(2)}с: «${clip.text.slice(0, 35)}»`
                  : `Фраза #${cIdx + 1} спешит на -${absRawDiff.toFixed(2)}с: «${clip.text.slice(0, 35)}»`
              });
            } else {
              clip.timingIssue = null;
              clip.timingIssueText = undefined;
            }
          } else {
            // Sub-Pass 2C: Unmatched clip where there is NO unvoiced subtitle in the corridor -> Protected "Физика" (sigh, gasp, grunt, laugh)
            clip.isPhysics = true;
            clip.timingIssue = null;
            clip.timingIssueText = undefined;
            clip.targetSubStartSec = undefined;
            clip.matchedSubId = undefined;
            clip.coveredSubIds = undefined;
            if (!clip.text || clip.text.startsWith('Фраза ')) {
              clip.text = `⚡ Физика (${characterName})`;
            }
            totalPhysicsDetected++;
          }

          mappedClips.push(clip);
        }

        // 3. Problem: Missing Subtitle Lines (taking into account multi-subtitle single clips via assignedSubIndices & coveredSubIds)
        for (let sIdx = 0; sIdx < trSubs.length; sIdx++) {
          if (!assignedSubIndices.has(sIdx)) {
            const sub = trSubs[sIdx];
            const subIdStr = String(sub.id ?? sIdx);
            const hasAudioCover = mappedClips.some(c => {
              if (c.coveredSubIds?.includes(subIdStr) || c.matchedSubId === subIdStr) return true;
              if (c.isPhysics) return false;
              const cStart = c.clipStartSec + (c.offsetSec || 0);
              const cEnd = cStart + c.durationSec;
              return (cStart <= sub.endSec + 0.8 && cEnd >= sub.startSec - 0.8);
            });

            if (!hasAudioCover) {
              newIssues.push({
                id: `issue_missing_${track.id}_${sub.id || sIdx}`,
                type: 'missing',
                trackId: track.id,
                dubberName,
                characterName,
                timeSec: sub.startSec,
                durationSec: sub.endSec - sub.startSec,
                subText: sub.text,
                subStartSec: sub.startSec,
                subEndSec: sub.endSec,
                description: `Пропущена реплика «${characterName}»: «${sub.text.slice(0, 40)}» [${formatSeconds(sub.startSec)}]`
              });

              newMissingMarkers.push({
                id: `missing_${track.id}_${sub.id ?? sIdx}`,
                subId: subIdStr,
                trackId: track.id,
                dubberName,
                characterName,
                startSec: sub.startSec,
                endSec: sub.endSec,
                text: sub.text
              });
            }
          }
        }

        updatedClips[track.id] = mappedClips;
      }

      updateProcess('1. Анализ проблем (Whisper)', 'Анализ наездов, синхрон унисонов по пику и ролей -10 дБ...', 88, 4, 4);
      await new Promise(r => setTimeout(r, 0));

      // Pass 3: Overlaps / Collisions
      for (const track of tracks) {
        const clips = updatedClips[track.id] || [];
        const sorted = [...clips].sort((a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0)));

        for (let i = 0; i < sorted.length - 1; i++) {
          const c1 = sorted[i];
          const c2 = sorted[i + 1];
          const c1End = (c1.clipStartSec + (c1.offsetSec || 0)) + c1.durationSec;
          const c2Start = c2.clipStartSec + (c2.offsetSec || 0);

          if (c1End > c2Start + 0.04) {
            const overlapDur = c1End - c2Start;
            c1.timingIssue = 'overlap';
            c2.timingIssue = 'overlap';
            c1.hasCollision = true;
            c2.hasCollision = true;
            c2.overlappingClipId = c1.id;
            c1.overlappingClipId = c2.id;

            newIssues.push({
              id: `issue_overlap_intra_${c1.id}_${c2.id}`,
              type: 'overlap',
              trackId: track.id,
              dubberName: c1.dubberName,
              characterName: c1.characterName,
              clipId: c2.id,
              timeSec: c2Start,
              durationSec: overlapDur,
              overlapDurationSec: Number(overlapDur.toFixed(2)),
              overlappingClipId: c1.id,
              description: `Наезд внутри дорожки «${c1.dubberName}» (${overlapDur.toFixed(2)}с): «${c1.text.slice(0, 15)}» 💥 «${c2.text.slice(0, 15)}»`
            });
          }
        }
      }

      // 3B. Inter-track analysis between different dubbers:
      // - Unison / Mass phrases: align by vocal onset peak (detectSpeechOnsetOffsetSec)
      // - Simultaneous overlapping subtitles: stamp overlapGroupId & Main (0 dB) / Secondary (-10 dB) role
      const trackIds = Object.keys(updatedClips);
      const detectedIntentionalOverlapsMap = new Map<string, IntentionalOverlapMoment>();
      const existingPriorityById: Record<string, string | null> = {};
      intentionalOverlaps.forEach(ov => {
        if (ov.id && ov.priorityTrackKey) existingPriorityById[ov.id] = ov.priorityTrackKey;
      });
      let unisonSyncedCount = 0;

      const findSubForClip = (trId: string, clip: AudioClip) => {
        if (clip.isPhysics) return undefined;
        const list = trackSubLinesMap[trId] || [];
        if (clip.matchedSubId) {
          const byId = list.find(s => String(s.id) === clip.matchedSubId);
          if (byId) return byId;
        }
        return list.find(s =>
          s.text === clip.text ||
          (typeof clip.targetSubStartSec === 'number' && Math.abs(s.startSec - clip.targetSubStartSec) < 0.25)
        );
      };

      for (let i = 0; i < trackIds.length; i++) {
        for (let j = i + 1; j < trackIds.length; j++) {
          const tr1Clips = updatedClips[trackIds[i]] || [];
          const tr2Clips = updatedClips[trackIds[j]] || [];
          for (let idx1 = 0; idx1 < tr1Clips.length; idx1++) {
            const c1 = tr1Clips[idx1];
            if (c1.isPhysics) continue;
            const sub1 = findSubForClip(trackIds[i], c1);
            if (!sub1) continue;
            for (let idx2 = 0; idx2 < tr2Clips.length; idx2++) {
              const c2 = tr2Clips[idx2];
              if (c2.isPhysics) continue;
              const sub2 = findSubForClip(trackIds[j], c2);
              if (!sub2) continue;

              const normT1 = normalizeSpeechText(sub1.text);
              const normT2 = normalizeSpeechText(sub2.text);
              const isSameSubPhrase =
                (sub1.id !== undefined && sub2.id !== undefined && String(sub1.id) === String(sub2.id)) ||
                (normT1 !== '' && normT1 === normT2 && Math.abs(sub1.startSec - sub2.startSec) <= 0.08);

              if (isSameSubPhrase) {
                const buf1 = audioBuffersRef.current[c1.sourceAudioTrackId || trackIds[i]];
                const buf2 = audioBuffersRef.current[c2.sourceAudioTrackId || trackIds[j]];
                const onset1 = detectSpeechOnsetOffsetSec(buf1, c1.sourceStartSec, c1.sourceEndSec);
                const onset2 = detectSpeechOnsetOffsetSec(buf2, c2.sourceStartSec, c2.sourceEndSec);
                c1.speechOnsetOffsetSec = onset1;
                c2.speechOnsetOffsetSec = onset2;

                const syncTarget1 = Number(Math.max(0, sub1.startSec - onset1).toFixed(3));
                const syncTarget2 = Number(Math.max(0, sub1.startSec - onset2).toFixed(3));

                const prev1End = idx1 > 0 ? (tr1Clips[idx1 - 1].clipStartSec + (tr1Clips[idx1 - 1].offsetSec || 0) + tr1Clips[idx1 - 1].durationSec + 0.02) : 0;
                const next1Start = idx1 + 1 < tr1Clips.length ? (tr1Clips[idx1 + 1].clipStartSec + (tr1Clips[idx1 + 1].offsetSec || 0) - 0.02) : Infinity;
                const prev2End = idx2 > 0 ? (tr2Clips[idx2 - 1].clipStartSec + (tr2Clips[idx2 - 1].offsetSec || 0) + tr2Clips[idx2 - 1].durationSec + 0.02) : 0;
                const next2Start = idx2 + 1 < tr2Clips.length ? (tr2Clips[idx2 + 1].clipStartSec + (tr2Clips[idx2 + 1].offsetSec || 0) - 0.02) : Infinity;

                if (syncTarget1 >= prev1End && syncTarget1 + c1.durationSec <= next1Start) {
                  c1.clipStartSec = syncTarget1;
                  c1.offsetSec = 0;
                }
                if (syncTarget2 >= prev2End && syncTarget2 + c2.durationSec <= next2Start) {
                  c2.clipStartSec = syncTarget2;
                  c2.offsetSec = 0;
                }
                c1.isUnisonPhrase = true;
                c2.isUnisonPhrase = true;
                c1.hasCollision = false;
                c2.hasCollision = false;
                if (c1.timingIssue === 'desync' || c1.timingIssue === 'overlap') {
                  c1.timingIssue = null;
                  c1.timingIssueText = undefined;
                }
                if (c2.timingIssue === 'desync' || c2.timingIssue === 'overlap') {
                  c2.timingIssue = null;
                  c2.timingIssueText = undefined;
                }
                const rmIds = new Set([`issue_desync_${c1.id}`, `issue_desync_${c2.id}`]);
                for (let k = newIssues.length - 1; k >= 0; k--) {
                  if (rmIds.has(newIssues[k].id)) newIssues.splice(k, 1);
                }
                unisonSyncedCount++;
              }
            }
          }
        }
      }

      for (let i = 0; i < trackIds.length; i++) {
        for (let j = i + 1; j < trackIds.length; j++) {
          const tr1Clips = updatedClips[trackIds[i]] || [];
          const tr2Clips = updatedClips[trackIds[j]] || [];

          for (const c1 of tr1Clips) {
            if (c1.isPhysics) continue;
            const c1Start = c1.clipStartSec + (c1.offsetSec || 0);
            const c1End = c1Start + c1.durationSec;

            for (const c2 of tr2Clips) {
              if (c2.isPhysics) continue;
              const c2Start = c2.clipStartSec + (c2.offsetSec || 0);
              const c2End = c2Start + c2.durationSec;

              const overlapStart = Math.max(c1Start, c2Start);
              const overlapEnd = Math.min(c1End, c2End);
              const overlapDur = overlapEnd - overlapStart;

              if (overlapDur > 0.08) {
                const sub1 = findSubForClip(trackIds[i], c1);
                const sub2 = findSubForClip(trackIds[j], c2);

                const normT1 = normalizeSpeechText(sub1?.text || c1.text || '');
                const normT2 = normalizeSpeechText(sub2?.text || c2.text || '');
                const isSamePhrase =
                  Boolean(c1.isUnisonPhrase && c2.isUnisonPhrase && Math.abs(c1Start - c2Start) <= 0.25) ||
                  Boolean(sub1 && sub2 && (
                    (sub1.id !== undefined && sub2.id !== undefined && String(sub1.id) === String(sub2.id)) ||
                    (normT1 !== '' && normT1 === normT2 && Math.abs(sub1.startSec - sub2.startSec) <= 0.08)
                  ));

                if (isSamePhrase) {
                  const buf1 = audioBuffersRef.current[c1.sourceAudioTrackId || trackIds[i]];
                  const buf2 = audioBuffersRef.current[c2.sourceAudioTrackId || trackIds[j]];
                  const onset1 = c1.speechOnsetOffsetSec ?? detectSpeechOnsetOffsetSec(buf1, c1.sourceStartSec, c1.sourceEndSec);
                  const onset2 = c2.speechOnsetOffsetSec ?? detectSpeechOnsetOffsetSec(buf2, c2.sourceStartSec, c2.sourceEndSec);
                  const baseSync = sub1 ? sub1.startSec : c1Start;
                  c1.clipStartSec = Number(Math.max(0, baseSync - onset1).toFixed(3));
                  c1.offsetSec = 0;
                  c2.clipStartSec = Number(Math.max(0, baseSync - onset2).toFixed(3));
                  c2.offsetSec = 0;
                  c1.isUnisonPhrase = true;
                  c2.isUnisonPhrase = true;
                  c1.hasCollision = false;
                  c2.hasCollision = false;
                  continue;
                }

                let isSpecifiedInSubtitles = false;
                if (sub1 && sub2) {
                  const subOverlapStart = Math.max(sub1.startSec, sub2.startSec);
                  const subOverlapEnd = Math.min(sub1.endSec, sub2.endSec);
                  if (subOverlapEnd > subOverlapStart + 0.05) {
                    isSpecifiedInSubtitles = true;
                  }
                }

                if (isSpecifiedInSubtitles && sub1 && sub2) {
                  c1.isIntentionalOverlap = true;
                  c2.isIntentionalOverlap = true;

                  const subOvStart = Number(Math.min(sub1.startSec, sub2.startSec).toFixed(2));
                  const subOvEnd = Number(Math.max(sub1.endSec, sub2.endSec).toFixed(2));
                  const ovStart = Number(overlapStart.toFixed(2));
                  const ovEnd = Number(overlapEnd.toFixed(2));

                  let matchedGroup: IntentionalOverlapMoment | undefined;
                  for (const grp of detectedIntentionalOverlapsMap.values()) {
                    if (Math.min(grp.endSec, Math.max(c1End, c2End)) > Math.max(grp.startSec, Math.min(c1Start, c2Start)) - 0.25) {
                      matchedGroup = grp;
                      break;
                    }
                  }

                  const entry1: IntentionalOverlapTrackEntry = {
                    trackId: trackIds[i],
                    dubberNick: c1.dubberName,
                    characterName: c1.characterName,
                    phraseId: c1.id,
                    subId: String(sub1.id ?? ''),
                    text: sub1.text || c1.text,
                    phraseStartSec: Number(c1Start.toFixed(2)),
                    phraseEndSec: Number(c1End.toFixed(2))
                  };
                  const entry2: IntentionalOverlapTrackEntry = {
                    trackId: trackIds[j],
                    dubberNick: c2.dubberName,
                    characterName: c2.characterName,
                    phraseId: c2.id,
                    subId: String(sub2.id ?? ''),
                    text: sub2.text || c2.text,
                    phraseStartSec: Number(c2Start.toFixed(2)),
                    phraseEndSec: Number(c2End.toFixed(2))
                  };

                  if (!matchedGroup) {
                    const groupId = `sub_overlap_${Math.round(subOvStart * 10)}_${sub1.id ?? i}_${sub2.id ?? j}`;
                    const defaultMainKey = existingPriorityById[groupId] || c1.dubberName;
                    matchedGroup = {
                      id: groupId,
                      startSec: Math.min(entry1.phraseStartSec, entry2.phraseStartSec),
                      endSec: Math.max(entry1.phraseEndSec, entry2.phraseEndSec),
                      overlapStartSec: ovStart,
                      overlapEndSec: ovEnd,
                      subStartSec: subOvStart,
                      subEndSec: subOvEnd,
                      priorityTrackKey: defaultMainKey,
                      attenuationDb: -10,
                      tracks: [entry1, entry2]
                    };
                    detectedIntentionalOverlapsMap.set(groupId, matchedGroup);
                  } else {
                    matchedGroup.startSec = Math.min(matchedGroup.startSec, entry1.phraseStartSec, entry2.phraseStartSec);
                    matchedGroup.endSec = Math.max(matchedGroup.endSec, entry1.phraseEndSec, entry2.phraseEndSec);
                    matchedGroup.overlapStartSec = Math.min(matchedGroup.overlapStartSec, ovStart);
                    matchedGroup.overlapEndSec = Math.max(matchedGroup.overlapEndSec, ovEnd);
                    if (!matchedGroup.tracks.some(t => t.dubberNick === entry1.dubberNick && t.phraseId === entry1.phraseId)) {
                      matchedGroup.tracks.push(entry1);
                    }
                    if (!matchedGroup.tracks.some(t => t.dubberNick === entry2.dubberNick && t.phraseId === entry2.phraseId)) {
                      matchedGroup.tracks.push(entry2);
                    }
                  }

                  const activePrio = matchedGroup.priorityTrackKey || c1.dubberName;
                  c1.overlapGroupId = matchedGroup.id;
                  c2.overlapGroupId = matchedGroup.id;
                  const c1IsMain = c1.dubberName === activePrio || c1.trackId === activePrio || c1.id === activePrio;
                  const c2IsMain = !c1IsMain && (c2.dubberName === activePrio || c2.trackId === activePrio || c2.id === activePrio);
                  c1.overlapRole = c1IsMain ? 'main' : 'secondary';
                  c2.overlapRole = c2IsMain ? 'main' : 'secondary';
                  c1.volumeGainDb = c1.overlapRole === 'main' ? 0 : -10;
                  c2.volumeGainDb = c2.overlapRole === 'main' ? 0 : -10;
                  continue;
                }

                const normD1 = normalizeName(c1.dubberName).split(' ')[0];
                const normD2 = normalizeName(c2.dubberName).split(' ')[0];
                const isSameDubber = normD1 && normD1 === normD2;

                if (isSameDubber) {
                  c1.isSelfOverlap = true;
                  c2.isSelfOverlap = true;
                } else {
                  c1.hasCollision = true;
                  c2.hasCollision = true;
                  c1.overlappingClipId = c2.id;
                  c2.overlappingClipId = c1.id;
                  if (!c1.timingIssue) c1.timingIssue = 'overlap';
                  if (!c2.timingIssue) c2.timingIssue = 'overlap';

                  newCollisions.push({
                    id: `col_${c1.id}_${c2.id}`,
                    track1Id: trackIds[i],
                    track2Id: trackIds[j],
                    dubber1Name: c1.dubberName,
                    dubber2Name: c2.dubberName,
                    character1Name: c1.characterName,
                    character2Name: c2.characterName,
                    startSec: overlapStart,
                    endSec: overlapEnd,
                    overlapDurationSec: Number(overlapDur.toFixed(2))
                  });

                  newIssues.push({
                    id: `issue_overlap_inter_${c1.id}_${c2.id}`,
                    type: 'overlap',
                    trackId: trackIds[j],
                    dubberName: c2.dubberName,
                    characterName: c2.characterName,
                    clipId: c2.id,
                    timeSec: overlapStart,
                    durationSec: overlapDur,
                    overlapDurationSec: Number(overlapDur.toFixed(2)),
                    overlappingClipId: c1.id,
                    overlappingDubber: c1.dubberName,
                    description: `Наезд голосов (не в субтитрах): «${c1.dubberName}» и «${c2.dubberName}» (${overlapDur.toFixed(2)}с) [${formatSeconds(overlapStart)}]`
                  });
                }
              }
            }
          }
        }
      }

      const detectedIntentionalOverlaps = Array.from(detectedIntentionalOverlapsMap.values()).sort((a, b) => a.startSec - b.startSec);
      setIntentionalOverlaps(detectedIntentionalOverlaps);
      setAudioClips(updatedClips);
      setTimingIssues(newIssues);
      setMissingSubtitles(newMissingMarkers);
      setCollisions(newCollisions);
      setIsTimingAnalyzed(true);
      setIsIssuesDrawerOpen(newIssues.length > 0);

      const overlapCount = newIssues.filter(i => i.type === 'overlap').length;
      const desyncCount = newIssues.filter(i => i.type === 'desync').length;
      const missingCount = newIssues.filter(i => i.type === 'missing').length;
      const orphanCount = newIssues.filter(i => i.type === 'orphan').length;

      if (totalPhysicsDetected > 0) {
        addLog(`⚡ Защита физики: распознано и защищено от сдвига/удаления ${totalPhysicsDetected} звуков физики (вздохи/охи/смех вне субтитров).`, 'info');
      }
      if (totalMultiSubClips > 0) {
        addLog(`🔗 Слитные реплики: обнаружено ${totalMultiSubClips} соседних субтитров, озвученных дабберами на одном дыхании в одном клипе.`, 'info');
      }
      if (unisonSyncedCount > 0) {
        addLog(`🔗 Синхронизировано общих фраз (унисон нескольких дабберов по пику атаки голоса): ${unisonSyncedCount} шт.`, 'success');
      }
      if (detectedIntentionalOverlaps.length > 0) {
        addLog(`📋 Зафиксировано ${detectedIntentionalOverlaps.length} сцен одновременной речи по субтитрам — переключатель «★ Главный (0 дБ) / 🔉 Второй (-10 дБ)» доступен прямо на клипах таймлайна.`, 'info');
      }
      addLog(`✓ Этап 1 (Анализ) завершен! Найдено проблем: наездов — ${overlapCount}, рассинхронов — ${desyncCount}, пропущенных — ${missingCount}, подтяжек — ${orphanCount}.`, newIssues.length > 0 ? 'warn' : 'success');

      if (newIssues.length === 0) {
        toast.success('🎉 Анализ завершен! На дорожках нет ни одного наезда, рассинхрона или пропуска.');
      } else {
        toast.warning(`Найдено проблем: ${newIssues.length} (Наезды: ${overlapCount}, Рассинхрон: ${desyncCount}, Пропуски: ${missingCount}). Примените «5. Автотайминг» с финальным самовосстановлением.`, { duration: 6000 });
      }
    } catch (err: any) {
      addLog(`❌ Ошибка этапа 1 (Анализ): ${err.message}`, 'error');
      toast.error(`Ошибка анализа таймингов: ${err.message}`);
    } finally {
      setIsLoading(false);
      clearProcess();
    }
  };

  // Toggle Main (0 dB) vs Secondary (-10 dB) voice directly from an overlapping clip card on the timeline
  const handleSetOverlapMainClip = useCallback((groupId: string, mainClipId: string, mainDubberName: string) => {
    setIntentionalOverlaps(prev =>
      prev.map(grp => grp.id === groupId ? { ...grp, priorityTrackKey: mainDubberName } : grp)
    );
    setAudioClips(prev => {
      const next: Record<string, AudioClip[]> = {};
      for (const [trId, trClips] of Object.entries(prev)) {
        next[trId] = trClips.map(c => {
          if (c.overlapGroupId !== groupId) return c;
          const isMain = c.id === mainClipId || c.dubberName === mainDubberName;
          return {
            ...c,
            overlapRole: isMain ? 'main' : 'secondary',
            volumeGainDb: isMain ? 0 : -10
          };
        });
      }
      return next;
    });
    addLog(`🔊 В пересечении сабов главным голосом выбран «${mainDubberName}» (0 дБ), второстепенные голоса автоматически приглушены на -10 дБ.`, 'info');
    toast.success(`Главный голос: ${mainDubberName} (0 дБ) • Второй голос: -10 дБ`);
  }, [addLog]);

  // Manual toggle between "⚡ Физика" (protected non-subtitle sound) and "💬 Фраза" (dialogue phrase)
  const handleToggleClipPhysics = useCallback((trackId: string, clipId: string) => {
    setAudioClips(prev => {
      const trClips = prev[trackId] || [];
      const trSubs = trackSubLinesMap[trackId] || [];
      const updated = trClips.map(c => {
        if (c.id !== clipId) return c;
        const nextIsPhysics = !c.isPhysics;
        if (nextIsPhysics) {
          addLog(`⚡ Клип «${c.text.slice(0, 25)}» (${formatSeconds(c.clipStartSec)}) помечен как «Физика» — защищён от сдвига и удаления.`, 'info');
          return {
            ...c,
            isPhysics: true,
            timingIssue: null,
            timingIssueText: undefined,
            targetSubStartSec: undefined,
            matchedSubId: undefined,
            coveredSubIds: undefined
          };
        } else {
          const cStart = c.clipStartSec + (c.offsetSec || 0);
          const nearSub = trSubs.find(s => Math.abs(s.startSec - cStart) <= 3.0);
          addLog(`💬 Клип на ${formatSeconds(cStart)} переведён в режим «Фраза диалога»${nearSub ? ` (саб: «${nearSub.text.slice(0, 25)}»)` : ''}.`, 'info');
          return {
            ...c,
            isPhysics: false,
            text: nearSub ? nearSub.text : c.text.replace(/^⚡ Физика\s*\([^)]*\)\s*/i, '') || 'Фраза',
            matchedSubId: nearSub ? String(nearSub.id) : undefined,
            targetSubStartSec: nearSub ? nearSub.startSec : undefined
          };
        }
      });
      return { ...prev, [trackId]: updated };
    });
  }, [trackSubLinesMap, addLog]);

  // ---------------------------------------------------------------------------
  // ITERATIVE SELF-HEALING FINAL AUDIT LOOP
  // Verifies 100% of subtitles across all dubbers. If any subtitle is unvoiced or displaced,
  // searches Fix Track Buffer FIRST (Priority 1), then Original Track Buffer (Priority 2),
  // extracts/restores the missing phrase, re-aligns displaced corridors, and repeats until convergence.
  // ---------------------------------------------------------------------------
  const runIterativeSelfHealingAudit = useCallback((
    clipsInput: Record<string, AudioClip[]>
  ): {
    healedClips: Record<string, AudioClip[]>;
    report: NonNullable<typeof finalVerificationReport>;
  } => {
    const workingClips: Record<string, AudioClip[]> = {};
    for (const [trId, list] of Object.entries(clipsInput)) {
      workingClips[trId] = list.map(c => ({ ...c }));
    }

    const MAX_ITERATIONS = 5;
    let recoveredFromFixCount = 0;
    let recoveredFromOrigCount = 0;
    let realignedCount = 0;
    let iterationsRun = 0;

    for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
      iterationsRun = iter;
      let actionsInPass = 0;

      for (const track of tracks) {
        const trSubs = [...(trackSubLinesMap[track.id] || [])].sort((a, b) => a.startSec - b.startSec);
        if (trSubs.length === 0) continue;

        const dubberName = track.participant || track.dubberName || 'Даббер';
        const characterName = track.character || track.characterName || 'Персонаж';
        const actorNorm = normalizeName(dubberName);

        let trClips = [...(workingClips[track.id] || [])].sort(
          (a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0))
        );

        for (let sIdx = 0; sIdx < trSubs.length; sIdx++) {
          const sub = trSubs[sIdx];
          const subIdStr = String(sub.id ?? sIdx);

          // Check if sub is already voiced and standing in place
          const coveringClipIdx = trClips.findIndex(c => {
            if (c.isPhysics) return false;
            if (c.matchedSubId === subIdStr || c.coveredSubIds?.includes(subIdStr)) return true;
            const cs = c.clipStartSec + (c.offsetSec || 0);
            const ce = cs + c.durationSec;
            return cs <= sub.endSec + 0.45 && ce >= sub.startSec - 0.45;
          });

          if (coveringClipIdx !== -1) {
            const covClip = trClips[coveringClipIdx];
            const covStart = covClip.clipStartSec + (covClip.offsetSec || 0);
            const isPrimaryForSub = !covClip.coveredSubIds || covClip.coveredSubIds[0] === subIdStr || covClip.matchedSubId === subIdStr;

            // Check if this matched phrase is displaced (> 0.35s from sub.startSec)
            if (isPrimaryForSub && !covClip.isUnisonPhrase && Math.abs(covStart - sub.startSec) > 0.35) {
              // Open corridor by nudging blocking neighbors toward their own target subtitles
              if (coveringClipIdx > 0) {
                const prevC = trClips[coveringClipIdx - 1];
                const prevEnd = (prevC.clipStartSec + (prevC.offsetSec || 0)) + prevC.durationSec + 0.04;
                if (prevEnd > sub.startSec && typeof prevC.targetSubStartSec === 'number' && prevC.clipStartSec > prevC.targetSubStartSec) {
                  const prevPrevEnd = coveringClipIdx > 1
                    ? (trClips[coveringClipIdx - 2].clipStartSec + trClips[coveringClipIdx - 2].durationSec + 0.04)
                    : 0;
                  prevC.clipStartSec = Number(Math.max(prevPrevEnd, prevC.targetSubStartSec).toFixed(3));
                  prevC.offsetSec = 0;
                }
              }
              if (coveringClipIdx + 1 < trClips.length) {
                const nextC = trClips[coveringClipIdx + 1];
                const nextStart = nextC.clipStartSec + (nextC.offsetSec || 0);
                if (sub.startSec + covClip.durationSec + 0.04 > nextStart) {
                  const desiredNext = Math.max(nextStart, sub.startSec + covClip.durationSec + 0.04);
                  const nextNextStart = coveringClipIdx + 2 < trClips.length
                    ? (trClips[coveringClipIdx + 2].clipStartSec - nextC.durationSec - 0.04)
                    : Infinity;
                  if (desiredNext <= nextNextStart) {
                    nextC.clipStartSec = Number(desiredNext.toFixed(3));
                    nextC.offsetSec = 0;
                  }
                }
              }

              const prevLim = coveringClipIdx > 0
                ? (trClips[coveringClipIdx - 1].clipStartSec + trClips[coveringClipIdx - 1].durationSec + 0.04)
                : 0;
              const nextLim = coveringClipIdx + 1 < trClips.length
                ? (trClips[coveringClipIdx + 1].clipStartSec - covClip.durationSec - 0.04)
                : Infinity;
              const healedStart = Number(Math.max(0, Math.max(prevLim, Math.min(sub.startSec, Math.max(prevLim, nextLim)))).toFixed(3));

              if (Math.abs(healedStart - covStart) >= 0.04) {
                covClip.clipStartSec = healedStart;
                covClip.offsetSec = 0;
                covClip.matchedSubId = subIdStr;
                covClip.targetSubStartSec = sub.startSec;
                covClip.timeDiffSec = Number((healedStart - sub.startSec).toFixed(2));
                covClip.timingIssue = null;
                realignedCount++;
                actionsInPass++;
                addLog(
                  `🔄 [Аудит Итерация #${iter}] Выровнена сдвинутая реплика «${sub.text.slice(0, 28)}» (${dubberName}) ➔ ${formatSeconds(healedStart)}`,
                  'info'
                );
              }
            }
            continue;
          }

          // Subtitle `sub` is UNVOICED on the timeline!
          // Step A: Check if a nearby clip on the track was mistakenly tagged as Physics (`isPhysics`) or left unattached
          const nearbyPhysicsIdx = trClips.findIndex(c => {
            const cs = c.clipStartSec + (c.offsetSec || 0);
            return c.isPhysics && Math.abs(cs - sub.startSec) <= 2.4;
          });

          if (nearbyPhysicsIdx !== -1) {
            const rescuedClip = trClips[nearbyPhysicsIdx];
            rescuedClip.isPhysics = false;
            rescuedClip.text = sub.text;
            rescuedClip.matchedSubId = subIdStr;
            rescuedClip.coveredSubIds = [subIdStr];
            rescuedClip.targetSubStartSec = sub.startSec;
            rescuedClip.targetSubEndSec = sub.endSec;
            rescuedClip.clipStartSec = Number(sub.startSec.toFixed(3));
            rescuedClip.offsetSec = 0;
            rescuedClip.timingIssue = null;
            realignedCount++;
            actionsInPass++;
            addLog(
              `🛡 [Аудит Итерация #${iter}] Реплика «${sub.text.slice(0, 28)}» (${dubberName}) возвращена из категории физики и поставлена на ${formatSeconds(sub.startSec)}`,
              'success'
            );
            continue;
          }

          // Step B: Search Priority 1 — Fix Track Buffers (`fixBuffersByActorRef`), then Priority 2 — Original Track Buffer (`origBuffersByTrackRef`)
          let recoveredClip: AudioClip | null = null;

          // Priority 1: Fix Track Buffers for this dubber
          const actorFixBuffers = fixBuffersByActorRef.current[actorNorm] || [];
          for (const fixSource of actorFixBuffers) {
            const candidateIntervals = scanBufferWindowForSpeech(
              fixSource.buffer,
              Math.max(0, sub.startSec - 4.0),
              Math.min(fixSource.buffer.duration, sub.endSec + 4.0),
              timingSettings.leadInPaddingSec,
              timingSettings.leadOutPaddingSec
            );
            const unusedIv = candidateIntervals.find(iv =>
              !trClips.some(existing =>
                existing.sourceAudioTrackId === fixSource.sourceTrackId &&
                Math.abs(existing.sourceStartSec - iv.startSec) < 0.22
              )
            );
            if (unusedIv) {
              recoveredClip = {
                id: `clip_${track.id}_healed_fix_${subIdStr}_${iter}`,
                trackId: track.id,
                dubberName,
                characterName,
                clipStartSec: Number(sub.startSec.toFixed(3)),
                durationSec: unusedIv.durationSec,
                sourceStartSec: unusedIv.startSec,
                sourceEndSec: unusedIv.endSec,
                rawSourceStartSec: unusedIv.startSec,
                rawSourceEndSec: unusedIv.endSec,
                sourceAudioTrackId: fixSource.sourceTrackId,
                sourceAudioPath: fixSource.filePath || track.filePath,
                text: sub.text,
                matchedSubId: subIdStr,
                coveredSubIds: [subIdStr],
                targetSubStartSec: sub.startSec,
                targetSubEndSec: sub.endSec,
                volumePercent: 100,
                isFix: true,
                isPhysics: false,
                recoveredFrom: 'fix',
                hasCollision: false,
                offsetSec: 0,
                timingIssue: null
              };
              recoveredFromFixCount++;
              addLog(
                `🚑 [Аудит Итерация #${iter}] Пропущенная реплика «${sub.text.slice(0, 30)}» (${dubberName}) найдена в ДОРОЖКЕ ФИКСОВ [${formatSeconds(unusedIv.startSec)}-${formatSeconds(unusedIv.endSec)}] и восстановлена на ${formatSeconds(sub.startSec)}!`,
                'success'
              );
              break;
            }
          }

          // Priority 2: Original Main Track Buffer
          if (!recoveredClip) {
            const origSource = origBuffersByTrackRef.current[track.id] || (
              audioBuffersRef.current[track.id]
                ? { buffer: audioBuffersRef.current[track.id], filePath: track.filePath, sourceTrackId: track.id }
                : null
            );
            if (origSource && origSource.buffer) {
              const candidateIntervals = scanBufferWindowForSpeech(
                origSource.buffer,
                Math.max(0, sub.startSec - 4.5),
                Math.min(origSource.buffer.duration, sub.endSec + 4.5),
                timingSettings.leadInPaddingSec,
                timingSettings.leadOutPaddingSec
              );
              // Pick the unused interval closest to sub.startSec
              const unusedCandidates = candidateIntervals
                .filter(iv =>
                  !trClips.some(existing =>
                    (existing.sourceAudioTrackId || track.id) === (origSource.sourceTrackId || track.id) &&
                    Math.abs(existing.sourceStartSec - iv.startSec) < 0.22
                  )
                )
                .sort((a, b) => Math.abs(a.startSec - sub.startSec) - Math.abs(b.startSec - sub.startSec));

              if (unusedCandidates.length > 0) {
                const bestIv = unusedCandidates[0];
                recoveredClip = {
                  id: `clip_${track.id}_healed_orig_${subIdStr}_${iter}`,
                  trackId: track.id,
                  dubberName,
                  characterName,
                  clipStartSec: Number(sub.startSec.toFixed(3)),
                  durationSec: bestIv.durationSec,
                  sourceStartSec: bestIv.startSec,
                  sourceEndSec: bestIv.endSec,
                  rawSourceStartSec: bestIv.startSec,
                  rawSourceEndSec: bestIv.endSec,
                  sourceAudioTrackId: origSource.sourceTrackId,
                  sourceAudioPath: origSource.filePath || track.filePath,
                  text: sub.text,
                  matchedSubId: subIdStr,
                  coveredSubIds: [subIdStr],
                  targetSubStartSec: sub.startSec,
                  targetSubEndSec: sub.endSec,
                  volumePercent: 100,
                  isFix: false,
                  isPhysics: false,
                  recoveredFrom: 'original',
                  hasCollision: false,
                  offsetSec: 0,
                  timingIssue: null
                };
                recoveredFromOrigCount++;
                addLog(
                  `🚑 [Аудит Итерация #${iter}] Пропущенная реплика «${sub.text.slice(0, 30)}» (${dubberName}) найдена в ОРИГИНАЛЬНОЙ ДОРОЖКЕ [${formatSeconds(bestIv.startSec)}-${formatSeconds(bestIv.endSec)}] и восстановлена на ${formatSeconds(sub.startSec)}!`,
                  'success'
                );
              }
            }
          }

          if (recoveredClip) {
            trClips.push(recoveredClip);
            trClips.sort((a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0)));
            actionsInPass++;
          }
        }

        // Enforce strict monotonic non-overlapping order (40ms gap) across the track
        trClips.sort((a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0)));
        for (let i = 0; i < trClips.length - 1; i++) {
          const c1 = trClips[i];
          const c2 = trClips[i + 1];
          const c1End = (c1.clipStartSec + (c1.offsetSec || 0)) + c1.durationSec + 0.04;
          const c2Start = c2.clipStartSec + (c2.offsetSec || 0);
          if (c1End > c2Start) {
            c2.clipStartSec = Number(c1End.toFixed(3));
            c2.offsetSec = 0;
          }
        }

        workingClips[track.id] = trClips;
      }

      if (actionsInPass === 0) {
        break;
      }
    }

    // Final Verification Tally across 100% of subtitles of all dubbers
    let totalSubs = 0;
    let voicedSubs = 0;
    let physicsProtectedCount = 0;
    const unvoicedSubs: MissingSubtitleMarker[] = [];

    for (const track of tracks) {
      const trSubs = trackSubLinesMap[track.id] || [];
      const trClips = workingClips[track.id] || [];
      const dubberName = track.participant || track.dubberName || 'Даббер';
      const characterName = track.character || track.characterName || 'Персонаж';

      physicsProtectedCount += trClips.filter(c => c.isPhysics).length;

      for (let sIdx = 0; sIdx < trSubs.length; sIdx++) {
        totalSubs++;
        const sub = trSubs[sIdx];
        const subIdStr = String(sub.id ?? sIdx);
        const isCovered = trClips.some(c => {
          if (c.isPhysics) return false;
          if (c.matchedSubId === subIdStr || c.coveredSubIds?.includes(subIdStr)) return true;
          const cs = c.clipStartSec + (c.offsetSec || 0);
          const ce = cs + c.durationSec;
          return cs <= sub.endSec + 0.55 && ce >= sub.startSec - 0.55;
        });

        if (isCovered) {
          voicedSubs++;
        } else {
          unvoicedSubs.push({
            id: `missing_${track.id}_${subIdStr}`,
            subId: subIdStr,
            trackId: track.id,
            dubberName,
            characterName,
            startSec: sub.startSec,
            endSec: sub.endSec,
            text: sub.text
          });
        }
      }
    }

    return {
      healedClips: workingClips,
      report: {
        totalSubs,
        voicedSubs,
        recoveredFromFixCount,
        recoveredFromOrigCount,
        realignedCount,
        physicsProtectedCount,
        iterationsRun,
        unvoicedSubs,
        passed: unvoicedSubs.length === 0
      }
    };
  }, [tracks, trackSubLinesMap, timingSettings.leadInPaddingSec, timingSettings.leadOutPaddingSec, addLog]);

  // ---------------------------------------------------------------------------
  // ЭТАП 2: ТОЧЕЧНЫЙ ХИРУРГИЧЕСКИЙ АВТОТАЙМИНГ + ИТЕРАЦИОННЫЙ САМОВОССТАНАВЛИВАЮЩИЙСЯ АУДИТ
  // ---------------------------------------------------------------------------
  const handleApplyTargetedAutoTiming = async (typeFilter: 'all' | 'overlap' | 'desync' | 'orphan' = 'all') => {
    if (tracks.length === 0) return;
    try {
      setIsLoading(true);
      updateProcess('2. Точечный автотайминг', 'Точечное выравнивание фраз под субтитры с защитой физики...', 25, 1, 3);
      addLog(`Запуск Этапа 2: точечный автотайминг + финальная самовосстанавливающаяся проверка всех сабов (фильтр: ${typeFilter})...`, 'info');
      await new Promise(r => setTimeout(r, 0));

      const updatedClips = { ...audioClips };
      let fixedDesyncCount = 0;
      let fixedOverlapCount = 0;
      let fixedOrphanCount = 0;

      // 1 & 2. Хирургическое выравнивание рассинхрона (Desync) и локальных фраз (Orphan) строго внутри коридора дорожки (физику не трогаем!)
      for (const trackId of Object.keys(updatedClips)) {
        const clips = [...(updatedClips[trackId] || [])].sort(
          (a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0))
        );

        for (let idx = 0; idx < clips.length; idx++) {
          const clip = clips[idx];
          if (clip.isPhysics) continue; // Защита физики: никогда не тянем физику на субтитры

          const shouldFixDesync = clip.timingIssue === 'desync' && (typeFilter === 'all' || typeFilter === 'desync');
          const shouldFixOrphan = clip.timingIssue === 'orphan' && (typeFilter === 'all' || typeFilter === 'orphan');

          if ((shouldFixDesync || shouldFixOrphan) && typeof clip.targetSubStartSec === 'number') {
            const curStart = clip.clipStartSec + (clip.offsetSec || 0);
            const prevEnd = idx > 0
              ? (clips[idx - 1].clipStartSec + (clips[idx - 1].offsetSec || 0) + clips[idx - 1].durationSec + 0.04)
              : 0;
            const nextStart = idx + 1 < clips.length
              ? (clips[idx + 1].clipStartSec + (clips[idx + 1].offsetSec || 0) - 0.04)
              : Infinity;

            let safeStart = Math.max(curStart - 2.2, Math.min(curStart + 2.2, clip.targetSubStartSec));
            safeStart = Math.max(prevEnd, Math.min(safeStart, Math.max(prevEnd, nextStart - clip.durationSec)));
            safeStart = Number(Math.max(0, safeStart).toFixed(3));

            if (Math.abs(safeStart - curStart) >= 0.03) {
              if (shouldFixDesync) fixedDesyncCount++;
              else fixedOrphanCount++;
              addLog(`🎯 Хирургически пододвинута фраза «${clip.text.slice(0, 25)}» с ${formatSeconds(curStart)} ➔ ${formatSeconds(safeStart)}`, 'info');
              clips[idx] = {
                ...clip,
                clipStartSec: safeStart,
                offsetSec: 0,
                timingIssue: null,
                timingIssueText: undefined,
                timeDiffSec: 0
              };
            } else {
              clips[idx] = {
                ...clip,
                timingIssue: null,
                timingIssueText: undefined
              };
            }
          }
        }
        updatedClips[trackId] = clips;
      }

      updateProcess('2. Точечный автотайминг', 'Хирургическое разведение внутридорожечных и междорожечных наездов...', 60, 2, 3);
      await new Promise(r => setTimeout(r, 0));

      // 3. Хирургическое разведение наездов (Overlap)
      if (typeFilter === 'all' || typeFilter === 'overlap') {
        for (const trackId of Object.keys(updatedClips)) {
          const clips = [...(updatedClips[trackId] || [])];
          clips.sort((a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0)));

          for (let i = 0; i < clips.length - 1; i++) {
            const c1 = clips[i];
            const c2 = clips[i + 1];
            const c1End = (c1.clipStartSec + (c1.offsetSec || 0)) + c1.durationSec;
            const c2Start = c2.clipStartSec + (c2.offsetSec || 0);

            if (c1End > c2Start) {
              if (typeof c1.targetSubStartSec === 'number' && c1.clipStartSec > c1.targetSubStartSec) {
                const prevLimit = i > 0 ? ((clips[i - 1].clipStartSec + (clips[i - 1].offsetSec || 0)) + clips[i - 1].durationSec + 0.04) : 0;
                const canMoveBack = Math.min(0.8, Math.max(0, c1.clipStartSec - Math.max(c1.targetSubStartSec, prevLimit)));
                if (canMoveBack > 0.01) {
                  c1.clipStartSec = Number((c1.clipStartSec - canMoveBack).toFixed(3));
                  c1.offsetSec = 0;
                }
              }
              const newC1End = (c1.clipStartSec + (c1.offsetSec || 0)) + c1.durationSec;
              if (newC1End > (c2.clipStartSec + (c2.offsetSec || 0))) {
                const nextLimit = i + 2 < clips.length
                  ? (clips[i + 2].clipStartSec + (clips[i + 2].offsetSec || 0) - c2.durationSec - 0.04)
                  : Infinity;
                const rawShift = (newC1End - (c2.clipStartSec + (c2.offsetSec || 0))) + 0.04;
                const clampedShift = Math.min(1.2, rawShift);
                const targetC2Start = Math.min(nextLimit, c2.clipStartSec + clampedShift);
                if (targetC2Start > c2.clipStartSec) {
                  c2.clipStartSec = Number(targetC2Start.toFixed(3));
                  c2.offsetSec = 0;
                }
              }
              c1.hasCollision = false;
              c2.hasCollision = false;
              c1.timingIssue = null;
              c2.timingIssue = null;
              c1.timingIssueText = undefined;
              c2.timingIssueText = undefined;
              fixedOverlapCount++;
              addLog(`↔️ Хирургически раздвинут наезд в «${c1.dubberName}»: фраза #${i + 2} пододвинута на (${formatSeconds(c2.clipStartSec)})`, 'info');
            }
          }
          updatedClips[trackId] = clips;
        }

        for (const col of collisions) {
          const tr1 = updatedClips[col.track1Id] || [];
          const tr2 = updatedClips[col.track2Id] || [];
          const c1Idx = tr1.findIndex(c => {
            const s = c.clipStartSec + (c.offsetSec || 0);
            const e = s + c.durationSec;
            return s < col.endSec && e > col.startSec;
          });
          const c2Idx = tr2.findIndex(c => {
            const s = c.clipStartSec + (c.offsetSec || 0);
            const e = s + c.durationSec;
            return s < col.endSec && e > col.startSec;
          });

          if (c1Idx !== -1 && c2Idx !== -1) {
            const c1 = tr1[c1Idx];
            const c2 = tr2[c2Idx];
            const c1End = (c1.clipStartSec + (c1.offsetSec || 0)) + c1.durationSec;
            const c2Start = c2.clipStartSec + (c2.offsetSec || 0);
            if (c1End > c2Start) {
              const rawShift = (c1End - c2Start) + 0.04;
              if (rawShift <= 1.25) {
                const nextInTr2 = c2Idx + 1 < tr2.length
                  ? (tr2[c2Idx + 1].clipStartSec + (tr2[c2Idx + 1].offsetSec || 0) - c2.durationSec - 0.04)
                  : Infinity;
                const safeC2Start = Math.min(nextInTr2, c2Start + rawShift);
                if (safeC2Start > c2Start) {
                  c2.clipStartSec = Number(safeC2Start.toFixed(3));
                  c2.offsetSec = 0;
                  fixedOverlapCount++;
                  addLog(`↔️ Хирургически раздвинут наезд между «${col.dubber1Name}» и «${col.dubber2Name}» (+${(safeC2Start - c2Start).toFixed(2)}с)`, 'info');
                }
              }
              c1.hasCollision = false;
              c2.hasCollision = false;
              c1.timingIssue = null;
              c2.timingIssue = null;
            }
          }
        }
      }

      // 4. ИТЕРАЦИОННАЯ ФИНАЛЬНАЯ ПРОВЕРКА И САМОВОССТАНОВЛЕНИЕ ВСЕХ САБОВ ВСЕХ ДАББЕРОВ
      updateProcess(
        '3. Финальный аудит и самовосстановление',
        'Проверка 100% субтитров всех дабберов и поиск пропавших реплик (Фиксы ➔ Оригинал)...',
        88,
        3,
        3
      );
      await new Promise(r => setTimeout(r, 0));

      const { healedClips, report } = runIterativeSelfHealingAudit(updatedClips);
      setAudioClips(healedClips);
      setFinalVerificationReport(report);
      setMissingSubtitles(report.unvoicedSubs);

      // Filter out resolved issues (including missing subtitles that were recovered by the self-healing audit)
      const remainingUnvoicedSubIds = new Set(report.unvoicedSubs.map(u => `${u.trackId}_${u.subId}`));
      const remainingIssues = timingIssues.filter(issue => {
        if (issue.type === 'desync' && (typeFilter === 'all' || typeFilter === 'desync')) return false;
        if (issue.type === 'overlap' && (typeFilter === 'all' || typeFilter === 'overlap')) return false;
        if (issue.type === 'orphan' && (typeFilter === 'all' || typeFilter === 'orphan')) {
          const targetClip = Object.values(healedClips).flat().find(c => c.id === issue.clipId);
          return targetClip?.timingIssue === 'orphan';
        }
        if (issue.type === 'missing') {
          const matchUnvoiced = report.unvoicedSubs.some(
            u => u.trackId === issue.trackId && Math.abs(u.startSec - issue.timeSec) < 0.25
          );
          return matchUnvoiced && remainingUnvoicedSubIds.size > 0;
        }
        return true;
      });
      setTimingIssues(remainingIssues);
      setCollisions([]);

      const totalFixed = fixedDesyncCount + fixedOverlapCount + fixedOrphanCount + report.recoveredFromFixCount + report.recoveredFromOrigCount + report.realignedCount;

      if (report.passed) {
        addLog(
          `✅ ФИНАЛЬНАЯ ПРОВЕРКА ПРОЙДЕНА (итераций: ${report.iterationsRun}): 100% субтитров всех дабберов (${report.voicedSubs}/${report.totalSubs}) озвучены и стоят на своих местах! Восстановлено из фиксов: ${report.recoveredFromFixCount}, из оригинала: ${report.recoveredFromOrigCount}, довыровнено: ${report.realignedCount}, защищено физики: ${report.physicsProtectedCount}.`,
          'success'
        );
        toast.success(
          `Финальная проверка пройдена! Все ${report.voicedSubs}/${report.totalSubs} сабов на местах (восстановлено: ${report.recoveredFromFixCount + report.recoveredFromOrigCount}, исправлено: ${totalFixed}).`
        );
      } else {
        addLog(
          `⚠️ Финальный аудит завершён за ${report.iterationsRun} итераций: озвучено ${report.voicedSubs}/${report.totalSubs} сабов (восстановлено из фиксов: ${report.recoveredFromFixCount}, из оригинала: ${report.recoveredFromOrigCount}). Не найдено звука ни в фиксе, ни в оригинале для ${report.unvoicedSubs.length} сабов.`,
          'warn'
        );
        toast.warning(
          `Автотайминг и самовосстановление завершены! Озвучено ${report.voicedSubs}/${report.totalSubs} сабов (восстановлено: ${report.recoveredFromFixCount + report.recoveredFromOrigCount}). Не озвучено в исходниках: ${report.unvoicedSubs.length}.`,
          { duration: 6000 }
        );
      }
    } catch (err: any) {
      addLog(`❌ Ошибка этапа 2 (Точечный автотайминг): ${err.message}`, 'error');
      toast.error(`Ошибка применения автотайминга: ${err.message}`);
    } finally {
      setIsLoading(false);
      clearProcess();
    }
  };

  // Quick surgical fixer for a single desynced clip or orphan clip
  const handleFixSingleClip = (trackId: string, clipId: string) => {
    setAudioClips(prev => {
      const trClips = prev[trackId] || [];
      const updated = trClips.map(c => {
        if (c.id === clipId && typeof c.targetSubStartSec === 'number') {
          addLog(`🎯 Фраза «${c.text.slice(0, 25)}» точечно пододвинута под субтитр на ${formatSeconds(c.targetSubStartSec)}`, 'success');
          return {
            ...c,
            clipStartSec: c.targetSubStartSec,
            offsetSec: 0,
            timingIssue: null,
            timingIssueText: undefined,
            timeDiffSec: 0
          };
        }
        return c;
      });
      return { ...prev, [trackId]: updated };
    });
    setTimingIssues(prev => prev.filter(i => i.clipId !== clipId));
    toast.success('Фраза точечно пододвинута к субтитру!');
  };

  // Quick surgical fixer for an overlap collision (intra-track or inter-track)
  const handleResolveSingleOverlap = (trackId: string, clipId: string) => {
    setAudioClips(prev => {
      const updated = { ...prev };
      let targetClip: AudioClip | null = null;
      let targetTrackId = trackId;

      for (const [tId, clips] of Object.entries(updated)) {
        const found = clips.find(c => c.id === clipId);
        if (found) {
          targetClip = found;
          targetTrackId = tId;
          break;
        }
      }
      if (!targetClip) return prev;

      let collidingClip: AudioClip | null = null;
      if (targetClip.overlappingClipId) {
        for (const clips of Object.values(updated)) {
          const found = clips.find(c => c.id === targetClip!.overlappingClipId);
          if (found) {
            collidingClip = found;
            break;
          }
        }
      }

      if (collidingClip) {
        const colEnd = (collidingClip.clipStartSec + (collidingClip.offsetSec || 0)) + collidingClip.durationSec;
        const curStart = targetClip.clipStartSec + (targetClip.offsetSec || 0);
        if (colEnd > curStart) {
          const shift = (colEnd - curStart) + 0.04;
          targetClip.clipStartSec = Number((targetClip.clipStartSec + shift).toFixed(3));
          targetClip.offsetSec = 0;
          targetClip.hasCollision = false;
          collidingClip.hasCollision = false;
          targetClip.timingIssue = null;
          collidingClip.timingIssue = null;
          addLog(`↔️ Раздвинут наезд: «${targetClip.text}» сдвинута на +${shift.toFixed(2)}с`, 'success');
        }
      } else {
        const trClips = [...(updated[targetTrackId] || [])];
        trClips.sort((a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0)));
        const idx = trClips.findIndex(c => c.id === clipId);
        if (idx > 0) {
          const prevClip = trClips[idx - 1];
          const prevEnd = (prevClip.clipStartSec + (prevClip.offsetSec || 0)) + prevClip.durationSec;
          const curStart = targetClip.clipStartSec + (targetClip.offsetSec || 0);
          if (prevEnd > curStart) {
            const shift = (prevEnd - curStart) + 0.04;
            targetClip.clipStartSec = Number((targetClip.clipStartSec + shift).toFixed(3));
            targetClip.offsetSec = 0;
            targetClip.hasCollision = false;
            prevClip.hasCollision = false;
            targetClip.timingIssue = null;
            prevClip.timingIssue = null;
            addLog(`↔️ Раздвинут наезд внутри дорожки: «${targetClip.text}» сдвинута на +${shift.toFixed(2)}с`, 'success');
          }
        }
        updated[targetTrackId] = trClips;
      }

      return updated;
    });
    setTimingIssues(prev => prev.filter(i => i.clipId !== clipId));
    toast.success('Наезд точечно раздвинут!');
  };

  // Quick clipboard helper for missing phrases
  const handleCopyMissingTimecode = (text: string, startSec: number, endSec: number) => {
    const formatted = `[${formatSeconds(startSec)} - ${formatSeconds(endSec)}] ${text}`;
    navigator.clipboard?.writeText(formatted);
    toast.success(`Таймкод скопирован: ${formatted}`);
  };

  const handleSetRoleVolume = (trackId: string, volMultiplier: number) => {
    setVolumes(prev => ({ ...prev, [trackId]: volMultiplier }));
    const volPct = Math.round(volMultiplier * 100);
    setAudioClips(prev => {
      const trClips = prev[trackId] || [];
      const updated = trClips.map(b => ({ ...b, volumePercent: volPct }));
      return { ...prev, [trackId]: updated };
    });
    toast.info(`Громкость роли установлена: ${volPct}%`);
  };

  const handleSetClipVolume = (trackId: string, clipId: string, volPct: number) => {
    setAudioClips(prev => {
      const trClips = prev[trackId] || [];
      const updated = trClips.map(b => b.id === clipId ? { ...b, volumePercent: volPct } : b);
      return { ...prev, [trackId]: updated };
    });
  };

  const handleSplitClip = (trackId: string, clipId: string) => {
    setAudioClips(prev => {
      const trClips = prev[trackId] || [];
      const updated: AudioClip[] = [];
      for (const b of trClips) {
        if (b.id === clipId) {
          const half = Number((b.durationSec / 2).toFixed(2));
          updated.push({
            ...b,
            id: `${b.id}_1`,
            durationSec: half,
            sourceEndSec: b.sourceStartSec + half,
            text: `${b.text} (1/2)`
          });
          updated.push({
            ...b,
            id: `${b.id}_2`,
            clipStartSec: b.clipStartSec + half,
            durationSec: half,
            sourceStartSec: b.sourceStartSec + half,
            text: `${b.text} (2/2)`
          });
        } else {
          updated.push(b);
        }
      }
      return { ...prev, [trackId]: updated };
    });
    toast.success('Клип разрезан на две части');
  };

  const handleNudgeClip = (trackId: string, clipId: string, deltaSec: number) => {
    setAudioClips(prev => {
      const trClips = prev[trackId] || [];
      const updated = trClips.map(b => {
        if (b.id === clipId) {
          const newStart = Math.max(0, Number((b.clipStartSec + deltaSec).toFixed(2)));
          return { ...b, clipStartSec: newStart };
        }
        return b;
      });
      return { ...prev, [trackId]: updated };
    });
  };

  const handleAICleanupTrack = async (
    trackId: string,
    actionType: 'deplosive' | 'thickener' | 'leveler' | 'dereverb' | 'headroom' | 'voicefixer' | 'denoise'
  ) => {
    const audioBuf = audioBuffersRef.current[trackId];
    if (!audioBuf) {
      toast.error('Аудиодорожка еще не декодирована');
      return;
    }
    const tr = tracks.find(t => t.id === trackId);
    const dubberName = tr?.participant || tr?.dubberName || 'Даббер';

    try {
      setAiProcessingTrackId(trackId);
      setActiveAiMenuTrackId(null);
      const sharedAudioCtx = getSharedAudioContext();
      if (!sharedAudioCtx) return;

      const numChannels = audioBuf.numberOfChannels;
      const sampleRate = audioBuf.sampleRate;
      const length = audioBuf.length;

      const newAudioBuf = sharedAudioCtx.createBuffer(numChannels, length, sampleRate);

      for (let ch = 0; ch < numChannels; ch++) {
        updateProcess(
          `AI обработка дорожки «${dubberName}»`,
          `Фильтр «${actionType}» (канал ${ch + 1}/${numChannels})...`,
          Math.round(((ch + 0.5) / Math.max(1, numChannels)) * 90),
          ch + 1,
          numChannels
        );
        const inputData = new Float32Array(audioBuf.getChannelData(ch));
        let processedData: Float32Array;

        switch (actionType) {
          case 'deplosive':
            toast.info(`[AI De-Plosive] Подавление задувов и хлопков «П»/«Б» для «${dubberName}»...`);
            processedData = await globalAudioAICleanupEngine.processDePlosive(inputData, { sampleRate });
            break;
          case 'thickener':
            toast.info(`[AI Vocal Thickener] Добавление плотности и ленточной сатурации для «${dubberName}»...`);
            processedData = await globalAudioAICleanupEngine.processVocalThickener(inputData, { sampleRate });
            break;
          case 'leveler':
            toast.info(`[AI Speech Leveler] Выравнивание скачков громкости речи для «${dubberName}»...`);
            processedData = await globalAudioAICleanupEngine.processSpeechLeveler(inputData, { sampleRate });
            break;
          case 'dereverb':
            toast.info(`[AI Spectral De-Reverb] Подавление комнатного эха для «${dubberName}»...`);
            processedData = await globalAudioAICleanupEngine.processSpectralDeReverb(inputData, { sampleRate });
            break;
          case 'headroom':
            toast.info(`[AI Headroom Recovery] Разгон тихих фраз с True-Peak лимитером для «${dubberName}»...`);
            processedData = await globalAudioAICleanupEngine.processHeadroomRecovery(inputData, { sampleRate });
            break;
          case 'voicefixer':
            toast.info(`[AI VoiceFixer] Восстановление обертонов и верхов для «${dubberName}»...`);
            processedData = await globalAudioAICleanupEngine.processVoiceFixer(inputData, { sampleRate });
            break;
          case 'denoise':
            toast.info(`[AI Denoise] Шумоподавление для «${dubberName}»...`);
            processedData = await globalAudioAICleanupEngine.processDenoise(inputData, { modelId: 'deepfilternet3', intensityPercent: 75, sampleRate });
            break;
          default:
            processedData = inputData;
        }

        newAudioBuf.copyToChannel(new Float32Array(processedData), ch);
      }

      audioBuffersRef.current[trackId] = newAudioBuf;
      const updatedNorm = analyzeAudioBufferForPreview(newAudioBuf, `${trackId}_${Date.now()}`);
      setNormalizationMetrics(prev => ({ ...prev, [trackId]: updatedNorm }));
      setAudioClips(prev => ({ ...prev }));
      toast.success(`✓ [AI Cleanup] Дорожка «${dubberName}» успешно обработана!`);
      addLog(`✨ [AI Cleanup] Дорожка «${dubberName}» успешно обработана фильтром ${actionType}`, 'success');
    } catch (e: any) {
      toast.error(`Ошибка обработки: ${e.message || String(e)}`);
      addLog(`❌ [AI Cleanup] Ошибка: ${e.message}`, 'error');
    } finally {
      setAiProcessingTrackId(null);
      clearProcess();
    }
  };

  const buildExportIntentionalOverlapsAndSyncUnison = (
    clipsMap: Record<string, AudioClip[]>
  ): IntentionalOverlapMoment[] => {
    const trackIds = Object.keys(clipsMap);
    const existingPriorityById: Record<string, string | null> = {};
    intentionalOverlaps.forEach(ov => {
      if (ov.id && ov.priorityTrackKey) existingPriorityById[ov.id] = ov.priorityTrackKey;
    });

    const findSub = (trId: string, clip: AudioClip) => {
      const list = trackSubLinesMap[trId] || [];
      const cStart = clip.clipStartSec + (clip.offsetSec || 0);
      if (clip.matchedSubId) {
        const byId = list.find(s => String(s.id) === clip.matchedSubId);
        if (byId) return byId;
      }
      return list.find(s =>
        s.text === clip.text ||
        (typeof clip.targetSubStartSec === 'number' && Math.abs(s.startSec - clip.targetSubStartSec) < 0.25) ||
        Math.abs(s.startSec - cStart) < 1.2
      );
    };

    const overlapsMap = new Map<string, IntentionalOverlapMoment>();

    for (let i = 0; i < trackIds.length; i++) {
      for (let j = i + 1; j < trackIds.length; j++) {
        const tr1Clips = clipsMap[trackIds[i]] || [];
        const tr2Clips = clipsMap[trackIds[j]] || [];

        for (const c1 of tr1Clips) {
          const c1Start = c1.clipStartSec + (c1.offsetSec || 0);
          const c1End = c1Start + c1.durationSec;
          const sub1 = findSub(trackIds[i], c1);

          for (const c2 of tr2Clips) {
            const c2Start = c2.clipStartSec + (c2.offsetSec || 0);
            const c2End = c2Start + c2.durationSec;
            const sub2 = findSub(trackIds[j], c2);

            if (!sub1 || !sub2) continue;

            const normT1 = normalizeSpeechText(sub1.text || c1.text || '');
            const normT2 = normalizeSpeechText(sub2.text || c2.text || '');
            const isSamePhrase =
              (sub1.id !== undefined && sub2.id !== undefined && String(sub1.id) === String(sub2.id)) ||
              (normT1 !== '' && normT1 === normT2 && Math.abs(sub1.startSec - sub2.startSec) <= 0.08);

            if (isSamePhrase) {
              const syncStart = Number(Math.max(0, sub1.startSec).toFixed(3));
              c1.clipStartSec = syncStart;
              c1.offsetSec = 0;
              c2.clipStartSec = syncStart;
              c2.offsetSec = 0;
              c1.isUnisonPhrase = true;
              c2.isUnisonPhrase = true;
              continue;
            }

            const subOvStart = Math.max(sub1.startSec, sub2.startSec);
            const subOvEnd = Math.min(sub1.endSec, sub2.endSec);
            if (subOvEnd > subOvStart + 0.05) {
              c1.isIntentionalOverlap = true;
              c2.isIntentionalOverlap = true;

              const ovStart = Number(Math.max(c1Start, c2Start).toFixed(2));
              const ovEnd = Number(Math.min(c1End, c2End).toFixed(2));
              const sStart = Number(Math.min(sub1.startSec, sub2.startSec).toFixed(2));
              const sEnd = Number(Math.max(sub1.endSec, sub2.endSec).toFixed(2));

              let matchedGroup: IntentionalOverlapMoment | undefined;
              for (const grp of overlapsMap.values()) {
                if (Math.min(grp.endSec, Math.max(c1End, c2End)) > Math.max(grp.startSec, Math.min(c1Start, c2Start)) - 0.25) {
                  matchedGroup = grp;
                  break;
                }
              }

              const entry1: IntentionalOverlapTrackEntry = {
                trackId: trackIds[i],
                dubberNick: c1.dubberName,
                characterName: c1.characterName,
                phraseId: c1.id,
                subId: String(sub1.id ?? ''),
                text: sub1.text || c1.text,
                phraseStartSec: Number(c1Start.toFixed(2)),
                phraseEndSec: Number(c1End.toFixed(2))
              };
              const entry2: IntentionalOverlapTrackEntry = {
                trackId: trackIds[j],
                dubberNick: c2.dubberName,
                characterName: c2.characterName,
                phraseId: c2.id,
                subId: String(sub2.id ?? ''),
                text: sub2.text || c2.text,
                phraseStartSec: Number(c2Start.toFixed(2)),
                phraseEndSec: Number(c2End.toFixed(2))
              };

              if (!matchedGroup) {
                const groupId = c1.overlapGroupId || c2.overlapGroupId || `sub_overlap_${Math.round(sStart * 10)}_${sub1.id ?? i}_${sub2.id ?? j}`;
                const chosenMainKey =
                  c1.overlapRole === 'main'
                    ? `${trackIds[i]}::${c1.id}`
                    : c2.overlapRole === 'main'
                    ? `${trackIds[j]}::${c2.id}`
                    : existingPriorityById[groupId] || null;
                matchedGroup = {
                  id: groupId,
                  startSec: Math.min(entry1.phraseStartSec, entry2.phraseStartSec),
                  endSec: Math.max(entry1.phraseEndSec, entry2.phraseEndSec),
                  overlapStartSec: ovStart,
                  overlapEndSec: Math.max(ovStart + 0.1, ovEnd),
                  subStartSec: sStart,
                  subEndSec: sEnd,
                  priorityTrackKey: chosenMainKey,
                  attenuationDb: -10,
                  tracks: [entry1, entry2]
                };
                overlapsMap.set(groupId, matchedGroup);
              } else {
                matchedGroup.startSec = Math.min(matchedGroup.startSec, entry1.phraseStartSec, entry2.phraseStartSec);
                matchedGroup.endSec = Math.max(matchedGroup.endSec, entry1.phraseEndSec, entry2.phraseEndSec);
                if (c1.overlapRole === 'main') matchedGroup.priorityTrackKey = `${trackIds[i]}::${c1.id}`;
                else if (c2.overlapRole === 'main') matchedGroup.priorityTrackKey = `${trackIds[j]}::${c2.id}`;
                if (!matchedGroup.tracks.some(t => t.dubberNick === entry1.dubberNick && t.phraseId === entry1.phraseId)) {
                  matchedGroup.tracks.push(entry1);
                }
                if (!matchedGroup.tracks.some(t => t.dubberNick === entry2.dubberNick && t.phraseId === entry2.phraseId)) {
                  matchedGroup.tracks.push(entry2);
                }
              }
            }
          }
        }
      }
    }

    const result = Array.from(overlapsMap.values()).sort((a, b) => a.startSec - b.startSec);
    return result.length > 0 ? result : intentionalOverlaps;
  };

  const handleExportToMixing = async () => {
    if (!currentEpisode) return;
    try {
      setIsExportingToMixing(true);
      updateProcess('Экспорт в Сведение', 'Подготовка метаданных и рендеринг оттаймленных мастер-дорожек...', 15, 1, 2);
      addLog('🎬 Старт экспорта в Сведение: рендеринг всех готовых дорожек каждого даббера...', 'info');

      const enrichedAudioClips: Record<string, AudioClip[]> = {};
      for (const trId of Object.keys(audioClips)) {
        const tr = tracks.find(t => t.id === trId);
        const clips = audioClips[trId] || [];
        enrichedAudioClips[trId] = clips.map(c => ({
          ...c,
          volumePercent: c.volumePercent ?? 100,
          volumeGainDb: c.volumeGainDb ?? 0,
          sourceAudioPath: c.sourceAudioPath || tr?.filePath
        }));
      }

      const exportIntentionalOverlaps = buildExportIntentionalOverlapsAndSyncUnison(enrichedAudioClips);
      setIntentionalOverlaps(exportIntentionalOverlaps);

      let targetDir = '';
      try {
        const res: any = await ipcSafe.invoke('mixing-get-status', { episode: currentEpisode });
        if (res && res.workingDir) {
          targetDir = res.workingDir;
        }
      } catch (e) {}

      if (!targetDir) {
        const baseFile = currentEpisode.rawPath || currentEpisode.subPath;
        if (baseFile) {
          const isWin = baseFile.includes('\\');
          const sep = isWin ? '\\' : '/';
          const lastSlashIndex = Math.max(baseFile.lastIndexOf('/'), baseFile.lastIndexOf('\\'));
          const epFolder = lastSlashIndex !== -1 ? baseFile.substring(0, lastSlashIndex) : baseFile;
          targetDir = `${epFolder}${sep}Сведения`;
        }
      }

      const timingMetadata = {
        version: '1.0',
        updatedAt: new Date().toISOString(),
        episodeNumber: currentEpisode?.number || 1,
        defaultVolumePercent: 100,
        intentionalOverlaps: exportIntentionalOverlaps,
        rolesVolumeMap: tracks.reduce((acc, tr) => {
          const roleName = tr.character || tr.characterName || tr.participant || 'Персонаж';
          const dubberNick = tr.participant || tr.dubberName || 'Даббер';
          acc[roleName] = 100;
          acc[dubberNick] = 100;
          return acc;
        }, {} as Record<string, number>),
        phrases: Object.keys(enrichedAudioClips).flatMap(trId => {
          const clips = enrichedAudioClips[trId] || [];
          return clips.map(b => {
            return {
              id: b.id,
              dubberNick: b.dubberName,
              characterName: b.characterName,
              startSec: Number((b.clipStartSec + (b.offsetSec || 0)).toFixed(2)),
              endSec: Number((b.clipStartSec + (b.offsetSec || 0) + b.durationSec).toFixed(2)),
              durationSec: Number(b.durationSec.toFixed(2)),
              text: b.text,
              isUnisonPhrase: Boolean(b.isUnisonPhrase),
              isIntentionalOverlap: Boolean(b.isIntentionalOverlap),
              isPhysics: Boolean(b.isPhysics),
              volumePercent: b.volumePercent ?? 100,
              volumeGainDb: b.volumeGainDb ?? 0,
              pan: 0,
              timeStretch: 1.0,
              headTrimSec: 0,
              tailTrimSec: 0
            };
          });
        })
      };

      try {
        await ipcSafe.invoke('mixing-save-timing-metadata', {
          episode: currentEpisode,
          timingMetadata
        });
        const epDir = (currentEpisode as any)?.folderPath || targetDir;
        if (epDir) {
          await ipcSafe.invoke('audio-save-timing-analysis', {
            episodeDir: epDir,
            data: timingMetadata
          });
        }
      } catch (e) {}

      updateProcess('Экспорт в Сведение', 'Рендеринг и сохранение мастер-дорожек дабберов...', 55, 2, 2);
      const unsubMix = ipcSafe.on('mixing-progress', (p: any) => {
        if (p && typeof p.percent === 'number') {
          updateProcess(
            'Экспорт в Сведение',
            p.message || 'Рендеринг мастер-дорожек...',
            Math.round(55 + p.percent * 0.45),
            2,
            2
          );
        }
      });

      let res: any;
      try {
        res = await ipcSafe.invoke('timing-export-to-mixing', {
          episode: currentEpisode,
          targetDir: targetDir || undefined,
          tracks,
          audioClips: enrichedAudioClips,
          volumes,
          timingMetadata
        });
      } finally {
        if (typeof unsubMix === 'function') unsubMix();
      }

      if (res && res.success === false) {
        throw new Error(res.error || 'Не удалось экспортировать дорожки в сведение');
      }

      updateProcess('Экспорт в Сведение', 'Мастер-дорожки успешно переданы в Сведение!', 100, 2, 2);
      toast.success('Готовые сведённые дорожки переданы в Сведение видео!');
      addLog('✓ Все оттаймленные дорожки дабберов успешно сведены и отправлены в Сведение', 'success');
      if (onNavigate) onNavigate('mixing');
    } catch (err: any) {
      toast.error(`Ошибка: ${err.message}`);
      addLog(`❌ Ошибка передачи в сведение: ${err.message}`, 'error');
    } finally {
      setIsExportingToMixing(false);
      clearProcess();
    }
  };

  const handleExportSoundEngineerFromTiming = async (
    targetDir: string,
    skipConversion: boolean,
    smartExport?: boolean,
    _uploadToYandex?: boolean,
    additionalProcessing?: boolean,
    autoApplyFixes?: boolean,
    includeSubtitles?: boolean,
    autoTiming?: boolean
  ) => {
    if (!currentEpisode || !targetDir) return;

    try {
      setIsExportingSE(true);
      setExportProgress(5);
      updateProcess('Экспорт звукорежиссёру', `Экспорт комплекта файлов в «${targetDir}»...`, 10);
      addLog(`Старт экспорта для звукорежиссёра в директорию: ${targetDir}`, 'info');

      const exportIntentionalOverlaps = buildExportIntentionalOverlapsAndSyncUnison(audioClips);

      const timingMetadata = {
        version: '1.0',
        updatedAt: new Date().toISOString(),
        episodeNumber: currentEpisode?.number || 1,
        defaultVolumePercent: 100,
        intentionalOverlaps: exportIntentionalOverlaps,
        rolesVolumeMap: tracks.reduce((acc, tr) => {
          const roleName = tr.character || tr.characterName || tr.participant || 'Персонаж';
          const dubberNick = tr.participant || tr.dubberName || 'Даббер';
          acc[roleName] = 100;
          acc[dubberNick] = 100;
          return acc;
        }, {} as Record<string, number>),
        phrases: Object.keys(audioClips).flatMap(trId => {
          const clips = audioClips[trId] || [];
          return clips.map(b => {
            return {
              id: b.id,
              dubberNick: b.dubberName,
              characterName: b.characterName,
              startSec: Number((b.clipStartSec + (b.offsetSec || 0)).toFixed(2)),
              endSec: Number((b.clipStartSec + (b.offsetSec || 0) + b.durationSec).toFixed(2)),
              durationSec: Number(b.durationSec.toFixed(2)),
              text: b.text,
              isUnisonPhrase: Boolean(b.isUnisonPhrase),
              isIntentionalOverlap: Boolean(b.isIntentionalOverlap),
              volumePercent: 100,
              volumeGainDb: 0,
              pan: 0,
              timeStretch: 1.0,
              headTrimSec: 0,
              tailTrimSec: 0
            };
          });
        })
      };

      try {
        await ipcSafe.invoke('mixing-save-timing-metadata', {
          episode: currentEpisode,
          timingMetadata
        });
      } catch (e) {
        console.warn('Metadata save warning:', e);
      }

      const res: any = await ipcSafe.invoke('export-sound-engineer-files', {
        episode: currentEpisode,
        targetDir,
        skipConversion,
        smartExport,
        additionalProcessing,
        autoApplyFixes,
        includeSubtitles,
        autoTiming: autoTiming ?? false
      });

      if (res && res.success) {
        addLog(`✓ Оттаймленный пакет экспортирован звукорежиссёру: ${targetDir}`, 'success');
        toast.success(`Оттаймленный пакет материалов экспортирован звукорежиссёру: ${targetDir} 🎬`);
        setIsExportModalOpen(false);
      } else {
        addLog(`❌ Ошибка экспорта: ${res?.error || 'неизвестная ошибка'}`, 'error');
        toast.error(`Ошибка при экспорте: ${res?.error || 'неизвестная ошибка'}`);
      }
    } catch (err: any) {
      console.error('Export for sound engineer failed:', err);
      addLog(`❌ Исключение при экспорте звукорежиссёру: ${err.message || String(err)}`, 'error');
      toast.error(`Не удалось экспортировать файлы звукорежиссёру: ${err.message || String(err)}`);
    } finally {
      setIsExportingSE(false);
      setExportProgress(0);
      clearProcess();
    }
  };


  const timeRulerTicks = useMemo(() => {
    const ticks: number[] = [];
    const stepSec = zoomLevel < 20 ? 30 : zoomLevel < 50 ? 10 : 5;
    for (let sec = 0; sec <= duration; sec += stepSec) {
      ticks.push(sec);
    }
    return ticks;
  }, [duration, zoomLevel]);

  // Find currently selected clip object
  const activeSelectedClip = useMemo(() => {
    if (!selectedClipId) return null;
    for (const trId of Object.keys(audioClips)) {
      const found = (audioClips[trId] || []).find(c => c.id === selectedClipId);
      if (found) return { clip: found, trackId: trId };
    }
    return null;
  }, [selectedClipId, audioClips]);

  return (
    <div className="flex flex-col h-full bg-[#08090d] text-neutral-100 overflow-hidden font-sans">
      {/* Hidden file picker for uploading missing audio lines */}
      <input 
        ref={missingFileInputRef} 
        type="file" 
        accept="audio/*,.wav,.mp3,.aac,.m4a,.flac,.ogg" 
        className="hidden" 
        onChange={handleMissingFileSelected} 
      />

      {/* Top Header Bar — Compact & Uniform h-8 Buttons */}
      <header className="bg-neutral-900 border-b border-neutral-800 px-3 py-2 shrink-0 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 bg-amber-600/20 border border-amber-500/30 text-amber-400 rounded-lg flex items-center justify-center shadow-sm shrink-0">
            <Clock className="w-4 h-4" />
          </div>
          <div className="leading-tight">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-white tracking-tight">
                Тайминг — {currentEpisode?.project?.title || 'Проект'}
              </h1>
              <span className="bg-amber-950/80 text-amber-300 font-mono tabular-nums text-[11px] px-1.5 py-0.5 rounded border border-amber-800/50 font-medium">
                Серия #{currentEpisode?.number || 1}
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 hidden xl:block">
              Реалтайм-прослушивание клипов, звук и окно видео, нормализация -18 dBFS
            </p>
          </div>
        </div>

        {/* Uniform Compact Action Buttons Bar (all h-8 px-2.5 text-xs) */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setIsSettingsModalOpen(true)}
            className="h-8 px-2.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border border-amber-600/40 transition shrink-0"
            title="Настройки параметров удаления тишины, авто-калибровки, вшития фиксов и автотайминга"
          >
            <Settings className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Параметры</span>
          </button>

          {/* Toggle Floating Video Window */}
          <button
            onClick={() => setIsVideoOpen(prev => !prev)}
            className={`h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition shrink-0 ${
              isVideoOpen
                ? 'bg-sky-950/80 text-sky-300 border-sky-600/70 shadow-sm'
                : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border-neutral-700'
            }`}
            title={isVideoOpen ? 'Скрыть плавающее окно видео (звук оригинала продолжит работать)' : 'Показать плавающее окно видео (S/M/L)'}
          >
            {isVideoOpen ? (
              <Video className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            ) : (
              <EyeOff className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
            )}
            <span>Видео</span>
            {videoUrl && (
              <span className={`w-1.5 h-1.5 rounded-full ${isOriginalMuted ? 'bg-red-400' : 'bg-emerald-400'}`} />
            )}
          </button>

          {/* Toggle Preview Auto-Normalization (-18 dBFS RMS like in QA) */}
          <button
            onClick={() => setIsAutoNormalize(prev => !prev)}
            className={`h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition shrink-0 ${
              isAutoNormalize
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600/70 shadow-sm'
                : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border-neutral-700'
            }`}
            title="Авто-нормализация громкости при воспроизведении (-18 dBFS RMS с защитой пиков -0.7 dBFS, как во вкладке QA)"
          >
            <Sliders className={`w-3.5 h-3.5 shrink-0 ${isAutoNormalize ? 'text-emerald-400' : 'text-neutral-400'}`} />
            <span>Норм. -18dB</span>
          </button>

          <button
            onClick={handleImportFromQA}
            disabled={isLoading}
            className="h-8 px-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border border-neutral-700 transition disabled:opacity-50 shrink-0"
            title="1. Импорт дорожек: импорт и сборка дорожек дабберов из QA в тайминг"
          >
            {isImporting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />
                <span className="font-mono tabular-nums">Импорт {importProgress > 0 ? `${importProgress}%` : '...'}</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span>1. Импорт</span>
              </>
            )}
          </button>

          <button
            onClick={handleCutSilence}
            disabled={isLoading || tracks.length === 0}
            className={`h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition disabled:opacity-50 shrink-0 ${
              isSilenceRemoved
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/60'
                : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-neutral-700'
            }`}
            title="2. Удалить тишину: нарезать вейвформу дорожек на отдельные речевые фразы по тишине"
          >
            <Scissors className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>2. Тишина</span>
          </button>

          <button
            onClick={handleStitchFixes}
            disabled={isLoading || tracks.length === 0}
            className={`h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition disabled:opacity-50 shrink-0 ${
              isFixesStitched
                ? 'bg-amber-950/60 text-amber-300 border-amber-700/60'
                : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-neutral-700'
            }`}
            title="3. Применить фиксы: вшить фрагменты фиксов или заменить полную дорожку"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>3. Фиксы</span>
          </button>

          <button
            onClick={handleAnalyzeTiming}
            disabled={isLoading || tracks.length === 0}
            className={`h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition disabled:opacity-50 shrink-0 ${
              isTimingAnalyzed
                ? 'bg-indigo-950/80 text-indigo-200 border-indigo-700/70'
                : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-neutral-700'
            }`}
            title="4. Анализ проблем (Whisper): находит наезды, рассинхроны и пропуски"
          >
            {isLoading && statusMessage.includes('Этап 1') ? (
              <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin shrink-0" />
            ) : (
              <Search className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            )}
            <span>4. Анализ</span>
            {timingIssues.length > 0 && (
              <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-mono tabular-nums font-bold">
                {timingIssues.length}
              </span>
            )}
          </button>

          <button
            onClick={() => handleApplyTargetedAutoTiming('all')}
            disabled={isLoading || tracks.length === 0 || timingIssues.filter(i => i.type !== 'missing').length === 0}
            className={`h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition shrink-0 ${
              timingIssues.filter(i => i.type !== 'missing').length > 0
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500 shadow-sm'
                : 'bg-neutral-800/60 text-neutral-500 border-neutral-800 cursor-not-allowed'
            }`}
            title="5. Точечный автотайминг: раздвигает только наезды и выравнивает рассинхроны под субтитры"
          >
            {isLoading && statusMessage.includes('Этап 2') ? (
              <Loader2 className="w-3.5 h-3.5 text-amber-300 animate-spin shrink-0" />
            ) : (
              <Zap className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            )}
            <span>5. Автотайминг</span>
          </button>

          {/* QA Passport Sync Button */}
          <button
            onClick={handleSyncFromQA}
            disabled={isLoading || tracks.length === 0}
            className={`h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition disabled:opacity-50 shrink-0 ${
              qaPassportLoaded
                ? 'bg-amber-950/70 text-amber-300 border-amber-600/60'
                : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border-neutral-700'
            }`}
            title="Синхронизировать данные тайминга с результатами QA проверки косяков серии"
          >
            <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Паспорт QA</span>
            {qaPassportLoaded && (
              <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-mono tabular-nums font-bold">
                {qaPassportLoaded.summary.totalGaps}
              </span>
            )}
          </button>

          {timingIssues.length > 0 && (
            <button
              onClick={() => setIsIssuesDrawerOpen(!isIssuesDrawerOpen)}
              className={`h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition shrink-0 ${
                isIssuesDrawerOpen
                  ? 'bg-amber-950/90 text-amber-300 border-amber-600'
                  : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-neutral-700'
              }`}
              title="Панель найденных проблем тайминга"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>Проблемы ({timingIssues.length})</span>
            </button>
          )}

          <button
            onClick={() => setIsLogDrawerOpen(!isLogDrawerOpen)}
            className={`h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition shrink-0 ${
              isLogDrawerOpen
                ? 'bg-amber-950/80 text-amber-300 border-amber-800'
                : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-neutral-700'
            }`}
            title="Журнал операций тайминга"
          >
            <Activity className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Журнал ({operationLogs.length})</span>
          </button>

          <button
            onClick={() => setIsExportModalOpen(true)}
            disabled={isLoading || tracks.length === 0}
            className="h-8 px-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border border-emerald-500 transition disabled:opacity-50 shrink-0"
            title="Экспорт оттаймленного пакета звукорежиссёру"
          >
            <FolderOpen className="w-3.5 h-3.5 text-emerald-100 shrink-0" />
            <span>Экспорт ЗР</span>
          </button>

          <button
            onClick={handleExportToMixing}
            disabled={exportingToMixing || tracks.length === 0}
            className="h-8 px-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 border border-indigo-500 transition disabled:opacity-50 shrink-0"
            title="Передать оттаймленные фразы во вкладку Сведения"
          >
            {exportingToMixing ? <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" /> : <ArrowRight className="w-3.5 h-3.5 shrink-0" />}
            <span>В Сведение</span>
          </button>
        </div>
      </header>

      {/* Unified Compact Active Processes Bar with Single Adaptive Progress Bar */}
      {(activeProcess || isLoading) && (
        <div className="bg-neutral-900/95 border-b border-indigo-500/40 px-4 py-1.5 flex flex-col gap-1 shadow-md z-40 shrink-0">
          <div className="flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin shrink-0" />
              <span className="font-bold text-white shrink-0">
                {activeProcess?.title || 'Выполнение операции'}
              </span>
              <span className="text-neutral-400 truncate font-mono text-[11px]">
                — {activeProcess?.detail || statusMessage || 'Обработка...'}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {importDecodedTracks.length > 0 && (
                <span className="text-[10px] font-mono tabular-nums text-neutral-400 hidden sm:inline">
                  Дорожки: {importDecodedTracks.filter(t => t.status === 'done').length}/{importDecodedTracks.length}
                </span>
              )}
              <span className="text-[11px] font-mono tabular-nums text-indigo-300 font-bold bg-indigo-950/90 px-2 py-0.5 rounded border border-indigo-700/50">
                {activeProcess ? activeProcess.progress : importProgress}%
              </span>
            </div>
          </div>
          <div className="w-full bg-neutral-950 rounded-full h-1.5 overflow-hidden border border-neutral-800">
            <div
              className="bg-gradient-to-r from-sky-500 via-indigo-500 to-amber-400 h-full rounded-full transition-all duration-200"
              style={{ width: `${Math.max(3, Math.min(100, activeProcess ? activeProcess.progress : importProgress))}%` }}
            />
          </div>
          {importDecodedTracks.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 scrollbar-thin">
              {importDecodedTracks.map(t => (
                <span
                  key={t.id}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums inline-flex items-center gap-1 shrink-0 border ${
                    t.status === 'done'
                      ? 'bg-emerald-950/50 border-emerald-800/60 text-emerald-300'
                      : t.status === 'decoding'
                      ? 'bg-indigo-950/80 border-indigo-600/70 text-indigo-200 font-bold'
                      : t.status === 'error'
                      ? 'bg-red-950/60 border-red-800/60 text-red-300'
                      : 'bg-neutral-900 border-neutral-800 text-neutral-500'
                  }`}
                >
                  {t.status === 'done' ? <Check className="w-2.5 h-2.5 text-emerald-400" /> :
                   t.status === 'decoding' ? <Loader2 className="w-2.5 h-2.5 text-indigo-400 animate-spin" /> :
                   t.status === 'error' ? <AlertTriangle className="w-2.5 h-2.5 text-red-400" /> :
                   <Clock className="w-2.5 h-2.5 text-neutral-600" />}
                  <span className="truncate max-w-[110px]">{t.name}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Unified QA Passport Sync Notification Banner */}
      {qaPassportLoaded && (
        <div className="bg-gradient-to-r from-amber-950/80 via-indigo-950/70 to-neutral-900 border-b border-amber-500/40 px-4 py-1.5 flex items-center justify-between text-xs text-amber-200 shrink-0 shadow-lg">
          <div className="flex items-center gap-2.5">
            <div className="w-5 h-5 rounded bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
            <div>
              <span className="font-bold text-white">Паспорт QA подхвачен:</span>{' '}
              <span className="font-mono tabular-nums">
                Замечаний: <strong className="text-white">{qaPassportLoaded.summary.totalGaps}</strong>{' '}
                (Наездов: <strong>{qaPassportLoaded.summary.overlapsCount}</strong>, Коллизий: <strong>{qaPassportLoaded.summary.collisionsCount}</strong>, Рассинхронов: <strong>{qaPassportLoaded.summary.desyncCount}</strong>, Пропусков: <strong>{qaPassportLoaded.summary.missingCount}</strong>)
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setIsIssuesDrawerOpen(true)}
              className="h-7 px-2.5 bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 border border-amber-500/40 rounded-lg text-[11px] font-bold transition inline-flex items-center gap-1 shadow-sm"
            >
              <AlertTriangle className="w-3 h-3 text-amber-400" />
              <span>Замечания ({timingIssues.length})</span>
            </button>
            <button
              onClick={handleSyncFromQA}
              className="h-7 px-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-[11px] font-medium transition inline-flex items-center gap-1"
              title="Повторно синхронизировать данные с QA проверкой"
            >
              <RefreshCw className="w-3 h-3 text-neutral-400" />
              <span>Обновить</span>
            </button>
          </div>
        </div>
      )}

      {/* Two-Stage Auto-Timing Diagnostic & Targeted Fixes Panel */}
      {isIssuesDrawerOpen && timingIssues.length > 0 && (
        <div className="bg-[#0b0e18] border-b border-indigo-900/60 px-4 py-2.5 shrink-0 shadow-2xl flex flex-col gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="font-bold text-xs text-neutral-100 flex items-center gap-1.5">
                <Search className="w-4 h-4 text-amber-400" />
                Диагностика таймингов: найдено проблем ({timingIssues.length})
              </span>

              {/* Filter tabs */}
              <div className="flex items-center gap-1 bg-neutral-900/90 p-0.5 rounded-lg border border-neutral-800 text-[10px]">
                <button
                  onClick={() => setActiveIssueFilter('all')}
                  className={`px-2 py-0.5 rounded ${activeIssueFilter === 'all' ? 'bg-indigo-600 text-white font-bold' : 'text-neutral-400 hover:text-neutral-200'}`}
                >
                  Все ({timingIssues.length})
                </button>
                <button
                  onClick={() => setActiveIssueFilter('overlap')}
                  className={`px-2 py-0.5 rounded ${activeIssueFilter === 'overlap' ? 'bg-red-600 text-white font-bold' : 'text-neutral-400 hover:text-neutral-200'}`}
                >
                  💥 Наезды ({timingIssues.filter(i => i.type === 'overlap').length})
                </button>
                <button
                  onClick={() => setActiveIssueFilter('desync')}
                  className={`px-2 py-0.5 rounded ${activeIssueFilter === 'desync' ? 'bg-amber-600 text-white font-bold' : 'text-neutral-400 hover:text-neutral-200'}`}
                >
                  ⏳ Рассинхрон ({timingIssues.filter(i => i.type === 'desync').length})
                </button>
                <button
                  onClick={() => setActiveIssueFilter('missing')}
                  className={`px-2 py-0.5 rounded ${activeIssueFilter === 'missing' ? 'bg-amber-700 text-white font-bold' : 'text-neutral-400 hover:text-neutral-200'}`}
                >
                  ⚠️ Пропуски ({timingIssues.filter(i => i.type === 'missing').length})
                </button>
                <button
                  onClick={() => setActiveIssueFilter('orphan')}
                  className={`px-2 py-0.5 rounded ${activeIssueFilter === 'orphan' ? 'bg-cyan-700 text-white font-bold' : 'text-neutral-400 hover:text-neutral-200'}`}
                >
                  🎙️ Вне сабов ({timingIssues.filter(i => i.type === 'orphan').length})
                </button>
              </div>
            </div>

            {/* Quick Bulk Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleApplyTargetedAutoTiming('all')}
                disabled={timingIssues.filter(i => i.type !== 'missing').length === 0}
                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-[11px] font-bold rounded-lg flex items-center gap-1 shadow transition"
                title="Точечно раздвинуть все наезды и выровнять все рассинхроны под субтитры"
              >
                <Zap className="w-3 h-3" />
                <span>Исправить все точечно</span>
              </button>
              <button
                onClick={() => handleApplyTargetedAutoTiming('overlap')}
                disabled={timingIssues.filter(i => i.type === 'overlap').length === 0}
                className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] font-semibold rounded-lg flex items-center gap-1 border border-neutral-700 transition"
              >
                <MoveHorizontal className="w-3 h-3 text-red-400" />
                <span>Только наезды</span>
              </button>
              <button
                onClick={() => handleApplyTargetedAutoTiming('desync')}
                disabled={timingIssues.filter(i => i.type === 'desync').length === 0}
                className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] font-semibold rounded-lg flex items-center gap-1 border border-neutral-700 transition"
              >
                <Crosshair className="w-3 h-3 text-amber-400" />
                <span>Только рассинхрон</span>
              </button>
              <button
                onClick={() => setIsIssuesDrawerOpen(false)}
                className="p-1 text-neutral-400 hover:text-neutral-200 rounded"
                title="Скрыть панель"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Issue Cards Carousel */}
          <div className="flex items-center gap-2 overflow-x-auto py-1 max-h-36 scrollbar-thin">
            {timingIssues
              .filter(i => activeIssueFilter === 'all' || i.type === activeIssueFilter)
              .map(issue => (
                <div
                  key={issue.id}
                  onClick={() => jumpToTime(issue.timeSec)}
                  className={`shrink-0 w-80 p-2 rounded-xl border text-xs flex flex-col justify-between cursor-pointer transition select-none ${
                    issue.type === 'overlap'
                      ? 'bg-red-950/40 border-red-800/60 hover:border-red-500'
                      : issue.type === 'desync'
                      ? 'bg-amber-950/40 border-amber-800/60 hover:border-amber-500'
                      : issue.type === 'missing'
                      ? 'bg-neutral-900 border-amber-600/60 hover:border-amber-400'
                      : 'bg-cyan-950/40 border-cyan-800/60 hover:border-cyan-500'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] mb-1">
                    <span className="font-bold flex items-center gap-1 truncate">
                      {issue.type === 'overlap' && <span className="bg-red-600 text-white px-1 py-0.2 rounded font-black text-[8px]">НАЕЗД</span>}
                      {issue.type === 'desync' && <span className="bg-amber-600 text-neutral-950 px-1 py-0.2 rounded font-black text-[8px]">РАССИНХРОН</span>}
                      {issue.type === 'missing' && <span className="bg-amber-500 text-neutral-950 px-1 py-0.2 rounded font-black text-[8px]">ПРОПУСК</span>}
                      {issue.type === 'orphan' && <span className="bg-cyan-600 text-white px-1 py-0.2 rounded font-black text-[8px]">ВНЕ САБОВ</span>}
                      <span className="text-neutral-200 truncate">{issue.dubberName} ({issue.characterName})</span>
                    </span>
                    <span className="font-mono tabular-nums text-neutral-400 shrink-0">
                      ⏱ {formatSeconds(issue.timeSec)}
                    </span>
                  </div>

                  <p className="text-[11px] text-neutral-300 line-clamp-2 leading-tight mb-1.5" title={issue.description}>
                    {issue.description}
                  </p>

                  <div className="flex items-center justify-between pt-1 border-t border-neutral-800/60">
                    <button
                      onClick={(e) => { e.stopPropagation(); jumpToTime(issue.timeSec); }}
                      className="text-[10px] text-indigo-400 hover:text-indigo-200 flex items-center gap-0.5"
                    >
                      <Crosshair className="w-2.5 h-2.5" />
                      <span>Показать</span>
                    </button>

                    {issue.type === 'desync' && issue.clipId && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleFixSingleClip(issue.trackId, issue.clipId!); }}
                        className="px-2 py-0.5 bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold rounded flex items-center gap-1 shadow"
                        title="Поставить фразу точно под субтитр"
                      >
                        <Crosshair className="w-2.5 h-2.5" />
                        <span>К субтитру</span>
                      </button>
                    )}

                    {issue.type === 'orphan' && issue.clipId && issue.subStartSec !== undefined && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleFixSingleClip(issue.trackId, issue.clipId!); }}
                        className="px-2 py-0.5 bg-cyan-600 hover:bg-cyan-500 text-white text-[10px] font-bold rounded flex items-center gap-1 shadow"
                        title="Поставить фразу к найденному Whisper субтитру"
                      >
                        <Crosshair className="w-2.5 h-2.5" />
                        <span>К субтитру</span>
                      </button>
                    )}

                    {issue.type === 'overlap' && issue.clipId && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleResolveSingleOverlap(issue.trackId, issue.clipId!); }}
                        className="px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold rounded flex items-center gap-1 shadow"
                      >
                        <MoveHorizontal className="w-2.5 h-2.5" />
                        <span>Раздвинуть</span>
                      </button>
                    )}

                    {issue.type === 'missing' && (
                      <div className="flex items-center gap-1">
                        {missingSubtitles.find(m => m.trackId === issue.trackId && Math.abs(m.startSec - issue.timeSec) < 0.2) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const marker = missingSubtitles.find(m => m.trackId === issue.trackId && Math.abs(m.startSec - issue.timeSec) < 0.2);
                              if (marker) handleTriggerUploadMissing(marker);
                            }}
                            className="px-2 py-0.5 bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold rounded flex items-center gap-1 shadow transition"
                            title="Загрузить аудиофайл реплики"
                          >
                            <Download className="w-2.5 h-2.5" />
                            <span>Загрузить</span>
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCopyMissingTimecode(issue.subText || '', issue.subStartSec || 0, issue.subEndSec || 0); }}
                          className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 text-[10px] font-semibold rounded flex items-center gap-1 border border-neutral-700"
                          title="Скопировать таймкод фразы"
                        >
                          <Copy className="w-2.5 h-2.5" />
                          <span>Таймкод</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Final Self-Healing Verification Report Banner */}
      {finalVerificationReport && (
        <div
          className={`border-b px-4 py-1.5 flex items-center justify-between gap-3 text-xs shrink-0 ${
            finalVerificationReport.passed
              ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
              : 'bg-amber-950/40 border-amber-800/60 text-amber-200'
          }`}
        >
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="font-bold flex items-center gap-1.5">
              {finalVerificationReport.passed ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              )}
              <span>
                {finalVerificationReport.passed
                  ? `Финальная проверка пройдена (${finalVerificationReport.iterationsRun} итер.): все ${finalVerificationReport.voicedSubs}/${finalVerificationReport.totalSubs} сабов озвучены и на местах!`
                  : `Финальный аудит (${finalVerificationReport.iterationsRun} итер.): озвучено ${finalVerificationReport.voicedSubs}/${finalVerificationReport.totalSubs} сабов`}
              </span>
            </span>

            {(finalVerificationReport.recoveredFromFixCount > 0 || finalVerificationReport.recoveredFromOrigCount > 0) && (
              <span className="px-2 py-0.5 rounded bg-emerald-900/60 border border-emerald-700/60 text-[10px] font-mono text-emerald-200">
                🚑 Восстановлено: {finalVerificationReport.recoveredFromFixCount} из фикса / {finalVerificationReport.recoveredFromOrigCount} из оригинала
              </span>
            )}

            {finalVerificationReport.realignedCount > 0 && (
              <span className="px-2 py-0.5 rounded bg-indigo-900/60 border border-indigo-700/60 text-[10px] font-mono text-indigo-200">
                🎯 Довыровнено: {finalVerificationReport.realignedCount}
              </span>
            )}

            {finalVerificationReport.physicsProtectedCount > 0 && (
              <span className="px-2 py-0.5 rounded bg-fuchsia-950/70 border border-fuchsia-700/60 text-[10px] font-mono text-fuchsia-200">
                ⚡ Защищено физики (охи/вздохи): {finalVerificationReport.physicsProtectedCount}
              </span>
            )}

            {!finalVerificationReport.passed && finalVerificationReport.unvoicedSubs.length > 0 && (
              <div className="flex items-center gap-1 overflow-x-auto max-w-[460px] py-0.5">
                <span className="text-[10px] text-amber-300 font-semibold shrink-0">Не найдены в исходниках:</span>
                {finalVerificationReport.unvoicedSubs.slice(0, 5).map(u => (
                  <button
                    key={u.id}
                    onClick={() => jumpToTime(u.startSec, u.trackId)}
                    className="px-1.5 py-0.5 rounded bg-amber-900/70 hover:bg-amber-800 text-amber-100 border border-amber-700/60 text-[10px] font-mono shrink-0 transition"
                    title={`${u.dubberName} (${u.characterName}): «${u.text}»`}
                  >
                    {u.dubberName} [{formatSeconds(u.startSec)}]
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => setFinalVerificationReport(null)}
            className="text-neutral-400 hover:text-white p-0.5 rounded transition shrink-0"
            title="Скрыть отчёт финальной проверки"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Dynamic Calibration Info Banner */}
      {Object.keys(calibrationsByTrack).length > 0 && (
        <div className="bg-amber-950/30 border-b border-amber-900/40 px-4 py-1 flex items-center justify-between text-[11px] text-amber-200 shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto py-0.5">
            <span className="font-bold text-amber-400 flex items-center gap-1 shrink-0">
              <Sliders className="w-3.5 h-3.5" /> Авто-калибровка шума:
            </span>
            {Object.entries(calibrationsByTrack).map(([trId, calib]) => {
              const trk = tracks.find(t => t.id === trId);
              const name = trk?.participant || 'Трек';
              return (
                <span key={trId} className="bg-neutral-900/90 border border-amber-800/40 rounded px-2 py-0.5 font-mono tabular-nums text-[10px] text-neutral-300 shrink-0">
                  <strong className="text-amber-300">{name}</strong>: шум {calib.noiseFloorDb} dB | речь {calib.speechFloorDb} dB | порог {calib.calculatedThresholdDb} dB
                </span>
              );
            })}
          </div>
          <span className="text-[10px] text-neutral-400 shrink-0 ml-3 hidden md:inline">
            Границы клипов можно вытягивать из тишины мышкой за края — изменения слышны сразу
          </span>
        </div>
      )}

      {/* Track Navigation & View Modes Bar */}
      <div className="bg-[#0b0d14] border-b border-neutral-800 px-4 py-1.5 flex items-center justify-between gap-3 text-xs shrink-0 select-none">
        {/* Left: Tracks Count Badge & Quick Track Jump Buttons */}
        <div className="flex items-center gap-2 overflow-x-auto py-0.5 scrollbar-thin max-w-[70%]">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-300 font-semibold shrink-0">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <span>Дорожки: <strong className="text-white font-mono tabular-nums">{tracks.length}</strong></span>
          </div>

          {tracks.map((t) => {
            const clipsCount = (audioClips[t.id] || []).length;
            const isMuted = mutedTracks.has(t.id);
            const norm = normalizationMetrics[t.id];
            return (
              <button
                key={t.id}
                onClick={() => {
                  const el = document.getElementById(`track-row-${t.id}`);
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
                className={`px-2.5 py-1 rounded-lg border text-[11px] flex items-center gap-1.5 shrink-0 transition ${
                  isMuted 
                    ? 'bg-red-950/40 border-red-900/60 text-red-300 hover:bg-red-900/50' 
                    : 'bg-neutral-900/90 hover:bg-neutral-800 border-neutral-800 hover:border-neutral-700 text-neutral-200'
                }`}
                title={`Перейти к дорожке: ${t.participant} (${clipsCount} фраз). Нажмите для прокрутки.`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${isMuted ? 'bg-red-500' : 'bg-emerald-500'}`} />
                <span className="font-bold truncate max-w-[130px]">{t.participant}</span>
                <span className="text-[10px] text-neutral-400 font-mono tabular-nums">({clipsCount})</span>
                {isAutoNormalize && norm && norm.gainDb !== 0 && (
                  <span className="text-[9px] font-mono tabular-nums text-emerald-400 bg-emerald-950/70 px-1 rounded">
                    {norm.gainDb > 0 ? `+${norm.gainDb.toFixed(1)}` : norm.gainDb.toFixed(1)}dB
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Right: Height view toggle */}
        <div className="flex items-center gap-1 shrink-0 bg-neutral-900 border border-neutral-800 rounded-lg p-0.5">
          <button
            onClick={() => setTrackHeightMode('standard')}
            className={`px-2 py-1 rounded text-[11px] font-medium transition ${
              trackHeightMode === 'standard' ? 'bg-indigo-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
            }`}
            title="Стандартная высота: 112px для детального редактирования вейвформы"
          >
            Стандартный (112px)
          </button>
          <button
            onClick={() => setTrackHeightMode('compact')}
            className={`px-2 py-1 rounded text-[11px] font-medium transition ${
              trackHeightMode === 'compact' ? 'bg-indigo-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
            }`}
            title="Компактный вид: 64px — все дорожки помещаются на экране"
          >
            Компактный (64px)
          </button>
          <button
            onClick={() => setTrackHeightMode('fit')}
            className={`px-2 py-1 rounded text-[11px] font-medium transition ${
              trackHeightMode === 'fit' ? 'bg-indigo-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
            }`}
            title="Уместить все дорожки на одном экране без скролла"
          >
            Уместить все ({tracks.length})
          </button>
        </div>
      </div>

      {/* Main Multitrack Workspace: Synchronized Top Bar, Floating Video Window, and Unified Vertical Scroll */}
      <div className="flex-1 flex flex-col overflow-hidden relative select-none">
        {/* Draggable Floating Video Window (kept mounted so original video audio plays even when collapsed) */}
        <div
          style={{ left: `${videoPos.x}px`, top: `${videoPos.y}px` }}
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            e.preventDefault();
            e.stopPropagation();
            videoDragMovedRef.current = false;
            setDraggingVideo({
              startMouseX: e.clientX,
              startMouseY: e.clientY,
              initialX: videoPos.x,
              initialY: videoPos.y
            });
          }}
          className={`absolute z-50 bg-neutral-950/95 border border-neutral-700/90 rounded-xl shadow-2xl overflow-hidden backdrop-blur-md select-none ${
            draggingVideo ? 'cursor-grabbing ring-2 ring-sky-500/60' : 'cursor-grab transition-[width] duration-150'
          } ${
            !isVideoOpen ? 'hidden' : videoSize === 'S' ? 'w-[260px]' : videoSize === 'M' ? 'w-[380px]' : 'w-[540px]'
          }`}
        >
          {/* Drag Handle Top Bar */}
          <div
            className="h-7 px-2.5 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between cursor-move select-none"
          >
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-200 truncate pointer-events-none">
              <GripHorizontal className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              <Video className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span className="truncate">Видео серии</span>
              <span className="font-mono tabular-nums text-[10px] text-amber-400 bg-neutral-950 px-1.5 py-0.2 rounded border border-neutral-800">
                {formatSeconds(currentTime)}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {(['S', 'M', 'L'] as const).map(sz => (
                <button
                  key={sz}
                  onClick={() => handleChangeVideoSize(sz)}
                  className={`w-5 h-5 rounded text-[10px] font-mono font-bold flex items-center justify-center transition ${
                    videoSize === sz
                      ? 'bg-sky-600 text-white'
                      : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white'
                  }`}
                  title={`Размер видео: ${sz}`}
                >
                  {sz}
                </button>
              ))}
              <button
                onClick={() => setIsOriginalMuted(prev => !prev)}
                className={`w-5 h-5 rounded flex items-center justify-center transition ${
                  isOriginalMuted
                    ? 'bg-red-500/20 text-red-400'
                    : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'
                }`}
                title={isOriginalMuted ? 'Включить звук оригинального видео' : 'Заглушить звук оригинального видео'}
              >
                {isOriginalMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
              </button>
              <button
                onClick={() => handleToggleVideoOpen()}
                className="w-5 h-5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white flex items-center justify-center transition"
                title="Свернуть окно видео в кнопку «Видео» в шапке"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Video Surface */}
          <div className="relative aspect-video bg-black flex items-center justify-center">
            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                preload="auto"
                playsInline
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  v.volume = Math.max(0, Math.min(1, originalVolume));
                  v.muted = isOriginalMuted;
                  if (v.duration && Number.isFinite(v.duration) && v.duration > 10) {
                    setDuration(prev => Math.max(prev, Math.ceil(v.duration)));
                  }
                }}
                onClick={() => {
                  if (!videoDragMovedRef.current) {
                    setIsPlaying(prev => !prev);
                  }
                }}
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="p-4 text-center text-xs text-neutral-400 flex flex-col items-center gap-1.5 pointer-events-none">
                <Video className="w-6 h-6 text-neutral-600" />
                <span>Видеофайл серии не привязан</span>
                <span className="text-[10px] text-neutral-500">Перетащите это окно в любое удобное место</span>
              </div>
            )}
          </div>
        </div>

        {/* Top Header Row: Left Title + Timecode Ruler (horizontal scroll synchronized) */}
        <div className="h-9 bg-neutral-900 border-b border-neutral-800 flex shrink-0 z-30">
          <div className="w-64 border-r border-neutral-800 px-3 flex items-center justify-between text-[11px] font-bold text-neutral-400 uppercase tracking-wider shrink-0 bg-neutral-900">
            <span>Дорожки (Клипы)</span>
            {isAutoNormalize && (
              <span className="text-[9px] font-mono tabular-nums text-emerald-400 bg-emerald-950/70 border border-emerald-800/50 px-1.5 py-0.5 rounded normal-case">
                Норм. -18dB
              </span>
            )}
          </div>
          <div 
            ref={timeRulerContainerRef}
            onClick={handleTimeRulerClick}
            className="flex-1 overflow-hidden relative font-mono tabular-nums text-[10px] text-neutral-400 bg-neutral-900/90 cursor-pointer"
          >
            <div 
              className="relative h-full"
              style={{ width: `${Math.max(800, duration * zoomLevel)}px` }}
            >
              {timeRulerTicks.map(sec => (
                <div
                  key={sec}
                  className="absolute border-l border-neutral-800 pl-1 py-1 h-full flex items-center"
                  style={{ left: `${sec * zoomLevel}px` }}
                >
                  {formatSeconds(sec)}
                </div>
              ))}
              {/* Playhead Cursor Marker on Time Ruler */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-40 pointer-events-none shadow-[0_0_8px_rgba(251,191,36,0.8)]"
                style={{ left: `${currentTime * zoomLevel}px` }}
              />
            </div>
          </div>
        </div>

        {/* Unified DAW Multitrack Workspace: Single scroll container handles vertical and horizontal DAW scrolling */}
        <div 
          ref={timelineContainerRef}
          onScroll={handleTimelineScroll}
          onWheel={handleTimelineWheel}
          className="flex-1 overflow-auto relative bg-[#06070a]"
        >
          <div 
            className="flex flex-col relative"
            style={{ width: `${256 + Math.max(800, duration * zoomLevel)}px` }}
          >
            {/* Track 1: Original Video Audio Track Row (h-16 = 64px) */}
            <div className="flex h-16 border-b border-neutral-800/80 bg-neutral-950/60 shrink-0">
              {/* Sticky Header */}
              <div className="w-64 sticky left-0 z-20 shrink-0 bg-neutral-950 border-r border-neutral-800/80 p-2.5 flex flex-col justify-between select-none">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-sky-400 flex items-center gap-1.5 truncate">
                    <Video className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">Оригинал (Видео)</span>
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setIsVideoOpen(prev => !prev)}
                      className={`p-1 rounded text-xs transition ${
                        isVideoOpen ? 'bg-sky-500/20 text-sky-300' : 'text-neutral-500 hover:text-neutral-200'
                      }`}
                      title={isVideoOpen ? 'Скрыть окно видео' : 'Показать окно видео'}
                    >
                      <Video className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setIsOriginalMuted(prev => !prev)}
                      className={`p-1 rounded text-xs transition ${
                        isOriginalMuted ? 'bg-red-500/20 text-red-400' : 'text-neutral-400 hover:text-neutral-200'
                      }`}
                      title={isOriginalMuted ? 'Включить звук оригинала' : 'Заглушить звук оригинала'}
                    >
                      {isOriginalMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-neutral-400 shrink-0">Звук:</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={isOriginalMuted ? 0 : originalVolume}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setOriginalVolume(val);
                      if (val > 0 && isOriginalMuted) setIsOriginalMuted(false);
                    }}
                    className="w-full accent-sky-500 h-1 bg-neutral-800 rounded cursor-pointer"
                  />
                  <span className="text-[10px] font-mono tabular-nums text-sky-300 w-8 text-right shrink-0">
                    {isOriginalMuted ? 'MUTE' : `${Math.round(originalVolume * 100)}%`}
                  </span>
                </div>
              </div>

              {/* Original Track Lane with Real Extracted Peaks Waveform */}
              <div 
                onClick={handleTimelineClick}
                className={`relative shrink-0 flex items-center bg-neutral-950/40 overflow-hidden cursor-crosshair ${
                  isOriginalMuted ? 'opacity-35' : ''
                }`}
                style={{ width: `${Math.max(800, duration * zoomLevel)}px` }}
              >
                {/* Playhead Cursor Line */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-10 pointer-events-none shadow-[0_0_8px_rgba(251,191,36,0.6)]"
                  style={{ left: `${currentTime * zoomLevel}px` }}
                />
                <div className="absolute inset-0 opacity-10 bg-[linear-gradient(90deg,#38bdf8_1px,transparent_1px)] bg-[size:32px_100%]" />
                {originalPeaks.length > 0 ? (
                  <div className="relative w-full h-14 flex items-center">
                    <OriginalPeaksWaveform
                      peaks={originalPeaks}
                      width={Math.max(800, Math.round(duration * zoomLevel))}
                      height={56}
                      volume={isOriginalMuted ? 0 : originalVolume}
                      isMuted={isOriginalMuted}
                    />
                    <span className="absolute left-3 top-1 text-[9px] font-mono tabular-nums text-sky-300/80 bg-neutral-950/80 px-1.5 py-0.5 rounded border border-sky-500/20 pointer-events-none">
                      Оригинальная дорожка видео ({formatSeconds(duration)})
                    </span>
                  </div>
                ) : (
                  <div className="absolute inset-x-0 h-10 my-auto bg-sky-500/10 border-y border-sky-500/20 rounded flex items-center justify-center text-[10px] text-sky-300 font-mono tabular-nums">
                    {videoUrl
                      ? `Аудиопоток оригинального видео подключен (${formatSeconds(duration)})`
                      : `Оригинальный звук серии (${formatSeconds(duration)}) — видео не найдено`}
                  </div>
                )}
              </div>
            </div>

            {/* Tracks 2..N: Subtitle Row + Audio Clip Track Row for each track */}
            {tracks.map(track => {
              const clips = audioClips[track.id] || [];
              const isMuted = mutedTracks.has(track.id);
              const matchingSubs = trackSubLinesMap[track.id] || [];
              const dubberName = track.participant || track.dubberName || 'Даббер';
              const characterName = track.character || track.characterName || 'Персонаж';

              const subHeightClass = trackHeightMode === 'compact' ? 'h-5' : trackHeightMode === 'fit' ? 'h-4' : 'h-6';
              const audioHeightClass = trackHeightMode === 'compact' ? 'h-16' : trackHeightMode === 'fit' ? 'h-14' : 'h-28';

              return (
                <div key={track.id} id={`track-row-${track.id}`} className="flex flex-col shrink-0">
                  {/* Subtitle Lane Row */}
                  <div className={`flex ${subHeightClass} border-b border-indigo-900/40 bg-[#0e1222] shrink-0`}>
                    <div className="w-64 sticky left-0 z-20 shrink-0 bg-[#0e1222] border-r border-indigo-900/40 px-2.5 flex items-center text-indigo-300 text-[9px] font-bold font-mono tracking-wider uppercase select-none">
                      <span className="truncate">💬 Сабы: {characterName}</span>
                    </div>
                    <div 
                      onClick={handleTimelineClick}
                      className="relative shrink-0 bg-[#0c1020] flex items-center overflow-hidden cursor-crosshair"
                      style={{ width: `${Math.max(800, duration * zoomLevel)}px` }}
                    >
                      {/* Playhead Cursor Line */}
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-10 pointer-events-none shadow-[0_0_8px_rgba(251,191,36,0.6)]"
                        style={{ left: `${currentTime * zoomLevel}px` }}
                      />
                      {matchingSubs.map(sub => (
                        <div
                          key={sub.id}
                          className="absolute inset-y-0.5 bg-indigo-900/70 border border-indigo-500/60 rounded px-1.5 text-[9px] text-indigo-100 font-mono truncate flex items-center leading-none shadow-sm"
                          style={{
                            left: `${sub.startSec * zoomLevel}px`,
                            width: `${Math.max(24, (sub.endSec - sub.startSec) * zoomLevel)}px`
                          }}
                          title={`Субтитры [${formatSeconds(sub.startSec)} - ${formatSeconds(sub.endSec)}]: ${sub.text}`}
                        >
                          💬 {sub.text}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Audio Track Row */}
                  <div className={`flex ${audioHeightClass} border-b border-neutral-800 bg-[#090b10] shrink-0`}>
                    {/* Sticky Audio Header */}
                    <div className={`w-64 sticky left-0 z-20 shrink-0 bg-neutral-900 border-r border-neutral-800 ${trackHeightMode === 'fit' ? 'p-1.5' : 'p-2.5'} flex flex-col justify-between hover:bg-neutral-900/90 transition select-none`}>
                      <div>
                        <div className="flex items-center justify-between">
                          <div className="truncate pr-1">
                            <div className="text-xs font-bold text-neutral-100 truncate">
                              🎙 {dubberName}
                            </div>
                            <div className="text-[10px] text-indigo-400 truncate font-mono">
                              {characterName}
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {isAutoNormalize && normalizationMetrics[track.id] && (
                              <span
                                className="px-1 py-0.5 rounded text-[9px] font-mono tabular-nums font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-700/50"
                                title={`Авто-нормализация как в QA: ${normalizationMetrics[track.id].gainDb > 0 ? '+' : ''}${normalizationMetrics[track.id].gainDb.toFixed(1)} dB (RMS: ${normalizationMetrics[track.id].rmsDb.toFixed(1)} dBFS, Peak: ${normalizationMetrics[track.id].peakDb.toFixed(1)} dBFS)`}
                              >
                                {normalizationMetrics[track.id].gainDb > 0 ? `+${normalizationMetrics[track.id].gainDb.toFixed(1)}` : normalizationMetrics[track.id].gainDb.toFixed(1)}dB
                              </span>
                            )}
                            <button
                              onClick={() => setMutedTracks(prev => {
                                const next = new Set(prev);
                                if (next.has(track.id)) next.delete(track.id);
                                else next.add(track.id);
                                return next;
                              })}
                              className={`p-1 rounded text-xs transition ${
                                mutedTracks.has(track.id) ? 'bg-red-500/20 text-red-400' : 'text-neutral-400 hover:text-neutral-200'
                              }`}
                            >
                              {mutedTracks.has(track.id) ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>

                        {/* Track Type Badge & File Info */}
                        <div className="mt-0.5 flex items-center gap-1.5 overflow-hidden">
                          {isFixTrack(track) ? (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-amber-950/80 text-amber-300 border border-amber-800/60 uppercase shrink-0">
                              Фикс
                            </span>
                          ) : track.participant.includes('Дорожка 2') ? (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-purple-950/80 text-purple-300 border border-purple-800/60 uppercase shrink-0">
                              Слой 2 (Внахлест)
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-indigo-950/80 text-indigo-300 border border-indigo-800/60 uppercase shrink-0">
                              Основная
                            </span>
                          )}
                          <span 
                            className="text-[9px] text-neutral-400 font-mono truncate hover:text-neutral-200"
                            title={track.filePath}
                          >
                            {track.filePath.split(/[/\\]/).pop()}
                          </span>
                        </div>
                      </div>

                      {/* Volume Control Presets */}
                      {trackHeightMode === 'compact' || trackHeightMode === 'fit' ? (
                        <div className="flex items-center justify-between pt-0.5 border-t border-neutral-800/40 text-[9px] text-neutral-400">
                          <span className="font-mono text-amber-300 font-bold">
                            {Math.round((volumes[track.id] ?? 1.0) * 100)}%
                          </span>
                          <div className="flex items-center gap-0.5">
                            <button
                              onClick={() => handleSetRoleVolume(track.id, 1.0)}
                              className={`px-1 py-0.5 rounded text-[8px] font-semibold border ${
                                (volumes[track.id] ?? 1.0) === 1.0 ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                              }`}
                            >
                              100%
                            </button>
                            <button
                              onClick={() => handleSetRoleVolume(track.id, 0.7)}
                              className={`px-1 py-0.5 rounded text-[8px] font-semibold border ${
                                (volumes[track.id] ?? 1.0) === 0.7 ? 'bg-amber-600 text-white border-amber-500' : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                              }`}
                            >
                              70%
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1 pt-1 border-t border-neutral-800/50">
                          <div className="flex items-center justify-between text-[9px] text-neutral-400">
                            <span>Громкость роли:</span>
                            <span className="font-mono text-amber-300 font-bold">
                              {Math.round((volumes[track.id] ?? 1.0) * 100)}%
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleSetRoleVolume(track.id, 1.0)}
                              className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border transition ${
                                (volumes[track.id] ?? 1.0) === 1.0 ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                              }`}
                            >
                              100%
                            </button>
                            <button
                              onClick={() => handleSetRoleVolume(track.id, 0.7)}
                              className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border transition ${
                                (volumes[track.id] ?? 1.0) === 0.7 ? 'bg-amber-600 text-white border-amber-500' : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                              }`}
                            >
                              70%
                            </button>
                            <button
                              onClick={() => handleSetRoleVolume(track.id, 0.5)}
                              className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border transition ${
                                (volumes[track.id] ?? 1.0) === 0.5 ? 'bg-purple-600 text-white border-purple-500' : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                              }`}
                            >
                              50%
                            </button>
                          </div>
                        </div>
                      )}

                      {/* AI Audio Cleanup & Polish Action Menu */}
                      <div className="relative mt-1">
                        <button
                          onClick={() => setActiveAiMenuTrackId(activeAiMenuTrackId === track.id ? null : track.id)}
                          disabled={aiProcessingTrackId === track.id}
                          className={`w-full px-2 py-1 rounded text-[10px] font-bold flex items-center justify-between border transition ${
                            aiProcessingTrackId === track.id
                              ? 'bg-amber-950/70 border-amber-800 text-amber-300 animate-pulse'
                              : 'bg-indigo-950/60 hover:bg-indigo-900/80 border-indigo-800/60 text-indigo-200'
                          }`}
                          title="Интеллектуальная AI очистка, De-Plosive, De-Reverb и сатурация дорожки"
                        >
                          <span className="flex items-center gap-1.5 truncate">
                            {aiProcessingTrackId === track.id ? (
                              <Loader2 className="w-3 h-3 animate-spin text-amber-400 shrink-0" />
                            ) : (
                              <Sparkles className="w-3 h-3 text-indigo-400 shrink-0" />
                            )}
                            <span>{aiProcessingTrackId === track.id ? 'Обработка AI...' : '✨ AI Тюнинг'}</span>
                          </span>
                          <ChevronDown className="w-3 h-3 opacity-60" />
                        </button>

                        {activeAiMenuTrackId === track.id && (
                          <div className="absolute left-0 bottom-full mb-1 z-50 w-60 bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl p-1.5 text-xs flex flex-col gap-1 backdrop-blur-md">
                            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo-400 border-b border-neutral-800">
                              AI & DSP Реставрация речи
                            </div>
                            <button
                              onClick={() => handleAICleanupTrack(track.id, 'deplosive')}
                              className="w-full px-2.5 py-1.5 rounded-lg hover:bg-indigo-950/80 hover:text-indigo-200 text-neutral-300 flex items-center gap-2 text-left transition"
                            >
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              <div className="flex flex-col">
                                <span className="font-semibold text-[11px]">De-Plosive Pro</span>
                                <span className="text-[9px] text-neutral-400">Подавление задувов и хлопков «П»/«Б»</span>
                              </div>
                            </button>
                            <button
                              onClick={() => handleAICleanupTrack(track.id, 'thickener')}
                              className="w-full px-2.5 py-1.5 rounded-lg hover:bg-indigo-950/80 hover:text-indigo-200 text-neutral-300 flex items-center gap-2 text-left transition"
                            >
                              <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                              <div className="flex flex-col">
                                <span className="font-semibold text-[11px]">Vocal Thickener</span>
                                <span className="text-[9px] text-neutral-400">Плотность тела + ленточная сатурация</span>
                              </div>
                            </button>
                            <button
                              onClick={() => handleAICleanupTrack(track.id, 'leveler')}
                              className="w-full px-2.5 py-1.5 rounded-lg hover:bg-indigo-950/80 hover:text-indigo-200 text-neutral-300 flex items-center gap-2 text-left transition"
                            >
                              <Sliders className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                              <div className="flex flex-col">
                                <span className="font-semibold text-[11px]">Speech Leveler</span>
                                <span className="text-[9px] text-neutral-400">Выравнивание скачков громкости</span>
                              </div>
                            </button>
                            <button
                              onClick={() => handleAICleanupTrack(track.id, 'dereverb')}
                              className="w-full px-2.5 py-1.5 rounded-lg hover:bg-indigo-950/80 hover:text-indigo-200 text-neutral-300 flex items-center gap-2 text-left transition"
                            >
                              <Radio className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                              <div className="flex flex-col">
                                <span className="font-semibold text-[11px]">Spectral De-Reverb</span>
                                <span className="text-[9px] text-neutral-400">Подавление комнатного эха</span>
                              </div>
                            </button>
                            <button
                              onClick={() => handleAICleanupTrack(track.id, 'headroom')}
                              className="w-full px-2.5 py-1.5 rounded-lg hover:bg-indigo-950/80 hover:text-indigo-200 text-neutral-300 flex items-center gap-2 text-left transition"
                            >
                              <Activity className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                              <div className="flex flex-col">
                                <span className="font-semibold text-[11px]">Headroom Recovery</span>
                                <span className="text-[9px] text-neutral-400">Разгон тихих фраз к -6 dBFS</span>
                              </div>
                            </button>
                            <button
                              onClick={() => handleAICleanupTrack(track.id, 'voicefixer')}
                              className="w-full px-2.5 py-1.5 rounded-lg hover:bg-indigo-950/80 hover:text-indigo-200 text-neutral-300 flex items-center gap-2 text-left transition"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 text-pink-400 shrink-0" />
                              <div className="flex flex-col">
                                <span className="font-semibold text-[11px]">VoiceFixer Air-Boost</span>
                                <span className="text-[9px] text-neutral-400">Восстановление гармоник и верхов</span>
                              </div>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Audio Lane */}
                    <div 
                      onClick={handleTimelineClick}
                      className={`relative shrink-0 flex items-center bg-[#090b10] overflow-hidden select-none transition cursor-crosshair ${
                        isMuted ? 'opacity-30' : ''
                      }`}
                      style={{ width: `${Math.max(800, duration * zoomLevel)}px` }}
                    >
                      {/* Playhead Cursor Line */}
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-10 pointer-events-none shadow-[0_0_8px_rgba(251,191,36,0.6)]"
                        style={{ left: `${currentTime * zoomLevel}px` }}
                      />
                      {/* Subtle DAW track background grid lines */}
                      <div className="absolute inset-0 opacity-10 bg-[linear-gradient(90deg,#3b82f6_1px,transparent_1px)] bg-[size:32px_100%]" />
                      <div className="absolute inset-x-0 top-1/2 h-px bg-neutral-800/40 pointer-events-none" />

                      {/* Sliced Real Audio Clips with PCM Waveforms */}
                      {clips.map(clip => {
                        const clipLeftPx = (clip.clipStartSec + (clip.offsetSec || 0)) * zoomLevel;
                        const clipWidthPx = Math.max(36, clip.durationSec * zoomLevel);
                        const isSelected = selectedClipId === clip.id;

                        return (
                          <div
                            key={clip.id}
                            onClick={(e) => { e.stopPropagation(); setSelectedClipId(clip.id); }}
                            onMouseDown={(e) => handleClipMouseDown(e, track.id, clip)}
                            className={`absolute top-1 bottom-1 rounded-md border flex flex-col justify-between overflow-hidden shadow-lg transition-all cursor-grab active:cursor-grabbing select-none ${
                              clip.hasCollision
                                ? 'bg-red-950/90 border-red-500 shadow-red-500/20 ring-1 ring-red-500/50'
                                : clip.isPhysics
                                ? 'bg-fuchsia-950/85 border-fuchsia-500/80 shadow-fuchsia-500/15'
                                : clip.isSelfOverlap
                                ? 'bg-purple-950/90 border-purple-400 shadow-purple-500/20'
                                : clip.timingIssue === 'desync'
                                ? 'bg-amber-950/90 border-amber-400 ring-1 ring-amber-400/50 shadow-amber-500/25'
                                : clip.timingIssue === 'orphan'
                                ? 'bg-cyan-950/90 border-cyan-400 ring-1 ring-cyan-400/50 shadow-cyan-500/25'
                                : clip.isFix
                                ? 'bg-amber-950/90 border-amber-400 shadow-amber-500/20'
                                : isSelected
                                ? 'bg-indigo-900/90 border-indigo-300 ring-2 ring-indigo-400 shadow-indigo-500/30'
                                : 'bg-[#151a2d]/90 border-indigo-600/80 hover:border-indigo-400'
                            }`}
                            style={{
                              left: `${clipLeftPx}px`,
                              width: `${clipWidthPx}px`
                            }}
                            title={`Клип: ${clip.dubberName} (${formatSeconds(clip.clipStartSec + (clip.offsetSec || 0))})\nТип: ${clip.isPhysics ? '⚡ Физика (охи/вздохи/смех — защищено от сдвига на сабы)' : '💬 Диалоговая фраза'}\nСубтитры: "${clip.text}"${clip.recognizedText ? `\nРаспознано Виспером: "${clip.recognizedText}" (сходство: ${clip.whisperMatchedScore || 100}%)` : ''}\nДлительность: ${clip.durationSec.toFixed(2)}с (от тишины до тишины)`}
                          >
                            {/* Left Edge Resize Handle (Reveals audio from silence or trims start) */}
                            <div
                              onMouseDown={(e) => handleResizeMouseDown(e, track.id, clip, 'start')}
                              className="absolute top-0 bottom-0 left-0 w-2.5 z-30 cursor-ew-resize group/edge flex items-center justify-center hover:bg-amber-400/40 transition-colors"
                              title="Потяните влево для раскрытия начала фразы из тишины, или вправо для подрезки"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="w-0.5 h-6 rounded-full bg-neutral-400/50 group-hover/edge:bg-amber-300 group-hover/edge:w-1 transition-all" />
                            </div>

                            {/* Right Edge Resize Handle (Reveals audio from silence or trims tail) */}
                            <div
                              onMouseDown={(e) => handleResizeMouseDown(e, track.id, clip, 'end')}
                              className="absolute top-0 bottom-0 right-0 w-2.5 z-30 cursor-ew-resize group/edge flex items-center justify-center hover:bg-amber-400/40 transition-colors"
                              title="Потяните вправо для раскрытия хвоста фразы (вздоха/затухания) из тишины, или влево для подрезки"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="w-0.5 h-6 rounded-full bg-neutral-400/50 group-hover/edge:bg-amber-300 group-hover/edge:w-1 transition-all" />
                            </div>

                            {/* Clip Top Header Badge */}
                            <div className={`px-2 py-0.5 text-[9px] font-mono flex items-center justify-between border-b ${
                              clip.isFix 
                                ? 'bg-amber-900/60 border-amber-500/40 text-amber-200' 
                                : clip.isPhysics
                                ? 'bg-fuchsia-900/60 border-fuchsia-500/40 text-fuchsia-200'
                                : clip.hasCollision
                                ? 'bg-red-900/60 border-red-500/40 text-red-200'
                                : clip.timingIssue === 'desync'
                                ? 'bg-amber-900/60 border-amber-500/40 text-amber-200'
                                : clip.timingIssue === 'orphan'
                                ? 'bg-cyan-900/60 border-cyan-500/40 text-cyan-200'
                                : clip.isSelfOverlap
                                ? 'bg-purple-900/60 border-purple-500/40 text-purple-200'
                                : 'bg-indigo-950/80 border-indigo-800/50 text-indigo-200'
                            }`}>
                              <div className="flex items-center gap-1 truncate font-bold">
                                {clip.isFix && <span className="bg-amber-500 text-neutral-950 px-1 rounded text-[8px] font-black">ФИКС</span>}
                                {clip.recoveredFrom && (
                                  <span
                                    className="bg-emerald-500 text-neutral-950 px-1 rounded text-[8px] font-black shrink-0"
                                    title={`Фраза автоматически найдена и восстановлена финальным аудитом из ${clip.recoveredFrom === 'fix' ? 'дорожки фиксов' : 'оригинальной дорожки'}`}
                                  >
                                    🚑 {clip.recoveredFrom === 'fix' ? 'ВОССТ.ФИКС' : 'ВОССТ.ОРИГ'}
                                  </span>
                                )}
                                {clip.isPhysics && (
                                  <span
                                    className="bg-fuchsia-500 text-white px-1 rounded text-[8px] font-black shrink-0"
                                    title="Физика (охи/вздохи/смех вне субтитров — защищена от притягивания к чужим сабам)"
                                  >
                                    ⚡ ФИЗИКА
                                  </span>
                                )}
                                {clip.coveredSubIds && clip.coveredSubIds.length > 1 && (
                                  <span
                                    className="bg-sky-500 text-neutral-950 px-1 rounded text-[8px] font-black shrink-0"
                                    title={`Один слитный аудиоклип покрывает сразу ${clip.coveredSubIds.length} идущих подряд субтитра персонажа`}
                                  >
                                    🔗 x{clip.coveredSubIds.length} САБА
                                  </span>
                                )}
                                {clip.isUnisonPhrase && (
                                  <span
                                    className="bg-indigo-400 text-neutral-950 px-1 rounded text-[8px] font-black shrink-0"
                                    title="Синхронный хор / унисон (выровнено по пику вступления голоса)"
                                  >
                                    🎙 УНИСОН
                                  </span>
                                )}
                                {clip.hasCollision && <span className="bg-red-500 text-white px-1 rounded text-[8px] font-black">НАЕЗД</span>}
                                {clip.timingIssue === 'desync' && (
                                  <span className="bg-amber-500 text-neutral-950 px-1 rounded text-[8px] font-black shrink-0" title={clip.timingIssueText}>
                                    {clip.timeDiffSec && clip.timeDiffSec > 0 ? `⏳ +${clip.timeDiffSec}с` : `⏳ ${clip.timeDiffSec || ''}с`}
                                  </span>
                                )}
                                {clip.timingIssue === 'orphan' && (
                                  <span className="bg-cyan-500 text-neutral-950 px-1 rounded text-[8px] font-black shrink-0" title={clip.timingIssueText}>
                                    🎙 ВНЕ САБОВ
                                  </span>
                                )}
                                {clip.isSelfOverlap && <span className="bg-purple-500 text-white px-1 rounded text-[8px] font-black">СЛОЙ</span>}
                                {clip.recognizedText && (
                                  <span className="bg-emerald-600/90 text-white px-1 rounded text-[7.5px] font-mono font-bold" title={`Виспер: "${clip.recognizedText}"`}>
                                    ASR
                                  </span>
                                )}
                                <span>{formatSeconds(clip.clipStartSec + (clip.offsetSec || 0))}</span>
                                <span className="text-neutral-300 font-sans truncate max-w-[110px] font-medium opacity-90" title={clip.recognizedText ? `Субтитры: "${clip.text}"\nВиспер: "${clip.recognizedText}"` : clip.text}>
                                  {clip.text}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {/* Direct Main Voice Selector on Simultaneous Overlapping Clips */}
                                {clip.isIntentionalOverlap && clip.overlapGroupId && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSetOverlapMainClip(clip.overlapGroupId!, clip.id);
                                    }}
                                    className={`px-1.5 py-0.2 rounded text-[8px] font-black transition border ${
                                      clip.overlapRole === 'main'
                                        ? 'bg-emerald-500 text-neutral-950 border-emerald-300 shadow-sm'
                                        : 'bg-neutral-900/90 hover:bg-emerald-950 text-amber-300 border-amber-500/50'
                                    }`}
                                    title={
                                      clip.overlapRole === 'main'
                                        ? 'Главный голос (0 дБ) в пересечении сабов. Остальные участники этого пересечения автоматически приглушены на -10 дБ.'
                                        : 'Сделать этот голос главным (0 дБ) в пересечении, а остальные приглушить на -10 дБ'
                                    }
                                  >
                                    {clip.overlapRole === 'main' ? '★ Главный (0дБ)' : '🔉 Второй (-10дБ)'}
                                  </button>
                                )}
                                <span className="text-[8px] font-bold text-amber-300">
                                  {clip.volumePercent || 100}%
                                  {typeof clip.volumeGainDb === 'number' && clip.volumeGainDb !== 0 ? ` (${clip.volumeGainDb > 0 ? '+' : ''}${clip.volumeGainDb}dB)` : ''}
                                </span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteClip(clip.id, track.id);
                                  }}
                                  className="p-0.5 text-neutral-400 hover:text-red-300 hover:bg-red-900/60 rounded transition"
                                  title="Удалить фразу / лишний звук (Delete)"
                                >
                                  <Trash2 className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            </div>

                            {/* Real Waveform Canvas inside Clip */}
                            <div className="flex-1 w-full relative overflow-hidden">
                              <ClipWaveform
                                audioBuffer={audioBuffersRef.current[clip.sourceAudioTrackId || track.id]}
                                sourceStartSec={clip.sourceStartSec}
                                sourceEndSec={clip.sourceEndSec}
                                width={Math.round(clipWidthPx)}
                                height={68}
                                color={clip.hasCollision ? '#ef4444' : clip.isPhysics ? '#d946ef' : clip.timingIssue === 'desync' ? '#f59e0b' : clip.timingIssue === 'orphan' ? '#06b6d4' : clip.isSelfOverlap ? '#c084fc' : clip.isFix ? '#fbbf24' : '#818cf8'}
                                volumePercent={clip.volumePercent}
                              />
                              {clip.recognizedText && clip.recognizedText !== clip.text && (
                                <div className="absolute bottom-1 left-1 right-1 pointer-events-none px-1 py-0.5 rounded bg-black/80 text-[8px] text-emerald-300 font-sans italic truncate border border-emerald-500/30">
                                  🎙 {clip.recognizedText}
                                </div>
                              )}
                            </div>

                            {/* Clip Bottom Action Tools (Split, Expand & Nudge, Surgical Fixes) */}
                            <div className="px-1 py-0.5 bg-black/50 flex items-center justify-between opacity-0 hover:opacity-100 transition text-[8px] z-20">
                              <div className="flex items-center gap-0.5">
                                {clip.isIntentionalOverlap && clip.overlapGroupId && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSetOverlapMainClip(clip.overlapGroupId!, clip.id);
                                    }}
                                    className={`px-1.5 py-0.5 rounded font-bold transition shadow mr-0.5 ${
                                      clip.overlapRole === 'main'
                                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                                        : 'bg-amber-700 hover:bg-amber-600 text-white'
                                    }`}
                                    title="Переключить главный голос (0 дБ) / второстепенный голос (-10 дБ) при одновременных сабах"
                                  >
                                    {clip.overlapRole === 'main' ? '★ Главный 0дБ' : '🔉 Сделать главным'}
                                  </button>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleClipPhysics(track.id, clip.id);
                                  }}
                                  className={`px-1 py-0.5 rounded border font-bold transition mr-0.5 ${
                                    clip.isPhysics
                                      ? 'bg-fuchsia-700 hover:bg-fuchsia-600 text-white border-fuchsia-400'
                                      : 'bg-neutral-800 hover:bg-neutral-700 text-fuchsia-300 border-neutral-700'
                                  }`}
                                  title={
                                    clip.isPhysics
                                      ? 'Сейчас помечено как «Физика» (охи/вздохи). Нажмите, чтобы сделать обычной диалоговой фразой.'
                                      : 'Пометить этот звук как «Физика» (охи/вздохи/смех), чтобы автотайминг не двигал его на субтитры.'
                                  }
                                >
                                  {clip.isPhysics ? '⚡ Физика' : '💬 Фраза'}
                                </button>
                                {clip.timingIssue === 'desync' && typeof clip.targetSubStartSec === 'number' && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleFixSingleClip(track.id, clip.id); }}
                                    className="px-1.5 py-0.5 bg-amber-600 hover:bg-amber-500 text-white rounded font-bold transition shadow mr-0.5"
                                    title={`Поставить фразу точно на субтитр (${formatSeconds(clip.targetSubStartSec)})`}
                                  >
                                    🎯 К субтитру
                                  </button>
                                )}
                                {clip.hasCollision && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleResolveSingleOverlap(track.id, clip.id); }}
                                    className="px-1.5 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded font-bold transition shadow mr-0.5"
                                    title="Раздвинуть наезд"
                                  >
                                    ↔️ Раздвинуть
                                  </button>
                                )}
                                {clip.timingIssue === 'orphan' && typeof clip.targetSubStartSec === 'number' && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleFixSingleClip(track.id, clip.id); }}
                                    className="px-1.5 py-0.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-bold transition shadow mr-0.5"
                                    title={`Подставить к найденному субтитру (${formatSeconds(clip.targetSubStartSec)})`}
                                  >
                                    🎯 К сабу
                                  </button>
                                )}
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleSplitClip(track.id, clip.id); }}
                                  className="px-1 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 rounded border border-neutral-700 font-bold"
                                  title="Разрезать клип на 2 части"
                                >
                                  ✂
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleExpandClip(track.id, clip.id, 'start', 0.25); }}
                                  className="px-1 py-0.5 bg-amber-950/70 hover:bg-amber-800 text-amber-300 rounded border border-amber-700/60 font-mono"
                                  title="Раскрыть начало на +0.25с из тишины"
                                >
                                  ◀+0.25с
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleExpandClip(track.id, clip.id, 'end', 0.25); }}
                                  className="px-1 py-0.5 bg-amber-950/70 hover:bg-amber-800 text-amber-300 rounded border border-amber-700/60 font-mono"
                                  title="Раскрыть хвост на +0.25с из тишины"
                                >
                                  +0.25с▶
                                </button>
                              </div>
                              <div className="flex items-center gap-0.5">
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleNudgeClip(track.id, clip.id, -0.05); }}
                                  className="px-1 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded border border-neutral-700 font-mono"
                                  title="-50 мс"
                                >
                                  -50ms
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleNudgeClip(track.id, clip.id, 0.05); }}
                                  className="px-1 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded border border-neutral-700 font-mono"
                                  title="+50 мс"
                                >
                                  +50ms
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDeleteClip(clip.id, track.id); }}
                                  className="px-1 py-0.5 bg-red-950/80 hover:bg-red-800 text-red-300 hover:text-white rounded border border-red-700/60 font-bold ml-0.5 transition"
                                  title="Удалить фразу из тайминга и монтажа (Delete)"
                                >
                                  <Trash2 className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      {/* Interactive Missing Subtitle Placeholder Slots on this Track Lane */}
                      {missingSubtitles
                        .filter(m => m.trackId === track.id)
                        .map(marker => {
                          const markerLeftPx = marker.startSec * zoomLevel;
                          const markerWidthPx = Math.max(72, (marker.endSec - marker.startSec) * zoomLevel);
                          return (
                            <div
                              key={marker.id}
                              onClick={(e) => { e.stopPropagation(); jumpToTime(marker.startSec); }}
                              className="absolute top-1 bottom-1 rounded-md border-2 border-dashed border-amber-500/80 bg-amber-950/40 hover:bg-amber-900/50 z-20 flex flex-col justify-between p-1.5 shadow-lg shadow-amber-950/40 transition select-none cursor-pointer group backdrop-blur-[2px]"
                              style={{
                                left: `${markerLeftPx}px`,
                                width: `${markerWidthPx}px`
                              }}
                              title={`Пропущена реплика «${marker.characterName}» [${formatSeconds(marker.startSec)} - ${formatSeconds(marker.endSec)}]:\n«${marker.text}»\nНажмите для загрузки реплики отдельно`}
                            >
                              <div className="flex items-center justify-between gap-1 text-[8.5px] font-mono leading-none">
                                <span className="flex items-center gap-1 font-bold text-amber-300">
                                  <AlertTriangle className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                                  <span className="bg-amber-500/20 text-amber-300 px-1 py-0.5 rounded border border-amber-500/40">ПРОПУСК</span>
                                  <span>{formatSeconds(marker.startSec)}</span>
                                </span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDismissMissing(marker.id); }}
                                  className="p-0.5 text-neutral-400 hover:text-neutral-200 rounded opacity-0 group-hover:opacity-100 transition"
                                  title="Скрыть этот пропуск"
                                >
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              </div>

                              <div className="text-[10px] text-amber-100 font-sans font-medium truncate my-auto px-0.5 opacity-90" title={marker.text}>
                                💬 «{marker.text}»
                              </div>

                              <div className="flex items-center justify-between gap-1 pt-0.5 border-t border-amber-800/40 text-[8px]">
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleTriggerUploadMissing(marker); }}
                                  className="px-1.5 py-0.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded flex items-center gap-1 shadow transition"
                                  title="Загрузить аудиофайл реплики отдельно"
                                >
                                  <Download className="w-2.5 h-2.5" />
                                  <span>+ Загрузить</span>
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleCopyMissingTimecode(marker.text, marker.startSec, marker.endSec); }}
                                  className="px-1 py-0.5 bg-neutral-900/80 hover:bg-neutral-800 text-amber-300 rounded border border-amber-700/60 font-mono transition"
                                  title="Скопировать таймкод в буфер обмена"
                                >
                                  <Copy className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Bottom floating scroll hint when in standard height mode and tracks exceed screen */}
            {tracks.length > 4 && trackHeightMode === 'standard' && (
              <div className="sticky bottom-3 z-30 flex justify-center pointer-events-none mt-2">
                <button
                  onClick={() => {
                    if (timelineContainerRef.current) {
                      timelineContainerRef.current.scrollTop += 300;
                    }
                  }}
                  className="pointer-events-auto bg-neutral-900/95 hover:bg-neutral-800 text-neutral-200 border border-indigo-500/50 hover:border-indigo-400 px-4 py-1.5 rounded-full text-xs font-semibold shadow-2xl flex items-center gap-2 backdrop-blur transition hover:scale-105"
                >
                  <ChevronDown className="w-3.5 h-3.5 text-indigo-400 animate-bounce" />
                  <span>Всего {tracks.length} дорожек. Нажмите для скролла или переключите «Компактный вид»</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer Playback, Inspector & Zoom Controls */}
      <footer className="bg-neutral-900 border-t border-neutral-800 p-2.5 px-4 shrink-0 flex items-center justify-between gap-4">
        {/* Playback Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="w-8 h-8 bg-amber-600 hover:bg-amber-500 text-white rounded-lg flex items-center justify-center shadow transition"
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </button>
          <button
            onClick={() => seekToTime(0)}
            className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition"
            title="В начало (00:00)"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <div className="font-mono tabular-nums text-xs text-neutral-200 bg-neutral-950 px-3 py-1.5 rounded-lg border border-neutral-800">
            <span className="text-amber-400 font-bold">{formatSeconds(currentTime)}</span>
            <span className="text-neutral-600 mx-1">/</span>
            <span className="text-neutral-400">{formatSeconds(duration)}</span>
          </div>
        </div>

        {/* Selected Clip Volume & Expansion Inspector */}
        {activeSelectedClip && (
          <div className="flex items-center gap-3 bg-neutral-950 px-3 py-1.5 rounded-xl border border-indigo-800 text-xs shadow-lg">
            <span className="font-bold text-indigo-300 max-w-[150px] truncate" title={activeSelectedClip.clip.text}>
              {activeSelectedClip.clip.characterName}: {activeSelectedClip.clip.text}
            </span>
            <div className="flex items-center gap-2 border-l border-neutral-800 pl-2.5">
              <span className="text-[10px] text-neutral-400">Громкость:</span>
              <input
                type="range"
                min="0"
                max="200"
                step="5"
                value={activeSelectedClip.clip.volumePercent ?? 100}
                onChange={(e) => handleSetClipVolume(activeSelectedClip.trackId, activeSelectedClip.clip.id, Number(e.target.value))}
                className="w-20 accent-indigo-500 h-1.5 bg-neutral-800 rounded cursor-pointer"
              />
              <span className="font-mono text-xs text-amber-300 font-bold w-9 text-right">
                {activeSelectedClip.clip.volumePercent ?? 100}%
              </span>
            </div>

            {/* Quick manual expansion buttons: reveal cut audio from silence */}
            <div className="flex items-center gap-1 border-l border-neutral-800 pl-2.5">
              <span className="text-[10px] text-neutral-400 mr-0.5">Границы:</span>
              <button
                onClick={() => handleExpandClip(activeSelectedClip.trackId, activeSelectedClip.clip.id, 'start', 0.5)}
                className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 rounded text-[10px] border border-neutral-700 transition"
                title="Раскрыть начало фразы на +0.5 сек из тишины"
              >
                ◀ +0.5с
              </button>
              <button
                onClick={() => handleExpandClip(activeSelectedClip.trackId, activeSelectedClip.clip.id, 'end', 0.5)}
                className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 rounded text-[10px] border border-neutral-700 transition"
                title="Раскрыть хвост фразы на +0.5 сек из тишины"
              >
                +0.5с ▶
              </button>
              <button
                onClick={() => handleExpandClip(activeSelectedClip.trackId, activeSelectedClip.clip.id, 'end', 1.0)}
                className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 rounded text-[10px] border border-neutral-700 transition"
                title="Раскрыть хвост фразы на +1.0 сек из тишины"
              >
                +1.0с ▶
              </button>
              <button
                onClick={() => handleResetClipToOriginal(activeSelectedClip.trackId, activeSelectedClip.clip.id)}
                className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white rounded text-[10px] border border-neutral-700 transition"
                title="Сбросить границы клипа к исходной детекции"
              >
                Сброс
              </button>
              <button
                onClick={() => handleDeleteClip(activeSelectedClip.clip.id, activeSelectedClip.trackId)}
                className="px-2 py-0.5 bg-red-950/80 hover:bg-red-800 text-red-300 hover:text-white rounded text-[10px] font-semibold border border-red-700/60 transition flex items-center gap-1 ml-1"
                title="Удалить выбранную фразу / шум (Delete)"
              >
                <Trash2 className="w-3 h-3" />
                <span>Удалить (Del)</span>
              </button>
            </div>
          </div>
        )}

        {/* Zoom Controls */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-neutral-400">Масштаб:</span>
          <button
            onClick={() => setZoomLevel(prev => Math.max(10, prev - 10))}
            className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <input
            type="range"
            min="10"
            max="120"
            value={zoomLevel}
            onChange={(e) => setZoomLevel(Number(e.target.value))}
            className="w-24 accent-amber-500 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
          />
          <button
            onClick={() => setZoomLevel(prev => Math.min(120, prev + 10))}
            className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </footer>

      {/* Expandable Operation Logs Drawer */}
      {isLogDrawerOpen && (
        <div className="bg-neutral-900 border-t border-neutral-800 h-44 flex flex-col shrink-0">
          <div className="p-2 px-4 bg-neutral-950 border-b border-neutral-800 flex items-center justify-between text-xs font-bold text-neutral-300">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-amber-400" />
              <span>Журнал операций тайминга ({operationLogs.length})</span>
            </div>
            <button
              onClick={() => setOperationLogs([])}
              className="text-[10px] text-neutral-400 hover:text-white"
            >
              Очистить
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 px-4 space-y-1 font-mono text-[11px]">
            {operationLogs.map((log, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="text-neutral-500">[{log.time}]</span>
                <span className={
                  log.level === 'error' ? 'text-red-400' :
                  log.level === 'warn' ? 'text-amber-400' :
                  log.level === 'success' ? 'text-emerald-400' :
                  'text-neutral-300'
                }>
                  {log.msg}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Export Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        episode={currentEpisode!}
        role="SOUND_ENGINEER"
        onExport={handleExportSoundEngineerFromTiming}
        isExporting={isExportingSE}
        progress={exportProgress}
      />

      {/* Timing and Silence Settings Modal */}
      <TimingSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={timingSettings}
        onSave={handleSaveSettings}
      />
    </div>
  );
}
