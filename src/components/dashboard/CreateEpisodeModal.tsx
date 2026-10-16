import React, { useState, useEffect } from 'react';
import { X, Plus, Loader2, Calendar, Clock, RotateCcw } from 'lucide-react';
import { Project } from '../../types';
import { calculateDeadline, getDefaultDaysForProject, getDefaultHourForProject } from '../../lib/dateUtils';
import { formatDeadline } from '../../lib/templates';

interface CreateEpisodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (episodeNumber: number, title?: string, deadline?: string) => Promise<void> | void;
  defaultEpisodeNumber: number;
  project?: Project | null;
}

export default function CreateEpisodeModal({ isOpen, onClose, onCreate, defaultEpisodeNumber, project }: CreateEpisodeModalProps) {
  const [episodeNumber, setEpisodeNumber] = useState(defaultEpisodeNumber);
  const [episodeTitle, setEpisodeTitle] = useState('');
  const [deadline, setDeadline] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toLocalInputValue = (isoStr?: string) => {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return '';
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return '';
    }
  };

  useEffect(() => {
    if (isOpen) {
      setEpisodeNumber(defaultEpisodeNumber);
      setEpisodeTitle('');
      if (project) {
        setDeadline(toLocalInputValue(calculateDeadline(project)));
      } else {
        const d = new Date();
        d.setDate(d.getDate() + 7);
        d.setHours(20, 0, 0, 0);
        setDeadline(toLocalInputValue(d.toISOString()));
      }
      setIsSubmitting(false);
    }
  }, [isOpen, defaultEpisodeNumber, project]);

  if (!isOpen) return null;

  const resetToProjectStandard = () => {
    if (project) {
      setDeadline(toLocalInputValue(calculateDeadline(project)));
    }
  };

  const addDays = (days: number) => {
    const base = deadline ? new Date(deadline) : new Date();
    base.setDate(base.getDate() + days);
    setDeadline(toLocalInputValue(base.toISOString()));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isNaN(episodeNumber) || episodeNumber < 1) return;
    setIsSubmitting(true);
    try {
      const finalDeadlineIso = deadline ? new Date(deadline).toISOString() : undefined;
      await onCreate(episodeNumber, episodeTitle.trim() || undefined, finalDeadlineIso);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-600/20 text-blue-400 rounded-lg">
              <Plus className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-semibold text-white">Добавить серию</h2>
          </div>
          <button 
            type="button"
            onClick={onClose} 
            disabled={isSubmitting} 
            className="text-neutral-400 hover:text-white disabled:opacity-50 p-1 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-2">Номер серии</label>
            <input 
              type="number" 
              value={episodeNumber || ''} 
              onChange={(e) => setEpisodeNumber(parseInt(e.target.value) || 0)}
              disabled={isSubmitting}
              className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50 transition-all font-mono"
              min="1"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-2">
              Название серии <span className="text-neutral-500 text-xs font-normal">(опционально)</span>
            </label>
            <input 
              type="text" 
              value={episodeTitle} 
              onChange={(e) => setEpisodeTitle(e.target.value)}
              disabled={isSubmitting}
              placeholder="Напр.: Возвращение героя"
              className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50 transition-all text-sm"
            />
            <p className="text-xs text-neutral-500 mt-1.5">
              Если оставить пустым, система попытается автоматически определить название или оставить стандартный номер.
            </p>
          </div>

          {/* Deadline Field */}
          <div className="p-3.5 bg-neutral-950/60 rounded-xl border border-neutral-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-neutral-300 flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-amber-400" /> Дедлайн сдачи серии
              </label>
              {project && (
                <button
                  type="button"
                  onClick={resetToProjectStandard}
                  className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-1 transition-colors cursor-pointer"
                  title="Вернуть стандартный расчет дедлайна проекта"
                >
                  <RotateCcw className="w-3 h-3" />
                  По стандарту проекта ({getDefaultDaysForProject(project)} дн.)
                </button>
              )}
            </div>

            <input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              disabled={isSubmitting}
              className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 font-mono"
            />

            <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5">
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => addDays(1)}
                  disabled={isSubmitting}
                  className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-[11px] font-medium transition-colors cursor-pointer"
                >
                  +1 день
                </button>
                <button
                  type="button"
                  onClick={() => addDays(2)}
                  disabled={isSubmitting}
                  className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-[11px] font-medium transition-colors cursor-pointer"
                >
                  +2 дня
                </button>
                <button
                  type="button"
                  onClick={() => addDays(3)}
                  disabled={isSubmitting}
                  className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-[11px] font-medium transition-colors cursor-pointer"
                >
                  +3 дня
                </button>
                <button
                  type="button"
                  onClick={() => setDeadline('')}
                  disabled={isSubmitting}
                  className="px-2 py-0.5 bg-neutral-800 hover:bg-red-500/20 text-neutral-400 hover:text-red-400 rounded text-[11px] font-medium transition-colors cursor-pointer"
                >
                  Без срока
                </button>
              </div>

              {deadline && (
                <span className="text-[11px] text-neutral-400">
                  <strong className="text-amber-300">{formatDeadline(new Date(deadline).toISOString())}</strong>
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button 
              type="button" 
              onClick={onClose} 
              disabled={isSubmitting}
              className="flex-1 py-2.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-neutral-300 rounded-lg font-medium transition-colors cursor-pointer"
            >
              Отмена
            </button>
            <button 
              type="submit" 
              disabled={isSubmitting || !episodeNumber || episodeNumber < 1}
              className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-blue-600/20"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Создание...</span>
                </>
              ) : (
                <span>Добавить</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
