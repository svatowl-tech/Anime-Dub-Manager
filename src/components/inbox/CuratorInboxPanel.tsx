import React, { useEffect, useState, useCallback } from 'react';
import {
  Bell,
  Check,
  X,
  MessageSquare,
  ArrowLeft,
  ArrowUpRight,
  Trash2,
  CheckCheck,
  Loader2,
  AlertTriangle,
  Info,
  ShieldAlert,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  CuratorInboxItem,
  InboxStatus,
  InboxSummary,
  fetchCuratorInbox,
  respondCuratorInbox,
  markAllInboxRead,
  clearResolvedInbox,
  deleteInboxItem,
} from '../../lib/serverClient';
import { ipcSafe } from '../../lib/ipcSafe';

interface CuratorInboxPanelProps {
  onOpenTarget?: (params: {
    projectId?: string;
    episodeNumber?: number;
    targetTab?: string;
  }) => void;
  onOpenSettings?: () => void;
  onSummaryChange?: (summary: InboxSummary) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  approval: 'Согласование',
  qa_alert: 'Проверка QA',
  assignment_review: 'Назначение ролей',
  download_issue: 'Загрузка медиа',
  release_ready: 'Готов к релизу',
  note: 'Заметка',
  info: 'Уведомление',
};

const STATUS_LABELS: Record<InboxStatus, string> = {
  pending: 'Ожидает решения',
  approved: 'Одобрено',
  rejected: 'Отклонено',
  noted: 'С заметкой',
  resolved: 'Закрыто',
};

const SEVERITY_META: Record<string, { label: string; colorClass: string; Icon: any }> = {
  critical: { label: 'Критично', colorClass: 'text-red-400', Icon: ShieldAlert },
  action_required: { label: 'Требует решения', colorClass: 'text-amber-400', Icon: AlertTriangle },
  warning: { label: 'Внимание', colorClass: 'text-amber-300', Icon: AlertTriangle },
  info: { label: 'Информация', colorClass: 'text-blue-400', Icon: Info },
};

export const CuratorInboxPanel: React.FC<CuratorInboxPanelProps> = ({
  onOpenTarget,
  onOpenSettings,
  onSummaryChange,
}) => {
  const [items, setItems] = useState<CuratorInboxItem[]>([]);
  const [summary, setSummary] = useState<InboxSummary>({ unreadCount: 0, pendingCount: 0, total: 0 });
  const [filter, setFilter] = useState<'pending' | 'all' | 'approved' | 'rejected' | 'noted'>('pending');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadInbox = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCuratorInbox({ status: filter === 'all' ? 'all' : filter, limit: 100 });
      setItems(data.items);
      setSummary(data.summary);
      onSummaryChange?.(data.summary);
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить входящие уведомления');
    } finally {
      setLoading(false);
    }
  }, [filter, onSummaryChange]);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  useEffect(() => {
    const unsub = ipcSafe.on('curator-inbox-updated', () => {
      void loadInbox();
    });
    return () => unsub();
  }, [loadInbox]);

  const selectedItem = items.find((i) => i.id === selectedId) || null;

  useEffect(() => {
    if (selectedItem) {
      setNoteDraft(selectedItem.curatorNote || '');
      if (!selectedItem.read) {
        void respondCuratorInbox(selectedItem.id, { read: true })
          .then((updated) => {
            setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
          })
          .catch(() => {});
      }
    }
  }, [selectedId, selectedItem?.id]);

  const handleAction = async (
    item: CuratorInboxItem,
    nextStatus: InboxStatus,
    includeNote = true
  ) => {
    setBusyId(item.id);
    try {
      const updated = await respondCuratorInbox(item.id, {
        status: nextStatus,
        curatorNote: includeNote ? noteDraft.trim() || undefined : item.curatorNote,
        read: true,
      });
      toast.success(
        nextStatus === 'approved'
          ? 'Одобрено и передано агенту'
          : nextStatus === 'rejected'
            ? 'Отклонено с комментарием'
            : 'Заметка куратора сохранена'
      );
      await loadInbox();
      if (filter === 'pending' && nextStatus !== 'pending') {
        setSelectedId(null);
      } else {
        setSelectedId(updated.id);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Ошибка обновления уведомления');
    } finally {
      setBusyId(null);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllInboxRead();
      await loadInbox();
    } catch (err: any) {
      toast.error(err?.message || 'Ошибка');
    }
  };

  const handleClearResolved = async () => {
    try {
      const res = await clearResolvedInbox();
      toast.success(`Удалено закрытых записей: ${res.removed}`);
      setSelectedId(null);
      await loadInbox();
    } catch (err: any) {
      toast.error(err?.message || 'Ошибка очистки');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteInboxItem(id);
      if (selectedId === id) setSelectedId(null);
      await loadInbox();
    } catch (err: any) {
      toast.error(err?.message || 'Ошибка удаления');
    }
  };

  const filterTabs: { id: typeof filter; label: string }[] = [
    { id: 'pending', label: `Ожидают (${summary.pendingCount})` },
    { id: 'all', label: `Все (${summary.total})` },
    { id: 'approved', label: 'Одобрено' },
    { id: 'rejected', label: 'Отклонено' },
    { id: 'noted', label: 'С заметкой' },
  ];

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-neutral-950 overflow-hidden">
      {/* Header */}
      <header className="px-4 sm:px-6 py-4 border-b border-neutral-800 bg-neutral-900/50 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-white truncate">Входящие куратора</h1>
          <p className="text-xs text-neutral-400 tabular-nums mt-0.5">
            Ожидают решения: {summary.pendingCount} · Непрочитанных: {summary.unreadCount} · Всего: {summary.total}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => void loadInbox()}
            className="min-h-[40px] px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-200 flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Обновить</span>
          </button>
          <button
            type="button"
            onClick={handleMarkAllRead}
            className="min-h-[40px] px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-200 flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            <span>Прочитать все</span>
          </button>
          <button
            type="button"
            onClick={handleClearResolved}
            className="min-h-[40px] px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-300 flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Очистить решённые</span>
          </button>
        </div>
      </header>

      {/* Filter Bar */}
      <div className="px-4 sm:px-6 py-2.5 border-b border-neutral-800 bg-neutral-950 flex items-center gap-1.5 overflow-x-auto shrink-0">
        {filterTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setFilter(tab.id);
              setSelectedId(null);
            }}
            className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              filter === tab.id
                ? 'bg-blue-600 text-white'
                : 'bg-neutral-900 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Master-Detail Body */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* List Pane */}
        <div
          className={`${
            selectedItem ? 'hidden md:flex' : 'flex'
          } w-full md:w-[380px] lg:w-[420px] border-r border-neutral-800 flex-col min-h-0 overflow-y-auto divide-y divide-neutral-800/70`}
        >
          {error ? (
            <div className="p-6 text-center space-y-3">
              <p className="text-sm text-red-400">{error}</p>
              <button
                type="button"
                onClick={() => void loadInbox()}
                className="px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-white"
              >
                Повторить попытку
              </button>
            </div>
          ) : loading && items.length === 0 ? (
            <div className="p-10 flex items-center justify-center gap-2 text-sm text-neutral-400">
              <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
              <span>Загрузка...</span>
            </div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center space-y-4">
              <div className="w-12 h-12 rounded-xl bg-neutral-900 border border-neutral-800 flex items-center justify-center mx-auto text-neutral-500">
                <Bell className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-neutral-200">
                  {filter === 'pending' ? 'Нет задач, требующих решения' : 'Список уведомлений пуст'}
                </p>
                <p className="text-xs text-neutral-500 leading-relaxed">
                  Когда локальный AI-агент на сервере запросит проверку QA, назначение ролей или сборку релиза, карточка появится здесь и в Telegram.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {filter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setFilter('all')}
                    className="min-h-[40px] px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-200"
                  >
                    Показать все записи
                  </button>
                )}
                {onOpenSettings && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white"
                  >
                    Настроить MCP / Telegram
                  </button>
                )}
              </div>
            </div>
          ) : (
            items.map((item) => {
              const sev = SEVERITY_META[item.severity] || SEVERITY_META.info;
              const SevIcon = sev.Icon;
              const isSelected = selectedId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full text-left px-4 py-3.5 transition-colors space-y-1.5 ${
                    isSelected ? 'bg-blue-600/12' : 'hover:bg-neutral-900/80'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className={`inline-flex items-center gap-1.5 font-medium ${sev.colorClass}`}>
                      <SevIcon className="w-3.5 h-3.5 shrink-0" />
                      <span>{CATEGORY_LABELS[item.category] || item.category}</span>
                    </span>
                    <span className="text-neutral-500 tabular-nums shrink-0">
                      {new Date(item.createdAt).toLocaleString('ru-RU', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  <div className="flex items-start justify-between gap-2">
                    <h3 className={`text-sm font-semibold line-clamp-2 ${item.read ? 'text-neutral-300' : 'text-white'}`}>
                      {item.title}
                    </h3>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-neutral-400 truncate">
                    {item.projectTitle && (
                      <>
                        <span className="truncate">{item.projectTitle}</span>
                        {item.episodeNumber !== undefined && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums shrink-0">Серия {item.episodeNumber}</span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                      </>
                    )}
                    <span
                      className={
                        item.status === 'approved'
                          ? 'text-emerald-400'
                          : item.status === 'rejected'
                            ? 'text-red-400'
                            : item.status === 'pending'
                              ? 'text-amber-400'
                              : 'text-neutral-400'
                      }
                    >
                      {STATUS_LABELS[item.status]}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Detail Pane */}
        <div
          className={`${
            selectedItem ? 'flex' : 'hidden md:flex'
          } flex-1 min-h-0 flex-col overflow-y-auto bg-neutral-950`}
        >
          {!selectedItem ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-neutral-500">
              <MessageSquare className="w-8 h-8 mb-3 opacity-40" />
              <p className="text-sm">Выберите уведомление слева, чтобы просмотреть детали и принять решение.</p>
            </div>
          ) : (
            <div className="p-4 sm:p-6 max-w-3xl space-y-6">
              {/* Mobile back button */}
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="md:hidden min-h-[44px] px-3 -ml-1 rounded-lg text-sm font-medium text-blue-400 hover:bg-neutral-900 inline-flex items-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Назад к списку</span>
              </button>

              <div className="space-y-2 border-b border-neutral-800 pb-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400 tabular-nums">
                  <span className={(SEVERITY_META[selectedItem.severity] || SEVERITY_META.info).colorClass}>
                    {(SEVERITY_META[selectedItem.severity] || SEVERITY_META.info).label}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{CATEGORY_LABELS[selectedItem.category] || selectedItem.category}</span>
                  <span aria-hidden="true">·</span>
                  <span>{STATUS_LABELS[selectedItem.status]}</span>
                  <span aria-hidden="true">·</span>
                  <span>{new Date(selectedItem.createdAt).toLocaleString('ru-RU')}</span>
                </div>

                <h2 className="text-xl font-bold text-white">{selectedItem.title}</h2>

                {selectedItem.projectTitle && (
                  <p className="text-sm text-neutral-300">
                    Проект: <span className="font-medium text-white">{selectedItem.projectTitle}</span>
                    {selectedItem.episodeNumber !== undefined ? ` · Серия ${selectedItem.episodeNumber}` : ''}
                  </p>
                )}
              </div>

              <div className="text-sm text-neutral-200 whitespace-pre-wrap leading-relaxed">
                {selectedItem.message}
              </div>

              {selectedItem.proposedAction && (
                <div className="p-4 rounded-lg bg-neutral-900 border border-neutral-800 space-y-1">
                  <div className="text-xs font-semibold text-neutral-400">Предложенное действие агента</div>
                  <p className="text-sm text-neutral-100 whitespace-pre-wrap">{selectedItem.proposedAction}</p>
                </div>
              )}

              {(selectedItem.projectId || selectedItem.targetTab) && onOpenTarget && (
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      onOpenTarget({
                        projectId: selectedItem.projectId,
                        episodeNumber: selectedItem.episodeNumber,
                        targetTab: selectedItem.targetTab,
                      })
                    }
                    className="min-h-[44px] px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-semibold text-white inline-flex items-center gap-2 transition-colors"
                  >
                    <span>Открыть в рабочем пространстве</span>
                    <ArrowUpRight className="w-4 h-4" />
                  </button>
                </div>
              )}

              <div className="space-y-3 pt-2 border-t border-neutral-800">
                <label className="block text-xs font-medium text-neutral-400">
                  Заметка / комментарий куратора (агент прочитает этот ответ)
                </label>
                <textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  rows={3}
                  placeholder="Напишите указание агенту или оставьте пометку для истории..."
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-lg p-3 text-sm text-white focus:border-blue-500 outline-none resize-y"
                />

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    disabled={busyId === selectedItem.id}
                    onClick={() => void handleAction(selectedItem, 'approved')}
                    className="min-h-[44px] px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Check className="w-4 h-4" />
                    <span>Одобрить</span>
                  </button>

                  <button
                    type="button"
                    disabled={busyId === selectedItem.id}
                    onClick={() => void handleAction(selectedItem, 'rejected')}
                    className="min-h-[44px] px-4 py-2 rounded-lg bg-red-600/80 hover:bg-red-600 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center gap-1.5 transition-colors"
                  >
                    <X className="w-4 h-4" />
                    <span>Отклонить</span>
                  </button>

                  <button
                    type="button"
                    disabled={busyId === selectedItem.id}
                    onClick={() => void handleAction(selectedItem, 'noted')}
                    className="min-h-[44px] px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center gap-1.5 transition-colors"
                  >
                    <MessageSquare className="w-4 h-4" />
                    <span>Сохранить заметку</span>
                  </button>

                  <div className="flex-1" />

                  <button
                    type="button"
                    onClick={() => void handleDelete(selectedItem.id)}
                    className="min-h-[44px] px-3 py-2 rounded-lg text-xs text-neutral-400 hover:text-red-400 hover:bg-neutral-900 inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Удалить</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
