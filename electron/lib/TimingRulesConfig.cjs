/**
 * Единый конфигурационный модуль стандартов и правил автотайминга Anime Dub Manager (ADM).
 * Импортируется напрямую и в главный процесс Electron (CommonJS), и в рендерер React/Vite (через Vite CJS-interop / shared facade).
 * Запрещено дублировать эти пороги в компонентах или сервисах.
 */

const TIMING_RULES = Object.freeze({
  /** Целевая точность попадания реальной атаки голоса в оригинал (±120 мс) */
  TARGET_ATTACK_ACCURACY_SEC: 0.12,

  /** Максимальный безопасный сдвиг от исходной записи при подтверждении по original_vocals.wav или Whisper (±1.25 с) */
  MAX_SAFE_SHIFT_WITH_VOCALS_SEC: 1.25,

  /** Максимальный безопасный сдвиг от исходной записи БЕЗ подтверждения вокала оригинала (±0.45 с) */
  MAX_SAFE_SHIFT_WITHOUT_VOCALS_SEC: 0.45,

  /** Порог крупного сдвига от исходника (> 0.50 с), требующего быстрой визуальной перепроверки */
  QUESTIONABLE_SHIFT_THRESHOLD_SEC: 0.50,

  /** Минимальный зазор между разными репликами на ОДНОЙ дорожке (60 мс) */
  MIN_SAME_TRACK_GAP_SEC: 0.06,

  /** Минимальный зазор при разведении случайных коллизий между РАЗНЫМИ дорожками (80 мс) */
  MIN_INTER_TRACK_GAP_SEC: 0.08,

  /** Порог абсолютного перекрытия (с), при котором наложение считается намеренным диалогом внахлёст (> 0.35 с) */
  INTENTIONAL_OVERLAP_MIN_SEC: 0.35,

  /** Порог относительного перекрытия (> 35% от длительности более короткой фразы) для признания наложения намеренным */
  INTENTIONAL_OVERLAP_SHORTER_RATIO: 0.35,

  /** Допуск при проверке одновременных/смежных реплик в .ass субтитрах */
  INTENTIONAL_OVERLAP_ASS_TOLERANCE_SEC: 0.02,

  /** Порог вылета хвоста речи сверх опоры (> 25%), при котором в сочетании с наездом включается Soft Time-Fit */
  SOFT_TIME_FIT_OVERHANG_RATIO: 0.25,

  /** Безопасный диапазон pitch-preserving ускорения (FFmpeg atempo / WebAudio playbackRate): 1.0x – 1.18x */
  SOFT_TIME_FIT_MIN_RATE: 1.0,
  SOFT_TIME_FIT_APPLY_FLOOR_RATE: 1.015,
  SOFT_TIME_FIT_MAX_RATE: 1.18,

  /** Максимально допустимый вылет хвоста для освобождения фразы от сдвига (min(25% длительности речи, 0.35 с)) */
  EXEMPT_TAIL_OVERHANG_RATIO: 0.25,
  EXEMPT_TAIL_MAX_SEC: 0.35,

  /** Порог значимого сдвига (40 мс), ниже которого микро-дрожание не применяется */
  MIN_EFFECTIVE_SHIFT_SEC: 0.04,

  /** Параметры умной синхронизации «Физики» (охи/вздохи) по ±1.0 с окну original_vocals.wav */
  PHYSICS_SEARCH_WINDOW_SEC: 1.0,
  PHYSICS_MIN_BURST_SEC: 0.12,
  PHYSICS_MAX_BURST_SEC: 2.50,

  /** Параметры адаптивной разрезки/сжатия внутренних пауз (Rule 2B) */
  INTERNAL_PAUSE_MIN_SEC: 0.20,
  INTERNAL_PAUSE_MAX_SEC: 0.55,
  INTERNAL_PAUSE_COMPRESS_TRIGGER_SEC: 0.30,
  INTERNAL_PAUSE_TARGET_SEC: 0.12,
  ORIG_VOCAL_PAUSE_MIN_SEC: 0.18,

  /** Параметры кросс-ролевого спасения пропущенных фраз (Rule 4) */
  CROSS_ROLE_SEARCH_WINDOW_SEC: 2.0,
  CROSS_ROLE_MAX_DUR_DIFF_RATIO: 0.40,
});

/**
 * Возвращает максимальный безопасный сдвиг (±1.25 с при подтверждении вокала / Whisper, ±0.45 с без него).
 * @param {boolean} hasVocalOrWhisperConfirmation
 * @returns {number}
 */
function getMaxSafeShiftSec(hasVocalOrWhisperConfirmation) {
  return hasVocalOrWhisperConfirmation
    ? TIMING_RULES.MAX_SAFE_SHIFT_WITH_VOCALS_SEC
    : TIMING_RULES.MAX_SAFE_SHIFT_WITHOUT_VOCALS_SEC;
}

/**
 * Строгая проверка, синхронна ли уже фраза с эталоном:
 * освобождается ТОЛЬКО если:
 *   a) Атака речи отклоняется <= 0.12 с (120 мс) от anchorStartSec, И
 *   b) Конец речи вылезает за anchorEndSec не более min(25% длительности речи, 0.35 с).
 */
function isPhraseTimingNotRequired(
  clipStartSec,
  clipDurationSec,
  anchorStartSec,
  anchorEndSec,
  speechOnsetOffsetSec = 0,
  speechOffsetSec
) {
  const actualSpeechStartSec = clipStartSec + (speechOnsetOffsetSec || 0);
  const onsetDiffSec = Math.abs(actualSpeechStartSec - anchorStartSec);

  const effectiveSpeechEndOffset =
    typeof speechOffsetSec === 'number' && speechOffsetSec > 0
      ? Math.min(clipDurationSec, speechOffsetSec)
      : clipDurationSec;
  const actualSpeechEndSec = clipStartSec + effectiveSpeechEndOffset;
  const phraseSpeechDurSec = Math.max(0.15, effectiveSpeechEndOffset - (speechOnsetOffsetSec || 0));
  const maxAllowedTailExcess = Math.min(
    phraseSpeechDurSec * TIMING_RULES.EXEMPT_TAIL_OVERHANG_RATIO,
    TIMING_RULES.EXEMPT_TAIL_MAX_SEC
  );
  const tailExcessSec = actualSpeechEndSec - anchorEndSec;

  if (
    onsetDiffSec <= TIMING_RULES.TARGET_ATTACK_ACCURACY_SEC &&
    tailExcessSec <= maxAllowedTailExcess
  ) {
    return {
      notRequired: true,
      onsetDiffSec,
      tailExcessSec,
      reason: `Атака голоса синхронна (${Math.round(onsetDiffSec * 1000)} мс ≤ ${Math.round(TIMING_RULES.TARGET_ATTACK_ACCURACY_SEC * 1000)} мс) и хвост в допуске — тайминг не требуется`,
    };
  }

  return {
    notRequired: false,
    onsetDiffSec,
    tailExcessSec,
  };
}

/**
 * Единое правило распознавания намеренного наложения (диалог внахлёст, не раздвигать):
 *   - пересечение реплик в .ass (с допуском 0.02 с), ИЛИ
 *   - глобальные перекрывающиеся реплики в .ass на этом отрезке, ИЛИ
 *   - перекрытие > 0.35 с, ИЛИ
 *   - перекрытие > 35% от длительности более короткой фразы.
 */
function isIntentionalOverlapDecision(params) {
  const {
    overlapSec = 0,
    earlyDurSec = 0,
    lateDurSec = 0,
    sub1 = null,
    sub2 = null,
    hasGlobalAssOverlap = false,
  } = params || {};

  if (hasGlobalAssOverlap) return true;

  if (sub1 && sub2) {
    if (sub1.id !== undefined && sub2.id !== undefined && String(sub1.id) === String(sub2.id)) {
      return true;
    }
    const subOverlap = Math.min(sub1.endSec, sub2.endSec) - Math.max(sub1.startSec, sub2.startSec);
    if (subOverlap > -TIMING_RULES.INTENTIONAL_OVERLAP_ASS_TOLERANCE_SEC) {
      return true;
    }
  }

  const minClipDur = Math.max(0.05, Math.min(earlyDurSec || 0, lateDurSec || 0));
  if (overlapSec > TIMING_RULES.INTENTIONAL_OVERLAP_MIN_SEC) return true;
  if (overlapSec > minClipDur * TIMING_RULES.INTENTIONAL_OVERLAP_SHORTER_RATIO) return true;

  return false;
}

/**
 * Единая оценка необходимости автоматического мягкого сжатия темпа (Soft Time-Fit / atempo):
 * включается при вылете хвоста > 25% И наезде на следующую фразу.
 * Безопасный диапазон ускорения: 1.0x – 1.18x.
 */
function evaluateSoftTimeFit(params) {
  const {
    curStartSec,
    clipDurationSec,
    unscaledDurationSec,
    anchorStartSec,
    anchorEndSec,
    speechOffsetSec,
    nextPhraseCeilingSec,
    playbackRate = 1.0,
  } = params || {};

  const refDur = Math.max(0.25, (anchorEndSec || curStartSec) - (anchorStartSec || curStartSec));
  const effSpeechOffset =
    typeof speechOffsetSec === 'number' && speechOffsetSec > 0
      ? Math.min(clipDurationSec, speechOffsetSec)
      : clipDurationSec;
  const activeSpeechEndSec = curStartSec + effSpeechOffset;
  const tailOverhangRatio = (activeSpeechEndSec - anchorEndSec) / refDur;
  const hasOverhangOver25 = tailOverhangRatio > TIMING_RULES.SOFT_TIME_FIT_OVERHANG_RATIO;
  const collidesNext = curStartSec + clipDurationSec > nextPhraseCeilingSec + 0.01;
  const refEndLimit25 = anchorEndSec + Math.max(0.08, refDur * TIMING_RULES.SOFT_TIME_FIT_OVERHANG_RATIO);

  let recommendedRate = 1.0;
  let shouldApply = false;
  if (hasOverhangOver25 && collidesNext && nextPhraseCeilingSec > curStartSec + 0.25) {
    const targetCeiling = Math.min(nextPhraseCeilingSec, Math.max(curStartSec + 0.25, refEndLimit25));
    const targetDur = Math.max(0.25, targetCeiling - curStartSec);
    const baseDur = Math.max(0.25, unscaledDurationSec || clipDurationSec);
    const rawDesired = baseDur / targetDur;
    const clamped = Math.min(
      TIMING_RULES.SOFT_TIME_FIT_MAX_RATE,
      Math.max(TIMING_RULES.SOFT_TIME_FIT_MIN_RATE, rawDesired)
    );
    if (clamped >= TIMING_RULES.SOFT_TIME_FIT_APPLY_FLOOR_RATE) {
      recommendedRate = Number(clamped.toFixed(3));
      shouldApply = recommendedRate > (playbackRate || 1.0) + 0.004 || rawDesired >= TIMING_RULES.SOFT_TIME_FIT_APPLY_FLOOR_RATE;
    }
  }

  return {
    hasOverhangOver25,
    collidesNext,
    refEndLimit25,
    tailOverhangRatio,
    shouldApply,
    recommendedRate,
  };
}

module.exports = {
  TIMING_RULES,
  getMaxSafeShiftSec,
  isPhraseTimingNotRequired,
  isIntentionalOverlapDecision,
  evaluateSoftTimeFit,
};
