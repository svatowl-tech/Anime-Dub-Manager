# План модульной декомпозиции крупных файлов кодовой базы (>2000 строк)

## 1. Цели и жёсткие ограничения рефакторинга

- **Нулевые потери функционала и UI**: Ни один элемент интерфейса, ползунок, пресет, алгоритм обработки, IPC-канал или формат данных не изменяется и не урезается.
- **Паттерн «Единый фасад + Логические подмодули (500–1200 строк)»**: Каждый из 11 крупных файлов сохраняет свою точку входа (экспортируемый класс, хук или React-компонент) с прежней сигнатурой, делегируя изолированные блоки логики в доменные подмодули. Благодаря этому внешние импорты во всём проекте остаются совместимыми.
- **Поэтапное выполнение с верификацией**: После декомпозиции каждого крупного файла выполняется проверка сборки и типов (`compile_applet`), чтобы гарантировать отсутствие регрессий на каждом шаге.

---

## 2. Детальная схема разбиения 11 файлов

### Этап 1. `electron/services/MixingPipelineService.cjs` (8 001 строка)
Главный сервис конвейера сведения разбивается на фасад `MixingPipelineService.cjs` (~800 строк: инициализация, манифест, оркестрация `executeStep`/`runAllSteps`) и директорию `electron/services/mixing/`:
1. **`electron/services/mixing/MixingModuleDatabase.cjs` (~950 строк)**
   - Полный реестр `MODULE_DATABASE` (все 36 модулей, их входные параметры и описания), `PIPELINE_TEMPLATES`, дефолтные пресеты пайплайна и управление пользовательскими пресетами (`getPipelinePresets`, `savePipelinePreset`, `deletePipelinePreset`).
2. **`electron/services/mixing/MixingManifestRouter.cjs` (~900 строк)**
   - Чтение/сохранение манифеста проекта, инициализация рабочей папки, строгое разрешение входных файлов для каждого шага (`_resolveStepInputFiles`, правила для голосовых, гибридных и специальных модулей), импорт внешних файлов и сохранение метаданных тайминга.
3. **`electron/services/mixing/MixingAlignmentExecutors.cjs` (~1 150 строк)**
   - Модули тайминга, склейки и синхронизации: `_execSmartConcat`, `_execSubAlign`, `_execStitchFixes`, `_execAutoTiming`, `_execMfaLipsync`, `_execBreathControl` и вспомогательная работа с субтитрами/интервалами.
4. **`electron/services/mixing/MixingVoiceCleanExecutors.cjs` (~1 150 строк)**
   - Модули очистки и реставрации речи: `_execNoiseReduction` (DeepFilterNet/FFmpeg/Spectral), `_execDeEcho` (UVR/Demucs/Spectral), `_execDeClick`, `_execClipRestore`, `_execVoiceFixer`, проверка и скачивание моделей UVR.
5. **`electron/services/mixing/MixingVocalDspExecutors.cjs` (~1 200 строк)**
   - Модули динамической и тембральной обработки голоса: `_execInputGain`, `_execPhaseAlign`, `_execHpf`, `_execGate`, `_execDePlosive`, `_execDeesser`, `_execVocalEq`, `_execCompressor`, `_execSaturation`, `_execLimiter`, `_execPhraseNorm`, `_execReverbMatch`, `_execRoomTone`, `_execVoiceTimbreMatch`, `_execAirwindows`.
6. **`electron/services/mixing/MixingMasterExecutors.cjs` (~1 100 строк)**
   - Специальные и финальные модули: `_execStemSplit`, `_execMeClean`, `_execFxExtract`, `_execAutoDuck`, `_execMasterMix`, `_execLoudnessNorm`, `_execQualityCheck`, `_execExportMux` и анализ качества/спектра шагов.

---

### Этап 2. `src/components/MixingPanel.tsx` (5 323 строки)
Компонент панели сведения разбивается на координатор `MixingPanel.tsx` (~950 строк) и подмодули в `src/components/mixing/`:
1. **`src/components/mixing/mixingParamSpecs.ts` (~750 строк)**
   - Полные словари `PARAM_SPECS`, `PARAM_LABELS`, категории модулей, константы цветов, иконок и вспомогательные функции форматирования параметров и пресетов.
2. **`src/components/mixing/MixingAudioInspector.tsx` (~1 100 строк)**
   - Встроенный аудиоплеер сравнения До/После (A/B), отрисовка волновой формы/спектрограммы, индикаторы LUFS/True Peak и панель инспекции входных и выходных дорожек этапа.
3. **`src/components/mixing/MixingStepCard.tsx` (~1 200 строк)**
   - Карточка отдельного этапа пайплайна: выбор входных файлов, селектор плагина/нейросети и пресета, динамический рендерер всех ползунков/переключателей (`PARAM_SPECS`), кнопки запуска и логи этапа.
4. **`src/components/mixing/MixingModalsAndTimeline.tsx` (~1 100 строк)**
   - Модальное окно добавления модуля из библиотеки 36 этапов, менеджер шаблонов/пресетов конвейера, интерактивный таймлайн фраз/фиксов и консоль логов конвейера.

---

### Этап 3. `src/components/TimingPanel.tsx` (4 652 строки)
Панель тайминга разбивается на главный компонент `TimingPanel.tsx` (~950 строк) и подмодули в `src/components/timing/`:
1. **`src/components/timing/timingAudioUtils.ts` (~750 строк)**
   - Утилиты сопоставления текста (`calculateTextSimilarity`), парсинга времени, нормализации имён дабберов, калибровки шумового порога (`analyzeTrackAudioNoiseFloor`) и детекции речевых интервалов (`detectSpeechIntervals`).
2. **`src/components/timing/TimingWaveformTimeline.tsx` (~1 100 строк)**
   - Компоненты `ClipWaveform`, мультитрековый таймлайн клипов, отрисовка маркеров коллизий голосов, вшитых фиксов и пропущенных субтитров.
3. **`src/components/timing/TimingTrackListAndInspector.tsx` (~1 050 строк)**
   - Список дорожек актёров и фиксов, инспектор выбранного клипа, ручная подгонка таймингов и панель диагностики проблем (`overlap`, `desync`, `missing`, `orphan`).
4. **`src/components/timing/TimingAutoAlignControls.tsx` (~800 строк)**
   - Панель управления автотаймингом, пакетной синхронизацией по оригиналу/субтитрам и экспортом тайм-кодов в пайплайн сведения.

---

### Этап 4. `src/components/Dashboard.tsx` (3 785 строк)
Главный дашборд разбивается на контейнер `Dashboard.tsx` (~850 строк) и подмодули в `src/components/dashboard/`:
1. **`src/components/dashboard/DashboardProjectHeader.tsx` (~850 строк)**
   - Шапка проекта, сводная статистика релиза, управление ролями/актёрами, быстрые действия и настройки автообновления проекта.
2. **`src/components/dashboard/DashboardEpisodeCard.tsx` (~1 100 строк)**
   - Детальная карточка серии, индикаторы готовности дорожек/субтитров/сведения, привязка медиафайлов и контекстные меню эпизода.
3. **`src/components/dashboard/DashboardModalsAndDrawers.tsx` (~950 строк)**
   - Модальные окна создания/редактирования проекта и серий, пакетного импорта файлов и распределения ролей.

---

### Этап 5. `src/components/qa/MissingLinesModal.tsx` (3 457 строк) и `src/components/QAPanel.tsx` (2 897 строк)
Оба крупных файла подсистемы контроля качества реорганизуются внутри `src/components/qa/`:
1. **Декомпозиция `MissingLinesModal.tsx` (3 457 строк)**:
   - `MissingLinesModal.tsx` (~850 строк) — основной контейнер модального окна и оркестрация состояния.
   - `src/components/qa/MissingLinesComparisonList.tsx` (~1 150 строк) — таблица/список сверки реплик, фильтры по персонажам/актёрам и аудиопревью фрагментов.
   - `src/components/qa/MissingLinesWaveformDiff.tsx` (~900 строк) — визуальное сопоставление волновой формы оригинала и озвучки, ручная разметка пропусков и генерация отчёта для фиксов.
   - `src/components/qa/missingLinesModalUtils.ts` (~550 строк) — вспомогательные функции группировки, экспорта списка фиксов в Telegram/буфер и расчёта метрик.
2. **Декомпозиция `QAPanel.tsx` (2 897 строк)**:
   - `QAPanel.tsx` (~850 строк) — каркас экрана контроля качества и управление запуском проверок.
   - `src/components/qa/QAIssuesListAndFilters.tsx` (~1 050 строк) — список найденных проблем (технический брак, тайминг, пропуски, громкость), фильтрация и быстрые переходы.
   - `src/components/qa/QAAudioMetricsInspector.tsx` (~950 строк) — панель детальных аудиометрик, графиков уровня/шума и пакетного исправления.

---

### Этап 6. `electron/services/audio_ai_processor.py` (2 624 строки) и `electron/sidecars/audio_ai_processor.py` (2 568 строк)
Устраняется дублирование между `services/` и `sidecars/` (точка входа в `sidecars` делегирует в общий пакет `electron/services/audio_ai/`), а сам Python-процессор разбивается на фасад `audio_ai_processor.py` (~450 строк: CLI-парсер `main()`, `check_env()`) и пакет `electron/services/audio_ai/`:
1. **`electron/services/audio_ai/torch_runtime.py` (~650 строк)**
   - Инициализация окружения (`_heal_torch_c_init`, `_safe_import_torch`, `_bootstrap_site_packages`), выбор устройства (`get_optimal_device`), ресемплинг, `AudioConditioner` и `VADChunkBatcher`.
2. **`electron/services/audio_ai/separation_and_clean.py` (~800 строк)**
   - Нейросетевые пайплайны разделения и очистки: `process_demucs`, `process_uvr_inference`, `process_deepfilternet`, `process_voicefixer`, `download_model_cli`.
3. **`electron/services/audio_ai/dsp_and_alignment.py` (~850 строк)**
   - Обработка DSP и выравнивания: `process_pedalboard_dsp`, `process_airwindows_dsp`, `process_whisper_diarization`, `process_aeneas_align`, `process_mfa_analyze`, `process_loudness_norm`, `process_voice_timbre_match`.

---

### Этап 7. `electron/services/AudioAnalysisService.cjs` (2 560 строк)
Сервис анализа аудио разбивается на фасад `AudioAnalysisService.cjs` (~700 строк) и подмодули в `electron/services/analysis/`:
1. **`electron/services/analysis/SpectralAndLoudnessAnalyzer.cjs` (~950 строк)**
   - Замеры громкости (`measureVolumeStats`), шумового порога (`measureNoiseFloor`), LUFS, спектрального баланса, клиппинга и реверберации.
2. **`electron/services/analysis/SpeechAndDefectDetector.cjs` (~900 строк)**
   - Детекция речевых сегментов, сверка с субтитрами/Whisper, поиск артефактов, щелчков, сибилянтов и формирование рекомендаций для пайплайна сведения.

---

### Этап 8. `electron/services/TelegramMTProtoService.cjs` (2 283 строки)
Сервис Telegram разбивается на фасад `TelegramMTProtoService.cjs` (~650 строк: жизненный цикл клиента, подключение, статус и логи) и подмодули в `electron/services/telegram/`:
1. **`electron/services/telegram/TelegramAuthManager.cjs` (~800 строк)**
   - Авторизация по коду/SMS (`sendCode`, `resendCode`, `signIn`), QR-авторизация (`startQrCodeAuth`, `_pollQrLoginTokenOnce`, `_runQrPollingLoop`), двухфакторный пароль (`submit2FAPassword`) и DC-миграция.
2. **`electron/services/telegram/TelegramChannelAndMediaFetcher.cjs` (~850 строк)**
   - Разрешение пиров (`_resolvePeer`), получение диалогов, парсинг публичных и приватных каналов, поиск постов, извлечение и скачивание аудиофайлов/дорожек и отправка уведомлений через бота.

---

### Этап 9. `src/contexts/AssEditor.tsx` (2 196 строк) и `src/lib/qa/missingLinesDetector.ts` (2 163 строки)
Финальный этап охватывает оставшиеся два файла свыше 2 000 строк:
1. **Декомпозиция `src/contexts/AssEditor.tsx` (2 196 строк)**:
   - `src/contexts/AssEditor.tsx` (~750 строк) — провайдер контекста, базовый стейт и экспорт хука.
   - `src/contexts/assEditor/assSubtitleOperations.ts` (~750 строк) — операции редактирования строк, слияния/разбиения, сдвига таймингов, истории Undo/Redo и стилей ASS.
   - `src/contexts/assEditor/assProjectSync.ts` (~700 строк) — загрузка/сохранение файлов субтитров, синхронизация с аудиодорожками, актёрами и автосохранение.
2. **Декомпозиция `src/lib/qa/missingLinesDetector.ts` (2 163 строки)**:
   - `src/lib/qa/missingLinesDetector.ts` (~650 строк) — публичное API детектора и главный пайплайн сверки.
   - `src/lib/qa/textAlignmentEngine.ts` (~800 строк) — фонетическое и текстовое выравнивание (n-граммы, расстояние Левенштейна, нормализация русских/японских/английских токенов).
   - `src/lib/qa/vadEnergyMatcher.ts` (~700 строк) — анализ энергетической огибающей, сопоставление интервалов VAD с тайм-кодами субтитров и классификация пропусков.

---

## 3. Порядок поэтапной реализации и проверки

Каждый этап выполняется изолированно:
1. Создание подмодулей выбранного файла с полным переносом кода без сокращений.
2. Подключение подмодулей к основному файлу-фасаду с сохранением всех экспортов и сигнатур методов.
3. Запуск `compile_applet` для проверки отсутствия синтаксических и типовых ошибок перед переходом к следующему этапу.
