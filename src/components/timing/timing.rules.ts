import { AudioClip } from './timing.types';
import {
  TIMING_RULES,
  getMaxSafeShiftSec,
  computeTargetClipStartSec,
  isPhraseTimingNotRequired,
  isIntentionalOverlapDecision,
  evaluateSoftTimeFit,
} from '../../../shared/timingRules';

export {
  TIMING_RULES,
  getMaxSafeShiftSec,
  computeTargetClipStartSec,
  isPhraseTimingNotRequired,
  isIntentionalOverlapDecision,
  evaluateSoftTimeFit,
};

export interface QuestionableTimingClipItem {
  clipId: string;
  trackId: string;
  dubberName: string;
  characterName: string;
  timeSec: number;
  text: string;
  reasons: string[];
  onsetDiffMs: number | null;
  shiftFromOrigSec: number;
  playbackRate: number;
}

export interface TimingSyncQualitySummary {
  totalDialogueClips: number;
  anchoredDialogueClips: number;
  accurateCount: number;
  accuracyPercent: number;
  timeFitCount: number;
  largeShiftCount: number;
  questionableItems: QuestionableTimingClipItem[];
}

/**
 * Подсчёт единого индикатора качества автотайминга для панели «Тайминг»:
 * - Количество и % диалоговых фраз, попавших атакой в оригинал точнее ±120 мс.
 * - Список спорных реплик (требующих быстрой проверки: Soft Time-Fit, сдвиг > 0.5 с от исходника, спешка впереди оригинала или незакрытая проблема).
 */
export function computeTimingSyncQualitySummary(
  audioClips: Record<string, AudioClip[]>
): TimingSyncQualitySummary {
  let totalDialogueClips = 0;
  let anchoredDialogueClips = 0;
  let accurateCount = 0;
  let timeFitCount = 0;
  let largeShiftCount = 0;
  const questionableItems: QuestionableTimingClipItem[] = [];

  for (const [trackId, list] of Object.entries(audioClips || {})) {
    for (const clip of list || []) {
      if (clip.isPhysics) continue;
      totalDialogueClips++;

      const curStart = clip.clipStartSec + (clip.offsetSec || 0);
      const onsetOffset = Math.min(TIMING_RULES.MAX_ONSET_PREROLL_SEC, Math.max(0, clip.speechOnsetOffsetSec || 0));
      const origSourceStart = clip.rawSourceStartSec ?? clip.sourceStartSec ?? curStart;
      const shiftFromOrigSec = Number((curStart - origSourceStart).toFixed(3));
      const absShift = Math.abs(shiftFromOrigSec);
      const playbackRate = Number((clip.playbackRate || 1.0).toFixed(3));
      const hasTimeFit = Boolean(clip.timeFitApplied) || playbackRate > 1.005;
      const hasLargeShift = absShift > TIMING_RULES.QUESTIONABLE_SHIFT_THRESHOLD_SEC;

      // Вычисляем реальное отклонение атаки голоса от эталона (вокал оригинала или саб)
      let onsetDiffSec: number | null = null;
      let signedDiffSec: number | null = null;
      if (typeof clip.refVocalStartSec === 'number') {
        signedDiffSec = (curStart + onsetOffset) - clip.refVocalStartSec;
        onsetDiffSec = Math.abs(signedDiffSec);
      } else if (typeof clip.timeDiffSec === 'number') {
        signedDiffSec = clip.timeDiffSec;
        onsetDiffSec = Math.abs(clip.timeDiffSec);
      } else if (clip.timingNotRequired) {
        signedDiffSec = 0;
        onsetDiffSec = 0;
      }

      const isRushingAhead =
        signedDiffSec !== null &&
        signedDiffSec < -(TIMING_RULES.MAX_EARLY_ATTACK_TOLERANCE_SEC + 0.01);

      if (onsetDiffSec !== null) {
        anchoredDialogueClips++;
        const maxAllowedAccuracy = clip.hasRefVocalAnchor === false
          ? TIMING_RULES.ASS_LEAD_IN_GRACE_SEC
          : TIMING_RULES.TARGET_ATTACK_ACCURACY_SEC;
        if (!isRushingAhead && onsetDiffSec <= maxAllowedAccuracy + 0.0005 && !clip.timingIssue) {
          accurateCount++;
        }
      }

      if (hasTimeFit) timeFitCount++;
      if (hasLargeShift) largeShiftCount++;

      const reasons: string[] = [];
      if (isRushingAhead && signedDiffSec !== null) {
        reasons.push(`Спешит ${Math.round(signedDiffSec * 1000)}мс`);
      }
      if (hasTimeFit) {
        reasons.push(`Time-Fit ${playbackRate.toFixed(2)}x`);
      }
      if (hasLargeShift) {
        reasons.push(`Сдвиг ${shiftFromOrigSec >= 0 ? '+' : ''}${shiftFromOrigSec.toFixed(2)}с`);
      }
      if (clip.timingIssue === 'desync' || clip.timingIssue === 'overlap' || clip.timingIssue === 'orphan') {
        reasons.push(
          clip.timingIssue === 'overlap'
            ? 'Наезд'
            : clip.timingIssue === 'orphan'
            ? 'Подтяжка Whisper'
            : 'Рассинхрон > 120мс'
        );
      }

      if (reasons.length > 0) {
        questionableItems.push({
          clipId: clip.id,
          trackId,
          dubberName: clip.dubberName,
          characterName: clip.characterName,
          timeSec: Number(curStart.toFixed(3)),
          text: clip.text || '',
          reasons,
          onsetDiffMs: onsetDiffSec !== null ? Math.round(onsetDiffSec * 1000) : null,
          shiftFromOrigSec,
          playbackRate,
        });
      }
    }
  }

  questionableItems.sort((a, b) => a.timeSec - b.timeSec);
  const denom = anchoredDialogueClips > 0 ? anchoredDialogueClips : totalDialogueClips;
  const accuracyPercent = denom > 0 ? Math.round((accurateCount / denom) * 100) : 0;

  return {
    totalDialogueClips,
    anchoredDialogueClips,
    accurateCount,
    accuracyPercent,
    timeFitCount,
    largeShiftCount,
    questionableItems,
  };
}
