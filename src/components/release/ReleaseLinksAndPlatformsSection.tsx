import React from 'react';
import {
  Send,
  Globe,
  Sparkles,
  Link2,
  Save,
  Edit3,
  Plus,
  Trash2,
  Check,
  X
} from 'lucide-react';
import { Episode, QuickUploadLink, ProjectLinks } from '../../types';
import { DEFAULT_QUICK_LINKS } from './useReleasePanelController';

export interface ReleaseTemplateCardItem {
  name: string;
  icon: React.ReactNode;
  color: string;
  generate: () => string;
  type: 'TG' | 'VK' | 'FINAL_TG' | 'TG_ARTICLE';
}

export interface ReleaseLinksAndPlatformsSectionProps {
  currentEpisode: Episode;
  tgPostLink: string;
  setTgPostLink: React.Dispatch<React.SetStateAction<string>>;
  vkPostLink: string;
  setVkPostLink: React.Dispatch<React.SetStateAction<string>>;
  isSavingLinks: boolean;
  handleSaveEpisodePostLinks: () => Promise<void>;
  isEditingQuickLinks: boolean;
  setIsEditingQuickLinks: React.Dispatch<React.SetStateAction<boolean>>;
  quickLinks: QuickUploadLink[];
  setQuickLinks: React.Dispatch<React.SetStateAction<QuickUploadLink[]>>;
  handleSaveLinks: () => Promise<void>;
  handleOpenExternal: (url: string, e: React.MouseEvent) => Promise<void>;
  templates: ReleaseTemplateCardItem[];
  activeTemplate: 'TG' | 'VK' | 'FINAL_TG' | 'TG_ARTICLE' | null;
  setActiveTemplate: React.Dispatch<React.SetStateAction<'TG' | 'VK' | 'FINAL_TG' | 'TG_ARTICLE' | null>>;
  setPostContent: React.Dispatch<React.SetStateAction<string>>;
  handleQuickAutoFill: () => Promise<void>;
  isAutoFillingLinks: boolean;
  setIsAnimeSourcesModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  linksTemplateStr: string;
  setLinksTemplateStr: React.Dispatch<React.SetStateAction<string>>;
  isEditingLinksTemplate: boolean;
  setIsEditingLinksTemplate: React.Dispatch<React.SetStateAction<boolean>>;
  handleSaveLinksTemplate: (isGlobal: boolean) => Promise<void>;
  handleTextareaKeyDown: (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    setValue: React.Dispatch<React.SetStateAction<string>>
  ) => void;
  autoFillFeedback: string | null;
  setAutoFillFeedback: React.Dispatch<React.SetStateAction<string | null>>;
  links: ProjectLinks;
  setLinks: React.Dispatch<React.SetStateAction<ProjectLinks>>;
  updateLinksAndSync: (newLinks: ProjectLinks) => void;
}

export function ReleaseLinksAndPlatformsSection({
  currentEpisode,
  tgPostLink,
  setTgPostLink,
  vkPostLink,
  setVkPostLink,
  isSavingLinks,
  handleSaveEpisodePostLinks,
  isEditingQuickLinks,
  setIsEditingQuickLinks,
  quickLinks,
  setQuickLinks,
  handleSaveLinks,
  handleOpenExternal,
  templates,
  activeTemplate,
  setActiveTemplate,
  setPostContent,
  handleQuickAutoFill,
  isAutoFillingLinks,
  setIsAnimeSourcesModalOpen,
  linksTemplateStr,
  setLinksTemplateStr,
  isEditingLinksTemplate,
  setIsEditingLinksTemplate,
  handleSaveLinksTemplate,
  handleTextareaKeyDown,
  autoFillFeedback,
  setAutoFillFeedback,
  links,
  setLinks,
  updateLinksAndSync
}: ReleaseLinksAndPlatformsSectionProps) {
  return (
    <>
      {/* Episode Post Links section */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-xl mb-6">
        <div className="p-4 border-b border-neutral-800 bg-neutral-900/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-bold text-white uppercase tracking-wider">Ссылки на посты этой серии</span>
          </div>
          <button
            onClick={handleSaveEpisodePostLinks}
            disabled={isSavingLinks}
            className="flex items-center gap-2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all"
          >
            <Save className="w-3.5 h-3.5" />
            {isSavingLinks ? 'Сохранение...' : 'Сохранить ссылки поста'}
          </button>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest flex items-center gap-2">
              Ссылка на пост TG
              <span className="text-neutral-700 normal-case font-mono italic">({'{prevLinkTg}'} для след. серии)</span>
            </label>
            <input
              type="text"
              value={tgPostLink}
              onChange={(e) => setTgPostLink(e.target.value)}
              className="w-full bg-black/50 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all font-mono"
              placeholder="https://t.me/your_channel/123"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest flex items-center gap-2">
              Ссылка на пост VK
              <span className="text-neutral-700 normal-case font-mono italic">({'{prevLinkVk}'} для след. серии)</span>
            </label>
            <input
              type="text"
              value={vkPostLink}
              onChange={(e) => setVkPostLink(e.target.value)}
              className="w-full bg-black/50 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all font-mono"
              placeholder="https://vk.com/wall-123_456"
            />
          </div>
        </div>
      </div>

      {/* Quick Upload Links Section */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-neutral-800 bg-neutral-900/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-bold text-white uppercase tracking-wider">Быстрые ссылки для загрузки</span>
          </div>
          {!isEditingQuickLinks && (
            <button
              onClick={() => setIsEditingQuickLinks(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-bold transition-all border border-neutral-700/50"
              title="Настроить быстрые ссылки для загрузки"
            >
              <Edit3 className="w-3.5 h-3.5 text-purple-400" />
              <span>Настроить кнопки</span>
            </button>
          )}
        </div>
        
        {isEditingQuickLinks ? (
          <div className="p-6 space-y-4 bg-neutral-900/40">
            <div className="space-y-3">
              {quickLinks.map((item, index) => (
                <div key={index} className="flex flex-col sm:flex-row gap-3 items-start sm:items-center bg-black/20 p-3 rounded-xl border border-neutral-800/80">
                  <span className="text-xs font-mono text-neutral-500 w-5 text-center">{index + 1}</span>
                  <div className="flex-1 w-full space-y-1">
                    <label className="text-[9px] font-bold text-neutral-500 uppercase tracking-wider">Название</label>
                    <input
                      type="text"
                      value={item.name}
                      onChange={(e) => {
                        const next = [...quickLinks];
                        next[index] = { ...next[index], name: e.target.value };
                        setQuickLinks(next);
                      }}
                      placeholder="Напр., TG Загрузка"
                      className="w-full bg-black/40 border border-neutral-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                  </div>
                  <div className="flex-[2] w-full space-y-1">
                    <label className="text-[9px] font-bold text-neutral-500 uppercase tracking-wider">Ссылка для перехода</label>
                    <input
                      type="text"
                      value={item.url}
                      onChange={(e) => {
                        const next = [...quickLinks];
                        next[index] = { ...next[index], url: e.target.value };
                        setQuickLinks(next);
                      }}
                      placeholder="https://..."
                      className="w-full bg-black/40 border border-neutral-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                  </div>
                  <button
                    onClick={() => {
                      setQuickLinks(quickLinks.filter((_, i) => i !== index));
                    }}
                    className="p-2 text-neutral-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors mt-4 sm:mt-0"
                    title="Удалить ссылку"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            
            <div className="flex items-center justify-between pt-2 border-t border-neutral-800/60">
              <button
                onClick={() => {
                  setQuickLinks([...quickLinks, { name: 'Новая ссылка', url: 'https://' }]);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-850 hover:bg-neutral-800 text-purple-400 hover:text-purple-300 rounded-lg text-xs font-bold transition-all border border-neutral-800"
              >
                <Plus className="w-3.5 h-3.5" />
                Добавить кнопку
              </button>
              
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setIsEditingQuickLinks(false);
                    if (currentEpisode?.project?.links) {
                      try {
                        const parsed = JSON.parse(currentEpisode.project.links);
                        setQuickLinks(parsed.quickUploadLinks || DEFAULT_QUICK_LINKS);
                      } catch {
                        setQuickLinks(DEFAULT_QUICK_LINKS);
                      }
                    } else {
                      setQuickLinks(DEFAULT_QUICK_LINKS);
                    }
                  }}
                  className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-bold transition-all"
                >
                  Отмена
                </button>
                <button
                  onClick={async () => {
                    await handleSaveLinks();
                    setIsEditingQuickLinks(false);
                  }}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold transition-all"
                >
                  <Check className="w-3.5 h-3.5" />
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {quickLinks.map((linkItem, idx) => (
              <a 
                key={idx}
                href={linkItem.url} 
                onClick={(e) => handleOpenExternal(linkItem.url, e)}
                className="flex flex-col items-center gap-2 p-4 bg-black/30 border border-neutral-800 rounded-xl hover:bg-purple-600/10 hover:border-purple-500/50 transition-all group text-center"
              >
                <Globe className="w-6 h-6 text-purple-400 group-hover:scale-110 transition-transform" />
                <span className="text-xs font-bold text-white truncate max-w-full text-ellipsis overflow-hidden">{linkItem.name}</span>
              </a>
            ))}
            {quickLinks.length === 0 && (
              <div className="col-span-full py-6 text-center text-neutral-500 italic text-xs">
                Быстрые ссылки не настроены. Нажмите на "Настроить кнопки" в правом верхнем углу, чтобы настроить их.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Templates Selector Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {templates.map((tpl) => (
          <button
            key={tpl.type}
            onClick={() => {
              setPostContent(tpl.generate());
              setActiveTemplate(tpl.type);
            }}
            className={`p-6 rounded-2xl border transition-all flex flex-col items-center gap-4 text-center ${
              activeTemplate === tpl.type 
                ? 'bg-neutral-900 border-purple-500/50 shadow-lg shadow-purple-500/10' 
                : 'bg-neutral-900/50 border-neutral-800 hover:border-neutral-700'
            }`}
          >
            <div className={`p-4 rounded-full ${tpl.color}/20 text-white`}>
              {tpl.icon}
            </div>
            <div>
              <h3 className="font-bold text-white">{tpl.name}</h3>
              <p className="text-xs text-neutral-500 mt-1">Сгенерировать по шаблону</p>
            </div>
          </button>
        ))}
      </div>

      {/* Platform Links Section */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-neutral-800 bg-neutral-900/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-bold text-white uppercase tracking-wider">Ссылки на платформы</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleQuickAutoFill}
              disabled={isAutoFillingLinks}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg text-xs font-bold transition-all shadow-md shadow-purple-500/20 disabled:opacity-50"
              title="Автоматически найти Kodik, Shikimori, AniLibria, Jut.su ссылки"
            >
              <Sparkles className={`w-3.5 h-3.5 ${isAutoFillingLinks ? 'animate-spin' : ''}`} />
              <span>{isAutoFillingLinks ? 'Ищем ссылки...' : 'Магический автопоиск'}</span>
            </button>

            <button
              onClick={() => setIsAnimeSourcesModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-lg text-xs font-bold transition-all"
              title="Открыть хаб видео, субтитров и аниме-источников"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Хаб источников</span>
            </button>

            <button
              onClick={() => {
                setLinksTemplateStr(currentEpisode?.linksTemplate || currentEpisode?.project?.linksTemplate || '');
                setIsEditingLinksTemplate(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-bold transition-all border border-neutral-700/50"
              title="Настроить шаблон для блока ссылок"
            >
              <Edit3 className="w-3.5 h-3.5 text-purple-400" />
              <span>Шаблон ссылок</span>
            </button>
            <button
              onClick={handleSaveLinks}
              disabled={isSavingLinks}
              className="flex items-center gap-2 px-4 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all"
            >
              <Save className="w-3.5 h-3.5" />
              {isSavingLinks ? 'Сохранение...' : 'Сохранить ссылки'}
            </button>
          </div>
        </div>

        {autoFillFeedback && (
          <div className="p-3 bg-purple-500/10 border-b border-purple-500/20 text-xs font-semibold text-purple-300 flex items-center justify-between animate-in fade-in">
            <span className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-400" />
              {autoFillFeedback}
            </span>
            <button onClick={() => setAutoFillFeedback(null)} className="text-neutral-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        
        {isEditingLinksTemplate && (
          <div className="p-6 bg-neutral-900 border-b border-neutral-800 space-y-4">
             <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Шаблон блока ссылок</label>
                <div className="flex gap-2">
                   <button 
                    onClick={() => setIsEditingLinksTemplate(false)}
                    className="px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-white rounded text-xs"
                   >
                     Отмена
                   </button>
                   <button 
                    onClick={() => handleSaveLinksTemplate(false)}
                    className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs"
                   >
                     Для этой серии
                   </button>
                   <button 
                    onClick={() => handleSaveLinksTemplate(true)}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs"
                   >
                     Для всего проекта
                   </button>
                </div>
             </div>
             <textarea
                value={linksTemplateStr}
                onChange={e => setLinksTemplateStr(e.target.value)}
                onKeyDown={e => handleTextareaKeyDown(e, setLinksTemplateStr)}
                className="w-full bg-black/50 border border-neutral-800 rounded-xl p-4 text-xs text-neutral-300 font-mono leading-relaxed min-h-[120px] focus:outline-none focus:ring-1 focus:ring-purple-500/50"
                placeholder="Шаблон ссылок, напр.: {linkAnime365}\n{linkTg}..."
             />
             <div className="flex flex-wrap gap-2">
               {Object.keys(links).filter(k => k !== 'quickUploadLinks').map(key => (
                 <button
                   key={key}
                   onClick={() => setLinksTemplateStr(prev => prev + `{link${key.charAt(0).toUpperCase() + key.slice(1)}}`)}
                   className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-[9px] text-neutral-400 rounded border border-neutral-700 font-mono"
                 >
                   {'{link'}{key.charAt(0).toUpperCase() + key.slice(1)}{'}'}
                 </button>
               ))}
             </div>
          </div>
        )}
        
        <div className="p-6 space-y-4">
          <div className="flex flex-wrap gap-4 items-end">
            {Object.keys(links).filter(k => k !== 'quickUploadLinks').map((key, index) => (
              <div key={`link-card-${key}-${index}`} className="flex-1 min-w-[280px] space-y-2 bg-neutral-900/40 p-4 rounded-xl border border-neutral-800/60 relative group">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex flex-col">
                    <input 
                      type="text" 
                      defaultValue={key} 
                      key={`key-input-${key}`}
                      onBlur={(e) => {
                        const newKey = e.target.value.replace(/[^a-zA-Z0-9]/g, '');
                        if (!newKey || newKey === key) {
                          e.target.value = key;
                          return;
                        }
                        const newLinks = { ...links };
                        newLinks[newKey] = newLinks[key];
                        delete newLinks[key];
                        updateLinksAndSync(newLinks);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      className="bg-transparent border-none text-[10px] font-bold text-neutral-500 uppercase tracking-widest focus:outline-none focus:text-purple-400 w-full"
                      placeholder="Ключ (лат.)"
                    />
                    <span className="text-[8px] text-neutral-700 font-mono italic">Переменная: {'{link'}{key.charAt(0).toUpperCase() + key.slice(1)}{'}'}</span>
                  </div>
                  <button 
                    onClick={() => {
                      const newLinks = { ...links };
                      delete newLinks[key];
                      updateLinksAndSync(newLinks);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-neutral-600 hover:text-red-400 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <input
                  type="text"
                  value={links[key] || ''}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    const nextLinks = { ...links, [key]: newValue };
                    updateLinksAndSync(nextLinks);
                  }}
                  className="w-full bg-black/50 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
                  placeholder="Ссылка или текст"
                />
              </div>
            ))}
            
            <button
              onClick={() => {
                let newKey = 'newPlatform';
                let i = 1;
                while (links[newKey]) {
                  newKey = `platform${i++}`;
                }
                setLinks({ ...links, [newKey]: '' });
              }}
              className="flex items-center gap-2 px-6 py-6 bg-neutral-950/40 border border-dashed border-neutral-800 rounded-xl text-neutral-600 hover:text-purple-400 hover:border-purple-500/50 hover:bg-purple-500/5 transition-all text-sm font-bold flex-1 min-w-[280px] h-[88px] justify-center"
            >
              <Plus className="w-4 h-4" />
              <span>Добавить платформу</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
