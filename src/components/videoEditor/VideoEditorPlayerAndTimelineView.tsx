import React from 'react';
import {
  Scissors,
  Film,
  Image as ImageIcon,
  Play,
  Pause,
  Layers,
  FileVideo,
  SkipBack,
  SkipForward
} from 'lucide-react';
import { toast } from 'sonner';
import {
  InsertedImageItem,
  OverlayImageItem,
  formatTimeSec
} from './useVideoEditorController';

export interface VideoEditorPlayerAndTimelineViewProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoSrc: string;
  isPlaying: boolean;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  currentTime: number;
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>;
  sourceDuration: number;
  setSourceDuration: React.Dispatch<React.SetStateAction<number>>;
  trimEndSec: number;
  setTrimEndSec: React.Dispatch<React.SetStateAction<number>>;
  setTrimEndInput: React.Dispatch<React.SetStateAction<string>>;
  activeOverlaysAtCurrentTime: OverlayImageItem[];
  togglePlay: () => void;
  seekTo: (sec: number) => void;
  handleSetTrimStartFromPlayer: () => void;
  handleSetTrimEndFromPlayer: () => void;
  draftCutStart: number;
  setDraftCutStart: React.Dispatch<React.SetStateAction<number>>;
  draftCutEnd: number;
  setDraftCutEnd: React.Dispatch<React.SetStateAction<number>>;
  setActiveSection: React.Dispatch<React.SetStateAction<'trim-cut' | 'images' | 'videos' | 'subs'>>;
  handleAddCutSegment: (presetStart?: number, presetEnd?: number, presetLabel?: string) => void;
  plan: any;
  overlayImages: OverlayImageItem[];
  midImages: InsertedImageItem[];
}

export function VideoEditorPlayerAndTimelineView({
  videoRef,
  videoSrc,
  isPlaying,
  setIsPlaying,
  currentTime,
  setCurrentTime,
  sourceDuration,
  setSourceDuration,
  trimEndSec,
  setTrimEndSec,
  setTrimEndInput,
  activeOverlaysAtCurrentTime,
  togglePlay,
  seekTo,
  handleSetTrimStartFromPlayer,
  handleSetTrimEndFromPlayer,
  draftCutStart,
  setDraftCutStart,
  draftCutEnd,
  setDraftCutEnd,
  setActiveSection,
  handleAddCutSegment,
  plan,
  overlayImages,
  midImages
}: VideoEditorPlayerAndTimelineViewProps) {
  return (
    <div className="xl:col-span-7 space-y-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-3.5 shadow-lg">
        {/* Video Player Container with Live Overlay Preview */}
        <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-neutral-800">
          {videoSrc ? (
            <video
              ref={videoRef}
              src={videoSrc}
              className="w-full h-full object-contain"
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => {
                const dur = e.currentTarget.duration;
                if (dur && !isNaN(dur) && dur > 0) {
                  setSourceDuration(dur);
                  if (trimEndSec === 0 || trimEndSec > dur) {
                    setTrimEndSec(dur);
                    setTrimEndInput(formatTimeSec(dur));
                  }
                }
              }}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              controls
            />
          ) : (
            <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
              Загрузка видеоплеера...
            </div>
          )}

          {/* Live Overlay Images Preview on top of video */}
          {activeOverlaysAtCurrentTime.map((ov) => (
            <div
              key={ov.id}
              className="pointer-events-none absolute border border-indigo-400/60 shadow-lg"
              style={{
                left: `${ov.xPercent}%`,
                top: `${ov.yPercent}%`,
                width: `${ov.widthPercent}%`,
                transform: 'translate(-50%, -50%)',
                opacity: ov.opacity
              }}
            >
              {ov.previewUrl && (
                <img
                  src={ov.previewUrl}
                  alt={ov.name}
                  className="w-full h-auto object-contain block"
                />
              )}
              <span className="absolute -top-5 left-0 bg-indigo-600/90 text-white text-[10px] px-1.5 py-0.5 rounded font-mono whitespace-nowrap">
                Overlay: {ov.name}
              </span>
            </div>
          ))}
        </div>

        {/* Frame-Accurate Scrubber & Quick Time Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-neutral-950/80 p-2.5 rounded-xl border border-neutral-800/80">
          <div className="flex items-center gap-1.5">
            <button
              onClick={togglePlay}
              className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
              title="Воспроизвести / Пауза"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button
              onClick={() => seekTo(currentTime - 5)}
              className="px-2 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-mono"
            >
              -5с
            </button>
            <button
              onClick={() => seekTo(currentTime - 1)}
              className="px-2 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-mono"
            >
              -1с
            </button>
            <button
              onClick={() => seekTo(currentTime - 0.04)}
              className="px-2 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-mono"
              title="Шаг на 1 кадр назад"
            >
              -1к
            </button>
            <button
              onClick={() => seekTo(currentTime + 0.04)}
              className="px-2 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-mono"
              title="Шаг на 1 кадр вперед"
            >
              +1к
            </button>
            <button
              onClick={() => seekTo(currentTime + 1)}
              className="px-2 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-mono"
            >
              +1с
            </button>
            <button
              onClick={() => seekTo(currentTime + 5)}
              className="px-2 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-mono"
            >
              +5с
            </button>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="text-neutral-400">Позиция:</span>
            <span className="px-2.5 py-1 rounded bg-neutral-900 border border-neutral-700 text-indigo-300 font-bold">
              {formatTimeSec(currentTime)}
            </span>
            <span className="text-neutral-500">/</span>
            <span className="text-neutral-300">{formatTimeSec(sourceDuration)}</span>
          </div>
        </div>

        {/* Quick Action Bar from Current Playhead */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            onClick={handleSetTrimStartFromPlayer}
            className="px-3 py-2 rounded-xl bg-neutral-800/90 hover:bg-neutral-700 border border-neutral-700 text-xs text-neutral-200 font-medium flex items-center justify-center gap-1.5 transition-colors"
            title="Отрезать всё до текущей секунды плеера"
          >
            <SkipBack className="w-3.5 h-3.5 text-amber-400" />
            <span>Начало = {formatTimeSec(currentTime)}</span>
          </button>

          <button
            onClick={handleSetTrimEndFromPlayer}
            className="px-3 py-2 rounded-xl bg-neutral-800/90 hover:bg-neutral-700 border border-neutral-700 text-xs text-neutral-200 font-medium flex items-center justify-center gap-1.5 transition-colors"
            title="Отрезать всё после текущей секунды плеера"
          >
            <SkipForward className="w-3.5 h-3.5 text-amber-400" />
            <span>Конец = {formatTimeSec(currentTime)}</span>
          </button>

          <button
            onClick={() => {
              setDraftCutStart(Number(currentTime.toFixed(2)));
              if (draftCutEnd <= currentTime) {
                setDraftCutEnd(Number(Math.min(sourceDuration, currentTime + 10).toFixed(2)));
              }
              setActiveSection('trim-cut');
              toast.info(`Начало вырезки установлено: ${formatTimeSec(currentTime)}`);
            }}
            className="px-3 py-2 rounded-xl bg-neutral-800/90 hover:bg-neutral-700 border border-neutral-700 text-xs text-neutral-200 font-medium flex items-center justify-center gap-1.5 transition-colors"
          >
            <Scissors className="w-3.5 h-3.5 text-rose-400" />
            <span>Вырезать [Отсюда...</span>
          </button>

          <button
            onClick={() => {
              const endT = Number(currentTime.toFixed(2));
              setDraftCutEnd(endT);
              setActiveSection('trim-cut');
              if (endT > draftCutStart + 0.1) {
                handleAddCutSegment(draftCutStart, endT);
              } else {
                toast.info(`Конец вырезки установлен: ${formatTimeSec(endT)}`);
              }
            }}
            className="px-3 py-2 rounded-xl bg-neutral-800/90 hover:bg-neutral-700 border border-neutral-700 text-xs text-neutral-200 font-medium flex items-center justify-center gap-1.5 transition-colors"
          >
            <Scissors className="w-3.5 h-3.5 text-emerald-400" />
            <span>...До сюда] (+вырезка)</span>
          </button>
        </div>

        {/* Visual Timeline Map */}
        <div className="space-y-2 pt-2 border-t border-neutral-800">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-neutral-300 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-indigo-400" />
              Карта исходного видео и правок
            </span>
            {plan && (
              <span className="text-neutral-400 font-mono">
                Исходник: <strong className="text-neutral-200">{formatTimeSec(plan.sourceDurationSec)}</strong>
                {' ➔ '}
                Итог: <strong className="text-emerald-400">{formatTimeSec(plan.totalOutputDurationSec)}</strong>
                {' '}
                ({plan.totalOutputDurationSec - plan.sourceDurationSec >= 0 ? '+' : ''}
                {(plan.totalOutputDurationSec - plan.sourceDurationSec).toFixed(2)}с)
              </span>
            )}
          </div>

          {/* Source video bar with cuts, playhead, mid-inserts, and overlays */}
          <div
            className="relative h-8 bg-emerald-950/60 border border-neutral-700 rounded-lg overflow-hidden cursor-pointer select-none"
            onClick={(e) => {
              if (!sourceDuration) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              seekTo(ratio * sourceDuration);
            }}
            title="Нажмите для перехода к нужному моменту исходного видео"
          >
            {/* Merged cut regions (red) */}
            {plan?.mergedCuts?.map((c: any, idx: number) => {
              const leftPct = (c.start / (sourceDuration || 1)) * 100;
              const widthPct = ((c.end - c.start) / (sourceDuration || 1)) * 100;
              return (
                <div
                  key={idx}
                  className="absolute top-0 bottom-0 bg-rose-600/65 border-x border-rose-400/60 flex items-center justify-center text-[10px] text-white font-bold overflow-hidden"
                  style={{ left: `${leftPct}%`, width: `${Math.max(0.5, widthPct)}%` }}
                  title={`Вырезано: ${formatTimeSec(c.start)} — ${formatTimeSec(c.end)}`}
                >
                  {widthPct > 6 ? 'ВЫРЕЗАНО' : ''}
                </div>
              );
            })}

            {/* Overlay ranges (purple bar at top) */}
            {overlayImages
              .filter((o) => o.enabled)
              .map((ov) => {
                const leftPct = (ov.startSec / (sourceDuration || 1)) * 100;
                const widthPct = ((ov.endSec - ov.startSec) / (sourceDuration || 1)) * 100;
                return (
                  <div
                    key={ov.id}
                    className="absolute top-0 h-2.5 bg-purple-500/80 border border-purple-300 rounded-b"
                    style={{ left: `${leftPct}%`, width: `${Math.max(1, widthPct)}%` }}
                    title={`Картинка поверх видео: ${ov.name} (${formatTimeSec(ov.startSec)} - ${formatTimeSec(ov.endSec)})`}
                  />
                );
              })}

            {/* Mid-image insertion markers (cyan vertical pins) */}
            {midImages
              .filter((m) => m.enabled)
              .map((m) => {
                const leftPct = ((m.insertAtOriginalSec || 0) / (sourceDuration || 1)) * 100;
                return (
                  <div
                    key={m.id}
                    className="absolute top-0 bottom-0 w-1 bg-cyan-400 shadow-[0_0_8px_#22d3ee]"
                    style={{ left: `${leftPct}%` }}
                    title={`Вставка картинки "${m.name}" (${m.durationSec}с) на ${formatTimeSec(m.insertAtOriginalSec || 0)}`}
                  />
                );
              })}

            {/* Current Playhead */}
            {sourceDuration > 0 && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_6px_#fff] z-10"
                style={{ left: `${(currentTime / sourceDuration) * 100}%` }}
              />
            )}
          </div>

          {/* Final Assembled Blocks Preview */}
          {plan?.blocks && plan.blocks.length > 0 && (
            <div className="flex items-center gap-1 overflow-x-auto py-1 text-[11px]">
              {plan.blocks.map((b: any, i: number) => {
                const isSource = b.type === 'source-slice';
                const isImage = b.type === 'image-clip';
                return (
                  <div
                    key={b.id || i}
                    className={`px-2.5 py-1 rounded-md border shrink-0 flex items-center gap-1.5 ${
                      isSource
                        ? 'bg-emerald-950/50 border-emerald-600/40 text-emerald-200'
                        : isImage
                        ? 'bg-cyan-950/60 border-cyan-500/40 text-cyan-200'
                        : 'bg-amber-950/60 border-amber-500/40 text-amber-200'
                    }`}
                  >
                    {isSource ? (
                      <Film className="w-3 h-3 text-emerald-400" />
                    ) : isImage ? (
                      <ImageIcon className="w-3 h-3 text-cyan-400" />
                    ) : (
                      <FileVideo className="w-3 h-3 text-amber-400" />
                    )}
                    <span className="font-medium">
                      {isSource
                        ? `Серия [${formatTimeSec(b.origStart)}–${formatTimeSec(b.origEnd)}]`
                        : `${b.name} (${b.durationSec.toFixed(1)}с)`}
                    </span>
                    {b.overlays?.length > 0 && (
                      <span className="px-1 rounded bg-purple-500/30 text-purple-200 text-[10px]">
                        +{b.overlays.length} overlay
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
