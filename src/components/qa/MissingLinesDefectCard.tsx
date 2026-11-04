import React from "react";
import {
  X,
  Play,
  Pause,
  CheckSquare,
  Square,
  Volume2,
  AlertTriangle,
  Check,
  MessageSquare,
  Sliders,
  Shield,
  FileText,
  UserCheck,
  Headphones,
  Clock,
  Zap,
  ArrowRightLeft,
  UserPlus
} from "lucide-react";
import {
  MissingLineDetection,
  DefectResolution
} from "../../lib/qa/missingLinesDetector";
import { MissingLinesArtifactAndWhisperSection } from "./MissingLinesArtifactAndWhisperSection";
import { MissingLinesCollisionSection } from "./missingLines/MissingLinesCollisionSection";

export interface MissingLinesDefectCardProps {
  gap: MissingLineDetection;
  selectedGapId: string | null;
  playingSnippetId: string | null;
  isLoopingSnippet: boolean;
  activeReassignGapId: string | null;
  setActiveReassignGapId: React.Dispatch<React.SetStateAction<string | null>>;
  customCharInput: Record<string, string>;
  setCustomCharInput: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  availableCharacters: Array<{ characterName: string; dubberName: string; dubberId?: string; assignmentId?: string }>;
  handleInspectDefectInPlayer: (gap: MissingLineDetection) => void;
  handleToggleSingle: (id: string) => void;
  handlePlaySnippet: (gap: MissingLineDetection, target: "primary" | "secondary" | "original" | "mix", loop?: boolean) => void;
  onSeekMainPlayer?: (timeSec: number) => void;
  handleRemoveGap: (id: string) => void;
  handleCancelReassign: (gapId: string) => void;
  handleReassignGapCharacter: (gapId: string, targetCharName: string) => void;
  handleResolutionChange: (id: string, resolution: DefectResolution, characterForSub?: string) => void;
  handleCommentChange: (id: string, newComment: string) => void;
  updateGaps: (updater: (prev: MissingLineDetection[]) => MissingLineDetection[]) => void;
}

export const MissingLinesDefectCard: React.FC<MissingLinesDefectCardProps> = ({
  gap,
  selectedGapId,
  playingSnippetId,
  isLoopingSnippet,
  activeReassignGapId,
  setActiveReassignGapId,
  customCharInput,
  setCustomCharInput,
  availableCharacters,
  handleInspectDefectInPlayer,
  handleToggleSingle,
  handlePlaySnippet,
  onSeekMainPlayer,
  handleRemoveGap,
  handleCancelReassign,
  handleReassignGapCharacter,
  handleResolutionChange,
  handleCommentChange,
  updateGaps
}) => {
  const category = gap.defectCategory || 'missing_line';
  const isPlayingPrimary = playingSnippetId === `${gap.id}_primary`;
  const isPlayingSecondary = playingSnippetId === `${gap.id}_secondary`;
  const isPlayingOriginal = playingSnippetId === `${gap.id}_original`;
  const isPlayingMix = playingSnippetId === `${gap.id}_mix`;

  return (
    <div
      key={gap.id}
      onClick={() => handleInspectDefectInPlayer(gap)}
      className={`p-4 rounded-xl border transition-all cursor-pointer ${
        selectedGapId === gap.id
          ? 'ring-2 ring-amber-500/80 bg-neutral-850 border-amber-500/60 shadow-lg'
          : gap.selected
            ? (gap.isSubtitleError || gap.resolutionAction === 'reassign_character'
                ? 'bg-purple-950/20 border-purple-500/60 hover:border-purple-400 ring-1 ring-purple-500/20 shadow-sm'
                : 'bg-neutral-800/50 border-neutral-700 hover:border-neutral-600')
            : 'bg-neutral-900/40 border-neutral-800/60 opacity-60'
      }`}
    >
      <div className="flex items-start gap-3.5">
        {/* Checkbox */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleToggleSingle(gap.id);
          }}
          className={`mt-1 p-0.5 rounded transition-colors shrink-0 ${
            gap.selected ? 'text-blue-400 hover:text-blue-300' : 'text-neutral-600 hover:text-neutral-400'
          }`}
          title={gap.selected ? "Исключить" : "Включить в применение"}
        >
          {gap.selected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
        </button>

        {/* Content Body */}
        <div className="flex-1 min-w-0 space-y-3">
          
          {/* Card Title & Meta Header */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              {/* Category Badge */}
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                category === 'missing_line' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' :
                category === 'unwanted_speech' ? 'bg-blue-500/15 text-blue-300 border-blue-500/30' :
                category === 'actor_collision' ? 'bg-red-500/15 text-red-300 border-red-500/30' :
                category === 'actor_overlap' ? 'bg-orange-500/15 text-orange-300 border-orange-500/30' :
                category === 'timing_too_short' ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' :
                category === 'timing_too_long' ? 'bg-purple-500/15 text-purple-300 border-purple-500/30' :
                category === 'audio_artifact' ? 'bg-rose-500/15 text-rose-300 border-rose-500/30' :
                'bg-purple-500/15 text-purple-300 border-purple-500/30'
              }`}>
                {gap.typeLabel || 'Замечание'}
              </span>

              {/* Character & Dubber Badge */}
              <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                <span className="text-neutral-300">
                  {gap.reassignedDubberName ? gap.reassignedDubberName : gap.dubberName}
                </span>
                <span className="text-neutral-500">•</span>
                <span className="text-amber-200/90 font-bold">
                  {gap.reassignedCharacterName ? gap.reassignedCharacterName : gap.characterName}
                </span>
              </div>

              {/* Timestamp */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSeekMainPlayer?.(gap.artifactTimestampSec ?? gap.startSec);
                }}
                className="font-mono text-xs text-blue-400 hover:text-blue-300 font-bold bg-neutral-950 px-2 py-0.5 rounded border border-neutral-800 shrink-0"
                title="Перейти к таймкоду в видеоплеере"
              >
                ⏱ {gap.startFormatted} – {gap.endFormatted}
              </button>
            </div>

            {/* Quick Actions Right */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveGap(gap.id);
                }}
                className="text-neutral-500 hover:text-red-400 p-1 transition-colors"
                title="Удалить из списка"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* CATEGORY 1: MISSING LINE (ПРОПУСК РЕПЛИКИ) */}
          {category === 'missing_line' && (
            <div className="space-y-3">
              <div className="bg-neutral-950/60 border border-neutral-800 rounded-xl p-3 space-y-1.5">
                <div className="text-[11px] text-neutral-400 font-semibold flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-amber-400" />
                  <span>Текст пропущенного субтитра:</span>
                </div>
                <p className="text-sm text-amber-200/90 italic font-medium">
                  «{gap.text}»
                </p>
              </div>

              {/* Actions & Resolution Options */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => handlePlaySnippet(gap, 'original')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                      isPlayingOriginal
                        ? 'bg-blue-600 text-white border-blue-500 font-bold animate-pulse'
                        : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
                    }`}
                  >
                    {isPlayingOriginal ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Volume2 className="w-3.5 h-3.5 text-blue-400" />}
                    <span>{isPlayingOriginal ? 'Стоп' : 'Слушать японский оригинал'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onSeekMainPlayer?.(gap.startSec)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 flex items-center gap-1.5"
                  >
                    ⏱ Посмотреть кадр
                  </button>
                </div>

                {/* Reassign / Fix Subtitle Error Toggle */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (activeReassignGapId === gap.id) {
                        setActiveReassignGapId(null);
                      } else {
                        setActiveReassignGapId(gap.id);
                      }
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border ${
                      gap.isSubtitleError || gap.resolutionAction === 'reassign_character'
                        ? 'bg-purple-600 text-white border-purple-500 shadow-sm'
                        : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
                    }`}
                  >
                    <UserPlus className="w-3.5 h-3.5 text-purple-300" />
                    <span>
                      {gap.isSubtitleError || gap.resolutionAction === 'reassign_character'
                        ? `Ошибка в сабах (переназначен на ${gap.reassignedCharacterName || gap.selectedCharacterForSub})`
                        : 'Это ошибка в сабах (перезначить роль)'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Reassign Character Panel */}
              {(activeReassignGapId === gap.id || gap.isSubtitleError || gap.resolutionAction === 'reassign_character') && (
                <div className="bg-purple-950/30 border border-purple-500/40 rounded-xl p-3.5 space-y-2.5 animate-fadeIn">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-purple-200 flex items-center gap-1.5">
                      <UserCheck className="w-4 h-4 text-purple-400" />
                      Исправление ошибки росписи субтитров
                    </span>
                    <span className="text-[11px] text-purple-300/80">
                      Предыдущий даббер ({gap.dubberName}) будет освобожден от вины
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-neutral-300">Переназначить эту фразу на реального персонажа:</span>
                    <select
                      value={gap.reassignedCharacterName || gap.selectedCharacterForSub || gap.characterName}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '__custom__') return;
                        handleReassignGapCharacter(gap.id, val);
                      }}
                      className="bg-neutral-900 border border-purple-500/50 text-white text-xs font-semibold rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-400"
                    >
                      {availableCharacters.map(c => (
                        <option key={c.characterName} value={c.characterName}>
                          {c.characterName} ({c.dubberName})
                        </option>
                      ))}
                      <option value="__custom__">+ Ввести другое имя...</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => handleCancelReassign(gap.id)}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 transition-colors"
                    >
                      Сбросить
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* CATEGORY 2: UNWANTED SPEECH (ЛИШНЯЯ РЕЧЬ) */}
          {category === 'unwanted_speech' && (
            <div className="space-y-3">
              <div className="bg-neutral-950/60 border border-neutral-800 rounded-xl p-3 space-y-1">
                <div className="text-[11px] text-blue-400 font-semibold flex items-center justify-between">
                  <span>Обнаружена речь за пределами субтитров ({gap.speechDurationSec}с):</span>
                  <span className="font-mono text-[10px] text-neutral-500">Пик: {gap.peakDb} дБ</span>
                </div>
                <div className="text-xs text-neutral-300 font-mono">
                  Аудиодорожка: <strong className="text-white">{gap.dubberName}</strong> ({gap.characterName})
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handlePlaySnippet(gap, 'primary')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                      isPlayingPrimary
                        ? 'bg-amber-500 text-neutral-950 border-amber-400 font-bold animate-pulse'
                        : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
                    }`}
                  >
                    {isPlayingPrimary ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 text-amber-400" />}
                    <span>{isPlayingPrimary ? 'Стоп' : 'Прослушать эту речь'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onSeekMainPlayer?.(gap.startSec)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 flex items-center gap-1.5"
                  >
                    ⏱ Посмотреть кадр
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleResolutionChange(gap.id, 'silence')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border ${
                      gap.resolutionAction === 'silence' || gap.resolutionAction === undefined
                        ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                        : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
                    }`}
                  >
                    <Shield className="w-3.5 h-3.5 text-blue-300" />
                    <span>Заглушить в тишину (вырезать обрез)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleResolutionChange(gap.id, 'keep')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                      gap.resolutionAction === 'keep'
                        ? 'bg-neutral-700 text-white border-neutral-600'
                        : 'bg-neutral-850 text-neutral-400 hover:text-neutral-200 border-neutral-800'
                    }`}
                  >
                    Оставить
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* CATEGORIES 3 & 4: ACTOR COLLISION & OVERLAP */}
          <MissingLinesCollisionSection
            gap={gap}
            category={category}
            isPlayingMix={isPlayingMix}
            isPlayingPrimary={isPlayingPrimary}
            isPlayingSecondary={isPlayingSecondary}
            isPlayingOriginal={isPlayingOriginal}
            handlePlaySnippet={handlePlaySnippet}
            onSeekMainPlayer={onSeekMainPlayer}
            handleResolutionChange={handleResolutionChange}
          />

          {/* CATEGORY 5: TIMING TOO SHORT */}
          {category === 'timing_too_short' && (
            <div className="space-y-3">
              <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span className="text-xs font-bold text-cyan-200">
                      Фраза дабера короче субтитра на {Math.abs(gap.timingDeltaPercent || 30)}%
                    </span>
                  </div>
                  <p className="text-[11px] text-cyan-300/80">
                    Речь дабера длится {gap.speechDurationSec}с при длине саба {gap.subDurationSec}с.
                    Висящий японский хвост оригинала без дубляжа: ~{gap.tailDurationSec || 0.4}с
                  </p>
                </div>
                <span className="text-xs px-2.5 py-1 rounded bg-cyan-950/80 text-cyan-300 font-mono font-bold border border-cyan-800/40 shrink-0">
                  Хвост: ~{gap.tailDurationSec || 0.4}с
                </span>
              </div>

              <div className="bg-neutral-950/50 border border-neutral-800 rounded-xl p-3 space-y-1">
                <div className="text-[11px] text-neutral-400 font-medium">Текст субтитра:</div>
                <p className="text-xs text-neutral-200 font-medium italic">
                  «{gap.text}»
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handlePlaySnippet(gap, 'mix')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border shadow-sm ${
                    isPlayingMix
                      ? 'bg-cyan-500 text-neutral-950 border-cyan-400 animate-pulse'
                      : 'bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 border-cyan-500/40'
                  }`}
                >
                  {isPlayingMix ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Headphones className="w-3.5 h-3.5 text-cyan-400" />}
                  <span>{isPlayingMix ? 'Остановить микс' : '🎧 Микс: Дабер + Японский звук'}</span>
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
                  <span>Слушать дабера ({gap.speechDurationSec}с)</span>
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
                  <span>Оригинал ({gap.subDurationSec}с)</span>
                </button>
              </div>

              <div className="bg-neutral-900/95 border border-neutral-700/80 rounded-xl p-3 space-y-2">
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Решение куратора по японскому хвосту:</span>
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
                    В записку звукарю (заглушить японский хвост)
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
                    Безопасный момент (не глушить)
                  </button>

                  <button
                    type="button"
                    onClick={() => handleResolutionChange(gap.id, 'request_dubber_fix')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                      gap.resolutionAction === 'request_dubber_fix'
                        ? 'bg-amber-500 text-neutral-950 shadow-sm'
                        : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
                    Замечание даберу (переозвучить шире)
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* CATEGORY 6: TIMING TOO LONG */}
          {category === 'timing_too_long' && (
            <div className="space-y-3">
              <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-purple-400 shrink-0" />
                    <span className="text-xs font-bold text-purple-200">
                      Фраза дабера длиннее субтитра на +{gap.timingDeltaPercent || 40}%
                    </span>
                  </div>
                  <p className="text-[11px] text-purple-300/80">
                    Речь дабера длится {gap.speechDurationSec}с при длине саба {gap.subDurationSec}с.
                    Превышение тайминга: +{gap.overflowDurationSec || 0.4}с
                  </p>
                </div>
                <span className="text-xs px-2.5 py-1 rounded bg-purple-950/80 text-purple-300 font-mono font-bold border border-purple-800/40 shrink-0">
                  Вылет: +{gap.overflowDurationSec || 0.4}с
                </span>
              </div>

              <div className="bg-neutral-950/50 border border-neutral-800 rounded-xl p-3 space-y-1">
                <div className="text-[11px] text-neutral-400 font-medium">Текст субтитра:</div>
                <p className="text-xs text-neutral-200 font-medium italic">
                  «{gap.text}»
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handlePlaySnippet(gap, 'primary')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                    isPlayingPrimary
                      ? 'bg-purple-600 text-white border-purple-500 font-bold animate-pulse'
                      : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
                  }`}
                >
                  {isPlayingPrimary ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 text-purple-400" />}
                  <span>Слушать дабера ({gap.speechDurationSec}с)</span>
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
                  <span>Оригинал ({gap.subDurationSec}с)</span>
                </button>
              </div>

              <div className="bg-neutral-900/95 border border-neutral-700/80 rounded-xl p-3 space-y-2">
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-purple-400" />
                  <span>Решение куратора по удлинению:</span>
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
                    В записку звукарю (поджать/сократить дорожку)
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
                    Оставить как есть (допустимо)
                  </button>
                </div>
              </div>
            </div>
          )}

          <MissingLinesArtifactAndWhisperSection
            gap={gap}
            category={category}
            isPlayingPrimary={isPlayingPrimary}
            isPlayingOriginal={isPlayingOriginal}
            isLoopingSnippet={isLoopingSnippet}
            handlePlaySnippet={handlePlaySnippet}
            onSeekMainPlayer={onSeekMainPlayer}
            handleResolutionChange={handleResolutionChange}
            handleCommentChange={handleCommentChange}
            updateGaps={updateGaps}
          />

        </div>
      </div>
    </div>
  );
};
