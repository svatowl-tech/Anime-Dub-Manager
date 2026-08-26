import React from 'react';
import { Activity, CheckCircle, Check, MessageSquare, Clock, Mic, Trash2, Sliders } from 'lucide-react';
import { STATUS_MAP } from '../../constants';
import { Track } from '../../types';
import { NormalizationMetrics } from '../../lib/qa/audioNormalizer';

interface TrackSidebarProps {
  tracks: Track[];
  selectedTrackId: string | null;
  episodeId: string;
  setSelectedTrackId: (id: string | null) => void;
  handleApproveAll: () => void;
  handleFileUpload: (e: any, trackId: string, type?: 'DUBBER_FILE' | 'FIXES') => void;
  handleFileDelete?: (trackId: string, fileId: string) => void;
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  onGenerateFixesMessage?: () => void;
  onGenerateReminderMessage?: () => void;
  onExportSoundEngineer?: () => void;
  onBakeSubtitles?: () => void;
  isBaking?: boolean;
  bakeProgress?: number;
  bakeStatus?: string;
  isAutoNormalize?: boolean;
  onToggleAutoNormalize?: () => void;
  normalizationMetrics?: Record<string, NormalizationMetrics>;
}

export const TrackSidebar: React.FC<TrackSidebarProps> = ({
  tracks,
  selectedTrackId,
  episodeId,
  setSelectedTrackId,
  handleApproveAll,
  handleFileUpload,
  handleFileDelete,
  setTracks,
  onGenerateFixesMessage,
  onGenerateReminderMessage,
  onExportSoundEngineer,
  onBakeSubtitles,
  isBaking,
  bakeProgress,
  bakeStatus,
  isAutoNormalize = true,
  onToggleAutoNormalize,
  normalizationMetrics = {}
}) => {
  return (
    <div className="w-80 border-r border-neutral-800 flex flex-col">
      <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
        <h2 className="font-bold text-white">Список дорожек</h2>
        <div className="flex items-center gap-2">
          <button 
            onClick={handleApproveAll}
            title="Одобрить все"
            className="p-1.5 hover:bg-green-600/20 text-green-500 rounded-md transition-colors"
          >
            <Check className="w-4 h-4" />
          </button>
          <span className="text-xs text-neutral-500">{tracks.length} ролей</span>
        </div>
      </div>

      {/* Auto Normalization Toggle Header */}
      {onToggleAutoNormalize && (
        <div className="px-3 py-2 bg-neutral-900/90 border-b border-neutral-800 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-neutral-300">
            <Sliders className={`w-3.5 h-3.5 ${isAutoNormalize ? 'text-blue-400' : 'text-neutral-500'}`} />
            <span className="font-medium">Нормализация превью</span>
          </div>
          <button
            onClick={onToggleAutoNormalize}
            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-all tracking-wider ${
              isAutoNormalize
                ? 'bg-blue-600/20 text-blue-400 border border-blue-500/40 hover:bg-blue-600/30'
                : 'bg-neutral-800 text-neutral-400 border border-neutral-700 hover:bg-neutral-700 hover:text-white'
            }`}
            title={isAutoNormalize ? "Авто-нормализация громкости включена для QA превью (оригиналы на диске и в экспорте неизменны)" : "Нормализация отключена (воспроизведение в оригинальной громкости)"}
          >
            {isAutoNormalize ? 'Вкл' : 'Выкл'}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        <button
          onClick={() => setSelectedTrackId('all')}
          className={`w-full p-3 rounded-lg text-left transition-all border ${
            selectedTrackId === 'all' 
              ? 'bg-blue-600/10 border-blue-500/50' 
              : 'bg-neutral-900/50 border-transparent hover:border-neutral-700'
          }`}
        >
          <div className="text-white font-bold flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Отсмотреть всех
            </span>
            {isAutoNormalize && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-mono">
                Auto-Gain
              </span>
            )}
          </div>
          <div className="text-xs text-neutral-400 mt-1">Общий микс всех даберов</div>
        </button>
        
        <div className="h-px bg-neutral-800 my-2" />

        {tracks.map(track => {
          const norm = normalizationMetrics[track.id];
          return (
            <button
              key={track.id}
              onClick={() => setSelectedTrackId(track.id)}
              className={`w-full p-3 rounded-lg text-left transition-all border ${
                selectedTrackId === track.id 
                  ? 'bg-blue-600/10 border-blue-500/50' 
                  : 'bg-neutral-900/50 border-transparent hover:border-neutral-700'
              }`}
            >
              <div className="flex justify-between items-start mb-1">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${
                  track.status === 'approved' ? 'text-green-400' :
                  track.status === 'rejected' ? 'text-red-400' :
                  track.status === 'fixes_needed' ? 'text-yellow-400' : 'text-blue-400'
                }`}>
                  {STATUS_MAP[track.status.toUpperCase()]?.label || track.status}
                </span>
                <div className="flex items-center gap-1.5">
                  {track.id !== 'original' && track.files.length > 0 && norm && (
                    norm.status === 'analyzing' ? (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 animate-pulse font-mono">
                        Анализ...
                      </span>
                    ) : norm.status === 'ready' ? (
                      <span 
                        className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                          isAutoNormalize 
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' 
                            : 'bg-neutral-800 text-neutral-500 border-neutral-700'
                        }`}
                        title={`Нормализация для превью: ${norm.gainDb > 0 ? '+' : ''}${norm.gainDb} dB (Пик: ${norm.peakDb} dBFS, Речь: ${norm.rmsDb} dBFS). Исходный файл не изменен.`}
                      >
                        {isAutoNormalize ? `${norm.gainDb > 0 ? '+' : ''}${norm.gainDb} dB` : 'Orig'}
                      </span>
                    ) : null
                  )}
                  {track.files.length > 0 && <CheckCircle className="w-3 h-3 text-green-500" />}
                </div>
              </div>
              <div className="text-white font-medium">{track.participant}</div>
              <div className="text-xs text-neutral-400">{track.character}</div>
              
              {track.files.length > 0 && (
                <div className="mt-2 flex items-center gap-1 text-[10px] text-neutral-400">
                  <select 
                    className="bg-neutral-800 text-white rounded px-1 py-0.5 flex-1"
                    value={track.selectedFileId}
                    onChange={(e) => {
                      const newFileId = e.target.value;
                      localStorage.setItem(`selectedFile_${episodeId}_${track.id}`, newFileId);
                      setTracks(prev => prev.map(t => t.id === track.id ? { ...t, selectedFileId: newFileId } : t));
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {track.files.map((f, idx) => (
                      <option key={f.id} value={f.id}>
                        {f.type === 'FIXES' ? 'Фикс' : 'Версия'} {idx + 1} ({new Date(f.createdAt).toLocaleTimeString()})
                      </option>
                    ))}
                  </select>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      if (track.selectedFileId) {
                        handleFileDelete?.(track.id, track.selectedFileId);
                      }
                    }}
                    className="p-1 hover:bg-red-500/20 text-neutral-500 hover:text-red-400 rounded transition-colors"
                    title="Удалить выбранную дорожку"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              
              <div className="mt-2 flex gap-2">
                <label className="flex-1 cursor-pointer text-[10px] bg-neutral-800 hover:bg-neutral-700 text-neutral-300 px-2 py-1 rounded block text-center transition-colors">
                  {track.files.length === 0 ? 'Загрузить аудио' : 'Добавить версию'}
                  <input 
                    type="file" 
                    className="hidden" 
                    accept="audio/*" 
                    onChange={(e) => handleFileUpload(e, track.id, 'DUBBER_FILE')} 
                  />
                </label>
                {track.files.length > 0 && (
                  <label className="flex-1 cursor-pointer text-[10px] bg-amber-900/20 hover:bg-amber-900/40 text-amber-400 px-2 py-1 rounded block text-center border border-amber-900/50 transition-colors">
                    Загрузить фикс
                    <input 
                      type="file" 
                      className="hidden" 
                      accept="audio/*" 
                      onChange={(e) => handleFileUpload(e, track.id, 'FIXES')} 
                    />
                  </label>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="p-4 border-t border-neutral-800 space-y-2">
        <button 
          onClick={onGenerateFixesMessage}
          className="w-full py-2 bg-yellow-600/20 hover:bg-yellow-600/40 text-yellow-400 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Выписка фиксов
        </button>
        <button 
          onClick={onGenerateReminderMessage}
          className="w-full py-2 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2"
        >
          <Clock className="w-3.5 h-3.5" />
          Напомнить о сдаче
        </button>
        <button 
          onClick={onExportSoundEngineer}
          className="w-full py-2 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2"
        >
          <Mic className="w-3.5 h-3.5" />
          Экспорт для звукача
        </button>
        <button 
          onClick={onBakeSubtitles}
          disabled={isBaking}
          className="w-full py-2 bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Activity className="w-3.5 h-3.5" />
          {isBaking ? `Рендеринг ${Math.round(bakeProgress || 0)}%` : 'Вшить субтитры'}
        </button>
      </div>
    </div>
  );
};
