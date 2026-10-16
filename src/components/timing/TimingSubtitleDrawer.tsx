import React, { useState, useMemo } from 'react';
import { SubtitleLine } from '../../types';
import { AudioClip } from '../../types/timing';
import { formatSeconds } from '../../services/timing/SubtitleAlignmentService';
import { Search, ChevronDown, ChevronUp, Clock, CheckCircle2, AlertCircle, Play } from 'lucide-react';

interface TimingSubtitleDrawerProps {
  subLines: SubtitleLine[];
  allClips: AudioClip[];
  currentTime: number;
  isOpen: boolean;
  onToggleOpen: () => void;
  onSeek: (timeSec: number) => void;
  onAssignClipToSub?: (clipId: string, sub: SubtitleLine) => void;
}

export const TimingSubtitleDrawer: React.FC<TimingSubtitleDrawerProps> = ({
  subLines,
  allClips,
  currentTime,
  isOpen,
  onToggleOpen,
  onSeek,
  onAssignClipToSub
}) => {
  const [search, setSearch] = useState('');
  const [selectedActor, setSelectedActor] = useState<string>('all');

  // List of unique actors in subtitles
  const actors = useMemo(() => {
    const set = new Set<string>();
    subLines.forEach(l => {
      if (l.name) set.add(l.name);
    });
    return Array.from(set).sort();
  }, [subLines]);

  // Filtered lines
  const filteredLines = useMemo(() => {
    return subLines.filter(line => {
      if (selectedActor !== 'all' && line.name !== selectedActor) return false;
      if (search && !line.text.toLowerCase().includes(search.toLowerCase()) && !line.name.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [subLines, selectedActor, search]);

  if (!isOpen) {
    return (
      <div className="bg-neutral-900 border-t border-neutral-800 px-4 py-1.5 flex items-center justify-between">
        <button
          onClick={onToggleOpen}
          className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-200 font-medium"
        >
          <ChevronUp className="w-4 h-4" />
          <span>Субтитры ASS ({subLines.length} строк)</span>
        </button>
        <div className="text-[11px] text-neutral-500 font-mono">
          Кликните для разворота панели реплик
        </div>
      </div>
    );
  }

  return (
    <div className="h-60 bg-neutral-900 border-t border-neutral-800 flex flex-col select-none">
      {/* Top filter bar */}
      <div className="px-4 py-2 border-b border-neutral-800 flex items-center justify-between gap-3 bg-neutral-950/60">
        <div className="flex items-center gap-2 flex-1">
          <button
            onClick={onToggleOpen}
            className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-200 font-semibold"
          >
            <ChevronDown className="w-4 h-4" />
            <span>Субтитры ({filteredLines.length})</span>
          </button>

          <div className="relative flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              type="text"
              placeholder="Поиск по репликам..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <select
            value={selectedActor}
            onChange={(e) => setSelectedActor(e.target.value)}
            className="px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs text-neutral-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="all">Все персонажи</option>
            {actors.map(act => (
              <option key={act} value={act}>{act}</option>
            ))}
          </select>
        </div>

        <span className="text-[11px] text-neutral-500 font-mono tabular-nums">
          Всего реплик: {subLines.length}
        </span>
      </div>

      {/* Subtitles rows */}
      <div className="flex-1 overflow-y-auto divide-y divide-neutral-800/40">
        {filteredLines.map(line => {
          const isCurrent = currentTime >= line.startSec && currentTime <= line.endSec;
          const matchedClip = allClips.find(c => c.targetSubStartSec === line.startSec);

          return (
            <div
              key={line.id}
              onClick={() => onSeek(line.startSec)}
              className={`px-4 py-2 flex items-center justify-between gap-4 text-xs transition-colors cursor-pointer ${
                isCurrent
                  ? 'bg-indigo-950/40 hover:bg-indigo-900/40 border-l-2 border-indigo-500'
                  : 'hover:bg-neutral-800/60'
              }`}
            >
              {/* Left: Time and Character */}
              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSeek(line.startSec);
                  }}
                  className="p-1 rounded hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200"
                  title="Перейти к началу реплики"
                >
                  <Play className="w-3 h-3" />
                </button>

                <div className="font-mono text-[11px] text-neutral-400 tabular-nums">
                  {formatSeconds(line.startSec)} - {formatSeconds(line.endSec)}
                </div>

                <div className="px-1.5 py-0.5 bg-neutral-800 rounded text-[11px] font-semibold text-neutral-300 max-w-[120px] truncate">
                  {line.name || 'Без имени'}
                </div>
              </div>

              {/* Center: Text */}
              <div className="flex-1 text-neutral-200 truncate font-sans">
                {line.text}
              </div>

              {/* Right: Sync Status */}
              <div className="shrink-0 flex items-center gap-2">
                {matchedClip ? (
                  <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Синхронизировано</span>
                  </span>
                ) : (
                  <span className="text-[11px] text-neutral-500">
                    Ожидает тайминга
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
