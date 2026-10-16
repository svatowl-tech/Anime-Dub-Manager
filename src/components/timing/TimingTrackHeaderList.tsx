import React from 'react';
import { Track } from '../../types';
import { AudioClip } from '../../types/timing';
import { Volume2, VolumeX, Mic, CheckCircle2 } from 'lucide-react';

interface TimingTrackHeaderListProps {
  tracks: Track[];
  clipsByTrack: Record<string, AudioClip[]>;
  volumeByTrack: Record<string, number>;
  mutedByTrack: Record<string, boolean>;
  soloByTrack: Record<string, boolean>;
  selectedTrackId: string | null;
  trackColors: Record<string, string>;
  onSelectTrack: (trackId: string) => void;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string) => void;
  onChangeVolume: (trackId: string, vol: number) => void;
}

export const TimingTrackHeaderList: React.FC<TimingTrackHeaderListProps> = ({
  tracks,
  clipsByTrack,
  volumeByTrack,
  mutedByTrack,
  soloByTrack,
  selectedTrackId,
  trackColors,
  onSelectTrack,
  onToggleMute,
  onToggleSolo,
  onChangeVolume
}) => {
  return (
    <div className="w-64 shrink-0 flex flex-col bg-neutral-900 border-r border-neutral-800 select-none">
      {/* Header title */}
      <div className="h-10 px-3 flex items-center justify-between border-b border-neutral-800 text-xs font-semibold text-neutral-400">
        <span>Дорожки ({tracks.length})</span>
        <span className="text-[10px] text-neutral-500 uppercase tracking-wider">M / S / Vol</span>
      </div>

      {/* Tracks list */}
      <div className="flex-1 overflow-y-auto divide-y divide-neutral-800/60">
        {tracks.map((track, idx) => {
          const trackId = track.id;
          const clips = clipsByTrack[trackId] || [];
          const isSelected = selectedTrackId === trackId;
          const isMuted = !!mutedByTrack[trackId];
          const isSolo = !!soloByTrack[trackId];
          const volume = volumeByTrack[trackId] !== undefined ? volumeByTrack[trackId] : 1.0;
          const color = trackColors[trackId] || '#6366f1';

          return (
            <div
              key={trackId}
              onClick={() => onSelectTrack(trackId)}
              className={`h-24 px-3 py-2 flex flex-col justify-between transition-colors cursor-pointer border-l-4 ${
                isSelected
                  ? 'bg-neutral-800/80 border-indigo-500'
                  : 'bg-neutral-900 hover:bg-neutral-850 border-transparent'
              }`}
            >
              {/* Top row: Dubber & Character */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-xs font-bold text-neutral-200 truncate">
                    {track.participant || track.dubberName || `Даббер ${idx + 1}`}
                  </span>
                </div>
                <span className="text-[11px] font-mono tabular-nums text-neutral-400 shrink-0">
                  {clips.length} {clips.length === 1 ? 'клип' : 'клипов'}
                </span>
              </div>

              {/* Character name subtitle */}
              <div className="text-[11px] text-neutral-400 truncate">
                {track.character || track.characterName || 'Не назначен'}
              </div>

              {/* Bottom controls: Mute, Solo, Volume */}
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-neutral-800/50">
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleMute(trackId);
                    }}
                    className={`w-6 h-5 rounded text-[10px] font-bold transition-colors ${
                      isMuted
                        ? 'bg-rose-600 text-white'
                        : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700'
                    }`}
                    title="Mute track"
                  >
                    M
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSolo(trackId);
                    }}
                    className={`w-6 h-5 rounded text-[10px] font-bold transition-colors ${
                      isSolo
                        ? 'bg-amber-500 text-neutral-950 font-black'
                        : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700'
                    }`}
                    title="Solo track"
                  >
                    S
                  </button>
                </div>

                {/* Volume slider */}
                <div className="flex items-center gap-1.5 flex-1 max-w-[120px]" onClick={(e) => e.stopPropagation()}>
                  {volume === 0 || isMuted ? (
                    <VolumeX className="w-3 h-3 text-neutral-500 shrink-0" />
                  ) : (
                    <Volume2 className="w-3 h-3 text-neutral-400 shrink-0" />
                  )}
                  <input
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.05"
                    value={volume}
                    onChange={(e) => onChangeVolume(trackId, parseFloat(e.target.value))}
                    className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    title={`Громкость: ${Math.round(volume * 100)}%`}
                  />
                  <span className="text-[10px] font-mono tabular-nums text-neutral-400 w-7 text-right">
                    {Math.round(volume * 100)}%
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
