import React, { useState, useEffect } from 'react';
import { X, Save, Pencil } from 'lucide-react';
import { Project, Episode } from '../../types';
import { DEFAULT_START_EPISODE_TEMPLATE, DEFAULT_SOUND_ENGINEER_TEMPLATE, DEFAULT_FIXES_ISSUED_TEMPLATE, DEFAULT_STATUS_TEMPLATE, getTemplateVariables, applyTemplate } from '../../lib/templates';

interface NotificationTemplatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
  latestEpisode?: Episode; // To show previews
  onSaveProject: (projectId: string, updates: Partial<Project>) => void;
}

export function NotificationTemplatesModal({ isOpen, onClose, project, latestEpisode, onSaveProject }: NotificationTemplatesModalProps) {
  const [activeTab, setActiveTab] = useState<'START' | 'STATUS' | 'FIXES' | 'SE'>('START');
  
  const [startMsg, setStartMsg] = useState(project.startMessageTemplate || DEFAULT_START_EPISODE_TEMPLATE);
  const [statusMsg, setStatusMsg] = useState(project.statusMessageTemplate || DEFAULT_STATUS_TEMPLATE);
  const [fixesMsg, setFixesMsg] = useState(project.fixesMessageTemplate || DEFAULT_FIXES_ISSUED_TEMPLATE);
  const [seMsg, setSeMsg] = useState(project.soundEngineerMessageTemplate || DEFAULT_SOUND_ENGINEER_TEMPLATE);

  useEffect(() => {
    if (isOpen) {
      setStartMsg(project.startMessageTemplate || DEFAULT_START_EPISODE_TEMPLATE);
      setStatusMsg(project.statusMessageTemplate || DEFAULT_STATUS_TEMPLATE);
      setFixesMsg(project.fixesMessageTemplate || DEFAULT_FIXES_ISSUED_TEMPLATE);
      setSeMsg(project.soundEngineerMessageTemplate || DEFAULT_SOUND_ENGINEER_TEMPLATE);
    }
  }, [isOpen, project]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSaveProject(project.id, {
      startMessageTemplate: startMsg,
      statusMessageTemplate: statusMsg,
      fixesMessageTemplate: fixesMsg,
      soundEngineerMessageTemplate: seMsg,
    });
    onClose();
  };

  const currentTemplate = activeTab === 'START' ? startMsg : activeTab === 'STATUS' ? statusMsg : activeTab === 'FIXES' ? fixesMsg : seMsg;
  const setCurrentTemplate = activeTab === 'START' ? setStartMsg : activeTab === 'STATUS' ? setStatusMsg : activeTab === 'FIXES' ? setFixesMsg : setSeMsg;

  // Generate preview
  let preview = '';
  if (latestEpisode) {
    // Generate mock vars
    const mockVars = getTemplateVariables(latestEpisode, [], 'https://disk.yandex.ru/d/mock-folder');
    
    // Add fake data if missing
    if (!mockVars.dubberMentions || mockVars.dubberMentions === '• Даберы не назначены') {
      mockVars.dubberMentions = 'Дабер 1 (@da)\nДабер 2 (@da2)';
    }
    if (!mockVars.roadsMentions || mockVars.roadsMentions === '• Все сдано!') mockVars.roadsMentions = '• @da';
    if (!mockVars.fixesMentions || mockVars.fixesMentions === '• Фиксов нет!') mockVars.fixesMentions = '• @da';
    if (!mockVars.dubberFixesSections) mockVars.dubberFixesSections = 'Дабер 1 (@da):\n🔹 Персонаж 1:\n  • [01:23] Фикс тут\n\nДабер 2 (@da2):\n🔹 Персонаж 2:\n  • [02:34] Фикс там';

    preview = applyTemplate(currentTemplate, mockVars);
  } else {
    preview = 'Нет серий для предпросмотра';
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="p-6 border-b border-neutral-800 flex items-center justify-between shrink-0 bg-neutral-900">
          <div>
            <h2 className="text-xl font-bold text-white mb-1">Шаблоны уведомлений</h2>
            <p className="text-sm text-neutral-400">Настройте шаблоны сообщений для проекта</p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex border-b border-neutral-800">
          {(['START', 'STATUS', 'FIXES', 'SE'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-3 text-sm font-bold text-center border-b-2 transition-colors ${
                activeTab === tab ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {tab === 'START' && 'Старт серии'}
              {tab === 'STATUS' && 'Статус серии'}
              {tab === 'FIXES' && 'Напоминание о фиксах'}
              {tab === 'SE' && 'Для звукорежиссера'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          <div className="w-full md:w-1/2 p-6 flex flex-col border-r border-neutral-800/50">
            <div className="flex items-center gap-2 mb-4">
              <Pencil className="w-4 h-4 text-neutral-400" />
              <span className="text-sm font-bold uppercase tracking-wider text-neutral-300">Шаблон</span>
            </div>
            <textarea
              value={currentTemplate}
              onChange={(e) => setCurrentTemplate(e.target.value)}
              className="flex-1 w-full bg-neutral-950 border border-neutral-800 rounded-xl p-4 text-sm text-white resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500 custom-scrollbar font-mono leading-relaxed"
              placeholder="Напишите шаблон..."
            />
            
            <div className="mt-4 bg-blue-900/20 border border-blue-500/20 p-4 rounded-xl text-xs text-blue-200 overflow-y-auto max-h-[200px] custom-scrollbar space-y-2">
              <p className="font-bold text-sm text-blue-300">Поддерживаемые переменные:</p>
              <ul className="list-disc list-inside opacity-90 space-y-1">
                <li><code className="text-white">{"{emoji}"}</code> — Эмодзи проекта</li>
                <li><code className="text-white">{"{title}"}</code> — Название тайтла</li>
                <li><code className="text-white">{"{episodeNumber}"}</code> — Номер серии</li>
                <li><code className="text-white">{"{deadline}"}</code> — Дедлайн</li>
                {activeTab === 'START' && (
                  <>
                    <li><code className="text-white">{"{yandexSection}"}</code> — Текст со ссылкой на папку (если есть)</li>
                    <li><code className="text-white">{"{dubberMentions}"}</code> — Список даберов с тегами и кол-вом реплик</li>
                  </>
                )}
                {activeTab === 'STATUS' && (
                  <>
                    <li><code className="text-white">{"{roadsMentions}"}</code> — Кто не сдал дорожки</li>
                    <li><code className="text-white">{"{fixesMentions}"}</code> — У кого висят недоделанные фиксы</li>
                  </>
                )}
                {activeTab === 'FIXES' && (
                  <li><code className="text-white">{"{dubberFixesSections}"}</code> — Списки фиксов по даберам и персонажам</li>
                )}
                {activeTab === 'SE' && (
                  <li><code className="text-white">{"{yandexUrl}"}</code> — Ссылка на папку</li>
                )}
              </ul>
            </div>
          </div>
          
          <div className="w-full md:w-1/2 p-6 flex flex-col bg-neutral-950/30">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm font-bold uppercase tracking-wider text-neutral-300">Предпросмотр (На последней серии)</span>
            </div>
            <div className="flex-1 w-full bg-neutral-900 border border-neutral-800 rounded-xl p-4 text-sm text-neutral-300 overflow-y-auto custom-scrollbar leading-relaxed whitespace-pre-wrap">
              {preview}
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-neutral-800 shrink-0 bg-neutral-900 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-lg text-sm font-bold text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-bold transition-colors shadow-lg shadow-indigo-500/20"
          >
            <Save className="w-4 h-4" />
            Сохранить шаблоны проекта
          </button>
        </div>
      </div>
    </div>
  );
}
