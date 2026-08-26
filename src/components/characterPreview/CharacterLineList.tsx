import React, { useState, useMemo, useEffect } from 'react';
import { Search, Clock, Play, Volume2, CheckCircle2, MessageSquare, ArrowRightLeft } from 'lucide-react';
import { CharacterDialogueLine } from '../../lib/characterPreview/characterPreviewTypes';
import { formatSecondsToTime } from '../../lib/characterPreview/timeUtils';

interface CharacterLineListProps {
  lines: CharacterDialogueLine[];
  selectedLineIndex: number;
  onSelectLine: (index: number) => void;
  isPlaying: boolean;
  activeLinePlayingIndex: number | null;
  onPlayLine: (index: number) => void;
  knownCharacters?: string[];
  currentCharacterName?: string;
  onReassignLine?: (index: number, targetCharacter: string) => Promise<void>;
  isReassigning?: boolean;
}

export default function CharacterLineList({
  lines,
  selectedLineIndex,
  onSelectLine,
  isPlaying,
  activeLinePlayingIndex,
  onPlayLine,
  knownCharacters = [],
  currentCharacterName = '',
  onReassignLine,
  isReassigning = false,
}: CharacterLineListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [openDropdownIdx, setOpenDropdownIdx] = useState<number | null>(null);
  const [dropdownSearch, setDropdownSearch] = useState('');

  useEffect(() => {
    const handleGlobalClick = () => {
      setOpenDropdownIdx(null);
    };
    document.addEventListener('click', handleGlobalClick);
    return () => {
      document.removeEventListener('click', handleGlobalClick);
    };
  }, []);

  const filteredLines = useMemo(() => {
    if (!searchQuery.trim()) return lines.map((l, i) => ({ line: l, originalIndex: i }));
    const q = searchQuery.toLowerCase();
    return lines
      .map((l, i) => ({ line: l, originalIndex: i }))
      .filter(({ line }) => 
        line.cleanText.toLowerCase().includes(q) ||
        line.start.includes(q) ||
        line.name.toLowerCase().includes(q)
      );
  }, [lines, searchQuery]);

  // Filter available characters for dropdown (excluding current character)
  const availableCharacters = useMemo(() => {
    const set = new Set<string>();
    knownCharacters.forEach(c => {
      if (c && c.toLowerCase() !== currentCharacterName.toLowerCase()) {
        set.add(c);
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [knownCharacters, currentCharacterName]);

  const filteredDropdownChars = useMemo(() => {
    if (!dropdownSearch.trim()) return availableCharacters;
    const q = dropdownSearch.toLowerCase();
    return availableCharacters.filter(c => c.toLowerCase().includes(q));
  }, [availableCharacters, dropdownSearch]);

  return (
    <div className="flex flex-col h-full bg-neutral-950/70 border border-neutral-800 rounded-xl overflow-hidden">
      {/* Header & Search */}
      <div className="p-3 border-b border-neutral-800 bg-neutral-900/60 shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-semibold text-neutral-200">
              Реплики персонажа
            </span>
            <span className="text-[10px] bg-indigo-500/20 text-indigo-300 font-medium px-2 py-0.5 rounded-full border border-indigo-500/30">
              Всего: {lines.length}
            </span>
          </div>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Поиск по фразе или таймингу..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-neutral-900 border border-neutral-800 rounded-lg text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
      </div>

      {/* List Container */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 divide-y divide-neutral-900/60">
        {filteredLines.length === 0 ? (
          <div className="p-6 text-center text-xs text-neutral-500">
            {lines.length === 0 ? 'Реплики для этого персонажа не найдены' : 'По запросу ничего не найдено'}
          </div>
        ) : (
          filteredLines.map(({ line, originalIndex }) => {
            const isSelected = selectedLineIndex === originalIndex;
            const isCurrentlyPlaying = isPlaying && activeLinePlayingIndex === originalIndex;

            return (
              <div
                key={`${line.rawIndex}_${line.startSec}`}
                onClick={() => onSelectLine(originalIndex)}
                className={`group p-2.5 rounded-lg cursor-pointer transition-all border flex flex-col gap-1.5 relative ${
                  isSelected
                    ? 'bg-indigo-950/40 border-indigo-500/50 shadow-sm'
                    : 'bg-neutral-900/30 hover:bg-neutral-900/80 border-neutral-800/40 hover:border-neutral-700/60'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono font-medium text-indigo-400 bg-indigo-950/70 px-1.5 py-0.5 rounded border border-indigo-800/40 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      {formatSecondsToTime(line.startSec)}
                    </span>
                    <span className="text-[10px] text-neutral-500">
                      ({line.durationSec.toFixed(1)}с)
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    {/* Reassign Button & Dropdown */}
                    {onReassignLine && (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenDropdownIdx(openDropdownIdx === originalIndex ? null : originalIndex);
                            setDropdownSearch('');
                          }}
                          disabled={isReassigning}
                          title="Переназначить реплику другому персонажу"
                          className={`p-1 rounded-md transition-all border border-transparent hover:border-neutral-700 ${
                            openDropdownIdx === originalIndex
                              ? 'bg-amber-600 text-white'
                              : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white'
                          }`}
                        >
                          <ArrowRightLeft className="w-3 h-3" />
                        </button>

                        {openDropdownIdx === originalIndex && (
                          <div
                            className="absolute right-0 top-7 w-48 bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl z-50 p-2 space-y-1.5 text-xs animate-in fade-in zoom-in-95 duration-100"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="text-[10px] text-neutral-400 font-bold uppercase tracking-wider px-1">
                              Переназначить реплику:
                            </div>

                            {/* Dropdown Search */}
                            <div className="relative">
                              <Search className="w-3 h-3 text-neutral-500 absolute left-2 top-1/2 -translate-y-1/2" />
                              <input
                                type="text"
                                placeholder="Поиск персонажа..."
                                value={dropdownSearch}
                                onChange={(e) => setDropdownSearch(e.target.value)}
                                className="w-full pl-6 pr-2 py-1 bg-neutral-950 border border-neutral-800 rounded text-[11px] text-white placeholder-neutral-500 focus:outline-none focus:border-indigo-500"
                                autoFocus
                              />
                            </div>

                            {/* Character list */}
                            <div className="max-h-36 overflow-y-auto space-y-0.5">
                              {filteredDropdownChars.length === 0 ? (
                                <div className="text-[10px] text-neutral-500 text-center py-2">
                                  Нет доступных персонажей
                                </div>
                              ) : (
                                filteredDropdownChars.map(char => (
                                  <button
                                    key={char}
                                    type="button"
                                    onClick={async () => {
                                      setOpenDropdownIdx(null);
                                      await onReassignLine(originalIndex, char);
                                    }}
                                    className="w-full text-left px-2 py-1 hover:bg-indigo-600 hover:text-white rounded text-[11px] text-neutral-200 transition-colors truncate"
                                  >
                                    {char}
                                  </button>
                                ))
                              )}
                            </div>

                            {/* Custom new character input */}
                            <div className="border-t border-neutral-800 pt-1.5">
                              <input
                                type="text"
                                placeholder="Или имя нового..."
                                onKeyDown={async (e) => {
                                  if (e.key === 'Enter') {
                                    const val = e.currentTarget.value.trim();
                                    if (val) {
                                      setOpenDropdownIdx(null);
                                      await onReassignLine(originalIndex, val);
                                    }
                                  }
                                }}
                                className="w-full px-2 py-1 bg-neutral-950 border border-neutral-800 rounded text-[11px] text-white placeholder-neutral-500 focus:outline-none focus:border-indigo-500"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectLine(originalIndex);
                        onPlayLine(originalIndex);
                      }}
                      title="Воспроизвести реплику"
                      className={`p-1 rounded-md transition-colors ${
                        isCurrentlyPlaying
                          ? 'bg-indigo-600 text-white animate-pulse'
                          : 'bg-neutral-800 text-neutral-300 hover:bg-indigo-600 hover:text-white group-hover:border-indigo-500/30'
                      }`}
                    >
                      {isCurrentlyPlaying ? (
                        <Volume2 className="w-3 h-3" />
                      ) : (
                        <Play className="w-3 h-3 fill-current" />
                      )}
                    </button>
                  </div>
                </div>

                <p className={`text-xs leading-relaxed line-clamp-2 ${
                  isSelected ? 'text-neutral-100 font-medium' : 'text-neutral-300'
                }`}>
                  {line.cleanText || <span className="italic text-neutral-600">(Без текста)</span>}
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
