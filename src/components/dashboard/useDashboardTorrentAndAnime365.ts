import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Project, Episode } from "../../types";
import { ipcSafe } from "../../lib/ipcSafe";
import { sanitizeFolderName } from "../../lib/pathUtils";
import { MkvTrackInfo } from "../../lib/mkvSubtitleExtractor";
import { linkDownloadedTorrentFile } from "../../lib/torrentEpisodeLinker";

export function useDashboardTorrentAndAnime365(params: {
  projects: Project[];
  selectedProject: Project | undefined;
  currentEpisode: Episode | null;
  onRefresh: () => void;
  setTorrentMkvDetected: React.Dispatch<React.SetStateAction<{
    episodeNumber: number;
    filePath: string;
    subtitleTracks: MkvTrackInfo[];
    targetEpisode?: Episode;
  } | null>>;
}) {
  const { projects, selectedProject, currentEpisode, onRefresh, setTorrentMkvDetected } = params;

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

  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  useEffect(() => {
    if (isTorrentModalOpen) {
      checkAnime365Auth();
    }
  }, [isTorrentModalOpen]);


  const downloadPollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const torrentPollIntervalsRef = useRef<Set<NodeJS.Timeout>>(new Set());

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
        downloadPollIntervalRef.current = null;
      }
      torrentPollIntervalsRef.current.forEach(intervalId => {
        clearInterval(intervalId);
      });
      torrentPollIntervalsRef.current.clear();
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
        let directPollAttempts = 0;
        let directPollErrorCount = 0;
        
        const poll = setInterval(async () => {
          directPollAttempts++;
          if (directPollAttempts > 400) { // ~10 minutes max timeout
            clearInterval(poll);
            downloadPollIntervalRef.current = null;
            setDirectDownloadId(null);
            toast.error('Время ожидания прямой загрузки истекло.');
            return;
          }

          try {
            const status = await ipcSafe.invoke('anime365-get-direct-download-status', { downloadId: res.downloadId });
            if (status) {
              setDirectDownloadProgress(status);
              
              if (status.status === 'completed') {
                clearInterval(poll);
                downloadPollIntervalRef.current = null;
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
                downloadPollIntervalRef.current = null;
                setDirectDownloadId(null);
                toast.error('Ошибка скачивания: ' + (status.error || 'Неизвестная ошибка'));
              }
            }
          } catch (pollEx: any) {
            console.error('[Direct Download Poll Error]:', pollEx);
            directPollErrorCount++;
            if (directPollErrorCount > 8) {
              clearInterval(poll);
              downloadPollIntervalRef.current = null;
              setDirectDownloadId(null);
            }
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
    const trimmed = torrentQuery.trim();
    if (!trimmed) return;

    // Direct Magnet / URL / infoHash check
    const isDirectLink = trimmed.startsWith('magnet:?') || 
                         trimmed.startsWith('http://') || 
                         trimmed.startsWith('https://') || 
                         /^[0-9a-fA-F]{40}$/.test(trimmed);

    if (isDirectLink) {
      handleStartTorrentDownload({
        name: trimmed.length > 50 ? trimmed.slice(0, 50) + '...' : trimmed,
        magnet: trimmed.startsWith('magnet:?') || /^[0-9a-fA-F]{40}$/.test(trimmed) ? trimmed : undefined,
        torrent: trimmed.startsWith('http') ? trimmed : undefined,
        link: trimmed
      });
      return;
    }

    setIsSearchingTorrents(true);
    setTorrentResults([]);
    try {
      let finalQuery = trimmed;
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

  const isFetchingTorrentMetaRef = useRef(false);

  const handleStartTorrentDownload = async (torrent: any) => {
    if (!torrent || isFetchingTorrentMetaRef.current || downloadStep === 'getting_meta') return;
    isFetchingTorrentMetaRef.current = true;
    setSelectedTorrentForMeta(torrent);
    setDownloadStep('getting_meta');
    
    try {
      const meta = await ipcSafe.invoke('get-torrent-metadata', {
        torrentUrl: (torrent.torrent || torrent.link || '').trim() || undefined,
        magnet: (torrent.magnet || '').trim() || undefined
      });
      setTorrentMetadata(meta);
      setDownloadStep('select_files');
    } catch (err: any) {
      console.error(err);
      toast.error('Ошибка получения метаданных: ' + (err.message || String(err)));
      setDownloadStep('search');
    } finally {
      isFetchingTorrentMetaRef.current = false;
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
             let attempts = 0;
             let errorCount = 0;
             const poll = setInterval(async () => {
               attempts++;
               if (attempts > 400) {
                 clearInterval(poll);
                 torrentPollIntervalsRef.current.delete(poll);
                 return;
               }

               try {
                 const st = await ipcSafe.invoke('get-torrent-download-status', { downloadId: bgRes.downloadId });
                 if (st && st.status === 'completed') {
                   clearInterval(poll);
                   torrentPollIntervalsRef.current.delete(poll);
                   
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
                   torrentPollIntervalsRef.current.delete(poll);
                   toast.error(`Ошибка загрузки торрента: ${st.error}`);
                   console.error(`Фоновая загрузка (${idx}) завершилась с ошибкой:`, st.error);
                 }
               } catch (e) {
                 console.error('Error polling torrent download status:', e);
                 errorCount++;
                 if (errorCount > 8) {
                   clearInterval(poll);
                   torrentPollIntervalsRef.current.delete(poll);
                 }
               }
             }, 1500);
             torrentPollIntervalsRef.current.add(poll);
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

  return {
    isTorrentModalOpen,
    setIsTorrentModalOpen,
    torrentQuery,
    setTorrentQuery,
    torrentCategory,
    setTorrentCategory,
    torrentSubCategory,
    setTorrentSubCategory,
    torrentReleaseGroup,
    setTorrentReleaseGroup,
    isSearchingTorrents,
    torrentResults,
    torrentMetadata,
    selectedTorrentForMeta,
    activeDownloadId,
    setActiveDownloadId,
    downloadStep,
    setDownloadStep,
    downloadProgress,
    setDownloadProgress,
    directDownloadId,
    directDownloadProgress,
    anime365AuthStatus,
    manualCookieVal,
    setManualCookieVal,
    showManualCookieForm,
    setShowManualCookieForm,
    handleOpenAnime365AuthWindow,
    handleSaveManualCookie,
    downloadPollIntervalRef,
    anime365Translations,
    isLoadingAnime365,
    isUpdatingProjectData,
    isSubDownloadModalOpen,
    setIsSubDownloadModalOpen,
    isTextToSubModalOpen,
    setIsTextToSubModalOpen,
    subDownloadResults,
    isSearchingSubs,
    subSearchQuery,
    setSubSearchQuery,
    subSourceLanguage,
    setSubSourceLanguage,
    subApiSource,
    setSubApiSource,
    handleUpdateProjectData,
    openSubtitleDownloadModal,
    handleTextToSubsSave,
    handleSearchSubtitles,
    handleDownloadAndImportSubtitle,
    openTorrentDownloadModal,
    handleAnime365Download,
    handleCancelDirectDownload,
    handleSearchTorrents,
    handleStartTorrentDownload,
    selectedFileIndexes,
    setSelectedFileIndexes,
    handleDownloadFiles
  };
}
