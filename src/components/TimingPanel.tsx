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
  const nonNullWindows = rmsDbValues.filter(v => v > -88);
  const activeFraction = nonNullWindows.length / Math.max(1, rmsDbValues.length);
  const isGatedOrSparseTrack = activeFraction < 0.55;

  let noiseFloorDb: number;
  let noiseUpperDb: number;

  if (isGatedOrSparseTrack) {
    const rawClipNoise = nonNullWindows.length > 20
      ? nonNullWindows[Math.floor(nonNullWindows.length * 0.08)]
      : -72;
    noiseFloorDb = Math.max(-84, Math.min(-52, rawClipNoise));
    noiseUpperDb = Math.min(-48, noiseFloorDb + 3.0);
  } else {
    const rawRoomNoise = rmsDbValues[Math.floor(rmsDbValues.length * 0.15)];
    const medianDb = rmsDbValues[Math.floor(rmsDbValues.length * 0.50)];
    noiseFloorDb = Math.max(-84, Math.min(-48, rawRoomNoise));
    noiseUpperDb = Math.min(-44, medianDb, noiseFloorDb + 3.5);
  }

  // Top 0.5% energy windows represent true vocal peaks
  const topPeakIdx = Math.min(rmsDbValues.length - 1, Math.max(0, Math.floor(rmsDbValues.length * 0.995)));
  const topVoicePeakDb = rmsDbValues[topPeakIdx];

  // Filter strictly for real vocal syllable windows (within 26 dB of peak voice and well above room noise)
  // so quiet room-tone tails never drag speechFloorDb down to -55..-65 dB
  const minSpeechCandDb = Math.max(
    -54,
    noiseUpperDb + 8.0,
    noiseFloorDb + 10.0,
    topVoicePeakDb - 26.0
  );
  const activeSpeechWindows = rmsDbValues.filter(v => v >= minSpeechCandDb);

  const speechFloorDb = activeSpeechWindows.length > 0
    ? activeSpeechWindows[Math.floor(activeSpeechWindows.length * 0.30)]
    : Math.max(-42, topVoicePeakDb - 18.0);
  const speechPeakDb = activeSpeechWindows.length > 0
    ? activeSpeechWindows[Math.floor(activeSpeechWindows.length * 0.90)]
    : Math.max(speechFloorDb + 6.0, topVoicePeakDb);

  let calculatedThresholdDb: number;
  if (manualThresholdDb !== undefined && manualThresholdDb !== null && !isNaN(manualThresholdDb)) {
    calculatedThresholdDb = manualThresholdDb;
  } else {
    // Keep auto-threshold in the clean vocal trigger band [-50 dB, -38 dB]:
    // High enough to never trigger on room tone / breath pauses between phrases,
    // low enough to catch every spoken syllable.
    const safeNoiseMarginDb = Math.max(-50, noiseUpperDb + 8.0, noiseFloorDb + 12.0);
    const voiceEntryDb = Math.min(-38, speechFloorDb - 6.0, speechPeakDb - 18.0);
    calculatedThresholdDb = Math.max(-50, Math.min(-38, Math.max(safeNoiseMarginDb, voiceEntryDb)));
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
 * Surgical Speech Interval Detection on decoded AudioBuffer.
 * - Cuts ONLY silence between phrases without shifting phrase timecodes (clipStartSec === sourceStartSec).
 * - Uses tight, natural word-edge detection (100ms pre-edge, 140ms post-edge, 80ms/120ms padding) so phrases
 *   never glue together into 15-30s blocks and never acquire 500ms-1000ms of pre-speech dead air.
 * - Performs Subtitle-Boundary Valley Splitting when `subLines` are provided so consecutive subtitles
 *   separated by a brief breath dip (>= 60ms) are cleanly separated into individual clips.
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
    minSilenceDurationSec = 0.24,
    leadInPaddingSec = 0.08,
    leadOutPaddingSec = 0.12,
    minSpeechDurationSec = 0.16,
    mergeCloseGapsSec = 0.18,
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

  // Tight word-edge threshold (5 dB below trigger, never below -56 dB) to capture consonant attacks/releases
  // without bridging across inter-phrase pauses or room tone.
  const edgeThresholdDb = Math.max(
    -56,
    calib.noiseFloorDb + 8.0,
    calib.calculatedThresholdDb - 5.0
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
    if (maxRms >= triggerThresholdAmp || (maxPeak >= triggerThresholdAmp * 2.2 && maxRms >= edgeThresholdAmp)) {
      isSpeechChunk[i] = 1;
    }
  }

  // Subtitle-Window Quiet Phrase Recovery:
  // If a subtitle window [sub.startSec - 0.6, sub.endSec + 0.6] has no detected chunks at global threshold
  // because the actor whispered that line, recover it locally if it sits clearly above room noise.
  if (subLines && subLines.length > 0 && duration >= 45 && manualThresholdDb === undefined) {
    const minLocalNoiseAmp = Math.pow(10, Math.max(-58, calib.noiseFloorDb + 8.0) / 20);
    for (const sub of subLines) {
      const wStartSec = Math.max(0, sub.startSec - 0.6);
      const wEndSec = Math.min(duration, sub.endSec + 0.6);
      const startChunk = Math.max(0, Math.floor((wStartSec * sampleRate) / chunkSize));
      const endChunk = Math.min(totalChunks - 1, Math.floor((wEndSec * sampleRate) / chunkSize));
      if (endChunk <= startChunk + 4) continue;

      let activeCount = 0;
      let localMaxRms = 0;
      for (let cIdx = startChunk; cIdx <= endChunk; cIdx++) {
        if (isSpeechChunk[cIdx] === 1) activeCount++;
        if (chunkRmsValues[cIdx] > localMaxRms) localMaxRms = chunkRmsValues[cIdx];
      }

      if (activeCount < 3 && localMaxRms >= minLocalNoiseAmp * 1.5) {
        const localThreshAmp = Math.max(minLocalNoiseAmp, localMaxRms * 0.30);
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

  // Pass 1: Smooth only intra-word stop-consonant closures (<= 180ms)
  const effectiveMergeSec = Math.min(0.22, Math.max(0.14, mergeCloseGapsSec));
  const minSilenceChunks = Math.max(3, Math.floor(effectiveMergeSec / 0.02));
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

  // Pass 2: Tight Local Word-Edge Expansion (up to 100ms backwards and 140ms forwards)
  const maxBackwardExpandChunks = 5; // 100ms
  const maxForwardExpandChunks = 7;  // 140ms
  const isAboveEdge = (idx: number) =>
    chunkRmsValues[idx] >= edgeThresholdAmp || chunkPeakValues[idx] >= edgeThresholdAmp * 2.0;

  let segIdx = 0;
  while (segIdx < totalChunks) {
    if (isSpeechChunk[segIdx] === 1) {
      const segStart = segIdx;
      while (segIdx < totalChunks && isSpeechChunk[segIdx] === 1) {
        segIdx++;
      }
      const segEnd = segIdx - 1;

      let newStart = segStart;
      let backSilentRun = 0;
      const minBackLimit = Math.max(0, segStart - maxBackwardExpandChunks);
      for (let b = segStart - 1; b >= minBackLimit; b--) {
        if (isAboveEdge(b)) {
          newStart = b;
          backSilentRun = 0;
        } else {
          backSilentRun++;
          if (backSilentRun > 1) break;
        }
      }
      for (let k = newStart; k < segStart; k++) {
        isSpeechChunk[k] = 1;
      }

      let newEnd = segEnd;
      let fwdSilentRun = 0;
      const maxFwdLimit = Math.min(totalChunks - 1, segEnd + maxForwardExpandChunks);
      for (let f = segEnd + 1; f <= maxFwdLimit; f++) {
        if (isAboveEdge(f)) {
          newEnd = f;
          fwdSilentRun = 0;
        } else {
          fwdSilentRun++;
          if (fwdSilentRun > 1) break;
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

  // Clamp padding to surgical values (60-100ms lead-in, 90-150ms lead-out) so clip start matches actual speech onset
  const effectiveLeadInSec = Math.min(0.10, Math.max(0.05, leadInPaddingSec));
  const effectiveLeadOutSec = Math.min(0.15, Math.max(0.08, leadOutPaddingSec));
  const effectiveMinSilenceSec = Math.min(0.26, Math.max(0.16, minSilenceDurationSec));

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

  // Merge intervals only if the gap between them is smaller than effectiveMinSilenceSec
  const mergedIntervals: Array<{ startSec: number; endSec: number; durationSec: number }> = [];
  for (const interval of rawIntervals) {
    if (mergedIntervals.length === 0) {
      mergedIntervals.push({ ...interval });
    } else {
      const last = mergedIntervals[mergedIntervals.length - 1];
      const gap = interval.startSec - last.endSec;
      if (gap < effectiveMinSilenceSec) {
        last.endSec = Math.max(last.endSec, interval.endSec);
        last.durationSec = Number((last.endSec - last.startSec).toFixed(2));
      } else {
        mergedIntervals.push({ ...interval });
      }
    }
  }

  // Pass 3: Subtitle-Boundary Valley Splitting
  // If a detected interval spans across 2+ consecutive subtitles of this character, inspect the transition
  // window [subA.endSec - 0.35, subB.startSec + 0.35] for an acoustic breath/pause valley (>= 60ms).
  // Splitting at the valley separates consecutive sentences into individual clips while keeping startSec === sourceStartSec!
  if (!subLines || subLines.length < 2) {
    return mergedIntervals;
  }

  const sortedSubs = [...subLines].sort((a, b) => a.startSec - b.startSec);
  const finalIntervals: Array<{ startSec: number; endSec: number; durationSec: number }> = [];

  for (const iv of mergedIntervals) {
    const overlappingSubs = sortedSubs.filter(
      s => s.startSec <= iv.endSec - 0.15 && s.endSec >= iv.startSec + 0.15
    );
    if (overlappingSubs.length < 2 || iv.durationSec < 1.1) {
      finalIntervals.push(iv);
      continue;
    }

    let currentStart = iv.startSec;
    for (let sIdx = 0; sIdx < overlappingSubs.length - 1; sIdx++) {
      const subA = overlappingSubs[sIdx];
      const subB = overlappingSubs[sIdx + 1];
      if (subB.startSec < subA.endSec - 0.10) continue;

      const searchStartSec = Math.max(currentStart + 0.30, subA.endSec - 0.35);
      const searchEndSec = Math.min(iv.endSec - 0.30, subB.startSec + 0.35);
      if (searchEndSec <= searchStartSec + 0.08) continue;

      const cStart = Math.max(0, Math.floor((searchStartSec * sampleRate) / chunkSize));
      const cEnd = Math.min(totalChunks - 3, Math.floor((searchEndSec * sampleRate) / chunkSize));
      if (cEnd <= cStart + 2) continue;

      // Measure surrounding phrase peak RMS
      const phraseStartChunk = Math.max(0, Math.floor((currentStart * sampleRate) / chunkSize));
      const phraseEndChunk = Math.min(totalChunks - 1, Math.floor((iv.endSec * sampleRate) / chunkSize));
      let localPhrasePeakRms = 0;
      for (let k = phraseStartChunk; k <= phraseEndChunk; k++) {
        if (chunkRmsValues[k] > localPhrasePeakRms) localPhrasePeakRms = chunkRmsValues[k];
      }

      // Find the quietest 3-chunk (60ms) valley inside [cStart, cEnd]
      let minValleyRms = Infinity;
      let minValleyChunk = -1;
      for (let k = cStart; k <= cEnd; k++) {
        const avg3 = (chunkRmsValues[k] + chunkRmsValues[k + 1] + chunkRmsValues[k + 2]) / 3;
        if (avg3 < minValleyRms) {
          minValleyRms = avg3;
          minValleyChunk = k + 1;
        }
      }

      const isGenuinePauseValley =
        minValleyChunk !== -1 &&
        (minValleyRms <= triggerThresholdAmp * 1.45 || minValleyRms <= localPhrasePeakRms * 0.32);

      if (isGenuinePauseValley) {
        const splitSec = Number(((minValleyChunk * chunkSize) / sampleRate).toFixed(2));
        const leftEnd = Number(Math.max(currentStart + 0.20, splitSec - 0.01).toFixed(2));
        const rightStart = Number(Math.min(iv.endSec - 0.20, splitSec + 0.01).toFixed(2));
        if (leftEnd - currentStart >= minSpeechDurationSec && iv.endSec - rightStart >= minSpeechDurationSec) {
          finalIntervals.push({
            startSec: currentStart,
            endSec: leftEnd,
            durationSec: Number((leftEnd - currentStart).toFixed(2))
          });
          currentStart = rightStart;
        }
      }
    }

    if (iv.endSec - currentStart >= minSpeechDurationSec) {
      finalIntervals.push({
        startSec: currentStart,
        endSec: iv.endSec,
        durationSec: Number((iv.endSec - currentStart).toFixed(2))
      });
    }
  }

  return finalIntervals;
}

/**
 * Detects the exact acoustic vocal onset offset inside a clip [sourceStartSec, sourceEndSec].
 * Used for unison / mass phrases and surgical alignment so that the dubber's actual vocal attack
 * lands on the subtitle start without being delayed by lead-in padding.
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
  const scanLimitSec = Math.min(sourceEndSec, sourceStartSec + 0.45);
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
  const onsetThreshold = Math.max(1e-3, maxRms * 0.25);

  for (let idx = 0; idx < rmsList.length; idx++) {
    if (rmsList[idx] >= onsetThreshold) {
      const offsetSec = (idx * winSamples) / sampleRate;
      return Number(Math.max(0, Math.min(0.25, offsetSec)).toFixed(3));
    }
  }
  return 0;
}

/**
 * Measures active speech windows and syllable energy spread inside a clip or buffer region.
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
 * Scans a strictly bounded local window [windowStartSec, windowEndSec] in a Fix or Original AudioBuffer
 * to recover genuinely missing phrases without ever merging adjacent lines or picking up room noise.
 */
function scanBufferWindowForSpeech(
  audioBuffer: AudioBuffer,
  windowStartSec: number,
  windowEndSec: number,
  leadInSec = 0.08,
  leadOutSec = 0.12
): Array<{ startSec: number; endSec: number; durationSec: number }> {
  if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function') return [];
  const calib = analyzeTrackAudioNoiseFloor(audioBuffer);
  const sensitiveDb = Math.max(
    -52,
    calib.noiseFloorDb + 8.0,
    Math.min(-40, calib.calculatedThresholdDb - 3.0)
  );
  const thresholdAmp = Math.pow(10, sensitiveDb / 20);
  const edgeAmp = Math.pow(10, Math.max(-56, calib.noiseFloorDb + 6.0, sensitiveDb - 4.0) / 20);

  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const startSecClamped = Math.max(0, windowStartSec);
  const endSecClamped = Math.min(audioBuffer.duration, windowEndSec);
  if (endSecClamped <= startSecClamped + 0.14) return [];

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

  // Smooth micro-gaps < 160ms
  const smoothChunks = Math.floor(0.16 / 0.02);
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

  // Tight local edge expansion (up to 80ms back, 100ms forward)
  for (let i = 0; i < numChunks; i++) {
    if (isSpeech[i] === 1) {
      for (let b = i - 1; b >= Math.max(0, i - 4); b--) {
        if (chunkRms[b] >= edgeAmp) isSpeech[b] = 1;
        else break;
      }
      while (i < numChunks && isSpeech[i] === 1) i++;
      const endIdx = i - 1;
      for (let f = endIdx + 1; f < Math.min(numChunks, endIdx + 5); f++) {
        if (chunkRms[f] >= edgeAmp) isSpeech[f] = 1;
        else break;
      }
    }
  }

  const effLeadIn = Math.min(0.10, Math.max(0.05, leadInSec));
  const effLeadOut = Math.min(0.14, Math.max(0.08, leadOutSec));

  const found: Array<{ startSec: number; endSec: number; durationSec: number }> = [];
  let inSeg = false;
  let segStart = 0;
  for (let i = 0; i < numChunks; i++) {
    const t = startSecClamped + (i * chunkSize) / sampleRate;
    if (isSpeech[i] === 1 && !inSeg) {
      inSeg = true;
      segStart = Math.max(0, t - effLeadIn);
    } else if (isSpeech[i] === 0 && inSeg) {
      inSeg = false;
      const segEnd = Math.min(audioBuffer.duration, t + effLeadOut);
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
      const exactSamplesPerBar = totalSamples / numBars;

      ctx.fillStyle = color;

      for (let i = 0; i < numBars; i++) {
        const offset = startSample + Math.floor(i * exactSamplesPerBar);
        const nextOffset = Math.min(endSample, Math.max(offset + 1, startSample + Math.floor((i + 1) * exactSamplesPerBar)));
        let maxPeak = 0;
        for (let j = offset; j < nextOffset; j++) {
          const val = Math.abs(channelData[j]);
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
  isSplitContinuation?: boolean; // 2nd/3rd part of a phrase split by a dramatic pause inside the same subtitle (locked in place)
  overlapResolvedLock?: boolean; // Locked after surgical overlap separation so audit loop never pulls it back into collision
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
  const allCatalogTracksRef = useRef<Track[]>([]);
  const isStateRestoredRef = useRef<boolean>(false);
  const [savedTimingStateInfo, setSavedTimingStateInfo] = useState<{
    savedAt: string;
    filePath?: string;
  } | null>(null);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState<boolean>(false);
  
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
  const [rawSubtitles, setRawSubtitles] = useState<SubtitleLine[]>([]);
  const [trackSubLinesMap, setTrackSubLinesMap] = useState<Record<string, SubtitleLine[]>>({});
  const subtitles = useMemo<SubtitleLine[]>(() => {
    if (rawSubtitles.length > 0) return rawSubtitles;
    const seen = new Set<string>();
    const merged: SubtitleLine[] = [];
    for (const list of Object.values(trackSubLinesMap)) {
      for (const s of list) {
        const key = String(s.id ?? `${s.startSec}_${s.text}`);
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(s);
        }
      }
    }
    return merged.sort((a, b) => a.startSec - b.startSec);
  }, [rawSubtitles, trackSubLinesMap]);

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
      const saved = localStorage.getItem('timing_settings_v3');
      if (saved) return { ...DEFAULT_TIMING_SETTINGS, ...JSON.parse(saved) };
    } catch (e) {}
    return DEFAULT_TIMING_SETTINGS;
  });
  const [calibrationsByTrack, setCalibrationsByTrack] = useState<Record<string, NoiseCalibration>>({});

  const handleSaveSettings = (newSettings: TimingSettings) => {
    setTimingSettings(newSettings);
    try {
      localStorage.setItem('timing_settings_v3', JSON.stringify(newSettings));
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
    voicedByOtherDubberCount?: number;
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
  const loadEpisodeData = useCallback(async (isImportFlow = false, forceReset = false) => {
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
      setRawSubtitles(parsedLines);

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

      // 1C. Check for Saved Timing State in <EpisodeDir>/Тайминг/timing_state.json
      if (!isImportFlow && !forceReset) {
        try {
          const savedStateRes: any = await ipcSafe.invoke('timing-load-state', { episode: currentEpisode }).catch(() => null);
          if (
            savedStateRes &&
            savedStateRes.exists &&
            savedStateRes.state &&
            Array.isArray(savedStateRes.state.tracks) &&
            savedStateRes.state.tracks.length > 0 &&
            savedStateRes.state.audioClips
          ) {
            const st = savedStateRes.state;
            addLog(`💾 Загружено сохраненное состояние тайминга из «${savedStateRes.timingDir || 'Тайминг'}» (${st.updatedAt ? new Date(st.updatedAt).toLocaleString('ru-RU') : ''}). Восстановление...`, 'info');
            updateProcess('Загрузка проекта тайминга', 'Восстановление сохраненного таймлайна и декодирование аудиоволн...', 25, 3, 5);

            const restoredTracks: Track[] = st.tracks;
            const catalogTracks: Track[] = Array.isArray(st.allCatalogTracks) && st.allCatalogTracks.length > 0
              ? st.allCatalogTracks
              : restoredTracks;

            allCatalogTracksRef.current = catalogTracks;
            setTracks(restoredTracks);
            setAudioClips(st.audioClips || {});
            if (st.trackSubLinesMap) setTrackSubLinesMap(st.trackSubLinesMap);
            setIsSilenceRemoved(Boolean(st.isSilenceRemoved));
            setIsFixesStitched(Boolean(st.isFixesStitched));
            setIsTimingAnalyzed(Boolean(st.isTimingAnalyzed));
            setCollisions(Array.isArray(st.collisions) ? st.collisions : []);
            setIntentionalOverlaps(Array.isArray(st.intentionalOverlaps) ? st.intentionalOverlaps : []);
            setTimingIssues(Array.isArray(st.timingIssues) ? st.timingIssues : []);
            setMissingSubtitles(Array.isArray(st.missingSubtitles) ? st.missingSubtitles : []);
            if (st.qaPassportLoaded) setQaPassportLoaded(st.qaPassportLoaded);
            if (st.finalVerificationReport) setFinalVerificationReport(st.finalVerificationReport);
            if (st.calibrationsByTrack) setCalibrationsByTrack(st.calibrationsByTrack);
            if (st.volumes) setVolumes(st.volumes);
            if (Array.isArray(st.mutedTracks)) setMutedTracks(new Set(st.mutedTracks));
            if (typeof st.originalVolume === 'number') setOriginalVolume(st.originalVolume);
            if (typeof st.isOriginalMuted === 'boolean') setIsOriginalMuted(st.isOriginalMuted);
            if (typeof st.zoomLevel === 'number') setZoomLevel(st.zoomLevel);
            if (st.trackHeightMode) setTrackHeightMode(st.trackHeightMode);
            if (st.timingSettings) setTimingSettings(prev => ({ ...prev, ...st.timingSettings }));

            setSavedTimingStateInfo({
              savedAt: st.updatedAt || new Date().toISOString(),
              filePath: savedStateRes.filePath
            });

            // Decode AudioBuffers for all catalog tracks + any extra source audio referenced in clips
            const sharedAudioCtx = getSharedAudioContext();
            const sourcesToDecode = new Map<string, { id: string; filePath: string; participant: string; isFix?: boolean; dubberName?: string }>();

            catalogTracks.forEach(t => {
              if (t.filePath) {
                sourcesToDecode.set(t.id, {
                  id: t.id,
                  filePath: t.filePath,
                  participant: t.participant,
                  isFix: isFixTrack(t),
                  dubberName: t.dubberName
                });
              }
            });

            // Also check audioClips for any sourceAudioPath not yet in sourcesToDecode (e.g. stitched fix clips or uploaded clips)
            Object.values(st.audioClips as Record<string, AudioClip[]>).forEach(cList => {
              (cList || []).forEach(c => {
                if (c.sourceAudioTrackId && c.sourceAudioPath && !sourcesToDecode.has(c.sourceAudioTrackId)) {
                  sourcesToDecode.set(c.sourceAudioTrackId, {
                    id: c.sourceAudioTrackId,
                    filePath: c.sourceAudioPath,
                    participant: `${c.dubberName || 'Даббер'} (${c.isFix ? 'Фикс' : 'Аудио'})`,
                    isFix: Boolean(c.isFix),
                    dubberName: c.dubberName
                  });
                }
              });
            });

            const decodeList = Array.from(sourcesToDecode.values());
            setImportDecodedTracks(decodeList.map(t => ({ id: t.id, name: t.participant, status: 'pending' })));

            const computedNormMetrics: Record<string, NormalizationMetrics> = {};
            let dIdx = 0;
            for (const item of decodeList) {
              dIdx++;
              const curPct = Math.round(30 + (65 * dIdx / Math.max(1, decodeList.length)));
              updateProcess('Восстановление тайминга', `Декодирование аудиоволн [${dIdx}/${decodeList.length}]: «${item.participant}» (${curPct}%)...`, curPct, dIdx, decodeList.length);

              setImportDecodedTracks(prev => prev.map(p => p.id === item.id ? { ...p, status: 'decoding' } : p));
              const playableUrl = await getPlayableAudioUrl(item.filePath);
              if (playableUrl) {
                const audio = new Audio(playableUrl);
                audio.preload = 'metadata';
                audioElementsRef.current[item.id] = audio;

                try {
                  const resp = await fetch(playableUrl);
                  const arrayBuf = await resp.arrayBuffer();
                  const fileByteLength = arrayBuf.byteLength || 0;
                  trackFileSizesRef.current[item.id] = fileByteLength;

                  if (sharedAudioCtx) {
                    const decodedBuf = await sharedAudioCtx.decodeAudioData(arrayBuf);
                    audioBuffersRef.current[item.id] = decodedBuf;

                    if (item.isFix) {
                      const actorNorm = normalizeName(item.dubberName || item.participant || 'Даббер');
                      if (!fixBuffersByActorRef.current[actorNorm]) fixBuffersByActorRef.current[actorNorm] = [];
                      const existingIdx = fixBuffersByActorRef.current[actorNorm].findIndex(f => f.sourceTrackId === item.id);
                      const fEntry = { buffer: decodedBuf, filePath: item.filePath, sourceTrackId: item.id, participant: item.participant };
                      if (existingIdx >= 0) fixBuffersByActorRef.current[actorNorm][existingIdx] = fEntry;
                      else fixBuffersByActorRef.current[actorNorm].push(fEntry);
                    } else {
                      const origKey = `orig_${item.id}`;
                      audioBuffersRef.current[origKey] = decodedBuf;
                      origBuffersByTrackRef.current[item.id] = { buffer: decodedBuf, filePath: item.filePath, sourceTrackId: origKey };
                    }

                    setDuration(prev => Math.max(prev, decodedBuf.duration));
                    const norm = analyzeAudioBufferForPreview(decodedBuf, item.id);
                    computedNormMetrics[item.id] = norm;
                    setImportDecodedTracks(prev => prev.map(p => p.id === item.id ? { ...p, status: 'done', duration: decodedBuf.duration } : p));
                  }
                } catch (decodeErr) {
                  console.warn(`[AudioDecode] Не удалось декодировать ${item.id}:`, decodeErr);
                  setImportDecodedTracks(prev => prev.map(p => p.id === item.id ? { ...p, status: 'error' } : p));
                }
              }
            }

            setNormalizationMetrics(computedNormMetrics);
            isStateRestoredRef.current = true;
            addLog(`✓ Состояние вкладки «Тайминг» успешно восстановлено из файла! Загружено ${restoredTracks.length} дорожек, клипов: ${Object.values(st.audioClips).flat().length}. Повторный автотайминг/нарезка не требуются.`, 'success');
            toast.success(`Тайминг серии успешно загружен из сохраненного файла («Тайминг»)! 💾`);
            return;
          }
        } catch (loadErr: any) {
          console.warn('[TimingState] Ошибка при автозагрузке сохраненного состояния:', loadErr);
        }
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

      allCatalogTracksRef.current = fetchedTracks;
      isStateRestoredRef.current = true;

      // Save initial fresh state to <EpisodeDir>/Тайминг/timing_state.json
      try {
        const freshStatePayload = {
          tracks: fetchedTracks,
          allCatalogTracks: fetchedTracks,
          audioClips: initialClips,
          trackSubLinesMap: trackSubMap,
          isSilenceRemoved: false,
          isFixesStitched: false,
          isTimingAnalyzed: false,
          collisions: [],
          intentionalOverlaps: [],
          timingIssues: [],
          missingSubtitles: [],
          calibrationsByTrack: {},
          volumes: {},
          mutedTracks: [],
          originalVolume: 0.4,
          isOriginalMuted: false,
          zoomLevel: 30,
          trackHeightMode: 'standard',
          timingSettings
        };
        const saveRes: any = await ipcSafe.invoke('timing-save-state', {
          episode: currentEpisode,
          state: freshStatePayload
        });
        if (saveRes?.success) {
          setSavedTimingStateInfo({
            savedAt: saveRes.updatedAt || new Date().toISOString(),
            filePath: saveRes.filePath
          });
          addLog(`💾 Состояние тайминга инициализировано и сохранено в папку «${saveRes.timingDir || 'Тайминг'}» серии.`, 'info');
        }
      } catch (saveErr) {
        console.warn('Initial timing state save warning:', saveErr);
      }

      if (fetchedTracks.length > 0) {
        toast.success(`Загружено ${fetchedTracks.length} дорожек дабберов с реальными аудиоволнами и сохранено в «Тайминг»!`);
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
      updateProcess('Синхронизация с QA', 'Применение меток замечаний и сверка с текущим таймлайном...', 85, 2, 2);
      if (savedProject && (
        (savedProject.collisions && savedProject.collisions.length > 0) ||
        (savedProject.timingIssues && savedProject.timingIssues.length > 0) ||
        (savedProject.missingSubtitles && savedProject.missingSubtitles.length > 0)
      )) {
        savedPassportRef.current = savedProject;

        const markedClips = applyTimingPassportToClips(audioClips, savedProject);
        const allTrackIds = Object.keys(markedClips);
        const isSliced = allTrackIds.some(tId => {
          const list = markedClips[tId] || [];
          return list.length > 1 || (list.length === 1 && !String(list[0].id).endsWith('_full') && list[0].durationSec < 90);
        });

        // Ensure sliced clips have monotonic subtitle bindings so simultaneous subtitles are accurately recognized
        if (isSliced) {
          for (const tr of tracks) {
            if (isFixTrack(tr)) continue;
            const list = markedClips[tr.id] || [];
            if (list.length > 0 && list.some(c => !c.matchedSubId && !c.isPhysics && c.durationSec < 90)) {
              const trSubs = [...(trackSubLinesMap[tr.id] || [])].sort((a, b) => a.startSec - b.startSec);
              markedClips[tr.id] = bindTrackClipsToSubtitlesMonotonically(tr, list, trSubs);
            }
          }
        }

        const findBestSubForClip = (clip: AudioClip): SubtitleLine | undefined => {
          const trSubs = trackSubLinesMap[clip.trackId] || [];
          if (clip.matchedSubId) {
            const byId = trSubs.find(s => String(s.id) === String(clip.matchedSubId)) ||
              subtitles.find(s => String(s.id) === String(clip.matchedSubId));
            if (byId) return byId;
          }
          const cs = clip.clipStartSec + (clip.offsetSec || 0);
          const ce = cs + clip.durationSec;
          const pool = trSubs.length > 0 ? trSubs : subtitles;
          let best: SubtitleLine | undefined;
          let bestDist = Infinity;
          for (const s of pool) {
            const ov = Math.min(ce, s.endSec) - Math.max(cs, s.startSec);
            const dist = Math.abs(cs - s.startSec) - (ov > 0 ? ov * 0.5 : 0);
            if (Math.abs(cs - s.startSec) <= 1.35 && dist < bestDist) {
              bestDist = dist;
              best = s;
            }
          }
          return best;
        };

        const isSimultaneousOrContainedPair = (early: AudioClip, late: AudioClip): boolean => {
          const earlyStart = early.clipStartSec + (early.offsetSec || 0);
          const earlyEnd = earlyStart + early.durationSec;
          const lateStart = late.clipStartSec + (late.offsetSec || 0);
          const lateEnd = lateStart + late.durationSec;
          const ov = earlyEnd - lateStart;
          const minDur = Math.min(early.durationSec, late.durationSec);

          if (early.trackId !== late.trackId) {
            if (early.isIntentionalOverlap || late.isIntentionalOverlap || early.isUnisonPhrase || late.isUnisonPhrase) {
              return true;
            }
            // Contained clip (e.g., short phrase inside a 7-9s yell/reaction) or simultaneous start or large overlap (> 0.48s)
            if (lateStart - earlyStart <= 0.10 || lateEnd <= earlyEnd + 0.18 || ov > 0.48 || ov > minDur * 0.42) {
              return true;
            }
            const subEarly = findBestSubForClip(early);
            const subLate = findBestSubForClip(late);
            if (subEarly && subLate) {
              if (subEarly.id !== undefined && subLate.id !== undefined && String(subEarly.id) === String(subLate.id)) {
                return true;
              }
              // If the two subtitles in .ass overlap at all (even by 0ms touch when speaking together)
              const subOv = Math.min(subEarly.endSec, subLate.endSec) - Math.max(subEarly.startSec, subLate.startSec);
              if (subOv > -0.02) return true;
              // If the second subtitle is scheduled while the first clip still has > 0.45s left
              if (earlyEnd - subLate.startSec > 0.45) return true;
            }
            // Check global subtitles: if two distinct .ass subtitles overlap in this window, two characters are meant to speak simultaneously
            const activeGlobalSubs = subtitles.filter(
              s => s.endSec >= lateStart - 0.05 && s.startSec <= earlyEnd + 0.05
            );
            for (let a = 0; a < activeGlobalSubs.length; a++) {
              for (let b = a + 1; b < activeGlobalSubs.length; b++) {
                const gOv = Math.min(activeGlobalSubs[a].endSec, activeGlobalSubs[b].endSec) -
                  Math.max(activeGlobalSubs[a].startSec, activeGlobalSubs[b].startSec);
                if (gOv >= 0.05) return true;
              }
            }
          }
          return false;
        };

        // Cross-link QA issues to actual sliced clips on the timeline and filter out already-resolved items
        const enrichedIssues: TimingIssue[] = [];
        const activeCollisions: VoiceCollisionMarker[] = [];
        const seenOverlapPairs = new Set<string>();

        for (const rawIssue of (savedProject.timingIssues || [])) {
          if (rawIssue.type === 'overlap') {
            if (!isSliced) {
              enrichedIssues.push({ ...rawIssue });
              continue;
            }
            // Find the two clips that overlap near rawIssue.timeSec
            const issStart = rawIssue.timeSec ?? 0;
            const issEnd = issStart + (rawIssue.durationSec || 1.2);
            let foundEarly: AudioClip | null = null;
            let foundLate: AudioClip | null = null;

            for (let i = 0; i < allTrackIds.length; i++) {
              for (const c1 of (markedClips[allTrackIds[i]] || [])) {
                if (c1.isPhysics || c1.durationSec >= 90) continue;
                const s1 = c1.clipStartSec + (c1.offsetSec || 0);
                const e1 = s1 + c1.durationSec;
                if (e1 < issStart - 0.8 || s1 > issEnd + 0.8) continue;

                for (let j = i; j < allTrackIds.length; j++) {
                  for (const c2 of (markedClips[allTrackIds[j]] || [])) {
                    if (c1.id === c2.id || c2.isPhysics || c2.durationSec >= 90) continue;
                    const s2 = c2.clipStartSec + (c2.offsetSec || 0);
                    const e2 = s2 + c2.durationSec;
                    const ov = Math.min(e1, e2) - Math.max(s1, s2);
                    if (ov > 0.015) {
                      const [early, late] = s1 <= s2 ? [c1, c2] : [c2, c1];
                      if (isSimultaneousOrContainedPair(early, late)) {
                        early.hasCollision = false;
                        late.hasCollision = false;
                        if (early.timingIssue === 'overlap') early.timingIssue = null;
                        if (late.timingIssue === 'overlap') late.timingIssue = null;
                        continue;
                      }
                      foundEarly = early;
                      foundLate = late;
                      break;
                    }
                  }
                  if (foundEarly && foundLate) break;
                }
                if (foundEarly && foundLate) break;
              }
              if (foundEarly && foundLate) break;
            }

            if (foundEarly && foundLate) {
              const pairKey = [foundEarly.id, foundLate.id].sort().join('__');
              if (!seenOverlapPairs.has(pairKey)) {
                seenOverlapPairs.add(pairKey);
                const earlyEnd = foundEarly.clipStartSec + (foundEarly.offsetSec || 0) + foundEarly.durationSec;
                const lateStart = foundLate.clipStartSec + (foundLate.offsetSec || 0);
                const ovDur = Number(Math.max(0.02, earlyEnd - lateStart).toFixed(2));

                foundEarly.hasCollision = true;
                foundLate.hasCollision = true;
                foundEarly.timingIssue = 'overlap';
                foundLate.timingIssue = 'overlap';
                foundEarly.overlappingClipId = foundLate.id;
                foundLate.overlappingClipId = foundEarly.id;

                enrichedIssues.push({
                  ...rawIssue,
                  trackId: foundLate.trackId,
                  dubberName: foundLate.dubberName,
                  characterName: foundLate.characterName,
                  clipId: foundLate.id,
                  overlappingClipId: foundEarly.id,
                  overlappingDubber: foundEarly.dubberName,
                  timeSec: lateStart,
                  durationSec: ovDur,
                  overlapDurationSec: ovDur
                });

                activeCollisions.push({
                  id: `col_sync_${foundEarly.id}_${foundLate.id}`,
                  track1Id: foundEarly.trackId,
                  track2Id: foundLate.trackId,
                  dubber1Name: foundEarly.dubberName,
                  dubber2Name: foundLate.dubberName,
                  character1Name: foundEarly.characterName,
                  character2Name: foundLate.characterName,
                  startSec: lateStart,
                  endSec: earlyEnd,
                  overlapDurationSec: ovDur
                });
              }
            }
          } else if (rawIssue.type === 'missing') {
            if (!isSliced) {
              enrichedIssues.push({ ...rawIssue });
              continue;
            }
            const mStart = rawIssue.timeSec ?? 0;
            const mEnd = mStart + (rawIssue.durationSec || 1.2);
            const mDur = Math.max(0.25, mEnd - mStart);
            // Check if ANY dubber track (this dubber OR another dubber) has a speech clip covering [mStart, mEnd]
            const isVoicedByAnyDubber = allTrackIds.some(tId => {
              const trObj = tracks.find(t => t.id === tId);
              if (trObj && isFixTrack(trObj)) return false;
              return (markedClips[tId] || []).some(c => {
                if (c.isPhysics || c.durationSec >= 90) return false;
                const cs = c.clipStartSec + (c.offsetSec || 0);
                const ce = cs + c.durationSec;
                const ov = Math.min(ce, mEnd + 0.25) - Math.max(cs, mStart - 0.25);
                return ov >= Math.min(0.28, mDur * 0.35);
              });
            });
            if (!isVoicedByAnyDubber) {
              enrichedIssues.push({ ...rawIssue });
            }
          } else {
            enrichedIssues.push({ ...rawIssue });
          }
        }

        // Also scan sliced timeline for any live intra-track or inter-track tail-to-head overlaps not yet in enrichedIssues
        if (isSliced) {
          for (let i = 0; i < allTrackIds.length; i++) {
            const t1 = tracks.find(t => t.id === allTrackIds[i]);
            if (t1 && isFixTrack(t1)) continue;
            const clips1 = markedClips[allTrackIds[i]] || [];

            for (let idx1 = 0; idx1 < clips1.length; idx1++) {
              const c1 = clips1[idx1];
              if (c1.isPhysics || c1.durationSec >= 90) continue;
              const s1 = c1.clipStartSec + (c1.offsetSec || 0);
              const e1 = s1 + c1.durationSec;

              for (let j = i; j < allTrackIds.length; j++) {
                const t2 = tracks.find(t => t.id === allTrackIds[j]);
                if (t2 && isFixTrack(t2)) continue;
                const clips2 = markedClips[allTrackIds[j]] || [];

                for (let idx2 = (i === j ? idx1 + 1 : 0); idx2 < clips2.length; idx2++) {
                  const c2 = clips2[idx2];
                  if (c1.id === c2.id || c2.isPhysics || c2.durationSec >= 90) continue;
                  if (c1.isUnisonPhrase && c2.isUnisonPhrase) continue;
                  const s2 = c2.clipStartSec + (c2.offsetSec || 0);
                  const e2 = s2 + c2.durationSec;
                  const ov = Math.min(e1, e2) - Math.max(s1, s2);

                  if (ov > 0.03) {
                    const [early, late] = s1 <= s2 ? [c1, c2] : [c2, c1];
                    const pairKey = [early.id, late.id].sort().join('__');
                    if (seenOverlapPairs.has(pairKey)) continue;

                    if (isSimultaneousOrContainedPair(early, late)) {
                      early.hasCollision = false;
                      late.hasCollision = false;
                      if (early.timingIssue === 'overlap') early.timingIssue = null;
                      if (late.timingIssue === 'overlap') late.timingIssue = null;
                      continue;
                    }

                    seenOverlapPairs.add(pairKey);
                    const earlyEnd = early.clipStartSec + (early.offsetSec || 0) + early.durationSec;
                    const lateStart = late.clipStartSec + (late.offsetSec || 0);
                    const ovDur = Number(Math.max(0.02, earlyEnd - lateStart).toFixed(2));

                    early.hasCollision = true;
                    late.hasCollision = true;
                    early.timingIssue = 'overlap';
                    late.timingIssue = 'overlap';
                    early.overlappingClipId = late.id;
                    late.overlappingClipId = early.id;

                    enrichedIssues.push({
                      id: `issue_live_ov_${early.id}_${late.id}`,
                      type: 'overlap',
                      trackId: late.trackId,
                      dubberName: late.dubberName,
                      characterName: late.characterName,
                      clipId: late.id,
                      overlappingClipId: early.id,
                      overlappingDubber: early.dubberName,
                      timeSec: lateStart,
                      durationSec: ovDur,
                      overlapDurationSec: ovDur,
                      description: i === j
                        ? `Наезд внутри дорожки «${late.dubberName}» (${ovDur}с): «${early.text.slice(0, 18)}» 💥 «${late.text.slice(0, 18)}»`
                        : `Наезд голосов: «${early.dubberName}» перекрывает «${late.dubberName}» (${ovDur}с) [${formatSeconds(lateStart)}]`
                    });

                    activeCollisions.push({
                      id: `col_live_${early.id}_${late.id}`,
                      track1Id: early.trackId,
                      track2Id: late.trackId,
                      dubber1Name: early.dubberName,
                      dubber2Name: late.dubberName,
                      character1Name: early.characterName,
                      character2Name: late.characterName,
                      startSec: lateStart,
                      endSec: earlyEnd,
                      overlapDurationSec: ovDur
                    });
                  }
                }
              }
            }
          }
        }

        const filteredMissingMarkers = (savedProject.missingSubtitles || []).filter(m => {
          if (!isSliced) return true;
          const mDur = Math.max(0.25, m.endSec - m.startSec);
          return !allTrackIds.some(tId => {
            const trObj = tracks.find(t => t.id === tId);
            if (trObj && isFixTrack(trObj)) return false;
            return (markedClips[tId] || []).some(c => {
              if (c.isPhysics || c.durationSec >= 90) return false;
              const cs = c.clipStartSec + (c.offsetSec || 0);
              const ce = cs + c.durationSec;
              const ov = Math.min(ce, m.endSec + 0.25) - Math.max(cs, m.startSec - 0.25);
              return ov >= Math.min(0.28, mDur * 0.35);
            });
          });
        });

        const finalCollisions = isSliced ? activeCollisions : (savedProject.collisions || []);
        const finalSummary = {
          ...savedProject.summary,
          totalGaps: enrichedIssues.length,
          overlapsCount: enrichedIssues.filter(i => i.type === 'overlap' && !i.overlappingDubber).length,
          collisionsCount: finalCollisions.length,
          desyncCount: enrichedIssues.filter(i => i.type === 'desync').length,
          missingCount: filteredMissingMarkers.length
        };

        setAudioClips(markedClips);
        setCollisions(finalCollisions);
        setTimingIssues(enrichedIssues);
        setMissingSubtitles(filteredMissingMarkers);
        setIsTimingAnalyzed(true);
        setIsIssuesDrawerOpen(enrichedIssues.length > 0);

        setQaPassportLoaded({
          loaded: true,
          summary: finalSummary,
          savedAt: savedProject.savedAt
        });

        addLog(
          `✓ Синхронизация с QA завершена: актуальных замечаний — ${finalSummary.totalGaps} (наездов/коллизий — ${enrichedIssues.filter(i => i.type === 'overlap').length}, рассинхронов — ${finalSummary.desyncCount}, пропусков — ${finalSummary.missingCount}).`,
          'success'
        );
        toast.success(`Синхронизировано с QA! Актуальных замечаний: ${finalSummary.totalGaps}`);
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

  // Reset timing state and restart from scratch
  const handleResetTimingToStart = async () => {
    if (!currentEpisode) return;
    try {
      setIsLoading(true);
      setIsResetConfirmOpen(false);
      setIsPlaying(false);
      stopAllScheduledClips();
      if (videoRef.current) {
        try { videoRef.current.pause(); videoRef.current.currentTime = 0; } catch (e) {}
      }
      setCurrentTime(0);
      currentTimeRef.current = 0;
      updateProcess('Сброс тайминга', 'Очистка сохраненного состояния и удаление файла из папки «Тайминг»...', 20, 1, 2);
      addLog('Запуск сброса состояния тайминга серии...', 'warn');

      await ipcSafe.invoke('timing-reset-state', { episode: currentEpisode });
      isStateRestoredRef.current = false;
      setSavedTimingStateInfo(null);
      setIsSilenceRemoved(false);
      setIsFixesStitched(false);
      setIsTimingAnalyzed(false);
      setCollisions([]);
      setIntentionalOverlaps([]);
      setTimingIssues([]);
      setMissingSubtitles([]);
      setFinalVerificationReport(null);
      setCalibrationsByTrack({});
      setSelectedClipId(null);
      setQaPassportLoaded(null);

      updateProcess('Сброс тайминга', 'Перезагрузка исходных дорожек серии...', 50, 2, 2);
      await loadEpisodeData(false, true);

      toast.success('Тайминг серии успешно сброшен! Загружены исходные дорожки с начала.');
      addLog('✓ Тайминг серии сброшен к исходному состоянию.', 'success');
    } catch (err: any) {
      toast.error(`Ошибка при сбросе: ${err.message || String(err)}`);
      addLog(`❌ Ошибка сброса тайминга: ${err.message || String(err)}`, 'error');
    } finally {
      setIsLoading(false);
      clearProcess();
    }
  };

  // Debounced auto-save of Timing tab state to <EpisodeDir>/Тайминг/timing_state.json
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isStateRestoredRef.current || isLoading || !currentEpisode || tracks.length === 0) {
      return;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const statePayload = {
          tracks,
          allCatalogTracks: allCatalogTracksRef.current.length > 0 ? allCatalogTracksRef.current : tracks,
          audioClips,
          trackSubLinesMap,
          isSilenceRemoved,
          isFixesStitched,
          isTimingAnalyzed,
          collisions,
          intentionalOverlaps,
          timingIssues,
          missingSubtitles,
          qaPassportLoaded,
          finalVerificationReport,
          calibrationsByTrack,
          volumes,
          mutedTracks: Array.from(mutedTracks),
          originalVolume,
          isOriginalMuted,
          zoomLevel,
          trackHeightMode,
          timingSettings
        };

        const res: any = await ipcSafe.invoke('timing-save-state', {
          episode: currentEpisode,
          state: statePayload
        });

        if (res && res.success) {
          setSavedTimingStateInfo({
            savedAt: res.updatedAt || new Date().toISOString(),
            filePath: res.filePath
          });
        }
      } catch (err) {
        console.warn('[TimingAutoSave] Error saving state:', err);
      }
    }, 600);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [
    currentEpisode?.id,
    tracks,
    audioClips,
    trackSubLinesMap,
    isSilenceRemoved,
    isFixesStitched,
    isTimingAnalyzed,
    collisions,
    intentionalOverlaps,
    timingIssues,
    missingSubtitles,
    qaPassportLoaded,
    finalVerificationReport,
    calibrationsByTrack,
    volumes,
    mutedTracks,
    originalVolume,
    isOriginalMuted,
    zoomLevel,
    trackHeightMode,
    timingSettings,
    isLoading
  ]);

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

          addLog(`🎙 Дорожка «${dubberName}»: обнаружено ${intervals.length} полезных речевых фраз (вырезана только тишина, позиции фраз не сдвинуты).`, 'info');

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
            const onsetSec = detectSpeechOnsetOffsetSec(audioBuf, iv.startSec, iv.endSec);

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
              speechOnsetOffsetSec: onsetSec,
              sourceAudioPath: track.filePath,
              text: matchingSub?.text || `Фраза ${idx + 1}`,
              matchedSubId: matchingSub ? String(matchingSub.id) : undefined,
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

      updateProcess('3. Удаление тишины и калибровка', `Сформировано ${totalClips} фраз (без сдвига позиций)`, 100, tracks.length, tracks.length);
      setCalibrationsByTrack(newCalibrations);
      setAudioClips(updatedClips);
      setIsSilenceRemoved(true);
      addLog(`✓ Удаление тишины со всех дорожек завершено! Сформировано ${totalClips} фраз. Все фразы стоят строго на своих исходных местах (0 мс сдвига).`, 'success');
      toast.success(`Тишина удалена! Сформировано ${totalClips} фраз (все реплики строго на своих исходных местах).`);
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
                  speechOnsetOffsetSec: detectSpeechOnsetOffsetSec(mBuf, iv.startSec, iv.endSec),
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
                speechOnsetOffsetSec: detectSpeechOnsetOffsetSec(fixBuf, iv.startSec, iv.endSec),
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

          const mainDialogueClipCount = Math.max(1, targetClips.filter(c => !c.isPhysics).length);
          const isFullReplacement =
            (fixClips.length >= Math.max(2, Math.floor(mainDialogueClipCount * 0.72)) &&
             fixActiveSpeechSec >= mainActiveSpeechSec * 0.70 &&
             (voicedInMainSubs === 0 || voicedOnlyInMainSubs <= Math.max(2, Math.floor(voicedInMainSubs * 0.15)))) ||
            (mainSubs.length > 0 &&
             voicedInMainSubs > 0 &&
             voicedInFixSubs >= Math.ceil(voicedInMainSubs * 0.80) &&
             voicedOnlyInMainSubs <= 2 &&
             fixActiveSpeechSec >= mainActiveSpeechSec * 0.65);

          if (isFullReplacement) {
            // SCENARIO 1: Full Track Replacement — replace the entire track cleanly without splicing into the old track
            addLog(
              `⚡ Сценарий 1 (Полная замена дорожки) для «${actorNick}»: фикс содержит ${fixClips.length} фраз (${fixActiveSpeechSec.toFixed(1)}с речи vs ${mainActiveSpeechSec.toFixed(1)}с). Основная дорожка «${bestMainTrackForFull.participant}» полностью заменена на дорожку фикса без сдвигов!`,
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
            // SCENARIO 2: Targeted Fix Splicing
            // - For timecode-aligned fix tracks (!isShortFixFile): insert at exact fixClip.clipStartSec WITHOUT shifting to subtitle start!
            // - For short standalone fix files starting near 00:00 (isShortFixFile): match via Whisper / comment timestamps.
            let fixAppliedOnTrack = 0;
            const mainBuf = audioBuffersRef.current[bestMainTrackForFull.id];
            const mainDur = mainBuf ? mainBuf.duration : duration;

            const maxFixEndSec = Math.max(...fixClips.map(c => c.clipStartSec + c.durationSec));
            const isShortFixFile =
              fixDuration < mainDur * 0.45 &&
              maxFixEndSec < 45 &&
              mainSubs.some(s => s.startSec > 45);

            const fixWhisperMap: Record<string, string> = {};
            const needsWhisperClips = fixClips.filter(fc => {
              if (isShortFixFile) return true;
              const hasTimecodeSub = mainSubs.some(s => Math.abs(s.startSec - fc.clipStartSec) <= 3.0);
              const hasTimecodeClip = targetClips.some(mc => Math.abs(mc.clipStartSec - fc.clipStartSec) <= 3.0);
              return !hasTimecodeSub && !hasTimecodeClip;
            });

            if (needsWhisperClips.length > 0 && fixTrack.filePath) {
              try {
                addLog(`🎙 Whisper: распознавание ${needsWhisperClips.length} фраз точечного фикса «${actorNick}»...`, 'info');
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

            const usedTargetSubIds = new Set<string>();

            for (let fIdx = 0; fIdx < fixClips.length; fIdx++) {
              const fixClip = fixClips[fIdx];
              const recognizedFixText = fixWhisperMap[fixClip.id] || fixClip.recognizedText || '';

              let targetTrackId = bestMainTrackForFull.id;
              let matchedSub: SubtitleLine | undefined;
              let targetInsertSec = fixClip.clipStartSec;

              if (!isShortFixFile) {
                // Timecode-anchored fix track: find which main track/subtitle corresponds to this timecode,
                // but KEEP targetInsertSec = fixClip.clipStartSec so the fix stays at the exact timecode recorded by the dubber!
                let bestSubDist = Infinity;
                for (const mTrk of mainTracks) {
                  const mSubs = trackSubLinesMap[mTrk.id] || [];
                  for (const s of mSubs) {
                    const dist = Math.abs(s.startSec - fixClip.clipStartSec);
                    if (dist <= 2.5 && dist < bestSubDist) {
                      bestSubDist = dist;
                      matchedSub = s;
                      targetTrackId = mTrk.id;
                    }
                  }
                }
                targetInsertSec = fixClip.clipStartSec;
                if (matchedSub) {
                  usedTargetSubIds.add(String(matchedSub.id));
                }
              } else {
                // Short standalone fix file starting at 00:00
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

              // Only excise old clips that directly overlap the fix replacement window [replaceStart, replaceEnd]
              const replaceStart = targetInsertSec - 0.08;
              const replaceEnd = targetInsertSec + fixClip.durationSec + 0.08;

              const excisedClips: AudioClip[] = [];
              const survivingClips: AudioClip[] = [];

              for (const mc of mClips) {
                if (mc.isPhysics || mc.isFix) {
                  survivingClips.push(mc);
                  continue;
                }
                const mcStart = mc.clipStartSec + (mc.offsetSec || 0);
                const mcEnd = mcStart + mc.durationSec;
                const overlapSec = Math.min(mcEnd, replaceEnd) - Math.max(mcStart, replaceStart);
                const isDirectTarget =
                  overlapSec >= 0.08 ||
                  (isShortFixFile && matchedSub && Math.abs(mcStart - matchedSub.startSec) <= 1.2);

                if (isDirectTarget) {
                  excisedClips.push(mc);
                } else {
                  survivingClips.push(mc);
                }
              }

              // Fallback for short 00:00 fix files: if no clip overlapped directly, replace closest old clip within 1.4s
              if (excisedClips.length === 0 && isShortFixFile) {
                let closestIdx = -1;
                let closestDist = 1.4;
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

              const basePlacementStart = isShortFixFile && excisedClips.length > 0
                ? excisedClips[0].clipStartSec
                : targetInsertSec;

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
                speechOnsetOffsetSec: fixClip.speechOnsetOffsetSec ?? detectSpeechOnsetOffsetSec(fixBuf, fixClip.sourceStartSec, fixClip.sourceEndSec),
                isFix: true,
                isPhysics: false,
                text: matchedSub?.text || excisedClips[0]?.text || fixClip.text,
                matchedSubId: matchedSub ? String(matchedSub.id) : excisedClips[0]?.matchedSubId,
                recognizedText: recognizedFixText || fixClip.recognizedText,
                offsetSec: 0
              };

              survivingClips.push(splicedClip);
              survivingClips.sort((a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0)));

              updatedClips[targetMainTrack.id] = survivingClips;
              appliedCount++;
              fixAppliedOnTrack++;
              addLog(
                `⚡ Вшит точечный фикс «${splicedClip.text.slice(0, 32)}» на ${formatSeconds(splicedClip.clipStartSec)} (${splicedClip.durationSec.toFixed(2)}с, заменено старых фраз: ${excisedClips.length}) в «${targetMainTrack.participant}».`,
                'info'
              );
            }

            delete updatedClips[fixTrack.id];
            addLog(`⚡ Вшито ${fixAppliedOnTrack} точечных фраз фикса для даббера «${actorNick}» строго по таймкодам.`, 'success');
          }
        }
      }

      setTracks(prev =>
        prev
          .filter(t => !isFixTrack(t))
          .map(t => {
            const firstFixClip = (updatedClips[t.id] || []).find(c => c.isFix && c.sourceAudioPath && c.id.includes('_fullfix_'));
            if (firstFixClip && firstFixClip.sourceAudioPath) {
              return { ...t, filePath: firstFixClip.sourceAudioPath };
            }
            return t;
          })
      );
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
      // 2) Split-phrase continuation protection (K clips -> 1 subtitle when a phrase has an internal pause, so the 2nd part is NEVER pulled to a skipped next subtitle)
      // 3) Cross-dubber voicing check (if a subtitle is skipped by this dubber but voiced by another dubber, it is NOT missing)
      // 4) "Физика" (sighs, gasps, grunts, laughs outside subtitles) detection & protection
      let crossDubberCoveredCount = 0;

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
        const clipIsSplitContinuation = new Array<boolean>(clips.length).fill(false);
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

        // Sub-Pass 2A: Lock primary dialogue clips within a tight physiological window [-0.70s, +1.35s] of subtitle start
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
            const signedDiff = cStart - sub.startSec;
            const absDiff = Math.abs(signedDiff);

            // Prevent a clip that sits inside the previous subtitle from being matched as an early start of `sub`
            if (sIdx > 0) {
              const prevSub = trSubs[sIdx - 1];
              if (cStart >= prevSub.startSec - 0.15 && cStart <= prevSub.endSec + 0.25 && sub.startSec - cStart > 0.55) {
                continue;
              }
            }

            if (signedDiff >= -0.70 && signedDiff <= 1.35 && isWithinTrackCorridor(cIdx, sub.startSec)) {
              const subDur = Math.max(0.25, sub.endSec - sub.startSec);
              const durRatio = Math.min(clip.durationSec, subDur) / Math.max(clip.durationSec, subDur);
              const shortBreathPenalty = (clip.durationSec < 0.24 && speechStats.activeWindows < 8 && subDur > 0.9) ? 1.4 : 0;
              const score = absDiff - durRatio * 0.35 + shortBreathPenalty;
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

        // Sub-Pass 2A.2: Absorb Split-Phrase Continuation Clips (2nd/3rd part of a phrase divided by an internal pause)
        // Crucial protection: if a phrase for subtitle `sub` was split into 2 clips, the 2nd clip belongs to `sub`
        // and MUST NEVER be mistaken for an unvoiced next subtitle `nextSub`!
        for (let cIdx = 0; cIdx < clips.length; cIdx++) {
          const sIdx = clipMatchedSubIdx[cIdx];
          if (sIdx === -1 || clipIsSplitContinuation[cIdx]) continue;
          const covered = clipCoveredSubIndices[cIdx];
          const lastCoveredSIdx = covered.length > 0 ? covered[covered.length - 1] : sIdx;
          const sub = trSubs[lastCoveredSIdx];
          const nextSub = lastCoveredSIdx + 1 < trSubs.length ? trSubs[lastCoveredSIdx + 1] : null;

          let scanIdx = cIdx + 1;
          while (scanIdx < clips.length && clipMatchedSubIdx[scanIdx] === -1) {
            const prevPart = clips[scanIdx - 1];
            const prevPartEnd = prevPart.clipStartSec + (prevPart.offsetSec || 0) + prevPart.durationSec;
            const partClip = clips[scanIdx];
            if (partClip.isPhysics) break;
            const partStart = partClip.clipStartSec + (partClip.offsetSec || 0);
            const partEnd = partStart + partClip.durationSec;
            const pauseGap = partStart - prevPartEnd;

            const fitsInsideCurrentSub =
              pauseGap >= -0.05 &&
              pauseGap <= 1.25 &&
              (partStart <= sub.endSec + 0.35 || partEnd <= sub.endSec + 0.65);

            const clearlyBeforeNextSub = !nextSub || (
              nextSub.startSec - partStart >= 0.55 &&
              (partStart <= sub.endSec + 0.25 || Math.abs(partStart - sub.endSec) < Math.abs(partStart - nextSub.startSec))
            );

            if (fitsInsideCurrentSub && clearlyBeforeNextSub) {
              clipMatchedSubIdx[scanIdx] = lastCoveredSIdx;
              clipIsSplitContinuation[scanIdx] = true;
              clipCoveredSubIndices[scanIdx] = [lastCoveredSIdx];
              scanIdx++;
            } else {
              break;
            }
          }
        }

        // Sub-Pass 2B: Subtitle-Anchored Corridor Matching for remaining unassigned subtitles
        // Restricted to [-0.75s, +1.45s] so a skipped subtitle NEVER pulls an earlier phrase forward across the timeline!
        for (let sIdx = 0; sIdx < trSubs.length; sIdx++) {
          if (assignedSubIndices.has(sIdx)) continue;
          const sub = trSubs[sIdx];
          const prevSub = sIdx > 0 ? trSubs[sIdx - 1] : null;

          let bestCIdx = -1;
          let bestCandidateScore = -Infinity;

          for (let cIdx = 0; cIdx < clips.length; cIdx++) {
            if (clipMatchedSubIdx[cIdx] !== -1 || clipIsSplitContinuation[cIdx]) continue;
            const clip = clips[cIdx];
            if (clip.isPhysics) continue;
            if (!isMonotonicCompatible(cIdx, sIdx)) continue;

            const cStart = clip.clipStartSec + (clip.offsetSec || 0);
            const signedDiff = cStart - sub.startSec;
            const timeDist = Math.abs(signedDiff);

            // Never pull a clip that starts > 0.75s before `sub.startSec` or sits inside `prevSub`
            if (signedDiff < -0.75 || signedDiff > 1.45 || !isWithinTrackCorridor(cIdx, sub.startSec)) continue;
            if (prevSub && cStart <= prevSub.endSec + 0.25 && sub.startSec - cStart > 0.55) continue;

            const subDur = Math.max(0.25, sub.endSec - sub.startSec);
            const durFit = Math.min(clip.durationSec, subDur) / Math.max(clip.durationSec, subDur);
            const speechStats = measureClipActiveSpeechStats(
              audioBuffersRef.current[clip.sourceAudioTrackId || track.id] || trackBuf,
              clip.sourceStartSec,
              clip.sourceEndSec
            );

            const recWords = normalizeSpeechText(clip.recognizedText || '');
            const hasAnyWhisperWords = recWords.length >= 2;
            const textSim = clip.recognizedText ? calculateTextSimilarity(clip.recognizedText, sub.text) : 0;

            const candidateScore =
              (2.5 - timeDist) * 2.0 +
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
              clipMatchedByWhisper[bestCIdx] = Math.abs((clips[bestCIdx].clipStartSec + (clips[bestCIdx].offsetSec || 0)) - sub.startSec) > 1.2;
              clipWhisperScore[bestCIdx] = Math.max(60, Math.round(sim * 100));
            }
            expandMultiSubCoverage(bestCIdx, sIdx);
          }
        }

        const mappedClips: AudioClip[] = [];

        for (let cIdx = 0; cIdx < clips.length; cIdx++) {
          const clip = { ...clips[cIdx] };
          const cStart = clip.clipStartSec + (clip.offsetSec || 0);
          const bestSubIdx = clipMatchedSubIdx[cIdx];
          const bestSub = bestSubIdx !== -1 ? trSubs[bestSubIdx] : null;
          const isContinuation = clipIsSplitContinuation[cIdx];
          const matchedByWhisper = clipMatchedByWhisper[cIdx];

          const prevClipEnd = cIdx > 0
            ? (mappedClips[cIdx - 1].clipStartSec + (mappedClips[cIdx - 1].offsetSec || 0) + mappedClips[cIdx - 1].durationSec + 0.04)
            : 0;
          const nextClipStart = cIdx + 1 < clips.length
            ? (clips[cIdx + 1].clipStartSec + (clips[cIdx + 1].offsetSec || 0) - 0.04)
            : Infinity;

          if (bestSub && bestSubIdx !== -1) {
            if (isContinuation) {
              // 2nd/3rd part of a split phrase: lock in place on its recorded timestamp!
              clip.isPhysics = false;
              clip.isSplitContinuation = true;
              clip.text = `${bestSub.text} (ч. 2)`;
              clip.matchedSubId = String(bestSub.id ?? bestSubIdx);
              clip.coveredSubIds = [String(bestSub.id ?? bestSubIdx)];
              clip.targetSubStartSec = Number(cStart.toFixed(3));
              clip.targetSubEndSec = bestSub.endSec;
              clip.timeDiffSec = 0;
              clip.timingIssue = null;
              clip.timingIssueText = undefined;
            } else {
              const coveredIdxs = clipCoveredSubIndices[cIdx].length > 0 ? clipCoveredSubIndices[cIdx] : [bestSubIdx];
              const coveredSubs = coveredIdxs.map(idx => trSubs[idx]).filter(Boolean);
              const firstSub = coveredSubs[0] || bestSub;
              const lastSub = coveredSubs[coveredSubs.length - 1] || bestSub;

              const maxShift = 1.6;
              let surgicalTarget = Math.max(cStart - maxShift, Math.min(cStart + maxShift, firstSub.startSec));
              surgicalTarget = Math.max(prevClipEnd, Math.min(surgicalTarget, Math.max(prevClipEnd, nextClipStart - clip.durationSec)));
              surgicalTarget = Number(Math.max(0, surgicalTarget).toFixed(3));

              const rawTimeDiff = cStart - firstSub.startSec;
              const absRawDiff = Math.abs(rawTimeDiff);
              const effectiveShift = Math.abs(surgicalTarget - cStart);

              clip.isPhysics = false;
              clip.isSplitContinuation = false;
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
              } else if (absRawDiff >= 0.30 && absRawDiff <= 1.8 && effectiveShift >= 0.10) {
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

        // 3. Problem: Missing Subtitle Lines (checking both this dubber AND cross-dubber voicing across all other tracks!)
        for (let sIdx = 0; sIdx < trSubs.length; sIdx++) {
          if (!assignedSubIndices.has(sIdx)) {
            const sub = trSubs[sIdx];
            const subIdStr = String(sub.id ?? sIdx);
            const subDur = Math.max(0.25, sub.endSec - sub.startSec);
            const hasAudioCover = mappedClips.some(c => {
              if (c.coveredSubIds?.includes(subIdStr) || c.matchedSubId === subIdStr) return true;
              if (c.isPhysics) return false;
              const cStart = c.clipStartSec + (c.offsetSec || 0);
              const cEnd = cStart + c.durationSec;
              const ov = Math.min(cEnd, sub.endSec + 0.25) - Math.max(cStart, sub.startSec - 0.25);
              return ov >= Math.min(0.28, subDur * 0.35);
            });

            // Cross-dubber check: if another dubber voiced this subtitle window, it is NOT a missing phrase!
            const voicedByOtherDubber = !hasAudioCover && tracks.some(otherTr => {
              if (otherTr.id === track.id || isFixTrack(otherTr)) return false;
              const otherList = updatedClips[otherTr.id] || currentClips[otherTr.id] || [];
              return otherList.some(oc => {
                if (oc.isPhysics || oc.durationSec >= 90) return false;
                const oStart = oc.clipStartSec + (oc.offsetSec || 0);
                const oEnd = oStart + oc.durationSec;
                const ov = Math.min(oEnd, sub.endSec + 0.25) - Math.max(oStart, sub.startSec - 0.25);
                return ov >= Math.min(0.28, subDur * 0.35);
              });
            });

            if (voicedByOtherDubber) {
              crossDubberCoveredCount++;
            } else if (!hasAudioCover) {
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

          if (c1End > c2Start + 0.03) {
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
      // - Simultaneous overlapping subtitles (>= 0.45s): stamp overlapGroupId & Main (0 dB) / Secondary (-10 dB) role
      // - Sequential tail overlaps (< 0.45s sub overlap): flag as collision ('overlap') so "Исправить" separates them cleanly
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

              if (overlapDur > 0.04) {
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

                // Classify as intentional simultaneous scene whenever:
                // 1) The two clips' subtitles overlap in .ass (> -0.02s), OR
                // 2) Global .ass subtitles have two overlapping lines at this moment, OR
                // 3) One clip is contained inside the other (e.g. a short line inside a 7-9s reaction) or overlap > 0.48s
                let isSpecifiedInSubtitles = false;
                const [earlyC, lateC] = c1Start <= c2Start ? [c1, c2] : [c2, c1];
                const earlyS = Math.min(c1Start, c2Start);
                const earlyE = c1Start <= c2Start ? c1End : c2End;
                const lateS = Math.max(c1Start, c2Start);
                const lateE = c1Start <= c2Start ? c2End : c1End;
                const minClipDur = Math.min(c1.durationSec, c2.durationSec);

                if (sub1 && sub2) {
                  const subOverlapStart = Math.max(sub1.startSec, sub2.startSec);
                  const subOverlapEnd = Math.min(sub1.endSec, sub2.endSec);
                  if (subOverlapEnd - subOverlapStart > -0.02) {
                    isSpecifiedInSubtitles = true;
                  }
                }
                if (!isSpecifiedInSubtitles) {
                  const activeGlobal = subtitles.filter(
                    s => s.endSec >= overlapStart - 0.05 && s.startSec <= overlapEnd + 0.05
                  );
                  for (let a = 0; a < activeGlobal.length; a++) {
                    for (let b = a + 1; b < activeGlobal.length; b++) {
                      const gOv = Math.min(activeGlobal[a].endSec, activeGlobal[b].endSec) -
                        Math.max(activeGlobal[a].startSec, activeGlobal[b].startSec);
                      if (gOv >= 0.05) {
                        isSpecifiedInSubtitles = true;
                        break;
                      }
                    }
                    if (isSpecifiedInSubtitles) break;
                  }
                }
                if (
                  !isSpecifiedInSubtitles &&
                  (lateS - earlyS <= 0.10 ||
                    lateE <= earlyE + 0.18 ||
                    overlapDur > 0.48 ||
                    overlapDur > minClipDur * 0.42)
                ) {
                  isSpecifiedInSubtitles = true;
                }

                if (isSpecifiedInSubtitles && (sub1 || sub2 || earlyC)) {
                  const effSub1 = sub1 || ({ id: earlyC.id, startSec: earlyS, endSec: earlyE, text: earlyC.text } as unknown as SubtitleLine);
                  const effSub2 = sub2 || ({ id: lateC.id, startSec: lateS, endSec: lateE, text: lateC.text } as unknown as SubtitleLine);
                  const subOvStart = Number(Math.min(effSub1.startSec, effSub2.startSec).toFixed(2));
                  const subOvEnd = Number(Math.max(effSub1.endSec, effSub2.endSec).toFixed(2));
                  const ovStart = Number(overlapStart.toFixed(2));
                  const ovEnd = Number(overlapEnd.toFixed(2));

                  let matchedGroup: IntentionalOverlapMoment | undefined;
                  for (const grp of detectedIntentionalOverlapsMap.values()) {
                    if (Math.min(grp.endSec, Math.max(c1End, c2End)) > Math.max(grp.startSec, Math.min(c1Start, c2Start)) - 0.25) {
                      matchedGroup = grp;
                      break;
                    }
                  }

                  c1.isIntentionalOverlap = true;
                  c2.isIntentionalOverlap = true;
                  c1.hasCollision = false;
                  c2.hasCollision = false;

                  const entry1: IntentionalOverlapTrackEntry = {
                    trackId: trackIds[i],
                    dubberNick: c1.dubberName,
                    characterName: c1.characterName,
                    phraseId: c1.id,
                    subId: String(effSub1.id ?? ''),
                    text: effSub1.text || c1.text,
                    phraseStartSec: Number(c1Start.toFixed(2)),
                    phraseEndSec: Number(c1End.toFixed(2))
                  };
                  const entry2: IntentionalOverlapTrackEntry = {
                    trackId: trackIds[j],
                    dubberNick: c2.dubberName,
                    characterName: c2.characterName,
                    phraseId: c2.id,
                    subId: String(effSub2.id ?? ''),
                    text: effSub2.text || c2.text,
                    phraseStartSec: Number(c2Start.toFixed(2)),
                    phraseEndSec: Number(c2End.toFixed(2))
                  };
                  if (!matchedGroup) {
                    const groupId = `sub_overlap_${Math.round(subOvStart * 10)}_${effSub1.id ?? i}_${effSub2.id ?? j}`;
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
                  const [earlyClip, lateClip] = c1Start <= c2Start ? [c1, c2] : [c2, c1];
                  c1.hasCollision = true;
                  c2.hasCollision = true;
                  c1.overlappingClipId = c2.id;
                  c2.overlappingClipId = c1.id;
                  if (!c1.timingIssue) c1.timingIssue = 'overlap';
                  if (!c2.timingIssue) c2.timingIssue = 'overlap';

                  newCollisions.push({
                    id: `col_${earlyClip.id}_${lateClip.id}`,
                    track1Id: earlyClip.trackId,
                    track2Id: lateClip.trackId,
                    dubber1Name: earlyClip.dubberName,
                    dubber2Name: lateClip.dubberName,
                    character1Name: earlyClip.characterName,
                    character2Name: lateClip.characterName,
                    startSec: overlapStart,
                    endSec: overlapEnd,
                    overlapDurationSec: Number(overlapDur.toFixed(2))
                  });

                  newIssues.push({
                    id: `issue_overlap_inter_${earlyClip.id}_${lateClip.id}`,
                    type: 'overlap',
                    trackId: lateClip.trackId,
                    dubberName: lateClip.dubberName,
                    characterName: lateClip.characterName,
                    clipId: lateClip.id,
                    timeSec: overlapStart,
                    durationSec: overlapDur,
                    overlapDurationSec: Number(overlapDur.toFixed(2)),
                    overlappingClipId: earlyClip.id,
                    overlappingDubber: earlyClip.dubberName,
                    description: `Наезд голосов: «${earlyClip.dubberName}» и «${lateClip.dubberName}» (${overlapDur.toFixed(2)}с) [${formatSeconds(overlapStart)}]`
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
      if (crossDubberCoveredCount > 0) {
        addLog(`🤝 Перекрёстная озвучка: ${crossDubberCoveredCount} сабов озвучены другими дабберами серии — исключены из пропусков.`, 'success');
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
  // MONOTONIC SUBTITLE-TO-CLIP BINDING HELPER
  // Ensures clips have accurate 1-to-1 (or 1-to-K continuous breath) subtitle locks,
  // speechOnsetOffsetSec, and isPhysics protection even when "Автотайминг" is clicked directly
  // without running "1. Анализ проблем" first.
  // ---------------------------------------------------------------------------
  const bindTrackClipsToSubtitlesMonotonically = useCallback((
    track: Track,
    rawClips: AudioClip[],
    trSubs: SubtitleLine[]
  ): AudioClip[] => {
    const characterName = track.character || track.characterName || 'Персонаж';
    const trackBuf = audioBuffersRef.current[track.id];

    const clips = [...rawClips]
      .map(c => ({ ...c }))
      .sort((a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0)));

    if (trSubs.length === 0 || clips.length === 0) return clips;

    // Ensure every clip has speechOnsetOffsetSec computed
    for (let i = 0; i < clips.length; i++) {
      if (clips[i].speechOnsetOffsetSec === undefined) {
        const srcBuf = audioBuffersRef.current[clips[i].sourceAudioTrackId || track.id] || trackBuf;
        clips[i].speechOnsetOffsetSec = detectSpeechOnsetOffsetSec(srcBuf, clips[i].sourceStartSec, clips[i].sourceEndSec);
      }
    }

    const assignedSubIndices = new Set<number>();
    const clipMatchedSubIdx = new Array<number>(clips.length).fill(-1);
    const clipIsSplitContinuation = new Array<boolean>(clips.length).fill(false);
    const clipCoveredSubIndices: number[][] = Array.from({ length: clips.length }, () => []);

    const isWithinTrackCorridor = (cIdx: number, targetStartSec: number): boolean => {
      const clip = clips[cIdx];
      const prevEnd = cIdx > 0
        ? (clips[cIdx - 1].clipStartSec + (clips[cIdx - 1].offsetSec || 0) + clips[cIdx - 1].durationSec + 0.02)
        : 0;
      const nextStart = cIdx + 1 < clips.length
        ? (clips[cIdx + 1].clipStartSec + (clips[cIdx + 1].offsetSec || 0) - 0.02)
        : Infinity;
      return targetStartSec >= prevEnd - 0.30 && (targetStartSec + Math.min(clip.durationSec, 1.0)) <= nextStart + 0.30;
    };

    const isMonotonicCompatible = (cIdx: number, sIdx: number): boolean => {
      for (let i = 0; i < cIdx; i++) {
        if (clipMatchedSubIdx[i] !== -1 && clipMatchedSubIdx[i] >= sIdx) return false;
      }
      for (let i = cIdx + 1; i < clips.length; i++) {
        if (clipMatchedSubIdx[i] !== -1 && clipMatchedSubIdx[i] <= sIdx) return false;
      }
      return true;
    };

    const expandMultiSubCoverage = (cIdx: number, primarySIdx: number) => {
      const clip = clips[cIdx];
      const cStart = clip.clipStartSec + (clip.offsetSec || 0);
      const primarySub = trSubs[primarySIdx];
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
        if (nxtSub.startSec - prevSub.endSec > 1.25) break;
        if (Math.abs(nextClipStart - nxtSub.startSec) <= 0.85) break;

        const nxtSubDur = Math.max(0.25, nxtSub.endSec - nxtSub.startSec);
        const overlapIntoNextSub = effectiveEnd - nxtSub.startSec;
        if (overlapIntoNextSub >= Math.min(0.40, nxtSubDur * 0.38)) {
          assignedSubIndices.add(nxtSIdx);
          clipCoveredSubIndices[cIdx].push(nxtSIdx);
          curSIdx = nxtSIdx;
        } else {
          break;
        }
      }
    };

    // Pass A.1: Tight asymmetric primary matching ([-0.70s, +1.35s] from subtitle start)
    // Prevents a subsequent skipped subtitle from stealing the 2nd part of an earlier split phrase!
    const candidatePairs: Array<{ cIdx: number; sIdx: number; score: number }> = [];
    for (let cIdx = 0; cIdx < clips.length; cIdx++) {
      const clip = clips[cIdx];
      const cStart = clip.clipStartSec + (clip.offsetSec || 0);
      const speechStats = measureClipActiveSpeechStats(
        audioBuffersRef.current[clip.sourceAudioTrackId || track.id] || trackBuf,
        clip.sourceStartSec,
        clip.sourceEndSec
      );
      for (let sIdx = 0; sIdx < trSubs.length; sIdx++) {
        const sub = trSubs[sIdx];
        const signedDiff = cStart - sub.startSec;
        const diff = Math.abs(signedDiff);
        if (signedDiff >= -0.70 && signedDiff <= 1.35 && isWithinTrackCorridor(cIdx, sub.startSec)) {
          const subDur = Math.max(0.25, sub.endSec - sub.startSec);
          const durRatio = Math.min(clip.durationSec, subDur) / Math.max(clip.durationSec, subDur);
          const shortBreathPenalty = (clip.durationSec < 0.22 && speechStats.activeWindows < 7 && subDur > 0.85) ? 1.5 : 0;
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

    // Pass A.2: Absorb split-phrase continuations (2nd/3rd parts of a phrase split by an internal pause)
    // If clip[cIdx] is unmatched and sits inside or right after the previous clip's subtitle window,
    // lock it as a continuation of that previous subtitle so a skipped next subtitle NEVER pulls it forward!
    for (let cIdx = 1; cIdx < clips.length; cIdx++) {
      if (clipMatchedSubIdx[cIdx] !== -1) continue;
      const prevSubIdx = clipMatchedSubIdx[cIdx - 1];
      if (prevSubIdx === -1) continue;

      const prevClip = clips[cIdx - 1];
      const curClip = clips[cIdx];
      const prevEnd = prevClip.clipStartSec + (prevClip.offsetSec || 0) + prevClip.durationSec;
      const curStart = curClip.clipStartSec + (curClip.offsetSec || 0);
      const gapFromPrevClip = curStart - prevEnd;

      const coveredByPrev = clipCoveredSubIndices[cIdx - 1].length > 0
        ? clipCoveredSubIndices[cIdx - 1]
        : [prevSubIdx];
      const lastCoveredSubIdx = coveredByPrev[coveredByPrev.length - 1];
      const prevSub = trSubs[lastCoveredSubIdx] || trSubs[prevSubIdx];
      const nextUnassignedSub = lastCoveredSubIdx + 1 < trSubs.length ? trSubs[lastCoveredSubIdx + 1] : null;

      const isInsideOrNearPrevSub =
        curStart <= prevSub.endSec + 0.95 ||
        (gapFromPrevClip <= 1.35 && (prevClip.durationSec + gapFromPrevClip + curClip.durationSec) <= (prevSub.endSec - prevSub.startSec) + 1.45);
      const isCloserToNextSub =
        nextUnassignedSub !== null &&
        Math.abs(curStart - nextUnassignedSub.startSec) <= 0.60 &&
        curStart >= prevSub.endSec + 0.15 &&
        Math.abs(curStart - nextUnassignedSub.startSec) <= gapFromPrevClip;

      if (gapFromPrevClip >= -0.05 && gapFromPrevClip <= 1.35 && isInsideOrNearPrevSub && !isCloserToNextSub) {
        clipMatchedSubIdx[cIdx] = prevSubIdx;
        clipIsSplitContinuation[cIdx] = true;
        clipCoveredSubIndices[cIdx] = [...coveredByPrev];
      }
    }

    // Pass B: Match remaining unassigned subtitles to genuinely nearby clips (<= 1.35s, never grabbing earlier split parts)
    for (let sIdx = 0; sIdx < trSubs.length; sIdx++) {
      if (assignedSubIndices.has(sIdx)) continue;
      const sub = trSubs[sIdx];
      let bestCIdx = -1;
      let bestScore = -Infinity;

      for (let cIdx = 0; cIdx < clips.length; cIdx++) {
        if (clipMatchedSubIdx[cIdx] !== -1) continue;
        if (!isMonotonicCompatible(cIdx, sIdx)) continue;
        const clip = clips[cIdx];
        const cStart = clip.clipStartSec + (clip.offsetSec || 0);
        const signedDiff = cStart - sub.startSec;
        const timeDist = Math.abs(signedDiff);
        if (signedDiff < -0.75 || signedDiff > 1.40 || timeDist > 1.35 || !isWithinTrackCorridor(cIdx, sub.startSec)) continue;

        const subDur = Math.max(0.25, sub.endSec - sub.startSec);
        const durFit = Math.min(clip.durationSec, subDur) / Math.max(clip.durationSec, subDur);
        const score = (2.0 - timeDist) * 2.0 + durFit * 2.5;
        if (score > bestScore) {
          bestScore = score;
          bestCIdx = cIdx;
        }
      }

      if (bestCIdx !== -1) {
        clipMatchedSubIdx[bestCIdx] = sIdx;
        assignedSubIndices.add(sIdx);
        expandMultiSubCoverage(bestCIdx, sIdx);
      }
    }

    // Apply matched metadata or Physics protection
    for (let cIdx = 0; cIdx < clips.length; cIdx++) {
      const clip = clips[cIdx];
      const cStart = clip.clipStartSec + (clip.offsetSec || 0);
      const bestSubIdx = clipMatchedSubIdx[cIdx];
      const isSplitPart = clipIsSplitContinuation[cIdx] || Boolean(clip.isSplitContinuation);

      if (bestSubIdx !== -1) {
        const coveredIdxs = clipCoveredSubIndices[cIdx].length > 0 ? clipCoveredSubIndices[cIdx] : [bestSubIdx];
        const coveredSubs = coveredIdxs.map(idx => trSubs[idx]).filter(Boolean);
        const firstSub = coveredSubs[0] || trSubs[bestSubIdx];
        const lastSub = coveredSubs[coveredSubs.length - 1] || firstSub;

        clip.isPhysics = false;
        clip.isSplitContinuation = isSplitPart;
        clip.text = isSplitPart
          ? `${firstSub.text} (ч. 2)`
          : coveredSubs.length > 1
          ? coveredSubs.map(s => s.text).join(' / ')
          : firstSub.text;
        clip.matchedSubId = String(firstSub.id ?? bestSubIdx);
        clip.coveredSubIds = coveredSubs.map((s, idx) => String(s.id ?? coveredIdxs[idx]));
        // Split-phrase continuations and overlap-resolved clips stay locked on their current timecode!
        clip.targetSubStartSec = (isSplitPart || clip.overlapResolvedLock)
          ? Number(cStart.toFixed(3))
          : Number(firstSub.startSec.toFixed(3));
        clip.targetSubEndSec = lastSub.endSec;
      } else {
        // Non-dialogue character sound ("физика": sigh, gasp, grunt, laugh outside subtitles)
        clip.isPhysics = true;
        clip.isSplitContinuation = false;
        clip.timingIssue = null;
        clip.timingIssueText = undefined;
        clip.targetSubStartSec = undefined;
        clip.matchedSubId = undefined;
        clip.coveredSubIds = undefined;
        if (!clip.text || clip.text.startsWith('Фраза ')) {
          clip.text = `⚡ Физика (${characterName})`;
        }
      }
    }

    return clips;
  }, []);

  // ---------------------------------------------------------------------------
  // ITERATIVE SELF-HEALING FINAL AUDIT LOOP
  // Verifies 100% of subtitles across all dubbers:
  // - Locks each clip to at most ONE primary subtitle (coveredSubIds[0]) so multi-subtitle
  //   clips NEVER oscillate back and forth between two subtitles.
  // - Protects split-phrase continuations (`isSplitContinuation`) and resolved overlaps (`overlapResolvedLock`).
  // - Recognizes subtitles voiced by another dubber (`voicedByOtherDubber`) as valid voiced lines (not missing).
  // - Never moves clips that are already inside their subtitle window or into inter-track collisions.
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

    // Helper: check if another dubber's track already voices a subtitle window `[sub.startSec, sub.endSec]`
    const findOtherDubberCoveringSubtitle = (currentTrackId: string, sub: SubtitleLine): { dubberName: string; clip: AudioClip } | null => {
      const subDur = Math.max(0.25, sub.endSec - sub.startSec);
      for (const otherTrack of tracks) {
        if (otherTrack.id === currentTrackId) continue;
        const otherClips = workingClips[otherTrack.id] || [];
        for (const oc of otherClips) {
          if (oc.isPhysics) continue;
          const os = oc.clipStartSec + (oc.offsetSec || 0);
          const oe = os + oc.durationSec;
          const ov = Math.min(oe, sub.endSec + 0.20) - Math.max(os, sub.startSec - 0.20);
          if (ov >= Math.min(0.28, subDur * 0.35)) {
            return {
              dubberName: otherTrack.participant || otherTrack.dubberName || 'Другой даббер',
              clip: oc
            };
          }
        }
      }
      return null;
    };

    // Helper: find the latest end time of a preceding dialogue turn on any other track so moving a clip earlier never creates an inter-track overlap
    const getPrevInterTrackTurnEnd = (currentTrackId: string, curStart: number, targetStart: number): number => {
      let maxPrevEnd = 0;
      for (const [otherTrId, otherClips] of Object.entries(workingClips)) {
        if (otherTrId === currentTrackId) continue;
        for (const oc of otherClips) {
          if (oc.isPhysics) continue;
          const os = oc.clipStartSec + (oc.offsetSec || 0);
          const oe = os + oc.durationSec;
          if (os < curStart - 0.10 && oe > targetStart - 0.04 && oe <= curStart + 0.65) {
            maxPrevEnd = Math.max(maxPrevEnd, oe + 0.04);
          }
        }
      }
      return maxPrevEnd;
    };

    const MAX_ITERATIONS = 4;
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

        // Re-bind clips monotonically at the start of each pass so matchedSubId & coveredSubIds are 100% accurate
        let trClips = bindTrackClipsToSubtitlesMonotonically(track, workingClips[track.id] || [], trSubs);
        // Lock all split-phrase continuation clips right away so they are never grabbed by any subsequent subtitle
        const lockedClipIds = new Set<string>(
          trClips.filter(c => c.isSplitContinuation || c.overlapResolvedLock).map(c => c.id)
        );

        for (let sIdx = 0; sIdx < trSubs.length; sIdx++) {
          const sub = trSubs[sIdx];
          const subIdStr = String(sub.id ?? sIdx);

          // 1. Check if `sub` is a SECONDARY subtitle (index >= 1) of a continuous multi-subtitle clip or split phrase.
          const multiSubOwner = trClips.find(
            c => !c.isPhysics && c.coveredSubIds && c.coveredSubIds.length > 1 && c.coveredSubIds.includes(subIdStr) && c.coveredSubIds[0] !== subIdStr
          );
          if (multiSubOwner) {
            lockedClipIds.add(multiSubOwner.id);
            continue;
          }

          // 2. Find the primary clip assigned to `sub` (never grabbing a split-phrase continuation or a clip locked to an earlier subtitle!)
          let coveringClipIdx = trClips.findIndex(
            c => !c.isPhysics && !c.isSplitContinuation && !lockedClipIds.has(c.id) && (c.matchedSubId === subIdStr || c.coveredSubIds?.[0] === subIdStr)
          );
          if (coveringClipIdx === -1) {
            coveringClipIdx = trClips.findIndex(c => {
              if (c.isPhysics || c.isSplitContinuation || lockedClipIds.has(c.id)) return false;
              if (c.matchedSubId && c.matchedSubId !== subIdStr) return false;
              const cs = c.clipStartSec + (c.offsetSec || 0);
              const ce = cs + c.durationSec;
              return cs <= sub.endSec + 0.35 && ce >= sub.startSec - 0.35;
            });
          }

          if (coveringClipIdx !== -1) {
            const covClip = trClips[coveringClipIdx];
            lockedClipIds.add(covClip.id);

            if (covClip.isSplitContinuation || covClip.overlapResolvedLock || covClip.isUnisonPhrase) {
              continue;
            }

            const covStart = covClip.clipStartSec + (covClip.offsetSec || 0);
            const origStart = covClip.rawSourceStartSec ?? covClip.sourceStartSec ?? covStart;
            const signedDiff = covStart - sub.startSec;

            // Only align if the phrase is genuinely displaced (starts > 0.35s BEFORE sub.startSec or > 0.55s AFTER sub.startSec)
            // Phrases starting naturally 0.00s..0.55s after sub.startSec are already in lip-sync inside the subtitle window!
            const isDisplaced = signedDiff < -0.35 || signedDiff > 0.55;

            if (isDisplaced) {
              const prevIntraLim = coveringClipIdx > 0
                ? (trClips[coveringClipIdx - 1].clipStartSec + (trClips[coveringClipIdx - 1].offsetSec || 0) + trClips[coveringClipIdx - 1].durationSec + 0.03)
                : 0;
              const idealStart = Math.max(0, sub.startSec);
              const prevInterLim = idealStart < covStart
                ? getPrevInterTrackTurnEnd(track.id, covStart, idealStart)
                : 0;
              const prevLim = Math.max(prevIntraLim, prevInterLim);

              const nextLim = coveringClipIdx + 1 < trClips.length
                ? (trClips[coveringClipIdx + 1].clipStartSec + (trClips[coveringClipIdx + 1].offsetSec || 0) - covClip.durationSec - 0.03)
                : Infinity;

              // Never move a clip more than 0.65s from its recorded position
              const clampedTarget = Math.max(origStart - 0.65, Math.min(origStart + 0.65, idealStart));
              const healedStart = Number(
                Math.max(0, Math.max(prevLim, Math.min(clampedTarget, Math.max(prevLim, nextLim)))).toFixed(3)
              );

              if (Math.abs(healedStart - covStart) >= 0.06 && Math.abs(healedStart - idealStart) < Math.abs(covStart - idealStart) - 0.04) {
                covClip.clipStartSec = healedStart;
                covClip.offsetSec = 0;
                covClip.matchedSubId = subIdStr;
                covClip.targetSubStartSec = healedStart;
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

          // 3. Check if any clip on this track (including split continuations) already covers [sub.startSec, sub.endSec] acoustically
          const alreadyCoveredAcoustically = trClips.some(c => {
            const cs = c.clipStartSec + (c.offsetSec || 0);
            const ce = cs + c.durationSec;
            const overlap = Math.min(ce, sub.endSec + 0.25) - Math.max(cs, sub.startSec - 0.25);
            return overlap >= Math.min(0.22, (sub.endSec - sub.startSec) * 0.30);
          });
          if (alreadyCoveredAcoustically) continue;

          // Subtitle `sub` is UNVOICED on this dubber's timeline — check local corridor first
          const prevSubEnd = sIdx > 0 ? trSubs[sIdx - 1].endSec : 0;
          const nextSubStart = sIdx + 1 < trSubs.length ? trSubs[sIdx + 1].startSec : Infinity;

          // Step A: Check if a clip right inside this subtitle's tight local window (<= 0.75s) was tagged as `isPhysics`
          const nearbyPhysicsIdx = trClips.findIndex(c => {
            if (!c.isPhysics || lockedClipIds.has(c.id)) return false;
            const cs = c.clipStartSec + (c.offsetSec || 0);
            return cs >= prevSubEnd - 0.15 && cs <= nextSubStart + 0.15 && Math.abs(cs - sub.startSec) <= 0.75;
          });

          if (nearbyPhysicsIdx !== -1) {
            const rescuedClip = trClips[nearbyPhysicsIdx];
            lockedClipIds.add(rescuedClip.id);
            rescuedClip.isPhysics = false;
            rescuedClip.overlapResolvedLock = true;
            rescuedClip.text = sub.text;
            rescuedClip.matchedSubId = subIdStr;
            rescuedClip.coveredSubIds = [subIdStr];
            rescuedClip.targetSubStartSec = rescuedClip.clipStartSec;
            rescuedClip.targetSubEndSec = sub.endSec;
            rescuedClip.timingIssue = null;
            realignedCount++;
            actionsInPass++;
            addLog(
              `🛡 [Аудит Итерация #${iter}] Реплика «${sub.text.slice(0, 28)}» (${dubberName}) возвращена из категории физики на ${formatSeconds(rescuedClip.clipStartSec)}`,
              'success'
            );
            continue;
          }

          // Step B: Search Priority 1 — Fix Track Buffers, then Priority 2 — Original Track Buffer
          const localWinStart = Math.max(0, Math.max(prevSubEnd - 0.10, sub.startSec - 1.3));
          const localWinEnd = Math.min(nextSubStart + 0.10, sub.endSec + 1.3);
          if (localWinEnd <= localWinStart + 0.18) continue;

          const isSourceIntervalAlreadyUsed = (ivStart: number, ivEnd: number): boolean => {
            return trClips.some(existing => {
              const srcOverlap = Math.min(existing.sourceEndSec, ivEnd) - Math.max(existing.sourceStartSec, ivStart);
              const tlStart = existing.clipStartSec + (existing.offsetSec || 0);
              const tlEnd = tlStart + existing.durationSec;
              const tlOverlap = Math.min(tlEnd, ivEnd) - Math.max(tlStart, ivStart);
              return srcOverlap >= 0.08 || tlOverlap >= 0.12;
            });
          };

          let recoveredClip: AudioClip | null = null;

          // Priority 1: Fix Track Buffers for this dubber
          const actorFixBuffers = fixBuffersByActorRef.current[actorNorm] || [];
          for (const fixSource of actorFixBuffers) {
            const candidateIntervals = scanBufferWindowForSpeech(
              fixSource.buffer,
              localWinStart,
              Math.min(fixSource.buffer.duration, localWinEnd),
              timingSettings.leadInPaddingSec,
              timingSettings.leadOutPaddingSec
            );
            const unusedIv = candidateIntervals.find(iv => !isSourceIntervalAlreadyUsed(iv.startSec, iv.endSec));
            if (unusedIv) {
              recoveredClip = {
                id: `clip_${track.id}_healed_fix_${subIdStr}_${iter}`,
                trackId: track.id,
                dubberName,
                characterName,
                clipStartSec: Number(unusedIv.startSec.toFixed(3)),
                durationSec: unusedIv.durationSec,
                sourceStartSec: unusedIv.startSec,
                sourceEndSec: unusedIv.endSec,
                rawSourceStartSec: unusedIv.startSec,
                rawSourceEndSec: unusedIv.endSec,
                speechOnsetOffsetSec: detectSpeechOnsetOffsetSec(fixSource.buffer, unusedIv.startSec, unusedIv.endSec),
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
                `🚑 [Аудит Итерация #${iter}] Пропущенная реплика «${sub.text.slice(0, 30)}» (${dubberName}) найдена в ДОРОЖКЕ ФИКСОВ [${formatSeconds(unusedIv.startSec)}-${formatSeconds(unusedIv.endSec)}] и восстановлена!`,
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
                localWinStart,
                Math.min(origSource.buffer.duration, localWinEnd),
                timingSettings.leadInPaddingSec,
                timingSettings.leadOutPaddingSec
              );
              const unusedCandidates = candidateIntervals
                .filter(iv => !isSourceIntervalAlreadyUsed(iv.startSec, iv.endSec))
                .sort((a, b) => Math.abs(a.startSec - sub.startSec) - Math.abs(b.startSec - sub.startSec));

              if (unusedCandidates.length > 0) {
                const bestIv = unusedCandidates[0];
                recoveredClip = {
                  id: `clip_${track.id}_healed_orig_${subIdStr}_${iter}`,
                  trackId: track.id,
                  dubberName,
                  characterName,
                  clipStartSec: Number(bestIv.startSec.toFixed(3)),
                  durationSec: bestIv.durationSec,
                  sourceStartSec: bestIv.startSec,
                  sourceEndSec: bestIv.endSec,
                  rawSourceStartSec: bestIv.startSec,
                  rawSourceEndSec: bestIv.endSec,
                  speechOnsetOffsetSec: detectSpeechOnsetOffsetSec(origSource.buffer, bestIv.startSec, bestIv.endSec),
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
                  `🚑 [Аудит Итерация #${iter}] Пропущенная реплика «${sub.text.slice(0, 30)}» (${dubberName}) найдена в ОРИГИНАЛЬНОЙ ДОРОЖКЕ [${formatSeconds(bestIv.startSec)}-${formatSeconds(bestIv.endSec)}] и восстановлена!`,
                  'success'
                );
              }
            }
          }

          if (recoveredClip) {
            lockedClipIds.add(recoveredClip.id);
            trClips.push(recoveredClip);
            trClips.sort((a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0)));
            actionsInPass++;
          }
        }

        // Local micro-overlap cleanup (NEVER domino-pushing clips across the track!)
        trClips.sort((a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0)));
        for (let i = 0; i < trClips.length - 1; i++) {
          const c1 = trClips[i];
          const c2 = trClips[i + 1];
          const c1Start = c1.clipStartSec + (c1.offsetSec || 0);
          const c1End = c1Start + c1.durationSec;
          const c2Start = c2.clipStartSec + (c2.offsetSec || 0);
          const overlap = c1End - c2Start;
          if (overlap > 0 && overlap <= 0.16 && c1.durationSec - overlap >= 0.20) {
            c1.durationSec = Number((c1.durationSec - overlap - 0.01).toFixed(3));
            c1.sourceEndSec = Number((c1.sourceStartSec + c1.durationSec).toFixed(3));
          }
        }

        workingClips[track.id] = trClips;
      }

      if (actionsInPass === 0) {
        break;
      }
    }

    // Final Verification Tally across 100% of subtitles of all dubbers (with Cross-Dubber Voicing Check)
    let totalSubs = 0;
    let voicedSubs = 0;
    let voicedByOtherDubberCount = 0;
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
        const isCoveredOnOwnTrack = trClips.some(c => {
          if (c.matchedSubId === subIdStr || c.coveredSubIds?.includes(subIdStr)) return true;
          const cs = c.clipStartSec + (c.offsetSec || 0);
          const ce = cs + c.durationSec;
          return cs <= sub.endSec + 0.55 && ce >= sub.startSec - 0.55;
        });

        if (isCoveredOnOwnTrack) {
          voicedSubs++;
        } else {
          // Cross-dubber check: if another dubber voiced this subtitle window, it's NOT a missing phrase!
          const otherCoverage = findOtherDubberCoveringSubtitle(track.id, sub);
          if (otherCoverage) {
            voicedSubs++;
            voicedByOtherDubberCount++;
            addLog(
              `🤝 [Проверка дабберов] Реплика «${sub.text.slice(0, 28)}» (${formatSeconds(sub.startSec)}, роль: ${characterName}) отсутствует у «${dubberName}», но озвучена даббером «${otherCoverage.dubberName}» — пропуск снят.`,
              'info'
            );
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
    }

    return {
      healedClips: workingClips,
      report: {
        totalSubs,
        voicedSubs,
        voicedByOtherDubberCount,
        recoveredFromFixCount,
        recoveredFromOrigCount,
        realignedCount,
        physicsProtectedCount,
        iterationsRun,
        unvoicedSubs,
        passed: unvoicedSubs.length === 0
      }
    };
  }, [tracks, trackSubLinesMap, timingSettings.leadInPaddingSec, timingSettings.leadOutPaddingSec, bindTrackClipsToSubtitlesMonotonically, addLog]);

  // ---------------------------------------------------------------------------
  // SURGICAL OVERLAP & COLLISION RESOLVER (INTRA-TRACK & INTER-TRACK)
  // - Protects all simultaneous two-subtitle scenes (`isSimultaneousScene`) and contained clips
  //   (e.g. a short line spoken inside a 7-9s reaction/scream on another track).
  // - Enforces strict max shift caps (<= 0.18s pull back, <= 0.25s push forward from original place).
  // - Checks ALL tracks (`allClipsMap`) before moving a clip so it NEVER creates a cross-track
  //   or intra-track domino cascade!
  // ---------------------------------------------------------------------------
  const separateOverlappingClipPair = useCallback((
    earlyClip: AudioClip,
    lateClip: AudioClip,
    earlyTrackClips: AudioClip[],
    lateTrackClips: AudioClip[],
    allClipsMap?: Record<string, AudioClip[]>
  ): boolean => {
    const clearCollisionFlags = () => {
      earlyClip.hasCollision = false;
      lateClip.hasCollision = false;
      earlyClip.overlappingClipId = undefined;
      lateClip.overlappingClipId = undefined;
      if (earlyClip.timingIssue === 'overlap') {
        earlyClip.timingIssue = null;
        earlyClip.timingIssueText = undefined;
      }
      if (lateClip.timingIssue === 'overlap') {
        lateClip.timingIssue = null;
        lateClip.timingIssueText = undefined;
      }
    };

    const earlyStart = earlyClip.clipStartSec + (earlyClip.offsetSec || 0);
    const earlyEnd = earlyStart + earlyClip.durationSec;
    const lateStart = lateClip.clipStartSec + (lateClip.offsetSec || 0);
    const lateEnd = lateStart + lateClip.durationSec;
    const overlap = earlyEnd - lateStart;

    if (overlap <= 0.015) {
      clearCollisionFlags();
      return false;
    }

    const findBestSubForClip = (clip: AudioClip): SubtitleLine | undefined => {
      const trSubs = trackSubLinesMap[clip.trackId] || [];
      if (clip.matchedSubId) {
        const byId = trSubs.find(s => String(s.id) === String(clip.matchedSubId)) ||
          subtitles.find(s => String(s.id) === String(clip.matchedSubId));
        if (byId) return byId;
      }
      const cs = clip.clipStartSec + (clip.offsetSec || 0);
      const ce = cs + clip.durationSec;
      const pool = trSubs.length > 0 ? trSubs : subtitles;
      let best: SubtitleLine | undefined;
      let bestDist = Infinity;
      for (const s of pool) {
        const ov = Math.min(ce, s.endSec) - Math.max(cs, s.startSec);
        const dist = Math.abs(cs - s.startSec) - (ov > 0 ? ov * 0.5 : 0);
        if (Math.abs(cs - s.startSec) <= 1.35 && dist < bestDist) {
          bestDist = dist;
          best = s;
        }
      }
      return best;
    };

    const subEarly = findBestSubForClip(earlyClip);
    const subLate = findBestSubForClip(lateClip);
    const minClipDur = Math.min(earlyClip.durationSec, lateClip.durationSec);

    // PROTECTION FOR SIMULTANEOUS SPEECH (when two subtitles/characters are supposed to sound together):
    if (earlyClip.trackId !== lateClip.trackId) {
      if (earlyClip.isIntentionalOverlap || lateClip.isIntentionalOverlap || earlyClip.isUnisonPhrase || lateClip.isUnisonPhrase) {
        clearCollisionFlags();
        return false;
      }
      // 1. Contained clip (e.g. 12:28.33 inside 12:24.90-12:32.32, or 19:59-20:04 inside 19:57.78-20:06.68)
      //    or simultaneous start, or large overlap (> 0.48s)
      if (
        lateStart - earlyStart <= 0.10 ||
        lateEnd <= earlyEnd + 0.18 ||
        overlap > 0.48 ||
        overlap > minClipDur * 0.42
      ) {
        clearCollisionFlags();
        return false;
      }
      // 2. The two clips' matched subtitles overlap in .ass (or subLate starts > 0.45s before earlyClip ends)
      if (subEarly && subLate) {
        if (subEarly.id !== undefined && subLate.id !== undefined && String(subEarly.id) === String(subLate.id)) {
          clearCollisionFlags();
          return false;
        }
        const subOv = Math.min(subEarly.endSec, subLate.endSec) - Math.max(subEarly.startSec, subLate.startSec);
        if (subOv > -0.02 || earlyEnd - subLate.startSec > 0.45) {
          clearCollisionFlags();
          return false;
        }
      }
      // 3. Global .ass subtitles check: if ANY two subtitles overlap in [lateStart - 0.05, earlyEnd + 0.05],
      //    two characters are speaking simultaneously according to the script!
      const activeGlobalSubs = subtitles.filter(
        s => s.endSec >= lateStart - 0.05 && s.startSec <= earlyEnd + 0.05
      );
      for (let a = 0; a < activeGlobalSubs.length; a++) {
        for (let b = a + 1; b < activeGlobalSubs.length; b++) {
          const gOv = Math.min(activeGlobalSubs[a].endSec, activeGlobalSubs[b].endSec) -
            Math.max(activeGlobalSubs[a].startSec, activeGlobalSubs[b].startSec);
          if (gOv >= 0.05) {
            clearCollisionFlags();
            return false;
          }
        }
      }
    } else {
      // Same track: never separate if overlap > 0.55s
      if (overlap > 0.55) {
        clearCollisionFlags();
        return false;
      }
    }

    const needed = overlap + 0.03;
    let remaining = needed;
    let movedOrTrimmed = false;

    // STEP 1: Trim silent lead-out padding tail of earlyClip first (up to 0.10s, 0ms position shift!)
    if (earlyClip.durationSec - 0.10 >= 0.28) {
      const maxSafeTrim = Math.min(0.10, earlyClip.durationSec - 0.28);
      const trim = Math.min(remaining, maxSafeTrim);
      if (trim >= 0.015) {
        earlyClip.durationSec = Number((earlyClip.durationSec - trim).toFixed(3));
        earlyClip.sourceEndSec = Number((earlyClip.sourceStartSec + earlyClip.durationSec).toFixed(3));
        remaining -= trim;
        movedOrTrimmed = true;
      }
    }

    // STEP 2: Pull earlyClip slightly earlier (max 0.18s from its original recorded position, respecting all tracks)
    const origEarlyStart = earlyClip.rawSourceStartSec ?? earlyClip.sourceStartSec ?? earlyStart;
    const earlySorted = [...earlyTrackClips].sort(
      (a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0))
    );
    const earlyIdx = earlySorted.findIndex(c => c.id === earlyClip.id);
    let earlyPrevEnd = earlyIdx > 0
      ? (earlySorted[earlyIdx - 1].clipStartSec + (earlySorted[earlyIdx - 1].offsetSec || 0) + earlySorted[earlyIdx - 1].durationSec + 0.04)
      : 0;

    // Also ensure pulling earlyClip back doesn't hit a preceding clip on any other track
    if (allClipsMap) {
      for (const [tId, list] of Object.entries(allClipsMap)) {
        if (tId === earlyClip.trackId) continue;
        for (const oc of list) {
          if (oc.id === earlyClip.id || oc.id === lateClip.id || oc.isPhysics) continue;
          const os = oc.clipStartSec + (oc.offsetSec || 0);
          const oe = os + oc.durationSec;
          if (oe <= earlyStart + 0.05 && oe > earlyStart - 0.35) {
            earlyPrevEnd = Math.max(earlyPrevEnd, oe + 0.04);
          }
        }
      }
    }

    const subEarlyFloor = subEarly ? subEarly.startSec - 0.12 : origEarlyStart - 0.18;
    const earlyMinAllowed = Math.max(earlyPrevEnd, origEarlyStart - 0.18, subEarlyFloor);
    const maxPullEarlyBack = Math.max(0, earlyStart - earlyMinAllowed);

    if (remaining > 0.008 && maxPullEarlyBack >= 0.015) {
      const pull = Math.min(remaining, maxPullEarlyBack);
      earlyClip.clipStartSec = Number(Math.max(0, earlyStart - pull).toFixed(3));
      earlyClip.offsetSec = 0;
      remaining -= pull;
      movedOrTrimmed = true;
    }

    // STEP 3: Push lateClip slightly later (max 0.25s from its original recorded position, ZERO domino on any track!)
    if (remaining > 0.008) {
      const origLateStart = lateClip.rawSourceStartSec ?? lateClip.sourceStartSec ?? lateStart;
      const lateSorted = [...lateTrackClips].sort(
        (a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0))
      );
      const lateIdx = lateSorted.findIndex(c => c.id === lateClip.id);
      let nextAnyTrackStart = lateIdx !== -1 && lateIdx + 1 < lateSorted.length
        ? (lateSorted[lateIdx + 1].clipStartSec + (lateSorted[lateIdx + 1].offsetSec || 0) - 0.04)
        : Infinity;

      // Cross-track domino guard: never push lateClip if its new tail would touch the next speaker's clip on ANY other track!
      if (allClipsMap) {
        for (const [tId, list] of Object.entries(allClipsMap)) {
          if (tId === lateClip.trackId) continue;
          for (const oc of list) {
            if (oc.id === earlyClip.id || oc.id === lateClip.id || oc.isPhysics) continue;
            const os = oc.clipStartSec + (oc.offsetSec || 0);
            if (os >= lateStart + 0.15 && os <= lateEnd + 0.60) {
              nextAnyTrackStart = Math.min(nextAnyTrackStart, os - 0.04);
            }
          }
        }
      }

      const maxByNextClip = Math.max(0, nextAnyTrackStart - (lateStart + lateClip.durationSec));
      const maxByOrigPos = Math.max(0, (origLateStart + 0.25) - lateStart);
      const maxBySubPos = subLate ? Math.max(0, (subLate.startSec + 0.28) - lateStart) : 0.25;
      const maxPushLateForward = Math.min(maxByNextClip, maxByOrigPos, maxBySubPos);

      if (maxPushLateForward >= 0.015) {
        const push = Math.min(remaining, maxPushLateForward);
        lateClip.clipStartSec = Number((lateStart + push).toFixed(3));
        lateClip.offsetSec = 0;
        remaining -= push;
        movedOrTrimmed = true;
      }
    }

    const finalEarlyStart = earlyClip.clipStartSec + (earlyClip.offsetSec || 0);
    const finalLateStart = lateClip.clipStartSec + (lateClip.offsetSec || 0);

    earlyClip.targetSubStartSec = finalEarlyStart;
    lateClip.targetSubStartSec = finalLateStart;
    earlyClip.overlapResolvedLock = true;
    lateClip.overlapResolvedLock = true;
    clearCollisionFlags();

    if (movedOrTrimmed) {
      addLog(
        `↔️ Наезд раздвинут: «${earlyClip.dubberName}» (${formatSeconds(finalEarlyStart)}–${formatSeconds(finalEarlyStart + earlyClip.durationSec)}) и «${lateClip.dubberName}» (➔ ${formatSeconds(finalLateStart)})`,
        'success'
      );
      return true;
    }
    return false;
  }, [trackSubLinesMap, subtitles, addLog]);

  // ---------------------------------------------------------------------------
  // ЭТАП 2: ТОЧЕЧНЫЙ ХИРУРГИЧЕСКИЙ АВТОТАЙМИНГ + ИТЕРАЦИОННЫЙ САМОВОССТАНАВЛИВАЮЩИЙСЯ АУДИТ
  // ---------------------------------------------------------------------------
  const handleApplyTargetedAutoTiming = async (typeFilter: 'all' | 'overlap' | 'desync' | 'orphan' = 'all') => {
    if (tracks.length === 0) return;
    try {
      setIsLoading(true);
      updateProcess('2. Точечный автотайминг', 'Монотонная привязка фраз к субтитрам и защита физики...', 25, 1, 3);
      addLog(`Запуск Этапа 2: хирургический автотайминг (режим: ${typeFilter})...`, 'info');
      await new Promise(r => setTimeout(r, 0));

      const updatedClips: Record<string, AudioClip[]> = {};
      for (const track of tracks) {
        const trSubs = [...(trackSubLinesMap[track.id] || [])].sort((a, b) => a.startSec - b.startSec);
        updatedClips[track.id] = bindTrackClipsToSubtitlesMonotonically(track, audioClips[track.id] || [], trSubs);
      }

      let fixedDesyncCount = 0;
      let fixedOverlapCount = 0;
      let fixedOrphanCount = 0;

      // Helper to resolve genuine tail-to-head overlaps currently on the timeline or in timingIssues
      const resolveAllOverlapsInMap = (clipsMap: Record<string, AudioClip[]>): number => {
        let resolved = 0;
        const findClipEntryById = (id?: string): { clip: AudioClip; trackId: string } | null => {
          if (!id) return null;
          for (const [tId, list] of Object.entries(clipsMap)) {
            const found = list.find(c => c.id === id);
            if (found) return { clip: found, trackId: tId };
          }
          return null;
        };

        // Pass 1: Resolve explicit overlap issues from `timingIssues` (skipping simultaneous two-subtitle scenes)
        for (const issue of timingIssues) {
          if (issue.type !== 'overlap') continue;
          let entryA = findClipEntryById(issue.clipId);
          let entryB = findClipEntryById(issue.overlappingClipId || entryA?.clip.overlappingClipId);

          if (!entryA || !entryB) {
            const nearClips: Array<{ clip: AudioClip; trackId: string }> = [];
            for (const [tId, list] of Object.entries(clipsMap)) {
              for (const c of list) {
                if (c.isPhysics) continue;
                const cs = c.clipStartSec + (c.offsetSec || 0);
                const ce = cs + c.durationSec;
                if (cs <= issue.timeSec + 0.85 && ce >= issue.timeSec - 0.85) {
                  nearClips.push({ clip: c, trackId: tId });
                }
              }
            }
            for (let i = 0; i < nearClips.length; i++) {
              for (let j = i + 1; j < nearClips.length; j++) {
                const a = nearClips[i];
                const b = nearClips[j];
                const as = a.clip.clipStartSec + (a.clip.offsetSec || 0);
                const ae = as + a.clip.durationSec;
                const bs = b.clip.clipStartSec + (b.clip.offsetSec || 0);
                const be = bs + b.clip.durationSec;
                const ov = Math.min(ae, be) - Math.max(as, bs);
                if (ov > 0.015 && ov <= 0.48) {
                  entryA = as <= bs ? a : b;
                  entryB = as <= bs ? b : a;
                  break;
                }
              }
              if (entryA && entryB) break;
            }
          }

          if (entryA && entryB && entryA.clip.id !== entryB.clip.id) {
            const aStart = entryA.clip.clipStartSec + (entryA.clip.offsetSec || 0);
            const bStart = entryB.clip.clipStartSec + (entryB.clip.offsetSec || 0);
            const early = aStart <= bStart ? entryA : entryB;
            const late = aStart <= bStart ? entryB : entryA;
            if (separateOverlappingClipPair(early.clip, late.clip, clipsMap[early.trackId] || [], clipsMap[late.trackId] || [], clipsMap)) {
              resolved++;
            }
          }
        }

        // Pass 2: Resolve any remaining intra-track overlaps on every track
        for (const trackId of Object.keys(clipsMap)) {
          const clips = clipsMap[trackId] || [];
          clips.sort((a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0)));
          for (let i = 0; i < clips.length - 1; i++) {
            const c1 = clips[i];
            const c2 = clips[i + 1];
            const c1End = (c1.clipStartSec + (c1.offsetSec || 0)) + c1.durationSec;
            const c2Start = c2.clipStartSec + (c2.offsetSec || 0);
            const ov = c1End - c2Start;
            if (ov > 0.015 && ov <= 0.55) {
              if (separateOverlappingClipPair(c1, c2, clips, clips, clipsMap)) {
                resolved++;
              }
            }
          }
        }

        // Pass 3: Resolve any remaining flagged inter-track tail-to-head collisions (only if <= 0.48s and not simultaneous subtitles)
        const allDialogue: Array<{ clip: AudioClip; trackId: string }> = [];
        for (const [tId, list] of Object.entries(clipsMap)) {
          for (const c of list) {
            if (!c.isPhysics && !c.isUnisonPhrase && !c.isIntentionalOverlap) {
              allDialogue.push({ clip: c, trackId: tId });
            }
          }
        }
        allDialogue.sort(
          (a, b) => (a.clip.clipStartSec + (a.clip.offsetSec || 0)) - (b.clip.clipStartSec + (b.clip.offsetSec || 0))
        );
        for (let i = 0; i < allDialogue.length; i++) {
          for (let j = i + 1; j < allDialogue.length; j++) {
            const a = allDialogue[i];
            const b = allDialogue[j];
            if (a.trackId === b.trackId) continue;
            const aStart = a.clip.clipStartSec + (a.clip.offsetSec || 0);
            const aEnd = aStart + a.clip.durationSec;
            const bStart = b.clip.clipStartSec + (b.clip.offsetSec || 0);
            if (bStart >= aEnd - 0.015) break;

            const ov = aEnd - bStart;
            if (ov <= 0.48) {
              if (separateOverlappingClipPair(a.clip, b.clip, clipsMap[a.trackId] || [], clipsMap[b.trackId] || [], clipsMap)) {
                resolved++;
              }
            } else {
              // Clear false collision badge on long simultaneous overlaps (> 0.48s)
              a.clip.hasCollision = false;
              b.clip.hasCollision = false;
              if (a.clip.timingIssue === 'overlap') a.clip.timingIssue = null;
              if (b.clip.timingIssue === 'overlap') b.clip.timingIssue = null;
            }
          }
        }

        return resolved;
      };

      // Mode "overlap": ONLY separate overlaps, never running desync shifts or audit!
      if (typeFilter === 'overlap') {
        updateProcess('2. Точечный автотайминг', 'Хирургическое разведение наездов...', 75, 2, 2);
        fixedOverlapCount = resolveAllOverlapsInMap(updatedClips);
        setAudioClips(updatedClips);
        setTimingIssues(prev => prev.filter(i => i.type !== 'overlap'));
        setCollisions([]);
        toast.success(`Раздвинуто наездов: ${fixedOverlapCount}`);
        return;
      }

      // 1 & 2. Хирургическое выравнивание только реально рассинхроненных фраз
      // (НЕ трогаем фразы, которые уже стоят внутри своего субтитра [sub.startSec - 0.35s .. sub.startSec + 0.55s]!)
      for (const trackId of Object.keys(updatedClips)) {
        const clips = [...(updatedClips[trackId] || [])].sort(
          (a, b) => (a.clipStartSec + (a.offsetSec || 0)) - (b.clipStartSec + (b.offsetSec || 0))
        );

        for (let idx = 0; idx < clips.length; idx++) {
          const clip = clips[idx];
          if (clip.isPhysics || clip.isUnisonPhrase || clip.isSplitContinuation || clip.overlapResolvedLock) continue;

          const shouldFixDesync = (typeFilter === 'all' || typeFilter === 'desync');
          const shouldFixOrphan = clip.timingIssue === 'orphan' && (typeFilter === 'all' || typeFilter === 'orphan');

          if ((shouldFixDesync || shouldFixOrphan) && typeof clip.targetSubStartSec === 'number') {
            const curStart = clip.clipStartSec + (clip.offsetSec || 0);
            const origStart = clip.rawSourceStartSec ?? clip.sourceStartSec ?? curStart;
            const signedDiff = curStart - clip.targetSubStartSec;
            const rawDiff = Math.abs(signedDiff);

            // If the phrase is already inside its subtitle window (-0.35s .. +0.55s) and not explicitly flagged as desync/orphan, DO NOT TOUCH IT!
            const isAlreadyInSubtitleWindow = signedDiff >= -0.35 && signedDiff <= 0.55;
            if (isAlreadyInSubtitleWindow && clip.timingIssue !== 'desync' && clip.timingIssue !== 'orphan') {
              clips[idx] = {
                ...clip,
                timingIssue: null,
                timingIssueText: undefined
              };
              continue;
            }

            const prevIntraEnd = idx > 0
              ? (clips[idx - 1].clipStartSec + (clips[idx - 1].offsetSec || 0) + clips[idx - 1].durationSec + 0.03)
              : 0;
            // Respect preceding speaker's phrase end on other tracks when pulling earlier
            let prevInterEnd = 0;
            if (clip.targetSubStartSec < curStart) {
              for (const [otherTrId, otherClips] of Object.entries(updatedClips)) {
                if (otherTrId === trackId) continue;
                for (const oc of otherClips) {
                  if (oc.isPhysics) continue;
                  const os = oc.clipStartSec + (oc.offsetSec || 0);
                  const oe = os + oc.durationSec;
                  if (os < curStart - 0.10 && oe > clip.targetSubStartSec - 0.04 && oe <= curStart + 0.65) {
                    prevInterEnd = Math.max(prevInterEnd, oe + 0.04);
                  }
                }
              }
            }
            const prevEnd = Math.max(prevIntraEnd, prevInterEnd);
            const nextStart = idx + 1 < clips.length
              ? (clips[idx + 1].clipStartSec + (clips[idx + 1].offsetSec || 0) - 0.03)
              : Infinity;

            // Cap maximum automatic shift to 0.65s from original recorded position
            let safeStart = Math.max(origStart - 0.65, Math.min(origStart + 0.65, clip.targetSubStartSec));
            safeStart = Math.max(prevEnd, Math.min(safeStart, Math.max(prevEnd, nextStart - clip.durationSec)));
            safeStart = Number(Math.max(0, safeStart).toFixed(3));

            if (Math.abs(safeStart - curStart) >= 0.06 && Math.abs(safeStart - clip.targetSubStartSec) < rawDiff - 0.04) {
              if (clip.timingIssue === 'orphan') fixedOrphanCount++;
              else fixedDesyncCount++;
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

      // 3. ИТЕРАЦИОННАЯ ФИНАЛЬНАЯ ПРОВЕРКА И САМОВОССТАНОВЛЕНИЕ ВСЕХ САБОВ ВСЕХ ДАББЕРОВ
      updateProcess(
        '3. Финальный аудит и самовосстановление',
        'Проверка 100% субтитров всех дабберов и поиск пропавших реплик (Фиксы ➔ Оригинал)...',
        72,
        2,
        3
      );
      await new Promise(r => setTimeout(r, 0));

      const { healedClips, report } = runIterativeSelfHealingAudit(updatedClips);

      // 4. Хирургическое разведение наездов (ПОСЛЕ аудита, с защитой одновременных сабов и запретом каскадных сдвигов!)
      if (typeFilter === 'all') {
        updateProcess('3. Разведение наездов', 'Финальное хирургическое разведение локальных и междорожечных наездов...', 92, 3, 3);
        await new Promise(r => setTimeout(r, 0));
        fixedOverlapCount += resolveAllOverlapsInMap(healedClips);
      }

      setAudioClips(healedClips);
      setFinalVerificationReport(report);
      setMissingSubtitles(report.unvoicedSubs);

      const remainingUnvoicedSubIds = new Set(report.unvoicedSubs.map(u => `${u.trackId}_${u.subId}`));
      const remainingIssues = timingIssues.filter(issue => {
        if (issue.type === 'desync' && (typeFilter === 'all' || typeFilter === 'desync')) return false;
        if (issue.type === 'overlap' && typeFilter === 'all') return false;
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
          `✅ ФИНАЛЬНАЯ ПРОВЕРКА ПРОЙДЕНА (итераций: ${report.iterationsRun}): 100% субтитров всех дабберов (${report.voicedSubs}/${report.totalSubs}${report.voicedByOtherDubberCount ? `, из них озвучено другими дабберами: ${report.voicedByOtherDubberCount}` : ''}) озвучены и стоят на своих местах! Раздвинуто наездов: ${fixedOverlapCount}, восстановлено из фиксов: ${report.recoveredFromFixCount}, из оригинала: ${report.recoveredFromOrigCount}, довыровнено: ${report.realignedCount}.`,
          'success'
        );
        toast.success(
          `Финальная проверка пройдена! Все ${report.voicedSubs}/${report.totalSubs} сабов на местах (наездов раздвинуто: ${fixedOverlapCount}, исправлено: ${totalFixed}).`
        );
      } else {
        addLog(
          `⚠️ Финальный аудит завершён за ${report.iterationsRun} итераций: озвучено ${report.voicedSubs}/${report.totalSubs} сабов${report.voicedByOtherDubberCount ? ` (в т.ч. другими дабберами: ${report.voicedByOtherDubberCount})` : ''}, раздвинуто наездов: ${fixedOverlapCount}. Не найдено звука для ${report.unvoicedSubs.length} сабов.`,
          'warn'
        );
        toast.warning(
          `Автотайминг завершён! Озвучено ${report.voicedSubs}/${report.totalSubs} сабов, раздвинуто наездов: ${fixedOverlapCount}. Пропусков в исходниках: ${report.unvoicedSubs.length}.`,
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

  // Quick surgical fixer for an overlap collision (intra-track or inter-track, by clipId or timeSec)
  const handleResolveSingleOverlap = (trackId: string, clipId?: string, issueTimeSec?: number, explicitOverlappingClipId?: string) => {
    let wasResolved = false;
    setAudioClips(prev => {
      const updated: Record<string, AudioClip[]> = {};
      for (const [tId, list] of Object.entries(prev)) {
        updated[tId] = list.map(c => ({ ...c }));
      }

      const findById = (id?: string): { clip: AudioClip; trackId: string } | null => {
        if (!id) return null;
        for (const [tId, list] of Object.entries(updated)) {
          const found = list.find(c => c.id === id);
          if (found) return { clip: found, trackId: tId };
        }
        return null;
      };

      let entryA = findById(clipId);
      let entryB = findById(explicitOverlappingClipId || entryA?.clip.overlappingClipId);

      // If entryA exists but entryB is not linked by ID, search for any clip overlapping entryA (same track or other tracks)
      if (entryA && !entryB) {
        const aStart = entryA.clip.clipStartSec + (entryA.clip.offsetSec || 0);
        const aEnd = aStart + entryA.clip.durationSec;
        for (const [tId, list] of Object.entries(updated)) {
          for (const c of list) {
            if (c.id === entryA.clip.id || c.isPhysics) continue;
            const cs = c.clipStartSec + (c.offsetSec || 0);
            const ce = cs + c.durationSec;
            const ov = Math.min(aEnd, ce) - Math.max(aStart, cs);
            if (ov > 0.015 && ov <= 0.48) {
              entryB = { clip: c, trackId: tId };
              break;
            }
          }
          if (entryB) break;
        }
      }

      // Fallback: search by issueTimeSec across all tracks if clip IDs were from QA passport before slicing
      if ((!entryA || !entryB) && typeof issueTimeSec === 'number') {
        const near: Array<{ clip: AudioClip; trackId: string }> = [];
        for (const [tId, list] of Object.entries(updated)) {
          for (const c of list) {
            if (c.isPhysics) continue;
            const cs = c.clipStartSec + (c.offsetSec || 0);
            const ce = cs + c.durationSec;
            if (cs <= issueTimeSec + 0.85 && ce >= issueTimeSec - 0.85) {
              near.push({ clip: c, trackId: tId });
            }
          }
        }
        for (let i = 0; i < near.length; i++) {
          for (let j = i + 1; j < near.length; j++) {
            const a = near[i];
            const b = near[j];
            const as = a.clip.clipStartSec + (a.clip.offsetSec || 0);
            const ae = as + a.clip.durationSec;
            const bs = b.clip.clipStartSec + (b.clip.offsetSec || 0);
            const be = bs + b.clip.durationSec;
            const ov = Math.min(ae, be) - Math.max(as, bs);
            if (ov > 0.015 && ov <= 0.48) {
              entryA = as <= bs ? a : b;
              entryB = as <= bs ? b : a;
              break;
            }
          }
          if (entryA && entryB) break;
        }
      }

      if (entryA && entryB && entryA.clip.id !== entryB.clip.id) {
        const aStart = entryA.clip.clipStartSec + (entryA.clip.offsetSec || 0);
        const bStart = entryB.clip.clipStartSec + (entryB.clip.offsetSec || 0);
        const early = aStart <= bStart ? entryA : entryB;
        const late = aStart <= bStart ? entryB : entryA;
        wasResolved = separateOverlappingClipPair(
          early.clip,
          late.clip,
          updated[early.trackId] || [],
          updated[late.trackId] || [],
          updated
        );
      }

      return updated;
    });

    setTimingIssues(prev =>
      prev.filter(i => {
        if (clipId && (i.clipId === clipId || i.overlappingClipId === clipId)) return false;
        if (typeof issueTimeSec === 'number' && i.type === 'overlap' && Math.abs(i.timeSec - issueTimeSec) <= 0.35) return false;
        return true;
      })
    );
    if (wasResolved) {
      toast.success('Наезд точечно раздвинут!');
    } else {
      toast.info('Фразы на этом участке уже разведены.');
    }
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

      const activeTrackIds = new Set(tracks.map(t => t.id));
      const enrichedAudioClips: Record<string, AudioClip[]> = {};
      for (const trId of Object.keys(audioClips)) {
        if (!activeTrackIds.has(trId)) continue;
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
              {savedTimingStateInfo && (
                <span
                  className="bg-emerald-950/80 text-emerald-300 font-mono text-[10px] px-1.5 py-0.5 rounded border border-emerald-800/50 font-medium inline-flex items-center gap-1 shadow-sm"
                  title={`Сохранено в папку ${savedTimingStateInfo.filePath || 'Тайминг/timing_state.json'}\nВремя: ${new Date(savedTimingStateInfo.savedAt).toLocaleTimeString('ru-RU')}`}
                >
                  <Check className="w-2.5 h-2.5 text-emerald-400" />
                  <span>Сохранено в /Тайминг</span>
                </span>
              )}
            </div>
            <p className="text-[11px] text-neutral-400 hidden xl:block">
              Реалтайм-прослушивание клипов, звук и окно видео, нормализация -18 dBFS
            </p>
          </div>
        </div>

        {/* Uniform Compact Action Buttons Bar (all h-8 px-2.5 text-xs) */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Reset / Start Over Button */}
          <button
            onClick={() => setIsResetConfirmOpen(true)}
            disabled={isLoading}
            className="h-8 px-2.5 bg-neutral-800 hover:bg-neutral-700 text-rose-300 hover:text-rose-200 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border border-rose-800/50 hover:border-rose-600 transition disabled:opacity-50 shrink-0"
            title="Сбросить состояние тайминга и начать сначала с исходных дорожек серии"
          >
            <RotateCcw className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span>Начать сначала</span>
          </button>

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
            disabled={isLoading || tracks.length === 0}
            className={`h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition shrink-0 ${
              tracks.length > 0
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500 shadow-sm'
                : 'bg-neutral-800/60 text-neutral-500 border-neutral-800 cursor-not-allowed'
            }`}
            title="5. Точечный автотайминг: раздвигает наезды, выравнивает рассинхроны и проверяет все сабы"
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

                    {issue.type === 'overlap' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleResolveSingleOverlap(issue.trackId, issue.clipId, issue.timeSec, issue.overlappingClipId);
                        }}
                        className="px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold rounded flex items-center gap-1 shadow"
                        title="Точечно раздвинуть пересекающиеся фразы"
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

            {Boolean(finalVerificationReport.voicedByOtherDubberCount && finalVerificationReport.voicedByOtherDubberCount > 0) && (
              <span className="px-2 py-0.5 rounded bg-sky-900/60 border border-sky-700/60 text-[10px] font-mono text-sky-200">
                🤝 Озвучено другими дабберами: {finalVerificationReport.voicedByOtherDubberCount}
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
                    onClick={() => jumpToTime(u.startSec)}
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
                        const clipWidthPx = Math.max(8, Math.round(clip.durationSec * zoomLevel));
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
                                      handleSetOverlapMainClip(clip.overlapGroupId!, clip.id, clip.dubberName);
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
                                      handleSetOverlapMainClip(clip.overlapGroupId!, clip.id, clip.dubberName);
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
                                {(clip.hasCollision || clip.timingIssue === 'overlap') && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleResolveSingleOverlap(track.id, clip.id, clip.clipStartSec + (clip.offsetSec || 0), clip.overlappingClipId);
                                    }}
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

      {/* Reset Timing Confirmation Modal */}
      {isResetConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl max-w-md w-full p-5 shadow-2xl flex flex-col gap-4 text-neutral-100">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-rose-950/80 border border-rose-700/60 flex items-center justify-center text-rose-400 shrink-0 shadow-sm">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-white">Сбросить тайминг серии и начать сначала?</h3>
                <p className="text-xs text-neutral-300 mt-1.5 leading-relaxed">
                  Файл сохранённого состояния в папке серии <strong className="text-amber-300 font-mono">«Тайминг/timing_state.json»</strong> будет удалён. Вкладка будет перезагружена с исходными мастер-дорожками, чтобы вы могли выполнить разметку и удаление тишины заново с чистого листа.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-neutral-800">
              <button
                type="button"
                onClick={() => setIsResetConfirmOpen(false)}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 transition"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleResetTimingToStart}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg flex items-center gap-1.5 transition shadow"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Сбросить и начать сначала</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
