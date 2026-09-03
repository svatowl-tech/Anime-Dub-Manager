import React, { useState } from 'react';
import { 
  Settings, 
  Key, 
  Smartphone, 
  Hash, 
  Save, 
  LogOut, 
  CheckCircle2, 
  RefreshCw, 
  Sparkles, 
  ShieldCheck, 
  AlertTriangle 
} from 'lucide-react';
import { toast } from 'sonner';
import { ipcSafe } from '../../lib/ipcSafe';
import { TelegramMTProtoSettings, TelegramMTProtoStatus } from '../../types';

interface TelegramSettingsTabProps {
  status: TelegramMTProtoStatus | null;
  onRefreshStatus: () => Promise<void>;
}

export const TelegramSettingsTab: React.FC<TelegramSettingsTabProps> = ({
  status,
  onRefreshStatus
}) => {
  const currentSettings = status?.settings || ({} as TelegramMTProtoSettings);

  const [apiId, setApiId] = useState<string>(String(currentSettings.apiId || ''));
  const [apiHash, setApiHash] = useState<string>(currentSettings.apiHash || '');
  const [defaultChannelId, setDefaultChannelId] = useState<string>(currentSettings.defaultChannelId || '');
  const [headerTemplate, setHeaderTemplate] = useState<string>(
    currentSettings.headerTemplate || '✨ <b>{title_ru}</b> [{episode_number} СЕРИЯ]'
  );
  const [footerTemplate, setFooterTemplate] = useState<string>(
    currentSettings.footerTemplate || '📌 Смотреть: {site_link}\n💬 Обсуждение: {tg_group}'
  );
  const [startNoticeTemplate, setStartNoticeTemplate] = useState<string>(
    currentSettings.startNoticeTemplate || '🎬 <b>СТАРТ РАБОТЫ НАД СЕРИЕЙ!</b>\n📌 <b>{project_title}</b> — Серия {episode_number}\n\n👥 <b>Состав команды:</b>\n{dubbers_list}\n\n📅 <b>ДЕДЛАЙН:</b> {deadline}\n🔗 <b>Материалы:</b> {source_link}'
  );
  const [reminderTemplate, setReminderTemplate] = useState<string>(
    currentSettings.reminderTemplate || '⏰ <b>НАПОМИНАНИЕ О ДЕДЛАЙНЕ!</b>\nРелиз: <b>{project_title}</b> (Серия {episode_number})\n\nКоллеги, ожидаем ваши дорожки:\n{pending_dubbers}\n\nПросьба дописать как можно скорее! 🙏'
  );
  const [fixNoticeTemplate, setFixNoticeTemplate] = useState<string>(
    currentSettings.fixNoticeTemplate || '⚠️ <b>СПИСОК ФИКСОВ / ПРАВОК</b>\nКому: {dubber_mention}\nПроект: <b>{project_title}</b> (Серия {episode_number})\n\n{fixes_list}'
  );
  const [trackReceivedTemplate, setTrackReceivedTemplate] = useState<string>(
    currentSettings.trackReceivedTemplate || '🎙️ <b>ДОРОЖКА ПРИНЯТА!</b>\nДабер: {dubber_name}\nСерия: {episode_number}\nСтатус: ✅ Готово к сведению'
  );
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isLoggingOut, setIsLoggingOut] = useState<boolean>(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await ipcSafe.invoke('telegram-mtproto-save-settings', {
        apiId: apiId ? Number(apiId) : undefined,
        apiHash: apiHash.trim(),
        defaultChannelId: defaultChannelId.trim(),
        headerTemplate,
        footerTemplate,
        startNoticeTemplate,
        reminderTemplate,
        fixNoticeTemplate,
        trackReceivedTemplate
      });
      await onRefreshStatus();
      toast.success('Настройки Telegram MTProto успешно сохранены');
    } catch (err: any) {
      toast.error(err.message || 'Ошибка сохранения настроек');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    if (!confirm('Вы действительно хотите выйти из текущего аккаунта Telegram MTProto?')) return;
    setIsLoggingOut(true);
    try {
      await ipcSafe.invoke('telegram-mtproto-logout');
      await onRefreshStatus();
      toast.success('Сессия Telegram успешно завершена');
    } catch (err: any) {
      toast.error(err.message || 'Ошибка при выходе из аккаунта');
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-neutral-950">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Active Account Banner */}
        {status?.status === 'connected' && (
          <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-2xl p-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold">
                {status.me?.firstName ? status.me.firstName.charAt(0) : 'TG'}
              </div>
              <div>
                <div className="text-xs font-bold text-white flex items-center gap-2">
                  <span>{status.me?.firstName} {status.me?.lastName}</span>
                  <span className="text-emerald-400 font-mono text-[11px]">
                    {status.me?.username ? `@${status.me.username}` : ''}
                  </span>
                </div>
                <div className="text-[11px] text-emerald-300 mt-0.5">
                  MTProto сессия активна • {status.me?.phone || ''}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="px-3.5 py-2 bg-red-950 hover:bg-red-900 text-red-300 hover:text-red-100 rounded-xl text-xs font-semibold border border-red-800/60 transition flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Выйти из аккаунта
            </button>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-6">
          {/* Section 1: API Keys */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-xs font-bold uppercase text-neutral-400 tracking-wider flex items-center gap-2">
              <Key className="w-3.5 h-3.5 text-sky-400" />
              Ключи приложения Telegram API
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1.5">API ID</label>
                <input
                  type="text"
                  value={apiId}
                  onChange={(e) => setApiId(e.target.value)}
                  placeholder="24512345"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2 text-xs text-white font-mono focus:border-sky-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1.5">API Hash</label>
                <input
                  type="password"
                  value={apiHash}
                  onChange={(e) => setApiHash(e.target.value)}
                  placeholder="32-значный хэш"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2 text-xs text-white font-mono focus:border-sky-500 outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1.5">Канал по умолчанию (@channel или ID)</label>
              <input
                type="text"
                value={defaultChannelId}
                onChange={(e) => setDefaultChannelId(e.target.value)}
                placeholder="@my_release_channel"
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2 text-xs text-white font-mono focus:border-sky-500 outline-none"
              />
            </div>
          </div>

          {/* Section 2: Release Templates */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-xs font-bold uppercase text-neutral-400 tracking-wider flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Шаблоны релизных постов
            </h3>

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">
                Шапка релиза (Header)
              </label>
              <input
                type="text"
                value={headerTemplate}
                onChange={(e) => setHeaderTemplate(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2 text-xs text-white font-mono focus:border-sky-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">
                Подвал релиза (Footer)
              </label>
              <textarea
                value={footerTemplate}
                onChange={(e) => setFooterTemplate(e.target.value)}
                rows={2}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3 text-xs text-white font-mono focus:border-sky-500 outline-none resize-y"
              />
            </div>
          </div>

          {/* Section 3: Studio Automation Templates */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-xs font-bold uppercase text-neutral-400 tracking-wider flex items-center gap-2">
              <Settings className="w-3.5 h-3.5 text-emerald-400" />
              Шаблоны командных автоматизаций
            </h3>

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">
                Шаблон старта работы над серией (Start Notice)
              </label>
              <textarea
                value={startNoticeTemplate}
                onChange={(e) => setStartNoticeTemplate(e.target.value)}
                rows={4}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3 text-xs text-white font-mono focus:border-sky-500 outline-none resize-y"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">
                Шаблон напоминания о дедлайне (Reminder)
              </label>
              <textarea
                value={reminderTemplate}
                onChange={(e) => setReminderTemplate(e.target.value)}
                rows={4}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3 text-xs text-white font-mono focus:border-sky-500 outline-none resize-y"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">
                Шаблон списка правок (Fix Notice)
              </label>
              <textarea
                value={fixNoticeTemplate}
                onChange={(e) => setFixNoticeTemplate(e.target.value)}
                rows={3}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3 text-xs text-white font-mono focus:border-sky-500 outline-none resize-y"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">
                Шаблон принятия дорожки (Track Received)
              </label>
              <textarea
                value={trackReceivedTemplate}
                onChange={(e) => setTrackReceivedTemplate(e.target.value)}
                rows={3}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3 text-xs text-white font-mono focus:border-sky-500 outline-none resize-y"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSaving}
            className="w-full py-3.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold rounded-2xl text-sm transition shadow-xl flex items-center justify-center gap-2 cursor-pointer"
          >
            {isSaving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Сохранение...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Сохранить настройки
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
