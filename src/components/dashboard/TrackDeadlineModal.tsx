import React, { useState, useEffect } from 'react';
import { X, Clock, Calendar, Check, Sparkles, User, AlertCircle, RotateCcw } from 'lucide-react';
import { Episode, Participant, RoleAssignment } from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';
import { formatDeadline, formatDeadlineRelative } from '../../lib/templates';
import { toast } from 'sonner';

interface TrackDeadlineModalProps {
  isOpen: boolean;
  onClose: () => void;
  episode: Episode;
  dubberId?: string;
  dubber?: Participant;
  characters: string[];
  assignmentIds: string[];
  currentDeadline?: string;
  onSave?: () => void;
}

export default function TrackDeadlineModal({
  isOpen,
  onClose,
  episode,
  dubberId,
  dubber,
  characters,
  assignmentIds,
  currentDeadline,
  onSave
}: TrackDeadlineModalProps) {
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

  // If there's an individual deadline, use it. Otherwise, defaults to episode deadline.
  const baselineEpisodeDeadline = episode.deadline;
  const initialValue = currentDeadline || baselineEpisodeDeadline;

  const [customDeadline, setCustomDeadline] = useState<string>(toLocalInputValue(initialValue));
  const [isIndividual, setIsIndividual] = useState<boolean>(Boolean(currentDeadline));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setCustomDeadline(toLocalInputValue(currentDeadline || baselineEpisodeDeadline));
      setIsIndividual(Boolean(currentDeadline));
      setIsSaving(false);
    }
  }, [isOpen, currentDeadline, baselineEpisodeDeadline]);

  if (!isOpen) return null;

  // Presets based on current deadline or now
  const addHours = (hoursToAdd: number) => {
    const baseDate = customDeadline ? new Date(customDeadline) : (baselineEpisodeDeadline ? new Date(baselineEpisodeDeadline) : new Date());
    baseDate.setHours(baseDate.getHours() + hoursToAdd);
    setCustomDeadline(toLocalInputValue(baseDate.toISOString()));
    setIsIndividual(true);
  };

  const addDays = (daysToAdd: number, hour: number = 20) => {
    const baseDate = customDeadline ? new Date(customDeadline) : (baselineEpisodeDeadline ? new Date(baselineEpisodeDeadline) : new Date());
    baseDate.setDate(baseDate.getDate() + daysToAdd);
    baseDate.setHours(hour, 0, 0, 0);
    setCustomDeadline(toLocalInputValue(baseDate.toISOString()));
    setIsIndividual(true);
  };

  const setNextWeekend = () => {
    const d = new Date();
    const day = d.getDay();
    const daysUntilSat = (6 - day + 7) % 7 || 7;
    d.setDate(d.getDate() + daysUntilSat);
    d.setHours(20, 0, 0, 0);
    setCustomDeadline(toLocalInputValue(d.toISOString()));
    setIsIndividual(true);
  };

  const resetToEpisodeDefault = () => {
    setCustomDeadline(toLocalInputValue(baselineEpisodeDeadline));
    setIsIndividual(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const finalIso = isIndividual && customDeadline ? new Date(customDeadline).toISOString() : null;

      // Update matching assignments
      const targetIds = new Set(assignmentIds);
      const updatedAssignments = (episode.assignments || []).map(as => {
        const asDubberId = as.substituteId || as.dubberId;
        const matchesDubber = dubberId && asDubberId === dubberId;
        const matchesId = targetIds.has(as.id);

        if (matchesId || matchesDubber) {
          return {
            ...as,
            deadline: finalIso ? finalIso : (null as any)
          };
        }
        return as;
      });

      const updatedEpisode: Episode = {
        ...episode,
        assignments: updatedAssignments,
        updatedAt: new Date().toISOString()
      };

      await ipcSafe.invoke('save-episode', updatedEpisode);
      toast.success(
        finalIso 
          ? `Индивидуальное время сдачи для ${dubber?.nickname || 'даббера'} сохранено!` 
          : `Время сдачи сброшено на общий дедлайн серии!`
      );
      onSave?.();
      onClose();
    } catch (err: any) {
      console.error('Failed to save track deadline:', err);
      toast.error('Не удалось сохранить время сдачи: ' + (err?.message || String(err)));
    } finally {
      setIsSaving(false);
    }
  };

  const rel = customDeadline ? formatDeadlineRelative(new Date(customDeadline).toISOString()) : null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden my-8 animate-in fade-in duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Время сдачи дорожки — {dubber?.nickname || 'Даббер'}
              </h2>
              <p className="text-xs text-neutral-400 truncate max-w-xs">
                Роли: {characters.join(', ') || 'Все роли'} • Серия #{episode.number}
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
          {/* Baseline info */}
          <div className="p-3 bg-neutral-950/40 rounded-xl border border-neutral-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-neutral-400">
              <Calendar className="w-4 h-4 text-neutral-500" />
              <span>Базовый дедлайн серии:</span>
            </div>
            <strong className="text-neutral-200 font-mono">
              {baselineEpisodeDeadline ? formatDeadline(baselineEpisodeDeadline) : 'не установлен'}
            </strong>
          </div>

          {/* Quick Extensions Presets */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Быстрое продление / отсрочка
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => addHours(6)}
                className="px-2.5 py-1.5 bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg text-xs font-medium border border-neutral-700/60 transition-colors cursor-pointer text-center truncate"
              >
                +6 часов
              </button>
              <button
                type="button"
                onClick={() => addHours(12)}
                className="px-2.5 py-1.5 bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg text-xs font-medium border border-neutral-700/60 transition-colors cursor-pointer text-center truncate"
              >
                +12 часов
              </button>
              <button
                type="button"
                onClick={() => addDays(1, 18)}
                className="px-2.5 py-1.5 bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg text-xs font-medium border border-neutral-700/60 transition-colors cursor-pointer text-center truncate"
              >
                +1 день (18:00)
              </button>
              <button
                type="button"
                onClick={() => addDays(2, 20)}
                className="px-2.5 py-1.5 bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg text-xs font-medium border border-neutral-700/60 transition-colors cursor-pointer text-center truncate"
              >
                +2 дня (20:00)
              </button>
              <button
                type="button"
                onClick={() => addDays(3, 20)}
                className="px-2.5 py-1.5 bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg text-xs font-medium border border-neutral-700/60 transition-colors cursor-pointer text-center truncate"
              >
                +3 дня
              </button>
              <button
                type="button"
                onClick={setNextWeekend}
                className="px-2.5 py-1.5 bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg text-xs font-medium border border-neutral-700/60 transition-colors cursor-pointer text-center truncate"
              >
                Суббота (20:00)
              </button>
            </div>
          </div>

          {/* Individual Deadline Input */}
          <div className="space-y-2 p-3.5 rounded-xl bg-neutral-950/60 border border-neutral-800">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-white flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-400" />
                Персональное время сдачи для {dubber?.nickname || 'даббера'}
              </label>
              {isIndividual && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  Индивидуально
                </span>
              )}
            </div>

            <input
              type="datetime-local"
              value={customDeadline}
              onChange={(e) => {
                setCustomDeadline(e.target.value);
                setIsIndividual(true);
              }}
              className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 font-mono transition-colors"
            />

            {customDeadline ? (
              <div className="flex items-center justify-between text-xs pt-1">
                <span className="text-neutral-400">
                  Срок: <strong className="text-neutral-200">{formatDeadline(new Date(customDeadline).toISOString())}</strong>
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
              <span className="text-xs text-neutral-500 italic">Срок сдачи не установлен</span>
            )}
          </div>

          {/* Bottom Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-neutral-800">
            <button
              type="button"
              onClick={resetToEpisodeDefault}
              className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition-colors cursor-pointer"
              title="Использовать базовый дедлайн всей серии"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Сбросить на дедлайн серии</span>
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
                className="px-5 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-amber-600/20 flex items-center gap-1.5 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>{isSaving ? 'Сохранение...' : 'Применить время'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
