import React, { useState, useEffect, useCallback } from 'react';
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
  Cpu,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Mic,
  Activity,
  Flame,
  BookOpen,
  UserCheck,
  ChevronDown,
  ChevronRight,
  Download,
  RotateCcw,
  Save,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  ActingModelsStatus,
  ActingResourceProfile,
  DEFAULT_QA_DETECTION_SETTINGS,
  GapDetectionOptions,
  OriginalStemMode,
  OriginalStemModel,
  QADetectionSettings,
  QAPresetId,
  QA_PRESET_SOFT,
  QA_PRESET_STANDARD,
  QA_PRESET_STRICT,
  StressCheckMode,
} from '../../lib/qa/detector/missingLinesTypes';
import { checkWhisperSystemReadiness, WhisperReadinessResult } from '../../lib/qa/whisperTextChecker';
import { qaActingService } from '../../services/qaActingService';

interface QAScanConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartScan: (options: GapDetectionOptions) => void;
  onSaveOptions?: (options: QADetectionSettings) => void;
  initialOptions?: Partial<GapDetectionOptions>;
  totalDubbers: number;
  totalSubLines: number;
}

export interface QACheckItem {
  key: keyof QADetectionSettings;
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
    title: 'Пропуски реплик и тишина',
    subtitle: 'Поиск реплик персонажей, где дабер промолчал или оставил только статичный шум',
    category: 'Реплики',
    icon: VolumeX,
    color: 'text-red-400 bg-red-950/40 border-red-500/30',
    defaultChecked: true,
  },
  {
    key: 'scanUnwantedSpeech',
    title: 'Лишняя речь вне субтитров',
    subtitle: 'Поиск посторонних фраз, смешков, оговорок или неудачных дублей вне таймингов сабов',
    category: 'Реплики',
    icon: MessageSquareOff,
    color: 'text-amber-400 bg-amber-950/40 border-amber-500/30',
    defaultChecked: true,
  },
  {
    key: 'scanCollisions',
    title: 'Конфликты дубляжа (два дабера)',
    subtitle: 'Выявление реплик, где оба дабера озвучили одну и ту же фразу',
    category: 'Стыки и тайминги',
    icon: Users,
    color: 'text-orange-400 bg-orange-950/40 border-orange-500/30',
    defaultChecked: true,
  },
  {
    key: 'scanOverlaps',
    title: 'Наезды хвостов реплик',
    subtitle: 'Хвост фразы одного дабера наезжает на начало фразы другого без наезда сабов',
    category: 'Стыки и тайминги',
    icon: Layers,
    color: 'text-purple-400 bg-purple-950/40 border-purple-500/30',
    defaultChecked: true,
  },
  {
    key: 'scanTimingMismatches',
    title: 'Рассинхрон и вылет из тайминга',
    subtitle: 'Фразы короче саба (висит японский хвост) или длиннее саба (вылет за границу)',
    category: 'Стыки и тайминги',
    icon: Clock,
    color: 'text-sky-400 bg-sky-950/40 border-sky-500/30',
    defaultChecked: true,
  },
  {
    key: 'scanArtifacts',
    title: 'Акустический брак и артефакты',
    subtitle: 'Клиппинг/перегруз, щелчки мыши, задувы микрофона (П/Б), обрывы гейтом',
    category: 'Качество записи',
    icon: Radio,
    color: 'text-rose-400 bg-rose-950/40 border-rose-500/30',
    defaultChecked: true,
  },
  {
    key: 'scanWhisperText',
    title: 'Сверка текста через Whisper ASR',
    subtitle: 'Сверка произнесённых слов со сценарием для поиска пропущенных или заменённых слов',
    category: 'Текст и ASR',
    icon: FileText,
    color: 'text-emerald-400 bg-emerald-950/40 border-emerald-500/30',
    badge: 'Whisper',
    defaultChecked: true,
  },
  {
    key: 'scanSpeechDisfluencies',
    title: 'Сбивки, оговорки, кашель и вздохи',
    subtitle: 'Повторы слов, обрывы посередине фразы, затянутые паузы, кашель/вздохи (с кросс-чеком оригинала)',
    category: 'Дикция и подача',
    icon: Mic,
    color: 'text-amber-300 bg-amber-950/40 border-amber-500/30',
    badge: 'AI_env',
    defaultChecked: true,
  },
  {
    key: 'scanDictionClarity',
    title: 'Чёткость дикции, комканье и темп речи',
    subtitle: 'Анализ чёткости согласных/гласных (GOP) и сопоставление скорости речи с оригиналом',
    category: 'Дикция и подача',
    icon: Activity,
    color: 'text-cyan-400 bg-cyan-950/40 border-cyan-500/30',
    badge: 'AI_env',
    defaultChecked: true,
  },
  {
    key: 'scanEmotionMismatch',
    title: 'Эмоции, энергетика и монотонность',
    subtitle: 'Сравнение эмоциональной подачи (arousal/valence) и интонационного диапазона F0 с оригиналом',
    category: 'Актёрская подача',
    icon: Flame,
    color: 'text-rose-300 bg-rose-950/40 border-rose-500/30',
    badge: 'AI_env',
    defaultChecked: true,
  },
  {
    key: 'scanStressErrors',
    title: 'Ошибки ударений в именах и словах',
    subtitle: 'Проверка ударений по словарю проекта и RUAccent + акустическое подтверждение по слогам',
    category: 'Актёрская подача',
    icon: BookOpen,
    color: 'text-yellow-300 bg-yellow-950/40 border-yellow-500/30',
    badge: 'AI_env',
    defaultChecked: true,
  },
  {
    key: 'scanPersonaMismatch',
    title: 'Попадание в образ, возраст и тембр',
    subtitle: 'Сверка возраста/пола голоса и сходства тембра (ECAPA + F0) с профилем персонажа',
    category: 'Актёрская подача',
    icon: UserCheck,
    color: 'text-indigo-300 bg-indigo-950/40 border-indigo-500/30',
    badge: 'AI_env',
    defaultChecked: true,
  },
];

interface NumberParamProps {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (val: number) => void;
}

const NumberParamRow: React.FC<NumberParamProps> = ({
  label,
  hint,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-1.5">
    <div className="min-w-0 flex-1">
      <div className="text-xs font-medium text-neutral-200">{label}</div>
      {hint && <div className="text-[11px] text-neutral-500 leading-snug">{hint}</div>}
    </div>
    <div className="flex items-center gap-2.5 shrink-0">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-28 sm:w-32 accent-amber-500 cursor-pointer"
      />
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const parsed = parseFloat(e.target.value);
            if (!isNaN(parsed)) onChange(parsed);
          }}
          className="w-20 bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-right text-xs font-mono tabular-nums text-neutral-100 focus:outline-none focus:border-amber-500"
        />
        {unit && <span className="text-[11px] font-mono text-neutral-400 w-7">{unit}</span>}
      </div>
    </div>
  </div>
);

export const QAScanConfigModal: React.FC<QAScanConfigModalProps> = ({
  isOpen,
  onClose,
  onStartScan,
  onSaveOptions,
  initialOptions,
  totalDubbers,
  totalSubLines,
}) => {
  const [settings, setSettings] = useState<QADetectionSettings>(() => ({
    ...DEFAULT_QA_DETECTION_SETTINGS,
    ...initialOptions,
  }));
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Whisper readiness
  const [whisperReadiness, setWhisperReadiness] = useState<WhisperReadinessResult & { loading: boolean; checked: boolean }>({
    loading: false,
    checked: false,
    isReady: true,
    canLoadModel: true,
    availableModels: ['small', 'base', 'tiny'],
    activeModel: settings.whisperModel || 'small',
    statusText: 'Готова к проверке',
    details: 'Служба Whisper ожидает запуска',
  });

  // Acting AI models readiness
  const [actingStatus, setActingStatus] = useState<(ActingModelsStatus & { loading?: boolean }) | null>(null);
  const [isDownloadingModels, setIsDownloadingModels] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{ percent: number; message: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSettings({
        ...DEFAULT_QA_DETECTION_SETTINGS,
        ...initialOptions,
      });
    }
  }, [isOpen, initialOptions]);

  const refreshWhisperReadiness = useCallback(async (modelToProbe: string) => {
    setWhisperReadiness((prev) => ({ ...prev, loading: true }));
    try {
      const result = await checkWhisperSystemReadiness(modelToProbe);
      setWhisperReadiness({
        ...result,
        loading: false,
        checked: true,
      });
    } catch (e: any) {
      setWhisperReadiness({
        loading: false,
        checked: true,
        isReady: false,
        canLoadModel: false,
        availableModels: ['small', 'base', 'tiny'],
        activeModel: modelToProbe,
        statusText: 'Сбой проверки доступности Whisper',
        errorMessage: e?.message || 'Не удалось связаться со службой Whisper',
        details: String(e),
      });
    }
  }, []);

  const refreshActingModels = useCallback(async (profile: ActingResourceProfile) => {
    setActingStatus((prev) => ({
      profile,
      ready: prev?.ready ?? false,
      missingCount: prev?.missingCount ?? 0,
      totalMissingMb: prev?.totalMissingMb ?? 0,
      models: prev?.models ?? [],
      loading: true,
    }));
    try {
      const res = await qaActingService.checkModels(profile);
      setActingStatus({ ...res, loading: false });
    } catch (e: any) {
      setActingStatus({
        profile,
        ready: false,
        missingCount: 0,
        totalMissingMb: 0,
        models: [],
        error: e?.message || String(e),
        loading: false,
      });
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      refreshWhisperReadiness(settings.whisperModel);
    }
  }, [isOpen, settings.whisperModel, refreshWhisperReadiness]);

  useEffect(() => {
    if (isOpen) {
      refreshActingModels(settings.actingResourceProfile);
    }
  }, [isOpen, settings.actingResourceProfile, refreshActingModels]);

  if (!isOpen) return null;

  const updateField = <K extends keyof QADetectionSettings>(key: K, val: QADetectionSettings[K], markCustom = true) => {
    setSettings((prev) => ({
      ...prev,
      [key]: val,
      presetId: markCustom && key !== 'presetId' ? 'custom' : prev.presetId,
    }));
  };

  const applyPreset = (presetId: Exclude<QAPresetId, 'custom'>) => {
    const base =
      presetId === 'soft'
        ? QA_PRESET_SOFT
        : presetId === 'strict'
        ? QA_PRESET_STRICT
        : QA_PRESET_STANDARD;
    setSettings({ ...base });
  };

  const handleSelectAll = () => {
    setSettings((prev) => ({
      ...prev,
      scanMissingLines: true,
      scanUnwantedSpeech: true,
      scanCollisions: true,
      scanOverlaps: true,
      scanTimingMismatches: true,
      scanArtifacts: true,
      scanWhisperText: true,
      scanSpeechDisfluencies: true,
      scanDictionClarity: true,
      scanEmotionMismatch: true,
      scanStressErrors: true,
      scanPersonaMismatch: true,
    }));
  };

  const handleResetDefaults = () => {
    setSettings({ ...DEFAULT_QA_DETECTION_SETTINGS });
    toast.info('Настройки QA сброшены к стандартным');
  };

  const handleDownloadModels = async () => {
    setIsDownloadingModels(true);
    setDownloadProgress({ percent: 0, message: 'Запуск загрузки локальных моделей AI_env...' });
    const unsub = qaActingService.subscribeProgress((prog) => {
      if (prog.stage === 'models') {
        setDownloadProgress({ percent: prog.percent, message: prog.message });
      }
    });
    try {
      const res = await qaActingService.downloadModels(settings.actingResourceProfile);
      setActingStatus({ ...res, loading: false });
      if (res.ready) {
        toast.success('Все локальные модели актёрского QA загружены!');
      } else {
        toast.warning(res.error || 'Некоторые модели не загрузились');
      }
    } catch (e: any) {
      toast.error(`Ошибка загрузки моделей: ${e?.message || e}`);
    } finally {
      unsub();
      setIsDownloadingModels(false);
      setDownloadProgress(null);
    }
  };

  const handleSaveOnly = async () => {
    setIsSaving(true);
    try {
      await qaActingService.saveDetectionSettings(settings);
      onSaveOptions?.(settings);
      toast.success('Параметры QA сохранены');
      onClose();
    } catch (e: any) {
      toast.error(`Ошибка сохранения параметров: ${e?.message || e}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleStart = async () => {
    try {
      await qaActingService.saveDetectionSettings(settings);
    } catch {}
    onSaveOptions?.(settings);
    onStartScan(settings);
    onClose();
  };

  const selectedCount = QA_CHECK_ITEMS.filter((item) => Boolean(settings[item.key])).length;
  const anyActingSelected =
    settings.scanSpeechDisfluencies ||
    settings.scanDictionClarity ||
    settings.scanEmotionMismatch ||
    settings.scanStressErrors ||
    settings.scanPersonaMismatch;

  const renderCategoryParams = (key: keyof QADetectionSettings) => {
    switch (key) {
      case 'scanMissingLines':
        return (
          <div className="space-y-1 divide-y divide-neutral-800/70">
            <NumberParamRow
              label="Порог динамического перепада речи (VAD)"
              hint="Минимальный перепад RMS внутри фразы для отделения речи от статичного шума"
              value={settings.speechDynamicThresholdDb}
              min={1.0}
              max={10.0}
              step={0.5}
              unit="дБ"
              onChange={(v) => updateField('speechDynamicThresholdDb', v)}
            />
            <NumberParamRow
              label="Порог пика тишины"
              hint="Ниже этого уровня фрагмент считается полностью пустым"
              value={settings.silencePeakThresholdDb}
              min={-75}
              max={-25}
              step={1}
              unit="дБ"
              onChange={(v) => updateField('silencePeakThresholdDb', v)}
            />
            <NumberParamRow
              label="Порог RMS тишины"
              hint="Средняя энергия сигнала, ниже которой речи точно нет"
              value={settings.silenceRmsThresholdDb}
              min={-80}
              max={-35}
              step={1}
              unit="дБ"
              onChange={(v) => updateField('silenceRmsThresholdDb', v)}
            />
            <NumberParamRow
              label="Мин. длительность реплики субтитра"
              hint="Более короткие субтитры (вздохи/знаки) игнорируются"
              value={settings.minDurationSec}
              min={0.05}
              max={1.0}
              step={0.05}
              unit="с"
              onChange={(v) => updateField('minDurationSec', v)}
            />
            <NumberParamRow
              label="Макс. разброс шума (StdDev)"
              hint="Если StdDev громкости ниже порога и нет пиков — считается монотонным шумом"
              value={settings.stationaryNoiseStdDevDb}
              min={0.3}
              max={4.0}
              step={0.1}
              unit="дБ"
              onChange={(v) => updateField('stationaryNoiseStdDevDb', v)}
            />
            <NumberParamRow
              label="Макс. пик стационарного шума"
              hint="Выше этого пика звук считается громким сигналом, а не фоновым шумом"
              value={settings.stationaryNoisePeakDb}
              min={-45}
              max={-10}
              step={1}
              unit="дБ"
              onChange={(v) => updateField('stationaryNoisePeakDb', v)}
            />
          </div>
        );

      case 'scanUnwantedSpeech':
        return (
          <div className="space-y-1 divide-y divide-neutral-800/70">
            <NumberParamRow
              label="Защитный допуск ДО своей реплики"
              value={settings.unwantedOwnSubPreMarginSec}
              min={0.2}
              max={5.0}
              step={0.1}
              unit="с"
              onChange={(v) => updateField('unwantedOwnSubPreMarginSec', v)}
            />
            <NumberParamRow
              label="Защитный допуск ПОСЛЕ своей реплики"
              value={settings.unwantedOwnSubPostMarginSec}
              min={0.2}
              max={5.0}
              step={0.1}
              unit="с"
              onChange={(v) => updateField('unwantedOwnSubPostMarginSec', v)}
            />
            <NumberParamRow
              label="Защитный допуск ДО чужой реплики"
              value={settings.unwantedOtherSubPreMarginSec}
              min={0.2}
              max={4.0}
              step={0.1}
              unit="с"
              onChange={(v) => updateField('unwantedOtherSubPreMarginSec', v)}
            />
            <NumberParamRow
              label="Защитный допуск ПОСЛЕ чужой реплики"
              value={settings.unwantedOtherSubPostMarginSec}
              min={0.2}
              max={4.0}
              step={0.1}
              unit="с"
              onChange={(v) => updateField('unwantedOtherSubPostMarginSec', v)}
            />
            <NumberParamRow
              label="Мин. длительность лишней речи"
              value={settings.unwantedMinBurstSec}
              min={0.15}
              max={2.0}
              step={0.05}
              unit="с"
              onChange={(v) => updateField('unwantedMinBurstSec', v)}
            />
            <NumberParamRow
              label="Мин. пик лишней речи"
              value={settings.unwantedPeakThresholdDb}
              min={-55}
              max={-18}
              step={1}
              unit="дБ"
              onChange={(v) => updateField('unwantedPeakThresholdDb', v)}
            />
            <NumberParamRow
              label="Мин. RMS лишней речи"
              value={settings.unwantedRmsThresholdDb}
              min={-65}
              max={-25}
              step={1}
              unit="дБ"
              onChange={(v) => updateField('unwantedRmsThresholdDb', v)}
            />
          </div>
        );

      case 'scanCollisions':
        return (
          <div className="space-y-1 divide-y divide-neutral-800/70">
            <NumberParamRow
              label="Мин. доля перекрытия фразы (0.1 – 1.0)"
              hint="Какую долю субтитра должны говорить оба дабера, чтобы засчитать конфликт"
              value={settings.collisionMinCoverageRatio}
              min={0.15}
              max={0.95}
              step={0.05}
              onChange={(v) => updateField('collisionMinCoverageRatio', v)}
            />
            <NumberParamRow
              label="Мин. пик речи для участия в конфликте"
              value={settings.collisionPeakThresholdDb}
              min={-55}
              max={-18}
              step={1}
              unit="дБ"
              onChange={(v) => updateField('collisionPeakThresholdDb', v)}
            />
            <NumberParamRow
              label="Допуск параллельных субтитров"
              hint="Игнорировать конфликт, если в сабах реально прописан синхронный диалог"
              value={settings.collisionParallelSubToleranceSec}
              min={0.0}
              max={0.5}
              step={0.02}
              unit="с"
              onChange={(v) => updateField('collisionParallelSubToleranceSec', v)}
            />
          </div>
        );

      case 'scanOverlaps':
        return (
          <div className="space-y-1 divide-y divide-neutral-800/70">
            <NumberParamRow
              label="Мин. наезд хвоста фраз"
              hint="Минимальное пересечение аудиодорожек двух даберов на стыке"
              value={settings.overlapMinSec}
              min={0.04}
              max={1.0}
              step={0.02}
              unit="с"
              onChange={(v) => updateField('overlapMinSec', v)}
            />
            <NumberParamRow
              label="Разрешённый наезд в сабах"
              value={settings.overlapAllowedSubOverlapSec}
              min={0.0}
              max={0.5}
              step={0.02}
              unit="с"
              onChange={(v) => updateField('overlapAllowedSubOverlapSec', v)}
            />
            <NumberParamRow
              label="Мин. выход речи за границу своего саба"
              value={settings.overlapMinSubBoundaryOverrunSec}
              min={0.05}
              max={1.0}
              step={0.05}
              unit="с"
              onChange={(v) => updateField('overlapMinSubBoundaryOverrunSec', v)}
            />
          </div>
        );

      case 'scanTimingMismatches':
        return (
          <div className="space-y-1 divide-y divide-neutral-800/70">
            <NumberParamRow
              label="Порог недобора (короче саба на %)"
              value={settings.shortLineThresholdPercent}
              min={10}
              max={75}
              step={1}
              unit="%"
              onChange={(v) => updateField('shortLineThresholdPercent', v)}
            />
            <NumberParamRow
              label="Мин. разница при недоборе"
              value={settings.shortLineMinDiffSec}
              min={0.1}
              max={2.0}
              step={0.05}
              unit="с"
              onChange={(v) => updateField('shortLineMinDiffSec', v)}
            />
            <NumberParamRow
              label="Мин. висящий хвост оригинала"
              value={settings.shortLineMinTailSec}
              min={0.1}
              max={1.5}
              step={0.02}
              unit="с"
              onChange={(v) => updateField('shortLineMinTailSec', v)}
            />
            <NumberParamRow
              label="Порог перебора / вылета (длиннее саба на %)"
              value={settings.longLineThresholdPercent}
              min={10}
              max={100}
              step={1}
              unit="%"
              onChange={(v) => updateField('longLineThresholdPercent', v)}
            />
            <NumberParamRow
              label="Мин. вылет за конец саба"
              value={settings.longLineMinOverflowSec}
              min={0.1}
              max={2.0}
              step={0.05}
              unit="с"
              onChange={(v) => updateField('longLineMinOverflowSec', v)}
            />
          </div>
        );

      case 'scanArtifacts':
        return (
          <div className="space-y-2.5 text-xs">
            <div className="space-y-1 border-b border-neutral-800/70 pb-2">
              <label className="flex items-center gap-2 font-semibold text-neutral-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.detectClipping}
                  onChange={(e) => updateField('detectClipping', e.target.checked)}
                  className="accent-amber-500"
                />
                <span>Клиппинг / Перегруз</span>
              </label>
              {settings.detectClipping && (
                <>
                  <NumberParamRow
                    label="Мин. сэмплов перегруза подряд"
                    value={settings.clipMinConsecutive}
                    min={1}
                    max={12}
                    step={1}
                    onChange={(v) => updateField('clipMinConsecutive', v)}
                  />
                  <NumberParamRow
                    label="Порог клиппинга (0.900 – 1.000)"
                    value={settings.clipThresholdLinear}
                    min={0.9}
                    max={1.0}
                    step={0.0005}
                    onChange={(v) => updateField('clipThresholdLinear', v)}
                  />
                </>
              )}
            </div>

            <div className="space-y-1 border-b border-neutral-800/70 pb-2">
              <label className="flex items-center gap-2 font-semibold text-neutral-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.detectClicks}
                  onChange={(e) => updateField('detectClicks', e.target.checked)}
                  className="accent-amber-500"
                />
                <span>Щелчки мыши / цифровые клики</span>
              </label>
              {settings.detectClicks && (
                <>
                  <NumberParamRow
                    label="Отношение скачка (Click Ratio)"
                    value={settings.clickRatioThreshold}
                    min={8}
                    max={40}
                    step={0.5}
                    onChange={(v) => updateField('clickRatioThreshold', v)}
                  />
                  <NumberParamRow
                    label="Мин. амплитуда скачка (0.02 – 0.30)"
                    value={settings.clickMinDiff}
                    min={0.02}
                    max={0.3}
                    step={0.01}
                    onChange={(v) => updateField('clickMinDiff', v)}
                  />
                </>
              )}
            </div>

            <div className="space-y-1 border-b border-neutral-800/70 pb-2">
              <label className="flex items-center gap-2 font-semibold text-neutral-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.detectPlosives}
                  onChange={(e) => updateField('detectPlosives', e.target.checked)}
                  className="accent-amber-500"
                />
                <span>Задувы микрофона (П/Б)</span>
              </label>
              {settings.detectPlosives && (
                <>
                  <NumberParamRow
                    label="Порог низких частот задува"
                    value={settings.plosiveLowDbThreshold}
                    min={-35}
                    max={-8}
                    step={1}
                    unit="дБ"
                    onChange={(v) => updateField('plosiveLowDbThreshold', v)}
                  />
                  <NumberParamRow
                    label="Перепад НЧ/СЧ (Plosive Delta)"
                    value={settings.plosiveDeltaDbThreshold}
                    min={-8}
                    max={6}
                    step={0.5}
                    unit="дБ"
                    onChange={(v) => updateField('plosiveDeltaDbThreshold', v)}
                  />
                </>
              )}
            </div>

            <div className="space-y-1">
              <label className="flex items-center gap-2 font-semibold text-neutral-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.detectSwallowed}
                  onChange={(e) => updateField('detectSwallowed', e.target.checked)}
                  className="accent-amber-500"
                />
                <span>Обрывы гейтом / съеденные гласные</span>
              </label>
              {settings.detectSwallowed && (
                <>
                  <NumberParamRow
                    label="Резкое падение уровня (Cutoff Drop)"
                    value={settings.cutoffDropDbThreshold}
                    min={12}
                    max={40}
                    step={1}
                    unit="дБ"
                    onChange={(v) => updateField('cutoffDropDbThreshold', v)}
                  />
                  <NumberParamRow
                    label="Мин. длительность саба для проверки обрыва"
                    value={settings.cutoffMinSubDurationSec}
                    min={0.5}
                    max={4.0}
                    step={0.1}
                    unit="с"
                    onChange={(v) => updateField('cutoffMinSubDurationSec', v)}
                  />
                </>
              )}
            </div>
          </div>
        );

      case 'scanWhisperText':
        return (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs">
                {whisperReadiness.loading ? (
                  <span className="text-neutral-400 inline-flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Проверка службы Whisper...
                  </span>
                ) : whisperReadiness.isReady && whisperReadiness.canLoadModel ? (
                  <span className="text-emerald-400 inline-flex items-center gap-1.5 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {whisperReadiness.statusText}
                  </span>
                ) : (
                  <span className="text-rose-400 inline-flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5" /> {whisperReadiness.statusText}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => refreshWhisperReadiness(settings.whisperModel)}
                disabled={whisperReadiness.loading}
                className="px-2.5 py-1 rounded border border-neutral-700 bg-neutral-800 text-[11px] text-neutral-200 hover:bg-neutral-700 inline-flex items-center gap-1 whitespace-nowrap"
              >
                <RefreshCw className={`w-3 h-3 ${whisperReadiness.loading ? 'animate-spin' : ''}`} />
                Проверить
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'small', desc: 'Точный RU (~460 МБ)' },
                { id: 'base', desc: 'Баланс (~140 МБ)' },
                { id: 'tiny', desc: 'Быстрый (~75 МБ)' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => updateField('whisperModel', m.id)}
                  className={`px-3 py-2 rounded-lg border text-left text-xs transition-colors ${
                    settings.whisperModel === m.id
                      ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-200 font-semibold'
                      : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <div className="font-mono">{m.id}</div>
                  <div className="text-[10px] text-neutral-400 mt-0.5">{m.desc}</div>
                </button>
              ))}
            </div>

            <NumberParamRow
              label="Мин. порог сходства текста с сабами"
              hint="Если сходство распознанной речи с субтитром ниже порога — фиксируется расхождение"
              value={settings.whisperSimilarityThresholdPercent}
              min={55}
              max={98}
              step={1}
              unit="%"
              onChange={(v) => updateField('whisperSimilarityThresholdPercent', v)}
            />
          </div>
        );

      case 'scanSpeechDisfluencies':
        return (
          <div className="space-y-1 divide-y divide-neutral-800/70">
            <NumberParamRow
              label="Макс. пауза внутри одной фразы"
              hint="Паузы длиннее этого порога внутри одной реплики отмечаются как заминка/сбивка"
              value={settings.disfluencyMaxPauseSec}
              min={0.2}
              max={1.5}
              step={0.05}
              unit="с"
              onChange={(v) => updateField('disfluencyMaxPauseSec', v)}
            />
            <NumberParamRow
              label="Чувствительность детектора кашля/вздохов (AST)"
              hint="Ниже значение — чувствительнее срабатывание на кашель, смех и придыхания"
              value={settings.disfluencyEventsThreshold}
              min={0.15}
              max={0.85}
              step={0.05}
              onChange={(v) => updateField('disfluencyEventsThreshold', v)}
            />
            <label className="flex items-center justify-between pt-2 text-xs text-neutral-200 cursor-pointer">
              <div>
                <div className="font-medium">Кросс-чек с оригиналом (японский стем)</div>
                <div className="text-[11px] text-neutral-500">
                  Не помечать кашель/вздох/смешок как брак, если он есть у персонажа в оригинале
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.disfluencyCrossCheckOriginal}
                onChange={(e) => updateField('disfluencyCrossCheckOriginal', e.target.checked)}
                className="accent-amber-500 w-4 h-4 shrink-0"
              />
            </label>
          </div>
        );

      case 'scanDictionClarity':
        return (
          <div className="space-y-1 divide-y divide-neutral-800/70">
            <NumberParamRow
              label="Мин. индекс чёткости дикции (GOP, 0.2 – 0.9)"
              hint="Ниже порога — слова скомканы или проглочены"
              value={settings.dictionMinGopScore}
              min={0.2}
              max={0.9}
              step={0.02}
              onChange={(v) => updateField('dictionMinGopScore', v)}
            />
            <NumberParamRow
              label="Макс. отличие темпа речи от оригинала"
              hint="Отклонение скорости в слогах/сек относительно японского вокала или нормы"
              value={settings.dictionMaxRateDeltaPercent}
              min={15}
              max={70}
              step={5}
              unit="%"
              onChange={(v) => updateField('dictionMaxRateDeltaPercent', v)}
            />
          </div>
        );

      case 'scanEmotionMismatch':
        return (
          <div className="space-y-1 divide-y divide-neutral-800/70">
            <NumberParamRow
              label="Макс. просадка энергетики / эмоций (Arousal Delta)"
              hint="Допустимая разница интенсивности подачи по сравнению с оригиналом"
              value={settings.emotionMaxArousalDelta}
              min={0.12}
              max={0.65}
              step={0.02}
              onChange={(v) => updateField('emotionMaxArousalDelta', v)}
            />
            <NumberParamRow
              label="Порог монотонности (F0 Ratio, 0.25 – 0.85)"
              hint="Выше порог — строже требование к выразительности интонации по сравнению с оригиналом"
              value={settings.emotionMaxPitchMonotonyRatio}
              min={0.25}
              max={0.85}
              step={0.05}
              onChange={(v) => updateField('emotionMaxPitchMonotonyRatio', v)}
            />
          </div>
        );

      case 'scanStressErrors':
        return (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-neutral-300 font-medium">Режим проверки ударений:</span>
              <div className="flex items-center gap-1.5">
                {[
                  { id: 'dictionary_and_text' as StressCheckMode, label: 'Словарь + Весь текст (RUAccent)' },
                  { id: 'dictionary_only' as StressCheckMode, label: 'Только словарь ударений' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => updateField('stressCheckMode', opt.id)}
                    className={`px-2.5 py-1 rounded border text-[11px] font-medium whitespace-nowrap transition-colors ${
                      settings.stressCheckMode === opt.id
                        ? 'bg-amber-500/20 border-amber-500/60 text-amber-200'
                        : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <NumberParamRow
              label="Порог акустического контраста слогов"
              hint="Минимальное превосходство ударного гласного по энергии/тону над остальными слогами"
              value={settings.stressContrastThresholdDb}
              min={1.0}
              max={6.0}
              step={0.2}
              unit="дБ"
              onChange={(v) => updateField('stressContrastThresholdDb', v)}
            />
          </div>
        );

      case 'scanPersonaMismatch':
        return (
          <div className="space-y-1 divide-y divide-neutral-800/70">
            <NumberParamRow
              label="Мин. сходство тембра с эталоном (ECAPA, 0.35 – 0.90)"
              value={settings.personaMinVoiceSimilarity}
              min={0.35}
              max={0.9}
              step={0.02}
              onChange={(v) => updateField('personaMinVoiceSimilarity', v)}
            />
            <NumberParamRow
              label="Макс. расхождение по возрасту с профилем"
              value={settings.personaMaxAgeDeltaYears}
              min={5}
              max={30}
              step={1}
              unit="лет"
              onChange={(v) => updateField('personaMaxAgeDeltaYears', v)}
            />
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div
        className="relative w-full max-w-4xl bg-neutral-900 border border-neutral-800 rounded-xl flex flex-col max-h-[92vh] overflow-hidden text-neutral-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-800 bg-neutral-900 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <Sliders className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-neutral-100 flex items-center gap-2 flex-wrap">
                <span>Настройки QA и детекторов качества</span>
                <span className="text-xs font-mono tabular-nums text-neutral-400">
                  {totalDubbers} даб. · {totalSubLines} саб.
                </span>
              </h2>
              <p className="text-xs text-neutral-400 truncate">
                Пресеты, пороги технических проверок, выделение японского стема и локальный актёрский анализ
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded-lg transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Presets & Quick Bar */}
        <div className="px-5 py-2.5 border-b border-neutral-800 bg-neutral-950/60 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-neutral-400 mr-1">Профиль порогов:</span>
            {[
              { id: 'soft' as const, label: 'Мягкий' },
              { id: 'standard' as const, label: 'Стандарт' },
              { id: 'strict' as const, label: 'Строгий' },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium border whitespace-nowrap transition-colors ${
                  settings.presetId === p.id
                    ? 'bg-amber-500 text-neutral-950 border-amber-400 font-semibold'
                    : 'bg-neutral-900 text-neutral-300 border-neutral-800 hover:border-neutral-700'
                }`}
              >
                {p.label}
              </button>
            ))}
            {settings.presetId === 'custom' && (
              <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-neutral-800 text-amber-300 border border-amber-500/40 whitespace-nowrap">
                Свой
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="text-neutral-400 font-mono tabular-nums">
              {selectedCount}/{QA_CHECK_ITEMS.length} активны
            </span>
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-amber-400 hover:text-amber-300 font-medium whitespace-nowrap"
            >
              Выбрать все
            </button>
            <button
              type="button"
              onClick={handleResetDefaults}
              className="text-neutral-400 hover:text-neutral-200 inline-flex items-center gap-1 whitespace-nowrap"
            >
              <RotateCcw className="w-3 h-3" />
              Сбросить по умолчанию
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4 custom-scrollbar">
          {/* Stage 0 Stems & Acting Profile Panel */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Stage 0 Original Stem Strategy */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-200 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-amber-400" />
                  Этап 0: Выделение вокального стема оригинала
                </label>
                <select
                  value={settings.originalStemMode}
                  onChange={(e) => updateField('originalStemMode', e.target.value as OriginalStemMode)}
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-neutral-100 focus:outline-none focus:border-amber-500"
                >
                  <option value="full_cached">Полный стем с кэшем (рекомендуется для Тайминга/Сведения)</option>
                  <option value="dialogue_windows">Быстро только по окнам реплик (без кэша серии)</option>
                  <option value="none">Не разделять (сверка по общему звуку видео)</option>
                </select>
                {settings.originalStemMode !== 'none' && (
                  <div className="flex items-center gap-2 pt-1 text-[11px] text-neutral-400">
                    <span>Модель разделения:</span>
                    {(['htdemucs', 'uvr_mdx_voc_ft'] as OriginalStemModel[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => updateField('originalStemModel', m)}
                        className={`px-2 py-0.5 rounded border font-mono ${
                          settings.originalStemModel === m
                            ? 'bg-amber-500/20 border-amber-500/50 text-amber-200'
                            : 'bg-neutral-900 border-neutral-800 text-neutral-400'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Acting AI Resource Profile */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-200 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                  Профиль моделей актёрского QA (100% локально в AI_env)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'fast_diction' as ActingResourceProfile, title: 'Быстрый (Дикция)', desc: 'Дикция + ударения (~720 МБ)' },
                    { id: 'full_acting' as ActingResourceProfile, title: 'Полный (Актёрка)', desc: 'Все 5 моделей (~2.8 ГБ)' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => updateField('actingResourceProfile', p.id)}
                      className={`px-2.5 py-1.5 rounded-lg border text-left text-xs transition-colors ${
                        settings.actingResourceProfile === p.id
                          ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-200 font-semibold'
                          : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      <div>{p.title}</div>
                      <div className="text-[10px] text-neutral-400 font-normal">{p.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Acting AI Models Readiness Status */}
            {anyActingSelected && (
              <div className="pt-2.5 border-t border-neutral-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  {actingStatus?.loading ? (
                    <span className="text-neutral-400 inline-flex items-center gap-1.5">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Проверка кэша моделей AI_env...
                    </span>
                  ) : actingStatus?.ready ? (
                    <span className="text-emerald-400 inline-flex items-center gap-1.5 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      Локальные модели ({settings.actingResourceProfile}) готовы на диске
                    </span>
                  ) : (
                    <span className="text-amber-300 inline-flex items-center gap-1.5 font-medium">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {actingStatus?.error
                        ? `Проверка моделей: ${actingStatus.error}`
                        : `Необходимо докачать ${actingStatus?.missingCount || 0} мод. (~${actingStatus?.totalMissingMb || 0} МБ)`}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => refreshActingModels(settings.actingResourceProfile)}
                    disabled={actingStatus?.loading || isDownloadingModels}
                    className="px-2.5 py-1 rounded border border-neutral-700 bg-neutral-900 text-neutral-300 hover:text-white text-[11px] inline-flex items-center gap-1 whitespace-nowrap"
                  >
                    <RefreshCw className={`w-3 h-3 ${actingStatus?.loading ? 'animate-spin' : ''}`} />
                    Проверить кэш
                  </button>

                  {actingStatus && !actingStatus.ready && (
                    <button
                      type="button"
                      onClick={handleDownloadModels}
                      disabled={isDownloadingModels}
                      className="px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
                    >
                      <Download className="w-3 h-3" />
                      <span>
                        {isDownloadingModels
                          ? `Загрузка ${downloadProgress?.percent ?? 0}%...`
                          : `Скачать модели (~${actingStatus.totalMissingMb || 0} МБ)`}
                      </span>
                    </button>
                  )}
                </div>

                {downloadProgress && (
                  <div className="w-full space-y-1">
                    <div className="flex justify-between text-[11px] text-cyan-300">
                      <span>{downloadProgress.message}</span>
                      <span className="font-mono tabular-nums">{downloadProgress.percent}%</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-neutral-800 overflow-hidden">
                      <div
                        className="h-full bg-cyan-500 transition-all duration-300"
                        style={{ width: `${downloadProgress.percent}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* All 12 Detectors Checklist + Expandable Per-Detector Thresholds */}
          <div className="space-y-2">
            {QA_CHECK_ITEMS.map((item) => {
              const checked = Boolean(settings[item.key]);
              const isExpanded = expandedKey === item.key;
              const IconComp = item.icon;

              return (
                <div
                  key={item.key}
                  className={`rounded-xl border transition-colors ${
                    checked
                      ? 'bg-neutral-900/90 border-neutral-700/80'
                      : 'bg-neutral-950/50 border-neutral-800/70 opacity-75'
                  }`}
                >
                  <div className="flex items-start gap-3 p-3">
                    <button
                      type="button"
                      onClick={() => updateField(item.key, !checked as any, false)}
                      className="mt-0.5 text-neutral-400 hover:text-neutral-100 focus:outline-none shrink-0"
                    >
                      {checked ? (
                        <CheckSquare className="w-5 h-5 text-amber-400" />
                      ) : (
                        <Square className="w-5 h-5 text-neutral-600" />
                      )}
                    </button>

                    <div className={`p-1.5 rounded-lg border ${item.color} shrink-0 mt-0.5`}>
                      <IconComp className="w-4 h-4" />
                    </div>

                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => updateField(item.key, !checked as any, false)}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-neutral-100">{item.title}</span>
                        {item.badge && (
                          <span className="text-[10px] font-mono text-neutral-400">[{item.badge}]</span>
                        )}
                      </div>
                      <p className="text-xs text-neutral-400 mt-0.5 leading-snug">{item.subtitle}</p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setExpandedKey(isExpanded ? null : item.key)}
                      className="px-2.5 py-1 rounded-md border border-neutral-800 bg-neutral-950 hover:border-neutral-700 text-[11px] font-medium text-neutral-300 hover:text-white inline-flex items-center gap-1 shrink-0 whitespace-nowrap"
                    >
                      <span>Параметры</span>
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="px-4 pb-3.5 pt-2 border-t border-neutral-800/80 bg-neutral-950/60">
                      {renderCategoryParams(item.key)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 border-t border-neutral-800 bg-neutral-900 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded-lg transition-colors whitespace-nowrap"
          >
            Отмена
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSaveOnly}
              disabled={isSaving}
              className="px-4 py-2 rounded-lg text-xs font-medium border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5 text-neutral-300" />
              <span>{isSaving ? 'Сохранение...' : 'Сохранить настройки'}</span>
            </button>

            <button
              type="button"
              onClick={handleStart}
              disabled={selectedCount === 0}
              className={`px-5 py-2 rounded-lg text-xs font-bold inline-flex items-center gap-2 whitespace-nowrap transition-colors ${
                selectedCount === 0
                  ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
                  : 'bg-amber-500 hover:bg-amber-400 text-neutral-950'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span>Начать проверку ({selectedCount})</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
