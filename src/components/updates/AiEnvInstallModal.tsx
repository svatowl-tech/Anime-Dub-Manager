import { useEffect, useState } from 'react';
import { Cpu, Download, AlertTriangle, CheckCircle2, X, Loader2 } from 'lucide-react';
import {
  AiEnvPromptRequest,
  registerAiEnvModalListener,
} from '../../lib/aiEnvBridge';
import {
  EnvDownloadProgressDto,
  getAiEnvStatus,
  installOrUpdateAiEnv,
  subscribeAiEnvProgress,
} from '../../lib/updatesClient';

function formatBytesMb(bytes?: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} ГБ`;
  return `${Math.round(bytes / (1024 * 1024))} МБ`;
}

export function AiEnvInstallModal() {
  const [request, setRequest] = useState<AiEnvPromptRequest | null>(null);
  const [stage, setStage] = useState<'prompt' | 'installing' | 'done' | 'error'>('prompt');
  const [progress, setProgress] = useState<EnvDownloadProgressDto>({
    status: 'downloading',
    percent: 0,
    message: 'Подготовка установки...',
  });
  const [sizeText, setSizeText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    return registerAiEnvModalListener((nextReq) => {
      setRequest(nextReq);
      setStage('prompt');
      setErrorText(null);
      setProgress({
        status: 'downloading',
        percent: 0,
        message: 'Подготовка загрузки AI_env...',
      });
      if (nextReq) {
        void getAiEnvStatus(true)
          .then((st) => setSizeText(formatBytesMb(st.remoteSize)))
          .catch(() => {});
      }
    });
  }, []);

  useEffect(() => {
    if (!request) return;
    return subscribeAiEnvProgress((p) => {
      setProgress(p);
      if (p.status === 'error') {
        setErrorText(p.message || 'Ошибка установки AI-окружения');
        setStage('error');
      } else if (p.status === 'ready') {
        setStage('done');
      }
    });
  }, [request]);

  if (!request) return null;

  const isBusy = stage === 'installing';

  const handleInstall = async () => {
    setStage('installing');
    setErrorText(null);
    setProgress({
      status: 'downloading',
      percent: 0,
      message: 'Подключение к серверу релизов...',
    });

    try {
      await installOrUpdateAiEnv(request.mode === 'update');
      setStage('done');
      setTimeout(() => {
        request.resolve(true);
      }, 450);
    } catch (err: any) {
      setErrorText(err?.message || 'Не удалось установить AI-окружение');
      setStage('error');
    }
  };

  const handleCancel = () => {
    if (isBusy) return;
    request.resolve(false);
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-xl bg-neutral-900 border border-neutral-800 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Cpu className="w-5 h-5 text-blue-400 shrink-0" />
            <h2 className="text-base font-semibold text-white truncate">
              {request.mode === 'update' ? 'Требуется обновление AI-окружения' : 'Установка нейросетевого AI-окружения'}
            </h2>
          </div>
          {!isBusy && (
            <button
              type="button"
              onClick={handleCancel}
              className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-neutral-800"
              aria-label="Закрыть"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-neutral-200 leading-relaxed">
            Для функции <span className="font-semibold text-white">«{request.featureName}»</span> требуется портативное
            Python AI-окружение (PyTorch, DeepFilterNet3, Demucs v4, WhisperX).
          </p>

          <p className="text-xs text-neutral-400 leading-relaxed">
            Установка полностью автоматическая: приложение само скачает нужный пакет, проверит контрольную сумму,
            распакует файлы и продолжит выполнение операции.{sizeText ? ` Размер загрузки: ~${sizeText}.` : ''}
          </p>

          {stage === 'installing' && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-300 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                  <span>{progress.message}</span>
                </span>
                <span className="font-mono tabular-nums text-blue-400 font-semibold">
                  {progress.percent > 0 ? `${progress.percent}%` : ''}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-neutral-800 overflow-hidden">
                <div
                  className={`h-full bg-blue-500 transition-all duration-300 ${
                    progress.percent === 0 && progress.status === 'extracting' ? 'w-full animate-pulse' : ''
                  }`}
                  style={{ width: `${Math.max(progress.percent, progress.status === 'extracting' ? 100 : 4)}%` }}
                />
              </div>
            </div>
          )}

          {stage === 'done' && (
            <div className="flex items-center gap-2 text-sm text-emerald-400 pt-1">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>AI-окружение установлено и проверено. Запускаем задачу...</span>
            </div>
          )}

          {stage === 'error' && errorText && (
            <div className="p-3 rounded-lg bg-red-950/50 border border-red-900/70 text-xs text-red-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{errorText}</span>
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-neutral-800 bg-neutral-950/60 flex items-center justify-end gap-2.5">
          <button
            type="button"
            disabled={isBusy}
            onClick={handleCancel}
            className="min-h-[40px] px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-xs font-medium text-neutral-200 whitespace-nowrap transition-colors"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={isBusy || stage === 'done'}
            onClick={() => void handleInstall()}
            className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center gap-2 whitespace-nowrap transition-colors"
          >
            {isBusy ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Установка...</span>
              </>
            ) : stage === 'error' ? (
              <>
                <Download className="w-3.5 h-3.5" />
                <span>Повторить установку</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                <span>Установить автоматически</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
