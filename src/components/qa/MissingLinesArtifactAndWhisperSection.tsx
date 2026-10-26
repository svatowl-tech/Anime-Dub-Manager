import React from "react";
import {
  Play,
  Pause,
  Volume2,
  AlertTriangle,
  Check,
  Scissors,
  MessageSquare,
  Sparkles,
  Sliders,
  FileText,
  UserCheck,
  Headphones,
  Mic,
  Zap,
  RotateCcw,
  Repeat,
  Activity,
  Flame
} from "lucide-react";
import {
  MissingLineDetection,
  DefectCategory,
  DefectResolution
} from "../../lib/qa/missingLinesDetector";
import { ArtifactWaveformMarker } from "./ArtifactWaveformMarker";

export interface MissingLinesArtifactAndWhisperProps {
  gap: MissingLineDetection;
  category: DefectCategory;
  isPlayingPrimary: boolean;
  isPlayingOriginal: boolean;
  isLoopingSnippet: boolean;
  handlePlaySnippet: (gap: MissingLineDetection, target: "primary" | "secondary" | "original" | "mix", loop?: boolean) => void;
  onSeekMainPlayer?: (timeSec: number) => void;
  handleResolutionChange: (id: string, resolution: DefectResolution, characterForSub?: string) => void;
  handleCommentChange: (id: string, newComment: string) => void;
  updateGaps: (updater: (prev: MissingLineDetection[]) => MissingLineDetection[]) => void;
}

const formatTimecode = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 10);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
};

export const MissingLinesArtifactAndWhisperSection: React.FC<MissingLinesArtifactAndWhisperProps> = ({
  gap,
  category,
  isPlayingPrimary,
  isPlayingOriginal,
  isLoopingSnippet,
  handlePlaySnippet,
  onSeekMainPlayer,
  handleResolutionChange,
  handleCommentChange,
  updateGaps
}) => {
  return (
    <>
                      {/* CATEGORY 7: AUDIO ARTIFACTS (ТЕХНИЧЕСКИЕ АРТЕФАКТЫ ЗАПИСИ: КЛИППИНГ, КЛИКИ, ЗАДУВЫ, ОБРЫВЫ) */}
                      {category === 'audio_artifact' && (
                        <div className="space-y-3">
                          {/* Artifact Header Info */}
                          <div className={`border rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 ${
                            gap.artifactSeverity === 'high'
                              ? 'bg-rose-950/30 border-rose-500/40 text-rose-200'
                              : gap.artifactSeverity === 'medium'
                              ? 'bg-amber-950/30 border-amber-500/40 text-amber-200'
                              : 'bg-blue-950/30 border-blue-500/40 text-blue-200'
                          }`}>
                            <div className="space-y-1.5 flex-1 min-w-[280px]">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider flex items-center gap-1 border ${
                                  gap.artifactType === 'clipping'
                                    ? 'bg-rose-500 text-white border-rose-400'
                                    : gap.artifactType === 'mouse_click'
                                    ? 'bg-amber-500 text-neutral-950 border-amber-400'
                                    : gap.artifactType === 'plosive'
                                    ? 'bg-sky-500 text-neutral-950 border-sky-400'
                                    : 'bg-purple-500 text-white border-purple-400'
                                }`}>
                                  {gap.artifactType === 'clipping' && '🔴 Клиппинг / Перегруз'}
                                  {gap.artifactType === 'mouse_click' && '🐭 Клик мыши / Щелчок'}
                                  {gap.artifactType === 'plosive' && '💨 Задув капсюля (П/Б)'}
                                  {gap.artifactType === 'swallowed_vowel' && '📉 Обрыв гейтом / Срез'}
                                </span>

                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                  gap.artifactSeverity === 'high'
                                    ? 'bg-rose-900/60 text-rose-200 border-rose-700/60'
                                    : gap.artifactSeverity === 'medium'
                                    ? 'bg-amber-900/60 text-amber-200 border-amber-700/60'
                                    : 'bg-blue-900/60 text-blue-200 border-blue-700/60'
                                }`}>
                                  {gap.artifactSeverity === 'high' ? 'Критично (брак записи)' : gap.artifactSeverity === 'medium' ? 'Заметный огрех' : 'Микро-артефакт'}
                                </span>

                                <span className="text-xs font-bold text-white font-mono bg-neutral-900/80 px-2 py-0.5 rounded border border-neutral-700/70">
                                  Точка дефекта: [{formatTimecode(gap.artifactTimestampSec ?? gap.startSec)}]
                                </span>
                              </div>

                              <p className="text-xs text-neutral-300 leading-relaxed">
                                {gap.artifactDescription || 'Обнаружен технический артефакт в аудиодорожке.'}
                              </p>
                            </div>

                            {gap.artifactMetric && (
                              <div className="px-3 py-1.5 rounded-lg bg-neutral-950/90 border border-neutral-700/90 font-mono text-xs text-amber-300 shrink-0 shadow-inner">
                                {gap.artifactMetric}
                              </div>
                            )}
                          </div>

                          {/* Subtitle Dialogue context (if nearby) */}
                          {gap.nearestSubtitleText && (
                            <div className="bg-neutral-950/60 border border-neutral-800 rounded-xl p-2.5 text-xs text-neutral-300 flex items-start gap-2">
                              <span className="text-neutral-500 font-semibold shrink-0">Фраза в сабах:</span>
                              <span className="font-medium text-amber-200 italic">"{gap.nearestSubtitleText}"</span>
                            </div>
                          )}

                          {/* Interactive Mini-Waveform with Neon Defect Marker */}
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-[11px] text-neutral-400 font-mono px-1">
                              <span>Окно: {gap.startFormatted}</span>
                              <span className="text-rose-400 font-bold flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                Огрех в {formatTimecode(gap.artifactTimestampSec ?? gap.startSec)}
                              </span>
                              <span>{gap.endFormatted}</span>
                            </div>

                            <ArtifactWaveformMarker
                              audioBuffer={gap.audioBuffer}
                              startSec={gap.startSec}
                              endSec={gap.endSec}
                              defectTimestampSec={gap.artifactTimestampSec}
                              isPlaying={isPlayingPrimary}
                              artifactType={gap.artifactType}
                              onSeek={(t) => onSeekMainPlayer?.(t)}
                            />
                          </div>

                          {/* Player Controls: Play, Loop, Seek */}
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handlePlaySnippet(gap, 'primary', false)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                                  isPlayingPrimary && !isLoopingSnippet
                                    ? 'bg-rose-500 text-white border-rose-400 font-bold shadow-md animate-pulse'
                                    : 'bg-neutral-800 text-neutral-200 hover:text-white border-neutral-700 hover:bg-neutral-700'
                                }`}
                              >
                                {isPlayingPrimary && !isLoopingSnippet ? (
                                  <Pause className="w-3.5 h-3.5 fill-current" />
                                ) : (
                                  <Play className="w-3.5 h-3.5 fill-current ml-0.5 text-rose-400" />
                                )}
                                <span>{isPlayingPrimary && !isLoopingSnippet ? 'Стоп' : `Слушать отрезок (${gap.durationSec}с)`}</span>
                              </button>

                              <button
                                onClick={() => {
                                  handlePlaySnippet(gap, 'primary', !isLoopingSnippet);
                                }}
                                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1 border ${
                                  isLoopingSnippet && isPlayingPrimary
                                    ? 'bg-amber-500 text-neutral-950 border-amber-400 font-bold shadow-md animate-pulse'
                                    : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700 hover:bg-neutral-700'
                                }`}
                                title="Зациклить отрезок для детального вслушивания в щелчок или задув"
                              >
                                <Repeat className="w-3.5 h-3.5" />
                                <span>{isLoopingSnippet && isPlayingPrimary ? 'Зациклено (Loop)' : 'Loop (Зациклить)'}</span>
                              </button>

                              <button
                                onClick={() => onSeekMainPlayer?.(gap.artifactTimestampSec ?? gap.startSec)}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 flex items-center gap-1"
                              >
                                ⏱ В плеере
                              </button>
                            </div>

                            <span className="text-[11px] text-neutral-400">
                              Даббер: <strong className="text-white">{gap.dubberName}</strong> ({gap.characterName})
                            </span>
                          </div>

                          {/* Curator 1-Click Action Bar */}
                          <div className="bg-neutral-900/95 border border-neutral-700/80 rounded-xl p-3 space-y-2">
                            <div className="text-xs font-bold text-white flex items-center justify-between">
                              <span className="flex items-center gap-1.5">
                                <Sliders className="w-3.5 h-3.5 text-rose-400" />
                                Решение куратора по артефакту:
                              </span>
                              <span className="text-[11px] font-medium">
                                {gap.resolutionAction === 'request_dubber_fix' && <span className="text-rose-400 font-bold">🔴 Назначена перезапись дабберу</span>}
                                {gap.resolutionAction === 'note_sound_engineer' && <span className="text-indigo-300 font-bold">🎛 Назначено звукорежиссеру (плагины)</span>}
                                {gap.resolutionAction === 'ignore' && <span className="text-neutral-400 font-bold">⚪ Пропуск / всё в норме</span>}
                              </span>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              {/* 1. На перезапись */}
                              <button
                                type="button"
                                onClick={() => {
                                  handleResolutionChange(gap.id, 'request_dubber_fix');
                                  updateGaps(prev => prev.map(g => g.id === gap.id ? { 
                                    ...g, 
                                    selected: true,
                                    comment: g.comment || (
                                      g.artifactType === 'clipping' 
                                        ? `[Перезапись] Перегруз/клиппинг [${formatTimecode(g.artifactTimestampSec ?? g.startSec)}]: Сбавь гейн микрофона или отойди на шаг назад.`
                                        : g.artifactType === 'mouse_click'
                                        ? `[Перезапись] Посторонний механический клик/щелчок [${formatTimecode(g.artifactTimestampSec ?? g.startSec)}]. Перезапиши без щелчков мыши.`
                                        : g.artifactType === 'plosive'
                                        ? `[Перезапись] Задув микрофона на взрывном согласном [${formatTimecode(g.artifactTimestampSec ?? g.startSec)}]. Используй поп-фильтр.`
                                        : `[Перезапись] Обрыв/срез окончания фразы гейтом [${formatTimecode(g.artifactTimestampSec ?? g.startSec)}]. Перепиши фразу целиком.`
                                    )
                                  } : g));
                                }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border ${
                                  gap.resolutionAction === 'request_dubber_fix'
                                    ? 'bg-rose-600 text-white border-rose-500 shadow-md ring-1 ring-rose-400'
                                    : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700 hover:bg-neutral-700'
                                }`}
                              >
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-300" />
                                <span>На перезапись (Дабберу)</span>
                              </button>

                              {/* 2. На сведение звукарю */}
                              <button
                                type="button"
                                onClick={() => {
                                  handleResolutionChange(gap.id, 'note_sound_engineer');
                                  updateGaps(prev => prev.map(g => g.id === gap.id ? { 
                                    ...g, 
                                    selected: true,
                                    comment: g.comment || (
                                      g.artifactType === 'clipping' 
                                        ? `[Звукорежиссеру] Микро-перегруз на [${formatTimecode(g.artifactTimestampSec ?? g.startSec)}]. Восстановить деклиппером при сведении.`
                                        : g.artifactType === 'mouse_click'
                                        ? `[Звукорежиссеру] Легкий щелчок/клик на [${formatTimecode(g.artifactTimestampSec ?? g.startSec)}]. Снять декликером (De-click) при сведении.`
                                        : g.artifactType === 'plosive'
                                        ? `[Звукорежиссеру] Задув/суббасовый хлопок на [${formatTimecode(g.artifactTimestampSec ?? g.startSec)}]. Срезать HPF-фильтром (80-100 Гц) при сведении.`
                                        : `[Звукорежиссеру] Обрыв хвоста на [${formatTimecode(g.artifactTimestampSec ?? g.startSec)}]. Смягчить плавным затуханием (fade-out).`
                                    )
                                  } : g));
                                }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border ${
                                  gap.resolutionAction === 'note_sound_engineer'
                                    ? 'bg-indigo-600 text-white border-indigo-500 shadow-md ring-1 ring-indigo-400'
                                    : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700 hover:bg-neutral-700'
                                }`}
                              >
                                <Headphones className="w-3.5 h-3.5 text-indigo-300" />
                                <span>Звукорежиссёру (Сведение / Плагины)</span>
                              </button>

                              {/* 3. Игнорировать / В норме */}
                              <button
                                type="button"
                                onClick={() => {
                                  handleResolutionChange(gap.id, 'ignore');
                                  updateGaps(prev => prev.map(g => g.id === gap.id ? { ...g, selected: false } : g));
                                }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border ${
                                  gap.resolutionAction === 'ignore'
                                    ? 'bg-neutral-700 text-white border-neutral-600'
                                    : 'bg-neutral-800/80 text-neutral-400 hover:text-white border-neutral-700'
                                }`}
                              >
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Игнорировать / Всё в норме</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* CATEGORY 8: TEXT MISMATCH / WHISPER ASR */}
                      {category === 'text_mismatch' && (
                        <div className="space-y-3">
                          {/* Top banner with similarity and model info */}
                          <div className="bg-emerald-950/25 border border-emerald-500/30 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2.5">
                            <div className="flex items-center gap-2.5">
                              <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                <Sparkles className="w-4 h-4" />
                              </div>
                              <div>
                                <div className="text-xs font-bold text-emerald-200 flex items-center gap-2">
                                  <span>Сверка речи со сценарием (Whisper ASR)</span>
                                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-300 border border-neutral-700 font-mono">
                                    модель: {gap.whisperModelUsed || 'small'}
                                  </span>
                                </div>
                                <p className="text-[11px] text-neutral-400 mt-0.5">
                                  Фраза распознана с передачей контекста из субтитров для исключения ошибок в терминах
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              {typeof gap.textSimilarityPercent === 'number' && (
                                <div className={`text-xs px-2.5 py-1 rounded-lg border font-mono font-bold ${
                                  gap.textSimilarityPercent >= 80 
                                    ? 'bg-amber-950/60 text-amber-300 border-amber-500/40' 
                                    : 'bg-red-950/60 text-red-300 border-red-500/40'
                                }`}>
                                  Сходство: {gap.textSimilarityPercent}%
                                </div>
                              )}
                              <span className="text-[11px] px-2.5 py-1 rounded-lg bg-neutral-800 text-neutral-300 border border-neutral-700 font-medium">
                                {gap.typeLabel || 'Расхождение текста'}
                              </span>
                            </div>
                          </div>

                          {/* Side-by-side script vs voiced comparison */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                            {/* Script Subtitle */}
                            <div className="bg-neutral-950/60 border border-neutral-800 rounded-xl p-3 space-y-1.5">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-semibold text-neutral-400 flex items-center gap-1.5">
                                  <FileText className="w-3.5 h-3.5 text-blue-400" />
                                  В сценарии (Субтитры):
                                </span>
                                <span className="text-[11px] text-neutral-400">
                                  {gap.characterName} {gap.lineIndex !== undefined ? `(строка #${gap.lineIndex + 1})` : ''}
                                </span>
                              </div>
                              <p className="text-xs text-neutral-200 font-medium bg-neutral-900/80 p-2.5 rounded-lg border border-neutral-800/80 leading-relaxed select-text">
                                «{gap.expectedText || gap.text}»
                              </p>
                            </div>

                            {/* Spoken in Audio Track */}
                            <div className="bg-neutral-950/60 border border-neutral-800 rounded-xl p-3 space-y-1.5">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
                                  <Mic className="w-3.5 h-3.5 text-emerald-400" />
                                  Произнесено дабером (Whisper):
                                </span>
                                <span className="text-[11px] text-neutral-400 font-bold text-amber-300">
                                  🎙 {gap.dubberName}
                                </span>
                              </div>
                              <p className="text-xs text-emerald-200 font-medium bg-neutral-900/80 p-2.5 rounded-lg border border-emerald-500/20 leading-relaxed select-text">
                                «{gap.recognizedText || '...' }»
                              </p>
                            </div>
                          </div>

                          {/* Visual Word Differences (LCS) */}
                          {gap.wordDiffs && gap.wordDiffs.length > 0 && (
                            <div className="bg-neutral-950/40 border border-neutral-800/80 rounded-xl p-3 space-y-2">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-medium text-neutral-300 flex items-center gap-1.5">
                                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                                  Пословный анализ расхождений:
                                </span>
                                <div className="flex items-center gap-2 text-[10px]">
                                  <span className="flex items-center gap-1 text-red-400">
                                    <span className="w-2 h-2 rounded-full bg-red-500"></span> Пропущено в озвучке
                                  </span>
                                  <span className="flex items-center gap-1 text-emerald-400">
                                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Добавлено / Сказано иначе
                                  </span>
                                </div>
                              </div>
                              <div className="p-2.5 bg-neutral-900/90 rounded-lg border border-neutral-800 text-xs leading-relaxed flex flex-wrap gap-1.5 select-text">
                                {gap.wordDiffs.map((diff, dIdx) => {
                                  if (diff.status === 'missing') {
                                    return (
                                      <span
                                        key={dIdx}
                                        className="px-1.5 py-0.5 rounded bg-red-950/60 text-red-300 border border-red-800/50 line-through font-medium"
                                        title="Пропущенное слово из субтитров"
                                      >
                                        {diff.word}
                                      </span>
                                    );
                                  }
                                  if (diff.status === 'added') {
                                    return (
                                      <span
                                        key={dIdx}
                                        className="px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/50 font-bold"
                                        title="Слово, произнесённое дабером (отсутствует в субтитрах)"
                                      >
                                        {diff.word}
                                      </span>
                                    );
                                  }
                                  return (
                                    <span key={dIdx} className="text-neutral-300">
                                      {diff.word}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Audio playback controls with NORMALIZED AUDIO */}
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => handlePlaySnippet(gap, 'primary')}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border shadow-sm ${
                                isPlayingPrimary
                                  ? 'bg-amber-500 text-neutral-950 border-amber-400 animate-pulse'
                                  : 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border-amber-500/40'
                              }`}
                              title="Прослушать реплику дабера (громкость автоматически нормализована)"
                            >
                              {isPlayingPrimary ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Volume2 className="w-3.5 h-3.5 text-amber-400" />}
                              <span>{isPlayingPrimary ? 'Остановить' : `Слушать дабера (${gap.dubberName})`}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handlePlaySnippet(gap, 'original')}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                                isPlayingOriginal
                                  ? 'bg-blue-600 text-white border-blue-500 font-bold animate-pulse'
                                  : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
                              }`}
                              title="Прослушать японский оригинал"
                            >
                              {isPlayingOriginal ? <Pause className="w-3 h-3 fill-current" /> : <Volume2 className="w-3 h-3 text-blue-400" />}
                              <span>Оригинал</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => onSeekMainPlayer?.(gap.startSec)}
                              className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700"
                              title="Перемотать видеоплеер на эту реплику"
                            >
                              <span>В видеоплеере ⏱</span>
                            </button>
                          </div>

                          {/* Curator decision controls: Legitimate Fix vs Actor Better vs Ignore */}
                          <div className="bg-neutral-900/95 border border-neutral-700/80 rounded-xl p-3 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-bold text-white flex items-center gap-1.5">
                                <Sliders className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Решение куратора по расхождению текста:</span>
                              </span>
                              <span className="text-[11px] text-neutral-400">
                                {gap.resolutionAction === 'legitimate_fix' && <span className="text-rose-400 font-bold">🔴 Ошибка дабера (на перезапись)</span>}
                                {gap.resolutionAction === 'actor_better_than_sub' && <span className="text-emerald-400 font-bold">✨ Актёр лучше сабов (обновить сабы)</span>}
                                {gap.resolutionAction === 'ignore' && <span className="text-neutral-400 font-bold">⚪ Пропуск / всё ок</span>}
                              </span>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              {/* 1. Легитимный фикс - дабер ошибся, надо переписать строго по сабам */}
                              <button
                                type="button"
                                onClick={() => {
                                  handleResolutionChange(gap.id, 'legitimate_fix');
                                  updateGaps(prev => prev.map(g => g.id === gap.id ? {
                                    ...g,
                                    selected: true,
                                    resolutionAction: 'legitimate_fix',
                                    comment: `[Оговорка / Не по тексту] В сценарии: "${g.expectedText || g.text}". Вы сказали: "${g.recognizedText}". Пожалуйста, перезапишите строго по тексту сценария.`
                                  } : g));
                                }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border ${
                                  gap.resolutionAction === 'legitimate_fix'
                                    ? 'bg-rose-600 text-white border-rose-500 shadow-md ring-1 ring-rose-400'
                                    : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700 hover:bg-neutral-700'
                                }`}
                              >
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-300" />
                                <span>Легитимный фикс (переписать даберу)</span>
                              </button>

                              {/* 2. Актёр лучше сабов - то, что сделал актёр, лучше сабов, оставить и обновить субтитры */}
                              <button
                                type="button"
                                onClick={() => {
                                  handleResolutionChange(gap.id, 'actor_better_than_sub');
                                  updateGaps(prev => prev.map(g => g.id === gap.id ? {
                                    ...g,
                                    selected: true,
                                    resolutionAction: 'actor_better_than_sub',
                                    comment: `Оставлено в редакции актёра («${g.recognizedText}»). Текст субтитров будет обновлен.`
                                  } : g));
                                }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border ${
                                  gap.resolutionAction === 'actor_better_than_sub'
                                    ? 'bg-emerald-600 text-white border-emerald-500 shadow-md ring-1 ring-emerald-400'
                                    : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700 hover:bg-neutral-700'
                                }`}
                              >
                                <Sparkles className="w-3.5 h-3.5 text-emerald-300" />
                                <span>Актёр лучше сабов (оставить озвучку)</span>
                              </button>

                              {/* 3. Игнорировать / Всё в норме */}
                              <button
                                type="button"
                                onClick={() => {
                                  handleResolutionChange(gap.id, 'ignore');
                                  updateGaps(prev => prev.map(g => g.id === gap.id ? {
                                    ...g,
                                    selected: false,
                                    resolutionAction: 'ignore'
                                  } : g));
                                }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border ${
                                  gap.resolutionAction === 'ignore'
                                    ? 'bg-neutral-700 text-white border-neutral-600'
                                    : 'bg-neutral-800/80 text-neutral-400 hover:text-white border-neutral-700'
                                }`}
                              >
                                <Check className="w-3.5 h-3.5 text-neutral-400" />
                                <span>Пропустить / Всё ок</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Editable Fix Comment (if checked) */}
                      {gap.selected && (
                        <div className="flex items-center gap-2 pt-1 border-t border-neutral-800/60">
                          <MessageSquare className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          <span className="text-[11px] text-neutral-400 shrink-0 font-medium">Примечание:</span>
                          <input
                            type="text"
                            value={gap.comment}
                            onChange={e => handleCommentChange(gap.id, e.target.value)}
                            className="flex-1 bg-neutral-900 border border-neutral-700/80 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
                            placeholder="Текст комментария для дабера..."
                          />
                        </div>
                      )}
    </>
  );
};
