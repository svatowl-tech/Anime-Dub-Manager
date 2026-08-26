import { SubtitleLine } from '../../types';
import { TimingMatchStats } from '../../types/diarization';

export const SIGN_KEYWORDS = [
  'sign', 'text', 'title', 'signs', 'titles', 
  'надпись', 'текст', 'титр', 'титры', 'заставка', 
  'экран', 'перевод', 'примечание', 'note'
];

/**
 * Parses timecode string or number into seconds
 */
export function parseTimeToSeconds(timeStr: string | number | undefined): number {
  if (timeStr === undefined || timeStr === null) return 0;
  if (typeof timeStr === 'number') return isNaN(timeStr) ? 0 : timeStr;
  
  const str = String(timeStr).trim();
  if (!str) return 0;

  const parts = str.split(':');
  if (parts.length < 3) {
    const floatVal = parseFloat(str.replace(',', '.'));
    return isNaN(floatVal) ? 0 : floatVal;
  }

  const hrs = parseFloat(parts[0]) || 0;
  const mins = parseFloat(parts[1]) || 0;
  const secs = parseFloat(parts[2].replace(',', '.')) || 0;

  return hrs * 3600 + mins * 60 + secs;
}

/**
 * Cleans text for comparison by removing ASS tags, escape sequences, and punctuation
 */
export function cleanTextForMatching(text: string | undefined): string {
  if (!text) return '';
  return text
    .replace(/\{[^}]+\}/g, '')
    .replace(/\\N/gi, ' ')
    .replace(/[^\w\s\u0400-\u04FF]/gi, '')
    .toLowerCase()
    .trim();
}

export interface TimingMatchOptions {
  preserveExistingNames?: boolean;
  ignoreSigns?: boolean;
  minOverlapSecs?: number;
}

/**
 * Matches target subtitles against reference subtitles by calculating timestamp overlap intervals
 */
export function matchSubtitlesByTiming(
  targetLines: SubtitleLine[],
  referenceLines: SubtitleLine[],
  options: TimingMatchOptions = {}
): { updatedLines: SubtitleLine[]; stats: TimingMatchStats } {
  const {
    preserveExistingNames = true,
    ignoreSigns = true,
    minOverlapSecs = 0.1
  } = options;

  let mappedCount = 0;
  let skippedCount = 0;
  const newCharactersSet = new Set<string>();

  const isSign = (name: string, style?: string) => {
    if (!ignoreSigns) return false;
    const nameLower = name.trim().toLowerCase();
    const styleLower = (style || '').toLowerCase();

    return SIGN_KEYWORDS.some(kw => {
      const regex = new RegExp(`(^|[^a-zа-яё0-9])(${kw})([^a-zа-яё0-9]|$)`, 'i');
      return regex.test(nameLower) || regex.test(styleLower);
    });
  };

  const updatedLines = targetLines.map((currentLine) => {
    // If name is already assigned and preservation is enabled, skip
    if (preserveExistingNames && currentLine.name && currentLine.name.trim() && currentLine.name !== 'Default') {
      skippedCount++;
      return currentLine;
    }

    const currentStart = parseTimeToSeconds(currentLine.startSec !== undefined ? currentLine.startSec : currentLine.start);
    const currentEnd = parseTimeToSeconds(currentLine.endSec !== undefined ? currentLine.endSec : currentLine.end);

    let maxOverlap = 0;
    let bestName = '';

    for (const refLine of referenceLines) {
      if (!refLine.name || !refLine.name.trim() || refLine.name === 'Default') continue;
      if (isSign(refLine.name, refLine.style)) continue;

      const refStart = parseTimeToSeconds(refLine.startSec !== undefined ? refLine.startSec : refLine.start);
      const refEnd = parseTimeToSeconds(refLine.endSec !== undefined ? refLine.endSec : refLine.end);

      const overlapStart = Math.max(currentStart, refStart);
      const overlapEnd = Math.min(currentEnd, refEnd);
      const overlapDuration = overlapEnd - overlapStart;

      if (overlapDuration > minOverlapSecs && overlapDuration > maxOverlap) {
        maxOverlap = overlapDuration;
        bestName = refLine.name.trim();
      }
    }

    if (bestName) {
      mappedCount++;
      newCharactersSet.add(bestName);
      return {
        ...currentLine,
        name: bestName
      };
    }

    return currentLine;
  });

  return {
    updatedLines,
    stats: {
      mapped: mappedCount,
      skipped: skippedCount,
      total: targetLines.length,
      newCharacters: Array.from(newCharactersSet)
    }
  };
}
