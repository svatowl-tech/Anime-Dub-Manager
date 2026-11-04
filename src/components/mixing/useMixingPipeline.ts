import React, { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { 
  Episode, 
  MixingManifest, 
  PipelineStep, 
  MixingModuleDef,
  MixingModulePreset,
  PipelinePreset
} from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';
import { safeCopyToClipboard } from '../../lib/clipboard';
import { MixingLogEntry } from './mixing.types';

interface UseMixingPipelineParams {
  currentEpisode?: Episode | null;
  onRefresh?: () => void;
}

export function useMixingPipeline({ currentEpisode, onRefresh }: UseMixingPipelineParams) {
  const [manifest, setManifest] = useState<MixingManifest | null>(null);
  const [moduleDatabase, setModuleDatabase] = useState<MixingModuleDef[]>([]);
  const [workingDir, setWorkingDir] = useState<string>('');
  const [customTargetDir, setCustomTargetDir] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Active step execution states
  const [activeProcessingStepId, setActiveProcessingStepId] = useState<string | null>(null);
  const [isAborting, setIsAborting] = useState<boolean>(false);
  const [stepProgress, setStepProgress] = useState<Record<string, number>>({});
  const [isPipelineSaving, setIsPipelineSaving] = useState<boolean>(false);
  const [lastPipelineSavedAt, setLastPipelineSavedAt] = useState<string | null>(null);
  const [isSavingFinalVideo, setIsSavingFinalVideo] = useState<boolean>(false);

  // Step card expansion states
  const [expandedSettings, setExpandedSettings] = useState<Record<string, boolean>>({});
  const [expandedTracks, setExpandedTracks] = useState<Record<string, boolean>>({});

  // UVR Neural Model Download state
  const [isDownloadingUvrModel, setIsDownloadingUvrModel] = useState<boolean>(false);
  const [uvrDownloadPercent, setUvrDownloadPercent] = useState<number>(0);

  // Pipeline Presets state
  const [pipelinePresets, setPipelinePresets] = useState<PipelinePreset[]>([]);
  const [isLoadingPresets, setIsLoadingPresets] = useState<boolean>(false);

  // Overlap and Volume states
  const [rolesVolumeMap, setRolesVolumeMap] = useState<Record<string, number>>({});
  const [intentionalOverlaps, setIntentionalOverlaps] = useState<any[]>([]);
  const [isOverlapPriorityModalOpen, setIsOverlapPriorityModalOpen] = useState<boolean>(false);
  const [pendingNormExecution, setPendingNormExecution] = useState<{ mode: 'step' | 'all'; stepId?: string } | null>(null);

  // Diagnostics and live logs
  const [logs, setLogs] = useState<MixingLogEntry[]>([]);
  const [isLogsOpen, setIsLogsOpen] = useState<boolean>(false);
  const [unreadLogsCount, setUnreadLogsCount] = useState<number>(0);

  const saveDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Logging function
  const mixLog = useCallback((
    level: 'info' | 'warn' | 'error' | 'debug' | 'success',
    tag: string,
    message: string,
    meta?: any,
    stepId?: string
  ) => {
    const d = new Date();
    const timestamp = d.toLocaleTimeString('ru-RU', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
    const fullTime = d.toISOString();

    const tagStyle = 'color: #c084fc; font-weight: 700; background: rgba(168, 85, 247, 0.15); padding: 1px 6px; border-radius: 4px;';
    const timeStyle = 'color: #94a3b8; font-weight: 500; font-family: monospace;';
    const levelStyles: Record<string, string> = {
      info: 'color: #38bdf8; font-weight: 600;',
      success: 'color: #4ade80; font-weight: 700;',
      warn: 'color: #facc15; font-weight: 700;',
      error: 'color: #f87171; font-weight: 800;',
      debug: 'color: #a1a1aa; font-style: italic;',
    };

    const consoleMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : level === 'debug' ? console.debug : console.log;

    if (meta !== undefined && meta !== null) {
      consoleMethod(
        `%c[Сведение видео]%c %c[${tag}]%c %c${timestamp}%c ${message}`,
        'color: #a855f7; font-weight: bold;',
        '',
        tagStyle,
        '',
        timeStyle,
        levelStyles[level] || '',
        meta
      );
    } else {
      consoleMethod(
        `%c[Сведение видео]%c %c[${tag}]%c %c${timestamp}%c ${message}`,
        'color: #a855f7; font-weight: bold;',
        '',
        tagStyle,
        '',
        timeStyle,
        levelStyles[level] || ''
      );
    }

    setLogs(prev => {
      const entry: MixingLogEntry = {
        id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp,
        fullTime,
        level,
        tag,
        message,
        stepId,
        meta
      };
      const updated = [...prev, entry];
      return updated.length > 800 ? updated.slice(updated.length - 800) : updated;
    });

    if (!isLogsOpen) {
      setUnreadLogsCount(prev => prev + 1);
    }
  }, [isLogsOpen]);

  const handleToggleLogs = useCallback(() => {
    setIsLogsOpen(prev => {
      if (!prev) setUnreadLogsCount(0);
      return !prev;
    });
  }, []);

  const handleClearLogs = useCallback(() => {
    setLogs([]);
    setUnreadLogsCount(0);
    mixLog('info', 'Консоль', 'Журнал процесса сведения очищен');
  }, [mixLog]);

  const handleCopyLogs = useCallback(async () => {
    const text = logs
      .map(l => `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.tag}] ${l.message}${l.meta ? '\n  ' + JSON.stringify(l.meta) : ''}`)
      .join('\n');
    await safeCopyToClipboard(text);
    toast.success(`Скопировано ${logs.length} строк логов в буфер обмена 📋`);
  }, [logs]);

  const getModuleMeta = useCallback((moduleId: string): MixingModuleDef | undefined => {
    return moduleDatabase.find(m => m.id === moduleId);
  }, [moduleDatabase]);

  const isPhraseNormModule = useCallback((moduleId?: string) => {
    return moduleId === 'phrase_smart_leveler' || moduleId === 'ffmpeg_loudnorm' || moduleId === 'pyloudnorm';
  }, []);

  // Load Status
  const loadStatus = useCallback(async () => {
    if (!currentEpisode) return;
    try {
      setIsLoading(true);
      mixLog('debug', 'Статус', `Запрос состояния сведения серии #${currentEpisode.number || 1}...`);
      const res: any = await ipcSafe.invoke('mixing-get-status', {
        episode: currentEpisode,
        targetDir: customTargetDir || undefined
      });
      if (res && res.manifest) {
        setManifest(res.manifest);
        setWorkingDir(res.workingDir || '');
        if (res.moduleDatabase) {
          setModuleDatabase(res.moduleDatabase);
        }
        if (res.rolesVolumeMap) {
          setRolesVolumeMap(res.rolesVolumeMap);
        }
        if (Array.isArray(res.timingMetadata?.intentionalOverlaps)) {
          setIntentionalOverlaps(res.timingMetadata.intentionalOverlaps);
        }
        mixLog('info', 'Статус', `Состояние загружено: «${res.workingDir || ''}». Модулей: ${res.manifest.pipeline?.length || 0}. Исходных дорожек: ${res.manifest.sourceFiles?.dubberTracks?.length || 0}`, {
          manifest: res.manifest,
          workingDir: res.workingDir
        });
      }
    } catch (e: any) {
      mixLog('error', 'Статус', `Ошибка загрузки статуса сведения: ${e.message || String(e)}`, { error: e, stack: e.stack });
      toast.error(`Ошибка загрузки статуса сведения: ${e.message || String(e)}`);
    } finally {
      setIsLoading(false);
    }
  }, [currentEpisode, customTargetDir, mixLog]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Real-time IPC listeners for task and mixing updates
  useEffect(() => {
    let unmounted = false;

    const onMixingProgress = (data: any) => {
      if (unmounted || !data) return;
      if (data.stepId && typeof data.percent === 'number') {
        setStepProgress(prev => ({ ...prev, [data.stepId]: data.percent }));
      }
      if (data.message) {
        mixLog('debug', 'Прогресс', data.message, data, data.stepId);
      }
    };

    const onMixingLog = (payload: any) => {
      if (unmounted || !payload) return;
      mixLog(payload.level || 'info', payload.tag || 'Сервер', payload.message || '', payload.meta, payload.stepId);
    };

    let unsubProgress: (() => void) | undefined;
    let unsubLog: (() => void) | undefined;

    if (window.electronAPI && typeof window.electronAPI.on === 'function') {
      unsubProgress = window.electronAPI.on('mixing-progress', onMixingProgress);
      unsubLog = window.electronAPI.on('mixing-log', onMixingLog);
    }

    return () => {
      unmounted = true;
      if (typeof unsubProgress === 'function') unsubProgress();
      if (typeof unsubLog === 'function') unsubLog();
    };
  }, [mixLog]);

  // Save Pipeline
  const savePipeline = useCallback(async (newPipeline: PipelineStep[], immediate = false) => {
    if (!currentEpisode) return;

    setManifest(prev => prev ? { ...prev, pipeline: newPipeline } : null);

    const performSave = async () => {
      try {
        setIsPipelineSaving(true);
        const res: any = await ipcSafe.invoke('mixing-save-pipeline-config', {
          episode: currentEpisode,
          targetDir: workingDir || customTargetDir,
          pipeline: newPipeline
        });
        if (res && res.manifest) {
          setManifest(res.manifest);
        }
        const now = new Date();
        setLastPipelineSavedAt(now.toLocaleTimeString('ru-RU', { hour12: false }));
        mixLog('debug', 'Конвейер', `Цепочка модулей записана в mixing_pipeline.json (${newPipeline.length} шт.)`);
      } catch (e: any) {
        toast.error(`Не удалось сохранить структуру конвейера: ${e.message || String(e)}`);
      } finally {
        setIsPipelineSaving(false);
      }
    };

    if (immediate) {
      if (saveDebounceTimerRef.current) clearTimeout(saveDebounceTimerRef.current);
      await performSave();
    } else {
      if (saveDebounceTimerRef.current) clearTimeout(saveDebounceTimerRef.current);
      saveDebounceTimerRef.current = setTimeout(() => {
        performSave();
      }, 250);
    }
  }, [currentEpisode, workingDir, customTargetDir, mixLog]);

  useEffect(() => {
    return () => {
      if (saveDebounceTimerRef.current) clearTimeout(saveDebounceTimerRef.current);
    };
  }, []);

  const handleMoveStepUp = useCallback((index: number) => {
    if (!manifest?.pipeline || index <= 0) return;
    const newPipeline = [...manifest.pipeline];
    const temp = newPipeline[index];
    newPipeline[index] = newPipeline[index - 1];
    newPipeline[index - 1] = temp;
    newPipeline.forEach((s, idx) => {
      const def = moduleDatabase.find(m => m.id === s.moduleId);
      s.prefix = `${String(idx + 1).padStart(2, '0')}_${def?.defaultPrefix || 'mod_'}`;
    });
    savePipeline(newPipeline, true);
  }, [manifest, moduleDatabase, savePipeline]);

  const handleMoveStepDown = useCallback((index: number) => {
    if (!manifest?.pipeline || index >= manifest.pipeline.length - 1) return;
    const newPipeline = [...manifest.pipeline];
    const temp = newPipeline[index];
    newPipeline[index] = newPipeline[index + 1];
    newPipeline[index + 1] = temp;
    newPipeline.forEach((s, idx) => {
      const def = moduleDatabase.find(m => m.id === s.moduleId);
      s.prefix = `${String(idx + 1).padStart(2, '0')}_${def?.defaultPrefix || 'mod_'}`;
    });
    savePipeline(newPipeline, true);
  }, [manifest, moduleDatabase, savePipeline]);

  const handleDeleteStep = useCallback((index: number) => {
    if (!manifest?.pipeline) return;
    const stepToDelete = manifest.pipeline[index];
    const newPipeline = manifest.pipeline.filter((_, idx) => idx !== index);
    newPipeline.forEach((s, idx) => {
      const def = moduleDatabase.find(m => m.id === s.moduleId);
      s.prefix = `${String(idx + 1).padStart(2, '0')}_${def?.defaultPrefix || 'mod_'}`;
    });
    savePipeline(newPipeline, true);
    toast.success(`Модуль «${stepToDelete.moduleId}» удален из конвейера`);
  }, [manifest, moduleDatabase, savePipeline]);

  const handleToggleStep = useCallback((index: number) => {
    if (!manifest?.pipeline) return;
    const newPipeline = [...manifest.pipeline];
    newPipeline[index] = { ...newPipeline[index], enabled: !newPipeline[index].enabled };
    savePipeline(newPipeline, true);
  }, [manifest, savePipeline]);

  const handleUpdateStepParams = useCallback((stepId: string, paramKey: string, value: any) => {
    if (!manifest?.pipeline) return;
    const newPipeline = manifest.pipeline.map(s => {
      if (s.stepId === stepId) {
        return { ...s, params: { ...s.params, [paramKey]: value } };
      }
      return s;
    });
    savePipeline(newPipeline, false);
  }, [manifest, savePipeline]);

  const handleUpdateStepParamsBatch = useCallback((stepId: string, patch: Record<string, any>, immediateSave: boolean = true) => {
    if (!manifest?.pipeline) return;
    const newPipeline = manifest.pipeline.map(s => {
      if (s.stepId === stepId) {
        return { ...s, params: { ...(s.params || {}), ...patch } };
      }
      return s;
    });
    savePipeline(newPipeline, immediateSave);
  }, [manifest, savePipeline]);

  const handleApplyPreset = useCallback((stepId: string, preset: MixingModulePreset) => {
    if (!manifest?.pipeline) return;
    const newPipeline = manifest.pipeline.map(s => {
      if (s.stepId === stepId) {
        return { ...s, params: { ...s.params, ...preset.params } };
      }
      return s;
    });
    savePipeline(newPipeline, true);
    toast.success(`Применен пресет: «${preset.title}»`);
  }, [manifest, savePipeline]);

  const handleAddModuleFromDatabase = useCallback((modDef: MixingModuleDef) => {
    if (!manifest?.pipeline) return;
    const newIndex = manifest.pipeline.length;
    const newPrefix = `${String(newIndex + 1).padStart(2, '0')}_${modDef.defaultPrefix}`;
    const newStep: PipelineStep = {
      stepId: `step_${Date.now()}_${modDef.id}`,
      moduleId: modDef.id,
      prefix: newPrefix,
      enabled: true,
      params: { ...modDef.defaultParams },
      status: 'idle',
      outputFiles: []
    };
    const newPipeline = [...manifest.pipeline, newStep];
    mixLog('info', 'Конвейер', `Добавлен модуль «${modDef.title}» (префикс: ${newPrefix}) в позицию #${newIndex + 1}`);
    savePipeline(newPipeline, true);
    toast.success(`Модуль «${modDef.title}» добавлен в конвейер!`);
  }, [manifest, mixLog, savePipeline]);

  const handleResetToDefaultPipeline = useCallback(async () => {
    if (!currentEpisode) return;
    if (!window.confirm('Сбросить цепочку модулей к базовому заводскому конвейеру? Все текущие настройки шагов будут сброшены.')) {
      return;
    }
    try {
      const res: any = await ipcSafe.invoke('mixing-reset-pipeline-default', {
        episode: currentEpisode,
        targetDir: workingDir || customTargetDir
      });
      if (res && res.manifest) {
        setManifest(res.manifest);
        toast.success('Конвейер сброшен к базовой заводской цепочке');
      }
    } catch (e: any) {
      toast.error(`Ошибка сброса: ${e.message || String(e)}`);
    }
  }, [currentEpisode, workingDir, customTargetDir]);

  // Step Execution
  const handleRunStep = useCallback(async (stepId: string) => {
    if (!currentEpisode) return;
    const targetStep = manifest?.pipeline?.find(s => s.stepId === stepId);
    const stepMeta = targetStep ? getModuleMeta(targetStep.moduleId) : undefined;
    const stepTitle = stepMeta?.title || targetStep?.moduleId || stepId;

    try {
      setActiveProcessingStepId(stepId);
      setStepProgress(prev => ({ ...prev, [stepId]: 5 }));
      mixLog('info', 'Шаг', `🚀 Запуск шага конвейера: «${stepTitle}» (ID: ${stepId})`, {
        params: targetStep?.params,
        prefix: targetStep?.prefix
      });

      const res: any = await ipcSafe.invoke('mixing-run-step', {
        episode: currentEpisode,
        targetDir: workingDir || customTargetDir,
        stepId
      });

      if (res && res.success) {
        mixLog('success', 'Шаг', `✅ Шаг «${stepTitle}» успешно выполнен за ${res.durationSec || '?'}s! Сформировано файлов: ${res.outputFiles?.length || 0}`, {
          outputFiles: res.outputFiles
        });
        toast.success(`Шаг успешно выполнен! Файлы сохранены на диск. 🚀`);
        await loadStatus();
      }
    } catch (e: any) {
      mixLog('error', 'Шаг', `❌ Сбой выполнения шага «${stepTitle}»: ${e.message || String(e)}`, {
        error: e,
        stack: e.stack,
        stepId
      });
      toast.error(`Ошибка выполнения шага: ${e.message || String(e)}`);
    } finally {
      setActiveProcessingStepId(null);
      setStepProgress(prev => ({ ...prev, [stepId]: 0 }));
      await loadStatus();
    }
  }, [currentEpisode, manifest, getModuleMeta, workingDir, customTargetDir, mixLog, loadStatus]);

  const handleRunAllSteps = useCallback(async () => {
    if (!currentEpisode) return;
    const enabledCount = manifest?.pipeline?.filter(s => s.enabled)?.length || 0;
    try {
      setActiveProcessingStepId('all');
      mixLog('info', 'Конвейер', `🎬 Запуск полной цепочки сведения (${enabledCount} активных модулей)...`);
      toast.info('Запуск конвейера сведения по цепочке модулей...');

      const res: any = await ipcSafe.invoke('mixing-run-all-steps', {
        episode: currentEpisode,
        targetDir: workingDir || customTargetDir
      });

      if (res && res.success) {
        mixLog('success', 'Конвейер', `🎉 Все активные модули сведения успешно выполнены!`, res);
        toast.success('Все активные модули сведения успешно выполнены! 🎉');
        await loadStatus();
      }
    } catch (e: any) {
      mixLog('error', 'Конвейер', `❌ Критический сбой при выполнении конвейера сведения: ${e.message || String(e)}`, {
        error: e,
        stack: e.stack
      });
      toast.error(`Ошибка при сведении: ${e.message || String(e)}`);
    } finally {
      setActiveProcessingStepId(null);
      await loadStatus();
    }
  }, [currentEpisode, manifest, workingDir, customTargetDir, mixLog, loadStatus]);

  const handleAbortProcessing = useCallback(async () => {
    try {
      setIsAborting(true);
      mixLog('warn', 'Остановка', '🛑 Отправка сигнала принудительной остановки всех процессов сведения...');
      toast.warning('Остановка процесса сведения...');
      const res: any = await ipcSafe.invoke('mixing-abort', {
        episode: currentEpisode,
        targetDir: workingDir || customTargetDir
      });
      setActiveProcessingStepId(null);
      setStepProgress({});
      if (res && res.manifest) {
        setManifest(res.manifest);
      } else {
        await loadStatus();
      }
      toast.info('Процесс сведения остановлен пользователем 🛑');
    } catch (e: any) {
      setActiveProcessingStepId(null);
      toast.error(`Ошибка при остановке: ${e.message || String(e)}`);
      await loadStatus();
    } finally {
      setIsAborting(false);
    }
  }, [currentEpisode, workingDir, customTargetDir, mixLog, loadStatus]);

  const handleClearStep = useCallback(async (stepId: string, singleFilePath?: string) => {
    if (!currentEpisode) return;
    try {
      const res: any = await ipcSafe.invoke('mixing-clear-step', {
        episode: currentEpisode,
        targetDir: workingDir || customTargetDir,
        stepId,
        filePath: singleFilePath || null
      });
      if (res && res.manifest) {
        setManifest(res.manifest);
      } else {
        await loadStatus();
      }
      if (singleFilePath) {
        toast.success(`Дорожка удалена из результатов шага`);
      } else {
        toast.success('Шаг очищен: все обработанные дорожки удалены 🧹');
      }
    } catch (e: any) {
      toast.error(`Ошибка очистки шага: ${e.message || String(e)}`);
    }
  }, [currentEpisode, workingDir, customTargetDir, loadStatus]);

  const handleUpdateStepTracks = useCallback(async (
    stepId: string,
    action: 'toggle_exclude' | 'clear_exclusions' | 'add_custom' | 'remove_custom',
    trackKey?: string,
    trackPaths?: string[],
    slotId?: string
  ) => {
    if (!currentEpisode) return;
    try {
      const res: any = await ipcSafe.invoke('mixing-update-step-tracks', {
        episode: currentEpisode,
        targetDir: workingDir || customTargetDir,
        stepId,
        action,
        trackKey,
        trackPaths,
        slotId
      });
      if (res && res.manifest) {
        setManifest(res.manifest);
      } else {
        await loadStatus();
      }
    } catch (e: any) {
      toast.error(`Ошибка обновления дорожек шага: ${e.message || String(e)}`);
    }
  }, [currentEpisode, workingDir, customTargetDir, loadStatus]);

  const handleAddCustomTrackToStep = useCallback(async (stepId: string) => {
    try {
      const res: any = await ipcSafe.invoke('mixing-select-external-files', { type: 'audio' });
      if (res && !res.canceled && Array.isArray(res.filePaths) && res.filePaths.length > 0) {
        await handleUpdateStepTracks(stepId, 'add_custom', undefined, res.filePaths);
        toast.success(`Добавлено дорожек в шаг: ${res.filePaths.length}`);
      }
    } catch (e: any) {
      toast.error(`Ошибка выбора файла: ${e.message || String(e)}`);
    }
  }, [handleUpdateStepTracks]);

  const handleDownloadUvrModel = useCallback(async (targetModelId: string = 'uvr_denoise_lite') => {
    const targetDef = moduleDatabase.find(m => m.id === targetModelId);
    const modelName = targetDef?.name || targetDef?.title || targetModelId;
    const sizeMb = targetDef?.size_mb || 40;

    try {
      setIsDownloadingUvrModel(true);
      setUvrDownloadPercent(5);
      mixLog('info', 'Модель', `Запуск загрузки нейромодели «${modelName}» (${sizeMb} МБ)...`);
      toast.info(`Загрузка модели ${modelName} (${sizeMb} МБ)...`);

      const res: any = await ipcSafe.invoke('mixing-download-uvr-model', {
        modelId: targetModelId
      });

      if (res && res.success) {
        mixLog('success', 'Модель', `Модель ${modelName} успешно активирована!`);
        toast.success(`Модель ${modelName} готова к работе! 🛡`);
        await loadStatus();
      } else {
        toast.error(`Не удалось активировать модель ${modelName}`);
      }
    } catch (e: any) {
      mixLog('error', 'Модель', `Ошибка загрузки модели ${modelName}: ${e.message || String(e)}`);
      toast.error(`Ошибка загрузки модели: ${e.message || String(e)}`);
    } finally {
      setIsDownloadingUvrModel(false);
      setUvrDownloadPercent(0);
    }
  }, [moduleDatabase, mixLog, loadStatus]);

  const handleRefreshSources = useCallback(async () => {
    if (!currentEpisode) return;
    try {
      toast.info('Поиск видеофайла серии и извлечение звука оригинала...');
      mixLog('info', 'Сканирование', 'Запуск пересканирования исходников серии...');
      const res: any = await ipcSafe.invoke('mixing-refresh-sources', {
        episode: currentEpisode,
        targetDir: workingDir || customTargetDir || undefined
      });
      if (res && res.manifest) {
        setManifest(res.manifest);
        if (res.workingDir) setWorkingDir(res.workingDir);
        toast.success('Исходные файлы и звук оригинала обновлены! 🎵');
        await loadStatus();
      }
    } catch (e: any) {
      toast.error(`Ошибка пересканирования: ${e.message}`);
    }
  }, [currentEpisode, workingDir, customTargetDir, mixLog, loadStatus]);

  const handleSaveFinalVideo = useCallback(async () => {
    if (!currentEpisode) return;
    try {
      setIsSavingFinalVideo(true);
      mixLog('info', 'ЭкспортВидео', `Запрос сохранения сведенного видео серии...`);
      const res: any = await ipcSafe.invoke('mixing-save-final-video', {
        episode: currentEpisode,
        targetDir: workingDir || customTargetDir
      });

      if (res && res.canceled) {
        mixLog('debug', 'ЭкспортВидео', `Сохранение видео отменено пользователем`);
        return;
      }
      if (res && res.success) {
        mixLog('success', 'ЭкспортВидео', `Готовое видео сохранено: ${res.savedPath}`);
        toast.success(`Готовое видео серии сохранено: ${res.savedPath} 🎬`);
      }
    } catch (e: any) {
      mixLog('error', 'ЭкспортВидео', `Ошибка сохранения видео: ${e.message || String(e)}`);
      toast.error(`Ошибка сохранения видео: ${e.message || String(e)}`);
    } finally {
      setIsSavingFinalVideo(false);
    }
  }, [currentEpisode, workingDir, customTargetDir, mixLog]);

  return {
    manifest,
    setManifest,
    moduleDatabase,
    workingDir,
    setWorkingDir,
    customTargetDir,
    setCustomTargetDir,
    isLoading,
    activeProcessingStepId,
    isAborting,
    stepProgress,
    isPipelineSaving,
    lastPipelineSavedAt,
    isSavingFinalVideo,
    expandedSettings,
    setExpandedSettings,
    expandedTracks,
    setExpandedTracks,
    isDownloadingUvrModel,
    uvrDownloadPercent,
    pipelinePresets,
    setPipelinePresets,
    isLoadingPresets,
    setIsLoadingPresets,
    rolesVolumeMap,
    setRolesVolumeMap,
    intentionalOverlaps,
    setIntentionalOverlaps,
    logs,
    isLogsOpen,
    unreadLogsCount,
    mixLog,
    handleToggleLogs,
    handleClearLogs,
    handleCopyLogs,
    getModuleMeta,
    loadStatus,
    savePipeline,
    handleMoveStepUp,
    handleMoveStepDown,
    handleDeleteStep,
    handleToggleStep,
    handleUpdateStepParams,
    handleUpdateStepParamsBatch,
    handleApplyPreset,
    handleAddModuleFromDatabase,
    handleResetToDefaultPipeline,
    handleRunStep,
    handleRunAllSteps,
    handleAbortProcessing,
    handleClearStep,
    handleUpdateStepTracks,
    handleAddCustomTrackToStep,
    handleDownloadUvrModel,
    handleRefreshSources,
    handleSaveFinalVideo
  };
}
