/**
 * MODULE DATABASE — Part 1: Timbre, Timing, Fixes, Restoration, Noise & De-Echo, Separation, Leveling, Gate
 */
const MODULE_DATABASE_VOICE = [
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
      maxGainDb: 14.0
    },
    presets: [
      {
        id: 'broadcast_16lufs',
        title: '📺 Стандарт вещания (-16 LUFS, Peak -1.0 dB)',
        description: 'Равномерное звучание всех реплик диалога по стандарту стримингов',
        params: { targetLufs: -16.0, truePeak: -1.0, maxGainDb: 14.0 }
      },
      {
        id: 'web_punchy_14lufs',
        title: '📢 Громкий веб (-14 LUFS, Peak -0.8 dB)',
        description: 'Максимальная читаемость диалогов на телефонах и планшетах',
        params: { targetLufs: -14.0, truePeak: -0.8, maxGainDb: 16.0 }
      },
      {
        id: 'whisper_boost',
        title: '🤫 Вытягивание тихого шепота (Max +18 dB)',
        description: 'Автоматически подтягивает слишком тихие эмоциональные реплики',
        params: { targetLufs: -16.0, truePeak: -1.0, maxGainDb: 18.0 }
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
      noiseReductionDb: 18.0,
      sensitivity: 5.0,
      wetDryBlend: 95.0,
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'foxjoy_studio',
        title: '✨ FoxJoy Вокальный Студийный (18 dB)',
        description: 'Флагманская чистая обработка вокальных и дикторских трактов от FoxJoy',
        params: { noiseReductionDb: 18.0, sensitivity: 5.0, wetDryBlend: 95.0, autoDownloadModel: true }
      },
      {
        id: 'foxjoy_heavy',
        title: '🛡 FoxJoy Глубокое Очищение (24 dB)',
        description: 'Очистка сильного шума кулеров и уличного гула с сохранением формант',
        params: { noiseReductionDb: 24.0, sensitivity: 7.0, wetDryBlend: 98.0, autoDownloadModel: true }
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
      attenuationLimitDb: 24.0,
      postFilter: false,
      wetDryBlend: 95.0,
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'deepfilter3_speech',
        title: '⚡ DeepFilter 3 Перцептивный (Лимит 24 dB)',
        description: 'Инновационная чистка речи без металлического призвука',
        params: { attenuationLimitDb: 24.0, postFilter: false, wetDryBlend: 95.0, autoDownloadModel: true }
      },
      {
        id: 'deepfilter3_deep_postfilter',
        title: '🛡 DeepFilter 3 Максимальная чистка (Лимит 60 dB + Post-Filter)',
        description: 'Глубокое подавление стационарного и нестационарного шума с перцептивным пост-фильтром',
        params: { attenuationLimitDb: 60.0, postFilter: true, wetDryBlend: 100.0, autoDownloadModel: true }
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
      noiseReductionDb: 26.0,
      sensitivity: 7.0,
      wetDryBlend: 95.0,
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'full_archive_clean',
        title: '🛡 UVR Full Глубокое удаление (26 dB)',
        description: 'Бескомпромиссная чистка архивного шипения и сильного гула',
        params: { noiseReductionDb: 26.0, sensitivity: 7.0, wetDryBlend: 95.0, autoDownloadModel: true }
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
      sensitivity: 5.0,
      wetDryBlend: 95.0,
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'balanced_clean',
        title: '✨ Оптимальное подавление (18 dB, естественный тембр)',
        description: 'Убирает кулеры ПК, шум кондиционера и фоновое шипение без искажения согласных',
        params: { noiseReductionDb: 18.0, sensitivity: 5.0, wetDryBlend: 95.0, autoDownloadModel: true }
      },
      {
        id: 'light_hum_remover',
        title: '🍃 Деликатная чистка (12 dB, прозрачный звук)',
        description: 'Легкое снятие мелкого стационарного фона для чистых студийных записей',
        params: { noiseReductionDb: 12.0, sensitivity: 3.5, wetDryBlend: 90.0, autoDownloadModel: true }
      },
      {
        id: 'heavy_hiss_killer',
        title: '🛡 Глубокое подавление (26 dB, сильный шум)',
        description: 'Для записей с громким шумом улицы, гудением дросселей и микрофонным перегревом',
        params: { noiseReductionDb: 26.0, sensitivity: 7.5, wetDryBlend: 100.0, autoDownloadModel: true }
      },
      {
        id: 'usb_mic_stationarity',
        title: '🎙 USB-микрофон (Отсечение фонового писка и шума USB)',
        description: 'Устраняет высокочастотный наводящий свист и электрическое шипение дешевых трактов',
        params: { noiseReductionDb: 20.0, sensitivity: 6.0, wetDryBlend: 95.0, autoDownloadModel: true }
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
      reverbReduction: 0.65,
      sensitivity: 5.0,
      wetDryBlend: 95.0
    },
    presets: [
      {
        id: 'dsp_instant',
        title: '⚡ Быстрое DSP вычитание (0.65x)',
        description: 'Легкое устранение гула с нулевой задержкой без нейросетей',
        params: { reverbReduction: 0.65, sensitivity: 5.0, wetDryBlend: 95.0 }
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
      reverbReduction: 0.80,
      sensitivity: 5.0,
      wetDryBlend: 95.0,
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'foxjoy_studio_dereverb',
        title: '✨ FoxJoy Студийный DeReverb (0.80x)',
        description: 'Глубокая пространственная инверсия реверберации от FoxJoy',
        params: { reverbReduction: 0.80, sensitivity: 5.0, wetDryBlend: 95.0, autoDownloadModel: true }
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
      reverbReduction: 0.70,
      sensitivity: 5.0,
      wetDryBlend: 95.0,
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'soft_curtain_room',
        title: '🪟 Комната со шторами (Мягкое снятие ранних отражений)',
        description: 'Убирает порхающее эхо от стен, сохраняя теплоту и глубину низких частот',
        params: { reverbReduction: 0.55, sensitivity: 4.0, wetDryBlend: 90.0, autoDownloadModel: true }
      },
      {
        id: 'normal_home_studio',
        title: '🎙 Стандартная домашняя студия (Сбалансированный De-Echo)',
        description: 'Оптимальное подавление комнатного отклика без истончения вокала',
        params: { reverbReduction: 0.75, sensitivity: 5.5, wetDryBlend: 95.0, autoDownloadModel: true }
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
      reverbReduction: 0.90,
      sensitivity: 7.0,
      wetDryBlend: 95.0,
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'deecho_aggr_preset',
        title: '🛡 De-Echo Aggressive (0.90x)',
        description: 'Удаление жесткого эха от стекла, плитки и пустых стен',
        params: { reverbReduction: 0.90, sensitivity: 7.0, wetDryBlend: 95.0, autoDownloadModel: true }
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
      reverbReduction: 0.80,
      sensitivity: 6.0,
      wetDryBlend: 95.0,
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'dereverb_room_preset',
        title: '📦 MDX Room Boxy Resonant Clean (0.80x)',
        description: 'Устранение «коробочного» гула маленьких комнат и петличек',
        params: { reverbReduction: 0.80, sensitivity: 6.0, wetDryBlend: 95.0, autoDownloadModel: true }
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
      shifts: 1,
      overlap: 0.25,
      stems: 'both',
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'voc_ft_standard',
        title: '🎤 Voc_FT Извлечение вокала и фона',
        description: 'Золотой стандарт сепарации диалогов и вокала',
        params: { shifts: 1, overlap: 0.25, stems: 'both', autoDownloadModel: true }
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
      shifts: 1,
      overlap: 0.25,
      stems: 'instrumental_only',
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'inst_hq3_standard',
        title: '🎶 Inst_HQ_3 Извлечение инструментала (M&E)',
        description: 'Чистый минус и музыкальное сопровождение для дубляжа',
        params: { shifts: 1, overlap: 0.25, stems: 'instrumental_only', autoDownloadModel: true }
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
      shifts: 1,
      overlap: 0.25,
      stems: 'both',
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'kim2_dense_mix',
        title: '⚡ Kim Vocal 2 Для плотных миксов',
        description: 'Удаление хоров, синтов и перегруженных битов',
        params: { shifts: 1, overlap: 0.25, stems: 'both', autoDownloadModel: true }
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
      shifts: 1,
      overlap: 0.25,
      stems: 'all',
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'htdemucs_ft_full',
        title: '🎬 Demucs 4-Stem Full Separation',
        description: 'Многодорожечная сепарация фильма на 4 отдельных стема',
        params: { shifts: 1, overlap: 0.25, stems: 'all', autoDownloadModel: true }
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
      shifts: 1,
      overlap: 0.25,
      stems: 'both',
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'htdemucs_std',
        title: '📺 Demucs Standard (Vocals + M&E)',
        description: 'Быстрое разделение сериалов и мультсериалов',
        params: { shifts: 1, overlap: 0.25, stems: 'both', autoDownloadModel: true }
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
      shifts: 1,
      overlap: 0.25,
      stems: 'both',
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'htdemucs_2stem',
        title: '⚡ Demucs 2-Stem Vocals + BGM',
        description: 'Экспресс-изоляция речи от фонового звука',
        params: { shifts: 1, overlap: 0.25, stems: 'both', autoDownloadModel: true }
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
      shifts: 1,
      overlap: 0.25,
      stems: 'both',
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'mdx23c_8s',
        title: '🔥 MDX23C 8-Step High-Precision',
        description: 'Глубокая многошаговая фильтрация бэк-вокала',
        params: { shifts: 1, overlap: 0.25, stems: 'both', autoDownloadModel: true }
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
      shifts: 1,
      overlap: 0.25,
      stems: 'instrumental_only',
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'karaoke_hp',
        title: '🎤 5_HP Караоке & Фонограмма',
        description: 'Чистое удаление голоса для получения качественной фонограммы',
        params: { shifts: 1, overlap: 0.25, stems: 'instrumental_only', autoDownloadModel: true }
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
      shifts: 1,
      overlap: 0.25,
      stems: 'both',
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'roformer_sota',
        title: '👑 Mel-Band Roformer SOTA Pure Vocals',
        description: 'Бескомпромиссная чистота голоса и максимальный SNR',
        params: { shifts: 1, overlap: 0.25, stems: 'both', autoDownloadModel: true }
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
      shifts: 1,
      overlap: 0.25,
      stems: 'both',
      autoDownloadModel: true
    },
    presets: [
      {
        id: 'bs_roformer_cinema',
        title: '🎬 BS-Roformer Viperx Кинематографический',
        description: 'Оптимизированный фазовый отклик для объемных сцен фильма',
        params: { shifts: 1, overlap: 0.25, stems: 'both', autoDownloadModel: true }
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
      detectionMode: 'rms'
    },
    presets: [
      {
        id: 'studio_soft',
        title: '🎙 Стандартная студия (Мягкий гейт)',
        description: 'Естественное и плавное затухание для подготовленных студийных помещений',
        params: { thresholdDb: -45.0, rangeDb: -80.0, attackMs: 10, releaseMs: 160, detectionMode: 'rms' }
      },
      {
        id: 'home_aggro',
        title: '🏠 Домашняя комната (Глубокое отсечение шума)',
        description: 'Быстрое глушение кулеров ПК, шума улицы и отражений стен в паузах',
        params: { thresholdDb: -36.0, rangeDb: -90.0, attackMs: 5, releaseMs: 120, detectionMode: 'peak' }
      },
      {
        id: 'sensitive_mic',
        title: '🤫 Чувствительный микрофон (Плавный спад)',
        description: 'Предотвращает щелчки и резкие обрывы тихих согласных и шепота',
        params: { thresholdDb: -50.0, rangeDb: -65.0, attackMs: 15, releaseMs: 260, detectionMode: 'rms' }
      },
      {
        id: 'fast_speech',
        title: '⚡ Быстрый экшен-гейт (Динамичные диалоги)',
        description: 'Мгновенное открытие и закрытие для быстрой скороговорки и криков',
        params: { thresholdDb: -40.0, rangeDb: -85.0, attackMs: 3, releaseMs: 90, detectionMode: 'peak' }
      }
    ]
  },
];

module.exports = { MODULE_DATABASE_VOICE };
