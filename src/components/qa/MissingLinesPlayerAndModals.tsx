import React from "react";
import {
  X,
  Play,
  Pause,
  VolumeX,
  Volume2,
  Check,
  Scissors,
  Sparkles,
  FileText,
  UserCheck,
  Headphones,
  Clock,
  Mic,
  Zap,
  ArrowRightLeft,
  Video,
  Save,
  FileCheck,
  Edit3
} from "lucide-react";
import {
  MissingLineDetection,
  QAScanReport
} from "../../lib/qa/missingLinesDetector";
import { Episode, SubtitleLine } from "../../types";
import { MissingLinesLogAndReportModals } from "./missingLines/MissingLinesLogAndReportModals";

export interface MissingLinesPlayerAndModalsProps {
  gaps: MissingLineDetection[];
  activeSelectedGap: MissingLineDetection | null;
  activeSubLine: SubtitleLine | null;
  activeDubberNickname: string | null;
  availableCharacters: Array<{ characterName: string; dubberName: string; dubberId?: string; assignmentId?: string }>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoUrl?: string;
  isVideoPlaying: boolean;
  setIsVideoPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  videoCurrentTime: number;
  setVideoCurrentTime: React.Dispatch<React.SetStateAction<number>>;
  videoDuration: number;
  setVideoDuration: React.Dispatch<React.SetStateAction<number>>;
  isMuted: boolean;
  setIsMuted: React.Dispatch<React.SetStateAction<boolean>>;
  playbackRate: number;
  setPlaybackRate: React.Dispatch<React.SetStateAction<number>>;
  isLoopingSnippet: boolean;
  setIsLoopingSnippet: React.Dispatch<React.SetStateAction<boolean>>;
  handleVideoTimeUpdate: () => void;
  formatTimecode: (sec: number) => string;
  onExportSubtitles?: () => Promise<void>;
  isExportingSub: boolean;
  handleExportSubtitlesAction: () => Promise<void>;
  selectedReassignCharacter: string;
  setSelectedReassignCharacter: React.Dispatch<React.SetStateAction<string>>;
  customCharacterName: string;
  setCustomCharacterName: React.Dispatch<React.SetStateAction<string>>;
  editingSubText: string;
  setEditingSubText: React.Dispatch<React.SetStateAction<string>>;
  isSavingSub: boolean;
  handleSaveSubChanges: () => Promise<void>;
  selectedCount: number;
  silenceActionsCount: number;
  transferActionsCount: number;
  reassignedCount: number;
  fixSubsActionsCount: number;
  missingReportCount: number;
  dubberFixArtifactsCount: number;
  soundEngineerArtifactsCount: number;
  textMismatchFixCount: number;
  textMismatchActorBetterCount: number;
  episode?: Episode | null;
  isSavingToTiming: boolean;
  handleSaveToTiming: (navigateToTiming?: boolean) => Promise<void>;
  handleGenerateReportForSE: () => void;
  onClose: () => void;
  handleSubmit: () => Promise<void>;
  isApplying: boolean;
  soundEngineerModalOpen: boolean;
  setSoundEngineerModalOpen: (val: boolean) => void;
  soundEngineerReportText: string;
  setSoundEngineerReportText: (val: string) => void;
  hasCopiedReport: boolean;
  handleCopyReport: () => Promise<void>;
  onOpenTimingPanel?: () => void;
  isLogModalOpen: boolean;
  setIsLogModalOpen: (val: boolean) => void;
  activeReport?: QAScanReport;
  logFilterStage: "all" | "whisper" | "error" | "audio";
  setLogFilterStage: (val: "all" | "whisper" | "error" | "audio") => void;
  copiedLogs: boolean;
  setCopiedLogs: (val: boolean) => void;
}

export const MissingLinesPlayerAndModals: React.FC<MissingLinesPlayerAndModalsProps> = ({
  gaps,
  activeSelectedGap,
  activeSubLine,
  activeDubberNickname,
  availableCharacters,
  videoRef,
  videoUrl,
  isVideoPlaying,
  setIsVideoPlaying,
  videoCurrentTime,
  setVideoCurrentTime,
  videoDuration,
  setVideoDuration,
  isMuted,
  setIsMuted,
  playbackRate,
  setPlaybackRate,
  isLoopingSnippet,
  setIsLoopingSnippet,
  handleVideoTimeUpdate,
  formatTimecode,
  onExportSubtitles,
  isExportingSub,
  handleExportSubtitlesAction,
  selectedReassignCharacter,
  setSelectedReassignCharacter,
  customCharacterName,
  setCustomCharacterName,
  editingSubText,
  setEditingSubText,
  isSavingSub,
  handleSaveSubChanges,
  selectedCount,
  silenceActionsCount,
  transferActionsCount,
  reassignedCount,
  fixSubsActionsCount,
  missingReportCount,
  dubberFixArtifactsCount,
  soundEngineerArtifactsCount,
  textMismatchFixCount,
  textMismatchActorBetterCount,
  episode,
  isSavingToTiming,
  handleSaveToTiming,
  handleGenerateReportForSE,
  onClose,
  handleSubmit,
  isApplying,
  soundEngineerModalOpen,
  setSoundEngineerModalOpen,
  soundEngineerReportText,
  setSoundEngineerReportText,
  hasCopiedReport,
  handleCopyReport,
  onOpenTimingPanel,
  isLogModalOpen,
  setIsLogModalOpen,
  activeReport,
  logFilterStage,
  setLogFilterStage,
  copiedLogs,
  setCopiedLogs
}) => {
  return (
    <div className="flex flex-col h-full space-y-4">
      
      {/* 1. EMBEDDED VIDEO PLAYER PANEL */}
      <div className="bg-neutral-950 border border-neutral-800/90 rounded-2xl p-3.5 space-y-3 shrink-0 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Video className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              Видеоинспекция дефекта
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-xs">
            {/* Speed selection */}
            <div className="flex items-center bg-neutral-900 rounded-lg p-0.5 border border-neutral-800 text-[10px]">
              {[0.75, 1.0, 1.25, 1.5].map(rate => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => {
                    setPlaybackRate(rate);
                    if (videoRef.current) videoRef.current.playbackRate = rate;
                  }}
                  className={`px-1.5 py-0.5 rounded transition-colors font-mono font-bold ${
                    playbackRate === rate ? 'bg-amber-500 text-neutral-950' : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  {rate}x
                </button>
              ))}
            </div>

            {/* Loop snippet toggle */}
            <label className="flex items-center gap-1.5 text-[11px] text-neutral-300 font-medium cursor-pointer select-none bg-neutral-900 px-2 py-0.5 rounded-lg border border-neutral-800">
              <input
                type="checkbox"
                checked={isLoopingSnippet}
                onChange={(e) => setIsLoopingSnippet(e.target.checked)}
                className="rounded border-neutral-700 text-amber-500 focus:ring-amber-500 w-3 h-3 accent-amber-500 cursor-pointer"
              />
              <span>Петля</span>
            </label>
          </div>
        </div>

        {/* Video Player Box */}
        <div className="aspect-video bg-black rounded-xl overflow-hidden border border-neutral-800 relative group max-h-[280px]">
          <video
            ref={videoRef}
            src={videoUrl || undefined}
            className="w-full h-full object-contain"
            onTimeUpdate={handleVideoTimeUpdate}
            onLoadedMetadata={(e) => setVideoDuration(e.currentTarget.duration)}
            onEnded={() => setIsVideoPlaying(false)}
          />

          {/* Player Overlay Controls */}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
            <input
              type="range"
              min={0}
              max={videoDuration || 100}
              step={0.05}
              value={videoCurrentTime}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setVideoCurrentTime(val);
                if (videoRef.current) videoRef.current.currentTime = val;
              }}
              className="w-full accent-amber-500 mb-2"
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!videoRef.current) return;
                    if (videoRef.current.paused) {
                      videoRef.current.play().catch(() => {});
                      setIsVideoPlaying(true);
                    } else {
                      videoRef.current.pause();
                      setIsVideoPlaying(false);
                    }
                  }}
                  className="p-1.5 bg-amber-500 hover:bg-amber-400 rounded-lg text-neutral-950 transition-colors font-bold"
                >
                  {isVideoPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMuted(!isMuted);
                    if (videoRef.current) videoRef.current.muted = !isMuted;
                  }}
                  className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-white transition-colors"
                >
                  {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
                </button>
              </div>

              <div className="text-xs font-mono text-white bg-black/70 px-2.5 py-1 rounded-md border border-neutral-800">
                {formatTimecode(videoCurrentTime)} / {formatTimecode(videoDuration)}
              </div>
            </div>
          </div>
        </div>

        {/* Active Subtitle Info & In-Place Sub Editor */}
        {activeSubLine && (
          <div className="bg-neutral-900 border border-neutral-800/80 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-amber-300 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-amber-400" />
                Инспектор строки субтитра #{activeSubLine.rawLineIndex}
              </span>
              <span className="text-[10px] text-neutral-400 font-mono">
                [{formatTimecode(activeSubLine.startSec)} – {formatTimecode(activeSubLine.endSec)}]
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-400 shrink-0">Персонаж:</span>
                <select
                  value={selectedReassignCharacter}
                  onChange={(e) => setSelectedReassignCharacter(e.target.value)}
                  className="flex-1 bg-neutral-950 border border-neutral-700 text-white text-xs font-semibold rounded-lg px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  <option value={activeSubLine.name}>{activeSubLine.name} (по умолчанию)</option>
                  {availableCharacters
                    .filter(c => c.characterName !== activeSubLine.name)
                    .map(c => (
                      <option key={c.characterName} value={c.characterName}>
                        {c.characterName} ({c.dubberName})
                      </option>
                    ))}
                  <option value="__custom__">+ Ввести вручную...</option>
                </select>
              </div>

              {selectedReassignCharacter === '__custom__' && (
                <input
                  type="text"
                  value={customCharacterName}
                  onChange={(e) => setCustomCharacterName(e.target.value)}
                  placeholder="Имя нового персонажа..."
                  className="w-full bg-neutral-950 border border-amber-500/50 text-amber-200 text-xs rounded-lg px-2.5 py-1 focus:outline-none"
                />
              )}

              <div className="space-y-1">
                <span className="text-xs text-neutral-400">Текст реплики:</span>
                <textarea
                  value={editingSubText}
                  onChange={(e) => setEditingSubText(e.target.value)}
                  rows={2}
                  className="w-full bg-neutral-950 border border-neutral-700 text-neutral-200 text-xs rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-amber-500 font-sans"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                {onExportSubtitles && (
                  <button
                    type="button"
                    onClick={handleExportSubtitlesAction}
                    disabled={isExportingSub}
                    className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors flex items-center gap-1 border border-neutral-700"
                    title="Сохранить копию исправленного файла субтитров .ass на диск"
                  >
                    <Save className="w-3.5 h-3.5 text-blue-400" />
                    <span>{isExportingSub ? 'Экспорт...' : 'Экспорт сабов .ass'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleSaveSubChanges}
                  disabled={isSavingSub}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-400 text-neutral-950 transition-colors flex items-center gap-1.5 shadow-md shadow-amber-500/20 ml-auto"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>{isSavingSub ? 'Сохранение...' : 'Сохранить правку саба'}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 2. BATCH ACTION SUMMARY & APPLY PANEL */}
      <div className="flex-1 bg-neutral-950 border border-neutral-800/90 rounded-2xl p-4 flex flex-col justify-between space-y-4 shadow-lg">
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-neutral-800 pb-2.5">
            <h3 className="font-bold text-white text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              Сводка выбранных решений ({selectedCount})
            </h3>
            <span className="text-[11px] font-mono text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
              Выбрано: {selectedCount} из {gaps.length}
            </span>
          </div>

          {/* Breakdown of queued operations */}
          <div className="space-y-2 text-xs">
            {silenceActionsCount > 0 && (
              <div className="flex items-center justify-between p-2 rounded-lg bg-blue-950/30 border border-blue-500/30 text-blue-200">
                <span className="flex items-center gap-1.5">
                  <Scissors className="w-3.5 h-3.5 text-blue-400" />
                  Вырезать в тишину (лишняя речь/дубли):
                </span>
                <span className="font-mono font-bold">{silenceActionsCount}</span>
              </div>
            )}

            {transferActionsCount > 0 && (
              <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-emerald-200">
                <span className="flex items-center gap-1.5">
                  <ArrowRightLeft className="w-3.5 h-3.5 text-emerald-400" />
                  Перенос реплик целиком между дорожками:
                </span>
                <span className="font-mono font-bold">{transferActionsCount}</span>
              </div>
            )}

            {reassignedCount > 0 && (
              <div className="flex items-center justify-between p-2 rounded-lg bg-purple-950/30 border border-purple-500/30 text-purple-200">
                <span className="flex items-center gap-1.5">
                  <UserCheck className="w-3.5 h-3.5 text-purple-400" />
                  Переназначение ролей (ошибки сабов):
                </span>
                <span className="font-mono font-bold">{reassignedCount}</span>
              </div>
            )}

            {missingReportCount > 0 && (
              <div className="flex items-center justify-between p-2 rounded-lg bg-amber-950/30 border border-amber-500/30 text-amber-200">
                <span className="flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-amber-400" />
                  Выписать реальные пропуски даберам:
                </span>
                <span className="font-mono font-bold">{missingReportCount}</span>
              </div>
            )}

            {soundEngineerArtifactsCount > 0 && (
              <div className="flex items-center justify-between p-2 rounded-lg bg-indigo-950/30 border border-indigo-500/30 text-indigo-200">
                <span className="flex items-center gap-1.5">
                  <Headphones className="w-3.5 h-3.5 text-indigo-400" />
                  В записку звукорежиссеру (стыки/клиппинг):
                </span>
                <span className="font-mono font-bold">{soundEngineerArtifactsCount}</span>
              </div>
            )}

            {selectedCount === 0 && (
              <div className="p-4 text-center text-xs text-neutral-500 italic bg-neutral-900/50 rounded-xl border border-neutral-800">
                Выберите галками необходимые замечания в списке слева для пакетного применения
              </div>
            )}
          </div>
        </div>

        {/* CTA Buttons Row */}
        <div className="pt-3 border-t border-neutral-800 space-y-2 shrink-0">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={selectedCount === 0 || isApplying}
            className="w-full py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-neutral-950 transition-all flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-neutral-950" />
            <span>
              {isApplying
                ? 'Применение фиксов...'
                : `Применить выбранные решения (${selectedCount})`}
            </span>
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleSaveToTiming(false)}
              disabled={isSavingToTiming || gaps.length === 0}
              className="py-2.5 rounded-xl font-bold text-xs bg-neutral-800 hover:bg-neutral-750 text-amber-300 border border-amber-500/30 transition-all flex items-center justify-center gap-1.5 disabled:opacity-40"
              title="Записать все замечания в проектный паспорт тайминга на диск"
            >
              <Save className="w-3.5 h-3.5 text-amber-400" />
              <span>Сохранить в тайминг</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="py-2.5 rounded-xl font-bold text-xs bg-neutral-850 hover:bg-neutral-800 text-neutral-300 transition-all border border-neutral-750"
            >
              Закрыть
            </button>
          </div>
        </div>
      </div>

      <MissingLinesLogAndReportModals
        soundEngineerModalOpen={soundEngineerModalOpen}
        setSoundEngineerModalOpen={setSoundEngineerModalOpen}
        soundEngineerReportText={soundEngineerReportText}
        hasCopiedReport={hasCopiedReport}
        handleCopyReport={handleCopyReport}
        episode={episode}
        onOpenTimingPanel={onOpenTimingPanel}
        isLogModalOpen={isLogModalOpen}
        setIsLogModalOpen={setIsLogModalOpen}
        activeReport={activeReport}
        logFilterStage={logFilterStage}
        setLogFilterStage={setLogFilterStage}
        copiedLogs={copiedLogs}
        setCopiedLogs={setCopiedLogs}
      />
    </div>
  );
};
