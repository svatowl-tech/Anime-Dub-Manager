import React, { useState, useEffect } from "react";
import { Languages, Save, Loader2, Bookmark, X, Mic2, UserCheck } from "lucide-react";
import { Episode } from "../../types";
import { RawSubtitleLine, SubtitleUpdates } from "./types";
import { SHORTCUT_KEYS } from "./utils";

interface SubtitleSidebarProps {
  currentEpisode: Episode | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  lines: RawSubtitleLine[];
  updates: SubtitleUpdates;
  selectedLines: Set<number>;
  activeLineIndex: number | null;
  stableNames: string[];
  bookmarks: number[];
  massName: string;
  loading: boolean;
  saving: boolean;
  autoApplyAliases: boolean;
  autoApplyStresses: boolean;
  onChangeMassName: (name: string) => void;
  onMassAssign: () => void;
  onMassTransliterate: () => void;
  onMassPolivanovToHepburn: () => void;
  onApplyAliases: () => void;
  onApplyStresses: () => void;
  onToggleAutoApplyAliases: (val: boolean) => void;
  onToggleAutoApplyStresses: (val: boolean) => void;
  onSave: () => void;
  onQuickAssign: (name: string) => void;
  onApplyGenderPrefix?: (gender: 'M' | 'F') => void;
  onApplyNextNumber?: () => void;
  onToggleBookmark: (idx: number) => void;
  onJumpToBookmark: (idx: number) => void;
}

export const SubtitleSidebar: React.FC<SubtitleSidebarProps> = ({
  currentEpisode,
  videoRef,
  lines,
  updates,
  selectedLines,
  activeLineIndex,
  stableNames,
  bookmarks,
  massName,
  loading,
  saving,
  autoApplyAliases,
  autoApplyStresses,
  onChangeMassName,
  onMassAssign,
  onMassTransliterate,
  onMassPolivanovToHepburn,
  onApplyAliases,
  onApplyStresses,
  onToggleAutoApplyAliases,
  onToggleAutoApplyStresses,
  onSave,
  onQuickAssign,
  onApplyGenderPrefix,
  onApplyNextNumber,
  onToggleBookmark,
  onJumpToBookmark,
}) => {
  const [currentPlaybackTime, setCurrentPlaybackTime] = useState<number>(0);

  // Sync playback time from video element
  useEffect(() => {
    const video = videoRef?.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      setCurrentPlaybackTime(video.currentTime);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [videoRef, currentEpisode?.rawPath]);

  // Find active line and active speaker based on current video time
  const currentActiveSpeaker = React.useMemo(() => {
    // 1. Check if there's a line matching current video playback time
    if (lines && lines.length > 0 && currentPlaybackTime > 0) {
      const match = lines.find((line, idx) => {
        const start = line.startSec;
        const end = line.endSec;
        return currentPlaybackTime >= start && currentPlaybackTime <= end;
      });
      if (match) {
        const lineIdx = match.rawLineIndex ?? 0;
        const updatedName = updates[lineIdx]?.name !== undefined ? updates[lineIdx].name : match.name;
        const updatedText = updates[lineIdx]?.text !== undefined ? updates[lineIdx].text : match.text;
        return {
          name: updatedName || 'Без имени',
          text: updatedText || '',
          start: match.start,
          end: match.end,
          isExactMatch: true,
        };
      }
    }

    // 2. Fallback to currently selected / active subtitle line in editor
    if (activeLineIndex !== null && lines && lines[activeLineIndex]) {
      const line = lines[activeLineIndex];
      const lineIdx = line.rawLineIndex ?? activeLineIndex;
      const updatedName = updates[lineIdx]?.name !== undefined ? updates[lineIdx].name : line.name;
      const updatedText = updates[lineIdx]?.text !== undefined ? updates[lineIdx].text : line.text;
      return {
        name: updatedName || 'Без имени',
        text: updatedText || '',
        start: line.start,
        end: line.end,
        isExactMatch: false,
      };
    }

    return null;
  }, [lines, updates, currentPlaybackTime, activeLineIndex]);

  return (
    <div className="w-[420px] flex flex-col shrink-0 bg-neutral-900 overflow-y-auto border-l border-neutral-800">
      {currentEpisode?.rawPath && (
        <div className="sticky top-0 z-20 border-b border-neutral-800 bg-neutral-950 p-3 shadow-lg space-y-2">
          <video ref={videoRef} src={currentEpisode.rawPath} controls className="w-full rounded bg-black aspect-video object-contain" />
          
          {/* Active Speaker Indicator under video */}
          <div className={`p-2.5 rounded-lg border transition-all ${
            currentActiveSpeaker
              ? currentActiveSpeaker.isExactMatch
                ? 'bg-indigo-950/50 border-indigo-500/40 text-indigo-100 shadow-sm'
                : 'bg-neutral-900/90 border-neutral-800 text-neutral-300'
              : 'bg-neutral-900/40 border-neutral-800/60 text-neutral-500'
          }`}>
            <div className="flex items-center justify-between text-xs mb-1">
              <div className="flex items-center gap-1.5 font-medium">
                <Mic2 className={`w-3.5 h-3.5 ${
                  currentActiveSpeaker?.isExactMatch ? 'text-emerald-400 animate-pulse' : 'text-indigo-400'
                }`} />
                <span className="text-[11px] uppercase tracking-wider text-neutral-400">
                  {currentActiveSpeaker?.isExactMatch ? 'Сейчас говорит:' : 'Текущая реплика:'}
                </span>
              </div>
              {currentActiveSpeaker && (
                <span className="text-[10px] font-mono text-neutral-400">
                  {currentActiveSpeaker.start} - {currentActiveSpeaker.end}
                </span>
              )}
            </div>

            {currentActiveSpeaker ? (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                    currentActiveSpeaker.name === 'Без имени' || !currentActiveSpeaker.name
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'bg-indigo-500/20 text-indigo-200 border border-indigo-500/30'
                  }`}>
                    {currentActiveSpeaker.name}
                  </span>
                </div>
                {currentActiveSpeaker.text && (
                  <p className="text-xs text-neutral-300 line-clamp-2 italic font-normal">
                    "{currentActiveSpeaker.text.replace(/\\N/g, ' ')}"
                  </p>
                )}
              </div>
            ) : (
              <div className="text-[11px] text-neutral-500 italic py-0.5">
                Нет активных субтитров в данный момент
              </div>
            )}
          </div>
        </div>
      )}
      
      <div className="p-4 flex flex-col gap-4 border-b border-neutral-800">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-neutral-300 uppercase tracking-wider">Управление</span>
        </div>
        
        <div className="flex flex-col gap-2">
          <label className="text-xs text-neutral-500">Массовое назначение роли:</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={massName}
              onChange={(e) => onChangeMassName(e.target.value)}
              placeholder="Имя (или Имя1, Имя2)"
              title="Можно указать несколько имен через запятую"
              className="flex-1 bg-neutral-950 border border-neutral-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <button
              onClick={onMassAssign}
              disabled={selectedLines.size === 0 || !massName.trim()}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm transition-colors border border-indigo-500 whitespace-nowrap cursor-pointer"
            >
              Применить ({selectedLines.size})
            </button>
          </div>
        </div>

        {/* Quick Tagging Shortcuts (M, Ж, №) */}
        <div className="flex flex-col gap-1.5 p-2 bg-neutral-950/60 rounded-lg border border-neutral-800">
          <div className="text-[11px] font-semibold text-neutral-400 flex items-center justify-between">
            <span>Быстрая разметка персонажей:</span>
            <span className="text-[10px] text-neutral-500 font-mono">Горячие клавиши</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <button
              onClick={() => onApplyGenderPrefix && onApplyGenderPrefix('M')}
              type="button"
              className="flex items-center justify-between px-2.5 py-1.5 bg-blue-950/40 hover:bg-blue-900/60 text-blue-300 border border-blue-800/50 rounded-lg text-xs transition-colors cursor-pointer group"
              title="Добавить или переключить префикс (М) [Горячая клавиша: M]"
            >
              <span className="font-semibold">(М) Муж</span>
              <kbd className="text-[9px] font-mono bg-blue-900/80 px-1 py-0.5 rounded text-blue-200 border border-blue-700/50 group-hover:text-white">M</kbd>
            </button>

            <button
              onClick={() => onApplyGenderPrefix && onApplyGenderPrefix('F')}
              type="button"
              className="flex items-center justify-between px-2.5 py-1.5 bg-pink-950/40 hover:bg-pink-900/60 text-pink-300 border border-pink-800/50 rounded-lg text-xs transition-colors cursor-pointer group"
              title="Добавить или переключить префикс (Ж) [Горячая клавиша: Ж]"
            >
              <span className="font-semibold">(Ж) Жен</span>
              <kbd className="text-[9px] font-mono bg-pink-900/80 px-1 py-0.5 rounded text-pink-200 border border-pink-700/50 group-hover:text-white">Ж</kbd>
            </button>

            <button
              onClick={() => onApplyNextNumber && onApplyNextNumber()}
              type="button"
              className="flex items-center justify-between px-2.5 py-1.5 bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 border border-amber-800/50 rounded-lg text-xs transition-colors cursor-pointer group"
              title="Добавить следующий номер по возрастанию [Горячая клавиша: № или #]"
            >
              <span className="font-semibold">№+ Номер</span>
              <kbd className="text-[9px] font-mono bg-amber-900/80 px-1 py-0.5 rounded text-amber-200 border border-amber-700/50 group-hover:text-white">№</kbd>
            </button>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-2 mt-2">
          <button
            onClick={onMassTransliterate}
            disabled={loading || saving || lines.length === 0}
            className="flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-xs font-medium transition-colors border border-neutral-700 cursor-pointer"
            title="Транслитерация имен (Lat -> Cyr)"
          >
            <Languages className="w-3.5 h-3.5" />
            Транслит
          </button>

          <button
            onClick={onMassPolivanovToHepburn}
            disabled={loading || saving || lines.length === 0}
            className="flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-xs font-medium transition-colors border border-neutral-700 cursor-pointer"
            title="Поливанов -> Хэпберн (Кириллица)"
          >
            <Languages className="w-3.5 h-3.5 text-amber-400" />
            Хэпберн
          </button>
          
          {currentEpisode?.project?.characterAliases && (
            <button
              onClick={onApplyAliases}
              disabled={loading || saving || lines.length === 0}
              className="col-span-2 flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-xs font-medium transition-colors border border-neutral-700 cursor-pointer"
              title="Автоматически заменить имена-алиасы на основные имена персонажей"
            >
              <Languages className="w-3.5 h-3.5 text-indigo-400" />
              Применить алиасы из словаря
            </button>
          )}
          
          {currentEpisode?.project?.nameStresses && (
            <button
              onClick={onApplyStresses}
              disabled={loading || saving || lines.length === 0}
              className="col-span-2 flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-xs font-medium transition-colors border border-neutral-700 cursor-pointer"
              title="Автоматически расставить ударения в именах (согласно словарю проекта)"
            >
              <Languages className="w-3.5 h-3.5 text-rose-400" />
              Расставить ударения в именах
            </button>
          )}
        </div>

        <div className="border-t border-neutral-800/60 pt-2.5 mt-1.5 flex flex-col gap-2">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold px-1 mb-0.5">
            Автоматизация при загрузке
          </div>
          <label className="flex items-center gap-2 text-xs text-neutral-300 hover:text-white cursor-pointer select-none px-1 py-0.5 transition-colors">
            <input
              type="checkbox"
              checked={autoApplyAliases}
              onChange={(e) => onToggleAutoApplyAliases(e.target.checked)}
              className="rounded border-neutral-700 bg-neutral-900 text-indigo-600 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5"
            />
            Авто-алиасы из словаря
          </label>
          <label className="flex items-center gap-2 text-xs text-neutral-300 hover:text-white cursor-pointer select-none px-1 py-0.5 transition-colors">
            <input
              type="checkbox"
              checked={autoApplyStresses}
              onChange={(e) => onToggleAutoApplyStresses(e.target.checked)}
              className="rounded border-neutral-700 bg-neutral-900 text-indigo-600 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5"
            />
            Авто-ударения в именах
          </label>
        </div>
        
        <button
          onClick={onSave}
          disabled={Object.keys(updates).length === 0 || saving}
          title="Сохранить изменения"
          className="flex items-center justify-center gap-2 mt-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-indigo-500/20 cursor-pointer"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          Сохранить изменения ({Object.keys(updates).length})
        </button>
      </div>

      {stableNames.length > 0 && (
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-neutral-300 uppercase tracking-wider">Персонажи</span>
            <span className="text-[10px] text-neutral-500">Авто-назначение: выберите строки и нажмите цифру</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {stableNames.map((name, index) => (
              <button
                key={name}
                onClick={() => onQuickAssign(name)}
                className="px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg text-xs transition-colors border border-neutral-700 flex items-center gap-2 group cursor-pointer"
                title={
                  selectedLines.size > 0
                    ? `Применить к выбранным (${selectedLines.size})`
                    : "Выбрать имя"
                }
              >
                {index < SHORTCUT_KEYS.length && (
                  <span className="text-[9px] bg-neutral-950 text-neutral-400 px-1.5 py-0.5 rounded border border-neutral-800 group-hover:text-indigo-400 group-hover:border-indigo-500/30 transition-colors uppercase font-mono shadow-sm">
                    {SHORTCUT_KEYS[index]}
                  </span>
                )}
                <span className="truncate max-w-[150px]">{name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bookmarks Section */}
      <div className="p-4 flex flex-col gap-3 border-t border-neutral-800 bg-neutral-950/20">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5 font-sans">
            <Bookmark className="w-4 h-4 text-amber-500 fill-amber-500/20 shrink-0" />
            Закладки
          </span>
          {activeLineIndex !== null && (
            <button
              onClick={() => onToggleBookmark(activeLineIndex)}
              className="text-[10px] bg-neutral-850 hover:bg-neutral-700 border border-neutral-700 hover:border-neutral-600 text-neutral-300 px-2 py-1 rounded transition-colors font-medium flex items-center gap-1 cursor-pointer"
            >
              <Bookmark className="w-2.5 h-2.5" />
              {bookmarks.includes(activeLineIndex) ? "Убрать текущую" : "Сюда флажок"}
            </button>
          )}
        </div>
        
        {bookmarks.length > 0 ? (
          <div className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto pr-1">
            {bookmarks.map((bId) => {
              const line = lines.find(l => l.rawLineIndex === bId);
              if (!line) return null;
              const formattedTime = line.start;
              const charName = updates[bId]?.name !== undefined ? updates[bId].name : line.name;
              const lineText = updates[bId]?.text !== undefined ? updates[bId].text : line.text;
              
              return (
                <button
                  key={bId}
                  onClick={() => onJumpToBookmark(bId)}
                  className="flex items-center justify-between p-2 bg-neutral-950 hover:bg-neutral-800/80 border border-neutral-850 hover:border-neutral-700 rounded-lg text-left transition-all group cursor-pointer"
                >
                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[10px] text-neutral-400 font-mono">
                      <span className="text-indigo-400 font-semibold">Строка {bId + 1}</span>
                      <span className="text-neutral-600">•</span>
                      <span className="text-amber-400 font-bold">{formattedTime}</span>
                      {charName && (
                        <>
                          <span className="text-neutral-600">•</span>
                          <span className="text-emerald-400 truncate max-w-[130px]" title={charName}>[{charName}]</span>
                        </>
                      )}
                    </div>
                    <div className="text-[11px] text-neutral-300 truncate mt-0.5">
                      {lineText || "(Пустая реплика)"}
                    </div>
                  </div>
                  
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleBookmark(bId);
                    }}
                    className="p-1 text-neutral-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity ml-1.5 shrink-0 cursor-pointer"
                    title="Удалить закладку"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-neutral-500 italic py-3 text-center border border-dashed border-neutral-800/65 rounded-lg bg-neutral-950/40">
            Нет сохраненных закладок.<br />
            Используйте иконку флажка в строках для быстрого возврата к работе.
          </div>
        )}
      </div>
    </div>
  );
};
