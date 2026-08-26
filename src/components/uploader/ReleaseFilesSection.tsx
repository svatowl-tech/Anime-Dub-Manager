import React from 'react';
import { FolderOpen, FileVideo, Image as ImageIcon, Copy } from 'lucide-react';
import { Episode } from '../../types';

interface ReleaseFilesSectionProps {
  currentEpisode: Episode | null;
  copyToClipboard: (text: string, label: string) => void;
  handleShowInFolder: (path?: string | null) => void;
}

export const ReleaseFilesSection: React.FC<ReleaseFilesSectionProps> = ({
  currentEpisode,
  copyToClipboard,
  handleShowInFolder
}) => {
  const currentPosterPath = typeof currentEpisode?.uploads?.[0] === 'string' 
    ? currentEpisode.uploads[0] 
    : currentEpisode?.uploads?.[0]?.path || currentEpisode?.project?.posterUrl || '';
  const currentVideoPath = currentEpisode?.rawPath || '';

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3.5 space-y-2.5">
      <div className="flex items-center justify-between text-xs text-neutral-400 font-medium">
        <span className="flex items-center gap-1.5 text-neutral-200 font-semibold">
          <FolderOpen className="w-4 h-4 text-amber-400" />
          Файлы релиза
        </span>
        <span className="text-[11px] text-neutral-500">Клик: путь / 2x: папка</span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <button
          onClick={() => copyToClipboard(currentVideoPath, 'Путь к видеофайлу')}
          onDoubleClick={() => handleShowInFolder(currentVideoPath)}
          className="p-2.5 bg-neutral-800/80 hover:bg-neutral-800 border border-neutral-700/50 rounded-lg text-left transition flex items-center justify-between group cursor-pointer"
          title="Клик: скопировать путь, Двойной клик: открыть папку"
        >
          <div className="flex items-center gap-2 truncate">
            <FileVideo className="w-4 h-4 text-blue-400 flex-shrink-0" />
            <span className="truncate text-neutral-200 font-medium">Видео</span>
          </div>
          <Copy className="w-3.5 h-3.5 text-neutral-500 group-hover:text-neutral-200 flex-shrink-0" />
        </button>

        <button
          onClick={() => copyToClipboard(currentPosterPath, 'Путь к обложке')}
          onDoubleClick={() => handleShowInFolder(currentPosterPath)}
          className="p-2.5 bg-neutral-800/80 hover:bg-neutral-800 border border-neutral-700/50 rounded-lg text-left transition flex items-center justify-between group cursor-pointer"
          title="Клик: скопировать путь, Двойной клик: открыть папку"
        >
          <div className="flex items-center gap-2 truncate">
            <ImageIcon className="w-4 h-4 text-pink-400 flex-shrink-0" />
            <span className="truncate text-neutral-200 font-medium">Обложка</span>
          </div>
          <Copy className="w-3.5 h-3.5 text-neutral-500 group-hover:text-neutral-200 flex-shrink-0" />
        </button>
      </div>
    </div>
  );
};
