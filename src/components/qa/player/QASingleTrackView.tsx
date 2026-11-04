import React from "react";
import {
  Play,
  Pause,
  CheckCircle,
  XCircle,
  AlertCircle,
  MessageSquare,
  Volume2,
  X,
  Activity,
  User,
  Clock,
  Trash2,
  SkipForward,
  SkipBack,
  Scissors,
  VolumeX
} from "lucide-react";
import WaveSurfer from "wavesurfer.js";
import { Episode, Track, SubtitleLine } from "../../../types";
import { NormalizationMetrics } from "../../../lib/qa/audioNormalizer";
import { TrackWaveform } from "../TrackWaveform";

export interface QASingleTrackViewProps {
  currentEpisode: Episode;
  selectedTrack: Track;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoUrl?: string;
  handleVideoPlay: () => void;
  handleVideoPause: () => void;
  handleVideoTimeUpdate: () => void;
  handleVideoSeeking: () => void;
  handleVideoEnded: () => void;
  duration: number;
  setDuration: React.Dispatch<React.SetStateAction<number>>;
  currentTime: number;
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>;
  handleSeekToTime: (time: number) => void;
  isPlaying: boolean;
  togglePlay: () => void;
  seekToNext: () => void;
  seekToPrev: () => void;
  handleStop: () => void;
  detectSilence: () => Promise<void>;
  isAnalyzingSilence: boolean;
  handleStatusChange: (id: string, status: Track["status"]) => Promise<void>;
  currentCharacter: string | null;
  currentDubberNickname: string | null;
  currentSubtitleText: string | null;
  handleReassignCharacter: (newCharacterName: string) => Promise<void>;
  volumes: Record<string, number>;
  setVolumes: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  isAutoNormalize: boolean;
  normalizationMetrics: Record<string, NormalizationMetrics>;
  isMuted: boolean;
  setIsMuted: React.Dispatch<React.SetStateAction<boolean>>;
  originalVolume: number;
  setOriginalVolume: React.Dispatch<React.SetStateAction<number>>;
  handleDeleteComment: (trackId: string, commentId: string) => Promise<void>;
  renderFixIssueBar: () => React.ReactNode;
  mutedTracks: Set<string>;
  setMutedTracks: React.Dispatch<React.SetStateAction<Set<string>>>;
  subLines: SubtitleLine[];
  setCommentModal: React.Dispatch<React.SetStateAction<{ isOpen: boolean; region: any } | null>>;
  wavesurferRef: React.MutableRefObject<WaveSurfer | null>;
}

export const QASingleTrackView: React.FC<QASingleTrackViewProps> = ({
  currentEpisode,
  selectedTrack,
  videoRef,
  videoUrl,
  handleVideoPlay,
  handleVideoPause,
  handleVideoTimeUpdate,
  handleVideoSeeking,
  handleVideoEnded,
  duration,
  setDuration,
  currentTime,
  setCurrentTime,
  handleSeekToTime,
  isPlaying,
  togglePlay,
  seekToNext,
  seekToPrev,
  handleStop,
  detectSilence,
  isAnalyzingSilence,
  handleStatusChange,
  currentCharacter,
  currentDubberNickname,
  currentSubtitleText,
  handleReassignCharacter,
  volumes,
  setVolumes,
  isAutoNormalize,
  normalizationMetrics,
  isMuted,
  setIsMuted,
  originalVolume,
  setOriginalVolume,
  handleDeleteComment,
  renderFixIssueBar,
  mutedTracks,
  setMutedTracks,
  subLines,
  setCommentModal,
  wavesurferRef
}) => {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Video & Waveform */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="aspect-video bg-black rounded-xl overflow-hidden border border-neutral-800 relative group">
            <video 
              ref={videoRef}
              src={videoUrl || undefined}
              className="w-full h-full object-contain"
              onPlay={handleVideoPlay}
              onPause={handleVideoPause}
              onTimeUpdate={handleVideoTimeUpdate}
              onSeeking={handleVideoSeeking}
              onSeeked={handleVideoSeeking}
              onEnded={handleVideoEnded}
              onLoadedMetadata={(e) => {
                setDuration(e.currentTarget.duration);
                e.currentTarget.currentTime = currentTime;
              }}
            />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4">
              <div className="flex flex-col gap-2 w-full">
                <input 
                  type="range" 
                  min={0} 
                  max={duration || 100} 
                  value={currentTime}
                  onChange={(e) => {
                    const time = parseFloat(e.target.value);
                    handleSeekToTime(time);
                  }}
                  className="w-full accent-blue-500"
                />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={handleStop} 
                      className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all"
                      title="Стоп"
                    >
                      <X className="w-5 h-5" />
                    </button>
                    <button 
                      onClick={seekToPrev} 
                      className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all"
                      title="К предыдущей реплике (Стрелка влево / Shift+A)"
                    >
                      <SkipBack className="w-5 h-5" />
                    </button>
                    <button 
                      onClick={togglePlay} 
                      className="p-3 bg-blue-600 hover:bg-blue-500 rounded-full text-white transition-all transform hover:scale-110"
                      title={isPlaying ? "Пауза" : "Играть"}
                    >
                      {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                    </button>
                    <button 
                      onClick={seekToNext} 
                      className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all"
                      title="К следующей реплике (Стрелка вправо / Shift+D)"
                    >
                      <SkipForward className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 bg-black/60 px-3 py-1 rounded-full">
                    <Clock className="w-3 h-3 text-blue-400" />
                    <span className="text-xs font-mono text-white">
                      {new Date(currentTime * 1000).toISOString().substr(14, 5)} / {new Date(duration * 1000).toISOString().substr(14, 5)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold">
                    {selectedTrack.participant.charAt(0)}
                  </div>
                  <div>
                    <div className="text-white font-bold">{selectedTrack.character}</div>
                    <div className="text-xs text-neutral-400">{selectedTrack.participant}</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={detectSilence}
                    disabled={isAnalyzingSilence}
                    className={`p-2 rounded-lg transition-colors ${isAnalyzingSilence ? 'bg-neutral-800 text-neutral-600' : 'bg-neutral-800 text-neutral-400 hover:text-blue-400'}`}
                    title="Детектор тишины"
                  >
                    <Scissors className={`w-5 h-5 ${isAnalyzingSilence ? 'animate-pulse' : ''}`} />
                  </button>
                  <button 
                    onClick={() => handleStatusChange(selectedTrack.id, 'approved')}
                    className={`p-2 rounded-lg transition-colors ${selectedTrack.status === 'approved' ? 'bg-green-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-green-400'}`}
                    title="Одобрить"
                  >
                    <CheckCircle className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={() => handleStatusChange(selectedTrack.id, 'fixes_needed')}
                    className={`p-2 rounded-lg transition-colors ${selectedTrack.status === 'fixes_needed' ? 'bg-yellow-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-yellow-400'}`}
                    title="Требуются исправления"
                  >
                    <AlertCircle className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={() => handleStatusChange(selectedTrack.id, 'rejected')}
                    className={`p-2 rounded-lg transition-colors ${selectedTrack.status === 'rejected' ? 'bg-red-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-red-400'}`}
                    title="Отклонить"
                  >
                    <XCircle className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Current Phrase Info & Reassignment */}
              <div className="mb-4 pb-4 border-b border-neutral-800 space-y-2">
                 <div className="flex items-center justify-between">
                  <div className={`text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 ${currentCharacter ? 'text-blue-400' : 'text-neutral-500'}`}>
                    <User className="w-3.5 h-3.5" />
                    {currentCharacter ? (
                      <span>
                        {currentDubberNickname ? `${currentDubberNickname} (${currentCharacter})` : currentCharacter}
                      </span>
                    ) : 'Никто не говорит'}
                  </div>
                  
                  {currentCharacter && currentEpisode && (
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-neutral-500">Переназначить:</span>
                      <select 
                        className="bg-neutral-800 border border-neutral-700 text-white text-[10px] rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={currentCharacter}
                        onChange={(e) => handleReassignCharacter(e.target.value)}
                      >
                        <option value={currentCharacter}>{currentCharacter}</option>
                        {currentEpisode.assignments?.map(a => a.characterName)
                          .filter(name => name !== currentCharacter)
                          .filter((v, i, a) => a.indexOf(v) === i)
                          .map(name => (
                            <option key={name} value={name}>{name}</option>
                          ))
                        }
                      </select>
                    </div>
                  )}
                </div>
                {currentSubtitleText && (
                  <div className="text-[11px] text-neutral-400 italic line-clamp-1">
                    "{currentSubtitleText}"
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <Volume2 className="w-4 h-4 text-neutral-500" />
                  <input 
                    type="range" min="0" max="1" step="0.1" value={volumes[selectedTrack.id] ?? 0.8} 
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setVolumes(prev => ({ ...prev, [selectedTrack.id]: v }));
                    }}
                    className="flex-1 accent-blue-500"
                  />
                  {isAutoNormalize && normalizationMetrics[selectedTrack.id]?.status === 'ready' && (
                    <span 
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      title={`Коррекция превью: ${normalizationMetrics[selectedTrack.id].gainDb > 0 ? '+' : ''}${normalizationMetrics[selectedTrack.id].gainDb} dB. Исходный файл не изменен.`}
                    >
                      {normalizationMetrics[selectedTrack.id].gainDb > 0 ? '+' : ''}{normalizationMetrics[selectedTrack.id].gainDb} dB
                    </span>
                  )}
                  <button 
                    onClick={() => setIsMuted(!isMuted)}
                    className={`p-1 rounded ${isMuted ? 'text-red-500 bg-red-500/10' : 'text-neutral-500 hover:text-white'}`}
                    title="Приглушить фон"
                  >
                    <Activity className="w-4 h-4" />
                  </button>
                  <span className="text-[10px] text-neutral-500 w-8">ДАБ</span>
                </div>
                <div className="flex items-center gap-4">
                  <Volume2 className="w-4 h-4 text-neutral-500" />
                  <input 
                    type="range" min="0" max="1" step="0.1" value={originalVolume} 
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setOriginalVolume(v);
                      if (videoRef.current) videoRef.current.volume = v;
                    }}
                    className="flex-1 accent-neutral-500"
                  />
                  <span className="text-[10px] text-neutral-500 w-8">РАВ</span>
                </div>
              </div>
            </div>

            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 h-[200px] flex flex-col">
              <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Правки и комментарии
              </h3>
              <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-hide">
                {[...selectedTrack.comments].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)).map(comment => (
                  <div key={comment.id} className="bg-neutral-800/50 rounded-lg p-3 border border-neutral-700/50 group/comment">
                    <div className="flex justify-between items-start mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-blue-400 uppercase">{comment.author}</span>
                        <span className="text-[10px] text-neutral-500">{new Date(comment.timestamp * 1000).toISOString().substr(14, 5)}</span>
                      </div>
                      <button 
                        onClick={() => handleDeleteComment(selectedTrack.id, comment.id)}
                        className="opacity-0 group/comment:opacity-100 p-1 hover:text-red-400 transition-all"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-sm text-neutral-200">{comment.text}</p>
                  </div>
                ))}
                {selectedTrack.comments.length === 0 && (
                  <div className="h-full flex items-center justify-center text-neutral-600 text-sm italic">
                    Комментариев пока нет
                  </div>
                )}
              </div>
            </div>

            {renderFixIssueBar()}
          </div>
        </div>

        {/* Waveform Section */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 space-y-4">
          {[selectedTrack].map(track => (
            <div key={track.id} className="bg-neutral-800/50 p-4 rounded-lg border border-neutral-700/50">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-white">{track.participant} ({track.character})</span>
                <div className="flex gap-2">
                  <button onClick={() => setMutedTracks(prev => {
                    const next = new Set(prev);
                    if (next.has(track.id)) next.delete(track.id);
                    else next.add(track.id);
                    return next;
                  })} className={`p-1 rounded ${mutedTracks.has(track.id) ? 'text-red-500' : 'text-neutral-400'}`}>
                    {mutedTracks.has(track.id) ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <TrackWaveform 
                track={track}
                currentTime={currentTime}
                isPlaying={isPlaying}
                subLines={subLines}
                onTimeUpdate={setCurrentTime}
                onSeek={handleSeekToTime}
                onPlayPause={togglePlay}
                volume={track.id === 'original' ? 0 : (isMuted || mutedTracks.has(track.id) ? 0 : Math.max(0, (volumes[track.id] ?? 0.8) * ((isAutoNormalize && normalizationMetrics[track.id]?.status === 'ready') ? normalizationMetrics[track.id].gain : 1.0)))}
                isMuted={isMuted || mutedTracks.has(track.id)}
                onRegionClick={(region) => {
                  setCommentModal({ isOpen: true, region });
                }}
                onWaveSurferReady={(ws) => {
                  wavesurferRef.current = ws;
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
