import React from 'react';
import { 
  Play, 
  Volume2, 
  Download, 
  CheckCircle2, 
  FileAudio, 
  Film, 
  Sparkles, 
  Radio, 
  RefreshCw, 
  Settings2, 
  Plus, 
  ShieldCheck, 
  Headphones, 
  ArrowUp, 
  ArrowDown, 
  Trash2, 
  Power, 
  Wand2, 
  AlertCircle, 
  XCircle, 
  RotateCcw,
  Sliders,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { MixingStepCardProps } from './mixing.types';
import { MixingStepParams } from './MixingStepParams';

export const MixingStepCard: React.FC<MixingStepCardProps> = ({
  step,
  index,
  totalSteps,
  manifest,
  activeProcessingStepId,
  isProcessing,
  isExpanded,
  isTracksExpanded,
  progressPercent,
  selectedAudioTrack,
  isDownloadingUvrModel,
  uvrDownloadPercent,
  meta,
  onToggleExpand,
  onToggleTracksExpand,
  onSelectModuleMix,
  onSelectTrackForInspection,
  onClearStep,
  onMoveUp,
  onMoveDown,
  onToggleEnable,
  onDelete,
  onRun,
  onAbort,
  onUpdateStepTracks,
  onAddCustomTrack,
  onDownloadUvrModel,
  onApplyPreset,
  onUpdateParams
}) => {
  const isComplete = step.status === 'completed';

  return (
    <div 
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
            {index + 1}
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
              {/* Active model badge */}
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
              {/* Voice timbre match badge */}
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

        {/* Step Actions */}
        <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
          {/* Listen Module Mix */}
          {step.outputFiles && step.outputFiles.length > 0 && (
            <button
              onClick={() => onSelectModuleMix(step)}
              className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition border ${
                selectedAudioTrack?.id === `module_mix_${step.stepId}`
                  ? 'bg-purple-600 text-white border-purple-400 shadow-md ring-1 ring-purple-400 font-bold'
                  : 'bg-purple-950/60 hover:bg-purple-900/80 text-purple-200 border-purple-800/80'
              }`}
              title="Прослушать в плеере совместный микс всех обработанных этим модулем дорожек"
            >
              <Volume2 className="w-3.5 h-3.5 text-purple-300" />
              <span>🔊 Микс модуля</span>
            </button>
          )}

          {/* Toggle Tracks View */}
          <button
            onClick={onToggleTracksExpand}
            className={`p-1.5 rounded text-xs transition border flex items-center gap-1 ${
              isTracksExpanded
                ? 'bg-neutral-800 text-neutral-200 border-neutral-600'
                : 'text-neutral-400 hover:text-neutral-200 border-transparent hover:bg-neutral-800/60'
            }`}
            title="Настроить входные дорожки для этого модуля"
          >
            <Headphones className="w-3.5 h-3.5" />
            <span className="text-[10px]">Дорожки</span>
            {isTracksExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {/* Clear step output files */}
          {step.outputFiles && step.outputFiles.length > 0 && (
            <button
              onClick={() => onClearStep(step.stepId)}
              disabled={isProcessing}
              className="p-1.5 text-neutral-400 hover:text-red-300 hover:bg-red-950/60 rounded text-xs transition"
              title="Очистить результаты обработки шага"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Move Up */}
          <button
            onClick={onMoveUp}
            disabled={index === 0}
            className="p-1.5 text-neutral-400 hover:text-neutral-200 disabled:opacity-30 disabled:hover:text-neutral-400 rounded text-xs transition"
            title="Переместить шаг выше по конвейеру"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>

          {/* Move Down */}
          <button
            onClick={onMoveDown}
            disabled={index === totalSteps - 1}
            className="p-1.5 text-neutral-400 hover:text-neutral-200 disabled:opacity-30 disabled:hover:text-neutral-400 rounded text-xs transition"
            title="Переместить шаг ниже по конвейеру"
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>

          {/* Toggle Enable / Bypass */}
          <button
            onClick={onToggleEnable}
            className={`p-1.5 rounded text-xs transition ${
              step.enabled ? 'text-emerald-400 hover:bg-emerald-950/40' : 'text-neutral-500 hover:bg-neutral-800'
            }`}
            title={step.enabled ? 'Отключить шаг (Bypass)' : 'Включить шаг'}
          >
            <Power className="w-3.5 h-3.5" />
          </button>

          {/* Settings Expand */}
          <button
            onClick={onToggleExpand}
            className={`p-1.5 rounded text-xs transition ${
              isExpanded ? 'bg-neutral-800 text-purple-400' : 'text-neutral-400 hover:text-neutral-200'
            }`}
            title="Параметры модуля"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>

          {/* Run Single Step */}
          {isProcessing ? (
            <button
              onClick={onAbort}
              className="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-bold flex items-center gap-1.5 transition shadow-sm animate-pulse"
              title="Прервать выполнение этого шага"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>Стоп</span>
            </button>
          ) : (
            <button
              onClick={onRun}
              disabled={!step.enabled}
              className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-neutral-200 rounded text-xs font-medium flex items-center gap-1.5 transition"
              title="Выполнить только этот шаг"
            >
              <Play className="w-3.5 h-3.5 fill-current text-purple-400" />
              <span>Шаг</span>
            </button>
          )}

          {/* Delete Step */}
          <button
            onClick={onDelete}
            className="p-1.5 text-neutral-400 hover:text-red-400 rounded text-xs transition ml-1"
            title="Удалить шаг из цепочки"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Progress Bar for Step */}
      {isProcessing && (
        <div className="space-y-1 pt-1">
          <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
            <div 
              className="bg-purple-500 h-full transition-all duration-300"
              style={{ width: `${progressPercent || 15}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-purple-300 font-mono">
            <span>Обработка...</span>
            <span>{progressPercent || 15}%</span>
          </div>
        </div>
      )}

      {/* Expanded Tracks Selection Area */}
      {isTracksExpanded && (
        <div className="bg-neutral-950/70 p-3 rounded-lg border border-neutral-800 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-neutral-300">Входные дорожки шага:</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onUpdateStepTracks(step.stepId, 'clear_exclusions')}
                className="text-[10px] text-purple-400 hover:text-purple-300"
              >
                Включить все
              </button>
              <button
                onClick={() => onAddCustomTrack()}
                className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                <span>Добавить внешнюю дорожку</span>
              </button>
            </div>
          </div>

          <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
            {(manifest?.sourceFiles?.dubberTracks || []).map((tr, tIdx) => {
              const isExcluded = Array.isArray(step.params?.excludedTrackKeys) && step.params.excludedTrackKeys.includes(tr.dubberNick || tr.name);
              return (
                <div 
                  key={tIdx}
                  className={`flex items-center justify-between px-2.5 py-1.5 rounded text-xs border transition ${
                    isExcluded 
                      ? 'bg-neutral-950/40 border-neutral-900 opacity-40 text-neutral-500' 
                      : 'bg-neutral-900/60 border-neutral-800/80 text-neutral-300'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="w-4 h-4 rounded-full bg-neutral-800 flex items-center justify-center text-[10px] font-bold">
                      {tIdx + 1}
                    </span>
                    <span className="font-medium truncate">{tr.dubberNick}</span>
                    <span className="text-neutral-500 text-[10px] truncate">({tr.name})</span>
                  </div>
                  <button
                    onClick={() => onUpdateStepTracks(step.stepId, 'toggle_exclude', tr.dubberNick || tr.name)}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition ${
                      isExcluded 
                        ? 'bg-neutral-800 text-neutral-400 hover:text-neutral-200' 
                        : 'bg-purple-950/80 text-purple-300 border border-purple-800/60'
                    }`}
                  >
                    {isExcluded ? 'Исключено' : 'Активна'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Expanded Parameters Area */}
      {isExpanded && (
        <div className="bg-neutral-950/70 p-3.5 rounded-lg border border-neutral-800 space-y-3">
          {/* Presets row if module has presets */}
          {meta?.presets && meta.presets.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap pb-2 border-b border-neutral-800/60">
              <span className="text-[11px] text-neutral-400 flex items-center gap-1 font-medium">
                <Wand2 className="w-3.5 h-3.5 text-purple-400" />
                <span>Пресеты:</span>
              </span>
              {meta.presets.map((preset, pIdx) => (
                <button
                  key={pIdx}
                  onClick={() => onApplyPreset(preset)}
                  className="px-2.5 py-1 bg-purple-950/40 hover:bg-purple-900/60 text-purple-300 border border-purple-800/40 rounded text-xs transition"
                  title={preset.description}
                >
                  {preset.title}
                </button>
              ))}
            </div>
          )}

          {/* Step Parameters Form */}
          <MixingStepParams 
            step={step}
            onUpdateParams={(key, val) => onUpdateParams(key, val)}
          />
        </div>
      )}

      {/* Output Files on Disk */}
      {step.outputFiles && step.outputFiles.length > 0 && (
        <div className="bg-neutral-950/40 p-2.5 rounded-lg border border-neutral-800/80 space-y-1.5">
          <div className="text-[10px] uppercase font-semibold text-neutral-400 flex items-center justify-between">
            <span>Сохраненные результаты на диске ({step.outputFiles.length}):</span>
            <div className="flex items-center gap-2">
              <span className="text-emerald-400">✓ Записано на диск</span>
              <button
                onClick={() => onClearStep(step.stepId)}
                disabled={activeProcessingStepId !== null}
                className="text-[10px] text-red-400 hover:text-red-300 bg-red-950/40 hover:bg-red-900/50 px-2 py-0.5 rounded border border-red-800/40 transition flex items-center gap-1 normal-case font-medium"
                title="Удалить все обработанные дорожки этого шага"
              >
                <Trash2 className="w-2.5 h-2.5" />
                <span>Очистить шаг</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {step.outputFiles.length > 1 && (
              <button
                onClick={() => onSelectModuleMix(step)}
                className={`px-2.5 py-1 rounded text-[11px] font-bold flex items-center gap-1.5 border transition ${
                  selectedAudioTrack?.id === `module_mix_${step.stepId}`
                    ? 'bg-purple-600 text-white border-purple-400 shadow-md ring-1 ring-purple-400'
                    : 'bg-purple-900/40 hover:bg-purple-800/60 text-purple-300 border-purple-700/60'
                }`}
                title="Прослушать в плеере совместный микс всех дорожек модуля"
              >
                <Volume2 className="w-3.5 h-3.5 text-purple-300" />
                <span>🔊 Все дорожки (Микс — {step.outputFiles.length} шт.)</span>
              </button>
            )}

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
                    onClick={() => onSelectTrackForInspection(of, `${meta?.title || step.moduleId}: ${of.name}`, step.stepId)}
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
                      onClearStep(step.stepId, of.path);
                    }}
                    disabled={activeProcessingStepId !== null}
                    className="px-1.5 py-1 text-[10px] text-neutral-500 hover:text-red-300 hover:bg-red-950/60 border-l border-neutral-700/60 transition"
                    title={`Удалить дорожку (${of.name})`}
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
};
