import React from 'react';
import { Film, Layers, X, Sparkles, ArrowRight, Download, Check } from 'lucide-react';
import { MkvTrackInfo, formatTrackDisplayName, formatLanguageLabel } from '../../lib/mkvSubtitleExtractor';

export interface TorrentMkvDetectedModalProps {
  isOpen: boolean;
  onClose: () => void;
  episodeNumber: number;
  filePath: string;
  subtitlesCount: number;
  subtitleTracks: MkvTrackInfo[];
  onOpenMultiMerge: () => void;
}

export default function TorrentMkvDetectedModal({
  isOpen,
  onClose,
  episodeNumber,
  filePath,
  subtitlesCount,
  subtitleTracks,
  onOpenMultiMerge
}: TorrentMkvDetectedModalProps) {
  if (!isOpen) return null;

  const fileName = filePath.split(/[\\/]/).pop() || 'video.mkv';

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 overflow-y-auto">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col pointer-events-auto my-auto max-h-[85vh]">
        {/* Header */}
        <div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/70">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Обнаружены субтитры в MKV
                <span className="px-2 py-0.2 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Серия #{episodeNumber}
                </span>
              </h3>
              <p className="text-xs text-neutral-400 truncate max-w-sm" title={fileName}>
                {fileName}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          <p className="text-xs text-neutral-300 leading-relaxed">
            В скачанном с торрента видеофайле серии <strong>#{episodeNumber}</strong> обнаружено{' '}
            <strong className="text-indigo-400">{subtitlesCount}</strong> вшитых дорожек субтитров.
          </p>

          {subtitleTracks.length > 0 && (
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 bg-neutral-950/50 p-3 rounded-xl border border-neutral-800">
              <span className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">
                Доступные дорожки:
              </span>
              {subtitleTracks.map((track) => {
                const lang = formatLanguageLabel(track.tags?.language);
                const title = track.tags?.title || `Дорожка #${track.index}`;
                return (
                  <div
                    key={track.index}
                    className="text-xs text-neutral-300 flex items-center justify-between py-1 border-b border-neutral-800/50 last:border-0"
                  >
                    <span className="truncate pr-2">{title}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {lang && (
                        <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.2 rounded">
                          {lang}
                        </span>
                      )}
                      {track.codec_name && (
                        <span className="text-[9px] bg-neutral-800 text-neutral-400 px-1 rounded uppercase font-mono">
                          {track.codec_name}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-xs text-neutral-400">
            Вы можете открыть мульти-импорт прямо сейчас, чтобы выбрать одну или несколько дорожек и объединить их.
          </p>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-950/80 flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-xl text-xs font-medium transition-colors"
          >
            Позже
          </button>

          <button
            onClick={() => {
              onClose();
              onOpenMultiMerge();
            }}
            className="px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-indigo-600/20 flex items-center gap-2 cursor-pointer"
          >
            <Layers className="w-4 h-4" />
            <span>Выбрать и слить субтитры</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
