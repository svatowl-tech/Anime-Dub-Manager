import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  FileText,
  Film,
  Volume2,
  CheckSquare,
  Square,
  Layers,
  Check,
  Loader2,
  Sparkles,
  Users,
  UserMinus,
  UserX,
  Star,
  ChevronDown,
  ChevronUp,
  RefreshCw
} from 'lucide-react';
import {
  MkvTrackInfo,
  formatLanguageLabel,
  SubtitleCharacterAnalysis,
  SubtitleSplitStatus,
  analyzeAllMkvSubtitleTracks,
  getSplitStatusDisplay
} from '../../lib/mkvSubtitleExtractor';

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

function getCharactersDeclension(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 19) return 'персонажей';
  if (mod10 === 1) return 'персонаж';
  if (mod10 >= 2 && mod10 <= 4) return 'персонажа';
  return 'персонажей';
}

function CharacterSplitBadge({
  analysis,
  isLoading,
  onToggleExpand,
  isExpanded
}: {
  analysis?: SubtitleCharacterAnalysis;
  isLoading?: boolean;
  onToggleExpand?: () => void;
  isExpanded?: boolean;
}) {
  if (isLoading) {
    return (
      <div className="mt-2 pt-2 border-t border-neutral-800/60 flex items-center gap-1.5 text-[11px] text-neutral-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
        <span>Определение персонажей и ролей...</span>
      </div>
    );
  }

  if (!analysis) return null;

  const display = getSplitStatusDisplay(analysis.splitStatus);

  return (
    <div className="mt-2.5 pt-2 border-t border-neutral-800/60 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Main Status Badge */}
          <div
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${display.badgeClass}`}
            title={display.description}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${display.dotClass}`} />
            {analysis.splitStatus === 'full' && <Users className="w-3.5 h-3.5 shrink-0" />}
            {analysis.splitStatus === 'partial' && <UserMinus className="w-3.5 h-3.5 shrink-0" />}
            {analysis.splitStatus === 'none' && <UserX className="w-3.5 h-3.5 shrink-0" />}
            <span>{display.label}</span>
          </div>

          {/* Recommended for dubbing badge */}
          {analysis.isRecommendedForDubbing && (
            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/35 text-amber-300 text-[11px] font-bold">
              <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
              <span>Рекомендуется для озвучки</span>
            </div>
          )}

          {/* Details */}
          <span className="text-[11px] text-neutral-400">
            {analysis.splitStatus === 'full' || analysis.splitStatus === 'partial' ? (
              <>
                <strong className="text-neutral-200">{analysis.characterCount}</strong> {getCharactersDeclension(analysis.characterCount)} •{' '}
                <strong className="text-neutral-200">{analysis.namedPercentage}%</strong> строк ({analysis.namedLines}/{analysis.totalLines})
              </>
            ) : (
              <>
                {analysis.totalLines > 0 ? (
                  <span>Сплошной текст без разделения ролей ({analysis.totalLines} строк)</span>
                ) : (
                  <span>Только знаки или без диалогов</span>
                )}
              </>
            )}
          </span>
        </div>

        {/* Expand/Collapse characters toggle */}
        {analysis.allCharacters && analysis.allCharacters.length > 0 && onToggleExpand && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5 hover:underline ml-auto"
          >
            <span>{isExpanded ? 'Скрыть список' : `Все роли (${analysis.characterCount})`}</span>
            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        )}
      </div>

      {/* Visual coverage bar */}
      {analysis.totalLines > 0 && (
        <div className="w-full bg-neutral-800 rounded-full h-1 overflow-hidden flex">
          <div
            className={`h-full transition-all duration-300 ${
              analysis.splitStatus === 'full'
                ? 'bg-emerald-500'
                : analysis.splitStatus === 'partial'
                ? 'bg-amber-500'
                : 'bg-neutral-600'
            }`}
            style={{ width: `${Math.max(analysis.namedPercentage, analysis.namedLines > 0 ? 5 : 0)}%` }}
          />
        </div>
      )}

      {/* Top Characters Chips */}
      {analysis.topCharacters && analysis.topCharacters.length > 0 && !isExpanded && (
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          <span className="text-[10px] text-neutral-500 font-medium">Персонажи:</span>
          {analysis.topCharacters.slice(0, 5).map((char, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-neutral-800/90 text-neutral-300 text-[10px] border border-neutral-700/60"
            >
              <span className="font-medium text-white">{char.name}</span>
              <span className="text-neutral-400 text-[9px]">({char.count})</span>
            </span>
          ))}
          {analysis.characterCount > 5 && onToggleExpand && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand();
              }}
              className="px-1.5 py-0.5 rounded bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-300 text-[10px] border border-indigo-700/50 transition-colors"
            >
              +{analysis.characterCount - 5} еще
            </button>
          )}
        </div>
      )}

      {/* Expanded full characters list */}
      {isExpanded && analysis.allCharacters && analysis.allCharacters.length > 0 && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="p-2.5 rounded-lg bg-neutral-900 border border-neutral-800 text-[11px] mt-1 space-y-1.5"
        >
          <div className="text-[10px] text-neutral-400 font-medium pb-1 border-b border-neutral-800 flex items-center justify-between">
            <span>Все найденные персонажи ({analysis.characterCount}):</span>
            <span className="text-neutral-500">Количество реплик</span>
          </div>
          <div className="max-h-36 overflow-y-auto pr-1 flex flex-wrap gap-1.5 pt-1">
            {analysis.topCharacters.map((char, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-neutral-800 text-neutral-200 border border-neutral-700 text-[10px]"
              >
                <span className="font-semibold text-white">{char.name}</span>
                <span className="text-neutral-400">({char.count})</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
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
  const [trackAnalyses, setTrackAnalyses] = useState<Record<number, SubtitleCharacterAnalysis>>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [characterFilter, setCharacterFilter] = useState<'all' | 'full' | 'partial' | 'none' | 'rus'>('all');
  const [expandedCharactersTrack, setExpandedCharactersTrack] = useState<number | null>(null);

  const fileName = useMemo(() => filePath.split(/[\\/]/).pop() || 'Видеофайл.mkv', [filePath]);

  // Analyze MKV subtitle tracks for character split on modal open
  useEffect(() => {
    if (!isOpen || !filePath || subtitleTracks.length === 0) return;

    let isMounted = true;
    setIsAnalyzing(true);

    analyzeAllMkvSubtitleTracks(filePath, subtitleTracks, (trackIndex, analysis) => {
      if (!isMounted) return;
      setTrackAnalyses(prev => ({
        ...prev,
        [trackIndex]: analysis
      }));
    }).then((allAnalyses) => {
      if (!isMounted) return;
      setTrackAnalyses(allAnalyses);
      setIsAnalyzing(false);

      // Auto-select recommended track or the best full-split track
      const recommendedIdxStr = Object.keys(allAnalyses).find(k => allAnalyses[Number(k)]?.isRecommendedForDubbing);
      if (recommendedIdxStr) {
        setSelectedSubIndexes([Number(recommendedIdxStr)]);
      } else {
        const fullSplitIdxStr = Object.keys(allAnalyses).find(k => allAnalyses[Number(k)]?.splitStatus === 'full');
        if (fullSplitIdxStr) {
          setSelectedSubIndexes([Number(fullSplitIdxStr)]);
        }
      }
    }).catch((err) => {
      if (!isMounted) return;
      console.error('Failed to analyze subtitle tracks:', err);
      setIsAnalyzing(false);
    });

    return () => {
      isMounted = false;
    };
  }, [isOpen, filePath, subtitleTracks]);

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

  const selectBestSplitSub = () => {
    // Pick the track with recommended status or best full split
    let bestIdx = -1;
    let maxScore = -1;

    for (const track of subtitleTracks) {
      const analysis = trackAnalyses[track.index];
      if (!analysis) continue;
      let score = 0;
      if (analysis.isRecommendedForDubbing) score += 1000;
      if (analysis.splitStatus === 'full') score += 500;
      if (analysis.splitStatus === 'partial') score += 100;
      score += analysis.characterCount * 10 + analysis.namedPercentage;

      const lang = (track.tags?.language || '').toLowerCase();
      if (lang.includes('ru')) score += 50;

      if (score > maxScore) {
        maxScore = score;
        bestIdx = track.index;
      }
    }

    if (bestIdx !== -1) {
      setSelectedSubIndexes([bestIdx]);
    } else if (subtitleTracks.length > 0) {
      setSelectedSubIndexes([subtitleTracks[0].index]);
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

  // Split status counts for filters
  const fullSplitCount = subtitleTracks.filter(t => trackAnalyses[t.index]?.splitStatus === 'full').length;
  const partialSplitCount = subtitleTracks.filter(t => trackAnalyses[t.index]?.splitStatus === 'partial').length;
  const noneSplitCount = subtitleTracks.filter(t => trackAnalyses[t.index]?.splitStatus === 'none').length;

  const filteredSubtitleTracks = subtitleTracks.filter(track => {
    const analysis = trackAnalyses[track.index];
    if (characterFilter === 'all') return true;
    if (characterFilter === 'full') return analysis?.splitStatus === 'full';
    if (characterFilter === 'partial') return analysis?.splitStatus === 'partial';
    if (characterFilter === 'none') return analysis?.splitStatus === 'none';
    if (characterFilter === 'rus') {
      const lang = (track.tags?.language || '').toLowerCase();
      const title = (track.tags?.title || '').toLowerCase();
      return lang.includes('rus') || lang.includes('ru') || title.includes('rus') || title.includes('рус');
    }
    return true;
  });

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

        {/* Modal Body */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          {/* Subtitles Tab */}
          {(activeTab === 'subs' || audioTracks.length <= 1) && (
            <div className="space-y-3">
              {/* Header bar with filters */}
              <div className="space-y-2 pb-2 border-b border-neutral-800/60">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-bold text-neutral-200 uppercase tracking-wider">
                      Вшитые субтитры ({subtitleTracks.length})
                    </span>
                    {isAnalyzing && (
                      <span className="flex items-center gap-1 text-[11px] text-indigo-400">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Анализ ролей...
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {/* Quick choose best track button */}
                    <button
                      type="button"
                      onClick={selectBestSplitSub}
                      className="px-2.5 py-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg text-[11px] font-semibold transition-all shadow-sm flex items-center gap-1"
                      title="Выбрать дорожку с наилучшим разделением на персонажей"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>Выбрать с персонажами</span>
                    </button>

                    <button
                      onClick={selectRussianSubs}
                      className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white rounded text-[11px] font-medium transition-colors"
                    >
                      Русские
                    </button>
                    <button
                      onClick={selectAllSubs}
                      className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white rounded text-[11px] font-medium transition-colors"
                    >
                      Все
                    </button>
                    <button
                      onClick={clearAllSubs}
                      className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-red-400 hover:text-red-300 rounded text-[11px] font-medium transition-colors"
                    >
                      Сбросить
                    </button>
                  </div>
                </div>

                {/* Filter tags by character division status */}
                {subtitleTracks.length > 1 && (
                  <div className="flex items-center gap-1.5 flex-wrap pt-1">
                    <span className="text-[10px] text-neutral-500 font-medium mr-0.5">Фильтр:</span>
                    <button
                      type="button"
                      onClick={() => setCharacterFilter('all')}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                        characterFilter === 'all'
                          ? 'bg-neutral-700 text-white font-bold'
                          : 'bg-neutral-800/80 hover:bg-neutral-700 text-neutral-400'
                      }`}
                    >
                      Все ({subtitleTracks.length})
                    </button>

                    {fullSplitCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setCharacterFilter('full')}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors flex items-center gap-1 ${
                          characterFilter === 'full'
                            ? 'bg-emerald-600 text-white font-bold'
                            : 'bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-300 border border-emerald-800/40'
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        Разделены ({fullSplitCount})
                      </button>
                    )}

                    {partialSplitCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setCharacterFilter('partial')}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors flex items-center gap-1 ${
                          characterFilter === 'partial'
                            ? 'bg-amber-600 text-white font-bold'
                            : 'bg-amber-950/40 hover:bg-amber-900/50 text-amber-300 border border-amber-800/40'
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                        Частично ({partialSplitCount})
                      </button>
                    )}

                    {noneSplitCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setCharacterFilter('none')}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors flex items-center gap-1 ${
                          characterFilter === 'none'
                            ? 'bg-neutral-600 text-white font-bold'
                            : 'bg-neutral-800/80 hover:bg-neutral-700 text-neutral-400'
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-neutral-500" />
                        Не разделены ({noneSplitCount})
                      </button>
                    )}
                  </div>
                )}
              </div>

              {subtitleTracks.length === 0 ? (
                <div className="p-6 text-center bg-neutral-950/50 border border-neutral-800/80 rounded-xl">
                  <p className="text-sm text-neutral-400">В этом MKV файле нет вшитых субтитров.</p>
                  <p className="text-xs text-neutral-500 mt-1">Будет импортирован только видеоряд и аудиодорожка.</p>
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[350px] overflow-y-auto pr-1">
                  {filteredSubtitleTracks.map((track) => {
                    const isSelected = selectedSubIndexes.includes(track.index);
                    const lang = formatLanguageLabel(track.tags?.language);
                    const title = track.tags?.title || '';
                    const isDef = !!track.disposition?.default;
                    const isForced = !!track.disposition?.forced;
                    const analysis = trackAnalyses[track.index];

                    return (
                      <div
                        key={track.index}
                        onClick={() => toggleSubTrack(track.index)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col select-none ${
                          isSelected
                            ? 'bg-indigo-950/30 border-indigo-500/60 shadow-sm'
                            : 'bg-neutral-950/60 border-neutral-800 hover:bg-neutral-800/60 hover:border-neutral-700'
                        }`}
                      >
                        <div className="flex items-start gap-3">
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

                              <span className="text-[10px] text-neutral-500 ml-auto">
                                ID: #{track.index}
                              </span>
                            </div>

                            {/* Character Split Status badge & character details */}
                            <CharacterSplitBadge
                              analysis={analysis}
                              isLoading={isAnalyzing && !analysis}
                              isExpanded={expandedCharactersTrack === track.index}
                              onToggleExpand={() => {
                                setExpandedCharactersTrack(prev => prev === track.index ? null : track.index);
                              }}
                            />
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
