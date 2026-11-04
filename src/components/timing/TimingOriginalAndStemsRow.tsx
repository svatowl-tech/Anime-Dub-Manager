import React from 'react';
import {
  Radio,
  Scissors,
  Video,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { formatSeconds } from './timing.utils';
import { OriginalPeaksWaveform } from './OriginalPeaksWaveform';
import { OriginalStemsState } from './timing.types';

export interface TimingTimeRulerHeaderProps {
  isAutoNormalize: boolean;
  duration: number;
  zoomLevel: number;
  currentTime: number;
  timeRulerTicks: number[];
  timeRulerContainerRef: React.RefObject<HTMLDivElement | null>;
  onTimeRulerClick: (e: React.MouseEvent<HTMLDivElement>) => void;
}

export const TimingTimeRulerHeader: React.FC<TimingTimeRulerHeaderProps> = ({
  isAutoNormalize,
  duration,
  zoomLevel,
  currentTime,
  timeRulerTicks,
  timeRulerContainerRef,
  onTimeRulerClick,
}) => {
  return (
    <div className="h-9 bg-neutral-900 border-b border-neutral-800 flex shrink-0 z-30">
      <div className="w-64 border-r border-neutral-800 px-3 flex items-center justify-between text-[11px] font-bold text-neutral-400 uppercase tracking-wider shrink-0 bg-neutral-900">
        <span>Дорожки (Клипы)</span>
        {isAutoNormalize && (
          <span className="text-[9px] font-mono tabular-nums text-emerald-400 bg-emerald-950/70 border border-emerald-800/50 px-1.5 py-0.5 rounded normal-case">
            Норм. -18dB
          </span>
        )}
      </div>
      <div
        ref={timeRulerContainerRef}
        onClick={onTimeRulerClick}
        className="flex-1 overflow-hidden relative font-mono tabular-nums text-[10px] text-neutral-400 bg-neutral-900/90 cursor-pointer"
      >
        <div
          className="relative h-full"
          style={{ width: `${Math.max(800, duration * zoomLevel)}px` }}
        >
          {timeRulerTicks.map(sec => (
            <div
              key={sec}
              className="absolute border-l border-neutral-800 pl-1 py-1 h-full flex items-center"
              style={{ left: `${sec * zoomLevel}px` }}
            >
              {formatSeconds(sec)}
            </div>
          ))}
          {/* Playhead Cursor Marker on Time Ruler */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-40 pointer-events-none shadow-[0_0_8px_rgba(251,191,36,0.8)]"
            style={{ left: `${currentTime * zoomLevel}px` }}
          />
        </div>
      </div>
    </div>
  );
};

export interface TimingOriginalAndStemsRowProps {
  originalStems: OriginalStemsState;
  originalTrackHeight: number;
  originalPeaks: number[];
  originalVolume: number;
  isOriginalMuted: boolean;
  originalWaveScale: number;
  isOriginalWaveNormalized: boolean;
  isVideoOpen: boolean;
  videoUrl: string | null;
  duration: number;
  zoomLevel: number;
  currentTime: number;
  setOriginalStems: React.Dispatch<React.SetStateAction<OriginalStemsState>>;
  setIsStemsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsVideoOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsOriginalMuted: React.Dispatch<React.SetStateAction<boolean>>;
  setOriginalVolume: React.Dispatch<React.SetStateAction<number>>;
  setResizingOrigTrack: React.Dispatch<React.SetStateAction<{
    startMouseY: number;
    initialHeight: number;
  } | null>>;
  handleTimelineClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleToggleOriginalWaveNorm: () => void;
  handleChangeOriginalTrackHeight: (nextHeight: number) => void;
  handleChangeOriginalWaveScale: (nextVal: number) => void;
}

export const TimingOriginalAndStemsRow: React.FC<TimingOriginalAndStemsRowProps> = ({
  originalStems,
  originalTrackHeight,
  originalPeaks,
  originalVolume,
  isOriginalMuted,
  originalWaveScale,
  isOriginalWaveNormalized,
  isVideoOpen,
  videoUrl,
  duration,
  zoomLevel,
  currentTime,
  setOriginalStems,
  setIsStemsModalOpen,
  setIsVideoOpen,
  setIsOriginalMuted,
  setOriginalVolume,
  setResizingOrigTrack,
  handleTimelineClick,
  handleToggleOriginalWaveNorm,
  handleChangeOriginalTrackHeight,
  handleChangeOriginalWaveScale,
}) => {
  if (originalStems.hasStems) {
    return (
      <>
        {/* Stem 1: Original Vocals (Clean Speech) */}
        <div
          className="flex border-b border-sky-900/60 bg-[#07131e]/80 shrink-0 relative"
          style={{ height: `${originalStems.vocalsTrackHeight || 88}px` }}
        >
          {/* Sticky Header */}
          <div className="w-64 sticky left-0 z-20 shrink-0 bg-[#07131e] border-r border-sky-800/60 px-2.5 py-1.5 flex flex-col justify-between select-none">
            <div className="flex items-center justify-between gap-1">
              <span className="text-xs font-bold text-sky-400 flex items-center gap-1.5 truncate">
                <Scissors className="w-3.5 h-3.5 shrink-0 text-sky-300" />
                <span className="truncate">Оригинал: Голоса</span>
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setIsStemsModalOpen(true)}
                  className="px-1.5 py-0.5 rounded bg-sky-950 hover:bg-sky-900 text-sky-300 border border-sky-700/60 text-[9px] font-mono transition"
                  title="Настройки разделения стемов нейросетью"
                >
                  AI
                </button>
                <button
                  onClick={() => {
                    const curH = originalStems.vocalsTrackHeight || 88;
                    const nextH = curH < 88 ? 96 : curH < 130 ? 144 : 68;
                    setOriginalStems(prev => ({ ...prev, vocalsTrackHeight: nextH }));
                  }}
                  className="px-1.5 py-0.5 rounded bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 text-[9px] font-mono tabular-nums transition"
                  title="Высота дорожки голосов оригинала"
                >
                  {originalStems.vocalsTrackHeight || 88}px
                </button>
                <button
                  onClick={() => setOriginalStems(prev => ({ ...prev, vocalsSolo: !prev.vocalsSolo, instrumentalSolo: false }))}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition border ${
                    originalStems.vocalsSolo
                      ? 'bg-amber-500 text-black border-amber-400 shadow-sm'
                      : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-white'
                  }`}
                  title="Соло дорожки голосов оригинала"
                >
                  S
                </button>
                <button
                  onClick={() => setOriginalStems(prev => ({ ...prev, vocalsMuted: !prev.vocalsMuted }))}
                  className={`p-1 rounded text-xs transition ${
                    originalStems.vocalsMuted ? 'bg-red-500/20 text-red-400' : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                  title={originalStems.vocalsMuted ? 'Включить голоса оригинала' : 'Заглушить голоса оригинала'}
                >
                  {originalStems.vocalsMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => setOriginalStems(prev => ({ ...prev, hasStems: false }))}
                  className="p-1 rounded text-[10px] text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition"
                  title="Вернуться к одной общей дорожке видео"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Playback Volume Control */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-sky-300/80 w-10 shrink-0">Голос:</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={originalStems.vocalsMuted ? 0 : originalStems.vocalsVolume}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setOriginalStems(prev => ({
                    ...prev,
                    vocalsVolume: val,
                    vocalsMuted: val > 0 && prev.vocalsMuted ? false : prev.vocalsMuted
                  }));
                }}
                className="w-full accent-sky-400 h-1 bg-neutral-800 rounded cursor-pointer"
              />
              <span className="text-[10px] font-mono tabular-nums text-sky-300 w-9 text-right shrink-0">
                {originalStems.vocalsMuted ? 'MUTE' : `${Math.round(originalStems.vocalsVolume * 100)}%`}
              </span>
            </div>

            {/* Visual Waveform Amplitude Scale Control */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-sky-400/90 w-10 shrink-0" title="Масштаб отображения высоты пиков вейвформы голосов">
                Волна:
              </span>
              <button
                onClick={() => setOriginalStems(prev => ({ ...prev, vocalsWaveScale: Math.max(0.5, prev.vocalsWaveScale - 0.25) }))}
                className="w-4 h-4 rounded bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 flex items-center justify-center text-[10px] font-bold shrink-0"
                title="Уменьшить масштаб волны"
              >
                −
              </button>
              <input
                type="range"
                min="0.5"
                max="8"
                step="0.25"
                value={originalStems.vocalsWaveScale}
                onChange={(e) => setOriginalStems(prev => ({ ...prev, vocalsWaveScale: Number(e.target.value) }))}
                className="w-full accent-sky-400 h-1 bg-neutral-800 rounded cursor-pointer"
                title={`Масштабирование вейвформы голосов: ${originalStems.vocalsWaveScale}x`}
              />
              <button
                onClick={() => setOriginalStems(prev => ({ ...prev, vocalsWaveScale: Math.min(8, prev.vocalsWaveScale + 0.25) }))}
                className="w-4 h-4 rounded bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 flex items-center justify-center text-[10px] font-bold shrink-0"
                title="Увеличить масштаб волны"
              >
                +
              </button>
              <button
                onClick={() => setOriginalStems(prev => ({ ...prev, vocalsWaveScale: 1.8 }))}
                className="text-[10px] font-mono tabular-nums text-sky-300 hover:text-sky-200 w-9 text-right shrink-0 font-bold"
                title="Сбросить масштаб волны (1.8x)"
              >
                {originalStems.vocalsWaveScale.toFixed(1)}x
              </button>
            </div>
          </div>

          {/* Stem 1 Lane */}
          <div
            onClick={handleTimelineClick}
            className="relative shrink-0 flex items-center bg-[#07131e]/50 overflow-hidden cursor-crosshair"
            style={{ width: `${Math.max(800, duration * zoomLevel)}px`, height: `${originalStems.vocalsTrackHeight || 88}px` }}
          >
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-10 pointer-events-none shadow-[0_0_8px_rgba(251,191,36,0.6)]"
              style={{ left: `${currentTime * zoomLevel}px` }}
            />
            <div className="absolute inset-0 opacity-10 bg-[linear-gradient(90deg,#38bdf8_1px,transparent_1px)] bg-[size:32px_100%]" />
            {originalStems.vocalsPeaks.length > 0 ? (
              <div className="relative w-full h-full flex items-center py-1">
                <OriginalPeaksWaveform
                  peaks={originalStems.vocalsPeaks}
                  width={Math.max(800, Math.round(duration * zoomLevel))}
                  height={Math.max(48, (originalStems.vocalsTrackHeight || 88) - 8)}
                  volume={originalStems.instrumentalSolo ? 0 : (originalStems.vocalsMuted ? 0 : originalStems.vocalsVolume)}
                  isMuted={originalStems.vocalsMuted || originalStems.instrumentalSolo}
                  waveScale={originalStems.vocalsWaveScale}
                  autoNormalize={isOriginalWaveNormalized}
                  theme="sky"
                />
                <span className="absolute left-3 top-1 text-[9px] font-mono tabular-nums text-sky-300 bg-[#07131e]/90 px-1.5 py-0.5 rounded border border-sky-500/30 pointer-events-none">
                  🎙️ Голоса оригинала (AI Vocals • {originalStems.modelId}) • Масштаб: {originalStems.vocalsWaveScale.toFixed(1)}x
                </span>
              </div>
            ) : (
              <div className="absolute inset-x-0 h-10 my-auto bg-sky-500/10 border-y border-sky-500/20 rounded flex items-center justify-center text-[10px] text-sky-300 font-mono tabular-nums">
                Дорожка голосов оригинала подключена ({formatSeconds(duration)})
              </div>
            )}
          </div>
        </div>

        {/* Stem 2: Original Background (Instrumental / M&E) */}
        <div
          className="flex border-b border-amber-900/60 bg-[#191307]/80 shrink-0 relative"
          style={{ height: `${originalStems.instrumentalTrackHeight || 88}px` }}
        >
          {/* Sticky Header */}
          <div className="w-64 sticky left-0 z-20 shrink-0 bg-[#191307] border-r border-amber-800/60 px-2.5 py-1.5 flex flex-col justify-between select-none">
            <div className="flex items-center justify-between gap-1">
              <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5 truncate">
                <Radio className="w-3.5 h-3.5 shrink-0 text-amber-300" />
                <span className="truncate">Оригинал: Фон M&E</span>
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => {
                    const curH = originalStems.instrumentalTrackHeight || 88;
                    const nextH = curH < 88 ? 96 : curH < 130 ? 144 : 68;
                    setOriginalStems(prev => ({ ...prev, instrumentalTrackHeight: nextH }));
                  }}
                  className="px-1.5 py-0.5 rounded bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 text-[9px] font-mono tabular-nums transition"
                  title="Высота дорожки фона M&E"
                >
                  {originalStems.instrumentalTrackHeight || 88}px
                </button>
                <button
                  onClick={() => setOriginalStems(prev => ({ ...prev, instrumentalSolo: !prev.instrumentalSolo, vocalsSolo: false }))}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition border ${
                    originalStems.instrumentalSolo
                      ? 'bg-amber-500 text-black border-amber-400 shadow-sm'
                      : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-white'
                  }`}
                  title="Соло дорожки фона M&E"
                >
                  S
                </button>
                <button
                  onClick={() => setOriginalStems(prev => ({ ...prev, instrumentalMuted: !prev.instrumentalMuted }))}
                  className={`p-1 rounded text-xs transition ${
                    originalStems.instrumentalMuted ? 'bg-red-500/20 text-red-400' : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                  title={originalStems.instrumentalMuted ? 'Включить фон M&E' : 'Заглушить фон M&E'}
                >
                  {originalStems.instrumentalMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Playback Volume Control */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-amber-300/80 w-10 shrink-0">Фон:</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={originalStems.instrumentalMuted ? 0 : originalStems.instrumentalVolume}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setOriginalStems(prev => ({
                    ...prev,
                    instrumentalVolume: val,
                    instrumentalMuted: val > 0 && prev.instrumentalMuted ? false : prev.instrumentalMuted
                  }));
                }}
                className="w-full accent-amber-400 h-1 bg-neutral-800 rounded cursor-pointer"
              />
              <span className="text-[10px] font-mono tabular-nums text-amber-300 w-9 text-right shrink-0">
                {originalStems.instrumentalMuted ? 'MUTE' : `${Math.round(originalStems.instrumentalVolume * 100)}%`}
              </span>
            </div>

            {/* Visual Waveform Amplitude Scale Control */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-amber-400/90 w-10 shrink-0" title="Масштаб отображения высоты пиков вейвформы фона M&E">
                Волна:
              </span>
              <button
                onClick={() => setOriginalStems(prev => ({ ...prev, instrumentalWaveScale: Math.max(0.5, prev.instrumentalWaveScale - 0.25) }))}
                className="w-4 h-4 rounded bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 flex items-center justify-center text-[10px] font-bold shrink-0"
                title="Уменьшить масштаб волны"
              >
                −
              </button>
              <input
                type="range"
                min="0.5"
                max="8"
                step="0.25"
                value={originalStems.instrumentalWaveScale}
                onChange={(e) => setOriginalStems(prev => ({ ...prev, instrumentalWaveScale: Number(e.target.value) }))}
                className="w-full accent-amber-400 h-1 bg-neutral-800 rounded cursor-pointer"
                title={`Масштабирование вейвформы фона M&E: ${originalStems.instrumentalWaveScale}x`}
              />
              <button
                onClick={() => setOriginalStems(prev => ({ ...prev, instrumentalWaveScale: Math.min(8, prev.instrumentalWaveScale + 0.25) }))}
                className="w-4 h-4 rounded bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 flex items-center justify-center text-[10px] font-bold shrink-0"
                title="Увеличить масштаб волны"
              >
                +
              </button>
              <button
                onClick={() => setOriginalStems(prev => ({ ...prev, instrumentalWaveScale: 1.8 }))}
                className="text-[10px] font-mono tabular-nums text-amber-300 hover:text-amber-200 w-9 text-right shrink-0 font-bold"
                title="Сбросить масштаб волны (1.8x)"
              >
                {originalStems.instrumentalWaveScale.toFixed(1)}x
              </button>
            </div>
          </div>

          {/* Stem 2 Lane */}
          <div
            onClick={handleTimelineClick}
            className="relative shrink-0 flex items-center bg-[#191307]/50 overflow-hidden cursor-crosshair"
            style={{ width: `${Math.max(800, duration * zoomLevel)}px`, height: `${originalStems.instrumentalTrackHeight || 88}px` }}
          >
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-10 pointer-events-none shadow-[0_0_8px_rgba(251,191,36,0.6)]"
              style={{ left: `${currentTime * zoomLevel}px` }}
            />
            <div className="absolute inset-0 opacity-10 bg-[linear-gradient(90deg,#f59e0b_1px,transparent_1px)] bg-[size:32px_100%]" />
            {originalStems.instrumentalPeaks.length > 0 ? (
              <div className="relative w-full h-full flex items-center py-1">
                <OriginalPeaksWaveform
                  peaks={originalStems.instrumentalPeaks}
                  width={Math.max(800, Math.round(duration * zoomLevel))}
                  height={Math.max(48, (originalStems.instrumentalTrackHeight || 88) - 8)}
                  volume={originalStems.vocalsSolo ? 0 : (originalStems.instrumentalMuted ? 0 : originalStems.instrumentalVolume)}
                  isMuted={originalStems.instrumentalMuted || originalStems.vocalsSolo}
                  waveScale={originalStems.instrumentalWaveScale}
                  autoNormalize={isOriginalWaveNormalized}
                  theme="amber"
                />
                <span className="absolute left-3 top-1 text-[9px] font-mono tabular-nums text-amber-300 bg-[#191307]/90 px-1.5 py-0.5 rounded border border-amber-500/30 pointer-events-none">
                  🎵 Фон оригинала (Music & Effects M&E) • Масштаб: {originalStems.instrumentalWaveScale.toFixed(1)}x
                </span>
              </div>
            ) : (
              <div className="absolute inset-x-0 h-10 my-auto bg-amber-500/10 border-y border-amber-500/20 rounded flex items-center justify-center text-[10px] text-amber-300 font-mono tabular-nums">
                Дорожка фона оригинала M&E подключена ({formatSeconds(duration)})
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <div
      className="flex border-b border-neutral-800/80 bg-neutral-950/60 shrink-0 relative"
      style={{ height: `${originalTrackHeight}px` }}
    >
      {/* Sticky Header */}
      <div className="w-64 sticky left-0 z-20 shrink-0 bg-neutral-950 border-r border-neutral-800/80 px-2.5 py-1.5 flex flex-col justify-between select-none">
        <div className="flex items-center justify-between gap-1">
          <span className="text-xs font-bold text-sky-400 flex items-center gap-1.5 truncate">
            <Video className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Оригинал (Видео)</span>
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setIsStemsModalOpen(true)}
              className="px-1.5 py-0.5 rounded text-[9px] font-bold transition border bg-sky-950/60 hover:bg-sky-900 text-sky-300 border-sky-600/50 flex items-center gap-1"
              title="Разделить оригинальное видео на Голоса и Фон M&E нейросетью"
            >
              <Scissors className="w-2.5 h-2.5" />
              <span>AI</span>
            </button>
            <button
              onClick={handleToggleOriginalWaveNorm}
              className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition border ${
                isOriginalWaveNormalized
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-neutral-900 text-neutral-500 border-neutral-800 hover:text-neutral-300'
              }`}
              title="Авто-нормализация и контраст фраз на вейвформе оригинала"
            >
              АВТО
            </button>
            <button
              onClick={() => {
                const nextH = originalTrackHeight < 88 ? 96 : originalTrackHeight < 130 ? 144 : 68;
                handleChangeOriginalTrackHeight(nextH);
              }}
              className="px-1.5 py-0.5 rounded bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 text-[9px] font-mono tabular-nums transition"
              title="Переключить высоту дорожки оригинала (68px / 96px / 144px) или потяните нижнюю границу мышкой"
            >
              {originalTrackHeight}px
            </button>
            <button
              onClick={() => setIsVideoOpen(prev => !prev)}
              className={`p-1 rounded text-xs transition ${
                isVideoOpen ? 'bg-sky-500/20 text-sky-300' : 'text-neutral-500 hover:text-neutral-200'
              }`}
              title={isVideoOpen ? 'Скрыть окно видео' : 'Показать окно видео'}
            >
              <Video className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIsOriginalMuted(prev => !prev)}
              className={`p-1 rounded text-xs transition ${
                isOriginalMuted ? 'bg-red-500/20 text-red-400' : 'text-neutral-400 hover:text-neutral-200'
              }`}
              title={isOriginalMuted ? 'Включить звук оригинала' : 'Заглушить звук оригинала'}
            >
              {isOriginalMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Playback Volume Control */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-neutral-400 w-10 shrink-0">Звук:</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={isOriginalMuted ? 0 : originalVolume}
            onChange={(e) => {
              const val = Number(e.target.value);
              setOriginalVolume(val);
              if (val > 0 && isOriginalMuted) setIsOriginalMuted(false);
            }}
            className="w-full accent-sky-500 h-1 bg-neutral-800 rounded cursor-pointer"
          />
          <span className="text-[10px] font-mono tabular-nums text-sky-300 w-9 text-right shrink-0">
            {isOriginalMuted ? 'MUTE' : `${Math.round(originalVolume * 100)}%`}
          </span>
        </div>

        {/* Visual Waveform Amplitude Scale Control */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-amber-400/90 w-10 shrink-0" title="Масштаб отображения высоты пиков вейвформы оригинала (не влияет на громкость звука)">
            Волна:
          </span>
          <button
            onClick={() => handleChangeOriginalWaveScale(originalWaveScale - 0.25)}
            className="w-4 h-4 rounded bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 flex items-center justify-center text-[10px] font-bold shrink-0"
            title="Уменьшить масштаб волны"
          >
            −
          </button>
          <input
            type="range"
            min="0.5"
            max="8"
            step="0.25"
            value={originalWaveScale}
            onChange={(e) => handleChangeOriginalWaveScale(Number(e.target.value))}
            className="w-full accent-amber-400 h-1 bg-neutral-800 rounded cursor-pointer"
            title={`Масштабирование вейвформы оригинала: ${originalWaveScale}x`}
          />
          <button
            onClick={() => handleChangeOriginalWaveScale(originalWaveScale + 0.25)}
            className="w-4 h-4 rounded bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 flex items-center justify-center text-[10px] font-bold shrink-0"
            title="Увеличить масштаб волны"
          >
            +
          </button>
          <button
            onClick={() => handleChangeOriginalWaveScale(1.8)}
            className="text-[10px] font-mono tabular-nums text-amber-300 hover:text-amber-200 w-9 text-right shrink-0 font-bold"
            title="Сбросить масштаб волны (1.8x)"
          >
            {originalWaveScale.toFixed(1)}x
          </button>
        </div>
      </div>

      {/* Original Track Lane with Real Extracted Peaks Waveform */}
      <div
        onClick={handleTimelineClick}
        className="relative shrink-0 flex items-center bg-neutral-950/40 overflow-hidden cursor-crosshair"
        style={{ width: `${Math.max(800, duration * zoomLevel)}px`, height: `${originalTrackHeight}px` }}
      >
        {/* Playhead Cursor Line */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-10 pointer-events-none shadow-[0_0_8px_rgba(251,191,36,0.6)]"
          style={{ left: `${currentTime * zoomLevel}px` }}
        />
        <div className="absolute inset-0 opacity-10 bg-[linear-gradient(90deg,#38bdf8_1px,transparent_1px)] bg-[size:32px_100%]" />
        {originalPeaks.length > 0 ? (
          <div className="relative w-full h-full flex items-center py-1">
            <OriginalPeaksWaveform
              peaks={originalPeaks}
              width={Math.max(800, Math.round(duration * zoomLevel))}
              height={Math.max(48, originalTrackHeight - 8)}
              volume={isOriginalMuted ? 0 : originalVolume}
              isMuted={isOriginalMuted}
              waveScale={originalWaveScale}
              autoNormalize={isOriginalWaveNormalized}
            />
            <span className="absolute left-3 top-1 text-[9px] font-mono tabular-nums text-sky-300/90 bg-neutral-950/85 px-1.5 py-0.5 rounded border border-sky-500/20 pointer-events-none">
              Оригинальная дорожка видео ({formatSeconds(duration)}) • Масштаб волны: {originalWaveScale.toFixed(1)}x {isOriginalWaveNormalized ? '(АВТО-контраст фраз)' : ''}
            </span>
          </div>
        ) : (
          <div className="absolute inset-x-0 h-10 my-auto bg-sky-500/10 border-y border-sky-500/20 rounded flex items-center justify-center text-[10px] text-sky-300 font-mono tabular-nums">
            {videoUrl
              ? `Аудиопоток оригинального видео подключен (${formatSeconds(duration)})`
              : `Оригинальный звук серии (${formatSeconds(duration)}) — видео не найдено`}
          </div>
        )}
      </div>

      {/* Bottom Resize Handle for Original Track Height */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setResizingOrigTrack({
            startMouseY: e.clientY,
            initialHeight: originalTrackHeight
          });
        }}
        className="absolute left-0 right-0 bottom-0 h-1.5 cursor-ns-resize hover:bg-sky-500/50 transition z-30"
        title="Потяните вверх/вниз для изменения высоты дорожки оригинала"
      />
    </div>
  );
};
