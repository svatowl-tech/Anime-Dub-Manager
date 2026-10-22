import React from "react";
import {
  X,
  Play,
  Pause,
  CheckSquare,
  Square,
  VolumeX,
  Volume2,
  AlertTriangle,
  Check,
  Scissors,
  MessageSquare,
  Sparkles,
  Sliders,
  Shield,
  Layers,
  FileText,
  UserCheck,
  Headphones,
  Clock,
  Mic,
  Zap,
  ArrowRightLeft,
  RotateCcw,
  Repeat,
  Activity,
  Flame,
  UserPlus
} from "lucide-react";
import {
  MissingLineDetection,
  DefectCategory,
  DefectResolution
} from "../../lib/qa/missingLinesDetector";
import { MissingLinesArtifactAndWhisperSection } from "./MissingLinesArtifactAndWhisperSection";

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
                      
                      {/* Top Meta Line */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Timecode button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleInspectDefectInPlayer(gap);
                            }}
                            className={`px-2 py-0.5 rounded text-xs font-mono font-bold transition-all flex items-center gap-1.5 ${
                              selectedGapId === gap.id
                                ? 'bg-amber-500 text-neutral-950 shadow-sm'
                                : 'bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20'
                            }`}
                            title="Открыть и синхронизировать фрагмент в видеоплеере"
                          >
                            <Video className="w-3.5 h-3.5" />
                            <span>⏱ {gap.startFormatted} – {gap.endFormatted} ({gap.durationSec}с)</span>
                          </button>

                          {selectedGapId === gap.id && (
                            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              В плеере
                            </span>
                          )}

                          {/* Category Tag */}
                          {category === 'missing_line' && !gap.isSubtitleError && (
                            <span className="text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 font-semibold">
                              {gap.typeLabel}
                            </span>
                          )}
                          {category === 'unwanted_speech' && (
                            <span className="text-xs px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 font-semibold flex items-center gap-1">
                              <Scissors className="w-3 h-3 text-amber-400" />
                              Озвучено вне сабов
                            </span>
                          )}
                          {category === 'actor_collision' && (
                            <span className="text-xs px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 font-semibold flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3 text-blue-400" />
                              Конфликт: озвучили вдвоём
                            </span>
                          )}
                          {category === 'actor_overlap' && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs px-2 py-0.5 rounded bg-orange-500/10 text-orange-300 border border-orange-500/20 font-semibold flex items-center gap-1">
                                <Zap className="w-3 h-3 text-orange-400" />
                                Наезд хвоста (~{gap.overlapSec || 0.2}с)
                              </span>
                              {gap.isTimingTooLongMerged && (
                                <span className="text-xs px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30 font-semibold flex items-center gap-1">
                                  <Clock className="w-3 h-3 text-purple-400" />
                                  Длиннее саба (+{gap.timingDeltaPercent}%) • 1 фикс
                                </span>
                              )}
                            </div>
                          )}
                          {category === 'timing_too_short' && (
                            <span className="text-xs px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 font-semibold flex items-center gap-1">
                              <Clock className="w-3 h-3 text-cyan-400" />
                              Короче саба (-{Math.abs(gap.timingDeltaPercent || 30)}%)
                            </span>
                          )}
                          {category === 'timing_too_long' && (
                            <span className="text-xs px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 font-semibold flex items-center gap-1">
                              <Clock className="w-3 h-3 text-purple-400" />
                              Длиннее саба (+{gap.timingDeltaPercent || 40}%)
                            </span>
                          )}
                          {category === 'text_mismatch' && (
                            <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold flex items-center gap-1">
                              <Sparkles className="w-3 h-3 text-emerald-400" />
                              {gap.typeLabel || 'Сверка текста (Whisper)'}
                            </span>
                          )}

                          {/* Dubber badge */}
                          <span className="text-xs font-bold text-white bg-neutral-800 px-2 py-0.5 rounded border border-neutral-700">
                            🎙 {gap.dubberName} ({gap.characterName})
                          </span>

                          {gap.secondDubberName && (
                            <span className="text-xs font-bold text-white bg-neutral-800 px-2 py-0.5 rounded border border-neutral-700">
                              ⚡ 🎙 {gap.secondDubberName} ({gap.secondCharacterName})
                            </span>
                          )}

                          {/* Reassigned badge */}
                          {(gap.isSubtitleError || gap.resolutionAction === 'reassign_character') && (
                            <span className="text-xs font-bold text-purple-200 bg-purple-950/80 px-2.5 py-0.5 rounded-lg border border-purple-500/50 flex items-center gap-1.5 shadow-sm">
                              <ArrowRightLeft className="w-3.5 h-3.5 text-purple-300" />
                              <span>Переназначено: <strong>{gap.reassignedCharacterName || gap.selectedCharacterForSub}</strong> ({gap.reassignedDubberName || 'Даббер'})</span>
                            </span>
                          )}
                        </div>

                        {/* Right Quick Actions */}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleRemoveGap(gap.id)}
                            className="p-1 text-neutral-500 hover:text-red-400 rounded transition-colors"
                            title="Игнорировать это замечание"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* CATEGORY 1: MISSING LINE (ПРОПУСК) */}
                      {category === 'missing_line' && (
                        <div className="space-y-2.5">
                          {/* Subtitle text */}
                          <div className="bg-black/40 border border-neutral-800 rounded-lg p-2.5 text-xs text-neutral-200">
                            <span className="text-neutral-500 font-semibold mr-1.5">Текст субтитра:</span>
                            <span className="font-medium text-amber-200/90 italic">"{gap.text}"</span>
                          </div>

                          <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5">
                            <div className="flex items-center gap-2">
                              {gap.audioBuffer && (
                                <button
                                  onClick={() => handlePlaySnippet(gap, 'primary')}
                                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                                    isPlayingPrimary
                                      ? 'bg-amber-500 text-black border-amber-400 shadow-md animate-pulse font-bold'
                                      : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700 hover:bg-neutral-700'
                                  }`}
                                >
                                  {isPlayingPrimary ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                                  <span>{isPlayingPrimary ? 'Остановить' : 'Тест дорожки дабера'}</span>
                                </button>
                              )}

                              <button
                                onClick={() => onSeekMainPlayer?.(gap.startSec)}
                                className="px-2.5 py-1 rounded-lg text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 flex items-center gap-1"
                              >
                                ⏱ В видеоплееpe
                              </button>
                            </div>

                            <span className="text-[11px] font-mono text-neutral-400">
                              Разбег громкости: <strong className="text-neutral-200">{gap.dynamicRangeDb} дБ</strong> (пик {gap.peakDb} дБ)
                            </span>
                          </div>

                          {/* Subtitle attribution error / Reassign character module */}
                          {gap.isSubtitleError && gap.reassignedCharacterName ? (
                            <div className="bg-purple-950/30 border border-purple-500/40 rounded-xl p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                              <div className="flex items-start gap-2.5">
                                <div className="p-1.5 rounded-lg bg-purple-500/20 border border-purple-500/30 text-purple-300 shrink-0 mt-0.5">
                                  <ArrowRightLeft className="w-4 h-4" />
                                </div>
                                <div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-bold text-purple-200 text-xs">Фраза переназначена в субтитрах:</span>
                                    <span className="px-2 py-0.5 rounded bg-purple-500/20 border border-purple-400/40 text-purple-100 font-bold">
                                      {gap.reassignedCharacterName} ({gap.reassignedDubberName || 'Даббер'})
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-purple-300/80 mt-1 leading-relaxed">
                                    В субтитрах имя персонажа будет исправлено на <strong>{gap.reassignedCharacterName}</strong>. Замечание с просьбой доозвучить отправится дабберу <strong>{gap.reassignedDubberName}</strong>. С даббера <strong>{gap.dubberName}</strong> снята претензия (он не виноват в чужой фразе).
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                                <button
                                  onClick={() => setActiveReassignGapId(activeReassignGapId === gap.id ? null : gap.id)}
                                  className="px-2.5 py-1.5 rounded-lg bg-purple-900/40 hover:bg-purple-800/60 border border-purple-600/40 text-purple-200 text-xs font-medium transition-colors"
                                >
                                  Сменить персонажа
                                </button>
                                <button
                                  onClick={() => handleCancelReassign(gap.id)}
                                  className="px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 hover:text-white text-xs font-medium transition-colors flex items-center gap-1"
                                  title="Сбросить переназначение и вернуть как обычный пропуск"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                  <span>Сбросить</span>
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="pt-0.5">
                              {activeReassignGapId !== gap.id && (
                                <button
                                  onClick={() => setActiveReassignGapId(gap.id)}
                                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-950/40 hover:bg-purple-900/60 text-purple-300 hover:text-purple-200 border border-purple-800/50 hover:border-purple-600/60 transition-all flex items-center gap-1.5 shadow-sm"
                                  title="Указать, что эта фраза попала дабберу по ошибке и принадлежит другому персонажу"
                                >
                                  <ArrowRightLeft className="w-3.5 h-3.5 text-purple-400" />
                                  <span>Фраза другого персонажа? (ошибка в субтитрах)</span>
                                </button>
                              )}
                            </div>
                          )}

                          {/* Active character selection dropdown/panel */}
                          {activeReassignGapId === gap.id && (
                            <div className="bg-neutral-950 border border-purple-500/40 rounded-xl p-3.5 space-y-3 animate-fadeIn">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <ArrowRightLeft className="w-4 h-4 text-purple-400" />
                                  <span className="text-xs font-bold text-white">Кому на самом деле принадлежит эта фраза?</span>
                                </div>
                                <button
                                  onClick={() => setActiveReassignGapId(null)}
                                  className="text-neutral-500 hover:text-white text-xs px-1.5 py-0.5 rounded hover:bg-neutral-800"
                                >
                                  ✕
                                </button>
                              </div>

                              <p className="text-[11px] text-neutral-400">
                                Выберите правильного персонажа. Программа автоматически обновит файл субтитров, снимет претензию с текущего даббера и сформирует задачу на доозвучку для нужного персонажа.
                              </p>

                              {/* Available characters chips */}
                              <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                                {availableCharacters
                                  .filter(c => c.characterName.toLowerCase() !== (gap.characterName || '').toLowerCase())
                                  .map(c => (
                                    <button
                                      key={c.characterName}
                                      onClick={() => {
                                        handleReassignGapCharacter(gap.id, c.characterName);
                                        setActiveReassignGapId(null);
                                      }}
                                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 ${
                                        gap.reassignedCharacterName?.toLowerCase() === c.characterName.toLowerCase()
                                          ? 'bg-purple-600 border-purple-400 text-white shadow-md'
                                          : 'bg-neutral-900 hover:bg-purple-950/60 border-neutral-700 hover:border-purple-500/50 text-neutral-300 hover:text-purple-200'
                                      }`}
                                    >
                                      <span className="font-semibold">{c.characterName}</span>
                                      <span className="text-[10px] opacity-75">({c.dubberName})</span>
                                    </button>
                                  ))}
                              </div>

                              {/* Manual character name input */}
                              <div className="flex items-center gap-2 pt-1 border-t border-neutral-800">
                                <span className="text-[11px] text-neutral-400 shrink-0">Или ввести имя персонажа:</span>
                                <input
                                  type="text"
                                  placeholder="Имя персонажа..."
                                  value={customCharInput[gap.id] || ''}
                                  onChange={e => setCustomCharInput({ ...customCharInput, [gap.id]: e.target.value })}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && customCharInput[gap.id]?.trim()) {
                                      handleReassignGapCharacter(gap.id, customCharInput[gap.id]);
                                      setActiveReassignGapId(null);
                                    }
                                  }}
                                  className="flex-1 bg-neutral-900 border border-neutral-700 rounded-lg px-2.5 py-1 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500"
                                />
                                <button
                                  onClick={() => {
                                    if (customCharInput[gap.id]?.trim()) {
                                      handleReassignGapCharacter(gap.id, customCharInput[gap.id]);
                                      setActiveReassignGapId(null);
                                    }
                                  }}
                                  disabled={!customCharInput[gap.id]?.trim()}
                                  className="px-3 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-xs font-medium transition-colors"
                                >
                                  Назначить
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* CATEGORY 2: UNWANTED SPEECH (ОЗВУЧЕНО ТАМ, ГДЕ НЕ НАДО) */}
                      {category === 'unwanted_speech' && (
                        <div className="space-y-2.5">
                          {/* Context card */}
                          <div className="bg-amber-950/20 border border-amber-900/30 rounded-lg p-2.5 text-xs text-neutral-300 flex items-center justify-between">
                            <div>
                              <span className="text-amber-400 font-bold mr-2">Контекст таймкода:</span>
                              <span>{gap.nearestContext || 'Фраза вне интервалов субтитров'}</span>
                            </div>
                            <span className="text-[11px] font-mono text-neutral-400">
                              Разбег: {gap.dynamicRangeDb} дБ, Пик: {gap.peakDb} дБ
                            </span>
                          </div>

                          {/* Listening controls */}
                          <div className="flex items-center gap-2 flex-wrap">
                            {gap.audioBuffer && (
                              <button
                                onClick={() => handlePlaySnippet(gap, 'primary')}
                                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                                  isPlayingPrimary
                                    ? 'bg-amber-500 text-black border-amber-400 shadow-md animate-pulse font-bold'
                                    : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700 hover:bg-neutral-700'
                                }`}
                              >
                                {isPlayingPrimary ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                                <span>{isPlayingPrimary ? 'Стоп' : `Слушать ${gap.dubberName}`}</span>
                              </button>
                            )}

                            <button
                              onClick={() => handlePlaySnippet(gap, 'original')}
                              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                                isPlayingOriginal
                                  ? 'bg-blue-600 text-white border-blue-500 shadow-md animate-pulse font-bold'
                                  : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700 hover:bg-neutral-700'
                              }`}
                            >
                              {isPlayingOriginal ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Volume2 className="w-3.5 h-3.5 text-blue-400" />}
                              <span>{isPlayingOriginal ? 'Стоп' : 'Слушать оригинал'}</span>
                            </button>

                            <button
                              onClick={() => onSeekMainPlayer?.(gap.startSec)}
                              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 flex items-center gap-1"
                            >
                              ⏱ В плеере
                            </button>
                          </div>

                          {/* Curator Decision Choice Bar */}
                          <div className="bg-neutral-900/90 border border-neutral-700/80 rounded-xl p-2.5 flex items-center justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-white flex items-center gap-1">
                                <Sliders className="w-3.5 h-3.5 text-amber-400" />
                                Решение куратора:
                              </span>

                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleResolutionChange(gap.id, 'keep')}
                                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border ${
                                    gap.resolutionAction === 'keep'
                                      ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                                      : 'bg-neutral-800 text-neutral-400 hover:text-white border-neutral-700'
                                  }`}
                                >
                                  <Shield className="w-3.5 h-3.5" />
                                  Оставить как есть
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleResolutionChange(gap.id, 'silence')}
                                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border ${
                                    gap.resolutionAction === 'silence'
                                      ? 'bg-amber-500 text-neutral-950 border-amber-400 shadow-sm'
                                      : 'bg-neutral-800 text-neutral-400 hover:text-white border-neutral-700'
                                  }`}
                                >
                                  <VolumeX className="w-3.5 h-3.5" />
                                  Заменить тишиной
                                </button>
                              </div>
                            </div>

                            <span className="text-xs font-medium">
                              {gap.resolutionAction === 'silence' ? (
                                <span className="text-amber-300">✂ Будет вырезано тишиной на аудиодорожке</span>
                              ) : (
                                <span className="text-emerald-400">✓ Фраза сохраняется без изменений</span>
                              )}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* CATEGORY 3: COLLISION (КОНФЛИКТ ДУБЛЯЖА) */}
                      {category === 'actor_collision' && (
                        <div className="space-y-3">
                          {/* Subtitle text */}
                          <div className="bg-black/40 border border-neutral-800 rounded-lg p-2.5 text-xs text-neutral-200">
                            <span className="text-neutral-500 font-semibold mr-1.5">Текст спорного субтитра:</span>
                            <span className="font-medium text-amber-200/90 italic">"{gap.text}"</span>
                          </div>

                          {/* Dual Dubber Comparison Player */}
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

                          {/* Reference audio buttons */}
                          <div className="flex items-center gap-2">
                            <button
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
                              {/* Strategy 1: Ошибка росписи сабов */}
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

                              {/* Strategy 2: Выбор даббера */}
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

                              {/* Strategy 3: Перенос фразы целиком между дорожками */}
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
                                  Полностью вырезает фразу из дорожки-источника до естественной тишины и вставляет целиком с хвостами в целевую дорожку (хвосты 100% сохранены):
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
                                    title={`Взять реплику от ${gap.secondDubberName} и перенести в дорожку ${gap.dubberName} (вырезав у ${gap.secondDubberName} до тишины)`}
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
                                    title={`Взять реплику от ${gap.dubberName} и перенести в дорожку ${gap.secondDubberName} (вырезав у ${gap.dubberName} до тишины)`}
                                  >
                                    Взять у {gap.dubberName} ➔ перенести в дорожку {gap.secondDubberName}
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* CATEGORY 4: ACTOR OVERLAP (НАЕЗД ХВОСТОВ ФРАЗ) */}
                      {category === 'actor_overlap' && (
                        <div className="space-y-3">
                          {/* Collision warning banner */}
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
                                  ⚠️ Объединено в один фикс: фраза дабера длиннее субтитра на <strong>+{gap.timingDeltaPercent}%</strong> (вылет +{gap.overflowDurationSec || 0.4}с) и залезает на соседний саб.
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

                          {/* Dual speech cards */}
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

                          {/* Dual playback controls */}
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <button
                              onClick={() => handlePlaySnippet(gap, 'mix')}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border shadow-sm ${
                                isPlayingMix
                                  ? 'bg-orange-500 text-neutral-950 border-orange-400 animate-pulse'
                                  : 'bg-orange-500/20 text-orange-300 hover:bg-orange-500/30 border-orange-500/40'
                              }`}
                              title="Прослушать оба трека одновременно, чтобы оценить наезд"
                            >
                              {isPlayingMix ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Headphones className="w-3.5 h-3.5 text-orange-400" />}
                              <span>{isPlayingMix ? 'Остановить стык' : '🎧 Слушать стык (Оба дабера)'}</span>
                            </button>

                            <button
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

                          {/* Action choices for curator */}
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
                                title="Звукорежиссер разведет наезд вручную в DAW без обрезки голоса"
                              >
                                <Headphones className="w-3.5 h-3.5 text-indigo-300" />
                                {gap.isTimingTooLongMerged ? 'В записку звукарю (развести стык)' : 'В записку звукарю (развести стык)'}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleResolutionChange(gap.id, 'auto_shift')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                                  gap.resolutionAction === 'auto_shift'
                                    ? 'bg-amber-500 text-neutral-950 shadow-sm'
                                    : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                                }`}
                                title="Сдвигает начало второй фразы вперед за окончание первой фразы, 100% сохраняя голос и все хвосты"
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
                                title={`Фраза ${gap.secondDubberName} была ошибкой / дублем: вырезать её целиком до естественной тишины`}
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
                                title={`Фраза ${gap.dubberName} была ошибкой / дублем: вырезать её целиком до естественной тишины`}
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
                                title={`Перенести фразу от ${gap.secondDubberName} в дорожку ${gap.dubberName} целиком до тишины`}
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

                      {/* CATEGORY 5: TIMING TOO SHORT (КОРОЧЕ САБА, ВИСЯЩИЙ ЯПОНСКИЙ ХВОСТ) */}
                      {category === 'timing_too_short' && (
                        <div className="space-y-3">
                          {/* Alert info banner */}
                          <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <Clock className="w-4 h-4 text-cyan-400 shrink-0" />
                                <span className="text-xs font-bold text-cyan-200">
                                  Фраза дабера короче субтитра на {Math.abs(gap.timingDeltaPercent || 30)}% (критично &gt;30%)
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

                          {/* Subtitle text */}
                          <div className="bg-neutral-950/50 border border-neutral-800 rounded-xl p-3 space-y-1">
                            <div className="text-[11px] text-neutral-400 font-medium">Текст субтитра:</div>
                            <p className="text-xs text-neutral-200 font-medium italic">
                              «{gap.text}»
                            </p>
                          </div>

                          {/* Audio Controls */}
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => handlePlaySnippet(gap, 'mix')}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border shadow-sm ${
                                isPlayingMix
                                  ? 'bg-cyan-500 text-neutral-950 border-cyan-400 animate-pulse'
                                  : 'bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 border-cyan-500/40'
                              }`}
                              title="Слушать дабера вместе с японским оригиналом (проверить хвост)"
                            >
                              {isPlayingMix ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Headphones className="w-3.5 h-3.5 text-cyan-400" />}
                              <span>{isPlayingMix ? 'Остановить микс' : '🎧 Микс: Дабер + Японский звук (тест хвоста)'}</span>
                            </button>

                            <button
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

                          {/* Curator decisions */}
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
                                Безопасный момент (допустимо, не глушить)
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

                      {/* CATEGORY 6: TIMING TOO LONG (ДЛИННЕЕ САБА >40%, ВЫЛЕТ) */}
                      {category === 'timing_too_long' && (
                        <div className="space-y-3">
                          {/* Alert info banner */}
                          <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <Clock className="w-4 h-4 text-purple-400 shrink-0" />
                                <span className="text-xs font-bold text-purple-200">
                                  Фраза дабера длиннее субтитра на +{gap.timingDeltaPercent || 40}% (критично &gt;40%)
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

                          {/* Subtitle text */}
                          <div className="bg-neutral-950/50 border border-neutral-800 rounded-xl p-3 space-y-1">
                            <div className="text-[11px] text-neutral-400 font-medium">Текст субтитра:</div>
                            <p className="text-xs text-neutral-200 font-medium italic">
                              «{gap.text}»
                            </p>
                          </div>

                          {/* Audio controls */}
                          <div className="flex flex-wrap items-center gap-2">
                            <button
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

                          {/* Curator decisions */}
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
