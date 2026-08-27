import React, { useState, useMemo } from 'react';
import { 
  ArrowRightLeft, UserCheck, Plus, Check, Search, 
  Sparkles, Layers, Users, UserPlus, AlertCircle 
} from 'lucide-react';
import { CharacterDialogueLine } from '../../lib/characterPreview/characterPreviewTypes';
import { RoleAssignment, Participant } from '../../types';

interface LineReassignControlProps {
  currentLine: CharacterDialogueLine | null;
  currentCharacterName: string;
  knownCharacters: string[];
  assignments: RoleAssignment[];
  participants: Participant[];
  globalMapping: { characterName: string; dubberId: string; photoUrl?: string; isMain?: boolean }[];
  onReassign: (targetCharacter: string, reassignAllMatchingText: boolean) => Promise<void>;
  isReassigning: boolean;
}

export default function LineReassignControl({
  currentLine,
  currentCharacterName,
  knownCharacters,
  assignments,
  participants,
  globalMapping,
  onReassign,
  isReassigning,
}: LineReassignControlProps) {
  const [targetName, setTargetName] = useState('');
  const [customName, setCustomName] = useState('');
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [reassignAllMatching, setReassignAllMatching] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

  // Filter available characters (excluding current character)
  const availableCharacters = useMemo(() => {
    const set = new Set<string>();
    knownCharacters.forEach(c => {
      if (c && c.toLowerCase() !== currentCharacterName.toLowerCase()) {
        set.add(c);
      }
    });
    assignments.forEach(a => {
      if (a.characterName && a.characterName.toLowerCase() !== currentCharacterName.toLowerCase()) {
        set.add(a.characterName);
      }
    });
    globalMapping.forEach(m => {
      if (m.characterName && m.characterName.toLowerCase() !== currentCharacterName.toLowerCase()) {
        set.add(m.characterName);
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [knownCharacters, assignments, globalMapping, currentCharacterName]);

  const filteredCharacters = useMemo(() => {
    if (!filterQuery.trim()) return availableCharacters;
    const q = filterQuery.toLowerCase();
    return availableCharacters.filter(c => c.toLowerCase().includes(q));
  }, [availableCharacters, filterQuery]);

  const handleApplyReassign = async (selectedTarget?: string) => {
    const finalTarget = (selectedTarget || (isCustomMode ? customName : targetName)).trim();
    if (!finalTarget) return;
    if (finalTarget.toLowerCase() === currentCharacterName.toLowerCase()) return;

    await onReassign(finalTarget, reassignAllMatching);
    setCustomName('');
    setIsCustomMode(false);
    setIsExpanded(false);
  };

  if (!currentLine) {
    return null;
  }

  // Find info about target
  const chosenTarget = isCustomMode ? customName.trim() : targetName;
  const targetAssignment = assignments.find(a => a.characterName.toLowerCase() === chosenTarget.toLowerCase());
  const targetDubber = participants.find(p => p.id === targetAssignment?.dubberId);

  return (
    <div className="bg-neutral-950/80 border border-neutral-800 rounded-xl p-3 space-y-2.5 shadow-lg">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-semibold text-neutral-200">
            Переназначить реплику персонажу
          </span>
        </div>

        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          {isExpanded ? 'Свернуть' : 'Выбрать персонажа ▼'}
        </button>
      </div>

      {/* Quick selection bar or Expanded selection */}
      {!isExpanded ? (
        <div className="flex flex-wrap items-center gap-2">
          {/* Select dropdown */}
          <div className="flex-1 min-w-[180px]">
            <select
              value={isCustomMode ? '__custom__' : targetName}
              onChange={(e) => {
                if (e.target.value === '__custom__') {
                  setIsCustomMode(true);
                  setIsExpanded(true);
                } else {
                  setIsCustomMode(false);
                  setTargetName(e.target.value);
                }
              }}
              className="w-full bg-neutral-900 border border-neutral-800 hover:border-neutral-700 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none transition-colors"
            >
              <option value="" disabled>
                -- Выберите персонажа --
              </option>
              {availableCharacters.map(char => {
                const assign = assignments.find(a => a.characterName.toLowerCase() === char.toLowerCase());
                const dub = participants.find(p => p.id === assign?.dubberId);
                return (
                  <option key={char} value={char}>
                    {char} {dub ? `(${dub.nickname})` : ''}
                  </option>
                );
              })}
              <option value="__custom__">+ Ввести нового персонажа...</option>
            </select>
          </div>

          {/* Quick Apply Button */}
          <button
            type="button"
            onClick={() => handleApplyReassign()}
            disabled={isReassigning || (!targetName && !customName)}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all shadow-sm shrink-0"
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>{isReassigning ? 'Сохранение...' : 'Передать реплику'}</span>
          </button>
        </div>
      ) : (
        /* Expanded mode: searchable list & new character creation */
        <div className="space-y-3 pt-1 animate-in fade-in duration-150">
          {/* Mode Switcher */}
          <div className="flex items-center gap-1 bg-neutral-900 p-0.5 rounded-lg border border-neutral-800 text-xs">
            <button
              type="button"
              onClick={() => setIsCustomMode(false)}
              className={`flex-1 py-1 px-2.5 rounded-md font-medium transition-colors flex items-center justify-center gap-1.5 ${
                !isCustomMode
                  ? 'bg-neutral-800 text-white shadow-sm'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Существующий ({availableCharacters.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setIsCustomMode(true)}
              className={`flex-1 py-1 px-2.5 rounded-md font-medium transition-colors flex items-center justify-center gap-1.5 ${
                isCustomMode
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Новый персонаж</span>
            </button>
          </div>

          {!isCustomMode ? (
            <div className="space-y-2">
              {/* Search in characters */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Поиск персонажа..."
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-neutral-900 border border-neutral-800 rounded-lg text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Character pills / list */}
              <div className="max-h-36 overflow-y-auto space-y-1 p-1 bg-neutral-900/60 rounded-lg border border-neutral-800/80">
                {filteredCharacters.length === 0 ? (
                  <div className="p-3 text-center text-xs text-neutral-500">
                    Персонажи не найдены. Переключитесь на «Новый персонаж».
                  </div>
                ) : (
                  filteredCharacters.map((char, idx) => {
                    const isSelected = targetName === char;
                    const assign = assignments.find(a => a.characterName.toLowerCase() === char.toLowerCase());
                    const dub = participants.find(p => p.id === assign?.dubberId);

                    return (
                      <div
                        key={char}
                        onClick={() => {
                          setTargetName(char);
                          handleApplyReassign(char);
                        }}
                        className={`px-2.5 py-1.5 rounded-md cursor-pointer text-xs flex items-center justify-between transition-colors ${
                          isSelected
                            ? 'bg-indigo-600 text-white font-medium'
                            : 'hover:bg-neutral-800/90 text-neutral-300'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          {idx < 9 && (
                            <kbd className="px-1.5 py-0.2 bg-neutral-800 text-amber-300 border border-neutral-700 rounded text-[10px] font-mono font-bold shrink-0">
                              {idx + 1}
                            </kbd>
                          )}
                          <span className="truncate">{char}</span>
                          {dub && (
                            <span className={`text-[10px] px-1.5 py-0.2 rounded ${
                              isSelected ? 'bg-indigo-700 text-indigo-100' : 'bg-neutral-800 text-indigo-300'
                            }`}>
                              {dub.nickname}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          className="text-[10px] opacity-80 hover:opacity-100 underline shrink-0 ml-2"
                        >
                          Выбрать
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            /* Custom new character input */
            <div className="space-y-2">
              <div>
                <label className="text-[11px] text-neutral-400 block mb-1">
                  Имя нового персонажа (например для разделения массовки/толпы):
                </label>
                <input
                  type="text"
                  placeholder="Например: Парень в очках, Официант, Толпа (Ж)..."
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && customName.trim()) {
                      handleApplyReassign();
                    }
                  }}
                  className="w-full px-3 py-1.5 bg-neutral-900 border border-neutral-700 focus:border-indigo-500 rounded-lg text-xs text-white placeholder-neutral-500 focus:outline-none"
                  autoFocus
                />
              </div>

              {/* Quick suggestions for splitting crowd */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-[10px] text-neutral-500 self-center mr-1">Шаблоны:</span>
                {[
                  `${currentCharacterName} (М)`,
                  `${currentCharacterName} (Ж)`,
                  `Прохожий 1`,
                  `Студент 1`,
                  `Охранник`,
                  `Шепот`,
                ].map(tmpl => (
                  <button
                    key={tmpl}
                    type="button"
                    onClick={() => setCustomName(tmpl)}
                    className="text-[10px] px-2 py-0.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 rounded transition-colors"
                  >
                    {tmpl}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Reassign all matching text checkbox */}
          <div className="flex items-center justify-between pt-1 border-t border-neutral-800/80">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-neutral-400 hover:text-neutral-200 select-none">
              <input
                type="checkbox"
                checked={reassignAllMatching}
                onChange={(e) => setReassignAllMatching(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-neutral-700 bg-neutral-900 text-indigo-600 focus:ring-0 cursor-pointer"
              />
              <span>Переназначить ВСЕ одинаковые реплики ("{currentLine.cleanText.slice(0, 24)}...")</span>
            </label>

            {isCustomMode && (
              <button
                type="button"
                onClick={() => handleApplyReassign()}
                disabled={isReassigning || !customName.trim()}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all shadow-sm shrink-0"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{isReassigning ? 'Создание...' : 'Создать и назначить'}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
