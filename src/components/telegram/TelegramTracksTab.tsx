import React, { useState, useEffect } from 'react';
import { 
  Download, 
  RefreshCw, 
  Music, 
  Mic, 
  Archive, 
  CheckCircle2, 
  Clock, 
  User, 
  Folder, 
  AlertCircle, 
  Send,
  MessageSquare,
  Search,
  ExternalLink,
  Copy,
  Check
} from 'lucide-react';
import { toast } from 'sonner';
import { ipcSafe } from '../../lib/ipcSafe';
import { Episode, Project, TelegramMTProtoDialog } from '../../types';
import { TelegramAudioFileItem } from './types';

interface TelegramTracksTabProps {
  currentProject?: Project | null;
  currentEpisode?: Episode | null;
  allProjects?: Project[];
  dialogs: TelegramMTProtoDialog[];
  onRefreshProjects?: () => void;
}

export const TelegramTracksTab: React.FC<TelegramTracksTabProps> = ({
  currentProject,
  currentEpisode,
  allProjects,
  dialogs,
  onRefreshProjects
}) => {
  const [selectedChatId, setSelectedChatId] = useState<string>(() => {
    if (currentProject?.links) {
      try {
        const links = typeof currentProject.links === 'string' ? JSON.parse(currentProject.links) : currentProject.links;
        if (links?.tgGroup) return links.tgGroup;
      } catch {}
    }
    return dialogs.length > 0 ? dialogs[0].id : '';
  });

  const [customChatPeer, setCustomChatPeer] = useState<string>('');
  const [isCustomPeer, setIsCustomPeer] = useState<boolean>(false);

  const [audioFiles, setAudioFiles] = useState<TelegramAudioFileItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [downloadingIds, setDownloadingIds] = useState<Record<number, boolean>>({});
  const [downloadedPaths, setDownloadedPaths] = useState<Record<number, string>>({});
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [fileTypeFilter, setFileTypeFilter] = useState<'all' | 'audio' | 'voice' | 'archive'>('all');

  const activeChat = dialogs.find(d => d.id === selectedChatId);

  useEffect(() => {
    if (selectedChatId && !isCustomPeer) {
      handleFetchAudioFiles();
    }
  }, [selectedChatId]);

  const handleFetchAudioFiles = async () => {
    const targetPeer = isCustomPeer ? customChatPeer.trim() : selectedChatId;
    if (!targetPeer) {
      toast.error('Выберите или укажите чат для поиска аудиодорожек');
      return;
    }

    setIsLoading(true);
    try {
      const res = await ipcSafe.invoke('telegram-mtproto-get-audio-files', {
        chatId: targetPeer,
        limit: 100
      });

      if (res && res.success && Array.isArray(res.files)) {
        setAudioFiles(res.files);
        toast.success(`Найдено ${res.files.length} аудиодорожек и файлов`);
      } else {
        throw new Error(res?.error || 'Не удалось получить файлы');
      }
    } catch (err: any) {
      toast.error(`Ошибка загрузки дорожек: ${err.message || String(err)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadTrack = async (fileItem: TelegramAudioFileItem) => {
    const targetPeer = isCustomPeer ? customChatPeer.trim() : selectedChatId;
    if (!targetPeer) return;

    setDownloadingIds(prev => ({ ...prev, [fileItem.id]: true }));
    try {
      toast.info(`Скачивание "${fileItem.fileName}"...`);
      const res = await ipcSafe.invoke('telegram-mtproto-download-audio', {
        chatId: targetPeer,
        messageId: fileItem.id,
        customFileName: fileItem.fileName
      });

      if (res && res.success && res.filePath) {
        setDownloadedPaths(prev => ({ ...prev, [fileItem.id]: res.filePath }));
        toast.success(`Файл сохранен: ${res.fileName}`);
      } else {
        throw new Error(res?.error || 'Ошибка скачивания');
      }
    } catch (err: any) {
      toast.error(`Не удалось скачать: ${err.message || String(err)}`);
    } finally {
      setDownloadingIds(prev => ({ ...prev, [fileItem.id]: false }));
    }
  };

  const handleOpenFolder = async (filePath: string) => {
    try {
      await ipcSafe.invoke('show-item-in-folder', filePath);
    } catch {
      toast.info(`Путь к файлу: ${filePath}`);
    }
  };

  const handleMarkDubberTrackReceived = async (fileItem: TelegramAudioFileItem) => {
    if (!currentEpisode) {
      toast.error('Серия не выбрана');
      return;
    }

    try {
      // Find assignment matching this dubber
      const dubberName = fileItem.sender.name.toLowerCase();
      const dubberUsername = fileItem.sender.username.toLowerCase();

      const assignments = currentEpisode.assignments || [];
      const matched = assignments.find(a => {
        const nick = (a.dubber?.nickname || '').toLowerCase();
        return (
          nick &&
          (dubberName.includes(nick) ||
            dubberUsername.includes(nick) ||
            nick.includes(dubberName) ||
            nick.includes(dubberUsername))
        );
      });

      if (matched) {
        const updated = assignments.map(a =>
          a.id === matched.id ? { ...a, status: 'DONE' as const } : a
        );
        await ipcSafe.invoke('save-episode', {
          ...currentEpisode,
          assignments: updated
        });
        toast.success(`Дорожка дабера ${matched.dubber?.nickname} отмечена как сданная!`);
        if (onRefreshProjects) onRefreshProjects();
      } else {
        toast.success(`Дорожка от ${fileItem.sender.name} принята!`);
      }
    } catch (e: any) {
      toast.error('Не удалось обновить статус дорожки');
    }
  };

  const filteredFiles = audioFiles.filter(item => {
    if (fileTypeFilter === 'voice' && !item.isVoice) return false;
    if (fileTypeFilter === 'audio' && item.isVoice) return false;
    if (
      fileTypeFilter === 'archive' &&
      !item.fileName.toLowerCase().match(/\.(zip|rar|7z|tar|gz)$/)
    )
      return false;

    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    return (
      item.fileName.toLowerCase().includes(q) ||
      item.sender.name.toLowerCase().includes(q) ||
      item.sender.username.toLowerCase().includes(q) ||
      (item.caption && item.caption.toLowerCase().includes(q))
    );
  });

  return (
    <div className="flex-1 flex flex-col h-full bg-neutral-950 text-white overflow-hidden select-none">
      {/* Top Controls Toolbar */}
      <div className="bg-neutral-900 border-b border-neutral-800 p-4 space-y-3 flex-shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-violet-500/10 border border-violet-500/30 flex items-center justify-center text-violet-400">
              <Music className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Автозагрузка и приём дорожек озвучки
              </h3>
              <p className="text-[11px] text-neutral-400">
                Мониторинг присланных аудиофайлов (.wav, .mp3, архивов) из рабочего чата даберов
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleFetchAudioFiles}
              disabled={isLoading}
              className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-md shadow-violet-950/40 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>{isLoading ? 'Сканирование чата...' : 'Сканировать дорожки'}</span>
            </button>
          </div>
        </div>

        {/* Chat / Peer Selector Bar */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-1">
          <div className="md:col-span-2 flex items-center gap-2">
            {!isCustomPeer ? (
              <select
                value={selectedChatId}
                onChange={(e) => setSelectedChatId(e.target.value)}
                className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:border-violet-500 outline-none transition"
              >
                {dialogs.length === 0 && <option value="">Чаты загружаются или отсутствуют...</option>}
                {dialogs.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.isChannel ? '📢' : d.isGroup ? '👥' : '👤'} {d.title} ({d.id})
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={customChatPeer}
                onChange={(e) => setCustomChatPeer(e.target.value)}
                placeholder="Юзернейм или ID чата (напр. @voice_team_chat)"
                className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:border-violet-500 outline-none transition font-mono"
              />
            )}

            <button
              onClick={() => setIsCustomPeer(!isCustomPeer)}
              className="px-2.5 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs rounded-xl transition flex-shrink-0 cursor-pointer border border-neutral-700"
              title="Переключить между выбором из списка и ручным вводом @username"
            >
              {isCustomPeer ? 'Выбрать из диалогов' : 'Ввести @username'}
            </button>
          </div>

          {/* Search within files */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Поиск по даберу или имени файла..."
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl pl-8 pr-3 py-2 text-xs text-white focus:border-violet-500 outline-none transition"
            />
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-2 pt-0.5">
          <span className="text-[11px] text-neutral-400 font-medium">Фильтр:</span>
          {(['all', 'audio', 'voice', 'archive'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFileTypeFilter(f)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                fileTypeFilter === f
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'bg-neutral-950 text-neutral-400 hover:text-white border border-neutral-800'
              }`}
            >
              {f === 'all' && 'Все файлы'}
              {f === 'audio' && '🎵 Музыка/Дорожки'}
              {f === 'voice' && '🎙️ Голосовые'}
              {f === 'archive' && '📦 Архивы'}
            </button>
          ))}
          <span className="ml-auto text-[11px] font-mono text-neutral-500">
            Найдено: {filteredFiles.length} из {audioFiles.length}
          </span>
        </div>
      </div>

      {/* Files List / Table */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        {isLoading ? (
          <div className="h-64 flex flex-col items-center justify-center text-neutral-500 space-y-3">
            <RefreshCw className="w-8 h-8 animate-spin text-violet-500" />
            <p className="text-xs">Идёт сканирование сообщений в Telegram...</p>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-neutral-500 space-y-3 border border-dashed border-neutral-800 rounded-2xl p-6 text-center">
            <Music className="w-10 h-10 text-neutral-700" />
            <div>
              <p className="text-sm font-semibold text-neutral-300">Дорожки не обнаружены</p>
              <p className="text-xs text-neutral-500 max-w-sm mt-1">
                Выберите чат вашей команды даберов и нажмите «Сканировать дорожки». Все присланные аудиозаписи и архивы отобразятся здесь.
              </p>
            </div>
          </div>
        ) : (
          filteredFiles.map(item => {
            const isDownloading = !!downloadingIds[item.id];
            const downloadedPath = downloadedPaths[item.id];

            return (
              <div
                key={item.id}
                className="bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-xl p-3.5 transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    item.isVoice 
                      ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400' 
                      : item.fileName.toLowerCase().match(/\.(zip|rar|7z)$/)
                      ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
                      : 'bg-violet-500/10 border border-violet-500/30 text-violet-400'
                  }`}>
                    {item.isVoice ? <Mic className="w-4 h-4" /> : item.fileName.toLowerCase().match(/\.(zip|rar|7z)$/) ? <Archive className="w-4 h-4" /> : <Music className="w-4 h-4" />}
                  </div>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-white truncate max-w-xs sm:max-w-md">
                        {item.fileName}
                      </span>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-neutral-950 text-neutral-400 border border-neutral-800">
                        {item.sizeFormatted}
                      </span>
                      {item.durationFormatted && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-neutral-950 text-sky-400 border border-neutral-800">
                          ⏱ {item.durationFormatted}
                        </span>
                      )}
                      {downloadedPath && (
                        <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 flex items-center gap-1">
                          <Check className="w-3 h-3 text-emerald-400" />
                          Сохранено
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-neutral-400 flex-wrap">
                      <span className="flex items-center gap-1 text-violet-300 font-medium">
                        <User className="w-3 h-3 text-violet-400" />
                        {item.sender.name} {item.sender.username ? `(@${item.sender.username})` : ''}
                      </span>
                      <span className="text-neutral-500">•</span>
                      <span>{item.dateFormatted}</span>
                      {item.caption && (
                        <>
                          <span className="text-neutral-500">•</span>
                          <span className="text-neutral-300 italic truncate max-w-xs">
                            «{item.caption}»
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-center">
                  <button
                    onClick={() => handleMarkDubberTrackReceived(item)}
                    className="px-2.5 py-1.5 bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-300 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 border border-emerald-800/50 cursor-pointer"
                    title="Отметить сдачу дорожки данным дабером в текущей серии"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Принять</span>
                  </button>

                  {downloadedPath ? (
                    <button
                      onClick={() => handleOpenFolder(downloadedPath)}
                      className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 border border-neutral-700 cursor-pointer"
                      title="Показать скачанный файл в проводнике"
                    >
                      <Folder className="w-3.5 h-3.5 text-amber-400" />
                      <span>В папке</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleDownloadTrack(item)}
                      disabled={isDownloading}
                      className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-md shadow-violet-950/30 cursor-pointer"
                      title="Скачать дорожку на локальный диск"
                    >
                      <Download className={`w-3.5 h-3.5 ${isDownloading ? 'animate-spin' : ''}`} />
                      <span>{isDownloading ? 'Скачивание...' : 'Скачать'}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
