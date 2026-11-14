import { describe, it, expect } from 'vitest';
import TimingRulesCjs from '../electron/lib/TimingRulesConfig.cjs';
import {
  TIMING_RULES,
  getMaxSafeShiftSec,
  computeTargetClipStartSec,
  isPhraseTimingNotRequired,
  isIntentionalOverlapDecision,
  evaluateSoftTimeFit,
} from '../shared/timingRules';
import { computeTimingSyncQualitySummary } from '../src/components/timing/timing.rules';
import {
  detectClipSpeechBounds,
  findOriginalVocalsAnchorForSub,
} from '../src/components/timing/timing.dsp';
import {
  enforceSameTrackMinGapService,
  separateOverlappingClipPairService,
} from '../src/components/timing/timing.service';
import type { AudioClip } from '../src/components/timing/timing.types';

describe('Unified Studio Auto-Timing Rules', () => {
  it('shares identical studio-standard thresholds across Electron CJS and React ESM', () => {
    expect(TIMING_RULES).toEqual(TimingRulesCjs.TIMING_RULES);
    expect(TIMING_RULES.TARGET_ATTACK_ACCURACY_SEC).toBe(0.12);
    expect(TIMING_RULES.MAX_EARLY_ATTACK_TOLERANCE_SEC).toBe(0.05);
    expect(TIMING_RULES.ASS_LEAD_IN_GRACE_SEC).toBe(0.30);
    expect(TIMING_RULES.ASS_NATURAL_VOICE_LAG_SEC).toBe(0.10);
    expect(TIMING_RULES.MAX_ONSET_PREROLL_SEC).toBe(0.18);
    expect(TIMING_RULES.VOCALS_ANCHOR_PRE_SUB_MAX_SEC).toBe(0.06);
    expect(TIMING_RULES.MAX_SAFE_SHIFT_WITH_VOCALS_SEC).toBe(1.25);
    expect(TIMING_RULES.MAX_SAFE_SHIFT_WITHOUT_VOCALS_SEC).toBe(0.45);
    expect(TIMING_RULES.MIN_SAME_TRACK_GAP_SEC).toBe(0.06);
    expect(TIMING_RULES.MIN_INTER_TRACK_GAP_SEC).toBe(0.08);
    expect(TIMING_RULES.INTENTIONAL_OVERLAP_MIN_SEC).toBe(0.35);
    expect(TIMING_RULES.INTENTIONAL_OVERLAP_SHORTER_RATIO).toBe(0.35);
    expect(TIMING_RULES.SOFT_TIME_FIT_OVERHANG_RATIO).toBe(0.25);
    expect(TIMING_RULES.SOFT_TIME_FIT_MIN_RATE).toBe(1.0);
    expect(TIMING_RULES.SOFT_TIME_FIT_MAX_RATE).toBe(1.18);
  });

  it('computes max safe shift depending on vocal/Whisper confirmation', () => {
    expect(getMaxSafeShiftSec(true)).toBe(1.25);
    expect(getMaxSafeShiftSec(false)).toBe(0.45);
  });

  it('enforces asymmetric anti-rush attack accuracy (+120ms late, -50ms early with vocal anchor)', () => {
    // Slightly late (+50ms): notRequired = true
    const ok = isPhraseTimingNotRequired(9.90, 1.5, 10.0, 11.4, 0.15, 1.35, true);
    expect(ok.notRequired).toBe(true);
    expect(ok.onsetDiffSec).toBeCloseTo(0.05, 3);

    // Rushing ahead by -80ms: MUST be corrected (notRequired = false)
    const rushing = isPhraseTimingNotRequired(9.77, 1.5, 10.0, 11.4, 0.15, 1.35, true);
    expect(rushing.notRequired).toBe(false);
    expect(rushing.signedOnsetDiffSec).toBeCloseTo(-0.08, 3);

    // Late by +150ms: MUST be corrected
    const desynced = isPhraseTimingNotRequired(10.00, 1.5, 10.0, 11.4, 0.15, 1.35, true);
    expect(desynced.notRequired).toBe(false);
    expect(desynced.onsetDiffSec).toBeCloseTo(0.15, 3);
  });

  it('respects .ass visual lead-in grace (+300ms) when aligning without original_vocals.wav so dubber is not pulled ahead of Japanese speech', () => {
    // Dubber recorded at +220ms after .ass sub.startSec (because Japanese seiyuu speaks 200ms after visual subtitle start)
    const naturalAssTake = isPhraseTimingNotRequired(10.12, 1.5, 10.0, 12.0, 0.10, 1.4, false);
    expect(naturalAssTake.notRequired).toBe(true);

    // computeTargetClipStartSec keeps natural recording inside [sub.startSec - 0.03s .. sub.startSec + 0.30s] untouched
    const targetStart = computeTargetClipStartSec({
      anchorStartSec: 10.0,
      hasRefVocal: false,
      onsetOffsetSec: 0.10,
      currentStartSec: 10.12,
    });
    expect(targetStart).toBeCloseTo(10.12, 3);

    // Truly late take (+500ms after sub.startSec) is pulled to sub.startSec + ASS_NATURAL_VOICE_LAG_SEC (10.10), not 10.00
    const lateTargetStart = computeTargetClipStartSec({
      anchorStartSec: 10.0,
      hasRefVocal: false,
      onsetOffsetSec: 0.10,
      currentStartSec: 10.45,
    });
    expect(lateTargetStart).toBeCloseTo(10.0, 3); // 10.0 + 0.10 lag - 0.10 onset = 10.0
  });

  const makeMockAudioBufferFrom10msFrames = (frameAmps: number[], sampleRate = 8000): AudioBuffer => {
    const winSamples = Math.floor(sampleRate * 0.01); // 80 samples per 10ms frame
    const data = new Float32Array(frameAmps.length * winSamples);
    for (let f = 0; f < frameAmps.length; f++) {
      const amp = frameAmps[f];
      const base = f * winSamples;
      for (let i = 0; i < winSamples; i++) {
        data[base + i] = amp;
      }
    }
    return {
      sampleRate,
      numberOfChannels: 1,
      length: data.length,
      duration: data.length / sampleRate,
      getChannelData: () => data,
    } as unknown as AudioBuffer;
  };

  it('captures quiet Russian initial consonants in detectClipSpeechBounds via backward word-edge walk', () => {
    // 100 frames (1.0s at 10ms/frame):
    // frames 0..3: room noise (-60 dBFS -> 0.001)
    // frames 4..18 (40ms..180ms): quiet Russian initial consonant/unstressed syllable (-34 dBFS -> 0.02)
    // frames 19..60 (190ms..600ms): loud stressed vowel (-6 dBFS -> 0.5)
    // frames 61..99: room noise (0.001)
    const peaks = new Array(100).fill(0.001);
    for (let i = 4; i <= 18; i++) peaks[i] = 0.02;
    for (let i = 19; i <= 60; i++) peaks[i] = 0.5;

    const mockBuf = makeMockAudioBufferFrom10msFrames(peaks);
    const bounds = detectClipSpeechBounds(mockBuf, 0, 1.0, -55);
    // Without backward word-edge walk, onset would be 0.19s (skipping 150ms of consonant and pushing clip 150ms early).
    // With backward word-edge walk, onset is at the true consonant edge (~0.04s).
    expect(bounds.onsetOffsetSec).toBeGreaterThanOrEqual(0.03);
    expect(bounds.onsetOffsetSec).toBeLessThanOrEqual(0.06);
  });

  it('ignores pre-subtitle vocal tails/breaths in findOriginalVocalsAnchorForSub', () => {
    // 400 frames = 4.0s at 10ms/frame. Subtitle is [1.00s .. 2.50s] (frames 100..250).
    // Suppose previous character's tail is at 0.65s..0.85s (frames 65..85) -> 350ms before subStartSec.
    // Suppose a short 50ms breath is at 0.96s..1.00s (frames 96..100), followed by 60ms silence,
    // and main Japanese speech starts at 1.07s..2.20s (frames 107..220).
    const vocalsPeaks = new Array(400).fill(0.001);
    for (let i = 65; i <= 85; i++) vocalsPeaks[i] = 0.35; // previous line tail
    for (let i = 96; i <= 100; i++) vocalsPeaks[i] = 0.08; // short pre-speech breath
    for (let i = 107; i <= 220; i++) vocalsPeaks[i] = 0.45; // actual Japanese voice

    const mockVocalsBuf = makeMockAudioBufferFrom10msFrames(vocalsPeaks);
    const anchor = findOriginalVocalsAnchorForSub(mockVocalsBuf, 1.0, 2.5, -50);
    expect(anchor.hasRefVocal).toBe(true);
    // Must lock onto the main Japanese voice at ~1.07s, NOT 0.65s or 0.96s!
    expect(anchor.anchorStartSec).toBeGreaterThanOrEqual(1.05);
    expect(anchor.anchorStartSec).toBeLessThanOrEqual(1.10);
  });

  it('never pulls an earlier clip left of its Japanese anchor when resolving same-track or inter-track overlaps', () => {
    const baseClip: Omit<AudioClip, 'id' | 'clipStartSec' | 'durationSec' | 'sourceStartSec' | 'sourceEndSec'> = {
      trackId: 'tr1',
      dubberName: 'ActorA',
      characterName: 'Hero',
      volumePercent: 100,
      isFix: false,
      hasCollision: false,
      offsetSec: 0,
      text: 'Тестовая реплика',
    };

    const c1: AudioClip = {
      ...baseClip,
      id: 'c1',
      clipStartSec: 10.0,
      durationSec: 1.5,
      sourceStartSec: 10.0,
      sourceEndSec: 11.5,
      refVocalStartSec: 10.0,
      speechOnsetOffsetSec: 0,
    };
    const c2: AudioClip = {
      ...baseClip,
      id: 'c2',
      clipStartSec: 11.35, // overlaps c1 tail by 150ms
      durationSec: 1.2,
      sourceStartSec: 11.35,
      sourceEndSec: 12.55,
      refVocalStartSec: 11.45,
      speechOnsetOffsetSec: 0,
    };

    const sameTrackRes = enforceSameTrackMinGapService([c1, c2]);
    // c1 must NOT be pulled earlier than 10.0s!
    expect(sameTrackRes[0].clipStartSec).toBeGreaterThanOrEqual(10.0);
    expect(sameTrackRes[1].clipStartSec).toBeGreaterThanOrEqual(
      sameTrackRes[0].clipStartSec + sameTrackRes[0].durationSec + TIMING_RULES.MIN_SAME_TRACK_GAP_SEC - 1e-4
    );

    const interC1: AudioClip = { ...c1 };
    const interC2: AudioClip = { ...c2, trackId: 'tr2' };
    separateOverlappingClipPairService({
      earlyClip: interC1,
      lateClip: interC2,
      earlyTrackClips: [interC1],
      lateTrackClips: [interC2],
      trackSubLinesMap: {},
      subtitles: [],
    });
    expect(interC1.clipStartSec).toBeGreaterThanOrEqual(10.0);
  });

  it('recognizes intentional overlaps (>0.35s, >35% shorter phrase, or .ass overlap)', () => {
    expect(
      isIntentionalOverlapDecision({
        overlapSec: 0.36,
        earlyDurSec: 2.0,
        lateDurSec: 2.0,
      })
    ).toBe(true);

    expect(
      isIntentionalOverlapDecision({
        overlapSec: 0.30,
        earlyDurSec: 2.0,
        lateDurSec: 0.80,
      })
    ).toBe(true);

    expect(
      isIntentionalOverlapDecision({
        overlapSec: 0.15,
        earlyDurSec: 2.0,
        lateDurSec: 2.0,
        sub1: { startSec: 10, endSec: 12 },
        sub2: { startSec: 11.5, endSec: 13.5 },
      })
    ).toBe(true);

    expect(
      isIntentionalOverlapDecision({
        overlapSec: 0.18,
        earlyDurSec: 2.0,
        lateDurSec: 2.0,
        sub1: { startSec: 10, endSec: 12 },
        sub2: { startSec: 12.1, endSec: 14 },
      })
    ).toBe(false);
  });

  it('triggers Soft Time-Fit (1.0x–1.18x) only when overhang > 25% AND collides with next phrase', () => {
    const shouldCompress = evaluateSoftTimeFit({
      curStartSec: 10.0,
      clipDurationSec: 2.8,
      unscaledDurationSec: 2.8,
      anchorStartSec: 10.0,
      anchorEndSec: 11.8,
      speechOffsetSec: 2.75,
      nextPhraseCeilingSec: 12.5,
      playbackRate: 1.0,
    });
    expect(shouldCompress.hasOverhangOver25).toBe(true);
    expect(shouldCompress.collidesNext).toBe(true);
    expect(shouldCompress.shouldApply).toBe(true);
    expect(shouldCompress.recommendedRate).toBeGreaterThanOrEqual(1.015);
    expect(shouldCompress.recommendedRate).toBeLessThanOrEqual(1.18);

    const noCollision = evaluateSoftTimeFit({
      curStartSec: 10.0,
      clipDurationSec: 2.8,
      unscaledDurationSec: 2.8,
      anchorStartSec: 10.0,
      anchorEndSec: 11.8,
      speechOffsetSec: 2.75,
      nextPhraseCeilingSec: 15.0,
      playbackRate: 1.0,
    });
    expect(noCollision.shouldApply).toBe(false);
  });

  it('computes sync quality indicator summary and flags rushing or heavily shifted clips', () => {
    const baseClip = {
      trackId: 'tr1',
      dubberName: 'ActorA',
      characterName: 'Hero',
      volumePercent: 100,
      isFix: false,
      hasCollision: false,
      offsetSec: 0,
    };

    const clips: Record<string, AudioClip[]> = {
      tr1: [
        {
          ...baseClip,
          id: 'c1',
          clipStartSec: 9.85,
          durationSec: 1.5,
          sourceStartSec: 9.88,
          sourceEndSec: 11.38,
          rawSourceStartSec: 9.88,
          speechOnsetOffsetSec: 0.15,
          refVocalStartSec: 10.0,
          text: 'Точная реплика',
        },
        {
          ...baseClip,
          id: 'c2',
          clipStartSec: 20.0,
          durationSec: 2.2,
          sourceStartSec: 20.75,
          sourceEndSec: 23.2,
          rawSourceStartSec: 20.75,
          speechOnsetOffsetSec: 0.1,
          refVocalStartSec: 20.1,
          playbackRate: 1.12,
          timeFitApplied: true,
          text: 'Длинная фраза',
        },
        {
          ...baseClip,
          id: 'c3_phys',
          clipStartSec: 15.0,
          durationSec: 0.6,
          sourceStartSec: 15.0,
          sourceEndSec: 15.6,
          isPhysics: true,
          text: '⚡ Физика',
        },
      ],
    };

    const summary = computeTimingSyncQualitySummary(clips);
    expect(summary.totalDialogueClips).toBe(2);
    expect(summary.accurateCount).toBe(2);
    expect(summary.accuracyPercent).toBe(100);
    expect(summary.timeFitCount).toBe(1);
    expect(summary.largeShiftCount).toBe(1);
    expect(summary.questionableItems).toHaveLength(1);
    expect(summary.questionableItems[0].clipId).toBe('c2');
    expect(summary.questionableItems[0].reasons).toContain('Time-Fit 1.12x');
  });
});

