import React, { useState, useEffect, useCallback } from 'react';
import { Episode, SubtitleLine } from '../types';
import { ipcSafe } from '../lib/ipcSafe';
import { toast } from 'sonner';
import { 
  DiarizationMethod, 
  DiarizationTabType, 
  CorrectionLine, 
  ProgressStepInfo 
} from '../types/diarization';
import { generateCorrectionLines, applyApprovedCorrections } from '../lib/diarization/speakerMapper';

// Subcomponents
import { DiarizationHeader } from './diarization/DiarizationHeader';
import { DiarizationProgressBar } from './diarization/DiarizationProgressBar';
import { DiarizationPipelineTab } from './diarization/DiarizationPipelineTab';
import { QuickCharacterAssignTab } from './diarization/QuickCharacterAssignTab';
import { VoiceBaseTab } from './diarization/VoiceBaseTab';
import { SidecarServerTab } from './diarization/SidecarServerTab';
import { CorrectionReviewView } from './diarization/CorrectionReviewView';
import { SpeakerCharacterGrid } from './diarization/SpeakerCharacterGrid';

interface AssDiarizationPanelProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
}

export const AssDiarizationPanel: React.FC<AssDiarizationPanelProps> = ({
  currentEpisode,
  onRefresh,
}) => {
  // Navigation & View State
  const [activeTab, setActiveTab] = useState<DiarizationTabType>('pipeline');
  const [showReviewView, setShowReviewView] = useState<boolean>(false);

  // Subtitles & Episode Data
  const [subLines, setSubLines] = useState<SubtitleLine[]>([]);
  const [knownCharacters, setKnownCharacters] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Environment State
  const [isEnvReady, setIsEnvReady] = useState<boolean>(false);
  const [isCheckingEnv, setIsCheckingEnv] = useState<boolean>(false);

  // Pipeline Configuration
  const [diarizationMethod, setDiarizationMethod] = useState<DiarizationMethod>('whisperx');
  const [expectedSpeakers, setExpectedSpeakers] = useState<number>(0);
  const [hfToken, setHfToken] = useState<string>('');
  const [useOllamaContext, setUseOllamaContext] = useState<boolean>(false);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [selectedOllamaModel, setSelectedOllamaModel] = useState<string>('');
  const [useVoiceBase, setUseVoiceBase] = useState<boolean>(true);
  const [correctionMode, setCorrectionMode] = useState<boolean>(true);

  // Processing & Progress
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progressStep, setProgressStep] = useState<ProgressStepInfo | null>(null);
  const [overallPercent, setOverallPercent] = useState<number>(0);

  // Mapping & Review State
  const [speakerMapping, setSpeakerMapping] = useState<Record<string, string>>({});
  const [characterAssignments, setCharacterAssignments] = useState<Record<string, string>>({});
  const [correctionLines, setCorrectionLines] = useState<CorrectionLine[]>([]);

  // Load Subtitles for current episode
  const loadSubtitles = useCallback(async () => {
    if (!currentEpisode?.subPath) {
      setSubLines([]);
      return;
    }
    try {
      const data = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
      const lines: SubtitleLine[] = data?.lines || data || [];
      setSubLines(lines);

      // Extract existing character names from subtitles
      const chars = new Set<string>();
      lines.forEach((l) => {
        if (l.name && l.name.trim() && l.name !== 'Default' && !l.name.startsWith('Speaker ')) {
          chars.add(l.name.trim());
        }
      });
      setKnownCharacters(Array.from(chars));
    } catch (err) {
      console.error('Error loading subtitles:', err);
    }
  }, [currentEpisode?.subPath]);

  // Check Environment and Ollama Models
  const checkEnvironment = useCallback(async () => {
    setIsCheckingEnv(true);
    try {
      const envRes = await ipcSafe.invoke('check-diarization-status');
      setIsEnvReady(!!envRes?.isLoaded);

      // Check Ollama models
      const ollamaRes = await ipcSafe.invoke('get-ollama-models');
      if (ollamaRes?.success && ollamaRes.models?.length > 0) {
        setOllamaModels(ollamaRes.models);
        setSelectedOllamaModel(ollamaRes.models[0]);
      }
    } catch (err) {
      console.error('Error checking env:', err);
    } finally {
      setIsCheckingEnv(false);
    }
  }, []);

  useEffect(() => {
    loadSubtitles();
    checkEnvironment();
  }, [loadSubtitles, checkEnvironment]);

  // IPC Progress Listeners
  useEffect(() => {
    const handleProgress = (prog: any) => {
      if (prog) {
        setProgressStep(prog);
        const percent = Math.round(((prog.step - 1) / Math.max(1, prog.totalSteps)) * 100 + ((prog.current || 0) / Math.max(1, prog.total || 100)) * (100 / Math.max(1, prog.totalSteps)));
        setOverallPercent(percent);
      }
    };

    ipcSafe.on('advanced-diarization-progress', handleProgress);
    ipcSafe.on('diarization-step', handleProgress);

    return () => {
      ipcSafe.removeListener('advanced-diarization-progress', handleProgress);
      ipcSafe.removeListener('diarization-step', handleProgress);
    };
  }, []);

  // Update subtitles on disk and in state
  const handleUpdateSubtitles = async (newLines: SubtitleLine[]) => {
    if (!currentEpisode?.subPath) {
      toast.error('Путь к файлу субтитров не найден');
      return;
    }

    setIsSaving(true);
    try {
      await ipcSafe.invoke('merge-subtitles', {
        filePath: currentEpisode.subPath,
        newLines,
        overwrite: true,
      });

      setSubLines(newLines);
      toast.success('Субтитры успешно обновлены!');
      onRefresh();
    } catch (err: any) {
      console.error('Error saving subtitles:', err);
      toast.error(`Ошибка при сохранении: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Launch the Advanced AI Diarization Pipeline
  const handleStartPipeline = async () => {
    if (!currentEpisode?.rawPath) {
      toast.error('Не найден видеофайл серии');
      return;
    }

    if (subLines.length === 0) {
      toast.error('В серии нет реплик для анализа');
      return;
    }

    const projectName = currentEpisode.project?.title || currentEpisode.projectId || 'default';
    const episodeTitle = currentEpisode.title || `Серия ${currentEpisode.number}`;

    setIsProcessing(true);
    setProgressStep({
      step: 1,
      totalSteps: 3,
      message: 'Инициализация конвейера диаризации...',
      current: 0,
      total: 100,
    });
    setOverallPercent(5);

    try {
      const res = await ipcSafe.invoke('run-advanced-diarization-pipeline', {
        projectName,
        videoPath: currentEpisode.rawPath,
        projectDetails: projectName,
        episodeDetails: episodeTitle,
        subtitleLines: subLines,
        expectedSpeakersCount: expectedSpeakers,
        ollamaModel: useOllamaContext ? selectedOllamaModel : null,
        useVoiceBase,
        correctionMode,
        diarizationMethod,
      });

      if (!res?.success) {
        throw new Error(res?.error || 'Процесс диаризации завершился с ошибкой');
      }

      setSpeakerMapping(res.speakerMapping || {});
      setCharacterAssignments(res.characterAssignments || {});

      // Build corrections for review
      const proposedReviewLines = generateCorrectionLines(
        subLines,
        res.speakerMapping || {},
        res.characterAssignments || {},
        correctionMode
      );

      setCorrectionLines(proposedReviewLines);

      if (correctionMode) {
        setShowReviewView(true);
        toast.success(`Диаризация завершена! Обнаружено спикеров: ${res.detectedSpeakersCount}`);
      } else {
        // Apply directly if review mode is disabled
        const updated = applyApprovedCorrections(subLines, proposedReviewLines);
        await handleUpdateSubtitles(updated);
        toast.success('Персонажи успешно расставлены в субтитрах!');
      }
    } catch (err: any) {
      console.error('Diarization pipeline error:', err);
      toast.error(`Ошибка диаризации: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setProgressStep(null);
    }
  };

  // Launch Full Transcription & Diarization from Scratch
  const handleStartTranscribeAndDiarize = async () => {
    if (!currentEpisode?.rawPath) {
      toast.error('Не найден видеофайл серии');
      return;
    }

    setIsProcessing(true);
    setProgressStep({
      step: 1,
      totalSteps: 2,
      message: 'Распознавание речи и разделение на роли с нуля...',
      current: 10,
      total: 100,
    });
    setOverallPercent(10);

    try {
      const assPath = await ipcSafe.invoke('transcribe-and-diarize', {
        videoPath: currentEpisode.rawPath,
        language: 'auto',
        model: 'base',
      });

      if (assPath) {
        // Associate generated ASS with episode
        await ipcSafe.invoke('save-episode', {
          ...currentEpisode,
          subPath: assPath,
        });

        toast.success('Видео успешно распознано и разделено на роли!');
        onRefresh();
        await loadSubtitles();
      }
    } catch (err: any) {
      console.error('Transcribe & Diarize error:', err);
      toast.error(`Ошибка: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setProgressStep(null);
    }
  };

  // Handle Review Modal approval
  const handleApplyReview = async (approvedLines: CorrectionLine[]) => {
    const updated = applyApprovedCorrections(subLines, approvedLines);
    await handleUpdateSubtitles(updated);
    setShowReviewView(false);
  };

  // Handle speaker assignment change from grid
  const handleAssignmentChange = (speaker: string, character: string) => {
    setCharacterAssignments((prev) => ({
      ...prev,
      [speaker]: character,
    }));
  };

  // Apply manual assignments from Speaker grid to lines
  const handleApplySpeakerGridAssignments = async () => {
    const updated = subLines.map((line) => {
      const speaker = speakerMapping[String(line.id)];
      if (speaker && characterAssignments[speaker]) {
        return {
          ...line,
          name: characterAssignments[speaker],
        };
      }
      return line;
    });

    await handleUpdateSubtitles(updated);
  };

  return (
    <div className="flex flex-col h-full bg-neutral-950 p-6 overflow-hidden space-y-6">
      {/* Header & Tabs */}
      <DiarizationHeader
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setShowReviewView(false);
        }}
        isEnvReady={isEnvReady}
        isCheckingEnv={isCheckingEnv}
        onRefreshEnv={checkEnvironment}
      />

      {/* Realtime Progress Bar */}
      {isProcessing && (
        <DiarizationProgressBar
          progressStep={progressStep}
          overallPercent={overallPercent}
        />
      )}

      {/* Main Tab Content */}
      <div className="flex-1 overflow-y-auto min-h-0 pr-1">
        {showReviewView ? (
          <CorrectionReviewView
            correctionLines={correctionLines}
            onApply={handleApplyReview}
            onCancel={() => setShowReviewView(false)}
            isSaving={isSaving}
          />
        ) : activeTab === 'pipeline' ? (
          <div className="space-y-6">
            <DiarizationPipelineTab
              currentEpisode={currentEpisode}
              subLines={subLines}
              diarizationMethod={diarizationMethod}
              setDiarizationMethod={setDiarizationMethod}
              expectedSpeakers={expectedSpeakers}
              setExpectedSpeakers={setExpectedSpeakers}
              hfToken={hfToken}
              setHfToken={setHfToken}
              useOllamaContext={useOllamaContext}
              setUseOllamaContext={setUseOllamaContext}
              ollamaModels={ollamaModels}
              selectedOllamaModel={selectedOllamaModel}
              setSelectedOllamaModel={setSelectedOllamaModel}
              useVoiceBase={useVoiceBase}
              setUseVoiceBase={setUseVoiceBase}
              correctionMode={correctionMode}
              setCorrectionMode={setCorrectionMode}
              isProcessing={isProcessing}
              onStartPipeline={handleStartPipeline}
              onStartTranscribeAndDiarize={handleStartTranscribeAndDiarize}
              isEnvReady={isEnvReady}
            />

            {/* Speaker to Character Grid (if speakers were mapped) */}
            {Object.keys(speakerMapping).length > 0 && (
              <SpeakerCharacterGrid
                speakerMapping={speakerMapping}
                characterAssignments={characterAssignments}
                onAssignmentChange={handleAssignmentChange}
                subLines={subLines}
                knownCharacters={knownCharacters}
                onApplyAssignments={handleApplySpeakerGridAssignments}
                isSaving={isSaving}
              />
            )}
          </div>
        ) : activeTab === 'quick-assign' ? (
          <QuickCharacterAssignTab
            currentEpisode={currentEpisode}
            subLines={subLines}
            onRefresh={onRefresh}
            onUpdateSubtitles={handleUpdateSubtitles}
          />
        ) : activeTab === 'voicebase' ? (
          <VoiceBaseTab
            currentEpisode={currentEpisode}
            subLines={subLines}
          />
        ) : activeTab === 'sidecar' ? (
          <SidecarServerTab />
        ) : null}
      </div>
    </div>
  );
};

export default AssDiarizationPanel;
