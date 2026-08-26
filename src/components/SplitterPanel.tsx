import React, { useState } from "react";
import { Scissors, FileText, Settings2, Loader2, FolderOutput } from "lucide-react";
import { ipcSafe } from "../lib/ipcSafe";
import { Episode } from "../types";
import { sanitizeFolderName } from "../lib/pathUtils";

interface SplitterPanelProps {
  currentEpisode: Episode | null;
}

export default function SplitterPanel({ currentEpisode }: SplitterPanelProps) {
  const [distributeGroups, setDistributeGroups] = useState(false);
  const [distributeMultipleRoles, setDistributeMultipleRoles] = useState(false);
  const [saveSignsInAss, setSaveSignsInAss] = useState(false);
  const [outputFormat, setOutputFormat] = useState<"ass" | "srt">("ass");
  
  const [status, setStatus] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [generatedFiles, setGeneratedFiles] = useState<string[]>([]);
  const [customFilePath, setCustomFilePath] = useState<string | null>(null);

  const targetFilePath = customFilePath || currentEpisode?.subPath;

  const handleSelectFile = async () => {
    try {
      const result = await ipcSafe.invoke('select-file', {
        title: 'Выберите файл субтитров',
        filters: [{ name: 'Subtitles', extensions: ['ass'] }]
      });
      if (result && result.path) {
        setCustomFilePath(result.path);
        setStatus(`Выбран файл: ${result.path.split(/[\\/]/).pop()}`);
      }
    } catch (error: any) {
      if (error && error.message !== 'Selection canceled') {
        console.error("File selection error:", error);
      }
    }
  };

  const handleSplit = async () => {
    if (!targetFilePath) {
      setStatus("Файл субтитров не найден.");
      return;
    }

    setIsProcessing(true);
    setStatus("Разделение субтитров...");
    setGeneratedFiles([]);
    try {
      const config = await ipcSafe.invoke('get-config');
      const baseDir = config.baseDir || '';
      
      let outputDirectory = '';
      if (customFilePath) {
        // If custom file, save next to it in a folder
        const pathParts = customFilePath.split(/[/\\]/);
        const fileName = pathParts.pop() || '';
        const dir = pathParts.join('/');
        outputDirectory = `${dir}/Subtitles_by_Actor`;
      } else {
        const projectTitle = sanitizeFolderName(currentEpisode?.project?.title || "Project");
        const episodeFolder = sanitizeFolderName(`Episode_${currentEpisode?.number || "0"}`);
        const subDir = `${projectTitle}/${episodeFolder}/Subtitles_by_Actor`;
        outputDirectory = `${baseDir}/${subDir}`;
      }

      const options = {
        distributeGroups,
        distributeMultipleRoles,
        saveSignsInAss,
        outputFormat
      };

      const result = await ipcSafe.invoke('split-subs-by-actor', {
        assFilePath: targetFilePath,
        outputDirectory,
        options
      });

      if (result && result.generatedFiles) {
        setGeneratedFiles(result.generatedFiles);
        setStatus(`Успешно создано файлов: ${result.generatedFiles.length}`);
      } else {
        setStatus("Ошибка при разделении субтитров.");
      }
    } catch (error) {
      console.error("Split error:", error);
      setStatus("Ошибка при разделении субтитров.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1 overflow-y-auto min-h-0 pb-4 pr-2">
      <div className="lg:col-span-1 space-y-6">
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-400" />
            Файл субтитров
          </h2>
          <div className="space-y-4">
            <div className="p-3 bg-neutral-950 border border-neutral-800 rounded-lg">
              <p className="text-sm text-neutral-300 break-all">
                {targetFilePath ? (targetFilePath.split(/[/\\]/).pop() || targetFilePath) : "Файл не выбран"}
              </p>
            </div>
            <button
              onClick={handleSelectFile}
              className="w-full px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg font-medium transition-colors border border-neutral-700"
            >
              Выбрать другой файл
            </button>
          </div>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-indigo-400" />
            Настройки
          </h2>

          <div className="space-y-4">
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className="relative flex items-center justify-center w-5 h-5 border border-neutral-600 rounded bg-neutral-950 group-hover:border-indigo-500 transition-colors">
                <input
                  type="checkbox"
                  className="absolute opacity-0 cursor-pointer"
                  checked={distributeGroups}
                  onChange={(e) => setDistributeGroups(e.target.checked)}
                />
                {distributeGroups && (
                  <div className="w-3 h-3 bg-indigo-500 rounded-sm" />
                )}
              </div>
              <span className="text-sm text-neutral-300 group-hover:text-white transition-colors">
                Распределять строки 'гуры/все'
              </span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer group">
              <div className="relative flex items-center justify-center w-5 h-5 border border-neutral-600 rounded bg-neutral-950 group-hover:border-indigo-500 transition-colors">
                <input
                  type="checkbox"
                  className="absolute opacity-0 cursor-pointer"
                  checked={distributeMultipleRoles}
                  onChange={(e) => setDistributeMultipleRoles(e.target.checked)}
                />
                {distributeMultipleRoles && (
                  <div className="w-3 h-3 bg-indigo-500 rounded-sm" />
                )}
              </div>
              <span className="text-sm text-neutral-300 group-hover:text-white transition-colors">
                Распределять множественные роли
              </span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer group">
              <div className="relative flex items-center justify-center w-5 h-5 border border-neutral-600 rounded bg-neutral-950 group-hover:border-indigo-500 transition-colors">
                <input
                  type="checkbox"
                  className="absolute opacity-0 cursor-pointer"
                  checked={saveSignsInAss}
                  onChange={(e) => setSaveSignsInAss(e.target.checked)}
                />
                {saveSignsInAss && (
                  <div className="w-3 h-3 bg-indigo-500 rounded-sm" />
                )}
              </div>
              <span className="text-sm text-neutral-300 group-hover:text-white transition-colors">
                Сохранять надписи в .ass
              </span>
            </label>

            <div className="pt-4 border-t border-neutral-800">
              <label className="block text-sm font-medium text-neutral-400 mb-2">
                Формат сохранения
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="outputFormat"
                    value="ass"
                    checked={outputFormat === "ass"}
                    onChange={() => setOutputFormat("ass")}
                    className="text-indigo-500 bg-neutral-900 border-neutral-700"
                  />
                  <span className="text-sm text-white">.ass</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="outputFormat"
                    value="srt"
                    checked={outputFormat === "srt"}
                    onChange={() => setOutputFormat("srt")}
                    className="text-indigo-500 bg-neutral-900 border-neutral-700"
                  />
                  <span className="text-sm text-white">.srt</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl">
          <button
            onClick={handleSplit}
            disabled={isProcessing || !targetFilePath}
            className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
          >
            {isProcessing ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Scissors className="w-5 h-5" />
            )}
            {isProcessing ? "Обработка..." : "Запустить разделение"}
          </button>
          
          {status && (
            <p className="mt-4 text-sm text-neutral-400 text-center">{status}</p>
          )}
        </div>
      </div>

      <div className="lg:col-span-2">
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl h-full min-h-[400px]">
          <h2 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
            <FolderOutput className="w-5 h-5 text-indigo-400" />
            Результаты
          </h2>

          {generatedFiles.length > 0 ? (
            <div className="space-y-2">
              {generatedFiles.map((file, idx) => (
                <div key={idx} className="flex items-center gap-3 p-3 bg-neutral-950 border border-neutral-800 rounded-lg">
                  <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span className="text-sm text-neutral-300 truncate" title={file}>
                    {file.split('/').pop() || file.split('\\').pop()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-neutral-500">
              <FileText className="w-12 h-12 mb-4 opacity-20" />
              <p>Нажмите "Запустить разделение", чтобы сгенерировать файлы.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
