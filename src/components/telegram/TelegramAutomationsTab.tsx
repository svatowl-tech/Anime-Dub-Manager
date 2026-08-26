import React, { useState } from 'react';
import { 
  Sparkles, 
  Zap, 
  Send, 
  Users, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  FileText, 
  Settings, 
  Layers, 
  RefreshCw,
  MessageSquare
} from 'lucide-react';
import { toast } from 'sonner';
import { ipcSafe } from '../../lib/ipcSafe';
import { Episode, Project, ProjectLinks, TelegramMTProtoDialog } from '../../types';

interface TelegramAutomationsTabProps {
  currentProject?: Project | null;
  currentEpisode?: Episode | null;
  allProjects?: Project[];
  dialogs: TelegramMTProtoDialog[];
  defaultChannelId: string;
}

export const TelegramAutomationsTab: React.FC<TelegramAutomationsTabProps> = ({
  currentProject,
  currentEpisode,
  allProjects,
  dialogs,
  defaultChannelId
}) => {
  const getParsedLinks = (): ProjectLinks => {
    if (!currentProject?.links) return {};
    if (typeof currentProject.links === 'object') return currentProject.links as ProjectLinks;
    try {
      return JSON.parse(currentProject.links);
    } catch {
      return {};
    }
  };

  const projectLinks = getParsedLinks();
  const [autoType, setAutoType] = useState<'start' | 'reminder' | 'fix' | 'track'>('start');
  const [targetChat, setTargetChat] = useState<string>(
    projectLinks.tgGroup || defaultChannelId || ''
  );
  
  const [selectedDubber, setSelectedDubber] = useState<string>('');
  const [deadlineText, setDeadlineText] = useState<string>('Сегодня в 20:00');
  const [sourceLink, setSourceLink] = useState<string>(projectLinks.anime365 || 'https://disk.yandex.ru/d/...');
  const [fixesText, setFixesText] = useState<string>('02:15 — Оговорка в реплике\n07:42 — Посторонний шум дыхания');
  const [trackStatus, setTrackStatus] = useState<string>('✅ Готово к сведению');
  
  const [isPin, setIsPin] = useState<boolean>(true);
  const [isSilent, setIsSilent] = useState<boolean>(false);
  const [isSending, setIsSending] = useState<boolean>(false);

  const epNum = currentEpisode?.number ? String(currentEpisode.number) : '1';
  const projectTitle = currentProject?.title || 'Название проекта';
  const dubbersList = currentProject?.assignedDubberIds && currentProject.assignedDubberIds.length > 0
    ? currentProject.assignedDubberIds.map(id => `• Дабер #${id.slice(-4)}`).join('\n')
    : '• @dubber1\n• @dubber2';

  const handleSendAutomation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetChat.trim()) {
      toast.error('Укажите чат или группу назначения');
      return;
    }

    setIsSending(true);
    try {
      const payload: Record<string, string> = {
        project_title: projectTitle,
        episode_number: epNum,
        dubbers_list: dubbersList,
        pending_dubbers: selectedDubber ? `@${selectedDubber}` : dubbersList,
        deadline: deadlineText,
        source_link: sourceLink,
        dubber_mention: selectedDubber ? `@${selectedDubber}` : 'Дабер',
        fixes_list: fixesText,
        dubber_name: selectedDubber || 'Дабер',
        track_status: trackStatus
      };

      const res = await ipcSafe.invoke('telegram-mtproto-send-automation', {
        type: autoType,
        targetPeer: targetChat.trim(),
        payload,
        pin: isPin,
        silent: isSilent
      });

      if (res && res.success) {
        toast.success('Оповещение успешно отправлено в рабочий Telegram-чат!');
      } else {
        throw new Error(res?.error || 'Ошибка отправки');
      }
    } catch (err: any) {
      toast.error(err.message || 'Ошибка отправки автоматизации');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-neutral-950">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Banner */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-lg flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-400" />
              Студийные автоматизации процессов озвучки
            </h2>
            <p className="text-xs text-neutral-400 mt-1">
              Автоматическая рассылка заданий, напоминаний по дедлайнам и списков правок напрямую в командные чаты
            </p>
          </div>
        </div>

        {/* Type Selector Tabs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => setAutoType('start')}
            className={`p-3.5 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between ${
              autoType === 'start'
                ? 'bg-sky-950/60 border-sky-600 text-white shadow-lg'
                : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:border-neutral-700'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <Sparkles className={`w-4 h-4 ${autoType === 'start' ? 'text-sky-400' : 'text-neutral-500'}`} />
              <span className="text-[10px] font-mono uppercase text-neutral-500">Notice</span>
            </div>
            <div className="text-xs font-bold text-neutral-200">Старт серии</div>
            <div className="text-[11px] text-neutral-400 mt-0.5">Оповещение о начале</div>
          </button>

          <button
            type="button"
            onClick={() => setAutoType('reminder')}
            className={`p-3.5 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between ${
              autoType === 'reminder'
                ? 'bg-amber-950/60 border-amber-600 text-white shadow-lg'
                : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:border-neutral-700'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <Clock className={`w-4 h-4 ${autoType === 'reminder' ? 'text-amber-400' : 'text-neutral-500'}`} />
              <span className="text-[10px] font-mono uppercase text-neutral-500">Alert</span>
            </div>
            <div className="text-xs font-bold text-neutral-200">Дедлайн</div>
            <div className="text-[11px] text-neutral-400 mt-0.5">Напоминание даберам</div>
          </button>

          <button
            type="button"
            onClick={() => setAutoType('fix')}
            className={`p-3.5 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between ${
              autoType === 'fix'
                ? 'bg-red-950/60 border-red-600 text-white shadow-lg'
                : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:border-neutral-700'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <AlertTriangle className={`w-4 h-4 ${autoType === 'fix' ? 'text-red-400' : 'text-neutral-500'}`} />
              <span className="text-[10px] font-mono uppercase text-neutral-500">Fixes</span>
            </div>
            <div className="text-xs font-bold text-neutral-200">Список правок</div>
            <div className="text-[11px] text-neutral-400 mt-0.5">Таймкоды для фиксов</div>
          </button>

          <button
            type="button"
            onClick={() => setAutoType('track')}
            className={`p-3.5 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between ${
              autoType === 'track'
                ? 'bg-emerald-950/60 border-emerald-600 text-white shadow-lg'
                : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:border-neutral-700'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <CheckCircle2 className={`w-4 h-4 ${autoType === 'track' ? 'text-emerald-400' : 'text-neutral-500'}`} />
              <span className="text-[10px] font-mono uppercase text-neutral-500">Status</span>
            </div>
            <div className="text-xs font-bold text-neutral-200">Дорожка сдана</div>
            <div className="text-[11px] text-neutral-400 mt-0.5">Уведомление в команду</div>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSendAutomation} className="space-y-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4">
            {/* Target Chat */}
            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
                Целевая рабочая беседа / Чат проекта
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={targetChat}
                  onChange={(e) => setTargetChat(e.target.value)}
                  placeholder="@akane_team_chat или ID супергруппы"
                  required
                  className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm text-white font-mono focus:border-sky-500 outline-none"
                />
                {dialogs.length > 0 && (
                  <select
                    onChange={(e) => {
                      if (e.target.value) setTargetChat(e.target.value);
                    }}
                    className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2.5 text-xs text-neutral-300 outline-none focus:border-sky-500 transition cursor-pointer max-w-[200px]"
                  >
                    <option value="">Выбрать из моих чатов...</option>
                    {dialogs.map((d) => (
                      <option key={d.id} value={d.username ? `@${d.username}` : d.id}>
                        {d.title} ({d.type})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* Dynamic Controls based on selected autoType */}
            {autoType === 'start' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1.5">Дедлайн сдачи</label>
                  <input
                    type="text"
                    value={deadlineText}
                    onChange={(e) => setDeadlineText(e.target.value)}
                    placeholder="Например: Завтра до 18:00"
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2 text-xs text-white focus:border-sky-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1.5">Ссылка на исходники / субтитры</label>
                  <input
                    type="text"
                    value={sourceLink}
                    onChange={(e) => setSourceLink(e.target.value)}
                    placeholder="https://..."
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2 text-xs text-white focus:border-sky-500 outline-none"
                  />
                </div>
              </div>
            )}

            {(autoType === 'reminder' || autoType === 'fix' || autoType === 'track') && (
              <div className="pt-2">
                <label className="block text-xs font-semibold text-neutral-300 mb-1.5">Дабер / Член команды</label>
                <input
                  type="text"
                  value={selectedDubber}
                  onChange={(e) => setSelectedDubber(e.target.value)}
                  placeholder="username_dabber"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2 text-xs text-white focus:border-sky-500 outline-none"
                />
              </div>
            )}

            {autoType === 'fix' && (
              <div className="pt-2">
                <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
                  Список таймкодов и правок
                </label>
                <textarea
                  value={fixesText}
                  onChange={(e) => setFixesText(e.target.value)}
                  rows={4}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3 text-xs text-white font-mono focus:border-red-500 outline-none resize-y"
                />
              </div>
            )}

            {/* Options */}
            <div className="flex items-center gap-4 pt-3 border-t border-neutral-800">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPin}
                  onChange={(e) => setIsPin(e.target.checked)}
                  className="rounded text-sky-600 focus:ring-sky-500"
                />
                <span className="text-xs text-neutral-300">Закрепить в беседе</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isSilent}
                  onChange={(e) => setIsSilent(e.target.checked)}
                  className="rounded text-sky-600 focus:ring-sky-500"
                />
                <span className="text-xs text-neutral-300">Без звукового уведомления</span>
              </label>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSending}
            className="w-full py-3.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold rounded-2xl text-sm transition shadow-xl flex items-center justify-center gap-2 cursor-pointer"
          >
            {isSending ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Отправка уведомления в чат...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Отправить автоматизацию в Telegram
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
