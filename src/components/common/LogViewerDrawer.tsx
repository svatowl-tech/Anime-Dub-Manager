import React, { useState, useRef, useEffect } from 'react';
import { Terminal, X, Trash2, Copy, Check, ChevronDown, ChevronUp, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { LogEntry } from '../../lib/appLogger';
import { toast } from 'sonner';

interface LogViewerDrawerProps {
  title: string;
  scope: string;
  logs: LogEntry[];
  onClear: () => void;
  isOpen: boolean;
  onToggle: () => void;
  maxHeightClass?: string;
}

export const LogViewerDrawer: React.FC<LogViewerDrawerProps> = ({
  title,
  scope,
  logs,
  onClear,
  isOpen,
  onToggle,
  maxHeightClass = 'max-h-60'
}) => {
  const [filter, setFilter] = useState<'all' | 'error' | 'warn' | 'info'>('all');
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filteredLogs = logs.filter(log => {
    if (filter === 'all') return true;
    return log.level === filter;
  });

  const errorCount = logs.filter(l => l.level === 'error').length;
  const warnCount = logs.filter(l => l.level === 'warn').length;

  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredLogs.length, isOpen]);

  const handleCopyAll = () => {
    if (logs.length === 0) return;
    const text = logs
      .map(l => `[${l.time}] [${l.level.toUpperCase()}] [${l.scope}] ${l.message}${l.details ? ' ' + JSON.stringify(l.details) : ''}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Журнал скопирован в буфер обмена');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full bg-neutral-900/95 border border-neutral-800 rounded-xl overflow-hidden shadow-lg transition-all">
      {/* Header bar */}
      <div 
        onClick={onToggle}
        className="flex items-center justify-between px-3 py-2 bg-neutral-800/80 hover:bg-neutral-800 cursor-pointer select-none transition"
      >
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-sky-400" />
          <span className="text-xs font-semibold text-neutral-200">{title}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-700 text-neutral-300 font-mono">
            {logs.length}
          </span>
          {errorCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 font-mono border border-red-500/30 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {errorCount}
            </span>
          )}
          {warnCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-mono border border-amber-500/30 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> {warnCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {isOpen && (
            <>
              {/* Filter buttons */}
              <div className="flex items-center gap-1 bg-neutral-900/80 p-0.5 rounded border border-neutral-700/60 text-[10px]">
                <button
                  type="button"
                  onClick={() => setFilter('all')}
                  className={`px-1.5 py-0.5 rounded ${filter === 'all' ? 'bg-neutral-700 text-white font-medium' : 'text-neutral-400 hover:text-neutral-200'}`}
                >
                  Все
                </button>
                <button
                  type="button"
                  onClick={() => setFilter('info')}
                  className={`px-1.5 py-0.5 rounded ${filter === 'info' ? 'bg-sky-900/60 text-sky-200 font-medium' : 'text-neutral-400 hover:text-neutral-200'}`}
                >
                  Info
                </button>
                <button
                  type="button"
                  onClick={() => setFilter('warn')}
                  className={`px-1.5 py-0.5 rounded ${filter === 'warn' ? 'bg-amber-900/60 text-amber-200 font-medium' : 'text-neutral-400 hover:text-neutral-200'}`}
                >
                  Предупреждения
                </button>
                <button
                  type="button"
                  onClick={() => setFilter('error')}
                  className={`px-1.5 py-0.5 rounded ${filter === 'error' ? 'bg-red-900/60 text-red-200 font-medium' : 'text-neutral-400 hover:text-neutral-200'}`}
                >
                  Ошибки
                </button>
              </div>

              {/* Copy */}
              <button
                type="button"
                onClick={handleCopyAll}
                title="Копировать журнал"
                className="p-1 rounded text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700 transition"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>

              {/* Clear */}
              <button
                type="button"
                onClick={onClear}
                title="Очистить журнал"
                className="p-1 rounded text-neutral-400 hover:text-red-400 hover:bg-neutral-700 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onToggle}
            className="p-1 rounded text-neutral-400 hover:text-neutral-200 transition ml-1"
          >
            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Body content */}
      {isOpen && (
        <div 
          ref={scrollRef}
          className={`${maxHeightClass} overflow-y-auto p-2.5 space-y-1 font-mono text-[11px] select-text bg-black/60 border-t border-neutral-800/80`}
        >
          {filteredLogs.length === 0 ? (
            <div className="text-center py-4 text-neutral-500 text-xs italic">
              Журнал пуст. События будут появляться здесь при выполнении операций.
            </div>
          ) : (
            filteredLogs.map((entry) => {
              const isError = entry.level === 'error';
              const isWarn = entry.level === 'warn';
              const isDebug = entry.level === 'debug';

              return (
                <div 
                  key={entry.id} 
                  className={`flex items-start gap-1.5 leading-relaxed py-0.5 px-1 rounded transition ${
                    isError 
                      ? 'bg-red-500/10 text-red-300 font-medium' 
                      : isWarn 
                      ? 'bg-amber-500/10 text-amber-300' 
                      : isDebug
                      ? 'text-neutral-400'
                      : 'text-neutral-200 hover:bg-neutral-800/40'
                  }`}
                >
                  <span className="text-neutral-500 shrink-0 select-none">[{entry.time}]</span>
                  <span className={`text-[10px] px-1 rounded uppercase font-bold shrink-0 select-none ${
                    isError 
                      ? 'bg-red-900/60 text-red-200' 
                      : isWarn 
                      ? 'bg-amber-900/60 text-amber-200' 
                      : 'bg-neutral-800 text-sky-300'
                  }`}>
                    {entry.level}
                  </span>
                  <span className="break-all flex-1">{entry.message}</span>
                  {entry.details && (
                    <span className="text-neutral-400 text-[10px] truncate max-w-xs">
                      {typeof entry.details === 'object' ? JSON.stringify(entry.details) : String(entry.details)}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
