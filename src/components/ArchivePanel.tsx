import React, { useState } from 'react';
import { 
  Archive, RotateCcw, Search, FolderOpen, 
  Calendar, CheckCircle2, ChevronRight, PlaySquare, Trash2
} from 'lucide-react';
import { Project } from '../types';
import { ipcSafe } from '../lib/ipcSafe';
import { toast } from 'sonner';

interface ArchivePanelProps {
  projects: Project[];
  onProjectSelect: (id: string) => void;
  onNavigate: (tab: any) => void;
  onRefresh: () => void;
}

export default function ArchivePanel({
  projects,
  onProjectSelect,
  onNavigate,
  onRefresh
}: ArchivePanelProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Get only completed/archived projects
  const archivedProjects = projects.filter(p => p.status === 'COMPLETED');

  // Filter archived projects by search query
  const filteredArchived = archivedProjects.filter(p => 
    p.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (p.originalTitle && p.originalTitle.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Restore a project to active
  const handleRestoreProject = async (p: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const updated = {
        ...p,
        status: 'ACTIVE' as const,
        updatedAt: new Date().toISOString()
      };
      await ipcSafe.invoke('save-project', updated);
      toast.success(`Проект "${p.title}" возвращен в активные!`);
      onRefresh();
    } catch (err: any) {
      toast.error('Не удалось восстановить проект: ' + err.message);
    }
  };

  // Permanently delete a project with confirmation
  const handleDeleteProject = async (p: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Вы действительно хотите БЕЗВОЗВРАТНО удалить проект "${p.title}" и все его серии? Это действие нельзя отменить.`)) {
      try {
        await ipcSafe.invoke('delete-project', p.id);
        toast.success(`Проект "${p.title}" удален навсегда`);
        onRefresh();
      } catch (err: any) {
        toast.error('Не удалось удалить проект: ' + err.message);
      }
    }
  };

  return (
    <div className="p-8 w-full max-w-none mx-auto space-y-8 text-left">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-3">
            <Archive className="w-8 h-8 text-amber-500" />
            <span>Архив Проектов</span>
          </h1>
          <p className="text-neutral-400 text-sm max-w-xl">
            Завершенные или приостановленные тайтлы. Они скрыты с основной панели управления, 
            но вы всегда можете просмотреть их историю или вернуть обратно в список активных.
          </p>
        </div>

        <div className="relative w-full md:w-80">
          <input 
            type="text"
            placeholder="Поиск по архиву..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-800 focus:border-amber-500 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-500">
            <Search className="w-4 h-4" />
          </div>
        </div>
      </div>

      {filteredArchived.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredArchived.map(project => {
            const completedCount = project.episodes?.filter(e => e.status === 'FINISHED').length || 0;
            const totalCount = project.episodes?.length || 0;

            return (
              <div
                key={project.id}
                onClick={() => {
                  onProjectSelect(project.id);
                  onNavigate('dashboard');
                }}
                className="bg-neutral-900/40 hover:bg-neutral-900/80 border border-neutral-800 hover:border-neutral-700/80 rounded-2xl overflow-hidden shadow-lg transition-all group flex flex-col h-full cursor-pointer"
              >
                {/* Header Blur Image if exists */}
                <div className="h-28 relative bg-neutral-950 shrink-0 overflow-hidden">
                  {project.posterUrl ? (
                    <div className="absolute inset-0">
                      <img 
                        src={project.posterUrl} 
                        alt={project.title} 
                        className="w-full h-full object-cover filter blur-[4px] opacity-20"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-neutral-900 via-neutral-900/80 to-transparent" />
                    </div>
                  ) : (
                    <div className="absolute inset-0 bg-neutral-950" />
                  )}

                  <div className="absolute bottom-3 left-4 right-4 flex gap-3 items-end">
                    <span className="text-xl shrink-0 pb-1">{project.emoji || '📁'}</span>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-bold text-neutral-300 leading-tight truncate group-hover:text-amber-400 transition-colors">
                        {project.title}
                      </h3>
                      <p className="text-[10px] text-neutral-500 truncate mt-0.5">
                        {project.originalTitle}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Content */}
                <div className="p-4 flex-1 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-xs text-neutral-400">
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                        Готово серий:
                      </span>
                      <strong className="text-white">{completedCount} из {totalCount}</strong>
                    </div>

                    <div className="flex justify-between items-center text-xs text-neutral-400">
                      <span>Формат выпуска:</span>
                      <span className="text-neutral-300 font-semibold uppercase text-[10px] bg-neutral-950 px-2 py-0.5 rounded-md border border-neutral-800">
                        {project.releaseType || 'Закадр'}
                      </span>
                    </div>

                    {project.updatedAt && (
                      <div className="flex items-center gap-1 text-[11px] text-neutral-500">
                        <Calendar className="w-3 h-3" />
                        <span>Архивирован: {new Date(project.updatedAt).toLocaleDateString('ru-RU')}</span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-3 border-t border-neutral-800" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => {
                        onProjectSelect(project.id);
                        onNavigate('dashboard');
                      }}
                      className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
                      <span>Открыть</span>
                    </button>

                    <button
                      onClick={(e) => handleRestoreProject(project, e)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 rounded-lg text-xs font-bold transition-all border border-amber-500/10 cursor-pointer"
                      title="Вернуть тайтл в список активных проектов"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Вернуть</span>
                    </button>

                    <button
                      onClick={(e) => handleDeleteProject(project, e)}
                      className="p-1.5 bg-neutral-800/50 hover:bg-red-950/20 text-neutral-500 hover:text-red-400 hover:border-red-900/30 border border-transparent rounded-lg transition-all cursor-pointer"
                      title="Безвозвратно удалить проект"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="py-20 text-center bg-neutral-900/10 border border-dashed border-neutral-800 rounded-3xl space-y-4 max-w-xl mx-auto">
          <Archive className="w-12 h-12 text-neutral-600 mx-auto" />
          <h3 className="text-lg font-bold text-neutral-300">В архиве пока ничего нет</h3>
          <p className="text-neutral-500 text-xs px-6 leading-relaxed">
            Здесь будут отображаться ваши завершенные или дропнутые проекты. 
            Чтобы отправить проект в архив, воспользуйтесь кнопкой со значком архива на главной панели.
          </p>
        </div>
      )}
    </div>
  );
}
