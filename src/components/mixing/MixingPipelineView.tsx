import React from 'react';
import { 
  Layers, 
  Plus, 
  RotateCcw, 
  Sparkles, 
  Film, 
  Music, 
  FileText, 
  Headphones, 
  Volume2, 
  Upload, 
  RefreshCw 
} from 'lucide-react';
import { MixingPipelineViewProps } from './mixing.types';
import { MixingStepCard } from './MixingStepCard';
import { formatFileSize } from './mixingParamSpecs';

export const MixingPipelineView: React.FC<MixingPipelineViewProps> = ({
  manifest,
  activeProcessingStepId,
  isAborting,
  stepProgress,
  expandedSettings,
  setExpandedSettings,
  expandedTracks,
  setExpandedTracks,
  selectedAudioTrack,
  isDownloadingUvrModel,
  uvrDownloadPercent,
  getModuleMeta,
  onSelectModuleMix,
  onSelectTrackForInspection,
  onClearStep,
  onMoveStepUp,
  onMoveStepDown,
  onToggleStep,
  onDeleteStep,
  onRunStep,
  onAbortProcessing,
  onUpdateStepTracks,
  onAddCustomTrackToStep,
  onDownloadUvrModel,
  onApplyPreset,
  onUpdateStepParams,
  onOpenAddModuleModal,
  onResetToDefaultPipeline
}) => {
  const steps = manifest?.pipeline || [];

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      {/* File Lists: General Project Tracks & Dubber Tracks */}
      <div className="p-4 border-b border-neutral-800/80 space-y-4 flex-shrink-0">
        {/* Project General Tracks */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
              <Film className="w-3.5 h-3.5 text-blue-400" />
              Дорожки проекта
            </span>
            <span className="text-[11px] text-neutral-500">Видео, звук оригинала, субтитры</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {/* Video Card */}
            <div 
              className={`p-2.5 rounded-lg border text-left transition ${
                manifest?.sourceFiles?.video?.exists
                  ? 'bg-neutral-800/60 border-neutral-700/80'
                  : 'bg-neutral-900 border-neutral-800 opacity-60'
              }`}
            >
              <div className="flex items-center gap-1.5 text-blue-400 text-xs font-medium truncate mb-1">
                <Film className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Видео серии</span>
              </div>
              <div className="text-[11px] text-neutral-300 truncate" title={manifest?.sourceFiles?.video?.name || 'Отсутствует'}>
                {manifest?.sourceFiles?.video?.name || 'Не импортировано'}
              </div>
              <div className="text-[10px] text-neutral-500 mt-1 flex justify-between">
                <span>{formatFileSize(manifest?.sourceFiles?.video?.size)}</span>
                <span className="text-emerald-400">{manifest?.sourceFiles?.video ? '✓ Готово' : '—'}</span>
              </div>
            </div>

            {/* Original Audio Card */}
            <div 
              onClick={() => {
                if (manifest?.sourceFiles?.originalAudio) {
                  onSelectTrackForInspection(manifest.sourceFiles.originalAudio, 'Оригинальный звук', 'source');
                }
              }}
              className={`p-2.5 rounded-lg border text-left cursor-pointer transition ${
                manifest?.sourceFiles?.originalAudio?.exists
                  ? 'bg-neutral-800/60 border-neutral-700/80 hover:border-amber-500/50'
                  : 'bg-neutral-900 border-neutral-800 opacity-60'
              }`}
            >
              <div className="flex items-center gap-1.5 text-amber-400 text-xs font-medium truncate mb-1">
                <Music className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Оригинал звук</span>
              </div>
              <div className="text-[11px] text-neutral-300 truncate" title={manifest?.sourceFiles?.originalAudio?.name || 'Извлекается из видео'}>
                {manifest?.sourceFiles?.originalAudio?.name || 'Фон видео'}
              </div>
              <div className="text-[10px] text-neutral-500 mt-1 flex justify-between">
                <span>{formatFileSize(manifest?.sourceFiles?.originalAudio?.size)}</span>
                <span className="text-amber-400">Слушать 🎧</span>
              </div>
            </div>

            {/* Subtitles Card */}
            <div 
              className={`p-2.5 rounded-lg border text-left transition ${
                manifest?.sourceFiles?.subtitles?.exists
                  ? 'bg-neutral-800/60 border-neutral-700/80'
                  : 'bg-neutral-900 border-neutral-800 opacity-60'
              }`}
            >
              <div className="flex items-center gap-1.5 text-indigo-400 text-xs font-medium truncate mb-1">
                <FileText className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Субтитры (ASS)</span>
              </div>
              <div className="text-[11px] text-neutral-300 truncate" title={manifest?.sourceFiles?.subtitles?.name || 'Отсутствуют'}>
                {manifest?.sourceFiles?.subtitles?.name || 'Не импортированы'}
              </div>
              <div className="text-[10px] text-neutral-500 mt-1 flex justify-between">
                <span>{formatFileSize(manifest?.sourceFiles?.subtitles?.size)}</span>
                <span className="text-indigo-400">{manifest?.sourceFiles?.subtitles ? 'С ролями' : '—'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Dubber Tracks List */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
              <Headphones className="w-3.5 h-3.5 text-emerald-400" />
              Дорожки дабберов ({manifest?.sourceFiles?.dubberTracks?.length || 0})
            </span>
            <span className="text-[11px] text-neutral-500">После автотайминга и фиксов</span>
          </div>

          {(!manifest?.sourceFiles?.dubberTracks || manifest.sourceFiles.dubberTracks.length === 0) ? (
            <div className="p-3 bg-neutral-900/60 border border-neutral-800 rounded-lg text-center text-xs text-neutral-400">
              <p>Дорожки дабберов еще не импортированы в сведение серии.</p>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {manifest.sourceFiles.dubberTracks.map((tr, idx) => {
                const isSelected = selectedAudioTrack?.id === tr.path;
                return (
                  <div
                    key={idx}
                    onClick={() => onSelectTrackForInspection(tr, `Даббер: ${tr.dubberNick}`, 'source')}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs cursor-pointer transition ${
                      isSelected 
                        ? 'bg-blue-950/40 border-blue-600 text-blue-200' 
                        : 'bg-neutral-900/70 border-neutral-800 hover:bg-neutral-800/80 text-neutral-200'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-[10px] shrink-0">
                        {idx + 1}
                      </span>
                      <div className="truncate">
                        <span className="font-semibold text-neutral-100">{tr.dubberNick}</span>
                        <span className="text-neutral-500 text-[11px] ml-2 truncate">({tr.name})</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 text-[11px] text-neutral-400">
                      <span>{formatFileSize(tr.size)}</span>
                      <span className="px-2 py-0.5 bg-neutral-800 rounded text-emerald-400 text-[10px] font-medium">
                        {isSelected ? '▶ Играет' : 'Слушать'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Configurable Pipeline Section */}
      <div className="p-4 space-y-3 flex-1">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-neutral-800/70">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-200 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-purple-400" />
              Конвейер модулей ({steps.length})
            </span>
            <span className="text-[10px] text-neutral-400 bg-neutral-800/80 px-2 py-0.5 rounded border border-neutral-700/60 font-mono">
              Перетаскивайте шаги для смены порядка
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={onResetToDefaultPipeline}
              className="text-[11px] text-neutral-400 hover:text-neutral-200 flex items-center gap-1 bg-neutral-800 hover:bg-neutral-700 px-2.5 py-1 rounded border border-neutral-700 transition"
              title="Сбросить цепочку к базовому набору из 6 рекомендованных модулей"
            >
              <RotateCcw className="w-3 h-3 text-neutral-400" />
              <span>Заводской конвейер</span>
            </button>
            <button
              onClick={onOpenAddModuleModal}
              className="text-[11px] text-purple-300 hover:text-purple-200 flex items-center gap-1 bg-purple-950/60 hover:bg-purple-900/70 px-2.5 py-1 rounded border border-purple-700/60 transition shadow-sm font-medium"
              title="Выбрать и добавить новый модуль в цепочку сведения"
            >
              <Plus className="w-3.5 h-3.5 text-purple-400" />
              <span>Добавить модуль</span>
            </button>
          </div>
        </div>

        {/* Steps List */}
        {steps.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-neutral-800 rounded-xl space-y-3">
            <p className="text-sm text-neutral-400">В конвейере еще нет добавленных модулей обработки.</p>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={onResetToDefaultPipeline}
                className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs"
              >
                Восстановить заводской конвейер
              </button>
              <button
                onClick={onOpenAddModuleModal}
                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-medium"
              >
                Выбрать модули из базы
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {steps.map((step, idx) => {
              const meta = getModuleMeta(step.moduleId);
              const isProcessing = activeProcessingStepId === step.stepId || activeProcessingStepId === 'all';
              const isExpanded = !!expandedSettings[step.stepId];
              const isTracksExpanded = !!expandedTracks[step.stepId];
              const progress = stepProgress[step.stepId] || 0;

              return (
                <MixingStepCard
                  key={step.stepId}
                  step={step}
                  index={idx}
                  totalSteps={steps.length}
                  manifest={manifest}
                  activeProcessingStepId={activeProcessingStepId}
                  isProcessing={isProcessing}
                  isExpanded={isExpanded}
                  isTracksExpanded={isTracksExpanded}
                  progressPercent={progress}
                  selectedAudioTrack={selectedAudioTrack}
                  isDownloadingUvrModel={isDownloadingUvrModel}
                  uvrDownloadPercent={uvrDownloadPercent}
                  meta={meta}
                  onToggleExpand={() => setExpandedSettings(prev => ({ ...prev, [step.stepId]: !prev[step.stepId] }))}
                  onToggleTracksExpand={() => setExpandedTracks(prev => ({ ...prev, [step.stepId]: !prev[step.stepId] }))}
                  onSelectModuleMix={onSelectModuleMix}
                  onSelectTrackForInspection={onSelectTrackForInspection}
                  onClearStep={onClearStep}
                  onMoveUp={() => onMoveStepUp(idx)}
                  onMoveDown={() => onMoveStepDown(idx)}
                  onToggleEnable={() => onToggleStep(idx)}
                  onDelete={() => onDeleteStep(idx)}
                  onRun={() => onRunStep(step.stepId)}
                  onAbort={onAbortProcessing}
                  onUpdateStepTracks={onUpdateStepTracks}
                  onAddCustomTrack={() => onAddCustomTrackToStep(step.stepId)}
                  onDownloadUvrModel={onDownloadUvrModel}
                  onApplyPreset={(preset) => onApplyPreset(step.stepId, preset)}
                  onUpdateParams={(key, val) => onUpdateStepParams(step.stepId, key, val)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
