import React, { useState, useEffect } from 'react';
import { X, Calendar, Clock, Check, Sparkles, Folder } from 'lucide-react';
import { Project } from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';
import { formatDeadline, formatDeadlineRelative } from '../../lib/templates';
import { toast } from 'sonner';

interface ProjectDeadlineModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
  onSave?: () => void;
}

export default function ProjectDeadlineModal({
  isOpen,
  onClose,
  project,
  onSave
}: ProjectDeadlineModalProps) {
  const toLocalInputValue = (isoStr?: string) => {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return '';
      const pad = (n: number) => n.toString().padStart(2, '0');
      const year = d.getFullYear();
      const month = pad(d.getMonth() + 1);
      const day = pad(d.getDate());
      const hours = pad(d.getHours());
      const mins = pad(d.getMinutes());
      return `${year}-${month}-${day}T${hours}:${mins}`;
    } catch {
      return '';
    }
  };

  const [deadline, setDeadline] = useState<string>(toLocalInputValue(project.deadline));
  const fallbackDays = project.defaultEpisodeDeadlineDays || (project.isOngoing ? (project.releaseType === 'VOICEOVER' ? 2 : 3) : 7);
  const [defaultEpisodeDeadlineDays, setDefaultEpisodeDeadlineDays] = useState<number>(fallbackDays);
  const [defaultEpisodeDeadlineHour, setDefaultEpisodeDeadlineHour] = useState<number>(
    typeof project.defaultEpisodeDeadlineHour === 'number' ? project.defaultEpisodeDeadlineHour : 20
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setDeadline(toLocalInputValue(project.deadline));
      const days = project.defaultEpisodeDeadlineDays || (project.isOngoing ? (project.releaseType === 'VOICEOVER' ? 2 : 3) : 7);
      setDefaultEpisodeDeadlineDays(days);
      setDefaultEpisodeDeadlineHour(typeof project.defaultEpisodeDeadlineHour === 'number' ? project.defaultEpisodeDeadlineHour : 20);
      setIsSaving(false);
    }
  }, [isOpen, project]);

  if (!isOpen) return null;

  const applyPreset = (daysOffset: number, targetHour: number = 20, targetMinute: number = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + daysOffset);
    d.setHours(targetHour, targetMinute, 0, 0);
    setDeadline(toLocalInputValue(d.toISOString()));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const finalDeadlineIso = deadline ? new Date(deadline).toISOString() : null;

      const updatedProject: Project = {
        ...project,
        deadline: finalDeadlineIso ? finalDeadlineIso : (null as any),
        defaultEpisodeDeadlineDays: Math.max(1, Number(defaultEpisodeDeadlineDays) || 7),
        defaultEpisodeDeadlineHour: Math.max(0, Math.min(23, Number(defaultEpisodeDeadlineHour) || 20)),
        updatedAt: new Date().toISOString()
      };

      await ipcSafe.invoke('save-project', updatedProject);
      toast.success(`Дедлайны проекта "${project.title}" сохранены!`);
      onSave?.();
      onClose();
    } catch (err: any) {
      console.error('Failed to save project deadline:', err);
      toast.error('Не удалось сохранить дедлайн проекта: ' + (err?.message || String(err)));
    } finally {
      setIsSaving(false);
    }
  };

  const rel = deadline ? formatDeadlineRelative(new Date(deadline).toISOString()) : null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden my-8 animate-in fade-in duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Folder className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Общий дедлайн проекта
              </h2>
              <p className="text-xs text-neutral-400 truncate max-w-xs">
                {project.title}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-6">
          {/* Quick Presets */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" /> Быстрый выбор
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => applyPreset(7, 20, 0)}
                className="px-2.5 py-1.5 bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg text-xs font-medium border border-neutral-700/60 transition-colors cursor-pointer text-center truncate"
              >
                +1 неделя
              </button>
              <button
                type="button"
                onClick={() => applyPreset(14, 20, 0)}
                className="px-2.5 py-1.5 bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg text-xs font-medium border border-neutral-700/60 transition-colors cursor-pointer text-center truncate"
              >
                +2 недели
              </button>
              <button
                type="button"
                onClick={() => applyPreset(30, 20, 0)}
                className="px-2.5 py-1.5 bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg text-xs font-medium border border-neutral-700/60 transition-colors cursor-pointer text-center truncate"
              >
                +1 месяц
              </button>
              <button
                type="button"
                onClick={() => applyPreset(60, 20, 0)}
                className="px-2.5 py-1.5 bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg text-xs font-medium border border-neutral-700/60 transition-colors cursor-pointer text-center truncate"
              >
                +2 месяца
              </button>
              <button
                type="button"
                onClick={() => applyPreset(90, 20, 0)}
                className="px-2.5 py-1.5 bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg text-xs font-medium border border-neutral-700/60 transition-colors cursor-pointer text-center truncate"
              >
                Конец сезона (3 мес)
              </button>
              <button
                type="button"
                onClick={() => setDeadline('')}
                className="px-2.5 py-1.5 bg-neutral-800/80 hover:bg-red-500/20 text-neutral-400 hover:text-red-400 rounded-lg text-xs font-medium border border-neutral-700/60 transition-colors cursor-pointer text-center truncate"
              >
                Без дедлайна
              </button>
            </div>
          </div>

          {/* Project Deadline Input */}
          <div className="space-y-2 p-3.5 rounded-xl bg-neutral-950/60 border border-neutral-800">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-white flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-indigo-400" />
                Целевая дата и время сдачи релиза / сезона
              </label>
              {deadline && (
                <button
                  type="button"
                  onClick={() => setDeadline('')}
                  className="text-[11px] text-neutral-500 hover:text-red-400 transition-colors"
                >
                  Очистить
                </button>
              )}
            </div>
            
            <input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 font-mono transition-colors"
            />

            {deadline ? (
              <div className="flex items-center justify-between text-xs pt-1">
                <span className="text-neutral-400">
                  Формат: <strong className="text-neutral-200">{formatDeadline(new Date(deadline).toISOString())}</strong>
                </span>
                {rel && (
                  <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                    rel.isOverdue 
                      ? 'bg-red-500/10 text-red-400 border border-red-500/20' 
                      : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  }`}>
                    {rel.text}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-xs text-neutral-500 italic">Срок сдачи всего проекта не установлен</span>
            )}
          </div>

          {/* Standard Episode Deadline for this Project */}
          <div className="space-y-3 p-3.5 rounded-xl bg-amber-950/20 border border-amber-500/30">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-400" />
                Стандартный дедлайн для серий в этом проекте
              </label>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                {defaultEpisodeDeadlineDays} {defaultEpisodeDeadlineDays === 1 ? 'день' : defaultEpisodeDeadlineDays < 5 ? 'дня' : 'дней'} к {defaultEpisodeDeadlineHour}:00
              </span>
            </div>

            <p className="text-xs text-neutral-400">
              Каждая новая серия в этом проекте автоматически получит дедлайн через указанное число дней.
            </p>

            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4, 5, 7, 10, 14].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDefaultEpisodeDeadlineDays(d)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer border ${
                    defaultEpisodeDeadlineDays === d
                      ? 'bg-amber-600 text-white border-amber-500 shadow-sm'
                      : 'bg-neutral-800 text-neutral-300 border-neutral-700 hover:bg-neutral-700'
                  }`}
                >
                  {d} {d === 1 ? 'день' : d < 5 ? 'дня' : 'дней'}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-[11px] text-neutral-400 font-medium mb-1">
                  Точное число дней:
                </label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={defaultEpisodeDeadlineDays}
                  onChange={(e) => setDefaultEpisodeDeadlineDays(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] text-neutral-400 font-medium mb-1">
                  Время сдачи по умолчанию:
                </label>
                <select
                  value={defaultEpisodeDeadlineHour}
                  onChange={(e) => setDefaultEpisodeDeadlineHour(parseInt(e.target.value))}
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500"
                >
                  <option value={12}>12:00</option>
                  <option value={15}>15:00</option>
                  <option value={18}>18:00</option>
                  <option value={20}>20:00 (Стандарт)</option>
                  <option value={21}>21:00</option>
                  <option value={22}>22:00</option>
                  <option value={23}>23:59</option>
                </select>
              </div>
            </div>

            <div className="text-[11px] text-neutral-400 bg-neutral-950/60 p-2 rounded-lg border border-neutral-800 flex items-center justify-between">
              <span>Серия, созданная сегодня, получит дедлайн:</span>
              <strong className="text-amber-400 font-mono">
                {(() => {
                  const d = new Date();
                  d.setDate(d.getDate() + (defaultEpisodeDeadlineDays || 2));
                  d.setHours(defaultEpisodeDeadlineHour, 0, 0, 0);
                  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
                })()}
              </strong>
            </div>
          </div>

          {/* Bottom Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-indigo-600/20 flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>{isSaving ? 'Сохранение...' : 'Сохранить дедлайн проекта'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
