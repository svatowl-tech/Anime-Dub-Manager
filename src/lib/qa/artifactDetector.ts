/**
 * Audio Recording Artifact Detector (Детектор технических артефактов записи)
 * 
 * Automatically detects technical recording defects on voice tracks:
 * 1. 🔴 Clipping / Digital Overload (Перегруз и срез верхушек сэмплов 0 dBFS)
 * 2. 🐭 Clicks / Mouse clicks / Sharp transients (Клики мыши, клавиатуры, резкие щелчки слюны)
 * 3. 💨 Plosives / P-Pops (Взрывные согласные «п», «б» и задув микрофонного капсюля)
 * 4. 📉 Swallowed Vowels / Truncated words / Noise gate cutoffs (Резкие срезы фразы гейтом, съеденные окончания)
 */

import { Episode, Track, SubtitleLine } from '../../types';

export type AudioArtifactType = 'clipping' | 'mouse_click' | 'plosive' | 'swallowed_vowel';
export type ArtifactSeverity = 'high' | 'medium' | 'low';

export interface AudioArtifact {
  id: string;
  type: AudioArtifactType;
  trackId: string;
  dubberName: string;
  characterName: string;
  assignmentId?: string;
  timestampSec: number;
  startSec: number;
  endSec: number;
  startFormatted: string;
  endFormatted: string;
  durationSec: number;
  severity: ArtifactSeverity;
  title: string;
  description: string;
  metricDetails: string;
  audioUrl?: string;
  audioBuffer?: AudioBuffer;
  nearestSubtitleText?: string;
  subId?: string;
  lineIndex?: number;
  resolutionAction?: 'request_dubber_fix' | 'note_sound_engineer' | 'ignore';
  comment: string;
  selected: boolean;
}

export interface ArtifactDetectionOptions {
  detectClipping?: boolean;
  detectClicks?: boolean;
  detectPlosives?: boolean;
  detectSwallowed?: boolean;
  minClipSamples?: number;
}

function formatTimecode(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

/**
 * 1. CLIPPING & DIGITAL OVERLOAD DETECTOR
 * Finds sequences of samples hitting 0 dBFS / flat tops.
 */
export function detectClippingArtifacts(
  audioBuffer: AudioBuffer,
  track: Track,
  options: { minConsecutive?: number; clusterThresholdSec?: number } = {}
): Omit<AudioArtifact, 'id' | 'selected'>[] {
  const minConsecutive = options.minConsecutive ?? 2;
  const clusterThresholdSec = options.clusterThresholdSec ?? 0.45;
  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0); // Primary channel
  const totalSamples = channelData.length;

  const clipThreshold = 0.9985; // -0.013 dBFS
  const results: Omit<AudioArtifact, 'id' | 'selected'>[] = [];

  interface ClipEvent {
    sampleIndex: number;
    consecutive: number;
  }

  const rawClipEvents: ClipEvent[] = [];
  let currentConsecutive = 0;
  let startIdx = 0;

  for (let i = 0; i < totalSamples; i++) {
    const val = Math.abs(channelData[i]);
    if (val >= clipThreshold) {
      if (currentConsecutive === 0) startIdx = i;
      currentConsecutive++;
    } else {
      if (currentConsecutive >= minConsecutive) {
        rawClipEvents.push({ sampleIndex: startIdx, consecutive: currentConsecutive });
      }
      currentConsecutive = 0;
    }
  }
  if (currentConsecutive >= minConsecutive) {
    rawClipEvents.push({ sampleIndex: startIdx, consecutive: currentConsecutive });
  }

  if (rawClipEvents.length === 0) return results;

  // Cluster nearby clippings
  let clusterStartSample = rawClipEvents[0].sampleIndex;
  let clusterEndSample = rawClipEvents[0].sampleIndex + rawClipEvents[0].consecutive;
  let totalClippedInCluster = rawClipEvents[0].consecutive;
  let maxConsecutiveInCluster = rawClipEvents[0].consecutive;
  let peakSampleIndex = rawClipEvents[0].sampleIndex;

  for (let k = 1; k < rawClipEvents.length; k++) {
    const ev = rawClipEvents[k];
    const timeDelta = (ev.sampleIndex - clusterEndSample) / sampleRate;

    if (timeDelta <= clusterThresholdSec) {
      clusterEndSample = ev.sampleIndex + ev.consecutive;
      totalClippedInCluster += ev.consecutive;
      if (ev.consecutive > maxConsecutiveInCluster) {
        maxConsecutiveInCluster = ev.consecutive;
        peakSampleIndex = ev.sampleIndex;
      }
    } else {
      // Flush previous cluster
      const peakTimeSec = peakSampleIndex / sampleRate;
      const startSec = Math.max(0, (clusterStartSample / sampleRate) - 0.4);
      const endSec = Math.min(audioBuffer.duration, (clusterEndSample / sampleRate) + 0.4);

      const severity: ArtifactSeverity = 
        (totalClippedInCluster > 18 || maxConsecutiveInCluster >= 5) ? 'high' :
        (totalClippedInCluster >= 6 || maxConsecutiveInCluster >= 3) ? 'medium' : 'low';

      results.push({
        type: 'clipping',
        trackId: track.id,
        dubberName: track.participant || 'Даббер',
        characterName: track.character || 'Персонаж',
        timestampSec: peakTimeSec,
        startSec,
        endSec,
        startFormatted: formatTimecode(startSec),
        endFormatted: formatTimecode(endSec),
        durationSec: Number((endSec - startSec).toFixed(2)),
        severity,
        title: `Перегруз / Клиппинг (${totalClippedInCluster} сэмпл.)`,
        description: 'Цифровой срез верхушки аудиоволны на уровне 0 dBFS. Слышен как жесткий хрип, треск и искажение голоса на эмоциях.',
        metricDetails: `Срез: ${totalClippedInCluster} сэмплов (макс. полка ${maxConsecutiveInCluster} сэмпл., 0 dBFS)`,
        resolutionAction: severity === 'high' ? 'request_dubber_fix' : 'note_sound_engineer',
        comment: `[Перезапись] Перегруз/клиппинг [${formatTimecode(peakTimeSec)}]. Сбавь чувствительность микрофона или отойди на шаг назад.`
      });

      // Start new cluster
      clusterStartSample = ev.sampleIndex;
      clusterEndSample = ev.sampleIndex + ev.consecutive;
      totalClippedInCluster = ev.consecutive;
      maxConsecutiveInCluster = ev.consecutive;
      peakSampleIndex = ev.sampleIndex;
    }
  }

  // Flush final cluster
  const peakTimeSec = peakSampleIndex / sampleRate;
  const startSec = Math.max(0, (clusterStartSample / sampleRate) - 0.4);
  const endSec = Math.min(audioBuffer.duration, (clusterEndSample / sampleRate) + 0.4);
  const severity: ArtifactSeverity = 
    (totalClippedInCluster > 18 || maxConsecutiveInCluster >= 5) ? 'high' :
    (totalClippedInCluster >= 6 || maxConsecutiveInCluster >= 3) ? 'medium' : 'low';

  results.push({
    type: 'clipping',
    trackId: track.id,
    dubberName: track.participant || 'Даббер',
    characterName: track.character || 'Персонаж',
    timestampSec: peakTimeSec,
    startSec,
    endSec,
    startFormatted: formatTimecode(startSec),
    endFormatted: formatTimecode(endSec),
    durationSec: Number((endSec - startSec).toFixed(2)),
    severity,
    title: `Перегруз / Клиппинг (${totalClippedInCluster} сэмпл.)`,
    description: 'Цифровой срез верхушки аудиоволны на уровне 0 dBFS. Слышен как жесткий хрип, треск и искажение голоса на эмоциях.',
    metricDetails: `Срез: ${totalClippedInCluster} сэмплов (макс. полка ${maxConsecutiveInCluster} сэмпл., 0 dBFS)`,
    resolutionAction: severity === 'high' ? 'request_dubber_fix' : 'note_sound_engineer',
    comment: `[Перезапись] Перегруз/клиппинг [${formatTimecode(peakTimeSec)}]. Сбавь чувствительность микрофона или отойди на шаг назад.`
  });

  return results;
}

/**
 * 2. MOUSE CLICKS & SHARP MECHANICAL IMPULSES DETECTOR
 * Detects sharp acoustic transients (clicks of mouse microswitches, keys, lip smacks)
 * characterized by an extreme first derivative slope within 1-3 ms.
 */
export function detectClickArtifacts(
  audioBuffer: AudioBuffer,
  track: Track,
  options: { clusterThresholdSec?: number } = {}
): Omit<AudioArtifact, 'id' | 'selected'>[] {
  const clusterThresholdSec = options.clusterThresholdSec ?? 0.3;
  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0);
  const totalSamples = channelData.length;
  const results: Omit<AudioArtifact, 'id' | 'selected'>[] = [];

  // 2.5ms frame
  const frameSize = Math.floor(sampleRate * 0.0025);
  // 40ms moving RMS window
  const rmsWindowSize = Math.floor(sampleRate * 0.04);
  if (totalSamples < rmsWindowSize) return results;

  const rawClicks: { sampleIndex: number; ratio: number; diffPeak: number }[] = [];

  let runningSumSq = 0;
  for (let i = 0; i < rmsWindowSize; i++) {
    runningSumSq += channelData[i] * channelData[i];
  }

  for (let i = rmsWindowSize; i < totalSamples - frameSize; i += frameSize) {
    // Update running RMS
    for (let j = 0; j < frameSize; j++) {
      const added = channelData[i + j];
      const removed = channelData[i - rmsWindowSize + j];
      runningSumSq += added * added - removed * removed;
    }
    if (runningSumSq < 0) runningSumSq = 0;
    const localRms = Math.sqrt(runningSumSq / rmsWindowSize);

    // Only analyze when ambient is between -55 dBFS and -8 dBFS
    if (localRms < 0.0018 || localRms > 0.4) continue;

    // Scan frame for maximum instantaneous sample-to-sample difference
    let maxDiff = 0;
    let maxDiffIdx = i;
    for (let j = 0; j < frameSize; j++) {
      const idx = i + j;
      const diff = Math.abs(channelData[idx] - channelData[idx - 1]);
      if (diff > maxDiff) {
        maxDiff = diff;
        maxDiffIdx = idx;
      }
    }

    const ratio = maxDiff / (localRms + 1e-4);
    // Sharp click has high derivative spike compared to local smooth speech waveform
    if (ratio > 17.5 && maxDiff > 0.07) {
      rawClicks.push({ sampleIndex: maxDiffIdx, ratio, diffPeak: maxDiff });
    }
  }

  if (rawClicks.length === 0) return results;

  // Cluster nearby clicks (avoid duplicate alerts for double-clicks or resonance)
  let clusterStart = rawClicks[0].sampleIndex;
  let maxRatio = rawClicks[0].ratio;
  let maxDiff = rawClicks[0].diffPeak;
  let peakIdx = rawClicks[0].sampleIndex;
  let clickCountInCluster = 1;

  const flushCluster = () => {
    const peakSec = peakIdx / sampleRate;
    const startSec = Math.max(0, peakSec - 0.45);
    const endSec = Math.min(audioBuffer.duration, peakSec + 0.45);
    const severity: ArtifactSeverity = (maxRatio > 26 || maxDiff > 0.18) ? 'high' : 'medium';

    results.push({
      type: 'mouse_click',
      trackId: track.id,
      dubberName: track.participant || 'Даббер',
      characterName: track.character || 'Персонаж',
      timestampSec: peakSec,
      startSec,
      endSec,
      startFormatted: formatTimecode(startSec),
      endFormatted: formatTimecode(endSec),
      durationSec: Number((endSec - startSec).toFixed(2)),
      severity,
      title: `Клик мыши / Резкий щелчок`,
      description: 'Акустический щелчок микропереключателя мыши, клавиатуры или резкий слюнной щелчок губ.',
      metricDetails: `Резкий импульс: крутизна ${(maxRatio).toFixed(1)}x от фона, пик ${(maxDiff * 100).toFixed(0)}% (~2.5мс)`,
      resolutionAction: severity === 'high' ? 'request_dubber_fix' : 'note_sound_engineer',
      comment: `[Перезапись] Посторонний механический клик/щелчок на [${formatTimecode(peakSec)}]. Запиши без щелчков мыши.`
    });
  };

  for (let k = 1; k < rawClicks.length; k++) {
    const clk = rawClicks[k];
    const timeDelta = (clk.sampleIndex - clusterStart) / sampleRate;
    if (timeDelta <= clusterThresholdSec) {
      clickCountInCluster++;
      if (clk.ratio > maxRatio) {
        maxRatio = clk.ratio;
        maxDiff = clk.diffPeak;
        peakIdx = clk.sampleIndex;
      }
    } else {
      flushCluster();
      clusterStart = clk.sampleIndex;
      maxRatio = clk.ratio;
      maxDiff = clk.diffPeak;
      peakIdx = clk.sampleIndex;
      clickCountInCluster = 1;
    }
  }
  flushCluster();

  return results;
}

/**
 * 3. PLOSIVE & P-POP DETECTOR
 * Detects wind blast into the microphone capsule causing huge sub-bass rumble (< 110 Hz)
 * exceeding vocal mid frequencies (300-3000 Hz).
 */
export function detectPlosiveArtifacts(
  audioBuffer: AudioBuffer,
  track: Track,
  options: { clusterThresholdSec?: number } = {}
): Omit<AudioArtifact, 'id' | 'selected'>[] {
  const clusterThresholdSec = options.clusterThresholdSec ?? 0.4;
  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0);
  const totalSamples = channelData.length;
  const results: Omit<AudioArtifact, 'id' | 'selected'>[] = [];

  // Design 2nd-order IIR Lowpass filter at 110 Hz
  const cutoffLp = 110;
  const w0 = 2 * Math.PI * cutoffLp / sampleRate;
  const alpha = Math.sin(w0) / (2 * 0.707);
  const cosw0 = Math.cos(w0);
  const b0 = (1 - cosw0) / 2;
  const b1 = 1 - cosw0;
  const b2 = (1 - cosw0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;

  const lpB0 = b0 / a0;
  const lpB1 = b1 / a0;
  const lpB2 = b2 / a0;
  const lpA1 = a1 / a0;
  const lpA2 = a2 / a0;

  // Filter in 25ms hops (e.g. ~1100 samples)
  const hopSize = Math.floor(sampleRate * 0.025);
  const windowSize = Math.floor(sampleRate * 0.04);
  if (totalSamples < windowSize * 2) return results;

  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const rawPlosives: { sampleIndex: number; subBassDb: number; deltaDb: number }[] = [];

  for (let i = 0; i < totalSamples - windowSize; i += hopSize) {
    let lowEnergySum = 0;
    let fullEnergySum = 0;

    for (let j = 0; j < windowSize; j++) {
      const s = channelData[i + j];
      fullEnergySum += s * s;

      // Lowpass filter state
      const y0 = lpB0 * s + lpB1 * x1 + lpB2 * x2 - lpA1 * y1 - lpA2 * y2;
      x2 = x1; x1 = s;
      y2 = y1; y1 = y0;
      lowEnergySum += y0 * y0;
    }

    const fullRms = Math.sqrt(fullEnergySum / windowSize);
    const lowRms = Math.sqrt(lowEnergySum / windowSize);

    // If vocal speech is active (> -40 dBFS)
    if (fullRms > 0.01) {
      const fullDb = 20 * Math.log10(fullRms + 1e-6);
      const lowDb = 20 * Math.log10(lowRms + 1e-6);
      const deltaDb = lowDb - fullDb; // In normal speech, 20-110Hz is -15 to -25 dB relative to vocal formants

      // Plosive condition: low frequency energy dominates (> -18 dBFS sub-bass and delta > -1.5 dB or positive)
      if (lowDb > -22 && deltaDb > -2.0) {
        rawPlosives.push({
          sampleIndex: i + Math.floor(windowSize / 2),
          subBassDb: lowDb,
          deltaDb: Math.abs(deltaDb + 20) // boost relative to standard voice curve
        });
      }
    }
  }

  if (rawPlosives.length === 0) return results;

  // Cluster plosives
  let clusterStart = rawPlosives[0].sampleIndex;
  let maxSubBass = rawPlosives[0].subBassDb;
  let maxDelta = rawPlosives[0].deltaDb;
  let peakIdx = rawPlosives[0].sampleIndex;

  const flushCluster = () => {
    const peakSec = peakIdx / sampleRate;
    const startSec = Math.max(0, peakSec - 0.4);
    const endSec = Math.min(audioBuffer.duration, peakSec + 0.4);
    const severity: ArtifactSeverity = (maxSubBass > -14 || maxDelta > 22) ? 'high' : 'medium';

    results.push({
      type: 'plosive',
      trackId: track.id,
      dubberName: track.participant || 'Даббер',
      characterName: track.character || 'Персонаж',
      timestampSec: peakSec,
      startSec,
      endSec,
      startFormatted: formatTimecode(startSec),
      endFormatted: formatTimecode(endSec),
      durationSec: Number((endSec - startSec).toFixed(2)),
      severity,
      title: `Взрывной согласный / Задув капсюля («П/Б» хлопок)`,
      description: 'Удар воздушного потока по мембране микрофона (нехватка поп-фильтра). Вызывает гулкий низкочастотный хлопок.',
      metricDetails: `Саб-бас: ${maxSubBass.toFixed(1)} dBFS (+${maxDelta.toFixed(1)} дБ к голосу)`,
      resolutionAction: severity === 'high' ? 'request_dubber_fix' : 'note_sound_engineer',
      comment: `[Перезапись] Задув микрофона на взрывном согласном [${formatTimecode(peakSec)}]. Используй поп-фильтр или отверни микрофон чуть в сторону.`
    });
  };

  for (let k = 1; k < rawPlosives.length; k++) {
    const p = rawPlosives[k];
    const timeDelta = (p.sampleIndex - clusterStart) / sampleRate;
    if (timeDelta <= clusterThresholdSec) {
      if (p.subBassDb > maxSubBass) {
        maxSubBass = p.subBassDb;
        maxDelta = p.deltaDb;
        peakIdx = p.sampleIndex;
      }
    } else {
      flushCluster();
      clusterStart = p.sampleIndex;
      maxSubBass = p.subBassDb;
      maxDelta = p.deltaDb;
      peakIdx = p.sampleIndex;
    }
  }
  flushCluster();

  return results;
}

/**
 * 4. SWALLOWED VOWELS & NOISE GATE CUTOFF DETECTOR
 * Finds abrupt decay cutoffs (gate amputated vowel tail) or speech finishing
 * far prematurely compared to long subtitle lines.
 */
export function detectSwallowedOrCutoffArtifacts(
  audioBuffer: AudioBuffer,
  track: Track,
  subLines: SubtitleLine[],
  assignedCharacters: Set<string>
): Omit<AudioArtifact, 'id' | 'selected'>[] {
  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0);
  const results: Omit<AudioArtifact, 'id' | 'selected'>[] = [];

  for (let idx = 0; idx < subLines.length; idx++) {
    const line = subLines[idx];
    const charName = (line.name || '').trim().toLowerCase();
    if (!assignedCharacters.has(charName)) continue;

    const startSec = Math.max(0, line.startSec);
    const endSec = Math.min(audioBuffer.duration, line.endSec);
    const subDuration = endSec - startSec;
    if (subDuration < 1.4) continue; // Only check substantial lines

    const cleanedText = line.text.replace(/\{[^}]+\}/g, '').trim();
    const wordCount = cleanedText.split(/\s+/).filter(Boolean).length;
    if (wordCount < 3) continue;

    const startSample = Math.floor(startSec * sampleRate);
    const endSample = Math.floor(endSec * sampleRate);

    // Compute short-time RMS in 15ms windows throughout the subtitle line
    const windowSize = Math.floor(sampleRate * 0.015);
    const rmsList: number[] = [];

    for (let s = startSample; s < endSample - windowSize; s += windowSize) {
      let sumSq = 0;
      for (let j = 0; j < windowSize; j++) {
        const val = channelData[s + j];
        sumSq += val * val;
      }
      rmsList.push(Math.sqrt(sumSq / windowSize));
    }

    if (rmsList.length < 10) continue;

    // Find active speech blocks inside subtitle
    let maxRms = 0;
    for (const r of rmsList) {
      if (r > maxRms) maxRms = r;
    }
    const maxDb = 20 * Math.log10(maxRms + 1e-5);
    if (maxDb < -26) continue; // Too quiet / gap detector handles this

    // Check for abrupt gate drop at the end of speech
    // Look for a transition where RMS drops by > 26 dB in just 1-2 frames (< 30ms)
    let foundGateCutoff = false;
    let cutoffSec = 0;

    for (let f = rmsList.length - 4; f >= 5; f--) {
      const prevVal = rmsList[f - 1];
      const currVal = rmsList[f];
      const prevDb = 20 * Math.log10(prevVal + 1e-5);
      const currDb = 20 * Math.log10(currVal + 1e-5);

      if (prevDb > -22 && currDb < -46 && (prevDb - currDb) > 24) {
        foundGateCutoff = true;
        cutoffSec = startSec + (f * 0.015);
        break;
      }
    }

    if (foundGateCutoff) {
      const clipStart = Math.max(0, cutoffSec - 0.7);
      const clipEnd = Math.min(audioBuffer.duration, cutoffSec + 0.5);

      results.push({
        type: 'swallowed_vowel',
        trackId: track.id,
        dubberName: track.participant || 'Даббер',
        characterName: track.character || 'Персонаж',
        timestampSec: cutoffSec,
        startSec: clipStart,
        endSec: clipEnd,
        startFormatted: formatTimecode(clipStart),
        endFormatted: formatTimecode(clipEnd),
        durationSec: Number((clipEnd - clipStart).toFixed(2)),
        severity: 'medium',
        title: `Резкий срез фразы / Обрыв гейтом`,
        description: 'Программный Noise Gate или микрофонный шумоподавитель неестественно резко срезал затухание гласной/окончание слова.',
        metricDetails: `Обрыв затухания: спад >24 дБ за 15-30мс`,
        nearestSubtitleText: cleanedText,
        subId: String(line.id),
        lineIndex: idx,
        resolutionAction: 'request_dubber_fix',
        comment: `[Перезапись] Обрыв/срез окончания фразы на [${formatTimecode(cutoffSec)}]: "${cleanedText}". Отрегулируй гейт и перепиши фразу целиком.`
      });
    }
  }

  return results;
}

/**
 * Main Orchestrator for Track Artifact Scanning
 */
export function scanTrackForArtifacts(
  audioBuffer: AudioBuffer,
  track: Track,
  subLines: SubtitleLine[],
  options: ArtifactDetectionOptions = {}
): AudioArtifact[] {
  const artifacts: AudioArtifact[] = [];

  const assignedCharacters = new Set<string>();
  track.character.split(',').forEach(c => {
    if (c.trim()) assignedCharacters.add(c.trim().toLowerCase());
  });

  // 1. Clipping
  if (options.detectClipping !== false) {
    const clips = detectClippingArtifacts(audioBuffer, track);
    for (const c of clips) {
      artifacts.push({
        ...c,
        id: `artifact_clip_${track.id}_${Math.round(c.timestampSec * 100)}_${Math.random().toString(36).substr(2, 5)}`,
        selected: true
      });
    }
  }

  // 2. Clicks & Transients
  if (options.detectClicks !== false) {
    const clicks = detectClickArtifacts(audioBuffer, track);
    for (const clk of clicks) {
      artifacts.push({
        ...clk,
        id: `artifact_click_${track.id}_${Math.round(clk.timestampSec * 100)}_${Math.random().toString(36).substr(2, 5)}`,
        selected: true
      });
    }
  }

  // 3. Plosives
  if (options.detectPlosives !== false) {
    const plosives = detectPlosiveArtifacts(audioBuffer, track);
    for (const p of plosives) {
      artifacts.push({
        ...p,
        id: `artifact_plosive_${track.id}_${Math.round(p.timestampSec * 100)}_${Math.random().toString(36).substr(2, 5)}`,
        selected: true
      });
    }
  }

  // 4. Swallowed / Gate Cutoffs
  if (options.detectSwallowed !== false && subLines.length > 0) {
    const swallowed = detectSwallowedOrCutoffArtifacts(audioBuffer, track, subLines, assignedCharacters);
    for (const s of swallowed) {
      artifacts.push({
        ...s,
        id: `artifact_gate_${track.id}_${Math.round(s.timestampSec * 100)}_${Math.random().toString(36).substr(2, 5)}`,
        selected: true
      });
    }
  }

  // Match nearest subtitle line to provide dialog context for curator
  if (subLines.length > 0) {
    for (const art of artifacts) {
      if (!art.nearestSubtitleText) {
        let bestMatch: SubtitleLine | null = null;
        let minDiff = 3.5; // Within 3.5 seconds

        for (const line of subLines) {
          const charName = (line.name || '').trim().toLowerCase();
          if (!assignedCharacters.has(charName)) continue;

          if (art.timestampSec >= line.startSec - 0.5 && art.timestampSec <= line.endSec + 0.5) {
            bestMatch = line;
            break;
          }
          const diff = Math.min(Math.abs(art.timestampSec - line.startSec), Math.abs(art.timestampSec - line.endSec));
          if (diff < minDiff) {
            minDiff = diff;
            bestMatch = line;
          }
        }

        if (bestMatch) {
          const text = bestMatch.text.replace(/\{[^}]+\}/g, '').trim();
          art.nearestSubtitleText = text;
          art.subId = String(bestMatch.id);
          if (bestMatch.name) art.characterName = bestMatch.name;
        }
      }
    }
  }

  // Sort chronologically
  artifacts.sort((a, b) => a.timestampSec - b.timestampSec);
  return artifacts;
}
