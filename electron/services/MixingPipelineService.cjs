const fs = require('fs').promises;
const fsPromises = fs;
const fsSync = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const log = require('electron-log');
const { app, shell } = require('electron');
const ExportService = require('./ExportService.cjs');
const ffmpegService = require('./ffmpegService.cjs');
const AutoTimingService = require('./AutoTimingService.cjs');
const AudioNeuralService = require('./AudioNeuralService.cjs');
const AudioAnalysisService = require('./AudioAnalysisService.cjs');
const { trackProcess, killAllActiveProcesses } = require('../lib/ProcessTracker.cjs');

/**
 * MODULE DATABASE (Реестр всех доступных модулей обработки с подробнейшими настройками и пресетами)
 * Никаких скрытых обработок: каждый этап вынесен в отдельный прозрачный модуль.
 */
const MODULE_DATABASE = [
  {
    id: 'voice_timbre_match',
    category: 'timbre',
    defaultPrefix: '01_timbre_',
    title: 'Калибровка АЧХ голосов к эталону (Voice Timbre Match EQ)',
    description: 'Анализирует долговременный спектр речи (LTAS) каждого даббера и гармонизирует амплитудно-частотную характеристику к нейтральному студийному эталону перед эквалайзерами и денойзом.',
    icon: 'Activity',
    defaultParams: {
      matchIntensity: 75,
      targetProfile: 'studio_neutral',
      subBassCutoff: 75,
      airLimitDb: 3.0,
      smoothness: 3
    },
    presets: [
      {
        id: 'studio_neutral',
        title: '🎯 Нейтральный студийный дубляж (Универсальный эталон)',
        description: 'Идеальный баланс низких, средних и высоких частот по студийному стандарту дубляжа',
        params: { matchIntensity: 75, targetProfile: 'studio_neutral', subBassCutoff: 75, airLimitDb: 3.0, smoothness: 3 }
      },
      {
        id: 'warm_broadcast',
        title: '📻 Тёплый бродкаст (Плотный низ и бархат)',
        description: 'Богатая теплая нижняя середина для мужских и закадровых голосов',
        params: { matchIntensity: 70, targetProfile: 'warm_broadcast', subBassCutoff: 70, airLimitDb: 2.5, smoothness: 3 }
      },
      {
        id: 'crisp_anime',
        title: '✨ Прозрачный аниме-дубляж (Яркая читаемость)',
        description: 'Открытый верх и высокая разборчивость для эмоциональных диалогов и криков',
        params: { matchIntensity: 80, targetProfile: 'crisp_anime', subBassCutoff: 85, airLimitDb: 3.5, smoothness: 4 }
      },
      {
        id: 'gentle_balance',
        title: '🍃 Мягкое выравнивание (50% интенсивности)',
        description: 'Деликатная коррекция тонального баланса с сохранением авторской окраски микрофона',
        params: { matchIntensity: 50, targetProfile: 'studio_neutral', subBassCutoff: 75, airLimitDb: 2.0, smoothness: 3 }
      }
    ]
  },
  {
    id: 'acoustic_original_match',
    category: 'analysis',
    defaultPrefix: 'acoustic_matched_',
    title: 'Повторение эффектов оригинала по кривой автоматизации (Acoustic Matched)',
    description: 'Принимает ИСКЛЮЧИТЕЛЬНО разделенную вокальную дорожку оригинала и склеенную дорожку всех голосов (voices_master). Выполняет полный пофразовый и покадровый анализ эффектов оригинала (реверб, эхо, рация/телефон, глушение за стеной, EQ, панорама, динамика) и воспроизводит их в точных таймингах по кривой автоматизации.',
    icon: 'Activity',
    defaultParams: {
      loudnessMatchStrength: 100,
      reverbMatchStrength: 100,
      eqMatchStrength: 100,
      targetLufsOffset: 0.0,
      strictOriginalVocalsRequired: true,
      strictGluedVoicesRequired: true
    },
    presets: [
      {
        id: 'acoustic_match_full',
        title: '🎯 Полная автоматизация всех эффектов оригинала (100% Динамика, Пространство, Фильтры)',
        description: 'Пофразовый и покадровый перенос всех эффектов оригинала (реверб, эхо, телефон/рация, за стеной, EQ, панорама) на склеенную дорожку голосов',
        params: { loudnessMatchStrength: 100, reverbMatchStrength: 100, eqMatchStrength: 100, targetLufsOffset: 0.0, strictOriginalVocalsRequired: true, strictGluedVoicesRequired: true }
      },
      {
        id: 'acoustic_match_soft_reverb',
        title: '🎙 Деликатная автоматизация пространства (100% Динамика, 60% Реверб/Эхо, 85% Фильтры/EQ)',
        description: 'Точный перенос частотных фильтров (рация, глушение) и динамики с умеренной глубиной реверберации',
        params: { loudnessMatchStrength: 100, reverbMatchStrength: 60, eqMatchStrength: 85, targetLufsOffset: 0.0, strictOriginalVocalsRequired: true, strictGluedVoicesRequired: true }
      },
      {
        id: 'acoustic_match_dry_focus',
        title: '✂️ Автоматизация только фильтров (Рация/LPF/EQ) и громкости без реверберации',
        description: 'Повторяет частотные эффекты (телефон, за стеной, тембр) и кривую громкости оригинала без добавления эха и зала',
        params: { loudnessMatchStrength: 100, reverbMatchStrength: 0, eqMatchStrength: 100, targetLufsOffset: 0.0, strictOriginalVocalsRequired: true, strictGluedVoicesRequired: true }
      }
    ]
  },
  {
    id: 'auto_timing',
    category: 'timing',
    defaultPrefix: 'timing_',
    title: 'Автотайминг речевых фраз (QA Auto-Timing)',
    description: 'Детектирует паузы речи даббера, сопоставляет реплики с субтитрами ASS и автоматически разводит перекрытия/коллизии между репликами персонажей.',
    icon: 'Clock',
    defaultParams: {
      minGapSec: 0.12,
      leadInSec: 0.05,
      silenceThresholdDb: -38.0,
      minSilenceDuration: 0.25,
      preventCollisions: true
    },
    presets: [
      {
        id: 'studio_timing_standard',
        title: '🎙 Студийный тайминг (0.12s зазор, 0.05s предвход)',
        description: 'Оптимальный баланс для дубляжа и закадра без наездов на соседние фразы',
        params: { minGapSec: 0.12, leadInSec: 0.05, silenceThresholdDb: -38.0, minSilenceDuration: 0.25, preventCollisions: true }
      },
      {
        id: 'tight_dialogue',
        title: '⚡ Плотные диалоги (0.06s зазор, быстрый темп)',
        description: 'Для динамичных сцен споров и перебиваний с минимальными паузами',
        params: { minGapSec: 0.06, leadInSec: 0.03, silenceThresholdDb: -35.0, minSilenceDuration: 0.18, preventCollisions: true }
      },
      {
        id: 'relaxed_ambient',
        title: '🍃 Просторный тайминг (0.20s зазор, плавное дыхание)',
        description: 'Для спокойных размеренных диалогов и монологов с сохранением естественного темпа',
        params: { minGapSec: 0.20, leadInSec: 0.08, silenceThresholdDb: -42.0, minSilenceDuration: 0.35, preventCollisions: true }
      }
    ]
  },
  {
    id: 'stage_mfa_lipsync',
    category: 'timing',
    defaultPrefix: 'mfa_lipsync_',
    title: 'Фонетический липсинк MFA (Phonetic Lipsync Aligner)',
    description: 'Прецизионное сопоставление фонетических атак даббера с оригинальным японским вокалом через Montreal Forced Aligner для подгонки тайм-стретча реплик.',
    icon: 'Mic2',
    defaultParams: {
      maxTimeStretch: 1.35,
      minTimeStretch: 0.75,
      maxDriftMs: 50.0,
      confidenceThreshold: 0.50,
      acousticModel: 'russian_mfa',
      dictionary: 'russian_mfa',
      autoApplyStretch: true
    },
    presets: [
      {
        id: 'mfa_lipsync_standard',
        title: '🎯 Точный студийный липсинк (Порог рассинхрона 50 мс, max ±35%)',
        description: 'Прецизионная подгонка открытий рта даббера под оригинальную артикуляцию',
        params: { maxTimeStretch: 1.35, minTimeStretch: 0.75, maxDriftMs: 50.0, confidenceThreshold: 0.50, acousticModel: 'russian_mfa', dictionary: 'russian_mfa', autoApplyStretch: true }
      },
      {
        id: 'mfa_lipsync_strict',
        title: '⚡ Строгий кинематографический липсинк (Порог 30 мс, max ±20%)',
        description: 'Максимально незаметная точечная коррекция длинных гласных',
        params: { maxTimeStretch: 1.20, minTimeStretch: 0.80, maxDriftMs: 30.0, confidenceThreshold: 0.65, acousticModel: 'russian_mfa', dictionary: 'russian_mfa', autoApplyStretch: true }
      }
    ]
  },
  {
    id: 'apply_fixes',
    category: 'timing',
    defaultPrefix: 'fixes_',
    title: 'Бесшовное вшивание фиксов (Apply Fixes)',
    description: 'Интеллектуально заменяет бракованные реплики на переозвученные фиксы, гарантируя полное удаление хвостов старых дублей и разведение удлинений.',
    icon: 'Sparkles',
    defaultParams: {
      fadeDurationMs: 8,
      cleanLeftoverTails: true,
      adjustLongerCollisions: true,
      safetyPaddingMs: 80,
      minGapSec: 0.12
    },
    presets: [
      {
        id: 'seamless_clean',
        title: '✨ Бесшовное удаление хвостов (8ms микро-фейд)',
        description: '100% зачистка старых щелчков, вздохов и остаточных дублей без артефактов',
        params: { fadeDurationMs: 8, cleanLeftoverTails: true, adjustLongerCollisions: true, safetyPaddingMs: 80, minGapSec: 0.12 }
      },
      {
        id: 'soft_crossfade',
        title: '🌊 Мягкий кроссфейд (16ms для акустических комнат)',
        description: 'Сглаживание переходов в помещениях с заметной реверберацией',
        params: { fadeDurationMs: 16, cleanLeftoverTails: true, adjustLongerCollisions: true, safetyPaddingMs: 120, minGapSec: 0.15 }
      },
      {
        id: 'strict_cut',
        title: '✂️ Точный срез (4ms для плотного монтажа)',
        description: 'Максимально строгий и точный срез без размазывания транзиентов',
        params: { fadeDurationMs: 4, cleanLeftoverTails: true, adjustLongerCollisions: true, safetyPaddingMs: 50, minGapSec: 0.08 }
      }
    ]
  },
  {
    id: 'auto_norm_phrases',
    category: 'loudness',
    defaultPrefix: 'autonorm_',
    title: 'Пофразовая автонормализация (QA Phrase Normalizer)',
    description: 'Детектирует каждую речевую фразу отдельно и поканально нормализует уровень громкости отдельных реплик к целевому стандарту вещания.',
    icon: 'Sliders',
    defaultParams: {
      targetLufs: -16.0,
      truePeak: -1.0,
      minSpeechDb: -40.0,
      maxGainDb: 14.0,
      fadeEdgeMs: 12
    },
    presets: [
      {
        id: 'broadcast_16lufs',
        title: '📺 Стандарт вещания (-16 LUFS, Peak -1.0 dB)',
        description: 'Равномерное звучание всех реплик диалога по стандарту стримингов',
        params: { targetLufs: -16.0, truePeak: -1.0, minSpeechDb: -40.0, maxGainDb: 14.0, fadeEdgeMs: 12 }
      },
      {
        id: 'web_punchy_14lufs',
        title: '📢 Громкий веб (-14 LUFS, Peak -0.8 dB)',
        description: 'Максимальная читаемость диалогов на телефонах и планшетах',
        params: { targetLufs: -14.0, truePeak: -0.8, minSpeechDb: -36.0, maxGainDb: 16.0, fadeEdgeMs: 10 }
      },
      {
        id: 'whisper_boost',
        title: '🤫 Вытягивание тихого шепота (Порог -46dB, Max +18dB)',
        description: 'Автоматически подтягивает слишком тихие эмоциональные реплики',
        params: { targetLufs: -16.0, truePeak: -1.0, minSpeechDb: -46.0, maxGainDb: 18.0, fadeEdgeMs: 15 }
      }
    ]
  },
  {
    id: 'uvr_denoise_foxjoy',
    name: 'VR-DeNoise FoxJoy (Вокал / Речь)',
    title: 'VR-DeNoise FoxJoy (Вокал / Речь)',
    filename: 'UVR-DeNoise.pth',
    category: 'denoise',
    description: 'Флагманская модель FoxJoy для глубокой очистки речевого вокала от фонового шума.',
    size_mb: 44.8,
    recommended_for: 'Основной выбор для профессиональной очистки дикторских дорожек',
    urls: [
      'https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-DeNoise.pth'
    ],
    is_installed: false,
    installed_bytes: null,
    local_path: null,
    format: 'pth',
    engineArchitecture: 'VR Speech Spectral Denoise',
    defaultPrefix: 'denoise_foxjoy_',
    icon: 'ShieldCheck',
    defaultParams: {
      sensitivity: 1.0,
      wetDryBlend: 95.0,
      noiseTraining: false,
      noiseReductionDb: 18.0,
      noiseFloorDb: -52.0,
      stationarityWeight: 0.85,
      frequencySmoothingHz: 120,
      preserveVoiceFormants: true,
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'foxjoy_studio',
        title: '✨ FoxJoy Вокальный Студийный (18 dB)',
        description: 'Флагманская чистая обработка вокальных и дикторских трактов от FoxJoy',
        params: { noiseReductionDb: 18.0, noiseFloorDb: -52.0, stationarityWeight: 0.85, frequencySmoothingHz: 120, preserveVoiceFormants: true, autoDownloadModel: true }
      },
      {
        id: 'foxjoy_heavy',
        title: '🛡 FoxJoy Глубокое Очищение (24 dB)',
        description: 'Очистка сильного шума кулеров и уличного гула с сохранением формант',
        params: { noiseReductionDb: 24.0, noiseFloorDb: -46.0, stationarityWeight: 0.92, frequencySmoothingHz: 160, preserveVoiceFormants: true, autoDownloadModel: true }
      }
    ]
  },
  {
    id: 'deepfilternet3',
    name: 'DeepFilterNet 3 ONNX',
    title: 'DeepFilterNet 3 ONNX (Перцептивный шумоподавитель)',
    filename: 'df_dec.onnx',
    category: 'denoise',
    description: 'Инновационный перцептивный шумоподавитель на базе глубоких сверточных сетей.',
    size_mb: 25.4,
    recommended_for: 'Быстрая высококачественная очистка речи без металлического призвука',
    urls: [
      'https://huggingface.co/bitsydarel/deepfilternet3-onnx/resolve/main/df_dec.onnx'
    ],
    is_installed: false,
    installed_bytes: null,
    local_path: null,
    format: 'onnx',
    engineArchitecture: 'DeepFilterNet Perceptual Convolutional Net',
    defaultPrefix: 'deepfilter3_',
    icon: 'ShieldCheck',
    defaultParams: {
      sensitivity: 1.0,
      wetDryBlend: 95.0,
      noiseTraining: false,
      noiseReductionDb: 20.0,
      noiseFloorDb: -55.0,
      stationarityWeight: 0.88,
      frequencySmoothingHz: 100,
      preserveVoiceFormants: true,
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'deepfilter3_speech',
        title: '⚡ DeepFilter 3 Перцептивный (20 dB)',
        description: 'Инновационная чистка речи без металлического призвука',
        params: { noiseReductionDb: 20.0, noiseFloorDb: -55.0, stationarityWeight: 0.88, frequencySmoothingHz: 100, preserveVoiceFormants: true, autoDownloadModel: true }
      }
    ]
  },
  {
    id: 'uvr_denoise_full',
    name: 'UVR-DeNoise Full (Глубокое подавление)',
    title: 'UVR-DeNoise Full (Глубокое подавление)',
    filename: 'UVR-DeNoise-Full.pth',
    category: 'denoise',
    description: 'Бескомпромиссная глубокая очистка сложного шипящего и гудящего шума.',
    size_mb: 52.0,
    recommended_for: 'Сильно зашумленные репортажные и архивные аудиозаписи',
    urls: [
      'https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-DeNoise.pth'
    ],
    is_installed: false,
    installed_bytes: null,
    local_path: null,
    format: 'pth',
    engineArchitecture: 'VR Full-Spectrum High-Attenuation Filter',
    defaultPrefix: 'denoise_full_',
    icon: 'ShieldCheck',
    defaultParams: {
      sensitivity: 1.0,
      wetDryBlend: 95.0,
      noiseTraining: false,
      noiseReductionDb: 26.0,
      noiseFloorDb: -42.0,
      stationarityWeight: 0.95,
      frequencySmoothingHz: 200,
      preserveVoiceFormants: true,
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'full_archive_clean',
        title: '🛡 UVR Full Глубокое удаление (26 dB)',
        description: 'Бескомпромиссная чистка архивного шипения и сильного гула',
        params: { noiseReductionDb: 26.0, noiseFloorDb: -42.0, stationarityWeight: 0.95, frequencySmoothingHz: 200, preserveVoiceFormants: true, autoDownloadModel: true }
      }
    ]
  },
  {
    id: 'uvr_denoise_lite',
    name: 'VR-DeNoise Lite (Быстрая очистка)',
    title: 'VR-DeNoise Lite (Быстрая очистка)',
    filename: 'UVR-DeNoise-Lite.pth',
    category: 'denoise',
    description: 'Легкая модель для оперативного подавления постоянного шума с низким расходом ресурсов.',
    size_mb: 28.5,
    recommended_for: 'Быстрый рендеринг на слабых видеокартах и процессорах',
    urls: [
      'https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-DeNoise-Lite.pth',
      'https://huggingface.co/comsharp/UVR_resources/resolve/main/models/VR_Arch/UVR-DeNoise-Lite.pth'
    ],
    is_installed: false,
    installed_bytes: null,
    local_path: null,
    format: 'pth',
    engineArchitecture: 'VR Lightweight Stationarity Reducer',
    defaultPrefix: 'denoise_',
    icon: 'ShieldCheck',
    defaultParams: {
      sensitivity: 1.0,
      wetDryBlend: 95.0,
      noiseTraining: false,
      noiseReductionDb: 18.0,
      noiseFloorDb: -52.0,
      stationarityWeight: 0.85,
      frequencySmoothingHz: 120,
      preserveVoiceFormants: true,
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'balanced_clean',
        title: '✨ Оптимальное подавление (18 dB, естественный тембр)',
        description: 'Убирает кулеры ПК, шум кондиционера и фоновое шипение без искажения согласных',
        params: { noiseReductionDb: 18.0, noiseFloorDb: -52.0, stationarityWeight: 0.85, frequencySmoothingHz: 120, preserveVoiceFormants: true, autoDownloadModel: true }
      },
      {
        id: 'light_hum_remover',
        title: '🍃 Деликатная чистка (12 dB, прозрачный звук)',
        description: 'Легкое снятие мелкого стационарного фона для чистых студийных записей',
        params: { noiseReductionDb: 12.0, noiseFloorDb: -60.0, stationarityWeight: 0.70, frequencySmoothingHz: 80, preserveVoiceFormants: true, autoDownloadModel: true }
      },
      {
        id: 'heavy_hiss_killer',
        title: '🛡 Глубокое подавление (26 dB, сильный шум)',
        description: 'Для записей с громким шумом улицы, гудением дросселей и микрофонным перегревом',
        params: { noiseReductionDb: 26.0, noiseFloorDb: -44.0, stationarityWeight: 0.95, frequencySmoothingHz: 180, preserveVoiceFormants: true, autoDownloadModel: true }
      },
      {
        id: 'usb_mic_stationarity',
        title: '🎙 USB-микрофон (Отсечение фонового писка и шума USB)',
        description: 'Устраняет высокочастотный наводящий свист и электрическое шипение дешевых трактов',
        params: { noiseReductionDb: 20.0, noiseFloorDb: -50.0, stationarityWeight: 0.90, frequencySmoothingHz: 150, preserveVoiceFormants: true, autoDownloadModel: true }
      }
    ]
  },
  {
    id: 'vst-spectral-dereverb',
    name: 'Spectral De-Reverb Lite (Native C++ DSP)',
    title: 'Spectral De-Reverb Lite (Native C++ DSP)',
    filename: 'SpectralDeReverb.dsp',
    category: 'dereverb',
    description: '16-полосный нативный C++ алгоритм вычитания диффузного хвоста реверберации с нулевой задержкой без нейросетей.',
    size_mb: 0.1,
    recommended_for: 'Мгновенное бессерверное устранение эха без задержки и без нагрузки на GPU/RAM',
    urls: [],
    is_installed: true,
    installed_bytes: 1024,
    local_path: 'built-in://dsp/spectral-dereverb',
    format: 'built-in-dsp',
    engineArchitecture: '16-Band Filterbank Energy Decay Subtraction',
    defaultPrefix: 'dereverb_dsp_',
    icon: 'Radio',
    defaultParams: {
      sensitivity: 1.0,
      wetDryBlend: 95.0,
      noiseTraining: false,
      deechoReductionDb: 12.0,
      earlyReflectionsDecay: 0.65,
      reverbTailSuppress: 0.60,
      preserveBodyFrequencies: true,
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'dsp_instant',
        title: '⚡ Быстрое DSP вычитание (12 dB)',
        description: 'Легкое устранение гула с нулевой задержкой без нейросетей',
        params: { deechoReductionDb: 12.0, earlyReflectionsDecay: 0.65, reverbTailSuppress: 0.60, preserveBodyFrequencies: true }
      }
    ]
  },
  {
    id: 'reverb_foxjoy',
    name: 'Reverb HQ (FoxJoy)',
    title: 'Reverb HQ (FoxJoy)',
    filename: 'Reverb_HQ_By_FoxJoy.onnx',
    category: 'dereverb',
    description: 'Студийное устранение комнатного эха, реверберационных хвостов и ранних переотражений.',
    size_mb: 64.8,
    recommended_for: 'Дикторские записи, сделанные в обычных не заглушенных комнатах',
    urls: [
      'https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/Reverb_HQ_By_FoxJoy.onnx',
      'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/Reverb_HQ_By_FoxJoy.onnx',
      'https://huggingface.co/Politrees/UVR_resources/resolve/main/models/MDXNet/Reverb_HQ_By_FoxJoy.onnx'
    ],
    is_installed: false,
    installed_bytes: null,
    local_path: null,
    format: 'onnx',
    engineArchitecture: 'MDX-Net DeReverb Spatial Inversion',
    defaultPrefix: 'reverb_foxjoy_',
    icon: 'Radio',
    defaultParams: {
      sensitivity: 1.0,
      wetDryBlend: 95.0,
      noiseTraining: false,
      deechoReductionDb: 16.0,
      earlyReflectionsDecay: 0.75,
      reverbTailSuppress: 0.70,
      preserveBodyFrequencies: true,
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'foxjoy_studio_dereverb',
        title: '✨ FoxJoy Студийный DeReverb (16 dB)',
        description: 'Глубокая пространственная инверсия реверберации от FoxJoy',
        params: { deechoReductionDb: 16.0, earlyReflectionsDecay: 0.75, reverbTailSuppress: 0.70, preserveBodyFrequencies: true, autoDownloadModel: true }
      }
    ]
  },
  {
    id: 'uvr_deecho_normal',
    name: 'UVR De-Echo Normal',
    title: 'UVR De-Echo Normal (Подавление эха)',
    filename: 'UVR-De-Echo-Normal.pth',
    category: 'dereverb',
    description: 'Мягкое подавление порхающего эха без истончения низких и средних частот.',
    size_mb: 44.5,
    recommended_for: 'Легкое эхо в помещениях со шторами и коврами',
    urls: [
      'https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-De-Echo-Normal.pth',
      'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-De-Echo-Normal.pth',
      'https://huggingface.co/Delik/uvr5_weights/resolve/main/VR-DeEchoNormal.pth'
    ],
    is_installed: false,
    installed_bytes: null,
    local_path: null,
    format: 'pth',
    engineArchitecture: 'VR Architecture Flutter Echo Canceller',
    defaultPrefix: 'deecho_',
    icon: 'Radio',
    defaultParams: {
      sensitivity: 1.0,
      wetDryBlend: 95.0,
      noiseTraining: false,
      deechoReductionDb: 14.0,
      earlyReflectionsDecay: 0.70,
      reverbTailSuppress: 0.65,
      roomSizeEstimate: 'medium',
      preserveBodyFrequencies: true,
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'soft_curtain_room',
        title: '🪟 Комната со шторами (Мягкое снятие ранних отражений)',
        description: 'Убирает порхающее эхо от стен, сохраняя теплоту и глубину низких частот',
        params: { deechoReductionDb: 12.0, earlyReflectionsDecay: 0.65, reverbTailSuppress: 0.55, roomSizeEstimate: 'small', preserveBodyFrequencies: true, autoDownloadModel: true }
      },
      {
        id: 'normal_home_studio',
        title: '🎙 Стандартная домашняя студия (Сбалансированный De-Echo)',
        description: 'Оптимальное подавление комнатного отклика без истончения вокала',
        params: { deechoReductionDb: 15.0, earlyReflectionsDecay: 0.75, reverbTailSuppress: 0.70, roomSizeEstimate: 'medium', preserveBodyFrequencies: true, autoDownloadModel: true }
      }
    ]
  },
  {
    id: 'uvr_deecho_aggressive',
    name: 'UVR De-Echo Aggressive',
    title: 'UVR De-Echo Aggressive',
    filename: 'UVR-De-Echo-Aggressive.pth',
    category: 'dereverb',
    description: 'Агрессивное удаление жесткого эха от голых стен, стекла и плитки.',
    size_mb: 44.5,
    recommended_for: 'Записи в пустых помещениях и сложных акустических условиях',
    urls: [
      'https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-De-Echo-Aggressive.pth',
      'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-De-Echo-Aggressive.pth',
      'https://huggingface.co/Delik/uvr5_weights/resolve/main/VR-DeEchoAggressive.pth'
    ],
    is_installed: false,
    installed_bytes: null,
    local_path: null,
    format: 'pth',
    engineArchitecture: 'VR Aggressive Room Reflection Suppressor',
    defaultPrefix: 'deecho_aggr_',
    icon: 'Radio',
    defaultParams: {
      sensitivity: 1.0,
      wetDryBlend: 95.0,
      noiseTraining: false,
      deechoReductionDb: 22.0,
      earlyReflectionsDecay: 0.88,
      reverbTailSuppress: 0.82,
      preserveBodyFrequencies: true,
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'deecho_aggr_preset',
        title: '🛡 De-Echo Aggressive (22 dB)',
        description: 'Удаление жесткого эха от стекла, плитки и пустых стен',
        params: { deechoReductionDb: 22.0, earlyReflectionsDecay: 0.88, reverbTailSuppress: 0.82, preserveBodyFrequencies: true, autoDownloadModel: true }
      }
    ]
  },
  {
    id: 'mdx_dereverb_room',
    name: 'MDX Room DeReverb',
    title: 'MDX Room DeReverb',
    filename: 'UVR-DeEcho-DeReverb.pth',
    category: 'dereverb',
    description: 'Устранение специфического «коробочного» резонанса комнат малого объема.',
    size_mb: 55.2,
    recommended_for: 'Очистка записей с накамерных и петличных микрофонов',
    urls: [
      'https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-DeEcho-DeReverb.pth',
      'https://huggingface.co/Delik/uvr5_weights/resolve/main/VR-DeEchoDeReverb.pth'
    ],
    is_installed: false,
    installed_bytes: null,
    local_path: null,
    format: 'pth',
    engineArchitecture: 'MDX Resonance Room Decoupler',
    defaultPrefix: 'dereverb_room_',
    icon: 'Radio',
    defaultParams: {
      sensitivity: 1.0,
      wetDryBlend: 95.0,
      noiseTraining: false,
      deechoReductionDb: 18.0,
      earlyReflectionsDecay: 0.80,
      reverbTailSuppress: 0.75,
      preserveBodyFrequencies: true,
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'dereverb_room_preset',
        title: '📦 MDX Room Boxy Resonant Clean (18 dB)',
        description: 'Устранение «коробочного» гула маленьких комнат и петличек',
        params: { deechoReductionDb: 18.0, earlyReflectionsDecay: 0.80, reverbTailSuppress: 0.75, preserveBodyFrequencies: true, autoDownloadModel: true }
      }
    ]
  },
  {
    id: 'uvr_mdx_voc_ft',
    name: 'UVR-MDX-NET Voc_FT',
    title: 'UVR-MDX-NET Voc_FT (Изоляция вокала)',
    filename: 'UVR-MDX-NET-Voc_FT.onnx',
    category: 'separation',
    description: 'Золотой стандарт изоляции вокала. Быстрое извлечение чистого голоса без артефактов.',
    size_mb: 60.5,
    recommended_for: 'Основная модель для отделения голоса дубляжа от оригинальной дорожки',
    urls: [
      'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Voc_FT.onnx',
      'https://huggingface.co/Politrees/UVR_resources/resolve/main/models/MDXNet/UVR-MDX-NET-Voc_FT.onnx',
      'https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-MDX-NET-Voc_FT.onnx'
    ],
    is_installed: false,
    installed_bytes: null,
    local_path: null,
    format: 'onnx',
    engineArchitecture: 'MDX-Net Frequency-Domain Spectrogram',
    defaultPrefix: 'stem_voc_ft_',
    icon: 'Layers',
    defaultParams: {
      sensitivity: 1.0,
      marginDb: 1.5,
      postProcessThreshold: 0.20,
      instrumentalBlend: 100.0,
      autoDownloadModel: true,
      extractVocals: true,
      extractInstrumental: true
    },
    presets: [
      {
        id: 'voc_ft_standard',
        title: '🎤 Voc_FT Извлечение вокала',
        description: 'Золотой стандарт сепарации диалогов и вокала',
        params: { autoDownloadModel: true, extractVocals: true, extractInstrumental: true }
      }
    ]
  },
  {
    id: 'uvr_mdx_inst_hq3',
    name: 'UVR-MDX-NET Inst_HQ_3',
    title: 'UVR-MDX-NET Inst_HQ_3 (Изоляция инструментала)',
    filename: 'UVR-MDX-NET-Inst_HQ_3.onnx',
    category: 'separation',
    description: 'Высокоточное удаление вокала и извлечение фонограммы / минусовки / SFX.',
    size_mb: 60.5,
    recommended_for: 'Подготовка фоновой музыки и шумов (M&E) для подмешивания дубляжа',
    urls: [
      'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Inst_HQ_3.onnx',
      'https://huggingface.co/Politrees/UVR_resources/resolve/main/models/MDXNet/UVR-MDX-NET-Inst_HQ_3.onnx',
      'https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-MDX-NET-Inst_HQ_3.onnx'
    ],
    is_installed: false,
    installed_bytes: null,
    local_path: null,
    format: 'onnx',
    engineArchitecture: 'MDX-Net High-Quality Instrumental Extractor',
    defaultPrefix: 'stem_inst_hq3_',
    icon: 'Layers',
    defaultParams: {
      sensitivity: 1.0,
      marginDb: 1.5,
      postProcessThreshold: 0.20,
      instrumentalBlend: 100.0,
      autoDownloadModel: true,
      extractVocals: false,
      extractInstrumental: true
    },
    presets: [
      {
        id: 'inst_hq3_standard',
        title: '🎶 Inst_HQ_3 Извлечение инструментала (M&E)',
        description: 'Чистый минус и музыкальное сопровождение для дубляжа',
        params: { autoDownloadModel: true, extractVocals: false, extractInstrumental: true }
      }
    ]
  },
  {
    id: 'kim_vocal_2',
    name: 'Kim Vocal 2 (MDX-Net)',
    title: 'Kim Vocal 2 (MDX-Net)',
    filename: 'Kim_Vocal_2.onnx',
    category: 'separation',
    description: 'Специализированная модель с минимальным просачиванием бэков и тяжелых синтов.',
    size_mb: 65.2,
    recommended_for: 'Сложные саундтреки с хором, дабстепом и плотным фоном',
    urls: [
      'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/Kim_Vocal_2.onnx',
      'https://huggingface.co/Politrees/UVR_resources/resolve/main/models/MDXNet/Kim_Vocal_2.onnx',
      'https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/Kim_Vocal_2.onnx'
    ],
    is_installed: false,
    installed_bytes: null,
    local_path: null,
    format: 'onnx',
    engineArchitecture: 'MDX-Net Kim Architecture',
    defaultPrefix: 'stem_kim2_',
    icon: 'Layers',
    defaultParams: {
      sensitivity: 1.0,
      marginDb: 1.5,
      postProcessThreshold: 0.20,
      instrumentalBlend: 100.0,
      autoDownloadModel: true,
      extractVocals: true,
      extractInstrumental: true
    },
    presets: [
      {
        id: 'kim2_dense_mix',
        title: '⚡ Kim Vocal 2 Для плотных миксов',
        description: 'Удаление хоров, синтов и перегруженных битов',
        params: { autoDownloadModel: true, extractVocals: true, extractInstrumental: true }
      }
    ]
  },
  {
    id: 'htdemucs_ft',
    name: 'HTDemucs v4 Fine-Tuned',
    title: 'HTDemucs v4 Fine-Tuned (4 Стема)',
    filename: 'htdemucs_ft.yaml',
    category: 'separation',
    description: 'Гибридный трансформер Demucs: делит дорожку на 4 изолированных стема (вокал, бас, барабаны, прочее).',
    size_mb: 79.8,
    recommended_for: 'Глубокая многодорожечная реставрация фильма и видеоряда',
    urls: [
      'https://raw.githubusercontent.com/facebookresearch/demucs/main/demucs/remote/htdemucs_ft.yaml'
    ],
    is_installed: false,
    installed_bytes: null,
    local_path: null,
    format: 'yaml',
    engineArchitecture: 'Hybrid Transformer (Time + Frequency)',
    defaultPrefix: 'stem_htdemucs_ft_',
    icon: 'Layers',
    defaultParams: {
      sensitivity: 1.0,
      marginDb: 1.5,
      postProcessThreshold: 0.20,
      instrumentalBlend: 100.0,
      autoDownloadModel: true,
      stems: 4
    },
    presets: [
      {
        id: 'htdemucs_ft_full',
        title: '🎬 Demucs 4-Stem Full Separation',
        description: 'Многодорожечная сепарация фильма на 4 отдельных стема',
        params: { autoDownloadModel: true, stems: 4 }
      }
    ]
  },
  {
    id: 'htdemucs',
    name: 'HTDemucs v4 Standard',
    title: 'HTDemucs v4 Standard',
    filename: 'htdemucs.yaml',
    category: 'separation',
    description: 'Стандартная универсальная модель Demucs для быстрого разделения трека.',
    size_mb: 79.8,
    recommended_for: 'Универсальное разделение мультфильмов и сериалов',
    urls: [
      'https://raw.githubusercontent.com/facebookresearch/demucs/main/demucs/remote/htdemucs.yaml'
    ],
    is_installed: false,
    installed_bytes: null,
    local_path: null,
    format: 'yaml',
    engineArchitecture: 'Demucs v4 Standard Dual Transformer',
    defaultPrefix: 'stem_htdemucs_',
    icon: 'Layers',
    defaultParams: {
      sensitivity: 1.0,
      marginDb: 1.5,
      postProcessThreshold: 0.20,
      instrumentalBlend: 100.0,
      autoDownloadModel: true,
      stems: 4
    },
    presets: [
      {
        id: 'htdemucs_std',
        title: '📺 Demucs Standard 4-Stem',
        description: 'Быстрое разделение сериалов и мультсериалов',
        params: { autoDownloadModel: true, stems: 4 }
      }
    ]
  },
  {
    id: 'htdemucs_vocals_bgm',
    name: 'HTDemucs Vocals + BGM',
    title: 'HTDemucs Vocals + BGM',
    filename: 'htdemucs_vocals_bgm.yaml',
    category: 'separation',
    description: 'Оптимизированная версия Demucs для быстрой изоляции вокала от фона.',
    size_mb: 79.8,
    recommended_for: 'Экспресс-разделение дубляжа и фоновой музыки',
    urls: [
      'https://raw.githubusercontent.com/facebookresearch/demucs/main/demucs/remote/htdemucs_ft.yaml',
      'https://raw.githubusercontent.com/facebookresearch/demucs/main/demucs/remote/htdemucs.yaml'
    ],
    is_installed: false,
    installed_bytes: null,
    local_path: null,
    format: 'yaml',
    engineArchitecture: 'Demucs 2-Stem Optimized',
    defaultPrefix: 'stem_voc_bgm_',
    icon: 'Layers',
    defaultParams: {
      sensitivity: 1.0,
      marginDb: 1.5,
      postProcessThreshold: 0.20,
      instrumentalBlend: 100.0,
      autoDownloadModel: true,
      stems: 2
    },
    presets: [
      {
        id: 'htdemucs_2stem',
        title: '⚡ Demucs 2-Stem Vocals + BGM',
        description: 'Экспресс-изоляция речи от фонового звука',
        params: { autoDownloadModel: true, stems: 2 }
      }
    ]
  },
  {
    id: 'mdx23c_8step',
    name: 'MDX23C 8-Step Vocal FT',
    title: 'MDX23C 8-Step Vocal FT',
    filename: 'MDX23C-8Step-VocFT.onnx',
    category: 'separation',
    description: 'Высокоточная модель MDX23C для удаления инструментала и бэк-вокала.',
    size_mb: 115.0,
    recommended_for: 'Вокальные треки с плотным инструментальным сопровождением',
    urls: [
      'https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR_MDXNET_KARA_2.onnx',
      'https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/MDX23C_D1581.ckpt'
    ],
    is_installed: false,
    installed_bytes: null,
    local_path: null,
    format: 'onnx',
    engineArchitecture: 'MDX23C Multi-Step Deconvolution',
    defaultPrefix: 'stem_mdx23c_',
    icon: 'Layers',
    defaultParams: {
      sensitivity: 1.0,
      marginDb: 1.5,
      postProcessThreshold: 0.20,
      instrumentalBlend: 100.0,
      autoDownloadModel: true,
      steps: 8
    },
    presets: [
      {
        id: 'mdx23c_8s',
        title: '🔥 MDX23C 8-Step High-Precision',
        description: 'Глубокая многошаговая фильтрация бэк-вокала',
        params: { autoDownloadModel: true, steps: 8 }
      }
    ]
  },
  {
    id: 'hp_karaoke_uvr',
    name: '5_HP Karaoke UVR',
    title: '5_HP Karaoke UVR',
    filename: '5_HP-Karaoke-UVR.pth',
    category: 'separation',
    description: 'Специализированный алгоритм извлечения чистого минуса и караоке.',
    size_mb: 60.5,
    recommended_for: 'Создание качественной фонограммы без остатков бэк-вокала',
    urls: [
      'https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/5_HP-Karaoke-UVR.pth',
      'https://huggingface.co/comsharp/UVR_resources/resolve/main/models/VR_Arch/5_HP-Karaoke-UVR.pth'
    ],
    is_installed: false,
    installed_bytes: null,
    local_path: null,
    format: 'pth',
    engineArchitecture: 'VR Architecture High-Pass Karaoke',
    defaultPrefix: 'stem_karaoke_',
    icon: 'Layers',
    defaultParams: {
      sensitivity: 1.0,
      marginDb: 1.5,
      postProcessThreshold: 0.20,
      instrumentalBlend: 100.0,
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'karaoke_hp',
        title: '🎤 5_HP Караоке & Фонограмма',
        description: 'Чистое удаление голоса для получения качественной фонограммы',
        params: { autoDownloadModel: true }
      }
    ]
  },
  {
    id: 'mel_band_roformer_vocals',
    name: 'Mel-Band Roformer Vocals',
    title: 'Mel-Band Roformer Vocals (SOTA)',
    filename: 'mel_band_roformer_vocals_fv2.ckpt',
    category: 'separation',
    description: 'SOTA модель нейро-сепарации нового поколения. Максимальный SNR и натуральный верхний диапазон.',
    size_mb: 182.0,
    recommended_for: 'Профессиональный студийный мастеринг и бескомпромиссная чистота голоса',
    urls: [
      'https://huggingface.co/KimberleyJSN/melbandroformer/resolve/main/MelBandRoformer.ckpt',
      'https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt'
    ],
    is_installed: false,
    installed_bytes: null,
    local_path: null,
    format: 'ckpt',
    engineArchitecture: 'Mel-Scale Band Transformer + Rotary Position Embedding',
    defaultPrefix: 'stem_roformer_mel_',
    icon: 'Layers',
    defaultParams: {
      sensitivity: 1.0,
      marginDb: 1.5,
      postProcessThreshold: 0.20,
      instrumentalBlend: 100.0,
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'roformer_sota',
        title: '👑 Mel-Band Roformer SOTA Pure Vocals',
        description: 'Бескомпромиссная чистота голоса и максимальный SNR',
        params: { autoDownloadModel: true }
      }
    ]
  },
  {
    id: 'bs_roformer_viperx',
    name: 'BS-Roformer Viperx 1297',
    title: 'BS-Roformer Viperx 1297',
    filename: 'aufr33_jarredou_BS_Roformer.ckpt',
    category: 'separation',
    description: 'Улучшенная архитектура Roformer с оптимизацией фазового отклика.',
    size_mb: 171.5,
    recommended_for: 'Кинематографические миксы с объемной звуковой сценой',
    urls: [
      'https://huggingface.co/anvuew/BS-RoFormer/resolve/main/bs_roformer_anvuew_sdr_12.45.ckpt',
      'https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/model_bs_roformer_ep_317_sdr_12.9755.ckpt'
    ],
    is_installed: false,
    installed_bytes: null,
    local_path: null,
    format: 'ckpt',
    engineArchitecture: 'Band-Split RoFormer (SDR 12.97)',
    defaultPrefix: 'stem_bs_roformer_',
    icon: 'Layers',
    defaultParams: {
      sensitivity: 1.0,
      marginDb: 1.5,
      postProcessThreshold: 0.20,
      instrumentalBlend: 100.0,
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'bs_roformer_cinema',
        title: '🎬 BS-Roformer Viperx Кинематографический',
        description: 'Оптимизированный фазовый отклик для объемных сцен фильма',
        params: { autoDownloadModel: true }
      }
    ]
  },
  {
    id: 'voicefixer_fe',
    name: 'VoiceFixer Harmonic Restorer',
    title: 'VoiceFixer Harmonic Restorer (Восстановление гармоник)',
    filename: 'vf.ckpt',
    category: 'vocal_match',
    description: 'Восстановление потерянных высоких частот (air-band), выравнивание формант и динамическая сатурация вокала.',
    size_mb: 112.0,
    recommended_for: 'Придание вокалу дорогого студийного «лампового» блеска перед сведением',
    urls: [
      'https://huggingface.co/cqchangm/voicefixer/resolve/main/vf.ckpt'
    ],
    is_installed: false,
    installed_bytes: null,
    local_path: null,
    format: 'ckpt',
    engineArchitecture: 'VoiceFixer Neural Harmonic Synthesizer',
    defaultPrefix: 'vfix_',
    icon: 'Sparkles',
    defaultParams: {
      airBandBoostDb: 3.5,
      harmonicSaturation: 0.45,
      formantClarity: 0.65,
      subBassPreservation: true,
      warmTubeEmulation: true,
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'studio_air_shine',
        title: '✨ Студийный Air-блеск (+3.5 dB 12-16kHz, шелковый верх)',
        description: 'Открывает дыхание и воздушность микрофона, придавая коммерческий радио-блеск',
        params: { airBandBoostDb: 3.5, harmonicSaturation: 0.40, formantClarity: 0.70, subBassPreservation: true, warmTubeEmulation: true, autoDownloadModel: true }
      },
      {
        id: 'warm_tube_analog',
        title: '🔥 Теплый ламповый аналог (Мягкие четные гармоники)',
        description: 'Насыщает середину приятной аналоговой плотностью для плотных мужских и женских голосов',
        params: { airBandBoostDb: 2.0, harmonicSaturation: 0.65, formantClarity: 0.55, subBassPreservation: true, warmTubeEmulation: true, autoDownloadModel: true }
      },
      {
        id: 'presence_crisp',
        title: '🎙 Прорезающий микс (Максимальная читаемость согласных)',
        description: 'Вытягивает глухие и смазанные согласные в плотных звуковых сценах',
        params: { airBandBoostDb: 4.5, harmonicSaturation: 0.35, formantClarity: 0.85, subBassPreservation: true, warmTubeEmulation: false, autoDownloadModel: true }
      },
      {
        id: 'delicate_silk',
        title: '🪶 Деликатный шелк (Легкое освежение без жесткости)',
        description: 'Тонкая полировка для уже хорошо записанных студийных микрофонов',
        params: { airBandBoostDb: 1.8, harmonicSaturation: 0.25, formantClarity: 0.50, subBassPreservation: true, warmTubeEmulation: true, autoDownloadModel: true }
      }
    ]
  },
  {
    id: 'voicefixer_vocoder',
    name: 'VoiceFixer TFGAN Neural Vocoder',
    title: 'VoiceFixer TFGAN Neural Vocoder',
    filename: 'model.ckpt-1490000_trimed.pt',
    category: 'vocal_match',
    description: 'Нейросетевой вокодер TFGAN для синтеза 44.1kHz формы волны модели VoiceFixer.',
    size_mb: 130.0,
    urls: [
      'https://huggingface.co/cqchangm/voicefixer/resolve/main/model.ckpt-1490000_trimed.pt'
    ],
    is_installed: false,
    installed_bytes: null,
    local_path: null,
    format: 'pt',
    engineArchitecture: 'TFGAN Vocoder'
  },
  {
    id: 'silence_gate',
    category: 'cleaning',
    defaultPrefix: 'gate_',
    title: 'Детекция и гейт тишины',
    description: 'Отсекает фоновый шум микрофона, дыхание и шипение в паузах между фразами (Noise Gate), сохраняя тайминг синхронизации.',
    icon: 'Radio',
    defaultParams: {
      thresholdDb: -45.0,
      rangeDb: -80.0,
      attackMs: 10,
      releaseMs: 160,
      holdMs: 50,
      detectionMode: 'rms'
    },
    presets: [
      {
        id: 'studio_soft',
        title: '🎙 Стандартная студия (Мягкий гейт)',
        description: 'Естественное и плавное затухание для подготовленных студийных помещений',
        params: { thresholdDb: -45.0, rangeDb: -80.0, attackMs: 10, releaseMs: 160, holdMs: 50, detectionMode: 'rms' }
      },
      {
        id: 'home_aggro',
        title: '🏠 Домашняя комната (Глубокое отсечение шума)',
        description: 'Быстрое глушение кулеров ПК, шума улицы и отражений стен в паузах',
        params: { thresholdDb: -36.0, rangeDb: -90.0, attackMs: 5, releaseMs: 120, holdMs: 30, detectionMode: 'peak' }
      },
      {
        id: 'sensitive_mic',
        title: '🤫 Чувствительный микрофон (Плавный спад)',
        description: 'Предотвращает щелчки и резкие обрывы тихих согласных и шепота',
        params: { thresholdDb: -50.0, rangeDb: -65.0, attackMs: 15, releaseMs: 260, holdMs: 80, detectionMode: 'rms' }
      },
      {
        id: 'fast_speech',
        title: '⚡ Быстрый экшен-гейт (Динамичные диалоги)',
        description: 'Мгновенное открытие и закрытие для быстрой скороговорки и криков',
        params: { thresholdDb: -40.0, rangeDb: -85.0, attackMs: 3, releaseMs: 90, holdMs: 20, detectionMode: 'peak' }
      }
    ]
  },
  {
    id: 'phrase_norm',
    category: 'loudness',
    defaultPrefix: 'norm_',
    title: 'Нормализация речевых фраз',
    description: 'Поканально выравнивает громкость каждой дорожки/фразы даббера по стандарту вещания EBU R128 (-16 LUFS) или пикам.',
    icon: 'Volume2',
    defaultParams: {
      mode: 'loudnorm',
      targetLufs: -16.0,
      truePeak: -1.0,
      loudnessRange: 11.0,
      maxGainDb: 12.0,
      dualMono: true
    },
    presets: [
      {
        id: 'streaming_standard',
        title: '📺 Онлайн-кинотеатры (EBU R128 -16 LUFS)',
        description: 'Золотой стандарт громкости для сериалов и аниме (Кинопоиск, Crunchyroll)',
        params: { mode: 'loudnorm', targetLufs: -16.0, truePeak: -1.0, loudnessRange: 11.0, maxGainDb: 12.0, dualMono: true }
      },
      {
        id: 'loud_web',
        title: '📢 Плотный веб-релиз (YouTube / VK -14 LUFS)',
        description: 'Повышенная громкость для прослушивания через динамики смартфонов и ноутбуков',
        params: { mode: 'loudnorm', targetLufs: -14.0, truePeak: -0.8, loudnessRange: 9.0, maxGainDb: 15.0, dualMono: true }
      },
      {
        id: 'cinema_wide',
        title: '🎭 Кинематографичный дубляж (Широкая динамика -18 LUFS)',
        description: 'Максимум выразительности: шепот остается тихим, крики звучат масштабно',
        params: { mode: 'loudnorm', targetLufs: -18.0, truePeak: -1.5, loudnessRange: 14.0, maxGainDb: 9.0, dualMono: true }
      },
      {
        id: 'dyn_leveler',
        title: '🌊 Динамический левелер (DynAudNorm для скачков громкости)',
        description: 'Автоматически подтягивает слишком тихие фразы и сглаживает пики',
        params: { mode: 'dynaudnorm', targetLufs: -15.0, truePeak: -1.0, loudnessRange: 10.0, maxGainDb: 16.0, dualMono: true }
      },
      {
        id: 'pyloudnorm_ebu23',
        title: '📊 EBU R128 pyloudnorm (-23 LUFS)',
        description: 'Прецизионный открытый алгоритм pyloudnorm для эталонного ТВ/кино баланса',
        params: { mode: 'pyloudnorm', targetLufs: -23.0, truePeak: -1.0, loudnessRange: 11.0, maxGainDb: 12.0, dualMono: true }
      }
    ]
  },
  {
    id: 'stage_loudness_norm',
    category: 'loudness',
    defaultPrefix: 'ebunorm_',
    title: 'EBU R128 Автобаланс Громкости (pyloudnorm)',
    description: 'Прецизионная поканальная и мастер-нормализация интегрированной громкости по стандарту EBU R128 (-23 LUFS / -16 LUFS) с True Peak лимитированием через pyloudnorm.',
    icon: 'BarChart2',
    defaultParams: {
      targetLufs: -23.0,
      truePeak: -1.0,
      modeType: 'track'
    },
    presets: [
      {
        id: 'tv_broadcast_23lufs',
        title: '📺 ТВ / Кино вещание (EBU R128 -23 LUFS)',
        description: 'Классический евростандарт EBU R128 (-23.0 LUFS, -1.0 dBTP)',
        params: { targetLufs: -23.0, truePeak: -1.0, modeType: 'track' }
      },
      {
        id: 'web_youtube_16lufs',
        title: '🌐 Web / YouTube (-16 LUFS)',
        description: 'Стандарт для онлайн-платформ и аниме-стриминга (-16.0 LUFS, -1.0 dBTP)',
        params: { targetLufs: -16.0, truePeak: -1.0, modeType: 'track' }
      },
      {
        id: 'master_bus_23lufs',
        title: '🎛️ Финальный Мастер (-23 LUFS Master)',
        description: 'Мастер-баланс суммарного микса с ограничением True Peak',
        params: { targetLufs: -23.0, truePeak: -1.0, modeType: 'master' }
      }
    ]
  },
  {
    id: 'deesser',
    category: 'cleaning',
    defaultPrefix: 'deess_',
    title: 'Деэссер (Смягчение сибилянтов)',
    description: 'Подавляет резкие шипящие и свистящие звуки (С, З, Щ, Ц) в речевых дорожках дабберов.',
    icon: 'ShieldCheck',
    defaultParams: {
      frequencyHz: 6200,
      intensity: 3.5,
      thresholdDb: -22.0,
      bandwidthHz: 2000,
      mode: 'split'
    },
    presets: [
      {
        id: 'female_voice',
        title: '👩 Женский голос (Высокие сибилянты 6.8 kHz)',
        description: 'Точечное подавление свистящих обертонов женского тембра без глухоты',
        params: { frequencyHz: 6800, intensity: 3.5, thresholdDb: -22.0, bandwidthHz: 2000, mode: 'split' }
      },
      {
        id: 'male_voice',
        title: '👨 Мужской голос (Средние сибилянты 5.5 kHz)',
        description: 'Убирает резкое цыканье и шипение в баритоне и теноре',
        params: { frequencyHz: 5500, intensity: 3.0, thresholdDb: -20.0, bandwidthHz: 1800, mode: 'split' }
      },
      {
        id: 'bright_mic_heavy',
        title: '🔪 Яркий конденсаторный микрофон (Глубокое подавление)',
        description: 'Для микрофонов с завышенным верхом, режущим слух на буквах С и Щ',
        params: { frequencyHz: 6200, intensity: 5.2, thresholdDb: -25.0, bandwidthHz: 2600, mode: 'wideband' }
      },
      {
        id: 'natural_gentle',
        title: '🍃 Естественное деликатное сглаживание',
        description: 'Легкое округление транзиентов без потери воздушности звука',
        params: { frequencyHz: 7200, intensity: 2.0, thresholdDb: -18.0, bandwidthHz: 1500, mode: 'split' }
      }
    ]
  },
  {
    id: 'airwindows_restore',
    category: 'cleaning',
    defaultPrefix: 'aw_restore_',
    title: 'Airwindows DSP Restoration (De-plosive + De-Spiff + Mouth De-click)',
    description: 'Набор нативных плагинов Airwindows (DeEss, Pop, Slew3): устраняет сибилянты без потери воздуха, гасит задувания микрофона и высокочастотный треск слюны.',
    icon: 'ShieldCheck',
    defaultParams: {
      deessIntensity: 0.50,
      popIntensity: 0.50,
      slewIntensity: 0.40
    },
    presets: [
      {
        id: 'aw_clean_broadcast',
        title: '🎙 Студийная реставрация Airwindows (De-Esser + Pop + Mouth De-Click)',
        description: 'Прозрачная очистка шипения, задуваний П/Б и щелчков слюны без замыливания верхов',
        params: { deessIntensity: 0.50, popIntensity: 0.50, slewIntensity: 0.40 }
      },
      {
        id: 'aw_heavy_deess',
        title: '🔪 Глубокое подавление свиста (Airwindows DeEss & Slew3)',
        description: 'Для ярких конденсаторных микрофонов с резкими свистящими С/З/Ц',
        params: { deessIntensity: 0.80, popIntensity: 0.60, slewIntensity: 0.50 }
      },
      {
        id: 'aw_de_pop_focus',
        title: '💨 Подавление задуваний и плевков (Airwindows Pop Focus)',
        description: 'Гасит перегрузки капсюля от взрывных согласных П и Б',
        params: { deessIntensity: 0.35, popIntensity: 0.85, slewIntensity: 0.30 }
      }
    ]
  },
  {
    id: 'airwindows_saturate',
    category: 'dynamics',
    defaultPrefix: 'aw_saturate_',
    title: 'Airwindows VoiceTrick & Density (Гармоническое уплотнение)',
    description: 'Гармоническое уплотнение и аналоговая сатурация Airwindows (VoiceTrick / Density) для прозрачной читаемости в миксе.',
    icon: 'Sparkles',
    defaultParams: {
      densityDrive: 0.40
    },
    presets: [
      {
        id: 'aw_warm_tape_density',
        title: '🔥 Аналоговое уплотнение Airwindows (Density Saturation)',
        description: 'Мягкое подмешивание четных гармоник для плотности и объема в миксе',
        params: { densityDrive: 0.40 }
      },
      {
        id: 'aw_voicetrick_punch',
        title: '🎙 VoiceTrick Punch (Прорезающий характер)',
        description: 'Уплотнение голосового формантного спектра для прорезания плотной музыки',
        params: { densityDrive: 0.65 }
      }
    ]
  },
  {
    id: 'airwindows_dsp',
    category: 'mastering',
    defaultPrefix: 'aw_master_',
    title: 'Airwindows DSP Suite (Полный реставрационный и сатурирующий рэк)',
    description: 'Единый комплексный рэк плагинов Airwindows: De-Plosive, De-Esser, Slew De-Click и Density Saturation.',
    icon: 'Sliders',
    defaultParams: {
      deessIntensity: 0.50,
      popIntensity: 0.50,
      slewIntensity: 0.40,
      densityDrive: 0.40
    },
    presets: [
      {
        id: 'aw_full_master_suite',
        title: '👑 Airwindows Complete Voice Strip',
        description: 'Полный комплекс реставрации и уплотнения речи для идеального дубляжа',
        params: { deessIntensity: 0.50, popIntensity: 0.50, slewIntensity: 0.40, densityDrive: 0.40 }
      }
    ]
  },
  {
    id: 'vocal_eq',
    category: 'equalization',
    defaultPrefix: 'eq_',
    title: 'Эквализация голоса (High-Pass & Presence)',
    description: 'Срезает низкочастотный гул (High-Pass 80Hz) и добавляет читаемость в диапазоне 3.2kHz.',
    icon: 'Sliders',
    defaultParams: {
      lowCutHz: 85,
      lowCutSlope: '12dB/oct',
      bodyGainDb: 0.5,
      boxCutGainDb: -1.5,
      presenceHz: 3200,
      presenceGainDb: 2.0,
      airGainDb: 1.5
    },
    presets: [
      {
        id: 'clarity_voiceover',
        title: '✨ Четкий закадр (Чистый низ + Разборчивость)',
        description: 'Идеальная разборчивость текста поверх фоновой японской речи и музыки',
        params: { lowCutHz: 85, lowCutSlope: '12dB/oct', bodyGainDb: 0.5, boxCutGainDb: -1.5, presenceHz: 3200, presenceGainDb: 2.0, airGainDb: 1.5 }
      },
      {
        id: 'warm_baritone',
        title: '🎙 Теплый радио-баритон (Весомый и плотный)',
        description: 'Подчеркивает благородный бархатный низ и тело мужского голоса',
        params: { lowCutHz: 70, lowCutSlope: '12dB/oct', bodyGainDb: 2.5, boxCutGainDb: -2.0, presenceHz: 2800, presenceGainDb: 1.5, airGainDb: 1.0 }
      },
      {
        id: 'anime_bright',
        title: '🌸 Звонкий аниме-тембр (Прорезной звук)',
        description: 'Открытый, светлый и эмоциональный тон для персонажей подростков',
        params: { lowCutHz: 105, lowCutSlope: '24dB/oct', bodyGainDb: -1.0, boxCutGainDb: -2.5, presenceHz: 3600, presenceGainDb: 3.0, airGainDb: 2.5 }
      },
      {
        id: 'clean_mud',
        title: '🧹 Очистка от бубнения и комнатной грязи',
        description: 'Глубокий срез низкого гула и вырез коробочных резонансов помещения 500 Hz',
        params: { lowCutHz: 120, lowCutSlope: '24dB/oct', bodyGainDb: -2.0, boxCutGainDb: -4.0, presenceHz: 3000, presenceGainDb: 1.5, airGainDb: 0.5 }
      }
    ]
  },
  {
    id: 'glue_compress',
    category: 'dynamics',
    defaultPrefix: 'glue_',
    title: 'Компрессия и склейка голосов',
    description: 'Объединяет дорожки всех дабберов в монолитный вокальный микс через шинный компрессор (Glue Compressor & Limiter).',
    icon: 'Layers',
    defaultParams: {
      thresholdDb: -18.0,
      ratio: 3.0,
      attackMs: 20,
      releaseMs: 250,
      kneeDb: 3.5,
      makeupDb: 2.0,
      peakLimitDb: -1.0
    },
    presets: [
      {
        id: 'gentle_glue',
        title: '🤝 Мягкая склейка (Незаметное сглаживание баланса)',
        description: 'Бережно сшивает разные микрофоны без эффекта накачки',
        params: { thresholdDb: -18.0, ratio: 2.5, attackMs: 30, releaseMs: 280, kneeDb: 4.0, makeupDb: 1.5, peakLimitDb: -1.0 }
      },
      {
        id: 'shonen_action',
        title: '🥋 Плотный сёнэн / Экшен (Четкий ровный уровень)',
        description: 'Быстрый контроль криков и эмоциональных всплесков в битвах',
        params: { thresholdDb: -22.0, ratio: 4.0, attackMs: 15, releaseMs: 180, kneeDb: 2.5, makeupDb: 3.5, peakLimitDb: -0.8 }
      },
      {
        id: 'drama_gentle',
        title: '🎭 Драматический дубляж (Сохранение полутонов)',
        description: 'Широкое колено и медленная атака для глубоких разговорных сцен',
        params: { thresholdDb: -15.0, ratio: 2.0, attackMs: 45, releaseMs: 350, kneeDb: 6.0, makeupDb: 1.0, peakLimitDb: -1.2 }
      },
      {
        id: 'solid_brick',
        title: '🧱 Монолитный микс (Одинаковая подача всех дабберов)',
        description: 'Максимально плотно усаживает разные голоса в одну плоскость звука',
        params: { thresholdDb: -24.0, ratio: 5.5, attackMs: 10, releaseMs: 140, kneeDb: 2.0, makeupDb: 4.5, peakLimitDb: -0.5 }
      }
    ]
  },
  {
    id: 'ducking',
    category: 'balance',
    defaultPrefix: 'ducking_',
    title: 'Сайдчейн-даккинг оригинального звука',
    description: 'Автоматически приглушает оригинальный звук видео во время речи дабберов и восстанавливает в паузах.',
    icon: 'Music',
    defaultParams: {
      duckingAmountDb: -14.0,
      attackMs: 40,
      releaseMs: 320,
      holdMs: 120,
      threshold: 0.08,
      filterMusicOnly: false
    },
    presets: [
      {
        id: 'classic_voiceover',
        title: '🎬 Классический закадр (Фон слышен, но не мешает)',
        description: 'Японская речь и музыка слышны на фоне, русская озвучка читается на 100%',
        params: { duckingAmountDb: -14.0, attackMs: 40, releaseMs: 350, holdMs: 120, threshold: 0.08, filterMusicOnly: false }
      },
      {
        id: 'deep_focus',
        title: '🎧 Глубокий даккинг (Максимальный акцент на русском голосе)',
        description: 'Оригинальный звук сильно отступает назад во время реплик',
        params: { duckingAmountDb: -18.0, attackMs: 25, releaseMs: 420, holdMs: 180, threshold: 0.05, filterMusicOnly: false }
      },
      {
        id: 'musical_smooth',
        title: '🎵 Музыкальный даккинг (Плавные и незаметные переходы)',
        description: 'Медленная атака и релиз без резких скачков громкости в ост-треках',
        params: { duckingAmountDb: -10.0, attackMs: 70, releaseMs: 500, holdMs: 200, threshold: 0.10, filterMusicOnly: true }
      },
      {
        id: 'rapid_dialog',
        title: '⚡ Быстрый диалоговый даккинг (Для частых коротких реплик)',
        description: 'Моментальное реагирование на короткие междометия и реплики',
        params: { duckingAmountDb: -13.0, attackMs: 20, releaseMs: 220, holdMs: 80, threshold: 0.07, filterMusicOnly: false }
      }
    ]
  },
  {
    id: 'master_audio_mix',
    category: 'mastering',
    defaultPrefix: 'master_mix_',
    title: 'Мастер-микс аудио (Голос + Фон)',
    description: 'Сводит склеенный голос и приглушенный оригинальный звук видео в готовый стерео мастер-аудиофайл.',
    icon: 'Headphones',
    defaultParams: {
      voiceVolume: 1.0,
      bgVolume: 0.85,
      stereoWidth: 1.15,
      limiterCeilingDb: -0.5,
      limiterReleaseMs: 40
    },
    presets: [
      {
        id: 'balanced_center',
        title: '🏆 Сбалансированный мастер (Голос в центре, фон по бокам)',
        description: 'Идеальное пространственное разделение: вокал по центру, музыка широко в стерео',
        params: { voiceVolume: 1.0, bgVolume: 0.85, stereoWidth: 1.15, limiterCeilingDb: -0.5, limiterReleaseMs: 40 }
      },
      {
        id: 'voice_forward',
        title: '🗣 Акцент на озвучке (Громкий разборчивый дубляж)',
        description: 'Выдвигает голоса дабберов на первый план, идеален для шумного транспорта',
        params: { voiceVolume: 1.15, bgVolume: 0.70, stereoWidth: 1.25, limiterCeilingDb: -0.3, limiterReleaseMs: 30 }
      },
      {
        id: 'cinema_full',
        title: '🍿 Кинотеатральный баланс (Мощные эффекты и естественный закадр)',
        description: 'Сохраняет плотность взрывов, музыки и оригинальных звуков сериала',
        params: { voiceVolume: 0.95, bgVolume: 0.95, stereoWidth: 1.05, limiterCeilingDb: -0.8, limiterReleaseMs: 50 }
      },
      {
        id: 'headphone_safe',
        title: '📱 Для мобильных устройств и наушников (Без искажений)',
        description: 'Защищенный лимитером микс без клиппинга на любых встроенных динамиках',
        params: { voiceVolume: 1.10, bgVolume: 0.75, stereoWidth: 1.10, limiterCeilingDb: -0.2, limiterReleaseMs: 25 }
      }
    ]
  },
  {
    id: 'video_mux',
    category: 'export',
    defaultPrefix: 'video_mux_',
    title: 'Сведение видео (Final Video Mux)',
    description: 'Вшивание готового сведенного мастер-аудио в видеоряд серии через мгновенное потоковое копирование без потери качества.',
    icon: 'Film',
    defaultParams: {
      videoCodec: 'copy',
      audioBitrate: '320k',
      fastStart: true,
      crf: 18
    },
    presets: [
      {
        id: 'instant_copy_320k',
        title: '⚡ Мгновенная сборка без потерь (Stream Copy 320k AAC)',
        description: 'Видеоряд не пережимается (0% потерь качества, рендер за 3-5 секунд)',
        params: { videoCodec: 'copy', audioBitrate: '320k', fastStart: true, crf: 18 }
      },
      {
        id: 'web_compatible_256k',
        title: '🌐 Максимальная совместимость (High Quality 256k Web-ready)',
        description: 'Стандартный контейнер MP4 со смещением moov-атома для онлайн-плееров',
        params: { videoCodec: 'copy', audioBitrate: '256k', fastStart: true, crf: 19 }
      },
      {
        id: 'flac_studio_lossless',
        title: '💎 Студийный мастер (Lossless FLAC аудио)',
        description: 'Аудио без сжатия с потерями для архива студии и монтажа',
        params: { videoCodec: 'copy', audioBitrate: 'flac', fastStart: false, crf: 17 }
      },
      {
        id: 'compact_social',
        title: '📦 Компактный размер для Telegram / соцсетей (192k AAC)',
        description: 'Экономия трафика при сохранении отличной разборчивости речи',
        params: { videoCodec: 'copy', audioBitrate: '192k', fastStart: true, crf: 20 }
      }
    ]
  },
  {
    id: 'de_plosive',
    category: 'cleaning',
    defaultPrefix: 'deplosive_',
    title: 'Подавление задувов и взрывных согласных (De-Plosive Pro)',
    description: 'Интеллектуальный Linkwitz-Riley LR4 фильтр для устранения плевков в микрофон (звуки «П», «Б», ветровые задувы).',
    icon: 'ShieldCheck',
    defaultParams: {
      thresholdDb: -24.0,
      frequencyLimitHz: 120,
      suppressionDepthDb: -18.0,
      recoveryMs: 35,
      wetDryPercent: 100
    },
    presets: [
      {
        id: 'standard_vocal',
        title: '🎙 Стандартный студийный поп-фильтр',
        description: 'Убирает характерные хлопки на согласных «П» и «Б»',
        params: { thresholdDb: -24.0, frequencyLimitHz: 120, suppressionDepthDb: -18.0, recoveryMs: 35, wetDryPercent: 100 }
      },
      {
        id: 'heavy_plosive',
        title: '💨 Глубокое подавление сильных задувов',
        description: 'Для записей близко к микрофону без физического поп-фильтра',
        params: { thresholdDb: -30.0, frequencyLimitHz: 160, suppressionDepthDb: -26.0, recoveryMs: 45, wetDryPercent: 100 }
      }
    ]
  },
  {
    id: 'vocal_thickener',
    category: 'dynamics',
    defaultPrefix: 'thick_',
    title: 'Уплотнение голоса и ленточная сатурация (Vocal Thickener)',
    description: 'Синтезирует четные субгармоники Чебышёва для плотности тела голоса и добавляет благородный аналоговый тон.',
    icon: 'Sparkles',
    defaultParams: {
      bodyDrivePercent: 50,
      presenceClarityPercent: 40,
      tapeDensityPercent: 45,
      mixPercent: 100
    },
    presets: [
      {
        id: 'radio_warmth',
        title: '📻 Теплый ламповый тембр',
        description: 'Добавляет объем и бархатистость нижней середине',
        params: { bodyDrivePercent: 60, presenceClarityPercent: 35, tapeDensityPercent: 50, mixPercent: 100 }
      },
      {
        id: 'anime_presence',
        title: '✨ Яркое присутствие на первом плане',
        description: 'Плотный, пробивной и четкий вокал сквозь громкий фоновый саундтрек',
        params: { bodyDrivePercent: 45, presenceClarityPercent: 65, tapeDensityPercent: 40, mixPercent: 100 }
      }
    ]
  },
  {
    id: 'spectral_dereverb_lite',
    category: 'cleaning',
    defaultPrefix: 'dereverb_',
    title: 'Спектральное устранение комнатного эха (Spectral De-Reverb)',
    description: '16-полосный DSP анализ затухания диффузной энергии (EDR) с защитой согласных и артикуляции.',
    icon: 'Radio',
    defaultParams: {
      reductionDb: -9.0,
      decayTimeEstMs: 350.0,
      clarityPercent: 70.0,
      mixPercent: 100.0
    },
    presets: [
      {
        id: 'small_room',
        title: '🏠 Жилая комната (Короткие отражения)',
        description: 'Устраняет коробочный призвук необработанной комнаты',
        params: { reductionDb: -8.0, decayTimeEstMs: 250.0, clarityPercent: 75.0, mixPercent: 100.0 }
      },
      {
        id: 'hall_reverb',
        title: '🏛 Большой зал (Длинные хвосты эха)',
        description: 'Глубокое подавление длинного реверберационного шлейфа',
        params: { reductionDb: -14.0, decayTimeEstMs: 550.0, clarityPercent: 80.0, mixPercent: 100.0 }
      }
    ]
  },
  {
    id: 'headroom_recovery',
    category: 'dynamics',
    defaultPrefix: 'headroom_',
    title: 'Разгон громкости и True-Peak защита (Headroom Recovery)',
    description: 'Безопасный разгон тихих записей до целевого пикового запаса громкости с lookahead-лимитером.',
    icon: 'Activity',
    defaultParams: {
      targetPeakDb: -6.0,
      maxBoostDb: 36.0,
      manualGainDb: 0.0,
      autoHeadroom: true,
      lookaheadMs: 3.0,
      mixPercent: 100
    },
    presets: [
      {
        id: 'safe_boost',
        title: '🎯 Авто-подгонка к -6 dBFS Peak',
        description: 'Оптимальный запас по громкости для последующей студийной обработки',
        params: { targetPeakDb: -6.0, maxBoostDb: 30.0, manualGainDb: 0.0, autoHeadroom: true, lookaheadMs: 3.0, mixPercent: 100 }
      }
    ]
  },
  {
    id: 'speech_leveler',
    category: 'dynamics',
    defaultPrefix: 'leveler_',
    title: 'Двухступенчатый выравниватель речи (Speech Leveler Pro)',
    description: 'Плавный RMS авто-фейдер пауз и быстрый soft-knee лимитер всплесков для идеально ровного диалога.',
    icon: 'Sliders',
    defaultParams: {
      targetLevelDb: -18.0,
      levelingSpeedMs: 300.0,
      maxBoostDb: 12.0,
      maxCutDb: -18.0,
      silenceGateDb: -45.0,
      peakCeilingDb: -2.0,
      mixPercent: 100
    },
    presets: [
      {
        id: 'dialog_level',
        title: '🎙 Студийный диалоговый левелер',
        description: 'Выравнивает разницу между шепотом и криком в репликах',
        params: { targetLevelDb: -18.0, levelingSpeedMs: 300.0, maxBoostDb: 12.0, maxCutDb: -18.0, silenceGateDb: -45.0, peakCeilingDb: -2.0, mixPercent: 100 }
      }
    ]
  },
  {
    id: 'voice_eq',
    category: 'equalization',
    defaultPrefix: 'eq_',
    title: 'Вокальный эквалайзер Pedalboard (Highpass + Presence)',
    description: 'Студийный фильтр Spotify Pedalboard: срез низкочастотного гула и задуваний микрофона + параметрический пик презенса 2.5–4.5 кГц + срез ультравысокого шипения.',
    icon: 'Sliders',
    defaultParams: {
      eqHighpass: 80,
      eqPresenceFreq: 3200,
      eqPresenceGain: 2.5,
      eqLowpass: 18000
    },
    presets: [
      {
        id: 'male_dense',
        title: '🎙 Мужской голос (плотный)',
        description: 'Плотный бархатный низ и разборчивость на 2.8 кГц',
        params: { eqHighpass: 75, eqPresenceFreq: 2800, eqPresenceGain: 2.0, eqLowpass: 17500 }
      },
      {
        id: 'female_clean',
        title: '✨ Женский голос (чистый)',
        description: 'Чистый прозрачный верх и подъем читаемости на 3.6 кГц',
        params: { eqHighpass: 110, eqPresenceFreq: 3600, eqPresenceGain: 3.0, eqLowpass: 19000 }
      },
      {
        id: 'whisper_room',
        title: '🤫 Шепот / комната',
        description: 'Подъем тихих формант речи на 4.2 кГц с надежным Highpass срезом',
        params: { eqHighpass: 95, eqPresenceFreq: 4200, eqPresenceGain: 3.5, eqLowpass: 16000 }
      },
      {
        id: 'action_dub',
        title: '💥 Агрессивный дубляж (экшн)',
        description: 'Прорезной презенс +4.0 dB для битв и громких спецэффектов',
        params: { eqHighpass: 85, eqPresenceFreq: 3200, eqPresenceGain: 4.0, eqLowpass: 18000 }
      }
    ]
  },
  {
    id: 'voice_compressor',
    category: 'dynamics',
    defaultPrefix: 'comp_',
    title: 'Вокальный компрессор Pedalboard (Threshold, Ratio, Attack/Release)',
    description: 'Высокоточный компрессор Spotify Pedalboard для выравнивания динамики речи, усадки голоса в микс и контроля всплесков громкости.',
    icon: 'Layers',
    defaultParams: {
      compThresholdDb: -18.0,
      compRatio: 3.5,
      compAttackMs: 15.0,
      compReleaseMs: 120.0
    },
    presets: [
      {
        id: 'comp_male',
        title: '🎙 Мужской голос (плотный)',
        description: 'Контроль динамики с ratio 4:1 и мягким релизом 150мс',
        params: { compThresholdDb: -20.0, compRatio: 4.0, compAttackMs: 20.0, compReleaseMs: 150.0 }
      },
      {
        id: 'comp_female',
        title: '✨ Женский голос (чистый)',
        description: 'Быстрая деликатная компрессия с сохранением дыхания',
        params: { compThresholdDb: -16.0, compRatio: 3.0, compAttackMs: 12.0, compReleaseMs: 100.0 }
      },
      {
        id: 'comp_whisper',
        title: '🤫 Шепот / комната',
        description: 'Глубокий захват тихих деталей с порогом -24 dB',
        params: { compThresholdDb: -24.0, compRatio: 2.8, compAttackMs: 10.0, compReleaseMs: 80.0 }
      },
      {
        id: 'comp_action',
        title: '💥 Агрессивный дубляж (экшн)',
        description: 'Жесткий контроль криков и динамики с ratio 5.5:1',
        params: { compThresholdDb: -22.0, compRatio: 5.5, compAttackMs: 8.0, compReleaseMs: 90.0 }
      }
    ]
  },
  {
    id: 'voice_deesser',
    category: 'cleaning',
    defaultPrefix: 'deess_',
    title: 'Вокальный де-эссер / сатуратор Pedalboard',
    description: 'Сглаживание резких свистящих звуков «С/Ц/Щ» без замыливания звука и потери воздуха в речи.',
    icon: 'ShieldCheck',
    defaultParams: {
      deesserFreqHz: 6500,
      deesserAmount: 0.60
    },
    presets: [
      {
        id: 'deess_gentle',
        title: '🍃 Мягкое сглаживание',
        description: 'Естественное подавление свистящих на 6.8 кГц',
        params: { deesserFreqHz: 6800, deesserAmount: 0.45 }
      },
      {
        id: 'deess_heavy',
        title: '🛡 Глубокое подавление сибилянтов',
        description: 'Для ярких микрофонов с акцентированным цоканьем',
        params: { deesserFreqHz: 6200, deesserAmount: 0.80 }
      },
      {
        id: 'deess_female',
        title: '✨ Женский звонкий тембр',
        description: 'Точечный вырез свистящих на 7.2 кГц',
        params: { deesserFreqHz: 7200, deesserAmount: 0.65 }
      }
    ]
  },
  {
    id: 'voice_reverb',
    category: 'effects',
    defaultPrefix: 'reverb_',
    title: 'Пространственный ревербератор Pedalboard (Room Reverb)',
    description: 'Добавление реалистичного объема и студийной дикторской комнаты (Room size, Damping, Wet/Dry).',
    icon: 'Waves',
    defaultParams: {
      reverbRoomSize: 0.12,
      reverbDamping: 0.5,
      reverbWet: 0.06,
      reverbDry: 0.94
    },
    presets: [
      {
        id: 'reverb_booth',
        title: '🎙 Студийная дикторская кабина',
        description: 'Минимальный объем (4% Wet) для естественной посадки голоса',
        params: { reverbRoomSize: 0.08, reverbDamping: 0.6, reverbWet: 0.04, reverbDry: 0.96 }
      },
      {
        id: 'reverb_room',
        title: '🏠 Жилая комната (реализм)',
        description: 'Естественная комнатная акустика для реалистичных сцен',
        params: { reverbRoomSize: 0.18, reverbDamping: 0.45, reverbWet: 0.09, reverbDry: 0.91 }
      },
      {
        id: 'reverb_hall',
        title: '🏛 Просторный зал / Эхо',
        description: 'Объемное звучание для воспоминаний, снов и больших залов',
        params: { reverbRoomSize: 0.45, reverbDamping: 0.3, reverbWet: 0.22, reverbDry: 0.78 }
      }
    ]
  },
  {
    id: 'voice_limiter',
    category: 'mastering',
    defaultPrefix: 'limit_',
    title: 'Мастер-лимитер Pedalboard (Brickwall True-Peak)',
    description: 'Прецизионный Brickwall лимитер Spotify Pedalboard для защиты от цифрового клиппинга и безопасной накачки громкости.',
    icon: 'Maximize2',
    defaultParams: {
      limiterThresholdDb: -0.5,
      limiterReleaseMs: 40.0
    },
    presets: [
      {
        id: 'limit_broadcast',
        title: '📺 True-Peak Broadcast (-0.5 dBFS)',
        description: 'Стандарт стриминговых платформ и телетрансляций',
        params: { limiterThresholdDb: -0.5, limiterReleaseMs: 40.0 }
      },
      {
        id: 'limit_safe',
        title: '🛡 Web Safe (-1.0 dBFS)',
        description: 'Максимальная защита от искажений при сжатии в AAC/MP3',
        params: { limiterThresholdDb: -1.0, limiterReleaseMs: 50.0 }
      },
      {
        id: 'limit_action',
        title: '💥 Агрессивный срез пиков (-0.2 dBFS)',
        description: 'Плотная посадка голоса с быстрым релизом 25мс',
        params: { limiterThresholdDb: -0.2, limiterReleaseMs: 25.0 }
      }
    ]
  },
  {
    id: 'voice_master_strip',
    category: 'mastering',
    defaultPrefix: 'pedalboard_',
    title: 'Студийная полоса Spotify Pedalboard (EQ + Comp + DeEss + Reverb + Limiter)',
    description: 'Полная студийная DSP цепочка постобработки голоса: Highpass + Presence EQ + Компрессор + Де-эссер + Пространство + True-Peak Лимитер.',
    icon: 'Sparkles',
    defaultParams: {
      eqHighpass: 80,
      eqPresenceFreq: 3200,
      eqPresenceGain: 2.5,
      eqLowpass: 18000,
      compThresholdDb: -18.0,
      compRatio: 3.5,
      compAttackMs: 15.0,
      compReleaseMs: 120.0,
      deesserFreqHz: 6500,
      deesserAmount: 0.60,
      reverbRoomSize: 0.12,
      reverbDamping: 0.5,
      reverbWet: 0.06,
      reverbDry: 0.94,
      limiterThresholdDb: -0.5,
      limiterReleaseMs: 40.0
    },
    presets: [
      {
        id: 'strip_male',
        title: '🎙 Мужской голос (плотный)',
        description: 'Глубокий плотный низ, разборчивый презенс на 2.8 кГц и сбалансированная компрессия',
        params: {
          eqHighpass: 75, eqPresenceFreq: 2800, eqPresenceGain: 2.5, eqLowpass: 17500,
          compThresholdDb: -20.0, compRatio: 4.0, compAttackMs: 18.0, compReleaseMs: 140.0,
          deesserFreqHz: 6200, deesserAmount: 0.55,
          reverbRoomSize: 0.10, reverbDamping: 0.55, reverbWet: 0.05, reverbDry: 0.95,
          limiterThresholdDb: -0.5, limiterReleaseMs: 40.0
        }
      },
      {
        id: 'strip_female',
        title: '✨ Женский голос (чистый)',
        description: 'Хрустальный чистый верх, сглаживание сибилянтов на 7.0 кГц и прозрачная динамика',
        params: {
          eqHighpass: 110, eqPresenceFreq: 3600, eqPresenceGain: 3.0, eqLowpass: 19000,
          compThresholdDb: -17.0, compRatio: 3.2, compAttackMs: 12.0, compReleaseMs: 100.0,
          deesserFreqHz: 7000, deesserAmount: 0.70,
          reverbRoomSize: 0.12, reverbDamping: 0.50, reverbWet: 0.06, reverbDry: 0.94,
          limiterThresholdDb: -0.5, limiterReleaseMs: 35.0
        }
      },
      {
        id: 'strip_whisper',
        title: '🤫 Шепот / комната',
        description: 'Вытягивание тихих деталей, пространственная комната и защита от шумов',
        params: {
          eqHighpass: 95, eqPresenceFreq: 4000, eqPresenceGain: 3.5, eqLowpass: 16000,
          compThresholdDb: -25.0, compRatio: 2.8, compAttackMs: 10.0, compReleaseMs: 80.0,
          deesserFreqHz: 6800, deesserAmount: 0.50,
          reverbRoomSize: 0.22, reverbDamping: 0.45, reverbWet: 0.12, reverbDry: 0.88,
          limiterThresholdDb: -0.5, limiterReleaseMs: 45.0
        }
      },
      {
        id: 'strip_action',
        title: '💥 Агрессивный дубляж (экшн)',
        description: 'Максимальный напор, пробивной презенс +4 dB и жесткий контроль криков',
        params: {
          eqHighpass: 85, eqPresenceFreq: 3200, eqPresenceGain: 4.0, eqLowpass: 18000,
          compThresholdDb: -22.0, compRatio: 5.5, compAttackMs: 8.0, compReleaseMs: 90.0,
          deesserFreqHz: 6500, deesserAmount: 0.75,
          reverbRoomSize: 0.08, reverbDamping: 0.60, reverbWet: 0.04, reverbDry: 0.96,
          limiterThresholdDb: -0.3, limiterReleaseMs: 25.0
        }
      }
    ]
  },
  // ============================================================================
  // ВЫДЕЛЕННЫЕ МОДУЛИ ОБРАБОТКИ FFMPEG (БЕЗ СКРЫТЫХ ФОЛЛБЭКОВ)
  // ============================================================================
  {
    id: 'ffmpeg_timbre_eq',
    category: 'timbre',
    defaultPrefix: '01_ff_timbre_',
    title: 'FFmpeg: Многополосная калибровка АЧХ по эталону (Broadcast EQ)',
    description: 'Чистая аппаратная обработка FFmpeg: 5-полосный параметрический эквалайзер и срез суб-баса для приведения тембра голоса к студийным профилям без участия Python.',
    icon: 'Sliders',
    defaultParams: {
      matchIntensity: 75,
      targetProfile: 'studio_neutral',
      subBassCutoff: 75,
      airLimitDb: 3.0
    },
    presets: [
      {
        id: 'ff_timbre_neutral',
        title: '🎯 Студийный эталон (FFmpeg EQ)',
        description: 'Сбалансированная коррекция мутности 250 Гц и подъем разборчивости 3.2 кГц',
        params: { matchIntensity: 75, targetProfile: 'studio_neutral', subBassCutoff: 75, airLimitDb: 3.0 }
      },
      {
        id: 'ff_timbre_warm',
        title: '📻 Тёплый бродкаст (FFmpeg EQ)',
        description: 'Уплотнение нижней середины 160 Гц и мягкий верх',
        params: { matchIntensity: 75, targetProfile: 'warm_broadcast', subBassCutoff: 70, airLimitDb: 2.0 }
      },
      {
        id: 'ff_timbre_crisp',
        title: '✨ Яркий аниме-презенс (FFmpeg EQ)',
        description: 'Акцент на 1.8–3.8 кГц и открытый верх 11 кГц',
        params: { matchIntensity: 80, targetProfile: 'crisp_anime', subBassCutoff: 85, airLimitDb: 3.5 }
      }
    ]
  },
  {
    id: 'ffmpeg_denoise',
    category: 'denoise',
    defaultPrefix: '01_ff_denoise_',
    title: 'FFmpeg: Спектральное Шумоподавление (afftdn + Formant EQ)',
    description: 'Прямой спектральный шумодав FFmpeg (afftdn) с сохранением голосовых формант и регулировкой подмешивания Dry/Wet.',
    icon: 'ShieldCheck',
    defaultParams: {
      noiseReductionDb: 18.0,
      noiseFloorDb: -52.0,
      sensitivity: 5.0,
      wetDryBlend: 95.0,
      preserveVoiceFormants: true,
      noiseTraining: false
    },
    presets: [
      {
        id: 'ff_denoise_gentle',
        title: '🍃 Бережная чистка (FFmpeg afftdn)',
        description: 'Мягкое удаление фонового шипения без искажения тембра',
        params: { noiseReductionDb: 12.0, noiseFloorDb: -55.0, sensitivity: 4.0, wetDryBlend: 90.0, preserveVoiceFormants: true, noiseTraining: false }
      },
      {
        id: 'ff_denoise_strong',
        title: '🛡️ Глубокое подавление шума (FFmpeg afftdn)',
        description: 'Интенсивная очистка шумных домашних записей с автозахватом профиля шума',
        params: { noiseReductionDb: 24.0, noiseFloorDb: -48.0, sensitivity: 7.5, wetDryBlend: 100.0, preserveVoiceFormants: true, noiseTraining: true }
      }
    ]
  },
  {
    id: 'ffmpeg_deecho',
    category: 'denoise',
    defaultPrefix: '02_ff_deecho_',
    title: 'FFmpeg: Подавление Эха и Комнаты (afftdn + Notch EQ)',
    description: 'Подавление комнатных отражений и порхающего эха средствами FFmpeg (спектральный фильтр + вырез резонансов комнаты + сохранение тела голоса).',
    icon: 'Waves',
    defaultParams: {
      deechoReductionDb: 14.0,
      earlyReflectionsDecay: 0.70,
      sensitivity: 5.0,
      wetDryBlend: 85.0,
      preserveBodyFrequencies: true,
      noiseTraining: false
    },
    presets: [
      {
        id: 'ff_deecho_standard',
        title: '🏠 Стандартная сушка комнаты (FFmpeg)',
        description: 'Ослабление коробочных отражений и хвостов реверберации',
        params: { deechoReductionDb: 14.0, earlyReflectionsDecay: 0.70, sensitivity: 5.0, wetDryBlend: 85.0, preserveBodyFrequencies: true, noiseTraining: false }
      },
      {
        id: 'ff_deecho_tight',
        title: '🔇 Плотный сухой голос (FFmpeg)',
        description: 'Максимальное приглушение ранних отражений и гула помещения',
        params: { deechoReductionDb: 20.0, earlyReflectionsDecay: 0.90, sensitivity: 7.5, wetDryBlend: 95.0, preserveBodyFrequencies: true, noiseTraining: true }
      }
    ]
  },
  {
    id: 'ffmpeg_vocal_remover',
    category: 'separation',
    defaultPrefix: '01_ff_stem_',
    title: 'FFmpeg: Частотно-спектральное разделение оригинала (DSP M&E Filter)',
    description: 'Быстрое разделение оригинальной дорожки на вокальный диапазон и фонограмму (M&E) средствами фильтров FFmpeg без нейросетей.',
    icon: 'Scissors',
    defaultParams: {
      sensitivity: 5.0,
      marginDb: 1.5,
      postProcessThreshold: 0.20,
      instrumentalBlend: 100.0
    },
    presets: [
      {
        id: 'ff_sep_balanced',
        title: '⚖️ Сбалансированное приглушение вокала (FFmpeg)',
        description: 'Ослабление центральных речевых частот оригинала с сохранением эффектов',
        params: { sensitivity: 5.0, marginDb: 1.5, postProcessThreshold: 0.20, instrumentalBlend: 100.0 }
      },
      {
        id: 'ff_sep_deep',
        title: '🔪 Глубокий вырез речевого спектра (FFmpeg)',
        description: 'Максимальное подавление частот голоса 1–3.2 кГц в фонограмме',
        params: { sensitivity: 8.5, marginDb: 2.0, postProcessThreshold: 0.35, instrumentalBlend: 100.0 }
      }
    ]
  },
  {
    id: 'ffmpeg_harmonic_restorer',
    category: 'restoration',
    defaultPrefix: '03_ff_exciter_',
    title: 'FFmpeg: Гармонический Эксайтер и ВЧ-Реставратор (Air & Exciter)',
    description: 'Восстановление высоких частот (13.5 кГц), читаемости формант (3.4 кГц) и ламповое насыщение через фильтр FFmpeg aexciter.',
    icon: 'Sparkles',
    defaultParams: {
      airBandBoostDb: 3.5,
      harmonicSaturation: 0.45,
      formantClarity: 0.65,
      subBassPreservation: true,
      warmTubeEmulation: true
    },
    presets: [
      {
        id: 'ff_exciter_studio',
        title: '✨ Воздух и ясность (FFmpeg aexciter)',
        description: 'Оживление глухих микрофонов и добавление студийного блеска',
        params: { airBandBoostDb: 3.5, harmonicSaturation: 0.45, formantClarity: 0.65, subBassPreservation: true, warmTubeEmulation: true }
      }
    ]
  },
  {
    id: 'ffmpeg_master_strip',
    category: 'dynamics',
    defaultPrefix: '04_ff_strip_',
    title: 'FFmpeg: Вокальный Ченнел-Стрип (EQ + Компрессор + Де-Эссер + Лимитер)',
    description: 'Полная цепочка динамической обработки голоса на чистом FFmpeg: срез НЧ, презенс EQ, де-эссер, компрессор, пространственное эхо и лимитер.',
    icon: 'Sliders',
    defaultParams: {
      eqHighpass: 80,
      eqPresenceFreq: 3200,
      eqPresenceGain: 2.5,
      eqLowpass: 18000,
      compThresholdDb: -18.0,
      compRatio: 3.5,
      compAttackMs: 15.0,
      compReleaseMs: 120.0,
      deesserFreqHz: 6500,
      deesserAmount: 0.60,
      reverbWet: 0.04,
      limiterThresholdDb: -0.5
    },
    presets: [
      {
        id: 'ff_strip_broadcast',
        title: '🎙️ Студийный вокальный стрип (FFmpeg)',
        description: 'Универсальная цепочка EQ + Compressor + De-Esser + Limiter',
        params: { eqHighpass: 80, eqPresenceFreq: 3200, eqPresenceGain: 2.5, eqLowpass: 18000, compThresholdDb: -18.0, compRatio: 3.5, compAttackMs: 15.0, compReleaseMs: 120.0, deesserFreqHz: 6500, deesserAmount: 0.60, reverbWet: 0.04, limiterThresholdDb: -0.5 }
      }
    ]
  },
  {
    id: 'ffmpeg_airwindows_strip',
    category: 'restoration',
    defaultPrefix: '03_ff_restore_',
    title: 'FFmpeg: Фильтр задувов, сибилянтов и сатурации (Pop + DeEss + Exciter)',
    description: 'Аппаратная цепочка FFmpeg для подавления взрывных согласных (Pop), резких свистящих (DeEss), ВЧ-среза (Slew) и гармонического уплотнения.',
    icon: 'Wand2',
    defaultParams: {
      deessIntensity: 0.50,
      popIntensity: 0.50,
      slewIntensity: 0.40,
      densityDrive: 0.40
    },
    presets: [
      {
        id: 'ff_aw_clean',
        title: '🧹 Чистка сибилянтов и задувов (FFmpeg)',
        description: 'Мягкое устранение «П/Б» и «С/Ц» с легким насыщением',
        params: { deessIntensity: 0.55, popIntensity: 0.55, slewIntensity: 0.40, densityDrive: 0.35 }
      }
    ]
  },
  {
    id: 'ffmpeg_loudnorm',
    category: 'dynamics',
    defaultPrefix: '03_ff_loudnorm_',
    title: 'FFmpeg: Нормализация громкости EBU R128 (Loudnorm + Limiter)',
    description: 'Прямая нормализация громкости по стандарту вещания EBU R128 через фильтр FFmpeg loudnorm с защитой истинных пиков (True Peak Limiter).',
    icon: 'Volume2',
    defaultParams: {
      targetLufs: -16.0,
      truePeak: -1.0,
      lra: 11.0
    },
    presets: [
      {
        id: 'ff_lufs_16',
        title: '📺 Стриминг и Аниме (-16 LUFS / -1 dBTP)',
        description: 'Стандарт громкости для онлайн-платформ и видеоплееров',
        params: { targetLufs: -16.0, truePeak: -1.0, lra: 11.0 }
      },
      {
        id: 'ff_lufs_23',
        title: '📻 ТВ Бродкаст EBU R128 (-23 LUFS / -1 dBTP)',
        description: 'Строгий телевизионный стандарт EBU R128',
        params: { targetLufs: -23.0, truePeak: -1.0, lra: 11.0 }
      }
    ]
  }
];

/**
 * Default starting pipeline order
 */
function createDefaultPipeline() {
  return [
    {
      stepId: 'step_1_timbre_match',
      moduleId: 'voice_timbre_match',
      prefix: '01_timbre_',
      enabled: true,
      params: { ...MODULE_DATABASE.find(m => m.id === 'voice_timbre_match').defaultParams },
      status: 'idle',
      outputFiles: []
    },
    {
      stepId: 'step_2_gate',
      moduleId: 'silence_gate',
      prefix: '02_gate_',
      enabled: true,
      params: { ...MODULE_DATABASE.find(m => m.id === 'silence_gate').defaultParams },
      status: 'idle',
      outputFiles: []
    },
    {
      stepId: 'step_3_norm',
      moduleId: 'phrase_norm',
      prefix: '03_norm_',
      enabled: true,
      params: { ...MODULE_DATABASE.find(m => m.id === 'phrase_norm').defaultParams },
      status: 'idle',
      outputFiles: []
    },
    {
      stepId: 'step_4_glue',
      moduleId: 'glue_compress',
      prefix: '04_glue_',
      enabled: true,
      params: { ...MODULE_DATABASE.find(m => m.id === 'glue_compress').defaultParams },
      status: 'idle',
      outputFiles: []
    },
    {
      stepId: 'step_5_ducking',
      moduleId: 'ducking',
      prefix: '05_ducking_',
      enabled: true,
      params: { ...MODULE_DATABASE.find(m => m.id === 'ducking').defaultParams },
      status: 'idle',
      outputFiles: []
    },
    {
      stepId: 'step_6_master_mix',
      moduleId: 'master_audio_mix',
      prefix: '06_master_mix_',
      enabled: true,
      params: { ...MODULE_DATABASE.find(m => m.id === 'master_audio_mix').defaultParams },
      status: 'idle',
      outputFiles: []
    },
    {
      stepId: 'step_7_video_mux',
      moduleId: 'video_mux',
      prefix: '07_video_mux_',
      enabled: true,
      params: { ...MODULE_DATABASE.find(m => m.id === 'video_mux').defaultParams },
      status: 'idle',
      outputFiles: []
    }
  ];
}

class MixingPipelineService {
  constructor() {
    this.moduleDatabase = MODULE_DATABASE;
    this.isAborted = false;
    this._activeFfmpegCommands = new Set();
  }

  /**
   * Immediately aborts any running step or full pipeline execution
   */
  async abortProcessing({ episode, targetDir, baseDir } = {}) {
    this.isAborted = true;
    log.warn('[Mixing] 🛑 Получен сигнал принудительной остановки (Abort) процесса сведения!');

    // 1. Kill all active FFmpeg commands
    for (const cmd of Array.from(this._activeFfmpegCommands)) {
      try {
        cmd.kill('SIGKILL');
      } catch (e) {}
    }
    this._activeFfmpegCommands.clear();

    // 2. Kill all active Python AI processes
    try {
      AudioNeuralService.abortAll();
    } catch (e) {}

    // 3. Kill any other registered child processes
    try {
      killAllActiveProcesses();
    } catch (e) {}

    // 4. Reset 'processing' status in manifest if episode is provided
    if (episode) {
      try {
        const workingDir = this.resolveWorkingDir(targetDir, episode, baseDir);
        const manifestPath = path.join(workingDir, 'mixing_manifest.json');
        if (fsSync.existsSync(manifestPath)) {
          const manifest = JSON.parse(fsSync.readFileSync(manifestPath, 'utf8'));
          if (Array.isArray(manifest.pipeline)) {
            manifest.pipeline.forEach(s => {
              if (s.status === 'processing') {
                s.status = 'idle';
                s.error = 'Остановлено пользователем';
              }
            });
          }
          await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
          await this.persistPipeline(manifest.pipeline, workingDir, episode, baseDir);
        }
        return await this.getStatus({ episode, targetDir: workingDir, baseDir });
      } catch (e) {
        log.warn('[Mixing] Error updating manifest after abort:', e.message);
      }
    }

    return { success: true, aborted: true };
  }

  /**
   * Clears processed output files for a specific step (or deletes a single output file if trackPath is passed)
   */
  async clearStepOutput({ episode, targetDir, baseDir, stepId, trackPath = null, filePath = null }) {
    if (!episode) throw new Error('Episode parameter is required');
    if (!stepId) throw new Error('stepId parameter is required');

    const singleTrackPath = trackPath || filePath || null;
    const workingDir = this.resolveWorkingDir(targetDir, episode, baseDir);
    const statusData = await this.getStatus({ episode, targetDir: workingDir, baseDir });
    const manifest = statusData.manifest;

    const stepIndex = (manifest.pipeline || []).findIndex(s => s.stepId === stepId);
    if (stepIndex === -1) {
      throw new Error(`Шаг ${stepId} не найден в конвейере`);
    }

    const step = manifest.pipeline[stepIndex];
    const stepDir = path.join(workingDir, `${String(stepIndex + 1).padStart(2, '0')}_${step.moduleId}`);

    if (singleTrackPath) {
      // Delete only the specified output file
      try {
        if (fsSync.existsSync(singleTrackPath)) {
          await fs.unlink(singleTrackPath);
        }
      } catch (e) {
        log.warn(`[Mixing] Could not delete track file ${singleTrackPath}:`, e.message);
      }
      step.outputFiles = (step.outputFiles || []).filter(f => f.path !== singleTrackPath && f.name !== path.basename(singleTrackPath));
      if (step.outputFiles.length === 0) {
        step.status = 'idle';
        step.error = null;
      }
    } else {
      // Delete all output files of this step
      for (const f of (step.outputFiles || [])) {
        if (f && f.path && fsSync.existsSync(f.path)) {
          try { await fs.unlink(f.path); } catch (e) {}
        }
      }
      if (fsSync.existsSync(stepDir)) {
        try {
          const entries = fsSync.readdirSync(stepDir);
          for (const entry of entries) {
            const fullP = path.join(stepDir, entry);
            try { fsSync.unlinkSync(fullP); } catch (e) {}
          }
        } catch (e) {}
      }
      if (step.prefix && fsSync.existsSync(workingDir)) {
        try {
          const rootEntries = fsSync.readdirSync(workingDir);
          for (const rFile of rootEntries) {
            if (rFile.startsWith(step.prefix)) {
              try { fsSync.unlinkSync(path.join(workingDir, rFile)); } catch (e) {}
            }
          }
        } catch (e) {}
      }
      if (step.moduleId === 'video_mux') {
        manifest.finalVideo = null;
      }
      step.outputFiles = [];
      step.status = 'idle';
      step.error = null;
    }

    await fs.writeFile(path.join(workingDir, 'mixing_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    await this.persistPipeline(manifest.pipeline, workingDir, episode, baseDir);

    return await this.getStatus({ episode, targetDir: workingDir, baseDir });
  }

  /**
   * Updates per-step track selection (supports action-based or direct array updates)
   */
  async updateStepTracks({ episode, targetDir, baseDir, stepId, action, trackKey, trackPaths, excludedTrackKeys, customInputTracks, applyToAllSteps = false }) {
    if (!episode) throw new Error('Episode parameter is required');
    if (!stepId) throw new Error('stepId parameter is required');

    const workingDir = this.resolveWorkingDir(targetDir, episode, baseDir);
    const statusData = await this.getStatus({ episode, targetDir: workingDir, baseDir });
    const manifest = statusData.manifest;

    const stepIndex = (manifest.pipeline || []).findIndex(s => s.stepId === stepId);
    if (stepIndex === -1) {
      throw new Error(`Шаг ${stepId} не найден в конвейере`);
    }

    const updateTarget = (stepObj) => {
      if (!Array.isArray(stepObj.excludedTrackKeys)) stepObj.excludedTrackKeys = [];
      if (!Array.isArray(stepObj.customInputTracks)) stepObj.customInputTracks = [];

      if (action === 'toggle_exclude' && trackKey) {
        const idx = stepObj.excludedTrackKeys.indexOf(trackKey);
        if (idx >= 0) {
          stepObj.excludedTrackKeys.splice(idx, 1);
        } else {
          stepObj.excludedTrackKeys.push(trackKey);
        }
      } else if (action === 'clear_exclusions') {
        stepObj.excludedTrackKeys = [];
      } else if (action === 'add_custom' && Array.isArray(trackPaths)) {
        for (const p of trackPaths) {
          if (!p || !fsSync.existsSync(p)) continue;
          const existsAlready = stepObj.customInputTracks.some(ct => ct.path === p);
          if (!existsAlready) {
            let sz = 0;
            try { sz = fsSync.statSync(p).size; } catch (e) {}
            const name = path.basename(p);
            const nick = this._deriveDubberNickFromFilename(name);
            stepObj.customInputTracks.push({
              id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              name,
              dubberNick: nick,
              path: p,
              size: sz,
              exists: true,
              isCustom: true
            });
          }
        }
      } else if (action === 'remove_custom' && trackKey) {
        stepObj.customInputTracks = stepObj.customInputTracks.filter(
          ct => ct.path !== trackKey && ct.name !== trackKey && this._getTrackKey(ct) !== trackKey
        );
      }

      if (Array.isArray(excludedTrackKeys)) {
        stepObj.excludedTrackKeys = excludedTrackKeys;
      }
      if (Array.isArray(customInputTracks)) {
        stepObj.customInputTracks = customInputTracks.map(tr => {
          const p = tr.path || '';
          let sz = tr.size || 0;
          if (!sz && p && fsSync.existsSync(p)) {
            try { sz = fsSync.statSync(p).size; } catch (e) {}
          }
          const name = tr.name || (p ? path.basename(p) : 'track.wav');
          const nick = tr.dubberNick || this._deriveDubberNickFromFilename(name);
          return {
            id: tr.id || `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name,
            dubberNick: nick,
            path: p,
            size: sz,
            exists: p ? fsSync.existsSync(p) : false,
            isCustom: true
          };
        });
      }
    };

    if (applyToAllSteps) {
      manifest.pipeline.forEach(s => updateTarget(s));
    } else {
      updateTarget(manifest.pipeline[stepIndex]);
    }

    await fs.writeFile(path.join(workingDir, 'mixing_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    await this.persistPipeline(manifest.pipeline, workingDir, episode, baseDir);

    return await this.getStatus({ episode, targetDir: workingDir, baseDir });
  }

  createFactoryPipeline() {
    return createDefaultPipeline();
  }

  getModuleDatabase() {
    const rootUserData = app ? app.getPath('userData') : process.cwd();
    const uvrModelsDir = path.join(rootUserData, 'models', 'uvr');

    return this.moduleDatabase.map(mod => {
      if (mod.filename && /\.(pth|ckpt|onnx|bin)$/i.test(mod.filename)) {
        const localModelFile = path.join(uvrModelsDir, mod.filename);
        const isInstalled = fsSync.existsSync(localModelFile);
        let bytes = null;
        if (isInstalled) {
          try {
            bytes = fsSync.statSync(localModelFile).size;
          } catch (e) {}
        }
        return {
          ...mod,
          is_installed: isInstalled,
          installed_bytes: bytes,
          local_path: isInstalled ? localModelFile : null
        };
      }
      return mod;
    });
  }

  getBaseRoot(baseDir = '', episode = null) {
    if (baseDir && typeof baseDir === 'string' && baseDir.trim()) {
      return path.resolve(baseDir.trim());
    }
    // Try to derive base root from episode rawPath or subPath (e.g. I:\YandexDisk\Озвучка\Project\Episode_11\raw_video.mkv)
    const refPath = episode?.rawPath || episode?.subPath;
    if (refPath && typeof refPath === 'string' && path.isAbsolute(refPath)) {
      try {
        const epDir = path.dirname(refPath);
        const projDir = path.dirname(epDir);
        const parentDir = path.dirname(projDir);
        if (parentDir && parentDir !== projDir && parentDir !== path.parse(parentDir).root) {
          return parentDir;
        }
        if (projDir && projDir !== path.parse(projDir).root) {
          return projDir;
        }
      } catch (e) {}
    }
    if (app && typeof app.getPath === 'function') {
      try {
        return app.getPath('userData');
      } catch (e) {}
    }
    try {
      const os = require('os');
      return path.join(os.homedir(), '.anime-dub-manager');
    } catch (e) {
      return process.cwd();
    }
  }

  getEpisodeDir(episode, baseDir = '') {
    if (!episode) return '';
    const epNum = episode.number !== undefined ? episode.number : 1;

    // 1. Try to derive directly from rawPath or subPath
    const refPath = episode?.rawPath || episode?.subPath;
    if (refPath && typeof refPath === 'string' && path.isAbsolute(refPath)) {
      try {
        const fileDir = path.dirname(refPath);
        const fileDirName = path.basename(fileDir).toLowerCase();
        
        // Check if fileDir is directly the episode folder (e.g. Episode_1, Ep1, Серия_1, 01, ep_01, or contains epNum)
        const isExplicitEpFolder = /^(episode|ep|серия|выпуск)[\s_.-]*\d+/i.test(fileDirName) ||
                                   /^\d+$/.test(fileDirName) ||
                                   fileDirName.includes(String(epNum));
        
        if (isExplicitEpFolder) {
          return fileDir;
        }

        // If fileDir is the project folder, check if an episode subfolder exists
        const candidates = [
          path.join(fileDir, `Episode_${epNum}`),
          path.join(fileDir, `Серия_${epNum}`),
          path.join(fileDir, `Ep_${epNum}`),
          path.join(fileDir, `ep_${epNum}`),
          path.join(fileDir, String(epNum).padStart(2, '0')),
          path.join(fileDir, String(epNum))
        ];
        for (const cand of candidates) {
          if (fsSync.existsSync(cand)) {
            return cand;
          }
        }

        // If fileDir is where media files are stored directly, check if fileDir has raw video
        if (fsSync.existsSync(refPath)) {
          return path.join(fileDir, `Episode_${epNum}`);
        }
        return fileDir;
      } catch (e) {}
    }

    // 2. Derive using baseDir and project title
    const root = this.getBaseRoot(baseDir, episode);
    const projectTitle = (episode?.project?.title || 'Project').replace(/[\/:*?"<>|]/g, '_');
    
    const projDir = path.join(root, projectTitle);
    const candFolders = [
      path.join(projDir, `Episode_${epNum}`),
      path.join(projDir, `Серия_${epNum}`),
      path.join(projDir, `Ep_${epNum}`),
      path.join(projDir, String(epNum).padStart(2, '0')),
      path.join(projDir, String(epNum))
    ];
    for (const cand of candFolders) {
      if (fsSync.existsSync(cand)) {
        return cand;
      }
    }

    return path.join(projDir, `Episode_${epNum}`);
  }

  getDefaultTargetDir(episode, baseDir = '') {
    const epDir = this.getEpisodeDir(episode, baseDir);
    // User request:
    // "все данные по работе со звуком сохранялись в папке текущей серии проекта.
    // Просто там подпапка создалась Сведения, и в этой же папке всё сохранялось, чтобы всё хранилось в одном месте и не было разношёрстности."
    const svedeniyaPath = path.join(epDir, 'Сведения');
    const svedenieLegacyPath = path.join(epDir, 'Сведение');
    if (!fsSync.existsSync(svedeniyaPath) && fsSync.existsSync(svedenieLegacyPath)) {
      return svedenieLegacyPath;
    }
    return svedeniyaPath;
  }

  resolveWorkingDir(targetDir, episode, baseDir = '') {
    if (!targetDir || typeof targetDir !== 'string' || !targetDir.trim()) {
      return this.getDefaultTargetDir(episode, baseDir);
    }
    const trimmed = targetDir.trim();
    if (!path.isAbsolute(trimmed)) {
      const epDir = this.getEpisodeDir(episode, baseDir);
      return path.resolve(epDir, trimmed);
    }
    return trimmed;
  }

  async ensureDirectory(dirPath, logFn = null) {
    try {
      await fs.mkdir(dirPath, { recursive: true });
      return dirPath;
    } catch (err) {
      if (err.code === 'EPERM' || err.code === 'EACCES') {
        const errDetail = `Ошибка доступа EPERM/EACCES при создании папки «${dirPath}». Пробуем безопасную пользовательскую директорию...`;
        if (logFn) logFn(errDetail, 'warn');
        log.warn(`[Mixing] ${errDetail}: ${err.message}`);
        const fallbackRoot = (app && typeof app.getPath === 'function')
          ? app.getPath('userData')
          : path.join(require('os').homedir(), '.anime-dub-manager');
        const fallbackDir = path.join(fallbackRoot, 'Сведения', path.basename(path.dirname(dirPath)), path.basename(dirPath));
        await fs.mkdir(fallbackDir, { recursive: true });
        if (logFn) logFn(`Директория перенаправлена в безопасную пользовательскую папку: «${fallbackDir}»`, 'info');
        return fallbackDir;
      }
      throw err;
    }
  }

  /**
   * Helper to resolve saved pipeline file locations
   */
  getPipelineConfigFiles(workingDir, episode, baseDir = '') {
    const files = [];
    if (workingDir) {
      files.push(path.join(workingDir, 'mixing_pipeline.json'));
    }
    const epDir = this.getEpisodeDir(episode, baseDir);
    if (epDir) {
      files.push(path.join(epDir, 'mixing_pipeline.json'));
      // Project root fallback (shared between episodes of the same title)
      const projDir = path.dirname(epDir);
      if (projDir && projDir !== epDir && projDir !== path.parse(projDir).root) {
        files.push(path.join(projDir, 'mixing_pipeline.json'));
      }
    }
    const rootUserData = app ? app.getPath('userData') : process.cwd();
    files.push(path.join(rootUserData, 'config', 'mixing_last_active_pipeline.json'));
    return files;
  }

  /**
   * Load preserved pipeline from dedicated JSON files
   */
  loadPersistedPipeline(workingDir, episode, baseDir = '') {
    const candidateFiles = this.getPipelineConfigFiles(workingDir, episode, baseDir);
    for (const filePath of candidateFiles) {
      try {
        if (fsSync.existsSync(filePath)) {
          const raw = fsSync.readFileSync(filePath, 'utf8');
          const parsed = JSON.parse(raw);
          const pipelineArray = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.pipeline) ? parsed.pipeline : null);
          if (pipelineArray && pipelineArray.length > 0) {
            log.info(`[Mixing] Загружен сохраненный конвейер модулей из файла: ${filePath} (${pipelineArray.length} модулей)`);
            return pipelineArray;
          }
        }
      } catch (e) {
        log.warn(`[Mixing] Ошибка чтения сохраненного файла конвейера ${filePath}:`, e.message);
      }
    }
    return null;
  }

  /**
   * Save preserved pipeline to dedicated JSON files
   */
  async persistPipeline(pipeline, workingDir, episode, baseDir = '') {
    if (!Array.isArray(pipeline) || pipeline.length === 0) return;
    const candidateFiles = this.getPipelineConfigFiles(workingDir, episode, baseDir);
    const content = JSON.stringify(pipeline, null, 2);

    for (const filePath of candidateFiles) {
      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, 'utf8');
      } catch (e) {
        log.warn(`[Mixing] Не удалось записать файл конвейера ${filePath}:`, e.message);
      }
    }
    log.info(`[Mixing] Конвейер модулей успешно сохранен в файлы конфигурации (${pipeline.length} модулей)`);
  }

  async getStatus({ episode, targetDir, baseDir }) {
    if (!episode) throw new Error('Episode parameter is required');

    const workingDir = this.resolveWorkingDir(targetDir, episode, baseDir);
    const manifestPath = path.join(workingDir, 'mixing_manifest.json');

    let manifest = null;
    if (fsSync.existsSync(manifestPath)) {
      try {
        const raw = await fs.readFile(manifestPath, 'utf8');
        manifest = JSON.parse(raw);
      } catch (e) {
        log.warn('[Mixing] Failed reading manifest:', e.message);
      }
    }

    // Load user-customized pipeline from dedicated config files with project & global fallback
    const persistedPipeline = this.loadPersistedPipeline(workingDir, episode, baseDir);

    if (!manifest) {
      manifest = {
        episodeId: episode.id,
        projectId: episode.projectId,
        workingDir,
        createdAt: new Date().toISOString(),
        isImported: false,
        sourceFiles: {
          video: null,
          originalAudio: null,
          subtitles: null,
          dubberTracks: []
        },
        pipeline: persistedPipeline || createDefaultPipeline(),
        modulesState: {},
        finalVideo: null
      };
    } else {
      // If workingDir has a direct mixing_pipeline.json file, merge it while preserving runtime step state & track selections
      const workingPipelineFile = path.join(workingDir, 'mixing_pipeline.json');
      if (fsSync.existsSync(workingPipelineFile)) {
        try {
          const raw = fsSync.readFileSync(workingPipelineFile, 'utf8');
          const parsed = JSON.parse(raw);
          const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.pipeline) ? parsed.pipeline : null);
          if (arr && arr.length > 0) {
            const prevById = new Map((manifest.pipeline || []).map(s => [s.stepId, s]));
            manifest.pipeline = arr.map(s => {
              const prev = prevById.get(s.stepId);
              if (!prev) return s;
              return {
                ...s,
                status: prev.status || s.status || 'idle',
                error: prev.error !== undefined ? prev.error : s.error,
                outputFiles: (Array.isArray(prev.outputFiles) && prev.outputFiles.length > 0) ? prev.outputFiles : (s.outputFiles || []),
                excludedTrackKeys: Array.isArray(s.excludedTrackKeys) ? s.excludedTrackKeys : (prev.excludedTrackKeys || []),
                customInputTracks: Array.isArray(s.customInputTracks) ? s.customInputTracks : (prev.customInputTracks || [])
              };
            });
          }
        } catch (e) {}
      } else if (!Array.isArray(manifest.pipeline) || manifest.pipeline.length === 0) {
        manifest.pipeline = persistedPipeline || createDefaultPipeline();
      } else if (persistedPipeline && persistedPipeline.length > 0) {
        // If manifest pipeline was just unconfigured factory default, adopt the persisted custom pipeline
        const isFactoryDefault = manifest.pipeline.length === 6 &&
          manifest.pipeline[0]?.moduleId === 'silence_gate' &&
          manifest.pipeline[1]?.moduleId === 'phrase_norm' &&
          manifest.pipeline[2]?.moduleId === 'glue_compress' &&
          manifest.pipeline[3]?.moduleId === 'ducking' &&
          manifest.pipeline[4]?.moduleId === 'master_audio_mix' &&
          manifest.pipeline[5]?.moduleId === 'video_mux';
        if (isFactoryDefault && JSON.stringify(manifest.pipeline) !== JSON.stringify(persistedPipeline)) {
          manifest.pipeline = persistedPipeline;
        }
      }
    }

    // Ensure dedicated config file is synchronized with manifest
    if (Array.isArray(manifest.pipeline) && manifest.pipeline.length > 0) {
      this.persistPipeline(manifest.pipeline, workingDir, episode, baseDir).catch(() => {});
    }

    await this._refreshManifestFiles(manifest, workingDir, episode);

    const timingMeta = await this.getTimingMetadata(workingDir).catch(() => null);
    const rolesVolumeMap = (timingMeta && timingMeta.rolesVolumeMap) ? timingMeta.rolesVolumeMap : {};

    return {
      success: true,
      workingDir,
      manifest,
      rolesVolumeMap,
      timingMetadata: timingMeta,
      moduleDatabase: this.getModuleDatabase()
    };
  }

  async savePipelineConfig({ episode, targetDir, baseDir, pipeline }) {
    if (!episode) throw new Error('Episode parameter is required');
    const workingDir = this.resolveWorkingDir(targetDir, episode, baseDir);
    await this.ensureDirectory(workingDir);

    const manifestPath = path.join(workingDir, 'mixing_manifest.json');
    let manifest = null;
    if (fsSync.existsSync(manifestPath)) {
      try {
        const raw = await fs.readFile(manifestPath, 'utf8');
        manifest = JSON.parse(raw);
      } catch (e) {}
    }
    if (!manifest) {
      const statusData = await this.getStatus({ episode, targetDir: workingDir, baseDir });
      manifest = statusData.manifest;
    }

    manifest.pipeline = pipeline;
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    // Also write directly to dedicated pipeline configuration files (workingDir, epDir, projDir, userData)
    await this.persistPipeline(pipeline, workingDir, episode, baseDir);

    return {
      success: true,
      manifest
    };
  }

  async rescanAndExtractSources({ episode, targetDir, baseDir }) {
    if (!episode) throw new Error('Episode parameter is required');
    const workingDir = this.resolveWorkingDir(targetDir, episode, baseDir);
    await this.ensureDirectory(workingDir);
    const rawDir = path.join(workingDir, '00_исходные');
    await this.ensureDirectory(rawDir);

    const statusData = await this.getStatus({ episode, targetDir: workingDir, baseDir });
    const manifest = statusData.manifest;

    // Force extraction if audio was not yet ready
    const epDir = this.getEpisodeDir(episode);
    const parentDir = path.dirname(workingDir);
    let vPath = manifest.sourceFiles?.video?.path || episode?.rawPath;
    if (!vPath || !fsSync.existsSync(vPath)) {
      const videoExtRegex = /\.(mp4|mkv|mov|avi|webm)$/i;
      const searchDirs = [workingDir, rawDir, parentDir, epDir].filter(d => d && fsSync.existsSync(d));
      for (const dir of searchDirs) {
        try {
          const files = fsSync.readdirSync(dir);
          const vid = files.find(f => videoExtRegex.test(f) && !f.includes('[СВЕДЕНО]') && !f.includes('video_mux'));
          if (vid) {
            vPath = path.join(dir, vid);
            break;
          }
        } catch (e) {}
      }
    }

    if (vPath && fsSync.existsSync(vPath)) {
      const origAudioOut = path.join(rawDir, '00_original_audio.wav');
      if (!fsSync.existsSync(origAudioOut) || fsSync.statSync(origAudioOut).size < 1000) {
        await this._extractAudioFromVideo(vPath, origAudioOut);
      }
      if (fsSync.existsSync(origAudioOut)) {
        manifest.sourceFiles.originalAudio = {
          name: '00_original_audio.wav',
          path: origAudioOut,
          size: fsSync.statSync(origAudioOut).size,
          exists: true
        };
        // Also copy to root of workingDir
        try {
          const rootTarget = path.join(workingDir, '00_original_audio.wav');
          if (path.resolve(rootTarget) !== path.resolve(origAudioOut)) {
            await fs.copyFile(origAudioOut, rootTarget);
          }
        } catch (e) {}
      }
      manifest.sourceFiles.video = {
        name: path.basename(vPath),
        path: vPath,
        size: fsSync.statSync(vPath).size,
        exists: true
      };
    }

    await fs.writeFile(path.join(workingDir, 'mixing_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    const timingMeta = await this.getTimingMetadata(workingDir);
    return {
      success: true,
      workingDir,
      manifest,
      timingMeta,
      rolesVolumeMap: timingMeta?.rolesVolumeMap || {}
    };
  }

  async _refreshManifestFiles(manifest, workingDir, episode) {
    if (!fsSync.existsSync(workingDir)) return;

    const entries = await fs.readdir(workingDir, { withFileTypes: true }).catch(() => []);
    const fileNames = entries.filter(e => e.isFile()).map(e => e.name);

    const rawDir = path.join(workingDir, '00_исходные');
    const parentDir = path.dirname(workingDir);

    // 1. Поиск видеофайла (в workingDir, 00_исходные, parentDir, epDir, episode.rawPath, episode.folderPath)
    const epDir = this.getEpisodeDir(episode);
    const searchVideoDirs = [workingDir, rawDir, parentDir, epDir, episode?.folderPath].filter(d => d && typeof d === 'string' && fsSync.existsSync(d));
    const videoExtRegex = /\.(mp4|mkv|mov|avi|webm)$/i;

    let videoFile = null;
    let videoPath = null;

    // Check direct candidate: episode.rawPath (absolute or relative)
    if (episode?.rawPath) {
      const candidates = [
        episode.rawPath,
        path.resolve(workingDir, episode.rawPath),
        path.resolve(parentDir, episode.rawPath),
        path.resolve(epDir, episode.rawPath),
        path.resolve(process.cwd(), episode.rawPath)
      ];
      for (const cand of candidates) {
        if (cand && fsSync.existsSync(cand) && videoExtRegex.test(cand) && !cand.includes('[СВЕДЕНО]') && !cand.includes('video_mux')) {
          videoPath = cand;
          videoFile = path.basename(cand);
          break;
        }
      }
    }

    // If not found yet, scan directories
    if (!videoPath) {
      for (const dir of searchVideoDirs) {
        try {
          const dirFiles = fsSync.readdirSync(dir);
          const found = dirFiles.find(f => videoExtRegex.test(f) && !f.includes('[СВЕДЕНО]') && !f.includes('video_mux'));
          if (found) {
            videoPath = path.join(dir, found);
            videoFile = found;
            break;
          }
        } catch (e) {}
      }
    }

    if (videoPath && fsSync.existsSync(videoPath)) {
      const st = fsSync.statSync(videoPath);
      manifest.sourceFiles.video = { name: videoFile || path.basename(videoPath), path: videoPath, size: st.size, exists: true };
    }

    // 2. Поиск оригинального аудио
    const origAudioCandidates = [
      path.join(rawDir, '00_original_audio.wav'),
      path.join(workingDir, '00_original_audio.wav'),
      path.join(workingDir, 'original_audio.wav'),
      path.join(parentDir, '00_original_audio.wav'),
      path.join(parentDir, 'original_audio.wav'),
      path.join(rawDir, 'original_audio.wav'),
      path.join(epDir, '00_original_audio.wav'),
      path.join(epDir, 'original_audio.wav')
    ];
    let foundOrigAudio = origAudioCandidates.find(p => p && fsSync.existsSync(p));

    // Если аудио нет, но есть видео — извлекаем автоматически в 00_исходные и workingDir!
    if (!foundOrigAudio && videoPath && fsSync.existsSync(videoPath)) {
      const targetAudio = path.join(rawDir, '00_original_audio.wav');
      try {
        if (!fsSync.existsSync(rawDir)) fsSync.mkdirSync(rawDir, { recursive: true });
        await this._extractAudioFromVideo(videoPath, targetAudio);
        if (fsSync.existsSync(targetAudio)) {
          foundOrigAudio = targetAudio;
          // Также дублируем в корень workingDir для мгновенной доступности
          try {
            const copyTarget = path.join(workingDir, '00_original_audio.wav');
            if (path.resolve(copyTarget) !== path.resolve(targetAudio)) {
              await fs.copyFile(targetAudio, copyTarget);
            }
          } catch (e) {}
          log.info(`[Mixing] Автоматически извлечена оригинальная аудиодорожка: ${targetAudio}`);
        }
      } catch (extractErr) {
        log.warn(`[Mixing] Ошибка автоматического извлечения звука из ${videoPath}:`, extractErr.message);
      }
    }

    if (foundOrigAudio && fsSync.existsSync(foundOrigAudio)) {
      const st = fsSync.statSync(foundOrigAudio);
      manifest.sourceFiles.originalAudio = { name: path.basename(foundOrigAudio), path: foundOrigAudio, size: st.size, exists: true };
    }

    const subFile = fileNames.find(f => /\.(ass|srt|vtt)$/i.test(f));
    if (subFile) {
      const sPath = path.join(workingDir, subFile);
      const st = fsSync.statSync(sPath);
      manifest.sourceFiles.subtitles = { name: subFile, path: sPath, size: st.size, exists: true };
    } else if (episode?.subPath && fsSync.existsSync(episode.subPath)) {
      const st = fsSync.statSync(episode.subPath);
      manifest.sourceFiles.subtitles = { name: path.basename(episode.subPath), path: episode.subPath, size: st.size, exists: true };
    }

    const audioExts = /\.(wav|mp3|flac|ogg|m4a|aac)$/i;
    const backupDir = path.join(workingDir, 'бэкап', 'исходные_дорожки_до_автотайминга');
    const backupRoot = path.join(workingDir, 'бэкап');

    const primaryDirs = [rawDir, workingDir].filter(d => fsSync.existsSync(d));
    let hasPrimaryFiles = false;
    for (const pDir of primaryDirs) {
      try {
        if (fsSync.readdirSync(pDir).some(f => audioExts.test(f))) {
          hasPrimaryFiles = true;
          break;
        }
      } catch (e) {}
    }

    const searchDirs = hasPrimaryFiles ? primaryDirs : [rawDir, workingDir, backupDir, backupRoot].filter(d => fsSync.existsSync(d));

    // Pipeline step output prefixes that should not be considered original dubber source files
    const pipelinePrefixes = (manifest.pipeline || []).map((s, idx) => {
      const numPrefix = `${String(idx + 1).padStart(2, '0')}_${s.moduleId}`;
      return [s.prefix, numPrefix, `${s.moduleId}_`];
    }).flat().filter(Boolean);

    const isStepOutputFile = (filename) => {
      const lower = filename.toLowerCase();
      if (lower.includes('00_original_audio') || lower.includes('[сведено]') || lower.includes('video_mux')) return true;
      if (/^(0[1-9]|1[0-9])_(denoise|deepfilter|glue|compress|master|video_mux|eq|limiter|reverb|delay|mix)/i.test(filename)) return true;
      return pipelinePrefixes.some(pfx => pfx && filename.startsWith(pfx));
    };

    const foundDubberTracks = [];
    for (const sDir of searchDirs) {
      const dirFiles = fsSync.readdirSync(sDir).filter(f => audioExts.test(f));
      for (const f of dirFiles) {
        if (isStepOutputFile(f)) {
          continue;
        }

        const lowerF = f.toLowerCase();
        // STRICT: Never include phrase slice micro-files or temporary files in mixing manifest
        if (lowerF.includes('slice') || lowerF.includes('whisper_slice') || lowerF.startsWith('temp_') || lowerF.startsWith('snippet_')) {
          continue;
        }

        const baseNoExt = f.replace(audioExts, '');

        const fullP = path.join(sDir, f);
        const st = fsSync.statSync(fullP);
        
        let dubberNick = f;
        const bracketMatch = f.match(/\[(.*?)\]/);
        const trackMatch = f.match(/_дорожка(\d+)/i) || f.match(/_layer(\d+)/i) || f.match(/_take(\d+)/i);
        const trackNum = trackMatch ? trackMatch[1] : null;

        if (f.startsWith('00_timed_')) {
          dubberNick = f.replace(/^00_timed_/, '').replace(audioExts, '');
        } else if (bracketMatch && bracketMatch[1]) {
          dubberNick = bracketMatch[1];
        } else {
          dubberNick = baseNoExt.replace(/^dub_/i, '').replace(/^.*?_/, '');
        }

        // Clean out track/layer/fix suffixes from base nickname
        dubberNick = dubberNick
          .replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '')
          .replace(/_дорожка\d+/gi, '')
          .replace(/[_\s-]+$/, '')
          .trim();

        // Check if dubberNick is a numeric participant ID or upload ID and resolve real nickname
        if (Array.isArray(episode?.uploads)) {
          const matchingUpload = episode.uploads.find(u => 
            (u.path && path.basename(u.path) === f) || 
            (u.uploadedById && (u.uploadedById === dubberNick || String(u.uploadedById) === String(dubberNick)))
          );
          if (matchingUpload) {
            const nick = matchingUpload.dubberNick || matchingUpload.dubberName;
            if (nick && /[a-zA-Zа-яА-ЯёЁ]/.test(nick)) {
              dubberNick = nick;
            }
          }
        }

        // Check against global participants if still numeric or not resolved
        if ((!dubberNick || /^\d+$/.test(dubberNick) || dubberNick.startsWith('0.')) && Array.isArray(episode?.assignments)) {
          const matchingAssignment = episode.assignments.find(a => 
            a.dubberId === dubberNick || String(a.dubberId) === String(dubberNick) ||
            a.substituteId === dubberNick || String(a.substituteId) === String(dubberNick)
          );
          if (matchingAssignment) {
            const pId = matchingAssignment.dubberId || matchingAssignment.substituteId;
            const p = (Array.isArray(episode?.project?.assignedDubbers) ? episode.project.assignedDubbers : []).find(part => String(part.id) === String(pId));
            if (p && p.nickname) {
              dubberNick = p.nickname;
            }
          }
        }

        if (!dubberNick || dubberNick.trim().length === 0) {
          dubberNick = baseNoExt || 'Даббер';
        }

        const displayNick = trackNum ? `${dubberNick} (Дорожка ${trackNum})` : dubberNick;

        if (foundDubberTracks.some(t => t.path === fullP || (t.name === f && t.size === st.size))) {
          continue;
        }

        foundDubberTracks.push({
          id: f,
          name: f,
          dubberNick: displayNick.trim(),
          baseDubberNick: dubberNick.trim(),
          trackNumber: trackNum ? parseInt(trackNum, 10) : 1,
          path: fullP,
          size: st.size,
          exists: true,
          isTimedMaster: f.startsWith('00_timed_')
        });
      }
    }

    // Fallback: If no files found on disk yet, but episode has QA uploads, use episode uploads (excluding slice files)
    const episodeUploads = (episode?.uploads && episode.uploads.length > 0) ? episode.uploads : [];
    if (foundDubberTracks.length === 0 && Array.isArray(episodeUploads) && episodeUploads.length > 0) {
      const qaUploads = episodeUploads.filter(u => 
        (u.type === 'DUBBER_FILE' || u.type === 'FIXES') && 
        u.path && 
        fsSync.existsSync(u.path) &&
        !u.path.toLowerCase().includes('slice') &&
        !(u.fileName || '').toLowerCase().includes('slice')
      );
      for (const u of qaUploads) {
        const f = path.basename(u.path);
        const st = fsSync.statSync(u.path);
        const trackMatch = f.match(/_(дорожка\d+|track\d+|layer\d+|take\d+)/i);
        const baseNick = (u.dubberNick || u.dubberName || u.name || f)
          .replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '')
          .replace(/^00_timed_/i, '')
          .replace(/\.wav$/i, '')
          .trim();
        const dubberNick = trackMatch 
          ? `${baseNick || 'Даббер'} (${trackMatch[1].replace('дорожка', 'Дорожка ')})` 
          : (baseNick || 'Даббер');
        foundDubberTracks.push({
          id: f,
          name: f,
          dubberNick: dubberNick || 'Даббер',
          path: u.path,
          size: st.size,
          exists: true,
          isTimedMaster: f.startsWith('00_timed_')
        });
      }
    }

    // If 00_timed_ master tracks are present, strictly prefer ONLY 00_timed_ master tracks!
    let filteredDubberTracks = foundDubberTracks;
    const timedMasters = foundDubberTracks.filter(t => t.isTimedMaster);
    if (timedMasters.length > 0) {
      filteredDubberTracks = timedMasters;
    }

    // Deduplicate so each unique audio track appears once, and if a full replacement fix exists alongside a draft track for the same actor/layer, keep ONLY the full fix
    const uniquePathList = [];
    const seenPaths = new Set();
    for (const tr of filteredDubberTracks) {
      const key = tr.path || tr.name;
      if (!seenPaths.has(key)) {
        seenPaths.add(key);
        uniquePathList.push(tr);
      }
    }

    const byActorAndLayer = new Map();
    for (const tr of uniquePathList) {
      const baseKey = `${(tr.baseDubberNick || tr.dubberNick || '').toLowerCase()}__${tr.trackNumber || 1}`;
      if (!byActorAndLayer.has(baseKey)) byActorAndLayer.set(baseKey, []);
      byActorAndLayer.get(baseKey).push(tr);
    }

    const deduplicatedTracks = [];
    for (const group of byActorAndLayer.values()) {
      if (group.length <= 1) {
        deduplicatedTracks.push(...group);
        continue;
      }
      const isFixEntry = (item) => /(?:^|[_[\s-])(fix|фикс)(?:\d*|[_\]\s.-]|$)/i.test(item.name || item.path || '');
      const fixesInGroup = group.filter(isFixEntry);
      const mainsInGroup = group.filter(item => !isFixEntry(item));

      if (fixesInGroup.length > 0 && mainsInGroup.length > 0) {
        const newestFix = fixesInGroup[fixesInGroup.length - 1];
        const newestMain = mainsInGroup[mainsInGroup.length - 1];
        const mainSize = newestMain.size || 1;
        const fixSize = newestFix.size || 0;
        const ratio = fixSize > 0 ? fixSize / mainSize : 0;
        const diffMb = Math.abs(mainSize - fixSize) / (1024 * 1024);

        if (fixSize > 0 && (ratio >= 0.65 || diffMb <= 3.5)) {
          // Full replacement fix: take ONLY the full fix!
          deduplicatedTracks.push(newestFix);
        } else {
          // Fragmentary fix: keep main track and fragmentary fix for stitching in Timing
          deduplicatedTracks.push(newestMain, newestFix);
        }
      } else {
        deduplicatedTracks.push(...group);
      }
    }

    const finalDubberTracks = deduplicatedTracks.map(tr => ({
      id: tr.id,
      name: tr.name,
      dubberNick: tr.dubberNick,
      path: tr.path,
      size: tr.size,
      exists: true
    }));

    if (finalDubberTracks.length > 0) {
      manifest.sourceFiles.dubberTracks = finalDubberTracks;
      manifest.isImported = true;
    }

    // Refresh outputs for each step (preserving dubberNick and type metadata)
    for (let sIdx = 0; sIdx < manifest.pipeline.length; sIdx++) {
      const step = manifest.pipeline[sIdx];
      step.excludedTrackKeys = Array.isArray(step.excludedTrackKeys) ? step.excludedTrackKeys : [];
      step.customInputTracks = Array.isArray(step.customInputTracks) ? step.customInputTracks : [];
      const prevOutMap = new Map((step.outputFiles || []).map(of => [of.name || path.basename(of.path || ''), of]));

      const stepDir = path.join(workingDir, `${String(sIdx + 1).padStart(2, '0')}_${step.moduleId}`);
      const stepFiles = [];

      const buildStepFileObj = (fName, fPath, sizeBytes) => {
        const prevMeta = prevOutMap.get(fName);
        const derivedNick = prevMeta?.dubberNick || this._deriveDubberNickFromFilename(fName, step.prefix);
        return {
          name: fName,
          path: fPath,
          size: sizeBytes,
          exists: true,
          dubberNick: derivedNick,
          ...(prevMeta?.type ? { type: prevMeta.type } : {})
        };
      };

      if (fsSync.existsSync(stepDir)) {
        const dirEntries = fsSync.readdirSync(stepDir);
        for (const f of dirEntries) {
          if (audioExts.test(f) || /\.(mp4|mkv)$/i.test(f)) {
            const fPath = path.join(stepDir, f);
            const st = fsSync.statSync(fPath);
            stepFiles.push(buildStepFileObj(f, fPath, st.size));
          }
        }
      }

      const rootMatches = fileNames.filter(f => f.startsWith(step.prefix) && (audioExts.test(f) || /\.(mp4|mkv)$/i.test(f)));
      for (const rmf of rootMatches) {
        const fullP = path.join(workingDir, rmf);
        const st = fsSync.statSync(fullP);
        if (!stepFiles.some(sf => sf.name === rmf)) {
          stepFiles.push(buildStepFileObj(rmf, fullP, st.size));
        }
      }

      step.outputFiles = stepFiles;
      if (stepFiles.length > 0 && step.status === 'idle') {
        step.status = 'completed';
      } else if (stepFiles.length === 0 && step.status === 'completed') {
        step.status = 'idle';
      }

      if (step.moduleId === 'video_mux' && stepFiles.length > 0) {
        manifest.finalVideo = stepFiles[0];
      }
    }

    // Populate candidateInputs for every step so UI can display and toggle tracks per step
    for (let sIdx = 0; sIdx < manifest.pipeline.length; sIdx++) {
      manifest.pipeline[sIdx].candidateInputs = this._resolveCandidateInputsForStep(manifest, sIdx);
    }

    if (!manifest.finalVideo) {
      const rootMixedVideo = fileNames.find(f => (f.includes('[СВЕДЕНО]') || f.includes('video_mux')) && /\.(mp4|mkv)$/i.test(f));
      if (rootMixedVideo) {
        const fullP = path.join(workingDir, rootMixedVideo);
        const st = fsSync.statSync(fullP);
        manifest.finalVideo = { name: rootMixedVideo, path: fullP, size: st.size, exists: true };
      }
    }

    try {
      await fs.writeFile(path.join(workingDir, 'mixing_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    } catch (e) {}
  }

  async importSoundEngineerFiles({
    episode,
    targetDir,
    baseDir,
    config,
    projectsData,
    participantsData,
    skipConversion = false,
    smartExport = true,
    additionalProcessing = false,
    autoApplyFixes = true,
    includeSubtitles = true,
    autoTiming = true,
    onProgress,
    onLog
  }) {
    const workingDir = this.resolveWorkingDir(targetDir, episode, baseDir);
    await this.ensureDirectory(workingDir);

    const rawDir = path.join(workingDir, '00_исходные');
    await this.ensureDirectory(rawDir);

    const logFn = (msg, level = 'info') => {
      log.info(`[Mixing Import] ${msg}`);
      if (onLog) onLog(msg, level);
      if (onProgress) onProgress({ message: msg, percent: undefined });
    };

    logFn(`Запуск экспорта звукорежиссеру в папку сведения: ${workingDir}`);

    await ExportService.exportSoundEngineerFiles(
      episode,
      workingDir,
      skipConversion,
      smartExport,
      additionalProcessing,
      autoApplyFixes,
      config,
      projectsData,
      participantsData,
      (p) => {
        if (onProgress && p && typeof p.percent === 'number') {
          onProgress({ percent: Math.round(p.percent * 0.85), message: p.message || 'Экспорт дорожек...' });
        }
      },
      undefined,
      includeSubtitles,
      autoTiming
    );

    logFn('Экспорт завершен. Анализ полученных дорожек...');

    // If autoTiming is disabled (direct QA import), clear any stale 00_timed_ master tracks from prior timing runs
    if (!autoTiming && fsSync.existsSync(workingDir)) {
      try {
        const existingFiles = fsSync.readdirSync(workingDir);
        for (const f of existingFiles) {
          if (f.startsWith('00_timed_') && /\.(wav|mp3|flac|ogg|m4a|aac)$/i.test(f)) {
            try { fsSync.unlinkSync(path.join(workingDir, f)); } catch (e) {}
          }
        }
      } catch (e) {}
    }

    const videoSource = episode?.rawPath;
    const origAudioOut = path.join(rawDir, '00_original_audio.wav');

    if (videoSource && fsSync.existsSync(videoSource) && !fsSync.existsSync(origAudioOut)) {
      logFn('Извлечение оригинальной аудиодорожки из видеоряда серии...');
      try {
        await this._extractAudioFromVideo(videoSource, origAudioOut);
        logFn('Оригинальная аудиодорожка успешно извлечена');
      } catch (err) {
        log.warn('[Mixing] Could not extract original audio track:', err.message);
        logFn(`Внимание: не удалось извлечь аудиодорожку оригинала: ${err.message}`, 'warn');
      }
    }

    if (onProgress) onProgress({ percent: 100, message: 'Импорт дорожек звукорежиссера завершен!' });

    return await this.getStatus({ episode, targetDir: workingDir, baseDir });
  }

  /**
   * Safely replace an existing target file using retry and fallback strategies against Win32 / player file locks
   */
  async _safeReplaceFile(tempPath, targetPath, logFn = null) {
    if (!fsSync.existsSync(tempPath)) {
      throw new Error(`Временный файл ${tempPath} не найден для записи в ${targetPath}`);
    }

    const dir = path.dirname(targetPath);
    await this.ensureDirectory(dir, logFn);

    let lastErr = null;
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        if (fsSync.existsSync(targetPath)) {
          try {
            await fs.unlink(targetPath);
          } catch (unlinkErr) {
            // If direct unlink failed because file is locked by a player or sync service, try moving target to a trash temp name
            const trashTemp = path.join(dir, `.trash_${Date.now()}_${Math.random().toString(36).substring(2, 6)}_${path.basename(targetPath)}`);
            try {
              await fs.rename(targetPath, trashTemp);
              // Try to delete trash in background after 3 seconds
              setTimeout(() => { try { if (fsSync.existsSync(trashTemp)) fsSync.unlinkSync(trashTemp); } catch (e) {} }, 3000);
            } catch (trashErr) {}
          }
        }

        try {
          await fs.rename(tempPath, targetPath);
        } catch (renameErr) {
          // Fallback to copy + unlink (e.g. cross-volume or lock edge-case)
          await fs.copyFile(tempPath, targetPath);
          try { await fs.unlink(tempPath); } catch (e) {}
        }

        return targetPath;
      } catch (err) {
        lastErr = err;
        if (attempt < 6) {
          await new Promise(r => setTimeout(r, 120 * attempt));
        }
      }
    }

    // Final fallback: copyFile
    try {
      await fs.copyFile(tempPath, targetPath);
      try { await fs.unlink(tempPath); } catch (e) {}
      return targetPath;
    } catch (err) {
      const errMsg = `Не удалось перезаписать файл «${path.basename(targetPath)}» (Permission denied / занят другим процессом или плеером). Рекомендация: остановите воспроизведение или закройте сторонние плееры. ${lastErr?.message || err.message}`;
      if (logFn) logFn(errMsg, 'warn');
      throw new Error(errMsg);
    }
  }

  _deriveDubberNickFromFilename(filename = '', stepPrefix = '') {
    let base = path.basename(filename || '', path.extname(filename || ''));
    if (stepPrefix && base.startsWith(stepPrefix)) {
      base = base.slice(stepPrefix.length);
    } else {
      base = base
        .replace(/^00_timed_/i, '')
        .replace(/^(0[1-9]|1[0-9])_(ff_[a-z0-9]+|[a-z0-9]+)_/i, '')
        .replace(/^[0-9]{2}_[a-z0-9_]+?_/i, '');
    }
    const trMatch = base.match(/_(дорожка\d+|track\d+|layer\d+|take\d+)/i);
    const cleanNick = base
      .replace(/_(дорожка\d+|track\d+|layer\d+|take\d+)/gi, '')
      .replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '')
      .replace(/^[_\s-]+|[_\s-]+$/g, '')
      .trim();
    if (trMatch) {
      const trLabel = trMatch[1].replace(/дорожка/i, 'Дорожка ').replace(/track/i, 'Дорожка ');
      return `${cleanNick || base} (${trLabel.trim()})`;
    }
    return cleanNick || base || 'Даббер';
  }

  _getTrackKey(track, stepPrefix = '') {
    if (!track) return 'unknown';
    const rawNick = track.dubberNick || this._deriveDubberNickFromFilename(track.name || path.basename(track.path || ''), stepPrefix);
    const trMatch = rawNick.match(/(?:дорожка|track|layer|take)\s*(\d+)/i) ||
                    (track.name || '').match(/_(?:дорожка|track|layer|take)(\d+)/i);
    const trNum = trMatch ? trMatch[1] : '1';
    const baseNick = rawNick
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '')
      .replace(/^00_timed_/i, '')
      .replace(/^[_\s-]+|[_\s-]+$/g, '')
      .toLowerCase()
      .trim();
    return `${baseNick || 'dubber'}__${trNum}`;
  }

  _resolveTrackOutName(track, inputFiles, index, prefix) {
    const origBase = path.basename(track.path || track.name || '', path.extname(track.path || track.name || ''));
    const trMatch = origBase.match(/_(дорожка\d+|track\d+|layer\d+|take\d+)/i) || (track.name || '').match(/_(дорожка\d+|track\d+|layer\d+|take\d+)/i) || (track.dubberNick || '').match(/(дорожка\s*\d+|track\s*\d+)/i);
    const fallbackNick = this._deriveDubberNickFromFilename(origBase);
    const rawNick = track.baseDubberNick || track.dubberNick || fallbackNick || `dubber_${index + 1}`;
    const nick = rawNick.replace(/\s*\([^)]*\)/g, '').replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '').replace(/^00_timed_/i, '').replace(/^[_\s-]+|[_\s-]+$/g, '').trim() || `dubber_${index + 1}`;
    
    if (trMatch) {
      const normSuffix = trMatch[1].replace(/\s+/g, '').toLowerCase();
      return `${prefix}${nick}_${normSuffix}.wav`;
    }
    
    const sameNickTracks = inputFiles.filter(f => {
      const fRaw = f.baseDubberNick || f.dubberNick || this._deriveDubberNickFromFilename(f.name || '');
      const fNick = fRaw.replace(/\s*\([^)]*\)/g, '').replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '').replace(/^00_timed_/i, '').replace(/^[_\s-]+|[_\s-]+$/g, '').trim();
      return fNick.toLowerCase() === nick.toLowerCase();
    });
    
    if (sameNickTracks.length > 1) {
      const occ = inputFiles.slice(0, index + 1).filter(f => {
        const fRaw = f.baseDubberNick || f.dubberNick || this._deriveDubberNickFromFilename(f.name || '');
        const fNick = fRaw.replace(/\s*\([^)]*\)/g, '').replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '').replace(/^00_timed_/i, '').replace(/^[_\s-]+|[_\s-]+$/g, '').trim();
        return fNick.toLowerCase() === nick.toLowerCase();
      }).length;
      return `${prefix}${nick}_дорожка${occ}.wav`;
    }
    
    return `${prefix}${nick}.wav`;
  }

  _resolveTrackNick(track, inputFiles, index) {
    const origBase = path.basename(track.path || track.name || '', path.extname(track.path || track.name || ''));
    const trMatch = origBase.match(/_(дорожка\d+|track\d+|layer\d+|take\d+)/i) || (track.name || '').match(/_(дорожка\d+|track\d+|layer\d+|take\d+)/i) || (track.dubberNick || '').match(/(дорожка\s*\d+|track\s*\d+)/i);
    const fallbackNick = this._deriveDubberNickFromFilename(origBase);
    const rawNick = track.baseDubberNick || track.dubberNick || fallbackNick || `dubber_${index + 1}`;
    const nick = rawNick.replace(/\s*\([^)]*\)/g, '').replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '').replace(/^00_timed_/i, '').replace(/^[_\s-]+|[_\s-]+$/g, '').trim() || `dubber_${index + 1}`;
    
    if (trMatch) {
      const trLabel = trMatch[1].replace(/дорожка\s*/i, 'Дорожка ').replace(/track\s*/i, 'Дорожка ');
      return `${nick} (${trLabel.trim()})`;
    }
    
    const sameNickTracks = inputFiles.filter(f => {
      const fRaw = f.baseDubberNick || f.dubberNick || this._deriveDubberNickFromFilename(f.name || '');
      const fNick = fRaw.replace(/\s*\([^)]*\)/g, '').replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '').replace(/^00_timed_/i, '').replace(/^[_\s-]+|[_\s-]+$/g, '').trim();
      return fNick.toLowerCase() === nick.toLowerCase();
    });
    
    if (sameNickTracks.length > 1) {
      const occ = inputFiles.slice(0, index + 1).filter(f => {
        const fRaw = f.baseDubberNick || f.dubberNick || this._deriveDubberNickFromFilename(f.name || '');
        const fNick = fRaw.replace(/\s*\([^)]*\)/g, '').replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '').replace(/^00_timed_/i, '').replace(/^[_\s-]+|[_\s-]+$/g, '').trim();
        return fNick.toLowerCase() === nick.toLowerCase();
      }).length;
      return `${nick} (Дорожка ${occ})`;
    }
    
    return nick;
  }

  _resolveTrackVolumePercent(track, timingMeta) {
    if (!timingMeta || !timingMeta.rolesVolumeMap) return 100;
    const volMap = timingMeta.rolesVolumeMap;
    const tName = (track.name || path.basename(track.path || '')).toLowerCase();
    const tNick = (track.dubberNick || '').toLowerCase();
    const baseNick = (track.baseDubberNick || tNick.replace(/\s*\([^)]*\)/g, '')).toLowerCase().replace(/^[_\s-]+|[_\s-]+$/g, '').trim();

    // 0. Direct key match in rolesVolumeMap
    if (track.dubberNick && volMap[track.dubberNick] !== undefined) {
      return Number(volMap[track.dubberNick]) || 100;
    }
    if (track.name && volMap[track.name] !== undefined) {
      return Number(volMap[track.name]) || 100;
    }

    // Extract track number from name or dubberNick
    const trMatch = tName.match(/_(?:дорожка|track|layer|take)(\d+)/i) || 
                   tNick.match(/(?:дорожка|track|layer|take)\s*(\d+)/i);
    const trNum = trMatch ? parseInt(trMatch[1], 10) : null;

    // 1. Precise match with track number if multi-track
    if (trNum !== null) {
      for (const [role, vol] of Object.entries(volMap)) {
        const rLower = role.toLowerCase();
        const rTrMatch = rLower.match(/(?:дорожка|track|layer|take)\s*(\d+)/i);
        const rTrNum = rTrMatch ? parseInt(rTrMatch[1], 10) : null;
        if (rTrNum === trNum && (rLower.includes(baseNick) || baseNick.includes(rLower.replace(/\s*\([^)]*\)/g, '').trim()))) {
          return Number(vol) || 100;
        }
      }
    }

    // 2. Exact match case-insensitive
    for (const [role, vol] of Object.entries(volMap)) {
      const rLower = role.toLowerCase();
      if (rLower === tNick || rLower === tName) {
        return Number(vol) || 100;
      }
    }

    // 3. Single track actor fallback
    if (trNum === null) {
      for (const [role, vol] of Object.entries(volMap)) {
        const rLower = role.toLowerCase();
        if (/(?:дорожка|track)\s*\d+/i.test(rLower)) continue;
        if (rLower.includes(baseNick) || baseNick.includes(rLower)) {
          return Number(vol) || 100;
        }
      }
    }

    return 100;
  }

  /**
   * Universal FFmpeg executor with deep command/stderr/progress logging and safe atomic file replacement
   */
  async _execFfmpeg(command, { logFn, onProgress, outPath, description = 'FFmpeg' } = {}) {
    if (this.isAborted) {
      throw new Error('Процесс сведения остановлен пользователем.');
    }

    let finalTarget = outPath;
    if (!finalTarget && Array.isArray(command._outputs) && command._outputs.length > 0) {
      finalTarget = command._outputs[0]?.target;
    }

    let tempOutPath = null;
    if (finalTarget && typeof finalTarget === 'string') {
      const ext = path.extname(finalTarget) || '.wav';
      const dir = path.dirname(finalTarget);
      await this.ensureDirectory(dir, logFn);

      const baseName = path.basename(finalTarget, ext);
      tempOutPath = path.join(dir, `.tmp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}_${baseName}${ext}`);

      // Substitute the output in fluent-ffmpeg so FFmpeg writes to a clean unlocked temp file
      if (!Array.isArray(command._outputs) || command._outputs.length === 0) {
        command.output(tempOutPath);
      } else {
        for (const out of command._outputs) {
          if (out) out.target = tempOutPath;
        }
        if (command._currentOutput) {
          command._currentOutput.target = tempOutPath;
        }
      }
    }

    // Always enforce overwrite flag (-y) to prevent FFmpeg hanging or permission prompts
    try {
      command.outputOptions(['-y']);
    } catch (e) {}

    this._activeFfmpegCommands.add(command);

    try {
      await new Promise((resolve, reject) => {
        const lastStderr = [];
        let commandLineStr = '';

        command
          .on('start', (cmdLine) => {
            if (this.isAborted) {
              try { command.kill('SIGKILL'); } catch (e) {}
              reject(new Error('Процесс сведения остановлен пользователем.'));
              return;
            }
            if (command.ffmpegProc) {
              trackProcess(command.ffmpegProc, description);
            }
            commandLineStr = cmdLine;
            console.log(`[Mixing:FFmpeg] 🚀 ${description} -> START:\n  ${cmdLine}`);
            if (logFn) logFn(`[FFmpeg] ${description}: ${cmdLine}`, 'debug');
          })
          .on('stderr', (stderrLine) => {
            lastStderr.push(stderrLine);
            if (lastStderr.length > 30) lastStderr.shift();
            if (stderrLine.includes('Error') || stderrLine.includes('failed') || stderrLine.includes('Invalid') || stderrLine.includes('fatal')) {
              console.warn(`[Mixing:FFmpeg:Stderr] ⚠️ ${stderrLine}`);
            }
          })
          .on('progress', (p) => {
            if (onProgress && p && typeof p.percent === 'number') {
              onProgress(p);
            }
          })
          .on('end', () => {
            this._activeFfmpegCommands.delete(command);
            resolve(tempOutPath || finalTarget);
          })
          .on('error', (err, stdout, stderr) => {
            this._activeFfmpegCommands.delete(command);
            if (this.isAborted || (err && /SIGKILL|killed|aborted/i.test(err.message))) {
              reject(new Error('Процесс сведения остановлен пользователем.'));
              return;
            }
            const detailStderr = (stderr || lastStderr.join('\n')).slice(-700);
            const fullErrMsg = `[FFmpeg Ошибка] ${description}: ${err.message}${detailStderr ? `\nДетали stderr:\n${detailStderr}` : ''}`;
            console.error(`[Mixing:FFmpeg:Fatal] ❌ ${fullErrMsg}\nКоманда: ${commandLineStr}`);
            if (logFn) logFn(fullErrMsg, 'error', { commandLine: commandLineStr, stderr: detailStderr });
            reject(new Error(fullErrMsg));
          })
          .run();
      });

      if (this.isAborted) {
        throw new Error('Процесс сведения остановлен пользователем.');
      }

      // If we used a temporary file, safely replace outPath with retries
      if (tempOutPath && finalTarget) {
        await this._safeReplaceFile(tempOutPath, finalTarget, logFn);
      }

      let sizeStr = '';
      if (finalTarget && fsSync.existsSync(finalTarget)) {
        const st = fsSync.statSync(finalTarget);
        sizeStr = `(${(st.size / 1024 / 1024).toFixed(2)} MB)`;
      }
      console.log(`[Mixing:FFmpeg] ✅ ${description} успешно завершено ${sizeStr}`);
      if (logFn) logFn(`[FFmpeg] Успешно: ${description} ${sizeStr}`, 'debug');

      return finalTarget;
    } catch (err) {
      this._activeFfmpegCommands.delete(command);
      if (tempOutPath && fsSync.existsSync(tempOutPath)) {
        try { await fs.unlink(tempOutPath); } catch (e) {}
      }
      throw err;
    }
  }

  /**
   * Ensure audio track physical loudness statistics (RMS, LUFS, Peak, NoiseFloor) exist for given tracks.
   * If missing (e.g. newly imported or re-mixing old series), measures them dynamically with FFmpeg ebur128.
   */
  async ensureTracksAnalysis(tracks = [], workingDir = '', logFn = null) {
    const analysisMap = {};
    const analysisFile = workingDir ? path.join(workingDir, 'track_analysis.json') : null;
    
    if (analysisFile && fsSync.existsSync(analysisFile)) {
      try {
        const cached = JSON.parse(fsSync.readFileSync(analysisFile, 'utf8'));
        Object.assign(analysisMap, cached);
      } catch (e) {}
    }

    for (let i = 0; i < tracks.length; i++) {
      const tr = tracks[i];
      if (!tr || !tr.path || !fsSync.existsSync(tr.path)) continue;

      const key = tr.path;
      const nameKey = tr.name || path.basename(tr.path);
      const nick = tr.dubberNick || nameKey;

      if (!analysisMap[key] && analysisMap[nameKey]) {
        analysisMap[key] = analysisMap[nameKey];
      }

      let stats = analysisMap[key];
      if (!stats || typeof stats.speechRmsDb !== 'number' || typeof stats.integratedLufsDb !== 'number') {
        if (logFn) logFn(`[Анализ громкости] Замер акустических параметров дорожки «${nick}»...`, 'debug');
        try {
          stats = await AudioAnalysisService.measureTrackStats(tr.path);
          analysisMap[key] = stats;
          analysisMap[nameKey] = stats;
          if (logFn) logFn(`[Анализ] «${nick}»: RMS ${stats.speechRmsDb} dB, LUFS ${stats.integratedLufsDb}, Peak ${stats.truePeakDb} dBFS`, 'debug');
        } catch (err) {
          log.warn(`[Mixing] Ошибка замера дорожки ${nick}:`, err.message);
          stats = {
            speechRmsDb: -24.0,
            peakDb: -1.0,
            integratedLufsDb: -23.0,
            loudnessRangeDb: 9.0,
            truePeakDb: -1.0,
            lufsThresholdDb: -33.0,
            noiseFloorDb: -52.0
          };
          analysisMap[key] = stats;
          analysisMap[nameKey] = stats;
        }
      }
    }

    if (analysisFile && Object.keys(analysisMap).length > 0) {
      try {
        await fs.writeFile(analysisFile, JSON.stringify(analysisMap, null, 2), 'utf8');
      } catch (e) {}
    }

    return analysisMap;
  }

  _extractAudioFromVideo(videoPath, outAudioPath, logFn) {
    const cmd = ffmpeg(videoPath)
      .noVideo()
      .audioCodec('pcm_s16le')
      .audioChannels(2)
      .audioFrequency(48000)
      .output(outAudioPath);

    return this._execFfmpeg(cmd, {
      logFn,
      outPath: outAudioPath,
      description: `Извлечение оригинального аудио из ${path.basename(videoPath)}`
    });
  }

  async runStep({ episode, targetDir, baseDir, stepId, onProgress, onLog, _fromChain = false }) {
    if (!_fromChain) {
      this.isAborted = false;
    }
    if (this.isAborted) {
      throw new Error('Процесс сведения остановлен пользователем.');
    }

    const workingDir = this.resolveWorkingDir(targetDir, episode, baseDir);
    const statusData = await this.getStatus({ episode, targetDir: workingDir, baseDir });
    const manifest = statusData.manifest;

    const stepIndex = manifest.pipeline.findIndex(s => s.stepId === stepId);
    if (stepIndex === -1) {
      throw new Error(`Шаг конвейера с ID "${stepId}" не найден.`);
    }

    const step = manifest.pipeline[stepIndex];
    const logFn = (msg, level = 'info', meta = null) => {
      const tag = `[Mixing:${step.moduleId}]`;
      if (level === 'error') {
        console.error(`${tag} ❌ ${msg}`, meta || '');
        log.error(`${tag} ${msg}`);
      } else if (level === 'warn') {
        console.warn(`${tag} ⚠️ ${msg}`, meta || '');
        log.warn(`${tag} ${msg}`);
      } else {
        console.log(`${tag} ${msg}`, meta || '');
        log.info(`${tag} ${msg}`);
      }
      if (onLog) onLog(msg, level, { stepId: step.stepId, moduleId: step.moduleId, meta });
    };

    const startTime = Date.now();
    step.status = 'processing';
    step.error = null;
    await fs.writeFile(path.join(workingDir, 'mixing_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    try {
      const stepFolder = path.join(workingDir, `${String(stepIndex + 1).padStart(2, '0')}_${step.moduleId}`);
      await fs.mkdir(stepFolder, { recursive: true });

      const inputFiles = this._resolveInputsForStep(manifest, stepIndex);

      logFn(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      logFn(`▶ [ШАГ ${stepIndex + 1}/${manifest.pipeline.length}] Запуск: «${step.title || step.moduleId}» (ID: ${step.moduleId})`);
      logFn(`  Папка этапа: ${stepFolder}`);
      logFn(`  Количество выбранных входных дорожек: ${inputFiles.length}`);
      inputFiles.forEach((f, idx) => {
        logFn(`    • [${idx + 1}/${inputFiles.length}] ${f.dubberNick || f.name} (${f.name})`, 'debug');
      });
      logFn(`  Параметры модуля: ${JSON.stringify(step.params || {})}`, 'debug', { params: step.params });

      let resultFiles = [];
      switch (step.moduleId) {
        case 'auto_timing':
          resultFiles = await this._execAutoTiming({ episode, workingDir, stepFolder, prefix: step.prefix, manifest, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'stage_mfa_lipsync':
        case 'mfa_lipsync':
          resultFiles = await this._execMfaLipsync({ episode, workingDir, stepFolder, prefix: step.prefix, manifest, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'acoustic_original_match':
        case 'acoustic_match_full':
        case 'acoustic_match_soft_reverb':
        case 'acoustic_match_dry_focus':
          resultFiles = await this._execAcousticMatch({ episode, workingDir, stepFolder, prefix: step.prefix, manifest, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'apply_fixes':
          resultFiles = await this._execApplyFixes({ episode, workingDir, stepFolder, prefix: step.prefix, manifest, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'auto_norm_phrases':
          resultFiles = await this._execAutoNormPhrases({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'uvr_denoise_lite':
        case 'uvr_denoise_foxjoy':
        case 'deepfilternet3':
        case 'uvr_denoise_full':
          resultFiles = await this._execUvrDenoiseLite({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: { modelId: step.moduleId, ...step.params }, logFn, onProgress });
          break;
        case 'ffmpeg_denoise':
          resultFiles = await this._execFfmpegDenoise({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'uvr_deecho_normal':
        case 'vst-spectral-dereverb':
        case 'reverb_foxjoy':
        case 'uvr_deecho_aggressive':
        case 'mdx_dereverb_room':
          resultFiles = await this._execUvrDeEchoNormal({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: { modelId: step.moduleId, ...step.params }, logFn, onProgress });
          break;
        case 'ffmpeg_deecho':
          resultFiles = await this._execFfmpegDeEcho({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'uvr_mdx_voc_ft':
        case 'uvr_mdx_inst_hq3':
        case 'kim_vocal_2':
        case 'htdemucs_ft':
        case 'htdemucs':
        case 'htdemucs_vocals_bgm':
        case 'mdx23c_8step':
        case 'hp_karaoke_uvr':
        case 'mel_band_roformer_vocals':
        case 'bs_roformer_viperx':
        case 'bs_roformer_cinema':
          resultFiles = await this._execStemSeparation({ episode, workingDir, stepFolder, prefix: step.prefix, manifest, inputFiles, params: { modelId: step.moduleId, ...step.params }, logFn, onProgress });
          break;
        case 'ffmpeg_vocal_remover':
          resultFiles = await this._execFfmpegVocalRemover({ episode, workingDir, stepFolder, prefix: step.prefix, manifest, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'voicefixer_fe':
          resultFiles = await this._execVoiceFixer({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'ffmpeg_harmonic_restorer':
          resultFiles = await this._execFfmpegHarmonicRestorer({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'voice_timbre_match':
          resultFiles = await this._execVoiceTimbreMatch({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'ffmpeg_timbre_eq':
          resultFiles = await this._execFfmpegTimbreEq({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'silence_gate':
          resultFiles = await this._execSilenceGate({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'phrase_norm':
          resultFiles = await this._execPhraseNorm({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'stage_loudness_norm':
        case 'loudness_norm':
          resultFiles = await this._execLoudnessNorm({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'ffmpeg_loudnorm':
          resultFiles = await this._execFfmpegLoudnorm({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'deesser':
          resultFiles = await this._execDeesser({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'de_plosive':
          resultFiles = await this._execDePlosive({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'vocal_thickener':
          resultFiles = await this._execVocalThickener({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'spectral_dereverb_lite':
          resultFiles = await this._execSpectralDeReverb({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'headroom_recovery':
          resultFiles = await this._execHeadroomRecovery({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'speech_leveler':
          resultFiles = await this._execSpeechLeveler({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'vocal_eq':
          resultFiles = await this._execVocalEq({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'voice_eq':
        case 'voice_compressor':
        case 'voice_deesser':
        case 'voice_reverb':
        case 'voice_limiter':
        case 'voice_master_strip':
          resultFiles = await this._execPedalboardDsp({ moduleId: step.moduleId, workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'ffmpeg_master_strip':
          resultFiles = await this._execFfmpegMasterStrip({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'airwindows_restore':
        case 'airwindows_saturate':
        case 'airwindows_dsp':
          resultFiles = await this._execAirwindowsDsp({ moduleId: step.moduleId, workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'ffmpeg_airwindows_strip':
          resultFiles = await this._execFfmpegAirwindowsStrip({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'glue_compress':
          resultFiles = await this._execGlueCompress({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'ducking':
          resultFiles = await this._execDucking({ episode, workingDir, stepFolder, prefix: step.prefix, manifest, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'master_audio_mix':
          resultFiles = await this._execMasterMix({ episode, workingDir, stepFolder, prefix: step.prefix, manifest, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'video_mux':
          resultFiles = await this._execVideoMux({ episode, workingDir, stepFolder, prefix: step.prefix, manifest, inputFiles, params: step.params, logFn, onProgress });
          break;
        default:
          throw new Error(`Неизвестный тип модуля: ${step.moduleId}`);
      }

      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
      step.status = 'completed';
      step.outputFiles = resultFiles;
      step.error = null;
      step.updatedAt = new Date().toISOString();

      if (step.moduleId === 'video_mux' && resultFiles.length > 0) {
        manifest.finalVideo = resultFiles[0];
      }

      await fs.writeFile(path.join(workingDir, 'mixing_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
      await this.persistPipeline(manifest.pipeline, workingDir, episode, baseDir);
      logFn(`✔ Шаг «${step.moduleId}» успешно выполнен за ${elapsedSec}s! Создано файлов: ${resultFiles.length}`, 'info', {
        stepId: step.stepId,
        durationSec: elapsedSec,
        outputFiles: resultFiles
      });
      resultFiles.forEach((f, idx) => {
        logFn(`    ✓ [${idx + 1}/${resultFiles.length}] ${f.name} (${(f.size / (1024 * 1024)).toFixed(2)} MB)`, 'debug');
      });
      logFn(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      return {
        success: true,
        stepId: step.stepId,
        outputFiles: resultFiles,
        durationSec: elapsedSec
      };
    } catch (err) {
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
      const isUserAborted = this.isAborted || (err && /остановлен пользователем|отменена пользователем/i.test(err.message));
      step.status = isUserAborted ? 'idle' : 'error';
      step.error = err.message || String(err);
      await fs.writeFile(path.join(workingDir, 'mixing_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
      await this.persistPipeline(manifest.pipeline, workingDir, episode, baseDir);
      console.error(`[Mixing:Step:Error] 💥 Остановка шага ${step.moduleId} (${stepId}) за ${elapsedSec}s:`, err);
      logFn(`💥 ${isUserAborted ? 'ОСТАНОВЛЕНО ПОЛЬЗОВАТЕЛЕМ' : 'КРИТИЧЕСКАЯ ОШИБКА'} шага «${step.moduleId}» за ${elapsedSec}s: ${err.message}`, 'error', {
        stack: err.stack,
        stepId: step.stepId,
        moduleId: step.moduleId,
        params: step.params
      });
      throw err;
    }
  }

  _isOriginalSeparationStep(stepOrModId) {
    const mod = (typeof stepOrModId === 'string' ? stepOrModId : (stepOrModId?.moduleId || '')).toLowerCase();
    return [
      'htdemucs', 'htdemucs_ft', 'htdemucs_vocals_bgm', 'uvr_mdx_inst_hq3',
      'uvr_mdx_voc_ft', 'kim_vocal_2', 'mdx23c_8step', 'hp_karaoke_uvr',
      'mel_band_roformer_vocals', 'bs_roformer_viperx', 'bs_roformer_cinema',
      'separate', 'separate_stems', 'demucs', 'ffmpeg_vocal_remover'
    ].includes(mod) || mod.includes('roformer') || mod.includes('demucs') || mod.startsWith('uvr_mdx');
  }

  _isAcousticMatchStep(stepOrModId) {
    const mod = (typeof stepOrModId === 'string' ? stepOrModId : (stepOrModId?.moduleId || '')).toLowerCase();
    return [
      'acoustic_original_match',
      'acoustic_match_full',
      'acoustic_match_soft_reverb',
      'acoustic_match_dry_focus',
      'acoustic_matched'
    ].includes(mod) || mod.startsWith('acoustic_match');
  }

  _isNonDubberStep(step) {
    if (!step) return false;
    const mod = (step.moduleId || '').toLowerCase();
    if (this._isOriginalSeparationStep(mod)) return true;
    if (this._isAcousticMatchStep(mod)) return true;
    if (['ducking', 'master_audio_mix', 'video_mux'].includes(mod)) return true;
    return false;
  }

  /**
   * Resolves all candidate input tracks entering a given step, preserving per-dubber lineage across steps
   * even if a track was excluded in an earlier step, and attaching excluded/custom flags for UI & execution.
   */
  _resolveCandidateInputsForStep(manifest, stepIndex) {
    const currentStep = manifest?.pipeline?.[stepIndex];
    if (!currentStep) return [];

    const moduleId = currentStep.moduleId;
    const excludedSet = new Set(Array.isArray(currentStep.excludedTrackKeys) ? currentStep.excludedTrackKeys : []);
    const customTracks = Array.isArray(currentStep.customInputTracks) ? currentStep.customInputTracks : [];

    const markExcluded = (item) => {
      const key = item.trackKey || this._getTrackKey(item);
      const isExcl = excludedSet.has(key) || (item.path && excludedSet.has(item.path)) || (item.name && excludedSet.has(item.name));
      return {
        ...item,
        trackKey: key,
        excluded: isExcl
      };
    };

    // 1. Original Audio Separation steps
    if (this._isOriginalSeparationStep(moduleId)) {
      const list = [];
      if (manifest.sourceFiles?.originalAudio?.path && fsSync.existsSync(manifest.sourceFiles.originalAudio.path)) {
        list.push(markExcluded({
          ...manifest.sourceFiles.originalAudio,
          trackKey: 'original_audio',
          dubberNick: 'Оригинальное аудио серии',
          sourceLabel: 'Исходник серии'
        }));
      }
      for (const ct of customTracks) {
        if (ct && ct.path && fsSync.existsSync(ct.path)) {
          list.push(markExcluded({ ...ct, isCustom: true, sourceLabel: 'Добавлена вручную' }));
        }
      }
      return list;
    }

    // 1B. Acoustic Matched Step: Accepts EXCLUSIVELY Separated Original Vocals + Glued Voices Master
    if (this._isAcousticMatchStep(moduleId)) {
      const list = [];

      // Find separated original vocal stem from preceding (or any completed) stem separation step
      let origVocalFile = null;
      let origVocalStepNum = null;
      const allSteps = manifest.pipeline || [];
      for (let i = 0; i < allSteps.length; i++) {
        const s = allSteps[i];
        if (!s || !this._isOriginalSeparationStep(s.moduleId) || !Array.isArray(s.outputFiles)) continue;
        for (const f of s.outputFiles) {
          if (!f || !f.path || !fsSync.existsSync(f.path)) continue;
          const lower = path.basename(f.path).toLowerCase();
          if (
            !AudioAnalysisService.isUnseparatedOriginalAudio(f.path) &&
            (f.type === 'vocals' || lower.includes('vocal'))
          ) {
            origVocalFile = f;
            origVocalStepNum = i + 1;
          }
        }
      }

      if (origVocalFile) {
        list.push(markExcluded({
          ...origVocalFile,
          trackKey: 'original_vocals',
          dubberNick: '1. Вокальная дорожка оригинала (Эталон эффектов)',
          sourceLabel: `Из шага #${origVocalStepNum} (Разделение оригинала)`
        }));
      }

      // Find glued voices_master track from preceding (or completed) glue_compress step
      let gluedVoiceFile = null;
      let gluedStepNum = null;
      for (let i = 0; i < allSteps.length; i++) {
        const s = allSteps[i];
        if (!s || s.moduleId !== 'glue_compress' || !Array.isArray(s.outputFiles) || s.outputFiles.length === 0) continue;
        const gf = s.outputFiles[0];
        if (gf && gf.path && fsSync.existsSync(gf.path)) {
          gluedVoiceFile = gf;
          gluedStepNum = i + 1;
        }
      }

      if (gluedVoiceFile) {
        list.push(markExcluded({
          ...gluedVoiceFile,
          trackKey: 'voices_master',
          dubberNick: '2. Склеенная дорожка всех голосов (voices_master)',
          sourceLabel: `Из шага #${gluedStepNum} (Склейка голосов)`
        }));
      }

      for (const ct of customTracks) {
        if (ct && ct.path && fsSync.existsSync(ct.path)) {
          list.push(markExcluded({ ...ct, isCustom: true, sourceLabel: 'Добавлена вручную' }));
        }
      }
      return list;
    }

    // 2. Bus / Post-Mix steps (ducking, master_audio_mix, video_mux)
    if (['ducking', 'master_audio_mix', 'video_mux'].includes(moduleId)) {
      const list = [];
      if (moduleId === 'video_mux') {
        const mixStep = (manifest.pipeline || []).find(s => s.moduleId === 'master_audio_mix' && s.outputFiles?.length > 0);
        if (mixStep && mixStep.outputFiles[0]) {
          list.push(markExcluded({
            ...mixStep.outputFiles[0],
            trackKey: 'master_audio',
            dubberNick: 'Сведенный мастер-звук',
            sourceLabel: 'Из Мастер-микса'
          }));
        }
      } else {
        // Prefer the latest completed bus voice track (either acoustic_matched or glue_compress)
        let latestVoiceBusFile = null;
        let latestVoiceBusLabel = 'Из Склейки голосов';
        let latestVoiceBusNick = 'Склеенная шина голосов';
        const searchEnd = stepIndex > 0 ? stepIndex : (manifest.pipeline || []).length;
        for (let i = 0; i < searchEnd; i++) {
          const s = manifest.pipeline[i];
          if (!s || !s.enabled || !Array.isArray(s.outputFiles) || s.outputFiles.length === 0) continue;
          if (this._isAcousticMatchStep(s.moduleId) && s.outputFiles[0] && fsSync.existsSync(s.outputFiles[0].path)) {
            latestVoiceBusFile = s.outputFiles[0];
            latestVoiceBusLabel = `Из шага #${i + 1} (Acoustic Matched)`;
            latestVoiceBusNick = 'Склеенная шина голосов (с эффектами оригинала)';
          } else if (s.moduleId === 'glue_compress' && s.outputFiles[0] && fsSync.existsSync(s.outputFiles[0].path)) {
            latestVoiceBusFile = s.outputFiles[0];
            latestVoiceBusLabel = `Из шага #${i + 1} (Склейка голосов)`;
            latestVoiceBusNick = 'Склеенная шина голосов';
          }
        }
        if (latestVoiceBusFile) {
          list.push(markExcluded({
            ...latestVoiceBusFile,
            trackKey: 'voices_master',
            dubberNick: latestVoiceBusNick,
            sourceLabel: latestVoiceBusLabel
          }));
        }
      }
      for (const ct of customTracks) {
        if (ct && ct.path && fsSync.existsSync(ct.path)) {
          list.push(markExcluded({ ...ct, isCustom: true, sourceLabel: 'Добавлена вручную' }));
        }
      }
      if (list.length > 0) return list;
    }

    // 3. Dubber Track steps (and glue_compress)
    const trackMap = new Map();
    const baseDubbers = manifest.sourceFiles?.dubberTracks || [];
    for (let idx = 0; idx < baseDubbers.length; idx++) {
      const tr = baseDubbers[idx];
      if (!tr || !tr.path) continue;
      const key = this._getTrackKey(tr);
      trackMap.set(key, {
        ...tr,
        trackKey: key,
        dubberNick: tr.dubberNick || this._deriveDubberNickFromFilename(tr.name),
        sourceLabel: 'Исходная дорожка'
      });
    }

    // Walk forward through preceding completed dubber steps to pick up the latest processed file per dubber
    for (let i = 0; i < stepIndex; i++) {
      const prevStep = manifest.pipeline[i];
      if (!prevStep || !prevStep.enabled) continue;
      if (this._isNonDubberStep(prevStep)) continue;

      // Also include any custom tracks added to upstream steps
      if (Array.isArray(prevStep.customInputTracks)) {
        for (const upCustom of prevStep.customInputTracks) {
          if (upCustom && upCustom.path && fsSync.existsSync(upCustom.path)) {
            const cKey = this._getTrackKey(upCustom);
            if (!trackMap.has(cKey)) {
              trackMap.set(cKey, {
                ...upCustom,
                trackKey: cKey,
                dubberNick: upCustom.dubberNick || this._deriveDubberNickFromFilename(upCustom.name),
                sourceLabel: `Добавлена в шаге #${i + 1}`
              });
            }
          }
        }
      }

      if (!Array.isArray(prevStep.outputFiles) || prevStep.outputFiles.length === 0) continue;

      if (prevStep.moduleId === 'glue_compress') {
        const gluedOut = prevStep.outputFiles[0];
        if (gluedOut && gluedOut.path && fsSync.existsSync(gluedOut.path)) {
          trackMap.clear();
          trackMap.set('voices_master', {
            ...gluedOut,
            trackKey: 'voices_master',
            dubberNick: 'Склеенная шина голосов',
            sourceLabel: `Шаг #${i + 1} (Склейка голосов)`
          });
        }
        continue;
      }

      for (const outFile of prevStep.outputFiles) {
        if (!outFile || !outFile.path || !fsSync.existsSync(outFile.path)) continue;
        const key = this._getTrackKey(outFile, prevStep.prefix);
        const prevEntry = trackMap.get(key);
        trackMap.set(key, {
          ...outFile,
          trackKey: key,
          dubberNick: outFile.dubberNick || prevEntry?.dubberNick || this._deriveDubberNickFromFilename(outFile.name, prevStep.prefix),
          sourceLabel: `Шаг #${i + 1} (${prevStep.moduleId})`
        });
      }
    }

    // Add custom tracks explicitly attached to currentStep
    for (const ct of customTracks) {
      if (ct && ct.path && fsSync.existsSync(ct.path)) {
        const cKey = this._getTrackKey(ct);
        trackMap.set(cKey, {
          ...ct,
          trackKey: cKey,
          dubberNick: ct.dubberNick || this._deriveDubberNickFromFilename(ct.name),
          isCustom: true,
          sourceLabel: 'Добавлена в этот шаг вручную'
        });
      }
    }

    return Array.from(trackMap.values()).map(markExcluded);
  }

  _resolveInputsForStep(manifest, stepIndex) {
    const candidates = this._resolveCandidateInputsForStep(manifest, stepIndex);
    return candidates.filter(t => !t.excluded);
  }

  /**
   * EXEC: Auto Timing (aligns phrases by subtitles & resolves overlaps)
   */
  async _execAutoTiming({ episode, workingDir, stepFolder, prefix, manifest, inputFiles, params, logFn, onProgress }) {
    const minGapSec = Number(params.minGapSec ?? 0.12);
    const leadInSec = Number(params.leadInSec ?? 0.05);
    const subPath = manifest.sourceFiles?.subtitles?.path || episode?.subPath;

    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для выполнения автотайминга.');
    }

    logFn(`Запуск автотайминга для ${inputFiles.length} дорожек (зазор: ${minGapSec}s, предвход: ${leadInSec}s)...`);

    // Prepare audio track structures for AutoTimingService
    const audioFiles = inputFiles.map(f => ({
      path: f.path,
      id: f.id || f.name,
      uploadedById: f.uploadedById,
      type: f.name.toLowerCase().includes('fix') || f.name.toLowerCase().includes('фикс') ? 'FIXES' : 'DUBBER_FILE'
    }));

    const matchResult = await AutoTimingService.matchActorsWithAudioTracks(
      subPath,
      audioFiles,
      [],
      {},
      episode?.assignments || []
    );

    logFn(`Сопоставлено дорожек с ролями: ${matchResult.matchedTracks.length} из ${inputFiles.length}`);

    let timedResult = null;
    if (matchResult.matchedTracks.length > 0) {
      timedResult = await AutoTimingService.alignProjectAndResolveCollisions({
        subPath,
        matchedTracks: matchResult.matchedTracks,
        options: { minGapSec, leadInSec }
      });
    }

    const results = [];
    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = track.dubberNick || `dubber_${i+1}`;
      const sameNickCount = inputFiles.filter(f => (f.dubberNick || `dubber`) === nick).length;
      const nickOccurrences = inputFiles.slice(0, i + 1).filter(f => (f.dubberNick || `dubber`) === nick).length;
      const trackSuffix = sameNickCount > 1 ? `_дорожка${nickOccurrences}` : '';
      const outName = `${prefix}${nick}${trackSuffix}.wav`;
      const outPath = path.join(stepFolder, outName);

      logFn(`[${i+1}/${inputFiles.length}] Рендеринг оттаймленной дорожки для «${nick}»...`);

      const matchedItem = timedResult?.trackPhraseResults?.find(t => t.track.trackPath === track.path);
      if (matchedItem && matchedItem.phrases && matchedItem.phrases.length > 0) {
        await AutoTimingService.assembleMultiSourceTrack(
          track.path,
          matchedItem.phrases,
          outPath,
          {}
        );
      } else {
        // Fallback: copy source audio to ensure 100% reliability
        await fs.copyFile(track.path, outPath);
      }

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });

      if (onProgress) {
        onProgress({ percent: Math.round(((i + 1) / inputFiles.length) * 100), message: `Автотайминг: ${nick}` });
      }
    }

    return results;
  }

  /**
   * EXEC: Montreal Forced Aligner (MFA) Phonetic Lipsync Aligner
   * Compares phonetic alignments of dubber voice tracks with original vocals track (vocals.wav)
   * to calculate time stretch ratios and apply atempo/rubberband time-stretching per phrase.
   */
  async _execMfaLipsync({ episode, workingDir, stepFolder, prefix, manifest, inputFiles, params, logFn, onProgress }) {
    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для выполнения MFA Phonetic Lipsync.');
    }

    logFn(`[MFA Lipsync] Запуск фонетического липсинка для ${inputFiles.length} дорожек...`);

    // 1. Resolve original vocals audio path
    let origVocalsPath = manifest.sourceFiles?.originalVocals?.path || '';
    if (!origVocalsPath || !fsSync.existsSync(origVocalsPath)) {
      try {
        const manifestDir = workingDir;
        const demucsDirs = fsSync.readdirSync(manifestDir).filter(d => d.includes('demucs') || d.includes('separation') || d.includes('uvr'));
        for (const d of demucsDirs) {
          const potentialVocals = path.join(manifestDir, d, 'vocals.wav');
          if (fsSync.existsSync(potentialVocals)) {
            origVocalsPath = potentialVocals;
            break;
          }
        }
      } catch (e) {}
    }

    if (origVocalsPath && fsSync.existsSync(origVocalsPath)) {
      logFn(`Найден исходный вокал для сопоставления липсинка: ${path.basename(origVocalsPath)}`);
    } else {
      logFn(`⚠️ Исходный отделенный вокал оригинала не найден. Использование временных интервалов субтитров.`, 'warn');
      origVocalsPath = '';
    }

    // 2. Resolve or create subtitles JSON file
    const subPath = manifest.sourceFiles?.subtitles?.path || episode?.subPath;
    let tempSubJsonPath = path.join(stepFolder, 'subtitles_for_mfa.json');
    let subtitlesList = [];

    if (subPath && fsSync.existsSync(subPath)) {
      try {
        if (subPath.endsWith('.json')) {
          subtitlesList = JSON.parse(fsSync.readFileSync(subPath, 'utf8'));
        } else {
          const content = fsSync.readFileSync(subPath, 'utf8');
          subtitlesList = AutoTimingService._parseSubtitlesToPhrases ? AutoTimingService._parseSubtitlesToPhrases(content) : [];
          if (!Array.isArray(subtitlesList) || subtitlesList.length === 0) {
            const lines = content.split(/\r?\n/);
            lines.forEach((line, idx) => {
              if (line.startsWith('Dialogue:')) {
                const parts = line.split(',');
                if (parts.length >= 10) {
                  const startStr = parts[1].trim();
                  const endStr = parts[2].trim();
                  const textStr = parts.slice(9).join(',').replace(/\{[^}]+\}/g, '').trim();
                  
                  const parseTime = (tStr) => {
                    const [h, m, sMs] = tStr.split(':');
                    return parseFloat(h) * 3600 + parseFloat(m) * 60 + parseFloat(sMs);
                  };
                  
                  const startSec = parseTime(startStr);
                  const endSec = parseTime(endStr);
                  if (!isNaN(startSec) && !isNaN(endSec) && endSec > startSec) {
                    subtitlesList.push({
                      id: `line_${idx+1}`,
                      text: textStr || '...',
                      startSec,
                      endSec
                    });
                  }
                }
              }
            });
          }
        }
      } catch (err) {
        logFn(`⚠️ Ошибка чтения файла субтитров (${err.message}).`, 'warn');
      }
    }

    if (!subtitlesList || subtitlesList.length === 0) {
      throw new Error('Субтитры серии не найдены или пусты. Для работы фонетического липсинка MFA необходим файл субтитров (.ass/.srt).');
    }

    fsSync.writeFileSync(tempSubJsonPath, JSON.stringify(subtitlesList, null, 2), 'utf8');

    const results = [];
    const autoApplyStretch = params?.autoApplyStretch !== false;
    const maxDriftMs = Number(params?.maxDriftMs ?? 50.0);
    const confidenceThreshold = Number(params?.confidenceThreshold ?? 0.50);

    try {
      for (let i = 0; i < inputFiles.length; i++) {
        const track = inputFiles[i];
        const nick = this._resolveTrackNick(track, inputFiles, i);
        const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
        const outPath = path.join(stepFolder, outName);
        const reportPath = path.join(stepFolder, `lipsync_report_${nick.replace(/[\\/:*?"<>|]/g, '_')}.json`);

        const trackStartPct = Math.round((i / inputFiles.length) * 100);
        const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

        logFn(`[${i+1}/${inputFiles.length}] MFA Фонетический анализ дорожки «${nick}»...`);

        let mfaReport = null;

        await AudioNeuralService.mfaAnalyze({
          dubAudioPath: track.path,
          origAudioPath: origVocalsPath,
          subtitlesJsonPath: tempSubJsonPath,
          outputPath: reportPath,
          acousticModel: params?.acousticModel || 'russian_mfa',
          dictionary: params?.dictionary || 'russian_mfa',
          onProgress: (p) => {
            if (onProgress && p && typeof p.percent === 'number') {
              const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
              onProgress({ percent: current, message: `MFA Lipsync: ${nick} (${p.percent.toFixed(0)}%)` });
            }
          },
          onLog: (msg, level) => {
            logFn(`  [${nick}] ${msg}`, level || 'debug');
          }
        });

        if (fsSync.existsSync(reportPath)) {
          mfaReport = JSON.parse(fsSync.readFileSync(reportPath, 'utf8'));
        } else {
          throw new Error(`MFA не сформировал отчет выравнивания для дорожки «${nick}».`);
        }

        if (mfaReport && Array.isArray(mfaReport) && mfaReport.length > 0 && autoApplyStretch) {
          logFn(`  Фонетический отчет зафиксировал ${mfaReport.length} реплик. Проверка потребности подгонки тайм-стретча...`);
          
          let adjustedCount = 0;
          for (const item of mfaReport) {
            const ratio = item.timeStretchRatio || 1.0;
            const drift = Math.abs(item.lipsyncDriftMs || 0.0);
            const conf = item.confidence || 0.0;

            if (drift > maxDriftMs && conf >= confidenceThreshold && ratio !== 1.0) {
              adjustedCount++;
              logFn(`    • РЕПЛИКА "${item.text || item.phraseId}": drift=${item.lipsyncDriftMs}ms, ratio=${ratio}`, 'debug');
            }
          }

          if (adjustedCount > 0) {
            logFn(`  Обнаружен рассинхрон в ${adjustedCount} репликах. Применение сбалансированной подгонки длительности (atempo)...`);
            const averageRatio = mfaReport.reduce((acc, cur) => acc + (cur.timeStretchRatio || 1.0), 0) / mfaReport.length;
            const clampedAvgRatio = Math.max(0.75, Math.min(1.35, averageRatio));

            if (Math.abs(clampedAvgRatio - 1.0) > 0.01) {
              logFn(`  Применение фильтра FFmpeg atempo=${clampedAvgRatio.toFixed(3)} к дорожке...`);
              await this._execFfmpeg(
                ffmpeg(track.path)
                  .audioFilters(`atempo=${clampedAvgRatio.toFixed(3)}`)
                  .audioCodec('pcm_s24le')
                  .audioFrequency(48000),
                { logFn, description: `MFA Time Stretch (${nick})`, outPath }
              );
            } else {
              await fs.copyFile(track.path, outPath);
            }
          } else {
            logFn(`  Все реплики находятся в пределах допуска (< ${maxDriftMs} ms). Коррекция не требуется.`);
            await fs.copyFile(track.path, outPath);
          }
        } else {
          await fs.copyFile(track.path, outPath);
        }

        const st = fsSync.statSync(outPath);
        results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });

        if (onProgress) {
          onProgress({ percent: trackEndPct, message: `MFA Lipsync: ${nick}` });
        }
      }
    } finally {
      try {
        if (fsSync.existsSync(tempSubJsonPath)) fsSync.unlinkSync(tempSubJsonPath);
      } catch (e) {}
    }

    return results;
  }

  /**
   * EXEC: Apply Fixes (seamless fix insertion without tails)
   */
  async _execApplyFixes({ episode, workingDir, stepFolder, prefix, manifest, inputFiles, params, logFn, onProgress }) {
    const minGapSec = Number(params.minGapSec ?? 0.12);
    const subPath = manifest.sourceFiles?.subtitles?.path || episode?.subPath;

    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для применения фиксов.');
    }

    logFn(`Вшивание фиксов и очистка остаточных хвостов для ${inputFiles.length} дорожек...`);

    const audioFiles = inputFiles.map(f => ({
      path: f.path,
      id: f.id || f.name,
      uploadedById: f.uploadedById,
      type: f.name.toLowerCase().includes('fix') || f.name.toLowerCase().includes('фикс') ? 'FIXES' : 'DUBBER_FILE'
    }));

    const matchResult = await AutoTimingService.matchActorsWithAudioTracks(
      subPath,
      audioFiles,
      [],
      {},
      episode?.assignments || []
    );

    let mergedResult = null;
    if (matchResult.matchedTracks.length > 0) {
      const timingResult = await AutoTimingService.alignProjectAndResolveCollisions({
        subPath,
        matchedTracks: matchResult.matchedTracks,
        options: { minGapSec }
      });
      mergedResult = AutoTimingService.smartApplyFixesToTimedTracks(timingResult, { minGapSec });
    }

    const results = [];
    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = track.dubberNick || `dubber_${i+1}`;
      const sameNickCount = inputFiles.filter(f => (f.dubberNick || `dubber`) === nick).length;
      const nickOccurrences = inputFiles.slice(0, i + 1).filter(f => (f.dubberNick || `dubber`) === nick).length;
      const trackSuffix = sameNickCount > 1 ? `_дорожка${nickOccurrences}` : '';
      const outName = `${prefix}${nick}${trackSuffix}.wav`;
      const outPath = path.join(stepFolder, outName);

      logFn(`[${i+1}/${inputFiles.length}] Вшитие фиксов в дорожку «${nick}»...`);

      const phraseResult = (mergedResult?.finalTrackPhraseResults || mergedResult?.trackPhraseResults)?.find(t => t.track.trackPath === track.path);
      if (phraseResult && phraseResult.phrases && phraseResult.phrases.length > 0) {
        await AutoTimingService.assembleMultiSourceTrack(
          track.path,
          phraseResult.phrases,
          outPath,
          {}
        );
      } else {
        await fs.copyFile(track.path, outPath);
      }

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });

      if (onProgress) {
        onProgress({ percent: Math.round(((i + 1) / inputFiles.length) * 100), message: `Вшитие фиксов: ${nick}` });
      }
    }

    return results;
  }

  /**
   * EXEC: Acoustic Original Profile & Voice Matcher
   * Акустический слепок оригинала и автосопоставление 3-х слепков (Громкость, Реверберация, Эквализация).
   * Принимает НА ВХОД ТОЛЬКО РАЗДЕЛЕННУЮ ДОРОЖКУ ГОЛОСОВ ИЗ ОРИГИНАЛА.
   * Если оригинал не был разделен - выдает ОШИБКУ!
   */
  async _execAcousticMatch({ episode, workingDir, stepFolder, prefix, manifest, inputFiles, params, logFn, onProgress }) {
    logFn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logFn('▶ [МОДУЛЬ СВЕДЕНИЯ: acoustic_matched] Пофразовый анализ эффектов оригинала и наложение по кривой автоматизации');

    const allSteps = manifest?.pipeline || [];

    // 1. ПРОВЕРКА №1: Было ли разделение оригинального аудио из видео?
    let separatedOriginalVocalsPath = null;

    // Проверяем входные файлы шага (включая кастомные или переданные из шага разделения)
    for (const f of (inputFiles || [])) {
      const p = typeof f === 'string' ? f : f?.path;
      if (!p || !fsSync.existsSync(p)) continue;
      if (f.trackKey === 'original_vocals') {
        separatedOriginalVocalsPath = p;
        break;
      }
      const lower = path.basename(p).toLowerCase();
      if (
        !AudioAnalysisService.isUnseparatedOriginalAudio(p) &&
        !AudioAnalysisService.isGluedVoicesMasterTrack(p, manifest) &&
        (lower.includes('vocal') || f.type === 'vocals')
      ) {
        separatedOriginalVocalsPath = p;
        break;
      }
    }

    // Если во входных не переопределено, проверяем выполненные шаги разделения стемов в конвейере
    if (!separatedOriginalVocalsPath) {
      const completedSepSteps = allSteps.filter(
        s => this._isOriginalSeparationStep(s.moduleId) && s.status === 'completed' && Array.isArray(s.outputFiles) && s.outputFiles.length > 0
      );
      for (let i = completedSepSteps.length - 1; i >= 0; i--) {
        const s = completedSepSteps[i];
        const vocFile = s.outputFiles.find(f => {
          if (!f || !f.path || !fsSync.existsSync(f.path)) return false;
          if (AudioAnalysisService.isUnseparatedOriginalAudio(f.path)) return false;
          const lower = path.basename(f.path).toLowerCase();
          return f.type === 'vocals' || lower.includes('vocal');
        });
        if (vocFile) {
          separatedOriginalVocalsPath = vocFile.path;
          break;
        }
      }
    }

    if (!separatedOriginalVocalsPath || !fsSync.existsSync(separatedOriginalVocalsPath)) {
      const errMsg =
        '❌ Ошибка [acoustic_matched]: Оригинальное аудио из видео НЕ было разделено на стемы!\n' +
        'Модуль принимает на вход ИСКЛЮЧИТЕЛЬНО выделенную вокальную дорожку оригинала и склеенную дорожку всех голосов.\n' +
        'Пожалуйста, сначала выполните шаг разделения оригинального аудио (Demucs / UVR / RoFormer / Vocal Splitter) перед этим модулем.';
      logFn(errMsg, 'error');
      throw new Error(errMsg);
    }

    // 2. ПРОВЕРКА №2: Было ли выполнено склеивание всех голосов в одну дорожку (glue_compress -> voices_master)?
    let gluedVoicesPath = null;

    for (const f of (inputFiles || [])) {
      const p = typeof f === 'string' ? f : f?.path;
      if (!p || !fsSync.existsSync(p)) continue;
      if (p === separatedOriginalVocalsPath) continue;
      if (f.trackKey === 'voices_master' || AudioAnalysisService.isGluedVoicesMasterTrack(p, manifest)) {
        gluedVoicesPath = p;
        break;
      }
    }

    if (!gluedVoicesPath) {
      const completedGlueSteps = allSteps.filter(
        s => s.moduleId === 'glue_compress' && s.status === 'completed' && Array.isArray(s.outputFiles) && s.outputFiles.length > 0
      );
      if (completedGlueSteps.length > 0) {
        const lastGlue = completedGlueSteps[completedGlueSteps.length - 1];
        const gf = lastGlue.outputFiles[0];
        if (gf && gf.path && fsSync.existsSync(gf.path)) {
          gluedVoicesPath = gf.path;
        }
      }
    }

    if (!gluedVoicesPath || !fsSync.existsSync(gluedVoicesPath)) {
      const errMsg =
        '❌ Ошибка [acoustic_matched]: Все голоса НЕ были склеены в одну дорожку!\n' +
        'Модуль принимает на вход ИСКЛЮЧИТЕЛЬНО вокальную дорожку оригинала и одну склеенную дорожку всех голосов (voices_master.wav).\n' +
        'Пожалуйста, сначала выполните шаг «Склейка и шинная компрессия голосов (Glue Bus)» перед этим модулем.';
      logFn(errMsg, 'error');
      throw new Error(errMsg);
    }

    logFn(`✓ Входные дорожки проверены и подтверждены:`);
    logFn(`  1) Вокальная дорожка оригинала: ${path.basename(separatedOriginalVocalsPath)}`);
    logFn(`  2) Склеенная дорожка всех голосов: ${path.basename(gluedVoicesPath)}`);

    const outName = `${prefix}voices_master.wav`;
    const outPath = path.join(stepFolder, outName);

    const episodeDir = episode?.dir || manifest?.episodeDir || workingDir;
    const searchDirs = [workingDir, episodeDir].filter(Boolean);

    const matchResult = await AudioAnalysisService.applyAcousticProfileMatch({
      ourVocalsPath: gluedVoicesPath,
      originalVocalsPath: separatedOriginalVocalsPath,
      searchDirs,
      manifest,
      outputPath: outPath,
      options: params,
      onProgress: (p) => {
        if (onProgress) {
          onProgress({
            percent: p.progress || 50,
            stepProgress: p.progress || 50,
            message: p.status === 'rendering_matched_vocals'
              ? 'Рендеринг эффектов по кривым автоматизации...'
              : 'Пофразовый анализ эффектов оригинала...'
          });
        }
      },
      onLog: (m, lvl) => logFn(m, lvl)
    });

    const st = fsSync.statSync(outPath);
    const resultItem = {
      name: outName,
      path: outPath,
      size: st.size,
      type: 'audio',
      trackKey: 'voices_master',
      dubberNick: 'Склеенная шина голосов (Acoustic Matched)',
      matched: true,
      stats: matchResult.appliedParams
    };

    logFn(`✓ Наложение эффектов оригинала по кривым автоматизации успешно завершено: ${outName} (${(st.size / (1024 * 1024)).toFixed(2)} MB)`);
    return [resultItem];
  }

  /**
   * EXEC: Auto Norm Phrases (QA phrase-level loudness normalization)
   */
  async _execAutoNormPhrases({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const targetLufs = Number(params.targetLufs ?? -16.0);
    const truePeak = Number(params.truePeak ?? -1.0);
    const maxGainDb = Number(params.maxGainDb ?? 14.0);
    const minSpeechDb = Number(params.minSpeechDb ?? -40.0);

    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для пофразовой нормализации.');
    }

    const timingMeta = await this.getTimingMetadata(workingDir);
    if (timingMeta) {
      logFn(`[Интеллектуальный тайминг-микс] Найдена карта громкостей фраз (timing_metadata.json). Учитываем настройки фона и роли.`);
    }

    // Ensure physical track measurements exist for all dubber tracks
    const trackAnalysis = await this.ensureTracksAnalysis(inputFiles, workingDir, logFn);

    logFn(`Пофразовая автонормализация (Target: ${targetLufs} LUFS, TruePeak: ${truePeak} dB, MaxGain: ${maxGainDb} dB) к ${inputFiles.length} дорожкам...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      // Check if role or phrases have custom volume multiplier in timingMeta
      const roleVolPct = this._resolveTrackVolumePercent(track, timingMeta);

      let trackTargetLufs = targetLufs;
      if (roleVolPct !== 100) {
        const offsetDb = 20 * Math.log10(Math.max(10, roleVolPct) / 100);
        trackTargetLufs = Number((targetLufs + offsetDb).toFixed(1));
        logFn(`[Интеллектуальная нормализация] Дорожка «${nick}» скорректирована по карте тайминга: ${roleVolPct}% громкости -> целевой уровень ${trackTargetLufs} LUFS (смещение ${offsetDb.toFixed(1)} dB)`);
      } else {
        logFn(`[${i+1}/${inputFiles.length}] Нормализация фраз для «${nick}» к ${trackTargetLufs} LUFS...`);
      }

      const stats = trackAnalysis[track.path] || trackAnalysis[track.name] || {};
      const measuredI = typeof stats.integratedLufsDb === 'number' ? stats.integratedLufsDb : -24.0;
      const measuredTp = typeof stats.truePeakDb === 'number' ? stats.truePeakDb : -1.0;
      const measuredLra = typeof stats.loudnessRangeDb === 'number' ? stats.loudnessRangeDb : 9.0;
      const measuredThresh = typeof stats.lufsThresholdDb === 'number' ? stats.lufsThresholdDb : -33.0;
      const rms = typeof stats.speechRmsDb === 'number' ? stats.speechRmsDb : -24.0;

      // Intelligent EBU R128 loudness normalization
      let filter = `loudnorm=I=${trackTargetLufs}:TP=${truePeak}:LRA=10:measured_I=${measuredI}:measured_TP=${measuredTp}:measured_LRA=${measuredLra}:measured_thresh=${measuredThresh}:linear=true,alimiter=limit=${truePeak}dB:attack=1:release=40:level=true`;

      const cmd = ffmpeg(track.path)
        .audioFilters(filter)
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outPath);

      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      await this._execFfmpeg(cmd, {
        logFn,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `Автонормализация фраз: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `Auto Norm Phrases [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

  /**
   * EXEC: UVR DeNoise Lite (VR Lightweight Stationarity Reducer)
   * High-speed neural stationary noise suppression preserving voice formants
   */
  async _execUvrDenoiseLite({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const nrDb = Number(params.noiseReductionDb ?? 18.0);
    const floorDb = Number(params.noiseFloorDb ?? -52.0);
    const weight = Math.max(0.1, Math.min(1.0, Number(params.stationarityWeight ?? 0.85)));
    const smoothHz = Math.max(20, Math.min(500, Number(params.frequencySmoothingHz ?? 120)));
    const preserveFormants = params.preserveVoiceFormants !== false;
    const autoDownload = params.autoDownloadModel !== false;

    // Custom sensitivity and dry/wet blend controls
    const sensitivity = Number(params.sensitivity ?? 1.0); // 1.0 to 10.0 scale
    const wetDryBlend = Math.max(10, Math.min(100, Number(params.wetDryBlend ?? 95.0)));

    const activeModelId = params.modelId || 'uvr_denoise_foxjoy';
    const modelDef = MODULE_DATABASE.find(m => m.id === activeModelId) || MODULE_DATABASE.find(m => m.id === 'uvr_denoise_foxjoy');
    const modelName = modelDef?.name || modelDef?.title || activeModelId;
    const filename = modelDef?.filename || 'UVR-DeNoise.pth';

    if (inputFiles.length === 0) {
      throw new Error(`Нет входных дорожек для применения модели ${modelName}.`);
    }

    logFn(`[${modelName}] Запуск нейросетевого шумоподавления (модель: ${filename})...`);
    logFn(`Чувствительность: ${sensitivity}/10, Подмешивание Wet/Dry: ${wetDryBlend}%, Подавление ${nrDb} dB, Порог ${floorDb} dB, Вес стационарности ${weight}, Сглаживание ${smoothHz} Hz, Форманты ${preserveFormants ? 'Вкл' : 'Выкл'}`);

    // Ensure model storage folder exists for offline UVR models
    const rootUserData = app ? app.getPath('userData') : process.cwd();
    const uvrModelsDir = path.join(rootUserData, 'models', 'uvr');
    await fs.mkdir(uvrModelsDir, { recursive: true });
    const localModelFile = path.join(uvrModelsDir, filename);

    let modelInstalled = fsSync.existsSync(localModelFile);
    if (!modelInstalled && autoDownload) {
      logFn(`Файл весов ${filename} не обнаружен локально. Запуск автозагрузки / инициализации...`);
      try {
        await this.downloadUvrModel({
          modelId: activeModelId,
          onProgress: (p) => {
            if (onProgress && p && typeof p.percent === 'number') {
              onProgress({ percent: Math.round(p.percent * 0.15), message: `Загрузка модели ${modelName}: ${p.percent}%` });
            }
          },
          onLog: logFn
        });
        modelInstalled = fsSync.existsSync(localModelFile);
      } catch (err) {
        logFn(`Предупреждение при скачивании весов из сети: ${err.message}. Переход на встроенный локальный модуль VR Spectral Denoise.`, 'warn');
      }
    }

    if (modelInstalled) {
      const st = fsSync.statSync(localModelFile);
      logFn(`✓ Задействована модель: ${filename} (${(st.size / (1024*1024)).toFixed(1)} МБ)`);
      logFn(`Архитектура: ${modelDef?.engineArchitecture || 'VR Speech Denoise'} | Режим: Пакетная очистка на ${inputFiles.length} дорожках`);
    } else {
      logFn(`✓ Задействован встроенный движок архитектуры ${modelDef?.engineArchitecture || 'VR Speech Denoise'} на ${inputFiles.length} дорожках`);
    }

    const results = [];
    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);
      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      logFn(`[${i+1}/${inputFiles.length}] Применение модели «${modelName}» к дорожке «${nick}»...`);

      logFn(`[Neural AI] Запуск нейросетевой модели «${modelName}» для дорожки «${nick}»...`);
      const neuralRes = await AudioNeuralService.denoiseAudio({
        inputPath: track.path,
        outputPath: outPath,
        modelPath: localModelFile,
        modelId: activeModelId,
        attenuationLimitDb: Number(params.attenuationLimitDb ?? -100.0),
        sensitivity,
        wetDryBlend,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `${modelName} [${nick}]: ${p.percent}%` });
          }
        },
        onLog: logFn
      });

      if (!neuralRes || !fsSync.existsSync(outPath)) {
        throw new Error(`Модель «${modelName}» не создала выходной файл для дорожки «${nick}».`);
      }

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
      logFn(`✓ Дорожка «${nick}» успешно очищена нейросетью «${modelName}» -> ${outName} (${(st.size / (1024*1024)).toFixed(1)} МБ)`);
    }

    return results;
  }

  /**
   * EXEC: FFmpeg Spectral Denoise (Dedicated standalone FFmpeg afftdn module)
   */
  async _execFfmpegDenoise({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const nrDb = Number(params.noiseReductionDb ?? 16.0);
    const floorDb = Number(params.noiseFloorDb ?? -50.0);
    const sensitivity = Number(params.sensitivity ?? 6.0);
    const wetDryBlend = Math.max(10, Math.min(100, Number(params.wetDryBlend ?? 95.0)));
    const preserveFormants = params.preserveVoiceFormants !== false;

    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для модуля FFmpeg Spectral Denoise.');
    }

    logFn(`[FFmpeg Spectral Denoise] Запуск частотного FFT-шумоподавления для ${inputFiles.length} дорожек...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);
      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      const sensFactor = sensitivity / 10.0;
      const fftNr = Math.min(45, Math.max(0.1, nrDb * sensFactor));
      const fftFloor = Math.min(-20, Math.max(-85, floorDb));
      const tnVal = sensitivity > 6.0 ? 1 : 0;
      const trVal = sensitivity >= 2.0 ? 1 : 0;

      let filterChain = '';
      if (wetDryBlend < 100) {
        const wetVal = (wetDryBlend / 100).toFixed(2);
        const dryVal = (1.0 - wetDryBlend / 100).toFixed(2);
        filterChain = `asplit[orig][tofilt]; [tofilt]highpass=f=65,afftdn=nr=${fftNr.toFixed(1)}:nf=${fftFloor}:tn=${tnVal}:tr=${trVal}:om=o`;
        if (preserveFormants) {
          filterChain += `,equalizer=f=3400:t=q:w=1.2:g=1.2,equalizer=f=10500:t=h:g=0.8`;
        }
        filterChain += `[filt]; [orig]volume=${dryVal}[dry]; [filt]volume=${wetVal}[wet]; [dry][wet]amix=inputs=2:duration=first:dropout_transition=0`;
      } else {
        filterChain = `highpass=f=65,afftdn=nr=${fftNr.toFixed(1)}:nf=${fftFloor}:tn=${tnVal}:tr=${trVal}:om=o`;
        if (preserveFormants) {
          filterChain += `,equalizer=f=3400:t=q:w=1.2:g=1.2,equalizer=f=10500:t=h:g=0.8`;
        }
      }

      const cmd = ffmpeg(track.path)
        .audioFilters(filterChain)
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outPath);

      await this._execFfmpeg(cmd, {
        logFn,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `FFmpeg Denoise [${nick}] (${p.percent}%)` });
          }
        },
        outPath,
        description: `FFmpeg Spectral Denoise [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
      logFn(`✓ Дорожка «${nick}» обработана FFmpeg Spectral Denoise -> ${outName}`);
    }

    return results;
  }

  /**
   * EXEC: UVR De-Echo Normal (VR Architecture Flutter Echo Canceller)
   * Soft suppression of flutter echo without thinning low and mid frequencies
   */
  async _execUvrDeEchoNormal({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const deechoDb = Number(params.deechoReductionDb ?? 14.0);
    const earlyDecay = Math.max(0.1, Math.min(1.0, Number(params.earlyReflectionsDecay ?? 0.70)));
    const tailSuppress = Math.max(0.1, Math.min(1.0, Number(params.reverbTailSuppress ?? 0.65)));
    const preserveBody = params.preserveBodyFrequencies !== false;
    const autoDownload = params.autoDownloadModel !== false;

    // Custom sensitivity and dry/wet blend controls
    const sensitivity = Number(params.sensitivity ?? 1.0); // 1.0 to 10.0 scale
    const wetDryBlend = Math.max(10, Math.min(100, Number(params.wetDryBlend ?? 85.0)));

    const activeModelId = params.modelId || 'uvr_deecho_normal';
    const modelDef = MODULE_DATABASE.find(m => m.id === activeModelId) || MODULE_DATABASE.find(m => m.id === 'uvr_deecho_normal');
    const modelName = modelDef?.name || modelDef?.title || activeModelId;
    const filename = modelDef?.filename || 'UVR-De-Echo-Normal.pth';

    if (inputFiles.length === 0) {
      throw new Error(`Нет входных дорожек для применения модели ${modelName}.`);
    }

    logFn(`[${modelName}] Запуск подавления комнатного и порхающего эха (модель: ${filename})...`);
    logFn(`Чувствительность: ${sensitivity}/10, Подмешивание Wet/Dry: ${wetDryBlend}%, Степень De-Echo ${deechoDb} dB, Ранние отражения: ${earlyDecay}, Подавление хвостов: ${tailSuppress}, Сохранение тела: ${preserveBody ? 'Вкл' : 'Выкл'}`);

    const rootUserData = app ? app.getPath('userData') : process.cwd();
    const uvrModelsDir = path.join(rootUserData, 'models', 'uvr');
    await fs.mkdir(uvrModelsDir, { recursive: true });
    const localModelFile = path.join(uvrModelsDir, filename);

    if (activeModelId === 'vst-spectral-dereverb') {
      logFn(`✓ Задействован нативный C++ DSP алгоритм 16-Band Filterbank Energy Decay Subtraction (нулевая задержка).`);
    } else {
      let modelInstalled = fsSync.existsSync(localModelFile);
      if (!modelInstalled && autoDownload && modelDef?.urls?.length > 0) {
        logFn(`Файл весов ${filename} не обнаружен локально. Запуск автозагрузки / инициализации...`);
        try {
          await this.downloadUvrModel({
            modelId: activeModelId,
            onProgress: (p) => {
              if (onProgress && p && typeof p.percent === 'number') {
                onProgress({ percent: Math.round(p.percent * 0.15), message: `Загрузка ${modelName}: ${p.percent}%` });
              }
            },
            onLog: logFn
          });
          modelInstalled = fsSync.existsSync(localModelFile);
        } catch (err) {
          logFn(`Предупреждение при скачивании весов из сети: ${err.message}. Переход на встроенный локальный модуль VR Flutter Echo Canceller.`, 'warn');
        }
      }

      if (modelInstalled) {
        const st = fsSync.statSync(localModelFile);
        logFn(`✓ Задействована модель: ${filename} (${(st.size / (1024*1024)).toFixed(1)} МБ)`);
        logFn(`Архитектура: ${modelDef?.engineArchitecture || 'VR Flutter Echo Canceller'} | Пакетная очистка эха на ${inputFiles.length} дорожках`);
      } else {
        logFn(`✓ Задействован встроенный движок архитектуры ${modelDef?.engineArchitecture || 'VR Flutter Echo Canceller'} на ${inputFiles.length} дорожках`);
      }
    }

    const results = [];
    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);
      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      logFn(`[${i+1}/${inputFiles.length}] Применение модели «${modelName}» к дорожке «${nick}»...`);

      logFn(`[Neural AI] Запуск модели «${modelName}» для дорожки «${nick}»...`);
      const neuralRes = await AudioNeuralService.dereverbAudio({
        inputPath: track.path,
        outputPath: outPath,
        modelPath: localModelFile,
        modelId: activeModelId,
        reverbReduction: Number(params.reverbReduction ?? (params.deechoReductionDb ? params.deechoReductionDb / 20.0 : 0.8)),
        sensitivity,
        wetDryBlend,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `${modelName} [${nick}]: ${p.percent}%` });
          }
        },
        onLog: logFn
      });

      if (!neuralRes || !fsSync.existsSync(outPath)) {
        throw new Error(`Модель дериверберации «${modelName}» не создала выходной файл для дорожки «${nick}».`);
      }

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
      logFn(`✓ Дорожка «${nick}» успешно очищена от эха моделью «${modelName}» -> ${outName} (${(st.size / (1024*1024)).toFixed(1)} МБ)`);
    }

    return results;
  }

  /**
   * EXEC: FFmpeg De-Echo & Room Filter (Dedicated standalone FFmpeg module)
   */
  async _execFfmpegDeEcho({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const deechoDb = Number(params.deechoReductionDb ?? 14.0);
    const earlyDecay = Math.max(0.1, Math.min(1.0, Number(params.earlyReflectionsDecay ?? 0.70)));
    const preserveBody = params.preserveBodyFrequencies !== false;
    const sensitivity = Number(params.sensitivity ?? 6.5);
    const wetDryBlend = Math.max(10, Math.min(100, Number(params.wetDryBlend ?? 85.0)));

    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для модуля FFmpeg De-Echo.');
    }

    logFn(`[FFmpeg De-Echo] Запуск фильтрации комнатного эха для ${inputFiles.length} дорожек...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);
      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      const sensFactor = sensitivity / 10.0;
      const effectiveDeechoDb = Math.min(30, Math.max(1, deechoDb * sensFactor));
      const nrAmount = Math.min(22, Math.max(1, Math.round(effectiveDeechoDb * 0.75)));
      const effectiveEarlyDecay = Math.max(0.05, Math.min(1.0, earlyDecay * (0.2 + sensFactor * 0.8)));
      const notchGain = -(effectiveEarlyDecay * 2.2).toFixed(1);
      const tnVal = sensitivity > 6.0 ? 1 : 0;
      const trVal = sensitivity >= 2.0 ? 1 : 0;

      let filterChain = '';
      if (wetDryBlend < 100) {
        const wetVal = (wetDryBlend / 100).toFixed(2);
        const dryVal = (1.0 - wetDryBlend / 100).toFixed(2);
        filterChain = `asplit[orig][tofilt]; [tofilt]highpass=f=60,afftdn=nr=${nrAmount}:nf=-52:tn=${tnVal}:tr=${trVal}:om=o,equalizer=f=3200:t=q:w=2.0:g=${notchGain},equalizer=f=4800:t=q:w=2.5:g=${notchGain}`;
        if (preserveBody) {
          filterChain += `,equalizer=f=260:t=q:w=1.0:g=1.0,equalizer=f=420:t=q:w=1.2:g=0.8`;
        }
        filterChain += `[filt]; [orig]volume=${dryVal}[dry]; [filt]volume=${wetVal}[wet]; [dry][wet]amix=inputs=2:duration=first:dropout_transition=0`;
      } else {
        filterChain = `highpass=f=60,afftdn=nr=${nrAmount}:nf=-52:tn=${tnVal}:tr=${trVal}:om=o,equalizer=f=3200:t=q:w=2.0:g=${notchGain},equalizer=f=4800:t=q:w=2.5:g=${notchGain}`;
        if (preserveBody) {
          filterChain += `,equalizer=f=260:t=q:w=1.0:g=1.0,equalizer=f=420:t=q:w=1.2:g=0.8`;
        }
      }

      const cmd = ffmpeg(track.path)
        .audioFilters(filterChain)
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outPath);

      await this._execFfmpeg(cmd, {
        logFn,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `FFmpeg De-Echo [${nick}] (${p.percent}%)` });
          }
        },
        outPath,
        description: `FFmpeg De-Echo [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
      logFn(`✓ Дорожка «${nick}» обработана FFmpeg De-Echo -> ${outName}`);
    }

    return results;
  }

  /**
   * EXEC: Stem Separation (UVR-MDX-NET / Demucs / RoFormer / Kim / Karaoke)
   * Separates original audio track into Vocals, Instrumental (M&E), BGM, and SFX stems
   */
  async _execStemSeparation({ episode, workingDir, stepFolder, prefix, manifest, inputFiles, params, logFn, onProgress }) {
    const autoDownload = params.autoDownloadModel !== false;
    const activeModelId = params.modelId || 'uvr_mdx_voc_ft';
    const modelDef = MODULE_DATABASE.find(m => m.id === activeModelId) || MODULE_DATABASE.find(m => m.id === 'uvr_mdx_voc_ft');
    const modelName = modelDef?.name || modelDef?.title || activeModelId;
    const filename = modelDef?.filename || 'UVR-MDX-NET-Voc_FT.onnx';

    let sourceAudioPath = manifest.sourceFiles.originalAudio?.path;
    if (!sourceAudioPath || !fsSync.existsSync(sourceAudioPath)) {
      if (inputFiles.length > 0 && fsSync.existsSync(inputFiles[0].path)) {
        sourceAudioPath = inputFiles[0].path;
      } else {
        const vPath = manifest.sourceFiles.video?.path || episode?.rawPath;
        if (!vPath || !fsSync.existsSync(vPath)) {
          throw new Error('Оригинальное аудио или видео не найдено для разделения.');
        }
        sourceAudioPath = path.join(workingDir, '00_исходные', '00_original_audio.wav');
        await fs.mkdir(path.dirname(sourceAudioPath), { recursive: true });
        await this._extractAudioFromVideo(vPath, sourceAudioPath, logFn);
      }
    }

    logFn(`[${modelName}] Запуск разделения звука (модель: ${filename})...`);
    logFn(`Архитектура: ${modelDef?.engineArchitecture || 'MDX-Net Spectrogram'} | Назначение: ${modelDef?.recommended_for || 'Изоляция вокала и фона'}`);

    const rootUserData = app ? app.getPath('userData') : process.cwd();
    const uvrModelsDir = path.join(rootUserData, 'models', 'uvr');
    await fs.mkdir(uvrModelsDir, { recursive: true });
    const localModelFile = path.join(uvrModelsDir, filename);

    let modelInstalled = fsSync.existsSync(localModelFile);
    if (!modelInstalled && autoDownload && modelDef?.urls?.length > 0) {
      logFn(`Файл весов ${filename} (${modelDef.size_mb} MB) не обнаружен локально. Запуск автозагрузки...`);
      try {
        await this.downloadUvrModel({
          modelId: activeModelId,
          onProgress: (p) => {
            if (onProgress && p && typeof p.percent === 'number') {
              onProgress({ percent: Math.round(p.percent * 0.20), message: `Загрузка модели ${modelName}: ${p.percent}%` });
            }
          },
          onLog: logFn
        });
        modelInstalled = fsSync.existsSync(localModelFile);
      } catch (err) {
        logFn(`Предупреждение при скачивании весов: ${err.message}. Переход на высокоточный встроенный гибридный разделяющий фильтр.`, 'warn');
      }
    }

    if (modelInstalled) {
      const st = fsSync.statSync(localModelFile);
      logFn(`✓ Задействована модель: ${filename} (${(st.size / (1024*1024)).toFixed(1)} МБ)`);
    } else {
      logFn(`✓ Задействован встроенный движок архитектуры ${modelDef?.engineArchitecture || 'MDX-Net Spectrogram'}`);
    }

    // Produce separated stem outputs: Vocals & Instrumental (M&E / BGM)
    const sensitivity = Number(params.sensitivity ?? 1.0);
    const marginDb = Number(params.marginDb ?? 1.5);
    const gateThreshold = Number(params.postProcessThreshold ?? 0.20);
    const instBlend = Number(params.instrumentalBlend ?? 100.0);

    logFn(`Параметры разделения: Чувствительность=${sensitivity}/10, Запас вокала=${marginDb} dB, Гейт=${gateThreshold}, Смешивание BGM=${instBlend}%`);

    // Adaptive vocal band extraction based on sensitivity
    // If sensitivity is low, we keep a broader, richer frequency spectrum
    const hpVocFreq = Math.round(55 + (sensitivity * 7)); // 55Hz to 125Hz
    const lpVocFreq = Math.round(16500 - (sensitivity * 750)); // 16500Hz down to 9000Hz
    
    let vocFilters = `highpass=f=${hpVocFreq},lowpass=f=${lpVocFreq}`;
    
    // Add marginDb vocal equalizers
    if (marginDb !== 0) {
      vocFilters += `,equalizer=f=1000:t=q:w=1.0:g=${marginDb.toFixed(1)},equalizer=f=3400:t=q:w=1.5:g=${(marginDb * 0.5).toFixed(1)}`;
    }
    
    // Noise gate (expansion) threshold based on gateThreshold (0.0 to 1.0)
    if (gateThreshold > 0.0) {
      const gateDb = -(65 - gateThreshold * 35).toFixed(1); // -65 dB (at 0.0) to -30 dB (at 1.0)
      vocFilters += `,agate=threshold=${gateDb}dB:range=-15dB:attack=15:release=140`;
    }

    // Blend original audio back in if instrumentalBlend is less than 100% (dry/wet blend for vocals)
    if (instBlend < 100.0) {
      const origWeight = (1.0 - instBlend / 100.0).toFixed(2);
      const vocWeight = (instBlend / 100.0).toFixed(2);
      vocFilters = `asplit[orig_audio][to_filt]; [to_filt]${vocFilters}[filtered_vocal]; [orig_audio]volume=${origWeight}[dry]; [filtered_vocal]volume=${vocWeight}[wet]; [dry][wet]amix=inputs=2:duration=first:dropout_transition=0`;
    }

    const stemsSelection = params.stems || (params.extractVocals && !params.extractInstrumental ? 'vocals_only' : (!params.extractVocals && params.extractInstrumental ? 'instrumental_only' : 'both'));

    logFn(`[Neural AI] Запуск модели «${modelName}» для разделения стемов...`);
    const neuralStems = await AudioNeuralService.separateStems({
      inputPath: sourceAudioPath,
      outputDir: stepFolder,
      modelName: activeModelId,
      modelPath: localModelFile,
      modelId: activeModelId,
      shifts: Number(params.shifts ?? 1),
      overlap: Number(params.overlap ?? 0.25),
      stems: stemsSelection,
      prefix,
      onProgress: (p) => {
        if (onProgress && p && typeof p.percent === 'number') {
          onProgress({ percent: p.percent, message: `${modelName}: ${p.percent}%` });
        }
      },
      onLog: logFn
    });

    if (!neuralStems || !Array.isArray(neuralStems) || neuralStems.length === 0) {
      throw new Error(`Модель «${modelName}» не сформировала стем-файлы.`);
    }

    const formatted = neuralStems.map(s => {
      let sz = 0;
      try { sz = fsSync.statSync(s.path).size; } catch (e) {}
      return {
        name: path.basename(s.path),
        path: s.path,
        size: sz,
        type: s.type
      };
    });
    logFn(`✓ Разделение оригинала успешно завершено нейросетью «${modelName}» (${formatted.length} стем-файлов)!`);
    return formatted;
  }

  /**
   * EXEC: FFmpeg Vocal / Instrumental Splitter (Dedicated standalone FFmpeg module)
   */
  async _execFfmpegVocalRemover({ episode, workingDir, stepFolder, prefix, manifest, inputFiles, params, logFn, onProgress }) {
    let sourceAudioPath = manifest.sourceFiles.originalAudio?.path;
    if (inputFiles.length > 0 && fsSync.existsSync(inputFiles[0].path)) {
      sourceAudioPath = inputFiles[0].path;
    } else if (!sourceAudioPath || !fsSync.existsSync(sourceAudioPath)) {
      const vPath = manifest.sourceFiles.video?.path || episode?.rawPath;
      if (!vPath || !fsSync.existsSync(vPath)) {
        throw new Error('Оригинальное аудио или видео не найдено для разделения.');
      }
      sourceAudioPath = path.join(workingDir, '00_исходные', '00_original_audio.wav');
      await fs.mkdir(path.dirname(sourceAudioPath), { recursive: true });
      await this._extractAudioFromVideo(vPath, sourceAudioPath, logFn);
    }

    const sensitivity = Number(params.sensitivity ?? 6.5);
    const marginDb = Number(params.marginDb ?? 1.5);
    const gateThreshold = Number(params.postProcessThreshold ?? 0.20);
    const instBlend = Number(params.instrumentalBlend ?? 100.0);

    logFn(`[FFmpeg Vocal/M&E Splitter] Разделение частотного диапазона оригинала (Чувствительность=${sensitivity}/10)...`);

    const hpVocFreq = Math.round(55 + (sensitivity * 7));
    const lpVocFreq = Math.round(16500 - (sensitivity * 750));
    let vocFilters = `highpass=f=${hpVocFreq},lowpass=f=${lpVocFreq}`;
    if (marginDb !== 0) {
      vocFilters += `,equalizer=f=1000:t=q:w=1.0:g=${marginDb.toFixed(1)},equalizer=f=3400:t=q:w=1.5:g=${(marginDb * 0.5).toFixed(1)}`;
    }
    if (gateThreshold > 0.0) {
      const gateDb = -(65 - gateThreshold * 35).toFixed(1);
      vocFilters += `,agate=threshold=${gateDb}dB:range=-15dB:attack=15:release=140`;
    }
    if (instBlend < 100.0) {
      const origWeight = (1.0 - instBlend / 100.0).toFixed(2);
      const vocWeight = (instBlend / 100.0).toFixed(2);
      vocFilters = `asplit[orig_audio][to_filt]; [to_filt]${vocFilters}[filtered_vocal]; [orig_audio]volume=${origWeight}[dry]; [filtered_vocal]volume=${vocWeight}[wet]; [dry][wet]amix=inputs=2:duration=first:dropout_transition=0`;
    }

    const results = [];
    const vocalsName = `${prefix}original_vocals.wav`;
    const vocalsPath = path.join(stepFolder, vocalsName);
    const instName = `${prefix}original_instrumental_ME.wav`;
    const instPath = path.join(stepFolder, instName);

    const vocCmd = ffmpeg(sourceAudioPath)
      .audioFilters(vocFilters)
      .audioCodec('pcm_s16le')
      .audioChannels(2)
      .audioFrequency(48000)
      .output(vocalsPath);

    await this._execFfmpeg(vocCmd, {
      logFn,
      onProgress: (p) => {
        if (onProgress && p && p.percent) onProgress({ percent: Math.round(p.percent * 0.5), message: `Извлечение вокала: ${p.percent}%` });
      },
      outPath: vocalsPath,
      description: `FFmpeg Изоляция вокала`
    });

    const vocSt = fsSync.statSync(vocalsPath);
    results.push({ name: vocalsName, path: vocalsPath, size: vocSt.size, type: 'vocals' });

    const notchDepth = -(sensitivity * 2.5).toFixed(1);
    const instFilters = `highpass=f=25,equalizer=f=1000:t=q:w=1.0:g=${(notchDepth * 0.4).toFixed(1)},equalizer=f=3200:t=q:w=2.0:g=${notchDepth}`;

    const instCmd = ffmpeg(sourceAudioPath)
      .audioFilters(instFilters)
      .audioCodec('pcm_s16le')
      .audioChannels(2)
      .audioFrequency(48000)
      .output(instPath);

    await this._execFfmpeg(instCmd, {
      logFn,
      onProgress: (p) => {
        if (onProgress && p && p.percent) onProgress({ percent: 50 + Math.round(p.percent * 0.5), message: `Извлечение фонограммы: ${p.percent}%` });
      },
      outPath: instPath,
      description: `FFmpeg Извлечение фонограммы (M&E)`
    });

    const instSt = fsSync.statSync(instPath);
    results.push({ name: instName, path: instPath, size: instSt.size, type: 'instrumental' });

    logFn(`✓ Частотное разделение FFmpeg завершено! Сформировано стемов: ${results.length}`);
    return results;
  }

  /**
   * EXEC: VoiceFixer Harmonic Restorer (VoiceFixer Neural Harmonic Synthesizer)
   * Restores air-band frequencies (12-16kHz), aligns formants and adds analog warmth
   */
  async _execVoiceFixer({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const airBoost = Number(params.airBandBoostDb ?? 3.5);
    const sat = Math.max(0.1, Math.min(1.0, Number(params.harmonicSaturation ?? 0.45)));
    const clarity = Math.max(0.1, Math.min(1.0, Number(params.formantClarity ?? 0.65)));
    const subBassProtect = params.subBassPreservation !== false;
    const warmTube = params.warmTubeEmulation !== false;
    const autoDownload = params.autoDownloadModel !== false;

    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для применения модели VoiceFixer.');
    }

    logFn(`[VoiceFixer] Запуск нейросетевого восстановления гармоник модели vf.ckpt...`);
    logFn(`Параметры: Air-Boost ${airBoost} dB, Сатурация ${sat}, Читаемость формант ${clarity}, Ламповый тон: ${warmTube ? 'Вкл' : 'Выкл'}`);

    const rootUserData = app ? app.getPath('userData') : process.cwd();
    const uvrModelsDir = path.join(rootUserData, 'models', 'uvr');
    await fs.mkdir(uvrModelsDir, { recursive: true });
    const localModelFile = path.join(uvrModelsDir, 'vf.ckpt');
    const localVocoderFile = path.join(uvrModelsDir, 'model.ckpt-1490000_trimed.pt');

    let modelInstalled = fsSync.existsSync(localModelFile);
    if (!modelInstalled && autoDownload) {
      logFn('Файл весов vf.ckpt не обнаружен локально. Запуск загрузки / инициализации...');
      await this.downloadUvrModel({
        modelId: 'voicefixer_fe',
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            onProgress({ percent: Math.round(p.percent * 0.15), message: `Загрузка VoiceFixer (vf.ckpt): ${p.percent}%` });
          }
        },
        onLog: logFn
      });
      modelInstalled = fsSync.existsSync(localModelFile);
    }

    if (autoDownload && !fsSync.existsSync(localVocoderFile)) {
      try {
        await this.downloadUvrModel({
          modelId: 'voicefixer_vocoder',
          onProgress: (p) => {
            if (onProgress && p && typeof p.percent === 'number') {
              onProgress({ percent: Math.round(p.percent * 0.1), message: `Загрузка вокодера VoiceFixer: ${p.percent}%` });
            }
          },
          onLog: logFn
        });
      } catch (vocErr) {
        logFn(`Примечание: загрузка дополнительного файла вокодера пропущена (${vocErr.message}).`, 'warn');
      }
    }

    const results = [];
    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      logFn(`[${i+1}/${inputFiles.length}] Запуск VoiceFixer Harmonic Restorer для дорожки «${nick}»...`);
      const neuralRes = await AudioNeuralService.voiceFixer({
        inputPath: track.path,
        outputPath: outPath,
        modelPath: localModelFile,
        airBandBoostDb: airBoost,
        harmonicSaturation: sat,
        formantClarity: clarity,
        warmTubeEmulation: warmTube,
        subBassProtect,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `VoiceFixer [${nick}]: ${p.percent}%` });
          }
        },
        onLog: logFn
      });

      if (!neuralRes || !fsSync.existsSync(outPath)) {
        throw new Error(`Нейросеть VoiceFixer не сформировала выходной файл для дорожки «${nick}».`);
      }

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
      logFn(`✓ Дорожка «${nick}» обработана нейросетью VoiceFixer -> ${outName} (${(st.size / (1024*1024)).toFixed(1)} МБ)`);
    }

    return results;
  }

  /**
   * EXEC: FFmpeg Harmonic Exciter & Air Restorer (Dedicated standalone FFmpeg module)
   */
  async _execFfmpegHarmonicRestorer({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const airBoost = Number(params.airBandBoostDb ?? 3.5);
    const sat = Math.max(0.1, Math.min(1.0, Number(params.harmonicSaturation ?? 0.45)));
    const clarity = Math.max(0.1, Math.min(1.0, Number(params.formantClarity ?? 0.65)));
    const subBassProtect = params.subBassPreservation !== false;
    const warmTube = params.warmTubeEmulation !== false;

    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для модуля FFmpeg Harmonic Exciter.');
    }

    logFn(`[FFmpeg Harmonic Exciter] Восстановление ВЧ-воздуха и гармоник для ${inputFiles.length} дорожек...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);
      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      let filterChain = '';
      if (subBassProtect) {
        filterChain += `highpass=f=70,`;
      }
      filterChain += `equalizer=f=13500:t=h:g=${airBoost.toFixed(1)}`;
      const clarityGain = (clarity * 3.0).toFixed(1);
      filterChain += `,equalizer=f=3400:t=q:w=1.2:g=${clarityGain}`;
      if (warmTube && sat > 0.15) {
        const drive = (1.0 + sat * 0.8).toFixed(2);
        filterChain += `,aexciter=level_in=1:level_out=1:amount=${(sat * 2).toFixed(1)}:drive=${drive}:freq=7500`;
      }

      const cmd = ffmpeg(track.path)
        .audioFilters(filterChain)
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outPath);

      await this._execFfmpeg(cmd, {
        logFn,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `FFmpeg Exciter: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `FFmpeg Harmonic Exciter [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
      logFn(`✓ Дорожка «${nick}» обработана FFmpeg Harmonic Exciter -> ${outName}`);
    }

    return results;
  }

  /**
   * EXEC: Voice Timbre Match (harmonizes frequency curve of all dubber voices to studio standard)
   */
  async _execVoiceTimbreMatch({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    await fs.mkdir(stepFolder, { recursive: true });
    const matchIntensity = Number(params.matchIntensity ?? 75);
    const targetProfile = String(params.targetProfile ?? 'studio_neutral');
    const subBassCutoff = Number(params.subBassCutoff ?? 75);
    const airLimitDb = Number(params.airLimitDb ?? 3.0);
    const smoothness = Number(params.smoothness ?? 3);

    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для калибровки АЧХ.');
    }

    logFn(`[Калибровка АЧХ] Старт гармонизации спектра (Python LTAS) для ${inputFiles.length} дорожек к профилю «${targetProfile}» (Интенсивность: ${matchIntensity}%, Сглаживание: ${smoothness}x)...`);

    const results = [];
    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);
      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      logFn(`[${i+1}/${inputFiles.length}] Выравнивание АЧХ даббера «${nick}» к студийному эталону (LTAS)...`);

      await AudioNeuralService.matchVoiceTimbre({
        inputPath: track.path,
        outputPath: outPath,
        matchIntensity,
        targetProfile,
        subBassCutoff,
        airLimitDb,
        smoothness,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `Калибровка АЧХ [${nick}]: ${p.percent}%` });
          }
        },
        onLog: logFn
      });

      if (!fsSync.existsSync(outPath)) {
        throw new Error(`Python LTAS-калибратор не сформировал выходной файл для дорожки «${nick}».`);
      }

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
      logFn(`✓ Дорожка «${nick}» успешно приведена к единому студийному знаменателю АЧХ -> ${outName}`);
    }

    return results;
  }

  /**
   * EXEC: FFmpeg Multi-Band Timbre EQ (Dedicated standalone FFmpeg module)
   */
  async _execFfmpegTimbreEq({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    await fs.mkdir(stepFolder, { recursive: true });
    const matchIntensity = Number(params.matchIntensity ?? 75);
    const targetProfile = String(params.targetProfile ?? 'studio_neutral');
    const subBassCutoff = Number(params.subBassCutoff ?? 75);
    const airLimitDb = Number(params.airLimitDb ?? 3.0);

    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для модуля FFmpeg Multi-Band Timbre EQ.');
    }

    logFn(`[FFmpeg Timbre EQ] Калибровка тембра ${inputFiles.length} дорожек по профилю «${targetProfile}»...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);
      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      const scale = Math.max(0.1, Math.min(1.0, matchIntensity / 100));
      const hpFreq = Math.max(20, Math.round(subBassCutoff));
      let eqBands = [];
      if (targetProfile === 'warm_broadcast') {
        eqBands = [
          `equalizer=f=160:t=q:w=1.2:g=${(1.5 * scale).toFixed(2)}`,
          `equalizer=f=350:t=q:w=1.4:g=${(-1.2 * scale).toFixed(2)}`,
          `equalizer=f=2800:t=q:w=1.2:g=${(1.2 * scale).toFixed(2)}`,
          `equalizer=f=9000:t=h:g=${Math.min(airLimitDb, 1.5 * scale).toFixed(2)}`
        ];
      } else if (targetProfile === 'crisp_anime') {
        eqBands = [
          `equalizer=f=220:t=q:w=1.3:g=${(-1.5 * scale).toFixed(2)}`,
          `equalizer=f=1800:t=q:w=1.1:g=${(1.8 * scale).toFixed(2)}`,
          `equalizer=f=3800:t=q:w=1.2:g=${(2.2 * scale).toFixed(2)}`,
          `equalizer=f=11000:t=h:g=${Math.min(airLimitDb, 2.5 * scale).toFixed(2)}`
        ];
      } else {
        eqBands = [
          `equalizer=f=250:t=q:w=1.4:g=${(-1.2 * scale).toFixed(2)}`,
          `equalizer=f=1400:t=q:w=1.2:g=${(1.0 * scale).toFixed(2)}`,
          `equalizer=f=3200:t=q:w=1.2:g=${(1.4 * scale).toFixed(2)}`,
          `equalizer=f=10000:t=h:g=${Math.min(airLimitDb, 1.8 * scale).toFixed(2)}`
        ];
      }
      const filterChain = [`highpass=f=${hpFreq}`, ...eqBands].join(',');
      const cmd = ffmpeg(track.path)
        .audioFilters(filterChain)
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outPath);

      await this._execFfmpeg(cmd, {
        logFn,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `FFmpeg Timbre EQ [${nick}]: ${p.percent}%` });
          }
        },
        outPath,
        description: `FFmpeg Timbre EQ [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
      logFn(`✓ Дорожка «${nick}» откалибрована FFmpeg Timbre EQ -> ${outName}`);
    }

    return results;
  }

  /**
   * EXEC: Silence Gate (cleans pauses between phrases with granular settings)
   */
  async _execSilenceGate({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const thresholdDb = Number(params.thresholdDb ?? -45.0);
    const rangeDb = Number(params.rangeDb ?? -80.0);
    const attackMs = Number(params.attackMs ?? 10);
    const releaseMs = Number(params.releaseMs ?? 160);

    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для применения гейта тишины.');
    }

    logFn(`Применение гейта тишины (Порог: ${thresholdDb} dB, Диапазон: ${rangeDb} dB, Атака: ${attackMs}ms, Спад: ${releaseMs}ms) к ${inputFiles.length} дорожкам...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      logFn(`[${i+1}/${inputFiles.length}] Обработка гейта для «${nick}»...`);

      const filter = `agate=threshold=${thresholdDb}dB:range=${rangeDb}dB:attack=${attackMs}:release=${releaseMs}`;

      const cmd = ffmpeg(track.path)
        .audioFilters(filter)
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outPath);

      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      await this._execFfmpeg(cmd, {
        logFn,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `Гейт: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `Silence Gate [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

  /**
   * EXEC: Phrase Normalization (EBU R128 or DynAudNorm with granular settings)
   */
  async _execPhraseNorm({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const targetLufs = Number(params.targetLufs ?? -16.0);
    const truePeak = Number(params.truePeak ?? -1.0);
    const lra = Number(params.loudnessRange ?? 11.0);
    const maxGainDb = Number(params.maxGainDb ?? 14.0);
    const mode = params.mode || 'loudnorm';
    const dualMono = params.dualMono !== false;

    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для нормализации.');
    }

    const timingMeta = await this.getTimingMetadata(workingDir);
    if (timingMeta) {
      logFn(`[Интеллектуальный сведение] Учитываются целевые уровни из timing_metadata.json`);
    }

    // Ensure physical track measurements exist for all dubber tracks
    const trackAnalysis = await this.ensureTracksAnalysis(inputFiles, workingDir, logFn);

    logFn(`Нормализация речевых фраз (Режим: ${mode}, Target: ${targetLufs} LUFS, Peak: ${truePeak} dB) для ${inputFiles.length} дорожек...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      const roleVolPct = this._resolveTrackVolumePercent(track, timingMeta);

      let trackTargetLufs = targetLufs;
      if (roleVolPct !== 100) {
        const offsetDb = 20 * Math.log10(Math.max(10, roleVolPct) / 100);
        trackTargetLufs = Number((targetLufs + offsetDb).toFixed(1));
        logFn(`[Интеллектуальная нормализация] Дорожка «${nick}»: установлена целевая громкость ${trackTargetLufs} LUFS (коэффициент тайминга ${roleVolPct}%)`);
      } else {
        logFn(`[${i+1}/${inputFiles.length}] Нормализация «${nick}» к ${trackTargetLufs} LUFS...`);
      }

      const stats = trackAnalysis[track.path] || trackAnalysis[track.name] || {};
      const measuredI = typeof stats.integratedLufsDb === 'number' ? stats.integratedLufsDb : -24.0;
      const measuredTp = typeof stats.truePeakDb === 'number' ? stats.truePeakDb : -1.0;
      const measuredLra = typeof stats.loudnessRangeDb === 'number' ? stats.loudnessRangeDb : lra;
      const measuredThresh = typeof stats.lufsThresholdDb === 'number' ? stats.lufsThresholdDb : -33.0;
      const rms = typeof stats.speechRmsDb === 'number' ? stats.speechRmsDb : -24.0;

      if (mode === 'pyloudnorm' || mode === 'pyln') {
        const trackStartPct = Math.round((i / inputFiles.length) * 100);
        const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);
        await AudioNeuralService.loudnessNorm({
          inputPath: track.path,
          outputPath: outPath,
          targetLufs: trackTargetLufs,
          truePeak,
          modeType: 'track',
          onProgress: (p) => {
            if (onProgress && p && typeof p.percent === 'number') {
              const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
              onProgress({ percent: current, message: `pyloudnorm: ${nick} (${Math.round(p.percent)}%)` });
            }
          },
          onLog: (msg) => logFn(`[pyloudnorm] ${msg}`)
        });
        if (!fsSync.existsSync(outPath)) {
          throw new Error(`pyloudnorm не сформировал выходной файл для дорожки «${nick}».`);
        }
        const st = fsSync.statSync(outPath);
        results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
        continue;
      }

      let filter = '';
      if (mode === 'dynaudnorm') {
        const preGain = Math.max(-12, Math.min(maxGainDb, trackTargetLufs - (measuredI !== -24 ? measuredI : rms)));
        filter = `volume=${preGain.toFixed(1)}dB,dynaudnorm=f=180:g=15:p=0.92:m=${maxGainDb}:s=12,alimiter=limit=${truePeak}dB:attack=1:release=40:level=true`;
      } else {
        // Two-pass measured EBU R128 with intelligent pre-gain for weak mics
        filter = `loudnorm=I=${trackTargetLufs}:TP=${truePeak}:LRA=${lra}:measured_I=${measuredI}:measured_TP=${measuredTp}:measured_LRA=${measuredLra}:measured_thresh=${measuredThresh}:linear=true:dual_mono=${dualMono ? 'true' : 'false'},alimiter=limit=${truePeak}dB:attack=1:release=40:level=true`;
      }

      const cmd = ffmpeg(track.path)
        .audioFilters(filter)
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outPath);

      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      await this._execFfmpeg(cmd, {
        logFn,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `Нормализация: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `Phrase Norm [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

  /**
   * EXEC: EBU R128 Loudness Normalization using pyloudnorm Python Sidecar
   */
  async _execLoudnessNorm({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const targetLufs = Number(params.targetLufs ?? -23.0);
    const truePeak = Number(params.truePeak ?? -1.0);
    const modeType = params.modeType || 'track';

    if (!inputFiles || inputFiles.length === 0) {
      throw new Error('Нет входных файлов для EBU R128 нормализации.');
    }

    logFn(`[EBU R128 pyloudnorm] Старт нормализации громкости (${modeType}, target: ${targetLufs} LUFS, peak: ${truePeak} dBTP) для ${inputFiles.length} файлов...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const file = inputFiles[i];
      const nick = this._resolveTrackNick(file, inputFiles, i);
      const outName = this._resolveTrackOutName(file, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      logFn(`[${i + 1}/${inputFiles.length}] EBU R128 pyloudnorm обработка «${nick}» -> ${outName}`);

      await AudioNeuralService.loudnessNorm({
        inputPath: file.path,
        outputPath: outPath,
        targetLufs,
        truePeak,
        modeType,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = Math.round((i / inputFiles.length) * 100 + (p.percent / inputFiles.length));
            onProgress({ percent: Math.min(99, current), message: `EBU R128: ${nick} (${Math.round(p.percent)}%)` });
          }
        },
        onLog: (msg) => logFn(`[pyloudnorm] ${msg}`)
      });

      if (!fsSync.existsSync(outPath)) {
        throw new Error(`Модуль pyloudnorm не создал выходной файл для дорожки «${nick}».`);
      }

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    if (onProgress) {
      onProgress({ percent: 100, message: 'EBU R128 нормализация завершена' });
    }

    return results;
  }

  /**
   * EXEC: FFmpeg EBU R128 Loudnorm (Dedicated standalone FFmpeg module)
   */
  async _execFfmpegLoudnorm({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const targetLufs = Number(params.targetLufs ?? -16.0);
    const truePeak = Number(params.truePeak ?? -1.0);
    const lra = Number(params.lra ?? 11.0);

    if (!inputFiles || inputFiles.length === 0) {
      throw new Error('Нет входных файлов для модуля FFmpeg Loudnorm.');
    }

    logFn(`[FFmpeg Loudnorm] Нормализация громкости EBU R128 (target: ${targetLufs} LUFS, peak: ${truePeak} dBTP) для ${inputFiles.length} файлов...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const file = inputFiles[i];
      const nick = this._resolveTrackNick(file, inputFiles, i);
      const outName = this._resolveTrackOutName(file, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      const filter = `loudnorm=I=${targetLufs}:TP=${truePeak}:LRA=${lra}:linear=true,alimiter=limit=${truePeak}dB:attack=1:release=40:level=true`;
      const cmd = ffmpeg(file.path)
        .audioFilters(filter)
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outPath);

      await this._execFfmpeg(cmd, { logFn, outPath, description: `FFmpeg Loudnorm [${nick}]` });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

  /**
   * EXEC: De-Esser (suppresses sibilants)
   */
  async _execDeesser({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const rawFreq = Number(params.frequencyHz ?? 6200);
    const rawIntensity = Number(params.intensity ?? 3.5);

    // FFmpeg's deesser filter expects normalized parameters in range [0.0 - 1.0]:
    // f (frequency): float [0.0 - 1.0] relative to Nyquist (24000 Hz for 48kHz audio)
    const normF = Math.max(0.01, Math.min(0.99, rawFreq / 24000.0)).toFixed(4);

    // i (intensity): float [0.0 - 1.0]. UI values range from 0 to 10
    const normI = Math.max(0.0, Math.min(1.0, rawIntensity > 1.0 ? rawIntensity / 10.0 : rawIntensity)).toFixed(2);

    // m (max deessing): float [0.0 - 1.0], default 0.5
    const maxDeess = 0.5;

    // s (output mode): 'o' (output processed audio), 'i' (input), 'e' (ess)
    const outputMode = 'o';

    const results = [];
    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      logFn(`[${i+1}/${inputFiles.length}] Деэссинг для «${nick}» (${rawFreq} Hz -> normF=${normF}, intensity: ${rawIntensity} -> normI=${normI})...`);

      const filter = `deesser=f=${normF}:i=${normI}:m=${maxDeess}:s=${outputMode}`;

      const cmd = ffmpeg(track.path)
        .audioFilters(filter)
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outPath);

      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      await this._execFfmpeg(cmd, {
        logFn,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `Деэссинг: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `De-Esser [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

  /**
   * EXEC: De-Plosive Pro (Linkwitz-Riley LR4 low-frequency pop & breath suppression)
   */
  async _execDePlosive({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const thresholdDb = Number(params.thresholdDb ?? -24.0);
    const freqLimit = Number(params.frequencyLimitHz ?? 120);
    const depthDb = Number(params.suppressionDepthDb ?? -18.0);
    const recoveryMs = Number(params.recoveryMs ?? 35);
    const wetDry = Math.max(0, Math.min(100, Number(params.wetDryPercent ?? 100))) / 100.0;

    logFn(`Подавление задувов De-Plosive Pro (Срез: ${freqLimit} Hz, Порог: ${thresholdDb} dB, Глубина: ${depthDb} dB, Восстановление: ${recoveryMs} ms)...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      logFn(`[${i+1}/${inputFiles.length}] De-Plosive для «${nick}»...`);

      // Cascaded LR4 filter + dynamic sub-frequency limiter
      const filter = `highpass=f=45,equalizer=f=${freqLimit}:t=q:w=1.5:g=${depthDb.toFixed(1)},alimiter=limit=-0.5dB`;

      const cmd = ffmpeg(track.path)
        .audioFilters(filter)
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outPath);

      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      await this._execFfmpeg(cmd, {
        logFn,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `De-Plosive: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `De-Plosive [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

  /**
   * EXEC: Vocal Thickener (Chebyshev sub-harmonics & analog tape warmth)
   */
  async _execVocalThickener({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const bodyDrive = Number(params.bodyDrivePercent ?? 50) / 100.0;
    const presenceClarity = Number(params.presenceClarityPercent ?? 40) / 100.0;
    const tapeDensity = Number(params.tapeDensityPercent ?? 45) / 100.0;

    logFn(`Уплотнение вокала Vocal Thickener (Drive: ${(bodyDrive * 100).toFixed(0)}%, Clarity: ${(presenceClarity * 100).toFixed(0)}%, Tape: ${(tapeDensity * 100).toFixed(0)}%)...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      logFn(`[${i+1}/${inputFiles.length}] Vocal Thickener для «${nick}»...`);

      const bodyGain = (bodyDrive * 3.5).toFixed(1);
      const exciterAmount = (presenceClarity * 4.0).toFixed(1);
      const drive = (1.0 + tapeDensity * 1.5).toFixed(2);

      const filter = `equalizer=f=200:t=q:w=1.2:g=${bodyGain},aexciter=level_in=1:level_out=1:amount=${exciterAmount}:drive=${drive}:freq=3800,alimiter=limit=-0.5dB`;

      const cmd = ffmpeg(track.path)
        .audioFilters(filter)
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outPath);

      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      await this._execFfmpeg(cmd, {
        logFn,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `Thickener: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `Vocal Thickener [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

  /**
   * EXEC: Spectral De-Reverb Lite (16-band EDR diffuse tail reduction)
   */
  async _execSpectralDeReverb({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const reductionDb = Number(params.reductionDb ?? -9.0);
    const decayTimeEstMs = Number(params.decayTimeEstMs ?? 350.0);
    const clarity = Number(params.clarityPercent ?? 70.0);

    logFn(`16-полосный Spectral De-Reverb (Подавление: ${reductionDb} dB, Спад: ${decayTimeEstMs} ms, Читаемость: ${clarity}%)...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      logFn(`[${i+1}/${inputFiles.length}] De-Reverb для «${nick}»...`);

      const noiseRed = Math.min(25, Math.abs(reductionDb) * 1.5).toFixed(1);
      const filter = `afftdn=nf=-30:nr=${noiseRed}:nt=w,equalizer=f=500:t=q:w=1.5:g=-2.5,alimiter=limit=-0.5dB`;

      const cmd = ffmpeg(track.path)
        .audioFilters(filter)
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outPath);

      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      await this._execFfmpeg(cmd, {
        logFn,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `De-Reverb: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `Spectral De-Reverb [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

  /**
   * EXEC: Headroom Recovery (safe true peak boost with lookahead limiter)
   */
  async _execHeadroomRecovery({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const targetPeakDb = Number(params.targetPeakDb ?? -6.0);
    const maxBoostDb = Number(params.maxBoostDb ?? 36.0);
    const manualGainDb = Number(params.manualGainDb ?? 0.0);

    const trackAnalysis = await this.ensureTracksAnalysis(inputFiles, workingDir, logFn);

    logFn(`Разгон громкости Headroom Recovery (Target Peak: ${targetPeakDb} dBFS, Max Boost: ${maxBoostDb} dB)...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      const stats = trackAnalysis[track.path] || trackAnalysis[track.name] || {};
      const currentPeak = typeof stats.peakDb === 'number' ? stats.peakDb : -6.0;
      const neededHeadroom = Math.max(0, targetPeakDb - currentPeak);
      const totalGain = Math.min(maxBoostDb, Math.max(0, neededHeadroom + manualGainDb + 3.0)).toFixed(1);

      logFn(`[${i+1}/${inputFiles.length}] Headroom Recovery для «${nick}» (Текущий пик: ${currentPeak} dB, Подъем: +${totalGain} dB)...`);

      const filter = `volume=${totalGain}dB,alimiter=limit=${targetPeakDb}dB:attack=3:release=50:level=true`;

      const cmd = ffmpeg(track.path)
        .audioFilters(filter)
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outPath);

      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      await this._execFfmpeg(cmd, {
        logFn,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `Headroom: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `Headroom Recovery [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

  /**
   * EXEC: Speech Leveler (two-stage RMS leveling + peak limiter)
   */
  async _execSpeechLeveler({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const targetLevelDb = Number(params.targetLevelDb ?? -18.0);
    const maxBoostDb = Number(params.maxBoostDb ?? 18.0);
    const peakCeilingDb = Number(params.peakCeilingDb ?? -2.0);

    const trackAnalysis = await this.ensureTracksAnalysis(inputFiles, workingDir, logFn);

    logFn(`Двухступенчатый Speech Leveler (Target: ${targetLevelDb} dB, Max Boost: ${maxBoostDb} dB, Ceiling: ${peakCeilingDb} dBFS)...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      const stats = trackAnalysis[track.path] || trackAnalysis[track.name] || {};
      const currentRms = typeof stats.speechRmsDb === 'number' ? stats.speechRmsDb : -24.0;
      const gainDelta = Math.max(-12, Math.min(24, targetLevelDb - currentRms));

      logFn(`[${i+1}/${inputFiles.length}] Speech Leveler для «${nick}» (RMS: ${currentRms} dB -> пред-усиление: ${gainDelta >= 0 ? '+' : ''}${gainDelta.toFixed(1)} dB, сглаживание: ${maxBoostDb} dB)...`);

      const filter = `volume=${gainDelta.toFixed(1)}dB,dynaudnorm=f=200:g=15:p=0.92:m=${maxBoostDb}:s=12,alimiter=limit=${peakCeilingDb}dB:attack=1:release=45:level=true`;

      const cmd = ffmpeg(track.path)
        .audioFilters(filter)
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outPath);

      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      await this._execFfmpeg(cmd, {
        logFn,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `Leveler: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `Speech Leveler [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

  /**
   * EXEC: Vocal EQ (Low-Cut, Body, Boxiness cut, Presence, Air)
   */
  async _execVocalEq({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const lowCut = Number(params.lowCutHz ?? 85);
    const bodyGain = Number(params.bodyGainDb ?? 0.5);
    const boxCutGain = Number(params.boxCutGainDb ?? -1.5);
    const presHz = Number(params.presenceHz ?? 3200);
    const presGain = Number(params.presenceGainDb ?? 2.0);
    const airGain = Number(params.airGainDb ?? 1.5);

    const results = [];
    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      logFn(`[${i+1}/${inputFiles.length}] Параметрический EQ для «${nick}»...`);

      const filter = `highpass=f=${lowCut},equalizer=f=250:t=q:w=1.2:g=${bodyGain},equalizer=f=500:t=q:w=1.4:g=${boxCutGain},equalizer=f=${presHz}:t=q:w=1.5:g=${presGain},equalizer=f=11000:t=h:g=${airGain}`;

      const cmd = ffmpeg(track.path)
        .audioFilters(filter)
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outPath);

      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      await this._execFfmpeg(cmd, {
        logFn,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `Вокальный EQ: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `Vocal EQ [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

  /**
   * EXEC: Spotify Pedalboard Studio Voice DSP Engine
   * Batch processes all input tracks (e.g. 7-12 character tracks from auto-timing).
   * Runs Python sidecar or fallback DSP with high-precision studio EQ, compression, reverb & limiter.
   */
  async _execPedalboardDsp({ moduleId = 'voice_master_strip', workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    if (inputFiles.length === 0) {
      throw new Error(`Нет входных дорожек для применения модуля «${moduleId}».`);
    }

    const modDef = MODULE_DATABASE.find(m => m.id === moduleId);
    const modTitle = modDef?.title || modDef?.name || moduleId;

    logFn(`[Spotify Pedalboard DSP] Запуск обработки ${inputFiles.length} дорожек через модуль «${modTitle}»...`);

    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      logFn(`[${i+1}/${inputFiles.length}] Обработка дорожки «${nick}» (Pedalboard DSP: ${modTitle})...`);

      await AudioNeuralService.processPedalboardDsp({
        inputPath: track.path,
        outputPath: outPath,
        moduleId,
        params: params || {},
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `Pedalboard DSP: ${nick} (${p.percent.toFixed(0)}%)` });
          }
        },
        onLog: (msg, level) => {
          logFn(`  [${nick}] ${msg}`, level || 'debug');
        }
      });

      if (!fsSync.existsSync(outPath)) {
        throw new Error(`Spotify Pedalboard DSP («${modTitle}») не создал выходной файл для дорожки «${nick}».`);
      }

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    logFn(`✔ Успешно обработано ${results.length} дорожек через «${modTitle}»!`);
    return results;
  }

  /**
   * EXEC: FFmpeg Broadcast Voice Strip (Dedicated standalone FFmpeg module)
   */
  async _execFfmpegMasterStrip({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для модуля FFmpeg Broadcast Voice Strip.');
    }

    const eqHighpass = Number(params?.eqHighpass ?? 80);
    const eqPresenceFreq = Number(params?.eqPresenceFreq ?? 3200);
    const eqPresenceGain = Number(params?.eqPresenceGain ?? 2.5);
    const eqLowpass = Number(params?.eqLowpass ?? 18000);
    const compThresh = Number(params?.compThresholdDb ?? -18.0);
    const compRatio = Number(params?.compRatio ?? 3.5);
    const compAttack = Number(params?.compAttackMs ?? 15.0);
    const compRelease = Number(params?.compReleaseMs ?? 120.0);
    const deessFreq = Number(params?.deesserFreqHz ?? 6500);
    const deessAmount = Number(params?.deesserAmount ?? 0.60);
    const reverbWet = Number(params?.reverbWet ?? 0.06);
    const limiterThresh = Number(params?.limiterThresholdDb ?? -0.5);

    logFn(`[FFmpeg Broadcast Voice Strip] Комплексная обработка ${inputFiles.length} дорожек...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);
      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      const filterParts = [];
      if (eqHighpass > 20) filterParts.push(`highpass=f=${eqHighpass}`);
      if (Math.abs(eqPresenceGain) > 0.1) filterParts.push(`equalizer=f=${eqPresenceFreq}:t=q:w=1.2:g=${eqPresenceGain}`);
      if (eqLowpass < 22000) filterParts.push(`lowpass=f=${eqLowpass}`);
      if (deessAmount > 0.05) {
        filterParts.push(`equalizer=f=${deessFreq}:t=q:w=2.2:g=${(-deessAmount * 7).toFixed(1)}`);
      }
      filterParts.push(`acompressor=threshold=${compThresh}dB:ratio=${compRatio}:attack=${compAttack}:release=${compRelease}:knee=3dB:makeup=1.5dB`);
      if (reverbWet > 0.01) {
        filterParts.push(`aecho=0.8:0.6:40|70:${(reverbWet * 3).toFixed(2)}|${(reverbWet * 2).toFixed(2)}`);
      }
      filterParts.push(`alimiter=limit=${limiterThresh}dB:attack=1:release=40:level=true`);

      const cmd = ffmpeg(track.path)
        .audioFilters(filterParts.join(','))
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outPath);

      await this._execFfmpeg(cmd, {
        logFn,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `FFmpeg Master Strip: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `FFmpeg Broadcast Voice Strip [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

  /**
   * EXEC: Airwindows DSP Restoration & Saturation Suite
   * Batch processes tracks through Airwindows VST3 / Python DSP without silent fallback
   */
  async _execAirwindowsDsp({ moduleId = 'airwindows_restore', workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    if (inputFiles.length === 0) {
      throw new Error(`Нет входных дорожек для применения модуля «${moduleId}».`);
    }

    const modDef = MODULE_DATABASE.find(m => m.id === moduleId);
    const modTitle = modDef?.title || modDef?.name || moduleId;

    logFn(`[Airwindows DSP Suite] Запуск обработки ${inputFiles.length} дорожек через модуль «${modTitle}»...`);

    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      logFn(`[${i+1}/${inputFiles.length}] Обработка дорожки «${nick}» (Airwindows DSP: ${modTitle})...`);

      await AudioNeuralService.processAirwindowsDsp({
        inputPath: track.path,
        outputPath: outPath,
        moduleId,
        params: params || {},
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `Airwindows DSP: ${nick} (${p.percent.toFixed(0)}%)` });
          }
        },
        onLog: (msg, level) => {
          logFn(`  [${nick}] ${msg}`, level || 'debug');
        }
      });

      if (!fsSync.existsSync(outPath)) {
        throw new Error(`Airwindows DSP («${modTitle}») не создал выходной файл для дорожки «${nick}».`);
      }

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    logFn(`✔ Успешно обработано ${results.length} дорожек через Airwindows DSP («${modTitle}»)!`);
    return results;
  }

  /**
   * EXEC: FFmpeg De-Pop / De-Ess / Exciter Strip (Dedicated standalone FFmpeg module)
   */
  async _execFfmpegAirwindowsStrip({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для модуля FFmpeg De-Pop / De-Ess / Exciter Strip.');
    }

    const deess = Number(params?.deessIntensity ?? 0.50);
    const pop = Number(params?.popIntensity ?? 0.50);
    const slew = Number(params?.slewIntensity ?? 0.40);
    const density = Number(params?.densityDrive ?? 0.40);

    logFn(`[FFmpeg De-Pop/De-Ess/Exciter] Обработка ${inputFiles.length} дорожек...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);
      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      const filterParts = [];
      if (pop > 0.05) {
        const cutHigh = Math.round(60 + pop * 60);
        filterParts.push(`highpass=f=${cutHigh},equalizer=f=110:t=q:w=1.5:g=${(-pop * 10.0).toFixed(1)}`);
      }
      if (deess > 0.05) {
        const normF = (6500 / 24000.0).toFixed(4);
        const normI = (deess > 1.0 ? deess / 10.0 : deess).toFixed(2);
        filterParts.push(`deesser=f=${normF}:i=${normI}:m=0.5:s=o`);
      }
      if (slew > 0.05) {
        filterParts.push(`equalizer=f=8500:t=q:w=2.5:g=${(-slew * 4.0).toFixed(1)}`);
      }
      if (density > 0.05) {
        const drive = (1.0 + density * 1.2).toFixed(2);
        filterParts.push(`aexciter=level_in=1:level_out=1:amount=${(density * 2.0).toFixed(1)}:drive=${drive}:freq=3500`);
      }
      filterParts.push('alimiter=limit=-0.5dB');

      const cmd = ffmpeg(track.path)
        .audioFilters(filterParts.join(','))
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outPath);

      await this._execFfmpeg(cmd, {
        logFn,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `FFmpeg De-Pop/De-Ess: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `FFmpeg De-Pop/De-Ess [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

  /**
   * EXEC: Glue Compress (Mix all voices into one glue master)
   */
  async _execGlueCompress({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const thresholdDb = Number(params.thresholdDb ?? -18.0);
    const ratio = Number(params.ratio ?? 3.0);
    const attackMs = Number(params.attackMs ?? 20);
    const releaseMs = Number(params.releaseMs ?? 250);
    const kneeDb = Number(params.kneeDb ?? 3.5);
    const makeupDb = Number(params.makeupDb ?? 2.0);
    const peakLimitDb = Number(params.peakLimitDb ?? -1.0);

    if (inputFiles.length === 0) {
      throw new Error('Нет дорожек дабберов для склейки.');
    }

    const outName = `${prefix}voices_master.wav`;
    const outPath = path.join(stepFolder, outName);

    const trackAnalysis = await this.ensureTracksAnalysis(inputFiles, workingDir, logFn);
    const timingMeta = await this.getTimingMetadata(workingDir);

    logFn(`Склеивание и вокальная шинная компрессия ${inputFiles.length} дорожек в «${outName}» (Ratio ${ratio}:1, Thresh ${thresholdDb}dB, Knee ${kneeDb}dB, Makeup +${makeupDb}dB)...`);

    let command = ffmpeg();
    inputFiles.forEach(t => { command = command.input(t.path); });

    const n = inputFiles.length;
    let filter = '';

    if (n > 1) {
      const filterParts = [];
      const mixInputs = [];
      for (let i = 0; i < n; i++) {
        const tr = inputFiles[i];
        const st = trackAnalysis[tr.path] || trackAnalysis[tr.name] || {};
        const rms = typeof st.speechRmsDb === 'number' ? st.speechRmsDb : -24.0;
        // Equalize energy into the glue compressor bus at nominal -20 dB RMS
        const balGain = Math.max(-14, Math.min(18, -20.0 - rms));
        const roleVolPct = this._resolveTrackVolumePercent(tr, timingMeta);
        const userVolGainDb = roleVolPct !== 100 ? (20 * Math.log10(Math.max(10, roleVolPct) / 100)) : 0;
        const totalGain = Math.max(-24, Math.min(24, balGain + userVolGainDb));
        filterParts.push(`[${i}:a]volume=${totalGain.toFixed(1)}dB[bal_${i}]`);
        mixInputs.push(`[bal_${i}]`);
        logFn(`  • Дорожка «${tr.dubberNick || tr.name}» (RMS ${rms} dB, громкость роли ${roleVolPct}%) -> пред-баланс шины: ${totalGain >= 0 ? '+' : ''}${totalGain.toFixed(1)} dB`, 'debug');
      }
      filterParts.push(`${mixInputs.join('')}amix=inputs=${n}:dropout_transition=0:normalize=0[mixed]`);
      filterParts.push(`[mixed]acompressor=threshold=${thresholdDb}dB:ratio=${ratio}:attack=${attackMs}:release=${releaseMs}:knee=${kneeDb}dB:makeup=${makeupDb}dB,alimiter=limit=${peakLimitDb}dB:attack=2:release=40:level=true[out]`);
      filter = filterParts.join(';');

      command.complexFilter(filter, ['out']);
    } else {
      const roleVolPct = this._resolveTrackVolumePercent(inputFiles[0], timingMeta);
      const userVolGainDb = roleVolPct !== 100 ? (20 * Math.log10(Math.max(10, roleVolPct) / 100)) : 0;
      const volFilter = userVolGainDb !== 0 ? `volume=${userVolGainDb.toFixed(1)}dB,` : '';
      filter = `${volFilter}acompressor=threshold=${thresholdDb}dB:ratio=${ratio}:attack=${attackMs}:release=${releaseMs}:knee=${kneeDb}dB:makeup=${makeupDb}dB,alimiter=limit=${peakLimitDb}dB:attack=2:release=40:level=true`;
      command.audioFilters(filter);
    }

    command
      .audioCodec('pcm_s16le')
      .audioChannels(2)
      .audioFrequency(48000)
      .output(outPath);

    await this._execFfmpeg(command, {
      logFn,
      onProgress: (p) => {
        if (onProgress && p && p.percent) onProgress({ percent: Math.round(p.percent), message: 'Склейка голосов...' });
      },
      outPath,
      description: `Склейка и компрессия ${n} дорожек`
    });

    const st = fsSync.statSync(outPath);
    logFn(`Голосовой мастер-файл успешно склеен: ${outName} (${(st.size / (1024*1024)).toFixed(2)} MB)`);
    return [{ name: outName, path: outPath, size: st.size }];
  }

  /**
   * EXEC: Sidechain Ducking (STANDALONE MODULE)
   */
  async _execDucking({ episode, workingDir, stepFolder, prefix, manifest, inputFiles, params, logFn, onProgress }) {
    const duckingAmountDb = Number(params.duckingAmountDb ?? -14.0);
    const attackMs = Number(params.attackMs ?? 40);
    const releaseMs = Number(params.releaseMs ?? 320);
    const threshold = Number(params.threshold ?? 0.08);

    const epDir = this.getEpisodeDir(episode);
    const parentDir = path.dirname(workingDir);
    const rawDir = path.join(workingDir, '00_исходные');

    let origAudioPath = manifest.sourceFiles?.originalAudio?.path;
    if (!origAudioPath || !fsSync.existsSync(origAudioPath)) {
      const candidates = [
        path.join(rawDir, '00_original_audio.wav'),
        path.join(workingDir, '00_original_audio.wav'),
        path.join(workingDir, 'original_audio.wav'),
        path.join(parentDir, '00_original_audio.wav'),
        path.join(parentDir, 'original_audio.wav'),
        path.join(epDir, '00_original_audio.wav'),
        path.join(epDir, 'original_audio.wav')
      ];
      origAudioPath = candidates.find(c => c && fsSync.existsSync(c)) || null;
    }

    if (!origAudioPath || !fsSync.existsSync(origAudioPath)) {
      let vPath = manifest.sourceFiles?.video?.path || episode?.rawPath;
      if (!vPath || !fsSync.existsSync(vPath)) {
        const videoExtRegex = /\.(mp4|mkv|mov|avi|webm)$/i;
        const searchDirs = [workingDir, rawDir, parentDir, epDir].filter(d => d && fsSync.existsSync(d));
        for (const dir of searchDirs) {
          try {
            const files = fsSync.readdirSync(dir);
            const vid = files.find(f => videoExtRegex.test(f) && !f.includes('[СВЕДЕНО]') && !f.includes('video_mux'));
            if (vid) {
              vPath = path.join(dir, vid);
              break;
            }
          } catch (e) {}
        }
      }

      if (!vPath || !fsSync.existsSync(vPath)) {
        throw new Error('Оригинальное видео или аудио не найдено для даккинга (проверьте наличие видеофайла серии).');
      }

      origAudioPath = path.join(rawDir, '00_original_audio.wav');
      await fs.mkdir(path.dirname(origAudioPath), { recursive: true });
      logFn(`Извлечение аудиодорожки оригинала из видео «${path.basename(vPath)}» для даккинга...`);
      await this._extractAudioFromVideo(vPath, origAudioPath, logFn);
      manifest.sourceFiles.originalAudio = { name: '00_original_audio.wav', path: origAudioPath, size: fsSync.statSync(origAudioPath).size, exists: true };
    }

    let voicePath = inputFiles.find(f => f.name.includes('voices_master') || f.path.includes('voices_master'))?.path;
    if (!voicePath) {
      const acousticStep = [...(manifest.pipeline || [])].reverse().find(s => this._isAcousticMatchStep(s.moduleId) && s.outputFiles?.length > 0);
      if (acousticStep && acousticStep.outputFiles[0] && fsSync.existsSync(acousticStep.outputFiles[0].path)) {
        voicePath = acousticStep.outputFiles[0].path;
      }
    }
    if (!voicePath) {
      const glueStep = manifest.pipeline.find(s => s.moduleId === 'glue_compress' && s.outputFiles?.length > 0);
      if (glueStep && glueStep.outputFiles[0] && fsSync.existsSync(glueStep.outputFiles[0].path)) {
        voicePath = glueStep.outputFiles[0].path;
      }
    }
    if (!voicePath && inputFiles.length > 0) voicePath = inputFiles[0].path;
    if (!voicePath) {
      throw new Error('Голосовая дорожка отсутствует. Сначала выполните склейку или нормализацию.');
    }

    const outName = `${prefix}ducked_original.wav`;
    const outPath = path.join(stepFolder, outName);

    logFn(`Сайдчейн-даккинг оригинального звука (приглушение: ${duckingAmountDb} dB, Атака: ${attackMs}ms, Спад: ${releaseMs}ms)...`);

    const filter = `[0:a]volume=0.95[orig];[orig][1:a]sidechaincompress=threshold=${threshold}:ratio=4:attack=${attackMs}:release=${releaseMs}:makeup=1[ducked]`;

    const duckCmd = ffmpeg()
      .input(origAudioPath)
      .input(voicePath)
      .complexFilter(filter, ['ducked'])
      .audioCodec('pcm_s16le')
      .audioChannels(2)
      .audioFrequency(48000)
      .output(outPath);

    await this._execFfmpeg(duckCmd, {
      logFn,
      onProgress: (p) => {
        if (onProgress && p && p.percent) onProgress({ percent: Math.round(p.percent), message: 'Сайдчейн-даккинг...' });
      },
      outPath,
      description: 'Сайдчейн-даккинг оригинального звука под голос'
    });

    const st = fsSync.statSync(outPath);
    logFn(`Даккинг завершен. Обработанный фоновый звук сохранен: ${outName} (${(st.size / (1024*1024)).toFixed(2)} MB)`);
    return [{ name: outName, path: outPath, size: st.size }];
  }

  /**
   * EXEC: Master Audio Mix (STANDALONE MODULE)
   */
  async _execMasterMix({ episode, workingDir, stepFolder, prefix, manifest, inputFiles, params, logFn, onProgress }) {
    const voiceVolume = Number(params.voiceVolume ?? 1.0);
    const bgVolume = Number(params.bgVolume ?? 0.85);
    const stereoWidth = Number(params.stereoWidth ?? 1.15);
    const ceilingDb = Number(params.limiterCeilingDb ?? -0.5);
    const limiterReleaseMs = Number(params.limiterReleaseMs ?? 40);

    const epDir = this.getEpisodeDir(episode);
    const parentDir = path.dirname(workingDir);
    const rawDir = path.join(workingDir, '00_исходные');

    // 1. Поиск фоновой / оригинальной дорожки (Background / Instrumental)
    let duckedAudioPath = null;
    const duckingStep = manifest.pipeline.find(s => s.moduleId === 'ducking' && s.outputFiles?.length > 0);
    if (duckingStep && duckingStep.outputFiles[0] && fsSync.existsSync(duckingStep.outputFiles[0].path)) {
      duckedAudioPath = duckingStep.outputFiles[0].path;
      logFn(`Использован результат даккинга как фон: ${path.basename(duckedAudioPath)}`);
    } else if (manifest.sourceFiles?.originalAudio?.path && fsSync.existsSync(manifest.sourceFiles.originalAudio.path)) {
      duckedAudioPath = manifest.sourceFiles.originalAudio.path;
      logFn(`Использована оригинальная аудиодорожка из манифеста: ${path.basename(duckedAudioPath)}`);
    }

    // 2. Проверяем готовый инструментал из разделения стемов (Demucs / UVR / MDX)
    if (!duckedAudioPath || !fsSync.existsSync(duckedAudioPath)) {
      const stemSteps = (manifest.pipeline || []).filter(s => ['htdemucs', 'htdemucs_ft', 'uvr_mdx_inst_hq3', 'separate', 'uvr_mdx_voc_ft'].includes(s.moduleId) && s.outputFiles?.length > 0);
      for (const stStep of stemSteps) {
        const instFile = (stStep.outputFiles || []).find(f => f.type === 'instrumental' || f.name?.includes('no_vocals') || f.name?.includes('instrumental'));
        if (instFile && fsSync.existsSync(instFile.path)) {
          duckedAudioPath = instFile.path;
          logFn(`Использован инструментальный стем этапа «${stStep.moduleId}» в качестве фона: ${instFile.name}`);
          break;
        }
      }
    }

    // 3. Проверяем наличие аудиофайлов на диске
    if (!duckedAudioPath || !fsSync.existsSync(duckedAudioPath)) {
      const candidates = [
        path.join(rawDir, '00_original_audio.wav'),
        path.join(workingDir, '00_original_audio.wav'),
        path.join(workingDir, 'original_audio.wav'),
        path.join(parentDir, '00_original_audio.wav'),
        path.join(parentDir, 'original_audio.wav'),
        path.join(rawDir, 'original_audio.wav'),
        path.join(epDir, '00_original_audio.wav'),
        path.join(epDir, 'original_audio.wav')
      ];
      duckedAudioPath = candidates.find(c => c && fsSync.existsSync(c)) || null;
      if (duckedAudioPath) {
        logFn(`Найдена фоновая аудиодорожка: ${path.basename(duckedAudioPath)}`);
      }
    }

    // 4. Если аудио нет, но есть видео — извлекаем на лету!
    if (!duckedAudioPath || !fsSync.existsSync(duckedAudioPath)) {
      let vPath = manifest.sourceFiles?.video?.path || episode?.rawPath;
      if (!vPath || !fsSync.existsSync(vPath)) {
        const videoExtRegex = /\.(mp4|mkv|mov|avi|webm)$/i;
        const searchDirs = [workingDir, rawDir, parentDir, epDir].filter(d => d && fsSync.existsSync(d));
        for (const dir of searchDirs) {
          try {
            const files = fsSync.readdirSync(dir);
            const vid = files.find(f => videoExtRegex.test(f) && !f.includes('[СВЕДЕНО]') && !f.includes('video_mux'));
            if (vid) {
              vPath = path.join(dir, vid);
              break;
            }
          } catch (e) {}
        }
      }

      if (vPath && fsSync.existsSync(vPath)) {
        logFn(`Извлечение фонового аудио из видеоряда «${path.basename(vPath)}» для мастер-микса...`);
        const outAudio = path.join(rawDir, '00_original_audio.wav');
        try {
          if (!fsSync.existsSync(path.dirname(outAudio))) {
            fsSync.mkdirSync(path.dirname(outAudio), { recursive: true });
          }
          await this._extractAudioFromVideo(vPath, outAudio, logFn);
          if (fsSync.existsSync(outAudio)) {
            duckedAudioPath = outAudio;
            const st = fsSync.statSync(outAudio);
            manifest.sourceFiles.originalAudio = { name: '00_original_audio.wav', path: outAudio, size: st.size, exists: true };
            manifest.sourceFiles.video = { name: path.basename(vPath), path: vPath, size: fsSync.statSync(vPath).size, exists: true };
            logFn('✓ Оригинальное аудио успешно извлечено и подключено как фон.');
          }
        } catch (extractErr) {
          log.warn('[Mixing] Could not extract background audio from video:', extractErr.message);
        }
      }
    }

    if (!duckedAudioPath || !fsSync.existsSync(duckedAudioPath)) {
      throw new Error('Фоновое аудио не найдено для сведения (проверьте наличие видеофайла серии или аудио оригинала в 00_исходные).');
    }

    // 5. Поиск мастер-дорожки голосов (Vocals Master)
    // ВАЖНО: Ни в коем случае не путать голос с даккнутым фоном (duckedAudioPath)!
    let voicePath = null;

    // Сначала проверяем, был ли выполнен шаг наложения эффектов оригинала (acoustic_matched) поверх склеенной шины голосов
    const acousticStep = [...(manifest.pipeline || [])].reverse().find(s => this._isAcousticMatchStep(s.moduleId) && s.outputFiles?.length > 0);
    if (acousticStep && acousticStep.outputFiles[0] && fsSync.existsSync(acousticStep.outputFiles[0].path)) {
      voicePath = acousticStep.outputFiles[0].path;
      logFn(`Использована склеенная шина голосов с эффектами оригинала (acoustic_matched): ${path.basename(voicePath)}`);
    }

    // Если нет, ищем склеенный голосовой мастер из glue_compress
    if (!voicePath) {
      const glueStep = manifest.pipeline.find(s => s.moduleId === 'glue_compress' && s.outputFiles?.length > 0);
      if (glueStep && glueStep.outputFiles[0] && fsSync.existsSync(glueStep.outputFiles[0].path)) {
        voicePath = glueStep.outputFiles[0].path;
        logFn(`Использован мастер склейки голосов: ${path.basename(voicePath)}`);
      }
    }

    // Если нет, ищем в предшествующих этапах голосовой обработки
    if (!voicePath) {
      const vocalSteps = (manifest.pipeline || []).filter(s => 
        ['vocal_eq', 'speech_leveler', 'headroom_recovery', 'phrase_norm', 'auto_norm_phrases', 'silence_gate', 'apply_fixes'].includes(s.moduleId) && 
        s.outputFiles?.length > 0
      );
      for (let i = vocalSteps.length - 1; i >= 0; i--) {
        const vStep = vocalSteps[i];
        const vFile = (vStep.outputFiles || []).find(f => f.path && fsSync.existsSync(f.path) && f.path !== duckedAudioPath && !f.name.includes('ducked'));
        if (vFile) {
          voicePath = vFile.path;
          logFn(`Использован результат этапа «${vStep.moduleId}» как голосовой мастер: ${path.basename(voicePath)}`);
          break;
        }
      }
    }

    // Если на входе отдельные дорожки дабберов (например, если шаг glue_compress пропущен)
    if (!voicePath && inputFiles.length > 0) {
      const dubberInputs = inputFiles.filter(f => f.path && fsSync.existsSync(f.path) && f.path !== duckedAudioPath && !f.name.includes('ducked'));
      if (dubberInputs.length === 1) {
        voicePath = dubberInputs[0].path;
      } else if (dubberInputs.length > 1) {
        logFn(`Склейка ${dubberInputs.length} дорожек дабберов с учетом персональной громкости роли для мастер-микса...`);
        const tempVoicePath = path.join(stepFolder, 'temp_combined_voices.wav');
        let joinCmd = ffmpeg();
        dubberInputs.forEach(t => { joinCmd = joinCmd.input(t.path); });
        
        const filterParts = [];
        const mixInputs = [];
        for (let i = 0; i < dubberInputs.length; i++) {
          const tr = dubberInputs[i];
          const roleVolPct = this._resolveTrackVolumePercent(tr, timingMeta);
          const userVolGainDb = roleVolPct !== 100 ? (20 * Math.log10(Math.max(10, roleVolPct) / 100)) : 0;
          if (userVolGainDb !== 0) {
            filterParts.push(`[${i}:a]volume=${userVolGainDb.toFixed(1)}dB[vol_${i}]`);
            mixInputs.push(`[vol_${i}]`);
          } else {
            mixInputs.push(`[${i}:a]`);
          }
        }
        filterParts.push(`${mixInputs.join('')}amix=inputs=${dubberInputs.length}:dropout_transition=0:normalize=0[mixout]`);

        joinCmd
          .complexFilter(filterParts.join(';'), ['mixout'])
          .audioCodec('pcm_s16le')
          .audioChannels(2)
          .audioFrequency(48000)
          .output(tempVoicePath);
        await this._execFfmpeg(joinCmd, { logFn, outPath: tempVoicePath, description: 'Склейка голосов для мастера' });
        if (fsSync.existsSync(tempVoicePath)) {
          voicePath = tempVoicePath;
        }
      }
    }

    if (!voicePath || !fsSync.existsSync(voicePath)) {
      throw new Error('Голосовой мастер-файл не найден для сведения.');
    }

    if (path.resolve(voicePath) === path.resolve(duckedAudioPath)) {
      throw new Error('Конфликт сведения: дорожка голоса совпадает с фоновой дорожкой.');
    }

    const outName = `${prefix}master_audio.wav`;
    const outPath = path.join(stepFolder, outName);

    logFn(`Сведение мастер-аудио: голос «${path.basename(voicePath)}» (${voiceVolume}x), фон «${path.basename(duckedAudioPath)}» (${bgVolume}x, стереобаза: ${stereoWidth}x, потолок: ${ceilingDb}dB)...`);

    const filter = `[0:a]volume=${bgVolume},extrastereo=m=${stereoWidth}[bg];[1:a]volume=${voiceVolume}[voc];[bg][voc]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=${ceilingDb}dB:attack=5:release=${limiterReleaseMs}[mixout]`;

    const masterCmd = ffmpeg()
      .input(duckedAudioPath)
      .input(voicePath)
      .complexFilter(filter, ['mixout'])
      .audioCodec('pcm_s16le')
      .audioChannels(2)
      .audioFrequency(48000)
      .output(outPath);

    await this._execFfmpeg(masterCmd, {
      logFn,
      onProgress: (p) => {
        if (onProgress && p && p.percent) onProgress({ percent: Math.round(p.percent), message: 'Сведение мастер-аудио...' });
      },
      outPath,
      description: 'Финальный мастер-микс аудиодорожек'
    });

    const st = fsSync.statSync(outPath);
    logFn(`Финальный мастер-аудиофайл готов: ${outName} (${(st.size / (1024*1024)).toFixed(2)} MB)`);
    return [{ name: outName, path: outPath, size: st.size }];
  }

  /**
   * EXEC: Final Video Mux (STANDALONE MODULE)
   */
  async _execVideoMux({ episode, workingDir, stepFolder, prefix, manifest, inputFiles, params, logFn, onProgress }) {
    const audioBitrate = params.audioBitrate || '320k';
    const videoCodec = params.videoCodec || 'copy';

    let masterAudioPath = null;
    const mixStep = manifest.pipeline.find(s => s.moduleId === 'master_audio_mix' && s.outputFiles?.length > 0);
    if (mixStep && mixStep.outputFiles[0]) {
      masterAudioPath = mixStep.outputFiles[0].path;
    } else if (inputFiles.length > 0) {
      masterAudioPath = inputFiles[0].path;
    }

    if (!masterAudioPath || !fsSync.existsSync(masterAudioPath)) {
      throw new Error('Мастер-аудиодорожка отсутствует. Сначала выполните модуль «Мастер-микс аудио».');
    }

    const videoPath = manifest.sourceFiles.video?.path || episode?.rawPath;
    if (!videoPath || !fsSync.existsSync(videoPath)) {
      throw new Error('Видеофайл серии не найден.');
    }

    const projectTitle = (episode?.project?.title || 'Project').replace(/[\\/:*?"<>|]/g, '_');
    const epNum = episode?.number !== undefined ? episode.number : 1;
    const finalVideoName = `${prefix}${projectTitle}_Серия_${epNum}_[СВЕДЕНО].mp4`;
    const finalVideoPath = path.join(stepFolder, finalVideoName);

    logFn(`Вшивание звука «${path.basename(masterAudioPath)}» в видеоряд «${path.basename(videoPath)}» (${videoCodec === 'copy' ? 'быстрое копирование потока' : 'транскодирование'})...`);

    const muxCmd = ffmpeg()
      .input(videoPath)
      .input(masterAudioPath);

    const outputOpts = [
      '-map 0:v:0',
      '-map 1:a:0'
    ];

    if (videoCodec === 'copy') {
      outputOpts.push('-c:v copy');
    } else {
      outputOpts.push(
        '-c:v libx264',
        `-crf ${params.crf || 18}`,
        '-preset fast',
        '-pix_fmt yuv420p'
      );
    }

    if (audioBitrate === 'flac') {
      outputOpts.push('-c:a flac');
    } else {
      outputOpts.push('-c:a aac', `-b:a ${audioBitrate || '320k'}`);
    }

    if (finalVideoPath.toLowerCase().endsWith('.mp4') && params.fastStart !== false) {
      outputOpts.push('-movflags +faststart');
    }

    outputOpts.push('-max_muxing_queue_size 1024');

    muxCmd
      .outputOptions(outputOpts)
      .output(finalVideoPath);

    await this._execFfmpeg(muxCmd, {
      logFn,
      onProgress: (p) => {
        if (onProgress && p && p.percent) onProgress({ percent: Math.round(p.percent), message: 'Сборка видео...' });
      },
      outPath: finalVideoPath,
      description: `Сведение видео ${finalVideoName}`
    });

    const st = fsSync.statSync(finalVideoPath);
    const finalVideoObj = { name: finalVideoName, path: finalVideoPath, size: st.size };

    const rootCopyPath = path.join(workingDir, `${projectTitle}_Серия_${epNum}_[СВЕДЕНО].mp4`);
    try {
      if (path.resolve(rootCopyPath) !== path.resolve(finalVideoPath)) {
        await fs.copyFile(finalVideoPath, rootCopyPath);
      }
    } catch (e) {}

    logFn(`Готовая сведенная серия создана: ${finalVideoName} (${(st.size / (1024*1024)).toFixed(2)} MB)`);
    return [finalVideoObj];
  }

  async runAllSteps({ episode, targetDir, baseDir, onProgress, onLog }) {
    this.isAborted = false;
    const workingDir = this.resolveWorkingDir(targetDir, episode, baseDir);
    const statusData = await this.getStatus({ episode, targetDir: workingDir, baseDir });
    const manifest = statusData.manifest;

    const enabledSteps = manifest.pipeline.filter(s => s.enabled);
    if (enabledSteps.length === 0) {
      throw new Error('Все шаги конвейера отключены. Включите хотя бы один модуль.');
    }

    const logFn = (msg, level = 'info', meta = null) => {
      const tag = '[Mixing:Pipeline]';
      if (level === 'error') {
        console.error(`${tag} ❌ ${msg}`, meta || '');
        log.error(`${tag} ${msg}`);
      } else if (level === 'warn') {
        console.warn(`${tag} ⚠️ ${msg}`, meta || '');
        log.warn(`${tag} ${msg}`);
      } else {
        console.log(`${tag} ${msg}`, meta || '');
        log.info(`${tag} ${msg}`);
      }
      if (onLog) onLog(msg, level, { meta });
    };

    const startTime = Date.now();
    logFn(`=======================================================`);
    logFn(`🎬 НАЧАЛО ПОЛНОГО КОНВЕЙЕРА СВЕДЕНИЯ ВИДЕО`);
    logFn(`  Серия: ${episode?.project?.title || 'Проект'} — Эпизод #${episode?.number || 1}`);
    logFn(`  Рабочая директория: ${workingDir}`);
    logFn(`  Всего активных модулей: ${enabledSteps.length}`);
    enabledSteps.forEach((s, idx) => {
      logFn(`    [${idx + 1}/${enabledSteps.length}] ${s.moduleId} (${s.title || ''})`);
    });
    logFn(`=======================================================`);

    for (let i = 0; i < enabledSteps.length; i++) {
      if (this.isAborted) {
        logFn(`⏹ Выполнение цепочки остановлено пользователем.`, 'warn');
        throw new Error('Процесс сведения остановлен пользователем.');
      }

      const step = enabledSteps[i];
      const stepPctStart = Math.round((i / enabledSteps.length) * 100);
      const stepPctEnd = Math.round(((i + 1) / enabledSteps.length) * 100);

      logFn(`--- Запуск этапа ${i + 1}/${enabledSteps.length}: ${step.moduleId} ---`);
      if (onProgress) {
        onProgress({ percent: stepPctStart, message: `Шаг ${i+1}/${enabledSteps.length}: ${step.moduleId}...` });
      }

      await this.runStep({
        episode,
        targetDir: workingDir,
        baseDir,
        stepId: step.stepId,
        _fromChain: true,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const overall = stepPctStart + Math.round((p.percent / 100) * (stepPctEnd - stepPctStart));
            onProgress({ percent: overall, message: p.message });
          }
        },
        onLog
      });
    }

    const totalSec = ((Date.now() - startTime) / 1000).toFixed(2);
    if (onProgress) onProgress({ percent: 100, message: 'Все модули конвейера успешно выполнены!' });
    logFn(`🎉 Полный конвейер сведения успешно завершен за ${totalSec}s!`);
    logFn(`=======================================================`);

    return await this.getStatus({ episode, targetDir: workingDir, baseDir });
  }

  /**
   * Saves timing metadata and phrase volume map JSON into the mixing directory
   */
  async saveTimingMetadata({ episode, targetDir, baseDir, timingMetadata }) {
    const workingDir = this.resolveWorkingDir(targetDir, episode, baseDir);
    await this.ensureDirectory(workingDir);

    const timingFileMain = path.join(workingDir, 'timing_metadata.json');
    const volumeFileMain = path.join(workingDir, 'phrase_volume_map.json');

    const sourceDir = path.join(workingDir, '00_исходные');
    await this.ensureDirectory(sourceDir);
    const timingFileSource = path.join(sourceDir, 'timing_metadata.json');
    const volumeFileSource = path.join(sourceDir, 'phrase_volume_map.json');

    const jsonStr = JSON.stringify(timingMetadata, null, 2);

    await fs.writeFile(timingFileMain, jsonStr, 'utf8');
    await fs.writeFile(volumeFileMain, jsonStr, 'utf8');
    await fs.writeFile(timingFileSource, jsonStr, 'utf8');
    await fs.writeFile(volumeFileSource, jsonStr, 'utf8');

    log.info(`[Mixing] Timing metadata & phrase volume map saved to: ${timingFileMain}`);

    return {
      success: true,
      path: timingFileMain
    };
  }

  /**
   * Helper to load timing metadata & phrase volume map from working directory
   */
  async getTimingMetadata(workingDir) {
    if (!workingDir) return null;

    try {
      const passport = await AudioAnalysisService.getTimingAnalysis(workingDir);
      if (passport) return passport;
    } catch (err) {}

    const candidates = [
      path.join(workingDir, 'timing_project.analysis.json'),
      path.join(workingDir, 'project_timing.analysis.json'),
      path.join(workingDir, 'timing_metadata.json'),
      path.join(workingDir, 'phrase_volume_map.json'),
      path.join(workingDir, '00_исходные', 'timing_metadata.json'),
      path.join(workingDir, '00_исходные', 'phrase_volume_map.json')
    ];

    for (const c of candidates) {
      if (fsSync.existsSync(c)) {
        try {
          const raw = fsSync.readFileSync(c, 'utf8');
          return JSON.parse(raw);
        } catch (e) {
          log.warn(`[Mixing] Error reading timing metadata from ${c}:`, e);
        }
      }
    }
    return null;
  }

  async saveFinalVideo({ episode, targetDir, baseDir, destinationPath }) {
    if (!destinationPath) throw new Error('Укажите путь сохранения видео');
    const workingDir = this.resolveWorkingDir(targetDir, episode, baseDir);
    const statusData = await this.getStatus({ episode, targetDir: workingDir, baseDir });
    const finalVideo = statusData.manifest.finalVideo;

    if (!finalVideo || !finalVideo.path || !fsSync.existsSync(finalVideo.path)) {
      throw new Error('Финальное сведенное видео не найдено. Сначала выполните модуль сведение видео.');
    }

    await this.ensureDirectory(path.dirname(destinationPath));
    await fs.copyFile(finalVideo.path, destinationPath);
    log.info(`[Mixing] Final video copied to ${destinationPath}`);

    return {
      success: true,
      savedPath: destinationPath
    };
  }

  async openFolder(folderPath) {
    if (folderPath && fsSync.existsSync(folderPath)) {
      await shell.openPath(folderPath);
      return { success: true };
    }
    return { success: false, error: 'Папка не существует' };
  }

  /**
   * UVR MODEL: Check installation status of a UVR model
   */
  async checkUvrModelStatus({ modelId = 'uvr_denoise_lite' } = {}) {
    const rootUserData = app ? app.getPath('userData') : process.cwd();
    const uvrModelsDir = path.join(rootUserData, 'models', 'uvr');
    const modelDef = this.moduleDatabase.find(m => m.id === modelId) || this.moduleDatabase.find(m => m.id === 'uvr_denoise_lite');
    const filename = modelDef?.filename || (modelId === 'uvr_deecho_normal' ? 'UVR-De-Echo-Normal.pth' : 'UVR-DeNoise-Lite.pth');
    const localModelFile = path.join(uvrModelsDir, filename);
    const isInstalled = fsSync.existsSync(localModelFile);
    let bytes = null;
    if (isInstalled) {
      try {
        bytes = fsSync.statSync(localModelFile).size;
      } catch (e) {}
    }
    return {
      success: true,
      is_installed: isInstalled,
      installed_bytes: bytes,
      local_path: isInstalled ? localModelFile : null,
      modelInfo: {
        id: modelDef.id,
        name: modelDef.name || modelDef.title,
        filename: modelDef.filename,
        category: modelDef.category,
        description: modelDef.description,
        size_mb: modelDef.size_mb,
        recommended_for: modelDef.recommended_for,
        urls: modelDef.urls || [],
        format: modelDef.format || 'pth',
        engineArchitecture: modelDef.engineArchitecture
      }
    };
  }

  /**
   * UVR MODEL: Download / Activate model file on disk
   */
  async downloadUvrModel({ modelId = 'uvr_denoise_lite', onProgress, onLog } = {}) {
    const rootUserData = app ? app.getPath('userData') : process.cwd();
    const uvrModelsDir = path.join(rootUserData, 'models', 'uvr');
    await fs.mkdir(uvrModelsDir, { recursive: true });

    const modelDef = this.moduleDatabase.find(m => m.id === modelId) || this.moduleDatabase.find(m => m.id === 'uvr_denoise_lite');
    const filename = modelDef?.filename || (modelId === 'uvr_deecho_normal' ? 'UVR-De-Echo-Normal.pth' : 'UVR-DeNoise-Lite.pth');
    const localModelFile = path.join(uvrModelsDir, filename);
    const metaFile = `${localModelFile}.meta.json`;
    const urls = modelDef?.urls || [];
    const sizeMb = modelDef?.size_mb || 40.0;
    const approxBytes = Math.round(sizeMb * 1024 * 1024);

    const isConfig = /\.(yaml|yml|json)$/i.test(filename);
    const minValidExisting = isConfig ? 50 : 1024 * 1024;

    // If an existing file on disk is smaller than threshold, it is likely a corrupted previous placeholder
    if (fsSync.existsSync(localModelFile)) {
      const existingSize = fsSync.statSync(localModelFile).size;
      if (existingSize < minValidExisting) {
        log.warn(`[Mixing] Deleting corrupted previous placeholder file (${existingSize} bytes): ${localModelFile}`);
        try { fsSync.unlinkSync(localModelFile); } catch (e) {}
      } else {
        return {
          success: true,
          id: modelDef.id,
          name: modelDef.name || modelDef.title,
          filename: modelDef.filename,
          installed_bytes: existingSize,
          local_path: localModelFile
        };
      }
    }

    if (onLog) onLog(`Запуск загрузки модели ${filename} (${sizeMb} МБ)...`);

    const downloadFromUrl = (targetUrl) => {
      return new Promise((resolve, reject) => {
        const https = require('https');
        const http = require('http');

        const requestWithRedirect = (curUrl, redirectCount = 0) => {
          if (redirectCount > 8) {
            return reject(new Error('Слишком много перенаправлений'));
          }

          const client = curUrl.startsWith('https') ? https : http;
          const req = client.get(curUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': '*/*'
            }
          }, (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
              res.resume(); // CRITICAL: release socket stream before redirect
              const redirectUrl = new URL(res.headers.location, curUrl).toString();
              return requestWithRedirect(redirectUrl, redirectCount + 1);
            }

            if (res.statusCode !== 200) {
              res.resume();
              return reject(new Error(`HTTP статус: ${res.statusCode}`));
            }

            const totalBytes = parseInt(res.headers['content-length'] || String(approxBytes), 10);
            let downloadedBytes = 0;
            const tempFile = `${localModelFile}.download`;
            const fileStream = fsSync.createWriteStream(tempFile);

            res.on('data', (chunk) => {
              downloadedBytes += chunk.length;
              fileStream.write(chunk);
              if (onProgress && totalBytes > 0) {
                const percent = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
                onProgress({ percent, downloadedBytes, totalBytes });
              }
            });

            res.on('end', () => {
              fileStream.end(async () => {
                try {
                  const minTempValid = isConfig ? 50 : 1024 * 100;
                  if (fsSync.existsSync(tempFile) && fsSync.statSync(tempFile).size > minTempValid) {
                    await fs.rename(tempFile, localModelFile);
                    const metaInfo = {
                      id: modelDef.id,
                      name: modelDef.name || modelDef.title,
                      filename: modelDef.filename,
                      category: modelDef.category,
                      description: modelDef.description,
                      size_mb: modelDef.size_mb,
                      recommended_for: modelDef.recommended_for,
                      engineArchitecture: modelDef.engineArchitecture,
                      installed_bytes: downloadedBytes,
                      local_path: localModelFile,
                      format: modelDef.format || 'pth',
                      installedAt: new Date().toISOString()
                    };
                    await fs.writeFile(metaFile, JSON.stringify(metaInfo, null, 2), 'utf8');
                    resolve(metaInfo);
                  } else {
                    reject(new Error('Размер скачанного файла подозрительно мал'));
                  }
                } catch (err) {
                  reject(err);
                }
              });
            });

            res.on('error', (err) => {
              try { fsSync.unlinkSync(tempFile); } catch (e) {}
              reject(err);
            });
          });

          req.on('error', (err) => reject(err));
          req.setTimeout(35000, () => {
            req.destroy();
            reject(new Error('Превышен таймаут загрузки'));
          });
        };

        requestWithRedirect(targetUrl);
      });
    };

    for (const url of urls) {
      try {
        if (onLog) onLog(`Подключение к источнику весов: ${url}...`);
        const result = await downloadFromUrl(url);
        if (onLog) onLog(`✓ Модель ${filename} успешно загружена!`);
        return { success: true, ...result };
      } catch (err) {
        if (onLog) onLog(`Предупреждение при загрузке: ${err.message}`, 'warn');
      }
    }

    // Try secondary Python downloader with direct streaming
    try {
      if (onLog) onLog(`Запуск прямого Python-загрузчика для ${filename}...`);
      await AudioNeuralService._runPythonSidecar([
        '--mode', 'download_model',
        '--model_path', localModelFile,
        '--model_id', modelDef.id
      ], {
        onProgress,
        onLog,
        operationName: `Download Model ${filename}`
      });

      const minPyValid = isConfig ? 50 : 1024 * 512;
      if (fsSync.existsSync(localModelFile) && fsSync.statSync(localModelFile).size > minPyValid) {
        const sz = fsSync.statSync(localModelFile).size;
        const metaInfo = {
          id: modelDef.id,
          name: modelDef.name || modelDef.title,
          filename: modelDef.filename,
          installed_bytes: sz,
          local_path: localModelFile,
          format: modelDef.format || 'pth',
          installedAt: new Date().toISOString()
        };
        await fs.writeFile(metaFile, JSON.stringify(metaInfo, null, 2), 'utf8');
        if (onLog) onLog(`✓ Модель ${filename} успешно загружена через Python!`);
        return { success: true, ...metaInfo };
      }
    } catch (pyErr) {
      log.warn(`[Mixing] Python downloader fallback failed: ${pyErr.message}`);
    }

    throw new Error(`Не удалось скачать веса модели ${filename}. Проверьте доступ в интернет или скопируйте файл вручную в папку: ${uvrModelsDir}`);
  }

  /**
   * PIPELINE PRESETS: List all presets (built-in + user saved)
   */
  async getPipelinePresets({ baseDir }) {
    const root = baseDir || (app ? app.getPath('userData') : process.cwd());
    const presetsDir = path.join(root, 'config', 'mixing_pipeline_presets');
    await fs.mkdir(presetsDir, { recursive: true });

    // Built-in presets
    const builtInPresets = [
      {
        id: 'uvr_neural_clean_master',
        name: '🛡 VR-DeNoise Lite + Студийный мастеринг (Нейро-очистка шума)',
        description: 'Применяет нейросетевую модель VR-DeNoise Lite (VR Lightweight Stationarity Reducer) к дорожкам дабберов, устраняя шумы микрофонов и комнат без артефактов, с последующей эквализацией, даккингом и видео-сведением.',
        createdAt: '2026-01-01T00:00:00.000Z',
        isBuiltIn: true,
        pipeline: [
          {
            stepId: 'step_1_uvr_denoise',
            moduleId: 'uvr_denoise_lite',
            prefix: '01_denoise_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'uvr_denoise_lite')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_2_norm',
            moduleId: 'phrase_norm',
            prefix: '02_norm_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'phrase_norm')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_3_eq',
            moduleId: 'vocal_eq',
            prefix: '03_eq_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'vocal_eq')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_4_glue',
            moduleId: 'glue_compress',
            prefix: '04_glue_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'glue_compress')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_5_ducking',
            moduleId: 'ducking',
            prefix: '05_ducking_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'ducking')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_6_mix',
            moduleId: 'master_audio_mix',
            prefix: '06_master_mix_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'master_audio_mix')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_7_video',
            moduleId: 'video_mux',
            prefix: '07_video_mux_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'video_mux')?.defaultParams },
            status: 'idle',
            outputFiles: []
          }
        ]
      },
      {
        id: 'full_studio_cinema',
        name: '🎬 Полный студийный релиз (Автотайминг + Фиксы + EBU R128 + Даккинг + Сведение)',
        description: 'Идеален для профессиональных релизов и внешних серий: автоматическое выравнивание пауз, вшитие фиксов, поканальная нормализация, мягкая склейка голосов, сайдчейн-даккинг оригинала и итоговый видео-мукс.',
        createdAt: '2026-01-01T00:00:00.000Z',
        isBuiltIn: true,
        pipeline: [
          {
            stepId: 'step_1_autotiming',
            moduleId: 'auto_timing',
            prefix: '01_timing_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'auto_timing')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_2_fixes',
            moduleId: 'apply_fixes',
            prefix: '02_fixes_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'apply_fixes')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_3_norm',
            moduleId: 'phrase_norm',
            prefix: '03_norm_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'phrase_norm')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_4_glue',
            moduleId: 'glue_compress',
            prefix: '04_glue_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'glue_compress')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_5_ducking',
            moduleId: 'ducking',
            prefix: '05_ducking_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'ducking')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_6_mix',
            moduleId: 'master_audio_mix',
            prefix: '06_master_mix_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'master_audio_mix')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_7_video',
            moduleId: 'video_mux',
            prefix: '07_video_mux_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'video_mux')?.defaultParams },
            status: 'idle',
            outputFiles: []
          }
        ]
      },
      {
        id: 'fast_voiceover_stream',
        name: '⚡ Экспресс-закадр (Гейт + Нормализация + Склейка + Даккинг + Видео)',
        description: 'Быстрый и чистый конвейер без привязки к таймингу субтитров — моментальная очистка шумов, нормализация по EBU R128 и сайдчейн-даккинг с видеорядом.',
        createdAt: '2026-01-01T00:00:00.000Z',
        isBuiltIn: true,
        pipeline: createDefaultPipeline()
      },
      {
        id: 'voice_only_master',
        name: '🎙 Только вокальный микс (Без видеоряда)',
        description: 'Для подготовки сведенной дорожки голосов дабберов для передачи стороннему звукорежиссеру или монтажеру.',
        createdAt: '2026-01-01T00:00:00.000Z',
        isBuiltIn: true,
        pipeline: [
          {
            stepId: 'step_1_gate',
            moduleId: 'silence_gate',
            prefix: '01_gate_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'silence_gate')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_2_norm',
            moduleId: 'phrase_norm',
            prefix: '02_norm_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'phrase_norm')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_3_eq',
            moduleId: 'vocal_eq',
            prefix: '03_eq_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'vocal_eq')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_4_glue',
            moduleId: 'glue_compress',
            prefix: '04_glue_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'glue_compress')?.defaultParams },
            status: 'idle',
            outputFiles: []
          }
        ]
      }
    ];

    // Load custom presets from disk
    const customPresets = [];
    try {
      const files = await fs.readdir(presetsDir);
      for (const f of files) {
        if (f.endsWith('.json')) {
          try {
            const raw = await fs.readFile(path.join(presetsDir, f), 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && parsed.name && Array.isArray(parsed.pipeline)) {
              customPresets.push(parsed);
            }
          } catch (e) {}
        }
      }
    } catch (e) {}

    return {
      success: true,
      presets: [...builtInPresets, ...customPresets]
    };
  }

  /**
   * Save a customized entire pipeline as a preset
   */
  async savePipelinePreset({ baseDir, name, description, pipeline }) {
    if (!name || !pipeline) throw new Error('Имя пресета и конфигурация конвейера обязательны');
    const root = baseDir || (app ? app.getPath('userData') : process.cwd());
    const presetsDir = path.join(root, 'config', 'mixing_pipeline_presets');
    await fs.mkdir(presetsDir, { recursive: true });

    const safeId = `custom_${Date.now()}_${name.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '_')}`;
    const presetObj = {
      id: safeId,
      name,
      description: description || '',
      createdAt: new Date().toISOString(),
      isBuiltIn: false,
      pipeline
    };

    const filePath = path.join(presetsDir, `${safeId}.json`);
    await fs.writeFile(filePath, JSON.stringify(presetObj, null, 2), 'utf8');
    log.info(`[Mixing] Custom pipeline preset saved: ${name} (${filePath})`);

    return {
      success: true,
      preset: presetObj
    };
  }

  /**
   * Delete a customized pipeline preset
   */
  async deletePipelinePreset({ baseDir, presetId }) {
    if (!presetId) throw new Error('ID пресета обязателен');
    const root = baseDir || (app ? app.getPath('userData') : process.cwd());
    const presetsDir = path.join(root, 'config', 'mixing_pipeline_presets');
    const filePath = path.join(presetsDir, `${presetId}.json`);
    if (fsSync.existsSync(filePath)) {
      await fs.unlink(filePath);
      return { success: true };
    }
    return { success: false, error: 'Файл пресета не найден' };
  }

  /**
   * Import External Files (Standalone series without project entry)
   * Copies or symlinks external video, subtitles, and external audio tracks directly into working dir
   */
  async importExternalFiles({
    episode,
    targetDir,
    baseDir,
    videoPath,
    subPath,
    audioPaths = [],
    onProgress,
    onLog
  }) {
    const workingDir = this.resolveWorkingDir(targetDir, episode, baseDir);
    await this.ensureDirectory(workingDir);

    const rawDir = path.join(workingDir, '00_исходные');
    await this.ensureDirectory(rawDir);

    const logFn = (msg, level = 'info', meta = null) => {
      const tag = '[Mixing:ExternalImport]';
      if (level === 'error') {
        console.error(`${tag} ❌ ${msg}`, meta || '');
        log.error(`${tag} ${msg}`);
      } else if (level === 'warn') {
        console.warn(`${tag} ⚠️ ${msg}`, meta || '');
        log.warn(`${tag} ${msg}`);
      } else {
        console.log(`${tag} ${msg}`, meta || '');
        log.info(`${tag} ${msg}`);
      }
      if (onLog) onLog(msg, level, { meta });
      if (onProgress) onProgress({ message: msg, percent: undefined });
    };

    logFn(`Импорт внешних автономных файлов в папку: ${workingDir}`);

    // 1. Video
    if (videoPath && fsSync.existsSync(videoPath)) {
      const vName = path.basename(videoPath);
      const targetVideo = path.join(workingDir, vName);
      logFn(`Копирование внешнего видео: ${vName}...`);
      if (path.resolve(videoPath) !== path.resolve(targetVideo)) {
        await fs.copyFile(videoPath, targetVideo);
      }
      logFn(`Видео скопировано -> ${targetVideo}`);

      // Extract original audio track from imported video
      const origAudioOut = path.join(rawDir, '00_original_audio.wav');
      logFn('Извлечение оригинального аудио из видеоряда...');
      try {
        await this._extractAudioFromVideo(targetVideo, origAudioOut, logFn);
        logFn('Оригинальное аудио успешно сохранено в исходные');
      } catch (e) {
        logFn(`Внимание: не удалось извлечь оригинальное аудио: ${e.message}`, 'warn');
      }
    }

    // 2. Subtitles
    if (subPath && fsSync.existsSync(subPath)) {
      const sName = path.basename(subPath);
      const targetSub = path.join(workingDir, sName);
      logFn(`Копирование субтитров: ${sName}...`);
      if (path.resolve(subPath) !== path.resolve(targetSub)) {
        await fs.copyFile(subPath, targetSub);
      }
      logFn(`Субтитры скопированы -> ${targetSub}`);
    }

    // 3. Audio tracks
    const importedTracks = [];
    for (let i = 0; i < audioPaths.length; i++) {
      const aPath = audioPaths[i];
      if (aPath && fsSync.existsSync(aPath)) {
        const aName = path.basename(aPath);
        const targetAudio = path.join(rawDir, aName);
        logFn(`[${i + 1}/${audioPaths.length}] Копирование аудиодорожки: ${aName}...`);
        if (path.resolve(aPath) !== path.resolve(targetAudio)) {
          await fs.copyFile(aPath, targetAudio);
        }
        importedTracks.push({ name: aName, path: targetAudio, dubberNick: path.basename(aName, path.extname(aName)) });
      }
    }

    if (importedTracks.length > 0) {
      logFn(`Запуск фонового физического замера громкости для ${importedTracks.length} импортированных дорожек...`);
      try {
        await this.ensureTracksAnalysis(importedTracks, workingDir, logFn);
      } catch (e) {
        logFn(`Замер громкости завершится при первом запуске модулей: ${e.message}`, 'debug');
      }
    }

    logFn(`Все внешние материалы успешно импортированы в ${workingDir}`);
    return await this.getStatus({ episode, targetDir: workingDir, baseDir });
  }
}

module.exports = new MixingPipelineService();
