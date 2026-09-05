import React, { useState, useEffect } from 'react';
import { 
  Search, 
  Send, 
  CheckCircle2, 
  ExternalLink, 
  Eye, 
  Share2, 
  Calendar, 
  Sparkles, 
  RefreshCw, 
  Copy, 
  Check, 
  AlertCircle,
  Radio,
  FileCheck
} from 'lucide-react';
import { toast } from 'sonner';
import { ipcSafe } from '../../lib/ipcSafe';
import { Episode, Project, TelegramMTProtoDialog } from '../../types';
import { TelegramPostSearchResult } from './types';

interface TelegramPostVerifyTabProps {
  currentProject?: Project | null;
  currentEpisode?: Episode | null;
  dialogs: TelegramMTProtoDialog[];
  defaultChannelId?: string;
  onRefreshProjects?: () => void;
}

export const TelegramPostVerifyTab: React.FC<TelegramPostVerifyTabProps> = ({
  currentProject,
  currentEpisode,
  dialogs,
  defaultChannelId = '',
  onRefreshProjects
}) => {
  // Only channel dialogs
  const channelDialogs = dialogs.filter(d => d.isChannel || d.type === 'channel');

  const [selectedChannelId, setSelectedChannelId] = useState<string>(() => {
    if (defaultChannelId) return defaultChannelId;
    if (currentProject?.links) {
      try {
        const links = typeof currentProject.links === 'string' ? JSON.parse(currentProject.links) : currentProject.links;
        if (links?.tg) return links.tg;
      } catch {}
    }
    return channelDialogs.length > 0 ? channelDialogs[0].id : '';
  });

  const [customChannelPeer, setCustomChannelPeer] = useState<string>('');
  const [isCustomPeer, setIsCustomPeer] = useState<boolean>(false);

  // Search query initialized with project title & episode
  const defaultQuery = currentProject?.title 
    ? `${currentProject.title} ${currentEpisode?.number || ''}`.trim() 
    : '';
  const [searchQuery, setSearchQuery] = useState<string>(defaultQuery);

  const [foundPosts, setFoundPosts] = useState<TelegramPostSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [hasSearched, setHasSearched] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [linkedPostId, setLinkedPostId] = useState<number | null>(null);

  const handleSearchPosts = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const targetPeer = isCustomPeer ? customChannelPeer.trim() : selectedChannelId;
    if (!targetPeer) {
      toast.error('Выберите канал для проверки');
      return;
    }

    setIsSearching(true);
    setHasSearched(true);
    try {
      const res = await ipcSafe.invoke('telegram-mtproto-search-posts', {
        channelId: targetPeer,
        query: searchQuery.trim(),
        limit: 50
      });

      if (res && res.success && Array.isArray(res.posts)) {
        setFoundPosts(res.posts);
        if (res.posts.length > 0) {
          toast.success(`Найдено ${res.posts.length} публикаций в канале!`);
        } else {
          toast.info('Публикаций по данному запросу пока не найдено в канале');
        }
      } else {
        throw new Error(res?.error || 'Не удалось выполнить поиск');
      }
    } catch (err: any) {
      toast.error(`Ошибка поиска постов: ${err.message || String(err)}`);
    } finally {
      setIsSearching(false);
    }
  };

  const handleCopyLink = (post: TelegramPostSearchResult) => {
    navigator.clipboard.writeText(post.link);
    setCopiedId(post.id);
    toast.success('Ссылка на пост скопирована в буфер обмена');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleLinkPostToEpisode = async (post: TelegramPostSearchResult) => {
    if (!currentEpisode) {
      toast.error('Серия не выбрана');
      return;
    }

    try {
      await ipcSafe.invoke('save-episode', {
        ...currentEpisode,
        tgPostLink: post.link,
        status: 'FINISHED' as const
      });

      setLinkedPostId(post.id);
      toast.success(`Пост успешно привязан! Серия #${currentEpisode.number} отмечена как выложенная 🎉`);
      if (onRefreshProjects) onRefreshProjects();
    } catch (err: any) {
      toast.error(`Не удалось сохранить статус: ${err.message || String(err)}`);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-neutral-950 text-white overflow-hidden select-none">
      {/* Top Controls Toolbar */}
      <div className="bg-neutral-900 border-b border-neutral-800 p-4 space-y-3 flex-shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <FileCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Автопроверка постинга в канале
              </h3>
              <p className="text-[11px] text-neutral-400">
                Поиск опубликованных серий в вашем Telegram-канале с автоматической привязкой ссылок и завершением релиза
              </p>
            </div>
          </div>

          {currentEpisode?.tgPostLink && (
            <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-950/80 border border-emerald-800/60 rounded-xl text-emerald-300 text-xs font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Текущая ссылка:</span>
              <a
                href={currentEpisode.tgPostLink}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-emerald-400 hover:underline max-w-[160px] truncate"
              >
                {currentEpisode.tgPostLink}
              </a>
            </div>
          )}
        </div>

        {/* Channel & Search Form */}
        <form onSubmit={handleSearchPosts} className="grid grid-cols-1 md:grid-cols-12 gap-2 pt-1">
          <div className="md:col-span-5 flex items-center gap-2">
            {!isCustomPeer ? (
              <select
                value={selectedChannelId}
                onChange={(e) => setSelectedChannelId(e.target.value)}
                className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:border-emerald-500 outline-none transition"
              >
                {channelDialogs.length === 0 && (
                  <option value="">Каналы загружаются или отсутствуют в аккаунте...</option>
                )}
                {channelDialogs.map(d => (
                  <option key={d.id} value={d.id}>
                    📢 {d.title} ({d.id})
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={customChannelPeer}
                onChange={(e) => setCustomChannelPeer(e.target.value)}
                placeholder="Юзернейм канала (напр. @akaneproject)"
                className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:border-emerald-500 outline-none transition font-mono"
              />
            )}

            <button
              type="button"
              onClick={() => setIsCustomPeer(!isCustomPeer)}
              className="px-2.5 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs rounded-xl transition flex-shrink-0 cursor-pointer border border-neutral-700"
              title="Переключить между списком каналов и вводом @username"
            >
              {isCustomPeer ? 'Из списка' : 'Ввести @юзернейм'}
            </button>
          </div>

          <div className="md:col-span-5 relative">
            <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поисковый запрос (название аниме или номер серии)..."
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl pl-8 pr-3 py-2 text-xs text-white focus:border-emerald-500 outline-none transition"
            />
          </div>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={isSearching}
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1.5 shadow-md shadow-emerald-950/40 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSearching ? 'animate-spin' : ''}`} />
              <span>{isSearching ? 'Поиск...' : 'Проверить постинг'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Results Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isSearching ? (
          <div className="h-64 flex flex-col items-center justify-center text-neutral-500 space-y-3">
            <RefreshCw className="w-8 h-8 animate-spin text-emerald-500" />
            <p className="text-xs">Идёт поиск постов в Telegram-канале...</p>
          </div>
        ) : foundPosts.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-neutral-500 space-y-3 border border-dashed border-neutral-800 rounded-2xl p-6 text-center">
            <FileCheck className="w-10 h-10 text-neutral-700" />
            <div>
              <p className="text-sm font-semibold text-neutral-300">
                {hasSearched ? 'Посты не найдены' : 'Проверьте публикацию серии'}
              </p>
              <p className="text-xs text-neutral-500 max-w-md mt-1">
                {hasSearched
                  ? 'Попробуйте изменить поисковый запрос или выбрать другой канал.'
                  : 'Выберите канал, нажмите «Проверить постинг», и приложение найдёт пост с серией, позволит скопировать ссылку или одним кликом отметить серию завершённой.'}
              </p>
            </div>
          </div>
        ) : (
          foundPosts.map(post => {
            const isLinked = linkedPostId === post.id || currentEpisode?.tgPostLink === post.link;

            return (
              <div
                key={post.id}
                className={`bg-neutral-900 border rounded-xl p-4 transition space-y-3 ${
                  isLinked
                    ? 'border-emerald-500/60 bg-emerald-950/20 shadow-md shadow-emerald-950/30'
                    : 'border-neutral-800 hover:border-neutral-700'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="px-2 py-0.5 rounded-lg bg-neutral-950 border border-neutral-800 text-[11px] font-mono text-sky-400 font-bold">
                      Пост #{post.id}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-neutral-400">
                      <Calendar className="w-3 h-3 text-neutral-500" />
                      {post.dateFormatted}
                    </span>
                    {typeof post.views === 'number' && (
                      <span className="flex items-center gap-1 text-[11px] text-neutral-400">
                        <Eye className="w-3 h-3 text-neutral-500" />
                        {post.views.toLocaleString()}
                      </span>
                    )}
                    {typeof post.forwards === 'number' && (
                      <span className="flex items-center gap-1 text-[11px] text-neutral-400">
                        <Share2 className="w-3 h-3 text-neutral-500" />
                        {post.forwards}
                      </span>
                    )}
                  </div>

                  {isLinked && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800/60 text-[11px] font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      Привязан к текущей серии
                    </span>
                  )}
                </div>

                {/* Post snippet */}
                <div className="bg-neutral-950 border border-neutral-800/80 rounded-xl p-3 text-xs text-neutral-300 font-mono whitespace-pre-line leading-relaxed max-h-48 overflow-y-auto select-text">
                  {post.text || '(Медиа-сообщение без текста)'}
                </div>

                {/* Bottom Actions */}
                <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
                  <a
                    href={post.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-sky-400 hover:underline flex items-center gap-1 max-w-sm truncate"
                  >
                    <span>{post.link}</span>
                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                  </a>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCopyLink(post)}
                      className="px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs rounded-xl transition flex items-center gap-1 border border-neutral-700 cursor-pointer"
                    >
                      {copiedId === post.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400">Скопировано!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-neutral-400" />
                          <span>Скопировать ссылку</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => handleLinkPostToEpisode(post)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer shadow-sm ${
                        isLinked
                          ? 'bg-emerald-950 border border-emerald-500/50 text-emerald-300'
                          : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/40'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{isLinked ? 'Выложено ✓' : 'Привязать и отметить: Всё выложено!'}</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
