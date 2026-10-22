import React from "react";
import {
  Clock,
  Scissors,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Download,
  RefreshCw,
  MoveHorizontal,
  Layers,
  Activity,
  Check,
  X,
  Settings,
  Loader2,
  ShieldCheck,
  Radio,
  Search,
  Crosshair,
  Zap,
  Copy
} from "lucide-react";
import { Episode, Track } from "../../types";
import { TimingProjectData } from "../../lib/qa/timingSyncService";
import { TimingSettings } from "../TimingSettingsModal";
import {
  AudioClip,
  TimingIssue,
  MissingSubtitleMarker,
  NoiseCalibration,
  formatSeconds
} from "./timingAudioUtils";

export const TimingHeaderAndDiagnostics: React.FC<{
  currentEpisode: Episode | null;
  tracks: Track[];
  audioClips: Record<string, AudioClip[]>;
  isLoading: boolean;
  isImporting: boolean;
  importProgress: number;
  statusMessage: string;
  importDecodedTracks: Array<{ id: string; name: string; duration?: number; status: "pending" | "decoding" | "done" | "error" }>;
  isSilenceRemoved: boolean;
  isFixesStitched: boolean;
  isTimingAnalyzed: boolean;
  timingIssues: TimingIssue[];
  missingSubtitles: MissingSubtitleMarker[];
  isIssuesDrawerOpen: boolean;
  setIsIssuesDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  activeIssueFilter: "all" | "overlap" | "desync" | "missing" | "orphan";
  setActiveIssueFilter: React.Dispatch<React.SetStateAction<"all" | "overlap" | "desync" | "missing" | "orphan">>;
  isLogDrawerOpen: boolean;
  setIsLogDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  operationLogs: Array<{ time: string; msg: string; level: "info" | "success" | "warn" | "error" }>;
  exportingToMixing: boolean;
  setIsExportModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsSettingsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  qaPassportLoaded: { loaded: boolean; summary: TimingProjectData["summary"]; savedAt: string } | null;
  calibrationsByTrack: Record<string, NoiseCalibration>;
  timingSettings: TimingSettings;
  trackHeightMode: "standard" | "compact" | "fit";
  setTrackHeightMode: React.Dispatch<React.SetStateAction<"standard" | "compact" | "fit">>;
  timelineContainerRef: React.MutableRefObject<HTMLDivElement | null>;
  handleImportFromQA: () => void;
  handleSyncFromQA: () => void;
  handleCutSilence: () => void;
  handleStitchFixes: () => void;
  handleAnalyzeTiming: () => void;
  handleApplyTargetedAutoTiming: (typeFilter?: "all" | "overlap" | "desync" | "orphan") => void;
  handleExportToMixing: () => void;
  jumpToTime: (timeSec: number) => void;
  setSelectedClipId: React.Dispatch<React.SetStateAction<string | null>>;
  handleFixSingleClip: (trackId: string, clipId: string) => void;
  handleResolveSingleOverlap: (trackId: string, clipId: string) => void;
  handleTriggerUploadMissing: (marker: MissingSubtitleMarker) => void;
  handleCopyMissingTimecode: (text: string, startSec: number, endSec: number) => void;
  handleDismissMissing: (markerId: string) => void;
}> = (props) => {
  const {
    currentEpisode,
    tracks,
    audioClips,
    isLoading,
    isImporting,
    importProgress,
    statusMessage,
    importDecodedTracks,
    isSilenceRemoved,
    isFixesStitched,
    isTimingAnalyzed,
    timingIssues,
    missingSubtitles,
    isIssuesDrawerOpen,
    setIsIssuesDrawerOpen,
    activeIssueFilter,
    setActiveIssueFilter,
    isLogDrawerOpen,
    setIsLogDrawerOpen,
    operationLogs,
    exportingToMixing,
    setIsExportModalOpen,
    setIsSettingsModalOpen,
    qaPassportLoaded,
    calibrationsByTrack,
    timingSettings,
    trackHeightMode,
    setTrackHeightMode,
    timelineContainerRef,
    handleImportFromQA,
    handleSyncFromQA,
    handleCutSilence,
    handleStitchFixes,
    handleAnalyzeTiming,
    handleApplyTargetedAutoTiming,
    handleExportToMixing,
    jumpToTime,
    setSelectedClipId,
    handleFixSingleClip,
    handleResolveSingleOverlap,
    handleTriggerUploadMissing,
    handleCopyMissingTimecode,
    handleDismissMissing
  } = props;

  return (
    <>
      {/* Top Header Bar */}
      <header className="bg-neutral-900 border-b border-neutral-800 p-3 px-4 shrink-0 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-600/20 border border-amber-500/30 text-amber-400 rounded-xl flex items-center justify-center shadow-lg">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-tight">
                Тайминг видео — {currentEpisode?.project?.title || 'Проект'}
              </h1>
              <span className="bg-amber-950/80 text-amber-300 font-mono text-xs px-2 py-0.5 rounded border border-amber-800/50 font-medium">
                Серия #{currentEpisode?.number || 1}
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">
              DAW-мультитрек: нарезка тишины на аудио-клипы, реальные вейвформы, вшитие фиксов и автотайминг по субтитрам
            </p>
          </div>
        </div>

        {/* Action Buttons Bar matching user's exact pipeline */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsSettingsModalOpen(true)}
            className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-amber-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 border border-amber-600/40 shadow-sm transition"
            title="Настройки параметров удаления тишины, авто-калибровки, вшития фиксов и автотайминга"
          >
            <Settings className="w-4 h-4 text-amber-400" />
            <span>Параметры</span>
          </button>

          <button
            onClick={handleImportFromQA}
            disabled={isLoading}
            className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-xl text-xs font-semibold flex items-center gap-2 border border-neutral-700 transition disabled:opacity-60"
            title="1. Импорт дорожек: импорт и сборка дорожек дабберов из QA в тайминг"
          >
            {isImporting ? (
              <>
                <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
                <span>Импорт {importProgress > 0 ? `(${importProgress}%)` : '...'}</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4 text-blue-400" />
                <span>1. Импорт дорожек</span>
              </>
            )}
          </button>

          <button
            onClick={handleCutSilence}
            disabled={isLoading || tracks.length === 0}
            className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border transition ${
              isSilenceRemoved ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60 shadow-lg shadow-emerald-950/40' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-neutral-700'
            }`}
            title="3. Удалить тишину: нарезать вейвформу дорожек на отдельные речевые фразы по тишине"
          >
            <Scissors className="w-4 h-4 text-amber-400" />
            <span>3. Удалить тишину</span>
          </button>

          <button
            onClick={handleStitchFixes}
            disabled={isLoading || tracks.length === 0}
            className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border transition ${
              isFixesStitched ? 'bg-amber-950/60 text-amber-300 border-amber-800/60 shadow-lg shadow-amber-950/40' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-neutral-700'
            }`}
            title="4. Применить фиксы: вшить фрагменты фиксов или заменить полную дорожку"
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>4. Применить фиксы</span>
          </button>

          {/* Two-Stage Auto-Timing: 1. Анализ -> 2. Точечный автотайминг */}
          <div className="flex items-center gap-1.5 bg-neutral-900/95 p-1 rounded-xl border border-neutral-700/80 shadow-md">
            <button
              onClick={handleAnalyzeTiming}
              disabled={isLoading || tracks.length === 0}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                isTimingAnalyzed
                  ? 'bg-indigo-950/90 text-indigo-200 border border-indigo-700/70 shadow-inner'
                  : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200'
              }`}
              title="Этап 1: Анализ проблем — находит наезды (не указанные в сабах), рассинхроны (раньше/позже сабов) и пропуски. Подключает Whisper для висящих в воздухе фраз."
            >
              {isLoading && statusMessage.includes('Этап 1') ? (
                <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5 text-indigo-400" />
              )}
              <span>1. Анализ проблем (Whisper)</span>
              {timingIssues.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  {timingIssues.length}
                </span>
              )}
            </button>

            <button
              onClick={() => handleApplyTargetedAutoTiming('all')}
              disabled={isLoading || tracks.length === 0 || timingIssues.filter(i => i.type !== 'missing').length === 0}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow transition ${
                timingIssues.filter(i => i.type !== 'missing').length > 0
                  ? 'bg-gradient-to-r from-amber-600 to-indigo-600 hover:from-amber-500 hover:to-indigo-500 text-white shadow-amber-600/25 ring-1 ring-amber-400/30'
                  : 'bg-neutral-800/60 text-neutral-500 cursor-not-allowed'
              }`}
              title="Этап 2: Точечный хирургический автотайминг — точечно раздвигает только наезды ровно до прекращения пересечения, пододвигает не попадающие фразы под субтитры, не затрагивая остальные дорожки"
            >
              {isLoading && statusMessage.includes('Этап 2') ? (
                <Loader2 className="w-3.5 h-3.5 text-amber-300 animate-spin" />
              ) : (
                <Zap className="w-3.5 h-3.5 text-amber-300" />
              )}
              <span>2. Точечный автотайминг</span>
            </button>
          </div>

          {/* QA Passport Sync Button */}
          <button
            onClick={handleSyncFromQA}
            disabled={isLoading || tracks.length === 0}
            className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition ${
              qaPassportLoaded
                ? 'bg-amber-950/70 text-amber-300 border-amber-600/60 shadow-sm'
                : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border-neutral-700'
            }`}
            title="Синхронизировать данные тайминга с результатами QA проверки косяков серии"
          >
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>Паспорт QA</span>
            {qaPassportLoaded && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                {qaPassportLoaded.summary.totalGaps}
              </span>
            )}
          </button>

          {timingIssues.length > 0 && (
            <button
              onClick={() => setIsIssuesDrawerOpen(!isIssuesDrawerOpen)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border transition ${
                isIssuesDrawerOpen ? 'bg-amber-950/90 text-amber-300 border-amber-600 shadow-lg shadow-amber-950/50' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-neutral-700'
              }`}
              title="Панель найденных проблем тайминга"
            >
              <AlertTriangle className="w-4 h-4 text-amber-400 animate-pulse" />
              <span>Проблемы ({timingIssues.length})</span>
            </button>
          )}

          <button
            onClick={() => setIsLogDrawerOpen(!isLogDrawerOpen)}
            className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border transition ${
              isLogDrawerOpen ? 'bg-amber-950/80 text-amber-300 border-amber-800' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-neutral-700'
            }`}
          >
            <Activity className="w-4 h-4 text-amber-400" />
            <span>Журнал ({operationLogs.length})</span>
          </button>

          <button
            onClick={() => setIsExportModalOpen(true)}
            disabled={isLoading || tracks.length === 0}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition"
          >
            <FolderOpen className="w-4 h-4 text-emerald-100" />
            <span>Экспорт звукорежиссёру</span>
          </button>

          <button
            onClick={handleExportToMixing}
            disabled={exportingToMixing || tracks.length === 0}
            className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-purple-600/25 transition"
          >
            {exportingToMixing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            <span>В Сведение</span>
          </button>
        </div>
      </header>

      {/* Unified QA Passport Sync Notification Banner */}
      {qaPassportLoaded && (
        <div className="bg-gradient-to-r from-amber-950/80 via-indigo-950/70 to-neutral-900 border-b border-amber-500/40 px-4 py-2 flex items-center justify-between text-xs text-amber-200 shrink-0 shadow-lg">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
            <div>
              <span className="font-bold text-white">Паспорт QA проверки подхвачен:</span>{' '}
              <span>
                Всего замечаний: <strong className="text-white">{qaPassportLoaded.summary.totalGaps}</strong>{' '}
                (Наездов: <strong>{qaPassportLoaded.summary.overlapsCount}</strong>, Коллизий: <strong>{qaPassportLoaded.summary.collisionsCount}</strong>, Рассинхронов: <strong>{qaPassportLoaded.summary.desyncCount}</strong>, Пропусков: <strong>{qaPassportLoaded.summary.missingCount}</strong>).
              </span>{' '}
              <span className="text-amber-400 font-medium hidden md:inline">
                Повторная перепроверка не требуется — данные сразу готовы к точечной правке на таймлайне!
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setIsIssuesDrawerOpen(true)}
              className="px-2.5 py-1 bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 border border-amber-500/40 rounded-lg text-[11px] font-bold transition flex items-center gap-1 shadow-sm"
            >
              <AlertTriangle className="w-3 h-3 text-amber-400" />
              <span>Показать замечания ({timingIssues.length})</span>
            </button>
            <button
              onClick={handleSyncFromQA}
              className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-[11px] font-medium transition flex items-center gap-1"
              title="Повторно синхронизировать данные с QA проверкой"
            >
              <RefreshCw className="w-3 h-3 text-neutral-400" />
              <span>Обновить из QA</span>
            </button>
          </div>
        </div>
      )}

      {/* Two-Stage Auto-Timing Diagnostic & Targeted Fixes Panel */}
      {isIssuesDrawerOpen && timingIssues.length > 0 && (
        <div className="bg-[#0b0e18] border-b border-indigo-900/60 px-4 py-2.5 shrink-0 shadow-2xl flex flex-col gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="font-bold text-xs text-neutral-100 flex items-center gap-1.5">
                <Search className="w-4 h-4 text-amber-400" />
                Диагностика таймингов: найдено проблем ({timingIssues.length})
              </span>

              {/* Filter tabs */}
              <div className="flex items-center gap-1 bg-neutral-900/90 p-0.5 rounded-lg border border-neutral-800 text-[10px]">
                <button
                  onClick={() => setActiveIssueFilter('all')}
                  className={`px-2 py-0.5 rounded ${activeIssueFilter === 'all' ? 'bg-indigo-600 text-white font-bold' : 'text-neutral-400 hover:text-neutral-200'}`}
                >
                  Все ({timingIssues.length})
                </button>
                <button
                  onClick={() => setActiveIssueFilter('overlap')}
                  className={`px-2 py-0.5 rounded ${activeIssueFilter === 'overlap' ? 'bg-red-600 text-white font-bold' : 'text-neutral-400 hover:text-neutral-200'}`}
                >
                  💥 Наезды ({timingIssues.filter(i => i.type === 'overlap').length})
                </button>
                <button
                  onClick={() => setActiveIssueFilter('desync')}
                  className={`px-2 py-0.5 rounded ${activeIssueFilter === 'desync' ? 'bg-amber-600 text-white font-bold' : 'text-neutral-400 hover:text-neutral-200'}`}
                >
                  ⏳ Рассинхрон ({timingIssues.filter(i => i.type === 'desync').length})
                </button>
                <button
                  onClick={() => setActiveIssueFilter('missing')}
                  className={`px-2 py-0.5 rounded ${activeIssueFilter === 'missing' ? 'bg-amber-700 text-white font-bold' : 'text-neutral-400 hover:text-neutral-200'}`}
                >
                  ⚠️ Пропуски ({timingIssues.filter(i => i.type === 'missing').length})
                </button>
                <button
                  onClick={() => setActiveIssueFilter('orphan')}
                  className={`px-2 py-0.5 rounded ${activeIssueFilter === 'orphan' ? 'bg-cyan-700 text-white font-bold' : 'text-neutral-400 hover:text-neutral-200'}`}
                >
                  🎙️ Вне сабов ({timingIssues.filter(i => i.type === 'orphan').length})
                </button>
              </div>
            </div>

            {/* Quick Bulk Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleApplyTargetedAutoTiming('all')}
                disabled={timingIssues.filter(i => i.type !== 'missing').length === 0}
                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-[11px] font-bold rounded-lg flex items-center gap-1 shadow transition"
                title="Точечно раздвинуть все наезды и выровнять все рассинхроны под субтитры"
              >
                <Zap className="w-3 h-3" />
                <span>Исправить все точечно</span>
              </button>
              <button
                onClick={() => handleApplyTargetedAutoTiming('overlap')}
                disabled={timingIssues.filter(i => i.type === 'overlap').length === 0}
                className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] font-semibold rounded-lg flex items-center gap-1 border border-neutral-700 transition"
              >
                <MoveHorizontal className="w-3 h-3 text-red-400" />
                <span>Только наезды</span>
              </button>
              <button
                onClick={() => handleApplyTargetedAutoTiming('desync')}
                disabled={timingIssues.filter(i => i.type === 'desync').length === 0}
                className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] font-semibold rounded-lg flex items-center gap-1 border border-neutral-700 transition"
              >
                <Crosshair className="w-3 h-3 text-amber-400" />
                <span>Только рассинхрон</span>
              </button>
              <button
                onClick={() => setIsIssuesDrawerOpen(false)}
                className="p-1 text-neutral-400 hover:text-neutral-200 rounded"
                title="Скрыть панель"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Issue Cards Carousel */}
          <div className="flex items-center gap-2 overflow-x-auto py-1 max-h-36 scrollbar-thin">
            {timingIssues
              .filter(i => activeIssueFilter === 'all' || i.type === activeIssueFilter)
              .map(issue => (
                <div
                  key={issue.id}
                  onClick={() => jumpToTime(issue.timeSec)}
                  className={`shrink-0 w-80 p-2 rounded-xl border text-xs flex flex-col justify-between cursor-pointer transition select-none ${
                    issue.type === 'overlap'
                      ? 'bg-red-950/40 border-red-800/60 hover:border-red-500'
                      : issue.type === 'desync'
                      ? 'bg-amber-950/40 border-amber-800/60 hover:border-amber-500'
                      : issue.type === 'missing'
                      ? 'bg-neutral-900 border-amber-600/60 hover:border-amber-400'
                      : 'bg-cyan-950/40 border-cyan-800/60 hover:border-cyan-500'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] mb-1">
                    <span className="font-bold flex items-center gap-1 truncate">
                      {issue.type === 'overlap' && <span className="bg-red-600 text-white px-1 py-0.2 rounded font-black text-[8px]">НАЕЗД</span>}
                      {issue.type === 'desync' && <span className="bg-amber-600 text-neutral-950 px-1 py-0.2 rounded font-black text-[8px]">РАССИНХРОН</span>}
                      {issue.type === 'missing' && <span className="bg-amber-500 text-neutral-950 px-1 py-0.2 rounded font-black text-[8px]">ПРОПУСК</span>}
                      {issue.type === 'orphan' && <span className="bg-cyan-600 text-white px-1 py-0.2 rounded font-black text-[8px]">ВНЕ САБОВ</span>}
                      <span className="text-neutral-200 truncate">{issue.dubberName} ({issue.characterName})</span>
                    </span>
                    <span className="font-mono text-neutral-400 shrink-0">
                      ⏱ {formatSeconds(issue.timeSec)}
                    </span>
                  </div>

                  <p className="text-[11px] text-neutral-300 line-clamp-2 leading-tight mb-1.5" title={issue.description}>
                    {issue.description}
                  </p>

                  <div className="flex items-center justify-between pt-1 border-t border-neutral-800/60">
                    <button
                      onClick={(e) => { e.stopPropagation(); jumpToTime(issue.timeSec); }}
                      className="text-[10px] text-indigo-400 hover:text-indigo-200 flex items-center gap-0.5"
                    >
                      <Crosshair className="w-2.5 h-2.5" />
                      <span>Показать</span>
                    </button>

                    {issue.type === 'desync' && issue.clipId && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleFixSingleClip(issue.trackId, issue.clipId!); }}
                        className="px-2 py-0.5 bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold rounded flex items-center gap-1 shadow"
                        title="Поставить фразу точно под субтитр"
                      >
                        <Crosshair className="w-2.5 h-2.5" />
                        <span>К субтитру</span>
                      </button>
                    )}

                    {issue.type === 'orphan' && issue.clipId && issue.subStartSec !== undefined && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleFixSingleClip(issue.trackId, issue.clipId!); }}
                        className="px-2 py-0.5 bg-cyan-600 hover:bg-cyan-500 text-white text-[10px] font-bold rounded flex items-center gap-1 shadow"
                        title="Поставить фразу к найденному Whisper субтитру"
                      >
                        <Crosshair className="w-2.5 h-2.5" />
                        <span>К субтитру</span>
                      </button>
                    )}

                    {issue.type === 'overlap' && issue.clipId && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleResolveSingleOverlap(issue.trackId, issue.clipId!); }}
                        className="px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold rounded flex items-center gap-1 shadow"
                      >
                        <MoveHorizontal className="w-2.5 h-2.5" />
                        <span>Раздвинуть</span>
                      </button>
                    )}

                    {issue.type === 'missing' && (
                      <div className="flex items-center gap-1">
                        {missingSubtitles.find(m => m.trackId === issue.trackId && Math.abs(m.startSec - issue.timeSec) < 0.2) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const marker = missingSubtitles.find(m => m.trackId === issue.trackId && Math.abs(m.startSec - issue.timeSec) < 0.2);
                              if (marker) handleTriggerUploadMissing(marker);
                            }}
                            className="px-2 py-0.5 bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold rounded flex items-center gap-1 shadow transition"
                            title="Загрузить аудиофайл реплики"
                          >
                            <Download className="w-2.5 h-2.5" />
                            <span>Загрузить</span>
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCopyMissingTimecode(issue.subText || '', issue.subStartSec || 0, issue.subEndSec || 0); }}
                          className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 text-[10px] font-semibold rounded flex items-center gap-1 border border-neutral-700"
                          title="Скопировать таймкод фразы"
                        >
                          <Copy className="w-2.5 h-2.5" />
                          <span>Таймкод</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Dynamic Calibration Info Banner */}
      {Object.keys(calibrationsByTrack).length > 0 && (
        <div className="bg-amber-950/30 border-b border-amber-900/40 px-4 py-1.5 flex items-center justify-between text-[11px] text-amber-200 shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto py-0.5">
            <span className="font-bold text-amber-400 flex items-center gap-1 shrink-0">
              <Sliders className="w-3.5 h-3.5" /> Авто-калибровка шума активна:
            </span>
            {Object.entries(calibrationsByTrack).map(([trId, calib]) => {
              const trk = tracks.find(t => t.id === trId);
              const name = trk?.participant || 'Трек';
              return (
                <span key={trId} className="bg-neutral-900/90 border border-amber-800/40 rounded px-2 py-0.5 font-mono text-[10px] text-neutral-300 shrink-0">
                  <strong className="text-amber-300">{name}</strong>: шум {calib.noiseFloorDb} dB | речь {calib.speechFloorDb} dB | порог {calib.calculatedThresholdDb} dB
                </span>
              );
            })}
          </div>
          <span className="text-[10px] text-neutral-400 shrink-0 ml-3 hidden md:inline">
            💡 Границы клипов можно свободно вытягивать из тишины мышкой за края
          </span>
        </div>
      )}

      {/* Import & Processing Progress Bar */}
      {isLoading && (
        <div className="bg-neutral-900/95 border-b border-indigo-500/40 px-4 py-2 flex flex-col gap-1.5 shadow-lg z-40 shrink-0 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />
              <span className="font-semibold text-neutral-200">
                {statusMessage || 'Импорт и обработка дорожек на таймлайн...'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-indigo-300 font-bold bg-indigo-950/80 px-2 py-0.5 rounded border border-indigo-700/50">
                {importProgress}%
              </span>
            </div>
          </div>
          <div className="w-full bg-neutral-950 rounded-full h-2 overflow-hidden border border-neutral-800">
            <div 
              className="bg-gradient-to-r from-blue-500 via-indigo-500 to-amber-400 h-full rounded-full transition-all duration-300 shadow-[0_0_12px_rgba(99,102,241,0.6)]"
              style={{ width: `${Math.max(4, Math.min(100, importProgress))}%` }}
            />
          </div>
        </div>
      )}

      {/* Track Navigation & View Modes Bar */}
      <div className="bg-[#0b0d14] border-b border-neutral-800 px-4 py-1.5 flex items-center justify-between gap-3 text-xs shrink-0 select-none">
        {/* Left: Tracks Count Badge & Quick Track Jump Buttons */}
        <div className="flex items-center gap-2 overflow-x-auto py-0.5 scrollbar-thin max-w-[70%]">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-300 font-semibold shrink-0">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <span>Дорожки: <strong className="text-white font-mono">{tracks.length}</strong></span>
          </div>

          {tracks.map((t) => {
            const clipsCount = (audioClips[t.id] || []).length;
            const isMuted = mutedTracks.has(t.id);
            return (
              <button
                key={t.id}
                onClick={() => {
                  const el = document.getElementById(`track-row-${t.id}`);
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
                className={`px-2.5 py-1 rounded-lg border text-[11px] flex items-center gap-1.5 shrink-0 transition ${
                  isMuted 
                    ? 'bg-red-950/40 border-red-900/60 text-red-300 hover:bg-red-900/50' 
                    : 'bg-neutral-900/90 hover:bg-neutral-800 border-neutral-800 hover:border-neutral-700 text-neutral-200'
                }`}
                title={`Перейти к дорожке: ${t.participant} (${clipsCount} фраз). Нажмите для прокрутки.`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${isMuted ? 'bg-red-500' : 'bg-emerald-500'}`} />
                <span className="font-bold truncate max-w-[130px]">{t.participant}</span>
                <span className="text-[10px] text-neutral-400 font-mono">({clipsCount})</span>
              </button>
            );
          })}
        </div>

        {/* Right: Height view toggle */}
        <div className="flex items-center gap-1 shrink-0 bg-neutral-900 border border-neutral-800 rounded-lg p-0.5">
          <button
            onClick={() => setTrackHeightMode('standard')}
            className={`px-2 py-1 rounded text-[11px] font-medium transition ${
              trackHeightMode === 'standard' ? 'bg-indigo-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
            }`}
            title="Стандартная высота: 112px для детального редактирования вейвформы"
          >
            Стандартный (112px)
          </button>
          <button
            onClick={() => setTrackHeightMode('compact')}
            className={`px-2 py-1 rounded text-[11px] font-medium transition ${
              trackHeightMode === 'compact' ? 'bg-indigo-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
            }`}
            title="Компактный вид: 64px — все 8 дорожек помещаются на экране"
          >
            Компактный (64px)
          </button>
          <button
            onClick={() => setTrackHeightMode('fit')}
            className={`px-2 py-1 rounded text-[11px] font-medium transition ${
              trackHeightMode === 'fit' ? 'bg-indigo-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
            }`}
            title="Уместить все дорожки на одном экране без скролла"
          >
            Уместить все ({tracks.length})
          </button>
        </div>
      </div>

    </>
  );
};
