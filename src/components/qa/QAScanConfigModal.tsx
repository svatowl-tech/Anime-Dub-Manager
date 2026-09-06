import React, { useState } from 'react';
import { 
  X, 
  Sparkles, 
  CheckSquare, 
  Square, 
  Sliders, 
  VolumeX, 
  MessageSquareOff, 
  Users, 
  Layers, 
  Clock, 
  Radio, 
  FileText, 
  AlertCircle,
  HelpCircle,
  Cpu
} from 'lucide-react';
import { GapDetectionOptions } from '../../lib/qa/missingLinesDetector';

interface QAScanConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartScan: (options: GapDetectionOptions) => void;
  initialOptions?: Partial<GapDetectionOptions>;
  totalDubbers: number;
  totalSubLines: number;
}

export interface QACheckItem {
  key: keyof GapDetectionOptions;
  title: string;
  subtitle: string;
  category: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  badge?: string;
  defaultChecked: boolean;
}

export const QA_CHECK_ITEMS: QACheckItem[] = [
  {
    key: 'scanMissingLines',
    title: 'Пропуски реплик',
    subtitle: 'Поиск реплик персонажей, где дабер промолчал или оставил только тишину/статичный шум',
    category: 'Реплики',
    icon: VolumeX,
    color: 'text-red-400 bg-red-950/40 border-red-500/30',
    defaultChecked: true
  },
  {
    key: 'scanUnwantedSpeech',
    title: 'Лишняя речь вне субтитров',
    subtitle: 'Поиск посторонних фраз, смешков, оговорок или неудачных дублей вне таймингов сабов',
    category: 'Реплики',
    icon: MessageSquareOff,
    color: 'text-amber-400 bg-amber-950/40 border-amber-500/30',
    defaultChecked: true
  },
  {
    key: 'scanCollisions',
    title: 'Конфликты дубляжа (два дабера)',
    subtitle: 'Выявление реплик, где оба дабера озвучили одну и ту же фразу на протяжении всего саба',
    category: 'Стыки и тайминги',
    icon: Users,
    color: 'text-orange-400 bg-orange-950/40 border-orange-500/30',
    defaultChecked: true
  },
  {
    key: 'scanOverlaps',
    title: 'Наезды хвостов реплик',
    subtitle: 'Хвост фразы одного дабера наезжает на начало фразы другого (при отсутствии наезда сабов)',
    category: 'Стыки и тайминги',
    icon: Layers,
    color: 'text-purple-400 bg-purple-950/40 border-purple-500/30',
    defaultChecked: true
  },
  {
    key: 'scanTimingMismatches',
    title: 'Рассинхрон и вылет из тайминга',
    subtitle: 'Фразы короче саба (>30%, висит хвост оригинала) или длиннее саба (>40%, вылет за саб)',
    category: 'Стыки и тайминги',
    icon: Clock,
    color: 'text-sky-400 bg-sky-950/40 border-sky-500/30',
    defaultChecked: true
  },
  {
    key: 'scanArtifacts',
    title: 'Акустический брак и артефакты',
    subtitle: 'Клиппинг/перегруз (0 dBFS), щелчки мыши, задувы микрофона (П/Б), резкие обрывы гейтом',
    category: 'Качество записи',
    icon: Radio,
    color: 'text-rose-400 bg-rose-950/40 border-rose-500/30',
    defaultChecked: true
  },
  {
    key: 'scanWhisperText',
    title: 'Сверка текста через Whisper ASR',
    subtitle: 'Сверка произнесённых слов со сценарием с передачей подсказок (prompt) для поиска оговорок',
    category: 'Текст и ASR',
    icon: FileText,
    color: 'text-emerald-400 bg-emerald-950/40 border-emerald-500/30',
    badge: 'Whisper AI',
    defaultChecked: false
  }
];

export const QAScanConfigModal: React.FC<QAScanConfigModalProps> = ({
  isOpen,
  onClose,
  onStartScan,
  initialOptions,
  totalDubbers,
  totalSubLines
}) => {
  // Individual check states
  const [scanMissingLines, setScanMissingLines] = useState<boolean>(initialOptions?.scanMissingLines ?? true);
  const [scanUnwantedSpeech, setScanUnwantedSpeech] = useState<boolean>(initialOptions?.scanUnwantedSpeech ?? true);
  const [scanCollisions, setScanCollisions] = useState<boolean>(initialOptions?.scanCollisions ?? true);
  const [scanOverlaps, setScanOverlaps] = useState<boolean>(initialOptions?.scanOverlaps ?? true);
  const [scanTimingMismatches, setScanTimingMismatches] = useState<boolean>(initialOptions?.scanTimingMismatches ?? true);
  const [scanArtifacts, setScanArtifacts] = useState<boolean>(initialOptions?.scanArtifacts ?? true);
  const [scanWhisperText, setScanWhisperText] = useState<boolean>(initialOptions?.scanWhisperText ?? false);

  // Whisper model choice
  const [whisperModel, setWhisperModel] = useState<string>(initialOptions?.whisperModel || 'small');

  // Sensitivity threshold (speech dynamic delta)
  const [sensitivityDb, setSensitivityDb] = useState<number>(initialOptions?.speechDynamicThresholdDb ?? 3.0);

  if (!isOpen) return null;

  const stateMap: Record<string, [boolean, (val: boolean) => void]> = {
    scanMissingLines: [scanMissingLines, setScanMissingLines],
    scanUnwantedSpeech: [scanUnwantedSpeech, setScanUnwantedSpeech],
    scanCollisions: [scanCollisions, setScanCollisions],
    scanOverlaps: [scanOverlaps, setScanOverlaps],
    scanTimingMismatches: [scanTimingMismatches, setScanTimingMismatches],
    scanArtifacts: [scanArtifacts, setScanArtifacts],
    scanWhisperText: [scanWhisperText, setScanWhisperText]
  };

  const selectedCount = Object.values(stateMap).filter(([val]) => val).length;

  const handleSelectAll = () => {
    Object.values(stateMap).forEach(([, setter]) => setter(true));
  };

  const handleResetDefaults = () => {
    setScanMissingLines(true);
    setScanUnwantedSpeech(true);
    setScanCollisions(true);
    setScanOverlaps(true);
    setScanTimingMismatches(true);
    setScanArtifacts(true);
    setScanWhisperText(false);
    setWhisperModel('small');
    setSensitivityDb(3.0);
  };

  const handleStart = () => {
    onStartScan({
      scanMissingLines,
      scanUnwantedSpeech,
      scanCollisions,
      scanOverlaps,
      scanTimingMismatches,
      scanArtifacts,
      scanWhisperText,
      whisperModel,
      speechDynamicThresholdDb: sensitivityDb,
      silencePeakThresholdDb: -52,
      silenceRmsThresholdDb: -60,
      shortLineThresholdPercent: 30,
      longLineThresholdPercent: 40
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-3xl bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-900/90 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-inner">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-neutral-100 flex items-center gap-2">
                Настройка проверок качества озвучки
                <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400 border border-neutral-700 font-normal">
                  {totalDubbers} даб. / {totalSubLines} саб.
                </span>
              </h2>
              <p className="text-xs text-neutral-400">
                Отметьте детекторы для анализа дорожек перед запуском сканирования
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded-lg transition-colors"
            title="Закрыть"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Quick select bar */}
          <div className="flex items-center justify-between pb-2 border-b border-neutral-800/60">
            <span className="text-xs font-medium text-neutral-400">
              Выбрано проверок: <strong className="text-neutral-200">{selectedCount} из {QA_CHECK_ITEMS.length}</strong>
            </span>
            <div className="flex items-center gap-3 text-xs">
              <button
                type="button"
                onClick={handleSelectAll}
                className="text-amber-400 hover:text-amber-300 font-medium transition-colors"
              >
                Выбрать все
              </button>
              <span className="text-neutral-700">|</span>
              <button
                type="button"
                onClick={handleResetDefaults}
                className="text-neutral-400 hover:text-neutral-300 transition-colors"
              >
                По умолчанию
              </button>
            </div>
          </div>

          {/* Checklist of detectors */}
          <div className="space-y-2.5">
            {QA_CHECK_ITEMS.map((item) => {
              const [checked, setter] = stateMap[item.key] || [false, () => {}];
              const IconComp = item.icon;

              return (
                <div
                  key={item.key}
                  onClick={() => setter(!checked)}
                  className={`flex items-start gap-3.5 p-3.5 rounded-xl border transition-all cursor-pointer select-none ${
                    checked
                      ? 'bg-neutral-800/60 border-neutral-700 shadow-sm'
                      : 'bg-neutral-900/40 border-neutral-800/60 opacity-60 hover:opacity-90 hover:bg-neutral-800/30'
                  }`}
                >
                  <button
                    type="button"
                    className="mt-0.5 text-neutral-400 hover:text-neutral-200 focus:outline-none"
                  >
                    {checked ? (
                      <CheckSquare className="w-5 h-5 text-amber-400" />
                    ) : (
                      <Square className="w-5 h-5 text-neutral-500" />
                    )}
                  </button>

                  <div className={`p-2 rounded-lg border ${item.color} shrink-0 mt-0.5`}>
                    <IconComp className="w-4 h-4" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-neutral-200">
                        {item.title}
                      </span>
                      {item.badge && (
                        <span className="text-[10px] uppercase font-semibold tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-400 mt-0.5 leading-relaxed">
                      {item.subtitle}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Whisper Options Details (when scanWhisperText is selected) */}
          {scanWhisperText && (
            <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/30 space-y-3 animate-in fade-in duration-200">
              <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
                <Sparkles className="w-4 h-4" />
                <span>Параметры сверки текста через Whisper</span>
              </div>
              <p className="text-xs text-neutral-300 leading-relaxed">
                Модель Whisper расшифрует произнесённые фрагменты речи с передачей субтитров в качестве подсказок (<code className="px-1 py-0.5 rounded bg-neutral-800 text-neutral-200">prompt context</code>), что гарантирует безошибочное распознавание японских имён, приёмов и терминов.
              </p>

              <div className="space-y-1.5 pt-1">
                <label className="text-xs font-medium text-neutral-300 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-neutral-400" />
                  Модель распознавания:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setWhisperModel('small')}
                    className={`px-3 py-2 rounded-lg border text-left text-xs transition-all ${
                      whisperModel === 'small'
                        ? 'bg-emerald-600/30 border-emerald-500 text-emerald-200 font-medium shadow-sm'
                        : 'bg-neutral-800/60 border-neutral-700 text-neutral-400 hover:bg-neutral-800'
                    }`}
                  >
                    <div className="font-semibold text-neutral-100 flex items-center justify-between">
                      <span>small</span>
                      <span className="text-[10px] text-emerald-400 font-normal">Рекомендуется</span>
                    </div>
                    <div className="text-[11px] text-neutral-400 mt-0.5">
                      Высокая точность русского языка (~460 МБ)
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setWhisperModel('base')}
                    className={`px-3 py-2 rounded-lg border text-left text-xs transition-all ${
                      whisperModel === 'base'
                        ? 'bg-emerald-600/30 border-emerald-500 text-emerald-200 font-medium shadow-sm'
                        : 'bg-neutral-800/60 border-neutral-700 text-neutral-400 hover:bg-neutral-800'
                    }`}
                  >
                    <div className="font-semibold text-neutral-100">base</div>
                    <div className="text-[11px] text-neutral-400 mt-0.5">
                      Быстрое распознавание (~140 МБ)
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setWhisperModel('tiny')}
                    className={`px-3 py-2 rounded-lg border text-left text-xs transition-all ${
                      whisperModel === 'tiny'
                        ? 'bg-emerald-600/30 border-emerald-500 text-emerald-200 font-medium shadow-sm'
                        : 'bg-neutral-800/60 border-neutral-700 text-neutral-400 hover:bg-neutral-800'
                    }`}
                  >
                    <div className="font-semibold text-neutral-100">tiny</div>
                    <div className="text-[11px] text-neutral-400 mt-0.5">
                      Мгновенный черновой ASR (~75 МБ)
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Voice Activity Detection Sensitivity */}
          <div className="p-4 rounded-xl bg-neutral-800/40 border border-neutral-800 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-neutral-300 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-neutral-400" />
                Порог динамического перепада речи (VAD)
              </label>
              <span className="text-xs font-semibold text-amber-400">
                {sensitivityDb.toFixed(1)} дБ
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 leading-normal">
              Минимальный разбег RMS внутри фразы для отделения речи от шума микрофона.
            </p>
            <div className="grid grid-cols-3 gap-2 pt-1">
              {[
                { db: 2.0, label: 'Высокая (2.0 дБ)', desc: 'Ловит даже тихий шёпот' },
                { db: 3.0, label: 'Стандарт (3.0 дБ)', desc: 'Оптимально для аниме' },
                { db: 4.5, label: 'Низкая (4.5 дБ)', desc: 'Для зашумлённых дорожек' }
              ].map(opt => (
                <button
                  key={opt.db}
                  type="button"
                  onClick={() => setSensitivityDb(opt.db)}
                  className={`p-2 rounded-lg border text-left text-xs transition-all ${
                    Math.abs(sensitivityDb - opt.db) < 0.1
                      ? 'bg-amber-500/20 border-amber-500/60 text-amber-200 font-medium'
                      : 'bg-neutral-800/40 border-neutral-700/60 text-neutral-400 hover:bg-neutral-800'
                  }`}
                >
                  <div className="font-medium text-neutral-200">{opt.label}</div>
                  <div className="text-[10px] text-neutral-400 mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Buttons */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-neutral-800 bg-neutral-900/90 sticky bottom-0 z-10">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded-lg transition-colors"
          >
            Отмена
          </button>

          <button
            type="button"
            onClick={handleStart}
            disabled={selectedCount === 0}
            className={`px-5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg transition-all ${
              selectedCount === 0
                ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
                : 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-neutral-950 font-bold shadow-amber-500/20'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>Начать проверку ({selectedCount} {selectedCount === 1 ? 'проверка' : selectedCount < 5 ? 'проверки' : 'проверок'})</span>
          </button>
        </div>
      </div>
    </div>
  );
};
