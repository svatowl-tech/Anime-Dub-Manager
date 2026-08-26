import { CoverSettings, DEFAULT_COVER_SETTINGS } from './coverTypes';
import { Project } from '../../types';
import { ipcSafe } from '../ipcSafe';

export const fileToDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
};

export const loadImageFromDataUrl = (dataUrl: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = dataUrl;
  });
};

export const parseCoverSettings = (
  rawSettings: string | undefined
): { settings: CoverSettings; loadedTitle?: string } => {
  if (!rawSettings) {
    return { settings: { ...DEFAULT_COVER_SETTINGS } };
  }

  try {
    const s = JSON.parse(rawSettings);
    const settings: CoverSettings = {
      fontFamily: s.fontFamily || DEFAULT_COVER_SETTINGS.fontFamily,
      titleSize: s.titleSize !== undefined ? Number(s.titleSize) : DEFAULT_COVER_SETTINGS.titleSize,
      episodeSize: s.episodeSize !== undefined ? Number(s.episodeSize) : DEFAULT_COVER_SETTINGS.episodeSize,
      titleColor: s.titleColor || DEFAULT_COVER_SETTINGS.titleColor,
      episodeColor: s.episodeColor || DEFAULT_COVER_SETTINGS.episodeColor,
      fontBold: s.fontBold !== undefined ? Boolean(s.fontBold) : DEFAULT_COVER_SETTINGS.fontBold,
      fontItalic: s.fontItalic !== undefined ? Boolean(s.fontItalic) : DEFAULT_COVER_SETTINGS.fontItalic,
      textTransform: s.textTransform || DEFAULT_COVER_SETTINGS.textTransform,
      cutTopXPercent: s.cutTopXPercent !== undefined ? Number(s.cutTopXPercent) : DEFAULT_COVER_SETTINGS.cutTopXPercent,
      cutBottomXPercent: s.cutBottomXPercent !== undefined ? Number(s.cutBottomXPercent) : DEFAULT_COVER_SETTINGS.cutBottomXPercent,
      cutColor: s.cutColor || DEFAULT_COVER_SETTINGS.cutColor,
      cutOpacity: s.cutOpacity !== undefined ? Number(s.cutOpacity) : DEFAULT_COVER_SETTINGS.cutOpacity,
      dividerStyle: s.dividerStyle || DEFAULT_COVER_SETTINGS.dividerStyle,
      dividerColor: s.dividerColor || DEFAULT_COVER_SETTINGS.dividerColor,
      strokeEnabled: s.strokeEnabled !== undefined ? Boolean(s.strokeEnabled) : DEFAULT_COVER_SETTINGS.strokeEnabled,
      strokeColor: s.strokeColor || DEFAULT_COVER_SETTINGS.strokeColor,
      strokeWidth: s.strokeWidth !== undefined ? Number(s.strokeWidth) : DEFAULT_COVER_SETTINGS.strokeWidth,
      shadowColor: s.shadowColor || DEFAULT_COVER_SETTINGS.shadowColor,
      shadowBlur: s.shadowBlur !== undefined ? Number(s.shadowBlur) : DEFAULT_COVER_SETTINGS.shadowBlur,
      shadowOffsetX: s.shadowOffsetX !== undefined ? Number(s.shadowOffsetX) : DEFAULT_COVER_SETTINGS.shadowOffsetX,
      shadowOffsetY: s.shadowOffsetY !== undefined ? Number(s.shadowOffsetY) : DEFAULT_COVER_SETTINGS.shadowOffsetY,
      logoX: s.logoX !== undefined ? Number(s.logoX) : DEFAULT_COVER_SETTINGS.logoX,
      logoY: s.logoY !== undefined ? Number(s.logoY) : DEFAULT_COVER_SETTINGS.logoY,
      logoWidth: s.logoWidth !== undefined ? Number(s.logoWidth) : DEFAULT_COVER_SETTINGS.logoWidth,
      logoRotation: s.logoRotation !== undefined ? Number(s.logoRotation) : DEFAULT_COVER_SETTINGS.logoRotation,
      textX: s.textX !== undefined ? Number(s.textX) : DEFAULT_COVER_SETTINGS.textX,
      textY: s.textY !== undefined ? Number(s.textY) : DEFAULT_COVER_SETTINGS.textY,
      lineSpacing: s.lineSpacing !== undefined ? Number(s.lineSpacing) : DEFAULT_COVER_SETTINGS.lineSpacing,
      savedCustomTitle: s.savedCustomTitle,
      customTitleLogoData: s.customTitleLogoData || null,
      hideTitleWhenLogoPresent: s.hideTitleWhenLogoPresent !== undefined ? Boolean(s.hideTitleWhenLogoPresent) : true,
    };
    return { settings, loadedTitle: s.savedCustomTitle };
  } catch (e) {
    console.error('Failed to parse coverSettings', e);
    return { settings: { ...DEFAULT_COVER_SETTINGS } };
  }
};

export const saveProjectCoverSettings = async (
  project: Project,
  settings: CoverSettings,
  currentTitle: string
): Promise<Project> => {
  const fullSettings: CoverSettings = {
    ...settings,
    savedCustomTitle: currentTitle,
  };

  const updatedProject: Project = {
    ...project,
    coverSettings: JSON.stringify(fullSettings),
  };

  await ipcSafe.invoke('save-project', updatedProject);
  return updatedProject;
};

export const getSavedWatermark = (): string | null => {
  try {
    return localStorage.getItem('anime_dub_watermark');
  } catch {
    return null;
  }
};

export const saveWatermark = (dataUrl: string): void => {
  try {
    localStorage.setItem('anime_dub_watermark', dataUrl);
  } catch (err) {
    console.warn('Could not save watermark to localStorage', err);
  }
};

export const removeSavedWatermark = (): void => {
  try {
    localStorage.removeItem('anime_dub_watermark');
  } catch (err) {
    console.warn('Could not remove watermark from localStorage', err);
  }
};
