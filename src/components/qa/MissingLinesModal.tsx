import React, { useState, useEffect } from 'react';
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
  Search, 
  Scissors, 
  MessageSquare,
  Sparkles,
  Sliders
} from 'lucide-react';
import { MissingLineDetection, SnippetAudioPlayer } from '../../lib/qa/missingLinesDetector';

interface MissingLinesModalProps {
  isOpen: boolean;
  onClose: () => void;
  gaps: MissingLineDetection[];
  onApplyFixes: (selectedGaps: MissingLineDetection[]) => Promise<void>;
  onSeekMainPlayer?: (timeSec: number) => void;
  isApplying?: boolean;
  onReAnalyze?: () => void;
  isAnalyzing?: boolean;
}

export const MissingLinesModal: React.FC<MissingLinesModalProps> = ({
  isOpen,
  onClose,
  gaps: initialGaps,
  onApplyFixes,
  onSeekMainPlayer,
  isApplying = false,
  onReAnalyze,
  isAnalyzing = false
}) => {
  const [gaps, setGaps] = useState<MissingLineDetection[]>(initialGaps);
  const [selectedDubberFilter, setSelectedDubberFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'silence' | 'noise'>('all');
  const [playingGapId, setPlayingGapId] = useState<string | null>(null);

  useEffect(() => {
    setGaps(initialGaps);
  }, [initialGaps]);

  // Cleanup audio playback on unmount or close
  useEffect(() => {
    return () => {
      SnippetAudioPlayer.stop();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // Dubbers list for filter chips
  const dubbers = Array.from(new Set(gaps.map(g => g.dubberName)));

  // Filtered gaps
  const filteredGaps = gaps.filter(gap => {
    if (selectedDubberFilter !== 'all' && gap.dubberName !== selectedDubberFilter) {
      return false;
    }
    if (typeFilter !== 'all' && gap.type !== typeFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchText = gap.text.toLowerCase().includes(q);
      const matchChar = gap.characterName.toLowerCase().includes(q);
      const matchDubber = gap.dubberName.toLowerCase().includes(q);
      if (!matchText && !matchChar && !matchDubber) return false;
    }
    return true;
  });

  const selectedCount = gaps.filter(g => g.selected).length;
  const uniqueDubbersAffected = new Set(gaps.filter(g => g.selected).map(g => g.dubberName)).size;

  const handleToggleSelectAll = (select: boolean) => {
    setGaps(prev => prev.map(g => {
      // If a filter is applied, only affect matching gaps
      const matchesFilter = (selectedDubberFilter === 'all' || g.dubberName === selectedDubberFilter) &&
                            (typeFilter === 'all' || g.type === typeFilter);
      return matchesFilter ? { ...g, selected: select } : g;
    }));
  };

  const handleToggleSingle = (id: string) => {
    setGaps(prev => prev.map(g => g.id === id ? { ...g, selected: !g.selected } : g));
  };

  const handleCommentChange = (id: string, newComment: string) => {
    setGaps(prev => prev.map(g => g.id === id ? { ...g, comment: newComment } : g));
  };

  const handleRemoveGap = (id: string) => {
    if (playingGapId === id) {
      SnippetAudioPlayer.stop();
      setPlayingGapId(null);
    }
    setGaps(prev => prev.filter(g => g.id !== id));
  };

  const handlePlaySnippet = (gap: MissingLineDetection) => {
    if (playingGapId === gap.id) {
      SnippetAudioPlayer.stop();
      setPlayingGapId(null);
      return;
    }

    if (!gap.audioBuffer) return;

    setPlayingGapId(gap.id);
    SnippetAudioPlayer.play(gap.audioBuffer, gap.startSec, gap.endSec, () => {
      setPlayingGapId(null);
    });
  };

  const handleSubmit = async () => {
    const selected = gaps.filter(g => g.selected);
    if (selected.length === 0) return;
    SnippetAudioPlayer.stop();
    await onApplyFixes(selected);
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-5xl h-[90vh] max-h-[850px] flex flex-col overflow-hidden text-neutral-200">
        
        {/* Header */}
        <div className="p-5 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Scissors className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white">Автоматическая проверка пропусков</h2>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 font-semibold font-mono">
                  {gaps.length} {gaps.length === 1 ? 'пропуск' : gaps.length < 5 ? 'пропуска' : 'пропусков'}
                </span>
              </div>
              <p className="text-xs text-neutral-400 mt-0.5">
                Обнаружены субтитры без речевого сигнала на аудиодорожках даберов (пустота или фоновый шум)
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {onReAnalyze && (
              <button
                onClick={onReAnalyze}
                disabled={isAnalyzing}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                title="Повторить сканирование аудиодорожек"
              >
                <Sparkles className={`w-3.5 h-3.5 text-amber-400 ${isAnalyzing ? 'animate-spin' : ''}`} />
                {isAnalyzing ? 'Анализ...' : 'Пересканировать'}
              </button>
            )}
            <button 
              onClick={() => {
                SnippetAudioPlayer.stop();
                onClose();
              }} 
              className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="p-4 border-b border-neutral-800 bg-neutral-950/40 space-y-3 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Dubber Filter Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1 scrollbar-hide">
              <span className="text-xs text-neutral-500 font-medium mr-1 shrink-0">Дабер:</span>
              <button
                onClick={() => setSelectedDubberFilter('all')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all shrink-0 ${
                  selectedDubberFilter === 'all'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-neutral-800 text-neutral-400 hover:text-white'
                }`}
              >
                Все ({gaps.length})
              </button>
              {dubbers.map(dubber => {
                const count = gaps.filter(g => g.dubberName === dubber).length;
                return (
                  <button
                    key={dubber}
                    onClick={() => setSelectedDubberFilter(dubber)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-all shrink-0 ${
                      selectedDubberFilter === dubber
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-neutral-800 text-neutral-400 hover:text-white'
                    }`}
                  >
                    {dubber} ({count})
                  </button>
                );
              })}
            </div>

            {/* Selection Quick Actions */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => handleToggleSelectAll(true)}
                className="px-2.5 py-1 text-xs text-blue-400 hover:bg-blue-600/10 rounded-md transition-colors font-medium flex items-center gap-1"
              >
                <CheckSquare className="w-3.5 h-3.5" />
                Выбрать все
              </button>
              <span className="text-neutral-700">|</span>
              <button
                onClick={() => handleToggleSelectAll(false)}
                className="px-2.5 py-1 text-xs text-neutral-400 hover:bg-neutral-800 rounded-md transition-colors font-medium flex items-center gap-1"
              >
                <Square className="w-3.5 h-3.5" />
                Снять все
              </button>
            </div>
          </div>

          {/* Search & Type Filter Row */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Поиск по тексту реплики или персонажу..."
                className="w-full bg-neutral-800/80 border border-neutral-700/80 text-white text-xs rounded-lg pl-9 pr-4 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-neutral-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 bg-neutral-800/80 border border-neutral-700/80 rounded-lg p-0.5 text-xs">
              <button
                onClick={() => setTypeFilter('all')}
                className={`px-2.5 py-1 rounded-md transition-colors ${typeFilter === 'all' ? 'bg-neutral-700 text-white font-medium' : 'text-neutral-400 hover:text-neutral-200'}`}
              >
                Все типы
              </button>
              <button
                onClick={() => setTypeFilter('silence')}
                className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 ${typeFilter === 'silence' ? 'bg-red-500/20 text-red-300 font-medium' : 'text-neutral-400 hover:text-neutral-200'}`}
              >
                <VolumeX className="w-3 h-3 text-red-400" />
                Тишина
              </button>
              <button
                onClick={() => setTypeFilter('noise')}
                className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 ${typeFilter === 'noise' ? 'bg-amber-500/20 text-amber-300 font-medium' : 'text-neutral-400 hover:text-neutral-200'}`}
              >
                <Volume2 className="w-3 h-3 text-amber-400" />
                Шум без речи
              </button>
            </div>
          </div>
        </div>

        {/* Gaps List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
          {filteredGaps.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-neutral-500">
              <Check className="w-12 h-12 text-emerald-500/40 mb-3" />
              <div className="text-base font-semibold text-neutral-300">
                {gaps.length === 0 ? 'Пропусков не обнаружено!' : 'Ничего не найдено по заданным фильтрам'}
              </div>
              <p className="text-xs text-neutral-500 mt-1 max-w-sm">
                {gaps.length === 0 
                  ? 'Все реплики субтитров содержат активный звуковой сигнал на дорожках даберов.' 
                  : 'Попробуйте сбросить фильтр или строку поиска.'}
              </p>
            </div>
          ) : (
            filteredGaps.map(gap => {
              const isPlaying = playingGapId === gap.id;

              return (
                <div
                  key={gap.id}
                  className={`p-4 rounded-xl border transition-all ${
                    gap.selected
                      ? 'bg-neutral-800/40 border-neutral-700 hover:border-neutral-600'
                      : 'bg-neutral-900/30 border-neutral-800/60 opacity-60'
                  }`}
                >
                  <div className="flex items-start gap-3.5">
                    {/* Checkbox */}
                    <button
                      onClick={() => handleToggleSingle(gap.id)}
                      className={`mt-1 p-0.5 rounded transition-colors ${
                        gap.selected ? 'text-blue-400 hover:text-blue-300' : 'text-neutral-600 hover:text-neutral-400'
                      }`}
                      title={gap.selected ? "Исключить из фиксов" : "Включить в фиксы"}
                    >
                      {gap.selected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                    </button>

                    {/* Main Content */}
                    <div className="flex-1 min-w-0 space-y-2.5">
                      {/* Top Info Bar */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {/* Timecode button */}
                          <button
                            onClick={() => onSeekMainPlayer?.(gap.startSec)}
                            className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs font-mono font-bold hover:bg-blue-500/20 transition-colors"
                            title="Перемотать плеер на таймкод реплики"
                          >
                            ⏱ {gap.startFormatted} – {gap.endFormatted} ({gap.durationSec}с)
                          </button>

                          {/* Dubber & Character Badges */}
                          <span className="text-xs font-bold text-white bg-neutral-800 px-2 py-0.5 rounded border border-neutral-700">
                            🎙 {gap.dubberName}
                          </span>
                          <span className="text-xs font-medium text-neutral-300 bg-neutral-800/70 px-2 py-0.5 rounded">
                            🎭 {gap.characterName}
                          </span>
                        </div>

                        {/* Audio Status Metrics */}
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                              gap.type === 'silence'
                                ? 'bg-red-500/10 text-red-400 border-red-500/30'
                                : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                            }`}
                            title={`Пик: ${gap.peakDb} dBFS, RMS: ${gap.rmsDb} dBFS`}
                          >
                            {gap.type === 'silence' ? '🔇 Тишина' : '〰 Фоновый шум'} ({gap.peakDb} dBFS)
                          </span>

                          {/* Play Snippet Button */}
                          {gap.audioBuffer && (
                            <button
                              onClick={() => handlePlaySnippet(gap)}
                              className={`p-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1 border ${
                                isPlaying
                                  ? 'bg-amber-500 text-black border-amber-400 shadow-md shadow-amber-500/20 animate-pulse'
                                  : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700 hover:bg-neutral-700'
                              }`}
                              title={isPlaying ? "Остановить прослушивание" : "Прослушать этот таймкод на дорожке дабера"}
                            >
                              {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                              <span className="text-[10px] font-bold">{isPlaying ? 'Стоп' : 'Тест звука'}</span>
                            </button>
                          )}

                          {/* Remove button */}
                          <button
                            onClick={() => handleRemoveGap(gap.id)}
                            className="p-1 text-neutral-500 hover:text-red-400 rounded transition-colors"
                            title="Убрать из списка (не является пропуском)"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Subtitle Quote */}
                      <div className="bg-black/40 border border-neutral-800 rounded-lg p-2.5 text-xs text-neutral-200">
                        <span className="text-neutral-500 font-semibold select-none mr-1.5">Текст субтитра:</span>
                        <span className="font-medium text-amber-200/90 italic">"{gap.text}"</span>
                      </div>

                      {/* Editable Fix Comment */}
                      {gap.selected && (
                        <div className="flex items-center gap-2 pt-1">
                          <MessageSquare className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          <span className="text-[11px] text-neutral-400 shrink-0 font-medium">Комментарий фикса:</span>
                          <input
                            type="text"
                            value={gap.comment}
                            onChange={e => handleCommentChange(gap.id, e.target.value)}
                            className="flex-1 bg-neutral-900 border border-neutral-700/80 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
                            placeholder="Текст комментария для дабера..."
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-900/95 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4 text-xs">
            <span className="text-neutral-400">
              Выбрано: <strong className="text-white font-bold">{selectedCount}</strong> из {gaps.length} пропусков
            </span>
            {uniqueDubbersAffected > 0 && (
              <span className="text-neutral-500">
                (Затронуто даберов: <strong className="text-amber-400">{uniqueDubbersAffected}</strong>)
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                SnippetAudioPlayer.stop();
                onClose();
              }}
              className="px-5 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white text-xs font-bold transition-colors"
            >
              Отмена
            </button>

            <button
              onClick={handleSubmit}
              disabled={selectedCount === 0 || isApplying}
              className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold transition-all flex items-center gap-2 shadow-lg shadow-blue-500/20"
            >
              {isApplying ? (
                <>
                  <Sparkles className="w-4 h-4 animate-spin" />
                  Запись фиксов...
                </>
              ) : (
                <>
                  <Scissors className="w-4 h-4" />
                  Сформировать фиксы ({selectedCount})
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
