import { useState, useEffect, useRef, useCallback } from 'react';
import { Episode, Participant, ProjectLinks, QuickUploadLink, Project } from '../../types';
import { 
  BookmarkItem, 
  ChecklistItemDef, 
  CustomFieldItem, 
  TemplateType, 
  DEFAULT_BOOKMARKS, 
  DEFAULT_PLATFORM_CHECKLIST, 
  DEFAULT_CUSTOM_FIELDS, 
  DEFAULT_QUICK_LINKS, 
  DEFAULT_PLATFORM_NOTES 
} from './types';
import { getParticipants } from '../../services/dbService';
import { ipcSafe } from '../../lib/ipcSafe';
import { 
  generateTGPostMessage, 
  generateVKPostMessage, 
  generateFinalTGMessage,
  getTemplateVariables,
  getTemplateString
} from '../../lib/templates';
import { toast } from 'sonner';

export function useUploaderState(currentEpisode: Episode | null, onRefresh?: () => void) {
  const projectKey = currentEpisode?.project?.id ? `proj_${currentEpisode.project.id}` : 'global';
  const loadedProjectKeyRef = useRef<string>('');

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [activeUrl, setActiveUrl] = useState<string>('https://web.telegram.org/a/');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Bookmarks State
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(DEFAULT_BOOKMARKS);
  const [bmFormName, setBmFormName] = useState('');
  const [bmFormUrl, setBmFormUrl] = useState('');

  // Checklist Defs & Completion State
  const [checklistDefs, setChecklistDefs] = useState<ChecklistItemDef[]>(DEFAULT_PLATFORM_CHECKLIST);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [newChecklistLabel, setNewChecklistLabel] = useState('');
  const [newChecklistUrl, setNewChecklistUrl] = useState('');

  // Post Generator
  const [templateType, setTemplateType] = useState<TemplateType>('TG');
  const [generatedPost, setGeneratedPost] = useState<string>('');
  const [templateSourceStr, setTemplateSourceStr] = useState<string>('');

  // Platform Links & Post Links
  const [projectLinks, setProjectLinks] = useState<ProjectLinks>({});
  const [quickLinks, setQuickLinks] = useState<QuickUploadLink[]>(DEFAULT_QUICK_LINKS);
  const [isEditingQuickLinks, setIsEditingQuickLinks] = useState<boolean>(false);
  const [tgPostLink, setTgPostLink] = useState<string>('');
  const [vkPostLink, setVkPostLink] = useState<string>('');
  const [isSavingLinks, setIsSavingLinks] = useState<boolean>(false);

  // Custom Copy Fields
  const [customFields, setCustomFields] = useState<CustomFieldItem[]>(DEFAULT_CUSTOM_FIELDS);
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');

  // Platform Notes
  const [platformNotes, setPlatformNotes] = useState<string>(DEFAULT_PLATFORM_NOTES);

  // Load participants & projects
  const loadProjects = useCallback(async () => {
    try {
      const prjs = await ipcSafe.invoke('get-projects');
      if (Array.isArray(prjs)) {
        setAllProjects(prjs);
      }
    } catch (e) {
      console.error('[Uploader] Error loading projects:', e);
    }
  }, []);

  useEffect(() => {
    getParticipants().then(setParticipants).catch(console.error);
    loadProjects();
  }, [loadProjects]);

  // Sync project links & post links when episode changes
  useEffect(() => {
    if (currentEpisode) {
      setTgPostLink(currentEpisode.tgPostLink || '');
      setVkPostLink(currentEpisode.vkPostLink || '');

      if (currentEpisode.project?.links) {
        try {
          const parsed = JSON.parse(currentEpisode.project.links) as ProjectLinks;
          setProjectLinks(parsed);
          if (parsed.quickUploadLinks && Array.isArray(parsed.quickUploadLinks)) {
            setQuickLinks(parsed.quickUploadLinks);
          } else {
            setQuickLinks(DEFAULT_QUICK_LINKS);
          }
        } catch (e) {
          setProjectLinks({});
          setQuickLinks(DEFAULT_QUICK_LINKS);
        }
      } else {
        setProjectLinks({});
        setQuickLinks(DEFAULT_QUICK_LINKS);
      }
    }
  }, [currentEpisode?.id, currentEpisode?.project?.id]);

  // Load per-project panel settings whenever active project changes
  useEffect(() => {
    const savedBm = localStorage.getItem(`uploader_bookmarks_${projectKey}`);
    if (savedBm) {
      try { setBookmarks(JSON.parse(savedBm)); } catch (e) { setBookmarks(DEFAULT_BOOKMARKS); }
    } else {
      const globalBm = localStorage.getItem('uploader_bookmarks');
      try { setBookmarks(globalBm ? JSON.parse(globalBm) : DEFAULT_BOOKMARKS); } catch (e) { setBookmarks(DEFAULT_BOOKMARKS); }
    }

    const savedClDefs = localStorage.getItem(`uploader_checklist_defs_${projectKey}`);
    if (savedClDefs) {
      try { setChecklistDefs(JSON.parse(savedClDefs)); } catch (e) { setChecklistDefs(DEFAULT_PLATFORM_CHECKLIST); }
    } else {
      const globalClDefs = localStorage.getItem('uploader_checklist_defs');
      try { setChecklistDefs(globalClDefs ? JSON.parse(globalClDefs) : DEFAULT_PLATFORM_CHECKLIST); } catch (e) { setChecklistDefs(DEFAULT_PLATFORM_CHECKLIST); }
    }

    const savedFields = localStorage.getItem(`uploader_custom_copy_fields_${projectKey}`);
    if (savedFields) {
      try { setCustomFields(JSON.parse(savedFields)); } catch (e) { setCustomFields(DEFAULT_CUSTOM_FIELDS); }
    } else {
      const globalFields = localStorage.getItem('uploader_custom_copy_fields');
      try { setCustomFields(globalFields ? JSON.parse(globalFields) : DEFAULT_CUSTOM_FIELDS); } catch (e) { setCustomFields(DEFAULT_CUSTOM_FIELDS); }
    }

    const savedNotes = localStorage.getItem(`uploader_platform_notes_${projectKey}`);
    if (savedNotes !== null) {
      setPlatformNotes(savedNotes);
    } else {
      const globalNotes = localStorage.getItem('uploader_platform_notes');
      setPlatformNotes(globalNotes !== null ? globalNotes : DEFAULT_PLATFORM_NOTES);
    }

    loadedProjectKeyRef.current = projectKey;
  }, [projectKey]);

  // Persist project settings
  useEffect(() => {
    if (loadedProjectKeyRef.current === projectKey) {
      localStorage.setItem(`uploader_bookmarks_${projectKey}`, JSON.stringify(bookmarks));
    }
  }, [bookmarks, projectKey]);

  useEffect(() => {
    if (loadedProjectKeyRef.current === projectKey) {
      localStorage.setItem(`uploader_checklist_defs_${projectKey}`, JSON.stringify(checklistDefs));
    }
  }, [checklistDefs, projectKey]);

  useEffect(() => {
    if (loadedProjectKeyRef.current === projectKey) {
      localStorage.setItem(`uploader_custom_copy_fields_${projectKey}`, JSON.stringify(customFields));
    }
  }, [customFields, projectKey]);

  useEffect(() => {
    if (loadedProjectKeyRef.current === projectKey) {
      localStorage.setItem(`uploader_platform_notes_${projectKey}`, platformNotes);
    }
  }, [platformNotes, projectKey]);

  // Build or regenerate post text
  const buildPostText = useCallback((type: TemplateType) => {
    if (!currentEpisode) {
      setGeneratedPost('Выберите проект и серию для автоматической генерации поста.');
      return;
    }

    setTemplateType(type);
    let text = '';
    const projectTitle = currentEpisode.project?.title || 'Проект';
    const epNum = currentEpisode.number;

    if (type === 'TG') {
      text = generateTGPostMessage(currentEpisode, participants);
      setTemplateSourceStr(getTemplateString(currentEpisode, 'TG'));
    } else if (type === 'VK') {
      text = generateVKPostMessage(currentEpisode, participants);
      setTemplateSourceStr(getTemplateString(currentEpisode, 'VK'));
    } else if (type === 'FINAL_TG') {
      text = generateFinalTGMessage(currentEpisode, participants);
      setTemplateSourceStr(getTemplateString(currentEpisode, 'FINAL_TG'));
    } else if (type === 'YT') {
      const vars = getTemplateVariables(currentEpisode, participants);
      text = `🎬 ${projectTitle} — ${epNum} Серия [Озвучка]\n\n` +
             `Смотрите новую ${epNum} серию аниме "${projectTitle}" в русской озвучке!\n\n` +
             `🎙️ Роли озвучивали: ${vars.dubbersList || 'Команда дабберов'}\n` +
             `🔊 Работа со звуком: ${vars.seName || 'Звукорежиссер'}\n\n` +
             `📌 Наш Telegram канал:\n${projectLinks.tg || 'https://t.me/akaneproject'}\n\n` +
             `#${vars.projectSlug} #аниме #озвучка #${epNum}серия`;
      setTemplateSourceStr(text);
    } else if (type === 'TORRENT') {
      const vars = getTemplateVariables(currentEpisode, participants);
      text = `[b]${projectTitle} / ${currentEpisode.project?.originalTitle || ''} [Серия ${epNum} из ${currentEpisode.project?.totalEpisodes || '?'}] [VO] [/b]\n\n` +
             `[b]Год выпуска:[/b] ${(currentEpisode.project as any)?.year || '2026'}\n` +
             `[b]Жанр:[/b] ${Array.isArray((currentEpisode.project as any)?.genres) ? (currentEpisode.project as any).genres.join(', ') : 'Аниме'}\n` +
             `[b]Озвучка:[/b] ${vars.dubbersList || 'Дабберы'}\n` +
             `[b]Звук и тайминг:[/b] ${vars.seName || 'Звукорежиссер'}\n\n` +
             `[b]Описание:[/b]\n${currentEpisode.project?.synopsis || 'Нет описания.'}`;
      setTemplateSourceStr(text);
    } else if (type === 'CUSTOM') {
      text = generatedPost || `${projectTitle} — ${epNum} серия\n\nОзвучка: ${currentEpisode.assignments?.map(a => a.dubber?.nickname || 'Даббер').join(', ') || 'Дабберы'}`;
      setTemplateSourceStr(text);
    }

    setGeneratedPost(text);
    const epKey = currentEpisode?.id || 'global';
    localStorage.setItem(`uploader_draft_post_${epKey}`, text);
  }, [currentEpisode, participants, projectLinks.tg, generatedPost]);

  // Load persistent draft post and checklist completion status per episode
  useEffect(() => {
    const epKey = currentEpisode?.id || 'global';
    const savedDraft = localStorage.getItem(`uploader_draft_post_${epKey}`);
    const savedUrl = localStorage.getItem(`uploader_last_url`);
    const savedChecklist = localStorage.getItem(`uploader_checklist_${epKey}`);

    if (savedUrl) {
      setActiveUrl(savedUrl);
    }

    if (savedChecklist) {
      try {
        setChecklist(JSON.parse(savedChecklist));
      } catch (e) {
        setChecklist({});
      }
    } else {
      setChecklist({});
    }

    if (savedDraft) {
      setGeneratedPost(savedDraft);
    } else if (currentEpisode) {
      buildPostText(templateType);
    }
  }, [currentEpisode?.id]);

  // Save active URL
  useEffect(() => {
    if (activeUrl) {
      localStorage.setItem(`uploader_last_url`, activeUrl);
    }
  }, [activeUrl]);

  // Save project platform links & episode post links to DB
  const handleSavePlatformLinks = async () => {
    if (!currentEpisode || !currentEpisode.project) return;
    setIsSavingLinks(true);
    try {
      const updatedLinksObj: ProjectLinks = {
        ...projectLinks,
        quickUploadLinks: quickLinks
      };

      await ipcSafe.invoke('save-project', {
        ...currentEpisode.project,
        links: JSON.stringify(updatedLinksObj)
      });

      const finished = !!(tgPostLink.trim() || vkPostLink.trim());
      await ipcSafe.invoke('save-episode', {
        ...currentEpisode,
        tgPostLink,
        vkPostLink,
        ...(finished ? { status: 'FINISHED' as const } : {})
      });

      toast.success('Ссылки релиза сохранены в БД');
      if (onRefresh) onRefresh();
    } catch (e: any) {
      toast.error('Ошибка при сохранении ссылок: ' + (e.message || e));
    } finally {
      setIsSavingLinks(false);
    }
  };

  // One-click copy
  const copyToClipboard = useCallback((text: string, label: string) => {
    if (!text) {
      toast.error('Данные отсутствуют');
      return;
    }
    navigator.clipboard.writeText(text);
    setCopiedField(label);
    toast.success(`Скопировано: ${label}`);
    setTimeout(() => setCopiedField(null), 2000);
  }, []);

  // Open file in folder
  const handleShowInFolder = useCallback(async (filePath?: string | null) => {
    if (!filePath) {
      toast.error('Файл не найден');
      return;
    }
    try {
      await ipcSafe.invoke('show-item-in-folder', filePath);
      toast.success('Открыта папка с файлом');
    } catch (e: any) {
      toast.error('Ошибка открытия папки: ' + (e.message || e));
    }
  }, []);

  // Bookmarks handlers
  const handleSelectBookmark = useCallback((bm: BookmarkItem) => {
    setActiveUrl(bm.url);
  }, []);

  const handleAddBookmark = useCallback(() => {
    if (!bmFormName.trim() || !bmFormUrl.trim()) return;
    let url = bmFormUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    const newBm: BookmarkItem = {
      id: 'bm_' + Date.now(),
      name: bmFormName.trim(),
      url,
      color: 'text-neutral-300 bg-neutral-800 border-neutral-700'
    };
    setBookmarks(prev => [...prev, newBm]);
    setBmFormName('');
    setBmFormUrl('');
    toast.success('Закладка добавлена');
  }, [bmFormName, bmFormUrl]);

  const handleDeleteBookmark = useCallback((id: string) => {
    setBookmarks(prev => prev.filter(b => b.id !== id));
    toast.success('Закладка удалена');
  }, []);

  const handleResetBookmarks = useCallback(() => {
    if (confirm('Сбросить закладки к стандартному списку?')) {
      setBookmarks(DEFAULT_BOOKMARKS);
      toast.success('Закладки сброшены');
    }
  }, []);

  // Checklist handlers
  const toggleChecklistItem = useCallback((id: string) => {
    const epKey = currentEpisode?.id || 'global';
    setChecklist(prev => {
      const updated = { ...prev, [id]: !prev[id] };
      localStorage.setItem(`uploader_checklist_${epKey}`, JSON.stringify(updated));
      return updated;
    });
  }, [currentEpisode?.id]);

  const handleAddChecklistItem = useCallback(() => {
    if (!newChecklistLabel.trim()) return;
    const newItem: ChecklistItemDef = {
      id: 'cl_' + Date.now(),
      label: newChecklistLabel.trim(),
      url: newChecklistUrl.trim() || undefined
    };
    setChecklistDefs(prev => [...prev, newItem]);
    setNewChecklistLabel('');
    setNewChecklistUrl('');
    toast.success('Элемент чек-листа добавлен');
  }, [newChecklistLabel, newChecklistUrl]);

  const handleDeleteChecklistItem = useCallback((id: string) => {
    setChecklistDefs(prev => prev.filter(item => item.id !== id));
    toast.success('Элемент удален');
  }, []);

  const mergeQuickLinksIntoChecklist = useCallback((
    defs: ChecklistItemDef[],
    qLinks: QuickUploadLink[]
  ): ChecklistItemDef[] => {
    if (!qLinks || qLinks.length === 0) return defs;

    const result = [...defs];
    qLinks.forEach((q, idx) => {
      const name = (q.name || q.title || `Ссылка ${idx + 1}`).trim();
      const url = (q.url || '').trim();
      if (!url) return;

      const existingIdx = result.findIndex(
        item => (q.id && item.id === `ql_${q.id}`) ||
                (item.url && item.url.toLowerCase() === url.toLowerCase()) ||
                item.label.toLowerCase() === name.toLowerCase()
      );

      if (existingIdx >= 0) {
        result[existingIdx] = {
          ...result[existingIdx],
          label: name,
          url: url
        };
      } else {
        result.push({
          id: q.id ? `ql_${q.id}` : `ql_${idx}_${Date.now()}`,
          label: name,
          url: url
        });
      }
    });

    return result;
  }, []);

  const handleSyncChecklistWithQuickLinks = useCallback(() => {
    if (!quickLinks || quickLinks.length === 0) {
      toast.error('Нет быстрых кнопок загрузки для синхронизации');
      return;
    }
    const updated = mergeQuickLinksIntoChecklist(checklistDefs, quickLinks);
    setChecklistDefs(updated);
    toast.success(`Чек-лист синхронизирован с кнопками загрузки (${quickLinks.length})`);
  }, [checklistDefs, quickLinks, mergeQuickLinksIntoChecklist]);

  const handleSelectQuickLink = useCallback((q: QuickUploadLink, idx: number) => {
    const linkName = q.name || q.title || `Ссылка ${idx + 1}`;
    handleSelectBookmark({ id: `q_${idx}`, name: linkName, url: q.url });

    const match = checklistDefs.find(
      item => (q.url && item.url.toLowerCase() === q.url.toLowerCase()) || item.label.toLowerCase() === linkName.toLowerCase()
    );
    if (match && !checklist[match.id]) {
      toggleChecklistItem(match.id);
      toast.success(`Пункт «${match.label}» отмечен в чек-листе`);
    }
  }, [checklistDefs, checklist, handleSelectBookmark, toggleChecklistItem]);

  const handleResetChecklistDefs = useCallback(() => {
    if (confirm('Восстановить исходный список чек-листа?')) {
      const defaultMerged = mergeQuickLinksIntoChecklist(DEFAULT_PLATFORM_CHECKLIST, quickLinks);
      setChecklistDefs(defaultMerged);
      toast.success('Чек-лист сброшен');
    }
  }, [quickLinks, mergeQuickLinksIntoChecklist]);

  // Custom fields handlers
  const handleAddCustomField = useCallback(() => {
    if (!newFieldLabel.trim() || !newFieldValue.trim()) return;
    const item: CustomFieldItem = {
      id: 'cf_' + Date.now(),
      label: newFieldLabel.trim(),
      value: newFieldValue.trim()
    };
    setCustomFields(prev => [...prev, item]);
    setNewFieldLabel('');
    setNewFieldValue('');
    toast.success('Быстрое поле добавлено');
  }, [newFieldLabel, newFieldValue]);

  const handleDeleteCustomField = useCallback((id: string) => {
    setCustomFields(prev => prev.filter(f => f.id !== id));
    toast.success('Поле удалено');
  }, []);

  return {
    participants,
    allProjects,
    loadProjects,
    activeUrl,
    setActiveUrl,
    copiedField,
    copyToClipboard,
    handleShowInFolder,

    // Bookmarks
    bookmarks,
    bmFormName,
    setBmFormName,
    bmFormUrl,
    setBmFormUrl,
    handleSelectBookmark,
    handleAddBookmark,
    handleDeleteBookmark,
    handleResetBookmarks,

    // Checklist
    checklistDefs,
    checklist,
    newChecklistLabel,
    setNewChecklistLabel,
    newChecklistUrl,
    setNewChecklistUrl,
    toggleChecklistItem,
    handleAddChecklistItem,
    handleDeleteChecklistItem,
    handleSyncChecklistWithQuickLinks,
    handleResetChecklistDefs,

    // Post Generator
    templateType,
    setTemplateType,
    generatedPost,
    setGeneratedPost,
    templateSourceStr,
    buildPostText,

    // Platform Links
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
    handleSelectQuickLink,

    // Custom Fields
    customFields,
    newFieldLabel,
    setNewFieldLabel,
    newFieldValue,
    setNewFieldValue,
    handleAddCustomField,
    handleDeleteCustomField,

    // Notes
    platformNotes,
    setPlatformNotes
  };
}
