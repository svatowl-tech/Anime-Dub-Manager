import React from "react";
import {
  X,
  Sparkles,
  Headphones,
  Check,
  Save,
  Copy,
  Terminal,
  Clock,
  ScrollText,
  FileCheck
} from "lucide-react";
import { toast } from "sonner";
import { safeCopyToClipboard } from "../../../lib/clipboard";
import { QAScanReport } from "../../../lib/qa/missingLinesDetector";
import { Episode } from "../../../types";

export interface MissingLinesLogAndReportModalsProps {
  soundEngineerModalOpen: boolean;
  setSoundEngineerModalOpen: (val: boolean) => void;
  soundEngineerReportText: string;
  hasCopiedReport: boolean;
  handleCopyReport: () => Promise<void>;
  episode?: Episode | null;
  onOpenTimingPanel?: () => void;
  isLogModalOpen: boolean;
  setIsLogModalOpen: (val: boolean) => void;
  activeReport?: QAScanReport;
  logFilterStage: "all" | "whisper" | "error" | "audio";
  setLogFilterStage: (val: "all" | "whisper" | "error" | "audio") => void;
  copiedLogs: boolean;
  setCopiedLogs: (val: boolean) => void;
}

export const MissingLinesLogAndReportModals: React.FC<MissingLinesLogAndReportModalsProps> = ({
  soundEngineerModalOpen,
  setSoundEngineerModalOpen,
  soundEngineerReportText,
  hasCopiedReport,
  handleCopyReport,
  episode,
  onOpenTimingPanel,
  isLogModalOpen,
  setIsLogModalOpen,
  activeReport,
  logFilterStage,
  setLogFilterStage,
  copiedLogs,
  setCopiedLogs
}) => {
  return (
    <>
      {/* Sound Engineer Message Modal */}
      {soundEngineerModalOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden text-neutral-200">
            <div className="p-5 border-b border-neutral-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-indigo-600/20 text-indigo-400">
                  <Headphones className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Отчет для звукорежиссера сведения</h3>
                  <p className="text-xs text-neutral-400">
                    Сводка по наездам хвостов, параллельной речи, задержкам и висячим японским хвостам
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSoundEngineerModalOpen(false)}
                className="p-1 text-neutral-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <textarea
                readOnly
                value={soundEngineerReportText}
                className="w-full h-80 bg-neutral-950 border border-neutral-800 rounded-xl p-4 font-mono text-xs text-neutral-200 focus:outline-none custom-scrollbar"
              />

              <div className="flex items-center justify-between gap-3 pt-2">
                <div className="text-xs text-neutral-400">
                  Нажмите кнопку ниже для отправки звукорежиссеру в личные сообщения или Telegram
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyReport}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                      hasCopiedReport
                        ? 'bg-emerald-600 text-white shadow-emerald-500/20'
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20'
                    }`}
                  >
                    {hasCopiedReport ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    <span>{hasCopiedReport ? 'Скопировано!' : 'Скопировать текст отчета'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSoundEngineerModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                  >
                    Закрыть
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Log Inspector Modal */}
      {isLogModalOpen && activeReport && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden text-neutral-200">
            <div className="p-5 border-b border-neutral-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-purple-600/20 text-purple-400">
                  <Terminal className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Протокол автоматического QA сканирования</h3>
                  <p className="text-xs text-neutral-400">
                    Технический лог распознавания Whisper, анализа росписи и фильтрации шумов
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsLogModalOpen(false)}
                className="p-1 text-neutral-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Filter stages */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-neutral-400">Фильтр этапа:</span>
                  {[
                    { id: 'all', label: 'Все записи' },
                    { id: 'whisper', label: 'Whisper AI' },
                    { id: 'audio', label: 'Детектор звука' },
                    { id: 'error', label: 'Ошибки' }
                  ].map(f => (
                    <button
                      key={f.id}
                      onClick={() => setLogFilterStage(f.id as any)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                        logFilterStage === f.id
                          ? 'bg-purple-600 text-white'
                          : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={async () => {
                    const text = activeReport.logs?.map(l => `[${l.timestamp}] [${l.stage}] [${l.level}] ${l.message}`).join('\n') || '';
                    await safeCopyToClipboard(text);
                    setCopiedLogs(true);
                    toast.success('Лог сканирования скопирован!');
                    setTimeout(() => setCopiedLogs(false), 2000);
                  }}
                  className="px-3 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-semibold text-neutral-200 flex items-center gap-1.5"
                >
                  {copiedLogs ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedLogs ? 'Скопировано' : 'Скопировать лог'}</span>
                </button>
              </div>

              {/* Log List */}
              <div className="h-96 bg-neutral-950 border border-neutral-800 rounded-xl p-4 font-mono text-xs overflow-y-auto space-y-1.5 custom-scrollbar">
                {(activeReport.logs || []).filter(l => {
                  if (logFilterStage === 'whisper') return l.stage === 'whisper';
                  if (logFilterStage === 'audio') return l.stage === 'audio' || l.stage === 'speech';
                  if (logFilterStage === 'error') return l.level === 'error' || l.level === 'warn';
                  return true;
                }).map((l, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px]">
                    <span className="text-neutral-500 shrink-0">{l.timestamp}</span>
                    <span className={`px-1 rounded text-[9px] font-bold uppercase shrink-0 ${
                      l.level === 'error' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                      l.level === 'warn' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                      'bg-neutral-800 text-neutral-400'
                    }`}>
                      {l.stage}
                    </span>
                    <span className={l.level === 'error' ? 'text-red-300 font-semibold' : l.level === 'warn' ? 'text-amber-200' : 'text-neutral-300'}>
                      {l.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
