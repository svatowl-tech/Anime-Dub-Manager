import React, { useState } from 'react';
import { 
  MessageSquare, 
  Send, 
  X, 
  Save, 
  RefreshCw, 
  Hash, 
  Layers 
} from 'lucide-react';
import { toast } from 'sonner';
import { ipcSafe } from '../../lib/ipcSafe';
import { Project, ProjectLinks } from '../../types';

interface ProjectChatModalProps {
  project: Project | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export const ProjectChatModal: React.FC<ProjectChatModalProps> = ({
  project,
  isOpen,
  onClose,
  onSaved
}) => {
  const getParsedLinks = (): ProjectLinks => {
    if (!project?.links) return {};
    if (typeof project.links === 'object') return project.links as ProjectLinks;
    try {
      return JSON.parse(project.links);
    } catch {
      return {};
    }
  };

  const initialLinks = getParsedLinks();
  const [channel, setChannel] = useState<string>(initialLinks.tg || '');
  const [group, setGroup] = useState<string>(initialLinks.tgGroup || '');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  if (!isOpen || !project) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const updatedLinks: ProjectLinks = {
        ...initialLinks,
        tg: channel.trim(),
        tgGroup: group.trim()
      };

      const updatedProject = {
        ...project,
        links: JSON.stringify(updatedLinks)
      };

      await ipcSafe.invoke('save-project', updatedProject);
      toast.success(`Чаты для тайтла «${project.title}» сохранены`);
      if (onSaved) onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Ошибка сохранения чатов проекта');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-fadeIn">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-scaleIn">
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-sky-400" />
            <h3 className="text-sm font-bold text-white">
              Telegram-чаты проекта: {project.title}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSave} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-neutral-300 mb-1.5 flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5 text-sky-400" />
              Официальный релизный канал (@channel_name или ID)
            </label>
            <input
              type="text"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              placeholder="@akane_releases"
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:border-sky-500 outline-none"
            />
            <p className="text-[11px] text-neutral-500 mt-1">
              Сюда будут автоматически публиковаться анонсы новых серий
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-300 mb-1.5 flex items-center gap-1.5">
              <Hash className="w-3.5 h-3.5 text-amber-400" />
              Рабочая беседа даберов и команды (@group или ID)
            </label>
            <input
              type="text"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              placeholder="@akane_team_chat"
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:border-amber-500 outline-none"
            />
            <p className="text-[11px] text-neutral-500 mt-1">
              Сюда отправляются напоминания по дедлайнам и списки правок
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-neutral-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-neutral-400 hover:text-white rounded-xl hover:bg-neutral-800 transition cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs transition shadow-md flex items-center gap-1.5 cursor-pointer"
            >
              {isSaving ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Сохранение...
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  Сохранить
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
