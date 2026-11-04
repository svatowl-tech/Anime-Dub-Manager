import React from "react";
import {
  Scissors,
  Sliders,
  Headphones,
  Zap,
  ArrowRightLeft,
  FileText,
  Play,
  Pause,
  Volume2,
  Check
} from "lucide-react";
import { MissingLineDetection, DefectResolution } from "../../../lib/qa/missingLinesDetector";

export interface MissingLinesCollisionSectionProps {
  gap: MissingLineDetection;
  category: string;
  isPlayingMix: boolean;
  isPlayingPrimary: boolean;
  isPlayingSecondary: boolean;
  isPlayingOriginal: boolean;
  handlePlaySnippet: (
    gap: MissingLineDetection,
    target: "primary" | "secondary" | "original" | "mix",
    loop?: boolean
  ) => void;
  onSeekMainPlayer?: (timeSec: number) => void;
  handleResolutionChange: (id: string, resolution: DefectResolution, characterForSub?: string) => void;
}

export const MissingLinesCollisionSection: React.FC<MissingLinesCollisionSectionProps> = ({
  gap,
  category,
  isPlayingMix,
  isPlayingPrimary,
  isPlayingSecondary,
  isPlayingOriginal,
  handlePlaySnippet,
  onSeekMainPlayer,
  handleResolutionChange
}) => {
  if (category !== 'actor_collision' && category !== 'actor_overlap') {
    return null;
  }

  return (
    <>
      {/* CATEGORY 3: ACTOR COLLISION */}
      {category === 'actor_collision' && (
        <div className="space-y-3">
          <div className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-3 space-y-2">
            <div className="text-xs font-bold text-white flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-amber-300">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                Параллельная озвучка одной и той же реплики двух дабберов:
              </span>
              <span className="text-[10px] text-neutral-400 font-mono">
                Разбег: {gap.dynamicRangeDb} дБ vs {gap.secondDynamicRangeDb ?? 0} дБ
              </span>
            </div>

            <div className="bg-black/40 border border-neutral-800 rounded-lg p-2.5 text-xs text-neutral-200">
              <span className="text-neutral-500 font-semibold mr-1.5">Текст спорного субтитра:</span>
              <span className="font-medium text-amber-200/90 italic">"{gap.text}"</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {/* Actor 1 */}
              <div className="p-3 bg-neutral-900/80 rounded-xl border border-neutral-800 flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>🎙 {gap.dubberName}</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">
                      {gap.characterName}
                    </span>
                  </div>
                  <div className="text-[10px] text-neutral-400 font-mono mt-0.5">
                    Пик: {gap.peakDb} дБ, Разбег: {gap.dynamicRangeDb} дБ
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handlePlaySnippet(gap, 'primary')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1 border ${
                    isPlayingPrimary
                      ? 'bg-amber-500 text-black border-amber-400 font-bold animate-pulse'
                      : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
                  }`}
                >
                  {isPlayingPrimary ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
                  <span>{isPlayingPrimary ? 'Стоп' : 'Слушать'}</span>
                </button>
              </div>

              {/* Actor 2 */}
              <div className="p-3 bg-neutral-900/80 rounded-xl border border-neutral-800 flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>🎙 {gap.secondDubberName}</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">
                      {gap.secondCharacterName}
                    </span>
                  </div>
                  <div className="text-[10px] text-neutral-400 font-mono mt-0.5">
                    Пик: {gap.secondPeakDb ?? 0} дБ, Разбег: {gap.secondDynamicRangeDb ?? 0} дБ
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handlePlaySnippet(gap, 'secondary')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1 border ${
                    isPlayingSecondary
                      ? 'bg-amber-500 text-black border-amber-400 font-bold animate-pulse'
                      : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
                  }`}
                >
                  {isPlayingSecondary ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
                  <span>{isPlayingSecondary ? 'Стоп' : 'Слушать'}</span>
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handlePlaySnippet(gap, 'original')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                  isPlayingOriginal
                    ? 'bg-blue-600 text-white border-blue-500 font-bold animate-pulse'
                    : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
                }`}
              >
                {isPlayingOriginal ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Volume2 className="w-3.5 h-3.5 text-blue-400" />}
                <span>{isPlayingOriginal ? 'Стоп' : 'Слушать оригинал (японский звук)'}</span>
              </button>

              <button
                type="button"
                onClick={() => onSeekMainPlayer?.(gap.startSec)}
                className="px-2.5 py-1 rounded-lg text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 flex items-center gap-1"
              >
                ⏱ В видеоплеере (увидеть кадр)
              </button>
            </div>

            {/* Conflict Resolution Choices */}
            <div className="bg-neutral-900/95 border border-neutral-700/80 rounded-xl p-3 space-y-2.5">
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-blue-400" />
                <span>Решение конфликта куратором:</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                <div className={`p-2.5 rounded-lg border transition-all ${
                  gap.resolutionAction === 'fix_subs' 
                    ? 'bg-blue-950/40 border-blue-500/60' 
                    : 'bg-neutral-950/30 border-neutral-800'
                }`}>
                  <div className="flex items-center gap-1.5 font-bold text-xs text-white mb-1.5">
                    <FileText className="w-3.5 h-3.5 text-blue-400" />
                    <span>Ошибка росписи сабов (авто-исправление)</span>
                  </div>
                  <p className="text-[11px] text-neutral-400 mb-2">
                    Скорректировать имя персонажа в строке субтитров:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleResolutionChange(gap.id, 'fix_subs', gap.characterName)}
                      className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
                        gap.resolutionAction === 'fix_subs' && gap.selectedCharacterForSub === gap.characterName
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                      }`}
                    >
                      Переписать на {gap.characterName}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResolutionChange(gap.id, 'fix_subs', gap.secondCharacterName)}
                      className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
                        gap.resolutionAction === 'fix_subs' && gap.selectedCharacterForSub === gap.secondCharacterName
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                      }`}
                    >
                      Переписать на {gap.secondCharacterName}
                    </button>
                  </div>
                </div>

                <div className={`p-2.5 rounded-lg border transition-all ${
                  (gap.resolutionAction === 'keep_first' || gap.resolutionAction === 'keep_second') 
                    ? 'bg-amber-950/40 border-amber-500/60' 
                    : 'bg-neutral-950/30 border-neutral-800'
                }`}>
                  <div className="flex items-center gap-1.5 font-bold text-xs text-white mb-1.5">
                    <Scissors className="w-3.5 h-3.5 text-amber-400" />
                    <span>Выбор даббера (второго убрать до тишины)</span>
                  </div>
                  <p className="text-[11px] text-neutral-400 mb-2">
                    Оставить нужного, а дубль второго вырезать строго до тишины (без обрезки хвостов):
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleResolutionChange(gap.id, 'keep_first')}
                      className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
                        gap.resolutionAction === 'keep_first'
                          ? 'bg-amber-500 text-neutral-950 shadow-sm'
                          : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                      }`}
                      title={`Оставить ${gap.dubberName}, а реплику у ${gap.secondDubberName} вырезать целиком до тишины`}
                    >
                      Оставить {gap.dubberName}, убрать {gap.secondDubberName}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResolutionChange(gap.id, 'keep_second')}
                      className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
                        gap.resolutionAction === 'keep_second'
                          ? 'bg-amber-500 text-neutral-950 shadow-sm'
                          : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                      }`}
                      title={`Оставить ${gap.secondDubberName}, а реплику у ${gap.dubberName} вырезать целиком до тишины`}
                    >
                      Оставить {gap.secondDubberName}, убрать {gap.dubberName}
                    </button>
                  </div>
                </div>

                <div className={`p-2.5 rounded-lg border transition-all md:col-span-2 ${
                  (gap.resolutionAction === 'transfer_second_to_first' || gap.resolutionAction === 'transfer_first_to_second') 
                    ? 'bg-emerald-950/40 border-emerald-500/60' 
                    : 'bg-neutral-950/30 border-neutral-800'
                }`}>
                  <div className="flex items-center gap-1.5 font-bold text-xs text-white mb-1.5">
                    <ArrowRightLeft className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Перенос реплики целиком между дорожками (до естественной тишины)</span>
                  </div>
                  <p className="text-[11px] text-neutral-400 mb-2">
                    Полностью вырезает фразу из дорожки-источника до естественной тишины и вставляет целиком с хвостами в целевую дорожку:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleResolutionChange(gap.id, 'transfer_second_to_first')}
                      className={`px-3 py-1 rounded text-[11px] font-bold transition-all flex items-center gap-1.5 ${
                        gap.resolutionAction === 'transfer_second_to_first'
                          ? 'bg-emerald-500 text-neutral-950 shadow-sm'
                          : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                      }`}
                    >
                      Взять у {gap.secondDubberName} ➔ перенести в дорожку {gap.dubberName}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResolutionChange(gap.id, 'transfer_first_to_second')}
                      className={`px-3 py-1 rounded text-[11px] font-bold transition-all flex items-center gap-1.5 ${
                        gap.resolutionAction === 'transfer_first_to_second'
                          ? 'bg-emerald-500 text-neutral-950 shadow-sm'
                          : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                      }`}
                    >
                      Взять у {gap.dubberName} ➔ перенести в дорожку {gap.secondDubberName}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CATEGORY 4: ACTOR OVERLAP */}
      {category === 'actor_overlap' && (
        <div className="space-y-3">
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-orange-400 shrink-0" />
                <span className="text-xs text-orange-200 font-medium">
                  Хвост фразы <strong>{gap.dubberName}</strong> залезает на реплику <strong>{gap.secondDubberName}</strong> на <strong>~{gap.overlapSec || 0.2}с</strong>
                </span>
              </div>
              {gap.isTimingTooLongMerged && (
                <p className="text-[11px] text-purple-300/90 pl-6">
                  ⚠️ Объединено в один фикс: фраза дабера длиннее субтитра на <strong>+{gap.timingDeltaPercent}%</strong> и залезает на соседний саб.
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {gap.isTimingTooLongMerged && (
                <span className="text-[11px] px-2 py-0.5 rounded bg-purple-950/80 text-purple-300 font-mono shrink-0 border border-purple-800/40">
                  +{gap.timingDeltaPercent}%
                </span>
              )}
              <span className="text-[11px] px-2 py-0.5 rounded bg-orange-950/80 text-orange-300 font-mono shrink-0 border border-orange-800/40">
                Наезд: ~{gap.overlapSec || 0.2}с
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <div className="bg-neutral-950/50 border border-neutral-800 rounded-xl p-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-amber-300">1. {gap.dubberName}</span>
                <span className="text-[11px] text-neutral-400">({gap.characterName})</span>
              </div>
              <p className="text-xs text-neutral-300 italic font-medium bg-neutral-900/60 p-2 rounded border border-neutral-800/60">
                «{gap.text || '...' }»
              </p>
            </div>

            <div className="bg-neutral-950/50 border border-neutral-800 rounded-xl p-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-orange-300">2. {gap.secondDubberName}</span>
                <span className="text-[11px] text-neutral-400">({gap.secondCharacterName})</span>
              </div>
              <p className="text-xs text-neutral-300 italic font-medium bg-neutral-900/60 p-2 rounded border border-neutral-800/60">
                «{gap.secondText || '...' }»
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => handlePlaySnippet(gap, 'mix')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border shadow-sm ${
                isPlayingMix
                  ? 'bg-orange-500 text-neutral-950 border-orange-400 animate-pulse'
                  : 'bg-orange-500/20 text-orange-300 hover:bg-orange-500/30 border-orange-500/40'
              }`}
            >
              {isPlayingMix ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Headphones className="w-3.5 h-3.5 text-orange-400" />}
              <span>{isPlayingMix ? 'Остановить стык' : '🎧 Слушать стык (Оба дабера)'}</span>
            </button>

            <button
              type="button"
              onClick={() => handlePlaySnippet(gap, 'primary')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                isPlayingPrimary
                  ? 'bg-amber-500 text-neutral-950 border-amber-400 font-bold animate-pulse'
                  : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
              }`}
            >
              {isPlayingPrimary ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 text-amber-400" />}
              <span>{gap.dubberName}</span>
            </button>

            <button
              type="button"
              onClick={() => handlePlaySnippet(gap, 'secondary')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                isPlayingSecondary
                  ? 'bg-orange-500 text-neutral-950 border-orange-400 font-bold animate-pulse'
                  : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
              }`}
            >
              {isPlayingSecondary ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 text-orange-400" />}
              <span>{gap.secondDubberName}</span>
            </button>

            <button
              type="button"
              onClick={() => handlePlaySnippet(gap, 'original')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                isPlayingOriginal
                  ? 'bg-blue-600 text-white border-blue-500 font-bold animate-pulse'
                  : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
              }`}
            >
              {isPlayingOriginal ? <Pause className="w-3 h-3 fill-current" /> : <Volume2 className="w-3 h-3 text-blue-400" />}
              <span>Оригинал</span>
            </button>
          </div>

          <div className="bg-neutral-900/95 border border-neutral-700/80 rounded-xl p-3 space-y-2">
            <div className="text-xs font-bold text-white flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-orange-400" />
              <span>Решение куратора по наезду:</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleResolutionChange(gap.id, 'note_sound_engineer')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  gap.resolutionAction === 'note_sound_engineer'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                <Headphones className="w-3.5 h-3.5 text-indigo-300" />
                В записку звукарю (развести стык)
              </button>

              <button
                type="button"
                onClick={() => handleResolutionChange(gap.id, 'auto_shift')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  gap.resolutionAction === 'auto_shift'
                    ? 'bg-amber-500 text-neutral-950 shadow-sm'
                    : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                Авто-разведение (сдвинуть фразу, сохранив все хвосты)
              </button>

              <button
                type="button"
                onClick={() => handleResolutionChange(gap.id, 'keep_first')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  gap.resolutionAction === 'keep_first'
                    ? 'bg-rose-500 text-white shadow-sm'
                    : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                <Scissors className="w-3.5 h-3.5 text-rose-400" />
                Оставить {gap.dubberName}, дубль {gap.secondDubberName} убрать до тишины
              </button>

              <button
                type="button"
                onClick={() => handleResolutionChange(gap.id, 'keep_second')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  gap.resolutionAction === 'keep_second'
                    ? 'bg-rose-500 text-white shadow-sm'
                    : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                <Scissors className="w-3.5 h-3.5 text-rose-400" />
                Оставить {gap.secondDubberName}, дубль {gap.dubberName} убрать до тишины
              </button>

              <button
                type="button"
                onClick={() => handleResolutionChange(gap.id, 'transfer_second_to_first')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  gap.resolutionAction === 'transfer_second_to_first'
                    ? 'bg-emerald-500 text-neutral-950 shadow-sm'
                    : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                <ArrowRightLeft className="w-3.5 h-3.5 text-emerald-400" />
                Перенести от {gap.secondDubberName} ➔ в {gap.dubberName} (до тишины)
              </button>

              <button
                type="button"
                onClick={() => handleResolutionChange(gap.id, 'keep')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  gap.resolutionAction === 'keep'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                Оставить наплыв (нормально)
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
