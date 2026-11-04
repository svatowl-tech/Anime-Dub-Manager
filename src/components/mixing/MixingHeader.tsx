import React from 'react';
import { 
  Sliders, 
  Download, 
  FolderOutput, 
  Upload, 
  Bookmark, 
  Sparkles, 
  RefreshCw, 
  XCircle, 
  Activity, 
  Plus, 
  FolderOpen, 
  Terminal,
  Save,
  Film
} from 'lucide-react';
import { MixingHeaderProps } from './mixing.types';
import { ipcSafe } from '../../lib/ipcSafe';

export const MixingHeader: React.FC<MixingHeaderProps> = ({
  currentEpisode,
  workingDir,
  manifest,
  activeProcessingStepId,
  isAborting,
  isSavingFinalVideo,
  onOpenImportModal,
  onOpenPresetsModal,
  onOpenExternalImportModal,
  onOpenVst3Modal,
  onOpenExportSeModal,
  onOpenAcousticMatchModal,
  onRunAllSteps,
  onAbortProcessing,
  onSaveFinalVideo,
  onRefreshSources,
  onSavePipeline,
  onToggleLogs,
  isLogsOpen,
  unreadLogsCount
}) => {
  return (
    <div className="bg-neutral-900 border-b border-neutral-800 px-6 py-3.5 flex items-center justify-between flex-shrink-0">
      {/* Episode and project badge */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-purple-600/20 text-purple-400 rounded-lg border border-purple-500/30">
          <Sliders className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold text-neutral-100">Сведение видео</h1>
            <span className="text-xs px-2 py-0.5 bg-neutral-800 text-neutral-300 rounded border border-neutral-700">
              Модульный конвейер
            </span>
          </div>
          <p className="text-xs text-neutral-400">
            {currentEpisode ? (
              <>
                <span className="text-blue-400 font-medium">{currentEpisode.project?.title || 'Проект'}</span>
                {' • '}
                <span>Серия #{currentEpisode.number}</span>
                {workingDir && (
                  <span className="text-neutral-500 ml-2 font-mono text-[11px]">({workingDir})</span>
                )}
              </>
            ) : (
              'Серия не выбрана'
            )}
          </p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2.5 flex-wrap justify-end">
        {/* Import from sound engineer / QA */}
        <button
          onClick={onOpenImportModal}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition shadow-sm"
          title="Запустить экспорт звукорежиссеру по проверенной методике и импортировать результат"
        >
          <Download className="w-4 h-4" />
          <span>Импорт звукорежиссера</span>
        </button>

        {/* Export to sound engineer */}
        <button
          onClick={onOpenExportSeModal}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition shadow-sm"
          title="Экспортировать обработанные дорожки из последнего модуля в FLAC + видео с вшитыми субтитрами + общие субтитры"
        >
          <FolderOutput className="w-4 h-4" />
          <span>Экспорт звукорежиссеру</span>
        </button>

        {/* External files */}
        <button
          onClick={onOpenExternalImportModal}
          className="px-3 py-1.5 bg-sky-700 hover:bg-sky-600 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition shadow-sm"
          title="Загрузить внешние видео, субтитры и аудио сторонней серии без создания проекта в базе"
        >
          <Upload className="w-4 h-4" />
          <span>Внешние файлы</span>
        </button>

        {/* Pipeline presets */}
        <button
          onClick={onOpenPresetsModal}
          className="px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-medium flex items-center gap-1.5 transition"
          title="Выбрать или сохранить пресет всей цепочки конвейера"
        >
          <Bookmark className="w-4 h-4 text-amber-400" />
          <span>Пресеты цепочки</span>
        </button>

        {/* Run all steps */}
        <button
          onClick={onRunAllSteps}
          disabled={!manifest?.isImported || activeProcessingStepId !== null}
          className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white rounded-lg text-xs font-medium flex items-center gap-2 transition"
          title="Выполнить все активные шаги конвейера по порядку"
        >
          {activeProcessingStepId === 'all' ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4 text-purple-200" />
          )}
          <span>Свести цепочку</span>
        </button>

        {/* Abort processing button */}
        {activeProcessingStepId !== null && (
          <button
            onClick={onAbortProcessing}
            disabled={isAborting}
            className="px-3.5 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition shadow-md animate-pulse border border-red-400/50"
            title="Немедленно прервать выполнение текущего шага или всей цепочки сведения"
          >
            <XCircle className="w-4 h-4" />
            <span>{isAborting ? 'Остановка...' : 'Остановить сведение'}</span>
          </button>
        )}

        {/* Acoustic Matcher button */}
        <button
          onClick={onOpenAcousticMatchModal}
          className="px-3 py-1.5 bg-sky-950/60 hover:bg-sky-900/60 text-sky-200 border border-sky-700/60 rounded-lg text-xs font-medium flex items-center gap-1.5 transition shadow-sm"
          title="Аналитический модуль: 3 Акустических слепка оригинала (Громкость, Реверб, EQ)"
        >
          <Activity className="w-4 h-4 text-sky-400" />
          <span>Слепок оригинала</span>
        </button>

        {/* Save final video button */}
        {manifest?.finalVideo && (
          <button
            onClick={onSaveFinalVideo}
            disabled={isSavingFinalVideo}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition shadow-sm"
            title="Экспортировать готовый релиз серии в файл"
          >
            <Film className="w-4 h-4" />
            <span>{isSavingFinalVideo ? 'Сохранение...' : 'Сохранить видео'}</span>
          </button>
        )}

        {/* Open working directory in file explorer */}
        {workingDir && (
          <button
            onClick={() => {
              ipcSafe.invoke('mixing-open-folder', { folderPath: workingDir }).catch(() => {});
            }}
            className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs transition"
            title="Открыть папку сведения в проводнике"
          >
            <FolderOpen className="w-4 h-4" />
          </button>
        )}

        {/* Logs Drawer Toggle */}
        <button
          onClick={onToggleLogs}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition border ${
            isLogsOpen 
              ? 'bg-purple-950/60 text-purple-300 border-purple-500/50 shadow-sm' 
              : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border-neutral-700'
          }`}
          title="Открыть / закрыть интерактивную консоль логирования сведения"
        >
          <Terminal className="w-4 h-4 text-purple-400" />
          <span>Консоль</span>
          {unreadLogsCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-600 text-white font-mono font-bold">
              {unreadLogsCount}
            </span>
          )}
        </button>

        {/* Refresh sources */}
        <button
          onClick={onRefreshSources}
          className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs transition"
          title="Обновить состояние файлов"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
