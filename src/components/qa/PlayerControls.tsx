import { Play, Pause, X, SkipForward, Clock } from 'lucide-react';

interface PlayerControlsProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onTogglePlay: () => void;
  onStop: () => void;
  onSeekToNext: () => void;
}

export const PlayerControls = ({ isPlaying, currentTime, duration, onTogglePlay, onStop, onSeekToNext }: PlayerControlsProps) => {
  return (
    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-4">
      <div className="flex items-center gap-4">
        <button 
          onClick={onStop} 
          className="p-3 bg-white/10 hover:bg-white/20 rounded-full backdrop-blur-md text-white transition-all"
          title="Стоп"
        >
          <X className="w-6 h-6" />
        </button>
        <button 
          onClick={onTogglePlay} 
          className="p-6 bg-blue-600 hover:bg-blue-500 rounded-full shadow-xl shadow-blue-500/40 text-white transition-all transform hover:scale-110"
          title={isPlaying ? "Пауза" : "Играть"}
        >
          {isPlaying ? <Pause className="w-10 h-10" /> : <Play className="w-10 h-10 fill-current ml-1" />}
        </button>
        <button 
          onClick={onSeekToNext} 
          className="p-3 bg-white/10 hover:bg-white/20 rounded-full backdrop-blur-md text-white transition-all"
          title="К следующей реплике (Стрелка вправо)"
        >
          <SkipForward className="w-6 h-6" />
        </button>
      </div>
      <div className="flex items-center gap-2 bg-black/60 px-4 py-2 rounded-full backdrop-blur-md">
        <Clock className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-mono text-white">
          {new Date(currentTime * 1000).toISOString().substr(14, 5)} / {new Date(duration * 1000).toISOString().substr(14, 5)}
        </span>
      </div>
    </div>
  );
};
