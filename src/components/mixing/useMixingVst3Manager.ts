import React, { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { Episode, PipelineStep } from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';
import { resolveLocalPath } from '../../lib/webFileSystem';
import { Vst3PluginItem, Vst3UserPreset } from './mixing.types';

interface UseMixingVst3ManagerParams {
  currentEpisode?: Episode | null;
  workingDir: string;
  customTargetDir: string;
  mixLog: (level: 'info' | 'warn' | 'error' | 'debug' | 'success', tag: string, message: string, meta?: any, stepId?: string) => void;
  onUpdateStepParamsBatch: (stepId: string, patch: Record<string, any>, immediateSave?: boolean) => void;
}

export function useMixingVst3Manager({
  currentEpisode,
  workingDir,
  customTargetDir,
  mixLog,
  onUpdateStepParamsBatch
}: UseMixingVst3ManagerParams) {
  const [isVst3ModalOpen, setIsVst3ModalOpen] = useState<boolean>(false);
  const [isScanningVst3, setIsScanningVst3] = useState<boolean>(false);
  const [systemVst3Plugins, setSystemVst3Plugins] = useState<Vst3PluginItem[]>([]);
  const [vst3UserPresets, setVst3UserPresets] = useState<Vst3UserPreset[]>([]);
  const [openingVst3EditorKey, setOpeningVst3EditorKey] = useState<string | null>(null);
  const [newVst3PresetTitle, setNewVst3PresetTitle] = useState<string>('');

  // Per-step VST3 quick snippet preview state
  const [isRenderingVst3Preview, setIsRenderingVst3Preview] = useState<string | null>(null);
  const [vst3PreviewDataByStep, setVst3PreviewDataByStep] = useState<Record<string, {
    pluginName: string;
    trackLabel: string;
    startSec: number;
    durationSec: number;
    dryPath: string;
    wetPath: string;
    peakDbBefore: number;
    peakDbAfter: number;
    activeMode: 'wet' | 'dry';
  }>>({});
  const [isPlayingVst3PreviewStepId, setIsPlayingVst3PreviewStepId] = useState<string | null>(null);
  const [vst3PreviewTrackPathByStep, setVst3PreviewTrackPathByStep] = useState<Record<string, string>>({});
  const [vst3PreviewAutoStartByStep, setVst3PreviewAutoStartByStep] = useState<Record<string, boolean>>({});
  const vst3PreviewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Scan system VST3 plugins
  const handleScanSystemVst3Plugins = useCallback(async (showNotification: boolean = false) => {
    try {
      setIsScanningVst3(true);
      const res: any = await ipcSafe.invoke('mixing-scan-vst3-plugins', {});
      const list = Array.isArray(res?.plugins) ? res.plugins : [];
      setSystemVst3Plugins(list);
      if (showNotification) {
        toast.success(`Найдено VST3 плагинов в системе: ${list.length}`);
      }
    } catch (e: any) {
      if (showNotification) {
        toast.error(`Ошибка сканирования VST3 плагинов: ${e.message || String(e)}`);
      }
    } finally {
      setIsScanningVst3(false);
    }
  }, []);

  // Load user VST3 presets
  const loadVst3UserPresets = useCallback(async () => {
    try {
      const res: any = await ipcSafe.invoke('mixing-list-vst3-presets', {});
      if (Array.isArray(res?.presets)) {
        setVst3UserPresets(res.presets);
      }
    } catch (e) {}
  }, []);

  useEffect(() => {
    loadVst3UserPresets();
  }, [loadVst3UserPresets]);

  // Select VST3 plugin for step
  const handleSelectVst3PluginForStep = useCallback(async (
    step: PipelineStep,
    rawVst3Value: string,
    fallbackName?: string,
    explicitSubPluginName?: string,
    knownSubPlugins?: string[]
  ) => {
    if (!rawVst3Value) return;

    let vst3Path = rawVst3Value;
    let targetSubPlugin = explicitSubPluginName || '';
    if (rawVst3Value.includes(':::')) {
      const [parsedPath, parsedSub] = rawVst3Value.split(':::');
      vst3Path = parsedPath;
      if (!targetSubPlugin && parsedSub) {
        targetSubPlugin = parsedSub;
      }
    }

    const matchingSystemEntry = systemVst3Plugins.find(
      (p) => p.path === vst3Path && Array.isArray(p.subPlugins) && p.subPlugins.length > 0
    );
    const initialSubPlugins = Array.isArray(knownSubPlugins) && knownSubPlugins.length > 0
      ? knownSubPlugins
      : (matchingSystemEntry?.subPlugins || (step.params?.vst3Path === vst3Path && Array.isArray(step.params?.availableSubPlugins) ? step.params.availableSubPlugins : []));

    const cleanName =
      targetSubPlugin ||
      fallbackName ||
      vst3Path.split(/[/\\]/).pop()?.replace(/\.vst3$/i, '') ||
      'VST3 Plugin';

    const isPluginChanged =
      step.params?.vst3Path !== vst3Path ||
      (targetSubPlugin && step.params?.subPluginName && step.params.subPluginName !== targetSubPlugin);

    onUpdateStepParamsBatch(step.stepId, {
      vst3Path,
      pluginName: cleanName,
      subPluginName: targetSubPlugin || (initialSubPlugins.length > 0 ? initialSubPlugins[0] : ''),
      availableSubPlugins: initialSubPlugins,
      ...(isPluginChanged ? {
        globalStateFile: '',
        globalStateSizeBytes: 0,
        parametersPreview: {}
      } : {})
    }, true);
    mixLog('info', 'VST3', `Выбран VST3 плагин «${cleanName}»: ${vst3Path}${targetSubPlugin ? ` [Sub-Plugin: ${targetSubPlugin}]` : ''}`);

    if (targetSubPlugin && initialSubPlugins.length > 0) {
      toast.success(`Выбран плагин «${targetSubPlugin}» (${initialSubPlugins.length} плагинов в контейнере)`);
      return;
    }

    try {
      const inspectRes: any = await ipcSafe.invoke('mixing-inspect-vst3-plugin', {
        vst3Path,
        subPluginName: targetSubPlugin
      });
      if (inspectRes && inspectRes.success) {
        const subPlugins =
          Array.isArray(inspectRes.subPlugins) && inspectRes.subPlugins.length > 0
            ? inspectRes.subPlugins
            : initialSubPlugins;
        const resolvedSub =
          targetSubPlugin ||
          (subPlugins.length > 1 && inspectRes.pluginName && subPlugins.includes(inspectRes.pluginName)
            ? inspectRes.pluginName
            : (subPlugins.length > 0 ? subPlugins[0] : ''));
        const resolvedDisplay = resolvedSub || inspectRes.pluginName || cleanName;

        onUpdateStepParamsBatch(step.stepId, {
          vst3Path,
          pluginName: resolvedDisplay,
          subPluginName: resolvedSub,
          availableSubPlugins: subPlugins,
          totalParameters: inspectRes.totalParameters || 0,
          parametersPreview: inspectRes.parametersPreview || {}
        }, true);
        toast.success(
          subPlugins.length > 1
            ? `Контейнер подключен (${subPlugins.length} плагинов) — активен «${resolvedDisplay}»`
            : `Плагин «${resolvedDisplay}» подключен`
        );
      }
    } catch (e: any) {
      mixLog('warn', 'VST3', `Предупреждение при инспекции VST3 плагина: ${e.message || String(e)}`);
    }
  }, [systemVst3Plugins, onUpdateStepParamsBatch, mixLog]);

  const handleBrowseVst3File = useCallback(async (step: PipelineStep) => {
    try {
      const res: any = await ipcSafe.invoke('mixing-select-vst3-file', {});
      if (res && !res.canceled && res.vst3Path) {
        await handleSelectVst3PluginForStep(step, res.vst3Path, res.name);
      }
    } catch (e: any) {
      toast.error(`Ошибка выбора файла .vst3: ${e.message || String(e)}`);
    }
  }, [handleSelectVst3PluginForStep]);

  const handleOpenVst3NativeEditor = useCallback(async (step: PipelineStep, trackKey?: string, trackLabel?: string) => {
    const vst3Path = step.params?.vst3Path;
    if (!vst3Path) {
      toast.error('Сначала выберите VST3 плагин (.vst3) из списка или через кнопку «Обзор .vst3»');
      return;
    }

    const editorLockKey = trackKey ? `${step.stepId}::${trackKey}` : `${step.stepId}::global`;
    const perTrackMap = step.params?.perTrackStates || step.params?.perTrackStateFiles || {};
    const currentStateFile = trackKey
      ? (perTrackMap[trackKey]?.stateFile || step.params?.globalStateFile || '')
      : (step.params?.globalStateFile || '');

    try {
      setOpeningVst3EditorKey(editorLockKey);
      const targetDesc = trackLabel ? `дорожки «${trackLabel}»` : 'всего шага';
      toast.info(`Открывается окно VST3 «${step.params?.pluginName || 'Плагин'}» для ${targetDesc}.`);
      mixLog('info', 'VST3 GUI', `Открытие интерфейса VST3 «${step.params?.pluginName || vst3Path}» (${targetDesc})...`);

      const res: any = await ipcSafe.invoke('mixing-open-vst3-editor', {
        episode: currentEpisode,
        targetDir: workingDir || customTargetDir,
        stepId: step.stepId,
        vst3Path,
        subPluginName: step.params?.subPluginName || '',
        trackKey: trackKey || '',
        stateFile: currentStateFile
      });

      if (res && res.success) {
        if (trackKey) {
          const prevMap = { ...(step.params?.perTrackStates || step.params?.perTrackStateFiles || {}) };
          prevMap[trackKey] = {
            stateFile: res.stateFile,
            stateSizeBytes: res.stateSizeBytes || 0,
            updatedAt: res.updatedAt || new Date().toISOString(),
            pluginName: res.pluginName || step.params?.pluginName,
            parametersPreview: res.parametersPreview || {}
          };
          onUpdateStepParamsBatch(step.stepId, {
            pluginName: res.pluginName || step.params?.pluginName,
            perTrackStates: prevMap,
            perTrackStateFiles: prevMap
          }, true);
        } else {
          onUpdateStepParamsBatch(step.stepId, {
            pluginName: res.pluginName || step.params?.pluginName,
            globalStateFile: res.stateFile,
            globalStateSizeBytes: res.stateSizeBytes || 0,
            globalStateUpdatedAt: res.updatedAt || new Date().toISOString(),
            parametersPreview: res.parametersPreview || {}
          }, true);
        }
        const kb = ((res.stateSizeBytes || 0) / 1024).toFixed(1);
        toast.success(`Настройки VST3 сохранены (${kb} КБ)!`);
        mixLog('success', 'VST3 GUI', `Слепок состояния VST3 сохранен: ${res.stateFile} (${kb} КБ)`);
      }
    } catch (e: any) {
      toast.error(`Ошибка открытия нативного окна VST3: ${e.message || String(e)}`);
      mixLog('error', 'VST3 GUI', `Ошибка редактора VST3: ${e.message || String(e)}`);
    } finally {
      setOpeningVst3EditorKey(null);
    }
  }, [currentEpisode, workingDir, customTargetDir, mixLog, onUpdateStepParamsBatch]);

  const handleCloseVst3NativeEditor = useCallback(async (step: PipelineStep, trackKey?: string) => {
    try {
      const perTrackMap = step.params?.perTrackStates || step.params?.perTrackStateFiles || {};
      const currentStateFile = trackKey
        ? (perTrackMap[trackKey]?.stateFile || step.params?.globalStateFile || '')
        : (step.params?.globalStateFile || '');
      await ipcSafe.invoke('mixing-close-vst3-editor', {
        episode: currentEpisode,
        targetDir: workingDir || customTargetDir,
        stepId: step.stepId,
        vst3Path: step.params?.vst3Path || '',
        subPluginName: step.params?.subPluginName || '',
        trackKey: trackKey || 'global',
        stateFile: currentStateFile
      });
      toast.info('Сигнал сохранения и закрытия VST3 отправлен');
    } catch (e: any) {
      toast.error(`Не удалось закрыть окно VST3: ${e.message || String(e)}`);
    }
  }, [currentEpisode, workingDir, customTargetDir]);

  // Snippet Preview
  const handlePlayVst3PreviewAudio = useCallback((stepId: string, filePath: string, mode: 'wet' | 'dry') => {
    if (!filePath) return;
    setVst3PreviewDataByStep(prev => {
      const existing = prev[stepId];
      if (!existing) return prev;
      return {
        ...prev,
        [stepId]: { ...existing, activeMode: mode }
      };
    });

    try {
      if (!vst3PreviewAudioRef.current) {
        vst3PreviewAudioRef.current = new Audio();
        vst3PreviewAudioRef.current.onended = () => {
          setIsPlayingVst3PreviewStepId(null);
        };
      }
      const audioEl = vst3PreviewAudioRef.current;
      const prevTime = isPlayingVst3PreviewStepId === stepId ? audioEl.currentTime : 0;
      const resolvedUrl = `${resolveLocalPath(filePath)}?t=${Date.now()}`;
      audioEl.src = resolvedUrl;
      audioEl.currentTime = prevTime || 0;
      audioEl.play().then(() => {
        setIsPlayingVst3PreviewStepId(stepId);
      }).catch(() => {
        setIsPlayingVst3PreviewStepId(null);
      });
    } catch (e) {
      setIsPlayingVst3PreviewStepId(null);
    }
  }, [isPlayingVst3PreviewStepId]);

  const handleStopVst3PreviewAudio = useCallback(() => {
    if (vst3PreviewAudioRef.current) {
      vst3PreviewAudioRef.current.pause();
    }
    setIsPlayingVst3PreviewStepId(null);
  }, []);

  const handleRenderVst3PreviewSnippet = useCallback(async (step: PipelineStep, candidateTracks: any[], forcedTrack?: any) => {
    const vst3Path = step.params?.vst3Path;
    if (!vst3Path) {
      toast.error('Сначала выберите VST3 плагин (.vst3)');
      return;
    }

    const chosenTrackPath = forcedTrack?.path || vst3PreviewTrackPathByStep[step.stepId] || candidateTracks[0]?.path;
    const chosenTrackObj = forcedTrack || candidateTracks.find((t: any) => t.path === chosenTrackPath) || candidateTracks[0];
    if (!chosenTrackObj || !chosenTrackObj.path) {
      toast.error('Нет доступной аудиодорожки для рендера превью');
      return;
    }

    const tKey = chosenTrackObj.trackKey || chosenTrackObj.dubberNick || chosenTrackObj.name;
    const routingMode = step.params?.routingMode || 'batch_all';
    const perTrackMap = step.params?.perTrackStates || step.params?.perTrackStateFiles || {};
    const stateFile = (routingMode === 'per_track' && perTrackMap[tKey]?.stateFile)
      ? perTrackMap[tKey].stateFile
      : (step.params?.globalStateFile || '');
    const activeParamsJson = (routingMode === 'per_track' && perTrackMap[tKey]?.parametersPreview)
      ? perTrackMap[tKey].parametersPreview
      : (step.params?.parametersPreview || null);

    const autoStart = vst3PreviewAutoStartByStep[step.stepId] !== false;
    const snippetStartSec = autoStart ? -1 : Number(step.params?.snippetStartSec ?? 0);
    const snippetDurationSec = Number(step.params?.snippetDurationSec ?? 12);

    try {
      setIsRenderingVst3Preview(step.stepId);
      mixLog('info', 'VST3 Превью', `Рендер превью фрагмента (${snippetDurationSec}с) дорожки «${chosenTrackObj.dubberNick || chosenTrackObj.name}» через VST3...`);

      const res: any = await ipcSafe.invoke('mixing-preview-vst3-snippet', {
        episode: currentEpisode,
        targetDir: workingDir || customTargetDir,
        stepId: step.stepId,
        vst3Path,
        subPluginName: step.params?.subPluginName || '',
        stateFile,
        paramsJson: activeParamsJson,
        parametersPreview: activeParamsJson,
        inputPath: chosenTrackObj.path,
        trackKey: tKey,
        wetMixPercent: step.params?.wetMixPercent ?? 100,
        outputGainDb: step.params?.outputGainDb ?? 0,
        snippetStartSec,
        snippetDurationSec
      });

      if (res && res.success) {
        const previewEntry = {
          pluginName: res.pluginName || step.params?.pluginName || 'VST3',
          trackLabel: chosenTrackObj.dubberNick || chosenTrackObj.name,
          startSec: res.startSec ?? 0,
          durationSec: res.durationSec ?? snippetDurationSec,
          dryPath: res.dryPath,
          wetPath: res.wetPath,
          peakDbBefore: res.peakDbBefore ?? 0,
          peakDbAfter: res.peakDbAfter ?? 0,
          activeMode: 'wet' as const
        };
        setVst3PreviewDataByStep(prev => ({
          ...prev,
          [step.stepId]: previewEntry
        }));
        toast.success(`Превью VST3 готово!`);
        handlePlayVst3PreviewAudio(step.stepId, res.wetPath, 'wet');
      }
    } catch (e: any) {
      toast.error(`Ошибка рендера превью VST3: ${e.message || String(e)}`);
      mixLog('error', 'VST3 Превью', `Сбой рендера: ${e.message || String(e)}`);
    } finally {
      setIsRenderingVst3Preview(null);
    }
  }, [currentEpisode, workingDir, customTargetDir, vst3PreviewTrackPathByStep, vst3PreviewAutoStartByStep, mixLog, handlePlayVst3PreviewAudio]);

  // Save preset
  const handleSaveVst3UserPreset = useCallback(async (step: PipelineStep) => {
    const stateFile = step.params?.globalStateFile;
    if (!stateFile) {
      toast.error('Сначала откройте нативный интерфейс VST3 и настройте звук');
      return;
    }
    const title = (newVst3PresetTitle || '').trim() || `${step.params?.pluginName || 'VST3'} Пресет`;
    try {
      const res: any = await ipcSafe.invoke('mixing-save-vst3-preset', {
        title,
        vst3Path: step.params?.vst3Path || '',
        pluginName: step.params?.pluginName || '',
        subPluginName: step.params?.subPluginName || '',
        stateFile,
        wetMixPercent: step.params?.wetMixPercent ?? 100,
        outputGainDb: step.params?.outputGainDb ?? 0
      });
      if (res && res.success) {
        setNewVst3PresetTitle('');
        await loadVst3UserPresets();
        toast.success(`Пресет «${title}» сохранен!`);
      }
    } catch (e: any) {
      toast.error(`Ошибка сохранения VST3 пресета: ${e.message || String(e)}`);
    }
  }, [newVst3PresetTitle, loadVst3UserPresets]);

  // Apply preset
  const handleApplyVst3UserPreset = useCallback(async (step: PipelineStep, presetId: string, trackKey?: string) => {
    try {
      const res: any = await ipcSafe.invoke('mixing-apply-vst3-preset', {
        episode: currentEpisode,
        targetDir: workingDir || customTargetDir,
        presetId,
        stepId: step.stepId,
        trackKey: trackKey || ''
      });
      if (res && res.success && res.preset) {
        const p = res.preset;
        if (trackKey) {
          const prevMap = { ...(step.params?.perTrackStates || step.params?.perTrackStateFiles || {}) };
          prevMap[trackKey] = {
            stateFile: res.stateFile,
            stateSizeBytes: res.stateSizeBytes || 0,
            updatedAt: new Date().toISOString(),
            pluginName: p.pluginName || step.params?.pluginName,
            parametersPreview: res.parametersPreview || {}
          };
          onUpdateStepParamsBatch(step.stepId, {
            perTrackStates: prevMap,
            perTrackStateFiles: prevMap
          }, true);
        } else {
          onUpdateStepParamsBatch(step.stepId, {
            vst3Path: p.vst3Path || step.params?.vst3Path,
            pluginName: p.pluginName || step.params?.pluginName,
            subPluginName: p.subPluginName || step.params?.subPluginName || '',
            globalStateFile: res.stateFile,
            globalStateSizeBytes: res.stateSizeBytes || 0,
            globalStateUpdatedAt: new Date().toISOString(),
            parametersPreview: res.parametersPreview || {},
            wetMixPercent: p.wetMixPercent ?? step.params?.wetMixPercent ?? 100,
            outputGainDb: p.outputGainDb ?? step.params?.outputGainDb ?? 0
          }, true);
        }
        toast.success(`Применен VST3 пресет «${p.title || p.name}»!`);
      }
    } catch (e: any) {
      toast.error(`Ошибка применения VST3 пресета: ${e.message || String(e)}`);
    }
  }, [currentEpisode, workingDir, customTargetDir, onUpdateStepParamsBatch]);

  // Delete preset
  const handleDeleteVst3UserPreset = useCallback(async (presetId: string) => {
    try {
      const res: any = await ipcSafe.invoke('mixing-delete-vst3-preset', { presetId });
      if (res && res.success) {
        await loadVst3UserPresets();
        toast.success('VST3 пресет удален');
      }
    } catch (e: any) {
      toast.error(`Ошибка удаления VST3 пресета: ${e.message || String(e)}`);
    }
  }, [loadVst3UserPresets]);

  return {
    isVst3ModalOpen,
    setIsVst3ModalOpen,
    isScanningVst3,
    systemVst3Plugins,
    vst3UserPresets,
    openingVst3EditorKey,
    newVst3PresetTitle,
    setNewVst3PresetTitle,
    isRenderingVst3Preview,
    vst3PreviewDataByStep,
    isPlayingVst3PreviewStepId,
    vst3PreviewTrackPathByStep,
    setVst3PreviewTrackPathByStep,
    vst3PreviewAutoStartByStep,
    setVst3PreviewAutoStartByStep,
    handleScanSystemVst3Plugins,
    loadVst3UserPresets,
    handleSelectVst3PluginForStep,
    handleBrowseVst3File,
    handleOpenVst3NativeEditor,
    handleCloseVst3NativeEditor,
    handleRenderVst3PreviewSnippet,
    handlePlayVst3PreviewAudio,
    handleStopVst3PreviewAudio,
    handleSaveVst3UserPreset,
    handleApplyVst3UserPreset,
    handleDeleteVst3UserPreset
  };
}
