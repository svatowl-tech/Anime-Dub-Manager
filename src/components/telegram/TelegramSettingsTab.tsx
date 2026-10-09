import React, { useState, useEffect, useRef } from 'react';
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
  AlertTriangle,
  Bot,
  LogIn,
  Copy,
  Check,
  Terminal,
  Activity,
  Trash2,
  Radio,
  Zap,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { toast } from 'sonner';
import { safeCopyToClipboard } from '../../lib/clipboard';
import { ipcSafe } from '../../lib/ipcSafe';
import { TelegramMTProtoSettings, TelegramMTProtoStatus } from '../../types';

interface TelegramLogEntry {
  timestamp: string;
  time: string;
  level: 'info' | 'warn' | 'error';
  tag: string;
  message: string;
  details?: any;
}

interface TelegramSettingsTabProps {
  status: TelegramMTProtoStatus | null;
  onRefreshStatus: () => Promise<void>;
  onOpenAuth?: () => void;
}

export const TelegramSettingsTab: React.FC<TelegramSettingsTabProps> = ({
  status,
  onRefreshStatus,
  onOpenAuth
}) => {
  const currentSettings = status?.settings || ({} as TelegramMTProtoSettings);

  const [apiId, setApiId] = useState<string>(String(currentSettings.apiId || ''));
  const [apiHash, setApiHash] = useState<string>(currentSettings.apiHash || '');
  const [botToken, setBotToken] = useState<string>(currentSettings.botToken || '');
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
  const [isTestingBot, setIsTestingBot] = useState<boolean>(false);
  const [botVerified, setBotVerified] = useState<string>(
    status?.botMe?.username ? `@${status.botMe.username}` : ''
  );
  const [copiedTag, setCopiedTag] = useState<string | null>(null);

  // Diagnostics & Logs State
  const [logs, setLogs] = useState<TelegramLogEntry[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState<boolean>(false);
  const [autoRefreshLogs, setAutoRefreshLogs] = useState<boolean>(true);
  const [logFilter, setLogFilter] = useState<'all' | 'error' | 'auth' | 'qr' | 'search'>('all');
  const [isTestingConnection, setIsTestingConnection] = useState<boolean>(false);
  const [connectionTestResult, setConnectionTestResult] = useState<any>(null);
  const [isLogsExpanded, setIsLogsExpanded] = useState<boolean>(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const lastLogsSignatureRef = useRef<string>('');

  const fetchLogs = async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const res = await ipcSafe.invoke('telegram-mtproto-get-logs', { limit: 100 });
      if (Array.isArray(res)) {
        const latestItem = res[res.length - 1];
        const signature = `${res.length}_${latestItem?.time || ''}_${latestItem?.message || ''}`;
        if (signature !== lastLogsSignatureRef.current) {
          lastLogsSignatureRef.current = signature;
          setLogs(res);
        }
      }
    } catch (e) {
      console.warn('Could not fetch MTProto logs:', e);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  useEffect(() => {
    let interval: any;
    if (autoRefreshLogs && isLogsExpanded) {
      interval = setInterval(fetchLogs, 3500);
    }
    return () => clearInterval(interval);
  }, [autoRefreshLogs, isLogsExpanded]);

  const handleClearLogs = async () => {
    try {
      await ipcSafe.invoke('telegram-mtproto-clear-logs');
      setLogs([]);
      toast.success('Журнал логов MTProto очищен');
    } catch (err: any) {
      toast.error('Не удалось очистить логи');
    }
  };

  const handleCopyLogs = async () => {
    const text = logs.map(l => `[${l.time}] [${l.level.toUpperCase()}] [${l.tag}] ${l.message} ${l.details ? JSON.stringify(l.details) : ''}`).join('\n');
    await safeCopyToClipboard(text);
    toast.success('Журнал процессов скопирован в буфер обмена');
  };

  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    setConnectionTestResult(null);
    try {
      const res = await ipcSafe.invoke('telegram-mtproto-test-connection');
      setConnectionTestResult(res);
      if (res && res.success && res.connected) {
        toast.success(`Связь с Telegram установлена! Пинг: ${res.latencyMs}мс (DC ${res.dcId || '2/4'})`);
        await onRefreshStatus();
      } else {
        toast.error(`Проверка связи: ${res?.error || 'Нет соединения'}`);
      }
      await fetchLogs();
    } catch (err: any) {
      toast.error(`Ошибка проверки: ${err.message || String(err)}`);
      setConnectionTestResult({ success: false, connected: false, error: err.message });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleTestBot = async () => {
    if (!botToken.trim()) {
      toast.error('Введите Bot Token для проверки');
      return;
    }

    setIsTestingBot(true);
    try {
      const res = await ipcSafe.invoke('telegram-bot-test-connection', { botToken: botToken.trim() });
      if (res && res.success && res.bot) {
        setBotVerified(`@${res.bot.username}`);
        toast.success(`Бот успешно авторизован: @${res.bot.username} (${res.bot.firstName})`);
        await onRefreshStatus();
      } else {
        throw new Error(res?.error || 'Не удалось проверить бота');
      }
    } catch (err: any) {
      toast.error(err.message || 'Ошибка проверки Bot Token');
    } finally {
      setIsTestingBot(false);
    }
  };

  const handleCopyTag = async (tag: string) => {
    await safeCopyToClipboard(tag);
    setCopiedTag(tag);
    toast.success(`Скопировано: ${tag}`);
    setTimeout(() => setCopiedTag(null), 1500);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await ipcSafe.invoke('telegram-mtproto-save-settings', {
        apiId: apiId ? Number(apiId) : undefined,
        apiHash: apiHash.trim(),
        botToken: botToken.trim(),
        defaultChannelId: defaultChannelId.trim(),
        headerTemplate,
        footerTemplate,
        startNoticeTemplate,
        reminderTemplate,
        fixNoticeTemplate,
        trackReceivedTemplate
      });
      await onRefreshStatus();
      toast.success('Настройки Telegram успешно сохранены');
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

  const isConnected = status?.status === 'connected';

  const filteredLogs = logs.filter(l => {
    if (logFilter === 'all') return true;
    if (logFilter === 'error') return l.level === 'error' || l.level === 'warn';
    if (logFilter === 'auth') return l.tag.toLowerCase().includes('auth');
    if (logFilter === 'qr') return l.tag.toLowerCase().includes('qr');
    if (logFilter === 'search') return l.tag.toLowerCase().includes('search') || l.tag.toLowerCase().includes('public') || l.tag.toLowerCase().includes('preview');
    return true;
  });

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-neutral-950">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* MTProto Status Card */}
        {isConnected ? (
          <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold">
                {status?.me?.firstName ? status.me.firstName.charAt(0) : 'TG'}
              </div>
              <div>
                <div className="text-xs font-bold text-white flex items-center gap-2">
                  <span>{status?.me?.firstName} {status?.me?.lastName}</span>
                  <span className="text-emerald-400 font-mono text-[11px]">
                    {status?.me?.username ? `@${status.me.username}` : ''}
                  </span>
                </div>
                <div className="text-[11px] text-emerald-300 mt-0.5">
                  MTProto сессия активна • {status?.me?.phone || ''}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTestingConnection}
                className="px-3.5 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl text-xs font-semibold border border-neutral-700 transition flex items-center gap-1.5 cursor-pointer"
              >
                {isTestingConnection ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-400" />
                ) : (
                  <Radio className="w-3.5 h-3.5 text-emerald-400" />
                )}
                Проверить связь
              </button>

              <button
                type="button"
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="px-3.5 py-2 bg-red-950 hover:bg-red-900 text-red-300 hover:text-red-100 rounded-xl text-xs font-semibold border border-red-800/60 transition flex items-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Выйти
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 font-bold">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-white flex items-center gap-2">
                  <span>MTProto клиент не авторизован</span>
                  <span className="text-amber-400 text-[11px]">Offline</span>
                </div>
                <div className="text-[11px] text-neutral-400 mt-0.5">
                  Авторизуйтесь по QR-коду или проверьте журнал процессов для выявления причин
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTestingConnection}
                className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-xl text-xs font-semibold border border-neutral-700 transition flex items-center gap-1.5 cursor-pointer"
              >
                {isTestingConnection ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-400" />
                ) : (
                  <Radio className="w-3.5 h-3.5 text-amber-400" />
                )}
                Тест связи
              </button>

              {onOpenAuth && (
                <button
                  type="button"
                  onClick={onOpenAuth}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-md"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  Войти в MTProto
                </button>
              )}
            </div>
          </div>
        )}

        {/* Real-time Connection Diagnostics Result Card */}
        {connectionTestResult && (
          <div className={`p-4 rounded-2xl border text-xs ${connectionTestResult.connected ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-200' : 'bg-red-950/30 border-red-800/60 text-red-200'}`}>
            <div className="flex items-center justify-between font-bold mb-1.5">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4" />
                <span>Результат диагностики Telegram MTProto</span>
              </div>
              <span className="font-mono text-[11px]">{connectionTestResult.latencyMs} мс</span>
            </div>
            <div className="space-y-1 text-[11px] opacity-90 font-mono">
              <div>Статус: {connectionTestResult.connected ? '✅ Подключено и авторизовано' : '❌ Нет авторизованного соединения'}</div>
              {connectionTestResult.dcId && <div>Дата-центр: DC {connectionTestResult.dcId}</div>}
              {connectionTestResult.me && <div>Аккаунт: @{connectionTestResult.me.username || connectionTestResult.me.id} ({connectionTestResult.me.firstName})</div>}
              {connectionTestResult.error && <div className="text-red-300 mt-1">Ошибка: {connectionTestResult.error}</div>}
            </div>
          </div>
        )}

        {/* Diagnostic Logs Viewer (Журнал процессов MTProto) */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setIsLogsExpanded(!isLogsExpanded)}
              className="flex items-center gap-2 text-xs font-bold uppercase text-neutral-300 hover:text-white cursor-pointer"
            >
              <Terminal className="w-4 h-4 text-sky-400" />
              <span>Журнал процессов и логи MTProto ({logs.length})</span>
              {isLogsExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAutoRefreshLogs(!autoRefreshLogs)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition flex items-center gap-1 cursor-pointer ${autoRefreshLogs ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-neutral-800 text-neutral-400 border-neutral-700'}`}
              >
                <Activity className={`w-3 h-3 ${autoRefreshLogs ? 'animate-pulse text-sky-400' : ''}`} />
                {autoRefreshLogs ? 'Авто (2с)' : 'Пауза'}
              </button>

              <button
                type="button"
                onClick={fetchLogs}
                disabled={isLoadingLogs}
                className="p-1.5 hover:bg-neutral-800 text-neutral-400 hover:text-white rounded-lg transition cursor-pointer"
                title="Обновить журнал"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={handleCopyLogs}
                className="p-1.5 hover:bg-neutral-800 text-neutral-400 hover:text-white rounded-lg transition cursor-pointer"
                title="Скопировать логи"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={handleClearLogs}
                className="p-1.5 hover:bg-neutral-800 text-neutral-400 hover:text-red-400 rounded-lg transition cursor-pointer"
                title="Очистить логи"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {isLogsExpanded && (
            <div className="p-4 space-y-3">
              {/* Log Filters */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="text-neutral-500 font-semibold mr-1">Фильтр:</span>
                {(['all', 'auth', 'qr', 'search', 'error'] as const).map(f => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setLogFilter(f)}
                    className={`px-2 py-0.5 rounded-md font-mono transition cursor-pointer ${logFilter === f ? 'bg-sky-600 text-white font-bold' : 'bg-neutral-800 text-neutral-400 hover:text-white'}`}
                  >
                    {f === 'all' ? 'Все' : f === 'auth' ? 'Авторизация' : f === 'qr' ? 'QR-код' : f === 'search' ? 'Поиск каналов' : 'Ошибки'}
                  </button>
                ))}
              </div>

              {/* Console log window */}
              <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-3 h-52 overflow-y-auto font-mono text-[11px] space-y-1.5 select-text">
                {filteredLogs.length === 0 ? (
                  <div className="text-neutral-500 py-6 text-center">Журнал пуст. Выполните действие в приложении для формирования записей.</div>
                ) : (
                  filteredLogs.map((log, idx) => {
                    const isErr = log.level === 'error';
                    const isWarn = log.level === 'warn';
                    const isQr = log.tag === 'QR';
                    const isAuth = log.tag === 'Auth';
                    const isSearch = log.tag === 'Search' || log.tag === 'Public Preview';

                    return (
                      <div key={idx} className={`leading-relaxed break-all ${isErr ? 'text-red-400' : isWarn ? 'text-amber-300' : 'text-neutral-300'}`}>
                        <span className="text-neutral-500">[{log.time}]</span>{' '}
                        <span className={`px-1 rounded text-[10px] font-bold ${isErr ? 'bg-red-950 text-red-300 border border-red-800/40' : isWarn ? 'bg-amber-950 text-amber-300 border border-amber-800/40' : isQr ? 'bg-purple-950 text-purple-300' : isAuth ? 'bg-emerald-950 text-emerald-300' : isSearch ? 'bg-sky-950 text-sky-300' : 'bg-neutral-800 text-neutral-400'}`}>
                          {log.tag}
                        </span>{' '}
                        <span>{log.message}</span>
                        {log.details && (
                          <span className="text-neutral-500 text-[10px] block pl-4">
                            {typeof log.details === 'object' ? JSON.stringify(log.details) : log.details}
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          {/* Section: Telegram Bot API Token */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase text-neutral-400 tracking-wider flex items-center gap-2">
                <Bot className="w-4 h-4 text-purple-400" />
                Telegram Bot API (Для быстрых анонсов и автоматизаций)
              </h3>
              {botVerified && (
                <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  {botVerified}
                </span>
              )}
            </div>

            <p className="text-xs text-neutral-400">
              Если MTProto не подключен или вы хотите отправлять посты от имени студийного бота, укажите токен от <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">@BotFather</a>.
            </p>

            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1">
                <input
                  type="password"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder="1234567890:ABCdefGHIjklMNOpqrsTUVwxyz..."
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2 text-xs text-white font-mono focus:border-purple-500 outline-none"
                />
              </div>
              <button
                type="button"
                onClick={handleTestBot}
                disabled={isTestingBot || !botToken.trim()}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer flex-shrink-0"
              >
                {isTestingBot ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Проверка...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Проверить токен бота
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Section 1: MTProto API Keys */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-xs font-bold uppercase text-neutral-400 tracking-wider flex items-center gap-2">
              <Key className="w-3.5 h-3.5 text-sky-400" />
              Ключи Telegram MTProto Client (my.telegram.org)
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
              <label className="block text-xs font-semibold text-neutral-300 mb-1.5">Канал по умолчанию (@channel или -100... ID)</label>
              <input
                type="text"
                value={defaultChannelId}
                onChange={(e) => setDefaultChannelId(e.target.value)}
                placeholder="@my_release_channel"
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2 text-xs text-white font-mono focus:border-sky-500 outline-none"
              />
            </div>
          </div>

          {/* Placeholders Cheat Sheet */}
          <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-4 space-y-2">
            <div className="text-xs font-bold text-neutral-300">Переменные для шаблонов (нажмите, чтобы скопировать):</div>
            <div className="flex flex-wrap gap-1.5">
              {[
                '{title_ru}',
                '{title_orig}',
                '{episode_number}',
                '{dubbers_list}',
                '{site_link}',
                '{tg_group}',
                '{deadline}',
                '{source_link}',
                '{pending_dubbers}',
                '{dubber_name}',
                '{fixes_list}'
              ].map(tag => (
                <button
                  type="button"
                  key={tag}
                  onClick={() => handleCopyTag(tag)}
                  className="px-2 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 text-[11px] font-mono text-sky-300 hover:text-white transition flex items-center gap-1 cursor-pointer"
                >
                  {copiedTag === tag ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 opacity-60" />}
                  {tag}
                </button>
              ))}
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
                Сохранить настройки Telegram
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
