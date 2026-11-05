import React, { useState, useEffect } from 'react';
import {
  FileAudio,
  Download,
  RefreshCw,
  FolderOpen,
  UserCheck,
  Search,
  CheckCircle2,
  Mic,
  FileDown,
  Clock,
  Sparkles,
  QrCode,
  AlertCircle,
  Hash
} from 'lucide-react';
import { toast } from 'sonner';
import { ipcSafe } from '../../lib/ipcSafe';
import { Episode, Participant, Project, TelegramMTProtoDialog } from '../../types';
import { TelegramAudioFileItem, TelegramForumTopic } from './types';

interface TelegramTracksTabProps {
  currentProject?: Project | null;
  currentEpisode?: Episode | null;
  allProjects?: Project[];
  participants?: Participant[];
  dialogs: TelegramMTProtoDialog[];
  defaultChatId?: string;
  isConnected?: boolean;
  onOpenAuth?: () => void;
  onRefreshProjects?: () => void;
}

export const TelegramTracksTab: React.FC<TelegramTracksTabProps> = ({
  currentProject,
  currentEpisode,
  participants = [],
  dialogs,
  defaultChatId = '',
  isConnected = true,
  onOpenAuth,
  onRefreshProjects
}) => {
  const resolveInitialChat = (): string => {
    if (currentProject?.tgWorkGroupId) return currentProject.tgWorkGroupId;
    if (currentProject?.links) {
      try {
        const links =
          typeof currentProject.links === 'string'
            ? JSON.parse(currentProject.links)
            : currentProject.links;
        if (links?.tgGroup) return links.tgGroup;
        if (links?.tg) return links.tg;
      } catch {}
    }
    if (defaultChatId) return defaultChatId;
    const firstGroup = dialogs.find((d) => d.isGroup || d.type === 'group');
    return firstGroup ? firstGroup.id : dialogs[0]?.id || '';
  };

  const initialChat = resolveInitialChat();
  const [selectedChatId, setSelectedChatId] = useState<string>(initialChat);
  const [customChatPeer, setCustomChatPeer] = useState<string>(
    initialChat.startsWith('@') ? initialChat : ''
  );
  const [isCustomPeer, setIsCustomPeer] = useState<boolean>(
    dialogs.length === 0 || (Boolean(initialChat) && !dialogs.some((d) => d.id === initialChat))
  );

  // Forum Topics state
  const [topics, setTopics] = useState<TelegramForumTopic[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<string>('');
  const [isLoadingTopics, setIsLoadingTopics] = useState<boolean>(false);

  const [audioFiles, setAudioFiles] = useState<TelegramAudioFileItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [onlyCurrentEpisode, setOnlyCurrentEpisode] = useState<boolean>(false);

  const [targetDir, setTargetDir] = useState<string>('');
  const [downloadingIds, setDownloadingIds] = useState<Record<number, boolean>>({});
  const [downloadedPaths, setDownloadedPaths] = useState<Record<number, string>>({});
  const [selectedDubberMap, setSelectedDubberMap] = useState<Record<number, string>>({});

  useEffect(() => {
    const candidate = resolveInitialChat();
    if (!selectedChatId && candidate) {
      setSelectedChatId(candidate);
      if (candidate.startsWith('@')) {
        setCustomChatPeer(candidate);
      }
    }
    if (dialogs.length > 0 && !customChatPeer) {
      setIsCustomPeer(false);
    }
  }, [dialogs.length, currentProject?.id, defaultChatId]);

  useEffect(() => {
    const initDefaultDir = async () => {
      if (currentEpisode && !targetDir) {
        try {
          const res = await ipcSafe.invoke('export-get-default-dir', {
            episode: currentEpisode,
            project: currentProject,
            role: 'SOUND_ENGINEER'
          });
          if (res && res.success && res.epDir) {
            setTargetDir(`${res.epDir}/Дорожки_Telegram`);
          }
        } catch {}
      }
    };
    initDefaultDir();
  }, [currentEpisode?.id]);

  // Load Forum Topics when selectedChatId changes
  useEffect(() => {
    const peer = isCustomPeer ? customChatPeer.trim() : selectedChatId;
    if (!peer || !isConnected) {
      setTopics([]);
      setSelectedTopicId('');
      return;
    }

    let cancelled = false;
    const loadTopics = async () => {
      setIsLoadingTopics(true);
      try {
        const res = await ipcSafe.invoke('telegram-mtproto-get-forum-topics', {
          chatId: peer,
          limit: 100
        });
        if (!cancelled && res && Array.isArray(res.topics)) {
          setTopics(res.topics);
          setSelectedTopicId('');
        }
      } catch {
        if (!cancelled) setTopics([]);
      } finally {
        if (!cancelled) setIsLoadingTopics(false);
      }
    };

    loadTopics();
    return () => {
      cancelled = true;
    };
  }, [selectedChatId, isCustomPeer, isConnected]);

  const handleLoadAudioFiles = async () => {
    if (!isConnected) {
      toast.error(
        'Для сканирования аудиодорожек в чатах требуется авторизация в Telegram MTProto',
        {
          action: onOpenAuth
            ? {
                label: 'Войти',
                onClick: () => onOpenAuth()
              }
            : undefined
        }
      );
      if (onOpenAuth) onOpenAuth();
      return;
    }

    const peer = isCustomPeer ? customChatPeer.trim() : selectedChatId;
    if (!peer) {
      toast.error('Выберите чат или укажите @username группы');
      return;
    }

    setIsLoading(true);
    try {
      const res = await ipcSafe.invoke('telegram-mtproto-get-audio-files', {
        chatId: peer,
        topicId: selectedTopicId ? Number(selectedTopicId) : undefined,
        limit: 120
      });

      if (res && res.success && Array.isArray(res.files)) {
        setAudioFiles(res.files);
        const autoMap: Record<number, string> = {};
        res.files.forEach((f: TelegramAudioFileItem) => {
          const senderUsername = (f.sender.username || '').toLowerCase();
          const senderName = (f.sender.name || '').toLowerCase();
          const fileNameLower = f.fileName.toLowerCase();

          const matchedParticipant = participants.find((p) => {
            const tg = (p.telegram || '').replace(/^@/, '').toLowerCase();
            const nick = (p.nickname || '').toLowerCase();
            return (
              (tg && (tg === senderUsername || fileNameLower.includes(tg))) ||
              (nick && (senderName.includes(nick) || fileNameLower.includes(nick)))
            );
          });

          if (matchedParticipant) {
            autoMap[f.id] = matchedParticipant.id;
          }
        });
        setSelectedDubberMap((prev) => ({ ...autoMap, ...prev }));
        toast.success(`Найдено аудиофайлов и архивов в чате: ${res.files.length}`);
      } else {
        const errorMsg = res?.error || 'Не удалось загрузить список файлов';
        setAudioFiles([]);
        toast.error(errorMsg);
      }
    } catch (err: any) {
      const errMessage = err?.message || String(err);
      setAudioFiles([]);
      toast.error(`Ошибка загрузки аудио из чата: ${errMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectFolder = async () => {
    try {
      const folder = await ipcSafe.invoke('select-directory');
      if (folder) {
        setTargetDir(folder);
      }
    } catch (err: any) {
      toast.error(`Ошибка выбора папки: ${err.message}`);
    }
  };

  const handleDownloadTrack = async (file: TelegramAudioFileItem) => {
    const peer = isCustomPeer ? customChatPeer.trim() : selectedChatId;
    if (!peer) return;

    setDownloadingIds((prev) => ({ ...prev, [file.id]: true }));
    try {
      const dubberId = selectedDubberMap[file.id];
      const dubber = participants.find((p) => p.id === dubberId);

      let customName = file.fileName;
      if (dubber && !customName.toLowerCase().includes(dubber.nickname.toLowerCase())) {
        const extIndex = customName.lastIndexOf('.');
        const base = extIndex > 0 ? customName.slice(0, extIndex) : customName;
        const ext = extIndex > 0 ? customName.slice(extIndex) : '.wav';
        customName = `${dubber.nickname}_${base}${ext}`;
      }

      const res = await ipcSafe.invoke('telegram-mtproto-download-audio', {
        chatId: peer,
        messageId: file.id,
        targetDir: targetDir || undefined,
        customFileName: customName
      });

      if (res && res.success && res.filePath) {
        setDownloadedPaths((prev) => ({ ...prev, [file.id]: res.filePath }));
        toast.success(`Дорожка сохранена: ${res.fileName}`);

        if (currentEpisode && dubberId) {
          try {
            const newUpload = {
              id: `tg_${file.id}_${Date.now()}`,
              episodeId: currentEpisode.id,
              type: 'DUBBER_FILE' as const,
              path: res.filePath,
              size: res.fileSize || file.size,
              uploadedById: dubberId,
              dubberId: dubberId,
              createdAt: new Date().toISOString()
            };

            const updatedEpisode = {
              ...currentEpisode,
              uploads: [...(currentEpisode.uploads || []), newUpload]
            };

            await ipcSafe.invoke('save-episode', updatedEpisode);
            toast.success(`Привязано к даберу «${dubber?.nickname}» в серии #${currentEpisode.number}`);
            if (onRefreshProjects) onRefreshProjects();
          } catch (attachErr) {
            console.warn('Could not auto-attach track to episode:', attachErr);
          }
        }
      } else {
        throw new Error(res?.error || 'Ошибка скачивания');
      }
    } catch (err: any) {
      toast.error(`Не удалось скачать дорожку: ${err.message || String(err)}`);
    } finally {
      setDownloadingIds((prev) => ({ ...prev, [file.id]: false }));
    }
  };

  const handleDownloadAllFiltered = async () => {
    if (filteredFiles.length === 0) return;
    toast.info(`Запуск пакетного скачивания (${filteredFiles.length} файлов)...`);
    for (const file of filteredFiles) {
      if (!downloadedPaths[file.id]) {
        await handleDownloadTrack(file);
      }
    }
  };

  const filteredFiles = audioFiles.filter((f) => {
    if (onlyCurrentEpisode && currentEpisode) {
      const epStr = String(currentEpisode.number);
      const epPadded = epStr.padStart(2, '0');
      const combined = `${f.fileName} ${f.caption || ''}`.toLowerCase();
      if (!combined.includes(epStr) && !combined.includes(epPadded)) {
        return false;
      }
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = f.fileName.toLowerCase().includes(q);
      const matchSender =
        f.sender.name.toLowerCase().includes(q) ||
        f.sender.username.toLowerCase().includes(q);
      const matchCaption = (f.caption || '').toLowerCase().includes(q);
      if (!matchName && !matchSender && !matchCaption) return false;
    }

    return true;
  });

  return (
    <div className="flex-1 flex flex-col h-full bg-neutral-950 text-white overflow-hidden select-none">
      {/* Top Controls Bar */}
      <div className="bg-neutral-900 border-b border-neutral-800 p-4 space-y-3 flex-shrink-0">
        {!isConnected && (
          <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-xl flex items-center justify-between gap-3 text-xs text-amber-200">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                <strong>Telegram MTProto не подключен.</strong> Для сканирования рабочих чатов и скачивания WAV/FLAC дорожек войдите в аккаунт.
              </span>
            </div>
            {onOpenAuth && (
              <button
                type="button"
                onClick={onOpenAuth}
                className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0 transition cursor-pointer"
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>Войти</span>
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
              <FileAudio className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Загрузка аудиодорожек и архивов из рабочих чатов и тем (Forum Topics)
              </h3>
              <p className="text-[11px] text-neutral-400">
                Прямое скачивание WAV / FLAC / OGG / MP3 / ZIP с авто-привязкой к даберам текущей серии
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {filteredFiles.length > 0 && (
              <button
                onClick={handleDownloadAllFiltered}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-md shadow-emerald-950/50 cursor-pointer"
              >
                <FileDown className="w-3.5 h-3.5" />
                <span>Скачать все ({filteredFiles.length})</span>
              </button>
            )}

            <button
              onClick={handleLoadAudioFiles}
              disabled={isLoading}
              className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-md shadow-sky-950/50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>{isLoading ? 'Сканирование чата...' : 'Сканировать дорожки'}</span>
            </button>
          </div>
        </div>

        {/* Chat Selector + Topic Selector + Folder Selector */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-1">
          {/* Chat Selector */}
          <div className="md:col-span-5 flex items-center gap-2">
            {!isCustomPeer && dialogs.length > 0 ? (
              <select
                value={selectedChatId}
                onChange={(e) => setSelectedChatId(e.target.value)}
                className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:border-sky-500 outline-none transition"
              >
                {dialogs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.type === 'group' ? '👥 ' : d.type === 'channel' ? '📢 ' : '💬 '}
                    {d.title} {d.isForum ? '(Форум с темами)' : ''} {d.username ? `(@${d.username})` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={customChatPeer}
                onChange={(e) => setCustomChatPeer(e.target.value)}
                placeholder="Введите @username чата или ID (-100...)"
                className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:border-sky-500 outline-none transition font-mono"
              />
            )}

            {dialogs.length > 0 && (
              <button
                type="button"
                onClick={() => setIsCustomPeer(!isCustomPeer)}
                className="px-2.5 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs rounded-xl transition flex-shrink-0 cursor-pointer border border-neutral-700"
                title="Переключить ручной ввод ID/Username"
              >
                {isCustomPeer ? 'Из списка' : 'Ввести ID'}
              </button>
            )}
          </div>

          {/* Forum Topic Selector */}
          <div className="md:col-span-3 flex items-center gap-1.5">
            <Hash className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <select
              value={selectedTopicId}
              onChange={(e) => setSelectedTopicId(e.target.value)}
              disabled={isLoadingTopics || topics.length === 0}
              className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-2.5 py-2 text-xs text-white focus:border-amber-500 outline-none transition disabled:opacity-50"
            >
              <option value="">
                {isLoadingTopics
                  ? 'Загрузка тем...'
                  : topics.length > 0
                  ? `Все темы чата (${topics.length})`
                  : 'Без деления на темы'}
              </option>
              {topics.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  # {t.title} (ID: {t.id})
                </option>
              ))}
            </select>
          </div>

          {/* Target Folder */}
          <div className="md:col-span-4 flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={targetDir}
                onChange={(e) => setTargetDir(e.target.value)}
                placeholder="Папка сохранения (по умолчанию: папка серии)"
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl pl-3 pr-3 py-2 text-xs text-neutral-200 focus:border-sky-500 outline-none transition font-mono"
              />
            </div>
            <button
              type="button"
              onClick={handleSelectFolder}
              className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-xl text-xs font-medium transition flex items-center gap-1.5 flex-shrink-0 border border-neutral-700 cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
              <span>Папка</span>
            </button>
          </div>
        </div>

        {/* Search & Episode Filter */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Фильтр по имени файла, даберу (@username) или подписи..."
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white focus:border-sky-500 outline-none transition"
            />
          </div>

          {currentEpisode && (
            <label className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer bg-neutral-950 px-3 py-1.5 rounded-xl border border-neutral-800">
              <input
                type="checkbox"
                checked={onlyCurrentEpisode}
                onChange={(e) => setOnlyCurrentEpisode(e.target.checked)}
                className="rounded border-neutral-700 bg-neutral-900 text-sky-500 focus:ring-0"
              />
              <span>Только для Серии #{currentEpisode.number}</span>
            </label>
          )}
        </div>
      </div>

      {/* Audio Files List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        {isLoading ? (
          <div className="h-64 flex flex-col items-center justify-center text-neutral-500 space-y-3">
            <RefreshCw className="w-8 h-8 animate-spin text-sky-500" />
            <p className="text-xs">Сканирование аудиофайлов в рабочем чате Telegram...</p>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-neutral-500 space-y-3 border border-dashed border-neutral-800 rounded-2xl p-6 text-center">
            <FileAudio className="w-10 h-10 text-neutral-700" />
            <div>
              <p className="text-sm font-semibold text-neutral-300">Аудиофайлы не загружены</p>
              <p className="text-xs text-neutral-500 max-w-md mt-1">
                Выберите рабочий чат даберов (и при необходимости тему форума) сверху и нажмите «Сканировать дорожки».
              </p>
            </div>
            <button
              onClick={handleLoadAudioFiles}
              className="px-4 py-2 bg-sky-600/20 hover:bg-sky-600/30 text-sky-400 border border-sky-500/30 rounded-xl text-xs font-semibold transition flex items-center gap-2 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Найти аудиодорожки в чате</span>
            </button>
          </div>
        ) : (
          filteredFiles.map((file) => {
            const isDownloading = Boolean(downloadingIds[file.id]);
            const savedPath = downloadedPaths[file.id];
            const selectedDubberId = selectedDubberMap[file.id] || '';

            return (
              <div
                key={file.id}
                className="bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-xl p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 transition"
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border ${
                      file.isVoice
                        ? 'bg-purple-500/10 border-purple-500/30 text-purple-400'
                        : 'bg-sky-500/10 border-sky-500/30 text-sky-400'
                    }`}
                  >
                    {file.isVoice ? <Mic className="w-5 h-5" /> : <FileAudio className="w-5 h-5" />}
                  </div>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-white truncate max-w-md">
                        {file.fileName}
                      </span>
                      <span className="text-[11px] font-mono tabular-nums text-sky-400">
                        {file.sizeFormatted}
                      </span>
                      {file.durationFormatted && (
                        <span className="text-[11px] font-mono tabular-nums text-neutral-400 flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {file.durationFormatted}
                        </span>
                      )}
                      {file.topicId && (
                        <span className="text-[11px] font-mono text-amber-400">
                          Тема #{file.topicId}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-neutral-400 flex-wrap">
                      <span>
                        Отправитель: <strong className="text-neutral-200">{file.sender.name}</strong>
                        {file.sender.username ? ` (@${file.sender.username})` : ''}
                      </span>
                      <span>·</span>
                      <span>{file.dateFormatted}</span>
                    </div>

                    {file.caption && (
                      <p className="text-xs text-neutral-300 bg-neutral-950/80 px-2.5 py-1.5 rounded-lg border border-neutral-800/80 mt-1">
                        {file.caption}
                      </p>
                    )}

                    {savedPath && (
                      <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-mono truncate pt-0.5">
                        <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">Сохранено: {savedPath}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Dubber Mapping & Download */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {participants.length > 0 && (
                    <div className="flex items-center gap-1.5 bg-neutral-950 border border-neutral-800 rounded-xl px-2.5 py-1.5">
                      <UserCheck className="w-3.5 h-3.5 text-neutral-400" />
                      <select
                        value={selectedDubberId}
                        onChange={(e) =>
                          setSelectedDubberMap((prev) => ({
                            ...prev,
                            [file.id]: e.target.value
                          }))
                        }
                        className="bg-transparent text-xs text-neutral-200 outline-none max-w-[140px]"
                      >
                        <option value="" className="bg-neutral-900">
                          Привязать к даберу...
                        </option>
                        {participants.map((p) => (
                          <option key={p.id} value={p.id} className="bg-neutral-900">
                            {p.nickname} {p.telegram ? `(${p.telegram})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <button
                    onClick={() => handleDownloadTrack(file)}
                    disabled={isDownloading}
                    className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer ${
                      savedPath
                        ? 'bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-700/50'
                        : 'bg-sky-600 hover:bg-sky-500 text-white shadow-md shadow-sky-950/50'
                    }`}
                  >
                    {isDownloading ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Загрузка...</span>
                      </>
                    ) : savedPath ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Скачано</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5" />
                        <span>Скачать в серию</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
