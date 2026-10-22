/**
 * MODULE DATABASE — Part 2: Loudness, EQ, Dynamics, Creative DSP, Ducking, Master Mix, Video Mux
 */
const MODULE_DATABASE_DSP = [
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
      maxReduction: 0.5
    },
    presets: [
      {
        id: 'female_voice',
        title: '👩 Женский голос (Высокие сибилянты 6.8 kHz)',
        description: 'Точечное подавление свистящих обертонов женского тембра без глухоты',
        params: { frequencyHz: 6800, intensity: 3.5, maxReduction: 0.5 }
      },
      {
        id: 'male_voice',
        title: '👨 Мужской голос (Средние сибилянты 5.5 kHz)',
        description: 'Убирает резкое цыканье и шипение в баритоне и теноре',
        params: { frequencyHz: 5500, intensity: 3.0, maxReduction: 0.45 }
      },
      {
        id: 'bright_mic_heavy',
        title: '🔪 Яркий конденсаторный микрофон (Глубокое подавление)',
        description: 'Для микрофонов с завышенным верхом, режущим слух на буквах С и Щ',
        params: { frequencyHz: 6200, intensity: 5.2, maxReduction: 0.7 }
      },
      {
        id: 'natural_gentle',
        title: '🍃 Естественное деликатное сглаживание',
        description: 'Легкое округление транзиентов без потери воздушности звука',
        params: { frequencyHz: 7200, intensity: 2.0, maxReduction: 0.35 }
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
      threshold: 0.08,
      filterMusicOnly: false
    },
    presets: [
      {
        id: 'classic_voiceover',
        title: '🎬 Классический закадр (Фон слышен, но не мешает)',
        description: 'Японская речь и музыка слышны на фоне, русская озвучка читается на 100%',
        params: { duckingAmountDb: -14.0, attackMs: 40, releaseMs: 350, threshold: 0.08, filterMusicOnly: false }
      },
      {
        id: 'deep_focus',
        title: '🎧 Глубокий даккинг (Максимальный акцент на русском голосе)',
        description: 'Оригинальный звук сильно отступает назад во время реплик',
        params: { duckingAmountDb: -18.0, attackMs: 25, releaseMs: 420, threshold: 0.05, filterMusicOnly: false }
      },
      {
        id: 'musical_smooth',
        title: '🎵 Музыкальный даккинг (Плавные и незаметные переходы)',
        description: 'Медленная атака и релиз без резких скачков громкости в ост-треках',
        params: { duckingAmountDb: -10.0, attackMs: 70, releaseMs: 500, threshold: 0.10, filterMusicOnly: true }
      },
      {
        id: 'rapid_dialog',
        title: '⚡ Быстрый диалоговый даккинг (Для частых коротких реплик)',
        description: 'Моментальное реагирование на короткие междометия и реплики',
        params: { duckingAmountDb: -13.0, attackMs: 20, releaseMs: 220, threshold: 0.07, filterMusicOnly: false }
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

module.exports = { MODULE_DATABASE_DSP };
