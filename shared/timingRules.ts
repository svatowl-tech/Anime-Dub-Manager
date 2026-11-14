import TimingRulesConfigRaw from '../electron/lib/TimingRulesConfig.cjs';

export interface TimingRulesConstants {
  readonly TARGET_ATTACK_ACCURACY_SEC: number;
  readonly MAX_SAFE_SHIFT_WITH_VOCALS_SEC: number;
  readonly MAX_SAFE_SHIFT_WITHOUT_VOCALS_SEC: number;
  readonly QUESTIONABLE_SHIFT_THRESHOLD_SEC: number;
  readonly MIN_SAME_TRACK_GAP_SEC: number;
  readonly MIN_INTER_TRACK_GAP_SEC: number;
  readonly INTENTIONAL_OVERLAP_MIN_SEC: number;
  readonly INTENTIONAL_OVERLAP_SHORTER_RATIO: number;
  readonly INTENTIONAL_OVERLAP_ASS_TOLERANCE_SEC: number;
  readonly SOFT_TIME_FIT_OVERHANG_RATIO: number;
  readonly SOFT_TIME_FIT_MIN_RATE: number;
  readonly SOFT_TIME_FIT_APPLY_FLOOR_RATE: number;
  readonly SOFT_TIME_FIT_MAX_RATE: number;
  readonly EXEMPT_TAIL_OVERHANG_RATIO: number;
  readonly EXEMPT_TAIL_MAX_SEC: number;
  readonly MIN_EFFECTIVE_SHIFT_SEC: number;
  readonly PHYSICS_SEARCH_WINDOW_SEC: number;
  readonly PHYSICS_MIN_BURST_SEC: number;
  readonly PHYSICS_MAX_BURST_SEC: number;
  readonly INTERNAL_PAUSE_MIN_SEC: number;
  readonly INTERNAL_PAUSE_MAX_SEC: number;
  readonly INTERNAL_PAUSE_COMPRESS_TRIGGER_SEC: number;
  readonly INTERNAL_PAUSE_TARGET_SEC: number;
  readonly ORIG_VOCAL_PAUSE_MIN_SEC: number;
  readonly CROSS_ROLE_SEARCH_WINDOW_SEC: number;
  readonly CROSS_ROLE_MAX_DUR_DIFF_RATIO: number;
}

export interface PhraseTimingExemptResult {
  notRequired: boolean;
  reason?: string;
  onsetDiffSec: number;
  tailExcessSec: number;
}

export interface IntentionalOverlapCheckParams {
  overlapSec: number;
  earlyDurSec: number;
  lateDurSec: number;
  sub1?: { id?: string | number; startSec: number; endSec: number } | null;
  sub2?: { id?: string | number; startSec: number; endSec: number } | null;
  hasGlobalAssOverlap?: boolean;
}

export interface SoftTimeFitEvaluationParams {
  curStartSec: number;
  clipDurationSec: number;
  unscaledDurationSec?: number;
  anchorStartSec: number;
  anchorEndSec: number;
  speechOffsetSec?: number;
  nextPhraseCeilingSec: number;
  playbackRate?: number;
}

export interface SoftTimeFitEvaluationResult {
  hasOverhangOver25: boolean;
  collidesNext: boolean;
  refEndLimit25: number;
  tailOverhangRatio: number;
  shouldApply: boolean;
  recommendedRate: number;
}

interface TimingRulesModuleShape {
  TIMING_RULES: TimingRulesConstants;
  getMaxSafeShiftSec: (hasVocalOrWhisperConfirmation: boolean) => number;
  isPhraseTimingNotRequired: (
    clipStartSec: number,
    clipDurationSec: number,
    anchorStartSec: number,
    anchorEndSec: number,
    speechOnsetOffsetSec?: number,
    speechOffsetSec?: number
  ) => PhraseTimingExemptResult;
  isIntentionalOverlapDecision: (params: IntentionalOverlapCheckParams) => boolean;
  evaluateSoftTimeFit: (params: SoftTimeFitEvaluationParams) => SoftTimeFitEvaluationResult;
}

const TimingRulesConfig = TimingRulesConfigRaw as unknown as TimingRulesModuleShape;

export const TIMING_RULES = TimingRulesConfig.TIMING_RULES;
export const getMaxSafeShiftSec = TimingRulesConfig.getMaxSafeShiftSec;
export const isPhraseTimingNotRequired = TimingRulesConfig.isPhraseTimingNotRequired;
export const isIntentionalOverlapDecision = TimingRulesConfig.isIntentionalOverlapDecision;
export const evaluateSoftTimeFit = TimingRulesConfig.evaluateSoftTimeFit;
