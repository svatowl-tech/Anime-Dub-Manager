import React from 'react';
import { PipelineStep } from '../../types';
import { PARAM_SPECS, PARAM_LABELS } from './mixingParamSpecs';

interface MixingStepParamsProps {
  step: PipelineStep;
  onUpdateParams: (paramKey: string, value: any) => void;
}

export const MixingStepParams: React.FC<MixingStepParamsProps> = ({
  step,
  onUpdateParams
}) => {
  const params = step.params || {};

  return (
    <div className="grid grid-cols-2 gap-3 pt-2">
      {Object.entries(params).map(([paramKey, val]) => {
        // Skip internal/complex mapping keys from simple generic renderer
        if (
          paramKey === 'availableSubPlugins' ||
          paramKey === 'parametersPreview' ||
          paramKey === 'perTrackStates' ||
          paramKey === 'perTrackStateFiles' ||
          paramKey === 'globalStateFile' ||
          paramKey === 'globalStateSizeBytes' ||
          paramKey === 'globalStateUpdatedAt' ||
          paramKey === 'totalParameters' ||
          paramKey === 'vst3Path' ||
          paramKey === 'pluginName' ||
          paramKey === 'subPluginName'
        ) {
          return null;
        }

        // Boolean toggle switches
        if (typeof val === 'boolean') {
          return (
            <label key={paramKey} className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer col-span-2 sm:col-span-1 bg-neutral-900/60 p-2 rounded border border-neutral-800/60 hover:border-neutral-700">
              <input 
                type="checkbox"
                checked={val}
                onChange={(e) => onUpdateParams(paramKey, e.target.checked)}
                className="rounded accent-purple-500 w-4 h-4"
              />
              <span className="truncate" title={PARAM_LABELS[paramKey]?.label || paramKey}>
                {PARAM_LABELS[paramKey]?.label || paramKey}
              </span>
            </label>
          );
        }

        // Target Profile selector for Voice Timbre Match
        if (paramKey === 'targetProfile') {
          return (
            <div key={paramKey} className="col-span-2 space-y-1">
              <label className="text-[11px] text-neutral-400 block mb-1">
                Целевой профиль тембра (Target Timbre Profile):
              </label>
              <select
                value={String(val)}
                onChange={(e) => onUpdateParams(paramKey, e.target.value)}
                className="w-full px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs text-neutral-200"
              >
                <option value="studio_dub">Студийный дубляж (Нейтральный плотный)</option>
                <option value="warm_broadcast">Тёплый бродкаст (Глубокий низ, мягкий верх)</option>
                <option value="crisp_anime">Прозрачный аниме (Яркая читаемость в миксе)</option>
                <option value="gentle_balance">Мягкий баланс (Естественное сглаживание)</option>
              </select>
            </div>
          );
        }

        // Model selector for Neural Dereverb / Denoise
        if (paramKey === 'modelId') {
          return (
            <div key={paramKey} className="col-span-2 space-y-1">
              <label className="text-[11px] text-neutral-400 block mb-1">
                Модель нейросети:
              </label>
              <select
                value={String(val)}
                onChange={(e) => onUpdateParams(paramKey, e.target.value)}
                className="w-full px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs text-neutral-200"
              >
                <option value="uvr_denoise_lite">UVR Denoise Lite (Быстрая очистка)</option>
                <option value="uvr_deecho_normal">UVR De-Echo Normal (Умеренное эхо)</option>
                <option value="uvr_deecho_aggressive">UVR De-Echo Aggressive (Сильное эхо)</option>
                <option value="deepfilternet3">DeepFilterNet 3 (AI Denoise)</option>
                <option value="reverb_foxjoy">Reverb HQ FoxJoy (Студийный де-реверб)</option>
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
                value={String(val)}
                onChange={(e) => onUpdateParams(paramKey, e.target.value)}
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
                value={String(val)}
                onChange={(e) => onUpdateParams(paramKey, e.target.value)}
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
                value={String(val)}
                onChange={(e) => onUpdateParams(paramKey, e.target.value)}
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
                value={String(val)}
                onChange={(e) => onUpdateParams(paramKey, e.target.value)}
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
                value={String(val)}
                onChange={(e) => onUpdateParams(paramKey, e.target.value)}
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
        if (spec && typeof val === 'number') {
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
                  onChange={(e) => onUpdateParams(paramKey, parseFloat(e.target.value))}
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
                      onUpdateParams(paramKey, parsed);
                    }
                  }}
                  className="w-16 px-1 py-0.5 bg-neutral-950 border border-neutral-800 rounded text-[11px] text-center font-mono text-purple-200"
                />
              </div>
            </div>
          );
        }

        if (typeof val === 'number') {
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
                onChange={(e) => onUpdateParams(paramKey, parseFloat(e.target.value))}
                className="w-full px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs font-mono text-neutral-200"
              />
            </div>
          );
        }

        return (
          <div key={paramKey} className="space-y-1">
            <label className="text-[11px] text-neutral-400 block truncate" title={metaParam?.label || paramKey}>
              {metaParam?.label || paramKey}:
            </label>
            <input 
              type="text"
              value={String(val ?? '')}
              onChange={(e) => onUpdateParams(paramKey, e.target.value)}
              className="w-full px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs text-neutral-200 font-mono"
            />
          </div>
        );
      })}
    </div>
  );
};
