import { ipcSafe } from './ipcSafe';

export interface MkvTrackInfo {
  index: number;
  codec_type: 'video' | 'audio' | 'subtitle';
  codec_name?: string;
  tags?: {
    title?: string;
    language?: string;
    [key: string]: any;
  };
  disposition?: {
    default?: number;
    forced?: number;
    hearing_impaired?: number;
    [key: string]: any;
  };
}

export interface ExtractedSubtitleItem {
  id: string;
  path: string;
  name: string;
  lineCount: number;
  actors: string[];
  sourceType: 'mkv';
  trackTitle: string;
  streamIndex: number;
  language?: string;
  codec?: string;
}

/**
 * Format language code to human-readable label
 */
export function formatLanguageLabel(langCode?: string): string {
  if (!langCode) return '';
  const code = langCode.toLowerCase().trim();
  const map: Record<string, string> = {
    rus: 'Русский',
    ru: 'Русский',
    eng: 'English',
    en: 'English',
    jpn: '日本語 (Jpn)',
    ja: '日本語 (Jpn)',
    kor: '한국어 (Kor)',
    ko: '한국어 (Kor)',
    zho: '中文 (Chi)',
    zh: '中文 (Chi)',
    chi: '中文 (Chi)',
    ukr: 'Українська',
    uk: 'Українська',
    fre: 'Français',
    fra: 'Français',
    fr: 'Français',
    ger: 'Deutsch',
    deu: 'Deutsch',
    de: 'Deutsch',
    spa: 'Español',
    es: 'Español',
    ita: 'Italiano',
    it: 'Italiano',
    por: 'Português',
    pt: 'Português'
  };
  return map[code] || langCode.toUpperCase();
}

/**
 * Format track full title with badges
 */
export function formatTrackDisplayName(track: MkvTrackInfo, prefix: string = 'Дорожка'): string {
  const parts: string[] = [];
  const title = track.tags?.title?.trim();
  const lang = formatLanguageLabel(track.tags?.language);

  if (title) parts.push(title);
  if (lang && !title?.toLowerCase().includes(lang.toLowerCase())) {
    parts.push(`[${lang}]`);
  }
  if (!title && !lang) {
    parts.push(`${prefix} #${track.index}`);
  }
  if (track.codec_name) {
    parts.push(`(${track.codec_name.toUpperCase()})`);
  }
  if (track.disposition?.default) {
    parts.push('★ По умолч.');
  }
  if (track.disposition?.forced) {
    parts.push('⚡ Форсированные');
  }

  return parts.join(' ');
}

/**
 * Inspect video file metadata and group streams
 */
export async function inspectMkvTracks(videoPath: string): Promise<{
  subtitles: MkvTrackInfo[];
  audios: MkvTrackInfo[];
  videos: MkvTrackInfo[];
}> {
  try {
    const metadataRes = await ipcSafe.invoke('get-video-metadata', videoPath);
    if (!metadataRes || !metadataRes.streams || !Array.isArray(metadataRes.streams)) {
      return { subtitles: [], audios: [], videos: [] };
    }

    const subtitles: MkvTrackInfo[] = metadataRes.streams.filter((s: any) => s.codec_type === 'subtitle');
    const audios: MkvTrackInfo[] = metadataRes.streams.filter((s: any) => s.codec_type === 'audio');
    const videos: MkvTrackInfo[] = metadataRes.streams.filter((s: any) => s.codec_type === 'video');

    return { subtitles, audios, videos };
  } catch (err) {
    console.error('Failed to inspect MKV metadata:', err);
    return { subtitles: [], audios: [], videos: [] };
  }
}

/**
 * Extract a single subtitle track and get lines / actors stats
 */
export async function extractSingleSubtitleTrack(
  videoPath: string,
  track: MkvTrackInfo
): Promise<ExtractedSubtitleItem | null> {
  const videoFileName = videoPath.split(/[\\/]/).pop() || 'video.mkv';
  const trackLabel = formatTrackDisplayName(track, 'Саб');
  const tempFileName = `extracted_sub_stream${track.index}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.ass`;
  const tempOutputPath = videoPath.replace(/\.[^/.]+$/, `_${tempFileName}`);

  try {
    const res = await ipcSafe.invoke('extract-subtitle-track', {
      videoPath,
      outputPath: tempOutputPath,
      streamIndex: track.index
    });

    if (!res || !res.path) {
      throw new Error(`Failed to extract stream ${track.index}`);
    }

    const raw = await ipcSafe.invoke('get-raw-subtitles', res.path);
    const lineCount = raw?.lines?.length || 0;
    const actors = raw?.actors || [];

    return {
      id: `mkv-sub-${track.index}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      path: res.path,
      name: `${videoFileName} — ${trackLabel}`,
      lineCount,
      actors,
      sourceType: 'mkv',
      trackTitle: trackLabel,
      streamIndex: track.index,
      language: track.tags?.language,
      codec: track.codec_name
    };
  } catch (err) {
    console.error(`Error extracting subtitle track #${track.index}:`, err);
    return null;
  }
}

/**
 * Extract multiple subtitle tracks in sequence
 */
export async function extractSelectedMkvTracks(
  videoPath: string,
  tracks: MkvTrackInfo[],
  onProgress?: (current: number, total: number, track: MkvTrackInfo) => void
): Promise<ExtractedSubtitleItem[]> {
  const results: ExtractedSubtitleItem[] = [];

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    if (onProgress) {
      onProgress(i + 1, tracks.length, track);
    }
    const item = await extractSingleSubtitleTrack(videoPath, track);
    if (item) {
      results.push(item);
    }
  }

  return results;
}
