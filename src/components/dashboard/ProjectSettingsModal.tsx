import React, { useState, useEffect } from 'react';
import { X, Save, Search, Loader2, Check, Folder, Globe, Hash, Calendar, MessageSquare, Sparkles, Image as ImageIcon } from 'lucide-react';
import { Project, Episode } from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';
import { searchAnime, getAnimeDetails } from '../../services/animeService';
import { toast } from 'sonner';

interface ProjectSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
  currentEpisode?: Episode | null;
  onSave: () => void;
}

export default function ProjectSettingsModal({
  isOpen,
  onClose,
  project,
  currentEpisode,
  onSave
}: ProjectSettingsModalProps) {
  const [title, setTitle] = useState(project.title || '');
  const [originalTitle, setOriginalTitle] = useState(project.originalTitle || '');
  const [posterUrl, setPosterUrl] = useState(project.posterUrl || '');
  const [synopsis, setSynopsis] = useState(project.synopsis || '');
  const [totalEpisodes, setTotalEpisodes] = useState(project.totalEpisodes || 12);
  const [emoji, setEmoji] = useState(project.emoji || '❤️');
  const [typeAndSeason, setTypeAndSeason] = useState(project.typeAndSeason || '');
  const [tgReleaseChannelId, setTgReleaseChannelId] = useState(project.tgReleaseChannelId || '');
  const [tgWorkGroupId, setTgWorkGroupId] = useState(project.tgWorkGroupId || '');

  // Links JSON state
  const defaultLinks = { anime365: '', tg: '', kodik: '', vk: '', shikimori: '' };
  const initialParsedLinks = (() => {
    try {
      return { ...defaultLinks, ...JSON.parse(project.links || '{}') };
    } catch (e) {
      return defaultLinks;
    }
  })();
  const [links, setLinks] = useState<Record<string, string>>(initialParsedLinks);

  // Search anime DB state
  const [animeSearchQuery, setAnimeSearchQuery] = useState(project.title || '');
  const [animeSearchResults, setAnimeSearchResults] = useState<any[]>([]);
  const [isSearchingAnime, setIsSearchingAnime] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTitle(project.title || '');
      setOriginalTitle(project.originalTitle || '');
      setPosterUrl(project.posterUrl || '');
      setSynopsis(project.synopsis || '');
      setTotalEpisodes(project.totalEpisodes || 12);
      setEmoji(project.emoji || '❤️');
      setTypeAndSeason(project.typeAndSeason || '');
      setTgReleaseChannelId(project.tgReleaseChannelId || '');
      setTgWorkGroupId(project.tgWorkGroupId || '');
      setAnimeSearchQuery(project.title || '');
      try {
        setLinks({ ...defaultLinks, ...JSON.parse(project.links || '{}') });
      } catch (e) {
        setLinks(defaultLinks);
      }
    }
  }, [isOpen, project]);

  if (!isOpen) return null;

  const handleSearchAnime = async () => {
    const q = animeSearchQuery.trim();
    if (!q) return;
    setIsSearchingAnime(true);
    try {
      const results = await searchAnime(q);
      setAnimeSearchResults(results || []);
      if (!results || results.length === 0) {
        toast.info('По вашему запросу ничего не найдено в аниме-базе');
      }
    } catch (e) {
      console.error('Anime DB search error:', e);
      toast.error('Ошибка при поиске в аниме-базе');
    } finally {
      setIsSearchingAnime(false);
    }
  };

  const handleSelectAnime = async (anime: any) => {
    setTitle(anime.title || title);
    if (anime.original_title) {
      setOriginalTitle(anime.original_title);
    }
    if (anime.image) {
      setPosterUrl(anime.image);
    }
    if (anime.episodes && anime.episodes > 0) {
      setTotalEpisodes(anime.episodes);
    }
    if (anime.type) {
      setTypeAndSeason(anime.type);
    }

    try {
      const details = await getAnimeDetails(anime.id || anime.mal_id, anime.source || 'shikimori');
      if (details) {
        if (details.description) {
          setSynopsis(details.description);
        }
        if (details.original_title) {
          setOriginalTitle(details.original_title);
        }
        if (details.episodes && details.episodes > 0) {
          setTotalEpisodes(details.episodes);
        }
      }
    } catch (e) {
      console.warn('Failed to load anime details:', e);
    }

    setAnimeSearchResults([]);
    toast.success(`Данные релиза успешно синхронизированы с бабой: "${anime.title}"`);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast.error('Название проекта не может быть пустым');
      return;
    }

    setIsSaving(true);
    try {
      const updatedProject: Project = {
        ...project,
        title: trimmedTitle,
        originalTitle: originalTitle.trim() || undefined,
        posterUrl: posterUrl.trim() || undefined,
        synopsis: synopsis.trim() || undefined,
        totalEpisodes: Number(totalEpisodes) || 12,
        emoji: emoji.trim() || '❤️',
        typeAndSeason: typeAndSeason.trim() || undefined,
        tgReleaseChannelId: tgReleaseChannelId.trim() || undefined,
        tgWorkGroupId: tgWorkGroupId.trim() || undefined,
        links: JSON.stringify(links),
        updatedAt: new Date().toISOString()
      };

      await ipcSafe.invoke('save-project', updatedProject);
      toast.success(`Название релиза обновлено: "${trimmedTitle}"`);
      onSave();
      onClose();
    } catch (err) {
      console.error('Failed to save project settings:', err);
      toast.error('Не удалось сохранить изменения проекта');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden my-8">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/60">
          <div className="flex items-center gap-2.5">
            <Folder className="w-5 h-5 text-blue-500" />
            <h2 className="text-lg font-bold text-white">Настройки релиза и базы аниме</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {/* Section: Search Anime Database (Shikimori / MAL) */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-blue-950/40 via-indigo-950/30 to-purple-950/20 border border-blue-500/30 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
                <Search className="w-4 h-4 text-blue-400" /> Найти и связать с аниме-базой
              </span>
            </div>
            <p className="text-xs text-neutral-300 leading-relaxed">
              Найдите нужный сезон или тайтл в базе (Shikimori/MAL), чтобы автоматически подтянуть официальное русское и оригинальное названия, постер, количество серий и описания для корректного поиска субтитров и торрентов.
            </p>

            <div className="flex gap-2">
              <input
                type="text"
                value={animeSearchQuery}
                onChange={(e) => setAnimeSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSearchAnime(); } }}
                placeholder="Введите название (напр. Фрирен 1 сезон / Frieren)"
                className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={handleSearchAnime}
                disabled={isSearchingAnime}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {isSearchingAnime ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Найти
              </button>
            </div>

            {/* Results List */}
            {animeSearchResults.length > 0 && (
              <div className="space-y-2 mt-3 max-h-52 overflow-y-auto pr-1">
                <div className="text-xs font-medium text-neutral-400">Выберите нужный тайтл / сезон:</div>
                {animeSearchResults.map((anime) => (
                  <div
                    key={anime.id || anime.mal_id}
                    onClick={() => handleSelectAnime(anime)}
                    className="flex items-center gap-3 p-2.5 rounded-lg cursor-pointer bg-neutral-950/80 border border-neutral-800 hover:border-blue-500/50 hover:bg-neutral-800/60 text-neutral-200 transition-all group"
                  >
                    {anime.image ? (
                      <img
                        src={anime.image}
                        alt={anime.title}
                        className="w-10 h-14 object-cover rounded bg-neutral-900 flex-shrink-0"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-10 h-14 bg-neutral-900 rounded flex items-center justify-center text-xs text-neutral-600 flex-shrink-0">
                        🎬
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white group-hover:text-blue-400 transition-colors truncate">
                        {anime.title}
                      </div>
                      <div className="text-xs text-neutral-400 font-mono truncate">
                        {anime.original_title || anime.title} {anime.type ? `(${anime.type})` : ''} • {anime.episodes || '?'} эп.
                      </div>
                      {anime.status && (
                        <div className="text-[11px] text-neutral-500 truncate">
                          Статус: {anime.status}
                        </div>
                      )}
                    </div>
                    <span className="text-xs font-medium text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">
                      Выбрать →
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Title Inputs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-1">
                Название проекта / релиза (рус.) <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Например: Фрирен: Провожающая в последний путь"
                required
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-1">
                Оригинальное / Англ. название (для поиска)
              </label>
              <input
                type="text"
                value={originalTitle}
                onChange={(e) => setOriginalTitle(e.target.value)}
                placeholder="Например: Sousou no Frieren / Frieren"
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Project Params Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1">
                Эмодзи
              </label>
              <input
                type="text"
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                placeholder="❤️, ⚡, ❄️..."
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1">
                Тип и сезон
              </label>
              <input
                type="text"
                value={typeAndSeason}
                onChange={(e) => setTypeAndSeason(e.target.value)}
                placeholder="TV1, Movie, OVA..."
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1">
                Всего серий
              </label>
              <input
                type="number"
                min={1}
                value={totalEpisodes}
                onChange={(e) => setTotalEpisodes(parseInt(e.target.value) || 1)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Poster & Synopsis */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1">
                URL постера
              </label>
              <input
                type="text"
                value={posterUrl}
                onChange={(e) => setPosterUrl(e.target.value)}
                placeholder="https://..."
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1">
                Описание / Синопсис
              </label>
              <textarea
                value={synopsis}
                onChange={(e) => setSynopsis(e.target.value)}
                rows={3}
                placeholder="Описание сюжета релиза..."
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none"
              />
            </div>
          </div>

          {/* Telegram Integration Section */}
          <div className="bg-sky-950/20 border border-sky-800/40 p-4 rounded-xl space-y-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-sky-400" />
              <span className="text-xs font-bold text-sky-300 uppercase tracking-wider">Telegram-Чаты Проекта</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-neutral-300 mb-1">
                  📢 Канал публикации серий:
                </label>
                <input
                  type="text"
                  placeholder="@akaneproject_channel"
                  value={tgReleaseChannelId}
                  onChange={(e) => setTgReleaseChannelId(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg py-1.5 px-3 text-xs text-white font-mono focus:border-sky-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-neutral-300 mb-1">
                  💬 Рабочий чат команды:
                </label>
                <input
                  type="text"
                  placeholder="@akaneproject_team"
                  value={tgWorkGroupId}
                  onChange={(e) => setTgWorkGroupId(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg py-1.5 px-3 text-xs text-white font-mono focus:border-sky-500 outline-none"
                />
              </div>
            </div>
          </div>

          {/* Platform Links */}
          <div>
            <label className="block text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">
              Ссылки на платформы
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.entries(links).map(([key, value]) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-neutral-500 uppercase w-16 truncate">{key}</span>
                  <input
                    type="text"
                    placeholder="https://..."
                    value={value}
                    onChange={(e) => setLinks({ ...links, [key]: e.target.value })}
                    className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg py-1.5 px-2.5 text-xs text-white focus:border-blue-500 outline-none"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-neutral-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-neutral-400 hover:text-white transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-blue-600/20 disabled:opacity-50"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Сохранить изменения
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
