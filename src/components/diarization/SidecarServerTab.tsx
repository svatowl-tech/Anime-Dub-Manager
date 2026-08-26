import React, { useState, useEffect } from 'react';
import { Radio, Play, Square, RefreshCw, Cpu, Settings2 } from 'lucide-react';
import { ipcSafe } from '../../lib/ipcSafe';
import { toast } from 'sonner';

export const SidecarServerTab: React.FC = () => {
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [port, setPort] = useState<number>(8000);
  const [model, setModel] = useState<string>('base');
  const [backend, setBackend] = useState<string>('faster-whisper');

  const checkStatus = async () => {
    try {
      const res = await ipcSafe.invoke('get-whisper-livekit-status');
      if (res) {
        setIsRunning(!!res.isRunning);
      }
    } catch (err) {
      console.error('Error checking sidecar status:', err);
    }
  };

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleServer = async () => {
    setIsStarting(true);
    try {
      if (isRunning) {
        await ipcSafe.invoke('stop-whisper-livekit-server');
        setIsRunning(false);
        toast.success('Sidecar-сервер остановлен');
      } else {
        const res = await ipcSafe.invoke('start-whisper-livekit-server', {
          port,
          model,
          backend
        });
        if (res && res.success) {
          setIsRunning(true);
          toast.success('Sidecar-сервер успешно запущен!');
        } else {
          toast.error(res?.error || 'Не удалось запустить сервер');
        }
      }
    } catch (err: any) {
      toast.error(`Ошибка: ${err.message}`);
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full py-2">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-indigo-900/30 via-neutral-900 to-neutral-900 border border-indigo-500/20 rounded-2xl p-6 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400 shrink-0">
            <Radio className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">
              WhisperLiveKit Sidecar Server
            </h3>
            <p className="text-xs text-neutral-300 mt-1">
              Локальный высокопроизводительный микросервис потоковой диаризации и транскрипции (Sortformer / Diart)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${
            isRunning ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-neutral-800 text-neutral-400 border border-neutral-700'
          }`}>
            <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-neutral-500'}`} />
            {isRunning ? 'Работает (Online)' : 'Остановлен'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Server Configuration */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-neutral-800">
            <Settings2 className="w-4 h-4 text-indigo-400" />
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
              Параметры микросервиса
            </h4>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-medium text-neutral-400 mb-1">
                Порт сервера
              </label>
              <input
                type="number"
                value={port}
                disabled={isRunning}
                onChange={(e) => setPort(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-white disabled:opacity-50 font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-neutral-400 mb-1">
                Модель Whisper
              </label>
              <select
                value={model}
                disabled={isRunning}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-white disabled:opacity-50"
              >
                <option value="tiny">tiny (Сверхбыстрая)</option>
                <option value="base">base (Оптимальный баланс)</option>
                <option value="small">small (Высокая точность)</option>
                <option value="medium">medium (Профессиональная)</option>
                <option value="large-v3-turbo">large-v3-turbo (SOTA)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-neutral-400 mb-1">
                Движок инференса
              </label>
              <select
                value={backend}
                disabled={isRunning}
                onChange={(e) => setBackend(e.target.value)}
                className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-white disabled:opacity-50"
              >
                <option value="faster-whisper">faster-whisper (CTranslate2, GPU/CPU)</option>
                <option value="openai-whisper">openai-whisper (PyTorch)</option>
              </select>
            </div>

            <button
              onClick={handleToggleServer}
              disabled={isStarting}
              className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-bold shadow-md transition-all cursor-pointer ${
                isRunning
                  ? 'bg-red-600/90 hover:bg-red-500 text-white'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white'
              }`}
            >
              {isStarting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Обработка...
                </>
              ) : isRunning ? (
                <>
                  <Square className="w-4 h-4" />
                  Остановить сервер
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Запустить Sidecar-сервер
                </>
              )}
            </button>
          </div>
        </div>

        {/* Server Endpoints & Usage */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-neutral-800">
            <Cpu className="w-4 h-4 text-indigo-400" />
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
              Эндпоинты и интеграция
            </h4>
          </div>

          <div className="space-y-3 text-xs">
            <div className="p-3 bg-neutral-950 border border-neutral-850 rounded-xl space-y-1">
              <div className="text-[10px] text-neutral-500 font-bold uppercase">HTTP API Эндпоинт:</div>
              <div className="font-mono text-indigo-300 select-all">http://127.0.0.1:{port}/asr</div>
            </div>

            <div className="p-3 bg-neutral-950 border border-neutral-850 rounded-xl space-y-1">
              <div className="text-[10px] text-neutral-500 font-bold uppercase">WebSocket Поток:</div>
              <div className="font-mono text-indigo-300 select-all">ws://127.0.0.1:{port}/ws</div>
            </div>

            <p className="text-[11px] text-neutral-400 leading-relaxed pt-2">
              При запуске сервера ИИ-конвейер диаризации может использовать микросервис для сверхбыстрого инференса без блокировки основного процесса Electron.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
