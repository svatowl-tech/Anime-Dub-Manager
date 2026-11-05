import React from 'react';
import {
  Scissors,
  Film,
  RotateCcw,
  CheckCircle2,
  Sparkles,
  Terminal,
  ArrowRight,
  FileVideo,
  FileText,
  Loader2,
  ChevronRight,
  AlertCircle,
  Clock
} from 'lucide-react';
import { LogViewerDrawer } from './common/LogViewerDrawer';
import {
  useVideoEditorController,
  CutSegment,
  InsertedVideoItem,
  InsertedImageItem,
  OverlayImageItem,
  VideoEditorPanelProps,
  formatTimeSec,
  parseTimeInput
} from './videoEditor/useVideoEditorController';
import { VideoEditorPlayerAndTimelineView } from './videoEditor/VideoEditorPlayerAndTimelineView';
import { VideoEditorToolsAndSubsInspectorView } from './videoEditor/VideoEditorToolsAndSubsInspectorView';

export type {
  CutSegment,
  InsertedVideoItem,
  InsertedImageItem,
  OverlayImageItem,
  VideoEditorPanelProps
};
export { formatTimeSec, parseTimeInput };

export default function VideoEditorPanel({
  currentEpisode,
  onRefresh,
  onOpenAssUtilities
}: VideoEditorPanelProps) {
  const {
    videoRef,
    videoSrc,
    isPlaying,
    setIsPlaying,
    currentTime,
    setCurrentTime,
    sourceDuration,
    setSourceDuration,
    sourceMeta,
    activeSection,
    setActiveSection,
    trimStartSec,
    setTrimStartSec,
    trimEndSec,
    setTrimEndSec,
    trimStartInput,
    setTrimStartInput,
    trimEndInput,
    setTrimEndInput,
    cuts,
    setCuts,
    draftCutStart,
    setDraftCutStart,
    draftCutEnd,
    setDraftCutEnd,
    draftCutLabel,
    setDraftCutLabel,
    startImages,
    setStartImages,
    midImages,
    setMidImages,
    endImages,
    setEndImages,
    overlayImages,
    setOverlayImages,
    introVideos,
    setIntroVideos,
    outroVideos,
    setOutroVideos,
    previewData,
    isPreviewLoading,
    isRendering,
    renderProgress,
    isRestoring,
    lastRenderResult,
    isLogsDrawerOpen,
    setIsLogsDrawerOpen,
    showInlineConsole,
    setShowInlineConsole,
    moduleLogs,
    clearModuleLogs,
    errorCount,
    seekTo,
    togglePlay,
    handleSetTrimStartFromPlayer,
    handleSetTrimEndFromPlayer,
    handleResetTrim,
    handleAddCutSegment,
    handlePickInsertedImage,
    handlePickOverlayImage,
    handlePickExternalVideo,
    hasAnyEdits,
    handleRenderAndApply,
    handleRestoreOriginal,
    activeOverlaysAtCurrentTime
  } = useVideoEditorController({ currentEpisode, onRefresh, onOpenAssUtilities });

  if (!currentEpisode) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] text-center p-8 bg-neutral-900/40 border border-neutral-800 rounded-2xl">
        <Film className="w-14 h-14 text-neutral-600 mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">Серия не выбрана</h2>
        <p className="text-sm text-neutral-400 max-w-md">
          Выберите проект и серию в верхнем меню или загрузите видео и субтитры в Дашборде проекта, чтобы открыть редактор видео.
        </p>
      </div>
    );
  }

  if (!currentEpisode.rawPath) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] text-center p-8 bg-neutral-900/40 border border-neutral-800 rounded-2xl">
        <FileVideo className="w-14 h-14 text-amber-500/70 mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">Видеофайл еще не загружен в серию #{currentEpisode.number}</h2>
        <p className="text-sm text-neutral-400 max-w-md">
          Сначала загрузите исходное видео (и субтитры) на вкладке «Дашборд проекта», после чего вернитесь сюда для быстрой подрезки, вставок и пересчета тайминга субтитров.
        </p>
      </div>
    );
  }

  const plan = previewData?.plan;
  const subPreview = previewData?.subPreview;
  const canRestoreOriginal =
    Boolean(currentEpisode.originalRawPath) &&
    currentEpisode.originalRawPath !== currentEpisode.rawPath;

  return (
    <div className="space-y-5 pb-12">
      {/* Top Header Bar */}
      <div className="bg-neutral-900/90 border border-neutral-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-lg">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Scissors className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg font-bold text-white">
                Редактирование видео (FFmpeg Direct Stream Copy)
              </h1>
              <span className="text-xs px-2.5 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-medium">
                Серия #{currentEpisode.number}
              </span>
              {sourceMeta && (
                <span className="text-xs px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 font-mono">
                  {sourceMeta.width}×{sourceMeta.height} • {sourceMeta.videoCodec?.toUpperCase()} • {Number(sourceMeta.fps || 24).toFixed(2)} fps
                </span>
              )}
            </div>
            <p className="text-xs text-neutral-400 mt-0.5 flex items-center gap-3 flex-wrap">
              <span className="truncate max-w-[420px]" title={currentEpisode.rawPath}>
                Видео: <span className="text-neutral-300 font-mono">{currentEpisode.rawPath.split(/[\\/]/).pop()}</span>
              </span>
              <span>•</span>
              <span className="truncate max-w-[320px]" title={currentEpisode.subPath || 'Не прикреплены'}>
                Субтитры:{' '}
                {currentEpisode.subPath ? (
                  <span className="text-emerald-400 font-mono">{currentEpisode.subPath.split(/[\\/]/).pop()}</span>
                ) : (
                  <span className="text-amber-400">не прикреплены</span>
                )}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={() => setIsLogsDrawerOpen(true)}
            className="px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium flex items-center gap-2 border border-neutral-700 transition-colors"
            title="Открыть подробный журнал операций видеоредактора"
          >
            <Terminal className="w-4 h-4 text-indigo-400" />
            <span>Логи ({moduleLogs.length})</span>
            {errorCount > 0 && (
              <span className="px-1.5 py-0.2 bg-red-500/20 text-red-400 rounded text-[10px] font-bold">
                {errorCount}
              </span>
            )}
          </button>

          {canRestoreOriginal && (
            <button
              onClick={handleRestoreOriginal}
              disabled={isRendering || isRestoring}
              className="px-3.5 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-50"
              title="Вернуть нетронутое исходное видео и оригинальные субтитры до редактирования"
            >
              {isRestoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              <span>Вернуть исходник</span>
            </button>
          )}

          {lastRenderResult && onOpenAssUtilities && (
            <button
              onClick={onOpenAssUtilities}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg transition-all"
            >
              <FileText className="w-4 h-4" />
              <span>Перейти в Утилиты (ASS)</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={handleRenderAndApply}
            disabled={isRendering || !hasAnyEdits}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-indigo-600/20 transition-all"
          >
            {isRendering ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Рендеринг ({renderProgress}%)...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Отрендерить и перезагрузить в серию</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Rendering Progress Banner */}
      {isRendering && (
        <div className="bg-indigo-950/40 border border-indigo-500/40 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-indigo-200">
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              Выполняется обработка FFmpeg и пересчет таймингов ASS субтитров...
            </span>
            <span className="font-mono text-indigo-300">{renderProgress}%</span>
          </div>
          <div className="w-full h-2 bg-neutral-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 transition-all duration-200"
              style={{ width: `${Math.max(3, renderProgress)}%` }}
            />
          </div>
        </div>
      )}

      {/* Last Render Summary Banner */}
      {lastRenderResult && !isRendering && (
        <div className="bg-emerald-950/30 border border-emerald-500/40 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
            <div className="text-xs space-y-0.5">
              <div className="font-bold text-emerald-200">
                Видео и субтитры успешно сохранены в папку проекта и перезагружены в серию!
              </div>
              <div className="text-neutral-300">
                Новая длительность: <span className="font-mono font-semibold text-white">{formatTimeSec(lastRenderResult.outputDurationSec)}</span>
                {lastRenderResult.subtitleStats?.hasSubtitles && (
                  <>
                    {' • '}Субтитры: сдвинуто <span className="text-emerald-300 font-bold">{lastRenderResult.subtitleStats.shiftedLines}</span>,
                    подрезано <span className="text-amber-300 font-bold">{lastRenderResult.subtitleStats.trimmedLines}</span>,
                    удалено (в вырезках) <span className="text-rose-300 font-bold">{lastRenderResult.subtitleStats.removedLines}</span> из {lastRenderResult.subtitleStats.totalLines} реплик.
                  </>
                )}
              </div>
            </div>
          </div>
          {onOpenAssUtilities && (
            <button
              onClick={onOpenAssUtilities}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5"
            >
              <span>Открыть Утилиты (ASS)</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Main 2-Column Workspace: Left = Video Player & Visual Timeline, Right = Editing Tools */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <VideoEditorPlayerAndTimelineView
          videoRef={videoRef}
          videoSrc={videoSrc}
          isPlaying={isPlaying}
          setIsPlaying={setIsPlaying}
          currentTime={currentTime}
          setCurrentTime={setCurrentTime}
          sourceDuration={sourceDuration}
          setSourceDuration={setSourceDuration}
          trimEndSec={trimEndSec}
          setTrimEndSec={setTrimEndSec}
          setTrimEndInput={setTrimEndInput}
          activeOverlaysAtCurrentTime={activeOverlaysAtCurrentTime}
          togglePlay={togglePlay}
          seekTo={seekTo}
          handleSetTrimStartFromPlayer={handleSetTrimStartFromPlayer}
          handleSetTrimEndFromPlayer={handleSetTrimEndFromPlayer}
          draftCutStart={draftCutStart}
          setDraftCutStart={setDraftCutStart}
          draftCutEnd={draftCutEnd}
          setDraftCutEnd={setDraftCutEnd}
          setActiveSection={setActiveSection}
          handleAddCutSegment={handleAddCutSegment}
          plan={plan}
          overlayImages={overlayImages}
          midImages={midImages}
        />

        <VideoEditorToolsAndSubsInspectorView
          currentEpisode={currentEpisode}
          activeSection={activeSection}
          setActiveSection={setActiveSection}
          trimStartSec={trimStartSec}
          setTrimStartSec={setTrimStartSec}
          trimEndSec={trimEndSec}
          setTrimEndSec={setTrimEndSec}
          trimStartInput={trimStartInput}
          setTrimStartInput={setTrimStartInput}
          trimEndInput={trimEndInput}
          setTrimEndInput={setTrimEndInput}
          sourceDuration={sourceDuration}
          currentTime={currentTime}
          cuts={cuts}
          setCuts={setCuts}
          draftCutStart={draftCutStart}
          setDraftCutStart={setDraftCutStart}
          draftCutEnd={draftCutEnd}
          setDraftCutEnd={setDraftCutEnd}
          draftCutLabel={draftCutLabel}
          setDraftCutLabel={setDraftCutLabel}
          startImages={startImages}
          setStartImages={setStartImages}
          midImages={midImages}
          setMidImages={setMidImages}
          endImages={endImages}
          setEndImages={setEndImages}
          overlayImages={overlayImages}
          setOverlayImages={setOverlayImages}
          introVideos={introVideos}
          setIntroVideos={setIntroVideos}
          outroVideos={outroVideos}
          setOutroVideos={setOutroVideos}
          subPreview={subPreview}
          isPreviewLoading={isPreviewLoading}
          seekTo={seekTo}
          handleSetTrimStartFromPlayer={handleSetTrimStartFromPlayer}
          handleSetTrimEndFromPlayer={handleSetTrimEndFromPlayer}
          handleResetTrim={handleResetTrim}
          handleAddCutSegment={handleAddCutSegment}
          handlePickInsertedImage={handlePickInsertedImage}
          handlePickOverlayImage={handlePickOverlayImage}
          handlePickExternalVideo={handlePickExternalVideo}
        >
          {/* SECTION 4: SUBTITLE RECALCULATION PREVIEW */}
          {activeSection === 'subs' && (
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-4 shadow-lg">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-emerald-400" />
                  Авто-пересчет тайминга субтитров (ASS / SRT)
                </h3>
                {isPreviewLoading && <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />}
              </div>

              {!currentEpisode.subPath ? (
                <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs text-amber-200 flex items-center gap-2.5">
                  <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
                  <span>
                    К этой серии еще не прикреплен файл субтитров. Загрузите ASS/SRT в Дашборде проекта, чтобы редактор автоматически пересчитал все тайминги под новое видео.
                  </span>
                </div>
              ) : subPreview ? (
                <>
                  {/* Stats Grid */}
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div className="p-2.5 rounded-xl bg-neutral-950 border border-neutral-800">
                      <div className="text-[10px] text-neutral-400 uppercase">Всего строк</div>
                      <div className="text-sm font-bold text-white font-mono mt-0.5">{subPreview.totalLines}</div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-neutral-950 border border-emerald-500/30">
                      <div className="text-[10px] text-emerald-400 uppercase">Сдвинуто</div>
                      <div className="text-sm font-bold text-emerald-300 font-mono mt-0.5">{subPreview.shiftedLines}</div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-neutral-950 border border-amber-500/30">
                      <div className="text-[10px] text-amber-400 uppercase">Подрезано</div>
                      <div className="text-sm font-bold text-amber-300 font-mono mt-0.5">{subPreview.trimmedLines}</div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-neutral-950 border border-rose-500/30">
                      <div className="text-[10px] text-rose-400 uppercase">В вырезке</div>
                      <div className="text-sm font-bold text-rose-300 font-mono mt-0.5">{subPreview.removedLines}</div>
                    </div>
                  </div>

                  {/* Preview Table */}
                  <div className="max-h-[320px] overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950 divide-y divide-neutral-800/70">
                    {(subPreview.sampleChanges || []).map((row: any, idx: number) => (
                      <div key={idx} className="p-2.5 text-xs space-y-1 hover:bg-neutral-900/60">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-indigo-300 truncate">
                            #{row.lineNumber} • {row.actor}
                          </span>
                          {row.status === 'removed' ? (
                            <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono text-[10px] font-bold">
                              УДАЛЕНА (В ВЫРЕЗКЕ)
                            </span>
                          ) : (
                            <span
                              className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                                row.deltaSec === 0
                                  ? 'bg-neutral-800 text-neutral-400'
                                  : row.deltaSec > 0
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'bg-amber-500/20 text-amber-300'
                              }`}
                            >
                              {row.oldStart} ➔ {row.newStart} ({row.deltaSec >= 0 ? `+${row.deltaSec}с` : `${row.deltaSec}с`})
                            </span>
                          )}
                        </div>
                        <div className="text-neutral-400 truncate">{row.text}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          )}
        </VideoEditorToolsAndSubsInspectorView>
      </div>

      {/* Bottom Live Process Log Console */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-lg">
        <div
          onClick={() => setShowInlineConsole((v) => !v)}
          className="px-4 py-2.5 bg-neutral-950 border-b border-neutral-800 flex items-center justify-between cursor-pointer select-none"
        >
          <div className="flex items-center gap-2 text-xs font-bold text-neutral-300">
            <Terminal className="w-4 h-4 text-indigo-400" />
            <span>Журнал процессов видеоредактора и пересчета ASS (Real-Time Debug Log)</span>
            <span className="text-[11px] px-2 py-0.2 rounded bg-neutral-800 text-neutral-400 font-mono">
              {moduleLogs.length} записей
            </span>
          </div>
          <div className="flex items-center gap-2">
            {moduleLogs.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearModuleLogs();
                }}
                className="text-[11px] text-neutral-400 hover:text-white px-2 py-0.5 rounded bg-neutral-800"
              >
                Очистить
              </button>
            )}
            <span className="text-xs text-neutral-500">{showInlineConsole ? 'Свернуть ▲' : 'Развернуть ▼'}</span>
          </div>
        </div>

        {showInlineConsole && (
          <div className="max-h-52 overflow-y-auto p-3 bg-neutral-950/90 font-mono text-[11px] space-y-1">
            {moduleLogs.length === 0 ? (
              <div className="text-neutral-500 italic py-2">
                Журнал готов. Все операции подрезки, склейки FFmpeg и пересчета таймингов ASS логируются здесь в реальном времени.
              </div>
            ) : (
              moduleLogs.slice(-80).map((entry) => (
                <div
                  key={entry.id}
                  className={`flex items-start gap-2 leading-relaxed ${
                    entry.level === 'error'
                      ? 'text-rose-400'
                      : entry.level === 'warn'
                      ? 'text-amber-300'
                      : 'text-neutral-300'
                  }`}
                >
                  <span className="text-neutral-500 shrink-0">[{entry.time}]</span>
                  <span className="break-all">{entry.message}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Full Log Viewer Drawer */}
      <LogViewerDrawer
        isOpen={isLogsDrawerOpen}
        onToggle={() => setIsLogsDrawerOpen((prev) => !prev)}
        title="Логи Редактирования Видео и Пересчета ASS"
        scope="VIDEO-EDITOR"
        logs={moduleLogs}
        onClear={clearModuleLogs}
      />
    </div>
  );
}
