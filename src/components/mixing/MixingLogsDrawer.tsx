import React, { useState, useRef, useEffect } from 'react';
import { 
  Terminal, 
  AlertCircle, 
  AlertTriangle, 
  Search, 
  Copy, 
  FileDown, 
  RotateCcw, 
  ArrowDown, 
  Minimize2, 
  Maximize2, 
  ChevronDown, 
  ChevronUp 
} from 'lucide-react';
import { MixingLogsDrawerProps, MixingLogEntry } from './mixing.types';

export const MixingLogsDrawer: React.FC<MixingLogsDrawerProps> = ({
  isOpen,
  onClose,
  logs,
  onClearLogs,
  onCopyLogs
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [filter, setFilter] = useState<'all' | 'error' | 'warn' | 'info' | 'debug'>('all');
  const [search, setSearch] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (autoScroll && isOpen && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, isOpen]);

  const handleDownloadLogs = () => {
    const header = `=== Лог процесса сведения видео ===\nДата выгрузки: ${new Date().toLocaleString('ru-RU')}\nВсего записей: ${logs.length}\n=====================================\n\n`;
    const text = header + logs
      .map(l => `[${l.fullTime || l.timestamp}] [${l.level.toUpperCase()}] [${l.tag}] ${l.message}${l.meta ? '\n' + JSON.stringify(l.meta, null, 2) : ''}`)
      .join('\n\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mixing_process_${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredLogs = logs.filter(l => {
    if (filter === 'error' && l.level !== 'error') return false;
    if (filter === 'warn' && l.level !== 'warn') return false;
    if (filter === 'info' && (l.level !== 'info' && l.level !== 'success')) return false;
    if (filter === 'debug' && l.level !== 'debug') return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return l.message.toLowerCase().includes(q) || l.tag.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className={`border-t border-neutral-800 bg-[#0b0c10] flex flex-col transition-all duration-200 z-20 ${
      isOpen ? (isExpanded ? 'h-96' : 'h-64') : 'h-9'
    }`}>
      {/* Header Bar */}
      <div className="bg-neutral-900/90 border-b border-neutral-800 px-4 py-1.5 flex items-center justify-between flex-shrink-0 select-none">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex items-center gap-2 text-xs font-semibold text-neutral-200 hover:text-white transition"
            title={isOpen ? 'Свернуть консоль' : 'Развернуть консоль'}
          >
            <div className="p-1 bg-purple-950/80 text-purple-400 rounded border border-purple-500/30">
              <Terminal className="w-3.5 h-3.5" />
            </div>
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-purple-300">
              &gt;_ Консоль процесса сведения
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 font-mono">
              {logs.length}
            </span>
          </button>

          {logs.filter(l => l.level === 'error').length > 0 && (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-950/80 text-red-400 border border-red-800/80 flex items-center gap-1 font-mono animate-pulse">
              <AlertCircle className="w-3 h-3" />
              {logs.filter(l => l.level === 'error').length} ошибок
            </span>
          )}

          {logs.filter(l => l.level === 'warn').length > 0 && (
            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-950/80 text-amber-300 border border-amber-800/60 flex items-center gap-1 font-mono">
              <AlertTriangle className="w-3 h-3" />
              {logs.filter(l => l.level === 'warn').length} пред.
            </span>
          )}

          {/* Preview when collapsed */}
          {!isOpen && logs.length > 0 && (
            <div className="text-[11px] font-mono text-neutral-400 truncate max-w-xl pl-2 border-l border-neutral-800">
              <span className="text-neutral-500 mr-1.5">[{logs[logs.length - 1].timestamp}]</span>
              <span className={
                logs[logs.length - 1].level === 'error' ? 'text-red-400 font-bold' :
                logs[logs.length - 1].level === 'warn' ? 'text-amber-400 font-semibold' :
                logs[logs.length - 1].level === 'success' ? 'text-emerald-400' : 'text-neutral-300'
              }>
                {logs[logs.length - 1].message}
              </span>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {isOpen && (
            <>
              {/* Level Filters */}
              <div className="flex items-center gap-1 bg-neutral-950 p-0.5 rounded border border-neutral-800 text-[10px] font-mono">
                {(['all', 'error', 'warn', 'info', 'debug'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-2 py-0.5 rounded transition ${
                      filter === f 
                        ? 'bg-purple-900/60 text-purple-200 font-semibold' 
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    {f === 'all' ? 'Все' : f === 'error' ? 'Ошибки' : f === 'warn' ? 'Внимание' : f === 'info' ? 'Инфо' : 'Отладка'}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="relative flex items-center">
                <Search className="w-3 h-3 absolute left-2 text-neutral-500" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск..."
                  className="pl-6 pr-2 py-0.5 bg-neutral-950 border border-neutral-800 rounded text-[11px] font-mono text-neutral-200 w-28 focus:w-40 transition-all focus:outline-none"
                />
              </div>

              {/* Copy */}
              <button
                onClick={onCopyLogs}
                className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-[11px] flex items-center gap-1 font-mono transition"
                title="Скопировать логи"
              >
                <Copy className="w-3 h-3" />
                <span className="hidden sm:inline">Копия</span>
              </button>

              {/* Download */}
              <button
                onClick={handleDownloadLogs}
                className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-[11px] flex items-center gap-1 font-mono transition"
                title="Скачать лог-файл"
              >
                <FileDown className="w-3 h-3" />
              </button>

              {/* Clear */}
              <button
                onClick={onClearLogs}
                className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-[11px] flex items-center gap-1 font-mono transition"
                title="Очистить терминал"
              >
                <RotateCcw className="w-3 h-3" />
              </button>

              {/* Auto-scroll */}
              <button
                onClick={() => setAutoScroll(prev => !prev)}
                className={`px-2 py-1 rounded text-[11px] flex items-center gap-1 font-mono transition border ${
                  autoScroll 
                    ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50' 
                    : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                }`}
                title="Автоскролл"
              >
                <ArrowDown className={`w-3 h-3 ${autoScroll ? 'animate-bounce' : ''}`} />
              </button>

              {/* Height toggle */}
              <button
                onClick={() => setIsExpanded(prev => !prev)}
                className="p-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-xs transition"
                title={isExpanded ? 'Уменьшить высоту' : 'Увеличить высоту'}
              >
                {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
            </>
          )}

          {/* Toggle Button */}
          <button
            onClick={onClose}
            className="p-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded transition"
          >
            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Log Output Stream */}
      {isOpen && (
        <div className="flex-1 bg-[#090a0f] p-3 overflow-y-auto font-mono text-[11px] leading-relaxed select-text space-y-1">
          {filteredLogs.length === 0 ? (
            <div className="text-neutral-500 italic py-6 text-center text-xs">
              Логов нет
            </div>
          ) : (
            filteredLogs.map((logItem) => (
              <div 
                key={logItem.id}
                className={`p-1 rounded transition-colors ${
                  logItem.level === 'error' ? 'bg-red-950/20 text-red-300 border-l-2 border-red-500' :
                  logItem.level === 'warn' ? 'bg-amber-950/15 text-amber-300 border-l-2 border-amber-500' :
                  logItem.level === 'success' ? 'bg-emerald-950/15 text-emerald-300 border-l-2 border-emerald-500' :
                  logItem.level === 'debug' ? 'text-neutral-500' : 'text-neutral-300'
                }`}
              >
                <span className="text-neutral-500 select-none mr-1.5">[{logItem.timestamp}]</span>
                <span className="text-purple-400 font-semibold select-none mr-1.5">[{logItem.tag}]</span>
                <span>{logItem.message}</span>
                {logItem.meta && (
                  <details className="mt-1 ml-6 text-[10px] text-neutral-400">
                    <summary className="cursor-pointer text-neutral-500 hover:text-neutral-300">
                      ▸ Детали объекта
                    </summary>
                    <pre className="mt-1 p-2 bg-neutral-950 rounded border border-neutral-800 overflow-x-auto text-neutral-300">
                      {typeof logItem.meta === 'string' ? logItem.meta : JSON.stringify(logItem.meta, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
};
