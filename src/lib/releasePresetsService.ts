import { ReleaseType, Project } from '../types';
import { ipcSafe } from './ipcSafe';
import {
  DEFAULT_TG_TEMPLATE_VOICEOVER,
  DEFAULT_TG_TEMPLATE_RECAST,
  DEFAULT_VK_TEMPLATE_VOICEOVER,
  DEFAULT_VK_TEMPLATE_RECAST,
  DEFAULT_TG_ARTICLE_TEMPLATE_VOICEOVER,
  DEFAULT_TG_ARTICLE_TEMPLATE_RECAST,
  DEFAULT_FINAL_TG_TEMPLATE,
  DEFAULT_LINKS_TEMPLATE
} from './templates';

export interface QuickUploadLink {
  name: string;
  url: string;
}

export interface ReleaseTypePreset {
  releaseType: ReleaseType;
  name: string;
  defaultTemplateType: 'TG' | 'TG_ARTICLE' | 'VK' | 'FINAL_TG';
  tgPostTemplate: string;
  tgArticleTemplate: string;
  vkPostTemplate: string;
  finalTgPostTemplate: string;
  linksTemplate: string;
  quickUploadLinks: QuickUploadLink[];
  defaultPlatformLinks: {
    tg?: string;
    vk?: string;
    anime365?: string;
    shikimori?: string;
    kodik?: string;
    [key: string]: string | undefined;
  };
}

export const DEFAULT_QUICK_UPLOAD_LINKS: QuickUploadLink[] = [
  { name: 'TG Загрузка', url: 'https://t.me/akaneproject' },
  { name: 'Kodik Конвертер', url: 'https://converter.kodikres.com/' },
  { name: 'VK Кабинет', url: 'https://cabinet.vkvideo.ru/dashboard/@club216521493?filterPreset=published&section=video_my_content&subsection=video_my_content_videos' },
  { name: 'Anime365', url: 'https://smotret-anime.com/translations/create' },
  { name: 'VK Паблик', url: 'https://vk.com/okaneproject' }
];

export const RELEASE_TYPE_LABELS: Record<ReleaseType, string> = {
  VOICEOVER: 'Закадр',
  RECAST: 'Рекаст',
  REDUB: 'Редаб / Дубляж'
};

export const RELEASE_TYPE_DESCRIPTIONS: Record<ReleaseType, string> = {
  VOICEOVER: 'Многоголосый или двухголосый закадровый перевод поверх оригинальной японской дорожки',
  RECAST: 'Кастомный рекаст или дубляж с полным распределением ролей по персонажам',
  REDUB: 'Полный дубляж с отдельным сведением диалогов'
};

const STORAGE_KEY_PREFIX = 'release_preset_v2_';

export function getDefaultPresetForType(releaseType: ReleaseType): ReleaseTypePreset {
  const isRecast = releaseType === 'RECAST' || releaseType === 'REDUB';
  return {
    releaseType,
    name: RELEASE_TYPE_LABELS[releaseType] || 'Закадр',
    defaultTemplateType: 'TG',
    tgPostTemplate: isRecast ? DEFAULT_TG_TEMPLATE_RECAST : DEFAULT_TG_TEMPLATE_VOICEOVER,
    tgArticleTemplate: isRecast ? DEFAULT_TG_ARTICLE_TEMPLATE_RECAST : DEFAULT_TG_ARTICLE_TEMPLATE_VOICEOVER,
    vkPostTemplate: isRecast ? DEFAULT_VK_TEMPLATE_RECAST : DEFAULT_VK_TEMPLATE_VOICEOVER,
    finalTgPostTemplate: DEFAULT_FINAL_TG_TEMPLATE,
    linksTemplate: DEFAULT_LINKS_TEMPLATE,
    quickUploadLinks: [...DEFAULT_QUICK_UPLOAD_LINKS],
    defaultPlatformLinks: {
      tg: '',
      vk: '',
      anime365: '',
      shikimori: '',
      kodik: ''
    }
  };
}

/**
 * Synchronous get for instant rendering from localStorage cache with fallback
 */
export function getReleasePresetSync(releaseType: ReleaseType): ReleaseTypePreset {
  const defaultPreset = getDefaultPresetForType(releaseType);
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${releaseType}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...defaultPreset,
        ...parsed,
        quickUploadLinks: Array.isArray(parsed.quickUploadLinks) && parsed.quickUploadLinks.length > 0 
          ? parsed.quickUploadLinks 
          : defaultPreset.quickUploadLinks,
        defaultPlatformLinks: {
          ...defaultPreset.defaultPlatformLinks,
          ...(parsed.defaultPlatformLinks || {})
        }
      };
    }
  } catch (e) {
    console.warn(`[ReleasePresets] Error reading localStorage for ${releaseType}:`, e);
  }
  return defaultPreset;
}

/**
 * Loads preset from electron config or localStorage
 */
export async function getReleasePreset(releaseType: ReleaseType): Promise<ReleaseTypePreset> {
  const defaultPreset = getDefaultPresetForType(releaseType);
  try {
    // 1. Try reading from Electron config
    const config = await ipcSafe.invoke('get-config');
    if (config?.releasePresets && config.releasePresets[releaseType]) {
      const confPreset = config.releasePresets[releaseType];
      const merged: ReleaseTypePreset = {
        ...defaultPreset,
        ...confPreset,
        quickUploadLinks: Array.isArray(confPreset.quickUploadLinks) && confPreset.quickUploadLinks.length > 0
          ? confPreset.quickUploadLinks
          : defaultPreset.quickUploadLinks,
        defaultPlatformLinks: {
          ...defaultPreset.defaultPlatformLinks,
          ...(confPreset.defaultPlatformLinks || {})
        }
      };
      // Keep localStorage in sync
      try {
        localStorage.setItem(`${STORAGE_KEY_PREFIX}${releaseType}`, JSON.stringify(merged));
      } catch {}
      return merged;
    }
  } catch (e) {
    console.warn(`[ReleasePresets] Error fetching electron config for ${releaseType}:`, e);
  }

  // Fallback to localStorage
  return getReleasePresetSync(releaseType);
}

/**
 * Saves preset both to localStorage and Electron app config
 */
export async function saveReleasePreset(preset: ReleaseTypePreset): Promise<void> {
  if (!preset || !preset.releaseType) return;
  const relType = preset.releaseType;

  // 1. Save to localStorage immediately
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${relType}`, JSON.stringify(preset));
  } catch (e) {
    console.error(`[ReleasePresets] Error saving to localStorage for ${relType}:`, e);
  }

  // 2. Save to Electron config
  try {
    const config = (await ipcSafe.invoke('get-config')) || {};
    const releasePresets = config.releasePresets || {};
    releasePresets[relType] = preset;
    await ipcSafe.invoke('save-config', { releasePresets });
  } catch (e) {
    console.warn(`[ReleasePresets] Error saving to electron config for ${relType}:`, e);
  }
}

/**
 * Applies a preset to an existing or new project object
 */
export function applyPresetToProject(
  project: Project,
  preset: ReleaseTypePreset,
  options: { overwriteLinks?: boolean; overwriteTemplates?: boolean } = {}
): Project {
  const { overwriteLinks = false, overwriteTemplates = true } = options;

  let projectLinks: any = {};
  try {
    if (project.links) {
      projectLinks = typeof project.links === 'string' ? JSON.parse(project.links) : project.links;
    }
  } catch {
    projectLinks = {};
  }

  const updatedLinks = {
    ...preset.defaultPlatformLinks,
    ...(overwriteLinks ? {} : projectLinks),
    quickUploadLinks: preset.quickUploadLinks
  };

  return {
    ...project,
    tgPostTemplate: overwriteTemplates || !project.tgPostTemplate ? preset.tgPostTemplate : project.tgPostTemplate,
    tgArticleTemplate: overwriteTemplates || !project.tgArticleTemplate ? preset.tgArticleTemplate : project.tgArticleTemplate,
    vkPostTemplate: overwriteTemplates || !project.vkPostTemplate ? preset.vkPostTemplate : project.vkPostTemplate,
    finalTgPostTemplate: overwriteTemplates || !project.finalTgPostTemplate ? preset.finalTgPostTemplate : project.finalTgPostTemplate,
    linksTemplate: overwriteTemplates || !project.linksTemplate ? preset.linksTemplate : project.linksTemplate,
    links: JSON.stringify(updatedLinks)
  };
}

/**
 * Propagates global preset to all projects sharing the same releaseType
 */
export async function applyPresetToAllProjectsOfType(
  releaseType: ReleaseType,
  allProjects: Project[],
  options: { overwriteLinks?: boolean; overwriteTemplates?: boolean } = {}
): Promise<{ updatedCount: number; updatedProjects: Project[] }> {
  const preset = await getReleasePreset(releaseType);
  const matchingProjects = allProjects.filter(p => (p.releaseType || 'VOICEOVER') === releaseType);
  const updatedProjects: Project[] = [];

  for (const proj of matchingProjects) {
    const updated = applyPresetToProject(proj, preset, options);
    try {
      await ipcSafe.invoke('save-project', updated);
      updatedProjects.push(updated);
    } catch (e) {
      console.error(`Failed to update project ${proj.id} (${proj.title}):`, e);
    }
  }

  return {
    updatedCount: updatedProjects.length,
    updatedProjects
  };
}

/**
 * Injects global preset defaults into a newly created project
 */
export function initNewProjectWithPreset(projectData: any): any {
  const relType: ReleaseType = projectData.releaseType || 'VOICEOVER';
  const preset = getReleasePresetSync(relType);

  let initialLinks: any = {};
  try {
    if (projectData.links) {
      initialLinks = typeof projectData.links === 'string' ? JSON.parse(projectData.links) : projectData.links;
    }
  } catch {
    initialLinks = {};
  }

  const mergedLinks = {
    ...preset.defaultPlatformLinks,
    ...initialLinks,
    quickUploadLinks: preset.quickUploadLinks
  };

  return {
    ...projectData,
    tgPostTemplate: projectData.tgPostTemplate || preset.tgPostTemplate,
    tgArticleTemplate: projectData.tgArticleTemplate || preset.tgArticleTemplate,
    vkPostTemplate: projectData.vkPostTemplate || preset.vkPostTemplate,
    finalTgPostTemplate: projectData.finalTgPostTemplate || preset.finalTgPostTemplate,
    linksTemplate: projectData.linksTemplate || preset.linksTemplate,
    links: JSON.stringify(mergedLinks)
  };
}
