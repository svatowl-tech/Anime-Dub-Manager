import React from "react";
import { X, MessageSquare } from "lucide-react";
import { Episode } from "../../types";
import { ExportModal } from "../ExportModal";

interface AssEditorModalsProps {
  isExportModalOpen: boolean;
  setIsExportModalOpen: (val: boolean) => void;
  currentEpisode: Episode | null;
  exportRole: 'DABBER' | 'SOUND_ENGINEER';
  handleExport: (targetDir: string, skipConversion: boolean, smartExport?: boolean, uploadToYandex?: boolean, additionalProcessing?: boolean) => void;
  isExporting: boolean;
  exportProgress: number;
  isMessageModalOpen: boolean;
  setIsMessageModalOpen: (val: boolean) => void;
  generatedMessage: string;
  setStatus: (status: string) => void;
}

export default function AssEditorModals({
  isExportModalOpen,
  setIsExportModalOpen,
  currentEpisode,
  exportRole,
  handleExport,
  isExporting,
  exportProgress,
  isMessageModalOpen,
  setIsMessageModalOpen,
  generatedMessage,
  setStatus
}: AssEditorModalsProps) {
  return (
    <>
      {isExportModalOpen && currentEpisode && (
        <ExportModal 
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          episode={currentEpisode}
          role={exportRole}
          onExport={handleExport}
          isExporting={isExporting}
          progress={exportProgress}
        />
      )}
      {isMessageModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/50">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-blue-400" />
                Сгенерированное сообщение
              </h3>
              <button 
                onClick={() => setIsMessageModalOpen(false)}
                className="text-neutral-500 hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              <textarea
                readOnly
                value={generatedMessage}
                className="w-full h-64 bg-neutral-950 border border-neutral-800 rounded-xl p-4 text-neutral-300 font-mono text-sm focus:outline-none focus:border-blue-500 resize-none"
              />
            </div>
            <div className="p-4 border-t border-neutral-800 bg-neutral-950/50 flex gap-3">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generatedMessage);
                  setStatus("Сообщение скопировано в буфер обмена!");
                }}
                className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                Копировать
              </button>
              <button
                onClick={() => setIsMessageModalOpen(false)}
                className="flex-1 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg font-medium transition-colors"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
