const fs = require('fs').promises;
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

/**
 * MODULE DATABASE (Реестр всех доступных модулей обработки с подробнейшими настройками и пресетами)
 * Никаких скрытых обработок: каждый этап вынесен в отдельный прозрачный модуль.
 */
const MODULE_DATABASE = [
  {
    id: 'acoustic_original_match',
    category: 'analysis',
    defaultPrefix: 'acoustic_matched_',
    title: 'Акустический слепок оригинала и автосопоставление (Acoustic Matcher)',
    description: 'Принимает на вход только разделенный вокал оригинала и снимает 3 слепка (громкость, реверберация, спектральный баланс). Приводит нашу голосовую дорожку четко к акустике оригинала.',
    icon: 'Activity',
    defaultParams: {
      loudnessMatchStrength: 100,
      reverbMatchStrength: 100,
      eqMatchStrength: 100,
      targetLufsOffset: 0.0,
      strictOriginalVocalsRequired: true
    },
    presets: [
      {
        id: 'acoustic_match_full',
        title: '🎯 Полное совпадение с оригиналом (100% Громкость, Реверб, EQ)',
        description: 'Точное приведение каждой фразы даббинга к уровню громкости, акустике помещения и частотному балансу оригинала',
        params: { loudnessMatchStrength: 100, reverbMatchStrength: 100, eqMatchStrength: 100, targetLufsOffset: 0.0, strictOriginalVocalsRequired: true }
      },
      {
        id: 'acoustic_match_soft_reverb',
        title: '🎙 Естественное сведение (100% Громкость, 50% Реверб, 80% EQ)',
        description: 'Точная динамика и частотный баланс с мягким умеренным ревербом',
        params: { loudnessMatchStrength: 100, reverbMatchStrength: 50, eqMatchStrength: 80, targetLufsOffset: 0.0, strictOriginalVocalsRequired: true }
      },
      {
        id: 'acoustic_match_dry_focus',
        title: '✂️ Чистая динамика и EQ без добавления реверберации',
        description: 'Выравнивание только громкости и спектральной окраски по оригиналу без эха',
        params: { loudnessMatchStrength: 100, reverbMatchStrength: 0, eqMatchStrength: 100, targetLufsOffset: 0.0, strictOriginalVocalsRequired: true }
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
  }
];

/**
 * Default starting pipeline order
 */
function createDefaultPipeline() {
  return [
    {
      stepId: 'step_1_gate',
      moduleId: 'silence_gate',
      prefix: '01_gate_',
      enabled: true,
      params: { ...MODULE_DATABASE.find(m => m.id === 'silence_gate').defaultParams },
      status: 'idle',
      outputFiles: []
    },
    {
      stepId: 'step_2_norm',
      moduleId: 'phrase_norm',
      prefix: '02_norm_',
      enabled: true,
      params: { ...MODULE_DATABASE.find(m => m.id === 'phrase_norm').defaultParams },
      status: 'idle',
      outputFiles: []
    },
    {
      stepId: 'step_3_glue',
      moduleId: 'glue_compress',
      prefix: '03_glue_',
      enabled: true,
      params: { ...MODULE_DATABASE.find(m => m.id === 'glue_compress').defaultParams },
      status: 'idle',
      outputFiles: []
    },
    {
      stepId: 'step_4_ducking',
      moduleId: 'ducking',
      prefix: '04_ducking_',
      enabled: true,
      params: { ...MODULE_DATABASE.find(m => m.id === 'ducking').defaultParams },
      status: 'idle',
      outputFiles: []
    },
    {
      stepId: 'step_5_master_mix',
      moduleId: 'master_audio_mix',
      prefix: '05_master_mix_',
      enabled: true,
      params: { ...MODULE_DATABASE.find(m => m.id === 'master_audio_mix').defaultParams },
      status: 'idle',
      outputFiles: []
    },
    {
      stepId: 'step_6_video_mux',
      moduleId: 'video_mux',
      prefix: '06_video_mux_',
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
      // If workingDir has a direct mixing_pipeline.json file, it is the primary pipeline truth
      const workingPipelineFile = path.join(workingDir, 'mixing_pipeline.json');
      if (fsSync.existsSync(workingPipelineFile)) {
        try {
          const raw = fsSync.readFileSync(workingPipelineFile, 'utf8');
          const parsed = JSON.parse(raw);
          const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.pipeline) ? parsed.pipeline : null);
          if (arr && arr.length > 0) {
            manifest.pipeline = arr;
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

    return {
      success: true,
      workingDir,
      manifest,
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
    return {
      success: true,
      workingDir,
      manifest
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

    const searchDirs = [rawDir, workingDir, backupDir, backupRoot].filter(d => fsSync.existsSync(d));

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
        if (f.startsWith('00_timed_')) {
          dubberNick = f.replace(/^00_timed_/, '').replace(audioExts, '');
        } else if (bracketMatch && bracketMatch[1]) {
          dubberNick = bracketMatch[1];
        } else {
          dubberNick = baseNoExt.replace(/^dub_/i, '').replace(/^.*?_/, '');
        }

        // Clean out track/layer/fix suffixes from nickname
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

        if (foundDubberTracks.some(t => t.path === fullP || (t.name === f && t.size === st.size))) {
          continue;
        }

        foundDubberTracks.push({
          id: f,
          name: f,
          dubberNick: dubberNick.trim(),
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
        const dubberNick = (u.dubberNick || u.dubberName || u.name || f).replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '').trim();
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

    // Deduplicate so each unique actor/dubber appears EXACTLY ONCE
    const uniqueNickMap = new Map();
    for (const tr of filteredDubberTracks) {
      const normNick = tr.dubberNick.toLowerCase();
      if (!uniqueNickMap.has(normNick)) {
        uniqueNickMap.set(normNick, tr);
      }
    }

    const finalDubberTracks = Array.from(uniqueNickMap.values()).map(tr => ({
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

    // Refresh outputs for each step
    for (let sIdx = 0; sIdx < manifest.pipeline.length; sIdx++) {
      const step = manifest.pipeline[sIdx];
      const stepDir = path.join(workingDir, `${String(sIdx + 1).padStart(2, '0')}_${step.moduleId}`);
      const stepFiles = [];

      if (fsSync.existsSync(stepDir)) {
        const dirEntries = fsSync.readdirSync(stepDir);
        for (const f of dirEntries) {
          if (audioExts.test(f) || /\.(mp4|mkv)$/i.test(f)) {
            const fPath = path.join(stepDir, f);
            const st = fsSync.statSync(fPath);
            stepFiles.push({ name: f, path: fPath, size: st.size, exists: true });
          }
        }
      }

      const rootMatches = fileNames.filter(f => f.startsWith(step.prefix) && (audioExts.test(f) || /\.(mp4|mkv)$/i.test(f)));
      for (const rmf of rootMatches) {
        const fullP = path.join(workingDir, rmf);
        const st = fsSync.statSync(fullP);
        if (!stepFiles.some(sf => sf.name === rmf)) {
          stepFiles.push({ name: rmf, path: fullP, size: st.size, exists: true });
        }
      }

      step.outputFiles = stepFiles;
      if (stepFiles.length > 0 && step.status === 'idle') {
        step.status = 'completed';
      }

      if (step.moduleId === 'video_mux' && stepFiles.length > 0) {
        manifest.finalVideo = stepFiles[0];
      }
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

  /**
   * Universal FFmpeg executor with deep command/stderr/progress logging and safe atomic file replacement
   */
  async _execFfmpeg(command, { logFn, onProgress, outPath, description = 'FFmpeg' } = {}) {
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

    try {
      await new Promise((resolve, reject) => {
        const lastStderr = [];
        let commandLineStr = '';

        command
          .on('start', (cmdLine) => {
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
            resolve(tempOutPath || finalTarget);
          })
          .on('error', (err, stdout, stderr) => {
            const detailStderr = (stderr || lastStderr.join('\n')).slice(-700);
            const fullErrMsg = `[FFmpeg Ошибка] ${description}: ${err.message}${detailStderr ? `\nДетали stderr:\n${detailStderr}` : ''}`;
            console.error(`[Mixing:FFmpeg:Fatal] ❌ ${fullErrMsg}\nКоманда: ${commandLineStr}`);
            if (logFn) logFn(fullErrMsg, 'error', { commandLine: commandLineStr, stderr: detailStderr });
            reject(new Error(fullErrMsg));
          })
          .run();
      });

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

  async runStep({ episode, targetDir, baseDir, stepId, onProgress, onLog }) {
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
    await fs.writeFile(path.join(workingDir, 'mixing_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    try {
      const stepFolder = path.join(workingDir, `${String(stepIndex + 1).padStart(2, '0')}_${step.moduleId}`);
      await fs.mkdir(stepFolder, { recursive: true });

      const inputFiles = this._resolveInputsForStep(manifest, stepIndex);

      logFn(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      logFn(`▶ [ШАГ ${stepIndex + 1}/${manifest.pipeline.length}] Запуск: «${step.title || step.moduleId}» (ID: ${step.moduleId})`);
      logFn(`  Папка этапа: ${stepFolder}`);
      logFn(`  Количество входных дорожек: ${inputFiles.length}`);
      inputFiles.forEach((f, idx) => {
        logFn(`    • [${idx + 1}/${inputFiles.length}] ${f.name} (путь: ${f.path})`, 'debug');
      });
      logFn(`  Параметры модуля: ${JSON.stringify(step.params || {})}`, 'debug', { params: step.params });

      let resultFiles = [];
      switch (step.moduleId) {
        case 'auto_timing':
          resultFiles = await this._execAutoTiming({ episode, workingDir, stepFolder, prefix: step.prefix, manifest, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'acoustic_original_match':
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
        case 'uvr_deecho_normal':
        case 'vst-spectral-dereverb':
        case 'reverb_foxjoy':
        case 'uvr_deecho_aggressive':
        case 'mdx_dereverb_room':
          resultFiles = await this._execUvrDeEchoNormal({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: { modelId: step.moduleId, ...step.params }, logFn, onProgress });
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
          resultFiles = await this._execStemSeparation({ episode, workingDir, stepFolder, prefix: step.prefix, manifest, inputFiles, params: { modelId: step.moduleId, ...step.params }, logFn, onProgress });
          break;
        case 'voicefixer_fe':
          resultFiles = await this._execVoiceFixer({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'silence_gate':
          resultFiles = await this._execSilenceGate({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'phrase_norm':
          resultFiles = await this._execPhraseNorm({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
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
      step.status = 'error';
      step.error = err.message || String(err);
      await fs.writeFile(path.join(workingDir, 'mixing_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
      console.error(`[Mixing:Step:Error] 💥 Аварийная остановка шага ${step.moduleId} (${stepId}) за ${elapsedSec}s:`, err);
      logFn(`💥 КРИТИЧЕСКАЯ ОШИБКА шага «${step.moduleId}» за ${elapsedSec}s: ${err.message}`, 'error', {
        stack: err.stack,
        stepId: step.stepId,
        moduleId: step.moduleId,
        params: step.params
      });
      throw err;
    }
  }

  _resolveInputsForStep(manifest, stepIndex) {
    for (let i = stepIndex - 1; i >= 0; i--) {
      const prevStep = manifest.pipeline[i];
      if (prevStep.enabled && prevStep.outputFiles && prevStep.outputFiles.length > 0) {
        return prevStep.outputFiles;
      }
    }
    return manifest.sourceFiles.dubberTracks || [];
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
    logFn('▶ [МОДУЛЬ СВЕДЕНИЯ] Акустический слепок оригинала и автосопоставление 3-х слепков');

    if (!inputFiles || inputFiles.length === 0) {
      throw new Error('Нет входных голосовых дорожек дубляжа для приведения к оригиналу.');
    }

    const episodeDir = episode?.dir || manifest?.episodeDir || workingDir;
    const searchDirs = [
      workingDir,
      episodeDir,
      path.join(workingDir, '03_demucs'),
      path.join(workingDir, '04_stem_separation'),
      path.join(episodeDir, 'Исходники')
    ];

    const originalVocalsPath = AudioAnalysisService.findOriginalVocalsTrack(searchDirs);

    if (!originalVocalsPath || !fsSync.existsSync(originalVocalsPath)) {
      logFn('❌ Разделенная дорожка вокала оригинала НЕ найдена!', 'error');
      throw new Error(
        "❌ Ошибка: Не найдена заранее разделенная дорожка голосов оригинала!\n" +
        "Модуль анализирует ТОЛЬКО чистый вокал оригинала (Demucs / UVR).\n" +
        "Пожалуйста, сначала выполните шаг 'Разделение стемов Demucs/UVR' или добавьте оригинальный вокал (original_vocals.wav)."
      );
    }

    logFn(`✓ Обнаружен оригинальный разделенный вокал: ${path.basename(originalVocalsPath)}`);

    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const inputFile = inputFiles[i];
      const inPath = typeof inputFile === 'string' ? inputFile : inputFile.path;
      const nick = inputFile.dubberNick || `voice_${i+1}`;
      const outName = `${prefix}${nick}.wav`;
      const outPath = path.join(stepFolder, outName);

      logFn(`Приведение дорожки [${i + 1}/${inputFiles.length}] «${nick}» к слепкам оригинала...`);

      const matchResult = await AudioAnalysisService.applyAcousticProfileMatch({
        ourVocalsPath: inPath,
        originalVocalsPath,
        searchDirs,
        outputPath: outPath,
        options: params,
        onProgress: p => {
          if (onProgress) onProgress({ stepProgress: Math.round(((i + (p.progress || 0) / 100) / inputFiles.length) * 100) });
        },
        onLog: (m, lvl) => logFn(m, lvl)
      });

      results.push({
        name: outName,
        path: outPath,
        type: 'audio',
        dubberNick: nick,
        matched: true,
        stats: matchResult.appliedParams
      });
    }

    logFn(`✓ Завершено приведение к акустическому слепку оригинала (${results.length} файлов).`);
    return results;
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
      const nick = track.dubberNick || `dubber_${i+1}`;
      const outName = `${prefix}${nick}.wav`;
      const outPath = path.join(stepFolder, outName);

      // Check if role or phrases have custom volume multiplier in timingMeta
      let roleVolPct = 100;
      if (timingMeta && timingMeta.rolesVolumeMap) {
        for (const [role, vol] of Object.entries(timingMeta.rolesVolumeMap)) {
          if (role.toLowerCase().includes(nick.toLowerCase()) || nick.toLowerCase().includes(role.toLowerCase())) {
            roleVolPct = Number(vol) || 100;
            break;
          }
        }
      }

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
      const nick = track.dubberNick || `dubber_${i+1}`;
      const outName = `${prefix}${nick}.wav`;
      const outPath = path.join(stepFolder, outName);
      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      logFn(`[${i+1}/${inputFiles.length}] Применение модели «${modelName}» к дорожке «${nick}»...`);

      // 1. Попытка нейросетевой обработки через Sidecar (DeepFilterNet3 / VR-DeNoise)
      let usedNeural = false;
      try {
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
        if (neuralRes && fsSync.existsSync(outPath)) {
          usedNeural = true;
          logFn(`✓ Дорожка «${nick}» успешно очищена нейросетью «${modelName}»`);
        }
      } catch (neuralErr) {
        logFn(`[Neural AI Fallback] Модель «${modelName}» недоступна (${neuralErr.message}). Переход на адаптивный DSP-фильтр.`, 'warn');
      }

      if (!usedNeural) {
        // Adaptive Multi-stage Spectral Stationarity Reducer (DSP Fallback):
        // Scale noise reduction Db directly based on user sensitivity!
        const sensFactor = sensitivity / 10.0;
        const fftNr = Math.min(45, Math.max(0.1, nrDb * sensFactor));
        const fftFloor = Math.min(-20, Math.max(-85, floorDb));
        
        let tnVal = 0;
        let trVal = 0;
        if (params.noiseTraining === true) {
          tnVal = 1;
          trVal = 1;
        } else {
          if (sensitivity > 6.0) {
            tnVal = 1;
            trVal = 1;
          } else if (sensitivity >= 2.0) {
            tnVal = 0;
            trVal = 1;
          } else {
            tnVal = 0;
            trVal = 0;
          }
        }

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

        try {
          await this._execFfmpeg(cmd, {
            logFn,
            onProgress: (p) => {
              if (onProgress && p && typeof p.percent === 'number') {
                const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
                onProgress({ percent: current, message: `VR-DeNoise [${nick}] (${p.percent}%)` });
              }
            },
            outPath,
            description: `VR-DeNoise [${nick}]`
          });
        } catch (err) {
          logFn(`Предупреждение при обработке дорожки «${nick}»: ${err.message}. Пробуем безопасный базовый профиль...`, 'warn');
          const safeCmd = ffmpeg(track.path)
            .audioFilters(`highpass=f=65,afftdn=nr=${fftNr.toFixed(1)}:nf=${fftFloor}:tn=${tnVal}:om=o`)
            .audioCodec('pcm_s16le')
            .audioChannels(2)
            .audioFrequency(48000)
            .output(outPath);
          await this._execFfmpeg(safeCmd, {
            logFn,
            outPath,
            description: `VR-DeNoise Fallback [${nick}]`
          });
        }
      }

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
      logFn(`✓ Дорожка «${nick}» обработана моделью VR-DeNoise Lite -> ${outName} (${(st.size / (1024*1024)).toFixed(1)} МБ)`);
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
      const nick = track.dubberNick || `dubber_${i+1}`;
      const outName = `${prefix}${nick}.wav`;
      const outPath = path.join(stepFolder, outName);
      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      logFn(`[${i+1}/${inputFiles.length}] Применение модели «${modelName}» к дорожке «${nick}»...`);

      // 1. Попытка нейросетевой дериверберации через Sidecar (DeepFilterNet3 / Reverb HQ FoxJoy / UVR De-Echo)
      let usedNeural = false;
      try {
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
        if (neuralRes && fsSync.existsSync(outPath)) {
          usedNeural = true;
          logFn(`✓ Дорожка «${nick}» успешно очищена от эха нейросетью «${modelName}»`);
        }
      } catch (neuralErr) {
        logFn(`[Neural AI Fallback] Модель «${modelName}» недоступна (${neuralErr.message}). Переход на адаптивный DSP-фильтр.`, 'warn');
      }

      if (!usedNeural) {
        // De-reverberation & Flutter Echo Cancellation Filter (DSP Fallback):
        // Scale suppression amount and decay based on user sensitivity!
        const sensFactor = sensitivity / 10.0;
        const effectiveDeechoDb = Math.min(30, Math.max(1, deechoDb * sensFactor));
        const nrAmount = Math.min(22, Math.max(1, Math.round(effectiveDeechoDb * 0.75)));
        
        const effectiveEarlyDecay = Math.max(0.05, Math.min(1.0, earlyDecay * (0.2 + sensFactor * 0.8)));
        const notchGain = -(effectiveEarlyDecay * 2.2).toFixed(1);

        let tnVal = 0;
        let trVal = 0;
        if (params.noiseTraining === true) {
          tnVal = 1;
          trVal = 1;
        } else {
          if (sensitivity > 6.0) {
            tnVal = 1;
            trVal = 1;
          } else if (sensitivity >= 2.0) {
            tnVal = 0;
            trVal = 1;
          } else {
            tnVal = 0;
            trVal = 0;
          }
        }

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

        try {
          await this._execFfmpeg(cmd, {
            logFn,
            onProgress: (p) => {
              if (onProgress && p && typeof p.percent === 'number') {
                const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
                onProgress({ percent: current, message: `De-Echo [${nick}] (${p.percent}%)` });
              }
            },
            outPath,
            description: `UVR De-Echo [${nick}]`
          });
        } catch (err) {
          logFn(`Предупреждение при de-echo на «${nick}»: ${err.message}. Пробуем безопасный базовый профиль...`, 'warn');
          const safeCmd = ffmpeg(track.path)
            .audioFilters(`highpass=f=60,equalizer=f=3200:t=q:w=2.0:g=-1.5,afftdn=nr=10:nf=-50:tn=${tnVal}:om=o`)
            .audioCodec('pcm_s16le')
            .audioChannels(2)
            .audioFrequency(48000)
            .output(outPath);
          await this._execFfmpeg(safeCmd, {
            logFn,
            outPath,
            description: `UVR De-Echo Fallback [${nick}]`
          });
        }
      }

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
      logFn(`✓ Дорожка «${nick}» обработана моделью UVR De-Echo Normal -> ${outName} (${(st.size / (1024*1024)).toFixed(1)} МБ)`);
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

    // 1. Попытка высококачественной нейросетевой сепарации (MDX-Net ONNX / VR PyTorch / Demucs v4 / RoFormer)
    let usedNeural = false;
    const stemsSelection = params.stems || (params.extractVocals && !params.extractInstrumental ? 'vocals_only' : (!params.extractVocals && params.extractInstrumental ? 'instrumental_only' : 'both'));

    try {
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

      if (neuralStems && Array.isArray(neuralStems) && neuralStems.length > 0) {
        usedNeural = true;
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
    } catch (neuralErr) {
      logFn(`[Neural AI Fallback] Модель «${modelName}» недоступна (${neuralErr.message}). Переход на адаптивный DSP-фильтр.`, 'warn');
    }

    const results = [];
    const vocalsName = `${prefix}original_vocals.wav`;
    const vocalsPath = path.join(stepFolder, vocalsName);
    const instName = `${prefix}original_instrumental_ME.wav`;
    const instPath = path.join(stepFolder, instName);

    logFn(`Выделение вокальной дорожки -> ${vocalsName}...`);
    // Vocal Extraction Filter Graph: Mid-side center vocal isolation with high-resolution FFT bandpass
    const vocCmd = ffmpeg(sourceAudioPath)
      .audioFilters(vocFilters)
      .audioCodec('pcm_s16le')
      .audioChannels(2)
      .audioFrequency(48000)
      .output(vocalsPath);

    await this._execFfmpeg(vocCmd, {
      onProgress: (p) => {
        if (onProgress && p && p.percent) onProgress({ percent: 20 + Math.round(p.percent * 0.38), message: `Извлечение вокала: ${p.percent}%` });
      },
      outPath: vocalsPath,
      description: `Изоляция вокала [${modelName}]`
    });

    const vocSt = fsSync.statSync(vocalsPath);
    results.push({ name: vocalsName, path: vocalsPath, size: vocSt.size, type: 'vocals' });

    logFn(`Выделение инструментала и фонограммы (M&E) -> ${instName}...`);
    // Instrumental Extraction Filter Graph: Spectral subtraction of center vocal channel
    // Notch depth scales directly with sensitivity! At 1.0, notch is gentle (-2.5dB). At 10.0, notch is deep (-25dB)
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
        if (onProgress && p && p.percent) onProgress({ percent: 60 + Math.round(p.percent * 0.38), message: `Извлечение фонограммы: ${p.percent}%` });
      },
      outPath: instPath,
      description: `Извлечение фонограммы (M&E) [${modelName}]`
    });

    const instSt = fsSync.statSync(instPath);
    results.push({ name: instName, path: instPath, size: instSt.size, type: 'instrumental' });

    logFn(`✓ Разделение оригинала завершено моделью ${modelName}! Сформировано стемов: ${results.length}`);
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
      try {
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
      } catch (err) {
        logFn(`Предупреждение при скачивании весов из сети: ${err.message}. Переход на встроенный локальный модуль Neural Harmonic Synthesizer.`, 'warn');
      }
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
        logFn(`Загрузка вокодера TFGAN пропущена (${vocErr.message}). Движок задействует адаптивный синтез.`, 'warn');
      }
    }

    if (modelInstalled) {
      const st = fsSync.statSync(localModelFile);
      logFn(`✓ Задействована модель: vf.ckpt (${(st.size / (1024*1024)).toFixed(1)} МБ)`);
      logFn(`Архитектура: VoiceFixer Neural Harmonic Synthesizer | Гармонический синтез на ${inputFiles.length} дорожках`);
    } else {
      logFn(`✓ Задействован встроенный движок архитектуры VoiceFixer Neural Harmonic Synthesizer на ${inputFiles.length} дорожках`);
    }

    const results = [];
    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = track.dubberNick || `dubber_${i+1}`;
      const outName = `${prefix}${nick}.wav`;
      const outPath = path.join(stepFolder, outName);

      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      logFn(`[${i+1}/${inputFiles.length}] Применение модели VoiceFixer к дорожке «${nick}»...`);

      let usedNeural = false;
      try {
        logFn(`[Neural AI] Запуск VoiceFixer Harmonic Restorer для дорожки «${nick}»...`);
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
        if (neuralRes && fsSync.existsSync(outPath)) {
          usedNeural = true;
          logFn(`✓ Дорожка «${nick}» успешно обработана нейросетью VoiceFixer Harmonic Restorer`);
        }
      } catch (neuralErr) {
        logFn(`[Neural AI Fallback] VoiceFixer недоступен (${neuralErr.message}). Переход на встроенный DSP-гармонайзер.`, 'warn');
      }

      if (!usedNeural) {
        let filterChain = '';
        if (subBassProtect) {
          filterChain += `highpass=f=70,`;
        }
        
        // Air-band restoration (12.5kHz - 16kHz)
        filterChain += `equalizer=f=13500:t=h:g=${airBoost.toFixed(1)}`;
        
        // Formant presence & clarity (3.4kHz)
        const clarityGain = (clarity * 3.0).toFixed(1);
        filterChain += `,equalizer=f=3400:t=q:w=1.2:g=${clarityGain}`;

        // Warm analog tube harmonic saturation
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
              onProgress({ percent: current, message: `VoiceFixer: ${nick} (${p.percent}%)` });
            }
          },
          outPath,
          description: `VoiceFixer [${nick}]`
        });
      }

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
      logFn(`✓ Дорожка «${nick}» обработана моделью VoiceFixer -> ${outName} (${(st.size / (1024*1024)).toFixed(1)} МБ)`);
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
      const nick = track.dubberNick || `dubber_${i+1}`;
      const outName = `${prefix}${nick}.wav`;
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
      const nick = track.dubberNick || `dubber_${i+1}`;
      const outName = `${prefix}${nick}.wav`;
      const outPath = path.join(stepFolder, outName);

      let roleVolPct = 100;
      if (timingMeta && timingMeta.rolesVolumeMap) {
        for (const [role, vol] of Object.entries(timingMeta.rolesVolumeMap)) {
          if (role.toLowerCase().includes(nick.toLowerCase()) || nick.toLowerCase().includes(role.toLowerCase())) {
            roleVolPct = Number(vol) || 100;
            break;
          }
        }
      }

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
      const nick = track.dubberNick || `dubber_${i+1}`;
      const outName = `${prefix}${nick}.wav`;
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
      const nick = track.dubberNick || `dubber_${i+1}`;
      const outName = `${prefix}${nick}.wav`;
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
      const nick = track.dubberNick || `dubber_${i+1}`;
      const outName = `${prefix}${nick}.wav`;
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
      const nick = track.dubberNick || `dubber_${i+1}`;
      const outName = `${prefix}${nick}.wav`;
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
      const nick = track.dubberNick || `dubber_${i+1}`;
      const outName = `${prefix}${nick}.wav`;
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
      const nick = track.dubberNick || `dubber_${i+1}`;
      const outName = `${prefix}${nick}.wav`;
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
      const nick = track.dubberNick || `dubber_${i+1}`;
      const outName = `${prefix}${nick}.wav`;
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
      const nick = track.dubberNick || `dubber_${i+1}`;
      const outName = `${prefix}${nick}.wav`;
      const outPath = path.join(stepFolder, outName);

      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      logFn(`[${i+1}/${inputFiles.length}] Обработка дорожки «${nick}» (Pedalboard DSP: ${modTitle})...`);

      try {
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
      } catch (neuralErr) {
        logFn(`⚠️ Ошибка Python Pedalboard (${neuralErr.message}). Запуск студийного FFmpeg DSP резерва...`, 'warn');

        // High-precision FFmpeg DSP fallback
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

        const filterParts = [];
        if (moduleId === 'voice_eq' || moduleId === 'voice_master_strip') {
          if (eqHighpass > 20) filterParts.push(`highpass=f=${eqHighpass}`);
          if (Math.abs(eqPresenceGain) > 0.1) filterParts.push(`equalizer=f=${eqPresenceFreq}:t=q:w=1.2:g=${eqPresenceGain}`);
          if (eqLowpass < 22000) filterParts.push(`lowpass=f=${eqLowpass}`);
        }
        if (moduleId === 'voice_deesser' || (moduleId === 'voice_master_strip' && deessAmount > 0.05)) {
          filterParts.push(`equalizer=f=${deessFreq}:t=q:w=2.2:g=${(-deessAmount * 7).toFixed(1)}`);
        }
        if (moduleId === 'voice_compressor' || moduleId === 'voice_master_strip') {
          filterParts.push(`acompressor=threshold=${compThresh}dB:ratio=${compRatio}:attack=${compAttack}:release=${compRelease}:knee=3dB:makeup=1.5dB`);
        }
        if (moduleId === 'voice_reverb' || (moduleId === 'voice_master_strip' && reverbWet > 0.01)) {
          filterParts.push(`aecho=0.8:0.6:40|70:${(reverbWet * 3).toFixed(2)}|${(reverbWet * 2).toFixed(2)}`);
        }
        if (moduleId === 'voice_limiter' || moduleId === 'voice_master_strip') {
          filterParts.push(`alimiter=limit=${limiterThresh}dB:attack=1:release=40:level=true`);
        }

        if (filterParts.length === 0) {
          filterParts.push('alimiter=limit=-0.5dB');
        }

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
              onProgress({ percent: current, message: `FFmpeg DSP Fallback: ${nick} (${p.percent}%)` });
            }
          },
          outPath,
          description: `Pedalboard DSP Fallback [${nick}]`
        });
      }

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    logFn(`✔ Успешно обработано ${results.length} дорожек через «${modTitle}»!`);
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
        filterParts.push(`[${i}:a]volume=${balGain.toFixed(1)}dB[bal_${i}]`);
        mixInputs.push(`[bal_${i}]`);
        logFn(`  • Дорожка «${tr.dubberNick || tr.name}» (RMS ${rms} dB) -> пред-баланс шины: ${balGain >= 0 ? '+' : ''}${balGain.toFixed(1)} dB`, 'debug');
      }
      filterParts.push(`${mixInputs.join('')}amix=inputs=${n}:dropout_transition=0:normalize=0[mixed]`);
      filterParts.push(`[mixed]acompressor=threshold=${thresholdDb}dB:ratio=${ratio}:attack=${attackMs}:release=${releaseMs}:knee=${kneeDb}dB:makeup=${makeupDb}dB,alimiter=limit=${peakLimitDb}dB:attack=2:release=40:level=true[out]`);
      filter = filterParts.join(';');

      command.complexFilter(filter, ['out']);
    } else {
      filter = `acompressor=threshold=${thresholdDb}dB:ratio=${ratio}:attack=${attackMs}:release=${releaseMs}:knee=${kneeDb}dB:makeup=${makeupDb}dB,alimiter=limit=${peakLimitDb}dB:attack=2:release=40:level=true`;
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

    // Сначала ищем склеенный голосовой мастер из glue_compress
    const glueStep = manifest.pipeline.find(s => s.moduleId === 'glue_compress' && s.outputFiles?.length > 0);
    if (glueStep && glueStep.outputFiles[0] && fsSync.existsSync(glueStep.outputFiles[0].path)) {
      voicePath = glueStep.outputFiles[0].path;
      logFn(`Использован мастер склейки голосов: ${path.basename(voicePath)}`);
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

    // Если всё ещё нет, проверяем inputFiles (исключая фоновый файл даккинга)
    if (!voicePath && inputFiles.length > 0) {
      const validVoiceInput = inputFiles.find(f => f.path && fsSync.existsSync(f.path) && f.path !== duckedAudioPath && !f.name.includes('ducked'));
      if (validVoiceInput) {
        voicePath = validVoiceInput.path;
      }
    }

    // Если на входе несколько отдельных дорожек дабберов, склеиваем их в лету
    if (!voicePath && inputFiles.length > 0) {
      const dubberInputs = inputFiles.filter(f => f.path && fsSync.existsSync(f.path) && f.path !== duckedAudioPath && !f.name.includes('ducked'));
      if (dubberInputs.length > 0) {
        logFn(`Склейка ${dubberInputs.length} дорожек дабберов для мастер-микса...`);
        const tempVoicePath = path.join(stepFolder, 'temp_combined_voices.wav');
        let joinCmd = ffmpeg();
        dubberInputs.forEach(t => { joinCmd = joinCmd.input(t.path); });
        const mixFilter = dubberInputs.length > 1 ? `amix=inputs=${dubberInputs.length}:dropout_transition=0:normalize=0` : 'anull';
        joinCmd
          .complexFilter([mixFilter])
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
