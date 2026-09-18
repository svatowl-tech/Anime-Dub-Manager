import React, { useRef, useEffect, useMemo } from "react";
import { Bookmark, AlertCircle, Plus, Copy, Trash2, Sparkles } from "lucide-react";
import { RawSubtitleLine } from "./types";
import { getCharacterColor } from "./characterColors";
import { SubtitleThumbnailCell } from "./SubtitleThumbnailCell";

interface SubtitleLineRowProps {
  line: RawSubtitleLine;
  isSelected: boolean;
  isActive: boolean;
  updates: any;
  stableNames: string[];
  showSigns: boolean;
  showScreenshots?: boolean;
  videoPath?: string;
  onUpdate: (idx: number, update: any) => void;
  onToggleSelect: (idx: number, isShift: boolean) => void;
  onPlay: (time: string) => void;
  onDuplicate: (idx: number) => void;
  onAdd: (idx: number) => void;
  onDelete: (idx: number) => void;
  onCommitName: (name: string) => void;
  index: number;
  isBookmarked: boolean;
  onToggleBookmark: (idx: number) => void;
  onOpenWhisperSnippet?: (startSec: number, endSec: number) => void;
}

export const SubtitleLineRow = React.memo(({
  line,
  isSelected,
  isActive,
  updates,
  stableNames,
  showScreenshots = false,
  videoPath,
  onUpdate,
  onToggleSelect,
  onPlay,
  onDuplicate,
  onAdd,
  onDelete,
  onCommitName,
  index,
  isBookmarked,
  onToggleBookmark,
  onOpenWhisperSnippet,
}: SubtitleLineRowProps) => {
  const currentName = updates?.name !== undefined ? updates.name : line.name;
  const currentText = updates?.text !== undefined ? updates.text : line.text;
  const currentStart = updates?.start !== undefined ? updates.start : line.start;
  const currentEnd = updates?.end !== undefined ? updates.end : line.end;

  const charColor = useMemo(
    () => getCharacterColor(currentName, stableNames),
    [currentName, stableNames]
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '1px';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = Math.max(24, Math.min(scrollHeight, 200)) + 'px';
    }
  }, [currentText]);

  return (
    <div
      id={`line-${line.rawLineIndex}`}
      onClick={(e) => {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).closest('button')) return;
        onPlay(line.start);
      }}
      style={{
        borderLeftColor: charColor.borderSolid,
        borderLeftWidth: '4px',
        backgroundColor: isSelected
          ? undefined
          : isActive
          ? undefined
          : charColor.bgRgba
      }}
      className={`grid ${
        showScreenshots
          ? "grid-cols-[55px_70px_70px_84px_90px_160px_1fr_95px]"
          : "grid-cols-[55px_70px_70px_100px_160px_1fr_100px]"
      } gap-3 p-2 items-start rounded-lg border transition-all cursor-pointer group ${
        isSelected
          ? "bg-indigo-500/15 border-indigo-500/40 shadow-sm"
          : isActive
          ? "bg-blue-500/15 border-blue-500/40 ring-1 ring-blue-500/25"
          : "border-neutral-900/80 hover:border-neutral-800 hover:brightness-110"
      }`}
    >
      <div className="text-center flex items-center justify-between gap-1.5 pl-1">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(line.rawLineIndex, false)}
          className="rounded border-neutral-700 bg-neutral-900 text-indigo-500 focus:ring-indigo-500/50 cursor-pointer"
        />
        <button
          onClick={(e) => { e.stopPropagation(); onToggleBookmark(line.rawLineIndex); }}
          className={`p-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 ${
            isBookmarked ? 'opacity-100 text-amber-500' : 'text-neutral-600 hover:text-neutral-400'
          } transition-opacity cursor-pointer`}
          title={isBookmarked ? "Удалить из закладок" : "В закладки"}
        >
          <Bookmark className="w-3.5 h-3.5" fill={isBookmarked ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="text-xs text-neutral-500 font-mono">
        <input
          type="text"
          className="w-full bg-transparent border-b border-transparent hover:border-neutral-700 focus:border-indigo-500 focus:outline-none transition-colors"
          value={currentStart}
          onChange={(e) => onUpdate(line.rawLineIndex, { start: e.target.value })}
        />
      </div>
      <div className="text-xs text-neutral-500 font-mono">
        <input
          type="text"
          className="w-full bg-transparent border-b border-transparent hover:border-neutral-700 focus:border-indigo-500 focus:outline-none transition-colors"
          value={currentEnd}
          onChange={(e) => onUpdate(line.rawLineIndex, { end: e.target.value })}
        />
      </div>
      {showScreenshots && (
        <SubtitleThumbnailCell
          videoPath={videoPath}
          timeStr={currentStart}
          characterName={currentName}
          lineText={currentText}
          charColor={charColor}
          onPlay={onPlay}
          showScreenshots={showScreenshots}
        />
      )}
      <div
        className="text-xs text-neutral-400 truncate"
        title={line.style}
      >
        {line.style}
      </div>
      <div className="relative flex items-center">
        {/* Character Color Dot Indicator */}
        <span
          className="w-2.5 h-2.5 rounded-full absolute left-2 top-1/2 -translate-y-1/2 shrink-0 shadow-sm pointer-events-none z-10 transition-colors"
          style={{ backgroundColor: charColor.borderSolid }}
          title={charColor.isUnassigned ? "Персонаж не указан" : `Персонаж: ${currentName}`}
        />
        <input
          type="text"
          value={currentName}
          onChange={(e) => onUpdate(line.rawLineIndex, { name: e.target.value })}
          onBlur={(e) => onCommitName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className={`w-full bg-neutral-900/90 border rounded pl-6 pr-6 py-1 text-xs focus:outline-none focus:border-indigo-500 transition-colors font-medium ${
            updates?.name !== undefined
              ? "border-indigo-500/50 text-indigo-300"
              : !currentName || !currentName.trim()
              ? "border-red-500/50 text-red-300 bg-red-500/10"
              : "text-neutral-200"
          }`}
          style={
            currentName?.trim() && updates?.name === undefined
              ? {
                  borderColor: charColor.badgeBorder,
                  color: charColor.textHex
                }
              : undefined
          }
          placeholder="Имя..."
          list={`names-${line.rawLineIndex}`}
        />
        <datalist id={`names-${line.rawLineIndex}`}>
          {stableNames.map(name => <option key={name} value={name} />)}
        </datalist>
        {(!currentName || !currentName.trim()) && (
          <AlertCircle className="w-3 h-3 text-red-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        )}
      </div>
      <div className="flex-grow min-w-0">
        <textarea
          ref={textareaRef}
          value={currentText}
          onChange={(e) => onUpdate(line.rawLineIndex, { text: e.target.value })}
          rows={1}
          className={`w-full bg-transparent border-none text-xs transition-colors focus:outline-none focus:text-white resize-none py-1 block leading-relaxed ${
            updates?.text !== undefined ? "text-indigo-300" : "text-neutral-200"
          }`}
        />
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-end pr-2">
        {onOpenWhisperSnippet && (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenWhisperSnippet(line.startSec, line.endSec); }}
            title="Распознать этот фрагмент через Whisper и перевести"
            className="p-1.5 text-purple-400 hover:text-purple-200 bg-purple-950/40 hover:bg-purple-900/60 border border-purple-800/50 rounded cursor-pointer transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onAdd(index); }}
          title="Добавить реплику ниже"
          className="p-1.5 text-neutral-500 hover:text-emerald-400 bg-neutral-800 hover:bg-neutral-700 rounded cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDuplicate(index); }}
          title="Дублировать реплику"
          className="p-1.5 text-neutral-500 hover:text-indigo-400 bg-neutral-800 hover:bg-neutral-700 rounded cursor-pointer"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(index); }}
          title="Удалить реплику"
          className="p-1.5 text-neutral-500 hover:text-red-400 bg-neutral-800 hover:bg-neutral-700 rounded cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
});
