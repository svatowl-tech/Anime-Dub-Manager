import { ipcSafe } from './ipcSafe';

export type SubtitleSplitStatus = 'full' | 'partial' | 'none';

export interface SubtitleCharacterAnalysis {
  splitStatus: SubtitleSplitStatus;
  statusLabel: string;
  totalLines: number;
  namedLines: number;
  unnamedLines: number;
  namedPercentage: number;
  characterCount: number;
  topCharacters: Array<{ name: string; count: number }>;
  allCharacters: string[];
  isRecommendedForDubbing?: boolean;
}

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
  characterAnalysis?: SubtitleCharacterAnalysis;
  isAnalyzingCharacters?: boolean;
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

/**
 * Visual metadata and styling helper for split status
 */
export function getSplitStatusDisplay(status?: SubtitleSplitStatus): {
  label: string;
  shortLabel: string;
  badgeClass: string;
  dotClass: string;
  iconType: 'full' | 'partial' | 'none';
  description: string;
} {
  switch (status) {
    case 'full':
      return {
        label: 'Разделены на персонажей',
        shortLabel: 'Разделены',
        badgeClass: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300',
        dotClass: 'bg-emerald-400',
        iconType: 'full',
        description: 'Субтитры полностью размечены по ролям для озвучки'
      };
    case 'partial':
      return {
        label: 'Частично разделены',
        shortLabel: 'Частично',
        badgeClass: 'bg-amber-500/15 border-amber-500/40 text-amber-300',
        dotClass: 'bg-amber-400',
        iconType: 'partial',
        description: 'Часть реплик с персонажами, часть без ролей'
      };
    case 'none':
    default:
      return {
        label: 'Вообще не разделены',
        shortLabel: 'Не разделены',
        badgeClass: 'bg-neutral-800/80 border-neutral-700 text-neutral-400',
        dotClass: 'bg-neutral-500',
        iconType: 'none',
        description: 'Все строки идут сплошным текстом без указания ролей'
      };
  }
}

/**
 * Client-side evaluation of character split from parsed lines
 */
export function evaluateCharacterSplit(
  lines: Array<{ name?: string; style?: string; text?: string }>,
  trackLang?: string,
  trackTitle?: string
): SubtitleCharacterAnalysis {
  const genericStyles = new Set([
    'default', 'main', 'standard', 'normal', 'dialogue', 'dialogues', 'alt', 'sub', 'subs',
    'sign', 'signs', 'title', 'titles', 'op', 'ed', 'lyrics', 'song', 'songs', 'note', 'notes',
    'italics', 'italic', 'flashback', 'credits', 'credit', 'typeset'
  ]);

  const signWords = new Set([
    'sign', 'signs', 'title', 'titles', 'op', 'ed', 'lyrics', 'song', 'songs',
    'надпись', 'надписи', 'титры', 'песня', 'караоке', 'лого', 'инфо', 'перевод', 'credits'
  ]);

  let totalDialogueLines = 0;
  let namedLines = 0;
  const characterCounts = new Map<string, number>();

  for (const line of lines) {
    const rawText = (line.text || '').replace(/\{[^}]+\}/g, '').trim();
    if (!rawText) continue;

    const rawName = (line.name || '').trim();
    const rawStyle = (line.style || '').trim();

    const isSign = signWords.has(rawName.toLowerCase()) || 
                   signWords.has(rawStyle.toLowerCase());

    if (isSign) continue;

    totalDialogueLines++;

    let characterName = '';
    if (rawName && !signWords.has(rawName.toLowerCase()) && !genericStyles.has(rawName.toLowerCase())) {
      characterName = rawName;
    } else if (rawStyle && !genericStyles.has(rawStyle.toLowerCase()) && !signWords.has(rawStyle.toLowerCase())) {
      characterName = rawStyle;
    }

    if (characterName) {
      namedLines++;
      const current = characterCounts.get(characterName) || 0;
      characterCounts.set(characterName, current + 1);
    }
  }

  const characterCount = characterCounts.size;
  const namedPercentage = totalDialogueLines > 0 ? Math.round((namedLines / totalDialogueLines) * 100) : 0;
  const unnamedLines = totalDialogueLines - namedLines;

  const sortedCharacters = Array.from(characterCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  const topCharacters = sortedCharacters.slice(0, 8).map(([name, count]) => ({ name, count }));
  const allCharacters = sortedCharacters.map(([name]) => name);

  let splitStatus: SubtitleSplitStatus = 'none';
  let statusLabel = 'Вообще не разделены';

  if (totalDialogueLines === 0) {
    splitStatus = 'none';
    statusLabel = 'Только надписи / Без диалогов';
  } else if ((namedPercentage >= 60 && characterCount >= 2) || (namedPercentage >= 50 && characterCount >= 3) || (namedPercentage >= 80 && characterCount >= 1)) {
    splitStatus = 'full';
    statusLabel = 'Разделены на персонажей';
  } else if (
    (namedPercentage >= 15 && namedPercentage < 60) ||
    (characterCount >= 1 && namedLines >= 3 && namedPercentage < 60) ||
    (characterCount === 1 && namedPercentage >= 35)
  ) {
    splitStatus = 'partial';
    statusLabel = 'Частично разделены';
  } else {
    splitStatus = 'none';
    statusLabel = 'Вообще не разделены';
  }

  return {
    splitStatus,
    statusLabel,
    totalLines: totalDialogueLines,
    namedLines,
    unnamedLines,
    namedPercentage,
    characterCount,
    topCharacters,
    allCharacters
  };
}

/**
 * Fast analyzer for all subtitle tracks in an MKV file
 */
export async function analyzeAllMkvSubtitleTracks(
  videoPath: string,
  tracks: MkvTrackInfo[],
  onTrackAnalyzed?: (trackIndex: number, analysis: SubtitleCharacterAnalysis) => void
): Promise<Record<number, SubtitleCharacterAnalysis>> {
  if (!videoPath || tracks.length === 0) return {};

  const streamIndices = tracks.map(t => t.index);
  let results: Record<number, SubtitleCharacterAnalysis> = {};

  try {
    const backendRes = await ipcSafe.invoke('analyze-mkv-subtitles', {
      videoPath,
      streamIndices
    });

    if (backendRes && typeof backendRes === 'object' && Object.keys(backendRes).length > 0) {
      results = backendRes;
      if (onTrackAnalyzed) {
        for (const [idxStr, analysis] of Object.entries(results)) {
          onTrackAnalyzed(Number(idxStr), analysis);
        }
      }
      return results;
    }
  } catch (err) {
    console.warn('[mkvSubtitleExtractor] Fast analyze-mkv-subtitles failed, falling back to track extraction:', err);
  }

  // Fallback: extract single tracks and evaluate client-side
  for (const track of tracks) {
    try {
      const singleItem = await extractSingleSubtitleTrack(videoPath, track);
      if (singleItem && singleItem.path) {
        const raw = await ipcSafe.invoke('get-raw-subtitles', singleItem.path);
        const analysis = evaluateCharacterSplit(raw?.lines || [], track.tags?.language, track.tags?.title);
        results[track.index] = analysis;
        if (onTrackAnalyzed) {
          onTrackAnalyzed(track.index, analysis);
        }
        try {
          await ipcSafe.invoke('delete-file', singleItem.path);
        } catch {}
      }
    } catch (e) {
      console.warn(`[mkvSubtitleExtractor] Failed fallback analysis for track #${track.index}:`, e);
    }
  }

  // Determine recommendation if not yet set
  let bestIdx = -1;
  let maxScore = -1;
  for (const [idxStr, analysis] of Object.entries(results)) {
    const idx = Number(idxStr);
    const track = tracks.find(t => t.index === idx);
    const lang = (track?.tags?.language || '').toLowerCase();
    const isRus = lang.includes('ru') || lang.includes('rus');
    if (analysis.splitStatus === 'full') {
      const score = (analysis.namedPercentage * 2) + analysis.characterCount + (isRus ? 50 : 0);
      if (score > maxScore) {
        maxScore = score;
        bestIdx = idx;
      }
    }
  }

  if (bestIdx !== -1 && results[bestIdx]) {
    results[bestIdx].isRecommendedForDubbing = true;
  }

  return results;
}
