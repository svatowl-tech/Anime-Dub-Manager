import { ReleaseType, Project, QuickUploadLink, ReleaseTypePreset, ProjectLinks, ReleaseTemplateType } from '../types';
import { ipcSafe } from './ipcSafe';
import { appLogger } from './appLogger';
import { safeJsonParse, ReleaseTypePresetSchema, ProjectLinksSchema } from './validationSchemas';
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

export type { QuickUploadLink, ReleaseTypePreset, ReleaseTemplateType };

export const DEFAULT_QUICK_UPLOAD_LINKS: QuickUploadLink[] = [
  { name: 'TG Загрузка', title: 'TG Загрузка', url: 'https://t.me/akaneproject' },
  { name: 'Kodik Конвертер', title: 'Kodik Конвертер', url: 'https://converter.kodikres.com/' },
  { name: 'VK Кабинет', title: 'VK Кабинет', url: 'https://cabinet.vkvideo.ru/dashboard/@club216521493?filterPreset=published&section=video_my_content&subsection=video_my_content_videos' },
  { name: 'Anime365', title: 'Anime365', url: 'https://smotret-anime.com/translations/create' },
  { name: 'VK Паблик', title: 'VK Паблик', url: 'https://vk.com/okaneproject' }
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
    quickUploadLinks: DEFAULT_QUICK_UPLOAD_LINKS.map(l => ({ ...l })),
    defaultPlatformLinks: {
      tg: '',
      vk: '',
      anime365: '',
      shikimori: '',
      kodik: ''
    }
  };
}

function mergePresetWithDefaults(
  rawPreset: Partial<ReleaseTypePreset> | null | undefined,
  defaultPreset: ReleaseTypePreset,
  context: string
): ReleaseTypePreset {
  if (!rawPreset || typeof rawPreset !== 'object') {
    return defaultPreset;
  }

  const candidate: ReleaseTypePreset = {
    ...defaultPreset,
    ...rawPreset,
    quickUploadLinks:
      Array.isArray(rawPreset.quickUploadLinks) && rawPreset.quickUploadLinks.length > 0
        ? rawPreset.quickUploadLinks.map(l => ({
            ...(l.id ? { id: l.id } : {}),
            name: l.name || l.title || 'Ссылка',
            title: l.title || l.name || 'Ссылка',
            url: l.url || ''
          })).filter(l => Boolean(l.url))
        : defaultPreset.quickUploadLinks,
    defaultPlatformLinks: {
      ...defaultPreset.defaultPlatformLinks,
      ...(rawPreset.defaultPlatformLinks || {})
    }
  };

  return safeJsonParse<ReleaseTypePreset>(
    candidate,
    defaultPreset,
    context,
    ReleaseTypePresetSchema
  );
}

/**
 * Synchronous get for instant rendering from localStorage cache with fallback
 */
export function getReleasePresetSync(releaseType: ReleaseType): ReleaseTypePreset {
  const defaultPreset = getDefaultPresetForType(releaseType);
  if (typeof localStorage === 'undefined') {
    return defaultPreset;
  }

  const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${releaseType}`);
  if (!raw) {
    return defaultPreset;
  }

  const parsed = safeJsonParse<Partial<ReleaseTypePreset> | null>(
    raw,
    null,
    `getReleasePresetSync(${releaseType})`
  );
  return mergePresetWithDefaults(parsed, defaultPreset, `getReleasePresetSync:schema(${releaseType})`);
}

/**
 * Loads preset from atomic Electron backend handler or localStorage fallback
 */
export async function getReleasePreset(releaseType: ReleaseType): Promise<ReleaseTypePreset> {
  const defaultPreset = getDefaultPresetForType(releaseType);
  try {
    const presetsMap = await ipcSafe.invoke('get-release-presets').catch(async () => {
      const config = await ipcSafe.invoke('get-config');
      return config?.releasePresets || {};
    });

    if (presetsMap && typeof presetsMap === 'object' && presetsMap[releaseType]) {
      const merged = mergePresetWithDefaults(
        presetsMap[releaseType],
        defaultPreset,
        `getReleasePreset(${releaseType})`
      );
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(`${STORAGE_KEY_PREFIX}${releaseType}`, JSON.stringify(merged));
        } catch (storageErr: unknown) {
          appLogger.warn(
            'VALIDATION',
            `Could not sync release preset to localStorage (${releaseType}): ${storageErr instanceof Error ? storageErr.message : String(storageErr)}`
          );
        }
      }
      return merged;
    }
  } catch (e: unknown) {
    appLogger.warn(
      'VALIDATION',
      `Falling back to localStorage preset for ${releaseType}: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  return getReleasePresetSync(releaseType);
}

/**
 * Saves preset both to localStorage and Electron app config atomically
 */
export async function saveReleasePreset(preset: ReleaseTypePreset): Promise<void> {
  if (!preset || !preset.releaseType) return;
  const relType = preset.releaseType;
  const defaultPreset = getDefaultPresetForType(relType);
  const validatedPreset = mergePresetWithDefaults(preset, defaultPreset, `saveReleasePreset(${relType})`);

  // 1. Save to localStorage immediately
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${relType}`, JSON.stringify(validatedPreset));
    } catch (e: unknown) {
      appLogger.warn(
        'VALIDATION',
        `Error saving preset to localStorage (${relType}): ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  // 2. Save atomically on backend (with fallback to save-config if needed)
  try {
    await ipcSafe.invoke('save-release-preset', {
      releaseType: relType,
      preset: validatedPreset
    });
  } catch {
    try {
      const config = (await ipcSafe.invoke('get-config')) || {};
      const releasePresets = { ...(config.releasePresets || {}), [relType]: validatedPreset };
      await ipcSafe.invoke('save-config', { releasePresets });
    } catch (e: unknown) {
      appLogger.warn(
        'VALIDATION',
        `Error saving preset to backend config (${relType}): ${e instanceof Error ? e.message : String(e)}`
      );
    }
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

  const projectLinks = project.links
    ? safeJsonParse<ProjectLinks>(project.links, {}, `applyPresetToProject(${project.id})`, ProjectLinksSchema)
    : {};

  const updatedLinks: ProjectLinks = {
    ...preset.defaultPlatformLinks,
    ...(overwriteLinks ? {} : projectLinks),
    quickUploadLinks: preset.quickUploadLinks
  };

  return {
    ...project,
    defaultTemplateType:
      overwriteTemplates || !project.defaultTemplateType
        ? preset.defaultTemplateType
        : project.defaultTemplateType,
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
    } catch (e: unknown) {
      appLogger.warn(
        'VALIDATION',
        `Failed to update project ${proj.id} (${proj.title}): ${e instanceof Error ? e.message : String(e)}`
      );
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
export function initNewProjectWithPreset<T extends Partial<Project>>(projectData: T): T & {
  defaultTemplateType: ReleaseTemplateType;
  tgPostTemplate: string;
  tgArticleTemplate: string;
  vkPostTemplate: string;
  finalTgPostTemplate: string;
  linksTemplate: string;
  links: string;
} {
  const relType: ReleaseType = projectData.releaseType || 'VOICEOVER';
  const preset = getReleasePresetSync(relType);

  const initialLinks = projectData.links
    ? safeJsonParse<ProjectLinks>(projectData.links, {}, 'initNewProjectWithPreset', ProjectLinksSchema)
    : {};

  const mergedLinks: ProjectLinks = {
    ...preset.defaultPlatformLinks,
    ...initialLinks,
    quickUploadLinks: preset.quickUploadLinks
  };

  return {
    ...projectData,
    defaultTemplateType: projectData.defaultTemplateType || preset.defaultTemplateType || 'TG',
    tgPostTemplate: projectData.tgPostTemplate || preset.tgPostTemplate,
    tgArticleTemplate: projectData.tgArticleTemplate || preset.tgArticleTemplate,
    vkPostTemplate: projectData.vkPostTemplate || preset.vkPostTemplate,
    finalTgPostTemplate: projectData.finalTgPostTemplate || preset.finalTgPostTemplate,
    linksTemplate: projectData.linksTemplate || preset.linksTemplate,
    links: JSON.stringify(mergedLinks)
  };
}
