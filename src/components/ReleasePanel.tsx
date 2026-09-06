import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  PlaySquare, Send, Copy, MessageSquare, Sparkles, CheckCircle2, Globe, Link2, Save, 
  Package, Loader2, Camera, Image as ImageIcon, Download, Upload, Plus, Trash2, Edit3, Check,
  Table, ExternalLink, Columns, Eye, Code
} from 'lucide-react';
import { getParticipants } from '../services/dbService';
import { Participant, Episode, Project } from '../types';
import { ipcSafe, isWeb } from '../lib/ipcSafe';
import { DesktopRequiredMessage } from './DesktopRequiredMessage';
import { TelegramClientPanel } from './TelegramClientPanel';
import { 
  generateTGPostMessage, 
  generateVKPostMessage, 
  generateFinalTGMessage,
  generateTGArticleMessage,
  getTemplateString,
  applyTemplate,
  getTemplateVariables,
  convertToHTMLForTelegram,
  markdownTableToUnicodeBox
} from '../lib/templates';
import { useVideoContext } from '../contexts/VideoContext';

interface ReleasePanelProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
}

interface QuickUploadLink {
  name: string;
  url: string;
}

interface ProjectLinks {
  anime365?: string;
  tg?: string;
  kodik?: string;
  vk?: string;
  shikimori?: string;
  quickUploadLinks?: QuickUploadLink[];
}

const DEFAULT_QUICK_LINKS: QuickUploadLink[] = [
  { name: 'TG Загрузка', url: 'https://t.me/akaneproject' },
  { name: 'Kodik Конвертер', url: 'https://converter.kodikres.com/' },
  { name: 'VK Кабинет', url: 'https://cabinet.vkvideo.ru/dashboard/@club216521493?filterPreset=published&section=video_my_content&subsection=video_my_content_videos' },
  { name: 'Anime365', url: 'https://smotret-anime.com/translations/create' },
  { name: 'VK Паблик', url: 'https://vk.com/okaneproject' }
];

export default function ReleasePanel({ currentEpisode, onRefresh }: ReleasePanelProps) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [postContent, setPostContent] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [isCopiedMarkdown, setIsCopiedMarkdown] = useState(false);
  const [isCopiedUnicode, setIsCopiedUnicode] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<'TG' | 'VK' | 'FINAL_TG' | 'TG_ARTICLE' | null>(null);
  const [articleViewMode, setArticleViewMode] = useState<'visual' | 'markdown' | 'unicode'>('visual');
  const [links, setLinks] = useState<ProjectLinks>({});
  const [isSavingLinks, setIsSavingLinks] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildProgress, setBuildProgress] = useState(0);
  const [customAudioPath, setCustomAudioPath] = useState<string>('');
  const [customRawPath, setCustomRawPath] = useState<string>('');
  const [videoDuration, setVideoDuration] = useState(0);
  const [screenshotTime, setScreenshotTime] = useState(0);
  const [screenshotPath, setScreenshotPath] = useState('');
  const [isCapturing, setIsCapturing] = useState(false);
  const [isEditingTemplate, setIsEditingTemplate] = useState(false);
  const [editingTemplateStr, setEditingTemplateStr] = useState('');
  const [linksTemplateStr, setLinksTemplateStr] = useState('');
  const [isEditingLinksTemplate, setIsEditingLinksTemplate] = useState(false);
  const [quickLinks, setQuickLinks] = useState<QuickUploadLink[]>([]);
  const [isEditingQuickLinks, setIsEditingQuickLinks] = useState(false);
  const [tgPostLink, setTgPostLink] = useState('');
  const [vkPostLink, setVkPostLink] = useState('');
  const [isTelegramModalOpen, setIsTelegramModalOpen] = useState(false);
  const [allProjects, setAllProjects] = useState<Project[]>([]);

  const loadProjects = useCallback(async () => {
    try {
      const prjs = await ipcSafe.invoke('get-projects');
      if (Array.isArray(prjs)) {
        setAllProjects(prjs);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);
  const videoRef = useRef<HTMLVideoElement>(null);

  const { registerPlayer, unregisterPlayer } = useVideoContext();

  const togglePlayPause = useCallback(() => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play().catch(e => console.error('Play error', e));
      } else {
        videoRef.current.pause();
      }
    }
  }, []);

  useEffect(() => {
    registerPlayer({ 
      togglePlayPause,
      seekToNext: () => {
        if (videoRef.current) {
          videoRef.current.currentTime += 5;
        }
      }
    });
    return () => unregisterPlayer();
  }, [registerPlayer, unregisterPlayer, togglePlayPause]);

  useEffect(() => {
    const path = customRawPath || currentEpisode?.rawPath;
    if (path) {
      ipcSafe.invoke('get-video-metadata', path).then(meta => {
        if (meta && meta.format && meta.format.duration) {
          setVideoDuration(meta.format.duration);
        }
      });
    }
  }, [currentEpisode?.rawPath, customRawPath]);

  const handleTakeScreenshot = async () => {
    const videoPath = customRawPath || currentEpisode?.rawPath;
    if (!videoPath) return;
    
    setIsCapturing(true);
    try {
      const tempDir = await ipcSafe.invoke('get-temp-path');
      const outputPath = `${tempDir}/screenshot_${Date.now()}.jpg`;
      const res = await ipcSafe.invoke('take-screenshot', {
        videoPath,
        timestamp: screenshotTime,
        outputPath
      });
      if (res && res.path) {
        setScreenshotPath(res.path);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsCapturing(false);
    }
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    const removeListener = ipcSafe.on('ffmpeg-progress', (percent: number) => {
      setBuildProgress(percent);
    });
    return () => removeListener();
  }, []);

  const handleBuildRelease = async () => {
    if (!currentEpisode) return;
    
    try {
      const result = await ipcSafe.invoke('select-directory');
      if (!result || !result.filePaths || result.filePaths.length === 0) return;
      
      const targetDir = result.filePaths[0];
      
      // Enqueue task instead of direct invocation
      await ipcSafe.send('enqueue-ffmpeg-task', {
        type: 'mux-release',
        payload: { 
          episode: currentEpisode, 
          targetDir,
          customAudioPath: customAudioPath || undefined,
          customRawPath: customRawPath || undefined
        },
        metadata: {
          title: `Сборка: ${currentEpisode.project?.title} - Серия ${currentEpisode.number}`
        }
      });
      
      // We don't wait for result here, the TaskQueuePanel will show progress
    } catch (error: any) {
      if (error && error.message !== 'Selection canceled') {
        alert(`Ошибка при постановке в очередь: ${error.message}`);
      }
    }
  };

  useEffect(() => {
    getParticipants().then(setParticipants);
  }, []);

  useEffect(() => {
    if (currentEpisode) {
      setTgPostLink(currentEpisode.tgPostLink || '');
      setVkPostLink(currentEpisode.vkPostLink || '');
    }
  }, [currentEpisode?.id]);

  useEffect(() => {
    const defaultRequiredLinks = { tg: '', vk: '', anime365: '', shikimori: '', kodik: '' };
    if (currentEpisode?.project?.links) {
      try {
        const parsed = JSON.parse(currentEpisode.project.links) as ProjectLinks;
        const mergedLinks = { ...defaultRequiredLinks, ...parsed };
        setLinks(mergedLinks);
        if (parsed.quickUploadLinks && Array.isArray(parsed.quickUploadLinks)) {
          setQuickLinks(parsed.quickUploadLinks);
        } else {
          setQuickLinks(DEFAULT_QUICK_LINKS);
        }
      } catch (e) {
        console.error('Failed to parse project links', e);
        setLinks(defaultRequiredLinks);
        setQuickLinks(DEFAULT_QUICK_LINKS);
      }
    } else {
      setLinks(defaultRequiredLinks);
      setQuickLinks(DEFAULT_QUICK_LINKS);
    }
  }, [currentEpisode?.project?.id]);

  const updateLinksAndSync = (newLinks: ProjectLinks) => {
    setLinks(newLinks);
    Object.entries(newLinks).forEach(([k, val]) => {
      if (k === 'quickUploadLinks' || typeof val !== 'string') return;
      const lowerKey = k.toLowerCase();
      const isTelegram = lowerKey === 'tg' || lowerKey === 'telegram' || val.includes('t.me/');
      const isVk = lowerKey === 'vk' || lowerKey === 'vkontakte' || val.includes('vk.com/') || val.includes('vk.ru/');
      if (isTelegram && val) {
        setTgPostLink(val);
      } else if (isVk && val) {
        setVkPostLink(val);
      }
    });
  };

  const handleSaveLinks = async () => {
    if (!currentEpisode?.project) return;
    setIsSavingLinks(true);
    try {
      const updatedLinksObj: ProjectLinks = {
        ...links,
        quickUploadLinks: quickLinks
      };
      const updatedProject = {
        ...currentEpisode.project,
        links: JSON.stringify(updatedLinksObj)
      };
      await ipcSafe.invoke('save-project', updatedProject);
      
      const shouldFinish = !!(tgPostLink?.trim() || vkPostLink?.trim());
      // Also save the episode with the synced TG/VK links and autocompletes status to FINISHED if links are filled
      const updatedEpisode = {
        ...currentEpisode,
        tgPostLink,
        vkPostLink,
        ...(shouldFinish ? { status: 'FINISHED' as const } : {})
      };
      await ipcSafe.invoke('save-episode', updatedEpisode);

      setLinks(updatedLinksObj);
      onRefresh();
    } catch (err) {
      console.error('Failed to save links', err);
    } finally {
      setIsSavingLinks(false);
    }
  };

  const handleSaveEpisodePostLinks = async () => {
    if (!currentEpisode) return;
    setIsSavingLinks(true);
    try {
      const shouldFinish = !!(tgPostLink?.trim() || vkPostLink?.trim());
      const updatedEpisode = {
        ...currentEpisode,
        tgPostLink,
        vkPostLink,
        ...(shouldFinish ? { status: 'FINISHED' as const } : {})
      };
      await ipcSafe.invoke('save-episode', updatedEpisode);
      onRefresh();
    } catch (err) {
      console.error('Failed to save episode post links', err);
    } finally {
      setIsSavingLinks(false);
    }
  };

  const handleCopy = async () => {
    if (!postContent) return;
    try {
      const plainText = postContent;
      const htmlText = convertToHTMLForTelegram(postContent);

      const blobPlain = new Blob([plainText], { type: 'text/plain' });
      const blobHtml = new Blob([htmlText], { type: 'text/html' });

      // Write styled html as well as plain text so Telegram will parse bold/italic formatting on paste
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': blobPlain,
          'text/html': blobHtml
        })
      ]);

      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy rich text: ', err);
      // Fallback to standard plain text copying if ClipboardItem is not permitted/supported
      try {
        await navigator.clipboard.writeText(postContent);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      } catch (fallbackErr) {
        console.error('Fallback plain text copy also failed: ', fallbackErr);
      }
    }
  };

  const handleTextareaKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    setValue: React.Dispatch<React.SetStateAction<string>>
  ) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const isCmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

    if (isCmdOrCtrl && (e.key === 'b' || e.key === 'B' || e.key === 'i' || e.key === 'I')) {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;

      const prefix = e.key.toLowerCase() === 'b' ? '**' : '__';
      const tagLength = prefix.length;

      const selectedText = value.substring(start, end);
      const beforeText = value.substring(0, start);
      const afterText = value.substring(end);

      let newValue = '';
      let newStart = start;
      let newEnd = end;

      if (beforeText.endsWith(prefix) && afterText.startsWith(prefix)) {
        newValue = beforeText.substring(0, beforeText.length - tagLength) + selectedText + afterText.substring(tagLength);
        newStart = start - tagLength;
        newEnd = end - tagLength;
      } else if (selectedText.startsWith(prefix) && selectedText.endsWith(prefix)) {
        newValue = beforeText + selectedText.substring(tagLength, selectedText.length - tagLength) + afterText;
        newStart = start;
        newEnd = end - (tagLength * 2);
      } else {
        newValue = beforeText + prefix + selectedText + prefix + afterText;
        newStart = start + tagLength;
        newEnd = end + tagLength;
      }

      setValue(newValue);

      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(newStart, newEnd);
      }, 0);
    }
  };

  const handleOpenExternal = async (url: string, e: React.MouseEvent) => {
    e.preventDefault();
    try {
      await ipcSafe.invoke('open-external', url);
    } catch (err) {
      console.error('Failed to open external link', err);
      // Fallback for browser environment
      window.open(url, '_blank');
    }
  };

  const handleSaveTemplateLocal = async () => {
    if (!currentEpisode || !activeTemplate) return;
    const propMap = { 
      'TG': 'tgPostTemplate', 
      'VK': 'vkPostTemplate', 
      'FINAL_TG': 'finalTgPostTemplate',
      'TG_ARTICLE': 'tgArticleTemplate'
    };
    const propName = propMap[activeTemplate] as 'tgPostTemplate' | 'vkPostTemplate' | 'finalTgPostTemplate' | 'tgArticleTemplate';
    if (!propName) return; 

    try {
      const updatedEpisode = {
        ...currentEpisode,
        [propName]: editingTemplateStr
      };
      await ipcSafe.invoke('save-episode', updatedEpisode);
      setIsEditingTemplate(false);
      setPostContent(applyTemplate(editingTemplateStr, getTemplateVariables(currentEpisode, participants)));
      onRefresh();
    } catch(e) {
      console.error(e);
    }
  };

  const handleSaveLinksTemplate = async (isGlobal: boolean) => {
    if (!currentEpisode) return;
    try {
      if (isGlobal && currentEpisode.project) {
        await ipcSafe.invoke('save-project', { ...currentEpisode.project, linksTemplate: linksTemplateStr });
        const epUpdate = { ...currentEpisode };
        if (epUpdate.linksTemplate !== undefined) {
          delete epUpdate.linksTemplate;
          await ipcSafe.invoke('save-episode', epUpdate);
        }
      } else {
        await ipcSafe.invoke('save-episode', { ...currentEpisode, linksTemplate: linksTemplateStr });
      }
      setIsEditingLinksTemplate(false);
      onRefresh();
    } catch(e) {
      console.error(e);
    }
  };

  const handleSaveTemplateGlobal = async () => {
    if (!currentEpisode?.project || !activeTemplate) return;
    const propMap = { 
      'TG': 'tgPostTemplate', 
      'VK': 'vkPostTemplate', 
      'FINAL_TG': 'finalTgPostTemplate',
      'TG_ARTICLE': 'tgArticleTemplate'
    };
    const propName = propMap[activeTemplate] as 'tgPostTemplate' | 'vkPostTemplate' | 'finalTgPostTemplate' | 'tgArticleTemplate';
    if (!propName) return;

    try {
      const updatedProject = {
        ...currentEpisode.project,
        [propName]: editingTemplateStr
      };
      await ipcSafe.invoke('save-project', updatedProject);
      setIsEditingTemplate(false);
      
      const epUpdate = { ...currentEpisode };
      // Delete local override if we save global
      if (epUpdate[propName] !== undefined) {
        delete epUpdate[propName];
        await ipcSafe.invoke('save-episode', epUpdate);
      }
      
      setPostContent(applyTemplate(editingTemplateStr, getTemplateVariables(currentEpisode, participants)));
      onRefresh();
    } catch(e) {
      console.error(e);
    }
  };

  const handleExportConfig = () => {
    if (!currentEpisode?.project) return;
    const project = currentEpisode.project;
    
    // Пакет конфигурации релиза
    const configData = {
      studioName: project.title,
      emoji: project.emoji || '📢',
      releaseType: project.releaseType || 'VOICEOVER',
      totalEpisodes: project.totalEpisodes || 0,
      airedEpisodes: project.airedEpisodes || 0,
      links: {
        ...links,
        quickUploadLinks: quickLinks
      },
      tgPostTemplate: project.tgPostTemplate || '',
      vkPostTemplate: project.vkPostTemplate || '',
      finalTgPostTemplate: project.finalTgPostTemplate || '',
      tgArticleTemplate: project.tgArticleTemplate || '',
      linksTemplate: project.linksTemplate || '',
      typeAndSeason: project.typeAndSeason || ''
    };
    
    const token = JSON.stringify(configData, null, 2);
    const blob = new Blob([token], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.title.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_]/g, '_')}_release_config.json`;
    document.body.appendChild(a);
    a.click();
    
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportConfig = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!currentEpisode?.project || !e.target.files || e.target.files.length === 0) return;
    
    const file = e.target.files[0];
    const reader = new FileReader();
    
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const configData = JSON.parse(text);
        
        if (!configData || typeof configData !== 'object') {
          alert('Неверный формат файла конфигурации.');
          return;
        }
        
        const project = currentEpisode.project!;
        
        // Разбираем ссылки и быстрые ссылки для загрузки
        let finalLinksStr = project.links;
        if (configData.links) {
          finalLinksStr = JSON.stringify(configData.links);
        }
        
        const updatedProject = {
          ...project,
          title: configData.studioName || project.title,
          emoji: configData.emoji || project.emoji || '📢',
          releaseType: configData.releaseType || project.releaseType || 'VOICEOVER',
          totalEpisodes: configData.totalEpisodes !== undefined ? configData.totalEpisodes : project.totalEpisodes,
          airedEpisodes: configData.airedEpisodes !== undefined ? configData.airedEpisodes : project.airedEpisodes,
          links: finalLinksStr,
          tgPostTemplate: configData.tgPostTemplate !== undefined ? configData.tgPostTemplate : project.tgPostTemplate,
          vkPostTemplate: configData.vkPostTemplate !== undefined ? configData.vkPostTemplate : project.vkPostTemplate,
          finalTgPostTemplate: configData.finalTgPostTemplate !== undefined ? configData.finalTgPostTemplate : project.finalTgPostTemplate,
          tgArticleTemplate: configData.tgArticleTemplate !== undefined ? configData.tgArticleTemplate : project.tgArticleTemplate,
          linksTemplate: configData.linksTemplate !== undefined ? configData.linksTemplate : project.linksTemplate,
          typeAndSeason: configData.typeAndSeason || project.typeAndSeason || ''
        };
        
        await ipcSafe.invoke('save-project', updatedProject);
        
        alert('Конфигурация релиза успешно импортирована!');
        onRefresh();
      } catch (err: any) {
        console.error('Failed to import config', err);
        alert('Ошибка при импорте конфигурации: ' + err.message);
      }
    };
    
    reader.readAsText(file);
    e.target.value = '';
  };

  const templates = [
    { 
      name: 'Пост в Telegram', 
      icon: <Send className="w-4 h-4" />, 
      color: 'bg-blue-600',
      generate: () => currentEpisode ? generateTGPostMessage(currentEpisode, participants) : '',
      type: 'TG' as const
    },
    { 
      name: 'Статья TG (с таблицей)', 
      icon: <Table className="w-4 h-4" />, 
      color: 'bg-emerald-600',
      generate: () => currentEpisode ? generateTGArticleMessage(currentEpisode, participants) : '',
      type: 'TG_ARTICLE' as const
    },
    { 
      name: 'Пост в VK', 
      icon: <Globe className="w-4 h-4" />, 
      color: 'bg-indigo-600',
      generate: () => currentEpisode ? generateVKPostMessage(currentEpisode, participants) : '',
      type: 'VK' as const
    },
    { 
      name: 'Финальный пост TG', 
      icon: <Sparkles className="w-4 h-4" />, 
      color: 'bg-purple-600',
      generate: () => currentEpisode ? generateFinalTGMessage(currentEpisode, participants) : '',
      type: 'FINAL_TG' as const
    }
  ];

  if (!currentEpisode) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-500 italic">
        Выберите серию для сборки релиза
      </div>
    );
  }

  return (
    <div className="w-full space-y-8 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-purple-600/20 rounded-xl">
            <PlaySquare className="w-8 h-8 text-purple-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">Сборка релиза</h1>
            <p className="text-neutral-400">Формирование постов и сборка финального файла</p>
            <div className="flex items-center gap-2 mt-4">
              <button
                onClick={handleExportConfig}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-purple-400 hover:text-purple-300 rounded-lg text-xs font-bold transition-all border border-neutral-800 hover:border-neutral-700 cursor-pointer"
                title="Экспортировать настройки сборки, ссылки и шаблоны"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Экспорт JSON</span>
              </button>
              <label
                className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-emerald-400 hover:text-emerald-300 rounded-lg text-xs font-bold transition-all border border-neutral-800 hover:border-neutral-700 cursor-pointer"
                title="Импортировать настройки сборки, ссылки и шаблоны"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Импорт JSON</span>
                <input 
                  type="file" 
                  accept=".json" 
                  onChange={handleImportConfig} 
                  className="hidden" 
                />
              </label>
            </div>
          </div>
        </div>
        
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 space-y-2">
              <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Аудио от звукорежиссера</label>
              <div className="flex gap-2">
                <input 
                  type="text"
                  readOnly
                  value={customAudioPath}
                  placeholder="Выберите файл .wav или .mp3..."
                  className="flex-1 bg-black/50 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none"
                />
                <button
                  onClick={async () => {
                    try {
                      const res = await ipcSafe.invoke('select-file', { 
                        filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'flac'] }] 
                      });
                      if (res && res.path) setCustomAudioPath(res.path);
                    } catch (e: any) {
                      if (e && e.message !== 'Selection canceled') console.error(e);
                    }
                  }}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl text-xs font-bold transition-all"
                >
                  Выбрать
                </button>
              </div>
            </div>

            {currentEpisode?.isHardsub && (
              <div className="flex-1 space-y-2">
                <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Чистый RAW (т.к. загружен хардсаб)</label>
                <div className="flex gap-2">
                  <input 
                    type="text"
                    readOnly
                    value={customRawPath}
                    placeholder="Выберите чистый видеофайл..."
                    className="flex-1 bg-black/50 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none"
                  />
                  <button
                    onClick={async () => {
                      try {
                        const res = await ipcSafe.invoke('select-file', { 
                          filters: [{ name: 'Video', extensions: ['mp4', 'mkv', 'avi', 'mov'] }] 
                        });
                        if (res && res.path) setCustomRawPath(res.path);
                      } catch (e: any) {
                        if (e && e.message !== 'Selection canceled') console.error(e);
                      }
                    }}
                    className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl text-xs font-bold transition-all"
                  >
                    Выбрать
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col md:flex-row gap-4">
            {isWeb ? (
              <div className="w-full">
                 <DesktopRequiredMessage title="Сборка релиза недоступна" />
              </div>
            ) : (
             <button
              onClick={handleBuildRelease}
            disabled={isBuilding}
            className="flex items-center justify-center gap-3 px-8 py-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white rounded-2xl font-bold shadow-xl shadow-purple-500/20 transition-all group relative overflow-hidden"
          >
            {isBuilding ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Сборка... {buildProgress}%</span>
                <div 
                  className="absolute bottom-0 left-0 h-1 bg-white/30 transition-all duration-300" 
                  style={{ width: `${buildProgress}%` }}
                />
              </>
            ) : (
              <>
                <Package className="w-5 h-5 group-hover:scale-110 transition-transform" />
                <span>Собрать релиз</span>
              </>
            )}
           </button>
           )}
         </div>
       </div>
     </div>

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

      {/* Platform Links Section */}
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
          <div className="flex items-center gap-2">
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
            {Object.keys(links).filter(k => k !== 'quickUploadLinks').map((key) => (
              <div key={key} className="flex-1 min-w-[280px] space-y-2 bg-neutral-900/40 p-4 rounded-xl border border-neutral-800/60 relative group">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex flex-col">
                    <input 
                      type="text" 
                      value={key} 
                      onChange={(e) => {
                        const newKey = e.target.value.replace(/[^a-zA-Z0-9]/g, '');
                        if (!newKey || newKey === key) return;
                        const newLinks = { ...links };
                        newLinks[newKey] = newLinks[key];
                        delete newLinks[key];
                        updateLinksAndSync(newLinks);
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

      {postContent && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="p-4 border-b border-neutral-800 bg-neutral-900/50 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                {activeTemplate === 'TG_ARTICLE' ? (
                  <Table className="w-4 h-4 text-emerald-400" />
                ) : (
                  <MessageSquare className="w-4 h-4 text-purple-400" />
                )}
                <span className="text-sm font-bold text-white uppercase tracking-wider">
                  {isEditingTemplate ? 'Редактирование шаблона' : activeTemplate === 'TG_ARTICLE' ? 'Статья Telegram с таблицей' : 'Предпросмотр сообщения'}
                </span>
              </div>

              {!isEditingTemplate && activeTemplate === 'TG_ARTICLE' && (
                <div className="flex items-center bg-black/40 border border-neutral-800 rounded-lg p-0.5 text-xs">
                  <button
                    onClick={() => setArticleViewMode('visual')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all font-medium ${
                      articleViewMode === 'visual'
                        ? 'bg-emerald-600/80 text-white shadow-sm'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                    title="Вид статьи со стилизованной таблицей"
                  >
                    <Eye className="w-3 h-3" />
                    <span>Вид статьи</span>
                  </button>
                  <button
                    onClick={() => setArticleViewMode('markdown')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all font-medium ${
                      articleViewMode === 'markdown'
                        ? 'bg-emerald-600/80 text-white shadow-sm'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                    title="Исходная Markdown-разметка таблицы"
                  >
                    <Code className="w-3 h-3" />
                    <span>Markdown</span>
                  </button>
                  <button
                    onClick={() => setArticleViewMode('unicode')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all font-medium ${
                      articleViewMode === 'unicode'
                        ? 'bg-emerald-600/80 text-white shadow-sm'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                    title="Таблица Unicode-символами (для моноширинного текста в Telegram)"
                  >
                    <Columns className="w-3 h-3" />
                    <span>Unicode-таблица</span>
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!isEditingTemplate ? (
                <>
                  <button
                    onClick={() => {
                      if (activeTemplate) {
                        setEditingTemplateStr(getTemplateString(currentEpisode, activeTemplate));
                        setIsEditingTemplate(true);
                      }
                    }}
                    className="flex items-center gap-2 px-3.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-bold transition-all"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-purple-400" />
                    Редактировать шаблон
                  </button>

                  {activeTemplate === 'TG_ARTICLE' && (
                    <>
                      <button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(postContent);
                            setIsCopiedMarkdown(true);
                            setTimeout(() => setIsCopiedMarkdown(false), 2000);
                          } catch (e) {
                            console.error(e);
                          }
                        }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          isCopiedMarkdown ? 'bg-green-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'
                        }`}
                        title="Скопировать чистый Markdown статьи"
                      >
                        {isCopiedMarkdown ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Code className="w-3.5 h-3.5" />}
                        {isCopiedMarkdown ? 'Markdown скопирован!' : 'Копировать MD'}
                      </button>

                      <button
                        onClick={async () => {
                          try {
                            const unicodeText = markdownTableToUnicodeBox(postContent);
                            await navigator.clipboard.writeText(unicodeText);
                            setIsCopiedUnicode(true);
                            setTimeout(() => setIsCopiedUnicode(false), 2000);
                          } catch (e) {
                            console.error(e);
                          }
                        }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          isCopiedUnicode ? 'bg-green-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'
                        }`}
                        title="Скопировать таблицу псевдографикой Unicode (для обычных постов в моноширинном шрифте)"
                      >
                        {isCopiedUnicode ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Columns className="w-3.5 h-3.5" />}
                        {isCopiedUnicode ? 'Таблица скопирована!' : 'Копировать Unicode'}
                      </button>

                      <a
                        href="https://telegra.ph"
                        onClick={(e) => handleOpenExternal('https://telegra.ph', e)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-bold transition-all"
                        title="Открыть Telegra.ph в браузере для вставки статьи"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Telegra.ph</span>
                      </a>
                    </>
                  )}

                  <button
                    onClick={handleCopy}
                    className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all shadow-md ${
                      isCopied ? 'bg-green-600 text-white' : activeTemplate === 'TG_ARTICLE' ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-purple-600 hover:bg-purple-500 text-white'
                    }`}
                    title="Копирует форматированный текст и HTML-таблицу для вставки в Telegram/Telegra.ph"
                  >
                    {isCopied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {isCopied ? 'Скопировано!' : activeTemplate === 'TG_ARTICLE' ? 'Скопировать для статьи' : 'Копировать'}
                  </button>

                  <button
                    onClick={() => setIsTelegramModalOpen(true)}
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-bold transition-all shadow-md"
                    title="Опубликовать в канале через Telegram MTProto Client"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Опубликовать в TG MTProto</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setIsEditingTemplate(false)}
                    className="flex items-center gap-2 px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-bold transition-all"
                  >
                    Отмена
                  </button>
                  <button
                    onClick={handleSaveTemplateLocal}
                    className="flex items-center gap-2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-all"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Сохранить только для этой серии
                  </button>
                  <button
                    onClick={handleSaveTemplateGlobal}
                    className="flex items-center gap-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-all"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Сохранить для всего проекта
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="p-6 md:p-8 flex flex-col gap-4">
            {activeTemplate === 'TG_ARTICLE' && !isEditingTemplate && (
              <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-xl p-3.5 text-xs text-emerald-200/90 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2.5">
                  <span className="text-base">💡</span>
                  <span>
                    Нажмите <strong>«Скопировать для статьи»</strong> и вставьте (<strong>Ctrl+V</strong>) в редактор <strong>Telegram Desktop</strong> или <strong>Telegra.ph</strong>. Готовая таблица, роли и ссылки отформатируются автоматически.
                  </span>
                </div>
              </div>
            )}

            {isEditingTemplate && (
              <div className="bg-blue-900/20 border border-blue-500/20 p-6 rounded-xl text-xs text-blue-200 overflow-y-auto max-h-[300px] custom-scrollbar space-y-6">
                <div>
                  <p className="font-bold mb-3 text-sm text-blue-300">💡 Таблицы и списки для статьи:</p>
                  <div className="space-y-4 font-mono bg-black/40 p-3 rounded-lg border border-blue-900/40">
                    <div>
                      <p className="text-[10px] text-emerald-400 font-bold uppercase mb-1">Готовая таблица для статьи:</p>
                      <ul className="list-disc list-inside space-y-1 opacity-90">
                        <li><span className="text-emerald-300">{'{articleTable}'}</span> — полная таблица с ролями, дабберами, таймингом и оформлением</li>
                      </ul>
                    </div>
                    <div className="pt-2 border-t border-blue-900/20">
                      <p className="text-[10px] text-blue-400 font-bold uppercase mb-1">Списки для кастомной таблицы:</p>
                      <ul className="list-disc list-inside space-y-1 opacity-90">
                        <li><span className="text-white">mainRoles</span> (Пер. { '{character}, {nickname}, {tgLink}, {vk}' })</li>
                        <li><span className="text-white">secondaryDubbers</span> (Пер. { '{nickname}, {tgLink}, {vk}' })</li>
                        <li><span className="text-white">dubbers</span> (Пер. { '{nickname}, {tgLink}, {vk}' })</li>
                      </ul>
                    </div>
                    <div className="pt-2 border-t border-blue-900/20">
                      <p className="text-[10px] text-blue-400 font-bold uppercase mb-1">Пример строки таблицы:</p>
                      <p className="text-white opacity-80 whitespace-pre text-[11px]">| ❇ {'{character}'} | [{'{nickname}'}]({'{tgLink}'}) |</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                  <div className="space-y-2">
                    <p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mb-1 opacity-70">Основы (Чистые)</p>
                    <div className="grid grid-cols-1 gap-1 font-mono text-[11px]">
                      <span>{'{emoji}'}</span>
                      <span>{'{projectTitle}'}</span>
                      <span>{'{releaseTypeLabel}'} - Закадр/Рекаст</span>
                      <span>{'{progress}'} - 1/12</span>
                      <span>{'{episodeNumber}'}</span>
                      <span>{'{nextEpisodeNumber}'}</span>
                      <span>{'{totalEpisodes}'}</span>
                      <span>{'{projectSlug}'} - хештег</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mb-1 opacity-70">Предыдущая серия и ссылки</p>
                    <div className="grid grid-cols-1 gap-1 font-mono text-[11px]">
                      <span>{'{prevEpisodeNumber}'}</span>
                      <span>{'{prevLinkTg}'}</span>
                      <span>{'{prevLinkVk}'}</span>
                      <span>{'{linkCatalog}'}</span>
                      <span>{'{catalogLabel}'}</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mb-1 opacity-70">Звукорежиссер</p>
                    <div className="grid grid-cols-1 gap-1 font-mono text-[11px]">
                      <span>{'{seNickname}'}</span>
                      <span>{'{seMention}'} - @тг</span>
                      <span>{'{seVk}'} - @вк</span>
                      <span>{'{seTgLink}'} - ссылка на тг</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mb-1 opacity-70">Готовые блоки</p>
                    <div className="grid grid-cols-1 gap-1 font-mono text-[11px]">
                      <span>{'{articleTable}'}</span>
                      <span>{'{mainRolesText}'}</span>
                      <span>{'{dubberLinks}'}</span>
                      <span>{'{dubberInfo}'}</span>
                      <span>{'{platformLinks}'}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {isEditingTemplate ? (
              <textarea
                value={editingTemplateStr}
                onChange={e => setEditingTemplateStr(e.target.value)}
                onKeyDown={e => handleTextareaKeyDown(e, setEditingTemplateStr)}
                className="w-full bg-black/50 border border-neutral-800 rounded-xl p-6 text-sm text-neutral-300 font-mono leading-relaxed min-h-[400px] focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              />
            ) : activeTemplate === 'TG_ARTICLE' && articleViewMode === 'visual' ? (
              <div className="bg-[#0e1621] border border-[#233d5d] rounded-2xl p-6 overflow-x-auto shadow-inner flex justify-center">
                <div 
                  className="w-full max-w-[540px]"
                  dangerouslySetInnerHTML={{ __html: convertToHTMLForTelegram(postContent) }}
                />
              </div>
            ) : activeTemplate === 'TG_ARTICLE' && articleViewMode === 'unicode' ? (
              <pre className="bg-black/60 border border-neutral-800 rounded-xl p-6 text-sm text-emerald-300/90 whitespace-pre font-mono leading-tight max-h-[550px] overflow-x-auto overflow-y-auto custom-scrollbar">
                {markdownTableToUnicodeBox(postContent)}
              </pre>
            ) : (
              <pre className="bg-black/50 border border-neutral-800 rounded-xl p-8 text-sm text-neutral-300 whitespace-pre-wrap font-mono leading-relaxed max-h-[500px] overflow-y-auto custom-scrollbar">
                {postContent}
              </pre>
            )}
          </div>
        </div>
      )}

      {isTelegramModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4 overflow-hidden">
          <div className="w-full max-w-6xl max-h-[92vh] h-full flex flex-col my-auto">
            <TelegramClientPanel
              currentEpisode={currentEpisode}
              currentProject={currentEpisode?.project}
              allProjects={allProjects}
              onRefreshProjects={() => {
                loadProjects();
                onRefresh();
              }}
              onClose={() => setIsTelegramModalOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
