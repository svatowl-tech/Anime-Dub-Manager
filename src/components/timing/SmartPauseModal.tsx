import React, { useState, useMemo } from 'react';
import { AudioClip, SmartPauseOptions, ClipAlignmentDiff } from '../../types/timing';
import { SubtitleLine } from '../../types';
import { 
  DEFAULT_SMART_PAUSE_OPTIONS, 
  calculateSmartPauseAlignment 
} from '../../services/timing/SmartPauseBreathingEngine';
import { formatSeconds } from '../../services/timing/SubtitleAlignmentService';
import { 
  Wand2, 
  X, 
  Check, 
  Sliders, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  ShieldCheck,
  RefreshCw
} from 'lucide-react';

interface SmartPauseModalProps {
  isOpen: boolean;
  clipsByTrack: Record<string, AudioClip[]>;
  subLines: SubtitleLine[];
  audioBuffers: Record<string, AudioBuffer>;
  onClose: () => void;
  onApply: (diffs: ClipAlignmentDiff[]) => void;
}

export const SmartPauseModal: React.FC<SmartPauseModalProps> = ({
  isOpen,
  clipsByTrack,
  subLines,
  audioBuffers,
  onClose,
  onApply
}) => {
  const [options, setOptions] = useState<SmartPauseOptions>(DEFAULT_SMART_PAUSE_OPTIONS);
  const [activeTab, setActiveTab] = useState<'preview' | 'settings'>('preview');

  // Flatten all clips
  const allClips = useMemo(() => {
    const list: AudioClip[] = [];
    Object.values(clipsByTrack).forEach(arr => arr.forEach(c => list.push(c)));
    return list;
  }, [clipsByTrack]);

  // Compute live diffs based on current options
  const diffs = useMemo(() => {
    if (!isOpen) return [];
    return calculateSmartPauseAlignment(allClips, subLines, audioBuffers, options);
  }, [isOpen, allClips, subLines, audioBuffers, options]);

  // Selection state for individual diff items
  const [selectedDiffIds, setSelectedDiffIds] = useState<Record<string, boolean>>({});

  // Initialize all valid diffs as selected by default
  React.useEffect(() => {
    const initial: Record<string, boolean> = {};
    diffs.forEach(d => {
      initial[d.clipId] = d.status !== 'collision';
    });
    setSelectedDiffIds(initial);
  }, [diffs]);

  const toggleSelectDiff = (clipId: string) => {
    setSelectedDiffIds(prev => ({ ...prev, [clipId]: !prev[clipId] }));
  };

  const toggleSelectAll = () => {
    const allSelected = diffs.every(d => selectedDiffIds[d.clipId]);
    const next: Record<string, boolean> = {};
    diffs.forEach(d => {
      next[d.clipId] = !allSelected;
    });
    setSelectedDiffIds(next);
  };

  const handleApply = () => {
    const approvedDiffs = diffs.map(d => ({
      ...d,
      isApproved: !!selectedDiffIds[d.clipId]
    })).filter(d => d.isApproved);

    onApply(approvedDiffs);
    onClose();
  };

  if (!isOpen) return null;

  const adjustedCount = diffs.filter(d => d.status === 'adjusted').length;
  const perfectCount = diffs.filter(d => d.status === 'perfect').length;
  const exceedsCount = diffs.filter(d => d.status === 'exceeds_limit').length;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-4xl max-h-[85vh] bg-neutral-900 border border-neutral-800 rounded-xl flex flex-col shadow-2xl overflow-hidden select-none">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-950/60 border border-emerald-800/60 flex items-center justify-center text-emerald-400">
              <Wand2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-neutral-100">
                Авто-подгонка дорожек под субтитры (Smart Pause Breathing)
              </h3>
              <p className="text-xs text-neutral-400">
                Компенсация пауз между словами без искажения тембра и питча голоса
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sub-header / Tabs & Metrics */}
        <div className="px-5 py-2.5 border-b border-neutral-800 bg-neutral-900/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('preview')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                activeTab === 'preview'
                  ? 'bg-neutral-800 text-neutral-100 border border-neutral-700'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              Предпросмотр сдвигов ({diffs.length})
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                activeTab === 'settings'
                  ? 'bg-neutral-800 text-neutral-100 border border-neutral-700'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Параметры пауз</span>
            </button>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono">
            <span className="text-emerald-400">✓ {adjustedCount} скорректировано</span>
            <span className="text-indigo-400">≡ {perfectCount} в тайминге</span>
            {exceedsCount > 0 && (
              <span className="text-amber-400">⚠ {exceedsCount} длиннее нормы</span>
            )}
          </div>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'settings' ? (
            <div className="max-w-xl mx-auto space-y-5 py-2">
              <div>
                <div className="flex justify-between text-xs font-medium text-neutral-300 mb-1">
                  <span>Минимальная пауза дыхания</span>
                  <span className="font-mono text-emerald-400">{Math.round(options.minPauseDurationSec * 1000)} мс</span>
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="0.20"
                  step="0.01"
                  value={options.minPauseDurationSec}
                  onChange={(e) => setOptions(o => ({ ...o, minPauseDurationSec: parseFloat(e.target.value) }))}
                  className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
                <p className="text-[11px] text-neutral-500 mt-1">
                  Паузы между словами никогда не сожмутся сильнее этой величины для сохранения естественности речи.
                </p>
              </div>

              <div>
                <div className="flex justify-between text-xs font-medium text-neutral-300 mb-1">
                  <span>Порог детекции тишины</span>
                  <span className="font-mono text-emerald-400">{options.silenceThresholdDb} dB</span>
                </div>
                <input
                  type="range"
                  min="-50"
                  max="-25"
                  step="1"
                  value={options.silenceThresholdDb}
                  onChange={(e) => setOptions(o => ({ ...o, silenceThresholdDb: parseFloat(e.target.value) }))}
                  className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
                <p className="text-[11px] text-neutral-500 mt-1">
                  Уровень шума помещения, ниже которого сигнал считается паузой или вдохом.
                </p>
              </div>

              <div>
                <div className="flex justify-between text-xs font-medium text-neutral-300 mb-1">
                  <span>Максимальное сжатие пауз</span>
                  <span className="font-mono text-emerald-400">{Math.round(options.maxCompressionRatio * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.2"
                  max="0.8"
                  step="0.05"
                  value={options.maxCompressionRatio}
                  onChange={(e) => setOptions(o => ({ ...o, maxCompressionRatio: parseFloat(e.target.value) }))}
                  className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
              </div>

              <div className="pt-2 border-t border-neutral-800 flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-neutral-200">Защита вдохов и атак согласных</div>
                  <div className="text-[11px] text-neutral-500">Добавляет микро-буфер 40 мс перед началом фразы</div>
                </div>
                <input
                  type="checkbox"
                  checked={options.protectBreathTails}
                  onChange={(e) => setOptions(o => ({ ...o, protectBreathTails: e.target.checked }))}
                  className="w-4 h-4 rounded bg-neutral-800 border-neutral-700 text-emerald-500 focus:ring-0 cursor-pointer"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-3 text-xs text-neutral-400">
                <button
                  onClick={toggleSelectAll}
                  className="hover:text-neutral-200 font-medium underline"
                >
                  Выбрать все / Снять выделение
                </button>
                <span>Показано {diffs.length} сопоставленных реплик</span>
              </div>

              {diffs.length === 0 ? (
                <div className="py-12 text-center text-neutral-500 text-xs">
                  Нет клипов с сопоставленными субтитрами. Выберите дорожки или распознайте фразы через авто-детекцию.
                </div>
              ) : (
                <div className="border border-neutral-800 rounded-lg overflow-hidden divide-y divide-neutral-800/60">
                  {diffs.map(diff => {
                    const isChecked = !!selectedDiffIds[diff.clipId];

                    return (
                      <div
                        key={diff.clipId}
                        onClick={() => toggleSelectDiff(diff.clipId)}
                        className={`p-3 flex items-center justify-between gap-4 text-xs cursor-pointer transition-colors ${
                          isChecked ? 'bg-neutral-850 hover:bg-neutral-800' : 'bg-neutral-900/60 opacity-60'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}} // Handled by parent div
                            className="w-4 h-4 rounded bg-neutral-800 border-neutral-700 text-emerald-500 cursor-pointer"
                          />

                          <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="font-semibold text-neutral-200">{diff.characterName}</span>
                              <span className="font-mono text-[11px] text-neutral-500 tabular-nums">
                                {formatSeconds(diff.targetStartSec)} - {formatSeconds(diff.targetEndSec)}
                              </span>
                            </div>
                            <p className="text-neutral-400 text-xs truncate max-w-md font-sans">
                              {diff.subText || '—'}
                            </p>
                          </div>
                        </div>

                        {/* Timing delta metrics */}
                        <div className="flex items-center gap-4 shrink-0 font-mono text-[11px] tabular-nums">
                          <div className="text-right">
                            <div className="text-neutral-400">
                              {diff.originalDurationSec.toFixed(2)}s → {diff.adjustedDurationSec.toFixed(2)}s
                            </div>
                            <div className={diff.pauseDeltaSec < 0 ? 'text-amber-400' : diff.pauseDeltaSec > 0 ? 'text-teal-400' : 'text-neutral-500'}>
                              {diff.pauseDeltaSec !== 0 ? `Δ пауз: ${diff.pauseDeltaSec > 0 ? '+' : ''}${diff.pauseDeltaSec.toFixed(2)}s` : 'без изменений'}
                            </div>
                          </div>

                          <div className="w-28 text-right">
                            {diff.status === 'perfect' && (
                              <span className="text-indigo-400 font-semibold">В тайминге</span>
                            )}
                            {diff.status === 'adjusted' && (
                              <span className="text-emerald-400 font-semibold">Подогнано</span>
                            )}
                            {diff.status === 'exceeds_limit' && (
                              <span className="text-amber-400 font-semibold">Превышает</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3 border-t border-neutral-800 bg-neutral-950 flex items-center justify-between">
          <div className="text-xs text-neutral-400 font-mono">
            Выбрано к применению: {Object.values(selectedDiffIds).filter(Boolean).length} из {diffs.length}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-md text-xs font-medium transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={handleApply}
              disabled={diffs.length === 0}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold text-white transition-all ${
                diffs.length > 0
                  ? 'bg-emerald-600 hover:bg-emerald-500 shadow-md shadow-emerald-950/40 cursor-pointer'
                  : 'bg-neutral-800 text-neutral-600 cursor-not-allowed'
              }`}
            >
              <Check className="w-4 h-4" />
              <span>Применить авто-подгонку</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
