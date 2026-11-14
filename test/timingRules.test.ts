import { describe, it, expect } from 'vitest';
import TimingRulesCjs from '../electron/lib/TimingRulesConfig.cjs';
import {
  TIMING_RULES,
  getMaxSafeShiftSec,
  isPhraseTimingNotRequired,
  isIntentionalOverlapDecision,
  evaluateSoftTimeFit,
} from '../shared/timingRules';
import { computeTimingSyncQualitySummary } from '../src/components/timing/timing.rules';
import type { AudioClip } from '../src/components/timing/timing.types';

describe('Unified Studio Auto-Timing Rules', () => {
  it('shares identical studio-standard thresholds across Electron CJS and React ESM', () => {
    expect(TIMING_RULES).toEqual(TimingRulesCjs.TIMING_RULES);
    expect(TIMING_RULES.TARGET_ATTACK_ACCURACY_SEC).toBe(0.12);
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

  it('enforces ±0.12s (120 ms) vocal attack exemption threshold', () => {
    const ok = isPhraseTimingNotRequired(9.90, 1.5, 10.0, 11.4, 0.15, 1.35);
    expect(ok.notRequired).toBe(true);
    expect(ok.onsetDiffSec).toBeCloseTo(0.05, 3);

    const desynced = isPhraseTimingNotRequired(9.90, 1.5, 10.0, 11.4, 0.25, 1.35);
    expect(desynced.notRequired).toBe(false);
    expect(desynced.onsetDiffSec).toBeCloseTo(0.15, 3);
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

  it('computes sync quality indicator summary and sorts questionable clips chronologically', () => {
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
