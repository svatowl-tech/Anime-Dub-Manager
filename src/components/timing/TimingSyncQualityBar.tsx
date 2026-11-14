import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Crosshair,
} from 'lucide-react';
import { AudioClip } from './timing.types';
import { formatSeconds } from './timing.utils';
import {
  TIMING_RULES,
  QuestionableTimingClipItem,
  computeTimingSyncQualitySummary,
} from './timing.rules';

export interface TimingSyncQualityBarProps {
  audioClips: Record<string, AudioClip[]>;
  onJumpToQuestionableClip: (item: QuestionableTimingClipItem) => void;
}

export const TimingSyncQualityBar: React.FC<TimingSyncQualityBarProps> = ({
  audioClips,
  onJumpToQuestionableClip,
}) => {
  const summary = useMemo(() => computeTimingSyncQualitySummary(audioClips), [audioClips]);
  const [cursorIndex, setCursorIndex] = useState<number>(-1);

  if (summary.totalDialogueClips === 0) return null;

  const qList = summary.questionableItems;
  const qCount = qList.length;
  const safeCursor = qCount > 0 && cursorIndex >= 0 ? cursorIndex % qCount : -1;
  const activeItem = safeCursor >= 0 ? qList[safeCursor] : qCount > 0 ? qList[0] : null;

  const handleNavigate = (delta: 1 | -1) => {
    if (qCount === 0) return;
    let nextIdx: number;
    if (cursorIndex < 0) {
      nextIdx = delta === 1 ? 0 : qCount - 1;
    } else {
      nextIdx = (cursorIndex + delta + qCount) % qCount;
    }
    setCursorIndex(nextIdx);
    onJumpToQuestionableClip(qList[nextIdx]);
  };

  const denom = summary.anchoredDialogueClips > 0
    ? summary.anchoredDialogueClips
    : summary.totalDialogueClips;

  const isGoodAccuracy = summary.accuracyPercent >= 80;
  const attackMs = Math.round(TIMING_RULES.TARGET_ATTACK_ACCURACY_SEC * 1000);

  return (
    <div className="bg-[#090c14] border-b border-neutral-800/90 px-4 py-1 flex items-center justify-between gap-3 text-[11px] shrink-0 select-none">
      <div className="flex items-center gap-2.5 min-w-0 overflow-x-auto py-0.5 scrollbar-thin">
        {/* Зелёный индикатор попадания атаки голоса в ±120 мс */}
        <div
          className={`px-2.5 py-0.5 rounded-md border inline-flex items-center gap-1.5 shrink-0 font-mono tabular-nums ${
            isGoodAccuracy
              ? 'bg-emerald-950/50 border-emerald-700/50 text-emerald-300'
              : 'bg-sky-950/50 border-sky-700/50 text-sky-300'
          }`}
          title={`Единый студийный стандарт: точность атаки ±${attackMs} мс | зазоры ${Math.round(TIMING_RULES.MIN_SAME_TRACK_GAP_SEC * 1000)}/${Math.round(TIMING_RULES.MIN_INTER_TRACK_GAP_SEC * 1000)} мс | сдвиг ±${TIMING_RULES.MAX_SAFE_SHIFT_WITH_VOCALS_SEC}с / ±${TIMING_RULES.MAX_SAFE_SHIFT_WITHOUT_VOCALS_SEC}с | atempo ${TIMING_RULES.SOFT_TIME_FIT_MIN_RATE}–${TIMING_RULES.SOFT_TIME_FIT_MAX_RATE}x`}
        >
          <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${isGoodAccuracy ? 'text-emerald-400' : 'text-sky-400'}`} />
          <span className="font-sans font-semibold text-neutral-200">
            Точно (&lt;{attackMs} мс):
          </span>
          <strong className="text-white">{summary.accurateCount}/{denom}</strong>
          <span className={`font-bold ${isGoodAccuracy ? 'text-emerald-400' : 'text-sky-400'}`}>
            ({summary.accuracyPercent}%)
          </span>
        </div>

        {/* Жёлтый индикатор спорных реплик (Soft Time-Fit, сдвиг > 0.5с, незакрытые проблемы) */}
        {qCount > 0 ? (
          <div
            className="px-2.5 py-0.5 rounded-md border bg-amber-950/45 border-amber-700/50 text-amber-200 inline-flex items-center gap-1.5 shrink-0 font-mono tabular-nums"
            title={`Реплики, требующие быстрой проверки: Soft Time-Fit (${summary.timeFitCount}), сдвиг от исходника > ${TIMING_RULES.QUESTIONABLE_SHIFT_THRESHOLD_SEC}с (${summary.largeShiftCount}) или рассинхрон/наезд`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="font-sans font-semibold">Спорных:</span>
            <strong className="text-amber-300">{qCount}</strong>
            {(summary.timeFitCount > 0 || summary.largeShiftCount > 0) && (
              <span className="text-[10px] text-amber-300/80 hidden sm:inline">
                ({[
                  summary.timeFitCount > 0 ? `Time-Fit: ${summary.timeFitCount}` : null,
                  summary.largeShiftCount > 0 ? `Сдвиг >${TIMING_RULES.QUESTIONABLE_SHIFT_THRESHOLD_SEC}с: ${summary.largeShiftCount}` : null,
                ].filter(Boolean).join(' • ')})
              </span>
            )}
          </div>
        ) : (
          <div className="px-2.5 py-0.5 rounded-md border bg-emerald-950/30 border-emerald-900/50 text-emerald-300/90 inline-flex items-center gap-1.5 shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="font-semibold">Спорных реплик нет</span>
          </div>
        )}
      </div>

      {/* Быстрая навигация по спорным репликам */}
      {qCount > 0 && activeItem && (
        <div className="flex items-center gap-2 shrink-0 min-w-0">
          <div
            className="hidden lg:flex items-center gap-1.5 max-w-[340px] px-2 py-0.5 rounded bg-neutral-900/90 border border-neutral-800 text-[10px] text-neutral-300 truncate"
            title={`${activeItem.dubberName} (${activeItem.characterName}) [${formatSeconds(activeItem.timeSec)}]: ${activeItem.reasons.join(', ')} — «${activeItem.text}»`}
          >
            <span className="font-mono text-amber-300 shrink-0">[{formatSeconds(activeItem.timeSec)}]</span>
            <span className="font-semibold text-white truncate max-w-[95px]">{activeItem.dubberName}</span>
            <span className="text-amber-400/90 truncate">{activeItem.reasons.join(' • ')}</span>
          </div>

          <div className="inline-flex items-center rounded-md border border-amber-500/40 bg-amber-600/20 overflow-hidden shadow-sm">
            <button
              type="button"
              onClick={() => handleNavigate(-1)}
              className="px-1.5 py-1 hover:bg-amber-600/35 text-amber-200 transition border-r border-amber-500/30"
              title="Предыдущая спорная реплика"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleNavigate(1)}
              className="px-2.5 py-1 hover:bg-amber-600/35 text-amber-100 font-bold inline-flex items-center gap-1.5 transition"
              title="Последовательный переход по спорным репликам (Soft Time-Fit, сдвиг > 0.5с, рассинхрон)"
            >
              <Crosshair className="w-3 h-3 text-amber-300 shrink-0" />
              <span>Следующая спорная</span>
              <span className="font-mono tabular-nums text-[10px] text-amber-300">
                ({safeCursor >= 0 ? safeCursor + 1 : 0}/{qCount})
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
