import React from 'react';
import {
  X,
  Layers,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  FileText,
  Check,
  Loader2,
  Sparkles,
  Sliders,
  Users,
  UserMinus,
  UserX,
  Palette,
  AlignLeft,
  Film,
  CheckSquare,
  Square,
} from 'lucide-react';
import { Episode } from '../types';
import {
  formatLanguageLabel,
  getSplitStatusDisplay,
} from '../lib/mkvSubtitleExtractor';
import {
  useMultiSubtitleMerge,
  SubFileItem,
} from './AssEditor/merge/useMultiSubtitleMerge';

export type { SubFileItem };

export interface MultiSubtitleMergeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentEpisode: Episode | null;
  targetEpisodeId?: string;
  onRefresh: () => void;
  initialFiles?: SubFileItem[];
  initialVideoPath?: string;
}

export default function MultiSubtitleMergeModal({
  isOpen,
  onClose,
  currentEpisode,
  targetEpisodeId,
  onRefresh,
  initialFiles = [],
  initialVideoPath,
}: MultiSubtitleMergeModalProps) {
  const {
    files,
    mode,
    setMode,
    textSourceIndex,
    setTextSourceIndex,
    styleSourceIndex,
    setStyleSourceIndex,
    actorSourceIndex,
    setActorSourceIndex,
    isProcessing,
    mkvPickerOpen,
    setMkvPickerOpen,
    mkvTracks,
    selectedTrackIndexes,
    setSelectedTrackIndexes,
    isExtractingTracks,
    mkvTrackAnalyses,
    isAnalyzingMkvTracks,
    handleConfirmMkvTracks,
    handleAddFile,
    handleAddCurrentRaw,
    handleCloseModal,
    handleRemoveFile,
    handleMoveFile,
    handleMerge,
  } = useMultiSubtitleMerge({
    isOpen,
    onClose,
    currentEpisode,
    targetEpisodeId,
    onRefresh,
    initialFiles,
    initialVideoPath,
  });

  if (!isOpen || !currentEpisode) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[9999] p-3 sm:p-4 overflow-y-auto">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col pointer-events-auto max-h-[92vh] my-auto">
        {/* Header */}
        <div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/70 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Мульти-импорт и слияние субтитров
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Серия #{currentEpisode.number}
                </span>
              </h3>
              <p className="text-xs text-neutral-400">
                Импортируйте и комбинируйте дорожки из нескольких .ass/.srt или MKV-контейнеров
              </p>
            </div>
          </div>
          <button
            onClick={handleCloseModal}
            className="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-6">
          {/* Mode Selector */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => setMode('component')}
              className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                mode === 'component'
                  ? 'bg-indigo-600/15 border-indigo-500 text-white shadow-lg shadow-indigo-600/10'
                  : 'bg-neutral-950/60 border-neutral-800 text-neutral-400 hover:border-neutral-700'
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5 font-bold text-xs">
                <Sliders className={`w-4 h-4 ${mode === 'component' ? 'text-indigo-400' : 'text-neutral-500'}`} />
                <span className={mode === 'component' ? 'text-white' : 'text-neutral-300'}>
                  Компонентное слияние
                </span>
              </div>
              <p className="text-[11px] text-neutral-400 leading-normal">
                Взять текст из одних сабов, стили и шрифты из вторых, имена персонажей из третьих.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setMode('combine')}
              className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                mode === 'combine'
                  ? 'bg-indigo-600/15 border-indigo-500 text-white shadow-lg shadow-indigo-600/10'
                  : 'bg-neutral-950/60 border-neutral-800 text-neutral-400 hover:border-neutral-700'
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5 font-bold text-xs">
                <Plus className={`w-4 h-4 ${mode === 'combine' ? 'text-indigo-400' : 'text-neutral-500'}`} />
                <span className={mode === 'combine' ? 'text-white' : 'text-neutral-300'}>
                  Полное объединение
                </span>
              </div>
              <p className="text-[11px] text-neutral-400 leading-normal">
                Склеить все реплики и надписи вместе (например, диалоги + караоке/надписи).
              </p>
            </button>

            <button
              type="button"
              onClick={() => setMode('smart')}
              className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                mode === 'smart'
                  ? 'bg-indigo-600/15 border-indigo-500 text-white shadow-lg shadow-indigo-600/10'
                  : 'bg-neutral-950/60 border-neutral-800 text-neutral-400 hover:border-neutral-700'
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5 font-bold text-xs">
                <Sparkles className={`w-4 h-4 ${mode === 'smart' ? 'text-indigo-400' : 'text-neutral-500'}`} />
                <span className={mode === 'smart' ? 'text-white' : 'text-neutral-300'}>
                  Умное слияние (Smart)
                </span>
              </div>
              <p className="text-[11px] text-neutral-400 leading-normal">
                Слияние с авто-дедупликацией совпадающих таймингов и заполнением пробелов.
              </p>
            </button>
          </div>

          {/* Files List Card */}
          <div className="bg-neutral-950/70 border border-neutral-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-neutral-300 uppercase tracking-wider flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-400" />
                Исходные дорожки субтитров ({files.length})
              </span>
              <div className="flex items-center gap-2">
                {currentEpisode.rawPath && (
                  <button
                    type="button"
                    onClick={handleAddCurrentRaw}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                  >
                    <Film className="w-3.5 h-3.5 text-purple-400" />
                    Извлечь из RAW серии
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleAddFile}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Добавить файл / MKV
                </button>
              </div>
            </div>

            {files.length === 0 ? (
              <div
                onClick={handleAddFile}
                className="border-2 border-dashed border-neutral-800 hover:border-indigo-500/50 rounded-xl p-8 text-center cursor-pointer transition-all bg-neutral-900/30 hover:bg-neutral-900/60 group"
              >
                <div className="w-12 h-12 rounded-full bg-neutral-800 group-hover:bg-indigo-500/20 text-neutral-400 group-hover:text-indigo-400 flex items-center justify-center mx-auto mb-3 transition-colors">
                  <Layers className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-semibold text-neutral-200 mb-1">
                  Нажмите, чтобы добавить субтитры (.ass, .srt, .vtt) или MKV/видеофайл
                </h4>
                <p className="text-xs text-neutral-500 max-w-md mx-auto">
                  Поддерживается одновременное объединение текстов, стилей и персонажей из разных субтитров и видеоконтейнеров (например, Softsub MKV, Fansub ASS).
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                {files.map((file, index) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between p-3 bg-neutral-900/80 border border-neutral-800 rounded-xl hover:border-neutral-700 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="w-6 h-6 rounded-lg bg-neutral-800 text-neutral-400 flex items-center justify-center text-xs font-mono font-bold shrink-0">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs text-neutral-200 truncate">
                            {file.name}
                          </span>
                          {file.sourceType === 'mkv' ? (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20 shrink-0">
                              MKV Stream
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">
                              Файл
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-neutral-500 mt-0.5">
                          <span>Строк: <strong>{file.lineCount}</strong></span>
                          <span>Персонажей: <strong>{file.actors.length}</strong></span>
                          {file.actors.length > 0 && (
                            <span className="truncate max-w-xs text-neutral-400">
                              ({file.actors.slice(0, 3).join(', ')}{file.actors.length > 3 ? '...' : ''})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 ml-3">
                      <button
                        type="button"
                        onClick={() => handleMoveFile(index, 'up')}
                        disabled={index === 0}
                        className="p-1 text-neutral-500 hover:text-white disabled:opacity-30 rounded hover:bg-neutral-800 cursor-pointer"
                        title="Поднять выше"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveFile(index, 'down')}
                        disabled={index === files.length - 1}
                        className="p-1 text-neutral-500 hover:text-white disabled:opacity-30 rounded hover:bg-neutral-800 cursor-pointer"
                        title="Опустить ниже"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveFile(file.id)}
                        className="p-1 text-neutral-500 hover:text-red-400 rounded hover:bg-neutral-800 cursor-pointer"
                        title="Удалить из списка"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Component Mode Specific Mapping Options */}
          {mode === 'component' && files.length > 0 && (
            <div className="bg-neutral-950/70 border border-neutral-800 rounded-xl p-4 space-y-4">
              <span className="text-xs font-bold text-neutral-300 uppercase tracking-wider flex items-center gap-2">
                <Sliders className="w-4 h-4 text-indigo-400" />
                Настройка источников компонентов
              </span>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Text Source */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-neutral-300 flex items-center gap-1.5">
                    <AlignLeft className="w-3.5 h-3.5 text-blue-400" />
                    Источник текста и таймингов:
                  </label>
                  <select
                    value={textSourceIndex}
                    onChange={(e) => setTextSourceIndex(Number(e.target.value))}
                    className="w-full bg-neutral-900 border border-neutral-800 text-xs rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                  >
                    {files.map((file, idx) => (
                      <option key={file.id} value={idx}>
                        #{idx + 1}: {file.name} ({file.lineCount} строк)
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-neutral-500">
                    Отсюда будут взяты основные реплики, тайминги и порядок фраз.
                  </p>
                </div>

                {/* Style Source */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-neutral-300 flex items-center gap-1.5">
                    <Palette className="w-3.5 h-3.5 text-pink-400" />
                    Источник стилей оформления:
                  </label>
                  <select
                    value={styleSourceIndex}
                    onChange={(e) => setStyleSourceIndex(Number(e.target.value))}
                    className="w-full bg-neutral-900 border border-neutral-800 text-xs rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                  >
                    {files.map((file, idx) => (
                      <option key={file.id} value={idx}>
                        #{idx + 1}: {file.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-neutral-500">
                    Секция [V4+ Styles] и стилизация реплик будут взяты из этого файла.
                  </p>
                </div>

                {/* Actor Source */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-neutral-300 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-emerald-400" />
                    Источник имен персонажей (Актеров):
                  </label>
                  <select
                    value={actorSourceIndex}
                    onChange={(e) => setActorSourceIndex(Number(e.target.value))}
                    className="w-full bg-neutral-900 border border-neutral-800 text-xs rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value={-1}>Из источника текста (по умолчанию)</option>
                    {files.map((file, idx) => (
                      <option key={file.id} value={idx}>
                        #{idx + 1}: {file.name} ({file.actors.length} персонажей)
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-neutral-500">
                    Автоматически подставит имена персонажей из другого релиза по совпадению тайминга.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-950/80 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={handleCloseModal}
            className="px-4 py-2 rounded-xl text-xs text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            Отмена
          </button>

          <button
            type="button"
            onClick={handleMerge}
            disabled={files.length === 0 || isProcessing}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold transition-all cursor-pointer shadow-lg shadow-indigo-600/20"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Объединение...</span>
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>Объединить и применить к серии</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Internal MKV Track Picker Modal */}
      {mkvPickerOpen && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-[10000] p-4 backdrop-blur-md">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg p-5 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3 shrink-0">
              <h4 className="font-bold text-white flex items-center gap-2 text-sm">
                <Film className="w-4 h-4 text-purple-400" />
                Выберите субтитры из MKV
              </h4>
              <button
                type="button"
                onClick={() => setMkvPickerOpen(false)}
                className="text-neutral-400 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 shrink-0">
              <p className="text-xs text-neutral-400">
                Найдено дорожек: <strong>{mkvTracks.length}</strong>
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedTrackIndexes(mkvTracks.map(t => t.index))}
                  className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white rounded text-[10px] font-medium transition-colors cursor-pointer"
                >
                  Выбрать все
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedTrackIndexes([])}
                  className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-red-400 hover:text-red-300 rounded text-[10px] font-medium transition-colors cursor-pointer"
                >
                  Снять выбор
                </button>
              </div>
            </div>

            <div className="space-y-2 overflow-y-auto flex-1 max-h-64 pr-1">
              {mkvTracks.map((track) => {
                const isSelected = selectedTrackIndexes.includes(track.index);
                const title = track.tags?.title || `Дорожка #${track.index}`;
                const lang = formatLanguageLabel(track.tags?.language);
                const codec = track.codec_name || 'sub';
                const analysis = mkvTrackAnalyses[track.index];
                const display = analysis ? getSplitStatusDisplay(analysis.splitStatus) : null;

                return (
                  <div
                    key={track.index}
                    onClick={() => {
                      if (isSelected) {
                        setSelectedTrackIndexes(prev => prev.filter(i => i !== track.index));
                      } else {
                        setSelectedTrackIndexes(prev => [...prev, track.index]);
                      }
                    }}
                    className={`flex flex-col gap-1.5 p-2.5 rounded-xl border cursor-pointer transition-all text-xs select-none ${
                      isSelected
                        ? 'bg-purple-600/15 border-purple-500/80 text-white'
                        : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:border-neutral-700'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="pt-0.5 text-purple-400 shrink-0">
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-purple-400" />
                        ) : (
                          <Square className="w-4 h-4 text-neutral-600" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-neutral-200 truncate">{title}</span>
                          {lang && <span className="bg-purple-500/20 text-purple-300 border border-purple-500/30 px-1.5 py-0.2 rounded font-mono text-[9px]">{lang}</span>}
                          <span className="uppercase font-mono bg-neutral-800 px-1 rounded text-[9px]">{codec}</span>
                          <span className="text-[10px] text-neutral-500">#{track.index}</span>
                        </div>
                      </div>
                    </div>

                    {display && analysis ? (
                      <div className="flex items-center justify-between gap-2 text-[10px] pt-1 border-t border-neutral-800/60 pl-6 flex-wrap">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded border font-semibold ${display.badgeClass}`}>
                          <span className={`w-1 h-1 rounded-full ${display.dotClass}`} />
                          {analysis.splitStatus === 'full' && <Users className="w-3 h-3" />}
                          {analysis.splitStatus === 'partial' && <UserMinus className="w-3 h-3" />}
                          {analysis.splitStatus === 'none' && <UserX className="w-3 h-3" />}
                          {display.label}
                        </span>

                        <span className="text-neutral-400">
                          {analysis.splitStatus === 'full' || analysis.splitStatus === 'partial' ? (
                            <span>{analysis.characterCount} персонажей • {analysis.namedPercentage}% строк</span>
                          ) : (
                            <span>Сплошной текст ({analysis.totalLines} стр.)</span>
                          )}
                        </span>
                      </div>
                    ) : isAnalyzingMkvTracks ? (
                      <div className="flex items-center gap-1 text-[10px] text-neutral-500 pl-6">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>Определение ролей...</span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-800 shrink-0">
              <button
                type="button"
                onClick={() => setMkvPickerOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleConfirmMkvTracks}
                disabled={selectedTrackIndexes.length === 0 || isExtractingTracks}
                className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-all cursor-pointer"
              >
                {isExtractingTracks ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Извлечение...
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Извлечь выбранное ({selectedTrackIndexes.length})
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
