/**
 * Utility to extract anime episode number from filename or release title.
 * Handles common anime release formats (SubsPlease, Erai-raws, HorribleSubs, AnimeTime, etc.)
 * while ignoring resolutions (1080p, 720p, 2160p), codecs (x264, x265, 10bit), years (2024, 2026), and hashes.
 */

export function extractEpisodeNumber(fileNameOrTitle: string, fallbackNumber?: number): number {
  if (!fileNameOrTitle || typeof fileNameOrTitle !== 'string') {
    return fallbackNumber !== undefined && fallbackNumber > 0 ? fallbackNumber : 1;
  }

  // Clean filename: remove extension and path
  let clean = fileNameOrTitle.split(/[/\\]/).pop() || fileNameOrTitle;
  clean = clean.replace(/\.[a-zA-Z0-9]{2,5}$/, '');

  // 1. Remove release group tag at start (e.g., [SubsPlease], [Erai-raws], [ASW])
  clean = clean.replace(/^\[[^\]]+\]\s*/, '');

  // 2. Remove video resolutions to prevent false matching (e.g. 1080p, 720p, 480p, 2160p, 4k)
  clean = clean.replace(/\b(2160p|1080p|720p|480p|360p|4k|8k)\b/gi, '');

  // 3. Remove codecs and bit-depths (e.g. x264, x265, h264, h265, hevc, av1, 10bit, 8bit, aac, flac, ddp5.1)
  clean = clean.replace(/\b(x264|x265|h264|h265|hevc|avc|av1|10bit|8bit|aac|flac|mp3|opus|dts|ddp?5\.1)\b/gi, '');

  // 4. Remove CRC32 hash tags (e.g. [A1B2C3D4], [12345678])
  clean = clean.replace(/\[[0-9a-fA-F]{8}\]/g, '');

  // 5. Remove common year tags (e.g. (2020), (2024), [2025], [2026])
  clean = clean.replace(/[\(\[]\s*(?:19|20)\d{2}\s*[\)\]]/g, '');

  // Pattern 1: Season & Episode pattern (e.g., S01E05, S1E5, S2 - 04, 2x05)
  const seasonEpMatch = clean.match(/(?:s\d{1,2}[\s._-]*e|season\s*\d{1,2}[\s._-]*ep(?:isode)?\s*|\b\d{1,2}x)0*([1-9]\d{0,3})\b/i);
  if (seasonEpMatch && seasonEpMatch[1]) {
    const num = parseInt(seasonEpMatch[1], 10);
    if (num > 0 && num < 2000) return num;
  }

  // Pattern 2: Explicit Episode prefix (e.g., Ep 05, Episode 05, Ep. 05, E05, #05, Серия 5)
  const epPrefixMatch = clean.match(/(?:ep(?:isode)?\.?|серия|\bE|\#)[\s._-]*0*([1-9]\d{0,3})\b/i);
  if (epPrefixMatch && epPrefixMatch[1]) {
    const num = parseInt(epPrefixMatch[1], 10);
    if (num > 0 && num < 2000) return num;
  }

  // Pattern 3: Standard anime release format: "Title - 05 (1080p)" or "Title - 05v2"
  const dashEpMatch = clean.match(/[\s._-]+0*([1-9]\d{0,3})(?:v\d+)?(?=[\s._\-\(\[]|$)/i);
  if (dashEpMatch && dashEpMatch[1]) {
    const num = parseInt(dashEpMatch[1], 10);
    if (num > 0 && num < 2000) return num;
  }

  // Pattern 4: Standalone number surrounded by brackets, spaces or underscores (e.g. "[05]", "_05_", " 05 ")
  const standaloneMatch = clean.match(/(?:^|[\s_\[\(\-])0*([1-9]\d{0,2})(?:v\d+)?(?:$|[\s_\]\)\-])/);
  if (standaloneMatch && standaloneMatch[1]) {
    const num = parseInt(standaloneMatch[1], 10);
    if (num > 0 && num < 1000) return num;
  }

  // Pattern 5: Simple start or end of string digits (e.g. "01.mkv", "Episode1")
  const simpleMatch = clean.match(/^0*([1-9]\d{0,2})$/);
  if (simpleMatch && simpleMatch[1]) {
    const num = parseInt(simpleMatch[1], 10);
    if (num > 0 && num < 1000) return num;
  }

  return fallbackNumber !== undefined && fallbackNumber > 0 ? fallbackNumber : 1;
}
