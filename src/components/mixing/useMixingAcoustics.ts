import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Episode, MixingManifest, MixingModuleDef } from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';

interface UseMixingAcousticsParams {
  currentEpisode?: Episode | null;
  manifest: MixingManifest | null;
  workingDir: string;
  moduleDatabase: MixingModuleDef[];
  mixLog: (level: 'info' | 'warn' | 'error' | 'debug' | 'success', tag: string, message: string, meta?: any, stepId?: string) => void;
  onAddModuleFromDatabase: (modDef: MixingModuleDef) => void;
  onRefreshSources: () => void;
}

export function useMixingAcoustics({
  currentEpisode,
  manifest,
  workingDir,
  moduleDatabase,
  mixLog,
  onAddModuleFromDatabase,
  onRefreshSources
}: UseMixingAcousticsParams) {
  const [isAcousticMatchModalOpen, setIsAcousticMatchModalOpen] = useState<boolean>(false);
  const [origVocalsPath, setOrigVocalsPath] = useState<string>('');
  const [origVocalsError, setOrigVocalsError] = useState<string | null>(null);
  const [ourVocalsPath, setOurVocalsPath] = useState<string>('');
  const [ourVocalsError, setOurVocalsError] = useState<string | null>(null);
  const [isAnalyzingAcoustics, setIsAnalyzingAcoustics] = useState<boolean>(false);
  const [acousticProfile, setAcousticProfile] = useState<any>(null);
  const [selectedEffectFilter, setSelectedEffectFilter] = useState<string>('all');
  const [loudnessStrength, setLoudnessStrength] = useState<number>(100);
  const [reverbStrength, setReverbStrength] = useState<number>(100);
  const [eqStrength, setEqStrength] = useState<number>(100);
  const [targetLufsOffset, setTargetLufsOffset] = useState<number>(0);
  const [isApplyingAcousticMatch, setIsApplyingAcousticMatch] = useState<boolean>(false);
  const [acousticMatchResult, setAcousticMatchResult] = useState<any>(null);

  const runAnalyzeOriginalAcoustics = useCallback(async (audioPath: string) => {
    if (!audioPath) return;
    try {
      setIsAnalyzingAcoustics(true);
      setOrigVocalsError(null);
      mixLog('info', 'АнализЭффектов', `Запуск анализа эффектов вокала оригинала: ${audioPath}`);
      toast.info('Анализ акустических эффектов оригинала...');

      const res: any = await ipcSafe.invoke('audio-analyze-original-snapshots', {
        audioPath,
        options: {
          stepMs: 100,
          minSpeechEnergy: 0.015
        }
      });

      if (res && res.success && res.profile) {
        setAcousticProfile(res.profile);
        mixLog('success', 'АнализЭффектов', `Анализ завершен! Найдено фраз: ${res.profile.phrasesCount || 0}, реверберации: ${res.profile.reverbZonesCount || 0}, фильтров: ${res.profile.filtersCount || 0}`);
        toast.success(`Анализ завершен: ${res.profile.phrasesCount || 0} фраз с эффектами! 📊`);
      } else {
        throw new Error(res?.error || 'Не удалось построить профиль');
      }
    } catch (e: any) {
      const msg = `Ошибка анализа эффектов: ${e.message || String(e)}`;
      setOrigVocalsError(msg);
      mixLog('error', 'АнализЭффектов', msg);
      toast.error(msg);
    } finally {
      setIsAnalyzingAcoustics(false);
    }
  }, [mixLog]);

  const handleOpenAcousticMatcher = useCallback(async () => {
    setIsAcousticMatchModalOpen(true);
    setOrigVocalsError(null);
    setOurVocalsError(null);
    setAcousticMatchResult(null);
    setSelectedEffectFilter('all');

    const epDir = (currentEpisode as any)?.dir || (currentEpisode?.rawPath ? currentEpisode.rawPath.replace(/[/\\][^/\\]+$/, '') : '');
    const searchDirs = [workingDir];
    if (epDir) searchDirs.push(epDir);

    let foundGluedVoices = '';
    try {
      const gluedRes = await ipcSafe.invoke('audio-find-glued-voices', {
        searchDirs,
        manifest,
        options: { strict: true }
      });
      if (gluedRes && typeof gluedRes === 'string') {
        foundGluedVoices = gluedRes;
        setOurVocalsPath(gluedRes);
        setOurVocalsError(null);
        mixLog('info', 'АвтоматизацияЭффектов', `✓ Найдена склеенная дорожка всех голосов: ${gluedRes}`);
      } else {
        setOurVocalsPath('');
        setOurVocalsError(
          '❌ Ошибка: Голоса дабберов не склеены в единую дорожку (voices_master.wav)!\n' +
          'Сначала выполните шаг «Склеивание голосов в одну дорожку» (mix_voices).'
        );
      }
    } catch (e: any) {
      setOurVocalsPath('');
      const msg = e.message || String(e);
      setOurVocalsError(msg);
      mixLog('error', 'АвтоматизацияЭффектов', msg);
    }

    try {
      const foundOrig = await ipcSafe.invoke('audio-find-original-vocals', {
        searchDirs,
        manifest,
        ourVocalsPath: foundGluedVoices,
        options: { strict: true }
      });
      if (foundOrig && typeof foundOrig === 'string') {
        setOrigVocalsPath(foundOrig);
        setOrigVocalsError(null);
        mixLog('info', 'АвтоматизацияЭффектов', `✓ Обнаружена разделенная вокальная дорожка оригинала: ${foundOrig}`);
        runAnalyzeOriginalAcoustics(foundOrig);
      } else {
        setOrigVocalsPath('');
        const errMsg =
          '❌ Ошибка: Оригинальное аудио из видео не было разделено на стемы!\n' +
          'Сначала выполните шаг разделения оригинального аудио (Demucs / UVR / RoFormer / FFmpeg).';
        setOrigVocalsError(errMsg);
        mixLog('error', 'АвтоматизацияЭффектов', errMsg);
      }
    } catch (e: any) {
      setOrigVocalsPath('');
      const msg = e.message || String(e);
      setOrigVocalsError(msg);
      mixLog('error', 'АвтоматизацияЭффектов', msg);
    }
  }, [currentEpisode, workingDir, manifest, mixLog, runAnalyzeOriginalAcoustics]);

  const handleApplyAcousticProfileMatch = useCallback(async () => {
    if (!ourVocalsPath) {
      toast.error('Склейка голосов не найдена');
      return;
    }
    if (!origVocalsPath) {
      toast.error('Вокал оригинала не найден');
      return;
    }

    try {
      setIsApplyingAcousticMatch(true);
      mixLog('info', 'АвтоматизацияЭффектов', `Запуск применения кривой эффектов (громкость: ${loudnessStrength}%, реверберация: ${reverbStrength}%, эквалайзер: ${eqStrength}%)...`);
      toast.info('Применение эффектов оригинала по кривой автоматизации...');

      const epDir = (currentEpisode as any)?.dir || (currentEpisode?.rawPath ? currentEpisode.rawPath.replace(/[/\\][^/\\]+$/, '') : '');
      const searchDirs = [workingDir];
      if (epDir) searchDirs.push(epDir);

      const res: any = await ipcSafe.invoke('audio-apply-acoustic-match', {
        ourVocalsPath,
        originalVocalsPath: origVocalsPath,
        searchDirs,
        manifest,
        options: {
          loudnessStrength,
          reverbStrength,
          eqStrength,
          targetLufsOffset
        }
      });

      setAcousticMatchResult(res);
      if (res.originalProfile) {
        setAcousticProfile(res.originalProfile);
      }
      setIsApplyingAcousticMatch(false);
      toast.success('Эффекты оригинала успешно воспроизведены по кривой автоматизации!');
      mixLog('success', 'АвтоматизацияЭффектов', `✓ Создан файл: ${res.outputPath}`);
      onRefreshSources();
    } catch (e: any) {
      setIsApplyingAcousticMatch(false);
      toast.error(`Ошибка наложения эффектов: ${e.message}`);
      mixLog('error', 'АвтоматизацияЭффектов', `Ошибка наложения эффектов: ${e.message}`);
    }
  }, [ourVocalsPath, origVocalsPath, currentEpisode, workingDir, manifest, loudnessStrength, reverbStrength, eqStrength, targetLufsOffset, mixLog, onRefreshSources]);

  const handleAddAcousticModuleToPipeline = useCallback(() => {
    const modDef = moduleDatabase.find(m => m.id === 'acoustic_original_match');
    if (modDef) {
      onAddModuleFromDatabase({
        ...modDef,
        defaultParams: {
          ...modDef.defaultParams,
          loudnessMatchStrength: loudnessStrength,
          reverbMatchStrength: reverbStrength,
          eqMatchStrength: eqStrength,
          targetLufsOffset,
          strictOriginalVocalsRequired: true,
          strictGluedVoicesRequired: true
        }
      });
      setIsAcousticMatchModalOpen(false);
    } else {
      onAddModuleFromDatabase({
        id: 'acoustic_original_match',
        category: 'analysis',
        defaultPrefix: 'acoustic_matched_',
        name: 'Повторение эффектов оригинала',
        title: 'Повторение эффектов оригинала по кривой автоматизации (Acoustic Effect Matcher)',
        description: 'Строго проверяет наличие разделенного вокала оригинала и склеенной дорожки всех голосов. Выполняет пофразовый анализ и воспроизводит эффекты оригинала на дорожке голосов.',
        defaultParams: {
          loudnessMatchStrength: loudnessStrength,
          reverbMatchStrength: reverbStrength,
          eqMatchStrength: eqStrength,
          targetLufsOffset,
          strictOriginalVocalsRequired: true,
          strictGluedVoicesRequired: true
        }
      } as any);
      setIsAcousticMatchModalOpen(false);
    }
  }, [moduleDatabase, onAddModuleFromDatabase, loudnessStrength, reverbStrength, eqStrength, targetLufsOffset]);

  return {
    isAcousticMatchModalOpen,
    setIsAcousticMatchModalOpen,
    origVocalsPath,
    setOrigVocalsPath,
    origVocalsError,
    ourVocalsPath,
    setOurVocalsPath,
    ourVocalsError,
    isAnalyzingAcoustics,
    acousticProfile,
    selectedEffectFilter,
    setSelectedEffectFilter,
    loudnessStrength,
    setLoudnessStrength,
    reverbStrength,
    setReverbStrength,
    eqStrength,
    setEqStrength,
    targetLufsOffset,
    setTargetLufsOffset,
    isApplyingAcousticMatch,
    acousticMatchResult,
    handleOpenAcousticMatcher,
    runAnalyzeOriginalAcoustics,
    handleApplyAcousticProfileMatch,
    handleAddAcousticModuleToPipeline
  };
}
