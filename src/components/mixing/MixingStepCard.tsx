import React from "react";
import {
  Play, Volume2, Download, CheckCircle2, FileAudio, Film, Sparkles, Radio,
  RefreshCw, Settings2, Plus, ShieldCheck, Headphones, ArrowUp, ArrowDown,
  Trash2, Power, Wand2, AlertCircle, XCircle, RotateCcw
} from "lucide-react";
import { MixingManifest, MixingFileItem, PipelineStep, MixingModuleDef, MixingModulePreset } from "../../types";
import { PARAM_SPECS, PARAM_LABELS } from "./mixingParamSpecs";

export interface MixingStepCardProps {
  manifest: MixingManifest | null;
  activeProcessingStepId: string | null;
  expandedSettings: Record<string, boolean>;
  setExpandedSettings: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  expandedTracks: Record<string, boolean>;
  setExpandedTracks: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  stepProgress: Record<string, number>;
  selectedAudioTrack: any;
  isDownloadingUvrModel: boolean;
  uvrDownloadPercent: number;
  getModuleMeta: (moduleId: string) => MixingModuleDef | undefined;
  selectModuleMixForInspection: (step: PipelineStep) => void;
  selectTrackForInspection: (item: MixingFileItem, label: string, stepId?: string) => void;
  handleClearStep: (stepId: string, singleFilePath?: string) => void;
  handleMoveStepUp: (index: number) => void;
  handleMoveStepDown: (index: number) => void;
  handleToggleStep: (index: number) => void;
  handleDeleteStep: (index: number) => void;
  handleAbortProcessing: () => void;
  handleRunStep: (stepId: string) => void;
  handleUpdateStepTracks: (stepId: string, action: "toggle_exclude" | "clear_exclusions" | "add_custom" | "remove_custom", trackKey?: string, trackPaths?: string[]) => void;
  handleAddCustomTrackToStep: (stepId: string) => void;
  handleDownloadUvrModel: (targetModelId?: string) => void;
  handleApplyPreset: (stepId: string, preset: MixingModulePreset) => void;
  handleUpdateStepParams: (stepId: string, paramKey: string, value: any) => void;
}

export const MixingStepList: React.FC<MixingStepCardProps> = ({
  manifest,
  activeProcessingStepId,
  expandedSettings,
  setExpandedSettings,
  expandedTracks,
  setExpandedTracks,
  stepProgress,
  selectedAudioTrack,
  isDownloadingUvrModel,
  uvrDownloadPercent,
  getModuleMeta,
  selectModuleMixForInspection,
  selectTrackForInspection,
  handleClearStep,
  handleMoveStepUp,
  handleMoveStepDown,
  handleToggleStep,
  handleDeleteStep,
  handleAbortProcessing,
  handleRunStep,
  handleUpdateStepTracks,
  handleAddCustomTrackToStep,
  handleDownloadUvrModel,
  handleApplyPreset,
  handleUpdateStepParams,
}) => {
  return (
    <div className="space-y-3">
              {(manifest?.pipeline || []).map((step, idx) => {
                const meta = getModuleMeta(step.moduleId);
                const isProcessing = activeProcessingStepId === step.stepId;
                const isExpanded = !!expandedSettings[step.stepId];
                const isComplete = step.status === 'completed';

                return (
                  <div 
                    key={step.stepId}
                    className={`bg-neutral-900/90 border rounded-xl p-3.5 space-y-3 shadow-sm transition ${
                      step.enabled 
                        ? (isComplete ? 'border-emerald-800/40 hover:border-emerald-700/60' : 'border-neutral-800 hover:border-neutral-700')
                        : 'border-neutral-800/50 opacity-50 bg-neutral-950/40'
                    }`}
                  >
                    {/* Step Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 ${
                          step.enabled ? 'bg-purple-600/20 text-purple-400' : 'bg-neutral-800 text-neutral-500'
                        }`}>
                          {idx + 1}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-xs font-semibold text-neutral-100">
                              {meta?.title || step.moduleId}
                            </h3>
                            <span className="font-mono text-[10px] px-1.5 py-0.2 bg-neutral-800 text-purple-300 rounded border border-neutral-700">
                              {step.prefix}
                            </span>
                            {meta?.filename && (
                              <span className="text-[10px] px-1.5 py-0.2 bg-purple-950/60 text-purple-300 font-mono rounded border border-purple-800/40">
                                {meta.filename}
                              </span>
                            )}
                            {/* Active model badge for neural dereverb / denoise / separation */}
                            {(step.params?.modelId || step.params?.modelName || step.moduleId === 'uvr_deecho_normal' || step.moduleId === 'uvr_deecho_aggressive' || step.moduleId === 'deepfilternet3') && (
                              <span className="text-[10px] px-2 py-0.5 bg-indigo-950/80 text-indigo-300 font-mono font-semibold rounded-md border border-indigo-700/60 flex items-center gap-1 shadow-sm">
                                <Radio className="w-2.5 h-2.5 text-indigo-400" />
                                <span>
                                  {step.params?.modelId === 'uvr_deecho_aggressive' || step.moduleId === 'uvr_deecho_aggressive'
                                    ? 'UVR De-Echo Aggressive'
                                    : step.params?.modelId === 'uvr_deecho_normal' || step.moduleId === 'uvr_deecho_normal'
                                      ? 'UVR De-Echo Normal'
                                      : step.params?.modelId === 'deepfilternet3' || step.moduleId === 'deepfilternet3'
                                        ? 'DeepFilterNet 3'
                                        : step.params?.modelId === 'reverb_foxjoy'
                                          ? 'Reverb HQ FoxJoy'
                                          : step.params?.modelName || step.params?.modelId || meta?.name || meta?.title}
                                </span>
                              </span>
                            )}
                            {/* Active target profile for voice timbre match */}
                            {step.moduleId === 'voice_timbre_match' && (
                              <span className="text-[10px] px-2 py-0.5 bg-emerald-950/80 text-emerald-300 font-medium rounded-full border border-emerald-700/60 flex items-center gap-1 shadow-sm">
                                <Sparkles className="w-2.5 h-2.5 text-emerald-400" />
                                <span>
                                  {step.params?.targetProfile === 'warm_broadcast'
                                    ? 'Тёплый бродкаст'
                                    : step.params?.targetProfile === 'crisp_anime'
                                      ? 'Прозрачный аниме'
                                      : step.params?.targetProfile === 'gentle_balance'
                                        ? 'Мягкий баланс'
                                        : 'Студийный дубляж'} ({step.params?.matchIntensity ?? 75}%)
                                </span>
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-neutral-400 leading-relaxed mt-0.5">
                            {meta?.description || ''}
                          </p>
                        </div>
                      </div>

                      {/* Step Actions: Listen Module Mix, Tracks, Clear, Up, Down, Settings, Run/Abort, Delete */}
                      <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                        {/* Listen Module Mix */}
                        {step.outputFiles && step.outputFiles.length > 0 && (
                          <button
                            onClick={() => selectModuleMixForInspection(step)}
                            className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition border ${
                              selectedAudioTrack?.id === `module_mix_${step.stepId}`
                                ? 'bg-purple-600 text-white border-purple-400 shadow-md ring-1 ring-purple-400 font-bold'
                                : 'bg-purple-950/70 hover:bg-purple-900/90 text-purple-200 border-purple-800/80 shadow-sm'
                            }`}
                            title="Прослушать в плеере совместный микс всех обработанных этим модулем дорожек"
                          >
                            <Volume2 className="w-3.5 h-3.5 text-purple-300" />
                            <span>Прослушать ({step.outputFiles.length})</span>
                          </button>
                        )}

                        {/* Toggle Step Input Tracks Manager */}
                        {(() => {
                          const candidates = step.candidateInputs || manifest?.sourceFiles?.dubberTracks || [];
                          const activeCount = candidates.filter(t => !t.excluded).length;
                          const hasExclusions = candidates.some(t => t.excluded) || (step.customInputTracks && step.customInputTracks.length > 0);
                          const isTracksOpen = expandedTracks[step.stepId] ?? (idx === 0);
                          return (
                            <button
                              onClick={() => setExpandedTracks(prev => ({ ...prev, [step.stepId]: !isTracksOpen }))}
                              className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition border ${
                                hasExclusions
                                  ? 'bg-amber-950/70 text-amber-300 border-amber-700/70'
                                  : isTracksOpen
                                    ? 'bg-cyan-950/60 text-cyan-300 border-cyan-700/60'
                                    : 'bg-neutral-800/80 hover:bg-neutral-700 text-neutral-300 border-neutral-700'
                              }`}
                              title="Выбрать, какие дорожки обрабатывать в этом шаге (исключить или добавить дорожку)"
                            >
                              <Headphones className="w-3 h-3 text-cyan-400" />
                              <span>Дорожки ({activeCount}/{candidates.length})</span>
                            </button>
                          );
                        })()}

                        {/* Clear Step Output Files */}
                        {((step.outputFiles && step.outputFiles.length > 0) || step.status === 'completed' || step.status === 'error') && (
                          <button
                            onClick={() => handleClearStep(step.stepId)}
                            disabled={activeProcessingStepId !== null}
                            className="px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 bg-neutral-800/80 hover:bg-red-950/70 text-neutral-300 hover:text-red-300 border border-neutral-700 hover:border-red-800/60 transition disabled:opacity-40"
                            title="Очистить шаг: удалить все созданные этим шагом дорожки и сбросить статус"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Очистить шаг</span>
                          </button>
                        )}

                        {/* Move Up */}
                        <button
                          onClick={() => handleMoveStepUp(idx)}
                          disabled={idx === 0}
                          className="p-1 text-neutral-400 hover:text-neutral-200 disabled:opacity-20 transition"
                          title="Переместить модуль вверх по конвейеру"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>

                        {/* Move Down */}
                        <button
                          onClick={() => handleMoveStepDown(idx)}
                          disabled={idx === (manifest?.pipeline?.length || 0) - 1}
                          className="p-1 text-neutral-400 hover:text-neutral-200 disabled:opacity-20 transition"
                          title="Переместить модуль вниз по конвейеру"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>

                        {/* Toggle On/Bypass */}
                        <button
                          onClick={() => handleToggleStep(idx)}
                          className={`p-1 transition ${step.enabled ? 'text-emerald-400 hover:text-emerald-300' : 'text-neutral-600 hover:text-neutral-400'}`}
                          title={step.enabled ? "Отключить шаг (Bypass)" : "Включить шаг"}
                        >
                          <Power className="w-3.5 h-3.5" />
                        </button>

                        {/* Settings */}
                        <button
                          onClick={() => setExpandedSettings(prev => ({ ...prev, [step.stepId]: !prev[step.stepId] }))}
                          className="p-1 text-neutral-400 hover:text-neutral-200 transition"
                          title="Настройки параметров и пресеты"
                        >
                          <Settings2 className="w-3.5 h-3.5" />
                        </button>

                        {/* Delete Step */}
                        <button
                          onClick={() => handleDeleteStep(idx)}
                          className="p-1 text-neutral-500 hover:text-red-400 transition"
                          title="Удалить модуль из конвейера"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>

                        {/* Run Step or Abort Step */}
                        {isProcessing ? (
                          <button
                            onClick={handleAbortProcessing}
                            className="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-bold flex items-center gap-1.5 transition ml-1 shadow"
                            title="Прервать выполнение шага"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Стоп</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleRunStep(step.stepId)}
                            disabled={!manifest?.isImported || !step.enabled || activeProcessingStepId !== null}
                            className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white rounded text-xs font-medium flex items-center gap-1.5 transition ml-1"
                          >
                            <Play className="w-3 h-3 fill-current" />
                            <span>Шаг</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Error Banner if step failed (No Silent Fallback!) */}
                    {step.status === 'error' && step.error && (
                      <div className="p-2.5 bg-red-950/50 border border-red-800/80 rounded-lg text-xs text-red-200 flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-semibold text-red-300 block">Ошибка выполнения модуля (без скрытого фоллбэка):</span>
                            <span className="text-[11px] font-mono break-all">{step.error}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleClearStep(step.stepId)}
                          className="px-2 py-1 bg-red-900/60 hover:bg-red-800 text-red-200 rounded text-[10px] shrink-0 transition"
                        >
                          Сбросить
                        </button>
                      </div>
                    )}

                    {/* Progress Bar */}
                    {isProcessing && (
                      <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
                        <div 
                          className="bg-purple-500 h-full transition-all duration-300"
                          style={{ width: `${stepProgress[step.stepId] || 15}%` }}
                        />
                      </div>
                    )}

                    {/* Per-Step Input Tracks Control Panel */}
                    {(expandedTracks[step.stepId] ?? (idx === 0)) && (
                      <div className="p-2.5 bg-neutral-950/70 rounded-lg border border-neutral-800/90 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-[10px] uppercase font-semibold tracking-wider text-cyan-400 flex items-center gap-1.5">
                            <Headphones className="w-3 h-3" />
                            <span>Входные дорожки для обработки в этом шаге:</span>
                          </span>
                          <div className="flex items-center gap-1.5">
                            {(step.excludedTrackKeys && step.excludedTrackKeys.length > 0) && (
                              <button
                                onClick={() => handleUpdateStepTracks(step.stepId, 'clear_exclusions')}
                                className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 rounded text-[10px] font-medium transition border border-amber-700/40"
                              >
                                Включить все дорожки
                              </button>
                            )}
                            <button
                              onClick={() => handleAddCustomTrackToStep(step.stepId)}
                              className="px-2 py-0.5 bg-cyan-950/70 hover:bg-cyan-900/80 text-cyan-300 rounded text-[10px] font-medium flex items-center gap-1 border border-cyan-800/60 transition"
                              title="Добавить дополнительный аудиофайл с диска в обработку именно этого шага"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Добавить дорожку в шаг</span>
                            </button>
                          </div>
                        </div>

                        {(() => {
                          const candidates = step.candidateInputs || manifest?.sourceFiles?.dubberTracks || [];
                          if (candidates.length === 0) {
                            return (
                              <div className="text-[11px] text-neutral-500 italic py-1">
                                Нет входных дорожек. Импортируйте файлы звукорежиссера или добавьте дорожку вручную.
                              </div>
                            );
                          }
                          return (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1">
                              {candidates.map((cand, cIdx) => {
                                const tKey = cand.trackKey || cand.path || cand.name;
                                const isExcluded = !!cand.excluded;
                                const isInspecting = selectedAudioTrack?.id === cand.path;
                                return (
                                  <div
                                    key={`${tKey}_${cIdx}`}
                                    className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] transition ${
                                      isExcluded
                                        ? 'bg-neutral-950/40 border-neutral-800/50 text-neutral-500 opacity-60'
                                        : isInspecting
                                          ? 'bg-cyan-950/40 border-cyan-600/60 text-cyan-100'
                                          : 'bg-neutral-900/80 border-neutral-800 text-neutral-200 hover:border-neutral-700'
                                    }`}
                                  >
                                    <label className="flex items-center gap-2 truncate cursor-pointer flex-1">
                                      <input
                                        type="checkbox"
                                        checked={!isExcluded}
                                        onChange={() => handleUpdateStepTracks(step.stepId, 'toggle_exclude', tKey)}
                                        className="rounded accent-cyan-500 cursor-pointer shrink-0"
                                        title={isExcluded ? 'Включить дорожку в обработку этого шага' : 'Исключить дорожку из обработки в этом шаге'}
                                      />
                                      <div className="truncate">
                                        <span className={`font-medium ${isExcluded ? 'line-through text-neutral-500' : 'text-neutral-100'}`}>
                                          {cand.dubberNick || cand.name}
                                        </span>
                                        {cand.sourceLabel && (
                                          <span className="text-[9px] text-neutral-400 ml-1.5 px-1 py-0.2 bg-neutral-800 rounded">
                                            {cand.sourceLabel}
                                          </span>
                                        )}
                                      </div>
                                    </label>

                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        onClick={() => selectTrackForInspection(cand, `Вход шага #${idx + 1}: ${cand.dubberNick || cand.name}`, step.stepId)}
                                        className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-emerald-400 rounded text-[10px] transition"
                                        title={`Прослушать входную дорожку: ${cand.name}`}
                                      >
                                        🎧
                                      </button>
                                      {cand.isCustom && (
                                        <button
                                          onClick={() => handleUpdateStepTracks(step.stepId, 'remove_custom', cand.path || tKey)}
                                          className="px-1.5 py-0.5 bg-neutral-800 hover:bg-red-900/70 text-neutral-400 hover:text-red-300 rounded text-[10px] transition"
                                          title="Удалить добавленную вручную дорожку из этого шага"
                                        >
                                          ✕
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Settings & Presets Accordion */}
                    {isExpanded && (
                      <div className="p-3 bg-neutral-950/80 rounded-lg border border-neutral-800 text-xs space-y-3">
                        {/* Voice Timbre Match Visual Equalizer Card */}
                        {step.moduleId === 'voice_timbre_match' && (
                          <div className="p-3 bg-gradient-to-r from-emerald-950/40 via-neutral-900 to-teal-950/30 border border-emerald-800/50 rounded-xl space-y-2.5 shadow-sm">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-2.5">
                                <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg mt-0.5">
                                  <Sparkles className="w-4 h-4" />
                                </div>
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-xs text-neutral-100">
                                      Калибровка АЧХ всех дабберов к единому студийному эталону
                                    </span>
                                    <span className="text-[10px] font-mono px-1.5 py-0.5 bg-emerald-900/60 text-emerald-300 rounded border border-emerald-700/50">
                                      LTAS 32-Band Match EQ
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-neutral-400 leading-snug">
                                    Автоматически анализирует долговременный спектр речи каждого даббера и приводит амплитудно-частотную характеристику к общему эталону, убирая различия микрофонов и комнат.
                                  </p>
                                </div>
                              </div>
                            </div>

                            {/* Spectrum Frequency Bands Map */}
                            <div className="bg-neutral-950/80 p-2.5 rounded-lg border border-neutral-800 space-y-1.5">
                              <div className="flex items-center justify-between text-[10px] text-neutral-400">
                                <span className="font-semibold text-emerald-400">Полосы спектральной калибровки:</span>
                                <span className="font-mono text-neutral-500">Минимально-фазовый 1/3-октавный фильтр</span>
                              </div>
                              <div className="grid grid-cols-4 gap-2 text-[10px] font-mono pt-1">
                                <div className="p-1.5 bg-neutral-900/90 rounded border border-neutral-800 text-center">
                                  <div className="text-neutral-500">&lt; {step.params?.subBassCutoff ?? 75} Гц</div>
                                  <div className="text-emerald-400 font-semibold">Срез инфра-гула</div>
                                </div>
                                <div className="p-1.5 bg-neutral-900/90 rounded border border-neutral-800 text-center">
                                  <div className="text-neutral-500">100 - 400 Гц</div>
                                  <div className="text-emerald-400 font-semibold">Баланс тела голоса</div>
                                </div>
                                <div className="p-1.5 bg-neutral-900/90 rounded border border-neutral-800 text-center">
                                  <div className="text-neutral-500">1.2 - 4.5 кГц</div>
                                  <div className="text-emerald-400 font-semibold">Форманты речи</div>
                                </div>
                                <div className="p-1.5 bg-neutral-900/90 rounded border border-neutral-800 text-center">
                                  <div className="text-neutral-500">&gt; 5 кГц (макс +{step.params?.airLimitDb ?? 3} дБ)</div>
                                  <div className="text-emerald-400 font-semibold">Защита сибилянтов</div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* UVR Model Card */}
                        {Boolean(meta?.engineArchitecture) && (
                          <div className="p-3 bg-neutral-900 border border-purple-800/40 rounded-xl space-y-2.5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-2.5">
                                <div className="p-2 bg-purple-500/20 text-purple-400 rounded-lg mt-0.5">
                                  {step.moduleId === 'voicefixer_fe' ? (
                                    <Sparkles className="w-4 h-4" />
                                  ) : step.moduleId === 'uvr_deecho_normal' ? (
                                    <Radio className="w-4 h-4" />
                                  ) : (
                                    <ShieldCheck className="w-4 h-4" />
                                  )}
                                </div>
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-xs text-neutral-100">
                                      {meta?.name || meta?.title || step.moduleId}
                                    </span>
                                    <span className="text-[10px] font-mono px-1.5 py-0.5 bg-neutral-800 text-purple-300 rounded border border-neutral-700">
                                      {meta?.filename || 'model.pth'} • {meta?.size_mb || 30} МБ
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-neutral-400 leading-snug">
                                    Архитектура: <span className="text-purple-300 font-mono text-[10px]">{meta?.engineArchitecture}</span>
                                    {meta?.category && <span className="text-neutral-500 uppercase ml-2 text-[9px]">({meta.category})</span>}
                                  </p>
                                  <p className="text-[10px] text-amber-400/90 flex items-center gap-1">
                                    <span>💡 Рекомендовано:</span>
                                    <span>{meta?.recommended_for || 'Очистка аудио'}</span>
                                  </p>
                                </div>
                              </div>

                              <div className="shrink-0 flex items-center gap-2">
                                {meta?.is_installed ? (
                                  <span className="text-[11px] text-emerald-400 flex items-center gap-1.5 font-medium bg-emerald-950/40 px-2.5 py-1 rounded-lg border border-emerald-800/40">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    <span>Установлена ({meta.installed_bytes ? (meta.installed_bytes / (1024*1024)).toFixed(1) + ' МБ' : `${meta.size_mb || 30} МБ`})</span>
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => handleDownloadUvrModel(step.moduleId)}
                                    disabled={isDownloadingUvrModel}
                                    className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-neutral-800 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition"
                                  >
                                    {isDownloadingUvrModel ? (
                                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <Download className="w-3.5 h-3.5" />
                                    )}
                                    <span>{isDownloadingUvrModel ? `Загрузка (${uvrDownloadPercent}%)...` : 'Скачать / Активировать модель'}</span>
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Model URLs and info */}
                            <div className="text-[10px] text-neutral-400 bg-neutral-950/70 p-2 rounded-lg border border-neutral-800 space-y-1">
                              <div className="flex items-center justify-between text-neutral-500">
                                <span>Репозитории модели ({meta?.format?.toUpperCase() || 'PTH'} Arch):</span>
                                <span className="font-mono text-[9px]">Формат: {meta?.format || 'pth'}</span>
                              </div>
                              <div className="space-y-0.5 max-h-16 overflow-y-auto">
                                {(meta?.urls || []).map((url, uIdx) => (
                                  <div key={uIdx} className="truncate text-[10px] text-neutral-400 font-mono hover:text-purple-300 transition">
                                    {url}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Presets Bar */}
                        {meta?.presets && meta.presets.length > 0 && (
                          <div className="space-y-1.5 pb-2.5 border-b border-neutral-800">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-purple-400 flex items-center gap-1">
                              <Wand2 className="w-3 h-3" />
                              Готовые студийные пресеты:
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {meta.presets.map((preset) => (
                                <button
                                  key={preset.id}
                                  onClick={() => handleApplyPreset(step.stepId, preset)}
                                  className="px-2.5 py-1 rounded bg-neutral-900 hover:bg-purple-950/50 border border-neutral-800 hover:border-purple-600/60 text-[11px] text-neutral-300 hover:text-purple-200 transition text-left"
                                  title={preset.description || preset.title}
                                >
                                  {preset.title}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Granular Sliders and Controls */}
                        <div className="grid grid-cols-2 gap-3 pt-1">
                          {Object.keys(step.params || {}).map(paramKey => {
                            const val = step.params[paramKey];

                            // Boolean checkbox
                            if (typeof val === 'boolean') {
                              const metaParam = PARAM_LABELS[paramKey];
                              return (
                                <div key={paramKey} className="flex items-center gap-2 pt-2">
                                  <input 
                                    type="checkbox"
                                    checked={val}
                                    onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, e.target.checked)}
                                    className="rounded accent-purple-500 cursor-pointer"
                                  />
                                  <label className="text-[11px] text-neutral-300 cursor-pointer">
                                    {metaParam?.label || paramKey}
                                  </label>
                                </div>
                              );
                            }

                            // String mode select
                            if (paramKey === 'mode') {
                              return (
                                <div key={paramKey} className="col-span-2">
                                  <label className="text-[11px] text-neutral-400 block mb-1">
                                    Алгоритм нормализации / Режим:
                                  </label>
                                  <select
                                    value={val}
                                    onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, e.target.value)}
                                    className="w-full px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs text-neutral-200"
                                  >
                                    <option value="loudnorm">FFmpeg EBU R128 (Двухпроходный Loudnorm)</option>
                                    <option value="dynaudnorm">FFmpeg Динамический левелер (DynAudNorm)</option>
                                    <option value="pyloudnorm">PythonITU-R BS.1770-4 (pyloudnorm)</option>
                                  </select>
                                </div>
                              );
                            }

                            if (paramKey === 'modeType') {
                              return (
                                <div key={paramKey} className="col-span-2">
                                  <label className="text-[11px] text-neutral-400 block mb-1">
                                    Режим измерения и выравнивания (pyloudnorm):
                                  </label>
                                  <select
                                    value={val}
                                    onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, e.target.value)}
                                    className="w-full px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs text-neutral-200"
                                  >
                                    <option value="track">По всей дорожке целиком (Integrated LUFS)</option>
                                    <option value="phrases">Пофразовое выравнивание (RMS / Gate Segmentation)</option>
                                  </select>
                                </div>
                              );
                            }

                            if (paramKey === 'targetProfile') {
                              return (
                                <div key={paramKey} className="col-span-2 space-y-1">
                                  <label className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1.5">
                                    <Sparkles className="w-3.5 h-3.5" />
                                    Целевой студийный профиль АЧХ (Universal Studio Reference):
                                  </label>
                                  <select
                                    value={val}
                                    onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, e.target.value)}
                                    className="w-full px-2.5 py-1.5 bg-neutral-900 border border-emerald-800/60 rounded-lg text-xs text-emerald-200 font-medium focus:ring-1 focus:ring-emerald-500"
                                  >
                                    <option value="studio_neutral">🎯 Нейтральный студийный дубляж (Универсальный эталон)</option>
                                    <option value="warm_broadcast">📻 Тёплый бродкаст (Плотный бархатный низ)</option>
                                    <option value="crisp_anime">✨ Прозрачный аниме-дубляж (Яркая эмоциональная читаемость)</option>
                                    <option value="gentle_balance">🍃 Мягкое выравнивание (50% интенсивности)</option>
                                  </select>
                                </div>
                              );
                            }

                            if (paramKey === 'modelId') {
                              const isDenoise = step.moduleId === 'ultimate_denoiser' || step.moduleId.includes('denoise');
                              return (
                                <div key={paramKey} className="col-span-2">
                                  <label className="text-[11px] text-purple-300 font-semibold block mb-1">
                                    {isDenoise ? '⚡ Выбор движка / нейросети шумоподавления:' : '🎛 Выбор алгоритма De-Reverb / De-Echo:'}
                                  </label>
                                  <select
                                    value={val}
                                    onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, e.target.value)}
                                    className="w-full px-2 py-1.5 bg-neutral-900 border border-purple-800/60 rounded text-xs text-purple-200 font-medium"
                                  >
                                    {isDenoise ? (
                                      <>
                                        <option value="deepfilternet3">DeepFilterNet 3 ONNX (Перцептивный нейросетевой AI)</option>
                                        <option value="uvr_denoise_foxjoy">VR-DeNoise FoxJoy (Вокальный спектральный)</option>
                                        <option value="uvr_denoise_full">UVR-DeNoise Full (Глубокое подавление гула и шипения)</option>
                                        <option value="uvr_denoise_lite">VR-DeNoise Lite (Легкая быстрая очистка)</option>
                                      </>
                                    ) : (
                                      <>
                                        <option value="reverb_foxjoy">Reverb HQ FoxJoy (MDX-Net Spatial Inversion)</option>
                                        <option value="uvr_deecho_normal">UVR De-Echo Normal (Мягкое снятие отражений)</option>
                                        <option value="uvr_deecho_aggressive">UVR De-Echo Aggressive (Пустая комната / плитка)</option>
                                        <option value="mdx_dereverb_room">MDX Room DeReverb (Устранение коробочного гула)</option>
                                        <option value="vst-spectral-dereverb">Spectral De-Reverb (Native C++ DSP, 0ms лаг)</option>
                                      </>
                                    )}
                                  </select>
                                </div>
                              );
                            }

                            if (paramKey === 'modelName') {
                              return (
                                <div key={paramKey} className="col-span-2">
                                  <label className="text-[11px] text-purple-300 font-semibold block mb-1">
                                    👑 Нейросетевая модель сепарации:
                                  </label>
                                  <select
                                    value={val}
                                    onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, e.target.value)}
                                    className="w-full px-2 py-1.5 bg-neutral-900 border border-purple-800/60 rounded text-xs text-purple-200 font-medium"
                                  >
                                    <option value="mel_band_roformer_vocals">Mel-Band Roformer Vocals (SOTA Pure Vocals)</option>
                                    <option value="bs_roformer_viperx">BS-Roformer Viperx (Кинематографический)</option>
                                    <option value="htdemucs_ft">HTDemucs v4 Fine-Tuned (4 Изолированных стема)</option>
                                    <option value="htdemucs_vocals_bgm">HTDemucs 2-Стема (Вокал + Фонограмма)</option>
                                    <option value="uvr_mdx_voc_ft">UVR-MDX-NET Voc_FT (Золотой стандарт вокала)</option>
                                    <option value="uvr_mdx_inst_hq3">UVR-MDX-NET Inst_HQ_3 (Чистый минус M&E)</option>
                                    <option value="kim_vocal_2">Kim Vocal 2 (Для плотных миксов)</option>
                                  </select>
                                </div>
                              );
                            }

                            if (paramKey === 'roomSizeEstimate') {
                              return (
                                <div key={paramKey}>
                                  <label className="text-[11px] text-neutral-400 block mb-1">
                                    Размер помещения:
                                  </label>
                                  <select
                                    value={val}
                                    onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, e.target.value)}
                                    className="w-full px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs text-neutral-200"
                                  >
                                    <option value="small">Малая комната / кабина</option>
                                    <option value="medium">Стандартная жилая комната</option>
                                    <option value="large">Большой зал / просторное помещение</option>
                                  </select>
                                </div>
                              );
                            }

                            if (paramKey === 'lowCutSlope') {
                              return (
                                <div key={paramKey}>
                                  <label className="text-[11px] text-neutral-400 block mb-1">
                                    Крутизна среза (Slope):
                                  </label>
                                  <select
                                    value={val}
                                    onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, e.target.value)}
                                    className="w-full px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs text-neutral-200"
                                  >
                                    <option value="12dB/oct">12 dB/окт (Мягкий естественный спад)</option>
                                    <option value="24dB/oct">24 dB/окт (Крутой срез Butterworth)</option>
                                  </select>
                                </div>
                              );
                            }

                            if (paramKey === 'detectionMode') {
                              return (
                                <div key={paramKey}>
                                  <label className="text-[11px] text-neutral-400 block mb-1">
                                    Детектор уровня:
                                  </label>
                                  <select
                                    value={val}
                                    onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, e.target.value)}
                                    className="w-full px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs text-neutral-200"
                                  >
                                    <option value="rms">RMS (Энергетический сглаженный)</option>
                                    <option value="peak">Peak (Мгновенный пиковый)</option>
                                  </select>
                                </div>
                              );
                            }

                            if (paramKey === 'videoCodec') {
                              return (
                                <div key={paramKey}>
                                  <label className="text-[11px] text-neutral-400 block mb-1">
                                    Видеопоток:
                                  </label>
                                  <select
                                    value={val}
                                    onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, e.target.value)}
                                    className="w-full px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs text-neutral-200"
                                  >
                                    <option value="copy">Копирование без пережатия (Copy, 3 сек)</option>
                                    <option value="transcode">H.264 Транскодирование (CRF 18)</option>
                                  </select>
                                </div>
                              );
                            }

                            if (paramKey === 'audioBitrate') {
                              return (
                                <div key={paramKey}>
                                  <label className="text-[11px] text-neutral-400 block mb-1">
                                    Битрейт звука:
                                  </label>
                                  <select
                                    value={val}
                                    onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, e.target.value)}
                                    className="w-full px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs text-neutral-200"
                                  >
                                    <option value="320k">320 kbps (High Quality AAC)</option>
                                    <option value="256k">256 kbps (Web AAC)</option>
                                    <option value="192k">192 kbps (Standard AAC)</option>
                                    <option value="flac">FLAC (Lossless)</option>
                                  </select>
                                </div>
                              );
                            }

                            if (paramKey === 'stems') {
                              return (
                                <div key={paramKey} className="col-span-2">
                                  <label className="text-[11px] text-neutral-400 block mb-1">
                                    Выбор изолируемых стемов (Demucs v4):
                                  </label>
                                  <select
                                    value={val}
                                    onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, e.target.value)}
                                    className="w-full px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs text-neutral-200"
                                  >
                                    <option value="both">Вокал + Инструментал (Vocals + M&E)</option>
                                    <option value="vocals_only">Только вокал (Vocals Only)</option>
                                    <option value="instrumental_only">Только фонограмма (M&E Only)</option>
                                    <option value="all">Все 4 стема (Вокал, Барабаны, Бас, Прочее)</option>
                                  </select>
                                </div>
                              );
                            }

                            // Numeric Sliders with precise value
                            const metaParam = PARAM_LABELS[paramKey];
                            const spec = PARAM_SPECS[paramKey];
                            if (spec) {
                              return (
                                <div key={paramKey} className="col-span-2 space-y-1 bg-neutral-900/40 p-2 rounded border border-neutral-800/40">
                                  <div className="flex items-center justify-between text-[11px]">
                                    <span className="text-neutral-300 font-medium truncate" title={metaParam?.label || paramKey}>
                                      {metaParam?.label || paramKey}:
                                    </span>
                                    <span className="text-purple-300 font-mono font-bold shrink-0">
                                      {val} {metaParam?.unit ? ` ${metaParam.unit}` : ''}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <input 
                                      type="range"
                                      min={spec.min}
                                      max={spec.max}
                                      step={spec.step}
                                      value={val}
                                      onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, parseFloat(e.target.value))}
                                      className="flex-1 h-1 bg-neutral-800 rounded appearance-none cursor-pointer accent-purple-500"
                                    />
                                    <input
                                      type="number"
                                      min={spec.min}
                                      max={spec.max}
                                      step={spec.step}
                                      value={val}
                                      onChange={(e) => {
                                        const parsed = parseFloat(e.target.value);
                                        if (!isNaN(parsed)) {
                                          handleUpdateStepParams(step.stepId, paramKey, parsed);
                                        }
                                      }}
                                      className="w-16 px-1 py-0.5 bg-neutral-950 border border-neutral-800 rounded text-[11px] text-center font-mono text-purple-200"
                                    />
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <div key={paramKey} className="space-y-1">
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="text-neutral-400 truncate" title={metaParam?.label || paramKey}>
                                    {metaParam?.label || paramKey}:
                                  </span>
                                  <span className="text-purple-300 font-mono font-medium shrink-0">
                                    {val} {metaParam?.unit ? ` ${metaParam.unit}` : ''}
                                  </span>
                                </div>
                                <input 
                                  type="number"
                                  step="any"
                                  value={val}
                                  onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, parseFloat(e.target.value))}
                                  className="w-full px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs font-mono text-neutral-200"
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Output Artifacts on Disk (Inspected via Preview) */}
                    {step.outputFiles && step.outputFiles.length > 0 && (
                      <div className="bg-neutral-950/40 p-2.5 rounded-lg border border-neutral-800/80 space-y-1.5">
                        <div className="text-[10px] uppercase font-semibold text-neutral-400 flex items-center justify-between">
                          <span>Сохраненные результаты на диске ({step.outputFiles.length}):</span>
                          <div className="flex items-center gap-2">
                            <span className="text-emerald-400">✓ Записано на диск</span>
                            <button
                              onClick={() => handleClearStep(step.stepId)}
                              disabled={activeProcessingStepId !== null}
                              className="text-[10px] text-red-400 hover:text-red-300 bg-red-950/40 hover:bg-red-900/50 px-2 py-0.5 rounded border border-red-800/40 transition flex items-center gap-1 normal-case font-medium"
                              title="Удалить все обработанные дорожки этого шага и очистить шаг"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                              <span>Удалить все дорожки шага</span>
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {/* Full Module Mix Option */}
                          {step.outputFiles.length > 1 && (
                            <button
                              onClick={() => selectModuleMixForInspection(step)}
                              className={`px-2.5 py-1 rounded text-[11px] font-bold flex items-center gap-1.5 border transition ${
                                selectedAudioTrack?.id === `module_mix_${step.stepId}`
                                  ? 'bg-purple-600 text-white border-purple-400 shadow-md ring-1 ring-purple-400'
                                  : 'bg-purple-900/40 hover:bg-purple-800/60 text-purple-300 border-purple-700/60'
                              }`}
                              title="Прослушать в плеере совместный микс всех обработанных этим модулем дорожек"
                            >
                              <Volume2 className="w-3.5 h-3.5 text-purple-300" />
                              <span>🔊 Все дорожки (Микс модуля — {step.outputFiles.length} шт.)</span>
                            </button>
                          )}

                          {/* Individual Output Files */}
                          {step.outputFiles.map((of, oIdx) => {
                            const isSelected = selectedAudioTrack?.id === of.path;
                            return (
                              <div
                                key={oIdx}
                                className={`rounded text-[11px] font-mono flex items-center border transition overflow-hidden ${
                                  isSelected
                                    ? 'bg-purple-600/30 border-purple-500 text-purple-200 shadow-sm'
                                    : 'bg-neutral-800/60 border-neutral-700/60 text-neutral-300 hover:border-neutral-500'
                                }`}
                              >
                                <button
                                  onClick={() => selectTrackForInspection(of, `${meta?.title || step.moduleId}: ${of.name}`, step.stepId)}
                                  className="px-2 py-1 flex items-center gap-1 text-left"
                                  title={`Прослушать: ${of.name}`}
                                >
                                  {of.name.endsWith('.mp4') ? (
                                    <Film className="w-3 h-3 text-purple-400" />
                                  ) : (
                                    <FileAudio className="w-3 h-3 text-purple-400" />
                                  )}
                                  <span className="truncate max-w-[180px]">{of.name}</span>
                                  <span className="text-[10px] text-emerald-400 ml-1">🎧</span>
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleClearStep(step.stepId, of.path);
                                  }}
                                  disabled={activeProcessingStepId !== null}
                                  className="px-1.5 py-1 text-[10px] text-neutral-500 hover:text-red-300 hover:bg-red-950/60 border-l border-neutral-700/60 transition"
                                  title={`Удалить эту дорожку (${of.name}) из результатов шага`}
                                >
                                  ✕
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
    </div>
  );
};
