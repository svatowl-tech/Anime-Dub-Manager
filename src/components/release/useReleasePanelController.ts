import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getParticipants } from '../../services/dbService';
import { Participant, Episode, Project, QuickUploadLink, ProjectLinks, ReleaseTemplateType } from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';
import { safeCopyToClipboard } from '../../lib/clipboard';
import { safeJsonParse, ProjectLinksSchema } from '../../lib/validationSchemas';
import { toast } from 'sonner';
import { getReleasePreset, saveReleasePreset, getReleasePresetSync, DEFAULT_QUICK_UPLOAD_LINKS } from '../../lib/releasePresetsService';
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
} from '../../lib/templates';

export interface ReleasePanelProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
}

export const DEFAULT_QUICK_LINKS: QuickUploadLink[] = DEFAULT_QUICK_UPLOAD_LINKS;

export function useReleasePanelController({ currentEpisode, onRefresh }: ReleasePanelProps) {
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

  // AnimeParsers State
  const [isAnimeSourcesModalOpen, setIsAnimeSourcesModalOpen] = useState(false);
  const [isAutoFillingLinks, setIsAutoFillingLinks] = useState(false);
  const [autoFillFeedback, setAutoFillFeedback] = useState<string | null>(null);

  // Global Release Presets Modal State
  const [isPresetsModalOpen, setIsPresetsModalOpen] = useState(false);

  // Template Block Configurator State
  const [isTemplateBlockConfiguratorOpen, setIsTemplateBlockConfiguratorOpen] = useState(false);

  const updateLinksAndSync = useCallback((newLinks: ProjectLinks) => {
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
  }, []);

  const handleApplyConfiguratorTemplate = async (generatedTplStr: string, saveForProject: boolean) => {
    setEditingTemplateStr(generatedTplStr);
    setPostContent(applyTemplate(generatedTplStr, getTemplateVariables(currentEpisode!, participants)));

    if (currentEpisode) {
      const tplKey =
        activeTemplate === 'TG' ? 'tgPostTemplate' :
        activeTemplate === 'VK' ? 'vkPostTemplate' :
        activeTemplate === 'TG_ARTICLE' ? 'tgArticleTemplate' :
        activeTemplate === 'FINAL_TG' ? 'finalTgPostTemplate' : 'linksTemplate';

      if (saveForProject && currentEpisode.project) {
        try {
          const updatedProject = { ...currentEpisode.project, [tplKey]: generatedTplStr };
          await ipcSafe.invoke('save-project', updatedProject);
          onRefresh();
        } catch (e) {
          console.error('Failed to save project template', e);
        }
      } else {
        try {
          const updatedEp = { ...currentEpisode, [tplKey]: generatedTplStr };
          await ipcSafe.invoke('save-episode', updatedEp);
          onRefresh();
        } catch (e) {
          console.error('Failed to save episode template', e);
        }
      }
    }
    setIsTemplateBlockConfiguratorOpen(false);
  };

  const handleQuickAutoFill = async () => {
    if (!currentEpisode?.project) return;
    setIsAutoFillingLinks(true);
    setAutoFillFeedback(null);
    try {
      const res = await ipcSafe.invoke('anime-parsers:auto-fill-release-links', {
        projectId: currentEpisode.project.id,
        episodeId: currentEpisode.id,
        title: currentEpisode.project.title,
        originalTitle: currentEpisode.project.originalTitle,
        episodeNumber: currentEpisode.number,
        saveToProject: true
      });

      if (res && res.releaseLinks) {
        const merged = { ...links, ...res.releaseLinks };
        setLinks(merged);
        updateLinksAndSync(merged);
        const count = Object.keys(res.releaseLinks).length;
        setAutoFillFeedback(`Автоматически найдено ${count} ссылок: Kodik, Shikimori, AniLibria, Jut.su!`);
        setTimeout(() => setAutoFillFeedback(null), 4000);
        onRefresh();
      }
    } catch (e: any) {
      console.error('Quick autofill error:', e);
      setAutoFillFeedback('Не удалось автозаполнить ссылки: ' + (e.message || 'Ошибка'));
    } finally {
      setIsAutoFillingLinks(false);
    }
  };

  const handleApplySourcesModalLinks = async (newFoundLinks: Record<string, string>) => {
    const merged = { ...links, ...newFoundLinks };
    setLinks(merged);
    updateLinksAndSync(merged);
    if (currentEpisode?.project) {
      try {
        const updatedProject = {
          ...currentEpisode.project,
          links: JSON.stringify({ ...merged, quickUploadLinks: quickLinks })
        };
        await ipcSafe.invoke('save-project', updatedProject);
        onRefresh();
      } catch (err) {
        console.error('Failed to auto-save project links from modal', err);
      }
    }
  };

  const handleSelectVideoSource = async (streamUrl: string, _label: string) => {
    if (!currentEpisode) return;
    try {
      await ipcSafe.invoke('save-episode', { ...currentEpisode, rawPath: streamUrl });
      onRefresh();
    } catch (err) {
      console.error('Failed to set episode stream source', err);
    }
  };

  const handleSelectSubtitleSource = async (subUrl: string, _label: string) => {
    if (!currentEpisode) return;
    try {
      await ipcSafe.invoke('save-episode', { ...currentEpisode, subPath: subUrl });
      onRefresh();
    } catch (err) {
      console.error('Failed to set episode subtitle source', err);
    }
  };

  const loadProjects = useCallback(async () => {
    try {
      const prjs = await ipcSafe.invoke('get-projects');
      if (Array.isArray(prjs)) setAllProjects(prjs);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    if (isTelegramModalOpen) loadProjects();
  }, [isTelegramModalOpen, loadProjects]);

  const renderedHtmlArticle = useMemo(() => {
    if (activeTemplate === 'TG_ARTICLE' && articleViewMode === 'visual' && postContent) {
      return convertToHTMLForTelegram(postContent);
    }
    return '';
  }, [activeTemplate, articleViewMode, postContent]);

  const renderedUnicodeArticle = useMemo(() => {
    if (activeTemplate === 'TG_ARTICLE' && articleViewMode === 'unicode' && postContent) {
      return markdownTableToUnicodeBox(postContent);
    }
    return '';
  }, [activeTemplate, articleViewMode, postContent]);

  useEffect(() => {
    ipcSafe.invoke('get-tasks').then((tasks: any[]) => {
      if (Array.isArray(tasks) && currentEpisode) {
        const buildTask = tasks.find(t =>
          t.type === 'mux-release' &&
          (t.status === 'running' || t.status === 'pending') &&
          (t.payload?.episode?.id === currentEpisode.id || t.metadata?.episodeId === currentEpisode.id)
        );
        if (buildTask) {
          setIsBuilding(true);
          setBuildProgress(buildTask.progress || 0);
        }
      }
    }).catch(() => {});

    const removeQueueListener = ipcSafe.on('task-queue-updated', (tasks: any[]) => {
      if (Array.isArray(tasks) && currentEpisode) {
        const buildTask = tasks.find(t =>
          t.type === 'mux-release' &&
          (t.status === 'running' || t.status === 'pending') &&
          (t.payload?.episode?.id === currentEpisode.id || t.metadata?.episodeId === currentEpisode.id)
        );
        if (buildTask) {
          setIsBuilding(true);
          if (typeof buildTask.progress === 'number') setBuildProgress(buildTask.progress);
        } else {
          setIsBuilding(false);
        }
      }
    });

    const removeProgressListener = ipcSafe.on('task-progress', (data: { id: string; progress: number }) => {
      if (data && typeof data.progress === 'number') setBuildProgress(data.progress);
    });

    const removeFfmpegListener = ipcSafe.on('ffmpeg-progress', (percent: number) => {
      if (typeof percent === 'number') setBuildProgress(percent);
    });

    return () => {
      removeQueueListener();
      removeProgressListener();
      removeFfmpegListener();
    };
  }, [currentEpisode?.id]);

  const handleBuildRelease = async () => {
    if (!currentEpisode || isBuilding) return;
    try {
      const result = await ipcSafe.invoke('select-directory');
      if (!result || !result.filePaths || result.filePaths.length === 0) return;
      const targetDir = result.filePaths[0];

      setIsBuilding(true);
      setBuildProgress(0);
      await ipcSafe.invoke('enqueue-ffmpeg-task', {
        type: 'mux-release',
        payload: {
          episode: currentEpisode,
          targetDir,
          customAudioPath: customAudioPath || undefined,
          customRawPath: customRawPath || undefined
        },
        metadata: {
          episodeId: currentEpisode.id,
          title: `Сборка: ${currentEpisode.project?.title} - Серия ${currentEpisode.number}`
        }
      });
    } catch (error: unknown) {
      setIsBuilding(false);
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg && errMsg !== 'Selection canceled') {
        toast.error(`Ошибка при постановке в очередь: ${errMsg}`);
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
    if (!currentEpisode) return;
    const relType = currentEpisode.project?.releaseType || 'VOICEOVER';
    const preset = getReleasePresetSync(relType);
    const targetType: ReleaseTemplateType = activeTemplate || currentEpisode.project?.defaultTemplateType || preset.defaultTemplateType || 'TG';

    if (!activeTemplate) setActiveTemplate(targetType);

    if (targetType === 'TG') setPostContent(generateTGPostMessage(currentEpisode, participants));
    else if (targetType === 'TG_ARTICLE') setPostContent(generateTGArticleMessage(currentEpisode, participants));
    else if (targetType === 'VK') setPostContent(generateVKPostMessage(currentEpisode, participants));
    else if (targetType === 'FINAL_TG') setPostContent(generateFinalTGMessage(currentEpisode, participants));
  }, [currentEpisode?.id, currentEpisode?.project?.releaseType, currentEpisode?.project?.defaultTemplateType, participants.length, activeTemplate]);

  useEffect(() => {
    const defaultRequiredLinks: ProjectLinks = { tg: '', vk: '', anime365: '', shikimori: '', kodik: '' };
    const relType = currentEpisode?.project?.releaseType || 'VOICEOVER';
    const preset = getReleasePresetSync(relType);

    if (currentEpisode?.project?.links) {
      const parsed = safeJsonParse<ProjectLinks>(
        currentEpisode.project.links,
        {},
        `ReleasePanel:links(${currentEpisode.project.id})`,
        ProjectLinksSchema
      );
      const mergedLinks: ProjectLinks = { ...defaultRequiredLinks, ...preset.defaultPlatformLinks, ...parsed };
      setLinks(mergedLinks);
      if (parsed.quickUploadLinks && Array.isArray(parsed.quickUploadLinks) && parsed.quickUploadLinks.length > 0) {
        setQuickLinks(parsed.quickUploadLinks);
      } else {
        setQuickLinks(preset.quickUploadLinks || DEFAULT_QUICK_LINKS);
      }
    } else {
      setLinks({ ...defaultRequiredLinks, ...preset.defaultPlatformLinks });
      setQuickLinks(preset.quickUploadLinks || DEFAULT_QUICK_LINKS);
    }
  }, [currentEpisode?.project?.id, currentEpisode?.project?.links, currentEpisode?.project?.releaseType]);

  const handleSaveLinks = async () => {
    if (!currentEpisode?.project) return;
    setIsSavingLinks(true);
    try {
      const updatedLinksObj: ProjectLinks = { ...links, quickUploadLinks: quickLinks };
      const updatedProject = { ...currentEpisode.project, links: JSON.stringify(updatedLinksObj) };
      await ipcSafe.invoke('save-project', updatedProject);

      const shouldFinish = !!(tgPostLink?.trim() || vkPostLink?.trim());
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

      await navigator.clipboard.write([
        new ClipboardItem({ 'text/plain': blobPlain, 'text/html': blobHtml })
      ]);

      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy rich text: ', err);
      try {
        await safeCopyToClipboard(postContent);
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
        newEnd = end - tagLength * 2;
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
      window.open(url, '_blank');
    }
  };

  const handleSaveTemplateLocal = async () => {
    if (!currentEpisode || !activeTemplate) return;
    const propMap = { TG: 'tgPostTemplate', VK: 'vkPostTemplate', FINAL_TG: 'finalTgPostTemplate', TG_ARTICLE: 'tgArticleTemplate' };
    const propName = propMap[activeTemplate] as 'tgPostTemplate' | 'vkPostTemplate' | 'finalTgPostTemplate' | 'tgArticleTemplate';
    if (!propName) return;

    try {
      const updatedEpisode = { ...currentEpisode, [propName]: editingTemplateStr };
      await ipcSafe.invoke('save-episode', updatedEpisode);
      setIsEditingTemplate(false);
      setPostContent(applyTemplate(editingTemplateStr, getTemplateVariables(currentEpisode, participants)));
      onRefresh();
    } catch (e) {
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
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveTemplateGlobal = async () => {
    if (!currentEpisode?.project || !activeTemplate) return;
    const propMap = { TG: 'tgPostTemplate', VK: 'vkPostTemplate', FINAL_TG: 'finalTgPostTemplate', TG_ARTICLE: 'tgArticleTemplate' };
    const propName = propMap[activeTemplate] as 'tgPostTemplate' | 'vkPostTemplate' | 'finalTgPostTemplate' | 'tgArticleTemplate';
    if (!propName) return;

    try {
      const updatedProject: Project = {
        ...currentEpisode.project,
        defaultTemplateType: activeTemplate,
        [propName]: editingTemplateStr
      };
      await ipcSafe.invoke('save-project', updatedProject);

      const relType = currentEpisode.project.releaseType || 'VOICEOVER';
      const preset = await getReleasePreset(relType);
      preset[propName] = editingTemplateStr;
      preset.defaultTemplateType = activeTemplate;
      await saveReleasePreset(preset);

      setIsEditingTemplate(false);
      const epUpdate = { ...currentEpisode };
      if (epUpdate[propName] !== undefined) {
        delete epUpdate[propName];
        await ipcSafe.invoke('save-episode', epUpdate);
      }

      setPostContent(applyTemplate(editingTemplateStr, getTemplateVariables(currentEpisode, participants)));
      onRefresh();
    } catch (e) {
      console.error(e);
    }
  };

  const handleExportConfig = () => {
    if (!currentEpisode?.project) return;
    const project = currentEpisode.project;
    const configData = {
      studioName: project.title,
      emoji: project.emoji || '📢',
      releaseType: project.releaseType || 'VOICEOVER',
      totalEpisodes: project.totalEpisodes || 0,
      airedEpisodes: project.airedEpisodes || 0,
      links: { ...links, quickUploadLinks: quickLinks },
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

    reader.onload = async event => {
      try {
        const text = event.target?.result as string;
        const configData = JSON.parse(text);
        if (!configData || typeof configData !== 'object') {
          alert('Неверный формат файла конфигурации.');
          return;
        }
        const project = currentEpisode.project!;
        const finalLinksStr = configData.links ? JSON.stringify(configData.links) : project.links;
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

  return {
    participants, postContent, setPostContent, isCopied, isCopiedMarkdown, setIsCopiedMarkdown, isCopiedUnicode, setIsCopiedUnicode,
    activeTemplate, setActiveTemplate, articleViewMode, setArticleViewMode, links, setLinks, isSavingLinks, isBuilding, buildProgress,
    customAudioPath, setCustomAudioPath, customRawPath, setCustomRawPath, isEditingTemplate, setIsEditingTemplate, editingTemplateStr,
    setEditingTemplateStr, linksTemplateStr, setLinksTemplateStr, isEditingLinksTemplate, setIsEditingLinksTemplate, quickLinks,
    setQuickLinks, isEditingQuickLinks, setIsEditingQuickLinks, tgPostLink, setTgPostLink, vkPostLink, setVkPostLink, isTelegramModalOpen,
    setIsTelegramModalOpen, allProjects, loadProjects, isAnimeSourcesModalOpen, setIsAnimeSourcesModalOpen, isAutoFillingLinks,
    autoFillFeedback, setAutoFillFeedback, isPresetsModalOpen, setIsPresetsModalOpen, isTemplateBlockConfiguratorOpen,
    setIsTemplateBlockConfiguratorOpen, renderedHtmlArticle, renderedUnicodeArticle, updateLinksAndSync, handleApplyConfiguratorTemplate,
    handleQuickAutoFill, handleApplySourcesModalLinks, handleSelectVideoSource, handleSelectSubtitleSource, handleBuildRelease,
    handleSaveLinks, handleSaveEpisodePostLinks, handleCopy, handleTextareaKeyDown, handleOpenExternal, handleSaveTemplateLocal,
    handleSaveLinksTemplate, handleSaveTemplateGlobal, handleExportConfig, handleImportConfig, getTemplateString
  };
}
