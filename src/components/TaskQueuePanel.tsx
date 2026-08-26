import React, { useEffect, useState } from 'react';
import { Task } from '../types';
import { ipcSafe } from '../lib/ipcSafe';
import { X, Loader2, CheckCircle2, AlertCircle, XCircle, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function TaskQueuePanel() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isOpen, setIsOpen] = useState(false);

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

    const removeProgressListener = ipcSafe.on('task-progress', (data: { id: string, progress: number, eta: number | null }) => {
      setTasks(prevTasks => prevTasks.map(task => 
        task.id === data.id ? { ...task, progress: data.progress, eta: data.eta } : task
      ));
    });

    return () => {
      removeListener();
      removeProgressListener();
    };
  }, []);

  const activeTasksCount = tasks.filter(t => t.status === 'running' || t.status === 'pending').length;

  if (tasks.length === 0 && !isOpen) return null;

  const handleAbort = async (taskId: string) => {
    try {
      await ipcSafe.invoke('abort-task', taskId);
    } catch (error) {
      console.error('Failed to abort task', error);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="w-80 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[400px]"
          >
            <div className="p-3 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-bold text-slate-200">Очередь задач</span>
                {activeTasksCount > 0 && (
                  <span className="bg-indigo-500 text-white text-[10px] px-1.5 py-0.5 rounded-full animate-pulse">
                    {activeTasksCount}
                  </span>
                )}
              </div>
              <button 
                onClick={() => setIsOpen(false)}
                className="text-slate-500 hover:text-slate-300 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto p-2 space-y-2">
              {tasks.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-sm">Очередь пуста</div>
              ) : (
                [...tasks].reverse().map((task) => (
                  <div 
                    key={task.id} 
                    className={`p-3 rounded-lg border ${
                      task.status === 'running' ? 'bg-indigo-500/10 border-indigo-500/30' : 
                      task.status === 'failed' ? 'bg-red-500/10 border-red-500/30' :
                      'bg-slate-800/50 border-slate-700'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">
                          {task.type === 'bake-subtitles' ? 'Рендеринг' : 
                           task.type === 'mux-release' ? 'Сборка' : 
                           task.type === 'transcode-video' ? 'Конвертация' : 
                           task.type === 'export-dabber-files' ? 'Экспорт даберам' :
                           task.type === 'export-sound-engineer-files' ? 'Экспорт звукорежиссеру' :
                           task.type}
                        </span>
                        <span className="text-xs font-medium text-slate-200 truncate max-w-[180px]">
                          {task.metadata?.title || 'Без названия'}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-1.5">
                        {task.status === 'running' && <Loader2 className="w-3 h-3 text-indigo-400 animate-spin" />}
                        {task.status === 'completed' && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                        {task.status === 'failed' && <AlertCircle className="w-3 h-3 text-red-400" />}
                        {task.status === 'aborted' && <XCircle className="w-3 h-3 text-slate-500" />}
                        
                        {(task.status === 'pending' || task.status === 'running') && (
                          <button 
                            onClick={() => handleAbort(task.id)}
                            className="ml-1 p-1 hover:bg-red-500/20 rounded text-slate-500 hover:text-red-400 transition-colors"
                            title="Отменить"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    {task.status === 'running' && (
                      <div className="mt-2 space-y-1.5">
                        <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                          <motion.div 
                            className="bg-indigo-500 h-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${task.progress}%` }}
                            transition={{ duration: 0.5 }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px]">
                          <span className="text-indigo-400 font-medium">{task.progress}%</span>
                          <span className="text-slate-500">
                            {task.eta ? `Осталось: ~${task.eta}с` : 'Расчет времени...'}
                          </span>
                        </div>
                      </div>
                    )}

                    {task.status === 'pending' && (
                      <div className="mt-1 text-[10px] text-slate-500 italic">
                        В очереди...
                      </div>
                    )}

                    {task.error && (
                      <div className="mt-1 text-[10px] text-red-400 line-clamp-2 bg-red-500/5 p-1 rounded">
                        {task.error}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
            
            {tasks.some(t => t.status === 'completed' || t.status === 'failed' || t.status === 'aborted') && (
              <div className="p-2 border-t border-slate-800 text-center">
                <button 
                  onClick={() => ipcSafe.invoke('clear-task-history')}
                  className="text-[10px] text-slate-500 hover:text-slate-300 uppercase font-bold tracking-widest"
                >
                  Очистить историю
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`p-4 rounded-full shadow-lg transition-all duration-300 flex items-center justify-center relative ${
          activeTasksCount > 0 
            ? 'bg-indigo-600 text-white scale-110' 
            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
        }`}
      >
        <Clock className={`w-6 h-6 ${activeTasksCount > 0 ? 'animate-pulse' : ''}`} />
        {activeTasksCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-slate-900">
            {activeTasksCount}
          </span>
        )}
      </button>
    </div>
  );
}
