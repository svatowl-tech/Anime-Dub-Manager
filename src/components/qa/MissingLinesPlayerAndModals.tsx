import React from "react";
import {
  X,
  Play,
  Pause,
  VolumeX,
  Volume2,
  AlertTriangle,
  Check,
  Scissors,
  MessageSquare,
  Sparkles,
  FileText,
  UserCheck,
  Headphones,
  Copy,
  CheckCircle2,
  Clock,
  Mic,
  Zap,
  ArrowRightLeft,
  Repeat,
  Activity,
  ScrollText,
  Terminal,
  Video,
  Save,
  FileCheck,
  Edit3,
  Gauge
} from "lucide-react";
import { toast } from "sonner";
import { safeCopyToClipboard } from "../../lib/clipboard";
import {
  MissingLineDetection,
  SnippetAudioPlayer,
  QAScanReport
} from "../../lib/qa/missingLinesDetector";
import { Episode, SubtitleLine } from "../../types";

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
  setSoundEngineerModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  soundEngineerReportText: string;
  setSoundEngineerReportText: React.Dispatch<React.SetStateAction<string>>;
  hasCopiedReport: boolean;
  handleCopyReport: () => Promise<void>;
  onOpenTimingPanel?: () => void;
  isLogModalOpen: boolean;
  setIsLogModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  activeReport?: QAScanReport;
  logFilterStage: "all" | "whisper" | "error" | "audio";
  setLogFilterStage: React.Dispatch<React.SetStateAction<"all" | "whisper" | "error" | "audio">>;
  copiedLogs: boolean;
  setCopiedLogs: React.Dispatch<React.SetStateAction<boolean>>;
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
    <>
      {/* Right Column: Built-in Video Player & Subtitle Inspector / Editor */}
      <div className="w-full lg:w-[42%] xl:w-[40%] flex flex-col h-full bg-neutral-950/90 overflow-y-auto custom-scrollbar p-4 space-y-4">
        
        {/* Top Bar for Video Column */}
        <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Video className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                Плеер проверки косяков
                {activeSelectedGap && (
                  <span className="text-[11px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">
                    ⏱ {activeSelectedGap.startFormatted} – {activeSelectedGap.endFormatted}
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-neutral-400">
                Синхронизирован с выбранным замечанием для мгновенного контроля
              </p>
            </div>
          </div>

          {/* Looping toggle */}
          <button
            type="button"
            onClick={() => setIsLoopingSnippet(!isLoopingSnippet)}
            className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition-all ${
              isLoopingSnippet
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'bg-neutral-800 text-neutral-400 hover:text-white border border-neutral-700'
            }`}
            title="Зацикливать воспроизведение выбранного фрагмента косяка"
          >
            <Repeat className={`w-3.5 h-3.5 ${isLoopingSnippet ? 'animate-pulse' : ''}`} />
            <span>Зацикливать</span>
          </button>
        </div>

        {/* Video Player */}
        <div className="space-y-2">
          <div className="relative bg-black rounded-xl overflow-hidden border border-neutral-800 shadow-md aspect-video flex items-center justify-center group">
            {videoUrl ? (
              <>
                <video
                  ref={videoRef}
                  src={videoUrl}
                  onTimeUpdate={handleVideoTimeUpdate}
                  onLoadedMetadata={e => setVideoDuration(e.currentTarget.duration)}
                  onPlay={() => setIsVideoPlaying(true)}
                  onPause={() => setIsVideoPlaying(false)}
                  className="w-full h-full object-contain"
                  playsInline
                />

                {/* Subtitle Overlay in Video */}
                {(activeSubLine?.text || activeSelectedGap?.text) && (
                  <div className="absolute bottom-3 left-4 right-4 pointer-events-none text-center">
                    <span className="inline-block px-3 py-1.5 rounded-lg bg-black/80 text-white font-medium text-xs md:text-sm shadow-lg border border-white/10 backdrop-blur-sm max-w-full truncate">
                      {activeSelectedGap?.characterName && (
                        <strong className="text-amber-400 font-bold mr-1.5">
                          [{activeSelectedGap.characterName}]:
                        </strong>
                      )}
                      {activeSubLine?.text || activeSelectedGap?.text}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="p-6 text-center space-y-2">
                <Video className="w-8 h-8 text-neutral-600 mx-auto" />
                <p className="text-xs text-neutral-400 max-w-xs">
                  Видеофайл для этой серии не загружен. Укажите ссылку на видео в карточке серии для полноценного видеоконтроля.
                </p>
              </div>
            )}
          </div>

          {/* Video Player Controls */}
          {videoUrl && (
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-2.5 space-y-2">
              {/* Scrubber progress */}
              <div className="flex items-center gap-2 text-xs font-mono text-neutral-400">
                <span className="w-12 text-right">{formatTimecode(videoCurrentTime)}</span>
                <input
                  type="range"
                  min={0}
                  max={videoDuration || 100}
                  step={0.1}
                  value={videoCurrentTime}
                  onChange={e => {
                    const val = parseFloat(e.target.value);
                    setVideoCurrentTime(val);
                    if (videoRef.current) videoRef.current.currentTime = val;
                  }}
                  className="flex-1 h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
                <span className="w-12">{formatTimecode(videoDuration)}</span>
              </div>

              {/* Buttons toolbar */}
              <div className="flex items-center justify-between pt-1 border-t border-neutral-800/80">
                <div className="flex items-center gap-1.5">
                  {/* Play/Pause */}
                  <button
                    type="button"
                    onClick={() => {
                      if (!videoRef.current) return;
                      if (isVideoPlaying) videoRef.current.pause();
                      else videoRef.current.play();
                    }}
                    className="p-2 rounded-lg bg-amber-500 text-neutral-950 hover:bg-amber-400 font-bold transition-all shadow-sm"
                    title={isVideoPlaying ? "Пауза" : "Воспроизведение"}
                  >
                    {isVideoPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
                  </button>

                  {/* Jump -2s */}
                  <button
                    type="button"
                    onClick={() => {
                      if (videoRef.current) {
                        videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 2);
                      }
                    }}
                    className="px-2 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-mono transition-colors"
                    title="Назад на 2 секунды"
                  >
                    -2с
                  </button>

                  {/* Jump +2s */}
                  <button
                    type="button"
                    onClick={() => {
                      if (videoRef.current) {
                        videoRef.current.currentTime = Math.min(videoDuration, videoRef.current.currentTime + 2);
                      }
                    }}
                    className="px-2 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-mono transition-colors"
                    title="Вперед на 2 секунды"
                  >
                    +2с
                  </button>

                  {/* Reset to defect start */}
                  {activeSelectedGap && (
                    <button
                      type="button"
                      onClick={() => {
                        if (videoRef.current) {
                          videoRef.current.currentTime = Math.max(0, (activeSelectedGap.artifactTimestampSec ?? activeSelectedGap.startSec) - 0.2);
                          videoRef.current.play().catch(() => {});
                        }
                      }}
                      className="px-2 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-amber-300 text-xs font-semibold flex items-center gap-1 transition-colors"
                      title="Вернуться к началу выбранного фрагмента"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>К фразе</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 text-xs">
                  {/* Speed selector */}
                  <div className="flex items-center gap-1 bg-neutral-950 px-1.5 py-0.5 rounded border border-neutral-800 text-[11px]">
                    <Gauge className="w-3 h-3 text-neutral-400" />
                    {[0.75, 1.0, 1.25].map(speed => (
                      <button
                        key={speed}
                        type="button"
                        onClick={() => {
                          setPlaybackRate(speed);
                          if (videoRef.current) videoRef.current.playbackRate = speed;
                        }}
                        className={`px-1 rounded ${playbackRate === speed ? 'text-amber-400 font-bold' : 'text-neutral-500 hover:text-white'}`}
                      >
                        {speed}x
                      </button>
                    ))}
                  </div>

                  {/* Mute toggle */}
                  <button
                    type="button"
                    onClick={() => {
                      if (videoRef.current) {
                        videoRef.current.muted = !isMuted;
                        setIsMuted(!isMuted);
                      }
                    }}
                    className={`p-1.5 rounded-lg border transition-colors ${
                      isMuted
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                        : 'bg-neutral-800 text-neutral-300 border-neutral-700 hover:text-white'
                    }`}
                    title={isMuted ? "Включить звук" : "Выключить звук видео"}
                  >
                    {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Subtitle Inspector & In-Place Editor */}
        <div className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-4 space-y-3.5">
          <div className="flex items-center justify-between pb-2 border-b border-neutral-800/80">
            <div className="flex items-center gap-2">
              <Edit3 className="w-4 h-4 text-purple-400" />
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                Редактор субтитра и персонажа
              </h4>
            </div>
            {activeSubLine && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">
                Строка #{activeSubLine.rawLineIndex}
              </span>
            )}
          </div>

          {/* Character Assignment & Dubber mapping */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-neutral-400 flex items-center justify-between">
              <span>Персонаж и даббер:</span>
              {activeDubberNickname && (
                <span className="text-amber-400 font-bold">
                  Озвучивает: {activeDubberNickname}
                </span>
              )}
            </label>

            <div className="grid grid-cols-1 gap-2">
              <select
                value={selectedReassignCharacter}
                onChange={e => setSelectedReassignCharacter(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
              >
                <option value="">-- Выберите персонажа для реплики --</option>
                {availableCharacters.map(char => (
                  <option key={char.characterName} value={char.characterName}>
                    {char.characterName} {char.dubberName ? `(${char.dubberName})` : ''}
                  </option>
                ))}
                <option value="__custom__">+ Другой персонаж (ввести вручную)</option>
              </select>

              {selectedReassignCharacter === '__custom__' && (
                <input
                  type="text"
                  placeholder="Имя нового персонажа..."
                  value={customCharacterName}
                  onChange={e => setCustomCharacterName(e.target.value)}
                  className="w-full bg-neutral-950 border border-amber-500/50 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
                />
              )}
            </div>
          </div>

          {/* Text Diff & Subtitle text editor */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium text-neutral-400">Текст субтитра:</span>
              {activeSelectedGap?.recognizedText && (
                <button
                  type="button"
                  onClick={() => setEditingSubText(activeSelectedGap.recognizedText || '')}
                  className="text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1 text-[11px] transition-colors"
                  title="Скопировать распознанный текст Whisper в поле субтитра"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Вставить текст из озвучки</span>
                </button>
              )}
            </div>

            {activeSelectedGap?.recognizedText && (
              <div className="p-2.5 rounded-lg bg-emerald-950/20 border border-emerald-500/30 text-xs text-emerald-200">
                <div className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider mb-1 flex items-center gap-1">
                  <Mic className="w-3 h-3" /> Распознано Whisper в дорожке:
                </div>
                <div className="font-sans italic">«{activeSelectedGap.recognizedText}»</div>
              </div>
            )}

            <textarea
              rows={3}
              value={editingSubText}
              onChange={e => setEditingSubText(e.target.value)}
              placeholder="Текст субтитра..."
              className="w-full bg-neutral-950 border border-neutral-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-amber-500 resize-none font-sans leading-relaxed"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleSaveSubChanges}
              disabled={isSavingSub}
              className="flex-1 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSavingSub ? 'Сохранение...' : 'Сохранить правку в сабах'}</span>
            </button>

            {onExportSubtitles && (
              <button
                type="button"
                onClick={handleExportSubtitlesAction}
                disabled={isExportingSub}
                className="px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 font-semibold text-xs flex items-center gap-1.5 transition-all disabled:opacity-50"
                title="Скачать обновлённые субтитры серии (.ass)"
              >
                <FileCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Экспорт сабов</span>
              </button>
            )}
          </div>
        </div>

        {/* Selected defect summary info card */}
        {activeSelectedGap && (
          <div className="bg-neutral-900/60 border border-neutral-800/80 rounded-xl p-3.5 text-xs space-y-2">
            <div className="flex items-center justify-between text-[11px] text-neutral-400 border-b border-neutral-800 pb-1.5">
              <span className="font-semibold text-white flex items-center gap-1">
                <Info className="w-3.5 h-3.5 text-blue-400" />
                Детали текущего замечания
              </span>
              <span className="font-mono text-amber-400">
                ID: {activeSelectedGap.id.slice(0, 8)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-neutral-500">Категория:</span>
                <p className="font-semibold text-neutral-200 mt-0.5">
                  {activeSelectedGap.typeLabel || activeSelectedGap.defectCategory}
                </p>
              </div>
              <div>
                <span className="text-neutral-500">Статус решения:</span>
                <p className="font-semibold text-neutral-200 mt-0.5">
                  {activeSelectedGap.resolutionAction === 'reassign_character' ? 'Переназначено' :
                   activeSelectedGap.resolutionAction === 'note_sound_engineer' ? 'Отчет звукарю' :
                   activeSelectedGap.resolutionAction === 'request_dubber_fix' ? 'Перезапись даббера' :
                   activeSelectedGap.resolutionAction === 'silence' ? 'Замена тишиной (до тишины)' :
                   activeSelectedGap.resolutionAction === 'keep_first' ? 'Оставить 1-го (до тишины)' :
                   activeSelectedGap.resolutionAction === 'keep_second' ? 'Оставить 2-го (до тишины)' :
                   activeSelectedGap.resolutionAction === 'transfer_second_to_first' ? 'Перенос дубля 2➔1 (до тишины)' :
                   activeSelectedGap.resolutionAction === 'transfer_first_to_second' ? 'Перенос дубля 1➔2 (до тишины)' :
                   activeSelectedGap.resolutionAction === 'auto_shift' ? 'Авто-разведение' :
                   activeSelectedGap.resolutionAction === 'actor_better_than_sub' ? 'Актёр лучше (обновить саб)' :
                   activeSelectedGap.resolutionAction === 'ignore' ? 'Пропущено' : 'К исправлению'}
                </p>
              </div>
            </div>

            {activeSelectedGap.comment && (
              <div className="pt-1.5 border-t border-neutral-800 text-[11px]">
                <span className="text-neutral-500">Примечание к исправлению:</span>
                <p className="text-neutral-300 italic mt-0.5">{activeSelectedGap.comment}</p>
              </div>
            )}
          </div>
        )}

      </div>

        {/* Footer */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-900/95 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 text-xs">
            <span className="text-neutral-400">
              Выбрано к применению: <strong className="text-white font-bold">{selectedCount}</strong> из {gaps.length}
            </span>
            <div className="flex items-center gap-2 pl-2 border-l border-neutral-800 text-[11px] flex-wrap">
              {missingReportCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-300 border border-red-500/20">
                  Фиксов пропусков: <strong>{missingReportCount}</strong>
                </span>
              )}
              {dubberFixArtifactsCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20">
                  Перезаписей артефактов: <strong>{dubberFixArtifactsCount}</strong>
                </span>
              )}
              {soundEngineerArtifactsCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                  В отчет звукарю: <strong>{soundEngineerArtifactsCount}</strong>
                </span>
              )}
              {reassignedCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
                  Переназначений в сабах: <strong>{reassignedCount}</strong>
                </span>
              )}
              {silenceActionsCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                  Замен тишиной: <strong>{silenceActionsCount}</strong>
                </span>
              )}
              {fixSubsActionsCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
                  Правок сабов: <strong>{fixSubsActionsCount}</strong>
                </span>
              )}
              {textMismatchFixCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20">
                  Фиксов текста: <strong>{textMismatchFixCount}</strong>
                </span>
              )}
              {textMismatchActorBetterCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                  Обновлений сабов (актёр лучше): <strong>{textMismatchActorBetterCount}</strong>
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {onOpenTimingPanel && (
              <button
                type="button"
                onClick={() => handleSaveToTiming(true)}
                disabled={isSavingToTiming}
                className="px-4 py-2.5 rounded-xl bg-amber-600/20 hover:bg-amber-600/35 text-amber-300 border border-amber-500/30 text-xs font-bold transition-all flex items-center gap-2 shadow-sm"
                title="Записать найденные коллизии, наезды и тайминги в файл проекта и перейти в студию Тайминг видео"
              >
                <Clock className="w-4 h-4 text-amber-400" />
                <span>Записать и в Тайминг ➔</span>
              </button>
            )}

            <button
              onClick={() => {
                SnippetAudioPlayer.stop();
                onClose();
              }}
              className="px-5 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white text-xs font-bold transition-colors"
            >
              Отмена
            </button>

            <button
              onClick={handleSubmit}
              disabled={selectedCount === 0 || isApplying}
              className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold transition-all flex items-center gap-2 shadow-lg shadow-blue-500/20"
            >
              {isApplying ? (
                <>
                  <Sparkles className="w-4 h-4 animate-spin" />
                  Применение решений...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Применить решения ({selectedCount})
                </>
              )}
            </button>
          </div>
        </div>

      {/* Sound Engineer Report Modal */}
      {soundEngineerModalOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh] text-neutral-200">
            
            {/* Header */}
            <div className="p-5 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/90 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <Headphones className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Сообщение для звукорежиссера</h3>
                  <p className="text-xs text-neutral-400">Сводка наездов хвостов, конфликтов и рассинхрона таймингов</p>
                </div>
              </div>
              <button 
                onClick={() => setSoundEngineerModalOpen(false)}
                className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content Body */}
            <div className="p-5 overflow-y-auto flex-1 custom-scrollbar space-y-3">
              <div className="flex items-center justify-between text-xs text-neutral-400">
                <span>Предпросмотр сообщения (формат Markdown / Текст):</span>
                <span className="font-mono text-[11px] text-neutral-500">{soundEngineerReportText.length} симв.</span>
              </div>
              <pre className="bg-black/70 border border-neutral-800/80 rounded-xl p-4 text-xs font-mono text-neutral-200 whitespace-pre-wrap leading-relaxed select-text">
                {soundEngineerReportText}
              </pre>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-neutral-800 bg-neutral-900/90 flex items-center justify-between shrink-0 gap-3">
              <div className="text-[11px] text-neutral-400 truncate">
                Готово для отправки звукарю или записи в тайминг серии
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setSoundEngineerModalOpen(false)}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-xl text-xs font-bold transition-colors"
                >
                  Закрыть
                </button>
                <button
                  onClick={async () => {
                    await handleSaveToTiming(true);
                    setSoundEngineerModalOpen(false);
                  }}
                  className="px-4 py-2 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-lg shadow-amber-600/20"
                  title="Записать найденные коллизии и наезды в файл тайминга и открыть Тайминг видео для сведения своими руками"
                >
                  <Clock className="w-4 h-4 text-white" />
                  <span>Записать в тайминг (свожу сам)</span>
                </button>
                <button
                  onClick={handleCopyReport}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-lg shadow-indigo-600/20"
                >
                  {hasCopiedReport ? <CheckCircle2 className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                  <span>{hasCopiedReport ? 'Скопировано!' : 'Скопировать звукарю'}</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Comprehensive QA Scan Log Modal */}
      {isLogModalOpen && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh] text-neutral-200">
            {/* Header */}
            <div className="p-5 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/90 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-sky-600/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
                  <Terminal className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span>Журнал проверок дорожек и Whisper</span>
                    {activeReport?.whisperStatus?.attempted && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                        !activeReport.whisperStatus.success || !activeReport.whisperStatus.ready
                          ? 'bg-rose-950/80 text-rose-300 border-rose-500/40'
                          : 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40'
                      }`}>
                        {!activeReport.whisperStatus.success || !activeReport.whisperStatus.ready
                          ? 'Whisper: Неудачна'
                          : 'Whisper: Готова и проверена'}
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-neutral-400">
                    Детальный хронологический лог сканирования аудио, детекции VAD и сверки ASR
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setIsLogModalOpen(false)}
                className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Filter Bar */}
            <div className="px-5 py-2.5 border-b border-neutral-800 bg-neutral-950/60 flex items-center justify-between shrink-0 gap-2">
              <div className="flex items-center gap-1.5">
                {[
                  { id: 'all', label: 'Все записи', count: activeReport?.logs?.length || 0 },
                  { id: 'whisper', label: 'Whisper ASR', count: activeReport?.logs?.filter(l => l.stage === 'whisper').length || 0 },
                  { id: 'error', label: 'Ошибки & Предупреждения', count: activeReport?.logs?.filter(l => l.level === 'error' || l.level === 'warn').length || 0 },
                  { id: 'audio', label: 'Аудио & Детекторы', count: activeReport?.logs?.filter(l => l.stage !== 'whisper').length || 0 }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setLogFilterStage(tab.id as any)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                      logFilterStage === tab.id
                        ? 'bg-neutral-200 text-neutral-900 font-bold'
                        : 'bg-neutral-800/70 text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                      logFilterStage === tab.id ? 'bg-neutral-900 text-white' : 'bg-neutral-700 text-neutral-300'
                    }`}>
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={async () => {
                  const allText = (activeReport?.logs || [])
                    .map(l => `[${l.timestamp}] [${l.stage.toUpperCase()}] [${l.level.toUpperCase()}] ${l.message}${l.details ? ' -> ' + l.details : ''}`)
                    .join('\n');
                  await safeCopyToClipboard(allText);
                  setCopiedLogs(true);
                  toast.success('Лог проверок скопирован в буфер обмена');
                  setTimeout(() => setCopiedLogs(false), 2000);
                }}
                className="px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                {copiedLogs ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedLogs ? 'Скопировано!' : 'Копировать лог'}</span>
              </button>
            </div>

            {/* Log Terminal Console */}
            <div className="p-4 overflow-y-auto flex-1 custom-scrollbar space-y-1 bg-black/90 font-mono text-xs select-text">
              {(!activeReport?.logs || activeReport.logs.length === 0) ? (
                <div className="p-8 text-center text-neutral-500">
                  <Terminal className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <div>Записи журнала проверок отсутствуют.</div>
                  <p className="text-[11px] text-neutral-600 mt-1">Запустите анализ дорожек в окне QA, чтобы залогировать процесс.</p>
                </div>
              ) : (
                activeReport.logs
                  .filter(entry => {
                    if (logFilterStage === 'whisper') return entry.stage === 'whisper';
                    if (logFilterStage === 'error') return entry.level === 'error' || entry.level === 'warn';
                    if (logFilterStage === 'audio') return entry.stage !== 'whisper';
                    return true;
                  })
                  .map(entry => (
                    <div
                      key={entry.id}
                      className={`p-2 rounded border flex items-start gap-2.5 transition-colors ${
                        entry.level === 'error'
                          ? 'bg-rose-950/40 border-rose-500/40 text-rose-200'
                          : entry.level === 'warn'
                          ? 'bg-amber-950/30 border-amber-500/30 text-amber-200'
                          : entry.level === 'success'
                          ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-200'
                          : entry.stage === 'whisper'
                          ? 'bg-purple-950/20 border-purple-500/20 text-purple-200'
                          : 'bg-neutral-900/60 border-neutral-800 text-neutral-300'
                      }`}
                    >
                      <span className="text-[10px] text-neutral-500 shrink-0 font-mono mt-0.5">
                        {entry.timestamp}
                      </span>
                      <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded shrink-0 border ${
                        entry.stage === 'whisper'
                          ? 'bg-purple-900/60 text-purple-300 border-purple-600/40'
                          : entry.stage === 'speech'
                          ? 'bg-blue-900/60 text-blue-300 border-blue-600/40'
                          : entry.stage === 'missing'
                          ? 'bg-rose-900/60 text-rose-300 border-rose-600/40'
                          : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                      }`}>
                        {entry.stage}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="leading-relaxed font-mono">
                          {entry.message}
                        </div>
                        {entry.details && (
                          <div className="text-[11px] text-neutral-400 mt-1 font-mono break-all bg-black/40 p-1.5 rounded border border-neutral-800/80">
                            {entry.details}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
              )}
            </div>

            {/* Footer */}
            <div className="p-3.5 border-t border-neutral-800 bg-neutral-900/90 flex items-center justify-between shrink-0 text-xs text-neutral-400">
              <div className="flex items-center gap-3">
                <span>Проверено дорожек: <strong className="text-neutral-200 font-mono">{activeReport?.totalTracks ?? 0}</strong></span>
                <span>•</span>
                <span>Реплик сценария: <strong className="text-neutral-200 font-mono">{activeReport?.totalSubLines ?? 0}</strong></span>
                <span>•</span>
                <span>Выявлено замечаний: <strong className="text-amber-300 font-mono">{activeReport?.totalGapsFound ?? gaps.length}</strong></span>
              </div>
              <button
                type="button"
                onClick={() => setIsLogModalOpen(false)}
                className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs font-semibold transition-colors"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
