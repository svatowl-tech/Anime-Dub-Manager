import React from 'react';
import { Play, Pause, RotateCcw, Volume2, VolumeX, FastForward, Repeat, Sliders } from 'lucide-react';
import { VoicePlaybackSettings, CharacterDialogueLine } from '../../lib/characterPreview/characterPreviewTypes';
import { formatSecondsToTime } from '../../lib/characterPreview/timeUtils';

interface CharacterVoicePlayerProps {
  isPlaying: boolean;
  onTogglePlay: () => void;
  onReplay: () => void;
  currentLine: CharacterDialogueLine | null;
  playbackProgressSec: number;
  settings: VoicePlaybackSettings;
  onUpdateSettings: (newSettings: Partial<VoicePlaybackSettings>) => void;
}

export default function CharacterVoicePlayer({
  isPlaying,
  onTogglePlay,
  onReplay,
  currentLine,
  playbackProgressSec,
  settings,
  onUpdateSettings,
}: CharacterVoicePlayerProps) {
  const lineDuration = currentLine ? currentLine.durationSec : 1;
  const startSec = currentLine ? currentLine.startSec : 0;
  const progressRatio = currentLine 
    ? Math.max(0, Math.min(1, (playbackProgressSec - startSec) / lineDuration))
    : 0;

  return (
    <div className="bg-neutral-950/70 border border-neutral-800 rounded-xl p-3.5 space-y-3 shadow-lg">
      {/* Top Playback Status & Time */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-emerald-400 animate-pulse' : 'bg-neutral-600'}`} />
          <span className="text-xs font-semibold text-neutral-200">
            Оригинальная речь персонажа
          </span>
        </div>

        {currentLine && (
          <div className="text-[11px] font-mono text-neutral-400">
            <span className="text-indigo-400">{formatSecondsToTime(playbackProgressSec)}</span>
            <span className="text-neutral-600"> / </span>
            <span>{formatSecondsToTime(currentLine.endSec)}</span>
          </div>
        )}
      </div>

      {/* Playback Progress Bar */}
      <div className="relative w-full h-2 bg-neutral-900 rounded-full overflow-hidden border border-neutral-800">
        <div
          className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all duration-75 ease-linear rounded-full"
          style={{ width: `${progressRatio * 100}%` }}
        />
      </div>

      {/* Main Playback Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        {/* Play / Pause / Replay Group */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTogglePlay}
            disabled={!currentLine}
            className={`px-4 py-2 rounded-lg font-medium text-xs flex items-center gap-2 transition-all shadow-md ${
              isPlaying
                ? 'bg-amber-600 hover:bg-amber-500 text-white'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20'
            } disabled:opacity-40`}
          >
            {isPlaying ? (
              <>
                <Pause className="w-3.5 h-3.5 fill-current" />
                <span>Пауза</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Слушать фразу</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onReplay}
            disabled={!currentLine}
            title="Воспроизвести с начала"
            className="p-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-neutral-300 rounded-lg transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Playback Adjustments */}
        <div className="flex items-center gap-2">
          {/* Loop toggle */}
          <button
            type="button"
            onClick={() => onUpdateSettings({ loop: !settings.loop })}
            title={settings.loop ? 'Повтор включен' : 'Повтор выключен'}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-colors ${
              settings.loop
                ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-neutral-200'
            }`}
          >
            <Repeat className="w-3.5 h-3.5" />
            <span className="text-[11px]">Повтор</span>
          </button>

          {/* Speed Selector */}
          <div className="flex items-center bg-neutral-900 border border-neutral-800 rounded-lg p-0.5 text-[11px]">
            {[0.8, 1.0, 1.25].map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => onUpdateSettings({ playbackRate: rate })}
                className={`px-2 py-1 rounded-md transition-colors ${
                  settings.playbackRate === rate
                    ? 'bg-indigo-600 text-white font-semibold'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {rate}x
              </button>
            ))}
          </div>

          {/* Volume control */}
          <div className="flex items-center gap-1.5 bg-neutral-900 border border-neutral-800 rounded-lg px-2 py-1.5">
            <button
              type="button"
              onClick={() => onUpdateSettings({ volume: settings.volume > 0 ? 0 : 1 })}
              className="text-neutral-400 hover:text-neutral-200"
            >
              {settings.volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.volume}
              onChange={(e) => onUpdateSettings({ volume: parseFloat(e.target.value) })}
              className="w-14 h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
