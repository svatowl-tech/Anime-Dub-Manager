import React, { useState } from 'react';
import { 
  Send, 
  Paperclip, 
  Calendar, 
  Pin, 
  BellOff, 
  Sparkles, 
  Copy, 
  Layers, 
  RefreshCw, 
  FileText, 
  Image as ImageIcon,
  CheckCircle2,
  X
} from 'lucide-react';
import { toast } from 'sonner';
import { ipcSafe } from '../../lib/ipcSafe';
import { Episode, Project, ProjectLinks, TelegramMTProtoDialog } from '../../types';

interface TelegramComposerTabProps {
  currentProject?: Project | null;
  currentEpisode?: Episode | null;
  dialogs: TelegramMTProtoDialog[];
  defaultChannelId: string;
  headerTemplate: string;
  footerTemplate: string;
}

export const TelegramComposerTab: React.FC<TelegramComposerTabProps> = ({
  currentProject,
  currentEpisode,
  dialogs,
  defaultChannelId,
  headerTemplate,
  footerTemplate
}) => {
  const getParsedLinks = (): ProjectLinks => {
    if (!currentProject?.links) return {};
    if (typeof currentProject.links === 'object') return currentProject.links as ProjectLinks;
    try {
      return JSON.parse(currentProject.links);
    } catch {
      return {};
    }
  };

  const projectLinks = getParsedLinks();
  const [targetPeer, setTargetPeer] = useState<string>(
    projectLinks.tg || defaultChannelId || ''
  );
  const [postText, setPostText] = useState<string>('');
  const [mediaPath, setMediaPath] = useState<string>('');
  const [isSilent, setIsSilent] = useState<boolean>(false);
  const [isPin, setIsPin] = useState<boolean>(false);
  const [isScheduled, setIsScheduled] = useState<boolean>(false);
  const [scheduleDate, setScheduleDate] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);

  const generateTemplate = () => {
    const titleRu = currentProject?.title || 'Название тайтла';
    const titleEn = currentProject?.originalTitle || '';
    const epNum = currentEpisode?.number ? String(currentEpisode.number) : '1';
    const siteLink = projectLinks.anime365 || 'https://smotret-anime.com';
    const tgGroup = projectLinks.tgGroup || '@akane_chat';

    const header = (headerTemplate || '✨ <b>{title_ru}</b> [{episode_number} СЕРИЯ]')
      .replace('{title_ru}', titleRu)
      .replace('{episode_number}', epNum)
      .replace('{title_en}', titleEn);

    const footer = (footerTemplate || '📌 Смотреть: {site_link}\n💬 Обсуждение: {tg_group}')
      .replace('{site_link}', siteLink)
      .replace('{tg_group}', tgGroup);

    const body = `🎬 <b>Вышла новая ${epNum}-я серия!</b>\n\n📺 <b>Качество:</b> 1080p Full HD\n\n${footer}`;

    setPostText(`${header}\n\n${body}`);
    toast.success('Шаблон анонса сгенерирован');
  };

  const handleSelectMedia = async () => {
    try {
      const res = await ipcSafe.invoke('select-file', {
        title: 'Выберите изображение или видео для поста',
        filters: [{ name: 'Медиа', extensions: ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mkv', 'mp3'] }]
      });
      if (res && typeof res === 'string') {
        setMediaPath(res);
      } else if (res && res.filePath) {
        setMediaPath(res.filePath);
      }
    } catch (e) {
      console.warn('File selection fallback:', e);
    }
  };

  const handleSendPost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetPeer.trim()) {
      toast.error('Укажите целевой канал (@channel_name или -100...)');
      return;
    }
    if (!postText.trim()) {
      toast.error('Введите текст публикации');
      return;
    }

    setIsSending(true);
    try {
      const res = await ipcSafe.invoke('telegram-mtproto-send-post', {
        targetPeer: targetPeer.trim(),
        text: postText.trim(),
        mediaPath: mediaPath.trim() || undefined,
        silent: isSilent,
        pin: isPin,
        scheduleDate: isScheduled && scheduleDate ? scheduleDate : undefined,
        parseMode: 'html'
      });

      if (res && res.success) {
        toast.success(isScheduled ? 'Пост успешно запланирован!' : 'Пост успешно опубликован в канале!');
        if (!isScheduled) {
          setPostText('');
          setMediaPath('');
        }
      } else {
        throw new Error(res?.error || 'Ошибка публикации');
      }
    } catch (err: any) {
      toast.error(err.message || 'Ошибка отправки поста в Telegram');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-neutral-950">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header & Quick Action */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-lg flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <FileText className="w-5 h-5 text-sky-400" />
              Конструктор и публикация релизных постов
            </h2>
            <p className="text-xs text-neutral-400 mt-1">
              Форматирование HTML, медиа-файлы, отложенный постинг и авто-закрепление в Telegram каналах
            </p>
          </div>

          <button
            type="button"
            onClick={generateTemplate}
            className="px-3.5 py-2 bg-neutral-800 hover:bg-neutral-700 text-sky-300 hover:text-white rounded-xl text-xs font-semibold border border-neutral-700 transition flex items-center gap-2 cursor-pointer shadow-sm"
          >
            <Sparkles className="w-4 h-4 text-sky-400" />
            Сгенерировать по текущему релизу
          </button>
        </div>

        {/* Composer Form */}
        <form onSubmit={handleSendPost} className="space-y-4">
          {/* Target Peer Selector */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-3">
            <label className="block text-xs font-semibold text-neutral-300">
              Целевой канал / Чат назначения
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={targetPeer}
                onChange={(e) => setTargetPeer(e.target.value)}
                placeholder="@my_anime_channel или ID"
                required
                className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm text-white font-mono focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none transition"
              />

              {dialogs.length > 0 && (
                <select
                  onChange={(e) => {
                    if (e.target.value) setTargetPeer(e.target.value);
                  }}
                  className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2.5 text-xs text-neutral-300 outline-none focus:border-sky-500 transition cursor-pointer max-w-[200px]"
                >
                  <option value="">Выбрать из моих каналов...</option>
                  {dialogs.map((d) => (
                    <option key={d.id} value={d.username ? `@${d.username}` : d.id}>
                      {d.title} ({d.type})
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Text Editor */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-neutral-300">
                Текст публикации (поддерживаются теги &lt;b&gt;, &lt;i&gt;, &lt;code&gt;, &lt;a href="..."&gt;)
              </label>
              
              {/* Quick HTML Formatting Badges */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPostText(prev => `${prev}<b>Жирный текст</b>`)}
                  className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-[11px] font-bold text-neutral-300 rounded cursor-pointer"
                >
                  B
                </button>
                <button
                  type="button"
                  onClick={() => setPostText(prev => `${prev}<i>Курсив</i>`)}
                  className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-[11px] italic text-neutral-300 rounded cursor-pointer"
                >
                  I
                </button>
                <button
                  type="button"
                  onClick={() => setPostText(prev => `${prev}<code>Код</code>`)}
                  className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-[11px] font-mono text-neutral-300 rounded cursor-pointer"
                >
                  Code
                </button>
              </div>
            </div>

            <textarea
              value={postText}
              onChange={(e) => setPostText(e.target.value)}
              rows={8}
              placeholder="Введите текст публикации..."
              required
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3.5 text-sm text-white font-mono focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none transition resize-y"
            />
          </div>

          {/* Media & Options Bar */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-2">
                Прикрепленный медиафайл (Постер / Тизер / Аудио / Видео)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={mediaPath}
                  onChange={(e) => setMediaPath(e.target.value)}
                  placeholder="Путь к файлу на диске или выберите через обзор..."
                  className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:border-sky-500 outline-none"
                />
                <button
                  type="button"
                  onClick={handleSelectMedia}
                  className="px-3.5 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-xl text-xs font-medium border border-neutral-700 flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Paperclip className="w-3.5 h-3.5" />
                  Обзор...
                </button>
                {mediaPath && (
                  <button
                    type="button"
                    onClick={() => setMediaPath('')}
                    className="p-2.5 bg-neutral-800 hover:bg-red-950/80 text-neutral-400 hover:text-red-400 rounded-xl transition cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Toggles */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-neutral-800">
              <label className="flex items-center gap-2 bg-neutral-950 p-2.5 rounded-xl border border-neutral-800/80 cursor-pointer hover:border-neutral-700 transition">
                <input
                  type="checkbox"
                  checked={isPin}
                  onChange={(e) => setIsPin(e.target.checked)}
                  className="rounded text-sky-600 focus:ring-sky-500"
                />
                <Pin className="w-4 h-4 text-amber-400" />
                <span className="text-xs text-neutral-300 font-medium">Закрепить пост</span>
              </label>

              <label className="flex items-center gap-2 bg-neutral-950 p-2.5 rounded-xl border border-neutral-800/80 cursor-pointer hover:border-neutral-700 transition">
                <input
                  type="checkbox"
                  checked={isSilent}
                  onChange={(e) => setIsSilent(e.target.checked)}
                  className="rounded text-sky-600 focus:ring-sky-500"
                />
                <BellOff className="w-4 h-4 text-purple-400" />
                <span className="text-xs text-neutral-300 font-medium">Без звука</span>
              </label>

              <label className="flex items-center gap-2 bg-neutral-950 p-2.5 rounded-xl border border-neutral-800/80 cursor-pointer hover:border-neutral-700 transition">
                <input
                  type="checkbox"
                  checked={isScheduled}
                  onChange={(e) => setIsScheduled(e.target.checked)}
                  className="rounded text-sky-600 focus:ring-sky-500"
                />
                <Calendar className="w-4 h-4 text-emerald-400" />
                <span className="text-xs text-neutral-300 font-medium">Отложенная отправка</span>
              </label>
            </div>

            {isScheduled && (
              <div className="pt-2">
                <label className="block text-xs font-semibold text-emerald-400 mb-1.5">
                  Дата и время публикации в Telegram
                </label>
                <input
                  type="datetime-local"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  required
                  className="bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2 text-xs text-white focus:border-emerald-500 outline-none"
                />
              </div>
            )}
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSending}
            className="w-full py-3.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold rounded-2xl text-sm transition shadow-xl flex items-center justify-center gap-2 cursor-pointer"
          >
            {isSending ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Публикация в канал...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                {isScheduled ? 'Запланировать публикацию' : 'Опубликовать пост прямо сейчас'}
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
