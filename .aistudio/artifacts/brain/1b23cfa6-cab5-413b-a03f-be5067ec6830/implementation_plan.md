# План реализации: Ревизия и привязка настроек модулей сведения к реальным параметрам плагинов и нейросетей

## 1. Цель изменений
Привести настройки всех модулей вкладки **«Сведение видео»** в полное соответствие с реальными параметрами используемых движков (Demucs, UVR/MDX-Net/RoFormer, DeepFilterNet3, ClearerVoice/MossFormer2, RNNoise, Whisper/Silero MFA, FFmpeg DSP-фильтры и `AutoTimingService`). Все декоративные («пустые») ползунки, не поддерживаемые нативным CLI/API соответствующего плагина или фильтра, удаляются, а оставшиеся параметры и пресеты напрямую управляют процессом рендера.

---

## 2. Аудит и изменения по категориям модулей

### 2.1. Нейросетевое шумоподавление и де-реверберация (`MixingPipelineService.cjs`, `AudioNeuralService.cjs`, `audio_ai_processor.py`)
1. **DeepFilterNet3 (`deepfilternet3`)**:
   - **Удаляются неподдерживаемые параметры**: `noiseReductionDb`, `noiseFloorDb`, `stationarityWeight`, `frequencySmoothingHz`, `preserveVoiceFormants`, `noiseTraining`.
   - **Остаются нативные параметры DeepFilterNet3**:
     - `attenuationLimitDb` (лимит подавления шума в дБ, передаётся в `attenuation_limit` → `atten_lim_db` в `df.enhance` и спектральный фоллбэк),
     - `postFilter` (включение нативного пост-фильтра DeepFilterNet для доочистки сильных шумов),
     - `wetDryBlend` (баланс обработанного и сухого сигнала, %),
     - `autoDownloadModel` (автозагрузка весов).
2. **UVR Denoise & De-Echo (`uvr_denoise_foxjoy`, `uvr_denoise_full`, `uvr_denoise_lite`, `reverb_foxjoy`, `uvr_deecho_normal`, `uvr_deecho_aggressive`, `mdx_dereverb_room`, `vst-spectral-dereverb`)**:
   - **Удаляются неподдерживаемые параметры**: `noiseFloorDb`, `stationarityWeight`, `frequencySmoothingHz`, `preserveVoiceFormants`, `noiseTraining`, `earlyReflectionsDecay`, `reverbTailSuppress`, `roomSizeEstimate`, `preserveBodyFrequencies`.
   - **Остаются и подключаются к пайплайну**:
     - Для модулей шумоподавления (`uvr_denoise_*`): `noiseReductionDb` (глубина подавления в дБ), `sensitivity` (чувствительность детектора 0.1–1.0), `wetDryBlend` (%), `autoDownloadModel`.
     - Для модулей де-эхо и реверберации (`reverb_foxjoy`, `uvr_deecho_*`, `mdx_dereverb_room`, `vst-spectral-dereverb`): `reverbReduction` (степень подавления хвостов 0.1–1.0), `sensitivity` (0.1–1.0), `wetDryBlend` (%), `autoDownloadModel` (кроме встроенного `vst-spectral-dereverb`).
   - В `AudioNeuralService.denoiseAudio` / `dereverbAudio` и `process_uvr_inference` (`audio_ai_processor.py`) обеспечивается передача и учёт как `noise_reduction_db`, так и `reverb_reduction`, `sensitivity` и `wet_dry_blend`.
3. **Легковесный спектральный де-ревербератор (`spectral_dereverb_lite`)**:
   - В `_execSpectralDeReverb` подключаются все параметры модуля:
     - `noiseReductionDb` → глубина подавления `afftdn=nr=...`,
     - `decayTimeEstMs` → настройка удержания/восстановления огибающей гейта хвостов реверберации (`agate` release),
     - `clarityPercent` → динамическая компенсация мутности (280 Гц) и разборчивости (3.2 кГц),
     - `mixPercent` → параллельное смешивание `Dry/Wet` через `asplit` + `amix`.

---

### 2.2. Нейросетевое разделение стемов (Demucs, UVR MDX-Net, RoFormer)
1. **Модули Demucs (`htdemucs`, `htdemucs_ft`, `htdemucs_vocals_bgm`)**:
   - **Удаляется неиспользуемый параметр**: `segment`.
   - **Исправляется критическая ошибка типа `stems`**: в `htdemucs` и `htdemucs_ft` числовые значения `stems: 4` / `stems: 2` заменяются на строковый режим `'both' | 'vocals_only' | 'instrumental_only'` (с обратной совместимостью в `_execStemSeparation` и `process_demucs`, чтобы старые сохранённые пайплайны с числом `2` или `4` автоматически интерпретировались как `'both'`).
   - **Нативные параметры**: `shifts` (1–5), `overlap` (0.1–0.5), `stems` (`'both' | 'vocals_only' | 'instrumental_only'`), `autoDownloadModel`.
2. **Модули UVR MDX-Net и RoFormer (`uvr_mdx_voc_ft`, `uvr_mdx_inst_hq3`, `kim_vocal_2`, `mdx23c_8step`, `hp_karaoke_uvr`, `mel_band_roformer_vocals`, `bs_roformer_viperx`, `bs_roformer_cinema`)**:
   - **Удаляются неподдерживаемые ползунки**: `sensitivity`, `marginDb`, `postProcessThreshold`, `instrumentalBlend`, `steps` (переменная `vocFilters` в `_execStemSeparation` собиралась, но никуда не передавалась).
   - **Остаются нативные параметры движка разделения**: `shifts` (1–5), `overlap` (0.1–0.5), `stems` (`'both' | 'vocals_only' | 'instrumental_only'`), `autoDownloadModel`.

---

### 2.3. Тайминг, склейка, MFA-липсинк и вшивание фиксов
1. **Авто-тайминг и синхронизация (`auto_timing`)**:
   - В `_execAutoTiming` и `AutoTimingService.alignProjectAndResolveCollisions` подключаются все 5 настроек:
     - `silenceThresholdDb` и `minSilenceDuration` передаются в детектор границ реплик `detectVoiceBounds`,
     - `minGapSec` и `leadInSec` управляют зазором и опережением,
     - `preventCollisions` включает/выключает сдвиг перекрывающихся фраз во времени.
2. **Нейросетевой липсинк MFA (`stage_mfa_lipsync`)**:
   - В `_execMfaLipsync`, `AudioNeuralService.mfaAnalyze` и `process_mfa_analyze` (`audio_ai_processor.py`) передаются и реально применяются:
     - `minTimeStretch` и `maxTimeStretch` — ограничивают допустимый диапазон сжатия/растяжения темпа в Python-анализаторе и FFmpeg `atempo` (вместо жёстко зашитых `0.75` и `1.35`),
     - `maxDriftMs` — порог отклонения в мс, ниже которого фраза считается синхронной и не подвергается `atempo`-деформации,
     - `whisperModel`, `alignDevice`, `autoDownloadModel`.
3. **Вшивание фиксов (`apply_fixes`)**:
   - В `_execApplyFixes` подключаются:
     - `minGapSec` и `safetyPaddingMs` (перевод в секунды и учёт при разрешении коллизий вокруг вшиваемых фиксов),
     - `adjustLongerCollisions` (передаётся в `AutoTimingService` для сдвига последующих фраз, если фикс длиннее исходника),
     - `cleanLeftoverTails` (подрезка/очистка старого участка дорожки под фиксом с учётом запаса),
     - `fadeDurationMs` (кроссфейд/сглаживание краёв вшиваемого фикса через `afade` во избежание щелчков на стыках).

---

### 2.4. FFmpeg DSP-модули обработки голоса и даккинга
1. **Шумовой гейт (`silence_gate`)**:
   - Удаляется неподдерживаемый в `agate` параметр `holdMs`.
   - Подключается нативный параметр `detectionMode` (`'rms' | 'peak'` → `detection=rms|peak` в фильтре `agate`) наряду с `thresholdDb`, `rangeDb`, `attackMs`, `releaseMs`.
2. **Пред-нормализация фраз (`auto_norm_phrases`)**:
   - Остаются реально работающие параметры двухпроходного `loudnorm` и пред-ограничения: `targetLufs`, `truePeak`, `maxGainDb` (ограничивает максимальный подъём тихих фраз во втором проходе). Неиспользуемые `minSpeechDb` и `fadeEdgeMs` удаляются.
3. **Де-эссер (`deesser`)**:
   - Фильтр FFmpeg `deesser` принимает нормированную частоту `f`, интенсивность `i` и максимальное подавление `m`.
   - Удаляются неподдерживаемые ползунки `thresholdDb`, `bandwidthHz`, `mode`; остаются и подключаются нативные параметры: `frequencyHz` (`f`), `intensity` (`i`), `maxReduction` (`m`, 0.1–1.0).
4. **Подавление взрывных согласных (`de_plosive`)**:
   - В `_execDePlosive` подключаются все настройки модуля: `frequencyLimitHz` (частота среза НЧ-удара), `thresholdDb` и `suppressionDepthDb` (динамическое ослабление низкочастотных пиков), `recoveryMs` (время восстановления), `wetDryPercent` (параллельное смешивание).
5. **Уплотнение и гармоники (`vocal_thickener`), Восстановление пиков (`headroom_recovery`), Выравниватель речи (`speech_leveler`), Вокальный эквалайзер (`vocal_eq`)**:
   - В `_execVocalThickener`: подключается `mixPercent` через `asplit` + `amix`.
   - В `_execHeadroomRecovery`: подключаются `autoHeadroom` (авто-расчёт запаса по пикам), `lookaheadMs` и `mixPercent`.
   - В `_execSpeechLeveler`: подключаются `levelingSpeedMs` (длина окна `f` в `dynaudnorm`), `maxCutDb`, `silenceGateDb` (порог `t` в `dynaudnorm`) и `mixPercent`.
   - В `_execVocalEq`: подключается `lowCutSlope` (`'12dB/oct'` — одиночный фильтр `highpass=poles=2`, `'24dB/oct'` — каскад из двух фильтров `highpass=poles=2` Линквица-Райли).
6. **Авто-приглушение фона (`ducking`)**:
   - В `_execDucking` подключаются все параметры:
     - `duckingAmountDb` управляет глубиной приглушения фоновой дорожки (через расчёт `ratio` и `level_sc` сайдчейн-компрессора),
     - `filterMusicOnly`: при включении (`true`) приглушается преимущественно среднечастотный голосовой диапазон фона (200 Гц – 4.5 кГц) с сохранением суб-баса и верхнего воздуха музыки, а при выключении (`false`) приглушается весь спектр фоновой дорожки целиком;
     - Неподдерживаемый фильтром `sidechaincompress` параметр `holdMs` удаляется.

---

## 3. Синхронизация UI и пресетов (`MixingPanel.tsx` и `MixingPipelineService.cjs`)
1. Обновить `PARAM_SPECS`, `PARAM_LABELS` и рендер выпадающих списков в `src/components/MixingPanel.tsx` в точном соответствии с обновлённым набором параметров.
2. Синхронизировать все встроенные пресеты каждого модуля (`presets` внутри `MODULE_DATABASE`) и глобальные пресеты пайплайна (`PIPELINE_PRESETS`), чтобы ни один пресет не содержал устаревших ключей.
3. Проверить сборку проекта через `compile_applet`.
