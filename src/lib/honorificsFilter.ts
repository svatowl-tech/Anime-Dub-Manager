/**
 * Japanese Honorifics Filtering Utility for Subtitles
 * 
 * Cleans Japanese honorific suffixes and address forms (кун, тян, сан, сама, сэнсэй, сэмпай, etc.)
 * from subtitle lines while preserving ASS styling tags and line breaks.
 */

export interface HonorificsOptions {
  removeSuffixes?: boolean;   // e.g., -кун, -тян, -сан, -сама
  removeSpaced?: boolean;     // e.g., Танака кун -> Танака
  removeStandalone?: boolean; // e.g., Сэнсэй, помогите! -> Помогите!
  removeRelatives?: boolean;  // e.g., -они-чан, -оне-сан, -нии-сан
  removeLatin?: boolean;      // e.g., -kun, -chan, -san, -sama, -sensei
}

export const DEFAULT_HONORIFICS_OPTIONS: HonorificsOptions = {
  removeSuffixes: true,
  removeSpaced: true,
  removeStandalone: true,
  removeRelatives: true,
  removeLatin: true,
};

const SUFFIXES_CYRILLIC_PATTERN = 'кун|куна|куну|куном|куне|куны|кунов|тян|тянки|тянку|тянке|тянкой|тяночка|тяночке|тяночку|сан|сана|сану|саном|сане|сама|самы|саме|саму|самой|сенсей|сенсея|сенсею|сенсеем|сенсее|сенсеи|сэнсэй|сэнсэя|сэнсэю|сэнсэем|сэнсэе|сэнсэи|семпай|семпая|семпаю|семпаем|семпае|семпаи|сэмпай|сэмпая|сэмпаю|сэмпаем|сэмпае|сэмпаи|доно|дону|доном|доне|тан|чи|ти|тяма|кохай|аники';
const SUFFIXES_LATIN_PATTERN = 'kun|chan|san|sama|sensei|senpai|dono|tan|chi|chama|kohai|aniki';

const RELATIVES_CYRILLIC_PATTERN = 'они-сан|они-чан|оне-сан|оне-сама|ни-сан|нии-сан|нии-чама';
const RELATIVES_LATIN_PATTERN = 'oni-san|oni-chan|one-san|one-sama|nii-san|nii-chama';

const STANDALONE_CYRILLIC_PATTERN = 'сэнсэй|сенсей|сэмпай|семпай|они-сан|они-чан|оне-сан|оне-сама|ни-сан|нии-сан';
const STANDALONE_LATIN_PATTERN = 'sensei|senpai';

const RU_BOUND = '(?![а-яА-ЯёЁ])';

/**
 * Filter honorifics from a single text segment (without ASS tags)
 */
function cleanSegmentText(segment: string, opts: HonorificsOptions): string {
  if (!segment) return segment;

  let text = segment;
  const wasCapitalizedAtStart = /^[А-ЯA-Z]/.test(text.trim());

  // 1. Remove Relatives with hyphen (e.g. Наруто-они-чан -> Наруто)
  if (opts.removeRelatives !== false) {
    const relCyr = new RegExp(`(-+)(${RELATIVES_CYRILLIC_PATTERN})${RU_BOUND}`, 'gi');
    text = text.replace(relCyr, '');

    if (opts.removeLatin !== false) {
      const relLat = new RegExp(`(-+)(${RELATIVES_LATIN_PATTERN})\\b`, 'gi');
      text = text.replace(relLat, '');
    }
  }

  // 2. Remove Hyphenated Suffixes (e.g. Наруто-кун -> Наруто, Сакура-тян -> Сакура)
  if (opts.removeSuffixes !== false) {
    const sufCyr = new RegExp(`(-+)(${SUFFIXES_CYRILLIC_PATTERN})${RU_BOUND}`, 'gi');
    text = text.replace(sufCyr, '');

    if (opts.removeLatin !== false) {
      const sufLat = new RegExp(`(-+)(${SUFFIXES_LATIN_PATTERN})\\b`, 'gi');
      text = text.replace(sufLat, '');
    }
  }

  // 3. Remove Spaced Suffixes after capitalized Name (e.g. Танака кун -> Танака, Какаши сенсей -> Какаши)
  if (opts.removeSpaced !== false) {
    const spcCyr = new RegExp(`(?<=[А-ЯA-Z][а-яa-z]*)\\s+(${SUFFIXES_CYRILLIC_PATTERN})${RU_BOUND}`, 'g');
    text = text.replace(spcCyr, '');

    if (opts.removeLatin !== false) {
      const spcLat = new RegExp(`(?<=[A-Z][a-z]*)\\s+(${SUFFIXES_LATIN_PATTERN})\\b`, 'g');
      text = text.replace(spcLat, '');
    }
  }

  // 4. Remove Standalone Address Forms (e.g. "Сэнсэй, помогите!" -> "Помогите!", "Привет, сэмпай!" -> "Привет!")
  if (opts.removeStandalone !== false) {
    // Standalone at start of sentence: "Сэнсэй, " or "Сенсей! "
    const standStart = new RegExp(`^(\\s*)(${STANDALONE_CYRILLIC_PATTERN}${opts.removeLatin !== false ? `|${STANDALONE_LATIN_PATTERN}` : ''})([\\s,!?.-]+)`, 'gi');
    text = text.replace(standStart, '$1');

    // Standalone in middle / end: ", сэнсэй!" or " сэнсэй."
    const standEnd = new RegExp(`([\\s,!?.-]+)(${STANDALONE_CYRILLIC_PATTERN}${opts.removeLatin !== false ? `|${STANDALONE_LATIN_PATTERN}` : ''})${RU_BOUND}`, 'gi');
    text = text.replace(standEnd, (match, p1) => {
      const leadingPunct = (p1 || '').replace(/\s+/g, '');
      if (/[!?.]/.test(leadingPunct)) return leadingPunct;
      return '';
    });
  }

  // 5. Cleanup residual punctuation and spacing
  text = text
    .replace(/\s+,/g, ',')
    .replace(/\s+\./g, '.')
    .replace(/\s+\!/g, '!')
    .replace(/\s+\?/g, '?')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*\./g, '.')
    .replace(/,\s*\!/g, '!')
    .replace(/,\s*\?/g, '?')
    .replace(/^\s*[,.-]+\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Re-capitalize start of sentence if original was capitalized and it was stripped down to a lowercase word
  if (wasCapitalizedAtStart && text.length > 0 && /^[а-яa-z]/.test(text)) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  return text;
}

/**
 * Filter honorifics from a full ASS subtitle line text (preserving ASS tags like {\an8} and \N linebreaks)
 */
export function filterHonorificsFromAssText(assText: string, options: HonorificsOptions = DEFAULT_HONORIFICS_OPTIONS): { cleanedText: string; modified: boolean } {
  if (!assText) return { cleanedText: assText, modified: false };

  const tokenRegex = /(\{[^}]+\}|\\N|\\n)/g;
  const parts = assText.split(tokenRegex);

  let isModified = false;
  const processedParts = parts.map(part => {
    if (!part || part.startsWith('{') || part === '\\N' || part === '\\n') {
      return part;
    }

    const cleaned = cleanSegmentText(part, options);
    if (cleaned !== part) {
      isModified = true;
    }
    return cleaned;
  });

  const finalResult = processedParts.join('');
  return {
    cleanedText: finalResult,
    modified: isModified || finalResult !== assText
  };
}

/**
 * Bulk filter honorifics for an array of subtitle lines
 */
export function bulkFilterHonorifics(
  lines: Array<{ id?: string | number; rawLineIndex?: number; text?: string; [key: string]: any }>,
  options: HonorificsOptions = DEFAULT_HONORIFICS_OPTIONS
): {
  updatedLines: Array<any>;
  changedCount: number;
} {
  let changedCount = 0;
  const updatedLines = lines.map(line => {
    const { cleanedText, modified } = filterHonorificsFromAssText(line.text || '', options);
    if (modified) {
      changedCount++;
      return {
        ...line,
        text: cleanedText
      };
    }
    return line;
  });

  return {
    updatedLines,
    changedCount
  };
}
