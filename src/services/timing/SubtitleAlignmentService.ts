import { SubtitleLine, RoleAssignment } from '../../types';
import { normalizeSpeechText } from '../../lib/qa/whisperTextChecker';

/**
 * Normalizes text for comparing names, roles, and character aliases.
 */
export function normalizeName(s: string): string {
  if (!s) return '';
  return s.toLowerCase().trim().replace(/[^a-z0-9а-яё]/gi, '');
}

/**
 * Strips technical suffixes like [Дорожка 1], _дорожка2, [фикс] so that
 * dubber nicknames are always canonical.
 */
export function cleanDubberNick(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '')
    .replace(/_дорожка\d+/gi, '')
    .replace(/\[(.*?)\]/g, (_m, inner) => {
      return inner.replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '').trim();
    })
    .replace(/[_\s-]+$/, '')
    .trim();
}

/**
 * Validates that candidate name is a legitimate person/character name,
 * filtering out numeric artifacts (e.g. "0 3 4", "03_4", "123", timestamps).
 */
export function isValidDubberName(name: string): boolean {
  if (!name) return false;
  const clean = cleanDubberNick(name);
  if (!clean) return false;
  if (!/[a-zA-Zа-яА-ЯёЁ]/.test(clean)) return false;
  if (/^[\d\s._-]+$/.test(clean)) return false;
  const lower = clean.toLowerCase();
  if (['default', 'original', 'оригинал', 'серия', 'видео', 'sound', 'audio', 'master', 'mix', 'comment', 'шумы'].includes(lower)) return false;
  return true;
}

/**
 * Calculates text similarity for Whisper speech vs. Subtitle text.
 * Word-level Dice coefficient with prefix/stem matching for Russian morphology.
 */
export function calculateTextSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0;
  const norm1 = normalizeSpeechText(text1);
  const norm2 = normalizeSpeechText(text2);
  if (!norm1 || !norm2) return 0;
  if (norm1 === norm2) return 1.0;
  if (norm1.includes(norm2) || norm2.includes(norm1)) return 0.9;

  const words1 = norm1.split(' ').filter(Boolean);
  const words2 = norm2.split(' ').filter(Boolean);
  if (words1.length === 0 || words2.length === 0) return 0;

  let common = 0;
  for (const w of words1) {
    if (words2.includes(w)) {
      common += 1.0;
    } else {
      const stem = w.slice(0, Math.min(5, w.length));
      if (stem.length >= 4 && words2.some(w2 => w2.startsWith(stem))) {
        common += 0.8;
      }
    }
  }
  const dice = (2 * common) / (words1.length + words2.length);
  return Math.min(1.0, Math.max(0, dice));
}

/**
 * Robust role-based subtitle line matching with alias expansion and style fallback.
 */
export function isSubtitleForCharacter(
  subName: string,
  charName: string,
  dubberNick: string,
  assignments: RoleAssignment[] = [],
  subStyle?: string,
  aliases?: Record<string, string>
): boolean {
  const candidates = [subName, subStyle].filter(Boolean) as string[];
  if (candidates.length === 0) return false;

  const normChar = normalizeName(charName);
  const normNick = normalizeName(dubberNick);

  const dubberAssigns = assignments.filter(a => {
    const aNick = normalizeName(a.substitute?.nickname || a.dubber?.nickname || (a as any).dubberNickname || '');
    const aId = a.substituteId || a.dubberId;
    return (aNick && (aNick === normNick || normNick.includes(aNick) || aNick.includes(normNick))) ||
           (aId && (aId === dubberNick || aId === normNick));
  });

  const assignedCharNames = dubberAssigns.map(a => normalizeName(a.characterName)).filter(Boolean);
  if (normChar && !assignedCharNames.includes(normChar)) assignedCharNames.push(normChar);

  // Add alias expansions if available
  if (aliases) {
    Object.entries(aliases).forEach(([orig, target]) => {
      const nOrig = normalizeName(orig);
      const nTarg = normalizeName(target);
      if (assignedCharNames.includes(nTarg) && nOrig && !assignedCharNames.includes(nOrig)) {
        assignedCharNames.push(nOrig);
      }
      if (assignedCharNames.includes(nOrig) && nTarg && !assignedCharNames.includes(nTarg)) {
        assignedCharNames.push(nTarg);
      }
    });
  }

  for (const rawCand of candidates) {
    if (!rawCand) continue;
    const normCand = normalizeName(rawCand);
    if (!normCand || normCand === 'default' || normCand === 'comment' || normCand === 'шумы' || normCand === 'sign' || normCand === 'titles') continue;

    // Direct match against assigned characters
    for (const cName of assignedCharNames) {
      if (!cName) continue;
      if (normCand === cName || normCand.includes(cName) || cName.includes(normCand)) {
        return true;
      }
      // Stem matching
      if (cName.length >= 4 && normCand.length >= 4) {
        const cStem = cName.slice(0, Math.min(5, cName.length - 1));
        const sStem = normCand.slice(0, Math.min(5, normCand.length - 1));
        if (cStem === sStem) return true;
      }
    }

    // Direct match against dubber nickname
    if (normNick) {
      if (normCand === normNick || normCand.includes(normNick) || normNick.includes(normCand)) {
        return true;
      }
    }

    // Split multi-character candidates (e.g. "Таня / Серебряков", "Виша, Таня")
    const parts = rawCand.split(/[,;&/]|(?:\s+и\s+)/i).map(normalizeName).filter(Boolean);
    if (parts.some(p => assignedCharNames.some(c => c === p || c.includes(p) || p.includes(c)) || p === normNick || (normChar && (p.includes(normChar) || normChar.includes(p))))) {
      return true;
    }
  }

  return false;
}

/**
 * Parses time string like "00:01:23.45" or "01:23.45" into seconds.
 */
export function parseTimeToSeconds(timeStr: string | number): number {
  if (typeof timeStr === 'number') return isNaN(timeStr) ? 0 : timeStr;
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const str = timeStr.trim();
  const parts = str.split(':');
  if (parts.length === 3) {
    const h = parseFloat(parts[0]) || 0;
    const m = parseFloat(parts[1]) || 0;
    const s = parseFloat(parts[2].replace(',', '.')) || 0;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const m = parseFloat(parts[0]) || 0;
    const s = parseFloat(parts[1].replace(',', '.')) || 0;
    return m * 60 + s;
  }
  const f = parseFloat(str.replace(',', '.'));
  return isNaN(f) ? 0 : f;
}

/**
 * Formats seconds into MM:SS.CS format (e.g. 01:23.45).
 */
export function formatSeconds(sec: number): string {
  if (isNaN(sec) || sec < 0) return '00:00.00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
