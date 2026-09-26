import React, { useEffect, useState, useRef } from 'react';
import { Task } from '../types';
import { ipcSafe } from '../lib/ipcSafe';
import { X, Loader2, CheckCircle2, AlertCircle, XCircle, Clock, Terminal, Copy, Check, FolderOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function TaskQueuePanel() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [expandedLogTaskId, setExpandedLogTaskId] = useState<string | null>(null);
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const data = await ipcSafe.invoke('get-tasks');
        if (data) setTasks(data);
      } catch (error) {
        console.error('Failed to fetch tasks', error);
      }
    };

    fetchTasks();

    const removeListener = ipcSafe.on('task-queue-updated', (updatedTasks: Task[]) => {
      setTasks(updatedTasks);
      // Automatically open if a new task is added or running
      if (updatedTasks.some(t => t.status === 'running' || t.status === 'pending')) {
        setIsOpen(true);
      }
    });

    const removeProgressListener = ipcSafe.on('task-progress', (data: { id: string, progress: number, eta: number | null, step?: string, log?: string, logs?: string[] }) => {
      setTasks(prevTasks => prevTasks.map(task => {
        if (task.id !== data.id) return task;
        const newLogs = data.logs || (data.log ? [...(task.logs || []), data.log] : task.logs);
        return { 
          ...task, 
          progress: data.progress, 
          eta: data.eta, 
          step: data.step !== undefined ? data.step : task.step,
          logs: newLogs
        };
      }));
    });

    return () => {
      removeListener();
      removeProgressListener();
    };
  }, []);

  // Auto-scroll active log view
  useEffect(() => {
    if (expandedLogTaskId && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [tasks, expandedLogTaskId]);

  const activeTasksCount = tasks.filter(t => t.status === 'running' || t.status === 'pending').length;

  if (tasks.length === 0 && !isOpen) return null;

  const handleAbort = async (taskId: string) => {
    try {
      await ipcSafe.invoke('abort-task', taskId);
    } catch (error) {
      console.error('Failed to abort task', error);
    }
  };

  const handleCopyLogs = (taskId: string, logs?: string[]) => {
    if (!logs || logs.length === 0) return;
    navigator.clipboard.writeText(logs.join('\n'));
    setCopiedTaskId(taskId);
    setTimeout(() => setCopiedTaskId(null), 2000);
  };

  const handleOpenFolder = (dir?: string) => {
    if (!dir) return;
    ipcSafe.invoke('open-path', dir).catch(err => {
      console.warn('Failed to open folder:', err);
    });
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="w-96 md:w-[440px] bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[520px]"
          >
            <div className="p-3 border-b border-slate-800 bg-slate-900/70 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-bold text-slate-200">Очередь задач и экспорта</span>
                {activeTasksCount > 0 && (
                  <span className="bg-indigo-500 text-white text-[10px] px-1.5 py-0.5 rounded-full animate-pulse">
                    {activeTasksCount}
                  </span>
                )}
              </div>
              <button 
                onClick={() => setIsOpen(false)}
                className="text-slate-500 hover:text-slate-300 transition-colors p-1"
                title="Свернуть"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto p-2 space-y-2.5">
              {tasks.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-sm">Очередь пуста</div>
              ) : (
                [...tasks].reverse().map((task) => {
                  const isLogExpanded = expandedLogTaskId === task.id;
                  const taskLogs = task.logs || [];

                  return (
                    <div 
                      key={task.id} 
                      className={`p-3 rounded-lg border transition-colors ${
                        task.status === 'running' ? 'bg-indigo-500/10 border-indigo-500/30' : 
                        task.status === 'failed' ? 'bg-red-500/10 border-red-500/30' :
                        task.status === 'completed' ? 'bg-emerald-500/5 border-emerald-500/20' :
                        'bg-slate-800/50 border-slate-700'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-1.5">
                        <div className="flex flex-col flex-1 min-w-0 mr-2">
                          <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                            {task.type === 'bake-subtitles' ? 'Рендеринг' : 
                             task.type === 'mux-release' ? 'Сборка' : 
                             task.type === 'transcode-video' ? 'Конвертация' : 
                             task.type === 'export-dabber-files' ? 'Экспорт даберам' :
                             task.type === 'export-sound-engineer-files' ? 'Экспорт звукорежиссеру' :
                             task.type}
                          </span>
                          <span className="text-xs font-semibold text-slate-100 truncate" title={task.metadata?.title}>
                            {task.metadata?.title || 'Без названия'}
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-1.5 shrink-0">
                          {task.status === 'running' && <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />}
                          {task.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                          {task.status === 'failed' && <AlertCircle className="w-3.5 h-3.5 text-red-400" />}
                          {task.status === 'aborted' && <XCircle className="w-3.5 h-3.5 text-slate-500" />}
                          
                          {(task.status === 'pending' || task.status === 'running') && (
                            <button 
                              onClick={() => handleAbort(task.id)}
                              className="p-1 hover:bg-red-500/20 rounded text-slate-500 hover:text-red-400 transition-colors"
                              title="Отменить задачу"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Current active step / action */}
                      {task.step && (
                        <div className="text-[11px] text-indigo-300 font-medium mb-1.5 truncate flex items-center gap-1.5">
                          {task.status === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping inline-block shrink-0" />}
                          <span className="truncate">{task.step}</span>
                        </div>
                      )}

                      {task.status === 'running' && (
                        <div className="mt-1 space-y-1">
                          <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                            <motion.div 
                              className="bg-indigo-500 h-full"
                              initial={{ width: 0 }}
                              animate={{ width: `${task.progress}%` }}
                              transition={{ duration: 0.3 }}
                            />
                          </div>
                          <div className="flex justify-between text-[10px]">
                            <span className="text-indigo-400 font-semibold">{task.progress}%</span>
                            <span className="text-slate-400">
                              {task.eta ? `Осталось: ~${task.eta}с` : 'Обработка файлов...'}
                            </span>
                          </div>
                        </div>
                      )}

                      {task.status === 'pending' && (
                        <div className="mt-1 text-[10px] text-slate-500 italic">
                          Ожидает в очереди...
                        </div>
                      )}

                      {task.error && (
                        <div className="mt-1.5 text-[11px] text-red-400 bg-red-950/40 border border-red-900/50 p-2 rounded leading-tight">
                          {task.error}
                        </div>
                      )}

                      {/* Controls bar: Logs toggle and open folder */}
                      <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px]">
                        <button
                          onClick={() => setExpandedLogTaskId(isLogExpanded ? null : task.id)}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
                            isLogExpanded 
                              ? 'bg-indigo-600/30 text-indigo-200 border border-indigo-500/40' 
                              : 'bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <Terminal className="w-3 h-3" />
                          <span>{isLogExpanded ? 'Скрыть лог' : `Лог (${taskLogs.length})`}</span>
                        </button>

                        <div className="flex items-center gap-1.5">
                          {taskLogs.length > 0 && isLogExpanded && (
                            <button
                              onClick={() => handleCopyLogs(task.id, taskLogs)}
                              className="flex items-center gap-1 px-1.5 py-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
                              title="Скопировать лог в буфер"
                            >
                              {copiedTaskId === task.id ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  <span className="text-emerald-400">Скопировано!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>Копировать</span>
                                </>
                              )}
                            </button>
                          )}

                          {task.metadata?.targetDir && (
                            <button
                              onClick={() => handleOpenFolder(task.metadata.targetDir)}
                              className="flex items-center gap-1 px-1.5 py-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
                              title="Открыть папку экспорта"
                            >
                              <FolderOpen className="w-3 h-3 text-indigo-400" />
                              <span>Папка</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Expandable live log view */}
                      {isLogExpanded && (
                        <div 
                          ref={logContainerRef}
                          className="mt-2 p-2 bg-slate-950 border border-slate-800 rounded font-mono text-[10px] text-slate-300 max-h-48 overflow-y-auto space-y-1 select-text"
                        >
                          {taskLogs.length === 0 ? (
                            <div className="text-slate-600 italic">Логи отсутствуют...</div>
                          ) : (
                            taskLogs.map((line, idx) => {
                              let color = 'text-slate-300';
                              if (line.includes('❌') || line.includes('ОШИБКА')) color = 'text-red-400 font-semibold';
                              else if (line.includes('⚠️') || line.includes('ВНИМАНИЕ')) color = 'text-yellow-400';
                              else if (line.includes('✅') || line.includes('УСПЕХ') || line.includes('🎉')) color = 'text-emerald-400 font-semibold';
                              else if (line.includes('[Автотайминг]') || line.includes('[Рендеринг]')) color = 'text-indigo-300';

                              return (
                                <div key={idx} className={`leading-relaxed break-words ${color}`}>
                                  {line}
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            
            {tasks.some(t => t.status === 'completed' || t.status === 'failed' || t.status === 'aborted') && (
              <div className="p-2 border-t border-slate-800 text-center bg-slate-900/40">
                <button 
                  onClick={() => ipcSafe.invoke('clear-task-history')}
                  className="text-[10px] text-slate-500 hover:text-slate-300 uppercase font-bold tracking-widest transition-colors"
                >
                  Очистить историю задач
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`p-3.5 rounded-full shadow-lg transition-all duration-300 flex items-center justify-center relative ${
          activeTasksCount > 0 
            ? 'bg-indigo-600 text-white scale-105 shadow-indigo-600/40 ring-4 ring-indigo-500/20' 
            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
        }`}
        title="Очередь задач"
      >
        <Clock className={`w-5 h-5 ${activeTasksCount > 0 ? 'animate-spin' : ''}`} />
        {activeTasksCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-slate-900">
            {activeTasksCount}
          </span>
        )}
      </button>
    </div>
  );
}

