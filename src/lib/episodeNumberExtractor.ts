/**
 * Utility to accurately extract anime/series episode number from filename or release title.
 * - Handles anime release formats (SubsPlease, Erai-raws, AniLibria, AnimeVost, etc.)
 * - Strips video specs (2160p, 1080p, 720p), codecs (x264, x265), bit-depths (10bit), years, and hashes.
 * - Prevents digits in project titles (e.g. "Киберпанк: бегушие по краю 2", "Mob Psycho 100", "86", "Re:Zero 2")
 *   from falsely overriding episode numbers.
 * - Supports project title contextual stripping as well as autonomous prioritized pattern matching.
 */

export function extractEpisodeNumber(
  fileNameOrTitle: string,
  projectTitleOrTitles?: string | string[] | number,
  fallbackNumber?: number
): number {
  if (!fileNameOrTitle || typeof fileNameOrTitle !== 'string') {
    const fb = typeof projectTitleOrTitles === 'number' ? projectTitleOrTitles : fallbackNumber;
    return fb !== undefined && fb > 0 ? fb : 1;
  }

  let projTitles: string[] = [];
  let fb = fallbackNumber;
  if (typeof projectTitleOrTitles === 'number') {
    fb = projectTitleOrTitles;
  } else if (typeof projectTitleOrTitles === 'string') {
    projTitles = [projectTitleOrTitles];
  } else if (Array.isArray(projectTitleOrTitles)) {
    projTitles = projectTitleOrTitles.filter(t => typeof t === 'string' && t.trim().length > 0);
  }

  // 1. Strip path and file extension
  let clean = fileNameOrTitle.split(/[/\\]/).pop() || fileNameOrTitle;
  clean = clean.replace(/\.[a-zA-Z0-9]{2,5}$/, '');

  // 2. Strip leading release group tag (e.g., [SubsPlease], [Erai-raws], [AniLibria], (Group))
  clean = clean.replace(/^\[[^\]]+\]\s*/, '').replace(/^\([^)]+\)\s*/, '');

  // 3. Strip CRC32 hash tags (e.g. [A1B2C3D4], [12345678])
  clean = clean.replace(/\[[0-9a-fA-F]{8}\]/g, ' ');

  // 4. Strip video resolutions to prevent false matching (e.g. 2160p, 1080p, 720p, 480p, 4k, 8k)
  clean = clean.replace(/\b(?:2160p|1080p|720p|480p|360p|4k|8k|uhd|fhd|hd)\b/gi, ' ');

  // 5. Strip codecs, audio formats, and bit-depths (e.g. x264, x265, hevc, 10bit, flac, ddp5.1)
  clean = clean.replace(/\b(?:x264|x265|h264|h265|hevc|avc|av1|vp9|10bit|8bit|hi10p|aac\d?|flac\d?|mp3|opus|ac3|eac3|dts(?:-hd)?|truehd|ddp?5\.1|5\.1ch|2\.0ch|stereo)\b/gi, ' ');

  // 6. Strip release type tags
  clean = clean.replace(/\b(?:WEBRip|WEB-DL|BDRip|BD-Rip|BluRay|HDTV|DVDRip|DVD|Remux)\b/gi, ' ');

  // 7. Strip common year tags (e.g. (2020), (2024), [2026], or standalone 2024)
  clean = clean.replace(/[\(\[]\s*(?:19|20)\d{2}\s*[\)\]]/g, ' ');
  clean = clean.replace(/\b(?:19|20)\d{2}\b/g, ' ');

  // 8. If projectTitle(s) are supplied, strip them and their words to avoid title digits conflicting
  for (const pt of projTitles) {
    if (!pt || !pt.trim()) continue;
    const esc = pt.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clean = clean.replace(new RegExp('(?:^|[\\s._\\[(-])' + esc + '(?:[\\s._\\])-]|$)', 'i'), ' ');

    // Also strip sequence of major words from project title without punctuation
    const words = pt.trim().split(/[^a-zA-Zа-яА-Я0-9]+/i).filter(w => w.length > 1);
    if (words.length > 0) {
      const phrase = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s._:-]+');
      clean = clean.replace(new RegExp(phrase, 'i'), ' ');
    }
  }

  // 9. Strip season phrases (e.g., "Season 2", "2nd Season", "Сезон 2", "2 сезон", "Part 2", "Cour 2")
  clean = clean.replace(/\b(?:season\s*\d{1,2}|\d{1,2}(?:st|nd|rd|th)\s*season|сезон\s*\d{1,2}|\d{1,2}\s*сезон|part\s*\d{1,2}|часть\s*\d{1,2}|cour\s*\d{1,2})\b/gi, ' ');

  // Pattern 1: Russian batch/episode indicator: [01 из 12], (01 из 24), [01-12 из 12], [01 of 12]
  const ruBatchMatch = clean.match(/\[?\b0*([1-9]\d{0,3})\s*(?:-|–|—)?\s*\d*\s*(?:из|of)\s*\d+\b/i);
  if (ruBatchMatch && ruBatchMatch[1]) {
    const num = parseInt(ruBatchMatch[1], 10);
    if (num > 0 && num < 2000) return num;
  }

  // Pattern 2: Explicit Season & Episode pattern (e.g., S01E05, S1E5, S2 - 04, 2x05, S01EP05)
  const seasonEpMatch = clean.match(/(?:s\d{1,2}[\s._-]*e|season\s*\d{1,2}[\s._-]*ep(?:isode)?\s*|\b\d{1,2}x)0*([1-9]\d{0,3})\b/i);
  if (seasonEpMatch && seasonEpMatch[1]) {
    const num = parseInt(seasonEpMatch[1], 10);
    if (num > 0 && num < 2000) return num;
  }

  // Pattern 3: Russian season + episode pattern (e.g. "2 сезон 5 серия")
  const ruSeasonEp = clean.match(/\d{1,2}\s*сезон[,\s._-]*0*([1-9]\d{0,3})\s*сери[яи]/i);
  if (ruSeasonEp && ruSeasonEp[1]) {
    const num = parseInt(ruSeasonEp[1], 10);
    if (num > 0 && num < 2000) return num;
  }

  // Pattern 4: Explicit Episode prefix (e.g., Ep 05, Episode 05, Ep. 05, Серия 5, Эпизод 5, Выпуск 5, #05)
  const epPrefixMatch = clean.match(/(?:ep(?:isode)?\.?|серия|эпизод|выпуск|\#)[\s._-]*0*([1-9]\d{0,3})\b/i);
  if (epPrefixMatch && epPrefixMatch[1]) {
    const num = parseInt(epPrefixMatch[1], 10);
    if (num > 0 && num < 2000) return num;
  }

  // Pattern 5: Standard anime release format with DASH delimiter: "Title 2 - 05 (1080p)" or "Title — 05"
  // Look for actual dash/hyphen separators (not bare whitespace between words) and pick the LAST dash match
  const dashMatches = Array.from(clean.matchAll(/(?:\s+[-–—_]+\s+|[-–—_]{2,}|\s+[-–—_]+|[-–—_]+\s+)0*([1-9]\d{0,3})(?:v\d+)?(?=[\s._\-\(\[]|$)/gi));
  if (dashMatches.length > 0) {
    const lastMatch = dashMatches[dashMatches.length - 1];
    const num = parseInt(lastMatch[1], 10);
    if (num > 0 && num < 2000) return num;
  }

  // Pattern 6: Standalone number enclosed in brackets (e.g. "[05]", "(05)")
  const bracketMatches = Array.from(clean.matchAll(/\[0*([1-9]\d{0,3})(?:v\d+)?\]|\(0*([1-9]\d{0,3})(?:v\d+)?\)/gi));
  if (bracketMatches.length > 0) {
    for (const bm of bracketMatches) {
      const val = bm[1] || bm[2];
      if (val) {
        const num = parseInt(val, 10);
        if (num > 0 && num < 2000) return num;
      }
    }
  }

  // Pattern 7: Trailing number at end of title (e.g. "Title_05", "Title 05")
  const endMatch = clean.match(/[\s._-]+0*([1-9]\d{0,3})(?:v\d+)?$/i);
  if (endMatch && endMatch[1]) {
    const num = parseInt(endMatch[1], 10);
    if (num > 0 && num < 2000) return num;
  }

  // Pattern 8: Standalone digits surrounded by delimiters (take the last candidate)
  const standaloneMatches = Array.from(clean.matchAll(/(?:^|[\s_\[\(\-])0*([1-9]\d{0,2})(?:v\d+)?(?:$|[\s_\]\)\-])/g));
  if (standaloneMatches.length > 0) {
    const last = standaloneMatches[standaloneMatches.length - 1];
    const num = parseInt(last[1], 10);
    if (num > 0 && num < 1000) return num;
  }

  return fb !== undefined && fb > 0 ? fb : 1;
}
