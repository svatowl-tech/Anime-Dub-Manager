import React from "react";
import {
  Sliders, Play, Volume2, FolderOpen, Download, CheckCircle2, Clock, FileAudio,
  Film, FileText, Sparkles, Layers, Save, RefreshCw, Plus, Trash2, Check,
  Bookmark, Upload, Zap, Folder, Activity, X
} from "lucide-react";
import { toast } from "sonner";
import { MixingManifest, MixingModuleDef, PipelinePreset } from "../../types";
import { ipcSafe } from "../../lib/ipcSafe";

export interface MixingModalsProps {
  isImportModalOpen: boolean;
  setIsImportModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  importSource: "qa" | "timing";
  setImportSource: React.Dispatch<React.SetStateAction<"qa" | "timing">>;
  importAutoTiming: boolean;
  setImportAutoTiming: React.Dispatch<React.SetStateAction<boolean>>;
  customTargetDir: string;
  setCustomTargetDir: React.Dispatch<React.SetStateAction<string>>;
  workingDir: string;
  mixLog: (level: "info" | "warn" | "error" | "debug" | "success", tag: string, message: string, meta?: any, stepId?: string) => void;
  importAutoFixes: boolean;
  setImportAutoFixes: React.Dispatch<React.SetStateAction<boolean>>;
  importSubtitles: boolean;
  setImportSubtitles: React.Dispatch<React.SetStateAction<boolean>>;
  isImporting: boolean;
  importProgress: number;
  importStatusMessage: string;
  handleImportSoundEngineerFiles: () => void;
  isAddModuleModalOpen: boolean;
  setIsAddModuleModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  moduleDatabase: MixingModuleDef[];
  handleAddModuleFromDatabase: (modDef: MixingModuleDef) => void;
  isPipelinePresetsModalOpen: boolean;
  setIsPipelinePresetsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isLoadingPresets: boolean;
  pipelinePresets: PipelinePreset[];
  handleApplyPipelinePreset: (preset: PipelinePreset) => void;
  handleDeletePipelinePreset: (presetId: string, e: React.MouseEvent) => void;
  getModuleMeta: (moduleId: string) => MixingModuleDef | undefined;
  setIsSavePresetModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isSavePresetModalOpen: boolean;
  newPresetName: string;
  setNewPresetName: React.Dispatch<React.SetStateAction<string>>;
  newPresetDesc: string;
  setNewPresetDesc: React.Dispatch<React.SetStateAction<string>>;
  manifest: MixingManifest | null;
  handleSaveCurrentPipelineAsPreset: () => void;
  isExternalImportModalOpen: boolean;
  setIsExternalImportModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleSelectExternalFile: (type: "video" | "subtitles" | "audio") => void;
  extVideoPath: string;
  setExtVideoPath: React.Dispatch<React.SetStateAction<string>>;
  extSubPath: string;
  setExtSubPath: React.Dispatch<React.SetStateAction<string>>;
  extAudioPaths: string[];
  setExtAudioPaths: React.Dispatch<React.SetStateAction<string[]>>;
  isSubmittingExternal: boolean;
  handleImportExternalFilesSubmit: () => void;
  isAcousticMatchModalOpen: boolean;
  setIsAcousticMatchModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  origVocalsError: string | null;
  setOrigVocalsError: React.Dispatch<React.SetStateAction<string | null>>;
  origVocalsPath: string;
  setOrigVocalsPath: React.Dispatch<React.SetStateAction<string>>;
  runAnalyzeOriginalAcoustics: (audioPath: string) => void;
  isAnalyzingAcoustics: boolean;
  ourVocalsError: string | null;
  setOurVocalsError: React.Dispatch<React.SetStateAction<string | null>>;
  ourVocalsPath: string;
  setOurVocalsPath: React.Dispatch<React.SetStateAction<string>>;
  acousticProfile: any;
  selectedEffectFilter: string;
  setSelectedEffectFilter: React.Dispatch<React.SetStateAction<string>>;
  handleSeek: (time: number) => void;
  loudnessStrength: number;
  setLoudnessStrength: React.Dispatch<React.SetStateAction<number>>;
  reverbStrength: number;
  setReverbStrength: React.Dispatch<React.SetStateAction<number>>;
  eqStrength: number;
  setEqStrength: React.Dispatch<React.SetStateAction<number>>;
  targetLufsOffset: number;
  setTargetLufsOffset: React.Dispatch<React.SetStateAction<number>>;
  acousticMatchResult: any;
  handleAddAcousticModuleToPipeline: () => void;
  handleApplyAcousticProfileMatch: () => void;
  isApplyingAcousticMatch: boolean;
}

export const MixingModals: React.FC<MixingModalsProps> = ({
  isImportModalOpen,
  setIsImportModalOpen,
  importSource,
  setImportSource,
  importAutoTiming,
  setImportAutoTiming,
  customTargetDir,
  setCustomTargetDir,
  workingDir,
  mixLog,
  importAutoFixes,
  setImportAutoFixes,
  importSubtitles,
  setImportSubtitles,
  isImporting,
  importProgress,
  importStatusMessage,
  handleImportSoundEngineerFiles,
  isAddModuleModalOpen,
  setIsAddModuleModalOpen,
  moduleDatabase,
  handleAddModuleFromDatabase,
  isPipelinePresetsModalOpen,
  setIsPipelinePresetsModalOpen,
  isLoadingPresets,
  pipelinePresets,
  handleApplyPipelinePreset,
  handleDeletePipelinePreset,
  getModuleMeta,
  setIsSavePresetModalOpen,
  isSavePresetModalOpen,
  newPresetName,
  setNewPresetName,
  newPresetDesc,
  setNewPresetDesc,
  manifest,
  handleSaveCurrentPipelineAsPreset,
  isExternalImportModalOpen,
  setIsExternalImportModalOpen,
  handleSelectExternalFile,
  extVideoPath,
  setExtVideoPath,
  extSubPath,
  setExtSubPath,
  extAudioPaths,
  setExtAudioPaths,
  isSubmittingExternal,
  handleImportExternalFilesSubmit,
  isAcousticMatchModalOpen,
  setIsAcousticMatchModalOpen,
  origVocalsError,
  setOrigVocalsError,
  origVocalsPath,
  setOrigVocalsPath,
  runAnalyzeOriginalAcoustics,
  isAnalyzingAcoustics,
  ourVocalsError,
  setOurVocalsError,
  ourVocalsPath,
  setOurVocalsPath,
  acousticProfile,
  selectedEffectFilter,
  setSelectedEffectFilter,
  handleSeek,
  loudnessStrength,
  setLoudnessStrength,
  reverbStrength,
  setReverbStrength,
  eqStrength,
  setEqStrength,
  targetLufsOffset,
  setTargetLufsOffset,
  acousticMatchResult,
  handleAddAcousticModuleToPipeline,
  handleApplyAcousticProfileMatch,
  isApplyingAcousticMatch,
}) => {
  return (
    <>
      {/* Modal: Import Sound Engineer Files */}
      {isImportModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-blue-600/20 text-blue-400 rounded-lg">
                  <Download className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-neutral-100">Импорт файлов звукорежиссера</h2>
                  <p className="text-xs text-neutral-400">Экспорт по методике QA-проверки прямо в папку сведения</p>
                </div>
              </div>
              <button 
                onClick={() => setIsImportModalOpen(false)}
                className="text-neutral-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {/* Source Selector */}
              <div>
                <label className="text-neutral-300 font-medium block mb-1">
                  Источник материалов для сведения:
                </label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-neutral-950 rounded-xl border border-neutral-800">
                  <button
                    type="button"
                    onClick={() => {
                      setImportSource('timing');
                      setImportAutoTiming(false);
                    }}
                    className={`py-2 px-3 rounded-lg font-medium flex items-center justify-center gap-2 transition ${
                      importSource === 'timing' 
                        ? 'bg-amber-600/20 text-amber-300 border border-amber-500/40' 
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    <span>Из Тайминга видео</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setImportSource('qa');
                      setImportAutoTiming(true);
                    }}
                    className={`py-2 px-3 rounded-lg font-medium flex items-center justify-center gap-2 transition ${
                      importSource === 'qa' 
                        ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40' 
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    <Activity className="w-3.5 h-3.5 text-blue-400" />
                    <span>Из QA-проверки</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="text-neutral-300 font-medium block mb-1">
                  Целевая папка сведения:
                </label>
                <div className="flex gap-2">
                  <input 
                    type="text"
                    value={customTargetDir}
                    onChange={(e) => setCustomTargetDir(e.target.value)}
                    placeholder={workingDir || "По умолчанию: папка Сведения в папке серии"}
                    className="flex-1 px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-neutral-200 font-mono text-xs focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const selected = await ipcSafe.invoke('select-directory');
                        if (selected) {
                          setCustomTargetDir(selected);
                          mixLog('info', 'Папка', `Выбрана целевая папка: ${selected}`);
                        }
                      } catch (err) {}
                    }}
                    className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs transition-colors shrink-0 flex items-center gap-1.5"
                    title="Выбрать папку на диске"
                  >
                    <Folder className="w-3.5 h-3.5" />
                    <span>Обзор...</span>
                  </button>
                </div>
                {workingDir && !customTargetDir && (
                  <p className="text-[10px] text-neutral-400 mt-1 font-mono truncate">
                    Папка по умолчанию: {workingDir}
                  </p>
                )}
              </div>

              <div className="p-3 bg-neutral-950 rounded-lg border border-neutral-800 space-y-2.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="checkbox"
                    checked={importAutoTiming}
                    onChange={(e) => setImportAutoTiming(e.target.checked)}
                    className="rounded accent-blue-500"
                  />
                  <span>Включить автоматический автотайминг поверх импорта</span>
                </label>
                <p className="text-[10px] text-neutral-500 ml-5 -mt-1">
                  {importSource === 'timing' 
                    ? 'При импорте из Тайминга рекомендуется оставить выключенным, чтобы сохранить ручные правки.' 
                    : 'Автоматически подогнать фразы к таймингам субтитров ASS.'}
                </p>

                <label className="flex items-center gap-2 cursor-pointer pt-1">
                  <input 
                    type="checkbox"
                    checked={importAutoFixes}
                    onChange={(e) => setImportAutoFixes(e.target.checked)}
                    className="rounded accent-blue-500"
                  />
                  <span>Бесшовное вшитие фиксов и очистка хвостов реплик</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="checkbox"
                    checked={importSubtitles}
                    onChange={(e) => setImportSubtitles(e.target.checked)}
                    className="rounded accent-blue-500"
                  />
                  <span>Экспорт размеченных субтитров с ролями для звукорежиссера</span>
                </label>
              </div>

              {isImporting && (
                <div className="space-y-1.5 pt-2">
                  <div className="w-full bg-neutral-800 h-2 rounded-full overflow-hidden">
                    <div 
                      className="bg-blue-500 h-full transition-all duration-300"
                      style={{ width: `${importProgress || 15}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-blue-400 font-mono text-center">
                    {importStatusMessage || 'Импорт материалов...'}
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                onClick={() => setIsImportModalOpen(false)}
                disabled={isImporting}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-medium transition"
              >
                Отмена
              </button>
              <button
                onClick={handleImportSoundEngineerFiles}
                disabled={isImporting}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium flex items-center gap-2 transition"
              >
                {isImporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                <span>Начать импорт</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Module Database (Add Module to Pipeline) */}
      {isAddModuleModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-purple-600/20 text-purple-400 rounded-lg">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-neutral-100">База модулей сведения</h2>
                  <p className="text-xs text-neutral-400">Выберите модуль для добавления в активный конвейер</p>
                </div>
              </div>
              <button 
                onClick={() => setIsAddModuleModalOpen(false)}
                className="text-neutral-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
              {moduleDatabase.map((modDef) => {
                const isUltimate = (modDef as any).isUltimate || ['voice_master_strip', 'ultimate_denoiser', 'ultimate_dereverb', 'ultimate_separation', 'ultimate_loudness'].includes(modDef.id);
                const isStandaloneFfmpeg = modDef.id.startsWith('ffmpeg_');
                return (
                  <div
                    key={modDef.id}
                    className={`p-3.5 border rounded-xl flex items-center justify-between gap-3 transition ${
                      isUltimate 
                        ? 'bg-purple-950/30 hover:bg-purple-900/40 border-purple-800/70 shadow-md'
                        : isStandaloneFfmpeg
                          ? 'bg-cyan-950/25 hover:bg-cyan-900/35 border-cyan-800/60'
                          : 'bg-neutral-950/60 hover:bg-neutral-800/60 border-neutral-800'
                    }`}
                  >
                    <div className="space-y-1 truncate">
                      <div className="flex items-center gap-2 flex-wrap">
                        {isUltimate && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded border border-amber-500/40 tracking-wider uppercase flex items-center gap-1">
                            <Sparkles className="w-2.5 h-2.5" />
                            <span>All-In-One</span>
                          </span>
                        )}
                        {isStandaloneFfmpeg && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 bg-cyan-500/20 text-cyan-300 rounded border border-cyan-500/40 tracking-wider uppercase flex items-center gap-1">
                            <Zap className="w-2.5 h-2.5" />
                            <span>FFmpeg Модуль</span>
                          </span>
                        )}
                        <span className={`text-xs font-semibold ${isUltimate ? 'text-purple-200' : isStandaloneFfmpeg ? 'text-cyan-200' : 'text-neutral-100'}`}>
                          {modDef.name || modDef.title}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.2 bg-neutral-800 text-purple-300 font-mono rounded border border-neutral-700">
                          {modDef.defaultPrefix}
                        </span>
                        <span className="text-[10px] text-neutral-500 uppercase">{modDef.category}</span>
                        {modDef.filename && (
                          <span className="text-[10px] px-1.5 py-0.2 bg-purple-950/60 text-purple-300 font-mono rounded border border-purple-800/40">
                            {modDef.filename} ({modDef.size_mb || 28.5} МБ)
                          </span>
                        )}
                        {modDef.presets && (
                          <span className="text-[10px] px-1.5 py-0.2 bg-purple-950/60 text-purple-300 rounded border border-purple-800/50">
                            {modDef.presets.length} пресета
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-neutral-400 leading-relaxed">
                        {modDef.description}
                      </p>
                      {modDef.recommended_for && (
                        <p className="text-[10px] text-amber-400/90 pt-0.5">
                          💡 {modDef.recommended_for}
                        </p>
                      )}
                    </div>

                    <button
                      onClick={() => handleAddModuleFromDatabase(modDef)}
                      className={`px-3 py-1.5 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 shrink-0 transition ${
                        isUltimate ? 'bg-purple-600 hover:bg-purple-500 font-bold shadow-sm' : isStandaloneFfmpeg ? 'bg-cyan-700 hover:bg-cyan-600 font-semibold' : 'bg-neutral-800 hover:bg-neutral-700'
                      }`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Добавить</span>
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end pt-2 border-t border-neutral-800">
              <button
                onClick={() => setIsAddModuleModalOpen(false)}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-medium transition"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Pipeline Presets (Choose or Manage Entire Pipeline Presets) */}
      {isPipelinePresetsModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-600/20 text-amber-400 rounded-lg">
                  <Bookmark className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-neutral-100">Пресеты всей цепочки сведения</h2>
                  <p className="text-xs text-neutral-400">Готовые студийные связки и ваши сохраненные конфигурации конвейера</p>
                </div>
              </div>
              <button 
                onClick={() => setIsPipelinePresetsModalOpen(false)}
                className="text-neutral-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              {isLoadingPresets ? (
                <div className="text-center py-8 text-neutral-500 flex items-center justify-center gap-2 text-xs">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Загрузка пресетов...</span>
                </div>
              ) : pipelinePresets.length === 0 ? (
                <div className="text-center py-8 text-neutral-500 text-xs">
                  Нет доступных пресетов
                </div>
              ) : (
                pipelinePresets.map((preset) => (
                  <div
                    key={preset.id}
                    onClick={() => handleApplyPipelinePreset(preset)}
                    className="p-4 bg-neutral-950/80 hover:bg-neutral-800/80 border border-neutral-800 hover:border-amber-500/60 rounded-xl cursor-pointer transition space-y-2 group"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-xs font-bold text-neutral-100 group-hover:text-amber-300 transition">
                            {preset.name}
                          </h3>
                          {preset.isBuiltIn ? (
                            <span className="text-[10px] px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded">
                              Встроенный
                            </span>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded">
                              Пользовательский
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed">
                          {preset.description || 'Пользовательский пресет конвейера'}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {!preset.isBuiltIn && (
                          <button
                            onClick={(e) => handleDeletePipelinePreset(preset.id, e)}
                            className="p-1.5 text-neutral-500 hover:text-red-400 hover:bg-red-500/10 rounded transition"
                            title="Удалить пресет"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => handleApplyPipelinePreset(preset)}
                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Применить</span>
                        </button>
                      </div>
                    </div>

                    {/* Steps Badge Chain */}
                    <div className="flex flex-wrap gap-1.5 pt-1 border-t border-neutral-800/60">
                      {preset.pipeline.map((step, sIdx) => {
                        const m = getModuleMeta(step.moduleId);
                        return (
                          <span 
                            key={sIdx}
                            className="text-[10px] px-2 py-0.5 bg-neutral-900 text-neutral-300 rounded border border-neutral-800 font-mono"
                          >
                            {sIdx + 1}. {m?.title || step.moduleId}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-neutral-800">
              <button
                onClick={() => {
                  setIsPipelinePresetsModalOpen(false);
                  setIsSavePresetModalOpen(true);
                }}
                className="px-3.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-medium flex items-center gap-1.5 transition"
              >
                <Bookmark className="w-3.5 h-3.5" />
                <span>Сохранить текущую цепочку как новый пресет</span>
              </button>

              <button
                onClick={() => setIsPipelinePresetsModalOpen(false)}
                className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-medium transition"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Save Current Pipeline as Preset */}
      {isSavePresetModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-600/20 text-amber-400 rounded-lg">
                  <Bookmark className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-neutral-100">Сохранить пресет всей цепочки</h2>
                  <p className="text-xs text-neutral-400">Сохраняет порядок всех модулей и текущие значения настроек</p>
                </div>
              </div>
              <button 
                onClick={() => setIsSavePresetModalOpen(false)}
                className="text-neutral-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-neutral-300 font-medium block mb-1">
                  Название пресета:
                </label>
                <input 
                  type="text"
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  placeholder="Мой студийный конвейер 2026"
                  className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-neutral-200 text-xs focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="text-neutral-300 font-medium block mb-1">
                  Описание пресета:
                </label>
                <textarea 
                  value={newPresetDesc}
                  onChange={(e) => setNewPresetDesc(e.target.value)}
                  placeholder="Краткое примечание: для какого типа сериалов, голосов или микрофонов подходит"
                  rows={3}
                  className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-neutral-200 text-xs focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="p-3 bg-neutral-950 rounded-lg border border-neutral-800 text-[11px] text-neutral-400">
                <span>Будет сохранено модулей: </span>
                <span className="font-bold text-amber-400">{manifest?.pipeline?.length || 0}</span>
                <span className="block mt-1 text-neutral-500">
                  Все выставленные параметры модулей (гейт, LUFS, атака, даккинг, битрейт) запомнятся в пресете.
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                onClick={() => setIsSavePresetModalOpen(false)}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-medium transition"
              >
                Отмена
              </button>
              <button
                onClick={handleSaveCurrentPipelineAsPreset}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-medium flex items-center gap-2 transition"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Сохранить пресет</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Import External Files (Standalone / Outside Projects) */}
      {isExternalImportModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-sky-600/20 text-sky-400 rounded-lg">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-neutral-100">Импорт внешних сторонних файлов</h2>
                  <p className="text-xs text-neutral-400">Сведение присланной серии без необходимости создавать проект в базе</p>
                </div>
              </div>
              <button 
                onClick={() => setIsExternalImportModalOpen(false)}
                className="text-neutral-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {/* External Video Selector */}
              <div className="space-y-1">
                <label className="text-neutral-300 font-medium flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-blue-400">
                    <Film className="w-3.5 h-3.5" />
                    Видеофайл серии (MP4 / MKV / MOV):
                  </span>
                  <button
                    onClick={() => handleSelectExternalFile('video')}
                    className="text-[11px] text-blue-400 hover:text-blue-300 underline"
                  >
                    Обзор...
                  </button>
                </label>
                <div className="flex gap-2">
                  <input 
                    type="text"
                    value={extVideoPath}
                    onChange={(e) => setExtVideoPath(e.target.value)}
                    placeholder="Путь к видеофайлу..."
                    className="flex-1 px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-neutral-200 font-mono text-[11px] focus:outline-none focus:border-sky-500"
                  />
                  <button
                    onClick={() => handleSelectExternalFile('video')}
                    className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs"
                  >
                    Выбрать
                  </button>
                </div>
              </div>

              {/* External Subtitles Selector */}
              <div className="space-y-1">
                <label className="text-neutral-300 font-medium flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-indigo-400">
                    <FileText className="w-3.5 h-3.5" />
                    Файл субтитров (ASS / SRT):
                  </span>
                  <button
                    onClick={() => handleSelectExternalFile('subtitles')}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 underline"
                  >
                    Обзор...
                  </button>
                </label>
                <div className="flex gap-2">
                  <input 
                    type="text"
                    value={extSubPath}
                    onChange={(e) => setExtSubPath(e.target.value)}
                    placeholder="Путь к субтитрам для автотайминга..."
                    className="flex-1 px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-neutral-200 font-mono text-[11px] focus:outline-none focus:border-sky-500"
                  />
                  <button
                    onClick={() => handleSelectExternalFile('subtitles')}
                    className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs"
                  >
                    Выбрать
                  </button>
                </div>
              </div>

              {/* External Audio Tracks Selector */}
              <div className="space-y-1">
                <label className="text-neutral-300 font-medium flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <FileAudio className="w-3.5 h-3.5" />
                    Дорожки дабберов (WAV / MP3 / FLAC):
                  </span>
                  <button
                    onClick={() => handleSelectExternalFile('audio')}
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 underline"
                  >
                    Добавить файлы...
                  </button>
                </label>

                {extAudioPaths.length === 0 ? (
                  <div 
                    onClick={() => handleSelectExternalFile('audio')}
                    className="border-2 border-dashed border-neutral-800 hover:border-emerald-600/60 rounded-xl p-4 text-center cursor-pointer transition text-neutral-500"
                  >
                    <Upload className="w-5 h-5 mx-auto mb-1 text-neutral-600" />
                    <span>Нажмите, чтобы выбрать несколько аудиодорожек дабберов</span>
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-32 overflow-y-auto bg-neutral-950 p-2.5 rounded-lg border border-neutral-800">
                    {extAudioPaths.map((ap, aIdx) => (
                      <div key={aIdx} className="flex items-center justify-between text-[11px] font-mono text-neutral-300 bg-neutral-900 px-2.5 py-1 rounded">
                        <span className="truncate max-w-[400px]">{ap}</span>
                        <button
                          onClick={() => setExtAudioPaths(extAudioPaths.filter((_, i) => i !== aIdx))}
                          className="text-neutral-500 hover:text-red-400 ml-2"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2 border-t border-neutral-800">
              <button
                onClick={() => setIsExternalImportModalOpen(false)}
                disabled={isSubmittingExternal}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-medium transition"
              >
                Отмена
              </button>
              <button
                onClick={handleImportExternalFilesSubmit}
                disabled={isSubmittingExternal || (!extVideoPath && !extSubPath && extAudioPaths.length === 0)}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white rounded-lg text-xs font-medium flex items-center gap-2 transition"
              >
                {isSubmittingExternal ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                <span>Импортировать в сведение</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Acoustic Original Effect & Automation Matcher */}
      {isAcousticMatchModalOpen && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-emerald-500/40 rounded-2xl w-full max-w-5xl overflow-hidden shadow-2xl flex flex-col max-h-[94vh]">
            <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between bg-gradient-to-r from-emerald-950/50 via-teal-950/30 to-neutral-900">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-600/20 text-emerald-400 rounded-xl border border-emerald-500/30">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <span>Повторение эффектов оригинала по кривой автоматизации</span>
                    <span className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full font-mono">
                      acoustic_matched v2.0 • 100ms Automation DSP
                    </span>
                  </h2>
                  <p className="text-xs text-neutral-400">
                    Строгий контроль 2-х входов (разделенный вокал оригинала + склеенная дорожка всех голосов), пофразовый детектор эффектов и автоматизация в каждый момент времени
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsAcousticMatchModalOpen(false)}
                className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5 flex-1">
              {/* Блок 1: Строгая двухэтапная проверка входных дорожек */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Вход №1: Разделенная вокальная дорожка оригинала */}
                <div className={`p-4 rounded-xl border ${origVocalsError ? 'bg-red-950/25 border-red-500/50' : 'bg-emerald-950/15 border-emerald-500/30'} space-y-2.5`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-emerald-300">
                      <Volume2 className="w-4 h-4" />
                      1. Вокальная дорожка оригинала (Stem Vocals)
                    </span>
                    <button
                      onClick={async () => {
                        try {
                          const res = await ipcSafe.invoke('mixing-select-external-files', { type: 'audio' });
                          if (!res.canceled && res.filePaths?.[0]) {
                            setOrigVocalsPath(res.filePaths[0]);
                            setOrigVocalsError(null);
                            runAnalyzeOriginalAcoustics(res.filePaths[0]);
                          }
                        } catch (e) {}
                      }}
                      className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-[11px] font-medium border border-neutral-700 transition flex items-center gap-1"
                    >
                      <FolderOpen className="w-3 h-3" />
                      <span>Выбрать 01_vocals.wav...</span>
                    </button>
                  </div>

                  {origVocalsError ? (
                    <div className="text-xs text-red-300 bg-red-950/50 p-3 rounded-lg border border-red-500/30 whitespace-pre-line leading-relaxed">
                      {origVocalsError}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between bg-neutral-950 px-3 py-2 rounded-lg border border-emerald-500/30">
                        <span className="text-xs font-mono text-emerald-300 truncate" title={origVocalsPath}>
                          ✓ {origVocalsPath || 'Ожидание...'}
                        </span>
                        {origVocalsPath && (
                          <button
                            onClick={() => runAnalyzeOriginalAcoustics(origVocalsPath)}
                            disabled={isAnalyzingAcoustics}
                            className="ml-2 px-2 py-0.5 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 rounded text-[10px] border border-emerald-500/30 shrink-0 transition"
                          >
                            Переанализировать
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-neutral-400">
                        Проверка пройдена: исходное аудио из видео разделено на стемы, выделен чистый вокал оригинала.
                      </p>
                    </div>
                  )}
                </div>

                {/* Вход №2: Склеенная дорожка всех голосов дабберов */}
                <div className={`p-4 rounded-xl border ${ourVocalsError ? 'bg-red-950/25 border-red-500/50' : 'bg-purple-950/15 border-purple-500/30'} space-y-2.5`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-purple-300">
                      <Sliders className="w-4 h-4" />
                      2. Склеенная дорожка всех голосов (voices_master)
                    </span>
                    <button
                      onClick={async () => {
                        try {
                          const res = await ipcSafe.invoke('mixing-select-external-files', { type: 'audio' });
                          if (!res.canceled && res.filePaths?.[0]) {
                            setOurVocalsPath(res.filePaths[0]);
                            setOurVocalsError(null);
                          }
                        } catch (e) {}
                      }}
                      className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-[11px] font-medium border border-neutral-700 transition flex items-center gap-1"
                    >
                      <FolderOpen className="w-3 h-3" />
                      <span>Выбрать voices_master.wav...</span>
                    </button>
                  </div>

                  {ourVocalsError ? (
                    <div className="text-xs text-red-300 bg-red-950/50 p-3 rounded-lg border border-red-500/30 whitespace-pre-line leading-relaxed">
                      {ourVocalsError}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between bg-neutral-950 px-3 py-2 rounded-lg border border-purple-500/30">
                        <span className="text-xs font-mono text-purple-300 truncate" title={ourVocalsPath}>
                          ✓ {ourVocalsPath || 'Не выбрана'}
                        </span>
                      </div>
                      <p className="text-[11px] text-neutral-400">
                        Проверка пройдена: все голоса дабберов склеены в единую мастер-дорожку для синхронной автоматизации.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Блок 2: Результаты полного пофразового и покадрового анализа эффектов оригинала */}
              {isAnalyzingAcoustics ? (
                <div className="p-8 bg-neutral-950 rounded-xl border border-neutral-800 flex flex-col items-center justify-center gap-3">
                  <RefreshCw className="w-7 h-7 text-emerald-400 animate-spin" />
                  <span className="text-sm text-neutral-200 font-medium">
                    Выполняется полный физический пофразовый и покадровый (100 мс) анализ эффектов вокала оригинала...
                  </span>
                  <span className="text-xs text-neutral-500">
                    Измерение телефонных/радио полосовых фильтров, эффекта «за стеной», RT60 реверберации, времени эха/дилэя, стерео-панорамы, перегруза и кривой громкости
                  </span>
                </div>
              ) : acousticProfile ? (
                <div className="space-y-4">
                  {/* Верхние карточки сводной статистики */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div className="p-3.5 bg-neutral-950 rounded-xl border border-neutral-800 space-y-1.5">
                      <div className="text-[11px] font-bold text-amber-400 uppercase flex items-center justify-between">
                        <span>1. Динамика и Фразы</span>
                        <span className="font-mono text-xs bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                          {acousticProfile.phrasesCount || 0} фраз
                        </span>
                      </div>
                      <div className="text-xs text-neutral-300 space-y-1">
                        <div className="flex justify-between">
                          <span className="text-neutral-500">Средний уровень:</span>
                          <span className="font-mono font-semibold text-white">{acousticProfile.overallStats?.integratedLufs} LUFS</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">Пик / LRA:</span>
                          <span className="font-mono text-neutral-200">{acousticProfile.overallStats?.truePeakDb} dBTP / {acousticProfile.overallStats?.loudnessRangeLu} LU</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">Точек автоматизации:</span>
                          <span className="font-mono text-emerald-400">{acousticProfile.framesCount || 0} (шаг 100 мс)</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-3.5 bg-neutral-950 rounded-xl border border-neutral-800 space-y-1.5">
                      <div className="text-[11px] font-bold text-cyan-400 uppercase flex items-center justify-between">
                        <span>2. Пространство и Эхо</span>
                        <span className="font-mono text-xs bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20">
                          RT60 {acousticProfile.overallStats?.avgReverbRt60}c
                        </span>
                      </div>
                      <div className="text-xs text-neutral-300 space-y-1">
                        <div className="flex justify-between">
                          <span className="text-neutral-500">Базовая среда:</span>
                          <span className="font-medium text-cyan-200 truncate max-w-[130px]">{acousticProfile.overallStats?.reverbCategory}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">Фраз с ревербом:</span>
                          <span className="font-mono text-white">{acousticProfile.overallStats?.effectCounts?.reverb_space || 0} шт.</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">Фраз с эхом/дилэем:</span>
                          <span className="font-mono text-cyan-300">{acousticProfile.overallStats?.effectCounts?.echo_delay || 0} шт.</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-3.5 bg-neutral-950 rounded-xl border border-neutral-800 space-y-1.5">
                      <div className="text-[11px] font-bold text-purple-400 uppercase flex items-center justify-between">
                        <span>3. Фильтры и Спецэффекты</span>
                        <span className="font-mono text-xs bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20">
                          {acousticProfile.overallStats?.phrasesWithSpecialEffects || 0} спецфраз
                        </span>
                      </div>
                      <div className="text-xs text-neutral-300 space-y-1">
                        <div className="flex justify-between">
                          <span className="text-neutral-500">Телефон / Рация:</span>
                          <span className="font-mono text-amber-300">{acousticProfile.overallStats?.effectCounts?.telephone || 0} фраз</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">За стеной / Издали:</span>
                          <span className="font-mono text-orange-300">{acousticProfile.overallStats?.effectCounts?.muffled_wall || 0} фраз</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">Панорама / Перегруз:</span>
                          <span className="font-mono text-pink-300">
                            {(acousticProfile.overallStats?.effectCounts?.stereo_pan || 0) + (acousticProfile.overallStats?.effectCounts?.stereo_wide || 0)} / {acousticProfile.overallStats?.effectCounts?.megaphone_dist || 0}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="p-3.5 bg-neutral-950 rounded-xl border border-neutral-800 space-y-1.5">
                      <div className="text-[11px] font-bold text-emerald-400 uppercase flex items-center justify-between">
                        <span>4. 6-Полосный Спектр</span>
                        <span className="font-mono text-[10px] text-neutral-400">Оригинал</span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] font-mono text-neutral-300">
                        <div>Sub: <span className="text-white">{acousticProfile.overallStats?.spectralBandsDb?.lowCut100Hz}dB</span></div>
                        <div>Body: <span className="text-white">{acousticProfile.overallStats?.spectralBandsDb?.warmth250Hz}dB</span></div>
                        <div>Box: <span className="text-white">{acousticProfile.overallStats?.spectralBandsDb?.boxiness500Hz}dB</span></div>
                        <div>Mid: <span className="text-white">{acousticProfile.overallStats?.spectralBandsDb?.nasal1200Hz}dB</span></div>
                        <div>Pres: <span className="text-emerald-300">{acousticProfile.overallStats?.spectralBandsDb?.presence3500Hz}dB</span></div>
                        <div>Air: <span className="text-cyan-300">{acousticProfile.overallStats?.spectralBandsDb?.air10000Hz}dB</span></div>
                      </div>
                    </div>
                  </div>

                  {/* Интерактивный пофразовый инспектор обнаруженных эффектов (как при ручном прослушивании) */}
                  {Array.isArray(acousticProfile.phrases) && acousticProfile.phrases.length > 0 && (
                    <div className="bg-neutral-950 rounded-xl border border-neutral-800 overflow-hidden">
                      <div className="px-4 py-2.5 bg-neutral-900/90 border-b border-neutral-800 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-neutral-200">
                            Пофразовая карта эффектов оригинала ({acousticProfile.phrases.length} фраз)
                          </span>
                          <span className="text-[11px] text-neutral-400">
                            — нажмите на таймкод фразы для мгновенного прослушивания в плеере
                          </span>
                        </div>

                        {/* Фильтры по типам обнаруженных эффектов */}
                        <div className="flex flex-wrap items-center gap-1">
                          {[
                            { id: 'all', label: `Все (${acousticProfile.phrases.length})` },
                            { id: 'special', label: `Со спецэффектами (${acousticProfile.overallStats?.phrasesWithSpecialEffects || 0})` },
                            { id: 'telephone', label: `📞 Телефон/Рация (${acousticProfile.overallStats?.effectCounts?.telephone || 0})` },
                            { id: 'muffled_wall', label: `🚪 За стеной (${acousticProfile.overallStats?.effectCounts?.muffled_wall || 0})` },
                            { id: 'reverb_space', label: `🏛 Реверб (${acousticProfile.overallStats?.effectCounts?.reverb_space || 0})` },
                            { id: 'echo_delay', label: `🌀 Эхо (${acousticProfile.overallStats?.effectCounts?.echo_delay || 0})` }
                          ].map(tab => (
                            <button
                              key={tab.id}
                              onClick={() => setSelectedEffectFilter(tab.id)}
                              className={`px-2 py-0.5 rounded text-[10px] font-medium transition border ${
                                selectedEffectFilter === tab.id
                                  ? 'bg-emerald-600/30 text-emerald-200 border-emerald-500/50'
                                  : 'bg-neutral-800/70 text-neutral-400 border-neutral-700/60 hover:text-neutral-200'
                              }`}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="max-h-56 overflow-y-auto divide-y divide-neutral-800/60">
                        {acousticProfile.phrases
                          .filter((ph: any) => {
                            if (selectedEffectFilter === 'all') return true;
                            if (selectedEffectFilter === 'special') {
                              return Array.isArray(ph.detectedEffects) && ph.detectedEffects.some((e: string) => e !== 'clean_studio');
                            }
                            return Array.isArray(ph.detectedEffects) && ph.detectedEffects.includes(selectedEffectFilter);
                          })
                          .map((ph: any) => {
                            const hasSpecial = Array.isArray(ph.detectedEffects) && ph.detectedEffects.some((e: string) => e !== 'clean_studio');
                            return (
                              <div
                                key={ph.index}
                                className={`px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs hover:bg-neutral-900/60 transition ${
                                  hasSpecial ? 'bg-emerald-950/10' : ''
                                }`}
                              >
                                <div className="flex items-center gap-2.5 min-w-[190px]">
                                  <span className="text-[10px] font-mono text-neutral-500 w-7">#{ph.index}</span>
                                  <button
                                    onClick={() => {
                                      handleSeek(ph.startSec);
                                      toast.info(`Плеер перемотан на фразу #${ph.index} (${ph.startFormatted})`);
                                    }}
                                    className="px-2 py-0.5 bg-neutral-800 hover:bg-emerald-700/40 text-emerald-300 rounded font-mono text-[11px] border border-neutral-700 hover:border-emerald-500/40 transition flex items-center gap-1"
                                    title="Перемотать плеер на эту фразу"
                                  >
                                    <Play className="w-2.5 h-2.5 fill-current" />
                                    <span>{ph.startFormatted} – {ph.endFormatted}</span>
                                  </button>
                                </div>

                                {/* Бейджи обнаруженных эффектов на фразе */}
                                <div className="flex flex-wrap items-center gap-1 flex-1">
                                  {(ph.detectedEffectLabels || []).map((lbl: string, idx: number) => {
                                    const code = ph.detectedEffects?.[idx] || 'clean_studio';
                                    const badgeColor =
                                      code === 'telephone'
                                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                        : code === 'muffled_wall'
                                        ? 'bg-orange-500/20 text-orange-300 border-orange-500/40'
                                        : code === 'reverb_space'
                                        ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                                        : code === 'echo_delay'
                                        ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                                        : code === 'megaphone_dist'
                                        ? 'bg-red-500/20 text-red-300 border-red-500/40'
                                        : code === 'stereo_pan' || code === 'stereo_wide'
                                        ? 'bg-pink-500/20 text-pink-300 border-pink-500/40'
                                        : code === 'whisper_intimate' || code === 'shout_intense'
                                        ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                                        : 'bg-neutral-800 text-neutral-400 border-neutral-700';
                                    return (
                                      <span
                                        key={idx}
                                        className={`px-2 py-0.5 rounded-md text-[10px] font-medium border ${badgeColor}`}
                                      >
                                        {lbl}
                                      </span>
                                    );
                                  })}
                                </div>

                                {/* Точные физические параметры автоматизации для этой фразы */}
                                <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-neutral-400">
                                  <span title="Целевая громкость фразы">
                                    LUFS: <strong className="text-neutral-200">{ph.loudnessLufs}</strong>
                                  </span>
                                  <span title="Полоса пропускания динамических фильтров (HPF .. LPF)">
                                    Фильтр: <strong className="text-amber-300">{ph.hpfCutoffHz}..{ph.lpfCutoffHz} Гц</strong>
                                  </span>
                                  <span title="Время затухания реверберации RT60 и доля Wet">
                                    Rev: <strong className="text-cyan-300">{ph.reverbRt60Sec}с ({Math.round((ph.reverbWetMix || 0) * 100)}%)</strong>
                                  </span>
                                  {ph.echoWetMix > 0.04 && (
                                    <span title="Задержка эха/дилэя и уровень повторов">
                                      Echo: <strong className="text-sky-300">{ph.echoDelayMs}мс ({Math.round(ph.echoWetMix * 100)}%)</strong>
                                    </span>
                                  )}
                                  {(Math.abs(ph.pan || 0) > 0.12 || (ph.stereoWidth || 1) > 1.2) && (
                                    <span title="Стерео-панорама и ширина">
                                      Pan: <strong className="text-pink-300">{ph.pan > 0 ? `R${Math.round(ph.pan * 100)}` : ph.pan < 0 ? `L${Math.round(Math.abs(ph.pan) * 100)}` : 'C'} (W:{ph.stereoWidth}x)</strong>
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {/* Блок 3: Регуляторы глубины кривых автоматизации */}
              <div className="p-4 bg-neutral-950 rounded-xl border border-neutral-800 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-neutral-200 uppercase tracking-wider">
                    Настройка кривых автоматизации обработчиков (Time-Varying Automation Curves)
                  </div>
                  <span className="text-[11px] text-emerald-400 font-mono">
                    Плавная интерполяция каждые 100 мс без щелчков
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-neutral-400">1. Автоматизация громкости, экспрессии и стерео-панорамы:</span>
                      <span className="font-mono text-amber-400 font-bold">{loudnessStrength}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={loudnessStrength}
                      onChange={e => setLoudnessStrength(Number(e.target.value))}
                      className="w-full accent-amber-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-neutral-400">2. Автоматизация пространства (FDN-Реверберация + Stereo Slapback/Delay):</span>
                      <span className="font-mono text-cyan-400 font-bold">{reverbStrength}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={reverbStrength}
                      onChange={e => setReverbStrength(Number(e.target.value))}
                      className="w-full accent-cyan-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-neutral-400">3. Автоматизация фильтров (Телефон / Рация / За стеной / 6-полосный EQ / Перегруз):</span>
                      <span className="font-mono text-purple-400 font-bold">{eqStrength}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={eqStrength}
                      onChange={e => setEqStrength(Number(e.target.value))}
                      className="w-full accent-purple-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-neutral-400">Смещение целевой громкости голосов относительно оригинала:</span>
                      <span className="font-mono text-emerald-400 font-bold">{targetLufsOffset > 0 ? `+${targetLufsOffset}` : targetLufsOffset} dB</span>
                    </div>
                    <input
                      type="range"
                      min={-6}
                      max={6}
                      step={0.5}
                      value={targetLufsOffset}
                      onChange={e => setTargetLufsOffset(Number(e.target.value))}
                      className="w-full accent-emerald-500"
                    />
                  </div>
                </div>
              </div>

              {/* Отчет о примененной автоматизации */}
              {acousticMatchResult && (
                <div className="p-4 bg-emerald-950/30 border border-emerald-500/40 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-300">
                      ✓ Кривые автоматизации эффектов успешно наложены на склеенную дорожку голосов!
                    </span>
                    <span className="text-[11px] font-mono text-emerald-400">
                      {acousticMatchResult.outputPath}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] text-neutral-300 font-mono">
                    <div>Точек кривой: {acousticMatchResult.appliedParameters?.loudnessEnvelope?.automationPointsCount || 0}</div>
                    <div>Базовый Gain: {acousticMatchResult.appliedParameters?.loudnessEnvelope?.gainDeltaDb > 0 ? '+' : ''}{acousticMatchResult.appliedParameters?.loudnessEnvelope?.gainDeltaDb} dB</div>
                    <div>Фраз со спецэффектами: {acousticMatchResult.appliedParameters?.detectedEffectsSummary?.phrasesWithSpecialEffects || 0}</div>
                    <div>Категория среды: {acousticMatchResult.appliedParameters?.reverbSpace?.originalCategory}</div>
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-neutral-800 bg-neutral-950 flex items-center justify-between gap-3">
              <button
                onClick={handleAddAcousticModuleToPipeline}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-emerald-300 rounded-xl text-xs font-semibold border border-emerald-500/30 flex items-center gap-2 transition"
              >
                <Plus className="w-4 h-4" />
                <span>Добавить шаг «acoustic_matched» в конвейер сведения</span>
              </button>

              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => setIsAcousticMatchModalOpen(false)}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-xl text-xs font-medium transition"
                >
                  Закрыть
                </button>
                <button
                  onClick={handleApplyAcousticProfileMatch}
                  disabled={isApplyingAcousticMatch || !origVocalsPath || !ourVocalsPath || !!origVocalsError || !!ourVocalsError}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition shadow-lg shadow-emerald-900/30"
                >
                  {isApplyingAcousticMatch ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Рендеринг кривых автоматизации...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Наложить эффекты по кривой автоматизации сейчас</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
