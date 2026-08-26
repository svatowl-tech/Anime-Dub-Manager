import React, { useState } from 'react';
import { FileVideo, FileText, MousePointerClick } from 'lucide-react';
import { Episode } from '../types';
import { idb } from '../lib/idb';
import { ipcSafe } from '../lib/ipcSafe';

interface Props {
  onApply: (episode: Episode) => void;
  title: string;
}

export default function StandaloneMediaSelector({ onApply, title }: Props) {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [subFile, setSubFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleApply = async () => {
    setIsLoading(true);
    let videoUrl = videoFile ? URL.createObjectURL(videoFile) : undefined;
    let subRawText = undefined;
    
    if (subFile) {
        subRawText = await subFile.text();
        await idb.set('standalone_sub_text', subRawText);
    }
    
    const mockEpisode: Episode = {
      id: 'standalone-' + Date.now(),
      projectId: 'standalone',
      number: 1,
      status: 'ROLES',
      rawPath: videoUrl || '',
      subPath: subRawText ? 'standalone.ass' : '',
      assignments: [],
      // @ts-ignore
      project: {
          id: 'standalone',
          title: 'Ручной Режим',
          episodes: [],
          status: 'ACTIVE',
          releaseType: 'VOICEOVER'
      }
    };
    
    // Attach the actual text buffer and video URL onto the object itself to bypass IPC reads
    (mockEpisode as any)._standaloneVideoBuffer = videoFile;
    (mockEpisode as any)._standaloneVideoUrl = videoUrl;
    (mockEpisode as any)._standaloneSubText = subRawText;
    
    setIsLoading(false);
    onApply(mockEpisode);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto p-6 space-y-8">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-white">{title}: Ручной режим</h2>
        <p className="text-neutral-400">Выберите файлы для обработки в вебе (без создания проекта в дашборде)</p>
      </div>
      
      <div className="grid grid-cols-2 gap-4 w-full">
        <label className="border-2 border-dashed border-neutral-700 hover:border-blue-500 hover:bg-neutral-800/50 rounded-xl p-8 flex flex-col items-center justify-center transition-all cursor-pointer group">
           <FileVideo className="w-10 h-10 text-neutral-500 group-hover:text-blue-400 mb-4" />
           <div className="text-sm font-bold text-white mb-1">Видео файл</div>
           <div className="text-xs text-neutral-500 mb-4 text-center break-all max-w-[200px]">{videoFile ? videoFile.name : 'Выберите видео'}</div>
           <input type="file" accept="video/mp4,video/mkv,video/webm" className="hidden" onChange={(e) => setVideoFile(e.target.files?.[0] || null)} />
        </label>
        
        <label className="border-2 border-dashed border-neutral-700 hover:border-blue-500 hover:bg-neutral-800/50 rounded-xl p-8 flex flex-col items-center justify-center transition-all cursor-pointer group">
           <FileText className="w-10 h-10 text-neutral-500 group-hover:text-blue-400 mb-4" />
           <div className="text-sm font-bold text-white mb-1">Файл субтитров</div>
           <div className="text-xs text-neutral-500 mb-4 text-center break-all max-w-[200px]">{subFile ? subFile.name : 'Выберите субтитры'}</div>
           <input type="file" accept=".ass,.srt" className="hidden" onChange={(e) => setSubFile(e.target.files?.[0] || null)} />
        </label>
      </div>

      <button
        onClick={handleApply}
        disabled={isLoading || (!videoFile && !subFile)}
        className="px-8 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-all shadow-lg flex items-center gap-2"
      >
        <MousePointerClick className="w-5 h-5" />
        Начать работу
      </button>
    </div>
  );
}
