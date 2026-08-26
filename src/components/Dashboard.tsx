import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Plus, X, CheckCircle2, Clock, AlertCircle, Mic, FileAudio, UserPlus, Link as LinkIcon, MessageSquare, ExternalLink, Calendar, FileText, Image as ImageIcon, Database, FolderPlus, FolderOpen, ChevronRight, ChevronLeft, Save, Loader2, FileVideo, Activity, Users, Settings2, Hash, Globe, User, Download, Languages, Zap, RefreshCw, Table, Youtube, Layers, Send, Film } from 'lucide-react';
import { toast } from 'sonner';
import { TelegramClientPanel } from './TelegramClientPanel';
import { getParticipants } from '../services/dbService';
import { Participant, Project, Episode, EpisodeStatus, ReleaseType, RoleAssignment } from '../types';
import { ipcSafe } from '../lib/ipcSafe';
import { getNextEpisodeDate } from '../services/animeService';
import { ExportModal } from './ExportModal';
import { ConfirmModal } from './ui/ConfirmModal';
import CreateProjectModal from './dashboard/CreateProjectModal';
import CreateEpisodeModal from './dashboard/CreateEpisodeModal';
import CharacterManagementModal from './dashboard/CharacterManagementModal';
import AssignDubbersModal from './dashboard/AssignDubbersModal';
import AssignSoundEngineerModal from './dashboard/AssignSoundEngineerModal';
import { NotificationTemplatesModal } from './dashboard/NotificationTemplatesModal';
import RolesGridModal from './dashboard/RolesGridModal';
import YoutubeDownloadModal from './dashboard/YoutubeDownloadModal';
import { useEpisodeSync } from './dashboard/useEpisodeSync';
import { useProjectAutoUpdate } from '../hooks/useProjectAutoUpdate';
import { SIGN_KEYWORDS } from '../constants';
import GettingStartedGuide from './GettingStartedGuide';
import GeneralHub from './dashboard/GeneralHub';
import { generateStartEpisodeMessage, generateStatusMessage, formatDeadline, generateSoundEngineerMessage } from '../lib/templates';
import { sanitizeFolderName } from '../lib/pathUtils';
import { calculateDeadline } from '../lib/dateUtils';
import { TextToSubtitlesModal } from './TextToSubtitlesModal';
import MultiSubtitleMergeModal, { SubFileItem } from './MultiSubtitleMergeModal';
import MkvImportModal from './mkv/MkvImportModal';
import TorrentMkvDetectedModal from './mkv/TorrentMkvDetectedModal';
import { inspectMkvTracks, extractSelectedMkvTracks, MkvTrackInfo } from '../lib/mkvSubtitleExtractor';
import { linkDownloadedTorrentFile } from '../lib/torrentEpisodeLinker';

interface DashboardProps {
  onNavigate?: (tab: string) => void;
  projects: Project[];
  selectedProjectId: string | null;
  currentEpisode: Episode | null;
  onProjectSelect: (id: string) => void;
  onEpisodeSelect: (num: number) => void;
  onRefresh: () => void;
}

const STATUS_LABELS: Record<EpisodeStatus, string> = {
  UPLOAD: 'Загрузка ресурсов',
  ROLES: 'Распределение ролей',
  RECORDING: 'Запись звука',
  QA: 'Проверка качества',
  FIXES: 'Правки',
  SOUND_ENGINEERING: 'Звукорежиссура',
  FINISHED: 'Завершено'
};

const RELEASE_TYPE_LABELS: Record<ReleaseType, string> = {
  VOICEOVER: 'Закадр',
  RECAST: 'Рекаст',
  REDUB: 'Редаб'
};

const ROLE_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Ожидает',
  RECORDED: 'Записано',
  APPROVED: 'Одобрено',
  REJECTED: 'Отклонено',
  FIXES_NEEDED: 'Нужны правки'
};

export default function Dashboard({ 
  onNavigate, 
  projects, 
  selectedProjectId, 
  currentEpisode, 
  onProjectSelect, 
  onEpisodeSelect,
  onRefresh
}: DashboardProps) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  
  const [isNewEpisodeModalOpen, setIsNewEpisodeModalOpen] = useState(false);

  const [isDeleteProjectModalOpen, setIsDeleteProjectModalOpen] = useState(false);
  const [isDeleteEpisodeModalOpen, setIsDeleteEpisodeModalOpen] = useState(false);

  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [isCharacterManagementModalOpen, setIsCharacterManagementModalOpen] = useState(false);
  const [isRolesGridModalOpen, setIsRolesGridModalOpen] = useState(false);
  const [isYoutubeModalOpen, setIsYoutubeModalOpen] = useState(false);
  const [isAssignSoundEngineerModalOpen, setIsAssignSoundEngineerModalOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [characterName, setCharacterName] = useState('');

  const [isAssignDubbersModalOpen, setIsAssignDubbersModalOpen] = useState(false);
  const [isNotificationTemplatesModalOpen, setIsNotificationTemplatesModalOpen] = useState(false);

  const [isUploading, setIsUploading] = useState(false);
  const [transcodingProgress, setTranscodingProgress] = useState<number | null>(null);
  const [status, setStatus] = useState<string>('');

  const [isProjectSettingsModalOpen, setIsProjectSettingsModalOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState('');

  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportRole, setExportRole] = useState<'DABBER' | 'SOUND_ENGINEER'>('DABBER');

  const [isTelegramClientModalOpen, setIsTelegramClientModalOpen] = useState(false);

  const [generatedMessage, setGeneratedMessage] = useState<string | null>(null);
  const [isMessageModalOpen, setIsMessageModalOpen] = useState(false);
  const [isHardsubEnabled, setIsHardsubEnabled] = useState(false);
  const [subtitleTracks, setSubtitleTracks] = useState<MkvTrackInfo[]>([]);
  const [audioTracks, setAudioTracks] = useState<MkvTrackInfo[]>([]);
  const [pendingMkvUpload, setPendingMkvUpload] = useState<{filePath: string, type: 'RAW' | 'SUB', episodeId?: string} | null>(null);
  const [isSubtitleSelectModalOpen, setIsSubtitleSelectModalOpen] = useState(false);
  const [isMkvExtracting, setIsMkvExtracting] = useState(false);
  const [selectedSubtitleIndex, setSelectedSubtitleIndex] = useState<number | undefined>();
  const [selectedAudioIndex, setSelectedAudioIndex] = useState<number | undefined>();
  const [isMultiSubMergeModalOpen, setIsMultiSubMergeModalOpen] = useState(false);
  const [multiMergeInitialFiles, setMultiMergeInitialFiles] = useState<SubFileItem[]>([]);
  const [torrentMkvDetected, setTorrentMkvDetected] = useState<{
    episodeNumber: number;
    filePath: string;
    subtitleTracks: MkvTrackInfo[];
    targetEpisode?: Episode;
  } | null>(null);

  // Torrent download states
  const [isTorrentModalOpen, setIsTorrentModalOpen] = useState(false);
  const [torrentQuery, setTorrentQuery] = useState('');
  const [torrentCategory, setTorrentCategory] = useState('anime');
  const [torrentSubCategory, setTorrentSubCategory] = useState('raw');
  const [torrentReleaseGroup, setTorrentReleaseGroup] = useState('');
  const [isSearchingTorrents, setIsSearchingTorrents] = useState(false);
  const [torrentResults, setTorrentResults] = useState<any[]>([]);
  const [torrentMetadata, setTorrentMetadata] = useState<{name: string, files: any[]} | null>(null);
  const [selectedTorrentForMeta, setSelectedTorrentForMeta] = useState<any | null>(null);
  const [activeDownloadId, setActiveDownloadId] = useState<string | null>(null);
  const [downloadStep, setDownloadStep] = useState<'search' | 'getting_meta' | 'select_files' | 'downloading' | 'direct_downloading'>('search');
  const [downloadProgress, setDownloadProgress] = useState<{
    name: string;
    progress: number;
    downloadSpeed: number;
    numPeers: number;
    status: string;
    error: string | null;
  } | null>(null);

  const [directDownloadId, setDirectDownloadId] = useState<string | null>(null);
  const [directDownloadProgress, setDirectDownloadProgress] = useState<{
    id: string;
    fileName: string;
    status: string;
    progress: number;
    downloadSpeed: string;
    downloadedBytes: string;
    totalBytes: string;
    error: string | null;
    logs?: string[];
  } | null>(null);

  // Anime365 Auth status
  const [anime365AuthStatus, setAnime365AuthStatus] = useState<{
    loggedIn: boolean;
    cookieCount: number;
    hasSessionCookies: boolean;
    hasConfigCookies: boolean;
    isMockMode: boolean;
    activeHost?: string;
  } | null>(null);
  const [manualCookieVal, setManualCookieVal] = useState('');
  const [showManualCookieForm, setShowManualCookieForm] = useState(false);

  const checkAnime365Auth = async () => {
    try {
      const status = await ipcSafe.invoke('anime365-get-auth-status', {});
      setAnime365AuthStatus(status);
      if (status && status.hasConfigCookies) {
        const config = await ipcSafe.invoke('get-config');
        if (config && config.anime365_cookie) {
          setManualCookieVal(config.anime365_cookie);
        }
      }
    } catch (err) {
      console.error('Failed to get Anime365 auth status:', err);
    }
  };

  const handleOpenAnime365AuthWindow = async () => {
    try {
      toast.info('Открываем окно авторизации на Anime365...');
      const res = await ipcSafe.invoke('anime365-open-auth-window', {});
      if (res && res.success) {
        toast.success(res.message || 'Окно авторизации закрыто. Обновляем статус...');
      } else if (res && res.url) {
        toast.warning('Вы используете веб-версию. Ссылка открыта в новой вкладке.');
        window.open(res.url, '_blank');
      }
      await checkAnime365Auth();
    } catch (err: any) {
      toast.error('Ошибка при открытии окна: ' + err.message);
    }
  };

  const handleSaveManualCookie = async () => {
    try {
      await ipcSafe.invoke('save-config', { anime365_cookie: manualCookieVal });
      toast.success('Куки сохранены успешно!');
      setShowManualCookieForm(false);
      await checkAnime365Auth();
    } catch (err: any) {
      toast.error('Не удалось сохранить куки: ' + err.message);
    }
  };

  useEffect(() => {
    if (isTorrentModalOpen) {
      checkAnime365Auth();
    }
  }, [isTorrentModalOpen]);

  useEffect(() => {
    const removeCompletedListener = ipcSafe.on('task-completed', async (data: any) => {
      const { task } = data;
      if (task?.metadata?.roleName) {
        const allEpisodes = projects.flatMap(p => p.episodes || []);
        const epMatch = allEpisodes.find((e: any) => e.id === task.metadata.episodeId);
        if (epMatch) {
          const epWithProj = { ...epMatch, project: projects.find(p => p.id === epMatch.projectId) };
          const parts = await getParticipants();
          let msg = '';
          if (task.metadata.roleName === 'DABBER') {
            msg = generateStartEpisodeMessage(epWithProj as any, parts);
          } else if (task.metadata.roleName === 'SOUND_ENGINEER') {
            msg = generateSoundEngineerMessage(epWithProj as any, '', parts);
          }
          if (msg) {
            setGeneratedMessage(msg);
            setIsMessageModalOpen(true);
            toast.success('Экспорт завершен!');
          }
        }
      }
    });
    return () => {
      removeCompletedListener();
    };
  }, [projects]);

  const downloadPollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Anime 365 RAW and Subtitle download states
  const [anime365Translations, setAnime365Translations] = useState<any[]>([]);
  const [isLoadingAnime365, setIsLoadingAnime365] = useState(false);
  const [isUpdatingProjectData, setIsUpdatingProjectData] = useState(false);

  // Subtitle custom window states
  const [isSubDownloadModalOpen, setIsSubDownloadModalOpen] = useState(false);
  const [isTextToSubModalOpen, setIsTextToSubModalOpen] = useState(false);
  const [subDownloadResults, setSubDownloadResults] = useState<any[]>([]);
  const [isSearchingSubs, setIsSearchingSubs] = useState(false);
  const [subSearchQuery, setSubSearchQuery] = useState('');
  const [subSourceLanguage, setSubSourceLanguage] = useState('all'); // all, ru, ja
  const [subApiSource, setSubApiSource] = useState('anime365'); // anime365, kitsunekko

  const handleUpdateProjectData = async () => {
    if (!selectedProject) return;
    setIsUpdatingProjectData(true);
    try {
      const updated = await ipcSafe.invoke('anime365-update-project-data', { projectId: selectedProject.id });
      if (updated) {
        onRefresh();
        toast.success('Данные проекта (синопсис, постер, серии) успешно подтянуты и обновлены из Anime365!');
      }
    } catch (err: any) {
      console.error('[UpdateProjectData] Error:', err);
      toast.error('Не удалось обновить: ' + (err.message || String(err)));
    } finally {
      setIsUpdatingProjectData(false);
    }
  };

  const openSubtitleDownloadModal = () => {
    if (!currentEpisode) return;
    const animeTitle = selectedProject?.originalTitle || selectedProject?.title || '';
    setSubSearchQuery(animeTitle);
    setSubDownloadResults([]);
    setSubSourceLanguage('all');
    setSubApiSource('anime365');
    setIsSubDownloadModalOpen(true);
    
    // Trigger initial subtitle lookup
    handleSearchSubtitles(animeTitle, 'anime365');
  };

  const handleTextToSubsSave = async (lines: any[]) => {
    if (!currentEpisode || !selectedProject) return;
    try {
      const tempPath = await ipcSafe.invoke('get-temp-path');
      const tempFile = `${tempPath}/generated_subs_${Date.now()}.ass`;
      
      await ipcSafe.invoke('save-raw-subtitles', { 
        filePath: tempFile, 
        lines, 
        overwrite: true 
      });

      const projectTitle = sanitizeFolderName(selectedProject.title || 'Project');
      const episodeFolder = sanitizeFolderName(`Episode_${currentEpisode.number}`);
      const subDir = `${projectTitle}/${episodeFolder}`;
      
      const copyRes = await ipcSafe.invoke('copy-file', {
        sourcePath: tempFile,
        targetDir: subDir,
        fileName: 'subtitles.ass'
      });

      if (copyRes && copyRes.path) {
        const updateData: any = { subPath: copyRes.path };
        
        // Check if we should move to ROLES status
        if (currentEpisode.rawPath) {
          updateData.status = 'ROLES';
        }

        await ipcSafe.invoke('save-episode', { ...currentEpisode, ...updateData });
        onRefresh();
        toast.success('Субтитры успешно сгенерированы и сохранены!');
      }
    } catch (err: any) {
      console.error(err);
      toast.error('Ошибка сохранения сгенерированных субтитров: ' + err.message);
    }
  };

  const handleSearchSubtitles = async (q: string, apiSrc: string) => {
    if (!q.trim()) return;
    setIsSearchingSubs(true);
    try {
      if (apiSrc === 'anime365') {
        let anime365Id = selectedProject?.anime365Id;
        if (!anime365Id) {
          const match = await ipcSafe.invoke('anime365-search-series', { query: q });
          if (match && match.length > 0) {
            anime365Id = match[0].id;
          }
        }
        
        if (anime365Id) {
          const trans = await ipcSafe.invoke('anime365-get-episode-translations', {
            seriesId: anime365Id,
            episodeNumber: currentEpisode?.number || 1
          });
          
          if (trans && Array.isArray(trans)) {
            // Filter only translations with subtitles capabilities
            const subtitleTranslations = trans.filter(t => t.type === 'subtitles' || t.typeKind?.toLowerCase()?.includes('sub') || (t.qualityType && ['ass','srt'].includes(t.qualityType.toLowerCase())) || (t.title && t.title.toLowerCase().includes('субтитры')));
            
            const results = subtitleTranslations.map(t => {
              const langCode = t.typeLang?.toLowerCase() || '';
              let lang = 'RU';
              if (langCode.includes('jp') || langCode.includes('ja')) lang = 'JA';
              else if (langCode.includes('en')) lang = 'EN';
              
              return {
                id: String(t.id),
                title: t.title || `Субтитры от ${t.authorsSummary || 'переводчика'}`,
                language: lang,
                authors: t.authorsSummary || t.authorsList?.join(', ') || 'Официальные',
                format: 'ASS',
                url: `https://smotret-anime.app/translations/ass/${t.id}?download=1`,
                source: 'anime365'
              };
            });
            setSubDownloadResults(results);
          } else {
            setSubDownloadResults([]);
          }
        } else {
          setSubDownloadResults([]);
        }
      } else {
        setSubDownloadResults([]);
      }
    } catch (err: any) {
      console.error('[SearchSubtitles] Failed:', err);
      toast.error('Проблема при загрузке списка субтитров: ' + (err.message || String(err)));
    } finally {
      setIsSearchingSubs(false);
    }
  };

  const handleDownloadAndImportSubtitle = async (sub: any) => {
    if (!currentEpisode) return;
    try {
      const loadingToastId = toast.loading('Скачивание и применение субтитров к серии...');
      const res = await ipcSafe.invoke('anime365-download-subtitle', {
        url: sub.url,
        episodeId: currentEpisode.id
      });
      
      toast.dismiss(loadingToastId);
      if (res && res.success) {
        toast.success(`Субтитры успешно установлены для серии ${currentEpisode.number}!`);
        onRefresh();
        setIsSubDownloadModalOpen(false);
      } else {
        toast.error('Не удалось сохранить файл субтитров на ПК.');
      }
    } catch (err: any) {
      console.error('[DownloadAndImportSubtitle] Failed:', err);
      toast.error('Ошибка импорта: ' + (err.message || String(err)));
    }
  };

  useEffect(() => {
    return () => {
      if (downloadPollIntervalRef.current) {
        clearInterval(downloadPollIntervalRef.current);
      }
    };
  }, []);

  const openTorrentDownloadModal = async () => {
    if (!currentEpisode) return;
    const animeTitle = selectedProject?.originalTitle || selectedProject?.title || '';
    const initialQuery = `${animeTitle} ${currentEpisode.number ? (currentEpisode.number < 10 ? '0' + currentEpisode.number : currentEpisode.number) : ''}`.trim();
    setTorrentQuery(initialQuery);
    setTorrentCategory('anime');
    setTorrentSubCategory('raw');
    setTorrentResults([]);
    setDownloadStep('search');
    setIsTorrentModalOpen(true);

    // Dynamic Anime 365 RAW loader inside the modal!
    setAnime365Translations([]);
    if (selectedProject) {
      setIsLoadingAnime365(true);
      try {
        let anime365Id = selectedProject.anime365Id;
        if (!anime365Id) {
          const match = await ipcSafe.invoke('anime365-search-series', { query: animeTitle });
          if (match && match.length > 0) {
            anime365Id = match[0].id;
          }
        }
        
        if (anime365Id) {
          const trans = await ipcSafe.invoke('anime365-get-episode-translations', {
            seriesId: anime365Id,
            episodeNumber: currentEpisode.number
          });
          setAnime365Translations(trans || []);
        }
      } catch (err) {
        console.warn('Could not grab Anime 365 RAW list:', err);
      } finally {
        setIsLoadingAnime365(false);
      }
    }
  };

  const handleAnime365Download = async (item: any) => {
    if (!selectedProject || !currentEpisode) return;
    
    const confirmDownload = confirm(`Вы действительно хотите скачать RAW видео "${item.title || 'RAW источник'}" напрямую с Anime365 в проект?`);
    if (!confirmDownload) return;

    const projectTitle = sanitizeFolderName(selectedProject.title || 'Project');
    const episodeFolder = sanitizeFolderName(`Episode_${currentEpisode.number}`);
    const subDir = `${projectTitle}/${episodeFolder}`;
    
    let extension = 'mp4';
    
    // Helper to construct high-quality direct link
    const constructDirectUrl = (tItem: any) => {
      let tUrl = tItem.embedUrl || tItem.url || '';
      if (tItem.id && tUrl) {
        try {
          const urlObj = new URL(tUrl);
          const mirrorBase = urlObj.origin;
          let height = '1080';
          if (tItem.qualityType) {
            const matchHeight = tItem.qualityType.match(/\d+/);
            if (matchHeight) {
              height = matchHeight[0];
            }
          }
          return `${mirrorBase}/translations/mp4/${tItem.id}?format=mp4&height=${height}`;
        } catch (e) {
          return tUrl;
        }
      }
      return tUrl;
    };

    let sourceUrl = constructDirectUrl(item);
    
    // Collect alternative mirrors / fallback URLs
    const fallbackUrls: string[] = [];
    if (item.embedUrl) fallbackUrls.push(item.embedUrl);
    if (item.url && item.url !== item.embedUrl) fallbackUrls.push(item.url);
    
    // Grab all other raw or jpn translations as potential mirrors
    const otherItems = anime365Translations.filter(t => 
      t.id !== item.id && 
      (t.type === 'raw' || t.qualityType?.toLowerCase()?.includes('raw') || (t.title && t.title.toLowerCase().includes('raw')) || t.typeLang === 'jpn')
    );
    
    otherItems.forEach(t => {
      const optUrl = constructDirectUrl(t);
      if (optUrl && !fallbackUrls.includes(optUrl)) fallbackUrls.push(optUrl);
      if (t.embedUrl && !fallbackUrls.includes(t.embedUrl)) fallbackUrls.push(t.embedUrl);
      if (t.url && !fallbackUrls.includes(t.url)) fallbackUrls.push(t.url);
    });

    if (sourceUrl.includes('.mkv')) extension = 'mkv';

    const fileName = `raw_video.${extension}`;

    setDownloadStep('direct_downloading');
    setDirectDownloadProgress({
      id: '',
      fileName,
      status: 'searching',
      progress: 0,
      downloadSpeed: '0 KB/s',
      downloadedBytes: '0 MB',
      totalBytes: 'Unknown',
      error: null
    });

    try {
      const res = await ipcSafe.invoke('anime365-start-direct-download', {
        url: sourceUrl,
        fallbackUrl: item.embedUrl || item.url || sourceUrl,
        fallbackUrls: fallbackUrls,
        targetDir: subDir,
        fileName,
        episodeId: currentEpisode.id
      });

      if (res && res.downloadId) {
        setDirectDownloadId(res.downloadId);
        
        const poll = setInterval(async () => {
          try {
            const status = await ipcSafe.invoke('anime365-get-direct-download-status', { downloadId: res.downloadId });
            if (status) {
              setDirectDownloadProgress(status);
              
              if (status.status === 'completed') {
                clearInterval(poll);
                setDirectDownloadId(null);
                
                const updatedEp = { 
                  ...currentEpisode, 
                  rawPath: status.filePath, // Use absolute path from backend
                  isHardsub: false
                };
                
                if (updatedEp.subPath) {
                  updatedEp.status = 'ROLES';
                }

                await ipcSafe.invoke('save-episode', updatedEp);
                onRefresh();
                toast.success('Видео успешно скачано и прилинковано к серии!');
                setIsTorrentModalOpen(false);
              } else if (status.status === 'error') {
                clearInterval(poll);
                setDirectDownloadId(null);
                toast.error('Ошибка скачивания: ' + (status.error || 'Неизвестная ошибка'));
              }
            }
          } catch (pollEx: any) {
            console.error('[Direct Download Poll Error]:', pollEx);
          }
        }, 1500);

        downloadPollIntervalRef.current = poll;
      }
    } catch (err: any) {
      console.error('[Direct Download Start Error]:', err);
      toast.error('Не удалось запустить загрузку: ' + (err.message || String(err)));
      setDownloadStep('search');
    }
  };

  const handleCancelDirectDownload = async () => {
    if (downloadPollIntervalRef.current) {
      clearInterval(downloadPollIntervalRef.current);
      downloadPollIntervalRef.current = null;
    }
    if (directDownloadId) {
      try {
        await ipcSafe.invoke('anime365-cancel-direct-download', { downloadId: directDownloadId });
      } catch (e) {
        console.warn('Cancel call failed:', e);
      }
    }
    setDirectDownloadId(null);
    setDirectDownloadProgress(null);
    setDownloadStep('search');
  };

  const handleSearchTorrents = async () => {
    if (!torrentQuery.trim()) return;
    setIsSearchingTorrents(true);
    setTorrentResults([]);
    try {
      let finalQuery = torrentQuery.trim();
      if (torrentReleaseGroup) {
        finalQuery = `${torrentReleaseGroup} ${finalQuery}`;
      }
      const results = await ipcSafe.invoke('search-nyaa-torrents', {
        query: finalQuery,
        category: torrentCategory,
        subCategory: torrentSubCategory || undefined
      });
      if (results && Array.isArray(results)) {
        setTorrentResults(results);
        if (results.length === 0) {
          toast.info('Торренты не найдены. Попробуйте изменить поисковый запрос.');
        }
      } else {
        toast.error('Произошла ошибка при получении данных от API Nyaa');
      }
    } catch (err: any) {
      console.error('Nyaa search error on frontend:', err);
      toast.error('Не удалось произвести поиск: ' + (err.message || String(err)));
    } finally {
      setIsSearchingTorrents(false);
    }
  };

  const handleStartTorrentDownload = async (torrent: any) => {
    if (!torrent) return;
    setSelectedTorrentForMeta(torrent);
    setDownloadStep('getting_meta');
    
    try {
      const meta = await ipcSafe.invoke('get-torrent-metadata', {
        torrentUrl: torrent.torrent || torrent.link || undefined,
        magnet: torrent.magnet || undefined
      });
      setTorrentMetadata(meta);
      setDownloadStep('select_files');
    } catch (err: any) {
      console.error(err);
      toast.error('Ошибка получения метаданных: ' + (err.message || String(err)));
      setDownloadStep('search');
    }
  };

  const [selectedFileIndexes, setSelectedFileIndexes] = useState<number[]>([]);

  const handleDownloadFiles = async () => {
    if (!selectedTorrentForMeta) return;
    if (selectedFileIndexes.length === 0) {
      toast.error('Выберите хотя бы один файл');
      return;
    }

    setDownloadStep('downloading');
    setDownloadProgress({
      name: selectedTorrentForMeta.name || selectedTorrentForMeta.title || 'Подготовка...',
      progress: 0,
      downloadSpeed: 0,
      numPeers: 0,
      status: 'downloading',
      error: null
    });

    try {
      toast.success(`Запущена фоновая загрузка ${selectedFileIndexes.length} файлов.`);
      
      selectedFileIndexes.forEach(async (idx) => {
         try {
           const bgRes = await ipcSafe.invoke('start-torrent-download', {
             torrentUrl: selectedTorrentForMeta.torrent || selectedTorrentForMeta.link || undefined,
             magnet: selectedTorrentForMeta.magnet || undefined,
             fileIndex: idx
           });
           
           if (bgRes && bgRes.downloadId && selectedProject) {
             const poll = setInterval(async () => {
               try {
                 const st = await ipcSafe.invoke('get-torrent-download-status', { downloadId: bgRes.downloadId });
                 if (st && st.status === 'completed') {
                   clearInterval(poll);
                   
                   if (st.filePath) {
                     const fallbackNum = selectedFileIndexes.length === 1 && currentEpisode 
                       ? currentEpisode.number 
                       : undefined;

                     const linkRes = await linkDownloadedTorrentFile({
                       projectId: selectedProject.id,
                       filePath: st.filePath,
                       fileName: st.name,
                       fallbackEpNumber: fallbackNum,
                       isSingleDownload: selectedFileIndexes.length === 1,
                       currentEpisodeId: currentEpisode?.id,
                       onRefresh
                     });

                     if (linkRes && linkRes.detectedSubtitleTracks && linkRes.detectedSubtitleTracks.length > 0) {
                       setTorrentMkvDetected({
                         episodeNumber: linkRes.episodeNumber,
                         filePath: st.filePath,
                         subtitleTracks: linkRes.detectedSubtitleTracks,
                         targetEpisode: linkRes.targetEpisode
                       });
                     }
                   }
                 } else if (st && st.status === 'error') {
                   clearInterval(poll);
                   toast.error(`Ошибка загрузки торрента: ${st.error}`);
                   console.error(`Фоновая загрузка (${idx}) завершилась с ошибкой:`, st.error);
                 }
               } catch (e) {
                 console.error('Error polling torrent download status:', e);
               }
             }, 1500);
           }
         } catch (e) {
           console.error('Error initiating torrent file download:', e);
         }
      });

      setIsTorrentModalOpen(false); // Close Modal immediately
      setDownloadStep('search');

    } catch (err: any) {
      console.error('Error starting torrent download:', err);
      toast.error('Ошибка при запуске загрузки: ' + (err.message || String(err)));
      setDownloadStep('search');
      setDownloadProgress(null);
    }
  };

  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    variant?: 'danger' | 'warning' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const selectedProject = useMemo(() => projects.find(p => p.id === selectedProjectId), [projects, selectedProjectId]);
  
  // Background project metadata and character update
  useProjectAutoUpdate(selectedProject || null, onRefresh);

  const { syncEpisodeWithGlobalMapping } = useEpisodeSync(currentEpisode, selectedProject, onRefresh);

  useEffect(() => {
    if (currentEpisode) {
      setIsHardsubEnabled(currentEpisode.isHardsub || false);
    }
  }, [currentEpisode]);

  useEffect(() => {
    syncEpisodeWithGlobalMapping();
  }, [currentEpisode?.id, selectedProject?.globalMapping, syncEpisodeWithGlobalMapping]);

  const handleExport = async (targetDir: string, skipConversion: boolean, smartExport?: boolean, additionalProcessing?: boolean) => {
    if (!currentEpisode) return;
    
    try {
      const taskType = exportRole === 'DABBER' ? 'export-dabber-files' : 'export-sound-engineer-files';
      const roleName = exportRole === 'DABBER' ? 'Даберам' : 'Звукорежиссеру';
      const newStatus = exportRole === 'DABBER' ? 'RECORDING' : 'SOUND_ENGINEERING';
      
      const updatedEpisode = {
        ...currentEpisode,
        status: newStatus as any
      };
      
      await ipcSafe.invoke('save-episode', updatedEpisode);
      
      await ipcSafe.invoke('enqueue-ffmpeg-task', {
        type: taskType,
        payload: {
          episode: updatedEpisode,
          targetDir,
          skipConversion,
          smartExport,
          additionalProcessing
        },
        metadata: {
          title: `Экспорт ${roleName}: ${currentEpisode.project?.title || 'Проект'} - Серия ${currentEpisode.number}`,
          episodeId: currentEpisode.id,
          roleName: exportRole, // 'DABBER' or 'SOUND_ENGINEER'
          projectId: currentEpisode.projectId
        }
      });

      setIsExportModalOpen(false);
      toast.success(`Экспорт ${roleName} успешно поставлен в фоновую очередь!`);
      onRefresh();
    } catch (error: any) {
      console.error('Export enqueue error:', error);
      toast.error('Ошибка добавления экспорта в очередь: ' + (error.message || String(error)));
    }
  };

  const handleGenerateReminderMessage = () => {
    if (!currentEpisode) return;
    const msg = generateStatusMessage(currentEpisode, participants);
    setGeneratedMessage(msg);
    setIsMessageModalOpen(true);
  };



  const processFileUpload = async (
    filePath: string, 
    type: 'RAW' | 'SUB', 
    selectedSubtitleStreamIndex?: number, 
    selectedAudioStreamIndex?: number,
    targetEpisodeId?: string
  ) => {
    let episodeToUpdate = targetEpisodeId 
      ? selectedProject?.episodes?.find(e => e.id === targetEpisodeId) 
      : currentEpisode;
      
    if (!episodeToUpdate && targetEpisodeId) {
      try {
        const allProjects = await ipcSafe.invoke('get-projects');
        if (Array.isArray(allProjects)) {
          for (const p of allProjects) {
            const found = p.episodes?.find((e: any) => e.id === targetEpisodeId);
            if (found) {
              episodeToUpdate = found;
              break;
            }
          }
        }
      } catch (e) {
        console.error('Failed fetching latest projects in processFileUpload:', e);
      }
    }

    if (!episodeToUpdate) return;
    
    try {
      let finalFilePath = filePath;
      const fileName = filePath.split(/[\\/]/).pop() || 'file';
      const ext = fileName.split('.').pop()?.toLowerCase();
      
      // Extract subtitle if requested
      if (type === 'RAW' && ext === 'mkv' && selectedSubtitleStreamIndex !== undefined) {
        setStatus("Извлечение субтитров...");
        const subOutputPath = filePath.replace(/\.mkv$/i, '.ass');
        const extractRes = await ipcSafe.invoke('extract-subtitle-track', {
          videoPath: filePath,
          outputPath: subOutputPath,
          streamIndex: selectedSubtitleStreamIndex
        });
        
        if (extractRes && extractRes.path) {
          // Upload extracted subtitles
          await processFileUpload(subOutputPath, 'SUB', undefined, undefined, targetEpisodeId || episodeToUpdate.id);
          // Очистка временного извлеченного файла субтитров
          try {
            await ipcSafe.invoke('delete-file', subOutputPath);
          } catch (e) {}
        } else {
          console.error("Failed to extract subtitles. extractRes:", extractRes, "from path:", filePath);
          toast.error("Не удалось извлечь субтитры: возможно формат файла не поддерживается или произошла системная ошибка.");
        }
      }

      // Transcode MKV to MP4
      if (type === 'RAW' && ext === 'mkv') {
        setStatus("Транскодирование MKV в MP4...");
        const outputPath = filePath.replace(/\.mkv$/i, '.mp4');
        const transcodeRes = await ipcSafe.invoke('transcode-video', {
          videoPath: filePath,
          outputPath,
          audioStreamIndex: selectedAudioStreamIndex
        });
        
        // transcode-video returns the outputPath string on success
        if (!transcodeRes) {
          toast.error('Ошибка транскодирования: не удалось получить путь к файлу.');
          setIsUploading(false);
          return;
        }
        finalFilePath = transcodeRes as string;
        setTranscodingProgress(null);
      }
      
      // Use project title if available, otherwise fallback to ID
      const projectTitle = sanitizeFolderName(selectedProject?.title || 'Project');
      const episodeFolder = sanitizeFolderName(`Episode_${episodeToUpdate.number}`);
      const subDir = `${projectTitle}/${episodeFolder}`;
      
      const originalExt = finalFilePath.split('.').pop() || (type === 'RAW' ? 'mp4' : 'ass');
      const targetFileName = type === 'RAW' 
        ? (isHardsubEnabled ? `raw_video_hardsub.${originalExt}` : `raw_video.${originalExt}`) 
        : `subtitles.${originalExt}`;

      const copyRes = await ipcSafe.invoke('copy-file', {
        sourcePath: finalFilePath,
        targetDir: subDir,
        fileName: targetFileName
      });

      if (copyRes && copyRes.path) {
        // Re-fetch latest episode state before saving to avoid overwriting fields
        let latestEp = episodeToUpdate;
        try {
          const allProjects = await ipcSafe.invoke('get-projects');
          if (Array.isArray(allProjects)) {
            for (const p of allProjects) {
              const found = p.episodes?.find((e: any) => e.id === episodeToUpdate.id);
              if (found) {
                latestEp = found;
                break;
              }
            }
          }
        } catch (e) {}

        // Update episode in DB
        const updateData: any = {};
        if (type === 'RAW') {
          updateData.rawPath = copyRes.path;
          updateData.isHardsub = isHardsubEnabled;
        } else {
          updateData.subPath = copyRes.path;
          
          // Automatically extract characters and apply global mapping
          try {
            const result = await ipcSafe.invoke('get-raw-subtitles', updateData.subPath);
            if (result && result.actors) {
              const rawActors: string[] = result.actors;
              const lines: any[] = result.lines || [];
              
              const aliases: Record<string, string> = JSON.parse(selectedProject?.characterAliases || '{}');
              
              const lineCounts: Record<string, number> = {};
              lines.forEach(line => {
                const nameToUse = line.name || line.style || "Unknown";
                const mainName = aliases[nameToUse] || nameToUse;
                lineCounts[mainName] = (lineCounts[mainName] || 0) + 1;
              });

              const mainActors = Array.from(new Set(rawActors.map(name => {
                const nameToUse = name || "Unknown";
                return aliases[nameToUse] || nameToUse;
              }))).filter(name => !SIGN_KEYWORDS.includes(name as string)) as string[];

              const globalMappingRaw = selectedProject?.globalMapping || '[]';
              let globalMapping: {characterName: string, dubberId: string, isMain?: boolean}[] = [];
              try {
                const parsed = JSON.parse(globalMappingRaw);
                if (Array.isArray(parsed)) {
                  globalMapping = parsed;
                } else if (parsed && typeof parsed === 'object') {
                  globalMapping = Object.entries(parsed).map(([k, v]) => ({ characterName: k, dubberId: v as string }));
                }
              } catch (e) {}

              // Preserve existing assignments if any
              const existingAssignments = Array.isArray(latestEp.assignments) ? latestEp.assignments : [];
              const existingNames = new Set(existingAssignments.map(a => a.characterName));
              
              const toAdd = mainActors.filter(name => !existingNames.has(name));
              
              const newAssignments = toAdd.map((actor: string) => {
                const mappingEntry = globalMapping.find(m => m.characterName === actor);
                let dubberId = mappingEntry?.dubberId || "";
                let isMain = mappingEntry?.isMain || false;
                
                if (!dubberId) {
                  const matchedParticipant = participants.find(
                    p => p.nickname.toLowerCase() === actor.toLowerCase()
                  );
                  if (matchedParticipant) {
                    dubberId = matchedParticipant.id;
                  }
                }

                const dubber = participants.find(p => p.id === dubberId);
                return {
                  id: Math.random().toString(),
                  episodeId: latestEp.id,
                  characterName: actor,
                  dubberId: dubberId,
                  dubber: dubber,
                  status: "PENDING",
                  lineCount: lineCounts[actor] || 0,
                  isMain: isMain
                };
              });

              updateData.assignments = [...existingAssignments, ...newAssignments];
            }
          } catch (e) {
            console.error("Auto-extract characters failed:", e);
          }
        }
        
        // If both exist, move to ROLES status
        const finalSubPath = updateData.subPath || latestEp.subPath;
        const finalRawPath = updateData.rawPath || latestEp.rawPath;

        if (finalSubPath && finalRawPath) {
          updateData.status = 'ROLES';
        }

        await ipcSafe.invoke('save-episode', { ...latestEp, ...updateData });
        
        onRefresh();
        if (type === 'RAW' || !pendingMkvUpload) {
          toast.success(`${type === 'RAW' ? 'Видео' : 'Субтитры'} успешно загружены!`);
        }
      } else {
        toast.error('Ошибка при сохранении файла: Не удалось получить путь к файлу.');
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Upload error:', error);
        toast.error('Ошибка при обработке файла: ' + (error.message || String(error)));
      }
    } finally {
      setIsUploading(false);
      setStatus('');
      setTranscodingProgress(null);
    }
  };

  const handleFileSelect = async (type: 'RAW' | 'SUB') => {
    if (!currentEpisode) return;

    setIsUploading(true);
    
    try {
      const res = await ipcSafe.invoke('select-file', {
        filters: type === 'RAW' 
          ? [{ name: 'Videos', extensions: ['mp4', 'webm', 'mkv', 'avi', 'mov', 'ts', 'flv'] }] 
          : [{ name: 'Subtitles', extensions: ['ass', 'srt', 'vtt', 'ssa'] }]
      });

      if (!res || !res.path) {
        setIsUploading(false);
        return;
      }

      const filePath = res.path;
      const fileName = filePath.split(/[\\/]/).pop() || 'file';
      const ext = fileName.split('.').pop()?.toLowerCase();
      
      if ((type === 'RAW' || type === 'SUB') && ext === 'mkv') {
        setStatus("Чтение метаданных MKV...");
        const { subtitles, audios } = await inspectMkvTracks(filePath);
        if (subtitles.length > 0 || (audios.length > 1 && type === 'RAW')) {
          setSubtitleTracks(subtitles);
          setAudioTracks(audios);
          if (audios.length > 0) setSelectedAudioIndex(audios[0].index);
          setSelectedSubtitleIndex(undefined);
          setPendingMkvUpload({ filePath, type, episodeId: currentEpisode.id });
          setIsSubtitleSelectModalOpen(true);
          return;
        }
      }

      await processFileUpload(filePath, type);
    } catch (error: any) {
      if (error && error.message === 'Selection canceled') {
        setIsUploading(false);
        return;
      }
      console.error('Upload error:', error);
      toast.error('Ошибка при загрузке файла: ' + (error instanceof Error ? error.message : String(error)));
      setIsUploading(false);
    }
  };

  const handleMkvConfirmSingle = async (chosenSubIndex?: number, chosenAudioIndex?: number) => {
    if (!pendingMkvUpload) return;
    const { filePath, type, episodeId } = pendingMkvUpload;
    setIsSubtitleSelectModalOpen(false);
    await processFileUpload(filePath, type, chosenSubIndex, chosenAudioIndex, episodeId);
    setPendingMkvUpload(null);
    setSubtitleTracks([]);
    setAudioTracks([]);
  };

  const handleMkvConfirmMultiMerge = async (selectedTracks: MkvTrackInfo[], chosenAudioIndex?: number) => {
    if (!pendingMkvUpload) return;
    const { filePath, type, episodeId } = pendingMkvUpload;
    setIsMkvExtracting(true);
    setStatus("Извлечение выбранных дорожек субтитров из MKV...");
    try {
      const extracted = await extractSelectedMkvTracks(filePath, selectedTracks);
      if (extracted.length === 0) {
        toast.error("Не удалось извлечь выбранные субтитры из MKV");
        setIsMkvExtracting(false);
        setIsUploading(false);
        return;
      }

      if (type === 'RAW') {
        await processFileUpload(filePath, 'RAW', undefined, chosenAudioIndex, episodeId);
      }

      setMultiMergeInitialFiles(extracted);
      setIsSubtitleSelectModalOpen(false);
      setPendingMkvUpload(null);
      setSubtitleTracks([]);
      setAudioTracks([]);
      setIsMultiSubMergeModalOpen(true);
      toast.success(`Извлечено ${extracted.length} дорожек субтитров. Открыт мульти-импорт!`);
    } catch (err: any) {
      console.error("Multi-sub extraction error:", err);
      toast.error("Ошибка извлечения субтитров: " + (err.message || String(err)));
    } finally {
      setIsMkvExtracting(false);
      setIsUploading(false);
      setStatus("");
    }
  };

  const handleExtractSubtitlesFromEpisodeRaw = async () => {
    if (!currentEpisode?.rawPath) {
      toast.error('У текущей серии нет прикрепленного RAW видео');
      return;
    }
    const ext = (currentEpisode.rawPath.split('.').pop() || '').toLowerCase();
    if (ext === 'mkv') {
      try {
        const { subtitles, audios } = await inspectMkvTracks(currentEpisode.rawPath);
        if (subtitles.length > 0) {
          setSubtitleTracks(subtitles);
          setAudioTracks(audios);
          setPendingMkvUpload({ filePath: currentEpisode.rawPath, type: 'SUB', episodeId: currentEpisode.id });
          setIsSubtitleSelectModalOpen(true);
          return;
        } else {
          toast.info('В MKV файле этой серии не найдено встроенных субтитров');
        }
      } catch (e) {
        console.warn('Could not inspect rawPath for subtitles:', e);
      }
    }
    setMultiMergeInitialFiles([]);
    setIsMultiSubMergeModalOpen(true);
  };

  const handleYoutubeDownload = async (url: string, formatId: string, subLang: string) => {
    if (!currentEpisode || !selectedProject) return;

    setStatus('Скачивание с YouTube...');
    try {
      const projectTitle = sanitizeFolderName(selectedProject.title || 'Project');
      const episodeFolder = sanitizeFolderName(`Episode_${currentEpisode.number}`);
      const targetDir = `${projectTitle}/${episodeFolder}`;
      const baseFilename = `yt_${Date.now()}`;
      
      const res = await ipcSafe.invoke('youtube-download', {
        url, formatId, subLang, targetDir, baseFilename
      });

      if (res && (res.videoFile || res.subFile)) {
        const episodeToUpdate = { ...currentEpisode };
        if (res.videoFile) episodeToUpdate.rawPath = res.videoFile;
        if (res.subFile) {
          episodeToUpdate.subPath = res.subFile;
          // Trigger get-raw-subtitles so it handles formatting later
        }

        await ipcSafe.invoke('save-episode', episodeToUpdate);
        toast.success('Успешно скачано с YouTube!');
        onRefresh();
      }
    } catch (err: any) {
      toast.error('Ошибка: ' + err.message);
      throw err;
    } finally {
      setStatus('');
    }
  };

  useEffect(() => {
    getParticipants().then(setParticipants);
    ipcSafe.invoke('get-config').then(data => {});
    
    const progressListener = (percent: number) => {
      setTranscodingProgress(percent);
    };
    const cleanup = ipcSafe.on('ffmpeg-progress', progressListener);
    
    return () => {
      cleanup();
    };
  }, []);

  const [nextEpisodeDate, setNextEpisodeDate] = useState<string | null>(null);
  const [newEpisodeAvailable, setNewEpisodeAvailable] = useState<number | null>(null);

  useEffect(() => {
    const fetchNextDate = async () => {
      if (selectedProject?.nextEpisodeDate) {
        setNextEpisodeDate(selectedProject.nextEpisodeDate);
      } else {
        setNextEpisodeDate(null);
      }
      
      const queryTitle = selectedProject?.originalTitle || selectedProject?.title;
      if (queryTitle) {
        try {
          const date = await getNextEpisodeDate(queryTitle);
          if (date) {
            setNextEpisodeDate(date);
          }
        } catch (e) {
          console.error('Error fetching/updating next episode date on layout match:', e);
        }
      }
    };
    fetchNextDate();
  }, [selectedProject?.id]);

  useEffect(() => {
    if (!selectedProject || !selectedProject.originalTitle) {
      setNewEpisodeAvailable(null);
      return;
    }
    const checkNewOnTracker = async () => {
      try {
        // Primary: Check on Anime365
        const checkRes = await ipcSafe.invoke('anime365-check-new-episodes', { projectId: selectedProject.id });
        if (checkRes && checkRes.maxEpisode) {
          const currentMaxEp = selectedProject.episodes?.reduce((max, ep) => Math.max(max, ep.number), 0) || 0;
          if (checkRes.maxEpisode > currentMaxEp) {
            setNewEpisodeAvailable(checkRes.maxEpisode);
            return; // Found a new episode announcements, skip fallback
          } else {
            setNewEpisodeAvailable(null);
            return;
          }
        }
      } catch (err) {
        console.warn('Anime365 episode announcement check failed, falling back to Nyaa tracker:', err);
      }

      try {
        // Fallback: Quietly search for RAWs to see if a newer episode is already uploaded on Nyaa
        const results = await ipcSafe.invoke('search-nyaa-torrents', {
           query: selectedProject.originalTitle,
           category: 'anime',
           subCategory: 'raw'
        });
        
        if (results && Array.isArray(results) && results.length > 0) {
           let maxEpFound = 0;
           results.forEach(r => {
              const match = r.title ? r.title.match(/[ -_]0*([1-9]\d*)[ -_xv]/i) : null;
              if (match) {
                 const ep = parseInt(match[1]);
                 if (ep > maxEpFound && ep < 1000) maxEpFound = ep; // sanity check so it's not a year
              }
           });
           
           const currentMaxEp = selectedProject.episodes?.reduce((max, ep) => Math.max(max, ep.number), 0) || 0;
           if (maxEpFound > currentMaxEp) {
             setNewEpisodeAvailable(maxEpFound);
           } else {
             setNewEpisodeAvailable(null);
           }
        } else {
           setNewEpisodeAvailable(null);
        }
      } catch (err) {
        console.warn('Network error or tracker unavailable during new episode check', err);
      }
    };
    checkNewOnTracker();
  }, [selectedProject?.originalTitle, selectedProject?.episodes?.length]);

  const stats = {
    totalProjects: projects.length,
    activeEpisodes: projects.reduce((acc, p) => acc + (p.episodes?.filter(e => e.status !== 'FINISHED')?.length || 0), 0),
    finishedEpisodes: projects.reduce((acc, p) => acc + (p.episodes?.filter(e => e.status === 'FINISHED')?.length || 0), 0),
    pendingFixes: projects.reduce((acc, p) => acc + (p.episodes?.filter(e => e.status === 'FIXES')?.length || 0), 0)
  };

  const recentEpisodes = projects
    .flatMap(p => (p.episodes || []).map(e => ({ ...e, projectTitle: p.title })))
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
    .slice(0, 5);

  const handleSaveProjectDubbers = async (selectedDubbers: string[]) => {
    if (!selectedProject) return;
    const updatedProject = {
      ...selectedProject,
      assignedDubberIds: selectedDubbers
    };
    await ipcSafe.invoke('save-project', updatedProject);
    onRefresh();
    setIsAssignDubbersModalOpen(false);
  };


  const handleCreateProject = async (projectData: any) => {
    const newProject = {
      id: Date.now().toString(),
      title: projectData.title,
      originalTitle: projectData.originalTitle,
      releaseType: projectData.releaseType,
      emoji: projectData.emoji,
      isOngoing: projectData.isOngoing,
      synopsis: projectData.synopsis,
      posterUrl: projectData.posterUrl,
      typeAndSeason: projectData.typeAndSeason,
      totalEpisodes: projectData.totalEpisodes,
      globalMapping: JSON.stringify(projectData.characters.map((c: any) => ({ characterName: c.name, dubberId: c.dubberId, photoUrl: c.photoUrl }))),
      links: JSON.stringify({ tg: '', vk: '', anime365: '', shikimori: '', kodik: '' }),
      status: 'ACTIVE' as const,
      lastActiveEpisode: 1,
      assignedDubberIds: [],
      episodes: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    await ipcSafe.invoke('save-project', newProject);
    onRefresh();
    onProjectSelect(newProject.id);
    setIsNewProjectModalOpen(false);
  };

  const handleDeleteProject = async () => {
    if (!selectedProjectId) return;
    setConfirmState({
      isOpen: true,
      title: 'Удаление проекта',
      message: 'Вы уверены, что хотите удалить этот проект и все его серии? Это действие необратимо.',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await ipcSafe.invoke('delete-project', selectedProjectId);
          onProjectSelect('');
          onRefresh();
          setIsDeleteProjectModalOpen(false);
          toast.success('Проект удален');
        } catch (error) {
          console.error("Failed to delete project:", error);
          toast.error('Ошибка при удалении проекта');
        }
      }
    });
  };

  const handleDeleteEpisode = async () => {
    if (!currentEpisode) return;
    setConfirmState({
      isOpen: true,
      title: 'Удаление серии',
      message: `Вы уверены, что хотите удалить серию ${currentEpisode.number}?`,
      variant: 'danger',
      onConfirm: async () => {
        try {
          await ipcSafe.invoke('delete-episode', currentEpisode.id);
          onRefresh();
          setIsDeleteEpisodeModalOpen(false);
          toast.success('Серия удалена');
        } catch (error) {
          console.error("Failed to delete episode:", error);
          toast.error('Ошибка при удалении серии');
        }
      }
    });
  };

  const handleFinishEpisode = async () => {
    if (!currentEpisode) return;
    
    setConfirmState({
      isOpen: true,
      title: 'Завершение серии',
      message: `Вы уверены, что хотите отметить серию ${currentEpisode.number} как завершенную?`,
      variant: 'info',
      onConfirm: async () => {
        try {
          const updatedEpisode = {
            ...currentEpisode,
            status: 'FINISHED' as EpisodeStatus
          };
          await ipcSafe.invoke('save-episode', updatedEpisode);
          onRefresh();
          toast.success('Серия завершена!');
        } catch (error) {
          console.error("Failed to finish episode:", error);
          toast.error('Ошибка при завершении серии');
        }
      }
    });
  };

  const handleCreateEpisode = async (episodeNumber: number) => {
    if (!selectedProjectId || !selectedProject) return;
    
    let episodeTitle = '';
    try {
      const fetchedTitle = await ipcSafe.invoke('get-episode-title', {
        title: selectedProject.title,
        originalTitle: selectedProject.originalTitle,
        episodeNumber,
        anime365Id: selectedProject.anime365Id
      });
      if (fetchedTitle) {
        episodeTitle = fetchedTitle;
      }
    } catch (e) {
      console.warn('Failed to fetch episode title on creation:', e);
    }

    const newEpisode = {
      id: Date.now().toString(),
      projectId: selectedProjectId,
      number: episodeNumber,
      title: episodeTitle,
      status: 'UPLOAD',
      deadline: calculateDeadline(selectedProject),
      assignments: [],
      uploads: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    await ipcSafe.invoke('save-episode', newEpisode);
    
    onRefresh();
    setIsNewEpisodeModalOpen(false);
  };

  useEffect(() => {
    // We don't need to set newEpisodeNumber here anymore
  }, [selectedProject, isNewEpisodeModalOpen]);

  const handleExportProject = async () => {
    if (!selectedProject) return;
    
    // Get all participants to include them in the export for full portability
    const allParticipants = await ipcSafe.invoke('get-participants');
    
    const exportData = {
      type: "PROJECT_RELEASE_BUNDLE",
      version: "1.2",
      exportDate: new Date().toISOString(),
      project: selectedProject,
      // Full list of participants ensures we can restore all references
      participants: allParticipants,
      // We can also include some summary stats for the "Audit"
      audit: {
        totalEpisodes: selectedProject.episodes?.length || 0,
        totalAssignments: selectedProject.episodes?.reduce((acc, ep) => acc + (ep.assignments?.length || 0), 0) || 0,
        totalUploads: selectedProject.episodes?.reduce((acc, ep) => acc + (ep.uploads?.length || 0), 0) || 0,
        completedEpisodes: selectedProject.episodes?.filter(ep => ep.status === 'FINISHED')?.length || 0
      }
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `${selectedProject.title}_release_audit_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleAssignRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentEpisode || !selectedUserId || !characterName || !selectedProject) return;

    // Check aliases
    const aliases: Record<string, string> = JSON.parse(selectedProject.characterAliases || '{}');
    const mainName = aliases[characterName] || characterName;

    // Check if already assigned in this episode
    const existing = Array.isArray(currentEpisode.assignments) ? currentEpisode.assignments.find(a => a.characterName === mainName) : undefined;
    if (existing) {
      if (existing.dubberId === selectedUserId) {
        toast.error('Этот дабер уже назначен на этого персонажа в этой серии.');
        return;
      }
      
      setConfirmState({
        isOpen: true,
        title: 'Переназначение роли',
        message: `Персонаж "${mainName}" уже назначен на ${participants.find(p => p.id === existing.dubberId)?.nickname}. Переназначить на ${participants.find(p => p.id === selectedUserId)?.nickname}?`,
        onConfirm: async () => {
          // Remove existing assignment for this character
          const currentAssignments = Array.isArray(currentEpisode.assignments) ? currentEpisode.assignments.filter(a => a.characterName !== mainName) : [];
          
          const newAssignment = {
            id: Date.now().toString(),
            episodeId: currentEpisode.id,
            characterName: mainName,
            dubberId: selectedUserId,
            status: 'PENDING'
          };
          
          const updatedEpisode = {
            ...currentEpisode,
            assignments: [...currentAssignments, newAssignment]
          };
          
          await ipcSafe.invoke('save-episode', updatedEpisode);
          onRefresh();
          toast.success('Роль переназначена');
        }
      });
      return;
    }

    const newAssignment = {
      id: Date.now().toString(),
      episodeId: currentEpisode.id,
      characterName: mainName,
      dubberId: selectedUserId,
      status: 'PENDING'
    };
    
    const updatedEpisode = {
      ...currentEpisode,
      assignments: [...(Array.isArray(currentEpisode.assignments) ? currentEpisode.assignments : []), newAssignment]
    };
    
    await ipcSafe.invoke('save-episode', updatedEpisode);

    // Also update global mapping if not already there
    let globalMapping: {characterName: string, dubberId: string}[] = [];
    try {
      const parsed = JSON.parse(selectedProject.globalMapping || '[]');
      if (Array.isArray(parsed)) {
        globalMapping = parsed;
      } else if (parsed && typeof parsed === 'object') {
        globalMapping = Object.entries(parsed).map(([k, v]) => ({ characterName: k, dubberId: v as string }));
      }
    } catch (e) {
      console.error("Error parsing global mapping:", e);
    }
    const pairExists = globalMapping.some(c => c.characterName === mainName && c.dubberId === selectedUserId);
    
    if (!pairExists) {
      const emptyIdx = globalMapping.findIndex(c => c.characterName === mainName && !c.dubberId);
      if (emptyIdx !== -1) {
        globalMapping[emptyIdx].dubberId = selectedUserId;
      } else {
        globalMapping.push({ characterName: mainName, dubberId: selectedUserId });
      }
      await ipcSafe.invoke('save-project', { ...selectedProject, globalMapping: JSON.stringify(globalMapping) });
    }

    onRefresh();
    setIsAssignModalOpen(false);
    setSelectedUserId('');
    setCharacterName('');
  };

  const handleAssignSoundEngineer = async (soundEngineerId: string) => {
    if (selectedProject) {
      const updatedProject = { ...selectedProject, soundEngineerId };
      await ipcSafe.invoke('save-project', updatedProject);
    }
    onRefresh();
    setIsAssignSoundEngineerModalOpen(false);
  };

  return (
    <div className="p-8 w-full max-w-none mx-auto space-y-8">
      {projects.length === 0 ? (
        <GettingStartedGuide onStart={() => setIsNewProjectModalOpen(true)} />
      ) : !selectedProjectId ? (
        <GeneralHub 
          projects={projects}
          onProjectSelect={onProjectSelect}
          onEpisodeSelect={onEpisodeSelect}
          onRefresh={onRefresh}
          onCreateProjectClick={() => setIsNewProjectModalOpen(true)}
        />
      ) : (
        <div className="space-y-8">
          {/* Top Control Bar for selected project detail view */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-neutral-850 text-left">
            <button
              onClick={() => onProjectSelect('')}
              className="flex items-center gap-2 text-neutral-400 hover:text-white font-bold text-xs bg-neutral-900 border border-neutral-800 hover:border-neutral-700 px-4 py-2.5 rounded-xl transition-all cursor-pointer shrink-0"
              title="Вернуться к списку проектов"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Все проекты</span>
            </button>

            <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto justify-end">
              <select 
                value={selectedProjectId || ''} 
                onChange={(e) => onProjectSelect(e.target.value)}
                className="bg-neutral-900 border border-neutral-800 text-white text-xs rounded-xl pl-4 pr-10 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 appearance-none min-w-[180px]"
              >
                {projects
                  ?.filter(p => p.status !== 'COMPLETED')
                  .map(p => (
                    <option key={p.id} value={p.id}>{p.emoji || '❤️'} {p.title}</option>
                  ))}
              </select>
              
              <button 
                onClick={() => setIsAssignDubbersModalOpen(true)}
                className="p-2.5 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-xl text-neutral-400 hover:text-white transition-colors cursor-pointer"
                title="Назначить даберов на этот проект"
              >
                <UserPlus className="w-4.5 h-4.5" />
              </button>
              <button 
                onClick={() => setIsAssignSoundEngineerModalOpen(true)}
                className="p-2.5 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-xl text-neutral-400 hover:text-white transition-colors cursor-pointer"
                title="Назначить звукорежиссера"
              >
                <Mic className="w-4.5 h-4.5" />
              </button>
              <button 
                onClick={() => setIsRolesGridModalOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 hover:text-indigo-300 rounded-xl text-xs font-bold transition-colors border border-indigo-500/10 cursor-pointer"
                title="Открыть сетку ролей проекта"
              >
                <Table className="w-4 h-4" />
                Сетка ролей
              </button>
              <button 
                onClick={() => setIsTelegramClientModalOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-2.5 bg-sky-950/50 hover:bg-sky-900/60 text-sky-300 hover:text-sky-200 rounded-xl text-xs font-bold transition-all border border-sky-800/50 cursor-pointer shadow-sm"
                title="Открыть Telegram MTProto User Client (Вариант 2)"
              >
                <Send className="w-4 h-4 text-sky-400" />
                <span>Telegram Client</span>
              </button>
              <button 
                onClick={() => setIsCharacterManagementModalOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-xl text-neutral-300 hover:text-white text-xs font-bold transition-colors cursor-pointer"
                title="Управление персонажами"
              >
                <Users className="w-4 h-4" />
                Персонажи
              </button>
              <button 
                onClick={() => setIsNewEpisodeModalOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md shadow-blue-600/10"
                title="Добавить новую серию в проект"
              >
                <Plus className="w-4 h-4" />
                Добавить серию
              </button>
              <button 
                onClick={() => setIsProjectSettingsModalOpen(true)}
                className="p-2.5 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-xl text-neutral-400 hover:text-white transition-colors cursor-pointer"
                title="Настройки проекта"
              >
                <Settings2 className="w-4.5 h-4.5" />
              </button>
              <button 
                onClick={handleDeleteProject}
                className="p-2.5 bg-red-950/20 border border-red-900/30 hover:bg-red-900/40 rounded-xl text-red-400 hover:text-red-300 transition-colors cursor-pointer"
                title="Удалить проект"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
          </div>

          {selectedProject && (
        <div className="space-y-8">
          {newEpisodeAvailable && (
            <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4 flex items-center justify-between text-indigo-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-500/20 rounded-lg shrink-0">
                  <Download className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <div className="font-bold text-indigo-300">Доступна новая серия!</div>
                  <div className="text-sm opacity-80">На трекере найдена {newEpisodeAvailable} серия (у вас максимум {selectedProject.episodes?.reduce((max, ep) => Math.max(max, ep.number), 0) || 0})</div>
                </div>
              </div>
              <button 
                onClick={() => {
                    setTorrentQuery(`${selectedProject.originalTitle} ${newEpisodeAvailable}`);
                    setDownloadStep('search');
                    setIsTorrentModalOpen(true);
                }}
                className="px-4 py-2 bg-indigo-500 hover:bg-indigo-400 text-white rounded-xl shadow-lg shadow-indigo-500/20 text-sm font-semibold transition-colors cursor-pointer"
              >
                Скачать
              </button>
            </div>
          )}
          {/* Project Info Section */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-xl flex flex-col md:flex-row">
            {selectedProject.posterUrl && (
              <div className="w-full md:w-48 h-72 md:h-auto flex-shrink-0 relative">
                <img 
                  src={selectedProject.posterUrl} 
                  alt={selectedProject.title} 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const parent = e.currentTarget.parentElement;
                    if (parent) {
                      const fallback = document.createElement('div');
                      fallback.className = "w-full h-full min-h-[18rem] bg-gradient-to-br from-neutral-800 to-neutral-900 flex flex-col items-center justify-center text-neutral-400 font-bold p-4 text-center gap-2";
                      fallback.innerHTML = `<span class="text-3xl">🎬</span><span class="text-xs">Постер временно недоступен</span>`;
                      parent.appendChild(fallback);
                    }
                  }}
                />
              </div>
            )}
            <div className="p-6 flex-1 space-y-4 text-left">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-bold text-white mb-1">{selectedProject.emoji || '❤️'} {selectedProject.title}</h1>
                  <div className="text-neutral-500 font-medium italic">{selectedProject.originalTitle}</div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      const projectTitle = sanitizeFolderName(selectedProject.title || 'Project');
                      ipcSafe.invoke('open-path', projectTitle);
                    }}
                    className="px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-full text-xs font-bold border border-neutral-700 flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 duration-100 font-sans"
                    title="Открыть рабочую папку проекта"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    Папка проекта
                  </button>
                  <button
                    onClick={() => setIsNotificationTemplatesModalOpen(true)}
                    className="px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-full text-xs font-bold border border-neutral-700 flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 duration-100 font-sans"
                    title="Настроить шаблоны уведомлений в Telegram"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Шаблоны уведомлений
                  </button>
                  <button
                    onClick={handleUpdateProjectData}
                    disabled={isUpdatingProjectData}
                    className="px-3 py-1 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-neutral-300 rounded-full text-xs font-bold border border-neutral-700 flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 duration-100 font-sans"
                    title="Подтянуть и обновить всю информацию о проекте из Anime365"
                  >
                    {isUpdatingProjectData ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    Обновить данные
                  </button>
                  <div className="px-3 py-1 bg-blue-500/10 text-blue-400 rounded-full text-xs font-bold border border-blue-500/20">
                    {RELEASE_TYPE_LABELS[selectedProject.releaseType || 'VOICEOVER']}
                  </div>
                  {selectedProject.isOngoing && (
                    <div className="px-3 py-1 bg-green-500/10 text-green-400 rounded-full text-xs font-bold border border-green-500/20 flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      Онгоинг
                    </div>
                  )}
                </div>
              </div>
              
              {selectedProject.synopsis && (
                <div className="text-neutral-400 text-sm leading-relaxed">
                  {selectedProject.synopsis}
                </div>
              )}
              
              {selectedProject.links && (() => {
                try {
                  const parsedLinks = JSON.parse(selectedProject.links);
                  const validLinks = Object.entries(parsedLinks).filter(([k, v]) => v && typeof v === 'string' && (k === 'shikimori' || k === 'anime365' || k === 'mal' || k === 'animedb' || k === 'kodik' || k === 'vk' || k === 'tg'));
                  if (validLinks.length > 0) {
                    return (
                      <div className="flex flex-wrap gap-2 pt-1 pb-1">
                        {validLinks.map(([key, url]) => (
                          <a 
                            key={key} 
                            href={url as string} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="px-2.5 py-1 bg-neutral-900 border border-neutral-700 hover:border-neutral-500 hover:bg-neutral-800 text-neutral-300 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
                          >
                            <ExternalLink className="w-3 h-3" />
                            {key}
                          </a>
                        ))}
                      </div>
                    );
                  }
                } catch(e) {}
                return null;
              })()}
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
                <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-800">
                  <div className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider mb-1">Серий (Вышло / Всего)</div>
                  <div className="text-lg font-bold text-white">
                    <span className="text-emerald-400">{selectedProject.airedEpisodes || selectedProject.episodes?.length || 0}</span>
                    <span className="text-neutral-600 mx-1">/</span>
                    <span>{selectedProject.totalEpisodes || '?'}</span>
                  </div>
                </div>
                <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-800">
                  <div className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider mb-1">След. серия</div>
                  <div className="text-lg font-bold text-blue-400">{nextEpisodeDate || 'Неизвестно'}</div>
                </div>
                <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-800">
                  <div className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider mb-1">Звукорежиссер</div>
                  <div className="text-lg font-bold text-purple-400 truncate">
                    {participants.find(p => p.id === selectedProject.soundEngineerId)?.nickname || '—'}
                  </div>
                </div>
                <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-800">
                  <div className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider mb-1">Даберы</div>
                  <div className="text-lg font-bold text-emerald-400">
                    {selectedProject.assignedDubberIds?.length || 0}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Episode Selector */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {selectedProject?.episodes?.map((ep, idx) => (
              <button
                key={ep.id || ('ep-' + idx)}
                onClick={() => onEpisodeSelect(ep.number)}
                className={`flex-shrink-0 px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 border ${
                  currentEpisode?.id === ep.id 
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20 border-blue-400' 
                    : ep.status === 'FINISHED' ? 'bg-green-900/20 text-green-400 border-green-900/50 hover:bg-green-900/30' :
                      ep.status === 'FIXES' ? 'bg-red-900/20 text-red-400 border-red-900/50 hover:bg-red-900/30' :
                      'bg-neutral-900 text-neutral-400 border-transparent hover:bg-neutral-800'
                }`}
              >
                Серия {ep.number}
                <div className="flex gap-0.5">
                  {ep.rawPath && <div className="w-1.5 h-1.5 rounded-full bg-blue-400" title="Видео загружено" />}
                  {ep.subPath && <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" title="Субтитры загружены" />}
                </div>
              </button>
            ))}
          </div>

          {currentEpisode && (
            <div className="space-y-8">
              {/* Episode Status Header */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-bold text-white mb-1">
                      Серия {currentEpisode.number}
                      {currentEpisode.title && (
                        <span className="text-lg font-medium text-neutral-400 ml-3 font-sans">
                          — {currentEpisode.title}
                        </span>
                      )}
                    </h2>
                    <button 
                      onClick={handleDeleteEpisode}
                      className="p-1 text-neutral-500 hover:text-red-400 transition-colors"
                      title="Удалить серию"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <div className="flex gap-2">
                      {currentEpisode.yandexUrl && (
                        <a 
                          href={currentEpisode.yandexUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-1 bg-yellow-500/20 text-yellow-500 border border-yellow-500/30 hover:bg-yellow-500/30 rounded text-xs transition-colors flex items-center gap-1 font-bold"
                          title="Ссылка на материалы на Яндексе"
                        >
                          <Database className="w-3.5 h-3.5" />
                          Яндекс Диск
                        </a>
                      )}
                      <button onClick={() => { setExportRole('DABBER'); setIsExportModalOpen(true); }} className="px-2 py-1 bg-green-600 hover:bg-green-500 text-white rounded text-xs transition-colors">Экспорт Даберам</button>
                      <button onClick={() => { setExportRole('SOUND_ENGINEER'); setIsExportModalOpen(true); }} className="px-2 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded text-xs transition-colors">Экспорт Звукарю</button>
                      <button 
                        onClick={handleFinishEpisode}
                        disabled={currentEpisode.status === 'FINISHED'}
                        className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 text-white rounded text-xs font-bold transition-colors"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Завершить серию
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-neutral-400 text-sm">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      <span>Статус: <span className="text-blue-400 font-medium">{STATUS_LABELS[currentEpisode.status]}</span></span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Mic className="w-4 h-4" />
                      <span>Звукореж: <span className="text-purple-400 font-medium">{participants.find(p => p.id === selectedProject?.soundEngineerId)?.nickname || 'Не назначен'}</span></span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      <span>Даберы: <span className="text-emerald-400 font-medium">{Array.isArray(selectedProject?.assignedDubberIds) && selectedProject.assignedDubberIds.length > 0 ? selectedProject.assignedDubberIds.map(id => participants.find(p => p.id === id)?.nickname).filter(Boolean).join(', ') : 'Не назначены'}</span></span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      <span>Дедлайн: <span className="text-red-400 font-medium">{formatDeadline(currentEpisode.deadline)}</span></span>
                    </div>
                    {currentEpisode.airingDate && (
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-emerald-500" />
                        <span>Эфир: <span className="text-emerald-400 font-medium">{currentEpisode.airingDate}</span></span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      <span>Дата след. серии: <span className="text-orange-400 font-medium">{nextEpisodeDate || 'Не определена'}</span></span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-sm text-neutral-400">Ориг. название</div>
                    <div className="text-white font-medium">{selectedProject?.originalTitle || 'Не задано'}</div>
                  </div>
                  {/* Workflow Stepper */}
                  <div className="flex items-center gap-1">
                    {(Object.keys(STATUS_LABELS) as EpisodeStatus[]).map((status, idx) => (
                      <React.Fragment key={status}>
                        <div 
                          className={`w-3 h-3 rounded-full ${
                            currentEpisode.status === status ? 'bg-blue-500 ring-4 ring-blue-500/20' : 
                            idx < Object.keys(STATUS_LABELS).indexOf(currentEpisode.status) ? 'bg-green-500' : 'bg-neutral-800'
                          }`}
                          title={STATUS_LABELS[status]}
                        />
                        {idx < Object.keys(STATUS_LABELS).length - 1 && (
                          <div className={`w-4 h-px ${idx < Object.keys(STATUS_LABELS).indexOf(currentEpisode.status) ? 'bg-green-500' : 'bg-neutral-800'}`} />
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              </div>

              {/* File Upload Section */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                      <FileVideo className="w-5 h-5 text-blue-400" />
                      Видео файл (RAW)
                      <button 
                        onClick={() => setIsYoutubeModalOpen(true)}
                        className="ml-2 text-red-500 hover:text-red-400 transition-colors p-1 bg-red-500/10 hover:bg-red-500/20 rounded-md"
                        title="Скачать с YouTube"
                      >
                        <Youtube className="w-4 h-4" />
                      </button>
                    </h3>
                    {currentEpisode.rawPath ? (
                      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-green-500 bg-green-500/10 px-2 py-1 rounded-full border border-green-500/20">
                        <CheckCircle2 className="w-3 h-3" />
                        Загружено {currentEpisode.isHardsub && '(Хардсаб)'}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-500 bg-amber-500/10 px-2 py-1 rounded-full border border-amber-500/20">
                        <AlertCircle className="w-3 h-3" />
                        Ожидание
                      </span>
                    )}
                  </div>
                  <label className={`flex items-center justify-center gap-2 w-full ${currentEpisode.rawPath ? 'bg-green-500/5 border-green-500/20' : 'bg-neutral-950 border-neutral-800'} border border-dashed hover:border-blue-500/50 text-neutral-400 hover:text-blue-400 px-4 py-4 rounded-lg cursor-pointer transition-all group`} onClick={() => handleFileSelect('RAW')}>
                    {isUploading ? (
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        {transcodingProgress !== null && (
                          <span className="text-xs">{transcodingProgress}%</span>
                        )}
                      </div>
                    ) : (
                      <FileVideo className="w-5 h-5 group-hover:scale-110 transition-transform" />
                    )}
                    <span className="text-sm font-medium">{isUploading ? (status || 'Обработка...') : 'Выбрать видео'}</span>
                  </label>
                  <p className="text-xs text-amber-500/70 mt-2">
                    * Внимание: формат .mkv не поддерживается для воспроизведения в браузере. Используйте .mp4 или .webm
                  </p>
                  <div className="mt-4 flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="hardsub-checkbox"
                      checked={isHardsubEnabled}
                      onChange={async (e) => {
                        const checked = e.target.checked;
                        setIsHardsubEnabled(checked);
                        if (currentEpisode) {
                          await ipcSafe.invoke('save-episode', { ...currentEpisode, isHardsub: checked });
                          onRefresh();
                        }
                      }}
                      className="w-4 h-4 rounded border-neutral-700 bg-neutral-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-neutral-900"
                    />
                    <label htmlFor="hardsub-checkbox" className="text-sm text-neutral-300 cursor-pointer select-none">
                      Хардсаб (видео уже с вшитыми субтитрами)
                    </label>
                  </div>

                  <button
                    onClick={openTorrentDownloadModal}
                    type="button"
                    className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 hover:text-indigo-300 border border-indigo-500/20 hover:border-indigo-500/40 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer"
                  >
                    <Globe className="w-4 h-4 text-indigo-400" />
                    Скачать RAW с торрента
                  </button>
                </div>

                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                      <FileText className="w-5 h-5 text-indigo-400" />
                      Файл субтитров (.ass)
                    </h3>
                    {currentEpisode.subPath ? (
                      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-green-500 bg-green-500/10 px-2 py-1 rounded-full border border-green-500/20">
                        <CheckCircle2 className="w-3 h-3" />
                        Загружено
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-500 bg-amber-500/10 px-2 py-1 rounded-full border border-amber-500/20">
                        <AlertCircle className="w-3 h-3" />
                        Ожидание
                      </span>
                    )}
                  </div>
                  <label 
                    id="step-upload-sub"
                    className={`flex items-center justify-center gap-2 w-full ${currentEpisode.subPath ? 'bg-green-500/5 border-green-500/20' : 'bg-neutral-950 border-neutral-800'} border border-dashed hover:border-indigo-500/50 text-neutral-400 hover:text-indigo-400 px-4 py-4 rounded-lg cursor-pointer transition-all group`} 
                    onClick={() => handleFileSelect('SUB')}
                  >
                    {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5 group-hover:scale-110 transition-transform" />}
                    <span className="text-sm font-medium">{isUploading ? 'Загрузка...' : 'Выбрать субтитры'}</span>
                  </label>
                  <button
                    onClick={openSubtitleDownloadModal}
                    type="button"
                    className="mt-3 w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 hover:text-emerald-300 border border-emerald-500/10 hover:border-emerald-500/30 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer font-sans"
                  >
                    <Languages className="w-4 h-4 text-emerald-400" />
                    Скачать субтитры онлайн
                  </button>
                  <button
                    onClick={() => setIsTextToSubModalOpen(true)}
                    type="button"
                    className="mt-2 w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 hover:text-blue-300 border border-blue-500/10 hover:border-blue-500/30 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer font-sans"
                  >
                    <FileText className="w-4 h-4 text-blue-400" />
                    Сгенерировать из текста
                  </button>
                  {currentEpisode?.rawPath && currentEpisode.rawPath.toLowerCase().endsWith('.mkv') && (
                    <button
                      onClick={handleExtractSubtitlesFromEpisodeRaw}
                      type="button"
                      className="mt-2 w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-purple-600/10 hover:bg-purple-600/20 text-purple-400 hover:text-purple-300 border border-purple-500/10 hover:border-purple-500/30 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer font-sans"
                    >
                      <Film className="w-4 h-4 text-purple-400" />
                      Извлечь сабы из MKV серии
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setMultiMergeInitialFiles([]);
                      setIsMultiSubMergeModalOpen(true);
                    }}
                    type="button"
                    className="mt-2 w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 hover:text-indigo-300 border border-indigo-500/10 hover:border-indigo-500/30 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer font-sans"
                  >
                    <Layers className="w-4 h-4 text-indigo-400" />
                    Мульти-импорт / Слить сабы
                  </button>
                </div>
              </div>

              {/* Assignments Table */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
                <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-white">Распределение ролей</h3>
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={handleGenerateReminderMessage}
                      className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      <Clock className="w-4 h-4" />
                      Напомнить о сдаче
                    </button>
                    <button 
                      onClick={() => setIsAssignModalOpen(true)}
                      className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      <UserPlus className="w-4 h-4" />
                      Назначить роль
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-neutral-950/50 text-neutral-400 text-xs uppercase tracking-wider">
                        <th className="px-6 py-4 font-semibold">Даббер</th>
                        <th className="px-6 py-4 font-semibold">Персонажи</th>
                        <th className="px-6 py-4 font-semibold">Статус</th>
                        <th className="px-6 py-4 font-semibold text-right">Действия</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800">
                      {(() => {
                        const grouped: Record<string, any> = {};
                        currentEpisode?.assignments?.forEach(as => {
                          const dubberId = as.substituteId || as.dubberId;
                          if (!grouped[dubberId]) {
                            grouped[dubberId] = {
                              dubber: as.substitute || as.dubber,
                              characters: [as.characterName],
                              statuses: [as.status],
                              lineCount: as.lineCount || 0
                            };
                          } else {
                            if (!grouped[dubberId].characters.includes(as.characterName)) {
                              grouped[dubberId].characters.push(as.characterName);
                            }
                            grouped[dubberId].statuses.push(as.status);
                            grouped[dubberId].lineCount += (as.lineCount || 0);
                          }
                        });

                        return Object.entries(grouped).map(([dubberId, data], idx) => {
                          // Determine overall status for the dubber
                          const allApproved = data.statuses.every((s: string) => s === 'APPROVED');
                          const anyFixes = data.statuses.some((s: string) => s === 'FIXES_NEEDED' || s === 'REJECTED');
                          const displayStatus = allApproved ? 'APPROVED' : anyFixes ? 'FIXES_NEEDED' : data.statuses[0];

                          return (
                            <tr key={(dubberId || 'dubber') + idx} className="hover:bg-neutral-800/30 transition-colors group">
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-full bg-blue-600/20 flex items-center justify-center text-xs text-blue-400 border border-blue-500/20 font-bold">
                                    {data.dubber?.nickname?.charAt(0) || '?'}
                                  </div>
                                  <span className="text-white font-medium">{data.dubber?.nickname || '...'}</span>
                                  <span className="text-[10px] text-neutral-500 ml-2">({data.lineCount} реп.)</span>
                                </div>
                              </td>
                              <td className="px-6 py-4 text-neutral-400 text-sm">
                                {data.characters.join(', ')}
                              </td>
                              <td className="px-6 py-4">
                                <span className={`px-2 py-1 rounded-full text-[10px] font-bold border ${
                                  displayStatus === 'APPROVED' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                                  displayStatus === 'FIXES_NEEDED' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' :
                                  'bg-neutral-800 text-neutral-400 border-neutral-700'
                                }`}>
                                  {ROLE_STATUS_LABELS[displayStatus] || displayStatus || 'Ожидает'}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-right">
                                <button 
                                  onClick={() => onNavigate?.('QA')}
                                  className="text-neutral-500 hover:text-blue-400 transition-colors p-2 hover:bg-blue-500/10 rounded-lg"
                                  title="Проверить в QA"
                                >
                                  <Activity className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        });
                      })()}
                      {(!currentEpisode?.assignments || currentEpisode.assignments?.length === 0) && (
                        <tr>
                          <td colSpan={4} className="px-6 py-12 text-center text-neutral-500 italic">
                            Роли еще не распределены. Используйте утилиту ASS или назначьте вручную.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}


      {/* New Project Modal */}
      <CreateProjectModal 
        isOpen={isNewProjectModalOpen} 
        onClose={() => setIsNewProjectModalOpen(false)} 
        onCreate={handleCreateProject} 
      />

      {/* New Episode Modal */}
      <CreateEpisodeModal
        isOpen={isNewEpisodeModalOpen}
        onClose={() => setIsNewEpisodeModalOpen(false)}
        onCreate={handleCreateEpisode}
        defaultEpisodeNumber={(selectedProject?.episodes?.reduce((max, ep) => Math.max(max, ep.number), 0) || 0) + 1}
      />

      {/* Assign Dubbers Modal */}
      <AssignDubbersModal
        isOpen={isAssignDubbersModalOpen}
        onClose={() => setIsAssignDubbersModalOpen(false)}
        participants={participants}
        initialSelectedDubbers={selectedProject?.assignedDubberIds || []}
        onSave={handleSaveProjectDubbers}
      />

      {/* Assign Role Modal */}
      {isAssignModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Назначить роль</h2>
              <button onClick={() => setIsAssignModalOpen(false)} className="text-neutral-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleAssignRole} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-2">Имя персонажа</label>
                <input 
                  type="text" 
                  value={characterName} 
                  onChange={(e) => setCharacterName(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Напр: Наруто"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-2">Дабер</label>
                <select 
                  value={selectedUserId} 
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                  required
                >
                  <option value="">Выберите дабера</option>
                  {participants.map((p, idx) => (
                    <option key={(p.id || 'p') + idx} value={p.id}>{p.nickname}</option>
                  ))}
                </select>
              </div>
              <button type="submit" className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors">Назначить</button>
            </form>
          </div>
        </div>
      )}

      {/* Character Management Modal */}
      <CharacterManagementModal
        isOpen={isCharacterManagementModalOpen}
        onClose={() => setIsCharacterManagementModalOpen(false)}
        selectedProject={selectedProject}
        participants={participants}
        onRefresh={onRefresh}
      />

      {isRolesGridModalOpen && (
        <RolesGridModal
          project={selectedProject}
          participants={participants}
          onClose={() => setIsRolesGridModalOpen(false)}
        />
      )}

      {isYoutubeModalOpen && (
        <YoutubeDownloadModal
          isOpen={isYoutubeModalOpen}
          onClose={() => setIsYoutubeModalOpen(false)}
          onDownload={handleYoutubeDownload}
        />
      )}

      {/* Assign Sound Engineer Modal */}
      <AssignSoundEngineerModal
        isOpen={isAssignSoundEngineerModalOpen}
        onClose={() => setIsAssignSoundEngineerModalOpen(false)}
        participants={participants}
        initialSoundEngineerId={selectedProject?.soundEngineerId || ''}
        onAssign={handleAssignSoundEngineer}
      />

      {/* Project Settings Modal */}
      {isProjectSettingsModalOpen && projects.find(p => p.id === selectedProjectId) && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden pointer-events-auto">
            <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings2 className="w-5 h-5 text-indigo-400" />
                <h2 className="text-xl font-semibold text-white">Настройки проекта</h2>
              </div>
              <button onClick={() => setIsProjectSettingsModalOpen(false)} className="text-neutral-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-8 space-y-8">
              {(() => {
                const project = projects.find(p => p.id === selectedProjectId)!;
                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-6">
                      <div>
                        <label className="block text-xs font-bold text-neutral-500 uppercase mb-2 ml-1">Эмодзи проекта</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500">✨</span>
                          <input
                            type="text"
                            value={project.emoji || ''}
                            onChange={async (e) => {
                              await ipcSafe.invoke('save-project', { 
                                ...project, 
                                emoji: e.target.value 
                              });
                              onRefresh();
                            }}
                            className="w-full bg-black border border-neutral-800 rounded-xl py-3 pl-10 pr-4 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                            placeholder="❤️, 📢..."
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-neutral-500 uppercase mb-2 ml-1">Тип и Сезон (напр. TV1)</label>
                        <div className="relative">
                          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                          <input
                            type="text"
                            value={project.typeAndSeason || ''}
                            onChange={async (e) => {
                              await ipcSafe.invoke('save-project', { 
                                ...project, 
                                typeAndSeason: e.target.value 
                              });
                              onRefresh();
                            }}
                            className="w-full bg-black border border-neutral-800 rounded-xl py-3 pl-10 pr-4 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                            placeholder="TV1, Movie, OVA..."
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-neutral-500 uppercase mb-2 ml-1">Дедлайн серии</label>
                        <div className="relative">
                          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                          <input
                            type="date"
                            value={currentEpisode?.deadline ? new Date(currentEpisode.deadline).toISOString().split('T')[0] : ''}
                            onChange={async (e) => {
                              if (currentEpisode) {
                                await ipcSafe.invoke('save-episode', { ...currentEpisode, deadline: e.target.value });
                                onRefresh();
                              }
                            }}
                            className="w-full bg-black border border-neutral-800 rounded-xl py-3 pl-10 pr-4 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-neutral-500 uppercase mb-2 ml-1">Всего серий</label>
                        <div className="relative">
                          <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                          <input
                            type="number"
                            value={project.totalEpisodes}
                            onChange={async (e) => {
                              await ipcSafe.invoke('save-project', { 
                                ...project, 
                                totalEpisodes: parseInt(e.target.value) 
                              });
                              onRefresh();
                            }}
                            className="w-full bg-black border border-neutral-800 rounded-xl py-3 pl-10 pr-4 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-6">
                      {/* Telegram Integration Section */}
                      <div className="bg-sky-950/30 border border-sky-800/50 p-4 rounded-2xl space-y-3">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="w-4 h-4 text-sky-400" />
                          <span className="text-xs font-bold text-sky-300 uppercase tracking-wider">Telegram-Чаты Проекта</span>
                        </div>
                        <p className="text-[11px] text-neutral-400">
                          Настройте раздельные чаты для выгрузки серий и работы с командой актеров:
                        </p>

                        <div>
                          <label className="block text-[11px] font-semibold text-neutral-300 mb-1">
                            📢 Канал публикации серий (Релизы):
                          </label>
                          <input
                            type="text"
                            placeholder="@akaneproject_channel или ID"
                            value={project.tgReleaseChannelId || ''}
                            onChange={async (e) => {
                              await ipcSafe.invoke('save-project', { 
                                ...project, 
                                tgReleaseChannelId: e.target.value 
                              });
                              onRefresh();
                            }}
                            className="w-full bg-black border border-neutral-800 rounded-xl py-2 px-3 text-xs text-white font-mono focus:border-sky-500 outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-neutral-300 mb-1">
                            💬 Рабочий чат команды (Сдача дорог, фиксы):
                          </label>
                          <input
                            type="text"
                            placeholder="@akaneproject_team или ID"
                            value={project.tgWorkGroupId || ''}
                            onChange={async (e) => {
                              await ipcSafe.invoke('save-project', { 
                                ...project, 
                                tgWorkGroupId: e.target.value 
                              });
                              onRefresh();
                            }}
                            className="w-full bg-black border border-neutral-800 rounded-xl py-2 px-3 text-xs text-white font-mono focus:border-sky-500 outline-none"
                          />
                        </div>
                      </div>

                      <label className="block text-xs font-bold text-neutral-500 uppercase mb-2 ml-1">Ссылки на платформы</label>
                      <div className="grid grid-cols-1 gap-3">
                        {(() => {
                          const defaultLinks = { anime365: '', tg: '', kodik: '', vk: '', shikimori: '' };
                          const parsed = JSON.parse(project.links || '{}');
                          const links = { ...defaultLinks, ...parsed };
                          return Object.entries(links).map(([key, value], idx) => (
                            <div key={(key || 'link') + idx} className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-neutral-600 uppercase w-16">{key}</span>
                              <input
                                type="text"
                                placeholder="URL..."
                                value={value as string}
                                onChange={async (e) => {
                                  const updatedLinks = { ...links, [key]: e.target.value };
                                  await ipcSafe.invoke('save-project', { 
                                    ...project, 
                                    links: JSON.stringify(updatedLinks) 
                                  });
                                  onRefresh();
                                }}
                                className="w-full bg-black border border-neutral-800 rounded-xl py-2.5 pl-20 pr-4 text-xs text-white focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                              />
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="p-6 border-t border-neutral-800 flex justify-end">
              <button 
                onClick={() => setIsProjectSettingsModalOpen(false)}
                className="px-8 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-indigo-500/20"
              >
                Готово
              </button>
            </div>
          </div>
        </div>
      )}
      {currentEpisode && (
        <ExportModal 
          isOpen={isExportModalOpen} 
          onClose={() => setIsExportModalOpen(false)} 
          episode={currentEpisode} 
          role={exportRole} 
          onExport={handleExport}
          isExporting={isUploading}
          progress={transcodingProgress || 0}
        />
      )}

      {/* Message Modal */}
      {isMessageModalOpen && generatedMessage && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[80vh] pointer-events-auto">
            <div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/50">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-blue-400" />
                Сгенерированное сообщение
              </h3>
              <button 
                onClick={() => setIsMessageModalOpen(false)}
                className="text-neutral-500 hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              <textarea
                readOnly
                value={generatedMessage}
                className="w-full h-64 bg-neutral-950 border border-neutral-800 rounded-xl p-4 text-neutral-300 font-mono text-sm focus:outline-none focus:border-blue-500 resize-none"
              />
            </div>
            <div className="p-4 border-t border-neutral-800 bg-neutral-950/50 flex gap-3">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generatedMessage);
                  toast.success("Сообщение скопировано в буфер обмена!");
                }}
                className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                Копировать
              </button>
              <button
                onClick={() => setIsMessageModalOpen(false)}
                className="flex-1 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg font-medium transition-colors"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MKV Import & Subtitle Track Selection Modal */}
      {isSubtitleSelectModalOpen && pendingMkvUpload && (
        <MkvImportModal
          isOpen={isSubtitleSelectModalOpen}
          onClose={() => {
            setIsSubtitleSelectModalOpen(false);
            setPendingMkvUpload(null);
            setSubtitleTracks([]);
            setAudioTracks([]);
            setIsUploading(false);
          }}
          filePath={pendingMkvUpload.filePath}
          subtitleTracks={subtitleTracks}
          audioTracks={audioTracks}
          isProcessing={isMkvExtracting}
          onConfirmSingle={(subIdx, audioIdx) => {
            handleMkvConfirmSingle(subIdx, audioIdx);
          }}
          onConfirmMultiMerge={(tracks, audioIdx) => {
            handleMkvConfirmMultiMerge(tracks, audioIdx);
          }}
        />
      )}

      {/* Torrent Downloaded MKV Subtitles Detected Modal */}
      {torrentMkvDetected && (
        <TorrentMkvDetectedModal
          isOpen={!!torrentMkvDetected}
          onClose={() => setTorrentMkvDetected(null)}
          episodeNumber={torrentMkvDetected.episodeNumber}
          filePath={torrentMkvDetected.filePath}
          subtitlesCount={torrentMkvDetected.subtitleTracks.length}
          subtitleTracks={torrentMkvDetected.subtitleTracks}
          onOpenMultiMerge={() => {
            if (torrentMkvDetected.targetEpisode) {
              onEpisodeSelect(torrentMkvDetected.targetEpisode.number);
            }
            setSubtitleTracks(torrentMkvDetected.subtitleTracks);
            setAudioTracks([]);
            setPendingMkvUpload({
              filePath: torrentMkvDetected.filePath,
              type: 'SUB',
              episodeId: torrentMkvDetected.targetEpisode?.id || currentEpisode?.id
            });
            setTorrentMkvDetected(null);
            setIsSubtitleSelectModalOpen(true);
          }}
        />
      )}

      {isTorrentModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col pointer-events-auto max-h-[90vh]">
            <div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/50">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Globe className="w-5 h-5 text-indigo-400" />
                Скачивание RAW с торрента
              </h3>
              <button 
                onClick={() => {
                  if (downloadStep === 'downloading') {
                    if (confirm('Вы уверены, что хотите прервать скачивание? Окно будет закрыто, но загрузка может продолжиться в фоновом режиме.')) {
                      setIsTorrentModalOpen(false);
                    }
                  } else {
                    setIsTorrentModalOpen(false);
                  }
                }}
                className="text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {downloadStep === 'search' ? (
              <div className="p-6 flex flex-col gap-4 overflow-y-auto">
                {/* Anime 365 RAW block */}
                <div className="bg-neutral-950/65 p-4 border border-indigo-900/30 rounded-xl mb-1 text-left">
                  <div className="flex items-center justify-between mb-2.5 border-b border-indigo-950 pb-2">
                    <span className="text-xs font-bold text-indigo-400 tracking-wider uppercase flex items-center gap-1.5 font-sans">
                      <Zap className="w-4 h-4 text-amber-400" />
                      Anime365 RAW Стримы (Прямое скачивание)
                    </span>
                    <span className="text-[10px] text-neutral-500 font-sans">Без хардсаба • Оригинал</span>
                  </div>

                  {/* Anime365 Auth Status Header Bar */}
                  <div className="flex flex-col gap-2 mb-3 bg-neutral-900/45 p-2.5 rounded-lg border border-neutral-800/80 font-sans">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] text-neutral-400 font-medium">Авторизация:</span>
                        {anime365AuthStatus?.loggedIn ? (
                          <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded font-bold flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full inline-block animate-pulse"></span>
                            Активна
                          </span>
                        ) : (
                          <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded font-bold flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full inline-block"></span>
                            Не авторизован
                          </span>
                        )}
                        {anime365AuthStatus?.activeHost && (
                          <span className="text-[9px] text-neutral-500 font-mono">({anime365AuthStatus.activeHost.replace(/^https?:\/\//, '')})</span>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={handleOpenAnime365AuthWindow}
                          className="px-2 py-0.5 bg-indigo-600/90 hover:bg-indigo-500 hover:text-white text-neutral-200 rounded text-[9px] font-bold transition-all cursor-pointer uppercase tracking-wider"
                        >
                          {anime365AuthStatus?.loggedIn ? 'Обновить' : 'Войти'}
                        </button>
                        <button
                          onClick={() => setShowManualCookieForm(!showManualCookieForm)}
                          className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-[9px] font-medium transition-all cursor-pointer"
                        >
                          {showManualCookieForm ? 'Скрыть куки' : 'Ввести куки'}
                        </button>
                      </div>
                    </div>

                    {showManualCookieForm && (
                      <div className="mt-1.5 pt-2 border-t border-neutral-800/60 flex flex-col gap-2">
                        <label className="text-[9px] text-neutral-400 leading-normal">
                          Если встроенный вход не сработал или вы в Sandbox, вставьте заголовок <code className="bg-neutral-900 text-neutral-200 px-1 rounded">Cookie</code> со страницы профиля Anime365:
                        </label>
                        <div className="flex gap-2">
                          <input 
                            type="text"
                            value={manualCookieVal}
                            onChange={(e) => setManualCookieVal(e.target.value)}
                            placeholder="например: php_sessid=...; remember_user_token=..."
                            className="flex-1 bg-neutral-900 border border-neutral-800 text-xs px-2 py-1.5 rounded-md text-white font-mono focus:border-indigo-500 focus:outline-none"
                          />
                          <button
                            onClick={handleSaveManualCookie}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] px-3 py-1.5 rounded-md transition-all active:scale-95"
                          >
                            Сохранить
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {isLoadingAnime365 ? (
                    <div className="flex justify-center items-center py-4 gap-2 text-xs text-neutral-400 font-sans">
                      <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                      Загрузка RAW-видео с Anime365...
                    </div>
                  ) : anime365Translations?.filter(t => t.type === 'raw' || t.qualityType?.toLowerCase()?.includes('raw') || (t.title && t.title.toLowerCase().includes('raw')) || t.typeLang === 'jpn').length > 0 ? (
                    <div className="space-y-2 max-h-[140px] overflow-y-auto custom-scrollbar">
                      {anime365Translations
                        .filter(t => t.type === 'raw' || t.qualityType?.toLowerCase()?.includes('raw') || (t.title && t.title.toLowerCase().includes('raw')) || t.typeLang === 'jpn')
                        .map((item, idx) => (
                          <div key={idx} className="flex items-center justify-between bg-neutral-900/50 p-2.5 rounded-lg border border-neutral-800 hover:border-neutral-700 transition-all">
                            <div className="flex flex-col text-left">
                              <span className="text-xs font-semibold text-white">{item.title || 'RAW Источник'} ({item.authorsSummary || item.authorsList?.join(', ') || 'Оригинал'})</span>
                              <span className="text-[10px] text-neutral-400 mt-0.5">Качество: {item.qualityType || 'Auto'} • Стримы: {item.duration || '—'}</span>
                            </div>
                            <div className="flex items-center gap-1.5 font-sans">
                              <button
                                onClick={() => handleAnime365Download(item)}
                                className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-bold transition-all cursor-pointer font-sans flex items-center gap-1 shadow-sm active:scale-95"
                              >
                                <Download className="w-3 h-3 text-white" />
                                СКАЧАТЬ
                              </button>
                              {item.embedUrl && (
                                <button
                                  onClick={() => {
                                    ipcSafe.invoke('open-external', item.embedUrl);
                                    toast.success('Плеер запущен во внешнем браузере!');
                                  }}
                                  className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-[10px] font-medium transition-all cursor-pointer font-sans"
                                >
                                  Смотреть
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="text-center py-2 text-xs text-neutral-500 font-sans">
                      Прямых RAW источников вещания не обнаружено на Anime365 для этой серии. Воспользуйтесь торрентами ниже.
                    </div>
                  )}
                </div>

                <div className="bg-neutral-950/40 p-3 rounded-lg border border-neutral-800/50 text-xs text-neutral-400">
                  <span className="text-indigo-400 font-semibold">Поиск на Nyaa.si:</span> Мы автоматически подставили название проекта и номер серии. При необходимости вы можете изменить запрос вручную.
                </div>

                <div className="flex gap-2 font-sans">
                  <input
                    type="text"
                    value={torrentQuery}
                    onChange={(e) => setTorrentQuery(e.target.value)}
                    placeholder="Название аниме или запрос для поиска на торренте..."
                    className="flex-1 px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500 font-sans"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSearchTorrents();
                    }}
                  />
                  <button
                    onClick={handleSearchTorrents}
                    disabled={isSearchingTorrents}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-white font-medium text-sm rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    {isSearchingTorrents ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      'Поиск'
                    )}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-wider mb-1.5 font-sans">Релиз-группа</label>
                    <select
                      value={torrentReleaseGroup}
                      onChange={(e) => setTorrentReleaseGroup(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-neutral-950 border border-neutral-800 rounded-lg text-xs text-neutral-300 focus:outline-none focus:border-indigo-500 font-sans cursor-pointer"
                    >
                      <option value="">Любая (по умолчанию)</option>
                      <option value="[Erai-raws]">[Erai-raws]</option>
                      <option value="[SubsPlease]">[SubsPlease]</option>
                      <option value="[HorribleSubs]">[HorribleSubs]</option>
                      <option value="[Kaerizaki-Fansub]">[Kaerizaki-Fansub]</option>
                      <option value="[ToonsHub]">[ToonsHub]</option>
                      <option value="[Judas]">[Judas]</option>
                      <option value="[EMBER]">[EMBER]</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-wider mb-1.5 font-sans">Подкатегория</label>
                    <select
                      value={torrentSubCategory}
                      onChange={(e) => setTorrentSubCategory(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-neutral-950 border border-neutral-800 rounded-lg text-xs text-neutral-300 focus:outline-none focus:border-indigo-500 font-sans cursor-pointer"
                    >
                      <option value="raw">Raw (Без субтитров и перевода)</option>
                      <option value="eng">English-translated (Английские субтитры)</option>
                      <option value="non-eng">Non-English-translated (Другие языки)</option>
                      <option value="amv">Anime Music Video (AMV)</option>
                      <option value="">Все подкатегории</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-wider mb-1.5 font-sans">Категория</label>
                    <select
                      value={torrentCategory}
                      onChange={(e) => setTorrentCategory(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-neutral-950 border border-neutral-800 rounded-lg text-xs text-neutral-300 focus:outline-none focus:border-indigo-500 font-sans cursor-pointer"
                    >
                      <option value="anime">Аниме (Anime)</option>
                      <option value="live_action">Лайв-экшн (Live Action)</option>
                      <option value="audio">Аудио (Lossless/Lossy)</option>
                    </select>
                  </div>
                </div>

                {/* Subtitle list search results */}
                <div className="flex-1 flex flex-col min-h-[250px] max-h-[380px] overflow-y-auto border border-neutral-800 rounded-xl bg-neutral-950/20 pr-1">
                  {isSearchingTorrents ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-2 py-10">
                      <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                      <span className="text-sm text-neutral-400">Поиск раздач на Nyaa.si...</span>
                    </div>
                  ) : torrentResults.length > 0 ? (
                    <div className="divide-y divide-neutral-800/75">
                      {torrentResults.map((item: any, idx) => {
                        const hasMagnet = !!(item.magnet || item.link || item.torrent);
                        return (
                          <div key={idx} className="p-3.5 hover:bg-neutral-900/40 flex flex-col md:flex-row gap-3 items-start md:items-center justify-between transition-colors">
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-semibold text-neutral-200 line-clamp-2 leading-relaxed" title={item.name || item.title}>
                                {item.name || item.title}
                              </div>
                              <div className="flex flex-wrap items-center gap-2 mt-2 text-[10px] text-neutral-500 font-mono">
                                <span className="bg-neutral-800 text-neutral-300 px-1.5 py-0.5 rounded text-[9px] font-sans">
                                  {item.size || 'Неизвестно'}
                                </span>
                                <span>•</span>
                                <span>{item.date?.split(' ')[0] || item.timestamp || 'Нет даты'}</span>
                                {item.category && (
                                  <>
                                    <span>•</span>
                                    <span className="text-indigo-400 font-medium font-sans">{item.category}</span>
                                  </>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-3 shrink-0 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 border-neutral-800/40 pt-2.5 md:pt-0">
                              <div className="flex items-center gap-2 text-[10px] font-mono">
                                <span className="text-green-500 font-bold" title="Seeders">
                                  S: {item.seeders !== undefined ? item.seeders : (item.seeds || 0)}
                                </span>
                                <span className="text-neutral-600">|</span>
                                <span className="text-red-400 font-bold" title="Leechers">
                                  L: {item.leechers !== undefined ? item.leechers : (item.leechs || 0)}
                                </span>
                              </div>

                              <div className="flex gap-2">
                                {(item.link || item.torrent || '').includes('.torrent') || (item.link || item.torrent) ? (
                                  <button
                                    onClick={() => ipcSafe.invoke('open-external', item.torrent || item.link)}
                                    title="Скачать .torrent файл для стороннего клиента"
                                    className="px-2 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-md text-xs transition-colors flex items-center justify-center cursor-pointer"
                                  >
                                    <FileText className="w-3.5 h-3.5" />
                                  </button>
                                ) : null}
                                <button
                                  onClick={() => handleStartTorrentDownload(item)}
                                  disabled={!hasMagnet}
                                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white rounded-md text-xs font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                                >
                                  <Download className="w-3 h-3" />
                                  Облачная загрузка
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center py-12 text-center text-neutral-500">
                      <Globe className="w-10 h-10 text-neutral-700 mb-2.5 stroke-1" />
                      <span className="text-xs">Введите поисковый запрос и нажмите кнопку «Поиск».<br />Мы найдем лучшие раздачи прямо с Nyaa в качестве RAW-видео.</span>
                    </div>
                  )}
                </div>
              </div>
            ) : downloadStep === 'getting_meta' ? (
              <div className="p-12 flex flex-col items-center justify-center text-center gap-4">
                <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
                <div className="text-sm font-semibold text-white">Получение списка файлов торрента...</div>
                <div className="text-xs text-neutral-500">Это может занять некоторое время, в зависимости от количества пиров. Ожидание до 20 секунд.</div>
              </div>
            ) : downloadStep === 'select_files' ? (
              <div className="p-6 flex flex-col max-h-[70vh] overflow-hidden">
                <div className="text-sm font-semibold text-white mb-2 line-clamp-1">{torrentMetadata?.name}</div>
                <div className="text-xs text-neutral-400 mb-4">Выберите серии/файлы для загрузки. При пакетном скачивании они будут автоматически добавлены в проект.</div>
                
                <div className="flex-1 overflow-y-auto min-h-0 border border-neutral-800 rounded-lg">
                  <div className="divide-y divide-neutral-800">
                    {torrentMetadata?.files?.map(f => (
                      <label key={f.index} className="flex items-center justify-between p-3 hover:bg-neutral-900/50 transition-colors group cursor-pointer">
                        <div className="flex items-center gap-3 min-w-0 pr-4">
                          <input 
                            type="checkbox"
                            checked={selectedFileIndexes.includes(f.index)}
                            onChange={(e) => {
                              if (e.target.checked) setSelectedFileIndexes([...selectedFileIndexes, f.index]);
                              else setSelectedFileIndexes(selectedFileIndexes.filter(i => i !== f.index));
                            }}
                            className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 checked:bg-indigo-500 checked:border-indigo-500"
                          />
                          <div>
                            <div className="text-sm text-neutral-200 truncate" title={f.name}>{f.name}</div>
                            <div className="text-xs text-neutral-500 font-mono mt-0.5">{(f.length / 1024 / 1024).toFixed(2)} MB</div>
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
                
                <div className="mt-4 pt-4 border-t border-neutral-800 flex justify-end gap-3">
                  <button 
                    onClick={() => {
                        const allSelected = selectedFileIndexes.length === torrentMetadata?.files?.length;
                        if (allSelected) setSelectedFileIndexes([]);
                        else setSelectedFileIndexes(torrentMetadata?.files?.map(f => f.index) || []);
                    }}
                    className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Выбрать все
                  </button>
                  <button 
                    onClick={() => setDownloadStep('search')}
                    className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Назад
                  </button>
                  <button 
                    onClick={() => handleDownloadFiles()}
                    disabled={selectedFileIndexes.length === 0}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-800 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Скачать ({selectedFileIndexes.length})
                  </button>
                </div>
              </div>
            ) : downloadStep === 'direct_downloading' ? (
              <div className="p-8 flex flex-col items-center justify-center text-center gap-5">
                <div className="relative">
                  <div className="w-16 h-16 rounded-full bg-rose-600/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                    <Loader2 className="w-8 h-8 animate-spin" />
                  </div>
                  <span className="absolute -bottom-1 -right-1 bg-rose-500 text-white font-sans font-bold text-[8px] px-1.5 py-0.5 rounded-full border border-neutral-900">
                    HTTP/HLS
                  </span>
                </div>

                <div className="w-full max-w-md">
                  <div className="text-sm font-semibold text-white truncate max-w-sm mx-auto animate-pulse" title={directDownloadProgress?.fileName}>
                    {directDownloadProgress?.fileName || 'Загрузка видео с Anime365...'}
                  </div>
                  <div className="text-xs text-neutral-500 mt-1 font-mono">
                    {directDownloadProgress?.status === 'searching' 
                      ? 'Определение наилучшего зеркала и извлечение видеопотока...' 
                      : directDownloadProgress?.status === 'downloading'
                        ? 'Загрузка сегментов видеопотока...'
                        : directDownloadProgress?.status === 'completed'
                          ? 'Завершено'
                          : directDownloadProgress?.status}
                  </div>
                </div>

                <div className="w-full max-w-md bg-neutral-950/80 p-4 border border-neutral-800/80 rounded-xl flex flex-col gap-3 font-mono">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-neutral-400 font-sans">Прогресс скачивания</span>
                    <span className="text-rose-400 font-bold">{directDownloadProgress?.progress || 0}%</span>
                  </div>
                  
                  <div className="w-full bg-neutral-800 h-2 rounded-full overflow-hidden">
                    <div 
                      className="bg-rose-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${directDownloadProgress?.progress || 0}%` }}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-left pt-1 border-t border-neutral-800/40 text-[10px] text-neutral-400">
                    <div>
                      <span className="text-neutral-500 font-sans">Получено:</span>{' '}
                      <span className="text-rose-400 font-bold">
                        {directDownloadProgress?.downloadedBytes || '0.0 MB'}
                      </span>
                    </div>
                    <div>
                      <span className="text-neutral-500 font-sans">Тип:</span>{' '}
                      <span className="text-rose-400 font-bold">Raw Stream</span>
                    </div>
                  </div>
                </div>

                {directDownloadProgress?.logs && directDownloadProgress.logs.length > 0 && (
                  <div className="w-full max-w-md bg-neutral-950/90 border border-neutral-800 rounded-lg p-3 text-left font-mono text-[10px] text-neutral-400 flex flex-col gap-1.5 shadow-inner">
                    <div className="flex justify-between items-center text-[9px] text-neutral-500 border-b border-neutral-800/80 pb-1.5 mb-1 tracking-wider uppercase">
                      <span>ЛОГ ИЗВЛЕЧЕНИЯ И СКАЧИВАНИЯ (PROG)</span>
                      <span className="text-rose-500 animate-pulse flex items-center gap-1">
                        <span className="w-1 h-1 rounded-full bg-rose-500 inline-block"></span>
                        LIVE
                      </span>
                    </div>
                    <div className="max-h-36 overflow-y-auto flex flex-col gap-1 select-text custom-scrollbar pr-1">
                      {directDownloadProgress.logs.map((logLine, index) => {
                        let textClass = 'text-neutral-400';
                        if (logLine.includes('[WARN]')) textClass = 'text-amber-400 font-medium';
                        if (logLine.includes('[ERROR]')) textClass = 'text-red-400 font-medium';
                        if (logLine.includes('Successfully') || logLine.includes('completed')) textClass = 'text-emerald-400';
                        return (
                          <div key={index} className={`whitespace-pre-wrap leading-tight ${textClass}`}>
                            {logLine}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {directDownloadProgress?.error && (
                  <div className="w-full max-w-md bg-red-500/10 border border-red-500/20 p-3 rounded-lg flex items-start gap-1.5 text-red-400 text-left text-xs leading-relaxed">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Ошибка скачивания:</span> {directDownloadProgress.error}
                    </div>
                  </div>
                )}

                <button
                  onClick={handleCancelDirectDownload}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 hover:text-red-400 rounded-lg text-xs font-semibold text-neutral-300 transition-colors cursor-pointer"
                >
                  Отмена
                </button>
              </div>
            ) : (
              <div className="p-8 flex flex-col items-center justify-center text-center gap-5">
                <div className="relative">
                  <div className="w-16 h-16 rounded-full bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 animate-pulse">
                    <Loader2 className="w-8 h-8 animate-spin" />
                  </div>
                  <span className="absolute bottom-0 right-0 bg-indigo-500 text-white font-mono font-bold text-[9px] px-1.5 py-0.5 rounded-full border border-neutral-900">
                    {downloadProgress?.numPeers || 0} peers
                  </span>
                </div>

                <div className="w-full max-w-md">
                  <div className="text-sm font-semibold text-white truncate max-w-sm mx-auto" title={downloadProgress?.name}>
                    {downloadProgress?.name || 'Загрузка торрента...'}
                  </div>
                  <div className="text-xs text-neutral-500 mt-1 font-mono">
                    {downloadProgress?.status === 'downloading' ? 'Получение блоков...' : downloadProgress?.status === 'completed' ? 'Завершено' : downloadProgress?.status}
                  </div>
                </div>

                <div className="w-full max-w-md bg-neutral-950/80 p-4 border border-neutral-800/80 rounded-xl flex flex-col gap-3 font-mono">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-neutral-400 font-sans">Прогресс скачивания</span>
                    <span className="text-indigo-400 font-bold">{downloadProgress?.progress || 0}%</span>
                  </div>
                  
                  <div className="w-full bg-neutral-800 h-2 rounded-full overflow-hidden">
                    <div 
                      className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${downloadProgress?.progress || 0}%` }}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-left pt-1 border-t border-neutral-800/40 text-[10px] text-neutral-400">
                    <div>
                      <span className="text-neutral-500 font-sans">Скорость:</span>{' '}
                      <span className="text-indigo-400 font-bold">
                        {downloadProgress?.downloadSpeed 
                          ? (downloadProgress.downloadSpeed / (1024 * 1024)).toFixed(2) + ' MB/s' 
                          : '0.00 MB/s'}
                      </span>
                    </div>
                    <div>
                      <span className="text-neutral-500 font-sans">Пиры:</span>{' '}
                      <span className="text-indigo-400 font-bold">{downloadProgress?.numPeers || 0} соед.</span>
                    </div>
                  </div>
                </div>

                {downloadProgress?.error && (
                  <div className="w-full max-w-md bg-red-500/10 border border-red-500/20 p-3 rounded-lg flex items-start gap-1.5 text-red-400 text-left text-xs leading-relaxed">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Ошибка:</span> {downloadProgress.error}
                    </div>
                  </div>
                )}

                <button
                  onClick={() => {
                    if (confirm('Прервать скачивание? Данные для этой серии не будут сохранены.')) {
                      if (downloadPollIntervalRef.current) {
                        clearInterval(downloadPollIntervalRef.current);
                        downloadPollIntervalRef.current = null;
                      }
                      setActiveDownloadId(null);
                      setDownloadStep('search');
                      setDownloadProgress(null);
                    }
                  }}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 hover:text-red-400 rounded-lg text-xs font-semibold text-neutral-300 transition-colors cursor-pointer"
                >
                  Отмена
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Text to Subtitles Modal */}
      <TextToSubtitlesModal
        isOpen={isTextToSubModalOpen}
        onClose={() => setIsTextToSubModalOpen(false)}
        onSave={handleTextToSubsSave}
      />

      {isSubDownloadModalOpen && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-[9999] p-4 animate-fade-in font-sans pointer-events-auto">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col pointer-events-auto max-h-[85vh]">
            <div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/50">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Languages className="w-5 h-5 text-emerald-400" />
                Скачивание субтитров ({selectedProject?.title}, серия {currentEpisode?.number})
              </h3>
              <button 
                onClick={() => setIsSubDownloadModalOpen(false)}
                className="text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 flex flex-col gap-4 overflow-y-auto">
              <div className="flex flex-col md:flex-row gap-3">
                <div className="flex-1 flex gap-2">
                  <input
                    type="text"
                    value={subSearchQuery}
                    onChange={(e) => setSubSearchQuery(e.target.value)}
                    placeholder="Название аниме для поиска субтитров..."
                    className="flex-1 px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500 font-sans"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSearchSubtitles(subSearchQuery, subApiSource);
                    }}
                  />
                  <button
                    onClick={() => handleSearchSubtitles(subSearchQuery, subApiSource)}
                    disabled={isSearchingSubs}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-sm rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer font-sans"
                  >
                    {isSearchingSubs ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      'Поиск'
                    )}
                  </button>
                </div>

                <div className="flex gap-2 font-sans shrink-0">
                  <select
                    value={subApiSource}
                    onChange={(e) => {
                      setSubApiSource(e.target.value);
                      handleSearchSubtitles(subSearchQuery, e.target.value);
                    }}
                    className="px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-white text-xs focus:outline-none focus:border-emerald-500 cursor-pointer text-left font-sans"
                  >
                    <option value="anime365">Опция: Anime 365 (RU/Любые)</option>
                    <option value="kitsunekko">Опция: Kitsunekko (JA/Японские)</option>
                  </select>

                  <select
                    value={subSourceLanguage}
                    onChange={(e) => setSubSourceLanguage(e.target.value)}
                    className="px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-white text-xs focus:outline-none focus:border-emerald-500 cursor-pointer text-left font-sans"
                  >
                    <option value="all">Все языки</option>
                    <option value="RU">Русские (RU)</option>
                    <option value="JA">Японские (JA)</option>
                    <option value="EN">Английские (EN)</option>
                  </select>
                </div>
              </div>

              <div className="border border-neutral-800/80 rounded-xl overflow-hidden bg-neutral-950/40 text-left">
                <div className="max-h-[350px] overflow-y-auto custom-scrollbar">
                  {isSearchingSubs ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-3 text-neutral-400 font-sans">
                      <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
                      <span>Индексирование баз данных и сопоставление серий...</span>
                    </div>
                  ) : subDownloadResults && subDownloadResults.length > 0 ? (
                    <div className="divide-y divide-neutral-800/60">
                      {subDownloadResults
                        .filter(sub => subSourceLanguage === 'all' || sub.language?.toUpperCase() === subSourceLanguage.toUpperCase())
                        .map((sub, idx) => (
                          <div key={idx} className="p-3 flex items-center justify-between hover:bg-neutral-900/60 transition-all text-left">
                            <div className="flex flex-col gap-1 pr-4">
                              <div className="flex items-center gap-2">
                                <span className={`px-1.5 py-0.5 text-[9px] font-extrabold rounded-md ${
                                  sub.language === 'RU' ? 'bg-red-500/10 text-red-400 border border-red-500/25' : 
                                  sub.language === 'JA' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/25' : 
                                  'bg-blue-500/10 text-blue-400 border border-blue-500/25'
                                }`}>
                                  {sub.language}
                                </span>
                                <span className="px-1.5 py-0.5 text-[9px] font-extrabold rounded bg-neutral-800 text-neutral-300 font-mono">
                                  {sub.format}
                                </span>
                                <span className="text-xs font-semibold text-neutral-200 truncate max-w-[280px]">
                                  {sub.title}
                                </span>
                              </div>
                              <div className="text-[10px] text-neutral-500 font-sans mt-0.5">
                                Авторство / Саб-группа: <span className="text-neutral-400 font-semibold">{sub.authors || 'Официальные'}</span>
                              </div>
                            </div>

                            <button
                              onClick={() => handleDownloadAndImportSubtitle(sub)}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 hover:shadow-lg hover:shadow-emerald-600/10 active:scale-95 text-white rounded-lg text-xs font-bold font-sans flex items-center gap-1.5 transition-all cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                              Скачать
                            </button>
                          </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-neutral-500 font-sans">
                      <Languages className="w-10 h-10 text-neutral-700 mb-2" />
                      <span>Субтитры не найдены в выбранном источнике.</span>
                      <span className="text-[10px] text-neutral-600 mt-1">Попробуйте ввести другое название серии или сменить источник</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
        </div>
      )}

      {selectedProject && isNotificationTemplatesModalOpen && (
        <NotificationTemplatesModal
          isOpen={isNotificationTemplatesModalOpen}
          onClose={() => setIsNotificationTemplatesModalOpen(false)}
          project={selectedProject}
          latestEpisode={selectedProject.episodes?.[selectedProject.episodes.length - 1]}
          onSaveProject={async (projectId, updates) => {
            const updated = { ...selectedProject, ...updates };
            await ipcSafe.invoke('save-project', updated);
            onRefresh();
          }}
        />
      )}

      <ConfirmModal 
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        variant={confirmState.variant}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
      />

      <MultiSubtitleMergeModal
        isOpen={isMultiSubMergeModalOpen}
        onClose={() => {
          setIsMultiSubMergeModalOpen(false);
          setMultiMergeInitialFiles([]);
        }}
        currentEpisode={currentEpisode}
        onRefresh={onRefresh}
        initialFiles={multiMergeInitialFiles}
      />

      {isTelegramClientModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4 overflow-hidden">
          <div className="w-full max-w-6xl max-h-[92vh] h-full flex flex-col my-auto">
            <TelegramClientPanel
              currentEpisode={currentEpisode}
              currentProject={selectedProject}
              allProjects={projects}
              onRefreshProjects={onRefresh}
              onClose={() => setIsTelegramClientModalOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
