import React from 'react';
import { Globe, ShieldCheck, Settings2, Share2, Image as ImageIcon } from 'lucide-react';
import { Episode } from '../../types';
import { UploaderLayoutMode } from './types';

interface UploaderHeaderProps {
  currentEpisode: Episode | null;
  layoutMode: UploaderLayoutMode;
  setLayoutMode: (mode: UploaderLayoutMode) => void;
  onNavigate?: (tab: 'dashboard' | 'subtitles' | 'qa' | 'release' | 'uploader' | 'settings' | 'database' | 'cover' | 'stats' | 'archive') => void;
}

export const UploaderHeader: React.FC<UploaderHeaderProps> = ({
  currentEpisode,
  layoutMode,
  setLayoutMode,
  onNavigate
}) => {
  return (
    <header className="px-5 py-3 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between gap-3 flex-wrap flex-shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 bg-emerald-600/20 border border-emerald-500/30 rounded-lg flex items-center justify-center text-emerald-400 shadow-md flex-shrink-0">
          <Globe className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-bold text-base text-white tracking-tight">Загрузчик и Публикатор</h1>
            <span 
              className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800/50 font-semibold flex items-center gap-1" 
              title="Авторизация и сессии сайтов одинаковы для всей программы"
            >
              <ShieldCheck className="w-3 h-3 text-emerald-400" />
              Аккаунты: Общие
            </span>
            <span 
              className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-950 text-blue-400 border border-blue-800/50 font-semibold flex items-center gap-1" 
              title="Закладки, чек-листы, быстрые поля и заметки хранятся отдельно для этого проекта"
            >
              <Settings2 className="w-3 h-3 text-blue-400" />
              Настройки: {currentEpisode?.project?.title ? `Проект «${currentEpisode.project.title}»` : 'Общие'}
            </span>
          </div>
          <p className="text-xs text-neutral-400 truncate">
            {currentEpisode ? (
              <>
                <span className="text-neutral-200 font-medium">{currentEpisode.project?.title || 'Проект'}</span> — Серия {currentEpisode.number}
              </>
            ) : (
              'Автоматизированный браузер и генерация постов'
            )}
          </p>
        </div>
      </div>

      {/* Shortcuts and Layout Modes */}
      <div className="flex items-center gap-2.5 flex-wrap flex-shrink-0">
        {onNavigate && (
          <div className="flex items-center gap-1 bg-neutral-950/80 p-1 rounded-lg border border-neutral-800 text-xs">
            <button
              onClick={() => onNavigate('release')}
              className="px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition flex items-center gap-1.5 cursor-pointer"
              title="Перейти в Сборку релиза"
            >
              <Share2 className="w-3.5 h-3.5 text-purple-400" />
              <span className="hidden sm:inline">Сборка релиза</span>
            </button>
            <button
              onClick={() => onNavigate('cover')}
              className="px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition flex items-center gap-1.5 cursor-pointer"
              title="Перейти в Обложки серии"
            >
              <ImageIcon className="w-3.5 h-3.5 text-pink-400" />
              <span className="hidden sm:inline">Обложка</span>
            </button>
          </div>
        )}

        {/* Mode switch */}
        <div className="flex items-center bg-neutral-800/80 rounded-lg p-0.5 border border-neutral-700/60 text-xs">
          <button
            onClick={() => setLayoutMode('split')}
            className={`px-2.5 py-1 rounded font-medium transition cursor-pointer ${
              layoutMode === 'split' ? 'bg-emerald-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Разделенный
          </button>
          <button
            onClick={() => setLayoutMode('browser')}
            className={`px-2.5 py-1 rounded font-medium transition cursor-pointer ${
              layoutMode === 'browser' ? 'bg-emerald-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Браузер
          </button>
          <button
            onClick={() => setLayoutMode('generator')}
            className={`px-2.5 py-1 rounded font-medium transition cursor-pointer ${
              layoutMode === 'generator' ? 'bg-emerald-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Панель
          </button>
        </div>
      </div>
    </header>
  );
};
