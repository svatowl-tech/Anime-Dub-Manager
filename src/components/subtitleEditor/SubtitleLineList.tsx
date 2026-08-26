import React from "react";
import { RawSubtitleLine, SubtitleUpdates } from "./types";
import { SubtitleLineRow } from "./SubtitleLineRow";

interface SubtitleLineListProps {
  lines: RawSubtitleLine[];
  selectedLines: Set<number>;
  activeLineIndex: number | null;
  updates: SubtitleUpdates;
  stableNames: string[];
  showSigns: boolean;
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
}

export const SubtitleLineList: React.FC<SubtitleLineListProps> = ({
  lines,
  selectedLines,
  activeLineIndex,
  updates,
  stableNames,
  showSigns,
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
}) => {
  const visibleLines = lines.filter(line => showSigns || !isSignLine(line));

  return (
    <div className="flex-1 overflow-y-auto flex flex-col p-2 space-y-1">
      <div className="grid grid-cols-[30px_70px_70px_100px_150px_1fr_100px] gap-3 p-3 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-sm text-xs font-semibold text-neutral-400 uppercase tracking-wider sticky top-0 z-10">
        <div className="text-center">
          <input
            type="checkbox"
            checked={lines.length > 0 && selectedLines.size === lines.length}
            onChange={(e) => onSelectAll(e.target.checked)}
            className="rounded border-neutral-700 bg-neutral-900 text-indigo-500 focus:ring-indigo-500/50 cursor-pointer"
          />
        </div>
        <div>Начало</div>
        <div>Конец</div>
        <div>Стиль</div>
        <div>Актер / Имя</div>
        <div>Текст</div>
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
            />
          );
        })}
        {lines.length === 0 && !loading && (
          <div className="text-center py-8 text-neutral-500 text-sm">
            Нет реплик для отображения.
          </div>
        )}
      </div>
    </div>
  );
};
