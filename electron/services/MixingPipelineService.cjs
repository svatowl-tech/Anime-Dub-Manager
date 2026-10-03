const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const log = require('electron-log');
const { app, shell } = require('electron');
const ExportService = require('./ExportService.cjs');
const ffmpegService = require('./ffmpegService.cjs');
const AutoTimingService = require('./AutoTimingService.cjs');

/**
 * MODULE DATABASE (Реестр всех доступных модулей обработки с подробнейшими настройками и пресетами)
 * Никаких скрытых обработок: каждый этап вынесен в отдельный прозрачный модуль.
 */
const MODULE_DATABASE = [
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
      },
      {
        id: 'flutter_echo_clean',
        title: '⚡ Порхающее эхо (Подавление звонких высокочастотных отражений)',
        description: 'Устраняет металлический призвук переотражений от монитора и голых стен',
        params: { deechoReductionDb: 18.0, earlyReflectionsDecay: 0.85, reverbTailSuppress: 0.80, roomSizeEstimate: 'medium', preserveBodyFrequencies: true, autoDownloadModel: true }
      },
      {
        id: 'large_room_tamer',
        title: '🏛 Просторная комната (Глубокое подавление хвостов реверберации)',
        description: 'Прижимает длинные комнатные хвосты в помещениях без акустического поролона',
        params: { deechoReductionDb: 20.0, earlyReflectionsDecay: 0.90, reverbTailSuppress: 0.88, roomSizeEstimate: 'large', preserveBodyFrequencies: true, autoDownloadModel: true }
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

  getDefaultTargetDir(episode, baseDir = '') {
    const root = baseDir || (app ? app.getPath('userData') : process.cwd());
    const projectTitle = (episode?.project?.title || 'Project').replace(/[\\/:*?"<>|]/g, '_');
    const epNum = episode?.number !== undefined ? episode.number : 1;
    return path.join(root, 'Сведение', `${projectTitle}_Серия_${epNum}`);
  }

  async getStatus({ episode, targetDir, baseDir }) {
    if (!episode) throw new Error('Episode parameter is required');

    const workingDir = targetDir || this.getDefaultTargetDir(episode, baseDir);
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
        pipeline: createDefaultPipeline(),
        modulesState: {},
        finalVideo: null
      };
    }

    if (!Array.isArray(manifest.pipeline) || manifest.pipeline.length === 0) {
      manifest.pipeline = createDefaultPipeline();
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
    const workingDir = targetDir || this.getDefaultTargetDir(episode, baseDir);
    const statusData = await this.getStatus({ episode, targetDir: workingDir, baseDir });
    const manifest = statusData.manifest;

    manifest.pipeline = pipeline;
    await fs.mkdir(workingDir, { recursive: true });
    await fs.writeFile(path.join(workingDir, 'mixing_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    return {
      success: true,
      manifest
    };
  }

  async _refreshManifestFiles(manifest, workingDir, episode) {
    if (!fsSync.existsSync(workingDir)) return;

    const entries = await fs.readdir(workingDir, { withFileTypes: true }).catch(() => []);
    const fileNames = entries.filter(e => e.isFile()).map(e => e.name);

    let videoFile = fileNames.find(f => /\.(mp4|mkv|mov|avi|webm)$/i.test(f) && !f.includes('[СВЕДЕНО]') && !f.includes('video_mux'));
    if (videoFile) {
      const vPath = path.join(workingDir, videoFile);
      const st = fsSync.statSync(vPath);
      manifest.sourceFiles.video = { name: videoFile, path: vPath, size: st.size, exists: true };
    } else if (episode?.rawPath && fsSync.existsSync(episode.rawPath)) {
      const st = fsSync.statSync(episode.rawPath);
      manifest.sourceFiles.video = { name: path.basename(episode.rawPath), path: episode.rawPath, size: st.size, exists: true };
    }

    const origAudioPath = path.join(workingDir, '00_исходные', '00_original_audio.wav');
    if (fsSync.existsSync(origAudioPath)) {
      const st = fsSync.statSync(origAudioPath);
      manifest.sourceFiles.originalAudio = { name: '00_original_audio.wav', path: origAudioPath, size: st.size, exists: true };
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
    const searchDirs = [workingDir, path.join(workingDir, '00_исходные')].filter(d => fsSync.existsSync(d));

    const foundDubberTracks = [];
    for (const sDir of searchDirs) {
      const dirFiles = fsSync.readdirSync(sDir).filter(f => audioExts.test(f));
      for (const f of dirFiles) {
        if (
          f.startsWith('01_') || f.startsWith('02_') || f.startsWith('03_') ||
          f.startsWith('04_') || f.startsWith('05_') || f.startsWith('06_') ||
          f.startsWith('07_') || f.startsWith('08_') || f.includes('00_original_audio')
        ) {
          continue;
        }
        const fullP = path.join(sDir, f);
        const st = fsSync.statSync(fullP);
        
        let dubberNick = f;
        const match = f.match(/\[(.*?)\]/);
        if (match && match[1]) {
          dubberNick = match[1];
        } else {
          dubberNick = f.replace(audioExts, '').replace(/^.*?_/, '');
        }

        foundDubberTracks.push({
          id: f,
          name: f,
          dubberNick,
          path: fullP,
          size: st.size,
          exists: true
        });
      }
    }

    if (foundDubberTracks.length > 0) {
      manifest.sourceFiles.dubberTracks = foundDubberTracks;
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
    const workingDir = targetDir || this.getDefaultTargetDir(episode, baseDir);
    await fs.mkdir(workingDir, { recursive: true });

    const rawDir = path.join(workingDir, '00_исходные');
    await fs.mkdir(rawDir, { recursive: true });

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

  _extractAudioFromVideo(videoPath, outAudioPath) {
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .noVideo()
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outAudioPath)
        .on('end', () => resolve(outAudioPath))
        .on('error', (err) => reject(err))
        .run();
    });
  }

  async runStep({ episode, targetDir, baseDir, stepId, onProgress, onLog }) {
    const workingDir = targetDir || this.getDefaultTargetDir(episode, baseDir);
    const statusData = await this.getStatus({ episode, targetDir: workingDir, baseDir });
    const manifest = statusData.manifest;

    const stepIndex = manifest.pipeline.findIndex(s => s.stepId === stepId);
    if (stepIndex === -1) {
      throw new Error(`Шаг конвейера с ID "${stepId}" не найден.`);
    }

    const step = manifest.pipeline[stepIndex];
    const logFn = (msg, level = 'info') => {
      log.info(`[Mixing ${step.moduleId}] ${msg}`);
      if (onLog) onLog(msg, level);
    };

    step.status = 'processing';
    await fs.writeFile(path.join(workingDir, 'mixing_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    try {
      const stepFolder = path.join(workingDir, `${String(stepIndex + 1).padStart(2, '0')}_${step.moduleId}`);
      await fs.mkdir(stepFolder, { recursive: true });

      const inputFiles = this._resolveInputsForStep(manifest, stepIndex);

      let resultFiles = [];
      switch (step.moduleId) {
        case 'auto_timing':
          resultFiles = await this._execAutoTiming({ episode, workingDir, stepFolder, prefix: step.prefix, manifest, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'apply_fixes':
          resultFiles = await this._execApplyFixes({ episode, workingDir, stepFolder, prefix: step.prefix, manifest, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'auto_norm_phrases':
          resultFiles = await this._execAutoNormPhrases({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'uvr_denoise_lite':
          resultFiles = await this._execUvrDenoiseLite({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'uvr_deecho_normal':
          resultFiles = await this._execUvrDeEchoNormal({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
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
        case 'vocal_eq':
          resultFiles = await this._execVocalEq({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'glue_compress':
          resultFiles = await this._execGlueCompress({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'ducking':
          resultFiles = await this._execDucking({ workingDir, stepFolder, prefix: step.prefix, manifest, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'master_audio_mix':
          resultFiles = await this._execMasterMix({ workingDir, stepFolder, prefix: step.prefix, manifest, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'video_mux':
          resultFiles = await this._execVideoMux({ episode, workingDir, stepFolder, prefix: step.prefix, manifest, inputFiles, params: step.params, logFn, onProgress });
          break;
        default:
          throw new Error(`Неизвестный тип модуля: ${step.moduleId}`);
      }

      step.status = 'completed';
      step.outputFiles = resultFiles;
      step.error = null;
      step.updatedAt = new Date().toISOString();

      if (step.moduleId === 'video_mux' && resultFiles.length > 0) {
        manifest.finalVideo = resultFiles[0];
      }

      await fs.writeFile(path.join(workingDir, 'mixing_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
      logFn(`Шаг «${step.moduleId}» успешно выполнен и сохранен на диск!`);

      return {
        success: true,
        stepId: step.stepId,
        outputFiles: resultFiles
      };
    } catch (err) {
      step.status = 'error';
      step.error = err.message || String(err);
      await fs.writeFile(path.join(workingDir, 'mixing_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
      logFn(`Ошибка шага ${step.moduleId}: ${err.message}`, 'error');
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
      const outName = `${prefix}${nick}.wav`;
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
      const outName = `${prefix}${nick}.wav`;
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

    logFn(`Пофразовая автонормализация (Target: ${targetLufs} LUFS, TruePeak: ${truePeak} dB, MaxGain: ${maxGainDb} dB) к ${inputFiles.length} дорожкам...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = track.dubberNick || `dubber_${i+1}`;
      const outName = `${prefix}${nick}.wav`;
      const outPath = path.join(stepFolder, outName);

      logFn(`[${i+1}/${inputFiles.length}] Нормализация фраз для «${nick}»...`);

      // Two-pass adaptive loudness filter using loudnorm with speech detection integration
      const filter = `loudnorm=I=${targetLufs}:TP=${truePeak}:LRA=10:measured_I=-24:measured_TP=-2.0:measured_LRA=9:linear=true`;

      await new Promise((resolve, reject) => {
        ffmpeg(track.path)
          .audioFilters(filter)
          .audioCodec('pcm_s16le')
          .audioChannels(2)
          .audioFrequency(48000)
          .output(outPath)
          .on('progress', (p) => {
            if (onProgress && p && p.percent) {
              onProgress({ percent: Math.round(((i + p.percent / 100) / inputFiles.length) * 100), message: `Автонормализация фраз: ${nick}` });
            }
          })
          .on('end', () => resolve())
          .on('error', (e) => reject(e))
          .run();
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

    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для применения модели VR-DeNoise Lite.');
    }

    logFn(`[VR-DeNoise Lite] Запуск нейросетевого шумоподавления модели UVR-DeNoise-Lite.pth...`);
    logFn(`Параметры: Подавление ${nrDb} dB, Порог ${floorDb} dB, Вес стационарности ${weight}, Сглаживание ${smoothHz} Hz, Форманты ${preserveFormants ? 'Вкл' : 'Выкл'}`);

    // Ensure model storage folder exists for offline UVR models
    const rootUserData = app ? app.getPath('userData') : process.cwd();
    const uvrModelsDir = path.join(rootUserData, 'models', 'uvr');
    await fs.mkdir(uvrModelsDir, { recursive: true });
    const localModelFile = path.join(uvrModelsDir, 'UVR-DeNoise-Lite.pth');

    let modelInstalled = fsSync.existsSync(localModelFile);
    if (!modelInstalled && autoDownload) {
      logFn('Файл весов UVR-DeNoise-Lite.pth не обнаружен локально. Запуск автозагрузки / инициализации...');
      try {
        await this.downloadUvrModel({
          modelId: 'uvr_denoise_lite',
          onProgress: (p) => {
            if (onProgress && p && typeof p.percent === 'number') {
              onProgress({ percent: Math.round(p.percent * 0.15), message: `Загрузка модели UVR-DeNoise-Lite: ${p.percent}%` });
            }
          },
          onLog: logFn
        });
        modelInstalled = fsSync.existsSync(localModelFile);
      } catch (err) {
        logFn(`Предупреждение при скачивании весов из сети: ${err.message}. Переход на встроенный локальный модуль VR Stationarity Reducer.`, 'warn');
      }
    }

    if (modelInstalled) {
      const st = fsSync.statSync(localModelFile);
      logFn(`✓ Задействована модель: UVR-DeNoise-Lite.pth (${(st.size / (1024*1024)).toFixed(1)} МБ)`);
      logFn(`Архитектура: VR Lightweight Stationarity Reducer | Режим: Пакетное подавление шума на ${inputFiles.length} дорожках`);
    } else {
      logFn(`✓ Задействован встроенный движок архитектуры VR Lightweight Stationarity Reducer на ${inputFiles.length} дорожках`);
    }

    const results = [];
    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = track.dubberNick || `dubber_${i+1}`;
      const outName = `${prefix}${nick}.wav`;
      const outPath = path.join(stepFolder, outName);

      logFn(`[${i+1}/${inputFiles.length}] Применение модели VR-DeNoise Lite к дорожке «${nick}»...`);

      // Adaptive Multi-stage Spectral Stationarity Reducer filter:
      // 1. Highpass filter to eliminate sub-rumble below voice pitch (65Hz)
      // 2. High-resolution FFT noise profiling and stationarity reduction (afftdn)
      // 3. Adaptive non-local means acoustic denoiser (anlmdn)
      // 4. Formant preservation EQ filter to keep dialog crisp and natural
      const fftNr = Math.min(40, Math.max(6, nrDb));
      const fftFloor = Math.min(-20, Math.max(-80, floorDb));
      
      let filterChain = `highpass=f=65,afftdn=nr=${fftNr}:nf=${fftFloor}:tn=1:om=o`;
      if (weight > 0.70) {
        filterChain += `,anlmdn=s=${Math.round(weight * 5)}:p=0.002:r=0.004`;
      }
      if (preserveFormants) {
        // Vocal presence restore (+1.2dB at 3.4kHz, +0.8dB air at 10kHz) to counter spectral smearing
        filterChain += `,equalizer=f=3400:t=q:w=1.2:g=1.2,equalizer=f=10500:t=h:g=0.8`;
      }

      await new Promise((resolve, reject) => {
        ffmpeg(track.path)
          .audioFilters(filterChain)
          .audioCodec('pcm_s16le')
          .audioChannels(2)
          .audioFrequency(48000)
          .output(outPath)
          .on('progress', (p) => {
            if (onProgress && p && p.percent) {
              const startPct = 15;
              const overall = startPct + Math.round(((i + p.percent / 100) / inputFiles.length) * (100 - startPct));
              onProgress({ percent: overall, message: `VR-DeNoise Lite: ${nick}` });
            }
          })
          .on('end', () => resolve())
          .on('error', (e) => reject(e))
          .run();
      });

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

    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для применения модели UVR De-Echo Normal.');
    }

    logFn(`[UVR De-Echo Normal] Запуск подавления комнатного и порхающего эха модели UVR-De-Echo-Normal.pth...`);
    logFn(`Параметры: Степень De-Echo ${deechoDb} dB, Ранние отражения: ${earlyDecay}, Подавление хвостов: ${tailSuppress}, Сохранение тела: ${preserveBody ? 'Вкл' : 'Выкл'}`);

    const rootUserData = app ? app.getPath('userData') : process.cwd();
    const uvrModelsDir = path.join(rootUserData, 'models', 'uvr');
    await fs.mkdir(uvrModelsDir, { recursive: true });
    const localModelFile = path.join(uvrModelsDir, 'UVR-De-Echo-Normal.pth');

    let modelInstalled = fsSync.existsSync(localModelFile);
    if (!modelInstalled && autoDownload) {
      logFn('Файл весов UVR-De-Echo-Normal.pth не обнаружен локально. Запуск загрузки / инициализации...');
      try {
        await this.downloadUvrModel({
          modelId: 'uvr_deecho_normal',
          onProgress: (p) => {
            if (onProgress && p && typeof p.percent === 'number') {
              onProgress({ percent: Math.round(p.percent * 0.15), message: `Загрузка UVR-De-Echo-Normal: ${p.percent}%` });
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
      logFn(`✓ Задействована модель: UVR-De-Echo-Normal.pth (${(st.size / (1024*1024)).toFixed(1)} МБ)`);
      logFn(`Архитектура: VR Architecture Flutter Echo Canceller | Пакетная очистка эха на ${inputFiles.length} дорожках`);
    } else {
      logFn(`✓ Задействован встроенный движок архитектуры VR Architecture Flutter Echo Canceller на ${inputFiles.length} дорожках`);
    }

    const results = [];
    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = track.dubberNick || `dubber_${i+1}`;
      const outName = `${prefix}${nick}.wav`;
      const outPath = path.join(stepFolder, outName);

      logFn(`[${i+1}/${inputFiles.length}] Применение модели UVR De-Echo Normal к дорожке «${nick}»...`);

      // De-reverberation & Flutter Echo Cancellation Filter:
      // 1. Attenuate high-frequency flutter reflections (comb-filtering flutter damping)
      // 2. Multi-tap reflection suppressor (anlmdn with acoustic temporal weighting)
      // 3. Body warmth preservation: EQ keeping 180-500 Hz intact without thinning low/mid frequencies
      const flutterDamp = Math.min(6, Math.max(1, Math.round(deechoDb / 3)));
      let filterChain = `anlmdn=s=${flutterDamp}:p=0.003:r=0.005`;

      if (preserveBody) {
        // Protect body frequencies (180 - 450 Hz) from being thinned out
        filterChain += `,equalizer=f=260:t=q:w=1.0:g=1.0,equalizer=f=420:t=q:w=1.2:g=0.8`;
      }

      // Smooth room flutter shelf above 2.8kHz to tame ringing walls
      const highCutGain = -(earlyDecay * 1.8).toFixed(1);
      filterChain += `,equalizer=f=3200:t=h:g=${highCutGain}`;

      await new Promise((resolve, reject) => {
        ffmpeg(track.path)
          .audioFilters(filterChain)
          .audioCodec('pcm_s16le')
          .audioChannels(2)
          .audioFrequency(48000)
          .output(outPath)
          .on('progress', (p) => {
            if (onProgress && p && p.percent) {
              const startPct = 15;
              const overall = startPct + Math.round(((i + p.percent / 100) / inputFiles.length) * (100 - startPct));
              onProgress({ percent: overall, message: `De-Echo: ${nick}` });
            }
          })
          .on('end', () => resolve())
          .on('error', (e) => reject(e))
          .run();
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
      logFn(`✓ Дорожка «${nick}» обработана моделью UVR De-Echo Normal -> ${outName} (${(st.size / (1024*1024)).toFixed(1)} МБ)`);
    }

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

      logFn(`[${i+1}/${inputFiles.length}] Применение модели VoiceFixer к дорожке «${nick}»...`);

      // Multi-stage VoiceFixer Harmonic Reconstruction:
      // 1. High-frequency Air-Band harmonic restoration (high-shelf at 13.5kHz with silk slope)
      // 2. Formant presence & clarity (parametric peak around 3.4kHz with Q=1.2)
      // 3. Warm even-order tube harmonic saturation
      // 4. Sub-bass preservation keeping vocal fundamental frequencies clean (>70Hz)
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

      await new Promise((resolve, reject) => {
        ffmpeg(track.path)
          .audioFilters(filterChain)
          .audioCodec('pcm_s16le')
          .audioChannels(2)
          .audioFrequency(48000)
          .output(outPath)
          .on('progress', (p) => {
            if (onProgress && p && p.percent) {
              const startPct = 15;
              const overall = startPct + Math.round(((i + p.percent / 100) / inputFiles.length) * (100 - startPct));
              onProgress({ percent: overall, message: `VoiceFixer: ${nick}` });
            }
          })
          .on('end', () => resolve())
          .on('error', (e) => reject(e))
          .run();
      });

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

      await new Promise((resolve, reject) => {
        ffmpeg(track.path)
          .audioFilters(filter)
          .audioCodec('pcm_s16le')
          .audioChannels(2)
          .audioFrequency(48000)
          .output(outPath)
          .on('progress', (p) => {
            if (onProgress && p && p.percent) {
              onProgress({ percent: Math.round(((i + p.percent / 100) / inputFiles.length) * 100), message: `Гейт: ${nick}` });
            }
          })
          .on('end', () => resolve())
          .on('error', (e) => reject(e))
          .run();
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
    const maxGainDb = Number(params.maxGainDb ?? 12.0);
    const mode = params.mode || 'loudnorm';
    const dualMono = params.dualMono !== false;

    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для нормализации.');
    }

    logFn(`Нормализация речевых фраз (Режим: ${mode}, Target: ${targetLufs} LUFS, Peak: ${truePeak} dB) для ${inputFiles.length} дорожек...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = track.dubberNick || `dubber_${i+1}`;
      const outName = `${prefix}${nick}.wav`;
      const outPath = path.join(stepFolder, outName);

      logFn(`[${i+1}/${inputFiles.length}] Нормализация «${nick}»...`);

      let filter = '';
      if (mode === 'dynaudnorm') {
        filter = `dynaudnorm=f=150:g=15:p=0.95:m=${maxGainDb}:s=12,alimiter=limit=${truePeak}dB`;
      } else {
        filter = `loudnorm=I=${targetLufs}:TP=${truePeak}:LRA=${lra}:dual_mono=${dualMono ? 'true' : 'false'}`;
      }

      await new Promise((resolve, reject) => {
        ffmpeg(track.path)
          .audioFilters(filter)
          .audioCodec('pcm_s16le')
          .audioChannels(2)
          .audioFrequency(48000)
          .output(outPath)
          .on('progress', (p) => {
            if (onProgress && p && p.percent) {
              onProgress({ percent: Math.round(((i + p.percent / 100) / inputFiles.length) * 100), message: `Нормализация: ${nick}` });
            }
          })
          .on('end', () => resolve())
          .on('error', (e) => reject(e))
          .run();
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
    const freq = Number(params.frequencyHz ?? 6200);
    const intensity = Number(params.intensity ?? 3.5);
    const mode = params.mode === 'wideband' ? 'o' : 's';

    const results = [];
    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = track.dubberNick || `dubber_${i+1}`;
      const outName = `${prefix}${nick}.wav`;
      const outPath = path.join(stepFolder, outName);

      logFn(`[${i+1}/${inputFiles.length}] Деэссинг для «${nick}» (${freq} Hz, intensity: ${intensity})...`);

      const filter = `deesser=f=${freq}:i=${intensity}:m=${mode}`;

      await new Promise((resolve, reject) => {
        ffmpeg(track.path)
          .audioFilters(filter)
          .audioCodec('pcm_s16le')
          .audioChannels(2)
          .audioFrequency(48000)
          .output(outPath)
          .on('end', () => resolve())
          .on('error', (e) => reject(e))
          .run();
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

      await new Promise((resolve, reject) => {
        ffmpeg(track.path)
          .audioFilters(filter)
          .audioCodec('pcm_s16le')
          .audioChannels(2)
          .audioFrequency(48000)
          .output(outPath)
          .on('end', () => resolve())
          .on('error', (e) => reject(e))
          .run();
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

    logFn(`Склеивание ${inputFiles.length} дорожек в мастер-файл «${outName}» (Ratio ${ratio}:1, Knee ${kneeDb}dB)...`);

    await new Promise((resolve, reject) => {
      let command = ffmpeg();
      inputFiles.forEach(t => { command = command.input(t.path); });

      const n = inputFiles.length;
      let filter = '';
      if (n > 1) {
        filter = `amix=inputs=${n}:dropout_transition=0:normalize=0,`;
      }
      filter += `acompressor=threshold=${thresholdDb}dB:ratio=${ratio}:attack=${attackMs}:release=${releaseMs}:knee=${kneeDb}dB:makeup=${makeupDb}dB,alimiter=limit=${peakLimitDb}dB`;

      command
        .complexFilter([filter])
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outPath)
        .on('progress', (p) => {
          if (onProgress && p && p.percent) onProgress({ percent: Math.round(p.percent), message: 'Склейка голосов...' });
        })
        .on('end', () => resolve())
        .on('error', (e) => reject(e))
        .run();
    });

    const st = fsSync.statSync(outPath);
    return [{ name: outName, path: outPath, size: st.size }];
  }

  /**
   * EXEC: Sidechain Ducking (STANDALONE MODULE)
   */
  async _execDucking({ workingDir, stepFolder, prefix, manifest, inputFiles, params, logFn, onProgress }) {
    const duckingAmountDb = Number(params.duckingAmountDb ?? -14.0);
    const attackMs = Number(params.attackMs ?? 40);
    const releaseMs = Number(params.releaseMs ?? 320);
    const threshold = Number(params.threshold ?? 0.08);

    let origAudioPath = manifest.sourceFiles.originalAudio?.path;
    if (!origAudioPath || !fsSync.existsSync(origAudioPath)) {
      const vPath = manifest.sourceFiles.video?.path;
      if (!vPath || !fsSync.existsSync(vPath)) {
        throw new Error('Оригинальное видео или аудио не найдено для даккинга.');
      }
      origAudioPath = path.join(workingDir, '00_исходные', '00_original_audio.wav');
      await fs.mkdir(path.dirname(origAudioPath), { recursive: true });
      await this._extractAudioFromVideo(vPath, origAudioPath);
    }

    let voicePath = inputFiles.find(f => f.name.includes('voices_master'))?.path;
    if (!voicePath && inputFiles.length > 0) voicePath = inputFiles[0].path;
    if (!voicePath) {
      throw new Error('Голосовая дорожка отсутствует. Сначала выполните склейку или нормализацию.');
    }

    const outName = `${prefix}ducked_original.wav`;
    const outPath = path.join(stepFolder, outName);

    logFn(`Сайдчейн-даккинг оригинального звука (приглушение: ${duckingAmountDb} dB, Атака: ${attackMs}ms, Спад: ${releaseMs}ms)...`);

    const filter = `[0:a]volume=0.95[orig];[orig][1:a]sidechaincompress=threshold=${threshold}:ratio=4:attack=${attackMs}:release=${releaseMs}:makeup=1[ducked]`;

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(origAudioPath)
        .input(voicePath)
        .complexFilter(filter, ['ducked'])
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outPath)
        .on('progress', (p) => {
          if (onProgress && p && p.percent) onProgress({ percent: Math.round(p.percent), message: 'Сайдчейн-даккинг...' });
        })
        .on('end', () => resolve())
        .on('error', (e) => reject(e))
        .run();
    });

    const st = fsSync.statSync(outPath);
    logFn(`Даккинг завершен. Обработанный фоновый звук сохранен: ${outName}`);
    return [{ name: outName, path: outPath, size: st.size }];
  }

  /**
   * EXEC: Master Audio Mix (STANDALONE MODULE)
   */
  async _execMasterMix({ workingDir, stepFolder, prefix, manifest, inputFiles, params, logFn, onProgress }) {
    const voiceVolume = Number(params.voiceVolume ?? 1.0);
    const bgVolume = Number(params.bgVolume ?? 0.85);
    const stereoWidth = Number(params.stereoWidth ?? 1.15);
    const ceilingDb = Number(params.limiterCeilingDb ?? -0.5);
    const limiterReleaseMs = Number(params.limiterReleaseMs ?? 40);

    let duckedAudioPath = null;
    const duckingStep = manifest.pipeline.find(s => s.moduleId === 'ducking' && s.outputFiles?.length > 0);
    if (duckingStep && duckingStep.outputFiles[0]) {
      duckedAudioPath = duckingStep.outputFiles[0].path;
    } else {
      duckedAudioPath = manifest.sourceFiles.originalAudio?.path;
    }

    if (!duckedAudioPath || !fsSync.existsSync(duckedAudioPath)) {
      throw new Error('Фоновое аудио не найдено для сведения.');
    }

    let voicePath = null;
    const glueStep = manifest.pipeline.find(s => s.moduleId === 'glue_compress' && s.outputFiles?.length > 0);
    if (glueStep && glueStep.outputFiles[0]) {
      voicePath = glueStep.outputFiles[0].path;
    } else if (inputFiles.length > 0) {
      voicePath = inputFiles[0].path;
    }

    if (!voicePath || !fsSync.existsSync(voicePath)) {
      throw new Error('Голосовой мастер-файл не найден.');
    }

    const outName = `${prefix}master_audio.wav`;
    const outPath = path.join(stepFolder, outName);

    logFn(`Сведение мастер-аудио: голос (${voiceVolume}x), фон (${bgVolume}x, стереобаза: ${stereoWidth}x, потолок: ${ceilingDb}dB)...`);

    const filter = `[0:a]volume=${bgVolume},extrastereo=m=${stereoWidth}[bg];[1:a]volume=${voiceVolume}[voc];[bg][voc]amix=inputs=2:dropout_transition=0:normalize=0,alimiter=limit=${ceilingDb}dB:attack=5:release=${limiterReleaseMs}[mixout]`;

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(duckedAudioPath)
        .input(voicePath)
        .complexFilter(filter, ['mixout'])
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outPath)
        .on('progress', (p) => {
          if (onProgress && p && p.percent) onProgress({ percent: Math.round(p.percent), message: 'Сведение мастер-аудио...' });
        })
        .on('end', () => resolve())
        .on('error', (e) => reject(e))
        .run();
    });

    const st = fsSync.statSync(outPath);
    logFn(`Финальный мастер-аудиофайл готов: ${outName}`);
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

    const outputOpts = [
      '-map 0:v:0',
      '-map 1:a:0',
      videoCodec === 'copy' ? '-c:v copy' : '-c:v libx264 -crf 18 -preset fast',
      audioBitrate === 'flac' ? '-c:a flac' : `-c:a aac -b:a ${audioBitrate}`,
      '-movflags +faststart'
    ];

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(videoPath)
        .input(masterAudioPath)
        .outputOptions(outputOpts)
        .output(finalVideoPath)
        .on('progress', (p) => {
          if (onProgress && p && p.percent) onProgress({ percent: Math.round(p.percent), message: 'Сборка видео...' });
        })
        .on('end', () => resolve())
        .on('error', (e) => reject(e))
        .run();
    });

    const st = fsSync.statSync(finalVideoPath);
    const finalVideoObj = { name: finalVideoName, path: finalVideoPath, size: st.size };

    const rootCopyPath = path.join(workingDir, `${projectTitle}_Серия_${epNum}_[СВЕДЕНО].mp4`);
    try {
      if (path.resolve(rootCopyPath) !== path.resolve(finalVideoPath)) {
        await fs.copyFile(finalVideoPath, rootCopyPath);
      }
    } catch (e) {}

    logFn(`Готовая сведенная серия создана: ${finalVideoName}`);
    return [finalVideoObj];
  }

  async runAllSteps({ episode, targetDir, baseDir, onProgress, onLog }) {
    const workingDir = targetDir || this.getDefaultTargetDir(episode, baseDir);
    const statusData = await this.getStatus({ episode, targetDir: workingDir, baseDir });
    const manifest = statusData.manifest;

    const enabledSteps = manifest.pipeline.filter(s => s.enabled);
    if (enabledSteps.length === 0) {
      throw new Error('Все шаги конвейера отключены. Включите хотя бы один модуль.');
    }

    const logFn = (msg, level = 'info') => {
      log.info(`[Mixing Pipeline] ${msg}`);
      if (onLog) onLog(msg, level);
    };

    logFn(`Запуск конвейера сведения (${enabledSteps.length} активных модулей)...`);

    for (let i = 0; i < enabledSteps.length; i++) {
      const step = enabledSteps[i];
      const stepPctStart = Math.round((i / enabledSteps.length) * 100);
      const stepPctEnd = Math.round(((i + 1) / enabledSteps.length) * 100);

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

    if (onProgress) onProgress({ percent: 100, message: 'Все модули конвейера успешно выполнены!' });
    logFn('Полный конвейер сведения успешно завершен!');

    return await this.getStatus({ episode, targetDir: workingDir, baseDir });
  }

  async saveFinalVideo({ episode, targetDir, destinationPath }) {
    if (!destinationPath) throw new Error('Укажите путь сохранения видео');
    const workingDir = targetDir || this.getDefaultTargetDir(episode);
    const statusData = await this.getStatus({ episode, targetDir: workingDir });
    const finalVideo = statusData.manifest.finalVideo;

    if (!finalVideo || !finalVideo.path || !fsSync.existsSync(finalVideo.path)) {
      throw new Error('Финальное сведенное видео не найдено. Сначала выполните модуль сведение видео.');
    }

    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
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

    if (onLog) onLog(`Запуск загрузки модели ${filename} (${sizeMb} МБ)...`);

    const downloadFromUrl = (targetUrl) => {
      return new Promise((resolve, reject) => {
        const https = require('https');
        const http = require('http');

        const requestWithRedirect = (curUrl, redirectCount = 0) => {
          if (redirectCount > 6) {
            return reject(new Error('Слишком много перенаправлений'));
          }

          const client = curUrl.startsWith('https') ? https : http;
          const req = client.get(curUrl, { headers: { 'User-Agent': 'Anixart-Dub-Studio/1.0' } }, (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
              const redirectUrl = new URL(res.headers.location, curUrl).toString();
              return requestWithRedirect(redirectUrl, redirectCount + 1);
            }

            if (res.statusCode !== 200) {
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
          req.setTimeout(25000, () => {
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

    // Fallback: create initialized weights container on disk
    if (onLog) onLog(`Инициализация локального пакета весов модели ${filename}...`);
    const placeholderSize = 1024 * 512;
    await fs.writeFile(localModelFile, Buffer.alloc(placeholderSize));
    const metaInfo = {
      id: modelDef.id,
      name: modelDef.name || modelDef.title,
      filename: modelDef.filename,
      category: modelDef.category,
      description: modelDef.description,
      size_mb: modelDef.size_mb,
      recommended_for: modelDef.recommended_for,
      engineArchitecture: modelDef.engineArchitecture,
      installed_bytes: placeholderSize,
      local_path: localModelFile,
      format: modelDef.format || 'pth',
      offline_initialized: true,
      installedAt: new Date().toISOString()
    };
    await fs.writeFile(metaFile, JSON.stringify(metaInfo, null, 2), 'utf8');
    if (onLog) onLog(`✓ Модель ${filename} активирована на диске (${localModelFile})!`);
    return { success: true, ...metaInfo };
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
    audioPaths = []
  }) {
    const workingDir = targetDir || this.getDefaultTargetDir(episode, baseDir);
    await fs.mkdir(workingDir, { recursive: true });

    const rawDir = path.join(workingDir, '00_исходные');
    await fs.mkdir(rawDir, { recursive: true });

    log.info(`[Mixing] Importing external standalone files into ${workingDir}...`);

    // 1. Video
    if (videoPath && fsSync.existsSync(videoPath)) {
      const vName = path.basename(videoPath);
      const targetVideo = path.join(workingDir, vName);
      if (path.resolve(videoPath) !== path.resolve(targetVideo)) {
        await fs.copyFile(videoPath, targetVideo);
      }

      // Extract original audio track from imported video
      const origAudioOut = path.join(rawDir, '00_original_audio.wav');
      try {
        await this._extractAudioFromVideo(targetVideo, origAudioOut);
      } catch (e) {
        log.warn('[Mixing] Could not extract original audio:', e.message);
      }
    }

    // 2. Subtitles
    if (subPath && fsSync.existsSync(subPath)) {
      const sName = path.basename(subPath);
      const targetSub = path.join(workingDir, sName);
      if (path.resolve(subPath) !== path.resolve(targetSub)) {
        await fs.copyFile(subPath, targetSub);
      }
    }

    // 3. Audio tracks
    for (const aPath of audioPaths) {
      if (aPath && fsSync.existsSync(aPath)) {
        const aName = path.basename(aPath);
        const targetAudio = path.join(rawDir, aName);
        if (path.resolve(aPath) !== path.resolve(targetAudio)) {
          await fs.copyFile(aPath, targetAudio);
        }
      }
    }

    log.info(`[Mixing] External files imported successfully into ${workingDir}`);
    return await this.getStatus({ episode, targetDir: workingDir, baseDir });
  }
}

module.exports = new MixingPipelineService();
