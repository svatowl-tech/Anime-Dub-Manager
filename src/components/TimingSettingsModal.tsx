import React, { useState } from 'react';
import { 
  X, 
  Sliders, 
  Scissors, 
  Sparkles, 
  Activity, 
  ShieldAlert, 
  RotateCcw, 
  Check, 
  Info,
  Layers,
  Volume2
} from 'lucide-react';

export interface TimingSettings {
  // 1. Silence removal
  autoAnalyzeNoiseFloor: boolean;
  silenceThresholdDb: number;
  minSilenceDurationSec: number;
  leadInPaddingSec: number;
  leadOutPaddingSec: number;
  minSpeechDurationSec: number;
  mergeCloseGapsSec: number;

  // 2. Fixes application
  fullRetakeThresholdPct: number;
  fixSearchWindowSec: number;
  fixCrossfadeMs: number;
  cleanOldTails: boolean;
  matchFixVolume: boolean;

  // 3. Auto-timing & Collisions
  snapTarget: 'sub_start' | 'sub_center';
  maxSnapDistanceSec: number;
  minInterRoleGapSec: number;
  collisionStrategy: 'highlight' | 'resolve_priority' | 'snap_bounds';
  preserveIntentionalOverlaps: boolean;

  // 4. Edge cases & Multi-track
  importAllDubberTracks: boolean;
  allowManualBoundaryExpansion: boolean;
  warnOnShortClips: boolean;
  handleUnmatchedPhrases: 'keep_as_clip' | 'mute';
}

export const DEFAULT_TIMING_SETTINGS: TimingSettings = {
  autoAnalyzeNoiseFloor: true,
  silenceThresholdDb: -45,
  minSilenceDurationSec: 0.30,
  leadInPaddingSec: 0.15,
  leadOutPaddingSec: 0.22,
  minSpeechDurationSec: 0.20,
  mergeCloseGapsSec: 0.35,

  fullRetakeThresholdPct: 80,
  fixSearchWindowSec: 6.0,
  fixCrossfadeMs: 12,
  cleanOldTails: true,
  matchFixVolume: true,

  snapTarget: 'sub_start',
  maxSnapDistanceSec: 8.0,
  minInterRoleGapSec: 0.12,
  collisionStrategy: 'highlight',
  preserveIntentionalOverlaps: true,

  importAllDubberTracks: true,
  allowManualBoundaryExpansion: true,
  warnOnShortClips: true,
  handleUnmatchedPhrases: 'keep_as_clip'
};

interface TimingSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: TimingSettings;
  onSave: (newSettings: TimingSettings) => void;
}

export const TimingSettingsModal: React.FC<TimingSettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSave
}) => {
  const [localSettings, setLocalSettings] = useState<TimingSettings>(settings);
  const [activeTab, setActiveTab] = useState<'silence' | 'fixes' | 'timing' | 'edge_cases'>('silence');

  if (!isOpen) return null;

  const handleReset = () => {
    setLocalSettings(DEFAULT_TIMING_SETTINGS);
  };

  const handleApply = () => {
    onSave(localSettings);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#10121a] border border-neutral-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-sans">
        
        {/* Header */}
        <div className="p-4 px-6 border-b border-neutral-800/80 flex items-center justify-between bg-neutral-900/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-600/20 border border-amber-500/30 text-amber-400 rounded-xl flex items-center justify-center">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Параметры тайминга, тишины и фиксов</h2>
              <p className="text-xs text-neutral-400">Тонкая настройка VAD-калибровки, граничных условий и слоев дорожек</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-neutral-800 bg-[#0d0f15] px-6 gap-2">
          <button
            onClick={() => setActiveTab('silence')}
            className={`py-3 px-3.5 text-xs font-semibold flex items-center gap-2 border-b-2 transition ${
              activeTab === 'silence'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Scissors className="w-4 h-4" />
            <span>Удаление тишины</span>
          </button>

          <button
            onClick={() => setActiveTab('fixes')}
            className={`py-3 px-3.5 text-xs font-semibold flex items-center gap-2 border-b-2 transition ${
              activeTab === 'fixes'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>Применение фиксов</span>
          </button>

          <button
            onClick={() => setActiveTab('timing')}
            className={`py-3 px-3.5 text-xs font-semibold flex items-center gap-2 border-b-2 transition ${
              activeTab === 'timing'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>Автотайминг</span>
          </button>

          <button
            onClick={() => setActiveTab('edge_cases')}
            className={`py-3 px-3.5 text-xs font-semibold flex items-center gap-2 border-b-2 transition ${
              activeTab === 'edge_cases'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <ShieldAlert className="w-4 h-4" />
            <span>Граничные условия & Слои</span>
          </button>
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-neutral-200 text-xs">

          {/* TAB 1: SILENCE REMOVAL */}
          {activeTab === 'silence' && (
            <div className="space-y-4">
              <div className="bg-amber-950/20 border border-amber-900/30 p-3.5 rounded-xl flex items-start gap-3 text-amber-200">
                <Info className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  <strong>Авто-калибровка шума и тишины:</strong> Система предварительно сканирует всю аудиодорожку, строит статистическое распределение RMS, определяет реальный фоновый шум комнаты (noise floor) и уровень речи. Порог тишины рассчитывается так, чтобы согласные, вздохи и шепот никогда не съедались.
                </div>
              </div>

              {/* Auto analyze noise floor toggle */}
              <div className="flex items-center justify-between p-3.5 bg-neutral-900/70 rounded-xl border border-neutral-800">
                <div>
                  <div className="font-bold text-white text-xs">Авто-анализ шума и точки тишины</div>
                  <div className="text-[11px] text-neutral-400 mt-0.5">
                    Автоматически подстраивать порог детекции под индивидуальный шум микрофона каждого даббера
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={localSettings.autoAnalyzeNoiseFloor}
                  onChange={(e) => setLocalSettings({ ...localSettings, autoAnalyzeNoiseFloor: e.target.checked })}
                  className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                />
              </div>

              {/* Manual Threshold (if auto is off or base threshold) */}
              {!localSettings.autoAnalyzeNoiseFloor && (
                <div className="p-3.5 bg-neutral-900/70 rounded-xl border border-neutral-800 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-white">Фиксированный порог тишины (dBFS)</span>
                    <span className="font-mono text-amber-400 font-bold">{localSettings.silenceThresholdDb} dB</span>
                  </div>
                  <input
                    type="range"
                    min="-65"
                    max="-20"
                    step="1"
                    value={localSettings.silenceThresholdDb}
                    onChange={(e) => setLocalSettings({ ...localSettings, silenceThresholdDb: Number(e.target.value) })}
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-neutral-500 font-mono">
                    <span>-65 dB (Макс. чувствительность)</span>
                    <span>-45 dB (Стандарт)</span>
                    <span>-20 dB (Жесткий гейт)</span>
                  </div>
                </div>
              )}

              {/* Min silence duration */}
              <div className="p-3.5 bg-neutral-900/70 rounded-xl border border-neutral-800 space-y-2">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-bold text-white">Минимальная длина паузы (секунды)</div>
                    <div className="text-[11px] text-neutral-400">Паузы короче этого значения не будут разрезать фразу на части</div>
                  </div>
                  <span className="font-mono text-amber-400 font-bold">{localSettings.minSilenceDurationSec.toFixed(2)} с</span>
                </div>
                <input
                  type="range"
                  min="0.10"
                  max="1.00"
                  step="0.05"
                  value={localSettings.minSilenceDurationSec}
                  onChange={(e) => setLocalSettings({ ...localSettings, minSilenceDurationSec: Number(e.target.value) })}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>

              {/* Pre & Post Speech Padding (Lead-in and Lead-out) */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3.5 bg-neutral-900/70 rounded-xl border border-neutral-800 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-white">Запас начала (Lead-In)</span>
                    <span className="font-mono text-amber-400 font-bold">{Math.round(localSettings.leadInPaddingSec * 1000)} мс</span>
                  </div>
                  <p className="text-[10px] text-neutral-400">Сохраняет атаки согласных звуков (п, т, к, х)</p>
                  <input
                    type="range"
                    min="0.05"
                    max="0.40"
                    step="0.01"
                    value={localSettings.leadInPaddingSec}
                    onChange={(e) => setLocalSettings({ ...localSettings, leadInPaddingSec: Number(e.target.value) })}
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                </div>

                <div className="p-3.5 bg-neutral-900/70 rounded-xl border border-neutral-800 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-white">Запас конца (Lead-Out)</span>
                    <span className="font-mono text-amber-400 font-bold">{Math.round(localSettings.leadOutPaddingSec * 1000)} мс</span>
                  </div>
                  <p className="text-[10px] text-neutral-400">Сохраняет естественные затухания и вздохи</p>
                  <input
                    type="range"
                    min="0.05"
                    max="0.50"
                    step="0.01"
                    value={localSettings.leadOutPaddingSec}
                    onChange={(e) => setLocalSettings({ ...localSettings, leadOutPaddingSec: Number(e.target.value) })}
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                </div>
              </div>

              {/* Intra-word pauses smoothing */}
              <div className="p-3.5 bg-neutral-900/70 rounded-xl border border-neutral-800 space-y-2">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-bold text-white">Склеивание смычек и микро-пауз внутри слов</div>
                    <div className="text-[11px] text-neutral-400">Предотвращает разрывы слов на взрывных согласных</div>
                  </div>
                  <span className="font-mono text-amber-400 font-bold">{Math.round(localSettings.mergeCloseGapsSec * 1000)} мс</span>
                </div>
                <input
                  type="range"
                  min="0.10"
                  max="0.70"
                  step="0.05"
                  value={localSettings.mergeCloseGapsSec}
                  onChange={(e) => setLocalSettings({ ...localSettings, mergeCloseGapsSec: Number(e.target.value) })}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* TAB 2: FIXES APPLICATION */}
          {activeTab === 'fixes' && (
            <div className="space-y-4">
              <div className="bg-indigo-950/20 border border-indigo-900/30 p-3.5 rounded-xl flex items-start gap-3 text-indigo-200">
                <Sparkles className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  <strong>Интеллектуальное вшитие дублей и фиксов:</strong> Фрагментарные фиксы бесшовно вшиваются в тайминг с микро-кроссфейдом. Полные дубли заменяют дорожку. Старый дубль в зоне фикса гарантированно глушится во избежание «эха» и хвостов.
                </div>
              </div>

              {/* Full Retake threshold */}
              <div className="p-3.5 bg-neutral-900/70 rounded-xl border border-neutral-800 space-y-2">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-bold text-white">Порог полного дубля (Retake)</div>
                    <div className="text-[11px] text-neutral-400">Если длина файла фикса превышает указанный % от оригинала — заменять всю дорожку</div>
                  </div>
                  <span className="font-mono text-amber-400 font-bold">{localSettings.fullRetakeThresholdPct}%</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="95"
                  step="5"
                  value={localSettings.fullRetakeThresholdPct}
                  onChange={(e) => setLocalSettings({ ...localSettings, fullRetakeThresholdPct: Number(e.target.value) })}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>

              {/* Fix Search Window */}
              <div className="p-3.5 bg-neutral-900/70 rounded-xl border border-neutral-800 space-y-2">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-bold text-white">Окно поиска позиции фрагментарного фикса</div>
                    <div className="text-[11px] text-neutral-400">Максимальное отклонение таймкода для поиска оригинальной фразы</div>
                  </div>
                  <span className="font-mono text-amber-400 font-bold">{localSettings.fixSearchWindowSec.toFixed(1)} с</span>
                </div>
                <input
                  type="range"
                  min="1.0"
                  max="15.0"
                  step="0.5"
                  value={localSettings.fixSearchWindowSec}
                  onChange={(e) => setLocalSettings({ ...localSettings, fixSearchWindowSec: Number(e.target.value) })}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>

              {/* Crossfade */}
              <div className="p-3.5 bg-neutral-900/70 rounded-xl border border-neutral-800 space-y-2">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-bold text-white">Микро-кроссфейд на стыках вшития</div>
                    <div className="text-[11px] text-neutral-400">Плавное сглаживание переходов для устранения щелчков постоянного тока</div>
                  </div>
                  <span className="font-mono text-amber-400 font-bold">{localSettings.fixCrossfadeMs} мс</span>
                </div>
                <input
                  type="range"
                  min="4"
                  max="40"
                  step="2"
                  value={localSettings.fixCrossfadeMs}
                  onChange={(e) => setLocalSettings({ ...localSettings, fixCrossfadeMs: Number(e.target.value) })}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>

              {/* Clean old tails */}
              <div className="flex items-center justify-between p-3.5 bg-neutral-900/70 rounded-xl border border-neutral-800">
                <div>
                  <div className="font-bold text-white text-xs">Гарантированное удаление старых хвостов</div>
                  <div className="text-[11px] text-neutral-400 mt-0.5">
                    Полное глушение исходной фразы под фиксом даже при несовпадении длительностей дублей
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={localSettings.cleanOldTails}
                  onChange={(e) => setLocalSettings({ ...localSettings, cleanOldTails: e.target.checked })}
                  className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                />
              </div>

              {/* Match fix volume */}
              <div className="flex items-center justify-between p-3.5 bg-neutral-900/70 rounded-xl border border-neutral-800">
                <div>
                  <div className="font-bold text-white text-xs">Авто-согласование громкости фикса с оригиналом</div>
                  <div className="text-[11px] text-neutral-400 mt-0.5">
                    Подтягивать RMS энергию нового дубля к уровню исходной записи
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={localSettings.matchFixVolume}
                  onChange={(e) => setLocalSettings({ ...localSettings, matchFixVolume: e.target.checked })}
                  className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* TAB 3: AUTO-TIMING */}
          {activeTab === 'timing' && (
            <div className="space-y-4">
              <div className="bg-purple-950/20 border border-purple-900/30 p-3.5 rounded-xl flex items-start gap-3 text-purple-200">
                <Activity className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  <strong>Автоматический тайминг фраз по субтитрам:</strong> Голосовые фрагменты аудио подтягиваются к таймкодам начала соответствующих строк субтитров с контролем коллизий между актерами.
                </div>
              </div>

              {/* Snap target */}
              <div className="p-3.5 bg-neutral-900/70 rounded-xl border border-neutral-800 space-y-2">
                <div className="font-bold text-white">Точка привязки к субтитру</div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setLocalSettings({ ...localSettings, snapTarget: 'sub_start' })}
                    className={`p-2.5 rounded-lg border text-left transition ${
                      localSettings.snapTarget === 'sub_start'
                        ? 'bg-amber-950/60 border-amber-500 text-amber-200'
                        : 'bg-neutral-800/80 border-neutral-700 text-neutral-400 hover:text-white'
                    }`}
                  >
                    <div className="font-bold text-xs">По началу субтитра</div>
                    <div className="text-[10px] opacity-80 mt-0.5">Синхронизирует первый слог реплики</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setLocalSettings({ ...localSettings, snapTarget: 'sub_center' })}
                    className={`p-2.5 rounded-lg border text-left transition ${
                      localSettings.snapTarget === 'sub_center'
                        ? 'bg-amber-950/60 border-amber-500 text-amber-200'
                        : 'bg-neutral-800/80 border-neutral-700 text-neutral-400 hover:text-white'
                    }`}
                  >
                    <div className="font-bold text-xs">По центру диапазона</div>
                    <div className="text-[10px] opacity-80 mt-0.5">Центрирует фразу внутри субтитра</div>
                  </button>
                </div>
              </div>

              {/* Max snap distance */}
              <div className="p-3.5 bg-neutral-900/70 rounded-xl border border-neutral-800 space-y-2">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-bold text-white">Максимальный допустимый сдвиг (секунды)</div>
                    <div className="text-[11px] text-neutral-400">Защита: фразы дальше этого интервала не будут насильно утягиваться</div>
                  </div>
                  <span className="font-mono text-amber-400 font-bold">{localSettings.maxSnapDistanceSec.toFixed(1)} с</span>
                </div>
                <input
                  type="range"
                  min="2.0"
                  max="20.0"
                  step="0.5"
                  value={localSettings.maxSnapDistanceSec}
                  onChange={(e) => setLocalSettings({ ...localSettings, maxSnapDistanceSec: Number(e.target.value) })}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>

              {/* Min inter-role gap */}
              <div className="p-3.5 bg-neutral-900/70 rounded-xl border border-neutral-800 space-y-2">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-bold text-white">Минимальный зазор между репликами разных персонажей</div>
                    <div className="text-[11px] text-neutral-400">Безопасная пауза между фразами при разведении наездов</div>
                  </div>
                  <span className="font-mono text-amber-400 font-bold">{localSettings.minInterRoleGapSec.toFixed(2)} с</span>
                </div>
                <input
                  type="range"
                  min="0.04"
                  max="0.30"
                  step="0.02"
                  value={localSettings.minInterRoleGapSec}
                  onChange={(e) => setLocalSettings({ ...localSettings, minInterRoleGapSec: Number(e.target.value) })}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>

              {/* Collision resolution strategy */}
              <div className="p-3.5 bg-neutral-900/70 rounded-xl border border-neutral-800 space-y-2">
                <div className="font-bold text-white">Стратегия обработки наездов (коллизий)</div>
                <select
                  value={localSettings.collisionStrategy}
                  onChange={(e) => setLocalSettings({ ...localSettings, collisionStrategy: e.target.value as any })}
                  className="w-full bg-neutral-800 text-neutral-100 rounded-lg p-2 border border-neutral-700 text-xs"
                >
                  <option value="highlight">Подсвечивать наезды красным для ручной доводки (рекомендуется)</option>
                  <option value="resolve_priority">Автоматически раздвигать фразы с приоритетом первого сказавшего</option>
                  <option value="snap_bounds">Строго придерживаться границ субтитров</option>
                </select>
              </div>

              {/* Preserve intentional overlaps */}
              <div className="flex items-center justify-between p-3.5 bg-neutral-900/70 rounded-xl border border-neutral-800">
                <div>
                  <div className="font-bold text-white text-xs">Сохранять синхронные наложения из субтитров</div>
                  <div className="text-[11px] text-neutral-400 mt-0.5">
                    Если в оригинале персонажи говорят одновременно — не считать это ошибкой
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={localSettings.preserveIntentionalOverlaps}
                  onChange={(e) => setLocalSettings({ ...localSettings, preserveIntentionalOverlaps: e.target.checked })}
                  className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* TAB 4: EDGE CASES & MULTI-TRACK */}
          {activeTab === 'edge_cases' && (
            <div className="space-y-4">
              <div className="bg-emerald-950/20 border border-emerald-900/30 p-3.5 rounded-xl flex items-start gap-3 text-emerald-200">
                <Layers className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  <strong>Несколько дорожек от одного даббера & Граничные условия:</strong> Поддержка ситуаций, когда в серию загружено несколько дорожек одного актера (перекрывающиеся фразы, диалог с самим собой, версии дублей v1/v2 или дорожка с фиксами).
                </div>
              </div>

              {/* Import all dubber tracks toggle */}
              <div className="flex items-center justify-between p-3.5 bg-neutral-900/70 rounded-xl border border-neutral-800">
                <div>
                  <div className="font-bold text-white text-xs">Импортировать ВСЕ дорожки каждого даббера</div>
                  <div className="text-[11px] text-neutral-400 mt-0.5">
                    Если даббер записал 2 дорожки из-за наложений реплик друг на друга — импортировать обе параллельными слоями
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={localSettings.importAllDubberTracks}
                  onChange={(e) => setLocalSettings({ ...localSettings, importAllDubberTracks: e.target.checked })}
                  className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                />
              </div>

              {/* Allow manual boundary expansion */}
              <div className="flex items-center justify-between p-3.5 bg-neutral-900/70 rounded-xl border border-neutral-800">
                <div>
                  <div className="font-bold text-white text-xs">Свободное ручное растягивание границ клипов (DAW Trim/Expand)</div>
                  <div className="text-[11px] text-neutral-400 mt-0.5">
                    Позволяет хватать клип за левый и правый край и вытягивать отрезанное тишиной аудио из исходного файла
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={localSettings.allowManualBoundaryExpansion}
                  onChange={(e) => setLocalSettings({ ...localSettings, allowManualBoundaryExpansion: e.target.checked })}
                  className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                />
              </div>

              {/* Unmatched phrases handling */}
              <div className="p-3.5 bg-neutral-900/70 rounded-xl border border-neutral-800 space-y-2">
                <div className="font-bold text-white">Речевые фразы, не найденные в субтитрах (дополнительные реплики)</div>
                <select
                  value={localSettings.handleUnmatchedPhrases}
                  onChange={(e) => setLocalSettings({ ...localSettings, handleUnmatchedPhrases: e.target.value as any })}
                  className="w-full bg-neutral-800 text-neutral-100 rounded-lg p-2 border border-neutral-700 text-xs"
                >
                  <option value="keep_as_clip">Оставлять на таймлайне как независимый клип (не удалять!)</option>
                  <option value="mute">Глушить (считать фоновым шумом/вздохом вне диалога)</option>
                </select>
              </div>

              {/* Warn on short clips */}
              <div className="flex items-center justify-between p-3.5 bg-neutral-900/70 rounded-xl border border-neutral-800">
                <div>
                  <div className="font-bold text-white text-xs">Предупреждать о подозрительно коротких фразах (&lt; 0.25 с)</div>
                  <div className="text-[11px] text-neutral-400 mt-0.5">
                    Маркировать клипы, похожие на случайные щелчки микрофона или удары по столу
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={localSettings.warnOnShortClips}
                  onChange={(e) => setLocalSettings({ ...localSettings, warnOnShortClips: e.target.checked })}
                  className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                />
              </div>
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="p-4 px-6 border-t border-neutral-800 bg-neutral-900/80 flex items-center justify-between">
          <button
            onClick={handleReset}
            className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition border border-neutral-700"
          >
            <RotateCcw className="w-3.5 h-3.5 text-neutral-400" />
            <span>Сброс к стандарту</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-xl text-xs font-semibold transition"
            >
              Отмена
            </button>
            <button
              onClick={handleApply}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-amber-600/25 transition"
            >
              <Check className="w-4 h-4" />
              <span>Применить настройки</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
