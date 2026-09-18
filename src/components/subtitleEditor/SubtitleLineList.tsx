import React, { useState, useMemo } from "react";
import { Users, Filter, X, AlertCircle, Camera } from "lucide-react";
import { RawSubtitleLine, SubtitleUpdates } from "./types";
import { SubtitleLineRow } from "./SubtitleLineRow";
import { getCharacterColor } from "./characterColors";

interface SubtitleLineListProps {
  lines: RawSubtitleLine[];
  selectedLines: Set<number>;
  activeLineIndex: number | null;
  updates: SubtitleUpdates;
  stableNames: string[];
  showSigns: boolean;
  showScreenshots?: boolean;
  videoPath?: string;
  loading: boolean;
  bookmarks: number[];
  isSignLine: (line: RawSubtitleLine) => boolean;
  onSelectAll: (checked: boolean) => void;
  onLineUpdate: (idx: number, update: any) => void;
  onToggleSelect: (idx: number, isShift: boolean) => void;
  onPlayFromTime: (time: string) => void;
  onDuplicateLine: (idx: number) => void;
  onAddLine: (idx: number) => void;
  onDeleteLine: (idx: number) => void;
  onCommitName: (name: string) => void;
  onToggleBookmark: (idx: number) => void;
  onOpenWhisperSnippet?: (startSec: number, endSec: number) => void;
}

export const SubtitleLineList: React.FC<SubtitleLineListProps> = ({
  lines,
  selectedLines,
  activeLineIndex,
  updates,
  stableNames,
  showSigns,
  showScreenshots = false,
  videoPath,
  loading,
  bookmarks,
  isSignLine,
  onSelectAll,
  onLineUpdate,
  onToggleSelect,
  onPlayFromTime,
  onDuplicateLine,
  onAddLine,
  onDeleteLine,
  onCommitName,
  onToggleBookmark,
  onOpenWhisperSnippet,
}) => {
  const [characterFilter, setCharacterFilter] = useState<string | null>(null);

  // Compute character breakdown with colors and counts
  const { characterStats, unassignedCount, totalVisibleCount } = useMemo(() => {
    const counts: Record<string, number> = {};
    let unassigned = 0;
    let total = 0;

    lines.forEach((line) => {
      if (!showSigns && isSignLine(line)) return;
      total++;
      const currentName = updates[line.rawLineIndex]?.name !== undefined
        ? updates[line.rawLineIndex].name
        : line.name;

      if (!currentName || !currentName.trim()) {
        unassigned++;
      } else {
        const trimmed = currentName.trim();
        counts[trimmed] = (counts[trimmed] || 0) + 1;
      }
    });

    const stats = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({
        name,
        count,
        color: getCharacterColor(name, stableNames)
      }));

    return {
      characterStats: stats,
      unassignedCount: unassigned,
      totalVisibleCount: total
    };
  }, [lines, updates, stableNames, showSigns, isSignLine]);

  // Filter lines based on sign settings and active character filter
  const visibleLines = useMemo(() => {
    return lines.filter((line) => {
      if (!showSigns && isSignLine(line)) return false;

      if (characterFilter === '__UNASSIGNED__') {
        const name = updates[line.rawLineIndex]?.name !== undefined
          ? updates[line.rawLineIndex].name
          : line.name;
        return !name || !name.trim();
      }

      if (characterFilter) {
        const name = updates[line.rawLineIndex]?.name !== undefined
          ? updates[line.rawLineIndex].name
          : line.name;
        return (name || '').trim().toLowerCase() === characterFilter.toLowerCase();
      }

      return true;
    });
  }, [lines, showSigns, isSignLine, characterFilter, updates]);

  return (
    <div className="flex-1 overflow-y-auto flex flex-col p-2 space-y-1">
      {/* Character Color Ribbon & Filter */}
      {characterStats.length > 0 && (
        <div className="px-2 py-1.5 bg-neutral-900/90 border border-neutral-800 rounded-lg flex items-center gap-2 overflow-x-auto text-xs shrink-0 scrollbar-thin">
          <div className="flex items-center gap-1.5 text-neutral-400 font-semibold shrink-0 pr-1 border-r border-neutral-800">
            <Users className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-[11px] uppercase tracking-wider">Персонажи:</span>
          </div>

          <button
            onClick={() => setCharacterFilter(null)}
            className={`px-2 py-1 rounded-md text-[11px] font-medium transition-all shrink-0 cursor-pointer flex items-center gap-1 ${
              characterFilter === null
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-neutral-800 text-neutral-300 hover:bg-neutral-750 hover:text-white"
            }`}
          >
            Все ({totalVisibleCount})
          </button>

          {unassignedCount > 0 && (
            <button
              onClick={() => setCharacterFilter(characterFilter === '__UNASSIGNED__' ? null : '__UNASSIGNED__')}
              className={`px-2 py-1 rounded-md text-[11px] font-medium transition-all shrink-0 cursor-pointer flex items-center gap-1.5 border ${
                characterFilter === '__UNASSIGNED__'
                  ? "bg-red-500 text-white border-red-400 shadow-sm"
                  : "bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20"
              }`}
              title="Показать только неразмеченные реплики"
            >
              <AlertCircle className="w-3 h-3 text-red-400" />
              Не размечено ({unassignedCount})
            </button>
          )}

          {characterStats.map(({ name, count, color }) => {
            const isSelected = characterFilter?.toLowerCase() === name.toLowerCase();
            return (
              <button
                key={name}
                onClick={() => setCharacterFilter(isSelected ? null : name)}
                style={{
                  borderColor: isSelected ? color.borderSolid : color.borderRgba,
                  backgroundColor: isSelected ? color.badgeBg : 'rgba(23, 23, 23, 0.7)'
                }}
                className={`px-2 py-1 rounded-md text-[11px] font-medium transition-all shrink-0 cursor-pointer flex items-center gap-1.5 border ${
                  isSelected ? 'ring-1 ring-white/30 text-white' : 'hover:brightness-125'
                }`}
                title={`Показать только реплики: ${name} (${count})`}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0 shadow-sm"
                  style={{ backgroundColor: color.borderSolid }}
                />
                <span style={{ color: isSelected ? '#ffffff' : color.textHex }}>
                  {name}
                </span>
                <span className="text-[10px] text-neutral-400 font-mono opacity-80">
                  {count}
                </span>
              </button>
            );
          })}

          {characterFilter && (
            <button
              onClick={() => setCharacterFilter(null)}
              className="p-1 text-neutral-500 hover:text-neutral-300 rounded hover:bg-neutral-800 transition-colors shrink-0 ml-auto"
              title="Сбросить фильтр персонажа"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Table Column Headers */}
      <div className={`grid ${
        showScreenshots
          ? "grid-cols-[55px_70px_70px_84px_90px_160px_1fr_95px]"
          : "grid-cols-[55px_70px_70px_100px_160px_1fr_100px]"
      } gap-3 p-3 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-sm text-xs font-semibold text-neutral-400 uppercase tracking-wider sticky top-0 z-10`}>
        <div className="text-center pl-1">
          <input
            type="checkbox"
            checked={visibleLines.length > 0 && selectedLines.size === visibleLines.length}
            onChange={(e) => onSelectAll(e.target.checked)}
            className="rounded border-neutral-700 bg-neutral-900 text-indigo-500 focus:ring-indigo-500/50 cursor-pointer"
          />
        </div>
        <div>Начало</div>
        <div>Конец</div>
        {showScreenshots && (
          <div className="flex items-center gap-1 text-cyan-400 font-semibold" title="Скриншот момента реплики">
            <Camera className="w-3.5 h-3.5" />
            <span>Кадр</span>
          </div>
        )}
        <div>Стиль</div>
        <div>Персонаж</div>
        <div>Текст реплики</div>
        <div className="text-right">Действия</div>
      </div>

      <div className="flex-1 overflow-y-auto p-1 space-y-1">
        {visibleLines.map((line) => {
          const isSelected = selectedLines.has(line.rawLineIndex);
          const isActive = activeLineIndex === line.rawLineIndex;

          return (
            <SubtitleLineRow
              key={line.rawLineIndex}
              line={line}
              isSelected={isSelected}
              isActive={isActive}
              updates={updates[line.rawLineIndex]}
              stableNames={stableNames}
              showSigns={showSigns}
              showScreenshots={showScreenshots}
              videoPath={videoPath}
              onUpdate={onLineUpdate}
              onToggleSelect={onToggleSelect}
              onPlay={onPlayFromTime}
              onDuplicate={onDuplicateLine}
              onAdd={onAddLine}
              onDelete={onDeleteLine}
              onCommitName={onCommitName}
              index={lines.indexOf(line)}
              isBookmarked={bookmarks.includes(line.rawLineIndex)}
              onToggleBookmark={onToggleBookmark}
              onOpenWhisperSnippet={onOpenWhisperSnippet}
            />
          );
        })}
        {visibleLines.length === 0 && !loading && (
          <div className="text-center py-8 text-neutral-500 text-sm">
            {characterFilter
              ? `Нет реплик для выбранного персонажа "${characterFilter}".`
              : "Нет реплик для отображения."}
          </div>
        )}
      </div>
    </div>
  );
};
