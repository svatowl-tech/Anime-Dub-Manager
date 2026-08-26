import React, { useState } from 'react';
import { Sparkles, X, Save } from 'lucide-react';
import { Episode } from '../../../types';
import { ipcSafe } from '../../../lib/ipcSafe';
import { getTemplateString } from '../../../lib/templates';
import { toast } from 'sonner';

interface TemplateEditorModalProps {
  currentEpisode: Episode | null;
  onClose: () => void;
  onSaved: (type: 'TG' | 'VK' | 'FINAL_TG') => void;
}

export const TemplateEditorModal: React.FC<TemplateEditorModalProps> = ({
  currentEpisode,
  onClose,
  onSaved
}) => {
  const [modalTemplateType, setModalTemplateType] = useState<'TG' | 'VK' | 'FINAL_TG'>('TG');
  const [modalTemplateSource, setModalTemplateSource] = useState<string>(() => {
    return currentEpisode ? getTemplateString(currentEpisode, 'TG') : '';
  });

  const handleModalTemplateTypeChange = (type: 'TG' | 'VK' | 'FINAL_TG') => {
    setModalTemplateType(type);
    if (currentEpisode) {
      setModalTemplateSource(getTemplateString(currentEpisode, type));
    }
  };

  const handleSaveTemplateToDB = async (isGlobalProject: boolean) => {
    if (!currentEpisode || !currentEpisode.project) return;
    
    try {
      const propMap: Record<string, string> = {
        'TG': 'tgPostTemplate',
        'VK': 'vkPostTemplate',
        'FINAL_TG': 'finalTgPostTemplate'
      };
      const propName = propMap[modalTemplateType];

      if (isGlobalProject) {
        await ipcSafe.invoke('save-project', {
          ...currentEpisode.project,
          [propName]: modalTemplateSource
        });
        toast.success(`Шаблон сохранен для всего проекта: ${currentEpisode.project.title}`);
      } else {
        await ipcSafe.invoke('save-episode', {
          ...currentEpisode,
          [propName]: modalTemplateSource
        });
        toast.success(`Шаблон сохранен для ${currentEpisode.number} серии`);
      }

      onSaved(modalTemplateType);
      onClose();
    } catch (e: any) {
      toast.error('Ошибка сохранения шаблона: ' + (e.message || e));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        <div className="px-5 py-3.5 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/90">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <h3 className="font-bold text-white text-sm">Настройка исходного шаблона</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-neutral-800 rounded-lg text-neutral-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto min-h-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-400">Тип шаблона:</span>
            <div className="flex items-center gap-1 bg-neutral-950 p-1 rounded-lg border border-neutral-800 text-xs">
              <button
                onClick={() => handleModalTemplateTypeChange('TG')}
                className={`px-3 py-1 rounded font-medium cursor-pointer ${
                  modalTemplateType === 'TG' ? 'bg-sky-600 text-white' : 'text-neutral-400 hover:text-white'
                }`}
              >
                Telegram
              </button>
              <button
                onClick={() => handleModalTemplateTypeChange('VK')}
                className={`px-3 py-1 rounded font-medium cursor-pointer ${
                  modalTemplateType === 'VK' ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:text-white'
                }`}
              >
                ВКонтакте
              </button>
              <button
                onClick={() => handleModalTemplateTypeChange('FINAL_TG')}
                className={`px-3 py-1 rounded font-medium cursor-pointer ${
                  modalTemplateType === 'FINAL_TG' ? 'bg-emerald-600 text-white' : 'text-neutral-400 hover:text-white'
                }`}
              >
                Итог TG
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-neutral-300 block mb-1.5">Код шаблона с тегами:</label>
            <textarea
              value={modalTemplateSource}
              onChange={(e) => setModalTemplateSource(e.target.value)}
              rows={9}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3 text-xs text-neutral-100 font-mono focus:outline-none focus:ring-1 focus:ring-amber-500 resize-y"
            />
          </div>

          {/* Variable tags insertion */}
          <div className="space-y-1.5 text-xs">
            <span className="text-neutral-400 block font-medium">Быстрая вставка тегов:</span>
            <div className="flex flex-wrap gap-1.5">
              {[
                '{title}', '{episodeNumber}', '{totalEpisodes}', '{releaseTypeLabel}', 
                '{progress}', '{seName}', '{seMention}', '{platformLinks}', 
                '{projectSlug}', '{linkTg}', '{linkVk}', '{linkAnime365}', '{linkKodik}'
              ].map(tag => (
                <button
                  key={tag}
                  onClick={() => setModalTemplateSource(prev => prev + tag)}
                  className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-xs font-mono border border-neutral-700/50 cursor-pointer"
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-neutral-800 bg-neutral-950 flex items-center justify-between gap-2 flex-wrap">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-xl text-xs font-medium transition cursor-pointer"
          >
            Отмена
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleSaveTemplateToDB(false)}
              className="px-3.5 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-xl text-xs font-medium transition border border-neutral-700 flex items-center gap-1.5 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5 text-purple-400" />
              <span>Для серии #{currentEpisode?.number}</span>
            </button>
            <button
              onClick={() => handleSaveTemplateToDB(true)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-medium transition shadow flex items-center gap-1.5 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Для всего проекта</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
