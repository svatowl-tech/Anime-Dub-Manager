import React from 'react';
import {
  Play,
  Pause,
  Volume2,
  Headphones,
  AlertTriangle,
  Check,
  BookOpen,
  Mic,
  Activity,
  Flame,
  UserCheck,
  MessageSquare,
} from 'lucide-react';
import {
  DefectCategory,
  DefectResolution,
  MissingLineDetection,
} from '../../lib/qa/missingLinesDetector';

export interface MissingLinesActingSectionProps {
  gap: MissingLineDetection;
  category: DefectCategory;
  isPlayingPrimary: boolean;
  isPlayingOriginal: boolean;
  isPlayingMix: boolean;
  handlePlaySnippet: (gap: MissingLineDetection, target: 'primary' | 'secondary' | 'original' | 'mix', loop?: boolean) => void;
  onSeekMainPlayer?: (timeSec: number) => void;
  handleResolutionChange: (id: string, resolution: DefectResolution, characterForSub?: string) => void;
  updateGaps: (updater: (prev: MissingLineDetection[]) => MissingLineDetection[]) => void;
  onAcceptStressToDictionary?: (gap: MissingLineDetection) => Promise<void> | void;
}

const ACTING_CATEGORIES = new Set<DefectCategory>([
  'speech_disfluency',
  'diction_clarity',
  'emotion_mismatch',
  'stress_error',
  'persona_mismatch',
]);

export const isActingCategory = (cat: DefectCategory): boolean => ACTING_CATEGORIES.has(cat);

const TAG_BY_CATEGORY: Record<string, string> = {
  speech_disfluency: '[Сбивка/Оговорка]',
  diction_clarity: '[Дикция/Темп]',
  emotion_mismatch: '[Эмоции/Подача]',
  stress_error: '[Ударение]',
  persona_mismatch: '[Образ/Тембр]',
};

export const MissingLinesActingSection: React.FC<MissingLinesActingSectionProps> = ({
  gap,
  category,
  isPlayingPrimary,
  isPlayingOriginal,
  isPlayingMix,
  handlePlaySnippet,
  onSeekMainPlayer,
  handleResolutionChange,
  updateGaps,
  onAcceptStressToDictionary,
}) => {
  if (!isActingCategory(category)) return null;

  const CategoryIcon =
    category === 'speech_disfluency'
      ? Mic
      : category === 'diction_clarity'
      ? Activity
      : category === 'emotion_mismatch'
      ? Flame
      : category === 'stress_error'
      ? BookOpen
      : UserCheck;

  const accentText =
    category === 'speech_disfluency'
      ? 'text-amber-300'
      : category === 'diction_clarity'
      ? 'text-cyan-300'
      : category === 'emotion_mismatch'
      ? 'text-rose-300'
      : category === 'stress_error'
      ? 'text-yellow-300'
      : 'text-indigo-300';

  const handleDubberFixClick = () => {
    handleResolutionChange(gap.id, 'request_dubber_fix');
    const tag = TAG_BY_CATEGORY[category] || '[Правка]';
    updateGaps((prev) =>
      prev.map((g) =>
        g.id === gap.id
          ? {
              ...g,
              selected: true,
              resolutionAction: 'request_dubber_fix',
              comment:
                g.comment && g.comment.trim().length > 0
                  ? g.comment
                  : `${tag} [${g.startFormatted}] ${g.artifactTitle || g.typeLabel}: ${g.artifactDescription || g.text}`,
            }
          : g
      )
    );
  };

  const handleAcceptAsActing = () => {
    handleResolutionChange(gap.id, 'accept_as_acting');
    updateGaps((prev) =>
      prev.map((g) =>
        g.id === gap.id
          ? { ...g, selected: false, resolutionAction: 'accept_as_acting' }
          : g
      )
    );
  };

  const handleSaveStressClick = async () => {
    if (onAcceptStressToDictionary) {
      await onAcceptStressToDictionary(gap);
    } else {
      handleResolutionChange(gap.id, 'add_to_stress_dictionary');
      updateGaps((prev) =>
        prev.map((g) =>
          g.id === gap.id
            ? { ...g, selected: true, resolutionAction: 'add_to_stress_dictionary' }
            : g
        )
      );
    }
  };

  return (
    <div className="space-y-3">
      {/* Main Finding & Metrics Row */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-3 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1 min-w-0 flex-1">
            <div className={`text-xs font-semibold flex items-center gap-1.5 ${accentText}`}>
              <CategoryIcon className="w-3.5 h-3.5 shrink-0" />
              <span>{gap.artifactTitle || gap.typeLabel}</span>
            </div>
            {gap.artifactDescription && (
              <p className="text-xs text-neutral-300 leading-relaxed">
                {gap.artifactDescription}
              </p>
            )}
          </div>

          {/* Numeric telemetry readouts */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums text-neutral-300 shrink-0">
            {typeof gap.gopScore === 'number' && (
              <span className="px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800">
                GOP: {gap.gopScore.toFixed(2)}
              </span>
            )}
            {typeof gap.speechRateSyllablesPerSec === 'number' && (
              <span className="px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800">
                Темп: {gap.speechRateSyllablesPerSec.toFixed(1)}
                {typeof gap.originalSpeechRateSyllablesPerSec === 'number'
                  ? ` / ${gap.originalSpeechRateSyllablesPerSec.toFixed(1)}`
                  : ''}{' '}
                сл/с
              </span>
            )}
            {typeof gap.emotionDubberArousal === 'number' && (
              <span className="px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800">
                Энергия: {gap.emotionDubberArousal.toFixed(2)}
                {typeof gap.emotionOrigArousal === 'number'
                  ? ` vs ${gap.emotionOrigArousal.toFixed(2)}`
                  : ''}
              </span>
            )}
            {typeof gap.f0StdHz === 'number' && (
              <span className="px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800">
                F0 σ: {gap.f0StdHz.toFixed(0)} Гц
              </span>
            )}
            {typeof gap.personaDetectedAgeYears === 'number' && (
              <span className="px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800">
                Возраст: ~{Math.round(gap.personaDetectedAgeYears)} л.
              </span>
            )}
            {typeof gap.personaVoiceSimilarity === 'number' && (
              <span className="px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800">
                Тембр: {Math.round(gap.personaVoiceSimilarity * 100)}%
              </span>
            )}
          </div>
        </div>

        {/* Subtitle text */}
        {gap.text && (
          <div className="text-xs text-neutral-300 bg-neutral-900/90 border border-neutral-800 rounded-lg px-2.5 py-1.5 italic">
            «{gap.text}»
          </div>
        )}

        {/* Stress comparison block */}
        {category === 'stress_error' && (gap.stressExpectedMarked || gap.stressActualMarked) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-xs">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-2.5 py-2">
              <div className="text-[11px] text-neutral-400">
                Норма ({gap.stressRuleSource === 'dictionary' ? 'Словарь' : 'RUAccent'}):
              </div>
              <div className="font-mono font-bold text-emerald-300 mt-0.5">
                {gap.stressExpectedMarked || gap.stressWord}
              </div>
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-2.5 py-2">
              <div className="text-[11px] text-neutral-400">Произнесено в дорожке:</div>
              <div className="font-mono font-bold text-amber-300 mt-0.5">
                {gap.stressActualMarked || gap.stressWord}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 1-click A/B Playback */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handlePlaySnippet(gap, 'primary');
          }}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border whitespace-nowrap ${
            isPlayingPrimary
              ? 'bg-amber-500 text-neutral-950 border-amber-400 font-bold'
              : 'bg-neutral-800 text-neutral-200 hover:text-white border-neutral-700'
          }`}
        >
          {isPlayingPrimary ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 text-amber-400" />}
          <span>{isPlayingPrimary ? 'Стоп' : 'Слушать дабера'}</span>
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handlePlaySnippet(gap, 'original');
          }}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border whitespace-nowrap ${
            isPlayingOriginal
              ? 'bg-blue-600 text-white border-blue-500 font-bold'
              : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
          }`}
        >
          {isPlayingOriginal ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Volume2 className="w-3.5 h-3.5 text-blue-400" />}
          <span>{gap.originalVocalsUrl ? 'Оригинал (вокал)' : 'Оригинал'}</span>
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handlePlaySnippet(gap, 'mix');
          }}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border whitespace-nowrap ${
            isPlayingMix
              ? 'bg-cyan-500 text-neutral-950 border-cyan-400 font-bold'
              : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
          }`}
        >
          {isPlayingMix ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Headphones className="w-3.5 h-3.5 text-cyan-400" />}
          <span>Микс</span>
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSeekMainPlayer?.(gap.startSec);
          }}
          className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 whitespace-nowrap"
        >
          ⏱ В плеере
        </button>
      </div>

      {/* Curator Action Bar */}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleDubberFixClick();
          }}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 border whitespace-nowrap ${
            gap.resolutionAction === 'request_dubber_fix'
              ? 'bg-rose-600 text-white border-rose-500'
              : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>В правки дабберу</span>
        </button>

        {category === 'stress_error' && gap.stressWord && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleSaveStressClick();
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 border whitespace-nowrap ${
              gap.resolutionAction === 'add_to_stress_dictionary'
                ? 'bg-emerald-600 text-white border-emerald-500'
                : 'bg-neutral-800 text-emerald-300 hover:bg-neutral-700 border-neutral-700'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Принять произношение в словарь</span>
          </button>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleAcceptAsActing();
          }}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border whitespace-nowrap ${
            gap.resolutionAction === 'accept_as_acting'
              ? 'bg-neutral-700 text-white border-neutral-600'
              : 'bg-neutral-900 text-neutral-400 hover:text-neutral-200 border-neutral-800'
          }`}
        >
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span>Пропустить (допустимый отыгрыш)</span>
        </button>
      </div>
    </div>
  );
};
