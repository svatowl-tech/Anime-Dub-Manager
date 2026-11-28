import { useEffect, useState } from 'react';
import { Download, RefreshCw, RotateCw, ArrowUpRight, X, Cpu } from 'lucide-react';
import { toast } from 'sonner';
import { isWeb } from '../../lib/ipcSafe';
import {
  UnifiedUpdateStatus,
  applyServerUpdate,
  downloadDesktopUpdate,
  getUpdateStatus,
  installDesktopUpdate,
  installOrUpdateAiEnv,
  subscribeAiEnvProgress,
  subscribeUpdateStatus,
} from '../../lib/updatesClient';

interface UpdateBannerProps {
  onOpenSettings: () => void;
  onOpenInbox: () => void;
}

export function UpdateBanner({ onOpenSettings, onOpenInbox }: UpdateBannerProps) {
  const [update, setUpdate] = useState<UnifiedUpdateStatus | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [aiEnvPercent, setAiEnvPercent] = useState<number | null>(null);
  const [aiEnvMsg, setAiEnvMsg] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  useEffect(() => {
    let mounted = true;
    void getUpdateStatus()
      .then((st) => {
        if (mounted) setUpdate(st);
      })
      .catch(() => {});

    const unsubStatus = subscribeUpdateStatus((st) => {
      if (mounted) setUpdate(st);
    });
    const unsubEnv = subscribeAiEnvProgress((p) => {
      if (!mounted) return;
      if (p.status === 'ready') {
        setAiEnvPercent(null);
        setAiEnvMsg(null);
        void getUpdateStatus().then((st) => mounted && setUpdate(st)).catch(() => {});
      } else if (p.status === 'error') {
        setAiEnvPercent(null);
        setAiEnvMsg(null);
      } else {
        setAiEnvPercent(p.percent);
        setAiEnvMsg(p.message);
      }
    });

    return () => {
      mounted = false;
      unsubStatus();
      unsubEnv();
    };
  }, []);

  // Poll /api/health when server is restarting so browser reconnects seamlessly
  useEffect(() => {
    if (update?.status !== 'restarting') return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (res.ok && !cancelled) {
          clearInterval(timer);
          window.location.reload();
        }
      } catch {}
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [update?.status]);

  if (!update) return null;

  const hasAppUpdate = Boolean(
    update.appUpdateAvailable ||
      update.status === 'available' ||
      update.status === 'downloading' ||
      update.status === 'downloaded' ||
      update.status === 'installing' ||
      update.status === 'restarting'
  );
  const hasAiEnvUpdate = Boolean(update.aiEnv?.updateAvailable || update.aiEnvUpdateAvailable);
  const isWorking =
    update.status === 'downloading' ||
    update.status === 'installing' ||
    update.status === 'restarting' ||
    aiEnvPercent !== null;

  if (!hasAppUpdate && !hasAiEnvUpdate && !isWorking) {
    return null;
  }

  const key = `${update.availableVersion || 'none'}_${update.aiEnv?.remoteHash || 'none'}`;
  if (!isWorking && dismissedKey === key) {
    return null;
  }

  const handleDesktopDownload = async () => {
    setBusyAction(true);
    try {
      await downloadDesktopUpdate();
    } catch (err: any) {
      toast.error(err?.message || 'Не удалось начать загрузку обновления');
    } finally {
      setBusyAction(false);
    }
  };

  const handleDesktopInstall = async () => {
    setBusyAction(true);
    try {
      await installDesktopUpdate();
    } catch (err: any) {
      toast.error(err?.message || 'Не удалось запустить установщик');
      setBusyAction(false);
    }
  };

  const handleAiEnvUpdate = async () => {
    setBusyAction(true);
    try {
      await installOrUpdateAiEnv(true);
      toast.success('AI_env успешно обновлено');
      const next = await getUpdateStatus();
      setUpdate(next);
    } catch (err: any) {
      toast.error(err?.message || 'Не удалось обновить AI_env');
    } finally {
      setBusyAction(false);
    }
  };

  const handleServerApply = async () => {
    setBusyAction(true);
    try {
      await applyServerUpdate(false);
    } catch (err: any) {
      toast.error(err?.message || 'Не удалось применить обновление сервера');
      setBusyAction(false);
    }
  };

  return (
    <div className="shrink-0 bg-neutral-900 border-b border-neutral-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
      <div className="flex items-center gap-2.5 min-w-0">
        {update.status === 'restarting' || update.status === 'downloading' || update.status === 'installing' || aiEnvPercent !== null ? (
          <RefreshCw className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
        ) : hasAppUpdate ? (
          <Download className="w-4 h-4 text-blue-400 shrink-0" />
        ) : (
          <Cpu className="w-4 h-4 text-emerald-400 shrink-0" />
        )}

        <div className="min-w-0">
          {update.status === 'restarting' ? (
            <span className="font-medium text-white">
              Сервер перезапускается после обновления... Страница обновится автоматически.
            </span>
          ) : aiEnvPercent !== null ? (
            <span className="font-medium text-neutral-100 tabular-nums">
              {aiEnvMsg || 'Обновление AI_env...'} {aiEnvPercent > 0 ? `${aiEnvPercent}%` : ''}
            </span>
          ) : update.status === 'downloading' || update.status === 'installing' ? (
            <span className="font-medium text-neutral-100 tabular-nums">
              {update.stageMessage || `Загрузка обновления v${update.availableVersion || ''}...`}{' '}
              {update.downloadPercent ? `${update.downloadPercent}%` : ''}
            </span>
          ) : update.status === 'downloaded' ? (
            <span className="font-medium text-emerald-300 tabular-nums">
              Обновление v{update.availableVersion} загружено и готово к установке.
            </span>
          ) : hasAppUpdate ? (
            <span className="text-neutral-200 tabular-nums">
              Доступна новая версия <strong className="text-white">v{update.availableVersion}</strong>
              <span className="text-neutral-400">
                {' '}· сейчас v{update.currentVersion}
                {hasAiEnvUpdate ? ' · включает обновление AI_env' : ' · AI_env без изменений'}
              </span>
            </span>
          ) : (
            <span className="text-neutral-200">
              Доступно обновление нейросетевой среды <strong className="text-white">AI_env</strong>
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {!isWeb && update.status === 'downloaded' && (
          <button
            type="button"
            disabled={busyAction}
            onClick={() => void handleDesktopInstall()}
            className="min-h-[32px] px-3 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>Перезапустить и обновить</span>
          </button>
        )}

        {!isWeb && hasAppUpdate && update.status === 'available' && (
          <button
            type="button"
            disabled={busyAction}
            onClick={() => void handleDesktopDownload()}
            className="min-h-[32px] px-3 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Скачать обновление</span>
          </button>
        )}

        {!isWeb && !hasAppUpdate && hasAiEnvUpdate && aiEnvPercent === null && (
          <button
            type="button"
            disabled={busyAction}
            onClick={() => void handleAiEnvUpdate()}
            className="min-h-[32px] px-3 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Обновить AI_env</span>
          </button>
        )}

        {isWeb && update.hotSwapSupported && update.status === 'available' && (
          <>
            {update.pendingInboxItemId && (
              <button
                type="button"
                onClick={onOpenInbox}
                className="min-h-[32px] px-2.5 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-200 whitespace-nowrap"
              >
                Во входящих
              </button>
            )}
            <button
              type="button"
              disabled={busyAction}
              onClick={() => void handleServerApply()}
              className="min-h-[32px] px-3 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Обновить сервер</span>
            </button>
          </>
        )}

        <button
          type="button"
          onClick={onOpenSettings}
          className="min-h-[32px] px-2.5 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-300 inline-flex items-center gap-1 whitespace-nowrap"
        >
          <span>Подробнее</span>
          <ArrowUpRight className="w-3 h-3" />
        </button>

        {!isWorking && (
          <button
            type="button"
            onClick={() => setDismissedKey(key)}
            className="min-h-[32px] min-w-[32px] rounded-md flex items-center justify-center text-neutral-400 hover:text-white hover:bg-neutral-800"
            aria-label="Скрыть уведомление"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
