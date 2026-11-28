import { useEffect, useState } from 'react';
import {
  RefreshCw,
  Download,
  RotateCw,
  RotateCcw,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { isWeb } from '../../lib/ipcSafe';
import {
  EnvDownloadProgressDto,
  UnifiedUpdateStatus,
  applyServerUpdate,
  checkForSystemUpdates,
  downloadDesktopUpdate,
  getUpdateStatus,
  installDesktopUpdate,
  installOrUpdateAiEnv,
  rollbackServerUpdate,
  subscribeAiEnvProgress,
  subscribeUpdateStatus,
} from '../../lib/updatesClient';

export function SystemUpdatesCard() {
  const [status, setStatus] = useState<UnifiedUpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [confirmRollback, setConfirmRollback] = useState(false);
  const [envProgress, setEnvProgress] = useState<EnvDownloadProgressDto | null>(null);

  const loadStatus = async () => {
    try {
      const data = await getUpdateStatus();
      setStatus(data);
    } catch {}
  };

  useEffect(() => {
    void loadStatus();
    const unsubStatus = subscribeUpdateStatus((st) => setStatus(st));
    const unsubEnv = subscribeAiEnvProgress((p) => {
      if (p.status === 'ready') {
        setEnvProgress(null);
        void loadStatus();
      } else if (p.status === 'error') {
        setEnvProgress(p);
      } else {
        setEnvProgress(p);
      }
    });
    return () => {
      unsubStatus();
      unsubEnv();
    };
  }, []);

  const handleCheckUpdates = async () => {
    setChecking(true);
    try {
      const next = await checkForSystemUpdates();
      setStatus(next);
      if (next.appUpdateAvailable || next.aiEnvUpdateAvailable) {
        toast.success(`Найдено обновление${next.availableVersion ? ` v${next.availableVersion}` : ''}`);
      } else {
        toast.success('Установлена актуальная версия');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Ошибка при проверке обновлений');
    } finally {
      setChecking(false);
    }
  };

  const handleDesktopDownload = async () => {
    setBusyAction(true);
    try {
      await downloadDesktopUpdate();
    } catch (err: any) {
      toast.error(err?.message || 'Не удалось скачать обновление');
    } finally {
      setBusyAction(false);
    }
  };

  const handleDesktopInstall = async () => {
    setBusyAction(true);
    try {
      await installDesktopUpdate();
    } catch (err: any) {
      toast.error(err?.message || 'Ошибка запуска установщика');
      setBusyAction(false);
    }
  };

  const handleAiEnvAction = async (force = false) => {
    setBusyAction(true);
    try {
      await installOrUpdateAiEnv(force);
      toast.success('Нейросетевое окружение AI_env установлено и готово');
      await loadStatus();
    } catch (err: any) {
      toast.error(err?.message || 'Ошибка установки AI_env');
    } finally {
      setBusyAction(false);
    }
  };

  const handleServerApply = async (force = false) => {
    setBusyAction(true);
    try {
      await applyServerUpdate(force);
      toast.info('Обновление применяется, сервер перезапускается...');
    } catch (err: any) {
      toast.error(err?.message || 'Ошибка обновления сервера');
      setBusyAction(false);
    }
  };

  const handleServerRollback = async () => {
    setBusyAction(true);
    setConfirmRollback(false);
    try {
      await rollbackServerUpdate();
      toast.info('Выполняется откат и перезапуск сервера...');
    } catch (err: any) {
      toast.error(err?.message || 'Не удалось выполнить откат');
      setBusyAction(false);
    }
  };

  const ai = status?.aiEnv;
  const appUpdating =
    status?.status === 'downloading' || status?.status === 'installing' || status?.status === 'restarting';

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-blue-400">
          <RotateCw className="w-5 h-5" />
          <h2 className="text-lg font-semibold text-white">Обновления приложения и AI-окружения</h2>
        </div>

        <button
          type="button"
          disabled={checking || appUpdating}
          onClick={() => void handleCheckUpdates()}
          className="min-h-[38px] px-3.5 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-xs font-medium text-neutral-100 inline-flex items-center gap-2 whitespace-nowrap transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
          <span>{checking ? 'Проверка...' : 'Проверить обновления'}</span>
        </button>
      </div>

      <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-4 sm:p-5 space-y-5">
        {/* Application Build & Release Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div className="text-sm font-semibold text-white tabular-nums">
              Anime Dub Manager v{status?.currentVersion || '1.2.0'}
              {status?.commitHash ? (
                <span className="text-xs font-normal text-neutral-400"> · {status.commitHash}</span>
              ) : null}
            </div>
            <div className="text-xs text-neutral-400 tabular-nums">
              {status?.mode === 'server'
                ? status.activeAppSource === 'hot-swap'
                  ? 'Режим сервера · активна горячая сборка /data/runtime/current'
                  : 'Режим сервера · базовая сборка контейнера'
                : 'Десктопное приложение · канал обновлений GitHub Releases'}
              {status?.checkedAt ? ` · проверено ${new Date(status.checkedAt).toLocaleString('ru-RU')}` : ''}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {!isWeb && status?.status === 'available' && (
              <button
                type="button"
                disabled={busyAction}
                onClick={() => void handleDesktopDownload()}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center gap-2 whitespace-nowrap"
              >
                <Download className="w-4 h-4" />
                <span>Скачать v{status.availableVersion}</span>
              </button>
            )}

            {!isWeb && status?.status === 'downloaded' && (
              <button
                type="button"
                disabled={busyAction}
                onClick={() => void handleDesktopInstall()}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center gap-2 whitespace-nowrap"
              >
                <RotateCw className="w-4 h-4" />
                <span>Перезапустить и установить</span>
              </button>
            )}

            {isWeb && status?.hotSwapSupported && (status?.appUpdateAvailable || status?.aiEnvUpdateAvailable) && !appUpdating && (
              <button
                type="button"
                disabled={busyAction}
                onClick={() => void handleServerApply(false)}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center gap-2 whitespace-nowrap"
              >
                <Download className="w-4 h-4" />
                <span>
                  Обновить до {status.availableTagName || 'последней версии'}
                </span>
              </button>
            )}

            {isWeb && status?.canRollback && !appUpdating && (
              confirmRollback ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => void handleServerRollback()}
                    className="min-h-[40px] px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-semibold text-white whitespace-nowrap"
                  >
                    Подтвердить откат
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmRollback(false)}
                    className="min-h-[40px] px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-300 whitespace-nowrap"
                  >
                    Отмена
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => setConfirmRollback(true)}
                  className="min-h-[40px] px-3.5 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-200 inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Откатить версию</span>
                </button>
              )
            )}
          </div>
        </div>

        {/* App Update Progress / Release Summary */}
        {(appUpdating || status?.error || status?.appUpdateAvailable) && (
          <div className="pt-4 border-t border-neutral-800 space-y-2.5">
            {appUpdating && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-200">{status?.stageMessage || 'Обновление...'}</span>
                  <span className="font-mono tabular-nums text-blue-400">
                    {status?.downloadPercent ? `${status.downloadPercent}%` : ''}
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-neutral-800 overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${Math.max(status?.downloadPercent || 10, 5)}%` }}
                  />
                </div>
              </div>
            )}

            {status?.appUpdateAvailable && !appUpdating && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-300">
                <span>
                  Найдена версия <strong className="text-white">v{status.availableVersion}</strong>
                  {status.aiEnvUpdateAvailable
                    ? ' · требуется обновление AI_env'
                    : ' · только пакет приложения (AI_env не меняется)'}
                </span>
                {status.releaseUrl && (
                  <a
                    href={status.releaseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
                  >
                    <span>Release Notes</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}

            {status?.error && (
              <div className="p-3 rounded-lg bg-red-950/50 border border-red-900/70 text-xs text-red-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{status.error}</span>
              </div>
            )}
          </div>
        )}

        {/* AI_env Runtime Section */}
        <div className="pt-4 border-t border-neutral-800 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Cpu className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Нейросетевая среда AI_env (Python Runtime)</span>
              </div>
              <div className="text-xs text-neutral-400 tabular-nums">
                {ai?.ready ? (
                  <span className="text-emerald-400 inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Установлено и готово</span>
                  </span>
                ) : (
                  <span className="text-amber-400">Не установлено — будет загружено автоматически при первом запуске AI-инструментов</span>
                )}
                {ai?.installedHash ? ` · hash ${ai.installedHash.slice(0, 10)}` : ''}
                {ai?.platformTag ? ` · ${ai.platformTag}` : ''}
              </div>
            </div>

            {(!isWeb || status?.hotSwapSupported) && (
              <div className="flex items-center gap-2 shrink-0">
                {(!ai?.ready || ai?.updateAvailable || ai?.hashMismatch) && (
                  <button
                    type="button"
                    disabled={busyAction || envProgress !== null}
                    onClick={() => void (isWeb ? handleServerApply(true) : handleAiEnvAction(true))}
                    className="min-h-[38px] px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center gap-2 whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{ai?.ready ? 'Обновить AI_env' : 'Установить AI_env'}</span>
                  </button>
                )}
                {ai?.ready && !ai?.updateAvailable && !ai?.hashMismatch && !isWeb && (
                  <button
                    type="button"
                    disabled={busyAction || envProgress !== null}
                    onClick={() => void handleAiEnvAction(true)}
                    className="min-h-[38px] px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-xs font-medium text-neutral-300 whitespace-nowrap"
                  >
                    Переустановить AI_env
                  </button>
                )}
              </div>
            )}
          </div>

          {envProgress && envProgress.status !== 'ready' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className={envProgress.status === 'error' ? 'text-red-300' : 'text-neutral-200'}>
                  {envProgress.message}
                </span>
                <span className="font-mono tabular-nums text-emerald-400">
                  {envProgress.percent > 0 ? `${envProgress.percent}%` : ''}
                </span>
              </div>
              {envProgress.status !== 'error' && (
                <div className="w-full h-2 rounded-full bg-neutral-800 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-300"
                    style={{ width: `${Math.max(envProgress.percent, 5)}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
