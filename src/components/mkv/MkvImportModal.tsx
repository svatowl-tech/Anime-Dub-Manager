import React, { useState, useMemo } from 'react';
import { X, FileText, Film, Volume2, CheckSquare, Square, Layers, Check, Loader2, Info, Sparkles, ArrowRight } from 'lucide-react';
import { MkvTrackInfo, formatTrackDisplayName, formatLanguageLabel } from '../../lib/mkvSubtitleExtractor';

export interface MkvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string;
  subtitleTracks: MkvTrackInfo[];
  audioTracks: MkvTrackInfo[];
  onConfirmSingle: (selectedSubtitleIndex?: number, selectedAudioIndex?: number) => void;
  onConfirmMultiMerge: (selectedSubtitleTracks: MkvTrackInfo[], selectedAudioIndex?: number) => void;
  isProcessing?: boolean;
}

export default function MkvImportModal({
  isOpen,
  onClose,
  filePath,
  subtitleTracks,
  audioTracks,
  onConfirmSingle,
  onConfirmMultiMerge,
  isProcessing = false
}: MkvImportModalProps) {
  const [selectedSubIndexes, setSelectedSubIndexes] = useState<number[]>(() => {
    // By default, select default subtitle track if exists, or the first one if available
    const defaultTrack = subtitleTracks.find(t => t.disposition?.default);
    if (defaultTrack) return [defaultTrack.index];
    if (subtitleTracks.length > 0) return [subtitleTracks[0].index];
    return [];
  });

  const [selectedAudioIndex, setSelectedAudioIndex] = useState<number | undefined>(() => {
    const defaultAudio = audioTracks.find(t => t.disposition?.default);
    if (defaultAudio) return defaultAudio.index;
    if (audioTracks.length > 0) return audioTracks[0].index;
    return undefined;
  });

  const [activeTab, setActiveTab] = useState<'subs' | 'audio'>('subs');

  const fileName = useMemo(() => filePath.split(/[\\/]/).pop() || 'Видеофайл.mkv', [filePath]);

  if (!isOpen) return null;

  const toggleSubTrack = (index: number) => {
    setSelectedSubIndexes(prev => 
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  };

  const selectAllSubs = () => {
    setSelectedSubIndexes(subtitleTracks.map(t => t.index));
  };

  const clearAllSubs = () => {
    setSelectedSubIndexes([]);
  };

  const selectRussianSubs = () => {
    const rus = subtitleTracks.filter(t => {
      const lang = (t.tags?.language || '').toLowerCase();
      const title = (t.tags?.title || '').toLowerCase();
      return lang.includes('rus') || lang.includes('ru') || title.includes('rus') || title.includes('рус');
    });
    if (rus.length > 0) {
      setSelectedSubIndexes(rus.map(t => t.index));
    }
  };

  const selectEnglishSubs = () => {
    const eng = subtitleTracks.filter(t => {
      const lang = (t.tags?.language || '').toLowerCase();
      const title = (t.tags?.title || '').toLowerCase();
      return lang.includes('eng') || lang.includes('en') || title.includes('eng') || title.includes('англ');
    });
    if (eng.length > 0) {
      setSelectedSubIndexes(eng.map(t => t.index));
    }
  };

  const selectedSubCount = selectedSubIndexes.length;
  const selectedSubObjects = subtitleTracks.filter(t => selectedSubIndexes.includes(t.index));

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[9999] p-3 sm:p-4 overflow-y-auto">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col pointer-events-auto my-auto max-h-[90vh]">
        {/* Header */}
        <div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/70 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0 text-indigo-400">
              <Film className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-white truncate flex items-center gap-2">
                Параметры импорта MKV
              </h3>
              <p className="text-xs text-neutral-400 truncate max-w-md" title={fileName}>
                {fileName}
              </p>
            </div>
          </div>

          <button 
            onClick={onClose}
            disabled={isProcessing}
            className="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-neutral-800 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs if audio tracks exist */}
        {audioTracks.length > 1 && (
          <div className="flex border-b border-neutral-800 bg-neutral-950/40 px-4 pt-2 shrink-0">
            <button
              onClick={() => setActiveTab('subs')}
              className={`flex items-center gap-2 px-4 py-2 border-b-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
                activeTab === 'subs'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <FileText className="w-4 h-4" />
              Субтитры ({subtitleTracks.length})
              {selectedSubCount > 0 && (
                <span className="ml-1 px-1.5 py-0.2 text-[10px] bg-indigo-500/20 text-indigo-300 rounded-full border border-indigo-500/30">
                  {selectedSubCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('audio')}
              className={`flex items-center gap-2 px-4 py-2 border-b-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
                activeTab === 'audio'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Volume2 className="w-4 h-4" />
              Аудиодорожки ({audioTracks.length})
            </button>
          </div>
        )}

        {/* Body Content */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4">
          {/* Subtitles Tab */}
          {(activeTab === 'subs' || audioTracks.length <= 1) && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-neutral-800/60">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-bold text-neutral-200 uppercase tracking-wider">
                    Вшитые субтитры ({subtitleTracks.length})
                  </span>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={selectAllSubs}
                    className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white rounded text-[11px] font-medium transition-colors"
                  >
                    Выбрать все
                  </button>
                  <button
                    onClick={selectRussianSubs}
                    className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white rounded text-[11px] font-medium transition-colors"
                  >
                    Русские
                  </button>
                  <button
                    onClick={selectEnglishSubs}
                    className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white rounded text-[11px] font-medium transition-colors"
                  >
                    English
                  </button>
                  <button
                    onClick={clearAllSubs}
                    className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-red-400 hover:text-red-300 rounded text-[11px] font-medium transition-colors"
                  >
                    Сбросить
                  </button>
                </div>
              </div>

              {subtitleTracks.length === 0 ? (
                <div className="p-6 text-center bg-neutral-950/50 border border-neutral-800/80 rounded-xl">
                  <p className="text-sm text-neutral-400">В этом MKV файле нет вшитых субтитров.</p>
                  <p className="text-xs text-neutral-500 mt-1">Будет импортирован только видеоряд и аудиодорожка.</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                  {subtitleTracks.map((track) => {
                    const isSelected = selectedSubIndexes.includes(track.index);
                    const lang = formatLanguageLabel(track.tags?.language);
                    const title = track.tags?.title || '';
                    const isDef = !!track.disposition?.default;
                    const isForced = !!track.disposition?.forced;

                    return (
                      <div
                        key={track.index}
                        onClick={() => toggleSubTrack(track.index)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer flex items-start gap-3 select-none ${
                          isSelected
                            ? 'bg-indigo-950/30 border-indigo-500/60 shadow-sm'
                            : 'bg-neutral-950/60 border-neutral-800 hover:bg-neutral-800/60 hover:border-neutral-700'
                        }`}
                      >
                        <div className="pt-0.5 text-indigo-400 shrink-0">
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-indigo-400" />
                          ) : (
                            <Square className="w-4 h-4 text-neutral-500" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-xs text-white">
                              {title || `Дорожка #${track.index}`}
                            </span>

                            {lang && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                                {lang}
                              </span>
                            )}

                            {track.codec_name && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-neutral-800 text-neutral-300 border border-neutral-700">
                                {track.codec_name.toUpperCase()}
                              </span>
                            )}

                            {isDef && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                По умолчанию
                              </span>
                            )}

                            {isForced && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-500/20 text-rose-300 border border-rose-500/30">
                                Форсированные
                              </span>
                            )}
                          </div>

                          <div className="text-[11px] text-neutral-400 mt-1 flex items-center gap-3">
                            <span>Поток ID: #{track.index}</span>
                            {track.tags?.language && <span>Код: {track.tags.language}</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Multi-Sub info prompt */}
              {selectedSubCount > 1 && (
                <div className="p-3 bg-indigo-950/40 border border-indigo-800/40 rounded-xl flex items-center gap-2.5 text-xs text-indigo-200">
                  <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span>
                    Выбрано <strong>{selectedSubCount}</strong> субтитра(-ов). Они будут одновременно извлечены и открыты в модуле слияния субтитров (Multi-Sub Merge).
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Audio Tracks Selection */}
          {(activeTab === 'audio' || (audioTracks.length > 1 && activeTab === 'subs')) && (
            <div className={`space-y-3 ${activeTab === 'subs' ? 'pt-3 border-t border-neutral-800/70' : ''}`}>
              <div className="flex items-center gap-2 pb-1">
                <Volume2 className="w-4 h-4 text-blue-400" />
                <span className="text-xs font-bold text-neutral-200 uppercase tracking-wider">
                  Аудиодорожка для транскодирования / предпросмотра:
                </span>
              </div>

              <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                {audioTracks.map((track) => {
                  const isSelected = selectedAudioIndex === track.index;
                  const lang = formatLanguageLabel(track.tags?.language);
                  const title = track.tags?.title || track.codec_name || `Аудио #${track.index}`;
                  const isDef = !!track.disposition?.default;

                  return (
                    <div
                      key={track.index}
                      onClick={() => setSelectedAudioIndex(track.index)}
                      className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                        isSelected
                          ? 'bg-blue-950/30 border-blue-500/60'
                          : 'bg-neutral-950/60 border-neutral-800 hover:bg-neutral-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                          isSelected ? 'border-blue-500 bg-blue-500' : 'border-neutral-600'
                        }`}>
                          {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium text-white truncate">{title}</span>
                            {lang && (
                              <span className="px-1.5 py-0.2 text-[10px] bg-blue-500/20 text-blue-300 rounded border border-blue-500/30">
                                {lang}
                              </span>
                            )}
                            {track.codec_name && (
                              <span className="px-1 py-0.2 text-[9px] bg-neutral-800 text-neutral-400 rounded">
                                {track.codec_name.toUpperCase()}
                              </span>
                            )}
                            {isDef && (
                              <span className="text-[9px] text-amber-400">★ Основная</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <span className="text-[10px] text-neutral-500 shrink-0">
                        ID: #{track.index}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-950/80 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="w-full sm:w-auto px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-xl text-xs font-medium transition-colors cursor-pointer"
          >
            Отмена
          </button>

          <div className="w-full sm:w-auto flex items-center gap-2.5">
            {selectedSubCount >= 2 ? (
              <button
                onClick={() => onConfirmMultiMerge(selectedSubObjects, selectedAudioIndex)}
                disabled={isProcessing}
                className="flex-1 sm:flex-none px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Извлечение сабов...</span>
                  </>
                ) : (
                  <>
                    <Layers className="w-4 h-4" />
                    <span>Отправить в мульти-импорт ({selectedSubCount} сабов)</span>
                  </>
                )}
              </button>
            ) : selectedSubCount === 1 ? (
              <>
                <button
                  onClick={() => onConfirmMultiMerge(selectedSubObjects, selectedAudioIndex)}
                  disabled={isProcessing}
                  title="Открыть эту дорожку в редакторе слияния сабов"
                  className="px-3 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 rounded-xl text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  <span>В мульти-саб</span>
                </button>

                <button
                  onClick={() => onConfirmSingle(selectedSubIndexes[0], selectedAudioIndex)}
                  disabled={isProcessing}
                  className="flex-1 sm:flex-none px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Импорт...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Импортировать серию (1 саб)</span>
                    </>
                  )}
                </button>
              </>
            ) : (
              <button
                onClick={() => onConfirmSingle(undefined, selectedAudioIndex)}
                disabled={isProcessing}
                className="flex-1 sm:flex-none px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Импорт...</span>
                  </>
                ) : (
                  <>
                    <Film className="w-4 h-4" />
                    <span>Импортировать только видео</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
