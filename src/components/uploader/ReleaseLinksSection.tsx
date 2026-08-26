import React from 'react';
import { Link2, Save, Edit3, Trash2, Plus, Globe } from 'lucide-react';
import { Episode, ProjectLinks, QuickUploadLink } from '../../types';

interface ReleaseLinksSectionProps {
  currentEpisode: Episode | null;
  projectLinks: ProjectLinks;
  setProjectLinks: (links: ProjectLinks) => void;
  quickLinks: QuickUploadLink[];
  setQuickLinks: (links: QuickUploadLink[]) => void;
  isEditingQuickLinks: boolean;
  setIsEditingQuickLinks: (val: boolean) => void;
  tgPostLink: string;
  setTgPostLink: (link: string) => void;
  vkPostLink: string;
  setVkPostLink: (link: string) => void;
  isSavingLinks: boolean;
  handleSavePlatformLinks: () => void;
  handleSelectQuickLink: (q: QuickUploadLink, idx: number) => void;
}

export const ReleaseLinksSection: React.FC<ReleaseLinksSectionProps> = ({
  currentEpisode,
  projectLinks,
  setProjectLinks,
  quickLinks,
  setQuickLinks,
  isEditingQuickLinks,
  setIsEditingQuickLinks,
  tgPostLink,
  setTgPostLink,
  vkPostLink,
  setVkPostLink,
  isSavingLinks,
  handleSavePlatformLinks,
  handleSelectQuickLink
}) => {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3.5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-blue-400" />
          <h3 className="text-xs font-semibold text-white">Ссылки релиза и БД</h3>
        </div>
        <button
          onClick={handleSavePlatformLinks}
          disabled={isSavingLinks}
          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition flex items-center gap-1.5 shadow cursor-pointer"
        >
          <Save className="w-3.5 h-3.5" />
          <span>{isSavingLinks ? 'Сохранение...' : 'Сохранить в БД'}</span>
        </button>
      </div>

      <div className="space-y-2 text-xs">
        <div>
          <label className="text-neutral-400 block mb-1">Telegram Канал (Проект)</label>
          <input
            type="text"
            value={projectLinks.tg || ''}
            onChange={(e) => setProjectLinks({ ...projectLinks, tg: e.target.value })}
            placeholder="https://t.me/..."
            className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-neutral-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="text-neutral-400 block mb-1">VK Видео / Группа (Проект)</label>
          <input
            type="text"
            value={projectLinks.vk || ''}
            onChange={(e) => setProjectLinks({ ...projectLinks, vk: e.target.value })}
            placeholder="https://vk.com/..."
            className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-neutral-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-neutral-400 block mb-1">Anime 365</label>
            <input
              type="text"
              value={projectLinks.anime365 || ''}
              onChange={(e) => setProjectLinks({ ...projectLinks, anime365: e.target.value })}
              placeholder="https://anime365.ru/..."
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1.5 text-neutral-200 focus:outline-none text-[11px]"
            />
          </div>
          <div>
            <label className="text-neutral-400 block mb-1">Kodik</label>
            <input
              type="text"
              value={projectLinks.kodik || ''}
              onChange={(e) => setProjectLinks({ ...projectLinks, kodik: e.target.value })}
              placeholder="https://kodik.cc/..."
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1.5 text-neutral-200 focus:outline-none text-[11px]"
            />
          </div>
          <div>
            <label className="text-neutral-400 block mb-1">Shikimori</label>
            <input
              type="text"
              value={projectLinks.shikimori || ''}
              onChange={(e) => setProjectLinks({ ...projectLinks, shikimori: e.target.value })}
              placeholder="https://shikimori.one/..."
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1.5 text-neutral-200 focus:outline-none text-[11px]"
            />
          </div>
        </div>

        {/* Quick Upload Buttons */}
        <div className="pt-2 border-t border-neutral-800/80 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-purple-400 block text-[11px]">Быстрые кнопки загрузки:</span>
            <button
              type="button"
              onClick={() => setIsEditingQuickLinks(!isEditingQuickLinks)}
              className="text-[10px] text-neutral-400 hover:text-neutral-200 flex items-center gap-1 bg-neutral-950 px-2 py-0.5 rounded border border-neutral-800 cursor-pointer"
            >
              <Edit3 className="w-3 h-3 text-purple-400" />
              <span>{isEditingQuickLinks ? 'Готово' : 'Настроить'}</span>
            </button>
          </div>

          {isEditingQuickLinks ? (
            <div className="space-y-2 bg-neutral-950 p-2 rounded-lg border border-neutral-800">
              {quickLinks.map((ql, idx) => (
                <div key={idx} className="flex gap-1.5 items-center">
                  <input
                    type="text"
                    value={ql.name || ql.title || ''}
                    onChange={(e) => {
                      const next = [...quickLinks];
                      next[idx] = { ...next[idx], name: e.target.value, title: e.target.value };
                      setQuickLinks(next);
                    }}
                    className="w-1/3 bg-neutral-900 border border-neutral-800 px-2 py-1 rounded text-[11px] text-white"
                    placeholder="Название"
                  />
                  <input
                    type="text"
                    value={ql.url}
                    onChange={(e) => {
                      const next = [...quickLinks];
                      next[idx] = { ...next[idx], url: e.target.value };
                      setQuickLinks(next);
                    }}
                    className="flex-1 bg-neutral-900 border border-neutral-800 px-2 py-1 rounded text-[11px] text-white"
                    placeholder="https://..."
                  />
                  <button
                    type="button"
                    onClick={() => setQuickLinks(quickLinks.filter((_, i) => i !== idx))}
                    className="p-1 text-neutral-500 hover:text-red-400 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setQuickLinks([...quickLinks, { id: `q_${Date.now()}`, title: 'Ссылка', name: 'Ссылка', url: 'https://' }])}
                className="text-[10px] font-bold text-purple-400 flex items-center gap-1 hover:underline pt-1 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                Добавить кнопку
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {quickLinks.map((q, idx) => {
                const linkName = q.name || q.title || `Ссылка ${idx + 1}`;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSelectQuickLink(q, idx)}
                    className="px-2 py-1 bg-purple-950/40 hover:bg-purple-900/60 border border-purple-800/50 text-purple-200 rounded-lg text-[11px] font-medium transition flex items-center gap-1 shadow-sm cursor-pointer"
                    title={`Открыть ${q.url} в браузере панели (и отметить в чек-листе)`}
                  >
                    <Globe className="w-3 h-3 text-purple-400" />
                    <span>{linkName}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="pt-2 border-t border-neutral-800/80 space-y-2">
          <span className="font-semibold text-emerald-400 block">Ссылки на пост серии #{currentEpisode?.number || '?'}:</span>
          
          <div>
            <label className="text-neutral-400 block mb-1">Пост в Telegram серии</label>
            <input
              type="text"
              value={tgPostLink}
              onChange={(e) => setTgPostLink(e.target.value)}
              placeholder="https://t.me/channel/123"
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-neutral-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="text-neutral-400 block mb-1">Пост VK серии</label>
            <input
              type="text"
              value={vkPostLink}
              onChange={(e) => setVkPostLink(e.target.value)}
              placeholder="https://vk.com/wall-..."
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-neutral-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
