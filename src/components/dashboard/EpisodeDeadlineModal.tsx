import React, { useState, useEffect } from 'react';
import { X, Calendar, Clock, Check, AlertCircle, RefreshCw, Sparkles, UserCheck } from 'lucide-react';
import { Episode } from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';
import { formatDeadline, formatFullDeadline, formatDeadlineRelative } from '../../lib/templates';
import { toast } from 'sonner';

interface EpisodeDeadlineModalProps {
  isOpen: boolean;
  onClose: () => void;
  episode: Episode;
  onSave?: () => void;
}

export default function EpisodeDeadlineModal({
  isOpen,
  onClose,
  episode,
  onSave
}: EpisodeDeadlineModalProps) {
  // ISO strings in local input format (YYYY-MM-DDTHH:mm)
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

  const [deadline, setDeadline] = useState<string>(toLocalInputValue(episode.deadline));
  const [fixesDeadline, setFixesDeadline] = useState<string>(toLocalInputValue(episode.fixesDeadline));
  const [syncPendingDubbers, setSyncPendingDubbers] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setDeadline(toLocalInputValue(episode.deadline));
      setFixesDeadline(toLocalInputValue(episode.fixesDeadline));
      setSyncPendingDubbers(true);
      setIsSaving(false);
    }
  }, [isOpen, episode]);

  if (!isOpen) return null;

  // Preset generators
  const applyPreset = (daysOffset: number, targetHour: number = 20, targetMinute: number = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + daysOffset);
    d.setHours(targetHour, targetMinute, 0, 0);
    setDeadline(toLocalInputValue(d.toISOString()));

    // Auto calculate fixes deadline (+24 hours after main deadline)
    const fixD = new Date(d);
    fixD.setDate(fixD.getDate() + 1);
    setFixesDeadline(toLocalInputValue(fixD.toISOString()));
  };

  const applyNextWeekend = () => {
    const d = new Date();
    const day = d.getDay(); // 0 is Sunday, 6 is Saturday
    const daysUntilSat = (6 - day + 7) % 7 || 7;
    d.setDate(d.getDate() + daysUntilSat);
    d.setHours(20, 0, 0, 0);
    setDeadline(toLocalInputValue(d.toISOString()));

    const fixD = new Date(d);
    fixD.setDate(fixD.getDate() + 1);
    fixD.setHours(20, 0, 0, 0);
    setFixesDeadline(toLocalInputValue(fixD.toISOString()));
  };

  const applyEndOfWeek = () => {
    const d = new Date();
    const day = d.getDay();
    const daysUntilSun = (7 - day) % 7 || 7;
    d.setDate(d.getDate() + daysUntilSun);
    d.setHours(23, 59, 0, 0);
    setDeadline(toLocalInputValue(d.toISOString()));

    const fixD = new Date(d);
    fixD.setDate(fixD.getDate() + 1);
    fixD.setHours(20, 0, 0, 0);
    setFixesDeadline(toLocalInputValue(fixD.toISOString()));
  };

  const clearDeadlines = () => {
    setDeadline('');
    setFixesDeadline('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const finalDeadlineIso = deadline ? new Date(deadline).toISOString() : null;
      const finalFixesIso = fixesDeadline ? new Date(fixesDeadline).toISOString() : null;

      // Optionally sync with pending role assignments
      let updatedAssignments = episode.assignments ? [...episode.assignments] : [];
      if (syncPendingDubbers && finalDeadlineIso && updatedAssignments.length > 0) {
        updatedAssignments = updatedAssignments.map(as => {
          // If dubber has not submitted audio yet, update their custom deadline to match
          if (as.status === 'PENDING' || as.status === 'FIXES_NEEDED') {
            return {
              ...as,
              deadline: as.status === 'FIXES_NEEDED' && finalFixesIso ? finalFixesIso : finalDeadlineIso
            };
          }
          return as;
        });
      }

      const updatedEpisode: Episode = {
        ...episode,
        deadline: finalDeadlineIso ? finalDeadlineIso : (null as any),
        fixesDeadline: finalFixesIso ? finalFixesIso : (null as any),
        assignments: updatedAssignments,
        updatedAt: new Date().toISOString()
      };

      await ipcSafe.invoke('save-episode', updatedEpisode);
      toast.success(`Дедлайн серии #${episode.number} успешно обновлен!`);
      onSave?.();
      onClose();
    } catch (err: any) {
      console.error('Failed to save episode deadline:', err);
      toast.error('Не удалось сохранить дедлайн серии: ' + (err?.message || String(err)));
    } finally {
      setIsSaving(false);
    }
  };

  const mainRel = deadline ? formatDeadlineRelative(new Date(deadline).toISOString()) : null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden my-8 animate-in fade-in duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Сроки сдачи — Серия #{episode.number}
              </h2>
              <p className="text-xs text-neutral-400">
                Ручная настройка дедлайнов для дабберов и правок
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
          {/* Quick Preset Buttons */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Быстрые пресеты
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => applyPreset(0, 20, 0)}
                className="px-2.5 py-1.5 bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg text-xs font-medium border border-neutral-700/60 transition-colors cursor-pointer text-center truncate"
              >
                Сегодня в 20:00
              </button>
              <button
                type="button"
                onClick={() => applyPreset(1, 18, 0)}
                className="px-2.5 py-1.5 bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg text-xs font-medium border border-neutral-700/60 transition-colors cursor-pointer text-center truncate"
              >
                Завтра в 18:00
              </button>
              <button
                type="button"
                onClick={() => applyPreset(2, 20, 0)}
                className="px-2.5 py-1.5 bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg text-xs font-medium border border-neutral-700/60 transition-colors cursor-pointer text-center truncate"
              >
                +2 дня (20:00)
              </button>
              <button
                type="button"
                onClick={() => applyPreset(3, 20, 0)}
                className="px-2.5 py-1.5 bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg text-xs font-medium border border-neutral-700/60 transition-colors cursor-pointer text-center truncate"
              >
                +3 дня
              </button>
              <button
                type="button"
                onClick={applyNextWeekend}
                className="px-2.5 py-1.5 bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg text-xs font-medium border border-neutral-700/60 transition-colors cursor-pointer text-center truncate"
              >
                Суббота (20:00)
              </button>
              <button
                type="button"
                onClick={applyEndOfWeek}
                className="px-2.5 py-1.5 bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg text-xs font-medium border border-neutral-700/60 transition-colors cursor-pointer text-center truncate"
              >
                Конец недели (Вс)
              </button>
            </div>
          </div>

          {/* Main Deadline */}
          <div className="space-y-2 p-3.5 rounded-xl bg-neutral-950/60 border border-neutral-800">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-white flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-red-400" />
                Основной дедлайн сдачи дорожек
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
              className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-500 font-mono transition-colors"
            />

            {deadline ? (
              <div className="flex items-center justify-between text-xs pt-1">
                <span className="text-neutral-400">
                  Формат: <strong className="text-neutral-200">{formatDeadline(new Date(deadline).toISOString())}</strong>
                </span>
                {mainRel && (
                  <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                    mainRel.isOverdue 
                      ? 'bg-red-500/10 text-red-400 border border-red-500/20' 
                      : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  }`}>
                    {mainRel.text}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-xs text-neutral-500 italic">Срок сдачи не установлен</span>
            )}
          </div>

          {/* Fixes Deadline */}
          <div className="space-y-2 p-3.5 rounded-xl bg-neutral-950/60 border border-neutral-800">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-white flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
                Дедлайн сдачи правок и фиксов
              </label>
              <div className="flex items-center gap-2">
                {deadline && (
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date(deadline);
                      d.setDate(d.getDate() + 1);
                      setFixesDeadline(toLocalInputValue(d.toISOString()));
                    }}
                    className="text-[11px] text-amber-400 hover:text-amber-300 font-medium transition-colors"
                  >
                    +24ч к сдаче
                  </button>
                )}
                {fixesDeadline && (
                  <button
                    type="button"
                    onClick={() => setFixesDeadline('')}
                    className="text-[11px] text-neutral-500 hover:text-red-400 transition-colors"
                  >
                    Очистить
                  </button>
                )}
              </div>
            </div>

            <input
              type="datetime-local"
              value={fixesDeadline}
              onChange={(e) => setFixesDeadline(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 font-mono transition-colors"
            />
            {fixesDeadline ? (
              <div className="text-xs text-neutral-400 pt-0.5">
                Правки до: <strong className="text-neutral-200">{formatDeadline(new Date(fixesDeadline).toISOString())}</strong>
              </div>
            ) : (
              <span className="text-xs text-neutral-500 italic">По умолчанию: +24 часа после основного дедлайна</span>
            )}
          </div>

          {/* Sync with pending assignments checkbox */}
          <div className="flex items-start gap-2.5 pt-1">
            <input
              type="checkbox"
              id="syncPendingDubbers"
              checked={syncPendingDubbers}
              onChange={(e) => setSyncPendingDubbers(e.target.checked)}
              className="mt-1 rounded bg-neutral-800 border-neutral-700 text-blue-500 focus:ring-0 cursor-pointer"
            />
            <label htmlFor="syncPendingDubbers" className="text-xs text-neutral-300 leading-relaxed cursor-pointer">
              <span className="font-semibold text-white">Применить дедлайн к несданным дорожкам дабберов</span>
              <p className="text-[11px] text-neutral-500 mt-0.5">
                Автоматически синхронизирует персональные сроки сдачи для всех ролей в этой серии, у которых еще нет готовой записи.
              </p>
            </label>
          </div>

          {/* Bottom Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-neutral-800">
            <button
              type="button"
              onClick={clearDeadlines}
              className="px-3 py-2 text-xs text-neutral-400 hover:text-red-400 transition-colors cursor-pointer"
            >
              Сбросить все сроки
            </button>
            <div className="flex items-center gap-2">
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
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-blue-600/20 flex items-center gap-1.5 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>{isSaving ? 'Сохранение...' : 'Сохранить дедлайн'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
