import React, { useState, useEffect, useRef } from 'react';
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react';

interface BrowserFindBarProps {
  isOpen: boolean;
  onClose: () => void;
  onFind: (text: string, options?: { forward?: boolean; findNext?: boolean }) => void;
  onStopFind: () => void;
  matchStats: { activeMatchOrdinal: number; numberOfMatches: number };
}

export const BrowserFindBar: React.FC<BrowserFindBarProps> = ({
  isOpen,
  onClose,
  onFind,
  onStopFind,
  matchStats
}) => {
  const [searchText, setSearchText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.select(), 50);
    } else {
      onStopFind();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setSearchText(text);
    if (text.trim()) {
      onFind(text, { forward: true, findNext: false });
    } else {
      onStopFind();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onFind(searchText, { forward: !e.shiftKey, findNext: true });
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleNext = () => {
    if (searchText) onFind(searchText, { forward: true, findNext: true });
  };

  const handlePrev = () => {
    if (searchText) onFind(searchText, { forward: false, findNext: true });
  };

  return (
    <div className="absolute top-2 right-4 z-40 bg-neutral-900 border border-neutral-700/80 rounded-xl shadow-2xl p-1.5 flex items-center gap-1.5 animate-in fade-in slide-in-from-top-2 duration-150">
      <Search className="w-3.5 h-3.5 text-neutral-400 ml-1.5 flex-shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={searchText}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Поиск на странице..."
        className="w-44 bg-neutral-950 text-xs text-white border border-neutral-800 rounded-lg px-2 py-1 outline-none focus:border-sky-500 font-mono"
      />

      <span className="text-[11px] font-mono text-neutral-400 px-1 min-w-[42px] text-center">
        {searchText ? `${matchStats.activeMatchOrdinal}/${matchStats.numberOfMatches}` : ''}
      </span>

      <div className="flex items-center gap-0.5 border-l border-neutral-800 pl-1">
        <button
          onClick={handlePrev}
          disabled={!searchText || matchStats.numberOfMatches === 0}
          className="p-1 rounded hover:bg-neutral-800 text-neutral-300 disabled:opacity-30 cursor-pointer"
          title="Предыдущее совпадение (Shift+Enter)"
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={handleNext}
          disabled={!searchText || matchStats.numberOfMatches === 0}
          className="p-1 rounded hover:bg-neutral-800 text-neutral-300 disabled:opacity-30 cursor-pointer"
          title="Следующее совпадение (Enter)"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-neutral-800 text-neutral-400 hover:text-white cursor-pointer ml-0.5"
          title="Закрыть поиск (Esc)"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
